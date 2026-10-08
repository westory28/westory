const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createStudentLearningRewardHandler } = require('../studentLearningReward');
const { accountIdFor } = require('../studentWisWallet');

// Destructive fixture reset is allowed only against this isolated demo emulator.
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Local Firestore emulator required');
const projectId = 'demo-westory-student-learning-reward';
const app = initializeApp({ projectId });
const db = getFirestore(app);
const semesterId = '2026-2', root = 'years/2026/semesters/2', uid = 'student-one';
const hash = value => createHash('sha256').update(value).digest('hex');
const accountId = accountIdFor(semesterId, uid);
const accountPath = `semester_wis_accounts/${accountId}`;
const policy = { autoRewardEnabled:true, rewardPolicy:{ lesson:{enabled:true,amount:25}, thinkCloud:{enabled:true,amount:10,cooldownHours:24,maxClaims:3} } };
const request = (activityType='lesson', sourceId='lesson-unit-one', extra={}) => ({auth:{uid},data:{year:'2026',semester:'2',activityType,sourceId,...extra}});
const assertSession = async req => { if (!req.auth?.uid) throw Object.assign(new Error('No session'),{code:'unauthenticated'}); };
const handler = createStudentLearningRewardHandler({db,loadPolicy:async()=>policy,assertSession});
const get = async path => (await db.doc(path).get()).data();
const patch = (path,data) => db.doc(path).set(data,{merge:true});
const receiptPath = (type,source) => `${root}/student_learning_rewards/${hash(uid+'\n'+type+'\n'+source)}`;
const statePath = type => `${root}/student_learning_reward_states/${hash(uid+'\n'+type)}`;
const responseId = n => `thinkresp_response_${n}`;
const thinkSource = n => `think-cloud:topic-one:${responseId(n)}`;
const progressPath = `${root}/lesson_progress/${uid}/units/unit-one`;
const lessonPath = `${root}/lessons/lesson-one`;
let groups=0;
async function seed() {
  const reset = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'});
  assert.equal(reset.ok,true);
  policy.autoRewardEnabled=true;
  Object.assign(policy.rewardPolicy.lesson,{enabled:true,amount:25});
  Object.assign(policy.rewardPolicy.thinkCloud,{enabled:true,amount:10,cooldownHours:24,maxClaims:3});
  const docs={
    'site_settings/semester_active':{semesterId,revision:1},
    [`semester_manifests/${semesterId}`]:{semesterId,status:'ACTIVE',revision:1},
    [`semester_wis_economies/${semesterId}`]:{semesterId,status:'ACTIVE_OPEN',revision:1,ledgerEntryCount:0},
    [`users/${uid}`]:{role:'student',registrationApprovalStatus:'APPROVED'},
    [`student_identities/${uid}`]:{studentUid:uid,accountStatus:'ACTIVE'},
    [`semester_enrollment_slots/slot_${hash(semesterId+'\n'+uid).slice(0,40)}`]:{studentUid:uid,semesterId,status:'ACTIVE',activeEnrollmentId:'enrollment-one'},
    'semester_enrollments/enrollment-one':{enrollmentId:'enrollment-one',studentUid:uid,semesterId,enrollmentStatus:'ACTIVE',classId:'class-one'},
    'semester_classes/class-one':{classId:'class-one',semesterId,status:'ACTIVE'},
    [accountPath]:{schemaVersion:1,policyVersion:'w7-v1',accountId,studentUid:uid,semesterId,enrollmentId:'enrollment-one',classId:'class-one',status:'ACTIVE',revision:1,balance:500,earnedTotal:0,rankEarnedTotal:0,spentTotal:0,adjustedTotal:0,recentLedgerEntries:[]},
    [lessonPath]:{unitId:'unit-one',isVisibleToStudents:true,assignedClassIds:['class-one'],contentRevision:2},
    [progressPath]:{studentUid:uid,semesterId,completed:true,answerRevision:1,contentRevision:2},
    [`${root}/think_cloud_sessions/topic-one`]:{classId:'class-one',status:'active'},
  };
  for(let n=1;n<=4;n++)docs[`${root}/think_cloud_sessions/topic-one/responses/${responseId(n)}`]={uid,revision:1,textNormalized:'검증 응답',createdAt:Timestamp.now()};
  const batch=db.batch();for(const [path,data] of Object.entries(docs))batch.set(db.doc(path),data);await batch.commit();
}
async function unchanged() {
  assert.equal((await get(accountPath)).balance,500);
  assert.equal((await db.collection('semester_wis_ledger').get()).size,0);
  assert.equal((await db.collection(`${root}/student_learning_rewards`).get()).size,0);
}
async function test(name,fn){await seed();await fn();groups++;console.log(`PASS ${name}`);}
(async()=>{try {
  await test('lesson canonical balance, ledger, projections, receipt reference and replay',async()=>{
    const result=await handler(request());assert.equal(result.balance,525);assert.equal(result.awarded,true);
    const account=await get(accountPath);assert.equal(account.earnedTotal,25);assert.equal(account.rankEarnedTotal,25);assert.equal(account.adjustedTotal,25);assert.equal(account.revision,2);
    assert.equal((await get(`semester_wis_balances/${accountId}`)).balance,525);
    assert.equal((await get(`semester_wis_rankings/${accountId}`)).rankEarnedTotal,25);
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount,1);
    const ledger=(await db.collection('semester_wis_ledger').get()).docs[0].data();assert.equal(ledger.actorUid,'system:learning');assert.equal(ledger.receiptId,receiptPath('lesson','lesson-unit-one'));assert.ok(await get(ledger.receiptId));
    assert.equal((await handler(request())).duplicate,true);assert.equal((await get(accountPath)).balance,525);
  });
  await test('parallel repeated lesson request pays exactly once',async()=>{
    const results=await Promise.all(Array.from({length:8},()=>handler(request())));assert.equal(results.filter(r=>r.awarded).length,1);assert.equal((await get(accountPath)).balance,525);assert.equal((await db.collection('semester_wis_ledger').get()).size,1);
  });
  await test('arbitrary owner, client score/proof and missing auth rejected',async()=>{
    for(const extra of [{uid:'victim'},{studentUid:'victim'},{completed:true},{amount:999},{answerRevision:1},{answers:{q:'fake'}}])await assert.rejects(handler(request('lesson','lesson-unit-one',extra)));
    await assert.rejects(handler({...request(),auth:null}));await unchanged();
  });
  for(const [name,fields] of Object.entries({foreignOwner:{studentUid:'victim'},pastSemester:{semesterId:'2026-1'},incomplete:{completed:false},unsigned:{answerRevision:0},staleContent:{contentRevision:1}}))await test(`lesson ${name} proof rejected`,async()=>{await patch(progressPath,fields);await assert.rejects(handler(request()));await unchanged();});
  for(const [name,fields] of Object.entries({hidden:{isVisibleToStudents:false},deleted:{deletedAt:Timestamp.now()},foreignClass:{assignedClassIds:['other-class']}}))await test(`lesson ${name} source rejected`,async()=>{await patch(lessonPath,fields);await assert.rejects(handler(request()));await unchanged();});
  await test('missing or ambiguous lesson source rejected',async()=>{
    await db.doc(lessonPath).delete();await assert.rejects(handler(request()));await unchanged();
    const source={unitId:'unit-one',contentRevision:2};await db.doc(lessonPath).set(source);await db.doc(`${root}/lessons/duplicate`).set(source);await assert.rejects(handler(request()));await unchanged();
  });
  await test('think cloud proof and foreign class isolation',async()=>{
    const path=`${root}/think_cloud_sessions/topic-one/responses/${responseId(1)}`;
    for(const fields of [{uid:'victim'},{revision:0},{textNormalized:''},{createdAt:null}]){
      const original=await get(path);await patch(path,fields);await assert.rejects(handler(request('think_cloud',thinkSource(1))));await db.doc(path).set(original);
    }
    await patch(`${root}/think_cloud_sessions/topic-one`,{classId:'other-class'});await assert.rejects(handler(request('think_cloud',thinkSource(1))));await unchanged();
  });
  await test('parallel distinct think responses respect shared cooldown',async()=>{
    const results=await Promise.all([1,2,3,4].map(n=>handler(request('think_cloud',thinkSource(n)))));assert.equal(results.filter(r=>r.awarded).length,1);assert.equal((await get(accountPath)).balance,510);assert.equal((await get(statePath('think_cloud'))).claimCount,1);
  });
  await test('think response replay never pays twice',async()=>{
    assert.equal((await handler(request('think_cloud',thinkSource(1)))).awarded,true);assert.equal((await handler(request('think_cloud',thinkSource(1)))).duplicate,true);assert.equal((await get(accountPath)).balance,510);
  });
  await test('legacy same source and legacy cooldown prevent repeated rewards',async()=>{
    const legacy=`${root}/point_transactions/old`;await db.doc(legacy).set({uid,activityType:'lesson',sourceId:'lesson-unit-one',delta:25,createdAt:Timestamp.now()});assert.equal((await handler(request())).duplicate,true);await unchanged();
    await db.doc(legacy).set({uid,type:'think_cloud',sourceId:'old-think',delta:10,createdAt:Timestamp.now()});assert.equal((await handler(request('think_cloud',thinkSource(1)))).duplicate,true);await unchanged();
  });
  await test('combined legacy and canonical claim limit',async()=>{
    await db.doc(`${root}/point_transactions/old`).set({uid,type:'think_cloud',sourceId:'old-think',delta:10,createdAt:Timestamp.fromMillis(Date.now()-48*3600000)});
    await db.doc(statePath('think_cloud')).set({studentUid:uid,semesterId,activityType:'think_cloud',claimCount:2,lastAwardedAt:Timestamp.fromMillis(Date.now()-48*3600000)});
    assert.equal((await handler(request('think_cloud',thinkSource(1)))).duplicate,true);await unchanged();
  });
  await test('elapsed cooldown grants next distinct response',async()=>{
    await db.doc(statePath('think_cloud')).set({studentUid:uid,semesterId,activityType:'think_cloud',claimCount:1,lastAwardedAt:Timestamp.fromMillis(Date.now()-25*3600000)});
    assert.equal((await handler(request('think_cloud',thinkSource(2)))).awarded,true);assert.equal((await get(statePath('think_cloud'))).claimCount,2);
  });
  for(const [name,path,fields] of [
    ['pending registration',`users/${uid}`,{registrationApprovalStatus:'PENDING'}],
    ['inactive identity',`student_identities/${uid}`,{accountStatus:'INACTIVE'}],
    ['inactive enrollment','semester_enrollments/enrollment-one',{enrollmentStatus:'INACTIVE'}],
    ['closed economy',`semester_wis_economies/${semesterId}`,{status:'CLOSED'}],
    ['changed semester','site_settings/semester_active',{semesterId:'2026-1'}],
    ['migration fence',`wis_legacy_migration_controls/${semesterId}`,{writesBlocked:true}],
  ])await test(`${name} denies payment`,async()=>{await patch(path,fields);await assert.rejects(handler(request()));await unchanged();});
  await test('disabled policy and invalid amount cannot pay',async()=>{
    policy.autoRewardEnabled=false;assert.equal((await handler(request())).awarded,false);policy.autoRewardEnabled=true;policy.rewardPolicy.lesson.amount=0;assert.equal((await handler(request())).awarded,false);
    for(const amount of [-1,1.5,1000001]){policy.rewardPolicy.lesson.amount=amount;await assert.rejects(handler(request()));}await unchanged();
  });
  await test('transaction rollback after staged wallet writes leaves no financial side effects',async()=>{
    const failingDb={doc:db.doc.bind(db),collection:db.collection.bind(db),runTransaction:fn=>db.runTransaction(tx=>fn(new Proxy(tx,{get(target,prop){if(prop==='create')return(ref,data)=>{if(ref.path.includes('/student_learning_rewards/'))throw Error('simulated receipt failure');return target.create(ref,data);};const value=target[prop];return typeof value==='function'?value.bind(target):value;}})))};
    const failHandler=createStudentLearningRewardHandler({db:failingDb,loadPolicy:async()=>policy,assertSession});await assert.rejects(failHandler(request()),/simulated receipt failure/);await unchanged();assert.equal((await get(`semester_wis_economies/${semesterId}`)).revision,1);assert.equal((await db.collection('semester_wis_balances').get()).size,0);assert.equal((await db.collection('semester_wis_rankings').get()).size,0);assert.equal(await get(statePath('lesson')),undefined);
  });
  console.log(`PASS learning reward: ${groups} transaction groups, isolated emulator only`);
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
