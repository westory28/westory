import {
  ACHIEVEMENT_LEVELS,
  achievementTimestamp,
  type AchievementDifficulty,
  type AchievementEvidence,
  type AchievementLevel,
  type AchievementMetadata,
  type AchievementObservation,
  type AchievementQuestion,
  type AchievementStudent,
} from "./achievementAnalysis";

export const ESTIMATE_MODEL_VERSION = "westory-reference-2026-11-08";
export const ESTIMATE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
const rank = { A: 4, B: 3, C: 2, D: 1, E: 0 };
const defaultTarget = { easy: "D", medium: "C", hard: "B" } as const;
const isLevel = (value: unknown): value is AchievementLevel =>
  ACHIEVEMENT_LEVELS.includes(value as AchievementLevel);
const isDifficulty = (value: unknown): value is AchievementDifficulty =>
  ESTIMATE_DIFFICULTIES.includes(value as AchievementDifficulty);
const target = (item: AchievementMetadata) =>
  isLevel(item.targetAchievementLevel)
    ? item.targetAchievementLevel
    : defaultTarget[
        isDifficulty(item.intendedDifficulty)
          ? item.intendedDifficulty
          : "medium"
      ];

// The supplied Gyeonggi handbook (pp. 12–17) anchors a target-level MC item
// at about 65%. The logistic spacing and prior below are Westory's explicit
// reference-model assumptions, NOT an official standard-setting formula/IRT fit.
export const boundaryProbability = (
  ability: number,
  itemTarget: AchievementLevel,
) =>
  1 /
  (1 + Math.exp(-(Math.log(0.65 / 0.35) + 0.8 * (ability - rank[itemTarget]))));

export interface CurrentAchievementEstimate {
  student: AchievementStudent;
  code: string;
  level: AchievementLevel | null;
  possibleLevels: AchievementLevel[];
  evidenceCount: number;
  correctCount: number;
  observedPercent: number | null;
  provisional: boolean;
}

export interface AchievementEstimateReport {
  standards: Array<{
    code: string;
    students: CurrentAchievementEstimate[];
    counts: Record<AchievementLevel, number>;
    unknownCount: number;
  }>;
  excludedCount: number;
  asOf: number | null;
}

type Resolver = (value: AchievementMetadata) => {
  codes: string[];
  source: string;
};
const levelAt = (ability: number): AchievementLevel =>
  ability >= 4
    ? "A"
    : ability >= 3
      ? "B"
      : ability >= 2
        ? "C"
        : ability >= 1
          ? "D"
          : "E";

