const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const projectId = 'demo-westory-session-yut';
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) {
  throw new Error('Yut integration tests only run on the dedicated local demo emulator.');
}
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const deployed = require('../index');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const db = getFirestore(), base = 'years/2026/semesters/2';
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const uid = (label) => `yut-${label}`;
const sessionPath = (label) => `application_sessions/${uid(label)}/sessions/${authTime}`;
const request = (label, data = {}) => ({ auth: { uid: uid(label), token: { email: `${label}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { year: '2026', semester: '2', _session: proof, ...data } });
const key = () => randomUUID();
async function command(label, action, data = {}) {
  // Keep tests fast without changing the production throttle or guard code.
  await db.doc(`${base}/yut_players/${uid(label)}`).set({ lastCommandAtMs: 0 }, { merge: true });
  return deployed.commandYutRoom.run(request(label, { action, requestKey: key(), ...data }));
}
async function roomCommand(label, room, action, data = {}) {
  return command(label, action, { roomId: room.id, expectedRevision: room.revision, ...data });
}
const denied = (promise, codes = ['permission-denied']) => assert.rejects(promise, (error) => codes.includes(error.code));
const token = (label) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: uid(label), user_id: uid(label), email: `${label}@yongshin-ms.ms.kr`, email_verified: true, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: authTime, exp: authTime + 7200, auth_time: authTime, firebase: { sign_in_provider: 'google.com' } })}.`;
};
const rest = (label, path, options = {}) => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
  ...options, headers: { Authorization: `Bearer ${token(label)}`, 'Content-Type': 'application/json', ...options.headers },
});

(async () => {
  assert.deepEqual(deployed.commandYutRoom.__endpoint.region, ['asia-northeast3']);
  assert.deepEqual(deployed.getYutLobby.__endpoint.region, ['asia-northeast3']);
  const seed = {
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    'semester_classes/class_one': { semesterId: '2026-2', status: 'ACTIVE', grade: '1', classNumber: '1', displayName: '1학년 1반' },
    'semester_classes/class_two': { semesterId: '2026-2', status: 'ACTIVE', grade: '1', classNumber: '2', displayName: '1학년 2반' },
  };
  for (const label of ['a', 'b', 'c', 'd', 'e', 'outsider', 'teacher', 'staff']) {
    const role = label === 'teacher' ? 'teacher' : label === 'staff' ? 'staff' : 'student';
    seed[`users/${uid(label)}`] = { role, name: '테스트학생', registrationApprovalStatus: 'APPROVED', studentNumber: '1' };
    seed[sessionPath(label)] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    if (role === 'student') {
      const slotId = 'slot_' + createHash('sha256').update(`2026-2\n${uid(label)}`).digest('hex').slice(0, 40);
      seed[`semester_enrollment_slots/${slotId}`] = { studentUid: uid(label), semesterId: '2026-2', activeEnrollmentId: `enrollment_${label}`, status: 'ACTIVE' };
      seed[`semester_enrollments/enrollment_${label}`] = { studentUid: uid(label), semesterId: '2026-2', enrollmentStatus: 'ACTIVE', classId: label === 'outsider' ? 'class_two' : 'class_one' };
    }
  }
  try {
    const batch = db.batch(); for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data); await batch.commit();
    await denied(deployed.getYutLobby.run({ data: request('a').data }), ['unauthenticated']);
    await denied(deployed.getYutLobby.run(request('a', { _session: null })), ['unauthenticated']);
    await denied(deployed.getYutLobby.run(request('staff')));
    const teacherLobby = await deployed.getYutLobby.run(request('teacher'));
    assert.deepEqual(teacherLobby.classes, [{ id: 'school', label: '전체 학생' }]);
    assert.equal(teacherLobby.classId, 'school', 'cached teacher client may still create without a real class selection');
    assert.deepEqual((await deployed.getYutLobby.run(request('a'))).classes, []);
    const creation = request('a', { action: 'create', requestKey: key(), classId: 'class_two' });
    const [created, retry] = await Promise.all([deployed.commandYutRoom.run(creation), deployed.commandYutRoom.run(creation)]);
    let room = created.room;
    assert.equal(retry.room.id, room.id); assert.equal(room.classId, ''); assert.match(room.players[0].name, /○/);
    const createReceipt = (await db.doc(`${base}/yut_players/${uid('a')}`).get()).data().commands[0];
    assert.equal(createReceipt.fingerprint, createHash('sha256').update(JSON.stringify(['create', '', null, '', 'class_two', null, '', ''])).digest('hex'), 'existing game request fingerprint stays compatible across deployment');
    assert.equal(Object.hasOwn(room, 'enrollmentIds'), false);
    await denied(deployed.commandYutRoom.run(request('a', { action: 'join', requestKey: creation.data.requestKey, code: room.code })), ['already-exists']);
    await db.doc('semester_enrollments/enrollment_outsider').update({ enrollmentStatus: 'INACTIVE' });
    await denied(command('outsider', 'join', { code: room.code }));
    await db.doc('semester_enrollments/enrollment_outsider').update({ enrollmentStatus: 'ACTIVE', semesterId: '2026-1' });
    await denied(command('outsider', 'join', { code: room.code }));
    await db.doc('semester_enrollments/enrollment_outsider').update({ semesterId: '2026-2' });
    await db.doc('semester_classes/class_two').update({ status: 'ARCHIVED' });
    await denied(command('outsider', 'join', { code: room.code }));
    await db.doc('semester_classes/class_two').update({ status: 'ACTIVE' });
    // Simulate an already-open room created before the cross-class/emote patch.
    await db.doc(`${base}/yut_rooms/${room.id}`).update({ classId: 'class_one', classLabel: '1학년 1반', syncRevision: FieldValue.delete(), emotes: FieldValue.delete() });
    room = (await command('outsider', 'join', { code: room.code })).room;
    assert.equal(room.players.length, 2, 'another active class joins a legacy room by code');
    assert.equal((await rest('outsider', `${base}/yut_rooms/${room.id}`)).status, 200, 'cross-class participant read');
    assert.equal(room.syncRevision, room.revision, 'legacy gameplay advances sync revision');
    await roomCommand('outsider', room, 'leave');
    room = (await deployed.getYutLobby.run(request('a'))).room;
    await denied(command('staff', 'join', { code: room.code }));
    await denied(roomCommand('b', room, 'throw'));
    await denied(command('a', 'create'), ['failed-precondition']);
    room = (await command('b', 'join', { code: room.code })).room;
    const joinRequest = request('c', { action: 'join', requestKey: key(), code: room.code });
    const joins = await Promise.all([deployed.commandYutRoom.run(joinRequest), deployed.commandYutRoom.run(joinRequest)]);
    assert.equal(joins[0].room.players.length, 3); assert.equal(joins[1].room.players.length, 3);
    room = joins[0].room;
    const attempts = await Promise.allSettled(['d', 'e'].map((label) => deployed.commandYutRoom.run(request(label, { action: 'join', requestKey: key(), code: room.code }))));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    room = attempts.find((result) => result.status === 'fulfilled').value.room;
    assert.equal(room.players.length, 4);
    await denied(roomCommand('b', room, 'start'));
    await denied(roomCommand('a', room, 'start'), ['failed-precondition']);
    for (const player of room.players.slice(1)) room = (await roomCommand(player.uid.slice(4), room, 'ready', { ready: true })).room;
    room = (await roomCommand('a', room, 'start')).room;
    await denied(roomCommand('b', room, 'throw'), ['failed-precondition']);
    await denied(roomCommand('outsider', room, 'emote', { kind: 'hello' }));
    await denied(roomCommand('b', room, 'emote', { kind: 'free text' }), ['invalid-argument']);
    await denied(roomCommand('b', room, 'emote', { kind: 'hello', text: 'arbitrary chat' }), ['invalid-argument']);
    const emoteRequest = request('b', { action: 'emote', requestKey: key(), roomId: room.id, kind: 'hello' });
    const beforeEmote = room;
    const emote = (await deployed.commandYutRoom.run(emoteRequest)).room;
    assert.equal(emote.revision, beforeEmote.revision);
    assert.equal(emote.syncRevision, beforeEmote.syncRevision + 1);
    assert.equal(emote.turnDeadlineMs, beforeEmote.turnDeadlineMs);
    assert.deepEqual(emote.lastEvent, beforeEmote.lastEvent);
    assert.deepEqual(emote.players, beforeEmote.players);
    assert.deepEqual(emote.emotes[uid('b')], { id: emoteRequest.data.requestKey, uid: uid('b'), kind: 'hello', atMs: emote.emotes[uid('b')].atMs });
    const emoteRetry = await deployed.commandYutRoom.run(request('b', { ...emoteRequest.data, expectedRevision: 0 }));
    assert.deepEqual(emoteRetry.room.emotes, emote.emotes, 'idempotent retry never restarts display time');
    assert.equal(emoteRetry.room.syncRevision, emote.syncRevision);
    await denied(deployed.commandYutRoom.run(request('b', { ...emoteRequest.data, kind: 'nice' })), ['already-exists']);
    await denied(roomCommand('b', room, 'emote', { kind: 'nice' }), ['resource-exhausted']);
    room = emote;
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastCommandAtMs: 0 });
    const throwRequest = request('a', { action: 'throw', requestKey: key(), roomId: room.id, expectedRevision: room.revision, value: 5 });
    const throws = await Promise.all([
      deployed.commandYutRoom.run(throwRequest), deployed.commandYutRoom.run(throwRequest),
      deployed.commandYutRoom.run(request('a', { action: 'emote', requestKey: key(), roomId: room.id, expectedRevision: 0, kind: 'wow' })),
      deployed.commandYutRoom.run(request('c', { action: 'emote', requestKey: key(), roomId: room.id, kind: 'nice' })),
    ]);
    assert.deepEqual(throws[0].room.pendingThrow, throws[1].room.pendingThrow);
    assert.equal(throws[0].room.revision, room.revision + 1);
    const afterRace = (await deployed.getYutLobby.run(request('a'))).room;
    assert.equal(afterRace.revision, room.revision + 1, 'emotes never conflict with gameplay CAS');
    assert.equal(afterRace.syncRevision, room.syncRevision + 3);
    assert.equal(afterRace.emotes[uid('a')].kind, 'wow');
    assert.equal(afterRace.emotes[uid('c')].kind, 'nice');
    assert.equal(Object.keys(afterRace.emotes).length, 3, 'concurrent emotes preserve all participants');
    room = afterRace;
    await denied(roomCommand('a', room, 'move', { pieceId: '1', route: 'a' }), ['failed-precondition']);
    await denied(roomCommand('b', room, 'skip'), ['failed-precondition']);
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastCommandAtMs: 0 });
    const moves = await Promise.allSettled([1, 2].map((piece) => deployed.commandYutRoom.run(request('a', { action: 'move', requestKey: key(), roomId: room.id, expectedRevision: room.revision, pieceId: String(piece), route: 'outer' }))));
    assert.equal(moves.filter((result) => result.status === 'fulfilled').length, 1);
    room = moves.find((result) => result.status === 'fulfilled').value.room;
    assert.equal((await deployed.getYutLobby.run(request('b'))).room.revision, room.revision);
    const path = `${base}/yut_rooms/${room.id}`;
    assert.equal((await rest('a', path)).status, 200, 'member room read');
    assert.equal((await rest('outsider', path)).status, 403, 'nonparticipant read');
    assert.equal((await rest('teacher', path)).status, 403, 'teacher nonparticipant read');
    assert.equal((await rest('a', `${base}/yut_rooms`)).status, 403, 'room enumeration');
    assert.equal((await rest('a', `${base}/yut_codes/${room.code}`)).status, 403, 'join code lookup');
    assert.equal((await rest('a', path, { method: 'PATCH', body: JSON.stringify({ fields: { revision: { integerValue: '999' } } }) })).status, 403, 'client game mutation');
    assert.equal((await rest('a', path, { method: 'PATCH', body: JSON.stringify({ fields: { emotes: { stringValue: 'arbitrary text' } } }) })).status, 403, 'client emote mutation');
    const bSlot = 'slot_' + createHash('sha256').update(`2026-2\n${uid('b')}`).digest('hex').slice(0, 40);
    await db.doc(`semester_enrollment_slots/${bSlot}`).update({ activeEnrollmentId: 'replaced_enrollment' });
    assert.equal((await rest('b', path)).status, 403, 'replaced canonical slot while old enrollment remains active');
    await denied(deployed.getYutLobby.run(request('b')));
    await db.doc(`semester_enrollment_slots/${bSlot}`).update({ activeEnrollmentId: 'enrollment_b' });
    await db.doc('semester_enrollments/enrollment_b').update({ classId: 'class_two' });
    assert.equal((await rest('b', path)).status, 200, 'active transfer to another class retains current match');
    assert.equal((await deployed.getYutLobby.run(request('b'))).room.id, room.id);
    await db.doc('semester_enrollments/enrollment_b').update({ enrollmentStatus: 'INACTIVE' });
    assert.equal((await rest('b', path)).status, 403, 'inactive participant enrollment read');
    await denied(roomCommand('b', room, 'emote', { kind: 'thanks' }));
    await db.doc('semester_enrollments/enrollment_b').update({ enrollmentStatus: 'ACTIVE' });
    await db.doc('semester_classes/class_two').update({ readOnly: true });
    assert.equal((await rest('b', path)).status, 403, 'participant own class must remain active and writable');
    await denied(deployed.getYutLobby.run(request('b')));
    await db.doc('semester_classes/class_two').update({ readOnly: false });
    await db.doc('semester_enrollments/enrollment_b').update({ classId: 'class_one' });
    await db.doc(sessionPath('b')).update({ status: 'revoked' });
    await denied(deployed.getYutLobby.run(request('b')), ['unauthenticated']);
    assert.equal((await rest('b', path)).status, 403, 'revoked session read');
    await db.doc(sessionPath('b')).update({ status: 'active' });
    await db.doc('site_settings/student_maintenance').set({ enabled: true, blockedRoles: ['student'], bypassUids: [], title: '점검', message: '점검 중', startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: uid('teacher'), revision: 1 });
    await denied(deployed.getYutLobby.run(request('b')));
    assert.equal((await rest('b', path)).status, 403, 'maintenance read');
    await db.doc('site_settings/student_maintenance').delete();
    await db.doc(path).update({ turnDeadlineMs: Date.now() - 1 });
    room = (await roomCommand('b', room, 'skip')).room;
    assert.equal(room.phase, 'throw');
    await denied(roomCommand('a', room, 'throw', { expectedRevision: room.revision - 1 }), ['aborted']);
    await db.doc('site_settings/config').update({ semester: '1' });
    await denied(deployed.getYutLobby.run(request('b')), ['failed-precondition']);
    assert.equal((await rest('b', path)).status, 403, 'old semester read');
    await db.doc('site_settings/config').update({ semester: '2' });
    const closed = await roomCommand('teacher', room, 'close'); assert.equal(closed.room, null);
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastEmoteAtMs: 0 });
    await denied(roomCommand('a', room, 'emote', { kind: 'gg' }), ['failed-precondition']);
    assert.equal((await deployed.getYutLobby.run(request('a'))).room, null);
    const fresh = await command('a', 'create'); assert.notEqual(fresh.room.id, room.id);
    const teacherRoom = await command('teacher', 'create', { classId: teacherLobby.classId });
    assert.equal(teacherRoom.room.classId, '', 'virtual legacy selector cannot bind a room to a class');
    assert.equal((await rest('teacher', `${base}/yut_rooms/${teacherRoom.room.id}`)).status, 200, 'teacher participant read');
    await command('b', 'join', { code: fresh.room.code });
    await db.doc('semester_enrollments/enrollment_b').update({ classId: 'class_two' });
    assert.equal((await deployed.getYutLobby.run(request('b'))).room.id, fresh.room.id);
    await denied(command('b', 'create'), ['failed-precondition']);
    await db.doc('semester_enrollments/replaced_enrollment').set({ ...(await db.doc('semester_enrollments/enrollment_b').get()).data() });
    await db.doc(`semester_enrollment_slots/${bSlot}`).update({ activeEnrollmentId: 'replaced_enrollment' });
    assert.equal((await deployed.getYutLobby.run(request('b'))).room, null, 'canonical enrollment replacement still revokes membership');
    const transferred = await command('b', 'create');
    assert.equal(transferred.room.classId, '');
    assert.equal((await db.doc(`${base}/yut_rooms/${fresh.room.id}`).get()).data().participantUids.includes(uid('b')), false);
    let staleRoster = (await command('c', 'join', { code: fresh.room.code })).room;
    staleRoster = (await roomCommand('c', staleRoster, 'ready', { ready: true })).room;
    await db.doc('semester_enrollments/enrollment_c').update({ enrollmentStatus: 'INACTIVE' });
    await denied(roomCommand('a', staleRoster, 'start'), ['failed-precondition']);
    await db.doc('semester_enrollments/enrollment_c').update({ enrollmentStatus: 'ACTIVE', classId: 'class_two' });
    await db.doc(`users/${uid('c')}`).update({ registrationApprovalStatus: null });
    await denied(roomCommand('a', staleRoster, 'start'), ['failed-precondition']);
    await db.doc(`users/${uid('c')}`).update({ registrationApprovalStatus: 'APPROVED', role: 'staff', teacherPortalEnabled: false });
    await denied(roomCommand('a', staleRoster, 'start'), ['failed-precondition']);
    await db.doc(`users/${uid('c')}`).update({ role: 'student' });
    const started = (await roomCommand('a', staleRoster, 'start')).room;
    assert.equal(started.status, 'playing');
    await roomCommand('teacher', started, 'close');
    assert.equal((await deployed.getYutLobby.run(request('teacher'))).room.id, teacherRoom.room.id, 'closing another room preserves own active room');
    console.log('PASS Yut actual callable guards, cross-class legacy rooms, canonical enrollment/slot protection, fixed emote allowlist/cooldown/idempotency, concurrent game/emote and join/move races, reconnect, server deadline, Firestore get-only permissions, revocation, maintenance, semester switch and teacher close');
  } finally {
    // This emulator/project was checked before importing any Admin SDK code.
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    await db.terminate();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
