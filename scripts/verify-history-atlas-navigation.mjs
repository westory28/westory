import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";
import * as geography from "d3-geo";
import "./verify-history-atlas-dokdo-ui.mjs";

const cache = new Map();
const load = (filename) => {
  const path = resolve(filename);
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
      require(name) {
        if (name.endsWith("?url")) return { default: name };
        return name === "d3-geo"
          ? geography
          : load(resolve(dirname(path), `${name}.ts`));
      },
    },
    { filename: path },
  );
  return exports;
};
const atlasContent = load("src/data/historyAtlasContent.ts");
const dataset = atlasContent.historyAtlasDataset;
// Geometry source coverage survives the stricter set shown in the public UI.
const sourceDataset = atlasContent.historyAtlasSourceDataset || dataset;
const { findAtlasRiver, atlasFocusExtent, atlasRiverPath } = load(
  "src/lib/historyAtlasRivers.ts",
);
const { getAtlasPlaceProfile } = load("src/lib/historyAtlasProfiles.ts");
const { ATLAS_SUBJECT_BOUNDS } = load("src/lib/historyAtlas.ts");
const {
  createAtlasProjection,
  fitAtlasSelection,
  includeAtlasContextBounds,
  reframeAtlasSelectionBounds,
  atlasRegionCameraBounds,
  withAtlasDokdoLand,
} = load("src/lib/historyAtlasGeometry.ts");
const { ATLAS_KOREA_PROVINCES, ATLAS_WORLD_REGION_GROUPS, matchesAtlasRegion } =
  load("src/lib/historyAtlasRegions.ts");
const read = (file) =>
  JSON.parse(readFileSync(`src/data/atlas/${file}`, "utf8"));
const supplement = read("rivers-supplement.json");
const rivers = {
  type: "FeatureCollection",
  features: [
    ...read("rivers-korea.json").features,
    ...read("rivers-world.json").features,
    ...supplement.features,
  ],
};
const place = (name) => {
  const item = sourceDataset.places.find((item) => item.name === name);
  assert(item, name);
  return item;
};

// Physical map/popup rectangles for the bottom-left layout. Keep these fixtures
// independent of the component's viewport calculation: the assertions below
// check projected geography against the actual card and visible map, not just
// whether the production branch chose the same numbers as another copy of it.
// Compact maps are 480px tall (42% card cap); wide maps are 640px (55%).
// Cards are 8px from the left and 28px above the map bottom; below 344px map
// width they rise to 84px so the four-direction compass remains visible. A wide layout
// can still have a narrow map after its sidebar takes space (the 624px case).
const popupViewports = [
  {
    name: "compact-286",
    width: 286,
    mapHeight: 480,
    popup: { left: 8, top: 194.4, right: 278, bottom: 396 },
    focus: { height: 186.4 },
  },
  {
    name: "compact-343",
    width: 343,
    mapHeight: 480,
    popup: { left: 8, top: 194.4, right: 288, bottom: 396 },
    focus: { height: 186.4 },
  },
  {
    name: "compact-344",
    width: 344,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 242.4 },
  },
  {
    name: "compact-356",
    width: 356,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 242.4 },
  },
  {
    name: "compact-640",
    width: 640,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 242.4 },
  },
  {
    name: "compact-649",
    width: 649,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 242.4 },
  },
  {
    name: "compact-650",
    width: 650,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 448, overlayRight: 288 },
  },
  {
    name: "compact-720",
    width: 720,
    mapHeight: 480,
    popup: { left: 8, top: 250.4, right: 288, bottom: 452 },
    focus: { height: 448, overlayRight: 288 },
  },
  {
    name: "wide-narrow-map-624",
    width: 624,
    mapHeight: 640,
    popup: { left: 8, top: 260, right: 328, bottom: 612 },
    focus: { height: 252 },
  },
  {
    name: "wide-920",
    width: 920,
    mapHeight: 640,
    popup: { left: 8, top: 260, right: 328, bottom: 612 },
    focus: { height: 608, overlayRight: 328 },
  },
];
const intersects = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
for (const viewport of popupViewports) {
  const compass = {
    left: viewport.width - 56,
    right: viewport.width - 8,
    top: viewport.mapHeight - 76,
    bottom: viewport.mapHeight - 28,
  };
  assert(
    !intersects(viewport.popup, compass),
    `${viewport.name}: description must leave the compass visible`,
  );
}
const assertVisibleSelection = (box, viewport, label) => {
  const { width, mapHeight, popup, focus } = viewport;
  assert(
    Object.values(box).every(Number.isFinite) &&
      box.left >= 24 - 1e-6 &&
      box.right <= width - 24 + 1e-6 &&
      box.top >= 24 - 1e-6 &&
      box.bottom <= mapHeight - 24 + 1e-6,
    `${label}/${viewport.name}: selection leaves the physical map, ${JSON.stringify(box)}`,
  );
  assert(
    box.left >= (focus.overlayRight || 0) + 24 - 1e-6 &&
      box.bottom <= focus.height - 24 + 1e-6,
    `${label}/${viewport.name}: selection leaves the popup-free area, ${JSON.stringify(box)}`,
  );
  assert(
    !intersects(box, popup),
    `${label}/${viewport.name}: geography is hidden behind the bottom-left popup`,
  );
};

