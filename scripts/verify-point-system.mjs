import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const projectId = 'demo-westory-points';
const year = '2026';
const semester = '1';
const semesterRoot = `years/${year}/semesters/${semester}`;
const rules = readFileSync(resolve('firestore.rules'), 'utf8');

const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};

const authHost = 'http://127.0.0.1:9099';
const firestoreHost = '127.0.0.1';
const firestorePort = 8080;
const functionsHost = '127.0.0.1';
const functionsPort = 5001;

const apps = [];

const createClient = async (name, email, password) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authHost, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  const functions = getFunctions(app, 'asia-northeast3');
  connectFunctionsEmulator(functions, functionsHost, functionsPort);
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return {
    app,
    auth,
    db,
    functions,
    user: userCredential.user,
    email,
  };
};

const expectPass = async (label, fn, results) => {
  try {
    const detail = await fn();
    results.push({ label, status: 'pass', detail });
    return detail;
  } catch (error) {
    results.push({ label, status: 'fail', detail: error?.message || String(error) });
    throw error;
  }
};

const expectFail = async (label, fn, results, expectedIncludes = []) => {
  try {
    await fn();
    results.push({ label, status: 'fail', detail: 'Expected failure but call succeeded.' });
    throw new Error(`${label}: expected failure`);
  } catch (error) {
    const message = error?.message || String(error);
    const matches = expectedIncludes.length === 0 || expectedIncludes.some((item) => message.includes(item));
    if (!matches) {
      results.push({ label, status: 'fail', detail: message });
      throw error;
    }
    results.push({ label, status: 'pass', detail: message });
  }
};

const countTransactions = async (adminDb, uid, type) => {
  const snapshot = await getDocs(query(
    collection(adminDb, `${semesterRoot}/point_transactions`),
    where('uid', '==', uid),
    where('type', '==', type),
  ));
  return snapshot.size;
};

