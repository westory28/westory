import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import { readSiteSettingDoc } from "./siteSettings";
import type { SystemConfig, UserData } from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export interface AssessmentConfigEntry {
  active: boolean;
  questionCount: number;
  randomOrder: boolean;
  timeLimit: number;
  allowRetake: boolean;
  cooldown: number;
  hintLimit: number;
  visibleTargetGrade?: "3";
  visibleClassIds: string[];
  visibilityVersion?: number;
  hasExplicitClassVisibility: boolean;
}

interface SchoolConfigShape {
  classes?: Array<{ value?: string; label?: string }>;
}

interface UserProfileShape {
  role?: string;
  teacherPortalEnabled?: boolean;
  grade?: string | number;
  class?: string | number;
  studentGrade?: string | number;
  studentClass?: string | number;
}

interface ResetAssessmentAttemptsByClassParams {
  config: ConfigLike;
  unitId: string;
  category: string;
  classId: string;
}

export interface ResetAssessmentAttemptsByClassResult {
  affectedStudentCount: number;
  recalculatedWalletCount: number;
  deletedPointTransactionCount: number;
  deletedQuizResultCount: number;
  deletedSubmissionCount: number;
  targetStudentCount: number;
}

const DEFAULT_ASSESSMENT_CONFIG_ENTRY: AssessmentConfigEntry = {
  active: false,
  questionCount: 10,
  randomOrder: true,
  timeLimit: 60,
  allowRetake: true,
  cooldown: 0,
  hintLimit: 2,
  visibleTargetGrade: "3",
  visibleClassIds: [],
  visibilityVersion: undefined,
  hasExplicitClassVisibility: false,
};

const normalizeDigitToken = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const digits = normalized.match(/\d+/)?.[0] || "";
  if (!digits) return normalized;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
};

export const normalizeGrade3ClassId = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const match = normalized.match(/(\d+)\D+(\d+)/);
  if (match) {
    return `${Number(match[1])}-${Number(match[2])}`;
  }

  const digits = normalized.match(/\d+/g) || [];
  if (digits.length >= 2) {
    return `${Number(digits[0])}-${Number(digits[1])}`;
  }

  const classNumber = normalizeDigitToken(normalized);
  return classNumber ? `3-${classNumber}` : "";
};

const normalizeGrade3ClassIds = (values: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeGrade3ClassId(value))
        .filter(Boolean),
    ),
  ).sort((left, right) => {
    const leftClass = Number(left.split("-")[1] || 0);
    const rightClass = Number(right.split("-")[1] || 0);
    return leftClass - rightClass;
  });

const collectGrade3ClassIdsFromProfiles = (profiles: UserProfileShape[]) =>
  normalizeGrade3ClassIds(
    profiles.flatMap((profile) => {
      const role = String(profile.role || "").trim();
      if (role && role !== "student") return [];
      if (!role && profile.teacherPortalEnabled === true) return [];
      return [
        getStudentGradeClassId({
          grade: profile.studentGrade ?? profile.grade,
          class: profile.studentClass ?? profile.class,
        } as Partial<UserData>),
      ];
    }),
  );

export const getAssessmentConfigKey = (unitId: string, category: string) =>
  `${String(unitId || "").trim()}_${String(category || "").trim()}`;

export const getStudentGradeClassId = (
  userData?: Partial<UserData> | null,
) => {
  const grade = normalizeDigitToken(userData?.grade);
  const className = normalizeDigitToken(userData?.class);
  return grade && className ? `${grade}-${className}` : "";
};

export const getGrade3ClassIdsFromSchoolConfig = async () => {
  const schoolConfig = await readSiteSettingDoc<SchoolConfigShape>("school_config");
  const configuredClassIds = normalizeGrade3ClassIds(
    (schoolConfig?.classes || []).map((item) => item?.value ?? item?.label),
  );
  const rosterSnapshots = await Promise.all(
    ["studentGrade", "grade"].map((gradeField) =>
      getDocs(query(collection(db, "users"), where(gradeField, "==", "3"))).catch(
        () => null,
      ),
    ),
  );
  const seenUserIds = new Set<string>();
  const rosterProfiles: UserProfileShape[] = [];
  rosterSnapshots.forEach((snapshot) => {
    snapshot?.forEach((docSnap) => {
      if (seenUserIds.has(docSnap.id)) return;
      seenUserIds.add(docSnap.id);
      rosterProfiles.push(docSnap.data() as UserProfileShape);
    });
  });

  return normalizeGrade3ClassIds([
    ...configuredClassIds,
    ...collectGrade3ClassIdsFromProfiles(rosterProfiles),
  ]);
};

