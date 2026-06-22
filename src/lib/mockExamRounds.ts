export const MOCK_EXAM_CATEGORY = "exam_prep";
export const MOCK_EXAM_UNIT_ID = "exam_prep";
export const DEFAULT_MOCK_EXAM_ROUND = "round_1";
const MOCK_EXAM_RESULT_CATEGORY_SEPARATOR = "__";

export const MOCK_EXAM_ROUNDS = ["round_1", "round_2", "round_3"] as const;

export type MockExamRound = (typeof MOCK_EXAM_ROUNDS)[number];

export const isMockExamRound = (value: unknown): value is MockExamRound =>
  MOCK_EXAM_ROUNDS.includes(value as MockExamRound);

const getRawCategory = (category?: unknown) => String(category || "").trim();

export const getMockExamRoundFromCategory = (
  category?: unknown,
): MockExamRound | "" => {
  const raw = getRawCategory(category);
  const prefix = `${MOCK_EXAM_CATEGORY}${MOCK_EXAM_RESULT_CATEGORY_SEPARATOR}`;
  if (!raw.startsWith(prefix)) return "";
  const round = raw.slice(prefix.length);
  return isMockExamRound(round) ? round : "";
};

export const isMockExamCategory = (category?: unknown) => {
  const raw = getRawCategory(category);
  return (
    raw === MOCK_EXAM_CATEGORY || Boolean(getMockExamRoundFromCategory(raw))
  );
};

export const normalizeMockExamCategory = (category?: unknown) =>
  isMockExamCategory(category) ? MOCK_EXAM_CATEGORY : getRawCategory(category);

export const normalizeMockExamRound = (
  value: unknown,
  fallback: MockExamRound = DEFAULT_MOCK_EXAM_ROUND,
): MockExamRound => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  if (isMockExamRound(raw)) return raw;

  const numeric = raw.match(/\d+/)?.[0];
  const byNumber = numeric ? `round_${Number(numeric)}` : "";
  return isMockExamRound(byNumber) ? byNumber : fallback;
};

export const getMockExamRoundNumber = (round: unknown) => {
  const normalized = normalizeMockExamRound(round);
  return Number(normalized.replace("round_", "")) || 1;
};

export const formatMockExamRoundLabel = (round: unknown) =>
  `모의고사 ${getMockExamRoundNumber(round)}회`;

export const getMockExamResultCategory = (
  category: unknown,
  round: unknown,
) => {
  const normalizedCategory = normalizeMockExamCategory(category);
  if (normalizedCategory !== MOCK_EXAM_CATEGORY) return normalizedCategory;

  const normalizedRound = normalizeMockExamRound(round);
  return normalizedRound === DEFAULT_MOCK_EXAM_ROUND
    ? MOCK_EXAM_CATEGORY
    : `${MOCK_EXAM_CATEGORY}${MOCK_EXAM_RESULT_CATEGORY_SEPARATOR}${normalizedRound}`;
};

export const getResultMockExamRound = (category: unknown, round: unknown) =>
  isMockExamCategory(category)
    ? getMockExamRoundFromCategory(category) || normalizeMockExamRound(round)
    : "";

export const mockExamRoundMatches = (
  category: unknown,
  actualRound: unknown,
  expectedRound: unknown,
) => {
  if (!isMockExamCategory(category)) return true;
  if (!expectedRound) return true;
  return (
    getResultMockExamRound(category, actualRound) ===
    normalizeMockExamRound(expectedRound)
  );
};
