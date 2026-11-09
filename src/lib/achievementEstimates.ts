import type {
  AchievementDifficulty,
  AchievementLevel,
  AchievementMetadata,
  AchievementQuestion,
} from "./achievementAnalysis";

const ACHIEVEMENT_LEVELS = ["A", "B", "C", "D", "E"] as const;
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
// at about 65%. The logistic spacing below is Westory's explicit
// reference-model assumptions, NOT an official standard-setting formula/IRT fit.
export const boundaryProbability = (
  ability: number,
  itemTarget: AchievementLevel,
) =>
  1 /
  (1 + Math.exp(-(Math.log(0.65 / 0.35) + 0.8 * (ability - rank[itemTarget]))));

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
