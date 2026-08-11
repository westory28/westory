import { getHttpsCallable } from "./firebase";
import { executeWestoryCommand } from "./commandGateway";
import { getYearSemester } from "./semesterScope";
import type { SystemConfig } from "../types";

export type GradeEvidenceScoreKind = "performance" | "written_exam_essay";

export type GradeEvidenceAudience = "student" | "teacher";

export type GradeEvidenceProvenance = "CURRENT" | "ARCHIVE" | "LEGACY";

export type GradeEvidenceLifecycleStatus =
  | "DRAFT"
  | "AUTO_EVALUATED_UNOFFICIAL"
  | "TEACHER_REVIEW_REQUIRED"
  | "REVIEWED"
  | "EVIDENCE_LOCKED"
  | "OFFICIAL_PENDING_SIGNATURE"
  | "OFFICIAL"
  | "CORRECTED"
  | "UNKNOWN";

export type GradeEvidenceRequestStatus =
  | "PENDING"
  | "REQUESTED"
  | "IN_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "RESOLVED"
  | "UNKNOWN";

export interface GradeEvidenceItem {
  id: string;
  label: string;
  score: number | null;
  maxScore: number | null;
  summary: string;
  sourceType: string;
  sourceRef: string;
  studentAnswer: string;
  autoCorrect: boolean | null;
}

export interface GradeEvidenceReviewRequest {
  id: string;
  versionId: string;
  gradeRevision: number;
  status: GradeEvidenceRequestStatus;
  reason: string;
  response: string;
  createdAt: string;
  resolvedAt: string;
}

export interface GradeEvidenceAttestation {
  id: string;
  kind: "ACKNOWLEDGEMENT" | "SIGNATURE" | "UNKNOWN";
  signerName: string;
  signedAt: string;
  versionId: string;
  gradeRevision: number;
}

export interface GradeEvidenceRecord {
  headId: string;
  versionId: string;
  revision: number;
  gradeRevision: number;
  scoreKind: GradeEvidenceScoreKind;
  status: GradeEvidenceLifecycleStatus;
  provenance: GradeEvidenceProvenance;
  readOnly: boolean;
  title: string;
  assessmentLabel: string;
  studentUid: string;
  studentName: string;
  enrollmentLabel: string;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  evidence: GradeEvidenceItem[];
  requests: GradeEvidenceReviewRequest[];
  attestations: GradeEvidenceAttestation[];
  reviewedAt: string;
  publishedAt: string;
  updatedAt: string;
}

export interface GradeEvidenceState {
  year: string;
  semester: string;
  semesterId: string;
  provenance: GradeEvidenceProvenance;
  readOnly: boolean;
  manifestRevision: number | null;
  pendingSources: GradeDraftCandidate[];
  records: GradeEvidenceRecord[];
  nextCursor: string;
}

export interface GradeDraftCandidate {
  attemptId: string;
  definitionId: string;
  definitionRevision: number;
  title: string;
  scoreKind: GradeEvidenceScoreKind;
  studentUid: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  enrollmentLabel: string;
  sourceHash: string;
  submittedAtIso: string;
  provenance: GradeEvidenceProvenance;
  readOnly: boolean;
}

export type GradeEvidenceErrorKind =
  | "PERMISSION"
  | "SESSION_EXPIRED"
  | "VALIDATION"
  | "CONFLICT"
  | "NETWORK"
  | "UNKNOWN";

export class GradeEvidenceError extends Error {
  readonly kind: GradeEvidenceErrorKind;
  readonly code: string;

  constructor(kind: GradeEvidenceErrorKind, message: string, code = "") {
    super(message);
    this.name = "GradeEvidenceError";
    this.kind = kind;
    this.code = code;
  }
}

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type JsonRecord = Record<string, unknown>;

