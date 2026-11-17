const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const projectId = 'demo-westory-session-rhythm-challenge';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local Firestore emulator required.');
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
require('firebase-admin/app').initializeApp({ projectId });
const { getFirestore, Timestamp, DocumentReference } = require('firebase-admin/firestore');
const sourceRoot = process.env.WEPLAY_RANKING_SOURCE_ROOT ? path.resolve(process.env.WEPLAY_RANKING_SOURCE_ROOT) : path.resolve(__dirname, '..');
const fromSource = file => require(path.join(sourceRoot, file));
const { createWeplayRankingHandlers, replayChallenge } = fromSource('weplayRanking');
const { createChart, replayRhythmPerformance } = fromSource('rhythmRankingCore/rhythmCore');
const { RHYTHM_SONGS } = fromSource('rhythmRankingCore/rhythmSongs');
const { accountIdFor } = fromSource('studentWisWallet');
const { weekAt, weeklyBoardId } = fromSource('weplayRankingStore');
const { readSettings, challengeFor } = fromSource('rhythmChallenge');
const db = getFirestore(), scope = { year: '2026', semester: '2' }, semesterId = '2026-2', base = 'years/2026/semesters/2';
const hash = value => createHash('sha256').update(value).digest('hex');
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
let atMs = Date.parse('2026-11-17T03:00:00Z');
let metrics = { reads: 0, writes: 0, guardReads: 0 };
const reset = () => { metrics = { reads: 0, writes: 0, guardReads: 0 }; };
const guard = new AsyncLocalStorage(), originalGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = function (...args) { if (guard.getStore()) metrics.guardReads++; return originalGet.apply(this, args); };
const assertSession = request => guard.run(true, () => fromSource('scoreWorkflowGuard').assertScoreWorkflowSession(request));
const instrumented = {
  doc: value => new Proxy(db.doc(value), { get(target, key) {
    if (key === 'get') return async () => { metrics.reads++; return target.get(); };
    const field = target[key]; return typeof field === 'function' ? field.bind(target) : field;
  } }),
  getAll: async (...refs) => { metrics.reads += refs.length; return db.getAll(...refs); },
  runTransaction: callback => db.runTransaction(transaction => callback(new Proxy(transaction, { get(target, key) {
    if (key === 'getAll') return async (...refs) => { metrics.reads += refs.length; return target.getAll(...refs); };
    if (key === 'get') return async ref => { metrics.reads++; return target.get(ref); };
    if (['create', 'set', 'update', 'delete'].includes(key)) return (...args) => { metrics.writes++; return target[key](...args); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))),
};
const api = createWeplayRankingHandlers({ db: instrumented, assertSession, now: () => atMs });
const request = (uid, data = {}) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { ...scope, _session: proof, ...data } });
const get = async path => (await db.doc(path).get()).data();
const accountPath = uid => `semester_wis_accounts/${accountIdFor(semesterId, uid)}`;
const counts = {};
async function measure(name, action) { reset(); const result = await action(); counts[name] = { ...metrics }; return result; }
async function deny(action, code) { await assert.rejects(action, error => error.code === code); }
async function seed() {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const docs = {
    'site_settings/config': scope,
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, revision: 1, status: 'ACTIVE' },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE', grade: '3', classNumber: '1' },
    [`${base}/rhythm_publication/gungdeok-rock`]: { schemaVersion: 1, revision: 1, enabled: true, updatedAt: Timestamp.now() },
  };
  for (const uid of ['a', 'b', 'poor', 'teacher', 'staff']) {
    docs[`users/${uid}`] = { role: uid === 'teacher' ? 'teacher' : uid === 'staff' ? 'staff' : 'student', name: '합성학생', studentNumber: '1', registrationApprovalStatus: 'APPROVED', ...(uid === 'staff' ? { teacherPortalEnabled: true, staffPermissions: ['lesson_read'] } : {}) };
    docs[`application_sessions/${uid}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    docs[`student_identities/${uid}`] = { studentUid: uid, accountStatus: 'ACTIVE' };
    docs[`semester_enrollment_slots/slot_${hash(semesterId + '\n' + uid).slice(0, 40)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `en-${uid}`, status: 'ACTIVE' };
    docs[`semester_enrollments/en-${uid}`] = { semesterId, studentUid: uid, enrollmentId: `en-${uid}`, enrollmentStatus: 'ACTIVE', classId: 'class-one' };
    docs[accountPath(uid)] = { schemaVersion: 1, policyVersion: 'w7-v1', accountId: accountIdFor(semesterId, uid), semesterId, studentUid: uid, enrollmentId: `en-${uid}`, classId: 'class-one', status: 'ACTIVE', revision: 1, balance: uid === 'poor' ? 49 : 200, earnedTotal: 0, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] };
    docs[`${base}/point_wallets/${uid}`] = { balance: 9999 };
  }
  const batch = db.batch();
  for (const [path, value] of Object.entries(docs)) batch.set(db.doc(path), value);
  await batch.commit();
}
const selection = () => challengeFor(readSettings(), weekAt(atMs));
const startData = (extra = {}) => ({ challengeVersion: 1, requestId: randomUUID(), songId: selection().songId, difficulty: 'normal', paid: false, ...extra });
async function main() {
  await seed();
  let state = await measure('studentState', () => api.getRhythmChallengeState(request('a')));
  assert.equal(state.freeRemaining, 3); assert.equal(state.missLimit, 30); assert.deepEqual(state.allowedDifficulties, ['normal', 'hard']);
  assert.equal(metrics.writes, 0);
  await measure('teacherState', () => api.getRhythmChallengeState(request('teacher'))); assert.equal(metrics.writes, 0);
  const firstData = startData();
  const first = await measure('freeStart', () => api.startRhythmRankingGame(request('a', firstData)));
  assert.equal(first.freeRemaining, 2); assert.equal(first.chargedCost, 0); assert.equal(metrics.writes, 2);
  const replay = await measure('freeRetry', () => api.startRhythmRankingGame(request('a', firstData)));
  assert.deepEqual(replay, first); assert.equal(metrics.writes, 0);
  for (let i = 0; i < 2; i++) { atMs += 6000; await api.startRhythmRankingGame(request('a', startData())); }
  atMs += 6000;
  await measure('unacceptedCharge', () => deny(api.startRhythmRankingGame(request('a', startData())), 'failed-precondition')); assert.equal(metrics.writes, 0);
  const paidData = startData({ paid: true });
  const paid = await measure('paidStart', () => api.startRhythmRankingGame(request('a', paidData)));
  assert.equal(paid.chargedCost, 50); assert.equal(metrics.writes, 7); assert.equal((await get(accountPath('a'))).balance, 150);
  await measure('paidRetry', () => api.startRhythmRankingGame(request('a', paidData))); assert.equal(metrics.writes, 0);
  const ledger = (await db.collection('semester_wis_ledger').where('studentUid', '==', 'a').get()).docs.map(doc => doc.data());
  assert.equal(ledger.length, 1); assert.equal(ledger[0].delta, -50); assert.equal(ledger[0].activityType, 'rhythm_challenge_cost');
  assert.equal((await get(ledger[0].receiptId)).balanceAfter, 150); assert.equal((await get(`${base}/point_wallets/a`)).balance, 9999);
  atMs += 6000;
  const parallel = await Promise.allSettled([api.startRhythmRankingGame(request('a', startData({ paid: true }))), api.startRhythmRankingGame(request('a', startData({ paid: true })))]);
  assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1); assert.equal((await get(accountPath('a'))).balance, 100);
  await db.doc(`${base}/rhythm_players/poor`).set({ challengeDayId: state.dayId, challengeDailyUsed: 3 });
  await measure('insufficientBalance', () => deny(api.startRhythmRankingGame(request('poor', startData({ paid: true }))), 'failed-precondition')); assert.equal(metrics.writes, 0);
  assert.equal((await get(`${base}/rhythm_players/poor`)).challengeDailyUsed, 3);
  await deny(api.startRhythmRankingGame(request('a', startData({ difficulty: 'easy' }))), 'invalid-argument');
  await deny(api.startRhythmRankingGame(request('teacher', startData())), 'permission-denied');
  await deny(api.startRhythmRankingGame(request('b', startData({ songId: RHYTHM_SONGS.find(song => song.id !== selection().songId).id }))), 'failed-precondition');
  await db.doc(`${base}/rhythm_publication/gungdeok-rock`).update({ enabled: false });
  await deny(api.getRhythmChallengeState(request('a')), 'permission-denied');
  await deny(api.startRhythmRankingGame(request('a', paidData)), 'permission-denied');
  await api.getRhythmChallengeState(request('teacher'));
  await db.doc(`${base}/rhythm_publication/gungdeok-rock`).update({ enabled: true });
  state = await api.getRhythmChallengeState(request('teacher'));
  const saveData = { requestId: randomUUID(), weekId: state.weekId, expectedRevision: state.revision, selection: 'manual', songId: 'arirang', missLimit: 2 };
  const saved = await measure('settingsSave', () => api.saveRhythmChallengeSettings(request('teacher', saveData)));
  assert.equal(saved.revision, 1); assert.equal(saved.songId, 'arirang'); assert.equal(metrics.writes, 2);
  await measure('settingsRetry', () => api.saveRhythmChallengeSettings(request('teacher', saveData))); assert.equal(metrics.writes, 0);
  await measure('settingsNoChange', () => api.saveRhythmChallengeSettings(request('teacher', { ...saveData, requestId: randomUUID(), expectedRevision: 1 }))); assert.equal(metrics.writes, 0);
  await deny(api.saveRhythmChallengeSettings(request('staff', { ...saveData, requestId: randomUUID() })), 'permission-denied');
  await deny(api.saveRhythmChallengeSettings(request('a', { ...saveData, requestId: randomUUID() })), 'permission-denied');
  await deny(api.saveRhythmChallengeSettings(request('teacher', { ...saveData, requestId: randomUUID(), missLimit: 4 })), 'aborted');
  const early = await api.startRhythmRankingGame(request('b', startData({ songId: 'arirang' })));
  const song = RHYTHM_SONGS.find(value => value.id === 'arirang'), chart = createChart(song, 'normal');
  const local = replayRhythmPerformance(chart, [], song.duration, 2);
  assert.equal(local.terminated, true); assert.equal(local.score.miss, 2);
  await deny(api.finishRhythmRankingGame(request('b', { sessionId: early.sessionId, events: [], endTime: local.endedAt })), 'failed-precondition');
  atMs += local.endedAt * 1000 + 1500;
  const finished = await measure('earlyFinish', () => api.finishRhythmRankingGame(request('b', { sessionId: early.sessionId, events: [], endTime: local.endedAt })));
  assert.equal(finished.terminated, true); assert.equal(finished.miss, 2); assert.equal(finished.score, 0); assert.equal(metrics.writes, 1);
  await measure('finishRetry', () => api.finishRhythmRankingGame(request('b', { sessionId: early.sessionId, events: [], endTime: local.endedAt }))); assert.equal(metrics.writes, 0);
  atMs += 6000;
  const perfect = await api.startRhythmRankingGame(request('b', startData({ songId: 'arirang' })));
  const events = chart.map(({ time, kind, hand }) => ({ time, kind, hand }));
  atMs += song.duration * 1000;
  const best = await measure('rankedFinish', () => api.finishRhythmRankingGame(request('b', { sessionId: perfect.sessionId, events, endTime: song.duration })));
  assert.equal(best.score, replayRhythmPerformance(chart, events, song.duration, 2).score.score); assert.ok(best.score > chart.length * 1000); assert.equal(best.rankingSkipped, false);
  const board = await get(`${base}/weplay_weekly_rankings/${weeklyBoardId('gungdeok-rock', 'challenge:arirang:normal', '', weekAt(atMs).id)}`);
  assert.equal(board.rows[0].score, best.score);
  assert.throws(() => replayChallenge(song, 'normal', [{ time: Infinity, hand: 'left', kind: 'center' }], song.duration, 2));
  assert.throws(() => replayChallenge(song, 'normal', [{ time: song.duration, hand: 'left', kind: 'center' }], song.duration, 2));
  const tomorrow = new Date(atMs + 9 * 3600000); tomorrow.setUTCHours(0, 0, 0, 0);
  atMs = tomorrow.getTime() - 9 * 3600000 + 86400000;
  assert.equal((await api.getRhythmChallengeState(request('a'))).freeRemaining, 3);
  const late = await api.startRhythmRankingGame(request('b', startData({ songId: 'arirang' })));
  const beforeWeek = weekAt(atMs); atMs = beforeWeek.endsAtMs + 10;
  await db.doc(`${base}/rhythm_challenge_sessions/${late.sessionId}`).update({ startedAtMs: beforeWeek.endsAtMs - song.duration * 1000, expiresAtMs: atMs + 10000 });
  const skipped = await api.finishRhythmRankingGame(request('b', { sessionId: late.sessionId, events, endTime: song.duration }));
  assert.equal(skipped.rankingSkipped, true);
  const next = await api.getRhythmChallengeState(request('teacher'));
  assert.equal(next.selection, 'automatic'); assert.equal(next.missLimit, 2); assert.notEqual(next.weekId, saved.weekId);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'a', user_id: 'a', email: 'a@yongshin-ms.ms.kr', email_verified: true,
    aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: authTime, exp: authTime + 7200, auth_time: authTime, firebase: { sign_in_provider: 'google.com' } })}.`;
  for (const collection of ['rhythm_challenge_sessions', 'rhythm_challenge_settings', 'rhythm_challenge_settings_requests', 'rhythm_players'])
    for (const method of ['GET', 'PATCH']) {
      const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${base}/${collection}/forged`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { challengeDailyUsed: { integerValue: '0' } } }) } : {}),
      });
      assert.equal(response.status, 403, `direct ${method} denied: ${collection}`);
    }
  await db.doc('application_sessions/b/sessions/' + authTime).update({ status: 'revoked' });
  await deny(api.getRhythmChallengeState(request('b')), 'unauthenticated');
  console.log(JSON.stringify({ passed: true, counts }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { DocumentReference.prototype.get = originalGet; await db.terminate(); });
