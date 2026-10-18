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
const oldRoot = "years/2026/semesters/1";
const auth = { currentUser: { uid: "student-1" } };
let epoch = "2026-10-18T00:00:00Z";
let responder = async () => ({ items: [], nextCursor: "" });
const calls = [],
  reads = [],
  listeners = [];
const snapshot = (path, data) => ({
  id: path.split("/").at(-1),
  ref: { path },
  data: () => data,
  exists: () => data !== null,
});
const modules = {
  "firebase/auth": { getIdTokenResult: async () => ({ authTime: epoch }) },
  "./firebase": { auth, db: {} },
  "./semesterScope": {
    getSemesterCollectionPath: (config, name) =>
      `years/${config.year}/semesters/${config.semester}/${name}`,
  },
  "./historyDictionarySession": {
    ensureHistoryDictionarySession: async () => {},
    getHistoryDictionaryCallable: async (name) => async (input) => {
      calls.push({ name, input });
      return {
        data:
          name === "getHistoryDictionaryContinuity"
            ? await responder(input)
            : { status: "SUCCEEDED", result: {} },
      };
    },
  },
  "firebase/firestore": {
    collection: (_, path) => ({ path }),
    doc: (_, path) => ({ path }),
    documentId: () => "__name__",
    query: (ref) => ref,
    where: (...args) => args,
    limit: (n) => n,
    getDocFromServer: async ({ path }) => {
      reads.push(path);
      return snapshot(
        path,
        path.includes("history_dictionary_words")
          ? null
          : { updatedAt: { seconds: 90, nanoseconds: 0 } },
      );
    },
    getDocs: async () => ({ docs: [] }),
    onSnapshot: (ref, next, error) => {
      const listener = { ...ref, next, error, stopped: false };
      listeners.push(listener);
      return () => {
        listener.stopped = true;
      };
    },
  },
};
const api = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports: api,
    require: (name) => {
      assert.ok(modules[name], name);
      return modules[name];
    },
    crypto: webcrypto,
    TextEncoder,
    console,
  },
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};
const term = (
  word,
  semester,
  version = "7:2",
  updatedAtMs = 1000,
  year = "2026",
) => {
  const id = `term_${createHash("sha1").update(word).digest("hex")}`;
  return {
    id,
    word,
    normalizedWord: word,
    definition: `${word}의 역사 풀이입니다.`,
    status: "published",
    sourcePath: `years/${year}/semesters/${semester}/history_dictionary_terms/${id}`,
    sourceYear: year,
    sourceSemester: semester,
    writeVersion: version,
    updatedAtMs,
  };
};
const old = term("조선", "1");
const current = term("조선", "2", "8:0");
const legacy = term("조선", "2", "99:0", 9000, "2025");
const unique = term("고려", "1");
responder = async (input) =>
  input.after
    ? { items: [current, unique], nextCursor: "" }
    : { items: [legacy, old], nextCursor: "page-2" };
const terms = await api.loadTeacherHistoryDictionaryTerms(scope);
assert.equal(terms.length, 2);
assert.equal(
  terms.find((item) => item.word === "조선").sourcePath,
  current.sourcePath,
  "current semester wins even over a more recently edited archive",
);
assert.equal(terms.find((item) => item.word === "고려").readOnly, true);
assert.equal(calls.at(-1).input.after, "page-2");
const prior = api.mergeHistoryDictionaryContinuity([legacy, old], scope);
assert.equal(
  prior[0].sourcePath,
  old.sourcePath,
  "newer source semester wins over older edit timestamp",
);

// Current snapshots remain authoritative; removing a current duplicate reveals its archive.
const pending = deferred();
responder = () => pending.promise;
const emitted = [];
const stop = api.subscribeTeacherHistoryDictionaryTerms(
  (items) => emitted.push(items),
  undefined,
  scope,
);
await tick();
listeners.at(-1).next({
  docs: [
    snapshot(current.sourcePath, {
      ...current,
      definition: "실시간 최신 풀이",
      updatedAt: { seconds: 12, nanoseconds: 0 },
    }),
  ],
});
assert.equal(
  emitted.length,
  0,
  "do not report incomplete archive loading as success",
);
pending.resolve({ items: [old, current, unique], nextCursor: "" });
await tick();
assert.equal(
  emitted.at(-1).find((item) => item.word === "조선").definition,
  "실시간 최신 풀이",
);
listeners.at(-1).next({ docs: [] });
assert.equal(
  emitted.at(-1).find((item) => item.word === "조선").sourcePath,
  old.sourcePath,
);
assert.equal(
  emitted.at(-1).find((item) => item.word === "조선").readOnly,
  true,
);
stop();
const countAfterStop = emitted.length;
listeners.at(-1).next({ docs: [] });
assert.equal(
  emitted.length,
  countAfterStop,
  "late snapshot after unsubscribe cannot update the screen",
);

// Cancelled or replaced accounts must not publish or cache their late responses.
const cancelled = deferred();
responder = () => cancelled.promise;
let late = 0;
const cancel = api.subscribeStudentHistoryDictionaryWords(
  "student-1",
  () => late++,
  scope,
  () => late++,
);
await tick();
listeners.at(-1).next({ docs: [] });
cancel();
cancelled.resolve({ items: [old], nextCursor: "" });
await tick();
assert.equal(late, 0);
const switched = deferred();
responder = () => switched.promise;
const oldAccount = api.loadTeacherHistoryDictionaryTerms(scope);
await tick();
auth.currentUser = { uid: "student-1" };
switched.resolve({ items: [old], nextCursor: "" });
await assert.rejects(oldAccount, /로그인 또는 학기/);
const renewed = deferred();
responder = () => renewed.promise;
const oldEpoch = api.loadTeacherHistoryDictionaryTerms(scope);
await tick();
epoch = "2026-10-18T01:00:00Z";
renewed.resolve({ items: [old], nextCursor: "" });
await assert.rejects(oldEpoch, /로그인 또는 학기/);

