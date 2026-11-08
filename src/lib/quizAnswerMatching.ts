/** Comma-separated alternatives apply only to short-answer question keys. */
export const getAcceptedQuizAnswers = (expected: unknown): string[] =>
  String(expected ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export function isQuizAnswerCorrect(
  type: string | undefined,
  actual: unknown,
  expected: unknown,
): boolean {
  const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
  const answer = normalize(actual);
  if (!answer) return false;
  const accepted =
    type === "short" || type === "word"
      ? getAcceptedQuizAnswers(expected)
      : [String(expected ?? "")];
  return accepted.some((value) => answer === normalize(value));
}
