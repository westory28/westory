const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const cutover = require("../semesterCutover");
const cutoverAuthorization = require("../cutoverAuthorization");
const commandGateway = require("../commandGateway");
const semesterCore = require("../semesterCore");
const w8Domains = require("../w8Domains");
const wisEconomy = require("../wisEconomy");

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../docs/manifests/2026-2-cutover-manifest.json"), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const hashPayload = (value) => commandGateway.sha256(commandGateway.canonicalize(value));
const empty = { count: 0, hash: cutover.EMPTY_SNAPSHOT_HASH };
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const baseOperations = manifest.selectiveClone.map((entry, index) => {
  const definition = cutover.OPERATION_DEFINITIONS[entry.operationType];
  const applicable = entry.disposition !== "NOT_APPLICABLE";
  const childCommandType = applicable ? definition.commands[0] || null : null;
  return {
    operationKey: `manifest-${String(index + 1).padStart(2, "0")}`,
    operationOrder: index + 1,
    operationType: entry.operationType,
    applicable,
    childCommandType,
    childCommandId: childCommandType ? uuid(index + 1) : null,
    childPayloadHash: childCommandType ? "a".repeat(64) : null,
    sourceSnapshot: empty,
    targetBeforeSnapshot: empty,
    targetAfterSnapshot: empty,
  };
});
const createPayload = (operations = baseOperations) => {
  const partial = {
    manifestVersion: manifest.manifestVersion,
    sourceSemesterId: "2098-1",
    targetSemesterId: "2098-2",
    sourceManifestRevision: 1,
    targetManifestRevision: 1,
    copyDenylist: manifest.copyDenylist,
    operations,
  };
  const normalizedOperations = operations.map((operation, index) => ({
    ...operation,
    strategy: cutover.OPERATION_DEFINITIONS[operation.operationType].strategy,
    operationOrder: operation.operationOrder || index + 1,
  }));
  return { ...partial, manifestHash: cutover.computeManifestHash({ ...partial, operations: normalizedOperations }) };
};

assert.deepEqual(Object.keys(cutover.OPERATION_DEFINITIONS), manifest.selectiveClone.map((entry) => entry.operationType));
assert.deepEqual(cutover.COPY_DENYLIST, manifest.copyDenylist);
assert.equal(cutover.APPLY_BATCH_LIMIT, 25);
assert.equal(cutover.MAX_OPERATIONS, 100);
assert.equal(cutover.SNAPSHOT_TRANSACTION_BYTE_LIMIT < 10_000_000, true);
assert.equal(cutover.SNAPSHOT_TOTAL_BYTE_LIMIT < cutover.SNAPSHOT_TRANSACTION_BYTE_LIMIT, true);
assert.equal(cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, createPayload()).operations.length, 12);
const precomputablePlanId = cutover.planIdFor(manifest.manifestVersion, "2098-1", "2098-2");
assert.equal(precomputablePlanId, cutover.planIdFor(manifest.manifestVersion, "2098-1", "2098-2"));
const childPayloadWithPlan = { ...activeLearningPlaceholder(), semesterId: "2098-2", expectedSemesterRevision: 1, cutoverPlanId: precomputablePlanId, cutoverOperationKey: "learning-clone-1" };
const childHashWithPlan = hashPayload(w8Domains.normalizeW8Payload(w8Domains.W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT, childPayloadWithPlan));
assert.match(childHashWithPlan, /^[a-f0-9]{64}$/u);
const boundOperations = clone(baseOperations);
const learningBound = boundOperations.find((operation) => operation.operationType === "LEARNING_CONTENT");
learningBound.operationKey = "learning-clone-1";
learningBound.childPayloadHash = childHashWithPlan;
const boundPlan = cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, createPayload(boundOperations));
assert.equal(cutover.planIdFor(boundPlan.manifestVersion, boundPlan.sourceSemesterId, boundPlan.targetSemesterId), precomputablePlanId);

