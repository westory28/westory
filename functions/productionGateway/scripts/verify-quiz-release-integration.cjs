const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-westory-session-[a-z0-9-]+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const app = initializeApp({ projectId });
const db = getFirestore(app);
const production = require("../productionSource");
const authority = require("../sessionAuthority");
const enrollment = require("../archiveEnrollment");
const wis = require("../wisEconomy");
const semesterId = "2026-2", root = "years/2026/semesters/2";
const definitionId = "quiz:2026-2:release-unit:diagnostic";
const authTime = Math.floor(Date.now() / 1000) - 600;
const identities = ["teacher", "student-one", "student-two", "student-three"];
const auth = uid => ({ uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } });
const proof = { authorityGeneration: authority.SESSION_AUTHORITY_GENERATION,
  protocolVersion: authority.MIN_CLIENT_PROTOCOL_VERSION, revision: "a".repeat(64) };
const request = (uid, data) => ({ auth: auth(uid), data: { ...data, _session: proof } });
const execute = (uid, commandType, payload, commandId = randomUUID()) =>
  production.executeCommand.run(request(uid, { commandId, commandType, payload }));
const state = (uid, data) => production.getAssessmentState.run(request(uid, data));
const get = async path => (await db.doc(path).get()).data();
const reason = expected => error => error.details?.reason === expected;
const settings = { active: true, questionCount: 3, questionOrder: "created", randomOrder: false,
  timeLimit: 600, allowRetake: true, cooldown: 0, hintLimit: 0, visibleTargetGrade: "3", visibleClassIds: ["3-1"], visibilityVersion: 2 };
const payload = (revision, update = {}) => {
  const presentationSettings = { ...settings, ...update };
  return { definitionId, semesterId, assessmentKind: "QUIZ", sourceId: "release-unit", category: "diagnostic", examRound: "",
    title: "합성 연결 검증", questionCount: presentationSettings.questionCount, durationSeconds: presentationSettings.timeLimit,
    maxAttempts: 20, cooldownMinutes: 0, opensAt: "", closesAt: "", assignedClassIds: presentationSettings.visibleClassIds,
    legacyConfigKey: "release-unit_diagnostic", presentationSettings, expectedRevision: revision, reason: "격리된 검증" };
};

