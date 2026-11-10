import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const listeners = new Set(), callbacks = [], errors = [], calls = [];
const user = { uid: 'student-a' }, auth = { currentUser: user };
const document = { hidden: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
let subscriptions = 0, disconnects = 0;
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/quizResultCorrections.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, document, console, require: name => name === './firebase' ? { auth, db: {} } : {
  doc: (_, ...parts) => parts.join('/'), onSnapshot: (path, callback) => {
    assert.equal(path, 'quiz_result_correction_signals/result-a'); subscriptions++;
    callbacks.push(callback); return () => { disconnects++; };
  },
} });
const emit = (version, extra = {}) => callbacks.at(-1)({ data: () => ({ version, studentUid: 'student-a', semesterId: '2026-2', ...extra }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
let release;
const stop = exports.watchQuizResultCorrections({ resultId: 'result-a', semesterId: '2026-2', initialVersion: 'v0',
  onChange: async version => { calls.push(version); if (version === 'v1') await new Promise(resolve => { release = resolve; }); },
  onError: error => errors.push(error),
});
assert.equal(subscriptions, 1); emit('v0'); await tick(); assert.deepEqual(calls, []);
emit('v1'); emit('v1'); emit('v2'); await tick(); assert.deepEqual(calls, ['v1']);
release(); await tick(); await tick(); assert.deepEqual(calls, ['v1', 'v2']);
emit('v2'); emit('wrong-user', { studentUid: 'student-b' }); emit('wrong-scope', { semesterId: '2026-1' }); await tick(); assert.equal(calls.length, 2);
document.hidden = true; for (const callback of listeners) callback(); assert.equal(disconnects, 1); assert.equal(subscriptions, 1);
document.hidden = false; for (const callback of listeners) callback(); assert.equal(subscriptions, 2);
emit('v2'); await tick(); assert.equal(calls.length, 2);
auth.currentUser = { uid: 'student-b' }; emit('v3'); await tick(); assert.equal(calls.length, 2);
stop(); assert.equal(disconnects, 2); assert.equal(listeners.size, 0); assert.deepEqual(errors, []);
auth.currentUser = user;
const failing = exports.watchQuizResultCorrections({ resultId: 'result-a', semesterId: '2026-2', onChange: async () => { throw Error('offline'); }, onError: error => errors.push(error.message) });
emit('failed'); await tick(); await tick(); assert.deepEqual(errors, ['offline'], 'A read failure does not start an automatic request loop'); failing();
console.log('Quiz result correction signals: bounded reads, version dedupe, in-flight coalescing, hidden unsubscribe, scope/auth guard, cleanup and failure passed.');
