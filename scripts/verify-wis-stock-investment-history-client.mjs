import assert from 'node:assert/strict';
import { build } from 'esbuild';
const stub = `
export const qa=globalThis.historyClientQa={calls:[],pending:[],epoch:123};
const user={uid:'teacher',getIdTokenResult:async()=>({claims:{auth_time:qa.epoch}})};
export const auth={currentUser:user};qa.auth=auth;qa.user=user;
export const getHistoryDictionaryCallable=async(name,options)=>async(scope)=>{
 options.beforeDispatch?.();qa.calls.push({name,scope});return new Promise((resolve,reject)=>qa.pending.push({resolve,reject}));
};`;
const compiled = await build({entryPoints:['src/lib/wisStockInvestmentHistoryClient.ts'], bundle:true, write:false, platform:'node',format:'esm',plugins:[{name:'stub',setup(plugin){
 plugin.onResolve({filter:/^\.\/firebase$|^\.\/historyDictionarySession$/},()=>({path:'stub',namespace:'fixture'}));
 plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub}));
}}]});
const {getWisStockInvestmentHistory:get,getWisStockInvestmentHistories:getMany}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const qa=globalThis.historyClientQa;
const scope={year:'2026',semester:'2',grade:'3',classNumber:'1',studentKey:'student_000000000000000000000001'};
const holding={stockId:'stock_000000000000000000000001',name:'검증 종목',quantity:3};
const result=extra=>({semesterId:'2026-2',studentKey:scope.studentKey,grade:'3',classNumber:'1',asOfMs:10000,sourceRevision:4,priceRevision:6,
 points:[{atMs:1000,holdingValue:1100,holdingCostBasis:1000},{atMs:2000,holdingValue:null,holdingCostBasis:null},{atMs:3000,holdingValue:0,holdingCostBasis:0}],incompleteBeforeMs:2000,holdings:[holding],...extra});
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const first=get(scope), duplicate=get({...scope});await tick();assert.equal(qa.calls.length,1);qa.pending.shift().resolve({data:result()});
assert.deepEqual(await first,await duplicate);assert.deepEqual(qa.calls[0],{name:'getWisStockInvestmentHistory',scope});
const fresh=get(scope);await tick();assert.equal(qa.calls.length,2);qa.pending.shift().resolve({data:result()});await fresh;
for(const extra of [{semesterId:'2027-1'},{studentKey:'student_other'},{classNumber:'2'},
 {points:[{atMs:20000,holdingValue:1,holdingCostBasis:1}]},{points:[{atMs:1000,holdingValue:NaN,holdingCostBasis:1}]},
 {points:[{atMs:1000,holdingValue:1,holdingCostBasis:null}]},{incompleteBeforeMs:20000},
 {holdings:undefined},{holdings:null},{holdings:[null]},{holdings:[{...holding,stockId:'other'}]},
 {holdings:[{...holding,name:''}]},{holdings:[{...holding,quantity:0}]},{holdings:[{...holding,quantity:-1}]},
 {holdings:[{...holding,quantity:1.5}]},{holdings:[{...holding,quantity:Number.MAX_SAFE_INTEGER+1}]},{holdings:[holding,holding]}]){
 const pending=get(scope);await tick();qa.pending.shift().resolve({data:result(extra)});await assert.rejects(pending,/범위/);
}
const owner=get(scope);await tick();qa.auth.currentUser={...qa.user,uid:'other_teacher'};qa.pending.shift().resolve({data:result()});await assert.rejects(owner,/로그인/);qa.auth.currentUser=qa.user;
const epoch=get(scope);await tick();qa.epoch++;qa.pending.shift().resolve({data:result()});await assert.rejects(epoch,/로그인/);
const failed=get(scope);await tick();qa.pending.shift().reject(new Error('network'));await assert.rejects(failed,/network/);
const retry=get(scope);await tick();qa.pending.shift().resolve({data:result()});await retry;
const emptyHoldings=get(scope);await tick();qa.pending.shift().resolve({data:result({holdings:[]})});assert.deepEqual((await emptyHoldings).holdings,[]);
const count=qa.calls.length;qa.auth.currentUser=null;await assert.rejects(get(scope),/로그인/);assert.equal(qa.calls.length,count);
// Bounded multi-student requests share a flight regardless of ranking order.
qa.auth.currentUser=qa.user;
const {studentKey,...baseScope}=scope;
const keys=[studentKey,'student_000000000000000000000002'];
const batch=extra=>({semesterId:'2026-2',histories:keys.map(studentKey=>result({studentKey})),...extra});
const batchCount=qa.calls.length;
const firstBatch=getMany({...baseScope,studentKeys:keys}),sameBatch=getMany({...baseScope,studentKeys:[...keys].reverse()});
await tick();assert.equal(qa.calls.length,batchCount+1);qa.pending.shift().resolve({data:batch()});assert.deepEqual(await firstBatch,await sameBatch);
for(const studentKeys of [[],[...keys,keys[0]],Array.from({length:6},(_,i)=>'student_'+String(i).padStart(24,'0')),['bad']]){
 const count=qa.calls.length;await assert.rejects(getMany({...baseScope,studentKeys}),/대상/);assert.equal(qa.calls.length,count);
}
for(const extra of [{semesterId:'2027-1'},{histories:[result()]},{histories:[result(),result()]},
 {histories:[result(),result({studentKey:keys[1],classNumber:'2'})]},
 {histories:[result(),result({studentKey:'student_000000000000000000000003'})]}]){
 const pending=getMany({...baseScope,studentKeys:keys});await tick();qa.pending.shift().resolve({data:batch(extra)});await assert.rejects(pending,/범위/);
}
const batchOwner=getMany({...baseScope,studentKeys:keys});await tick();qa.auth.currentUser=null;qa.pending.shift().resolve({data:batch()});await assert.rejects(batchOwner,/로그인/);qa.auth.currentUser=qa.user;
const batchFail=getMany({...baseScope,studentKeys:keys});await tick();qa.pending.shift().reject(new Error('network'));await assert.rejects(batchFail,/network/);
const batchRetry=getMany({...baseScope,studentKeys:keys});await tick();qa.pending.shift().resolve({data:batch()});assert.equal((await batchRetry).length,2);
// Exercise the real app factory: mocking only the SDK prevents a valid history
// client from silently calling the default Seoul region instead of its US export.
const routeStub = `
export const initializeApp=config=>({config});
export const getAuth=()=>({}),getFirestore=()=>({}),getStorage=()=>({});
export const browserLocalPersistence={},browserSessionPersistence={},indexedDBLocalPersistence={},inMemoryPersistence={};
export const setPersistence=async()=>{},connectFirestoreEmulator=()=>{},connectFunctionsEmulator=()=>{};
export const getFunctions=(_,region)=>({region});
export const httpsCallable=(functions,name)=>async input=>({data:{name,region:functions.region,input}});
export const isSemesterArchive=false,assertArchiveWritable=()=>{},markLoginPerf=()=>{};
`;
const routing = await build({entryPoints:['src/lib/firebase.ts'],bundle:true,write:false,platform:'node',format:'esm',
 define:{'import.meta.env':'{}'},plugins:[{name:'sdk-only',setup(plugin){
 plugin.onResolve({filter:/^firebase\/(app|auth|firestore|functions|storage)$|^\.\/semesterArchive$|^\.\/loginPerf$/},()=>({path:'sdk',namespace:'route-fixture'}));
 plugin.onLoad({filter:/.*/,namespace:'route-fixture'},()=>({contents:routeStub}));
}}]});
const {getHttpsCallable}=await import(`data:text/javascript;base64,${Buffer.from(routing.outputFiles[0].text).toString('base64')}`);
for(const [name,region] of [['getWisStockInvestmentHistory','us-central1'],['getStudentWisStockHistory','us-central1'],
 ['getWisStockManagement','us-central1'],['placeStudentWisStockOrder','us-central1'],['manageWrittenExamAsset','asia-northeast3']]){
 const call=await getHttpsCallable(name);const routed=await call({probe:true});
 assert.deepEqual(routed.data,{name,region,input:{probe:true}},name+' callable region');
}
console.log(JSON.stringify({passed:22,scopedCalls:qa.calls.length,productionReads:0,productionWrites:0,checks:'in-flight sharing, explicit refresh/retry, stale owner/session rejection, response scope/number/gap validation, actual Firebase factory routes new/existing Wispi to US and preserves Seoul default'}));
