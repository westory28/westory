const assert = require("node:assert/strict");
const { createTeacherSemesterOptionsCore } = require("../teacherSemesterOptions");

const request = (uid = "teacher", data = {}) => ({
  app: { appId: "test" }, auth: { uid, token: { email: uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr` } }, data,
});
const make = (overrides = {}, identity = async req => ({ uid: req.auth?.uid, email: req.auth?.token.email })) => {
  const log = [];
  const documents = {
    "users/teacher": { role: "teacher" }, "users/student": { role: "student" },
    "users/staff": { role: "staff", teacherPortalEnabled: true, staffPermissions: ["lesson_read"] },
    "users/pending": { role: "teacher", registrationApprovalStatus: "PENDING" },
    "site_settings/config": { year: "2026", semester: "2", availableSemesters: [
      { year: "2025", semester: "2", createdBy: "private-owner" },
      { year: "wrong", semester: "1" }, { year: "2026", semester: "3" },
    ] },
    ...overrides.documents,
  };
  const manifests = overrides.manifests ?? [{ path: "semester_manifests/2026-2" }, { path: "semester_manifests/2024-1" }];
  const paths = overrides.paths ?? {
    years: ["years/2026", "years/2025", "years/invalid", "years/9999"],
    "years/2026/semesters": ["years/2026/semesters/1", "years/2026/semesters/2"],
    "years/2025/semesters": ["years/2025/semesters/1"],
  };
  // This store intentionally has no writes and no semester parent documents.
  const store = {
    get: async path => { log.push(path); return { exists: path in documents, data: documents[path], path }; },
    listManifests: async () => { log.push("manifests"); return manifests; },
    listDocumentPaths: async path => { log.push(path); return paths[path] || []; },
    hasDocuments: async path => { log.push(`legacy:${path}`); return overrides.legacy === path; },
  };
  return { core: createTeacherSemesterOptionsCore({ store, assertSession: identity }), log, documents };
};

(async () => {
  const test = make();
  const before = JSON.stringify(test.documents);
  const result = await test.core.getTeacherSemesterOptions(request());
  assert.deepEqual(result.semesters.map(row => `${row.year}-${row.semester}`), ["2026-2", "2026-1", "2025-2", "2025-1", "2024-1"]);
  assert.equal(JSON.stringify(test.documents), before);
  assert.ok(!JSON.stringify(result).includes("private-owner"));
  assert.deepEqual(Object.keys(result.semesters[0]), ["year", "semester", "label"]);
  assert.equal(result.semesters[0].label, "2026학년도 2학기");
  assert.ok(!test.log.includes("years/9999/semesters"));
  for (const uid of ["student", "staff", "pending", "unknown"]) {
    const denied = make();
    await assert.rejects(() => denied.core.getTeacherSemesterOptions(request(uid)), error => error.code === "permission-denied");
    assert.deepEqual(denied.log, [`users/${uid}`], "unauthorized roles cannot enumerate semesters");
  }
  const admin = make();
  assert.deepEqual(await admin.core.getTeacherSemesterOptions(request("admin")), result);
  assert.ok(!admin.log.includes("users/admin"));
  const noApp = request(); delete noApp.app;
  const denied = make();
  await assert.rejects(() => denied.core.getTeacherSemesterOptions(noApp), error => error.code === "unauthenticated");
  assert.deepEqual(denied.log, []);
  const wrongActor = make({}, async () => ({ uid: "different", email: "teacher@yongshin-ms.ms.kr" }));
  await assert.rejects(() => wrongActor.core.getTeacherSemesterOptions(request()), error => error.code === "permission-denied");
  assert.deepEqual(wrongActor.log, []);
  const expired = make({}, async () => { throw Object.assign(new Error("expired"), { code: "unauthenticated" }); });
  await assert.rejects(() => expired.core.getTeacherSemesterOptions(request()), error => error.code === "unauthenticated");
  assert.deepEqual(expired.log, []);
  await assert.rejects(() => make().core.getTeacherSemesterOptions(request("teacher", { path: "users" })), error => error.code === "invalid-argument");
  const blank = { paths: {}, manifests: [], documents: { "site_settings/config": {} } };
  assert.deepEqual(await make(blank).core.getTeacherSemesterOptions(request()), { semesters: [] }, "never synthesize a semester without stored evidence");
  assert.deepEqual(await make({ ...blank, legacy: "lessons" }).core.getTeacherSemesterOptions(request()), {
    semesters: [{ year: "2026", semester: "1", label: "2026학년도 1학기" }],
  });
  console.log(JSON.stringify({ passed: true, discoveredWithoutParentDocuments: true, deniedRoles: 4, writes: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
