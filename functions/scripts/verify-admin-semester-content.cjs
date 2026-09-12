const assert = require('node:assert/strict');
const { createAdminSemesterContentCore, TYPES } = require('../adminSemesterContent');
const { assertStudentReceiptSemester } = require('../studentSemesterReceipt');
const email='westoria28@gmail.com';
const base=new Map([
 ['site_settings/config',{year:'2026',semester:'2',activeSemesterId:'2026-2'}],
 ['site_settings/semester_active',{semesterId:'2026-2',revision:1}],
 ['semester_manifests/2026-1',{semesterId:'2026-1',status:'ARCHIVED',revision:3}],
 ['semester_manifests/2026-2',{semesterId:'2026-2',status:'ACTIVE',revision:1}],
 ['years/2026/semesters/1/lessons/a',{title:'1학기 자료',contentHtml:'<p>보관 본문</p>'}],
 ['years/2026/semesters/1/lessons/b',{title:'다음 자료'}],
 ['years/2026/semesters/1/dictionary_students/student/history_dictionary_words/word',{word:'고려',year:'2026',semester:'1'}],
 ['semester_assessment_attempts/old',{semesterId:'2026-1'}],
 ['semester_assessment_attempts/current',{semesterId:'2026-2'}],
]);
const make=()=>{
 const data=new Map(base), reads=[];
 const store={get:async path=>{reads.push(path);return {path,exists:data.has(path),data:data.get(path)};},
 query:async(path,options)=>[...data].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1)
 .filter(([key])=>!options.startAfterId||key.split('/').at(-1)>options.startAfterId).sort(([a],[b])=>a.localeCompare(b))
 .slice(0,options.limit).map(([path,data])=>({path,data,exists:true}))};
 const core=createAdminSemesterContentCore({store,assertSession:async request=>({uid:request.auth.uid,email:request.auth.token.email}),queryDictionaryWords:async()=>[]});
 return {data,reads,store,core};
};
const request=data=>({app:{appId:'fixture'},auth:{uid:'admin',token:{email}},data:{semesterId:'2026-1',contentType:'lessons',...data}});
(async()=>{
 let fixture=make();
 let page=await fixture.core.getAdminSemesterContent(request({pageSize:1}));
 assert.equal(page.rows[0].title,'1학기 자료');assert(page.nextCursor);assert.equal(page.readOnly,true);assert.equal(page.provenance,'ARCHIVE');
 const next=await fixture.core.getAdminSemesterContent(request({pageSize:1,cursor:page.nextCursor}));assert.equal(next.rows[0].title,'다음 자료');assert.equal(next.nextCursor,null);
 const detail=await fixture.core.getAdminSemesterContent(request({itemId:'a'}));assert.equal(detail.detail.contentHtml,'<p>보관 본문</p>');
 await assert.rejects(fixture.core.getAdminSemesterContent(request({semesterId:'2026-2'})),e=>e.code==='failed-precondition');
 await assert.rejects(fixture.core.getAdminSemesterContent({...request({}),auth:{uid:'student',token:{email:'student@yongshin-ms.ms.kr'}}}),e=>e.code==='permission-denied');
 await assert.rejects(fixture.core.getAdminSemesterContent({...request({}),app:null}),e=>e.code==='unauthenticated');
 for(const bad of [{itemId:'../a'},{contentType:'users'},{contentType:'think_cloud_responses'},{pageSize:31},{contentType:'quiz_questions',cursor:page.nextCursor},{itemId:'a',cursor:page.nextCursor}])
  await assert.rejects(fixture.core.getAdminSemesterContent(request(bad)),e=>e.code==='invalid-argument');
 const word=await fixture.core.getAdminSemesterContent(request({contentType:'dictionary_words',itemId:'student/word'}));assert.equal(word.detail.word,'고려');
 fixture=make();const original=fixture.store.query;fixture.store.query=async(...args)=>{const rows=await original(...args);fixture.data.set('semester_manifests/2026-1',{semesterId:'2026-1',status:'ACTIVE'});return rows;};
 await assert.rejects(fixture.core.getAdminSemesterContent(request({})),e=>e.code==='failed-precondition');
 fixture=make();const actor={actorRole:'student'};
 await assertStudentReceiptSemester(fixture.store,actor,{commandType:'submitAssessmentAttempt',target:{refs:['semester_assessment_attempts/current']}});
 await assert.rejects(assertStudentReceiptSemester(fixture.store,actor,{commandType:'submitAssessmentAttempt',target:{refs:['semester_assessment_attempts/old']}}),e=>e.details?.reason==='STUDENT_RECEIPT_SEMESTER_DENIED');
 await assert.rejects(assertStudentReceiptSemester(fixture.store,actor,{commandType:'saveHistoryDictionaryWord',target:{refs:['users/student/history_dictionary_words/word']}}),e=>e.details?.reason==='STUDENT_RECEIPT_SEMESTER_DENIED');
 await assertStudentReceiptSemester(fixture.store,{actorRole:'admin'},{commandType:'submitAssessmentAttempt',target:{refs:['semester_assessment_attempts/old']}});

 // Exercise the actual gateway replay and getStatus paths, not only the scope helper.
 const gateway = require('../commandGateway');
 const assessment = require('../assessmentLifecycle');
 const gatewayFixture = make();
 let transactions = 0, attemptedWrites = 0;
 gatewayFixture.store.runTransaction = async callback => {
   transactions++;
   return callback({ ...gatewayFixture.store,
     create: () => { attemptedWrites++; throw new Error('Replay must not write'); },
     set: () => { attemptedWrites++; throw new Error('Replay must not write'); },
     delete: () => { attemptedWrites++; throw new Error('Replay must not write'); },
   });
 };
 const gatewayCore = gateway.createCommandGatewayCore({
   store: gatewayFixture.store, projectId: 'demo-semester-content-review',
   assertSession: async request => ({ uid: request.auth.uid, email: request.auth.token.email }),
   authorizeCommand: async ({request}) => ({ actorUid: request.auth.uid, actorRole: 'student', actorEmail: request.auth.token.email }),
 });
 const commandType = 'submitAssessmentAttempt';
 const commandId = '00000000-0000-4000-8000-000000000001';
 const payload = { attemptId: 'attempt_' + 'a'.repeat(64), expectedRevision: 1, answers: { one: 'answer' }, submitReason: 'STUDENT' };
 const normalized = assessment.normalizeAssessmentPayload(commandType, payload);
 const payloadHash = gateway.sha256(gateway.canonicalize(normalized));
 const receiptPath = `${gateway.RECEIPT_COLLECTION}/${gateway.buildReceiptId('student', commandType, commandId)}`;
 const gatewayRequest = { auth: { uid: 'student', token: { email: 'student@example.test' } }, data: { commandType, commandId, payload } };
 const seedReceipt = refs => gatewayFixture.data.set(receiptPath, { commandType, commandId, payloadHash, status: 'SUCCEEDED', target: { refs }, result: { answerChecks: [{ id: 'one', correct: true }], score: 1 } });
 for (const method of ['execute', 'getStatus']) {
   seedReceipt(['semester_assessment_attempts/current']);
   const current = await gatewayCore[method](gatewayRequest);
   assert.equal(current.replayed, true);assert.equal(current.result.score, 1);
   seedReceipt(['semester_assessment_attempts/old']);
   await assert.rejects(gatewayCore[method](gatewayRequest), error => error.details?.reason === 'STUDENT_RECEIPT_SEMESTER_DENIED');
   seedReceipt(['semester_assessment_attempts/current', 'semester_assessment_attempts/old']);
   await assert.rejects(gatewayCore[method](gatewayRequest), error => error.details?.reason === 'STUDENT_RECEIPT_SEMESTER_DENIED');
   seedReceipt([]);
   await assert.rejects(gatewayCore[method](gatewayRequest), error => error.details?.reason === 'STUDENT_RECEIPT_SEMESTER_DENIED');
   seedReceipt(['semester_assessment_attempts/current']);
   gatewayFixture.data.set('semester_manifests/2026-2', { semesterId: '2026-2', status: 'CLOSED', revision: 1 });
   await assert.rejects(gatewayCore[method](gatewayRequest), error => error.details?.reason === 'STUDENT_RECEIPT_SEMESTER_DENIED');
   gatewayFixture.data.set('semester_manifests/2026-2', { semesterId: '2026-2', status: 'ACTIVE', revision: 1 });
 }
 assert.equal(transactions, 10);assert.equal(attemptedWrites, 0);
 assert.equal(TYPES.length,11);
 console.log(JSON.stringify({suite:'admin-semester-content-and-receipt',passed:true,archiveTypes:TYPES.length,gatewayReplayAndStatusCases:10,productionAccess:0,writes:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
