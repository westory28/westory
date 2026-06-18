export type QuizPassageMarkType = "underline" | "box" | "bullet";

export interface QuizPassageSegment {
  type: "text" | QuizPassageMarkType;
  text: string;
}

const BULLET_TOKEN = "{{bullet}}";
const INLINE_MARK_TOKEN_PATTERN = /\{\{(u|box):([\s\S]*?)\}\}/g;
const LEGACY_BULLET_TOKEN_PATTERN = /\{\{bullet:([^{}]*?)\}\}/g;
const LEGACY_BULLET_PREFIX = "{{bullet:";
const BOX_MARK_SPACING = "   ";
const HORIZONTAL_SPACE_PATTERN = /[ \t]/;

const getTokenName = (type: QuizPassageMarkType) =>
  type === "underline" ? "u" : type;

const getSegmentType = (tokenName: string): QuizPassageMarkType =>
  tokenName === "u" ? "underline" : "box";

const normalizeLegacyBulletLine = (line: string) => {
  const simpleLine = line.replace(
    LEGACY_BULLET_TOKEN_PATTERN,
    `${BULLET_TOKEN}$1`,
  );
  const tokenStart = simpleLine.indexOf(LEGACY_BULLET_PREFIX);
  if (tokenStart === -1) return simpleLine;

  const beforeToken = simpleLine.slice(0, tokenStart);
  if (beforeToken.trim()) return simpleLine;

  const contentStart = tokenStart + LEGACY_BULLET_PREFIX.length;
  if (simpleLine.startsWith("}}", contentStart)) {
    return `${beforeToken}${BULLET_TOKEN}${simpleLine.slice(contentStart + 2)}`;
  }

  const suffixStart = simpleLine.lastIndexOf("}}");
  if (suffixStart >= contentStart) {
    return `${beforeToken}${BULLET_TOKEN}${simpleLine.slice(
      contentStart,
      suffixStart,
    )}${simpleLine.slice(suffixStart + 2)}`;
  }

  return `${beforeToken}${BULLET_TOKEN}${simpleLine.slice(contentStart)}`;
};

const normalizeBulletMarkup = (value: string) =>
  value
    .split(/(\r?\n)/)
    .map((part) =>
      /^\r?\n$/.test(part) ? part : normalizeLegacyBulletLine(part),
    )
    .join("");

