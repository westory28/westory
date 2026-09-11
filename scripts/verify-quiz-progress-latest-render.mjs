import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute production handlers with separately rendered React state snapshots.
// The callable and timers are in memory; no browser, SDK, or network access.
const quizPath = "src/pages/student/quiz/QuizRunner.tsx";
const historyPath =
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx";
const source = (path) => readFileSync(path, "utf8");
const parse = (path) =>
  ts.createSourceFile(
    path,
    source(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const compile = (text) => {
  const result = ts.transpileModule(text, {
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
const quiz = parse(quizPath),
  history = parse(historyPath);
function initializer(file, name) {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(found, name);
  return found.getText(file);
}
function instantiate(text, bindings) {
  return new Function(...Object.keys(bindings), compile(text))(
    ...Object.values(bindings),
  );
}
const methodNames = [
  "persistQuizProgress",
  "schedulePersistQuizProgress",
  "handleAnswer",
];
const methods = methodNames
  .map((name) => `const ${name} = ${initializer(quiz, name)};`)
  .join("\n");
let latestAssignment;
const findLatest = (node) => {
  if (
    ts.isExpressionStatement(node) &&
    node.getText(quiz) ===
      "persistQuizProgressRef.current = persistQuizProgress;"
  )
    latestAssignment = node.getText(quiz);
  ts.forEachChild(node, findLatest);
};
findLatest(quiz);
assert(latestAssignment, "Production latest-render ref assignment is required");
const production = `${methods}\n${latestAssignment}\nreturn {${methodNames.join(",")}};`;
const microtasks = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
function fixture() {
  let timerId = 0,
    releaseSave;
  const timers = new Map(),
    calls = [],
    warnings = [];
  const window = {
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const server = { attemptId: "owned-attempt", revision: 1, answers: {} };
  const state = {
    answers: {},
    currentIndex: 0,
    canonicalAttempt: { ...server, status: "STARTED" },
    view: "quiz",
    finishSubmitting: false,
  };
  const refs = {
    persistTimeoutRef: { current: null },
    persistInFlightRef: { current: false },
    persistQueuedRef: { current: false },
    persistQuizProgressRef: { current: null },
  };
  const saveAssessmentProgress = async (payload) => {
    calls.push(structuredClone(payload));
    if (releaseSave)
      await new Promise((resolve) => {
        releaseSave.resolve = resolve;
      });
    assert.equal(
      payload.expectedRevision,
      server.revision,
      "CAS must use the last confirmed revision",
    );
    server.revision++;
    server.answers = structuredClone(payload.answers);
    return {
      attemptId: server.attemptId,
      revision: server.revision,
      savedAtIso: "2026-09-11T15:00:00Z",
    };
  };
  const render = () =>
    instantiate(production, {
      ...state,
      ...refs,
      window,
      saveAssessmentProgress,
      selectedQuestions: [{ id: 1 }],
      unitId: "owned-unit",
      category: "formative",
      startingQuiz: false,
      QUIZ_PROGRESS_SAVE_DELAY_MS: 900,
      getResolvedStudentUid: () => "owned-student",
      emitSessionActivity: () => {},
      setAnswers: (value) => {
        state.answers =
          typeof value === "function" ? value(state.answers) : value;
      },
      setCanonicalAttempt: (value) => {
        state.canonicalAttempt =
          typeof value === "function" ? value(state.canonicalAttempt) : value;
      },
      console: { error: (...args) => warnings.push(args) },
    });
  const tick = async () => {
    const item = timers.entries().next().value;
    assert(item, "Expected a scheduled production save");
    timers.delete(item[0]);
    item[1]();
    await microtasks();
  };
  return {
    window,
    state,
    refs,
    server,
    calls,
    warnings,
    timers,
    render,
    tick,
    hold: () => {
      releaseSave = {};
    },
    release: async () => {
      const resolve = releaseSave.resolve;
      releaseSave = null;
      resolve();
      await microtasks();
    },
  };
}

// One click schedules a timer from the old render; the callback must use the new render.
const one = fixture();
one.render().handleAnswer("정답");
one.render();
await one.tick();
assert.deepEqual(one.calls[0].answers, { 1: "정답" });
assert.deepEqual(one.server.answers, { 1: "정답" });
assert.equal(one.calls.length, 1);

// Reconnect executes the actual restore handler with the committed server answer.
const restored = {},
  noop = () => {};
const restore = instantiate(
  `return ${initializer(quiz, "restoreSubmissionState")};`,
  {
    setAnswers: (value) => {
      restored.answers = value;
    },
    setCurrentIndex: (value) => {
      restored.currentIndex = value;
    },
    setSelectedQuestions: noop,
    setHintUsedCount: noop,
    setRevealedHints: noop,
    setOrderOptionMap: noop,
    setActiveSubmission: noop,
    setServerTimeOffsetMs: noop,
    setQuizDeadlineMs: noop,
    setTimeLeft: noop,
    timeoutHandledRef: { current: false },
    getQuizSubmissionDeadlineMs: () => Date.now() + 60000,
  },
);
restore(
  {
    answers: structuredClone(one.server.answers),
    currentIndex: 0,
    hintUsedCount: 0,
    revealedHintIds: [],
    orderOptionMap: {},
  },
  [{ id: 1 }],
  new Date().toISOString(),
);
assert.deepEqual(restored.answers, { 1: "정답" });
assert.equal(restored.currentIndex, 0);

// A second single click must not persist the previous selected option.
one.render().handleAnswer("오답");
one.render();
await one.tick();
assert.deepEqual(one.server.answers, { 1: "오답" });
assert.equal(one.calls[1].expectedRevision, 2);

// An edit whose debounce expires during a slow save is queued, not discarded.
const slow = fixture();
slow.hold();
slow.render().handleAnswer("첫 답");
slow.render();
await slow.tick();
slow.render().handleAnswer("최종 답");
slow.render();
await slow.tick();
assert.equal(slow.calls.length, 1);
assert.equal(slow.refs.persistQueuedRef.current, true);
await slow.release();
slow.render();
await slow.tick();
assert.deepEqual(slow.server.answers, { 1: "최종 답" });
assert.equal(slow.calls[1].expectedRevision, 2);
assert.equal(slow.warnings.length, 0);

// Latest view/submission guards also apply to callbacks created before navigation.
const stopped = fixture();
stopped.render().handleAnswer("정답");
stopped.state.view = "result";
stopped.render();
await stopped.tick();
assert.equal(stopped.calls.length, 0);

// Execute the production unmount cleanup captured by an older render.
// It clears the debounce and delegates once to the current function identity.
let cleanupEffect;
const findCleanup = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(quiz) === "useEffect" &&
    node.arguments[0]
      ?.getText(quiz)
      .includes('if (view !== "quiz" || !canonicalAttempt)')
  )
    cleanupEffect = node.arguments[0];
  ts.forEachChild(node, findCleanup);
};
findCleanup(quiz);
assert(cleanupEffect);
const closing = fixture(),
  oldRender = closing.render();
const cleanup = instantiate(`return (${cleanupEffect.getText(quiz)})();`, {
  view: "quiz",
  canonicalAttempt: closing.state.canonicalAttempt,
  persistTimeoutRef: closing.refs.persistTimeoutRef,
  window: closing.window,
  persistQuizProgress: oldRender.persistQuizProgress,
});
oldRender.handleAnswer("닫기 전 답안");
const latestRender = closing.render();
assert.notEqual(
  oldRender.persistQuizProgress,
  latestRender.persistQuizProgress,
);
assert.equal(
  closing.refs.persistQuizProgressRef.current,
  latestRender.persistQuizProgress,
);
cleanup();
await microtasks();
assert.equal(closing.timers.size, 0);
assert.equal(closing.calls.length, 1);
assert.deepEqual(closing.server.answers, { 1: "닫기 전 답안" });
assert.equal(closing.warnings.length, 0);

// An old response cannot replace a different newly selected attempt.
const switched = fixture();
switched.hold();
switched.render().handleAnswer("정답");
switched.render();
await switched.tick();
switched.state.canonicalAttempt = {
  attemptId: "other-owned-attempt",
  revision: 1,
};
await switched.release();
assert.equal(switched.state.canonicalAttempt.attemptId, "other-owned-attempt");

// A late save cannot revive a submitted attempt or lower a newer revision.
for (const protectedState of [
  { status: "SUBMITTED", revision: 3 },
  { status: "IN_PROGRESS", revision: 4 },
]) {
  const late = fixture();
  late.hold();
  late.render().handleAnswer("정답");
  late.render();
  await late.tick();
  late.state.canonicalAttempt = {
    ...late.state.canonicalAttempt,
    ...protectedState,
  };
  await late.release();
  assert.equal(late.state.canonicalAttempt.status, protectedState.status);
  assert.equal(late.state.canonicalAttempt.revision, protectedState.revision);
}

// History Classroom already schedules after committed answers through an effect
// dependency, so it has no matching event-handler stale-closure defect.
let historyEffect;
const visitHistory = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(history) === "useEffect" &&
    node.arguments[0]
      ?.getText(history)
      .includes("const timerId = window.setTimeout") &&
    node.arguments[0]?.getText(history).includes("saveAssessmentProgress")
  )
    historyEffect = node;
  ts.forEachChild(node, visitHistory);
};
visitHistory(history);
assert(historyEffect);
assert(
  historyEffect.arguments[1].elements.some(
    (element) => element.getText(history) === "answers",
  ),
);
const historyTimers = new Map();
let historyTimerId = 0;
const historyWrites = [];
const effect = (answers) =>
  instantiate(`return (${historyEffect.arguments[0].getText(history)})();`, {
    answers,
    attemptStarted: true,
    canonicalAttempt: { attemptId: "history-owned" },
    completed: false,
    submitting: false,
    isNetworkOffline: false,
    currentPage: 1,
    canonicalAttemptRef: {
      current: {
        attemptId: "history-owned",
        status: "IN_PROGRESS",
        revision: 1,
      },
    },
    serverTimeOffsetMsRef: { current: 0 },
    window: {
      setTimeout: (fn) => {
        historyTimers.set(++historyTimerId, fn);
        return historyTimerId;
      },
      clearTimeout: (id) => historyTimers.delete(id),
    },
    sanitizeHistoryClassroomAnswersForWrite: (value) => value,
    saveAssessmentProgress: async (payload) => {
      historyWrites.push(payload);
      return { revision: 2, savedAtIso: new Date().toISOString() };
    },
    setCanonicalAttempt: noop,
    setResultText: noop,
  });
const clearOldEffect = effect({});
clearOldEffect();
effect({ "blank-1": "고려" });
assert.equal(historyTimers.size, 1);
[...historyTimers.values()][0]();
await microtasks();
assert.deepEqual(historyWrites[0].answers, { "blank-1": "고려" });

compile(source(quizPath));
compile(source(historyPath));
console.log(
  JSON.stringify({
    status: "PASS",
    cases: 10,
    actualProductionHandlers: true,
    transpileFiles: 2,
    networkCalls: 0,
    browserRuns: 0,
  }),
);
