import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as geography from "d3-geo";

const cache = new Map();
function load(file) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) =>
        name === "d3-geo"
          ? geography
          : name.endsWith("?url")
            ? { default: name }
            : load(resolve(dirname(path), `${name}.ts`)),
    },
  );
  return exports;
}
const geometry = load("src/lib/historyAtlasGeometry.ts");
const atlas = load("src/lib/historyAtlas.ts");
const areas = load("src/lib/historyAtlasAreas.ts");
const rivers = load("src/lib/historyAtlasRivers.ts");
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasDataset;
const source = readFileSync("src/components/common/HistoryAtlas.tsx", "utf8");
const ast = ts.createSourceFile(
  "HistoryAtlas.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = new Map();
const effects = [];
let clickCapture, labelClick, listClick, overlayPointerDown;
let closeClick, overlayKeyDown, mapKeyDown;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer)
    declarations.set(node.name.getText(ast), node.initializer.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0].getText(ast));
  if (ts.isJsxOpeningElement(node)) {
    const attribute = (name) =>
      node.attributes.properties.find(
        (property) => property.name?.getText(ast) === name,
      )?.initializer;
    const onClick = attribute("onClick")?.expression?.getText(ast);
    if (attribute("onClickCapture"))
      clickCapture = attribute("onClickCapture").expression.getText(ast);
    if (attribute("className")?.text === "history-atlas__point-label")
      labelClick = onClick;
    if (attribute("className")?.text === "history-atlas__overlay") {
      overlayPointerDown = attribute("onPointerDown").expression.getText(ast);
      overlayKeyDown = attribute("onKeyDown").expression.getText(ast);
    }
    if (attribute("aria-label")?.text === "장소 설명 닫기")
      closeClick = onClick;
    if (attribute("ref")?.expression?.getText(ast) === "mapRef")
      mapKeyDown = attribute("onKeyDown").expression.getText(ast);
    if (onClick === "() => focusPlace(item.place.id)") listClick = onClick;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const touchEffect = effects.find((effect) =>
  effect.includes('node.addEventListener("touchstart"'),
);
const selectionEffect = effects.find((effect) =>
  effect.includes("if (!selected || !pendingFocusRef.current) return;"),
);
const resizeEffect = effects.find((effect) =>
  effect.includes("if (detailOpen && selected)"),
);
assert(
  touchEffect &&
    selectionEffect &&
    resizeEffect &&
    clickCapture &&
    labelClick &&
    listClick,
  "Touch, selection, resize and actual label/list handlers remain exercised",
);
const compiled = new Map();
function evaluate(expression, dependencies) {
  if (!compiled.has(expression))
    compiled.set(
      expression,
      ts.transpileModule(`exports.run = ${expression}`, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    );
  const exports = {};
  vm.runInNewContext(compiled.get(expression), { exports, ...dependencies });
  return exports.run;
}
const same = (a, b) =>
  assert.deepEqual(
    JSON.parse(JSON.stringify(a)),
    JSON.parse(JSON.stringify(b)),
  );
const near = (actual, expected, message) =>
  assert(
    Math.abs(actual - expected) < 1e-6,
    `${message}: ${actual} != ${expected}`,
  );

class Element {
  constructor(overlay = false) {
    this.overlay = overlay;
  }
  closest(selector) {
    return this.overlay && selector.includes(".history-atlas__overlay")
      ? this
      : null;
  }
}
function gestureHarness(node, transformRef, updates, bitmapReady = false) {
  const attributeNode = (attributes = {}) => ({
    attributes,
    writes: new Map(),
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.writes.set(name, (this.writes.get(name) || 0) + 1);
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
  });
  const original = { ...transformRef.current };
  const camera = attributeNode({
    transform: `translate(${original.x} ${original.y}) scale(${original.scale})`,
  });
  const vector = { style: { transform: "", willChange: "", opacity: "" } };
  const bitmap = {
    style: { transform: "", willChange: "", display: "none" },
    dataset: { atlasGestureReady: "true" },
  };
  const surface = bitmapReady ? bitmap : vector;
  const label = { style: { left: "40px", top: "60px", translate: "" } };
  const screenPath = attributeNode();
  const pattern = attributeNode({
    patternTransform: `scale(${1 / original.scale})`,
  });
  let zoomText = `${Math.round(original.scale * 100)}%`;
  const zoom = {
    writes: 0,
    get textContent() {
      return zoomText;
    },
    set textContent(value) {
      this.writes += 1;
      zoomText = value;
    },
  };
  node.querySelectorAll = (selector) =>
    selector === "pattern"
      ? [pattern]
      : selector.includes("history-atlas__minor-dots")
        ? [screenPath]
        : selector.includes("history-atlas__geography")
          ? [camera]
          : [label];
  node.querySelector = (selector) =>
    selector === ":scope > svg"
      ? vector
      : bitmapReady &&
          bitmap.dataset.atlasGestureReady === "true" &&
          selector.includes("canvas")
        ? bitmap
        : null;
  node.parentElement = { querySelector: () => zoom };
  const frames = new Map(),
    timers = new Map();
  let sequence = 0;
  const dependencies = {
    mapRef: { current: node },
    transformRef,
    gestureFrameRef: { current: null },
    gestureEndRef: { current: null },
    gestureSnapshotRef: { current: null },
    cameraFrameRef: { current: null },
    cameraTimingRef: { current: { elapsed: 0, updatedAt: null } },
    useCallback: (callback) => callback,
    flushSync: (callback) => callback(),
    window: { matchMedia: () => ({ matches: false }) },
    performance: { now: () => 0 },
    setCameraMoving() {},
    setTransform: (value) => updates.push(value),
    requestAnimationFrame: (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  dependencies.finishGesture = evaluate(
    declarations.get("finishGesture"),
    dependencies,
  );
  dependencies.moveGesture = evaluate(
    declarations.get("moveGesture"),
    dependencies,
  );
  dependencies.updateTransform = evaluate(
    declarations.get("updateTransform"),
    dependencies,
  );
  return {
    ...dependencies,
    camera,
    surface,
    vector,
    bitmap,
    label,
    screenPath,
    pattern,
    zoom,
    frames,
    timers,
    draw() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    settle() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
  };
}

for (const width of [356, 720]) {
  const original = { scale: 2, x: 0, y: 0 };
  const updates = [];
  const camera = gestureHarness(
    { clientWidth: width, clientHeight: 480 },
    { current: original },
    updates,
    true,
  );
  camera.moveGesture({ ...original, x: 80 });
  camera.draw();
  assert.equal(
    camera.surface.style.display,
    "block",
    "A prepared bitmap is used while moving",
  );
  assert.equal(
    camera.vector.style.opacity,
    "0",
    "The expensive SVG is hidden while the bitmap moves",
  );
  assert.equal(updates.length, 0, "Ordinary bitmap frames avoid React commits");
  camera.moveGesture({ ...original, x: 700 });
  camera.draw();
  assert.equal(
    updates.at(-1).x,
    700,
    "A long captured drag rebases before exposing a clipped edge",
  );
  assert.equal(camera.surface.style.display, "none");
  assert.equal(
    camera.vector.style.opacity,
    "",
    "Rebasing restores the exact SVG surface",
  );
  camera.moveGesture(original);
  camera.finishGesture(true);
  same(updates.at(-1), original);
  assert.equal(
    camera.surface.style.display,
    "none",
    "Release hides the temporary bitmap",
  );
  assert.equal(
    camera.vector.style.opacity,
    "",
    "Release restores the vector geometry",
  );
  const recent = { scale: 2, x: -width / 2, y: -240 };
  const cached = gestureHarness(
    { clientWidth: width, clientHeight: 480 },
    { current: recent },
    [],
    true,
  );
  cached.bitmap.dataset.atlasGestureCamera = JSON.stringify({
    scale: 1,
    x: 0,
    y: 0,
  });
  const continued = { scale: 2.1, x: recent.x + 20, y: recent.y + 10 };
  cached.moveGesture(continued);
  cached.draw();
  assert.equal(
    cached.surface.style.transform,
    `translate3d(${continued.x}px, ${continued.y}px, 0) scale(2.1)`,
    "Rapid input positions a retained bitmap using the camera it was actually captured with",
  );
  cached.finishGesture(true);
}
// Invoke the real native event handlers with mobile/tablet geometry. This checks
// the gesture transitions themselves; CSS alone cannot prove touch dragging.
let gestureCases = 0;
for (const mapWidth of [356, 720]) {
  const mapHeight = 480;
  const listeners = new Map();
  const updates = [];
  const transformRef = { current: { scale: 3, x: -mapWidth, y: -mapHeight } };
  const movedRef = { current: false };
  const node = {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => {
      assert.equal(listeners.get(type), handler);
      listeners.delete(type);
    },
  };
  const camera = gestureHarness(node, transformRef, updates);
  const cleanup = evaluate(touchEffect, {
    ...geometry,
    ...camera,
    Element,
    mapWidth,
    mapHeight,
    movedRef,
    transformRef,
    zoom: () => assert.fail("Touch must not use the wheel handler"),
  })();
  const overlayDown = evaluate(overlayPointerDown, { movedRef });
  const touch = (type, points, overlay = false) => {
    if (type === "touchstart" && overlay)
      overlayDown({ pointerType: "touch", stopPropagation() {} });
    const event = {
      touches: points.map(([x, y]) => ({ clientX: x + 10, clientY: y + 20 })),
      target: new Element(overlay),
      cancelable: true,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    listeners.get(type)(event);
    return event;
  };
  let selected = 0;
  const capture = evaluate(clickCapture, {
    Element,
    movedRef,
    mapPoints: [{ x: 100, y: 100, place: { id: "tapped" } }],
    focusPlace: () => {
      selected++;
    },
  });
  const click = (detail = 1, overlay = false) => {
    const event = {
      detail,
      target: new Element(overlay),
      currentTarget: node,
      clientX: 110,
      clientY: 120,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    capture(event);
    return event;
  };

  assert.equal(touch("touchstart", [[100, 100]]).prevented, false);
  assert.equal(touch("touchmove", [[103, 102]]).prevented, false);
  assert.equal(updates.length, 0, "Tap jitter does not move the map");
  touch("touchend", []);
  click();
  assert.equal(selected, 1, "An ordinary tap selects its visible point");

  const beforeDrag = { ...transformRef.current };
  touch("touchstart", [[100, 100]]);
  assert.equal(touch("touchmove", [[130, 120]]).prevented, true);
  near(
    transformRef.current.x,
    beforeDrag.x + 30,
    "Default one-finger horizontal pan",
  );
  near(
    transformRef.current.y,
    beforeDrag.y + 20,
    "Default one-finger vertical pan",
  );
  near(
    transformRef.current.scale,
    beforeDrag.scale,
    "One-finger drag keeps zoom",
  );
  touch("touchend", []);
  assert.equal(click().stopped, true);
  assert.equal(selected, 1, "A drag ending over a point never selects it");

  touch("touchstart", [[100, 100]]);
  touch("touchmove", [[110, 110]]);
  const beforePinch = { ...transformRef.current };
  assert.equal(
    touch("touchstart", [
      [100, 110],
      [200, 110],
    ]).prevented,
    true,
  );
  touch("touchmove", [
    [75, 110],
    [225, 110],
  ]);
  near(
    transformRef.current.scale,
    beforePinch.scale * 1.5,
    "One-to-two-finger pinch scales from its new baseline",
  );
  const anchorBefore = (150 - beforePinch.x) / beforePinch.scale;
  near(
    (150 - transformRef.current.x) / transformRef.current.scale,
    anchorBefore,
    "Pinch preserves the geographic point under its midpoint",
  );
  touch("touchend", [[225, 110]]);
  const beforeContinuation = { ...transformRef.current };
  touch("touchmove", [[245, 125]]);
  near(
    transformRef.current.x,
    beforeContinuation.x + 20,
    "Two-to-one-finger continuation has no jump",
  );
  near(
    transformRef.current.y,
    beforeContinuation.y + 15,
    "Continued one-finger pan retains its baseline",
  );
  touch("touchend", []);
  click();
  assert.equal(selected, 1);

  // Even an unmoved two-finger gesture must not activate the underlying place.
  touch("touchstart", [
    [100, 100],
    [200, 100],
  ]);
  touch("touchend", [[100, 100]]);
  touch("touchend", []);
  click();
  assert.equal(
    selected,
    1,
    "Multitouch completion suppresses the generated click",
  );
  touch("touchstart", [[100, 100]]);
  touch("touchcancel", []);
  assert.equal(click().stopped, true, "A canceled touch cannot select a place");
  touch("touchstart", [[100, 100]]);
  touch("touchend", []);
  click();
  assert.equal(selected, 2, "The next fresh tap works after cancellation");

  touch("touchstart", [[100, 100]]);
  touch("touchmove", [[130, 120]]);
  touch("touchend", []);
  assert.equal(movedRef.current, true);
  // Browsers may omit the click after a drag. The next independent popup tap
  // must clear that stale flag before the map's click capture sees the button.
  touch("touchstart", [[100, 100]], true);
  touch("touchend", [], true);
  assert.equal(
    click(1, true).prevented,
    false,
    "The first popup tap works after a drag without a synthetic click",
  );

  touch("touchstart", [[100, 100]]);
  touch("touchmove", [[130, 120]]);
  touch(
    "touchstart",
    [
      [130, 120],
      [200, 120],
    ],
    true,
  );
  assert.equal(
    movedRef.current,
    true,
    "An added finger over the popup does not reset an active gesture",
  );
  touch("touchend", [[200, 120]], true);
  touch("touchend", [], true);
  assert.equal(
    click(1, true).prevented,
    true,
    "A multitouch gesture cannot activate a popup button",
  );

  const beforeOverlay = updates.length;
  assert.equal(touch("touchstart", [[100, 100]], true).prevented, false);
  assert.equal(touch("touchmove", [[100, 160]], true).prevented, false);
  touch("touchend", [], true);
  assert.equal(
    updates.length,
    beforeOverlay,
    "Explanation scrolling never starts map panning",
  );
  movedRef.current = true;
  assert.equal(
    click(0).prevented,
    false,
    "Keyboard activation is not blocked by a previous drag",
  );
  touch("touchstart", [[100, 100]]);
  touch("touchmove", [[135, 125]]);
  const canceledView = { ...transformRef.current };
  touch("touchcancel", []);
  same(updates.at(-1), canceledView);
  assert.equal(
    camera.frames.size,
    0,
    "Cancellation clears a pending gesture frame",
  );
  assert.equal(camera.gestureSnapshotRef.current, null);

  const beforeWheel = { ...transformRef.current };
  camera.updateTransform({ ...beforeWheel, x: beforeWheel.x + 60 }, true);
  assert.notEqual(camera.cameraFrameRef.current, null);
  const wheel = {
    target: new Element(),
    clientX: 110,
    clientY: 120,
    deltaY: -40,
    deltaMode: 0,
    preventDefault() {},
  };
  listeners.get("wheel")(wheel);
  assert.equal(
    camera.cameraFrameRef.current,
    null,
    "A wheel gesture cancels an in-progress selection camera animation",
  );
  const wheeled = { ...transformRef.current };
  assert(wheeled.scale > beforeWheel.scale);
  camera.draw();
  camera.settle();
  same(updates.at(-1), wheeled);
  assert.equal(camera.gestureSnapshotRef.current, null);
  cleanup();
  assert.equal(
    listeners.size,
    0,
    "Rerenders remove every native interaction listener",
  );
  gestureCases += 11;
}

for (const mapWidth of [356, 720]) {
  const original = { scale: 3, x: -mapWidth, y: -480 };
  const pan = gestureHarness({}, { current: original }, []);
  for (let sample = 1; sample <= 5; sample++) {
    pan.moveGesture({
      ...original,
      x: original.x + sample * 12,
      y: original.y + sample * 8,
    });
    pan.draw();
  }
  pan.finishGesture(true);
  assert.equal(
    pan.pattern.writes.get("patternTransform") || 0,
    0,
    "Panning and release at the same scale retain the SVG texture cache",
  );
  assert.equal(
    pan.zoom.writes,
    0,
    "Panning and release never rewrite an unchanged zoom label",
  );
  const transformRef = { current: original };
  const updates = [];
  const camera = gestureHarness({}, transformRef, updates);
  const target = { scale: 4, x: original.x + 80, y: original.y + 40 };
  for (let sample = 0; sample < 40; sample++) camera.moveGesture(target, true);
  assert.equal(
    updates.length,
    0,
    "Continuous gesture samples do not render React state",
  );
  assert.equal(camera.frames.size, 1, "A burst queues one display frame");
  assert.equal(
    camera.timers.size,
    1,
    "Wheel settling uses one replaceable timer",
  );
  camera.draw();
  const ratio = target.scale / original.scale;
  assert.equal(
    camera.surface.style.transform,
    `translate3d(${target.x - original.x * ratio}px, ${target.y - original.y * ratio}px, 0) scale(${ratio})`,
    "The painted surface includes the complete transient camera delta",
  );
  assert.equal(camera.surface.style.willChange, "transform");
  assert.equal(camera.camera.writes.size, 0);
  assert.equal(camera.zoom.textContent, "400%");
  assert.equal(
    camera.pattern.writes.size,
    0,
    "Pinching retains the painted texture until the camera is committed",
  );
  assert.notEqual(camera.label.style.translate, "");
  assert.equal(
    camera.label.style.left,
    "40px",
    "Gesture samples preserve layout positions",
  );
  assert.equal(
    camera.label.style.top,
    "60px",
    "Gesture samples use compositor translation",
  );
  assert.equal(camera.screenPath.writes.size, 0);

  // The last sample can return to the existing React props and be released
  // before RAF. React will skip identical props, so stale imperative values
  // must be restored before committing the final state.
  camera.moveGesture(original);
  camera.finishGesture(true);
  same(updates.at(-1), original);
  assert.equal(
    camera.frames.size,
    0,
    "Fast release cancels the pending display frame",
  );
  assert.equal(camera.timers.size, 0);
  assert.equal(camera.surface.style.transform, "");
  assert.equal(camera.surface.style.willChange, "");
  assert.equal(
    camera.camera.attributes.transform,
    `translate(${original.x} ${original.y}) scale(${original.scale})`,
  );
  assert.equal(camera.label.style.left, "40px");
  assert.equal(camera.label.style.top, "60px");
  assert.equal(
    camera.label.style.translate,
    "",
    "Release clears the temporary label translation",
  );
  assert.equal(
    camera.pattern.attributes.patternTransform,
    `scale(${1 / original.scale})`,
  );
  assert.equal(camera.zoom.textContent, "300%");
  assert.equal(camera.screenPath.attributes.transform, undefined);
  gestureCases += 3;
}

// Closing an explanation cancels focus motion and every selection without
// resetting its camera or the filters that produced the current place list.
let dismissalCases = 0;
for (const kind of ["place", "country", "province", "traditional"]) {
  const before = { scale: 4.25, x: -612.5, y: 87.25 };
  const transformRef = { current: { ...before } };
  const updates = [];
  const camera = gestureHarness({}, transformRef, updates);
  camera.updateTransform({ scale: 8, x: -900, y: -100 }, true);
  const state = {
    SelectedId: kind === "place" ? "place-entry" : "",
    CountryId: kind === "country" ? "KOR" : "",
    ProvinceDetailOpen: kind === "province" || kind === "traditional",
    RegionSelectionDismissed: false,
    DetailOpen: true,
  };
  const pendingFocusRef = { current: "pending-place" };
  const pendingVisualScaleRef = { current: 1234 };
  const focusDetailsAfterListRef = { current: true };
  let mapFocused = false;
  const closeDetails = evaluate(declarations.get("closeDetails"), {
    ...camera,
    pendingFocusRef,
    pendingVisualScaleRef,
    focusDetailsAfterListRef,
    mapRef: {
      current: {
        focus: () => {
          mapFocused = true;
        },
      },
    },
    ...Object.fromEntries(
      Object.keys(state).map((key) => [
        `set${key}`,
        (value) => {
          state[key] = value;
        },
      ]),
    ),
  });
  if (kind === "country")
    evaluate(overlayKeyDown, { closeDetails })({
      key: "Escape",
      stopPropagation() {},
    });
  else if (kind === "province") {
    const node = {};
    evaluate(mapKeyDown, { closeDetails })({
      key: "Escape",
      target: node,
      currentTarget: node,
    });
  } else evaluate(closeClick, { closeDetails })();
  same(state, {
    SelectedId: "",
    CountryId: "",
    ProvinceDetailOpen: false,
    RegionSelectionDismissed: true,
    DetailOpen: false,
  });
  same(transformRef.current, before);
  same(updates.at(-1), before);
  assert.equal(camera.cameraFrameRef.current, null);
  assert.equal(camera.frames.size, 0);
  assert.equal(pendingFocusRef.current, null);
  assert.equal(pendingVisualScaleRef.current, null);
  assert.equal(focusDetailsAfterListRef.current, false);
  assert(mapFocused);
  const provinceArea = evaluate(declarations.get("provinceArea"), {
    regionSelectionDismissed: state.RegionSelectionDismissed,
    areaGeometry: { features: [{}] },
    selected: undefined,
    countryId: state.CountryId,
    traditionalRegionId: kind === "traditional" ? "giho" : "",
    regionId: "gyeonggi",
    subregionId: "",
    findAtlasRegionArea: () => assert.fail("A closed region cannot reselect"),
  });
  assert.equal(provinceArea, null);
  evaluate(selectionEffect, { selected: undefined, pendingFocusRef })();
  for (const effect of effects.filter(
    (effect) =>
      effect.includes("if (!provinceArea") ||
      effect.includes("if (!selectedCountry) return;"),
  ))
    evaluate(effect, { provinceArea, selectedCountry: undefined })();
  dismissalCases++;
}

const koreaAreas = JSON.parse(
  readFileSync("src/data/atlas/areas-korea.json", "utf8"),
);
const province = areas.findAtlasRegionArea("gyeonggi", koreaAreas);
assert(province);
const unitsById = new Map(dataset.units.map((unit) => [unit.id, unit]));
const placeById = new Map(dataset.places.map((place) => [place.id, place]));
const entries = dataset.entries
  .filter((entry) => unitsById.get(entry.unitId)?.subject === "korea")
  .map((entry) => {
    const place = placeById.get(entry.placeId);
    const name = atlas.normalizeAtlasSearch(place.name);
    return { entry, place, search: { names: [name], aliases: [], text: name } };
  });
const target = entries.find((item) => item.place.name === "종묘");
assert(target);
const searchRank = evaluate(declarations.get("searchRank"), {});
const searchEntries = evaluate(declarations.get("searchEntries"), {
  ...atlas,
  searchRank,
});
const viewports = [
  { width: 356, mapHeight: 480, top: 265.6, height: 214.4 },
  { width: 720, mapHeight: 480, height: 448, overlayRight: 288 },
  { width: 920, mapHeight: 640, height: 608, overlayRight: 328 },
];
let focusCases = 0;
for (const viewport of viewports)
  for (const regional of [false, true])
    for (const entryPoint of ["label", "list", "search", "story"]) {
      const { width: mapWidth, mapHeight } = viewport;
      const bounds = regional
        ? areas.atlasAreaCameraBounds(province)
        : atlas.ATLAS_SUBJECT_BOUNDS.korea;
      const projection = geometry.createAtlasProjection(
        "korea",
        bounds,
        mapWidth,
        mapHeight,
      );
      const transformRef = {
        current: { scale: regional ? 3 : 8, x: -mapWidth, y: -mapHeight },
      };
      const originalVisualScale =
        projection.scale() * transformRef.current.scale;
      const pendingFocusRef = { current: null };
      const pendingVisualScaleRef = { current: null };
      const state = { SelectedId: "", DetailOpen: false };
      const dependencies = {
        ...atlas,
        ...geometry,
        ...areas,
        ...rivers,
        ...geography,
        projection,
        transformRef,
        pendingFocusRef,
        pendingVisualScaleRef,
        entries,
        scopeEntries: entries,
        selected: undefined,
        selectedId: "",
        subject: "korea",
        unitsById,
        unitId: "",
        eraId: "",
        regionId: "",
        traditionalArea: null,
        subregionId: "",
        query: "",
        searchRank,
        searchEntries,
        areaGeometry: koreaAreas,
        focusDetailsAfterListRef: { current: false },
        panelOpen: entryPoint === "list",
        dokdoItem: undefined,
        setFocusRevision: () => {},
        entryName: (item) => item.place.name,
        ...Object.fromEntries(
          [
            "CountryId",
            "SelectedId",
            "DetailOpen",
            "MobilePanel",
            "Query",
            "FilterNotice",
          ].map((key) => [
            `set${key}`,
            (value) => {
              state[key] = value;
            },
          ]),
        ),
      };
      const requestPlaceFocus = evaluate(
        declarations.get("requestPlaceFocus"),
        dependencies,
      );
      const focusPlace = evaluate(declarations.get("focusPlace"), {
        ...dependencies,
        requestPlaceFocus,
      });
      if (entryPoint === "label")
        evaluate(labelClick, { focusPlace, point: target })();
      if (entryPoint === "list")
        evaluate(listClick, { focusPlace, item: target })();
      if (entryPoint === "search")
        evaluate(declarations.get("changeQuery"), {
          ...dependencies,
          requestPlaceFocus,
        })(target.place.name);
      if (entryPoint === "story")
        evaluate(declarations.get("selectStory"), {
          ...dependencies,
          requestPlaceFocus,
        })(target);
      assert.equal(
        state.SelectedId,
        target.entry.id,
        `${entryPoint}: actual entry is selected`,
      );
      assert.equal(state.DetailOpen, true);
      near(
        pendingVisualScaleRef.current,
        originalVisualScale,
        `${entryPoint}: captures geographic scale before a regional projection changes`,
      );

      // A selection must preserve the existing projection, including the first
      // point after a regional overview, and keep its pending scale snapshot.
      let camera;
      for (let render = 0; render < 5 && pendingFocusRef.current; render++) {
        const current = {
          ...dependencies,
          projection,
          bounds,
          baseBounds: atlas.ATLAS_SUBJECT_BOUNDS.korea,
          selected: target,
          selectedId: target.entry.id,
          selectedShape: null,
          detailOpen: true,
          mapWidth,
          mapHeight,
          availableMapHeight: viewport.height,
          availableMapTop: viewport.top || 0,
          overlayObstacle: viewport.overlayRight
            ? { right: viewport.overlayRight }
            : null,
          landformGeometry: null,
          geometry: null,
          updateTransform: (value) => {
            camera = value;
            transformRef.current = value;
          },
          setViewBounds: () =>
            assert.fail("Place selection must not refit the base projection"),
        };
        evaluate(resizeEffect, current)();
        near(
          pendingVisualScaleRef.current,
          originalVisualScale,
          "Popup resize keeps the pending scale snapshot",
        );
        evaluate(selectionEffect, current)();
      }
      assert(camera, "Selection resolves using the existing projection");
      near(
        projection.scale() * camera.scale,
        originalVisualScale,
        `${entryPoint}: effective geographic zoom remains exact`,
      );
      const coordinate = projection(target.place.coordinates);
      const x = coordinate[0] * camera.scale + camera.x;
      const y = coordinate[1] * camera.scale + camera.y;
      assert(
        x >= (viewport.overlayRight || 0) + 24 && x <= mapWidth - 24,
        "Selected point stays beside the popup",
      );
      assert(
        y >= (viewport.top || 0) + 24 &&
          y <= (viewport.top || 0) + viewport.height - 24,
        "Selected point stays below/alongside the popup",
      );
      focusCases++;
    }

for (const viewport of viewports) {
  const projection = geometry.createAtlasProjection(
    "korea",
    atlas.ATLAS_SUBJECT_BOUNDS.korea,
    viewport.width,
    viewport.mapHeight,
  );
  const point = {
    coordinates: target.place.coordinates,
    contextBounds: rivers.atlasFocusExtent(target.place, "korea"),
  };
  const initial = geometry.fitAtlasSelection(projection, point, viewport);
  same(
    geometry.fitAtlasSelection(
      projection,
      { ...point, minimumScale: 1 },
      viewport,
    ),
    initial,
  );
  assert.equal(
    geometry.fitAtlasSelection(
      projection,
      { ...point, minimumScale: 100 },
      viewport,
    ).scale,
    geometry.ATLAS_MAX_ZOOM,
    "Extreme distant selections retain the existing maximum zoom",
  );
  for (const shape of [
    province,
    {
      type: "LineString",
      coordinates: [
        [126.5, 37.2],
        [127.5, 38.1],
      ],
    },
  ]) {
    const selection = {
      coordinates: geography.geoCentroid(shape),
      geometry: shape,
    };
    const focused = geometry.fitAtlasSelection(
      projection,
      { ...selection, minimumScale: 12 },
      viewport,
    );
    assert.equal(focused.scale, 12, "Shape selection never reduces prior zoom");
    const anchor = projection(selection.coordinates);
    const x = anchor[0] * focused.scale + focused.x;
    const y = anchor[1] * focused.scale + focused.y;
    assert(
      x >= (viewport.overlayRight || 0) + 24 &&
        x <= viewport.width - 24 &&
        y >= (viewport.top || 0) + 24 &&
        y <= (viewport.top || 0) + viewport.height - 24,
      "The zoom-preserving shape anchor remains clear of the popup",
    );
  }
}
console.log(
  `Atlas interaction checks passed: ${gestureCases} real touch/tap transitions, ${focusCases} label/list/search/story selection flows, ${dismissalCases} explanation dismissals with no residual selection or camera movement, exact geographic zoom preservation, popup clearance, shape zoom retention and maximum-zoom contracts.`,
);
