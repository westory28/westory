export const QUIZ_CHOICE_COLUMN_LABELS = [
  "가",
  "나",
  "다",
  "라",
  "마",
] as const;

/** Only explicitly labelled, tab-separated cells are treated as column choices. */
export function decodeQuizChoiceColumns(value: string): string[] | null {
  const parts = value.split("\t");
  if (parts.length < 2 || parts.length > QUIZ_CHOICE_COLUMN_LABELS.length)
    return null;
  const cells: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = `(${QUIZ_CHOICE_COLUMN_LABELS[index]})`;
    const part = parts[index];
    if (
      /[\r\n]/u.test(part) ||
      (part !== prefix && !part.startsWith(`${prefix} `))
    )
      return null;
    cells.push(part === prefix ? "" : part.slice(prefix.length + 1));
  }
  return cells;
}

/** Keep the existing options/answer string contract, including blank draft cells. */
export function encodeQuizChoiceColumns(cells: readonly string[]): string {
  if (cells.length > QUIZ_CHOICE_COLUMN_LABELS.length)
    throw new RangeError("선지 열은 최대 5개입니다.");
  if (cells.length <= 1) return cells[0] || "";
  const clean = cells.map((cell) => cell.replace(/[\t\r\n]+/gu, " "));
  return clean
    .map((cell, index) => `(${QUIZ_CHOICE_COLUMN_LABELS[index]}) ${cell}`)
    .join("\t");
}

export function getQuizChoiceColumnCount(options: readonly string[]): number {
  if (!options.length) return 1;
  const count = decodeQuizChoiceColumns(options[0])?.length;
  return count &&
    options.every((option) => decodeQuizChoiceColumns(option)?.length === count)
    ? count
    : 1;
}

export function formatQuizChoiceText(value: string): string {
  const cells = decodeQuizChoiceColumns(value);
  return cells
    ? cells
        .map(
          (cell, index) =>
            `(${QUIZ_CHOICE_COLUMN_LABELS[index]}) ${cell.trim()}`,
        )
        .join(" · ")
    : value;
}

/** Canonicalize only at the payload/preview boundary, never while typing. */
export function normalizeQuizChoiceOption(value: string): string {
  const cells = decodeQuizChoiceColumns(value);
  return cells
    ? encodeQuizChoiceColumns(cells.map((cell) => cell.trim()))
    : value.trim();
}
