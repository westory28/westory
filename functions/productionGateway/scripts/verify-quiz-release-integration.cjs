const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-westory-session-[a-z0-9-]+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
const { getApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const deployed = require("../../index");
const app = getApp();
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
const history = (uid, data) => deployed.getMyQuizHistory.run(request(uid, { semesterId, ...data }));
const saveNote = (uid, data) => deployed.saveMyQuizReviewNote.run(request(uid, { semesterId, ...data }));
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
  const answers = { "1": "X", "2": "왼쪽1=>오른쪽2||왼쪽2=>오른쪽1", "3": "다||나||가" };
  const notePayload = { key: `canonical:${attempt.attemptId}`, questionId: "1", practiceAnswer: "O", reason: "개념이 헷갈렸어요",
    note: "보관된 자료를 다시 확인했습니다.", expectedRevision: 0, saveId: randomUUID() };
  await assert.rejects(history("student-one", { mode: "detail", key: notePayload.key }), error => error.code === "not-found");
  await assert.rejects(saveNote("student-one", notePayload), reason("QUIZ_REVIEW_RESULT_NOT_FOUND"));
  const savePayload = { attemptId: attempt.attemptId, expectedRevision: 1, answers, currentItemId: "3", saveId: randomUUID() };
  const attemptRef = db.doc(`semester_assessment_attempts/${attempt.attemptId}`);
  await attemptRef.update({ answers: { unassigned: "legacy" } });
  const invalid = { ...answers, unassigned: "forged" };
  await assert.rejects(production.saveAssessmentProgress.run(request("student-one", { ...savePayload, answers: invalid })), reason("ASSESSMENT_ANSWERS_INVALID"));
  await assert.rejects(execute("student-one", "submitAssessmentAttempt", {
    attemptId: attempt.attemptId, expectedRevision: 1, answers: invalid, submitReason: "STUDENT",
  }), reason("ASSESSMENT_ANSWERS_INVALID"));
  assert.equal((await attemptRef.get()).data().revision, 1);
  const saved = await production.saveAssessmentProgress.run(request("student-one", savePayload));
  assert.equal(saved.revision, 2);
  assert.deepEqual((await attemptRef.get()).data().answers, answers, "Saving replaces legacy unknown entries in the entire Firestore answer map");
  assert.equal((await production.saveAssessmentProgress.run(request("student-one", savePayload))).replayed, true);
  const submitted = await execute("student-one", "submitAssessmentAttempt", { attemptId: attempt.attemptId, expectedRevision: 2, answers, submitReason: "STUDENT" });
  assert.equal(submitted.result.percent, 67);
  assert.deepEqual(submitted.result.answers, answers);
  assert.equal((await state("student-one", { attemptId: attempt.attemptId })).status, "SUBMITTED");
  const resultPath = `semester_assessment_results/${attempt.attemptId}`;
  const submissionPath = `semester_assessment_submissions/${attempt.attemptId}`;
  const original = await get(resultPath), originalSubmission = await get(submissionPath);
  const repeated = await execute("student-one", "submitAssessmentAttempt", { attemptId: attempt.attemptId,
    expectedRevision: 1, answers: { ...answers, 1: "O" }, submitReason: "STUDENT" });
  assert.equal(repeated.result.replayedSubmission, true);
  assert.deepEqual(repeated.result.answers, answers, "A stale tab receives the original submitted answers");
  const detail = await history("student-one", { mode: "detail", key: notePayload.key });
  assert.equal(detail.record.details.find(item => item.id === "1").u, "X");
  assert.equal(detail.record.details.find(item => item.id === "1").questionSnapshot.answer, "O");
  assert.equal(detail.record.details.find(item => item.id === "1").questionSnapshot.explanation, "비공개 해설");
  assert.equal(detail.reviewNotes.revision, 0);
  assert.equal((await history("student-one", { mode: "list", forceRefresh: true })).rows[0].wrongCount, 1);
  await assert.rejects(history("student-two", { mode: "detail", key: notePayload.key }), error => error.code === "not-found");
  await assert.rejects(saveNote("student-two", notePayload), reason("QUIZ_REVIEW_RESULT_NOT_FOUND"));
  await assert.rejects(saveNote("teacher", notePayload), reason("QUIZ_REVIEW_STUDENT_REQUIRED"));
  await assert.rejects(saveNote("student-one", { ...notePayload, questionId: "2" }), reason("QUIZ_REVIEW_QUESTION_INVALID"));
  const savedNote = await saveNote("student-one", notePayload);
  assert.equal(savedNote.reviewNotes.items[0].correct, true);
  assert.deepEqual((await history("student-one", { mode: "detail", key: notePayload.key })).reviewNotes, savedNote.reviewNotes);
  assert.equal((await saveNote("student-one", notePayload)).replayed, true);
  await assert.rejects(saveNote("student-one", { ...notePayload, note: "변경" }), reason("QUIZ_REVIEW_SAVE_ID_REUSED"));
  const noteRaces = await Promise.allSettled(["첫째", "둘째"].map(note => saveNote("student-one", {
    ...notePayload, practiceAnswer: "", expectedRevision: 1, saveId: randomUUID(), note,
  })));
  assert.equal(noteRaces.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(noteRaces.find(result => result.status === "rejected").reason.details.reason, "QUIZ_REVIEW_REVISION_CONFLICT");
  assert.equal((await history("student-one", { mode: "detail", key: notePayload.key })).reviewNotes.items[0].correct, null);
  assert.deepEqual(await get(resultPath), original);
  assert.deepEqual(await get(submissionPath), originalSubmission);
  console.log("PASS authenticated diagnostic submit -> private original review -> explicit notes save/re-read, CAS/retry, stale-tab original answers and immutable scores");

  for (const category of ["formative", "exam_prep"]) {
    const unit = category === "exam_prep" ? "exam_prep" : "release-formative";
    const defId = `quiz:${semesterId}:${unit}:${category}${category === "exam_prep" ? ":round_1" : ""}`;
    const questionIds = category === "exam_prep" ? [21, 22] : [11, 12];
    for (const [index, id] of questionIds.entries()) await db.doc(`${root}/quiz_questions/${id}`).set({
      id, unitId: unit, category, type: "choice", question: "격리된 합성 검증 문항", answer: "고려", options: ["고려", "신라"],
      explanation: "제출 뒤 확인하는 해설", contentRevision: 1,
      ...(category === "exam_prep" ? { examRound: "round_1", paperOrder: index + 1, points: index ? 70 : 30 } : {}),
    });
    const config = { ...payload(0), definitionId: defId, sourceId: unit, category, questionCount: 2,
      examRound: category === "exam_prep" ? "round_1" : "", legacyConfigKey: `${unit}_${category}${category === "exam_prep" ? "__round_1" : ""}`,
      presentationSettings: { ...settings, questionCount: 2, ...(category === "exam_prep" ? { paperTitle: "합성 시험 제목", paperHeading: "합성 머리말" } : {}) } };
    await execute("teacher", "saveQuizAssessmentSettings", config);
    const startedReview = (await execute("student-one", "startAssessmentAttempt", { definitionId: defId })).result;
    assert.ok(startedReview.questionPresentation.every(item => !("answer" in item) && !("explanation" in item)));
    const submittedAnswers = { [questionIds[0]]: "고려", [questionIds[1]]: "신라" };
    const result = (await execute("student-one", "submitAssessmentAttempt", {
      attemptId: startedReview.attemptId, expectedRevision: 1, answers: submittedAnswers, submitReason: "STUDENT",
    })).result;
    assert.equal(result.percent, category === "exam_prep" ? 30 : 50);
    const key = `canonical:${startedReview.attemptId}`;
    const reviewed = await history("student-one", { mode: "detail", key });
    assert.equal(reviewed.record.details[1].u, "신라");
    if (category === "exam_prep") {
      assert.deepEqual(result.paperHeader, startedReview.paperHeader);
      assert.deepEqual(reviewed.record.paperHeader, startedReview.paperHeader);
    }
    await saveNote("student-one", { ...notePayload, key, questionId: String(questionIds[1]), practiceAnswer: "고려", saveId: randomUUID() });
    assert.equal((await history("student-one", { mode: "detail", key })).reviewNotes.items[0].correct, true);
  }
  const legacyKey = "legacy:old-flat";
  await db.doc(`${root}/quiz_results/old-flat`).set({ uid: "student-one", category: "formative", score: 0, timestamp: Timestamp.now(),
    details: [{ id: "31", q: "보관된 단답 문항", a: 1392, type: "short", u: "1391", correct: false, exp: "보관된 해설" }] });
  await saveNote("student-one", { ...notePayload, key: legacyKey, questionId: "31", practiceAnswer: "1392", saveId: randomUUID() });
  assert.equal((await history("student-one", { mode: "detail", key: legacyKey })).reviewNotes.items[0].correct, true);
  await db.doc('semester_quiz_review_notes/other-owner').set({ studentUid: 'student-two', semesterId });
  await db.doc('semester_quiz_review_notes/other-term').set({ studentUid: 'student-one', semesterId: '2026-1' });
  const cleanupRefs = await require('../../studentQuizReviewNotes').collectQuizReviewNoteRefs(db, semesterId, 'student-one');
  assert.equal(cleanupRefs.length, 4);
  assert.ok(cleanupRefs.every(ref => !['other-owner', 'other-term'].includes(ref.id)));
  console.log("PASS authenticated formative and weighted mock submit/review/notes, frozen paper header, flat legacy original compatibility");

  // All rounds may be published together, but this user's own submitted
  // predecessor is still required on every server entry point.
  for (const round of [2, 3]) {
    const examRound = `round_${round}`;
    await db.doc(`${root}/quiz_questions/${30 + round}`).set({ id: 30 + round, unitId: "exam_prep", category: "exam_prep", examRound,
      type: "short", question: `합성 ${round}회`, answer: "조선", explanation: "합성 해설", paperOrder: 1, points: 100, contentRevision: 1 });
    await execute("teacher", "saveQuizAssessmentSettings", { ...payload(0),
      definitionId: `quiz:${semesterId}:exam_prep:exam_prep:${examRound}`, sourceId: "exam_prep", category: "exam_prep", examRound,
      legacyConfigKey: `exam_prep_exam_prep__${examRound}`, presentationSettings: { ...settings, questionCount: 1 }, questionCount: 1 });
  }
  const secondRoundId = `quiz:${semesterId}:exam_prep:exam_prep:round_2`;
  const thirdRoundId = `quiz:${semesterId}:exam_prep:exam_prep:round_3`;
  const initialProgress = await state("student-three", { semesterId, mockExamOverview: true });
  assert.deepEqual(initialProgress.rounds.map(round => round.prerequisiteMet), [true, false, false]);
  assert.deepEqual(initialProgress.rounds.map(round => round.completed), [false, false, false]);
  for (const defId of [secondRoundId, thirdRoundId]) {
    assert.equal((await state("student-three", { definitionId: defId })).status, "PREREQUISITE_REQUIRED");
    await assert.rejects(execute("student-three", "startAssessmentAttempt", { definitionId: defId }), reason("ASSESSMENT_PREREQUISITE_REQUIRED"));
    await assert.rejects(state("student-three", { definitionId: defId, prepareAssets: true }), reason("ASSESSMENT_PREREQUISITE_REQUIRED"));
  }
  const ownProgress = await state("student-one", { semesterId, mockExamOverview: true });
  assert.deepEqual(ownProgress.rounds.map(round => round.prerequisiteMet), [true, true, false]);
  const roundTwo = (await execute("student-one", "startAssessmentAttempt", { definitionId: secondRoundId })).result;
  assert.equal((await state("student-one", { semesterId, mockExamOverview: true })).rounds[2].prerequisiteMet, false);
  await execute("student-one", "submitAssessmentAttempt", { attemptId: roundTwo.attemptId, expectedRevision: 1, answers: { 32: "조선" }, submitReason: "STUDENT" });
  assert.equal((await state("student-one", { definitionId: thirdRoundId })).status, "READY");
  assert.equal((await state("student-three", { definitionId: thirdRoundId })).requiredRound, "round_1");
  // A pre-policy draft retains its saved data while resume/save/submit are blocked.
  const staleId = `attempt_${"d".repeat(64)}`;
  const staleDraft = { ...(await get(`semester_assessment_attempts/${roundTwo.attemptId}`)),
    attemptId: staleId, studentUid: "student-three", status: "IN_PROGRESS", submittedAtIso: "", resultRef: "", submissionRef: "" };
  await db.doc(`semester_assessment_attempts/${staleId}`).set(staleDraft);
  assert.equal((await state("student-three", { attemptId: staleId })).attempt, null);
  await assert.rejects(production.saveAssessmentProgress.run(request("student-three", { attemptId: staleId,
    expectedRevision: staleDraft.revision, answers: { 32: "조선" }, saveId: "blocked-legacy-draft" })), reason("ASSESSMENT_PREREQUISITE_REQUIRED"));
  await assert.rejects(execute("student-three", "submitAssessmentAttempt", { attemptId: staleId,
    expectedRevision: staleDraft.revision, answers: { 32: "조선" }, submitReason: "STUDENT" }), reason("ASSESSMENT_PREREQUISITE_REQUIRED"));
  assert.deepEqual(await get(`semester_assessment_attempts/${staleId}`), staleDraft);
  console.log("PASS mock round overview scoped to self, sequential start/assets/recovery/save/submit gates, no draft mutation");

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
  assert.equal((await history("student-one", { mode: "detail", key: notePayload.key })).reviewNotes.revision, 2);
  await assert.rejects(saveNote("student-one", { ...notePayload, expectedRevision: 2, saveId: randomUUID() }), reason("QUIZ_REVIEW_SEMESTER_INACTIVE"));
  await assert.rejects(execute("teacher", "saveQuizAssessmentSettings", payload(4, { active: false })), reason("ASSESSMENT_SEMESTER_NOT_ACTIVE"));
  console.log("PASS CAS competing writes, failed update preserves access, pause without questions/classes, student block and archive fence");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await deleteApp(app); });