// The globe and world atlas load this layer only. A Korean-layer union would
// conceal missing world watercourses even though their points remain visible.
const worldLayer = {
  type: "FeatureCollection",
  features: [...read("rivers-world.json").features, ...supplement.features],
};
for (const name of ["우수리강", "화이허강", "위강", "잠베지강"]) {
  const matched = findAtlasRiver(place(name), worldLayer);
  assert(
    matched?.features.length,
    `${name}: world+supplement must supply the watercourse without a Korean-layer fallback`,
  );
}

for (const name of [
  "한강",
  "남한강",
  "낙동강",
  "압록강",
  "두만강",
  "대동강",
  "금강",
  "섬진강",
  "청천강",
  "예성강",
  "나일강",
  "황허강",
  "창장강",
  "티그리스강",
  "유프라테스강",
  "잠베지강",
]) {
  const item = place(name),
    river = findAtlasRiver(item, rivers);
  assert(river?.features.length, `${name}: missing evidenced watercourse`);
  assert(
    river.features.every((feature) =>
      ["LineString", "MultiLineString"].includes(feature.geometry.type),
    ),
    `${name}: invalid river geometry`,
  );
  const extent = atlasFocusExtent(item, "korea", river);
  const [[west, south], [east, north]] = geography.geoBounds(river);
  assert(
    extent[0] <= west &&
      extent[2] >= east &&
      extent[1] <= south &&
      extent[3] >= north,
    `${name}: full watercourse must fit selection extent`,
  );
  const path = atlasRiverPath(river, geography.geoMercator().scale(100));
  assert(
    path.length > 20 && !path.includes("NaN"),
    `${name}: invalid projected path`,
  );
}
const han = findAtlasRiver(place("한강"), rivers);
const [[hanWest, hanSouth], [hanEast, hanNorth]] = geography.geoBounds(han);
assert(
  hanWest > 123 && hanEast < 132 && hanSouth > 32 && hanNorth < 44,
  "Han must not include Chinese/Vietnamese rivers of the same name",
);
assert(
  han.features.some((feature) => feature.properties.name === "남한강"),
  "Han selection must include the named upstream main stem",
);
assert.equal(
  findAtlasRiver(
    { id: "unknown", name: "백강", kind: "water", coordinates: null },
    rivers,
  ),
  null,
  "An uncertain historical river must not acquire an invented course",
);
assert.equal(
  findAtlasRiver(place("백두산"), rivers),
  null,
  "A mountain is not a river",
);
const mountainExtent = atlasFocusExtent(place("백두산"), "korea");
assert(
  mountainExtent[2] - mountainExtent[0] === 3 &&
    mountainExtent[3] - mountainExtent[1] === 3,
  "Korean point selection must zoom into a three-degree regional context",
);

