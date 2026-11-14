/** Exercise the actual quiz recovery callback without Firebase or real answers. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const file = "src/pages/student/quiz/QuizRunner.tsx";
const source = await fs.readFile(file, "utf8");
const tree = ts.createSourceFile(
  file,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === "prepareQuizAssetRecovery"
  )
    callback = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback);
const compiled = ts.transpileModule(`globalThis.prepare = ${callback}`, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const writes = [];
let fail = false;
const attempt = {
  attemptId: "synthetic-attempt",
  status: "IN_PROGRESS",
  revision: 3,
  answers: { 1: "A" },
};
const scope = {
  view: "quiz",
  canonicalAttempt: attempt,
  canonicalAttemptRef: { current: { ...attempt } },
  answers: { 1: "B" },
  selectedQuestions: [{ id: "1" }],
  currentIndex: 0,
  readTelemetry: () => ({ version: 1 }),
  assetRecoveryPendingRef: { current: false },
  persistTimeoutRef: { current: 12 },
  persistQueuedRef: { current: true },
  window: { clearTimeout: () => {} },
  finishSaveTailRef: { current: Promise.resolve() },
  persistSaveTailRef: { current: Promise.resolve() },
  saveAssessmentProgress: async (input) => {
    writes.push(input);
    if (fail) throw Error("Synthetic save failure");
    return {
      revision: input.expectedRevision + 1,
      savedAtIso: "2026-11-14T10:00:00Z",
    };
  },
  setCanonicalAttempt: (update) => {
    scope.canonicalAttemptRef.current = update(
      scope.canonicalAttemptRef.current,
    );
  },
};
const context = vm.createContext(scope);
vm.runInContext(compiled, context);
const existingSave = deferred();
scope.persistSaveTailRef.current = existingSave.promise;
const recovering = context.prepare();
await Promise.resolve();
assert.equal(writes.length, 0, "An in-flight progress save must settle first");
assert.equal(scope.assetRecoveryPendingRef.current, true);
assert.equal(scope.persistTimeoutRef.current, null);
assert.equal(
  scope.persistQueuedRef.current,
  false,
  "Recovery owns the final save; no delayed duplicate",
);
scope.canonicalAttemptRef.current = { ...attempt, revision: 4 };
existingSave.resolve();
await recovering;
assert.equal(writes.length, 1);
assert.equal(
  writes[0].expectedRevision,
  4,
  "Final save uses the confirmed revision",
);
assert.equal(
  writes[0].answers["1"],
  "B",
  "The latest unsaved answer is retained",
);
assert.equal(scope.canonicalAttemptRef.current.revision, 5);

fail = true;
await assert.rejects(
  context.prepare(),
  /Synthetic save failure/,
  "A failed save must block automatic navigation",
);
assert.equal(scope.answers["1"], "B");
fail = false;
await context.prepare();
assert.equal(
  writes.length,
  3,
  "Explicit retry sends only the failed progress save",
);

const existingSubmission = deferred();
scope.finishSaveTailRef.current = existingSubmission.promise;
const submittedRecovery = context.prepare();
await Promise.resolve();
assert.equal(writes.length, 3, "Do not race an existing user submission");
scope.canonicalAttemptRef.current = {
  ...attempt,
  status: "SUBMITTED",
  revision: 9,
};
existingSubmission.resolve();
await submittedRecovery;
assert.equal(
  writes.length,
  3,
  "A submitted attempt gets no extra save, submit, grade, or reward",
);

scope.canonicalAttemptRef.current = {
  ...attempt,
  attemptId: "different-attempt",
};
await assert.rejects(context.prepare(), /응시 상태가 변경/);
assert.equal(
  writes.length,
  3,
  "Another attempt cannot receive the retained answers",
);
scope.view = "result";
await context.prepare();
assert.equal(writes.length, 3, "A result screen does not save progress");
console.log(
  "PASS actual quiz update recovery: pending-save drain, latest revision and answer snapshot, failed-save retry, pending-submit drain, submitted/other-attempt protection; no submit, grading, reward, or signature call.",
);
