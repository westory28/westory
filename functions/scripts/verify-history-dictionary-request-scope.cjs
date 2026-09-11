const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { Store } = require("./verify-lesson-answers.cjs");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const slice = (startText, endText) => {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
};
const actualSanitizers = slice("const normalizeHistoryDictionaryWord =", "const MAX_HISTORY_DICTIONARY_BULK_TERMS");
const actualScope = slice("const assertYearSemester =", "const resolveHallOfFameTargetYearSemester");
const actualResolver = slice("const failHistoryDictionaryRequestTarget =", "exports.saveHistoryDictionaryTermsBulk =");
const actualOperations = slice("const saveHistoryDictionaryTermOperation =", "exports.updateStudentProfileIcon =");
const termId = "term_" + crypto.createHash("sha1").update("term").digest("hex");
const termPath = "history_dictionary_terms/" + termId;
const wordPath = (uid = "student-one") => "users/" + uid + "/history_dictionary_words/" + termId;
const requestPath = (id) => "history_dictionary_requests/" + id;
const canonicalRequestId = (uid = "student-one", year = "2026", semester = "2", word = "term") =>
  "req_" + crypto.createHash("sha1").update(year + ":" + semester + ":" + uid + ":" + word).digest("hex");
const fallbackId = canonicalRequestId();
const MISMATCH = "HISTORY_DICTIONARY_REQUEST_MISMATCH";
const NOT_PENDING = "HISTORY_DICTIONARY_REQUEST_NOT_PENDING";
const UNVERIFIED = "HISTORY_DICTIONARY_FALLBACK_UNVERIFIED";
const term = {
  word: "term", normalizedWord: "term", definition: "기존 풀이입니다",
  studentLevel: "중학생 수준", tags: [], status: "published",
  createdAt: 7, createdBy: "previous-teacher",
};
const pending = (uid = "student-one", extra = {}) => ({
  uid, word: "term", normalizedWord: "term", year: "2026", semester: "2",
  status: "requested", memo: "학생 원문 메모", studentName: "학생 이름",
  grade: "2", class: "1", number: "3", createdAt: 8, updatedAt: 9, ...extra,
});
const proof = (extra = {}) => ({
  uid: "student-one", termId, word: "term", normalizedWord: "term",
  requestId: fallbackId, year: "2026", semester: "2", status: "requested",
  memo: "현재 요청 메모", studentName: "요청 학생", grade: "2", class: "1", number: "3",
  createdAt: 11, rewardTermId: "old-reward-id", rewardAmount: 20, ...extra,
});
const recoverySeed = (extra = {}) => ({
  "users/student-one": { uid: "student-one", role: "student", name: "프로필 학생" },
  [wordPath()]: proof(),
  ...extra,
});
const query = (path, filters = [], cap = Infinity) => ({
  path, filters, cap, query: true,
  where: (field, op, value) => query(path, filters.concat({ field, op, value }), cap),
  limit: (size) => query(path, filters, size),
});
const setup = (seed = {}, options = {}) => {
  const store = new Store({ [termPath]: term, "site_settings/config": { year: "2026", semester: "2" }, ...seed });
  const exports = {}, notifications = [], writes = [];
  let transactions = 0;
  const makeSnapshot = (path, data) => ({
    ref: db.doc(path), id: path.split("/").at(-1),
    exists: data.exists, data: () => data.data,
  });
  const db = {
    doc: (path) => ({
      path, id: path.split("/").at(-1),
      get: async () => makeSnapshot(path, await store.get(path)),
    }),
    collection: (path) => query(path),
    runTransaction: async (callback) => {
      const result = await store.runTransaction((tx) => callback({
        get: async (ref) => {
          const snapshot = async (path) => makeSnapshot(path, await tx.get(path));
          if (!ref.query) return snapshot(ref.path);
          const paths = [...store.docs]
            .filter(([path, value]) => path.startsWith(ref.path + "/") &&
              ref.filters.every(({ field, op, value: expected }) =>
                op === "in" ? expected.includes(value[field]) : value[field] === expected))
            .slice(0, ref.cap).map(([path]) => path);
          return { docs: await Promise.all(paths.map(snapshot)) };
        },
        set: (ref, value, opts) => { writes.push(ref.path); return tx.set(ref.path, value, opts); },
        create: (ref, value) => { writes.push(ref.path); return tx.create(ref.path, value); },
      }));
      transactions++;
      if (options.afterTransaction) await options.afterTransaction(transactions, store);
      return result;
    },
  };
  runInNewContext(
    actualSanitizers + actualScope + actualResolver + actualOperations +
    "\nexports.resolve = resolveHistoryDictionaryRequestsWithTerm; exports.operations = {saveHistoryDictionaryTermOperation, approveHistoryDictionaryTermForRequestsOperation};",
    {
      exports, db, HttpsError, crypto, REGION: "asia-northeast3",
      dictionaryNotifications: require("../dictionaryNotifications"),
      HISTORY_DICTIONARY_TERMS_COLLECTION: "history_dictionary_terms",
      HISTORY_DICTIONARY_REQUESTS_COLLECTION: "history_dictionary_requests",
      FieldValue: { serverTimestamp: () => 123 },
      onCall: (_, handler) => handler,
      assertHistoryDictionaryWriteManager: async (request) => {
        if (request.auth?.uid !== "teacher") throw new HttpsError("permission-denied", "teacher required");
        return { uid: "teacher" };
      },
      createUserNotifications: async (year, semester, uids, input) => {
        if (uids.length) notifications.push({ year, semester, uids: Array.from(uids), input });
        return [];
      },
    },
  );
  const invokeOperation = async (name, data, uid) => {
    // Gateway authenticates before business execution. Keep the former role
    // rejection tests while exercising the actual moved operation functions.
    if (uid !== "teacher") throw new HttpsError("permission-denied", "teacher required");
    return db.runTransaction(native => exports.operations[name]({ data }, {
      identity: { uid }, timestamp: 123, transaction: { native },
      runTransaction: callback => callback(native),
    }));
  };
  return {
    store, writes, notifications,
    transactionCount: () => transactions,
    run: (extra = {}) => exports.resolve({ managerUid: "teacher", termId, year: "2026", semester: "2", ...extra }),
    save: (extra = {}, uid = "teacher") => invokeOperation("saveHistoryDictionaryTermOperation",
      { year: "2026", semester: "2", word: "term", definition: "이번에 새로 저장할 풀이입니다.", ...extra }, uid),
    approve: (extra = {}, uid = "teacher") => invokeOperation("approveHistoryDictionaryTermForRequestsOperation",
      { year: "2026", semester: "2", termId, ...extra }, uid),
  };
};
let scenarios = 0;
const check = async (name, fn) => {
  try { await fn(); scenarios++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
};
const rejectsUnchanged = async (test, action, reason) => {
  const before = structuredClone([...test.store.docs]);
  await assert.rejects(action(), (error) => error.code === "failed-precondition" && error.details?.reason === reason);
  assert.deepEqual([...test.store.docs], before);
  assert.equal(test.notifications.length, 0);
};
const noopUnchanged = async (test, action) => {
  const before = structuredClone([...test.store.docs]), writes = test.writes.length;
  const notifications = test.notifications.length;
  const result = await action();
  assert.equal(result.resolvedCount ?? result.resolved.length, 0);
  assert.deepEqual([...test.store.docs], before);
  assert.equal(test.writes.length, writes, "No business write may be staged on a confirmed closed retry");
  assert.equal(test.notifications.length, notifications);
};
const fallback = { fallbackRequestId: fallbackId, fallbackUid: "student-one" };
(async () => {
  await check("100 old requests never hide current scoped request; replay writes zero", async () => {
    const seed = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [
      requestPath("old-" + i), pending("old-" + i, { year: "2025", status: "resolved" }),
    ]));
    seed[requestPath("current")] = pending();
    seed[requestPath("another-semester")] = pending("student-two", { semester: "1" });
    const test = setup(seed);
    assert.equal((await test.run()).resolved.length, 1);
    assert.equal(test.store.docs.get(requestPath("current")).status, "resolved");
    assert.equal(test.store.docs.get(requestPath("another-semester")).status, "requested");
    assert.equal((await test.run()).resolved.length, 0);
  });
  await check("101 open requests reject atomically before writes", async () => {
    const test = setup(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [
      requestPath("pending-" + i), pending("student-" + i),
    ])));
    const before = structuredClone([...test.store.docs]);
    await assert.rejects(test.run(), (error) => error.code === "resource-exhausted");
    assert.deepEqual([...test.store.docs], before);
  });
  await check("explicit pending request preserves request and student metadata", async () => {
    const test = setup({
      [requestPath("legacy-existing")]: pending(),
      [wordPath()]: { createdAt: 10, rewardAmount: 15, customMetadata: "keep" },
    });
    assert.equal((await test.approve({ requestId: "legacy-existing" })).resolvedCount, 1);
    const request = test.store.docs.get(requestPath("legacy-existing"));
    assert.equal(request.memo, "학생 원문 메모"); assert.equal(request.studentName, "학생 이름"); assert.equal(request.createdAt, 8);
    const word = test.store.docs.get(wordPath());
    assert.equal(word.createdAt, 10); assert.equal(word.rewardAmount, 15); assert.equal(word.customMetadata, "keep");
    assert.equal(test.notifications.length, 0, "delivery must not delay the business response"); assert.equal([...test.store.docs.keys()].filter(path => path.startsWith("history_dictionary_notification_outbox/")).length, 1);
  });
  for (const bad of [
    { word: "another" }, { normalizedWord: "another" }, { normalizedWord: null },
    { uid: "" }, { uid: "student/other" }, { uid: " student-one " },
    { year: "2025" }, { semester: "1" },
  ]) await check("explicit target mismatch " + Object.keys(bad)[0], async () => {
    const test = setup({ [requestPath("existing")]: pending("student-one", bad) });
    await rejectsUnchanged(test, () => test.approve({ requestId: "existing" }), MISMATCH);
  });
  await check("explicit missing request fails closed", async () => {
    const test = setup();
    await rejectsUnchanged(test, () => test.approve({ requestId: "absent" }), MISMATCH);
  });
  for (const status of ["rejected", "closed", ""]) await check("explicit closed " + status, async () => {
    const test = setup({ [requestPath("existing")]: pending("student-one", { status }) });
    await rejectsUnchanged(test, () => test.approve({ requestId: "existing" }), NOT_PENDING);
  });
  await check("explicit resolved same target is a no-op", async () => {
    const test = setup({ [requestPath("existing")]: pending("student-one", { status: "resolved", resolvedTermId: termId, matchedTermId: termId }) });
    await noopUnchanged(test, () => test.approve({ requestId: "existing" }));
  });
  await check("resolved request with a different target is rejected", async () => {
    const test = setup({ [requestPath("existing")]: pending("student-one", { status: "resolved", resolvedTermId: "other-term" }) });
    await rejectsUnchanged(test, () => test.approve({ requestId: "existing" }), MISMATCH);
  });
  await check("existing legacy fallback is handled once without rewriting metadata", async () => {
    const id = "legacy-existing";
    const test = setup({
      [requestPath(id)]: pending(),
      [wordPath()]: proof({ requestId: id, status: "saved" }),
    });
    const result = await test.save({ fallbackRequestId: id, fallbackUid: "student-one" });
    assert.equal(result.resolvedCount, 1);
    const request = test.store.docs.get(requestPath(id));
    assert.equal(request.memo, "학생 원문 메모"); assert.equal(request.createdAt, 8); assert.equal(request.studentName, "학생 이름");
    const word = test.store.docs.get(wordPath());
    assert.equal(word.createdAt, 11); assert.equal(word.rewardAmount, 20); assert.equal(word.rewardTermId, "old-reward-id");
  });
  for (const bad of [
    { uid: "student-two" }, { word: "another" }, { normalizedWord: "another" }, { year: "2025" }, { semester: "1" },
  ]) await check("existing fallback mismatch blocks first term write " + Object.keys(bad)[0], async () => {
    const test = setup({ [requestPath(fallbackId)]: pending("student-one", bad) });
    await rejectsUnchanged(test, () => test.save(fallback), MISMATCH);
    assert.equal(test.writes.length, 0);
  });
  await check("existing resolved fallback makes entire save a no-op", async () => {
    const test = setup({ [requestPath(fallbackId)]: pending("student-one", { status: "resolved", resolvedTermId: termId }) });
    await noopUnchanged(test, () => test.save(fallback));
    await noopUnchanged(test, () => test.run(fallback));
  });
  await check("existing rejected fallback blocks term save and request reopening", async () => {
    const test = setup({ [requestPath(fallbackId)]: pending("student-one", { status: "rejected" }) });
    await rejectsUnchanged(test, () => test.save(fallback), NOT_PENDING);
    assert.equal(test.writes.length, 0);
  });
  await check("missing fallback requires current server word proof and recovers metadata", async () => {
    const test = setup(recoverySeed());
    assert.equal((await test.save(fallback)).resolvedCount, 1);
    const request = test.store.docs.get(requestPath(fallbackId));
    assert.equal(request.uid, "student-one"); assert.equal(request.memo, "현재 요청 메모"); assert.equal(request.createdAt, 11);
    assert.equal(request.status, "resolved"); assert.equal(request.studentName, "요청 학생");
    assert.equal(test.store.docs.get(wordPath()).status, "saved");
    await noopUnchanged(test, () => test.save(fallback));
  });
  await check("missing fallback permits legacy absent UID field when path binds identity", async () => {
    const word = proof(); delete word.uid;
    const test = setup(recoverySeed({ [wordPath()]: word, "users/student-one": { role: "student" } }));
    assert.equal((await test.run(fallback)).resolved.length, 1);
  });
  for (const [name, change] of [
    ["no-profile", (data) => { delete data["users/student-one"]; }],
    ["wrong-profile-role", (data) => { data["users/student-one"].role = "teacher"; }],
    ["wrong-profile-uid", (data) => { data["users/student-one"].uid = "student-two"; }],
    ["no-word", (data) => { delete data[wordPath()]; }],
    ...Object.entries({
      status: "saved", requestId: "another-request", year: "2025", semester: "1",
      normalizedWord: "another", word: "another", uid: "student-two", termId: "another-term",
    }).map(([field, value]) => ["wrong-word-" + field, (data) => { data[wordPath()][field] = value; }]),
  ]) await check("unverified recovery " + name + " blocks first term write", async () => {
    const data = recoverySeed(); change(data);
    const test = setup(data);
    await rejectsUnchanged(test, () => test.save(fallback), UNVERIFIED);
    assert.equal(test.writes.length, 0);
  });
  await check("public deterministic request ID and profile alone are not recovery evidence", async () => {
    const test = setup({ "users/student-one": { role: "student" } });
    test.store.docs.delete(termPath);
    await rejectsUnchanged(test, () => test.save(fallback), UNVERIFIED);
    assert.equal(test.store.docs.has(termPath), false);
  });
  await check("noncanonical missing request ID cannot fabricate a request", async () => {
    const test = setup(recoverySeed({ [wordPath()]: proof({ requestId: "forged-request" }) }));
    await rejectsUnchanged(test, () => test.save({ ...fallback, fallbackRequestId: "forged-request" }), UNVERIFIED);
  });
  for (const bad of [
    { fallbackRequestId: fallbackId }, { fallbackUid: "student-one" },
    { ...fallback, fallbackUid: "student/other" }, { ...fallback, fallbackUid: null },
    { ...fallback, fallbackRequestId: "../other" }, { ...fallback, fallbackRequestId: "bad\nid" },
    { ...fallback, fallbackRequestId: "a".repeat(121) }, { ...fallback, fallbackUid: "a".repeat(129) },
    { ...fallback, fallbackUid: ["student-one"] },
  ]) await check("fallback pair/path rejection", async () => {
    const test = setup(recoverySeed());
    await rejectsUnchanged(test, () => test.save(bad), MISMATCH);
    assert.equal(test.writes.length, 0);
  });
  for (const bad of [{ requestId: "bad/id" }, { requestId: "bad\\id" }, { termId: "../term" }, { year: "" }, { semester: "3" }]) await check("explicit input boundary", async () => {
    const test = setup();
    // The public callable retains its existing missing-scope syntax error;
    // exercise the new resolver boundary without relying on that wrapper.
    await rejectsUnchanged(test, () => test.run(bad), MISMATCH);
  });
  for (const [field, value] of Object.entries({
    uid: "student-two", termId: "another-term", requestId: "new-request", year: "2025",
    semester: "1", normalizedWord: "another", word: "another",
  })) await check("later student word binding " + field + " blocks approval and fallback save", async () => {
    const data = { [requestPath(fallbackId)]: pending(), [wordPath()]: proof({ [field]: value }) };
    const approval = setup(data);
    await rejectsUnchanged(approval, () => approval.approve({ requestId: fallbackId }), MISMATCH);
    const saving = setup(data);
    await rejectsUnchanged(saving, () => saving.save(fallback), MISMATCH);
    assert.equal(saving.writes.length, 0);
  });
  await check("same-bound saved student word retains existing overwrite policy", async () => {
    const test = setup({ [requestPath(fallbackId)]: pending(), [wordPath()]: proof({ status: "saved" }) });
    assert.equal((await test.approve({ requestId: fallbackId })).resolvedCount, 1);
    assert.equal(test.store.docs.get(wordPath()).definition, term.definition);
  });
  await check("existing numeric year and semester preserve legacy scope equivalence", async () => {
    const test = setup({
      [requestPath(fallbackId)]: pending("student-one", { year: 2026, semester: 2 }),
      [wordPath()]: proof({ year: 2026, semester: 2 }),
    });
    assert.equal((await test.approve({ requestId: fallbackId })).resolvedCount, 1);
    assert.equal(test.store.docs.get(wordPath()).year, 2026);
    assert.equal(test.store.docs.get(wordPath()).semester, 2);
  });
  await check("all target bindings validated before any fanout write", async () => {
    const test = setup({
      [requestPath("first")]: pending("student-one"),
      [requestPath("second")]: pending("student-two"),
      [wordPath("student-two")]: { uid: "student-one" },
    });
    await rejectsUnchanged(test, () => test.run(), MISMATCH);
    assert.equal(test.writes.length, 0);
  });
  await check("concurrent missing fallback recovery resolves once then no-ops", async () => {
    const test = setup(recoverySeed());
    const results = await Promise.all([test.run(fallback), test.run(fallback)]);
    assert.deepEqual(results.map((result) => result.resolved.length).sort(), [0, 1]);
    assert.equal(test.store.docs.get(requestPath(fallbackId)).status, "resolved");
  });
  await check("shared definition and fallback fanout commit once with identical content", async () => {
    const test = setup(recoverySeed());
    assert.equal((await test.save(fallback)).resolvedCount, 1);
    assert.equal(test.transactionCount(), 1);
    assert.equal(test.store.docs.get(requestPath(fallbackId)).status, "resolved");
    assert.equal(test.store.docs.get(wordPath()).definition, test.store.docs.get(termPath).definition);
    assert.equal(test.notifications.length, 0, "delivery must not delay the business response"); assert.equal([...test.store.docs.keys()].filter(path => path.startsWith("history_dictionary_notification_outbox/")).length, 1);
  });
  await check("invalid ordinary fanout preserves previous shared definition and all requests", async () => {
    const test = setup({ [requestPath("one")]: pending(), [wordPath()]: { uid: "another-student" } });
    await rejectsUnchanged(test, () => test.save(), MISMATCH);
    assert.equal(test.writes.length, 0);
    assert.equal(test.notifications.length, 0);
  });
  await check("101 pending requests do not partially save the shared definition", async () => {
    const test = setup(Object.fromEntries(Array.from({length:101}, (_,index) => [requestPath(`request-${index}`), pending(`student-${index}`)])));
    const before = structuredClone([...test.store.docs]);
    await assert.rejects(test.save(), error => error.code === "resource-exhausted");
    assert.deepEqual([...test.store.docs], before);
    assert.equal(test.writes.length, 0);
    assert.equal(test.notifications.length, 0);
  });
  await check("ordinary single save still works without fallback", async () => {
    const test = setup();
    assert.equal((await test.save()).resolvedCount, 0);
    assert.equal(test.store.docs.get(termPath).definition, "이번에 새로 저장할 풀이입니다.");
  });
  await check("missing configured scope fails before single-term mutation", async () => {
    const test = setup(); test.store.docs.delete("site_settings/config");
    await rejectsUnchanged(test, () => test.save({ year: "", semester: "" }), MISMATCH);
    assert.equal(test.writes.length, 0);
  });
  await check("teacher authorization remains before helper execution", async () => {
    const test = setup();
    await assert.rejects(test.save({}, "student"), (error) => error.code === "permission-denied");
    await assert.rejects(test.approve({}, "staff"), (error) => error.code === "permission-denied");
    assert.equal(test.writes.length, 0);
  });
  console.log(JSON.stringify({
    passed: true, scenarios, networkAccess: 0,
    coverage: "actual index sanitizers, path helpers, scope helpers, request resolver, single-save and approval handlers; session/manager/notification I/O isolated; serial atomic store rejects reads after writes",
    limitations: "No deployed SDK/Rules/Firestore contention test; global CAS/Gateway/receipt remain outside this patch; outbox delivery is covered separately",
  }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
