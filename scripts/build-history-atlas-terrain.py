"""Rebuild source-backed terrain and traditional-region supplements.

Dependencies: shapely, pyshp, Pillow. Pass a cached source folder containing:
  ne_10m_geography_regions_polys.geojson (pinned Natural Earth revision below),
  gmba-basic.zip, jeju-admin.json, kaesong-admin.json (Nominatim OSM lookup),
  dem-7-{108..110}-{47..49}.png (Mapzen Terrarium elevation tiles).
See terrain.sources.json for URLs, checksums, licences and processing limits.
No network requests occur in the app or in this deterministic generation step.
"""
import hashlib
import io
import json
import math
import sys
import zipfile
from pathlib import Path

import shapefile
from PIL import Image
from shapely import make_valid, set_precision
from shapely.geometry import MultiPolygon, Point, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/data/atlas"
SOURCE = Path(sys.argv[1])
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
NE_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/ne_10m_geography_regions_polys.geojson"
GMBA_URL = "https://data.earthenv.org/mountains/standard/GMBA_Inventory_v2.0_standard_basic.zip"
NAME_ALIASES = {
    "맨추리안 플레인": "만주 평원", "널라버 플레인": "널러버 평원",
    "머레이 달링 베이신": "머리·달링 분지", "타리무 분지": "타림 분지",
    "중가 베이신": "중가르 분지", "타커라마간 사막": "타클라마칸 사막",
    "웨스턴 데저트": "서부 사막", "이스턴 사막": "동부 사막",
    "그레이트 솔트 레이크 데저트": "그레이트솔트레이크 사막",
    "카작 스텝": "카자흐 스텝", "카작 업랜드": "카자흐 고지",
    "코스탈 플레인": "해안 평원",
    "센트럴 로우랜드": "중앙 저지대", "센트럴 러시안 업랜드": "중앙 러시아 고지",
    "뉴 기니 하이랜즈": "뉴기니 고지", "오스트레일리안 알프스": "오스트레일리아 알프스",
    "알티 플래니시 멕시카나": "멕시코 고원", "샨 플래투": "샨 고원",
    "코랏 분지": "코랏 고원", "황투고원": "황토 고원", "윈구이고원": "윈구이 고원",
    "플라날토 도 마토 그로소": "마투그로수 고원", "웨스턴 플래투": "서부 고원",
    "체인 아나미틱": "안남산맥", "아펜니니": "아펜니노산맥",
    "어 리프": "리프산맥", "오트 아틀라스": "하이아틀라스산맥",
    "모옌 아틀라스": "중앙아틀라스산맥", "안티 아틀라스": "안티아틀라스산맥",
    "아틀라스 사하리엔": "사하라아틀라스산맥", "아틀라스 텔리엔": "텔아틀라스산맥",
    "웨스턴 사얀 마운틴스": "서사얀산맥", "이스턴 사얀 마운틴스": "동사얀산맥",
    "카탕가 플래투": "카탕가 고원", "폴라 플래투": "남극 고원",
    "N.I. 볼캐닉 플래투": "북섬 화산 고원",
}
label_changes = []


def korean_name(properties):
    original = properties.get("NAME_KO") or properties.get("NAME_EN") or properties["NAME"]
    name = NAME_ALIASES.get(original, original)
    # Translate generic physical-feature words, retaining each proper name.
    for ending, replacement in [("마운틴스", "산맥"), ("마운틴", "산맥"), ("레인지스", "산맥"), ("레인지", "산맥"), ("플래투", "고원"), ("하이랜즈", "고지"), ("하이랜드", "고지"), ("테이블랜드", "고원"), ("업랜드", "고지"), ("베이신", "분지"), ("데저트", "사막"), ("플레인스", "평원"), ("플레인", "평원")]:
        if name.endswith(ending):
            name = name[:-len(ending)].rstrip() + " " + replacement
            break
    if name != original:
        label_changes.append({"id": properties["NE_ID"], "sourceName": properties["NAME"], "originalKorean": original, "displayName": name})
    return name


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [p for item in geometry.geoms for p in polygons(item)] if hasattr(geometry, "geoms") else []


def normalized(geometry, tolerance):
    clean = unary_union(polygons(make_valid(geometry)))
    simple = set_precision(clean.simplify(tolerance, preserve_topology=True), 0.00001)
    return MultiPolygon([orient(p, sign=-1) for p in polygons(simple) if p.area > 0])


