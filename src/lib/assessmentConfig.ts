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
  visibleTargetGrade?: string;
  visibleClassIds: string[];
  visibilityVersion?: number;
  hasExplicitClassVisibility: boolean;
}

interface SchoolOptionShape {
  value?: string;
  label?: string;
}

interface SchoolConfigShape {
  grades?: SchoolOptionShape[];
  classes?: SchoolOptionShape[];
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

export interface AssessmentVisibilityTarget {
  id: string;
  gradeValue: string;
  gradeLabel: string;
  classValue: string;
  classLabel: string;
  shortLabel: string;
  fullLabel: string;
  isDefaultGrade: boolean;
  isTestGrade: boolean;
}

export interface AssessmentVisibilityGroup {
  gradeValue: string;
  gradeLabel: string;
  isDefaultGrade: boolean;
  isTestGrade: boolean;
  targets: AssessmentVisibilityTarget[];
}

export interface AssessmentVisibilityOptions {
  defaultGroup: AssessmentVisibilityGroup;
  extraGroups: AssessmentVisibilityGroup[];
  allTargets: AssessmentVisibilityTarget[];
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

const TEST_OPTION_PATTERN = /(test|\uD14C\uC2A4\uD2B8)/i;

export const normalizeSchoolToken = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const digits = normalized.match(/\d+/)?.[0] || "";
  if (!digits) return normalized;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
};

const compareSchoolTokens = (left: string, right: string) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumeric =
    Number.isFinite(leftNumber) && String(leftNumber) === left;
  const rightIsNumeric =
    Number.isFinite(rightNumber) && String(rightNumber) === right;

  if (leftIsNumeric && rightIsNumeric) {
    return leftNumber - rightNumber;
  }
  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;
  return left.localeCompare(right, "ko");
};

const compareAssessmentClassIds = (left: string, right: string) => {
  const [leftGrade = "", leftClass = ""] = left.split("-");
  const [rightGrade = "", rightClass = ""] = right.split("-");
  const gradeGap = compareSchoolTokens(leftGrade, rightGrade);
  if (gradeGap !== 0) return gradeGap;
  return compareSchoolTokens(leftClass, rightClass);
};

const isTestOption = (...values: Array<unknown>) =>
  values.some((value) => TEST_OPTION_PATTERN.test(String(value ?? "").trim()));

const isTestClassId = (classId: string) => {
  const [gradeValue = "", classValue = ""] = classId.split("-");
  return isTestOption(gradeValue, classValue);
};

const formatGradeLabel = (gradeValue: string, label?: string) => {
  const normalizedLabel = String(label ?? "").trim();
  if (normalizedLabel) return normalizedLabel;
  return /^\d+$/.test(gradeValue)
    ? `${gradeValue}\uD559\uB144`
    : gradeValue;
};

const formatClassLabel = (classValue: string, label?: string) => {
  const normalizedLabel = String(label ?? "").trim();
  if (normalizedLabel) return normalizedLabel;
  return /^\d+$/.test(classValue)
    ? `${classValue}\uBC18`
    : classValue;
};

export const buildAssessmentClassId = (grade: unknown, className: unknown) => {
  const normalizedGrade = normalizeSchoolToken(grade);
  const normalizedClass = normalizeSchoolToken(className);
  if (!normalizedGrade || !normalizedClass) return "";
  return `${normalizedGrade}-${normalizedClass}`;
};

export const normalizeAssessmentClassId = (
  value: unknown,
  fallbackGrade?: unknown,
) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";

  const dashParts = normalized
    .split("-")
    .map((part) => normalizeSchoolToken(part))
    .filter(Boolean);
  if (dashParts.length >= 2) {
    return buildAssessmentClassId(dashParts[0], dashParts.slice(1).join("-"));
  }

  const digits = normalized.match(/\d+/g) || [];
  if (digits.length >= 2) {
    return buildAssessmentClassId(digits[0], digits[1]);
  }

  const normalizedClass = normalizeSchoolToken(normalized);
  return normalizedClass
    ? buildAssessmentClassId(fallbackGrade, normalizedClass)
    : "";
};

const normalizeAssessmentClassIds = (
  values: unknown,
  fallbackGrade?: unknown,
): string[] =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeAssessmentClassId(value, fallbackGrade))
        .filter(Boolean),
    ),
  ).sort(compareAssessmentClassIds);

export const normalizeGrade3ClassId = (value: unknown) =>
  normalizeAssessmentClassId(value, "3");

const normalizeGrade3ClassIds = (values: unknown): string[] =>
  normalizeAssessmentClassIds(values, "3").filter(
    (classId) => classId.startsWith("3-") && !isTestClassId(classId),
  );

