"""Build the separate ODbL river layer from saved, public Overpass responses.

Requires shapely. Pass each downloaded JSON via --source; a matching
*.request.json sidecar can record its query, URL and retrieval timestamp.
No textbook, service account, runtime API or generated/traced geometry is used.
"""

import argparse
from collections import Counter
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from shapely.geometry import LineString


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/data/atlas"
TOLERANCE = 0.0003
LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
INITIAL_QUERY = ('[out:json][timeout:45];way[waterway=river]'
                 '[name~"^(금강|대동강|청천강|예성강|임진강|북한강|섬진강|영산강|대령강|동진강|재령강|태화강|형산강|탐진강|성천강)$"]'
                 '(32,123,44,132);out geom;')
ALIASES = {
    "한강": ["Han River", "Hangang"],
    "남한강": ["Namhan River", "Namhangang"],
    "북한강": ["Bukhan River", "Bukhangang"],
    "낙동강": ["Nakdong River", "Nakdonggang"],
    "압록강": ["Yalu River", "Amnok River", "鸭绿江", "鴨綠江"],
    "두만강": ["Tumen River", "Tuman River", "图们江", "圖們江"],
    "대동강": ["Taedong River", "Taedonggang"],
    "금강": ["Geum River", "Geumgang"],
    "섬진강": ["Seomjin River", "Seomjingang"],
    "청천강": ["Chongchon River", "Ch'ongch'on River"],
    "예성강": ["례성강", "Yesong River", "Ryesong River", "Yesonggang", "Ryesonggang"],
    "백마강": ["Baengmagang", "Baekma River"],
    "대령강": [], "재령강": [], "성천강": [], "임진강": [],
    "영산강": [], "형산강": [], "태화강": [], "탐진강": [], "동진강": [],
    "가르강": ["Gard", "Gardon", "Le Gardon"],
    "위강": ["Wei River", "Wei He", "渭河"],
}
REGION_BOUNDS = {"가르강": (3, 43, 5, 45), "위강": (103, 33, 111, 36)}
NAME_LOOKUP = {alias.casefold(): name for name, aliases in ALIASES.items()
               for alias in [name, *aliases]}
REQUESTED_NAMES = ["한강", "남한강", "낙동강", "압록강", "두만강", "대동강",
                   "금강", "섬진강", "청천강", "예성강", "백마강", "패강", "백강", "가르강", "위강"]
NE_NAMES = {"한강": ["Han"], "남한강": ["Namhan"], "낙동강": ["Nakdong"],
            "압록강": ["Yalu"], "두만강": ["Tumen"], "위강": ["Wei"]}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def matched_name(tags):
    # Exact tags only: never turn an unnamed nearby waterway into a named river.
    for key in ("name:ko", "name", "name:en", "int_name"):
        match = NAME_LOOKUP.get(str(tags.get(key, "")).strip().casefold())
        if match:
            return match
    return None


