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
const semesterId = "2026-2";
const root = "years/2026/semesters/2";
const definitionId = "history_classroom:2026-2:history-one";
const students = Array.from({ length: 34 }, (_, i) => `student-${i + 1}`);
const teacher = { uid: "teacher", token: { email: "teacher@example.test" } };
const student = (uid = students[0]) => ({ uid, token: { email: `${uid}@example.test` } });
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
const get = async (path) => (await db.doc(path).get()).data();
const count = async (path) => (await db.collection(path).get()).size;
const expectCode = (code) => (error) => error.code === code;

(async () => {
  const batch = db.batch();
  const seed = {
    "site_settings/config": { year: "2026", semester: "2", activeSemesterId: semesterId },
    "site_settings/semester_active": { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 1 },
    "users/teacher": { role: "teacher", teacherPortalEnabled: true },
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
  }
  for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data);
  await batch.commit();
  console.log("Seeded isolated History Classroom emulator fixture.");
  const created = await execute(teacher, "createAssessmentDefinition", { definitionId, semesterId, assessmentKind: "HISTORY_CLASSROOM",
    title: "합성 역사교실", sourceId: "history-one", durationSeconds: 600, maxAttempts: 5, cooldownMinutes: 0, opensAt: "", closesAt: "", assignedClassIds: ["3-2"] });
  await execute(teacher, "transitionAssessmentDefinition", { definitionId, expectedRevision: created.result.definition.revision, targetStatus: "PUBLISHED", reason: "합성 검증" });

  const grantId = randomUUID();
  const grantPayload = { semesterId, recipientUids: students.slice(0, 32), classId: "3-2", targetGrade: "3", targetClass: "2", reason: "합성 현장체험" };
  const [grant, replay] = await Promise.all([execute(teacher, "grantHistoryClassroomExemptions", grantPayload, grantId), execute(teacher, "grantHistoryClassroomExemptions", grantPayload, grantId)]);
  assert.equal(grant.result.createdCount, 32);
  assert.equal(replay.result.createdCount, 32);
  const grantStatus = await core.getStatus({ auth: teacher, data: { commandId: grantId, commandType: "grantHistoryClassroomExemptions" } });
  assert.equal(grantStatus.status, "SUCCEEDED");
  assert.deepEqual(grantStatus.result.exemptionIds, grant.result.exemptionIds, "grant response loss recovers the same receipt");
  assert.equal(await count(`${root}/history_classroom_exemptions`), 32);
  const tickets = await db.collection(`${root}/history_classroom_exemptions`).get();
  assert.ok(tickets.docs.every((doc) => !students.slice(32).includes(doc.data().uid) && doc.data().grantScope === "class"));
  const ticketFor = (uid) => tickets.docs.find((doc) => doc.data().uid === uid).id;
  await assert.rejects(execute(student(), "grantHistoryClassroomExemptions", grantPayload), expectCode("permission-denied"));
  await assert.rejects(execute(teacher, "grantHistoryClassroomExemptions", { ...grantPayload, recipientUids: [students[0], "inactive"] }), expectCode("failed-precondition"));
  assert.equal(await count(`${root}/history_classroom_exemptions`), 32, "invalid mixed batch must not partly grant");
  console.log("PASS class grant/replay/ownership/atomic batch checks.");

  const requestPayload = { semesterId, assignmentId: "history-one", exemptionId: ticketFor(students[0]), memo: "합성 요청" };
  await assert.rejects(execute(student(students[1]), "createHistoryClassroomExemptionRequest", requestPayload), expectCode("permission-denied"));
  await db.doc(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`).update({ assignmentId: "another-assignment" });
  await assert.rejects(execute(student(), "createHistoryClassroomExemptionRequest", requestPayload), expectCode("permission-denied"));
  await db.doc(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`).update({ assignmentId: "" });
  const requestCommandId = randomUUID();
  const requested = await execute(student(), "createHistoryClassroomExemptionRequest", requestPayload, requestCommandId);
  const requestStatus = await core.getStatus({ auth: student(), data: { commandId: requestCommandId, commandType: "createHistoryClassroomExemptionRequest" } });
  assert.equal(requestStatus.status, "SUCCEEDED");
  assert.equal(requestStatus.result.requestId, requested.result.requestId);
  assert.equal((await get(`${root}/history_classroom_exemptions/${requestPayload.exemptionId}`)).status, "requested");
  await assert.rejects(execute(teacher, "revokeHistoryClassroomExemptions", { semesterId, exemptionIds: [requestPayload.exemptionId] }), expectCode("failed-precondition"));
  const attempt = await execute(student(), "startAssessmentAttempt", { definitionId });
  const reviewed = await execute(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: requested.result.requestId, approved: true });
  const canonical = await get(`semester_assessment_results/${reviewed.result.resultId}`);
  const compatible = await get(`${root}/history_classroom_results/${reviewed.result.resultId}`);
  assert.equal(canonical.completionSource, "exemption");
  assert.equal(compatible.resultId, canonical.resultId);
  assert.equal(canonical.reward.totalAwarded, 0);
  assert.equal((await get(`semester_assessment_attempts/${attempt.result.attemptId}`)).status, "LOCKED");
  await assert.rejects(execute(student(), "startAssessmentAttempt", { definitionId }), (error) => error.details?.reason === "ASSESSMENT_ALREADY_EXEMPTED");
  const again = await execute(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: requested.result.requestId, approved: true });
  assert.equal(again.result.resultId, reviewed.result.resultId);
  assert.equal(await count("semester_assessment_results"), 1);
  console.log("PASS ticket request/approval and canonical-compatible result transaction.");

  const rejectedRequest = await execute(student(students[1]), "createHistoryClassroomExemptionRequest", { ...requestPayload, exemptionId: ticketFor(students[1]) });
  await db.doc(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`).update({ state: "pending" });
  await execute(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: rejectedRequest.result.requestId, approved: false, reviewReason: "합성 반려" });
  assert.equal((await get(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`)).status, "available");
  assert.equal((await get(`${root}/history_classroom_exemptions/${ticketFor(students[1])}`)).state, "available");
  await execute(student(students[1]), "createHistoryClassroomExemptionRequest", { ...requestPayload, exemptionId: ticketFor(students[1]) });
  await execute(teacher, "reviewHistoryClassroomExemptionRequest", { semesterId, requestId: rejectedRequest.result.requestId, approved: false, reviewReason: "합성 재요청 반려" });
  await execute(teacher, "revokeHistoryClassroomExemptions", { semesterId, exemptionIds: [ticketFor(students[1])] });
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
  await db.doc(`semester_manifests/${semesterId}`).update({ status: "ARCHIVED" });
  await assert.rejects(execute(teacher, "grantHistoryClassroomExemptions", grantPayload), expectCode("failed-precondition"));
  await assert.rejects(core.getStatus({ auth: runner, data: { commandId: lockCommandId, commandType: "lockHistoryClassroomAttempt" } }), expectCode("permission-denied"));
  console.log("PASS history classroom emulator: 32/34 class grant, receipt replay, ownership, atomic rejection, request/revoke/approve/reject, exemption/result atomicity, no exemption reward, offline resume/deadline, violation lock, teacher reset, submitted-result preservation, archive fence");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await deleteApp(app); });
