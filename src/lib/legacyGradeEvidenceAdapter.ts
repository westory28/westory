import {
  GRADE_EVIDENCE_STATEMENT_VERSION,
  GradeEvidenceError,
  getGradeEvidenceState,
  runLegacyGradeCommand,
  type GradeEvidenceScoreKind,
  type LegacyGradeCommandResult,
} from "./gradeEvidence";
import type { SystemConfig } from "../types";
import type {
  PerformanceScoreItem,
  PerformanceScoreRecord,
  PerformanceScoreRoster,
  PerformanceScoreSettings,
} from "./performanceScores";

export type LegacyGradeEvidenceAudience = "teacher" | "student";

export type LegacyGradeEvidenceAction =
  | "configure"
  | "save"
  | "delete"
  | "sign"
  | "request"
  | "acknowledge";

export interface LegacyGradeEvidenceHandoff {
  path: string;
  title: string;
  message: string;
}

export interface LegacyGradeEvidenceStudentProfile {
  uid: string;
  name: string;
  grade: string;
  class: string;
  number: string;
  email: string;
}

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export const LEGACY_GRADE_ATOMIC_RECORD_LIMIT = 100;

export interface LegacyGradeRecordRef {
  recordId: string;
  scoreId: string;
  expectedRevision: number;
  expectedGradeRevision: number;
  targetDetails?: string;
}

export class LegacyGradeEvidenceHandoffError extends Error {
  readonly handoff: LegacyGradeEvidenceHandoff;

  constructor(handoff: LegacyGradeEvidenceHandoff) {
    super("Legacy grade action handed off to grade evidence.");
    this.name = "LegacyGradeEvidenceHandoffError";
    this.handoff = handoff;
  }
}

export const isLegacyGradeEvidenceHandoffError = (
  error: unknown,
): error is LegacyGradeEvidenceHandoffError =>
  error instanceof LegacyGradeEvidenceHandoffError;

const getTeacherPath = (scoreKind: GradeEvidenceScoreKind) =>
  `/teacher/exam?tab=${
    scoreKind === "written_exam_essay"
      ? "evidence-written"
      : "evidence-performance"
  }`;

const getStudentPath = (scoreKind: GradeEvidenceScoreKind) =>
  `${
    scoreKind === "written_exam_essay"
      ? "/student/score/written-exam"
      : "/student/score/performance"
  }?view=evidence`;

const HANDOFF_COPY: Record<
  LegacyGradeEvidenceAction,
  Pick<LegacyGradeEvidenceHandoff, "title" | "message">
> = {
  configure: {
    title: "공식 성적 자료 화면으로 이동합니다.",
    message:
      "현재 설정은 새 성적 자료에 그대로 옮길 수 없어 저장하지 않았습니다.",
  },
  save: {
    title: "입력 내용은 아직 저장되지 않았습니다.",
    message: "공식 성적 자료 화면에서 최신 내용을 확인한 뒤 저장해 주세요.",
  },
  delete: {
    title: "자료를 삭제하지 않았습니다.",
    message: "공식 성적 자료 화면에서 최신 상태를 확인한 뒤 처리해 주세요.",
  },
  sign: {
    title: "서명 화면으로 이동합니다.",
    message: "최신 성적 내용과 확인 상태를 불러온 뒤 서명을 진행해 주세요.",
  },
  request: {
    title: "요청 처리 화면으로 이동합니다.",
    message: "최신 성적 자료에서 요청 내용을 확인한 뒤 처리해 주세요.",
  },
  acknowledge: {
    title: "성적 확인 화면으로 이동합니다.",
    message: "최신 안내와 성적 내용을 확인한 뒤 계속 진행해 주세요.",
  },
};

export const getLegacyGradeEvidenceHandoff = (input: {
  audience: LegacyGradeEvidenceAudience;
  scoreKind: GradeEvidenceScoreKind;
  action: LegacyGradeEvidenceAction;
}): LegacyGradeEvidenceHandoff => ({
  path:
    input.audience === "teacher"
      ? getTeacherPath(input.scoreKind)
      : getStudentPath(input.scoreKind),
  ...HANDOFF_COPY[input.action],
});

