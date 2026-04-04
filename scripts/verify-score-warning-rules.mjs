import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from 'firebase/firestore';

const projectId = 'demo-westory-score-warning';
const rules = readFileSync(resolve('firestore.rules'), 'utf8');
const authHost = 'http://127.0.0.1:9099';
const firestoreHost = '127.0.0.1';
const firestorePort = 8080;

const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};

const apps = [];

const createClient = async (name, email, password) => {
  const app = initializeApp(firebaseConfig, name);
  apps.push(app);

  const auth = getAuth(app);
  connectAuthEmulator(auth, authHost, { disableWarnings: true });

  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreHost, firestorePort);

  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return {
    app,
    auth,
    db,
    user: userCredential.user,
    email,
  };
};

const existingStudentDoc = (uid, email) => ({
  uid,
  email,
  photoURL: '',
  role: 'student',
  staffPermissions: [],
  teacherPortalEnabled: false,
  name: '기존학생',
  customNameConfirmed: true,
  grade: '2',
  class: '6',
  number: '10',
  privacyAgreed: true,
  privacyAgreedAt: 'seed-privacy',
  consentAgreedItems: ['privacy'],
  profileIcon: '😀',
  profileEmojiId: 'smile',
  createdAt: 'seed-created',
  updatedAt: 'seed-updated',
  lastLogin: 'seed-login',
});

const newStudentDoc = (uid, email) => ({
  uid,
  email,
  photoURL: '',
  role: 'student',
  staffPermissions: [],
  teacherPortalEnabled: false,
  name: '신규학생',
  grade: '1',
  class: '2',
  number: '3',
  privacyAgreed: true,
  consentAgreedItems: ['privacy', 'score-warning'],
  profileIcon: '😀',
  profileEmojiId: 'smile',
  scoreWarningAcknowledged: true,
  scoreWarningAcknowledgedAt: 'seed-warning',
  createdAt: 'seed-created',
  updatedAt: 'seed-updated',
  lastLogin: 'seed-login',
});

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules,
    },
  });

  await testEnv.clearFirestore();

  const existingStudent = await createClient('score-warning-existing', 'existing.student@yongshin-ms.ms.kr', 'Password!123');
  const newStudent = await createClient('score-warning-new', 'new.student@yongshin-ms.ms.kr', 'Password!123');
  const otherStudent = await createClient('score-warning-other', 'other.student@yongshin-ms.ms.kr', 'Password!123');

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(
      doc(adminDb, 'users', existingStudent.user.uid),
      existingStudentDoc(existingStudent.user.uid, existingStudent.email),
    );
    await setDoc(
      doc(adminDb, 'users', otherStudent.user.uid),
      existingStudentDoc(otherStudent.user.uid, otherStudent.email),
    );
  });

  await assertSucceeds(
    setDoc(
      doc(existingStudent.db, 'users', existingStudent.user.uid),
      {
        scoreWarningAcknowledged: true,
        scoreWarningAcknowledgedAt: 'warning-updated',
        updatedAt: 'updated-now',
        consentAgreedItems: ['privacy', 'score-warning'],
      },
      { merge: true },
    ),
  );

  const updatedSnap = await getDoc(doc(existingStudent.db, 'users', existingStudent.user.uid));
  const updatedData = updatedSnap.data() || {};
  if (updatedData.profileEmojiId !== 'smile' || updatedData.scoreWarningAcknowledged !== true) {
    throw new Error('Existing student update did not preserve profileEmojiId or warning fields.');
  }

  await assertSucceeds(
    setDoc(doc(newStudent.db, 'users', newStudent.user.uid), newStudentDoc(newStudent.user.uid, newStudent.email)),
  );

  await assertFails(
    setDoc(
      doc(existingStudent.db, 'users', existingStudent.user.uid),
      {
        legacyExtra: true,
        updatedAt: 'invalid-extra',
      },
      { merge: true },
    ),
  );

  await assertFails(
    setDoc(
      doc(otherStudent.db, 'users', existingStudent.user.uid),
      {
        scoreWarningAcknowledged: true,
        updatedAt: 'cross-user-update',
      },
      { merge: true },
    ),
  );

  console.log(
    JSON.stringify(
      {
        projectId,
        checks: [
          'existing student warning update with profileEmojiId passes',
          'new student bootstrap create with profileEmojiId passes',
          'unexpected extra key remains blocked',
          'cross-user update remains blocked',
        ],
      },
      null,
      2,
    ),
  );

  await Promise.all(apps.map((app) => deleteApp(app)));
  await testEnv.cleanup();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
