export type MockExamChoiceColumns = 1 | 2 | 3 | 5;

export function formatMockExamChoiceLabel(value: string): string {
  const marker = value.trim().match(/^\(\s*([\p{L}\p{N}])\s*\)$/u);
  return marker ? `(${marker[1]})` : value;
}

// Approximate em widths keep the paper and its wider previews in the same layout.
// Noto Serif KR uses full-width Korean/CJK glyphs and narrower Latin punctuation.
export function measureMockExamChoiceWidth(value: string): number {
  return Array.from(value.normalize("NFC")).reduce((width, character) => {
    if (/\p{Mark}/u.test(character)) return width;
    if (/\s/u.test(character)) return width + 0.33;
    if (/[A-Za-z0-9]/u.test(character)) return width + 0.55;
    if (/[()[\]{}.,:;'"!|]/u.test(character)) return width + 0.35;
    return width + 1;
  }, 0);
}

export function getMockExamChoiceColumns(
  options: readonly string[],
  images?: readonly (string | null | undefined)[],
): MockExamChoiceColumns {
  if (options.length !== 5 || images?.some(Boolean)) return 1;

  const labels = options.map((option) =>
    formatMockExamChoiceLabel(option).trim(),
  );
  if (labels.some((label) => !label || /[\r\n]/u.test(label))) return 1;
  const widths = labels.map((label) =>
    measureMockExamChoiceWidth(label.replace(/\s+/gu, " ")),
  );
  const widest = Math.max(...widths);
  const longestWord = Math.max(
    ...labels.flatMap((label) =>
      label.split(/\s+/u).map(measureMockExamChoiceWidth),
    ),
  );

  // Whole-word limits avoid squeezing an unbroken term into a narrow column.
  // Longer phrases may wrap at spaces while retaining 3+2 or 2+2+1 choice rows.
  if (widest <= 2.5 && longestWord <= 2.5) return 5;
  if (widest <= 8 && longestWord <= 4) return 3;
  if (widest <= 14 && longestWord <= 6) return 2;
  return 1;
}
