const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { collectCanonicalDictionaryUserRefs } = require("../historyDictionaryPrivacy");
const uid = "student-a";
const ownFirst = `years/2026/semesters/1/dictionary_students/${uid}/history_dictionary_words/same`;
const ownSecond = `years/2026/semesters/2/dictionary_students/${uid}/history_dictionary_words/same`;
const ownRequest = "years/2026/semesters/1/history_dictionary_requests/request-a";
const other = "years/2026/semesters/2/dictionary_students/student-b/history_dictionary_words/other";
const forgedOwner = "years/2026/semesters/2/dictionary_students/student-b/history_dictionary_words/forged";
const legacy = `users/${uid}/history_dictionary_words/legacy`;
const docs = new Map([
  [ownFirst, { uid, year: "2026", semester: "1" }],
  [ownSecond, { uid, year: "2026", semester: "2" }],
  [ownRequest, { uid }], [other, { uid: "student-b" }], [forgedOwner, { uid }],
  [legacy, { uid }], ["history_dictionary_requests/global", { uid }],
]);
const calls = [];
const snapshot = rows => ({ docs: rows, forEach: callback => rows.forEach(callback) });
const document = ([path, data]) => ({ ref: { path }, data: () => structuredClone(data) });
const db = {
  collectionGroup: collection => ({ where: (field, operator, value) => {
    calls.push({ collection, field, operator, value });
    assert.deepEqual([field, operator, value], ["uid", "==", uid]);
    return { get: async () => snapshot([...docs].filter(([path, data]) => path.split("/").at(-2) === collection && data.uid === value).map(document)) };
  } }),
  collection: path => ({ get: async () => snapshot([...docs].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")).map(document)) }),
};
(async () => {
  const before = JSON.stringify([...docs]);
  const canonical = await collectCanonicalDictionaryUserRefs(db, uid);
  assert.deepEqual(canonical.map(ref => ref.path).sort(), [ownFirst, ownSecond, ownRequest].sort());
  await assert.rejects(collectCanonicalDictionaryUserRefs(db, "student-a/other"), error => error.code === "invalid-argument");
  const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
  const begin = source.indexOf("const collectKnownUserStudentDataRefs =");
  const end = source.indexOf("const sanitizeStudentProfileText =", begin);
  const collect = runInNewContext(source.slice(begin, end) + "\ncollectKnownUserStudentDataRefs;", {
    db, require: name => require(name.replace("./", "../")),
    addQueryDocRefs: (map, result) => result.forEach(doc => map.set(doc.ref.path, doc.ref)),
  });
  const all = await collect(uid);
  assert.deepEqual(Array.from(all, ref => ref.path).sort(), [legacy, ownFirst, ownSecond, ownRequest].sort());
  assert.equal(JSON.stringify([...docs]), before, "Reference collection never deletes or mutates data");
  console.log(JSON.stringify({ passed: true, checks: 6, uidFilteredQueries: calls.length, crossUserReferences: 0, writes: 0, productionAccess: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
