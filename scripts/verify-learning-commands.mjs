import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('src/lib/learningCommands.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const create = () => {
  let epoch=10, handler;
  const owner={uid:'synthetic-a',getIdTokenResult:async()=>({claims:{auth_time:epoch}})};
  const auth={currentUser:owner}, calls=[], storage=new Map(), exports={};
  const result=(body,replayed=false)=>({data:{status:'SUCCEEDED',commandId:body.commandId,commandType:body.commandType,replayed,result:{awarded:true,duplicate:false,amount:10,totalAwarded:10,answerRevision:2,answers:{}}}});
  handler=async(_name,body)=>result(body);
  vm.runInNewContext(source,{exports,crypto:webcrypto,TextEncoder,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},require:name=>{
    if(name==='./firebase')return {auth};
    if(name==='./semesterScope')return {getYearSemester:c=>c};
    if(name==='./historyDictionarySession')return {getHistoryDictionaryCallable:async name=>async body=>{calls.push({name,body:structuredClone(body)});return handler(name,body);}};
    throw Error(name);
  }});
  return {api:exports,auth,owner,calls,storage,result,setHandler:fn=>handler=fn,setEpoch:v=>epoch=v};
};
const config={year:'2026',semester:'2'}, network=()=>Object.assign(new Error('lost response'),{code:'functions/unavailable'});
{
 const f=create();let release;
 f.setHandler((name,body)=>new Promise(resolve=>{release=()=>resolve(f.result(body));}));
 const a=f.api.claimMapTagReward(config,'map-1','고려'),b=f.api.claimMapTagReward(config,'map-1','고려');
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,1);release();await Promise.all([a,b]);
 const request=f.calls[0].body;
 assert.equal(request.commandType,'claimMapTagReward');
 assert.deepEqual(Object.keys(request.payload).sort(),['interactionId','mapId','semesterId','tag']);
 assert.equal(f.storage.size,0);
}
{
 const f=create();f.setHandler(async()=>{throw network();});
 await assert.rejects(f.api.claimMapTagReward(config,'map-1','고려'));
 const original=f.calls[0].body;assert.equal(f.storage.size,1);
 f.setHandler(async(name,body)=>f.result(body,true));
 const recovered=await f.api.claimMapTagReward(config,'map-1','고려');
 assert.deepEqual(f.calls.at(-1).body,original);
 assert.equal(recovered.awarded,false);assert.equal(recovered.duplicate,true);assert.equal(recovered.amount,0);
}
{
 const f=create();f.setHandler(async(name,body)=>{if(name==='getCommandStatus')return {data:{status:'SUCCEEDED',result:{answers:{a:{value:'고려',status:'correct'}},answerRevision:7}}};throw network();});
 const saved=await f.api.saveLessonAnswers(config,{unitId:'lesson-1',expectedSemesterRevision:1,expectedContentRevision:2,expectedAnswerRevision:6,answers:{a:'고려'}});
 assert.equal(saved.answerRevision,7);assert.equal(f.storage.size,0);assert.equal(f.calls[0].body.payload.expectedAnswerRevision,6);
 assert.equal(Object.hasOwn(f.calls[0].body.payload,'uid'),false);
 assert.equal(Object.hasOwn(f.calls[0].body.payload,'correctCount'),false);
}
{
 const f=create();let release;
 f.setHandler((name,body)=>new Promise(resolve=>{release=()=>resolve(f.result(body));}));
 const response=f.api.recordLessonCorePointFind(config,'lesson-1','point-1');
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.auth.currentUser={...f.owner};release();await assert.rejects(response,/로그인 상태/);
}
{
 const f=create();let release;
 f.setHandler((name,body)=>new Promise(resolve=>{release=()=>resolve(f.result(body));}));
 const response=f.api.claimLessonCorePointReward(config);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.setEpoch(11);release();await assert.rejects(response,/로그인 상태/);
}
{
 const f=create();f.setHandler(async()=>{throw Object.assign(new Error('revision conflict'),{code:'functions/aborted'});});
 await assert.rejects(f.api.saveLessonAnswers(config,{unitId:'lesson-1',expectedSemesterRevision:1,expectedContentRevision:2,expectedAnswerRevision:6,answers:{a:'보존할 입력'}}));
 assert.equal(f.calls.length,1);assert.equal(f.storage.size,0);
}
console.log('PASS learning command contracts: 6 groups (single payment, exact retry, receipt recovery, identity/epoch fences, conflict preservation)');
