const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Never run synthetic academic mutations against a real Firebase project.
const projectId = process.env.GCLOUD_PROJECT || "";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(projectId, /^demo-westory-session-[a-z0-9-]+$/);
assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const app = initializeApp({ projectId });
const db = getFirestore(app);
db.settings({ host: emulatorHost, ssl: false });
const assessment = require("../assessmentLifecycle");
const gateway = require("../commandGateway");
const enrollment = require("../archiveEnrollment");
const sessionAuthority = require("../sessionAuthority");
const wis = require("../wisEconomy");
const production = require("../productionSource");
const semesterId = "2026-2";
const root = "years/2026/semesters/2";
const definitionId = "history_classroom:2026-2:history-one";
const students = Array.from({ length: 34 }, (_, i) => `student-${i + 1}`);
const authTime = Math.floor(Date.now() / 1000) - 10 * 60;
const teacher = { uid: "teacher", token: { email: "teacher@yongshin-ms.ms.kr", auth_time: authTime } };
const student = (uid = students[0]) => ({ uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } });
const sessionProof = { authorityGeneration: sessionAuthority.SESSION_AUTHORITY_GENERATION,
  protocolVersion: sessionAuthority.MIN_CLIENT_PROTOCOL_VERSION, revision: "a".repeat(64) };
const authenticatedRequest = (auth, data) => ({ auth, data: { ...data, _session: sessionProof } });
let nowMs = Date.parse("2026-10-15T00:00:00.000Z");
const adapter = assessment.createAssessmentCommandAdapter({ now: () => new Date(nowMs),
  wisRewards: { prepare: async () => ({ refs: [], result: { status: "DISABLED", totalAwarded: 0 }, apply() {} }) } });
const store = gateway.createFirestoreStore(db);
const core = gateway.createCommandGatewayCore({ store, projectId,
  serverTimestamp: () => FieldValue.serverTimestamp(), concreteTimestamp: () => Timestamp.fromMillis(nowMs),
  assertSession: async (request) => ({ uid: request.auth.uid, email: request.auth.token.email }),
  authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: request.auth.token.email,
    actorRole: request.auth.uid === teacher.uid ? "teacher" : "student" }),
  commandAdapters: Object.fromEntries(Object.values(assessment.ASSESSMENT_COMMAND_TYPES).map((type) => [type, adapter])),
});
const query = assessment.createAssessmentQueryCore({ store, projectId, now: () => new Date(nowMs),
  serverTimestamp: () => FieldValue.serverTimestamp(), assertSession: async (request) => ({ uid: request.auth.uid }) });
const execute = (auth, commandType, payload, commandId = randomUUID()) => core.execute({ auth, data: { commandId, commandType, payload } });
// Exercise the deployed callable wiring, session policy and capability checks for
// exemptions; the domain-only core below still isolates reward/attempt fixtures.
const executeAuthenticated = (auth, commandType, payload, commandId = randomUUID()) =>
  production.executeCommand.run(authenticatedRequest(auth, { commandId, commandType, payload }));
const authenticatedStatus = (auth, commandType, commandId) =>
  production.getCommandStatus.run(authenticatedRequest(auth, { commandId, commandType }));
const get = async (path) => (await db.doc(path).get()).data();
const count = async (path) => (await db.collection(path).get()).size;
const expectCode = (code) => (error) => error.code === code;
const probeGrant = async (payload, failedBatch = 0) => {
  const rollback = new Error("Rollback synthetic grant probe.");
  const readFailure = new Error("Synthetic batch read failure.");
  const metrics = { readCalls: 0, readDocuments: 0, batches: 0, writes: 0, createdCount: 0, elapsedMs: 0 };
  let timeout;
  const operation = store.runTransaction(async (transaction) => {
    const started = performance.now();
    const measured = {
      ...transaction,
      get: async (path) => { metrics.readCalls += 1; metrics.readDocuments += 1; return transaction.get(path); },
      getAll: async (paths) => {
        metrics.readCalls += 1; metrics.readDocuments += paths.length; metrics.batches += 1;
        if (metrics.batches === failedBatch) throw readFailure;
        return transaction.getAll(paths);
      },
      query: async (...args) => {
        metrics.readCalls += 1;
        const rows = await transaction.query(...args);
        metrics.readDocuments += rows.length;
        return rows;
      },
      create: (...args) => { metrics.writes += 1; return transaction.create(...args); },
    };
    const result = await adapter.apply({ transaction: measured, commandId: randomUUID(),
      commandType: "grantHistoryClassroomExemptions", payload: assessment.normalizeAssessmentPayload("grantHistoryClassroomExemptions", payload),
      actor: { actorUid: teacher.uid, actorRole: "teacher" }, timestamp: FieldValue.serverTimestamp() });
    metrics.createdCount = result.result.createdCount;
    metrics.elapsedMs = Math.round((performance.now() - started) * 10) / 10;
    throw rollback; // Timing probes must not create additional tickets.
  });
  try {
    await assert.rejects(Promise.race([operation, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Grant reads did not settle.")), 10_000);
    })]), (error) => error === (failedBatch ? readFailure : rollback));
  } finally { clearTimeout(timeout); }
  if (failedBatch) assert.equal(metrics.writes, 0, "a failed batch must reject every pending reader before any write");
  return metrics;
};

