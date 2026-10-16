"""Build source-backed selectable areas, without runtime network requests.

Usage: python scripts/build-history-atlas-areas.py osm-directory YYYY-MM-DD
Dependencies: shapely. Original inputs are downloaded separately and hashed below.
Each input is api.openstreetmap.org/api/0.6/relation/{id}/full.json saved as {id}.json.
Eight familiar filter names group complete current administrative divisions.
"""
import hashlib
import json
from pathlib import Path
import sys

from shapely import make_valid, set_precision
from shapely.geometry import LineString, MultiPolygon, Point, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import polygonize_full, unary_union

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "src/data/atlas"
OSM_URL = "https://api.openstreetmap.org/api/0.6/relation/2297419/full.json"
PROVINCES = [
    ("gyeonggi", "경기도", [2306392, 2297418, 2297419, 5455268]),
    ("gangwon", "강원도", [2308426, 356535]),
    ("chungcheong", "충청도", [2327258, 2327259, 2349984, 2349795]),
    ("jeolla", "전라도", [2355168, 21039457, 2398560]),
    ("gyeongsang", "경상도", [2304454, 2393403, 2396450, 2395674, 2395867]),
    ("hwanghae", "황해도", [356442, 356533]),
    ("pyeongan", "평안도", [356419, 356540, 356443, 5453650, 356392]),
    ("hamgyeong", "함경도", [356386, 3781418, 356379, 6648083]),
]


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [part for item in geometry.geoms for part in polygons(item)] if hasattr(geometry, "geoms") else []


def normalized(geometry, tolerance=0.002):
    # Topology-preserving simplification in source WGS84 degrees (~220 m).
    # Retain islands and holes; repair malformed source rings before union.
    repaired = unary_union(polygons(make_valid(geometry)))
    result = set_precision(repaired.simplify(tolerance, preserve_topology=True), 0.000001)
    return MultiPolygon([orient(part, sign=-1) for part in polygons(result)])


def round_coordinates(value):
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item) for item in value]
    return round(value, 6)


def feature(properties, geometry, preferred=None):
    anchor = Point(preferred) if preferred else max(geometry.geoms, key=lambda p: p.area).representative_point()
    assert geometry.covers(anchor), properties["id"]
    properties["coordinates"] = [round(anchor.x, 6), round(anchor.y, 6)]
    geojson = mapping(geometry)
    geojson["coordinates"] = round_coordinates(geojson["coordinates"])
    assert shape(geojson).is_valid, properties["id"]
    return {"type": "Feature", "properties": properties, "geometry": geojson}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_boundary(path, relation_id):
    osm = json.loads(path.read_text(encoding="utf-8-sig"))
    elements = {(element["type"], element["id"]): element for element in osm["elements"]}
    relation = elements["relation", relation_id]
    assert relation["tags"]["boundary"] == "administrative"
    assert relation["tags"]["admin_level"] == "4"
    rings = {}
    for role in ("outer", "inner"):
        lines = []
        for member in relation["members"]:
            if member["type"] != "way" or member["role"] != role:
                continue
            way = elements["way", member["ref"]]
            lines.append(LineString([(elements["node", node]["lon"], elements["node", node]["lat"]) for node in way["nodes"]]))
        parts, cuts, dangles, invalid_rings = polygonize_full(lines)
        assert cuts.is_empty and dangles.is_empty and invalid_rings.is_empty, f"Incomplete administrative boundary: {relation_id}/{role}"
        rings[role] = unary_union(parts)
    boundary = rings["outer"].difference(rings["inner"])
    assert not boundary.is_empty
    evidence = {
        "id": relation_id, "name": relation["tags"]["name"],
        "iso3166_2": relation["tags"].get("ISO3166-2"),
        "version": relation["version"], "timestamp": relation["timestamp"],
        "sourceUrl": f"https://api.openstreetmap.org/api/0.6/relation/{relation_id}/full.json",
        "sourceSha256": digest(path),
    }
    return boundary, evidence


