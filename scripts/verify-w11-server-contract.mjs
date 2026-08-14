import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const cutover = requireFromFunctions("./semesterCutover.js");
const contract = JSON.parse(
  readFileSync(resolve("scripts/w11-cutover-test-contract.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(resolve(contract.cutoverManifestPath), "utf8"),
);
const serverSource = readFileSync(
  resolve("functions/semesterCutover.js"),
  "utf8",
);
const deployWorkflow = readFileSync(
  resolve(".github/workflows/deploy-pages.yml"),
  "utf8",
);
const safetyWorkflow = readFileSync(
  resolve(".github/workflows/verify-safety-baseline.yml"),
  "utf8",
);
const runnerSource = readFileSync(
  resolve("scripts/run-w11-staging-rehearsal.mjs"),
  "utf8",
);
const fixtureSource = readFileSync(
  resolve("scripts/verify-w11-staging-fixture.mjs"),
  "utf8",
);
const evidenceGeneratorSource = readFileSync(
  resolve("scripts/generate-w11-staging-evidence.mjs"),
  "utf8",
);
const packageDocument = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
);

const productionFenceIndex = runnerSource.indexOf(
  "assert.notEqual(\n  projectId,\n  PRODUCTION_PROJECT_ID",
);
const credentialImportIndex = runnerSource.indexOf(
  'createRequire(resolve("functions/package.json"))',
);
assert.ok(productionFenceIndex >= 0);
assert.ok(credentialImportIndex > productionFenceIndex);
assert.match(runnerSource, /createCustomToken\(user\.uid\)/u);
assert.match(runnerSource, /getAppCheck\(app\)\.createToken/u);
assert.match(runnerSource, /callable\("previewEnrollmentRoster"/u);
assert.match(runnerSource, /"importEnrollmentRoster"/u);
assert.match(runnerSource, /source:\s*"ARCHIVE"/u);
assert.match(runnerSource, /sourceWriteCount:\s*0/u);
assert.doesNotMatch(runnerSource, /"prepareSemesterArchive"/u);
assert.doesNotMatch(runnerSource, /"freezeSemesterArchive"/u);
assert.doesNotMatch(
  runnerSource,
  /targetStatus:\s*"(?:CLOSING|CLOSED|ARCHIVED)"/u,
);
assert.match(runnerSource, /rehearsalCount:\s*2/u);
assert.match(runnerSource, /replayBusinessEffectCount:\s*0/u);
assert.match(runnerSource, /responseLossRecovered:\s*true/u);
assert.doesNotMatch(runnerSource, /getFirestore|setDoc|updateDoc|deleteDoc/u);
assert.doesNotMatch(
  runnerSource,
  /collection\(["']command_receipts|collection\(["']command_audit_events/u,
);
assert.match(fixtureSource, /residualAttemptItems\.empty, true/u);
assert.match(fixtureSource, /Residual W11 target scope remains/u);
assert.match(fixtureSource, /Residual W11 control scope remains/u);
assert.match(evidenceGeneratorSource, /runner\.passed,\s*true/u);
assert.match(evidenceGeneratorSource, /cleanup\.passed,\s*true/u);
assert.match(evidenceGeneratorSource, /document\.results\.length\s*>\s*0/u);
assert.match(evidenceGeneratorSource, /never overwrite evidence/u);
assert.match(
  evidenceGeneratorSource,
  /document\.projectId,\s*STAGING_PROJECT_ID/u,
);
assert.match(
  evidenceGeneratorSource,
  /document\.deploymentUrl,\s*deploymentUrl/u,
);
assert.match(evidenceGeneratorSource, /document\.commitSha,\s*commitSha/u);
assert.deepEqual(
  [
    "preview-results.json",
    "state-results.json",
    "viewport-results.json",
    "accessibility-results.json",
    "network-write-results.json",
  ].every((file) => evidenceGeneratorSource.includes(file)),
  true,
  "The generator must require all five actual Browser QA evidence files.",
);
assert.equal(
  packageDocument.scripts["generate:w11-staging-evidence"],
  "node scripts/generate-w11-staging-evidence.mjs",
);
assert.equal(
  packageDocument.scripts["verify:w11-evidence:actual"],
  "node scripts/verify-w11-evidence.mjs --verify",
);

for (const [label, workflow] of [
  ["deploy-pages", deployWorkflow],
  ["verify-safety-baseline", safetyWorkflow],
]) {
  assert.match(
    workflow,
    /npm run verify:w11-semester-cutover/u,
    `${label} must execute the exact W11 aggregate.`,
  );
}

assert.deepEqual(
  Object.values(cutover.CUTOVER_COMMAND_TYPES),
  contract.commands,
  "W11 command enum drifted from the verification contract.",
);
assert.equal(cutover.READINESS_CHECK_ID, contract.readinessCheckId);
assert.equal(cutover.APPLY_BATCH_LIMIT, 25);
assert.equal(cutover.MAX_OPERATIONS >= manifest.selectiveClone.length, true);
assert.deepEqual(
  Object.keys(cutover.OPERATION_DEFINITIONS),
  manifest.selectiveClone.map((item) => item.operationType),
  "Server operation enum must be derived from the manifest dataset order.",
);
for (const item of manifest.selectiveClone) {
  assert.equal(
    cutover.OPERATION_DEFINITIONS[item.operationType].strategy,
    item.disposition === "NOT_APPLICABLE"
      ? "VALIDATE_ONLY"
      : item.disposition === "CLONE" && item.dataset === "WIS_CATALOG_REFERENCE"
        ? "REFERENCE"
        : item.disposition,
    `${item.dataset} strategy drifted.`,
  );
}

const emptySnapshot = { count: 0, hash: cutover.EMPTY_SNAPSHOT_HASH };
const normalizedOperations = manifest.selectiveClone.map((item, index) => {
  const definition = cutover.OPERATION_DEFINITIONS[item.operationType];
  const applicable = item.disposition !== "NOT_APPLICABLE";
  const childCommandType = applicable ? definition.commands[0] || null : null;
  return {
    operationKey: `manifest-${String(index + 1).padStart(2, "0")}`,
    operationOrder: index + 1,
    operationType: item.operationType,
    strategy: definition.strategy,
    applicable,
    childCommandType,
    childCommandId: childCommandType
      ? `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      : null,
    childPayloadHash: childCommandType ? "a".repeat(64) : null,
    sourceSnapshot: emptySnapshot,
    targetBeforeSnapshot: emptySnapshot,
    targetAfterSnapshot: emptySnapshot,
  };
});
const operations = normalizedOperations.map(
  ({ strategy, ...operation }) => operation,
);
const payload = {
  manifestVersion: manifest.manifestVersion,
  sourceSemesterId: manifest.sourceSemester.semesterId,
  targetSemesterId: manifest.targetSemester.semesterId,
  sourceManifestRevision: 1,
  targetManifestRevision: 1,
  copyDenylist: manifest.copyDenylist,
  operations,
};
payload.manifestHash = cutover.computeManifestHash({
  ...payload,
  operations: normalizedOperations,
});
const normalized = cutover.normalizeCutoverPayload(
  cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN,
  payload,
);
assert.equal(normalized.manifestHash, payload.manifestHash);
assert.deepEqual(normalized.copyDenylist, manifest.copyDenylist);
assert.deepEqual(
  normalized.operations.map((item) => item.operationType),
  manifest.selectiveClone.map((item) => item.operationType),
);
const deterministicPlanId = cutover.planIdFor(
  manifest.manifestVersion,
  manifest.sourceSemester.semesterId,
  manifest.targetSemester.semesterId,
);
assert.match(deterministicPlanId, /^cutplan_[0-9a-f]{64}$/u);
assert.equal(
  deterministicPlanId,
  cutover.planIdFor(
    manifest.manifestVersion,
    manifest.sourceSemester.semesterId,
    manifest.targetSemester.semesterId,
  ),
);
assert.notEqual(
  deterministicPlanId,
  cutover.planIdFor(
    `${manifest.manifestVersion}-next`,
    manifest.sourceSemester.semesterId,
    manifest.targetSemester.semesterId,
  ),
  "A manifestVersion bump must allocate another deterministic planId.",
);
assert.match(serverSource, /let suggestedPlan = null;/u);
assert.match(
  serverSource,
  /suggestedPlanUnavailableReason = "APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED";/u,
);
assert.match(
  serverSource,
  /suggestedPlanPolicy:\s*"APPROVED_AUTHENTICATED_RUNNER_ONLY"/u,
);
assert.doesNotMatch(serverSource, /SERVER_EXACT_RESERVED_REHEARSAL_ONLY/u);
assert.match(
  serverSource,
  /source:\s*inspected\[operation\.operationKey\]\.source,\s*target:\s*inspected\[operation\.operationKey\]\.target/u,
  "The approved runner requires aggregate count/hash plus bounded scan evidence.",
);
assert.doesNotMatch(
  serverSource,
  /suggestedPlan\s*=\s*\{/u,
  "W11 B runner requires server query to remain fail-closed without an approved child blueprint.",
);

for (const [name, expected] of Object.entries({
  CUTOVER_PLAN_COLLECTION: "semester_cutover_plans",
  CUTOVER_ATTEMPT_COLLECTION: "semester_cutover_attempts",
  CUTOVER_EVIDENCE_COLLECTION: "semester_cutover_evidence",
  CUTOVER_TARGET_COLLECTION: "semester_cutover_targets",
})) {
  assert.equal(cutover[name], expected);
}
assert.deepEqual(cutover.getSemesterCutoverCommandSessionOptions(), {
  recentAuth: true,
  highRisk: true,
});
assert.doesNotThrow(() =>
  cutover.assertProjectSemesterPair(
    contract.emulatorProjectId,
    contract.sourceSemesterId,
    contract.targetSemesterId,
  ),
);
assert.throws(
  () =>
    cutover.assertProjectSemesterPair(
      contract.stagingProjectId,
      contract.sourceSemesterId,
      contract.targetSemesterId,
    ),
  (error) => error.details?.reason === "W11_STAGING_SCOPE_FORBIDDEN",
);
assert.doesNotThrow(() =>
  cutover.assertProjectSemesterPair(
    contract.stagingProjectId,
    contract.stagingRehearsal.sourceSemesterId,
    contract.stagingRehearsal.targetSemesterId,
  ),
);
assert.equal(
  cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, {
    planId: deterministicPlanId,
    expectedPlanRevision: 2,
    expectedAttemptRevision: 1,
  }).expectedAttemptRevision,
  1,
);
assert.match(serverSource, /W11_CUTOVER_TARGET_PLAN_MISMATCH/u);
assert.match(serverSource, /W11_ATTEMPT_REVISION_REQUIRED/u);
assert.match(serverSource, /command_audit_events/u);
assert.match(serverSource, /W11_CHILD_RECEIPT_AUTHORITY_MISMATCH/u);
assert.match(serverSource, /W11_CHILD_AUDIT_MISMATCH/u);
assert.match(serverSource, /W11_CHILD_RECEIPT_TARGET_MISSING/u);
assert.match(serverSource, /status === "SUCCEEDED"/u);
assert.match(serverSource, /expectedTargetRevisions/u);
assert.match(serverSource, /targetPreconditions/u);
assert.match(serverSource, /W11_ROLLBACK_NOT_REQUIRED/u);
assert.match(serverSource, /W11_ROLLBACK_TARGET_MISSING/u);
assert.match(
  serverSource,
  /allItems\.some\([\s\S]{0,300}W11_ITEM_SCOPE_MISMATCH/u,
);
assert.match(serverSource, /canonicalBusinessWriteCount: 0/u);

console.log(
  JSON.stringify({
    suite: "w11-server-contract",
    passed: true,
    commands: contract.commands.length,
    datasets: normalized.operations.length,
    copyDenylist: normalized.copyDenylist.length,
    applyBatchLimit: cutover.APPLY_BATCH_LIMIT,
    deterministicPlanId: true,
    blockedDryRunRetry: true,
    latestPlanFence: true,
    receiptAuditAuthorityReconciliation: true,
    rollbackSucceededItemsOnly: true,
    stagingScopeFence: true,
    suggestedPlanGenerated: false,
    readinessCheckId: cutover.READINESS_CHECK_ID,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
