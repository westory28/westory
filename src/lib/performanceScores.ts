import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
  getYearSemester,
} from "./semesterScope";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export const PERFORMANCE_SCORE_ROSTERS_COLLECTION = "performance_score_rosters";

export const PERFORMANCE_SCORE_USER_COLLECTION = "performance_scores";

export const PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION = "confirmations";

export const PERFORMANCE_SCORE_OBJECTIONS_COLLECTION =
  "performance_score_objections";

export const PERFORMANCE_SCORE_ANSWER_SHEET_REQUESTS_COLLECTION =
  "performance_score_answer_sheet_requests";

export const PERFORMANCE_SCORE_SETTINGS_DOC_ID = "performance_score";

export const PERFORMANCE_SCORE_CONSENTS_COLLECTION =
  "performance_score_consents";

export const PERFORMANCE_SCORE_CONSENT_DOC_ID = "current";

export const DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT =
  "다른 학생의 점수를 확인하거나 대리로 서명할 경우 학업성적관리규정 위반 학생 및 생활교육 대상자가 될 수 있습니다. 본인 점수만 확인하고 본인 이름으로만 서명해 주세요.";

export const DEFAULT_PERFORMANCE_SCORE_WARNING_VERSION = "default-20260609";

export const PERFORMANCE_SCORE_WARNING_MAX_LENGTH = 600;

export const PERFORMANCE_SCORE_KIND = "performance";
export const WRITTEN_EXAM_SCORE_KIND = "written_exam_essay";

export const WRITTEN_EXAM_SECTION_OBJECTIVE = "objective";
export const WRITTEN_EXAM_SECTION_ESSAY = "essay";

export type PerformanceScoreKind =
  | typeof PERFORMANCE_SCORE_KIND
  | typeof WRITTEN_EXAM_SCORE_KIND;

export type WrittenExamSection =
  | typeof WRITTEN_EXAM_SECTION_OBJECTIVE
  | typeof WRITTEN_EXAM_SECTION_ESSAY;

export type WrittenExamAnswerStatus =
  | "correct"
  | "incorrect"
  | "blank"
  | "invalid";

export interface PerformanceScoreItem {
  name: string;
  shortName?: string;
  itemKey?: string;
  groupKey?: string;
  groupLabel?: string;
  examSection?: WrittenExamSection;
  questionNumber?: number;
  correctAnswer?: string;
  studentAnswer?: string;
  answerCorrect?: boolean;
  answerStatus?: WrittenExamAnswerStatus;
  answerChoices?: string[];
  feedback?: string;
  score: number;
  maxScore: number;
  ratio?: number;
  scoreEntered?: boolean;
}

export interface PerformanceScoreRecord {
  id?: string;
  scoreKind?: PerformanceScoreKind;
  scoreContentKind?: "performance" | "objective" | "essay" | "mixed";
  rosterId: string;
  title: string;
  subject: string;
  assessmentOrder?: number;
  academicYear: string;
  semester: string;
  grade: string;
  class: string;
  number: string;
  studentName: string;
  uid: string;
  items: PerformanceScoreItem[];
  enteredScoreCount?: number;
  totalScore: number;
  totalMaxScore: number;
  feedback: string;
  evidence?: string;
  sourceFileName?: string;
  uploadedBy?: string;
  uploadedByEmail?: string;
  uploadedAt?: unknown;
  updatedAt?: unknown;
  signatureName?: string;
  signatureImage?: string;
  signedAt?: unknown;
  confirmation?: PerformanceScoreConfirmation | null;
  academicStatus?: string;
  isTransferred?: boolean;
  transferStatus?: "transferred";
}

export interface PerformanceScoreConfirmation {
  id?: string;
  uid: string;
  rosterId: string;
  signatureName: string;
  signatureImage: string;
  scoreUpdatedAt?: unknown;
  confirmedAt?: unknown;
  updatedAt?: unknown;
}

