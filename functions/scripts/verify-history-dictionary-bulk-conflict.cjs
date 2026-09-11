const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");

// This historical entry point now verifies retirement. The actual Gateway
// create-only/atomicity tests live in verify-history-dictionary-import.cjs.
const run = async () => {
  const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
  const start = source.indexOf("exports.saveHistoryDictionaryTermsBulk = onCall(");
  const end = source.indexOf("exports.saveHistoryDictionaryTerm = onCall(", start);
  assert.ok(start > 0 && end > start);
  let storageAccess = 0;
  const exports = {};
  runInNewContext(source.slice(start, end), {
    exports,
    REGION: "asia-northeast3",
    HttpsError,
    onCall: (_, handler) => handler,
    assertHistoryDictionaryWriteManager: async (request) => {
      if (!["teacher", "admin"].includes(request.auth?.uid))
        throw new HttpsError("permission-denied", "teacher required");
      return request.auth;
    },
    db: new Proxy({}, { get: () => { storageAccess++; throw new Error("Retired callable accessed storage"); } }),
  });
  let scenarios = 0;
  for (const uid of ["teacher", "admin"]) {
    for (const data of [{}, { year: "2026", semester: "2", terms: [{ word: "고려", definition: "기존 클라이언트의 정상 등록 요청" }] }]) {
      await assert.rejects(exports.saveHistoryDictionaryTermsBulk({ auth: { uid }, data }), (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "LEGACY_DICTIONARY_IMPORT_RETIRED" &&
        error.details?.replacement === "executeCommand/saveHistoryDictionaryTermsBulk",
      );
      scenarios++;
    }
  }
  for (const auth of [null, { uid: "student" }, { uid: "staff" }]) {
    await assert.rejects(exports.saveHistoryDictionaryTermsBulk({ auth, data: {} }), (error) => error.code === "permission-denied");
    scenarios++;
  }
  assert.equal(storageAccess, 0);
  return { passed: true, scenarios, storageAccess, networkAccess: 0, coverage: "actual retired handler; valid and malformed teacher/admin calls blocked before storage; authorization dependency isolated" };
};
if (require.main === module) run().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { run };
