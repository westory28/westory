"""Build the shared modern-country layer from World Bank Official Boundaries.

Requires Python and shapely 2.x. Source downloads are pinned by SHA-256, cached
with --source-cache, and never fetched by the application. Natural Earth supplies
only Korean names and label priorities, not territorial geometry or policy.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import urllib.request

from shapely import make_valid, segmentize
from shapely.geometry import MultiLineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src/data/atlas"
WB_CATALOG = "https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries"
WB_BASE = "https://datacatalogfiles.worldbank.org/ddh-published/0038272/2/DR0095369/World%20Bank%20Official%20Boundaries%20%28GeoJSON%29/"
WB_LINES = "https://services.arcgis.com/iQ1dY19aHwbSDYIF/ArcGIS/rest/services/World_Bank_Global_Administrative_Divisions/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&outSR=4326"
NE_REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
NE_BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_REVISION}/geojson/"
SOURCES = {
    "countries": {
        "file": "World Bank Official Boundaries - Admin 0.geojson",
        "url": WB_BASE + "World%20Bank%20Official%20Boundaries%20-%20Admin%200.geojson",
        "sha256": "e338c1cac8482721ffe6b59b9bd67eb8c6d11710840aaac3d9a60634aa9d9bff",
    },
    "undeterminedAreas": {
        "file": "World Bank Official Boundaries - NDLSA.geojson",
        "url": WB_BASE + "World%20Bank%20Official%20Boundaries%20-%20NDLSA.geojson",
        "sha256": "3ff2a1aead884d470d260720b7a62673c619cccebc66473614837ee5e7a57166",
    },
    "boundaryLines": {
        "file": "wb-admin0-lines.geojson",
        "url": WB_LINES,
        "sha256": "0b02fb9a74ad90915a72ad817ac0f1cb4c96bc9816564071f9a0a5b4262e9cfa",
    },
    "labels": {
        "file": "ne_10m_admin_0_countries_iso.geojson",
        "url": NE_BASE + "ne_10m_admin_0_countries_iso.geojson",
        "sha256": "60eb10aa951f5872507c9436937508b09be4b43dc9fa7aad7644f23ef12e1cad",
    },
}
# The source line's FID and geometry are both checked before omitting the DMZ.
KOREA_INTERNAL_LINE_ID = 70
TOLERANCE = 0.01
DISPLAY_TOLERANCE = 0.02


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def load(key, cache):
    spec = SOURCES[key]
    path = cache / spec["file"]
    if not path.exists():
        with urllib.request.urlopen(spec["url"], timeout=240) as response:
            path.write_bytes(response.read())
    raw = path.read_bytes()
    if digest(raw) != spec["sha256"]:
        raise ValueError(f"Source snapshot changed; review before updating: {key}")
    data = json.loads(raw)
    if data.get("exceededTransferLimit"):
        raise ValueError("Incomplete boundary-line response")
    return data["features"]


def parts(geometry, wanted):
    if geometry.is_empty:
        return []
    if geometry.geom_type == wanted:
        return [geometry]
    return [p for g in getattr(geometry, "geoms", []) for p in parts(g, wanted)]


def polygons(geometry):
    return parts(geometry, "Polygon")


def normalize(geometry):
    # A <=0.01 degree tolerance keeps the layer suitable for country viewing,
    # preserves small islands/holes, and bounds redraw work during globe dragging.
    cleaned = make_valid(geometry).simplify(TOLERANCE, preserve_topology=True)
    return MultiPolygon([
        orient(segmentize(p, 1), sign=-1) for p in polygons(cleaned)
    ])


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (tuple, list)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


def compact(payload):
    """Generalize invisible islets without losing microstates or enclave holes.

    This final pass runs on six-decimal coordinates so rounding cannot reverse
    sub-meter rings into whole-globe D3 polygons. Large outlines keep <=0.02
    degree detail; a collapsed country's largest island is always preserved.
    """
    omitted = 0
    features = payload["countries"]["features"]
    for feature in features:
        original = polygons(shape(feature["geometry"]))
        largest = max(original, key=lambda p: p.area)
        pieces = []
        for polygon in original:
            if polygon.area <= 1e-10:
                omitted += 1
                continue
            reduced = polygon.simplify(DISPLAY_TOLERANCE, preserve_topology=False)
            if reduced.is_empty:
                if polygon == largest:
                    reduced = polygon.simplify(DISPLAY_TOLERANCE, preserve_topology=True)
                else:
                    omitted += 1
                    continue
            # Tiny sovereign enclaves must not become part of their neighbor
            # just because a coarse display simplification would erase a hole.
            holes = [Polygon(ring) for ring in polygon.interiors if Polygon(ring).area > 1e-10]
            if holes:
                reduced = reduced.difference(unary_union(holes))
            pieces.extend(polygons(make_valid(reduced)))
        display = MultiPolygon([orient(p, sign=-1) for p in pieces if p.area > 1e-10])
        assert not display.is_empty, feature["properties"]["id"]
        point = Point(feature["properties"]["coordinates"])
        if not display.covers(point):
            point = max(polygons(display), key=lambda p: p.area).representative_point()
            feature["properties"]["coordinates"] = list(point.coords[0])
        feature["geometry"] = mapping(display)
    # Coastal microstates are not holes (e.g. Monaco). Preserve their displayed
    # footprint too, so a neighboring mainland's coarser coast cannot swallow
    # them and steal their click target. The rule is geometric, not a country-
    # specific territorial override; larger countries never override a smaller
    # country's display geometry within this 0.02-degree generalization.
    geometries = [make_valid(shape(f["geometry"])) for f in features]
    small = [(index, g) for index, g in enumerate(geometries) if g.area < 1]
    for index, (feature, geometry) in enumerate(zip(features, geometries)):
        for other_index, other in small:
            if other_index != index and other.area < geometry.area and geometry.intersects(other):
                geometry = geometry.difference(other)
        feature["geometry"] = mapping(MultiPolygon([
            orient(p, sign=-1) for p in polygons(geometry) if p.area > 1e-10
        ]))
    return rounded(payload), omitted


def write_asset(payload, manifest):
    payload, omitted = compact(rounded(payload))
    asset = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    (OUT / "countries-world.json").write_bytes(asset)
    manifest.update(assetSha256=digest(asset), assetBytes=len(asset),
                    omittedSubresolutionIslets=omitted, displayToleranceDegrees=DISPLAY_TOLERANCE)
    manifest["notes"].append(
        "A final 0.02-degree display generalization removes islets below screen resolution while preserving every country's largest component and source enclave holes. Country footprints below one square degree are protected from overlap by neighboring generalized mainland coastlines (e.g. Monaco). The pass follows coordinate rounding to prevent degenerate sub-meter rings from reversing D3 winding. Small-scale reference outlines, not cadastral boundaries."
    )
    (OUT / "countries-world.sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Countries asset: {len(asset)} bytes; {omitted} subresolution islets omitted", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, required=True)
    args = parser.parse_args()
    args.source_cache.mkdir(parents=True, exist_ok=True)
    labels = {
        f["properties"]["ISO_A3_EH"]: f["properties"]
        for f in load("labels", args.source_cache)
    }
    labels["XKX"] = {
        "NAME_KO": "코소보", "LABEL_X": 20.86, "LABEL_Y": 42.59,
        "MIN_LABEL": 5,
    }
    by_id = defaultdict(list)
    source_features = load("countries", args.source_cache)
    for feature in source_features:
        p = feature["properties"]
        by_id[p["ISO_A3"]].append(shape(feature["geometry"]))
    source_country_count = len(by_id)
    print(f"Loaded {len(source_features)} source features / {source_country_count} IDs", flush=True)
    del source_features
    # Union first removes the internal demarcation. Combining polygon arrays
    # alone would leave a line across the peninsula when outlining the feature.
    korea = unary_union(by_id["KOR"] + by_id.pop("PRK"))
    by_id["KOR"] = [korea]
    labels["KOR"] = dict(labels["KOR"], NAME_KO="대한민국", LABEL_X=127.3, LABEL_Y=38.5)
    undetermined_features = load("undeterminedAreas", args.source_cache)
    undetermined = unary_union([shape(f["geometry"]) for f in undetermined_features])
    features = []
    for index, (country_id, geometries) in enumerate(sorted(by_id.items()), 1):
        geometry = geometries[0] if len(geometries) == 1 else unary_union(geometries)
        if geometry.intersects(undetermined):
            geometry = geometry.difference(undetermined)
        geometry = normalize(geometry)
        if geometry.is_empty:
            continue
        label = labels[country_id]
        point = Point(label["LABEL_X"], label["LABEL_Y"])
        if not geometry.covers(point):
            point = max(polygons(geometry), key=lambda p: p.area).representative_point()
        features.append({
            "type": "Feature",
            "properties": {
                "id": country_id,
                "name": label["NAME_KO"],
                "coordinates": list(point.coords[0]),
                "minZoom": max(1.5, min(5, label.get("MIN_LABEL") or 1.5)),
            },
            "geometry": mapping(geometry),
            "_area": geometry.area,
        })
        if index % 10 == 0:
            print(f"Processed {index}/{len(by_id)}: {country_id}", flush=True)
    features.sort(key=lambda f: (f["properties"]["minZoom"], -f["_area"], f["properties"]["id"]))
    for feature in features:
        del feature["_area"]
    print(f"Built {len(features)} country/territory features", flush=True)

    normal, disputed, styles = [], [], Counter()
    removed = []
    for feature in load("boundaryLines", args.source_cache):
        p = feature["properties"]
        geometry = shape(feature["geometry"])
        if p["FID"] == KOREA_INTERNAL_LINE_ID:
            west, south, east, north = geometry.bounds
            assert 125 < west < east < 130 and 37 < south < north < 39
            assert p["Style"] == "Dashed"
            removed.append(p["FID"])
            continue
        style = p["Style"].strip()
        styles[style or "Solid (unclassified default)"] += 1
        assert style in ("", "Solid", "Dashed", "Dotted", "Tightly Dashed")
        target = normal if style in ("", "Solid") else disputed
        target.extend(parts(geometry.simplify(TOLERANCE), "LineString"))
    assert removed == [KOREA_INTERNAL_LINE_ID]
    payload = {
        "countries": {"type": "FeatureCollection", "features": features},
        "borders": mapping(MultiLineString(normal)),
        "disputedBorders": mapping(MultiLineString(disputed)),
    }
    manifest = {
        "source": "World Bank Official Boundaries",
        "sourceUrl": WB_CATALOG,
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "retrievedDate": "2026-10-16",
        "coordinateSystem": "WGS84 longitude, latitude",
        "sources": SOURCES,
        "nameSource": {"source": "Natural Earth", "revision": NE_REVISION, "license": "Public domain; localized names from Wikidata CC0"},
        "countryCount": len(features),
        "sourceCountryCount": source_country_count,
        "boundaryStyles": dict(styles),
        "koreaDisplayOverride": {"mergedIds": ["KOR", "PRK"], "id": "KOR", "name": "대한민국", "removedBoundaryLineIds": removed},
        "undeterminedAreas": [f["properties"]["NAM_0"].strip() for f in undetermined_features],
        "notes": [
            "Uses the World Bank institutional boundary view consistently, not a claim of universal UN recognition or historical territorial extent. Crimea is in Ukraine; Western Sahara and Golan Heights are excluded from country fills; Taiwan follows the World Bank China polygon.",
            "World Bank NDLSA (Non-Determined Legal Status Areas) polygons are subtracted from selectable country geometry; they are not assigned to neighboring countries by point proximity.",
            "The entire Korean peninsula is displayed as 대한민국 at the user's request. This explicit application display override is not part of the World Bank source policy.",
            "Country fragments are unioned by ISO_A3; source coastline/land boundaries are simplified at 0.01 degrees with topology preservation and rounded to six decimals. No rectangular territorial bounds or artificial buffers are added. D3 clockwise outer rings; edges are densified at one degree for spherical rendering.",
            "Source boundary Style values Dashed, Dotted and Tightly Dashed remain a separate disputed/non-final line mesh. Blank source styles use the ordinary solid-line mesh; source line FID 70 (the Korean demarcation) is omitted after geometric verification.",
            "Korean names and preferred label locations/priorities use Natural Earth ISO-country metadata only. Country ownership and line classification do not use Natural Earth's de facto polygons. Label points outside the World Bank polygon are moved to an interior representative point.",
            "The public ArcGIS response was checked for exceededTransferLimit. Downloads are hash-pinned; a changed upstream download fails regeneration until reviewed. Run python scripts/build-history-atlas-countries.py --source-cache PATH.",
        ],
        "policyReferences": [
            "https://github.com/worldbank/WB_GAD/blob/main/notebooks/TUTORIAL_drawing_WB_maps.ipynb",
            "https://github.com/nvkelso/natural-earth-vector/blob/" + NE_REVISION + "/packages/Natural_Earth_quick_start/LOCALIZATION.md",
        ],
    }
    write_asset(payload, manifest)


if __name__ == "__main__":
    main()
