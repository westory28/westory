import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const paths = {
  quiz: "src/pages/student/quiz/QuizRunner.tsx",
  history: "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
  lifecycle: "src/lib/assessmentLifecycle.ts",
};
const files = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [
    key,
    ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  ]),
);
const compile = (source, fileName = "fixture.ts") => {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.equal(
    (result.diagnostics || []).filter(
      (row) => row.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
  );
  return result.outputText;
};
function declaration(file, name) {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(found, name);
  return found;
}
const evaluate = (source, bindings) =>
  new Function(...Object.keys(bindings), compile(source))(
    ...Object.values(bindings),
  );
const actual = (key, name, bindings) =>
  evaluate(
    `return ${declaration(files[key], name).getText(files[key])};`,
    bindings,
  );
const awarded = {
  status: "AWARDED",
  awarded: true,
  duplicate: false,
  amount: 37,
  bonusAwarded: true,
  bonusAmount: 11,
  totalAwarded: 48,
  blockedReason: "",
  blockedMessage: "",
  ledgerEntryIds: ["owned-base", "owned-bonus"],
};
const confirmed = (patch = {}) => ({
  attemptId: "owned-attempt",
  status: "SUBMITTED",
  revision: 3,
  score: 0,
  total: 1,
  percent: 0,
  answerChecks: [],
  resultRef: "semester_assessment_results/owned-attempt",
  submissionRef: "semester_assessment_submissions/owned-attempt",
  replayedSubmission: false,
  reward: awarded,
  ...patch,
});
function display(key) {
  const evidence = { notices: [], toasts: [], errors: [], refreshes: 0 };
  const show = actual(
    key,
    key === "quiz"
      ? "applyQuizPointReward"
      : "applyHistoryClassroomPointReward",
    {
      setPointNotice: (message) => evidence.notices.push(message),
      showToast: (toast) => evidence.toasts.push(toast),
      notifyPointsUpdated: () => evidence.refreshes++,
      console: { error: (...args) => evidence.errors.push(args) },
    },
  );
  return { show, evidence };
}
let cases = 0;
for (const key of ["quiz", "history"]) {
  assert(
    !files[key].text.includes("claimPointActivityReward"),
    "Assessment UI must not call the retired reward shim",
  );
  const paid = display(key);
  paid.show(awarded, false);
  assert.equal(paid.evidence.refreshes, 1);
  assert.equal(paid.evidence.toasts.length, 1);
  assert.match(paid.evidence.notices[0], /37.*11/);
  assert.equal(paid.evidence.errors.length, 0);
  cases++;
  const replay = display(key);
  replay.show(awarded, true);
  assert.equal(replay.evidence.refreshes, 0);
  assert.equal(replay.evidence.toasts.length, 0);
  assert.match(replay.evidence.notices[0], /이미/);
  cases++;
  for (const status of [
    "DISABLED",
    "NOT_ELIGIBLE",
    "DUPLICATE",
    "NOT_RECORDED",
  ]) {
    const quiet = display(key);
    quiet.show(
      {
        ...awarded,
        status,
        awarded: false,
        duplicate: status === "DUPLICATE",
        amount: 0,
        bonusAmount: 0,
        totalAwarded: 0,
        blockedMessage:
          status === "NOT_ELIGIBLE" ? "24시간 뒤 다시 적립할 수 있습니다." : "",
      },
      false,
    );
    assert.equal(quiet.evidence.toasts.length, 0);
    assert.equal(quiet.evidence.refreshes, 0);
    assert.equal(quiet.evidence.errors.length, 0);
    if (status === "NOT_ELIGIBLE")
      assert.equal(
        quiet.evidence.notices[0],
        "24시간 뒤 다시 적립할 수 있습니다.",
      );
    cases++;
  }
  const legacy = display(key);
  legacy.show(undefined, false);
  assert.match(legacy.evidence.notices[0], /기록되어 있지/);
  assert.equal(legacy.evidence.toasts.length, 0);
  cases++;
}

// Actual result-return expressions preserve server reward and replay metadata.
for (const [key, name] of [
  ["quiz", "finalizeQuizAttempt"],
  ["history", "saveResult"],
]) {
  const fn = declaration(files[key], name),
    statement = [...fn.body.statements].reverse().find(ts.isReturnStatement);
  assert(statement?.expression);
  const response = confirmed(),
    returned = evaluate(`return ${statement.expression.getText(files[key])};`, {
      submitted: response,
      resultDetails: [],
      status: "passed",
      assignment: { passThresholdPercent: 80 },
      sanitizedAnswerChecks: [],
    });
  assert.strictEqual(returned.reward, response.reward);
  assert.equal(returned.replayedSubmission, false);
  cases++;
}

// Execute the production quiz submit flow for both normal and timeout paths.
// A server-awarded zero-score result must not be silently changed to zero reward.
for (const isTimeout of [false, true]) {
  const shown = display("quiz"),
    events = [];
  const finish = actual("quiz", "finishQuiz", {
    finishSubmitting: false,
    emitSessionActivity: () => events.push("activity"),
    setFinishSubmitting: () => {},
    persistTimeoutRef: { current: null },
    timerRef: { current: null },
    window: { clearTimeout: () => {}, clearInterval: () => {} },
    alert: () => events.push("timeout-alert"),
    finalizeQuizAttempt: async (options) => {
      assert.equal(options.isTimeout, isTimeout);
      return {
        resultId: "owned-attempt",
        finalScore: 0,
        reward: awarded,
        replayedSubmission: false,
      };
    },
    setFinalizedResultId: (id) => assert.equal(id, "owned-attempt"),
    applyQuizPointReward: shown.show,
    setView: (view) => events.push(view),
    showToast: (event) => assert.fail(JSON.stringify(event)),
    console: { error: () => assert.fail("Unexpected submit error") },
  });
  await finish(isTimeout);
  assert(events.includes("result"));
  assert.equal(shown.evidence.refreshes, 1);
  assert.match(shown.evidence.notices[0], /37.*11/);
  cases++;
}

// Actual callable wrapper: keep server money immutable but preserve receipt replay
// information for display. Start-command results must keep their existing shape.
async function gatewayCase({
  commandType = "submitAssessmentAttempt",
  replayed = false,
  lost = false,
}) {
  const serverResult = confirmed(),
    pending = new Map(),
    requested = [];
  const run = actual("lifecycle", "executeStudentAssessmentCommand", {
    pendingKey: () => "owned-pending",
    readPendingCommandId: (key) => pending.get(key),
    createCommandId: () => "owned-command",
    rememberPendingCommandId: (key, id) => pending.set(key, id),
    forgetPendingCommandId: (key) => pending.delete(key),
    isAmbiguous: (error) => error.code === "functions/unavailable",
    getHttpsCallable: async (name) => async (request) => {
      requested.push({ name, request });
      if (name === "getCommandStatus")
        return { data: { status: "SUCCEEDED", result: serverResult } };
      if (lost) throw { code: "functions/unavailable" };
      return {
        data: {
          commandId: "owned-command",
          commandType,
          status: "SUCCEEDED",
          replayed,
          result: serverResult,
        },
      };
    },
  });
  const result = await run(commandType, { attemptId: "owned-attempt" });
  assert.equal(pending.size, 0);
  assert.strictEqual(result.reward, serverResult.reward);
  assert.equal(
    serverResult.replayedSubmission,
    false,
    "Do not mutate the received canonical result",
  );
  assert.equal(
    result.replayedSubmission,
    commandType === "submitAssessmentAttempt" && (replayed || lost),
  );
  if (lost) assert.equal(requested[1].request.commandId, "owned-command");
  if (commandType === "submitAssessmentAttempt" && (replayed || lost)) {
    const shown = display("quiz");
    shown.show(result.reward, result.replayedSubmission);
    assert.equal(shown.evidence.toasts.length, 0);
  }
  cases++;
}
await gatewayCase({});
await gatewayCase({ replayed: true });
await gatewayCase({ lost: true });
await gatewayCase({ commandType: "startAssessmentAttempt", replayed: true });

for (const file of Object.values(files)) compile(file.text, file.fileName);
compile(readFileSync("src/lib/commandGateway.ts", "utf8"));
console.log(
  JSON.stringify({
    status: "PASS",
    cases,
    actualProductionHandlers: true,
    transpileFiles: 4,
    browserRuns: 0,
    networkCalls: 0,
  }),
);
