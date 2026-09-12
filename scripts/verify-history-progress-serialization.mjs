import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const path = "src/pages/student/history-classroom/HistoryClassroomRunner.tsx";
const file = ts.createSourceFile(
  path,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const initializer = (name) => {
  let found;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(file) === name)
      found = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(file);
  assert(found, name);
  return found.getText(file);
};
const compile = (text, bindings) =>
  new Function(
    ...Object.keys(bindings),
    ts.transpileModule(text, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
  )(...Object.values(bindings));
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const setup = () => {
  const calls = [],
    pending = [];
  const refs = {
    canonicalAttemptRef: {
      current: {
        attemptId: "owned",
        status: "STARTED",
        revision: 1,
        answers: {},
      },
    },
    progressSaveTailRef: { current: Promise.resolve() },
    latestProgressRef: { current: { answers: {}, currentPage: 1 } },
    serverTimeOffsetMsRef: { current: 0 },
  };
  const bindings = {
    ...refs,
    sanitizeHistoryClassroomAnswersForWrite: (x) => ({ ...x }),
    setCanonicalAttempt: (x) => {
      refs.canonicalAttemptRef.current = x;
    },
    saveAssessmentProgress: (payload) => {
      calls.push(payload);
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  };
  const save = compile(
    `return ${initializer("persistCanonicalProgress")};`,
    bindings,
  );
  const resolve = (index, revision) =>
    pending[index].resolve({
      revision,
      savedAtIso: "2026-09-11T16:00:00.000Z",
    });
  return { refs, bindings, calls, pending, save, resolve };
};
let cases = 0;
const ordered = setup(),
  first = ordered.save();
await tick();
ordered.refs.latestProgressRef.current = {
  answers: { "blank-1": "고려" },
  currentPage: 2,
};
const second = ordered.save();
await tick();
assert.equal(ordered.calls.length, 1);
cases++;
ordered.resolve(0, 2);
await first;
await tick();
assert.equal(ordered.calls[1].expectedRevision, 2);
assert.deepEqual(ordered.calls[1].answers, { "blank-1": "고려" });
cases++;
ordered.resolve(1, 3);
await second;
assert.equal(ordered.refs.canonicalAttemptRef.current.revision, 3);
assert.equal(ordered.refs.canonicalAttemptRef.current.currentItemId, "2");
cases++;
for (const changed of [
  { attemptId: "other", status: "STARTED", revision: 1 },
  { attemptId: "owned", status: "SUBMITTED", revision: 4 },
  { attemptId: "owned", status: "IN_PROGRESS", revision: 8 },
]) {
  const f = setup(),
    p = f.save();
  await tick();
  f.refs.canonicalAttemptRef.current = changed;
  f.resolve(0, 2);
  await p;
  assert.strictEqual(f.refs.canonicalAttemptRef.current, changed);
  cases++;
}
const skipped = setup();
let release;
skipped.refs.progressSaveTailRef.current = new Promise((r) => (release = r));
const obsolete = skipped.save();
skipped.refs.canonicalAttemptRef.current = {
  attemptId: "other",
  status: "STARTED",
  revision: 1,
};
release();
assert.equal(await obsolete, null);
assert.equal(skipped.calls.length, 0);
cases++;
const exiting = setup(),
  exitSave = exiting.save(true);
await tick();
exiting.resolve(0, 2);
await exitSave;
assert.equal(exiting.refs.canonicalAttemptRef.current.status, "RECOVERABLE");
cases++;
const failed = setup(),
  bad = failed.save();
await tick();
const caught = assert.rejects(bad, /offline/);
failed.pending[0].reject(new Error("offline"));
await caught;
const retry = failed.save();
await tick();
assert.equal(failed.calls[1].expectedRevision, 1);
failed.resolve(1, 2);
await retry;
cases++;
const submitting = setup(),
  saving = submitting.save();
await tick();
const submissions = [];
const submit = compile(`return ${initializer("saveResult")};`, {
  ...submitting.bindings,
  assignment: { id: "owned-definition", passThresholdPercent: 80 },
  userData: { uid: "owned-student" },
  answers: { "blank-1": "고려" },
  summarizeHistoryClassroomAnswers: () => ({
    checks: [],
    score: 1,
    total: 1,
    percent: 100,
  }),
  sanitizeHistoryClassroomAnswerChecksForWrite: (x) => x,
  withTimeout: (x) => x,
  HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS: 1000,
  submitAssessmentAttempt: (payload) => {
    submissions.push(payload);
    return Promise.reject(new Error("submission observed"));
  },
});
const finished = assert.rejects(
  submit({ submitReason: "STUDENT" }),
  /submission observed/,
);
await tick();
assert.equal(submissions.length, 0);
submitting.resolve(0, 2);
await saving;
await finished;
assert.equal(submissions[0].expectedRevision, 2);
assert.deepEqual(submissions[0].answers, { "blank-1": "고려" });
cases++;
const exitHarness = (mode) => {
  const f = setup(),
    navigations = [],
    notices = [],
    busy = [];
  const exitRefs = {
    completedRef: { current: false },
    submittingRef: { current: false },
    cancellationInFlightRef: { current: false },
    networkOfflineRef: { current: false },
    exitNavigationAllowedRef: { current: false },
  };
  const handleExit = compile(`return ${initializer("handleForcedCancel")};`, {
    ...f.bindings,
    ...exitRefs,
    assignment: { id: "owned-definition" },
    userData: { uid: "owned-student" },
    persistCanonicalProgress: f.save,
    navigate: (...args) => navigations.push(["route", ...args]),
    showToast: (notice) => notices.push(notice),
    console: { error: () => {} },
  });
  const confirm = compile(`return ${initializer("confirmPendingExit")};`, {
    useCallback: (fn) => fn,
    pendingExitAction: {
      reason: "student-exit",
      mode,
      redirectTo: "/student/history-classroom",
    },
    exitConfirmSubmitting: false,
    setExitConfirmSubmitting: (value) => busy.push(value),
    handleForcedCancel: handleExit,
    exitNavigationAllowedRef: exitRefs.exitNavigationAllowedRef,
    window: {
      history: { back: () => navigations.push(["back"]) },
      location: { reload: () => navigations.push(["reload"]) },
    },
    setPendingExitAction: () => {},
  });
  return { ...f, ...exitRefs, navigations, notices, busy, handleExit, confirm };
};
for (const mode of ["route", "back", "reload"]) {
  const ok = exitHarness(mode),
    pending = ok.confirm();
  await tick();
  assert.equal(ok.navigations.length, 0, "navigation waits for server save");
  assert.equal(ok.exitNavigationAllowedRef.current, false);
  cases++;
  ok.resolve(0, 2);
  await pending;
  assert.equal(ok.navigations.length, 1);
  assert.equal(ok.navigations[0][0], mode);
  assert.equal(ok.cancellationInFlightRef.current, false);
  cases++;

  const failure = exitHarness(mode),
    rejected = failure.confirm();
  await tick();
  failure.pending[0].reject(new Error("unconfirmed save"));
  await rejected;
  assert.equal(failure.navigations.length, 0);
  assert.equal(failure.exitNavigationAllowedRef.current, false);
  assert.equal(failure.cancellationInFlightRef.current, false);
  assert.equal(failure.busy.at(-1), false);
  assert.equal(failure.notices.length, 1);
  cases++;
  const retry = failure.confirm();
  await tick();
  failure.resolve(1, 2);
  await retry;
  assert.equal(failure.navigations.length, 1, "failed exit can be retried");
  cases++;

  const offline = exitHarness(mode);
  offline.networkOfflineRef.current = true;
  await offline.confirm();
  assert.equal(offline.calls.length, 0);
  assert.equal(offline.navigations.length, 0);
  assert.equal(offline.exitNavigationAllowedRef.current, false);
  assert.equal(offline.cancellationInFlightRef.current, false);
  assert.equal(offline.busy.at(-1), false);
  assert.equal(offline.notices.length, 1);
  cases++;
  offline.networkOfflineRef.current = false;
  const online = offline.confirm();
  await tick();
  offline.resolve(0, 2);
  await online;
  assert.equal(offline.navigations.length, 1);
  cases++;
}
const changedExit = exitHarness("route");
let releaseExit;
changedExit.refs.progressSaveTailRef.current = new Promise(
  (resolve) => (releaseExit = resolve),
);
const change = changedExit.confirm();
changedExit.refs.canonicalAttemptRef.current = {
  attemptId: "different",
  status: "STARTED",
  revision: 1,
};
releaseExit();
await change;
assert.equal(changedExit.navigations.length, 0);
assert.equal(changedExit.notices.length, 1);
cases++;
const doubleExit = exitHarness("route"),
  firstExit = doubleExit.handleExit("first");
await tick();
assert.equal(await doubleExit.handleExit("second"), false);
assert.equal(doubleExit.calls.length, 1);
doubleExit.resolve(0, 2);
assert.equal(await firstExit, true);
assert.equal(doubleExit.navigations.length, 1);
cases++;
const previewExit = exitHarness("route");
previewExit.refs.canonicalAttemptRef.current = null;
assert.equal(await previewExit.handleExit("preview"), true);
assert.equal(previewExit.calls.length, 0);
assert.equal(previewExit.navigations.length, 1);
cases++;
console.log(
  JSON.stringify({
    passed: true,
    cases,
    actualProductionHandlers: true,
    networkCalls: 0,
  }),
);
