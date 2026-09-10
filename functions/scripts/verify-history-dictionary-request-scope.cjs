const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const { Store } = require("./verify-lesson-answers.cjs");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const start = source.indexOf(
  "const resolveHistoryDictionaryRequestsWithTerm = async",
);
const end = source.indexOf("exports.saveHistoryDictionaryTermsBulk =", start);
assert.ok(start > 0 && end > start);
const term = {
  word: "term",
  normalizedWord: "term",
  definition: "기존 풀이입니다",
  status: "published",
};
const query = (path, filters = [], cap = Infinity) => ({
  path,
  filters,
  cap,
  query: true,
  where: (field, op, value) =>
    query(path, [...filters, { field, op, value }], cap),
  limit: (size) => query(path, filters, size),
});
const setup = (seed) => {
  const store = new Store({ "terms/term": term, ...seed });
  const exports = {};
  const db = {
    doc: (path) => ({ path, id: path.split("/").at(-1) }),
    collection: (path) => query(path),
    runTransaction: (callback) =>
      store.runTransaction((tx) =>
        callback({
          get: async (ref) => {
            const snapshot = async (path) => {
              const data = await tx.get(path);
              return {
                ref: db.doc(path),
                exists: data.exists,
                data: () => data.data,
              };
            };
            if (!ref.query) return snapshot(ref.path);
            const paths = [...store.docs]
              .filter(
                ([path, value]) =>
                  path.startsWith(ref.path + "/") &&
                  ref.filters.every(({ field, op, value: expected }) =>
                    op === "in"
                      ? expected.includes(value[field])
                      : value[field] === expected,
                  ),
              )
              .slice(0, ref.cap)
              .map(([path]) => path);
            return { docs: await Promise.all(paths.map(snapshot)) };
          },
          set: (ref, value, options) => tx.set(ref.path, value, options),
        }),
      ),
  };
  runInNewContext(
    source.slice(start, end) +
      "\nexports.resolve = resolveHistoryDictionaryRequestsWithTerm;",
    {
      exports,
      db,
      HttpsError,
      HISTORY_DICTIONARY_REQUESTS_COLLECTION: "requests",
      getHistoryDictionaryTermPath: (id) => `terms/${id}`,
      getHistoryDictionaryRequestPath: (id) => `requests/${id}`,
      getStudentHistoryDictionaryWordPath: (uid, id) =>
        `students/${uid}/words/${id}`,
      normalizeHistoryDictionaryWord: (word) => word,
      sanitizeHistoryDictionaryWord: (word) => word,
      sanitizeHistoryDictionaryText: (text) => text || "",
      sanitizeHistoryDictionaryTags: () => [],
      FieldValue: { serverTimestamp: () => 1 },
    },
  );
  return {
    store,
    run: (extra = {}) =>
      exports.resolve({
        managerUid: "teacher",
        termId: "term",
        year: "2026",
        semester: "2",
        ...extra,
      }),
  };
};
const pending = (uid) => ({
  uid,
  normalizedWord: "term",
  year: "2026",
  semester: "2",
  status: "requested",
});
(async () => {
  const seed = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `requests/old-${index}`,
      { ...pending(`old-${index}`), year: "2025", status: "resolved" },
    ]),
  );
  seed["requests/current"] = pending("current");
  seed["requests/other-term"] = { ...pending("other"), semester: "1" };
  const current = setup(seed);
  const result = await current.run();
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].uid, "current");
  assert.equal(current.store.docs.get("requests/current").status, "resolved");
  assert.equal(
    current.store.docs.get("requests/other-term").status,
    "requested",
  );
  assert.equal((await current.run()).resolved.length, 0);
  const crowded = setup(
    Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `requests/pending-${index}`,
        pending(`student-${index}`),
      ]),
    ),
  );
  const before = JSON.stringify([...crowded.store.docs]);
  await assert.rejects(
    crowded.run(),
    (error) => error.code === "resource-exhausted",
  );
  assert.equal(JSON.stringify([...crowded.store.docs]), before);
  await assert.rejects(
    crowded.run({ year: "" }),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(JSON.stringify([...crowded.store.docs]), before);
  console.log(
    JSON.stringify({
      passed: true,
      scenarios: 4,
      networkAccess: 0,
      coverage:
        "actual request resolver; 100 historical rows plus current request, scope isolation, replay, overflow and missing scope fail before writes",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
