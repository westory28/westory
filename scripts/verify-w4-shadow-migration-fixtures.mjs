import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = "scripts/verify-w4-shadow-migration.mjs";
const stagingProject = "westory-staging-177587430482";
const productionProject = "history-quiz-yongsin";
const run = (...args) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

const dryRun = run(`--project=${stagingProject}`);
assert.equal(dryRun.status, 0, dryRun.stderr);
const result = JSON.parse(dryRun.stdout);
assert.equal(result.passed, true);
assert.equal(result.mode, "STATIC_SYNTHETIC_DRY_RUN");
assert.equal(result.expectedStudentCount, 3);
assert.equal(result.expectedClassCount, 2);
assert.equal(result.expectedEnrollmentCount, 3);
assert.equal(result.blockingIssueCount, 0);
assert.equal(result.productionAccess, 0);

const production = run(`--project=${productionProject}`, "--verify-live");
assert.notEqual(production.status, 0);
assert.match(production.stderr, /Production shadow migration is forbidden/);
assert.doesNotMatch(production.stderr, /default credentials|credential/i);

const directApply = run(`--project=${stagingProject}`, "--apply");
assert.notEqual(directApply.status, 0);
assert.match(directApply.stderr, /dry-run only/);

const source = readFileSync(script, "utf8");
const stagingFixtureSource = readFileSync(
  "scripts/verify-w4-staging-synthetic-shadow.mjs",
  "utf8",
);
assert.doesNotMatch(
  source,
  /runTransaction|\.batch\(|\.doc\([^\n]+\)\.set\(|\.doc\([^\n]+\)\.delete\(/,
);
assert.match(source, /previewEnrollmentRoster -> importEnrollmentRoster/);
assert.match(source, /getCommandStatus/);
assert.match(stagingFixtureSource, /Production fixture setup is forbidden/);
assert.match(stagingFixtureSource, /--apply-temporary-fixture/);
assert.match(stagingFixtureSource, /refusing to overwrite/);
assert.match(stagingFixtureSource, /w4FixtureOwner === FIXTURE_OWNER/);
assert.match(stagingFixtureSource, /recoveredCleanupWrites/);
assert.match(stagingFixtureSource, /remainingFixtureCount: 0/);

console.log(
  JSON.stringify({
    suite: "w4-shadow-migration-fixtures",
    passed: true,
    cases: [
      "STATIC_SYNTHETIC_MAPPING_PASS",
      "PRODUCTION_FENCE_BEFORE_CREDENTIAL_ACCESS",
      "DIRECT_APPLY_FORBIDDEN",
      "SOURCE_AND_TARGET_ZERO_WRITE",
      "GATEWAY_APPLY_AND_RESUME_CONTRACT",
      "TEMPORARY_STAGING_FIXTURE_FAIL_CLOSED_AND_CLEANED",
    ],
    productionAccess: 0,
  }),
);
