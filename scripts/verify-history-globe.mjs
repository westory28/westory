import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { geoOrthographic, geoArea, geoContains } from "d3-geo";
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
        assert(name.startsWith("."));
        return load(resolve(dirname(path), name + ".ts"));
      },
    },
  );
  return exports;
};
const m = load("src/lib/historyGlobeMath.ts");
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
assert.equal(contentOf(rendered).props.initialSubject, "world");
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
  "world",
  "A legacy globe link defaults to world history",
);
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
console.log(
  "History globe projection, hemisphere, interaction, pixel-budget, assets, menu migration and access checks passed.",
);
