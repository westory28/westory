import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual view helpers without loading a browser or Firebase.
const source = readFileSync(
  "src/pages/student/score/PerformanceScoreView.tsx",
  "utf8",
);
const file = ts.createSourceFile(
  "PerformanceScoreView.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = new Set([
  "getItemLabel",
  "getFiniteScoreValue",
  "getEnteredItemScore",
  "getItemsTotalScore",
  "getItemsMaxScore",
  "getWrittenExamItemMeta",
  "getWrittenExamItemGroups",
  "getWrittenExamGroupScore",
  "getWrittenExamGroupMaxScore",
  "formatStudentScoreFeedback",
  "getWrittenExamGeneralFeedback",
]);
const selected = file.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) && names.has(declaration.name.text),
    ),
);
assert.equal(
  selected.length,
  names.size,
  "Every tested helper must come from the current student view",
);
const output = ts.transpileModule(
  `
const WRITTEN_EXAM_SECTION_OBJECTIVE = "objective";
const getPerformanceScoreItemShortName = (name: string) => name;
${selected.map((statement) => statement.getText(file)).join("\n")}
export { ${[...names].join(", ")} };
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
vm.runInNewContext(output, { exports });
const {
  formatStudentScoreFeedback: format,
  getWrittenExamGeneralFeedback: general,
  getWrittenExamItemGroups: groups,
  getWrittenExamGroupScore: score,
  getWrittenExamGroupMaxScore: max,
} = exports;
const reasons = [
  "핵심 용어를 정확히 썼습니다.",
  "근거를 일부 설명했습니다.\n\n\n시대적 배경도 덧붙여 주세요.",
  "제도 이름이 다릅니다. 답안의 (1) 표현을 다시 확인해 주세요.",
  "사료와 주장을 연결해 설명해 주세요.",
];
const items = reasons.map((feedback, index) => ({
  name: `1-(${index + 1})`,
  itemKey: `1-(${index + 1})`,
  groupKey: "1",
  groupLabel: "1번",
  feedback,
  score: [1, 1, 0, 0][index],
  maxScore: [1, 3, 1, 5][index],
  scoreEntered: true,
}));
const original = structuredClone(items);
const evidence = reasons
  .map((reason, index) => `(${index + 1}) ${reason}`)
  .join("\n\n");
assert.equal(general(evidence, items), "");
assert.equal(
  general(
    evidence.replace(/\((\d)\)/g, "（$1）"),
    items.map((item) => ({
      ...item,
      feedback: item.feedback.replace(/\((\d)\)/g, "（$1）"),
    })),
  ),
  "",
);
assert.equal(
  general(
    reasons.map((reason, index) => `1-(${index + 1}): ${reason}`).join("\n\n"),
    items,
  ),
  "",
);
assert.equal(
  general(
    reasons.map((reason, index) => `1-(${index + 1}): ${reason}`).join(" "),
    items,
  ),
  "",
);
assert.equal(
  general(`전체 설명입니다.\n\n${evidence}\n\n(9) 추가 안내입니다.`, items),
  "전체 설명입니다.\n\n(9) 추가 안내입니다.",
);
assert.equal(
  general("(1) 아직 문항별로 옮기지 않은 사유입니다.", items),
  "(1) 아직 문항별로 옮기지 않은 사유입니다.",
);
assert.equal(
  general(
    evidence,
    items.map((item) => ({ ...item, feedback: "" })),
  ),
  evidence,
);
assert.equal(general(evidence, []), evidence);
assert.equal(
  general("본문에서 1-(1): 을 인용했습니다.", items),
  "본문에서 1-(1): 을 인용했습니다.",
);
assert.equal(
  general("(1) 핵심 용어를 정확히 썼습니다.", [
    ...items,
    { ...items[0], itemKey: "2-(1)", groupKey: "2" },
  ]),
  "(1) 핵심 용어를 정확히 썼습니다.",
);
assert.equal(
  format("  1592년의 사건입니다.\r\n\r\n\t\r\n0점 / 1점\r\n다음 줄  "),
  "1592년의 사건입니다.\n0점 / 1점\n다음 줄",
);
assert.equal(format(reasons[2]), reasons[2]);
const [group] = groups(items);
assert.equal(group.label, "1번");
assert.deepEqual(
  Array.from(group.items, (item) => item.label),
  ["(1)", "(2)", "(3)", "(4)"],
);
assert.equal(score(group), 2);
assert.equal(max(group), 10);
assert.equal(exports.getEnteredItemScore(items[2]), 0);
assert.equal(
  exports.getEnteredItemScore({ ...items[2], scoreEntered: false }),
  null,
);
assert.deepEqual(
  items,
  original,
  "Display helpers must never change saved points, maxima, or feedback",
);
console.log(
  "PASS student score feedback: four subquestions and exact totals, zero versus blank, compact display without stored text changes, duplicate-only suppression, legacy/general/unmatched notes preserved.",
);
