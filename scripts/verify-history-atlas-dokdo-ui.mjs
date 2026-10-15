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
const constants = load("src/data/historyAtlasDokdo.ts");
const {
  ATLAS_DOKDO_ID: dokdoId,
  ATLAS_DOKDO_COORDINATES: coordinates,
  ATLAS_DOKDO_LABEL: label,
} = constants;
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasDataset;
const atlas = load("src/lib/historyAtlas.ts");
const geometry = load("src/lib/historyAtlasGeometry.ts");
const globe = load("src/lib/historyGlobeMath.ts");
const regions = load("src/lib/historyAtlasRegions.ts");
const units = new Map(dataset.units.map((unit) => [unit.id, unit]));
const places = new Map(dataset.places.map((place) => [place.id, place]));
const items = dataset.entries.map((entry) => ({
  entry,
  place: places.get(entry.placeId),
  subject: units.get(entry.unitId).subject,
  search: "",
}));
const dokdoItem = items.find(
  (item) => item.place.id === dokdoId && item.subject === "korea",
);
assert(dokdoItem, "The base-map marker must have a real Korean-history entry");

function component(file) {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = new Map();
  let draw, badgeClick;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer)
      declarations.set(node.name.getText(ast), node.initializer);
    if (ts.isFunctionDeclaration(node) && node.name)
      declarations.set(node.name.text, node);
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === "drawRef.current"
    )
      draw = node.right.getText(ast);
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(ast) === "button"
    ) {
      const className = node.attributes.properties.find(
        (property) => property.name?.getText(ast) === "className",
      );
      if (className?.initializer?.text === "history-globe__dokdo-label")
        badgeClick = node.attributes.properties
          .find((property) => property.name?.getText(ast) === "onClick")
          .initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return {
    draw,
    badgeClick,
    expression(name, hook = false) {
      const node = declarations.get(name);
      assert(node, `${file}: ${name} must remain exercised`);
      return (hook ? node.arguments[0] : node).getText(ast);
    },
  };
}
function evaluate(expression, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(`exports.run = ${expression}`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, ...dependencies },
  );
  return exports.run;
}
const flat = component("src/components/common/HistoryAtlas.tsx");
const sphere = component("src/components/common/HistoryGlobe.tsx");
for (const subject of ["korea", "world"]) {
  const subjectEntries = items.filter((item) => item.subject === subject);
  const baseItem = evaluate(flat.expression("dokdoItem", true), {
    ...constants,
    subject,
    subjectEntries,
  })();
  assert.equal(
    !!baseItem,
    subject === "korea",
    "World flat maps do not acquire Korean-history rows",
  );
  const visiblePlaces = [];
  const mapPlaces = evaluate(flat.expression("mapPlaces", true), {
    ...constants,
    visiblePlaces,
    dokdoItem: baseItem,
  })();
  assert.equal(
    mapPlaces.length,
    subject === "korea" ? 1 : 0,
    "Only the Korean base map adds the filter-independent marker",
  );
  assert.equal(
    visiblePlaces.length,
    0,
    "Base-map annotations never mutate the filtered list",
  );
}
const worldItems = items.filter((item) => item.subject === "world");
const mapItems = evaluate(sphere.expression("mapItems", true), {
  ...constants,
  filtered: worldItems,
  selected: undefined,
  dokdoItem,
})();
assert.equal(
  mapItems.filter((item) => item.place.id === dokdoId).length,
  1,
  "The world-filtered globe retains exactly one Dokdo marker",
);
assert(
  !worldItems.some((item) => item.place.id === dokdoId),
  "Globe annotation does not alter world-history list scope",
);

const layout = evaluate(flat.expression("placeLabelLayout"), {});
let flatCases = 0;
for (const width of [286, 343, 356, 640, 920]) {
  for (const height of [480, 640]) {
    const projection = geometry.createAtlasProjection(
      "korea",
      atlas.ATLAS_SUBJECT_BOUNDS.korea,
      width,
      height,
    );
    const [x, y] = projection(coordinates);
    // Dense neighbouring cities cannot consume Dokdo's hit target or label slot.
    const points = Array.from({ length: 30 }, (_, index) => ({
      place: { id: `nearby-${index}` },
      name: "인접 장소",
      x: x + index / 10,
      y,
      active: false,
    }));
    points.push({
      place: dokdoItem.place,
      name: label,
      x,
      y,
      active: false,
      priority: true,
    });
    const result = layout(points, width, height, null).find(
      (point) => point.place.id === dokdoId,
    );
    assert(
      result.hitVisible && result.labelVisible,
      `${width}/${height}: base Dokdo point and badge remain visible`,
    );
    const left = result.x - 22 + result.labelLeft;
    assert(
      left >= 4 && left + result.labelWidth <= width - 4,
      "Dokdo label stays inside the mobile map",
    );
    flatCases += 1;
  }
}