const main = async () => {
  const results = [];
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules,
    },
  });

  await testEnv.clearFirestore();

  const student = await createClient('student-app', 'student1@yongshin-ms.ms.kr', 'Password!123');
  const teacher = await createClient('teacher-app', 'teacher1@yongshin-ms.ms.kr', 'Password!123');
  const reader = await createClient('reader-app', 'reader1@yongshin-ms.ms.kr', 'Password!123');

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'users', student.user.uid), {
      uid: student.user.uid,
      email: student.email,
      name: '학생1',
      grade: '1',
      class: '2',
      number: '3',
      role: 'student',
      teacherPortalEnabled: false,
      staffPermissions: [],
    });
    await setDoc(doc(adminDb, 'users', teacher.user.uid), {
      uid: teacher.user.uid,
      email: teacher.email,
      name: '교사1',
      grade: '1',
      class: '2',
      number: '0',
      role: 'staff',
      teacherPortalEnabled: true,
      staffPermissions: ['point_read', 'point_manage'],
    });
    await setDoc(doc(adminDb, 'users', reader.user.uid), {
      uid: reader.user.uid,
      email: reader.email,
      name: '열람교사',
      grade: '1',
      class: '2',
      number: '0',
      role: 'staff',
      teacherPortalEnabled: true,
      staffPermissions: ['point_read'],
    });
    await setDoc(doc(adminDb, `${semesterRoot}/point_policies/current`), {
      attendanceDaily: 5,
      lessonView: 3,
      quizSolve: 10,
      manualAdjustEnabled: true,
      allowNegativeBalance: false,
      updatedBy: teacher.user.uid,
    });
    await setDoc(doc(adminDb, `${semesterRoot}/point_products/expensive`), {
      name: '고가 상품',
      description: '테스트용 고가 상품',
      price: 999,
      stock: 1,
      isActive: true,
      sortOrder: 1,
      imageUrl: '',
    });
    await setDoc(doc(adminDb, `${semesterRoot}/point_products/soldout`), {
      name: '품절 상품',
      description: '테스트용 품절 상품',
      price: 10,
      stock: 0,
      isActive: true,
      sortOrder: 2,
      imageUrl: '',
    });
    await setDoc(doc(adminDb, `${semesterRoot}/point_products/gift`), {
      name: '교환 상품',
      description: '테스트용 정상 상품',
      price: 10,
      stock: 5,
      isActive: true,
      sortOrder: 3,
      imageUrl: '',
    });
  });

  const attendanceCallable = httpsCallable(student.functions, 'applyPointActivityReward');
  const purchaseCallable = httpsCallable(student.functions, 'createPointPurchaseRequest');
  const adjustCallable = httpsCallable(teacher.functions, 'adjustTeacherPoints');
  const reviewCallable = httpsCallable(teacher.functions, 'reviewTeacherPointOrder');
  const readerAdjustCallable = httpsCallable(reader.functions, 'adjustTeacherPoints');

  await expectPass('rules: student can read own wallet after wallet exists', async () => {
    await adjustCallable({
      year,
      semester,
      uid: student.user.uid,
      delta: 1,
      sourceId: 'bootstrap',
      sourceLabel: 'bootstrap',
      policyId: 'manual',
    });
    const studentDb = testEnv.authenticatedContext(student.user.uid, { email: student.email }).firestore();
    await assertSucceeds(getDoc(doc(studentDb, `${semesterRoot}/point_wallets/${student.user.uid}`)));
    return 'own wallet read allowed';
  }, results);

  await expectPass('rules: student direct wallet write blocked', async () => {
    const studentDb = testEnv.authenticatedContext(student.user.uid, { email: student.email }).firestore();
    await assertFails(setDoc(doc(studentDb, `${semesterRoot}/point_wallets/${student.user.uid}`), { balance: 999 }));
    return 'direct write denied';
  }, results);

  await expectPass('rules: teacher direct order write blocked', async () => {
    const teacherDb = testEnv.authenticatedContext(teacher.user.uid, { email: teacher.email }).firestore();
    await assertFails(setDoc(doc(teacherDb, `${semesterRoot}/point_orders/manual-test`), { status: 'requested' }));
    return 'teacher direct order write denied';
  }, results);

  await expectPass('A. attendance reward first claim', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'attendance',
      sourceId: 'ignored-by-server',
      sourceLabel: '출석 체크',
    });
    return data.data;
  }, results);

  await expectPass('A. attendance duplicate prevented', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'attendance',
      sourceId: 'ignored-by-server',
      sourceLabel: '출석 체크',
    });
    if (!data.data.duplicate) {
      throw new Error('Expected duplicate attendance reward.');
    }
    return data.data;
  }, results);

  await expectPass('B. quiz reward first submit', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'quiz',
      sourceId: 'quiz_result_1',
      sourceLabel: '퀴즈 완료',
    });
    return data.data;
  }, results);

  await expectPass('B. quiz duplicate prevented', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'quiz',
      sourceId: 'quiz_result_1',
      sourceLabel: '퀴즈 완료',
    });
    if (!data.data.duplicate) {
      throw new Error('Expected duplicate quiz reward.');
    }
    return data.data;
  }, results);

  await expectPass('C. lesson reward first completion', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'lesson',
      sourceId: 'lesson_unit_1',
      sourceLabel: '수업 자료 확인',
    });
    return data.data;
  }, results);

  await expectPass('C. lesson duplicate prevented', async () => {
    const data = await attendanceCallable({
      year,
      semester,
      activityType: 'lesson',
      sourceId: 'lesson_unit_1',
      sourceLabel: '수업 자료 확인',
    });
    if (!data.data.duplicate) {
      throw new Error('Expected duplicate lesson reward.');
    }
    return data.data;
  }, results);

  await expectFail('E. reader teacher cannot adjust points', async () => {
    await readerAdjustCallable({
      year,
      semester,
      uid: student.user.uid,
      delta: 10,
      sourceId: 'unauthorized',
      sourceLabel: '권한 없음',
      policyId: 'manual',
    });
  }, results, ['permission-denied', 'point_manage']);

  await expectFail('E. teacher adjust requires reason', async () => {
    await adjustCallable({
      year,
      semester,
      uid: student.user.uid,
      delta: 10,
      sourceId: 'manual_reason_missing',
      sourceLabel: '',
      policyId: 'manual',
    });
  }, results, ['reason', 'invalid-argument']);

  await expectPass('E. teacher adjust success', async () => {
    const data = await adjustCallable({
      year,
      semester,
      uid: student.user.uid,
      delta: 20,
      sourceId: 'manual_bonus',
      sourceLabel: '테스트 보너스',
      policyId: 'manual',
    });
    return data.data;
  }, results);

  await expectFail('D. purchase fails with insufficient balance', async () => {
    await purchaseCallable({
      year,
      semester,
      productId: 'expensive',
      memo: '부족 테스트',
      requestKey: 'req_insufficient',
    });
  }, results, ['Insufficient point balance', 'failed-precondition']);

  await expectFail('D. purchase fails with sold out product', async () => {
    await purchaseCallable({
      year,
      semester,
      productId: 'soldout',
      memo: '품절 테스트',
      requestKey: 'req_soldout',
    });
  }, results, ['out of stock', 'failed-precondition']);

  let approvedOrderId = '';
  await expectPass('D. purchase request success', async () => {
    const data = await purchaseCallable({
      year,
      semester,
      productId: 'gift',
      memo: '정상 구매',
      requestKey: 'req_success_1',
    });
    approvedOrderId = data.data.orderId;
    return data.data;
  }, results);

  await expectFail('F. direct fulfill from requested is blocked', async () => {
    await reviewCallable({
      year,
      semester,
      orderId: approvedOrderId,
      nextStatus: 'fulfilled',
      memo: '직접 지급 시도',
    });
  }, results, ['reviewable state', 'failed-precondition', 'permission-denied', 'PERMISSION_DENIED']);

  await expectPass('F. approve order success', async () => {
    const data = await reviewCallable({
      year,
      semester,
      orderId: approvedOrderId,
      nextStatus: 'approved',
      memo: '승인 완료',
    });
    return data.data;
  }, results);

  await expectPass('F. fulfill approved order success', async () => {
    const data = await reviewCallable({
      year,
      semester,
      orderId: approvedOrderId,
      nextStatus: 'fulfilled',
      memo: '지급 완료',
    });
    return data.data;
  }, results);

  let rejectedOrderId = '';
  await expectPass('F. create second order for rejection flow', async () => {
    const data = await purchaseCallable({
      year,
      semester,
      productId: 'gift',
      memo: '거절 테스트',
      requestKey: 'req_success_2',
    });
    rejectedOrderId = data.data.orderId;
    return data.data;
  }, results);

  await expectPass('F. reject order success', async () => {
    const data = await reviewCallable({
      year,
      semester,
      orderId: rejectedOrderId,
      nextStatus: 'rejected',
      memo: '거절 처리',
    });
    return data.data;
  }, results);

  let cancelledOrderId = '';
  await expectPass('F. create third order for cancel flow', async () => {
    const data = await purchaseCallable({
      year,
      semester,
      productId: 'gift',
      memo: '취소 테스트',
      requestKey: 'req_success_3',
    });
    cancelledOrderId = data.data.orderId;
    return data.data;
  }, results);

  await expectPass('F. cancel order success', async () => {
    const data = await reviewCallable({
      year,
      semester,
      orderId: cancelledOrderId,
      nextStatus: 'cancelled',
      memo: '취소 처리',
    });
    return data.data;
  }, results);

  const summary = await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    const walletSnap = await getDoc(doc(adminDb, `${semesterRoot}/point_wallets/${student.user.uid}`));
    const approvedOrderSnap = await getDoc(doc(adminDb, `${semesterRoot}/point_orders/${approvedOrderId}`));
    const rejectedOrderSnap = await getDoc(doc(adminDb, `${semesterRoot}/point_orders/${rejectedOrderId}`));
    const cancelledOrderSnap = await getDoc(doc(adminDb, `${semesterRoot}/point_orders/${cancelledOrderId}`));
    const giftProductSnap = await getDoc(doc(adminDb, `${semesterRoot}/point_products/gift`));

    const attendanceCount = await countTransactions(adminDb, student.user.uid, 'attendance');
    const quizCount = await countTransactions(adminDb, student.user.uid, 'quiz');
    const lessonCount = await countTransactions(adminDb, student.user.uid, 'lesson');
    const manualAdjustCount = await countTransactions(adminDb, student.user.uid, 'manual_adjust');

    return {
      walletBalance: walletSnap.data()?.balance,
      attendanceCount,
      quizCount,
      lessonCount,
      manualAdjustCount,
      approvedOrderStatus: approvedOrderSnap.data()?.status,
      rejectedOrderStatus: rejectedOrderSnap.data()?.status,
      cancelledOrderStatus: cancelledOrderSnap.data()?.status,
      giftStock: giftProductSnap.data()?.stock,
    };
  });

  console.log(JSON.stringify({ results, summary }, null, 2));

  await signOut(student.auth);
  await signOut(teacher.auth);
  await signOut(reader.auth);
  await Promise.all(apps.map((app) => deleteApp(app)));
  await testEnv.cleanup();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
