import { auth, getHttpsCallable } from "./firebase";
import { requiresCommandGatewayStepUpReauthentication } from "./highRiskCommands";
import {
  createHighRiskCommandFlightKey,
  createHighRiskCommandLockName,
  requestStepUpReauthentication,
  runHighRiskCommandSingleFlight,
  StepUpReauthError,
} from "./stepUpReauth";

export type W2CommandType =
  | "createTeacherPatchNote"
  | "updateTeacherPatchNote"
  | "updateTeacherPatchNoteStatus"
  | "deleteTeacherPatchNote"
  | "saveLessonDocument"
  | "saveLessonTree"
  | "prepareLessonAssetUpload"
  | "saveLessonAnswers"
  | "updateTermsSettings"
  | "addConsentItem"
  | "updateConsentItem"
  | "deleteConsentItem"
  | "syncKoreanPublicHolidays"
  | "adjustTeacherPoints"
  | "createSemesterManifest"
  | "updateSemesterManifest"
  | "updateOperationalSettings"
  | "validateSemesterReadiness"
  | "transitionSemesterStatus"
  | "activateSemester"
  | "createSemesterClass"
  | "updateSemesterClass"
  | "importEnrollmentRoster"
  | "upsertEnrollment"
  | "moveEnrollment"
  | "closeEnrollment"
  | "prepareSemesterArchive"
  | "freezeSemesterArchive"
  | "createAssessmentDefinition"
  | "updateAssessmentDefinition"
  | "transitionAssessmentDefinition"
  | "startAssessmentAttempt"
  | "submitAssessmentAttempt"
  | "resetAssessmentAttemptsByClassV2"
  | "resetAssessmentAttempt"
  | "upsertQuizQuestion"
  | "deleteQuizQuestion"
  | "upsertHistoryClassroomSource"
  | "deleteHistoryClassroomSource"
  | "updateMapResourceBlanks"
  | "createGradeDraft"
  | "reviewGradeDraft"
  | "finalizeGradeEvidence"
  | "publishOfficialGrade"
  | "correctOfficialGrade"
  | "requestGradeReview"
  | "acknowledgeGradeEvidence"
  | "signOfficialGrade"
  | "createSemesterEconomy"
  | "createWisAccounts"
  | "grantInitialWis"
  | "grantWis"
  | "deductWis"
  | "adjustWis"
  | "reverseWisEntry"
  | "rebuildWisProjection"
  | "transitionWisEconomy"
  | "upsertWisProduct"
  | "upsertWisInventory"
  | "placeWisOrder"
  | "reviewWisOrder"
  | "saveWisHallOfFameConfig"
  | "createLearningContent"
  | "updateLearningContent"
  | "transitionLearningContent"
  | "recordLearningProgress"
  | "resetLearningProgress"
  | "grantLearningExemptions"
  | "revokeLearningExemptions"
  | "requestLearningExemption"
  | "reviewLearningExemptionRequest"
  | "createScheduleEvent"
  | "updateScheduleEvent"
  | "deleteScheduleEvent"
  | "createAttendanceSession"
  | "recordAttendance"
  | "recordAttendanceBulk"
  | "correctAttendanceRecord"
  | "closeAttendanceSession"
  | "createNotice"
  | "updateNotice"
  | "transitionNotice"
  | "acknowledgeNotice"
  | "acknowledgeAllNotices"
  | "updateNotificationSettings"
  | "createThinkCloudSession"
  | "transitionThinkCloudSession"
  | "deleteThinkCloudSession"
  | "submitThinkCloudResponse"
  | "saveTeacherDraft"
  | "discardTeacherDraft"
  | "resolveTeacherDraft"
  | "cleanupExpiredTeacherDrafts"
  | "createTeacherBulkJob"
  | "reconcileTeacherBulkJob"
  | "retryTeacherBulkJob"
  | "createSemesterCutoverPlan"
  | "dryRunSemesterCutover"
  | "applySemesterCutoverBatch"
  | "verifySemesterCutover"
  | "resumeSemesterCutover"
  | "createSemesterRollbackPlan";

interface ConsentCommandItem {
  id: string;
  title: string;
  text: string;
  required: boolean;
  order: number;
  revision?: string | null;
}

interface HolidayCommandItem {
  title: string;
  start: string;
  eventType: "holiday";
  source?: string;
}

export interface TeacherDraftCommandKey {
  routeKey: string;
  surfaceKey: string;
  entityType: string;
  entityId: string;
  clientDraftId: string;
}

export interface TeacherBulkCommandItem {
  itemKey: string;
  commandType: W2CommandType;
  commandPayload: Record<string, unknown>;
  commandPayloadHash: string;
}

export interface SemesterCutoverSnapshotPayload {
  count: number;
  hash: string;
}

export interface SemesterCutoverOperationPayload {
  operationKey: string;
  operationOrder: number;
  operationType:
    | "SEMESTER_MANIFEST"
    | "SEMESTER_SETTINGS"
    | "SEMESTER_CLASSES"
    | "SEMESTER_ENROLLMENTS"
    | "ASSESSMENT_DEFINITIONS"
    | "GRADE_MASTER"
    | "LEARNING_CONTENT"
    | "SCHEDULE_EVENTS"
    | "NOTICE_TEMPLATES"
    | "WIS_CATALOG_REFERENCE"
    | "WIS_ECONOMY"
    | "WIS_ACCOUNTS";
  applicable: boolean;
  childCommandType: string | null;
  childCommandId: string | null;
  childPayloadHash: string | null;
  sourceSnapshot: SemesterCutoverSnapshotPayload;
  targetBeforeSnapshot: SemesterCutoverSnapshotPayload;
  targetAfterSnapshot: SemesterCutoverSnapshotPayload;
}

interface TeacherOperationsCommandBase {
  semesterId: string;
  expectedSemesterRevision: number;
}

export interface SemesterClassInput {
  grade: string;
  classNumber: string;
  displayName: string;
  homeroomTeacherUid: string;
}

export interface EnrollmentRosterEntryInput {
  studentUid: string;
  displayName: string;
  classKey: string;
  studentNumber: string;
}

export interface EnrollmentRosterPayload {
  semesterId: string;
  expectedSemesterRevision: number;
  rosterId: string;
  importRevision: number;
  sourceLabel: string;
  sourceHash: string;
  validationHash?: string;
  effectiveFrom: string;
  expectedStudentUids: string[];
  classes: SemesterClassInput[];
  entries: EnrollmentRosterEntryInput[];
  reason: string;
}

export interface GradeEvidenceItemInput {
  itemId: string;
  maxScore: number;
  awardedScore: number;
  evaluationKind: "AUTO" | "TEACHER";
  evidence: string;
  reason: string;
}

