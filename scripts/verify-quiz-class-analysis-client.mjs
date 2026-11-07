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
const keywordDetail = exports.getQuizClassDetail({ ...scope, unitId: "", category: "", classIds: ["3-1"], keyword: "사화", comparisonGrade: "3" }, "teacher-a:1");
assert.equal(Object.hasOwn(calls[7].input, "comparisonGrade"), false, "summary-only grade must be absent, not undefined/null in the Firebase wire payload");
assert.equal(calls[7].input.keyword, "사화");
resolveRequest({ data: { students: [] } });
await keywordDetail;
assert.match(exports.quizClassAnalysisError(denied), /권한/);
assert.match(exports.quizClassAnalysisError({ code: "functions/unauthenticated" }), /로그인/);

const gradeScope = { ...scope, unitId: "exam_prep", category: "exam_prep", examRound: "round_1", classIds: [], grade: "3" };
const observations = [
  { id: "worksheet:a:unit:0", studentUid: "a", semesterId: "2026-2", source: "worksheet", itemId: "unit:0", correct: false, filled: false, hintViewed: null, achievementStandardCodes: ["9역10-01"] },
  { id: "canonical:b:q", studentUid: "b", semesterId: "2026-2", source: "diagnostic", itemId: "q", correct: true, filled: true, hintViewed: false, achievementStandardCodes: [], resultId: "result-b" },
];
const keys = [...new Set(observations.flatMap(Object.keys))];
const values = [];
const rows = observations.map(observation => keys.map(key => {
  if (!Object.hasOwn(observation, key)) return -1;
  const serialized = JSON.stringify(observation[key]);
  let index = values.findIndex(value => JSON.stringify(value) === serialized);
  if (index === -1) { index = values.length; values.push(observation[key]); }
  return index;
}));
const table = { version: 1, keys, values, rows };
const achievementResponse = evidence => ({ grade: "3", rawRows: [], achievementEvidence: { version: 1, status: "ready", examCutoffs: [], ...evidence } });
const compact = exports.getQuizClassAchievement(gradeScope, "teacher-a:1");
assert.equal(calls.at(-1).input.compactEvidence, true, "Compact responses are explicitly negotiated with the server");
assert.equal(calls.at(-1).input.grade, "3");
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).input.classIds)), []);
resolveRequest({ data: achievementResponse({ observationTable: table }) });
const decoded = await compact;
assert.deepEqual(JSON.parse(JSON.stringify(decoded.achievementEvidence.observations)), observations);
assert.equal(Object.hasOwn(decoded.achievementEvidence, "observationTable"), false);
assert.equal(Object.hasOwn(decoded.achievementEvidence.observations[0], "resultId"), false, "Absent properties remain absent, not null");

const plain = exports.getQuizClassAchievement(gradeScope, "teacher-a:1");
resolveRequest({ data: achievementResponse({ observations }) });
assert.deepEqual(JSON.parse(JSON.stringify((await plain).achievementEvidence.observations)), observations, "Existing uncompressed responses remain compatible");

for (const malformed of [
  { ...table, version: 2 },
  { ...table, keys: [...keys, keys[0]] },
  { ...table, keys: ["__proto__", ...keys.slice(1)] },
  { ...table, rows: [[...rows[0], 0]] },
  { ...table, rows: [[values.length, ...rows[0].slice(1)]] },
  { ...table, rows: [[-2, ...rows[0].slice(1)]] },
  { ...table, rows: [[0.5, ...rows[0].slice(1)]] },
  { ...table, rows: [[-1, ...rows[0].slice(1)]] },
]) {
  const request = exports.getQuizClassAchievement(gradeScope, "teacher-a:1");
  resolveRequest({ data: achievementResponse({ observationTable: malformed }) });
  await assert.rejects(request, /학습 근거/);
}
const ambiguous = exports.getQuizClassAchievement(gradeScope, "teacher-a:1");
resolveRequest({ data: achievementResponse({ observationTable: table, observations }) });
await assert.rejects(ambiguous, /학습 근거/);
console.log("PASS whole-grade evidence: lossless table restoration, false/null/absent distinctions, negotiated compatibility, malformed table rejection");
console.log("PASS class analysis client: session-only reads, concurrent deduplication, no retained result cache, isolated identities, permission denial, explicit refresh, single-class detail");
