const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const FINALS = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
const VOWEL_PAIRS: Record<string, string> = {
  ㅗㅏ: "ㅘ",
  ㅗㅐ: "ㅙ",
  ㅗㅣ: "ㅚ",
  ㅜㅓ: "ㅝ",
  ㅜㅔ: "ㅞ",
  ㅜㅣ: "ㅟ",
  ㅡㅣ: "ㅢ",
};
const FINAL_PAIRS: Record<string, string> = {
  ㄱㅅ: "ㄳ",
  ㄴㅈ: "ㄵ",
  ㄴㅎ: "ㄶ",
  ㄹㄱ: "ㄺ",
  ㄹㅁ: "ㄻ",
  ㄹㅂ: "ㄼ",
  ㄹㅅ: "ㄽ",
  ㄹㅌ: "ㄾ",
  ㄹㅍ: "ㄿ",
  ㄹㅎ: "ㅀ",
  ㅂㅅ: "ㅄ",
};
const SPLIT_FINALS = Object.fromEntries(
  Object.entries(FINAL_PAIRS).map(([pair, final]) => [final, pair]),
);

const decomposeSyllable = (char: string) => {
  if (!char) return null;
  const offset = char.charCodeAt(0) - 0xac00;
  if (offset < 0 || offset >= 11172) return null;
  return {
    initial: Math.floor(offset / 588),
    vowel: Math.floor((offset % 588) / 28),
    final: offset % 28,
  };
};

const composeSyllable = (initial: number, vowel: number, final = 0) =>
  String.fromCharCode(0xac00 + initial * 588 + vowel * 28 + final);

const composeCompatibilityJamo = (value: string) => {
  const output: string[] = [];
  const chars = Array.from(value.normalize("NFC"));
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const last = output[output.length - 1] || "";
    const syllable = decomposeSyllable(last);
    const vowel = VOWELS.indexOf(char);
    const final = FINALS.indexOf(char);

    if (vowel !== -1) {
      if (syllable) {
        if (syllable.final) {
          const lastFinal = FINALS[syllable.final];
          const split = SPLIT_FINALS[lastFinal];
          const nextInitial = INITIALS.indexOf(split ? split[1] : lastFinal);
          output[output.length - 1] = composeSyllable(
            syllable.initial,
            syllable.vowel,
            split ? FINALS.indexOf(split[0]) : 0,
          );
          output.push(composeSyllable(nextInitial, vowel));
          continue;
        }
        const combined = VOWEL_PAIRS[VOWELS[syllable.vowel] + char];
        if (combined) {
          output[output.length - 1] = composeSyllable(
            syllable.initial,
            VOWELS.indexOf(combined),
          );
          continue;
        }
      } else {
        const initial = INITIALS.indexOf(last);
        if (last && initial !== -1) {
          output[output.length - 1] = composeSyllable(initial, vowel);
          continue;
        }
        const combined = VOWEL_PAIRS[last + char];
        if (combined) {
          output[output.length - 1] = combined;
          continue;
        }
      }
    } else if (syllable && final > 0) {
      // Keep standalone laughter (ㅋㅋ / ㅎㅎ), including incremental typing.
      // A first ㅋ/ㅎ may already have attached as a final on the last change.
      if ((char === "ㅋ" || char === "ㅎ") && FINALS[syllable.final] === char) {
        output[output.length - 1] = composeSyllable(
          syllable.initial,
          syllable.vowel,
        );
        output.push(char, char);
        continue;
      }
      if ((char === "ㅋ" || char === "ㅎ") && chars[index + 1] === char) {
        output.push(char);
        continue;
      }
      if (!syllable.final) {
        output[output.length - 1] = composeSyllable(
          syllable.initial,
          syllable.vowel,
          final,
        );
        continue;
      }
      const combined = FINAL_PAIRS[FINALS[syllable.final] + char];
      if (combined) {
        output[output.length - 1] = composeSyllable(
          syllable.initial,
          syllable.vowel,
          FINALS.indexOf(combined),
        );
        continue;
      }
    }
    // Completed syllables are kept intact; only a following compatibility
    // jamo can extend a syllable. Latin text and punctuation never enter here.
    output.push(char);
  }
  return output.join("");
};

/** Repair modern Korean jamo without converting Latin keys or crossing words. */
export const normalizeKoreanText = (value: string) =>
  value.replace(
    /[\u1100-\u1112\u1161-\u1175\u11a8-\u11c2\u3131-\u3163\uac00-\ud7a3]+/g,
    composeCompatibilityJamo,
  );

export const normalizeKoreanTextSelection = (
  value: string,
  selectionStart: number,
  selectionEnd = selectionStart,
) => {
  const normalized = normalizeKoreanText(value);
  const mapOffset = (offset: number) =>
    Math.min(
      normalized.length,
      normalizeKoreanText(value.slice(0, Math.max(0, offset))).length,
    );
  return {
    value: normalized,
    selectionStart: mapOffset(selectionStart),
    selectionEnd: mapOffset(selectionEnd),
  };
};
