const assert = require('node:assert/strict');

// This script is intentionally incapable of reaching production Firestore.
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'demo-westory-weplay' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Run with the isolated demo-westory-weplay Firestore emulator.');
}
const api = require('../index');
const { getFirestore } = require('firebase-admin/firestore');
const { DEFAULT_POLICY, PERIOD_SETTLEMENT_DELAY_MS, hash } = require('../weplayCore');
const db = getFirestore();
const scope = { year: '2026', semester: '2' };
const prefix = `years/${scope.year}/semesters/${scope.semester}`;
const get = async (path) => (await db.doc(path).get()).data();
const call = (name, data = {}, uid = 'student-a') => api[name].run({
  auth: uid ? { uid, token: { email: uid === 'manager' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr` } } : null,
  data: { ...scope, difficulty: 'medium', ...data },
});
const rejectCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const walletBalance = async (uid = 'student-a') => (await get(`${prefix}/point_wallets/${uid}`))?.balance;
const costs = () => db.collection(`${prefix}/point_transactions`).where('type', '==', 'weplay_cost').get();
const payouts = () => db.collection(`${prefix}/point_transactions`).where('type', '==', 'weplay_reward').get();
const finishSoon = async (session) => {
  const endsAtMs = Date.now() - 1000;
  return db.doc(`${prefix}/weplay_sessions/${session.id}`).update({ startsAtMs: endsAtMs - (session.endsAtMs - session.startsAtMs), endsAtMs });
};

async function solve(session, correct = 60, uid = 'student-a') {
  for (const word of session.words.slice(0, correct)) {
    // Move the emulator fixture through the real server-defined fall windows;
    // every hit still passes through the exported production callable handler.
    const startsAtMs = Date.now() - word.spawnAtMs - 400;
    await db.doc(`${prefix}/weplay_sessions/${session.id}`).update({ startsAtMs, endsAtMs: startsAtMs + (session.endsAtMs - session.startsAtMs) });
    const data = { sessionId: session.id, eventId: `hit-${word.id}`, wordId: word.id, answer: word.text };
    const requests = [call('submitWeplayAnswer', data, uid)];
    if (word.id === session.words[0].id) requests.push(call('submitWeplayAnswer', data, uid));
    const responses = await Promise.all(requests);
    const first = responses[0];
    const replay = responses[1] || first;
    assert.equal(first.accepted, true);
    assert.equal(replay.accepted, true);
    assert.equal(first.correctCount, replay.correctCount);
  }
}

async function seed() {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.ok, true);
  await db.doc('site_settings/config').set(scope);
  for (const [uid, group] of [['student-a', '1'], ['student-b', '1'], ['student-c', '1'], ['student-d', '2'], ['poor', '1'], ['deleted', '1'], ['racer', '1'], ['cleanup', '1']]) {
    await db.doc(`users/${uid}`).set({ role: 'student', name: '검증학생', studentGrade: '2', studentClass: group, studentNumber: '1', email: `${uid}@yongshin-ms.ms.kr` });
    await db.doc(`${prefix}/point_wallets/${uid}`).set({ uid, balance: uid === 'poor' ? 1 : 30, earnedTotal: 30, rankEarnedTotal: 30, spentTotal: 0, adjustedTotal: 0 });
  }
  await db.doc('users/viewer').set({ role: 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_read'] });
  await db.doc(`${prefix}/lessons/visible`).set({ unitId: 'visible', title: '공개 자료', contentHtml: '[고조선] [삼국 시대] [훈민정음]', isVisibleToStudents: true });
  await db.doc(`${prefix}/lessons/hidden`).set({ unitId: 'hidden', title: '비공개 자료', contentHtml: '[노출되면안됨]', isVisibleToStudents: false });
  await db.doc('lessons/hidden').set({ unitId: 'hidden', title: '옛 공개 자료', contentHtml: '[옛정답]', isVisibleToStudents: true });
  await db.doc(`${prefix}/weplay_policies/current`).set(structuredClone(DEFAULT_POLICY));
}

async function main() {
  await seed();
  await rejectCode(call('getWeplayLobby', {}, null), 'unauthenticated');
  await rejectCode(call('getWeplayLobby', {}, 'viewer'), 'permission-denied');
  await call('getWeplayPolicy', {}, 'viewer');
  await rejectCode(call('saveWeplayPolicy', { policy: DEFAULT_POLICY }, 'viewer'), 'permission-denied');
  await rejectCode(call('startWeplayGame', { year: '2025', mode: 'challenge', requestKey: 'old' }), 'failed-precondition');
  const lobby = await call('getWeplayLobby');
  assert.equal(lobby.wordCount, 3);
  assert.deepEqual(lobby.lessons.map((lesson) => lesson.unitId), ['visible']);
  console.log('PASS real permission helpers, point_read reader, current scope, hidden scoped lesson precedence');

  const starts = await Promise.all(Array.from({ length: 5 }, () => call('startWeplayGame', { mode: 'challenge', requestKey: 'same' })));
  assert.equal(new Set(starts.map((session) => session.id)).size, 1);
  assert.equal(await walletBalance(), 28);
  assert.equal((await get(`${prefix}/weplay_players/student-a`)).challengeUsed, 1);
  assert.equal((await costs()).size, 1);
  await rejectCode(call('startWeplayGame', { mode: 'challenge', requestKey: 'different' }), 'already-exists');
  const session = starts[0];
  await rejectCode(call('finishWeplayGame', { sessionId: session.id }, 'student-b'), 'permission-denied');
  await rejectCode(call('finishWeplayGame', { sessionId: session.id }), 'failed-precondition');
  const early = await call('submitWeplayAnswer', { sessionId: session.id, eventId: 'future', wordId: session.words[19].id, answer: session.words[19].text });
  assert.equal(early.accepted, false);
  assert.equal(early.reason, 'not_started');
  const racers = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => call('startWeplayGame', { mode: 'challenge', requestKey: `race-${index}` }, 'racer')));
  assert.equal(racers.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await walletBalance('racer'), 28);
  assert.equal((await get(`${prefix}/weplay_players/racer`)).challengeUsed, 1);
  console.log('PASS real Firestore concurrent identical/different starts: exactly one debit, one daily count, one active session');

  const changed = structuredClone(DEFAULT_POLICY);
  changed.challengeCost = 99;
  changed.rankingRewards = Object.fromEntries(['mild', 'medium', 'spicy'].map((difficulty) => [difficulty, { first: 999, second: 999, third: 999 }]));
  changed.resultRewards = [{ minCorrect: 0, amount: 999 }];
  await call('saveWeplayPolicy', { policy: changed }, 'manager');
  await solve(session);
  await db.doc('users/student-a').update({ name: '새이름' });
  await finishSoon(session);
  const finishes = await Promise.all(Array.from({ length: 5 }, () => call('finishWeplayGame', { sessionId: session.id, score: 999999, reward: 999999 })));
  finishes.forEach((result) => assert.deepEqual(result, finishes[0]));
  assert.equal(finishes[0].correctCount, 60);
  assert.equal(finishes[0].rewardCorrectCount, 20);
  assert.equal(finishes[0].score, 11000);
  assert.equal(finishes[0].reward, 5);
  assert.equal(finishes[0].cost, 2);
  assert.equal(await walletBalance(), 33);
  assert.equal((await get(`${prefix}/point_wallets/student-a`)).studentName, '새이름');
  assert.equal((await payouts()).size, 1);
  console.log('PASS real concurrent answer replay/finalization, ignored forged totals, snapshotted payout, current wallet profile');

  await call('saveWeplayPolicy', { policy: DEFAULT_POLICY }, 'manager');
  for (const [uid, correct] of [['student-b', 3], ['student-c', 1], ['student-d', 1]]) {
    const game = await call('startWeplayGame', { mode: 'challenge', requestKey: `podium-${uid}` }, uid);
    await solve(game, correct, uid);
    await finishSoon(game);
    await call('finishWeplayGame', { sessionId: game.id }, uid);
  }
  const mild = await call('startWeplayGame', { mode: 'challenge', difficulty: 'mild', requestKey: 'mild-podium' });
  assert.equal(mild.difficulty, 'mild');
  assert.equal(mild.words[0].fallDurationMs, 12000);
  await solve(mild, 1);
  await finishSoon(mild);
  await call('finishWeplayGame', { sessionId: mild.id });
  const difficultyLobby = await call('getWeplayLobby');
  assert.equal(difficultyLobby.dailyUsed, 2);
  assert.ok(difficultyLobby.rankingByDifficulty.medium.some((row) => row.isMe));
  assert.ok(difficultyLobby.rankingByDifficulty.mild.some((row) => row.isMe));
  assert.equal(difficultyLobby.rankingByDifficulty.spicy.length, 0);
  await call('saveWeplayPolicy', { policy: { ...DEFAULT_POLICY, dailyChallengeLimit: 2 } }, 'manager');
  await rejectCode(call('startWeplayGame', { mode: 'challenge', difficulty: 'spicy', requestKey: 'shared-daily-limit' }), 'resource-exhausted');
  await call('saveWeplayPolicy', { policy: DEFAULT_POLICY }, 'manager');
  const periodId = (await get(`${prefix}/weplay_meta/current`)).periodId;
  await db.doc(`${prefix}/weplay_periods/${periodId}`).update({ endsAtMs: Date.now() - PERIOD_SETTLEMENT_DELAY_MS - 10000 });
  await db.doc(`weplay_period_queue/${hash(`${scope.year}:${scope.semester}:${periodId}`)}`).update({ dueAtMs: Date.now() - 1 });
  // The abandoned racer session belongs to this period and must settle before ranking.
  const racer = racers.find((result) => result.status === 'fulfilled').value;
  await finishSoon(racer);
  await Promise.all([api.settleWeplayOnSchedule.run({}), api.settleWeplayOnSchedule.run({})]);
  await api.settleWeplayOnSchedule.run({});
  assert.equal(await walletBalance('student-a'), 51);
  assert.equal(await walletBalance('student-b'), 33);
  assert.equal(await walletBalance('student-c'), 31);
  assert.equal(await walletBalance('student-d'), 38);
  assert.equal(await walletBalance('racer'), 28);
  assert.equal((await db.collection(`${prefix}/point_transactions`).where('type', '==', 'weplay_rank_reward').get()).size, 5);
  assert.equal((await get(`${prefix}/weplay_periods/${periodId}`)).status, 'closed');
  console.log('PASS real concurrent schedulers: class/difficulty-scoped awards once, shared daily cap, old period snapshot, zero-score exclusion');

  await rejectCode(call('startWeplayGame', { mode: 'challenge', requestKey: 'poor' }, 'poor'), 'failed-precondition');
  assert.equal(await walletBalance('poor'), 1);
  const practice = await call('startWeplayGame', { mode: 'practice', requestKey: 'practice' }, 'poor');
  await finishSoon(practice);
  const practiceResult = await call('finishWeplayGame', { sessionId: practice.id }, 'poor');
  assert.equal(practiceResult.netWis, 0);
  assert.equal(await walletBalance('poor'), 1);
  await call('saveWeplayPolicy', { policy: { ...DEFAULT_POLICY, dailyChallengeLimit: 0 } }, 'manager');
  await rejectCode(call('startWeplayGame', { mode: 'challenge', requestKey: 'daily' }, 'poor'), 'resource-exhausted');
  console.log('PASS insufficient funds and daily cap without negative balance; free practice remains available');

  await call('saveWeplayPolicy', { policy: DEFAULT_POLICY }, 'manager');
  const deleted = await call('startWeplayGame', { mode: 'challenge', requestKey: 'deleted' }, 'deleted');
  await db.doc(`${prefix}/weplay_sessions/${deleted.id}`).update({ acceptedWordIds: deleted.words.map((word) => word.id), acceptedEvents: deleted.words.map((word) => ({ wordId: word.id, elapsedMs: word.spawnAtMs + 500 })) });
  await finishSoon(deleted);
  await db.doc(`weplay_session_queue/${deleted.id}`).update({ dueAtMs: Date.now() - 1 });
  await db.doc('users/deleted').delete();
  await db.doc(`${prefix}/point_wallets/deleted`).delete();
  await api.settleWeplayOnSchedule.run({});
  assert.equal(await get(`${prefix}/point_wallets/deleted`), undefined);
  assert.equal(await get(`${prefix}/weplay_players/deleted/records/${deleted.id}`), undefined);
  assert.equal((await get(`${prefix}/weplay_sessions/${deleted.id}`)).result.reward, 0);
  console.log('PASS deleted student cannot be restored or rewarded by scheduled settlement');

  const cleanupGame = await call('startWeplayGame', { mode: 'challenge', difficulty: 'mild', requestKey: 'cleanup' }, 'cleanup');
  await solve(cleanupGame, 1, 'cleanup');
  await finishSoon(cleanupGame);
  await call('finishWeplayGame', { sessionId: cleanupGame.id }, 'cleanup');
  const cleanupPeriodId = (await get(`${prefix}/weplay_meta/current`)).periodId;
  assert.ok(await get(`${prefix}/weplay_periods/${cleanupPeriodId}/entries/${hash('cleanup:mild')}`));
  await call('deleteStudentData', { uid: 'cleanup' }, 'manager');
  assert.equal(await get('users/cleanup'), undefined);
  assert.equal(await get(`${prefix}/point_wallets/cleanup`), undefined);
  assert.equal(await get(`${prefix}/weplay_sessions/${cleanupGame.id}`), undefined);
  assert.equal(await get(`${prefix}/weplay_players/cleanup/records/${cleanupGame.id}`), undefined);
  assert.equal(await get(`${prefix}/weplay_periods/${cleanupPeriodId}/entries/${hash('cleanup:mild')}`), undefined);
  assert.equal(await get(`weplay_session_queue/${cleanupGame.id}`), undefined);
  console.log('PASS existing student deletion removes game sessions, personal records, hashed difficulty rank entries, queues and wallets');

  const retryPeriod = 'frozen-retry';
  await db.doc(`${prefix}/weplay_periods/${retryPeriod}`).set({ id: retryPeriod, startsAtMs: Date.now() - 7 * 86400000, endsAtMs: Date.now() - PERIOD_SETTLEMENT_DELAY_MS - 1000, status: 'closing', rankingPeriod: 'weekly', rankingRewards: DEFAULT_POLICY.rankingRewards, policyVersion: 0, frozenWinners: [{ uid: 'student-b', classKey: '2-1', difficulty: 'medium', rank: 1 }] });
  await db.doc(`${prefix}/weplay_periods/${retryPeriod}/entries/${hash('student-d:medium')}`).set({ uid: 'student-d', classKey: '2-1', difficulty: 'medium', score: 9999, correctCount: 20, achievedAtMs: 1 });
  await db.doc(`weplay_period_queue/${hash(`${scope.year}:${scope.semester}:${retryPeriod}`)}`).set({ ...scope, periodId: retryPeriod, dueAtMs: Date.now() - 1 });
  await api.settleWeplayOnSchedule.run({});
  assert.equal(await walletBalance('student-b'), 43);
  assert.equal(await walletBalance('student-d'), 38);
  console.log('PASS interrupted ranking settlement reuses frozen winners despite later entry changes');

  await call('deleteStudentData', { uid: 'student-a' }, 'manager');
  const afterDeletion = await get(`${prefix}/weplay_periods/${periodId}`);
  assert.equal(afterDeletion.frozenWinners.some((winner) => winner.uid === 'student-a'), false);
  assert.equal(afterDeletion.frozenWinners.filter((winner) => winner.uid === '' && winner.rank === 1).length, 2);
  console.log('PASS deleting a finalized winner anonymizes both difficulty slots without promoting new recipients');

  await db.doc('users/backfill').set({ role: 'student', name: '원장검증', studentGrade: '2', studentClass: '1', studentNumber: '2' });
  await db.doc(`${prefix}/point_transactions/backfill_grant`).set({ uid: 'backfill', type: 'attendance', delta: 10, createdAt: new Date() });
  await db.doc(`${prefix}/point_transactions/backfill_cost`).set({ uid: 'backfill', type: 'weplay_cost', delta: -2, createdAt: new Date() });
  await call('rebuildPointWalletRankTotals', { dryRun: false }, 'manager');
  const rebuilt = await get(`${prefix}/point_wallets/backfill`);
  assert.equal(rebuilt.balance, 8);
  assert.equal(rebuilt.spentTotal, 2);
  assert.equal(rebuilt.earnedTotal, 10);
  console.log('PASS existing point wallet rebuild includes game costs in spent totals and preserves earned totals');

  const exitingUid = 'early-exit';
  await db.doc(`users/${exitingUid}`).set({ role: 'student', name: '중도종료검증', studentGrade: '2', studentClass: '1', studentNumber: '9', email: `${exitingUid}@yongshin-ms.ms.kr` });
  await db.doc(`${prefix}/point_wallets/${exitingUid}`).set({ uid: exitingUid, balance: 30, earnedTotal: 30, rankEarnedTotal: 30, spentTotal: 0, adjustedTotal: 0 });
  const exiting = await call('startWeplayGame', { mode: 'challenge', requestKey: 'early-exit' }, exitingUid);
  await solve(exiting, 30, exitingUid);
  await rejectCode(call('finishWeplayGame', { sessionId: exiting.id }, exitingUid), 'failed-precondition');
  await rejectCode(call('finishWeplayGame', { sessionId: exiting.id, exitEarly: false }, exitingUid), 'failed-precondition');
  await rejectCode(call('finishWeplayGame', { sessionId: exiting.id, exitEarly: true }, 'student-b'), 'permission-denied');
  await rejectCode(call('finishWeplayGame', { sessionId: exiting.id, exitEarly: 'true' }, exitingUid), 'invalid-argument');
  const beforeExit = await get(`${prefix}/weplay_sessions/${exiting.id}`);
  const exitRequestedAt = Date.now();
  const exitResults = await Promise.all(Array.from({ length: 5 }, () => call('finishWeplayGame', { sessionId: exiting.id, exitEarly: true }, exitingUid)));
  const exited = exitResults[0];
  exitResults.forEach((result) => assert.deepEqual(result, exited));
  assert.equal(exited.endedEarly, true);
  assert.equal(exited.battle.outcome, 'active');
  assert.equal(exited.correctCount, 30);
  assert.equal(exited.totalWords, 60);
  assert.equal(exited.rewardCorrectCount, 10);
  assert.equal(exited.reward, 1);
  assert.equal(exited.cost, 2);
  assert.equal(exited.netWis, -1);
  assert.ok(exited.finishedAtMs >= exitRequestedAt && exited.finishedAtMs <= Date.now());
  assert.equal(await walletBalance(exitingUid), 29);
  const exitedPlayer = await get(`${prefix}/weplay_players/${exitingUid}`);
  assert.equal(exitedPlayer.challengeUsed, 1);
  assert.equal(exitedPlayer.activeSessionId, null);
  const afterExit = await get(`${prefix}/weplay_sessions/${exiting.id}`);
  assert.equal(afterExit.startsAtMs, beforeExit.startsAtMs);
  assert.equal(afterExit.endsAtMs, beforeExit.endsAtMs);
  assert.equal(afterExit.status, 'finished');
  assert.equal(await get(`weplay_session_queue/${exiting.id}`), undefined);
  const exitPayouts = (await payouts()).docs.filter((doc) => doc.data().sourceId === exiting.id);
  assert.equal(exitPayouts.length, 1);
  assert.equal(exitPayouts[0].data().delta, 1);
  assert.equal((await get(`${prefix}/weplay_periods/${beforeExit.periodId}/entries/${hash(`${exitingUid}:medium`)}`)).achievedAtMs, exited.finishedAtMs);
  assert.deepEqual(await call('finishWeplayGame', { sessionId: exiting.id }, exitingUid), exited);
  const afterExitAnswer = await call('submitWeplayAnswer', { sessionId: exiting.id, eventId: 'after-exit', wordId: exiting.words[30].id, answer: exiting.words[30].text }, exitingUid);
  assert.equal(afterExitAnswer.accepted, false);
  assert.deepEqual((await get(`${prefix}/weplay_sessions/${exiting.id}`)).result, exited);
  await api.settleWeplayOnSchedule.run({});
  assert.equal(await walletBalance(exitingUid), 29);
  console.log('PASS real concurrent voluntary exit: explicit owner-only authorization, one payout, full-game denominator, retained fee/count, actual finish time, closed answers and scheduler replay');

  // Server-only game paths must remain unavailable to a signed-in student client.
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rules@yongshin-ms.ms.kr', password: 'emulator-only-password', returnSecureToken: true }) });
  const account = await signup.json();
  assert.ok(account.idToken, JSON.stringify(account));
  await db.doc(`users/${account.localId}`).set({ role: 'student', email: 'rules@yongshin-ms.ms.kr' });
  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
  for (const resource of [`${prefix}/weplay_sessions/${session.id}`, `${prefix}/weplay_policies/current`, `${prefix}/weplay_games/history-rain`, `${prefix}/weplay_periods/${periodId}`]) {
    const read = await fetch(`${endpoint}/${resource}`, { headers: { authorization: `Bearer ${account.idToken}` } });
    assert.equal(read.status, 403, `Direct read must be denied: ${resource}`);
    const write = await fetch(`${endpoint}/${resource}`, { method: 'PATCH', headers: { authorization: `Bearer ${account.idToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { score: { integerValue: '999999' } } }) });
    assert.equal(write.status, 403, `Direct write must be denied: ${resource}`);
  }
  console.log('PASS real authenticated Firestore rules deny direct game, policy and ranking reads/writes');
  console.log('Weplay Firestore emulator verification completed: all groups passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map(deleteApp));
});
