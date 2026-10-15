"""Build static atlas memberships; country polygons never enter the browser bundle.

Requires Python + shapely, and the repository's Node/TypeScript installation.
Use --source-cache PATH for the pinned Natural Earth country GeoJSON. The M49
snapshot and explicit, exact-name editorial rules are versioned beside this file.
No substring/alias inference, nearest-country guess, or centroid classification
of historical regions is used. See the generated sources manifest for limits.
"""
import argparse
from collections import Counter
import hashlib
import json
import pathlib
import subprocess
import urllib.request

from shapely.geometry import Point, shape

ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
NE_FILE = "ne_50m_admin_0_countries.geojson"
NE_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{NE_FILE}"
NE_SHA = "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb"
M49_FILE = ROOT / "scripts/history-atlas-world-regions.m49.json"
RULES_FILE = ROOT / "scripts/history-atlas-world-regions.rules.json"
OUT = ROOT / "src/data/historyAtlasWorldRegions.ts"
MANIFEST = ROOT / "docs/reviews/history-atlas-world-regions.sources.json"

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
# An explicit teaching overlay, not an assertion that M49 has a Middle East area.
MIDDLE_EAST_ISO3 = {
    "BHR", "CYP", "EGY", "IRN", "IRQ", "ISR", "JOR", "KWT", "LBN",
    "OMN", "PSE", "QAT", "SAU", "SYR", "TUR", "ARE", "YEM",
}
COUNTRY_NAME_ISO3 = {
    "중국": "CHN", "아랍 에미리트": "ARE", "튀르키예": "TUR",
    "에스파냐": "ESP", "바티칸": "VAT", "타이": "THA", "도미니카": "DMA",
    "중앙아프리카공화국": "CAF", "콩고": "COG", "미크로네시아": "FSM",
    "마셜제도": "MHL",
}

