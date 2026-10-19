const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const projectId = 'demo-westory-session-yut-reward';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) throw new Error('Dedicated local Yut reward emulator required.');
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const api = require('../index');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { accountIdFor } = require('../studentWisWallet');
const { DEFAULT_POLICY } = require('../weplayCore');
const db = getFirestore(), semesterId = '2026-2', base = 'years/2026/semesters/2';
const hash = value => createHash('sha256').update(value).digest('hex');
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const request = (uid, data = {}) => ({ auth: { uid, token: { email: uid === 'manager' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { year: '2026', semester: '2', _session: proof, ...data } });
const get = async path => (await db.doc(path).get()).data();
const patch = (path, data) => db.doc(path).set(data, { merge: true });
const accountPath = uid => `semester_wis_accounts/${accountIdFor(semesterId, uid)}`;
const roomPath = room => `${base}/yut_rooms/${room.id}`;
const denied = (promise, codes = ['permission-denied']) => assert.rejects(promise, error => codes.includes(error.code));
async function command(uid, action, data = {}) {
  await patch(`${base}/yut_players/${uid}`, { lastCommandAtMs: 0 });
  return api.commandYutRoom.run(request(uid, { action, requestKey: randomUUID(), ...data }));
}
const inRoom = (uid, room, action, extra = {}) => command(uid, action, { roomId: room.id, expectedRevision: room.revision, ...extra });
async function policy(patchPolicy) {
  const current = (await api.getWeplayPolicy.run(request('manager'))).policy;
  return (await api.saveWeplayPolicy.run(request('manager', { policy: { ...current, ...patchPolicy } }))).policy;
}
async function seed() {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const docs = {
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE' },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 1 },
  };
  for (const uid of ['a', 'b', 'manager', 'teacher', 'reader']) {
    const student = ['a', 'b'].includes(uid);
    docs[`users/${uid}`] = { role: student ? 'student' : uid === 'reader' ? 'staff' : 'teacher', name: '합성검증', registrationApprovalStatus: 'APPROVED', ...(uid === 'reader' ? { teacherPortalEnabled: true, staffPermissions: ['point_read'] } : {}) };
    docs[`application_sessions/${uid}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    if (student) {
      const accountId = accountIdFor(semesterId, uid);
      docs[`student_identities/${uid}`] = { studentUid: uid, accountStatus: 'ACTIVE' };
      docs[`semester_enrollment_slots/slot_${hash(semesterId + '\n' + uid).slice(0, 40)}`] = { semesterId, studentUid: uid, activeEnrollmentId: `enrollment-${uid}`, status: 'ACTIVE' };
      docs[`semester_enrollments/enrollment-${uid}`] = { enrollmentId: `enrollment-${uid}`, semesterId, studentUid: uid, classId: 'class-one', enrollmentStatus: 'ACTIVE' };
      docs[accountPath(uid)] = { schemaVersion: 1, policyVersion: 'w7-v1', accountId, semesterId, studentUid: uid, classId: 'class-one', enrollmentId: `enrollment-${uid}`, status: 'ACTIVE', revision: 1, balance: 100, earnedTotal: 0, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] };
    }
  }
  const batch = db.batch(); for (const [path, data] of Object.entries(docs)) batch.set(db.doc(path), data); await batch.commit();
}
async function start(winner = 'a', opponent = 'b') {
  let room = (await command(winner, 'create', { visibility: 'public', maxPlayers: 2 })).room;
  room = (await command(opponent, 'join', { code: room.code })).room;
  room = (await inRoom(opponent, room, 'ready', { ready: true })).room;
  return (await inRoom(winner, room, 'start')).room;
}
async function nearFinish(room, winner = 'a', arrivalNode = 'o19') {
  // Synthetic persisted board, never a client-supplied score. The actual exported
  // callable still validates the turn, route, deadline, completion and reward.
  const players = room.players.map(p => ({ ...p, pieces: p.pieces.map((piece, index) => ({ id: piece.id, node: p.uid === winner ? (index ? 'finish' : arrivalNode) : 'o19', lane: 'outer' })) }));
  await patch(roomPath(room), { players, turnUid: winner, phase: 'move', phaseStartsAtMs: 0, turnDeadlineMs: Date.now() + 60000, pendingThrow: { value: 1, label: '도', sticks: [true, false, false, false] } });
  return get(roomPath(room));
}
const finish = (room, uid = 'a', extra = {}) => inRoom(uid, room, 'move', { pieceId: '1', route: 'outer', ...extra });
async function noMoney() {
  assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
  assert.equal((await db.collection(`${base}/point_transactions`).get()).size, 0);
  assert.equal((await get(accountPath('a'))).balance, 100);
  assert.equal((await get(accountPath('b'))).balance, 100);
}
let groups = 0;
async function test(name, run) { await seed(); await run(); groups += 1; console.log(`PASS ${name}`); }
(async () => { try {
  await test('policy default-off, reader/write authority, validation, CAS and legacy editor preservation', async () => {
    const initial = (await api.getWeplayPolicy.run(request('reader'))).policy;
    assert.deepEqual(initial.yutWinnerReward, { enabled: false, amount: 0 });
    for (const uid of ['a', 'reader', 'teacher']) await denied(api.saveWeplayPolicy.run(request(uid, { policy: initial })));
    const proposed = { ...initial, yutWinnerReward: { enabled: true, amount: 7 } };
    const concurrent = await Promise.allSettled([api.saveWeplayPolicy.run(request('manager', { policy: proposed })), api.saveWeplayPolicy.run(request('manager', { policy: proposed }))]);
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find(r => r.status === 'rejected').reason.code, 'aborted');
    const current = (await api.getWeplayPolicy.run(request('manager'))).policy;
    for (const amount of [-1, 0.5, 10001, '7']) await denied(api.saveWeplayPolicy.run(request('manager', { policy: { ...current, yutWinnerReward: { enabled: true, amount } } })), ['invalid-argument']);
    const legacy = { ...current, challengeCost: 3 }; delete legacy.yutWinnerReward;
    const saved = (await api.saveWeplayPolicy.run(request('manager', { policy: legacy }))).policy;
    assert.deepEqual(saved.yutWinnerReward, { enabled: true, amount: 7 });
    assert.deepEqual(saved.rankingRewards, initial.rankingRewards); assert.deepEqual(saved.resultRewards, initial.resultRewards);
    await patch(`semester_manifests/${semesterId}`, { readOnly: true });
    await denied(api.saveWeplayPolicy.run(request('manager', { policy: saved })), ['failed-precondition']);
    await noMoney();
  });
  await test('first piece alone never ends a two-piece game or pays its reward', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start());
    room.players[0].pieces[1].node = 'home';
    await patch(roomPath(room), { players: room.players });
    room = (await finish(room)).room;
    assert.equal(room.status, 'playing'); assert.equal(room.winnerUid, null);
    assert.equal(room.players[0].pieces[0].node, 'finish', 'exact arrival completes the selected piece immediately');
    assert.equal(room.reward, undefined);
    await noMoney();
    room = await nearFinish(room);
    room = (await finish(room)).room;
    assert.equal(room.status, 'finished'); assert.equal(room.reward.status, 'paid');
    assert.equal((await get(accountPath('a'))).balance, 107);
  });
  await test('first full completion ends all play and pays only its winner atomically once under concurrent retries', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start());
    const requestKey = randomUUID();
    await patch(`${base}/yut_players/a`, { lastCommandAtMs: 0 });
    const win = request('a', { action: 'move', roomId: room.id, expectedRevision: room.revision, pieceId: '1', route: 'outer', requestKey });
    const responses = await Promise.all([api.commandYutRoom.run(win), api.commandYutRoom.run(win), api.commandYutRoom.run(win)]);
    room = responses[0].room;
    assert.equal(room.status, 'finished'); assert.equal(room.finishReason, 'completion'); assert.equal(room.winnerUid, 'a');
    assert.deepEqual(room.lastEvent.move.path, ['o20', 'finish'], 'a one-step exact arrival keeps its pad in the movement animation');
    assert.equal(responses.every(response => response.room.revision === room.revision), true, 'retried exact-arrival commands complete the game only once');
    assert.equal(room.turnUid, null); assert.equal(room.turnDeadlineMs, 0);
    assert.deepEqual(room.reward, { uid: 'a', amount: 7, policyVersion: 1, status: 'paid', settledAtMs: room.reward.settledAtMs });
    assert.equal(JSON.stringify(room).includes('balanceAfter'), false); assert.equal(JSON.stringify(room).includes('wisacct_'), false);
    for (const action of ['throw', 'move', 'skip', 'start']) await denied(inRoom('b', room, action, { pieceId: '1', route: 'outer' }), ['failed-precondition', 'permission-denied']);
    const account = await get(accountPath('a'));
    assert.equal(account.balance, 107); assert.equal(account.earnedTotal, 7); assert.equal(account.rankEarnedTotal, 7); assert.equal(account.adjustedTotal, 7); assert.equal(account.revision, 2);
    assert.equal((await get(accountPath('b'))).balance, 100);
    assert.equal((await get(`semester_wis_balances/${account.accountId}`)).balance, 107);
    assert.equal((await get(`semester_wis_rankings/${account.accountId}`)).rankEarnedTotal, 7);
    assert.equal((await get(`semester_wis_economies/${semesterId}`)).ledgerEntryCount, 1);
    const ledgers = await db.collection('semester_wis_ledger').get(); assert.equal(ledgers.size, 1);
    const ledger = ledgers.docs[0].data(); assert.equal(ledger.actorUid, 'system:yut'); assert.equal(ledger.reason, '마우저구 윷놀이 완주 1등');
    assert.equal((await get(ledger.receiptId)).canonical, true);
    assert.equal((await db.collection(`${base}/point_wallets`).get()).size, 0, 'no legacy wallet');
    const otherKey = { ...win, data: { ...win.data, requestKey: randomUUID() } };
    await denied(api.commandYutRoom.run(otherKey), ['aborted', 'resource-exhausted']);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
  });
  await test('a piece stored on the legacy arrival pad can still finish and settle only once', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start(), 'a', 'o20');
    const requestKey = randomUUID();
    const responses = await Promise.all([inRoom('a', room, 'move', { pieceId: '1', route: 'outer', requestKey }), inRoom('a', room, 'move', { pieceId: '1', route: 'outer', requestKey })]);
    room = responses[0].room;
    assert.equal(room.status, 'finished'); assert.equal(room.winnerUid, 'a');
    assert.deepEqual(room.lastEvent.move.path, ['finish']);
    assert.equal(room.reward.status, 'paid'); assert.equal((await get(accountPath('a'))).balance, 107);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
    assert.equal((await db.collection(`${base}/point_transactions`).get()).size, 1);
    assert.equal(responses[1].room.revision, room.revision);
  });
  await test('a started match keeps its reward snapshot; a disabled match can never be paid retroactively', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await start();
    await policy({ yutWinnerReward: { enabled: false, amount: 99 } });
    room = (await finish(await nearFinish(room))).room;
    assert.equal(room.reward.amount, 7);
    await inRoom('manager', room, 'close');
    room = await start();
    await policy({ yutWinnerReward: { enabled: true, amount: 99 } });
    room = (await finish(await nearFinish(room))).room;
    assert.equal(room.reward.status, 'not-awarded'); assert.equal(room.reward.reason, 'disabled');
    assert.equal((await get(accountPath('a'))).balance, 107);
    await denied(inRoom('a', room, 'claimReward'), ['failed-precondition']);
  });
  await test('default-off, zero, teacher completion, forfeit and manager close never pay', async () => {
    let room = (await finish(await nearFinish(await start()))).room;
    assert.equal(room.reward.status, 'not-awarded'); await noMoney();
    await inRoom('manager', room, 'close');
    await policy({ yutWinnerReward: { enabled: true, amount: 0 } });
    room = (await finish(await nearFinish(await start()))).room; await noMoney();
    await inRoom('manager', room, 'close');
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    room = await start(); await inRoom('b', room, 'leave'); room = await get(roomPath(room));
    assert.equal(room.finishReason, 'forfeit'); await denied(inRoom('a', room, 'claimReward'), ['failed-precondition']); await noMoney();
    await inRoom('manager', room, 'close');
    room = await start(); await inRoom('manager', room, 'close'); await noMoney();
    room = await nearFinish(await start('teacher', 'a'), 'teacher');
    room = (await finish(room, 'teacher')).room;
    assert.equal(room.reward.reason, 'ineligible'); await noMoney();
  });
  await test('frozen account does not delay first-place finish; only its winner can retry the fixed pending amount', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start());
    await patch(accountPath('a'), { status: 'FROZEN' });
    room = (await finish(room)).room;
    assert.equal(room.status, 'finished'); assert.equal(room.reward.status, 'pending'); await noMoney();
    await denied(inRoom('b', room, 'claimReward'), ['failed-precondition']);
    await denied(inRoom('a', room, 'claimReward', { amount: 999 }), ['invalid-argument']);
    await policy({ yutWinnerReward: { enabled: true, amount: 99 } });
    await patch(accountPath('a'), { status: 'ACTIVE' });
    const key = randomUUID();
    const claimed = await Promise.all([inRoom('a', room, 'claimReward', { requestKey: key }), inRoom('a', room, 'claimReward', { requestKey: key })]);
    assert.equal(claimed[0].room.reward.status, 'paid'); assert.equal(claimed[0].room.reward.amount, 7);
    assert.equal((await get(accountPath('a'))).balance, 107); assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
  });
  await test('migration fences, closed economy, deleted identity, bad canonical account and overflow cannot mint money', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start());
    await patch(`wis_legacy_migration_controls/${semesterId}`, { writesBlocked: true });
    room = (await finish(room)).room; assert.equal(room.reward.status, 'pending'); await noMoney();
    await db.doc(`wis_legacy_migration_controls/${semesterId}`).delete();
    for (const [path, bad, restore] of [
      [`semester_wis_economies/${semesterId}`, { status: 'CLOSED' }, { status: 'ACTIVE_OPEN' }],
      ['student_identities/a', { accountStatus: 'CLOSED' }, { accountStatus: 'ACTIVE' }],
      [accountPath('a'), { studentUid: 'other' }, { studentUid: 'a' }],
      [accountPath('a'), { balance: Number.MAX_SAFE_INTEGER }, { balance: 100 }],
    ]) {
      await patch(path, bad);
      room = (await inRoom('a', room, 'claimReward')).room;
      assert.equal(room.reward.status, 'pending'); assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
      await patch(path, restore);
    }
    await noMoney();
  });
  await test('pending settlement retains publication, session, semester, enrollment and pointer guards', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    await patch(accountPath('a'), { status: 'FROZEN' });
    let room = (await finish(await nearFinish(await start()))).room;
    await patch(accountPath('a'), { status: 'ACTIVE' });
    const data = { action: 'claimReward', roomId: room.id, expectedRevision: room.revision, requestKey: randomUUID() };
    await denied(api.commandYutRoom.run(request('a', { ...data, _session: null })), ['unauthenticated']);
    for (const [path, bad, restore, codes] of [
      [`${base}/weplay_games/joseon-yut`, { enabled: false }, { enabled: true }, ['permission-denied']],
      ['site_settings/config', { semester: '1' }, { semester: '2' }, ['failed-precondition']],
      ['semester_enrollments/enrollment-a', { enrollmentStatus: 'INACTIVE' }, { enrollmentStatus: 'ACTIVE' }, ['permission-denied']],
      ['users/a', { registrationApprovalStatus: 'PENDING' }, { registrationApprovalStatus: 'APPROVED' }, ['permission-denied']],
    ]) {
      await patch(path, bad); await denied(api.commandYutRoom.run(request('a', data)), codes); await patch(path, restore);
    }
    const newRoom = (await command('a', 'create', { visibility: 'public' })).room;
    room = (await inRoom('a', room, 'claimReward')).room;
    assert.equal(room.reward.status, 'paid');
    assert.equal((await get(`${base}/yut_players/a`)).roomId, newRoom.id, 'claiming a previous result cannot replace a newer active-room pointer');
  });
  await test('orphan financial evidence fails closed and a complete existing posting reconciles without a second grant', async () => {
    await policy({ yutWinnerReward: { enabled: true, amount: 7 } });
    let room = await nearFinish(await start());
    const receiptPath = `${base}/point_transactions/weplay_reward_yut_${room.id}`;
    await db.doc(receiptPath).set({ canonical: true, uid: 'a', sourceId: `yut_${room.id}`, delta: 7, policyId: 'weplay:1' });
    room = (await finish(room)).room;
    assert.equal(room.status, 'finished'); assert.equal(room.reward.status, 'pending');
    assert.equal((await get(accountPath('a'))).balance, 100); assert.equal((await db.collection('semester_wis_ledger').get()).size, 0);
    await db.doc(receiptPath).delete();
    room = (await inRoom('a', room, 'claimReward')).room;
    assert.equal(room.reward.status, 'paid');
    await patch(roomPath(room), { reward: { ...room.reward, status: 'pending' } });
    await patch(receiptPath, { balanceAfter: 999 });
    room = (await inRoom('a', room, 'claimReward')).room;
    assert.equal(room.reward.status, 'pending', 'a receipt/ledger balance mismatch cannot be called paid');
    assert.equal((await get(accountPath('a'))).balance, 107);
    await patch(receiptPath, { balanceAfter: 107 });
    room = (await inRoom('a', room, 'claimReward')).room;
    assert.equal(room.reward.status, 'paid'); assert.equal((await get(accountPath('a'))).balance, 107);
    assert.equal((await db.collection('semester_wis_ledger').get()).size, 1);
  });
  console.log(`PASS Yut reward integration: ${groups} groups; production reads/writes 0`);
} finally {
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await db.terminate();
} })().catch(error => { console.error(error); process.exitCode = 1; });
