const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const projectId = 'demo-westory-session-yut-expiration';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Waiting-room expiry tests require a local Firestore emulator.');
}
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId }, projectId));
const base = 'years/2026/semesters/2';
const now = Date.now();
let clock = now;
const handlers = require('../yut').createYutHandlers({ db, now: () => clock, assertSession: async () => {} });
const request = data => ({ auth: { uid: 'expiry-host', token: { email: 'host@yongshin-ms.ms.kr' } }, data: { year: '2026', semester: '2', ...data } });

(async () => {
  const core = await import('../yutCore.mjs');
  const create = (id, atMs) => {
    let room = core.createYutRoom({ id, code: id.toUpperCase(), classId: '', classLabel: '', host: { uid: 'expiry-host', name: '교사' }, nowMs: atMs });
    room = core.addYutPlayer(room, { uid: 'expiry-guest', name: '교사' }, atMs);
    return core.readyYutPlayer(room, 'expiry-guest', true, atMs);
  };
  const old = create('expired', now - core.YUT_WAITING_MS);
  // Legacy waiting rooms still have the old 24-hour expiresAtMs.
  delete old.hostActivityAtMs;
  old.expiresAtMs = now + core.YUT_ROOM_MS;
  old.code = 'ABC234';
  const fresh = create('fresh', now - core.YUT_WAITING_MS + 1);
  fresh.code = 'ABC235';
  const started = core.startYutGame(create('started', now - core.YUT_WAITING_MS), now - 1);
  const previousScope = 'years/2026/semesters/1';
  const records = {
    'users/expiry-host': { role: 'teacher', name: '교사' },
    'users/expiry-guest': { role: 'teacher', name: '교사' },
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { status: 'ACTIVE', revision: 1 },
    [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 1 },
    [`${base}/yut_rooms/expired`]: old,
    [`${base}/yut_codes/ABC234`]: { roomId: 'expired', expiresAtMs: old.expiresAtMs },
    [`${base}/yut_rooms/fresh`]: fresh,
    [`${base}/yut_rooms/started`]: started,
    [`${base}/yut_players/expiry-host`]: { roomId: 'expired', commands: [{ key: 'retained-receipt' }] },
    // A later room pointer must survive cleanup of the older room.
    [`${base}/yut_players/expiry-guest`]: { roomId: 'fresh' },
    [`${previousScope}/yut_rooms/expired`]: old,
    // A reused code must never be deleted by the previous room.
    [`${previousScope}/yut_codes/ABC234`]: { roomId: 'newer-room', expiresAtMs: old.expiresAtMs },
  };
  const batch = db.batch();
  for (const [path, data] of Object.entries(records)) batch.set(db.doc(path), data);
  await batch.commit();
  assert.equal(fresh.expiresAtMs, fresh.createdAtMs + 600000);
  assert.equal(started.expiresAtMs, now - 1 + core.YUT_ROOM_MS);
  clock = now - 1;
  assert.equal((await handlers.getYutLobby(request({}))).room.id, 'expired');
  clock = now;
  assert.equal((await handlers.getYutLobby(request({}))).room, null);
  await assert.rejects(handlers.commandYutRoom(request({
    action: 'start', roomId: 'expired', requestKey: randomUUID(), expectedRevision: old.revision,
  })), error => error.code === 'not-found');
  await assert.rejects(handlers.commandYutRoom(request({
    action: 'join', code: 'ABC234', requestKey: randomUUID(),
  })), error => error.code === 'not-found');
  assert.equal(core.startYutGame(old, now).status, 'playing', 'the shared local-preview core has no online admission expiry');
  const previousSignals = await Promise.all([base, previousScope].map(async scope => (await db.doc(`${scope}/yut_management/current`).get()).data()));
  const result = await handlers.cleanupWaitingYutRooms();
  assert.equal(result.deleted, 2);
  const cleanupSignals = await Promise.all([base, previousScope].map(async (scope, index) => {
    const signal = (await db.doc(`${scope}/yut_management/current`).get()).data();
    assert.notEqual(signal.changeId, previousSignals[index]?.changeId, 'waiting-room deletion invalidates its own semester monitor');
    assert.deepEqual(Object.keys(signal).sort(), ['changeId', 'updatedAtMs']);
    return signal;
  }));
  assert.equal((await db.doc(`${base}/yut_rooms/expired`).get()).exists, false);
  assert.equal((await db.doc(`${base}/yut_codes/ABC234`).get()).exists, false);
  assert.equal((await db.doc(`${base}/yut_players/expiry-host`).get()).data().roomId, null);
  assert.deepEqual((await db.doc(`${base}/yut_players/expiry-host`).get()).data().commands, [{ key: 'retained-receipt' }]);
  assert.equal((await db.doc(`${base}/yut_players/expiry-guest`).get()).data().roomId, 'fresh');
  assert.equal((await db.doc(`${previousScope}/yut_codes/ABC234`).get()).data().roomId, 'newer-room');
  assert.equal((await db.doc(`${base}/yut_rooms/fresh`).get()).exists, true);
  assert.equal((await db.doc(`${base}/yut_rooms/started`).get()).exists, true);
  assert.equal((await handlers.cleanupWaitingYutRooms()).deleted, 0, 'cleanup retry is idempotent');
  assert.deepEqual(await Promise.all([base, previousScope].map(async scope => (await db.doc(`${scope}/yut_management/current`).get()).data())), cleanupSignals, 'cleanup without a deletion does not send another monitor event');
  await db.doc(`${base}/yut_codes/ABC235`).set({ roomId: 'new-code-owner', expiresAtMs: now + 120000 });
  const begun = await handlers.commandYutRoom(request({
    action: 'start', roomId: fresh.id, requestKey: randomUUID(), expectedRevision: fresh.revision,
  }));
  assert.equal(begun.room.status, 'playing');
  assert.equal((await db.doc(`${base}/yut_codes/ABC235`).get()).data().roomId, 'new-code-owner', 'starting never rewrites a code that another room has acquired');
  // A room older than ten minutes stays joinable while its host takes actions.
  let active = core.createYutRoom({ id: 'active-host', code: 'ABC236', classId: '', classLabel: '', host: { uid: 'expiry-host', name: '교사' }, nowMs: now - 660000 });
  active = core.addYutPlayer(active, { uid: 'expiry-guest', name: '참가자' }, now - 650000);
  active = core.touchYutHostActivity(active, 'expiry-host', now - 120000);
  active.playerNamesVersion = 1;
  await db.doc(`${base}/yut_rooms/${active.id}`).set(active);
  await db.doc(`${base}/yut_codes/${active.code}`).set({ roomId: active.id, expiresAtMs: active.expiresAtMs });
  await db.doc(`${base}/yut_players/expiry-host`).set({ roomId: active.id });
  await db.doc(`${base}/yut_players/expiry-guest`).set({ roomId: active.id, commands: [{ key: 'guest-history' }] });
  const asGuest = data => ({ ...request(data), auth: { uid: 'expiry-guest', token: { email: 'guest@yongshin-ms.ms.kr' } } });
  const asLate = data => ({ ...request(data), auth: { uid: 'expiry-late', token: { email: 'late@yongshin-ms.ms.kr' } } });
  await db.doc('users/expiry-late').set({ role: 'teacher' });
  assert.equal((await handlers.getYutLobby(request({}))).room.id, active.id);
  assert.equal((await handlers.cleanupWaitingYutRooms()).deleted, 0, 'an active host preserves a waiting room beyond its creation deadline');
  const hostEmote = { action: 'emote', roomId: active.id, kind: 'ready', requestKey: randomUUID() };
  active = (await handlers.commandYutRoom(request(hostEmote))).room;
  assert.equal(active.hostActivityAtMs, clock);
  assert.equal(active.expiresAtMs, clock + core.YUT_WAITING_MS);
  assert.equal((await db.doc(`${base}/yut_codes/ABC236`).get()).data().expiresAtMs, active.expiresAtMs, 'host actions extend the same room invite code');
  const deadline = active.expiresAtMs;
  clock += 6000;
  assert.equal((await handlers.commandYutRoom(request(hostEmote))).room.expiresAtMs, deadline, 'receipt retries do not renew activity');
  await handlers.getYutLobby(request({}));
  assert.equal((await db.doc(`${base}/yut_rooms/${active.id}`).get()).data().expiresAtMs, deadline, 'lobby reads are not host activity');
  active = (await handlers.commandYutRoom(asGuest({ action: 'emote', roomId: active.id, kind: 'ready', requestKey: randomUUID() }))).room;
  assert.equal(active.expiresAtMs, deadline, 'guest emotes do not extend host inactivity');
  active = (await handlers.commandYutRoom(asLate({ action: 'join', code: active.code, requestKey: randomUUID() }))).room;
  assert.equal(active.players.length, 3, 'a renewed invite admits a guest after the original creation deadline');
  await assert.rejects(handlers.commandYutRoom(asGuest({ action: 'kick', roomId: active.id, targetUid: 'expiry-late', expectedRevision: active.revision, requestKey: randomUUID() })), error => error.code === 'failed-precondition');
  const kick = { action: 'kick', roomId: active.id, targetUid: 'expiry-guest', expectedRevision: active.revision, requestKey: randomUUID() };
  active = (await handlers.commandYutRoom(request(kick))).room;
  assert.equal(active.participantUids.includes('expiry-guest'), false);
  const removed = (await db.doc(`${base}/yut_players/expiry-guest`).get()).data();
  assert.equal(removed.roomId, null);
  assert.equal(removed.commands[0].key, 'guest-history', 'kick preserves command receipts');
  assert.equal((await handlers.getYutLobby(asGuest({}))).room, null);
  await assert.rejects(handlers.commandYutRoom(asGuest({ action: 'emote', roomId: active.id, kind: 'ready', requestKey: randomUUID() })), error => error.code === 'permission-denied');
  const kickedRevision = active.revision;
  clock += 1000;
  assert.equal((await handlers.commandYutRoom(request(kick))).room.revision, kickedRevision, 'kick response recovery cannot remove twice');
  await assert.rejects(handlers.commandYutRoom(request({ ...kick, targetUid: 'expiry-late' })), error => error.code === 'already-exists');
  // Readying and removal share the room revision; a stale kick cannot remove a ready player.
  active = (await handlers.commandYutRoom(asLate({ action: 'ready', ready: true, roomId: active.id, expectedRevision: active.revision, requestKey: randomUUID() }))).room;
  await assert.rejects(handlers.commandYutRoom(request({ action: 'kick', roomId: active.id, targetUid: 'expiry-late', expectedRevision: kickedRevision, requestKey: randomUUID() })), error => error.code === 'aborted');
  await assert.rejects(handlers.commandYutRoom(request({ action: 'kick', roomId: active.id, targetUid: 'expiry-late', expectedRevision: active.revision, requestKey: randomUUID() })), error => error.code === 'failed-precondition');
  clock = active.expiresAtMs - 1;
  assert.equal((await handlers.getYutLobby(request({}))).room.id, active.id);
  clock += 1;
  assert.equal((await handlers.getYutLobby(request({}))).room, null);
  assert.equal((await handlers.cleanupWaitingYutRooms()).deleted, 1, 'ten minutes without host action removes the waiting room');
  assert.equal((await db.doc(`${base}/yut_rooms/${active.id}`).get()).exists, false);
  console.log('PASS exact host-idle deadline, ready emote renewal, guest/read/retry exclusion, renewed invite admission, kick authorization/readiness/revision/idempotency, legacy and cross-semester cleanup, pointer/code ownership');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await db.terminate();
});