const duplicateDataset = clone(baseOperations);
duplicateDataset.push({ ...clone(duplicateDataset.find((item) => item.operationType === "LEARNING_CONTENT")), operationKey: "learning-second", operationOrder: 13, childCommandId: uuid(13) });
const duplicateNormalized = cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, createPayload(duplicateDataset));
assert.equal(duplicateNormalized.operations.filter((item) => item.operationType === "LEARNING_CONTENT").length, 2);

const mismatchedAggregate = clone(duplicateDataset);
mismatchedAggregate.at(-1).targetAfterSnapshot = { count: 1, hash: "b".repeat(64) };
assert.throws(
  () => cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, createPayload(mismatchedAggregate)),
  (error) => error.details?.reason === "W11_DATASET_SNAPSHOT_MISMATCH",
);
const manifestBeforeReadiness = {
  semesterId: "2098-2", revision: 1, stateRevision: 1, status: "PREPARING", provenance: "PREPARING",
  displayName: "합성 준비 학기", startAt: "2098-08-01", endAt: "2098-12-31", readinessPolicyVersion: "w3-v1",
  readinessReportId: null, readinessReportRef: null,
};
const manifestAfterReadiness = {
  ...manifestBeforeReadiness, stateRevision: 2, status: "VALIDATING", readinessReportId: "readiness-example",
  readinessReportRef: "semester_readiness_reports/2098-2", lastTransitionReason: "준비도 검증", updatedBy: "admin-1",
};
const manifestAfterReady = { ...manifestAfterReadiness, stateRevision: 3, status: "READY", provenance: "PREPARING", lastTransitionReason: "준비 완료" };
const manifestSnapshot = (data) => cutover.snapshotFromRows([{ path: "semester_manifests/2098-2", data }], { operationType: "SEMESTER_MANIFEST", scope: "2098-2" });
assert.equal(manifestSnapshot(manifestBeforeReadiness).hash, manifestSnapshot(manifestAfterReadiness).hash);
assert.equal(manifestSnapshot(manifestBeforeReadiness).hash, manifestSnapshot(manifestAfterReady).hash);
assert.notEqual(manifestSnapshot(manifestBeforeReadiness).hash, manifestSnapshot({ ...manifestAfterReady, revision: 2 }).hash);
assert.notEqual(manifestSnapshot(manifestBeforeReadiness).hash, manifestSnapshot({ ...manifestAfterReady, startAt: "2098-08-02" }).hash);
assert.throws(
  () => cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, createPayload(baseOperations.slice(1))),
  (error) => error.details?.reason === "W11_DATASET_MANIFEST_INCOMPLETE",
);
assert.throws(
  () => cutover.snapshotFromRows(Array.from({ length: cutover.SNAPSHOT_ROW_LIMITS.LEARNING_CONTENT + 1 }, (_, index) => ({ path: `semester_learning_contents/${index}`, data: { semesterId: "2098-2" } })), { operationType: "LEARNING_CONTENT", scope: "2098-2" }),
  (error) => error.details?.reason === "W11_SNAPSHOT_OVERFLOW",
);

const sourceRef = { exists: true, data: { semesterId: "2098-1" }, path: "semester_learning_contents/source" };
assert.throws(() => cutover.assertReceiptTargetScope({
  receipt: { target: { kind: "learning-content", refs: [sourceRef.path] }, result: { semesterId: "2098-1" } },
  operation: { operationKey: "learning", operationType: "LEARNING_CONTENT" },
  targetSemesterId: "2098-2",
  documentsByPath: new Map([[sourceRef.path, sourceRef]]),
}), (error) => error.details?.reason === "W11_CHILD_RECEIPT_SCOPE_MISMATCH");

