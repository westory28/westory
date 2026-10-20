# River supplement

`rivers-supplement.json` is a separate derived OpenStreetMap database, licensed
under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Attribution: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
The map must display this credit when it uses the supplement. The adjacent
`rivers-supplement.sources.json` records response hashes, source queries,
retrieval and OSM base timestamps, way IDs, geometry hash and coverage limits.
The derived GeoJSON and this manifest are distributed together under ODbL 1.0.
Natural Earth layers retain their separate public-domain provenance.

The input consists of explicitly named `waterway=river` / `waterway=stream`
centerline ways. Each way is simplified independently at 0.0003 degrees
(roughly tens of metres, varying with latitude) with Shapely's topology
preservation enabled, then rounded to six decimals. Endpoints remain fixed.
Each output feature is a MultiLineString; its parts correspond to its sorted
`osmWayIds`. Parts are not joined and gaps are not filled. No AI tracing,
interpolation or reconstruction of historic river courses is involved.

These are the named segments available in the saved OSM responses. Their
presence does not certify a complete headwater-to-mouth line. Historical
names such as 패강 and 백강 require source-specific identification; the builder
does not assign them a modern river automatically. The coverage manifest
distinguishes supplement coverage, Natural Earth-only coverage and unresolved
names.

To reproduce with Python and Shapely installed:

```powershell
python scripts/build-history-atlas-river-supplement.py --source <saved-response.json> --source <additional-response.json>
```

Saved response files stay outside the repository. Each optional sidecar named
`<saved-response>.request.json` records `query`, `url` and `retrievedAt`.
An optional `includedNames` array selects complete named groups from that
response. This permits a newer response to replace a whole river without
mixing old and new versions of its individual ways. The manifest preserves
these explicit filters; conflicting duplicate way snapshots cause a build error.
The build reads only local responses and makes no network request. The app
serves the derived file locally; it does not query Overpass on user visits.

The 2026-10-20 Liao amendment uses the OSM API response for waterway relation
405843. Its ordered `main_stream` ways continue through Panjin to the
Shuangtaizi estuary; the generalized Natural Earth line instead continues
toward Yingkou/Daliao. Selection therefore prefers the OSM main stream.
No vertices are interpolated or simplified in this amendment. After rebuilding
the general supplement, apply the saved response with:

```powershell
node scripts/build-history-atlas-liao-river.mjs <liao-relation-405843.json>
```

Its response hash, member way IDs, relation version, endpoints and processing
are recorded in the same ODbL source manifest. Other river groups are preserved.