const STUDENT_VISIBLE_STATES = new Set<GradeEvidenceLifecycleStatus>([
  "OFFICIAL_PENDING_SIGNATURE",
  "OFFICIAL",
  "CORRECTED",
]);

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readString = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const readNumber = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
};

const readTimestamp = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    const record = asRecord(value);
    const seconds = readNumber(record, "seconds", "_seconds");
    if (seconds !== null) return new Date(seconds * 1000).toISOString();
  }
  return "";
};

const withUnit = (value: string, unit: string) =>
  !value ? "" : value.endsWith(unit) ? value : `${value}${unit}`;

const normalizeScoreKind = (value: unknown): GradeEvidenceScoreKind =>
  String(value || "").toLowerCase() === "written_exam_essay"
    ? "written_exam_essay"
    : "performance";

const normalizeProvenance = (value: unknown): GradeEvidenceProvenance => {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "ARCHIVE" || normalized === "LEGACY") return normalized;
  return "CURRENT";
};

const normalizeLifecycleStatus = (
  value: unknown,
): GradeEvidenceLifecycleStatus => {
  const normalized = String(value || "").toUpperCase();
  switch (normalized) {
    case "DRAFT":
    case "AUTO_EVALUATED_UNOFFICIAL":
    case "TEACHER_REVIEW_REQUIRED":
    case "REVIEWED":
    case "EVIDENCE_LOCKED":
    case "OFFICIAL_PENDING_SIGNATURE":
    case "OFFICIAL":
    case "CORRECTED":
      return normalized;
    default:
      return "UNKNOWN";
  }
};

const normalizeRequestStatus = (value: unknown): GradeEvidenceRequestStatus => {
  const normalized = String(value || "").toUpperCase();
  switch (normalized) {
    case "REQUESTED":
    case "PENDING":
    case "IN_REVIEW":
    case "ACCEPTED":
    case "REJECTED":
    case "RESOLVED":
      return normalized;
    default:
      return "UNKNOWN";
  }
};

const normalizeEvidenceItem = (
  rawValue: unknown,
  index: number,
): GradeEvidenceItem => {
  const raw = asRecord(rawValue);
  return {
    id: readString(raw, "id", "evidenceId", "itemId") || `evidence-${index}`,
    label:
      readString(raw, "label", "title", "itemLabel", "questionLabel") ||
      `근거 ${index + 1}`,
    score: readNumber(raw, "score", "awardedScore", "points"),
    maxScore: readNumber(raw, "maxScore", "total", "possibleScore"),
    summary: readString(
      raw,
      "summary",
      "feedback",
      "evidence",
      "reason",
      "description",
    ),
    sourceType: readString(raw, "sourceType", "evaluationKind", "type", "kind"),
    sourceRef: readString(raw, "sourceRef", "submissionRef", "resultRef"),
    studentAnswer: "",
    autoCorrect: null,
  };
};

const normalizeRequest = (
  rawValue: unknown,
  index: number,
): GradeEvidenceReviewRequest => {
  const raw = asRecord(rawValue);
  return {
    id: readString(raw, "id", "requestId") || `request-${index}`,
    versionId: readString(raw, "versionId"),
    gradeRevision: Math.max(
      0,
      Math.trunc(readNumber(raw, "gradeRevision") || 0),
    ),
    status: normalizeRequestStatus(raw.status),
    reason: readString(raw, "reason", "requestReason", "message"),
    response: readString(raw, "response", "resolution", "reviewMemo"),
    createdAt: readTimestamp(raw, "createdAtIso", "createdAt", "requestedAt"),
    resolvedAt: readTimestamp(raw, "resolvedAtIso", "resolvedAt", "reviewedAt"),
  };
};

