import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let result;
const scope = { year: "2026", semester: "2" };
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync("src/lib/studentAssessmentResults.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports,
    require(name) {
      if (name === "firebase/firestore")
        return {
          collection: (_db, path) => path,
          doc: (_db, path) => path,
          where: (field, operator, value) => ({ field, operator, value }),
          query: (path, ...filters) => ({ path, filters }),
          getDocs: async (query) => {
            assert.equal(query.path, "semester_assessment_results");
            assert.equal(query.filters[0].value, "student-1");
            assert.equal(query.filters[1].value, "2026-2");
            return {
              docs: [
                { id: result.resultId || result.attemptId, data: () => result },
              ],
            };
          },
          getDoc: async (path) => {
            assert.equal(
              path,
              `semester_assessment_submissions/${result.attemptId}`,
            );
            return {
              data: () => ({
                studentUid: "student-1",
                semesterId: "2026-2",
                attemptId: result.attemptId,
                answers: {},
              }),
            };
          },
          Timestamp: {
            fromDate: (date) => ({ seconds: date.getTime() / 1000 }),
          },
        };
      if (name === "./firebase") return { db: {} };
      if (name === "./assessmentLifecycle")
        return {
          buildAssessmentDefinitionId: (semester, _kind, id) =>
            `history_classroom:${semester}:${id}`,
        };
      if (name === "./semesterScope") return { getYearSemester: () => scope };
      if (name === "./mockExamRounds") return {};
      if (name === "./historyClassroom")
        return {
          summarizeHistoryClassroomAnswers: () => ({ checks: [] }),
          normalizeHistoryClassroomResult: (id, data) => ({ id, ...data }),
        };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
  },
);
const assignment = {
  id: "assignment-1",
  title: "역사교실",
  passThresholdPercent: 90,
};
const base = {
  attemptId: "attempt-1",
  definitionId: "history_classroom:2026-2:assignment-1",
  semesterId: "2026-2",
  studentUid: "student-1",
  assessmentKind: "HISTORY_CLASSROOM",
  score: 8,
  total: 10,
  percent: 80,
  answerChecks: [],
  submittedAtIso: "2026-10-15T00:00:00Z",
  submissionRef: "semester_assessment_submissions/attempt-1",
};
for (const scenario of [
  {
    name: "immutable pass survives higher current threshold",
    fields: { passed: true, passThresholdPercent: 80 },
    expected: true,
  },
  {
    name: "immutable failure survives lower current threshold",
    fields: { passed: false, passThresholdPercent: 90 },
    threshold: 70,
    expected: false,
  },
  {
    name: "legacy result retains threshold fallback",
    fields: {},
    expected: false,
  },
  {
    name: "exemption remains complete",
    fields: {
      completionSource: "exemption",
      resultId: "exemption_" + "a".repeat(64),
      uid: "student-1",
      attemptId: undefined,
      submissionRef: undefined,
      passed: true,
      percent: 100,
      exemptionId: "ticket-1",
      exemptionRequestId: "request-1",
    },
    expected: true,
  },
]) {
  result = { ...base, ...scenario.fields };
  const [actual] = await exports.readCanonicalHistoryResults(
    scope,
    "student-1",
    [{ ...assignment, passThresholdPercent: scenario.threshold ?? 90 }],
  );
  assert.equal(actual.passed, scenario.expected, scenario.name);
  if (scenario.fields.exemptionId) {
    assert.equal(actual.completionSource, "exemption");
    assert.equal(actual.exemptionId, "ticket-1");
  }
}
result = { ...base, studentUid: "other-student" };
await assert.rejects(() =>
  exports.readCanonicalHistoryResults(scope, "student-1", [assignment]),
);
result = { ...base, completionSource: "exemption", passed: true, percent: 100 };
await assert.rejects(() => exports.readCanonicalHistoryResults(scope, "student-1", [assignment]));
console.log("History classroom result snapshots: 6 cases passed.");
