const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const { Store } = require("./verify-lesson-answers.cjs");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const start = source.indexOf(
  "exports.saveHistoryDictionaryTermsBulk = onCall(",
);
const end = source.indexOf(
  "exports.saveHistoryDictionaryTerm = onCall(",
  start,
);
assert.ok(start > 0 && end > start);
const setup = (seed = {}) => {
  const store = new Store(seed);
  const exports = {};
  runInNewContext(source.slice(start, end), {
    exports,
    REGION: "asia-northeast3",
    MAX_HISTORY_DICTIONARY_BULK_TERMS: 200,
    HttpsError,
    onCall: (_, handler) => handler,
    assertHistoryDictionaryWriteManager: async (request) => {
      if (request.auth.uid !== "teacher")
        throw new HttpsError("permission-denied", "teacher required");
      return request.auth;
    },
    assertYearSemester: () => {},
    sanitizeHistoryDictionaryWord: (value) => String(value || "").trim(),
    normalizeHistoryDictionaryWord: (value) => value.toLowerCase(),
    sanitizeHistoryDictionaryText: (value) => String(value || ""),
    sanitizeHistoryDictionaryTags: () => [],
    buildHistoryDictionaryTermId: (value) => value,
    getHistoryDictionaryTermPath: (value) => `terms/${value}`,
    FieldValue: { serverTimestamp: () => 1 },
    db: {
      doc: (path) => ({ path }),
      runTransaction: (callback) =>
        store.runTransaction((tx) =>
          callback({
            getAll: async (...refs) =>
              Promise.all(refs.map((ref) => tx.get(ref.path))),
            create: (ref, value) => tx.create(ref.path, value),
          }),
        ),
    },
  });
  return {
    store,
    save: (words, uid = "teacher") =>
      exports.saveHistoryDictionaryTermsBulk({
        auth: { uid },
        data: {
          year: "2026",
          semester: "2",
          terms: words.map((word) => ({
            word,
            definition: "다섯 글자 이상의 설명입니다.",
          })),
        },
      }),
  };
};
(async () => {
  const normal = setup();
  assert.equal((await normal.save(["one", "two"])).savedCount, 2);
  assert.equal(normal.store.docs.size, 2);
  const existing = { definition: "기존 교사 설명", createdBy: "other" };
  const conflict = setup({ "terms/one": existing });
  await assert.rejects(
    conflict.save(["new", "one"]),
    (error) => error.details?.reason === "HISTORY_DICTIONARY_BULK_CONFLICT",
  );
  assert.deepEqual(conflict.store.docs.get("terms/one"), existing);
  assert.equal(conflict.store.docs.has("terms/new"), false);
  const concurrent = setup();
  const results = await Promise.allSettled([
    concurrent.save(["shared", "first"]),
    concurrent.save(["shared", "second"]),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(concurrent.store.docs.size, 2);
  await assert.rejects(
    normal.save(["one", "two"]),
    (error) => error.code === "already-exists",
  );
  assert.equal(normal.store.docs.size, 2);
  const denied = setup();
  await assert.rejects(
    denied.save(["one"], "student"),
    (error) => error.code === "permission-denied",
  );
  assert.equal(denied.store.docs.size, 0);
  console.log(
    JSON.stringify({
      passed: true,
      scenarios: 5,
      networkAccess: 0,
      coverage:
        "actual registered bulk handler; new import, atomic conflict, concurrent import, repeat rejection, authorization before write; isolated store",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