interface GradeCommandBase {
  semesterId: string;
  expectedSemesterRevision: number;
}

interface GradeRecordCommandBase extends GradeCommandBase {
  recordId: string;
  expectedRevision: number;
  expectedGradeRevision: number;
}

interface W8CommandBase {
  semesterId: string;
  expectedSemesterRevision: number;
}

interface LearningContentInput {
  title: string;
  summary: string;
  body: string;
  resourceUrl?: string;
  contentType: string;
  audienceRoles: string[];
  targetClassIds: string[];
  availableFrom: string;
  availableUntil: string;
}

interface ScheduleEventInput {
  eventType: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  period: string;
  targetClassIds: string[];
  targetUserIds: string[];
  sourceDomain: string;
  sourceReference: string;
}

interface AttendanceRecordInput {
  studentUid: string;
  enrollmentId: string;
  expectedRecordRevision: number | null;
  attendanceStatus: "PRESENT" | "LATE" | "ABSENT" | "EARLY_LEAVE" | "EXCUSED";
  reason: string;
}

interface NoticeInput {
  title: string;
  content: string;
  targetRoles: string[];
  targetClassIds: string[];
  targetUserIds: string[];
  publishAt: string;
  expireAt: string;
  priority: "NORMAL" | "HIGH";
}

export interface PatchNoteCommandContent {
  title: string;
  body: string;
  type: "bug" | "improvement" | "content" | "etc";
  priority: "normal" | "high";
  sourcePath: string;
  targetLabel: string;
  targetText: string;
  targetSelector: string;
  targetRect: { x: number; y: number; width: number; height: number } | null;
}

export interface PatchNoteCommandResult {
  noteId: string;
  noteRevision: number;
  status: "open" | "done" | null;
  deleted: boolean;
}

