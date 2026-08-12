const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const teacherOperations = require("../teacherOperations");
const commandGateway = require("../commandGateway");

const hashPayload = (value) => commandGateway.sha256(commandGateway.canonicalize(value));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class MemoryTransaction {
  constructor() { this.documents = new Map(); this.written = false; this.readAfterWrite = 0; this.queryReadCount = 0; }
  seed(path, data) { this.documents.set(path, clone(data)); }
  assertRead() { if (this.written) { this.readAfterWrite += 1; throw new Error(`read-after-write:${this.readAfterWrite}`); } }
  async get(path) { this.assertRead(); return { exists: this.documents.has(path), data: clone(this.documents.get(path) || null), path }; }
  async getAll(paths) { this.assertRead(); return paths.map((path) => ({ exists: this.documents.has(path), data: clone(this.documents.get(path) || null), path })); }
  async query(collection, filter = null) { this.assertRead(); const prefix = `${collection}/`; const filters = filter?.filters || (filter?.field ? [filter] : []); let rows = [...this.documents.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/")).map(([path, data]) => ({ exists: true, path, data: clone(data) })).filter((row) => filters.every((clause) => clause.operator === "==" ? row.data?.[clause.field] === clause.value : clause.operator === "in" ? clause.value.includes(row.data?.[clause.field]) : false)); const ordering = Array.isArray(filter?.orderBy) ? filter.orderBy : filter?.orderBy ? [filter.orderBy] : []; for (const order of [...ordering].reverse()) rows.sort((left, right) => { const direction = order.direction === "desc" ? -1 : 1; return String(left.data?.[order.field] || "").localeCompare(String(right.data?.[order.field] || "")) * direction || left.path.localeCompare(right.path); }); if (Number.isSafeInteger(filter?.limit)) rows = rows.slice(0, filter.limit); this.queryReadCount += rows.length; return rows; }
  set(path, data, options) { this.written = true; const next = options?.merge ? { ...(this.documents.get(path) || {}), ...clone(data) } : clone(data); this.documents.set(path, next); }
  create(path, data) { this.written = true; if (this.documents.has(path)) throw new Error(`already-exists:${path}`); this.documents.set(path, clone(data)); }
  delete(path) { this.written = true; this.documents.delete(path); }
  resetWrites() { this.written = false; }
}

const semesterId = "2026-2";
const manifest = { semesterId, revision: 7, status: "ACTIVE" };
const teacher = { actorUid: "teacher-1", actorEmail: "teacher@yongshin-ms.ms.kr", actorRole: "teacher", actorCapability: "domain_manage" };
const admin = { actorUid: "admin-1", actorEmail: "westoria28@gmail.com", actorRole: "admin", actorCapability: "command:cleanupExpiredTeacherDrafts" };
const common = { semesterId, expectedSemesterRevision: 7 };
const draftHash = "a".repeat(64);
const baseHash = "b".repeat(64);
const now = "2026-08-12T00:00:00.000Z";
const adapter = teacherOperations.createTeacherOperationsCommandAdapter({ now: () => now });

const normalize = (type, payload) => teacherOperations.normalizeTeacherOperationsPayload(type, payload);
const apply = async (tx, type, payload, actor = teacher) => {
  tx.resetWrites();
  return adapter.apply({ transaction: tx, commandId: cryptoId(type), commandType: type, payload: normalize(type, payload), receiptId: `receipt-${type}`, timestamp: now, actor });
};
const cryptoId = (value) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const draftKey = (clientDraftId, entityId = "new") => ({ routeKey: "/teacher/learning", surfaceKey: "content-editor", entityType: "learning-content", entityId, clientDraftId });
const savePayload = (clientDraftId, expectedDraftRevision = null, baseEntityRevision = null, payload = { title: "임시 학습 자료" }) => ({ ...common, key: draftKey(clientDraftId), expectedDraftRevision, baseEntityRevision, basePayloadHash: baseHash, payloadSchemaVersion: 1, intendedCommandType: "createLearningContent", expectedCommandPayloadHash: draftHash, payload, stagedAssets: [] });
const learningCommand = (title) => ({ semesterId, expectedSemesterRevision: 7, contentType: "LESSON", title, summary: "요약", body: "본문", resourceUrl: "", audienceRoles: ["student"], targetClassIds: [], availableFrom: "", availableUntil: "" });
const bulkItem = (itemKey, title) => { const commandPayload = learningCommand(title); return { itemKey, commandType: "createLearningContent", commandPayload, commandPayloadHash: hashPayload(commandPayload) }; };

(async () => {
  const tx = new MemoryTransaction(); tx.seed(`semester_manifests/${semesterId}`, manifest);

  const saved = await apply(tx, "saveTeacherDraft", savePayload("draft-a"));
  assert.equal(saved.result.status, "ACTIVE"); assert.equal(saved.result.draftRevision, 1); assert.equal(saved.result.saved, true);
  assert.equal(saved.result.expiresAt, "2026-09-11T00:00:00.000Z");
  assert.throws(() => normalize("saveTeacherDraft", { ...savePayload("invalid-route-space"), key: { ...draftKey("invalid-route-space"), routeKey: " /teacher/learning" } }), (error) => error.details?.reason === "W9_PAYLOAD_INVALID");
  assert.throws(() => normalize("saveTeacherDraft", { ...savePayload("invalid-route-long"), key: { ...draftKey("invalid-route-long"), routeKey: `/${"x".repeat(120)}` } }), (error) => error.details?.reason === "W9_PAYLOAD_INVALID");
  for (const field of ["surfaceKey", "entityType", "clientDraftId"]) {
    assert.throws(() => normalize("saveTeacherDraft", { ...savePayload(`invalid-${field}`), key: { ...draftKey(`invalid-${field}`), [field]: "invalid/value" } }), (error) => error.details?.reason === "W9_PAYLOAD_INVALID");
  }
  const draftId = saved.result.draftId;
  await assert.rejects(() => apply(tx, "saveTeacherDraft", savePayload("draft-a", 9)), (error) => error.details?.reason === "W9_DRAFT_REVISION_CONFLICT");
  const conflict = await apply(tx, "saveTeacherDraft", savePayload("draft-a", 1, 4, { title: "충돌 입력" }));
  assert.equal(conflict.result.status, "CONFLICT"); assert.equal(conflict.result.saved, false);

  const discardSeed = await apply(tx, "saveTeacherDraft", savePayload("draft-discard"));
  const discarded = await apply(tx, "discardTeacherDraft", { ...common, draftId: discardSeed.result.draftId, expectedDraftRevision: 1, reason: "사용자가 폐기함" });
  assert.equal(discarded.result.status, "DISCARDED");
  assert.deepEqual(tx.documents.get(`teacher_drafts/${discardSeed.result.draftId}`).payload, {}); assert.deepEqual(tx.documents.get(`teacher_drafts/${discardSeed.result.draftId}`).stagedAssets, []);

  const resolveSeed = await apply(tx, "saveTeacherDraft", savePayload("draft-resolve"));
  const canonicalCommandId = "123e4567-e89b-42d3-a456-426614174000";
  const canonicalReceiptId = teacherOperations.receiptIdFor(teacher.actorUid, "createLearningContent", canonicalCommandId);
  tx.seed(`command_receipts/${canonicalReceiptId}`, { status: "SUCCEEDED", actorUid: teacher.actorUid, commandType: "createLearningContent", commandId: canonicalCommandId, payloadHash: draftHash, sourceHash: "source" });
  const resolved = await apply(tx, "resolveTeacherDraft", { ...common, draftId: resolveSeed.result.draftId, expectedDraftRevision: 1, canonicalCommandType: "createLearningContent", canonicalCommandId, expectedCommandPayloadHash: draftHash });
  assert.equal(resolved.result.status, "SAVED"); assert.equal(resolved.result.canonicalReceiptId, canonicalReceiptId);
  assert.deepEqual(tx.documents.get(`teacher_drafts/${resolveSeed.result.draftId}`).payload, {}); assert.deepEqual(tx.documents.get(`teacher_drafts/${resolveSeed.result.draftId}`).stagedAssets, []);
  const parallelA = await apply(tx, "saveTeacherDraft", { ...savePayload("parallel-a"), key: draftKey("parallel-a", "entity-parallel") });
  const parallelB = await apply(tx, "saveTeacherDraft", { ...savePayload("parallel-b"), key: draftKey("parallel-b", "entity-parallel") });
  const parallelCommandId = "123e4567-e89b-42d3-a456-426614174002";
  const parallelReceiptId = teacherOperations.receiptIdFor(teacher.actorUid, "createLearningContent", parallelCommandId);
  tx.seed(`command_receipts/${parallelReceiptId}`, { status: "SUCCEEDED", actorUid: teacher.actorUid, commandType: "createLearningContent", commandId: parallelCommandId, payloadHash: draftHash, sourceHash: "parallel-source" });
  const parallelResolved = await apply(tx, "resolveTeacherDraft", { ...common, draftId: parallelA.result.draftId, expectedDraftRevision: 1, canonicalCommandType: "createLearningContent", canonicalCommandId: parallelCommandId, expectedCommandPayloadHash: draftHash });
  assert.equal(parallelResolved.result.conflictedDraftCount, 1); assert.deepEqual(parallelResolved.result.conflictedDraftIds, [parallelB.result.draftId]);
  const parallelConflict = tx.documents.get(`teacher_drafts/${parallelB.result.draftId}`);
  assert.equal(parallelConflict.status, "CONFLICT"); assert.equal(parallelConflict.draftRevision, 2); assert.equal(parallelConflict.conflictReason, "BASE_ENTITY_REVISION_CHANGED");
  await assert.rejects(() => apply(tx, "saveTeacherDraft", { ...savePayload("parallel-b", 2), key: draftKey("parallel-b", "entity-parallel") }), (error) => error.details?.reason === "W9_DRAFT_REBASE_REQUIRED");
  assert.equal(tx.documents.get(`teacher_drafts/${parallelB.result.draftId}`).status, "CONFLICT"); assert.equal(tx.documents.get(`teacher_drafts/${parallelB.result.draftId}`).draftRevision, 2);
  const unresolved = await apply(tx, "saveTeacherDraft", savePayload("draft-no-receipt"));
  await assert.rejects(() => apply(tx, "resolveTeacherDraft", { ...common, draftId: unresolved.result.draftId, expectedDraftRevision: 1, canonicalCommandType: "createLearningContent", canonicalCommandId: "123e4567-e89b-42d3-a456-426614174001", expectedCommandPayloadHash: draftHash }), (error) => error.details?.reason === "W9_CANONICAL_RECEIPT_REQUIRED");
  assert.equal(tx.documents.get(`teacher_drafts/${unresolved.result.draftId}`).status, "ACTIVE");

  const expiring = await apply(tx, "saveTeacherDraft", savePayload("draft-expired"));
  tx.documents.get(`teacher_drafts/${expiring.result.draftId}`).expiresAt = "2026-07-01T00:00:00.000Z";
  tx.documents.set(`semester_manifests/${semesterId}`, { ...manifest, status: "ARCHIVED" });
  const cleanup = await apply(tx, "cleanupExpiredTeacherDrafts", { ...common, limit: 100 }, admin);
  assert.ok(cleanup.result.expiredCount >= 1); assert.equal(cleanup.result.canonicalMutationCount, 0);
  assert.equal(tx.documents.get(`teacher_drafts/${expiring.result.draftId}`).status, "EXPIRED");
  assert.deepEqual(tx.documents.get(`teacher_drafts/${expiring.result.draftId}`).payload, {}); assert.deepEqual(tx.documents.get(`teacher_drafts/${expiring.result.draftId}`).stagedAssets, []);
  tx.documents.set(`semester_manifests/${semesterId}`, manifest);

  const created = await apply(tx, "createTeacherBulkJob", { ...common, clientBulkId: "bulk-1", domain: "LEARNING", operationType: "CREATE_CONTENTS", policy: "ITEMIZED_PARTIAL", filter: { classIds: ["class-1"] }, items: [bulkItem("a", "자료 A"), bulkItem("b", "자료 B")] });
  assert.equal(created.result.status, "READY"); assert.equal(created.result.itemCount, 2); assert.notEqual(created.result.items[0].childCommandId, created.result.items[1].childCommandId);
  const jobId = created.result.jobId; const first = created.result.items[0]; const second = created.result.items[1]; const firstReceiptId = teacherOperations.receiptIdFor(teacher.actorUid, first.commandType, first.childCommandId);
  tx.seed(`command_receipts/${firstReceiptId}`, { status: "SUCCEEDED", actorUid: teacher.actorUid, commandType: first.commandType, commandId: first.childCommandId, payloadHash: first.commandPayloadHash, result: { contentId: "content-a" } });
  const reconciled = await apply(tx, "reconcileTeacherBulkJob", { ...common, jobId, expectedJobRevision: 1, reportedFailures: [{ itemKey: second.itemKey, childCommandId: second.childCommandId, errorCode: "aborted", errorReason: "revision conflict" }] });
  assert.equal(reconciled.result.status, "PARTIAL"); assert.deepEqual(reconciled.result.counts, { total: 2, succeeded: 1, failed: 1, pending: 0 });
  const retry = await apply(tx, "retryTeacherBulkJob", { ...common, jobId, expectedJobRevision: 2, items: [bulkItem("b", "자료 B 재시도")] });
  assert.equal(retry.result.retriedCount, 1); assert.equal(retry.result.items[0].attempt, 2); assert.notEqual(retry.result.items[0].childCommandId, second.childCommandId);
  assert.equal(tx.documents.get(`teacher_bulk_jobs/${jobId}`).items.find((item) => item.itemKey === "a").status, "SUCCEEDED");
  const retryItem = retry.result.items[0]; const retryReceiptId = teacherOperations.receiptIdFor(teacher.actorUid, retryItem.commandType, retryItem.childCommandId);
  tx.seed(`command_receipts/${retryReceiptId}`, { status: "SUCCEEDED", actorUid: teacher.actorUid, commandType: retryItem.commandType, commandId: retryItem.childCommandId, payloadHash: retryItem.commandPayloadHash, result: { contentId: "content-b" } });
  const completed = await apply(tx, "reconcileTeacherBulkJob", { ...common, jobId, expectedJobRevision: 3, reportedFailures: [] });
  assert.equal(completed.result.status, "SUCCEEDED"); assert.equal(completed.result.counts.succeeded, 2);
  assert.throws(() => normalize("createTeacherBulkJob", { ...common, clientBulkId: "atomic-invalid", domain: "LEARNING", operationType: "CREATE_CONTENTS", policy: "ALL_OR_NOTHING", filter: {}, items: [bulkItem("1", "1"), bulkItem("2", "2")] }), (error) => error.details?.reason === "W9_BULK_ATOMIC_POLICY_INVALID");
  const oversized = Array.from({ length: 20 }, (_, index) => { const commandPayload = { ...learningCommand(`큰 자료 ${index}`), body: "x".repeat(18_000) }; return { itemKey: `large-${index}`, commandType: "createLearningContent", commandPayload, commandPayloadHash: hashPayload(commandPayload) }; });
  assert.throws(() => normalize("createTeacherBulkJob", { ...common, clientBulkId: "too-large", domain: "LEARNING", operationType: "CREATE_CONTENTS", policy: "ITEMIZED_PARTIAL", filter: {}, items: oversized }), (error) => error.details?.reason === "W9_BULK_PAYLOAD_TOO_LARGE");

  const lowRisk = ["saveTeacherDraft", "discardTeacherDraft", "resolveTeacherDraft"];
  lowRisk.forEach((type) => { assert.equal(teacherOperations.HIGH_RISK_COMMAND_TYPES.has(type), false); assert.deepEqual(teacherOperations.getTeacherOperationsCommandSessionOptions(type), { recentAuth: false, highRisk: false }); });
  ["cleanupExpiredTeacherDrafts", "createTeacherBulkJob", "reconcileTeacherBulkJob", "retryTeacherBulkJob"].forEach((type) => { assert.equal(teacherOperations.HIGH_RISK_COMMAND_TYPES.has(type), true); assert.deepEqual(teacherOperations.getTeacherOperationsCommandSessionOptions(type), { recentAuth: true, highRisk: true }); });

  const queryStore = { get: async (path) => path === `users/${teacher.actorUid}` ? { exists: true, data: { role: "teacher", teacherPortalEnabled: true, staffPermissions: ["lesson_read"] }, path } : tx.get(path), runTransaction: async (callback) => { tx.resetWrites(); return callback(tx); } };
  const queryCore = teacherOperations.createTeacherOperationsQueryCore({ store: queryStore, assertSession: async () => ({ uid: teacher.actorUid, email: teacher.actorEmail }), now: () => now });
  const state = await queryCore.getTeacherOperationsState({ auth: { uid: teacher.actorUid, token: { email: teacher.actorEmail } }, data: { semesterId, source: "CURRENT", includeTerminal: true } });
  assert.equal(state.writeCount, 0); assert.ok(state.drafts.every((draft) => draft.ownerUid === teacher.actorUid)); assert.equal(tx.written, false);
  const explicit = await queryCore.getTeacherOperationsState({ auth: { uid: teacher.actorUid, token: { email: teacher.actorEmail } }, data: { semesterId, source: "EXPLICIT", includeTerminal: true } });
  assert.equal(explicit.provenance, "EXPLICIT"); assert.equal(explicit.readOnly, true);
  tx.seed("teacher_drafts/other-owner", { schemaVersion: 1, policyVersion: "w9-v1", draftId: "other-owner", ownerUid: "teacher-2", semesterId, status: "ACTIVE", draftRevision: 1 });
  const otherOwner = await queryCore.getTeacherOperationsState({ auth: { uid: teacher.actorUid, token: { email: teacher.actorEmail } }, data: { semesterId, source: "CURRENT", draftId: "other-owner", includeTerminal: true } });
  assert.equal(otherOwner.drafts.length, 0);
  for (let index = 0; index < 12; index += 1) tx.seed(`teacher_drafts/terminal-${index}`, { schemaVersion: 1, policyVersion: "w9-v1", draftId: `terminal-${index}`, ownerUid: teacher.actorUid, semesterId, status: "SAVED", draftRevision: 1, payload: {}, stagedAssets: [], updatedAtIso: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` });
  for (let index = 0; index < 150; index += 1) tx.seed(`teacher_drafts/terminal-large-${index}`, { schemaVersion: 1, policyVersion: "w9-v1", draftId: `terminal-large-${index}`, ownerUid: teacher.actorUid, semesterId, status: "SAVED", draftRevision: 1, payload: {}, stagedAssets: [], updatedAtIso: new Date(Date.parse("2030-01-01T00:00:00.000Z") + index * 86_400_000).toISOString() });
  const queryReadsBefore = tx.queryReadCount;
  const bounded = await queryCore.getTeacherOperationsState({ auth: { uid: teacher.actorUid, token: { email: teacher.actorEmail } }, data: { semesterId, source: "CURRENT", includeTerminal: true, limit: 10 } });
  assert.equal(bounded.drafts.length, 10); assert.equal(bounded.warnings[0]?.code, "TERMINAL_RESULTS_TRUNCATED");
  const boundedQueryReads = tx.queryReadCount - queryReadsBefore;
  assert.equal(bounded.drafts[0].draftId, "terminal-large-149"); assert.ok(boundedQueryReads <= 44);

  tx.seed("teacher_bulk_jobs/orphan", { schemaVersion: 1, policyVersion: "w9-v1", jobId: "orphan", semesterId, ownerUid: teacher.actorUid, status: "RUNNING", riskLevel: "HIGH", updatedAtIso: "2026-08-01T00:00:00.000Z", jobRevision: 1 });
  tx.resetWrites(); const readiness = await teacherOperations.createTeacherOperationsReadinessAdapter({ now: () => now }).evaluate({ transaction: tx, manifest });
  assert.equal(readiness.length, 1); assert.equal(readiness[0].checkId, teacherOperations.READINESS_CHECK_ID); assert.equal(readiness[0].status, "FAIL");

  assert.equal(tx.readAfterWrite, 0);
  console.log(JSON.stringify({ passed: true, cases: 34, commandTypes: Object.keys(teacherOperations.TEACHER_OPERATIONS_COMMAND_TYPES).length, readinessChecks: readiness.length, draftTtlDays: teacherOperations.DRAFT_TTL_DAYS, entityActiveDraftLimit: teacherOperations.ENTITY_ACTIVE_DRAFT_LIMIT, bulkItemLimit: teacherOperations.BULK_ITEM_LIMIT, bulkByteLimit: teacherOperations.BULK_JOB_CANONICAL_BYTE_LIMIT, boundedQueryReads, readAfterWrite: tx.readAfterWrite, productionAccess: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
