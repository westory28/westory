import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';

const bundled = await build({ entryPoints: ['src/lib/studentWisStockClient.ts'], bundle: true, format: 'esm', write: false,
  plugins: [{ name: 'student-fixture', setup(p) {
    p.onResolve({ filter: /^(firebase\/(auth|firestore)|\.\/(firebase|historyDictionarySession|sensitiveOperation|appEvents|studentWisStockSession))$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      const qa=globalThis.__studentWispiQA;
      export const auth={get currentUser(){return qa.owner}}, db={};
      export const onIdTokenChanged=(_a,fn)=>{qa.authObservers.add(fn);queueMicrotask(()=>fn(qa.owner));return ()=>qa.authObservers.delete(fn)};
      export const doc=(_db,path)=>({path});
      export const onSnapshot=(ref,_options,next,error)=>{const item={path:ref.path,next,error};qa.observers.add(item);return ()=>qa.observers.delete(item)};
      export const getHistoryDictionaryCallable=async(name,options)=>async data=>{options?.beforeDispatch?.();qa.calls.push({name,data:structuredClone(data)});return {data:await qa.handler(name,data)}};
      export const ensureSensitiveOperation=async()=>{await qa.reauth()};
      export const notifyPointsUpdated=()=>{qa.pointsEvents++};
      export const subscribePointsUpdated=fn=>{qa.pointsObservers.add(fn);return ()=>qa.pointsObservers.delete(fn)};
      export const watchStudentWisStockSession=(_owner,_epoch,callbacks)=>{qa.sessions.add(callbacks);queueMicrotask(()=>callbacks.allowed());return ()=>qa.sessions.delete(callbacks)};
    ` }));
  } }],
});
const scope={year:'2026',semester:'2'}, owner=uid=>({uid,epoch:100,async getIdTokenResult(){return {claims:{auth_time:this.epoch}}}});
const state=(revision=1)=>({semesterId:'2026-2',serverNowMs:Date.now(),accountPath:'years/2026/semesters/2/wis_stock_accounts/wisacct_'+'a'.repeat(64),stocks:[],
  account:{revision,stockCash:500,reservedCash:0,positions:[],pendingOrders:[]}});
let serial=0;
async function setup(){
  const storage=new Map(); globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});globalThis.window=new EventTarget();
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  if(!globalThis.crypto)globalThis.crypto=webcrypto;
  const qa=globalThis.__studentWispiQA={owner:owner('student-a'),calls:[],pointsEvents:0,pointsObservers:new Set(),observers:new Set(),authObservers:new Set(),sessions:new Set(),reauth:async()=>{},handler:async()=>({changed:true,duplicate:false,state:state()})};
  const api=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+`\n// fixture ${serial++}`).toString('base64'));
  return {qa,api,storage};
}
const until=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture timeout');};
const checks=[];const check=async(name,run)=>{await run();checks.push(name)};
await check('response loss and aborted preserve original transfer receipt; successful retry clears it',async()=>{
  for(const code of ['functions/unavailable','functions/aborted']){
    const {qa,api,storage}=await setup();let failure=true;
    qa.handler=async()=>{if(failure){failure=false;throw Object.assign(Error('synthetic transient'),{code});}return {changed:false,duplicate:true,state:state(2)}};
    await assert.rejects(api.transferStudentWisStock(scope,'DEPOSIT',500));assert.equal(storage.size,1);
    await api.transferStudentWisStock(scope,'DEPOSIT',500);assert.equal(qa.calls[0].data.requestId,qa.calls[1].data.requestId);assert.equal(storage.size,0);assert.equal(qa.pointsEvents,0);
  }
});
await check('uncertain order keeps quoted price, time, quantity and receipt across explicit retry',async()=>{
  const {qa,api}=await setup();let failure=true;
  qa.handler=async()=>{if(failure){failure=false;throw Error('lost response')}return {changed:false,duplicate:true,state:state(2)}};
  const first={stockId:'stock-a',side:'BUY',quantity:2,quote:{price:100,atMs:10000,marketRevision:1}};
  await assert.rejects(api.placeStudentWisStockOrder(scope,first));
  await api.placeStudentWisStockOrder(scope,{...first,quote:{price:200,atMs:20000,marketRevision:2}});
  assert.deepEqual(qa.calls[1].data,qa.calls[0].data);
});
await check('deterministic validation failures discard the old quote for a new attempt',async()=>{
  const {qa,api,storage}=await setup();let failure=true;
  qa.handler=async()=>{if(failure){failure=false;throw Object.assign(Error('expired'),{details:{reason:'WIS_STOCK_QUOTE_EXPIRED'}})}return {changed:true,state:state(2)}};
  const first={stockId:'stock-a',side:'BUY',quantity:2,quote:{price:100,atMs:10000,marketRevision:1}};
  await assert.rejects(api.placeStudentWisStockOrder(scope,first));assert.equal(storage.size,0);
  await api.placeStudentWisStockOrder(scope,{...first,quote:{price:200,atMs:20000,marketRevision:2}});
  assert.notEqual(qa.calls[0].data.requestId,qa.calls[1].data.requestId);assert.equal(qa.calls[1].data.quote.price,200);
});
await check('concurrent same command is coalesced; successful transfers notify ordinary Wis once',async()=>{
  const {qa,api}=await setup();let finish;qa.handler=()=>new Promise(r=>{finish=r});
  const a=api.transferStudentWisStock(scope,'DEPOSIT',500),b=api.transferStudentWisStock(scope,'DEPOSIT',500);
  await until(()=>finish);assert.equal(qa.calls.length,1);finish({changed:true,state:state(2)});await Promise.all([a,b]);assert.equal(qa.pointsEvents,1);
});
await check('account and auth-time changes reject late responses and stop commands during reauthentication',async()=>{
  for(const change of [q=>{q.owner=owner('student-b')},q=>{q.owner.epoch++}]){
    const {qa,api}=await setup();let finish;qa.handler=()=>new Promise(r=>{finish=r});
    const pending=api.transferStudentWisStock(scope,'DEPOSIT',500);await until(()=>finish);change(qa);finish({changed:true,state:state(2)});await assert.rejects(pending,/로그인 상태/);
    qa.reauth=async()=>change(qa);const before=qa.calls.length;await assert.rejects(api.transferStudentWisStock(scope,'DEPOSIT',500));assert.equal(qa.calls.length,before);
  }
});
await check('state subscribers share one request/listener and reject local snapshots; last detach stops reads',async()=>{
  const {qa,api}=await setup();qa.handler=async()=>state();const a=[],b=[];
  const stopA=api.watchStudentWisStockState(scope,s=>a.push(s)),stopB=api.watchStudentWisStockState(scope,s=>b.push(s));
  await until(()=>a.at(-1)?.status==='ready'&&b.at(-1)?.status==='ready');assert.equal(qa.calls.length,1);assert.equal(qa.observers.size,1);
  const observer=[...qa.observers][0];observer.next({metadata:{fromCache:true,hasPendingWrites:false},exists:()=>true,data:()=>({revision:2})});
  await new Promise(r=>setTimeout(r,10));assert.equal(qa.calls.length,1);
  qa.handler=async()=>state(2);observer.next({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({revision:2})});
  await until(()=>a.at(-1)?.data?.account.revision===2);assert.equal(qa.calls.length,2);
  stopA();assert.equal(qa.observers.size,1);stopB();assert.equal(qa.observers.size,0);assert.equal(qa.sessions.size,0);
});
await check('session revocation discards an in-flight read and private data',async()=>{
  const {qa,api}=await setup();let finish;qa.handler=()=>new Promise(r=>{finish=r});const events=[];
  const stop=api.watchStudentWisStockState(scope,s=>events.push(s));await until(()=>finish);
  [...qa.sessions][0].denied(Error('session revoked'));finish(state());await new Promise(r=>setTimeout(r,10));
  assert.equal(events.at(-1).status,'error');assert.equal(events.at(-1).data,null);assert.equal(qa.observers.size,0);stop();
});
await check('history is bounded, scoped and cursor-based; malformed responses rejected',async()=>{
  const {qa,api}=await setup();qa.handler=async()=>({semesterId:'2026-2',entries:[],nextCursor:'next',hasMore:true});
  await api.getStudentWisStockHistory(scope,'cursor');assert.deepEqual(qa.calls[0].data,{...scope,cursor:'cursor',limit:20});
  qa.handler=async()=>({entries:[]});await assert.rejects(api.getStudentWisStockHistory(scope));
});
console.log(JSON.stringify({passed:true,checks,network:0,productionWrites:0},null,2));
