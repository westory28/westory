import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(setImmediate); };
function harness() {
  let clock = 0, timerId = 0, commandId = 0;
  const timers = new Map(), storage = new Map(), modules = new Map(), calls = [], receipts = new Map();
  const auth = { currentUser: { uid: 'fixture-student' } };
  const state = { epoch: '2026-11-10T00:00:00.000Z', command: null, read: null, settings: null, commit: true };
  const definitionId = 'quiz:2026-2:fixture:exam_prep:round_1';
  const attempt = { attemptId: 'fixture-attempt', definitionId, status: 'STARTED', questionIds: ['1'], questionPresentation: [{ id: '1' }], answers: { 1: 'saved' }, deadlineAtIso: '2026-11-10T00:30:00.000Z' };
  const snapshot = () => ({ status: 'RECOVERABLE', definition: { definitionId }, attempt: { ...attempt }, serverNowIso: '2026-11-10T00:00:08.000Z' });
  const load = name => {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const code = ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports, console, crypto: { randomUUID: () => `fixture-command-${++commandId}` },
      setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
      clearTimeout: id => timers.delete(id),
      window: { sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
      require: dependency => {
        if (dependency === './firebase') return { auth, db: {} };
        if (dependency === 'firebase/auth') return { getIdTokenResult: async () => ({ authTime: state.epoch }) };
        if (dependency === './sensitiveOperation') return { ensureSensitiveOperation: async () => {} };
        if (dependency === 'firebase/firestore') return { doc: (_db, _collection, id) => id, getDoc: id => { calls.push({ name: 'getDoc', id }); return state.settings(id); }, getDocFromServer: id => { calls.push({ name: 'getDocFromServer', id }); return state.settings(id); } };
        if (dependency === './historyDictionarySession') return { getHistoryDictionaryCallable: async name => async input => {
          calls.push({ name, input });
          if (name === 'getAssessmentState') return { data: state.read ? await state.read(input) : snapshot() };
          if (name === 'getCommandStatus') return { data: receipts.get(input.commandId) || { ...input, status: 'NOT_FOUND' } };
          if (name !== 'executeCommand') throw Error(`Unexpected ${name}`);
          const receipt = { commandId: input.commandId, commandType: input.commandType, status: 'SUCCEEDED', result: { ...attempt } };
          if (state.commit) receipts.set(input.commandId, receipt);
          if (state.command) await state.command(input);
          return { data: receipt };
        } };
        if (dependency.startsWith('./')) return load(dependency.slice(2));
        throw Error(dependency);
      },
    });
    return exports;
  };
  return { api: load('assessmentLifecycle'), settings: load('siteSettings'), state, storage, auth, calls, attempt, definitionId, snapshot, receipts, timers,
    async advance(ms) { clock += ms; for (const [id, timer] of [...timers]) { if (timer.at <= clock) { timers.delete(id); void timer.callback(); } } await flush(); },
  };
}

