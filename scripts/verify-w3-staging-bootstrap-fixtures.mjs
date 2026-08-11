import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scriptPath = "scripts/verify-w3-staging-bootstrap.mjs";
const stagingProject = "westory-staging-177587430482";
const productionProject = "history-quiz-yongsin";

const run = (...argumentsList) =>
  spawnSync(process.execPath, [scriptPath, ...argumentsList], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

const dryRun = run(`--project=${stagingProject}`);
assert.equal(dryRun.status, 0, dryRun.stderr);
const plan = JSON.parse(dryRun.stdout);
assert.equal(plan.mode, "DRY_RUN");
assert.equal(
  plan.verificationScope,
  "STATIC_PLAN_ONLY_NO_NETWORK_OR_CREDENTIAL_ACCESS",
);
assert.equal(plan.liveStateVerified, false);
assert.equal(plan.productionAccess, 0);

const productionAttempt = run(
  `--project=${productionProject}`,
  "--verify-live",
);
assert.notEqual(productionAttempt.status, 0);
assert.match(productionAttempt.stderr, /requires exact --project=/);
assert.doesNotMatch(productionAttempt.stderr, /default credentials|credential/i);

const conflictingModes = run(
  `--project=${stagingProject}`,
  "--apply",
  "--verify-live",
);
assert.notEqual(conflictingModes.status, 0);
assert.match(conflictingModes.stderr, /Choose exactly one live mode/);

const source = readFileSync(scriptPath, "utf8");
const transactionBody = source.slice(
  source.indexOf("await db.runTransaction"),
  source.indexOf("const verification = verifyLiveState", source.indexOf("await db.runTransaction")),
);
assert.match(transactionBody, /transaction\.getAll\(/);
assert.doesNotMatch(transactionBody, /Promise\.all|transaction\.get\(/);
assert.match(source, /Existing active manifest and pointer revisions must match exactly/);
assert.match(source, /Pointer\/manifest revision mismatch/);
assert.match(source, /Config\/manifest revision mismatch/);
assert.match(source, /semesterLifecycleStatus:\s*"ACTIVE"/);
assert.match(source, /semesterWritesEnabled:\s*true/);

console.log(
  JSON.stringify({
    suite: "w3-staging-bootstrap-fixtures",
    passed: true,
    checks: [
      "default dry-run is static and credential-free",
      "production project rejected before credential access",
      "apply and verify-live are mutually exclusive",
      "transaction reads use one getAll call",
      "positive exact revision and lifecycle postconditions are present",
    ],
    productionAccess: 0,
  }),
);
