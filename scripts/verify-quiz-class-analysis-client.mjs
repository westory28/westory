import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const calls = [];
let resolveRequest;
let rejectRequest;
const exports = {};
const source = ts.transpileModule(readFileSync("src/lib/quizClassAnalysis.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(source, {
  exports,
  require: (name) => {
    assert.equal(name, "./applicationSession");
    return {
      callWithApplicationSession: (callable, input) => {
        calls.push({ callable, input });
        return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
      },
    };
  },
});
const scope = { semesterId: "2026-2", unitId: "unit-a", category: "formative", examRound: "", classIds: ["3-1", "3-2"] };
const first = exports.getQuizClassSummary(scope, "teacher-a:1");
const simultaneous = exports.getQuizClassSummary(scope, "teacher-a:1");
assert.equal(calls.length, 1, "Only simultaneous identical reads may share one request");
assert.equal(calls[0].callable, "getQuizClassAnalysis");
assert.deepEqual(JSON.parse(JSON.stringify(calls[0].input)), { ...scope, mode: "summary", forceRefresh: false });
resolveRequest({ data: { classes: [] } });
assert.equal(await first, await simultaneous);

const later = exports.getQuizClassSummary(scope, "teacher-a:1");
assert.equal(calls.length, 2, "A later read rechecks session and authorization; no persisted personal cache");
resolveRequest({ data: { classes: [] } });
await later;

const rejected = exports.getQuizClassSummary(scope, "teacher-a:1");
const denied = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
rejectRequest(denied);
await assert.rejects(rejected, (failure) => failure === denied);
assert.equal(calls.length, 3, "Permission errors never invoke a direct Firestore fallback");
const retry = exports.getQuizClassSummary(scope, "teacher-a:1", true);
assert.equal(calls.length, 4);
assert.equal(calls[3].input.forceRefresh, true);
resolveRequest({ data: { classes: [] } });
await retry;

const pendingA = exports.getQuizClassCatalog("2026-2", "teacher-a:1");
const resolveA = resolveRequest;
const pendingB = exports.getQuizClassCatalog("2026-2", "teacher-b:1");
assert.equal(calls.length, 6, "Different authentication identities cannot share a response");
resolveA({ data: { owner: "a" } });
resolveRequest({ data: { owner: "b" } });
assert.equal((await pendingA).owner, "a");
assert.equal((await pendingB).owner, "b");

const detail = exports.getQuizClassDetail({ ...scope, classIds: ["3-1"] }, "teacher-a:1");
assert.deepEqual(JSON.parse(JSON.stringify(calls[6].input)), { ...scope, classIds: ["3-1"], mode: "detail", forceRefresh: false });
resolveRequest({ data: { students: [] } });
await detail;
assert.match(exports.quizClassAnalysisError(denied), /권한/);
assert.match(exports.quizClassAnalysisError({ code: "functions/unauthenticated" }), /로그인/);
console.log("PASS class analysis client: session-only reads, concurrent deduplication, no retained result cache, isolated identities, permission denial, explicit refresh, single-class detail");
