import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const { packHistoricalQuestionSnapshots } = createRequire(import.meta.url)("../functions/quizAchievementEvidence.js");

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
assert.deepEqual(JSON.parse(JSON.stringify(calls[6].input)), { ...scope, classIds: ["3-1"], mode: "detail", forceRefresh: false, snapshotDictionary: true });
resolveRequest({ data: { students: [], rawRows: [] } });
await detail;
const keywordDetail = exports.getQuizClassDetail({ ...scope, unitId: "", category: "", classIds: ["3-1"], keyword: "사화", comparisonGrade: "3" }, "teacher-a:1");
assert.equal(Object.hasOwn(calls[7].input, "comparisonGrade"), false, "summary-only grade must be absent, not undefined/null in the Firebase wire payload");
assert.equal(calls[7].input.keyword, "사화");
resolveRequest({ data: { students: [], rawRows: [] } });
await keywordDetail;
assert.match(exports.quizClassAnalysisError(denied), /권한/);
assert.match(exports.quizClassAnalysisError({ code: "functions/unauthenticated" }), /로그인/);
assert.match(exports.quizClassAnalysisError({ code: "functions/aborted", details: { reason: "QUIZ_ANALYSIS_CHANGED" } }), /조회 중.*갱신/);
assert.match(exports.quizClassAnalysisError({ code: "functions/aborted", details: { reason: "QUIZ_ANALYSIS_ROSTER_CONFLICT" } }), /소속 학급이 중복/);

const gradeScope = { ...scope, unitId: "exam_prep", category: "exam_prep", examRound: "round_1", classIds: [], grade: "3" };

const scoreRows = [{id:'exam-1',source:'canonical',raw:{studentUid:'a',semesterId:'2026-2',category:'exam_prep',examRound:'round_1',percent:0,total:1,cutScoreQuestions:[{id:'q',points:10,targetAchievementLevel:'C'}]}}];
const response = {grade:'3',rawRows:[{id:'exam-1',source:'canonical',raw:{questionSnapshotRefs:['q:1']}}],mockExamScoreRows:scoreRows,historicalQuestionSnapshots:{'q:1':{id:'q',question:'동결 원문'}}};
const request = exports.getQuizClassAchievement({...gradeScope,keyword:'무시',comparisonGrade:'2'}, 'teacher-a:1');
assert.equal(calls.at(-1).input.grade,'3');
assert.equal(Object.hasOwn(calls.at(-1).input,'compactEvidence'),false,'Retired evidence negotiation is removed');
assert.equal(Object.hasOwn(calls.at(-1).input,'snapshotDictionary'),false,'Achievement keeps its existing wire contract');
assert.equal(Object.hasOwn(calls.at(-1).input,'keyword'),false);
assert.equal(Object.hasOwn(calls.at(-1).input,'comparisonGrade'),false);
resolveRequest({data:response});
const decoded=await request;
assert.deepEqual(JSON.parse(JSON.stringify(decoded.mockExamScoreRows)),scoreRows,'Frozen score metadata including a real zero is preserved');
assert.equal(decoded.rawRows[0].raw.questionSnapshots[0].question,'동결 원문');
for(const malformed of [
  {...response,mockExamScoreRows:undefined},
  {...response,rawRows:null},
  {...response,historicalQuestionSnapshots:{}},
]) {
  const pending=exports.getQuizClassAchievement(gradeScope,'teacher-a:1');
  resolveRequest({data:malformed});
  await assert.rejects(pending,/자료/);
}