const parseInlineMarkup = (value: string): QuizPassageSegment[] => {
  const segments: QuizPassageSegment[] = [];
  let lastIndex = 0;

  value.replace(INLINE_MARK_TOKEN_PATTERN, (match, tokenName, text, offset) => {
    if (offset > lastIndex) {
      segments.push({ type: "text", text: value.slice(lastIndex, offset) });
    }
    segments.push({ type: getSegmentType(tokenName), text });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < value.length) {
    segments.push({ type: "text", text: value.slice(lastIndex) });
  }

  return segments;
};

export const parseQuizPassageMarkup = (
  value: string | null | undefined,
): QuizPassageSegment[] => {
  const source = normalizeBulletMarkup(String(value || ""));
  const segments: QuizPassageSegment[] = [];
  const parts = source.split(/(\r?\n)/);

  parts.forEach((part) => {
    if (!part) return;
    if (/^\r?\n$/.test(part)) {
      segments.push({ type: "text", text: part });
      return;
    }

    const bulletMatch = /^(\s*)\{\{bullet\}\}\s?([\s\S]*)$/.exec(part);
    if (bulletMatch) {
      segments.push({ type: "bullet", text: bulletMatch[2] });
      return;
    }

    segments.push(...parseInlineMarkup(part));
  });

  return segments.length > 0 ? segments : [{ type: "text", text: source }];
};

export const stripQuizPassageMarkup = (value: string | null | undefined) =>
  normalizeBulletMarkup(String(value || ""))
    .replace(INLINE_MARK_TOKEN_PATTERN, "$2")
    .replaceAll(BULLET_TOKEN, "");

const findLineStart = (value: string, index: number) =>
  value.lastIndexOf("\n", Math.max(0, index - 1)) + 1;

const findLineEnd = (value: string, index: number) => {
  const nextLineBreak = value.indexOf("\n", index);
  return nextLineBreak === -1 ? value.length : nextLineBreak;
};

const applyBulletMark = (value: string, start: number, end: number) => {
  const blockStart = findLineStart(value, start);
  const selectionEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const blockEnd = findLineEnd(value, selectionEnd);
  const block = value.slice(blockStart, blockEnd);
  const markedBlock = block.trim()
    ? block
        .split(/(\r?\n)/)
        .map((part) => {
          if (!part || /^\r?\n$/.test(part)) return part;
          const indent = /^(\s*)/.exec(part)?.[1] || "";
          const content = part.slice(indent.length);
          if (!content.trim()) return `${indent}${BULLET_TOKEN}${content}`;
          const normalizedContent = normalizeBulletMarkup(content);
          if (normalizedContent.startsWith(BULLET_TOKEN)) {
            return `${indent}${normalizedContent}`;
          }
          return `${indent}${BULLET_TOKEN}${content}`;
        })
        .join("")
    : `${block}${BULLET_TOKEN}`;

  return {
    value: `${value.slice(0, blockStart)}${markedBlock}${value.slice(blockEnd)}`,
    selectionStart: blockStart,
    selectionEnd: blockStart + markedBlock.length,
  };
};

const findHorizontalSpaceStart = (value: string, index: number) => {
  let cursor = index;
  while (
    cursor > 0 &&
    HORIZONTAL_SPACE_PATTERN.test(value.charAt(cursor - 1))
  ) {
    cursor -= 1;
  }
  return cursor;
};

const findHorizontalSpaceEnd = (value: string, index: number) => {
  let cursor = index;
  while (
    cursor < value.length &&
    HORIZONTAL_SPACE_PATTERN.test(value.charAt(cursor))
  ) {
    cursor += 1;
  }
  return cursor;
};

const trimSelectedHorizontalSpaces = (text: string) => {
  let startOffset = 0;
  let endOffset = text.length;

  while (
    startOffset < endOffset &&
    HORIZONTAL_SPACE_PATTERN.test(text.charAt(startOffset))
  ) {
    startOffset += 1;
  }
  while (
    endOffset > startOffset &&
    HORIZONTAL_SPACE_PATTERN.test(text.charAt(endOffset - 1))
  ) {
    endOffset -= 1;
  }

  return {
    text: text.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
};

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

  if (markType === "bullet") {
    return applyBulletMark(value, start, end);
  }

  const tokenName = getTokenName(markType);
  const prefix = `{{${tokenName}:`;
  const suffix = "}}";
  const selectedText = value.slice(start, end);

  if (markType === "box") {
    const trimmedSelection = trimSelectedHorizontalSpaces(selectedText);
    const contentStart = start + trimmedSelection.startOffset;
    const contentEnd = start + trimmedSelection.endOffset;
    const replaceStart = findHorizontalSpaceStart(value, contentStart);
    const replaceEnd = findHorizontalSpaceEnd(value, contentEnd);
    const markedText = `${BOX_MARK_SPACING}${prefix}${trimmedSelection.text}${suffix}${BOX_MARK_SPACING}`;
    const nextSelectionStart =
      replaceStart + BOX_MARK_SPACING.length + prefix.length;

    return {
      value: `${value.slice(0, replaceStart)}${markedText}${value.slice(
        replaceEnd,
      )}`,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionStart + trimmedSelection.text.length,
    };
  }

  const markedText = `${prefix}${selectedText}${suffix}`;

  return {
    value: `${value.slice(0, start)}${markedText}${value.slice(end)}`,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selectedText.length,
  };
};
