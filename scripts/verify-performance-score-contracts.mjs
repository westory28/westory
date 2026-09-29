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
let reads = [],
  writes = [],
  snapshots = new Map();
dependencies["firebase/firestore"] = {
  doc: (_db, ...segments) => ({
    path: segments.join("/"),
    id: segments.at(-1),
  }),
  async getDoc(ref) {
    reads.push(ref.path);
    const data = snapshots.get(ref.id);
    return { id: ref.id, exists: () => Boolean(data), data: () => data };
  },
  writeBatch: () => ({
    update: (ref, data) => writes.push({ method: "update", ...ref, data }),
    delete: (ref) => writes.push({ method: "delete", ...ref }),
    set: () => assert.fail("Roster sync must not create unrelated documents"),
    commit: async () => {},
  }),
};
// Run the actual save closure's latest-read -> sync -> queued-write segment.
// This reproduces undefined names inside that closure, not just pure helpers.
const saveStart = managerSource.indexOf("const saveScoreListEdits = async");
const syncStart = managerSource.indexOf(
  "const updatedRows = [...updatedExistingRows, ...addedRows];",
  saveStart,
);
const syncEnd = managerSource.indexOf(
  "recordsToWrite.forEach((record) => {",
  syncStart,
);
assert.ok(saveStart >= 0 && syncStart > saveStart && syncEnd > syncStart);
const harness = `
export { getScoreItemBasePayload, getRecordItemsForRoster, getObjectiveOmrItems,
  buildBlankManualRosterRowFromRecord, getManualScoreStudentIdentityKey };
export const executeSaveSync = async ({ selectedScoreRoster, rosters,
  updatedExistingRows = [], addedRows = [], persistableScoreListRecords = [],
  manualIdentityReplacements = [], deletedRecords = [], isWrittenExamMode = false,
  rosterCollectionPath = "years/2026/semesters/2/performance_score_rosters",
  timestamp = "test-timestamp" }) => {
  ${managerSource.slice(syncStart, syncEnd)}
  await batchQueue.commit();
  return { finalUpdatedRows, syncedRosterRowsById };
};`;
// The CommonJS test sandbox does not expose Vite's import.meta environment.
// Only the unrelated workbook-template URL helper uses this compile-time value.
const manager = load(
  (managerSource + harness).replaceAll("import.meta.env.BASE_URL", '"/"'),
  dependencies,
);
const plain = (value) => JSON.parse(JSON.stringify(value));

const scoreItem = {
  name: "논술형",
  maxScore: 20,
  score: 10,
  scoreEntered: true,
};
const makeRoster = (id, rows = [], targetGrade = "2") => ({
  id,
  title: id,
  subject: "역사",
  academicYear: "2026",
  semester: "2",
  targetGrade,
  targetClass: "6",
  classes: ["6"],
  items: [{ name: "논술형", maxScore: 20 }],
  totalMaxScore: 20,
  rows,
  rowCount: rows.length,
  matchedCount: 0,
  unmatchedCount: rows.length,
});
const manual = {
  uid: "",
  grade: "2",
  class: "6",
  number: "12",
  studentName: "수동학생",
  isManual: true,
  items: [scoreItem],
  totalScore: 10,
  totalMaxScore: 20,
  enteredScoreCount: 1,
  feedback: "",
  evidence: "",
};
const protectedRow = {
  ...manual,
  rowNumber: 1,
  matchStatus: "unmatched",
  matchMessage: "수동 추가 학생입니다.",
};
const selected = makeRoster("current", [protectedRow]);
const existingOther = {
  ...protectedRow,
  uid: "another-student",
  isManual: false,
  number: "20",
  studentName: "기존학생",
  totalScore: 17,
  items: [{ ...scoreItem, score: 17 }],
};
async function run(options = {}, remoteRosters = []) {
  reads = [];
  writes = [];
  snapshots = new Map(remoteRosters.map((roster) => [roster.id, roster]));
  const result = await manager.executeSaveSync({
    selectedScoreRoster: selected,
    rosters: [selected],
    updatedExistingRows: [protectedRow],
    ...options,
  });
  return { result, reads: [...reads], writes: plain(writes) };
}

