import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "./firebase";

export const PERFORMANCE_SCORE_ROSTERS_COLLECTION = "performance_score_rosters";

export const PERFORMANCE_SCORE_USER_COLLECTION = "performance_scores";

export const PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION = "confirmations";

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
