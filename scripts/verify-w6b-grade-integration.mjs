import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

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
const warningHash = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
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
  return {
    app,
    auth,
    db,
    functions,
    proof: null,
    user: null,
    sessionAuthTime: 0,
  };
};

const openSession = async (client) => {
  const result = (
    await httpsCallable(
      client.functions,
      "openApplicationSession",
    )({
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
  return httpsCallable(
    client.functions,
    "executeCommand",
  )({
    commandId,
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
};

const queryGrade = (client, payload) =>
  httpsCallable(
    client.functions,
    "getGradeEvidenceState",
  )({
    ...payload,
    _session: client.proof,
  });

const reason = (error) => String(error?.details?.reason || error?.customData?.details?.reason || error?.code || error?.message);

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
  await expectReason(execute(client, commandType, payload, { commandId, dropResponse: true }), "TEST_RESPONSE_LOSS");
  const recovered = (
    await httpsCallable(
      client.functions,
      "getCommandStatus",
    )({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(recovered.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId })).data;
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

const writeAdminDocuments = (testEnv, entries) =>
  withAdminDb(testEnv, async (db) => {
    for (let offset = 0; offset < entries.length; offset += 350) {
      const batch = writeBatch(db);
      entries.slice(offset, offset + 350).forEach(([path, data]) => {
        batch.set(doc(db, path), data);
      });
      await batch.commit();
    }
  });

const deleteAdminDocuments = (testEnv, paths) =>
  withAdminDb(testEnv, async (db) => {
    for (let offset = 0; offset < paths.length; offset += 350) {
      const batch = writeBatch(db);
      paths.slice(offset, offset + 350).forEach((path) => {
        batch.delete(doc(db, path));
      });
      await batch.commit();
    }
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
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, (await readCollection(testEnv, path)).length])));
};

const readAssessmentFingerprint = async (testEnv) => {
  const paths = [`semester_assessment_attempts/${attemptId}`, `semester_assessment_submissions/${attemptId}`, `semester_assessment_results/${attemptId}`];
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
    admin.user = (await createUserWithEmailAndPassword(admin.auth, "westoria28@gmail.com", password())).user;
    teacher.user = (await createUserWithEmailAndPassword(teacher.auth, "w6b-grade-teacher@yongshin-ms.ms.kr", password())).user;
    unauthorizedTeacher.user = (await createUserWithEmailAndPassword(unauthorizedTeacher.auth, "w6b-grade-no-permission@yongshin-ms.ms.kr", password())).user;
    student.user = (await createUserWithEmailAndPassword(student.auth, "w6b-grade-student@yongshin-ms.ms.kr", password())).user;
    outsider.user = (await createUserWithEmailAndPassword(outsider.auth, "w6b-grade-outsider@yongshin-ms.ms.kr", password())).user;

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
        }),
        setDoc(doc(db, "users", unauthorizedTeacher.user.uid), {
          role: "student",
          teacherPortalEnabled: true,
          staffPermissions: ["quiz_read"],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
        setDoc(doc(db, "users", outsider.user.uid), { role: "student" }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId,
          revision: 1,
        }),
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
        setDoc(doc(db, "semester_enrollment_slots", `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`), {
          slotId: `slot_${sha256(`${semesterId}\n${student.user.uid}`).slice(0, 40)}`,
          semesterId,
          studentUid: student.user.uid,
          activeEnrollmentId: enrollmentId,
          status: "ACTIVE",
        }),
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

    await Promise.all([openSession(admin), openSession(teacher), openSession(unauthorizedTeacher), openSession(student), openSession(outsider)]);

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
    const pointerMismatchCounts = await countBusinessAndGatewayDocuments(testEnv);
    for (const pointer of [
      { semesterId: "2026-1", revision: 1 },
      { semesterId, revision: 2 },
    ]) {
      await withAdminDb(testEnv, (db) =>
        setDoc(doc(db, "site_settings", "semester_active"), pointer),
      );
      await expectReason(
        execute(teacher, "createGradeDraft", createPayload),
        "GRADE_SEMESTER_NOT_ACTIVE",
      );
      assert.deepEqual(
        await countBusinessAndGatewayDocuments(testEnv),
        pointerMismatchCounts,
      );
    }
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, "site_settings", "semester_active"), {
        semesterId,
        revision: 1,
      }),
    );
    await expectReason(execute(unauthorizedTeacher, "createGradeDraft", createPayload), "GRADE_MANAGE_REQUIRED");
    await expectReason(
      execute(teacher, "createGradeDraft", createPayload, {
        commandId: createCommandId,
        dropResponse: true,
      }),
      "TEST_RESPONSE_LOSS",
    );
    const recoveredCreate = (
      await httpsCallable(
        teacher.functions,
        "getCommandStatus",
      )({
        commandId: createCommandId,
        commandType: "createGradeDraft",
        _session: teacher.proof,
      })
    ).data;
    assert.equal(recoveredCreate.status, "SUCCEEDED");
    const createResult = recoveredCreate.result;
    const createReplay = (
      await execute(teacher, "createGradeDraft", createPayload, {
        commandId: createCommandId,
      })
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
        items: [
          {
            itemId: "q1",
            maxScore: 10,
            awardedScore: 11,
            evaluationKind: "TEACHER",
            evidence: "invalid range",
            reason: "must fail",
          },
        ],
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
        items: [
          {
            itemId: "q1",
            maxScore: 10,
            awardedScore: 9,
            evaluationKind: "TEACHER",
            evidence: "rubric evidence",
            reason: "teacher review",
          },
        ],
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
      execute(teacher, "reviewGradeDraft", reviewPayload, {
        commandId: randomUUID(),
      }),
      execute(teacher, "reviewGradeDraft", reviewPayload, {
        commandId: randomUUID(),
      }),
    ]);
    assert.equal(concurrentReviews.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(reason(concurrentReviews.find((item) => item.status === "rejected")?.reason), "GRADE_REVISION_CONFLICT");
    const reviewed = concurrentReviews.find((item) => item.status === "fulfilled").value.data.result;
    assert.equal((await readCollection(testEnv, "semester_grade_versions")).length, 2);
    assert.equal(reviewed.status, "REVIEWED");
    const finalized = await executeWithResponseLossRecovery(teacher, "finalizeGradeEvidence", {
      ...baseMutation,
      recordId: reviewed.recordId,
      expectedRevision: reviewed.revision,
      expectedGradeRevision: reviewed.gradeRevision,
      expectedVersionId: reviewed.versionId,
      reason: "W6B 증거 확정",
    });
    assert.equal(finalized.status, "EVIDENCE_LOCKED");
    const published = await executeWithResponseLossRecovery(teacher, "publishOfficialGrade", {
      ...baseMutation,
      recordId: finalized.recordId,
      expectedRevision: finalized.revision,
      expectedGradeRevision: finalized.gradeRevision,
      expectedVersionId: finalized.versionId,
      signatureRequired: true,
      reason: "W6B 공식 성적 게시",
    });
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
    const manualVersion = await readDocument(testEnv, `semester_grade_versions/${manualReviewed.versionId}`);
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
      execute(teacher, "finalizeGradeEvidence", manualFinalizePayload, {
        commandId: randomUUID(),
      }),
      execute(teacher, "finalizeGradeEvidence", manualFinalizePayload, {
        commandId: randomUUID(),
      }),
    ]);
    assert.equal(manualFinalizeRace.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(reason(manualFinalizeRace.find((item) => item.status === "rejected")?.reason), "GRADE_REVISION_CONFLICT");
    assert.equal((await readDocument(testEnv, `semester_grade_records/${manualDraft.recordId}`)).status, "EVIDENCE_LOCKED");
    assert.equal((await readCollection(testEnv, "semester_grade_versions")).filter((item) => item.data.recordId === manualDraft.recordId).length, 2);

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
    await expectReason(getDoc(doc(student.db, "semester_grade_records", signed.recordId)), "permission-denied");

    // The immutable W6A source is never rewritten by the grade lifecycle.
    assert.equal(await readAssessmentFingerprint(testEnv), sourceFingerprintBefore);

    // W10P legacy score surfaces use one W6B transaction for roster, canonical
    // evidence, per-student projection, requests, signatures, and deletion.
    const legacyRosterId = "w10p-legacy-roster";
    const legacyItem = {
      name: "역사 탐구 보고서",
      itemKey: "history-report",
      score: 9,
      maxScore: 10,
      ratio: 100,
      scoreEntered: true,
      feedback: "교사 채점 근거",
    };
    const legacyRecord = {
      uid: student.user.uid,
      grade: "3",
      class: "1",
      number: "1",
      studentName: "W6B 합성 학생",
      items: [legacyItem],
      enteredScoreCount: 1,
      totalScore: 9,
      totalMaxScore: 10,
      feedback: "교사 채점 근거",
      evidence: "교사 채점표",
    };
    const legacyRosterPayload = {
      ...baseMutation,
      rosterId: legacyRosterId,
      expectedRosterRevision: 0,
      mode: "CREATE",
      roster: {
        scoreKind: "performance",
        title: "역사 탐구 보고서",
        subject: "역사",
        targetGrade: "3",
        targetClass: "1",
        classes: ["1"],
        items: [{ ...legacyItem, score: 0, scoreEntered: false }],
        totalMaxScore: 10,
        rowCount: 1,
        matchedCount: 1,
        unmatchedCount: 0,
        sourceFileName: "history-report.xlsx",
        rows: [
          {
            rowNumber: 1,
            ...legacyRecord,
            matchStatus: "matched",
            matchMessage: "",
          },
        ],
        uploadedByEmail: "w6b-grade-teacher@yongshin-ms.ms.kr",
      },
      records: [legacyRecord],
      reason: "레거시 수행평가를 W6B 원장에 저장합니다.",
    };
    const relatedRosterId = "w10p-related-roster";
    const relatedManualRow = {
      rowNumber: 2,
      uid: "",
      grade: "3",
      class: "1",
      number: "20",
      studentName: "수동 학생 이전",
      items: [{ ...legacyItem, score: 0, scoreEntered: false }],
      enteredScoreCount: 0,
      totalScore: 0,
      totalMaxScore: 10,
      feedback: "",
      evidence: "",
      matchStatus: "unmatched",
      matchMessage: "수동으로 추가한 학생입니다.",
      isManual: true,
    };
    const relatedRoster = {
      ...legacyRosterPayload.roster,
      title: "두 번째 역사 수행평가",
      rows: [legacyRosterPayload.roster.rows[0], relatedManualRow],
      rowCount: 2,
      matchedCount: 1,
      unmatchedCount: 1,
    };
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, `years/2026/semesters/2/performance_score_rosters/${relatedRosterId}`), {
        ...relatedRoster,
        schemaVersion: 1,
        policyVersion: "w10p-w6b-legacy-v1",
        revision: 1,
        academicYear: "2026",
        semester: "2",
      }),
    );
    legacyRosterPayload.relatedRosters = [
      {
        rosterId: relatedRosterId,
        expectedRosterRevision: 1,
        roster: {
          ...relatedRoster,
          rows: [
            relatedRoster.rows[0],
            {
              ...relatedManualRow,
              number: "21",
              studentName: "수동 학생 변경",
            },
          ],
        },
      },
    ];
    const activeStudentProjection = (
      await queryGrade(teacher, {
        mode: "TEACHER_QUEUE",
        audience: "teacher",
        semesterId,
        source: "CURRENT",
        scoreKind: "performance",
      })
    ).data;
    assert.equal(activeStudentProjection.activeStudents.length, 1);
    assert.equal(activeStudentProjection.activeStudents[0].studentUid, student.user.uid);

    const legacyCountsBeforePermission = {
      records: (await readCollection(testEnv, "semester_grade_records")).length,
      versions: (await readCollection(testEnv, "semester_grade_versions")).length,
      rosters: (await readCollection(testEnv, "years/2026/semesters/2/performance_score_rosters")).length,
    };
    await expectReason(execute(unauthorizedTeacher, "upsertLegacyGradeRoster", legacyRosterPayload), "GRADE_MANAGE_REQUIRED");
    assert.deepEqual(
      {
        records: (await readCollection(testEnv, "semester_grade_records")).length,
        versions: (await readCollection(testEnv, "semester_grade_versions")).length,
        rosters: (await readCollection(testEnv, "years/2026/semesters/2/performance_score_rosters")).length,
      },
      legacyCountsBeforePermission,
    );

    const invalidLegacyPayload = structuredClone(legacyRosterPayload);
    invalidLegacyPayload.rosterId = "w10p-invalid-roster";
    invalidLegacyPayload.roster.rows.push({
      ...invalidLegacyPayload.roster.rows[0],
      rowNumber: 2,
      uid: outsider.user.uid,
      number: "2",
      studentName: "활성 학적 없음",
    });
    invalidLegacyPayload.roster.rowCount = 2;
    invalidLegacyPayload.roster.matchedCount = 2;
    invalidLegacyPayload.records.push({
      ...invalidLegacyPayload.records[0],
      uid: outsider.user.uid,
      number: "2",
      studentName: "활성 학적 없음",
    });
    await expectReason(execute(teacher, "upsertLegacyGradeRoster", invalidLegacyPayload), "GRADE_ENROLLMENT_MISMATCH");
    assert.equal(await readDocument(testEnv, "years/2026/semesters/2/performance_score_rosters/w10p-invalid-roster"), null);
    assert.deepEqual(
      {
        records: (await readCollection(testEnv, "semester_grade_records")).length,
        versions: (await readCollection(testEnv, "semester_grade_versions")).length,
      },
      {
        records: legacyCountsBeforePermission.records,
        versions: legacyCountsBeforePermission.versions,
      },
    );

    const projectionCollisionRosterId = "w10p-projection-collision";
    const projectionCollisionPath = `users/${student.user.uid}/performance_scores/${projectionCollisionRosterId}`;
    await writeAdminDocuments(testEnv, [
      [
        projectionCollisionPath,
        {
          uid: student.user.uid,
          rosterId: projectionCollisionRosterId,
          academicYear: "2025",
          semester: "2",
          scoreKind: "performance",
        },
      ],
    ]);
    const projectionCollisionPayload = structuredClone(legacyRosterPayload);
    projectionCollisionPayload.rosterId = projectionCollisionRosterId;
    projectionCollisionPayload.relatedRosters = [];
    await expectReason(
      execute(teacher, "upsertLegacyGradeRoster", projectionCollisionPayload),
      "GRADE_PROJECTION_SCOPE_MISMATCH",
    );
    assert.equal(
      (
        await readDocument(testEnv, projectionCollisionPath)
      ).academicYear,
      "2025",
    );
    assert.equal(
      await readDocument(
        testEnv,
        `years/2026/semesters/2/performance_score_rosters/${projectionCollisionRosterId}`,
      ),
      null,
    );
    await deleteAdminDocuments(testEnv, [projectionCollisionPath]);

    const deleteCollisionRosterId = "w10p-delete-projection-collision";
    const deleteCollisionRosterPath = `years/2026/semesters/2/performance_score_rosters/${deleteCollisionRosterId}`;
    const deleteCollisionProjectionPath = `users/${student.user.uid}/performance_scores/${deleteCollisionRosterId}`;
    await writeAdminDocuments(testEnv, [
      [
        deleteCollisionRosterPath,
        {
          revision: 1,
          academicYear: "2026",
          semester: "2",
          scoreKind: "performance",
          rows: [{ rowNumber: 1, uid: student.user.uid }],
        },
      ],
      [
        deleteCollisionProjectionPath,
        {
          uid: outsider.user.uid,
          rosterId: deleteCollisionRosterId,
          academicYear: "2026",
          semester: "2",
          scoreKind: "performance",
        },
      ],
    ]);
    await expectReason(
      execute(teacher, "deleteLegacyGradeRoster", {
        ...baseMutation,
        rosterId: deleteCollisionRosterId,
        expectedRosterRevision: 1,
        reason: "다른 학생 projection 충돌은 삭제하지 않습니다.",
      }),
      "GRADE_PROJECTION_SCOPE_MISMATCH",
    );
    assert.ok(await readDocument(testEnv, deleteCollisionRosterPath));
    assert.equal(
      (
        await readDocument(testEnv, deleteCollisionProjectionPath)
      ).uid,
      outsider.user.uid,
    );
    await deleteAdminDocuments(testEnv, [
      deleteCollisionProjectionPath,
      deleteCollisionRosterPath,
    ]);

    const boundary101Payload = structuredClone(legacyRosterPayload);
    boundary101Payload.rosterId = "w10p-roster-101-boundary";
    boundary101Payload.relatedRosters = [];
    boundary101Payload.records = Array.from({ length: 101 }, (_, index) => ({
      ...legacyRecord,
      number: String(index + 1),
    }));
    await expectReason(
      execute(teacher, "upsertLegacyGradeRoster", boundary101Payload),
      "GRADE_ROSTER_LIMIT_EXCEEDED",
    );
    assert.equal(
      await readDocument(
        testEnv,
        "years/2026/semesters/2/performance_score_rosters/w10p-roster-101-boundary",
      ),
      null,
    );

    const roster240Id = "w10p-roster-240-empty-projections";
    const roster240Path = `years/2026/semesters/2/performance_score_rosters/${roster240Id}`;
    const rows240 = Array.from({ length: 240 }, (_, index) => ({
      rowNumber: index + 1,
      uid: `w6b-roster-only-${String(index + 1).padStart(3, "0")}`,
    }));
    await writeAdminDocuments(testEnv, [
      [
        roster240Path,
        {
          revision: 1,
          academicYear: "2026",
          semester: "2",
          scoreKind: "performance",
          rows: rows240,
        },
      ],
    ]);
    const roster240Deleted = (
      await execute(teacher, "deleteLegacyGradeRoster", {
        ...baseMutation,
        rosterId: roster240Id,
        expectedRosterRevision: 1,
        reason: "240행 빈 projection 점수표를 원자 삭제합니다.",
      })
    ).data.result;
    assert.equal(roster240Deleted.status, "DELETED");
    assert.equal(await readDocument(testEnv, roster240Path), null);

    const atomicRosterId = "w10p-roster-atomic-limit";
    const atomicRosterPath = `years/2026/semesters/2/performance_score_rosters/${atomicRosterId}`;
    const atomicRows = Array.from({ length: 150 }, (_, index) => ({
      rowNumber: index + 1,
      uid: `w6b-atomic-student-${String(index + 1).padStart(3, "0")}`,
    }));
    const atomicSeedEntries = [
      [
        atomicRosterPath,
        {
          revision: 1,
          academicYear: "2026",
          semester: "2",
          scoreKind: "performance",
          rows: atomicRows,
        },
      ],
    ];
    atomicRows.forEach((row, index) => {
      const recordId = `grade_${(0x200000 + index).toString(16).padStart(64, "0")}`;
      atomicSeedEntries.push(
        [
          `users/${row.uid}/performance_scores/${atomicRosterId}`,
          {
            uid: row.uid,
            rosterId: atomicRosterId,
            academicYear: "2026",
            semester: "2",
            scoreKind: "performance",
            gradeRecordId: recordId,
          },
        ],
        [
          `users/${row.uid}/performance_scores/${atomicRosterId}/confirmations/${row.uid}`,
          { uid: row.uid },
        ],
        [
          `semester_grade_records/${recordId}`,
          {
            recordId,
            semesterId,
            studentUid: row.uid,
            sourceKind: "MANUAL_IMPORT",
            sourceId: atomicRosterId,
            revision: 1,
          },
        ],
      );
    });
    await writeAdminDocuments(testEnv, atomicSeedEntries);
    await expectReason(
      execute(teacher, "deleteLegacyGradeRoster", {
        ...baseMutation,
        rosterId: atomicRosterId,
        expectedRosterRevision: 1,
        reason: "Firestore 원자 쓰기 예산을 초과하면 전부 보존합니다.",
      }),
      "GRADE_ROSTER_ATOMIC_LIMIT_EXCEEDED",
    );
    assert.ok(await readDocument(testEnv, atomicRosterPath));
    assert.ok(
      await readDocument(
        testEnv,
        `users/${atomicRows[0].uid}/performance_scores/${atomicRosterId}`,
      ),
    );
    assert.ok(
      await readDocument(
        testEnv,
        `semester_grade_records/grade_${(0x200000).toString(16).padStart(64, "0")}`,
      ),
    );
    await deleteAdminDocuments(
      testEnv,
      atomicSeedEntries.map(([path]) => path),
    );

    const syntheticQueueEntries = Array.from({ length: 1001 }, (_, index) => {
      const recordId = `grade_${(0x400000 + index).toString(16).padStart(64, "0")}`;
      return [
        `semester_grade_records/${recordId}`,
        {
          schemaVersion: 1,
          policyVersion: "w6b-v1",
          recordId,
          currentVersionId: `gradever_${(0x400000 + index).toString(16).padStart(64, "0")}`,
          revision: 1,
          gradeRevision: 1,
          status: "DRAFT",
          semesterId,
          studentUid: `w6b-large-student-${index + 1}`,
          enrollmentId: `w6b-large-enrollment-${index + 1}`,
          classId,
          sourceKind: "MANUAL_IMPORT",
          sourceId: `w6b-large-source-${index + 1}`,
          scoreKind: "performance",
          title: `대형 성적 큐 ${String(index + 1).padStart(4, "0")}`,
          rubricVersion: "w6b-rubric-v1",
          totalScore: 1,
          totalMaxScore: 1,
          percent: 100,
          evidenceHash: "a".repeat(64),
          signatureRequired: true,
          enrollmentSnapshot: {},
        },
      ];
    });
    const syntheticQueueIds = new Set(
      syntheticQueueEntries.map(([path]) => path.split("/").at(-1)),
    );
    await writeAdminDocuments(testEnv, syntheticQueueEntries);
    const seenSyntheticQueueIds = new Set();
    let queueCursor = "";
    let queuePageCount = 0;
    do {
      const queuePage = (
        await queryGrade(teacher, {
          mode: "TEACHER_QUEUE",
          audience: "teacher",
          semesterId,
          source: "CURRENT",
          scoreKind: "performance",
          ...(queueCursor ? { cursor: queueCursor } : {}),
        })
      ).data;
      assert.ok(queuePage.records.length <= 25);
      assert.ok(queuePage.pendingSources.length <= 25);
      assert.ok(queuePage.activeStudents.length <= 25);
      queuePage.records.forEach((record) => {
        if (syntheticQueueIds.has(record.recordId)) {
          assert.equal(seenSyntheticQueueIds.has(record.recordId), false);
          seenSyntheticQueueIds.add(record.recordId);
        }
      });
      queueCursor = queuePage.nextCursor;
      queuePageCount += 1;
    } while (queueCursor && queuePageCount < 60);
    assert.equal(queueCursor, "");
    assert.equal(seenSyntheticQueueIds.size, 1001);
    assert.ok(queuePageCount >= 41 && queuePageCount <= 42);
    await deleteAdminDocuments(
      testEnv,
      syntheticQueueEntries.map(([path]) => path),
    );

    const legacySaved = await executeWithResponseLossRecovery(teacher, "upsertLegacyGradeRoster", legacyRosterPayload);
    assert.equal(legacySaved.recordCount, 1);
    assert.equal(legacySaved.records.length, 1);
    assert.deepEqual(legacySaved.relatedRosterRevisions, [{ rosterId: relatedRosterId, revision: 2 }]);
    const legacyMeta = legacySaved.records[0];
    const legacyHeadPath = `semester_grade_records/${legacyMeta.recordId}`;
    const legacyScorePath = `users/${student.user.uid}/performance_scores/${legacyRosterId}`;
    assert.equal((await readDocument(testEnv, legacyHeadPath)).status, "OFFICIAL_PENDING_SIGNATURE");
    assert.equal((await readDocument(testEnv, legacyScorePath)).gradeRecordId, legacyMeta.recordId);
    const relatedRosterAfter = await readDocument(testEnv, `years/2026/semesters/2/performance_score_rosters/${relatedRosterId}`);
    assert.equal(relatedRosterAfter.revision, 2);
    assert.equal(relatedRosterAfter.rows[0].studentName, "W6B 합성 학생");
    assert.equal(relatedRosterAfter.rows[1].number, "21");
    assert.equal((await readCollection(testEnv, "semester_grade_records")).length, legacyCountsBeforePermission.records + 1);
    assert.equal((await readCollection(testEnv, "semester_grade_versions")).length, legacyCountsBeforePermission.versions + 1);

    const warningText = "본인 성적만 확인하고 본인 이름으로 서명해 주세요.";
    const warningTextHash = warningHash(warningText);
    const warningVersion = `warning-${warningTextHash}`;
    await execute(teacher, "saveLegacyGradeConfig", {
      ...baseMutation,
      configKind: "WARNING",
      configId: "performance_score",
      expectedRevision: 0,
      operation: "UPSERT",
      data: { warningText, warningVersion, warningTextHash },
      reason: "학생 성적 확인 경고 설정",
    });
    await execute(student, "acknowledgeLegacyGradeWarning", {
      ...baseMutation,
      warningVersion,
      warningTextHash,
    });
    const legacyRecordRef = {
      recordId: legacyMeta.recordId,
      scoreId: legacyRosterId,
      expectedRevision: 1,
      expectedGradeRevision: 1,
      targetDetails: "역사 탐구 보고서 채점 근거",
    };
    const legacyRequest = (
      await execute(student, "submitLegacyGradeRequest", {
        ...baseMutation,
        requestKind: "ANSWER_SHEET",
        records: [legacyRecordRef],
        reason: "답안 근거를 확인하고 싶습니다.",
      })
    ).data.result;
    await execute(teacher, "reviewLegacyGradeRequest", {
      ...baseMutation,
      requestId: legacyRequest.requestId,
      expectedRequestRevision: 1,
      resolution: "REVIEWED",
      changedTotalScore: null,
      reviewMemo: "채점 근거를 확인했습니다.",
    });
    await execute(student, "signLegacyGradeRecords", {
      ...baseMutation,
      records: [legacyRecordRef],
      signatureName: "W6B 합성 학생",
      signatureImage: "data:image/png;base64,aGVsbG8=",
      statementVersion: "w6b-grade-statement-v1",
    });
    assert.equal((await readDocument(testEnv, legacyHeadPath)).status, "OFFICIAL");
    assert.ok(await readDocument(testEnv, `${legacyScorePath}/confirmations/${student.user.uid}`));
    await execute(teacher, "rejectLegacyGradeSignatures", {
      ...baseMutation,
      studentUid: student.user.uid,
      records: [
        {
          ...legacyRecordRef,
          expectedRevision: 2,
          targetDetails: "",
        },
      ],
      reason: "서명 이미지를 다시 확인해야 합니다.",
    });
    assert.equal((await readDocument(testEnv, legacyHeadPath)).gradeRevision, 2);
    assert.equal(await readDocument(testEnv, `${legacyScorePath}/confirmations/${student.user.uid}`), null);

    await execute(teacher, "saveLegacyGradeConfig", {
      ...baseMutation,
      configKind: "GRADING_PLAN",
      configId: "history-plan",
      expectedRevision: 0,
      operation: "UPSERT",
      data: {
        subject: "역사",
        targetGrade: "3",
        items: [
          { type: "정기", name: "지필평가", maxScore: 100, ratio: 60 },
          { type: "수행", name: "탐구 보고서", maxScore: 10, ratio: 40 },
        ],
      },
      reason: "평가 반영 비율 저장",
    });
    await execute(teacher, "saveLegacyGradeConfig", {
      ...baseMutation,
      configKind: "OMR",
      configId: "final_exam",
      expectedRevision: 0,
      operation: "UPSERT",
      data: {
        objective: [
          { score: 4, answer: 0 },
          { score: 4, answer: 3 },
        ],
        subjective: [{ subItems: [{ score: 5, answer: "고구려" }] }],
      },
      reason: "정기시험 답안 설정 저장",
    });
    assert.equal((await readDocument(testEnv, "years/2026/semesters/2/exam_config/final_exam")).objective[0].answer, 0);
    const hiddenExamAnswers = (
      await queryGrade(student, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "written_exam_essay",
      })
    ).data;
    assert.equal(hiddenExamAnswers.status, "NOT_RELEASED");
    assert.equal(hiddenExamAnswers.examAnswers, null);
    await expectReason(
      queryGrade(outsider, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "written_exam_essay",
      }),
      "GRADE_STUDENT_ANSWER_SCOPE_REQUIRED",
    );
    await execute(teacher, "saveLegacyGradeConfig", {
      ...baseMutation,
      configKind: "OMR",
      configId: "final_exam",
      expectedRevision: 1,
      operation: "UPSERT",
      data: {
        objective: [
          { score: 4, answer: 1 },
          { score: 4, answer: 3 },
        ],
        subjective: [{ subItems: [{ score: 5, answer: "고구려" }] }],
        releaseStatus: "RELEASED",
        releasePolicyVersion: "w6b-answer-release-v1",
      },
      reason: "시험 종료 후 학생에게 정답 공개",
    });
    const releasedExamAnswers = (
      await queryGrade(student, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "written_exam_essay",
      })
    ).data;
    assert.equal(releasedExamAnswers.status, "RELEASED");
    assert.equal(releasedExamAnswers.examAnswers.objective[0].answer, 1);
    assert.equal(
      releasedExamAnswers.examAnswers.subjective[0].subItems[0].answer,
      "고구려",
    );
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, "site_settings", "semester_active"), {
        semesterId,
        revision: 2,
      }),
    );
    await expectReason(
      queryGrade(student, {
        mode: "STUDENT_EXAM_ANSWERS",
        audience: "student",
        semesterId,
        source: "CURRENT",
        scoreKind: "written_exam_essay",
      }),
      "GRADE_SEMESTER_NOT_ACTIVE",
    );
    await withAdminDb(testEnv, (db) =>
      setDoc(doc(db, "site_settings", "semester_active"), {
        semesterId,
        revision: 1,
      }),
    );
    await execute(teacher, "deleteLegacyGradeRoster", {
      ...baseMutation,
      rosterId: legacyRosterId,
      expectedRosterRevision: 1,
      reason: "점수표 삭제",
    });
    assert.equal(await readDocument(testEnv, `years/2026/semesters/2/performance_score_rosters/${legacyRosterId}`), null);
    assert.equal(await readDocument(testEnv, legacyScorePath), null);
    assert.equal((await readDocument(testEnv, legacyHeadPath)).status, "WITHDRAWN");
    assert.ok(await readDocument(testEnv, `users/${student.user.uid}`));

    // Readiness evaluates canonical linkage and official signature evidence.
    await withAdminDb(testEnv, async (db) => {
      await setDoc(
        doc(db, "semester_manifests", semesterId),
        {
          status: "PREPARING",
        },
        { merge: true },
      );
    });
    await execute(admin, "validateSemesterReadiness", {
      semesterId,
      expectedRevision: 1,
    });
    const readinessReport = await readDocument(testEnv, `semester_readiness_reports/${semesterId}`);
    const gradeReadiness = readinessReport.checks.find((check) => check.checkId === "grade_evidence_readiness");
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
      await setDoc(
        doc(db, "semester_manifests", semesterId),
        {
          status: "ARCHIVED",
        },
        { merge: true },
      );
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

    console.log(
      JSON.stringify({
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
          "CANONICAL_ACTIVE_POINTER_REVISION_ZERO_WRITE",
          "LEGACY_ROSTER_UPLOAD_ATOMIC_W6B_PROJECTION",
          "LEGACY_UPLOAD_RESPONSE_LOSS_EFFECT_ONCE",
          "LEGACY_BULK_INVALID_ENROLLMENT_ZERO_PARTIAL_WRITE",
          "LEGACY_101_RECORD_BOUNDARY_REJECTED",
          "LEGACY_240_EMPTY_PROJECTION_ROSTER_ATOMIC_DELETE",
          "LEGACY_451_WRITE_BUDGET_ZERO_PARTIAL_WRITE",
          "LEGACY_PROJECTION_OVERWRITE_DELETE_OWNERSHIP_DENIED",
          "TEACHER_QUEUE_1001_RECORD_CURSOR_BOUNDED_25",
          "LEGACY_WARNING_REQUEST_SIGNATURE_REJECTION",
          "LEGACY_CONFIG_CAS_AND_SCOPED_ROSTER_DELETE",
          "EXAM_ANSWERS_HIDDEN_RESPONSE_HAS_NO_ANSWERS",
          "EXAM_ANSWERS_RELEASED_ACTIVE_STUDENT_ONLY",
          "EXAM_ANSWERS_POINTER_REVISION_FAIL_CLOSED",
        ],
        canonicalCollections: {
          records: (await readCollection(testEnv, "semester_grade_records")).length,
          versions: (await readCollection(testEnv, "semester_grade_versions")).length,
          requests: (await readCollection(testEnv, "semester_grade_requests")).length,
          attestations: (await readCollection(testEnv, "semester_grade_attestations")).length,
        },
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.allSettled(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