const normalizeAttestation = (
  rawValue: unknown,
  index: number,
): GradeEvidenceAttestation => {
  const raw = asRecord(rawValue);
  const rawKind = readString(raw, "kind", "type").toUpperCase();
  return {
    id: readString(raw, "id", "attestationId") || `attestation-${index}`,
    kind:
      rawKind === "ACKNOWLEDGEMENT" || rawKind === "SIGNATURE"
        ? rawKind
        : "UNKNOWN",
    signerName: readString(
      raw,
      "signatureName",
      "signerName",
      "actorName",
      "studentName",
    ),
    signedAt: readTimestamp(raw, "signedAtIso", "signedAt", "createdAt"),
    versionId: readString(raw, "versionId", "gradeVersionId"),
    gradeRevision: Math.max(
      0,
      Math.trunc(readNumber(raw, "gradeRevision") || 0),
    ),
  };
};

const collectRawRecords = (raw: JsonRecord): unknown[] => {
  for (const key of [
    "records",
    "items",
    "heads",
    "grades",
    "queue",
    "gradeRecords",
  ]) {
    const values = asArray(raw[key]);
    if (values.length > 0) return values;
  }
  if (raw.detail) return [raw.detail];
  if (raw.record || raw.head || raw.version || raw.grade)
    return [raw.record || raw];
  return [];
};

const normalizeRecord = (
  rawValue: unknown,
  fallbackProvenance: GradeEvidenceProvenance,
): GradeEvidenceRecord => {
  const container = asRecord(rawValue);
  const head = {
    ...container,
    ...asRecord(container.record),
    ...asRecord(container.head),
  };
  const version = {
    ...container,
    ...asRecord(container.version),
    ...asRecord(container.currentVersion),
    ...asRecord(container.grade),
  };
  const student = asRecord(
    container.student ||
      head.student ||
      version.student ||
      head.enrollmentSnapshot ||
      version.enrollmentSnapshot,
  );
  const sourceEvidence = asRecord(
    container.sourceEvidence || version.sourceEvidence,
  );
  const submittedAnswers = asRecord(sourceEvidence.answers);
  const answerCheckByItemId = new Map(
    asArray(sourceEvidence.answerChecks)
      .map((value) => asRecord(value))
      .map((check) => [readString(check, "itemId", "id"), check] as const)
      .filter(([itemId]) => Boolean(itemId)),
  );
  const evidenceSource = asArray(version.items || container.items);
  const requestsSource = container.requests || version.requests;
  const attestationsSource = container.attestations || version.attestations;
  const score = readNumber(version, "score", "totalScore", "officialScore");
  const maxScore = readNumber(
    version,
    "maxScore",
    "totalMaxScore",
    "total",
    "possibleScore",
  );
  const explicitPercent = readNumber(version, "percent", "percentage");
  const provenance = normalizeProvenance(
    head.provenance || version.provenance || fallbackProvenance,
  );

  return {
    headId: readString(head, "recordId", "headId", "id", "gradeId"),
    versionId: readString(
      version,
      "currentVersionId",
      "versionId",
      "id",
      "gradeVersionId",
    ),
    revision: Math.max(
      0,
      Math.trunc(readNumber(head, "revision", "currentRevision") || 0),
    ),
    gradeRevision: Math.max(
      0,
      Math.trunc(readNumber(head, "gradeRevision") || 0),
    ),
    scoreKind: normalizeScoreKind(
      head.scoreKind || head.assessmentKind || version.scoreKind,
    ),
    status: normalizeLifecycleStatus(head.status || version.status),
    provenance,
    readOnly:
      provenance !== "CURRENT" ||
      head.readOnly === true ||
      version.readOnly === true,
    title:
      readString(version, "title", "assessmentTitle", "name") ||
      readString(head, "title", "assessmentTitle", "name") ||
      "성적 근거",
    assessmentLabel: readString(
      version,
      "assessmentLabel",
      "definitionLabel",
      "categoryLabel",
    ),
    studentUid:
      readString(student, "uid", "studentUid") ||
      readString(head, "studentUid"),
    studentName:
      readString(student, "displayName", "name", "studentName") ||
      readString(head, "studentName"),
    enrollmentLabel:
      readString(student, "enrollmentLabel", "classLabel") ||
      readString(head, "enrollmentLabel", "classLabel") ||
      [
        withUnit(readString(student, "grade"), "학년"),
        withUnit(readString(student, "classDisplayName", "classNumber"), "반"),
        withUnit(readString(student, "studentNumber"), "번"),
      ]
        .filter(Boolean)
        .join(" "),
    score,
    maxScore,
    percent:
      explicitPercent ??
      (score !== null && maxScore !== null && maxScore > 0
        ? (score / maxScore) * 100
        : null),
    evidence: evidenceSource.map((value, index) => {
      const item = normalizeEvidenceItem(value, index);
      const answerValue = submittedAnswers[item.id];
      const answerCheck = answerCheckByItemId.get(item.id);
      return {
        ...item,
        studentAnswer:
          typeof answerValue === "string"
            ? answerValue.slice(0, 2_000)
            : typeof answerValue === "number" ||
                typeof answerValue === "boolean"
              ? String(answerValue)
              : "",
        autoCorrect: answerCheck ? answerCheck.correct === true : null,
      };
    }),
    requests: asArray(requestsSource).map(normalizeRequest),
    attestations: asArray(attestationsSource).map(normalizeAttestation),
    reviewedAt: readTimestamp(version, "reviewedAtIso", "reviewedAt"),
    publishedAt: readTimestamp(version, "publishedAtIso", "publishedAt"),
    updatedAt: readTimestamp(version, "updatedAtIso", "updatedAt", "createdAt"),
  };
};