const activeLearning = { semesterId: "2026-2", expectedSemesterRevision: 1, title: "자료", summary: "", body: "본문", resourceUrl: "", contentType: "LESSON", audienceRoles: ["student"], targetClassIds: [], availableFrom: "", availableUntil: "" };
assert.equal(hashPayload(w8Domains.normalizeW8Payload(w8Domains.W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT, activeLearning)), hashPayload(activeLearning));
const activeWis = { semesterId: "2026-2", expectedSemesterRevision: 1, displayName: "위스", currencyName: "위스", initialGrantAmount: 0 };
assert.equal(hashPayload(wisEconomy.normalizeWisPayload(wisEconomy.WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY, activeWis)), hashPayload(activeWis));
assert.throws(() => w8Domains.normalizeW8Payload(w8Domains.W8_COMMAND_TYPES.CREATE_LEARNING_CONTENT, { ...activeLearning, cutoverPlanId: "plan" }), (error) => error.details?.reason === "W8_PAYLOAD_INVALID");

class MemoryTransaction {
  constructor(documents) { this.documents = documents; }
  async get(path) { return { exists: this.documents.has(path), data: this.documents.get(path) || null, path }; }
  async getAll(paths) { return Promise.all(paths.map((path) => this.get(path))); }
  async query(collection, filter = null) {
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(`${collection}/`) && path.split("/").length === 2)
      .map(([path, data]) => ({ exists: true, data, path }))
      .filter((row) => !filter?.field || row.data?.[filter.field] === filter.value)
      .slice(0, filter?.limit || Number.MAX_SAFE_INTEGER);
  }
  create(path, data) {
    if (this.documents.has(path)) throw new Error(`Document already exists: ${path}`);
    this.documents.set(path, clone(data));
  }
  set(path, data, options = {}) {
    const current = this.documents.get(path) || {};
    this.documents.set(path, clone(options.merge ? { ...current, ...data } : data));
  }
}
const planId = `cutplan_${"c".repeat(64)}`;
const attemptId = cutoverAuthorization.attemptIdFor(planId);
const operationKey = "learning-clone-1";
const commandId = uuid(90);
const payloadHash = "d".repeat(64);
const documents = new Map([
  [`semester_cutover_targets/2098-2`, { targetSemesterId: "2098-2", latestPlanId: planId, latestAttemptId: attemptId }],
  [`semester_cutover_plans/${planId}`, { targetSemesterId: "2098-2", latestAttemptId: attemptId, status: "DRY_RUN_PASSED" }],
  [`semester_cutover_attempts/${attemptId}`, { planId, status: "DRY_RUN_PASSED" }],
  [`semester_cutover_attempts/${attemptId}/items/${cutoverAuthorization.itemIdFor(attemptId, operationKey)}`, { operationKey, operationType: "LEARNING_CONTENT", status: "PENDING", childCommandType: "createLearningContent", childCommandId: commandId, childPayloadHash: payloadHash }],
]);
const authorized = awaitable(cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({ transaction: new MemoryTransaction(documents), semesterId: "2098-2", actor: { actorRole: "admin", actorEmail: "westoria28@gmail.com" }, commandType: "createLearningContent", commandId, payloadHash, cutoverPlanId: planId, cutoverOperationKey: operationKey, operationType: "LEARNING_CONTENT" }));
const boundAttemptId = cutoverAuthorization.attemptIdFor(precomputablePlanId);
const boundDocuments = new Map([
  [`semester_cutover_targets/2098-2`, { targetSemesterId: "2098-2", latestPlanId: precomputablePlanId, latestAttemptId: boundAttemptId }],
  [`semester_cutover_plans/${precomputablePlanId}`, { targetSemesterId: "2098-2", latestAttemptId: boundAttemptId, status: "DRY_RUN_PASSED", manifestHash: boundPlan.manifestHash }],
  [`semester_cutover_attempts/${boundAttemptId}`, { planId: precomputablePlanId, status: "DRY_RUN_PASSED" }],
  [`semester_cutover_attempts/${boundAttemptId}/items/${cutoverAuthorization.itemIdFor(boundAttemptId, learningBound.operationKey)}`, { operationKey: learningBound.operationKey, operationType: "LEARNING_CONTENT", status: "PENDING", childCommandType: learningBound.childCommandType, childCommandId: learningBound.childCommandId, childPayloadHash: childHashWithPlan }],
]);
const exactBound = awaitable(cutoverAuthorization.assertPreparingCutoverCreateIfTargeted({ transaction: new MemoryTransaction(boundDocuments), semesterId: "2098-2", actor: { actorRole: "admin", actorEmail: "westoria28@gmail.com" }, commandType: learningBound.childCommandType, commandId: learningBound.childCommandId, payloadHash: childHashWithPlan, cutoverPlanId: precomputablePlanId, cutoverOperationKey: learningBound.operationKey, operationType: "LEARNING_CONTENT" }));

