const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const w8 = require("../w8Domains");

const enrollmentSlotIdFor = (semesterId, studentUid) =>
  `slot_${createHash("sha256")
    .update(`${semesterId}\n${studentUid}`, "utf8")
    .digest("hex")
    .slice(0, 40)}`;

class MemoryTransaction {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
    this.writeStarted = false;
    this.readPaths = [];
    this.queryLog = [];
  }
  resetTransaction() {
    this.writeStarted = false;
    this.readPaths = [];
    this.queryLog = [];
  }
  seed(path, data) {
    this.documents.set(path, structuredClone(data));
  }
  assertReadable() {
    if (this.writeStarted) throw new Error("FIRESTORE_READ_AFTER_WRITE");
  }
  async get(path) {
    this.assertReadable();
    this.readPaths.push(path);
    return {
      exists: this.documents.has(path),
      data: this.documents.has(path)
        ? structuredClone(this.documents.get(path))
        : null,
      path,
    };
  }
  async getAll(paths) {
    this.assertReadable();
    this.readPaths.push(...paths);
    return paths.map((path) => ({
      exists: this.documents.has(path),
      data: this.documents.has(path)
        ? structuredClone(this.documents.get(path))
        : null,
      path,
    }));
  }
  async query(collection, filter = null) {
    this.assertReadable();
    this.queryLog.push({ collection, filter: structuredClone(filter) });
    const prefix = `${collection}/`;
    return [...this.documents.entries()]
      .filter(
        ([path]) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
      )
      .map(([path, data]) => ({
        exists: true,
        path,
        data: structuredClone(data),
      }))
      .filter(
        (row) =>
          !filter ||
          (filter.operator === "==" &&
            row.data?.[filter.field] === filter.value),
      );
  }
  set(path, data, options) {
    this.writeStarted = true;
    const current = this.documents.get(path) || {};
    this.documents.set(
      path,
      structuredClone(options?.merge ? { ...current, ...data } : data),
    );
  }
  create(path, data) {
    this.writeStarted = true;
    if (this.documents.has(path)) throw new Error(`already exists: ${path}`);
    this.documents.set(path, structuredClone(data));
  }
  delete(path) {
    this.writeStarted = true;
    this.documents.delete(path);
  }
}

const manifest = {
  semesterId: "2026-2",
  revision: 7,
  status: "ACTIVE",
  provenance: "CURRENT",
  startAt: "2026-08-01",
  endAt: "2026-12-31",
};
const semesterClass = {
  classId: "class-1",
  semesterId: "2026-2",
  status: "ACTIVE",
  grade: "3",
  classNumber: "1",
  homeroomTeacherUid: "teacher-1",
};
const enrollment = {
  enrollmentId: "enrollment-1",
  semesterId: "2026-2",
  studentUid: "student-1",
  classId: "class-1",
  studentNumber: "01",
  enrollmentStatus: "ACTIVE",
  snapshot: { displayName: "합성 학생", studentNumber: "01" },
};
const tx = new MemoryTransaction({
  "semester_manifests/2026-2": manifest,
  "semester_classes/class-1": semesterClass,
  "semester_classes/class-2": {
    classId: "class-2",
    semesterId: "2026-2",
    status: "ACTIVE",
    grade: "3",
    classNumber: "2",
    homeroomTeacherUid: "teacher-2",
  },
  "semester_enrollments/enrollment-1": enrollment,
  [`semester_enrollment_slots/${enrollmentSlotIdFor("2026-2", "student-1")}`]: {
    semesterId: "2026-2",
    studentUid: "student-1",
    activeEnrollmentId: "enrollment-1",
    revision: 1,
    status: "ACTIVE",
  },
  "users/teacher-1": {
    role: "teacher",
    teacherPortalEnabled: true,
    staffPermissions: ["lesson_read"],
  },
  "users/teacher-2": {
    role: "teacher",
    teacherPortalEnabled: false,
    staffPermissions: [],
  },
  "users/student-1": { role: "student" },
  "users/lesson-reader": {
    role: "student",
    teacherPortalEnabled: true,
    staffPermissions: ["lesson_read"],
  },
});
const teacher = {
  actorUid: "teacher-1",
  actorRole: "teacher",
  actorEmail: "teacher@yongshin-ms.ms.kr",
};
const teacher2 = {
  actorUid: "teacher-2",
  actorRole: "teacher",
  actorEmail: "teacher2@yongshin-ms.ms.kr",
};
const student = {
  actorUid: "student-1",
  actorRole: "student",
  actorEmail: "student@yongshin-ms.ms.kr",
};
const adapter = w8.createW8CommandAdapter({
  now: () => "2026-08-12T15:30:00.000Z",
});
let commandIndex = 0;
const apply = async (commandType, payload, actor = teacher) => {
  tx.resetTransaction();
  commandIndex += 1;
  return adapter.apply({
    transaction: tx,
    commandId: `command-${commandIndex}`,
    commandType,
    payload: w8.normalizeW8Payload(commandType, payload),
    receiptId: `receipt-${commandIndex}`,
    timestamp: `2026-08-12T00:${String(commandIndex).padStart(2, "0")}:00.000Z`,
    actor,
  });
};
const common = { semesterId: "2026-2", expectedSemesterRevision: 7 };
const learningEditable = {
  title: "대한민국 정부 수립",
  summary: "학습 요약",
  body: "자료를 읽고 핵심 내용을 정리합니다.",
  resourceUrl: "https://example.invalid/resource",
  contentType: "LESSON",
  audienceRoles: ["student"],
  targetClassIds: ["class-1"],
  availableFrom: "2026-08-01T00:00:00.000Z",
  availableUntil: "2026-12-31T23:59:59.000Z",
};
const noticeEditable = {
  title: "중요 공지",
  content: "학습 준비물을 확인해 주세요.",
  targetRoles: ["student"],
  targetClassIds: ["class-1"],
  targetUserIds: [],
  publishAt: "2026-08-01T00:00:00.000Z",
  expireAt: "2026-12-31T23:59:59.000Z",
  priority: "HIGH",
};