const frozenQuestion = {
  id: 'q', type: 'choice', question: '응시 당시 원문', passage: '응시 당시 자료',
  options: ['가', '나'], answer: '나', explanation: '당시 해설', points: 7,
  image: 'data:image/png;base64,frozen-image', choiceOptionImages: [null, 'frozen-choice'],
  passageSet: { id: 'set', instruction: '공통 지문', passage: '세트 자료', image: 'frozen-set' },
};
const revisedQuestion = { ...frozenQuestion, question: '같은 번호의 다른 원문', answer: '가', points: 3 };
const originalRows = [
  { id: 'first', source: 'canonical', raw: {
    studentUid: 'a', assessmentKind: 'QUIZ', semesterId: '2026-2', sourceHash: 'a'.repeat(64),
    percent: 0, score: 0, total: 2, earnedPoints: 0, maxPoints: 10,
    answers: { q: '', another: '가' }, answerChecks: [{ id: 'q', correct: false }, { id: 'another', correct: true }],
    learningSnapshot: [{ id: 'q', sourceRevision: 'old', points: 7 }],
    questionSnapshots: [revisedQuestion, frozenQuestion, revisedQuestion], questionSnapshotOmittedIds: ['missing'],
    analytics: { version: 1, questions: { q: { answerChangeCount: 2 } } },
  } },
  { id: 'second', source: 'canonical', raw: {
    studentUid: 'b', answers: { q: '나' }, questionSnapshots: [frozenQuestion],
  } },
  { id: 'legacy', source: 'legacy', raw: {
    uid: 'c', score: 0, details: [{ id: 'q', u: '', correct: false, questionSnapshot: frozenQuestion }],
  } },
  { id: 'empty', source: 'canonical', raw: { studentUid: 'd', questionSnapshots: [] } },
];
const baseDetail = { semesterId: '2026-2', grade: '3', complete: true, students: [], questions: [revisedQuestion], treeData: [], configuredClasses: [], generatedAt: '2026-11-09T00:00:00.000Z', version: 'fixture' };
const packedDetail = JSON.parse(JSON.stringify({ ...baseDetail, ...packHistoricalQuestionSnapshots(originalRows) }));
assert.equal(Object.keys(packedDetail.historicalQuestionSnapshots).length, 2, 'Different frozen revisions keep separate dictionary entries');
const beforeDecode = JSON.stringify(packedDetail);
const detailRequest = exports.getQuizClassDetail({ ...gradeScope, comparisonGrade: '2' }, 'teacher-a:1', true);
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).input)), { ...gradeScope, mode: 'detail', forceRefresh: true, snapshotDictionary: true });
resolveRequest({ data: packedDetail });
const decodedDetail = await detailRequest;
assert.deepEqual(JSON.parse(JSON.stringify(decodedDetail.rawRows.map(row => {
  const { questionSnapshotRefs, ...raw } = row.raw;
  return { ...row, raw };
}))), originalRows, 'Actual server packing restores every score, answer, repeated/order-sensitive snapshot, revision, omitted ID, and legacy field');
assert.deepEqual(decodedDetail.questions, packedDetail.questions, 'Current-bank questions are kept separate from frozen evidence');
assert.equal(JSON.stringify(packedDetail), beforeDecode, 'Decoding does not mutate the shared wire response');
assert.equal(decodedDetail.rawRows[0].raw.questionSnapshots[1], decodedDetail.rawRows[1].raw.questionSnapshots[0], 'Repeated snapshots use the same decoded object');

for (const load of [exports.getQuizClassDetail, exports.getQuizClassAchievement]) {
  const inline = { ...baseDetail, rawRows: originalRows, mockExamScoreRows: scoreRows };
  const inlineRequest = load(gradeScope, 'teacher-a:1');
  resolveRequest({ data: inline });
  const inlineResult = await inlineRequest;
  assert.deepEqual(JSON.parse(JSON.stringify(inlineResult)), inline, 'Older inline responses remain lossless');
  for (const malformed of [
    { ...packedDetail, rawRows: undefined },
    { ...packedDetail, rawRows: [{ id: 'bad', source: 'canonical', raw: null }] },
    { ...packedDetail, historicalQuestionSnapshots: undefined },
    { ...packedDetail, historicalQuestionSnapshots: {} },
    { ...packedDetail, historicalQuestionSnapshots: [] },
    ...[null, 'q', [null], ['missing'], ['toString']].map(refs => ({ ...packedDetail,
      rawRows: [{ id: 'bad', source: 'canonical', raw: { questionSnapshotRefs: refs } }] })),
    ...[null, 1, 'missing source', []].map(value => ({ ...packedDetail,
      historicalQuestionSnapshots: { bad: value },
      rawRows: [{ id: 'bad', source: 'canonical', raw: { questionSnapshotRefs: ['bad'] } }] })),
  ]) {
    const pending = load(gradeScope, 'teacher-a:1');
    resolveRequest({ data: { ...malformed, mockExamScoreRows: scoreRows } });
    await assert.rejects(pending, /문항 자료|누적 점수 자료/, 'Incomplete evidence rejects the whole response');
  }
}
console.log('PASS class analysis client: session-only reads, concurrent deduplication, identity isolation, detail-only dictionary opt-in, real server packing round-trip, frozen/legacy inline preservation, unchanged achievement wire and explicit incomplete-evidence rejection');