export interface W2CommandPayloads {
  createTeacherPatchNote: { content: PatchNoteCommandContent };
  updateTeacherPatchNote: {
    noteId: string;
    expectedNoteRevision: number;
    content: PatchNoteCommandContent;
  };
  updateTeacherPatchNoteStatus: {
    noteId: string;
    expectedNoteRevision: number;
    status: "open" | "done";
  };
  deleteTeacherPatchNote: { noteId: string; expectedNoteRevision: number };
  saveLessonDocument: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedRevision: number;
    unitId: string;
    document: Partial<import("./lessonData").LessonData>;
    assetUploadIds: string[];
    tree?: Array<{ id: string; title: string; children: unknown[] }>;
    expectedTreeRevision?: number;
  };
  saveLessonTree: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedRevision: number;
    tree: Array<{ id: string; title: string; children: unknown[] }>;
  };
  prepareLessonAssetUpload: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedRevision: number;
    unitId: string;
    kind: "PDF" | "PAGE" | "FOOTNOTE";
    contentType: string;
    byteSize: number;
    sha256: string;
    originalName: string;
  };
  saveLessonAnswers: {
    semesterId: string;
    unitId: string;
    expectedSemesterRevision: number;
    expectedContentRevision: number;
    expectedAnswerRevision: number;
    answers: Record<string, string>;
  };
  updateTermsSettings: { text: string };
  addConsentItem: { title: string; text: string; required: boolean };
  updateConsentItem: {
    itemId: string;
    title: string;
    text: string;
    required: boolean;
    expectedRevision: string | null;
  };
  deleteConsentItem: { itemId: string; expectedRevision: string | null };
  syncKoreanPublicHolidays: {
    year: string | number;
    semester: string | number;
    holidays: HolidayCommandItem[];
  };
  adjustTeacherPoints: {
    year: string | number;
    semester: string | number;
    uid: string;
    delta: number;
    sourceLabel: string;
    policyId?: string;
    mode: "grant" | "reclaim";
  };
  createSemesterManifest: {
    schoolYear: string;
    term: "1" | "2";
    displayName: string;
    startDate: string;
    endDate: string;
  };
  updateSemesterManifest: {
    semesterId: string;
    expectedRevision: number;
    displayName: string;
    startDate: string;
    endDate: string;
    reason: string;
  };
  updateOperationalSettings: {
    showQuiz: boolean;
    showScore: boolean;
    showLesson: boolean;
  };
  validateSemesterReadiness: {
    semesterId: string;
    expectedRevision: number;
  };
  transitionSemesterStatus: {
    semesterId: string;
    expectedRevision: number;
    targetStatus:
      | "PREPARING"
      | "VALIDATING"
      | "READY"
      | "ACTIVE"
      | "FAILED"
      | "QUARANTINED"
      | "CLOSING"
      | "CLOSED"
      | "ARCHIVED";
    reason: string;
  };
  activateSemester: {
    semesterId: string;
    expectedRevision: number;
    readinessPolicyVersion: string;
    expectedActiveSemesterId: string | null;
  };
  createSemesterClass: {
    semesterId: string;
    expectedSemesterRevision: number;
    grade: string;
    classNumber: string;
    displayName: string;
    homeroomTeacherUid: string;
    reason: string;
  };
  updateSemesterClass: {
    semesterId: string;
    classId: string;
    expectedRevision: number;
    displayName: string;
    homeroomTeacherUid: string;
    status: "ACTIVE" | "INACTIVE";
    reason: string;
  };
  importEnrollmentRoster: EnrollmentRosterPayload & { validationHash: string };
  upsertEnrollment: {
    semesterId: string;
    expectedSemesterRevision: number;
    studentUid: string;
    classId: string;
    studentNumber: string;
    displayName: string;
    effectiveFrom: string;
    sourceType: "ROSTER_IMPORT" | "MANUAL_EXCEPTION";
    sourceId: string;
    reason: string;
  };
  moveEnrollment: {
    semesterId: string;
    studentUid: string;
    activeEnrollmentId: string;
    expectedRevision: number;
    targetClassId: string;
    studentNumber: string;
    effectiveAt: string;
    reason: string;
  };
  closeEnrollment: {
    semesterId: string;
    studentUid: string;
    activeEnrollmentId: string;
    expectedRevision: number;
    targetStatus: "WITHDRAWN" | "COMPLETED";
    effectiveTo: string;
    reason: string;
  };
  prepareSemesterArchive: {
    semesterId: string;
    expectedRevision: number;
    accessPolicy: "ADMIN_ONLY";
    sourcePaths: string[];
    unresolvedLegacyItems: string[];
    reason: string;
  };
  freezeSemesterArchive: {
    semesterId: string;
    expectedRevision: number;
    expectedIntegrityHash: string;
    reason: string;
  };
  createAssessmentDefinition: {
    definitionId: string;
    semesterId: string;
    assessmentKind: "QUIZ" | "HISTORY_CLASSROOM";
    title: string;
    sourceId: string;
    category?: string;
    examRound?: string;
    questionCount?: number;
    durationSeconds: number;
    maxAttempts: number;
    cooldownMinutes: number;
    opensAt: string;
    closesAt: string;
    assignedClassIds: string[];
    legacyConfigKey?: string;
    presentationSettings?: Record<string, unknown>;
  };
  updateAssessmentDefinition: W2CommandPayloads["createAssessmentDefinition"] & {
    expectedRevision: number;
    reason: string;
  };
  transitionAssessmentDefinition: {
    definitionId: string;
    expectedRevision: number;
    targetStatus: "PUBLISHED" | "PAUSED" | "CLOSED";
    reason: string;
  };
  startAssessmentAttempt: {
    definitionId: string;
  };
  submitAssessmentAttempt: {
    attemptId: string;
    expectedRevision: number;
    answers: Record<string, string>;
    submitReason: "STUDENT" | "TIMEOUT";
  };
  resetAssessmentAttemptsByClassV2: {
    definitionId: string;
    classId: string;
    reason: string;
  };
  resetAssessmentAttempt: {
    definitionId: string;
    studentUid: string;
    reason: string;
  };
  upsertQuizQuestion: {
    semesterId: string;
    questionId: string;
    question: Record<string, unknown>;
    expectedRevision: number;
    reason: string;
  };
  deleteQuizQuestion: {
    semesterId: string;
    questionId: string;
    expectedRevision: number;
    reason: string;
  };
  upsertHistoryClassroomSource: {
    semesterId: string;
    sourceId: string;
    source: Record<string, unknown>;
    expectedRevision: number;
    reason: string;
  };
  deleteHistoryClassroomSource: {
    semesterId: string;
    sourceId: string;
    expectedRevision: number;
    reason: string;
  };
  updateMapResourceBlanks: {
    semesterId: string;
    mapResourceId: string;
    pdfBlanks: Array<Record<string, unknown>>;
    answerOptions: string[];
    expectedRevision: number;
    reason: string;
  };
  createGradeDraft: GradeCommandBase & {
    sourceKind: "ASSESSMENT_RESULT";
    attemptId: string;
    scoreKind: "performance" | "written_exam_essay";
    title: string;
    rubricVersion: string;
    reason: string;
  };
  reviewGradeDraft: GradeRecordCommandBase & {
    items: GradeEvidenceItemInput[];
    reason: string;
  };
  finalizeGradeEvidence: GradeRecordCommandBase & {
    expectedVersionId: string;
    reason: string;
  };
  publishOfficialGrade: GradeRecordCommandBase & {
    expectedVersionId: string;
    reason: string;
    signatureRequired: boolean;
  };
  correctOfficialGrade: GradeRecordCommandBase & {
    resolution: "CORRECT" | "REJECT";
    requestId?: string;
    items?: GradeEvidenceItemInput[];
    reason: string;
  };
  requestGradeReview: GradeRecordCommandBase & {
    requestKind: "OBJECTION" | "ANSWER_SHEET";
    reason: string;
  };
  acknowledgeGradeEvidence: GradeRecordCommandBase & {
    statementVersion: string;
  };
  signOfficialGrade: GradeRecordCommandBase & {
    signatureName: string;
    statementVersion: string;
  };
  createSemesterEconomy: {
    semesterId: string;
    expectedSemesterRevision: number;
    displayName: string;
    currencyName: string;
    initialGrantAmount: number;
  };
  createWisAccounts: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    enrollmentIds: string[];
    reason: string;
  };
  grantInitialWis: WisAccountValuePayload;
  grantWis: WisAccountValuePayload;
  deductWis: WisAccountValuePayload;
  adjustWis: Omit<WisAccountValuePayload, "amount"> & { delta: number };
  reverseWisEntry: WisAccountCommandBase & {
    ledgerEntryId: string;
    reason: string;
  };
  rebuildWisProjection: Omit<
    WisAccountCommandBase,
    "expectedAccountRevision"
  > & {
    accountId: string;
    reason: string;
  };
  transitionWisEconomy: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    targetStatus: "ACTIVE_OPEN" | "CLOSED" | "ARCHIVED";
    reason: string;
  };
  upsertWisProduct: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    productId?: string;
    expectedProductRevision: number | null;
    name: string;
    description: string;
    imageUrl: string;
    active: boolean;
    reason: string;
  };
  upsertWisInventory: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    productId: string;
    expectedInventoryRevision: number | null;
    price: number;
    stock: number;
    active: boolean;
    reason: string;
  };
  placeWisOrder: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    inventoryId: string;
    expectedInventoryRevision: number;
    expectedAccountRevision: number;
    quantity: number;
  };
  reviewWisOrder: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    orderId: string;
    expectedOrderRevision: number;
    action: "APPROVE" | "REJECT" | "FULFILL";
    reason: string;
  };
  saveWisHallOfFameConfig: {
    semesterId: string;
    expectedSemesterRevision: number;
    expectedEconomyRevision: number;
    expectedHallOfFameRevision: number;
    hallOfFame: {
      podiumImageUrl: string;
      podiumStoragePath: string;
      positionPreset: string;
      positions: {
        desktop: Record<
          "first" | "second" | "third",
          {
            leftPercent: number;
            topPercent: number;
            widthPercent: number;
          }
        >;
        mobile: Record<
          "first" | "second" | "third",
          {
            leftPercent: number;
            topPercent: number;
            widthPercent: number;
          }
        >;
      };
      leaderboardPanel: {
        desktop: {
          leftPercent: number;
          topPercent: number;
          widthPercent: number;
        };
        mobile: {
          leftPercent: number;
          topPercent: number;
          widthPercent: number;
        };
      };
      publicRange: {
        gradeRankLimit: number;
        classRankLimit: number;
        includeTies: boolean;
      };
      recognitionPopup: {
        enabled: boolean;
        gradeEnabled: boolean;
        classEnabled: boolean;
      };
    };
    reason: string;
  };
  createLearningContent: W8CommandBase & LearningContentInput;
  updateLearningContent: W8CommandBase &
    LearningContentInput & {
      contentId: string;
      expectedContentRevision: number;
    };
  transitionLearningContent: W8CommandBase & {
    contentId: string;
    expectedContentRevision: number;
    targetStatus: "READY" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
    reason: string;
  };
  recordLearningProgress: W8CommandBase & {
    contentId: string;
    expectedContentRevision: number;
    enrollmentId: string;
    expectedProgressRevision: number | null;
    event: "START" | "COMPLETE";
  };
  resetLearningProgress: W8CommandBase & {
    studentUid: string;
    enrollmentId: string;
    entries: Array<{
      contentId: string;
      expectedProgressRevision: number;
    }>;
    reason: string;
  };
  grantLearningExemptions: W8CommandBase & {
    contentId: string;
    expectedContentRevision: number;
    enrollmentIds: string[];
    reason: string;
  };
  revokeLearningExemptions: W8CommandBase & {
    items: Array<{
      exemptionId: string;
      expectedExemptionRevision: number;
    }>;
    reason: string;
  };
  requestLearningExemption: W8CommandBase & {
    contentId: string;
    expectedContentRevision: number;
    enrollmentId: string;
    reason: string;
  };
  reviewLearningExemptionRequest: W8CommandBase & {
    requestId: string;
    expectedRequestRevision: number;
    action: "APPROVE" | "REJECT";
    reason: string;
  };
  createScheduleEvent: W8CommandBase & ScheduleEventInput;
  updateScheduleEvent: W8CommandBase &
    ScheduleEventInput & {
      eventId: string;
      expectedEventRevision: number;
    };
  deleteScheduleEvent: W8CommandBase & {
    eventId: string;
    expectedEventRevision: number;
    reason: string;
  };
  createAttendanceSession: W8CommandBase & {
    classId: string;
    date: string;
    period: string;
    sourceEventId: string;
    expectedSourceEventRevision: number | null;
  };
  recordAttendance: W8CommandBase &
    AttendanceRecordInput & {
      sessionId: string;
      expectedSessionRevision: number;
    };
  recordAttendanceBulk: W8CommandBase & {
    sessionId: string;
    expectedSessionRevision: number;
    entries: AttendanceRecordInput[];
    reason: string;
  };
  correctAttendanceRecord: W8CommandBase & {
    recordId: string;
    expectedRecordRevision: number;
    attendanceStatus: AttendanceRecordInput["attendanceStatus"];
    reason: string;
  };
  closeAttendanceSession: W8CommandBase & {
    sessionId: string;
    expectedSessionRevision: number;
  };
  createNotice: W8CommandBase & NoticeInput;
  updateNotice: W8CommandBase &
    NoticeInput & {
      noticeId: string;
      expectedNoticeRevision: number;
    };
  transitionNotice: W8CommandBase & {
    noticeId: string;
    expectedNoticeRevision: number;
    targetStatus: "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "ARCHIVED";
  };
  acknowledgeNotice: W8CommandBase & {
    noticeId: string;
    expectedNoticeRevision: number;
  };
  acknowledgeAllNotices: W8CommandBase & {
    notices: Array<{ noticeId: string; expectedNoticeRevision: number }>;
  };
  updateNotificationSettings: W8CommandBase & {
    expectedConfigRevision: number | null;
    enabled: boolean;
    studentNotificationsEnabled: boolean;
    teacherNotificationsEnabled: boolean;
    eventPolicies: Record<string, unknown>;
  };
  createThinkCloudSession: W8CommandBase & {
    expectedStateRevision: number | null;
    title: string;
    description: string;
    targetGrade: string;
    targetClass: string;
    targetGradeLabel: string;
    targetClassLabel: string;
    options: {
      allowDuplicateWord: boolean;
      allowDuplicateByStudent: boolean;
      inputMode: "word" | "sentence";
      anonymous: boolean;
      maxLength: number;
      profanityFilter: boolean;
    };
  };
  transitionThinkCloudSession: W8CommandBase & {
    sessionId: string;
    expectedSessionRevision: number;
    expectedStateRevision: number | null;
    targetStatus: "active" | "paused" | "closed";
  };
  deleteThinkCloudSession: W8CommandBase & {
    sessionId: string;
    expectedSessionRevision: number;
    expectedStateRevision: number | null;
    reason: string;
  };
  submitThinkCloudResponse: W8CommandBase & {
    sessionId: string;
    expectedSessionRevision: number;
    textRaw: string;
    textNormalized: string;
  };
  saveTeacherDraft: TeacherOperationsCommandBase & {
    payloadSchemaVersion: number;
    key: TeacherDraftCommandKey;
    expectedDraftRevision: number | null;
    baseEntityRevision: number | null;
    basePayloadHash: string | null;
    intendedCommandType: W2CommandType;
    expectedCommandPayloadHash: string;
    payload: Record<string, unknown>;
    stagedAssets: Array<{ uploadId: string; checksum: string }>;
  };
  discardTeacherDraft: TeacherOperationsCommandBase & {
    draftId: string;
    expectedDraftRevision: number;
    reason: string;
  };
  resolveTeacherDraft: TeacherOperationsCommandBase & {
    draftId: string;
    expectedDraftRevision: number;
    canonicalCommandType: W2CommandType;
    canonicalCommandId: string;
    expectedCommandPayloadHash: string;
  };
  cleanupExpiredTeacherDrafts: TeacherOperationsCommandBase & {
    limit: number;
  };
  createTeacherBulkJob: TeacherOperationsCommandBase & {
    clientBulkId: string;
    domain:
      | "ASSESSMENT"
      | "GRADE"
      | "WIS"
      | "LEARNING"
      | "SCHEDULE"
      | "ATTENDANCE"
      | "COMMUNICATION";
    operationType: string;
    policy: "ALL_OR_NOTHING" | "ITEMIZED_PARTIAL";
    filter: Record<string, unknown>;
    items: TeacherBulkCommandItem[];
  };
  reconcileTeacherBulkJob: TeacherOperationsCommandBase & {
    jobId: string;
    expectedJobRevision: number;
    reportedFailures: Array<{
      itemKey: string;
      childCommandId: string;
      errorCode: string;
      errorReason: string;
    }>;
  };
  retryTeacherBulkJob: TeacherOperationsCommandBase & {
    jobId: string;
    expectedJobRevision: number;
    items: TeacherBulkCommandItem[];
  };
  createSemesterCutoverPlan: {
    manifestVersion: string;
    manifestHash: string;
    sourceSemesterId: string;
    targetSemesterId: string;
    sourceManifestRevision: number;
    targetManifestRevision: number;
    copyDenylist: string[];
    operations: SemesterCutoverOperationPayload[];
  };
  dryRunSemesterCutover: {
    planId: string;
    expectedPlanRevision: number;
    expectedAttemptRevision?: number;
  };
  applySemesterCutoverBatch: {
    planId: string;
    attemptId: string;
    expectedPlanRevision: number;
    expectedAttemptRevision: number;
    operationKeys: string[];
    failures?: Array<{
      operationKey: string;
      errorCode: string;
      errorReason?: string;
    }>;
  };
  verifySemesterCutover: {
    planId: string;
    attemptId: string;
    expectedPlanRevision: number;
    expectedAttemptRevision: number;
  };
  resumeSemesterCutover: {
    planId: string;
    attemptId: string;
    expectedPlanRevision: number;
    expectedAttemptRevision: number;
    operationKeys: string[];
    reason: string;
  };
  createSemesterRollbackPlan: {
    planId: string;
    attemptId: string;
    expectedPlanRevision: number;
    expectedAttemptRevision: number;
    reason: string;
  };
}