def rounded(value):
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    return round(value, 5)


def feature(properties, geometry, preferred=None):
    point = Point(preferred) if preferred else max(geometry.geoms, key=lambda p: p.area).representative_point()
    if not geometry.covers(point):
        point = max(geometry.geoms, key=lambda p: p.area).representative_point()
    properties["coordinates"] = [round(point.x, 5), round(point.y, 5)]
    result = mapping(geometry)
    result["coordinates"] = rounded(result["coordinates"])
    assert shape(result).is_valid, properties["id"]
    return {"type": "Feature", "properties": properties, "geometry": result}


terrain = []
ne = json.loads((SOURCE / "ne_10m_geography_regions_polys.geojson").read_text(encoding="utf8"))
kind_names = {"Range/mtn": "mountain", "Plateau": "plateau", "Desert": "desert", "Plain": "plain", "Basin": "basin"}
for item in ne["features"]:
    p = item["properties"]
    if p["FEATURECLA"] not in kind_names:
        continue
    # Korea gets the more detailed physical GMBA data below.
    if p["NAME"] == "Hamgyong Mts.":
        continue
    geometry = normalized(shape(item["geometry"]), 0.025)
    if geometry.is_empty:
        continue
    terrain.append(feature({
        "id": f"ne-{p['NE_ID']}", "name": korean_name(p),
        "kind": kind_names[p["FEATURECLA"]], "minZoom": max(1, (p["SCALERANK"] - 1) * 0.75 + 1),
        "source": "Natural Earth · Public domain", "sourceUrl": "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/",
        "locationNote": "Natural Earth의 지형 분포 참고 범위이다. 약 1:50,000,000 수준으로 일반화된 영역으로, 정확한 지형 경계나 고도를 나타내지는 않는다.",
    }, geometry))

# Natural Earth's multipart labels may repeat one NE_ID across records.
# Dissolve their actual polygons so React keys and map labels remain unique.
unique = {}
for item in terrain:
    rid = item["properties"]["id"]
    if rid not in unique:
        unique[rid] = item
    else:
        original = unique[rid]
        merged = normalized(unary_union([shape(original["geometry"]), shape(item["geometry"])]), 0)
        unique[rid] = feature(original["properties"], merged)
terrain = list(unique.values())

z = zipfile.ZipFile(SOURCE / "gmba-basic.zip")
reader = shapefile.Reader(
    shp=io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(".shp") and not n.startswith("__")))),
    dbf=io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(".dbf") and not n.startswith("__")))),
)
groups = {
    "taebaek": ("태백산맥", [20729, 20730, 20872]),
    "sobaek": ("소백산맥", [11441, 20731]),
    "hamgyeong": ("함경산맥", [11382]),
    "nangnim": ("낭림산맥", [11664]),
    "gangnam": ("강남산맥", [11461]),
    "ahobiryong": ("아호비령산맥", [20728]),
}
requested = {rid for _, ids in groups.values() for rid in ids}
mountains, mountain_sources = {}, {}
for item in reader.iterShapeRecords():
    p = item.record.as_dict()
    if p["GMBA_V2_ID"] in requested:
        mountains[p["GMBA_V2_ID"]] = shape(item.shape.__geo_interface__)
        mountain_sources[p["GMBA_V2_ID"]] = {key: p[key] for key in ("GMBA_V2_ID", "MapName", "Path", "Feature")}
assert set(mountains) == requested
for rid, (name, ids) in groups.items():
    geometry = normalized(unary_union([mountains[i] for i in ids]), 0.008)
    terrain.append(feature({
        "id": f"korea-{rid}", "name": name, "kind": "mountain", "korea": True, "minZoom": 5,
        "source": "Snethlage et al. (2022), GMBA Mountain Inventory v2 · CC BY 4.0",
        "sourceUrl": "https://doi.org/10.48601/earthenv-t9k2-1407",
        "locationNote": "GMBA v2가 지형 기복으로 구분한 산지 범위이다. 이름이 같은 하위 산지를 합치고 지도 표시용으로 단순화했으며, 개별 능선이나 등고선을 뜻하지 않는다.",
    }, geometry))

areas_path = OUTPUT / "areas-korea.json"
areas = json.loads(areas_path.read_text(encoding="utf8"))
by_region = {f["properties"]["regionId"]: shape(f["geometry"]) for f in areas["features"] if f["properties"].get("regionId")}

