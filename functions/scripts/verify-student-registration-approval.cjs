const assert = require("node:assert/strict");
const approval = require("../studentRegistrationApproval");
const gateway = require("../commandGateway");
const wis = require("../wisEconomy");
const clone = value => structuredClone(value);
const scope = "2026-2", uid = "new-student", p = approval.pathsFor(scope, uid);
const actor = { actorUid: "teacher-a", actorRole: "teacher", actorEmail: "teacher@example.com" };
const authUser = { uid, disabled: false, emailVerified: true, email: "new@yongshin-ms.ms.kr" };
class Transaction {
  constructor(documents) { this.documents = clone(documents); this.writes = []; }
  async get(path) { assert.equal(this.writes.length, 0, "read after write"); return { path, exists: Object.hasOwn(this.documents, path), data: clone(this.documents[path] || null) }; }
  async getAll(paths) { return Promise.all(paths.map(path => this.get(path))); }
  async query(collection, options = {}) {
    assert.equal(this.writes.length, 0, "query after write");
    const filters = options.filters || (options.field ? [options] : []);
    return Object.entries(this.documents).filter(([path, data]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/") &&
      (!options.startAfterId || path.split("/").pop() > options.startAfterId) && filters.every(f => f.operator === "in" ? f.value.includes(data[f.field]) : f.operator === "==" && data[f.field] === f.value))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, options.limit || Infinity).map(([path, data]) => ({ path, exists: true, data: clone(data) }));
  }
  set(path, data, options) { this.writes.push(path); this.documents[path] = options?.merge ? { ...this.documents[path], ...clone(data) } : clone(data); }
  create(path, data) { assert(!Object.hasOwn(this.documents, path), `create overwrite: ${path}`); this.set(path, data); }
}
function fixture() {
  return {
    [p.user]: { role: "student", name: "신청 이름", grade: "1", class: "9", number: "99", email: authUser.email, registrationApprovalStatus: "PENDING" },
    [p.manifest]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    [p.pointer]: { semesterId: scope, revision: 7 },
    [p.economy]: { semesterId: scope, status: "ACTIVE_OPEN", revision: 2, schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION, accountCount: 10 },
    [p.readiness]: { status: "PASSED", immutable: "preserve" },
    "semester_classes/class-a": { classId: "class-a", semesterId: scope, grade: "2", classNumber: "3", displayName: "2학년 3반", status: "ACTIVE", revision: 4 },
    "semester_enrollments/other-semester": { studentUid: uid, semesterId: "2026-1", enrollmentStatus: "COMPLETED", snapshot: { displayName: "과거" } },
    "users/old-student": { role: "student", name: "기존", email: "old@yongshin-ms.ms.kr" },
    "years/2026/semesters/1/point_wallets/new-student": { uid, balance: 500 },
  };
}
const adapter = approval.createStudentRegistrationApprovalAdapter({ getAuthUser: async () => authUser });
const payloadFor = (documents, action = "APPROVE", patch = {}) => ({ semesterId: scope, expectedSemesterRevision: 7, studentUid: uid,
  expectedProfileVersion: approval.profileVersion(documents[p.user]), action, ...(action === "APPROVE" ? {
    classId: "class-a", expectedClassRevision: 4, studentNumber: "12", displayName: "명부 이름", rosterConfirmed: true,
  } : { expectedEnrollmentId: documents[p.user].approvedEnrollmentId,
    ...(action === "PREPARE_ACCOUNT" ? { expectedEconomyRevision: documents[p.economy].revision } : { expectedAccountRevision: 1 }) }), ...patch });
const apply = (tx, payload, extra = {}) => adapter.apply({ transaction: tx, actor, commandType: approval.COMMAND_TYPE, payload,
  commandId: "command-a", receiptId: "receipt-a", timestamp: "t1", concreteTimestamp: "2026-09-11T12:00:00Z", ...extra });