interface WisEconomyCommandBase {
  semesterId: string;
  expectedSemesterRevision: number;
  expectedEconomyRevision: number;
}

interface WisAccountCommandBase extends WisEconomyCommandBase {
  accountId: string;
  expectedAccountRevision: number;
}

interface WisAccountValuePayload extends WisAccountCommandBase {
  amount: number;
  sourceId: string;
  reason: string;
}

export interface W2CommandResults {
  createTeacherPatchNote: PatchNoteCommandResult;
  updateTeacherPatchNote: PatchNoteCommandResult;
  updateTeacherPatchNoteStatus: PatchNoteCommandResult;
  deleteTeacherPatchNote: PatchNoteCommandResult;
  saveLessonDocument: {
    unitId: string;
    contentRevision: number;
    treeRevision: number | null;
    pdfProcessing:
      | import("./lessonPdfExtraction").LessonPdfProcessingMeta
      | null;
  };
  saveLessonTree: { contentRevision: number };
  prepareLessonAssetUpload: {
    uploadId: string;
    storagePath: string;
    expiresAtMs: number;
  };
  saveLessonAnswers: {
    unitId: string;
    answers: Record<string, { value: string; status: "correct" | "wrong" }>;
    answerRevision: number;
    contentRevision: number;
    correctCount: number;
    totalCount: number;
  };
  updateTermsSettings: unknown;
  addConsentItem: { item: ConsentCommandItem; revision: string };
  updateConsentItem: { item: ConsentCommandItem; revision: string };
  deleteConsentItem: {
    itemId: string;
    revision: string;
    tombstoneRef: string;
  };
  syncKoreanPublicHolidays: { count: number };
  adjustTeacherPoints: {
    walletId: string;
    transactionId: string;
    balance: number;
    type: "manual_adjust" | "manual_reclaim";
    adapterVersion?: "legacyPointV1";
  };
  createSemesterManifest: {
    semester: unknown;
    seedCount: 6;
    seedRefs: string[];
  };
  updateSemesterManifest: {
    semester: unknown;
    readinessInvalidated: boolean;
  };
  updateOperationalSettings: {
    showQuiz: boolean;
    showScore: boolean;
    showLesson: boolean;
  };
  validateSemesterReadiness: {
    semesterId: string;
    status: "PASS" | "FAIL";
    reportId: string;
    evaluatedRevision: number;
    requiredPassed: number;
    requiredTotal: number;
  };
  transitionSemesterStatus: {
    semesterId: string;
    status:
      | "PREPARING"
      | "VALIDATING"
      | "READY"
      | "ACTIVE"
      | "FAILED"
      | "QUARANTINED"
      | "CLOSING"
      | "CLOSED"
      | "ARCHIVED";
    revision: number;
  };
  activateSemester: {
    semesterId: string;
    previousSemesterId: string | null;
    status: "ACTIVE";
    revision: number;
  };
  createSemesterClass: {
    semesterClass: Record<string, unknown>;
    readinessInvalidated: boolean;
  };
  updateSemesterClass: {
    classId: string;
    revision: number;
    status: "ACTIVE" | "INACTIVE";
    readinessInvalidated: boolean;
  };
  importEnrollmentRoster: {
    rosterId: string;
    applied: true;
    replayedImport: boolean;
    classCount: number;
    enrollmentCount: number;
    createdIdentityCount: number;
    createdEnrollmentCount: number;
    validationHash: string;
    readinessInvalidated: boolean;
  };
  upsertEnrollment: {
    enrollmentId: string;
    revision: number;
    replayedEnrollment?: boolean;
    readinessInvalidated?: boolean;
  };
  moveEnrollment: {
    previousEnrollmentId: string;
    enrollmentId: string;
    activeEnrollmentCount: 1;
    readinessInvalidated: boolean;
  };
  closeEnrollment: {
    enrollmentId: string;
    status: "WITHDRAWN" | "COMPLETED";
    activeEnrollmentCount: 0;
    readinessInvalidated: boolean;
  };
  prepareSemesterArchive: {
    semesterId: string;
    archiveStatus: "PREPARED";
    integrityHash: string;
    counts: Record<string, number>;
  };
  freezeSemesterArchive: {
    semesterId: string;
    archiveStatus: "FROZEN";
    integrityHash: string;
    counts: Record<string, number>;
  };
  createAssessmentDefinition: {
    definition: Record<string, unknown>;
  };
  updateAssessmentDefinition: {
    definitionId: string;
    status: "DRAFT" | "PUBLISHED" | "PAUSED";
    revision: number;
    sourceHash: string;
    itemCount: number;
  };
  transitionAssessmentDefinition: {
    definitionId: string;
    status: "PUBLISHED" | "PAUSED" | "CLOSED";
    revision: number;
  };
  startAssessmentAttempt: AssessmentAttemptState;
  submitAssessmentAttempt: AssessmentSubmissionResult;
  resetAssessmentAttemptsByClassV2: {
    definitionId: string;
    classId: string;
    resetCount: number;
  };
  resetAssessmentAttempt: {
    definitionId: string;
    studentUid: string;
    resetCount: number;
  };
  upsertQuizQuestion: { questionId: string; contentRevision: number };
  deleteQuizQuestion: { questionId: string; deleted: true };
  upsertHistoryClassroomSource: { sourceId: string; contentRevision: number };
  deleteHistoryClassroomSource: {
    sourceId: string;
    contentRevision: number;
    deleted: true;
  };
  updateMapResourceBlanks: {
    mapResourceId: string;
    contentRevision: number;
  };
  createGradeDraft: GradeCommandResult;
  reviewGradeDraft: GradeCommandResult;
  finalizeGradeEvidence: GradeCommandResult;
  publishOfficialGrade: GradeCommandResult;
  correctOfficialGrade: GradeCommandResult;
  requestGradeReview: GradeCommandResult;
  acknowledgeGradeEvidence: GradeCommandResult;
  signOfficialGrade: GradeCommandResult;
  createSemesterEconomy: WisCommandResult;
  createWisAccounts: WisCommandResult;
  grantInitialWis: WisCommandResult;
  grantWis: WisCommandResult;
  deductWis: WisCommandResult;
  adjustWis: WisCommandResult;
  reverseWisEntry: WisCommandResult;
  rebuildWisProjection: WisCommandResult;
  transitionWisEconomy: WisCommandResult;
  upsertWisProduct: WisCommandResult;
  upsertWisInventory: WisCommandResult;
  placeWisOrder: WisCommandResult;
  reviewWisOrder: WisCommandResult;
  saveWisHallOfFameConfig: WisCommandResult;
  createLearningContent: W8CommandResult;
  updateLearningContent: W8CommandResult;
  transitionLearningContent: W8CommandResult;
  recordLearningProgress: W8CommandResult;
  resetLearningProgress: W8CommandResult;
  grantLearningExemptions: W8CommandResult;
  revokeLearningExemptions: W8CommandResult;
  requestLearningExemption: W8CommandResult;
  reviewLearningExemptionRequest: W8CommandResult;
  createScheduleEvent: W8CommandResult;
  updateScheduleEvent: W8CommandResult;
  deleteScheduleEvent: W8CommandResult;
  createAttendanceSession: W8CommandResult;
  recordAttendance: W8CommandResult;
  recordAttendanceBulk: W8CommandResult;
  correctAttendanceRecord: W8CommandResult;
  closeAttendanceSession: W8CommandResult;
  createNotice: W8CommandResult;
  updateNotice: W8CommandResult;
  transitionNotice: W8CommandResult;
  acknowledgeNotice: W8CommandResult;
  acknowledgeAllNotices: W8CommandResult;
  updateNotificationSettings: W8CommandResult;
  createThinkCloudSession: W8CommandResult;
  transitionThinkCloudSession: W8CommandResult;
  deleteThinkCloudSession: W8CommandResult;
  submitThinkCloudResponse: W8CommandResult;
  saveTeacherDraft: TeacherOperationsCommandResult;
  discardTeacherDraft: TeacherOperationsCommandResult;
  resolveTeacherDraft: TeacherOperationsCommandResult;
  cleanupExpiredTeacherDrafts: TeacherOperationsCommandResult;
  createTeacherBulkJob: TeacherOperationsCommandResult;
  reconcileTeacherBulkJob: TeacherOperationsCommandResult;
  retryTeacherBulkJob: TeacherOperationsCommandResult;
  createSemesterCutoverPlan: SemesterCutoverCommandResult;
  dryRunSemesterCutover: SemesterCutoverCommandResult;
  applySemesterCutoverBatch: SemesterCutoverCommandResult;
  verifySemesterCutover: SemesterCutoverCommandResult;
  resumeSemesterCutover: SemesterCutoverCommandResult;
  createSemesterRollbackPlan: SemesterCutoverCommandResult;
}

