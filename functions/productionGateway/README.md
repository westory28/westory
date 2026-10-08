# Canonical production gateway source

This directory preserves the dependency closure of the existing `executeCommand`
deployment in `history-quiz-yongsin`. The older root entry cannot reconstruct these
commands safely. Its command exports attached to the root entry are limited to
`executeCommand` and `executeLessonCorePointCommand`; other nested callable
exports are not deployment targets.

`wisEconomyQuery.js` separately restores the live `getWisEconomyState` source,
verified on 2026-10-08 at revision `getwiseconomystate-00006-paf`, Seoul source
generation `1789650242236123`. It preserves the live EXPLICIT teacher archive
query behavior missing from the older command closure. Its ranking projection
shows authorized names/numbers and reads emoji only for the already scoped,
rank-limited entries. An unranked student's own enrollment still bounds the scope.
`../studentWisQuery.js` exports only the Seoul read endpoint; do not deploy or
delete the existing US endpoint (`getwiseconomystate-00002-voh`, source generation
`1789650244531996`). The shared archive dependency differs only in an unrelated
query, and the session dependency intentionally uses the current 60-minute policy.
The callable retains all live options other than the restricted region. The live
query specified no custom memory, timeout or App Check override. The student
maintenance wrapper and active application-session check remain in place.

The captured `executeCommand` revision was `executecommand-00005-duy`, with source
`gs://gcf-v2-sources-177587430482-asia-northeast3/executeCommand/function-source.zip`,
generation `1789562589700121`. Core-point business logic was also compared with
`executeLessonCorePointCommand/function-source.zip`, generation `1789221980929986`,
revision `executelessoncorepointcommand-00002-hin`.

`source-manifest.json` records the original file hashes and reviewed local hashes.
The entry is renamed to `productionSource.js` and avoids duplicate Admin SDK
initialization. Its application-session policy matches the current root login
source. Assessment reset IDs and source metadata, and core-point class/visibility
boundaries, have targeted fixes recorded in that manifest.

Keep LF endings for the source hash checks. Run `npm --prefix functions run check`
before deploying. Never export this directory with `Object.assign`, and never
deploy all root Functions to synchronize a workstation. Use the named deployment
targets in the production release runbook and verify their live revisions.