const collectClassIdsFromProfiles = (profiles: UserProfileShape[]) =>
  normalizeAssessmentClassIds(
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

const normalizeSchoolOptions = (
  values: SchoolOptionShape[] | undefined,
  kind: "grade" | "class",
) => {
  const fallbackValues =
    kind === "grade"
      ? ["1", "2", "3"]
      : Array.from({ length: 12 }, (_, index) => String(index + 1));
  const sourceValues =
    Array.isArray(values) && values.length > 0
      ? values
      : fallbackValues.map((value) => ({ value }));

  const optionMap = new Map<string, { value: string; label: string }>();
  sourceValues.forEach((item) => {
    const value = normalizeSchoolToken(item?.value ?? item?.label);
    if (!value || optionMap.has(value)) return;
    const label =
      kind === "grade"
        ? formatGradeLabel(value, item?.label)
        : formatClassLabel(value, item?.label);
    optionMap.set(value, { value, label });
  });

  return Array.from(optionMap.values()).sort((left, right) =>
    compareSchoolTokens(left.value, right.value),
  );
};

const loadRosterProfilesForGrades = async (gradeValues: string[]) => {
  const normalizedGrades = Array.from(
    new Set(
      gradeValues
        .map((value) => normalizeSchoolToken(value))
        .filter(Boolean),
    ),
  );
  if (!normalizedGrades.length) return new Map<string, UserProfileShape[]>();

  const snapshots = await Promise.all(
    normalizedGrades.flatMap((gradeValue) =>
      ["studentGrade", "grade"].map((gradeField) =>
        getDocs(
          query(collection(db, "users"), where(gradeField, "==", gradeValue)),
        ).catch(() => null),
      ),
    ),
  );

  const seenUserIds = new Set<string>();
  const profilesByGrade = new Map<string, UserProfileShape[]>();
  snapshots.forEach((snapshot) => {
    snapshot?.forEach((docSnap) => {
      if (seenUserIds.has(docSnap.id)) return;
      seenUserIds.add(docSnap.id);
      const profile = docSnap.data() as UserProfileShape;
      const gradeValue = normalizeSchoolToken(
        profile.studentGrade ?? profile.grade,
      );
      if (!gradeValue) return;
      const current = profilesByGrade.get(gradeValue) || [];
      current.push(profile);
      profilesByGrade.set(gradeValue, current);
    });
  });

  return profilesByGrade;
};

const buildVisibilityGroup = ({
  gradeValue,
  gradeLabel,
  classOptions,
  rosterClassIds,
  isDefaultGrade,
  isTestGrade,
}: {
  gradeValue: string;
  gradeLabel: string;
  classOptions: Array<{ value: string; label: string }>;
  rosterClassIds: string[];
  isDefaultGrade: boolean;
  isTestGrade: boolean;
}): AssessmentVisibilityGroup => {
  const classLabelMap = new Map(
    classOptions.map((option) => [option.value, option.label]),
  );
  const classValueSet = new Set(classOptions.map((option) => option.value));

  rosterClassIds
    .filter((classId) => classId.startsWith(`${gradeValue}-`))
    .forEach((classId) => {
      const [, classValue = ""] = classId.split("-");
      if (!classValue) return;
      classValueSet.add(classValue);
      if (!classLabelMap.has(classValue)) {
        classLabelMap.set(classValue, formatClassLabel(classValue));
      }
    });

  const targets = Array.from(classValueSet)
    .sort(compareSchoolTokens)
    .map((classValue) => {
      const classLabel =
        classLabelMap.get(classValue) || formatClassLabel(classValue);
      const id = buildAssessmentClassId(gradeValue, classValue);
      return {
        id,
        gradeValue,
        gradeLabel,
        classValue,
        classLabel,
        shortLabel: isDefaultGrade ? id : classLabel,
        fullLabel: `${gradeLabel} ${classLabel}`.trim(),
        isDefaultGrade,
        isTestGrade,
      };
    });

  return {
    gradeValue,
    gradeLabel,
    isDefaultGrade,
    isTestGrade,
    targets,
  };
};

const normalizeAssessmentTimeLimitSeconds = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 60;

  // Legacy data stored this field in minutes, while current writes use seconds.
  if (numeric < 60) {
    return Math.max(1, Math.round(numeric)) * 60;
  }

  return Math.max(60, Math.round(numeric));
};

export const getAssessmentConfigKey = (unitId: string, category: string) =>
  `${String(unitId || "").trim()}_${String(category || "").trim()}`;

export const getStudentGradeClassId = (
  userData?: Partial<UserData> | null,
) => {
  const profileLike = (userData || {}) as Partial<UserData> & {
    studentGrade?: string | number;
    studentClass?: string | number;
  };

  return buildAssessmentClassId(
    profileLike.studentGrade ?? profileLike.grade,
    profileLike.studentClass ?? profileLike.class,
  );
};

