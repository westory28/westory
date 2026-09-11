const assert = require("node:assert/strict");
const profile = require("../studentEnrollmentProfile");
const gateway = require("../commandGateway");
const clone = value => structuredClone(value);
const scope = "2026-2", uid = "student-a", p = profile.pathsFor(scope, uid);
const actor = { actorUid: "teacher-a", actorRole: "teacher", actorEmail: "teacher@example.com" };
class Transaction {
  constructor(documents) { this.documents = clone(documents); this.writes = []; }
  async get(path) { assert.equal(this.writes.length, 0, "read after write"); return { exists: Object.hasOwn(this.documents, path), path, data: clone(this.documents[path] || null) }; }
  async getAll(paths) { return Promise.all(paths.map(path => this.get(path))); }
  async query(collection, options = {}) {
    assert.equal(this.writes.length, 0, "query after write");
    return Object.entries(this.documents).filter(([path, data]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/") &&
      (options.filters || []).every(filter => filter.operator === "==" && data[filter.field] === filter.value))
      .slice(0, options.limit || Infinity).map(([path, data]) => ({ exists: true, path, data: clone(data) }));
  }
  set(path, data, options) { this.writes.push(path); this.documents[path] = options?.merge ? { ...this.documents[path], ...clone(data) } : clone(data); }
  create(path, data) { assert(!Object.hasOwn(this.documents, path)); this.set(path, data); }
}
function fixture() {
  const snapshot = { displayName: "학생", grade: "2", classNumber: "1", classDisplayName: "2학년 1반", studentNumber: "7" };
  const metadata = { accountId: p.accountId, studentUid: uid, semesterId: scope, enrollmentId: "enrollment-a", classId: "class-a",
    grade: "2", classNumber: "1", studentNumber: "7", displayName: "학생", balance: 300, earnedTotal: 500, spentTotal: 200,
    rankEarnedTotal: 500, adjustedTotal: 0, revision: 4, ledgerRevision: 4, recentLedgerEntries: [{ id: "money-a" }] };
  return {
    [p.user]: { role: "student", name: "학생", studentName: "학생", grade: "2", class: "1", number: "7", email: "student@example.com", updatedAt: "t0" },
    [p.identity]: { studentUid: uid, displayName: "학생", revision: 1, accountStatus: "ACTIVE" },
    [p.slot]: { semesterId: scope, studentUid: uid, activeEnrollmentId: "enrollment-a", revision: 2, status: "ACTIVE" },
    [p.manifest]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    [p.pointer]: { semesterId: scope, revision: 7 },
    [p.readiness]: { status: "PASSED", immutableReportData: "keep" },
    "semester_classes/class-a": { classId: "class-a", semesterId: scope, grade: "2", classNumber: "1", displayName: "2학년 1반", status: "ACTIVE", revision: 1 },
    "semester_classes/class-b": { classId: "class-b", semesterId: scope, grade: "2", classNumber: "2", displayName: "2학년 2반", status: "ACTIVE", revision: 3 },
    "semester_classes/class-c": { classId: "class-c", semesterId: scope, grade: "3", classNumber: "1", displayName: "3학년 1반", status: "ACTIVE", revision: 1 },
    "semester_enrollments/enrollment-a": { enrollmentId: "enrollment-a", studentUid: uid, semesterId: scope, classId: "class-a", studentNumber: "7", enrollmentStatus: "ACTIVE", revision: 5, snapshot },
    "semester_enrollments/historical": { enrollmentId: "historical", studentUid: uid, semesterId: "2026-1", classId: "old-class", studentNumber: "3", enrollmentStatus: "COMPLETED", snapshot: { displayName: "옛 이름" } },
    [p.account]: metadata, [p.balance]: metadata, [p.ranking]: metadata,
    "semester_wis_ledger/money-a": { accountId: p.accountId, delta: 300, displayName: "옛 이름" },
    "semester_wis_orders/order-a": { accountId: p.accountId, memo: "원래 주문" },
    "official_grades/grade-a": { studentUid: uid, snapshot, score: 90 },
    "assessment_attempts/attempt-a": { studentUid: uid, enrollmentId: "enrollment-a", answers: { a: "A" } },
    "years/2026/semesters/2/point_wallets/student-a": { uid, balance: 100, studentName: "원본 이름" },
    "years/2026/semesters/2/point_transactions/tx-a": { uid, delta: 100, balanceAfter: 100 },
  };
}
async function query(documents) { return profile.queryStudentProfiles({ transaction: new Transaction(documents), actor, data: { semesterId: scope, studentUids: [uid] } }); }
async function payloadFor(documents, patch = {}) {
  const state = await query(documents);
  return { semesterId: scope, studentUid: uid, expectedVersion: state.students[0].expectedVersion,
    operation: "EDIT_PROFILE", targetClassId: "class-a", expectedTargetClassRevision: 1,
    studentNumber: "8", displayName: "새 이름", email: "student@example.com", reason: "교사 확인", ...patch };
}
const adapter = profile.createStudentProfileAdapter();
const apply = (tx, payload, extra = {}) => adapter.apply({ transaction: tx, actor, commandType: profile.COMMAND_TYPE,
  commandId: "command-a", receiptId: "receipt-a", timestamp: "t1", concreteTimestamp: "2026-09-11T12:00:00Z", payload, ...extra });
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
async function rejection(name, mutate, reason) {
  await test(name, async () => {
    const documents = fixture(), payload = await payloadFor(documents); mutate(documents);
    const tx = new Transaction(documents);
    await assert.rejects(apply(tx, payload), error => !reason || error.details?.reason === reason);
    assert.equal(tx.writes.length, 0); assert.deepEqual(tx.documents, documents);
  });
}
(async () => {
  await test("query returns display/CAS/class fields only and reads no financial projection", async () => {
    const result = await query(fixture());
    assert.equal(result.students[0].source, "CANONICAL"); assert.match(result.students[0].expectedVersion, /^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(result); for (const field of ["balance", "earnedTotal", "recentLedgerEntries", "point_transactions"]) assert(!serialized.includes(field));
  });
  await test("100 canonical students use two batched reads and one shared class query", async () => {
    const seed = fixture(), uids = [];
    for (let i = 0; i < 100; i++) {
      const studentUid = `student-${i}`, paths = profile.pathsFor(scope, studentUid), enrollmentId = `enrollment-${i}`;
      uids.push(studentUid);
      seed[paths.user] = clone(seed[p.user]);
      seed[paths.identity] = { ...seed[p.identity], studentUid };
      seed[paths.slot] = { ...seed[p.slot], studentUid, activeEnrollmentId: enrollmentId };
      seed[`semester_enrollments/${enrollmentId}`] = { ...seed["semester_enrollments/enrollment-a"], enrollmentId, studentUid };
    }
    const tx = new Transaction(seed), batches = [], queries = [];
    const reader = {
      get: async () => { throw new Error("unexpected per-student document read"); },
      getAll: async paths => { batches.push(paths); return tx.getAll(paths); },
      query: async (...args) => { queries.push(args); return tx.query(...args); },
    };
    const result = await profile.queryStudentProfiles({ transaction: reader, actor, data: { semesterId: scope, studentUids: uids } });
    assert.equal(result.students.filter(row => row.source === "CANONICAL").length, 100);
    assert.deepEqual(batches.map(paths => paths.length), [303, 100]);
    assert.equal(queries.length, 1); assert.equal(queries[0][0], "semester_classes");
  });
  await test("name/number updates active identity/profile and Wis labels without touching money/history", async () => {
    const seed = fixture(), tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
    assert.equal(tx.documents[p.user].studentName, "새 이름"); assert.equal(tx.documents[p.user].studentNumber, "8");
    assert.equal(tx.documents[p.identity].displayName, "새 이름"); assert.equal(tx.documents[p.identity].revision, 2);
    assert.equal(tx.documents["semester_enrollments/enrollment-a"].snapshot.displayName, "새 이름");
    assert.equal(tx.documents["semester_enrollments/enrollment-a"].revision, 6);
    assert.equal(tx.documents[p.slot].activeEnrollmentId, "enrollment-a");
    for (const path of [p.account, p.balance, p.ranking]) {
      assert.equal(tx.documents[path].displayName, "새 이름"); assert.equal(tx.documents[path].studentNumber, "8");
      for (const field of ["balance", "earnedTotal", "spentTotal", "rankEarnedTotal", "adjustedTotal", "revision", "ledgerRevision", "recentLedgerEntries"])
        assert.deepEqual(tx.documents[path][field], seed[path][field]);
    }
    for (const path of Object.keys(seed).filter(path => path.startsWith("years/") || path.startsWith("official_grades/") ||
      path.startsWith("assessment_attempts/") || path.startsWith("semester_wis_ledger/") || path.startsWith("semester_wis_orders/") || path.endsWith("historical"))) assert.deepEqual(tx.documents[path], seed[path]);
    assert.equal(tx.documents[p.readiness].status, "STALE");
  });
  await test("class move closes old snapshot and atomically points all current projections at new enrollment", async () => {
    const seed = fixture(), tx = new Transaction(seed);
    const result = await apply(tx, await payloadFor(seed, { operation: "MOVE_CLASS", targetClassId: "class-b", expectedTargetClassRevision: 3, displayName: "must not overwrite", studentNumber: "99" }));
    const next = tx.documents[`semester_enrollments/${result.result.enrollmentId}`];
    assert.equal(next.classId, "class-b"); assert.equal(next.studentNumber, "7"); assert.equal(next.snapshot.displayName, "학생");
    assert.equal(tx.documents[p.user].studentClass, "2"); assert.equal(tx.documents[p.user].studentNumber, "7");
    assert.equal(tx.documents["semester_enrollments/enrollment-a"].enrollmentStatus, "TRANSFERRED");
    assert.deepEqual(tx.documents["semester_enrollments/enrollment-a"].snapshot, seed["semester_enrollments/enrollment-a"].snapshot);
    for (const path of [p.account, p.balance, p.ranking]) assert.equal(tx.documents[path].enrollmentId, result.result.enrollmentId);
    assert.equal(tx.documents[p.slot].revision, 3);
  });
  await test("promotion stays in current semester and preserves names/numbers", async () => {
    const seed = fixture(), tx = new Transaction(seed);
    const result = await apply(tx, await payloadFor(seed, { operation: "PROMOTE_GRADE", targetClassId: "class-c" }));
    assert.equal(result.result.semesterId, scope); assert.equal(result.result.profile.grade, "3"); assert.equal(result.result.profile.number, "7");
  });
  await test("teacher who also has student enrollment keeps role and permissions", async () => {
    const seed = fixture(); Object.assign(seed[p.user], { role: "teacher", permissions: { point_manage: true } });
    const tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
    assert.equal(tx.documents[p.user].role, "teacher"); assert.deepEqual(tx.documents[p.user].permissions, { point_manage: true });
  });
  await test("no Wis account is created implicitly", async () => {
    const seed = fixture(); delete seed[p.account]; delete seed[p.balance]; delete seed[p.ranking];
    const tx = new Transaction(seed); await apply(tx, await payloadFor(seed)); assert(!tx.documents[p.account]);
  });
  for (const [name, mutate, reason] of [
    ["stale enrollment", s => s["semester_enrollments/enrollment-a"].revision++, "STUDENT_PROFILE_VERSION_CONFLICT"],
    ["stale profile", s => s[p.user].studentName = "other", "STUDENT_PROFILE_VERSION_CONFLICT"],
    ["profile ABA timestamp", s => s[p.user].updatedAt = "t-other", "STUDENT_PROFILE_VERSION_CONFLICT"],
    ["stale identity", s => s[p.identity].revision++, "STUDENT_PROFILE_VERSION_CONFLICT"],
    ["stale slot", s => s[p.slot].revision++, "STUDENT_PROFILE_VERSION_CONFLICT"],
    ["foreign semester pointer", s => s[p.pointer].semesterId = "2026-1", "STUDENT_PROFILE_SCOPE_CHANGED"],
    ["non-active manifest", s => s[p.manifest].status = "ARCHIVED", "STUDENT_PROFILE_SCOPE_CHANGED"],
    ["active manifest readOnly", s => s[p.manifest].readOnly = true, "STUDENT_PROFILE_SCOPE_CHANGED"],
    ["active enrollment readOnly", s => s["semester_enrollments/enrollment-a"].readOnly = true, "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["inactive identity account", s => s[p.identity].accountStatus = "INACTIVE", "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["missing identity account status", s => delete s[p.identity].accountStatus, "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["inactive enrollment slot", s => s[p.slot].status = "INACTIVE", "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["missing enrollment slot status", s => delete s[p.slot].status, "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["slot missing", s => delete s[p.slot], "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["foreign enrollment uid", s => s["semester_enrollments/enrollment-a"].studentUid = "foreign", "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["inactive class", s => s["semester_classes/class-a"].status = "INACTIVE", "STUDENT_PROFILE_CLASS_INVALID"],
    ["identity revision unsafe", s => s[p.identity].revision = Number.MAX_SAFE_INTEGER, "STUDENT_PROFILE_ENROLLMENT_INVALID"],
    ["partial Wis projection", s => delete s[p.balance], "STUDENT_PROFILE_WIS_PROJECTION_INCOMPLETE"],
    ["foreign Wis scope", s => s[p.account].semesterId = "2026-1", "STUDENT_PROFILE_WIS_SCOPE_INVALID"],
    ["migration fence", s => s[p.migrationFence] = { enabled: true, writesBlocked: true }, "STUDENT_PROFILE_MIGRATION_FENCED"],
    ["migration fence enabled only", s => s[p.migrationFence] = { enabled: true, writesBlocked: false }, "STUDENT_PROFILE_MIGRATION_FENCED"],
    ["migration fence writesBlocked only", s => s[p.migrationFence] = { enabled: false, writesBlocked: true }, "STUDENT_PROFILE_MIGRATION_FENCED"],
    ["registration awaiting account", s => s[p.user].registrationApprovalStatus = "APPROVED_PENDING_ACCOUNT", "STUDENT_PROFILE_APPROVAL_INCOMPLETE"],
    ["registration pending", s => s[p.user].registrationApprovalStatus = "PENDING", "STUDENT_PROFILE_APPROVAL_INCOMPLETE"],
    ["registration malformed", s => s[p.user].registrationApprovalStatus = null, "STUDENT_PROFILE_APPROVAL_INCOMPLETE"],
  ]) await rejection(name, mutate, reason);
  await test("optional readOnly absent or false stays compatible; frozen query rows are blocked", async () => {
    for (const readOnly of [undefined, false]) {
      const seed = fixture();
      if (readOnly !== undefined) {
        seed[p.manifest].readOnly = readOnly;
        seed["semester_enrollments/enrollment-a"].readOnly = readOnly;
      }
      const tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
      assert(tx.writes.length > 0);
    }
    for (const mutate of [
      s => s[p.manifest].readOnly = true,
      s => s["semester_enrollments/enrollment-a"].readOnly = true,
      s => s[p.identity].accountStatus = "INACTIVE",
      s => s[p.slot].status = "INACTIVE",
    ]) {
      const seed = fixture(); mutate(seed);
      const state = await query(seed);
      assert.equal(state.students[0].source, "BLOCKED");
      assert.equal(state.students[0].expectedVersion, null);
    }
  });
  await test("stale target class and occupied number reject with zero writes", async () => {
    const seed = fixture(), payload = await payloadFor(seed, { operation: "MOVE_CLASS", targetClassId: "class-b", expectedTargetClassRevision: 3 });
    seed["semester_classes/class-b"].revision++;
    await assert.rejects(apply(new Transaction(seed), payload), error => error.details.reason === "STUDENT_PROFILE_TARGET_CLASS_CHANGED");
    seed["semester_classes/class-b"].revision--;
    seed["semester_enrollments/occupied"] = { semesterId: scope, classId: "class-b", studentUid: "foreign", studentNumber: "7", enrollmentStatus: "ACTIVE" };
    const tx = new Transaction(seed); await assert.rejects(apply(tx, payload), error => error.details.reason === "STUDENT_PROFILE_NUMBER_OCCUPIED"); assert.equal(tx.writes.length, 0);
  });
  await test("MOVE_CLASS cannot change grade", async () => {
    const seed = fixture(); await assert.rejects(apply(new Transaction(seed), await payloadFor(seed, { operation: "MOVE_CLASS", targetClassId: "class-c" })), error => error.details.reason === "STUDENT_PROFILE_MOVE_GRADE_CHANGED");
  });
  await test("canonical email is readonly and missing class displayName has safe fallback", async () => {
    const seed = fixture(), payload = await payloadFor(seed, { email: "changed@example.com" });
    const tx = new Transaction(seed); await assert.rejects(apply(tx, payload), error => error.details.reason === "STUDENT_PROFILE_ACCOUNT_EMAIL_READ_ONLY"); assert.equal(tx.writes.length, 0);
    delete seed["semester_classes/class-b"].displayName;
    const moved = new Transaction(seed); const result = await apply(moved, await payloadFor(seed, { operation: "MOVE_CLASS", targetClassId: "class-b", expectedTargetClassRevision: 3 }));
    assert.equal(moved.documents[`semester_enrollments/${result.result.enrollmentId}`].snapshot.classDisplayName, "2학년 2반");
    assert.equal(moved.documents[p.user].email, "student@example.com");
  });
  await test("legacy callable also rejects pending registration before writes", async () => {
    const seed = fixture(); delete seed[p.slot]; delete seed["semester_enrollments/enrollment-a"]; seed[p.user].registrationApprovalStatus = "PENDING";
    const tx = new Transaction(seed); await assert.rejects(profile.assertLegacyProfileWritable({ transaction: tx, semesterId: scope, studentUid: uid }), error => error.details.reason === "STUDENT_PROFILE_APPROVAL_INCOMPLETE"); assert.equal(tx.writes.length, 0);
  });
  await test("legacy guard rejects existing slot or historical record before legacy writes", async () => {
    const seed = fixture();
    for (const slot of [true, false]) {
      const current = clone(seed); if (!slot) delete current[p.slot];
      const tx = new Transaction(current);
      await assert.rejects(profile.assertLegacyProfileWritable({ transaction: tx, semesterId: scope, studentUid: uid }), error => error.details.reason === "STUDENT_PROFILE_CANONICAL_COMMAND_REQUIRED");
      assert.equal(tx.writes.length, 0);
    }
  });
  await test("legacy without current canonical records remains legacy and guard permits profile write", async () => {
    const seed = fixture(); delete seed[p.slot]; delete seed["semester_enrollments/enrollment-a"];
    const result = await query(seed); assert.equal(result.students[0].source, "LEGACY");
    const tx = new Transaction(seed); await profile.assertLegacyProfileWritable({ transaction: tx, semesterId: scope, studentUid: uid });
    tx.set(p.user, { name: "legacy changed" }, { merge: true }); assert.equal(tx.writes.length, 1);
  });
  await test("legacy callable cannot switch semester to bypass canonical guard", async () => {
    for (const pointerPresent of [true, false]) {
      const seed = fixture(); if (!pointerPresent) delete seed[p.pointer];
      const tx = new Transaction(seed);
      await assert.rejects(profile.assertLegacyProfileWritable({ transaction: tx, semesterId: "2025-1", studentUid: uid }));
      assert.equal(tx.writes.length, 0);
    }
  });
  await test("malformed state is a blocked row without hiding other students", async () => {
    const seed = fixture(); delete seed[p.slot];
    const result = await query(seed); assert.equal(result.students[0].source, "BLOCKED"); assert.equal(result.students[0].expectedVersion, null);
  });
  await test("strict payload and student actor rejection", async () => {
    const seed = fixture(), payload = await payloadFor(seed);
    for (const patch of [{ money: 1 }, { studentUid: "../evil" }, { expectedVersion: null }, { expectedTargetClassRevision: 0 }]) assert.throws(() => profile.normalizeStudentProfilePayload(profile.COMMAND_TYPE, { ...payload, ...patch }));
    await assert.rejects(apply(new Transaction(seed), payload, { actor: { ...actor, actorRole: "student" } }), error => error.code === "permission-denied");
  });
  await test("Gateway response loss replay preserves later profile and does not create extra enrollment/ledger", async () => {
    let documents = fixture(); const payload = await payloadFor(documents, { operation: "MOVE_CLASS", targetClassId: "class-b", expectedTargetClassRevision: 3 });
    const store = { runTransaction: async callback => { const tx = new Transaction(documents); const result = await callback(tx); documents = tx.documents; return result; } };
    const core = gateway.createCommandGatewayCore({ store, assertSession: async () => ({ uid: actor.actorUid }), authorizeCommand: async () => actor,
      commandAdapters: { [profile.COMMAND_TYPE]: adapter }, serverTimestamp: () => "t1", concreteTimestamp: () => "2026-09-11T12:00:00Z", projectId: "demo-westory-session-student-profile" });
    const request = { auth: { uid: actor.actorUid }, data: { commandType: profile.COMMAND_TYPE, commandId: "a0000000-0000-4000-8000-000000000001", payload, _testDropResponseAfterCommit: true } };
    await assert.rejects(core.execute(request), error => error.code === "unavailable");
    const committed = clone(documents); documents[p.user].studentName = "later change";
    const replay = await core.execute(request); assert.equal(replay.replayed, true); assert.equal(documents[p.user].studentName, "later change");
    assert.equal(Object.keys(documents).length, Object.keys(committed).length);
    assert.equal(Object.keys(documents).filter(path => path.startsWith("semester_wis_ledger/")).length, 1);
    await assert.rejects(core.execute({ ...request, data: { ...request.data, payload: { ...payload, displayName: "changed payload" } } }), error => error.details.reason === "COMMAND_ID_CONFLICT");
    const before = clone(documents);
    await assert.rejects(core.execute({ ...request, data: { ...request.data, commandId: "a0000000-0000-4000-8000-000000000002" } })); assert.deepEqual(documents, before);
  });
  await test("failed transaction discards staged profile and enrollment changes", async () => {
    const documents = fixture(), tx = new Transaction(documents), payload = await payloadFor(documents);
    const set = tx.set.bind(tx); tx.set = (...args) => { set(...args); if (tx.writes.length === 3) throw new Error("injected abort"); };
    await assert.rejects(apply(tx, payload), /injected abort/); assert.equal(documents[p.user].studentName, "학생");
  });
  console.log(`PASS student enrollment profile: ${count} scenarios`);
})().catch(error => { console.error(error); process.exitCode = 1; });
