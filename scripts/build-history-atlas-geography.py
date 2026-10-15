"""Build small, self-hosted physical layers from pinned Natural Earth data.

Run with Python + shapely. Original textbook files are never read by this build.
Coastline vertices are preserved (six decimal output); no AI tracing or warping.
Outer rings use D3's clockwise spherical winding. Modern borders are excluded.
"""
import hashlib
import json
import pathlib
import urllib.request
import argparse
from shapely.geometry import shape, mapping, box, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/data/atlas"
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/"
KOREA_BOUNDS = [90, 10, 160, 65]
SOURCE_CACHE = None
PINNED_RIVER_HASHES = {
    "ne_50m_rivers_lake_centerlines": "f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51",
    "ne_10m_rivers_lake_centerlines": "bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a",
}
manifest = {
    "source": "Natural Earth",
    "license": "Public domain",
    "url": "https://www.naturalearthdata.com/about/terms-of-use/",
    "revision": REVISION,
    "coordinateSystem": "WGS84 longitude, latitude",
    "notes": "Modern physical geography, not historical coastlines or political boundaries. Small-scale generalized source, not a survey map. D3 clockwise outer rings; coordinate rounding to 6 decimals. No additional simplification.",
    "layers": [],
}

def load(name):
    url = BASE + name + ".geojson"
    cached = SOURCE_CACHE / (name + ".geojson") if SOURCE_CACHE else None
    if cached and cached.exists() and name in PINNED_RIVER_HASHES:
        raw = cached.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=120) as response:
            raw = response.read()
    digest = hashlib.sha256(raw).hexdigest()
    if name in PINNED_RIVER_HASHES and digest != PINNED_RIVER_HASHES[name]:
        raise ValueError(f"Source does not match pinned revision: {name}")
    return json.loads(raw), url, digest

def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value

def write(name, data, url, source_hash, scale, bounds=None, additional_sources=None):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(rounded(data), ensure_ascii=False, separators=(",", ":")).encode()
    (OUTPUT / (name + ".json")).write_bytes(encoded)
    layer = {"file": name + ".json", "source": url, "sourceSha256": source_hash, "sha256": hashlib.sha256(encoded).hexdigest(), "sourceScale": scale, "clipBounds": bounds, "bytes": len(encoded)}
    if additional_sources:
        layer["additionalSources"] = additional_sources
    existing_index = next((index for index, value in enumerate(manifest["layers"]) if value["file"] == layer["file"]), None)
    if existing_index is None:
        manifest["layers"].append(layer)
    else:
        manifest["layers"][existing_index] = layer
    print(name, len(encoded))

def make_land(name, source, scale, bounds=None):
    data, url, digest = load(source)
    geometries = [shape(f["geometry"]) for f in data["features"]]
    # Union removes boundaries between source polygons, not coastline vertices.
    geometry = unary_union(geometries)
    if bounds:
        geometry = geometry.intersection(box(*bounds))
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    geometry = MultiPolygon([orient(p, sign=-1) for p in polygons if isinstance(p, Polygon)])
    write(name, mapping(geometry), url, digest, scale, bounds)

def make_rivers(name, source, scale, bounds=None, supplement_rivernums=None):
    data, url, digest = load(source)
    features = []
    additional_sources = []
    source_features = list(data["features"])
    if supplement_rivernums:
        supplement, supplement_url, supplement_hash = load("ne_10m_rivers_lake_centerlines")
        added = [feature for feature in supplement["features"] if feature["properties"].get("rivernum") in supplement_rivernums]
        added.sort(key=lambda feature: supplement_rivernums.index(feature["properties"]["rivernum"]))
        if {feature["properties"]["rivernum"] for feature in added} != set(supplement_rivernums):
            raise ValueError("Requested 10m supplement rivers were not found")
        if any(feature["properties"].get("rivernum") in supplement_rivernums for feature in source_features):
            raise ValueError("Supplement river already exists in the base layer")
        source_features.extend(added)
        additional_sources.append({"source": supplement_url, "sourceSha256": supplement_hash,
                                   "sourceScale": "1:10,000,000", "rivernums": supplement_rivernums,
                                   "names": sorted({feature["properties"]["name"] for feature in added}),
                                   "featureCount": len(added)})
    for feature in source_features:
        geometry = shape(feature["geometry"])
        if bounds:
            geometry = geometry.intersection(box(*bounds))
        if geometry.is_empty:
            continue
        if geometry.geom_type not in ("LineString", "MultiLineString"):
            continue
        properties = {key: feature["properties"][key] for key in ("name", "name_en", "name_alt", "rivernum") if feature["properties"].get(key) is not None}
        features.append({"type": "Feature", "properties": properties, "geometry": mapping(geometry)})
    write(name, {"type": "FeatureCollection", "features": features}, url, digest, scale, bounds, additional_sources)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--rivers-only", action="store_true", help="Preserve existing coastline assets and rebuild named river layers.")
    mode.add_argument("--world-rivers-only", action="store_true", help="Preserve land and Korea assets; rebuild only world rivers.")
    parser.add_argument("--source-cache", type=pathlib.Path, help="Use locally cached river sources only after checking their pinned SHA-256.")
    args = parser.parse_args()
    SOURCE_CACHE = args.source_cache
    if args.rivers_only or args.world_rivers_only:
        existing = json.loads((OUTPUT / "sources.json").read_text(encoding="utf-8"))
        manifest["layers"] = existing["layers"]
    else:
        make_land("land-world", "ne_50m_land", "1:50,000,000")
        make_land("land-korea", "ne_10m_land", "1:10,000,000", KOREA_BOUNDS)
    make_rivers("rivers-world", "ne_50m_rivers_lake_centerlines", "1:50,000,000", supplement_rivernums=[873, 553, 611, 458])
    if not args.world_rivers_only:
        make_rivers("rivers-korea", "ne_10m_rivers_lake_centerlines", "1:10,000,000", KOREA_BOUNDS)
    (OUTPUT / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
