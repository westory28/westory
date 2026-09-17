const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");

// Run the actual deployed query callback against a read-only Firestore double.
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const start = source.indexOf("exports.listStudentHistoryDictionaryWordsForTeacher = onCall(");
const end = source.indexOf("const updateStudentHistoryDictionaryWordByTeacherOperation", start);
assert.ok(start > 0 && end > start);
const rawRows = [
  ["years/2026/semesters/1/dictionary_students/old-student/history_dictionary_words/one", { year: "2026", semester: "1", uid: "old-student", word: "고려", definition: "과거 뜻풀이", definitionSource: "student", status: "saved", studentName: "과거 이름" }],
  ["years/2026/semesters/2/dictionary_students/old-student/history_dictionary_words/new", { year: "2026", semester: "2", uid: "old-student", word: "현재 단어", definition: "현재 뜻풀이", definitionSource: "student", status: "saved" }],
  ["users/retired/history_dictionary_words/legacy", { year: "2026", semester: "1", uid: "retired", word: "조선", definition: "기존 뜻풀이", definitionSource: "student", status: "saved" }],
  ["unrelated/anything/history_dictionary_words/no", { year: "2026", semester: "1", word: "잘못된 경로", definitionSource: "student", status: "saved" }],
];
const make = (role, failedSession = false) => {
  const reads = [], filters = [];
  let cap = 0;
  const query = {
    where: (field, op, value) => { assert.equal(op, "=="); filters.push([field, value]); return query; },
    limit: value => { cap = value; return query; },
    get: async () => {
      reads.push("words");
      const docs = rawRows.filter(([, data]) => filters.every(([key, value]) => data[key] === value))
        .slice(0, cap).map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data,
          ref: { path, parent: { parent: { id: path.split("/").at(-3) } } } }));
      return { docs, size: docs.length };
    },
  };
  const sandbox = {
    exports: {}, onCall: (_options, handler) => handler, REGION: "test", HttpsError, ADMIN_EMAIL: "westoria28@gmail.com",
    assertHistoryDictionaryManager: async () => {
      if (failedSession || role === "student") throw new HttpsError("permission-denied", "not authorized");
      return { email: role === "admin" ? "westoria28@gmail.com" : "teacher@yongshin-ms.ms.kr", profile: { role } };
    },
    assertYearSemester: data => ({ year: data.year, semester: data.semester }),
    db: {
      doc: path => path,
      getAll: async (...paths) => paths.map(path => {
        reads.push(path);
        const data = path === "site_settings/semester_active" ? { semesterId: "2026-2", revision: 1 }
          : path.endsWith("2026-2") ? { semesterId: "2026-2", revision: 1, status: "ACTIVE" }
          : null;
        return { exists: Boolean(data), data: () => data };
      }),
      collectionGroup: name => { assert.equal(name, "history_dictionary_words"); return query; },
    },
    sanitizeHistoryDictionaryText: (value, limit) => String(value || "").slice(0, limit),
    sanitizeHistoryDictionaryWord: value => String(value || ""),
    normalizeHistoryDictionaryWord: value => String(value || "").toLowerCase(),
    sanitizeHistoryDictionaryTags: value => Array.isArray(value) ? value : [],
    historyDictionaryCommands: require("../historyDictionaryCommands"),
  };
  runInNewContext(source.slice(start, end), sandbox);
  return { read: sandbox.exports.listStudentHistoryDictionaryWordsForTeacher, reads };
};
(async () => {
  const historical = { data: { year: "2026", semester: "1" } };
  for (const role of ["teacher", "admin"]) {
    const fixture = make(role);
    const result = await fixture.read(historical);
    assert.equal(result.words.length, 1);
    assert.equal(result.words.find(row => row.word === "고려").studentName, "과거 이름");
    assert.ok(!JSON.stringify(result).includes("현재 단어"));
    assert.ok(!fixture.reads.some(path => path.startsWith("users/")), "never replace stored names with current profiles");
  }
  const staff = make("staff");
  await assert.rejects(() => staff.read(historical), error => error.code === "permission-denied");
  assert.ok(!staff.reads.includes("words"));
  assert.equal((await make("staff").read({ data: { year: "2026", semester: "2" } })).words.length, 1);
  for (const fixture of [make("student"), make("teacher", true)]) {
    await assert.rejects(() => fixture.read(historical), error => error.code === "permission-denied");
    assert.equal(fixture.reads.length, 0);
  }
  console.log(JSON.stringify({ teacherDictionaryHistoricalRead: true, currentStaffPolicyPreserved: true, scopeIsolation: true, writes: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
