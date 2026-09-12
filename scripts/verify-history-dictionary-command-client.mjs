import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const files = [
  "src/lib/historyDictionary.ts",
  "src/pages/student/lesson/HistoryDictionary.tsx",
  "src/pages/teacher/ManageHistoryDictionary.tsx",
  "src/components/common/StudentHistoryDictionaryController.tsx",
];
let checks = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.equal(
    result.diagnostics.filter(
      (item) => item.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
    file,
  );
  checks++;
}
const source = readFileSync(files[0], "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const calls = [],
  reads = [];
const auth = { currentUser: { uid: "owner" } };
let failure = null,
  hold = null,
  listener;
class WestoryCommandError extends Error {
  constructor(retryable) {
    super("test command error");
    this.retryable = retryable;
  }
}
const firestore = {
  collection: (_db, path) => path,
  collectionGroup: (_db, path) => path,
  doc: (_db, path) => path,
  documentId: () => "__name__",
  where: (...args) => args,
  limit: (value) => value,
  orderBy: (...args) => args,
  query: (...args) => args,
  getDocs: async (query) => {
    reads.push(query);
    return { empty: true, docs: [] };
  },
  getDoc: async (path) => {
    reads.push(path);
    return {
      id: path.split("/").pop(),
      exists: () => true,
      data: () => ({ updatedAt: { seconds: 42, nanoseconds: 123456789 } }),
    };
  },
  onSnapshot: (_query, next) => {
    listener = next;
    return () => {};
  },
};
const gateway = {
  WestoryCommandError,
  hasPendingWestoryCommand: async () => Boolean(failure?.retryable),
  executeWestoryCommand: async (command, payload, options) => {
    calls.push({
      command,
      payload: JSON.parse(JSON.stringify(payload)),
      options,
    });
    if (hold) await hold;
    if (failure) throw failure;
    return {
      result: {
        termId: "term-result",
        saved: true,
        deleted: true,
        updated: true,
        reward: { awarded: true, amount: 1 },
      },
    };
  },
};
const exports = {};
vm.runInNewContext(code, {
  exports,
  console,
  TextEncoder,
  crypto: webcrypto,
  require(name) {
    if (name === "firebase/firestore") return firestore;
    if (name === "./firebase")
      return {
        auth,
        db: {},
        getHttpsCallable: async (name) => {
          assert.equal(
            name,
            "listStudentHistoryDictionaryWordsForTeacher",
            "Writes must use the gateway",
          );
          return async () => ({
            data: {
              words: [
                { id: "u:t", writeVersion: "42:123456789", updatedAtMs: 42000 },
              ],
            },
          });
        },
      };
    if (name === "./commandGateway") return gateway;
    if (name === "./semesterScope")
      return {
        getSemesterCollectionPath: (config, name) => `years/${config.year}/semesters/${config.semester}/${name}`,
        getYearSemester: (config) => ({
          year: config.year,
          semester: config.semester,
        }),
      };
    throw new Error(name);
  },
});
const api = exports,
  config = { year: "2026", semester: "2" },
  version = "42:123456789";
assert.equal(api.getHistoryDictionaryWriteVersion(null), null);
assert.equal(api.getHistoryDictionaryWriteVersion({}), "legacy");
assert.equal(
  api.getHistoryDictionaryWriteVersion({
    updatedAt: { seconds: 42, nanoseconds: 123456789 },
  }),
  version,
);
assert.equal(
  api.getHistoryDictionaryWriteVersion({
    writeVersion: version,
    updatedAt: { toMillis: () => 42000 },
  }),
  version,
);
checks += 4;
let observed;
api.subscribeStudentHistoryDictionaryWords(config, "owner", (values) => {
  observed = values;
});
listener({
  docs: [
    {
      id: "term",
      data: () => ({ updatedAt: { seconds: 42, nanoseconds: 123456789 } }),
    },
  ],
});
assert.equal(observed[0].writeVersion, version);
checks++;
assert.equal(
  (await api.loadTeacherStudentHistoryDictionaryWords(config))[0].writeVersion,
  version,
);
checks++;
await api.requestHistoryDictionaryTerm(
  config,
  {
    word: "단어",
    memo: "memo",
    warningAccepted: true,
    expectedWordVersion: version,
    expectedRequestVersion: null,
  },
  "owner",
);
await api.saveStudentHistoryDictionaryWord(
  config,
  { termId: "term", expectedWordVersion: null, expectedTermVersion: version },
  "owner",
);
await api.saveStudentHistoryDictionaryEntry(
  { config, word: "단어", definition: "정의", expectedWordVersion: version },
  "owner",
);
await api.deleteStudentHistoryDictionaryWord(config, "term", version, "owner");
await api.deleteStudentHistoryDictionaryWordByTeacher(
  config,
  {
    uid: "student",
    termId: "term",
    requestId: "request",
    expectedWordVersion: version,
    expectedRequestVersion: "legacy",
  },
  "owner",
);
await api.updateStudentHistoryDictionaryWordByTeacher(
  config,
  {
    uid: "student",
    termId: "term",
    word: "단어",
    definition: "정의",
    expectedWordVersion: version,
  },
  "owner",
);
await api.saveHistoryDictionaryTerm(
  config,
  {
    word: "단어",
    definition: "정의",
    studentLevel: "중학생",
    expectedTermVersion: version,
    expectedRequestVersion: null,
  },
  "owner",
);
await api.approveHistoryDictionaryTermForRequests(
  config,
  {
    termId: "term",
    requestId: "req",
    expectedTermVersion: version,
    expectedRequestVersion: "legacy",
  },
  "owner",
);
assert.equal(new Set(calls.map((item) => item.command)).size, 8);
const {
  normalizeHistoryDictionaryPayload,
} = require("../functions/historyDictionaryCommands.js");
for (const call of calls)
  assert.doesNotThrow(() =>
    normalizeHistoryDictionaryPayload(call.command, call.payload),
  );
checks++;
for (const call of calls) {
  assert.equal(call.options.expectedUid, "owner");
  assert.equal(call.payload.year, "2026");
  assert.equal(call.payload.semester, "2");
}
assert.equal(
  reads.length,
  0,
  "Observed word/term/request versions must not be replaced by fresh reads",
);
checks += 3;
await api.requestHistoryDictionaryTerm(
  config,
  {
    word: "단어",
    memo: "memo",
    warningAccepted: true,
    expectedWordVersion: version,
  },
  "owner",
);
assert.equal(reads.length, 1);
assert.equal(calls.at(-1).payload.expectedRequestVersion, null);
assert.equal(calls.at(-1).payload.expectedWordVersion, version);
checks++;
failure = new WestoryCommandError(true);
const original = {
  config,
  word: "보존",
  definition: "처음 풀이",
  expectedWordVersion: version,
};
await assert.rejects(api.saveStudentHistoryDictionaryEntry(original, "owner"));
assert.equal(api.hasPendingHistoryDictionaryMutation("owner"), true);
assert.equal(
  api.getPendingHistoryDictionaryDraft("owner", config).definition,
  "처음 풀이",
);
assert.equal(api.getPendingHistoryDictionaryDraft("other", config), null);
assert.equal(api.getPendingHistoryDictionaryDraft("owner", { year: "2026", semester: "1" }), null);
checks += 3;
original.definition = "바뀐 풀이";
original.expectedWordVersion = "999:0";
await assert.rejects(
  api.saveStudentHistoryDictionaryEntry(original, "owner"),
  /이전 요청/,
);
const first = calls.at(-1);
failure = null;
await api.retryHistoryDictionaryMutation("owner");
assert.deepEqual(
  calls.at(-1),
  first,
  "Retry must preserve original payload/CAS/owner",
);
assert.equal(api.hasPendingHistoryDictionaryMutation("owner"), false);
checks += 3;
let release;
hold = new Promise((resolve) => {
  release = resolve;
});
const flight = api.saveStudentHistoryDictionaryEntry(
  { config, word: "중복", definition: "풀이", expectedWordVersion: null },
  "owner",
);
await Promise.resolve();
await assert.rejects(
  api.saveStudentHistoryDictionaryEntry(
    { config, word: "중복", definition: "풀이", expectedWordVersion: null },
    "owner",
  ),
  /이전 요청/,
);
release();
await flight;
hold = null;
checks++;
auth.currentUser = { uid: "other" };
await assert.rejects(
  api.saveStudentHistoryDictionaryEntry(original, "owner"),
  /로그인 사용자/,
);
checks++;
for (const file of files.slice(1)) {
  const text = readFileSync(file, "utf8");
  assert.match(text, /retryHistoryDictionaryMutation\(ownerUid\)/);
  assert.match(text, /expectedWordVersion:/);
  assert.match(text, /expectedTermVersion:/);
  assert.doesNotMatch(
    text,
    /\[currentSavedWord\?\.definition, word\]|\[selectedWord\?\.definition, word\]/,
    "Snapshot refresh must not replace an edited definition",
  );
  checks++;
}
auth.currentUser = { uid: "owner" };
reads.length = 0;
await api.loadPublishedHistoryDictionaryTerm(config, "고려");
await api.loadStudentHistoryDictionaryWord(config, "owner", "term");
await api.loadTeacherHistoryDictionaryTerms(config);
assert.equal(reads[0][0], "years/2026/semesters/2/history_dictionary_terms");
assert.equal(reads[1], "years/2026/semesters/2/dictionary_students/owner/history_dictionary_words/term");
assert.equal(reads[2][0], "years/2026/semesters/2/history_dictionary_terms");
await assert.rejects(api.loadPublishedHistoryDictionaryTerm(null, "고려"), /현재 학기/);
checks += 4;
console.log(
  `History dictionary gateway client: ${checks} checks PASS (mocked, no network)`,
);