# Extract a real elevation contour, not a hand-drawn outline, around Gaema.
# Tiles cover the whole north; current Korean land only clips the international
# edge. The connected highland is deliberately described as terrain context,
# not as a disputed/precisely settled definition of the named plateau's edge.
def lon(px):
    return px / (128 * 256) * 360 - 180


def lat(py):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / (128 * 256)))))


cells = []
dem_sources = []
for x in (108, 109, 110):
    for y in (47, 48, 49):
        path = SOURCE / f"dem-7-{x}-{y}.png"
        image = Image.open(path).convert("RGB")
        for py in range(0, 256, 2):
            # Join consecutive sampled cells before polygon union.
            start = None
            for px in range(0, 258, 2):
                high = False
                if px < 256:
                    r, g, b = image.getpixel((px, py))
                    high = r * 256 + g + b / 256 - 32768 >= 1000
                if high and start is None:
                    start = px
                if not high and start is not None:
                    cells.append(box(lon(x * 256 + start), lat(y * 256 + py + 2), lon(x * 256 + px), lat(y * 256 + py)))
                    start = None
        dem_sources.append({"url": f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/{x}/{y}.png", "sha256": digest(path)})
north = unary_union([by_region["hamgyeong"], by_region["pyeongan"]])
highlands = unary_union(cells).intersection(north)
gaema_seed = Point(127.4, 40.8)
gaema = min(polygons(highlands), key=lambda p: p.distance(gaema_seed))
assert gaema.area > 1 and gaema.distance(gaema_seed) < 0.1
terrain.append(feature({
    "id": "korea-gaema", "name": "개마고원", "kind": "plateau", "korea": True, "minZoom": 5,
    "source": "Mapzen · USGS GMTED2010/SRTM · Public domain",
    "sourceUrl": "https://registry.opendata.aws/terrain-tiles/",
    "locationNote": "개마고원 일대 해발 1,000m 이상 연속 고지대의 참고 범위이다. 공개 고도 자료를 약 2km 간격으로 읽어 추출했으며, 개마고원 전체의 확정 경계를 뜻하지 않는다.",
}, normalized(gaema, 0.012), [127.4, 40.8]))

# Exact source intersection/splitting keeps Jeju out of the Honam overlay and
# Kaesong out of the modern Giho definition. No bounding rectangles are drawn.
jeju_source = json.loads((SOURCE / "jeju-admin.json").read_text(encoding="utf8"))[0]
kaesong_source = json.loads((SOURCE / "kaesong-admin.json").read_text(encoding="utf8"))[0]
assert jeju_source["osm_id"] == 2398560 and kaesong_source["osm_id"] == 5455268
jeju_admin, kaesong_admin = shape(jeju_source["geojson"]), shape(kaesong_source["geojson"])
jeju = by_region["jeolla"].intersection(jeju_admin)
honam = by_region["jeolla"].difference(jeju_admin)
giho = unary_union([by_region["gyeonggi"].difference(kaesong_admin), by_region["chungcheong"]])
split_features = []
for rid, name, geometry, note, url in [
    ("jeju", "제주", jeju, "현재 제주특별자치도 안의 육지 범위이다. 전통 지역의 위치를 이해하기 위한 현대 경계이다.", "https://www.openstreetmap.org/relation/2398560"),
    ("honam", "호남", honam, "전라도 일대를 부르는 전통 지역명이다. 지도는 현재 전북·전남광주 지역의 육지를 나타내며 제주를 별도로 표시한다. 특정 시대의 역사 경계를 복원한 것이 아니다.", "https://encykorea.aks.ac.kr/Article/E0062616"),
    ("giho", "기호", giho, "경기와 호서를 함께 부르는 지역명이다. 현재 서울·인천·경기·대전·세종·충남·충북의 육지 범위이며, 호서와 겹친다. 특정 시대의 역사 경계를 복원한 것이 아니다.", "https://encykorea.aks.ac.kr/Article/E0008487"),
]:
    split_features.append(feature({
        "id": f"traditional-{rid}", "regionId": rid, "name": name, "locationNote": note,
        "source": "© OpenStreetMap contributors · ODbL 1.0 · 한국민족문화대백과사전", "sourceUrl": url,
    }, normalized(geometry, 0.00001)))

terrain.sort(key=lambda f: ({"plain": 0, "basin": 1, "desert": 2, "plateau": 3, "mountain": 4}[f["properties"]["kind"]], f["properties"]["id"]))
for filename, features in [("terrain.json", terrain), ("traditional-region-splits.json", split_features)]:
    payload = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n"
    (OUTPUT / filename).write_text(payload, encoding="utf8")
    print(filename, len(features), len(payload.encode("utf8")), "bytes")

metadata = {
    "coordinateSystem": "WGS84; D3 clockwise exterior rings", "buildScript": "scripts/build-history-atlas-terrain.py",
    "snapshotDate": "2026-10-18", "assets": {n: digest(OUTPUT / n) for n in ["terrain.json", "traditional-region-splits.json"]},
    "naturalEarth": {"url": NE_URL, "revision": REVISION, "sha256": digest(SOURCE / "ne_10m_geography_regions_polys.geojson"), "license": "Public domain", "licenseUrl": "https://www.naturalearthdata.com/about/terms-of-use/", "processing": "Physical label polygons, source categories Range/mtn, Plateau, Desert, Plain, Basin; topology-preserving simplification 0.025 degrees; precision 5 decimals. Natural Earth states these regions are only roughly accurate at 1:50 million despite their 10m layer name. Korean Hamgyong is replaced with GMBA geometry."},
    "gmba": {"url": GMBA_URL, "sha256": digest(SOURCE / "gmba-basic.zip"), "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/", "citation": "Snethlage, M.A. et al. (2022). GMBA Mountain Inventory v2. GMBA-EarthEnv.", "datasetUrl": "https://doi.org/10.48601/earthenv-t9k2-1407", "publicationUrl": "https://doi.org/10.1038/s41597-022-01256-y", "processing": "Standard/basic mountain-definition polygons; dissolve children under their named parent. Topology-preserving simplification 0.008 degrees; precision 5 decimals. No fabricated ridge line or buffer geometry.", "records": list(mountain_sources.values()), "groups": groups},
    "gaemaElevation": {"source": "Mapzen Terrain Tiles; USGS GMTED2010 and SRTM, NOAA ETOPO1", "sourceUrl": "https://registry.opendata.aws/terrain-tiles/", "license": "Public domain for the USGS/NOAA source products used in this region", "licenseUrl": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", "attribution": "Mapzen; GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration.", "processing": "Terrarium z7 RGB decoding, every second pixel (~2 km), >=1000 m connected highland nearest [127.4,40.8], intersect current Pyeongan/Hamgyeong reference land; topology-preserving 0.012 degree simplification. Pixel cells are intermediate raster polygonization only; output follows the connected elevation contour. This is terrain context around Gaema, NOT a definitive named-plateau boundary.", "nameReference": "https://encykorea.aks.ac.kr/Article/E0001619", "sources": dem_sources},
    "traditionalRegions": {"nameReferences": ["https://encykorea.aks.ac.kr/Article/E0062616", "https://encykorea.aks.ac.kr/Article/E0008487"], "geometrySource": "areas-korea.json current province grouping; OSM Nominatim relation lookup for Jeju and Kaesong splits", "geometryLicense": "ODbL 1.0; Natural Earth public domain coastlines", "geometryLicenseUrl": "https://www.openstreetmap.org/copyright", "parentAssetSha256": digest(areas_path), "supplementSources": [{"url": f"https://nominatim.openstreetmap.org/lookup?format=jsonv2&polygon_geojson=1&osm_ids=R{rid}", "sha256": digest(SOURCE / f"{name}-admin.json")} for rid, name in [(2398560, "jeju"), (5455268, "kaesong")]], "notes": "Traditional cultural/geographical names are mapped to modern source-based reference regions, not asserted as historically exact boundaries. Gwanseo=Pyeongan, Gwanbuk=Hamgyeong, Haeseo=Hwanghae, Gwandong=Gangwon, Hoseo=Chungcheong, Honam=Jeolla excluding Jeju, Yeongnam=Gyeongsang. Giho=modern Gyeonggi/Seoul/Incheon plus Hoseo and overlaps Hoseo; exclude it from non-overlapping default overlay. Kaesong is excluded from this modern Giho definition but kept in the existing eight-province navigation grouping."},
}
metadata["naturalEarth"]["labelEdits"] = label_changes
metadata["naturalEarth"]["labelPolicy"] = "Source NAME_KO is retained except the explicitly recorded Korean classroom-name aliases and translations of generic English landform words (mountains/range, plateau, plain, desert, basin). Proper-name changes are listed per source ID. Duplicate NE_ID records are dissolved into one multipart feature."
(OUTPUT / "terrain.sources.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
