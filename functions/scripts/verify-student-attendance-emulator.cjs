const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createStudentAttendanceHandler, accountIdFor } = require('../studentAttendance');

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Run only against a local Firestore emulator.');
}
process.env.GCLOUD_PROJECT = 'demo-westory-session-attendance';
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore(app);
const now = new Date('2026-09-30T03:00:00Z');
const authTime = Math.floor(now.getTime() / 1000) - 60;
const scope = '2026-2';
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'b'.repeat(64) };
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function seed(uid, history = false) {
  const accountId = accountIdFor(scope, uid);
  const batch = db.batch();
  const set = (path, value) => batch.set(db.doc(path), value);
  set('site_settings/config', { year: '2026', semester: '2' });
  set('site_settings/semester_active', { semesterId: scope, revision: 1 });
  set('semester_manifests/' + scope, { semesterId: scope, status: 'ACTIVE', revision: 1 });
  set('semester_wis_economies/' + scope, { semesterId: scope, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 });
  set('years/2026/semesters/2/point_policies/current', { attendanceDaily: 75, attendanceMonthlyBonus: 1000 });
  set('users/' + uid, { role: 'student' });
  set('student_identities/' + uid, { studentUid: uid, accountStatus: 'ACTIVE' });
  set('semester_enrollment_slots/slot_' + hash(scope + '\n' + uid).slice(0, 40), {
    semesterId: scope, studentUid: uid, activeEnrollmentId: 'enrollment-' + uid,
  });
  set('semester_enrollments/enrollment-' + uid, {
    enrollmentId: 'enrollment-' + uid, semesterId: scope, studentUid: uid, enrollmentStatus: 'ACTIVE', classId: 'class-attendance',
  });
  set('semester_classes/class-attendance', { semesterId: scope, classId: 'class-attendance', status: 'ACTIVE' });
  set('semester_wis_accounts/' + accountId, {
    schemaVersion: 1, policyVersion: 'w7-v1', accountId, studentUid: uid, semesterId: scope,
    enrollmentId: 'enrollment-' + uid, classId: 'class-attendance', status: 'ACTIVE', revision: 1,
    balance: 0, earnedTotal: 0, rankEarnedTotal: 0, adjustedTotal: 0, spentTotal: 0, recentLedgerEntries: [],
  });
  set('application_sessions/' + uid + '/sessions/' + authTime, {
    schemaVersion: 2, status: 'active', authTime, authorityGeneration: proof.authorityGeneration,
    protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE',
    generalExpiresAt: Timestamp.fromMillis(now.getTime() + 60000),
  });
  if (history) {
    for (let day = 1; day < 30; day++) {
      const date = '2026-09-' + String(day).padStart(2, '0');
      set('users/' + uid + '/attendance/2026_2_' + date, {
        uid, scope: '2026_2', year: '2026', semester: '2', date, rewardProcessed: true,
      });
    }
  }
  await batch.commit();
  return { auth: { uid, token: { email: 'test@yongshin-ms.ms.kr', auth_time: authTime } }, data: { year: '2026', semester: '2', _session: proof } };
}