// The previous +/-80 degree cap never contained three actual northern places,
// so selection repeatedly allocated the same bounds and reset the camera.
const polarPlaces = sourceDataset.places.filter(
  (item) => item.coordinates && Math.abs(item.coordinates[1]) > 75,
);
assert(
  polarPlaces.some((item) => item.name === "북극해"),
  "Polar regression must exercise the actual Arctic Ocean entry",
);
let polarCameraCases = 0;
for (const item of polarPlaces) {
  const baseBounds = ATLAS_SUBJECT_BOUNDS.world;
  const extent = atlasFocusExtent(item, "world");
  let bounds = baseBounds;
  let updates = 0;
  for (; updates < 4; updates += 1) {
    const reframed = reframeAtlasSelectionBounds(
      "world",
      item.coordinates,
      bounds,
      baseBounds,
    );
    const next = includeAtlasContextBounds(reframed, extent);
    if (next === bounds) break;
    bounds = next;
  }
  assert(updates < 4, `${item.name}: selection bounds must converge`);
  assert(
    item.coordinates[0] >= bounds[0] &&
      item.coordinates[0] <= bounds[2] &&
      item.coordinates[1] >= bounds[1] &&
      item.coordinates[1] <= bounds[3],
    `${item.name}: reframed bounds must contain the actual polar coordinate`,
  );
  for (const viewport of popupViewports) {
    const { width, mapHeight, focus } = viewport;
    const projection = createAtlasProjection("world", bounds, width, mapHeight);
    const camera = fitAtlasSelection(
      projection,
      { coordinates: item.coordinates, contextBounds: extent },
      { width, mapHeight, ...focus },
    );
    const point = projection(item.coordinates);
    const x = point[0] * camera.scale + camera.x;
    const y = point[1] * camera.scale + camera.y;
    assertVisibleSelection(
      { left: x, top: y, right: x, bottom: y },
      viewport,
      `${item.name}: polar selection`,
    );
    polarCameraCases += 1;
  }
}

