import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

process.noDeprecation = true;

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_ID = "w10p-visual-fixture-v1";
const FIXTURE_REVISION = 1;
const ARTIFACT_SCHEMA_VERSION = "w10p-visual-fixture-audit-v1";
const AUDIT_MAX_AGE_SECONDS = 60 * 60;
const FIXTURE_OWNER = "w10p-visual-parity";
const FIXED_TIME = "2026-08-17T06:00:00.000Z";
const SEMESTER_ID = "2026-2";
const YEAR = "2026";
const SEMESTER = "2";
const CLASS_ID = "w10p-class-3-1";
const ENROLLMENT_ID = "w10p-enrollment-student";
const STUDENT_UID = "w10p-visual-student";
const TEACHER_UID = "w10p-visual-teacher";
const ADMIN_UID = "w10p-visual-admin";
const STUDENT_EMAIL = "w10p-visual-student@yongshin-ms.ms.kr";
const TEACHER_EMAIL = "w10p-visual-teacher@yongshin-ms.ms.kr";
const ADMIN_EMAIL = "westoria28@gmail.com";
const RUN_PATH = `w10p_visual_fixture_runs/${FIXTURE_ID}`;
const MAINTENANCE_PATH = "site_settings/student_maintenance";
const ASSESSMENT_SETTINGS_PATH = `years/${YEAR}/semesters/${SEMESTER}/assessment_config/settings`;
const ASSESSMENT_STATUS_PATH = `years/${YEAR}/semesters/${SEMESTER}/assessment_config/status`;
const markerlessOverwritePaths = new Set([
  MAINTENANCE_PATH,
  ASSESSMENT_SETTINGS_PATH,
  ASSESSMENT_STATUS_PATH,
]);

const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const modes = ["dry-run", "setup", "audit", "cleanup"];
const selectedModes = modes.filter((mode) => args.includes(`--${mode}`));

assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production access is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.equal(selectedModes.length, 1, "Choose exactly one fixture mode.");
const mode = selectedModes[0];

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const NOTICE_DELIVERY_ID = hashId("noticedel", "w10p-notice", STUDENT_UID);
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${STUDENT_UID}`).slice(0, 40)}`;
const wisAccountId = hashId("wisacct", SEMESTER_ID, STUDENT_UID);
const wisProductId = "w10p-visual-product";
const wisInventoryId = hashId("wisinv", SEMESTER_ID, wisProductId);
const wisLedgerId = hashId(
  "wisled",
  SEMESTER_ID,
  wisAccountId,
  "INITIAL_GRANT",
  "w10p-visual-grant",
);
const wisOrderId = hashId(
  "wisord",
  SEMESTER_ID,
  wisAccountId,
  wisInventoryId,
  FIXTURE_ID,
);
const wisOrderDebitLedgerId = hashId(
  "wisled",
  SEMESTER_ID,
  wisAccountId,
  "ORDER_DEBIT",
  wisOrderId,
);
const fixedDate = new Date(FIXED_TIME);
const oneDayLater = new Date("2026-08-18T06:00:00.000Z");
const imageUrl = "/icons/westory-wordmark.svg";

const canonicalize = (value) => {
  if (value instanceof Date) return { __timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value.toDate === "function") {
    return { __timestamp: value.toDate().toISOString() };
  }
  if (Buffer.isBuffer(value)) return { __bytesSha256: sha256(value) };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));

const owned = (value) => ({
  ...value,
  fixtureId: FIXTURE_ID,
  fixtureOwner: FIXTURE_OWNER,
});

const hallOfFameConfig = {
  podiumImageUrl: "",
  podiumStoragePath: "",
  positionPreset: "classic_podium_v1",
  positions: {
    desktop: {
      first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
      second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
      third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
    },
    mobile: {
      first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
      second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
      third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
    },
  },
  leaderboardPanel: {
    desktop: { leftPercent: 71, topPercent: 0, widthPercent: 29 },
    mobile: { leftPercent: 50, topPercent: 0, widthPercent: 100 },
  },
  publicRange: { gradeRankLimit: 10, classRankLimit: 10, includeTies: true },
  recognitionPopup: { enabled: true, gradeEnabled: true, classEnabled: true },
};

const curriculumTree = [
  {
    id: "w10p-history-big",
    title: "W10P 역사 대단원",
    children: [
      {
        id: "w10p-lesson-unit",
        title: "W10P 수업 자료",
        children: [],
      },
      {
        id: "w10p-quiz-unit",
        title: "W10P 평가 단원",
        children: [],
      },
    ],
  },
];

const thinkCloudOptions = {
  allowDuplicateWord: true,
  allowDuplicateByStudent: true,
  inputMode: "sentence",
  anonymous: false,
  maxLength: 40,
  profanityFilter: true,
};

const wisLedgerEntry = {
  schemaVersion: 1,
  policyVersion: "w7-v1",
  ledgerEntryId: wisLedgerId,
  semesterId: SEMESTER_ID,
  accountId: wisAccountId,
  studentUid: STUDENT_UID,
  type: "INITIAL_GRANT",
  delta: 700,
  balanceBefore: 0,
  balanceAfter: 700,
  sourceId: "w10p-visual-grant",
  reason: "W10P 위스 기록",
  reversalEntryId: "",
  actorUid: TEACHER_UID,
  actorRole: "teacher",
  commandId: "w10p-visual-command",
  receiptId: "w10p-visual-receipt",
  createdAt: fixedDate,
};

const wisOrderDebitLedgerEntry = {
  schemaVersion: 1,
  policyVersion: "w7-v1",
  ledgerEntryId: wisOrderDebitLedgerId,
  semesterId: SEMESTER_ID,
  accountId: wisAccountId,
  studentUid: STUDENT_UID,
  type: "ORDER_DEBIT",
  delta: -100,
  balanceBefore: 700,
  balanceAfter: 600,
  sourceId: wisOrderId,
  reason: "상품 주문: W10P 위스 상품",
  actorUid: STUDENT_UID,
  actorRole: "student",
  commandId: FIXTURE_ID,
  receiptId: "w10p-visual-order-receipt",
  createdAt: oneDayLater,
};

const gradeFixture = (scoreKind, title, suffix) => {
  const written = scoreKind === "written_exam_essay";
  const rosterId = `w10p-roster-${suffix}`;
  const totalScore = written ? 37 : 18;
  const totalMaxScore = written ? 40 : 20;
  const legacyItem = {
    name: written ? "W10P 서술형" : "W10P 탐구 활동",
    shortName: "",
    itemKey: written ? "subjective-1" : "w10p-performance-1",
    groupKey: written ? "subjective" : "",
    groupLabel: written ? "서술형" : "",
    examSection: written ? "essay" : "",
    questionNumber: written ? 1 : 0,
    correctAnswer: written ? "W10P 모범 답안" : "",
    studentAnswer: written ? "W10P 학생 답안" : "",
    answerCorrect: written,
    answerStatus: written ? "correct" : "",
    answerChoices: [],
    feedback: `${title} 피드백`,
    score: totalScore,
    maxScore: totalMaxScore,
    ratio: 100,
    scoreEntered: true,
  };
  const legacyRecord = {
    uid: STUDENT_UID,
    grade: "3",
    class: "1",
    number: "1",
    studentName: "W10P 학생",
    items: [legacyItem],
    enteredScoreCount: 1,
    totalScore,
    totalMaxScore,
    feedback: `${title} 피드백`,
    evidence: `${title} 채점표`,
    academicStatus: "",
    isTransferred: false,
    transferStatus: "",
  };
  const enrollmentSnapshot = {
    enrollmentId: ENROLLMENT_ID,
    classId: CLASS_ID,
    displayName: "W10P 학생",
    studentNumber: "1",
    grade: "3",
    classNumber: "1",
    classDisplayName: "W10P 시각 검증 학급",
  };
  const rosterPath = `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/${rosterId}`;
  const legacyScorePath = `users/${STUDENT_UID}/performance_scores/${rosterId}`;
  const recordId = `grade_${sha256(
    `MANUAL_IMPORT\n${SEMESTER_ID}\n${rosterId}\n${ENROLLMENT_ID}`,
  )}`;
  const logicalKey = `MANUAL_IMPORT:${SEMESTER_ID}:${rosterId}:${ENROLLMENT_ID}`;
  const sourceRefs = [
    rosterPath,
    `semester_enrollments/${ENROLLMENT_ID}`,
    `semester_classes/${CLASS_ID}`,
    legacyScorePath,
  ];
  const sourceHash = sha256(
    canonicalJson({
      rosterId,
      scoreKind,
      title,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      items: legacyRecord.items,
      totalScore,
      totalMaxScore,
      feedback: legacyRecord.feedback,
      evidence: legacyRecord.evidence,
    }),
  );
  const gradeItems = [
    {
      itemId: `legacy-1-${sha256(legacyItem.itemKey).slice(0, 16)}`,
      maxScore: totalMaxScore,
      awardedScore: totalScore,
      evaluationKind: "TEACHER",
      evidence: canonicalJson({
        feedback: legacyItem.feedback,
        studentAnswer: legacyItem.studentAnswer,
        correctAnswer: legacyItem.correctAnswer,
        answerStatus: legacyItem.answerStatus,
        answerCorrect: legacyItem.answerCorrect,
        source: legacyRecord.evidence,
      }).slice(0, 2_000),
      reason: "Legacy grade roster import",
    },
  ];
  const baseRecord = {
    recordId,
    logicalKey,
    semesterId: SEMESTER_ID,
    studentUid: STUDENT_UID,
    enrollmentId: ENROLLMENT_ID,
    classId: CLASS_ID,
    sourceKind: "MANUAL_IMPORT",
    sourceId: rosterId,
    sourceRefs,
    sourceSnapshotHash: sourceHash,
    scoreKind,
    enrollmentSnapshot,
    definitionId: "",
    definitionRevision: 0,
    sourceHash,
    title,
    rubricVersion: "w6b-rubric-v1",
  };
  const evidenceHash = sha256(
    canonicalJson({
      recordId,
      gradeRevision: 1,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      sourceKind: "MANUAL_IMPORT",
      sourceId: rosterId,
      sourceSnapshotHash: sourceHash,
      scoreKind,
      enrollmentSnapshot,
      title,
      rubricVersion: "w6b-rubric-v1",
      items: gradeItems,
      supersedesVersionId: "",
    }),
  );
  const versionId = `gradever_${sha256(`${recordId}\n1\n${evidenceHash}`)}`;
  const commandId = `w10p-visual-grade-${suffix}`;
  const receiptId = `w10p-visual-grade-receipt-${suffix}`;
  const version = owned({
    schemaVersion: 1,
    policyVersion: "w6b-v1",
    versionId,
    ...baseRecord,
    gradeRevision: 1,
    state: "OFFICIAL_PUBLISHED",
    items: gradeItems,
    totalScore,
    totalMaxScore,
    percent: Math.round((totalScore / totalMaxScore) * 10_000) / 100,
    evidenceHash,
    supersedesVersionId: "",
    reason: "W10P 시각 검증",
    createdBy: TEACHER_UID,
    createdByRole: "teacher",
    commandId,
    receiptId,
    createdAt: fixedDate,
  });
  const record = owned({
    schemaVersion: 1,
    policyVersion: "w6b-v1",
    ...baseRecord,
    revision: 1,
    gradeRevision: 1,
    status: "OFFICIAL_PENDING_SIGNATURE",
    currentVersionId: versionId,
    currentVersionRef: `semester_grade_versions/${versionId}`,
    evidenceHash,
    totalScore,
    totalMaxScore,
    percent: Math.round((totalScore / totalMaxScore) * 10_000) / 100,
    signatureRequired: true,
    provenance: "CURRENT",
    officialVersionId: null,
    officialAt: null,
    signedAttestationId: null,
    signedBy: null,
    signedAt: null,
    previousOfficialVersionId: "",
    createdBy: TEACHER_UID,
    createdAt: fixedDate,
    updatedBy: TEACHER_UID,
    updatedAt: fixedDate,
    commandId,
    receiptId,
  });
  const roster = owned({
    rosterId,
    schemaVersion: 1,
    policyVersion: "w10p-w6b-legacy-v1",
    revision: 1,
    scoreKind,
    scoreContentKind: written ? "essay" : "performance",
    title: written ? "W10P 정기시험 점수표" : "W10P 수행평가 점수표",
    subject: "W10P 사회",
    academicYear: YEAR,
    semester: SEMESTER,
    targetGrade: "3",
    targetClass: "1",
    classes: ["1"],
    items: [legacyItem],
    totalMaxScore,
    rowCount: 1,
    matchedCount: 1,
    unmatchedCount: 0,
    sourceFileName: `${suffix}.xlsx`,
    rows: [
      {
        rowNumber: 1,
        ...legacyRecord,
        matchStatus: "matched",
        matchMessage: "",
        isManual: false,
      },
    ],
    uploadedBy: TEACHER_UID,
    uploadedByEmail: TEACHER_EMAIL,
    updatedBy: TEACHER_UID,
    commandId,
    receiptId,
    createdAt: fixedDate,
    updatedAt: fixedDate,
  });
  const legacyScore = owned({
    schemaVersion: 1,
    policyVersion: "w10p-w6b-legacy-v1",
    scoreKind,
    scoreContentKind: written ? "essay" : "performance",
    rosterId,
    title: roster.title,
    subject: "W10P 사회",
    academicYear: YEAR,
    semester: SEMESTER,
    grade: "3",
    class: "1",
    number: "1",
    studentName: "W10P 학생",
    uid: STUDENT_UID,
    items: [legacyItem],
    enteredScoreCount: 1,
    totalScore,
    totalMaxScore,
    feedback: legacyRecord.feedback,
    evidence: legacyRecord.evidence,
    sourceFileName: `${suffix}.xlsx`,
    uploadedBy: TEACHER_UID,
    uploadedByEmail: TEACHER_EMAIL,
    uploadedAt: fixedDate,
    updatedAt: fixedDate,
    gradeRecordId: recordId,
    gradeVersionId: versionId,
    gradeRecordRevision: 1,
    gradeRevision: 1,
    projectionRevision: 1,
    commandId,
    receiptId,
  });
  return { recordId, versionId, record, version, roster, legacyScore };
};

