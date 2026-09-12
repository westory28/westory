const assert = require("node:assert/strict");
const { createAdminSemesterRecordsCore, normalizeQuery, projectRow } = require("../adminSemesterRecords");

class MemoryStore {
  constructor(entries) { this.documents = new Map(Object.entries(entries)); this.queries = []; this.reads = []; }
  async get(path) {
    this.reads.push(path);
    return { path, exists: this.documents.has(path), data: this.documents.get(path) };
  }
  async query(path, filter) {
    this.queries.push({ path, filter });
    assert.ok(filter.limit <= 51, "every query must have a hard read bound");
    return [...this.documents.entries()].filter(([key, data]) => key.startsWith(`${path}/`)
      && !key.slice(path.length + 1).includes("/")
      && (!filter.field || data[filter.field] === filter.value)
      && (!filter.startAfterId || key.slice(path.length + 1) > filter.startAfterId))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .slice(0, filter.limit).map(([key, data]) => ({ exists: true, path: key, data }));
  }
}
const root = "years/2026/semesters/1";
const seed = {
  "semester_manifests/2026-1": { semesterId: "2026-1", status: "CLOSED" },
  "semester_manifests/2025-2": { semesterId: "2025-2", status: "ARCHIVED" },
  "site_settings/semester_active": { semesterId: "2026-2" },
  "site_settings/config": { activeSemesterId: "2026-2", year: "2026", semester: "2" },
  [`${root}/point_wallets/u1`]: { uid: "u1", studentName: "보관 이름", grade: "3", class: "9", number: "26", balance: 450 },
  [`${root}/point_wallets/old-account`]: { uid: "old-account", studentName: "이전 계정", balance: 25 },
  "users/u1": { name: "현재 이름", email: "private@example.com", class: "10" },
  [`${root}/point_transactions/a`]: { uid: "u1", sourceLabel: "<script>alert(1)</script>", delta: 50, balanceAfter: 450, email: "private@example.com" },
  [`${root}/point_transactions/b`]: { uid: "u2", delta: 10 },
  [`${root}/point_transactions/c`]: { uid: "u1", delta: -20 },
  "users/u1/performance_scores/a": { academicYear: "2026", semester: "2", uid: "u1", title: "현재 성적", totalScore: 90 },
  "users/u1/performance_scores/b": { academicYear: "2026", semester: "1", uid: "u1", title: "보관 성적", totalScore: 75,
    totalMaxScore: 100, items: [{ name: "항목", score: 75, maxScore: 100 }], feedback: "<b>피드백</b>", signatureImage: "private-signature", uploadedByEmail: "private@example.com" },
  "users/u1/performance_scores/c": { academicYear: "2026", semester: "1", uid: "other-user", title: "잘못 연결된 성적" },
};
const request = (data = {}, email = "westoria28@gmail.com") => ({
  app: { appId: "verified-app" }, auth: { uid: "admin", token: { email } },
  data: { semesterId: "2026-1", recordType: "wis_transactions", pageSize: 2, ...data },
});
const make = (entries = seed, session = async (req) => ({ uid: req.auth?.uid, email: req.auth?.token.email })) => {
  const store = new MemoryStore(entries);
  const core = createAdminSemesterRecordsCore({ store, assertSession: session });
  return { store, read: core.getAdminSemesterLegacyRecords };
};
const rejects = async (action, code) => assert.rejects(action, (error) => error.code === code);