let cameraCases = 0;
for (const name of ["나일강", "창장강", "아마존강", "한강", "백두산"]) {
  const item = place(name);
  const river = findAtlasRiver(item, rivers);
  const subject = name === "한강" || name === "백두산" ? "korea" : "world";
  const extent = atlasFocusExtent(item, subject, river);
  const coordinates = river ? geography.geoCentroid(river) : item.coordinates;
  const initialBounds = [
    ATLAS_SUBJECT_BOUNDS[subject],
    ...(subject === "korea"
      ? sourceDataset.units
          .filter((unit) => unit.subject === subject)
          .map((unit) => unit.bounds)
      : []),
  ];
  for (const baseBounds of initialBounds)
    for (const viewport of popupViewports) {
      const { width, mapHeight, focus } = viewport;
      const bounds = includeAtlasContextBounds(baseBounds, extent);
      const projection = createAtlasProjection(
        subject,
        bounds,
        width,
        mapHeight,
      );
      const originalProjection = [
        projection.scale(),
        ...projection.translate(),
        ...projection.rotate(),
      ];
      const camera = fitAtlasSelection(
        projection,
        { coordinates, contextBounds: extent, geometry: river },
        { width, mapHeight, ...focus },
      );
      const object = river || {
        type: "MultiPoint",
        coordinates: [
          [extent[0], extent[1]],
          [extent[2], extent[1]],
          [extent[0], extent[3]],
          [extent[2], extent[3]],
        ],
      };
      const [[left, top], [right, bottom]] = geography
        .geoPath(projection)
        .bounds(object)
        .map(([x, y]) => [
          x * camera.scale + camera.x,
          y * camera.scale + camera.y,
        ]);
      assertVisibleSelection(
        { left, top, right, bottom },
        viewport,
        `${name}: full watercourse or regional context`,
      );
      assert(
        camera.scale >= 0.5 &&
          camera.scale <= 12 &&
          Object.values(camera).every(Number.isFinite),
        `${name}: valid bounded camera`,
      );
      assert.deepEqual(
        [projection.scale(), ...projection.translate(), ...projection.rotate()],
        originalProjection,
        `${name}: fitting must preserve the shared geographical projection`,
      );
      cameraCases += 1;
    }
}
// Keep the actual 480/640px projection height even when only the area above or
// beside the popup is available. Using the shortened focus height for pan limits
// previously clamped southern locations (Jeju and Cape Town) under the card.
let popupCameraCases = 0;
const popupPlacesChecked = new Set();
for (const subject of ["korea", "world"]) {
  const subjectUnits = new Set(
    dataset.units
      .filter((unit) => unit.subject === subject)
      .map((unit) => unit.id),
  );
  const subjectPlaceIds = new Set(
    dataset.entries
      .filter((entry) => subjectUnits.has(entry.unitId))
      .map((entry) => entry.placeId),
  );
  const subjectRivers = {
    type: "FeatureCollection",
    features: [
      ...read(`rivers-${subject}.json`).features,
      ...supplement.features,
    ],
  };
  for (const item of dataset.places.filter(
    (item) => subjectPlaceIds.has(item.id) && item.coordinates,
  )) {
    const river = findAtlasRiver(item, subjectRivers);
    const coordinates = river ? geography.geoCentroid(river) : item.coordinates;
    const extent = atlasFocusExtent(item, subject, river);
    const baseBounds = ATLAS_SUBJECT_BOUNDS[subject];
    const bounds = includeAtlasContextBounds(
      reframeAtlasSelectionBounds(subject, coordinates, baseBounds, baseBounds),
      extent,
    );
    for (const viewport of popupViewports) {
      const { width, mapHeight, focus, popup } = viewport;
      const projection = createAtlasProjection(
        subject,
        bounds,
        width,
        mapHeight,
      );
      const camera = fitAtlasSelection(
        projection,
        { coordinates, contextBounds: extent, geometry: river },
        { width, mapHeight, ...focus },
      );
      const point = projection(coordinates);
      const x = point[0] * camera.scale + camera.x;
      const y = point[1] * camera.scale + camera.y;
      assertVisibleSelection(
        { left: x, top: y, right: x, bottom: y },
        viewport,
        `${subject}/${item.name}: selected point`,
      );
      assert(
        !intersects(
          { left: x - 22, top: y - 22, right: x + 22, bottom: y + 22 },
          popup,
        ),
        `${subject}/${item.name}/${viewport.name}: the selected 44px hit target must not fall behind the popup`,
      );
      assert(
        camera.scale >= 0.5 &&
          camera.scale <= 12 &&
          Object.values(camera).every(Number.isFinite),
        `${subject}/${item.name}: popup camera remains finite and bounded`,
      );
      popupCameraCases += 1;
    }
    popupPlacesChecked.add(item.name);
  }
}
for (const name of [
  "제주도",
  "상하이",
  "케이프타운",
  "포토시",
  "북극해",
].filter((name) => dataset.places.some((item) => item.name === name))) {
  assert(
    popupPlacesChecked.has(name),
    `${name}: popup regression must include the real extreme-position place`,
  );
}
// A region camera must contain every listed located place, not merely the first
// 가나다 row. Include the real province/group hierarchy at narrow and wide sizes.
let regionCameraCases = 0;
for (const subject of ["korea", "world"]) {
  const unitIds = new Set(
    dataset.units
      .filter((unit) => unit.subject === subject)
      .map((unit) => unit.id),
  );
  const ids = new Set(
    dataset.entries
      .filter((entry) => unitIds.has(entry.unitId))
      .map((entry) => entry.placeId),
  );
  const regions =
    subject === "korea"
      ? ATLAS_KOREA_PROVINCES.map((region) => [region.id, ""])
      : ATLAS_WORLD_REGION_GROUPS.flatMap((region) => [
          [region.id, ""],
          ...region.children.map((child) => [region.id, child.id]),
        ]);
  for (const [group, subregion] of regions) {
    const coordinates = dataset.places
      .filter(
        (place) =>
          ids.has(place.id) &&
          place.coordinates &&
          matchesAtlasRegion(place, subject, group, subregion),
      )
      .map((place) => place.coordinates);
    if (!coordinates.length) continue;
    for (const width of [286, 356, 640, 920]) {
      const bounds = atlasRegionCameraBounds(coordinates, subject);
      const projection = createAtlasProjection(subject, bounds, width, 480);
      for (const coordinate of coordinates) {
        const point = projection(coordinate);
        assert(
          point &&
            point[0] >= 24 &&
            point[0] <= width - 24 &&
            point[1] >= 32 &&
            point[1] <= 448,
          `${subject}/${group}/${subregion}/${width}: listed place ${coordinate} leaves region camera`,
        );
        regionCameraCases += 1;
      }
    }
  }
}
assert.equal(
  atlasRegionCameraBounds([], "korea"),
  null,
  "Empty filters cannot reuse an old point as their region extent",
);
for (const subject of ["korea", "world"]) {
  const coordinates = [
    [179, 10],
    [-179, 11],
  ];
  const bounds = atlasRegionCameraBounds(coordinates, subject);
  assert(
    bounds[2] - bounds[0] < 5,
    "Date-line neighbors must stay in one narrow camera extent",
  );
  const projection = createAtlasProjection(subject, bounds, 356, 480);
  for (const coordinate of coordinates) {
    const [x, y] = projection(coordinate);
    assert(
      x >= 24 && x <= 332 && y >= 32 && y <= 448,
      "Both sides of the date line must remain visible",
    );
  }
}

