const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path').resolve(__dirname, '../src/pages/teacher/components/SettingsGeneral.tsx');
const source = fs.readFileSync(path, 'utf8');
const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name) {
  let result;
  function walk(n) { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === name) result = n.initializer; else ts.forEachChild(n, walk); }
  walk(tree); assert(result, name); return result.getText(tree);
}
function evaluate(name, context) {
  const compiled = ts.transpileModule('const result = ' + initializer(name) + '; result;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(compiled, context);
}
class StepUpReauthError extends Error {}
function harness() {
  const writes = [], calls = [], context = {
    readinessContext: { current: { ownerUid: 'admin-a', selection: '2026-2', mounted: true } },
    readinessReauthFlight: { current: false }, auth: { currentUser: { uid: 'admin-a' } }, StepUpReauthError,
    setReadinessReauthBusy: value => writes.push(['busy', value]),
    setReadinessNeedsReauth: value => writes.push(['reauth', value]),
    setReadinessError: value => writes.push(['error', value]),
    setCoreSnapshot: value => writes.push(['snapshot', value]),
    requestStepUpReauthentication: async (name, options) => { calls.push(['stepUp', name, options]); },
    loadSemesterCoreSnapshot: async () => { calls.push(['read']); return { manifests: ['fresh'] }; },
  };
  return { context, writes, calls, run: evaluate('handleReadinessReauthentication', context) };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS ' + name); }
(async () => {
  await test('only exact server recent-auth reason triggers the recovery mode', () => {
    const classify = evaluate('isReadinessReauthRequired', {});
    assert(classify({ details: { reason: 'RECENT_AUTH_REQUIRED' } }));
    for (const e of [null, {}, { code: 'permission-denied' }, { message: 'Recent authentication is required for this command.' }, { details: { reason: 'OTHER' } }]) assert.equal(classify(e), false);
  });
  await test('forced shared step-up precedes snapshot read and leaves settings form untouched', async () => {
    const h = harness(); await h.run();
    assert.equal(h.calls[0][0], 'stepUp'); assert.equal(h.calls[0][1], 'getSemesterCoreState'); assert.equal(h.calls[0][2].force, true);
    assert.equal(h.calls[1][0], 'read'); assert.equal(h.writes.filter(w => w[0] === 'snapshot').length, 1);
    assert(!initializer('handleReadinessReauthentication').includes('loadConfig'));
    assert(!initializer('handleReadinessReauthentication').includes('setConfig'));
  });
  await test('cancelled step-up keeps actionable error and performs no read', async () => {
    const h = harness(); h.context.requestStepUpReauthentication = async () => { throw new StepUpReauthError('본인 확인을 취소했습니다.'); };
    await h.run(); assert.equal(h.calls.length, 0); assert(h.writes.some(w => w[0] === 'reauth' && w[1] === true));
    assert(h.writes.some(w => w[0] === 'error' && w[1].includes('취소'))); assert.equal(h.context.readinessReauthFlight.current, false);
  });
  await test('snapshot network failure keeps retry available', async () => {
    const h = harness(); h.context.loadSemesterCoreSnapshot = async () => { throw Error('network'); }; await h.run();
    assert(h.writes.some(w => w[0] === 'reauth' && w[1])); assert(!h.writes.some(w => w[0] === 'snapshot'));
  });
  for (const edge of ['auth-owner', 'context-owner', 'semester', 'unmount']) await test('discard after step-up: ' + edge, async () => {
    const h = harness(); h.context.requestStepUpReauthentication = async () => {
      if (edge === 'auth-owner') h.context.auth.currentUser.uid = 'admin-b';
      if (edge === 'context-owner') h.context.readinessContext.current.ownerUid = 'admin-b';
      if (edge === 'semester') h.context.readinessContext.current.selection = '2026-1';
      if (edge === 'unmount') h.context.readinessContext.current.mounted = false;
    }; await h.run(); assert(!h.calls.some(c => c[0] === 'read')); assert(!h.writes.some(w => w[0] === 'snapshot'));
  });
  await test('discard snapshot response after selection changes', async () => {
    const h = harness(); h.context.loadSemesterCoreSnapshot = async () => { h.context.readinessContext.current.selection = '2026-1'; return {}; };
    await h.run(); assert(!h.writes.some(w => w[0] === 'snapshot'));
  });
  await test('double click shares one active recovery; stale owner cannot start', async () => {
    const h = harness(); let release; h.context.requestStepUpReauthentication = () => new Promise(resolve => { release = resolve; });
    const first = h.run(); await h.run(); release(); await first;
    assert.equal(h.calls.filter(c => c[0] === 'read').length, 1);
    const other = harness(); other.context.auth.currentUser.uid = 'admin-b'; await other.run(); assert.equal(other.calls.length, 0);
  });
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  console.log(`PASS Settings readiness recovery ${count} scenarios + TSX transpile`);
})().catch(error => { console.error(error); process.exitCode = 1; });
