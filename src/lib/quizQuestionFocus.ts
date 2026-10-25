const normalizeSpaces = (value: string) => value.replace(/\s+/gu, " ").trim();

/** A display label from authored concepts, with only a conservative term fallback. */
export function quizQuestionFocus(question: {
  concepts?: readonly string[];
  type?: string;
  answer?: unknown;
}): string {
  const concepts = [
    ...new Set(
      (Array.isArray(question.concepts) ? question.concepts : [])
        .filter((concept): concept is string => typeof concept === "string")
        .map(normalizeSpaces)
        .filter(Boolean),
    ),
  ];
  if (concepts.length) return concepts.slice(0, 2).join(" · ");

  if (
    (question.type !== "word" && question.type !== "short") ||
    typeof question.answer !== "string"
  )
    return "개념 미등록";

  const rawAnswer = question.answer.trim();
  const answer = normalizeSpaces(rawAnswer);
  // Do not infer a concept from a sentence, multiple answers, or rich content.
  // A single compact term avoids guessing whether a phrase is one concept.
  if (
    !answer ||
    [...answer].length > 12 ||
    /[\r\n\t]/u.test(rawAnswer) ||
    !/^[\p{L}\p{N}]+$/u.test(answer) ||
    !/\p{L}/u.test(answer) ||
    /^(?:o|x|ox|t|f|true|false|yes|no)$/iu.test(answer.normalize("NFKC")) ||
    /[가-힣](?:다|요|까)$/u.test(answer)
  )
    return "개념 미등록";

  return answer;
}
