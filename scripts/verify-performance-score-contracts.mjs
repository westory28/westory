import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
const load = (source, dependencies) => {
  const exports = {};
  vm.runInNewContext(compile(source), {
    exports,
    TextEncoder,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
};
const read = (path) => readFileSync(path, "utf8");
const scores = load(read("src/lib/performanceScores.ts"), {
  "firebase/firestore": {},
  "./firebase": {},
  "./semesterScope": {},
});
const workbook = load(read("src/lib/writtenExamEssayScoreWorkbook.ts"), {
  "./performanceScores": scores,
});
const managerSource = read(
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
);
const sourceFile = ts.createSourceFile(
  "manager.tsx",
  managerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const dependencies = {};
for (const statement of sourceFile.statements) {
  if (ts.isImportDeclaration(statement))
    dependencies[statement.moduleSpecifier.text] = {};
}
dependencies["../../../lib/performanceScores"] = scores;
// Roster membership is now managed only through StudentList. Exercise the actual
// score-only transaction contract instead of the removed manual roster sync path.
await import("./verify-score-roster-management.mjs");
const harness = `
export { getScoreItemBasePayload, getRecordItemsForRoster, getObjectiveOmrItems };`;
const manager = load(
  (managerSource + harness).replaceAll("import.meta.env.BASE_URL", '"/"'),
  dependencies,
);
const scoreItem = {
  name: "논술형",
  maxScore: 20,
  score: 10,
  scoreEntered: true,
};
const makeRoster = (id) => ({
  id,
  title: id,
  subject: "역사",
  academicYear: "2026",
  semester: "2",
  targetGrade: "2",
  targetClass: "6",
  classes: ["6"],
  items: [{ name: "논술형", maxScore: 20 }],
  totalMaxScore: 20,
  rows: [],
});

const objectiveDefinition = {
  name: "서답형 1번",
  itemKey: "objective-1",
  examSection: "objective",
  questionNumber: 1,
  correctAnswer: "1",
  maxScore: 2,
};
const omrDefinition = manager.getObjectiveOmrItems([objectiveDefinition])[0];
assert.equal(omrDefinition.score, undefined);
assert.equal(omrDefinition.scoreEntered, undefined);
assert.equal(
  manager.getObjectiveOmrItems([
    { ...objectiveDefinition, score: 0, scoreEntered: true },
  ])[0].score,
  0,
);
for (const answerStatus of ["correct", "incorrect", "blank", "invalid"]) {
  assert.equal(
    manager.getScoreItemBasePayload({ ...objectiveDefinition, answerStatus })
      .answerStatus,
    answerStatus,
  );
}
assert.equal(
  manager.getScoreItemBasePayload({
    ...objectiveDefinition,
    answerStatus: "unknown",
  }).answerStatus,
  undefined,
);
const feedbackRoster = makeRoster("feedback");
feedbackRoster.items[0].feedback = "기존 항목 피드백";
assert.equal(
  manager.getRecordItemsForRoster({ items: [] }, feedbackRoster)[0].feedback,
  "기존 항목 피드백",
);
assert.equal(
  manager.getRecordItemsForRoster(
    { items: [{ ...scoreItem, feedback: "학생 피드백" }] },
    feedbackRoster,
  )[0].feedback,
  "학생 피드백",
);

const params = {
  fileName: "점수표.xlsx",
  targetGrade: "2",
  fallbackClass: "6",
  maxScore: 20,
};
const essay = workbook.parseWrittenExamEssayScoreWorkbook(
  [
    ["번호", "이름", "1-(1)", "1-(2)", "피드백"],
    [1, "학생가", 0, 3, "1-(1): 근거 확인"],
    [2, "학생나", "", 2, ""],
  ],
  params,
);
assert.equal(essay.items[0].examSection, "essay");
assert.equal(essay.rows[0].items[0].score, 0);
assert.equal(essay.rows[0].items[0].scoreEntered, true);
assert.equal(essay.rows[1].items[0].scoreEntered, false);
assert.equal(essay.rows[0].items[0].feedback, "근거 확인");
const totalOnly = workbook.parseWrittenExamEssayScoreWorkbook(
  [
    ["번호", "이름", "총점"],
    [1, "학생", 12],
  ],
  params,
);
assert.equal(totalOnly.rows[0].items[0].examSection, "essay");
assert.equal(totalOnly.rows[0].totalScore, 12);
const objective = workbook.parseWrittenExamEssayScoreWorkbook(
  [
    ["반/번호", "이름", "1", "2", "3", "4", "5", "총점"],
    ["", "정답", "1", "2", "3", "4", "5", ""],
    ["", "배점", 2, 2, 2, 2, 2, ""],
    ["6/1", "학생", "1", "1", ".", "4", "5", ""],
  ],
  params,
);
assert.equal(objective.scoreContentKind, "objective");
assert.equal(objective.items[0].examSection, "objective");
assert.equal(objective.rows[0].items[0].answerStatus, "correct");
assert.equal(objective.rows[0].items[1].answerStatus, "incorrect");
assert.equal(
  objective.rows[0].items[2].answerStatus,
  "correct",
  "A dot in an OMR export denotes a correct answer",
);
assert.equal(objective.rows[0].totalScore, 8);
console.log(
  "Performance score contracts passed: canonical student roster, atomic score edits, signature invalidation, OMR definitions, feedback and workbook parsing.",
);