function awaitable(promise) { return promise; }
function activeLearningPlaceholder() { return { title: "합성 자료", summary: "", body: "본문", resourceUrl: "", contentType: "LESSON", audienceRoles: ["student"], targetClassIds: [], availableFrom: "", availableUntil: "" }; }

(async () => {
  assert.equal((await authorized).required, true);
  assert.equal((await exactBound).required, true);
  const readinessAdapter = cutover.createSemesterCutoverReadinessAdapter();
  let fixtureReadCount = 0;
  const fixtureChecks = await readinessAdapter.evaluate({
    transaction: {
      get: async () => {
        fixtureReadCount += 1;
        throw new Error("NOT_APPLICABLE fixture must not read cutover state");
      },
    },
    manifest: {
      semesterId: "2097-2",
      status: "PREPARING",
      cutoverApplicability: "NOT_APPLICABLE",
    },
  });
  assert.deepEqual(fixtureChecks, [
    {
      checkId: cutover.READINESS_CHECK_ID,
      label: "Semester cutover readiness",
      category: "CUTOVER",
      required: true,
      status: "PASS",
      evidence:
        "applicability=NOT_APPLICABLE; source=EXPLICIT_STORED_FIXTURE",
      failureReason: null,
      ownerWave: "W11",
    },
  ]);
  assert.equal(fixtureReadCount, 0);
  const applicableChecks = await readinessAdapter.evaluate({
    transaction: {
      get: async () => {
        fixtureReadCount += 1;
        return { exists: false, data: null };
      },
    },
    manifest: { semesterId: "2097-2", status: "PREPARING" },
  });
  assert.equal(applicableChecks[0].status, "FAIL");
  assert.equal(applicableChecks[0].failureReason, "SEMESTER_CUTOVER_NOT_VERIFIED");
  assert.equal(fixtureReadCount, 1);
  for (const commandType of [
    "createSemesterManifest",
    "updateSemesterManifest",
  ]) {
    const payload =
      commandType === "createSemesterManifest"
        ? {
            schoolYear: "2097",
            term: "2",
            displayName: "fixture",
            startDate: "2097-08-01",
            endDate: "2097-12-31",
            cutoverApplicability: "NOT_APPLICABLE",
          }
        : {
            semesterId: "2097-2",
            expectedRevision: 1,
            displayName: "fixture",
            startDate: "2097-08-01",
            endDate: "2097-12-31",
            reason: "fixture",
            cutoverApplicability: "NOT_APPLICABLE",
          };
    assert.throws(
      () => semesterCore.normalizeSemesterCommandPayload(commandType, payload),
      (error) => error.details?.reason === "COMMAND_PAYLOAD_INVALID",
    );
  }
  let productionSessionReads = 0;
  const productionCore = commandGateway.createCommandGatewayCore({ projectId: "history-quiz-yongsin", store: { runTransaction: async () => { throw new Error("business read forbidden"); } }, assertSession: async () => { productionSessionReads += 1; return {}; } });
  await assert.rejects(() => productionCore.execute({ data: { commandType: "createSemesterCutoverPlan" } }), (error) => error.details?.reason === "W11_PROJECT_FORBIDDEN");
  assert.equal(productionSessionReads, 0);
  assert.deepEqual(cutover.getSemesterCutoverCommandSessionOptions(), { recentAuth: true, highRisk: true });
  assert.doesNotThrow(() => cutover.assertProjectSemesterPair("demo-westory-session-w11", "2026-1", "2026-2"));
  assert.throws(
    () => cutover.assertProjectSemesterPair("westory-staging-177587430482", "2026-1", "2026-2"),
    (error) => error.details?.reason === "W11_STAGING_SCOPE_FORBIDDEN",
  );
  assert.doesNotThrow(() => cutover.assertProjectSemesterPair("westory-staging-177587430482", "2098-1", "2098-2"));

  const runtimeSource = { semesterId: "2098-1", revision: 1, status: "ARCHIVED", provenance: "ARCHIVE" };
  const runtimeTarget = { semesterId: "2098-2", revision: 1, status: "PREPARING", provenance: "PREPARING" };
  const runtimeOperations = clone(baseOperations);
  const runtimeManifestOperation = runtimeOperations.find((operation) => operation.operationType === "SEMESTER_MANIFEST");
  const runtimeSourceSnapshot = cutover.snapshotFromRows(
    [{ path: "semester_manifests/2098-1", data: runtimeSource }],
    { operationType: "SEMESTER_MANIFEST", scope: "2098-1" },
  );
  const runtimeTargetSnapshot = cutover.snapshotFromRows(
    [{ path: "semester_manifests/2098-2", data: runtimeTarget }],
    { operationType: "SEMESTER_MANIFEST", scope: "2098-2" },
  );
  runtimeManifestOperation.sourceSnapshot = { count: runtimeSourceSnapshot.count, hash: runtimeSourceSnapshot.hash };
  runtimeManifestOperation.targetBeforeSnapshot = { count: runtimeTargetSnapshot.count, hash: runtimeTargetSnapshot.hash };
  const runtimePayload = cutover.normalizeCutoverPayload(
    cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN,
    createPayload(runtimeOperations),
  );
  const blockedActivityPath = "semester_learning_progress/w11-blocked-dry-run";
  const runtimeDocuments = new Map([
    ["semester_manifests/2098-1", runtimeSource],
    ["semester_manifests/2098-2", runtimeTarget],
    [blockedActivityPath, { semesterId: "2098-2", progressId: "w11-blocked-dry-run" }],
  ]);
  const runtimeTransaction = new MemoryTransaction(runtimeDocuments);
  const runtimeActor = { actorUid: "admin-1", actorRole: "admin", actorEmail: "westoria28@gmail.com" };
  const runtimeAdapter = cutover.createSemesterCutoverCommandAdapter({ projectId: "demo-westory-session-w11" });
  const runtimePlan = await runtimeAdapter.apply({ transaction: runtimeTransaction, commandId: uuid(91), commandType: cutover.CUTOVER_COMMAND_TYPES.CREATE_PLAN, payload: runtimePayload, payloadHash: runtimePayload.manifestHash, timestamp: "2026-08-14T00:00:00.000Z", actor: runtimeActor });
  const runtimePlanId = runtimePlan.result.planId;
  const firstDry = await runtimeAdapter.apply({ transaction: runtimeTransaction, commandId: uuid(92), commandType: cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, payload: cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, { planId: runtimePlanId, expectedPlanRevision: 1 }), payloadHash: "e".repeat(64), timestamp: "2026-08-14T00:01:00.000Z", actor: runtimeActor });
  assert.equal(firstDry.result.status, "BLOCKED");
  assert.equal(firstDry.result.attemptRevision, 1);
  assert.equal(firstDry.result.deterministicAttemptReused, false);
  await assert.rejects(
    () => runtimeAdapter.apply({ transaction: runtimeTransaction, commandId: uuid(93), commandType: cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, payload: cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, { planId: runtimePlanId, expectedPlanRevision: 2 }), payloadHash: "f".repeat(64), timestamp: "2026-08-14T00:02:00.000Z", actor: runtimeActor }),
    (error) => error.details?.reason === "W11_ATTEMPT_REVISION_REQUIRED",
  );
  runtimeDocuments.delete(blockedActivityPath);
  const retryDry = await runtimeAdapter.apply({ transaction: runtimeTransaction, commandId: uuid(94), commandType: cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, payload: cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.DRY_RUN, { planId: runtimePlanId, expectedPlanRevision: 2, expectedAttemptRevision: 1 }), payloadHash: "1".repeat(64), timestamp: "2026-08-14T00:03:00.000Z", actor: runtimeActor });
  assert.equal(retryDry.result.status, "DRY_RUN_PASSED");
  assert.equal(retryDry.result.attemptId, firstDry.result.attemptId);
  assert.equal(retryDry.result.attemptRevision, 2);
  assert.equal(retryDry.result.deterministicAttemptReused, true);
  runtimeDocuments.set("semester_cutover_targets/2098-2", { ...runtimeDocuments.get("semester_cutover_targets/2098-2"), latestPlanId: `cutplan_${"9".repeat(64)}` });
  await assert.rejects(
    () => runtimeAdapter.apply({ transaction: runtimeTransaction, commandId: uuid(95), commandType: cutover.CUTOVER_COMMAND_TYPES.APPLY_BATCH, payload: cutover.normalizeCutoverPayload(cutover.CUTOVER_COMMAND_TYPES.APPLY_BATCH, { planId: runtimePlanId, attemptId: retryDry.result.attemptId, expectedPlanRevision: 3, expectedAttemptRevision: 2, operationKeys: [runtimeOperations[0].operationKey], failures: [] }), payloadHash: "2".repeat(64), timestamp: "2026-08-14T00:04:00.000Z", actor: runtimeActor }),
    (error) => error.details?.reason === "W11_CUTOVER_TARGET_PLAN_MISMATCH",
  );
  const source = readFileSync(resolve(__dirname, "../semesterCutover.js"), "utf8");
  assert.equal(source.includes("canonicalBusinessWriteCount: 0"), true);
  assert.equal(source.includes("activationMutationCount: 0"), true);
  assert.equal(source.includes("sourceStatus: sourceMatch ? \"PASS\" : \"FAIL\""), true);
  assert.equal(source.includes("source: inspected[operation.operationKey].source"), true);
  assert.equal(source.includes("target: inspected[operation.operationKey].target"), true);
  assert.equal(source.includes('suggestedPlanPolicy: "APPROVED_AUTHENTICATED_RUNNER_ONLY"'), true);
  assert.equal(source.includes("semester_cutover_plans/missing-plan"), true);
  assert.equal(source.includes("semester_cutover_attempts/missing-attempt"), true);
  assert.equal(source.includes("/__missing__"), false);
  const semesterCoreSource = readFileSync(resolve(__dirname, "../semesterCore.js"), "utf8");
  assert.equal(semesterCoreSource.includes('getAll: (paths) => typeof transaction.getAll === "function"'), true);
  const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
  for (const collection of ["semester_cutover_plans", "semester_cutover_attempts", "semester_cutover_evidence", "semester_cutover_targets"]) assert.equal(rules.includes(`match /${collection}/`), true);
  console.log(JSON.stringify({ passed: true, cases: 35, commands: 6, datasets: 12, maxOperations: 100, applyBatchLimit: 25, blockedDryRunRetry: true, latestPlanFence: true, stagingScopeFence: true, snapshotByteLimit: cutover.SNAPSHOT_TOTAL_BYTE_LIMIT, snapshotTransactionByteLimit: cutover.SNAPSHOT_TRANSACTION_BYTE_LIMIT, readinessChecks: 1, productionAccess: 0, productionWrites: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