export const hasEnteredPerformanceScore = (
  record:
    | Partial<
        Pick<
          PerformanceScoreRecord,
          "enteredScoreCount" | "items" | "totalScore"
        >
      >
    | null
    | undefined,
) => {
  if (!record) return false;
  // An explicit zero distinguishes an unregistered score from an earned zero.
  if (record.enteredScoreCount !== undefined)
    return (
      typeof record.enteredScoreCount === "number" &&
      Number.isFinite(record.enteredScoreCount) &&
      record.enteredScoreCount > 0
    );
  const isScore = (value: unknown) =>
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value));
  const items = Array.isArray(record.items) ? record.items : [];
  if (items.some((item) => item.scoreEntered !== false && isScore(item.score)))
    return true;
  // Older total-only records have no entered-count field, including real zeros.
  return (
    isScore(record.totalScore) &&
    (items.length === 0 || Number(record.totalScore) > 0)
  );
};

export interface PerformanceScoreSettings {
  warningText: string;
  warningVersion: string;
  warningTextHash: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface PerformanceScoreWarningConsent {
  id?: string;
  uid: string;
  academicYear: string;
  semester: string;
  acknowledged: boolean;
  warningVersion: string;
  warningTextHash: string;
  acknowledgedAt?: unknown;
  updatedAt?: unknown;
}

export type PerformanceScoreObjectionStatus =
  | "pending"
  | "accepted"
  | "rejected";

export interface PerformanceScoreObjection {
  id: string;
  scoreKind?: PerformanceScoreKind;
  uid: string;
  scoreId: string;
  rosterId?: string;
  scoreTitle?: string;
  targetDetails?: string;
  answerSheetRequested?: boolean;
  status: PerformanceScoreObjectionStatus;
  reason?: string;
  requestedAt?: unknown;
  reviewedAt?: unknown;
  changedScoreLabel?: string;
  reviewMemo?: string;
}

export type PerformanceScoreAnswerSheetRequestStatus = "pending" | "reviewed";

export interface PerformanceScoreAnswerSheetRequest {
  id: string;
  scoreKind?: PerformanceScoreKind;
  uid: string;
  scoreId: string;
  rosterId?: string;
  scoreTitle?: string;
  targetDetails?: string;
  status: PerformanceScoreAnswerSheetRequestStatus;
  reason?: string;
  requestedAt?: unknown;
  reviewedAt?: unknown;
  reviewMemo?: string;
}

export interface PerformanceScoreRosterRow {
  rowNumber: number;
  uid: string;
  grade: string;
  class: string;
  number: string;
  studentName: string;
  items?: PerformanceScoreItem[];
  enteredScoreCount?: number;
  totalScore?: number;
  totalMaxScore?: number;
  feedback?: string;
  evidence?: string;
  matchStatus: "matched" | "name-mismatch" | "unmatched";
  matchMessage: string;
  academicStatus?: string;
  isManual?: boolean;
  isTransferred?: boolean;
  transferStatus?: "transferred";
}

export interface PerformanceScoreRoster {
  id: string;
  scoreKind?: PerformanceScoreKind;
  scoreContentKind?: "performance" | "objective" | "essay" | "mixed";
  title: string;
  subject: string;
  assessmentOrder?: number;
  academicYear: string;
  semester: string;
  targetGrade: string;
  targetClass: string;
  classes: string[];
  items: Array<
    Pick<
      PerformanceScoreItem,
      | "name"
      | "shortName"
      | "itemKey"
      | "groupKey"
      | "groupLabel"
      | "examSection"
      | "questionNumber"
      | "correctAnswer"
      | "studentAnswer"
      | "answerCorrect"
      | "answerStatus"
      | "answerChoices"
      | "maxScore"
      | "ratio"
    >
  >;
  totalMaxScore: number;
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  sourceFileName: string;
  rows: PerformanceScoreRosterRow[];
  uploadedBy: string;
  uploadedByEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const normalizeSchoolValue = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/학년|반|번/g, "")
    .trim();

export const normalizeStudentName = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .trim();

export const toFiniteScore = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizePerformanceScoreKind = (
  value: unknown,
): PerformanceScoreKind =>
  value === WRITTEN_EXAM_SCORE_KIND
    ? WRITTEN_EXAM_SCORE_KIND
    : PERFORMANCE_SCORE_KIND;

export const isPerformanceScoreKind = (
  value: unknown,
  expectedKind: PerformanceScoreKind,
) => normalizePerformanceScoreKind(value) === expectedKind;

export const roundScore = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
};

