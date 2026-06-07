export const PERFORMANCE_SCORE_ROSTERS_COLLECTION = "performance_score_rosters";

export const PERFORMANCE_SCORE_USER_COLLECTION = "performance_scores";

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
  signedAt?: unknown;
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
