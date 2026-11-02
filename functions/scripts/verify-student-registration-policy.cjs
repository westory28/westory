const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const core = require("../studentRegistrationPolicyCore");
const { createStudentRegistrationPolicyHandlers } = require("../studentRegistrationPolicy");

const fixture = () => {
  const documents = new Map([["users/teacher", { role: "teacher" }], ["users/staff", { role: "staff" }],
    ["users/student", { role: "student", registrationApprovalStatus: "APPROVED" }]]);
  const ref = path => ({ path, get: async () => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)) }) });
  let queue = Promise.resolve(), writes = 0;
  const db = { doc: ref, runTransaction(callback) {
    const pending = queue.then(() => callback({ get: entry => entry.get(), set: (entry, value) => { writes++; documents.set(entry.path, value); } }));
    queue = pending.catch(() => {}); return pending;
  } };
  const sessions = [];
  const handlers = createStudentRegistrationPolicyHandlers({ db, assertSession: async (request, options) => {
    sessions.push(options); if (request.expired) throw Object.assign(new Error("expired"), { code: "unauthenticated" });
  } });
  const request = (data = {}, uid = "teacher") => ({ auth: { uid, token: { email: uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr` } }, data });
  return { documents, handlers, request, sessions, writes: () => writes };
};
const reason = expected => error => error.details?.reason === expected;
test("default intake matches exact issued-year/grade digits; future policy and malformed values fail closed", () => {
  const policy = core.normalizePolicy(null, false);
  assert.equal(policy.emailPatternLabel, "263NNNN@yongshin-ms.ms.kr");
  for (const email of ["2630000@yongshin-ms.ms.kr", "2639999@yongshin-ms.ms.kr"]) assert.equal(core.matchesPolicy(email, policy), true);
  for (const email of ["2430001@yongshin-ms.ms.kr", "2530001@yongshin-ms.ms.kr", "2620001@yongshin-ms.ms.kr", "263001@yongshin-ms.ms.kr",
    "26300001@yongshin-ms.ms.kr", "263abcd@yongshin-ms.ms.kr", "263１２３４@yongshin-ms.ms.kr", "2630001+tag@yongshin-ms.ms.kr",
    "2630001@yongshin-ms.ms.kr.attacker.test", "2630001@example.com", " 2630001@yongshin-ms.ms.kr"])
    assert.throws(() => core.assertRegistrationEmail(email, policy), reason("STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED"));
  const future = core.normalizePolicy({ schemaVersion: 1, admissionYear: "2027", admissionGrade: "2", revision: 1 });
  assert.equal(core.matchesPolicy("2720001@yongshin-ms.ms.kr", future), true);
  assert.equal(core.matchesPolicy("2630001@yongshin-ms.ms.kr", future), false);
  for (const value of [{}, { schemaVersion: 1, admissionYear: 2027, admissionGrade: "2", revision: 1 },
    { schemaVersion: 1, admissionYear: "2027", admissionGrade: "4", revision: 1 },
    { schemaVersion: 1, admissionYear: "2027", admissionGrade: "2", revision: 0 }])
    assert.throws(() => core.normalizePolicy(value), reason("STUDENT_REGISTRATION_POLICY_INVALID"));
});
test("existing approvals/legacy teacher and student profiles retain access; pending and unknown roles do not", () => {
  for (const role of ["student", "teacher", "staff"]) {
    assert.equal(core.isEstablishedProfile({ role }), true);
    assert.equal(core.isEstablishedProfile({ role, registrationApprovalStatus: "APPROVED" }), true);
    for (const registrationApprovalStatus of ["PENDING", "APPROVED_PENDING_ACCOUNT", "REJECTED", null])
      assert.equal(core.isEstablishedProfile({ role, registrationApprovalStatus }), false);
  }
  assert.ok(!core.isEstablishedProfile(null));
  assert.equal(core.isEstablishedProfile({ role: "admin" }), false);
});
test("policy reads work before session, while writes require a recent teacher/admin session and exact input", async () => {
  const f = fixture();
  assert.equal((await f.handlers.getStudentRegistrationPolicy(f.request({}, "student"))).revision, 0);
  assert.equal(f.sessions.length, 0);
  await assert.rejects(() => f.handlers.getStudentRegistrationPolicy({ auth: { uid: "outside", token: { email: "outside@example.com" } }, data: {} }));
  const data = { admissionYear: "2027", admissionGrade: "2", expectedRevision: 0 };
  for (const uid of ["student", "staff", "missing"]) await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request(data, uid)), reason("STUDENT_REGISTRATION_POLICY_MANAGER_REQUIRED"));
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy({ ...f.request(data), expired: true }), error => error.code === "unauthenticated");
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request({ ...data, admissionYear: 2027 })), reason("STUDENT_REGISTRATION_POLICY_INPUT_INVALID"));
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request({ ...data, arbitrary: true })), reason("STUDENT_REGISTRATION_POLICY_INPUT_INVALID"));
  assert.equal(f.writes(), 0);
  const saved = await f.handlers.saveStudentRegistrationPolicy(f.request(data));
  assert.equal(saved.revision, 1); assert.equal(saved.emailPatternLabel, "272NNNN@yongshin-ms.ms.kr");
  assert.ok(f.sessions.every(options => options.recentAuth && options.highRisk));
  assert.equal(f.documents.get("users/student").registrationApprovalStatus, "APPROVED");
});
test("lost acknowledgements and concurrent saves cannot double-increment or overwrite a newer policy", async () => {
  const f = fixture(), data = { admissionYear: "2027", admissionGrade: "2", expectedRevision: 0 };
  const results = await Promise.all([f.handlers.saveStudentRegistrationPolicy(f.request(data)), f.handlers.saveStudentRegistrationPolicy(f.request(data))]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.writes(), 1);
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request({ ...data, admissionGrade: "1" })), reason("STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT"));
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request(data, "admin")), reason("STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT"));
  const next = await f.handlers.saveStudentRegistrationPolicy(f.request({ ...data, admissionGrade: "1", expectedRevision: 1 }, "admin"));
  assert.equal(next.revision, 2);
  await assert.rejects(() => f.handlers.saveStudentRegistrationPolicy(f.request(data)), reason("STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT"));
  assert.equal(f.writes(), 2);
});
test("login and canonical approval use the identical reviewed policy module", () => {
  assert.equal(readFileSync(resolve(__dirname, "../studentRegistrationPolicyCore.js"), "utf8").replace(/\r\n/g, "\n"),
    readFileSync(resolve(__dirname, "../productionGateway/studentRegistrationPolicyCore.js"), "utf8").replace(/\r\n/g, "\n"));
});
