import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/pages/teacher/components/quizDerivation.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { hasQuizDerivationContentChange: changed } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const source = {
  type: "choice",
  question: "사료의 정책을 고르세요.",
  passage: "{{box:(가)}} 왕권 강화",
  options: ["불교 수용", "지방 분권"],
  answer: "불교 수용",
  image: null,
  choiceOptionImages: [],
};
assert.equal(
  changed(source, { ...source, choiceOptionImages: [null, null] }),
  false,
  "Legacy missing image slots cannot bypass identical-content validation",
);
assert.equal(
  changed(source, { ...source, answer: "지방 분권" }),
  false,
  "Answer-key correction is not a derivative",
);
assert.equal(
  changed(source, { ...source, question: source.question + "  " }),
  false,
  "Whitespace is not a derivative",
);
assert.equal(
  changed(source, {
    ...source,
    question: "사료에 나타난 사상의 수용 목적을 고르세요.",
  }),
  true,
);
assert.equal(
  changed(source, { ...source, passage: "새 사료에 나타난 중앙 집권" }),
  true,
);
assert.equal(
  changed(source, {
    ...source,
    choiceOptionImages: ["data:image/png;base64,example", null],
  }),
  true,
);
assert.equal(
  changed(
    { type: "word", question: "인물을 쓰세요.", answer: "소수림왕" },
    { type: "word", question: "인물을 쓰세요.", answer: "침류왕" },
  ),
  false,
);
assert.equal(
  changed(
    {
      type: "matching",
      question: "연결하세요.",
      answer: "고구려=>소수림왕||백제=>침류왕",
    },
    {
      type: "matching",
      question: "연결하세요.",
      matchingPairs: [
        { left: "고구려", right: "소수림왕", rightImage: null },
        { left: "백제", right: "침류왕", rightImage: null },
      ],
    },
  ),
  false,
);
assert.equal(
  changed(
    { type: "order", question: "순서를 고르세요.", answer: "고조선||삼국" },
    {
      type: "order",
      question: "순서를 고르세요.",
      options: ["고조선", "삼국"],
    },
  ),
  false,
);
assert.equal(
  changed(source, { ...source, options: ["불교 수용", "귀족 회의 폐지"] }),
  true,
);
console.log(
  "PASS: 10 assessment derivation regressions (rich-content normalization and answer-only rejection)",
);
