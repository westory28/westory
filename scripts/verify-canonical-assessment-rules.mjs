import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Timestamp } from 'firebase/firestore';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required');
const projectId = 'demo-westory-session-canonical-assessment';
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
const authTime = Math.floor(Date.now()/1000)-10;
const user = uid => env.authenticatedContext(uid, { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime }).firestore();
const student = user('student-a'), teacher = user('teacher-a');
const seed = async (path, data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));
try {
  await env.clearFirestore();
  for (const [uid, role] of [['student-a','student'],['student-b','student'],['teacher-a','teacher']]) {
    await seed(`users/${uid}`, { role, registrationApprovalStatus: 'APPROVED' });
    await seed(`application_sessions/${uid}/sessions/${authTime}`, { schemaVersion: 2, authTime, status: 'active', authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now()+3600000) });
  }
  await seed('site_settings/semester_active', { semesterId: '2026-2' });
  for (const collectionName of ['semester_assessment_results','semester_assessment_submissions']) {
    for (const [id, studentUid, semesterId] of [['own','student-a','2026-2'],['other','student-b','2026-2'],['past','student-a','2026-1']])
      await seed(`${collectionName}/${id}`, { studentUid, semesterId, score: 1 });
    await assertSucceeds(getDoc(doc(student, `${collectionName}/own`)));
    await assertSucceeds(getDocs(query(collection(student, collectionName), where('studentUid','==','student-a'),where('semesterId','==','2026-2'))));
    await assertFails(getDocs(query(collection(student, collectionName), where('studentUid','==','student-a'))));
    await assertFails(getDoc(doc(student, `${collectionName}/other`)));
    await assertFails(getDoc(doc(student, `${collectionName}/past`)));
    await assertFails(setDoc(doc(student, `${collectionName}/forged`), { studentUid: 'student-a', semesterId: '2026-2', score: 100 }));
    await assertFails(updateDoc(doc(student, `${collectionName}/own`), { score: 100 }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${collectionName}/own`)));
    await assertSucceeds(getDoc(doc(teacher, `${collectionName}/own`)));
  }
  await seed('semester_assessment_attempts/own', { studentUid: 'student-a', semesterId: '2026-2', gradingSnapshot: [{ answer: 'private' }] });
  await assertFails(getDoc(doc(student, 'semester_assessment_attempts/own')));
  for (const path of ['lesson_progress/student-a','lesson_progress/student-a/units/unit-one','years/2026/semesters/2/lesson_progress/student-a','years/2026/semesters/2/lesson_progress/student-a/units/unit-one']) {
    const proof = { studentUid:'student-a', semesterId:'2026-2', completed:true, answerRevision:1, contentRevision:1 };
    await assertFails(setDoc(doc(student, path), proof));
    await seed(path, proof);
    await assertSucceeds(getDoc(doc(student, path)));
    await assertFails(updateDoc(doc(student, path), { answerRevision:999, completed:true }));
  }
  for (const path of ['quiz_results/forged','history_classroom_results/forged','years/2026/semesters/2/quiz_results/forged','years/2026/semesters/2/history_classroom_results/forged'])
    await assertFails(setDoc(doc(student,path), { uid: 'student-a', score: 999999, passed: true }));
  await seed('users/student-a', { role: 'student', registrationApprovalStatus: 'PENDING' });
  await assertFails(getDoc(doc(student, 'semester_assessment_results/own')));
  await seed('users/student-a', { role: 'student', registrationApprovalStatus: 'APPROVED' });
  const noSession = env.authenticatedContext('student-a', { email: 'student-a@yongshin-ms.ms.kr', auth_time: authTime + 1 }).firestore();
  await assertFails(getDoc(doc(noSession, 'semester_assessment_results/own')));
  await seed('site_settings/student_maintenance', { enabled: true, blockedRoles: ['student'], bypassUids: [], title: '점검', message: '잠시 기다려 주세요.', startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'teacher-a', revision: 1 });
  await assertFails(getDoc(doc(student, 'semester_assessment_results/own')));
  await assertSucceeds(getDoc(doc(teacher, 'semester_assessment_results/own')));
  console.log('PASS canonical assessment rules: current own results/answers, query scope, foreign/past/private-key isolation, learning-proof forgery denial, server-only writes, session/registration/maintenance (39 assertions; emulator only)');
} finally { await env.cleanup(); }
