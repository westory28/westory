import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w8";
assert.equal(projectId, "demo-westory-session-w8");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) {
  assert.ok(process.env[variable], `${variable} is required.`);
}

const semesterId = "2026-2";
const archiveSemesterId = "2026-1";
const region = "asia-northeast3";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];
const config = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};
const password = () => `${randomBytes(24).toString("base64url")}Aa1!`;
const common = { semesterId, expectedSemesterRevision: 1 };
const W8_COMMAND_TYPES = new Set([
  "createLearningContent",
  "updateLearningContent",
  "transitionLearningContent",
  "recordLearningProgress",
  "requestLearningExemption",
  "resetLearningProgress",
  "grantLearningExemptions",
  "revokeLearningExemptions",
  "reviewLearningExemptionRequest",
  "createScheduleEvent",
  "updateScheduleEvent",
  "deleteScheduleEvent",
  "createAttendanceSession",
  "recordAttendance",
  "recordAttendanceBulk",
  "correctAttendanceRecord",
  "closeAttendanceSession",
  "createNotice",
  "updateNotice",
  "transitionNotice",
  "acknowledgeNotice",
  "acknowledgeAllNotices",
  "updateNotificationSettings",
]);
const canonicalCollections = [
  "semester_learning_contents",
  "semester_learning_progress",
  "semester_learning_exemptions",
  "semester_learning_exemption_requests",
  "semester_schedule_events",
  "semester_attendance_sessions",
  "semester_attendance_records",
  "semester_attendance_revisions",
  "semester_notices",
  "semester_notice_deliveries",
  "semester_notice_acknowledgements",
  "w8_legacy_issues",
];

const makeClient = (name) => {
  const app = initializeApp(config, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, db, functions, proof: null, user: null };
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
};
const execute = (client, commandType, payload, options = {}) =>
  httpsCallable(client.functions, "executeCommand")({
    commandId: options.commandId || randomUUID(),
    commandType,
    payload,
    _session: client.proof,
    ...(options.dropResponse ? { _testDropResponseAfterCommit: true } : {}),
  });
const queryW8 = (client, payload) =>
  httpsCallable(client.functions, "getW8DomainState")({
    ...payload,
    _session: client.proof,
  });
