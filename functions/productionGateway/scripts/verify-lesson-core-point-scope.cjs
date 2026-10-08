const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const archive = require('../archiveEnrollment');
const semesterCore = require('../semesterCore');
const wis = require('../wisEconomy');
const gateway = require('../commandGateway');
const { HttpsError } = require('firebase-functions/v2/https');
const { Timestamp } = require('firebase-admin/firestore');
const source=fs.readFileSync(require.resolve('../productionSource'),'utf8');
const ast=ts.createSourceFile('productionSource.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['getLessonCorePointTimestampMs','getLessonUpdatedAtMs','getLatestLessonsByUnitIdForCorePoints','isStudentVisibleLessonForCorePoints','normalizeLessonCorePointIds','readEffectiveVisibleLessonCorePointCatalog','getLessonCorePointCompletion','assertLessonCorePointActiveScope','resolveLessonCorePointActiveEnrollmentId','assertLessonCorePointActiveEnrollment','executeLessonCorePointBusinessCommand','LESSON_CORE_POINT_COMMAND_TYPES','LESSON_CORE_POINT_REWARD_AMOUNT','LESSON_CORE_POINT_REWARD_SOURCE_ID','LESSON_CORE_POINT_RECENT_LEDGER_LIMIT']);
const declarations=[];
function walk(node){if(ts.isVariableDeclaration(node)&&names.has(node.name.getText(ast)))declarations.push(`const ${node.name.getText(ast)}=${node.initializer.getText(ast)};`);ts.forEachChild(node,walk);}walk(ast);assert.equal(declarations.length,names.size);
const db={doc:path=>({path}),collection:path=>({path,collection:true})};
const api=vm.runInNewContext(`${declarations.join('\n')}\n({execute:executeLessonCorePointBusinessCommand,catalog:readEffectiveVisibleLessonCorePointCatalog,completion:getLessonCorePointCompletion});`,{db,HttpsError,Timestamp,archiveEnrollment:archive,semesterCore,wisEconomy:wis,commandGateway:{...gateway,canonicalize:value=>gateway.canonicalize(JSON.parse(JSON.stringify(value)))},getSemesterRoot:(y,s)=>`years/${y}/semesters/${s}`,getPointCollectionPath:(y,s,c)=>`years/${y}/semesters/${s}/${c}`,buildActivityTransactionId:(u,t,s)=>crypto.createHash('sha256').update([u,t,s].join(':')).digest('hex'),require:name=>{assert.equal(name,'./wisMigrationFence');return{assertNativeWisWriteAllowed:async()=>{}};}});
const root='years/2026/semesters/2',uid='student-one',scope='2026-2',accountId=wis.accountIdFor(scope,uid);
const slot=`${archive.ENROLLMENT_SLOT_COLLECTION}/${archive.buildEnrollmentSlotId(scope,uid)}`;
const ownUnit='own-unit',sharedUnit='shared-unit';
const lesson=(unitId,fields={})=>({unitId,isVisibleToStudents:true,worksheetExamHighlights:[{id:'point',widthRatio:0.1,heightRatio:0.1}],...fields});
function fixture(){
 const docs=new Map(Object.entries({
  'semester_manifests/2026-2':{semesterId:scope,status:'ACTIVE',revision:1},
  'site_settings/semester_active':{semesterId:scope,revision:1},
  [slot]:{studentUid:uid,semesterId:scope,status:'ACTIVE',activeEnrollmentId:'enrollment'},
  'semester_enrollments/enrollment':{studentUid:uid,semesterId:scope,enrollmentId:'enrollment',enrollmentStatus:'ACTIVE',classId:'class-one'},
  'semester_classes/class-one':{semesterId:scope,classId:'class-one',status:'ACTIVE'},
  [`${root}/lessons/own`]:lesson(ownUnit,{assignedClassIds:['class-one']}),
  [`${root}/lessons/shared`]:lesson(sharedUnit),
  [`${root}/lessons/foreign`]:lesson('foreign-unit',{assignedClassIds:['class-two']}),
  [`${root}/lessons/hidden`]:lesson('hidden-unit',{isVisibleToStudents:false}),
  [`${root}/lessons/deleted`]:lesson('deleted-unit',{deletedAt:1}),
  [`${root}/lessons/malformed`]:lesson('malformed-unit',{assignedClassIds:'class-one'}),
  [`semester_wis_accounts/${accountId}`]:{accountId,studentUid:uid,semesterId:scope,status:'ACTIVE',revision:1,balance:500,earnedTotal:0,rankEarnedTotal:0,spentTotal:0,adjustedTotal:0,recentLedgerEntries:[]},
  'semester_wis_economies/2026-2':{status:'ACTIVE_OPEN',ledgerEntryCount:0},
 }));const writes=[];let wrote=false;
 const snapshot=path=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 const tx={get:async ref=>{assert(!wrote,'read after write');return ref.collection?{docs:[...docs.keys()].filter(p=>p.startsWith(ref.path+'/')&&!p.slice(ref.path.length+1).includes('/')).map(snapshot)}:snapshot(ref.path);},getAll:async(...refs)=>Promise.all(refs.map(ref=>tx.get(ref))),set:(ref,value,options)=>{wrote=true;writes.push(ref.path);docs.set(ref.path,options?.merge?{...docs.get(ref.path),...value}:value);},create:(ref,value)=>{assert(!docs.has(ref.path));tx.set(ref,value);}};
 const execute=(type='recordLessonCorePointFind',unitId=ownUnit)=>api.execute({transaction:tx,command:{commandId:'fixture',commandType:type,payload:{year:'2026',semester:'2',unitId,corePointId:'point'}},actor:{uid},receiptId:'fixture-receipt',timestamp:Timestamp.now()});
 return{docs,writes,tx,execute};
}
(async()=>{
 let checks=0;
 {
  const f=fixture();const catalog=await api.catalog(f.tx,'2026','2','class-one');assert.deepEqual(Array.from(catalog,x=>x.unitId).sort(),[ownUnit,sharedUnit].sort());checks++;
  for(const unit of [ownUnit,sharedUnit])f.docs.set(`${root}/lesson_progress/${uid}/units/${unit}`,{corePointFinds:['point']});
  const completed=await api.completion(f.tx,'2026','2',uid,'class-one');assert.equal(completed.totalCount,2);assert.equal(completed.foundCount,2);assert.equal(completed.complete,true);checks++;
  const result=await f.execute('claimLessonCorePointReward');assert.equal(result.result.awarded,true);assert.equal(result.result.corePointTotalCount,2);assert.equal(f.docs.get(`semester_wis_accounts/${accountId}`).balance,1000);checks++;
 }
 {
  const f=fixture();assert.equal((await f.execute()).result.foundCount,1);assert.equal(f.writes.length,1);checks++;
 }
 for(const unit of ['foreign-unit','hidden-unit','deleted-unit','malformed-unit']){
  const f=fixture();await assert.rejects(f.execute('recordLessonCorePointFind',unit),error=>error.details?.reason==='LESSON_CORE_POINT_NOT_CANONICAL');assert.equal(f.writes.length,0);checks++;
 }
 for(const [path,fields] of [['semester_classes/class-one',{status:'ARCHIVED'}],['semester_classes/class-one',{semesterId:'2026-1'}],['semester_classes/class-one',{classId:'other'}],['semester_classes/class-one',{readOnly:true}],['semester_enrollments/enrollment',{readOnly:true}],['semester_enrollments/enrollment',{classId:''}],['semester_manifests/2026-2',{readOnly:true}]]){
  for(const type of ['recordLessonCorePointFind','claimLessonCorePointReward']){const f=fixture();f.docs.set(path,{...f.docs.get(path),...fields});await assert.rejects(f.execute(type));assert.equal(f.writes.length,0);checks++;}
 }
 {const f=fixture();f.docs.delete('semester_classes/class-one');await assert.rejects(f.execute());assert.equal(f.writes.length,0);checks++;}
 {const f=fixture();await assert.rejects(f.execute('claimLessonCorePointReward'),error=>error.details?.reason==='LESSON_CORE_POINTS_REMAINING');assert.equal(f.writes.length,0);checks++;}
 console.log(`PASS lesson core-point source/class boundary: ${checks} checks using reviewed production functions; network 0`);
})().catch(error=>{console.error(error);process.exitCode=1;});
