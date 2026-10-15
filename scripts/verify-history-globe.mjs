import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
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
const { MENUS, sanitizeMenuConfig } = load("src/constants/menus.ts");
for (const portal of ["student", "teacher"]) {
  const expected = "/" + portal + "/lesson/globe";
  assert.equal(
    MENUS[portal]
      .flatMap((item) => item.children || [])
      .filter((item) => item.url === expected).length,
    1,
    "Separate globe menu",
  );
  const old = JSON.parse(JSON.stringify(MENUS));
  old[portal].forEach((item) => {
    if (item.children)
      item.children = item.children.filter((child) => child.url !== expected);
  });
  assert(
    sanitizeMenuConfig(old)
      [portal].flatMap((item) => item.children || [])
      .some((item) => item.url === expected),
    "Saved older menus receive new globe menu",
  );
}
const { canAccessTeacherPath } = load("src/lib/permissions.ts");
assert(
  canAccessTeacherPath("/teacher/lesson/globe", {
    role: "staff",
    teacherPortalEnabled: true,
    staffPermissions: ["lesson_read"],
  }),
);
assert(
  !canAccessTeacherPath("/teacher/lesson/globe", {
    role: "staff",
    teacherPortalEnabled: true,
    staffPermissions: ["quiz_read"],
  }),
);
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
