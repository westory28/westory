const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const projectId = 'demo-westory-session-weekly-rewards';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '') || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw new Error('Dedicated local weekly reward emulator required');
process.env.GCLOUD_PROJECT = projectId;
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const { initializeApp } = require('firebase-admin/app'); initializeApp({ projectId });
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const path = require('node:path');
const sourceRoot = process.env.WEPLAY_RANKING_SOURCE_ROOT || path.resolve(__dirname, '..');
const { createWeplayWeeklyRewardHandlers, normalizeTiers, selection, planIdFor, SETTLEMENT_GRACE_MS } = require(path.join(sourceRoot, 'weplayWeeklyRewards'));
const { accountIdFor } = require(path.join(sourceRoot, 'studentWisWallet'));
const { weekAt } = require(path.join(sourceRoot, 'weplayRankingStore'));
const db = getFirestore(), scope = { year: '2026', semester: '2' }, semesterId = '2026-2', base = 'years/2026/semesters/2';
const hash = value => createHash('sha256').update(value).digest('hex');
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
let atMs = Date.parse('2026-11-17T12:00:00+09:00'), counts = { reads: 0, writes: 0 };
const reset = () => { counts = { reads: 0, writes: 0 }; };
const measured = { collection: path => db.collection(path), doc: path => db.doc(path), runTransaction: (fn, options) => db.runTransaction(tx => fn(new Proxy(tx, { get(target, key) {
  if (key === 'get') return async ref => { counts.reads++; return target.get(ref); };
  if (key === 'getAll') return async (...refs) => { counts.reads += refs.length; return target.getAll(...refs); };
  if (['set', 'create', 'update', 'delete'].includes(key)) return (...args) => { counts.writes++; return target[key](...args); };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
} })), options) };
const api = createWeplayWeeklyRewardHandlers({ db: measured, now: () => atMs });
const req = (uid = 'manager', data = {}) => ({ auth: { uid, token: { email: uid === 'manager' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { ...scope, _session: proof, gameId: 'joseon-yut', category: 'wins', weekId: weekAt(atMs).id, ...data } });
const balance = async uid => (await db.doc(`semester_wis_accounts/${accountIdFor(semesterId, uid)}`).get()).data().balance;
async function seed() {
  assert.ok((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok);
  const docs = {
    'site_settings/config': scope, 'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE' },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
  };
  for (const uid of ['a', 'b', 'c', 'd', 'manager', 'reader']) {
    docs[`users/${uid}`] = { role: uid === 'manager' ? 'teacher' : uid === 'reader' ? 'staff' : 'student', name: '합성검증', registrationApprovalStatus: 'APPROVED', ...(uid === 'reader' ? { teacherPortalEnabled: true, staffPermissions: ['lesson_read', 'lesson_write'] } : {}) };
    docs[`application_sessions/${uid}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    if (['a', 'b', 'c', 'd'].includes(uid)) {
      const accountId = accountIdFor(semesterId, uid);
      docs[`student_identities/${uid}`] = { studentUid: uid, accountStatus: 'ACTIVE' };
      docs[`semester_enrollment_slots/slot_${hash(semesterId + '\n' + uid).slice(0, 40)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `enrollment-${uid}`, status: 'ACTIVE' };
      docs[`semester_enrollments/enrollment-${uid}`] = { enrollmentId: `enrollment-${uid}`, semesterId, studentUid: uid, classId: 'class-one', enrollmentStatus: 'ACTIVE' };
      docs[`semester_wis_accounts/${accountId}`] = { schemaVersion: 1, policyVersion: 'w7-v1', accountId, semesterId, studentUid: uid, classId: 'class-one', enrollmentId: `enrollment-${uid}`, status: 'ACTIVE', revision: 1, balance: 100, earnedTotal: 0, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] };
    }
  }
  const batch = db.batch(); Object.entries(docs).forEach(([path, data]) => batch.set(db.doc(path), data)); await batch.commit(); reset();
}
async function main() {
  await seed();
  for (const value of [[{ throughRank: 0, wis: 1 }], [{ throughRank: 51, wis: 1 }], [{ throughRank: 1, wis: 1.1 }], [{ throughRank: 2, wis: 1 }, { throughRank: 1, wis: 2 }]]) assert.throws(() => normalizeTiers(value));
  const get = await api.getWeplayWeeklyRewards(req()); assert.equal(get.revision, 0); assert.equal(counts.writes, 0);
  const data = { revision: 0, requestId: randomUUID(), tiers: [{ throughRank: 1, wis: 100 }, { throughRank: 4, wis: 40 }] };
  await assert.rejects(api.saveWeplayWeeklyRewards(req('a', data)), error => error.code === 'permission-denied');
  await assert.rejects(api.saveWeplayWeeklyRewards(req('reader', data)), error => error.code === 'permission-denied');
  await assert.rejects(api.saveWeplayWeeklyRewards(req('manager', { ...data, weekId: '2026-11-17' })), error => error.code === 'invalid-argument');
  reset(); const saved = await api.saveWeplayWeeklyRewards(req('manager', data)); assert.equal(saved.revision, 1); const saveCounts = { ...counts }; assert.equal(counts.writes, 3);
  reset(); await api.saveWeplayWeeklyRewards(req('manager', data)); assert.equal(counts.writes, 0); const retryCounts = { ...counts };
  await assert.rejects(api.saveWeplayWeeklyRewards(req('manager', { ...data, tiers: [{ throughRank: 1, wis: 5 }] })), error => error.code === 'invalid-argument');
  reset(); await api.saveWeplayWeeklyRewards(req('manager', { ...data, revision: 1, requestId: randomUUID() })); assert.equal(counts.writes, 0);
  await assert.rejects(api.saveWeplayWeeklyRewards(req('manager', { ...data, requestId: randomUUID(), tiers: [] })), error => error.code === 'aborted');
  const selected = selection(req().data), planId = planIdFor(selected), queueRef = db.collection('weplay_weekly_reward_queue');
  await db.doc(`${base}/weplay_weekly_rankings/${planId}`).set({ rows: ['a', 'b', 'c', 'd'].map((uid, index) => ({ uid, score: 10 - index })) });
  assert.equal((await api.settleWeplayWeeklyRewards()).plans, 0); assert.equal(await balance('a'), 100);
  atMs = selected.week.endsAtMs + SETTLEMENT_GRACE_MS;
  // Retry after one winner was paid and another account temporarily blocks.
  await db.doc(`semester_wis_accounts/${accountIdFor(semesterId, 'b')}`).update({ readOnly: true });
  await db.doc('users/d').update({ isDeleted: true });
  const failure = await api.settleWeplayWeeklyRewards(); assert.equal(failure.failed, 1); assert.equal(await balance('a'), 200); assert.equal(await balance('b'), 100);
  await db.doc(`semester_wis_accounts/${accountIdFor(semesterId, 'b')}`).update({ readOnly: false });
  assert.equal(await balance('c'), 140, 'a blocked earlier account must not block later winners');
  atMs += 15 * 60000;
  const queue = (await queueRef.get()).docs[0];
  await Promise.all([api.settlePlan(queue.ref), api.settlePlan(queue.ref)]);
  assert.equal(await balance('a'), 200); assert.equal(await balance('b'), 140); assert.equal(await balance('c'), 140); assert.equal(await balance('d'), 100);
  assert.equal((await db.collection('semester_wis_ledger').get()).size, 3);
  const settled = (await db.doc(`${base}/weplay_weekly_rewards/${planId}`).get()).data();
  assert.equal(settled.status, 'paid'); assert.equal(settled.paidCount, 3); assert.equal(settled.paidWis, 180); assert.equal(settled.skippedCount, 1);
  assert.equal((await queueRef.get()).size, 0);
  reset(); await api.settlePlan(queue.ref); assert.equal(counts.writes, 0);
  await assert.rejects(api.saveWeplayWeeklyRewards(req('manager', { ...data, weekId: selected.week.id, revision: 1, requestId: randomUUID() })), error => error.code === 'failed-precondition');
  // The durable due queue drains all configured categories across bounded runs.
  atMs = selected.week.startsAtMs + 86400000;
  for (const category of ['mild', 'medium', 'spicy']) await api.saveWeplayWeeklyRewards(req('manager', { ...data, gameId: 'history-rain', category, requestId: randomUUID() }));
  await api.saveWeplayWeeklyRewards(req('manager', { ...data, gameId: 'gungdeok-rock', category: 'arirang:normal', requestId: randomUUID() }));
  atMs = selected.week.endsAtMs + SETTLEMENT_GRACE_MS;
  assert.equal((await api.settleWeplayWeeklyRewards()).completed, 4); assert.equal((await queueRef.get()).size, 0);
  console.log(JSON.stringify({ result: 'PASS weekly reward authority, no-op, CAS, duplicate save, partial failure, concurrent retry, exact tier payouts, deleted user, week cutoff and due queue', save: saveCounts, retry: retryCounts, sessionGuardReadsAdditional: 3 }));
}
main().then(() => db.terminate()).catch(error => { console.error(error); process.exitCode = 1; return db.terminate(); });