// Execute the actual region-change handler with state adapters. A stale search
// must not suppress a new region, while explicit unit/era choices remain active.
const atlasSource = readFileSync(
  "src/components/common/HistoryAtlas.tsx",
  "utf8",
);
const atlasAst = ts.createSourceFile(
  "HistoryAtlas.tsx",
  atlasSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let changeScopeSource;
const findChangeScope = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(atlasAst) === "changeScope"
  )
    changeScopeSource = node.initializer.getText(atlasAst);
  ts.forEachChild(node, findChangeScope);
};
findChangeScope(atlasAst);
assert(changeScopeSource, "Real region-change handler is exercised");
const fixturePlace = (id, coordinates) => ({ id, coordinates, name: id });
const regionFixture = [
  {
    entry: { id: "jeolla-a", unitId: "chosen-unit", eraIds: ["chosen-era"] },
    place: fixturePlace("a", [126.8, 35.1]),
  },
  {
    entry: { id: "jeolla-b", unitId: "chosen-unit", eraIds: ["chosen-era"] },
    place: fixturePlace("b", [127.2, 35.8]),
  },
  {
    entry: { id: "wrong-unit", unitId: "other-unit", eraIds: ["chosen-era"] },
    place: fixturePlace("c", [129, 37]),
  },
  {
    entry: { id: "wrong-era", unitId: "chosen-unit", eraIds: ["other-era"] },
    place: fixturePlace("d", [129, 38]),
  },
];
for (const empty of [false, true]) {
  const state = {};
  const scopeExports = {};
  const pendingFocusRef = { current: "old-place" };
  vm.runInNewContext(
    ts.transpileModule(`exports.changeScope = ${changeScopeSource}`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports: scopeExports,
      subject: "korea",
      unitId: "chosen-unit",
      eraId: "chosen-era",
      regionId: "gyeonggi",
      subregionId: "",
      query: "old search",
      selected: undefined,
      subjectEntries: empty ? [] : regionFixture,
      pendingFocusRef,
      matchesAtlasRegion: () => true,
      atlasRegionCameraBounds,
      searchEntries: (items, query) => {
        assert.equal(
          query,
          "",
          "Region navigation clears the previous query before matching",
        );
        return items;
      },
      requestPlaceFocus: () =>
        assert.fail("A region view must not select its first row"),
      resetMap: () => {
        state.reset = true;
      },
      ...Object.fromEntries(
        [
          "ListPage",
          "Query",
          "UnitId",
          "EraId",
          "RegionId",
          "SubregionId",
          "FilterNotice",
          "SelectedId",
          "DetailOpen",
          "ViewBounds",
        ].map((key) => [
          `set${key}`,
          (value) => {
            state[key] = value;
          },
        ]),
      ),
    },
  );
  scopeExports.changeScope("chosen-unit", "chosen-era", "jeolla", "");
  assert.equal(state.Query, "");
  assert.equal(state.UnitId, "chosen-unit");
  assert.equal(state.EraId, "chosen-era");
  assert.equal(state.SelectedId, "");
  assert.equal(state.DetailOpen, false);
  assert.equal(pendingFocusRef.current, null);
  assert.equal(state.reset, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.ViewBounds)),
    empty
      ? null
      : JSON.parse(
          JSON.stringify(
            atlasRegionCameraBounds(
              regionFixture.slice(0, 2).map((item) => item.place.coordinates),
              "korea",
            ),
          ),
        ),
  );
}
const profile = getAtlasPlaceProfile(place("백두산"));
assert(
  profile.definition.includes("화산") && profile.definition.includes("천지"),
  "Baekdu needs a real definition",
);
assert(
  profile.facts.length >= 3 && profile.sources.length > 0,
  "Baekdu needs explained facts and provenance",
);
assert(
  !getAtlasPlaceProfile({
    id: "unverified",
    name: "자금성",
    aliases: ["베이징"],
    kind: "site",
    coordinates: null,
  }).definition.includes("중국의 수도"),
  "A search alias cannot replace the place identity",
);
assert(
  gzipSync(readFileSync("src/data/atlas/rivers-supplement.json")).length <
    160 * 1024,
  "Supplemental watercourse traffic budget exceeded",
);
const globeBytes = readFileSync("src/data/atlas/land-globe.json");
assert(
  gzipSync(globeBytes).length < 64 * 1024,
  "Globe terrain must remain separately small",
);
const dokdoBytes = readFileSync("src/data/atlas/dokdo-islands.json");
const dokdoIslands = JSON.parse(dokdoBytes);
const dokdoSources = read("dokdo-islands.sources.json");
assert.equal(
  createHash("sha256").update(dokdoBytes).digest("hex"),
  dokdoSources.assetSha256,
);
assert.equal(dokdoSources.license, "ODbL 1.0");
assert(
  gzipSync(dokdoBytes).length < 24 * 1024,
  "Dokdo coastline transfer budget",
);
const dokdoEast = [131 + 52 / 60 + 10.4 / 3600, 37 + 14 / 60 + 26.8 / 3600];
const dokdoWest = [131 + 51 / 60 + 54.6 / 3600, 37 + 14 / 60 + 30.6 / 3600];
for (const officialPoint of [dokdoEast, dokdoWest])
  assert(
    geography.geoContains(dokdoIslands, officialPoint),
    "Official island point lies on the coastline asset",
  );