export const getPerformanceScorePercent = (score: number, maxScore: number) => {
  const safeScore = toFiniteScore(score);
  const safeMaxScore = toFiniteScore(maxScore);
  if (safeScore === null || safeMaxScore === null || safeMaxScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (safeScore / safeMaxScore) * 100));
};

export const formatPerformanceScore = (value: unknown) => {
  const score = toFiniteScore(value);
  if (score === null) return "-";
  const rounded = roundScore(score);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

export const normalizePerformanceScoreWarningText = (value: unknown) => {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT;
  return text.slice(0, PERFORMANCE_SCORE_WARNING_MAX_LENGTH);
};

export const buildPerformanceScoreWarningHash = (value: unknown) => {
  const text = normalizePerformanceScoreWarningText(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const buildPerformanceScoreWarningVersion = (value: unknown) =>
  `warning-${buildPerformanceScoreWarningHash(value)}`;

export const normalizePerformanceScoreSettings = (
  data?: Record<string, unknown> | null,
): PerformanceScoreSettings => {
  if (!data) {
    return {
      warningText: DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT,
      warningVersion: DEFAULT_PERFORMANCE_SCORE_WARNING_VERSION,
      warningTextHash: buildPerformanceScoreWarningHash(
        DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT,
      ),
    };
  }
  const warningText = normalizePerformanceScoreWarningText(data.warningText);
  const warningTextHash =
    typeof data.warningTextHash === "string" && data.warningTextHash.trim()
      ? data.warningTextHash.trim().slice(0, 32)
      : buildPerformanceScoreWarningHash(warningText);
  return {
    warningText,
    warningVersion:
      typeof data.warningVersion === "string" && data.warningVersion.trim()
        ? data.warningVersion.trim().slice(0, 80)
        : buildPerformanceScoreWarningVersion(warningText),
    warningTextHash,
    updatedAt: data.updatedAt,
    updatedBy:
      typeof data.updatedBy === "string" ? data.updatedBy.slice(0, 160) : "",
  };
};

export const loadPerformanceScoreSettings = async (config: ConfigLike) => {
  const snap = await getDoc(
    doc(
      db,
      getSemesterDocPath(
        config,
        "assessment_config",
        PERFORMANCE_SCORE_SETTINGS_DOC_ID,
      ),
    ),
  );
  return normalizePerformanceScoreSettings(
    snap.exists() ? (snap.data() as Record<string, unknown>) : null,
  );
};

export const savePerformanceScoreSettings = async (
  config: ConfigLike,
  input: { warningText: string; updatedBy?: string },
) => {
  const warningText = normalizePerformanceScoreWarningText(input.warningText);
  const warningTextHash = buildPerformanceScoreWarningHash(warningText);
  const warningVersion = buildPerformanceScoreWarningVersion(warningText);
  await setDoc(
    doc(
      db,
      getSemesterDocPath(
        config,
        "assessment_config",
        PERFORMANCE_SCORE_SETTINGS_DOC_ID,
      ),
    ),
    {
      warningText,
      warningVersion,
      warningTextHash,
      updatedBy: String(input.updatedBy || "").slice(0, 160),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { warningText, warningVersion, warningTextHash };
};

export const loadPerformanceScoreWarningConsent = async (uid: string) => {
  if (!uid) return null;
  const snap = await getDoc(
    doc(
      db,
      "users",
      uid,
      PERFORMANCE_SCORE_CONSENTS_COLLECTION,
      PERFORMANCE_SCORE_CONSENT_DOC_ID,
    ),
  );
  if (!snap.exists()) return null;
  return {
    id: snap.id,
    ...(snap.data() as Omit<PerformanceScoreWarningConsent, "id">),
  };
};

export const savePerformanceScoreWarningConsent = async (
  uid: string,
  config: ConfigLike,
  settings: PerformanceScoreSettings,
) => {
  const { year, semester } = getYearSemester(config);
  const warningTextHash =
    settings.warningTextHash ||
    buildPerformanceScoreWarningHash(settings.warningText);
  const payload = {
    uid,
    academicYear: year,
    semester,
    acknowledged: true,
    warningVersion: settings.warningVersion,
    warningTextHash,
    acknowledgedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const consentRef = doc(
    db,
    "users",
    uid,
    PERFORMANCE_SCORE_CONSENTS_COLLECTION,
    PERFORMANCE_SCORE_CONSENT_DOC_ID,
  );
  await setDoc(consentRef, payload);
  const savedSnapshot = await getDocFromServer(consentRef);
  const saved = savedSnapshot.exists()
    ? ({
        id: savedSnapshot.id,
        ...savedSnapshot.data(),
      } as PerformanceScoreWarningConsent)
    : null;
  if (
    !isPerformanceScoreWarningConsentCurrent(saved, uid, config, settings) ||
    !saved?.acknowledgedAt
  ) {
    throw new Error("The saved score warning consent could not be verified.");
  }
  return saved;
};

export const isPerformanceScoreWarningConsentCurrent = (
  consent: PerformanceScoreWarningConsent | null | undefined,
  uid: string,
  config: ConfigLike,
  settings: PerformanceScoreSettings,
) => {
  const { year, semester } = getYearSemester(config);
  return (
    consent?.acknowledged === true &&
    consent.uid === uid &&
    consent.academicYear === year &&
    consent.semester === semester &&
    consent.warningVersion === settings.warningVersion &&
    consent.warningTextHash ===
      (settings.warningTextHash ||
        buildPerformanceScoreWarningHash(settings.warningText))
  );
};

const normalizePerformanceScoreObjectionStatus = (
  value: unknown,
): PerformanceScoreObjectionStatus => {
  const status = String(value || "").trim();
  if (status === "accepted" || status === "rejected") return status;
  return "pending";
};

export const loadUserPerformanceScoreObjections = async (
  config: ConfigLike,
  uid: string,
  options: { scoreKind?: PerformanceScoreKind | "all" } = {},
) => {
  if (!uid) return [];
  const targetScoreKind = options.scoreKind ?? PERFORMANCE_SCORE_KIND;
  const snap = await getDocs(
    query(
      collection(
        db,
        getSemesterCollectionPath(
          config,
          PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
        ),
      ),
      where("uid", "==", uid),
    ),
  );
  return snap.docs
    .map((item) => {
      const data = item.data() as Record<string, unknown>;
      return {
        id: item.id,
        scoreKind: normalizePerformanceScoreKind(data.scoreKind),
        uid: String(data.uid || ""),
        scoreId: String(data.scoreId || ""),
        rosterId: String(data.rosterId || ""),
        scoreTitle: String(data.scoreTitle || ""),
        targetDetails: String(data.targetDetails || ""),
        status: normalizePerformanceScoreObjectionStatus(data.status),
        answerSheetRequested: data.answerSheetRequested === true,
        reason: String(data.reason || ""),
        requestedAt: data.requestedAt,
        reviewedAt: data.reviewedAt,
        changedScoreLabel: String(data.changedScoreLabel || ""),
        reviewMemo: String(data.reviewMemo || ""),
      } satisfies PerformanceScoreObjection;
    })
    .filter(
      (item) =>
        targetScoreKind === "all" ||
        normalizePerformanceScoreKind(item.scoreKind) === targetScoreKind,
    );
};

const normalizePerformanceScoreAnswerSheetRequestStatus = (
  value: unknown,
): PerformanceScoreAnswerSheetRequestStatus =>
  String(value || "").trim() === "reviewed" ? "reviewed" : "pending";

export const loadUserPerformanceScoreAnswerSheetRequests = async (
  config: ConfigLike,
  uid: string,
  options: { scoreKind?: PerformanceScoreKind | "all" } = {},
) => {
  if (!uid) return [];
  const targetScoreKind = options.scoreKind ?? PERFORMANCE_SCORE_KIND;
  const snap = await getDocs(
    query(
      collection(
        db,
        getSemesterCollectionPath(
          config,
          PERFORMANCE_SCORE_ANSWER_SHEET_REQUESTS_COLLECTION,
        ),
      ),
      where("uid", "==", uid),
    ),
  );
  return snap.docs
    .map((item) => {
      const data = item.data() as Record<string, unknown>;
      return {
        id: item.id,
        scoreKind: normalizePerformanceScoreKind(data.scoreKind),
        uid: String(data.uid || ""),
        scoreId: String(data.scoreId || ""),
        rosterId: String(data.rosterId || ""),
        scoreTitle: String(data.scoreTitle || ""),
        targetDetails: String(data.targetDetails || ""),
        status: normalizePerformanceScoreAnswerSheetRequestStatus(data.status),
        reason: String(data.reason || ""),
        requestedAt: data.requestedAt,
        reviewedAt: data.reviewedAt,
        reviewMemo: String(data.reviewMemo || ""),
      } satisfies PerformanceScoreAnswerSheetRequest;
    })
    .filter(
      (item) =>
        targetScoreKind === "all" ||
        normalizePerformanceScoreKind(item.scoreKind) === targetScoreKind,
    );
};

const getTimestampSeconds = (value: unknown) => {
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds;
  }
  return 0;
};

export const sortPerformanceScoreRecords = (
  records: PerformanceScoreRecord[],
) =>
  [...records].sort(
    (a, b) =>
      (a.assessmentOrder ?? 999) - (b.assessmentOrder ?? 999) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ko") ||
      getTimestampSeconds(b.updatedAt) - getTimestampSeconds(a.updatedAt),
  );

export const loadUserPerformanceScoreRecords = async (
  uid: string,
  scope?: {
    year?: string;
    semester?: string;
    scoreKind?: PerformanceScoreKind | "all";
    fromServer?: boolean;
  },
) => {
  if (!uid) return [];
  const targetScoreKind = scope?.scoreKind ?? PERFORMANCE_SCORE_KIND;
  const snap = await (scope?.fromServer ? getDocsFromServer : getDocs)(
    query(
      collection(db, "users", uid, PERFORMANCE_SCORE_USER_COLLECTION),
      orderBy("updatedAt", "desc"),
    ),
  );
  const loaded = snap.docs
    .map(
      (item) =>
        ({
          id: item.id,
          ...item.data(),
        }) as PerformanceScoreRecord,
    )
    .filter(
      (record) =>
        (!scope?.year || String(record.academicYear || "") === scope.year) &&
        (!scope?.semester ||
          String(record.semester || "") === scope.semester) &&
        (targetScoreKind === "all" ||
          normalizePerformanceScoreKind(record.scoreKind) === targetScoreKind),
    )
    .map((record) => ({
      ...record,
      items: Array.isArray(record.items) ? record.items : [],
    }));
  const withConfirmations = await Promise.all(
    loaded.map(async (record) =>
      applyPerformanceScoreConfirmation(
        record,
        await loadPerformanceScoreConfirmation(
          uid,
          record.id || record.rosterId,
          { throwOnError: true, fromServer: scope?.fromServer },
        ),
      ),
    ),
  );
  return sortPerformanceScoreRecords(withConfirmations);
};

export const loadPerformanceScoreConfirmation = async (
  uid: string,
  scoreId: string,
  options: { throwOnError?: boolean; fromServer?: boolean } = {},
) => {
  if (!uid || !scoreId) return null;
  try {
    const snap = await (options.fromServer ? getDocFromServer : getDoc)(
      doc(
        db,
        "users",
        uid,
        PERFORMANCE_SCORE_USER_COLLECTION,
        scoreId,
        PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
        uid,
      ),
    );
    if (!snap.exists()) return null;
    const data = snap.data() as PerformanceScoreConfirmation;
    return {
      id: snap.id,
      ...data,
    };
  } catch (error) {
    console.warn("Failed to load performance score confirmation:", error);
    if (options.throwOnError) throw error;
    return null;
  }
};

export const applyPerformanceScoreConfirmation = (
  record: PerformanceScoreRecord,
  confirmation: PerformanceScoreConfirmation | null,
): PerformanceScoreRecord => {
  const timestampKey = (value: unknown): string => {
    if (!value) return "";
    if (value instanceof Date) return String(value.getTime());
    const stamp = value as {
      seconds?: number;
      nanoseconds?: number;
      toMillis?: () => number;
    };
    if (typeof stamp.seconds === "number")
      return `${stamp.seconds}:${stamp.nanoseconds || 0}`;
    if (typeof stamp.toMillis === "function") return String(stamp.toMillis());
    return "";
  };
  const timestampParts = (value: unknown): [number, number] => {
    if (value instanceof Date)
      return [
        Math.floor(value.getTime() / 1000),
        (value.getTime() % 1000) * 1e6,
      ];
    const stamp = value as { seconds?: number; nanoseconds?: number } | null;
    return typeof stamp?.seconds === "number"
      ? [stamp.seconds, stamp.nanoseconds || 0]
      : [NaN, NaN];
  };
  const [confirmedSeconds, confirmedNanos] = timestampParts(
    confirmation?.confirmedAt,
  );
  const [updatedSeconds, updatedNanos] = timestampParts(record.updatedAt);
  const valid =
    confirmation &&
    hasEnteredPerformanceScore(record) &&
    confirmation.uid === record.uid &&
    confirmation.rosterId === record.rosterId &&
    (confirmation.scoreUpdatedAt
      ? timestampKey(confirmation.scoreUpdatedAt) ===
        timestampKey(record.updatedAt)
      : !record.updatedAt ||
        confirmedSeconds > updatedSeconds ||
        (confirmedSeconds === updatedSeconds &&
          confirmedNanos >= updatedNanos));
  return {
    ...record,
    confirmation: valid ? confirmation : null,
    signatureName: valid ? confirmation.signatureName : undefined,
    signatureImage: valid ? confirmation.signatureImage : undefined,
    signedAt: valid ? confirmation.confirmedAt : undefined,
  };
};

// Callers provide one student's assessment records in the selected semester.
// A latest image represents completion only after every entered score is signed.
export const getLatestPerformanceScoreSignatureRecord = (
  records: PerformanceScoreRecord[],
): PerformanceScoreRecord | null => {
  const required = records.filter(hasEnteredPerformanceScore).map((record) => {
    if (record.confirmation === undefined) return record;
    const verified = applyPerformanceScoreConfirmation(
      record,
      record.confirmation,
    );
    return { ...verified, signedAt: verified.signedAt || record.signedAt };
  });
  if (
    !required.length ||
    required.some(
      (record) =>
        typeof record.signatureImage !== "string" ||
        !record.signatureImage.trim() ||
        typeof record.signatureName !== "string" ||
        !record.signatureName.trim(),
    )
  )
    return null;

  const timestampParts = (value: unknown): [number, number] => {
    const stamp = value as {
      seconds?: number;
      nanoseconds?: number;
      toMillis?: () => number;
      toDate?: () => Date;
    } | null;
    if (typeof stamp?.seconds === "number" && Number.isFinite(stamp.seconds))
      return [stamp.seconds, Number(stamp.nanoseconds) || 0];
    const millis =
      value instanceof Date
        ? value.getTime()
        : typeof stamp?.toMillis === "function"
          ? stamp.toMillis()
          : typeof stamp?.toDate === "function"
            ? stamp.toDate().getTime()
            : 0;
    return Number.isFinite(millis)
      ? [Math.floor(millis / 1000), Math.round((millis % 1000) * 1e6)]
      : [0, 0];
  };
  return required.sort((left, right) => {
    const [leftSeconds, leftNanos] = timestampParts(
      left.confirmation?.confirmedAt || left.signedAt,
    );
    const [rightSeconds, rightNanos] = timestampParts(
      right.confirmation?.confirmedAt || right.signedAt,
    );
    return (
      rightSeconds - leftSeconds ||
      rightNanos - leftNanos ||
      String(left.rosterId || left.id || "").localeCompare(
        String(right.rosterId || right.id || ""),
      )
    );
  })[0];
};

export const buildStudentLookupKey = (
  grade: unknown,
  classValue: unknown,
  number: unknown,
) =>
  [
    normalizeSchoolValue(grade),
    normalizeSchoolValue(classValue),
    normalizeSchoolValue(number),
  ].join("|");

export const buildStudentNameLookupKey = (
  grade: unknown,
  classValue: unknown,
  name: unknown,
) =>
  [
    normalizeSchoolValue(grade),
    normalizeSchoolValue(classValue),
    normalizeStudentName(name),
  ].join("|");