const reason = (error) =>
  String(
    error?.details?.reason ||
      error?.customData?.details?.reason ||
      error?.code ||
      error?.message,
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
const businessCounts = async (testEnv) =>
  Object.fromEntries(
    await Promise.all(
      canonicalCollections.map(async (name) => [name, (await readCollection(testEnv, name)).length]),
    ),
  );
const recoverResponseLoss = async (client, commandType, payload) => {
  const commandId = randomUUID();
  await expectReason(
    execute(client, commandType, payload, { commandId, dropResponse: true }),
    "TEST_RESPONSE_LOSS",
  );
  const status = (
    await httpsCallable(client.functions, "getCommandStatus")({
      commandId,
      commandType,
      _session: client.proof,
    })
  ).data;
  assert.equal(status.status, "SUCCEEDED");
  const replay = (await execute(client, commandType, payload, { commandId })).data;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, status.result);
  return status.result;
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  const admin = makeClient("w8-admin");
  const teacher = makeClient("w8-teacher");
  const student = makeClient("w8-student");
  const peer = makeClient("w8-peer");
  try {
    await testEnv.clearFirestore();
    admin.user = (
      await createUserWithEmailAndPassword(admin.auth, "westoria28@gmail.com", password())
    ).user;
    teacher.user = (
      await createUserWithEmailAndPassword(
        teacher.auth,
        "w8-teacher@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    student.user = (
      await createUserWithEmailAndPassword(
        student.auth,
        "w8-student@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    peer.user = (
      await createUserWithEmailAndPassword(
        peer.auth,
        "w8-peer@yongshin-ms.ms.kr",
        password(),
      )
    ).user;
    const classId = "w8-class";
    const enrollmentId = "w8-enrollment";
    const peerEnrollmentId = "w8-peer-enrollment";
    await withAdminDb(testEnv, async (db) => {
      await Promise.all([
        setDoc(doc(db, "users", admin.user.uid), { role: "admin" }),
        setDoc(doc(db, "users", teacher.user.uid), {
          role: "teacher",
          teacherPortalEnabled: true,
          staffPermissions: ["lesson_read"],
        }),
        setDoc(doc(db, "users", student.user.uid), { role: "student" }),
        setDoc(doc(db, "users", peer.user.uid), { role: "student" }),
        setDoc(doc(db, "site_settings", "semester_active"), {
          semesterId,
          activeSemesterId: semesterId,
          revision: 1,
          activeSemesterRevision: 1,
        }),
        setDoc(doc(db, "site_settings", "config"), {
          year: 2026,
          semester: 2,
          activeSemesterId: semesterId,
          activeSemesterRevision: 1,
          semesterWritesEnabled: true,
        }),
        setDoc(doc(db, "semester_manifests", semesterId), {
          semesterId,
          schoolYear: 2026,
          term: 2,
          revision: 1,
          status: "ACTIVE",
          shellState: "CURRENT",
          startAt: "2026-08-01",
          endAt: "2026-12-31",
        }),
        setDoc(doc(db, "semester_manifests", archiveSemesterId), {
          semesterId: archiveSemesterId,
          schoolYear: 2026,
          term: 1,
          revision: 4,
          status: "ARCHIVED",
          shellState: "ARCHIVE",
          startAt: "2026-03-01",
          endAt: "2026-07-31",
        }),
        setDoc(doc(db, "semester_classes", classId), {
          classId,
          semesterId,
          status: "ACTIVE",
        }),
        setDoc(doc(db, "semester_enrollments", enrollmentId), {
          enrollmentId,
          semesterId,
          studentUid: student.user.uid,
          classId,
          enrollmentStatus: "ACTIVE",
          studentNumber: "1",
          snapshot: { displayName: "합성 학생", studentNumber: "1" },
        }),
        setDoc(doc(db, "semester_enrollments", peerEnrollmentId), {
          enrollmentId: peerEnrollmentId,
          semesterId,
          studentUid: peer.user.uid,
          classId,
          enrollmentStatus: "ACTIVE",
          studentNumber: "2",
          snapshot: { displayName: "합성 학생 2", studentNumber: "2" },
        }),
      ]);
    });
    await Promise.all([openSession(admin), openSession(teacher), openSession(student), openSession(peer)]);

    const beforeForbidden = await businessCounts(testEnv);
    await expectReason(
      queryW8(student, {
        domain: "LEARNING",
        audience: "teacher",
        semesterId,
        source: "CURRENT",
      }),
      "W8_MANAGE_REQUIRED",
    );
    await expectReason(
      execute(student, "createLearningContent", {
        ...common,
        title: "차단",
        summary: "차단",
        body: "차단",
        resourceUrl: "",
        contentType: "LESSON",
        audienceRoles: ["student"],
        targetClassIds: [classId],
        availableFrom: "",
        availableUntil: "",
      }),
      "W8_MANAGE_REQUIRED",
    );
    assert.deepEqual(await businessCounts(testEnv), beforeForbidden);

    const configResult = await recoverResponseLoss(admin, "updateNotificationSettings", {
      ...common,
      expectedConfigRevision: null,
      enabled: true,
      studentNotificationsEnabled: true,
      teacherNotificationsEnabled: true,
      eventPolicies: { acknowledgementMode: "EXPLICIT" },
    });
    assert.equal(configResult.configRevision, 1);

    const learningInput = {
      ...common,
      title: "W8 학습 자료",
      summary: "명시적 완료를 검증합니다.",
      body: "학습 내용을 확인한 뒤 완료 버튼을 선택합니다.",
      resourceUrl: "",
      contentType: "LESSON",
      audienceRoles: ["student"],
      targetClassIds: [classId],
      availableFrom: "2026-08-01T00:00:00.000Z",
      availableUntil: "2026-12-31T23:59:59.000Z",
    };
    const createdContent = (await execute(teacher, "createLearningContent", learningInput)).data.result;
    const contentId = createdContent.contentId;
    const updatedContent = (
      await execute(teacher, "updateLearningContent", {
        ...learningInput,
        contentId,
        expectedContentRevision: 1,
        title: "W8 학습 자료 수정",
      })
    ).data.result;
    assert.equal(updatedContent.contentRevision, 2);
    await execute(teacher, "transitionLearningContent", {
      ...common,
      contentId,
      expectedContentRevision: 2,
      targetStatus: "READY",
      reason: "공개 준비",
    });
    const published = (
      await execute(teacher, "transitionLearningContent", {
        ...common,
        contentId,
        expectedContentRevision: 3,
        targetStatus: "PUBLISHED",
        reason: "학생 공개",
      })
    ).data.result;
    assert.equal(published.contentRevision, 4);

    const beforeLearningQuery = await businessCounts(testEnv);
    const learningState = (
      await queryW8(student, {
        domain: "LEARNING",
        audience: "student",
        semesterId,
        source: "CURRENT",
      })
    ).data;
    assert.equal(learningState.writeCount, 0);
    assert.equal(learningState.contents.length, 1);
    assert.deepEqual(await businessCounts(testEnv), beforeLearningQuery);

    const started = (
      await execute(student, "recordLearningProgress", {
        ...common,
        contentId,
        expectedContentRevision: 4,
        enrollmentId,
        expectedProgressRevision: null,
        event: "START",
      })
    ).data.result;
    assert.equal(started.status, "IN_PROGRESS");
    const completeCommandId = randomUUID();
    const completePayload = {
      ...common,
      contentId,
      expectedContentRevision: 4,
      enrollmentId,
      expectedProgressRevision: 1,
      event: "COMPLETE",
    };
    const completion = await Promise.all([
      execute(student, "recordLearningProgress", completePayload, {
        commandId: completeCommandId,
      }),
      execute(student, "recordLearningProgress", completePayload, {
        commandId: completeCommandId,
      }),
    ]);
    assert.equal(completion[0].data.result.status, "COMPLETED");
    assert.equal(completion[1].data.result.status, "COMPLETED");
    await execute(teacher, "resetLearningProgress", {
      ...common,
      studentUid: student.user.uid,
      enrollmentId,
      entries: [{ contentId, expectedProgressRevision: 2 }],
      reason: "명시적 초기화",
    });

    await expectReason(
      execute(student, "requestLearningExemption", {
        ...common,
        contentId,
        expectedContentRevision: 4,
        enrollmentId: peerEnrollmentId,
        reason: "다른 학생 학적 요청 차단",
      }),
      "W8_ENROLLMENT_INVALID",
    );

    const granted = (
      await execute(teacher, "grantLearningExemptions", {
        ...common,
        contentId,
        expectedContentRevision: 4,
        enrollmentIds: [peerEnrollmentId],
        reason: "개별 면제",
      })
    ).data.result;
    const exemptionId = granted.exemptionIds[0];
    await execute(teacher, "revokeLearningExemptions", {
      ...common,
      items: [{ exemptionId, expectedExemptionRevision: 1 }],
      reason: "면제 철회",
    });
    const requested = await recoverResponseLoss(
      peer,
      "requestLearningExemption",
      {
        ...common,
        contentId,
        expectedContentRevision: 4,
        enrollmentId: peerEnrollmentId,
        reason: "학습 면제 요청",
      },
    );
    const requestId = requested.requestId;
    assert.equal(requested.status, "PENDING");
    const reviewed = (
      await execute(teacher, "reviewLearningExemptionRequest", {
        ...common,
        requestId,
        expectedRequestRevision: 1,
        action: "APPROVE",
        reason: "요청 승인",
      })
    ).data.result;
    assert.equal(reviewed.status, "APPROVED");
    await expectReason(
      httpsCallable(peer.functions, "createHistoryClassroomExemptionRequest")({
        _session: peer.proof,
      }),
      "CLIENT_UPDATE_REQUIRED",
    );

    const scheduleInput = {
      ...common,
      eventType: "CLASS",
      title: "W8 수업 일정",
      description: "출석 연결 일정",
      startAt: "2026-08-12T00:00:00.000Z",
      endAt: "2026-08-12T01:00:00.000Z",
      allDay: false,
      period: "1",
      targetClassIds: [classId],
      targetUserIds: [],
      sourceDomain: "USER",
      sourceReference: "w8-integration-class-1",
    };
    const event = await recoverResponseLoss(teacher, "createScheduleEvent", scheduleInput);
    const eventId = event.eventId;
    const updatedEvent = (
      await execute(teacher, "updateScheduleEvent", {
        ...scheduleInput,
        eventId,
        expectedEventRevision: 1,
        title: "W8 수업 일정 수정",
      })
    ).data.result;
    assert.equal(updatedEvent.eventRevision, 2);
    const attendanceSession = (
      await execute(teacher, "createAttendanceSession", {
        ...common,
        classId,
        date: "2026-08-12",
        period: "1",
        sourceEventId: eventId,
        expectedSourceEventRevision: 2,
      })
    ).data.result;
    const sessionId = attendanceSession.sessionId;
    await execute(teacher, "deleteScheduleEvent", {
      ...common,
      eventId,
      expectedEventRevision: 2,
      reason: "명시적 일정 보관",
    });
    const firstRecord = (
      await execute(teacher, "recordAttendance", {
        ...common,
        sessionId,
        expectedSessionRevision: 1,
        studentUid: student.user.uid,
        enrollmentId,
        expectedRecordRevision: null,
        attendanceStatus: "PRESENT",
        reason: "",
      })
    ).data.result;
    const bulk = (
      await execute(teacher, "recordAttendanceBulk", {
        ...common,
        sessionId,
        expectedSessionRevision: 1,
        entries: [
          {
            studentUid: peer.user.uid,
            enrollmentId: peerEnrollmentId,
            expectedRecordRevision: null,
            attendanceStatus: "LATE",
            reason: "교통 지연",
          },
        ],
        reason: "학급 출석 입력",
      })
    ).data.result;
    assert.equal(bulk.recordedCount, 1);
    const correction = (
      await execute(teacher, "correctAttendanceRecord", {
        ...common,
        recordId: firstRecord.recordId,
        expectedRecordRevision: 1,
        attendanceStatus: "EXCUSED",
        reason: "공결 확인",
      })
    ).data.result;
    assert.equal(correction.recordRevision, 2);
    assert.equal((await readCollection(testEnv, "semester_attendance_revisions")).length, 1);
    const closedSession = (
      await execute(teacher, "closeAttendanceSession", {
        ...common,
        sessionId,
        expectedSessionRevision: 1,
      })
    ).data.result;
    assert.equal(closedSession.status, "CLOSED");
    const closedCorrection = (
      await execute(teacher, "correctAttendanceRecord", {
        ...common,
        recordId: firstRecord.recordId,
        expectedRecordRevision: 2,
        attendanceStatus: "PRESENT",
        reason: "종료 후 증빙 정정",
      })
    ).data.result;
    assert.equal(closedCorrection.recordRevision, 3);
    const revisionsAfterClose = await readCollection(
      testEnv,
      "semester_attendance_revisions",
    );
    assert.equal(revisionsAfterClose.length, 2);
    assert.equal(
      revisionsAfterClose.find(({ id }) => id === closedCorrection.revisionId)?.data
        ?.sessionStatusAtCorrection,
      "CLOSED",
    );

    const noticeInput = {
      ...common,
      title: "W8 중요 공지",
      content: "명시적으로 확인해 주세요.",
      targetRoles: ["student"],
      targetClassIds: [classId],
      targetUserIds: [],
      publishAt: "2026-08-12T00:00:00.000Z",
      expireAt: "2026-12-31T23:59:59.000Z",
      priority: "HIGH",
    };
    const notice = (await execute(teacher, "createNotice", noticeInput)).data.result;
    const noticeId = notice.noticeId;
    const updatedNotice = (
      await execute(teacher, "updateNotice", {
        ...noticeInput,
        noticeId,
        expectedNoticeRevision: 1,
        title: "W8 중요 공지 수정",
      })
    ).data.result;
    assert.equal(updatedNotice.noticeRevision, 2);
    const scheduledNotice = (
      await execute(teacher, "transitionNotice", {
        ...common,
        noticeId,
        expectedNoticeRevision: 2,
        targetStatus: "SCHEDULED",
      })
    ).data.result;
    assert.equal(scheduledNotice.deliveryCount, 2);
    await expectReason(
      execute(teacher, "updateNotice", {
        ...noticeInput,
        noticeId,
        expectedNoticeRevision: 3,
        title: "예약 후 대상 변경 차단",
      }),
      "W8_NOTICE_STATE_INVALID",
    );
    const publishedNotice = (
      await execute(teacher, "transitionNotice", {
        ...common,
        noticeId,
        expectedNoticeRevision: 3,
        targetStatus: "PUBLISHED",
      })
    ).data.result;
    assert.equal(publishedNotice.noticeRevision, 4);
    assert.equal(publishedNotice.deliveryCount, 0);
    const persistedDeliveries = await readCollection(
      testEnv,
      "semester_notice_deliveries",
    );
    assert.equal(persistedDeliveries.length, 2);

    const beforeNoticeQueries = await businessCounts(testEnv);
    const noticeState = (
      await queryW8(student, {
        domain: "COMMUNICATION",
        audience: "student",
        semesterId,
        source: "CURRENT",
        noticeId,
      })
    ).data;
    assert.equal(noticeState.writeCount, 0);
    assert.equal(noticeState.notices.length, 1);
    assert.equal(noticeState.acknowledgements.length, 0);
    assert.deepEqual(await businessCounts(testEnv), beforeNoticeQueries);

    const acknowledgeId = randomUUID();
    const acknowledgementPayload = {
      ...common,
      noticeId,
      expectedNoticeRevision: 4,
    };
    const [ackA, ackB] = await Promise.all([
      execute(student, "acknowledgeNotice", acknowledgementPayload, {
        commandId: acknowledgeId,
      }),
      execute(student, "acknowledgeNotice", acknowledgementPayload, {
        commandId: acknowledgeId,
      }),
    ]);
    assert.equal(ackA.data.result.acknowledged, true);
    assert.equal(ackB.data.result.acknowledged, true);
    assert.equal(
      (await readCollection(testEnv, "semester_notice_acknowledgements")).filter(
        ({ data }) => data.studentUid === student.user.uid,
      ).length,
      1,
    );
    const allAcknowledged = (
      await execute(peer, "acknowledgeAllNotices", {
        ...common,
        notices: [{ noticeId, expectedNoticeRevision: 4 }],
      })
    ).data.result;
    assert.equal(allAcknowledged.acknowledgedCount, 1);

    const queryCounts = await businessCounts(testEnv);
    for (const domain of [
      "LEARNING",
      "SCHEDULE",
      "ATTENDANCE",
      "COMMUNICATION",
      "DASHBOARD",
    ]) {
      const state = (
        await queryW8(student, {
          domain,
          audience: "student",
          semesterId,
          source: "CURRENT",
        })
      ).data;
      assert.equal(state.writeCount, 0);
    }
    assert.deepEqual(await businessCounts(testEnv), queryCounts);

    await expectReason(
      queryW8(student, {
        domain: "ATTENDANCE",
        audience: "student",
        semesterId,
        source: "CURRENT",
        studentUid: peer.user.uid,
      }),
      "W8_STUDENT_SCOPE_FORBIDDEN",
    );
    const legacy = (
      await queryW8(student, {
        domain: "LEARNING",
        audience: "student",
        semesterId,
        source: "LEGACY",
      })
    ).data;
    assert.equal(legacy.writeCount, 0);
    assert.equal(legacy.readOnly, true);
    assert.equal(legacy.provenance, "LEGACY");
    assert.equal(legacy.contents.length, 0);
    const archive = (
      await queryW8(teacher, {
        domain: "DASHBOARD",
        audience: "teacher",
        semesterId: archiveSemesterId,
        source: "ARCHIVE",
      })
    ).data;
    assert.equal(archive.writeCount, 0);
    assert.equal(archive.readOnly, true);
    assert.equal(archive.provenance, "ARCHIVE");
    const beforeArchiveWrite = await businessCounts(testEnv);
    await expectReason(
      execute(teacher, "createScheduleEvent", {
        ...scheduleInput,
        semesterId: archiveSemesterId,
        expectedSemesterRevision: 4,
        sourceReference: "archive-write-denied",
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );
    await expectReason(
      execute(student, "requestLearningExemption", {
        semesterId: archiveSemesterId,
        expectedSemesterRevision: 4,
        contentId,
        expectedContentRevision: 4,
        enrollmentId,
        reason: "Archive 요청 차단",
      }),
      "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
    );
    assert.deepEqual(await businessCounts(testEnv), beforeArchiveWrite);

    const receipts = (await readCollection(testEnv, "command_receipts")).filter(
      ({ data }) => W8_COMMAND_TYPES.has(data.commandType) && data.status === "SUCCEEDED",
    );
    const audits = (await readCollection(testEnv, "command_audit_events")).filter(
      ({ data }) => W8_COMMAND_TYPES.has(data.commandType),
    );
    assert.deepEqual(new Set(receipts.map(({ data }) => data.commandType)), W8_COMMAND_TYPES);
    assert.equal(receipts.length, audits.length);
    console.log(
      JSON.stringify({
        suite: "w8-domain-integration",
        passed: true,
        commandTypes: W8_COMMAND_TYPES.size,
        queryDomains: 5,
        explicitReadEffectOnce: true,
        studentExemptionRequestExactlyOnce: true,
        previousBundleExemptionWriter: "fail-closed",
        bulkAttendancePartialSuccess: 0,
        archiveWrites: 0,
        legacySilentFallback: 0,
        queryWrites: 0,
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

await main();
