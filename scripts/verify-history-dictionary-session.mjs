import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/historyDictionarySession.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const epoch=1700000000;
function fixture(){
 const user={uid:'teacher-test'}; const auth={currentUser:user};const calls=[];
 const state={epoch,hold:null,fail:null,revision:'a'.repeat(64)};
 const module={exports:{}};
 vm.runInNewContext(js,{exports:module.exports,module,require(name){
  if(name==='firebase/auth')return {getIdTokenResult:async()=>({authTime:new Date(state.epoch*1000).toISOString()})};
  if(name==='./firebase')return {auth,getHttpsCallable:async name=>async data=>{
   calls.push({name,data});if(name==='openApplicationSession'){
    if(state.hold)await state.hold;
    if(state.fail)throw state.fail;
    return {data:{status:'active',authTime:epoch,authorityGeneration:'w1r2-2026-08-09',protocolVersion:2,revision:state.revision}};
   }return {data:{ok:true}};
  }};
  throw Error(name);
 },Map,Promise,Date,Number,Error,Object,RegExp});
 return {api:module.exports,auth,user,calls,state};
}
{
 const f=fixture();let release;f.state.hold=new Promise(r=>release=r);
 const pending=[f.api.ensureHistoryDictionarySession(),f.api.ensureHistoryDictionarySession()];
 await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);release();await Promise.all(pending);
 const call=await f.api.getHistoryDictionaryCallable('executeCommand');await call({commandId:'test',_session:{revision:'untrusted'}});
 assert.equal(f.calls.at(-1).data._session.revision,'a'.repeat(64));
 assert.equal(f.calls.filter(c=>c.name==='executeCommand').length,1);
}
for(const change of ['identity','epoch','invalid','closed']){
 const f=fixture();let release;f.state.hold=new Promise(r=>release=r);
 const call=await f.api.getHistoryDictionaryCallable('executeCommand');const pending=call({commandId:'test'});
 await new Promise(r=>setImmediate(r));
 if(change==='identity')f.auth.currentUser={uid:'other'};
 if(change==='epoch')f.state.epoch++;
 if(change==='invalid')f.state.revision='bad';
 if(change==='closed')f.state.fail=Object.assign(new Error('closed'),{code:'functions/unauthenticated',details:{reason:'SESSION_REAUTH_REQUIRED'}});
 release();await assert.rejects(pending);assert.equal(f.calls.filter(c=>c.name==='executeCommand').length,0);
}
{
 const f=fixture();f.auth.currentUser=null;await assert.rejects(f.api.ensureHistoryDictionarySession());assert.equal(f.calls.length,0);
 f.auth.currentUser=f.user;f.state.fail=new Error('network');await assert.rejects(f.api.ensureHistoryDictionarySession());f.state.fail=null;await f.api.ensureHistoryDictionarySession();
 assert.equal(f.calls.length,2);
}
console.log('PASS: session handshake, single flight, proof injection, identity/auth epoch isolation, invalid/closed-session rejection, failed-flight recovery; no command replay.');