(async () => {
  const batch = db.batch();
  const seed = {
    "site_settings/config": { year: "2026", semester: "2", activeSemesterId: semesterId },
    "site_settings/semester_active": { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 1 },
    "users/teacher": { role: "teacher", teacherPortalEnabled: true, staffPermissions: ["quiz_read"] },
    "users/disabled-quiz-staff": { role: "staff", teacherPortalEnabled: false, staffPermissions: ["quiz_read"] },
    [`${wis.WIS_ECONOMY_COLLECTION}/${semesterId}`]: { semesterId, status: "ACTIVE_OPEN", revision: 1, ledgerEntryCount: 0 },
    "semester_classes/class_one": { semesterId, classId: "class_one", grade: "3", classNumber: "2", status: "ACTIVE" },
    [`${root}/history_classrooms/history-one`]: { title: "합성 역사교실", sourceType: "lesson", lessonUnitId: "unit-one", mapResourceId: "", isPublished: true, targetStudentUids: students,
      blanks: [{ id: "blank-1", answer: "고려" }], passThresholdPercent: 100 },
  };
  for (const uid of students) {
    seed[`users/${uid}`] = { role: "student", name: `합성 ${uid}` };
    seed[`student_identities/${uid}`] = { studentUid: uid };
    seed[`semester_enrollments/enrollment_${uid}`] = { semesterId, studentUid: uid, enrollmentId: `enrollment_${uid}`,
      classId: "class_one", enrollmentStatus: "ACTIVE", studentNumber: uid.split("-")[1] };
    seed[`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `enrollment_${uid}` };
    const accountId = wis.accountIdFor(semesterId, uid);
    seed[`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`] = { schemaVersion: 1, policyVersion: wis.WIS_POLICY_VERSION,
      accountId, studentUid: uid, semesterId, enrollmentId: `enrollment_${uid}`, classId: "class_one", status: "ACTIVE", revision: 1,
      displayName: `합성 ${uid}`, grade: "3", classNumber: "2", studentNumber: uid.split("-")[1],
      balance: 0, earnedTotal: 0, rankEarnedTotal: 0, adjustedTotal: 0, spentTotal: 0, recentLedgerEntries: [] };
  }
  for (const auth of [teacher, ...students.map((uid) => student(uid))]) {
    seed[`application_sessions/${auth.uid}/sessions/${authTime}`] = {
      uid: auth.uid, email: auth.token.email, authTime, status: "active",
      schemaVersion: sessionAuthority.SESSION_SCHEMA_VERSION,
      authorityGeneration: sessionProof.authorityGeneration, protocolVersion: sessionProof.protocolVersion,
      sessionRevision: sessionProof.revision, authorityModeAtOpen: "ENFORCE",
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 60 * 1000),
    };
  }
  for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data);
  await batch.commit();
  console.log("Seeded isolated History Classroom emulator fixture.");
  const created = await execute(teacher, "createAssessmentDefinition", { definitionId, semesterId, assessmentKind: "HISTORY_CLASSROOM",
    title: "합성 역사교실", sourceId: "history-one", durationSeconds: 600, maxAttempts: 5, cooldownMinutes: 0, opensAt: "", closesAt: "", assignedClassIds: ["3-2"] });
  await execute(teacher, "transitionAssessmentDefinition", { definitionId, expectedRevision: created.result.definition.revision, targetStatus: "PUBLISHED", reason: "합성 검증" });

  const authoredId = "history_classroom:2026-2:history-authored";
  const authoredSource = { title: "조선의 건국", sourceType: "lesson", lessonUnitId: "unit-one", mapResourceId: "",
    isPublished: true, targetStudentUids: students.slice(0, 2), targetStudentReasons: Object.fromEntries(students.slice(0, 2).map(uid => [uid, "지각"])),
    blanks: Array.from({ length: 28 }, (_, index) => ({ id: `blank-${index + 1}`, answer: `정답 ${index + 1}` })),
    timeLimitMinutes: 10, cooldownMinutes: 5, passThresholdPercent: 90, dueWindowDays: null, dueAt: null, publishedAt: "2026-10-15T00:00:00.000Z" };
  const sourceSaveId = randomUUID();
  const sourceSavePayload = { semesterId, sourceId: "history-authored", source: authoredSource, expectedRevision: 0, reason: "합성 신규 저장" };
  await assert.rejects(executeAuthenticated(student(), "upsertHistoryClassroomSource", sourceSavePayload), expectCode("permission-denied"));
  assert.equal(await get(`${root}/history_classrooms/history-authored`), undefined);
  const authoredSave = await executeAuthenticated(teacher, "upsertHistoryClassroomSource", sourceSavePayload, sourceSaveId);
  assert.equal(authoredSave.result.contentRevision, 1);
  assert.equal((await authenticatedStatus(teacher, "upsertHistoryClassroomSource", sourceSaveId)).result.contentRevision, 1);
  assert.equal((await executeAuthenticated(teacher, "upsertHistoryClassroomSource", sourceSavePayload, sourceSaveId)).replayed, true);
  const authoredPayload = { definitionId: authoredId, semesterId, assessmentKind: "HISTORY_CLASSROOM", sourceId: "history-authored",
    title: authoredSource.title, durationSeconds: 600, maxAttempts: 20, cooldownMinutes: 5, opensAt: "", closesAt: "", assignedClassIds: [], expectedSourceRevision: 1 };
  await assert.rejects(executeAuthenticated(teacher, "createAssessmentDefinition", { ...authoredPayload, expectedSourceRevision: 0 }),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.equal(await get(`semester_assessment_definitions/${authoredId}`), undefined);
  await executeAuthenticated(teacher, "createAssessmentDefinition", authoredPayload);
  await executeAuthenticated(teacher, "updateAssessmentDefinition", { ...authoredPayload, expectedRevision: 1, reason: "합성 설정 확인" });
  await assert.rejects(executeAuthenticated(teacher, "transitionAssessmentDefinition", { definitionId: authoredId,
    expectedRevision: 2, expectedSourceRevision: 0, targetStatus: "PUBLISHED", reason: "합성 충돌" }),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.equal((await get(`semester_assessment_definitions/${authoredId}`)).status, "DRAFT");
  await executeAuthenticated(teacher, "transitionAssessmentDefinition", { definitionId: authoredId,
    expectedRevision: 2, expectedSourceRevision: 1, targetStatus: "PUBLISHED", reason: "합성 공개" });
  const authoredDefinition = await get(`semester_assessment_definitions/${authoredId}`);
  assert.equal(authoredDefinition.status, "PUBLISHED");
  assert.equal(authoredDefinition.durationSeconds, 600);
  assert.equal(authoredDefinition.cooldownMinutes, 5);
  assert.equal(authoredDefinition.itemCount, 28);
  assert.equal(authoredDefinition.closesAt, "");
  assert.equal(authoredDefinition.sourceContentRevision, 1);
  assert.equal("expectedSourceRevision" in authoredDefinition, false);
  assert.deepEqual(authoredDefinition.assignedStudentUids, students.slice(0, 2));
  assert.equal((await get(`${root}/history_classrooms/history-authored`)).passThresholdPercent, 90);
  const authoredStart = await executeAuthenticated(student(), "startAssessmentAttempt", { definitionId: authoredId });
  assert.equal((await get(`semester_assessment_attempts/${authoredStart.result.attemptId}`)).passThresholdPercent, 90);
  assert.equal(authoredStart.result.questionIds.length, 28);
  await assert.rejects(executeAuthenticated(student(students[2]), "startAssessmentAttempt", { definitionId: authoredId }),
    (error) => error.details?.reason === "ASSESSMENT_STUDENT_NOT_ASSIGNED");
  console.log("PASS actual callable source/create/update/publish/start: 10-minute-old teacher session, 28 blanks, 2 target students, 90% pass, 600 seconds, 5-minute retry, no due period; CAS/session/role guards retained");

  const saveMetrics = { previous: [], atomic: [] };
  for (let index = 0; index < 3; index += 1) {
    for (const mode of ["previous", "atomic"]) {
      const sourceId = `benchmark-${mode}-${index}`;
      const definitionId = `history_classroom:${semesterId}:${sourceId}`;
      const savePayload = { ...sourceSavePayload, sourceId };
      let commands = 0;
      const call = async (type, payload) => { commands += 1; return executeAuthenticated(teacher, type, payload); };
      const started = performance.now();
      if (mode === "previous") {
        await call("upsertHistoryClassroomSource", savePayload);
        const created = await call("createAssessmentDefinition", { ...authoredPayload, definitionId, sourceId });
        await call("transitionAssessmentDefinition", { definitionId, expectedRevision: created.result.definition.revision,
          expectedSourceRevision: 1, targetStatus: "PUBLISHED", reason: "합성 이전 저장" });
      } else {
        const saved = await call("saveHistoryClassroomAssignment", savePayload);
        assert.equal(saved.result.contentRevision, 1);
        assert.equal(saved.result.status, "PUBLISHED");
      }
      saveMetrics[mode].push({ commands, elapsedMs: Math.round((performance.now() - started) * 10) / 10 });
      assert.equal(commands, mode === "previous" ? 3 : 1);
      assert.equal((await get(`semester_assessment_definitions/${definitionId}`)).status, "PUBLISHED");
    }
  }
  console.log(`ASSIGNMENT_SAVE_BENCHMARK ${JSON.stringify(saveMetrics)}`);
  const atomicPayload = { ...sourceSavePayload, sourceId: "atomic-replay" };
  const atomicId = randomUUID();
  await assert.rejects(executeAuthenticated(student(), "saveHistoryClassroomAssignment", atomicPayload), expectCode("permission-denied"));
  const [atomicSaved, atomicReplay] = await Promise.all([
    executeAuthenticated(teacher, "saveHistoryClassroomAssignment", atomicPayload, atomicId),
    executeAuthenticated(teacher, "saveHistoryClassroomAssignment", atomicPayload, atomicId),
  ]);
  assert.equal(atomicSaved.result.contentRevision, 1);
  assert.equal(atomicReplay.result.contentRevision, 1);
  assert.deepEqual((await authenticatedStatus(teacher, "saveHistoryClassroomAssignment", atomicId)).result, atomicSaved.result);
  const atomicDefinitionRef = `semester_assessment_definitions/history_classroom:${semesterId}:atomic-replay`;
  assert.equal((await get(atomicDefinitionRef)).revision, 1);
  const originalAtomicDefinition = await get(atomicDefinitionRef);
  const originalAtomicSource = await get(`${root}/history_classrooms/atomic-replay`);
  for (const source of [{ ...authoredSource, blanks: [] }, { ...authoredSource, timeLimitMinutes: 1000 }, { ...authoredSource, dueAt: "bad-date" }]) {
    await assert.rejects(executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...atomicPayload, source, expectedRevision: 1 }));
    assert.deepEqual(await get(`${root}/history_classrooms/atomic-replay`), originalAtomicSource);
    assert.deepEqual(await get(atomicDefinitionRef), originalAtomicDefinition);
  }
  const competing = await Promise.allSettled([
    executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...atomicPayload, expectedRevision: 1, source: { ...authoredSource, timeLimitMinutes: 20 } }),
    executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...atomicPayload, expectedRevision: 1, source: { ...authoredSource, timeLimitMinutes: 30 } }),
  ]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  const competedSource = await get(`${root}/history_classrooms/atomic-replay`);
  const competedDefinition = await get(atomicDefinitionRef);
  assert.equal(competedSource.contentRevision, 2);
  assert.equal(competedDefinition.sourceContentRevision, 2);
  assert.equal(competedDefinition.durationSeconds, competedSource.timeLimitMinutes * 60);
  console.log("PASS atomic save: role guard, same-command replay/status, full rollback, competing revisions preserve matched source+definition");

  const grantId = randomUUID();
  const notificationsBeforeGrant = await count(`${root}/notification_inboxes/${students[0]}/items`);
  const grantPayload = { semesterId, recipientUids: students.slice(0, 32), classId: "3-2", targetGrade: "3", targetClass: "2", reason: "합성 현장체험" };
  const singleProbe = await probeGrant({ ...grantPayload, recipientUids: [students[0]] });
  const classProbes = [];
  for (let run = 0; run < 3; run += 1) classProbes.push(await probeGrant(grantPayload));
  const fullClassProbe = await probeGrant({ ...grantPayload, recipientUids: [] });
  console.log(`GRANT_READ_BENCHMARK ${JSON.stringify({ single: singleProbe, selected32: classProbes, whole34: fullClassProbe })}`);
  for (const [probe, expectedCount] of [[singleProbe, 1], ...classProbes.map((probe) => [probe, 32]), [fullClassProbe, 34]]) {
    assert.equal(probe.createdCount, expectedCount);
    assert.equal(probe.writes, expectedCount);
    assert.ok(probe.readCalls <= 4, `class grant must use a constant read budget, received ${probe.readCalls}`);
  }
  await probeGrant(grantPayload, 1);
  await probeGrant(grantPayload, 2);
  assert.equal(await count(`${root}/history_classroom_exemptions`), 0, "performance/error probes must leave no grants");
  const grantEnvelope = { commandId: grantId, commandType: "grantHistoryClassroomExemptions", payload: grantPayload };
  await assert.rejects(production.executeCommand.run({ auth: teacher, data: grantEnvelope }),
    (error) => error.details?.reason === "SESSION_PROOF_INVALID");
  const teacherSessionRef = db.doc(`application_sessions/${teacher.uid}/sessions/${authTime}`);
  await teacherSessionRef.update({ generalExpiresAt: Timestamp.fromMillis(Date.now() - 60 * 1000) });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "SESSION_EXPIRED");
  await teacherSessionRef.update({ generalExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), status: "revoked" });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "SESSION_EXPIRED");
  await teacherSessionRef.update({ status: "active" });
  await db.doc("users/teacher").update({ staffPermissions: [] });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "ASSESSMENT_MANAGE_REQUIRED");
  await db.doc("users/teacher").update({ staffPermissions: ["quiz_read"] });
  await assert.rejects(executeAuthenticated(student(), "grantHistoryClassroomExemptions", grantPayload), expectCode("permission-denied"));
  assert.equal(await count(`${root}/history_classroom_exemptions`), 0, "session/capability failures must not grant tickets");
  const [grant, replay] = await Promise.all([executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload, grantId), executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload, grantId)]);
  assert.equal(grant.result.createdCount, 32);
  assert.equal(replay.result.createdCount, 32);
  const grantStatus = await authenticatedStatus(teacher, "grantHistoryClassroomExemptions", grantId);
  assert.equal(grantStatus.status, "SUCCEEDED");
  assert.deepEqual(grantStatus.result.exemptionIds, grant.result.exemptionIds, "grant response loss recovers the same receipt");
  assert.equal(await count(`${root}/history_classroom_exemptions`), 32);
  assert.equal(await count(`${root}/notification_inboxes/${students[0]}/items`), notificationsBeforeGrant + 1, "canonical grant creates exactly one student notification, including concurrent receipt replay");
  const tickets = await db.collection(`${root}/history_classroom_exemptions`).get();
  assert.ok(tickets.docs.every((doc) => !students.slice(32).includes(doc.data().uid) && doc.data().grantScope === "class"));
  const ticketFor = (uid) => tickets.docs.find((doc) => doc.data().uid === uid).id;
  await assert.rejects(execute(student(), "grantHistoryClassroomExemptions", grantPayload), expectCode("permission-denied"));
  await assert.rejects(execute(teacher, "grantHistoryClassroomExemptions", { ...grantPayload, recipientUids: [students[0], "inactive"] }), expectCode("failed-precondition"));
  assert.equal(await count(`${root}/history_classroom_exemptions`), 32, "invalid mixed batch must not partly grant");
  const firstSlot = db.doc(`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, students[0])}`);
  await firstSlot.update({ activeEnrollmentId: "" });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "ASSESSMENT_ENROLLMENT_REQUIRED");
  await firstSlot.update({ activeEnrollmentId: `enrollment_${students[1]}` });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "ASSESSMENT_ENROLLMENT_INVALID");
  await firstSlot.update({ activeEnrollmentId: `enrollment_${students[0]}` });
  await db.doc(`users/${students[0]}`).update({ role: "teacher" });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload), expectCode("failed-precondition"));
  await db.doc(`users/${students[0]}`).update({ role: "student" });
  await db.doc("semester_classes/class_one").update({ status: "ARCHIVED" });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "HISTORY_EXEMPTION_ENROLLMENT_INVALID");
  await db.doc("semester_classes/class_one").update({ status: "ACTIVE" });
  await db.doc("site_settings/semester_active").update({ revision: 2 });
  await assert.rejects(executeAuthenticated(teacher, "grantHistoryClassroomExemptions", grantPayload),
    (error) => error.details?.reason === "ASSESSMENT_SEMESTER_NOT_ACTIVE");
  await db.doc("site_settings/semester_active").update({ revision: 1 });
  assert.equal(await count(`${root}/history_classroom_exemptions`), 32, "fresh transaction checks must reject inconsistent slot/profile/class/semester without partial grants");
  console.log("PASS actual callable: 10-minute teacher authentication, general session, proof/expiry/revocation/capability fences, class grant/replay/status/atomic batch checks.");

  const requestPayload = { semesterId, assignmentId: "history-one", exemptionId: ticketFor(students[0]), memo: "합성 요청" };
  await assert.rejects(execute(student(students[1]), "createHistoryClassroomExemptionRequest", requestPayload), expectCode("permission-denied"));
  await db.doc(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`).update({ assignmentId: "another-assignment" });
  await assert.rejects(execute(student(), "createHistoryClassroomExemptionRequest", requestPayload), expectCode("permission-denied"));
  await db.doc(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`).update({ assignmentId: "" });
  const requestCommandId = randomUUID();
  const requested = await executeAuthenticated(student(), "createHistoryClassroomExemptionRequest", requestPayload, requestCommandId);
  const requestStatus = await authenticatedStatus(student(), "createHistoryClassroomExemptionRequest", requestCommandId);
  assert.equal(requestStatus.status, "SUCCEEDED");
  assert.equal(requestStatus.result.requestId, requested.result.requestId);
  assert.equal((await get(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`)).status, "requested");
  assert.equal((await get(`${root}/notification_inboxes/teacher`)).unreadCount, 1, "the exported canonical student request reaches the teacher inbox");
  await assert.rejects(execute(teacher, "revokeHistoryClassroomExemptions", { semesterId, exemptionIds: [requestPayload.exemptionId] }), expectCode("failed-precondition"));
  const attempt = await execute(student(), "startAssessmentAttempt", { definitionId });
  const reviewed = await executeAuthenticated(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: requested.result.requestId, approved: true });
  assert.equal((await authenticatedStatus(teacher, "reviewHistoryClassroomExemptionRequest", reviewed.commandId)).status, "SUCCEEDED");
  const canonical = await get(`semester_assessment_results/${reviewed.result.resultId}`);
  const compatible = await get(`${root}/history_classroom_results/${reviewed.result.resultId}`);
  assert.equal(canonical.completionSource, "exemption");
  assert.equal(compatible.resultId, canonical.resultId);
  assert.equal(canonical.reward.totalAwarded, 0);
  assert.equal(await count(`${root}/notification_inboxes/${students[0]}/items`), notificationsBeforeGrant + 2, "canonical approval notifies the student alongside completion");
  assert.equal((await get(`semester_assessment_attempts/${attempt.result.attemptId}`)).status, "LOCKED");
  await assert.rejects(execute(student(), "startAssessmentAttempt", { definitionId }), (error) => error.details?.reason === "ASSESSMENT_ALREADY_EXEMPTED");
  const again = await executeAuthenticated(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: requested.result.requestId, approved: true });
  assert.equal(again.result.resultId, reviewed.result.resultId);
  assert.equal(await count("semester_assessment_results"), 1);
  assert.equal(await count(`${root}/notification_inboxes/${students[0]}/items`), notificationsBeforeGrant + 2, "replayed approval must not duplicate the student notification");
  console.log("PASS ticket request/approval and canonical-compatible result transaction.");

  const rejectedRequest = await execute(student(students[1]), "createHistoryClassroomExemptionRequest", { ...requestPayload, exemptionId: ticketFor(students[1]) });
  await db.doc(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`).update({ state: "pending" });
  await executeAuthenticated(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: rejectedRequest.result.requestId, approved: false, reviewReason: "합성 반려" });
  assert.equal((await get(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`)).status, "available");
  assert.equal((await get(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`)).state, "available");
  await execute(student(students[1]), "createHistoryClassroomExemptionRequest", { ...requestPayload, exemptionId: ticketFor(students[1]) });
  await execute(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: rejectedRequest.result.requestId, approved: false, reviewReason: "합성 재요청 반려" });
  const revoked = await executeAuthenticated(teacher, "revokeHistoryClassroomExemptions", { semesterId, exemptionIds: [ticketFor(students[1])] });
  assert.equal((await authenticatedStatus(teacher, "revokeHistoryClassroomExemptions", revoked.commandId)).status, "SUCCEEDED");
  assert.equal((await get(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`)).status, "revoked");

  const runner = student(students[2]);
  const started = await execute(runner, "startAssessmentAttempt", { definitionId });
  await assert.rejects(execute(teacher, "upsertHistoryClassroomSource", { semesterId, sourceId: "history-one", expectedRevision: 0,
    source: { ...seed[`${root}/history_classrooms/history-one`], blanks: [{ id: "replacement", answer: "조선" }] }, reason: "합성 교체" }),
  (error) => error.details?.reason === "ASSESSMENT_SOURCE_IN_USE");
  assert.equal((await get(`semester_assessment_definitions/${definitionId}`)).status, "PUBLISHED", "rejected source edit must preserve publication");
  const saved = await query.saveAssessmentProgress({ auth: runner, data: { attemptId: started.result.attemptId, expectedRevision: 1,
    answers: { "blank-1": "고려" }, currentItemId: "blank-1", saveId: randomUUID() } });
  nowMs += 15_000; // Network interruption has no lock event; the existing deadline remains authoritative.
  const resumed = await execute(runner, "startAssessmentAttempt", { definitionId });
  assert.equal(resumed.result.attemptId, started.result.attemptId);
  assert.equal(resumed.result.deadlineAtIso, started.result.deadlineAtIso);
  assert.equal(resumed.result.answers["blank-1"], "고려");
  await assert.rejects(execute(student(students[3]), "lockHistoryClassroomAttempt", { attemptId: started.result.attemptId, reason: "VISIBILITY_HIDDEN" }), expectCode("permission-denied"));
  const lockCommandId = randomUUID();
  const lock = await execute(runner, "lockHistoryClassroomAttempt", { attemptId: started.result.attemptId, reason: "VISIBILITY_HIDDEN" }, lockCommandId);
  assert.equal(lock.result.status, "LOCKED");
  const lockStatus = await core.getStatus({ auth: runner, data: { commandId: lockCommandId, commandType: "lockHistoryClassroomAttempt" } });
  assert.equal(lockStatus.status, "SUCCEEDED");
  assert.equal(lockStatus.result.status, "LOCKED");
  const foreignLockStatus = await core.getStatus({ auth: student(students[3]), data: { commandId: lockCommandId, commandType: "lockHistoryClassroomAttempt" } });
  assert.equal(foreignLockStatus.status, "NOT_FOUND", "another student cannot read the lock receipt");
  assert.equal((await execute(runner, "lockHistoryClassroomAttempt", { attemptId: started.result.attemptId, reason: "NAVIGATION" })).result.revision, lock.result.revision);
  await assert.rejects(execute(runner, "startAssessmentAttempt", { definitionId }), (error) => error.details?.reason === "ASSESSMENT_ATTEMPT_LOCKED");
  await assert.rejects(execute(runner, "submitAssessmentAttempt", { attemptId: started.result.attemptId, expectedRevision: saved.revision, answers: { "blank-1": "고려" }, submitReason: "STUDENT" }), expectCode("failed-precondition"));
  await execute(teacher, "resetAssessmentAttempt", { definitionId, studentUid: runner.uid, reason: "합성 재응시 승인" });
  assert.ok((await get(`${root}/history_classrooms/history-one`)).retryResetByStudentUid[runner.uid]?.toMillis(), "single reset projects the authoritative browser-lock release marker");
  await db.doc(`${root}/history_classrooms/history-one`).update({ passThresholdPercent: 0 });
  const restarted = await execute(runner, "startAssessmentAttempt", { definitionId });
  assert.notEqual(restarted.result.attemptId, started.result.attemptId);
  await db.doc(`${root}/history_classrooms/history-one`).update({ passThresholdPercent: 100 });
  const submitted = await execute(runner, "submitAssessmentAttempt", { attemptId: restarted.result.attemptId, expectedRevision: 1, answers: { "blank-1": "오답" }, submitReason: "STUDENT" });
  assert.equal(submitted.result.passThresholdPercent, 0);
  assert.equal(submitted.result.passed, true, "threshold is frozen at start, including a valid zero threshold");
  await assert.rejects(execute(teacher, "upsertHistoryClassroomSource", { semesterId, sourceId: "history-one", expectedRevision: 0,
    source: { ...seed[`${root}/history_classrooms/history-one`], blanks: [{ id: "replacement", answer: "조선" }] }, reason: "제출 후 합성 교체" }),
  (error) => error.details?.reason === "ASSESSMENT_SOURCE_HAS_RESULTS");
  await assert.rejects(execute(runner, "createHistoryClassroomExemptionRequest", { ...requestPayload, exemptionId: ticketFor(runner.uid) }),
    (error) => error.details?.reason === "HISTORY_EXEMPTION_ALREADY_PASSED");
  const lateLock = await execute(runner, "lockHistoryClassroomAttempt", { attemptId: restarted.result.attemptId, reason: "NAVIGATION" });
  assert.equal(lateLock.result.status, "SUBMITTED", "late navigation must preserve a committed result");
  await db.doc(`${root}/history_classrooms/history-one`).set({ retryResetByStudentUid: { other_class_student: Timestamp.fromMillis(1) } }, { merge: true });
  await execute(teacher, "resetAssessmentAttemptsByClassV2", { definitionId, classId: "3-2", reason: "합성 학급 재응시 승인" });
  const markers = (await get(`${root}/history_classrooms/history-one`)).retryResetByStudentUid;
  assert.equal(markers.other_class_student.toMillis(), 1, "class reset preserves other-class markers");
  assert.ok(students.every((uid) => markers[uid]?.toMillis()), "class reset projects all active class members, including existing local-only locks");
  await execute(teacher, "upsertHistoryClassroomSource", { semesterId, sourceId: "history-one", expectedRevision: 0,
    source: { ...seed[`${root}/history_classrooms/history-one`], title: "제목만 수정", retryResetByStudentUid: { forged: "fake" } }, reason: "합성 메타 수정" });
  const edited = await get(`${root}/history_classrooms/history-one`);
  assert.ok(edited.retryResetByStudentUid[runner.uid]?.toMillis());
  assert.equal(edited.retryResetByStudentUid.forged, undefined, "editor cannot manufacture a reset marker");
  assert.equal((await get(`semester_assessment_definitions/${definitionId}`)).status, "PAUSED", "accepted source and publication pause commit together");
  const directSourceId = "direct-history";
  const directDefinitionId = `history_classroom:${semesterId}:${directSourceId}`;
  const directSource = { ...authoredSource, targetStudentUids: students.slice(0, 12) };
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...sourceSavePayload, sourceId: directSourceId, source: directSource });
  const directTicket = (index, variant = "a") => `direct-ticket-${index}-${variant}`;
  const directTicketRef = (index, variant = "a") => `${root}/history_classroom_exemptions/${directTicket(index, variant)}`;
  const directPayload = (index, variant = "a") => ({ semesterId, assignmentId: directSourceId, studentUid: students[index], exemptionId: directTicket(index, variant) });
  const directSeed = db.batch();
  for (let index = 0; index < 13; index += 1) {
    for (const variant of ["a", "b"]) directSeed.set(db.doc(directTicketRef(index, variant)), {
      uid: students[index], semesterId, status: "available", revision: 1, studentName: "오래된 발급 이름", reason: "합성 보유 면제권" });
  }
  await directSeed.commit();
  const applyDirect = (index, variant = "a", id = randomUUID(), auth = teacher) =>
    executeAuthenticated(auth, "applyHistoryClassroomExemption", directPayload(index, variant), id);
  await assert.rejects(applyDirect(0, "a", randomUUID(), student()), expectCode("permission-denied"));
  await db.doc("users/teacher").update({ staffPermissions: [] });
  await assert.rejects(applyDirect(0), (error) => error.details?.reason === "ASSESSMENT_MANAGE_REQUIRED");
  await db.doc("users/teacher").update({ staffPermissions: ["quiz_read"] });
  await db.doc(`users/${students[10]}`).update({ teacherPortalEnabled: true, staffPermissions: ["quiz_read"] });
  await assert.rejects(applyDirect(0, "a", randomUUID(), student(students[10])), expectCode("permission-denied"));
  await db.doc(`users/${students[10]}`).update({ teacherPortalEnabled: false, staffPermissions: [] });
  await assert.rejects(executeAuthenticated(teacher, "applyHistoryClassroomExemption", { ...directPayload(0), exemptionId: directTicket(1) }), expectCode("permission-denied"));
  await assert.rejects(applyDirect(12), expectCode("permission-denied"));
  for (const update of [{ status: "used" }, { status: "revoked" }, { status: "requested" }, { semesterId: "2025-2" },
    { expiresAt: Timestamp.fromMillis(Date.now() - 1000) }, { assignmentId: "another-assignment" }]) {
    const ref = db.doc(directTicketRef(2));
    await ref.set({ uid: students[2], semesterId, status: "available", revision: 1, ...update });
    await assert.rejects(applyDirect(2));
    assert.deepEqual(await get(directTicketRef(2)), { uid: students[2], semesterId, status: "available", revision: 1, ...update });
  }
  await db.doc(directTicketRef(2)).set({ uid: students[2], status: "available", revision: 1 }); // legacy ticket without a semester field remains valid.
  await db.doc(`${root}/history_classrooms/${directSourceId}`).update({ dueAt: "2000-01-01T00:00:00.000Z" });
  await assert.rejects(applyDirect(2), (error) => error.details?.reason === "HISTORY_EXEMPTION_WINDOW_CLOSED");
  await db.doc(`${root}/history_classrooms/${directSourceId}`).update({ dueAt: null });
  await db.doc(`semester_assessment_definitions/${directDefinitionId}`).update({ opensAt: "2099-01-01T00:00:00.000Z" });
  await assert.rejects(applyDirect(2), (error) => error.details?.reason === "HISTORY_EXEMPTION_WINDOW_CLOSED");
  await db.doc(`semester_assessment_definitions/${directDefinitionId}`).update({ opensAt: "" });
  const pending = await executeAuthenticated(student(students[5]), "createHistoryClassroomExemptionRequest", {
    semesterId, assignmentId: directSourceId, exemptionId: directTicket(5), memo: "합성 기존 요청" });
  await assert.rejects(applyDirect(5, "b"), (error) => error.details?.reason === "HISTORY_EXEMPTION_REQUEST_PENDING");
  assert.equal((await get(directTicketRef(5, "b"))).status, "available");
  assert.equal((await get(`${root}/history_classroom_exemption_requests/${pending.result.requestId}`)).status, "pending");
  await db.doc(`${root}/history_classroom_results/direct-legacy-passed`).set({ uid: students[6], assignmentId: directSourceId, status: "passed", passed: true });
  await assert.rejects(applyDirect(6), (error) => error.details?.reason === "HISTORY_EXEMPTION_ALREADY_PASSED");
  const directAttempt = await executeAuthenticated(student(), "startAssessmentAttempt", { definitionId: directDefinitionId });
  const directCommandId = randomUUID();
  const [directResult, directReplay] = await Promise.all([applyDirect(0, "a", directCommandId), applyDirect(0, "a", directCommandId)]);
  assert.equal(directResult.result.resultId, directReplay.result.resultId);
  assert.deepEqual((await authenticatedStatus(teacher, "applyHistoryClassroomExemption", directCommandId)).result, directResult.result);
  const directCanonical = await get(`semester_assessment_results/${directResult.result.resultId}`);
  const directLegacy = await get(`${root}/history_classroom_results/${directResult.result.resultId}`);
  assert.deepEqual(directCanonical, directLegacy);
  assert.equal(directCanonical.origin, "teacher_direct");
  assert.equal(directCanonical.initiatedByUid, teacher.uid);
  assert.equal(directCanonical.studentName, `합성 ${students[0]}`);
  assert.equal(directCanonical.completionSource, "exemption");
  assert.equal(directCanonical.reward.totalAwarded, 0);
  assert.equal((await get(directTicketRef(0))).status, "used");
  assert.equal((await get(directTicketRef(0, "b"))).status, "available");
  const directAudit = await get(`${root}/history_classroom_exemption_requests/${directCanonical.exemptionRequestId}`);
  assert.equal(directAudit.origin, "teacher_direct");
  assert.equal(directAudit.initiatedByUid, teacher.uid);
  assert.equal(directAudit.requestedAt, undefined, "A direct teacher action must not impersonate a student request");
  assert.equal((await get(`semester_assessment_attempts/${directAttempt.result.attemptId}`)).lockReason, "EXEMPTION");
  await assert.rejects(executeAuthenticated(student(), "startAssessmentAttempt", { definitionId: directDefinitionId }),
    (error) => error.details?.reason === "ASSESSMENT_ALREADY_EXEMPTED");
  await assert.rejects(applyDirect(0, "b"), (error) => error.details?.reason === "HISTORY_EXEMPTION_ALREADY_PASSED");
  const directRace = await Promise.allSettled([applyDirect(1), applyDirect(1, "b")]);
  assert.equal(directRace.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await Promise.all([get(directTicketRef(1)), get(directTicketRef(1, "b"))])).filter(ticket => ticket.status === "used").length, 1);
  await applyDirect(2);
  await db.doc(`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, students[3])}`).update({ activeEnrollmentId: "missing" });
  await assert.rejects(applyDirect(3), (error) => error.details?.reason === "ASSESSMENT_ENROLLMENT_INVALID");
  assert.equal((await get(directTicketRef(3))).status, "available");
  await db.doc(`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, students[3])}`).update({ activeEnrollmentId: `enrollment_${students[3]}` });
  const administrator = { uid: "direct-admin", token: { email: "westoria28@gmail.com", auth_time: authTime } };
  await db.doc(`application_sessions/${administrator.uid}/sessions/${authTime}`).set({ ...seed[`application_sessions/${teacher.uid}/sessions/${authTime}`],
    uid: administrator.uid, email: administrator.token.email });
  await applyDirect(3, "a", randomUUID(), administrator);
  const secondDirectSourceId = "direct-history-second";
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...sourceSavePayload, sourceId: secondDirectSourceId, source: directSource });
  const crossAssignment = await Promise.allSettled([applyDirect(7),
    executeAuthenticated(teacher, "applyHistoryClassroomExemption", { ...directPayload(7), assignmentId: secondDirectSourceId })]);
  assert.equal(crossAssignment.filter(result => result.status === "fulfilled").length, 1, "One ticket cannot complete two assignments concurrently");
  const crossSuccess = crossAssignment.find(result => result.status === "fulfilled").value.result;
  assert.equal((await get(directTicketRef(7))).usedAssignmentId, crossSuccess.assignmentId);
  const crossResults = await db.collection("semester_assessment_results").where("studentUid", "==", students[7]).get();
  assert.equal(crossResults.docs.filter(doc => [directSourceId, secondDirectSourceId].includes(doc.data().assignmentId)).length, 1);
  const requestRace = await Promise.allSettled([
    executeAuthenticated(student(students[8]), "createHistoryClassroomExemptionRequest", {
      semesterId, assignmentId: directSourceId, exemptionId: directTicket(8), memo: "합성 동시 요청" }),
    applyDirect(8, "b"),
  ]);
  assert.equal(requestRace.filter(result => result.status === "fulfilled").length, 1, "A student request and teacher direct action cannot both reserve/consume tickets for one assignment");
  const requestTicket = await get(directTicketRef(8)), teacherTicket = await get(directTicketRef(8, "b"));
  if (requestRace[0].status === "fulfilled") {
    assert.equal(requestTicket.status, "requested");
    assert.equal(teacherTicket.status, "available");
  } else {
    assert.equal(requestTicket.status, "available");
    assert.equal(teacherTicket.status, "used");
  }
  console.log("PASS concurrent same-ticket/different-assignment and student-request/teacher-direct races each permit exactly one outcome");
  console.log("PASS teacher direct exemptions: available/legacy ticket, role/capability/target/owner/semester/expiry/window/pending guards, fixed-result concurrency, receipt/status, no rewards, active-attempt lock and no student-request impersonation");

  // This section exercises the actual exported callable, rather than only the
  // domain adapter: projection, configured notification and receipt are one
  // transaction even when the HTTP response is lost.
  const syncSourceId = "canonical-result-integration";
  const syncDefinitionId = `history_classroom:${semesterId}:${syncSourceId}`;
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...sourceSavePayload, sourceId: syncSourceId,
    source: { ...authoredSource, title: "결과 연동 검증", targetStudentUids: students, cooldownMinutes: 0,
      blanks: [{ id: "sync-blank", answer: "고려", page: 2 }] } });
  const teacherItems = () => db.collection(`${root}/notification_inboxes/teacher/items`).get();
  const teacherCount = () => count(`${root}/notification_inboxes/teacher/items`);
  const initialTeacherCount = await teacherCount();
  const publicationSourceId = "publication-notification-integration";
  const assignedAlerts = async uid => (await db.collection(`${root}/notification_inboxes/${uid}/items`).get()).docs
    .filter(doc => doc.data().type === "history_classroom_assigned" && doc.data().entityId === publicationSourceId).length;
  const publicationSource = { ...authoredSource, targetStudentUids: students.slice(0, 1), isPublished: false };
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...sourceSavePayload, sourceId: publicationSourceId, source: publicationSource });
  assert.equal(await assignedAlerts(students[0]), 0, "private saves must not alert students");
  const publishPayload = { ...sourceSavePayload, sourceId: publicationSourceId, expectedRevision: 1, source: { ...publicationSource, isPublished: true } };
  const publicationCommandId = randomUUID();
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", publishPayload, publicationCommandId);
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", publishPayload, publicationCommandId);
  assert.equal(await assignedAlerts(students[0]), 1, "publication and its replay notify one assigned student once");
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...publishPayload, expectedRevision: 2 });
  assert.equal(await assignedAlerts(students[0]), 1, "an ordinary public settings save does not resend assignment alerts");
  await executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...publishPayload, expectedRevision: 3,
    source: { ...publishPayload.source, targetStudentUids: students.slice(0, 2) } });
  assert.equal(await assignedAlerts(students[0]), 1);
  assert.equal(await assignedAlerts(students[1]), 1, "adding recipients notifies only newly assigned students");
  const begin = uid => executeAuthenticated(student(uid), "startAssessmentAttempt", { definitionId: syncDefinitionId });
  const submitPayload = (started, answer) => ({ attemptId: started.result.attemptId, expectedRevision: started.result.revision,
    answers: { "sync-blank": answer }, submitReason: "STUDENT" });
  const syncPassed = await begin(students[30]);
  const lostSubmitId = randomUUID(), passedPayload = submitPayload(syncPassed, "고려");
  await assert.rejects(production.executeCommand.run(authenticatedRequest(student(students[30]), {
    commandId: lostSubmitId, commandType: "submitAssessmentAttempt", payload: passedPayload, _testDropResponseAfterCommit: true,
  })), error => error.details?.reason === "TEST_RESPONSE_LOSS");
  const passedReceipt = await authenticatedStatus(student(students[30]), "submitAssessmentAttempt", lostSubmitId);
  assert.equal(passedReceipt.result.passed, true);
  const passedProjection = await get(`${root}/history_classroom_results/${syncPassed.result.attemptId}`);
  assert.equal(passedProjection.uid, students[30]);
  assert.equal(passedProjection.assignmentId, syncSourceId);
  assert.equal(passedProjection.status, "passed");
  assert.equal(passedProjection.percent, 100);
  assert.equal(passedProjection.answerChecks[0].blankId, "sync-blank");
  assert.equal(passedProjection.answerChecks[0].correctAnswer, "고려");
  assert.equal(passedProjection.answerChecks[0].page, 2);
  assert.equal(await teacherCount(), initialTeacherCount + 1);
  assert.equal(await count(`${root}/notification_inboxes/disabled-quiz-staff/items`), 0, "staff without an enabled teacher portal cannot receive student outcomes");
  assert.equal((await get(`${root}/notification_inboxes/teacher`)).unreadCount, await teacherCount());
  await executeAuthenticated(student(students[30]), "submitAssessmentAttempt", passedPayload, lostSubmitId);
  await executeAuthenticated(student(students[30]), "submitAssessmentAttempt", passedPayload);
  assert.equal(await teacherCount(), initialTeacherCount + 1, "receipt replay and replayed submission share one pass alert");
  const failedStart = await begin(students[31]);
  await executeAuthenticated(student(students[31]), "submitAssessmentAttempt", submitPayload(failedStart, "오답"));
  assert.equal((await get(`${root}/history_classroom_results/${failedStart.result.attemptId}`)).status, "failed");
  assert.equal(await teacherCount(), initialTeacherCount + 1, "ordinary failure is visible in the result table without a pass alert");
  await db.doc("site_settings/notification_config").set({ eventPolicies: { history_classroom_locked: {
    titleTemplate: "{studentName} 확인", bodyTemplate: "{assignmentTitle}: {reason}",
  } } });
  const lockedStart = await begin(students[32]);
  const lockPayload = { attemptId: lockedStart.result.attemptId, reason: "VISIBILITY_HIDDEN" };
  await executeAuthenticated(student(students[32]), "lockHistoryClassroomAttempt", lockPayload);
  await executeAuthenticated(student(students[32]), "lockHistoryClassroomAttempt", { ...lockPayload, reason: "NAVIGATION" });
  const lockedProjection = await get(`${root}/history_classroom_results/${lockedStart.result.attemptId}`);
  assert.equal(lockedProjection.status, "cancelled");
  assert.equal(lockedProjection.lockReason, "VISIBILITY_HIDDEN");
  const lockedAlert = (await teacherItems()).docs.find(doc => doc.data().entityId === lockedStart.result.attemptId).data();
  assert.equal(lockedAlert.type, "history_classroom_locked");
  assert.equal(lockedAlert.title, `합성 ${students[32]} 확인`);
  assert.ok(lockedAlert.targetUrl.includes(`assignmentId=${syncSourceId}`));
  assert.equal(await teacherCount(), initialTeacherCount + 2, "repeated lock commands produce one teacher alert");
  await db.doc("site_settings/notification_config").set({ teacherNotificationsEnabled: false });
  const disabledStart = await begin(students[33]);
  await executeAuthenticated(student(students[33]), "submitAssessmentAttempt", submitPayload(disabledStart, "고려"));
  assert.equal((await get(`${root}/history_classroom_results/${disabledStart.result.attemptId}`)).status, "passed");
  assert.equal(await teacherCount(), initialTeacherCount + 2, "disabled teacher notifications still commit the teacher result projection");
  await db.doc("site_settings/notification_config").delete();
  const conflictStart = await begin(students[29]);
  const conflictPath = `${root}/history_classroom_results/${conflictStart.result.attemptId}`;
  await db.doc(conflictPath).set({ uid: "foreign-student", assignmentId: syncSourceId });
  await assert.rejects(executeAuthenticated(student(students[29]), "submitAssessmentAttempt", submitPayload(conflictStart, "고려")));
  assert.equal(await get(`semester_assessment_results/${conflictStart.result.attemptId}`), undefined);
  assert.equal((await get(`semester_assessment_attempts/${conflictStart.result.attemptId}`)).status, "STARTED");
  assert.equal(await teacherCount(), initialTeacherCount + 2, "a projection identity failure rolls back score, receipt and notification");
  await db.doc(conflictPath).delete();
  await executeAuthenticated(student(students[29]), "submitAssessmentAttempt", submitPayload(conflictStart, "고려"));
  assert.equal(await teacherCount(), initialTeacherCount + 3);
  const clearAt = Timestamp.now();
  const passedAlertDoc = (await teacherItems()).docs.find(doc => doc.data().entityId === syncPassed.result.attemptId);
  await passedAlertDoc.ref.delete();
  await db.doc(`${root}/notification_inboxes/teacher`).set({ broadcastClearedAt: clearAt }, { merge: true });
  await executeAuthenticated(student(students[30]), "submitAssessmentAttempt", passedPayload);
  assert.equal((await passedAlertDoc.ref.get()).exists, false, "a replay must not restore an explicitly cleared old alert");
  console.log("PASS exported history result integration: pass/fail and lock projections, teacher pass/check alerts, configured templates/disable policy, receipt+submission replay, response-loss recovery, atomic rollback, cleared-alert preservation");
  const recoveryStart = await begin(students[28]);
  await executeAuthenticated(student(students[28]), "lockHistoryClassroomAttempt", {
    attemptId: recoveryStart.result.attemptId, reason: "NAVIGATION",
  });
  const recoveryProjectionPath = `${root}/history_classroom_results/${recoveryStart.result.attemptId}`;
  const recoveryAlert = (await teacherItems()).docs.find(doc => doc.data().entityId === recoveryStart.result.attemptId);
  await recoveryAlert.ref.delete();
  await db.doc(recoveryProjectionPath).delete();
  await db.doc(`${root}/history_classroom_results/${failedStart.result.attemptId}`).delete();
  await db.doc(`${root}/history_classroom_results/${syncPassed.result.attemptId}`).delete();
  const repair = require("../../scripts/repair-history-classroom-sync.cjs");
  assert.throws(() => repair.parseArgs(["--apply"]), /explicit assignment IDs/);
  const repairOptions = repair.parseArgs(["--project", projectId, "--assignment-id", syncSourceId, "--notify-since", clearAt.toDate().toISOString()]);
  const immutableBeforeRepair = JSON.stringify(await get(`semester_assessment_results/${syncPassed.result.attemptId}`));
  const rewardBeforeRepair = JSON.stringify(await get(`${wis.WIS_ACCOUNT_COLLECTION}/${wis.accountIdFor(semesterId, students[30])}`));
  const dryRepair = await repair.runRepair({ db, options: repairOptions, createSync: production.createHistoryClassroomSync });
  assert.equal(dryRepair.mode, "dry-run");
  assert.equal(dryRepair.assignments[0].projections, 3);
  assert.equal(dryRepair.assignments[0].notifications, 1, "only a missing new lock alert is recovered; cleared earlier passes stay cleared");
  assert.equal(await get(recoveryProjectionPath), undefined, "repair defaults to no writes");
  const appliedRepair = await repair.runRepair({ db, options: { ...repairOptions, apply: true }, createSync: production.createHistoryClassroomSync });
  assert.equal(appliedRepair.assignments[0].projections, 3);
  assert.equal((await get(recoveryProjectionPath)).status, "cancelled");
  assert.equal((await recoveryAlert.ref.get()).exists, true);
  const replayRepair = await repair.runRepair({ db, options: { ...repairOptions, apply: true }, createSync: production.createHistoryClassroomSync });
  assert.equal(replayRepair.assignments[0].projections, 0);
  assert.equal(replayRepair.assignments[0].notifications, 0);
  assert.equal(JSON.stringify(await get(`semester_assessment_results/${syncPassed.result.attemptId}`)), immutableBeforeRepair);
  assert.equal(JSON.stringify(await get(`${wis.WIS_ACCOUNT_COLLECTION}/${wis.accountIdFor(semesterId, students[30])}`)), rewardBeforeRepair);
  const resetAuthTime = Math.floor(Date.now() / 1000) - 5;
  const resetTeacher = { uid: teacher.uid, token: { ...teacher.token, auth_time: resetAuthTime } };
  await db.doc(`application_sessions/${teacher.uid}/sessions/${resetAuthTime}`).set({
    ...seed[`application_sessions/${teacher.uid}/sessions/${authTime}`], authTime: resetAuthTime,
    highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  });
  await executeAuthenticated(resetTeacher, "resetAssessmentAttempt", { definitionId: syncDefinitionId, studentUid: students[28], reason: "복구 검증 후 교사 재응시 승인" });
  await db.doc(recoveryProjectionPath).delete();
  const { resetAt: omittedResetAt, resetBy: omittedResetBy, ...oldLock } = await get(`semester_assessment_attempts/${recoveryStart.result.attemptId}`);
  const staleLockId = `attempt_${"e".repeat(64)}`;
  await db.doc(`semester_assessment_attempts/${staleLockId}`).set({ ...oldLock, attemptId: staleLockId, studentUid: students[30],
    enrollmentId: `enrollment_${students[30]}`, lockedAtIso: new Date(Date.parse(passedProjection.submittedAtIso) - 1).toISOString() });
  const resetRepair = await repair.runRepair({ db, options: repairOptions, createSync: production.createHistoryClassroomSync });
  assert.equal(resetRepair.assignments[0].projections, 0, "a reset lock is never recreated as a current teacher-check event");
  assert.equal(await get(`${root}/history_classroom_results/${staleLockId}`), undefined, "a later canonical pass supersedes an old lock even without a reset marker");
  console.log("PASS bounded history repair: explicit sources, dry-run, pass/fail/lock reconstruction, notification cutoff/clear preservation, idempotence, immutable scores and reward account unchanged, reset and superseded locks skipped");
  await db.doc(`semester_manifests/${semesterId}`).update({ status: "ARCHIVED" });
  await assert.rejects(execute(teacher, "grantHistoryClassroomExemptions", grantPayload), expectCode("failed-precondition"));
  await assert.rejects(applyDirect(4), expectCode("failed-precondition"));
  await assert.rejects(executeAuthenticated(teacher, "saveHistoryClassroomAssignment", { ...sourceSavePayload, sourceId: "archived-save" }), expectCode("failed-precondition"));
  await assert.rejects(core.getStatus({ auth: runner, data: { commandId: lockCommandId, commandType: "lockHistoryClassroomAttempt" } }), expectCode("permission-denied"));
  console.log("PASS history classroom emulator: 32/34 class grant, receipt replay, ownership, atomic rejection, request/revoke/approve/reject, exemption/result atomicity, no exemption reward, offline resume/deadline, violation lock, teacher reset, submitted-result preservation, archive fence");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await deleteApp(app); });