const readEnrollmentPart = (label: string, unit: "학년" | "반" | "번") =>
  label.match(new RegExp(`(?:^|\\s)([^\\s]+)${unit}(?:\\s|$)`, "u"))?.[1] || "";

export const loadLegacyGradeEvidenceStudentProfiles = async (input: {
  config: Pick<SystemConfig, "year" | "semester"> | null | undefined;
  scoreKind: GradeEvidenceScoreKind;
}): Promise<LegacyGradeEvidenceStudentProfile[]> => {
  const byUid = new Map<string, LegacyGradeEvidenceStudentProfile>();
  let cursor = "";
  let pageCount = 0;

  do {
    const state = await getGradeEvidenceState({
      config: input.config,
      scoreKind: input.scoreKind,
      audience: "teacher",
      ...(cursor ? { cursor } : {}),
    });
    [
      ...state.activeStudents,
      ...state.records,
      ...state.pendingSources,
    ].forEach((entry) => {
      const uid = entry.studentUid.trim();
      if (!uid) return;
      const enrollmentLabel = entry.enrollmentLabel.trim();
      const current = byUid.get(uid);
      byUid.set(uid, {
        uid,
        name: entry.studentName.trim() || current?.name || "",
        grade:
          readEnrollmentPart(enrollmentLabel, "학년") || current?.grade || "",
        class:
          readEnrollmentPart(enrollmentLabel, "반") || current?.class || "",
        number:
          readEnrollmentPart(enrollmentLabel, "번") || current?.number || "",
        email: "",
      });
    });
    cursor = state.nextCursor;
    pageCount += 1;
  } while (cursor && pageCount < 60);

  return [...byUid.values()].sort(
    (left, right) =>
      Number(left.grade || 0) - Number(right.grade || 0) ||
      Number(left.class || 0) - Number(right.class || 0) ||
      Number(left.number || 0) - Number(right.number || 0) ||
      left.name.localeCompare(right.name, "ko"),
  );
};

const compactObject = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;

const serializeLegacyItem = (item: PerformanceScoreItem) =>
  compactObject({
    name: String(item.name || "").trim(),
    shortName: String(item.shortName || "").trim(),
    itemKey: String(item.itemKey || "").trim(),
    groupKey: String(item.groupKey || "").trim(),
    groupLabel: String(item.groupLabel || "").trim(),
    examSection: item.examSection || "",
    questionNumber: item.questionNumber ?? 0,
    correctAnswer: String(item.correctAnswer || "").trim(),
    studentAnswer: String(item.studentAnswer || "").trim(),
    answerCorrect: item.answerCorrect === true,
    answerStatus: item.answerStatus || "",
    answerChoices: Array.isArray(item.answerChoices) ? item.answerChoices : [],
    feedback: String(item.feedback || "").trim(),
    score: Number(item.score || 0),
    maxScore: Number(item.maxScore || 0),
    ratio: Number(item.ratio || 0),
    scoreEntered: item.scoreEntered !== false,
  });

const loadLegacyCommandScope = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  audience: LegacyGradeEvidenceAudience;
}) => {
  const state = await getGradeEvidenceState(input);
  if (state.readOnly || !state.manifestRevision) {
    throw new GradeEvidenceError(
      "CONFLICT",
      "현재 활성 학기와 성적 자료 상태를 확인한 뒤 다시 시도해 주세요.",
      "GRADE_ACTIVE_SCOPE_REQUIRED",
    );
  }
  return {
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
  };
};

