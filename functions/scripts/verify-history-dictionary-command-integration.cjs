// Actual Gateway + adapter + runtime + eight index operations + reward helpers.
// Only session identity and Firestore I/O are replaced. No emulator/network.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { Timestamp } = require("firebase-admin/firestore");
const gateway = require("../commandGateway");
const commands = require("../historyDictionaryCommands");
const semesterCore = require("../semesterCore");
const archiveEnrollment = require("../archiveEnrollment");
const wis = require("../wisEconomy");
const dictionaryNotifications = require("../dictionaryNotifications");
const originHelper = require("../historyDictionaryRewardOrigin");
const { createHistoryDictionaryLegacyReward } = require("../historyDictionaryLegacyReward");
const { createHistoryDictionaryWisReward } = require("../historyDictionaryWisReward");
const { createHistoryDictionaryRuntime } = require("../historyDictionaryRuntime");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const slice = (start, finish) => {
  const begin = source.indexOf(start), end = source.indexOf(finish, begin);
  assert.ok(begin >= 0 && end > begin, `Actual source exists: ${start}`);
  return source.slice(begin, end);
};
const names = Object.values(commands.HISTORY_DICTIONARY_COMMAND_TYPES);
const actual = [
  slice("const normalizeHistoryDictionaryWord =", "const MAX_HISTORY_DICTIONARY_BULK_TERMS"),
  slice("const assertYearSemester =", "const resolveHallOfFameTargetYearSemester"),
  slice("const failHistoryDictionaryRequestTarget =", "exports.saveHistoryDictionaryTermsBulk ="),
  slice("const buildWalletBase =", "const getLessonCorePointTimestampMs ="),
  slice("const buildWalletRankState =", "const getAllowedEmojiIdsForTier ="),
  ...names.map(name => slice(`const ${name}Operation =`, `exports.${name} =`)),
  ...names.map(name => source.match(new RegExp(`exports\\.${name} = onCall\\([^\\n]+`))[0]),
  `\nexports.operations = {${names.map(name => `${name}:${name}Operation`).join(",")}};`,
  "exports.rewardDependencies = {loadPolicy,ensureWallet,getCurrentRankEarnedTotal,buildWalletBase,buildWalletRankState,createTransactionPayload};",
].join("\n");
const uid = "student-a", teacher = "teacher-a", scope = { year: "2026", semester: "2" }, day = "2026-09-11";
const semesterId = "2026-2", definition = "역사적 사건의 배경과 전개 과정을 충분히 설명하는 학생의 뜻풀이입니다.";
const wordPath = (termId, owner = uid) => `users/${owner}/history_dictionary_words/${termId}`;
const termPath = termId => `history_dictionary_terms/${termId}`;
const requestIdFor = word => `req_${crypto.createHash("sha1").update(`2026:2:${uid}:${word.trim().toLowerCase()}`).digest("hex")}`;
const clone = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const cases = [];
const executedOperations = new Set();
const eq = (actual, expected) => { assert.deepEqual(plain(actual), plain(expected)); checks++; };
const ok = value => { assert.ok(value); checks++; };
const test = async (name, fn) => { try { await fn(); cases.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };

const setup = () => {
  let docs = new Map(), tick = 100, active = false, failPrefix = "";
  const attempts = [], operationCalls = new Set(), reads = [];
  const policy = { autoRewardEnabled: true, rewardPolicy: { historyDictionary: { enabled: true, amount: 50, minDefinitionLength: 20, maxDailyClaims: 4 } }, rankPolicy: {}, allowNegativeBalance: false };
  const seedScope = (year = "2026", semester = "2", owner = uid) => {
    const id = `${year}-${semester}`, accountId = wis.accountIdFor(id, owner), enrollmentId = `enrollment-${id}-${owner}`;
    docs.set(`${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${id}`, { semesterId: id, revision: 3, status: "ACTIVE" });
    docs.set(`${wis.WIS_ECONOMY_COLLECTION}/${id}`, { semesterId: id, status: "ACTIVE_OPEN", ledgerEntryCount: 0, readOnly: false });
    docs.set(`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`, { schemaVersion: 1, policyVersion: "w7-v1", accountId, studentUid: owner, semesterId: id,
      status: "ACTIVE", revision: 1, balance: 500, earnedTotal: 500, rankEarnedTotal: 500, spentTotal: 0, adjustedTotal: 500,
      displayName: "학생", recentLedgerEntries: [] });
    docs.set(`${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(id, owner)}`, {
      activeEnrollmentId: enrollmentId, semesterId: id, studentUid: owner, status: "ACTIVE" });
    docs.set(`${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${enrollmentId}`, {
      enrollmentId, semesterId: id, studentUid: owner, enrollmentStatus: "ACTIVE" });
    docs.set(`years/${year}/semesters/${semester}/point_policies/current`, clone(policy));
    return accountId;
  };
  seedScope();
  docs.set(semesterCore.ACTIVE_SEMESTER_POINTER_PATH, { semesterId, revision: 3 });
  docs.set("site_settings/config", scope);
  docs.set(`users/${uid}`, { uid, role: "student", name: "학생", email: `${uid}@school.test` });
  docs.set(`users/${teacher}`, { uid: teacher, role: "teacher", name: "교사", email: `${teacher}@school.test` });
  const query = (path, group = false) => ({ path, group, filters: [], cap: Infinity,
    where(field, operator, value) { this.filters.push({ field, operator, value }); return this; },
    limit(cap) { this.cap = cap; return this; }, orderBy() { return this; } });
  const snapshot = (path, map) => ({ ref: db.doc(path), id: path.split("/").pop(), exists: map.has(path), data: () => clone(map.get(path)) });
  const db = {
    doc: path => ({ path, id: path.split("/").pop(), get: async () => snapshot(path, docs) }),
    collection: path => query(path), collectionGroup: path => query(path, true),
    runTransaction: async callback => {
      assert.equal(active, false, "No nested transaction; operations share Gateway native transaction"); active = true;
      const staged = new Map(docs), writes = [], record = { writes, committed: false }; attempts.push(record); tick++;
      const resolveTime = value => {
        if (value?.__serverTimestamp) return { seconds: tick, nanoseconds: 0 };
        if (Array.isArray(value)) return value.map(resolveTime);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveTime(entry)]));
        return value;
      };
      const get = async ref => {
        assert.equal(writes.length, 0, "Firestore reads must precede all writes"); reads.push(ref.path);
        if (!ref.filters) return snapshot(ref.path, staged);
        const paths = [...staged].filter(([path, data]) => {
          const sameCollection = ref.group ? path.split("/").at(-2) === ref.path : path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/");
          return sameCollection && ref.filters.every(({ field, operator, value }) => operator === "in" ? value.includes(data[field]) :
            operator === "array-contains" ? Array.isArray(data[field]) && data[field].includes(value) : data[field] === value);
        }).slice(0, ref.cap).map(([path]) => path);
        return { size: paths.length, docs: paths.map(path => snapshot(path, staged)) };
      };
      const write = (mode, ref, data, options) => {
        if (failPrefix && ref.path.startsWith(failPrefix)) throw new HttpsError("aborted", "Injected write failure", { reason: "TEST_WRITE_FAILURE" });
        if (mode === "create") assert.equal(staged.has(ref.path), false, `Create exactly once: ${ref.path}`);
        writes.push({ mode, path: ref.path });
        if (mode === "delete") staged.delete(ref.path);
        else staged.set(ref.path, resolveTime(options?.merge ? { ...staged.get(ref.path), ...data } : data));
      };
      try {
        const result = await callback({ get, getAll: (...refs) => Promise.all(refs.map(get)),
          set: (ref, data, options) => write("set", ref, data, options), create: (ref, data) => write("create", ref, data), delete: ref => write("delete", ref) });
        docs = staged; record.committed = true; return result;
      } finally { active = false; }
    },
  };
  const exported = {};
  runInNewContext(actual, {
    exports: exported, db, crypto, HttpsError, REGION: "asia-northeast3", onCall: (_, handler) => handler,
    dictionaryNotifications, historyDictionaryDelete: require("../historyDictionaryDelete"), historyDictionaryUpdate: require("../historyDictionaryUpdate"),
    HISTORY_DICTIONARY_TERMS_COLLECTION: "history_dictionary_terms", HISTORY_DICTIONARY_REQUESTS_COLLECTION: "history_dictionary_requests",
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    getPointWalletPath: (year, semester, owner) => `years/${year}/semesters/${semester}/point_wallets/${owner}`,
    getPointPolicyPath: (year, semester) => `years/${year}/semesters/${semester}/point_policies/current`,
    getPointCollectionPath: (year, semester, collection) => `years/${year}/semesters/${semester}/${collection}`,
    getDefaultPointPolicy: () => clone(policy), normalizePointPolicy: value => value,
    buildRankSnapshot: amount => ({ metricValue: amount }),
  });
  const legacyRewards = createHistoryDictionaryLegacyReward({ db, ...exported.rewardDependencies });
  const wisRewards = createHistoryDictionaryWisReward({ db, wisEconomy: wis, sha256: gateway.sha256,
    loadPolicy: exported.rewardDependencies.loadPolicy, getKstDateKey: () => day });
  const runtime = createHistoryDictionaryRuntime({ db, semesterCore, archiveEnrollment, legacyRewards, wisRewards, dictionaryNotifications,
    getWisHallOfFamePath: (year, semester) => `years/${year}/semesters/${semester}/wis_hall_of_fame/current` });
  const operations = Object.fromEntries(Object.entries(exported.operations).map(([name, operation]) => [name, (...args) => {
    operationCalls.add(name); executedOperations.add(name); return operation(...args);
  }]));
  const adapter = commands.createHistoryDictionaryCommandAdapter({ db, operations, prepareContext: context => runtime.prepare(context) });
  const core = gateway.createCommandGatewayCore({ store: gateway.createFirestoreStore(db), commandAdapters: Object.fromEntries(names.map(name => [name, adapter])),
    projectId: "demo-westory-session-dictionary", serverTimestamp: () => ({ __serverTimestamp: true }), concreteTimestamp: () => new Timestamp(tick, 0),
    assertSession: async request => ({ uid: request.auth.uid, email: request.auth.token.email, sessionId: "test", revision: 1, schemaVersion: 2 }),
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: request.auth.token.email,
      actorRole: request.auth.uid === teacher ? "teacher" : "student", actorCapability: "history_dictionary:test" }) });
  const execute = (name, payload, options = {}) => core.execute({
    auth: { uid: options.uid || uid, token: { email: `${options.uid || uid}@school.test` } },
    data: { commandType: name, commandId: options.id || crypto.randomUUID(), payload: { ...scope, ...payload },
      ...(options.drop ? { _testDropResponseAfterCommit: true } : {}) },
  });
  const version = path => commands.versionFor(docs.get(path));
  const awardPayload = (word = "term-one") => ({ word, definition, expectedWordVersion: version(wordPath(commands.termIdFor(word))) });
  const seedLegacy = (termId, year = "2025", semester = "2") => {
    const origin = { ledgerKind: "legacy-point", uid, termId, year, semester, transactionId: originHelper.getRewardTransactionId(uid, termId) };
    docs.set(`years/${year}/semesters/${semester}/point_transactions/${origin.transactionId}`, {
      uid, type: "history_dictionary", sourceId: originHelper.getRewardSourceId(termId), delta: 30, targetDate: "2025-03-01" });
    docs.set(`years/${year}/semesters/${semester}/point_wallets/${uid}`, { uid, balance: 10, earnedTotal: 30, rankEarnedTotal: 30, spentTotal: 5, adjustedTotal: 0 });
    return origin;
  };
  return { get docs() { return docs; }, attempts, reads, operationCalls, exported, execute, version, awardPayload, seedLegacy, seedScope,
    failAt: value => { failPrefix = value; } };
};
const rejectUnchanged = async (f, action, reason, zeroWrites = true) => {
  const before = clone([...f.docs]), previousAttempts = f.attempts.length;
  await assert.rejects(action, error => !reason || error.details?.reason === reason); checks++;
  eq([...f.docs], before);
  if (zeroWrites) ok(f.attempts.slice(previousAttempts).every(attempt => attempt.writes.length === 0));
};

