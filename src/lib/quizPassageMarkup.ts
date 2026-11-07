export type QuizPassageMarkType = "underline" | "box" | "blank" | "bullet";

export interface QuizPassageSegment {
  type: "text" | "blankBox" | QuizPassageMarkType;
  text: string;
  widthEm?: number;
  bulletStyle?: "hangul";
}

export const quizPassageHangulMarker = (index: number) =>
  `${Array.from("ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ")[index] || index + 1}.`;

/** A paragraph label must start a line and be followed by space, not a particle. */
export const splitQuizPassageLeadingLabel = (value: string) => {
  const label = "\\([가-힣ㄱ-ㅎA-Za-z0-9]{1,3}\\)";
  const match = new RegExp(
    `^(${label}|\\{\\{(?:box|u):${label}\\}\\}|\\{\\{blankbox:\\d+(?:\\.\\d{1,3})?\\|${label}\\}\\})([ \\t]+)(\\S[\\s\\S]*)$`,
  ).exec(value);
  return match ? { label: match[1], gap: match[2], body: match[3] } : null;
};

export const isQuizPassageBlankLabel = (value: string) =>
  /^\([가-힣ㄱ-ㅎA-Za-z0-9]{1,3}\)$/u.test(value.trim());

const BULLET_TOKEN = "{{bullet}}";
const INLINE_MARK_TOKEN_PATTERN = /\{\{(u|box|blank|blankbox):([\s\S]*?)\}\}/g;
const LEGACY_BULLET_TOKEN_PATTERN = /\{\{bullet:([^{}]*?)\}\}/g;
const LEGACY_BULLET_PREFIX = "{{bullet:";
const HORIZONTAL_SPACE_PATTERN = /[ \t]/;

const getTokenName = (type: QuizPassageMarkType) =>
  type === "underline" ? "u" : type;

const getSegmentType = (tokenName: string): QuizPassageMarkType => {
  if (tokenName === "u") return "underline";
  if (tokenName === "blank") return "blank";
  return "box";
};

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
    if (tokenName === "blankbox") {
      const match = /^(\d+(?:\.\d{1,3})?)\|([^{}\r\n]{1,20})$/.exec(text);
      const widthEm = Number(match?.[1]);
      if (match && widthEm >= 1 && widthEm <= 30) {
        segments.push({ type: "blankBox", text: match[2], widthEm });
      } else {
        // Malformed private markup must never become visible developer syntax.
        segments.push({ type: "blankBox", text: "(가)", widthEm: 3 });
      }
    } else {
      segments.push({ type: getSegmentType(tokenName), text });
    }
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

    const bulletMatch = /^(\s*)\{\{(bullet|hangul)\}\}\s?([\s\S]*)$/.exec(part);
    if (bulletMatch) {
      segments.push({
        type: "bullet",
        text: bulletMatch[3],
        ...(bulletMatch[2] === "hangul"
          ? { bulletStyle: "hangul" as const }
          : {}),
      });
      return;
    }

    segments.push(...parseInlineMarkup(part));
  });

  return segments.length > 0 ? segments : [{ type: "text", text: source }];
};

export const stripQuizPassageMarkup = (value: string | null | undefined) =>
  normalizeBulletMarkup(String(value || ""))
    .replace(INLINE_MARK_TOKEN_PATTERN, (_match, tokenName, text) =>
      tokenName === "blank"
        ? "____"
        : tokenName === "blankbox"
          ? text.split("|").slice(1).join("|") || "(가)"
          : text,
    )
    .replace(/\{\{(?:bullet|hangul)\}\}/g, "");

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

  if (markType === "box" || markType === "blank") {
    const trimmedSelection = trimSelectedHorizontalSpaces(selectedText);
    const markStart = start + trimmedSelection.startOffset;
    const markEnd = start + trimmedSelection.endOffset;
    const markedText = `${prefix}${trimmedSelection.text}${suffix}`;
    const nextSelectionStart = markStart + prefix.length;

    return {
      value: `${value.slice(0, markStart)}${markedText}${value.slice(markEnd)}`,
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
