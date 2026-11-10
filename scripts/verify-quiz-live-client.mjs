import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { summarizeClass, summarizeGrade, adaptRecords } = require('../functions/quizClassAnalysis.js');
const load = (file, dependencies = {}, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; }, ...globals });
  return exports;
};
const plain = value => JSON.parse(JSON.stringify(value));
const analysis = load('src/lib/quizAnalysis.ts');
const state = load('src/lib/quizClassLiveState.ts', { './quizAnalysis': analysis });
const scope = { semesterId: '2026-2', unitId: 'exam_prep', category: 'exam_prep', examRound: 'round_1', classIds: ['c1'], comparisonGrade: '3' };
const classes = [{id:'c1',label:'3학년 1반',grade:'3'},{id:'c2',label:'3학년 2반',grade:'3'}];
const students = [{uid:'a',classId:'c1'},{uid:'b',classId:'c1'},{uid:'c',classId:'c2'}];
const questions = [{id:1,type:'choice',unitId:'exam_prep',category:'exam_prep',examRound:'round_1',sourceRevision:'1',question:'문항',options:['정답','오답'],concepts:['개념']}];
const row = (id,uid,percent,revision='1') => ({ id,source:'canonical',raw:{
  assessmentKind:'QUIZ',studentUid:uid,semesterId:'2026-2',sourceId:'exam_prep',category:'exam_prep',examRound:'round_1',
  percent,total:1,submittedAtIso:`2026-11-10T01:00:0${id.length}Z`,
  answers:{1:percent?'정답':'오답'},answerChecks:[{id:1,correct:!!percent}],learningSnapshot:[{id:1,sourceRevision:revision,concepts:['개념']}],
  questionSnapshots:[{id:1,question:'응시원문',image:'frozen.png'}],
}});
let rows = [row('a1','a',0),row('c1','c',100)];
const summarize = (target) => summarizeClass(scope,target,students.filter(s=>s.classId===target.id),questions,rows,'time','version');
const live = {statePath:'quiz_class_analysis_state/2026-2',contentCursor:0,contextVersion:'context',rosterGeneration:'r1',classes:classes.map((entry,i)=>({classId:entry.id,statePath:`quiz_class_analysis_state/2026-2/classes/${String(i+1).repeat(64)}`,cursor:0}))};
let summary = { ...scope,classes:[summarize(classes[0])],gradeComparison:summarizeGrade('3',classes.map(summarize),'time'),liveKey:9,live,
  liveData:{students,questions,classes,records:adaptRecords(rows,students,scope.semesterId)} };
const delta = (updates=[],removedKeys=[]) => ({semesterId:scope.semesterId,rawRows:updates,records:adaptRecords(updates,students,scope.semesterId),removedKeys,questionUpserts:[],questionRemovedIds:[],mockExamScoreRows:updates,live,hasMore:false});
const comparable = value => { const result = plain(value); delete result.generatedAt; delete result.version; return result; };
for (const change of [delta([row('b1','b',100)]),delta([row('a1','a',100)],['canonical:a1']),delta([],['canonical:c1'])]) {
  rows = rows.filter(row=>!change.removedKeys.includes(`${row.source}:${row.id}`));
  for (const update of change.rawRows) rows = [...rows.filter(row=>row.id!==update.id),update];
  summary = state.applyQuizClassSummaryChanges(summary,scope,change);
  const expectedClass = summarize(classes[0]);
  expectedClass.concepts = expectedClass.concepts.filter(c=>c.wrongCount>0);
  assert.deepEqual(comparable(summary.classes[0]),comparable(expectedClass),'incremental class results equal authoritative summary');
  assert.deepEqual(comparable(summary.gradeComparison),comparable(summarizeGrade('3',classes.map(summarize),'time')),'comparison grade stays weighted and complete');
  assert.equal(summary.liveKey,9,'delta never restarts subscription');
}
const detail = {rawRows:[row('a1','a',0)],questions,students,mockExamScoreRows:[row('a1','a',0)],liveKey:1};
const corrected = state.applyQuizClassChanges(detail,delta([row('a1','a',100)],['canonical:a1']));
assert.equal(corrected.rawRows.length,1); assert.equal(corrected.rawRows[0].raw.percent,100);
assert.equal(corrected.mockExamScoreRows[0].raw.percent,100); assert.equal(corrected.rawRows[0].raw.questionSnapshots[0].image,'frozen.png');
assert.equal(state.applyQuizClassChanges(corrected,delta()).questions,corrected.questions,'empty delta preserves question identity');
assert.equal(state.applyQuizClassChanges(corrected,delta([],['canonical:a1'])).rawRows.length,0);