const run = async () => {
  assert.equal(Object.values(w8.W8_COMMAND_TYPES).length, 27);
  assert.equal(w8.STUDENT_COMMAND_TYPES.size, 5);

  const content = await apply("createLearningContent", {
    ...common,
    ...learningEditable,
  });
  assert.equal(content.result.status, "DRAFT");
  const contentId = content.result.contentId;
  assert.equal(
    tx.documents.get(`semester_learning_contents/${contentId}`).body,
    learningEditable.body,
  );
  const updatedContent = await apply("updateLearningContent", {
    ...common,
    contentId,
    expectedContentRevision: 1,
    ...learningEditable,
    summary: "수정한 요약",
  });
  assert.equal(updatedContent.result.contentRevision, 2);
  await assert.rejects(
    () =>
      apply("updateLearningContent", {
        ...common,
        contentId,
        expectedContentRevision: 1,
        ...learningEditable,
      }),
    (error) => error.details?.reason === "W8_CONTENT_REVISION_CONFLICT",
  );
  await apply("transitionLearningContent", {
    ...common,
    contentId,
    expectedContentRevision: 2,
    targetStatus: "READY",
    reason: "검토 완료",
  });
  await apply("transitionLearningContent", {
    ...common,
    contentId,
    expectedContentRevision: 3,
    targetStatus: "PUBLISHED",
    reason: "공개",
  });

  const started = await apply(
    "recordLearningProgress",
    {
      ...common,
      contentId,
      expectedContentRevision: 4,
      enrollmentId: "enrollment-1",
      expectedProgressRevision: null,
      event: "START",
    },
    student,
  );
  assert.equal(started.result.status, "IN_PROGRESS");
  const completed = await apply(
    "recordLearningProgress",
    {
      ...common,
      contentId,
      expectedContentRevision: 4,
      enrollmentId: "enrollment-1",
      expectedProgressRevision: 1,
      event: "COMPLETE",
    },
    student,
  );
  assert.equal(completed.result.status, "COMPLETED");
  const reset = await apply("resetLearningProgress", {
    ...common,
    studentUid: "student-1",
    enrollmentId: "enrollment-1",
    entries: [{ contentId, expectedProgressRevision: 2 }],
    reason: "교사 확인 후 재학습",
  });
  assert.equal(reset.result.resetCount, 1);

  const granted = await apply("grantLearningExemptions", {
    ...common,
    contentId,
    expectedContentRevision: 4,
    enrollmentIds: ["enrollment-1"],
    reason: "교사 승인",
  });
  assert.equal(granted.result.createdCount, 1);
  const exemptionId = granted.result.exemptionIds[0];
  const revoked = await apply("revokeLearningExemptions", {
    ...common,
    items: [{ exemptionId, expectedExemptionRevision: 1 }],
    reason: "승인 취소",
  });
  assert.equal(revoked.result.revokedCount, 1);
  const requested = await apply(
    "requestLearningExemption",
    {
      ...common,
      contentId,
      expectedContentRevision: 4,
      enrollmentId: "enrollment-1",
      reason: "면제 요청",
    },
    student,
  );
  const reviewed = await apply("reviewLearningExemptionRequest", {
    ...common,
    requestId: requested.result.requestId,
    expectedRequestRevision: 1,
    action: "APPROVE",
    reason: "요청 승인",
  });
  assert.equal(reviewed.result.status, "APPROVED");

  const thinkCloudOptions = {
    allowDuplicateWord: true,
    allowDuplicateByStudent: false,
    inputMode: "word",
    anonymous: false,
    maxLength: 20,
    profanityFilter: true,
  };
  const classOneCloud = await apply("createThinkCloudSession", {
    ...common,
    expectedStateRevision: null,
    title: "3학년 1반 생각모아",
    description: "학급별 상태 검증",
    targetGrade: "3",
    targetClass: "1",
    targetGradeLabel: "3학년",
    targetClassLabel: "1반",
    options: thinkCloudOptions,
  });
  const classTwoCloud = await apply(
    "createThinkCloudSession",
    {
      ...common,
      expectedStateRevision: null,
      title: "3학년 2반 생각모아",
      description: "교차 반 상태 검증",
      targetGrade: "3",
      targetClass: "2",
      targetGradeLabel: "3학년",
      targetClassLabel: "2반",
      options: thinkCloudOptions,
    },
    teacher2,
  );
  assert.equal(
    tx.documents.get(
      `years/2026/semesters/2/think_cloud_sessions/${classOneCloud.result.sessionId}`,
    ).status,
    "active",
  );
  assert.equal(
    tx.documents.get(
      `years/2026/semesters/2/think_cloud_sessions/${classTwoCloud.result.sessionId}`,
    ).status,
    "active",
  );
  assert.equal(
    tx.documents.get("years/2026/semesters/2/think_cloud_state/class-1")
      .activeSessionId,
    classOneCloud.result.sessionId,
  );
  assert.equal(
    tx.documents.get("years/2026/semesters/2/think_cloud_state/class-2")
      .activeSessionId,
    classTwoCloud.result.sessionId,
  );
  const pausedCloud = await apply("transitionThinkCloudSession", {
    ...common,
    sessionId: classOneCloud.result.sessionId,
    expectedSessionRevision: 1,
    expectedStateRevision: 1,
    targetStatus: "paused",
  });
  const resumedCloud = await apply("transitionThinkCloudSession", {
    ...common,
    sessionId: classOneCloud.result.sessionId,
    expectedSessionRevision: pausedCloud.result.sessionRevision,
    expectedStateRevision: pausedCloud.result.stateRevision,
    targetStatus: "active",
  });
  const cloudResponse = await apply(
    "submitThinkCloudResponse",
    {
      ...common,
      sessionId: classOneCloud.result.sessionId,
      expectedSessionRevision: resumedCloud.result.sessionRevision,
      textRaw: "독립",
      textNormalized: "독립",
    },
    student,
  );
  assert.ok(cloudResponse.result.responseId);
  const studentSlotPath = `semester_enrollment_slots/${enrollmentSlotIdFor(
    "2026-2",
    "student-1",
  )}`;
  assert.equal(
    tx.queryLog.some(({ collection }) => collection === "semester_enrollments"),
    false,
  );
  assert.equal(tx.readPaths.includes(studentSlotPath), true);
  assert.equal(
    tx.readPaths.includes("semester_enrollments/enrollment-1"),
    true,
  );
  const responseRoot = `years/2026/semesters/2/think_cloud_sessions/${classOneCloud.result.sessionId}/responses`;
  tx.seed(`${responseRoot}/peer-response`, {
    uid: "student-2",
    displayName: "다른 학생",
    textRaw: "연대",
    textNormalized: "연대",
    revision: 1,
    createdAt: "2026-08-12T00:59:00.000Z",
  });
  const canonicalEnrollment = structuredClone(
    tx.documents.get("semester_enrollments/enrollment-1"),
  );
  tx.seed("semester_enrollments/enrollment-1", {
    ...canonicalEnrollment,
    enrollmentStatus: "TRANSFERRED",
  });
  const responseCountBeforeInvalidEnrollment = [...tx.documents.keys()].filter(
    (documentPath) => documentPath.startsWith(`${responseRoot}/`),
  ).length;
  await assert.rejects(
    () =>
      apply(
        "submitThinkCloudResponse",
        {
          ...common,
          sessionId: classOneCloud.result.sessionId,
          expectedSessionRevision: resumedCloud.result.sessionRevision,
          textRaw: "차단",
          textNormalized: "차단",
        },
        student,
      ),
    (error) => error.details?.reason === "W8_THINK_CLOUD_TARGET_FORBIDDEN",
  );
  assert.equal(
    [...tx.documents.keys()].filter((documentPath) =>
      documentPath.startsWith(`${responseRoot}/`),
    ).length,
    responseCountBeforeInvalidEnrollment,
  );
  tx.seed("semester_enrollments/enrollment-1", canonicalEnrollment);
  await apply(
    "deleteThinkCloudSession",
    {
      ...common,
      sessionId: classTwoCloud.result.sessionId,
      expectedSessionRevision: 1,
      expectedStateRevision: 1,
      reason: "교차 반 검증 정리",
    },
    teacher2,
  );
  assert.equal(
    tx.documents.get(
      `years/2026/semesters/2/think_cloud_sessions/${classOneCloud.result.sessionId}`,
    ).status,
    "active",
  );

  const event = await apply("createScheduleEvent", {
    ...common,
    eventType: "CLASS",
    title: "역사 수업",
    description: "근현대사",
    startAt: "2026-08-12T00:00:00.000Z",
    endAt: "2026-08-12T01:00:00.000Z",
    allDay: false,
    period: "1",
    targetClassIds: ["class-1"],
    targetUserIds: [],
    sourceDomain: "USER",
    sourceReference: "class-1-20260812-1",
  });
  const eventId = event.result.eventId;
  const updatedEvent = await apply("updateScheduleEvent", {
    ...common,
    eventId,
    expectedEventRevision: 1,
    eventType: "CLASS",
    title: "역사 수업 변경",
    description: "근현대사",
    startAt: "2026-08-12T00:10:00.000Z",
    endAt: "2026-08-12T01:00:00.000Z",
    allDay: false,
    period: "1",
    targetClassIds: ["class-1"],
    targetUserIds: [],
    sourceDomain: "USER",
    sourceReference: "class-1-20260812-1",
  });
  assert.equal(updatedEvent.result.eventRevision, 2);
  await assert.rejects(
    () =>
      apply("createScheduleEvent", {
        ...common,
        eventType: "HOLIDAY",
        title: "공휴일",
        description: "",
        startAt: "2026-08-15T00:00:00.000Z",
        endAt: "2026-08-15T00:00:00.000Z",
        allDay: true,
        period: "",
        targetClassIds: [],
        targetUserIds: [],
        sourceDomain: "HOLIDAY",
        sourceReference: "holiday",
      }),
    (error) => error.details?.reason === "W8_HOLIDAY_COMMAND_REQUIRED",
  );

  const attendanceSession = await apply("createAttendanceSession", {
    ...common,
    classId: "class-1",
    date: "2026-08-12",
    period: "1",
    sourceEventId: eventId,
    expectedSourceEventRevision: 2,
  });
  const sessionId = attendanceSession.result.sessionId;
  const attendance = await apply("recordAttendanceBulk", {
    ...common,
    sessionId,
    expectedSessionRevision: 1,
    entries: [
      {
        studentUid: "student-1",
        enrollmentId: "enrollment-1",
        expectedRecordRevision: null,
        attendanceStatus: "PRESENT",
        reason: "",
      },
    ],
    reason: "첫 입력",
  });
  assert.equal(attendance.result.recordedCount, 1);
  const recordId = attendance.result.records[0].recordId;
  const individualAttendance = await apply("recordAttendance", {
    ...common,
    sessionId,
    expectedSessionRevision: 1,
    studentUid: "student-1",
    enrollmentId: "enrollment-1",
    expectedRecordRevision: 1,
    attendanceStatus: "PRESENT",
    reason: "재확인",
  });
  assert.equal(individualAttendance.result.recordRevision, 2);
  const correction = await apply("correctAttendanceRecord", {
    ...common,
    recordId,
    expectedRecordRevision: 2,
    attendanceStatus: "LATE",
    reason: "입실 시간 확인",
  });
  assert.ok(correction.result.revisionId);
  assert.equal(
    tx.documents.get(
      `semester_attendance_revisions/${correction.result.revisionId}`,
    ).previousStatus,
    "PRESENT",
  );
  const closed = await apply("closeAttendanceSession", {
    ...common,
    sessionId,
    expectedSessionRevision: 1,
  });
  assert.equal(closed.result.status, "CLOSED");
  const closedCorrection = await apply("correctAttendanceRecord", {
    ...common,
    recordId,
    expectedRecordRevision: 3,
    attendanceStatus: "EXCUSED",
    reason: "사후 증빙 확인",
  });
  assert.equal(
    tx.documents.get(
      `semester_attendance_revisions/${closedCorrection.result.revisionId}`,
    ).sessionStatusAtCorrection,
    "CLOSED",
  );
  const deletedEvent = await apply("deleteScheduleEvent", {
    ...common,
    eventId,
    expectedEventRevision: 2,
    reason: "합성 일정 정리",
  });
  assert.equal(deletedEvent.result.status, "ARCHIVED");
  const kstEvent = await apply("createScheduleEvent", {
    ...common,
    eventType: "SCHOOL",
    title: "KST 자정 일정",
    description: "한국 시간 날짜 검증",
    startAt: "2026-08-12T15:45:00.000Z",
    endAt: "2026-08-12T16:00:00.000Z",
    allDay: false,
    period: "",
    targetClassIds: ["class-1"],
    targetUserIds: [],
    sourceDomain: "USER",
    sourceReference: "kst-date-event",
  });
  const duplicateCandidate = await apply("createScheduleEvent", {
    ...common,
    eventType: "SCHOOL",
    title: "중복 후보",
    description: "중복 방지 검증",
    startAt: "2026-08-14T00:00:00.000Z",
    endAt: "2026-08-14T01:00:00.000Z",
    allDay: false,
    period: "",
    targetClassIds: ["class-1"],
    targetUserIds: [],
    sourceDomain: "USER",
    sourceReference: "other-source",
  });
  await assert.rejects(
    () =>
      apply("updateScheduleEvent", {
        ...common,
        eventId: duplicateCandidate.result.eventId,
        expectedEventRevision: 1,
        eventType: "SCHOOL",
        title: "중복 후보",
        description: "중복 방지 검증",
        startAt: "2026-08-14T00:00:00.000Z",
        endAt: "2026-08-14T01:00:00.000Z",
        allDay: false,
        period: "",
        targetClassIds: ["class-1"],
        targetUserIds: [],
        sourceDomain: "ASSESSMENT",
        sourceReference: "kst-date-event",
      }),
    (error) => error.details?.reason === "W8_SCHEDULE_SOURCE_DUPLICATE",
  );
  await assert.rejects(
    () =>
      apply("createScheduleEvent", {
        ...common,
        eventType: "SCHOOL",
        title: "학기 밖",
        description: "범위 검증",
        startAt: "2027-01-01T00:00:00.000Z",
        endAt: "2027-01-01T01:00:00.000Z",
        allDay: false,
        period: "",
        targetClassIds: ["class-1"],
        targetUserIds: [],
        sourceDomain: "USER",
        sourceReference: "outside",
      }),
    (error) => error.details?.reason === "W8_DATE_OUTSIDE_SEMESTER",
  );
  await assert.rejects(
    () =>
      apply("createScheduleEvent", {
        ...common,
        eventType: "PERSONAL",
        title: "잘못된 대상",
        description: "대상 검증",
        startAt: "2026-08-14T00:00:00.000Z",
        endAt: "2026-08-14T01:00:00.000Z",
        allDay: false,
        period: "",
        targetClassIds: [],
        targetUserIds: ["missing-student"],
        sourceDomain: "USER",
        sourceReference: "invalid-target",
      }),
    (error) => error.details?.reason === "W8_ENROLLMENT_INVALID",
  );
  assert.ok(kstEvent.result.eventId);

  const notice = await apply("createNotice", { ...common, ...noticeEditable });
  const noticeId = notice.result.noticeId;
  const updatedNotice = await apply("updateNotice", {
    ...common,
    noticeId,
    expectedNoticeRevision: 1,
    ...noticeEditable,
    content: "수정한 공지",
  });
  assert.equal(updatedNotice.result.noticeRevision, 2);
  const published = await apply("transitionNotice", {
    ...common,
    noticeId,
    expectedNoticeRevision: 2,
    targetStatus: "PUBLISHED",
  });
  assert.equal(published.result.deliveryCount, 1);
  const acknowledged = await apply(
    "acknowledgeNotice",
    { ...common, noticeId, expectedNoticeRevision: 3 },
    student,
  );
  assert.equal(acknowledged.result.acknowledged, true);
  const acknowledgedAll = await apply(
    "acknowledgeAllNotices",
    { ...common, notices: [{ noticeId, expectedNoticeRevision: 3 }] },
    student,
  );
  assert.equal(acknowledgedAll.result.acknowledgedCount, 1);
  const scheduledNotice = await apply("createNotice", {
    ...common,
    ...noticeEditable,
    title: "예약 공지",
    publishAt: "2026-08-12T15:00:00.000Z",
  });
  await apply("transitionNotice", {
    ...common,
    noticeId: scheduledNotice.result.noticeId,
    expectedNoticeRevision: 1,
    targetStatus: "SCHEDULED",
  });
  await assert.rejects(
    () =>
      apply("updateNotice", {
        ...common,
        noticeId: scheduledNotice.result.noticeId,
        expectedNoticeRevision: 2,
        ...noticeEditable,
        title: "예약 후 변경 금지",
      }),
    (error) => error.details?.reason === "W8_NOTICE_STATE_INVALID",
  );
  const scheduledAck = await apply(
    "acknowledgeNotice",
    {
      ...common,
      noticeId: scheduledNotice.result.noticeId,
      expectedNoticeRevision: 2,
    },
    student,
  );
  assert.equal(scheduledAck.result.acknowledged, true);

  const config = await apply("updateNotificationSettings", {
    ...common,
    expectedConfigRevision: null,
    enabled: true,
    studentNotificationsEnabled: true,
    teacherNotificationsEnabled: true,
    eventPolicies: { lesson_published: { enabled: true, priority: "NORMAL" } },
  });
  assert.equal(config.result.configRevision, 1);
  tx.seed("semester_enrollments/enrollment-2", {
    enrollmentId: "enrollment-2",
    semesterId: "2026-2",
    studentUid: "student-2",
    classId: "class-1",
    studentNumber: "02",
    enrollmentStatus: "ACTIVE",
    snapshot: { displayName: "두 번째 학생", studentNumber: "02" },
  });

  tx.resetTransaction();
  const store = {
    get: (path) => tx.get(path),
    runTransaction: async (callback) => {
      tx.resetTransaction();
      return callback(tx);
    },
  };
  const queryCore = w8.createW8QueryCore({
    store,
    now: () => "2026-08-12T15:30:00.000Z",
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  let delegatedNonLearningDenialCases = 0;
  const assertDelegatedNonLearningDenied = async (source, domain) => {
    await assert.rejects(
      () =>
        queryCore.getW8DomainState({
          auth: {
            uid: "lesson-reader",
            token: { email: "lesson-reader@yongshin-ms.ms.kr" },
          },
          data: {
            domain,
            audience: "teacher",
            semesterId: "2026-2",
            source,
          },
        }),
      (error) => error.details?.reason === "W8_MANAGE_REQUIRED",
    );
    delegatedNonLearningDenialCases += 1;
  };
  const learningState = await queryCore.getW8DomainState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: {
      domain: "LEARNING",
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
    },
  });
  assert.equal(learningState.contents[0].body, learningEditable.body);
  assert.equal(learningState.enrollmentId, "enrollment-1");
  assert.equal(learningState.writeCount, 0);
  assert.deepEqual(learningState.thinkCloudState.activeSessionIds, [
    classOneCloud.result.sessionId,
  ]);
  assert.equal(
    learningState.thinkCloudSessions[0].id,
    classOneCloud.result.sessionId,
  );
  const studentCloudDetail = await queryCore.getW8DomainState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: {
      domain: "LEARNING",
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
      sessionId: classOneCloud.result.sessionId,
    },
  });
  const ownStudentCloudResponse = studentCloudDetail.thinkCloudResponses.find(
    (response) => response.isOwn,
  );
  const peerStudentCloudResponse = studentCloudDetail.thinkCloudResponses.find(
    (response) => !response.isOwn,
  );
  assert.equal(ownStudentCloudResponse.id, cloudResponse.result.responseId);
  assert.equal(ownStudentCloudResponse.textRaw, "독립");
  assert.equal(ownStudentCloudResponse.displayName, "학생");
  assert.equal(peerStudentCloudResponse.displayName, "다른 학생");
  assert.equal(
    studentCloudDetail.thinkCloudResponses.every(
      (response) => !Object.prototype.hasOwnProperty.call(response, "uid"),
    ),
    true,
  );
  const teacherCloudDetail = await queryCore.getW8DomainState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      sessionId: classOneCloud.result.sessionId,
    },
  });
  assert.equal(
    teacherCloudDetail.thinkCloudResponses.find(
      (response) => response.uid === "student-1",
    ).displayName,
    "학생",
  );
  assert.equal(teacherCloudDetail.thinkCloudRoster[0].uid, "student-1");
  const homeroomTeacherCloudState = await queryCore.getW8DomainState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
    },
  });
  assert.equal(homeroomTeacherCloudState.readOnly, false);
  assert.deepEqual(
    homeroomTeacherCloudState.thinkCloudManagedClasses.map(
      (managedClass) => managedClass.classId,
    ),
    ["class-1"],
  );
  const delegatedCloudState = await queryCore.getW8DomainState({
    auth: {
      uid: "lesson-reader",
      token: { email: "lesson-reader@yongshin-ms.ms.kr" },
    },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
    },
  });
  assert.equal(delegatedCloudState.readOnly, true);
  assert.equal(delegatedCloudState.thinkCloudManagedClasses.length, 2);
  assert.equal(delegatedCloudState.thinkCloudSessions.length, 1);
  const delegatedCloudDetail = await queryCore.getW8DomainState({
    auth: {
      uid: "lesson-reader",
      token: { email: "lesson-reader@yongshin-ms.ms.kr" },
    },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      sessionId: classOneCloud.result.sessionId,
    },
  });
  assert.equal(delegatedCloudDetail.thinkCloudRoster[0].uid, "student-1");
  for (const domain of ["ATTENDANCE", "DASHBOARD"])
    await assertDelegatedNonLearningDenied("CURRENT", domain);
  await assert.rejects(
    () =>
      queryCore.getW8DomainState({
        auth: {
          uid: "teacher-2",
          token: { email: "teacher2@yongshin-ms.ms.kr" },
        },
        data: {
          domain: "LEARNING",
          audience: "teacher",
          semesterId: "2026-2",
          source: "CURRENT",
          sessionId: classOneCloud.result.sessionId,
        },
      }),
    (error) => error.details?.reason === "W8_THINK_CLOUD_TARGET_FORBIDDEN",
  );
  for (let index = 2; index < w8.THINK_CLOUD_RESPONSE_LIMIT; index += 1) {
    tx.seed(`${responseRoot}/cap-${String(index).padStart(3, "0")}`, {
      uid: `synthetic-student-${index}`,
      displayName: `합성 학생 ${index}`,
      textRaw: `응답${index}`,
      textNormalized: `응답${index}`,
      revision: 1,
      createdAt: `2026-08-12T01:${String(index % 60).padStart(2, "0")}:00.000Z`,
    });
  }
  assert.equal(
    [...tx.documents.keys()].filter((documentPath) =>
      documentPath.startsWith(`${responseRoot}/`),
    ).length,
    w8.THINK_CLOUD_RESPONSE_LIMIT,
  );
  await assert.rejects(
    () =>
      apply(
        "submitThinkCloudResponse",
        {
          ...common,
          sessionId: classOneCloud.result.sessionId,
          expectedSessionRevision: resumedCloud.result.sessionRevision,
          textRaw: "이백일",
          textNormalized: "이백일",
        },
        student,
      ),
    (error) => error.details?.reason === "W8_THINK_CLOUD_RESPONSE_LIMIT",
  );
  assert.equal(
    [...tx.documents.keys()].filter((documentPath) =>
      documentPath.startsWith(`${responseRoot}/`),
    ).length,
    w8.THINK_CLOUD_RESPONSE_LIMIT,
  );
  const deletedFullCloud = await apply("deleteThinkCloudSession", {
    ...common,
    sessionId: classOneCloud.result.sessionId,
    expectedSessionRevision: resumedCloud.result.sessionRevision,
    expectedStateRevision: resumedCloud.result.stateRevision,
    reason: "응답 상한 도달 세션 정리",
  });
  assert.equal(deletedFullCloud.result.deleted, true);
  assert.equal(
    [...tx.documents.keys()].filter((documentPath) =>
      documentPath.startsWith(`${responseRoot}/`),
    ).length,
    0,
  );
  tx.resetTransaction();
  await assert.rejects(
    () =>
      queryCore.getW8DomainState({
        auth: {
          uid: "student-1",
          token: { email: "student@yongshin-ms.ms.kr" },
        },
        data: {
          domain: "ATTENDANCE",
          audience: "student",
          semesterId: "2026-2",
          source: "CURRENT",
          studentUid: "other-student",
        },
      }),
    (error) => error.details?.reason === "W8_STUDENT_SCOPE_FORBIDDEN",
  );
  await assert.rejects(
    () =>
      queryCore.getW8DomainState({
        auth: {
          uid: "student-1",
          token: { email: "student@yongshin-ms.ms.kr" },
        },
        data: {
          domain: "LEARNING",
          audience: "student",
          semesterId: "2026-2",
          source: "ARCHIVE",
        },
      }),
    (error) => error.details?.reason === "W8_SOURCE_MISMATCH",
  );
  const explicitCurrent = await queryCore.getW8DomainState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: {
      domain: "LEARNING",
      audience: "student",
      semesterId: "2026-2",
      source: "EXPLICIT",
    },
  });
  assert.equal(explicitCurrent.provenance, "EXPLICIT");
  assert.equal(explicitCurrent.readOnly, true);
  assert.equal(explicitCurrent.writeCount, 0);
  const dashboard = await queryCore.getW8DomainState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: {
      domain: "DASHBOARD",
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
    },
  });
  assert.equal(
    dashboard.dashboard.todaySchedule.some(
      (row) => row.title === "KST 자정 일정",
    ),
    true,
  );
  assert.equal(
    dashboard.dashboard.importantNotices.some(
      (row) => row.title === "예약 공지",
    ),
    true,
  );
  assert.equal(dashboard.writeCount, 0);
  assert.equal("targetUserIds" in dashboard.dashboard.todaySchedule[0], false);
  assert.equal("createdBy" in dashboard.contents[0], false);
  assert.equal("openedBy" in dashboard.sessions[0], false);
  const teacherAttendance = await queryCore.getW8DomainState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: {
      domain: "ATTENDANCE",
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      sessionId,
    },
  });
  assert.equal(
    teacherAttendance.records.find((row) => row.studentUid === "student-2")
      ?.studentName,
    "두 번째 학생",
  );

  tx.resetTransaction();
  const checks = await w8
    .createW8ReadinessAdapter()
    .evaluate({ transaction: tx, manifest });
  assert.deepEqual(
    checks.map((check) => check.checkId),
    w8.W8_READINESS_CHECK_IDS,
  );
  assert.equal(checks.length, w8.W8_READINESS_CHECK_IDS.length);
  assert.equal(
    checks.every((check) => check.status === "PASS"),
    true,
  );

  tx.seed("semester_manifests/2026-2", {
    ...manifest,
    status: "ARCHIVED",
    provenance: "ARCHIVE",
  });
  tx.seed("users/archive-observer", { role: "teacher" });
  for (const source of ["ARCHIVE", "EXPLICIT"])
    for (const domain of ["ATTENDANCE", "DASHBOARD"])
      await assertDelegatedNonLearningDenied(source, domain);
  const archiveObserverCases = ["CLOSED", "ARCHIVED"].flatMap(
    (lifecycleStatus) =>
      ["ARCHIVE", "EXPLICIT"].flatMap((source) =>
        ["LEARNING", "DASHBOARD", "ATTENDANCE"].map((domain) => ({
          lifecycleStatus,
          domain,
          source,
          provenance: source === "ARCHIVE" ? "ARCHIVE" : "EXPLICIT",
        })),
      ),
  );
  const archiveSensitiveQueryCollections = [
    "semester_enrollments",
    w8.LEARNING_PROGRESS_COLLECTION,
    w8.LEARNING_EXEMPTION_COLLECTION,
    w8.LEARNING_EXEMPTION_REQUEST_COLLECTION,
    w8.ATTENDANCE_SESSION_COLLECTION,
    w8.ATTENDANCE_RECORD_COLLECTION,
    w8.NOTICE_ACK_COLLECTION,
    "years/2026/semesters/2/think_cloud_sessions",
  ];
  const archiveSensitiveReadPrefixes = [
    "semester_enrollments/",
    `${w8.LEARNING_PROGRESS_COLLECTION}/`,
    `${w8.LEARNING_EXEMPTION_COLLECTION}/`,
    `${w8.LEARNING_EXEMPTION_REQUEST_COLLECTION}/`,
    `${w8.ATTENDANCE_SESSION_COLLECTION}/`,
    `${w8.ATTENDANCE_RECORD_COLLECTION}/`,
    `${w8.NOTICE_ACK_COLLECTION}/`,
    "years/2026/semesters/2/think_cloud_",
  ];
  for (const archiveObserverCase of archiveObserverCases) {
    tx.seed("semester_manifests/2026-2", {
      ...manifest,
      status: archiveObserverCase.lifecycleStatus,
      provenance: "ARCHIVE",
    });
    tx.resetTransaction();
    const archiveObserverState = await queryCore.getW8DomainState({
      auth: {
        uid: "archive-observer",
        token: { email: "archive-observer@yongshin-ms.ms.kr" },
      },
      data: {
        domain: archiveObserverCase.domain,
        audience: "teacher",
        semesterId: "2026-2",
        source: archiveObserverCase.source,
        studentUid: "student-1",
        sessionId,
      },
    });
    assert.equal(archiveObserverState.enrollment, null);
    assert.equal(archiveObserverState.enrollmentId, null);
    assert.equal(
      archiveObserverState.contents.length > 0,
      archiveObserverCase.domain !== "ATTENDANCE",
    );
    assert.equal(
      archiveObserverState.contents.every(
        (content) =>
          content.readOnly &&
          content.provenance === archiveObserverCase.provenance,
      ),
      true,
    );
    assert.deepEqual(archiveObserverState.progress, []);
    assert.deepEqual(archiveObserverState.exemptions, []);
    assert.deepEqual(archiveObserverState.exemptionRequests, []);
    assert.deepEqual(archiveObserverState.sessions, []);
    assert.deepEqual(archiveObserverState.records, []);
    assert.deepEqual(archiveObserverState.acknowledgements, []);
    assert.deepEqual(archiveObserverState.thinkCloudSessions, []);
    assert.deepEqual(archiveObserverState.thinkCloudResponses, []);
    assert.deepEqual(archiveObserverState.thinkCloudRoster, []);
    assert.deepEqual(archiveObserverState.thinkCloudManagedClasses, []);
    assert.equal(archiveObserverState.dashboard.attendancePendingCount, 0);
    assert.deepEqual(
      tx.queryLog.filter(({ collection }) =>
        archiveSensitiveQueryCollections.includes(collection),
      ),
      [],
    );
    assert.deepEqual(
      tx.readPaths.filter((readPath) =>
        archiveSensitiveReadPrefixes.some((prefix) =>
          readPath.startsWith(prefix),
        ),
      ),
      [],
    );
    assert.equal(
      tx.queryLog.filter(({ collection }) => collection === "semester_classes")
        .length,
      1,
    );
  }
  tx.seed("semester_manifests/2026-2", {
    ...manifest,
    status: "ARCHIVED",
    provenance: "ARCHIVE",
  });
  const archiveHomeroomAttendance = await queryCore.getW8DomainState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: {
      domain: "ATTENDANCE",
      audience: "teacher",
      semesterId: "2026-2",
      source: "ARCHIVE",
      sessionId,
    },
  });
  assert.equal(archiveHomeroomAttendance.records.length > 0, true);
  const archiveDelegatedLearning = await queryCore.getW8DomainState({
    auth: {
      uid: "lesson-reader",
      token: { email: "lesson-reader@yongshin-ms.ms.kr" },
    },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "ARCHIVE",
    },
  });
  assert.equal(archiveDelegatedLearning.progress.length > 0, true);
  const archiveAdminLearning = await queryCore.getW8DomainState({
    auth: {
      uid: "archive-admin",
      token: { email: "westoria28@gmail.com" },
    },
    data: {
      domain: "LEARNING",
      audience: "teacher",
      semesterId: "2026-2",
      source: "ARCHIVE",
    },
  });
  assert.equal(archiveAdminLearning.progress.length > 0, true);
  await assert.rejects(
    () => apply("createNotice", { ...common, ...noticeEditable }),
    (error) => error.details?.reason === "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
  );

  console.log(
    JSON.stringify({
      passed: true,
      cases: 91,
      commandTypes: Object.values(w8.W8_COMMAND_TYPES).length,
      readinessChecks: checks.length,
      readAfterWrite: 0,
      thinkCloudEnrollmentCollectionScansOnSubmit: 0,
      thinkCloudResponseLimit: w8.THINK_CLOUD_RESPONSE_LIMIT,
      thinkCloudStudentUidExposure: 0,
      thinkCloudDelegatedReadOnly: true,
      delegatedNonLearningDirectCallDenials: delegatedNonLearningDenialCases,
      archiveUnassignedTeacherSensitiveReads: 0,
      archiveUnassignedTeacherNegativeCases: archiveObserverCases.length,
      archiveLifecycleStatusesCovered: new Set(
        archiveObserverCases.map(({ lifecycleStatus }) => lifecycleStatus),
      ).size,
      archiveExplicitSourceBypassCases: archiveObserverCases.filter(
        ({ source }) => source === "EXPLICIT",
      ).length,
      archivePrivilegedPolicyPreservationCases: 3,
      productionAccess: 0,
    }),
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
