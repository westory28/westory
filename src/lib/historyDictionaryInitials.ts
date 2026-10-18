export const HISTORY_DICTIONARY_HANGUL_INITIALS = [
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

const syllableInitials = [
  "ㄱ",
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅂ",
  "ㅅ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

/** Classify only the displayed headword, never its aliases or meaning. */
export const getHistoryDictionaryInitial = (word: string): string => {
  const first =
    Array.from(
      String(word || "")
        .normalize("NFKC")
        .trim(),
    )[0] || "";
  if (!first) return "";
  const code = first.codePointAt(0)!;
  if (code >= 0xac00 && code <= 0xd7a3)
    return syllableInitials[Math.floor((code - 0xac00) / 588)];
  // NFKC turns compatibility consonants such as ㄱ into leading jamo.
  if (code >= 0x1100 && code <= 0x1112) return syllableInitials[code - 0x1100];
  return first.toLocaleLowerCase("en-US");
};

export const matchesHistoryDictionaryInitial = (
  word: string,
  value: string,
): boolean => {
  if (!value) return true;
  const initial = getHistoryDictionaryInitial(word);
  if (value === "0-9") return /^[0-9]$/.test(initial);
  if (value === "a-z") return /^[a-z]$/.test(initial);
  return initial === getHistoryDictionaryInitial(value);
};

export const getHistoryDictionaryInitialCounts = (
  words: string[],
): Record<string, number> => {
  const counts: Record<string, number> = {
    "": words.length,
    "0-9": 0,
    "a-z": 0,
  };
  for (const word of words) {
    const initial = getHistoryDictionaryInitial(word);
    if (!initial) continue;
    counts[initial] = (counts[initial] || 0) + 1;
    if (/^[0-9]$/.test(initial)) counts["0-9"] += 1;
    if (/^[a-z]$/.test(initial)) counts["a-z"] += 1;
  }
  return counts;
};
