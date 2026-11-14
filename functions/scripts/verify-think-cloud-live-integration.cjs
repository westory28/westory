const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

// Only this disposable emulator can receive fixtures or the reset request.
const projectId = process.env.GCLOUD_PROJECT || "";
assert.equal(projectId, "demo-westory-session-think-cloud");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18431");
const sourceDirectory = process.env.THINK_CLOUD_GATEWAY_DIR
  ? path.resolve(process.env.THINK_CLOUD_GATEWAY_DIR) : path.resolve(__dirname, "../productionGateway");
const { getApps, initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const app = getApps()[0] || initializeApp({ projectId });
const db = getFirestore(app);
const gateway = require(path.join(sourceDirectory, "commandGateway"));
const w8 = (() => {
  if (!process.env.THINK_CLOUD_BASELINE_FILE) return require(path.join(sourceDirectory, "w8Domains"));
  const { Module } = require("node:module");
  const { readFileSync } = require("node:fs");
  const baseline = new Module(path.join(sourceDirectory, "w8Domains.js"), module);
  baseline.filename = path.join(sourceDirectory, "w8Domains.js");
  baseline.paths = Module._nodeModulePaths(sourceDirectory);
  baseline._compile(readFileSync(process.env.THINK_CLOUD_BASELINE_FILE, "utf8"), baseline.filename);
  return baseline.exports;
})();
const enrollment = require(path.join(sourceDirectory, "archiveEnrollment"));
const { createThinkCloudSubmitQueue } = require(path.join(sourceDirectory, "thinkCloudSubmitQueue"));
const maintenance = require(path.join(sourceDirectory, "studentMaintenance"));
const labels = new AsyncLocalStorage();
const observations = [];
const runTransaction = db.runTransaction.bind(db);
db.runTransaction = (callback, options) => runTransaction(async (transaction) => {
  const observation = { label: labels.getStore(), readOnly: options?.readOnly === true, reads: [], writes: [] };
  observations.push(observation);
  const get = transaction.get.bind(transaction);
  transaction.get = async (...args) => {
    const snapshot = await get(...args);
    observation.reads.push({ path: args[0].path || args[0]._queryOptions?.parentPath?.formattedName,
      count: Array.isArray(snapshot.docs) ? snapshot.docs.length : Number(snapshot.exists),
      documents: Array.isArray(snapshot.docs) ? snapshot.docs.map((row) => row.ref.path) : [snapshot.ref.path],
    });
    return snapshot;
  };
  const getAll = transaction.getAll.bind(transaction);
  transaction.getAll = async (...args) => {
    const snapshots = await getAll(...args);
    observation.reads.push(...snapshots.map((row) => ({ path: row.ref.path, count: Number(row.exists), documents: [row.ref.path] })));
    return snapshots;
  };
  for (const method of ["set", "create", "delete"]) {
    const original = transaction[method].bind(transaction);
    transaction[method] = (reference, ...args) => {
      observation.writes.push({ method, path: reference.path });
      return original(reference, ...args);
    };
  }
  return callback(transaction);
}, options);

const semesterId = "2026-2";
const root = "years/2026/semesters/2";
const sessionId = "synthetic-think-topic";
const sessionPath = `${root}/think_cloud_sessions/${sessionId}`;
const responsePath = `${sessionPath}/responses`;
const statePath = `${root}/think_cloud_state/synthetic-class`;
const indexPath = `${sessionPath}/private/index`;
const atLimit = process.env.THINK_CLOUD_AT_LIMIT === "1";
const legacyResponseCount = atLimit ? 199 : 1;
const students = Array.from({ length: 30 }, (_, index) => `synthetic-think-${index}`);
const assertSession = async (request) => ({ uid: request.auth.uid, email: request.auth.token.email });
const adapter = w8.createW8CommandAdapter();
const createCommands = () => gateway.createCommandGatewayCore({
  store: gateway.createFirestoreStore(db), assertSession,
  authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: request.auth.token.email,
    actorRole: request.auth.uid === "synthetic-teacher" ? "teacher" : "student" }),
  commandAdapters: Object.fromEntries(Object.values(w8.W8_COMMAND_TYPES).map((type) => [type, adapter])),
  projectId,
});
const commands = createCommands();
const queueInstances = Number(process.env.THINK_CLOUD_QUEUE_INSTANCES || 0);
assert.ok(Number.isInteger(queueInstances) && queueInstances >= 0 && queueInstances <= 4);
const maintenanceService = maintenance.createStudentMaintenanceService({ db });
const executors = Array.from({ length: queueInstances }, () => {
  const core = createCommands();
  return maintenance.withStudentMaintenanceGuard(createThinkCloudSubmitQueue(core.execute, {
    dequeuedExecute: maintenance.withStudentMaintenanceGuard(core.execute, { service: maintenanceService }),
  }), { service: maintenanceService });
});
const submitCommand = (input, index) => queueInstances ? executors[index % queueInstances](input) : commands.execute(input);
const queryCore = w8.createW8QueryCore({ store: gateway.createFirestoreStore(db, { readOnly: true }), assertSession });
const command = (uid, extra = {}) => ({
  auth: { uid, token: { email: `${uid}@synthetic.invalid` } },
  data: { commandId: randomUUID(), commandType: "submitThinkCloudResponse", payload: {
    semesterId, expectedSemesterRevision: 1, sessionId, expectedSessionRevision: 7,
    textRaw: "조선", textNormalized: "조선",
  }, ...extra },
});
const query = (projection, cursor) => queryCore.getW8DomainState({
  auth: { uid: students[0], token: { email: `${students[0]}@synthetic.invalid` } },
  data: { semesterId, domain: "LEARNING", source: "CURRENT", audience: "student", projection, sessionId,
    ...(cursor !== undefined ? { afterResponseSequence: cursor } : {}),
  },
});

