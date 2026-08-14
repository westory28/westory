import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertW11DeploymentProvenance,
  verifyW11ScreenshotManifest,
} from "./verify-w11-screenshot-manifest.mjs";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w11-cutover-test-contract.json");
const schema = readJson("scripts/w11-staging-evidence-schema.json");
const cutoverManifest = readJson(contract.cutoverManifestPath);
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
      requiredViewports: schema.requiredViewports.length,
      dpr: schema.requiredDpr,
      fullPage: schema.requiredFullPage,
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
assert.equal(metadata.stableAlias, schema.deploymentProvenance.stableAlias);
assertW11DeploymentProvenance(metadata, "metadata.json");
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
assert.match(metadata.sourceCommitSha, /^[a-f0-9]{40}$/u);
assert.equal(metadata.commitSha, metadata.sourceCommitSha);
assert.equal(Number.isNaN(Date.parse(metadata.startedAt)), false);
assert.equal(Number.isNaN(Date.parse(metadata.completedAt)), false);
assert.equal(Number.isNaN(Date.parse(metadata.inspectedAt)), false);
assert.ok(Date.parse(metadata.completedAt) >= Date.parse(metadata.startedAt));
assert.ok(Date.parse(metadata.inspectedAt) <= Date.parse(metadata.completedAt));
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

const forbiddenKeys = new Set(
  schema.forbiddenEvidenceKeys.map((key) =>
    key.toLowerCase().replace(/[^a-z0-9]/gu, ""),
  ),
);
const safeAttestationValues = new Map([
  ["tokenvalueswritten", 0],
  ["residualtokens", 0],
  ["credentialvaluecount", 0],
  ["tokenvaluecount", 0],
  ["residualtokenvaluerecords", 0],
  [
    "residualtokensbasis",
    "PERSISTED_TOKEN_VALUES_ONLY; RUNNER_TOKEN_VALUES_ARE_DISCARDED_IN_MEMORY",
  ],
  ["validtokenrevocationmeasured", false],
  [
    "validtokenrevocationstatus",
    "NOT_MEASURED; ADMIN_ID_AND_APP_CHECK_TOKENS_ARE_EPHEMERAL_AND_NOT_RETAINED",
  ],
]);
const assertNoSecrets = (node, path = "evidence") => {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, item] of Object.entries(node)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    const sensitiveFragment = [
      "token",
      "password",
      "credential",
      "authorization",
      "cookie",
      "apikey",
      "secret",
      "bypass",
      "debug",
    ].some((fragment) => normalizedKey.includes(fragment));
    assert.equal(
      forbiddenKeys.has(normalizedKey) ||
        (sensitiveFragment && !safeAttestationValues.has(normalizedKey)),
      false,
      `Forbidden key: ${path}.${key}`,
    );
    if (safeAttestationValues.has(normalizedKey)) {
      assert.deepEqual(
        item,
        safeAttestationValues.get(normalizedKey),
        `${path}.${key} is not an approved exact-value safety attestation.`,
      );
    }
    if (typeof item === "string") {
      assert.doesNotMatch(
        item,
        /\bBearer\s+\S+/iu,
        `Bearer value at ${path}.${key}.`,
      );
      assert.doesNotMatch(
        item,
        /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
        `JWT-like value at ${path}.${key}.`,
      );
      assert.doesNotMatch(
        item,
        /\bAIza[0-9A-Za-z_-]{20,}\b/u,
        `API key at ${path}.${key}.`,
      );
    }
    assertNoSecrets(item, `${path}.${key}`);
  }
};
assertNoSecrets(evidence);

