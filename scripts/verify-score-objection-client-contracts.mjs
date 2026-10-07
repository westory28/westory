import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file, dependencies, extra = "") => {
  const source = readFileSync(file, "utf8") + extra;
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    { exports, require: (id) => dependencies[id] || {} },
  );
  return exports;
};

const config = { year: "2026", semester: "2" };
const calls = [];
const notifications = load("src/lib/notifications.ts", {
  "./semesterScope": { getYearSemester: (value) => value },
  "./studentProfileCommands": {
    callStudentDataService: async (name, input) => {
      calls.push({ name, input });
      return { objectionIds: ["objection-1"], objectionSavedCount: 1 };
    },
  },
});
for (const flag of [true, false, undefined]) {
  const result = await notifications.notifyPerformanceScoreObjectionRequested(
    config,
    {
      scoreIds: ["score-1", "score-1"],
      reason: "채점 근거를 확인하고 싶습니다.",
      scoreKind: "written_exam_essay",
      answerSheetRequested: flag,
    },
  );
  const { name, input } = calls.at(-1);
  assert.equal(name, "notifyPerformanceScoreObjectionRequested");
  assert.equal(input.answerSheetRequested, flag === true);
  assert.equal(input.year, "2026");
  assert.equal(input.semester, "2");
  assert.deepEqual(Array.from(input.scoreIds), ["score-1"]);
  assert.equal(result.objectionSavedCount, 1);
}
assert.equal(notifications.notifyPerformanceScoreAnswerSheetRequested, undefined);

const rows = [
  { id: "performance", scoreKind: "performance", answerSheetRequested: true },
  { id: "written", scoreKind: "written_exam_essay", answerSheetRequested: false },
  { id: "legacy", scoreKind: "performance" },
  { id: "invalid", scoreKind: "performance", answerSheetRequested: "true" },
];
const reads = [];
const scores = load("src/lib/performanceScores.ts", {
  "./firebase": { db: {} },
  "./semesterScope": {
    getSemesterCollectionPath: (scope, name) =>
      `years/${scope.year}/semesters/${scope.semester}/${name}`,
  },
  "firebase/firestore": {
    collection: (_, path) => path,
    where: (...args) => args,
    query: (...args) => args,
    getDocs: async (query) => {
      reads.push(query);
      return { docs: rows.map((row) => ({ id: row.id, data: () => row })) };
    },
  },
});
const performance = await scores.loadUserPerformanceScoreObjections(config, "student-1");
assert.deepEqual(Array.from(performance, (item) => item.answerSheetRequested), [true, false, false]);
const written = await scores.loadUserPerformanceScoreObjections(config, "student-1", { scoreKind: "written_exam_essay" });
assert.equal(written.length, 1);
assert.equal(written[0].id, "written");
assert.equal(reads[0][0], "years/2026/semesters/2/performance_score_objections");
assert.deepEqual(Array.from(reads[0][1]), ["uid", "==", "student-1"]);

const { getNotificationTargetUrl } = load(
  "src/components/common/NotificationBell.tsx",
  {},
  "\nexport { getNotificationTargetUrl };",
);
for (const tab of ["performance", "written-essay"]) {
  for (const suffix of ["", "&panel=answer-sheet-requests", "&panel=objections"]) {
    assert.equal(
      getNotificationTargetUrl({
        type: "performance_score_answer_sheet_requested",
        targetUrl: `/teacher/exam?tab=${tab}${suffix}`,
      }),
      `/teacher/exam?tab=${tab}&panel=objections`,
    );
  }
}
assert.equal(getNotificationTargetUrl({ type: "performance_score_objection_reviewed", targetUrl: "/student/score/performance" }), "/student/score/performance");
console.log("PASS: unified objection session adapter, scope/UID-filtered flag loading, and legacy notification routes");