(async () => {
  for (const email of ["student@yongshin-ms.ms.kr", "staff@yongshin-ms.ms.kr", "teacher@example.com"]) {
    const test = make();
    await rejects(() => test.read(request({}, email)), "permission-denied");
    assert.equal(test.store.reads.length, 0);
  }
  const noAuth = request(); delete noAuth.auth;
  await rejects(() => make().read(noAuth), "permission-denied");
  const noApp = request(); delete noApp.app;
  await rejects(() => make().read(noApp), "unauthenticated");
  const expired = make(seed, async () => { const error = new Error("SESSION_EXPIRED"); error.code = "unauthenticated"; throw error; });
  await rejects(() => expired.read(request()), "unauthenticated");
  assert.equal(expired.store.reads.length, 0);
  await rejects(() => make(seed, async () => ({ uid: "different", email: "westoria28@gmail.com" })).read(request()), "permission-denied");

  for (const data of [{ recordType: "users" }, { semesterId: "2026-1/../../users" }, { path: "users" },
    { studentUid: "../../users" }, { pageSize: 51 }, { pageSize: 0 }, { pageSize: 1.5 }, { cursor: "!bad" }, { recordType: "grades" }]) {
    await rejects(() => make().read(request(data)), "invalid-argument");
  }
  for (const status of ["ACTIVE", "CLOSING", "READY", "DRAFT"]) {
    const test = make({ ...seed, "semester_manifests/2026-1": { semesterId: "2026-1", status } });
    await rejects(() => test.read(request()), "failed-precondition");
    assert.equal(test.store.queries.length, 0);
  }
  for (const changed of [
    { "site_settings/semester_active": { semesterId: "2026-1" } },
    { "site_settings/config": { activeSemesterId: "2026-1", year: "2026", semester: "1" } },
    { "semester_manifests/2026-1": { semesterId: "2025-1", status: "CLOSED" } },
  ]) await rejects(() => make({ ...seed, ...changed }).read(request()), "failed-precondition");

  const test = make();
  const first = await test.read(request());
  assert.deepEqual(first.rows.map((row) => row.id), ["a", "b"]);
  assert.equal(first.rows[0].studentName, "보관 이름");
  assert.equal(first.rows[0].className, "9");
  assert.equal(first.rows[0].title, "<script>alert(1)</script>", "HTML stays text, not markup or executable code");
  assert.ok(!JSON.stringify(first).includes("private@example.com"));
  assert.equal(first.provenance, "LEGACY"); assert.equal(first.readOnly, true); assert.equal(first.hasMore, true);
  const second = await test.read(request({ cursor: first.nextCursor }));
  assert.deepEqual(second.rows.map((row) => row.id), ["c"]);
  assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  for (const change of [{ semesterId: "2025-2" }, { recordType: "wis_orders" }, { studentUid: "u1" }]) {
    await rejects(() => test.read(request({ ...change, cursor: first.nextCursor })), "invalid-argument");
  }
  const filtered = await test.read(request({ studentUid: "u1", pageSize: 1 }));
  assert.equal(filtered.rows[0].id, "a");
  assert.equal((await test.read(request({ studentUid: "u1", pageSize: 1, cursor: filtered.nextCursor }))).rows[0].id, "c");
  const grades = await test.read(request({ recordType: "grades", studentUid: "u1", pageSize: 1 }));
  assert.equal(grades.rows.length, 0); assert.equal(grades.hasMore, true);
  const gradePage = await test.read(request({ recordType: "grades", studentUid: "u1", pageSize: 2, cursor: grades.nextCursor }));
  assert.equal(gradePage.rows.length, 1); assert.equal(gradePage.rows[0].score, 75);
  assert.match(gradePage.rows[0].detail, /항목: 75\/100/);
  assert.ok(!JSON.stringify(gradePage).includes("private-signature"));
  assert.ok(!JSON.stringify(gradePage).includes("현재 성적"));
  const students = await test.read(request({ recordType: "grade_students", pageSize: 50 }));
  assert.ok(students.rows.some((row) => row.studentUid === "old-account"), "retired accounts remain accessible");
  assert.ok(!test.store.reads.includes("users/u1"), "never substitute current profile for historical name/class");

  const reopened = make();
  const originalQuery = reopened.store.query.bind(reopened.store);
  reopened.store.query = async (...args) => {
    const result = await originalQuery(...args);
    reopened.store.documents.set("semester_manifests/2026-1", { semesterId: "2026-1", status: "ACTIVE" });
    return result;
  };
  await rejects(() => reopened.read(request()), "failed-precondition");
  assert.equal(normalizeQuery(request().data).pageSize, 2);
  const history = projectRow({ path: `${root}/history_classroom_results/a`, data: {
    percent: 88, score: 22, total: 25, assignmentTitle: "역사 수업", passed: true,
    studentGrade: "3", studentClass: "9", studentNumber: "26",
    createdAt: { toMillis: () => Date.parse("2026-04-27T03:00:00Z") },
  } }, "history_results");
  assert.equal(history.score, 88); assert.equal(history.maxScore, 100);
  assert.equal(history.title, "역사 수업"); assert.equal(history.grade, "3");
  assert.equal(history.className, "9"); assert.equal(history.number, "26");
  assert.equal(history.occurredAt, "2026-04-27T03:00:00.000Z");
  assert.equal(history.detail, "정답 22/25");
  const historyWithoutPercent = projectRow({ path: "history/a", data: { score: 22, total: 25 } }, "history_results");
  assert.equal(historyWithoutPercent.score, 22); assert.equal(historyWithoutPercent.maxScore, 25);
  const quiz = projectRow({ path: "quiz/a", data: { score: 75, unitId: "단원", gradeClass: "3학년 9반 26번",
    details: [{ correct: true }, { correct: true }, { correct: false }, { correct: true }] } }, "quiz_results");
  assert.equal(quiz.score, 75); assert.equal(quiz.maxScore, 100); assert.equal(quiz.grade, "3");
  assert.equal(quiz.detail, "정답 3/4");
  console.log("PASS admin semester records: administrator/session/App Check gates, closed scope, bounded pagination, cursor isolation, historical identity, text-only projections, legacy grade scope and zero mutations.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
