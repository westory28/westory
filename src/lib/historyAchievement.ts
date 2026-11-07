import catalog from "../../functions/shared/historyAchievementStandards.json";
import rubrics from "../../functions/shared/historyAchievementRubrics.json";

export const HISTORY_ACHIEVEMENT_CURRICULUM_VERSION = "2018-162";
export const HISTORY_ACHIEVEMENT_STANDARDS = catalog.standards;
export const HISTORY_ACHIEVEMENT_RUBRIC_VERSION = rubrics.version;
export const HISTORY_ACHIEVEMENT_RUBRIC_SOURCE = rubrics.sourceTitle;
export const getHistoryAchievementRubric = (code: string) =>
  rubrics.standards.find((standard) => standard.code === code);
export const ACHIEVEMENT_LEVELS = ["A", "B", "C", "D", "E"] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];
export type AchievementDifficulty = "easy" | "medium" | "hard";

export interface HistoryAchievementMetadata {
  curriculumVersion?: string;
  achievementStandardCodes?: string[];
  achievementMappingSource?: "manual" | "unit";
  targetAchievementLevel?: AchievementLevel | "";
  intendedDifficulty?: AchievementDifficulty | "";
}

export interface HistoryAchievementUnit {
  id: string;
  title: string;
  children?: HistoryAchievementUnit[];
  curriculumVersion?: string;
  achievementStandardCodes?: string[];
}

const standardsByCode = new Map(
  HISTORY_ACHIEVEMENT_STANDARDS.map((standard) => [standard.code, standard]),
);
export const getHistoryAchievementStandard = (code: string) =>
  standardsByCode.get(code);

const normalizeTitle = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");

const validCodes = (codes: unknown): string[] =>
  Array.isArray(codes)
    ? [
        ...new Set(
          codes.filter(
            (code): code is string =>
              typeof code === "string" && standardsByCode.has(code),
          ),
        ),
      ]
    : [];

/** The deepest selected node is evidence; a broad domain alone is not a match. */
export const inferHistoryAchievementStandards = (
  tree: HistoryAchievementUnit[],
  unitIds: (string | null | undefined)[],
): {
  codes: string[];
  candidates: string[];
  source: "unit" | "none";
  ambiguous: boolean;
} => {
  const selected = new Set(unitIds.filter(Boolean));
  const paths: HistoryAchievementUnit[][] = [];
  const visit = (
    nodes: HistoryAchievementUnit[],
    parents: HistoryAchievementUnit[],
  ) => {
    for (const node of nodes) {
      const path = [...parents, node];
      if (selected.has(node.id)) paths.push(path);
      visit(node.children || [], path);
    }
  };
  visit(tree, []);
  const path = paths.sort((a, b) => b.length - a.length)[0];
  const empty = {
    codes: [],
    candidates: [],
    source: "none" as const,
    ambiguous: false,
  };
  if (!path) return empty;
  for (const node of [...path].reverse()) {
    if (node.curriculumVersion === HISTORY_ACHIEVEMENT_CURRICULUM_VERSION) {
      const codes = validCodes(node.achievementStandardCodes);
      if (codes.length)
        return { codes, candidates: codes, source: "unit", ambiguous: false };
    }
  }
  const domain = HISTORY_ACHIEVEMENT_STANDARDS.find((standard) =>
    path.some((node) =>
      normalizeTitle(node.title).includes(normalizeTitle(standard.domainTitle)),
    ),
  )?.domainCode;
  const candidates = HISTORY_ACHIEVEMENT_STANDARDS.filter(
    (standard) => !domain || standard.domainCode === domain,
  );
  for (const node of [...path].reverse()) {
    const title = normalizeTitle(node.title);
    const direct = candidates.filter((standard) =>
      title.includes(normalizeTitle(standard.code)),
    );
    const matches = direct.length
      ? direct
      : candidates.filter((standard) =>
          standard.keywords.some((keyword) =>
            title.includes(normalizeTitle(keyword)),
          ),
        );
    // Even different-length matches can describe distinct evaluated skills.
    // Never use the first result or a score tie-breaker to choose a standard.
    if (matches.length === 1)
      return {
        codes: [matches[0].code],
        candidates: [matches[0].code],
        source: "unit",
        ambiguous: false,
      };
    if (matches.length > 1)
      return {
        codes: [],
        candidates: matches.map((standard) => standard.code),
        source: "none",
        ambiguous: true,
      };
  }
  return domain
    ? {
        codes: [],
        candidates: candidates.map((standard) => standard.code),
        source: "none",
        ambiguous: true,
      }
    : empty;
};