const mapCallableError = (error: unknown): GradeEvidenceError => {
  const raw = asRecord(error);
  const code = String(raw.code || "").toLowerCase();
  const commandState = String(raw.state || "").toLowerCase();
  const rawMessage = String(raw.message || "").trim();
  if (code.includes("permission-denied") || commandState === "unauthorized") {
    return new GradeEvidenceError(
      "PERMISSION",
      "이 성적 자료를 볼 권한이 없습니다.",
      code,
    );
  }
  if (code.includes("unauthenticated") || commandState === "session-expired") {
    return new GradeEvidenceError(
      "SESSION_EXPIRED",
      "로그인 상태를 다시 확인해 주세요.",
      code,
    );
  }
  if (
    code.includes("invalid-argument") ||
    code.includes("failed-precondition")
  ) {
    return new GradeEvidenceError(
      "VALIDATION",
      rawMessage || "요청 내용을 다시 확인해 주세요.",
      code,
    );
  }
  if (
    code.includes("aborted") ||
    code.includes("already-exists") ||
    commandState === "conflict"
  ) {
    return new GradeEvidenceError(
      "CONFLICT",
      "다른 변경이 먼저 반영되었습니다. 최신 상태를 다시 불러와 주세요.",
      code,
    );
  }
  if (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    commandState === "retryable"
  ) {
    return new GradeEvidenceError(
      "NETWORK",
      "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
      code,
    );
  }
  return new GradeEvidenceError(
    "UNKNOWN",
    rawMessage || "성적 자료를 처리하지 못했습니다.",
    code,
  );
};

export interface GetGradeEvidenceStateInput {
  config: ConfigLike;
  semesterId?: string;
  scoreKind: GradeEvidenceScoreKind;
  audience: GradeEvidenceAudience;
  provenance?: GradeEvidenceProvenance;
  cursor?: string;
}