export const normalizeAssessmentConfigEntry = (
  value: unknown,
  grade3ClassIds: string[] = [],
): AssessmentConfigEntry => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<AssessmentConfigEntry> & {
          active?: boolean;
          timeLimit?: number;
          questionCount?: number;
          randomOrder?: boolean;
          allowRetake?: boolean;
          cooldown?: number;
          hintLimit?: number;
          visibleTargetGrade?: "3";
          visibleClassIds?: string[];
          visibilityVersion?: number;
        })
      : {};

  const explicitVisibility =
    Array.isArray(source.visibleClassIds) ||
    Number(source.visibilityVersion || 0) >= 2;
  const normalizedVisibleClassIds = explicitVisibility
    ? normalizeGrade3ClassIds(source.visibleClassIds)
    : [...grade3ClassIds];

  return {
    active: source.active === true,
    questionCount: Math.max(1, Number(source.questionCount) || 10),
    randomOrder: source.randomOrder !== false,
    timeLimit: Math.max(60, Number(source.timeLimit) || 60),
    allowRetake: source.allowRetake !== false,
    cooldown: Math.max(0, Number(source.cooldown) || 0),
    hintLimit: Math.max(0, Number(source.hintLimit) || 2),
    visibleTargetGrade: "3",
    visibleClassIds: normalizedVisibleClassIds,
    visibilityVersion:
      Number(source.visibilityVersion || 0) >= 2
        ? Number(source.visibilityVersion)
        : undefined,
    hasExplicitClassVisibility: explicitVisibility,
  };
};

export const readAssessmentConfigMap = async (
  config: ConfigLike,
  grade3ClassIds: string[] = [],
) => {
  const settingsRef = doc(db, getSemesterDocPath(config, "assessment_config", "settings"));
  const statusRef = doc(db, getSemesterDocPath(config, "assessment_config", "status"));
  const [settingsSnap, statusSnap] = await Promise.all([
    getDoc(settingsRef),
    getDoc(statusRef),
  ]);

  const normalized: Record<string, AssessmentConfigEntry> = {};
  const statusData = statusSnap.exists()
    ? (statusSnap.data() as Record<string, unknown>)
    : {};
  Object.entries(statusData).forEach(([key, active]) => {
    normalized[key] = normalizeAssessmentConfigEntry({ active }, grade3ClassIds);
  });

  const settingsData = settingsSnap.exists()
    ? (settingsSnap.data() as Record<string, unknown>)
    : {};
  Object.entries(settingsData).forEach(([key, entry]) => {
    normalized[key] = normalizeAssessmentConfigEntry(entry, grade3ClassIds);
  });

  return normalized;
};

export const isAssessmentVisibleToStudent = (
  entry: AssessmentConfigEntry | null | undefined,
  userData?: Partial<UserData> | null,
) => {
  if (!entry?.active) return false;
  const grade = normalizeDigitToken(userData?.grade);
  const classId = getStudentGradeClassId(userData);
  if (grade !== "3" || !classId) return false;
  if (!entry.hasExplicitClassVisibility) return true;
  if (!entry.visibleClassIds.length) return false;
  return entry.visibleClassIds.includes(classId);
};

export const createDefaultAssessmentConfigEntry = (
  grade3ClassIds: string[] = [],
) =>
  normalizeAssessmentConfigEntry(DEFAULT_ASSESSMENT_CONFIG_ENTRY, grade3ClassIds);

export const resetAssessmentAttemptsByClass = async ({
  config,
  unitId,
  category,
  classId,
}: ResetAssessmentAttemptsByClassParams) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable<
    {
      year: string;
      semester: string;
      unitId: string;
      category: string;
      classId: string;
    },
    ResetAssessmentAttemptsByClassResult
  >(functions, "resetAssessmentAttemptsByClass");

  const result = await callable({
    year,
    semester,
    unitId: String(unitId || "").trim(),
    category: String(category || "").trim(),
    classId: normalizeGrade3ClassId(classId),
  });

  return result.data;
};
