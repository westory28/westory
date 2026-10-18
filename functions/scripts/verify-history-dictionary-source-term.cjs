const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const commands = require("../productionGateway/historyDictionaryCommands");
const scope = require("../productionGateway/historyDictionaryScope");
const semesterCore = require("../productionGateway/semesterCore");
const enrollment = require("../productionGateway/archiveEnrollment");
const { createHistoryDictionaryRuntime } = require("../productionGateway/historyDictionaryRuntime");

// Exercise the actual operation together with its command adapter and runtime.
// Only Firestore storage/transactions are modeled; no production connection.
const source = readFileSync(require.resolve("../productionGateway/productionSource"), "utf8");
const start = source.indexOf("const saveStudentHistoryDictionaryWordOperation =");
const end = source.indexOf("exports.saveStudentHistoryDictionaryWord =", start);
assert.ok(start > 0 && end > start);
const operationSource = source.slice(start, end);
const current = { year: "2026", semester: "2" };
const historical = { year: "2026", semester: "1" };
const uid = "student-one";
const termId = commands.termIdFor("율령");
const wordPath = scope.dictionaryWordPath(current, uid, termId);
const currentTermPath = scope.dictionaryTermPath(current, termId);
const historicalTermPath = scope.dictionaryTermPath(historical, termId);
const timestamp = { seconds: 100, nanoseconds: 5 };
const term = {
  word: "율령", normalizedWord: "율령", definition: "국가를 다스리는 법과 행정 규정입니다.",
  studentLevel: "중학생 수준", tags: ["정치"], status: "published",
  updatedAt: { seconds: 10, nanoseconds: 3 },
};
const commandType = "saveStudentHistoryDictionaryWord";
const basePayload = { ...current, termId, expectedWordVersion: null, expectedTermVersion: "10:3" };
const sourcePayload = { ...basePayload, sourceYear: historical.year, sourceSemester: historical.semester };
const normalize = payload => commands.normalizeHistoryDictionaryPayload(commandType, payload);
const reason = expected => error => error.details?.reason === expected;
let assertions = 0;

function fixture() {
  const slotPath = `${enrollment.ENROLLMENT_SLOT_COLLECTION}/${enrollment.buildEnrollmentSlotId("2026-2", uid)}`;
  const enrollmentPath = `${enrollment.SEMESTER_ENROLLMENT_COLLECTION}/enrollment-one`;
  const documents = new Map([
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 1 }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 1, status: "ACTIVE" }],
    ["semester_manifests/2026-1", { semesterId: "2026-1", revision: 1, status: "CLOSED" }],
    [`users/${uid}`, { uid, role: "student", name: "학생" }],
    [slotPath, { activeEnrollmentId: "enrollment-one" }],
    [enrollmentPath, { enrollmentId: "enrollment-one", semesterId: "2026-2", studentUid: uid, enrollmentStatus: "ACTIVE" }],
    [currentTermPath, structuredClone(term)],
    [historicalTermPath, structuredClone(term)],
  ]);
  const reads = [], writes = [];
  const db = { doc: path => ({ path }) };
  const read = path => {
    assert.equal(writes.length, 0, "All reads precede the business write");
    reads.push(path);
    return documents.has(path) ? structuredClone(documents.get(path)) : undefined;
  };
  const native = {
    async get(ref) {
      const data = read(ref.path);
      return { exists: data !== undefined, data: () => data };
    },
    async getAll(...refs) { return Promise.all(refs.map(ref => native.get(ref))); },
    set(ref, data, options) { writes.push({ path: ref.path, data: structuredClone(data), options }); },
  };
  const transaction = {
    native,
    async get(path) { const data = read(path); return { path, exists: data !== undefined, data }; },
    async getAll(paths) { return Promise.all(paths.map(path => transaction.get(path))); },
  };
  const runtime = createHistoryDictionaryRuntime({
    db, semesterCore, archiveEnrollment: enrollment,
    legacyRewards: { read() { assert.fail("Saving a teacher definition must not read or grant rewards"); } },
    wisRewards: { read() { assert.fail("Saving a teacher definition must not read or grant rewards"); } },
  });
  const operation = vm.runInNewContext(`${operationSource}\nsaveStudentHistoryDictionaryWordOperation`, {
    db, HttpsError,
    assertYearSemester(data) { scope.dictionaryRoot(data); return { year: data.year, semester: data.semester }; },
    getHistoryDictionaryTermPath: scope.dictionaryTermPath,
    getStudentHistoryDictionaryWordPath: scope.dictionaryWordPath,
    sanitizeHistoryDictionaryText: (value, max) => String(value || "").trim().slice(0, max),
    sanitizeHistoryDictionaryWord: value => String(value || "").trim().slice(0, 40),
    normalizeHistoryDictionaryWord: value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase(),
    sanitizeHistoryDictionaryTags: value => value || [],
  });
  const adapter = commands.createHistoryDictionaryCommandAdapter({
    db, operations: { [commandType]: operation }, prepareContext: runtime.prepare,
  });
  return {
    documents, reads, writes, slotPath, enrollmentPath,
    async execute(payload = sourcePayload, actor = { actorUid: uid, actorRole: "student" }) {
      return adapter.apply({
        transaction, payload: normalize(payload), commandType, actor, timestamp,
        commandId: "command-one", receiptId: "receipt-one", payloadHash: JSON.stringify(payload),
      });
    },
  };
}

