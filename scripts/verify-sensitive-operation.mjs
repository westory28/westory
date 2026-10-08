import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const load = (file, mocks, extras = {}) => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, Date, ...extras });
  return exports;
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const now = 1800000000000;
const oldEpoch = now / 1000 - 600;
const freshEpoch = now / 1000;
const make = (options = {}) => {
  const events = [], dialogReady = deferred();
  let epoch = options.recent ? freshEpoch : oldEpoch, time = now, gesture = false, dialog, resolveDialog, cleanup;
  const user = { uid: 'qa-admin', email: 'qa@example.test', getIdTokenResult: async () => ({claims:{auth_time:epoch}}), getIdToken: async () => events.push('refresh') };
  const auth = { currentUser: user };
  const bridge = load('src/lib/sensitiveOperationPrompt.ts', {});
  const controller = load('src/components/common/SensitiveOperationController.tsx', {
    react: {useEffect: fn => {cleanup = fn();}},
    './AppDialogProvider': {useAppDialog: () => ({confirm: opts => {dialog = opts; events.push('dialog'); dialogReady.resolve(); return new Promise(resolve => {resolveDialog = resolve;});}})},
    '../../lib/sensitiveOperationPrompt': bridge,
  });
  controller.SensitiveOperationController();
  const api = load('src/lib/sensitiveOperation.ts', {
    'firebase/auth': {GoogleAuthProvider: class {setCustomParameters(){}}, reauthenticateWithPopup: () => {
      assert.equal(gesture, true, 'popup must start synchronously inside the explicit click');
      events.push('popup');
      if (options.popup) return options.popup({user, auth, setEpoch: value => {epoch = value;}});
      epoch = freshEpoch; return Promise.resolve({user});
    }},
    './firebase': {auth},
    './appCheck': {ensureWestoryAppCheck: async () => {events.push('app-check'); await options.appCheck?.({auth, setEpoch: value => {epoch = value;}});}},
    './historyDictionarySession': {
      getHistoryDictionaryCallable: async () => async () => {events.push('begin'); if (options.beginFailure) throw Error('session expired'); return {data:{expiresAt:time + 90000}};},
      ensureHistoryDictionarySession: async () => {events.push('session'); await options.session?.({auth, setEpoch: value => {epoch = value;}});},
    },
    './sensitiveOperationPrompt': bridge,
  }, {Date: class extends Date {static now(){return time;}}});
  return {api, auth, user, events, bridge, ready: dialogReady.promise, setTime: value => {time = value;}, cleanup: () => cleanup(),
    click: () => {gesture = true; dialog.onConfirm(); gesture = false; resolveDialog(true);}, cancel: () => resolveDialog(false)};
};

let cases = 0;
{
  const f = make(); const work = f.api.ensureSensitiveOperation(); await f.ready;
  assert.deepEqual(f.events, ['app-check','begin','dialog']); f.click(); await work;
  assert.deepEqual(f.events, ['app-check','begin','dialog','popup','refresh','session']); f.cleanup(); cases++;
}
{
  const f = make({recent:true}); await f.api.ensureSensitiveOperation(); assert.deepEqual(f.events,['app-check']); f.cleanup(); cases++;
}
{
  const f = make(); const work = f.api.ensureSensitiveOperation(); await f.ready; f.cancel(); await assert.rejects(work,/취소/);
  assert.equal(f.events.includes('popup'),false); assert.equal(f.events.includes('session'),false); f.cleanup(); cases++;
}
{
  const f = make(); const work = f.api.ensureSensitiveOperation(); await f.ready; f.cleanup(); await assert.rejects(work,/취소/); f.click();
  assert.equal(f.events.includes('popup'),false); cases++;
}
{
  const f = make(); const work = f.api.ensureSensitiveOperation(); await f.ready; f.auth.currentUser = {...f.user}; f.click();
  await assert.rejects(work,/계정이 바뀌/); assert.equal(f.events.includes('popup'),false); f.cleanup(); cases++;
}
{
  const f = make(); const work = f.api.ensureSensitiveOperation(); await f.ready; f.setTime(now + 90000); f.click();
  await assert.rejects(work,/준비 시간이/); assert.equal(f.events.includes('popup'),false); f.cleanup(); cases++;
}
{
  const f = make({appCheck: async () => {throw Error('app-check failed');}});
  await assert.rejects(f.api.ensureSensitiveOperation(),/app-check failed/); assert.deepEqual(f.events,['app-check']); f.cleanup(); cases++;
}
{
  const f = make({beginFailure:true}); await assert.rejects(f.api.ensureSensitiveOperation(),/session expired/);
  assert.deepEqual(f.events,['app-check','begin']); f.cleanup(); cases++;
}
{
  const f = make({appCheck: async ({setEpoch}) => setEpoch(freshEpoch)}); await assert.rejects(f.api.ensureSensitiveOperation(),/로그인 상태가 바뀌/);
  assert.equal(f.events.includes('begin'),false); f.cleanup(); cases++;
}
for (const error of ['auth/popup-blocked','auth/popup-closed-by-user']) {
  const f = make({popup: async () => {throw Error(error);}}); const work = f.api.ensureSensitiveOperation(); await f.ready; f.click();
  await assert.rejects(work,new RegExp(error)); assert.equal(f.events.includes('refresh'),false); f.cleanup(); cases++;
}
{
  const f = make({popup: async ({user,auth,setEpoch}) => {setEpoch(freshEpoch); auth.currentUser={...user}; return {user};}});
  const work=f.api.ensureSensitiveOperation(); await f.ready; f.click(); await assert.rejects(work,/계정이 바뀌/); assert.equal(f.events.includes('session'),false); f.cleanup(); cases++;
}
{
  const f = make({popup: async ({setEpoch}) => {setEpoch(freshEpoch); return {user:{uid:'foreign'}};}});
  const work=f.api.ensureSensitiveOperation(); await f.ready; f.click(); await assert.rejects(work,/같은 계정/); f.cleanup(); cases++;
}
{
  const f = make({popup: async ({user}) => ({user})}); const work=f.api.ensureSensitiveOperation(); await f.ready; f.click();
  await assert.rejects(work,/재인증을 확인/); assert.equal(f.events.includes('session'),false); f.cleanup(); cases++;
}
{
  const f = make({session: async ({setEpoch}) => setEpoch(freshEpoch + 1)}); const work=f.api.ensureSensitiveOperation(); await f.ready; f.click();
  await assert.rejects(work,/로그인 상태가 바뀌/); f.cleanup(); cases++;
}
{
  const pendingPopup = deferred(); const f = make({popup: () => pendingPopup.promise}); const work=f.api.ensureSensitiveOperation();
  await f.ready; f.click(); f.cleanup(); await assert.rejects(work,/취소/); pendingPopup.resolve({user:f.user}); await Promise.resolve();
  assert.equal(f.events.includes('refresh'),false); cases++;
}
{
  const f=make(); const a=f.api.ensureSensitiveOperation(), b=f.api.ensureSensitiveOperation(); assert.equal(a,b); await f.ready;
  f.click(); await Promise.all([a,b]); assert.equal(f.events.filter(x=>x==='popup').length,1); f.cleanup(); cases++;
}
{
  const f=make(); f.cleanup(); await assert.rejects(f.bridge.requestSensitiveReauthentication(async()=>{}),/새로고침/); cases++;
}
console.log(`PASS sensitive operation: ${cases} cases; explicit synchronous click, cancellation/unmount, App Check/session/owner/auth epoch fences; network 0`);
