const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=require('node:path').resolve(__dirname,'..')+'/',file='src/lib/studentSemesterArchive.ts',source=fs.readFileSync(root+file,'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const row=(id,status='ARCHIVED',extra={})=>({id,exists:()=>true,data:()=>({semesterId:id,status,provenance:'ARCHIVE',...extra})});
function harness(rows=[]){const calls=[],auth={currentUser:{uid:'student-a'}};let hook=()=>{};const exports={};vm.runInNewContext(code,{exports,require:name=>{
  if(name==='./firebase')return{auth,db:{}};
  if(name==='firebase/firestore')return{collection:(_,path)=>{assert.equal(path,'semester_manifests');return path;},doc:(_,path,id)=>{assert.equal(path,'semester_manifests');return id;},where:(...args)=>args,limit:n=>n,query:(...args)=>args,
    getDocs:async q=>{calls.push(['list',q]);hook();return{docs:rows};},getDoc:async id=>{calls.push(['get',id]);hook();return rows.find(r=>r.id===id)||{exists:()=>false};}};
  throw Error('forbidden import '+name);
}});return{run:extra=>exports.loadStudentSemesterArchive({studentUid:'student-a',currentSemesterId:'2026-2',...extra}),calls,auth,setHook:fn=>hook=fn};}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 await test('no previous notice is a normal empty result and uses only bounded metadata list',async()=>{const h=harness();assert.equal((await h.run()).length,0);assert.equal(h.calls[0][0],'list');assert.equal(h.calls[0][1][0],'semester_manifests');assert.equal(h.calls[0][1][2],101);assert.equal(JSON.stringify(h.calls[0][1][1]),JSON.stringify(['status','in',['CLOSED','ARCHIVED']]));});
 await test('historical list preserves scope/provenance and excludes current and preparing',async()=>{const h=harness([row('2025-2','CLOSED',{provenance:'LEGACY'}),row('2026-1'),row('2026-2'),row('2027-1','PREPARING')]);const result=await h.run();assert.equal(JSON.stringify(result.map(r=>r.semesterId)),JSON.stringify(['2026-1','2025-2']));assert.equal(result[1].provenance,'LEGACY');});
 await test('explicit semester fetch stays exact and absent target does not fallback',async()=>{const h=harness([row('2026-1')]);assert.equal((await h.run({semesterId:'2025-1'})).length,0);assert.deepEqual(h.calls,[['get','2025-1']]);assert.equal((await h.run({semesterId:'2026-1'}))[0].semesterId,'2026-1');});
 await test('current target and invalid scope cannot probe historical or teacher paths',async()=>{const h=harness();assert.equal((await h.run({semesterId:'2026-2'})).length,0);await assert.rejects(h.run({semesterId:'../users'}));await assert.rejects(h.run({currentSemesterId:''}));assert.equal(h.calls.length,0);});
 await test('mismatched stored semester and non-archived explicit document are omitted',async()=>{assert.equal((await harness([row('2026-1','ARCHIVED',{semesterId:'2025-1'})]).run()).length,0);assert.equal((await harness([row('2026-1','ACTIVE')]).run({semesterId:'2026-1'})).length,0);});
 await test('owner change before and during read rejects',async()=>{const h=harness();h.auth.currentUser.uid='other';await assert.rejects(h.run());assert.equal(h.calls.length,0);const later=harness();later.setHook(()=>later.auth.currentUser.uid='other');await assert.rejects(later.run());});
 await test('query error and oversized list remain errors rather than false empty success',async()=>{const h=harness();h.setHook(()=>{throw Error('network');});await assert.rejects(h.run());await assert.rejects(harness(Array.from({length:101},()=>row('2026-1'))).run());});
 await test('student page has no privileged query or guessed semester fallback',()=>{const page=fs.readFileSync(root+'src/pages/student/StudentArchiveOverview.tsx','utf8');assert(!page.includes('getServerSemesterCoreState'));assert(!page.includes('"2026-1"'));assert(!page.includes('"2026-2"'));assert(page.includes('지난 학기 안내'));assert(page.includes('개인 학습 기록의 조회 여부와는 별개'));});
 for(const target of [file,'src/pages/student/StudentArchiveOverview.tsx']){const result=ts.transpileModule(fs.readFileSync(root+target,'utf8'),{fileName:target,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);}
 console.log(`PASS student semester archive ${count} scenarios + 2 transpile checks`);
})().catch(error=>{console.error(error);process.exitCode=1;});