export interface SemesterCutoverCommandResult {
  planId: string;
  planRevision: number;
  attemptId?: string;
  attemptRevision?: number;
  evidenceId?: string;
  rollbackPlanId?: string;
  status: string;
  operationCount?: number;
  manifestHash?: string;
  dependencyHash?: string;
  counts?: Record<string, number>;
  items?: Array<Record<string, unknown>>;
  diffs?: Array<Record<string, unknown>>;
  resumedOperationKeys?: string[];
  childCommandIds?: string[];
  successfulItemEffectCount?: 0;
  canonicalBusinessWriteCount?: 0;
  pointerMutationCount?: 0;
  activationMutationCount?: 0;
  steps?: Array<Record<string, unknown>>;
}

export interface TeacherOperationsCommandResult {
  draftId?: string;
  draftRevision?: number;
  saved?: boolean;
  payloadHash?: string;
  conflictReason?: string;
  expiresAt?: string;
  canonicalReceiptId?: string;
  expiredCount?: number;
  draftIds?: string[];
  cutoff?: string;
  canonicalMutationCount?: number;
  payloadPurged?: boolean;
  payloadPurgedCount?: number;
  jobId?: string;
  jobRevision?: number;
  status?: string;
  policy?: "ALL_OR_NOTHING" | "ITEMIZED_PARTIAL";
  filterHash?: string;
  previewHash?: string;
  itemCount?: number;
  retriedCount?: number;
  counts?: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
  };
  items?: Array<{
    itemKey: string;
    commandType?: W2CommandType;
    commandPayload?: Record<string, unknown>;
    commandPayloadHash?: string;
    attempt: number;
    childCommandId: string;
    status: "PENDING" | "SUCCEEDED" | "FAILED";
    receiptId?: string | null;
    errorCode?: string | null;
    errorReason?: string | null;
  }>;
}