export const getGradeEvidenceState = async (
  input: GetGradeEvidenceStateInput,
): Promise<GradeEvidenceState> => {
  const { year, semester } = getYearSemester(input.config);
  try {
    const activeSemesterId = `${year}-${String(semester)}`;
    const explicitSemesterId = String(input.semesterId || "").trim();
    if (explicitSemesterId && !/^\d{4}-[12]$/.test(explicitSemesterId)) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "조회할 학기 범위가 올바르지 않습니다.",
      );
    }
    const source: GradeEvidenceProvenance =
      input.provenance === "LEGACY"
        ? "LEGACY"
        : explicitSemesterId && explicitSemesterId !== activeSemesterId
          ? "ARCHIVE"
          : input.provenance || "CURRENT";
    if (source === "ARCHIVE" && !explicitSemesterId) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "지난 학기 자료는 조회할 학기를 명시해야 합니다.",
      );
    }
    if (source === "ARCHIVE" && explicitSemesterId === activeSemesterId) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "현재 학기는 지난 학기 자료로 조회할 수 없습니다.",
      );
    }
    const callable = await getHttpsCallable<
      {
        mode: "MY_GRADES" | "TEACHER_QUEUE";
        semesterId: string;
        source: GradeEvidenceProvenance;
        scoreKind: GradeEvidenceScoreKind;
        cursor?: string;
      },
      unknown
    >("getGradeEvidenceState");
    const semesterId = explicitSemesterId || activeSemesterId;
    const result = await callable({
      mode: input.audience === "student" ? "MY_GRADES" : "TEACHER_QUEUE",
      semesterId,
      source,
      scoreKind: input.scoreKind,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const raw = asRecord(result.data);
    const scope = { ...raw, ...asRecord(raw.scope), ...asRecord(raw.context) };
    const resolvedSemesterId = readString(scope, "semesterId") || semesterId;
    const [resolvedYear, resolvedSemester] = resolvedSemesterId.split("-");
    const provenance = normalizeProvenance(scope.provenance || source);
    const records = collectRawRecords(raw)
      .map((record) => normalizeRecord(record, provenance))
      .filter((record) => record.scoreKind === input.scoreKind)
      .filter(
        (record) =>
          input.audience === "teacher" ||
          STUDENT_VISIBLE_STATES.has(record.status),
      );
    return {
      year: readString(scope, "year") || resolvedYear || year,
      semester: readString(scope, "semester") || resolvedSemester || semester,
      semesterId: resolvedSemesterId,
      provenance,
      readOnly: provenance !== "CURRENT" || scope.readOnly === true,
      manifestRevision: readNumber(
        scope,
        "manifestRevision",
        "semesterRevision",
      ),
      pendingSources: asArray(scope.pendingSources || raw.pendingSources).map(
        (value) => {
          const candidate = asRecord(value);
          const enrollment = asRecord(candidate.enrollmentSnapshot);
          return {
            attemptId: readString(candidate, "attemptId"),
            definitionId: readString(candidate, "definitionId"),
            definitionRevision: Math.max(
              0,
              Math.trunc(readNumber(candidate, "definitionRevision") || 0),
            ),
            title: readString(candidate, "title") || "채점 대기 평가",
            scoreKind: normalizeScoreKind(candidate.scoreKind),
            studentUid: readString(candidate, "studentUid"),
            studentName: readString(enrollment, "displayName"),
            enrollmentId: readString(candidate, "enrollmentId"),
            classId: readString(candidate, "classId"),
            enrollmentLabel: [
              withUnit(readString(enrollment, "grade"), "학년"),
              withUnit(
                readString(enrollment, "classDisplayName", "classNumber"),
                "반",
              ),
              withUnit(readString(enrollment, "studentNumber"), "번"),
            ]
              .filter(Boolean)
              .join(" "),
            sourceHash: readString(candidate, "sourceHash"),
            submittedAtIso: readTimestamp(candidate, "submittedAtIso"),
            provenance: normalizeProvenance(candidate.provenance || provenance),
            readOnly:
              candidate.readOnly === true ||
              normalizeProvenance(candidate.provenance || provenance) !==
                "CURRENT",
          };
        },
      ),
      records,
      nextCursor: readString(raw, "nextCursor"),
    };
  } catch (error) {
    throw error instanceof GradeEvidenceError ? error : mapCallableError(error);
  }
};