let timers=[],calls=[],callbacks=new Map(),visibilityHandler,failed=[],applied=[],resolveRead;
const document = {visibilityState:'visible',addEventListener:(_event,fn)=>visibilityHandler=fn,removeEventListener:()=>visibilityHandler=null};
const watcher = load('src/lib/quizClassLive.ts', {
  './firebase':{db:{}},
  'firebase/firestore':{doc:(_db,path)=>path,onSnapshot:(path,options,next,error)=>{assert.equal(options.includeMetadataChanges,true);callbacks.set(path,{next,error});return()=>callbacks.delete(path);}},
  './quizClassAnalysis':{getQuizClassChanges:(...args)=>{calls.push(args);return new Promise(resolve=>resolveRead=resolve);}},
}, {document,setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:fn=>{timers=timers.filter(timer=>timer!==fn);}});
const emit = (path,value,fromCache=false) => callbacks.get(path).next({data:()=>value,metadata:{fromCache}});
const flush = async()=>{const pending=timers;timers=[];pending.forEach(fn=>fn());await Promise.resolve();await Promise.resolve();};
let stop = watcher.watchQuizClassChanges(scope,'identity','achievement',live,change=>applied.push(change),error=>failed.push(error));
assert.equal(callbacks.size,3);
emit(live.statePath,{sequence:0,rosterGeneration:'r1'});
live.classes.forEach(entry=>emit(entry.statePath,{sequence:0}));
await flush(); assert.equal(calls.length,0,'unchanged metadata costs zero callable/full result reads');
emit(live.classes[0].statePath,{sequence:1},true);
await flush(); assert.equal(calls.length,0,'unconfirmed cache does not fetch results');
emit(live.classes[0].statePath,{sequence:1});emit(live.classes[1].statePath,{sequence:1});
await flush(); assert.equal(calls.length,1,'burst notifications coalesce');
emit(live.classes[0].statePath,{sequence:2});
const nextLive={...live,classes:live.classes.map(entry=>({...entry,cursor:1}))};
resolveRead({...delta(),live:nextLive,hasMore:true});await flush();await flush();
assert.equal(calls.length,2);assert.equal(calls[1][3].classes[0].cursor,1,'next page uses committed cursor');
resolveRead({...delta(),live:{...nextLive,classes:nextLive.classes.map(entry=>({...entry,cursor:2}))}});await flush();
document.visibilityState='hidden';visibilityHandler();assert.equal(callbacks.size,0,'hidden tab releases listeners');
document.visibilityState='visible';visibilityHandler();assert.equal(callbacks.size,3);
emit(live.classes[0].statePath,{sequence:3});await flush();stop();resolveRead({...delta(),live});await flush();
assert.equal(applied.length,2,'late response cannot update abandoned identity/scope');assert.equal(callbacks.size,0);
stop=watcher.watchQuizClassChanges(scope,'new-identity','achievement',live,()=>{},error=>failed.push(error));
callbacks.get(live.statePath).error(new Error('permission-denied'));assert.equal(callbacks.size,0);assert.equal(failed.length,1);
stop();
console.log('PASS quiz live client: submit/correct/delete, weighted comparison parity, frozen images, cursor batching, no-change zero reads, hidden cleanup, identity disposal and permission stop');
