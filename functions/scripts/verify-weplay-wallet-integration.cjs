const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');

// These fixtures must never read or mutate an actual student's wallet.
const projectId = 'demo-westory-session-wis-wallet';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^127\.0\.0\.1:\d+$/.test(host)
  || process.env.GCLOUD_PROJECT !== projectId
  || (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== projectId)) {
  throw new Error('Dedicated local demo-westory-session-wis-wallet emulator required.');
}
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';

const api = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { accountIdFor } = require('../studentWisWallet');
const { DEFAULT_POLICY, DEFAULT_GAME_SETTINGS, PERIOD_SETTLEMENT_DELAY_MS, hash } = require('../weplayCore');
const db = getFirestore();
const semesterId = '2026-2', base = 'years/2026/semesters/2';
const digest = value => createHash('sha256').update(value).digest('hex');
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'c'.repeat(64) };
const authTime = Math.floor(Date.now() / 1000) - 10;
const accountPath = uid => `semester_wis_accounts/${accountIdFor(semesterId, uid)}`;
const get = async path => (await db.doc(path).get()).data();
const patch = (path, data) => db.doc(path).set(data, { merge: true });
const request = (uid, data) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } },
  data: { year: '2026', semester: '2', _session: proof, gameId: 'history-rain', difficulty: 'mild', ...data } });
const call = (name, uid = 'a', data = {}) => api[name].run(request(uid, data));
const start = (uid = 'a', data = {}) => call('startWeplayGame', uid, { mode: 'challenge', requestKey: randomUUID(), ...data });
const finish = (session, uid = 'a', data = {}) => call('finishWeplayGame', uid, { sessionId: session.id, ...data });
const denied = (promise, codes) => assert.rejects(promise, error => codes.includes(error.code));
const ledgerRows = async uid => (await db.collection('semester_wis_ledger').where('studentUid', '==', uid).get()).docs.map(doc => doc.data());