async function rejects(mutator, expected, payload = sourcePayload) {
  const f = fixture();
  mutator(f);
  await assert.rejects(f.execute(payload), typeof expected === "string" ? reason(expected) : expected);
  assert.equal(f.writes.length, 0, "Rejected source import cannot write any document");
  assertions++;
}

(async () => {
  assert.deepEqual(normalize(basePayload), basePayload, "Legacy payloads must keep their command hash unchanged");
  for (const extra of [
    { sourceYear: "2026" }, { sourceSemester: "1" },
    { sourceYear: "", sourceSemester: "" }, { sourceYear: "2026/1", sourceSemester: "1" },
    { sourceYear: 2026, sourceSemester: "1" }, { sourceYear: "2026", sourceSemester: "3" },
    { sourceYear: null, sourceSemester: null },
  ]) assert.throws(() => normalize({ ...basePayload, ...extra }), reason("HISTORY_DICTIONARY_PAYLOAD_INVALID"));
  for (const other of ["saveStudentHistoryDictionaryEntry", "saveHistoryDictionaryTerm", "approveHistoryDictionaryTermForRequests"])
    assert.throws(() => commands.normalizeHistoryDictionaryPayload(other, sourcePayload), reason("HISTORY_DICTIONARY_PAYLOAD_INVALID"));

  for (const payload of [basePayload, { ...basePayload, sourceYear: "2026", sourceSemester: "2" }, sourcePayload]) {
    const f = fixture();
    const result = await f.execute(payload);
    const sourcePath = payload.sourceSemester === "1" ? historicalTermPath : currentTermPath;
    assert.ok(result.target.refs.includes(sourcePath), "Audit references use the exact CAS source");
    assert.ok(result.target.refs.includes(wordPath));
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].path, wordPath, "Only the current student's current-semester word changes");
    assert.equal(f.writes[0].data.definitionSource, "teacher");
    assert.equal(f.writes[0].data.year, "2026");
    assert.equal(f.writes[0].data.semester, "2");
    assert.equal(f.writes[0].data.sourceSemester, payload.sourceSemester || "2");
    assert.equal(result.result.sourceYear, "2026");
    assert.equal(result.result.sourceSemester, payload.sourceSemester || "2");
    assert.deepEqual(f.documents.get(sourcePath), term, "The published source remains immutable");
    assert.ok(!Object.keys(f.writes[0].data).some(key => /reward/i.test(key)));
    assertions++;
  }
  {
    const f = fixture();
    f.documents.get("semester_manifests/2026-1").status = "ARCHIVED";
    f.documents.delete(currentTermPath);
    assert.equal((await f.execute()).result.saved, true, "No current term clone is required");
    assert.ok(!f.reads.includes(currentTermPath), "Source CAS cannot accidentally consult the current term");
    assertions++;
  }
  {
    const f = fixture();
    const previous = {
      uid, termId, year: "2026", semester: "2", updatedAt: { seconds: 9, nanoseconds: 0 },
      createdAt: { seconds: 1, nanoseconds: 0 }, definitionSource: "student",
      rewardOrigins: [{ original: "legacy" }], wisRewardOrigins: [{ original: "canonical" }], rewardAmount: 50,
    };
    f.documents.set(wordPath, previous);
    await f.execute({ ...sourcePayload, expectedWordVersion: "9:0" });
    assert.equal(f.writes[0].options.merge, true);
    const merged = { ...previous, ...f.writes[0].data };
    assert.deepEqual(merged.rewardOrigins, previous.rewardOrigins);
    assert.deepEqual(merged.wisRewardOrigins, previous.wisRewardOrigins);
    assert.equal(merged.rewardAmount, 50);
    assert.deepEqual(merged.createdAt, previous.createdAt);
    assert.equal(merged.definitionSource, "teacher");
    assertions++;
  }
  await rejects(f => { f.documents.get(historicalTermPath).updatedAt.seconds = 11; }, "HISTORY_DICTIONARY_VERSION_CONFLICT");
  await rejects(f => { f.documents.set(wordPath, { updatedAt: { seconds: 4, nanoseconds: 0 } }); }, "HISTORY_DICTIONARY_VERSION_CONFLICT");
  await rejects(f => { f.documents.delete(historicalTermPath); }, error => error.code === "not-found", { ...sourcePayload, expectedTermVersion: null });
  for (const patch of [{ status: "draft" }, { definition: " " }])
    await rejects(f => Object.assign(f.documents.get(historicalTermPath), patch), error => error.code === "failed-precondition");
  for (const status of ["ACTIVE", "PREPARING", "READY", "CLOSING", "QUARANTINED"])
    await rejects(f => { f.documents.get("semester_manifests/2026-1").status = status; }, "HISTORY_DICTIONARY_SOURCE_SEMESTER_UNAVAILABLE");
  await rejects(f => { f.documents.delete("semester_manifests/2026-1"); }, "HISTORY_DICTIONARY_SOURCE_SEMESTER_UNAVAILABLE");
  await rejects(f => { f.documents.get("semester_manifests/2026-1").semesterId = "2025-1"; }, "HISTORY_DICTIONARY_SOURCE_SEMESTER_UNAVAILABLE");
  await rejects(f => { f.documents.set("semester_manifests/2027-1", { semesterId: "2027-1", status: "CLOSED" }); },
    "HISTORY_DICTIONARY_SOURCE_SEMESTER_UNAVAILABLE", { ...sourcePayload, sourceYear: "2027" });
  await rejects(f => { f.documents.get("site_settings/semester_active").semesterId = "2027-1"; }, "HISTORY_DICTIONARY_SEMESTER_CHANGED");
  await rejects(f => { f.documents.get("semester_manifests/2026-2").readOnly = true; }, "HISTORY_DICTIONARY_SEMESTER_CHANGED");
  await rejects(f => { f.documents.get(`users/${uid}`).role = "teacher"; }, "HISTORY_DICTIONARY_ROLE_CHANGED");
  await rejects(f => { f.documents.delete(f.slotPath); }, "HISTORY_DICTIONARY_ENROLLMENT_REQUIRED");
  await rejects(f => { f.documents.get(f.enrollmentPath).studentUid = "another-student"; }, "HISTORY_DICTIONARY_ENROLLMENT_REQUIRED");
  await rejects(f => { f.documents.get(f.enrollmentPath).enrollmentStatus = "WITHDRAWN"; }, "HISTORY_DICTIONARY_ENROLLMENT_REQUIRED");
  {
    const f = fixture();
    await assert.rejects(f.execute(sourcePayload, { actorUid: uid, actorRole: "teacher" }), reason("HISTORY_DICTIONARY_ROLE_REQUIRED"));
    assert.equal(f.writes.length, 0);
    assertions++;
  }
  console.log(`PASS dictionary source term: ${assertions} transaction cases; optional legacy-compatible source fields, exact source/current-word CAS, closed archive validation, published content, current enrollment/role fences, no reward or source writes; network 0`);
})().catch(error => { console.error(error); process.exitCode = 1; });
