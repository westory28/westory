import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collectionGroup, query, where, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")
  || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || "")) {
  throw new Error("This verification requires local Auth and Firestore emulators.");
}
const projectId = "demo-westory-session-score-workflow";
process.env.GCLOUD_PROJECT = projectId;
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const functions = require("../functions/index.js");
const admin = require("firebase-admin/firestore").getFirestore();
const auth = require("firebase-admin/auth").getAuth();
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const env = await initializeTestEnvironment({ projectId, firestore: {
  host, port: Number(port), rules: readFileSync("firestore.rules", "utf8"),
} });
const year = "2026", semester = "2", root = `years/${year}/semesters/${semester}`;
const authTime = Math.floor(Date.now() / 1000) - 30;
const sessionProof = { authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2, revision: "b".repeat(64) };
const teacher = { uid: "workflow-teacher", token: { email: "workflow.teacher@yongshin-ms.ms.kr", auth_time: authTime } };
const req = (actor, data) => ({ auth: actor, data: { year, semester, _session: sessionProof, ...data } });
const seedSession = (uid) => admin.doc(`application_sessions/${uid}/sessions/${authTime}`).set({
  schemaVersion: 2, status: "active", authTime, authorityGeneration: sessionProof.authorityGeneration,
  protocolVersion: 2, sessionRevision: sessionProof.revision, authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: require("firebase-admin/firestore").Timestamp.fromMillis(Date.now() + 3600000),
  highRiskExpiresAt: require("firebase-admin/firestore").Timestamp.fromMillis(Date.now() + 3600000),
});
const teacherDb = env.authenticatedContext(teacher.uid, teacher.token).firestore();
const check = (label) => console.log(`PASS ${label}`);

