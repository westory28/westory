import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w6b";
const productionProjectId = "history-quiz-yongsin";
assert.equal(projectId, "demo-westory-session-w6b", "W6B integration requires its exact demo project.");
assert.notEqual(projectId, productionProjectId, "Production access is forbidden.");
for (const variable of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) {
  assert.ok(process.env[variable], `${variable} is required through firebase emulators:exec.`);
}

const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const semesterId = "2026-2";
const attemptId = `attempt_${sha256("w6b-grade-integration-attempt")}`;
const definitionId = "quiz:2026-2:w6b-grade:formative";
const enrollmentId = "w6b-grade-enrollment";
const classId = "w6b-grade-class";
const sourceHash = sha256("w6b-grade-immutable-assessment-source");

const makeClient = (name) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { app, auth, db, functions, proof: null, user: null, sessionAuthTime: 0 };
};

const openSession = async (client) => {
  const result = (
    await httpsCallable(client.functions, "openApplicationSession")({
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
    })
  ).data;
  client.proof = {
    authorityGeneration: result.authorityGeneration,
    protocolVersion: result.protocolVersion,
    revision: result.revision,
  };
  client.sessionAuthTime = Number(result.authTime || 0);
};

const execute = (client, commandType, payload, options = {}) => {
  const commandId = options.commandId || randomUUID();
  return httpsCallable(client.functions, "executeCommand")({
    commandId,
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
};

const queryGrade = (client, payload) =>
  httpsCallable(client.functions, "getGradeEvidenceState")({
    ...payload,
    _session: client.proof,
  });

const reason = (error) => String(
  error?.details?.reason
  || error?.customData?.details?.reason
  || error?.code
  || error?.message,
);

const expectReason = async (operation, expected) => {
  try {
    await (typeof operation === "function" ? operation() : operation);
  } catch (error) {
    assert.equal(reason(error), expected);
    return;
  }
  throw new Error(`Expected ${expected}.`);
};

const executeWithResponseLossRecovery = async (client, commandType, payload) => {
  const commandId = randomUUID();
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const recovered = (
    await httpsCallable(client.functions, "getCommandStatus")({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(recovered.status, "SUCCEEDED");
  const replay = (
    await execute(client, commandType, payload, { commandId })
  ).data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, recovered.result);
  return recovered.result;
};

const withAdminDb = async (testEnv, operation) => {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await operation(context.firestore());
  });
  return result;
};

const readCollection = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDocs(collection(db, path));
    return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  });

const readDocument = (testEnv, path) =>
  withAdminDb(testEnv, async (db) => {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? snapshot.data() : null;
  });

const countBusinessAndGatewayDocuments = async (testEnv) => {
  const paths = [
    "semester_grade_records",
    "semester_grade_versions",
    "semester_grade_requests",
    "semester_grade_attestations",
    "grade_legacy_issues",
    "command_receipts",
    "command_audit_events",
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    (await readCollection(testEnv, path)).length,
  ])));
};

const readAssessmentFingerprint = async (testEnv) => {
  const paths = [
    `semester_assessment_attempts/${attemptId}`,
    `semester_assessment_submissions/${attemptId}`,
    `semester_assessment_results/${attemptId}`,
  ];
  const values = await Promise.all(paths.map((path) => readDocument(testEnv, path)));
  return sha256(JSON.stringify(values));
};

