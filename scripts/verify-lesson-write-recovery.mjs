import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/lib/lessonWriteRecovery.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { createLessonWriteRecoveryStore } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
const store = createLessonWriteRecoveryStore();
const scope = 'teacher-a/2026/2';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const intent = () => ({kind:'document',input:{unitId:'lesson-a',expectedRevision:3,expectedTreeRevision:2,assetUploadIds:['asset-a'],document:{title:'수정한 제목',worksheetBlanks:[{id:'blank-a',answer:'고려'}]},tree:[{id:'lesson-a',title:'수정한 제목'}]}});

// Remount happens before commit: the new reader must remain blocked until the
// accepted write completes, while keeping a detached copy of the submitted data.
const gate=deferred(), input=intent();let serverRevision=3,readRevision;
const task=store.run(scope,input,async snapshot=>{await gate.promise;assert.equal(snapshot.input.document.title,'수정한 제목');serverRevision=4;return serverRevision;});
const record=store.peek(scope);input.input.document.title='나중에 바뀐 입력';
assert.equal(record.input.document.title,'수정한 제목');
store.acknowledge(record);assert.equal(store.peek(scope),record);
const remount=record.settled.then(result=>{assert.equal(result.ok,true);readRevision=serverRevision;});
await Promise.resolve();assert.equal(readRevision,undefined);
await assert.rejects(store.run(scope,intent(),async()=>5),/앞선 수업자료/);
gate.resolve();assert.equal(await task,4);await remount;assert.equal(readRevision,4);
assert.equal(store.peek('teacher-b/2026/2'),undefined);assert.equal(store.peek('teacher-a/2026/1'),undefined);
store.acknowledge(record);assert.equal(store.peek(scope),undefined);

// A conflict preserves the exact base revisions and uploaded asset handles.
// It must never silently rebase a restored draft to the latest server revision.
const conflict=new Error('revision conflict');
const failed=store.run(scope,intent(),async()=>{throw conflict;});
const rejected=store.peek(scope);await assert.rejects(failed,conflict);
const outcome=await rejected.settled;assert.equal(outcome.ok,false);assert.equal(outcome.error,conflict);
assert.equal(rejected.input.expectedRevision,3);assert.equal(rejected.input.expectedTreeRevision,2);
assert.deepEqual(rejected.input.assetUploadIds,['asset-a']);assert.equal(rejected.input.document.worksheetBlanks[0].answer,'고려');

// Cleanup from an earlier mount cannot remove a later request in the same scope.
const nextGate=deferred();const next=store.run(scope,intent(),()=>nextGate.promise);const nextRecord=store.peek(scope);
store.acknowledge(rejected);assert.equal(store.peek(scope),nextRecord);
nextGate.resolve('saved');await next;await nextRecord.settled;store.acknowledge(nextRecord);

const treeTask=store.run(scope,{kind:'tree',input:{expectedRevision:7,tree:[{id:'unit',title:'목차'}]}},async()=>({revision:8}));
const treeRecord=store.peek(scope);assert.deepEqual(await treeTask,{revision:8});assert.equal((await treeRecord.settled).ok,true);assert.equal(treeRecord.input.expectedRevision,7);
store.acknowledge(treeRecord);
console.log('PASS: commit/remount ordering, duplicate guard, detached draft, owner/semester isolation, failed draft/CAS/assets, stale cleanup, tree recovery');

