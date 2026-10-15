"""Build source-backed selectable areas, without runtime network requests.

Usage: python scripts/build-history-atlas-areas.py historical.gpkg incheon-osm.json
Dependencies: shapely. Original inputs are downloaded separately and hashed below.
The official historical layer begins in 1910; it is not an exact Joseon boundary.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

from shapely import from_wkb, make_valid, set_precision
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import polygonize_full, unary_union

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "src/data/atlas"
HISTORICAL_URL = "https://hgis.history.go.kr/pro_g1/dataset.do"
OSM_URL = "https://api.openstreetmap.org/api/0.6/relation/2297419/full.json"
PROVINCES = [
    ("gyeonggi", "경기도", ["경기도", "한성부"]),
    ("gangwon", "강원도", ["강원도"]),
    ("chungcheong", "충청도", ["충청남도", "충청북도"]),
    ("jeolla", "전라도", ["전라남도", "전라북도"]),
    ("gyeongsang", "경상도", ["경상남도", "경상북도"]),
    ("hwanghae", "황해도", ["황해도"]),
    ("pyeongan", "평안도", ["평안남도", "평안북도"]),
    ("hamgyeong", "함경도", ["함경남도", "함경북도"]),
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


def gpkg_geometry(blob):
    assert blob[:2] == b"GP"
    envelope = (blob[3] >> 1) & 7
    header_size = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
    return from_wkb(blob[header_size:])


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


historical_path, osm_path = map(Path, sys.argv[1:3])
connection = sqlite3.connect(historical_path)
table = next(row[0] for row in connection.execute("select table_name from gpkg_geometry_columns where geometry_type_name='MULTIPOLYGON'"))
records = list(connection.execute(
    f'SELECT id, name, geom, geom_ref, trust FROM "{table}" WHERE lv=1 AND begin <= ? AND end >= ?',
    ("19100510", "19100510"),
))
by_name = {row[1]: row for row in records}
assert len(by_name) == 14
features, province_evidence = [], []
for region_id, name, names in PROVINCES:
    selected = [by_name[source_name] for source_name in names]
    geometry = normalized(unary_union([make_valid(gpkg_geometry(row[2])) for row in selected]))
    note = "1910년 도 경계를 남·북도별로 합친 8도 탐색 범위이다. 국사편찬위원회가 복원한 1910년 5월 10일 경계를 사용하며, 조선 전 시기의 경계가 같았다는 뜻은 아니다."
    if region_id == "gyeonggi":
        note += " 한성부는 탐색을 위해 함께 표시하며 경기도 소속이었다는 뜻은 아니다."
    features.append(feature({
        "id": f"province-{region_id}", "regionId": region_id, "name": name,
        "locationNote": note, "source": "국사편찬위원회 역사지리정보DB · 1910년 5월 10일",
        "sourceUrl": HISTORICAL_URL,
    }, geometry))
    province_evidence.append({"regionId": region_id, "sourceRecords": [
        {"id": row[0], "name": row[1], "geometryReference": row[3], "sourceTrustCode": row[4]}
        for row in selected
    ]})

land_path = OUTPUT / "land-korea.json"
land = shape(json.loads(land_path.read_text(encoding="utf-8")))
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

osm = json.loads(osm_path.read_text(encoding="utf-8"))
elements = {(element["type"], element["id"]): element for element in osm["elements"]}
relation = elements["relation", 2297419]
assert relation["tags"]["ISO3166-2"] == "KR-28"
lines = []
for member in relation["members"]:
    if member["type"] != "way" or member["role"] not in ("outer", "inner"):
        continue
    assert member["role"] == "outer", "Inner rings need explicit subtraction"
    way = elements["way", member["ref"]]
    lines.append(LineString([(elements["node", node]["lon"], elements["node", node]["lat"]) for node in way["nodes"]]))
boundary_parts, cuts, dangles, invalid_rings = polygonize_full(lines)
assert cuts.is_empty and dangles.is_empty and invalid_rings.is_empty, "Incomplete administrative boundary"
boundary = unary_union(boundary_parts)
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
    "historical": {
        "source": "국사편찬위원회 역사지리정보DB · 행정구역 GIS 데이터 (1910~1945년)",
        "sourceUrl": HISTORICAL_URL,
        "download": {"url": "https://hgis.history.go.kr/pro_g1/fileDownload.do", "method": "POST", "fileName": "data_set_03_01.zip"},
        "sourceSha256": digest(historical_path),
        "boundaryDate": "1910-05-10", "datasetUpdated": "2025-04-24",
        "usage": "Official open dataset; retain National Institute of Korean History attribution. Source describes restored boundaries as research references without legal effect.",
        "notes": "Dissolved north/south provinces; Hanseong included in Gyeonggi navigation only. Never a claim of identical boundaries in all Joseon eras. Source geometry reference/trust codes retained below. make_valid repairs source rings; topology-preserving simplification 0.002 degrees, six decimal precision grid removes only sub-grid collapsed slivers. No island area threshold.",
        "provinces": province_evidence,
    },
    "incheon": {
        "source": "© OpenStreetMap contributors", "sourceUrl": OSM_URL,
        "license": "ODbL 1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attributionUrl": "https://www.openstreetmap.org/copyright",
        "sourceSha256": digest(osm_path), "relationId": relation["id"],
        "relationVersion": relation["version"], "relationTimestamp": relation["timestamp"],
        "notes": "Current administrative polygon intersected with the existing Natural Earth base land; topology-preserving simplification 0.0003 degrees. No new sovereign or historic-territory attributes.",
    },
    "land": {
        "file": "land-korea.json", "sourceSha256": digest(land_path),
        "source": "Natural Earth", "license": "Public domain",
        "sourceUrl": "https://www.naturalearthdata.com/about/terms-of-use/",
        "revision": "ca96624a56bd078437bca8184e78163e5039ad19",
        "notes": "Reviewed active island places retain their original base-map main-island polygons, without additional simplification. No administrative province, historic battle extent, mainland, nearby island or archipelago inference.",
        "islands": island_evidence,
    },
}
(OUTPUT / "areas-korea.sources.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"Selectable areas: {len(features)}; {len(payload.encode())} bytes")