// Historical source CAS must never be cached at the current semester's destination.
responder = async () => ({ items: [old], nextCursor: "" });
const publicTerm = await api.loadPublishedHistoryDictionaryTerm("조선", scope);
assert.equal(publicTerm.sourceSemester, "1");
assert.equal(publicTerm.readOnly, true);
await api.saveStudentHistoryDictionaryWord(old.id, scope, publicTerm);
const saved = calls.at(-1).input.payload;
assert.equal(saved.expectedTermVersion, "7:2");
assert.equal(saved.expectedWordVersion, null);
assert.equal(saved.year, "2026");
assert.equal(saved.semester, "2");
assert.equal(saved.sourceYear, "2026");
assert.equal(saved.sourceSemester, "1");
assert.ok(
  reads.includes(
    `${root}/dictionary_students/student-1/history_dictionary_words/${old.id}`,
  ),
);
assert.ok(
  !reads.includes(old.sourcePath),
  "archive version is already known at its original path",
);
await api.saveHistoryDictionaryTerm(scope, {
  word: "조선",
  definition: "현재 학기 공식 풀이입니다.",
  studentLevel: "중학생",
});
assert.equal(calls.at(-1).input.payload.expectedTermVersion, "90:0");
assert.ok(reads.includes(`${root}/history_dictionary_terms/${old.id}`));

const studentWord = (uid, semester) => ({
  ...old,
  uid,
  termId: old.id,
  id: `${uid}:${old.id}`,
  status: "saved",
  sourcePath: `years/2026/semesters/${semester}/dictionary_students/${uid}/history_dictionary_words/${old.id}`,
});
responder = async () => ({
  items: [
    studentWord("student-1", "1"),
    studentWord("student-1", "2"),
    studentWord("student-2", "1"),
  ],
  nextCursor: "",
});
const students = await api.loadTeacherStudentHistoryDictionaryWords(scope);
assert.equal(
  students.length,
  2,
  "deduplicate per student, not across students",
);
assert.equal(students.find((item) => item.uid === "student-1").readOnly, false);
assert.equal(students.find((item) => item.uid === "student-2").readOnly, true);

const catalogItem = {
  id: "db-only",
  word: "추가 자료",
  definition: "데이터베이스에만 등록한 풀이",
  kind: "history",
  attributions: [{ title: "학교 자료" }],
};
const legacyTerm = {
  ...old,
  word: "발해",
  normalizedWord: "발해",
  sourcePath: "history_dictionary_terms/old",
  sourceYear: "2025",
  sourceSemester: "2",
  readOnly: false,
};
responder = async () => ({ items: [legacyTerm, old], nextCursor: "" });
const withLegacy = await api.loadTeacherHistoryDictionaryTerms(scope);
assert.equal(
  withLegacy.length,
  2,
  "legacy records cannot make the canonical list fail",
);
assert.equal(
  withLegacy.find((item) => item.word === "발해").readOnly,
  true,
  "legacy records are always read only",
);
assert.equal(api.canSaveHistoryDictionaryTermToNotebook(legacyTerm), false);
assert.equal(api.canSaveHistoryDictionaryTermToNotebook(old), true);
await assert.rejects(
  api.saveStudentHistoryDictionaryWord(legacyTerm.id, scope, legacyTerm),
  /이전 저장 방식/,
);
responder = async () => ({
  items: [
    {
      ...studentWord("student-1", "1"),
      sourcePath: "users/student-1/history_dictionary_words/old",
      sourceYear: "2025",
      sourceSemester: "1",
    },
  ],
  nextCursor: "",
});
assert.equal(
  (await api.loadTeacherStudentHistoryDictionaryWords(scope))[0].readOnly,
  true,
);
responder = async () => ({
  items: [{ ...legacyTerm, sourceYear: "" }],
  nextCursor: "",
});
await assert.rejects(api.loadTeacherHistoryDictionaryTerms(scope), /학기/);
responder = async () => ({
  items: [{ ...legacyTerm, sourcePath: "users/student-1/private/old" }],
  nextCursor: "",
});
await assert.rejects(api.loadTeacherHistoryDictionaryTerms(scope), /저장 위치/);
responder = async () => {
  throw new Error("unavailable");
};
await assert.rejects(api.loadHistoryDictionaryCatalog(scope), /unavailable/);
responder = async () => ({ items: [catalogItem], nextCursor: "" });
assert.equal(
  (await api.loadHistoryDictionaryCatalog(scope))[0].id,
  "db-only",
  "retry returns the actual database content",
);
responder = async () => ({ words: [], nextCursor: "" });
await assert.rejects(api.loadHistoryDictionaryCatalog(scope), /사전 자료/);
assert.ok(
  !source.includes("getHistoryDictionaryCatalog()"),
  "failed Firebase reads must not silently use static content",
);
console.log(
  "history dictionary continuity checks passed (pagination, precedence, live merge, source CAS, cancellation, account epoch, retry)",
);