// Actual save service, synthetic transaction transport. A lost document ack
// AND receipt lookup preserve the original full payload before any new upload.
const io = globalThis.__lessonRecoveryIo = {
  auth: { currentUser: { uid: 'teacher-a' } }, pointerRevision: 1,
  calls: [], tickets: new Map(), receipts: new Map(), commits: 0, loseAck: true,
};
const compiledService = await build({stdin:{contents:`export {saveLessonDocument,retryLessonDocumentSave} from './src/lib/lessonManagement';export {lessonWriteRecovery} from './src/lib/lessonWriteRecovery';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'controlled-lesson-transport',setup(api){
  api.onResolve({filter:/\/firebase$|commandGateway$|firebase\/firestore$/},()=>({path:'io',namespace:'lesson-test'}));
  api.onLoad({filter:/.*/,namespace:'lesson-test'},()=>({contents:`const io=globalThis.__lessonRecoveryIo;export const auth=io.auth,db={};export const getFirebaseStorage=()=>({});export const getHttpsCallable=()=>{throw Error('No transport upload expected')};export const doc=(_db,...parts)=>({path:parts.join('/')});const snap=data=>({exists:()=>!!data,data:()=>structuredClone(data)});export const getDoc=async()=>snap({semesterId:'2026-2',revision:io.pointerRevision});export const getDocFromServer=async ref=>snap(io.tickets.get(ref.path.split('/').at(-1)));export const executeWestoryCommand=async(type,payload,options)=>{io.calls.push({type,payload:structuredClone(payload),options});const key=JSON.stringify(payload);if(io.receipts.has(key))return io.receipts.get(key);const result={result:{contentRevision:4,treeRevision:2}};io.receipts.set(key,result);io.commits++;if(io.loseAck){io.loseAck=false;throw Object.assign(Error('Ack and receipt unavailable'),{state:'retryable',retryable:true});}return result;};` }));
}}]});
const service=await import('data:text/javascript;base64,'+Buffer.from(compiledService.outputFiles[0].contents).toString('base64'));
for(const [id,kind] of [['old-pdf','PDF'],['old-page','PAGE'],['old-note','FOOTNOTE'],['new-pdf','PDF'],['new-page','PAGE']])io.tickets.set(id,{kind,storagePath:'assets/'+id,url:'https://local/'+id});
const draft={pdfName:'new.pdf',pdfStoragePath:'assets/new-pdf',pdfUrl:'https://local/new-pdf',worksheetPageImages:[{page:1,width:100,height:100,imageUrl:'https://local/new-page'}],footnotes:[]};
let preparations=0;
const original={unitId:'unit',expectedRevision:3,assetUploadIds:['old-pdf','old-page','old-note'],document:{title:'원래 제출 제목'}};
const preparation={localDraft:{pdfFile:null,preparedPdf:null,footnotes:{}},prepare:async()=>{preparations++;return {document:{...original.document,...draft},assetUploadIds:['old-pdf','old-page','old-note','new-pdf','new-page']};}};
await assert.rejects(service.saveLessonDocument({year:'2026',semester:'2'},original,preparation),/Ack and receipt/);
const uncertain=service.lessonWriteRecovery.peek(scope);
assert.equal(uncertain.submission.unconfirmed,true);
assert.deepEqual(uncertain.input,original,'preparation input remains distinct from the final submitted document');
assert.deepEqual(uncertain.submission.payload.assetUploadIds,['new-pdf','new-page'],'replaced PDF/page and deleted footnote tickets are filtered');
assert.equal(uncertain.submission.payload.expectedSemesterRevision,1);
service.lessonWriteRecovery.acknowledge(uncertain);assert.equal(service.lessonWriteRecovery.peek(scope),uncertain);
await assert.rejects(service.saveLessonDocument({year:'2026',semester:'2'},{...original,document:{title:'새 편집'}},preparation),/앞선 수업자료/);
assert.equal(preparations,1,'unresolved result blocks another preparation/upload');
io.auth.currentUser={uid:'teacher-b'};
await assert.rejects(service.retryLessonDocumentSave(uncertain),/원래 계정/);
assert.equal(io.calls.length,1,'another owner cannot replay the frozen operation');
io.auth.currentUser={uid:'teacher-a'};io.pointerRevision=9;
assert.equal((await service.retryLessonDocumentSave(uncertain)).contentRevision,4);
assert.deepEqual(io.calls[1],io.calls[0],'retry keeps original semester revision, unit CAS, document and asset IDs');
assert.equal(io.commits,1);assert.equal(preparations,1);assert.equal(uncertain.submission.unconfirmed,false);
service.lessonWriteRecovery.acknowledge(uncertain);assert.equal(service.lessonWriteRecovery.peek(scope),undefined);
delete globalThis.__lessonRecoveryIo;
console.log('PASS: actual service retained PDF/page/footnote filtering, input/submission separation, unresolved freeze, owner isolation, exact payload retry after semester revision change, one document commit');
