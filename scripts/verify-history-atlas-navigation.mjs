import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";
import * as geography from "d3-geo";

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
const dataset = load("src/data/historyAtlasContent.ts").historyAtlasDataset;
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
} = load("src/lib/historyAtlasGeometry.ts");
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
  const item = dataset.places.find((item) => item.name === name);
  assert(item, name);
  return item;
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
  mountainExtent[2] - mountainExtent[0] >= 9 &&
    mountainExtent[3] - mountainExtent[1] >= 10,
  "Selection must preserve peninsula-scale geographic context",
);

// The previous +/-80 degree cap never contained three actual northern places,
// so selection repeatedly allocated the same bounds and reset the camera.
const polarPlaces = dataset.places.filter(
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
  for (const width of [390, 624, 690, 900]) {
    const height = width === 390 ? 400 : 640;
    const overlayRight = width === 390 ? 0 : 376;
    const projection = createAtlasProjection("world", bounds, width, height);
    const camera = fitAtlasSelection(
      projection,
      { coordinates: item.coordinates, contextBounds: extent },
      { width, height, overlayRight },
    );
    const point = projection(item.coordinates);
    const x = point[0] * camera.scale + camera.x;
    const y = point[1] * camera.scale + camera.y;
    assert(
      Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= overlayRight + 24 - 1e-6 &&
        x <= width - 24 + 1e-6 &&
        y >= 24 - 1e-6 &&
        y <= height - 24 + 1e-6,
      `${item.name} at ${width}px: polar selection must stay visible beside its card`,
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
      ? dataset.units
          .filter((unit) => unit.subject === subject)
          .map((unit) => unit.bounds)
      : []),
  ];
  for (const baseBounds of initialBounds)
    for (const width of [624, 690, 900]) {
      const height = 640,
        overlayRight = 376;
      const bounds = includeAtlasContextBounds(baseBounds, extent);
      const projection = createAtlasProjection(subject, bounds, width, height);
      const originalProjection = [
        projection.scale(),
        ...projection.translate(),
        ...projection.rotate(),
      ];
      const camera = fitAtlasSelection(
        projection,
        { coordinates, contextBounds: extent, geometry: river },
        { width, height, overlayRight },
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
      assert(
        left >= overlayRight + 24 - 1e-6 &&
          right <= width - 24 + 1e-6 &&
          top >= 24 - 1e-6 &&
          bottom <= height - 24 + 1e-6,
        `${name} at ${width}px: the full selection must remain beside the card and inside the viewport, got ${JSON.stringify({ left, top, right, bottom, camera })}`,
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
console.log(
  `Atlas navigation checks passed: ${supplement.features.length} supplemental river features, ${cameraCases} real-data camera fits, ${polarCameraCases} polar camera fits, full river extents, conservative selection scale, verified definition, no alias identity substitution. Globe SHA256 ${createHash("sha256").update(globeBytes).digest("hex").slice(0, 12)}.`,
);