EXTRACT_DATASET = r"""
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(f){
 const p=resolve(f); if(cache.has(p))return cache.get(p);
 const exports={};cache.set(p,exports);
 vm.runInNewContext(ts.transpileModule(readFileSync(p,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{exports,require:n=>{
  if(!n.startsWith('.'))throw new Error('Unexpected nonlocal data dependency');
  return load(resolve(dirname(p),n+'.ts'));
 }});return exports;
}
const d=load('src/data/historyAtlasContent.ts').historyAtlasDataset;
const units=new Set(d.units.filter(u=>u.subject==='world').map(u=>u.id));
const entries=d.entries.filter(e=>units.has(e.unitId));
const ids=new Set(entries.map(e=>e.placeId));
process.stdout.write(JSON.stringify({places:d.places.filter(p=>ids.has(p.id)),entries}));
"""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=pathlib.Path)
    args = parser.parse_args()
    cached = args.source_cache / NE_FILE if args.source_cache else None
    raw = cached.read_bytes() if cached and cached.exists() else urllib.request.urlopen(NE_URL, timeout=120).read()
    if sha(raw) != NE_SHA:
        raise ValueError("Country source does not match pinned Natural Earth revision")
    countries = json.loads(raw)["features"]
    polygons = [(shape(f["geometry"]), f["properties"]) for f in countries]
    m49 = json.loads(M49_FILE.read_text(encoding="utf-8"))
    m49_by_iso = {r["iso3"]: r for r in m49["countries"]}
    iso2_to_iso3 = {f["properties"]["ISO_A2_EH"]: f["properties"]["ISO_A3_EH"] for f in countries}
    name_to_iso = {f["properties"]["NAME_KO"]: f["properties"]["ISO_A3_EH"] for f in countries}
    name_to_iso.update(COUNTRY_NAME_ISO3)
    rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    by_name = {}
    for group in rules["groups"]:
        for name in group["names"]:
            if name in by_name:
                raise ValueError(f"Duplicate explicit name rule: {name}")
            by_name[name] = group
    data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", EXTRACT_DATASET], cwd=ROOT, encoding="utf-8"))
    coverage_file = ROOT / "docs/reviews/history-atlas-world-coverage.json"
    coordinate_audit = json.loads(coverage_file.read_text(encoding="utf-8"))["coordinateAudit"]
    country_audit = {x["placeId"]: x for x in coordinate_audit if x.get("source") == "GeoNames" and x.get("country")}
    by_place_entries = {}
    for entry in data["entries"]:
        by_place_entries.setdefault(entry["placeId"], []).append(entry)

    def regions_for_country(iso3, place=None):
        region = M49_REGIONS.get(m49_by_iso.get(iso3, {}).get("parent"))
        ids = [region] if region else []
        if iso3 == "TWN":
            ids = ["asia-east"]  # geographic label only; no sovereignty inference
        elif iso3 == "ATA":
            ids = ["antarctica"]
        elif iso3 == "XKX":
            ids = ["europe-south"]
        elif iso3 == "GRL":
            ids = ["america-north", "greenland", "arctic"]
        if iso3 in MIDDLE_EAST_ISO3:
            ids.append("middle-east")
        # Only country-wide records get these transcontinental memberships.
        # Cities in Russia/Türkiye have separate exact-name rules where needed.
        if place and place.get("kind") == "country":
            if iso3 == "RUS":
                ids.append("asia-north")
            elif iso3 == "TUR":
                ids.append("europe-south")
        return list(dict.fromkeys(ids))

    result, audit, unclassified = {}, [], []
    for place in data["places"]:
        pid, name, kind = place["id"], place["name"], place.get("kind")
        rule = rules.get("byPlaceId", {}).get(pid) or by_name.get(name)
        info = {"placeId": pid, "name": name}
        ids = []
        if rule:
            ids = rule["regionIds"]
            info.update(method="explicit-geographic-context", note=rule["basis"])
        elif kind == "country" and name in name_to_iso:
            iso3 = name_to_iso[name]
            ids = regions_for_country(iso3, place)
            info.update(method="modern-country-name-to-M49", iso3=iso3)
        elif kind in ("settlement", "site", "mountain"):
            recorded = country_audit.get(pid)
            if recorded:
                iso3 = iso2_to_iso3.get(recorded["country"])
                ids = regions_for_country(iso3)
                info.update(method="previously-reviewed-GeoNames-country-to-M49", iso3=iso3, geonamesId=recorded["id"])
            elif place.get("coordinates"):
                point = Point(place["coordinates"])
                matches = [p for geom, p in polygons if geom.covers(point)]
                if len(matches) == 1:
                    iso3 = matches[0]["ISO_A3_EH"]
                    ids = regions_for_country(iso3)
                    info.update(method="point-in-pinned-country-to-M49", iso3=iso3)
        # Waters, extensive regions, null coordinates and coastal misses have no
        # nearest-country or alias fallback. Every remaining omission is visible.
        ids = list(dict.fromkeys(ids))
        result[pid] = ids
        info["regionIds"] = ids
        if info.get("method") == "explicit-geographic-context" or not ids:
            info["citations"] = list({(c["sourceId"], c["pdfPage"]): {"sourceId": c["sourceId"], "pdfPage": c["pdfPage"]} for e in by_place_entries[pid] for c in e["citations"]}.values())
        if not ids:
            info.setdefault("method", "unclassified")
            info.setdefault("note", "Geographic identity not sufficiently resolved; no alias, nearest-country or broad-unit inference.")
            unclassified.append({"placeId": pid, "name": name, "reason": info["note"]})
        audit.append(info)

    valid_ids = set(M49_REGIONS.values()) | {"asia-north", "middle-east", "antarctica", "arctic", "greenland"} | {"water-" + x for x in ["pacific", "atlantic", "indian", "southern", "arctic", "mediterranean", "black", "red", "baltic", "caribbean", "east-asia", "other"]}
    assert all(set(v) <= valid_ids for v in result.values())
    assert len(result) == len(data["places"])
    # Do not silently add an ocean to a country or a country to an ocean.
    for p in data["places"]:
        rule = rules.get("byPlaceId", {}).get(p["id"]) or by_name.get(p["name"])
        if rule and rule.get("marine"):
            assert result[p["id"]] and all(x.startswith("water-") or x in {"arctic", "antarctica"} for x in result[p["id"]])
    by_name_results = {p["name"]: result[p["id"]] for p in data["places"]}
    expected = {
        "그린란드": {"greenland", "america-north", "arctic"},
        "북극해": {"water-arctic", "arctic"},
        "남극해": {"water-southern", "antarctica"},
        "이집트": {"africa-north", "middle-east"},
        "이란": {"asia-south", "middle-east"},
        "니케아": {"asia-west", "middle-east"},
        "니케아(알렉산드로스 원정)": {"asia-south"},
        "네르친스크": {"asia-north"},
        "캬흐타": {"asia-north"},
        "쿠람·말라야": set(),
        "두르가 사원": set(),
    }
    for name, expected_ids in expected.items():
        assert set(by_name_results[name]) == expected_ids, (name, by_name_results[name])
    assert "asia-central" in by_name_results["서역"]
    assert "europe-east" in by_name_results["로마 제국"]
    assert not any(r.startswith("water-") for r in by_name_results["카스피해"])
    assert not any(r.startswith("water-") for r in by_name_results["나일강"])
    lines = ["// Generated by scripts/build-history-atlas-world-regions.py.", "// Static geographic discovery groups, not historical borders or sovereignty.", "// Evidence and unclassified names: docs/reviews/history-atlas-world-regions.sources.json.", "export const worldAtlasRegionIdsByPlace: Record<string, string[]> = {"]
    for p in sorted(data["places"], key=lambda p: p["id"]):
        lines.append(f'  {json.dumps(p["id"])}: {json.dumps(result[p["id"]], ensure_ascii=False)}, // {p["name"]}')
    lines.append("};\n")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["node", "node_modules/prettier/bin/prettier.cjs", "--write", str(OUT)], cwd=ROOT, check=True)
    manifest = {
        "reviewDate": "2026-10-15",
        "scope": "All places linked to world-subject entries in the effective historyAtlasDataset.",
        "sources": [
            {"name": "UN Statistics Division M49", "url": m49["url"], "retrievedAt": m49["retrievedAt"], "htmlSha256": m49["htmlSha256"], "snapshot": str(M49_FILE.relative_to(ROOT)).replace("\\", "/"), "snapshotSha256": sha(M49_FILE.read_bytes())},
            {"name": "Natural Earth admin-0 countries", "url": NE_URL, "revision": REVISION, "sha256": NE_SHA, "license": "Public domain", "documentation": "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/"},
            {"name": "Previously reviewed GeoNames country assignments", "url": "https://www.geonames.org/export/", "license": "CC BY 4.0", "localAudit": "docs/reviews/history-atlas-world-coverage.json"},
            {"name": "Provided textbooks and atlases", "localAudit": "docs/reviews/history-atlas-world-coverage.json", "note": "Exact named geographic contexts are linked to existing page citations. No textbook text, image or PDF is redistributed."},
        ],
        "editorialRules": {"file": str(RULES_FILE.relative_to(ROOT)).replace("\\", "/"), "sha256": sha(RULES_FILE.read_bytes())},
        "middleEastIso3": sorted(MIDDLE_EAST_ISO3),
        "limitations": rules["limitations"],
        "coverage": {"worldPlaces": len(result), "classified": len(result) - len(unclassified), "unclassified": len(unclassified), "methods": dict(Counter(x["method"] for x in audit)), "memberships": dict(sorted(Counter(r for ids in result.values() for r in ids).items()))},
        "outputSha256": sha(OUT.read_bytes()),
        "unclassified": unclassified,
        "places": audit,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["coverage"], ensure_ascii=False))
    print("Unclassified:", ", ".join(x["name"] for x in unclassified))


if __name__ == "__main__":
    main()
