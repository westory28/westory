import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  geoArea,
  geoBounds,
  geoCentroid,
  geoContains,
  geoDistance,
} from "d3-geo";

// Keep geography reproducible and independent of changing remote data at runtime.
const revision = "ca96624a56bd078437bca8184e78163e5039ad19";
const base = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/`;
const sources = {};
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function read(name) {
  const url = `${base}${name}.geojson`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const source = await response.text();
  sources[name] = { url, sha256: hash(source) };
  return JSON.parse(source).features;
}
const [boundaries, rivers, regions, marine, countries, regionalRivers] =
  await Promise.all([
    read("ne_110m_admin_0_boundary_lines_land"),
    read("ne_110m_rivers_lake_centerlines"),
    read("ne_110m_geography_regions_polys"),
    read("ne_110m_geography_marine_polys"),
    read("ne_110m_admin_0_countries"),
    read("ne_50m_rivers_lake_centerlines"),
  ]);
const rounded = (coordinates) =>
  coordinates.map((value) =>
    Array.isArray(value) ? rounded(value) : Math.round(value * 10000) / 10000,
  );
const lines = (features) => ({
  type: "MultiLineString",
  coordinates: features.flatMap(({ geometry }) =>
    geometry.type === "LineString"
      ? [rounded(geometry.coordinates)]
      : rounded(geometry.coordinates),
  ),
});
const polygons = (features) => ({
  type: "MultiPolygon",
  coordinates: features.flatMap(({ geometry }) => {
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates;
    return polygons.map((coordinates) => {
      const polygon = { type: "Polygon", coordinates: rounded(coordinates) };
      if (geoArea(polygon) > Math.PI * 2)
        polygon.coordinates.forEach((ring) => ring.reverse());
      return polygon.coordinates;
    });
  }),
});
const boundaryClass = (feature) =>
  feature.properties.FCLASS_KO || feature.properties.FEATURECLA;
const visibleBoundaries = boundaries.filter(
  (feature) =>
    !["Unrecognized", "Admin-1 boundary"].includes(boundaryClass(feature)),
);
const normalBoundary = (feature) =>
  boundaryClass(feature).startsWith("International boundary");
const selectedRegions = regions.filter((feature) =>
  ["Desert", "Range/mtn", "Plateau", "Basin"].includes(
    feature.properties.FEATURECLA,
  ),
);
const labels = [];
const seenLabels = new Set();
function representative(feature) {
  const center = geoCentroid(feature);
  if (geoContains(feature, center)) return center;
  // A curved polar feature's spherical centroid can lie outside its polygon.
  // Pick the closest interior sample, rather than putting its name over land.
  const bounds = geoBounds(feature);
  let point,
    distance = Infinity;
  for (
    let latitude = Math.ceil(bounds[0][1]);
    latitude <= bounds[1][1];
    latitude += 1
  ) {
    for (let longitude = -180; longitude < 180; longitude += 2) {
      const candidate = [longitude, latitude];
      const nextDistance = geoDistance(center, candidate);
      if (nextDistance < distance && geoContains(feature, candidate)) {
        point = candidate;
        distance = nextDistance;
      }
    }
  }
  if (!point)
    throw new Error(
      `No interior label point for ${feature.properties.NAME || feature.properties.name}`,
    );
  return point;
}
function label(name, kind, coordinates, minZoom, sourceName) {
  if (!name || !coordinates.every(Number.isFinite) || seenLabels.has(name))
    return;
  seenLabels.add(name);
  labels.push({
    name,
    kind,
    coordinates: rounded(coordinates),
    minZoom,
    sourceName,
  });
}
for (const feature of marine) {
  const p = feature.properties;
  // Use the familiar Korean curriculum name for the sea east of Korea.
  const marineNames = {
    "Sea of Japan": "동해",
    "North Pacific Ocean": "북태평양",
    "South Pacific Ocean": "남태평양",
    "North Atlantic Ocean": "북대서양",
    "South Atlantic Ocean": "남대서양",
  };
  const name = marineNames[p.name] || p.name_ko;
  label(
    name,
    "ocean",
    representative(feature),
    p.featurecla === "ocean" ? 1 : 2.5,
    p.name,
  );
}
for (const feature of selectedRegions) {
  const p = feature.properties;
  label(
    p.NAME_KO,
    p.FEATURECLA === "Desert" ? "desert" : "terrain",
    representative(feature),
    p.FEATURECLA === "Desert" ? 1 : 1.8,
    p.NAME,
  );
}
for (const feature of rivers) {
  const p = feature.properties;
  label(p.name_ko, "river", geoCentroid(feature), 2.3, p.name);
}
for (const feature of countries) {
  const p = feature.properties;
  if (p.FCLASS_KO === "Unrecognized") continue;
  label(
    p.NAME_KO,
    "country",
    [p.LABEL_X, p.LABEL_Y],
    Math.max(1.5, p.MIN_LABEL || 1.5),
    p.NAME,
  );
}
const geography = {
  borders: lines(visibleBoundaries.filter(normalBoundary)),
  disputedBorders: lines(
    visibleBoundaries.filter((feature) => !normalBoundary(feature)),
  ),
  rivers: lines(
    regionalRivers.filter((feature) => feature.properties.scalerank <= 4),
  ),
  deserts: polygons(
    regions.filter((feature) => feature.properties.FEATURECLA === "Desert"),
  ),
  labels,
};
const asset = JSON.stringify(geography) + "\n";
await writeFile("src/data/atlas/globe-geography.json", asset);
await writeFile(
  "src/data/atlas/globe-geography-source.json",
  JSON.stringify(
    {
      source: "Natural Earth",
      license: "Public domain",
      licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
      sourceScale: "1:110,000,000; rivers 1:50,000,000 (scale ranks 1–4)",
      revision,
      sources,
      assetSha256: hash(asset),
      notes: [
        "Modern boundaries and physical geography, not historical territorial extents. Natural Earth uses de facto boundaries. Disputed/indefinite/control lines are rendered dashed; Korean FCLASS_KO overrides are respected where provided.",
        "Source geometry is rounded to four decimal places, properties removed and lines combined. Desert polygon winding is normalized for d3 spherical rendering.",
        "Korean names come from Natural Earth's NAME_KO/name_ko fields (Wikidata CC0). Sea of Japan is displayed as 동해 for the Korean educational context; Pacific/Atlantic ocean labels distinguish north/south. Labels use Natural Earth country label points or spherical centroids, with an interior grid sample for centroids outside a polygon.",
        "Build with node scripts/build-history-globe-geography.mjs. Geography is bundled locally and fetched only when the globe is mounted.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Globe geography: ${asset.length} bytes, ${labels.length} Korean labels.`,
);