// Catch reversed spherical winding or artificially enlarged island shapes.
const dokdoArea = geography.geoArea(dokdoIslands) * 6371008.8 ** 2;
assert(
  dokdoArea > 170000 && dokdoArea < 210000,
  "Dokdo coastline preserves its real geographic scale",
);
for (const file of ["land-korea.json", "land-world.json", "land-globe.json"]) {
  const original = read(file);
  const before = JSON.stringify(original);
  const merged = withAtlasDokdoLand(original, dokdoIslands);
  assert.equal(
    JSON.stringify(original),
    before,
    "Source terrain remains unmodified",
  );
  for (const coordinates of [dokdoEast, dokdoWest])
    assert(
      geography.geoContains(merged, coordinates),
      `${file}: both Dokdo islands exist`,
    );
  for (const coordinates of [
    [127, 37],
    [139.7, 35.7],
    [128, 38],
    [135, 36],
  ])
    assert.equal(
      geography.geoContains(merged, coordinates),
      geography.geoContains(original, coordinates),
      `${file}: unrelated land and sea are unchanged`,
    );
}
console.log(
  `Dokdo geography checks passed: ${dokdoIslands.features.length} source coastline polygons, official east/west points, realistic area, all map layers, attribution and payload budget.`,
);
console.log(
  `Atlas navigation checks passed: ${supplement.features.length} supplemental river features, ${cameraCases} full-geometry camera fits, ${polarCameraCases} polar camera fits, ${popupCameraCases} real-place camera fits across ${popupViewports.length} bottom-left popup layouts, ${regionCameraCases} region camera fits, region handler state transitions, full river extents, conservative selection scale, verified definition, no alias identity substitution. Globe SHA256 ${createHash("sha256").update(globeBytes).digest("hex").slice(0, 12)}.`,
);
