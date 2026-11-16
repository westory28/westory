const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const projectId = 'demo-westory-session-weplay-ranking';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId)) throw new Error('Dedicated local ranking emulator required.');
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const { initializeApp } = require('firebase-admin/app');
initializeApp({ projectId });
const { getFirestore, Timestamp, DocumentReference } = require('firebase-admin/firestore');
const sourceRoot = process.env.WEPLAY_RANKING_SOURCE_ROOT ? path.resolve(process.env.WEPLAY_RANKING_SOURCE_ROOT) : path.resolve(__dirname, '..');
const fromSource = file => require(path.join(sourceRoot, file));
const { createWeplayRankingHandlers, replayRhythm } = fromSource('weplayRanking');
const { prepareRankingUpdate, boardId } = fromSource('weplayRankingStore');
const { createChart } = fromSource('rhythmRankingCore/rhythmCore');
const { RHYTHM_SONGS } = fromSource('rhythmRankingCore/rhythmSongs');
const db = getFirestore(), scope = { year: '2026', semester: '2' }, base = 'years/2026/semesters/2';
const hash = value => createHash('sha256').update(value).digest('hex');
const authTime = Math.floor(Date.now() / 1000) - 10;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const request = (uid, data = {}) => ({ auth: { uid, token: { email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } }, data: { ...scope, _session: proof, ...data } });
let atMs = Date.now(), metrics = { reads: 0, writes: 0, queries: 0, guardReads: 0 }, failNextBoardRead = false;
const reset = () => { metrics = { reads: 0, writes: 0, queries: 0, guardReads: 0 }; };
const guardContext = new AsyncLocalStorage();
const originalGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = function (...args) {
  if (guardContext.getStore()) metrics.guardReads++;
  return originalGet.apply(this, args);
};
const assertSession = request => guardContext.run(true, () => fromSource('scoreWorkflowGuard').assertScoreWorkflowSession(request));
const wrapQuery = query => new Proxy(query, { get(target, key) {
  if (key === 'get') return async () => { metrics.queries++; const snap = await target.get(); metrics.reads += Math.max(1, snap.size); return snap; };
  const value = target[key]; return typeof value === 'function' ? (...args) => wrapQuery(value.apply(target, args)) : value;
} });
const wrapRef = ref => new Proxy(ref, { get(target, key) {
  if (key === 'get') return async () => {
    metrics.reads++;
    if (failNextBoardRead && target.path.includes('/weplay_rankings/')) { failNextBoardRead = false; throw Object.assign(new Error('Synthetic unavailable read'), { code: 'unavailable' }); }
    return target.get();
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
} });
const instrumented = {
  doc: name => wrapRef(db.doc(name)), collection: name => wrapQuery(db.collection(name)),
  getAll: async (...refs) => { metrics.reads += refs.length; return db.getAll(...refs); },
  runTransaction: callback => db.runTransaction(transaction => callback(new Proxy(transaction, { get(target, key) {
    if (key === 'getAll') return async (...refs) => { metrics.reads += refs.length; return target.getAll(...refs); };
    if (key === 'get') return async ref => { metrics.reads++; return target.get(ref); };
    if (['set', 'create', 'update', 'delete'].includes(key)) return (...args) => { metrics.writes++; return target[key](...args); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))),
};
const api = createWeplayRankingHandlers({ db: instrumented, now: () => atMs, assertSession });
const get = async name => (await db.doc(name).get()).data();
const deny = (promise, code) => assert.rejects(promise, error => error.code === code);
const counts = {};
async function seed() {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const docs = {
    'site_settings/config': { ...scope },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', status: 'ACTIVE', revision: 1 },
    'semester_classes/class-one': { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: '1' },
    'semester_classes/class-two': { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: '2' },
    [`${base}/weplay_games/joseon-yut`]: { enabled: true, version: 1 },
    [`${base}/rhythm_publication/gungdeok-rock`]: { enabled: true, revision: 1, schemaVersion: 1, updatedAt: Timestamp.now() },
    [`${base}/weplay_meta/current`]: { periodId: 'period-one' },
    [`${base}/weplay_periods/period-one`]: { startsAtMs: atMs - 1000, endsAtMs: atMs + 3600000 },
  };
  for (const uid of ['a', 'b', 'other', 'teacher', 'admin', 'staff-allowed', 'staff-denied', 'staff-no-portal']) {
    docs[`users/${uid}`] = { role: ['teacher', 'admin'].includes(uid) ? 'teacher' : uid.startsWith('staff-') ? 'staff' : 'student', name: '합성학생', studentNumber: '1', registrationApprovalStatus: 'APPROVED',
      ...(uid.startsWith('staff-') ? { teacherPortalEnabled: uid !== 'staff-no-portal', staffPermissions: uid === 'staff-denied' ? ['point_read'] : ['lesson_read'] } : {}) };
    docs[`application_sessions/${uid}/sessions/${authTime}`] = { status: 'active', authTime, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    docs[`semester_enrollment_slots/slot_${hash('2026-2\n' + uid).slice(0, 40)}`] = { semesterId: '2026-2', studentUid: uid, activeEnrollmentId: `en-${uid}`, status: 'ACTIVE' };
    docs[`semester_enrollments/en-${uid}`] = { semesterId: '2026-2', studentUid: uid, classId: uid === 'other' ? 'class-two' : 'class-one', enrollmentStatus: 'ACTIVE' };
  }
  for (let i = 0; i < 60; i++) docs[`${base}/weplay_periods/period-one/entries/e${i}`] = { uid: i ? `synthetic-${i}` : 'a', classKey: '3-1', difficulty: 'mild', studentLabel: '합○○○', score: 10000 - i, achievedAtMs: atMs - 500 };
  docs[`${base}/weplay_periods/period-one/entries/other-class`] = { uid: 'other', classKey: '3-2', difficulty: 'mild', studentLabel: '타○○', score: 99999, achievedAtMs: atMs };
  const batch = db.batch(); for (const [name, data] of Object.entries(docs)) batch.set(db.doc(name), data); await batch.commit(); reset();
}
async function main() {
  await seed();
  for (const song of RHYTHM_SONGS) for (const difficulty of ['easy', 'normal', 'hard']) {
    const chart = createChart(song, difficulty), events = chart.map(({ time, kind, hand }) => ({ time, kind, hand }));
    const score = replayRhythm(song, difficulty, events);
    assert.equal(score.score, chart.length * 1000); assert.equal(score.maxCombo, chart.length); assert.equal(score.miss, 0);
    assert.equal(replayRhythm(song, difficulty, []).score, 0);
  }
  const song = RHYTHM_SONGS[0], chart = createChart(song, 'easy');
  const events = chart.map(({ time, kind, hand }) => ({ time, kind, hand }));
  for (const bad of [[{ ...events[0], time: Infinity }], [...events].reverse(), Array(5001).fill(events[0]), [{ ...events[0], hand: 'forged' }]]) assert.throws(() => replayRhythm(song, 'easy', bad), error => error.code === 'invalid-argument');
  const naval = { gameId: 'history-rain', category: 'mild' };
  await deny(api.getWeplayRanking(request('a', { gameId: '__proto__', category: 'wins' })), 'invalid-argument');
  reset(); const first = await api.getWeplayRanking(request('a', naval)); counts.navalCold = { ...metrics };
  assert.equal(first.rows.length, 50); assert.equal(first.rows[0].isMe, true); assert.equal(first.rows[0].score, 10000);
  assert.equal(JSON.stringify(first).includes('synthetic-'), false); assert.equal(JSON.stringify(first).includes('uid'), false);
  assert.equal(metrics.reads, 60); assert.equal(metrics.queries, 1); assert.equal(metrics.writes, 0); assert.equal(metrics.guardReads, 3);
  reset(); await Promise.all([api.getWeplayRanking(request('b', naval)), api.getWeplayRanking(request('a', naval))]); counts.navalWarmTwo = { ...metrics };
  assert.equal(metrics.reads, 20); assert.equal(metrics.queries, 0); assert.equal(metrics.writes, 0); assert.equal(metrics.guardReads, 6);
  const isolated = await api.getWeplayRanking(request('other', naval)); assert.equal(isolated.rows.length, 1); assert.equal(isolated.rows[0].score, 99999);
  reset(); await Promise.all([api.getWeplayRanking(request('a', { ...naval, category: 'medium' })), api.getWeplayRanking(request('b', { ...naval, category: 'medium' }))]);
  counts.navalConcurrentCold = { ...metrics }; assert.equal(metrics.queries, 1, 'concurrent callers share the same pending query'); assert.equal(metrics.reads, 21);
  await db.doc('site_settings/config').update({ studentMenuVisibility: { weplay: false } });
  await deny(api.getWeplayRanking(request('a', naval)), 'permission-denied');
  await db.doc('site_settings/config').set(scope);
  await deny(api.getWeplayRanking(request('a', { ...naval, year: '2025' })), 'failed-precondition');
  await db.doc(`application_sessions/a/sessions/${authTime}`).update({ status: 'revoked' });
  await deny(api.getWeplayRanking(request('a', naval)), 'unauthenticated');
  await db.doc(`application_sessions/a/sessions/${authTime}`).update({ status: 'active' });
  const startReq = request('a', { songId: song.id, difficulty: 'easy', requestId: randomUUID() });
  reset(); const started = await api.startRhythmRankingGame(startReq); counts.rhythmStart = { ...metrics }; assert.equal(metrics.writes, 1);
  reset(); assert.deepEqual(await api.startRhythmRankingGame(startReq), started); counts.rhythmStartRetry = { ...metrics }; assert.equal(metrics.writes, 0);
  const finishReq = request('a', { sessionId: started.sessionId, events });
  await deny(api.finishRhythmRankingGame(finishReq), 'failed-precondition');
  atMs += Math.ceil(song.duration * 1000);
  reset(); const finished = await api.finishRhythmRankingGame(finishReq); counts.rhythmFinish = { ...metrics }; assert.equal(metrics.writes, 3); assert.equal(finished.score, chart.length * 1000);
  reset(); assert.deepEqual(await api.finishRhythmRankingGame(finishReq), finished); counts.rhythmFinishRetry = { ...metrics }; assert.equal(metrics.writes, 0);
  const rhythmArgs = { gameId: 'gungdeok-rock', category: `${song.id}:easy` };
  reset(); const board = await api.getWeplayRanking(request('a', rhythmArgs)); counts.rhythmRankCold = { ...metrics }; assert.equal(metrics.reads, 9); assert.equal(board.rows[0].score, finished.score);
  reset(); await api.getWeplayRanking(request('a', rhythmArgs)); counts.rhythmRankWarm = { ...metrics }; assert.equal(metrics.reads, 8);
  failNextBoardRead = true;
  await deny(api.getWeplayRanking(request('a', { ...rhythmArgs, refresh: true })), 'unavailable');
  reset(); await api.getWeplayRanking(request('a', rhythmArgs)); counts.rhythmReadRetry = { ...metrics }; assert.equal(metrics.reads, 9, 'failed refresh removes stale/error cache and retries the board');
  await db.doc(`${base}/rhythm_publication/gungdeok-rock`).update({ enabled: false, revision: 2 });
  await deny(api.getWeplayRanking(request('a', rhythmArgs)), 'permission-denied');
  await deny(api.finishRhythmRankingGame(finishReq), 'permission-denied');
  await db.doc(`${base}/rhythm_publication/gungdeok-rock`).update({ enabled: true, revision: 3 });
  const newStart = await api.startRhythmRankingGame(request('a', { songId: song.id, difficulty: 'easy', requestId: randomUUID() }));
  atMs += 5001;
  const replacement = await api.startRhythmRankingGame(request('a', { songId: song.id, difficulty: 'easy', requestId: randomUUID() }));
  assert.notEqual(newStart.sessionId, replacement.sessionId);
  await deny(api.finishRhythmRankingGame(request('a', { sessionId: newStart.sessionId, events })), 'failed-precondition');
  atMs += Math.ceil(song.duration * 1000);
  reset(); await api.finishRhythmRankingGame(request('a', { sessionId: replacement.sessionId, events: [] })); counts.zeroFinish = { ...metrics }; assert.equal(metrics.writes, 1);
  assert.equal((await get(`${base}/weplay_rankings/${boardId('gungdeok-rock', `${song.id}:easy`, 'class-one')}`)).rows[0].score, finished.score);
  // Atomic winner projection independently verifies bounded storage, increments,
  // class separation and no-op best records without scanning any collection.
  reset(); await instrumented.runTransaction(async transaction => {
    const update = await prepareRankingUpdate({ db: instrumented, transaction, scope, gameId: 'joseon-yut', category: 'wins', actor: { uid: 'a', classId: 'class-one', rankingLabel: '합○○○' }, score: 1, increment: true, atMs }); update.apply();
  }); counts.yutWinnerProjection = { ...metrics }; assert.deepEqual(metrics, { reads: 2, writes: 2, queries: 0, guardReads: 0 });
  for (let i = 0; i < 2; i++) await instrumented.runTransaction(async transaction => {
    const update = await prepareRankingUpdate({ db: instrumented, transaction, scope, gameId: 'joseon-yut', category: 'wins', actor: { uid: 'a', classId: 'class-one', rankingLabel: '합○○○' }, score: 1, increment: true, atMs: atMs + i + 1 }); update.apply();
  });
  assert.equal((await api.getWeplayRanking(request('a', { gameId: 'joseon-yut', category: 'wins' }))).rows[0].score, 3);
  const yutRoot = process.env.WEPLAY_YUT_SOURCE_ROOT ? path.resolve(process.env.WEPLAY_YUT_SOURCE_ROOT) : sourceRoot;
  const yut = require(path.join(yutRoot, 'yut')).createYutHandlers({ db, now: () => atMs });
  const command = (uid, action, values = {}) => {
    atMs += 1000;
    return yut.commandYutRoom(request(uid, { action, requestKey: randomUUID(), ...values }));
  };
  let room = (await command('b', 'create', { visibility: 'public', maxPlayers: 2 })).room;
  room = (await command('a', 'join', { code: room.code })).room;
  room = (await command('a', 'ready', { roomId: room.id, expectedRevision: room.revision, ready: true })).room;
  room = (await command('b', 'start', { roomId: room.id, expectedRevision: room.revision })).room;
  const players = room.players.map(player => ({ ...player, pieces: player.pieces.map((piece, index) => ({ id: piece.id, node: player.uid === 'b' ? index ? 'finish' : 'o19' : 'o19', lane: 'outer' })) }));
  await db.doc(`${base}/yut_rooms/${room.id}`).update({ players, turnUid: 'b', phase: 'move', phaseStartsAtMs: 0,
    turnDeadlineMs: atMs + 60000, pendingThrow: { value: 1, label: '도', sticks: [true, false, false, false] } });
  atMs += 1000;
  const winningRequest = request('b', { action: 'move', requestKey: randomUUID(), roomId: room.id, expectedRevision: room.revision, pieceId: '1', route: 'outer' });
  const finishedRooms = await Promise.all([yut.commandYutRoom(winningRequest), yut.commandYutRoom(winningRequest)]);
  assert.equal(finishedRooms[0].room.status, 'finished'); assert.equal(finishedRooms[0].room.rankingRecordedAtMs, atMs);
  const yutBoard = await get(`${base}/weplay_rankings/${boardId('joseon-yut', 'wins', 'class-one')}`);
  assert.equal(yutBoard.rows.find(row => row.uid === 'b').score, 1, 'concurrent complete-command replay counts exactly one win');
  assert.equal(yutBoard.rows.find(row => row.uid === 'a').score, 3, 'losing player retains earlier count');
  assert.equal(finishedRooms[0].room.reward.status, 'not-awarded', 'ranking is independent of disabled financial rewards');
  const boundedRef = db.doc(`${base}/weplay_rankings/${boardId('joseon-yut', 'wins', 'bounded-class')}`);
  const topRows = Array.from({ length: 50 }, (_, i) => ({ uid: `rank-${i}`, studentLabel: '합○○○', score: 100 - i, achievedAtMs: atMs }));
  await boundedRef.set({ schemaVersion: 1, rows: topRows, trackingSinceMs: atMs, updatedAtMs: atMs });
  const boundedActor = { uid: 'outside', classId: 'bounded-class', rankingLabel: '합○○○' };
  const addWin = score => instrumented.runTransaction(async transaction => {
    const update = await prepareRankingUpdate({ db: instrumented, transaction, scope, gameId: 'joseon-yut', category: 'wins', actor: boundedActor, score, increment: true, atMs }); update.apply();
  });
  reset(); await addWin(1); assert.equal(metrics.writes, 1, 'outside top 50 changes only the player total');
  assert.deepEqual((await boundedRef.get()).data().rows, topRows);
  reset(); await addWin(100); assert.equal(metrics.writes, 2); const promoted = (await boundedRef.get()).data().rows;
  assert.equal(promoted.length, 50); assert.equal(promoted[0].uid, 'outside'); assert.equal(promoted[0].score, 101);
  assert.equal((await db.collection('semester_wis_ledger').get()).size, 0, 'rankings never pay Wis');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'a', user_id: 'a', email: 'a@yongshin-ms.ms.kr', email_verified: true,
    aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: authTime, exp: authTime + 7200, auth_time: authTime, firebase: { sign_in_provider: 'google.com' } })}.`;
  for (const [documentPath, method] of [
    [`${base}/weplay_rankings/${boardId('joseon-yut', 'wins', 'class-one')}`, 'GET'],
    [`${base}/rhythm_players/a`, 'GET'], [`${base}/rhythm_players/a`, 'PATCH'],
    [`${base}/weplay_rankings/forged`, 'PATCH'],
  ]) {
    const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { score: { integerValue: '999999' } } }) } : {}),
    });
    assert.equal(response.status, 403, `direct ${method} denied: ${documentPath}`);
  }
  await verifyTeacherRanking();
  console.log(JSON.stringify({ passed: true, notes: 'Total reads = reads + guardReads; missing documents and empty queries each cost at least one read. Concurrent transaction retries may add reads.', counts }, null, 2));
}
async function verifyTeacherRanking() {
  const naval = { gameId: 'history-rain', category: 'mild' };
  const hidden = { gameId: 'joseon-yut', category: 'wins' };
  await db.doc('semester_classes/class-old').set({ semesterId: '2025-2', status: 'ACTIVE', grade: '3', classNumber: '1' });
  await db.doc('semester_classes/class-inactive').set({ semesterId: '2026-2', status: 'ARCHIVED', grade: '2', classNumber: '1' });
  await db.doc('semester_classes/class-readonly').set({ semesterId: '2026-2', status: 'ACTIVE', readOnly: true, grade: '2', classNumber: '2' });
  const originals = new Map();
  for (const gameId of ['history-rain', 'joseon-yut', 'gungdeok-rock']) {
    const ref = db.doc(`${base}/${gameId === 'gungdeok-rock' ? 'rhythm_publication' : 'weplay_games'}/${gameId}`);
    originals.set(ref.path, (await ref.get()).data());
    await ref.set(gameId === 'history-rain' ? { ...fromSource('weplayCore').DEFAULT_GAME_SETTINGS, enabled: false, version: 1 }
      : { ...(originals.get(ref.path) || {}), enabled: false });
  }
  await db.doc('site_settings/config').update({ studentMenuVisibility: { weplay: false, naval: false, yut: false, rhythm: false } });
  reset();
  const initial = await api.getWeplayRanking(request('teacher', naval)); counts.teacherFirstOpen = { ...metrics };
  assert.deepEqual(initial.classes, [{ id: 'class-one', label: '3학년 1반' }, { id: 'class-two', label: '3학년 2반' }]);
  assert.equal(initial.selectedClassId, 'class-one'); assert.equal(initial.rows.length, 50);
  assert.equal(initial.rows.every(row => !row.isMe), true); assert.equal(metrics.writes, 0);
  // Catalog and the one selected ranking query only; no users/enrollments scan.
  assert.equal(metrics.queries, 2); assert.equal(metrics.reads, 59); assert.equal(metrics.guardReads, 3);
  reset();
  const second = await api.getWeplayRanking(request('teacher', { ...naval, classId: 'class-two' })); counts.teacherSelectedClass = { ...metrics };
  assert.equal(second.selectedClassId, 'class-two'); assert.equal(second.classes, undefined); assert.equal(second.rows[0].score, 99999);
  assert.equal(metrics.reads, 8); assert.equal(metrics.queries, 1); assert.equal(metrics.writes, 0);
  reset(); await api.getWeplayRanking(request('teacher', { ...naval, classId: 'class-two' })); counts.teacherSelectedWarm = { ...metrics };
  assert.equal(metrics.reads, 7); assert.equal(metrics.queries, 0); assert.equal(metrics.guardReads, 3); assert.equal(metrics.writes, 0);
  for (const actor of ['teacher', 'admin', 'staff-allowed']) for (const choice of [naval, hidden, { gameId: 'gungdeok-rock', category: 'arirang:easy' }]) {
    reset(); const result = await api.getWeplayRanking(request(actor, { ...choice, classId: 'class-one' }));
    assert.equal(result.selectedClassId, 'class-one'); assert.equal(result.rows.length > 0, true); assert.equal(metrics.writes, 0);
  }
  for (const actor of ['staff-denied', 'staff-no-portal', 'a']) {
    reset(); await deny(api.getWeplayRanking(request(actor, { ...hidden, classId: 'class-two', includeClasses: true })), 'permission-denied');
    assert.equal(metrics.queries, 0); assert.equal(metrics.writes, 0);
  }
  for (const choice of [naval, hidden, { gameId: 'gungdeok-rock', category: 'arirang:easy' }]) await deny(api.getWeplayRanking(request('a', choice)), 'permission-denied');
  for (const classId of ['class-old', 'class-inactive', 'class-readonly', 'missing-class']) {
    reset(); await deny(api.getWeplayRanking(request('teacher', { ...hidden, classId })), 'permission-denied');
    assert.equal(metrics.queries, 0); assert.equal(metrics.writes, 0);
  }
  await deny(api.getWeplayRanking(request('teacher', { ...hidden, year: '2025', classId: 'class-old' })), 'failed-precondition');
  const refreshed = await api.getWeplayRanking(request('teacher', { ...naval, classId: 'class-two', includeClasses: true }));
  assert.deepEqual(refreshed.classes, initial.classes); assert.equal(refreshed.selectedClassId, 'class-two');
  await db.doc('users/staff-allowed').update({ staffPermissions: [] });
  await deny(api.getWeplayRanking(request('staff-allowed', { ...naval, classId: 'class-two' })), 'permission-denied');
  await db.doc('users/staff-allowed').update({ staffPermissions: ['lesson_read'] });
  for (const actor of ['teacher', 'admin', 'staff-allowed']) {
    reset(); await deny(api.startRhythmRankingGame(request(actor, { songId: 'arirang', difficulty: 'easy', requestId: randomUUID() })), 'permission-denied');
    await deny(api.finishRhythmRankingGame(request(actor, { sessionId: 'a'.repeat(64), events: [] })), 'permission-denied');
    assert.equal(metrics.writes, 0);
  }
  await db.doc('site_settings/config').set(scope);
  for (const [documentPath, data] of originals) if (data) await db.doc(documentPath).set(data); else await db.doc(documentPath).delete();
  // Explicit target/list spoofing is rejected even when student admission is open.
  for (const extra of [{ classId: 'class-one' }, { classId: 'class-two' }, { includeClasses: true }]) await deny(api.getWeplayRanking(request('a', { ...hidden, ...extra })), 'permission-denied');
  await db.doc('semester_classes/class-one').update({ status: 'ARCHIVED' });
  await db.doc('semester_classes/class-two').update({ status: 'ARCHIVED' });
  reset(); const empty = await api.getWeplayRanking(request('teacher', hidden));
  assert.deepEqual(empty.classes, []); assert.equal(empty.selectedClassId, ''); assert.deepEqual(empty.rows, []); assert.equal(metrics.queries, 1); assert.equal(metrics.writes, 0);
  await db.doc('semester_classes/class-one').update({ status: 'ACTIVE' });
  await db.doc('semester_classes/class-two').update({ status: 'ACTIVE' });
  const batch = db.batch();
  for (let i = 0; i < 100; i++) batch.set(db.doc(`semester_classes/bound-${i}`), { semesterId: '2026-2', status: 'ACTIVE', grade: '1', classNumber: String(i + 1) });
  await batch.commit();
  reset(); await deny(api.getWeplayRanking(request('teacher', hidden)), 'failed-precondition');
  assert.equal(metrics.queries, 1); assert.equal(metrics.writes, 0, 'catalog overflow fails explicitly without a partial list or writes');
  reset(); const bounded = await api.getWeplayRanking(request('teacher', { ...hidden, classId: 'class-one' }));
  assert.equal(bounded.selectedClassId, 'class-one'); assert.equal(metrics.queries, 0, 'selected-class lookup never scans the catalog'); assert.equal(metrics.writes, 0);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  DocumentReference.prototype.get = originalGet;
  await db.terminate();
});
