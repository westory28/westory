const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisStockDailyRanking, previousRankingTime } = require(process.env.WIS_STOCK_RANKING_MODULE || '../wisStockDailyRanking');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Firestore emulator is required');
const projectId = process.env.GCLOUD_PROJECT || 'demo-westory-session-wis-stock-trading';
assert(projectId.startsWith('demo-'), 'Synthetic emulator project only');
const app = initializeApp({ projectId }), firestore = getFirestore(app);
const scope = { year: '2026', semester: '2' }, semesterId = '2026-2';
const now = Date.parse('2026-11-23T09:00:00+09:00'), cutoff = previousRankingTime(now);
const root = 'years/2026/semesters/2', head = root + '/wis_stock_student_rankings/current';
const hash = text => createHash('sha256').update(text).digest('hex');
const slotOf = uid => 'slot_' + hash(semesterId + '\n' + uid).slice(0, 40);
let reads = 0;
const db = {
  doc: path => firestore.doc(path),
  runTransaction: (fn, options) => firestore.runTransaction(tx => fn({
    get: async ref => { const result = await tx.get(ref); reads += result.docs ? result.size : 1; return result; },
    getAll: async (...refs) => { const result = await tx.getAll(...refs); reads += result.length; return result; },
    set: () => { throw Error('Ranking reads must never write'); },
    delete: () => { throw Error('Ranking reads must never delete'); },
  }), options),
};
const api = createWisStockDailyRanking({ db, now: () => now, assertSession: async () => ({ uid: 'viewer' }) });
const read = extra => api.getStudentWisStockRanking({ auth: { uid: 'viewer' }, data: { ...scope, filter: 'all', ...extra } });

(async () => {
  const batch = firestore.batch(), base = { schemaVersion: 2, semesterId, ...cutoff };
  const values = {
    'site_settings/config': scope,
    'site_settings/semester_active': { semesterId, revision: 1 },
    ['semester_manifests/' + semesterId]: { semesterId, revision: 1, status: 'ACTIVE' },
    'users/viewer': { role: 'student' },
    'student_identities/viewer': { studentUid: 'viewer' },
    ['semester_enrollment_slots/' + slotOf('viewer')]: { studentUid: 'viewer', semesterId, activeEnrollmentId: 'enrollment-viewer' },
    'semester_enrollments/enrollment-viewer': { studentUid: 'viewer', semesterId, enrollmentId: 'enrollment-viewer', classId: 'class-one', enrollmentStatus: 'ACTIVE' },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE', grade: 3, classNumber: 1 },
    [root + '/wis_stock_public/current']: { semesterId, studentOpen: true, halted: false },
    [head]: { ...base, generation: cutoff.dayKey + '-v2', total: 65,
      classes: [{ key: '3_1', label: '3학년 1반', count: 55 }, { key: '3_2', label: '3학년 2반', count: 10 }] },
  };
  for (const [path, data] of Object.entries(values)) batch.set(firestore.doc(path), data);
  for (let rank = 1; rank <= 65; rank++) {
    const uid = 'synthetic-' + rank, enrollmentId = 'enrollment-' + rank;
    batch.set(firestore.doc('semester_enrollment_slots/' + slotOf(uid)), { semesterId, activeEnrollmentId: enrollmentId });
    batch.set(firestore.doc(`${head}/snapshots/${cutoff.dayKey}-v2/entries/${rank}`), {
      ...base, globalRank: rank, classRank: rank <= 55 ? rank : rank - 55, classKey: rank <= 55 ? '3_1' : '3_2',
      displayName: '합성학생' + rank, returnPercent: 100 - rank, accountId: 'wisacct_' + hash(semesterId + '\n' + uid),
      studentUid: uid, slotId: slotOf(uid), enrollmentId, holdingValue: 200 - rank, holdingCostBasis: 100,
      ...(rank <= 5 ? { points: [{ atMs: cutoff.asOfMs, returnPercent: 100 - rank }] } : {}),
    });
  }
  await batch.commit();
  let page = await read(), rows = [...page.rows];
  assert.equal(page.charts.length, 5); assert.equal(page.rows.length, 10);
  while (page.hasMore) {
    reads = 0; page = await read({ cursor: page.nextCursor }); rows.push(...page.rows);
    assert.equal(page.rows.length, 10); assert.equal(page.charts.length, 0); assert.equal(reads, 30);
  }
  assert.equal(rows.length, 50); assert.equal(rows.at(-1).rank, 50);
  page = await read({ filter: 'my-class' }); rows = [...page.rows];
  while (page.hasMore) { page = await read({ filter: 'my-class', cursor: page.nextCursor }); rows.push(...page.rows); }
  assert.equal(rows.length, 55); assert.equal(rows.at(-1).rank, 55);
  const second = await read({ filter: '3_2', chartCount: 0 });
  assert.equal(second.rows.length, 10); assert.equal(second.rows[0].entryId, '56'); assert.equal(second.rows[0].rank, 1);
  assert.equal(second.hasMore, false);
  await assert.rejects(read({ entryId: '51', dayKey: cutoff.dayKey }));
  await firestore.doc('semester_enrollment_slots/' + slotOf('synthetic-1')).update({ status: 'RETIRED' });
  await assert.rejects(read({ entryId: '1', dayKey: cutoff.dayKey }));
  await firestore.doc(root + '/wis_stock_public/current').update({ halted: true });
  await assert.rejects(read(), error => error.code === 'permission-denied');
  console.log('PASS actual Firestore queries: 10-row cursors, global 50, class 55/10, 30 reads per next page, no reader writes, closed/retired denial');
})().finally(async () => { await firestore.terminate(); await deleteApp(app); }).catch(error => { console.error(error); process.exitCode = 1; });