const assertRows = (file, required) => {
  const rows = evidence[file];
  assert.equal(Array.isArray(rows), true, `${file} must be an array.`);
  assert.ok(rows.length > 0, `${file} cannot be empty.`);
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
  for (const field of schema.browserProvenanceRequired) {
    assert.equal(
      document[field],
      metadata[field],
      `${file} ${field} provenance drift.`,
    );
  }
  assertW11DeploymentProvenance(document, file);
  assert.equal(
    Array.isArray(document.results),
    true,
    `${file}.results must be an array.`,
  );
  assert.ok(document.results.length > 0, `${file}.results cannot be empty.`);
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
const screenshotEvidence = verifyW11ScreenshotManifest({
  manifestPath: resolve(evidenceRoot, "screenshot-manifest.json"),
  screenshotsRoot: evidenceRoot,
  expected: {
    testRunId,
    ...Object.fromEntries(
      schema.browserProvenanceRequired.map((field) => [field, metadata[field]]),
    ),
  },
  completedAt: metadata.completedAt,
});

assert.deepEqual(
  [...new Set(phases.map((row) => row.rehearsalNumber))].sort(),
  [1, 2],
  "Evidence must contain two complete rehearsal runs.",
);
assert.equal(phases.length, contract.requiredPhases.length * 2);
assert.equal(new Set(phases.map((row) => row.caseId)).size, phases.length);
const phaseCommandTypes = new Map([
  ["PLAN", "createSemesterCutoverPlan"],
  ["DRY_RUN", "dryRunSemesterCutover"],
  ["APPLY", "applySemesterCutoverBatch"],
  ["VERIFY", "verifySemesterCutover"],
  ["RESUME", "resumeSemesterCutover"],
  ["ROLLBACK_PLAN", "createSemesterRollbackPlan"],
]);
for (const rehearsalNumber of [1, 2]) {
  for (const phase of contract.requiredPhases) {
    const row = phases.find(
      (candidate) =>
        candidate.rehearsalNumber === rehearsalNumber &&
        candidate.phase === phase,
    );
    assert.ok(row, `Rehearsal ${rehearsalNumber} is missing ${phase}.`);
    assert.equal(row.commandType, phaseCommandTypes.get(phase));
    assert.match(
      row.commandId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    assert.match(row.payloadHash, /^[a-f0-9]{64}$/u);
    assert.equal(row.receiptStatus, "SUCCEEDED");
    assert.equal(row.crossSemesterMutationCount, 0);
    if (phase === "APPLY" && rehearsalNumber === 1) {
      assert.ok(row.canonicalMutationCount > 0);
    } else {
      assert.equal(row.canonicalMutationCount, 0);
    }
  }
}
for (const phase of contract.requiredPhases) {
  const rows = phases.filter((row) => row.phase === phase);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].commandId, rows[1].commandId);
  assert.equal(rows[0].payloadHash, rows[1].payloadHash);
}
assert.equal(attempts.length, 2);
assert.deepEqual(attempts.map((row) => row.rehearsalNumber).sort(), [1, 2]);
assert.equal(new Set(attempts.map((row) => row.planId)).size, 1);
assert.equal(new Set(attempts.map((row) => row.attemptId)).size, 1);
assert.match(attempts[0].planId, /^cutplan_[a-f0-9]{64}$/u);
assert.match(attempts[0].attemptId, /^cutattempt_[a-f0-9]{64}$/u);
for (const row of attempts) {
  assert.equal(row.result, row.rehearsalNumber === 1 ? "EXECUTED" : "REPLAYED");
  assert.equal(row.partialFailureCount, 1);
  assert.equal(row.responseLossRecovered, true);
  assert.equal(row.resumeAttemptedItemCount, 1);
  assert.equal(row.resumeSucceededItemEffectCount, 0);
}
assert.equal(datasets.length, 12);
assert.deepEqual(
  [...new Set(datasets.map((row) => row.operation))].sort(),
  cutoverManifest.selectiveClone.map((row) => row.operationType).sort(),
  "Dataset evidence must cover the exact W11 operation registry.",
);
for (const row of datasets) {
  assert.equal(
    Number.isSafeInteger(row.sourceCount) && row.sourceCount >= 0,
    true,
  );
  assert.equal(
    Number.isSafeInteger(row.targetCount) && row.targetCount >= 0,
    true,
  );
  assert.match(row.sourceHash, /^[a-f0-9]{64}$/u);
  assert.match(row.targetHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    row.metricBasis,
    "INFERRED_FROM_EXACT_SNAPSHOT_VERIFY_AND_REQUIRED_READINESS_PASS",
  );
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
  [...schema.requiredBrowserStates].sort(),
  "W11 browser evidence must include the source states rendered by the cutover center.",
);
for (const row of states) {
  assert.equal(row.route, schema.requiredScreenshotRoute);
  assert.equal(row.status, "PASS");
}
assert.deepEqual(
  [...new Set(viewports.map((row) => `${row.width}x${row.height}`))].sort(),
  schema.requiredViewports
    .map((viewport) => `${viewport.width}x${viewport.height}`)
    .sort(),
  "W11 UI evidence must include exactly the five required viewports.",
);
for (const row of viewports) {
  assert.equal(row.route, schema.requiredScreenshotRoute);
  assert.equal(row.dpr, schema.requiredDpr);
  assert.equal(row.fullPage, schema.requiredFullPage);
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
    screenshotRows: screenshotEvidence.screenshotFiles.length,
    accessibilityRows: accessibility.length,
    networkRows: network.length,
    rehearsalRuns: 2,
    residuals: 0,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
