export const MOCK_EXAM_CATEGORY = "exam_prep";
export const MOCK_EXAM_UNIT_ID = "exam_prep";
export const DEFAULT_MOCK_EXAM_ROUND = "round_1";

export const MOCK_EXAM_ROUNDS = ["round_1", "round_2", "round_3"] as const;

export type MockExamRound = (typeof MOCK_EXAM_ROUNDS)[number];

export const isMockExamRound = (value: unknown): value is MockExamRound =>
  MOCK_EXAM_ROUNDS.includes(value as MockExamRound);

export const isMockExamCategory = (category?: unknown) =>
  String(category || "").trim() === MOCK_EXAM_CATEGORY;

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

export const getResultMockExamRound = (category: unknown, round: unknown) =>
  isMockExamCategory(category) ? normalizeMockExamRound(round) : "";

export const mockExamRoundMatches = (
  category: unknown,
  actualRound: unknown,
  expectedRound: unknown,
) => {
  if (!isMockExamCategory(category)) return true;
  if (!expectedRound) return true;
  return (
    normalizeMockExamRound(actualRound) ===
    normalizeMockExamRound(expectedRound)
  );
};
