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
const { ATLAS_DOKDO_ID: dokdoId, ATLAS_DOKDO_COORDINATES: coordinates } =
  constants;
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasDataset;
const atlas = load("src/lib/historyAtlas.ts");
const geometry = load("src/lib/historyAtlasGeometry.ts");
const globe = load("src/lib/historyGlobeMath.ts");
const globeRendering = load("src/lib/historyGlobeRendering.ts");
const regions = load("src/lib/historyAtlasRegions.ts");
const areaModel = load("src/lib/historyAtlasAreas.ts");
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
  let draw,
    labelClick,
    labelKeyDown,
    pointClick,
    provinceClick,
    mapClickCapture;
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
    if (ts.isJsxOpeningElement(node)) {
      const className = node.attributes.properties.find(
        (property) => property.name?.getText(ast) === "className",
      );
      const handler = (name) =>
        node.attributes.properties
          .find((property) => property.name?.getText(ast) === name)
          ?.initializer?.expression?.getText(ast);
      if (handler("onClickCapture"))
        mapClickCapture = handler("onClickCapture");
      if (className?.initializer?.text === "history-atlas__point-label")
        labelClick = handler("onClick");
      if (className?.initializer?.text === "history-atlas__province-label")
        provinceClick = handler("onClick");
      if (
        className?.initializer?.expression
          ?.getText(ast)
          .startsWith("`history-atlas__point${")
      )
        pointClick = handler("onClick");
      if (
        node.tagName.getText(ast) === "g" &&
        handler("onClick")?.includes("dataset.globeLabel")
      ) {
        labelClick = handler("onClick");
        labelKeyDown = handler("onKeyDown");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return {
    draw,
    labelClick,
    labelKeyDown,
    pointClick,
    provinceClick,
    mapClickCapture,
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
      name: dokdoItem.place.name,
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
      `${width}/${height}: base Dokdo point and ordinary label remain visible`,
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
// tests ordering, ordinary/active label styling, hemisphere clipping and stale-label removal.
const node = () => ({
  style: { setProperty() {} },
  hidden: true,
  attributes: {},
  classList: {
    values: new Set(),
    toggle(name, value) {
      value ? this.values.add(name) : this.values.delete(name);
    },
    add(name) {
      this.values.add(name);
    },
    remove(name) {
      this.values.delete(name);
    },
  },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
  removeAttribute(name) {
    delete this.attributes[name];
  },
});
let globeCases = 0;
for (const width of [286, 356, 640, 920]) {
  const height = width === 920 ? 640 : 480;
  const labels = Array.from({ length: 47 }, () => ({
    ...node(),
    children: [node(), node(), node(), node()],
  }));
  const halo = node(),
    drawnPoints = { current: [] };
  const arcs = [];
  const context = new Proxy(
    {
      measureText: (text) => ({ width: text.length * 14 }),
      arc: (...args) => arcs.push(args),
    },
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
    detailOpen: false,
    detailRef: { current: null },
    size: { width, height },
    mapItems,
  };
  const dependencies = {
    ...constants,
    ...geography,
    ...geometry,
    ...globe,
    ...globeRendering,
    ...state,
    id: "dokdo-ui-globe",
    gesture: { current: null },
    wheelActive: { current: false },
    canvasRef: { current: { getContext: () => context } },
    rootRef: { current: {} },
    window: { devicePixelRatio: 1 },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    GLOBE_COLORS: evaluate(sphere.expression("GLOBE_COLORS"), {}),
    palette: evaluate(sphere.expression("GLOBE_COLORS"), {}),
    selectionViewport: evaluate(sphere.expression("selectionViewport"), {}),
    zoomRef: { current: node() },
    compassRef: { current: node() },
    riverHaloRef: { current: node() },
    landClipRef: { current: node() },
    haloRef: { current: halo },
    labelsRef: { current: { children: labels } },
    drawnPoints,
    land: null,
    geography: null,
    geographyLabels: [],
    terrain: null,
    terrainLayers: [],
    mountainTexture: null,
    desertTexture: null,
    countries: null,
    selectedCountry: null,
    selectedPlaceCountry: null,
    highlightedCountry: null,
    selectedRiver: null,
    selectedShape: null,
    selectedLandform: null,
    highlightedShape: null,
    highlightedArea: false,
    provinceArea: null,
    selectableGeography: [],
    hitGeography: { current: () => undefined },
    hitCountry: { current: () => null },
    grid: geography.geoGraticule10(),
    nameOf: (item) => item.place.name,
  };
  evaluate(sphere.draw, dependencies)();
  assert(drawnPoints.current.some((point) => point.item.place.id === dokdoId));
  const dokdoLabel = () =>
    labels.find(
      (group) =>
        group.attributes["data-globe-label"] === dokdoItem.entry.id &&
        group.style.display !== "none",
    );
  assert(
    dokdoLabel(),
    `${width}: world-filtered globe keeps an accessible Dokdo name`,
  );
  assert.equal(
    dokdoLabel().children[0].style.display,
    "none",
    "Unselected Dokdo has no badge background",
  );
  assert.equal(
    dokdoLabel().children[2].style.display,
    "none",
    "Unselected Dokdo has no label ripple",
  );
  assert.equal(
    dokdoLabel().attributes.tabindex,
    "0",
    "The ordinary Dokdo label is keyboard reachable",
  );
  state.viewRef.current = globe.focusGlobeView(
    globe.GLOBE_INITIAL_VIEW,
    coordinates,
  );
  dependencies.selected = dokdoItem;
  dependencies.panel = "detail";
  dependencies.detailOpen = true;
  dependencies.detailRef.current = {
    parentElement: {
      offsetLeft: 8,
      offsetTop: width < 650 ? 56 : 8,
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
  assert(
    dokdoLabel(),
    "Selected Dokdo remains visible beside or below the top-left popup",
  );
  assert.equal(
    dokdoLabel().children[0].style.display,
    "",
    "Selecting Dokdo uses the common active badge",
  );
  assert(
    labels.some(
      (group) =>
        group.classList.values.has("is-active") &&
        group.children[1].textContent === dokdoItem.place.name &&
        group.children[2].style.display === "",
    ),
    "Selected Dokdo uses the existing label ripple",
  );
  const popup = dependencies.detailRef.current.parentElement;
  const [labelX, labelY] = dokdoLabel()
    .attributes.transform.match(/[-\d.]+/g)
    .map(Number);
  const labelWidth = Number(dokdoLabel().children[0].attributes.width);
  assert(
    labelX - 8 >= popup.offsetLeft + popup.offsetWidth ||
      labelY - 22 >= popup.offsetTop + popup.offsetHeight,
    "Selected label must not be hidden by the top-left popup",
  );
  assert(
    labelX - 8 >= 0 && labelX - 8 + labelWidth <= width,
    "Selected label remains within the map",
  );
  for (const shape of [
    {
      type: "LineString",
      coordinates: [
        [128, 35],
        [128, 38],
        [131, 38],
        [131, 35],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [128, 35],
          [128, 38],
          [131, 38],
          [131, 35],
          [128, 35],
        ],
      ],
    },
  ]) {
    const shapeItem = items.find(
      (item) =>
        item.place.name === (shape.type === "LineString" ? "한강" : "인천"),
    );
    dependencies.mapItems = [shapeItem];
    dependencies.selected = shapeItem;
    dependencies.selectedShape = dependencies.highlightedShape = shape;
    dependencies.highlightedArea = shape.type === "Polygon";
    state.viewRef.current = globe.focusGlobeView(
      globe.GLOBE_INITIAL_VIEW,
      geography.geoCentroid(shape),
    );
    arcs.length = 0;
    evaluate(sphere.draw, dependencies)();
    assert.equal(
      arcs.length,
      0,
      "A selected river or area draws no substitute point",
    );
    assert.equal(
      halo.hidden,
      true,
      "A selected river or area has no point ripple",
    );
    const shapeLabel = labels.find(
      (group) =>
        group.style.display !== "none" &&
        group.attributes["data-globe-label"] === shapeItem.entry.id,
    );
    assert(shapeLabel, "A selected shape has an interactive badge");
    const anchor = drawnPoints.current.find(
      (point) => point.item === shapeItem,
    );
    const [x, y] = shapeLabel.attributes.transform
      .match(/[-\d.]+/g)
      .map(Number);
    const textWidth = Number(shapeLabel.children[1].attributes.textLength);
    assert(
      x - 8 <= anchor.x &&
        x + textWidth + 8 >= anchor.x &&
        Math.abs(
          Math.min(anchor.x - (x - 8), x + textWidth + 8 - anchor.x) - 8,
        ) < 1e-6 &&
        Math.abs(y - anchor.y) < 1e-6,
      "The active badge overlaps the shape anchor by 8px at either edge, leaving the selected shape visible",
    );
    globeCases += 1;
  }
  dependencies.mapItems = mapItems;
  dependencies.selected = dokdoItem;
  dependencies.selectedShape = dependencies.highlightedShape = null;
  dependencies.highlightedArea = false;
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
    dokdoLabel(),
    undefined,
    "The old name is hidden and no longer interactive on the back hemisphere",
  );
  assert.equal(halo.hidden, true);
  if (width === 356 || width === 920) {
    const provinces = ["korea", "world"].flatMap((subject) =>
      JSON.parse(
        readFileSync(`src/data/atlas/areas-${subject}.json`, "utf8"),
      ).features.filter((feature) => feature.properties.regionId),
    );
    assert(
      provinces.length > 8,
      "Korean and world region geometries are represented",
    );
    dependencies.mapItems = [];
    dependencies.selected = undefined;
    dependencies.detailOpen = false;
    dependencies.provinceDetailOpen = false;
    dependencies.highlightedArea = true;
    for (const province of provinces) {
      dependencies.provinceArea = dependencies.highlightedShape = province;
      state.viewRef.current = globe.focusGlobeView(
        globe.GLOBE_INITIAL_VIEW,
        geography.geoCentroid(province),
      );
      arcs.length = 0;
      evaluate(sphere.draw, dependencies)();
      const provinceLabel = labels.find(
        (group) =>
          group.style.display !== "none" &&
          group.attributes["data-globe-region"] ===
            province.properties.regionId,
      );
      assert(
        provinceLabel,
        `${province.properties.name}/${width}: the selected region has an accessible area badge even with no listed places`,
      );
      assert.equal(provinceLabel.attributes.tabindex, "0");
      assert.equal(
        provinceLabel.children[1].textContent,
        province.properties.name,
      );
      assert.equal(
        arcs.length,
        0,
        "A regional selection must not invent a central dot",
      );
      assert.equal(
        halo.hidden,
        true,
        "A regional selection has no point ripple",
      );
      assert(
        dependencies.riverHaloRef.current.attributes.d?.length,
        `${province.properties.name}: the actual region boundary is highlighted`,
      );
      globeCases += 1;
    }
  }
  globeCases += 3;
}

let opened;
evaluate(flat.expression("focusPlace"), {
  setCountryId: () => {},
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
  traditionalArea: null,
  subregionId: "",
  query: "different query",
  ...atlas,
  ...regions,
  ...areaModel,
  areaGeometry: null,
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
      "CountryId",
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
      "ProvinceDetailOpen",
      "SelectedCountryId",
      "Camera",
    ].map((key) => [
      `set${key}`,
      (value) => {
        globeState[key] = value;
      },
    ]),
  ),
});
evaluate(sphere.labelClick, { chooseEntry })({
  currentTarget: { dataset: { globeLabel: dokdoItem.entry.id } },
});
assert.equal(
  globeState.Subject,
  "korea",
  "Globe name opens Korean history rather than relabelling it as world history",
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
  hitGeography: { current: () => undefined },
  chooseEntry: (entryId) => {
    pointEntry = entryId;
  },
  commitView: () => {},
})({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
assert.equal(
  pointEntry,
  dokdoItem.entry.id,
  "The actual globe point uses the same filter-aware entry route as its name",
);
const representativeItems = [
  dokdoItem,
  items.find((item) => item.place.name === "한강"),
  items.find((item) => item.place.name === "인천"),
];
for (const item of representativeItems) {
  assert(item, "Representative point, river and city labels exist");
  let chosen;
  const focusPlace = (id) => {
    chosen = id;
  };
  for (const handler of [flat.labelClick, flat.pointClick]) {
    evaluate(handler, { point: { place: item.place }, focusPlace })();
    assert.equal(
      chosen,
      item.place.id,
      "Flat name and point select the same location",
    );
  }
  const event = {
    currentTarget: { dataset: { globeLabel: item.entry.id } },
    preventDefault() {
      this.prevented = true;
    },
  };
  const chooseEntry = (id) => {
    chosen = id;
  };
  evaluate(sphere.labelClick, { chooseEntry })(event);
  assert.equal(
    chosen,
    item.entry.id,
    "Any globe name selects its actual entry",
  );
  for (const key of ["Enter", " "]) {
    chosen = undefined;
    const keyboard = { ...event, key };
    evaluate(sphere.labelKeyDown, { chooseEntry })(keyboard);
    assert.equal(chosen, item.entry.id, "Globe labels support Enter and Space");
    assert(
      keyboard.prevented,
      "Space must not scroll while selecting a globe label",
    );
  }
  chosen = undefined;
  evaluate(sphere.labelKeyDown, { chooseEntry })({
    ...event,
    key: "ArrowDown",
  });
  assert.equal(chosen, undefined, "Other keys must not select a label");
}
let provinceOpens = 0;
const regionEvent = {
  currentTarget: { dataset: { globeRegion: "gyeonggi" } },
  preventDefault() {},
};
const openProvinceDetails = () => {
  provinceOpens += 1;
};
evaluate(sphere.labelClick, { openProvinceDetails })(regionEvent);
for (const key of ["Enter", " "])
  evaluate(sphere.labelKeyDown, { openProvinceDetails })({
    ...regionEvent,
    key,
  });
assert.equal(
  provinceOpens,
  3,
  "Province names open their explanation through click, Enter and Space",
);
const provinceState = {};
evaluate(flat.provinceClick, {
  setProvinceDetailOpen: (value) => {
    provinceState.province = value;
  },
  setDetailOpen: (value) => {
    provinceState.detail = value;
  },
})();
assert.equal(provinceState.province, true);
assert.equal(provinceState.detail, true);
// A name can visually sit near a different location's dot. The capture-phase
// nearest-dot shortcut must preserve the name button's own selection handler.
for (const className of [
  "history-atlas__point-label",
  "history-atlas__province-label",
  "history-atlas__dot",
]) {
  let nearest;
  class Element {
    closest(selector) {
      return selector
        .split(",")
        .map((value) => value.trim())
        .includes(`.${className}`)
        ? this
        : null;
    }
  }
  evaluate(flat.mapClickCapture, {
    Element,
    movedRef: { current: false },
    mapPoints: [{ x: 100, y: 100, place: { id: "nearby-dot" } }],
    focusPlace: (id) => {
      nearest = id;
    },
  })({
    detail: 1,
    target: new Element(),
    clientX: 100,
    clientY: 100,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(
    nearest,
    className === "history-atlas__dot" ? "nearby-dot" : undefined,
    "Label activation cannot be intercepted by a neighboring dot",
  );
}
console.log(
  `Atlas label UI checks passed: ${flatCases} crowded flat layouts, ${globeCases} actual globe draw states, Korean/world scope, filter-independent Dokdo name, common point/name selection, keyboard selection, active-only badge, ripple and backside visibility.`,
);