const phase = async (documents, action) => { const tx = new Transaction(documents); const result = await apply(tx, payloadFor(documents, action)); return { documents: tx.documents, result, writes: tx.writes }; };
const query = async (documents, data = {}) => approval.createStudentRegistrationApprovalQueryCore({ store: { runTransaction: fn => fn(new Transaction(documents)) }, assertManager: async () => actor })[approval.QUERY_NAME]({ data: { semesterId: scope, ...data } });
let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function reject(name, seed, action, mutate, extra = {}) {
  await test(name, async () => { const docs = clone(seed), payload = payloadFor(docs, action); mutate(docs, payload);
    const tx = new Transaction(docs); await assert.rejects(apply(tx, payload, extra)); assert.equal(tx.writes.length, 0); assert.deepEqual(tx.documents, docs); });
}
(async () => {
  const initial = fixture(), approved = (await phase(initial, "APPROVE")).documents;
  const prepared = (await phase(approved, "PREPARE_ACCOUNT")).documents;
  const finished = (await phase(prepared, "FINALIZE")).documents;
  await test("roster approval preserves submitted profile and syncs confirmed users/enrollment", async () => {
    const a = approved[p.approval], active = approved[`semester_enrollments/${a.enrollmentId}`];
    assert.deepEqual(a.submittedProfile, { name: "신청 이름", grade: "1", class: "9", number: "99", email: authUser.email });
    assert.equal(approved[p.user].name, "명부 이름"); assert.equal(approved[p.user].class, "3"); assert.equal(approved[p.user].customNameConfirmed, true);
    assert.deepEqual(active.snapshot, a.confirmedSnapshot); assert.equal(active.createdBy, actor.actorUid); assert.equal(active.source.sourceId, p.approvalId);
    assert.equal(approved[p.user].registrationApprovalStatus, "APPROVED_PENDING_ACCOUNT"); assert(!approved[p.account]);
    assert.equal(approved[p.readiness].status, "STALE"); assert.equal(approved[p.readiness].immutable, "preserve");
    for (const path of ["users/old-student", "semester_enrollments/other-semester", "years/2026/semesters/1/point_wallets/new-student", p.manifest, p.pointer, p.economy]) assert.deepEqual(approved[path], initial[path]);
  });
  await test("ordinary teacher prepares one real W7 account and projections without grant", async () => {
    for (const path of [p.account, p.balance, p.ranking]) { assert.equal(prepared[path].balance, 0); assert.equal(prepared[path].studentUid, uid); assert.equal(prepared[path].enrollmentId, approved[p.user].approvedEnrollmentId); }
    assert.equal(prepared[p.account].initialGrantLedgerEntryId, null); assert.equal(prepared[p.account].earnedTotal, 0);
    assert.equal(prepared[p.economy].accountCount, 11); assert.equal(prepared[p.economy].revision, 3);
    assert(!Object.keys(prepared).some(path => path.startsWith(`${wis.WIS_LEDGER_COLLECTION}/`)));
    assert.equal(prepared[p.user].registrationApprovalStatus, "APPROVED_PENDING_ACCOUNT");
  });
  await test("finalize only changes profile and approval audit after exact empty-account checks", async () => {
    const result = await phase(prepared, "FINALIZE"); assert.deepEqual(result.writes.sort(), [p.user, p.approval].sort());
    assert.equal(finished[p.user].registrationApprovalStatus, "APPROVED"); assert.equal(finished[p.approval].status, "APPROVED");
    for (const path of [p.account, p.balance, p.ranking, p.economy, p.slot]) assert.deepEqual(finished[path], prepared[path]);
  });
  await test("account preparation retry does not increment economy or create extra account", async () => {
    const result = await phase(prepared, "PREPARE_ACCOUNT"); assert.equal(result.result.result.replayedAccount, true); assert.equal(result.writes.length, 0); assert.deepEqual(result.documents, prepared);
  });
  await test("legacy unmarked profiles are absent from queue and cannot be approved", async () => {
    const state = await query(initial); assert.deepEqual(state.students.map(row => row.studentUid), [uid]);
    const docs = clone(initial); delete docs[p.user].registrationApprovalStatus; const tx = new Transaction(docs);
    await assert.rejects(apply(tx, payloadFor(docs))); assert.equal(tx.writes.length, 0);
  });
  await test("reconnected queue exposes recovery stage and original request", async () => {
    const a = (await query(approved)).students[0], b = (await query(prepared)).students[0];
    assert.equal(a.status, "APPROVED_PENDING_ACCOUNT"); assert.equal(a.accountState, "NOT_PREPARED"); assert.equal(a.submittedProfile.name, "신청 이름");
    assert.equal(b.accountState, "PREPARED"); assert.equal(b.accountRevision, 1); assert.equal((await query(finished)).students.length, 0);
  });
  await test("pending queue is bounded and cursor preserves all 55 students", async () => {
    const docs = fixture(); delete docs[p.user]; for (let i = 0; i < 55; i++) docs[`users/pending-${String(i).padStart(2, "0")}`] = clone(initial[p.user]);
    const first = await query(docs), second = await query(docs, { cursor: first.nextCursor });
    assert.equal(first.students.length, 50); assert.equal(second.students.length, 5); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.students, ...second.students].map(row => row.studentUid)).size, 55);
  });
  for (const [name, mutate] of [
    ["stale profile", d => d[p.user].name = "changed"], ["profile ABA timestamp", d => d[p.user].updatedAt = "other"], ["stale semester", d => d[p.manifest].revision++],
    ["changed current pointer", d => d[p.pointer].semesterId = "2026-1"], ["archived manifest", d => d[p.manifest].status = "ARCHIVED"],
    ["stale class", d => d["semester_classes/class-a"].revision++], ["foreign class", d => d["semester_classes/class-a"].semesterId = "2026-1"],
    ["existing slot", d => d[p.slot] = { activeEnrollmentId: "existing" }], ["existing account", d => d[p.account] = { balance: 300 }],
    ["existing current enrollment", d => d["semester_enrollments/existing"] = { semesterId: scope, studentUid: uid, enrollmentStatus: "ACTIVE" }],
    ["occupied class number", d => d["semester_enrollments/occupied"] = { semesterId: scope, classId: "class-a", studentNumber: "12", enrollmentStatus: "ACTIVE", studentUid: "foreign" }],
    ["foreign identity", d => d[p.identity] = { studentUid: "foreign", accountStatus: "ACTIVE", revision: 1 }],
    ["migration enabled", d => d[p.control] = { enabled: true }], ["migration writes blocked", d => d[p.control] = { writesBlocked: true }],
    ["client finance field", (_, payload) => payload.initialGrant = 100], ["roster confirmation missing", (_, payload) => payload.rosterConfirmed = false],
  ]) await reject(name, initial, "APPROVE", mutate);
  for (const role of ["student", "staff"]) await reject(`${role} cannot approve`, initial, "APPROVE", () => {}, { actor: { ...actor, actorRole: role } });
  await reject("self approval denied", initial, "APPROVE", () => {}, { actor: { ...actor, actorUid: uid } });
  for (const patch of [{ disabled: true }, { emailVerified: false }, { email: "evil@example.com" }, { uid: "foreign" }]) await test(`Auth validation ${JSON.stringify(patch)}`, async () => {
    const tx = new Transaction(initial), a = approval.createStudentRegistrationApprovalAdapter({ getAuthUser: async () => ({ ...authUser, ...patch }) });
    await assert.rejects(a.apply({ transaction: tx, actor, commandType: approval.COMMAND_TYPE, payload: payloadFor(initial) })); assert.equal(tx.writes.length, 0);
  });
  for (const [name, mutate] of [
    ["foreign enrollment", d => d[`semester_enrollments/${d[p.user].approvedEnrollmentId}`].studentUid = "foreign"],
    ["marker mismatch", d => d[p.approval].studentUid = "foreign"], ["marker source mismatch", d => d[`semester_enrollments/${d[p.user].approvedEnrollmentId}`].source.sourceId = "other"],
    ["unconfirmed marker", d => d[p.approval].rosterConfirmed = false], ["enrollment number mismatched", d => d[`semester_enrollments/${d[p.user].approvedEnrollmentId}`].studentNumber = "99"],
    ["slot changed", d => d[p.slot].activeEnrollmentId = "other"], ["closed economy", d => d[p.economy].status = "CLOSED"],
    ["partial projection", d => d[p.balance] = { balance: 0 }], ["class labels changed", d => d["semester_classes/class-a"].grade = "3"],
    ["migration fence in preparation", d => d[p.control] = { enabled: true }],
  ]) await reject(name, approved, "PREPARE_ACCOUNT", mutate);
  for (const [name, mutate] of [
    ["missing account", d => delete d[p.account]], ["foreign account owner", d => d[p.account].studentUid = "foreign"],
    ["foreign account scope", d => d[p.balance].semesterId = "2026-1"], ["foreign account enrollment", d => d[p.ranking].enrollmentId = "other"],
    ["wrong account label", d => d[p.balance].studentNumber = "99"], ["wrong rank label", d => d[p.ranking].displayName = "other"],
    ["nonzero balance", d => d[p.account].balance = 1], ["net zero but earned history", d => d[p.account].earnedTotal = 1],
    ["initial grant marker", d => d[p.account].initialGrantLedgerEntryId = "grant"], ["account migrated", d => d[p.account].legacyMigrationId = "migration"],
    ["changed account revision", d => d[p.account].revision = 2], ["projection revision stale", d => d[p.balance].ledgerRevision = 2],
    ["zero delta ledger exists", d => d[`${wis.WIS_LEDGER_COLLECTION}/unexpected`] = { accountId: p.accountId, delta: 0 }],
    ["finalize migration fence", d => d[p.control] = { writesBlocked: true }],
  ]) await reject(name, prepared, "FINALIZE", mutate);
  await test("query manager rejection precedes any reads", async () => {
    let read = false; const core = approval.createStudentRegistrationApprovalQueryCore({ assertManager: async () => { throw new Error("denied"); }, store: { runTransaction: () => { read = true; } } });
    await assert.rejects(core[approval.QUERY_NAME]({ data: { semesterId: scope } })); assert.equal(read, false);
  });
  await test("Gateway lost response replays each exact stage without duplicate enrollment/account", async () => {
    let documents = fixture(); const store = { runTransaction: async fn => { const tx = new Transaction(documents); const result = await fn(tx); documents = tx.documents; return result; } };
    const core = gateway.createCommandGatewayCore({ store, assertSession: async () => ({ uid: actor.actorUid }), authorizeCommand: async () => actor,
      commandAdapters: { [approval.COMMAND_TYPE]: adapter }, serverTimestamp: () => "t1", concreteTimestamp: () => "2026-09-11T12:00:00Z", projectId: "demo-westory-session-registration" });
    let n = 0;
    for (const action of ["APPROVE", "PREPARE_ACCOUNT", "FINALIZE"]) {
      const request = { auth: { uid: actor.actorUid }, data: { commandType: approval.COMMAND_TYPE, commandId: `a0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, payload: payloadFor(documents, action), _testDropResponseAfterCommit: true } };
      await assert.rejects(core.execute(request), error => error.code === "unavailable"); const committed = clone(documents);
      const replay = await core.execute(request); assert.equal(replay.replayed, true); assert.deepEqual(documents, committed);
    }
    assert.equal(documents[p.user].registrationApprovalStatus, "APPROVED"); assert.equal(documents[p.economy].accountCount, 11);
    assert.equal(Object.values(documents).filter(d => d.source?.approvalKind === "TEACHER_REGISTRATION").length, 1);
    assert(!Object.keys(documents).some(path => path.startsWith(`${wis.WIS_LEDGER_COLLECTION}/`)));
  });
  await test("failed commit leaves stage recoverable with no partial writes", async () => {
    let documents = clone(approved); const before = clone(documents);
    await assert.rejects((async () => { const tx = new Transaction(documents); await apply(tx, payloadFor(documents, "PREPARE_ACCOUNT")); throw new Error("commit failed"); })());
    assert.deepEqual(documents, before); documents = (await phase(documents, "PREPARE_ACCOUNT")).documents; assert.equal(documents[p.account].balance, 0);
  });
  console.log(`${count} student registration approval checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