export interface W8CommandResult {
  contentId?: string;
  progressId?: string;
  exemptionId?: string;
  exemptionIds?: string[];
  requestId?: string;
  eventId?: string;
  sessionId?: string;
  recordId?: string;
  revisionId?: string;
  noticeId?: string;
  acknowledgementId?: string;
  acknowledgementIds?: string[];
  contentRevision?: number;
  progressRevision?: number;
  requestRevision?: number;
  eventRevision?: number;
  sessionRevision?: number;
  recordRevision?: number;
  noticeRevision?: number;
  configRevision?: number;
  stateRevision?: number;
  responseId?: string;
  responseRevision?: number;
  resetCount?: number;
  createdCount?: number;
  revokedCount?: number;
  recordedCount?: number;
  acknowledgedCount?: number;
  deliveryCount?: number;
  acknowledged?: boolean;
  deleted?: boolean;
  status?: string;
  progressIds?: string[];
  records?: Array<{ recordId: string; recordRevision: number }>;
}

export interface WisCommandResult {
  semesterId?: string;
  accountId?: string;
  ledgerEntryId?: string;
  orderId?: string;
  productId?: string;
  inventoryId?: string;
  reportId?: string;
  revision?: number;
  accountRevision?: number;
  economyRevision?: number;
  orderRevision?: number;
  inventoryRevision?: number;
  balance?: number;
  available?: number;
  reserved?: number;
  status?: string;
  type?: string;
  createdCount?: number;
}

export interface GradeCommandResult {
  recordId: string;
  versionId?: string;
  requestId?: string | null;
  attestationId?: string;
  revision?: number;
  gradeRevision: number;
  status: string;
  evidenceHash?: string;
  signatureRequired?: boolean;
  supersedesVersionId?: string;
  replayedAttestation?: boolean;
}

export interface AssessmentAttemptState {
  attemptId: string;
  definitionId: string;
  semesterId: string;
  assessmentKind: "QUIZ" | "HISTORY_CLASSROOM";
  attemptNumber: number;
  status:
    | "STARTED"
    | "IN_PROGRESS"
    | "RECOVERABLE"
    | "SUBMITTED"
    | "EXPIRED"
    | "LOCKED";
  revision: number;
  answers: Record<string, string>;
  currentItemId: string;
  questionIds: string[];
  startedAtIso: string;
  deadlineAtIso: string;
  lastSavedAtIso: string;
  submittedAtIso: string;
  resultRef: string;
  resumed: boolean;
}

export interface AssessmentSubmissionResult {
  attemptId: string;
  status: "SUBMITTED";
  revision: number;
  score: number;
  total: number;
  percent: number;
  answerChecks: Array<{ id: string; correct: boolean }>;
  resultRef: string;
  submissionRef: string;
  replayedSubmission: boolean;
}

