"""Build selectable current world regions from pinned Natural Earth polygons.

Usage: python scripts/build-history-atlas-world-areas.py --source-cache PATH
Requires shapely 2.x. Downloads are hash checked and never used at runtime.
Country/territory grouping uses the repository's reviewed UN M49 snapshot.
Natural Earth physical continent outlines split transcontinental countries;
no invented longitude boxes, historical-state outlines, or point buffers.
"""
import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import urllib.request

from shapely import make_valid, segmentize, set_precision
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/data/atlas"
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
SOURCE_BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/"
SOURCE_SPECS = {
    "mapUnits": ("ne_50m_admin_0_map_units.geojson", "b8d421aca6e9e08e8cdf09cc26af111cc3e0deba4fe915611d58ade71e8a4db0"),
    "physicalRegions": ("ne_10m_geography_regions_polys.geojson", "b7b26e50ea917d3696aec87f932def2bf5f890f5770e441d59c162c6f4c92a77"),
    "marineRegions": ("ne_10m_geography_marine_polys.geojson", "53f865e8ffa966cdd402145c82c5cd14ee7ce974cd0eb9a3f59f03a4cfd2d66c"),
    "geographicLines": ("ne_10m_geographic_lines.geojson", "e0d96b65c4f08856096550db5e4507d2822f05fe1cc07aadb16ad5ccb3a948e7"),
}
M49_REGIONS = {
    "015": "africa-north", "014": "africa-east", "017": "africa-central",
    "018": "africa-south", "011": "africa-west", "029": "america-caribbean",
    "013": "america-central", "005": "america-south", "021": "america-north",
    "143": "asia-central", "030": "asia-east", "035": "asia-southeast",
    "034": "asia-south", "145": "asia-west", "151": "europe-east",
    "154": "europe-north", "039": "europe-south", "155": "europe-west",
    "053": "oceania-australia", "054": "oceania-pacific",
    "057": "oceania-pacific", "061": "oceania-pacific",
}
MIDDLE_EAST = {"BHR", "CYP", "EGY", "IRN", "IRQ", "ISR", "JOR", "KWT", "LBN", "OMN", "PSE", "QAT", "SAU", "SYR", "TUR", "ARE", "YEM"}
TITLES = {
    "europe": "유럽", "europe-west": "서유럽", "europe-east": "동유럽", "europe-south": "남유럽", "europe-north": "북유럽",
    "asia": "아시아", "asia-west": "서아시아", "asia-south": "남아시아", "asia-east": "동아시아", "asia-southeast": "동남아시아", "asia-central": "중앙아시아", "asia-north": "북아시아",
    "africa": "아프리카", "africa-north": "북아프리카", "africa-south": "남아프리카", "africa-east": "동아프리카", "africa-west": "서아프리카", "africa-central": "중앙아프리카",
    "middle-east": "중동", "america": "아메리카", "america-north": "북아메리카", "america-south": "남아메리카", "america-central": "중앙아메리카", "america-caribbean": "카리브 지역",
    "oceania": "오세아니아", "oceania-australia": "오스트레일리아·뉴질랜드", "oceania-pacific": "태평양 제도", "antarctica": "남극", "arctic": "북극", "greenland": "그린란드",
    "water": "바다·대양", "water-pacific": "태평양", "water-atlantic": "대서양", "water-indian": "인도양", "water-southern": "남극해", "water-arctic": "북극해", "water-mediterranean": "지중해", "water-black": "흑해", "water-red": "홍해", "water-baltic": "발트해", "water-caribbean": "카리브해", "water-east-asia": "동아시아 해역", "water-other": "기타 해역",
}
# Country portions are clipped with Natural Earth's continent/island polygons.
# M49 remains the statistical baseline; these explicitly geographic exceptions
# prevent all of Russia from appearing in both Europe and Northern Asia.
SPLITS = {
    "RUS": {"Europe": "europe-east", "Asia": "asia-north"},
    "TUR": {"Europe": "europe-south", "Asia": "asia-west"},
    "KAZ": {"Europe": "europe-east", "Asia": "asia-central"},
    "AZE": {"Europe": "europe-east", "Asia": "asia-west"},
    "GEO": {"Europe": "europe-east", "Asia": "asia-west"},
    "EGY": {"Africa": "africa-north", "Asia": "asia-west"},
}
# Reassign complete source island polygons, never an invented rectangular cut.
ISLAND_EXCEPTIONS = {
    "USA": ("Oceania", "oceania-pacific", "하와이"),
    "ESP": ("Africa", "africa-north", "카나리아 제도·아프리카 연안 지역"),
    "PRT": ("Africa", "africa-north", "마데이라 제도"),
    "CHL": ("Oceania", "oceania-pacific", "이스터섬"),
    "IDN": ("Oceania", "oceania-pacific", "뉴기니섬 서부"),
}
MARINE = {
    "water-pacific": ["North Pacific Ocean", "South Pacific Ocean", "Bering Sea", "Gulf of Alaska", "Philippine Sea", "Tasman Sea", "Coral Sea", "Sea of Okhotsk", "South China Sea", "Sea of Japan", "Yellow Sea", "East China Sea", "Bo Hai", "Korea Strait", "Taiwan Strait", "Luzon Strait", "Celebes Sea", "Sulu Sea", "Banda Sea", "Java Sea", "Molucca Sea", "Bismarck Sea", "Solomon Sea", "Ceram Sea", "Arafura Sea", "Gulf of Thailand", "Gulf of Tonkin", "Golfo de California", "Drake Passage"],
    "water-atlantic": ["North Atlantic Ocean", "South Atlantic Ocean", "North Sea", "Norwegian Sea", "Labrador Sea", "Hudson Bay", "Gulf of Mexico", "Bay of Biscay", "English Channel", "Irish Sea", "Inner Seas", "Bristol Channel", "Gulf of Guinea", "Bahía de Campeche", "James Bay", "Hudson Strait", "Gulf of Saint Lawrence", "Río de la Plata", "Sargasso Sea", "Drake Passage", "Estrecho de Magellanes"],
    "water-indian": ["INDIAN OCEAN", "Arabian Sea", "Bay of Bengal", "Andaman Sea", "Laccadive Sea", "Persian Gulf", "Gulf of Aden", "Gulf of Oman", "Mozambique Channel", "Timor Sea", "Arafura Sea", "Great Australian Bight", "Strait of Malacca", "Strait of Singapore"],
    "water-southern": ["SOUTHERN OCEAN", "Weddell Sea", "Ross Sea", "Bellingshausen Sea", "Amundsen Sea", "Scotia Sea", "Drake Passage", "Davis Sea"],
    "water-arctic": ["Arctic Ocean", "Beaufort Sea", "Chukchi Sea", "East Siberian Sea", "Laptev Sea", "Kara Sea", "Barents Sea", "White Sea", "Greenland Sea", "Lincoln Sea", "The North Western Passages", "Baffin Bay", "Davis Strait", "Amundsen Gulf", "Viscount Melville Sound", "M'Clure Strait"],
    "water-mediterranean": ["Mediterranean Sea", "Tyrrhenian Sea", "Adriatic Sea", "Ionian Sea", "Balearic Sea", "Aegean Sea", "Sea of Crete", "Ligurian Sea", "Golfe du Lion", "Gulf of Gabès", "Gulf of Sidra", "Strait of Gibraltar", "Sea of Marmara"],
    "water-black": ["Black Sea", "Sea of Azov", "Bosporus"],
    "water-red": ["Red Sea", "Gulf of Suez"],
    "water-baltic": ["Baltic Sea", "Gulf of Bothnia", "Gulf of Finland", "Gulf of Riga", "Kattegat", "Øresund", "Mecklenburger Bucht"],
    "water-caribbean": ["Caribbean Sea", "Gulf of Honduras", "Yucatan Channel"],
    "water-east-asia": ["Sea of Japan", "Sea of Okhotsk", "Yellow Sea", "East China Sea", "South China Sea", "Bo Hai", "Korea Strait", "Taiwan Strait", "Luzon Strait", "East Korea Bay", "Hangzhou Bay", "La Pérouse Strait"],
}


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry] if not geometry.is_empty else []
    return [part for child in getattr(geometry, "geoms", []) for part in polygons(child)]


