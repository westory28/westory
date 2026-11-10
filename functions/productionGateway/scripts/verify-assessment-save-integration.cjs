const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-westory-session-[a-z0-9-]+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
// A release check loads the complete preserved production source beside the
// patched module, so its session guard and storage adapter are tested too.
const gatewayDirectory = process.env.ASSESSMENT_SAVE_MODULE
  ? path.dirname(path.resolve(process.env.ASSESSMENT_SAVE_MODULE)) : path.resolve(__dirname, "..");
const production = require(path.join(gatewayDirectory, "productionSource"));
const authority = require(path.join(gatewayDirectory, "sessionAuthority"));
const { getApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const db = getFirestore();
const scope = new AsyncLocalStorage();
const observations = [];
const originalTransaction = db.runTransaction.bind(db);
db.runTransaction = (callback, options) => originalTransaction(async transaction => {
  const observation = { label: scope.getStore(), readOnly: options?.readOnly === true, reads: [], writes: [] };
  observations.push(observation);
  const getAll = transaction.getAll.bind(transaction);
  transaction.getAll = async (...args) => {
    const documents = await getAll(...args);
    observation.reads.push(...documents.map(document => ({ path: document.ref.path,
      fields: args.at(-1)?.fieldMask, bytes: Buffer.byteLength(JSON.stringify(document.data() || null)) })));
    return documents;
  };
  const set = transaction.set.bind(transaction);
  transaction.set = (ref, data, settings) => {
    observation.writes.push({ path: ref.path, fields: Object.keys(data) });
    return set(ref, data, settings);
  };
  return callback(transaction);
}, options);
const authTime = Math.floor(Date.now() / 1000) - 600;
const proof = { authorityGeneration: authority.SESSION_AUTHORITY_GENERATION,
  protocolVersion: authority.MIN_CLIENT_PROTOCOL_VERSION, revision: "a".repeat(64) };
const students = Array.from({ length: 30 }, (_, index) => `synthetic-save-${index + 1}`);
const attemptId = uid => `attempt_${createHash("sha256").update(uid).digest("hex")}`;
const attemptPath = uid => `semester_assessment_attempts/${attemptId(uid)}`;
const request = (uid, data) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } },
  data: { ...data, _session: proof } });
const invoke = (label, uid, data) => scope.run(label, () => production.saveAssessmentProgress.run(request(uid, data)));
const reason = expected => error => error.details?.reason === expected;
const payload = uid => ({ attemptId: attemptId(uid), expectedRevision: 1, answers: { q1: "가".repeat(80) },
  currentItemId: "q1", saveId: randomUUID() });
const frozenQuestion = { id: "q1", type: "choice", options: ["가".repeat(80)], answer: "가".repeat(80),
  passage: "합성 지문".repeat(1000), image: "data:image/png;base64," + "x".repeat(40_000) };

(async () => {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(cleared.ok, "Only this guarded synthetic demo project may be reset");
  const batch = db.batch();
  batch.set(db.doc("site_settings/config"), { year: "2026", semester: "2", activeSemesterId: "2026-2" });
  batch.set(db.doc("site_settings/semester_active"), { semesterId: "2026-2", revision: 1 });
  batch.set(db.doc("semester_manifests/2026-2"), { semesterId: "2026-2", status: "ACTIVE", revision: 1 });
  for (const uid of students) {
    batch.set(db.doc(`users/${uid}`), { role: "student", name: uid });
    batch.set(db.doc(`application_sessions/${uid}/sessions/${authTime}`), { uid, email: `${uid}@yongshin-ms.ms.kr`, authTime,
      status: "active", schemaVersion: authority.SESSION_SCHEMA_VERSION, authorityGeneration: proof.authorityGeneration,
      protocolVersion: proof.protocolVersion, sessionRevision: proof.revision, authorityModeAtOpen: "ENFORCE",
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600_000), highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    batch.set(db.doc(attemptPath(uid)), { attemptId: attemptId(uid), studentUid: uid, semesterId: "2026-2",
      definitionId: "quiz:2026-2:exam_prep:exam_prep:round_1", assessmentKind: "QUIZ", sourceId: "exam_prep",
      category: "exam_prep", examRound: "round_1", status: "STARTED", revision: 1, questionIds: ["q1"],
      questionDocumentIds: { q1: "q1" }, gradingSnapshot: [{ id: "q1", answer: "가".repeat(80), answerLimit: 100 }],
      startedAtIso: new Date(Date.now() - 10_000).toISOString(), deadlineAtIso: new Date(Date.now() + 600_000).toISOString(),
      answers: {}, questionSnapshots: [frozenQuestion], paperHeader: { paperTitle: "보존할 합성 시험지" } });
  }
  await batch.commit();
  const payloads = students.map(payload);
  const started = performance.now();
  const saved = await Promise.all(students.map((uid, index) => invoke(`initial:${uid}`, uid, payloads[index])));
  assert.ok(saved.every(item => item.revision === 2 && item.replayed === false));
  const initial = observations.filter(item => item.label.startsWith("initial:"));
  assert.equal(initial.length, 30, "Independent saves must not retry a transaction");
  for (const observation of initial) {
    assert.equal(observation.readOnly, false);
    assert.equal(observation.writes.length, 1);
    const reads = observation.reads.filter(read => read.path.startsWith("semester_assessment_attempts/"));
    assert.equal(reads.length, 1);
    assert.ok(reads[0].fields?.includes("gradingSnapshot"));
    assert.equal(reads[0].fields.includes("questionSnapshots"), false);
  }
  const records = await db.getAll(...students.map(uid => db.doc(attemptPath(uid))));
  for (const record of records) {
    assert.equal(record.data().revision, 2);
    assert.deepEqual(record.data().questionSnapshots, [frozenQuestion]);
    assert.deepEqual(record.data().answers, payloads[0].answers);
  }
  const elapsedMs = Math.round(performance.now() - started);
  const repeated = await invoke("receipt-replay", students[0], payloads[0]);
  assert.equal(repeated.replayed, true);
  assert.equal(observations.find(item => item.label === "receipt-replay").writes.length, 0);
  await assert.rejects(invoke("foreign-owner", students[1], { ...payloads[0], saveId: randomUUID() }), reason("ASSESSMENT_ATTEMPT_FORBIDDEN"));
  assert.equal(observations.find(item => item.label === "foreign-owner").writes.length, 0);
  const lost = { ...payloads[0], expectedRevision: 2, answers: { q1: "조선" }, saveId: randomUUID() };
  await assert.rejects(invoke("lost-response", students[0], { ...lost, _testDropResponseAfterCommit: true }), reason("TEST_RESPONSE_LOSS"));
  const recovered = await invoke("lost-response-retry", students[0], lost);
  assert.equal(recovered.revision, 3);
  assert.equal(recovered.replayed, true);
  assert.equal(observations.find(item => item.label === "lost-response-retry").writes.length, 0);
  assert.equal((await db.doc(attemptPath(students[0])).get()).data().revision, 3);
  console.log(JSON.stringify({ suite: "assessment-save-firestore-integration", passed: true, concurrentStudents: 30,
    initialTransactions: initial.length, initialAttemptReads: 30, initialWrites: 30, replayAdditionalWrites: 0,
    projectedAttemptBytes: initial[0].reads.find(read => read.fields?.includes("gradingSnapshot")).bytes,
    emulatorElapsedMs: elapsedMs, productionDataAccess: 0,
    checks: "Actual callable session/owner checks, Firestore projection, frozen paper preservation, simultaneous saves, receipt replay and committed-response-loss recovery" }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.terminate();
  await deleteApp(getApp());
});
