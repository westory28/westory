export type QuizPassageMarkType = "underline" | "box" | "bullet";

export interface QuizPassageSegment {
  type: "text" | QuizPassageMarkType;
  text: string;
}

const MARK_TOKEN_PATTERN = /\{\{(u|box|bullet):([\s\S]*?)\}\}/g;

const getTokenName = (type: QuizPassageMarkType) =>
  type === "underline" ? "u" : type;

const getSegmentType = (tokenName: string): QuizPassageMarkType =>
  tokenName === "u" ? "underline" : tokenName === "box" ? "box" : "bullet";

const buildMarkedText = (
  selectedText: string,
  prefix: string,
  suffix: string,
  markType: QuizPassageMarkType,
) => {
  if (markType !== "bullet" || !selectedText) {
    return `${prefix}${selectedText}${suffix}`;
  }

  return selectedText
    .split(/(\r?\n+)/)
    .map((part) => {
      if (!part || /^\r?\n+$/.test(part) || !part.trim()) return part;
      return `${prefix}${part}${suffix}`;
    })
    .join("");
};

export const parseQuizPassageMarkup = (
  value: string | null | undefined,
): QuizPassageSegment[] => {
  const source = String(value || "");
  const segments: QuizPassageSegment[] = [];
  let lastIndex = 0;

  source.replace(MARK_TOKEN_PATTERN, (match, tokenName, text, offset) => {
    if (offset > lastIndex) {
      segments.push({ type: "text", text: source.slice(lastIndex, offset) });
    }
    segments.push({ type: getSegmentType(tokenName), text });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < source.length) {
    segments.push({ type: "text", text: source.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text: source }];
};

export const stripQuizPassageMarkup = (value: string | null | undefined) =>
  String(value || "").replace(MARK_TOKEN_PATTERN, "$2");

export const applyQuizPassageMark = ({
  value,
  selectionStart,
  selectionEnd,
  markType,
}: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  markType: QuizPassageMarkType;
}) => {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const tokenName = getTokenName(markType);
  const prefix = `{{${tokenName}:`;
  const suffix = "}}";
  const selectedText = value.slice(start, end);
  const markedText = buildMarkedText(selectedText, prefix, suffix, markType);
  const nextSelectionStart =
    markType === "bullet" && selectedText ? start : start + prefix.length;
  const nextSelectionEnd =
    markType === "bullet" && selectedText
      ? start + markedText.length
      : start + prefix.length + selectedText.length;

  return {
    value: `${value.slice(0, start)}${markedText}${value.slice(end)}`,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  };
};
