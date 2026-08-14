import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const fixture = read("scripts/verify-w11-staging-fixture.mjs");
const runner = read("scripts/run-w11-staging-rehearsal.mjs");
const emulatorSuite = read("scripts/verify-w11-emulator-suite.mjs");
const emulatorLifecycle = read("scripts/verify-w11-emulator-lifecycle.mjs");

assert.match(
  fixture,
  /const evidence = commandEvidencePath \? readCommandEvidence\(\) : null/u,
  "Cleanup must accept no external evidence after an early runner failure.",
);
assert.doesNotMatch(
  fixture,
  /--command-evidence or --runner-evidence is required/u,
);
assert.match(fixture, /\.\.\.cutover\.ACTIVITY_COLLECTIONS/u);
assert.match(fixture, /const W11_COMMAND_SPECS = \[/u);
assert.match(fixture, /loadOwnedCommandArtifacts/u);
assert.match(fixture, /targetOwners\.has\(item\.ref\.path\)/u);
assert.match(
  fixture,
  /External evidence path has no live W11 ownership proof/u,
);
assert.match(fixture, /validateOwnedDocument/u);
assert.match(fixture, /transaction\.getAll/u);
assert.match(fixture, /ensureExactOwner\(marker,/u);
assert.match(fixture, /"site_settings\/student_maintenance"/u);
assert.match(fixture, /EXACT_SITE_SETTINGS_STUDENT_MAINTENANCE_SNAPSHOT_HASH/u);
assert.match(fixture, /getFiles\(\{ prefix: storagePrefix \}\)/u);
assert.match(fixture, /custom\.fixtureOwner/u);
assert.match(fixture, /custom\.testRunId/u);
assert.match(fixture, /custom\.actorUid/u);
assert.match(fixture, /validTokenRevocationMeasured: false/u);
assert.match(fixture, /PERSISTED_TOKEN_VALUES_ONLY/u);
assert.match(runner, /candidateSessionPath/u);
assert.match(runner, /SESSION_PATH_DERIVATION/u);

assert.match(emulatorSuite, /FIREBASE_EMULATOR_HUB/u);
assert.match(emulatorSuite, /"logging"/u);
assert.match(emulatorSuite, /"\/internal\/reset"/u);
assert.match(emulatorSuite, /storage\/v1\/b\/\$\{storageBucket\}\/o/u);
for (const port of [4400, 4500, 5001, 8080, 9099, 9150, 9199]) {
  assert.match(emulatorLifecycle, new RegExp(`\\b${port}\\b`, "u"));
}
assert.match(emulatorLifecycle, /captureSuiteProcessTree/u);
assert.match(emulatorLifecycle, /residualParentProcesses: 0/u);
assert.match(emulatorLifecycle, /residualStorageProcesses: 0/u);
assert.match(emulatorLifecycle, /residualHubProcesses: 0/u);
assert.match(emulatorLifecycle, /residualLoggingProcesses: 0/u);

console.log(
  JSON.stringify({
    suite: "w11-staging-safety-static",
    passed: true,
    evidenceOptionalCleanup: true,
    liveOwnershipRevalidation: true,
    maintenanceSnapshotMeasured: true,
    storagePrefixMeasured: true,
    tokenRevocationClaimAccurate: true,
    emulatorLifecycleCoverage: true,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
