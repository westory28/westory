"""Build small, self-hosted physical layers from pinned Natural Earth data.

Run with Python + shapely. Original textbook files are never read by this build.
Coastline vertices are preserved (six decimal output); no AI tracing or warping.
Outer rings use D3's clockwise spherical winding. Modern borders are excluded.
"""
import hashlib
import json
import pathlib
import urllib.request
from shapely.geometry import shape, mapping, box, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/data/atlas"
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/"
KOREA_BOUNDS = [90, 10, 160, 65]
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
    with urllib.request.urlopen(url, timeout=120) as response:
        raw = response.read()
    return json.loads(raw), url, hashlib.sha256(raw).hexdigest()

def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value

def write(name, data, url, source_hash, scale, bounds=None):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(rounded(data), ensure_ascii=False, separators=(",", ":")).encode()
    (OUTPUT / (name + ".json")).write_bytes(encoded)
    manifest["layers"].append({"file": name + ".json", "source": url, "sourceSha256": source_hash, "sha256": hashlib.sha256(encoded).hexdigest(), "sourceScale": scale, "clipBounds": bounds, "bytes": len(encoded)})
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

def make_rivers(name, source, scale, bounds=None):
    data, url, digest = load(source)
    features = []
    for feature in data["features"]:
        geometry = shape(feature["geometry"])
        if bounds:
            geometry = geometry.intersection(box(*bounds))
        if geometry.is_empty:
            continue
        if geometry.geom_type not in ("LineString", "MultiLineString"):
            continue
        features.append({"type": "Feature", "properties": {}, "geometry": mapping(geometry)})
    write(name, {"type": "FeatureCollection", "features": features}, url, digest, scale, bounds)

if __name__ == "__main__":
    make_land("land-world", "ne_50m_land", "1:50,000,000")
    make_land("land-korea", "ne_10m_land", "1:10,000,000", KOREA_BOUNDS)
    make_rivers("rivers-world", "ne_50m_rivers_lake_centerlines", "1:50,000,000")
    make_rivers("rivers-korea", "ne_10m_rivers_lake_centerlines", "1:10,000,000", KOREA_BOUNDS)
    (OUTPUT / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
