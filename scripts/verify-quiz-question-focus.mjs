import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync("src/lib/quizQuestionFocus.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const { quizQuestionFocus } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

let cases = 0;
const test = (name, body) => {
  body();
  cases += 1;
  console.log(`PASS ${name}`);
};

test("Authored concepts retain meaning, normalize spaces and deduplicate before taking two", () => {
  const concepts = Object.freeze([
    "  중앙\n 집권  ",
    "중앙 집권",
    "   ",
    "  통치\t체제 ",
    "신분 제도",
  ]);
  assert.equal(quizQuestionFocus({ concepts }), "중앙 집권 · 통치 체제");
  assert.equal(concepts[0], "  중앙\n 집권  ");
  assert.equal(
    quizQuestionFocus({
      concepts: ["교사가 직접 등록한 긴 개념의 의미를 유지합니다"],
    }),
    "교사가 직접 등록한 긴 개념의 의미를 유지합니다",
  );
  assert.equal(
    quizQuestionFocus({
      concepts: ["정치 제도"],
      type: "word",
      answer: "집현전",
    }),
    "정치 제도",
  );
});

test("Only word and short answers can supply a short single term", () => {
  for (const type of ["word", "short"]) {
    for (const [answer, expected] of [
      ["집현전", "집현전"],
      ["당", "당"],
      ["  삼국시대  ", "삼국시대"],
      ["Renaissance", "Renaissance"],
      ["AI2", "AI2"],
      ["가".repeat(12), "가".repeat(12)],
    ])
      assert.equal(quizQuestionFocus({ type, answer }), expected);
  }
  for (const type of [undefined, "choice", "ox", "order", "matching"])
    assert.equal(quizQuestionFocus({ type, answer: "집현전" }), "개념 미등록");
});

test("Sentences, rich content, separators and long answers never become guessed concept labels", () => {
  for (const answer of [
    "조선의 왕은 세종이다.",
    "왕이 되었다",
    "역사는 쉽다",
    "통일했다",
    "복습합니다",
    "공부하나요",
    "세종과 장영실",
    "삼국 시대",
    "I agree",
    "백제 부흥 운동",
    "집현전\n세종",
    "집현전\t세종",
    "집현전||성균관",
    "집현전=>세종",
    "집현전/성균관",
    "집현전, 성균관",
    "집현전 · 성균관",
    "<b>집현전</b>",
    "집현전&nbsp;",
    "![집현전](image.png)",
    "data:image/png;base64,abc",
    "https://example.com/image.png",
    "가".repeat(13),
  ])
    assert.equal(
      quizQuestionFocus({ type: "word", answer }),
      "개념 미등록",
      answer,
    );
});

test("Numeric, binary, absent and malformed answers remain unregistered", () => {
  for (const answer of [
    "",
    " ",
    "1234",
    "１２３４",
    "12 34",
    "Ⅳ",
    "O",
    "X",
    "OX",
    "Ｔ",
    "f",
    "True",
    "FALSE",
    "yes",
    "no",
    "○",
    "×",
    "맞다",
    "틀리다",
    undefined,
    null,
    1234,
    false,
    {},
    ["집현전"],
  ])
    assert.equal(quizQuestionFocus({ type: "short", answer }), "개념 미등록");
  assert.equal(quizQuestionFocus({}), "개념 미등록");
  assert.equal(
    quizQuestionFocus({
      concepts: [null, false, "  "],
      type: "word",
      answer: "집현전",
    }),
    "집현전",
  );
});

console.log(`quiz question focus verified: ${cases} boundary groups`);