export const getGrade3ClassIdsFromSchoolConfig = async () => {
  const schoolConfig = await readSiteSettingDoc<SchoolConfigShape>(
    "school_config",
  );
  const configuredClassIds = normalizeGrade3ClassIds(
    (schoolConfig?.classes || [])
      .filter((item) => !isTestOption(item?.value, item?.label))
      .map((item) => item?.value ?? item?.label),
  );
  const rosterSnapshots = await Promise.all(
    ["studentGrade", "grade"].map((gradeField) =>
      getDocs(
        query(collection(db, "users"), where(gradeField, "==", "3")),
      ).catch(() => null),
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
    ...collectClassIdsFromProfiles(rosterProfiles).filter(
      (classId) => classId.startsWith("3-") && !isTestClassId(classId),
    ),
  ]);
};

export const getAssessmentVisibilityOptionsFromSchoolConfig =
  async (): Promise<AssessmentVisibilityOptions> => {
    const schoolConfig = await readSiteSettingDoc<SchoolConfigShape>(
      "school_config",
    );
    const gradeOptions = normalizeSchoolOptions(schoolConfig?.grades, "grade");
    const classOptions = normalizeSchoolOptions(schoolConfig?.classes, "class");

    const defaultGradeOption =
      gradeOptions.find((option) => option.value === "3") || {
        value: "3",
        label: `3\uD559\uB144`,
      };
    const testGradeOptions = gradeOptions.filter(
      (option) =>
        option.value !== defaultGradeOption.value &&
        isTestOption(option.value, option.label),
    );
    const rosterProfilesByGrade = await loadRosterProfilesForGrades([
      defaultGradeOption.value,
      ...testGradeOptions.map((option) => option.value),
    ]);

    const normalClassOptions = classOptions.filter(
      (option) => !isTestOption(option.value, option.label),
    );
    const testClassOptions = classOptions.filter((option) =>
      isTestOption(option.value, option.label),
    );

    const defaultGroup = buildVisibilityGroup({
      gradeValue: defaultGradeOption.value,
      gradeLabel: defaultGradeOption.label,
      classOptions:
        normalClassOptions.length > 0 ? normalClassOptions : classOptions,
      rosterClassIds: (
        rosterProfilesByGrade.get(defaultGradeOption.value) || []
      ).flatMap((profile) => {
        const classId = getStudentGradeClassId({
          grade: profile.studentGrade ?? profile.grade,
          class: profile.studentClass ?? profile.class,
        } as Partial<UserData>);
        if (!classId || isTestClassId(classId)) return [];
        return [classId];
      }),
      isDefaultGrade: true,
      isTestGrade: false,
    });

    const extraGroups = testGradeOptions
      .map((gradeOption) =>
        buildVisibilityGroup({
          gradeValue: gradeOption.value,
          gradeLabel: gradeOption.label,
          classOptions:
            testClassOptions.length > 0 ? testClassOptions : classOptions,
          rosterClassIds: (
            rosterProfilesByGrade.get(gradeOption.value) || []
          ).flatMap((profile) => {
            const classId = getStudentGradeClassId({
              grade: profile.studentGrade ?? profile.grade,
              class: profile.studentClass ?? profile.class,
            } as Partial<UserData>);
            return classId ? [classId] : [];
          }),
          isDefaultGrade: false,
          isTestGrade: true,
        }),
      )
      .filter((group) => group.targets.length > 0);

    return {
      defaultGroup,
      extraGroups,
      allTargets: [
        ...defaultGroup.targets,
        ...extraGroups.flatMap((group) => group.targets),
      ],
    };
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
          visibleTargetGrade?: string;
          visibleClassIds?: string[];
          visibilityVersion?: number;
        })
      : {};

  const explicitVisibility =
    Array.isArray(source.visibleClassIds) ||
    Number(source.visibilityVersion || 0) >= 2;
  const normalizedVisibleClassIds = explicitVisibility
    ? normalizeAssessmentClassIds(source.visibleClassIds)
    : [...grade3ClassIds];

  return {
    active: source.active === true,
    questionCount: Math.max(1, Number(source.questionCount) || 10),
    randomOrder: source.randomOrder !== false,
    timeLimit: normalizeAssessmentTimeLimitSeconds(source.timeLimit),
    allowRetake: source.allowRetake !== false,
    cooldown: Math.max(0, Number(source.cooldown) || 0),
    hintLimit: Math.max(0, Number(source.hintLimit) || 2),
    visibleTargetGrade: normalizeSchoolToken(source.visibleTargetGrade) || "3",
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
  const settingsRef = doc(
    db,
    getSemesterDocPath(config, "assessment_config", "settings"),
  );
  const statusRef = doc(
    db,
    getSemesterDocPath(config, "assessment_config", "status"),
  );
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

  const profileLike = (userData || {}) as Partial<UserData> & {
    studentGrade?: string | number;
    studentClass?: string | number;
  };
  const grade = normalizeSchoolToken(
    profileLike.studentGrade ?? profileLike.grade,
  );
  const classId = getStudentGradeClassId(userData);

  if (!grade || !classId) return false;
  if (!entry.hasExplicitClassVisibility) {
    return grade === (normalizeSchoolToken(entry.visibleTargetGrade) || "3");
  }
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
    classId: normalizeAssessmentClassId(classId, "3"),
  });

  return result.data;
};
