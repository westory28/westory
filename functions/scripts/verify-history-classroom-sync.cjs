const assert = require("node:assert/strict");
const { createHistoryClassroomSync } = require("../productionGateway/historyClassroomSync");

const scope = "2026-2", assignmentId = "frozen-history";
const baseAttempt = { attemptId: `attempt_${"a".repeat(64)}`, definitionId: `history_classroom:${scope}:${assignmentId}`,
  semesterId: scope, assessmentKind: "HISTORY_CLASSROOM", studentUid: "student", enrollmentId: "enrollment", classId: "class",
  passThresholdPercent: 90, gradingSnapshot: [{ id: "blank", answer: "고려" }], answers: { blank: "고려" } };
const inspect = async (result, attempt = baseAttempt, mutableThreshold = 100) => {
  const documents = new Map([
    [`semester_assessment_definitions/${attempt.definitionId}`, { sourceId: assignmentId, title: "합성 역사교실" }],
    [`years/2026/semesters/2/history_classrooms/${assignmentId}`, { title: "합성 역사교실", passThresholdPercent: mutableThreshold }],
  ]);
  let writes = 0;
  const transaction = {
    getAll: async paths => paths.map(path => ({ path, exists: documents.has(path), data: documents.get(path) || null })),
    create: (path, data) => { assert(!documents.has(path)); documents.set(path, data); writes++; },
  };
  const plan = await createHistoryClassroomSync({ now: () => new Date("2026-10-21T00:00:00Z") }).prepareAttempt({
    transaction, attempt, result: { score: 28, total: 30, answerChecks: [], ...result }, timestamp: "synthetic-timestamp",
  });
  assert.equal(writes, 0, "preparing a projection must never stage partial writes");
  return { plan, writeCount: () => writes };
};
(async () => {
  const explicitFailure = await inspect({ passed: false, percent: 100, passThresholdPercent: 90 });
  assert.equal(explicitFailure.plan.projection.status, "failed", "an explicit immutable failure remains authoritative at a high score");
  const resultThreshold = await inspect({ percent: 93, passThresholdPercent: 90 }, { ...baseAttempt, passThresholdPercent: 95 });
  assert.equal(resultThreshold.plan.projection.status, "passed");
  assert.equal(resultThreshold.plan.projection.passThresholdPercent, 90, "the immutable result threshold precedes the frozen attempt threshold");
  const attemptThreshold = await inspect({ percent: 93 });
  assert.equal(attemptThreshold.plan.projection.status, "passed", "a changed current assignment threshold does not alter a frozen result");
  assert.equal(attemptThreshold.plan.projection.passThresholdPercent, 90);
  const frozenFailure = await inspect({ percent: 89, passThresholdPercent: 90 }, baseAttempt, 0);
  assert.equal(frozenFailure.plan.projection.status, "failed", "lowering the current assignment threshold does not change an old result");
  const { passThresholdPercent: omittedThreshold, ...unknownAttempt } = baseAttempt;
  const unknown = await inspect({ percent: 100 }, unknownAttempt, 0);
  assert.equal(unknown.plan.unknownOutcome, true);
  assert.equal(unknown.plan.projection, undefined);
  unknown.plan.apply();
  assert.equal(unknown.writeCount(), 0, "an unfrozen historical outcome is flagged without inventing pass/fail");
  const zeroThreshold = await inspect({ percent: 0, passThresholdPercent: 0 });
  assert.equal(zeroThreshold.plan.projection.status, "passed", "zero is a valid frozen threshold");
  console.log("PASS History Classroom compatibility: explicit outcomes, result/attempt frozen threshold precedence, mutable settings ignored, unknown outcome zero writes, zero threshold");
})().catch(error => { console.error(error); process.exitCode = 1; });
