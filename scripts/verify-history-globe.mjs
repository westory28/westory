import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { geoOrthographic, geoArea, geoContains } from "d3-geo";
import * as d3Geography from "d3-geo";
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
      URLSearchParams,
      require: (name) => {
        if (name === "d3-geo") return d3Geography;
        if (name.endsWith("?url")) return { default: name };
        assert(name.startsWith("."));
        return load(resolve(dirname(path), name + ".ts"));
      },
    },
  );
  return exports;
};
const m = load("src/lib/historyGlobeMath.ts");
const { atlasProjectedNorthBearing, fitGlobeRegionCamera } = load(
  "src/lib/historyAtlasGeometry.ts",
);
const equal = (actual, expected) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
equal(
  m.constrainGlobeView({ longitude: 541, latitude: 95, roll: -365, zoom: 100 }),
  { longitude: -179, latitude: 89.5, roll: -5, zoom: 6 },
);
equal(
  m.constrainGlobeView({
    longitude: NaN,
    latitude: Infinity,
    roll: NaN,
    zoom: NaN,
  }),
  { longitude: 0, latitude: 0, roll: 0, zoom: 1 },
);
const datelineStart = { longitude: 179, latitude: 20, roll: 170, zoom: 1 };
const datelineEnd = { longitude: -179, latitude: 40, roll: -170, zoom: 4 };
equal(m.interpolateGlobeView(datelineStart, datelineEnd, 0), datelineStart);
equal(m.interpolateGlobeView(datelineStart, datelineEnd, 1), datelineEnd);
equal(m.interpolateGlobeView(datelineStart, datelineEnd, 0.5), {
  longitude: -180,
  latitude: 30,
  roll: -180,
  zoom: 2,
});
for (const center of [
  [127, 37],
  [-77, 39],
  [179, 0],
  [-179, 0],
  [0, 85],
]) {
  const camera = m.focusGlobeView(m.GLOBE_INITIAL_VIEW, center);
  const projection = geoOrthographic()
    .translate([300, 200])
    .scale(180)
    .rotate([-camera.longitude, -camera.latitude, camera.roll]);
  const xy = projection(center);
  assert(
    Math.abs(xy[0] - 300) < 1e-8 && Math.abs(xy[1] - 200) < 1e-8,
    "Selected place must reach globe center",
  );
  assert(m.isGlobePointVisible(center, camera));
  assert(
    !m.isGlobePointVisible(
      [m.wrapGlobeLongitude(center[0] + 180), -center[1]],
      camera,
    ),
    "Backside pin must be hidden",
  );
}
assert(
  m.isGlobePointVisible([-179, 0], {
    longitude: 179,
    latitude: 0,
    roll: 0,
    zoom: 1,
  }),
  "Dateline adjacent places remain nearby",
);
assert(
  !m.isGlobePointVisible([90, 0], {
    longitude: 0,
    latitude: 0,
    roll: 0,
    zoom: 1,
  }),
  "Horizon pins excluded",
);
const start = { longitude: 0, latitude: 0, roll: 0, zoom: 1 };
const dragged = m.dragGlobeView(start, 100, 50, 200);
assert(
  dragged.longitude < 0 && dragged.latitude > 0,
  "Dragging surface right/down must reveal west/north",
);
equal(m.dragGlobeView(start, 0, 0, 200), start);
for (const roll of [-160, -90, -30, 0, 45, 90, 170]) {
  const camera = m.dragGlobeView({ ...start, roll }, 1, 2, 200);
  const xy = geoOrthographic()
    .translate([0, 0])
    .scale(200)
    .rotate([-camera.longitude, -camera.latitude, camera.roll])([0, 0]);
  assert(
    Math.abs(xy[0] - 1) < 0.001 && Math.abs(xy[1] - 2) < 0.001,
    "Dragging follows the finger after compass rotation",
  );
}
const fingers = [
  { x: -20, y: 0 },
  { x: 20, y: 0 },
];
const spread = m.pinchGlobeView(
  start,
  fingers,
  [
    { x: -40, y: 0 },
    { x: 40, y: 0 },
  ],
  200,
);
assert.equal(spread.zoom, 2, "Pinch-out doubles zoom");
const twisted = m.pinchGlobeView(
  start,
  fingers,
  [
    { x: 0, y: -20 },
    { x: 0, y: 20 },
  ],
  200,
);
assert.equal(
  twisted.roll,
  -90,
  "Clockwise fingers rotate the projection clockwise",
);
const twistedPoint = geoOrthographic()
  .translate([0, 0])
  .scale(200)
  .rotate([0, 0, twisted.roll])([10, 0]);
assert(
  twistedPoint[1] > 0 && Math.abs(twistedPoint[0]) < 1e-8,
  "East point follows clockwise fingers downward",
);
for (const width of [358, 736, 1248, 10000])
  for (const height of [400, 640, 10000])
    for (const dpr of [1, 2, 3, Infinity]) {
      const size = m.globeCanvasSize(width, height, dpr);
      assert(
        size.pixelWidth * size.pixelHeight <= m.GLOBE_PIXEL_BUDGET,
        "Pixel budget",
      );
      assert(size.dpr <= 2 && size.dpr > 0);
    }
const points = [
  { id: "near", x: 100, y: 100 },
  { id: "far", x: 140, y: 140 },
];
assert.equal(
  m.nearestGlobePoint(points, 121, 100)?.id,
  "near",
  "44px target diameter",
);
assert.equal(
  m.nearestGlobePoint(points, 123, 100),
  undefined,
  "Do not pick distant points",
);
assert.equal(m.nearestGlobePoint(points, 139, 140)?.id, "far");
const land = JSON.parse(readFileSync("src/data/atlas/land-globe.json", "utf8"));
assert.equal(land.type, "MultiPolygon");
assert(
  geoArea(land) > 0 && geoArea(land) < Math.PI * 2,
  "Correct globe winding, not inverted ocean",
);
assert(geoContains(land, [127, 37]), "Korean land retained");
assert(!geoContains(land, [-140, 0]), "Pacific is not filled as land");
const geographyAsset = readFileSync(
  "src/data/atlas/globe-geography.json",
  "utf8",
);
const geography = JSON.parse(geographyAsset);
const geographySource = JSON.parse(
  readFileSync("src/data/atlas/globe-geography-source.json", "utf8"),
);
assert.equal(
  createHash("sha256").update(geographyAsset).digest("hex"),
  geographySource.assetSha256,
  "Geography matches its source manifest",
);
assert(
  geographyAsset.length < 512 * 1024,
  "Globe geography remains a bounded lazy asset",
);
assert.equal(geographySource.license, "Public domain");
assert(
  Object.values(geographySource.sources).every(
    (source) =>
      source.url.includes(geographySource.revision) &&
      source.sha256.length === 64,
  ),
  "All source geometries have pinned revisions and hashes",
);
assert(
  geography.borders.coordinates.length > 200,
  "Modern country boundaries cover the globe",
);
assert(
  geography.disputedBorders.coordinates.length > 0,
  "Disputed and control lines remain separate from ordinary boundaries",
);
assert(
  geography.rivers.coordinates.length > 100,
  "Base waterways remain available without selecting a river",
);
assert(
  geoContains(geography.deserts, [15, 24]),
  "Sahara desert is in northern Africa",
);
assert(
  geoContains(geography.deserts, [106, 43]),
  "Gobi desert is in interior Asia",
);
assert(
  !geoContains(geography.deserts, [-140, 0]),
  "Desert winding does not fill the oceans",
);
for (const name of [
  "북태평양",
  "남태평양",
  "북대서양",
  "남대서양",
  "인도양",
  "사하라 사막",
  "고비 사막",
  "대한민국",
  "동해",
]) {
  assert(
    geography.labels.some((label) => label.name === name),
    `${name} has a Korean geography label`,
  );
}
assert(
  geography.labels.find((label) => label.name === "남극해").coordinates[1] <
    -60,
  "Polar label stays in the Southern Ocean, not its off-polygon spherical centroid",
);
assert(
  geography.labels.every(
    (label) =>
      /[가-힣]/u.test(label.name) &&
      label.coordinates.every(Number.isFinite) &&
      Math.abs(label.coordinates[0]) <= 180 &&
      Math.abs(label.coordinates[1]) <= 90,
  ),
  "Every geographic label uses a Korean name and valid coordinates",
);
const { MENUS, sanitizeMenuConfig } = load("src/constants/menus.ts");
for (const portal of ["student", "teacher"]) {
  const legacyUrl = "/" + portal + "/lesson/globe";
  const mapsUrl = "/" + portal + "/lesson/maps";
  assert.equal(
    MENUS[portal]
      .flatMap((item) => item.children || [])
      .find((item) => item.url === mapsUrl).name,
    "역사 지도",
    "Both portals use the same history-map menu name",
  );
  assert.equal(
    MENUS[portal]
      .flatMap((item) => item.children || [])
      .filter((item) => item.url === legacyUrl).length,
    0,
    "Globe is a map tab, not a separate sidebar item",
  );
  const old = JSON.parse(JSON.stringify(MENUS));
  const lessonMenu = old[portal].find((item) =>
    item.children?.some((child) => child.url === mapsUrl),
  );
  lessonMenu.children.push({ name: "기존 지구본", url: legacyUrl });
  const savedMap = lessonMenu.children.find((child) => child.url === mapsUrl);
  savedMap.name = "지도";
  savedMap.hidden = true;
  const migratedChildren = sanitizeMenuConfig(old)[portal].flatMap(
    (item) => item.children || [],
  );
  assert(
    !migratedChildren.some((item) => item.url === legacyUrl),
    "Saved menus shed the obsolete globe item",
  );
  assert.equal(
    migratedChildren.filter((item) => item.url === mapsUrl).length,
    1,
  );
  assert.equal(
    migratedChildren.find((item) => item.url === mapsUrl).hidden,
    true,
    "Existing map visibility is preserved",
  );
  assert.equal(
    migratedChildren.find((item) => item.url === mapsUrl).name,
    "역사 지도",
    "Saved legacy map labels receive the new name without changing their URL",
  );
  savedMap.name = "우리 반 지도 자료";
  assert.equal(
    sanitizeMenuConfig(old)
      [portal].flatMap((item) => item.children || [])
      .find((item) => item.url === mapsUrl).name,
    "우리 반 지도 자료",
    "Explicitly customized menu names stay intact",
  );
}
const { canAccessTeacherPath } = load("src/lib/permissions.ts");
for (const pathname of ["/teacher/lesson/globe", "/teacher/lesson/maps"]) {
  assert(
    canAccessTeacherPath(pathname, {
      role: "staff",
      teacherPortalEnabled: true,
      staffPermissions: ["lesson_read"],
    }),
  );
  assert(
    !canAccessTeacherPath(pathname, {
      role: "staff",
      teacherPortalEnabled: true,
      staffPermissions: ["quiz_read"],
    }),
  );
}
const { getStudentRouteAccess } = load("src/lib/studentMenuAccess.ts");
for (const view of ["korea", "world", "globe"]) {
  const target = { pathname: "/student/lesson/maps", search: `?view=${view}` };
  assert(getStudentRouteAccess(target, { showLesson: true }, MENUS).allowed);
  assert(!getStudentRouteAccess(target, { showLesson: false }, MENUS).allowed);
  const hidden = JSON.parse(JSON.stringify(MENUS));
  hidden.student
    .flatMap((item) => item.children || [])
    .find((item) => item.url === target.pathname).hidden = true;
  assert(
    !getStudentRouteAccess(
      target,
      { showLesson: true },
      sanitizeMenuConfig(hidden),
    ).allowed,
    "All map tabs respect hidden-map access",
  );
}