export interface GetGradeEvidenceDetailInput {
  config: ConfigLike;
  semesterId?: string;
  recordId: string;
  scoreKind: GradeEvidenceScoreKind;
  provenance?: GradeEvidenceProvenance;
}

export const getGradeEvidenceDetail = async (
  input: GetGradeEvidenceDetailInput,
): Promise<GradeEvidenceRecord | null> => {
  const { year, semester } = getYearSemester(input.config);
  try {
    const activeSemesterId = `${year}-${String(semester)}`;
    const explicitSemesterId = String(input.semesterId || "").trim();
    if (explicitSemesterId && !/^\d{4}-[12]$/.test(explicitSemesterId)) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "조회할 학기 범위가 올바르지 않습니다.",
      );
    }
    const source: GradeEvidenceProvenance =
      input.provenance === "LEGACY"
        ? "LEGACY"
        : explicitSemesterId && explicitSemesterId !== activeSemesterId
          ? "ARCHIVE"
          : input.provenance || "CURRENT";
    if (source === "ARCHIVE" && !explicitSemesterId) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "지난 학기 자료는 조회할 학기를 명시해야 합니다.",
      );
    }
    if (source === "ARCHIVE" && explicitSemesterId === activeSemesterId) {
      throw new GradeEvidenceError(
        "VALIDATION",
        "현재 학기는 지난 학기 자료로 조회할 수 없습니다.",
      );
    }
    const semesterId = explicitSemesterId || activeSemesterId;
    const callable = await getHttpsCallable<
      {
        mode: "GRADE_DETAIL";
        semesterId: string;
        source: GradeEvidenceProvenance;
        scoreKind: GradeEvidenceScoreKind;
        recordId: string;
      },
      unknown
    >("getGradeEvidenceState");
    const result = await callable({
      mode: "GRADE_DETAIL",
      semesterId,
      source,
      scoreKind: input.scoreKind,
      recordId: input.recordId,
    });
    const raw = asRecord(result.data);
    const scope = { ...raw, ...asRecord(raw.scope), ...asRecord(raw.context) };
    const provenance = normalizeProvenance(scope.provenance || source);
    const detail = asRecord(raw.detail);
    const record =
      Object.keys(detail).length > 0 ? detail : collectRawRecords(raw)[0];
    return record ? normalizeRecord(record, provenance) : null;
  } catch (error) {
    throw error instanceof GradeEvidenceError ? error : mapCallableError(error);
  }
};

export const GRADE_EVIDENCE_STATEMENT_VERSION = "w6b-grade-statement-v1";

export interface GradeEvidenceCommandItem {
  itemId: string;
  maxScore: number;
  awardedScore: number;
  evaluationKind: "AUTO" | "TEACHER";
  evidence: string;
  reason: string;
}

interface GradeCommandContext {
  config: ConfigLike;
  headId: string;
  versionId?: string;
  expectedRevision: number;
  expectedGradeRevision: number;
  expectedSemesterRevision: number;
}

interface GradeCommandResult {
  headId: string;
  versionId: string;
  requestId: string;
  attestationId: string;
  revision: number;
  status: GradeEvidenceLifecycleStatus;
}