(async () => {
  await test("Actual student save, legacy/canonical origin preservation, CAS, lost response receipt replay and teacher reversal", async () => {
    const f = setup(), word = "term-one", termId = commands.termIdFor(word), legacy = f.seedLegacy(termId);
    f.docs.set(wordPath(termId), { uid, termId, word, normalizedWord: word, definition, year: "2026", semester: "2", status: "saved",
      rewardTermId: termId, rewardAmount: 30, rewardTransactionId: legacy.transactionId });
    const payload = f.awardPayload(word), commandId = crypto.randomUUID();
    await assert.rejects(f.execute("saveStudentHistoryDictionaryEntry", payload, { id: commandId, drop: true }), error => error.details?.reason === "TEST_RESPONSE_LOSS"); checks++;
    const saved = f.docs.get(wordPath(termId)); eq(saved.rewardOrigins, [legacy]); eq(saved.wisRewardOrigins.length, 1); eq(saved.rewardAmount, 30);
    eq(f.docs.get(`semester_wis_accounts/${saved.wisRewardOrigins[0].accountId}`).balance, 550);
    const before = clone([...f.docs]), replay = await f.execute("saveStudentHistoryDictionaryEntry", payload, { id: commandId });
    eq(replay.replayed, true); eq(replay.result.reward.amount, 50); eq([...f.docs], before);
    await rejectUnchanged(f, () => f.execute("saveStudentHistoryDictionaryEntry", payload), "HISTORY_DICTIONARY_VERSION_CONFLICT");
    const deletePayload = { uid, termId, expectedWordVersion: f.version(wordPath(termId)) }, deleteId = crypto.randomUUID();
    await assert.rejects(f.execute("deleteStudentHistoryDictionaryWordByTeacher", deletePayload, { uid: teacher, id: deleteId, drop: true }),
      error => error.details?.reason === "TEST_RESPONSE_LOSS"); checks++;
    const afterDelete = clone([...f.docs]);
    const removed = await f.execute("deleteStudentHistoryDictionaryWordByTeacher", deletePayload, { uid: teacher, id: deleteId });
    eq(removed.replayed, true); eq([...f.docs], afterDelete);
    eq(removed.result.reward.amount, 80); eq(f.docs.has(wordPath(termId)), false);
    eq(f.docs.get(`semester_wis_accounts/${saved.wisRewardOrigins[0].accountId}`).balance, 500);
    eq(f.docs.get(`years/2025/semesters/2/point_wallets/${uid}`).balance, -20);
    eq([...f.docs.keys()].filter(path => path.startsWith(dictionaryNotifications.COLLECTION)).length, 1);
  });
  await test("Multiple legacy scopes plus canonical reward all roll back on closed/insufficient original account", async () => {
    const f = setup(), word = "atomic", termId = commands.termIdFor(word), a = f.seedLegacy(termId), b = f.seedLegacy(termId, "2024", "1");
    f.docs.set(wordPath(termId), { uid, termId, word, normalizedWord: word, definition, ...scope, status: "saved", rewardOrigins: [a, b] });
    await f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload(word));
    const accountId = f.docs.get(wordPath(termId)).wisRewardOrigins[0].accountId;
    const payload = { uid, termId, expectedWordVersion: f.version(wordPath(termId)) };
    f.docs.get(`semester_wis_accounts/${accountId}`).balance = 49;
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWordByTeacher", payload, { uid: teacher }), "HISTORY_DICTIONARY_WIS_INSUFFICIENT_BALANCE");
    f.docs.get(`semester_wis_accounts/${accountId}`).balance = 550; f.docs.get("semester_wis_economies/2026-2").status = "CLOSED";
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWordByTeacher", payload, { uid: teacher }), "HISTORY_DICTIONARY_WIS_ECONOMY_CLOSED");
    f.docs.get("semester_wis_economies/2026-2").status = "ACTIVE_OPEN";
    const deleted = await f.execute("deleteStudentHistoryDictionaryWordByTeacher", payload, { uid: teacher }); eq(deleted.result.reward.amount, 110);
    for (const origin of [a, b]) eq(f.docs.get(`years/${origin.year}/semesters/${origin.semester}/point_wallets/${uid}`).balance, -20);
  });
  await test("Current semester never substitutes for a canonical original reward scope", async () => {
    const f = setup(), word = "old-award", termId = commands.termIdFor(word);
    await f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload(word));
    const origin = f.docs.get(wordPath(termId)).wisRewardOrigins[0];
    f.seedScope("2027", "1");
    f.docs.set(semesterCore.ACTIVE_SEMESTER_POINTER_PATH, { semesterId: "2027-1", revision: 3 });
    f.docs.get("semester_manifests/2026-2").status = "CLOSED";
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWord", { termId, expectedWordVersion: f.version(wordPath(termId)), year: "2027", semester: "1" }), "HISTORY_DICTIONARY_WIS_ECONOMY_CLOSED");
    eq(f.docs.get(`semester_wis_accounts/${wis.accountIdFor("2027-1", uid)}`).balance, 500);
    eq(f.docs.get(`semester_wis_accounts/${origin.accountId}`).balance, 550);
  });
  await test("Student request, teacher term publication/approval and rejection commit notification outbox atomically", async () => {
    const f = setup(), word = "request-word", termId = commands.termIdFor(word), requestId = requestIdFor(word);
    const requested = await f.execute("requestHistoryDictionaryTerm", { word, memo: "학생 요청", warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null });
    eq(requested.result.created, true); eq(f.docs.get(`history_dictionary_requests/${requestId}`).status, "requested");
    eq([...f.docs.keys()].filter(path => path.startsWith(dictionaryNotifications.COLLECTION)).length, 1);
    const published = await f.execute("saveHistoryDictionaryTerm", { word, definition, expectedTermVersion: null }, { uid: teacher });
    eq(published.result.resolvedCount, 1); eq(f.docs.get(wordPath(termId)).status, "saved");
    eq([...f.docs.keys()].filter(path => path.startsWith(dictionaryNotifications.COLLECTION)).length, 2);
    const another = "published-first", otherTerm = commands.termIdFor(another), otherRequest = requestIdFor(another);
    await f.execute("saveHistoryDictionaryTerm", { word: another, definition, expectedTermVersion: null }, { uid: teacher });
    await f.execute("requestHistoryDictionaryTerm", { word: another, warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null });
    const approved = await f.execute("approveHistoryDictionaryTermForRequests", { termId: otherTerm, requestId: otherRequest,
      expectedTermVersion: f.version(termPath(otherTerm)), expectedRequestVersion: f.version(`history_dictionary_requests/${otherRequest}`) }, { uid: teacher });
    eq(approved.result.resolvedCount, 1);
    const count = [...f.docs.keys()].filter(path => path.startsWith(dictionaryNotifications.COLLECTION)).length;
    await f.execute("deleteStudentHistoryDictionaryWordByTeacher", { uid, termId: otherTerm, requestId: otherRequest,
      expectedWordVersion: f.version(wordPath(otherTerm)), expectedRequestVersion: f.version(`history_dictionary_requests/${otherRequest}`) }, { uid: teacher });
    eq(f.docs.get(`history_dictionary_requests/${otherRequest}`).status, "rejected");
    eq([...f.docs.keys()].filter(path => path.startsWith(dictionaryNotifications.COLLECTION)).length, count + 1);
  });
  await test("Rejected request reopens with one atomic teacher outbox; lost-response replay and pending edits add none", async () => {
    const f = setup(), word = "reopen-request", termId = commands.termIdFor(word), requestId = requestIdFor(word);
    const requestPath = `history_dictionary_requests/${requestId}`;
    const outbox = () => [...f.docs].filter(([path]) => path.startsWith(`${dictionaryNotifications.COLLECTION}/`));
    await f.execute("requestHistoryDictionaryTerm", { word, warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null });
    eq(outbox().length, 1);
    await f.execute("deleteStudentHistoryDictionaryWordByTeacher", { uid, termId, requestId,
      expectedWordVersion: f.version(wordPath(termId)), expectedRequestVersion: f.version(requestPath) }, { uid: teacher });
    eq(f.docs.get(requestPath).status, "rejected"); eq(f.docs.has(wordPath(termId)), false);
    const beforeReopen = clone(outbox()), id = crypto.randomUUID();
    // Freeze the original CAS payload across an actual commit followed by response loss.
    const payload = { word, memo: "다시 요청합니다", warningAccepted: true,
      expectedWordVersion: null, expectedRequestVersion: f.version(requestPath) };
    await assert.rejects(() => f.execute("requestHistoryDictionaryTerm", payload, { id, drop: true }),
      error => error.details?.reason === "TEST_RESPONSE_LOSS"); checks++;
    eq(f.docs.get(requestPath).status, "requested"); eq(f.docs.get(wordPath(termId)).status, "requested");
    eq(outbox().length, beforeReopen.length + 1);
    const newEvents = outbox().filter(([path]) => !beforeReopen.some(([previous]) => previous === path));
    eq(newEvents.length, 1);
    const [eventPath, event] = newEvents[0];
    eq(eventPath, dictionaryNotifications.buildCommandEvent({ commandId: id, kind: "requested", uid: teacher, ...scope }).path);
    eq(event.uid, teacher); eq(event.status, "PENDING");
    eq(event.notification.type, "history_dictionary_requested"); eq(event.notification.entityId, requestId);
    const committedWrites = f.attempts.filter(attempt => attempt.committed).at(-1).writes.map(write => write.path);
    for (const path of [requestPath, wordPath(termId), eventPath]) eq(committedWrites.filter(value => value === path).length, 1);
    const afterReopen = clone([...f.docs]);
    const replay = await f.execute("requestHistoryDictionaryTerm", payload, { id });
    eq(replay.replayed, true); eq(replay.result.created, false); eq(replay.result.reopened, true);
    eq([...f.docs], afterReopen);
    const pendingOutbox = clone(outbox()), pendingVersion = f.version(requestPath);
    const edited = await f.execute("requestHistoryDictionaryTerm", { word, memo: "대기 중 요청 내용 수정", warningAccepted: true,
      expectedWordVersion: f.version(wordPath(termId)), expectedRequestVersion: pendingVersion });
    eq(edited.result.created, false); eq(edited.result.reopened, false);
    eq(f.docs.get(requestPath).memo, "대기 중 요청 내용 수정");
    ok(f.version(requestPath) !== pendingVersion); eq(outbox(), pendingOutbox);
  });
  await test("Saving a published word again updates its definition while preserving original createdAt", async () => {
    const f = setup(), word = "official-created-at", termId = commands.termIdFor(word);
    await f.execute("saveHistoryDictionaryTerm", { word, definition, expectedTermVersion: null }, { uid: teacher });
    await f.execute("saveStudentHistoryDictionaryWord", { termId, expectedWordVersion: null, expectedTermVersion: f.version(termPath(termId)) });
    const original = clone(f.docs.get(wordPath(termId)));
    ok(original.createdAt && Number.isFinite(original.createdAt.seconds));
    const nextDefinition = `${definition} 교사가 보충한 설명입니다.`;
    await f.execute("saveHistoryDictionaryTerm", { word, definition: nextDefinition,
      expectedTermVersion: f.version(termPath(termId)) }, { uid: teacher });
    const payload = { termId, expectedWordVersion: f.version(wordPath(termId)), expectedTermVersion: f.version(termPath(termId)) };
    const id = crypto.randomUUID();
    await f.execute("saveStudentHistoryDictionaryWord", payload, { id });
    const saved = f.docs.get(wordPath(termId));
    eq(saved.definition, nextDefinition); eq(saved.createdAt, original.createdAt);
    ok(commands.versionFor(saved) !== commands.versionFor(original));
    const beforeReplay = clone([...f.docs]);
    const replay = await f.execute("saveStudentHistoryDictionaryWord", payload, { id });
    eq(replay.replayed, true); eq([...f.docs], beforeReplay);
  });
  await test("Outbox failure rolls back preceding request/word/ledger writes and receipt", async () => {
    const f = setup(), word = "rollback-notice";
    f.failAt(dictionaryNotifications.COLLECTION);
    await rejectUnchanged(f, () => f.execute("requestHistoryDictionaryTerm", { word, warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null }), "TEST_WRITE_FAILURE", false);
    f.failAt(""); await f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload(word));
    const termId = commands.termIdFor(word); f.failAt(dictionaryNotifications.COLLECTION);
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWordByTeacher", { uid, termId, expectedWordVersion: f.version(wordPath(termId)) }, { uid: teacher }), "TEST_WRITE_FAILURE", false);
    const approval = setup(), pendingWord = "rollback-resolution", pendingTerm = commands.termIdFor(pendingWord);
    await approval.execute("requestHistoryDictionaryTerm", { word: pendingWord, warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null });
    approval.failAt(dictionaryNotifications.COLLECTION);
    await rejectUnchanged(approval, () => approval.execute("saveHistoryDictionaryTerm", { word: pendingWord, definition, expectedTermVersion: null }, { uid: teacher }), "TEST_WRITE_FAILURE", false);
    eq(approval.docs.has(termPath(pendingTerm)), false);
    eq(approval.docs.get(wordPath(pendingTerm)).status, "requested");
  });
  await test("Official save, teacher rename and student delete execute actual remaining operations with origin preservation", async () => {
    const f = setup(), word = "official", termId = commands.termIdFor(word);
    await f.execute("saveHistoryDictionaryTerm", { word, definition, expectedTermVersion: null }, { uid: teacher });
    await f.execute("saveStudentHistoryDictionaryWord", { termId, expectedWordVersion: null, expectedTermVersion: f.version(termPath(termId)) });
    eq(f.docs.get(wordPath(termId)).definition, definition);
    await f.execute("deleteStudentHistoryDictionaryWord", { termId, expectedWordVersion: f.version(wordPath(termId)) });
    const oldTerm = commands.termIdFor("before-rename"), legacy = f.seedLegacy(oldTerm);
    f.docs.set(wordPath(oldTerm), { uid, termId: oldTerm, word: "before-rename", normalizedWord: "before-rename", ...scope,
      status: "saved", rewardOrigins: [legacy], rewardTermId: oldTerm, rewardAmount: 30, rewardTransactionId: legacy.transactionId });
    await f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload("before-rename"));
    const origins = clone(f.docs.get(wordPath(oldTerm)).wisRewardOrigins);
    const renamed = await f.execute("updateStudentHistoryDictionaryWordByTeacher", { uid, termId: oldTerm, word: "after-rename", definition,
      expectedWordVersion: f.version(wordPath(oldTerm)) }, { uid: teacher });
    eq(f.docs.has(wordPath(oldTerm)), false); eq(f.docs.get(wordPath(renamed.result.termId)).wisRewardOrigins, origins);
    eq(f.docs.get(wordPath(renamed.result.termId)).rewardOrigins, [legacy]);
    const deleted = await f.execute("deleteStudentHistoryDictionaryWord", { termId: renamed.result.termId, expectedWordVersion: f.version(wordPath(renamed.result.termId)) });
    eq(deleted.result.reward.amount, 80);
    for (const name of ["saveStudentHistoryDictionaryWord", "updateStudentHistoryDictionaryWordByTeacher", "deleteStudentHistoryDictionaryWord"]) ok(f.operationCalls.has(name));
  });
  await test("Missing/stale CAS and role/version violations are zero-write; retired callables fail closed", async () => {
    const f = setup();
    await rejectUnchanged(f, () => f.execute("saveStudentHistoryDictionaryEntry", { word: "missing", definition }), "HISTORY_DICTIONARY_PAYLOAD_INVALID");
    await rejectUnchanged(f, () => f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload(), { uid: teacher }), "HISTORY_DICTIONARY_ROLE_REQUIRED");
    await rejectUnchanged(f, () => f.execute("saveHistoryDictionaryTerm", { word: "teacher-only", definition, expectedTermVersion: null }), "HISTORY_DICTIONARY_ROLE_REQUIRED");
    await f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload());
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWord", { termId: commands.termIdFor("term-one"), expectedWordVersion: null }), "HISTORY_DICTIONARY_VERSION_CONFLICT");
    for (const name of names) await rejectUnchanged(f, () => f.exported[name]({ auth: { uid: teacher }, data: {} }), "HISTORY_DICTIONARY_COMMAND_REQUIRED");
    const termId = commands.termIdFor("term-one"); f.docs.get(`users/${uid}`).role = "teacher";
    await rejectUnchanged(f, () => f.execute("deleteStudentHistoryDictionaryWord", { termId, expectedWordVersion: f.version(wordPath(termId)) }), "HISTORY_DICTIONARY_ROLE_CHANGED");
  });
  await test("All eight operations require their CAS input and correct role before business writes", async () => {
    const f = setup(), termId = commands.termIdFor("matrix"), matrix = {
      requestHistoryDictionaryTerm: { word: "matrix", warningAccepted: true, expectedWordVersion: null, expectedRequestVersion: null },
      saveStudentHistoryDictionaryWord: { termId, expectedWordVersion: null, expectedTermVersion: null },
      saveStudentHistoryDictionaryEntry: { word: "matrix", definition, expectedWordVersion: null },
      deleteStudentHistoryDictionaryWord: { termId, expectedWordVersion: null },
      deleteStudentHistoryDictionaryWordByTeacher: { uid, termId, expectedWordVersion: null },
      updateStudentHistoryDictionaryWordByTeacher: { uid, termId, word: "matrix", definition, expectedWordVersion: null },
      saveHistoryDictionaryTerm: { word: "matrix", definition, expectedTermVersion: null },
      approveHistoryDictionaryTermForRequests: { termId, expectedTermVersion: null },
    };
    for (const [name, payload] of Object.entries(matrix)) {
      const student = commands.STUDENT_COMMAND_TYPES.has(name), omitted = { ...payload };
      const firstVersion = Object.keys(payload).find(key => key.startsWith("expected")); delete omitted[firstVersion];
      await rejectUnchanged(f, () => f.execute(name, omitted, { uid: student ? uid : teacher }), "HISTORY_DICTIONARY_PAYLOAD_INVALID");
      await rejectUnchanged(f, () => f.execute(name, payload, { uid: student ? teacher : uid }), "HISTORY_DICTIONARY_ROLE_REQUIRED");
    }
  });
  await test("Changed active scope and inactive enrollment reject student awards without mutations", async () => {
    for (const mutate of [
      f => { f.docs.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH).revision = 4; },
      f => { f.docs.get("semester_manifests/2026-2").status = "CLOSED"; },
      f => { f.docs.get(`${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/enrollment-2026-2-${uid}`).enrollmentStatus = "WITHDRAWN"; },
    ]) {
      const f = setup(); mutate(f);
      await rejectUnchanged(f, () => f.execute("saveStudentHistoryDictionaryEntry", f.awardPayload()));
    }
  });
  eq([...executedOperations].sort(), [...names].sort());
  console.log(JSON.stringify({ passed: true, checks, cases, actualOperations: [...executedOperations],
    coverage: "Actual Gateway receipt/normalizer/adapter/runtime/eight operations/legacy+Wis/outbox; native transaction mock rejects read-after-write and rolls back staged state",
    limitations: "Session/authorization identity and Firestore I/O mocked; no network, SDK contention or deployed indexes verified" }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
