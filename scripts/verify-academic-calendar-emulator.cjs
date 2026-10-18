// Run under Auth, Firestore (with repository rules), and Functions emulators.
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
  const callableNames = [];
  const bundled = await build({entryPoints:['src/lib/academicCalendar.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['firebase/auth'],
    define:{'import.meta.env.DEV':'true','import.meta.env.VITE_USE_FIREBASE_EMULATORS':'"true"','import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST':'"127.0.0.1"','import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY':'""'},
    plugins:[{name:'emulator-sdk',setup(builder){
      builder.onResolve({filter:/^\.\/firebase$/},()=>({path:'firebase',namespace:'sdk'}));
      builder.onLoad({filter:/.*/,namespace:'sdk'},()=>({contents:'export const app = sdk.app; export const auth = sdk.auth; export const getHttpsCallable = sdk.getHttpsCallable;'}));
    }}]});
  const loaded = {exports:{}};
  new Function('module','exports','sdk','require',bundled.outputFiles[0].text)(loaded,loaded.exports,{app,auth,getHttpsCallable:async name=>{callableNames.push(name);return httpsCallable(functions,name);}},require);
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
  // Auth emulator ID tokens are unsigned fixtures. Age only this local token
  // and its existing session to exercise the real callable without sleeping.
  // Production tokens are never accepted by these guarded emulator endpoints.
  const currentUser = auth.currentUser;
  const freshToken = await currentUser.getIdToken();
  const [tokenHeader, tokenBody, tokenSignature] = freshToken.split('.');
  const claims = JSON.parse(Buffer.from(tokenBody,'base64url').toString('utf8'));
  assert.equal(JSON.parse(Buffer.from(tokenHeader,'base64url').toString('utf8')).alg,'none');
  const agedAuthTime = claims.auth_time - 360;
  const freshSession = (await store.doc(`application_sessions/${currentUser.uid}/sessions/${claims.auth_time}`).get()).data();
  const agedSession = {...freshSession,authTime:agedAuthTime};
  await store.doc(`application_sessions/${currentUser.uid}/sessions/${agedAuthTime}`).set(agedSession);
  const agedToken = `${tokenHeader}.${Buffer.from(JSON.stringify({...claims,auth_time:agedAuthTime})).toString('base64url')}.${tokenSignature}`;
  currentUser.stsTokenManager.accessToken = agedToken;
  const agedCallsStart = callableNames.length;
  let agedCreated;
  try {
    assert.equal((await currentUser.getIdTokenResult()).claims.auth_time,agedAuthTime);
    agedCreated = await mutate({...scope,action:'SAVE_EVENT',event:{...event,title:'6분 경과 일반 세션 등록'}});
    await mutate({...scope,action:'SAVE_EVENT',eventId:agedCreated.eventId,expectedRevision:1,event:{...event,title:'6분 경과 일반 세션 수정'}});
    await mutate({...scope,action:'SAVE_CATEGORIES',items:[{key:'event',label:'6분 경과 분류 저장',color:'#3b82f6',emoji:'',order:0}]});
    await mutate({...scope,action:'SYNC_HOLIDAYS',holidays:[{title:'추석',start:'2026-09-25',source:'generated'}]});
    assert.equal((await store.doc(`years/2026/semesters/2/calendar/${agedCreated.eventId}`).get()).data().title,'6분 경과 일반 세션 수정');
    assert.equal((await store.doc('site_settings/schedule_categories').get()).data().items[0].label,'6분 경과 분류 저장');
    assert.equal((await store.doc('years/2026/semesters/2/calendar/holiday_2026-09-25_추석').get()).exists,true);
    assert(!callableNames.slice(agedCallsStart).includes('beginApplicationSessionReauthentication'),'routine saves must not request step-up authentication');
    // Bypass only the client confirmation to verify the independent server
    // five-minute deletion fence still rejects a stale authentication epoch.
    await assert.rejects(httpsCallable(functions,'manageAcademicCalendar')({...scope,action:'DELETE_EVENT',eventId:agedCreated.eventId,expectedRevision:2,requestId:crypto.randomUUID(),_session:{authorityGeneration:agedSession.authorityGeneration,protocolVersion:agedSession.protocolVersion,revision:agedSession.sessionRevision}}),e=>e.code==='functions/failed-precondition'&&e.details?.reason==='RECENT_AUTH_REQUIRED');
    assert.equal((await store.doc(`years/2026/semesters/2/calendar/${agedCreated.eventId}`).get()).exists,true);
  } finally {
    currentUser.stsTokenManager.accessToken = freshToken;
  }
  await mutate({...scope,action:'DELETE_EVENT',eventId:agedCreated.eventId,expectedRevision:2});
  await mutate({...scope,action:'DELETE_EVENT',eventId:created.eventId,expectedRevision:2});
  assert.equal((await getDoc(ref)).exists(),false);
  await signOut(auth);
  const student = await createUserWithEmailAndPassword(auth,'calendar-qa@yongshin-ms.ms.kr','Emulator-only-Calendar-2026!');
  await store.doc(`users/${student.user.uid}`).set({role:'student',registrationApprovalStatus:'APPROVED'});
  await assert.rejects(mutate({...scope,action:'SAVE_EVENT',event}),e=>e.code==='functions/permission-denied');
  // Current repository rules retain administrator calendar writes; verify the
  // actual student boundary without claiming administrator writes are denied.
  await assert.rejects(setDoc(ref,{title:'student direct overwrite'},{merge:true}), e=>e.code==='permission-denied');
  await deleteApp(app);
  await adminApp.deleteApp(admin);
  console.log('PASS: real client adapter + sensitive-operation helper + session callable + calendar callable + repository Firestore rules. Create/read/update/delete/colors/ranges/categories/holiday sync/stale revision/stale scope/student callable and direct-write denial; six-minute-old general session saves/categories/holiday sync without step-up; stale-auth deletion denied and fresh-auth deletion succeeds.');
})().catch(error=>{console.error(error);process.exit(1);});