export const resolveQuestionAchievement = (
  question: HistoryAchievementMetadata & {
    unitId?: string | null;
    subUnitId?: string | null;
    refBig?: string | null;
    refMid?: string | null;
    refSmall?: string | null;
  },
  tree: HistoryAchievementUnit[],
): {
  codes: string[];
  source: "manual" | "unit" | "unit-inferred" | "none";
} => {
  if (
    question.curriculumVersion &&
    question.curriculumVersion !== HISTORY_ACHIEVEMENT_CURRICULUM_VERSION
  )
    return { codes: [], source: "none" };
  const codes = validCodes(question.achievementStandardCodes);
  if (
    codes.length &&
    question.curriculumVersion === HISTORY_ACHIEVEMENT_CURRICULUM_VERSION
  )
    return {
      codes,
      source: question.achievementMappingSource === "unit" ? "unit" : "manual",
    };
  // An explicit manual clearing must stay cleared, including after a reload.
  if (question.achievementMappingSource === "manual")
    return { codes: [], source: "none" };
  const inferred = inferHistoryAchievementStandards(tree, [
    question.refSmall,
    question.subUnitId,
    question.refMid,
    question.refBig,
    question.unitId,
  ]);
  return {
    codes: inferred.codes,
    source: inferred.codes.length ? "unit-inferred" : "none",
  };
};

export const normalizeHistoryAchievementMetadata = (
  value: HistoryAchievementMetadata,
): HistoryAchievementMetadata =>
  !value.curriculumVersion &&
  !value.achievementStandardCodes &&
  !value.achievementMappingSource &&
  !value.targetAchievementLevel &&
  !value.intendedDifficulty
    ? {}
    : {
        curriculumVersion: HISTORY_ACHIEVEMENT_CURRICULUM_VERSION,
        achievementStandardCodes: validCodes(value.achievementStandardCodes),
        achievementMappingSource:
          value.achievementMappingSource === "unit"
            ? ("unit" as const)
            : ("manual" as const),
        targetAchievementLevel: value.targetAchievementLevel || "",
        intendedDifficulty: value.intendedDifficulty || "",
      };

export const validateHistoryAchievementMetadata = (
  value: HistoryAchievementMetadata,
) => {
  if (
    value.curriculumVersion &&
    value.curriculumVersion !== HISTORY_ACHIEVEMENT_CURRICULUM_VERSION
  )
    return "2018 개정 중학교 역사② 성취기준을 선택해 주세요.";
  if (
    (value.achievementStandardCodes || []).length > 5 ||
    (value.achievementStandardCodes || []).some(
      (code) => !standardsByCode.has(code),
    )
  )
    return "역사② 성취기준을 최대 5개까지 선택해 주세요.";
  if (
    value.targetAchievementLevel &&
    !ACHIEVEMENT_LEVELS.includes(value.targetAchievementLevel)
  )
    return "목표 성취수준을 다시 선택해 주세요.";
  if (
    value.intendedDifficulty &&
    !["easy", "medium", "hard"].includes(value.intendedDifficulty)
  )
    return "예상 난이도를 다시 선택해 주세요.";
  if (
    !(value.achievementStandardCodes || []).length &&
    (value.targetAchievementLevel || value.intendedDifficulty)
  )
    return "목표 성취수준과 예상 난이도를 등록하려면 성취기준을 먼저 선택해 주세요.";
  return "";
};
