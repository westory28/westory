import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contract = JSON.parse(
  readFileSync(resolve("scripts/w11-cutover-test-contract.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(resolve(contract.cutoverManifestPath), "utf8"),
);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.wave, "W11");
assert.match(contract.baselineSha, /^[a-f0-9]{40}$/u);
assert.equal(contract.productionProjectId, "history-quiz-yongsin");
assert.equal(contract.stagingProjectId, "westory-staging-177587430482");
assert.equal(contract.emulatorProjectId, "demo-westory-session-w11");
assert.notEqual(contract.stagingProjectId, contract.productionProjectId);
assert.notEqual(contract.emulatorProjectId, contract.productionProjectId);
assert.equal(contract.expected.productionAccess, 0);
assert.equal(contract.expected.productionWrites, 0);
assert.equal(contract.expected.unknown, 0);
assert.equal(contract.sourceSemesterId, "2026-1");
assert.equal(contract.targetSemesterId, "2026-2");
assert.equal(contract.stagingRehearsal.sourceSemesterId, "2098-1");
assert.equal(contract.stagingRehearsal.targetSemesterId, "2098-2");
assert.equal(contract.stagingRehearsal.canonicalBaselineSemesterId, "2026-2");
assert.equal(
  contract.stagingRehearsal.canonicalBaselineAccess,
  "READ_ONLY_SNAPSHOT",
);
assert.equal(contract.stagingRehearsal.fixtureOwnerRequired, true);
assert.equal(contract.stagingRehearsal.testRunIdRequired, true);
assert.equal(contract.stagingRehearsal.baselineRestoreRequired, true);
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.sourceSemester.semesterId, contract.sourceSemesterId);
assert.equal(manifest.targetSemester.semesterId, contract.targetSemesterId);
assert.equal(
  manifest.environment.shadowSourceSemesterId,
  contract.stagingRehearsal.sourceSemesterId,
);
assert.equal(
  manifest.environment.shadowTargetSemesterId,
  contract.stagingRehearsal.targetSemesterId,
);
assert.equal(
  manifest.environment.productionProjectId,
  contract.productionProjectId,
);
assert.equal(manifest.environment.stagingProjectId, contract.stagingProjectId);
assert.equal(manifest.environment.productionExecutionEnabled, false);
assert.equal(manifest.environment.productionCredentialAccessAllowed, false);
assert.equal(manifest.operationPolicy.genericWritesAllowed, false);
assert.equal(manifest.operationPolicy.callerProvidedPathsAllowed, false);
assert.equal(manifest.operationPolicy.sourceSemesterWritesAllowed, false);
assert.equal(manifest.operationPolicy.productionApplyAllowed, false);
assert.equal(manifest.approval.productionApplyAuthorized, false);

