import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const storage = new Map();
let id = 0, sensitive = 0;
let epoch = 1700000000;
const auth = { currentUser: { uid: 'student-a' } };
let handler = async () => { throw new Error('Unexpected callable'); };
const source = ts.transpileModule(readFileSync('src/lib/assessmentLifecycle.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
runInNewContext(source, { exports, require: name => {
  if (name === './firebase') return { auth };
  if (name === 'firebase/auth') return { getIdTokenResult: async () => ({ authTime: new Date(epoch * 1000).toISOString() }) };
  if (name === './sensitiveOperation') return { ensureSensitiveOperation: async () => { sensitive++; } };
  if (name === './historyDictionarySession') return { getHistoryDictionaryCallable: async name => async data => ({ data: await handler(name, data) }) };
  throw new Error(name);
}, window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` }, Date, Map, console });
const error = (code, reason) => Object.assign(new Error(code), { code, details: { reason } });
let calls = [];
handler = async (name, payload) => { calls.push([name, payload]); return { status: 'READY', definition: { definitionId: 'quiz:2026-2:unit:formative' }, attempt: null }; };
await exports.getAssessmentState({ definitionId: 'quiz:2026-2:unit:formative' });
assert.deepEqual(calls.map(([name]) => name), ['getAssessmentState']);

handler = async (name, payload) => {
  calls.push([name, payload]);
  if (name === 'executeCommand') throw error('functions/unavailable');
  return { status: 'SUCCEEDED', result: { attemptId: 'attempt-recovered', revision: 1 } };
};
const recovered = await exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:unit:formative' });
assert.equal(recovered.attemptId, 'attempt-recovered');
assert.equal(storage.size, 0);

calls = [];
handler = async (name, payload) => { calls.push([name, payload]); throw error('functions/unavailable'); };
await assert.rejects(exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:unit:formative' }));
const firstId = calls[0][1].commandId;
await assert.rejects(exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:unit:formative' }));
assert.equal(calls[2][1].commandId, firstId);
auth.currentUser = { uid: 'student-b' };
await assert.rejects(exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:unit:formative' }));
assert.notEqual(calls[4][1].commandId, firstId);
storage.clear();

let submissions = 0;
handler = async (name, payload) => {
  assert.equal(name, 'executeCommand', 'Revision conflict must not fetch and adopt another writer revision');
  submissions++;
  assert.equal(payload.payload.expectedRevision, 1);
  assert.equal(payload.payload.answers.q1, '답안');
  throw error('functions/aborted', 'ASSESSMENT_ATTEMPT_REVISION_CONFLICT');
};
const conflictedInput = { attemptId: 'saved', expectedRevision: 1, answers: { q1: '답안' }, submitReason: 'STUDENT' };
await assert.rejects(exports.submitAssessmentAttempt(conflictedInput), exports.isAssessmentRevisionConflict);
assert.equal(submissions, 1);
assert.equal(conflictedInput.answers.q1, '답안');

calls = [];
handler = async (name, payload) => { calls.push([name, payload]); throw error('functions/unavailable'); };
const progress = { attemptId: 'attempt', expectedRevision: 1, answers: { q1: '답안' }, currentItemId: 'q1' };
await assert.rejects(exports.saveAssessmentProgress(progress));
await assert.rejects(exports.saveAssessmentProgress(progress));
assert.equal(calls[0][1].saveId, calls[1][1].saveId);

calls = [];
handler = async (name, payload) => { calls.push([name, payload]); throw error('functions/permission-denied'); };
await assert.rejects(exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:denied:formative' }));
assert.equal(calls.length, 1);
handler = async () => { auth.currentUser = { uid: 'student-c' }; return { result: { attemptId: 'foreign' } }; };
await assert.rejects(exports.startAssessmentAttempt({ definitionId: 'quiz:2026-2:owner:formative' }), /로그인 상태가 변경/);
for (const method of ['getAssessmentState','saveAssessmentProgress','startAssessmentAttempt']) {
 handler = async () => { epoch++; return { result: { attemptId:'stale' }, status:'READY', revision:3 }; };
 await assert.rejects(exports[method](method==='saveAssessmentProgress'?progress:{definitionId:'quiz:2026-2:epoch:formative'}),/로그인 상태가 변경/);
}
handler = async () => ({ result: { revision: 2 } });
assert.equal((await exports.executeAssessmentManagementCommand('transitionAssessmentDefinition', { definitionId: 'quiz:2026-2:unit:formative', expectedRevision: 1, targetStatus: 'PUBLISHED' })).revision, 2);
assert.equal(sensitive, 1);
console.log('PASS canonical assessment client: read-only preflight, receipt recovery, owner isolation, stable retry/save IDs, no overwrite after revision conflict, denied commands and teacher step-up (8 groups; network 0)');