(async () => {
  const handler = createStudentAttendanceHandler({ db, now: () => now });
  const uid = 'attendance-emulator-' + Date.now();
  const request = await seed(uid, true);
  const results = await Promise.all([handler(request), handler(request), handler(request)]);
  assert.equal(results.reduce((sum, result) => sum + result.totalAwarded, 0), 1075);
  assert.equal(results.filter((result) => result.duplicate).length, 2);
  const accountId = accountIdFor(scope, uid);
  const account = (await db.doc('semester_wis_accounts/' + accountId).get()).data();
  const balance = (await db.doc('semester_wis_balances/' + accountId).get()).data();
  const rank = (await db.doc('semester_wis_rankings/' + accountId).get()).data();
  assert.equal(account.balance, 1075);
  assert.equal(account.earnedTotal, 1075);
  assert.equal(account.rankEarnedTotal, 1075);
  assert.equal(account.adjustedTotal, 1075);
  assert.equal(account.revision, 2);
  assert.equal(balance.ledgerRevision, 2);
  assert.equal(rank.ledgerRevision, 2);
  const ledger = await db.collection('semester_wis_ledger').where('studentUid', '==', uid).get();
  assert.equal(ledger.size, 2);
  assert.ok(ledger.docs.every((doc) => doc.data().createdAt instanceof Timestamp));
  assert.ok(ledger.docs.every((doc) => doc.data().actorRole === 'system'));
  const attendance = (await db.doc('users/' + uid + '/attendance/2026_2_2026-09-30').get()).data();
  assert.equal(attendance.rewardProcessed, true);
  assert.equal(attendance.rewardLedgerIds.length, 2);

  const budgetUid = uid + '-read-budget', budgetRequest = await seed(budgetUid, true);
  const budgetAccountId = accountIdFor(scope, budgetUid);
  const noise = db.batch();
  for (let index = 0; index < 125; index++) {
    noise.set(db.doc(`years/2026/semesters/2/point_transactions/${budgetUid}-noise-${index}`), {
      uid: budgetUid, type: 'quiz', sourceId: `quiz-${index}`,
    });
    const common = { studentUid: budgetUid, semesterId: scope, accountId: budgetAccountId,
      type: 'GRANT', activityType: 'lesson', sourceId: `lesson-${index}` };
    noise.set(db.doc(`semester_wis_ledger/${budgetUid}-activity-${index}`), common);
    noise.set(db.doc(`semester_wis_ledger/${budgetUid}-scope-${index}`), { ...common, semesterId: '2026-1', activityType: 'attendance' });
    noise.set(db.doc(`semester_wis_ledger/${budgetUid}-type-${index}`), { ...common, type: 'DEDUCT', activityType: 'attendance' });
  }
  await noise.commit();
  const historyReads = [];
  const measuredDb = {
    doc: (...args) => db.doc(...args), collection: (...args) => db.collection(...args),
    runTransaction: callback => db.runTransaction(tx => callback({
      get: async ref => {
        const snapshot = await tx.get(ref);
        if (Array.isArray(snapshot.docs)) historyReads.push(snapshot.docs.map(doc => doc.ref.path));
        return snapshot;
      },
      getAll: (...refs) => tx.getAll(...refs), set: (...args) => tx.set(...args), create: (...args) => tx.create(...args),
    })),
  };
  const budgetResult = await createStudentAttendanceHandler({ db: measuredDb, now: () => now })(budgetRequest);
  assert.equal(budgetResult.totalAwarded, 1075); assert.equal(budgetResult.claimCount, 30);
  assert.equal(historyReads.length, 5);
  assert.equal(historyReads.flat().length, 29, 'Actual Firestore queries read only confirmed dates, excluding all 500 unrelated trades');
  assert.ok(historyReads.flat().every(path => path.startsWith(`users/${budgetUid}/attendance/`)));
  assert.equal((await db.doc(`semester_wis_accounts/${budgetAccountId}`).get()).data().balance, 1075);

  const historicalUid = uid + '-missing-metadata', historicalRequest = await seed(historicalUid, true);
  const historicalAccountId = accountIdFor(scope, historicalUid), historicalBatch = db.batch();
  for (const [index, sourceId] of ['attendance:2026-09-30', 'attendance-monthly:2026-09'].entries()) {
    historicalBatch.set(db.doc(`semester_wis_ledger/${historicalUid}-legacy-id-${index}`), {
      studentUid: historicalUid, semesterId: scope, accountId: historicalAccountId, type: 'GRANT', sourceId,
    });
  }
  await historicalBatch.commit();
  const repaired = await handler(historicalRequest);
  assert.equal(repaired.totalAwarded, 0, 'Arbitrary historical grant IDs without activityType still suppress repayment');
  assert.equal(repaired.claimCount, 30);
  assert.equal((await db.doc(`semester_wis_accounts/${historicalAccountId}`).get()).data().revision, 1);
  assert.equal((await db.doc(`users/${historicalUid}/attendance/2026_2_2026-09-30`).get()).data().rewardProcessed, true);

  // A revoked session must leave both attendance and financial state untouched.
  await db.doc('application_sessions/' + uid + '/sessions/' + authTime).update({ status: 'revoked' });
  await assert.rejects(handler(request), (error) => error.code === 'unauthenticated');
  assert.equal((await db.doc('semester_wis_accounts/' + accountId).get()).data().revision, 2);
  console.log('PASS real Firestore transactions: concurrent 75+1000 awarded once, atomic projections/record, revoked-session rejection; 529 to 29 history reads; missing historical activity metadata preserved');
})().finally(() => deleteApp(app)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