// Exercise the real wrapper with a small router adapter. The child maps are
// boundaries here: this checks actual navigation handlers without a DOM/canvas.
let location = {
  pathname: "/student/lesson/maps",
  search: "",
  key: "start",
  state: null,
};
let history = [{ ...location }];
let cursor = 0;
let sequence = 0;
const Atlas = () => null;
const Globe = () => null;
let lazyRegistrations = 0;
const wrapperExports = {};
let terrainPreference;
const dependencies = {
  react: {
    ...React,
    default: React,
    useState: (initial) => [
      (terrainPreference ??= initial),
      (value) => {
        terrainPreference =
          typeof value === "function" ? value(terrainPreference) : value;
      },
    ],
  },
  "react-router-dom": {
    useLocation: () => location,
    useSearchParams: () => [
      new URLSearchParams(location.search),
      (next, options = {}) => {
        location = {
          ...location,
          search: `?${next.toString()}`,
          key: `route-${++sequence}`,
          state: options.state ?? null,
        };
        if (options.replace) history[cursor] = { ...location };
        else {
          history = history.slice(0, cursor + 1);
          history.push({ ...location });
          cursor += 1;
        }
      },
    ],
  },
  "../../lib/lazyWithRetry": {
    lazyWithRetry: (importer, key) => {
      assert.equal(typeof importer, "function");
      assert.equal(key, "history-maps-globe");
      lazyRegistrations += 1;
      return Globe;
    },
  },
  "./HistoryAtlas": { default: Atlas },
  "./LoadingState": { InlineLoading: () => null },
};
const wrapperSource = readFileSync(
  "src/components/common/HistoryMaps.tsx",
  "utf8",
);
vm.runInNewContext(
  ts.transpileModule(wrapperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText,
  {
    exports: wrapperExports,
    URLSearchParams,
    require: (name) => {
      assert(
        Object.hasOwn(dependencies, name),
        `Unexpected eager map dependency: ${name}`,
      );
      return dependencies[name];
    },
  },
);
const renderMaps = () => wrapperExports.default({ dataset: {} });
const contentOf = (element) =>
  element.type === React.Suspense ? element.props.children : element;
const press = (element, label) =>
  contentOf(element)
    .props.navigation.props.children.find(
      (button) => button.props.children === label,
    )
    .props.onClick();
let rendered = renderMaps();
assert.equal(lazyRegistrations, 1);
assert.equal(rendered.type, Atlas, "Initial map never mounts the globe");
assert.equal(rendered.props.initialSubject, "korea");
assert.equal(rendered.props.showTerrain, false, "Terrain starts disabled");
assert.equal(rendered.props.toolbar.type, "button");
assert.equal(rendered.props.toolbar.props["aria-pressed"], false);
rendered.props.toolbar.props.onClick();
rendered = renderMaps();
assert.equal(rendered.props.showTerrain, true);
assert.equal(rendered.props.onOpenOriginals, undefined);
press(rendered, "세계사");
rendered = renderMaps();
assert.equal(rendered.props.initialSubject, "world");
assert.equal(
  rendered.props.showTerrain,
  true,
  "Flat view changes preserve terrain preference",
);
const worldKey = rendered.key;
press(rendered, "지구본");
rendered = renderMaps();
assert.equal(
  contentOf(rendered).props.showTerrain,
  true,
  "The globe shares the same terrain preference",
);
assert.equal(
  rendered.type,
  React.Suspense,
  "The globe has a lazy loading boundary",
);
assert.equal(contentOf(rendered).type, Globe);
assert.equal(contentOf(rendered).props.initialSubject, "all");
assert.equal(contentOf(rendered).props.onOpenOriginals, undefined);
assert(
  rendered.props.fallback.props.children[0],
  "Tab navigation remains available during loading",
);
location = { ...history[--cursor] };
rendered = renderMaps();
assert.equal(
  rendered.props.initialSubject,
  "world",
  "Back restores the subject from the URL",
);
assert.equal(rendered.key, worldKey);
location = { ...history[++cursor] };
assert.equal(contentOf(renderMaps()).type, Globe, "Forward restores the globe");
press(renderMaps(), "한국사");
rendered = renderMaps();
const koreanKey = rendered.key;
const historyLength = history.length;
rendered.props.onSubjectChange("world");
rendered = renderMaps();
assert.equal(rendered.props.initialSubject, "world");
assert.equal(
  rendered.key,
  koreanKey,
  "Related cross-subject stories retain their mounted selection",
);
assert.equal(
  history.length,
  historyLength,
  "A story switch replaces the URL without adding a tab navigation",
);
assert.equal(
  contentOf(rendered).props.navigation.props.children.find(
    (button) => button.props.children === "세계사",
  ).props["aria-pressed"],
  true,
);
location = { ...location, state: null, key: "refreshed" };
assert.equal(
  renderMaps().props.initialSubject,
  "world",
  "Refresh derives the selected subject from the URL",
);
location = {
  ...location,
  search: "?view=globe",
  state: null,
  key: "legacy-globe",
};
assert.equal(
  contentOf(renderMaps()).props.initialSubject,
  "all",
  "A globe link defaults to both history subjects",
);
for (const subject of ["korea", "world"]) {
  location = { ...location, search: `?view=globe&subject=${subject}` };
  assert.equal(
    contentOf(renderMaps()).props.initialSubject,
    subject,
    "An explicit subject URL retains its requested filter",
  );
}
location = { ...location, search: "?view=invalid", key: "invalid-view" };
assert.equal(
  renderMaps().props.initialSubject,
  "korea",
  "Invalid view values have a safe default",
);
const appSource = readFileSync("src/App.tsx", "utf8");
for (const wrapperPath of [
  "src/pages/student/lesson/Maps.tsx",
  "src/pages/teacher/ManageMaps.tsx",
]) {
  const portalWrapperSource = readFileSync(wrapperPath, "utf8");
  assert(
    !portalWrapperSource.includes("MapResources") &&
      !portalWrapperSource.includes("onOpenOriginals"),
    "Both map portals remove the retired original-resource entry",
  );
  assert(
    portalWrapperSource.includes(
      "<HistoryMaps dataset={historyAtlasDataset} />",
    ),
    "Both portals retain the shared atlas and globe navigation",
  );
}
for (const portal of ["student", "teacher"]) {
  assert(
    appSource.includes(`to="/${portal}/lesson/maps?view=globe"`),
    "Legacy route redirects to the map tab",
  );
  assert(
    !appSource.includes(
      `import("./pages/${portal}/${portal === "student" ? "lesson/" : ""}Globe")`,
    ),
    "Legacy routes cannot eagerly load a separate globe page",
  );
}
const source = readFileSync("src/components/common/HistoryGlobe.tsx", "utf8");
assert(source.includes('addEventListener("wheel", wheel, { passive: false })'));
assert(
  source.includes("visibilitychange") &&
    source.includes("IntersectionObserver"),
);
assert(!source.includes("setInterval("), "No idle animation or polling timer");
assert(
  !source.includes("GLOBE_FRAME_INTERVAL"),
  "Rotation follows the display frame instead of a forced 30fps timer",
);
for (const latitude of [-89.5, -60, 0, 37, 89.5]) {
  for (const longitude of [-179, 0, 127, 179]) {
    for (const roll of [-179, -90, -30, 0, 45, 90, 179]) {
      const projection = geoOrthographic()
        .translate([180, 240])
        .scale(200)
        .rotate([-longitude, -latitude, roll]);
      const bearing = atlasProjectedNorthBearing(projection, [
        longitude,
        latitude,
      ]);
      assert(
        Math.abs(m.wrapGlobeLongitude(bearing + roll)) < 1e-6,
        `Compass north follows screen roll at ${longitude}/${latitude}/${roll}`,
      );
    }
  }
}
assert.equal(fitGlobeRegionCamera([], 356, 480), null);
const regionFixtures = [
  {
    name: "전라도",
    coordinates: [
      [126.4, 34.7],
      [127.2, 35.8],
      [126.7, 35.6],
    ],
  },
  {
    name: "유럽",
    coordinates: [
      [-9, 39],
      [2, 49],
      [24, 60],
      [28, 42],
    ],
  },
  {
    name: "남아메리카",
    coordinates: [
      [-79, 9],
      [-71, -34],
      [-38, -13],
      [-68, -54],
    ],
  },
  {
    name: "날짜변경선",
    coordinates: [
      [179, 10],
      [-179, 11],
    ],
  },
  {
    name: "극지방",
    coordinates: [
      [-120, 85],
      [0, 85],
      [120, 85],
    ],
  },
];
let regionCameraCases = 0;
for (const region of regionFixtures) {
  for (const width of [286, 356, 640, 920]) {
    const camera = fitGlobeRegionCamera(region.coordinates, width, 480);
    assert(camera && Object.values(camera).every(Number.isFinite));
    const projection = geoOrthographic()
      .translate([width / 2, 240])
      .scale(Math.min(width, 480) * 0.44 * camera.zoom)
      .rotate([-camera.longitude, -camera.latitude, camera.roll]);
    for (const coordinate of region.coordinates) {
      assert(
        m.isGlobePointVisible(coordinate, camera),
        `${region.name}: listed point cannot stay on the back hemisphere`,
      );
      const [x, y] = projection(coordinate);
      assert(
        x >= 24 && x <= width - 24 && y >= 40 && y <= 440,
        `${region.name}/${width}: regional point is cropped by the camera`,
      );
      regionCameraCases += 1;
    }
  }
}

// Run the actual JSX region handler and selection callback with state adapters.
// This catches filtering/camera wiring regressions that pure projection checks do not.
const globeAst = ts.createSourceFile(
  "HistoryGlobe.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let regionHandler, chooseEntryHandler;
let globeCloseClick, globePopupKeyDown;
const globeDeclarations = new Map();
const globeEffects = [];
const visitGlobe = (node) => {
  if (ts.isVariableDeclaration(node) && node.initializer)
    globeDeclarations.set(node.name.getText(globeAst), node.initializer);
  if (ts.isFunctionDeclaration(node) && node.name)
    globeDeclarations.set(node.name.text, node);
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(globeAst) === "useEffect"
  )
    globeEffects.push(node);
  if (ts.isJsxOpeningElement(node)) {
    const attribute = (name) =>
      node.attributes.properties.find(
        (property) => property.name?.getText(globeAst) === name,
      )?.initializer;
    if (attribute("aria-label")?.text === "장소 설명 닫기")
      globeCloseClick = attribute("onClick").expression.getText(globeAst);
    if (attribute("className")?.text === "history-globe__popup")
      globePopupKeyDown = attribute("onKeyDown").expression.getText(globeAst);
  }
  ts.forEachChild(node, visitGlobe);
};
visitGlobe(globeAst);
const selectionViewport = evaluateGlobe(
  globeDeclarations.get("selectionViewport").getText(globeAst),
);
const popupResizeEffect = globeEffects.find((effect) =>
  effect.arguments[0].getText(globeAst).includes("observer.observe(popup)"),
);
assert(
  popupResizeEffect,
  "Collapsed source content must be observed for popup size changes",
);
let popupResize,
  disconnected = false;
const resizingPopup = { offsetWidth: 280, offsetHeight: 100 };
let popupSize = { width: 0, height: 0 };
const disposePopupObserver = evaluateGlobe(
  popupResizeEffect.arguments[0].getText(globeAst),
  {
    detailOpen: true,
    detailRef: { current: { parentElement: resizingPopup } },
    ResizeObserver: class {
      constructor(callback) {
        popupResize = callback;
      }
      observe(target) {
        assert.equal(target, resizingPopup);
      }
      disconnect() {
        disconnected = true;
      }
    },
    setPopupSize: (update) => {
      popupSize = update(popupSize);
    },
  },
)();
for (const height of [100, 202, 100]) {
  resizingPopup.offsetHeight = height;
  popupResize();
  equal(popupSize, { width: 280, height });
  const stable = popupSize;
  popupResize();
  assert.equal(
    popupSize,
    stable,
    "Unchanged popup dimensions must not trigger another camera update",
  );
}
disposePopupObserver();
assert(disconnected, "Popup observation is released after closing its detail");
const shapeCameraEffect = globeEffects.find((effect) =>
  effect.arguments[0]
    .getText(globeAst)
    .includes("geoCentroid(highlightedShape)"),
);
assert(
  shapeCameraEffect.arguments[1].getText(globeAst).includes("popupSize"),
  "The initial detail layout participates in the selection camera fit",
);
let unwantedRefit = false;
const guardedShape = { type: "Sphere" };
evaluateGlobe(shapeCameraEffect.arguments[0].getText(globeAst), {
  pointers: { current: new Map() },
  highlightedShape: guardedShape,
  mapRef: { current: {} },
  focusedSelection: {
    current: { shape: guardedShape, revision: 1, detailOpen: true },
  },
  selectionRevision: 1,
  detailOpen: true,
  cameraFrame: { current: null },
  setCamera() {
    unwantedRefit = true;
  },
})();
assert.equal(
  unwantedRefit,
  false,
  "Popup resizing after camera completion or a drag preserves the displayed view",
);
evaluateGlobe(shapeCameraEffect.arguments[0].getText(globeAst), {
  pointers: { current: new Map([[1, { x: 100, y: 100 }]]) },
  setCamera() {
    throw new Error("Late geometry must not zoom during a touch gesture");
  },
})();
assert(
  globeEffects
    .find((effect) =>
      effect.arguments[0].getText(globeAst).includes("drawRef.current ="),
    )
    .arguments[1].getText(globeAst)
    .includes("popupSize"),
  "Source detail resizing must redraw labels and selection anchors",
);
const terrainLoadEffect = globeEffects.find((effect) =>
  effect.arguments[0]
    .getText(globeAst)
    .includes("if (!needsTerrain || terrain)"),
);
assert(
  terrainLoadEffect,
  "Physical terrain loads independently of the basemap",
);
let terrainRequests = 0;
let loadedTerrain = null;
let failedTerrain = false;
const runTerrainLoad = (needsTerrain, terrain = null, fail = false) =>
  evaluateGlobe(terrainLoadEffect.arguments[0].getText(globeAst), {
    needsTerrain,
    terrain,
    loadAtlasTerrainGeometry: async () => {
      terrainRequests += 1;
      if (fail) throw new Error("offline");
      return { type: "FeatureCollection", features: [] };
    },
    setTerrain: (value) => {
      loadedTerrain = value;
    },
    setTerrainError: (value) => {
      failedTerrain = value;
    },
  })();
runTerrainLoad(false);
assert.equal(terrainRequests, 0, "Disabled terrain makes no terrain request");
runTerrainLoad(true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(terrainRequests, 1);
assert(loadedTerrain, "Enabling terrain loads its physical layer");
runTerrainLoad(true, loadedTerrain);
assert.equal(terrainRequests, 1, "Toggling terrain reuses loaded geometry");
runTerrainLoad(true, null, true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(failedTerrain, "A terrain failure leaves a retryable layer error");
// Exercise the actual current frame calculation against physical top-left cards,
// including the wide-layout/narrow-map case and both sides of the 650px cutoff.
for (const width of [286, 343, 344, 356, 624, 649, 650, 920]) {
  for (const height of [400, 480, 640]) {
    const popup = {
      offsetLeft: 8,
      offsetTop: width < 920 ? 56 : 8,
      offsetWidth: Math.min(width >= 920 ? 320 : 280, width - 16),
      offsetHeight: height * (width >= 920 ? 0.55 : 0.42),
    };
    const frame = selectionViewport(width, height, popup);
    const x = (frame.left + frame.right) / 2;
    const y = (frame.top + frame.bottom) / 2;
    const haloRadius = (44 * 1.8) / 2;
    assert(
      x - haloRadius >= 0 &&
        x + haloRadius <= width &&
        y - haloRadius >= 42 &&
        y + haloRadius <= height - 28,
      `${width}/${height}: selected ripple stays in the visible map`,
    );
    assert(
      x - haloRadius >= popup.offsetLeft + popup.offsetWidth ||
        y - haloRadius >= popup.offsetTop + popup.offsetHeight,
      `${width}/${height}: selected ripple stays beside or below the top-left popup`,
    );
    assert(
      popup.offsetTop + popup.offsetHeight < height - 76,
      `${width}/${height}: popup leaves the compass visible`,
    );
  }
}
regionHandler = globeDeclarations.get("changeRegion").getText(globeAst);
chooseEntryHandler = globeDeclarations
  .get("chooseEntry")
  .arguments[0].getText(globeAst);
assert(regionHandler && chooseEntryHandler);
const testItems = regionFixtures[0].coordinates.map((coordinates, index) => ({
  entry: {
    id: `story-${index}`,
    unitId: index === 2 ? "other-unit" : "chosen-unit",
    eraIds: ["chosen-era"],
  },
  place: { id: `place-${index}`, coordinates },
  subject: "korea",
  search: "",
}));
for (const empty of [false, true]) {
  const state = {};
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(`exports.changeRegion = ${regionHandler}`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      items: empty ? [] : testItems,
      subject: "korea",
      unitId: "chosen-unit",
      eraId: "chosen-era",
      size: { width: 356, height: 480 },
      areas: null,
      fitGlobeRegionCamera,
      GLOBE_INITIAL_VIEW: m.GLOBE_INITIAL_VIEW,
      matchesGlobeRegion: () => true,
      matchesAtlasTemporalScope: load("src/lib/historyAtlas.ts")
        .matchesAtlasTemporalScope,
      ...Object.fromEntries(
        [
          "RegionId",
          "SubregionId",
          "SelectedId",
          "SelectedCountryId",
          "Panel",
          "Page",
          "Notice",
          "Query",
          "Camera",
          "ProvinceDetailOpen",
          "RegionSelectionDismissed",
        ].map((key) => [
          `set${key}`,
          (value) => {
            state[key] = value;
          },
        ]),
      ),
    },
  );
  exports.changeRegion("jeolla", "");
  assert.equal(state.Query, "");
  assert.equal(state.SelectedId, null);
  assert.equal(state.SelectedCountryId, null);
  assert.equal(state.Panel, "list");
  assert.equal(
    state.RegionSelectionDismissed,
    false,
    "Choosing another region enables its geographic highlight",
  );
  equal(
    state.Camera ?? null,
    empty
      ? null
      : JSON.parse(
          JSON.stringify(
            fitGlobeRegionCamera(
              testItems.slice(0, 2).map((item) => item.place.coordinates),
              356,
              480,
            ),
          ),
        ),
  );
}
const selectionState = { revision: 0, cameraCount: 0 };
const selectionExports = {};
const viewRef = {
  current: { longitude: -70, latitude: -30, roll: 45, zoom: 1 },
};
const pendingPanelFocus = { current: null };
vm.runInNewContext(
  ts.transpileModule(`exports.chooseEntry = ${chooseEntryHandler}`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports: selectionExports,
    itemsById: new Map(testItems.map((item) => [item.entry.id, item])),
    subject: "korea",
    unitId: "",
    eraId: "",
    regionId: "",
    subregionId: "",
    query: "",
    pendingPanelFocus,
    viewRef,
    focusGlobeView: m.focusGlobeView,
    setNotice: () => {},
    setSelectedId: () => {},
    setSelectedCountryId: () => {},
    setPanel: () => {},
    setPanelOpen: () => {},
    setProvinceDetailOpen: () => {},
    setSelectionRevision: (update) => {
      selectionState.revision = update(selectionState.revision);
    },
    setCamera: (view) => {
      selectionState.camera = view;
      selectionState.cameraCount += 1;
    },
  },
);
selectionExports.chooseEntry("story-0");
selectionExports.chooseEntry("story-0");
assert.equal(
  selectionState.revision,
  2,
  "Repeated same-place tag activation restarts watercourse focus",
);
assert.equal(
  selectionState.cameraCount,
  0,
  "Selection schedules one camera fit after the detail layout, without a preliminary jump",
);
assert.equal(pendingPanelFocus.current, "detail");
// Exercise the production all-subject filtering with the actual curated dataset.
function evaluateGlobe(expression, dependencies = {}) {
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
let globeDismissalCases = 0;
for (const kind of ["place", "country", "province"]) {
  const previous = { longitude: 125, latitude: 37, roll: 12, zoom: 4.2 };
  const viewRef = { current: { ...previous } };
  const cameraFrame = { current: 17 };
  const focusedSelection = { current: { shape: {}, revision: 4 } };
  const pendingPanelFocus = { current: "detail" };
  const frames = new Set([17]);
  let committed,
    drawCount = 0;
  const state = {
    SelectedId: kind === "place" ? "selected-entry" : null,
    SelectedCountryId: kind === "country" ? "KOR" : null,
    ProvinceDetailOpen: kind === "province",
    RegionSelectionDismissed: false,
    Panel: "detail",
    Page: 0,
  };
  const cancelCamera = evaluateGlobe(
    globeDeclarations.get("cancelCamera").getText(globeAst),
    {
      useCallback: (callback) => callback,
      cameraFrame,
      cancelAnimationFrame: (id) => frames.delete(id),
    },
  );
  const commitView = evaluateGlobe(
    globeDeclarations.get("commitView").getText(globeAst),
    {
      useCallback: (callback) => callback,
      viewRef,
      setView: (value) => {
        committed = value;
      },
      requestDraw: () => {
        drawCount++;
      },
    },
  );
  const returnToList = evaluateGlobe(
    globeDeclarations.get("returnToList").getText(globeAst),
    {
      cancelCamera,
      commitView,
      focusedSelection,
      pendingPanelFocus,
      filtered: [{ place: { id: "place-id" } }],
      selected: kind === "place" ? { place: { id: "place-id" } } : undefined,
      PAGE_SIZE: 40,
      ...Object.fromEntries(
        Object.keys(state).map((key) => [
          `set${key}`,
          (value) => {
            state[key] = value;
          },
        ]),
      ),
    },
  );
  if (kind === "country")
    evaluateGlobe(globePopupKeyDown, { returnToList })({
      key: "Escape",
      preventDefault() {},
    });
  else if (kind === "province")
    evaluateGlobe(globeDeclarations.get("onKeyDown").getText(globeAst), {
      returnToList,
      viewRef,
    })({ key: "Escape" });
  else evaluateGlobe(globeCloseClick, { returnToList })();
  equal(state, {
    SelectedId: null,
    SelectedCountryId: null,
    ProvinceDetailOpen: false,
    RegionSelectionDismissed: true,
    Panel: "list",
    Page: 0,
  });
  equal(viewRef.current, previous);
  equal(committed, previous);
  assert.equal(cameraFrame.current, null);
  assert.equal(frames.size, 0);
  assert.equal(focusedSelection.current, null);
  assert.equal(pendingPanelFocus.current, "list");
  assert.equal(drawCount, 1, "Closing commits one stationary globe redraw");
  const provinceArea = evaluateGlobe(
    globeDeclarations.get("provinceArea").arguments[0].getText(globeAst),
    { regionSelectionDismissed: state.RegionSelectionDismissed },
  )();
  assert.equal(provinceArea, null, "Retained region filters cannot reselect");
  evaluateGlobe(shapeCameraEffect.arguments[0].getText(globeAst), {
    pointers: { current: new Map() },
    highlightedShape: null,
    selected: undefined,
    setCamera: () => assert.fail("Closing cannot refocus the globe"),
  })();
  globeDismissalCases++;
}
const atlasModel = load("src/lib/historyAtlas.ts");
const regionModel = load("src/lib/historyAtlasRegions.ts");
const areaModel = load("src/lib/historyAtlasAreas.ts");
const areaCollections = Object.fromEntries(
  ["korea", "world"].map((subject) => [
    subject,
    JSON.parse(readFileSync(`src/data/atlas/areas-${subject}.json`, "utf8")),
  ]),
);
const allAreas = {
  type: "FeatureCollection",
  features: Object.values(areaCollections).flatMap(
    (collection) => collection.features,
  ),
};
for (const [regionSubject, collection] of Object.entries(areaCollections)) {
  for (const feature of collection.features.filter(
    (feature) => feature.properties.regionId,
  )) {
    const key = feature.properties.regionId;
    const parent =
      regionSubject === "world"
        ? regionModel.ATLAS_WORLD_REGION_GROUPS.find(
            (group) =>
              group.id === key ||
              group.children.some((child) => child.id === key),
          )
        : null;
    if (regionSubject === "world")
      assert(
        parent,
        `${key}: world geometry corresponds to a visible region option`,
      );
    for (const subject of [regionSubject, "all"]) {
      const regionId = `${subject === "all" ? regionSubject + ":" : ""}${parent?.id || key}`;
      const subregionId = parent && parent.id !== key ? key : "";
      const area = evaluateGlobe(
        globeDeclarations.get("provinceArea").arguments[0].getText(globeAst),
        {
          selected: undefined,
          selectedCountry: null,
          regionSelectionDismissed: false,
          areas: allAreas,
          subject,
          regionId,
          subregionId,
          ...areaModel,
        },
      )();
      assert.equal(
        area,
        feature,
        `${subject}/${regionId}/${subregionId}: the exact region geometry remains selected with no places`,
      );
    }
    for (const width of [356, 920]) {
      for (const popupHeight of [100, 202]) {
        let camera;
        evaluateGlobe(shapeCameraEffect.arguments[0].getText(globeAst), {
          pointers: { current: new Map() },
          highlightedShape: feature,
          selected: undefined,
          focusedSelection: { current: null },
          selectionRevision: 1,
          cameraFrame: { current: null },
          viewRef,
          focusGlobeView: m.focusGlobeView,
          mapRef: { current: { clientWidth: width, clientHeight: 480 } },
          detailOpen: true,
          detailRef: {
            current: {
              parentElement: {
                offsetLeft: 8,
                offsetTop: width < 650 ? 56 : 8,
                offsetWidth: 280,
                offsetHeight: popupHeight,
              },
            },
          },
          selectionViewport,
          ...d3Geography,
          GLOBE_MAX_ZOOM: m.GLOBE_MAX_ZOOM,
          setCamera: (next) => {
            camera = m.constrainGlobeView(next);
          },
        })();
        assert(
          camera && Object.values(camera).every(Number.isFinite),
          `${key}: regional camera stays finite when source details resize`,
        );
        assert(
          camera.zoom >= 1 && camera.zoom <= m.GLOBE_MAX_ZOOM,
          "Regional ranges preserve the existing globe zoom limits",
        );
        const path = d3Geography.geoPath(
          geoOrthographic()
            .scale(200)
            .rotate([-camera.longitude, -camera.latitude, camera.roll]),
        )(feature);
        assert(
          path?.length,
          `${key}: region geometry is visible independently of place-list results`,
        );
      }
    }
  }
}
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasDataset;
const itemFactory = evaluateGlobe(
  globeDeclarations.get("items").arguments[0].getText(globeAst),
  {
    dataset,
    units: new Map(dataset.units.map((unit) => [unit.id, unit])),
    ...atlasModel,
  },
);
const actualItems = itemFactory();
const matchesGlobeRegion = evaluateGlobe(
  globeDeclarations.get("matchesGlobeRegion").getText(globeAst),
  { ...regionModel, ...areaModel },
);
const nameOf = evaluateGlobe(globeDeclarations.get("nameOf").getText(globeAst));
const filterItems = (overrides = {}) =>
  evaluateGlobe(
    globeDeclarations.get("filtered").arguments[0].getText(globeAst),
    {
      items: actualItems,
      subject: "all",
      unitId: "",
      eraId: "",
      regionId: "",
      subregionId: "",
      query: "",
      areas: null,
      matchesGlobeRegion,
      nameOf,
      koreanNames: new Intl.Collator("ko-KR", { numeric: true }),
      ...atlasModel,
      ...overrides,
    },
  )();
const allItems = filterItems();
assert.equal(
  allItems.length,
  new Set(actualItems.map((item) => item.place.id)).size,
  "All subjects retain exactly one row per shared place",
);
assert(
  allItems.some((item) => item.subject === "korea") &&
    allItems.some((item) => item.subject === "world"),
);
for (const subject of ["korea", "world"]) {
  const scoped = filterItems({ subject });
  assert(scoped.every((item) => item.subject === subject));
  for (const option of subject === "korea"
    ? regionModel.ATLAS_KOREA_PROVINCES
    : regionModel.ATLAS_WORLD_REGION_GROUPS) {
    const expected = filterItems({ subject, regionId: option.id })
      .map((item) => item.place.id)
      .sort();
    const combined = filterItems({ regionId: `${subject}:${option.id}` })
      .map((item) => item.place.id)
      .sort();
    equal(combined, JSON.parse(JSON.stringify(expected)));
  }
}
const andong = actualItems.find((item) => item.place.name === "안동");
assert(andong, "Andong has a curated historical place");
assert.equal(
  nameOf(andong),
  "안동",
  "The browse name must not be replaced by the historical name Gochang",
);
assert(
  filterItems({ query: "안동" }).some(
    (item) => item.place.id === andong.place.id,
  ),
);
assert(
  filterItems({ query: "고창" }).some(
    (item) => item.place.id === andong.place.id,
  ),
  "The historical name is still searchable",
);
const koreaStory = actualItems.find((item) => item.subject === "korea");
const worldStory = actualItems.find((item) => item.subject === "world");
const allSelectionState = {};
const selectFromAll = evaluateGlobe(chooseEntryHandler, {
  ...atlasModel,
  matchesGlobeRegion,
  itemsById: new Map(
    [koreaStory, worldStory].map((item) => [item.entry.id, item]),
  ),
  subject: "all",
  unitId: "",
  eraId: "",
  regionId: "",
  subregionId: "",
  query: "",
  pendingPanelFocus: { current: null },
  viewRef,
  focusGlobeView: m.focusGlobeView,
  ...Object.fromEntries(
    [
      "Subject",
      "UnitId",
      "EraId",
      "RegionId",
      "SubregionId",
      "Query",
      "Notice",
      "Page",
      "SelectedId",
      "SelectedCountryId",
      "SelectionRevision",
      "Panel",
      "PanelOpen",
      "ProvinceDetailOpen",
      "Camera",
    ].map((key) => [
      `set${key}`,
      (value) => {
        allSelectionState[key] = typeof value === "function" ? value(0) : value;
      },
    ]),
  ),
});
selectFromAll(koreaStory.entry.id);
selectFromAll(worldStory.entry.id);
assert.equal(
  allSelectionState.Subject,
  undefined,
  "Switching stories across subjects preserves All",
);
assert.equal(allSelectionState.SelectedId, worldStory.entry.id);
assert.equal(
  filterItems({
    items: [koreaStory, { ...worldStory, place: koreaStory.place }],
  }).length,
  1,
  "A place with Korean and world history entries still has one row",
);
let selectedShapeEntry;
const endPointerExpression = globeDeclarations
  .get("endPointer")
  .getText(globeAst);
// Execute the shared production gesture handlers. Labels must use the same
// capture and pinch state as the canvas instead of selecting after a drag.
const touchSelections = [];
const capturedPointers = new Set();
const touchCanvas = {
  dataset: {},
  focus() {},
  setPointerCapture(id) {
    capturedPointers.add(id);
  },
  hasPointerCapture(id) {
    return capturedPointers.has(id);
  },
  releasePointerCapture(id) {
    capturedPointers.delete(id);
  },
};
const touchLabel = { dataset: { globeCountry: "RUS" }, focus() {} };
const touchView = {
  current: { longitude: 105, latitude: 25, roll: 0, zoom: 2 },
};
let touchCameraCancels = 0;
const touchScope = {
  pointers: { current: new Map() },
  gesture: { current: null },
  viewRef: touchView,
  canvasRef: { current: touchCanvas },
  size: { width: 390, height: 600 },
  localPointer: (event) => ({ x: event.clientX, y: event.clientY }),
  cancelCamera() {
    touchCameraCancels++;
  },
  updateView(next) {
    touchView.current = next;
  },
  commitView() {},
  dragGlobeView: m.dragGlobeView,
  pinchGlobeView: m.pinchGlobeView,
  chooseEntry: (id) => touchSelections.push(`entry:${id}`),
  chooseCountry: (id) => touchSelections.push(`country:${id}`),
  openProvinceDetails: () => touchSelections.push("region"),
  drawnPoints: { current: [] },
  nearestGlobePoint: () => undefined,
  hitGeography: { current: () => null },
  setSelectedCountryId() {},
};
touchScope.startGesture = evaluateGlobe(
  globeDeclarations.get("startGesture").getText(globeAst),
  touchScope,
);
const touchDown = evaluateGlobe(
  globeDeclarations.get("onPointerDown").getText(globeAst),
  touchScope,
);
const touchMove = evaluateGlobe(
  globeDeclarations.get("onPointerMove").getText(globeAst),
  touchScope,
);
const touchEnd = evaluateGlobe(endPointerExpression, touchScope);
const touchEvent = (id, x, y, target = touchCanvas) => ({
  pointerType: "touch",
  pointerId: id,
  clientX: x,
  clientY: y,
  currentTarget: target,
});
touchDown(touchEvent(1, 100, 100, touchLabel));
assert(
  capturedPointers.has(1),
  "A label transfers pointer capture to the canvas",
);
touchMove(touchEvent(1, 160, 130));
assert.notEqual(
  touchView.current.longitude,
  105,
  "A label drag rotates the globe",
);
assert.equal(touchView.current.zoom, 2, "One-finger label drag preserves zoom");
touchEnd(touchEvent(1, 160, 130));
assert.equal(
  touchSelections.length,
  0,
  "Dragging a label never selects or refocuses it",
);
assert.equal(
  touchCameraCancels,
  1,
  "Label input interrupts automatic camera motion",
);

touchDown(touchEvent(1, 100, 100, touchLabel));
touchDown(touchEvent(2, 200, 100));
touchMove(touchEvent(2, 250, 100));
assert(
  touchView.current.zoom > 2,
  "A label/canvas two-finger pinch changes zoom",
);
touchEnd(touchEvent(2, 250, 100));
const pinchedZoom = touchView.current.zoom;
touchMove(touchEvent(1, 130, 140));
assert.equal(
  touchView.current.zoom,
  pinchedZoom,
  "The remaining finger only rotates after a pinch",
);
touchEnd(touchEvent(1, 130, 140));
assert.equal(
  touchSelections.length,
  0,
  "Pinch release never selects the starting label",
);

touchDown(touchEvent(3, 100, 100, touchLabel));
touchEnd(touchEvent(3, 140, 100));
assert.equal(
  touchSelections.length,
  0,
  "Fast swipe without a delivered move event is not a tap",
);
touchDown(touchEvent(4, 100, 100, touchLabel));
touchEnd(touchEvent(4, 100, 100), true);
assert.equal(
  touchSelections.length,
  0,
  "Cancelled label gestures never select",
);
touchDown(touchEvent(5, 100, 100, touchLabel));
touchLabel.dataset.globeCountry = "CHN";
touchEnd(touchEvent(5, 100, 100));
assert.deepEqual(
  touchSelections,
  ["country:RUS"],
  "A genuine tap selects the original label even if its drawing node was reused",
);
assert.equal(touchScope.pointers.current.size, 0);
assert.equal(touchScope.gesture.current, null);
assert.equal(capturedPointers.size, 0);

for (const moved of [false, true]) {
  selectedShapeEntry = undefined;
  evaluateGlobe(endPointerExpression, {
    gesture: {
      current: { moved, multiple: false, points: [{ x: 100, y: 100 }] },
    },
    pointers: { current: new Map([[1, { x: 100, y: 100 }]]) },
    localPointer: () => ({ x: 100, y: 100 }),
    drawnPoints: { current: [] },
    nearestGlobePoint: m.nearestGlobePoint,
    hitGeography: { current: () => worldStory },
    chooseEntry: (id) => {
      selectedShapeEntry = id;
    },
    commitView() {},
  })({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
  assert.equal(
    selectedShapeEntry,
    moved ? undefined : worldStory.entry.id,
    "Only a deliberate click selects terrain; dragging never opens a story",
  );
}

const countrySelectionState = {};
const chooseCountry = evaluateGlobe(
  globeDeclarations.get("chooseCountry").arguments[0].getText(globeAst),
  {
    countries: { countries: { features: [{ properties: { id: "KOR" } }] } },
    pendingPanelFocus: { current: "detail" },
    ...Object.fromEntries(
      [
        "SelectedCountryId",
        "SelectedId",
        "RegionId",
        "SubregionId",
        "ProvinceDetailOpen",
        "Panel",
        "PanelOpen",
        "Notice",
        "SelectionRevision",
      ].map((key) => [
        `set${key}`,
        (value) => {
          countrySelectionState[key] =
            typeof value === "function" ? value(0) : value;
        },
      ]),
    ),
  },
);
chooseCountry("KOR");
assert.equal(countrySelectionState.SelectedCountryId, "KOR");
assert.equal(
  countrySelectionState.SelectedId,
  null,
  "Country selection clears the story highlight",
);
assert.equal(
  countrySelectionState.RegionId,
  "",
  "Country selection clears the previous regional highlight",
);
assert.equal(countrySelectionState.Panel, "detail");
chooseCountry("missing-country");
assert.equal(
  countrySelectionState.SelectedCountryId,
  "KOR",
  "Unknown countries do not change selection",
);
for (const moved of [false, true]) {
  let selectedCountry;
  evaluateGlobe(endPointerExpression, {
    gesture: {
      current: { moved, multiple: false, points: [{ x: 100, y: 100 }] },
    },
    pointers: { current: new Map([[1, { x: 100, y: 100 }]]) },
    localPointer: () => ({ x: 100, y: 100 }),
    drawnPoints: { current: [] },
    nearestGlobePoint: m.nearestGlobePoint,
    hitGeography: { current: () => null },
    hitCountry: { current: () => ({ properties: { id: "KOR" } }) },
    chooseCountry: (id) => {
      selectedCountry = id;
    },
    setSelectedCountryId: (id) => {
      selectedCountry = id;
    },
    commitView() {},
  })({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
  assert.equal(
    selectedCountry,
    moved ? undefined : null,
    "Country interiors never select a country; background clicks only clear it",
  );
}

// Canvas hit testing uses the production callback, with a deterministic path
// adapter for the M/L/Z coordinates emitted by d3's orthographic geoPath.
let hitExpression;
function visitHit(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.left.getText(globeAst) === "hitGeography.current"
  )
    hitExpression = node.right.getText(globeAst);
  ts.forEachChild(node, visitHit);
}
visitHit(globeAst);
assert(hitExpression);
class TestPath {
  constructor(path) {
    this.parts = [];
    let current;
    for (const command of path.match(/[MLZ][^MLZ]*/g) || []) {
      if (command[0] === "Z") {
        current.push(current[0]);
        continue;
      }
      const values = command.slice(1).split(",").map(Number);
      if (command[0] === "M") {
        current = [];
        this.parts.push(current);
      }
      current.push(values);
    }
  }
}
const hitContext = {
  lineWidth: 0,
  save() {},
  restore() {},
  setTransform() {},
  isPointInStroke(path, x, y) {
    return path.parts.some((points) =>
      points.slice(1).some(([bx, by], i) => {
        const [ax, ay] = points[i],
          dx = bx - ax,
          dy = by - ay;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        return (
          Math.hypot(x - ax - t * dx, y - ay - t * dy) <= this.lineWidth / 2
        );
      }),
    );
  },
  isPointInPath(path, x, y) {
    let inside = false;
    for (const points of path.parts)
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i],
          [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
    return inside;
  },
};
const riverModel = load("src/lib/historyAtlasRivers.ts");
const landformModel = load("src/lib/historyAtlasLandforms.ts");
const riverAsset = JSON.parse(
  readFileSync("src/data/atlas/rivers-world.json", "utf8"),
);
const yellowPlace = {
  id: "yellow-river-fixture",
  name: "황허강",
  kind: "water",
  coordinates: [112, 36],
};
const gobiPlace = {
  id: "kr-fe954fbe1cc0",
  name: "고비 사막",
  kind: "desert",
  coordinates: [106.0126, 43.1336],
};
const yellow = riverModel.findAtlasRiver(yellowPlace, riverAsset);
const gobi = landformModel.findAtlasLandform(gobiPlace, geography);
assert(yellow && gobi);
const hitItems = [
  {
    item: { entry: { id: "yellow" }, place: yellowPlace },
    shape: yellow,
    area: false,
  },
  {
    item: { entry: { id: "gobi" }, place: gobiPlace },
    shape: gobi,
    area: true,
  },
];
const projection = geoOrthographic()
  .translate([350, 270])
  .scale(480)
  .rotate([-108, -36, 0])
  .clipAngle(90);
const pickShape = evaluateGlobe(hitExpression, {
  ...d3Geography,
  context: hitContext,
  projection,
  selectableGeography: hitItems,
  Path2D: TestPath,
});
const riverLines = yellow.features.flatMap((feature) =>
  feature.geometry.type === "LineString"
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates,
);
let riverHits = 0;
for (const line of riverLines)
  for (
    let i = 0;
    i < line.length;
    i += Math.max(1, Math.floor(line.length / 8))
  ) {
    const xy = projection(line[i]);
    assert.equal(
      pickShape(...xy)?.entry.id,
      "yellow",
      "Upper, middle and lower river strokes are clickable",
    );
    riverHits += 1;
  }
assert(riverHits > 12);
assert.equal(
  pickShape(...projection(gobiPlace.coordinates))?.entry.id,
  "gobi",
  "The real desert area opens its place",
);
assert.equal(
  pickShape(...projection([90, 10])),
  undefined,
  "Unmatched terrain is not invented as an interactive historical place",
);
projection.rotate([72, 36, 0]);
assert.equal(
  pickShape(...projection(gobiPlace.coordinates)),
  undefined,
  "Backside terrain cannot be clicked through the sphere",
);

// Exercise the actual scheduler: bursts coalesce, draw on the next display
// frame, stop when hidden, and never leave a self-perpetuating idle loop.
const scheduled = new Map();
let drawCalls = 0;
const rafState = { current: null },
  dirtyState = { current: false };
const documentState = { hidden: false },
  visibleState = { current: true };
const requestDraw = evaluateGlobe(
  globeDeclarations.get("requestDraw").arguments[0].getText(globeAst),
  {
    raf: rafState,
    dirty: dirtyState,
    document: documentState,
    inView: visibleState,
    drawRef: {
      current: () => {
        drawCalls += 1;
      },
    },
    requestAnimationFrame: (callback) => {
      scheduled.set(1, callback);
      return 1;
    },
  },
);
for (let event = 0; event < 40; event += 1) requestDraw();
assert.equal(
  scheduled.size,
  1,
  "A burst of pointer events queues exactly one display frame",
);
const nextFrame = scheduled.get(1);
scheduled.clear();
nextFrame();
assert.equal(drawCalls, 1);
assert.equal(rafState.current, null);
assert.equal(scheduled.size, 0, "A completed draw never queues an idle frame");
documentState.hidden = true;
requestDraw();
assert.equal(scheduled.size, 0, "Hidden tabs never draw");
documentState.hidden = false;
visibleState.current = false;
requestDraw();
assert.equal(scheduled.size, 0, "Offscreen globes never draw");
visibleState.current = true;
requestDraw();
scheduled.get(1)();
scheduled.clear();
assert.equal(drawCalls, 2, "Visible globe resumes with its latest camera");

const focusNode = (key) => ({
  key,
  getAttribute() {
    return this.key;
  },
  setAttribute(_name, value) {
    this.key = value;
  },
});
const focusedRegion = focusNode("region:europe");
const otherLabel = focusNode("country:RUS");
const claimLabel = evaluateGlobe(
  globeDeclarations.get("claimLabel").getText(globeAst),
  {
    labelNodes: [focusedRegion, otherLabel],
    focusedLabel: focusedRegion,
    claimedLabels: new Set(),
  },
);
assert.equal(claimLabel("country:CHN"), otherLabel);
assert.equal(
  focusedRegion.key,
  "region:europe",
  "Camera redraws must not replace the focused region with another country before Enter",
);
assert.equal(claimLabel("region:europe"), focusedRegion);

// Run the production camera transition, including its screen-space center.
// Opening a detail card must not translate the globe before the first frame.
const cameraQueue = new Map();
const cameraFrame = { current: null };
const cameraView = {
  current: { longitude: 105, latitude: 25, roll: 0, zoom: 1 },
};
const projectionCenter = { current: { x: 0.5, y: 0.5 } };
let cameraClock = 0,
  cameraSequence = 0,
  cameraCommits = 0,
  reduceCameraMotion = false;
const cancelCamera = evaluateGlobe(
  globeDeclarations.get("cancelCamera").arguments[0].getText(globeAst),
  { cameraFrame, cancelAnimationFrame: (id) => cameraQueue.delete(id) },
);
const animateCamera = evaluateGlobe(
  globeDeclarations.get("setCamera").arguments[0].getText(globeAst),
  {
    cameraFrame,
    projectionCenter,
    cancelCamera,
    viewRef: cameraView,
    constrainGlobeView: m.constrainGlobeView,
    interpolateGlobeView: m.interpolateGlobeView,
    performance: { now: () => cameraClock },
    window: { matchMedia: () => ({ matches: reduceCameraMotion }) },
    updateView: (next) => {
      cameraView.current = next;
    },
    commitView: () => {
      cameraCommits += 1;
    },
    requestAnimationFrame: (frame) => {
      const id = ++cameraSequence;
      cameraQueue.set(id, frame);
      return id;
    },
  },
);
const nextCameraFrame = (time) => {
  const [id, frame] = cameraQueue.entries().next().value;
  cameraQueue.delete(id);
  cameraClock = time;
  frame(time);
};
const cameraTarget = { longitude: 127, latitude: 37, roll: 0, zoom: 6 };
animateCamera(cameraTarget, { x: 0.72, y: 0.63 });
equal(cameraView.current, { longitude: 105, latitude: 25, roll: 0, zoom: 1 });
equal(projectionCenter.current, { x: 0.5, y: 0.5 });
nextCameraFrame(1000);
equal(cameraView.current, { longitude: 105, latitude: 25, roll: 0, zoom: 1 });
equal(projectionCenter.current, { x: 0.5, y: 0.5 });
nextCameraFrame(1060);
assert(
  cameraView.current.longitude > 105 && cameraView.current.longitude < 127,
);
assert(projectionCenter.current.x > 0.5 && projectionCenter.current.x < 0.72);
const interruptedView = { ...cameraView.current };
const interruptedCenter = { ...projectionCenter.current };
animateCamera({ ...cameraTarget, longitude: 130 }, { x: 0.67, y: 0.6 });
equal(cameraView.current, interruptedView);
equal(projectionCenter.current, interruptedCenter);
assert.equal(
  cameraQueue.size,
  1,
  "Rapid selections replace one animation from its currently displayed frame",
);
nextCameraFrame(1060);
nextCameraFrame(1180);
nextCameraFrame(1360);
const { zoom: finalCameraZoom, ...finalCameraPosition } = cameraView.current;
equal(finalCameraPosition, { longitude: 130, latitude: 37, roll: 0 });
// Geometric zoom interpolation can finish one floating-point ULP below its target.
assert(Math.abs(finalCameraZoom - cameraTarget.zoom) < 1e-12);
equal(projectionCenter.current, { x: 0.67, y: 0.6 });
assert.equal(cameraCommits, 1);
assert.equal(
  cameraQueue.size,
  0,
  "Completed camera transitions leave no idle frame loop",
);
animateCamera(cameraTarget);
cancelCamera();
assert.equal(
  cameraQueue.size,
  0,
  "Direct pointer and wheel input can cancel the pending camera frame",
);
reduceCameraMotion = true;
animateCamera(cameraTarget, { x: 0.5, y: 0.5 });
equal(cameraView.current, cameraTarget);
equal(projectionCenter.current, { x: 0.5, y: 0.5 });
assert.equal(
  cameraQueue.size,
  0,
  "Reduced motion applies the final camera without animation",
);

const { globeInteractionGeometry, globeVisibleTerrain, globeVisibleLines } =
  load("src/lib/historyGlobeRendering.ts");
const detailedBorders = JSON.parse(
  readFileSync("src/data/atlas/countries-world.json", "utf8"),
).borders;
const originalBorders = JSON.stringify(detailedBorders);
const simplifiedBorders = globeInteractionGeometry(detailedBorders, 512);
assert.equal(
  globeInteractionGeometry(detailedBorders, 512),
  simplifiedBorders,
  "Repeated frames reuse prepared lines",
);
assert.equal(
  JSON.stringify(detailedBorders),
  originalBorders,
  "The precise boundary source is never mutated",
);
const pointCount = (lines) =>
  lines.reduce((total, line) => total + line.length, 0);
assert(
  pointCount(simplifiedBorders.coordinates) <
    pointCount(detailedBorders.coordinates) * 0.8,
  "Interactive boundaries reduce projection work materially",
);
for (
  let lineIndex = 0;
  lineIndex < detailedBorders.coordinates.length;
  lineIndex += 1
) {
  const original = detailedBorders.coordinates[lineIndex],
    reduced = simplifiedBorders.coordinates[lineIndex];
  assert.equal(reduced[0], original[0]);
  assert.equal(reduced.at(-1), original.at(-1));
  let sourceIndex = 0;
  for (let index = 1; index < reduced.length; index += 1) {
    const [ax, ay] = reduced[index - 1],
      [bx, by] = reduced[index];
    const dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy;
    while (original[sourceIndex] !== reduced[index]) {
      const [x, y] = original[sourceIndex++];
      const ratio = length
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
        : 0;
      const pixelError =
        ((Math.hypot(x - ax - ratio * dx, y - ay - ratio * dy) * Math.PI) /
          180) *
        512;
      assert(
        pixelError <= 0.350001,
        "Temporary line simplification remains below half a display pixel",
      );
    }
  }
}
assert.equal(
  globeInteractionGeometry(gobi, 512).features[0].geometry,
  gobi.features[0].geometry,
  "Polygon areas preserve their exact geometry at every frame",
);
const seam = {
  type: "LineString",
  coordinates: [
    [179, 10],
    [180, 11],
    [-180, 11],
    [-179, 10],
  ],
};
equal(globeInteractionGeometry(seam, 256), seam);
const terrainSource = JSON.parse(
  readFileSync("src/data/atlas/terrain.json", "utf8"),
);
const terrainPreview = globeInteractionGeometry(terrainSource, 512, true);
for (let index = 0; index < terrainSource.features.length; index += 1) {
  const original = terrainSource.features[index],
    preview = terrainPreview.features[index];
  assert.equal(
    preview.properties,
    original.properties,
    "Temporary terrain detail preserves names and sources",
  );
  assert(
    geoArea(preview) < 2 * Math.PI,
    "Simplified terrain never turns into its spherical complement",
  );
  const polygons =
    preview.geometry.type === "Polygon"
      ? [preview.geometry.coordinates]
      : preview.geometry.coordinates;
  for (const polygon of polygons)
    for (const ring of polygon) {
      assert(ring.length >= 4, "Tiny terrain areas retain a valid polygon");
      equal(ring[0], ring.at(-1));
    }
}

const terrainPolygons = {
  type: "MultiPolygon",
  coordinates: terrainSource.features.flatMap((feature) =>
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates,
  ),
};
let culledTerrainPolygons = 0;
let culledBorderPoints = 0;
for (const [longitude, latitude] of [
  [105, 25],
  [127, 37],
  [12, 50],
  [-70, -30],
  [179, 0],
  [-179, 0],
  [0, 85],
  [0, -85],
]) {
  for (const zoom of [1, 2, 6]) {
    const roll = zoom === 1 ? 0 : zoom === 2 ? 60 : -120;
    const camera = { longitude, latitude, zoom, roll };
    const projection = geoOrthographic()
      .translate([224, 240])
      .scale(172 * zoom)
      .rotate([-longitude, -latitude, roll])
      .clipAngle(90)
      .clipExtent([
        [0, 0],
        [390, 480],
      ]);
    const detail = globeInteractionGeometry(
      terrainPolygons,
      projection.scale(),
      true,
    );
    const visible = globeVisibleTerrain(detail, projection, camera, 390, 480);
    const retained = new Set(visible.coordinates);
    for (const polygon of detail.coordinates) {
      if (retained.has(polygon)) continue;
      culledTerrainPolygons += 1;
      assert.equal(
        d3Geography.geoPath(projection)({
          type: "Polygon",
          coordinates: polygon,
        }),
        null,
        "Culling never removes terrain intersecting the viewport, including dateline and polar views",
      );
    }
    const borders = globeInteractionGeometry(
      detailedBorders,
      projection.scale(),
    );
    const visibleBorders = globeVisibleLines(
      borders,
      projection,
      camera,
      390,
      480,
    );
    culledBorderPoints +=
      pointCount(borders.coordinates) - pointCount(visibleBorders.coordinates);
    const projected = d3Geography.geoPath(projection);
    assert.equal(
      projected(visibleBorders),
      projected(borders),
      "Skipping offscreen boundaries leaves every visible border segment unchanged",
    );
  }
}
assert(
  culledTerrainPolygons > terrainPolygons.coordinates.length * 10,
  "Viewport culling skips a substantial share of terrain projection work",
);
assert(
  culledBorderPoints > pointCount(detailedBorders.coordinates) * 4,
  "Viewport culling also reduces base map work when terrain is disabled",
);

const surfaceSource = ts.createSourceFile(
  "historyGlobeSurface.ts",
  readFileSync("src/lib/historyGlobeSurface.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const surfaceFactory = surfaceSource.statements
  .find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createGlobeSurface",
  )
  .getText(surfaceSource)
  .replace(/^export /u, "");
const surfaceUniforms = new Map();
const surfaceEvents = new Map();
let restoredSurfaces = 0;
const surfaceGl = new Proxy(
  {
    getParameter: () => 4096,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    isContextLost: () => false,
    getUniformLocation: (_, name) => name,
    uniform3f: (name, ...values) => surfaceUniforms.set(name, values),
    getExtension: () => ({ loseContext() {} }),
  },
  { get: (object, key) => object[key] ?? (() => {}) },
);
const surfaceCanvas = {
  width: 1,
  height: 1,
  getContext: () => surfaceGl,
  addEventListener: (name, handler) => surfaceEvents.set(name, handler),
  removeEventListener: (name) => surfaceEvents.delete(name),
};
const makeSurface = (canvas) =>
  evaluateGlobe(surfaceFactory, {
    document: { createElement: () => canvas },
    GLOBE_SURFACE_WIDTH: 2048,
  });
assert.equal(
  makeSurface({ getContext: () => null })(() => {}),
  null,
  "WebGL absence preserves the Canvas fallback",
);
const surface = makeSurface(surfaceCanvas)(() => {
  restoredSurfaces += 1;
});
assert.equal(
  surface.render(390, 480, start, { x: 0.5, y: 0.5 }),
  null,
  "An unprepared moving surface cannot replace the precise map",
);
surface.updateTexture({ width: 2048, height: 1024 });
for (const [longitude, latitude, roll] of [
  [105, 25, 0],
  [179, 80, 60],
  [-179, -70, -120],
  [-70, 30, 175],
]) {
  const camera = { longitude, latitude, roll, zoom: 3 };
  surface.render(390, 480, camera, { x: 0.7, y: 0.6 });
  const projection = geoOrthographic()
    .scale(1)
    .translate([0, 0])
    .rotate([-longitude, -latitude, roll]);
  for (const offset of [-20, 0, 20]) {
    const point = [longitude + offset, latitude * 0.8];
    const [x, y] = projection(point);
    const depth = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const world = surfaceUniforms
      .get("facing")
      .map(
        (value, axis) =>
          value * depth +
          surfaceUniforms.get("east")[axis] * x -
          surfaceUniforms.get("north")[axis] * y,
      );
    const lon = (point[0] * Math.PI) / 180,
      lat = (point[1] * Math.PI) / 180;
    const expected = [
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
    ];
    assert(
      world.every((value, axis) => Math.abs(value - expected[axis]) < 1e-8),
      "Moving texture and precise projection share the same longitude, latitude and roll",
    );
  }
}
surfaceEvents.get("webglcontextlost")({ preventDefault() {} });
assert.equal(surface.render(390, 480, start, { x: 0.5, y: 0.5 }), null);
surfaceEvents.get("webglcontextrestored")();
assert.equal(
  restoredSurfaces,
  2,
  "Context loss and recovery refresh the visible renderer",
);
assert.equal(
  surface.render(390, 480, start, { x: 0.5, y: 0.5 }),
  surfaceCanvas,
  "Restored WebGL uploads the retained texture before resuming",
);
surface.invalidate();
assert.equal(
  surface.render(390, 480, start, { x: 0.5, y: 0.5 }),
  null,
  "Terrain and filter changes cannot display stale textures",
);
surface.dispose();
assert.equal(surfaceEvents.size, 0, "Unmount removes context listeners");

console.log(
  `History globe projection, hemisphere, interaction, compass, ${regionCameraCases} region camera fits, ${globeDismissalCases} explanation dismissals with no residual selection or camera movement, actual all-subject filter/tag and river/desert hit handlers, pixel-budget, assets, menu migration and access checks passed.`,
);