const serializeLegacyRoster = (roster: PerformanceScoreRoster) => ({
  scoreKind: roster.scoreKind || "performance",
  scoreContentKind: roster.scoreContentKind || "",
  title: roster.title,
  subject: roster.subject,
  assessmentOrder: roster.assessmentOrder ?? 0,
  targetGrade: roster.targetGrade,
  targetClass: roster.targetClass,
  classes: Array.isArray(roster.classes) ? roster.classes : [],
  items: (roster.items || []).map((item) =>
    serializeLegacyItem({
      ...item,
      score: 0,
      scoreEntered: false,
    }),
  ),
  totalMaxScore: Number(roster.totalMaxScore || 0),
  rowCount: Number(roster.rowCount || roster.rows?.length || 0),
  matchedCount: Number(roster.matchedCount || 0),
  unmatchedCount: Number(roster.unmatchedCount || 0),
  sourceFileName: roster.sourceFileName || "",
  uploadedByEmail: roster.uploadedByEmail || "",
  rows: (roster.rows || []).map((row) =>
    compactObject({
      rowNumber: Number(row.rowNumber || 0),
      uid: row.uid || "",
      grade: row.grade || "",
      class: row.class || "",
      number: row.number || "",
      studentName: row.studentName || "",
      items: (row.items || []).map(serializeLegacyItem),
      enteredScoreCount: Number(row.enteredScoreCount || 0),
      totalScore: Number(row.totalScore || 0),
      totalMaxScore: Number(row.totalMaxScore || roster.totalMaxScore || 0),
      feedback: row.feedback || "",
      evidence: row.evidence || row.feedback || "",
      matchStatus: row.matchStatus,
      matchMessage: row.matchMessage || "",
      academicStatus: row.academicStatus || "",
      isManual: row.isManual === true,
      isTransferred: row.isTransferred === true,
      transferStatus: row.transferStatus || "",
    }),
  ),
});

const serializeLegacyRecord = (record: PerformanceScoreRecord) =>
  compactObject({
    uid: record.uid,
    grade: record.grade || "",
    class: record.class || "",
    number: record.number || "",
    studentName: record.studentName || "",
    items: (record.items || []).map(serializeLegacyItem),
    enteredScoreCount: Number(record.enteredScoreCount || 0),
    totalScore: Number(record.totalScore || 0),
    totalMaxScore: Number(record.totalMaxScore || 0),
    feedback: record.feedback || "",
    evidence: record.evidence || record.feedback || "",
    academicStatus: record.academicStatus || "",
    isTransferred: record.isTransferred === true,
    transferStatus: record.transferStatus || "",
  });

const getRosterRevision = (roster: PerformanceScoreRoster) =>
  Math.max(
    0,
    Math.trunc(
      Number(
        (roster as PerformanceScoreRoster & { revision?: number }).revision ||
          0,
      ),
    ),
  );

export const saveLegacyGradeRoster = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  mode: "CREATE" | "UPDATE";
  roster: PerformanceScoreRoster;
  records: PerformanceScoreRecord[];
  relatedRosters?: PerformanceScoreRoster[];
  reason: string;
}): Promise<LegacyGradeCommandResult> => {
  const records = input.records.filter((record) => record.uid);
  if (records.length > LEGACY_GRADE_ATOMIC_RECORD_LIMIT) {
    throw new GradeEvidenceError(
      "VALIDATION",
      `한 번에 저장할 수 있는 점수 학생은 ${LEGACY_GRADE_ATOMIC_RECORD_LIMIT}명입니다. 원자적 저장을 위해 학급별 명단으로 나누어 주세요.`,
    );
  }
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("upsertLegacyGradeRoster", {
    ...scope,
    rosterId: input.roster.id,
    expectedRosterRevision:
      input.mode === "CREATE" ? 0 : getRosterRevision(input.roster),
    mode: input.mode,
    roster: serializeLegacyRoster(input.roster),
    records: records.map(serializeLegacyRecord),
    relatedRosters: (input.relatedRosters || []).map((roster) => ({
      rosterId: roster.id,
      expectedRosterRevision: getRosterRevision(roster),
      roster: serializeLegacyRoster(roster),
    })),
    reason: input.reason.trim(),
  });
};

export const deleteLegacyGradeRoster = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  roster: PerformanceScoreRoster;
  reason: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("deleteLegacyGradeRoster", {
    ...scope,
    rosterId: input.roster.id,
    expectedRosterRevision: getRosterRevision(input.roster),
    reason: input.reason.trim(),
  });
};

export const saveLegacyGradeWarningSettings = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  settings: PerformanceScoreSettings;
  reason: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("saveLegacyGradeConfig", {
    ...scope,
    configKind: "WARNING",
    configId: "performance_score",
    expectedRevision: Math.max(0, Number(input.settings.revision || 0)),
    operation: "UPSERT",
    data: {
      warningText: input.settings.warningText,
      warningVersion: input.settings.warningVersion,
      warningTextHash: input.settings.warningTextHash,
    },
    reason: input.reason.trim(),
  });
};