try {
  await env.clearFirestore();
  await admin.doc("site_settings/config").set({ year, semester });
  await admin.doc(`users/${teacher.uid}`).set({ uid: teacher.uid, email: teacher.token.email, role: "teacher", name: "검증교사" });
  await seedSession(teacher.uid);
  const creation = { grade: "3", class: "1", number: "1", name: "검증학생", email: "score.workflow.student@yongshin-ms.ms.kr" };
  const created = await functions.createStudentData.run(req(teacher, creation));
  const uid = created.uid;
  assert.equal(created.registrationApprovalStatus, 'PENDING');
  assert.equal(created.requiresFirstSignIn, true);
  assert.equal((await auth.getUser(uid)).emailVerified, false);
  await seedSession(uid);
  assert.equal((await auth.getUserByEmail(creation.email)).uid, uid);
  assert.equal((await functions.createStudentData.run(req(teacher, creation))).uid, uid);
  await assert.rejects(functions.createStudentData.run(req(teacher, { ...creation, email: "duplicate@yongshin-ms.ms.kr" })), { code: "already-exists" });
  await assert.rejects(functions.createStudentData.run(req({ uid, token: { email: creation.email, auth_time: authTime } }, { ...creation, number: "2" })), { code: "permission-denied" });
  await assert.rejects(functions.createStudentData.run(req(teacher, { ...creation, semester: "1" })), { code: "failed-precondition" });
  check("teacher registration, stable Auth UID, idempotent retry, duplicate number, student denial, semester boundary");
  const actor = { uid, token: { email: creation.email, auth_time: authTime } };
  const studentDb = env.authenticatedContext(uid, actor.token).firestore();
  const otherDb = env.authenticatedContext("other-student", { email: "other@yongshin-ms.ms.kr" }).firestore();
  const scoreId = "performance-2026-2-1";
  const scorePath = `users/${uid}/performance_scores/${scoreId}`;
  const confirmationPath = `${scorePath}/confirmations/${uid}`;
  const version = Timestamp.fromMillis(Date.now() - 10000);
  const score = {
    uid, rosterId: scoreId, academicYear: year, semester, scoreKind: "performance",
    grade: "3", class: "1", number: "1", studentName: creation.name,
    title: "현재 학기 평가", subject: "역사", items: [{ name: "평가 요소", score: 15, maxScore: 20, scoreEntered: true }],
    totalScore: 15, totalMaxScore: 20, updatedAt: version, uploadedBy: teacher.uid,
  };
  await assertSucceeds(setDoc(doc(teacherDb, scorePath), score));
  await admin.doc(`${root}/performance_score_rosters/${scoreId}`).set({ rows: [{ ...creation, studentName: creation.name, uid, totalScore: 15 }], academicYear: year, semester });
  await admin.doc(`users/${uid}/performance_scores/past`).set({ ...score, updatedAt: require("firebase-admin/firestore").Timestamp.fromMillis(version.toMillis()), academicYear: "2025", semester: "1", rosterId: "past" });
  await assertFails(getDoc(doc(studentDb, scorePath)));
  await assertFails(getDoc(doc(otherDb, scorePath)));
  await assertFails(updateDoc(doc(studentDb, scorePath), { totalScore: 20 }));
  const consent = {
    uid, academicYear: year, semester, acknowledged: true, warningVersion: "default-20260609",
    warningTextHash: "test-hash", acknowledgedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(studentDb, `users/${uid}/performance_score_consents/current`), consent));
  const signature = (scoreUpdatedAt = version) => ({
    uid, rosterId: scoreId, signatureName: creation.name, signatureImage: "data:image/png;base64,aGVsbG8=",
    scoreUpdatedAt, confirmedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await assertFails(updateDoc(doc(studentDb, `users/${uid}`), { registrationApprovalStatus: 'APPROVED' }));
  await assertFails(setDoc(doc(studentDb, confirmationPath), signature()));
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '승인 전 요청' })), { code: 'permission-denied' });
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { uid, status: 'active', reason: '' })), { code: 'failed-precondition' });
  // Seed the terminal approval state for the independent score-flow fixture.
  // This does not exercise or claim an end-to-end production registration.
  await admin.doc(`users/${uid}`).update({ registrationApprovalStatus: 'APPROVED' });
  await assertSucceeds(getDoc(doc(studentDb, scorePath)));
  await assertSucceeds(setDoc(doc(studentDb, `users/${uid}/performance_score_consents/current`), consent));
  check('preregistration remains PENDING, does not verify Auth email, and cannot self-approve/sign/request before approval');
  const blankScoreId = "unentered-second-assessment";
  const blankScorePath = `users/${uid}/performance_scores/${blankScoreId}`;
  const blankConfirmationPath = `${blankScorePath}/confirmations/${uid}`;
  await assertSucceeds(
    setDoc(doc(teacherDb, blankScorePath), {
      ...score,
      rosterId: blankScoreId,
      title: "2차 미등록 평가",
      enteredScoreCount: 0,
      items: [
        { name: "2차 기준", score: 0, maxScore: 20, scoreEntered: false },
      ],
      totalScore: 0,
    }),
  );
  await assertSucceeds(getDoc(doc(studentDb, blankScorePath)));
  await assertFails(
    setDoc(doc(studentDb, blankConfirmationPath), {
      ...signature(),
      rosterId: blankScoreId,
    }),
  );
  const zeroScoreId = "entered-real-zero";
  const zeroScorePath = `users/${uid}/performance_scores/${zeroScoreId}`;
  const zeroConfirmationPath = `${zeroScorePath}/confirmations/${uid}`;
  await assertSucceeds(
    setDoc(doc(teacherDb, zeroScorePath), {
      ...score,
      rosterId: zeroScoreId,
      title: "실제 0점 평가",
      enteredScoreCount: 1,
      items: [{ name: "0점 기준", score: 0, maxScore: 20, scoreEntered: true }],
      totalScore: 0,
    }),
  );
  await assertSucceeds(
    setDoc(doc(studentDb, zeroConfirmationPath), {
      ...signature(),
      rosterId: zeroScoreId,
    }),
  );
  assert.equal(
    (await getDoc(doc(teacherDb, zeroConfirmationPath))).data().signatureName,
    creation.name,
  );
  await assertSucceeds(deleteDoc(doc(teacherDb, zeroConfirmationPath)));
  await assertSucceeds(
    updateDoc(doc(teacherDb, zeroScorePath), {
      enteredScoreCount: 0,
      items: [
        { name: "0점 기준", score: 0, maxScore: 20, scoreEntered: false },
      ],
    }),
  );
  await assertFails(
    setDoc(doc(studentDb, zeroConfirmationPath), {
      ...signature(),
      rosterId: zeroScoreId,
    }),
  );
  const legacyZeroId = "legacy-without-entered-count";
  await assertSucceeds(
    setDoc(doc(teacherDb, `users/${uid}/performance_scores/${legacyZeroId}`), {
      ...score,
      rosterId: legacyZeroId,
      totalScore: 0,
      items: [{ name: "이전 기준", score: 0, maxScore: 20 }],
    }),
  );
  await assertSucceeds(
    setDoc(
      doc(
        studentDb,
        `users/${uid}/performance_scores/${legacyZeroId}/confirmations/${uid}`,
      ),
      { ...signature(), rosterId: legacyZeroId },
    ),
  );
  check(
    "unentered title remains readable but cannot be signed; entered real zero and legacy count-less scores can sign; same-version transition to unentered is denied",
  );

  await assertFails(setDoc(doc(studentDb, confirmationPath), signature(Timestamp.fromMillis(1))));
  await assertSucceeds(setDoc(doc(studentDb, confirmationPath), signature()));
  assert.equal((await getDoc(doc(teacherDb, confirmationPath))).data().signatureName, creation.name);
  await assertFails(setDoc(doc(studentDb, confirmationPath), signature()));
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: "근거를 다시 확인해 주세요." })), { code: "failed-precondition" });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '답안을 확인하고 싶습니다.', answerSheetRequested: true })), { code: 'failed-precondition' });
  await assert.rejects(functions.notifyPerformanceScoreAnswerSheetRequested.run(req(actor, { scoreIds: [scoreId], reason: '구 화면에서 답안을 확인하고 싶습니다.' })),
    (error) => error.code === 'failed-precondition' && error.details?.reason === 'ANSWER_SHEET_REQUEST_REQUIRES_OBJECTION');
  check("upload → own score read → signature → teacher retrieval; foreign read, score editing, stale signature and signature replacement denied");

  const writtenScoreId = "written-exam-detailed-feedback";
  const writtenScorePath = `users/${uid}/performance_scores/${writtenScoreId}`;
  const writtenConfirmationPath = `${writtenScorePath}/confirmations/${uid}`;
  const writtenFeedback = [
    "(1) 임진왜란이라는 사건명을 정확하게 작성하였습니다.",
    "(2) 명의 참전으로 전쟁이 확대되었음을 설명하였습니다. 조선·명·일본의 관계를 더 구체적으로 서술해 보세요.",
    "(3) 전라도의 중요성을 식량 공급과 연결하여 설명하였습니다.",
    "(4) 두 신하의 주장과 근거를 제시하였습니다. 제시한 근거가 주장과 어떻게 연결되는지 한 문장 더 보완해 보세요.",
  ].join("\n\n");
  const writtenItems = [1, 3, 1, 5].map((maxScore, index) => ({
    questionNumber: 1, examSection: "essay", itemKey: `1-(${index + 1})`,
    groupKey: "1", groupLabel: "1번", name: `1-(${index + 1})`,
    shortName: `1-(${index + 1})`, maxScore, score: [1, 2, 1, 4][index],
    scoreEntered: true, feedback: writtenFeedback.split("\n\n")[index],
  }));
  const writtenScore = {
    ...score, rosterId: writtenScoreId, scoreKind: "written_exam_essay",
    title: "하위 문항 검증용 정기시험", items: writtenItems, enteredScoreCount: 4,
    totalScore: 8, totalMaxScore: 10, feedback: writtenFeedback, evidence: writtenFeedback,
  };
  const writtenSignature = (scoreUpdatedAt = version) => ({
    ...signature(scoreUpdatedAt), rosterId: writtenScoreId,
  });
  await assertSucceeds(setDoc(doc(teacherDb, writtenScorePath), writtenScore));
  const writtenRead = await assertSucceeds(getDoc(doc(studentDb, writtenScorePath)));
  assert.deepEqual(writtenRead.data().items, writtenItems);
  assert.equal(writtenRead.data().feedback, writtenFeedback);
  assert.equal(writtenRead.data().totalScore, 8);
  await assertFails(getDoc(doc(otherDb, writtenScorePath)));
  await assertFails(updateDoc(doc(studentDb, writtenScorePath), { totalScore: 10 }));
  const writtenConsentRef = admin.doc(`users/${uid}/performance_score_consents/current`);
  const writtenSavedConsent = (await writtenConsentRef.get()).data();
  await writtenConsentRef.delete();
  await assertFails(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature()));
  await writtenConsentRef.set(writtenSavedConsent);
  await assertFails(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature(Timestamp.fromMillis(1))));
  await assertFails(setDoc(doc(studentDb, writtenConfirmationPath), { ...writtenSignature(), signatureImage: "" }));
  await assertFails(setDoc(doc(otherDb, writtenConfirmationPath), writtenSignature()));
  await assertSucceeds(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature()));
  const writtenTeacherRead = await assertSucceeds(getDoc(doc(teacherDb, writtenConfirmationPath)));
  assert.equal(writtenTeacherRead.data().uid, uid);
  assert.equal(writtenTeacherRead.data().rosterId, writtenScoreId);
  assert.equal(writtenTeacherRead.data().signatureName, creation.name);
  assert.equal(writtenTeacherRead.data().scoreUpdatedAt.toMillis(), version.toMillis());
  assert.equal((await getDoc(doc(studentDb, writtenConfirmationPath))).data().signatureImage, writtenTeacherRead.data().signatureImage);
  await assertFails(getDocs(query(collectionGroup(teacherDb, "confirmations"), where("rosterId", "==", writtenScoreId))));
  await assertFails(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature()));
  const changedWrittenVersion = Timestamp.fromMillis(version.toMillis() + 1);
  await assertSucceeds(updateDoc(doc(teacherDb, writtenScorePath), { updatedAt: changedWrittenVersion }));
  await assertFails(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature()));
  await assertSucceeds(setDoc(doc(studentDb, writtenConfirmationPath), writtenSignature(changedWrittenVersion)));
  assert.equal((await getDoc(doc(teacherDb, writtenConfirmationPath))).data().scoreUpdatedAt.toMillis(), changedWrittenVersion.toMillis());
  check("written exam preserves all four scores and reasons; consent, own signature, current version and teacher direct-document receipt work; collection-group receipt is denied by existing rules");

  const nextVersion = Timestamp.fromMillis(Date.now());
  await assertSucceeds(updateDoc(doc(teacherDb, scorePath), { totalScore: 16, updatedAt: nextVersion }));
  await assertFails(setDoc(doc(studentDb, confirmationPath), signature()));
  const siblingId = "signature-batch-sibling";
  const siblingPath = `users/${uid}/performance_scores/${siblingId}`;
  const siblingConfirmation = doc(studentDb, siblingPath, "confirmations", uid);
  await assertSucceeds(setDoc(doc(teacherDb, siblingPath), { ...score, rosterId: siblingId }));
  const staleBatch = writeBatch(studentDb);
  staleBatch.set(doc(studentDb, confirmationPath), signature(version));
  staleBatch.set(siblingConfirmation, { ...signature(version), rosterId: siblingId });
  await assertFails(staleBatch.commit());
  assert.equal((await getDoc(siblingConfirmation)).exists(), false);
  const maintenance = admin.doc("site_settings/student_maintenance");
  const now = require("firebase-admin/firestore").Timestamp.now();
  await maintenance.set({
    enabled: false, blockedRoles: ["student"],
    bypassUids: Array.from({ length: 20 }, (_, index) => `fixture-${index}`),
    title: "점검", message: "검증", startedAt: null,
    updatedAt: now, updatedBy: teacher.uid, revision: 1,
  });
  await assertSucceeds(setDoc(siblingConfirmation, { ...signature(version), rosterId: siblingId }));
  await maintenance.delete();
  await assertSucceeds(deleteDoc(doc(teacherDb, siblingConfirmation.path)));
  await assertSucceeds(deleteDoc(doc(teacherDb, siblingPath)));
  check("a stale reviewed version rejects the whole signature batch; a current sibling can sign with valid maintenance configuration");
  await assertSucceeds(setDoc(doc(studentDb, confirmationPath), signature(nextVersion)));
  await assertSucceeds(deleteDoc(doc(teacherDb, confirmationPath)));
  const consentRef = admin.doc(`users/${uid}/performance_score_consents/current`);
  const savedConsent = (await consentRef.get()).data();
  const consentRejected = (error) => error.code === 'failed-precondition' && error.details?.reason === 'SCORE_WARNING_CONSENT_REQUIRED';
  await consentRef.delete();
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '미동의 요청', answerSheetRequested: true })), consentRejected);
  await consentRef.set({ ...savedConsent, acknowledged: false });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '동의 false 요청', answerSheetRequested: true })), consentRejected);
  await consentRef.set({ ...savedConsent, semester: '1' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '이전 학기 동의 요청', answerSheetRequested: true })), consentRejected);
  await consentRef.set({ ...savedConsent, uid: 'other-student' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '다른 UID 동의 요청', answerSheetRequested: true })), consentRejected);
  await consentRef.set(savedConsent);
  const scoreSettingsRef = admin.doc(`${root}/assessment_config/performance_score`);
  await scoreSettingsRef.set({ warningVersion: 'updated-warning', warningTextHash: 'updated-hash' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '이전 경고 버전 요청', answerSheetRequested: true })), consentRejected);
  await consentRef.update({ warningVersion: 'updated-warning' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '이전 경고 해시 요청', answerSheetRequested: true })), consentRejected);
  await scoreSettingsRef.delete();
  await consentRef.set(savedConsent);
  check('missing, declined, wrong UID/semester and stale warning version/hash consent are rejected');
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '답안 확인', answerSheetRequested: 'true' })), { code: 'invalid-argument' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '다른 학기', semester: '1', answerSheetRequested: true })), { code: 'invalid-argument' });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: '다른 평가 종류', scoreKind: 'written_exam_essay', answerSheetRequested: true })), { code: 'invalid-argument' });
  await admin.doc(`users/${uid}/performance_scores/wrong-owner`).set({ ...score, uid: 'other-student', rosterId: 'wrong-owner', updatedAt: require('firebase-admin/firestore').Timestamp.fromMillis(version.toMillis()) });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: ['wrong-owner'], reason: '다른 학생 점수', answerSheetRequested: true })), { code: 'permission-denied' });
  await admin.doc(`users/${uid}/performance_scores/wrong-owner`).delete();
  const otherActor = { uid: 'other-student', token: { email: 'other@yongshin-ms.ms.kr', auth_time: authTime } };
  await admin.doc('users/other-student').set({ uid: otherActor.uid, role: 'student', email: otherActor.token.email });
  await seedSession(otherActor.uid);
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(otherActor, { uid, scoreIds: [scoreId], reason: 'UID 위조 요청', answerSheetRequested: true })), { code: 'not-found' });
  const objection = await functions.notifyPerformanceScoreObjectionRequested.run(req(actor, {
    scoreIds: [scoreId], reason: "평가 요소의 근거를 다시 확인해 주세요.", answerSheetRequested: true,
  }));
  assert.equal(objection.objectionSavedCount, 1);
  assert.equal((await admin.doc(`${root}/performance_score_objections/${objection.objectionIds[0]}`).get()).data().answerSheetRequested, true);
  assert.equal((await admin.collection(`${root}/performance_score_answer_sheet_requests`).get()).size, 0);
  assert.equal(objection.createdCount, 1);
  const teacherNotifications = await admin.collection(`${root}/notification_inboxes/${teacher.uid}/items`).get();
  const objectionNotification = teacherNotifications.docs.find((entry) => entry.data().type === 'performance_score_objection_requested');
  assert.ok(objectionNotification);
  assert.equal(objectionNotification.data().answerSheetRequested, true);
  assert.match(objectionNotification.data().body, /답안지 확인도 요청/);
  await assertSucceeds(getDoc(doc(teacherDb, objectionNotification.ref.path)));
  await assertFails(getDoc(doc(studentDb, objectionNotification.ref.path)));
  assert.equal((await admin.doc(scorePath).get()).data().objectionPending, true);
  await assertFails(setDoc(doc(studentDb, confirmationPath), signature(nextVersion)));
  await assert.rejects(functions.reviewPerformanceScoreObjection.run(req(actor, {
    objectionId: objection.objectionIds[0], status: "rejected", reviewMemo: "임의 검토",
  })), { code: "permission-denied" });
  await assertSucceeds(updateDoc(doc(teacherDb, scorePath), { totalScore: 21 }));
  await assert.rejects(functions.reviewPerformanceScoreObjection.run(req(teacher, { objectionId: objection.objectionIds[0], status: 'accepted', changedTotalScore: 21 })), { code: 'invalid-argument' });
  await assertSucceeds(updateDoc(doc(teacherDb, scorePath), { totalScore: 16 }));
  await assert.rejects(functions.reviewPerformanceScoreObjection.run(req(teacher, { objectionId: objection.objectionIds[0], status: 'accepted', changedTotalScore: 15 })), { code: 'failed-precondition' });
  const review = await functions.reviewPerformanceScoreObjection.run(req(teacher, {
    objectionId: objection.objectionIds[0], status: "accepted", changedTotalScore: 16, reviewMemo: "근거 확인 후 1점 반영",
  }));
  assert.equal(review.status, "accepted");
  assert.equal(review.notificationCreated, true);
  const studentNotifications = await admin.collection(`${root}/notification_inboxes/${uid}/items`).get();
  const reviewNotification = studentNotifications.docs.find((entry) => entry.data().type === 'performance_score_objection_reviewed');
  assert.ok(reviewNotification);
  await assertSucceeds(getDoc(doc(studentDb, reviewNotification.ref.path)));
  assert.equal((await admin.doc(scorePath).get()).data().objectionPending, false);
  assert.equal((await getDoc(doc(studentDb, `${root}/performance_score_objections/${objection.objectionIds[0]}`))).data().reviewMemo, "근거 확인 후 1점 반영");
  const retry = await functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: "중복 요청", answerSheetRequested: true }));
  assert.equal(retry.objectionSavedCount, 0);
  assert.equal(retry.objectionSkippedProcessedCount, 1);
  await assertSucceeds(setDoc(doc(studentDb, confirmationPath), signature(nextVersion)));
  await assert.rejects(functions.notifyPerformanceScoreAnswerSheetRequested.run(req(actor, { scoreIds: [scoreId], reason: '답안의 채점 근거를 확인하고 싶습니다.' })),
    (error) => error.code === 'failed-precondition' && error.details?.reason === 'ANSWER_SHEET_REQUEST_REQUIRES_OBJECTION');
  check("changed score invalidates old version; objection blocks signature; teacher acceptance, student response read and duplicate protection");

  const extraScoreId = 'pending-answer-option';
  await admin.doc(`users/${uid}/performance_scores/${extraScoreId}`).set({ ...score, rosterId: extraScoreId, updatedAt: require('firebase-admin/firestore').Timestamp.fromMillis(version.toMillis()) });
  const ordinary = await functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [extraScoreId], reason: '점수 근거만 확인 요청' }));
  const ordinaryPath = `${root}/performance_score_objections/${ordinary.objectionIds[0]}`;
  assert.equal((await admin.doc(ordinaryPath).get()).data().answerSheetRequested, false);
  const promoted = await functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [extraScoreId], reason: '답안도 함께 확인 요청', answerSheetRequested: true }));
  assert.equal(promoted.objectionIds[0], ordinary.objectionIds[0]);
  assert.equal(promoted.createdCount, 0);
  assert.equal((await admin.doc(ordinaryPath).get()).data().answerSheetRequested, true);
  await functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [extraScoreId], reason: '구 클라이언트 재전송' }));
  assert.equal((await admin.doc(ordinaryPath).get()).data().answerSheetRequested, true);
  const pendingNotifications = (await admin.collection(`${root}/notification_inboxes/${teacher.uid}/items`).get()).docs.filter((entry) => entry.data().dedupeKey.includes(extraScoreId));
  assert.equal(pendingNotifications.length, 1);
  assert.equal(pendingNotifications[0].data().answerSheetRequested, true);
  assert.match(pendingNotifications[0].data().body, /답안지 확인도 요청/);
  const legacyRequestPath = `${root}/performance_score_answer_sheet_requests/legacy-answer-request`;
  await admin.doc(legacyRequestPath).set({ uid, scoreId, academicYear: year, semester, status: 'pending', reason: '기존 답안 확인 요청', requestedAt: require('firebase-admin/firestore').Timestamp.fromMillis(version.toMillis()) });
  const legacyBefore = (await admin.doc(legacyRequestPath).get()).data();
  await assert.rejects(functions.notifyPerformanceScoreAnswerSheetRequested.run(req(actor, { scoreIds: [extraScoreId], reason: '독립 접수 차단 확인' })),
    (error) => error.details?.reason === 'ANSWER_SHEET_REQUEST_REQUIRES_OBJECTION');
  assert.deepEqual((await admin.doc(legacyRequestPath).get()).data(), legacyBefore);
  await assertSucceeds(getDoc(doc(studentDb, legacyRequestPath)));
  await assertFails(updateDoc(doc(studentDb, legacyRequestPath), { status: 'reviewed' }));
  await assertSucceeds(updateDoc(doc(teacherDb, legacyRequestPath), { status: 'reviewed', reviewMemo: '기존 요청 확인 완료', reviewedAt: serverTimestamp() }));
  assert.equal((await getDoc(doc(studentDb, legacyRequestPath))).data().status, 'reviewed');
  assert.equal((await admin.collection(`${root}/performance_score_answer_sheet_requests`).get()).size, 1);
  check('unified answer flag persists on objection and one notification; pending retries retain it; standalone requests are retired; legacy records stay readable and reviewable');

  await admin.doc("semester_enrollments/canonical-enrollment").set({
    studentUid: uid, semesterId: "2026-2", enrollmentStatus: "ACTIVE", revision: 7, enrollmentId: "canonical-enrollment", classId: "existing-class",
  });
  await admin.doc("semester_manifests/2026-2").set({ startAt: "2026-09-01", endAt: "2027-02-28" }, { merge: true });
  await admin.doc(`${root}/assessment_config/enrollment_movement`).set({ startDate: "2026-08-14" });
  const recoveredRoster = admin.doc(`${root}/performance_score_rosters/missing-row`);
  const otherClass = admin.doc(`${root}/performance_score_rosters/other-class`);
  const written = admin.doc(`${root}/performance_score_rosters/written`);
  await recoveredRoster.set({ academicYear: year, semester, targetGrade: "3", targetClass: "1", rows: [], items: [{ name: "기준", maxScore: 20 }] });
  await otherClass.set({ academicYear: year, semester, targetGrade: "3", targetClass: "2", rows: [] });
  await written.set({ academicYear: year, semester, scoreKind: "written_exam_essay", targetGrade: "3", targetClass: "1", rows: [] });
  const transfer = { uid, status: "transferred", reason: "전출", movementDate: "2026-08-14" };
  for (const movementDate of [null, "2026-02-30", "2099-12-01"]) {
    await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { ...transfer, movementDate })), { code: "invalid-argument" });
  }
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { ...transfer, movementTiming: "before" })), { code: "failed-precondition" });
  await admin.doc("semester_manifests/2026-2").update({ endAt: "2026-08-31" });
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { ...transfer, movementDate: "2026-09-01" })), { code: "invalid-argument" });
  await admin.doc("semester_manifests/2026-2").update({ endAt: "2027-02-28" });
  await functions.updateStudentEnrollment.run(req(teacher, { ...transfer, movementDate: "2026-08-13" }));
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentMovementTiming, "before");
  assert.equal((await recoveredRoster.get()).data().rows.length, 0);
  await functions.updateStudentEnrollment.run(req(teacher, transfer));
  await functions.updateStudentEnrollment.run(req(teacher, transfer));
  const restored = (await recoveredRoster.get()).data();
  assert.equal(restored.rows.length, 1);
  assert.equal(restored.matchedCount, 1);
  assert.equal(restored.rows[0].enteredScoreCount, 0);
  assert.equal(restored.rows[0].enrollmentMovementTiming, "during");
  assert.equal(restored.rows[0].enrollmentMovementDate, transfer.movementDate);
  assert.equal((await otherClass.get()).data().rows.length, 0);
  assert.equal((await written.get()).data().rows.length, 0);
  assert.equal((await admin.doc(scorePath).get()).data().totalScore, 16);
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentMovementTiming, "during");
  assert.equal((await admin.doc(`users/${uid}`).get()).data().enrollmentStatus, "transferred");
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentStatus, "transferred");
  assert.equal((await admin.doc(`users/${uid}/performance_scores/past`).get()).data().enrollmentStatus, undefined);
  assert.equal((await admin.doc(`${root}/performance_score_rosters/${scoreId}`).get()).data().rows[0].enrollmentStatus, "transferred");
  assert.equal((await admin.doc(confirmationPath).get()).exists, true);
  const canonical = (await admin.doc("semester_enrollments/canonical-enrollment").get()).data();
  assert.equal(canonical.rosterExclusionStatus, "transferred");
  assert.equal(canonical.rosterExclusionMovementDate, transfer.movementDate);
  assert.equal(canonical.rosterExclusionMovementTiming, "during");
  assert.equal(canonical.enrollmentStatus, "ACTIVE");
  assert.equal(canonical.enrollmentId, "canonical-enrollment");
  assert.equal(canonical.revision, 7);
  await assertFails(updateDoc(doc(studentDb, `users/${uid}`), { enrollmentStatus: "active" }));
  await assertFails(updateDoc(doc(studentDb, `users/${uid}`), { enrollmentMovementTiming: "before", enrollmentMovementDate: "2026-08-12" }));
  await assertSucceeds(deleteDoc(doc(teacherDb, confirmationPath)));
  await assertFails(setDoc(doc(studentDb, confirmationPath), signature(nextVersion)));
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: "답안 확인을 요청합니다.", answerSheetRequested: true })), { code: "failed-precondition" });
  await functions.updateStudentEnrollment.run(req(teacher, { uid, status: "active", reason: "" }));
  await assertSucceeds(setDoc(doc(studentDb, confirmationPath), signature(nextVersion)));
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentMovementTiming, null);
  assert.equal((await admin.collection(`users/${uid}/enrollment_history`).get()).size, 3);
  await admin.doc(`${root}/assessment_config/enrollment_movement`).delete();
  const outside = { ...transfer, status: "outside_quota" };
  await functions.updateStudentEnrollment.run(req(teacher, outside));
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentMovementTiming, "before");
  await admin.doc("semester_manifests/2026-2").delete();
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, outside)), { code: "invalid-argument" });
  await functions.updateStudentEnrollment.run(req(teacher, { ...outside, movementTiming: "during" }));
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentStatus, "outside_quota");
  assert.equal((await admin.doc(scorePath).get()).data().enrollmentMovementTiming, "during");
  await functions.updateStudentEnrollment.run(req(teacher, { uid, status: "active", reason: "" }));
  check("exclusion preserves score/signature, updates current roster only, blocks self-reactivation/signing/requests, restoration works with audit history");
  await admin.doc('site_settings/semester_active').set({ semesterId: '2027-1' });
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { uid, status: 'transferred', reason: '학기 경계' })), { code: 'failed-precondition' });
  assert.equal((await admin.doc(`users/${uid}`).get()).data().enrollmentStatus, 'active');
  await admin.doc('site_settings/semester_active').set({ semesterId: '2026-2' });
  const raceEmail = 'scope.race@yongshin-ms.ms.kr';
  const raceUser = await auth.createUser({ email: raceEmail });
  const raceHandlers = require('../functions/studentRoster.js').createStudentRosterHandlers({
    db: admin, assertManager: async () => teacher, assertScope: (data) => ({ year: data.year, semester: data.semester }),
    auth: { getUserByEmail: async () => {
      await admin.doc('site_settings/config').set({ year: '2027', semester: '1' });
      return raceUser;
    } },
  });
  await assert.rejects(raceHandlers.createStudentData(req(teacher, { ...creation, email: raceEmail, number: '8' })), { code: 'failed-precondition' });
  assert.equal((await admin.doc(`users/${raceUser.uid}`).get()).exists, false);
  await admin.doc('site_settings/config').set({ year, semester });
  const legacyUid = 'legacy-profile-student';
  await admin.doc(`users/${legacyUid}`).set({ role: 'student', ...creation, email: 'legacy.profile@yongshin-ms.ms.kr', number: '9' });
  await admin.doc(`users/${legacyUid}/performance_scores/legacy`).set({ ...score, uid: legacyUid, rosterId: 'legacy', number: '9', updatedAt: require('firebase-admin/firestore').Timestamp.fromMillis(version.toMillis()) });
  await functions.updateStudentData.run(req(teacher, { ...creation, uid: legacyUid, number: '10', name: '수정학생', email: 'legacy.profile@yongshin-ms.ms.kr' }));
  assert.equal((await admin.doc(`users/${legacyUid}/performance_scores/legacy`).get()).data().updatedAt.toMillis(), version.toMillis());
  assert.equal((await admin.doc(`users/${legacyUid}/performance_scores/legacy`).get()).data().number, '10');
  check('transaction scope rejects concurrent semester changes; classification retries are idempotent; profile identity edits preserve score signature version');
  await assert.rejects(functions.updateStudentData.run(req(teacher, { uid, ...creation, name: "변경학생" })),
    (error) => error.details?.reason === "STUDENT_PROFILE_CANONICAL_COMMAND_REQUIRED");
  assert.equal((await admin.doc(`users/${uid}`).get()).data().name, creation.name);
  await assertSucceeds(deleteDoc(doc(teacherDb, confirmationPath)));
  await admin.doc("semester_grade_records/canonical-grade").set({ studentUid: uid, semesterId: "2026-2" });
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: "공식 원장 확인" })),
    (error) => error.details?.reason === "CLIENT_UPDATE_REQUIRED");
  await assert.rejects(functions.notifyPerformanceScoreObjectionRequested.run(req(actor, { scoreIds: [scoreId], reason: "공식 원장 답안 확인 요청", answerSheetRequested: true })),
    (error) => error.details?.reason === "CLIENT_UPDATE_REQUIRED");
  await assert.rejects(functions.updateStudentEnrollment.run(req(teacher, { uid, status: "active", reason: "", _session: { ...sessionProof, revision: "a".repeat(64) } })),
    (error) => error.details?.reason === "SESSION_PROOF_INVALID");
  await admin.doc(`application_sessions/${teacher.uid}/sessions/${authTime}`).update({ status: "closed" });
  await assert.rejects(functions.createStudentData.run(req(teacher, { ...creation, number: "2", email: "blocked@yongshin-ms.ms.kr" })), { code: "unauthenticated" });
  check("canonical classification preserves lifecycle/revision, canonical profile/grade commands stay fenced, invalid and revoked sessions are denied");
} finally {
  await env.cleanup();
  await require("firebase-admin/app").deleteApp(require("firebase-admin/app").getApp());
}
