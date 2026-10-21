import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (path, dependencies) => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: dependencies, console },
  );
  return exports;
};
const lifecycle = {
  buildAssessmentDefinitionId: (semesterId, kind, id) => `${kind.toLowerCase()}:${semesterId}:${id}`,
};
const history = load("src/lib/historyClassroom.ts", (name) =>
  name === "./assessmentLifecycle" ? lifecycle : {},
);
const helpers = load("src/pages/teacher/components/historyClassroomResults.ts", (name) => {
  if (name.endsWith("/assessmentLifecycle")) return lifecycle;
  if (name.endsWith("/historyClassroom")) return history;
  throw new Error(`Unexpected dependency: ${name}`);
});
const scope = "2026-2";
const assignment = {
  id: "assignment-1", title: "검증 역사교실", passThresholdPercent: 90,
  targetStudentUids: ["student-1", "student-2"],
};
const raw = (id, fields = {}) => ({
  resultId: id, attemptId: id, definitionId: `history_classroom:${scope}:assignment-1`,
  semesterId: scope, assessmentKind: "HISTORY_CLASSROOM", studentUid: "student-1",
  score: 28, total: 30, percent: 93, passed: true, passThresholdPercent: 90,
  answerChecks: [{ id: "blank-1", correct: true }],
  submittedAtIso: "2026-10-21T00:00:00.000Z",
  submissionRef: `semester_assessment_submissions/${id}`,
  ...fields,
});
const normalize = (id, data, sources = [assignment]) =>
  helpers.normalizeTeacherCanonicalHistoryResult(id, data, scope, sources);

const pass = normalize("passed", raw("passed"), [{ ...assignment, passThresholdPercent: 99 }]);
assert.equal(pass.status, "passed", "A previous pass survives a higher current threshold");
assert.equal(pass.passThresholdPercent, 90);
assert.equal(pass.completionSource, "attempt", "An ordinary pass is never marked exempted");
assert.equal(pass.canonicalAnswerChecks["blank-1"], true);
assert.equal(Object.keys(pass.answers).length, 0, "Listing results does not invent submitted answers");

const failed = normalize("failed", raw("failed", {
  passed: false, percent: 72, submittedAtIso: "2026-10-20T00:00:00.000Z",
}), [{ ...assignment, passThresholdPercent: 70 }]);
assert.equal(failed.status, "failed", "An immutable failure survives a lower current threshold");
const grouped = helpers.mergeTeacherHistoryResults([], [pass, failed]);
assert.equal(grouped[assignment.id].length, 2, "A retry keeps both attempts");
assert.equal(helpers.getTeacherHistoryCompletionsByUid(grouped[assignment.id], ["student-1"]).get("student-1").status, "passed",
  "Failure followed by pass is counted as one passed student");
const laterFailure = normalize("later-failure", raw("later-failure", { passed: false, percent: 72, submittedAtIso: "2026-10-22T00:00:00.000Z" }));
assert.equal(helpers.getTeacherHistoryCompletion(helpers.mergeTeacherHistoryResults([], [pass, laterFailure])[assignment.id]).status, "passed",
  "A pass remains completed even when a later legacy failure exists");

const exempt = normalize("exemption_" + "a".repeat(64), raw("exemption_" + "a".repeat(64), {
  uid: "student-1", completionSource: "exemption", exemptionId: "ticket-1",
  exemptionRequestId: "request-1", percent: 100,
}));
const duplicate = helpers.mergeTeacherHistoryResults([exempt], [exempt]);
assert.equal(duplicate[assignment.id].length, 1, "Dual-written exemption documents are counted once");
assert.equal(duplicate[assignment.id][0].completionSource, "exemption");
const projected = helpers.mergeTeacherHistoryResults([{ ...failed, id: pass.id, answers: { "blank-1": "조선" },
  answerChecks: [{ blankId: "blank-1", correct: true }] }], [pass])[assignment.id][0];
assert.equal(projected.status, "passed", "The canonical outcome wins over a stale projection");
assert.equal(projected.answers["blank-1"], "조선", "The projection's full submitted answer snapshot survives merging");

assert.equal(normalize("other-term", raw("other-term", { semesterId: "2026-1" })), null);
assert.equal(normalize("other-source", raw("other-source", { definitionId: `history_classroom:${scope}:other` })), null);
assert.equal(normalize("other-student", raw("other-student", { studentUid: "unassigned" })), null);
assert.equal(normalize("quiz", raw("quiz", { assessmentKind: "QUIZ" })), null);
for (const fields of [{ percent: 101 }, { submittedAtIso: "invalid" }, { submissionRef: "users/student-1" }, { attemptId: "other" }])
  assert.throws(() => normalize("invalid", raw("invalid", fields)), /확인할 수 없습니다/);

const submission = { attemptId: pass.id, studentUid: pass.uid, semesterId: scope,
  definitionId: raw(pass.id).definitionId, answers: { "blank-1": "조선", "blank-2": 0 } };
const answers = helpers.readTeacherHistorySubmissionAnswers(pass, submission);
assert.equal(answers["blank-1"], "조선");
assert.equal(answers["blank-2"], "0");
for (const fields of [{ studentUid: "student-2" }, { semesterId: "2026-1" }, { attemptId: "other" }, { definitionId: "other" }, { answers: [] }])
  assert.throws(() => helpers.readTeacherHistorySubmissionAnswers(pass, { ...submission, ...fields }), /확인할 수 없습니다/);

const many = Array.from({ length: 520 }, (_, index) => ({ ...failed, id: `legacy-${index}`, createdAt: { seconds: index } }));
assert.equal(helpers.mergeTeacherHistoryResults(many, [pass])[assignment.id].length, 521,
  "Old results do not disappear behind a global 500-record limit");
console.log("Teacher History Classroom results: canonical outcomes, retries, exemption dedupe, scope and immutable submission checks passed.");
