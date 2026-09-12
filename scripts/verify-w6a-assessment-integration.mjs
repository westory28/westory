import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import wis from "../functions/wisEconomy.js";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w6a";
const region = "asia-northeast3";
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").at(-1) || 8080);
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const slotId = (semesterId, uid) => `slot_${sha256(`${semesterId}\n${uid}`).slice(0, 40)}`;

const makeClient = (name) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", firestorePort);
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

const queryCallable = (client, name, payload) =>
  httpsCallable(client.functions, name)({ ...payload, _session: client.proof });

const reason = (error) =>
  String(
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

// The signal is emitted after the Functions emulator cold start. Waiting for
// that marker keeps the race deterministic even on a constrained CPU.
const waitForDocument = async (testEnv, path, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readDocument(testEnv, path);
    if (value) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${path}.`);
};

const expireApplicationSession = (testEnv, client) =>
  withAdminDb(testEnv, async (db) => {
    assert.ok(client.sessionAuthTime > 0, "synthetic client session auth time is required");
    const sessionRef = doc(
      db,
      `application_sessions/${client.user.uid}/sessions/${client.sessionAuthTime}`,
    );
    assert.equal((await getDoc(sessionRef)).exists(), true);
    await setDoc(sessionRef, {
      generalExpiresAt: Timestamp.fromMillis(Date.now() - 60_000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 60_000),
    }, { merge: true });
  });

const reopenExpiredStudentSession = async (client, email, loginPassword) => {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
  client.user = (
    await signInWithEmailAndPassword(client.auth, email, loginPassword)
  ).user;
  await openSession(client);
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: firestorePort, rules },
  });
  const admin = makeClient("w6a-admin");
  const student = makeClient("w6a-student");
  const outsider = makeClient("w6a-outsider");
  const relogin = makeClient("w6a-student-relogin");
  const unauthorizedTeacher = makeClient("w6a-unauthorized-teacher");
  const adminPassword = password();
  const studentPassword = password();
  const outsiderPassword = password();
  const unauthorizedTeacherPassword = password();

  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(
        admin.auth,
        "westoria28@gmail.com",
        adminPassword,
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w6a-student@yongshin-ms.ms.kr",
        studentPassword,
      )
    ).user;
    outsider.user = (
      await createUserWithEmailAndPassword(
        outsider.auth,
        "w6a-outsider@yongshin-ms.ms.kr",
        outsiderPassword,
      )
    ).user;
    unauthorizedTeacher.user = (
      await createUserWithEmailAndPassword(
        unauthorizedTeacher.auth,
        "w6a-unauthorized-teacher@yongshin-ms.ms.kr",
        unauthorizedTeacherPassword,
      )
    ).user;

    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), {
          role: "admin",
          teacherPortalEnabled: true,
          staffPermissions: ["quiz_read", "lesson_read"],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
        setDoc(doc(db, "users", outsider.user.uid), { role: "student" }),
        // Assessment submission now commits its Wis reward in the same
        // transaction. Seed the canonical identity and zero-balance account.
        setDoc(doc(db, "student_identities", student.user.uid), {
          studentUid: student.user.uid, accountStatus: "ACTIVE",
        }),
        setDoc(doc(db, wis.WIS_ECONOMY_COLLECTION, "2026-2"), {
          semesterId: "2026-2", status: "ACTIVE_OPEN", revision: 1, ledgerEntryCount: 0,
        }),
        setDoc(doc(db, wis.WIS_ACCOUNT_COLLECTION, wis.accountIdFor("2026-2", student.user.uid)), {
          schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
          accountId: wis.accountIdFor("2026-2", student.user.uid),
          studentUid: student.user.uid, semesterId: "2026-2", enrollmentId: "enrollment-student",
          classId: "class-one", status: "ACTIVE", revision: 1, displayName: "합성학생",
          grade: "3", classNumber: "1", balance: 0, earnedTotal: 0, rankEarnedTotal: 0,
          adjustedTotal: 0, spentTotal: 0, recentLedgerEntries: [],
        }),
        setDoc(doc(db, "users", unauthorizedTeacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: [],
        }),
        setDoc(doc(db, "site_settings", "config"), {
          year: "2026",
          semester: "2",
          activeSemesterId: "2026-2",
        }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId: "2026-2",
          revision: 1,
        }),
        setDoc(doc(db, "semester_manifests", "2026-2"), {
          semesterId: "2026-2",
          schoolYear: "2026",
          term: "2",
          status: "ACTIVE",
          revision: 1,
          schemaVersion: 1,
          readinessPolicyVersion: "w3-v1",
        }),
        setDoc(doc(db, "semester_classes", "class-one"), {
          classId: "class-one",
          semesterId: "2026-2",
          grade: "3",
          classNumber: "1",
          classKey: "3::1",
          status: "ACTIVE",
        }),
        setDoc(doc(db, "semester_classes", "class-two"), {
          classId: "class-two",
          semesterId: "2026-2",
          grade: "3",
          classNumber: "2",
          classKey: "3::2",
          status: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollments", "enrollment-student"), {
          enrollmentId: "enrollment-student",
          semesterId: "2026-2",
          studentUid: student.user.uid,
          classId: "class-one",
          enrollmentStatus: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollments", "enrollment-outsider"), {
          enrollmentId: "enrollment-outsider",
          semesterId: "2026-2",
          studentUid: outsider.user.uid,
          classId: "class-two",
          enrollmentStatus: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollment_slots", slotId("2026-2", student.user.uid)), {
          semesterId: "2026-2",
          studentUid: student.user.uid,
          activeEnrollmentId: "enrollment-student",
        }),
        setDoc(doc(db, "semester_enrollment_slots", slotId("2026-2", outsider.user.uid)), {
          semesterId: "2026-2",
          studentUid: outsider.user.uid,
          activeEnrollmentId: "enrollment-outsider",
        }),
        setDoc(doc(db, "years/2026/semesters/2/quiz_questions/1"), {
          id: "1",
          unitId: "unit-one",
          category: "formative",
          answer: "정답",
        }),
        setDoc(doc(db, "years/2026/semesters/2/quiz_questions/2"), {
          id: "2",
          unitId: "unit-one",
          category: "formative",
          answer: "2",
        }),
        setDoc(doc(db, "years/2026/semesters/2/history_classrooms/history-one"), {
          title: "합성 역사교실",
          isPublished: true,
          targetStudentUids: [student.user.uid],
          blanks: [
            { id: "blank-1", answer: "고려" },
            { id: "blank-2", answer: "조선" },
          ],
        }),
        setDoc(doc(db, "years/2026/semesters/2/map_resources/map-one"), {
          title: "합성 지도",
          pdfBlanks: [],
          answerOptions: [],
          contentRevision: 0,
        }),
      ]);
    });

    await Promise.all([
      openSession(admin),
      openSession(student),
      openSession(outsider),
      openSession(unauthorizedTeacher),
    ]);

    const questionSaved = (await execute(admin, "upsertQuizQuestion", {
      semesterId: "2026-2",
      questionId: "1",
      question: {
        id: "1",
        unitId: "unit-one",
        subUnitId: null,
        category: "formative",
        type: "choice",
        question: "합성 문항 1",
        answer: "정답",
        options: ["정답", "오답"],
        explanation: "",
      },
      expectedRevision: 0,
      reason: "W6A emulator 문항 수정",
    })).data.result;
    assert.equal(questionSaved.contentRevision, 1);
    const temporaryQuestion = (await execute(admin, "upsertQuizQuestion", {
      semesterId: "2026-2",
      questionId: "temporary-question",
      question: {
        id: "temporary-question",
        unitId: "unit-one",
        subUnitId: null,
        category: "formative",
        type: "choice",
        question: "삭제 검증 문항",
        answer: "1",
        options: ["1", "2"],
        explanation: "",
      },
      expectedRevision: 0,
      reason: "W6A emulator 문항 생성",
    })).data.result;
    await execute(admin, "deleteQuizQuestion", {
      semesterId: "2026-2",
      questionId: "temporary-question",
      expectedRevision: temporaryQuestion.contentRevision,
      reason: "W6A emulator 문항 삭제",
    });
    assert.equal(
      await readDocument(testEnv, "years/2026/semesters/2/quiz_questions/temporary-question"),
      null,
    );

    const historySource = {
      title: "합성 역사교실",
      description: "",
      mapResourceId: "map-one",
      mapTitle: "합성 지도",
      pdfPageImages: [],
      pdfRegions: [],
      blanks: [
        { id: "blank-1", answer: "고려" },
        { id: "blank-2", answer: "조선" },
      ],
      answerOptions: ["고려", "조선"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      dueWindowDays: 7,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: student.user.uid,
      targetStudentUids: [student.user.uid],
      targetStudentAccessMap: { [student.user.uid]: true },
      targetStudentName: "합성 학생",
      targetStudentNames: ["합성 학생"],
      targetStudentReasons: {},
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: "2026-08-11T00:00:00.000Z",
      dueAt: "2026-08-18T00:00:00.000Z",
      retryResetByStudentUid: {},
    };
    const historySourceSaved = (await execute(admin, "upsertHistoryClassroomSource", {
      semesterId: "2026-2",
      sourceId: "history-one",
      source: historySource,
      expectedRevision: 0,
      reason: "W6A emulator 역사교실 수정",
    })).data.result;
    assert.equal(historySourceSaved.contentRevision, 1);
    const temporaryHistory = (await execute(admin, "upsertHistoryClassroomSource", {
      semesterId: "2026-2",
      sourceId: "history-temporary",
      source: { ...historySource, title: "삭제 검증 역사교실" },
      expectedRevision: 0,
      reason: "W6A emulator 역사교실 생성",
    })).data.result;
    const historyDeleted = (await execute(admin, "deleteHistoryClassroomSource", {
      semesterId: "2026-2",
      sourceId: "history-temporary",
      expectedRevision: temporaryHistory.contentRevision,
      reason: "W6A emulator 역사교실 삭제",
    })).data.result;
    assert.equal(historyDeleted.deleted, true);
    const mapSaved = (await execute(admin, "updateMapResourceBlanks", {
      semesterId: "2026-2",
      mapResourceId: "map-one",
      pdfBlanks: [{ id: "map-blank-1", page: 1, answer: "정답" }],
      answerOptions: ["정답"],
      expectedRevision: 0,
      reason: "W6A emulator 지도 빈칸 수정",
    })).data.result;
    assert.equal(mapSaved.contentRevision, 1);

    const definitions = [
      {
        definitionId: "quiz:2026-2:unit-one:formative",
        semesterId: "2026-2",
        assessmentKind: "QUIZ",
        title: "합성 형성평가",
        sourceId: "unit-one",
        category: "formative",
        questionCount: 2,
        legacyConfigKey: "unit-one::formative",
        presentationSettings: {
          active: true,
          questionCount: 2,
          randomOrder: true,
          questionOrder: "random",
          timeLimit: 600,
          allowRetake: true,
          cooldown: 0,
          hintLimit: 0,
          visibleTargetGrade: "3",
          visibleClassIds: ["3-1"],
          visibilityVersion: 2,
        },
        durationSeconds: 600,
        maxAttempts: 2,
        cooldownMinutes: 0,
        opensAt: "",
        closesAt: "",
        assignedClassIds: ["3-1"],
      },
      {
        definitionId: "history_classroom:2026-2:history-one",
        semesterId: "2026-2",
        assessmentKind: "HISTORY_CLASSROOM",
        title: "합성 역사교실",
        sourceId: "history-one",
        durationSeconds: 600,
        maxAttempts: 2,
        cooldownMinutes: 0,
        opensAt: "",
        closesAt: "",
        assignedClassIds: [],
      },
    ];

    const unauthorizedBefore = {
      definitions: (await readCollection(testEnv, "semester_assessment_definitions")).length,
      receipts: (await readCollection(testEnv, "command_receipts")).length,
      audits: (await readCollection(testEnv, "command_audit_events")).length,
    };
    await expectReason(
      execute(
        unauthorizedTeacher,
        "createAssessmentDefinition",
        definitions[0],
      ),
      "ASSESSMENT_MANAGE_REQUIRED",
    );
    assert.deepEqual(
      {
        definitions: (await readCollection(testEnv, "semester_assessment_definitions")).length,
        receipts: (await readCollection(testEnv, "command_receipts")).length,
        audits: (await readCollection(testEnv, "command_audit_events")).length,
      },
      unauthorizedBefore,
    );

    for (const definition of definitions) {
      const created = (await execute(admin, "createAssessmentDefinition", definition)).data.result;
      assert.equal(created.definition.status, "DRAFT");
      await execute(admin, "transitionAssessmentDefinition", {
        definitionId: definition.definitionId,
        expectedRevision: 1,
        targetStatus: "PUBLISHED",
        reason: "W6A emulator synthetic publish",
      });
    }

    const invalidLinkBefore = {
      attempts: (await readCollection(testEnv, "semester_assessment_attempts")).length,
      receipts: (await readCollection(testEnv, "command_receipts")).length,
      audits: (await readCollection(testEnv, "command_audit_events")).length,
    };
    const invalidLink = (
      await queryCallable(student, "getAssessmentState", {
        definitionId: "quiz:2026-2:missing:formative",
      })
    ).data;
    assert.equal(invalidLink.status, "INVALID_LINK");
    await expectReason(
      queryCallable(student, "getAssessmentState", {}),
      "ASSESSMENT_QUERY_INVALID",
    );
    await expectReason(
      execute(student, "startAssessmentAttempt", {
        definitionId: "quiz:2026-2:missing:formative",
      }),
      "ASSESSMENT_DEFINITION_NOT_FOUND",
    );
    assert.deepEqual(
      {
        attempts: (await readCollection(testEnv, "semester_assessment_attempts")).length,
        receipts: (await readCollection(testEnv, "command_receipts")).length,
        audits: (await readCollection(testEnv, "command_audit_events")).length,
      },
      invalidLinkBefore,
    );
    const outsiderPreview = (
      await queryCallable(outsider, "getAssessmentState", {
        definitionId: definitions[0].definitionId,
      })
    ).data;
    assert.equal(outsiderPreview.status, "PERMISSION");
    const projectedQuizSettings = await readDocument(
      testEnv,
      "years/2026/semesters/2/assessment_config/settings",
    );
    assert.equal(projectedQuizSettings["unit-one::formative"].active, true);
    assert.equal(projectedQuizSettings["unit-one::formative"].questionCount, 2);

    const writesBeforePreview = (await readCollection(testEnv, "semester_assessment_attempts")).length;
    const preview = (
      await queryCallable(student, "getAssessmentState", {
        definitionId: definitions[0].definitionId,
      })
    ).data;
    assert.equal(preview.status, "READY");
    assert.equal(preview.attempt, null);
    assert.equal((await readCollection(testEnv, "semester_assessment_attempts")).length, writesBeforePreview);

    await expectReason(
      execute(outsider, "startAssessmentAttempt", {
        definitionId: definitions[0].definitionId,
      }),
      "ASSESSMENT_CLASS_NOT_ASSIGNED",
    );

    const quizStartId = randomUUID();
    const quizStartPayload = {
      definitionId: definitions[0].definitionId,
    };
    const [quizStart, quizReplay] = await Promise.all([
      execute(student, "startAssessmentAttempt", quizStartPayload, { commandId: quizStartId }),
      execute(student, "startAssessmentAttempt", quizStartPayload, { commandId: quizStartId }),
    ]);
    assert.equal(quizStart.data.result.attemptId, quizReplay.data.result.attemptId);
    const quizAttempt = quizStart.data.result;

    // A01: the request crosses session expiry after server authorization.
    const beforeDelayedSave = await readDocument(
      testEnv,
      `semester_assessment_attempts/${quizAttempt.attemptId}`,
    );
    const a01SignalId = `a01-${randomUUID()}`;
    const delayedSavePromise = queryCallable(student, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: quizAttempt.revision,
        answers: { 1: "정답", 2: "오답" },
        currentItemId: "2",
        saveId: "w6a-a01-delayed-save",
        _testDelayAfterSessionMs: 1_200,
        _testAuthorizedSignalId: a01SignalId,
      });
    const a01Signal = await waitForDocument(
      testEnv,
      `__w6a_test_signals/${a01SignalId}`,
    );
    assert.equal(a01Signal.state, "AUTHORIZED");
    await expireApplicationSession(testEnv, student);
    const delayedSave = (await delayedSavePromise).data;
    assert.equal(delayedSave.revision, beforeDelayedSave.revision + 1);
    const afterDelayedSave = await readDocument(
      testEnv,
      `semester_assessment_attempts/${quizAttempt.attemptId}`,
    );
    assert.equal(afterDelayedSave.lastSaveId, "w6a-a01-delayed-save");

    // A02: save and session expiration race; accept exactly one write or a clear denial.
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    const beforeA02 = await readDocument(
      testEnv,
      `semester_assessment_attempts/${quizAttempt.attemptId}`,
    );
    const [a02SaveOutcome] = await Promise.allSettled([
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: beforeA02.revision,
        answers: { 1: "정답", 2: "오답" },
        currentItemId: "2",
        saveId: "w6a-a02-session-race",
      }),
      expireApplicationSession(testEnv, student),
    ]);
    const afterA02Race = await readDocument(
      testEnv,
      `semester_assessment_attempts/${quizAttempt.attemptId}`,
    );
    let a02Revision = beforeA02.revision;
    if (a02SaveOutcome.status === "fulfilled") {
      a02Revision = a02SaveOutcome.value.data.revision;
      assert.equal(a02Revision, beforeA02.revision + 1);
      assert.equal(afterA02Race.revision, a02Revision);
    } else {
      assert.equal(reason(a02SaveOutcome.reason), "SESSION_EXPIRED");
      assert.equal(afterA02Race.revision, beforeA02.revision);
    }
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    if (a02SaveOutcome.status === "rejected") {
      a02Revision = (
        await queryCallable(student, "saveAssessmentProgress", {
          attemptId: quizAttempt.attemptId,
          expectedRevision: beforeA02.revision,
          answers: { 1: "정답", 2: "오답" },
          currentItemId: "2",
          saveId: "w6a-a02-session-race-retry",
        })
      ).data.revision;
    }

    // A07: a stale tab cannot overwrite a newer revision.
    await expectReason(
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: a02Revision - 1,
        answers: { 1: "오답", 2: "오답" },
        currentItemId: "1",
        saveId: "w6a-a07-stale-save",
      }),
      "ASSESSMENT_ATTEMPT_REVISION_CONFLICT",
    );

    await signInWithEmailAndPassword(
      relogin.auth,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    relogin.user = relogin.auth.currentUser;
    await openSession(relogin);

    // Multi-tab CAS: exactly one distinct save at the same revision may commit.
    const multiTabSaves = await Promise.allSettled([
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: a02Revision,
        answers: { 1: "정답", 2: "오답" },
        currentItemId: "2",
        saveId: "w6a-multi-tab-a",
      }),
      queryCallable(relogin, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: a02Revision,
        answers: { 1: "정답", 2: "2" },
        currentItemId: "2",
        saveId: "w6a-multi-tab-b",
      }),
    ]);
    assert.equal(multiTabSaves.filter((item) => item.status === "fulfilled").length, 1);
    const rejectedMultiTabSave = multiTabSaves.find((item) => item.status === "rejected");
    assert.equal(reason(rejectedMultiTabSave?.reason), "ASSESSMENT_ATTEMPT_REVISION_CONFLICT");
    const multiTabState = (
      await queryCallable(student, "getAssessmentState", {
        attemptId: quizAttempt.attemptId,
      })
    ).data;
    assert.equal(multiTabState.attempt.revision, a02Revision + 1);

    // A08: another UID cannot read or mutate the attempt.
    await expectReason(
      queryCallable(outsider, "getAssessmentState", {
        attemptId: quizAttempt.attemptId,
      }),
      "ASSESSMENT_ATTEMPT_FORBIDDEN",
    );
    await expectReason(
      queryCallable(outsider, "saveAssessmentProgress", {
        attemptId: quizAttempt.attemptId,
        expectedRevision: multiTabState.attempt.revision,
        answers: { 1: "정답" },
        currentItemId: "1",
        saveId: "w6a-a08-other-uid",
      }),
      "ASSESSMENT_ATTEMPT_FORBIDDEN",
    );

    const submitId = randomUUID();
    const quizSubmitPayload = {
      attemptId: quizAttempt.attemptId,
      expectedRevision: multiTabState.attempt.revision,
      answers: multiTabState.attempt.answers,
      submitReason: "STUDENT",
    };
    // A04: commit succeeds while the response is lost; status recovers it.
    await expectReason(
      execute(
        student,
        "submitAssessmentAttempt",
        quizSubmitPayload,
        { commandId: submitId, dropResponse: true },
      ),
      "TEST_RESPONSE_LOSS",
    );
    const recovered = (
      await httpsCallable(student.functions, "getCommandStatus")({
        commandId: submitId,
        commandType: "submitAssessmentAttempt",
        _session: student.proof,
      })
    ).data;
    assert.equal(recovered.status, "SUCCEEDED");
    assert.ok([50, 100].includes(recovered.result.percent));
    assert.equal(recovered.result.reward.awarded, true);
    assert.ok(recovered.result.reward.totalAwarded > 0);
    const rewardStateBeforeReplay = {
      ledger: await readCollection(testEnv, wis.WIS_LEDGER_COLLECTION),
      account: await readDocument(testEnv, `${wis.WIS_ACCOUNT_COLLECTION}/${wis.accountIdFor("2026-2", student.user.uid)}`),
    };
    assert.equal(rewardStateBeforeReplay.account.balance, recovered.result.reward.totalAwarded);
    assert.equal(rewardStateBeforeReplay.ledger.length, recovered.result.reward.ledgerEntryIds.length);

    // A06: retrying the same submit command returns the existing result.
    const retriedSubmit = (
      await execute(student, "submitAssessmentAttempt", quizSubmitPayload, {
        commandId: submitId,
      })
    ).data.result;
    assert.equal(retriedSubmit.resultRef, recovered.result.resultRef);
    assert.deepEqual(retriedSubmit.reward, recovered.result.reward);
    assert.deepEqual({
      ledger: await readCollection(testEnv, wis.WIS_LEDGER_COLLECTION),
      account: await readDocument(testEnv, `${wis.WIS_ACCOUNT_COLLECTION}/${wis.accountIdFor("2026-2", student.user.uid)}`),
    }, rewardStateBeforeReplay);

    // A05: a fresh app instance for the same UID recovers the canonical attempt.
    const recoveredState = (
      await queryCallable(relogin, "getAssessmentState", {
        definitionId: definitions[0].definitionId,
      })
    ).data;
    assert.equal(recoveredState.attempt.attemptId, quizAttempt.attemptId);
    assert.equal(recoveredState.attempt.status, "SUBMITTED");

    const historyStart = (
      await execute(student, "startAssessmentAttempt", {
        definitionId: definitions[1].definitionId,
      })
    ).data.result;
    const historySaved = (
      await queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyStart.attemptId,
        expectedRevision: historyStart.revision,
        answers: { "blank-1": "고려", "blank-2": "오답" },
        currentItemId: "2",
        saveId: "w6a-integration-save-history",
      })
    ).data;
    const historySubmitId = randomUUID();
    const historySubmitPayload = {
        attemptId: historyStart.attemptId,
        expectedRevision: historySaved.revision,
        answers: { "blank-1": "고려", "blank-2": "오답" },
        submitReason: "STUDENT",
      };
    const historySubmissionsBeforeRace = (
      await readCollection(testEnv, "semester_assessment_submissions")
    ).length;
    // A03: submit and session expiration race; either one commit or a clear denial.
    const [historySubmitOutcome] = await Promise.allSettled([
      execute(student, "submitAssessmentAttempt", historySubmitPayload, {
        commandId: historySubmitId,
      }),
      expireApplicationSession(testEnv, student),
    ]);
    let historySubmitResult;
    if (historySubmitOutcome.status === "fulfilled") {
      historySubmitResult = historySubmitOutcome.value.data.result;
      assert.equal(
        (await readCollection(testEnv, "semester_assessment_submissions")).length,
        historySubmissionsBeforeRace + 1,
      );
    } else {
      assert.equal(reason(historySubmitOutcome.reason), "SESSION_EXPIRED");
      assert.equal(
        (await readCollection(testEnv, "semester_assessment_submissions")).length,
        historySubmissionsBeforeRace,
      );
    }
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    if (!historySubmitResult) {
      historySubmitResult = (
        await execute(student, "submitAssessmentAttempt", historySubmitPayload, {
          commandId: historySubmitId,
        })
      ).data.result;
    }
    const historyReplay = (
      await execute(student, "submitAssessmentAttempt", historySubmitPayload, {
        commandId: historySubmitId,
      })
    ).data.result;
    assert.equal(historySubmitResult.resultRef, historyReplay.resultRef);
    await expectReason(
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyStart.attemptId,
        expectedRevision: historySaved.revision,
        answers: historySubmitPayload.answers,
        currentItemId: "2",
        saveId: "w6a-post-submit-save",
      }),
      "ASSESSMENT_ATTEMPT_NOT_WRITABLE",
    );

    // Complete A01-A08 for History Classroom with a second canonical attempt.
    const historyRecoveryAttempt = (
      await execute(student, "startAssessmentAttempt", {
        definitionId: definitions[1].definitionId,
      })
    ).data.result;
    const historyA01SignalId = `history-a01-${randomUUID()}`;
    const historyA01Promise = queryCallable(student, "saveAssessmentProgress", {
      attemptId: historyRecoveryAttempt.attemptId,
      expectedRevision: historyRecoveryAttempt.revision,
      answers: { "blank-1": "고려", "blank-2": "조선" },
      currentItemId: "2",
      saveId: "w6a-history-a01",
      _testDelayAfterSessionMs: 1_200,
      _testAuthorizedSignalId: historyA01SignalId,
    });
    await waitForDocument(
      testEnv,
      `__w6a_test_signals/${historyA01SignalId}`,
    );
    await expireApplicationSession(testEnv, student);
    const historyA01 = (await historyA01Promise).data;
    assert.equal(historyA01.revision, historyRecoveryAttempt.revision + 1);
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    await reopenExpiredStudentSession(
      relogin,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );

    const historyMultiTab = await Promise.allSettled([
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyA01.revision,
        answers: { "blank-1": "고려", "blank-2": "조선" },
        currentItemId: "1",
        saveId: "w6a-history-multitab-a",
      }),
      queryCallable(relogin, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyA01.revision,
        answers: { "blank-1": "고려", "blank-2": "오답" },
        currentItemId: "2",
        saveId: "w6a-history-multitab-b",
      }),
    ]);
    assert.equal(historyMultiTab.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(
      reason(historyMultiTab.find((item) => item.status === "rejected")?.reason),
      "ASSESSMENT_ATTEMPT_REVISION_CONFLICT",
    );
    const historyAfterMultiTab = (
      await queryCallable(student, "getAssessmentState", {
        attemptId: historyRecoveryAttempt.attemptId,
      })
    ).data.attempt;

    const historyA04SaveId = "w6a-history-a04-save-response-loss";
    await expectReason(
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyAfterMultiTab.revision,
        answers: { "blank-1": "고려", "blank-2": "조선" },
        currentItemId: "2",
        saveId: historyA04SaveId,
        _testDropResponseAfterCommit: true,
      }),
      "TEST_RESPONSE_LOSS",
    );
    const historyA04Recovered = (
      await queryCallable(student, "getAssessmentState", {
        attemptId: historyRecoveryAttempt.attemptId,
      })
    ).data.attempt;
    assert.equal(historyA04Recovered.revision, historyAfterMultiTab.revision + 1);
    const historyA04Replay = (
      await queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyAfterMultiTab.revision,
        answers: { "blank-1": "고려", "blank-2": "조선" },
        currentItemId: "2",
        saveId: historyA04SaveId,
      })
    ).data;
    assert.equal(historyA04Replay.replayed, true);
    assert.equal(historyA04Replay.revision, historyA04Recovered.revision);

    const historyBeforeA02 = historyA04Recovered;
    const [historyA02Outcome] = await Promise.allSettled([
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyBeforeA02.revision,
        answers: { "blank-1": "고려", "blank-2": "조선" },
        currentItemId: "2",
        saveId: "w6a-history-a02",
      }),
      expireApplicationSession(testEnv, student),
    ]);
    const historyAfterA02Race = (
      await readDocument(
        testEnv,
        `semester_assessment_attempts/${historyRecoveryAttempt.attemptId}`,
      )
    );
    let historyCurrentRevision = historyBeforeA02.revision;
    if (historyA02Outcome.status === "fulfilled") {
      historyCurrentRevision = historyA02Outcome.value.data.revision;
      assert.equal(historyAfterA02Race.revision, historyCurrentRevision);
    } else {
      assert.equal(reason(historyA02Outcome.reason), "SESSION_EXPIRED");
      assert.equal(historyAfterA02Race.revision, historyBeforeA02.revision);
    }
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    if (historyA02Outcome.status === "rejected") {
      historyCurrentRevision = (
        await queryCallable(student, "saveAssessmentProgress", {
          attemptId: historyRecoveryAttempt.attemptId,
          expectedRevision: historyBeforeA02.revision,
          answers: { "blank-1": "고려", "blank-2": "조선" },
          currentItemId: "2",
          saveId: "w6a-history-a02-retry",
        })
      ).data.revision;
    }
    await expectReason(
      queryCallable(student, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyCurrentRevision - 1,
        answers: { "blank-1": "오답", "blank-2": "오답" },
        currentItemId: "1",
        saveId: "w6a-history-a07",
      }),
      "ASSESSMENT_ATTEMPT_REVISION_CONFLICT",
    );
    await expectReason(
      queryCallable(outsider, "getAssessmentState", {
        attemptId: historyRecoveryAttempt.attemptId,
      }),
      "ASSESSMENT_ATTEMPT_FORBIDDEN",
    );
    await expectReason(
      queryCallable(outsider, "saveAssessmentProgress", {
        attemptId: historyRecoveryAttempt.attemptId,
        expectedRevision: historyCurrentRevision,
        answers: { "blank-1": "고려" },
        currentItemId: "1",
        saveId: "w6a-history-a08",
      }),
      "ASSESSMENT_ATTEMPT_FORBIDDEN",
    );
    const historyRecoverySubmitId = randomUUID();
    const historyRecoverySubmitPayload = {
      attemptId: historyRecoveryAttempt.attemptId,
      expectedRevision: historyCurrentRevision,
      answers: { "blank-1": "고려", "blank-2": "조선" },
      submitReason: "STUDENT",
    };
    await expectReason(
      execute(student, "submitAssessmentAttempt", historyRecoverySubmitPayload, {
        commandId: historyRecoverySubmitId,
        dropResponse: true,
      }),
      "TEST_RESPONSE_LOSS",
    );
    const historyRecoveryStatus = (
      await httpsCallable(student.functions, "getCommandStatus")({
        commandId: historyRecoverySubmitId,
        commandType: "submitAssessmentAttempt",
        _session: student.proof,
      })
    ).data;
    assert.equal(historyRecoveryStatus.status, "SUCCEEDED");
    const historyRecoveryReplay = (
      await execute(relogin, "submitAssessmentAttempt", historyRecoverySubmitPayload, {
        commandId: historyRecoverySubmitId,
      })
    ).data.result;
    assert.equal(historyRecoveryReplay.resultRef, historyRecoveryStatus.result.resultRef);
    const historyReloginState = (
      await queryCallable(relogin, "getAssessmentState", {
        definitionId: definitions[1].definitionId,
      })
    ).data;
    assert.equal(historyReloginState.attempt.attemptId, historyRecoveryAttempt.attemptId);
    assert.equal(historyReloginState.attempt.deadlineAtIso, historyRecoveryAttempt.deadlineAtIso);

    // Complete A03 for Quiz with its second allowed attempt.
    const quizExpiryAttempt = (
      await execute(student, "startAssessmentAttempt", {
        definitionId: definitions[0].definitionId,
      })
    ).data.result;
    const quizExpirySaved = (
      await queryCallable(student, "saveAssessmentProgress", {
        attemptId: quizExpiryAttempt.attemptId,
        expectedRevision: quizExpiryAttempt.revision,
        answers: { 1: "정답", 2: "2" },
        currentItemId: "2",
        saveId: "w6a-quiz-a03-save",
      })
    ).data;
    const quizExpirySubmitId = randomUUID();
    const quizExpirySubmitPayload = {
      attemptId: quizExpiryAttempt.attemptId,
      expectedRevision: quizExpirySaved.revision,
      answers: { 1: "정답", 2: "2" },
      submitReason: "STUDENT",
    };
    const quizSubmissionsBeforeExpiryRace = (
      await readCollection(testEnv, "semester_assessment_submissions")
    ).length;
    const [quizExpirySubmitOutcome] = await Promise.allSettled([
      execute(student, "submitAssessmentAttempt", quizExpirySubmitPayload, {
        commandId: quizExpirySubmitId,
      }),
      expireApplicationSession(testEnv, student),
    ]);
    if (quizExpirySubmitOutcome.status === "rejected") {
      assert.equal(reason(quizExpirySubmitOutcome.reason), "SESSION_EXPIRED");
      assert.equal(
        (await readCollection(testEnv, "semester_assessment_submissions")).length,
        quizSubmissionsBeforeExpiryRace,
      );
    } else {
      assert.equal(
        (await readCollection(testEnv, "semester_assessment_submissions")).length,
        quizSubmissionsBeforeExpiryRace + 1,
      );
    }
    await reopenExpiredStudentSession(
      student,
      "w6a-student@yongshin-ms.ms.kr",
      studentPassword,
    );
    const quizExpiryReplay = (
      await execute(student, "submitAssessmentAttempt", quizExpirySubmitPayload, {
        commandId: quizExpirySubmitId,
      })
    ).data.result;
    assert.ok(quizExpiryReplay.resultRef);

    const [attempts, submissions, results, receipts, audits] = await Promise.all([
      readCollection(testEnv, "semester_assessment_attempts"),
      readCollection(testEnv, "semester_assessment_submissions"),
      readCollection(testEnv, "semester_assessment_results"),
      withAdminDb(testEnv, async (db) => {
        const snapshot = await getDocs(query(collection(db, "command_receipts"), where("commandId", "==", submitId)));
        return snapshot.docs;
      }),
      withAdminDb(testEnv, async (db) => {
        const snapshot = await getDocs(query(collection(db, "command_audit_events"), where("commandId", "==", submitId)));
        return snapshot.docs;
      }),
    ]);
    assert.equal(attempts.length, 4);
    assert.equal(submissions.length, 4);
    assert.equal(results.length, 4);
    assert.equal(receipts.length, 1);
    assert.equal(audits.length, 1);
    await expectReason(
      getDoc(doc(student.db, "semester_assessment_results", quizAttempt.attemptId)),
      "permission-denied",
    );

    console.log(JSON.stringify({
      suite: "w6a-assessment-integration",
      passed: true,
      cases: [
        "QUIZ_AND_HISTORY_DEFINITION_PUBLISH",
        "TEACHER_CONTENT_COMMAND_GATEWAY_CAS",
        "LEGACY_CONFIG_PROJECTION_ATOMIC_WITH_DEFINITION",
        "PREFLIGHT_QUERY_ZERO_WRITE",
        "INVALID_LINK_AND_MISSING_QUERY_ZERO_DOMAIN_WRITE",
        "UNAUTHORIZED_TEACHER_PRE_BUSINESS_DENIAL",
        "INELIGIBLE_STUDENT_PREFLIGHT_PERMISSION_STATE",
        "CANONICAL_CLASS_AND_ENROLLMENT_FENCE",
        "CONCURRENT_START_EFFECT_ONCE",
        "A01_DELAYED_SAVE_CROSSES_SESSION_EXPIRY_EXACTLY_ONCE_BOTH_KINDS",
        "A02_SAVE_SESSION_EXPIRY_RACE_SAFE_OUTCOME_BOTH_KINDS",
        "A03_SUBMIT_SESSION_EXPIRY_RACE_SAFE_OUTCOME_BOTH_KINDS",
        "A04_COMMIT_RESPONSE_LOSS_STATUS_RECOVERY_BOTH_KINDS",
        "A05_SAME_UID_RELOGIN_RECOVERY_BOTH_KINDS",
        "A06_SAME_SUBMIT_COMMAND_RETRY_EFFECT_ONCE_BOTH_KINDS",
        "A07_STALE_REVISION_REJECTED_BOTH_KINDS",
        "A08_OTHER_UID_READ_WRITE_DENIED_BOTH_KINDS",
        "MULTI_TAB_PROGRESS_CAS_EXACTLY_ONE_COMMIT_BOTH_KINDS",
        "RESPONSE_LOSS_RECEIPT_RECOVERY",
        "ATOMIC_IMMUTABLE_SUBMISSION_RESULT",
        "CONCURRENT_SUBMIT_EFFECT_ONCE",
        "DIRECT_RESULT_READ_DENIED",
      ],
      counts: { attempts: attempts.length, submissions: submissions.length, results: results.length },
      productionAccess: 0,
    }));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
