import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import './verify-sensitive-operation.mjs';
const compile=name=>ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const load=(source,mocks)=>{const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!mocks[name])throw Error(name);return mocks[name];},Date});return exports;};
const create=()=>{
 const user={uid:'admin',email:'westoria28@gmail.com'},auth={currentUser:user};
 let state={enabled:true,blockedRoles:['student'],bypassUids:['synthetic-bypass'],title:'학생 접속 안내',message:'제한 중',revision:8,updatedBy:'admin'},handler;
 const calls=[];handler=async payload=>{state={...state,...payload,revision:state.revision+1,updatedBy:user.uid};};
 const api=load(compile('studentAccessControl'),{'firebase/firestore':{doc:()=>({}),getDocFromServer:async()=>({data:()=>structuredClone(state)})},'./firebase':{auth,db:{}},'./permissions':{ADMIN_EMAIL:'westoria28@gmail.com'},'./sensitiveOperation':{ensureSensitiveOperation:async()=>{}},'./historyDictionarySession':{getHistoryDictionaryCallable:async()=>async payload=>{calls.push(structuredClone(payload));return handler(payload);}}});
 return {api,auth,calls,getState:()=>state,setState:s=>state=s,setHandler:fn=>handler=fn};
};
{
 const f=create();const saved=await f.api.setStudentAccessAllowed(true,8,"2026-2");
 assert.equal(saved.enabled,false);assert.equal(saved.revision,9);
 assert.deepEqual(f.calls,[{expectedRevision:8,expectedSemesterId:'2026-2',enabled:false,blockedRoles:['student'],bypassUids:['synthetic-bypass'],title:'학생 접속 안내',message:'제한 중'}]);
 await f.api.setStudentAccessAllowed(true,9,"2026-2");assert.equal(f.calls.length,1);
}
{
 const f=create();await assert.rejects(f.api.setStudentAccessAllowed(true,7,"2026-2"),/설정이 바뀌/);assert.equal(f.calls.length,0);
 f.auth.currentUser={uid:'student',email:'student@yongshin-ms.ms.kr'};await assert.rejects(f.api.readStudentAccessConfig(),/관리자/);
}
{
 const f=create();f.setHandler(async payload=>{f.setState({...f.getState(),...payload,revision:9});throw Error('lost response');});
 const saved=await f.api.setStudentAccessAllowed(true,8,"2026-2");assert.equal(saved.enabled,false);assert.equal(f.calls.length,1);
}
{
 const f=create();f.setHandler(async()=>{throw Error('not committed');});
 await assert.rejects(f.api.setStudentAccessAllowed(true,8,"2026-2"),/not committed/);assert.equal(f.calls.length,1);assert.equal(f.getState().enabled,true);
}
console.log('PASS student access control: 5 groups (step-up transition, preserved config, stale/admin rejection, ambiguous result verification, no blind retry)');
