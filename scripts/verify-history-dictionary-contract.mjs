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
      return { empty: false, docs: [snapshot(`${ref.path}/${snapshotId}`)] };
    },
    onSnapshot: (ref, next) => {
      assert.ok(ready);
      subscriptions.push(ref);
      next({ docs: [snapshot(`${ref.path}/${snapshotId}`)] });
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
