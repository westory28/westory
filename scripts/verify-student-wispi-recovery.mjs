import assert from 'node:assert/strict';
import { build } from 'esbuild';

const realTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let serial = 0;
async function fixture(file, fakeSession = false) {
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  const qa = globalThis.__wispiRecovery = { timers: new Map(), observers: new Set(), auth: new Set(), created: 0,
    owner: { uid: 'synthetic-viewer', getIdTokenResult: async () => ({ claims: { auth_time: 100 } }) } };
  globalThis.setTimeout = (fn, ms) => { const id = ++serial; qa.timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => qa.timers.delete(id);
  const result = await build({ entryPoints: [file], bundle: true, format: 'esm', write: false,
    plugins: [{ name: 'recovery-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^(firebase\/(auth|firestore)|\.\/firebase)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      if (fakeSession) plugin.onResolve({ filter: /\.\/studentWisStockSession$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        const qa=globalThis.__wispiRecovery;
        export const auth={get currentUser(){return qa.owner}},db={};
        export const doc=(_db,path)=>({path});
        export const onSnapshot=(ref,options,next,error)=>{const observer={ref,next,error};qa.created++;qa.observers.add(observer);return ()=>qa.observers.delete(observer)};
        export const onIdTokenChanged=(_auth,fn)=>{qa.auth.add(fn);queueMicrotask(()=>fn(qa.owner));return ()=>qa.auth.delete(fn)};
        export const watchStudentWisStockSession=(_owner,_epoch,next)=>{queueMicrotask(()=>next.allowed());return ()=>{}};
        export const retryStudentWisStockSession=()=>{};
      ` }));
    } }],
  });
  const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + `\n//# sourceURL=wispi-recovery-${++serial}.mjs`).toString('base64'));
  const tick = ms => {
    const chosen = [...qa.timers].find(([, timer]) => timer.ms === ms);
    assert(chosen, `Missing ${ms}ms timer`); qa.timers.delete(chosen[0]); chosen[1].fn();
  };
  const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
  return { qa, api, tick, flush };
}
const snapshot = (data, fromCache = false) => ({ exists: () => true, data: () => data, metadata: { fromCache, hasPendingWrites: false } });
const session = () => ({ uid: 'synthetic-viewer', authTime: 100, status: 'active', schemaVersion: 2,
  authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: 'a'.repeat(64),
  authorityModeAtOpen: 'ENFORCE', generalExpiresAt: { toMillis: () => Date.now() + 60_000 } });
try {
  {
    const { qa, api, tick } = await fixture('src/lib/studentWisStockSession.ts');
    const events = [], stop = api.watchStudentWisStockSession(qa.owner, 100, {
      allowed: () => events.push('allowed'), denied: e => events.push(e.code), paused: e => events.push(e ? 'recoverable' : 'paused'),
    });
    tick(15_000); assert.equal(events.at(-1), 'recoverable'); assert.equal(qa.observers.size, 1);
    [...qa.observers][0].next(snapshot(session())); assert.equal(events.at(-1), 'allowed');
    [...qa.observers][0].next(snapshot({ ...session(), status: 'revoked' }));
    assert.equal(events.at(-1), 'unauthenticated'); assert.equal(qa.observers.size, 0); stop();
  }
  {
    const { qa, api, tick } = await fixture('src/lib/studentWisStockSession.ts');
    const events = [], stop = api.watchStudentWisStockSession(qa.owner, 100, {
      allowed: () => events.push('allowed'), denied: () => events.push('denied'), paused: e => events.push(e ? 'recoverable' : 'paused'),
    });
    for (const ms of [750, 1500]) { [...qa.observers][0].error({ code: 'unavailable' }); tick(ms); }
    [...qa.observers][0].error({ code: 'unavailable' });
    assert.equal(qa.created, 3); assert.equal(events.at(-1), 'recoverable'); assert.equal(qa.timers.size, 0);
    api.retryStudentWisStockSession(qa.owner, 100); assert.equal(qa.created, 4);
    [...qa.observers][0].next(snapshot(session())); assert.equal(events.at(-1), 'allowed'); stop();
  }
  {
    const { qa, api, tick, flush } = await fixture('src/lib/studentWisStockPublic.ts', true);
    const events = [], scope = { year: '2026', semester: '2' };
    const stop = api.watchStudentWisStockStatus(scope, s => events.push(s)); await flush();
    tick(15_000); assert.equal(events.at(-1).status, 'error'); assert.equal(qa.observers.size, 1);
    const value = { schemaVersion: 1, semesterId: '2026-2', studentOpen: true, halted: false, tradingEpoch: 1, revision: 1, updatedAtMs: 1 };
    [...qa.observers][0].next(snapshot(value)); assert.equal(events.at(-1).status, 'ready');
    for (const ms of [750, 1500]) { [...qa.observers][0].error({ code: 'unavailable' }); tick(ms); }
    [...qa.observers][0].error({ code: 'unavailable' });
    assert.equal(events.at(-1).status, 'error'); assert.equal(qa.timers.size, 0);
    const second = api.watchStudentWisStockStatus(scope, s => events.push(s)); await flush();
    assert.equal(qa.observers.size, 1); [...qa.observers][0].next(snapshot(value)); assert.equal(events.at(-1).status, 'ready');
    [...qa.observers][0].error({ code: 'permission-denied' }); assert.equal(events.at(-1).status, 'error');
    assert.match(events.at(-1).error, /로그인/); assert.equal(qa.observers.size, 0); stop(); second();
  }
  console.log('PASS delayed session/public recovery, bounded two retries, manual reconnect, late server success and terminal permission/revocation');
} finally { globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClearTimeout; }
