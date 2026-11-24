// The avatar cast view and the piece choice of the Yut command endpoint, on an
// in-memory database that records every read and write. No emulator.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createYutHandlers } = require('../yut');
const { catalog, defaultLook, lookHash, SLOTS } = require('../studentAvatarCatalog');

const scope = { year: '2026', semester: '2', id: '2026-2' };
const base = `years/${scope.year}/semesters/${scope.semester}`;
const slotId = (uid) => `slot_${createHash('sha256').update(`${scope.id}\n${uid}`).digest('hex').slice(0, 40)}`;
const students = ['student-a', 'student-b', 'student-c', 'student-d'];
const request = (uid, data = {}) => ({ auth: uid ? { uid, token: { email: `${uid}@yongshin-ms.ms.kr` } } : undefined, data: { year: scope.year, semester: scope.semester, ...data } });
const code = async (work) => { try { await work(); } catch (error) { return error.code; } return 'ok'; };
const saved = (uid, look, extra = {}) => ({ studentUid: uid, schemaVersion: 1, catalogVersion: catalog.version, revision: 3, look, lookHash: lookHash(look),
  ownedItemIds: [], thumbnailUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${uid}.webp?alt=media&token=secret`, thumbnailPath: `student_avatar_thumbnails/v2/${uid}/x.webp`,
  lastSavedAtMs: 1_799_999_000_000, ...extra });
const girl = { ...defaultLook('girl'), expression: 'mm-wink', hairTone: 'mm-brown' }, boy = { ...defaultLook('boy'), pose: 'mm-wave' };

function world() {
  const documents = new Map(), log = { reads: [], writes: [], readOnly: 0, transactions: 0 };
  const seed = (records) => { for (const [path, data] of Object.entries(records)) documents.set(path, structuredClone(data)); };
  const snapshot = (reference) => {
    log.reads.push(reference.path);
    const data = documents.get(reference.path);
    return { exists: data !== undefined, id: reference.id, ref: reference, data: () => structuredClone(data) };
  };
  const query = { isQuery: true, where: () => query, orderBy: () => query, limit: () => query };
  const db = {
    doc(path) { const reference = { path, id: path.split('/').pop(), get: async () => snapshot(reference) }; return reference; },
    collection: () => query, collectionGroup: () => query,
    async runTransaction(work, options) {
      const readOnly = Boolean(options?.readOnly), staged = [];
      log.transactions += 1; if (readOnly) log.readOnly += 1;
      const stage = (kind) => (reference, data, merge) => {
        if (readOnly) throw new Error('Firestore read-only transactions cannot execute writes.');
        staged.push({ kind, path: reference.path, data: structuredClone(data), merge: Boolean(merge?.merge) });
      };
      const result = await work({ get: async (target) => target.isQuery ? { docs: [] } : snapshot(target), set: stage('set'), update: stage('update') });
      for (const write of staged) {
        const current = documents.get(write.path);
        documents.set(write.path, write.kind === 'update' || write.merge ? { ...(current || {}), ...write.data } : write.data);
        log.writes.push(write.path);
      }
      return result;
    },
  };
  seed({
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: scope.id, revision: 3 },
    [`semester_manifests/${scope.id}`]: { status: 'ACTIVE', revision: 3 },
    [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 4 },
    'semester_classes/class-3-2': { semesterId: scope.id, status: 'ACTIVE', grade: '3', classNumber: '2' },
    'users/teacher-t': { role: 'teacher', name: '교사' },
    'users/staff-s': { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read'], name: '지원' },
    'users/outsider': { role: 'student', name: '미승인', registrationApprovalStatus: 'PENDING' },
    // A valid look, an opted-out valid look, no avatar at all, and a look that was never saved.
    'student_avatars/student-a': saved('student-a', girl),
    'student_avatars/student-b': saved('student-b', boy),
    [`${base}/yut_players/student-b`]: { roomId: 'room-1', pieceStyle: 'classic', privatePlayDay: '2026-11-25', privatePlayCount: 2 },
    'student_avatars/student-d': saved('student-d', girl, { lastSavedAtMs: undefined, thumbnailPath: undefined, thumbnailUrl: undefined }),
  });
  for (const [index, uid] of [...students, 'student-e'].entries()) seed({
    [`users/${uid}`]: { role: 'student', name: `학생${index + 1}`, registrationApprovalStatus: 'APPROVED', email: `${uid}@yongshin-ms.ms.kr`, avatar: { thumbnailUrl: 'never-returned' } },
    [`semester_enrollment_slots/${slotId(uid)}`]: { studentUid: uid, semesterId: scope.id, activeEnrollmentId: `enrollment-${uid}`, status: 'ACTIVE' },
    [`semester_enrollments/enrollment-${uid}`]: { studentUid: uid, semesterId: scope.id, enrollmentStatus: 'ACTIVE', classId: 'class-3-2', studentName: `학생${index + 1}`, studentNumber: String(index + 1) },
  });
  const state = { clock: 1_800_000_000_000, session: async () => {} };
  const handlers = createYutHandlers({ db, assertSession: (incoming) => state.session(incoming), now: () => state.clock, random: () => 0 });
  const room = (id, uids, extra = {}) => ({ id, code: 'ABC234', status: 'playing', visibility: 'private', revision: 5, hostUid: uids[0], participantUids: uids,
    players: uids.map((uid, index) => ({ uid, name: uid, role: ['sa', 'nong', 'gong', 'sang'][index], ready: true, active: true, pieces: [] })),
    enrollmentIds: Object.fromEntries(uids.map((uid) => [uid, uid.startsWith('student') ? `enrollment-${uid}` : ''])),
    enrollmentSlotIds: Object.fromEntries(uids.map((uid) => [uid, uid.startsWith('student') ? slotId(uid) : ''])),
    createdAtMs: state.clock - 60_000, expiresAtMs: state.clock + 600_000, ...extra });
  seed({ [`${base}/yut_rooms/room-1`]: room('room-1', students) });
  const run = async (uid, data) => {
    const before = { reads: log.reads.length, writes: log.writes.length, readOnly: log.readOnly, transactions: log.transactions };
    const value = await handlers.commandYutRoom(request(uid, data));
    return { value, reads: log.reads.slice(before.reads), writes: log.writes.slice(before.writes),
      readOnly: log.readOnly - before.readOnly, transactions: log.transactions - before.transactions };
  };
  return { db, documents, seed, state, handlers, room, run, log };
}
const cast = (data = {}) => ({ action: 'cast', roomId: 'room-1', ...data });

test('cast answers only the valid saved looks of players who kept the avatar, and nothing else about them', async () => {
  const { run } = world();
  const a = await run('student-a', cast());
  assert.deepEqual(a.value, { cast: { 'student-a': { look: girl } }, piece: 'avatar' });
  assert.deepEqual(Object.keys(a.value.cast['student-a'].look).sort(), [...SLOTS].sort());
  assert.equal(JSON.stringify(a.value).includes('firebasestorage'), false, 'never an image address');
  assert.equal(JSON.stringify(a.value).includes('yongshin'), false, 'never a profile field');
  // The player who chose the animal piece is told so, and nobody receives that look.
  assert.deepEqual((await run('student-b', cast())).value, { cast: { 'student-a': { look: girl } }, piece: 'classic' });
  // No saved avatar: no choice to offer.
  assert.deepEqual((await run('student-c', cast())).value, { cast: { 'student-a': { look: girl } } });
  assert.deepEqual((await run('student-d', cast())).value, { cast: { 'student-a': { look: girl } } });
});

test('a stored avatar is shown only when the studio itself would accept it', async () => {
  const girlOnly = catalog.items.find((item) => item.slot === 'bottom' && item.characters.length === 1 && item.characters[0] === 'girl');
  const cases = {
    'another catalogue generation': (doc) => ({ ...doc, catalogVersion: catalog.version - 1 }),
    'a retired item': (doc) => { const look = { ...doc.look, top: 'mm-retired-item' }; return { ...doc, look, lookHash: lookHash(look) }; },
    'an item of the other character': (doc) => { const look = { ...doc.look, character: 'boy', bottom: girlOnly.value }; return { ...doc, look, lookHash: lookHash(look) }; },
    'a look that does not match its hash': (doc) => ({ ...doc, look: { ...doc.look, hairTone: 'mm-rose' } }),
    'a missing slot': (doc) => { const { shoes, ...look } = doc.look; return { ...doc, look }; },
    'another owner': (doc) => ({ ...doc, studentUid: 'student-b' }),
    'no revision': (doc) => ({ ...doc, revision: 0 }),
    'a teacher avatar shape': (doc) => { const { studentUid, ...rest } = doc; return { ...rest, teacherUid: 'student-a' }; },
  };
  for (const [name, change] of Object.entries(cases)) {
    const { run, seed, documents } = world();
    seed({ 'student_avatars/student-a': change(documents.get('student_avatars/student-a')) });
    assert.deepEqual((await run('student-a', cast())).value, { cast: {} }, name);
  }
  // The same girl-only item on a girl is shown.
  const { run, seed } = world();
  const look = { ...girl, bottom: girlOnly.value };
  seed({ 'student_avatars/student-a': saved('student-a', look) });
  assert.deepEqual((await run('student-a', cast())).value.cast['student-a'], { look });
});

test('cast is open to the room\'s participants and to monitors only', async () => {
  const { run, seed, room, state, documents } = world();
  assert.equal(await code(() => run('student-e', cast())), 'permission-denied', 'another student');
  assert.equal(await code(() => run('outsider', cast())), 'permission-denied', 'an unapproved account');
  assert.equal(await code(() => run(null, cast())), 'unauthenticated');
  for (const monitor of ['teacher-t', 'staff-s']) assert.deepEqual((await run(monitor, cast())).value, { cast: { 'student-a': { look: girl } } }, monitor);
  seed({ 'users/staff-s': { role: 'staff', teacherPortalEnabled: true, staffPermissions: [], name: '지원' } });
  assert.equal(await code(() => run('staff-s', cast())), 'permission-denied', 'staff without the monitor permission');
  assert.equal(await code(() => run('student-a', cast({ roomId: 'missing-room' }))), 'not-found');
  seed({ [`${base}/yut_rooms/room-closed`]: room('room-closed', students, { status: 'closed' }), [`${base}/yut_rooms/room-old`]: room('room-old', students, { expiresAtMs: state.clock - 1 }) });
  assert.equal(await code(() => run('student-a', cast({ roomId: 'room-closed' }))), 'not-found');
  assert.equal(await code(() => run('student-a', cast({ roomId: 'room-old' }))), 'not-found');
  // The enrollment the room recorded no longer matches: the same refusal as a command.
  seed({ [`${base}/yut_rooms/room-moved`]: room('room-moved', students, { enrollmentIds: { 'student-a': 'enrollment-previous' } }) });
  assert.equal(await code(() => run('student-a', cast({ roomId: 'room-moved' }))), 'permission-denied');
  // Private rooms switched off, then the whole game closed for students.
  seed({ [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 5, allowPrivateRooms: false } });
  assert.equal(await code(() => run('student-a', cast())), 'permission-denied');
  assert.deepEqual((await run('teacher-t', cast())).value, { cast: { 'student-a': { look: girl } } });
  seed({ [`${base}/weplay_games/joseon-yut`]: { enabled: false, version: 6 } });
  assert.equal(await code(() => run('student-a', cast())), 'permission-denied');
  assert.equal(documents.get(`${base}/yut_players/student-a`), undefined, 'a view never creates the player record');
});

test('cast writes nothing and reads at most the avatar and the choice of each student in the room', async () => {
  const { run, seed, room } = world();
  const own = ['users/student-a', 'site_settings/config', 'site_settings/semester_active', `semester_manifests/${scope.id}`, `${base}/weplay_games/joseon-yut`,
    `semester_enrollment_slots/${slotId('student-a')}`, 'semester_enrollments/enrollment-student-a', 'semester_classes/class-3-2'];
  const pieces = students.flatMap((uid) => [`student_avatars/${uid}`, `${base}/yut_players/${uid}`]);
  const result = await run('student-a', cast());
  assert.deepEqual(result.reads.slice().sort(), [...own, `${base}/yut_rooms/room-1`, ...pieces].sort());
  assert.deepEqual([result.writes.length, result.readOnly, result.transactions], [0, 1, 1]);
  // A teacher in a seat, a player who left and a kicked uid cost no read.
  seed({ [`${base}/yut_rooms/room-2`]: (() => {
    const value = room('room-2', ['student-a', 'teacher-t', 'student-b', 'student-c']);
    value.players[2].active = false;
    value.participantUids = ['student-a', 'teacher-t', 'student-b'];
    return value;
  })() });
  const mixed = await run('teacher-t', cast({ roomId: 'room-2' }));
  assert.deepEqual(mixed.value, { cast: { 'student-a': { look: girl } } });
  assert.deepEqual(mixed.reads.filter((path) => /student_avatars|yut_players|teacher_avatars/.test(path)).sort(), ['student_avatars/student-a', `${base}/yut_players/student-a`].sort());
  assert.equal(mixed.reads.some((path) => /^users\/student/.test(path)), false, 'no profile of another account is read');
});

test('without a room the cast is the caller\'s own piece only', async () => {
  const { run } = world();
  const mine = await run('student-a', { action: 'cast' });
  assert.deepEqual(mine.value, { cast: { 'student-a': { look: girl } }, piece: 'avatar' });
  assert.deepEqual(mine.reads.filter((path) => /student_avatars|yut_players|yut_rooms/.test(path)).sort(), ['student_avatars/student-a', `${base}/yut_players/student-a`].sort());
  assert.deepEqual((await run('student-b', { action: 'cast' })).value, { cast: {}, piece: 'classic' });
  assert.deepEqual((await run('student-c', { action: 'cast' })).value, { cast: {} });
  const teacher = await run('teacher-t', { action: 'cast' });
  assert.deepEqual(teacher.value, { cast: {} });
  assert.equal(teacher.reads.some((path) => /avatars|yut_players/.test(path)), false);
});

test('cast refuses malformed requests and a failed session before answering', async () => {
  const { run, state } = world();
  for (const data of [cast({ roomId: 'bad/room' }), cast({ roomId: '' }), cast({ roomId: 7 }), cast({ uid: 'student-b' }), cast({ requestKey: 'cast-request-0001' }), { action: 'cast', roomId: null }]) {
    assert.equal(await code(() => run('student-a', data)), 'invalid-argument', JSON.stringify(data));
  }
  assert.equal(await code(() => run('student-a', { ...cast(), year: '26' })), 'invalid-argument');
  state.session = async () => { throw Object.assign(new Error('session'), { code: 'unauthenticated' }); };
  assert.equal(await code(() => run('student-a', cast())), 'unauthenticated');
});

test('a student chooses the animal piece or the avatar; the choice is one optional field of the player record', async () => {
  const { run, documents, seed } = world();
  const path = `${base}/yut_players/student-a`;
  seed({ [path]: { roomId: 'room-1', lastCommandAtMs: 5, commands: [{ key: 'kept', fingerprint: 'f', roomId: 'room-1' }], privatePlayDay: '2026-11-25', privatePlayCount: 1 } });
  const kept = structuredClone(documents.get(path));
  const classic = await run('student-a', { action: 'piece', piece: 'classic' });
  assert.deepEqual(classic.value, { piece: 'classic' });
  assert.deepEqual(classic.writes, [path]);
  assert.deepEqual(documents.get(path), { ...kept, pieceStyle: 'classic' });
  assert.deepEqual((await run('student-a', cast())).value, { cast: {}, piece: 'classic' });
  const again = await run('student-a', { action: 'piece', piece: 'classic' });
  assert.deepEqual([again.value, again.writes], [{ piece: 'classic' }, []], 'an unchanged choice writes nothing');
  const avatar = await run('student-a', { action: 'piece', piece: 'avatar' });
  assert.deepEqual(avatar.value, { piece: 'avatar' });
  assert.deepEqual(documents.get(path), kept, 'the field is removed and every other field is kept');
  assert.deepEqual((await run('student-a', { action: 'piece', piece: 'avatar' })).writes, []);
  assert.deepEqual((await run('student-a', cast())).value, { cast: { 'student-a': { look: girl } }, piece: 'avatar' });
  // A first choice with no record yet creates only this field.
  assert.deepEqual((await run('student-c', { action: 'piece', piece: 'classic' })).writes, [`${base}/yut_players/student-c`]);
  assert.deepEqual(documents.get(`${base}/yut_players/student-c`), { pieceStyle: 'classic' });
  assert.deepEqual((await run('student-d', { action: 'piece', piece: 'avatar' })).writes, []);
  assert.equal(documents.has(`${base}/yut_players/student-d`), false);
});

test('the piece choice is validated strictly and never touches a room', async () => {
  const { run, state, seed, log, documents } = world();
  const room = structuredClone(documents.get(`${base}/yut_rooms/room-1`));
  for (const data of [{ piece: 'animal' }, { piece: '' }, { piece: true }, {}, { piece: 'classic', roomId: 'room-1' }, { piece: 'classic', requestKey: 'piece-request-01' }, { piece: 'classic', targetUid: 'student-b' }, { piece: ['classic'] }]) {
    assert.equal(await code(() => run('student-a', { action: 'piece', ...data })), 'invalid-argument', JSON.stringify(data));
  }
  assert.equal(await code(() => run(null, { action: 'piece', piece: 'classic' })), 'unauthenticated');
  assert.equal(await code(() => run('teacher-t', { action: 'piece', piece: 'classic' })), 'permission-denied');
  assert.equal(await code(() => run('outsider', { action: 'piece', piece: 'classic' })), 'permission-denied');
  state.session = async () => { throw Object.assign(new Error('session'), { code: 'permission-denied' }); };
  assert.equal(await code(() => run('student-a', { action: 'piece', piece: 'classic' })), 'permission-denied');
  state.session = async () => {};
  seed({ [`${base}/weplay_games/joseon-yut`]: { enabled: false, version: 5 } });
  assert.equal(await code(() => run('student-a', { action: 'piece', piece: 'classic' })), 'permission-denied', 'closed game');
  assert.deepEqual(log.writes, []);
  assert.deepEqual(documents.get(`${base}/yut_rooms/room-1`), room);
});

test('ordinary commands keep the choice on the player record', async () => {
  const { run, documents, state } = world();
  await run('student-e', { action: 'piece', piece: 'classic' });
  state.clock += 1000;
  const created = await run('student-e', { action: 'create', requestKey: 'cast-create-0001', visibility: 'public', maxPlayers: 2 });
  assert.equal(created.value.room.status, 'waiting');
  assert.equal('pieceStyle' in created.value.room.players[0], false, 'the room carries no piece or avatar data');
  assert.equal(JSON.stringify(created.value.room).includes('look'), false);
  const record = documents.get(`${base}/yut_players/student-e`);
  assert.equal(record.pieceStyle, 'classic');
  assert.equal(record.roomId, created.value.room.id);
  state.clock += 1000;
  await run('student-e', { action: 'leave', requestKey: 'cast-leave-00001', roomId: created.value.room.id, expectedRevision: created.value.room.revision });
  assert.equal(documents.get(`${base}/yut_players/student-e`).pieceStyle, 'classic');
});