source_directory = Path(sys.argv[1])
snapshot_date = sys.argv[2]
assert len(snapshot_date) == 10 and snapshot_date[4] == snapshot_date[7] == "-"
land_path = OUTPUT / "land-korea.json"
land = shape(json.loads(land_path.read_text(encoding="utf-8")))
dokdo_path = OUTPUT / "dokdo-islands.json"
dokdo = normalized(unary_union([
    shape(item["geometry"]) for item in json.loads(dokdo_path.read_text(encoding="utf-8"))["features"]
]), 0)
by_id = {
    relation_id: read_boundary(source_directory / f"{relation_id}.json", relation_id)
    for _, _, ids in PROVINCES for relation_id in ids
}
assert len(by_id) == 29
features, province_evidence = [], []
for region_id, name, ids in PROVINCES:
    selected = [by_id[relation_id] for relation_id in ids]
    administrative = unary_union([make_valid(item[0]) for item in selected])
    geometry = normalized(administrative.intersection(land))
    if region_id == "gyeongsang":
        assert administrative.covers(dokdo), "Detailed islands must stay inside the current source boundary"
        # The overview Natural Earth land omits these tiny islands. Use the same
        # detailed current coastline already displayed by both map viewers.
        geometry = MultiPolygon([
            part for part in geometry.geoms
            if not (131.85 <= part.bounds[0] <= part.bounds[2] <= 131.88 and 37.23 <= part.bounds[1] <= part.bounds[3] <= 37.25)
        ] + list(dokdo.geoms))
    members = "·".join(item[1]["name"] for item in selected)
    note = f"현재 {members}의 행정 경계를 묶은 탐색 범위이다."
    features.append(feature({
        "id": f"province-{region_id}", "regionId": region_id, "name": name,
        "locationNote": note, "source": f"© OpenStreetMap contributors · 현재 행정 경계 ({snapshot_date})",
        "sourceUrl": "https://www.openstreetmap.org/copyright",
    }, geometry))
    province_evidence.append({"regionId": region_id, "sourceRecords": [item[1] for item in selected]})

# Only reviewed, active island places. Do not infer whole-island scope from a
# city, historical state or archipelago name, and do not change map curation.
island_specs = [
    ("ganghwa", "강화도", [126.49, 37.75], [126.3, 37.5, 126.6, 37.9],
     "주변 섬을 포함한 강화군 전체나 고려·조선시대 해안선을 뜻하지 않는다."),
    ("jeju", "제주도", [126.53, 33.42], [126.1, 33.1, 127, 33.6],
     "주변 섬을 포함한 제주특별자치도 전체나 삼별초의 전투 범위를 뜻하지 않는다."),
    ("hansando", "한산도", [128.48, 34.77], [128.45, 34.75, 128.52, 34.83],
     "한산도 대첩의 해전 범위나 함대 이동 경로를 뜻하지 않는다."),
]
island_evidence = []
for place_id, name, point, envelope, scope_note in island_specs:
    matches = [(index, part) for index, part in enumerate(land.geoms) if part.contains(Point(point))]
    assert len(matches) == 1, place_id
    index, island = matches[0]
    west, south, east, north = island.bounds
    assert envelope[0] < west < east < envelope[2] and envelope[1] < south < north < envelope[3], place_id
    features.append(feature({
        "id": f"place-{place_id}", "placeId": place_id, "name": name,
        "locationNote": f"Natural Earth의 현재 {name} 본섬 해안선을 표시한다. 축척 1:10,000,000의 일반화된 지형이며, {scope_note}",
        "source": "Natural Earth · 1:10,000,000 육지",
        "sourceUrl": "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/",
    }, normalized(island, 0), point))
    island_evidence.append({"placeId": place_id, "name": name, "sourcePolygonIndex": index, "interiorPoint": point, "bounds": list(island.bounds)})

