const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");

// This suite exercises the real command parser, adapter, audit and receipts in
// memory. Production predeploy environment variables never select live services.
const projectId = "demo-westory-session-registration-review";
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:1";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:1";
const registration = require("../studentRegistrationApproval");
const gateway = require("../commandGateway");
const scope = "2026-2";
const paths = registration.pathsFor(scope, "applicant");
const stamp = "2026-11-02T00:00:00Z";

class Transaction {
  constructor(documents) { this.documents = structuredClone(documents); this.writing = false; }
  async get(path) {
    assert.equal(this.writing, false, "Firestore reads must precede writes");
    return { exists: this.documents.has(path), data: structuredClone(this.documents.get(path)), path };
  }
  getAll(paths) { return Promise.all(paths.map(path => this.get(path))); }
  async query(collection, options = {}) {
    assert.equal(this.writing, false, "Firestore queries must precede writes");
    const matches = [...this.documents].filter(([path, data]) => {
      if (!path.startsWith(`${collection}/`) || path.slice(collection.length + 1).includes("/")) return false;
      return (options.filters || []).every(({ field, operator, value }) => operator === "in" ? value.includes(data[field]) : data[field] === value);
    });
    return matches.slice(0, options.limit || matches.length).map(([path, data]) => ({ path, exists: true, data: structuredClone(data) }));
  }
  set(path, data, options) {
    this.writing = true;
    this.documents.set(path, structuredClone(options?.merge ? { ...this.documents.get(path), ...data } : data));
  }
  create(path, data) {
    assert.equal(this.documents.has(path), false, "immutable approval/audit/receipt cannot be overwritten");
    this.set(path, data);
  }
}
class Store {
  constructor(seed) { this.documents = new Map(Object.entries(seed)); this.queue = Promise.resolve(); }
  get(path) { return new Transaction(this.documents).get(path); }
  runTransaction(callback) {
    const task = this.queue.then(async () => {
      const transaction = new Transaction(this.documents);
      const result = await callback(transaction);
      this.documents = transaction.documents;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
const fixture = () => {
  const store = new Store({
    [paths.user]: { role: "student", name: "신청학생", grade: "3", class: "1", number: "5", email: "applicant@yongshin-ms.ms.kr", registrationApprovalStatus: "PENDING" },
    [paths.pointer]: { semesterId: scope, revision: 7 },
    [paths.manifest]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    "semester_classes/class-a": { classId: "class-a", semesterId: scope, status: "ACTIVE", revision: 2, grade: "3", classNumber: "1" },
  });
  const authCalls = [], sessionCalls = [];
  let authUser = { uid: "applicant", email: "applicant@yongshin-ms.ms.kr", emailVerified: true, disabled: false };
  const adapter = registration.createStudentRegistrationApprovalAdapter({ getAuthUser: async uid => { authCalls.push(uid); return authUser; } });
  const core = gateway.createCommandGatewayCore({ store, projectId,
    assertSession: async (request, options) => {
      sessionCalls.push(options);
      if (request.sessionRejected) throw Object.assign(new Error("expired session"), { code: "unauthenticated" });
      return { uid: request.auth.uid };
    },
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: "test@example.invalid", actorRole: request.role || "teacher" }),
    commandAdapters: { [registration.COMMAND_TYPE]: adapter },
    serverTimestamp: () => stamp, concreteTimestamp: () => stamp,
  });
  const request = (action = "REJECT", payload = {}) => ({ auth: { uid: "manager" }, data: { commandId: randomUUID(), commandType: registration.COMMAND_TYPE, payload: {
    action, semesterId: scope, expectedSemesterRevision: 7, studentUid: "applicant", expectedProfileVersion: registration.profileVersion(store.documents.get(paths.user)),
    ...(action === "APPROVE" ? { classId: "class-a", expectedClassRevision: 2, studentNumber: "5", displayName: "신청학생", rosterConfirmed: true } : {}), ...payload,
  } } });
  return { store, core, request, authCalls, sessionCalls, setAuth: value => { authUser = value; } };
};
const reason = expected => error => error.details?.reason === expected;
const unchanged = async (f, request, expected) => {
  const before = structuredClone(f.store.documents);
  await assert.rejects(() => f.core.execute(request), reason(expected));
  assert.deepEqual(f.store.documents, before);
};

test("rejection records a review and receipt, grants no access and touches no enrollment or account", async () => {
  const f = fixture();
  f.setAuth({ uid: "applicant", disabled: true, emailVerified: false });
  f.store.documents.set(paths.control, { writesBlocked: true });
  const before = structuredClone(f.store.documents), request = f.request();
  const response = await f.core.execute(request);
  assert.deepEqual(response.result, { studentUid: "applicant", semesterId: scope, enrollmentId: "", status: "REJECTED", action: "REJECT" });
  assert.equal(f.store.documents.get(paths.user).registrationApprovalStatus, "REJECTED");
  assert.equal(f.store.documents.get(paths.approval).rejectedBy, "manager");
  assert.equal(f.store.documents.get(paths.approval).commandId, request.data.commandId);
  assert.equal(f.authCalls.length, 0, "refusal must not depend on approval eligibility");
  for (const [path, value] of before) if (path !== paths.user) assert.deepEqual(f.store.documents.get(path), value);
  for (const name of ["identity", "slot", "account", "balance", "ranking"]) assert.equal(f.store.documents.has(paths[name]), false);
  assert.equal([...f.store.documents.keys()].filter(path => path.startsWith(`${gateway.RECEIPT_COLLECTION}/`)).length, 1);
  assert.equal([...f.store.documents.keys()].filter(path => path.startsWith(`${gateway.AUDIT_COLLECTION}/`)).length, 1);
  assert.ok(f.sessionCalls.every(call => call.recentAuth === true && call.highRisk === true));
});

test("response loss reuses the exact rejection receipt and rejects changed payload", async () => {
  const f = fixture(), request = f.request();
  request.data._testDropResponseAfterCommit = true;
  await assert.rejects(() => f.core.execute(request), error => error.code === "unavailable");
  const before = structuredClone(f.store.documents);
  assert.equal((await f.core.execute(request)).replayed, true);
  const receipt = await f.core.getStatus({ auth: request.auth, data: { commandId: request.data.commandId, commandType: registration.COMMAND_TYPE } });
  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(receipt.result.status, "REJECTED");
  assert.deepEqual(f.store.documents, before);
  await unchanged(f, { ...request, data: { ...request.data, payload: { ...request.data.payload, expectedSemesterRevision: 8 } } }, "COMMAND_ID_CONFLICT");
});

test("student, staff and self-review cannot reject applicants; expired session cannot write", async () => {
  for (const role of ["student", "staff"]) {
    const f = fixture();
    await unchanged(f, { ...f.request(), role }, "REGISTRATION_MANAGER_REQUIRED");
  }
  const f = fixture();
  await unchanged(f, { ...f.request(), auth: { uid: "applicant" } }, "REGISTRATION_MANAGER_REQUIRED");
  const before = structuredClone(f.store.documents);
  await assert.rejects(() => f.core.execute({ ...f.request(), sessionRejected: true }), error => error.code === "unauthenticated");
  assert.deepEqual(f.store.documents, before);
});

test("changed profile, semester, status or existing canonical records abort atomically", async () => {
  const stale = fixture(), request = stale.request();
  stale.store.documents.get(paths.user).name = "수정학생";
  await unchanged(stale, request, "REGISTRATION_PROFILE_CHANGED");
  for (const status of ["APPROVED", "APPROVED_PENDING_ACCOUNT", "REJECTED", undefined]) {
    const f = fixture(); f.store.documents.get(paths.user).registrationApprovalStatus = status;
    await unchanged(f, f.request(), "REGISTRATION_NOT_PENDING");
  }
  for (const [path, data] of [[paths.pointer, { semesterId: "2027-1", revision: 7 }], [paths.manifest, { semesterId: scope, status: "ARCHIVED", revision: 7 }]]) {
    const f = fixture(); f.store.documents.set(path, data);
    await unchanged(f, f.request(), "REGISTRATION_SEMESTER_CHANGED");
  }
  for (const path of [paths.approval, paths.slot, paths.account, paths.balance, paths.ranking, "semester_enrollments/orphan"]) {
    const f = fixture(); f.store.documents.set(path, { semesterId: scope, studentUid: "applicant" });
    await unchanged(f, f.request(), "REGISTRATION_EXISTING_ENROLLMENT");
  }
  const invalid = fixture();
  await unchanged(invalid, invalid.request("REJECT", { classId: "class-a" }), "REGISTRATION_INPUT_INVALID");
});

test("racing approval and rejection cannot both commit, and approval keeps its account fence", async () => {
  for (const first of ["APPROVE", "REJECT"]) {
    const f = fixture(), second = first === "APPROVE" ? "REJECT" : "APPROVE";
    const results = await Promise.allSettled([f.core.execute(f.request(first)), f.core.execute(f.request(second))]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(f.store.documents.get(paths.user).registrationApprovalStatus, first === "APPROVE" ? "APPROVED_PENDING_ACCOUNT" : "REJECTED");
    assert.equal(f.store.documents.has(paths.slot), first === "APPROVE");
  }
  const f = fixture(); f.setAuth({ uid: "applicant", email: "applicant@yongshin-ms.ms.kr", emailVerified: false });
  await unchanged(f, f.request("APPROVE"), "REGISTRATION_SCHOOL_ACCOUNT_REQUIRED");
});

test("pending query removes rejected applicants and still returns approval in progress", async () => {
  const f = fixture();
  const query = registration.createStudentRegistrationApprovalQueryCore({ store: f.store, assertManager: async () => {} })[registration.QUERY_NAME];
  assert.equal((await query({ data: { semesterId: scope } })).students.length, 1);
  await f.core.execute(f.request());
  assert.equal((await query({ data: { semesterId: scope } })).students.length, 0);
  assert.equal((await query({ data: { semesterId: scope, studentUid: "applicant" } })).students.length, 0);
  const approval = fixture(); await approval.core.execute(approval.request("APPROVE"));
  const approvedQuery = registration.createStudentRegistrationApprovalQueryCore({ store: approval.store, assertManager: async () => {} })[registration.QUERY_NAME];
  assert.equal((await approvedQuery({ data: { semesterId: scope } })).students[0].status, "APPROVED_PENDING_ACCOUNT");
});