export const acknowledgeLegacyGradeWarning = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  settings: PerformanceScoreSettings;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "student",
  });
  return runLegacyGradeCommand("acknowledgeLegacyGradeWarning", {
    ...scope,
    warningVersion: input.settings.warningVersion,
    warningTextHash: input.settings.warningTextHash,
  });
};

const requireLegacyRecordRefs = (
  records: PerformanceScoreRecord[],
  targetDetailsByScoreId: ReadonlyMap<string, string> = new Map(),
): LegacyGradeRecordRef[] =>
  records.map((record) => {
    const scoreId = String(record.id || record.rosterId || "").trim();
    const recordId = String(record.gradeRecordId || "").trim();
    const expectedRevision = Number(record.gradeRecordRevision || 0);
    const expectedGradeRevision = Number(record.gradeRevision || 0);
    if (
      !scoreId ||
      !recordId ||
      expectedRevision < 1 ||
      expectedGradeRevision < 1
    ) {
      throw new GradeEvidenceError(
        "CONFLICT",
        "이 점수 자료는 최신 W6B 성적 명령으로 아직 전환되지 않았습니다. 담당 교사가 점수표를 다시 저장한 뒤 시도해 주세요.",
        "GRADE_LEGACY_PROJECTION_UPGRADE_REQUIRED",
      );
    }
    return {
      recordId,
      scoreId,
      expectedRevision,
      expectedGradeRevision,
      targetDetails: targetDetailsByScoreId.get(scoreId) || "",
    };
  });

export const submitLegacyGradeRequest = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  requestKind: "OBJECTION" | "ANSWER_SHEET";
  records: PerformanceScoreRecord[];
  reason: string;
  targetDetailsByScoreId?: ReadonlyMap<string, string>;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "student",
  });
  return runLegacyGradeCommand("submitLegacyGradeRequest", {
    ...scope,
    requestKind: input.requestKind,
    records: requireLegacyRecordRefs(
      input.records,
      input.targetDetailsByScoreId,
    ),
    reason: input.reason.trim(),
  });
};

export const signLegacyGradeRecords = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  records: PerformanceScoreRecord[];
  signatureName: string;
  signatureImage: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "student",
  });
  return runLegacyGradeCommand("signLegacyGradeRecords", {
    ...scope,
    records: requireLegacyRecordRefs(input.records),
    signatureName: input.signatureName.trim(),
    signatureImage: input.signatureImage,
    statementVersion: GRADE_EVIDENCE_STATEMENT_VERSION,
  });
};

export const rejectLegacyGradeSignatures = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  studentUid: string;
  records: PerformanceScoreRecord[];
  reason: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("rejectLegacyGradeSignatures", {
    ...scope,
    studentUid: input.studentUid,
    records: requireLegacyRecordRefs(input.records),
    reason: input.reason.trim(),
  });
};

export const reviewLegacyGradeRequest = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  requestId: string;
  expectedRequestRevision: number;
  resolution: "ACCEPTED" | "REJECTED" | "REVIEWED";
  changedTotalScore?: number | null;
  reviewMemo: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("reviewLegacyGradeRequest", {
    ...scope,
    requestId: input.requestId,
    expectedRequestRevision: input.expectedRequestRevision,
    resolution: input.resolution,
    changedTotalScore: input.changedTotalScore ?? null,
    reviewMemo: input.reviewMemo.trim(),
  });
};

export const saveLegacyGradeConfig = async (input: {
  config: ConfigLike;
  scoreKind: GradeEvidenceScoreKind;
  configKind: "GRADING_PLAN" | "OMR";
  configId: string;
  expectedRevision: number;
  operation: "UPSERT" | "DELETE";
  data?: Record<string, unknown>;
  reason: string;
}): Promise<LegacyGradeCommandResult> => {
  const scope = await loadLegacyCommandScope({
    config: input.config,
    scoreKind: input.scoreKind,
    audience: "teacher",
  });
  return runLegacyGradeCommand("saveLegacyGradeConfig", {
    ...scope,
    configKind: input.configKind,
    configId: input.configId,
    expectedRevision: Math.max(0, input.expectedRevision),
    operation: input.operation,
    data: input.data || {},
    reason: input.reason.trim(),
  });
};