// The real draw callback is exercised against a small canvas/DOM adapter. This
// tests ordering, badge visibility, hemisphere clipping and stale-label removal.
const node = () => ({
  style: { setProperty() {} },
  hidden: true,
  attributes: {},
  classList: {
    values: new Set(),
    toggle(name, value) {
      value ? this.values.add(name) : this.values.delete(name);
    },
  },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
});
let globeCases = 0;
for (const width of [286, 356, 640, 920]) {
  const height = width === 920 ? 640 : 480;
  const labels = Array.from({ length: 18 }, () => ({
    ...node(),
    children: [node(), node(), node()],
  }));
  const badge = node(),
    halo = node(),
    drawnPoints = { current: [] };
  const context = new Proxy(
    { measureText: (text) => ({ width: text.length * 14 }) },
    {
      get(target, name) {
        return name in target ? target[name] : () => {};
      },
    },
  );
  const state = {
    viewRef: { current: globe.GLOBE_INITIAL_VIEW },
    selected: undefined,
    panel: "list",
    detailRef: { current: null },
    size: { width, height },
    mapItems,
  };
  const dependencies = {
    ...constants,
    ...geography,
    ...geometry,
    ...globe,
    ...state,
    canvasRef: { current: { getContext: () => context } },
    rootRef: { current: {} },
    window: { devicePixelRatio: 1 },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    GLOBE_COLORS: evaluate(sphere.expression("GLOBE_COLORS"), {}),
    zoomRef: { current: node() },
    compassRef: { current: node() },
    riverHaloRef: { current: node() },
    haloRef: { current: halo },
    dokdoLabelRef: { current: badge },
    labelsRef: { current: { children: labels } },
    drawnPoints,
    land: null,
    geography: null,
    selectedRiver: null,
    selectedShape: null,
    selectedLandform: null,
    selectableGeography: [],
    hitGeography: { current: () => undefined },
    grid: geography.geoGraticule10(),
    nameOf: (item) => item.place.name,
  };
  evaluate(sphere.draw, dependencies)();
  assert(drawnPoints.current.some((point) => point.item.place.id === dokdoId));
  assert.equal(
    badge.hidden,
    false,
    `${width}: world-filtered globe shows the accessible Dokdo badge`,
  );
  assert(
    labels.some(
      (group) =>
        group.children[1].textContent === label &&
        group.style.display !== "none",
    ),
  );
  state.viewRef.current = globe.focusGlobeView(
    globe.GLOBE_INITIAL_VIEW,
    coordinates,
  );
  const popupBottom = width < 344 ? 84 : 32;
  dependencies.selected = dokdoItem;
  dependencies.panel = "detail";
  dependencies.detailRef.current = {
    parentElement: {
      offsetLeft: 8,
      offsetTop: height * 0.58 - popupBottom,
      offsetHeight: height * 0.42,
      offsetWidth: Math.min(280, width - 16),
    },
  };
  evaluate(sphere.draw, dependencies)();
  assert.equal(
    halo.hidden,
    false,
    "Selecting Dokdo displays the existing location ripple",
  );
  assert.equal(
    badge.hidden,
    false,
    "The selected badge remains above the mobile popup",
  );
  assert(
    labels.some(
      (group) =>
        group.classList.values.has("is-active") &&
        group.children[1].textContent === label &&
        group.children[2].style.display === "",
    ),
    "Selected Dokdo uses the existing label ripple",
  );
  const badgeBottom = Number.parseFloat(badge.style.top) + 32;
  assert(
    badgeBottom < dependencies.detailRef.current.parentElement.offsetTop,
    "Dokdo label must not be hidden by the popup",
  );
  state.viewRef.current = {
    longitude: coordinates[0] - 180,
    latitude: -coordinates[1],
    roll: 0,
    zoom: 1,
  };
  evaluate(sphere.draw, dependencies)();
  assert(
    !drawnPoints.current.some((point) => point.item.place.id === dokdoId),
    "Backside Dokdo cannot mirror onto the front hemisphere",
  );
  assert.equal(
    badge.hidden,
    true,
    "The old badge is hidden after turning to the back hemisphere",
  );
  assert.equal(halo.hidden, true);
  globeCases += 3;
}

