import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Apply after the general supplement builder. Preserve all other river groups.
// The input is the saved OSM API relation/full response, not a traced map image.
const input = process.argv[2];
assert(input, "Pass the saved /api/0.6/relation/405843/full.json response");
const raw = readFileSync(input);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const data = JSON.parse(raw);
const relation = data.elements.find(
  (item) => item.type === "relation" && item.id === 405843,
);
assert.equal(relation?.tags?.waterway, "river");
assert.equal(relation?.tags?.["name:en"], "Liao River");
const nodes = new Map(
  data.elements
    .filter((item) => item.type === "node")
    .map((item) => [item.id, [item.lon, item.lat]]),
);
const ways = new Map(
  data.elements
    .filter((item) => item.type === "way")
    .map((item) => [item.id, item]),
);
const members = relation.members.filter(
  (item) => item.type === "way" && item.role === "main_stream",
);
assert(members.length > 5, "Incomplete main-stream relation");
const coordinates = members.map(({ ref }) => {
  const way = ways.get(ref);
  assert.equal(way?.tags?.waterway, "river");
  return way.nodes.map((id) => {
    const point = nodes.get(id);
    assert(
      point &&
        point[0] > 121 &&
        point[0] < 125 &&
        point[1] > 40.5 &&
        point[1] < 44,
    );
    return point.map((value) => Number(value.toFixed(6)));
  });
});
for (let i = 1; i < coordinates.length; i++)
  assert.deepEqual(
    coordinates[i - 1].at(-1),
    coordinates[i][0],
    "Source ways must join without fabricated connecting lines",
  );
const mouth = coordinates.at(-1).at(-1);
assert(
  mouth[0] < 122 && mouth[1] > 40.7 && mouth[1] < 41.1,
  "The modern main stream ends at Panjin, not Yingkou/Daliao",
);
const name = "랴오허강",
  sourceId = "liao-osm-relation-405843";
const filename = "src/data/atlas/rivers-supplement.json";
const supplement = JSON.parse(readFileSync(filename, "utf8"));
supplement.features = supplement.features.filter(
  (item) => item.properties.name !== name,
);
supplement.features.push({
  type: "Feature",
  properties: {
    name,
    source: "OpenStreetMap",
    osmRelationId: 405843,
    osmWayIds: members.map((item) => item.ref),
  },
  geometry: { type: "MultiLineString", coordinates },
});
const asset = JSON.stringify(supplement);
writeFileSync(filename, asset);
const manifestPath = "src/data/atlas/rivers-supplement.sources.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const points = coordinates.flat();
const review = {
  name,
  osmWayIds: members.map((item) => item.ref),
  sourceIds: [sourceId],
  sourceNames: ["辽河"],
  ways: members.length,
  sourcePoints: points.length,
  outputPoints: points.length,
  bbox: [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ],
  coverage:
    "OSM relation 405843 main_stream members, retaining their order, vertices and shared endpoints. Modern main stream through Panjin; no Daliao/Yingkou substitution.",
};
manifest.sources = manifest.sources.filter((item) => item.id !== sourceId);
manifest.sources.push({
  id: sourceId,
  file: "liao-relation-405843.json",
  sha256: hash(raw),
  url: "https://api.openstreetmap.org/api/0.6/relation/405843/full.json",
  retrievedAt: "2026-10-20",
  relationVersion: relation.version,
  sourceElements: data.elements.length,
  includedNames: [name],
  processing:
    "No simplification or interpolation. Retain main_stream member ways and round WGS84 vertices to six decimals.",
});
manifest.rivers = manifest.rivers.filter((item) => item.name !== name);
manifest.rivers.push(review);
manifest.requestedCoverage = manifest.requestedCoverage.filter(
  (item) => item.name !== name,
);
manifest.requestedCoverage.push({
  name,
  status: "supplement",
  wayCount: members.length,
});
manifest.featureCount = supplement.features.length;
manifest.wayCount = supplement.features.reduce(
  (sum, item) => sum + item.properties.osmWayIds.length,
  0,
);
manifest.sha256 = hash(asset);
manifest.bytes = Buffer.byteLength(asset);
manifest.processing += manifest.processing.includes("Liao")
  ? ""
  : " Liao main-stream amendment: retain unsimplified OSM relation member ways; see per-source processing.";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Liao main stream: ${members.length} ways, ${points.length} vertices; Panjin mouth ${mouth}; supplement ${manifest.bytes} bytes`,
);