boundary, incheon_evidence = by_id[2297419]
assert incheon_evidence["iso3166_2"] == "KR-28"
assert not boundary.is_empty and boundary.contains(Point(126.65, 37.47))
# Only the administrative boundary's land portion is shaded. Reuse the visible
# base coastline so marine jurisdiction is not presented as land or island size.
incheon = normalized(boundary.intersection(land), 0.0003)
features.append(feature({
    "id": "place-incheon", "placeId": "incheon", "name": "인천",
    "locationNote": "OpenStreetMap의 현재 인천광역시 행정 경계 안에서 Natural Earth 육지와 겹치는 범위를 표시한다. 일반화된 현대 참조 범위이며, 개항기 인천부나 인천 상륙 작전의 작전 구역을 뜻하지 않는다.",
    "source": "© OpenStreetMap contributors · Natural Earth",
    "sourceUrl": "https://www.openstreetmap.org/relation/2297419",
}, incheon, [126.65, 37.47]))

payload = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n"
(OUTPUT / "areas-korea.json").write_text(payload, encoding="utf-8", newline="\n")
metadata = {
    "coordinateSystem": "WGS84 longitude, latitude; D3 clockwise exterior rings",
    "assetSha256": hashlib.sha256(payload.encode()).hexdigest(),
    "administrative": {
        "source": "© OpenStreetMap contributors · current administrative boundaries",
        "sourceUrl": "https://www.openstreetmap.org/copyright",
        "license": "ODbL 1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "snapshotDate": snapshot_date,
        "notes": "Complete current admin-level-4 polygons grouped under eight familiar navigation names; no historic boundary geometry. Seoul, Incheon and Kaesong join Gyeonggi; Jeju joins Jeolla; Jagang joins Pyeongan; Ryanggang and Rason join Hamgyeong. These are navigation groupings, not assertions of administrative subordination. Current Jeonnam-Gwangju unified city is one source relation. Intersect with existing modern base land; topology-preserving simplification 0.002 degrees, six decimal precision grid; no island area threshold.",
        "administrativeUpdateEvidence": {"title": "전남광주통합특별시 · 2026년 7월 1일 행정통합", "url": "https://www.jeonnam.go.kr/"},
        "provinces": province_evidence,
    },
    "incheon": {
        "source": "© OpenStreetMap contributors", "sourceUrl": OSM_URL,
        "license": "ODbL 1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attributionUrl": "https://www.openstreetmap.org/copyright",
        "sourceSha256": incheon_evidence["sourceSha256"], "relationId": incheon_evidence["id"],
        "relationVersion": incheon_evidence["version"], "relationTimestamp": incheon_evidence["timestamp"],
        "snapshotDate": snapshot_date,
        "notes": "Current administrative polygon intersected with the existing Natural Earth base land; topology-preserving simplification 0.0003 degrees. No new sovereign or historic-territory attributes.",
    },
    "land": {
        "file": "land-korea.json", "sourceSha256": digest(land_path),
        "source": "Natural Earth", "license": "Public domain",
        "sourceUrl": "https://www.naturalearthdata.com/about/terms-of-use/",
        "revision": "ca96624a56bd078437bca8184e78163e5039ad19",
        "notes": "Reviewed active island places retain their original base-map main-island polygons, without additional simplification. No administrative province, historic battle extent, mainland, nearby island or archipelago inference.",
        "islands": island_evidence,
        "detailedIslands": {"file": "dokdo-islands.json", "sourceSha256": digest(dokdo_path), "source": "© OpenStreetMap contributors", "license": "ODbL 1.0", "sourceUrl": "https://www.openstreetmap.org/copyright", "notes": "Existing detailed current Dokdo coastline included in Gyeongsang after containment in its current administrative polygon is verified. See dokdo-islands.sources.json for individual source way versions."},
    },
}
(OUTPUT / "areas-korea.sources.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"Selectable areas: {len(features)}; {len(payload.encode())} bytes")
