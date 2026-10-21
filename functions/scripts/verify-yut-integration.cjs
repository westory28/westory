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
  // Authorization/concurrency cases advance past visual grace without sleeping.
  // Exact animation/throw/move boundaries are exercised by the shared core tests.
  if (['throw', 'move'].includes(action) && room.turnUid === uid(label)) await db.doc(`${base}/yut_rooms/${room.id}`).update({ phaseStartsAtMs: 0, turnDeadlineMs: Date.now() + 60000 });
  return command(label, action, { roomId: room.id, expectedRevision: room.revision, ...data });
}
const denied = (promise, codes = ['permission-denied']) => assert.rejects(promise, (error) => codes.includes(error.code));
const token = (label) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: uid(label), user_id: uid(label), email: label === 'admin' ? 'westoria28@gmail.com' : `${label}@yongshin-ms.ms.kr`, email_verified: true, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: authTime, exp: authTime + 7200, auth_time: authTime, firebase: { sign_in_provider: 'google.com' } })}.`;
};
const rest = (label, path, options = {}) => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
  ...options, headers: { Authorization: `Bearer ${token(label)}`, 'Content-Type': 'application/json', ...options.headers },
});

(async () => {
  assert.deepEqual(deployed.commandYutRoom.__endpoint.region, ['asia-northeast3']);
  assert.deepEqual(deployed.getYutLobby.__endpoint.region, ['asia-northeast3']);
  assert.deepEqual(deployed.getYutManagement.__endpoint.region, ['asia-northeast3']);
  assert.deepEqual(deployed.saveYutSettings.__endpoint.region, ['asia-northeast3']);
  const seed = {
    'site_settings/config': { year: '2026', semester: '2' },
    // Production keeps the maintenance document even when student access is open.
    // Omitting it hides the realtime-rule document access budget regression.
    'site_settings/student_maintenance': {
      enabled: false, blockedRoles: ['student'], bypassUids: Array.from({ length: 20 }, (_, i) => `maintenance-bypass-${i}`),
      title: '점검', message: '점검 중입니다.', startedAt: null,
      updatedAt: Timestamp.now(), updatedBy: 'test-admin', revision: 1,
    },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    'semester_classes/class_one': { semesterId: '2026-2', status: 'ACTIVE', grade: '1', classNumber: '1', displayName: '1학년 1반' },
    'semester_classes/class_two': { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: '2', displayName: '이전 학급 표시' },
  };
  for (const label of ['a', 'b', 'c', 'd', 'e', 'outsider', 'teacher', 'admin', 'staff', 'qa', 'qb', 'qc', 'p1', 'p2', 'p3', 'p4']) {
    const role = ['teacher', 'admin'].includes(label) ? 'teacher' : label === 'staff' ? 'staff' : 'student';
    seed[`users/${uid(label)}`] = { role, name: '테스트학생', registrationApprovalStatus: 'APPROVED', studentNumber: '1' };
    seed[sessionPath(label)] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    if (role === 'student') {
      const slotId = 'slot_' + createHash('sha256').update(`2026-2\n${uid(label)}`).digest('hex').slice(0, 40);
      seed[`semester_enrollment_slots/${slotId}`] = { studentUid: uid(label), semesterId: '2026-2', activeEnrollmentId: `enrollment_${label}`, status: 'ACTIVE' };
      seed[`semester_enrollments/enrollment_${label}`] = { studentUid: uid(label), semesterId: '2026-2', enrollmentStatus: 'ACTIVE', classId: label === 'outsider' ? 'class_two' : 'class_one', studentName: `정규학생-${label}`, studentNumber: '7' };
    }
  }
  seed['semester_enrollments/enrollment_outsider'].studentName = '방재석';
  try {
    const batch = db.batch(); for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data); await batch.commit();
    for (const label of ['teacher', 'admin']) {
      const annotationPath = `${base}/lesson_presentations/fixture/teachers/${uid(label)}`;
      for (const path of [annotationPath, `${annotationPath}/classes/class_one`]) {
        await db.doc(path).set({ annotations: ['legacy-fixture'] });
        assert.equal((await rest(label, path)).status, 403, 'retired annotation data cannot be read by teachers or admins');
        assert.equal((await rest(label, path, { method: 'PATCH', body: JSON.stringify({ fields: { annotations: { stringValue: 'blocked' } } }) })).status, 403, 'retired annotation writes remain blocked for cached clients');
        assert.equal((await rest(label, path, { method: 'DELETE' })).status, 403, 'retirement does not permit deleting stored annotations');
      }
    }
    await denied(deployed.getYutLobby.run({ data: request('a').data }), ['unauthenticated']);
    await denied(deployed.getYutLobby.run(request('a', { _session: null })), ['unauthenticated']);
    await denied(deployed.getYutLobby.run(request('staff')));
    await denied(deployed.getYutLobby.run(request('a')));
    await denied(command('a', 'create'));
    const defaultManagement = await deployed.getYutManagement.run(request('teacher'));
    assert.deepEqual(defaultManagement.settings, { enabled: false, version: 0, allowSolo: true, allowMultiplayer: true, allowPrivateRooms: true, defaultPlayerCount: 4, throwSeconds: 5, moveSeconds: 25 });
    assert.deepEqual(defaultManagement.rooms, []);
    await denied(deployed.getYutManagement.run(request('a')));
    await denied(deployed.saveYutSettings.run(request('a', { enabled: true, expectedVersion: 0 })));
    await db.doc(`${base}/weplay_games/joseon-yut`).set({ enabled: 'true', version: 0 });
    await denied(deployed.getYutLobby.run(request('a')));
    const initialSave = await deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: 0 }));
    assert.equal(initialSave.settings.version, 1);
    await denied(deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: 0 })), ['aborted']);
    await denied(deployed.saveYutSettings.run(request('teacher', { enabled: 'true', expectedVersion: 1 })), ['invalid-argument']);
    await db.doc(`users/${uid('staff')}`).update({ teacherPortalEnabled: true, staffPermissions: ['lesson_read'] });
    assert.equal((await deployed.getYutManagement.run(request('staff'))).settings.enabled, true);
    await denied(deployed.saveYutSettings.run(request('staff', { enabled: false, expectedVersion: 1 })));
    await db.doc(`users/${uid('staff')}`).update({ teacherPortalEnabled: false });
    const teacherLobby = await deployed.getYutLobby.run(request('teacher'));
    assert.deepEqual(teacherLobby.classes, [{ id: 'school', label: '전체 학생' }]);
    assert.equal(teacherLobby.classId, 'school', 'cached teacher client may still create without a real class selection');
    assert.deepEqual((await deployed.getYutLobby.run(request('a'))).classes, []);
    assert.equal((await deployed.getYutLobby.run(request('a'))).enabled, true);
    assert.equal((await deployed.getYutLobby.run(request('a'))).playerName, '정규학생-a(1학년 1반)');
    const creation = request('a', { action: 'create', requestKey: key(), classId: 'class_two', name: '위조 이름', grade: '9', classNumber: '99' });
    const [created, retry] = await Promise.all([deployed.commandYutRoom.run(creation), deployed.commandYutRoom.run(creation)]);
    let room = created.room;
    assert.equal(retry.room.id, room.id); assert.equal(room.classId, '');
    assert.equal(room.players[0].name, '정규학생-a(1학년 1반)', 'canonical enrollment/class records override request and profile labels');
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
    assert.equal(room.players.find(player => player.uid === uid('outsider')).name, '방재석(3학년 2반)');
    const crossClassRead = await rest('outsider', `${base}/yut_rooms/${room.id}`);
    assert.equal(crossClassRead.status, 200, `cross-class participant read: ${await crossClassRead.text()}`);
    const maintenanceRef = db.doc('site_settings/student_maintenance');
    await maintenanceRef.update({ enabled: true, startedAt: Timestamp.now(), bypassUids: [uid('outsider')] });
    assert.equal((await rest('outsider', `${base}/yut_rooms/${room.id}`)).status, 200, 'explicit maintenance bypass retains participant read');
    assert.equal((await rest('a', `${base}/yut_rooms/${room.id}`)).status, 403, 'maintenance blocks another participant');
    await maintenanceRef.update({ enabled: false, startedAt: null, bypassUids: [1] });
    assert.equal((await rest('outsider', `${base}/yut_rooms/${room.id}`)).status, 403, 'malformed maintenance configuration still fails closed');
    await maintenanceRef.update({ enabled: true, startedAt: Timestamp.now(), bypassUids: [uid('outsider'), 1] });
    assert.equal((await rest('outsider', `${base}/yut_rooms/${room.id}`)).status, 403, 'a matching bypass cannot rescue another malformed UID');
    await maintenanceRef.update({ enabled: false, startedAt: null, bypassUids: [...seed['site_settings/student_maintenance'].bypassUids.slice(0, 19), ' '] });
    assert.equal((await rest('outsider', `${base}/yut_rooms/${room.id}`)).status, 403, 'the twentieth UID retains whitespace validation');
    await maintenanceRef.set(seed['site_settings/student_maintenance']);
    assert.equal(room.syncRevision, room.revision, 'legacy gameplay advances sync revision');
    // Existing rooms migrate their labels on restore without restarting a turn.
    const roomPath = db.doc(`${base}/yut_rooms/${room.id}`);
    const legacyPlayers = room.players.map(player => ({ ...player, name: '7번 정○○' }));
    await roomPath.update({ players: legacyPlayers, playerNamesVersion: FieldValue.delete() });
    const restored = (await deployed.getYutLobby.run(request('a', { name: '위조 복원 이름' }))).room;
    assert.deepEqual(restored.players.map(player => player.name), ['정규학생-a(1학년 1반)', '방재석(3학년 2반)']);
    assert.equal(restored.revision, room.revision);
    assert.equal(restored.syncRevision, room.syncRevision + 1);
    assert.equal(restored.turnDeadlineMs, room.turnDeadlineMs);
    assert.deepEqual(restored.lastEvent, room.lastEvent);
    assert.deepEqual((await roomPath.get()).data().players, restored.players, 'realtime readers receive refreshed legacy labels');
    assert.equal((await roomPath.get()).data().playerNamesVersion, 1);
    assert.equal((await deployed.getYutLobby.run(request('a'))).room.syncRevision, restored.syncRevision, 'unchanged names do not create repeated writes');
    const identityReads = [];
    const countedHandlers = require('../yut').createYutHandlers({
      db: {
        doc: db.doc.bind(db), collection: db.collection.bind(db),
        runTransaction: callback => db.runTransaction(transaction => callback(new Proxy(transaction, {
          get(target, property) {
            if (property === 'get') return reference => { identityReads.push(reference.path); return target.get(reference); };
            const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
          },
        }))),
      },
    });
    const countedRestore = await countedHandlers.getYutLobby(request('a'));
    assert.equal(countedRestore.room.syncRevision, restored.syncRevision);
    assert.equal(identityReads.includes(`users/${uid('outsider')}`), false, 'migrated room never rereads other participant profiles');
    assert.equal(identityReads.includes('semester_enrollments/enrollment_outsider'), false, 'migrated room never rereads other participant enrollments');
    assert.equal(identityReads.filter(path => path === 'semester_classes/class_one').length, 1, 'only actor authority reads the current classroom');
    await roomPath.update({ playerNamesVersion: FieldValue.delete() });
    const unchangedUpgrade = (await deployed.getYutLobby.run(request('a'))).room;
    assert.equal(unchangedUpgrade.syncRevision, restored.syncRevision, 'version-only upgrade does not change synchronization revision');
    assert.equal(unchangedUpgrade.revision, restored.revision);
    room = restored;
    await roomCommand('outsider', room, 'leave');
    room = (await deployed.getYutLobby.run(request('a'))).room;
    await denied(roomCommand('a', room, 'seat', { seat: 0, blocked: true }), ['failed-precondition']);
    await denied(roomCommand('a', room, 'seat', { seat: 4, blocked: true }), ['invalid-argument']);
    room = (await roomCommand('a', room, 'seat', { seat: 1, blocked: true })).room;
    room = (await roomCommand('a', room, 'seat', { seat: 3, blocked: true })).room;
    await denied(roomCommand('a', room, 'seat', { seat: 2, blocked: true }), ['failed-precondition']);
    room = (await command('outsider', 'join', { code: room.code })).room;
    assert.equal(room.players.find((player) => player.uid === uid('outsider')).role, 'gong');
    await denied(command('b', 'join', { code: room.code }), ['failed-precondition']);
    await denied(roomCommand('outsider', room, 'seat', { seat: 1, blocked: false }), ['failed-precondition']);
    await roomCommand('outsider', room, 'leave');
    room = (await deployed.getYutLobby.run(request('a'))).room;
    room = (await roomCommand('a', room, 'seat', { seat: 1, blocked: false })).room;
    room = (await roomCommand('a', room, 'seat', { seat: 3, blocked: false })).room;
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastCommandAtMs: 0 });
    await db.doc(`${base}/yut_players/${uid('outsider')}`).update({ lastCommandAtMs: 0 });
    const seatRace = await Promise.allSettled([
      deployed.commandYutRoom.run(request('a', { action: 'seat', requestKey: key(), roomId: room.id, expectedRevision: room.revision, seat: 1, blocked: true })),
      deployed.commandYutRoom.run(request('outsider', { action: 'join', requestKey: key(), code: room.code })),
    ]);
    assert.equal(seatRace[1].status, 'fulfilled');
    room = (await deployed.getYutLobby.run(request('a'))).room;
    assert.equal(room.players.some((player) => (room.blockedSeats || []).includes(['sa', 'nong', 'gong', 'sang'].indexOf(player.role))), false, 'concurrent join and seat closure never occupy a blocked seat');
    await roomCommand('outsider', room, 'leave');
    room = (await deployed.getYutLobby.run(request('a'))).room;
    room = (await roomCommand('a', room, 'seat', { seat: 1, blocked: false })).room;
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
    assert.equal(room.rulesVersion, 2); assert.equal(room.pieceCount, 2);
    assert.equal(room.players.every(player => player.pieces.length === 2), true);
    await denied(roomCommand('a', room, 'seat', { seat: 1, blocked: false }), ['failed-precondition']);
    const managed = await deployed.getYutManagement.run(request('teacher'));
    assert.equal(managed.rooms.length, 1);
    assert.equal(managed.rooms[0].players[0].name, '정규학생-a(1학년 1반)', 'teacher monitor uses the same canonical display format');
    assert.equal(managed.rooms[0].players[0].studentNumber, '7');
    assert.equal(managed.rooms[0].players[0].classLabel, '1학년 1반');
    assert.equal(Object.hasOwn(managed.rooms[0], 'enrollmentIds'), false);
    assert.deepEqual(managed.rooms[0].leadingUids, room.players.map(player => player.uid), 'new game has tied leaders');
    assert.equal(managed.rooms[0].standings.every(player => player.finishedPieces === 0 && player.totalPieces === 2), true);
    const monitorRoomRef = db.doc(`${base}/yut_rooms/${room.id}`);
    const beforeMonitor = (await monitorRoomRef.get()).data();
    await deployed.getYutManagement.run(request('teacher'));
    assert.deepEqual((await monitorRoomRef.get()).data(), beforeMonitor, 'monitor summary never changes gameplay, revision or clocks');
    await denied(deployed.getYutManagement.run(request('a')));
    await db.doc(`users/${uid('staff')}`).update({ teacherPortalEnabled: true });
    await denied(roomCommand('staff', room, 'close'));
    assert.equal((await deployed.getYutManagement.run(request('staff'))).rooms.length, 1);
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
    await denied(roomCommand('a', room, 'throw', { power: 1.1 }), ['invalid-argument']);
    const throwRequest = request('a', { action: 'throw', requestKey: key(), roomId: room.id, expectedRevision: room.revision, value: 5, power: .8 });
    const throws = await Promise.all([
      deployed.commandYutRoom.run(throwRequest), deployed.commandYutRoom.run(throwRequest),
      deployed.commandYutRoom.run(request('a', { action: 'emote', requestKey: key(), roomId: room.id, expectedRevision: 0, kind: 'wow' })),
      deployed.commandYutRoom.run(request('c', { action: 'emote', requestKey: key(), roomId: room.id, kind: 'angry' })),
    ]);
    assert.deepEqual(throws[0].room.pendingThrow, throws[1].room.pendingThrow);
    assert.equal(throws[0].room.revision, room.revision + 1);
    const afterRace = (await deployed.getYutLobby.run(request('a'))).room;
    assert.equal(afterRace.revision, room.revision + 1, 'emotes never conflict with gameplay CAS');
    assert.equal(afterRace.syncRevision, room.syncRevision + 3);
    assert.equal(afterRace.emotes[uid('a')].kind, 'wow');
    assert.equal(afterRace.emotes[uid('c')].kind, 'angry');
    assert.equal(afterRace.players[0].lastThrow.power, .8);
    assert.equal(afterRace.players[0].lastThrow.value, afterRace.pendingThrow.value);
    const aLastThrow = afterRace.players[0].lastThrow;
    assert.equal(Object.keys(afterRace.emotes).length, 3, 'concurrent emotes preserve all participants');
    room = afterRace;
    await denied(roomCommand('a', room, 'move', { pieceId: '1', route: 'a' }), ['failed-precondition']);
    await denied(roomCommand('b', room, 'skip'), ['failed-precondition']);
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastCommandAtMs: 0 });
    const moves = await Promise.allSettled([1, 2].map(() => deployed.commandYutRoom.run(request('a', { action: 'move', requestKey: key(), roomId: room.id, expectedRevision: room.revision, pieceId: '1', route: 'outer' }))));
    assert.equal(moves.filter((result) => result.status === 'fulfilled').length, 1);
    room = moves.find((result) => result.status === 'fulfilled').value.room;
    assert.deepEqual(room.players[0].lastThrow, aLastThrow, 'moving preserves the player last throw');
    assert.equal((await deployed.getYutLobby.run(request('b'))).room.revision, room.revision);
    const path = `${base}/yut_rooms/${room.id}`;
    // Synthetic persisted positions exercise the actual session/authority/CAS
    // command wrapper; clients still cannot write positions or grouping fields.
    const stackPlayers = room.players.map(player => ({ ...player, pieces: player.pieces.map((piece, index) => ({ id: piece.id, node: player.uid === uid('a') ? (index ? 'o5' : 'o4') : 'home', lane: 'outer' })) }));
    await db.doc(path).update({ players: stackPlayers, turnUid: uid('a'), phase: 'move', phaseStartsAtMs: 0, turnDeadlineMs: Date.now() + 60000, pendingThrow: { value: 1, label: '도', sticks: [true, false, false, false] } });
    room = (await db.doc(path).get()).data();
    await denied(roomCommand('a', room, 'move', { pieceId: '1', route: 'outer', stack: 'yes' }), ['invalid-argument']);
    await denied(roomCommand('outsider', room, 'move', { pieceId: '1', route: 'outer', stack: true }));
    await denied(roomCommand('b', room, 'move', { pieceId: '1', route: 'outer', stack: true }), ['failed-precondition']);
    await db.doc(`${base}/yut_players/${uid('a')}`).update({ lastCommandAtMs: 0 });
    const stackRequest = request('a', { action: 'move', requestKey: key(), roomId: room.id, expectedRevision: room.revision, pieceId: '1', route: 'outer', stack: true });
    const stackRetries = await Promise.all([deployed.commandYutRoom.run(stackRequest), deployed.commandYutRoom.run(stackRequest)]);
    assert.equal(stackRetries[0].room.revision, room.revision + 1);
    assert.deepEqual(stackRetries[0].room.players, stackRetries[1].room.players);
    assert.ok(stackRetries[0].room.players[0].pieces[0].stackId);
    assert.equal(stackRetries[0].room.players[0].pieces[0].stackId, stackRetries[0].room.players[0].pieces[1].stackId);
    assert.equal(stackRetries[0].room.lastEvent.move.stacked, true);
    await denied(deployed.commandYutRoom.run(request('a', { ...stackRequest.data, stack: false })), ['already-exists']);
    room = stackRetries[0].room;
    await db.doc(path).update({ players: stackPlayers, turnUid: uid('a'), phase: 'move', phaseStartsAtMs: 0, turnDeadlineMs: Date.now() + 60000, pendingThrow: { value: 1, label: '도', sticks: [true, false, false, false] } });
    room = (await roomCommand('a', room, 'move', { pieceId: '1', route: 'outer' })).room;
    assert.equal(room.players[0].pieces.every(piece => !piece.stackId), true, 'omitting stack never merges new-version pieces');
    assert.equal(room.lastEvent.move.stacked, false);
    assert.deepEqual(room.lastEvent.move.movingPieceIds, ['1']);
    const publicationBeforeMalformed = (await db.doc(`${base}/weplay_games/joseon-yut`).get()).data();
    await db.doc(`${base}/weplay_games/joseon-yut`).update({ version: 'malformed' });
    assert.equal((await rest('a', path)).status, 403, 'malformed publication fails closed for existing rooms');
    await denied(deployed.getYutLobby.run(request('a')));
    await db.doc(`${base}/weplay_games/joseon-yut`).set(publicationBeforeMalformed);
    const competingSettings = await Promise.allSettled([true, false].map((enabled) => deployed.saveYutSettings.run(request('teacher', { enabled, expectedVersion: 1 }))));
    assert.equal(competingSettings.filter((result) => result.status === 'fulfilled').length, 1, 'publication CAS serializes simultaneous saves');
    const currentSettings = (await deployed.getYutManagement.run(request('teacher'))).settings;
    const closedSettings = await deployed.saveYutSettings.run(request('teacher', { enabled: false, expectedVersion: currentSettings.version }));
    await denied(deployed.getYutLobby.run(request('a')));
    await denied(deployed.commandYutRoom.run(creation));
    await denied(roomCommand('a', room, 'emote', { kind: 'hello' }));
    await denied(roomCommand('a', room, 'leave'));
    assert.equal((await rest('a', path)).status, 403, 'closed publication denies cached participant reads');
    assert.equal((await deployed.getYutLobby.run(request('teacher'))).enabled, false);
    await deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: closedSettings.settings.version }));
    assert.equal((await rest('a', path)).status, 200, 'member room read');
    assert.equal((await rest('outsider', path)).status, 403, 'nonparticipant read');
    assert.equal((await rest('teacher', path)).status, 403, 'teacher nonparticipant read');
    assert.equal((await rest('a', `${base}/yut_rooms`)).status, 403, 'room enumeration');
    assert.equal((await rest('a', `${base}/yut_codes/${room.code}`)).status, 403, 'join code lookup');
    assert.equal((await rest('a', `${base}/weplay_games/joseon-yut`, { method: 'PATCH', body: JSON.stringify({ fields: { enabled: { booleanValue: true }, version: { integerValue: '99' } } }) })).status, 403, 'client publication write');
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
    const beforeCloseSettings = (await deployed.getYutManagement.run(request('teacher'))).settings;
    await deployed.saveYutSettings.run(request('teacher', { enabled: false, expectedVersion: beforeCloseSettings.version }));
    assert.equal((await rest('teacher', `${base}/yut_rooms/${teacherRoom.room.id}`)).status, 200, 'teacher participant read remains available while unpublished');
    assert.equal((await deployed.getYutManagement.run(request('teacher'))).rooms.some((entry) => entry.id === started.id), false, 'closed rooms excluded from monitoring');
    const completedRoomBatch = db.batch();
    for (let index = 0; index < 205; index += 1) completedRoomBatch.set(db.doc(`${base}/yut_rooms/finished-fixture-${index}`), {
      ...teacherRoom.room, id: `finished-fixture-${index}`, status: 'finished', expiresAtMs: Date.now() + 86400000 + index, players: [],
    });
    await completedRoomBatch.commit();
    const throughFinished = await deployed.getYutManagement.run(request('teacher'));
    assert.equal(throughFinished.rooms.some((entry) => entry.id === teacherRoom.room.id), true, 'newer 205 finished rooms cannot hide an older active room');
    assert.equal(throughFinished.truncated, false, 'completed rooms do not consume the active room scan limit');
    const roomLimitBatch = db.batch();
    for (let index = 0; index < 205; index += 1) roomLimitBatch.set(db.doc(`${base}/yut_rooms/limit-fixture-${index}`), {
      ...teacherRoom.room, id: `limit-fixture-${index}`, expiresAtMs: Date.now() + 120000 + index, players: [],
    });
    await roomLimitBatch.commit();
    const bounded = await deployed.getYutManagement.run(request('teacher'));
    assert.equal(bounded.rooms.length, 100);
    assert.equal(bounded.truncated, true, 'monitor uses a bounded projection with an explicit truncation flag');
    let modeSettings = (await deployed.getYutManagement.run(request('teacher'))).settings;
    const saveModes = async (patch) => {
      modeSettings = (await deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: modeSettings.version, ...patch }))).settings;
      return modeSettings;
    };
    await denied(deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: modeSettings.version, throwSeconds: 2 })), ['invalid-argument']);
    await denied(deployed.saveYutSettings.run(request('teacher', { enabled: true, expectedVersion: modeSettings.version, defaultPlayerCount: 5 })), ['invalid-argument']);
    await saveModes({ allowSolo: true, allowMultiplayer: true, allowPrivateRooms: true, defaultPlayerCount: 3, throwSeconds: 5, moveSeconds: 25 });
    assert.equal((await deployed.getYutLobby.run(request('qa'))).privatePlaysRemaining, 5);
    for (let round = 1; round <= 5; round += 1) {
      let privateRoom = (await command('qa', 'create', { visibility: 'private', maxPlayers: 2 })).room;
      assert.equal(privateRoom.pieceCount, 2); assert.equal(privateRoom.players[0].pieces.length, 2);
      assert.equal(privateRoom.maxPlayers, 2);
      privateRoom = (await command('qb', 'join', { code: privateRoom.code })).room;
      const rejoined = await command('qb', 'join', { code: privateRoom.code });
      assert.equal(rejoined.room.id, privateRoom.id);
      assert.equal((await deployed.getYutLobby.run(request('qb'))).privatePlaysRemaining, 6 - round, 'waiting rejoin never spends a private play');
      privateRoom = (await roomCommand('qb', privateRoom, 'ready', { ready: true })).room;
      const startKey = key();
      privateRoom = (await roomCommand('qa', privateRoom, 'start', { requestKey: startKey })).room;
      assert.equal(privateRoom.turnDeadlineMs - privateRoom.phaseStartsAtMs, 5000);
      assert.equal(privateRoom.phaseStartsAtMs - privateRoom.lastEvent.atMs, 2000);
      const startRetry = await deployed.commandYutRoom.run(request('qa', { action: 'start', requestKey: startKey, roomId: privateRoom.id, expectedRevision: privateRoom.revision - 1 }));
      assert.equal(startRetry.room.id, privateRoom.id);
      assert.equal((await deployed.getYutLobby.run(request('qa'))).privatePlaysRemaining, 5 - round);
      assert.equal((await deployed.getYutLobby.run(request('qb'))).privatePlaysRemaining, 5 - round, 'every student is charged exactly once at start');
      await roomCommand('teacher', privateRoom, 'close');
    }
    await denied(command('qa', 'create', { visibility: 'private' }));
    let quotaRoom = (await command('qc', 'create', { visibility: 'private', maxPlayers: 2 })).room;
    await denied(command('qa', 'join', { code: quotaRoom.code }), ['resource-exhausted']);
    const quotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    await db.doc(`${base}/yut_players/${uid('qa')}`).update({ privatePlayDay: quotaDay, privatePlayCount: 4 });
    quotaRoom = (await command('qa', 'join', { code: quotaRoom.code })).room;
    quotaRoom = (await roomCommand('qa', quotaRoom, 'ready', { ready: true })).room;
    await db.doc(`${base}/yut_players/${uid('qa')}`).update({ privatePlayCount: 5 });
    await denied(roomCommand('qc', quotaRoom, 'start'), ['resource-exhausted']);
    assert.equal((await deployed.getYutLobby.run(request('qc'))).privatePlaysRemaining, 5, 'failed start spends no other participant quota');
    await roomCommand('teacher', quotaRoom, 'close');
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 86400000));
    await db.doc(`${base}/yut_players/${uid('qa')}`).update({ privatePlayDay: yesterday, privatePlayCount: 5 });
    assert.equal((await deployed.getYutLobby.run(request('qa'))).privatePlaysRemaining, 5, 'a new Korean date restores the daily allowance');
    const { createYutHandlers } = require('../yut');
    let boundaryTime = Date.parse(`${quotaDay}T14:59:59.999Z`);
    const boundaryHandlers = createYutHandlers({ db, now: () => boundaryTime });
    await db.doc(`${base}/yut_players/${uid('qa')}`).update({ privatePlayDay: quotaDay, privatePlayCount: 5 });
    assert.equal((await boundaryHandlers.getYutLobby(request('qa'))).privatePlaysRemaining, 0, 'quota remains spent one millisecond before Korean midnight');
    boundaryTime += 1;
    assert.equal((await boundaryHandlers.getYutLobby(request('qa'))).privatePlaysRemaining, 5, 'quota resets exactly at 15:00 UTC / Korean midnight');
    await db.doc(`${base}/yut_players/${uid('qa')}`).update({ privatePlayDay: yesterday, privatePlayCount: 5 });
    const hiddenRoom = (await command('qa', 'create', { visibility: 'private' })).room;
    assert.equal(hiddenRoom.maxPlayers, 3, 'teacher default capacity applies to omitted create option');
    const publicOne = (await command('p1', 'match', { maxPlayers: 2 })).room;
    assert.equal(publicOne.visibility, 'public'); assert.equal(publicOne.maxPlayers, 2); assert.notEqual(publicOne.id, hiddenRoom.id);
    const publicTwo = (await command('p2', 'match', { maxPlayers: 4 })).room;
    assert.equal(publicTwo.id, publicOne.id, 'a match joins any open public capacity before creating');
    const paired = await Promise.all(['p3', 'p4'].map((label) => command(label, 'match', { maxPlayers: 3 })));
    assert.equal(paired[0].room.id, paired[1].room.id, 'simultaneous empty-queue requests share one new public room');
    assert.notEqual(paired[0].room.id, publicOne.id, 'a full public room is excluded');
    assert.equal((await db.doc(`${base}/yut_rooms/${publicOne.id}`).get()).data().players.length, 2);
    const repeatMatch = await command('p1', 'match');
    assert.equal(repeatMatch.room.id, publicOne.id, 'existing public match reconnects without another room');
    const reconnectKey = key();
    const reconnected = await command('p3', 'match', { requestKey: reconnectKey });
    await roomCommand('p3', reconnected.room, 'leave');
    assert.equal((await command('p3', 'match', { requestKey: reconnectKey })).room, null, 'retrying an old reconnect after leaving cannot rejoin or create another room');
    assert.equal((await deployed.getYutLobby.run(request('p3'))).room, null);
    assert.equal((await rest('p1', `${base}/yut_matchmaking/queue`)).status, 403);
    await saveModes({ allowPrivateRooms: false });
    assert.equal((await rest('qa', `${base}/yut_rooms/${hiddenRoom.id}`)).status, 403, 'private-mode gate also blocks a cached subscription');
    assert.equal((await deployed.getYutLobby.run(request('qa'))).room, null);
    await denied(command('qb', 'join', { code: hiddenRoom.code }));
    assert.equal((await rest('p1', `${base}/yut_rooms/${publicOne.id}`)).status, 200, 'public rooms remain available');
    const afterPrivateClosed = (await command('qa', 'match')).room;
    assert.equal(afterPrivateClosed.visibility, 'public', 'a disabled private-mode pointer cannot prevent a public match');
    assert.equal((await db.doc(`${base}/yut_rooms/${hiddenRoom.id}`).get()).data().participantUids.includes(uid('qa')), false);
    await saveModes({ allowMultiplayer: false });
    assert.equal((await rest('p1', `${base}/yut_rooms/${publicOne.id}`)).status, 403);
    assert.equal((await deployed.getYutLobby.run(request('p1'))).settings.allowSolo, true);
    await denied(command('p1', 'match'));
    await roomCommand('p1', publicTwo, 'leave');
    assert.equal((await db.doc(`${base}/yut_rooms/${publicOne.id}`).get()).data().participantUids.includes(uid('p1')), false, 'leave still cleans up when multiplayer is disabled');
    await saveModes({ enabled: false });
    console.log('PASS Yut publication/mode gates, settings CAS, bounded management, two-piece explicit stacks and idempotent move choices, phase timing, seats/emotes, KST private-start quota, idempotent reconnect, concurrent public matchmaking, canonical session/enrollment guards, Firestore privacy and revocation');
  } finally {
    // This emulator/project was checked before importing any Admin SDK code.
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    await db.terminate();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
