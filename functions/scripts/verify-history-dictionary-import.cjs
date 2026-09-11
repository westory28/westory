const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const gateway = require("../commandGateway");
const dictionary = require("../historyDictionaryImport");
const { Store } = require("./verify-lesson-answers.cjs");
const { run: verifyRetiredEndpoint } = require("./verify-history-dictionary-bulk-conflict.cjs");

const TYPE = "saveHistoryDictionaryTermsBulk";
const INVALID = "HISTORY_DICTIONARY_IMPORT_INVALID";
const CONFLICT = "HISTORY_DICTIONARY_BULK_CONFLICT";
const TEACHER_REQUIRED = "HISTORY_DICTIONARY_IMPORT_TEACHER_REQUIRED";
const ADMIN_EMAIL = "westoria28@gmail.com";
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const authStart = source.indexOf("const authorizeCommandGatewayActor = async (");
const authEnd = source.indexOf("const legacyPointV1CommandAdapter =", authStart);
assert.ok(authStart > 0 && authEnd > authStart);
// Execute the actual registration policy with only profile/session I/O isolated.
// Requiring index.js would initialize the deployed Functions runtime instead.
const createAuthorizer = (profiles) => runInNewContext(
  `${source.slice(authStart, authEnd)}\nauthorizeCommandGatewayActor;`,
  {
    ADMIN_EMAIL,
    HttpsError,
    commandGateway: gateway,
    historyDictionaryImport: dictionary,
    lessonAnswers: require("../lessonAnswers"),
    lessonManagement: require("../lessonManagement"),
    teacherPatchNotes: require("../teacherPatchNotes"),
    assessmentLifecycle: require("../assessmentLifecycle"),
    gradeEvidence: require("../gradeEvidence"),
    wisEconomy: require("../wisEconomy"),
    w8Domains: require("../w8Domains"),
    teacherOperations: require("../teacherOperations"),
    semesterCutover: require("../semesterCutover"),
    db: { doc: (path) => ({ get: async () => {
      assert.match(path, /^users\/[A-Za-z0-9-]+$/);
      const profile = profiles.get(path.slice("users/".length));
      return { exists: !!profile, data: () => structuredClone(profile) };
    } }) },
  },
);
const term = (word = "고려") => ({
  word,
  definition: "우리 역사에서 등장한 나라입니다.",
  studentLevel: "중학생 수준",
  relatedUnitId: "",
  tags: [],
});
const payload = (words = ["고려"]) => ({ year: "2026", semester: "2", terms: words.map(term) });
const request = (value = payload(), commandId = randomUUID(), uid = "teacher-a", drop = false) => ({
  auth: { uid, token: { email: uid === "admin" ? ADMIN_EMAIL : `${uid}@yongshin-ms.ms.kr` } },
  data: { commandType: TYPE, commandId, payload: value, ...(drop ? { _testDropResponseAfterCommit: true } : {}) },
});
const termId = (word) => `term_${createHash("sha1").update(word.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex")}`;
const pathFor = (word) => `history_dictionary_terms/${termId(word)}`;
const setup = (seed = {}, options = {}) => {
  const store = new Store(seed);
  const profiles = new Map([
    ["teacher-a", { role: "teacher" }], ["teacher-b", { role: "teacher" }],
    ["student", { role: "student" }], ["staff", { role: "staff", permissions: { lesson_read: true, lesson_manage: true } }],
  ]);
  const state = { rejectSession: false, identityOverride: null, sessionCalls: 0 };
  const core = gateway.createCommandGatewayCore({
    store,
    projectId: "demo-westory-session-dictionary-import",
    serverTimestamp: () => 123,
    concreteTimestamp: () => 123,
    assertSession: async (req, sessionOptions) => {
      state.sessionCalls++;
      assert.deepEqual(sessionOptions, { recentAuth: false, highRisk: false });
      if (!req.auth || state.rejectSession) throw new HttpsError("unauthenticated", "Session rejected", { reason: "SESSION_REVOKED" });
      return state.identityOverride || { uid: req.auth.uid, email: req.auth.token.email, sessionId: "general-session", revision: 1, schemaVersion: 2, expiresAtMs: 999999 };
    },
    authorizeCommand: createAuthorizer(profiles),
    commandAdapters: options.noAdapter ? {} : { [TYPE]: dictionary.createHistoryDictionaryImportCommandAdapter() },
  });
  return { core, store, profiles, state };
};
let scenarios = 0;
const check = async (name, work) => {
  try { await work(); scenarios++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};
const denied = async (test, req, reason) => {
  const before = structuredClone([...test.store.docs]);
  await assert.rejects(test.core.execute(req), (error) => error.details?.reason === reason);
  assert.deepEqual([...test.store.docs], before, "Rejected commands must not change terms, receipts or audits");
};
const statusRequest = (req, uid = req.auth.uid) => ({
  auth: request(undefined, undefined, uid).auth,
  data: { commandType: TYPE, commandId: req.data.commandId },
});

const run = async () => {
  await check("actual command registration and missing adapter fail closed", async () => {
    assert.equal(gateway.COMMAND_TYPES.SAVE_HISTORY_DICTIONARY_TERMS_BULK, TYPE);
    assert.ok(source.includes("const dictionaryImportCommandAdapter = historyDictionaryImport.createHistoryDictionaryImportCommandAdapter();"));
    assert.ok(source.includes("Object.values(historyDictionaryImport.HISTORY_DICTIONARY_IMPORT_COMMAND_TYPES).map((commandType) => [commandType, dictionaryImportCommandAdapter])"));
    await denied(setup({}, { noAdapter: true }), request(), "COMMAND_ADAPTER_UNAVAILABLE");
  });
  await check("normalization preserves display words, normalized SHA1 IDs and published fields", async () => {
    const test = setup();
    const value = { year: " 2026 ", semester: " 2 ", terms: [{ word: "  Joseon\n Dynasty  ", definition: "  역사에  등장하는\n나라입니다. ", studentLevel: " 중학생  수준 ", relatedUnitId: " unit  one ", tags: ["  왕조 ", "왕조", "Korea", "korea", " "] }] };
    const normalized = dictionary.normalizeHistoryDictionaryImportPayload(TYPE, value);
    assert.deepEqual(normalized, { year: "2026", semester: "2", terms: [{ word: "Joseon Dynasty", definition: "역사에 등장하는 나라입니다.", studentLevel: "중학생 수준", relatedUnitId: "unit one", tags: ["왕조", "Korea"] }] });
    const result = await test.core.execute(request(value));
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.replayed, false);
    assert.deepEqual(result.result, { savedCount: 1, termIds: [termId("joseon dynasty")] });
    assert.deepEqual(test.store.docs.get(pathFor("joseon dynasty")), {
      ...normalized.terms[0], normalizedWord: "joseon dynasty", status: "published", createdBy: "teacher-a", updatedBy: "teacher-a", createdAt: 123, updatedAt: 123, publishedAt: 123,
    });
    assert.equal(test.store.docs.size, 3);
    const receipt = [...test.store.docs].find(([key]) => key.startsWith("command_receipts/"))[1];
    assert.equal(receipt.actorRole, "teacher");
    assert.equal(receipt.actorCapability, "history_dictionary:import");
    assert.equal(receipt.actorUid, "teacher-a");
    assert.equal(receipt.sourceHash, receipt.payloadHash);
  });
  await check("optional defaults and past syntax-valid scope without active pointer", async () => {
    const test = setup();
    const result = await test.core.execute(request({ year: "2001", semester: "1", terms: [{ word: "고려", definition: "다섯 글자 이상의 설명" }] }));
    assert.equal(result.result.savedCount, 1);
    const row = test.store.docs.get(pathFor("고려"));
    assert.equal(row.studentLevel, "중학생 수준");
    assert.equal(row.relatedUnitId, "");
    assert.deepEqual(row.tags, []);
    assert.equal(Object.hasOwn(row, "year"), false);
    assert.equal(Object.hasOwn(row, "semester"), false);
    assert.equal([...test.store.docs.keys()].some((key) => key.startsWith("years/")), false);
  });
  await check("200 rows create exactly 200 terms plus one receipt and audit", async () => {
    const test = setup();
    const result = await test.core.execute(request(payload(Array.from({ length: 200 }, (_, i) => `단어${i}`))));
    assert.equal(result.result.savedCount, 200);
    assert.equal(new Set(result.result.termIds).size, 200);
    assert.equal(test.store.docs.size, 202);
    assert.equal([...test.store.docs.keys()].filter((key) => key.startsWith("command_receipts/")).length, 1);
    assert.equal([...test.store.docs.keys()].filter((key) => key.startsWith("command_audit_events/")).length, 1);
  });
  await check("one existing term atomically rejects all rows without overwriting another teacher", async () => {
    const existing = { ...term("고려"), normalizedWord: "고려", createdBy: "teacher-b", updatedAt: 10, status: "hidden" };
    const test = setup({ [pathFor("고려")]: existing });
    await denied(test, request(payload(["새 단어", "고려"])), CONFLICT);
  });
  await check("concurrent distinct commands with one shared word have only one atomic winner", async () => {
    const test = setup();
    const result = await Promise.allSettled([
      test.core.execute(request(payload(["shared", "first"]))),
      test.core.execute(request(payload(["shared", "second"]), randomUUID(), "teacher-b")),
    ]);
    assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(result.find((item) => item.status === "rejected").reason.details.reason, CONFLICT);
    assert.equal(test.store.docs.size, 4);
    assert.equal(test.store.docs.has(pathFor("first")) !== test.store.docs.has(pathFor("second")), true);
  });
  await check("concurrent identical operation replays one receipt", async () => {
    const test = setup();
    const req = request(payload(["one", "two"]));
    const result = await Promise.all([test.core.execute(req), test.core.execute(req)]);
    assert.equal(result.filter((item) => item.replayed).length, 1);
    assert.equal(test.store.docs.size, 4);
  });
  await check("receipt replay after later edits never rewrites dictionary content", async () => {
    const test = setup();
    const req = request();
    const first = await test.core.execute(req);
    const row = { ...test.store.docs.get(pathFor("고려")), definition: "다른 교사가 나중에 수정한 설명", updatedBy: "teacher-b", updatedAt: 456 };
    test.store.docs.set(pathFor("고려"), row);
    const replay = await test.core.execute(req);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.deepEqual(test.store.docs.get(pathFor("고려")), row);
    await denied(test, { ...req, data: { ...req.data, payload: payload(["다른 단어"]) } }, "COMMAND_ID_CONFLICT");
    await denied(test, request(), CONFLICT);
  });
  await check("response loss keeps committed receipt accessible by status and replay", async () => {
    const test = setup();
    const req = request(payload(["one", "two"]), randomUUID(), "teacher-a", true);
    await assert.rejects(test.core.execute(req), (error) => error.details?.reason === "TEST_RESPONSE_LOSS");
    assert.equal(test.store.docs.size, 4);
    const status = await test.core.getStatus(statusRequest(req));
    assert.equal(status.status, "SUCCEEDED");
    assert.equal(status.result.savedCount, 2);
    assert.equal((await test.core.execute(req)).replayed, true);
    assert.equal(test.store.docs.size, 4);
    assert.equal((await test.core.getStatus(statusRequest(req, "teacher-b"))).status, "NOT_FOUND");
    await denied(test, { ...req, auth: request(undefined, undefined, "teacher-b").auth }, CONFLICT);
  });
  await check("a write failure rolls back earlier term creates and leaves no receipt", async () => {
    const test = setup();
    const transaction = test.store.runTransaction.bind(test.store);
    test.store.runTransaction = (callback) => transaction((tx) => callback({ ...tx, create: (path, value) => {
      if (path === pathFor("two")) throw new HttpsError("unavailable", "Injected storage failure");
      tx.create(path, value);
    } }));
    await assert.rejects(test.core.execute(request(payload(["one", "two"]))), (error) => error.code === "unavailable");
    assert.equal(test.store.docs.size, 0);
  });
  await check("receipt create failure rolls back all term creates", async () => {
    const test = setup();
    const transaction = test.store.runTransaction.bind(test.store);
    test.store.runTransaction = (callback) => transaction((tx) => callback({ ...tx, create: (path, value) => {
      if (path.startsWith("command_receipts/")) throw new HttpsError("unavailable", "Injected receipt failure");
      tx.create(path, value);
    } }));
    await assert.rejects(test.core.execute(request()), (error) => error.code === "unavailable");
    assert.equal(test.store.docs.size, 0);
  });
  for (const uid of ["student", "staff", "missing"]) {
    await check(`${uid} cannot import or read operation status`, async () => {
      const test = setup();
      const req = request(undefined, undefined, uid);
      await denied(test, req, TEACHER_REQUIRED);
      await assert.rejects(test.core.getStatus(statusRequest(req)), (error) => error.details?.reason === TEACHER_REQUIRED);
    });
  }
  await check("highest administrator remains permitted without teacher profile", async () => {
    const test = setup();
    await test.core.execute(request(undefined, undefined, "admin"));
    assert.equal(test.store.docs.get(pathFor("고려")).createdBy, "admin");
  });
  await check("session rejection blocks even a committed receipt replay and status", async () => {
    const test = setup();
    const req = request();
    await test.core.execute(req);
    test.state.rejectSession = true;
    await denied(test, req, "SESSION_REVOKED");
    await assert.rejects(test.core.getStatus(statusRequest(req)), (error) => error.details?.reason === "SESSION_REVOKED");
  });
  await check("role revocation blocks existing receipts", async () => {
    const test = setup();
    const req = request();
    await test.core.execute(req);
    test.profiles.set("teacher-a", { role: "student" });
    await denied(test, req, TEACHER_REQUIRED);
  });
  await check("unauthenticated and mismatched session identities cannot write", async () => {
    const test = setup();
    await denied(test, { ...request(), auth: null }, "SESSION_REVOKED");
    for (const identity of [{ uid: "teacher-b", email: "teacher-a@yongshin-ms.ms.kr" }, { uid: "teacher-a", email: "teacher-b@yongshin-ms.ms.kr" }]) {
      test.state.identityOverride = identity;
      await denied(test, request(), "COMMAND_ACTOR_MISMATCH");
    }
  });
  const invalidPayloads = [
    null, [], {}, { ...payload(), ownerUid: "admin" }, { ...payload(), status: "published" },
    { ...payload(), year: "2026/other" }, { ...payload(), year: 2026 }, { ...payload(), semester: "3" },
    { ...payload(), semester: 2 }, { ...payload(), terms: [] }, { ...payload(), terms: {} },
    payload(Array.from({ length: 201 }, (_, i) => `단어${i}`)), payload([" Joseon  Dynasty ", "joseon\ndynasty"]),
  ];
  const invalidRows = [
    null, [], { ...term(), ownerUid: "admin" }, { ...term(), uid: "admin" },
    { ...term(), status: "published" }, { ...term(), termId: "term_fake" },
    { ...term(), normalizedWord: "fake" }, { ...term(), createdAt: 123 },
    { ...term(), word: " " }, { ...term(), word: "x".repeat(41) }, { ...term(), word: 123 },
    { ...term(), definition: " " }, { ...term(), definition: "1234" }, { ...term(), definition: "x".repeat(1201) },
    { ...term(), studentLevel: "x".repeat(81) }, { ...term(), studentLevel: null },
    { ...term(), relatedUnitId: "x".repeat(121) }, { ...term(), relatedUnitId: null },
    { ...term(), tags: "comma,separated" }, { ...term(), tags: [1] },
    { ...term(), tags: ["x".repeat(25)] }, { ...term(), tags: Array(13).fill("tag") },
  ];
  for (const [index, value] of [...invalidPayloads, ...invalidRows.map((row) => ({ ...payload(), terms: [row] }))].entries()) {
    await check(`strict input rejection ${index + 1}`, () => denied(setup(), request(value), INVALID));
  }
  await check("valid maximum fields remain accepted", async () => {
    const test = setup();
    const row = { word: "x".repeat(40), definition: "가".repeat(1200), studentLevel: "x".repeat(80), relatedUnitId: "x".repeat(120), tags: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(24, "가")) };
    assert.equal((await test.core.execute(request({ ...payload(), terms: [row] }))).result.savedCount, 1);
  });
  await check("global 750000 canonical UTF-8 byte cap is unchanged for 200 Unicode rows", async () => {
    const value = { ...payload(), terms: Array.from({ length: 200 }, (_, i) => ({ ...term(`단어${i}`), definition: "가".repeat(1200), tags: Array.from({ length: 12 }, (_, j) => `${j}`.padEnd(24, "가")) })) };
    const normalized = dictionary.normalizeHistoryDictionaryImportPayload(TYPE, value);
    assert.ok(Buffer.byteLength(gateway.canonicalize(normalized), "utf8") > 750000);
    await denied(setup(), request(value), "COMMAND_PAYLOAD_TOO_LARGE");
  });
  const retired = await verifyRetiredEndpoint();
  console.log(JSON.stringify({
    suite: "history-dictionary-import-gateway", passed: true, scenarios,
    retiredEndpointScenarios: retired.scenarios, networkAccess: 0,
    coverage: "actual Gateway core, adapter, index actor policy, retired handler; GENERAL-session options; serialized atomic store with synthetic session/profile I/O",
    exclusions: "Firestore contention/retry behavior, deployed callable wrapper/AppCheck/session authority, browser UI; covered separately by integration QA",
  }));
};
run().catch((error) => { console.error(error); process.exitCode = 1; });
