# Canonical production gateway source

This directory preserves the dependency closure of the existing `executeCommand`
deployment in `history-quiz-yongsin`. The older root entry cannot reconstruct these
commands safely. Only `executeCommand` and `executeLessonCorePointCommand` are
attached to the root entry; nested callable exports are not deployment targets.

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