def metadata(path, data, raw):
    request_path = path.with_suffix(".request.json")
    request = json.loads(request_path.read_text(encoding="utf-8")) if request_path.exists() else {}
    if path.name == "korea-river-osm-source.json" and not request:
        request = {
            "query": INITIAL_QUERY,
            "url": "https://overpass.kumi.systems/api/interpreter?data=" + quote(INITIAL_QUERY),
        }
    retrieved_at = request.get("retrievedAt") or datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    return {
        "id": path.stem,
        "file": path.name,
        "sha256": digest(raw),
        "query": request.get("query"),
        "url": request.get("url"),
        "retrievedAt": retrieved_at,
        "retrievalTimeBasis": "request record" if request.get("retrievedAt") else "saved response file modification time",
        "osmBaseTimestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
        "generator": data.get("generator"),
        "sourceElements": len(data.get("elements", [])),
        "includedNames": request.get("includedNames"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, action="append", required=True)
    args = parser.parse_args()
    groups, sources, seen, ignored = {}, [], {}, []
    for path in args.source:
        raw = path.read_bytes()
        data = json.loads(raw)
        if data.get("remark"):
            raise ValueError(f"Partial/error Overpass response: {path.name}: {data['remark']}")
        source = metadata(path, data, raw)
        sources.append(source)
        for element in data.get("elements", []):
            tags = element.get("tags", {})
            name = matched_name(tags)
            include = source["includedNames"]
            if element.get("type") != "way" or tags.get("waterway") not in ("river", "stream") or not name or (include and name not in include):
                ignored.append({"sourceId": source["id"], "type": element.get("type"),
                                "id": element.get("id"), "name": tags.get("name"),
                                "reason": "not selected by explicit source/name filter"})
                continue
            coordinates = [[point["lon"], point["lat"]] for point in element.get("geometry", [])]
            west, south, east, north = REGION_BOUNDS.get(name, (123, 32, 132, 44))
            if len(coordinates) < 2 or any(not (west <= x <= east and south <= y <= north) for x, y in coordinates):
                raise ValueError(f"Missing or out-of-region geometry: {element['id']}")
            way_id = element["id"]
            signature = (name, coordinates)
            if way_id in seen:
                if seen[way_id] != signature:
                    raise ValueError(f"Conflicting snapshots for OSM way {way_id}")
                continue
            seen[way_id] = signature
            simplified = LineString(coordinates).simplify(TOLERANCE, preserve_topology=True)
            points = [[round(x, 6), round(y, 6)] for x, y in simplified.coords]
            if len(points) < 2 or points[0] != [round(v, 6) for v in coordinates[0]] or points[-1] != [round(v, 6) for v in coordinates[-1]]:
                raise ValueError(f"Simplification changed endpoints: {way_id}")
            group = groups.setdefault(name, [])
            group.append({"wayId": way_id, "sourceId": source["id"], "sourceName": tags.get("name"),
                          "originalPoints": len(coordinates), "points": points})

    features, rivers = [], []
    for name, ways in sorted(groups.items()):
        ways.sort(key=lambda way: way["wayId"])
        points = [point for way in ways for point in way["points"]]
        way_ids = [way["wayId"] for way in ways]
        features.append({
            "type": "Feature",
            "properties": {"name": name, "source": "OpenStreetMap", "osmWayIds": way_ids},
            "geometry": {"type": "MultiLineString", "coordinates": [way["points"] for way in ways]},
        })
        rivers.append({
            "name": name, "osmWayIds": way_ids,
            "sourceIds": sorted({way["sourceId"] for way in ways}),
            "sourceNames": sorted({way["sourceName"] for way in ways if way["sourceName"]}),
            "ways": len(ways), "sourcePoints": sum(way["originalPoints"] for way in ways),
            "outputPoints": len(points),
            "bbox": [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)],
            "coverage": "Named source ways only; continuity and complete headwater-to-mouth coverage are not asserted.",
        })

    coverage = []
    for name in REQUESTED_NAMES:
        if name in groups:
            coverage.append({"name": name, "status": "supplement", "wayCount": len(groups[name])})
        elif name in NE_NAMES:
            coverage.append({"name": name, "status": "natural-earth-only", "naturalEarthNames": NE_NAMES[name],
                             "note": "Existing generalized geometry; full river coverage is not asserted."})
        else:
            coverage.append({"name": name, "status": "unresolved",
                             "note": "Historical identification requires entry-specific evidence; no inferred line." if name in ("패강", "백강") else "No explicitly named source centerline obtained; no inferred line."})

    OUTPUT.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")).encode()
    (OUTPUT / "rivers-supplement.json").write_bytes(encoded)
    manifest = {
        "source": "OpenStreetMap", "license": "ODbL 1.0", "licenseUrl": LICENSE_URL,
        "attribution": "© OpenStreetMap contributors", "attributionUrl": COPYRIGHT_URL,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "coordinateSystem": "WGS84 longitude, latitude", "simplificationToleranceDegrees": TOLERANCE,
        "processing": "Simplify each source way separately with Shapely preserve_topology=True; round to six decimals. Preserve way endpoints and separate MultiLineString parts. No joining, interpolation or traced geometry.",
        "geometryFile": "rivers-supplement.json", "sha256": digest(encoded), "bytes": len(encoded),
        "featureCount": len(features), "wayCount": len(seen), "sources": sources, "rivers": rivers,
        "requestedCoverage": coverage, "ignoredElementCount": len(ignored),
        "ignoredNamedWaterways": dict(sorted(Counter(item["name"] for item in ignored if item["name"]).items())),
        "limitations": "Modern OSM river centerlines, not reconstructed historical courses. Named segments may have gaps. This derived database remains separate from the public-domain Natural Earth layers and is distributed under ODbL 1.0.",
    }
    (OUTPUT / "rivers-supplement.sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"features": len(features), "ways": len(seen), "bytes": len(encoded), "coverage": coverage}, ensure_ascii=False))


if __name__ == "__main__":
    main()
