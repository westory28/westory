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
      .filter((item) => item.url === legacyUrl).length,
    0,
    "Globe is a map tab, not a separate sidebar item",
  );
  const old = JSON.parse(JSON.stringify(MENUS));
  const lessonMenu = old[portal].find((item) =>
    item.children?.some((child) => child.url === mapsUrl),
  );
  lessonMenu.children.push({ name: "기존 지구본", url: legacyUrl });
  lessonMenu.children.find((child) => child.url === mapsUrl).hidden = true;
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
const dependencies = {
  react: { ...React, default: React },
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
assert.equal(rendered.props.onOpenOriginals, undefined);
press(rendered, "세계사");
rendered = renderMaps();
assert.equal(rendered.props.initialSubject, "world");
const worldKey = rendered.key;
press(rendered, "지구본");
rendered = renderMaps();
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
  source.includes("GLOBE_FRAME_INTERVAL"),
  "Input frame cap remains wired",
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
  "Expanding or collapsing source details must re-fit the selected geometry",
);
assert(
  globeEffects
    .find((effect) =>
      effect.arguments[0].getText(globeAst).includes("drawRef.current ="),
    )
    .arguments[1].getText(globeAst)
    .includes("popupSize"),
  "Source detail resizing must redraw labels and selection anchors",
);
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
  2,
  "Repeated tag activation returns its pin to the view",
);
assert.equal(pendingPanelFocus.current, "detail");
assert(
  Math.abs(
    selectionState.camera.longitude - testItems[0].place.coordinates[0],
  ) < 1e-9,
);
assert(
  Math.abs(selectionState.camera.latitude - testItems[0].place.coordinates[1]) <
    1e-9,
);
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
          highlightedShape: feature,
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
for (const moved of [false, true]) {
  selectedShapeEntry = undefined;
  evaluateGlobe(endPointerExpression, {
    gesture: { current: { moved, multiple: false } },
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
assert.equal(countrySelectionState.Panel, "list");
chooseCountry("missing-country");
assert.equal(
  countrySelectionState.SelectedCountryId,
  "KOR",
  "Unknown countries do not change selection",
);
for (const moved of [false, true]) {
  let selectedCountry;
  evaluateGlobe(endPointerExpression, {
    gesture: { current: { moved, multiple: false } },
    pointers: { current: new Map([[1, { x: 100, y: 100 }]]) },
    localPointer: () => ({ x: 100, y: 100 }),
    drawnPoints: { current: [] },
    nearestGlobePoint: m.nearestGlobePoint,
    hitGeography: { current: () => null },
    hitCountry: { current: () => ({ properties: { id: "KOR" } }) },
    chooseCountry: (id) => {
      selectedCountry = id;
    },
    commitView() {},
  })({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
  assert.equal(
    selectedCountry,
    moved ? undefined : "KOR",
    "Country selection follows only deliberate background clicks, never dragging",
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

console.log(
  `History globe projection, hemisphere, interaction, compass, ${regionCameraCases} region camera fits, actual all-subject filter/tag and river/desert hit handlers, pixel-budget, assets, menu migration and access checks passed.`,
);