function estimateStudent(
  student: AchievementStudent,
  code: string,
  observations: AchievementObservation[],
): CurrentAchievementEstimate {
  const correctCount = observations.filter((item) => item.correct).length;
  const base = {
    student,
    code,
    evidenceCount: observations.length,
    correctCount,
    observedPercent: observations.length
      ? (correctCount / observations.length) * 100
      : null,
    provisional: observations.some(
      (item) =>
        item.hintViewed !== false ||
        item.quality === "limited" ||
        !isLevel(item.targetAchievementLevel),
    ),
  };
  if (observations.length < 3)
    return { ...base, level: null, possibleLevels: [] };
  // Weak centre prior prevents a few all-correct/all-wrong answers from forcing
  // extreme levels. Repeated question families contribute only once upstream.
  const grid = Array.from({ length: 161 }, (_, index) => {
    const ability = -2 + index * 0.05;
    const logLikelihood = observations.reduce(
      (sum, observation) => {
        const probability = boundaryProbability(ability, target(observation));
        const weight = observation.hintViewed === false ? 1 : 0.5;
        return (
          sum +
          weight * Math.log(observation.correct ? probability : 1 - probability)
        );
      },
      -Math.pow(ability - 2, 2) / (2 * 1.5 ** 2),
    );
    return { ability, logLikelihood };
  });
  const best = grid.reduce((a, b) =>
    b.logLikelihood > a.logLikelihood ? b : a,
  );
  const weights = grid.map((item) =>
    Math.exp(item.logLikelihood - best.logLikelihood),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  let low: number | null = null;
  let high = grid.at(-1)!.ability;
  for (let i = 0; i < grid.length; i++) {
    cumulative += weights[i] / total;
    if (low === null && cumulative >= 0.1) low = grid[i].ability;
    if (cumulative >= 0.9) {
      high = grid[i].ability;
      break;
    }
  }
  const levels = ACHIEVEMENT_LEVELS.filter(
    (value) =>
      rank[value] <= rank[levelAt(high)] &&
      rank[value] >= rank[levelAt(low ?? -2)],
  );
  return {
    ...base,
    level: levelAt(best.ability),
    possibleLevels: [...levels],
    provisional: base.provisional || levels.length > 1,
  };
}

export function buildCurrentAchievementEstimates(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  questions: readonly AchievementQuestion[];
  evidence: AchievementEvidence;
  resolveCodes: Resolver;
  asOf: unknown;
}): AchievementEstimateReport {
  const asOf = achievementTimestamp(input.asOf);
  const owners = new Set(input.students.map((student) => student.uid));
  const codes = new Set(
    input.questions.flatMap((question) => input.resolveCodes(question).codes),
  );
  const byStudent = new Map<string, Map<string, AchievementObservation>>();
  const tied = new Set<string>();
  const unsupportedFirst = new Set<string>();
  let excludedCount = 0;
  for (const observation of input.evidence.observations) {
    const at = achievementTimestamp(observation.observedAt);
    if (
      !owners.has(observation.studentUid) ||
      observation.semesterId !== input.semesterId ||
      !["diagnostic", "formative"].includes(observation.source) ||
      at === null ||
      asOf === null ||
      at > asOf ||
      !observation.itemId
    ) {
      excludedCount++;
      continue;
    }
    const relevant = input
      .resolveCodes(observation)
      .codes.filter((code) => codes.has(code));
    for (const code of relevant) {
      const ownerCode = `${observation.studentUid}:${code}`;
      const families =
        byStudent.get(ownerCode) || new Map<string, AchievementObservation>();
      const family = observation.familyId || `question:${observation.itemId}`;
      const existing = families.get(family);
      const existingAt = achievementTimestamp(existing?.observedAt);
      const tieKey = `${ownerCode}:${family}`;
      // First independent response per family; a later retry cannot inflate a level.
      if (!existing || at < existingAt!) {
        families.set(family, observation);
        tied.delete(tieKey);
      } else if (at === existingAt && existing.id !== observation.id)
        tied.add(tieKey);
      byStudent.set(ownerCode, families);
    }
  }
  const standards = [...codes].sort().map((code) => {
    const students = input.students.map((student) => {
      const key = `${student.uid}:${code}`;
      const rows = [...(byStudent.get(key) || [])]
        .filter(([family]) => !tied.has(`${key}:${family}`))
        .filter(([family, observation]) => {
          if (
            observation.hintViewed === true ||
            typeof observation.correct !== "boolean"
          ) {
            unsupportedFirst.add(`${key}:${family}`);
            return false;
          }
          return true;
        })
        .map(([, observation]) => observation);
      return estimateStudent(student, code, rows);
    });
    return {
      code,
      students,
      counts: Object.fromEntries(
        ACHIEVEMENT_LEVELS.map((value) => [
          value,
          students.filter((student) => student.level === value).length,
        ]),
      ) as Record<AchievementLevel, number>,
      unknownCount: students.filter((student) => !student.level).length,
    };
  });
  return {
    standards,
    excludedCount: excludedCount + tied.size + unsupportedFirst.size,
    asOf,
  };
}

export function buildEstimatedCutScores(
  questions: readonly AchievementQuestion[],
) {
  const weighted =
    questions.length > 0 &&
    questions.every(
      (question) =>
        typeof question.points === "number" &&
        Number.isFinite(question.points) &&
        question.points > 0,
    );
  const weight = (question: AchievementQuestion) =>
    weighted ? question.points! : 1;
  const totalWeight = questions.reduce(
    (sum, question) => sum + weight(question),
    0,
  );
  const assumedTargets = questions.filter(
    (question) => !isLevel(question.targetAchievementLevel),
  ).length;
  const probabilities = (
    items: readonly AchievementQuestion[],
    fallback: AchievementLevel,
  ) =>
    Object.fromEntries(
      ACHIEVEMENT_LEVELS.map((value) => [
        value,
        items.length
          ? (items.reduce(
              (sum, question) =>
                sum +
                weight(question) *
                  boundaryProbability(rank[value], target(question)),
              0,
            ) /
              items.reduce((sum, question) => sum + weight(question), 0)) *
            100
          : boundaryProbability(rank[value], fallback) * 100,
      ]),
    ) as Record<AchievementLevel, number>;
  const rows = [...ESTIMATE_DIFFICULTIES, "unassigned" as const].map(
    (difficulty) => {
      const items = questions.filter((question) =>
        difficulty === "unassigned"
          ? !isDifficulty(question.intendedDifficulty)
          : question.intendedDifficulty === difficulty,
      );
      return {
        difficulty,
        questionCount: items.length,
        points: weighted
          ? items.reduce((sum, question) => sum + weight(question), 0)
          : null,
        rates: probabilities(
          items,
          defaultTarget[difficulty === "unassigned" ? "medium" : difficulty],
        ),
      };
    },
  );
  return {
    rows,
    assumedTargets,
    weighted,
    totalPoints: weighted ? totalWeight : null,
    questionCount: questions.length,
    cuts: ACHIEVEMENT_LEVELS.map((value) => {
      const sum = questions.reduce(
        (total, question) =>
          total +
          weight(question) * boundaryProbability(rank[value], target(question)),
        0,
      );
      return {
        level: value,
        score: totalWeight && weighted ? sum : null,
        percent: totalWeight ? (sum / totalWeight) * 100 : null,
      };
    }),
  };
}