(async () => {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(cleared.ok, true, "reset is limited to the guarded local demo project");
  if (process.env.THINK_CLOUD_COUNTER_PROBE === "1") {
    const ref = db.doc("synthetic_counter/only");
    await ref.set({ count: 0 });
    const start = performance.now();
    const outcomes = await Promise.allSettled(Array.from({ length: 30 }, () => db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      transaction.set(ref, { count: current.data().count + 1 });
    })));
    console.log(JSON.stringify({ suite: "firestore-single-counter-control", concurrentTransactions: 30,
      fulfilled: outcomes.filter((result) => result.status === "fulfilled").length,
      failures: outcomes.filter((result) => result.status === "rejected").map((result) => ({ code: result.reason.code, message: result.reason.message })),
      count: (await ref.get()).data().count, elapsedMs: Math.round(performance.now() - start), transactionAttempts: observations.length,
    }));
    return;
  }
  const batch = db.batch();
  batch.set(db.doc("site_settings/config"), { year: "2026", semester: "2", activeSemesterId: semesterId });
  batch.set(db.doc("site_settings/semester_active"), { semesterId, revision: 1 });
  batch.set(db.doc(`semester_manifests/${semesterId}`), { semesterId, status: "ACTIVE", revision: 1 });
  batch.set(db.doc("semester_classes/synthetic-class"), {
    semesterId, classId: "synthetic-class", status: "ACTIVE", grade: "3", classNumber: "1", homeroomTeacherUid: "synthetic-teacher",
  });
  batch.set(db.doc("users/synthetic-teacher"), { role: "teacher", name: "합성 교사" });
  const prepareResume = process.env.THINK_CLOUD_PREPARE_RESUME === "1";
  batch.set(db.doc(sessionPath), {
    semesterId, sessionId, targetClassId: "synthetic-class", targetGrade: "3", targetClass: "1", title: "합성 동시 제출 검사",
    revision: prepareResume ? 6 : 7, status: prepareResume ? "paused" : "active", createdAt: Timestamp.now(),
    options: { anonymous: true, allowDuplicateWord: true, allowDuplicateByStudent: process.env.THINK_CLOUD_DUPLICATES_ALLOWED === "1", inputMode: "word", maxLength: 100 },
  });
  batch.set(db.doc(statePath), { semesterId, classId: "synthetic-class", activeSessionId: prepareResume ? "" : sessionId, revision: prepareResume ? 3 : 4 });
  if (process.env.THINK_CLOUD_INITIALIZED_COUNT === "1") batch.set(db.doc(indexPath), {
    responseCount: legacyResponseCount, studentHashes: Array.from({ length: legacyResponseCount }, (_, index) =>
      createHash("sha256").update(index ? `synthetic-legacy-${index}` : "synthetic-legacy").digest("hex")),
    wordHashes: [createHash("sha256").update("백제").digest("hex")],
  });
  batch.set(db.doc(`${responsePath}/legacy`), { uid: "synthetic-legacy", displayName: "공개 금지", textRaw: "백제", textNormalized: "백제" });
  for (let index = 1; index < legacyResponseCount; index++) batch.set(db.doc(`${responsePath}/legacy-${index}`), {
    uid: `synthetic-legacy-${index}`, textRaw: "백제", textNormalized: "백제",
  });
  for (const uid of students) {
    batch.set(db.doc(`users/${uid}`), { role: "student", name: uid, grade: "3", class: "1" });
    batch.set(db.doc(`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`), {
      semesterId, studentUid: uid, status: "ACTIVE", activeEnrollmentId: `enrollment-${uid}`,
    });
    batch.set(db.doc(`semester_enrollments/enrollment-${uid}`), {
      semesterId, enrollmentId: `enrollment-${uid}`, studentUid: uid, classId: "synthetic-class", enrollmentStatus: "ACTIVE",
    });
  }
  await batch.commit();
  if (prepareResume) {
    await labels.run("teacher-resume", () => commands.execute({
      auth: { uid: "synthetic-teacher", token: { email: "synthetic-teacher@synthetic.invalid" } },
      data: { commandId: randomUUID(), commandType: "transitionThinkCloudSession", payload: {
        semesterId, expectedSemesterRevision: 1, sessionId, expectedSessionRevision: 6, expectedStateRevision: 3, targetStatus: "active",
      } },
    }));
    assert.equal((await db.doc(indexPath).get()).data().responseCount, legacyResponseCount);
  }
  const initial = await labels.run("initial", () => query("think-cloud"));
  assert.equal(initial.thinkCloudState.responseRevision || 0, 0);
  assert.equal(initial.thinkCloudResponses.length, legacyResponseCount);
  assert.equal(initial.thinkCloudResponses[0].sequence || 0, 0);
  const inputs = students.map((uid) => command(uid));
  const started = performance.now();
  let settled = await Promise.allSettled(inputs.map((input, index) => labels.run(`submit:${index}`, () => submitCommand(input, index))));
  const firstAttemptElapsedMs = Math.round(performance.now() - started);
  const firstAttemptFailed = settled.filter((result) => result.status === "rejected").length;
  if (atLimit) {
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(settled.filter((result) => result.status === "rejected").every((result) => result.reason.details?.reason === "W8_THINK_CLOUD_RESPONSE_LIMIT"));
    assert.equal((await db.collection(responsePath).get()).size, 200);
    assert.equal((await db.doc(indexPath).get()).data().responseCount, 200);
    assert.equal((await db.doc(statePath).get()).data().responseRevision, 1);
    await labels.run("teacher-delete", () => commands.execute({
      auth: { uid: "synthetic-teacher", token: { email: "synthetic-teacher@synthetic.invalid" } },
      data: { commandId: randomUUID(), commandType: "deleteThinkCloudSession", payload: {
        semesterId, expectedSemesterRevision: 1, sessionId, expectedSessionRevision: 7, expectedStateRevision: 4, reason: "합성 상한 삭제 검사",
      } },
    }));
    assert.equal((await db.doc(indexPath).get()).exists, false);
    assert.equal((await db.doc(sessionPath).get()).exists, false);
    assert.equal((await db.collection(responsePath).get()).size, 0);
    const deletionWrites = observations.filter((row) => row.label === "teacher-delete").flatMap((row) => row.writes).length;
    assert.equal(deletionWrites, 205);
    console.log(JSON.stringify({ suite: "think-cloud-200-limit-firestore", passed: true, queueInstances, concurrentStudents: 30,
      accepted: 1, limitRejected: 29, firstAttemptElapsedMs, legacyResponseCount, finalResponseCount: 200, deletionWrites,
      privateIndexDeleted: true, productionDataAccess: 0 }));
    return;
  }
  const recoveryLimit = Number(process.env.THINK_CLOUD_RECOVERY_ROUNDS || 0);
  assert.ok(Number.isInteger(recoveryLimit) && recoveryLimit >= 0 && recoveryLimit <= 2);
  let recoveryRequests = 0, recoveryRounds = 0;
  // Simulate an explicit retry with the same durable command ID, not an
  // unbounded service retry or a relaxed transaction/CAS policy.
  for (let round = 0; round < recoveryLimit; round++) {
    const failed = settled.map((result, index) => ({ result, index })).filter(({ result }) =>
      result.status === "rejected" && (result.reason.code === 10 || result.reason.details?.retryable === true));
    if (!failed.length) break;
    recoveryRounds++;
    recoveryRequests += failed.length;
    const recovered = await Promise.allSettled(failed.map(({ index }) => labels.run(`submit-retry:${round}:${index}`, () => submitCommand(inputs[index], index))));
    const replacements = new Map(failed.map(({ index }, offset) => [index, recovered[offset]]));
    settled = settled.map((result, index) => replacements.get(index) || result);
  }
  const elapsedMs = Math.round(performance.now() - started);
  if (settled.some((result) => result.status === "rejected") || process.env.THINK_CLOUD_BASELINE_FILE) {
    const completedResponses = await db.collection(responsePath).get();
    console.log(JSON.stringify({ suite: "think-cloud-concurrency-observation", baseline: Boolean(process.env.THINK_CLOUD_BASELINE_FILE),
      concurrentStudents: 30, queueInstances, elapsedMs, firstAttemptElapsedMs, firstAttemptFailed, recoveryRequests, recoveryRounds,
      fulfilled: settled.filter((result) => result.status === "fulfilled").length,
      failures: settled.filter((result) => result.status === "rejected").map((result) => ({ code: result.reason.code, message: result.reason.message })),
      committedResponses: completedResponses.size - 1,
      transactionAttempts: observations.filter((row) => row.label?.startsWith("submit:")).length,
    }));
    if (process.env.THINK_CLOUD_BASELINE_FILE) return;
  }
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  const outcomes = settled.map((result) => result.value);
  assert.equal(outcomes.length, 30);
  assert.ok(outcomes.every((outcome) => outcome.replayed === false));
  const [state, session, responses] = await Promise.all([
    db.doc(statePath).get(), db.doc(sessionPath).get(), db.collection(responsePath).get(),
  ]);
  assert.equal(state.data().revision, 4);
  assert.equal(state.data().responseRevision, 30);
  assert.equal(state.data().responseSessionId, sessionId);
  assert.equal(session.data().revision, 7);
  assert.equal((await db.doc(indexPath).get()).data().responseCount, 31);
  assert.equal(responses.size, 31);
  assert.deepEqual(responses.docs.filter((row) => row.id !== "legacy").map((row) => row.data().sequence).sort((a, b) => a - b), Array.from({ length: 30 }, (_, index) => index + 1));
  for (const [label, cursor, expected] of [["delta", 25, 5], ["empty-delta", 30, 0]]) {
    const result = await labels.run(label, () => query("think-cloud-delta", cursor));
    assert.equal(result.thinkCloudResponses.length, expected);
    assert.equal(result.thinkCloudState.responseRevision, 30);
    assert.ok(result.thinkCloudResponses.every((row) => row.sequence > cursor && row.uid === undefined && row.displayName === undefined));
    const observed = observations.filter((row) => row.label === label);
    assert.ok(observed.every((row) => row.readOnly && row.writes.length === 0));
    const responseReads = observed.flatMap((row) => row.reads).filter((read) => read.documents.some((document) => document.startsWith(`${responsePath}/`)));
    assert.equal(responseReads.reduce((total, read) => total + read.count, 0), expected);
    assert.ok(observed.flatMap((row) => row.reads).flatMap((read) => read.documents)
      .every((document) => !document.startsWith("semester_learning_") && !document.endsWith("/legacy")));
  }
  const replay = await labels.run("replay", () => commands.execute(inputs[0]));
  assert.equal(replay.replayed, true);
  assert.equal(observations.filter((row) => row.label === "replay").flatMap((row) => row.writes).length, 0);
  assert.equal((await db.doc(statePath).get()).data().responseRevision, 30);
  assert.equal((await db.collection(responsePath).get()).size, 31);
  const submitted = observations.filter((row) => row.label?.startsWith("submit:"));
  console.log(JSON.stringify({ suite: "think-cloud-live-firestore", passed: true, concurrentStudents: 30, queueInstances,
    elapsedMs, firstAttemptElapsedMs, firstAttemptFailed, recoveryRequests, recoveryRounds,
    transactionAttempts: submitted.length, recoveryTransactionAttempts: observations.filter((row) => row.label?.startsWith("submit-retry:")).length,
    committedResponseCount: 30, committedSignalWrites: 30,
    classOperationalRevision: 4, sessionOperationalRevision: 7, responseSequence: 30,
    initializedCount: process.env.THINK_CLOUD_INITIALIZED_COUNT === "1",
    teacherResumePrepared: prepareResume,
    duplicateQueriesDisabled: process.env.THINK_CLOUD_DUPLICATES_ALLOWED === "1",
    initialLegacyResponseCount: 1, deltaResponseReads: 5, unchangedDeltaResponseReads: 0,
    replayAdditionalWrites: 0, productionDataAccess: 0,
    limits: "Actual Firestore transactions and query filtering; injected session identity. Local emulator timing is not a production latency guarantee." }));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.terminate();
  await deleteApp(app);
});
