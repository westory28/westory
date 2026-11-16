const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { assertStudentMenuVisible } = require('./studentMenuVisibility');
const { readGameSettings } = require('./weplayCore');
const { LIMIT, root, boardId, studentLabel, prepareRankingUpdate } = require('./weplayRankingStore');
const { RHYTHM_SONGS } = require('./rhythmRankingCore/rhythmSongs');
const { createChart, createScore, judgeInput, applyJudgement, HIT_WINDOW_SECONDS } = require('./rhythmRankingCore/rhythmCore');

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new HttpsError(code, message); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const CACHE_MS = 60_000;
const SESSION_MS = 2 * 60 * 60_000;
const menuKeys = { 'history-rain': 'naval', 'joseon-yut': 'yut', 'gungdeok-rock': 'rhythm' };
const validGame = gameId => typeof gameId === 'string' && Object.hasOwn(menuKeys, gameId);
const scopeFrom = data => {
  if (typeof data?.year !== 'string' || !/^\d{4}$/.test(data.year) || !['1', '2'].includes(data.semester)) fail('invalid-argument', '현재 학기를 확인해 주세요.');
  return { year: data.year, semester: data.semester, id: `${data.year}-${data.semester}` };
};
const rhythmChoice = (songId, difficulty) => {
  const song = RHYTHM_SONGS.find(value => value.id === songId);
  if (!song || !['easy', 'normal', 'hard'].includes(difficulty)) fail('invalid-argument', '곡과 장단을 다시 선택해 주세요.');
  return { song, difficulty, category: `${songId}:${difficulty}` };
};

function replayRhythm(song, difficulty, events) {
  if (!Array.isArray(events) || events.length > 5000) fail('invalid-argument', '연주 기록을 확인하지 못했습니다. 다시 연주해 주세요.');
  const chart = createChart(song, difficulty), judged = new Set();
  let score = createScore(), blockedUntil = 0, lastTime = -1;
  for (const event of events) {
    if (!event || !Number.isFinite(event.time) || event.time < -0.5 || event.time < lastTime
      || event.time > song.duration + 0.5 || !['center', 'rim'].includes(event.kind) || !['left', 'right'].includes(event.hand)) fail('invalid-argument', '연주 기록을 확인하지 못했습니다. 다시 연주해 주세요.');
    lastTime = event.time;
    for (const note of chart) {
      if (note.time >= event.time - HIT_WINDOW_SECONDS) break;
      if (!judged.has(note.id)) { judged.add(note.id); score = applyJudgement(score, 'miss'); }
    }
    const input = judgeInput(chart, judged, event.kind, event.hand, event.time, blockedUntil);
    blockedUntil = input.blockedUntil;
    if (input.judgement !== 'ignored') score = applyJudgement(score, input.judgement);
    if (input.note) judged.add(input.note.id);
  }
  for (const note of chart) if (!judged.has(note.id)) score = applyJudgement(score, 'miss');
  return { ...score, noteCount: chart.length };
}

function createWeplayRankingHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now }) {
  // Only ranking payloads are cached. Authorization, publication and semester
  // checks always read fresh server state, including cache hits. Never cache errors.
  const cache = new Map();
  const cached = async (key, load, refresh = false) => {
    const previous = cache.get(key);
    if (!refresh && previous && previous.expiresAt > now()) return previous.promise;
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    const item = { expiresAt: now() + CACHE_MS, promise: null };
    item.promise = load().catch(error => { if (cache.get(key) === item) cache.delete(key); throw error; });
    cache.set(key, item);
    return item.promise;
  };
  const authority = async (reader, request, scope, gameId) => {
    const read = reference => reader === db ? reference.get() : reader.get(reference);
    const uid = request.auth?.uid, email = String(request.auth?.token?.email || '').toLowerCase();
    if (!uid) fail('unauthenticated', '로그인 후 이용해 주세요.');
    if (!/@yongshin-ms\.ms\.kr$/.test(email) || !validGame(gameId)) fail('permission-denied', '학생 계정으로 이용해 주세요.');
    const slotId = `slot_${hash(`${scope.id}\n${uid}`).slice(0, 40)}`;
    const publicationPath = gameId === 'gungdeok-rock' ? `${root(scope)}/rhythm_publication/${gameId}` : `${root(scope)}/weplay_games/${gameId}`;
    const [userSnap, configSnap, pointerSnap, manifestSnap, publicationSnap, slotSnap] = await reader.getAll(
      db.doc(`users/${uid}`), db.doc('site_settings/config'), db.doc('site_settings/semester_active'),
      db.doc(`semester_manifests/${scope.id}`), db.doc(publicationPath), db.doc(`semester_enrollment_slots/${slotId}`));
    const profile = userSnap.data() || {}, config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
    if (profile.role !== 'student' || profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending
      || (Object.hasOwn(profile, 'registrationApprovalStatus') && profile.registrationApprovalStatus !== 'APPROVED')) fail('permission-denied', '학생 계정으로 이용해 주세요.');
    if (String(config.year) !== scope.year || String(config.semester) !== scope.semester || pointer.semesterId !== scope.id
      || manifest.status !== 'ACTIVE' || manifest.readOnly === true || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1 || pointer.revision !== manifest.revision) fail('failed-precondition', '현재 운영 중인 학기에서 이용해 주세요.');
    assertStudentMenuVisible(config, ['weplay', menuKeys[gameId]]);
    const publication = gameId === 'history-rain' ? readGameSettings(publicationSnap.data()) : publicationSnap.data();
    if (publication?.enabled !== true || (gameId === 'gungdeok-rock'
      ? publication.schemaVersion !== 1 || !Number.isSafeInteger(publication.revision) || publication.revision < 1
      : !Number.isSafeInteger(publication.version) || publication.version < 0)) fail('permission-denied', '지금은 이 게임이 열려 있지 않습니다.');
    const slot = slotSnap.data() || {};
    if (slot.studentUid !== uid || slot.semesterId !== scope.id || !identifier(slot.activeEnrollmentId) || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const enrollment = (await read(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data() || {};
    if (enrollment.studentUid !== uid || enrollment.semesterId !== scope.id || enrollment.enrollmentStatus !== 'ACTIVE'
      || enrollment.readOnly === true || !identifier(enrollment.classId)) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const classroom = (await read(db.doc(`semester_classes/${enrollment.classId}`))).data() || {};
    if (classroom.semesterId !== scope.id || classroom.status !== 'ACTIVE' || classroom.readOnly === true) fail('permission-denied', '현재 학급 정보를 확인해 주세요.');
    const grade = String(classroom.grade || profile.studentGrade || profile.grade || '').replace(/학년$/, '').trim();
    const classNumber = String(classroom.classNumber || profile.studentClass || profile.class || '').replace(/반$/, '').trim();
    return { uid, classId: enrollment.classId, enrollmentId: slot.activeEnrollmentId, rankingLabel: studentLabel(profile, enrollment),
      classKey: /^\d{1,3}$/.test(grade) && /^\d{1,3}$/.test(classNumber) ? `${Number(grade)}-${Number(classNumber)}` : '',
      revision: publication.revision ?? publication.version };
  };
  const getWeplayRanking = async request => {
    await assertSession(request);
    const scope = scopeFrom(request.data), gameId = request.data?.gameId;
    if (!validGame(gameId)) fail('invalid-argument', '게임을 다시 선택해 주세요.');
    const category = request.data?.category;
    if (gameId === 'history-rain' && !['mild', 'medium', 'spicy'].includes(category)) fail('invalid-argument', '난이도를 다시 선택해 주세요.');
    if (gameId === 'joseon-yut' && category !== 'wins') fail('invalid-argument', '랭킹을 다시 선택해 주세요.');
    if (gameId === 'gungdeok-rock') { const [songId, difficulty, extra] = String(category).split(':'); if (extra) fail('invalid-argument', '곡과 장단을 다시 선택해 주세요.'); rhythmChoice(songId, difficulty); }
    const actor = await authority(db, request, scope, gameId);
    const boundary = `${scope.id}/${gameId}/${category}/${actor.classId}/${actor.revision}`;
    let payload;
    if (gameId === 'history-rain') {
      const meta = (await db.doc(`${root(scope)}/weplay_meta/current`).get()).data();
      if (!identifier(meta?.periodId)) payload = { rows: [], updatedAtMs: now() };
      else {
        const period = (await db.doc(`${root(scope)}/weplay_periods/${meta.periodId}`).get()).data();
        if (!period || period.endsAtMs <= now()) payload = { rows: [], updatedAtMs: now() };
        else payload = await cached(`${boundary}/${meta.periodId}/${actor.classKey}`, async () => {
          const snapshot = actor.classKey ? await db.collection(`${root(scope)}/weplay_periods/${meta.periodId}/entries`)
            .where('classKey', '==', actor.classKey).where('difficulty', '==', category)
            .orderBy('score', 'desc').orderBy('achievedAtMs', 'asc').orderBy('uid', 'asc').limit(LIMIT)
            .select('uid', 'studentLabel', 'score').get() : null;
          return { rows: (snapshot?.docs || []).map(doc => doc.data()), updatedAtMs: now(), period: { startsAtMs: period.startsAtMs, endsAtMs: period.endsAtMs } };
        }, request.data?.refresh === true);
      }
    } else payload = await cached(boundary, async () => {
      const board = (await db.doc(`${root(scope)}/weplay_rankings/${boardId(gameId, category, actor.classId)}`).get()).data();
      return { rows: board?.rows || [], updatedAtMs: board?.updatedAtMs || now(), ...(board?.trackingSinceMs ? { trackingSinceMs: board.trackingSinceMs } : {}) };
    }, request.data?.refresh === true);
    return { ...payload, gameId, category, limit: LIMIT, cacheTtlMs: CACHE_MS, scoreLabel: gameId === 'joseon-yut' ? '승' : '점',
      rows: payload.rows.map((row, index) => ({ rank: index + 1, studentLabel: row.studentLabel, score: row.score, isMe: row.uid === actor.uid })) };
  };
  const startRhythmRankingGame = async request => {
    await assertSession(request);
    const scope = scopeFrom(request.data), choice = rhythmChoice(request.data?.songId, request.data?.difficulty);
    if (!identifier(request.data?.requestId)) fail('invalid-argument', '연주 요청을 다시 확인해 주세요.');
    return db.runTransaction(async transaction => {
      const actor = await authority(transaction, request, scope, 'gungdeok-rock');
      const sessionId = hash(`${actor.uid}\n${request.data.requestId}`), runRef = db.doc(`${root(scope)}/rhythm_players/${actor.uid}`);
      const existing = (await transaction.get(runRef)).data();
      if (existing?.sessionId === sessionId) {
        if (existing.category !== choice.category) fail('invalid-argument', '같은 연주 요청의 곡과 장단은 바꿀 수 없습니다.');
        return { sessionId };
      }
      const atMs = now();
      if (existing && atMs < existing.startedAtMs + 5000) fail('resource-exhausted', '잠시 후 다시 시작해 주세요.');
      transaction.set(runRef, { sessionId, uid: actor.uid, classId: actor.classId, enrollmentId: actor.enrollmentId,
        songId: choice.song.id, difficulty: choice.difficulty, category: choice.category, duration: choice.song.duration,
        startedAtMs: atMs, expiresAtMs: atMs + SESSION_MS, status: 'active' });
      return { sessionId };
    });
  };
  const finishRhythmRankingGame = async request => {
    await assertSession(request);
    const scope = scopeFrom(request.data), sessionId = request.data?.sessionId;
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(sessionId)) fail('invalid-argument', '연주 기록을 확인해 주세요.');
    const result = await db.runTransaction(async transaction => {
      const actor = await authority(transaction, request, scope, 'gungdeok-rock');
      const runRef = db.doc(`${root(scope)}/rhythm_players/${actor.uid}`), run = (await transaction.get(runRef)).data();
      if (!run || run.sessionId !== sessionId || run.uid !== actor.uid || run.classId !== actor.classId || run.enrollmentId !== actor.enrollmentId) fail('failed-precondition', '현재 연주 기록을 확인하지 못했습니다. 다시 연주해 주세요.');
      if (run.status === 'finished') return run.result;
      const atMs = now();
      if (atMs < run.startedAtMs + (run.duration - 1) * 1000 || atMs > run.expiresAtMs) fail('failed-precondition', '연주를 끝까지 마친 뒤 기록할 수 있습니다.');
      const choice = rhythmChoice(run.songId, run.difficulty), score = replayRhythm(choice.song, choice.difficulty, request.data?.events);
      const ranking = score.score > 0 ? await prepareRankingUpdate({ db, transaction, scope, gameId: 'gungdeok-rock', category: choice.category, actor, score: score.score, atMs }) : null;
      const value = { sessionId, ...score };
      ranking?.apply();
      transaction.update(runRef, { status: 'finished', result: value, finishedAtMs: atMs });
      return value;
    });
    // Updating any board clears only this bounded in-process payload cache.
    // Other instances expire within 60 seconds; no listener or polling is added.
    cache.clear();
    return result;
  };
  return { getWeplayRanking, startRhythmRankingGame, finishRhythmRankingGame };
}

module.exports = { createWeplayRankingHandlers, replayRhythm, CACHE_MS };
