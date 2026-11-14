/** Pure parser shared by workbook import and read-only analysis. */
export const parseWrittenExamEssayFeedback = (value: unknown) => {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&#(?:x20|32);|&nbsp;/gi, " ")
    .trim();
  if (!text || text === "-") {
    return {
      fullText: "",
      generalFeedback: "",
      byItemKey: new Map<string, string>(),
    };
  }

  // The rubric export uses one essay question with line-start (1), (2), ...
  // sections. References to (1) inside a reason must stay in that reason.
  const pattern =
    /(\d+)\s*-\s*[\(\[]?\s*(\d+)\s*[\)\]]?\s*[:：]|(?:^|\n)[\t ]*[（(](\d+)[）)][\t ]*[:：]?[\t ]*/g;
  const matches = Array.from(text.matchAll(pattern));
  if (!matches.length) {
    return {
      fullText: text,
      generalFeedback: text,
      byItemKey: new Map<string, string>(),
    };
  }

  const byItemKey = new Map<string, string>();
  let generalFeedback = text.slice(0, matches[0].index || 0).trim();
  matches.forEach((match, index) => {
    const key = match[3] ? `1-(${match[3]})` : `${match[1]}-(${match[2]})`;
    const start = (match.index || 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index || text.length
        : text.length;
    const feedback = text.slice(start, end).trim();
    if (feedback) byItemKey.set(key, feedback);
  });

  if (!generalFeedback && byItemKey.size === 0) generalFeedback = text;

  return {
    fullText: text,
    generalFeedback,
    byItemKey,
  };
};
