export const SHORT_ANSWER_MAX_LENGTH = 20;

// Grading ignores whitespace. A teacher's model answer must be possible to enter.
export const exceedsShortAnswerLimit = (answer: string) =>
  answer.replace(/\s+/g, "").length > SHORT_ANSWER_MAX_LENGTH;

// Match the native input maxlength unit and avoid splitting an emoji in a recovered draft.
export function limitShortAnswer(value: string) {
  if (value.length <= SHORT_ANSWER_MAX_LENGTH) return value;
  return value
    .slice(0, SHORT_ANSWER_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, "");
}

export function restoreAssessmentAnswers(
  answers: Record<string, string>,
  items: ReadonlyArray<{ id: string | number; type?: string }>,
) {
  const restored: Record<string, string> = {};
  let changed = false;
  for (const item of items) {
    const id = String(item.id);
    if (!Object.prototype.hasOwnProperty.call(answers, id)) continue;
    const value = answers[id];
    if (typeof value !== "string") continue;
    // History classroom blanks have no type. Quiz selections retain the full option text.
    restored[id] =
      !item.type || item.type === "short" || item.type === "word"
        ? limitShortAnswer(value)
        : value;
    if (restored[id] !== value) changed = true;
  }
  return {
    answers: restored,
    changed:
      changed || Object.keys(restored).length !== Object.keys(answers).length,
  };
}
