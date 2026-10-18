import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./verify-history-dictionary-initial-drag.mjs";

const require = createRequire(import.meta.url);
const bundle = async (relativePath) => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
  });
  return module.exports;
};
const {
  getHistoryDictionaryInitial: initial,
  matchesHistoryDictionaryInitial: matches,
  getHistoryDictionaryInitialCounts: count,
  HISTORY_DICTIONARY_HANGUL_INITIALS: hangul,
} = await bundle("../src/lib/historyDictionaryInitials.ts");
assert.equal(hangul.length, 14);
for (const [word, expected] of [
  ["고려", "ㄱ"],
  ["까치", "ㄱ"],
  ["땅", "ㄷ"],
  ["뿌리", "ㅂ"],
  ["쌀", "ㅅ"],
  ["짜임", "ㅈ"],
  ["힣", "ㅎ"],
  ["ㄱ", "ㄱ"],
  ["ㄲ", "ㄱ"],
  ["가야", "ㄱ"],
  ["　３·１ 운동", "3"],
  ["①번", "1"],
  ["　ＡＤ", "a"],
  ["BCE", "b"],
  ["z세대", "z"],
  ["“Athen”", "“"],
  ["한양 Seoul", "ㅎ"],
  ["⚑역사", "⚑"],
  ["", ""],
])
  assert.equal(initial(word), expected, word);
assert.equal(matches("3·1 운동", "0-9"), true);
assert.equal(matches("3·1 운동", "3"), true);
assert.equal(matches("3·1 운동", "1"), false);
assert.equal(matches("6·25 전쟁", "6"), true);
assert.equal(matches("AD", "a-z"), true);
assert.equal(matches("ＡＤ", "a"), true);
assert.equal(matches("BCE", "b"), true);
assert.equal(matches("의정부 Uijeongbu", "a-z"), false);
assert.equal(matches("의정부 Uijeongbu", "ㅇ"), true);
assert.equal(matches("“AD”", "a-z"), false);
assert.equal(matches("École", "a-z"), false);
assert.equal(matches("까치", "ㄱ"), true);
assert.equal(matches("독도", "ㄱ"), false);
assert.equal(matches("", ""), true);
const counts = count([
  "3·1 운동",
  "3대",
  "6·25 전쟁",
  "AD",
  "ＡＤ",
  "BCE",
  "고려",
  "까치",
  "힣",
  "⚑역사",
  "",
]);
assert.equal(counts[""], 11);
assert.equal(counts["0-9"], 3);
assert.equal(counts["a-z"], 3);
assert.equal(counts["3"], 2);
assert.equal(counts.a, 2);
assert.equal(counts["ㄱ"], 2);
console.log(
  "PASS headword initials, NFKC, tense consonants, English case, groups, and counts",
);

const Filter = (
  await bundle("../src/components/common/HistoryDictionaryInitialFilter.tsx")
).default;
const render = (value = "") =>
  renderToStaticMarkup(
    React.createElement(Filter, {
      value,
      onChange() {},
      counts,
      label: "사전 첫 글자",
    }),
  );
const all = render();
assert.match(all, /<nav[^>]*aria-label="사전 첫 글자"/);
assert.match(all, /aria-label="전체 · 11개"[^>]*aria-pressed="true"/);
assert.equal((all.match(/aria-expanded="false"/g) || []).length, 2);
assert.equal((all.match(/aria-controls=/g) || []).length, 2);
assert.equal((all.match(/ hidden=""/g) || []).length, 0);
assert.ok((all.match(/<button /g) || []).length <= 8);
assert.match(all, /다음 숨긴 글자 보기/);
assert.match(all, /data-history-initial="a-z"/);
assert.doesNotMatch(all, / disabled=/, "Zero-count letters stay selectable");
for (const number of "0123456789")
  assert.match(
    render(number),
    new RegExp(`data-history-initial="${number}"[^>]*aria-pressed="true"`),
  );
for (const letter of "abcdefghijklmnopqrstuvwxyz")
  assert.match(
    render(letter),
    new RegExp(`data-history-initial="${letter}"[^>]*aria-pressed="true"`),
  );
const selectedNumber = render("3");
assert.equal((selectedNumber.match(/aria-expanded="true"/g) || []).length, 1);
assert.match(selectedNumber, /aria-label="3 · 2개"[^>]*aria-pressed="true"/);
const selectedLetter = render("a");
assert.equal((selectedLetter.match(/aria-expanded="true"/g) || []).length, 1);
assert.match(selectedLetter, /aria-label="a · 2개"[^>]*aria-pressed="true"/);
assert.equal((render("0-9").match(/aria-expanded="true"/g) || []).length, 1);
assert.equal((render("a-z").match(/aria-expanded="true"/g) || []).length, 1);
console.log(
  "PASS bounded visible rows, all digit/Latin selections, group disclosure semantics, and accessible counts",
);