const performanceGrade = gradeFixture(
  "performance",
  "W10P 수행평가 근거",
  "performance",
);
const writtenGrade = gradeFixture(
  "written_exam_essay",
  "W10P 정기시험 근거",
  "written",
);

const createDocs = new Map([
  [
    `users/${STUDENT_UID}`,
    owned({
      uid: STUDENT_UID,
      role: "student",
      email: STUDENT_EMAIL,
      name: "W10P 학생",
      displayName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      studentGrade: "3",
      studentClass: "1",
      studentNumber: "1",
      teacherPortalEnabled: false,
      staffPermissions: [],
      privacyAgreed: true,
      consentAgreedItems: ["privacy", "terms"],
    }),
  ],
  [
    `users/${TEACHER_UID}`,
    owned({
      uid: TEACHER_UID,
      role: "teacher",
      email: TEACHER_EMAIL,
      name: "W10P 교사",
      displayName: "W10P 교사",
      teacherPortalEnabled: true,
      staffPermissions: [
        "lesson_read",
        "point_manage",
        "quiz_read",
        "student_list_read",
      ],
    }),
  ],
  [
    `users/${ADMIN_UID}`,
    owned({
      uid: ADMIN_UID,
      role: "teacher",
      email: ADMIN_EMAIL,
      name: "W10P 관리자",
      displayName: "W10P 관리자",
      teacherPortalEnabled: true,
      staffPermissions: [],
    }),
  ],
  [
    `users/${STUDENT_UID}/history_dictionary_words/w10p-history-term`,
    owned({
      uid: STUDENT_UID,
      termId: "w10p-history-term",
      word: "W10P 역사 용어",
      normalizedWord: "w10p 역사 용어",
      definition: "W10P 시각 검증을 위한 역사 용어 풀이입니다.",
      studentLevel: "middle",
      tags: ["W10P"],
      status: "saved",
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      definitionSource: "teacher_reviewed",
      year: YEAR,
      semester: SEMESTER,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `users/${STUDENT_UID}/performance_scores/w10p-roster-performance`,
    performanceGrade.legacyScore,
  ],
  [
    `users/${STUDENT_UID}/performance_scores/w10p-roster-written`,
    writtenGrade.legacyScore,
  ],
  [
    `student_identities/${STUDENT_UID}`,
    owned({
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      accountStatus: "ACTIVE",
      revision: 1,
      provenance: "CANONICAL",
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_classes/${CLASS_ID}`,
    owned({
      classId: CLASS_ID,
      semesterId: SEMESTER_ID,
      grade: "3",
      classNumber: "1",
      classKey: "3::1",
      displayName: "W10P 시각 검증 학급",
      homeroomTeacherUid: TEACHER_UID,
      status: "ACTIVE",
      revision: 1,
      provenance: "CANONICAL",
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_enrollments/${ENROLLMENT_ID}`,
    owned({
      enrollmentId: ENROLLMENT_ID,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      classId: CLASS_ID,
      enrollmentStatus: "ACTIVE",
      status: "ACTIVE",
      source: {
        type: "MANUAL_EXCEPTION",
        sourceId: FIXTURE_ID,
        revision: 1,
      },
      revision: 1,
      provenance: "CANONICAL",
      effectiveFrom: "2026-08-17",
      effectiveTo: null,
      displayName: "W10P 학생",
      studentNumber: "1",
      snapshot: {
        displayName: "W10P 학생",
        grade: "3",
        classNumber: "1",
        classDisplayName: "W10P 시각 검증 학급",
        studentNumber: "1",
      },
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_enrollment_slots/${slotId}`,
    owned({
      slotId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      activeEnrollmentId: ENROLLMENT_ID,
      revision: 1,
      status: "ACTIVE",
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    "semester_learning_contents/w10p-learning-content",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      contentId: "w10p-learning-content",
      semesterId: SEMESTER_ID,
      contentType: "LESSON",
      title: "W10P 수업 자료",
      summary: "W10P 학습 목록 시각 검증 자료",
      body: "W10P 수업 자료 본문",
      resourceUrl: "",
      status: "PUBLISHED",
      revision: 2,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      audienceRoles: ["student"],
      targetClassIds: [CLASS_ID],
      availableFrom: "2026-01-01T00:00:00.000Z",
      availableUntil: "2027-01-01T00:00:00.000Z",
      publishedAt: FIXED_TIME,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_schedule_events/w10p-schedule-event",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      eventId: "w10p-schedule-event",
      semesterId: SEMESTER_ID,
      eventType: "SCHOOL",
      title: "W10P 시각 검증 일정",
      description: "W10P 일정 설명",
      startAt: "2026-08-17T00:00:00.000+09:00",
      endAt: "2026-08-17T23:59:59.999+09:00",
      allDay: true,
      period: "",
      status: "ACTIVE",
      sourceDomain: "USER",
      sourceReference: "legacy-calendar:event:w10p-schedule-event",
      targetClassIds: [CLASS_ID],
      targetUserIds: [],
      revision: 1,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_attendance_sessions/w10p-attendance-session",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      sessionId: "w10p-attendance-session",
      semesterId: SEMESTER_ID,
      classId: CLASS_ID,
      className: "W10P 시각 검증 학급",
      date: "2026-08-17",
      period: "1",
      status: "OPEN",
      revision: 1,
      sourceEventId: "w10p-schedule-event",
      openedBy: TEACHER_UID,
      openedAt: FIXED_TIME,
      provenance: "CURRENT",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_attendance_records/w10p-attendance-record",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      recordId: "w10p-attendance-record",
      sessionId: "w10p-attendance-session",
      semesterId: SEMESTER_ID,
      classId: CLASS_ID,
      studentUid: STUDENT_UID,
      studentName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      attendanceStatus: "EXCUSED",
      reason: "W10P 출석 사유",
      revision: 1,
      recordedBy: TEACHER_UID,
      recordedAt: FIXED_TIME,
      provenance: "CURRENT",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_notices/w10p-notice",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      noticeId: "w10p-notice",
      semesterId: SEMESTER_ID,
      title: "W10P 시각 검증 공지",
      content: "W10P 시각 검증 공지 내용입니다.",
      status: "PUBLISHED",
      priority: "HIGH",
      revision: 2,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      targetClassIds: [CLASS_ID],
      targetUserIds: [],
      targetRoles: ["student"],
      publishAt: "2026-01-01T00:00:00.000Z",
      expireAt: "2027-01-01T00:00:00.000Z",
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
  [
    `semester_notice_deliveries/${NOTICE_DELIVERY_ID}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      semesterId: SEMESTER_ID,
      provenance: "CURRENT",
      deliveryId: NOTICE_DELIVERY_ID,
      noticeId: "w10p-notice",
      noticeRevision: 2,
      recipientUid: STUDENT_UID,
      revision: 1,
      status: "DELIVERED",
      deliveredAt: fixedDate,
      dedupeKey: `w10p-notice:${STUDENT_UID}`,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/calendar/w10p-schedule-event`,
    owned({
      title: "W10P 시각 검증 일정",
      start: "2026-08-17",
      end: "2026-08-17",
      eventType: "event",
      targetType: "common",
      targetClass: "",
      description: "W10P 일정 설명",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/lessons/w10p-lesson`,
    owned({
      unitId: "w10p-lesson-unit",
      title: "W10P 수업 자료",
      content: "W10P 수업 자료 본문",
      body: "W10P 수업 자료 본문",
      blocks: [
        {
          id: "w10p-lesson-block",
          type: "text",
          content: "W10P 수업 자료 본문",
        },
      ],
      status: "published",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "lessons/w10p-lesson",
    owned({
      unitId: "w10p-lesson-unit",
      title: "W10P 수업 자료",
      content: "W10P 수업 자료 본문",
      body: "W10P 수업 자료 본문",
      blocks: [
        {
          id: "w10p-lesson-block",
          type: "text",
          content: "W10P 수업 자료 본문",
        },
      ],
      status: "published",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/map_resources/w10p-map`,
    owned({
      title: "W10P 역사 지도",
      description: "W10P 시각 검증 지도",
      sortOrder: 1,
      isPublished: true,
      imageUrl,
      tags: [],
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "map_resources/w10p-map",
    owned({
      title: "W10P 역사 지도",
      description: "W10P 시각 검증 지도",
      sortOrder: 1,
      isPublished: true,
      imageUrl,
      tags: [],
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/history_classrooms/w10p-history-classroom`,
    owned({
      title: "W10P 역사교실",
      description: "W10P 역사교실 시각 검증 자료",
      mapResourceId: "w10p-map",
      mapTitle: "W10P 역사교실",
      pdfPageImages: [{ page: 1, imageUrl, width: 1000, height: 1400 }],
      pdfRegions: [],
      blanks: [
        {
          id: "w10p-blank-1",
          page: 1,
          left: 120,
          top: 180,
          width: 180,
          height: 52,
          answer: "W10P",
          prompt: "W10P 빈칸",
          source: "manual",
        },
      ],
      answerOptions: ["W10P"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      dueWindowDays: null,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: STUDENT_UID,
      targetStudentUids: [STUDENT_UID],
      targetStudentAccessMap: { [STUDENT_UID]: true },
      targetStudentName: "W10P 학생",
      targetStudentNames: ["W10P 학생"],
      targetStudentReasons: { [STUDENT_UID]: "W10P 배정" },
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: fixedDate,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      contentRevision: 1,
    }),
  ],
  [
    "history_classrooms/w10p-history-classroom",
    owned({
      title: "W10P 역사교실",
      description: "W10P 역사교실 시각 검증 자료",
      mapResourceId: "w10p-map",
      mapTitle: "W10P 역사교실",
      pdfPageImages: [{ page: 1, imageUrl, width: 1000, height: 1400 }],
      pdfRegions: [],
      blanks: [
        {
          id: "w10p-blank-1",
          page: 1,
          left: 120,
          top: 180,
          width: 180,
          height: 52,
          answer: "W10P",
          prompt: "W10P 빈칸",
          source: "manual",
        },
      ],
      answerOptions: ["W10P"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: STUDENT_UID,
      targetStudentUids: [STUDENT_UID],
      targetStudentAccessMap: { [STUDENT_UID]: true },
      targetStudentName: "W10P 학생",
      targetStudentNames: ["W10P 학생"],
      targetStudentReasons: { [STUDENT_UID]: "W10P 배정" },
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: fixedDate,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      contentRevision: 1,
    }),
  ],
  [
    "history_dictionary_terms/w10p-history-term",
    owned({
      word: "W10P 역사 용어",
      normalizedWord: "w10p 역사 용어",
      definition: "W10P 시각 검증을 위한 역사 용어 풀이입니다.",
      studentLevel: "middle",
      tags: ["W10P"],
      relatedUnitId: "w10p-lesson-unit",
      status: "published",
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
  [
    "source_archive/w10p-source",
    owned({
      schemaVersion: 1,
      mediaKind: "text",
      status: "ready",
      currentRevision: "w10p-v1",
      title: "W10P 사료",
      description: "W10P 시각 검증 사료",
      era: "고대",
      subject: "역사",
      unit: "W10P 수업 자료",
      type: "text",
      tags: ["W10P"],
      source: "W10P 합성 자료",
      searchText: "w10p 사료 역사",
      previewText: "W10P 사료 본문",
      pageCount: 1,
      file: {
        name: "",
        mimeType: "text/plain",
        storagePath: "",
        downloadUrl: "",
        size: 0,
        revision: "w10p-v1",
      },
      search: { text: "w10p 사료 역사", previewText: "W10P 사료 본문" },
      image: { imageUrl: "", storagePath: "" },
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      sessionId: "w10p-think-cloud",
      semesterId: SEMESTER_ID,
      targetClassId: CLASS_ID,
      title: "W10P 생각모아",
      description: "W10P 생각모아 시각 검증",
      targetGrade: "3",
      targetClass: "1",
      targetGradeLabel: "3학년",
      targetClassLabel: "1반",
      status: "active",
      options: thinkCloudOptions,
      createdBy: TEACHER_UID,
      createdByName: "W10P 교사",
      createdAt: fixedDate,
      activatedAt: fixedDate,
      updatedAt: fixedDate,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses/w10p-response-1`,
    owned({
      uid: STUDENT_UID,
      displayName: "W10P 학생",
      textRaw: "W10P 응답 하나",
      textNormalized: "w10p 응답 하나",
      createdAt: fixedDate,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses/w10p-response-2`,
    owned({
      uid: STUDENT_UID,
      displayName: "W10P 학생",
      textRaw: "W10P 응답 둘",
      textNormalized: "w10p 응답 둘",
      createdAt: oneDayLater,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/quiz_questions/1`,
    owned({
      category: "formative",
      unitId: "w10p-quiz-unit",
      subUnitId: null,
      type: "choice",
      question: "W10P 평가 문항",
      options: ["W10P 정답", "W10P 오답"],
      answer: 0,
      explanation: "W10P 평가 문항 해설",
      hintEnabled: true,
      hint: "W10P 힌트",
      contentRevision: 1,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/quiz_results/w10p-quiz-result`,
    owned({
      uid: STUDENT_UID,
      name: "W10P 학생",
      studentName: "W10P 학생",
      email: STUDENT_EMAIL,
      grade: "3",
      class: "1",
      number: "1",
      gradeClass: "3 1 1번",
      unitId: "w10p-quiz-unit",
      category: "formative",
      score: 100,
      total: 1,
      details: [
        {
          id: 1,
          q: "W10P 평가 문항",
          u: "W10P 정답",
          a: 0,
          correct: true,
        },
      ],
      timestamp: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/w10p-roster-performance`,
    performanceGrade.roster,
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/w10p-roster-written`,
    writtenGrade.roster,
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/grading_plans/w10p-grading-plan`,
    owned({
      subject: "W10P 사회",
      targetGrade: "3",
      items: [
        { type: "정기", name: "W10P 정기시험", maxScore: 40, ratio: 50 },
        { type: "수행", name: "W10P 수행평가", maxScore: 20, ratio: 50 },
      ],
      academicYear: YEAR,
      semester: SEMESTER,
      revision: 1,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_grade_records/${performanceGrade.recordId}`,
    performanceGrade.record,
  ],
  [
    `semester_grade_versions/${performanceGrade.versionId}`,
    performanceGrade.version,
  ],
  [`semester_grade_records/${writtenGrade.recordId}`, writtenGrade.record],
  [`semester_grade_versions/${writtenGrade.versionId}`, writtenGrade.version],
  [
    `semester_wis_economies/${SEMESTER_ID}`,
    owned({
      semesterId: SEMESTER_ID,
      schemaVersion: 1,
      policyVersion: "w7-v1",
      revision: 3,
      status: "ACTIVE_OPEN",
      displayName: "W10P 위스 경제",
      currencyName: "위스",
      initialGrantAmount: 700,
      integrityVersion: "w10p-aggregate-v1",
      accountCount: 1,
      initializedAccountCount: 1,
      ledgerEntryCount: 2,
      inventoryCount: 1,
      orderCount: 1,
      unresolvedLegacyIssueCount: 0,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_wis_accounts/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      status: "ACTIVE",
      provenance: "CURRENT",
      readOnly: false,
      revision: 3,
      balance: 600,
      initialGrantLedgerEntryId: wisLedgerId,
      grade: "3",
      classNumber: "1",
      studentNumber: "1",
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      // The bounded visual projection intentionally exposes the one labelled
      // fixture row while the full ledger still attests the pending order.
      recentLedgerEntries: [wisLedgerEntry],
      cutoverPlanId: null,
      createdAt: fixedDate,
      updatedAt: oneDayLater,
      updatedBy: STUDENT_UID,
    }),
  ],
  [
    `semester_wis_balances/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      balance: 600,
      revision: 1,
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      ledgerRevision: 3,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `semester_wis_rankings/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      grade: "3",
      classNumber: "1",
      balance: 600,
      rankEarnedTotal: 700,
      ledgerRevision: 3,
      rank: 1,
      updatedAt: oneDayLater,
    }),
  ],
  [`semester_wis_ledger/${wisLedgerId}`, owned(wisLedgerEntry)],
  [
    `semester_wis_ledger/${wisOrderDebitLedgerId}`,
    owned(wisOrderDebitLedgerEntry),
  ],
  [
    `wis_product_catalog/${wisProductId}`,
    owned({
      productId: wisProductId,
      schemaVersion: 1,
      policyVersion: "w7-v1",
      revision: 1,
      name: "W10P 위스 상품",
      description: "W10P 시각 검증 상품",
      imageUrl: "",
      active: true,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_wis_inventory/${wisInventoryId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      inventoryId: wisInventoryId,
      semesterId: SEMESTER_ID,
      productId: wisProductId,
      productRevision: 1,
      productName: "W10P 위스 상품",
      revision: 2,
      price: 100,
      stock: 5,
      available: 4,
      reserved: 1,
      sold: 0,
      active: true,
      createdBy: TEACHER_UID,
      updatedBy: STUDENT_UID,
      createdAt: fixedDate,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `semester_wis_orders/${wisOrderId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      orderId: wisOrderId,
      semesterId: SEMESTER_ID,
      accountId: wisAccountId,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      inventoryId: wisInventoryId,
      productId: wisProductId,
      productName: "W10P 위스 상품",
      quantity: 1,
      unitPrice: 100,
      totalPrice: 100,
      debitLedgerEntryId: wisOrderDebitLedgerId,
      revision: 1,
      status: "REQUESTED",
      reviewReason: "",
      reviewedBy: "",
      createdAt: oneDayLater,
      reviewedAt: null,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_wallets/${STUDENT_UID}`,
    owned({
      uid: STUDENT_UID,
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      balance: 600,
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      lastTransactionAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_transactions/w10p-point-transaction`,
    owned({
      uid: STUDENT_UID,
      type: "manual_adjust",
      activityType: "manual_adjust",
      delta: 700,
      balanceAfter: 700,
      sourceId: "w10p-visual-grant",
      sourceLabel: "W10P 위스 기록",
      policyId: "current",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_products/w10p-point-product`,
    owned({
      name: "W10P 위스 상품",
      description: "W10P 시각 검증 상품",
      price: 100,
      stock: 5,
      isActive: true,
      sortOrder: 1,
      imageUrl: "",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_orders/w10p-point-order`,
    owned({
      uid: STUDENT_UID,
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      productId: "w10p-point-product",
      productName: "W10P 위스 상품",
      priceSnapshot: 100,
      status: "requested",
      stockDeducted: false,
      requestedAt: fixedDate,
      reviewedBy: "",
      memo: "",
    }),
  ],
  [
    "site_settings/developer_logs/items/w10p-visual-fixture",
    owned({
      title: "W10P 시각 검증 일지",
      version: "W10P",
      category: "improvement",
      summary: "W10P 화면 비교용 합성 개발자 일지입니다.",
      bodyHtml: "<p>W10P 시각 검증 일지 본문입니다.</p>",
      images: [],
      isPinned: true,
      viewCount: 0,
      likeCount: 0,
      createdBy: TEACHER_UID,
      createdByName: "W10P 교사",
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
]);

const overwriteDocs = new Map([
  [
    "site_settings/config",
    owned({
      year: YEAR,
      semester: SEMESTER,
      activeSemesterId: SEMESTER_ID,
      activeSemesterRevision: 1,
      semesterLifecycleStatus: "ACTIVE",
      semesterWritesEnabled: true,
      updatedAt: fixedDate,
    }),
  ],
  [
    "site_settings/semester_active",
    owned({
      semesterId: SEMESTER_ID,
      activeSemesterId: SEMESTER_ID,
      revision: 1,
      activeSemesterRevision: 1,
      previousSemesterId: null,
      activatedAt: fixedDate,
      activatedBy: ADMIN_UID,
      commandId: FIXTURE_ID,
    }),
  ],
  [
    MAINTENANCE_PATH,
    {
      enabled: false,
      blockedRoles: ["student"],
      bypassUids: [],
      title: "W10P 시각 검증 점검 안내",
      message: "W10P 시각 검증에서는 점검 모드를 사용하지 않습니다.",
      startedAt: null,
      updatedAt: fixedDate,
      updatedBy: ADMIN_UID,
      revision: 1,
    },
  ],
  [
    "site_settings/school_config",
    owned({
      schoolName: "W10P 시각 검증 학교",
      grades: [{ value: "3", label: "3학년" }],
      classes: [{ value: "1", label: "1반" }],
    }),
  ],
  [
    "site_settings/interface_config",
    owned({ hallOfFame: hallOfFameConfig, hallOfFameRevision: 1 }),
  ],
  [
    `semester_manifests/${SEMESTER_ID}`,
    owned({
      semesterId: SEMESTER_ID,
      schoolYear: YEAR,
      term: SEMESTER,
      displayName: "2026학년도 2학기",
      status: "ACTIVE",
      shellState: "CURRENT",
      startAt: "2026-08-01",
      endAt: "2027-02-28",
      revision: 1,
      stateRevision: 1,
      schemaVersion: 1,
      readinessPolicyVersion: "w3-v1",
      provenance: "CURRENT",
      blockingIssues: [],
      createdAt: fixedDate,
      createdBy: ADMIN_UID,
      updatedAt: fixedDate,
      updatedBy: ADMIN_UID,
      activatedAt: fixedDate,
      activatedBy: ADMIN_UID,
      activationCommandId: FIXTURE_ID,
      closedAt: null,
      closedBy: null,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/curriculum/tree`,
    owned({ tree: curriculumTree, updatedAt: fixedDate }),
  ],
  ["curriculum/tree", owned({ tree: curriculumTree, updatedAt: fixedDate })],
  [
    ASSESSMENT_SETTINGS_PATH,
    {
      "w10p-quiz-unit_formative": {
        active: true,
        questionCount: 1,
        randomOrder: false,
        questionOrder: "fixed",
        timeLimit: 600,
        allowRetake: true,
        cooldown: 0,
        hintLimit: 1,
        visibleTargetGrade: "3",
        visibleClassIds: ["3-1"],
        visibilityVersion: 2,
      },
    },
  ],
  [ASSESSMENT_STATUS_PATH, { "w10p-quiz-unit_formative": true }],
  [
    `years/${YEAR}/semesters/${SEMESTER}/exam_config/final_exam`,
    owned({
      schemaVersion: 1,
      policyVersion: "w10p-w6b-legacy-v1",
      academicYear: YEAR,
      semester: SEMESTER,
      revision: 1,
      objective: [{ score: 37, answer: 1 }],
      subjective: [
        { subItems: [{ score: 0, answer: "W10P 서술형 채점 기준" }] },
      ],
      releaseStatus: "RELEASED",
      releasePolicyVersion: "w6b-answer-release-v1",
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_state/current`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      semesterId: SEMESTER_ID,
      activeSessionId: "w10p-think-cloud",
      activeSessionIds: ["w10p-think-cloud"],
      revision: 1,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_state/${CLASS_ID}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      classId: CLASS_ID,
      semesterId: SEMESTER_ID,
      activeSessionId: "w10p-think-cloud",
      activeSessionIds: ["w10p-think-cloud"],
      revision: 1,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_policies/current`,
    owned({
      autoRewardEnabled: true,
      manualAdjustEnabled: true,
      allowNegativeBalance: false,
      attendanceDaily: 10,
      attendanceMonthlyBonus: 0,
      lessonView: 10,
      quizSolve: 10,
      updatedBy: TEACHER_UID,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_public/hall_of_fame`,
    owned({
      year: YEAR,
      semester: SEMESTER,
      snapshotVersion: 7,
      snapshotKey: sha256(`${FIXTURE_ID}\nhall-of-fame`).slice(0, 32),
      rankingMetric: "cumulativeEarned",
      primaryGradeKey: "3",
      gradeTop3ByGrade: {
        3: [
          {
            uid: STUDENT_UID,
            rank: 1,
            podiumSlot: 1,
            grade: "3",
            class: "1",
            classKey: "3-1",
            studentName: "W10P 학생",
            displayName: "W10P 학생",
            currentBalance: 700,
            cumulativeEarned: 700,
            profileIcon: "",
          },
        ],
      },
      classTop3ByClassKey: {
        "3-1": [
          {
            uid: STUDENT_UID,
            rank: 1,
            podiumSlot: 1,
            grade: "3",
            class: "1",
            classKey: "3-1",
            studentName: "W10P 학생",
            displayName: "W10P 학생",
            currentBalance: 700,
            cumulativeEarned: 700,
            profileIcon: "",
          },
        ],
      },
      gradeLeaderboardByGrade: {},
      classLeaderboardByClassKey: {},
      leaderboardPolicy: {
        gradeRankLimit: 10,
        classRankLimit: 10,
        includeTies: true,
        storedRankLimit: 20,
      },
      updatedAt: fixedDate,
      updatedAtMs: fixedDate.getTime(),
      sourceUpdatedAtMs: fixedDate.getTime(),
    }),
  ],
]);

const strictCollections = new Map([
  ["users", [STUDENT_UID, TEACHER_UID, ADMIN_UID]],
  ["student_identities", [STUDENT_UID]],
  [`users/${STUDENT_UID}/history_dictionary_words`, ["w10p-history-term"]],
  [`users/${TEACHER_UID}/history_dictionary_words`, []],
  [`users/${ADMIN_UID}/history_dictionary_words`, []],
  [
    `users/${STUDENT_UID}/performance_scores`,
    ["w10p-roster-performance", "w10p-roster-written"],
  ],
  [`users/${TEACHER_UID}/performance_scores`, []],
  [`users/${ADMIN_UID}/performance_scores`, []],
  [`users/${STUDENT_UID}/sessions`, []],
  [`users/${TEACHER_UID}/sessions`, []],
  [`users/${ADMIN_UID}/sessions`, []],
  ["semester_classes", [CLASS_ID]],
  ["semester_enrollments", [ENROLLMENT_ID]],
  ["semester_enrollment_slots", [slotId]],
  ["semester_learning_contents", ["w10p-learning-content"]],
  ["semester_learning_progress", []],
  ["semester_learning_exemptions", []],
  ["semester_learning_exemption_requests", []],
  ["semester_schedule_events", ["w10p-schedule-event"]],
  ["semester_attendance_sessions", ["w10p-attendance-session"]],
  ["semester_attendance_records", ["w10p-attendance-record"]],
  ["semester_attendance_revisions", []],
  ["semester_notices", ["w10p-notice"]],
  ["semester_notice_deliveries", [NOTICE_DELIVERY_ID]],
  ["semester_notice_acknowledgements", []],
  [`years/${YEAR}/semesters/${SEMESTER}/calendar`, ["w10p-schedule-event"]],
  [`years/${YEAR}/semesters/${SEMESTER}/lessons`, ["w10p-lesson"]],
  ["lessons", ["w10p-lesson"]],
  [`years/${YEAR}/semesters/${SEMESTER}/map_resources`, ["w10p-map"]],
  ["map_resources", ["w10p-map"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/history_classrooms`,
    ["w10p-history-classroom"],
  ],
  ["history_classrooms", ["w10p-history-classroom"]],
  [`years/${YEAR}/semesters/${SEMESTER}/history_classroom_results`, []],
  ["history_classroom_results", []],
  ["history_dictionary_terms", ["w10p-history-term"]],
  ["history_dictionary_requests", []],
  ["source_archive", ["w10p-source"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions`,
    ["w10p-think-cloud"],
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses`,
    ["w10p-response-1", "w10p-response-2"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/quiz_questions`, ["1"]],
  [`years/${YEAR}/semesters/${SEMESTER}/quiz_results`, ["w10p-quiz-result"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters`,
    ["w10p-roster-performance", "w10p-roster-written"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/grading_plans`, ["w10p-grading-plan"]],
  [
    "semester_grade_records",
    [performanceGrade.recordId, writtenGrade.recordId],
  ],
  [
    "semester_grade_versions",
    [performanceGrade.versionId, writtenGrade.versionId],
  ],
  ["semester_grade_requests", []],
  ["semester_grade_attestations", []],
  ["semester_assessment_attempts", []],
  ["semester_assessment_submissions", []],
  ["semester_assessment_results", []],
  ["semester_wis_economies", [SEMESTER_ID]],
  ["semester_wis_accounts", [wisAccountId]],
  ["semester_wis_balances", [wisAccountId]],
  ["semester_wis_rankings", [wisAccountId]],
  ["semester_wis_ledger", [wisLedgerId, wisOrderDebitLedgerId]],
  ["wis_product_catalog", [wisProductId]],
  ["semester_wis_inventory", [wisInventoryId]],
  ["semester_wis_orders", [wisOrderId]],
  [`years/${YEAR}/semesters/${SEMESTER}/point_wallets`, [STUDENT_UID]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_transactions`,
    ["w10p-point-transaction"],
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_products`,
    ["w10p-point-product"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/point_orders`, ["w10p-point-order"]],
  ["site_settings/developer_logs/items", ["w10p-visual-fixture"]],
]);

const gradeEvidenceHashFor = (version) =>
  sha256(
    canonicalJson({
      recordId: version.recordId,
      gradeRevision: version.gradeRevision,
      semesterId: version.semesterId,
      studentUid: version.studentUid,
      enrollmentId: version.enrollmentId,
      classId: version.classId,
      sourceKind: version.sourceKind,
      sourceId: version.sourceId,
      sourceSnapshotHash: version.sourceSnapshotHash,
      scoreKind: version.scoreKind,
      enrollmentSnapshot: version.enrollmentSnapshot,
      title: version.title,
      rubricVersion: version.rubricVersion,
      items: version.items,
      supersedesVersionId: version.supersedesVersionId || "",
    }),
  );

const assertSeedPlanIntegrity = () => {
  for (const [path, data] of createDocs) {
    assert.equal(data.fixtureOwner, FIXTURE_OWNER);
    assert.equal(data.fixtureId, FIXTURE_ID);
    const segments = path.split("/");
    const id = segments.pop();
    const collectionPath = segments.join("/");
    assert.equal(
      strictCollections.has(collectionPath),
      true,
      `Create-only collection is missing from the strict allowlist: ${collectionPath}`,
    );
    assert.equal(
      strictCollections.get(collectionPath).includes(id),
      true,
      `Create-only ID is missing from the strict allowlist: ${collectionPath}`,
    );
  }
  for (const [collectionPath, ids] of strictCollections) {
    assert.equal(
      new Set(ids).size,
      ids.length,
      `Strict allowlist contains duplicate IDs: ${collectionPath}`,
    );
    for (const id of ids) {
      assert.equal(
        createDocs.has(`${collectionPath}/${id}`),
        true,
        `Strict allowlist ID has no create-only fixture document: ${collectionPath}`,
      );
    }
  }
  assert.equal(
    [...strictCollections.values()].reduce(
      (count, ids) => count + ids.length,
      0,
    ),
    createDocs.size,
  );
  assert.ok(
    createDocs.size + overwriteDocs.size + 1 <= 400,
    "Fixture setup must fit in one bounded Firestore batch.",
  );

  for (const [path, data] of overwriteDocs) {
    if (markerlessOverwritePaths.has(path)) {
      assert.equal(Object.hasOwn(data, "fixtureOwner"), false);
      assert.equal(Object.hasOwn(data, "fixtureId"), false);
    } else {
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
    }
  }
  assert.deepEqual(
    [...markerlessOverwritePaths].sort(),
    [MAINTENANCE_PATH, ASSESSMENT_SETTINGS_PATH, ASSESSMENT_STATUS_PATH].sort(),
  );
  const maintenance = overwriteDocs.get(MAINTENANCE_PATH);
  assert.deepEqual(Object.keys(maintenance).sort(), [
    "blockedRoles",
    "bypassUids",
    "enabled",
    "message",
    "revision",
    "startedAt",
    "title",
    "updatedAt",
    "updatedBy",
  ]);
  assert.deepEqual(
    [
      maintenance.enabled,
      maintenance.blockedRoles,
      maintenance.bypassUids,
      maintenance.startedAt,
      maintenance.revision,
    ],
    [false, ["student"], [], null, 1],
  );
  assert.deepEqual(Object.keys(overwriteDocs.get(ASSESSMENT_SETTINGS_PATH)), [
    "w10p-quiz-unit_formative",
  ]);
  assert.deepEqual(Object.keys(overwriteDocs.get(ASSESSMENT_STATUS_PATH)), [
    "w10p-quiz-unit_formative",
  ]);

  const identity = createDocs.get(`student_identities/${STUDENT_UID}`);
  const semesterClass = createDocs.get(`semester_classes/${CLASS_ID}`);
  const enrollment = createDocs.get(`semester_enrollments/${ENROLLMENT_ID}`);
  const enrollmentSlot = createDocs.get(`semester_enrollment_slots/${slotId}`);
  assert.deepEqual(
    [
      identity?.studentUid,
      identity?.accountStatus,
      identity?.revision,
      identity?.provenance,
      identity?.schemaVersion,
    ],
    [STUDENT_UID, "ACTIVE", 1, "CANONICAL", 1],
  );
  assert.deepEqual(
    [
      semesterClass?.semesterId,
      semesterClass?.classKey,
      semesterClass?.status,
      semesterClass?.revision,
      semesterClass?.provenance,
      semesterClass?.schemaVersion,
    ],
    [SEMESTER_ID, "3::1", "ACTIVE", 1, "CANONICAL", 1],
  );
  assert.deepEqual(
    [
      enrollment?.studentUid,
      enrollment?.semesterId,
      enrollment?.classId,
      enrollment?.enrollmentStatus,
      enrollment?.source?.type,
      enrollment?.revision,
      enrollment?.provenance,
      enrollment?.schemaVersion,
    ],
    [
      STUDENT_UID,
      SEMESTER_ID,
      CLASS_ID,
      "ACTIVE",
      "MANUAL_EXCEPTION",
      1,
      "CANONICAL",
      1,
    ],
  );
  assert.deepEqual(
    [
      enrollmentSlot?.slotId,
      enrollmentSlot?.semesterId,
      enrollmentSlot?.studentUid,
      enrollmentSlot?.activeEnrollmentId,
      enrollmentSlot?.revision,
      enrollmentSlot?.status,
    ],
    [slotId, SEMESTER_ID, STUDENT_UID, ENROLLMENT_ID, 1, "ACTIVE"],
  );
  assert.equal(
    NOTICE_DELIVERY_ID,
    hashId("noticedel", "w10p-notice", STUDENT_UID),
  );

  for (const fixture of [performanceGrade, writtenGrade]) {
    assert.match(fixture.recordId, /^grade_[a-f0-9]{64}$/u);
    assert.match(fixture.versionId, /^gradever_[a-f0-9]{64}$/u);
    assert.equal(fixture.record.currentVersionId, fixture.versionId);
    assert.equal(fixture.version.recordId, fixture.recordId);
    assert.equal(
      fixture.version.evidenceHash,
      gradeEvidenceHashFor(fixture.version),
    );
    assert.equal(
      fixture.versionId,
      `gradever_${sha256(
        `${fixture.recordId}\n${fixture.version.gradeRevision}\n${fixture.version.evidenceHash}`,
      )}`,
    );
    assert.equal(fixture.record.evidenceHash, fixture.version.evidenceHash);
    assert.equal(fixture.record.totalScore, fixture.version.totalScore);
    assert.equal(fixture.record.totalMaxScore, fixture.version.totalMaxScore);
  }
};

assertSeedPlanIntegrity();

const plan = {
  fixtureId: FIXTURE_ID,
  fixtureRevision: FIXTURE_REVISION,
  fixtureOwner: FIXTURE_OWNER,
  fixedTime: FIXED_TIME,
  projectId: STAGING_PROJECT_ID,
  authUids: [STUDENT_UID, TEACHER_UID, ADMIN_UID].sort(),
  createDocs: [...createDocs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ),
  overwriteDocs: [...overwriteDocs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ),
  strictCollections: [...strictCollections.entries()]
    .map(([path, ids]) => [path, [...ids].sort()])
    .sort(([left], [right]) => left.localeCompare(right)),
};
const planHash = sha256(canonicalJson(plan));
const authContractRows = [
  ["student", STUDENT_UID, STUDENT_EMAIL],
  ["teacher", TEACHER_UID, TEACHER_EMAIL],
  ["admin", ADMIN_UID, ADMIN_EMAIL],
].map(([role, uid, email]) => ({
  role,
  uidHash: sha256(uid),
  emailHash: sha256(email),
}));
const authAllowedUidSetHash = sha256(
  [STUDENT_UID, TEACHER_UID, ADMIN_UID].sort().join("\n"),
);
const strictAllowlistRows = [...strictCollections.entries()].map(
  ([collectionPath, ids]) => {
    const sortedIds = [...ids].sort();
    return {
      collectionPath,
      allowIdCount: sortedIds.length,
      allowIdSetHash: sha256(sortedIds.join("\n")),
    };
  },
);
const strictAllowlistManifestHash = sha256(canonicalJson(strictAllowlistRows));

const allowedEmails = new Set([STUDENT_EMAIL, TEACHER_EMAIL, ADMIN_EMAIL]);
const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
const forbiddenPatterns = [
  /01[016789]-?\d{3,4}-?\d{4}/gu,
  /\d{6}-?[1-4]\d{6}/gu,
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/gu,
];

const collectStrings = (value, output = []) => {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value))
    value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
};

const assertPrivacySafe = (documents) => {
  const strings = documents.flatMap(([, value]) => collectStrings(value));
  const emails = strings.flatMap((value) => value.match(emailPattern) || []);
  assert.equal(
    emails.every((email) => allowedEmails.has(email.toLowerCase())),
    true,
    "Unexpected email found in fixture data.",
  );
  const forbiddenCount = strings.reduce(
    (count, value) =>
      count +
      forbiddenPatterns.reduce((matches, pattern) => {
        pattern.lastIndex = 0;
        return matches + (value.match(pattern)?.length || 0);
      }, 0),
    0,
  );
  assert.equal(
    forbiddenCount,
    0,
    "Forbidden private text found in fixture data.",
  );
  return {
    scannedStringCount: strings.length,
    observedEmailCount: emails.length,
    observedEmailSetHash: sha256(
      [...new Set(emails.map((email) => email.toLowerCase()))]
        .sort()
        .join("\n"),
    ),
    forbiddenPatternCount: 0,
  };
};

const credentialsFromEnvironment = () => {
  let credentials;
  try {
    credentials = JSON.parse(process.env.W10P_VISUAL_CREDENTIALS_JSON || "{}");
  } catch (_error) {
    assert.fail("W10P visual credentials JSON is invalid.");
  }
  const expected = {
    student: STUDENT_EMAIL,
    teacher: TEACHER_EMAIL,
    admin: ADMIN_EMAIL,
  };
  for (const [role, email] of Object.entries(expected)) {
    assert.equal(
      String(credentials?.[role]?.email || "")
        .trim()
        .toLowerCase(),
      email,
      `The ${role} fixture email does not match the fixed contract.`,
    );
    const password = String(credentials?.[role]?.password || "");
    assert.match(
      password,
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
      `The ${role} fixture password must be a strong temporary password.`,
    );
  }
  return credentials;
};

const safeResult = (suite, details = {}) => ({
  suite,
  passed: true,
  artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
  projectId: STAGING_PROJECT_ID,
  fixtureId: FIXTURE_ID,
  fixtureNamespace: FIXTURE_ID,
  fixtureRevision: FIXTURE_REVISION,
  planHash,
  ...details,
  productionAccess: 0,
  rawCredentialOutputCount: 0,
  rawPiiOutputCount: 0,
});

const dryRun = () => {
  const privacy = assertPrivacySafe([
    ...createDocs.entries(),
    ...overwriteDocs.entries(),
  ]);
  return safeResult("w10p-visual-fixture-dry-run", {
    plannedAuthUserCount: 3,
    authAllowedUidSetHash,
    authRoles: authContractRows,
    plannedCreateDocumentCount: createDocs.size,
    plannedOverwriteDocumentCount: overwriteDocs.size,
    strictCollectionCount: strictCollections.size,
    strictExpectedRowCount: [...strictCollections.values()].reduce(
      (count, ids) => count + ids.length,
      0,
    ),
    strictAllowlistManifestHash,
    strictCollections: strictAllowlistRows,
    credentialInputEnvironment: "W10P_VISUAL_CREDENTIALS_JSON",
    privacy,
    businessWrites: 0,
    adcNetworkAccess: 0,
  });
};

if (mode === "dry-run") {
  console.log(JSON.stringify(dryRun()));
  process.exit(0);
}

let app;
let auth;
let db;
let deleteAdminApp;

const initializeAdmin = () => {
  for (const emulatorVariable of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ]) {
    assert.equal(
      String(process.env[emulatorVariable] || "").trim(),
      "",
      `${emulatorVariable} must be unset for the staging fixture.`,
    );
  }
  const requireFromFunctions = createRequire(resolve("functions/package.json"));
  const { applicationDefault, deleteApp, initializeApp } =
    requireFromFunctions("firebase-admin/app");
  const { getAuth } = requireFromFunctions("firebase-admin/auth");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  deleteAdminApp = deleteApp;
  app = initializeApp(
    { credential: applicationDefault(), projectId: STAGING_PROJECT_ID },
    `w10p-visual-${sha256(`${FIXTURE_ID}\n${process.pid}`).slice(0, 12)}`,
  );
  auth = getAuth(app);
  db = getFirestore(app);
};

const getSnapshots = async (paths) => {
  const snapshots = [];
  for (let index = 0; index < paths.length; index += 100) {
    snapshots.push(
      ...(await db.getAll(
        ...paths.slice(index, index + 100).map((path) => db.doc(path)),
      )),
    );
  }
  return snapshots;
};

const writeBatches = async (operations) => {
  let writes = 0;
  for (let index = 0; index < operations.length; index += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + 400)) {
      if (operation.type === "delete") batch.delete(db.doc(operation.path));
      else batch.set(db.doc(operation.path), operation.data);
    }
    await batch.commit();
    writes += Math.min(400, operations.length - index);
  }
  return writes;
};

const assertAuthAbsent = async (uid, email) => {
  await assert.rejects(
    auth.getUser(uid),
    (error) => error?.code === "auth/user-not-found",
    "A fixed fixture Auth UID already exists.",
  );
  await assert.rejects(
    auth.getUserByEmail(email),
    (error) => error?.code === "auth/user-not-found",
    "A fixed fixture Auth email already exists.",
  );
};

const exactAuthTenantAudit = async ({ expectedSeeded }) => {
  const allowedUids = [STUDENT_UID, TEACHER_UID, ADMIN_UID].sort();
  const targetUids = expectedSeeded ? allowedUids : [];
  const cardinalityReadLimit = Math.max(1, targetUids.length + 1);
  const page = await auth.listUsers(cardinalityReadLimit);
  assert.equal(
    Boolean(page.pageToken),
    false,
    "Auth tenant exceeds the bounded fixture cardinality read.",
  );
  const actualUids = page.users.map((user) => user.uid).sort();
  const allowedSet = new Set(allowedUids);
  const actualSet = new Set(actualUids);
  assert.deepEqual(
    actualUids,
    targetUids,
    "Auth tenant cardinality differs from the fixture allowlist.",
  );
  const result = {
    allowedUidCount: allowedUids.length,
    allowedUidSetHash: sha256(allowedUids.join("\n")),
    expectedUidCount: targetUids.length,
    expectedUidSetHash: sha256(targetUids.join("\n")),
    actualUidCount: actualUids.length,
    actualUidSetHash: sha256(actualUids.join("\n")),
    extraUidCount: actualUids.filter((uid) => !allowedSet.has(uid)).length,
    missingUidCount: targetUids.filter((uid) => !actualSet.has(uid)).length,
    cardinalityReadLimit,
    pageReadCount: 1,
  };
  return {
    ...result,
    manifestHash: sha256(canonicalJson(result)),
  };
};

const deleteAuthUsers = async ({ requireOwnership }) => {
  let deleted = 0;
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    try {
      const user = await auth.getUser(uid);
      if (requireOwnership) {
        assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
        assert.equal(user.customClaims?.fixtureId, FIXTURE_ID);
      }
      await auth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return deleted;
};

const strictCollectionAudit = async ({ expectedSeeded }) => {
  const rows = [];
  for (const [collectionPath, expectedIds] of strictCollections) {
    const allowedIds = [...expectedIds].sort();
    const targetIds = expectedSeeded ? [...expectedIds].sort() : [];
    const cardinalityReadLimit = Math.max(1, targetIds.length + 1);
    const expectedSnapshots = await getSnapshots(
      targetIds.map((id) => `${collectionPath}/${id}`),
    );
    assert.equal(
      expectedSnapshots.every((snapshot) => snapshot.exists),
      true,
      `A strict fixture document is missing: ${collectionPath}`,
    );
    const snapshot = await db
      .collection(collectionPath)
      .limit(cardinalityReadLimit)
      .get();
    const actualIds = snapshot.docs.map((item) => item.id).sort();
    const targetIdSet = new Set(targetIds);
    assert.deepEqual(
      actualIds,
      targetIds,
      `Strict fixture collection cardinality mismatch: ${collectionPath}`,
    );
    rows.push({
      collectionPath,
      allowIdCount: allowedIds.length,
      allowIdSetHash: sha256(allowedIds.join("\n")),
      expectedRowCount: targetIds.length,
      expectedIdSetHash: sha256(targetIds.join("\n")),
      actualRowCount: actualIds.length,
      actualIdSetHash: sha256(actualIds.join("\n")),
      extraRowCount: actualIds.filter((id) => !targetIdSet.has(id)).length,
      cardinalityReadLimit,
      expectedDocumentReadCount: targetIds.length,
    });
  }
  return {
    collectionCount: rows.length,
    allowedRowCount: rows.reduce((count, row) => count + row.allowIdCount, 0),
    expectedRowCount: rows.reduce(
      (count, row) => count + row.expectedRowCount,
      0,
    ),
    actualRowCount: rows.reduce((count, row) => count + row.actualRowCount, 0),
    rowCount: rows.reduce((count, row) => count + row.actualRowCount, 0),
    allowlistManifestHash: sha256(
      canonicalJson(
        rows.map(({ collectionPath, allowIdCount, allowIdSetHash }) => ({
          collectionPath,
          allowIdCount,
          allowIdSetHash,
        })),
      ),
    ),
    manifestHash: sha256(canonicalJson(rows)),
    extraRowCount: rows.reduce((count, row) => count + row.extraRowCount, 0),
    collections: rows,
  };
};

const assertRoleProfiles = (snapshotsByPath) => {
  const expectedProfiles = [
    {
      uid: STUDENT_UID,
      email: STUDENT_EMAIL,
      role: "student",
      teacherPortalEnabled: false,
      permissions: [],
    },
    {
      uid: TEACHER_UID,
      email: TEACHER_EMAIL,
      role: "teacher",
      teacherPortalEnabled: true,
      permissions: [
        "lesson_read",
        "point_manage",
        "quiz_read",
        "student_list_read",
      ],
    },
    {
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      role: "teacher",
      teacherPortalEnabled: true,
      permissions: [],
    },
  ];
  for (const expected of expectedProfiles) {
    const snapshot = snapshotsByPath.get(`users/${expected.uid}`);
    assert.equal(snapshot?.exists, true, "A fixture role profile is missing.");
    const data = snapshot.data() || {};
    assert.equal(data.uid, expected.uid);
    assert.equal(String(data.email || "").toLowerCase(), expected.email);
    assert.equal(data.role, expected.role);
    assert.equal(
      data.teacherPortalEnabled === true,
      expected.teacherPortalEnabled,
    );
    assert.deepEqual(
      [...(data.staffPermissions || [])].sort(),
      [...expected.permissions].sort(),
    );
  }
};

const stableFixtureDocument = (path, value) => {
  if (!/^users\/[^/]+$/u.test(path)) return value;
  const { lastLogin: _lastLogin, photoURL: _photoURL, ...stable } = value || {};
  return stable;
};

const assertPresentationAttestation = (snapshotsByPath) => {
  const data = (path) => {
    const snapshot = snapshotsByPath.get(path);
    assert.equal(
      snapshot?.exists,
      true,
      "A presentation fixture row is missing.",
    );
    return snapshot.data() || {};
  };
  const account = data(`semester_wis_accounts/${wisAccountId}`);
  const ranking = data(`semester_wis_rankings/${wisAccountId}`);
  const order = data(`semester_wis_orders/${wisOrderId}`);
  const legacyWallet = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_wallets/${STUDENT_UID}`,
  );
  const legacyOrder = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_orders/w10p-point-order`,
  );
  const hall = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_public/hall_of_fame`,
  );

  const derivedRows = [
    ["teacher-points", account.studentUid, account.displayName],
    ["teacher-points-grant", account.studentUid, account.displayName],
    ["teacher-points-hall-of-fame", ranking.studentUid, ranking.displayName],
    ["teacher-points-requests", order.studentUid, account.displayName],
    ["legacy-teacher-points", legacyWallet.uid, legacyWallet.studentName],
    [
      "legacy-teacher-points-requests",
      legacyOrder.uid,
      legacyOrder.studentName,
    ],
  ];
  for (const [, uid, studentName] of derivedRows) {
    assert.equal(uid, STUDENT_UID);
    assert.equal(studentName, "W10P 학생");
  }
  assert.equal(order.productId, wisProductId);
  assert.equal(order.productName, "W10P 위스 상품");
  assert.equal(legacyOrder.productName, "W10P 위스 상품");

  const hallSurfaceRows = [
    ...(hall.gradeTop3ByGrade?.[3] || []).map((row) => [
      "public-hall-grade",
      row,
    ]),
    ...(hall.classTop3ByClassKey?.["3-1"] || []).map((row) => [
      "public-hall-class",
      row,
    ]),
  ];
  assert.equal(hallSurfaceRows.length, 2);
  for (const [, row] of hallSurfaceRows) {
    assert.equal(row.uid, STUDENT_UID);
    assert.equal(row.studentName, "W10P 학생");
    assert.equal(row.displayName, "W10P 학생");
  }

  const rows = [
    ...derivedRows,
    ...hallSurfaceRows.map(([surface, row]) => [
      surface,
      row.uid,
      row.studentName,
    ]),
  ].map(([surface, uid, studentName]) => ({
    surface,
    uidHash: sha256(uid),
    studentNameHash: sha256(studentName),
  }));
  return {
    teacherPointRowCount: 1,
    teacherGrantTargetCount: 1,
    teacherHallRankingCount: 1,
    teacherRequestRowCount: 1,
    legacyPointRowCount: 1,
    legacyRequestRowCount: 1,
    publicHallEntryCount: hallSurfaceRows.length,
    attestedPersonRowCount: rows.length,
    unexpectedPersonRowCount: 0,
    attestationHash: sha256(canonicalJson(rows)),
  };
};

const audit = async () => {
  const marker = await db.doc(RUN_PATH).get();
  assert.equal(
    marker.exists,
    true,
    "The visual fixture run marker is missing.",
  );
  assert.equal(marker.data()?.fixtureId, FIXTURE_ID);
  assert.equal(marker.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(marker.data()?.fixtureRevision, FIXTURE_REVISION);
  assert.equal(marker.data()?.projectId, STAGING_PROJECT_ID);
  assert.equal(marker.data()?.planHash, planHash);

  const allPaths = [...createDocs.keys(), ...overwriteDocs.keys()];
  const snapshots = await getSnapshots(allPaths);
  assert.equal(
    snapshots.every((snapshot) => snapshot.exists),
    true,
  );
  for (const snapshot of snapshots) {
    if (!markerlessOverwritePaths.has(snapshot.ref.path)) {
      assert.equal(
        snapshot.data()?.fixtureOwner,
        FIXTURE_OWNER,
        "A fixture document lost its ownership marker.",
      );
      assert.equal(snapshot.data()?.fixtureId, FIXTURE_ID);
    }
    const expected =
      createDocs.get(snapshot.ref.path) || overwriteDocs.get(snapshot.ref.path);
    assert.ok(expected, "A fixture document has no expected seed shape.");
    assert.equal(
      sha256(
        canonicalJson(
          stableFixtureDocument(snapshot.ref.path, snapshot.data()),
        ),
      ),
      sha256(canonicalJson(stableFixtureDocument(snapshot.ref.path, expected))),
      "A fixture document differs from its deterministic seed shape.",
    );
  }
  const snapshotsByPath = new Map(
    snapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
  );
  assertRoleProfiles(snapshotsByPath);
  const presentation = assertPresentationAttestation(snapshotsByPath);

  const authRows = [];
  for (const [role, uid, email] of [
    ["student", STUDENT_UID, STUDENT_EMAIL],
    ["teacher", TEACHER_UID, TEACHER_EMAIL],
    ["admin", ADMIN_UID, ADMIN_EMAIL],
  ]) {
    const user = await auth.getUser(uid);
    assert.equal(String(user.email || "").toLowerCase(), email);
    assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(user.customClaims?.fixtureId, FIXTURE_ID);
    assert.equal(user.customClaims?.fixtureRole, role);
    authRows.push({
      role,
      uidHash: sha256(uid),
      emailHash: sha256(email),
    });
  }
  assert.deepEqual(authRows, authContractRows);
  const authTenant = await exactAuthTenantAudit({ expectedSeeded: true });
  assert.equal(authTenant.allowedUidSetHash, authAllowedUidSetHash);

  const strict = await strictCollectionAudit({ expectedSeeded: true });
  assert.equal(strict.allowlistManifestHash, strictAllowlistManifestHash);
  const privacy = assertPrivacySafe(
    snapshots.map((snapshot) => [snapshot.ref.path, snapshot.data()]),
  );
  const documentProjectionHash = sha256(
    canonicalJson(
      snapshots
        .map((snapshot) => ({
          pathHash: sha256(snapshot.ref.path),
          documentHash: sha256(
            canonicalJson(
              stableFixtureDocument(snapshot.ref.path, snapshot.data()),
            ),
          ),
        }))
        .sort((left, right) => left.pathHash.localeCompare(right.pathHash)),
    ),
  );
  const authManifestHash = sha256(canonicalJson(authRows));
  const privacyAttestationHash = sha256(canonicalJson(privacy));
  const issuedAt = new Date();
  const freshness = {
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + AUDIT_MAX_AGE_SECONDS * 1_000,
    ).toISOString(),
    maxAgeSeconds: AUDIT_MAX_AGE_SECONDS,
    fixedFixtureTime: FIXED_TIME,
  };
  const captureBinding = {
    fixtureNamespace: FIXTURE_ID,
    fixtureRevision: FIXTURE_REVISION,
    projectId: STAGING_PROJECT_ID,
    planHash,
    authAllowedUidSetHash,
    authManifestHash,
    authTenantManifestHash: authTenant.manifestHash,
    fixtureDocumentCount: snapshots.length,
    documentProjectionHash,
    strictCollectionCount: strict.collectionCount,
    strictExpectedRowCount: strict.expectedRowCount,
    strictActualRowCount: strict.actualRowCount,
    strictAllowlistManifestHash: strict.allowlistManifestHash,
    strictManifestHash: strict.manifestHash,
    presentationAttestationHash: presentation.attestationHash,
    privacyAttestationHash,
    freshness,
    extraRowCount: 0,
  };

  return safeResult("w10p-visual-fixture-audit", {
    authRoleCount: authRows.length,
    authAllowedUidSetHash,
    authManifestHash,
    authRoles: authRows,
    authTenant,
    fixtureDocumentCount: snapshots.length,
    documentProjectionHash,
    strict,
    presentation,
    privacy,
    privacyAttestationHash,
    freshness,
    captureBinding,
    captureBindingHash: sha256(canonicalJson(captureBinding)),
    extraRowCount: 0,
  });
};

const setup = async () => {
  const credentials = credentialsFromEnvironment();
  assertPrivacySafe([...createDocs.entries(), ...overwriteDocs.entries()]);
  assert.equal(
    (await db.doc(RUN_PATH).get()).exists,
    false,
    "Fixture already exists.",
  );
  await strictCollectionAudit({ expectedSeeded: false });
  await exactAuthTenantAudit({ expectedSeeded: false });
  const createdSnapshots = await getSnapshots([...createDocs.keys()]);
  assert.equal(
    createdSnapshots.some((snapshot) => snapshot.exists),
    false,
    "A create-only fixture document already exists.",
  );
  for (const [uid, email] of [
    [STUDENT_UID, STUDENT_EMAIL],
    [TEACHER_UID, TEACHER_EMAIL],
    [ADMIN_UID, ADMIN_EMAIL],
  ]) {
    await assertAuthAbsent(uid, email);
  }

  const backupSnapshots = await getSnapshots([...overwriteDocs.keys()]);
  const backups = backupSnapshots.map((snapshot) => ({
    path: snapshot.ref.path,
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() : null,
    dataHash: sha256(canonicalJson(snapshot.exists ? snapshot.data() : null)),
  }));
  const createdAuthUids = [];
  let committed = false;
  try {
    for (const [role, uid, email, displayName] of [
      ["student", STUDENT_UID, STUDENT_EMAIL, "W10P 학생"],
      ["teacher", TEACHER_UID, TEACHER_EMAIL, "W10P 교사"],
      ["admin", ADMIN_UID, ADMIN_EMAIL, "W10P 관리자"],
    ]) {
      await auth.createUser({
        uid,
        email,
        displayName,
        password: String(credentials[role].password),
        emailVerified: true,
      });
      createdAuthUids.push(uid);
      await auth.setCustomUserClaims(uid, {
        fixtureOwner: FIXTURE_OWNER,
        fixtureId: FIXTURE_ID,
        fixtureRole: role,
      });
    }

    const batch = db.batch();
    for (const [path, data] of overwriteDocs) batch.set(db.doc(path), data);
    for (const [path, data] of createDocs) batch.create(db.doc(path), data);
    batch.create(
      db.doc(RUN_PATH),
      owned({
        projectId: STAGING_PROJECT_ID,
        fixtureRevision: FIXTURE_REVISION,
        status: "READY",
        planHash,
        fixedTime: FIXED_TIME,
        createdAt: fixedDate,
        backupCount: backups.length,
        backups,
        createdPathHashes: [...createDocs.keys()].map(sha256).sort(),
        overwritePathHashes: [...overwriteDocs.keys()].map(sha256).sort(),
        identityEmailHashes: [STUDENT_EMAIL, TEACHER_EMAIL, ADMIN_EMAIL]
          .map(sha256)
          .sort(),
      }),
    );
    await batch.commit();
    committed = true;
    const audited = await audit();
    return safeResult("w10p-visual-fixture-setup", {
      createdAuthUserCount: createdAuthUids.length,
      createdDocumentCount: createDocs.size,
      overwrittenDocumentCount: overwriteDocs.size,
      backupCount: backups.length,
      authTenant: audited.authTenant,
      strict: audited.strict,
      presentation: audited.presentation,
      privacy: audited.privacy,
      privacyAttestationHash: audited.privacyAttestationHash,
      freshness: audited.freshness,
      captureBinding: audited.captureBinding,
      captureBindingHash: audited.captureBindingHash,
      extraRowCount: 0,
    });
  } catch (error) {
    if (committed) {
      try {
        await cleanup({ skipPreAudit: true });
      } catch (_cleanupError) {
        // The sanitized outer error reports failure without exposing credentials
        // or snapshot contents. The retained run marker permits an explicit retry.
      }
    } else {
      for (const uid of createdAuthUids) {
        try {
          await auth.deleteUser(uid);
        } catch (rollbackError) {
          if (rollbackError?.code !== "auth/user-not-found")
            throw rollbackError;
        }
      }
    }
    throw error;
  }
};

const deleteSnapshots = async (snapshots) =>
  writeBatches(
    snapshots.map((snapshot) => ({ type: "delete", path: snapshot.ref.path })),
  );

const deleteQueryInBatches = async (query, batchSize = 200) => {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) return deleted;
    deleted += await deleteSnapshots(snapshot.docs);
  }
};

const cleanup = async ({ skipPreAudit = false } = {}) => {
  if (!skipPreAudit) await audit();
  const marker = await db.doc(RUN_PATH).get();
  assert.equal(marker.exists, true, "The fixture run marker is missing.");
  const markerData = marker.data() || {};
  assert.equal(markerData.fixtureOwner, FIXTURE_OWNER);
  assert.equal(markerData.fixtureId, FIXTURE_ID);
  assert.equal(markerData.fixtureRevision, FIXTURE_REVISION);
  assert.equal(markerData.planHash, planHash);
  const backups = Array.isArray(markerData.backups) ? markerData.backups : [];
  assert.equal(backups.length, overwriteDocs.size);
  for (const backup of backups) {
    assert.equal(overwriteDocs.has(String(backup.path || "")), true);
    assert.equal(
      sha256(canonicalJson(backup.exists ? backup.data : null)),
      backup.dataHash,
      "A singleton backup hash is invalid.",
    );
  }

  const overwriteSnapshots = await getSnapshots([...overwriteDocs.keys()]);
  for (const snapshot of overwriteSnapshots) {
    assert.equal(snapshot.exists, true, "A fixture singleton is missing.");
    if (!markerlessOverwritePaths.has(snapshot.ref.path)) {
      assert.equal(snapshot.data()?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(snapshot.data()?.fixtureId, FIXTURE_ID);
    }
    assert.equal(
      sha256(canonicalJson(snapshot.data())),
      sha256(canonicalJson(overwriteDocs.get(snapshot.ref.path))),
      "A fixture singleton changed before cleanup.",
    );
  }
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    try {
      const user = await auth.getUser(uid);
      assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(user.customClaims?.fixtureId, FIXTURE_ID);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }

  const createdPathsOutsideUserTrees = [...createDocs.keys()].filter(
    (path) =>
      !path.startsWith(`users/${STUDENT_UID}`) &&
      !path.startsWith(`users/${TEACHER_UID}`) &&
      !path.startsWith(`users/${ADMIN_UID}`),
  );
  const createdSnapshots = await getSnapshots(createdPathsOutsideUserTrees);
  for (const snapshot of createdSnapshots.filter((item) => item.exists)) {
    assert.equal(snapshot.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(snapshot.data()?.fixtureId, FIXTURE_ID);
  }

  let commandDocumentCount = 0;
  for (const collectionName of ["command_receipts", "command_audit_events"]) {
    for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
      commandDocumentCount += await deleteQueryInBatches(
        db.collection(collectionName).where("actorUid", "==", uid),
      );
    }
  }

  let auxiliaryDocumentCount = 0;
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    for (const path of [
      `application_sessions/${uid}`,
      `user_notifications/${uid}`,
    ]) {
      await db.recursiveDelete(db.doc(path));
      auxiliaryDocumentCount += 1;
    }
    await db.doc(`application_session_transitions/${uid}`).delete();
    auxiliaryDocumentCount += 1;
  }

  const deletedFixtureDocumentCount = await writeBatches(
    createdSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => ({ type: "delete", path: snapshot.ref.path })),
  );
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    const profile = await db.doc(`users/${uid}`).get();
    if (profile.exists) {
      assert.equal(profile.data()?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(profile.data()?.fixtureId, FIXTURE_ID);
    }
    await db.recursiveDelete(db.doc(`users/${uid}`));
  }

  const restoreOperations = backups.map((backup) =>
    backup.exists
      ? { type: "set", path: backup.path, data: backup.data }
      : { type: "delete", path: backup.path },
  );
  const restoredSingletonCount = await writeBatches(restoreOperations);
  const restoredSnapshots = await getSnapshots(
    backups.map((backup) => backup.path),
  );
  for (let index = 0; index < backups.length; index += 1) {
    const backup = backups[index];
    const restored = restoredSnapshots[index];
    assert.equal(restored.ref.path, backup.path);
    assert.equal(restored.exists, backup.exists);
    assert.equal(
      sha256(canonicalJson(restored.exists ? restored.data() : null)),
      backup.dataHash,
      "A singleton was not restored to its backed-up value.",
    );
  }
  const restoredBackupManifestHash = sha256(
    canonicalJson(
      backups.map((backup) => ({
        pathHash: sha256(backup.path),
        existed: backup.exists,
        dataHash: backup.dataHash,
      })),
    ),
  );
  const deletedAuthUserCount = await deleteAuthUsers({
    requireOwnership: true,
  });
  await db.doc(RUN_PATH).delete();

  const residualCreated = await getSnapshots([...createDocs.keys()]);
  assert.equal(
    residualCreated.some((snapshot) => snapshot.exists),
    false,
  );
  const strict = await strictCollectionAudit({ expectedSeeded: false });
  assert.equal(strict.allowlistManifestHash, strictAllowlistManifestHash);
  const authTenant = await exactAuthTenantAudit({ expectedSeeded: false });
  assert.equal(authTenant.allowedUidSetHash, authAllowedUidSetHash);
  for (const collectionName of ["command_receipts", "command_audit_events"]) {
    for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
      assert.equal(
        (
          await db
            .collection(collectionName)
            .where("actorUid", "==", uid)
            .limit(1)
            .get()
        ).empty,
        true,
      );
    }
  }
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    await assert.rejects(
      auth.getUser(uid),
      (error) => error?.code === "auth/user-not-found",
    );
    assert.equal(
      (
        await db
          .collection(`application_sessions/${uid}/sessions`)
          .limit(1)
          .get()
      ).empty,
      true,
    );
    for (const path of [
      `application_sessions/${uid}`,
      `application_session_transitions/${uid}`,
      `user_notifications/${uid}`,
    ]) {
      assert.equal((await db.doc(path).get()).exists, false);
    }
  }
  assert.equal((await db.doc(RUN_PATH).get()).exists, false);

  return safeResult("w10p-visual-fixture-cleanup", {
    deletedFixtureDocumentCount,
    deletedPlannedDocumentCount: createDocs.size,
    restoredSingletonCount,
    restoredBackupManifestHash,
    deletedCommandDocumentCount: commandDocumentCount,
    deletedAuxiliaryDocumentCount: auxiliaryDocumentCount,
    deletedAuthUserCount,
    residualFixtureDocumentCount: 0,
    residualAuthUserCount: 0,
    residualSessionCount: 0,
    residualCommandDocumentCount: 0,
    residualTokenCount: 0,
    authTenant,
    strict,
    extraRowCount: 0,
  });
};

try {
  initializeAdmin();
  const result =
    mode === "setup"
      ? await setup()
      : mode === "audit"
        ? await audit()
        : await cleanup();
  console.log(JSON.stringify(result));
} catch (error) {
  const errorCode = String(error?.code || error?.name || "UNKNOWN")
    .replace(/[^A-Za-z0-9_/-]/g, "")
    .slice(0, 80);
  const messageHash = sha256(String(error?.message || "unknown"));
  console.error(
    JSON.stringify({
      suite: `w10p-visual-fixture-${mode}`,
      passed: false,
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      projectId: STAGING_PROJECT_ID,
      fixtureId: FIXTURE_ID,
      fixtureNamespace: FIXTURE_ID,
      fixtureRevision: FIXTURE_REVISION,
      planHash,
      errorCode,
      errorMessageHash: messageHash,
      productionAccess: 0,
      rawCredentialOutputCount: 0,
      rawPiiOutputCount: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  if (app && deleteAdminApp) {
    try {
      await deleteAdminApp(app);
    } catch (_deleteError) {
      process.exitCode = 1;
    }
  }
}