let result = await run();
assert.equal(
  result.reads.length,
  0,
  "No cross-roster read for an ordinary save",
);
assert.deepEqual(
  result.writes.map((entry) => entry.id),
  ["current"],
);
assert.equal(result.result.syncedRosterRowsById.size, 0);

result = await run({ persistableScoreListRecords: [manual] });
assert.equal(
  result.reads.length,
  0,
  "A current-only roster never reads itself again",
);
assert.deepEqual(
  result.writes.map((entry) => entry.id),
  ["current"],
);
assert.equal(result.writes[0].data.rows[0].totalScore, 10);

const staleOther = makeRoster("other", []);
const freshOther = makeRoster("other", [existingOther]);
freshOther.totalMaxScore = 30;
freshOther.items[0].maxScore = 30;
const foreignGrade = makeRoster("other-grade", [], "3");
result = await run(
  {
    rosters: [
      selected,
      staleOther,
      foreignGrade,
      makeRoster("deleted-remotely"),
    ],
    persistableScoreListRecords: [manual],
  },
  [freshOther, foreignGrade],
);
assert.equal(result.reads.length, 3);
assert.deepEqual(
  result.writes.map((entry) => entry.id),
  ["current", "other"],
  "Write only current and changed same-grade rosters",
);
const otherWrite = result.writes.find((entry) => entry.id === "other");
assert.equal(
  otherWrite.data.rows[0].totalScore,
  17,
  "Keep freshly loaded scores, not stale UI rows",
);
assert.equal(otherWrite.data.rows[1].studentName, "수동학생");
assert.equal(
  otherWrite.data.rows[1].totalMaxScore,
  30,
  "Sync uses the fresh roster definition",
);
assert.equal(
  otherWrite.data.rows[1].enteredScoreCount,
  0,
  "Never copy a score into another assessment",
);
assert.equal(otherWrite.data.rowCount, 2);
assert.equal(result.writes.filter((entry) => entry.id === "current").length, 1);

const blankOther = manager.buildBlankManualRosterRowFromRecord(
  manual,
  freshOther,
  2,
);
const protectedOther = {
  ...protectedRow,
  totalScore: 19,
  items: [{ ...scoreItem, score: 19 }],
};
result = await run(
  {
    rosters: [selected, makeRoster("blank"), makeRoster("protected")],
    updatedExistingRows: [],
    deletedRecords: [manual],
  },
  [
    makeRoster("blank", [blankOther]),
    makeRoster("protected", [protectedOther]),
  ],
);
assert.deepEqual(
  result.writes.map((entry) => entry.id),
  ["current", "blank", "protected"],
);
assert.equal(
  result.writes.find((entry) => entry.id === "blank").data.rows.length,
  0,
  "Delete a propagated empty manual row",
);
assert.equal(
  result.writes.find((entry) => entry.id === "protected").data.rows[0]
    .totalScore,
  19,
  "Deleting a manual identity preserves separately entered scores",
);
assert.ok(
  result.writes.every((entry) => entry.method === "update"),
  "Manual students have no user score document to delete",
);

const renamed = { ...manual, studentName: "변경학생" };
result = await run(
  {
    rosters: [selected, makeRoster("rename")],
    persistableScoreListRecords: [renamed],
    manualIdentityReplacements: [
      {
        beforeKey: manager.getManualScoreStudentIdentityKey(manual),
        after: renamed,
      },
    ],
  },
  [makeRoster("rename", [blankOther])],
);
const renamedRows = result.writes.find((entry) => entry.id === "rename").data
  .rows;
assert.equal(renamedRows.length, 1);
assert.equal(renamedRows[0].studentName, "변경학생");

result = await run({
  deletedRecords: [{ ...manual, uid: "linked-student", isManual: false }],
});
assert.equal(result.reads.length, 0);
assert.deepEqual(
  result.writes
    .filter((entry) => entry.method === "delete")
    .map((entry) => entry.path),
  [
    "users/linked-student/performance_scores/current/confirmations/linked-student",
    "users/linked-student/performance_scores/current",
  ],
);

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
  "Performance score contracts passed: fresh-roster save, manual sync/rename/delete, write scope, OMR definitions, feedback and workbook parsing.",
);
