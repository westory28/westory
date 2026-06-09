import {
  collection,
  doc,
  getDoc,
  getDocs,
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

export const PERFORMANCE_SCORE_SETTINGS_DOC_ID = "performance_score";

export const PERFORMANCE_SCORE_CONSENTS_COLLECTION =
  "performance_score_consents";

export const PERFORMANCE_SCORE_CONSENT_DOC_ID = "current";

export const DEFAULT_PERFORMANCE_SCORE_WARNING_TEXT =
  "다른 학생의 점수를 확인하거나 대리로 서명할 경우 학업성적관리규정 위반 학생 및 생활교육 대상자가 될 수 있습니다. 본인 점수만 확인하고 본인 이름으로만 서명해 주세요.";

export const DEFAULT_PERFORMANCE_SCORE_WARNING_VERSION = "default-20260609";

export const PERFORMANCE_SCORE_WARNING_MAX_LENGTH = 600;

export interface PerformanceScoreItem {
  name: string;
  shortName?: string;
  score: number;
  maxScore: number;
  ratio?: number;
  scoreEntered?: boolean;
}

export interface PerformanceScoreRecord {
  id?: string;
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
  isTransferred?: boolean;
  transferStatus?: "transferred";
}

export interface PerformanceScoreConfirmation {
  id?: string;
  uid: string;
  rosterId: string;
  signatureName: string;
  signatureImage: string;
  confirmedAt?: unknown;
  updatedAt?: unknown;
}

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
  uid: string;
  scoreId: string;
  rosterId?: string;
  scoreTitle?: string;
  status: PerformanceScoreObjectionStatus;
  reason?: string;
  requestedAt?: unknown;
  reviewedAt?: unknown;
  changedScoreLabel?: string;
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
  totalScore?: number;
  totalMaxScore?: number;
  feedback?: string;
  evidence?: string;
  matchStatus: "matched" | "name-mismatch" | "unmatched";
  matchMessage: string;
  isManual?: boolean;
  isTransferred?: boolean;
  transferStatus?: "transferred";
}

export interface PerformanceScoreRoster {
  id: string;
  title: string;
  subject: string;
  assessmentOrder?: number;
  academicYear: string;
  semester: string;
  targetGrade: string;
  targetClass: string;
  classes: string[];
  items: Array<
    Pick<PerformanceScoreItem, "name" | "shortName" | "maxScore" | "ratio">
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
  await setDoc(
    doc(
      db,
      "users",
      uid,
      PERFORMANCE_SCORE_CONSENTS_COLLECTION,
      PERFORMANCE_SCORE_CONSENT_DOC_ID,
    ),
    payload,
  );
  return {
    id: PERFORMANCE_SCORE_CONSENT_DOC_ID,
    ...payload,
    acknowledgedAt: new Date(),
    updatedAt: new Date(),
  } satisfies PerformanceScoreWarningConsent;
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
) => {
  if (!uid) return [];
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
  return snap.docs.map((item) => {
    const data = item.data() as Record<string, unknown>;
    return {
      id: item.id,
      uid: String(data.uid || ""),
      scoreId: String(data.scoreId || ""),
      rosterId: String(data.rosterId || ""),
      scoreTitle: String(data.scoreTitle || ""),
      status: normalizePerformanceScoreObjectionStatus(data.status),
      reason: String(data.reason || ""),
      requestedAt: data.requestedAt,
      reviewedAt: data.reviewedAt,
      changedScoreLabel: String(data.changedScoreLabel || ""),
      reviewMemo: String(data.reviewMemo || ""),
    } satisfies PerformanceScoreObjection;
  });
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
  scope?: { year?: string; semester?: string },
) => {
  if (!uid) return [];
  const snap = await getDocs(
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
        (!scope?.semester || String(record.semester || "") === scope.semester),
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
        ),
      ),
    ),
  );
  return sortPerformanceScoreRecords(withConfirmations);
};

export const loadPerformanceScoreConfirmation = async (
  uid: string,
  scoreId: string,
) => {
  if (!uid || !scoreId) return null;
  try {
    const snap = await getDoc(
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
    return null;
  }
};

export const applyPerformanceScoreConfirmation = (
  record: PerformanceScoreRecord,
  confirmation: PerformanceScoreConfirmation | null,
): PerformanceScoreRecord => ({
  ...record,
  confirmation,
  signatureName: confirmation?.signatureName || record.signatureName,
  signatureImage: confirmation?.signatureImage || record.signatureImage,
  signedAt: confirmation?.confirmedAt || record.signedAt,
});

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
