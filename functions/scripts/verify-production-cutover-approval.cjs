const assert = require("node:assert/strict");
const approval = require("../productionCutoverApproval");
const cutover = require("../semesterCutover");
const child = require("../cutoverAuthorization");

module.exports = async () => {
  const projectId = approval.PRODUCTION_PROJECT_ID;
  const actor = { actorUid: "approved-admin", actorEmail: "westoria28@gmail.com", actorRole: "admin" };
  const instant = "2026-09-12T12:00:00.000Z", now = () => new Date(instant);
  const empty = { count: 0, hash: cutover.EMPTY_SNAPSHOT_HASH };
  const raw = {
    manifestVersion: "production-2026-2-approved-v1", sourceSemesterId: "2026-1", targetSemesterId: "2026-2",
    sourceManifestRevision: 2, targetManifestRevision: 1, copyDenylist: cutover.COPY_DENYLIST,
    operations: Object.entries(cutover.OPERATION_DEFINITIONS).map(([operationType, definition], index) => ({
      operationKey: `operation-${index}`, operationOrder: index + 1, operationType, strategy: definition.strategy,
      applicable: false, childCommandType: null, childCommandId: null, childPayloadHash: null,
      sourceSnapshot: empty, targetBeforeSnapshot: empty, targetAfterSnapshot: empty,
    })),
  };
  raw.manifestHash = cutover.computeManifestHash(raw);
  const planId = cutover.planIdFor(raw.manifestVersion, raw.sourceSemesterId, raw.targetSemesterId);
  const plan = { ...raw, planId };
  const accepted = {
    schemaVersion: 1, policyVersion: approval.POLICY_VERSION, status: "APPROVED", projectId, planId,
    manifestHash: raw.manifestHash, sourceSemesterId: raw.sourceSemesterId, targetSemesterId: raw.targetSemesterId,
    sourceManifestRevision: 2, targetManifestRevision: 1, actorUid: actor.actorUid, actorEmail: actor.actorEmail, serverMaintenanceRunId: "approved-server-run",
    backupHash: "a".repeat(64), approvedAtIso: "2026-09-12T11:00:00.000Z", expiresAtIso: "2026-09-13T10:00:00.000Z",
  };
  accepted.approvalHash = approval.hashApproval(accepted);
  const path = `${approval.APPROVAL_COLLECTION}/${planId}`, docs = new Map();
  let writes = 0;
  const transaction = {
    get: async key => ({ path: key, exists: docs.has(key), data: docs.get(key) }),
    getAll: async keys => Promise.all(keys.map(key => transaction.get(key))),
    query: async (collection, filter) => [...docs].filter(([key, value]) => key.startsWith(`${collection}/`) && key.split("/").length === collection.split("/").length + 1 && (!filter?.field || value[filter.field] === filter.value))
      .slice(0, filter?.limit || Infinity).map(([key, data]) => ({ path: key, data, exists: true })),
    create: (key, data) => { assert(!docs.has(key)); docs.set(key, data); writes += 1; },
    set: (key, data, options) => { docs.set(key, options?.merge ? { ...docs.get(key), ...data } : data); writes += 1; },
  };
  const validate = (overrides = {}) => approval.assertProductionCutoverApproval({ transaction, plan, actor, projectId, now, creating: true, ...overrides });
  const reason = expected => error => error.details?.reason === expected;
  assert.throws(() => cutover.assertCutoverProject("unapproved-project"), reason("W11_PROJECT_FORBIDDEN"));
  await assert.rejects(validate(), reason("PRODUCTION_CUTOVER_APPROVAL_REQUIRED"));
  docs.set(path, accepted);
  assert.equal((await validate()).approvalHash, accepted.approvalHash);
  for (const changes of [
    { status: "REVOKED" }, { backupHash: "" }, { actorEmail: "other@example.com" }, { expiresAtIso: instant },
    { approvedAtIso: "2026-09-12T13:00:00.000Z" }, { expiresAtIso: "2026-09-14T12:00:00.000Z" }, { unrecognized: true },
  ]) {
    const changed = { ...accepted, ...changes }; changed.approvalHash = approval.hashApproval(changed); docs.set(path, changed);
    await assert.rejects(validate(), reason("PRODUCTION_CUTOVER_APPROVAL_INVALID"));
  }
  docs.set(path, accepted);
  await assert.rejects(validate({ actor: { ...actor, actorUid: "another-admin" } }), reason("PRODUCTION_CUTOVER_APPROVAL_ACTOR_MISMATCH"));
  await assert.rejects(validate({ plan: { ...plan, targetManifestRevision: 2 } }), reason("PRODUCTION_CUTOVER_APPROVAL_SCOPE_MISMATCH"));
  await assert.rejects(validate({ plan: { ...plan, operations: plan.operations.map((row, index) => index ? row : { ...row, sourceSnapshot: { ...empty, count: 1 } }) } }), reason("PRODUCTION_CUTOVER_APPROVAL_PLAN_MISMATCH"));
  const boundPlan = { ...plan, ...approval.bindingFor(accepted), createdBy: actor.actorUid };
  await validate({ plan: boundPlan, creating: false });
  await assert.rejects(validate({ plan, creating: false }), reason("PRODUCTION_CUTOVER_APPROVAL_BINDING_MISMATCH"));
  const renewed = { ...accepted, expiresAtIso: "2026-09-13T09:00:00.000Z" }; renewed.approvalHash = approval.hashApproval(renewed); docs.set(path, renewed);
  await assert.rejects(validate({ plan: boundPlan, creating: false }), reason("PRODUCTION_CUTOVER_APPROVAL_BINDING_MISMATCH"));
  docs.set(path, accepted);
  await assert.rejects(validate({ projectId: "demo-westory-session-test", plan: boundPlan }), reason("PRODUCTION_CUTOVER_PROJECT_MISMATCH"));
  const receiptId = "receipt-approved", executionProvenance = { kind: "SERVER_MAINTENANCE", runId: accepted.serverMaintenanceRunId, approvalHash: accepted.approvalHash };
  const receipt = {
    actorUid: actor.actorUid, actorEmail: actor.actorEmail, actorRole: "admin", actorCapability: "command:createSemesterClass",
    commandId: "child-approved", commandType: "createSemesterClass", payloadHash: "c".repeat(64), sourceHash: null,
    target: { semesterId: "2026-2", refs: [] }, result: { semesterId: "2026-2" }, executionProvenance,
    audit: { eventId: receiptId, ref: `command_audit_events/${receiptId}`, eventType: "COMMAND_SUCCEEDED" },
    session: { authTime: 0, ref: null, authorityMode: "SERVER_MAINTENANCE", authorityGeneration: accepted.serverMaintenanceRunId, protocolVersion: 0,
      revisionHash: require("node:crypto").createHash("sha256").update(accepted.approvalHash).digest("hex"), observedFailure: null },
  };
  const audit = { exists: true, data: { ...receipt, eventId: receiptId, eventType: "COMMAND_SUCCEEDED", receiptRef: `command_receipts/${receiptId}` } };
  const authorityOptions = { receiptId, receipt, audit, operation: { operationKey: "class" }, actor, approvedProductionExecution: accepted };
  cutover.assertReceiptAuditAuthoritySummary(authorityOptions);
  assert.throws(() => cutover.assertReceiptAuditAuthoritySummary({ ...authorityOptions, approvedProductionExecution: null }), reason("W11_CHILD_RECEIPT_AUTHORITY_MISMATCH"));
  for (const changes of [{ authorityGeneration: "unapproved-run" }, { revisionHash: "d".repeat(64) }, { authTime: 1 }, { ref: "application_sessions/fake" }]) {
    assert.throws(() => cutover.assertReceiptAuditAuthoritySummary({ ...authorityOptions, receipt: { ...receipt, session: { ...receipt.session, ...changes } } }), reason("W11_CHILD_RECEIPT_AUTHORITY_MISMATCH"));
  }
  assert.throws(() => cutover.assertReceiptAuditAuthoritySummary({ ...authorityOptions, audit: { ...audit, data: { ...audit.data, executionProvenance: { ...executionProvenance, approvalHash: "e".repeat(64) } } } }), reason("W11_CHILD_RECEIPT_AUTHORITY_MISMATCH"));
  assert.equal(writes, 0);
  const adapter = cutover.createSemesterCutoverCommandAdapter({ projectId, now });
  docs.set("semester_manifests/2026-1", { semesterId: "2026-1", revision: 2, status: "ACTIVE" });
  docs.set("semester_manifests/2026-2", { semesterId: "2026-2", revision: 1, status: "PREPARING" });
  const request = { transaction, actor, commandId: "approved-command", commandType: "createSemesterCutoverPlan", payload: raw, payloadHash: raw.manifestHash, timestamp: instant };
  docs.delete(path);
  await assert.rejects(adapter.apply(request), reason("PRODUCTION_CUTOVER_APPROVAL_REQUIRED"));
  assert.equal(writes, 0);
  docs.set(path, accepted);
  await adapter.apply(request);
  const storedPlan = docs.get(`semester_cutover_plans/${planId}`);
  assert.equal(storedPlan.productionApprovalHash, accepted.approvalHash);
  assert.equal(writes, 2);
  docs.delete(path);
  await assert.rejects(adapter.apply({ ...request, commandType: "dryRunSemesterCutover", payload: { planId, expectedPlanRevision: 1 } }), reason("PRODUCTION_CUTOVER_APPROVAL_REQUIRED"));
  assert.equal(writes, 2);
  docs.set(path, accepted);
  const queryCore = cutover.createSemesterCutoverQueryCore({ projectId, store: { runTransaction: callback => callback(transaction) }, assertSession: async () => ({ email: actor.actorEmail }) });
  const queryResult = await queryCore.getSemesterCutoverState({ auth: { uid: actor.actorUid, token: { email: actor.actorEmail } }, data: { targetSemesterId: "2026-2" } });
  assert.equal(queryResult.plan.productionApprovalHash, accepted.approvalHash);
  assert.equal(queryResult.writeCount, 0);
  const attemptId = child.attemptIdFor(planId), operationKey = "approved-child", childCommandId = "child-command", payloadHash = "b".repeat(64);
  docs.set(`semester_cutover_plans/${planId}`, { ...storedPlan, latestAttemptId: attemptId, status: "DRY_RUN_PASSED" });
  docs.set("semester_cutover_targets/2026-2", { targetSemesterId: "2026-2", latestPlanId: planId, latestAttemptId: attemptId });
  docs.set(`semester_cutover_attempts/${attemptId}`, { planId, status: "DRY_RUN_PASSED" });
  docs.set(`semester_cutover_attempts/${attemptId}/items/${child.itemIdFor(attemptId, operationKey)}`, { operationKey, operationType: "WIS_ECONOMY", status: "PENDING", childCommandType: "createSemesterEconomy", childCommandId, childPayloadHash: payloadHash });
  const childOptions = { transaction, actor, projectId, now, semesterId: "2026-2", cutoverPlanId: planId, cutoverOperationKey: operationKey, operationType: "WIS_ECONOMY", commandType: "createSemesterEconomy", commandId: childCommandId, payloadHash };
  await child.assertPreparingCutoverCreate(childOptions);
  await assert.rejects(child.assertPreparingCutoverCreate({ ...childOptions, now: () => new Date(accepted.expiresAtIso) }), reason("PRODUCTION_CUTOVER_APPROVAL_INVALID"));
  docs.delete(path);
  await assert.rejects(child.assertPreparingCutoverCreate(childOptions), reason("PRODUCTION_CUTOVER_APPROVAL_REQUIRED"));
  // A VERIFIED plan cannot pass activation readiness after approval revocation.
  docs.set(`semester_cutover_plans/${planId}`, { ...storedPlan, latestAttemptId: attemptId, status: "VERIFIED" });
  docs.set("semester_cutover_targets/2026-2", { targetSemesterId: "2026-2", latestPlanId: planId, latestAttemptId: attemptId, latestEvidenceId: "verified", status: "VERIFIED" });
  docs.set(`semester_cutover_attempts/${attemptId}`, { planId, status: "VERIFIED" });
  docs.set("semester_cutover_evidence/verified", { status: "PASS", manifestHash: raw.manifestHash, targetManifestRevision: 1 });
  const readiness = cutover.createSemesterCutoverReadinessAdapter({ projectId, now });
  const [check] = await readiness.evaluate({ transaction, manifest: { semesterId: "2026-2", status: "READY", revision: 1 } });
  assert.equal(check.status, "FAIL");
  assert.equal(check.failureReason, "PRODUCTION_CUTOVER_APPROVAL_REQUIRED");
  const [fixtureCheck] = await readiness.evaluate({ transaction, manifest: { semesterId: "2026-2", status: "READY", revision: 1, cutoverApplicability: "NOT_APPLICABLE" } });
  assert.equal(fixtureCheck.status, "FAIL");
  assert.equal(writes, 2);
  return { approvedProductionPlan: true, deniedWithoutApproval: true, actorAndSnapshotBinding: true, renewalCannotReusePlan: true, expiredChildDenied: true, revokedReadinessDenied: true, fixtureBypassDenied: true, serverMaintenanceReceiptBinding: true, liveProductionWrites: 0 };
};

if (require.main === module) module.exports().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