const baseMutation = {
  semesterId,
  expectedSemesterRevision: 1,
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const admin = makeClient("w6b-grade-admin");
  const teacher = makeClient("w6b-grade-teacher");
  const unauthorizedTeacher = makeClient("w6b-grade-unauthorized-teacher");
  const student = makeClient("w6b-grade-student");
  const outsider = makeClient("w6b-grade-outsider");

  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(
        admin.auth,
        "westoria28@gmail.com",
        password(),
      )
    ).user;
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w6b-grade-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    unauthorizedTeacher.user = (
      await createUserWithEmailAndPassword(
        unauthorizedTeacher.auth,
        "w6b-grade-no-permission@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w6b-grade-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    outsider.user = (
      await createUserWithEmailAndPassword(
        outsider.auth,
        "w6b-grade-outsider@yongshin-ms.ms.kr",
        password(),
      )
    ).user;

    const submittedAtIso = "2026-08-12T00:00:00.000Z";
    const answers = { q1: "정답", q2: "오답" };
    const gradingSnapshot = [
      { id: "q1", answer: "정답" },
      { id: "q2", answer: "정답" },
    ];
    const answerChecks = [
      { id: "q1", correct: true },
      { id: "q2", correct: false },
    ];
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), {
          role: "admin",
          teacherPortalEnabled: true,
          staffPermissions: ["quiz_read", "lesson_read"],
        }),
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["quiz_read"],
        }),
        setDoc(doc(db, "users", unauthorizedTeacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: [],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
        setDoc(doc(db, "users", outsider.user.uid), { role: "student" }),
        setDoc(doc(db, "site_settings", "semester_active"), { semesterId, revision: 1 }),
        setDoc(doc(db, "semester_manifests", semesterId), {
          semesterId,
          schoolYear: "2026",
          term: "2",
          status: "ACTIVE",
          revision: 1,
          schemaVersion: 1,
          readinessPolicyVersion: "w3-v1",
        }),
        setDoc(doc(db, "semester_classes", classId), {
          classId,
          semesterId,
          grade: "3",
          classNumber: "1",
          classKey: "3::1",
          status: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollments", enrollmentId), {
          enrollmentId,
          semesterId,
          studentUid: student.user.uid,
          classId,
          enrollmentStatus: "ACTIVE",
          snapshot: {
            displayName: "W6B 합성 학생",
            studentNumber: "1",
            grade: "3",
            classNumber: "1",
          },
        }),
        setDoc(
          doc(
            db,
            "semester_enrollment_slots",
            `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`,
          ),
          {
            slotId: `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`,
            semesterId,
            studentUid: student.user.uid,
            activeEnrollmentId: enrollmentId,
            status: "ACTIVE",
          },
        ),
        setDoc(doc(db, "semester_assessment_attempts", attemptId), {
          attemptId,
          semesterId,
          definitionId,
          definitionRevision: 1,
          studentUid: student.user.uid,
          enrollmentId,
          classId,
          attemptNumber: 1,
          revision: 2,
          status: "SUBMITTED",
          questionIds: ["q1", "q2"],
          gradingSnapshot,
          answers,
          sourceHash,
          submissionRef: `semester_assessment_submissions/${attemptId}`,
          resultRef: `semester_assessment_results/${attemptId}`,
          submittedAtIso,
        }),
        setDoc(doc(db, "semester_assessment_submissions", attemptId), {
          submissionId: attemptId,
          attemptId,
          semesterId,
          definitionId,
          studentUid: student.user.uid,
          answers,
          attemptRevision: 2,
          sourceHash,
          submittedAtIso,
        }),
        setDoc(doc(db, "semester_assessment_results", attemptId), {
          resultId: attemptId,
          attemptId,
          semesterId,
          definitionId,
          studentUid: student.user.uid,
          enrollmentId,
          classId,
          submissionRef: `semester_assessment_submissions/${attemptId}`,
          answerChecks,
          score: 1,
          total: 2,
          percent: 50,
          sourceHash,
          submittedAtIso,
        }),
      ]);
    });
    const sourceFingerprintBefore = await readAssessmentFingerprint(testEnv);

    await Promise.all([
      openSession(admin),
      openSession(teacher),
      openSession(unauthorizedTeacher),
      openSession(student),
      openSession(outsider),
    ]);

    // Response loss followed by status recovery and replay proves effect-once command semantics.
    const createCommandId = randomUUID();
    const createPayload = {
      ...baseMutation,
      sourceKind: "ASSESSMENT_RESULT",
      attemptId,
      scoreKind: "performance",
      title: "W6B 수행평가 증거",
      rubricVersion: "w6b-rubric-v1",
      reason: "W6B integration synthetic source",
    };
    await expectReason(
      execute(unauthorizedTeacher, "createGradeDraft", createPayload),
      "GRADE_MANAGE_REQUIRED",
    );
    await expectReason(
      execute(teacher, "createGradeDraft", createPayload, {
        commandId: createCommandId,
        dropResponse: true,
      }),
      "TEST_RESPONSE_LOSS",
    );
    const recoveredCreate = (
      await httpsCallable(teacher.functions, "getCommandStatus")({
        commandId: createCommandId,
        commandType: "createGradeDraft",
        _session: teacher.proof,
      })
    ).data;
    assert.equal(recoveredCreate.status, "SUCCEEDED");
    const createResult = recoveredCreate.result;
    const createReplay = (
      await execute(teacher, "createGradeDraft", createPayload, { commandId: createCommandId })
    ).data.result;
    assert.deepEqual(createReplay, createResult);
    assert.equal((await readCollection(testEnv, "semester_grade_records")).length, 1);
    assert.equal((await readCollection(testEnv, "semester_grade_versions")).length, 1);

    await expectReason(
      execute(teacher, "reviewGradeDraft", {
        ...baseMutation,
        recordId: createResult.recordId,
        expectedRevision: createResult.revision,
        expectedGradeRevision: createResult.gradeRevision,
        items: [{
          itemId: "q1",
          maxScore: 10,
          awardedScore: 11,
          evaluationKind: "TEACHER",
          evidence: "invalid range",
          reason: "must fail",
        }],
        reason: "invalid awarded score must fail",
      }),
      "GRADE_ITEMS_INVALID",
    );

    // A stale tab cannot change the draft.
    await expectReason(
      execute(teacher, "reviewGradeDraft", {
        ...baseMutation,
        recordId: createResult.recordId,
        expectedRevision: createResult.revision + 1,
        expectedGradeRevision: createResult.gradeRevision,
        items: [{
          itemId: "q1",
          maxScore: 10,
          awardedScore: 9,
          evaluationKind: "TEACHER",
          evidence: "rubric evidence",
          reason: "teacher review",
        }],
        reason: "stale review must fail",
      }),
      "GRADE_REVISION_CONFLICT",
    );
    assert.equal((await readDocument(testEnv, `semester_grade_records/${createResult.recordId}`)).revision, 1);

    const reviewPayload = {
      ...baseMutation,
      recordId: createResult.recordId,
      expectedRevision: createResult.revision,
      expectedGradeRevision: createResult.gradeRevision,
      items: [
        {
          itemId: "q1",
          maxScore: 10,
          awardedScore: 9,
          evaluationKind: "TEACHER",
          evidence: "서술형 루브릭 증거",
          reason: "교사 검토",
        },
        {
          itemId: "q2",
          maxScore: 10,
          awardedScore: 7,
          evaluationKind: "TEACHER",
          evidence: "서술형 루브릭 증거",
          reason: "교사 검토",
        },
      ],
      reason: "W6B 교사 검토",
    };
    const concurrentReviews = await Promise.allSettled([
      execute(teacher, "reviewGradeDraft", reviewPayload, { commandId: randomUUID() }),
      execute(teacher, "reviewGradeDraft", reviewPayload, { commandId: randomUUID() }),
    ]);
    assert.equal(concurrentReviews.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(
      reason(concurrentReviews.find((item) => item.status === "rejected")?.reason),
      "GRADE_REVISION_CONFLICT",
    );
    const reviewed = concurrentReviews.find((item) => item.status === "fulfilled").value.data.result;
    assert.equal((await readCollection(testEnv, "semester_grade_versions")).length, 2);
    assert.equal(reviewed.status, "REVIEWED");
    const finalized = await executeWithResponseLossRecovery(
      teacher,
      "finalizeGradeEvidence",
      {
        ...baseMutation,
        recordId: reviewed.recordId,
        expectedRevision: reviewed.revision,
        expectedGradeRevision: reviewed.gradeRevision,
        expectedVersionId: reviewed.versionId,
        reason: "W6B 증거 확정",
      },
    );
    assert.equal(finalized.status, "EVIDENCE_LOCKED");
    const published = await executeWithResponseLossRecovery(
      teacher,
      "publishOfficialGrade",
      {
        ...baseMutation,
        recordId: finalized.recordId,
        expectedRevision: finalized.revision,
        expectedGradeRevision: finalized.gradeRevision,
        expectedVersionId: finalized.versionId,
        signatureRequired: true,
        reason: "W6B 공식 성적 게시",
      },
    );
    assert.equal(published.status, "OFFICIAL_PENDING_SIGNATURE");

    // Query callable is a zero-write projection and never exposes another student's record.
    const queryCountsBefore = await countBusinessAndGatewayDocuments(testEnv);
    const teacherQueue = (
      await queryGrade(teacher, {
        mode: "TEACHER_QUEUE",
        audience: "teacher",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(teacherQueue.records.length, 1);
    assert.equal(teacherQueue.writeCount, 0);
    assert.equal(teacherQueue.readOnly, false);
    const studentProjection = (
      await queryGrade(student, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(studentProjection.records.length, 1);
    assert.equal(studentProjection.records[0].studentUid, undefined);
    const outsiderProjection = (
      await queryGrade(outsider, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(outsiderProjection.records.length, 0);
    assert.deepEqual(await countBusinessAndGatewayDocuments(testEnv), queryCountsBefore);
    await expectReason(
      queryGrade(student, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "ARCHIVE",
        scoreKind: "performance",
      }),
      "GRADE_PROVENANCE_MISMATCH",
    );

    await expectReason(
      queryGrade(unauthorizedTeacher, {
        mode: "TEACHER_QUEUE",
        audience: "teacher",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      }),
      "GRADE_MANAGE_REQUIRED",
    );
    const foreignDetail = (
      await queryGrade(outsider, {
        mode: "GRADE_DETAIL",
        audience: "student",
        semesterId,
        recordId: published.recordId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(foreignDetail.records.length, 0);
    assert.equal(foreignDetail.detail, null);
    await expectReason(
      execute(outsider, "requestGradeReview", {
        ...baseMutation,
        recordId: published.recordId,
        expectedRevision: published.revision,
        expectedGradeRevision: published.gradeRevision,
        requestKind: "OBJECTION",
        reason: "다른 학생 성적 요청 차단",
      }),
      "GRADE_RECORD_FORBIDDEN",
    );

    // A manual teacher-scored record verifies totals and distinct-command finalize CAS.
    const manualDraft = (
      await execute(teacher, "createGradeDraft", {
        ...baseMutation,
        sourceKind: "MANUAL_IMPORT",
        manualSourceId: "w6b-manual-source",
        studentUid: student.user.uid,
        enrollmentId,
        classId,
        sourceHash: sha256("w6b-manual-source-hash"),
        scoreKind: "performance",
        title: "W6B 교사 수기 성적",
        rubricVersion: "w6b-rubric-v1",
        items: [
          {
            itemId: "manual-1",
            maxScore: 5,
            awardedScore: 4,
            evaluationKind: "TEACHER",
            evidence: "교사 관찰 기록",
            reason: "수기 입력",
          },
          {
            itemId: "manual-2",
            maxScore: 10,
            awardedScore: 6,
            evaluationKind: "TEACHER",
            evidence: "교사 관찰 기록",
            reason: "수기 입력",
          },
        ],
        reason: "W6B manual source integration",
      })
    ).data.result;
    const manualReviewed = (
      await execute(teacher, "reviewGradeDraft", {
        ...baseMutation,
        recordId: manualDraft.recordId,
        expectedRevision: manualDraft.revision,
        expectedGradeRevision: manualDraft.gradeRevision,
        items: [
          {
            itemId: "manual-1",
            maxScore: 5,
            awardedScore: 5,
            evaluationKind: "TEACHER",
            evidence: "교사 재검토 기록",
            reason: "수기 검토",
          },
          {
            itemId: "manual-2",
            maxScore: 10,
            awardedScore: 7,
            evaluationKind: "TEACHER",
            evidence: "교사 재검토 기록",
            reason: "수기 검토",
          },
        ],
        reason: "W6B manual teacher-scored review",
      })
    ).data.result;
    const manualVersion = await readDocument(
      testEnv,
      `semester_grade_versions/${manualReviewed.versionId}`,
    );
    assert.deepEqual(
      {
        totalScore: manualVersion.totalScore,
        totalMaxScore: manualVersion.totalMaxScore,
        percent: manualVersion.percent,
        evaluationKinds: manualVersion.items.map((item) => item.evaluationKind),
      },
      {
        totalScore: 12,
        totalMaxScore: 15,
        percent: 80,
        evaluationKinds: ["TEACHER", "TEACHER"],
      },
    );
    const manualFinalizePayload = {
      ...baseMutation,
      recordId: manualReviewed.recordId,
      expectedRevision: manualReviewed.revision,
      expectedGradeRevision: manualReviewed.gradeRevision,
      expectedVersionId: manualReviewed.versionId,
      reason: "manual finalize CAS",
    };
    const manualFinalizeRace = await Promise.allSettled([
      execute(teacher, "finalizeGradeEvidence", manualFinalizePayload, { commandId: randomUUID() }),
      execute(teacher, "finalizeGradeEvidence", manualFinalizePayload, { commandId: randomUUID() }),
    ]);
    assert.equal(manualFinalizeRace.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(
      reason(manualFinalizeRace.find((item) => item.status === "rejected")?.reason),
      "GRADE_REVISION_CONFLICT",
    );
    assert.equal(
      (await readDocument(testEnv, `semester_grade_records/${manualDraft.recordId}`)).status,
      "EVIDENCE_LOCKED",
    );
    assert.equal(
      (await readCollection(testEnv, "semester_grade_versions"))
        .filter((item) => item.data.recordId === manualDraft.recordId).length,
      2,
    );

    const rejectedRequest = (
      await execute(student, "requestGradeReview", {
        ...baseMutation,
        recordId: published.recordId,
        expectedRevision: published.revision,
        expectedGradeRevision: published.gradeRevision,
        requestKind: "OBJECTION",
        reason: "W6B 이의 신청 반려 경로",
      })
    ).data.result;
    const rejected = (
      await execute(teacher, "correctOfficialGrade", {
        ...baseMutation,
        recordId: published.recordId,
        expectedRevision: published.revision,
        expectedGradeRevision: published.gradeRevision,
        requestId: rejectedRequest.requestId,
        resolution: "REJECT",
        reason: "근거 확인 후 반려",
      })
    ).data.result;
    assert.equal(rejected.requestStatus, "REJECTED");
    assert.equal(rejected.revision, published.revision);
    assert.equal(rejected.gradeRevision, published.gradeRevision);

    const acceptedRequest = (
      await execute(student, "requestGradeReview", {
        ...baseMutation,
        recordId: published.recordId,
        expectedRevision: published.revision,
        expectedGradeRevision: published.gradeRevision,
        requestKind: "ANSWER_SHEET",
        reason: "W6B 답안지 확인 후 정정 요청",
      })
    ).data.result;
    const corrected = (
      await execute(teacher, "correctOfficialGrade", {
        ...baseMutation,
        recordId: published.recordId,
        expectedRevision: published.revision,
        expectedGradeRevision: published.gradeRevision,
        requestId: acceptedRequest.requestId,
        resolution: "CORRECT",
        items: [
          {
            itemId: "q1",
            maxScore: 10,
            awardedScore: 10,
            evaluationKind: "TEACHER",
            evidence: "재검토 증거",
            reason: "점수 정정",
          },
          {
            itemId: "q2",
            maxScore: 10,
            awardedScore: 8,
            evaluationKind: "TEACHER",
            evidence: "재검토 증거",
            reason: "점수 정정",
          },
        ],
        reason: "답안지 재검토 결과 정정",
      })
    ).data.result;
    assert.equal(corrected.requestStatus, "ACCEPTED");
    assert.equal(corrected.status, "REVIEWED");

    const refinalized = (
      await execute(teacher, "finalizeGradeEvidence", {
        ...baseMutation,
        recordId: corrected.recordId,
        expectedRevision: corrected.revision,
        expectedGradeRevision: corrected.gradeRevision,
        expectedVersionId: corrected.versionId,
        reason: "정정 증거 확정",
      })
    ).data.result;
    const republished = (
      await execute(teacher, "publishOfficialGrade", {
        ...baseMutation,
        recordId: refinalized.recordId,
        expectedRevision: refinalized.revision,
        expectedGradeRevision: refinalized.gradeRevision,
        expectedVersionId: refinalized.versionId,
        signatureRequired: true,
        reason: "정정 공식 성적 게시",
      })
    ).data.result;
    const acknowledgement = (
      await execute(student, "acknowledgeGradeEvidence", {
        ...baseMutation,
        recordId: republished.recordId,
        expectedRevision: republished.revision,
        expectedGradeRevision: republished.gradeRevision,
        statementVersion: "w6b-grade-statement-v1",
      })
    ).data.result;
    assert.equal(acknowledgement.replayedAttestation, false);
    const signed = (
      await execute(student, "signOfficialGrade", {
        ...baseMutation,
        recordId: republished.recordId,
        expectedRevision: republished.revision,
        expectedGradeRevision: republished.gradeRevision,
        signatureName: "W6B 학생",
        statementVersion: "w6b-grade-statement-v1",
      })
    ).data.result;
    assert.equal(signed.status, "OFFICIAL");

    const detailCountsBefore = await countBusinessAndGatewayDocuments(testEnv);
    const detail = (
      await queryGrade(student, {
        mode: "GRADE_DETAIL",
        audience: "student",
        semesterId,
        recordId: signed.recordId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(detail.detail.record.status, "OFFICIAL");
    assert.equal(detail.detail.requests.length, 2);
    assert.equal(detail.detail.attestations.length, 2);
    assert.equal(detail.writeCount, 0);
    assert.deepEqual(await countBusinessAndGatewayDocuments(testEnv), detailCountsBefore);

    // Client SDK cannot directly read canonical records even for its owner.
    await expectReason(
      getDoc(doc(student.db, "semester_grade_records", signed.recordId)),
      "permission-denied",
    );

    // The immutable W6A source is never rewritten by the grade lifecycle.
    assert.equal(await readAssessmentFingerprint(testEnv), sourceFingerprintBefore);

    // Readiness evaluates canonical linkage and official signature evidence.
    await withAdminDb(testEnv, async (db) => {
      await setDoc(doc(db, "semester_manifests", semesterId), {
        status: "PREPARING",
      }, { merge: true });
    });
    await execute(admin, "validateSemesterReadiness", {
      semesterId,
      expectedRevision: 1,
    });
    const readinessReport = await readDocument(testEnv, `semester_readiness_reports/${semesterId}`);
    const gradeReadiness = readinessReport.checks.find(
      (check) => check.checkId === "grade_evidence_readiness",
    );
    assert.deepEqual(
      {
        status: gradeReadiness?.status,
        ownerWave: gradeReadiness?.ownerWave,
        required: gradeReadiness?.required,
      },
      { status: "PASS", ownerWave: "W6B", required: true },
    );

    // Archived and legacy projections are explicit read-only states; mutations fail closed.
    await withAdminDb(testEnv, async (db) => {
      await setDoc(doc(db, "semester_manifests", semesterId), {
        status: "ARCHIVED",
      }, { merge: true });
    });
    const archiveCountsBefore = await countBusinessAndGatewayDocuments(testEnv);
    const archiveProjection = (
      await queryGrade(student, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "ARCHIVE",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(archiveProjection.status, "ARCHIVED");
    assert.equal(archiveProjection.provenance, "ARCHIVE");
    assert.equal(archiveProjection.readOnly, true);
    assert.equal(archiveProjection.writeCount, 0);
    const legacyProjection = (
      await queryGrade(student, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "LEGACY",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(legacyProjection.status, "LEGACY");
    assert.equal(legacyProjection.readOnly, true);
    assert.equal(legacyProjection.writeCount, 0);
    assert.deepEqual(await countBusinessAndGatewayDocuments(testEnv), archiveCountsBefore);
    await expectReason(
      execute(student, "requestGradeReview", {
        ...baseMutation,
        recordId: signed.recordId,
        expectedRevision: signed.revision,
        expectedGradeRevision: signed.gradeRevision,
        requestKind: "OBJECTION",
        reason: "보관 학기 쓰기 차단",
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );

    // An expired application session cannot use either command or query surfaces.
    await withAdminDb(testEnv, async (db) => {
      await setDoc(
        doc(db, `application_sessions/${outsider.user.uid}/sessions/${outsider.sessionAuthTime}`),
        {
          generalExpiresAt: Timestamp.fromMillis(Date.now() - 60_000),
          highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 60_000),
        },
        { merge: true },
      );
    });
    await expectReason(
      queryGrade(outsider, {
        mode: "MY_GRADES",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      }),
      "SESSION_EXPIRED",
    );

    console.log(JSON.stringify({
      suite: "w6b-grade-integration",
      passed: true,
      projectId,
      cases: [
        "ASSESSMENT_RESULT_IMMUTABLE_SOURCE_JOIN",
        "EIGHT_COMMAND_CANONICAL_LIFECYCLE",
        "COMMAND_RESPONSE_LOSS_STATUS_RECOVERY_EFFECT_ONCE",
        "SAME_COMMAND_REPLAY_EFFECT_ONCE",
        "STALE_REVISION_REJECTED",
        "INVALID_ITEM_RANGE_REJECTED",
        "DISTINCT_COMMAND_REVIEW_AND_FINALIZE_CAS_ONE_WIN",
        "FINALIZE_AND_PUBLISH_RESPONSE_LOSS_RECOVERY",
        "MANUAL_TEACHER_SCORED_TOTALS",
        "TEACHER_CAPABILITY_PERMISSION_MATRIX",
        "STUDENT_OWNERSHIP_COMMAND_AND_DETAIL_ISOLATION",
        "REQUEST_REJECT_AND_ACCEPT_CORRECTION",
        "ACKNOWLEDGEMENT_BEFORE_SIGNATURE",
        "QUERY_CALLABLE_ZERO_WRITE",
        "STUDENT_OWNERSHIP_PROJECTION",
        "DIRECT_CANONICAL_READ_DENIED",
        "ARCHIVE_AND_LEGACY_READ_ONLY",
        "ARCHIVE_COMMAND_FAIL_CLOSED",
        "EXPIRED_SESSION_QUERY_DENIED",
        "W6A_SOURCE_UNCHANGED",
        "GRADE_EVIDENCE_READINESS_PASS",
      ],
      canonicalCollections: {
        records: (await readCollection(testEnv, "semester_grade_records")).length,
        versions: (await readCollection(testEnv, "semester_grade_versions")).length,
        requests: (await readCollection(testEnv, "semester_grade_requests")).length,
        attestations: (await readCollection(testEnv, "semester_grade_attestations")).length,
      },
      productionAccess: 0,
    }));
  } finally {
    await Promise.allSettled(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