export type WestoryCommandClientState =
  | "pending"
  | "succeeded"
  | "failed"
  | "conflict"
  | "unauthorized"
  | "session-expired"
  | "retryable";

export class WestoryCommandError extends Error {
  readonly state: Exclude<WestoryCommandClientState, "pending" | "succeeded">;
  readonly retryable: boolean;
  readonly reason: string;
  readonly originalError?: unknown;
  readonly outcomeConfirmed: boolean;

  constructor(
    state: Exclude<WestoryCommandClientState, "pending" | "succeeded">,
    message: string,
    options: {
      retryable?: boolean;
      reason?: string;
      originalError?: unknown;
      outcomeConfirmed?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "WestoryCommandError";
    this.state = state;
    this.retryable = options.retryable ?? state === "retryable";
    this.reason = options.reason || "COMMAND_FAILED";
    this.originalError = options.originalError;
    this.outcomeConfirmed = options.outcomeConfirmed === true;
  }
}

export interface CommandGatewayResponse<
  Result = unknown,
  CommandType extends W2CommandType = W2CommandType,
> {
  commandId: string;
  commandType: CommandType;
  status: "SUCCEEDED";
  replayed: boolean;
  result: Result;
}

export type CommandStatusValue =
  | "RECEIVED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "COMPENSATION_REQUIRED"
  | "NOT_FOUND";

export interface CommandStatusResponse<
  Result = unknown,
  CommandType extends W2CommandType = W2CommandType,
> {
  commandId: string;
  commandType: CommandType;
  status: CommandStatusValue;
  replayed: boolean;
  result: Result | null;
  resultRef?: string | null;
  error?: { reason?: string; message?: string } | null;
  retryable?: boolean;
  checkpoint?: string | null;
  progress?: number | null;
  createdAt?: unknown;
  completedAt?: unknown;
}

interface ExecuteCommandRequest<CommandType extends W2CommandType> {
  commandId: string;
  commandType: CommandType;
  payload: W2CommandPayloads[CommandType];
}

interface GetCommandStatusRequest<CommandType extends W2CommandType> {
  commandId: string;
  commandType: CommandType;
}

interface PendingCommandHandle {
  schemaVersion: 2;
  projectId: string;
  ownerUid: string;
  commandType: W2CommandType;
  commandId: string;
  clientPayloadHash: string;
  requestedAtClient: string;
  lastKnownState: WestoryCommandClientState;
  lastCheckedAtClient: string;
}

const AMBIGUOUS_FUNCTION_CODES = new Set([
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/unknown",
  "functions/unavailable",
]);
const pendingCommandHandles = new Map<string, PendingCommandHandle>();

const createCommandId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("안전한 명령 ID를 만들 수 없습니다.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const getFunctionErrorDetails = (error: unknown) => {
  const raw =
    (error as { details?: unknown })?.details ??
    (error as { customData?: { details?: unknown } })?.customData?.details;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
};

const isAmbiguousFunctionError = (error: unknown) =>
  AMBIGUOUS_FUNCTION_CODES.has(
    String((error as { code?: unknown })?.code || "").toLowerCase(),
  );

const normalizeCommandError = (error: unknown): Error => {
  if (
    error instanceof StepUpReauthError ||
    error instanceof WestoryCommandError
  ) {
    return error;
  }
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  const details = getFunctionErrorDetails(error);
  const reason = String(details.reason || details.code || "COMMAND_FAILED");
  const message = String(
    (error as { message?: unknown })?.message || "명령을 처리하지 못했습니다.",
  );
  if (code === "functions/unauthenticated") {
    return new WestoryCommandError("session-expired", message, {
      reason,
      originalError: error,
    });
  }
  if (code === "functions/permission-denied") {
    const state = reason.includes("SESSION")
      ? "session-expired"
      : "unauthorized";
    return new WestoryCommandError(state, message, {
      reason,
      originalError: error,
    });
  }
  if (code === "functions/aborted" || reason.includes("CONFLICT")) {
    return new WestoryCommandError("conflict", message, {
      reason,
      originalError: error,
    });
  }
  if (isAmbiguousFunctionError(error) || details.retryable === true) {
    return new WestoryCommandError("retryable", message, {
      retryable: true,
      reason,
      originalError: error,
    });
  }
  return new WestoryCommandError("failed", message, {
    reason,
    originalError: error,
  });
};

const digestText = async (value: string) => {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (item) =>
      item.toString(16).padStart(2, "0"),
    ).join("");
  }
  return createHighRiskCommandLockName(value).split(":").pop() || "unknown";
};

const getRetryStorageKey = async (logicalCommandKey: string) =>
  `westory:pending-command:v2:${await digestText(logicalCommandKey)}`;

const readPendingCommandHandle = async (logicalCommandKey: string) => {
  const inMemory = pendingCommandHandles.get(logicalCommandKey);
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(
      await getRetryStorageKey(logicalCommandKey),
    );
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingCommandHandle>;
    if (
      parsed.schemaVersion !== 2 ||
      typeof parsed.commandId !== "string" ||
      typeof parsed.ownerUid !== "string" ||
      typeof parsed.commandType !== "string"
    ) {
      return null;
    }
    const handle = parsed as PendingCommandHandle;
    pendingCommandHandles.set(logicalCommandKey, handle);
    return handle;
  } catch {
    return null;
  }
};

const rememberPendingCommandHandle = async (
  logicalCommandKey: string,
  handle: PendingCommandHandle,
) => {
  pendingCommandHandles.set(logicalCommandKey, handle);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      await getRetryStorageKey(logicalCommandKey),
      JSON.stringify(handle),
    );
  } catch {
    // In-memory reuse still protects retries in the current page.
  }
};

const forgetPendingCommandHandle = async (
  logicalCommandKey: string,
  commandId: string,
) => {
  if (pendingCommandHandles.get(logicalCommandKey)?.commandId === commandId) {
    pendingCommandHandles.delete(logicalCommandKey);
  }
  if (typeof window === "undefined") return;
  try {
    const storageKey = await getRetryStorageKey(logicalCommandKey);
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Partial<PendingCommandHandle>;
    if (parsed.commandId === commandId)
      window.localStorage.removeItem(storageKey);
  } catch {
    // A stale browser entry is safe: the server receipt still fences replay.
  }
};

const createPendingCommandHandle = async <CommandType extends W2CommandType>(
  commandType: CommandType,
  ownerUid: string,
  logicalCommandKey: string,
  commandId = createCommandId(),
): Promise<PendingCommandHandle> => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    projectId: String(auth.app.options.projectId || ""),
    ownerUid,
    commandType,
    commandId,
    clientPayloadHash: await digestText(logicalCommandKey),
    requestedAtClient: now,
    lastKnownState: "pending",
    lastCheckedAtClient: now,
  };
};

