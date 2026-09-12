const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const start = source.indexOf("exports.listStudentHistoryDictionaryWordsForTeacher =");
const end = source.indexOf("const updateStudentHistoryDictionaryWordByTeacherOperation =", start);
let scope = "2026-2", queries = 0;
const row = (path, data) => ({ id: path.split("/").at(-1), ref: { path, parent: { parent: { id: path.split("/").at(-3) } } }, data: () => data });
const values = [
  row("years/2026/semesters/2/dictionary_students/a/history_dictionary_words/term", { uid: "a", year: "2026", semester: "2", word: "현재", definition: "현재 풀이", status: "saved", definitionSource: "student" }),
  row("years/2026/semesters/1/dictionary_students/a/history_dictionary_words/term", { uid: "a", year: "2026", semester: "1", word: "과거", status: "saved", definitionSource: "student" }),
  row("users/a/history_dictionary_words/legacy", { uid: "a", year: "2026", semester: "2", word: "공용", status: "saved", definitionSource: "student" }),
];
const exportsUnderTest = {};
const db = {
  doc: path => ({ path }),
  getAll: async (...refs) => refs.map(ref => ({ exists: true, data: () => ref.path === "site_settings/semester_active" ? { semesterId: scope, revision: 3 } : { semesterId: "2026-2", revision: 3, status: "ACTIVE" } })),
  collectionGroup: name => {
    assert.equal(name, "history_dictionary_words");
    const filters = [];
    const query = { where: (field, op, value) => { filters.push([field, op, value]); return query; }, limit: value => { assert.equal(value, 501); return query; }, get: async () => {
      queries++;
      assert.deepEqual(filters, [["year", "==", "2026"], ["semester", "==", "2"], ["status", "==", "saved"]]);
      const docs = values.filter(doc => filters.every(([field, , value]) => doc.data()[field] === value));
      return { docs, size: docs.length };
    } };
    return query;
  },
};
runInNewContext(source.slice(start, end), {
  exports: exportsUnderTest, db, HttpsError, REGION: "test", onCall: (_, handler) => handler,
  assertHistoryDictionaryManager: async request => { if (request.auth?.uid !== "teacher") throw new HttpsError("permission-denied", "teacher required"); },
  assertYearSemester: value => value,
  sanitizeHistoryDictionaryText: value => String(value || ""),
  sanitizeHistoryDictionaryWord: value => String(value || ""),
  normalizeHistoryDictionaryWord: value => String(value || "").toLowerCase(),
  sanitizeHistoryDictionaryTags: value => value || [],
  historyDictionaryCommands: require("../historyDictionaryCommands"),
});
(async () => {
  const request = { auth: { uid: "teacher" }, data: { year: "2026", semester: "2" } };
  const result = await exportsUnderTest.listStudentHistoryDictionaryWordsForTeacher(request);
  assert.equal(result.words.length, 1);
  assert.equal(result.words[0].word, "현재");
  assert.equal(queries, 1);
  await assert.rejects(exportsUnderTest.listStudentHistoryDictionaryWordsForTeacher({ ...request, auth: { uid: "student" } }), error => error.code === "permission-denied");
  scope = "2027-1";
  await assert.rejects(exportsUnderTest.listStudentHistoryDictionaryWordsForTeacher(request), error => error.code === "permission-denied");
  assert.equal(queries, 1, "Denied scope cannot reach the word query");
  console.log(JSON.stringify({ passed: true, checks: 6, queries: 1, userCollectionScans: 0, globalFallbackRows: 0, writes: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