async function seed({ reward = 5, balance = 30 } = {}) {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const docs = {
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE', grade: '2', classNumber: '1' },
    [`${base}/weplay_games/history-rain`]: { ...structuredClone(DEFAULT_GAME_SETTINGS), enabled: true },
    [`${base}/weplay_policies/current`]: { ...structuredClone(DEFAULT_POLICY), version: 1, resultRewards: [{ minCorrect: 0, amount: reward }] },
    [`${base}/lessons/fixture`]: { unitId: 'fixture', title: '합성 검증 자료', contentHtml: '[고조선] [세종] [훈민정음]', isVisibleToStudents: true },
  };
  for (const uid of ['a', 'b', 'poor']) {
    docs[`users/${uid}`] = { role: 'student', name: '합성검증', studentGrade: '2', studentClass: '1', studentNumber: '1', registrationApprovalStatus: 'APPROVED' };
    docs[`application_sessions/${uid}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2,
      authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision,
      authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    docs[`student_identities/${uid}`] = { studentUid: uid, accountStatus: 'ACTIVE' };
    docs[`semester_enrollment_slots/slot_${digest(semesterId + '\n' + uid).slice(0, 40)}`] = {
      semesterId, studentUid: uid, activeEnrollmentId: `enrollment-${uid}`, status: 'ACTIVE' };
    docs[`semester_enrollments/enrollment-${uid}`] = { enrollmentId: `enrollment-${uid}`, semesterId, studentUid: uid,
      classId: 'class-one', enrollmentStatus: 'ACTIVE' };
    docs[accountPath(uid)] = { schemaVersion: 1, policyVersion: 'w7-v1', accountId: accountIdFor(semesterId, uid),
      semesterId, studentUid: uid, enrollmentId: `enrollment-${uid}`, classId: 'class-one', status: 'ACTIVE', revision: 1,
      balance: uid === 'poor' ? 1 : balance, earnedTotal: 0, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] };
    // A stale legacy wallet must not become an alternative source of funds.
    docs[`${base}/point_wallets/${uid}`] = { uid, balance: 9000, earnedTotal: 9000, spentTotal: 0 };
  }
  const batch = db.batch();
  for (const [path, value] of Object.entries(docs)) batch.set(db.doc(path), value);
  await batch.commit();
}

async function expire(session) {
  const endsAtMs = Date.now() - 1000;
  await patch(`${base}/weplay_sessions/${session.id}`, { startsAtMs: endsAtMs - 90000, endsAtMs });
}

async function assertAccounting(uid, openingBalance, expectedDeltas) {
  const account = await get(accountPath(uid));
  const rows = (await ledgerRows(uid)).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  assert.deepEqual(rows.map(row => row.delta), expectedDeltas);
  assert.equal(account.balance, openingBalance + rows.reduce((sum, row) => sum + row.delta, 0));
  let expectedBalance = openingBalance;
  for (const row of rows) {
    assert.equal(row.balanceBefore, expectedBalance);
    expectedBalance += row.delta;
    assert.equal(row.balanceAfter, expectedBalance);
    assert.ok(expectedBalance >= 0);
    assert.equal(row.actorUid, 'system:weplay');
    assert.ok(['weplay_cost', 'weplay_reward', 'weplay_rank_reward'].includes(row.activityType));
    const receipt = await get(row.receiptId);
    assert.equal(receipt.canonical, true);
    assert.equal(receipt.uid, uid);
    assert.equal(receipt.delta, row.delta);
    assert.equal(receipt.balanceAfter, row.balanceAfter);
  }
  assert.equal(account.revision, rows.length + 1);
  assert.deepEqual(account.recentLedgerEntries.map(row => row.ledgerEntryId), rows.map(row => row.ledgerEntryId).reverse());
  if (rows.length) {
    const balance = await get(`semester_wis_balances/${account.accountId}`);
    const ranking = await get(`semester_wis_rankings/${account.accountId}`);
    assert.equal(balance.balance, account.balance);
    assert.equal(balance.ledgerRevision, account.revision);
    assert.equal(ranking.balance, account.balance);
    assert.equal(ranking.ledgerRevision, account.revision);
    assert.equal(ranking.rankEarnedTotal, account.rankEarnedTotal);
  }
  assert.equal((await get(`${base}/point_wallets/${uid}`)).balance, 9000);
  return account;
}

let groups = 0;
async function test(name, run, options) {
  await seed(options); await run(); groups += 1;
  console.log(`PASS ${name}`);
}

(async () => { try {
  await test('same start and finish requests debit and reward once under simultaneous replay', async () => {
    const data = { mode: 'challenge', requestKey: 'same-start' };
    const sessions = await Promise.all(Array.from({ length: 5 }, () => start('a', data)));
    assert.equal(new Set(sessions.map(session => session.id)).size, 1);
    await assertAccounting('a', 30, [-2]);
    await denied(start('a', { requestKey: 'other-start' }), ['already-exists']);
    await denied(finish(sessions[0], 'b'), ['permission-denied']);
    await expire(sessions[0]);
    const results = await Promise.all(Array.from({ length: 5 }, () => finish(sessions[0])));
    results.forEach(result => assert.deepEqual(result, results[0]));
    assert.equal(results[0].cost, 2); assert.equal(results[0].reward, 5); assert.equal(results[0].netWis, 3);
    const account = await assertAccounting('a', 30, [-2, 5]);
    assert.equal(account.balance, results[0].balance);
    assert.equal((await get(`${base}/weplay_players/a`)).challengeUsed, 1);
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount, 2);
    const replay = await start('a', data);
    assert.equal(replay.status, 'finished');
    await assertAccounting('a', 30, [-2, 5]);
  });
  await test('zero reward still retains its complete loss entry and early-exit replay cannot erase the charge', async () => {
    const session = await start();
    const result = await finish(session, 'a', { exitEarly: true });
    assert.equal(result.reward, 0); assert.equal(result.cost, 2); assert.equal(result.netWis, -2);
    await assertAccounting('a', 30, [-2]);
    assert.equal((await get(`${base}/weplay_players/a/records/${session.id}`)).netWis, -2);
    assert.deepEqual(await finish(session, 'a', { exitEarly: true }), result);
    await assertAccounting('a', 30, [-2]);
  }, { reward: 0 });
  await test('insufficient canonical funds cannot use legacy funds or leave partial accounting', async () => {
    await denied(start('poor'), ['failed-precondition']);
    await assertAccounting('poor', 1, []);
    assert.equal((await db.collection(`${base}/point_transactions`).get()).size, 0);
    assert.equal((await db.collection(`${base}/weplay_sessions`).get()).size, 0);
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount, 0);
  });
  await test('different start requests racing for one wallet cannot double debit or create two active sessions', async () => {
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => start()));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    results.filter(result => result.status === 'rejected').forEach(result => assert.equal(result.reason.code, 'already-exists'));
    await assertAccounting('a', 30, [-2]);
    assert.equal((await get(`${base}/weplay_players/a`)).challengeUsed, 1);
  });
  await test('two students preserve independent balances and total ledger count under concurrent debit and reward', async () => {
    const [a, b] = await Promise.all([start('a'), start('b')]);
    await Promise.all([expire(a), expire(b)]);
    await Promise.all([finish(a, 'a'), finish(b, 'b')]);
    await assertAccounting('a', 30, [-2, 5]);
    await assertAccounting('b', 30, [-2, 5]);
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount, 4);
  });
  await test('practice and denied authority never change canonical or legacy money', async () => {
    const session = await start('a', { mode: 'practice' });
    await finish(session, 'a', { exitEarly: true });
    await assertAccounting('a', 30, []);
    await denied(api.startWeplayGame.run(request('a', { mode: 'challenge', requestKey: 'bad-proof', _session: null })), ['unauthenticated']);
    await patch(`${base}/weplay_games/history-rain`, { enabled: false });
    await denied(start('a'), ['failed-precondition']);
    await assertAccounting('a', 30, []);
  });
  await test('frozen accounts and migration fences fail before debit and allow explicit safe retry after recovery', async () => {
    for (const [path, blocked, restored] of [
      [accountPath('a'), { status: 'FROZEN' }, { status: 'ACTIVE' }],
      [`wis_legacy_migration_controls/${semesterId}`, { writesBlocked: true }, { writesBlocked: false }],
      [`semester_wis_economies/${semesterId}`, { status: 'CLOSED' }, { status: 'ACTIVE_OPEN' }],
    ]) {
      await patch(path, blocked);
      await denied(start(), ['failed-precondition']);
      await assertAccounting('a', 30, []);
      await patch(path, restored);
    }
    const session = await start('a', { requestKey: 'recovered' });
    await assertAccounting('a', 30, [-2]);
    await patch(accountPath('a'), { status: 'FROZEN' });
    await expire(session);
    await denied(finish(session), ['failed-precondition']);
    assert.equal((await get(`${base}/weplay_sessions/${session.id}`)).status, 'active');
    await patch(accountPath('a'), { status: 'ACTIVE' });
    await finish(session);
    await assertAccounting('a', 30, [-2, 5]);
  });
  await test('lobby recovery returns the committed wallet and loss/reward record together', async () => {
    const session = await start(); await expire(session);
    const lobby = await call('getWeplayLobby');
    assert.equal(lobby.balance, 33); assert.equal(lobby.activeSession, null);
    assert.equal(lobby.records[0].sessionId, session.id); assert.equal(lobby.records[0].netWis, 3);
    await assertAccounting('a', 30, [-2, 5]);
  });
  await test('scheduled ranking payout is atomic and repeated settlement cannot grant twice', async () => {
    const session = await start(); await expire(session); await finish(session);
    const stored = await get(`${base}/weplay_sessions/${session.id}`);
    const periodPath = `${base}/weplay_periods/${stored.periodId}`;
    const now = Date.now();
    await patch(periodPath, { endsAtMs: now - PERIOD_SETTLEMENT_DELAY_MS - 1000,
      frozenWinners: [{ uid: 'a', classKey: '2-1', difficulty: 'mild', rank: 1 }] });
    await patch(`weplay_period_queue/${hash(`2026:2:${stored.periodId}`)}`, {
      year: '2026', semester: '2', periodId: stored.periodId, dueAtMs: now - 1000 });
    await Promise.all([api.settleWeplayOnSchedule.run({}), api.settleWeplayOnSchedule.run({})]);
    await api.settleWeplayOnSchedule.run({});
    await assertAccounting('a', 30, [-2, 5, 10]);
    assert.equal((await get(periodPath)).status, 'closed');
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount, 3);
    assert.equal((await db.collection(`${periodPath}/awards`).get()).size, 1);
  });
  console.log(`PASS canonical Weplay wallet integration: ${groups} groups; production reads/writes 0`);
} finally {
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await db.terminate();
} })().catch(error => { console.error(error); process.exitCode = 1; });
