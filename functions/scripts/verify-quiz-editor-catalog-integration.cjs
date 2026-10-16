const assert = require('node:assert/strict');

const projectId = 'demo-westory-session-quiz-catalog';
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) {
  throw new Error('Run only with the dedicated local demo quiz-catalog Firestore emulator.');
}
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';

// Load the actual exported callable, with its real session/maintenance guards.
const deployed = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const db = getFirestore();
const now = Date.now();
const authTime = Math.floor(now / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const uid = `quiz-catalog-teacher-${now}`;
const root = 'years/2026/semesters/2/quiz_questions';
const sessionPath = `application_sessions/${uid}/sessions/${authTime}`;
const seed = {
  [`users/${uid}`]: { role: 'teacher', registrationApprovalStatus: 'APPROVED' },
  [sessionPath]: {
    status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration,
    protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE',
    generalExpiresAt: Timestamp.fromMillis(now + 3600000),
  },
  'site_settings/config': { year: '2026', semester: '2', activeSemesterId: '2026-2' },
  'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
  'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
  [`${root}/${now}`]: {
    id: now, unitId: 'catalog-integration-unit', category: 'diagnostic', subUnitId: null,
    question: '질문', passage: '자료', explanation: '해설 검색', concepts: ['개념'],
    type: 'choice', answer: '정답', options: ['정답', '오답'], contentRevision: 1,
    image: 'data:image/png;base64,' + 'a'.repeat(500000), createdAt: Timestamp.fromMillis(now),
  },
  [`${root}/${now + 1}`]: {
    id: now + 1, unitId: 'other-unit', category: 'formative', question: '범위 밖 문항', contentRevision: 1,
  },
};
const request = {
  auth: { uid, token: { email: 'catalog-teacher@yongshin-ms.ms.kr', auth_time: authTime } },
  data: { semesterId: '2026-2', unitId: 'catalog-integration-unit', _session: proof },
};

(async () => {
  try {
    const batch = db.batch();
    for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data);
    await batch.commit();
    const result = await deployed.getQuizEditorCatalog.run(request);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].documentId, String(now));
    assert.equal(result.entries[0].createdAt, now);
    assert.equal(result.entries[0].subUnitId, null);
    assert.equal(result.entries[0].searchText, '질문 해설 검색 자료 개념');
    assert.equal(Object.hasOwn(result.entries[0], 'image'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1000);
    await db.doc(`users/${uid}`).update({ role: 'student' });
    await assert.rejects(deployed.getQuizEditorCatalog.run(request), (error) => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ role: 'teacher' });
    await db.doc(sessionPath).update({ status: 'revoked' });
    await assert.rejects(deployed.getQuizEditorCatalog.run(request), (error) => error.code === 'unauthenticated');
    console.log('PASS actual callable + Firestore projected stream, exact unit, timestamps, student denial and revoked session');
  } finally {
    const batch = db.batch();
    for (const path of Object.keys(seed)) batch.delete(db.doc(path));
    await batch.commit();
    await db.terminate();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