const incompleteWorkDispositions = new Set([
  "COMPLETE_BEFORE_CUTOVER",
  "CLOSE_WITH_SEMESTER",
  "CARRY_AS_READ_ONLY",
  "CANCEL_WITH_AUDIT",
  "MANUAL_REVIEW",
]);
const assertUnique = (values, label) => {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicates.`,
  );
};
assert.equal(manifest.incompleteWorkPolicy.length, 13);
assertUnique(
  manifest.incompleteWorkPolicy.map((item) => item.workType),
  "W11 incomplete work policy",
);
for (const item of manifest.incompleteWorkPolicy) {
  assert.equal(incompleteWorkDispositions.has(item.disposition), true);
  assert.equal(item.targetCopyAllowed, false);
  assert.ok(String(item.reason || "").trim());
}
assertUnique(contract.commands, "W11 commands");
assertUnique(contract.requiredPhases, "W11 phases");
assertUnique(contract.requiredScenarios, "W11 scenarios");
assertUnique(contract.requiredEvidence, "W11 evidence files");
const manifestDatasets = manifest.selectiveClone.map((item) => item.dataset);
const manifestDenylist = manifest.copyDenylist;
const manifestOperationTypes = [
  ...new Set(manifest.selectiveClone.map((item) => item.operationType)),
];
const manifestOperationRows = manifest.selectiveClone.map(
  (item) => item.operationType,
);
assert.equal(Array.isArray(manifest.validationOperations), true);
assert.equal(manifest.validationOperations.length, 1);
const validationOperation = manifest.validationOperations[0];
const manifestAllOperationTypes = [
  ...manifestOperationTypes,
  validationOperation.operationType,
];
const manifestDispositions = [
  ...new Set(manifest.selectiveClone.map((item) => item.disposition)),
].sort();
assertUnique(manifestDatasets, "W11 cutover manifest datasets");
assertUnique(manifestDenylist, "W11 cutover manifest denylist");
assert.equal(
  manifestOperationTypes.includes(validationOperation.operationType),
  false,
  "Validation-only operation must not be duplicated in selectiveClone.",
);
assert.equal(
  manifestOperationRows.length,
  manifestOperationTypes.length,
  "Each manifest dataset must map to one exact operationType.",
);
assert.deepEqual(
  manifestOperationRows,
  manifestDatasets,
  "The server operationType enum must be the manifest dataset enum.",
);
assert.equal(
  manifestDatasets.some((dataset) => manifestDenylist.includes(dataset)),
  false,
  "A dataset cannot be both allowlisted and denied.",
);
for (const item of manifest.selectiveClone) {
  for (const field of [
    "dataset",
    "operationType",
    "disposition",
    "source",
    "target",
    "excludedFields",
    "validation",
    "rollback",
  ]) {
    assert.ok(
      field in item,
      `Manifest ${item.dataset || "UNKNOWN"} lacks ${field}.`,
    );
  }
  assert.notEqual(item.dataset, "UNKNOWN");
  assert.notEqual(item.disposition, "UNKNOWN");
  assert.notEqual(item.operationType, "UNKNOWN");
  assert.equal(Array.isArray(item.excludedFields), true);
}
assert.equal(validationOperation.operationType, "COPY_DENYLIST_ACTIVITY_ZERO");
assert.equal(validationOperation.strategy, "ZERO_ASSERTION");
assert.equal(validationOperation.targetExpectedCount, 0);
assert.equal(
  validationOperation.targetExpectedHash,
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
);
assert.equal(contract.commands.length, contract.expected.commandCount);
assert.equal(contract.requiredPhases.length, contract.expected.phaseCount);
assert.equal(
  contract.requiredScenarios.length,
  contract.expected.scenarioCount,
);
assert.deepEqual(
  contract.requiredPhases,
  manifest.operationPolicy.modes.map((mode) =>
    String(mode).replaceAll("-", "_").toUpperCase(),
  ),
  "W11 phases must be derived from the production-disabled manifest.",
);
assert.equal(contract.query, "getSemesterCutoverState");
assert.equal(contract.readinessCheckId, "semester_cutover_readiness");
assert.equal(contract.preparingExpansion.allowedActor, "admin");
assert.deepEqual(contract.preparingExpansion.targetManifestStatuses, [
  "PREPARING",
  "READY",
]);
assert.equal(contract.preparingExpansion.operations.length, 5);
assert.equal(contract.preparingExpansion.forbiddenEffects.length, 8);
assert.deepEqual(
  contract.preparingExpansion.operations.map((item) => item.dataset),
  manifestDatasets.filter((dataset) =>
    [
      "LEARNING_CONTENT",
      "SCHEDULE_EVENTS",
      "NOTICE_TEMPLATES",
      "WIS_ECONOMY",
      "WIS_ACCOUNTS",
    ].includes(dataset),
  ),
);
assert.deepEqual(
  contract.preparingExpansion.operations.map((item) => item.commandType),
  [
    "createLearningContent",
    "createScheduleEvent",
    "createNotice",
    "createSemesterEconomy",
    "createWisAccounts",
  ],
);

for (const required of [
  "PRODUCTION_FENCE_BEFORE_CREDENTIAL_ACCESS",
  "ARCHIVE_TARGET_IMMUTABLE",
  "CROSS_SEMESTER_LEAKAGE_ZERO",
  "RESPONSE_LOSS_RECEIPT_RECOVERY",
  "REPEAT_FULL_REHEARSAL_TWICE_EFFECT_ONCE",
  "FIXTURE_RECEIPT_AUDIT_SESSION_TOKEN_CLEANUP_ZERO",
]) {
  assert.ok(contract.requiredScenarios.includes(required));
}

console.log(
  JSON.stringify({
    suite: "w11-cutover-contract",
    passed: true,
    commands: contract.commands.length,
    phases: contract.requiredPhases.length,
    scenarios: contract.requiredScenarios.length,
    readinessCheckId: contract.readinessCheckId,
    manifestVersion: manifest.manifestVersion,
    selectiveCloneDatasets: manifestDatasets.length,
    copyDenylistDatasets: manifestDenylist.length,
    incompleteWorkPolicies: manifest.incompleteWorkPolicy.length,
    operationTypes: manifestAllOperationTypes.length,
    dispositions: manifestDispositions,
    unknown: 0,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