// Reproduce the reported case: START commits but its HTTP response never comes.
// The paper must open from that command's receipt, with the saved answers/clock.
{
  const h = harness(), first = deferred(), second = deferred(); let count = 0;
  h.state.command = () => (++count === 1 ? first.promise : second.promise);
  const pending = h.api.startAssessmentAttempt({ definitionId: h.definitionId });
  await flush(); await h.advance(8000);
  const restored = await pending;
  assert.equal(restored.attemptId, h.attempt.attemptId); assert.equal(restored.answers[1], 'saved');
  assert.equal(restored.deadlineAtIso, h.attempt.deadlineAtIso); assert.equal(restored.serverNowIso, h.snapshot().serverNowIso);
  assert.equal(h.calls.filter(call => call.name === 'executeCommand').length, 1, 'Recovery never replays START');
  assert.equal(h.calls.filter(call => call.name === 'getCommandStatus').length, 1, 'One bounded receipt read');
  assert.equal(h.calls.filter(call => call.name === 'getAssessmentState').length, 1);
  const newer = h.api.startAssessmentAttempt({ definitionId: h.definitionId }); await flush();
  const newerId = h.calls.filter(call => call.name === 'executeCommand').at(-1).input.commandId;
  first.resolve(); await flush();
  assert([...h.storage.values()].includes(newerId), 'A late old response cannot delete the next command receipt');
  second.resolve(); await newer;
}
{
  const h = harness();
  await h.api.startAssessmentAttempt({ definitionId: h.definitionId });
  assert.equal(h.timers.size, 0, 'Fast success cancels every recovery/deadline timer');
  await h.advance(40000);
  assert.equal(h.calls.filter(call => call.name === 'getCommandStatus').length, 0, 'Fast START adds no receipt reads');
}
{
  const h = harness(), held = deferred(), stateRead = deferred();
  h.state.commit = false; h.state.command = () => held.promise;
  const pending = h.api.startAssessmentAttempt({ definitionId: h.definitionId });
  await flush(); await h.advance(8000); await h.advance(8000);
  const commandId = h.calls.find(call => call.name === 'executeCommand').input.commandId;
  h.receipts.set(commandId, { commandId, commandType: 'startAssessmentAttempt', status: 'SUCCEEDED', result: { ...h.attempt } });
  h.state.read = () => stateRead.promise;
  await h.advance(8000); await h.advance(6000);
  stateRead.resolve(h.snapshot());
  assert.equal((await pending).attemptId, h.attempt.attemptId, 'A late commit recovers at 30 seconds without navigation');
  const statusReads = h.calls.filter(call => call.name === 'getCommandStatus');
  assert.equal(statusReads.length, 3, 'Recovery is bounded to 8/16/24 seconds');
  assert(statusReads.every(call => call.input.commandId === commandId), 'All recovery reads use the same exact command receipt');
  assert.equal(h.calls.filter(call => call.name === 'executeCommand').length, 1);
  assert.equal(h.timers.size, 0, 'Recovery success cancels all remaining timers');
  held.resolve(); await flush();
}
{
  const h = harness(), held = deferred(); h.state.commit = false; h.state.command = () => held.promise;
  const pending = assert.rejects(h.api.startAssessmentAttempt({ definitionId: h.definitionId }), { code: 'functions/deadline-exceeded' });
  await flush(); await h.advance(8000); await h.advance(8000); await h.advance(8000); await h.advance(16000); await pending;
  assert.equal(h.calls.filter(call => call.name === 'getCommandStatus').length, 3);
  assert.equal(h.timers.size, 0, 'Final timeout cancels scheduled recovery');
  const oldId = h.calls.find(call => call.name === 'executeCommand').input.commandId;
  assert.equal(h.calls.filter(call => call.name === 'executeCommand').length, 1, 'No automatic mutation retry on timeout');
  h.state.command = null; h.state.commit = true;
  await h.api.startAssessmentAttempt({ definitionId: h.definitionId });
  assert.equal(h.calls.filter(call => call.name === 'executeCommand').at(-1).input.commandId, oldId, 'Explicit retry preserves the pending receipt');
  held.resolve(); await flush();
}
{
  const h = harness(), held = deferred(); h.state.command = () => held.promise;
  const pending = assert.rejects(h.api.startAssessmentAttempt({ definitionId: h.definitionId }));
  await flush(); h.auth.currentUser = { uid: 'another-student' }; await h.advance(8000);
  assert.equal(h.calls.filter(call => call.name === 'getCommandStatus').length, 0, 'An old owner cannot recover into the new session');
  held.resolve(); await pending;
}
{
  const h = harness(), held = deferred(); h.state.read = () => held.promise;
  const reads = Array.from({ length: 3 }, () => assert.rejects(h.api.getAssessmentState({ definitionId: h.definitionId }), { code: 'functions/deadline-exceeded' }));
  await flush(); assert.equal(h.calls.length, 1, 'Concurrent initializers share one read');
  await h.advance(15000); await Promise.all(reads);
  h.state.read = async () => h.snapshot();
  await h.api.getAssessmentState({ definitionId: h.definitionId });
  assert.equal(h.calls.length, 2, 'A hung read does not poison retries');
  held.resolve(h.snapshot()); await flush();
  await h.api.getAssessmentState({ definitionId: h.definitionId }); assert.equal(h.calls.length, 3, 'Completed values do not become an authorization cache');
}
{
  const h = harness(), held = deferred(); h.state.settings = () => held.promise;
  const pending = assert.rejects(h.settings.readFreshSiteSettingDoc('config'), { code: 'functions/deadline-exceeded' });
  await h.advance(12000); await pending;
  h.state.settings = async () => ({ exists: () => true, data: () => ({ public: false, version: 2 }) });
  assert.equal((await h.settings.readFreshSiteSettingDoc('config')).public, false);
  held.resolve({ exists: () => true, data: () => ({ public: true, version: 1 }) }); await flush();
  assert.equal((await h.settings.readSiteSettingDoc('config')).version, 2, 'Late stale settings cannot reopen a private menu');
  assert.equal(h.calls.filter(call => call.name === 'getDoc').length, 0, 'Fresh settings never fall back to offline reads');
}
console.log('Assessment entry: stalled committed START recovers without navigation/write replay; deadline retries, late-response receipt isolation, owner fences, bounded reads and fail-closed settings passed (network 0).');