let opened;
evaluate(flat.expression("focusPlace"), {
  entries: [],
  selected: undefined,
  dokdoItem,
  selectStory: (item) => {
    opened = item;
  },
})(dokdoId);
assert.equal(
  opened,
  dokdoItem,
  "A filtered-out base marker opens the actual Korean entry",
);
const flatState = {};
evaluate(flat.expression("selectStory"), {
  subject: "korea",
  unitsById: units,
  unitId: "different-unit",
  eraId: "different-era",
  regionId: "gyeonggi",
  subregionId: "",
  query: "different query",
  ...atlas,
  ...regions,
  entryName: (item) => item.entry.displayName || item.place.name,
  requestPlaceFocus: (id) => {
    flatState.focus = id;
  },
  ...Object.fromEntries(
    [
      "UnitId",
      "ViewBounds",
      "EraId",
      "RegionId",
      "SubregionId",
      "Query",
      "FilterNotice",
      "SelectedId",
      "DetailOpen",
      "MobilePanel",
    ].map((key) => [
      `set${key}`,
      (value) => {
        flatState[key] = value;
      },
    ]),
  ),
})(dokdoItem);
for (const key of ["UnitId", "EraId", "RegionId", "SubregionId", "Query"])
  assert.equal(
    flatState[key],
    "",
    `${key}: incompatible flat filter is cleared`,
  );
assert.equal(flatState.SelectedId, dokdoItem.entry.id);
assert.equal(flatState.focus, dokdoId);
assert.equal(flatState.DetailOpen, true);

const globeState = { revision: 0 };
const chooseEntry = evaluate(sphere.expression("chooseEntry", true), {
  subject: "world",
  itemsById: new Map([[dokdoItem.entry.id, dokdoItem]]),
  unitId: "world-unit",
  eraId: "world-era",
  regionId: "europe",
  subregionId: "",
  query: "different query",
  ...atlas,
  ...regions,
  ...globe,
  pendingPanelFocus: { current: null },
  viewRef: { current: globe.GLOBE_INITIAL_VIEW },
  setSelectionRevision: (update) => {
    globeState.revision = update(globeState.revision);
  },
  ...Object.fromEntries(
    [
      "Subject",
      "UnitId",
      "EraId",
      "RegionId",
      "SubregionId",
      "Query",
      "Page",
      "Notice",
      "SelectedId",
      "Panel",
      "PanelOpen",
      "Camera",
    ].map((key) => [
      `set${key}`,
      (value) => {
        globeState[key] = value;
      },
    ]),
  ),
});
evaluate(sphere.badgeClick, { dokdoItem, chooseEntry })();
assert.equal(
  globeState.Subject,
  "korea",
  "Globe badge opens Korean history rather than relabelling it as world history",
);
assert.equal(globeState.SelectedId, dokdoItem.entry.id);
assert.equal(globeState.Panel, "detail");
assert.equal(globeState.revision, 1);
for (const key of ["UnitId", "EraId", "RegionId", "SubregionId", "Query"])
  assert.equal(globeState[key], "");
assert(Math.abs(globeState.Camera.longitude - coordinates[0]) < 1e-9);
assert(Math.abs(globeState.Camera.latitude - coordinates[1]) < 1e-9);
let pointEntry;
evaluate(sphere.expression("endPointer"), {
  gesture: { current: { moved: false, multiple: false } },
  pointers: { current: new Map([[1, { x: 100, y: 100 }]]) },
  localPointer: () => ({ x: 100, y: 100 }),
  drawnPoints: { current: [{ item: dokdoItem, x: 100, y: 100 }] },
  nearestGlobePoint: globe.nearestGlobePoint,
  chooseEntry: (entryId) => {
    pointEntry = entryId;
  },
  commitView: () => {},
})({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
assert.equal(
  pointEntry,
  dokdoItem.entry.id,
  "The actual globe point uses the same filter-aware entry route as its badge",
);
console.log(
  `Dokdo UI checks passed: ${flatCases} crowded flat layouts, ${globeCases} actual globe draw states, Korean/world scope, filtered marker and accessible badge selection, ripple and backside visibility.`,
);