def repair(geometry):
    return unary_union(polygons(make_valid(geometry)))


def normalized(geometry):
    # Keep source islands and holes; tolerance is at most ~2.2 km at the equator.
    # Densification preserves latitude edges/polar caps under spherical rendering.
    geometry = set_precision(repair(geometry).simplify(0.02, preserve_topology=True), 0.00001)
    return MultiPolygon([orient(segmentize(part, 1), sign=-1) for part in polygons(geometry)])


def read_source(key, cache):
    name, expected = SOURCE_SPECS[key]
    path = cache / name
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(SOURCE_BASE + name, timeout=120).read())
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected, f"Source changed: {name}"
    return json.loads(raw)["features"]


def rounded(values):
    if isinstance(values, (list, tuple)):
        if len(values) == 2 and all(isinstance(item, (float, int)) for item in values):
            longitude, latitude = values
            # Source conversion leaves sub-millidegree gaps at the date line and
            # pole. Snap only those numerical seams, not coast or region edges.
            if abs(longitude) > 179.9995:
                longitude = 180 if longitude > 0 else -180
            if abs(latitude) > 89.99:
                latitude = 90 if latitude > 0 else -90
            return [round(longitude, 5), round(latitude, 5)]
        return [rounded(item) for item in values]
    return round(values, 5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, required=True)
    args = parser.parse_args()
    args.source_cache.mkdir(parents=True, exist_ok=True)
    units = read_source("mapUnits", args.source_cache)
    physical = read_source("physicalRegions", args.source_cache)
    marine = read_source("marineRegions", args.source_cache)
    lines = read_source("geographicLines", args.source_cache)
    m49_path = ROOT / "scripts/history-atlas-world-regions.m49.json"
    m49 = json.loads(m49_path.read_text(encoding="utf-8"))
    m49_iso = {row["iso3"]: row for row in m49["countries"]}
    masks = {region: unary_union([
        shape(feature["geometry"]) for feature in physical
        if feature["properties"]["REGION"] == region
        and feature["properties"]["FEATURECLA"] in {"Continent", "Island", "Island group"}
    ]) for region in {"Europe", "Asia", "Africa", "Oceania"}}
    new_guinea = unary_union([shape(feature["geometry"]) for feature in physical
        if feature["properties"]["NAME"] == "NEW GUINEA"])
    assert not new_guinea.is_empty
    grouped = defaultdict(list)
    evidence = defaultdict(list)
    split_audit = []
    for feature in units:
        prop, source_geometry = feature["properties"], repair(shape(feature["geometry"]))
        iso = prop["ISO_A3_EH"]
        region = M49_REGIONS.get(m49_iso.get(iso, {}).get("parent"))
        if iso == "ATA":
            region = "antarctica"
        if not region:
            region = {"TWN": "asia-east", "SOL": "africa-east", "KOS": "europe-south", "CYN": "asia-west", "KAS": "asia-south"}.get(prop["GU_A3"])
        if not region:
            raise ValueError(f"Unmapped source territory: {prop['GEOUNIT']} / {iso}")
        record = {"unit": prop["GEOUNIT"], "iso3": iso, "sourceId": prop["GU_A3"]}
        if iso in MIDDLE_EAST or prop["GU_A3"] == "CYN":
            grouped["middle-east"].append(source_geometry)
            evidence["middle-east"].append(record)
        if iso == "GRL":
            grouped["greenland"].append(source_geometry)
            evidence["greenland"].append(record)
        if iso in SPLITS:
            portions = []
            for continent, destination in SPLITS[iso].items():
                portion = repair(source_geometry.intersection(masks[continent]))
                if portion.is_empty:
                    continue
                grouped[destination].append(portion)
                evidence[destination].append({**record, "physicalContinentClip": continent})
                portions.append(portion)
            ratio = unary_union(portions).area / source_geometry.area
            assert ratio > 0.995, (iso, ratio)
            split_audit.append({**record, "coveredFraction": ratio, "destinations": SPLITS[iso]})
        elif iso in ISLAND_EXCEPTIONS:
            continent, destination, description = ISLAND_EXCEPTIONS[iso]
            for part in polygons(source_geometry):
                # Preserve complete original coastlines. The physical reference
                # identifies which separate source land parts belong elsewhere.
                island_mask = new_guinea if iso == "IDN" else masks[continent]
                moved = part.intersection(island_mask).area > part.area * 0.5
                target = destination if moved else region
                grouped[target].append(part)
                evidence[target].append({**record, **({"physicalIslandRegion": continent, "description": description} if moved else {})})
        else:
            grouped[region].append(source_geometry)
            evidence[region].append(record)
    regions = {key: repair(unary_union(parts)) for key, parts in grouped.items()}
    for parent in ["europe", "asia", "africa", "america", "oceania"]:
        children = sorted(key for key in regions if key.startswith(parent + "-"))
        regions[parent] = repair(unary_union([regions[key] for key in children]))
        evidence[parent] = [{"childRegion": key} for key in children]

    named_marine = defaultdict(list)
    marine_records = []
    for feature in marine:
        prop = feature["properties"]
        name = prop.get("name")
        # Natural Earth marine includes inland lakes and river reaches too.
        # Those keep their existing land/river scope rather than becoming oceans.
        if not name or prop["featurecla"] in {"river", "reef"} or name in {"Caspian Sea", "Garabogaz Bay", "Saint Lawrence River"}:
            continue
        named_marine[name].append(repair(shape(feature["geometry"])))
        marine_records.append(feature)
    for region, names in MARINE.items():
        missing = set(names) - named_marine.keys()
        assert not missing, (region, missing)
        regions[region] = repair(unary_union([part for name in names for part in named_marine[name]]))
        evidence[region] = [{"marineName": name} for name in names]
    all_marine = repair(unary_union([part for parts in named_marine.values() for part in parts]))
    classified_marine = repair(unary_union([regions[key] for key in MARINE]))
    regions["water-other"] = repair(all_marine.difference(classified_marine))
    evidence["water-other"] = [{"marineName": name} for name in sorted(named_marine) if name not in {n for names in MARINE.values() for n in names}]
    regions["water"] = all_marine
    evidence["water"] = [{"childRegion": key} for key in [*MARINE, "water-other"]]

    circle = next(feature for feature in lines if feature["properties"].get("name") == "Arctic Circle")
    ring = circle["geometry"]["coordinates"]
    assert ring[0][0] > 179 and ring[-1][0] < -179
    regions["arctic"] = Polygon([*ring, [ring[-1][0], 90], [ring[0][0], 90], ring[0]])
    evidence["arctic"] = [{"geographicLine": "Arctic Circle", "northLatitude": ring[0][1]}]
    assert set(regions) == set(TITLES), (set(regions) ^ set(TITLES))
    common_note = "현대 국가·별도 영토의 UN M49 분류와 Natural Earth 지형을 합친 현재 지리 참조 범위이다. 역사적 국가의 영토를 뜻하지 않는다."
    physical_note = " 러시아·튀르키예 등 대륙에 걸친 지역은 Natural Earth의 대륙·섬 경계로 나누며, 작은 해안 차이는 원본 축척 차이에서 생긴다."
    features = []
    for region, name in TITLES.items():
        geometry = normalized(regions[region])
        assert geometry.is_valid and not geometry.is_empty, region
        note = common_note
        source = "Natural Earth · UN M49"
        source_url = "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-details/"
        if region.startswith(("europe", "asia")) or region == "africa-north":
            note += physical_note
        if region == "asia-north":
            note = "Natural Earth가 아시아로 구분한 러시아의 현재 육지·섬 범위이다. 우랄·대륙 경계 자료를 사용하며, 러시아 전체나 역사적 러시아 제국의 영토를 뜻하지 않는다."
        if region == "middle-east":
            note = "기존 지역 분류에서 중동으로 묶은 서아시아 15개국·이집트·이란의 현재 육지 범위이다. UN M49의 공식 중동 구분은 아니며, 지역 정의에 따라 범위가 달라질 수 있다."
        if region.startswith("water"):
            source = "Natural Earth · 명명된 해역"
            source_url = "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/"
            note = "Natural Earth의 명명된 대양·바다·만·해협 폴리곤을 합친 현재 해역 참조 범위이다. 영해·배타적 경제 수역이나 역사적 해상 세력권을 뜻하지 않는다."
            if region == "water-other":
                note = "Natural Earth의 명명된 해역 중 다른 바다·대양 필터에 포함되지 않은 실제 해역이다. 하천·카스피해 같은 내륙수역과 암초 영역은 제외한다."
        if region == "arctic":
            source = "Natural Earth · 북극권선"
            source_url = "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-geographic-lines/"
            note = f"Natural Earth 북극권선(북위 {ring[0][1]}도) 북쪽의 육지와 바다를 표시한다. 북극해만을 뜻하지 않으며, 북극권 정의에 따라 범위가 달라질 수 있다."
        if region == "antarctica":
            note = "Natural Earth의 현재 남극대륙 육지 범위이다. 남극해·국가별 영유권 주장 구역과 구분한다."
        anchor = max(geometry.geoms, key=lambda part: part.area).representative_point()
        coordinates = [round(anchor.x, 5), round(anchor.y, 5)]
        assert geometry.covers(Point(coordinates)), region
        geojson = mapping(geometry)
        geojson["coordinates"] = rounded(geojson["coordinates"])
        assert shape(geojson).is_valid, region
        features.append({"type": "Feature", "properties": {
            "id": f"world-region-{region}", "regionId": region, "name": name,
            "coordinates": coordinates, "locationNote": note, "source": source, "sourceUrl": source_url,
        }, "geometry": geojson})
    payload = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n"
    (OUTPUT / "areas-world.json").write_text(payload, encoding="utf-8", newline="\n")
    manifest = {
        "reviewDate": "2026-10-16", "scope": "Current geographic reference areas for all world region filters except unclassified; no historical polity boundaries.",
        "coordinateSystem": "WGS84 longitude, latitude; D3 clockwise exterior rings",
        "assetSha256": hashlib.sha256(payload.encode()).hexdigest(), "naturalEarthRevision": REVISION,
        "sources": [{"key": key, "url": SOURCE_BASE + filename, "sha256": digest, "license": "Public domain"} for key, (filename, digest) in SOURCE_SPECS.items()],
        "m49": {"url": m49["url"], "snapshot": str(m49_path.relative_to(ROOT)).replace("\\", "/"), "sha256": hashlib.sha256(m49_path.read_text(encoding="utf-8").encode("utf-8")).hexdigest(), "hashNormalization": "UTF-8 with LF line endings", "retrievedAt": m49["retrievedAt"]},
        "processing": "Source polygons repaired with make_valid, dissolved by named memberships, topology-preserving simplification 0.02 degrees, 5 decimal precision, edges densified at 1 degree for spherical projection. Source conversion seams within 0.0005 degrees of the antimeridian and 0.01 degrees of a pole are snapped to the exact meridian/pole to preserve spherical closure. No minimum island area filter. The Arctic uses the source Arctic Circle's north-side cap. Overseas map units retain their own geographic classification; transcontinental portions use source continent/island outlines.",
        "limitations": ["Natural Earth generalizes current reference geography and uses de facto country boundaries; it is not a legal boundary dataset.", "The UN M49 statistical baseline is adjusted for explicit physical transcontinental/island geography; it is not a claim that UN M49 subdivides those countries.", "Overlapping seas may belong to multiple ocean filters. Other waters are the geometric difference of all eligible named marine polygons and the explicit marine groups.", "Named marine source geometry excludes Caspian Sea, Garabogaz Bay, river reaches, reefs and unnamed internal-water labels.", "Unclassified has no fabricated area. Source coastlines can differ slightly from the base map and recorded coastal point coordinates."],
        "middleEastIso3": sorted(MIDDLE_EAST), "transcontinentalClips": split_audit,
        "features": [{"regionId": key, "name": TITLES[key], "members": list({json.dumps(item, sort_keys=True): item for item in evidence[key]}.values())} for key in TITLES],
    }
    (OUTPUT / "areas-world.sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"World areas: {len(features)} features, {len(payload.encode())} bytes")


if __name__ == "__main__":
    main()
