import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const storage = new Map();
let id = 0, sensitive = 0;
let storageBlocked = false, sensitiveFailure = null;
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
  if (name === './sensitiveOperation') return { ensureSensitiveOperation: async () => { sensitive++; if (sensitiveFailure) throw sensitiveFailure; } };
  if (name === './historyDictionarySession') return { getHistoryDictionaryCallable: async name => async data => ({ data: await handler(name, data) }) };
  throw new Error(name);
}, window: { sessionStorage: { getItem: key => { if (storageBlocked) throw new Error('Storage blocked'); return storage.get(key); }, setItem: (key, value) => { if (storageBlocked) throw new Error('Storage blocked'); return storage.set(key, value); }, removeItem: key => { if (storageBlocked) throw new Error('Storage blocked'); return storage.delete(key); } } },
crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` }, Date, Map, console });
const error = (code, reason) => Object.assign(new Error(code), { code, details: { reason } });
let calls = [];
handler = async (name, payload) => { calls.push([name, payload]); return { status: 'READY', definition: { definitionId: 'quiz:2026-2:unit:formative' }, attempt: null }; };
await exports.getAssessmentState({ definitionId: 'quiz:2026-2:unit:formative' });
assert.deepEqual(calls.map(([name]) => name), ['getAssessmentState']);
calls = [];
await Promise.all(Array.from({ length: 4 }, () => exports.getAssessmentState({ definitionId: 'quiz:2026-2:unit:formative' })));
assert.equal(calls.length, 1, 'Concurrent identical state reads share one callable');
await exports.getAssessmentState({ definitionId: 'quiz:2026-2:unit:formative' });
assert.equal(calls.length, 2, 'Completed state is never cached across a later publication change');

handler = async (name, payload) => {
  calls.push([name, payload]);
  if (name === 'executeCommand') throw error('functions/unavailable');
  return { ...payload, status: 'SUCCEEDED', result: { attemptId: 'attempt-recovered', revision: 1 } };
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
handler = async (_name, payload) => ({ ...payload, status: 'SUCCEEDED', replayed: false, result: { revision: 2 } });
assert.equal((await exports.executeAssessmentManagementCommand('transitionAssessmentDefinition', { definitionId: 'quiz:2026-2:unit:formative', expectedRevision: 1, targetStatus: 'PUBLISHED' })).revision, 2);
assert.equal(sensitive, 0);

// Routine exemption work must reach the canonical session/teacher checks even
// when the optional high-risk App Check / reauthentication setup is unavailable.
sensitiveFailure = new Error('운영 인증 설정을 확인해야 합니다.');
const grantPayload = { semesterId: '2026-2', recipientUids: ['student-a'], reason: '학급 활동' };
const routineClassroomCommands = ['grantHistoryClassroomExemptions', 'revokeHistoryClassroomExemptions', 'reviewHistoryClassroomExemptionRequest',
  'upsertHistoryClassroomSource', 'saveHistoryClassroomAssignment', 'applyHistoryClassroomExemption', 'createAssessmentDefinition', 'updateAssessmentDefinition', 'transitionAssessmentDefinition', 'saveQuizAssessmentSettings', 'upsertQuizQuestion'];
const serverRoutine = JSON.parse(readFileSync('functions/productionGateway/routineContentWrites.json', 'utf8')).commands;
for (const commandType of routineClassroomCommands) {
  assert.ok(serverRoutine.includes(commandType), `${commandType} must have the same general-session server policy`);
  const before = sensitive;
  assert.equal((await exports.executeAssessmentManagementCommand(commandType, grantPayload)).revision, 2);
  assert.equal(sensitive, before, `${commandType} uses the routine classroom session policy`);
}
for (const commandType of ['deleteHistoryClassroomSource', 'resetAssessmentAttempt', 'resetAssessmentAttemptsByClassV2']) {
  await assert.rejects(exports.executeAssessmentManagementCommand(commandType, { definitionId: 'protected' }), /운영 인증 설정/);
}
sensitiveFailure = null;

// A lost class-grant response must reuse its receipt even without storage.
storageBlocked = true;
calls = [];
handler = async (name, payload) => { calls.push([name, payload]); throw error('functions/internal'); };
await assert.rejects(exports.executeAssessmentManagementCommand('grantHistoryClassroomExemptions', grantPayload));
const grantId = calls[0][1].commandId;
handler = async (name, payload) => {
  calls.push([name, payload]);
  return { ...payload, status: 'SUCCEEDED', replayed: true, result: { createdCount: 1, exemptionIds: ['ticket-a'] } };
};
assert.equal((await exports.executeAssessmentManagementCommand('grantHistoryClassroomExemptions', grantPayload)).createdCount, 1);
assert.equal(calls.at(-1)[1].commandId, grantId);
storageBlocked = false;

// A mismatched response is never accepted, and a matching receipt can recover
// the operation without issuing the grant again.
calls = [];
handler = async (name, payload) => {
  calls.push([name, payload]);
  return { ...payload, commandId: name === 'executeCommand' ? 'wrong-id' : payload.commandId,
    status: 'SUCCEEDED', result: { createdCount: name === 'executeCommand' ? 999 : 1 } };
};
assert.equal((await exports.executeAssessmentManagementCommand('grantHistoryClassroomExemptions', grantPayload)).createdCount, 1);
assert.deepEqual(calls.map(([name]) => name), ['executeCommand', 'getCommandStatus']);

calls = [];
handler = async (name, payload) => {
  calls.push([name, payload]);
  return { ...payload, commandType: 'different-command', status: 'SUCCEEDED', result: { createdCount: 999 } };
};
await assert.rejects(exports.executeAssessmentManagementCommand('grantHistoryClassroomExemptions', grantPayload), /처리 결과를 확인/);
const mismatchedId = calls[0][1].commandId;
handler = async (name, payload) => {
  calls.push([name, payload]);
  return { ...payload, status: 'SUCCEEDED', result: { createdCount: 1 } };
};
await exports.executeAssessmentManagementCommand('grantHistoryClassroomExemptions', grantPayload);
assert.equal(calls.at(-1)[1].commandId, mismatchedId);
console.log('PASS canonical assessment client: read-only preflight, receipt recovery, owner isolation, stable retry/save IDs, conflict preservation, teacher step-up, routine exemption session policy, blocked-storage retry and verified receipts (12 groups; network 0)');