const fetchCommandStatus = async <CommandType extends W2CommandType>(
  commandId: string,
  commandType: CommandType,
  ownerUid: string,
) => {
  const getStatus = await getHttpsCallable<
    GetCommandStatusRequest<CommandType>,
    CommandStatusResponse<W2CommandResults[CommandType], CommandType>
  >("getCommandStatus", { expectedUid: ownerUid });
  const response = await getStatus({ commandId, commandType });
  assertCommandOwner(ownerUid);
  return response.data;
};

const assertCommandOwner = (ownerUid: string) => {
  if (!ownerUid || auth.currentUser?.uid !== ownerUid)
    throw new StepUpReauthError(
      "IDENTITY_CHANGED",
      "로그인 사용자가 바뀌어 작업 결과를 적용하지 않았습니다.",
    );
};

const recoverCommittedCommand = async <CommandType extends W2CommandType>(
  commandId: string,
  commandType: CommandType,
  ownerUid: string,
) => {
  const status = await fetchCommandStatus(commandId, commandType, ownerUid);
  if (status.status === "SUCCEEDED") {
    return status as CommandGatewayResponse<
      W2CommandResults[CommandType],
      CommandType
    >;
  }
  if (status.status === "RECEIVED" || status.status === "RUNNING") {
    throw new WestoryCommandError("retryable", "명령을 처리하고 있습니다.", {
      retryable: true,
      reason: `COMMAND_${status.status}`,
    });
  }
  const retryable = Boolean(status.retryable || status.status === "NOT_FOUND");
  throw new WestoryCommandError(
    retryable ? "retryable" : "failed",
    status.error?.message || "명령 처리 결과를 아직 확인할 수 없습니다.",
    {
      retryable,
      reason: status.error?.reason || `COMMAND_${status.status}`,
    },
  );
};

export const executeWestoryCommand = async <CommandType extends W2CommandType>(
  commandType: CommandType,
  payload: W2CommandPayloads[CommandType],
  options: { commandId?: string; expectedUid?: string } = {},
): Promise<
  CommandGatewayResponse<W2CommandResults[CommandType], CommandType>
> => {
  const ownerUid = options.expectedUid ?? auth.currentUser?.uid ?? "";
  if (!ownerUid) {
    throw new StepUpReauthError(
      "UNAUTHENTICATED",
      "로그인 사용자를 확인할 수 없어 작업을 실행하지 않았습니다.",
    );
  }
  assertCommandOwner(ownerUid);
  const logicalCommandKey = createHighRiskCommandFlightKey(
    commandType,
    payload,
    ownerUid,
  );

  return runHighRiskCommandSingleFlight(
    commandType,
    payload,
    async () => {
      const storedHandle = await readPendingCommandHandle(logicalCommandKey);
      const handle =
        options.commandId && storedHandle?.commandId !== options.commandId
          ? await createPendingCommandHandle(
              commandType,
              ownerUid,
              logicalCommandKey,
              options.commandId,
            )
          : storedHandle ||
            (await createPendingCommandHandle(
              commandType,
              ownerUid,
              logicalCommandKey,
              options.commandId,
            ));
      await rememberPendingCommandHandle(logicalCommandKey, handle);

      try {
        if (requiresCommandGatewayStepUpReauthentication(commandType)) {
          await requestStepUpReauthentication(commandType);
        }
        if (auth.currentUser?.uid !== ownerUid) {
          throw new StepUpReauthError(
            "IDENTITY_CHANGED",
            "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
          );
        }

        const execute = await getHttpsCallable<
          ExecuteCommandRequest<CommandType>,
          CommandGatewayResponse<W2CommandResults[CommandType], CommandType>
        >("executeCommand", { expectedUid: ownerUid });
        try {
          const response = await execute({
            commandId: handle.commandId,
            commandType,
            payload,
          });
          assertCommandOwner(ownerUid);
          await forgetPendingCommandHandle(logicalCommandKey, handle.commandId);
          assertCommandOwner(ownerUid);
          return response.data;
        } catch (error) {
          if (!isAmbiguousFunctionError(error)) throw error;
          try {
            const recovered = await recoverCommittedCommand(
              handle.commandId,
              commandType,
              ownerUid,
            );
            await forgetPendingCommandHandle(
              logicalCommandKey,
              handle.commandId,
            );
            assertCommandOwner(ownerUid);
            return recovered;
          } catch {
            // Preserve this handle so a later user-initiated retry cannot
            // duplicate a command whose commit result is still unknown.
            throw error;
          }
        }
      } catch (error) {
        const normalized = normalizeCommandError(error);
        // These adapter failures occur after the transaction finds no receipt.
        // Its original revision can no longer commit after a change/deletion.
        const ownerChanged = auth.currentUser?.uid !== ownerUid;
        const confirmedRevisionRejection =
          !ownerChanged &&
          normalized instanceof WestoryCommandError &&
          (["PATCH_NOTE_CONFLICT", "PATCH_NOTE_NOT_FOUND"].includes(
            normalized.reason,
          ) ||
            (commandType === "saveLessonAnswers" &&
              normalized.reason === "LESSON_ANSWER_CONFLICT"));
        // A denial on a later attempt happens before receipt lookup and cannot
        // disprove an earlier commit. Keep its ID through reauthentication.
        if (
          !confirmedRevisionRejection &&
          (ownerChanged ||
            storedHandle ||
            isAmbiguousFunctionError(error) ||
            (normalized instanceof WestoryCommandError && normalized.retryable))
        ) {
          await rememberPendingCommandHandle(logicalCommandKey, {
            ...handle,
            lastKnownState: "retryable",
            lastCheckedAtClient: new Date().toISOString(),
          });
          throw new WestoryCommandError("retryable", normalized.message, {
            retryable: true,
            reason: "COMMAND_OUTCOME_UNCONFIRMED",
            originalError: error,
          });
        } else {
          await forgetPendingCommandHandle(logicalCommandKey, handle.commandId);
        }
        if (confirmedRevisionRejection)
          throw new WestoryCommandError(normalized.state, normalized.message, {
            reason: normalized.reason,
            outcomeConfirmed: true,
            originalError: error,
          });
        throw normalized;
      }
    },
    ownerUid,
  );
};

export const getWestoryCommandStatus = async <
  CommandType extends W2CommandType,
>(
  commandId: string,
  commandType: CommandType,
) => {
  const ownerUid = auth.currentUser?.uid || "";
  assertCommandOwner(ownerUid);
  if (requiresCommandGatewayStepUpReauthentication(commandType)) {
    await requestStepUpReauthentication(commandType);
  }
  return fetchCommandStatus(commandId, commandType, ownerUid);
};
