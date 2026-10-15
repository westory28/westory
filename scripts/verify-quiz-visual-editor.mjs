import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/pages/teacher/components/quizVisualDocument.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  parseQuizVisualDocument: parse,
  serializeQuizVisualDocument: save,
  quizVisualText: text,
  formatQuizVisualDocument: format,
  replaceQuizVisualSelection: replace,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const samples = [
  "",
  "왕권을 강화하고 사회를 통합하였다.",
  "{{box:(가)}}의 정책은 {{u:왕권 강화}}를 위한 것이었다.",
  "{{bullet}}삼국의 {{u:불교 수용}}\n{{bullet}}중앙 집권 체제",
  "(가)는 {{blank:소수림왕}}이다.",
  "앞줄\n\n뒷줄\n",
  "<img src=x onerror=alert(1)>는 실행되지 않는 문자열",
  "{{blank:}} {{box:}}",
  "{{bullet}}\n다음 줄",
];
let count = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  count += 1;
};
samples.forEach((sample) =>
  check(
    save(parse(sample)),
    sample,
    "Existing stored token format round trips",
  ),
);
check(
  save(parse("{{bullet:왕권 강화}}")),
  "{{bullet}}왕권 강화",
  "Legacy bullet equivalent",
);
check(save(parse("앞\r\n뒤")), "앞\n뒤", "CRLF line semantics");
const base = parse("왕권 강화와 사회 통합\n불교 수용");
check(
  save(format(base, 0, 5, "underline")),
  "{{u:왕권 강화}}와 사회 통합\n불교 수용",
  "Selected word underline",
);
check(
  save(format(parse("{{u:왕권 강화}}와 통합"), 0, 2, "box")),
  "{{box:왕권}}{{u: 강화}}와 통합",
  "No nested tokens on overlapping formatting",
);
check(
  save(format(parse("{{u:왕권 강화}}"), 0, 5, "text")),
  "왕권 강화",
  "Remove mark preserves text",
);
check(
  save(format(parse("왕권\n불교"), 0, 5, "bullet")),
  "{{bullet}}왕권\n{{bullet}}불교",
  "Bullet multiple selected lines",
);
check(
  save(format(parse("{{bullet}}왕권\n{{bullet}}불교"), 0, 5, "bullet")),
  "왕권\n불교",
  "Bullet toggle",
);
check(
  save(base),
  "왕권 강화와 사회 통합\n불교 수용",
  "Commands do not mutate existing history document",
);
check(
  save(replace(parse("왕권 강화"), 3, 5, parse("{{u:중앙 집권}}"))),
  "왕권 {{u:중앙 집권}}",
  "Inline paste replaces selection without new paragraph",
);
check(
  save(replace(parse("앞뒤"), 1, 1, parse("첫 줄\n둘째 줄"))),
  "앞첫 줄\n둘째 줄뒤",
  "Multiline paste merges surrounding content",
);
check(
  save(replace(parse("앞\n중간\n뒤"), 1, 5, parse(""))),
  "앞뒤",
  "Multirow selection deletion",
);
check(
  text(parse("{{u:왕권}}과 {{box:(가)}}")),
  "왕권과 (가)",
  "Editor has no visible markup tokens",
);
const adjacent = "{{box:(가)}}{{box:(나)}}와 {{blank:가}}{{blank:나}}";
check(
  save(parse(adjacent)),
  adjacent,
  "Adjacent boxes and blanks stay independent",
);
check(
  save(format(parse(adjacent), 6, 7, "underline")),
  "{{box:(가)}}{{box:(나)}}{{u:와}} {{blank:가}}{{blank:나}}",
  "Unrelated format preserves distinct markers",
);
check(
  save(replace(parse(adjacent), 10, 10, parse(" 추가"))),
  `${adjacent} 추가`,
  "Appending text preserves marker boundaries",
);
check(
  save(format(parse("가나다"), 0, 3, "box")),
  "{{box:가나다}}",
  "One format action creates one box",
);
check(
  save(replace(parse("{{box:(가)}}"), 3, 3, parse("{{box:(나)}}"))),
  "{{box:(가)}}{{box:(나)}}",
  "Pasted neighboring boxes stay independent",
);
console.log(
  `PASS ${count} quiz visual editor regressions (legacy round trip, selection, overlap, paste and token-only serialization)`,
);
