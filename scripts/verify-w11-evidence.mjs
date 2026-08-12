import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w11-cutover-test-contract.json");
const schema = readJson("scripts/w11-staging-evidence-schema.json");
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name) =>
  String(
    args
      .find((item) => item.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=") || "",
  ).trim();

assert.equal(
  has("dry-run") || has("verify"),
  true,
  "Choose --dry-run or --verify.",
);
assert.equal(has("dry-run") && has("verify"), false);
assert.equal(schema.schemaVersion, 1);
assert.equal(schema.fixtureOwner, "w11-semester-cutover-staging");
assert.equal(contract.productionProjectId, "history-quiz-yongsin");
assert.notEqual(contract.stagingProjectId, contract.productionProjectId);

if (has("dry-run")) {
  console.log(
    JSON.stringify({
      suite: "w11-evidence-dry-run",
      passed: true,
      fixtureOwner: schema.fixtureOwner,
      projectId: contract.stagingProjectId,
      sourceSemesterId: contract.stagingRehearsal.sourceSemesterId,
      targetSemesterId: contract.stagingRehearsal.targetSemesterId,
      canonicalBaselineSemesterId:
        contract.stagingRehearsal.canonicalBaselineSemesterId,
      canonicalBaselineAccess:
        contract.stagingRehearsal.canonicalBaselineAccess,
      rehearsalRuns: 2,
      phases: contract.requiredPhases.length,
      scenarios: contract.requiredScenarios.length,
      requiredFiles: schema.requiredFiles.length,
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
  process.exit(0);
}

const testRunId = value("test-run-id");
assert.match(testRunId, new RegExp(schema.testRunIdPattern, "u"));
const evidenceRoot =
  value("evidence-root") ||
  schema.evidenceRoot.replace("{testRunId}", testRunId);
assert.equal(
  resolve(evidenceRoot),
  resolve("docs/evidence/w11-cutover", testRunId),
  "Evidence must remain inside the exact W11 testRunId directory.",
);
for (const file of schema.requiredFiles) {
  assert.equal(
    existsSync(resolve(evidenceRoot, file)),
    true,
    `Missing evidence: ${file}`,
  );
}
const evidence = Object.fromEntries(
  schema.requiredFiles.map((file) => [
    file,
    readJson(resolve(evidenceRoot, file)),
  ]),
);
const metadata = evidence["metadata.json"];
for (const field of schema.metadataRequired) {
  assert.ok(field in metadata, `Metadata field missing: ${field}`);
}
assert.equal(metadata.fixtureOwner, schema.fixtureOwner);
assert.equal(metadata.testRunId, testRunId);
assert.equal(metadata.projectId, contract.stagingProjectId);
assert.equal(
  metadata.stableAlias,
  "https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app",
);
assert.match(metadata.deploymentUrl, /^https:\/\//u);
assert.ok(String(metadata.branch || "").startsWith("codex/"));
assert.equal(
  metadata.sourceSemesterId,
  contract.stagingRehearsal.sourceSemesterId,
);
assert.equal(
  metadata.targetSemesterId,
  contract.stagingRehearsal.targetSemesterId,
);
assert.equal(
  metadata.canonicalBaselineSemesterId,
  contract.stagingRehearsal.canonicalBaselineSemesterId,
);
assert.equal(metadata.canonicalBaselineMutationCount, 0);
assert.equal(metadata.baselineRestoreVerified, true);
assert.match(metadata.canonicalBaselineSnapshotHashBefore, /^[a-f0-9]{64}$/u);
assert.equal(
  metadata.canonicalBaselineSnapshotHashAfter,
  metadata.canonicalBaselineSnapshotHashBefore,
  "The canonical Staging baseline must remain byte-for-byte unchanged.",
);
assert.match(metadata.commitSha, /^[a-f0-9]{40}$/u);
assert.equal(Number.isNaN(Date.parse(metadata.startedAt)), false);
assert.equal(Number.isNaN(Date.parse(metadata.completedAt)), false);
assert.ok(Date.parse(metadata.completedAt) >= Date.parse(metadata.startedAt));
for (const field of [
  "productionAccess",
  "productionWriteCount",
  "maintenanceMutationCount",
  "activationControlCount",
  "maintenanceControlCount",
  "credentialValueCount",
  "tokenValueCount",
]) {
  assert.equal(metadata[field], 0, `${field} must remain zero.`);
}

const scanForbiddenKeys = (node, path = "evidence") => {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, item] of Object.entries(node)) {
    assert.equal(
      schema.forbiddenEvidenceKeys.includes(key),
      false,
      `Forbidden evidence key: ${path}.${key}`,
    );
    scanForbiddenKeys(item, `${path}.${key}`);
  }
};
scanForbiddenKeys(evidence);

const assertRows = (file, required) => {
  const rows = evidence[file];
  assert.equal(Array.isArray(rows), true, `${file} must be an array.`);
  for (const row of rows) {
    for (const field of required) {
      assert.ok(field in row, `${file} missing ${field}.`);
    }
    assert.equal(row.status, "PASS", `${file} contains a non-PASS row.`);
  }
  return rows;
};
const phases = assertRows("phase-results.json", schema.phaseResultRequired);
const attempts = assertRows(
  "attempt-results.json",
  schema.attemptResultRequired,
);
const datasets = assertRows(
  "dataset-results.json",
  schema.datasetResultRequired,
);
const readiness = assertRows(
  "readiness-results.json",
  schema.readinessResultRequired,
);

const assertResultRows = (file, required) => {
  const document = evidence[file];
  assert.equal(document.schemaVersion, 1, `${file} schemaVersion drift.`);
  assert.equal(document.testRunId, testRunId, `${file} testRunId drift.`);
  assert.equal(
    Array.isArray(document.results),
    true,
    `${file}.results must be an array.`,
  );
  for (const row of document.results) {
    for (const field of required) {
      assert.ok(field in row, `${file} missing ${field}.`);
    }
    assert.equal(row.status, "PASS", `${file} contains a non-PASS row.`);
  }
  return document.results;
};
const previews = assertResultRows(
  "preview-results.json",
  schema.previewResultRequired,
);
const states = assertResultRows(
  "state-results.json",
  schema.stateResultRequired,
);
const viewports = assertResultRows(
  "viewport-results.json",
  schema.viewportResultRequired,
);
const accessibility = assertResultRows(
  "accessibility-results.json",
  schema.accessibilityResultRequired,
);
const network = assertResultRows(
  "network-write-results.json",
  schema.networkWriteResultRequired,
);

assert.deepEqual(
  [...new Set(phases.map((row) => row.rehearsalNumber))].sort(),
  [1, 2],
  "Evidence must contain two complete rehearsal runs.",
);
for (const rehearsalNumber of [1, 2]) {
  const observed = new Set(
    phases
      .filter((row) => row.rehearsalNumber === rehearsalNumber)
      .map((row) => row.phase),
  );
  for (const phase of contract.requiredPhases) {
    assert.ok(
      observed.has(phase),
      `Rehearsal ${rehearsalNumber} is missing ${phase}.`,
    );
  }
}
for (const row of phases) {
  assert.equal(row.crossSemesterMutationCount, 0);
  if (["PLAN", "DRY_RUN", "VERIFY", "ROLLBACK_PLAN"].includes(row.phase)) {
    assert.equal(row.canonicalMutationCount, 0);
  }
}
assert.ok(attempts.some((row) => row.partialFailureCount > 0));
assert.ok(attempts.some((row) => row.responseLossRecovered === true));
for (const row of attempts) {
  assert.equal(row.resumeSucceededItemEffectCount, 0);
}
for (const row of datasets) {
  assert.equal(row.orphanCount, 0);
  assert.equal(row.duplicateCount, 0);
  assert.equal(row.archiveMutationCount, 0);
  assert.equal(row.activityCloneCount, 0);
  assert.equal(row.crossSemesterLeakageCount, 0);
}
for (const row of previews) {
  assert.equal(row.writeCount, 0);
  assert.equal(row.activationControlCount, 0);
  assert.equal(row.maintenanceControlCount, 0);
}
assert.deepEqual(
  [...new Set(states.map((row) => row.state))].sort(),
  ["ARCHIVE", "CURRENT", "ERROR", "EXPLICIT", "LEGACY", "PREPARING", "STALE"],
  "W11 UI evidence must include each source and stale/error state.",
);
assert.deepEqual(
  [...new Set(viewports.map((row) => `${row.width}x${row.height}`))].sort(),
  ["1024x768", "1600x900", "390x844"],
  "W11 UI evidence must include the three representative viewports.",
);
for (const row of viewports) {
  assert.equal(row.horizontalOverflowPx, 0);
  assert.equal(row.navigationOverlapCount, 0);
  assert.equal(row.dialogViewportEscapeCount, 0);
  assert.equal(row.activationControlCount, 0);
  assert.equal(row.maintenanceControlCount, 0);
}
for (const row of accessibility) {
  assert.equal(row.axeCritical, 0);
  assert.equal(row.axeSerious, 0);
  assert.equal(row.keyboardPass, true);
  assert.equal(row.focusVisible, true);
}
for (const row of network) {
  assert.equal(row.mountWriteCount, 0);
  assert.equal(row.queryWriteCount, 0);
  assert.equal(row.previewWriteCount, 0);
  assert.equal(row.productionRequestCount, 0);
}
assert.ok(
  readiness.some(
    (row) =>
      row.checkId === contract.readinessCheckId &&
      row.fresh === true &&
      row.status === "PASS",
  ),
  "Fresh W11 readiness evidence is missing.",
);
const cleanup = evidence["cleanup-results.json"];
assert.equal(cleanup.schemaVersion, 1);
assert.equal(cleanup.testRunId, testRunId);
assert.equal(cleanup.status, "PASS");
for (const field of schema.cleanupRequiredZeroFields) {
  assert.equal(cleanup[field], 0, `${field} must be zero.`);
}

console.log(
  JSON.stringify({
    suite: "w11-evidence-verify",
    passed: true,
    testRunId,
    phaseRows: phases.length,
    attempts: attempts.length,
    datasets: datasets.length,
    readinessRows: readiness.length,
    previewRows: previews.length,
    stateRows: states.length,
    viewportRows: viewports.length,
    accessibilityRows: accessibility.length,
    networkRows: network.length,
    rehearsalRuns: 2,
    residuals: 0,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
