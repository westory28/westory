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
