"""Extract a separately licensed Dokdo coastline layer from an OSM API snapshot.

Usage: python scripts/build-history-atlas-dokdo.py output/dokdo-osm-source.xml
Source: https://api.openstreetmap.org/api/0.6/map?bbox=131.85,37.23,131.88,37.25
No network access is required at build time or in the application.
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

source = Path(sys.argv[1])
root = ET.fromstring(source.read_bytes())
nodes = {
    node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])]
    for node in root.findall("node")
}
features = []
evidence = []
for way in root.findall("way"):
    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
    if tags.get("natural") != "coastline":
        continue
    refs = [node.attrib["ref"] for node in way.findall("nd")]
    assert len(refs) >= 4 and refs[0] == refs[-1], "Coastline must be closed"
    ring = [nodes[ref] for ref in refs]
    assert all(131.85 <= x <= 131.88 and 37.23 <= y <= 37.25 for x, y in ring)
    # D3 spherical polygons use clockwise exterior rings.
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
    if area > 0:
        ring.reverse()
    way_id = way.attrib["id"]
    properties = {"osmWayId": way_id}
    if tags.get("name:ko"):
        properties["name"] = tags["name:ko"]
    features.append({"type": "Feature", "properties": properties,
                     "geometry": {"type": "Polygon", "coordinates": [ring]}})
    evidence.append({"wayId": way_id, "version": way.attrib["version"],
                     "timestamp": way.attrib["timestamp"]})

assert {"456788679", "456788681"}.issubset({x["wayId"] for x in evidence})
output = Path("src/data/atlas")
payload = json.dumps({"type": "FeatureCollection", "features": features},
                     ensure_ascii=False, separators=(",", ":")) + "\n"
(output / "dokdo-islands.json").write_text(payload, encoding="utf-8", newline="\n")
metadata = {
    "source": "© OpenStreetMap contributors",
    "sourceUrl": "https://api.openstreetmap.org/api/0.6/map?bbox=131.85,37.23,131.88,37.25",
    "license": "ODbL 1.0",
    "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
    "attributionUrl": "https://www.openstreetmap.org/copyright",
    "coordinateSystem": "WGS84 longitude, latitude",
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "assetSha256": hashlib.sha256(payload.encode()).hexdigest(),
    "notes": "Independent coastline layer. Original coordinates retained, clockwise winding for D3. No simplification, scaling, country boundaries or OSM sovereignty attributes. Korean names and jurisdiction are supplied separately from Korean government sources.",
    "ways": evidence,
}
(output / "dokdo-islands.sources.json").write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"Dokdo coastlines: {len(features)} closed islands, {len(payload.encode())} bytes")