(async () => {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(cleared.ok, "Only the guarded demo project fixture is cleared before a rerun");
  const seed = {
    "site_settings/config": { year: "2026", semester: "2", activeSemesterId: semesterId },
    "site_settings/semester_active": { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 1 },
    [`${wis.WIS_ECONOMY_COLLECTION}/${semesterId}`]: { semesterId, status: "ACTIVE_OPEN", revision: 1, ledgerEntryCount: 0 },
    [`${root}/point_policies/current`]: { rewardPolicy: { autoEnabled: false } },
    "semester_classes/class_one": { semesterId, classId: "class_one", grade: "3", classNumber: "1", status: "ACTIVE" },
    "semester_classes/class_two": { semesterId, classId: "class_two", grade: "3", classNumber: "2", status: "ACTIVE" },
    [`${root}/quiz_questions/1`]: { id: 1, unitId: "release-unit", category: "diagnostic", type: "ox", question: "합성 OX", answer: "O", explanation: "비공개 해설", contentRevision: 1 },
    [`${root}/quiz_questions/2`]: { id: 2, unitId: "release-unit", category: "diagnostic", type: "matching", question: "합성 연결", answer: "왼쪽1=>오른쪽2||왼쪽2=>오른쪽1", matchingPairs: [{ left: "왼쪽1", right: "오른쪽2" }, { left: "왼쪽2", right: "오른쪽1" }], contentRevision: 1 },
    [`${root}/quiz_questions/3`]: { id: 3, unitId: "release-unit", category: "diagnostic", type: "order", question: "합성 순서", answer: "다||나||가", options: ["다", "나", "가"], image: "data:image/png;base64," + "a".repeat(48_000), contentRevision: 1 },
  };
  for (const uid of identities) {
    seed[`users/${uid}`] = uid === "teacher" ? { role: "teacher", teacherPortalEnabled: true, staffPermissions: ["quiz_read"] } : { role: "student", name: uid };
    seed[`application_sessions/${uid}/sessions/${authTime}`] = { uid, email: auth(uid).token.email, authTime, status: "active",
      schemaVersion: authority.SESSION_SCHEMA_VERSION, authorityGeneration: proof.authorityGeneration, protocolVersion: proof.protocolVersion,
      sessionRevision: proof.revision, authorityModeAtOpen: "ENFORCE", generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600_000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) };
    if (uid === "teacher") continue;
    seed[`student_identities/${uid}`] = { studentUid: uid };
    seed[`semester_enrollments/enrollment_${uid}`] = { semesterId, studentUid: uid, enrollmentId: `enrollment_${uid}`,
      classId: uid === "student-two" ? "class_two" : "class_one", enrollmentStatus: "ACTIVE" };
    seed[`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `enrollment_${uid}` };
    const accountId = wis.accountIdFor(semesterId, uid);
    seed[`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`] = { schemaVersion: 1, policyVersion: wis.WIS_POLICY_VERSION, accountId,
      semesterId, studentUid: uid, enrollmentId: `enrollment_${uid}`, classId: uid === "student-two" ? "class_two" : "class_one",
      status: "ACTIVE", revision: 1, balance: 0, earnedTotal: 0, rankEarnedTotal: 0, adjustedTotal: 0, spentTotal: 0, recentLedgerEntries: [] };
  }
  const batch = db.batch();
  for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data);
  await batch.commit();

  await assert.rejects(execute("student-one", "saveQuizAssessmentSettings", payload(0)), error => error.code === "permission-denied");
  await execute("teacher", "saveQuizAssessmentSettings", payload(0, { active: false, visibleClassIds: [] }));
  assert.equal((await state("student-one", { definitionId })).status, "NOT_OPEN");
  await assert.rejects(execute("student-one", "startAssessmentAttempt", { definitionId }), reason("ASSESSMENT_NOT_PUBLISHED"));
  const commandId = randomUUID();
  const started = performance.now();
  const published = await execute("teacher", "saveQuizAssessmentSettings", payload(1), commandId);
  assert.equal(published.result.status, "PUBLISHED");
  assert.equal((await get(`${root}/assessment_config/settings`))["release-unit_diagnostic"].active, true);
  assert.equal((await execute("teacher", "saveQuizAssessmentSettings", payload(1), commandId)).replayed, true);
  const recovered = await production.getCommandStatus.run(request("teacher", { commandType: "saveQuizAssessmentSettings", commandId }));
  assert.equal(recovered.result.revision, 2);
  console.log(`PASS authenticated atomic publication/status/replay (${Math.round(performance.now() - started)} ms including recovery checks)`);

  const ready = await state("student-one", { definitionId });
  assert.equal(ready.status, "READY");
  assert.equal(ready.definition.questionCount, 3);
  assert.equal(ready.definition.presentationSettings.timeLimit, 600);
  assert.equal((await state("student-two", { definitionId })).status, "PERMISSION");
  await assert.rejects(execute("student-two", "startAssessmentAttempt", { definitionId }), reason("ASSESSMENT_CLASS_NOT_ASSIGNED"));
  const attempt = (await execute("student-one", "startAssessmentAttempt", { definitionId })).result;
  assert.deepEqual(attempt.questionSnapshotOmittedIds, ["3"]);
  const resumed = (await state("student-one", { attemptId: attempt.attemptId })).attempt;
  assert.equal(resumed.questionPresentation.length, 3);
  assert.deepEqual(resumed.questionSnapshotOmittedIds, []);
  assert.ok(resumed.questionPresentation.every(item => !("answer" in item) && !("explanation" in item) && !("matchingPairs" in item)));
  assert.deepEqual(resumed.questionPresentation.find(item => item.id === "3").options, ["가", "나", "다"]);
  assert.deepEqual(resumed.questionPresentation.find(item => item.id === "2").matchingRightOptions.map(item => item.right), ["오른쪽1", "오른쪽2"]);
  await assert.rejects(state("student-two", { attemptId: attempt.attemptId }), reason("ASSESSMENT_ATTEMPT_FORBIDDEN"));
  await db.doc(`${root}/quiz_questions/3`).update({ contentRevision: 2 });
  assert.deepEqual((await state("student-one", { attemptId: attempt.attemptId })).attempt.questionSnapshotOmittedIds, ["3"]);
  await db.doc(`${root}/quiz_questions/3`).update({ contentRevision: 1 });
  assert.equal((await get(`semester_assessment_attempts/${attempt.attemptId}`)).revision, 1, "Read recovery must not write progress");
  const answers = { "1": "O", "2": "왼쪽1=>오른쪽2||왼쪽2=>오른쪽1", "3": "다||나||가" };
  const savePayload = { attemptId: attempt.attemptId, expectedRevision: 1, answers, currentItemId: "3", saveId: randomUUID() };
  const saved = await production.saveAssessmentProgress.run(request("student-one", savePayload));
  assert.equal(saved.revision, 2);
  assert.equal((await production.saveAssessmentProgress.run(request("student-one", savePayload))).replayed, true);
  const submitted = await execute("student-one", "submitAssessmentAttempt", { attemptId: attempt.attemptId, expectedRevision: 2, answers, submitReason: "STUDENT" });
  assert.equal(submitted.result.percent, 100);
  assert.equal((await state("student-one", { attemptId: attempt.attemptId })).status, "SUBMITTED");
  console.log("PASS selected-class start, answer-free large-image recovery, stale/foreign attempt denial, autosave replay and authenticated 100% submission");

  const races = await Promise.allSettled([
    execute("teacher", "saveQuizAssessmentSettings", payload(2, { timeLimit: 900 })),
    execute("teacher", "saveQuizAssessmentSettings", payload(2, { timeLimit: 1200 })),
  ]);
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  const definition = await get(`semester_assessment_definitions/${definitionId}`);
  assert.equal(definition.durationSeconds, (await get(`${root}/assessment_config/settings`))["release-unit_diagnostic"].timeLimit);
  await assert.rejects(execute("teacher", "saveQuizAssessmentSettings", payload(3, { questionCount: 4 })), reason("ASSESSMENT_QUESTION_SET_INVALID"));
  assert.equal((await get(`semester_assessment_definitions/${definitionId}`)).status, "PUBLISHED");
  for (const id of [1, 2, 3]) await db.doc(`${root}/quiz_questions/${id}`).delete();
  await db.doc("semester_classes/class_one").delete();
  await execute("teacher", "saveQuizAssessmentSettings", payload(3, { active: false }));
  assert.equal((await get(`${root}/assessment_config/settings`))["release-unit_diagnostic"].active, false);
  assert.equal((await state("student-three", { definitionId })).status, "NOT_OPEN");
  await assert.rejects(execute("student-three", "startAssessmentAttempt", { definitionId }), reason("ASSESSMENT_NOT_PUBLISHED"));
  await db.doc(`semester_manifests/${semesterId}`).update({ status: "ARCHIVED" });
  await assert.rejects(execute("teacher", "saveQuizAssessmentSettings", payload(4, { active: false })), reason("ASSESSMENT_SEMESTER_NOT_ACTIVE"));
  console.log("PASS CAS competing writes, failed update preserves access, pause without questions/classes, student block and archive fence");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await deleteApp(app); });