const currentSemesterId = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}-${String(semester)}`;
};

const resolveCommandResult = async (
  pendingResponse: Promise<{ result: unknown }>,
): Promise<GradeCommandResult> => {
  try {
    const response = await pendingResponse;
    const raw = asRecord(response.result);
    const head = { ...raw, ...asRecord(raw.head) };
    const version = { ...raw, ...asRecord(raw.version) };
    const request = { ...raw, ...asRecord(raw.request) };
    const attestation = { ...raw, ...asRecord(raw.attestation) };
    return {
      headId: readString(head, "recordId", "headId", "id"),
      versionId: readString(version, "versionId", "id"),
      requestId: readString(request, "requestId", "id"),
      attestationId: readString(attestation, "attestationId", "id"),
      revision: Math.max(0, Math.trunc(readNumber(head, "revision") || 0)),
      status: normalizeLifecycleStatus(head.status || version.status),
    };
  } catch (error) {
    throw error instanceof GradeEvidenceError ? error : mapCallableError(error);
  }
};

export const createGradeDraft = (
  config: ConfigLike,
  input: {
    attemptId: string;
    scoreKind: GradeEvidenceScoreKind;
    title: string;
    rubricVersion: string;
    reason: string;
    expectedSemesterRevision: number;
  },
) =>
  resolveCommandResult(
    executeWestoryCommand("createGradeDraft", {
      semesterId: currentSemesterId(config),
      sourceKind: "ASSESSMENT_RESULT",
      attemptId: input.attemptId,
      scoreKind: input.scoreKind,
      title: input.title.trim(),
      rubricVersion: input.rubricVersion.trim(),
      reason: input.reason.trim(),
      expectedSemesterRevision: input.expectedSemesterRevision,
    }),
  );

export const reviewGradeDraft = (
  input: GradeCommandContext & {
    items: GradeEvidenceCommandItem[];
    reason: string;
  },
) =>
  resolveCommandResult(
    executeWestoryCommand("reviewGradeDraft", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      items: input.items,
      reason: input.reason.trim(),
    }),
  );

export const finalizeGradeEvidence = (
  input: GradeCommandContext & { reason: string },
) =>
  resolveCommandResult(
    executeWestoryCommand("finalizeGradeEvidence", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      expectedVersionId: input.versionId || "",
      reason: input.reason.trim(),
    }),
  );

export const publishOfficialGrade = (
  input: GradeCommandContext & {
    reason: string;
    signatureRequired: boolean;
  },
) =>
  resolveCommandResult(
    executeWestoryCommand("publishOfficialGrade", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      expectedVersionId: input.versionId || "",
      reason: input.reason.trim(),
      signatureRequired: input.signatureRequired,
    }),
  );

export const correctOfficialGrade = (
  input: GradeCommandContext & {
    items: GradeEvidenceCommandItem[];
    reason: string;
    requestId?: string;
    resolution?: "CORRECT" | "REJECT";
  },
) => {
  const resolution = input.resolution || "CORRECT";
  return resolveCommandResult(
    executeWestoryCommand("correctOfficialGrade", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      ...(resolution === "CORRECT" ? { items: input.items } : {}),
      reason: input.reason.trim(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      resolution,
    }),
  );
};

export const requestGradeReview = (
  input: GradeCommandContext & {
    reason: string;
    requestKind?: "OBJECTION" | "ANSWER_SHEET";
  },
) =>
  resolveCommandResult(
    executeWestoryCommand("requestGradeReview", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      requestKind: input.requestKind || "OBJECTION",
      reason: input.reason.trim(),
    }),
  );

export const acknowledgeGradeEvidence = (
  input: GradeCommandContext & { statementVersion?: string },
) =>
  resolveCommandResult(
    executeWestoryCommand("acknowledgeGradeEvidence", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      statementVersion:
        input.statementVersion || GRADE_EVIDENCE_STATEMENT_VERSION,
    }),
  );

export const signOfficialGrade = (
  input: GradeCommandContext & {
    signerName: string;
    statementVersion?: string;
  },
) =>
  resolveCommandResult(
    executeWestoryCommand("signOfficialGrade", {
      semesterId: currentSemesterId(input.config),
      recordId: input.headId,
      expectedRevision: input.expectedRevision,
      expectedGradeRevision: input.expectedGradeRevision,
      expectedSemesterRevision: input.expectedSemesterRevision,
      signatureName: input.signerName.trim(),
      statementVersion:
        input.statementVersion || GRADE_EVIDENCE_STATEMENT_VERSION,
    }),
  );
