// Run under Auth, Firestore (with deployed rules), and Functions emulators.
// Never accepts a production endpoint. The Functions source must export the
// real manageAcademicCalendar and deployed openApplicationSession handlers.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { build } = require('esbuild');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } = require('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const serverRequire = createRequire(require.resolve('../functions/package.json'));
const adminApp = serverRequire('firebase-admin/app');
const adminFirestore = serverRequire('firebase-admin/firestore');

(async () => {
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    assert.match(process.env[name] || '', /^(127\.0\.0\.1|localhost):\d+$/, `${name} must be local`);
  }
  const projectId = process.env.GCLOUD_PROJECT;
  assert.equal(projectId, 'history-quiz-yongsin');
  const app = initializeApp({projectId, apiKey:'emulator-only', authDomain:'localhost'});
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {disableWarnings:true});
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  const functions = getFunctions(app, 'asia-northeast3');
  connectFunctionsEmulator(functions, '127.0.0.1', 5301);
  const admin = adminApp.initializeApp({projectId}, 'calendar-qa');
  const store = adminFirestore.getFirestore(admin);
  await Promise.all([
    store.doc('site_settings/config').set({year:'2026',semester:'2',activeSemesterId:'2026-2'}),
    store.doc('site_settings/semester_active').set({semesterId:'2026-2',revision:1}),
    store.doc('semester_manifests/2026-2').set({semesterId:'2026-2',revision:1,status:'ACTIVE'}),
  ]);
  const bundled = await build({entryPoints:['src/lib/academicCalendar.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['firebase/auth'],
    plugins:[{name:'emulator-sdk',setup(builder){
      builder.onResolve({filter:/^\.\/firebase$/},()=>({path:'firebase',namespace:'sdk'}));
      builder.onLoad({filter:/.*/,namespace:'sdk'},()=>({contents:'export const auth = sdk.auth; export const getHttpsCallable = sdk.getHttpsCallable;'}));
    }}]});
  const loaded = {exports:{}};
  new Function('module','exports','sdk','require',bundled.outputFiles[0].text)(loaded,loaded.exports,{auth,getHttpsCallable:async name=>httpsCallable(functions,name)},require);
  const {mutateAcademicCalendar:mutate} = loaded.exports;
  await createUserWithEmailAndPassword(auth, 'westoria28@gmail.com', 'Emulator-only-Calendar-2026!');
  const scope = {year:'2026',semester:'2'};
  const event = {title:'연속 일정 저장 검증',start:'2026-09-21',end:'2026-09-23',eventType:'event',targetType:'common',targetClass:null,labelColor:'#f97316',allDay:true,startPeriod:'allDay',endPeriod:'allDay',description:'에뮬레이터 전용'};
  const created = await mutate({...scope,action:'SAVE_EVENT',event});
  const ref = doc(db,`years/2026/semesters/2/calendar/${created.eventId}`);
  const stored = (await getDoc(ref)).data();
  assert.equal(stored.labelColor,event.labelColor);
  assert.equal(stored.start,event.start);
  assert.equal(stored.end,event.end);
  assert.equal(stored.revision,1);
  await assert.rejects(setDoc(ref,{title:'direct overwrite'},{merge:true}), e=>e.code==='permission-denied');
  const updated = await mutate({...scope,action:'SAVE_EVENT',eventId:created.eventId,expectedRevision:1,event:{...event,title:'수정 완료',labelColor:'#22c55e'}});
  assert.equal(updated.revision,2);
  assert.equal((await getDoc(ref)).data().labelColor,'#22c55e');
  await assert.rejects(mutate({...scope,action:'SAVE_EVENT',eventId:created.eventId,expectedRevision:1,event}),e=>e.code==='functions/aborted');
  await mutate({...scope,action:'SAVE_CATEGORIES',items:[{key:'event',label:'학교 행사',color:'#3b82f6',emoji:'',order:0}]});
  assert.equal((await getDoc(doc(db,'site_settings/schedule_categories'))).data().items[0].label,'학교 행사');
  await store.doc('years/2026/semesters/2/calendar/old-holiday').set({title:'추석',start:'2026-09-24',eventType:'holiday'});
  await mutate({...scope,action:'SYNC_HOLIDAYS',holidays:[{title:'추석 연휴',start:'2026-09-24',source:'generated'},{title:'추석',start:'2026-09-25',source:'generated'},{title:'추석 연휴',start:'2026-09-26',source:'generated'}]});
  assert.equal((await store.doc('years/2026/semesters/2/calendar/old-holiday').get()).exists,false);
  assert.equal((await getDoc(ref)).data().title,'수정 완료');
  assert.equal((await store.doc('years/2026/semesters/2/calendar/holiday_2026-09-26_추석연휴').get()).data().title,'추석 연휴');
  await assert.rejects(mutate({...scope,semester:'1',action:'SAVE_EVENT',event}),e=>e.code==='functions/failed-precondition');
  await mutate({...scope,action:'DELETE_EVENT',eventId:created.eventId,expectedRevision:2});
  assert.equal((await getDoc(ref)).exists(),false);
  await signOut(auth);
  const student = await createUserWithEmailAndPassword(auth,'calendar-qa@yongshin-ms.ms.kr','Emulator-only-Calendar-2026!');
  await store.doc(`users/${student.user.uid}`).set({role:'student',registrationApprovalStatus:'APPROVED'});
  await assert.rejects(mutate({...scope,action:'SAVE_EVENT',event}),e=>e.code==='functions/permission-denied');
  await deleteApp(app);
  await adminApp.deleteApp(admin);
  console.log('PASS: real client adapter + session callable + calendar callable + deployed Firestore rules. Create/read/update/delete/colors/ranges/categories/holiday sync/stale revision/stale scope/student denial/direct-write denial.');
})().catch(error=>{console.error(error);process.exitCode=1;});
