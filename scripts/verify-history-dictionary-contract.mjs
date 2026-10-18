import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(
  new URL("../src/lib/historyDictionary.ts", import.meta.url),
  "utf8",
);
const scope = { year: "2026", semester: "2" };
const root = "years/2026/semesters/2";
const reads = [],
  writes = [],
  subscriptions = [];
let ready = false,
  failure = false,
  stopped = 0,
  failWrite = false;
let writeConflict = false,
  switchDuringRead = false,
  snapshotId = "term_one";
let queryRows = null;
let teacherPages = [];
const fixture = {
  updatedAt: { seconds: 10, nanoseconds: 123 },
  word: "역사",
  status: "published",
};
const snapshot = (path, data = fixture) => ({
  id: path.split("/").at(-1),
  ref: { path },
  data: () => data,
  exists: () => true,
});
const auth = { currentUser: { uid: "teacher-1" } };
const modules = {
  "firebase/auth": {
    getIdTokenResult: async () => ({ authTime: "2026-09-27T00:00:00Z" }),
  },
  "./firebase": { auth, db: {} },
  "./semesterScope": {
    getSemesterCollectionPath: (config, name) =>
      `years/${config.year}/semesters/${config.semester}/${name}`,
  },
  "./historyDictionarySession": {
    ensureHistoryDictionarySession: async () => {
      if (failure) throw new Error("session failed");
      ready = true;
    },
    getHistoryDictionaryCallable: async (name) => async (input) => {
      writes.push({ name, input });
      if (
        name === "listStudentHistoryDictionaryWordsForTeacher" &&
        teacherPages.length
      )
        return { data: teacherPages.shift() };
      if (failWrite) throw new Error("network failure");
      if (writeConflict)
        throw {
          code: "functions/aborted",
          details: { reason: "HISTORY_DICTIONARY_VERSION_CONFLICT" },
        };
      return {
        data:
          name === "executeCommand"
            ? { status: "SUCCEEDED", result: { saved: true } }
            : { words: [] },
      };
    },
  },
  "firebase/firestore": {
    collection: (_, path) => ({ path }),
    doc: (_, path) => ({ path }),
    documentId: () => "__name__",
    where: (...args) => args,
    limit: (n) => ["limit", n],
    orderBy: (...args) => args,
    query: (ref, ...constraints) => ({ ...ref, constraints }),
    getDocFromServer: async (ref) => {
      assert.ok(ready);
      reads.push(ref);
      if (switchDuringRead) auth.currentUser = { uid: "other-user" };
      return snapshot(ref.path);
    },
    getDocs: async (ref) => {
      assert.ok(ready);
      reads.push(ref);
      if (ref.path.endsWith("history_dictionary_requests"))
        return { empty: true, docs: [] };
      return {
        empty: false,
        docs: queryRows || [snapshot(`${ref.path}/${snapshotId}`)],
      };
    },
    onSnapshot: (ref, next) => {
      assert.ok(ready);
      subscriptions.push(ref);
      next({ docs: queryRows || [snapshot(`${ref.path}/${snapshotId}`)] });
      return () => {
        stopped++;
      };
    },
  },
};
const exports = {};
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
vm.runInNewContext(code, {
  exports,
  require: (name) => {
    assert.ok(modules[name], name);
    return modules[name];
  },
  crypto: webcrypto,
  TextEncoder,
  console,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
await assert.rejects(exports.loadTeacherHistoryDictionaryTerms(null), /학기/);
assert.equal(reads.length, 0);
let terms;
const unsubscribe = exports.subscribeTeacherHistoryDictionaryTerms(
  (value) => {
    terms = value;
  },
  undefined,
  scope,
);
await tick();
assert.equal(terms.length, 1);
assert.equal(subscriptions[0].path, `${root}/history_dictionary_terms`);
unsubscribe();
assert.equal(stopped, 1);
const before = subscriptions.length;
exports.subscribeTeacherHistoryDictionaryRequests(() => {}, scope)();
await tick();
assert.equal(
  subscriptions.length,
  before,
  "unmount must cancel delayed subscription",
);
await exports.loadPublishedHistoryDictionaryTerm("역사", scope);
assert.equal(reads.at(-1).path, `${root}/history_dictionary_terms`);
await exports.saveHistoryDictionaryTerm(scope, {
  word: "역사",
  definition: "사전 설명입니다",
  studentLevel: "중학생",
});
let sent = writes.at(-1);
assert.equal(sent.name, "executeCommand");
assert.equal(sent.input.commandType, "saveHistoryDictionaryTerm");
assert.equal(sent.input.payload.expectedTermVersion, "10:123");
assert.equal(sent.input.payload.year, "2026");
assert.equal(sent.input.payload.semester, "2");
assert.match(sent.input.commandId, /^[a-f0-9-]{36}$/);
auth.currentUser.uid = "student-1";
await exports.requestHistoryDictionaryTerm(scope, {
  word: "역사",
  memo: "",
  warningAccepted: true,
});
sent = writes.at(-1);
assert.equal(sent.input.payload.expectedRequestVersion, null);
assert.equal(sent.input.payload.expectedWordVersion, "10:123");
assert.ok(
  reads.some(
    (read) =>
      read.path.endsWith("history_dictionary_requests") &&
      read.constraints.some(
        (value) => value[0] === "uid" && value[2] === "student-1",
      ),
  ),
  "missing request must be queried with owner constraint",
);
const input = {
  word: "문화",
  definition: "학생이 쓴 풀이입니다",
  config: scope,
};
failWrite = true;
await assert.rejects(
  exports.saveStudentHistoryDictionaryEntry(input),
  /network/,
);
const failedId = writes.at(-1).input.commandId;
const failedPayload = JSON.stringify(writes.at(-1).input.payload);
fixture.updatedAt.seconds = 11;
snapshotId = `term_${createHash("sha1").update("문화").digest("hex")}`;
const stopWords = exports.subscribeStudentHistoryDictionaryWords(
  "student-1",
  () => {},
  scope,
);
await tick();
stopWords();
failWrite = false;
await exports.saveStudentHistoryDictionaryEntry(input);
assert.equal(
  writes.at(-1).input.commandId,
  failedId,
  "retry retains command identity",
);
assert.equal(
  JSON.stringify(writes.at(-1).input.payload),
  failedPayload,
  "retry retains original version despite snapshot update",
);
writeConflict = true;
const conflictInput = { ...input, word: "사회" };
await assert.rejects(
  exports.saveStudentHistoryDictionaryEntry(conflictInput),
  /새로고침/,
);
writeConflict = false;
const writeCount = writes.length;
await assert.rejects(
  exports.saveStudentHistoryDictionaryEntry(conflictInput),
  /새로고침/,
);
assert.equal(
  writes.length,
  writeCount,
  "conflict cannot silently retry against newer version",
);
switchDuringRead = true;
await assert.rejects(
  exports.saveStudentHistoryDictionaryEntry({ ...input, word: "경제" }),
  /로그인 상태가 변경/,
);
assert.equal(
  writes.length,
  writeCount,
  "account change cannot send old user's command",
);
switchDuringRead = false;
// The searchable list is complete, including old entries without updatedAt.
queryRows = Array.from({ length: 605 }, (_, index) =>
  snapshot(`${root}/history_dictionary_terms/term_${index}`, {
    word: `단어 ${index}`,
    createdAt: { seconds: index + 1, nanoseconds: 0 },
  }),
);
const completeTerms = await exports.loadTeacherHistoryDictionaryTerms(scope);
assert.equal(completeTerms.length, 605);
assert.equal(completeTerms[0].word, "단어 604");
assert.equal(
  reads.at(-1).constraints.length,
  0,
  "Do not omit older or undated documents with an orderBy/limit query",
);
let completeWords;
const stopAllWords = exports.subscribeStudentHistoryDictionaryWords(
  "other-user",
  (value) => {
    completeWords = value;
  },
  scope,
);
await tick();
stopAllWords();
assert.equal(completeWords.length, 605);
assert.equal(subscriptions.at(-1).constraints.length, 0);
queryRows = null;
teacherPages = [
  {
    words: [
      {
        id: "student:one",
        uid: "student",
        termId: "one",
        word: "첫째",
        updatedAtMs: 1000,
        writeVersion: "1:0",
      },
    ],
    nextCursor: "page-1",
  },
  {
    words: [
      {
        id: "student:two",
        uid: "student",
        termId: "two",
        word: "둘째",
        updatedAtMs: 2000,
        writeVersion: "2:0",
      },
    ],
    nextCursor: "",
  },
];
const teacherWords =
  await exports.loadTeacherStudentHistoryDictionaryWords(scope);
assert.equal(teacherWords.length, 2);
assert.equal(teacherWords[0].word, "둘째");
assert.equal(writes.at(-1).input.after, "page-1");
teacherPages = [
  { words: [], nextCursor: "same" },
  { words: [], nextCursor: "same" },
];
await assert.rejects(
  exports.loadTeacherStudentHistoryDictionaryWords(scope),
  /조회가 중단/,
);
let observed;
failure = true;
exports.subscribeStudentHistoryDictionaryWords(
  "student-1",
  () => {},
  scope,
  (error) => {
    observed = error;
  },
);
await tick();
assert.match(observed.message, /session failed/);
assert.ok(
  reads.every((read) => read.path.startsWith(root)),
  "all reads must stay inside selected semester",
);
assert.ok(!source.includes("collectionGroup"), "no global dictionary queries");
console.log("history dictionary contract checks passed");
