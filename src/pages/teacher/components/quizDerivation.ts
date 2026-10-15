interface DerivationContent {
  type: string;
  question: string;
  passage?: string | null;
  image?: string | null;
  options?: string[];
  choiceOptionImages?: (string | null)[];
  matchingPairs?: { left: string; right: string; rightImage?: string | null }[];
  answer?: string | number;
}

const normalizeContent = (question: DerivationContent) => {
  const type = question.type;
  const options = (
    question.options ||
    (type === "order" ? String(question.answer || "").split("||") : [])
  )
    .map((value, index) => ({
      text:
        value.trim() ||
        (question.choiceOptionImages?.[index] ? `${index + 1}번 보기` : ""),
      image:
        type === "choice" ? question.choiceOptionImages?.[index] || null : null,
    }))
    .filter((item) => item.text);
  const matchingPairs =
    type === "matching"
      ? (question.matchingPairs?.length
          ? question.matchingPairs
          : String(question.answer || "")
              .split("||")
              .map((value) => {
                const [left = "", right = ""] = value.split("=>");
                return { left, right };
              })
        ).map((pair) => ({
          left: pair.left.trim(),
          right: pair.right.trim(),
          image: "rightImage" in pair ? pair.rightImage || null : null,
        }))
      : [];
  return {
    type,
    question: question.question.trim(),
    passage:
      type === "choice" || type === "word"
        ? (question.passage || "").trim()
        : "",
    image: question.image || null,
    options: type === "choice" || type === "order" ? options : [],
    matchingPairs,
  };
};

/** Changing only the key/answer, explanation or tags cannot create a new problem. */
export const hasQuizDerivationContentChange = (
  source: DerivationContent,
  draft: DerivationContent,
) =>
  JSON.stringify(normalizeContent(source)) !==
  JSON.stringify(normalizeContent(draft));
