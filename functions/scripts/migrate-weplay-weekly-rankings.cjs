'use strict';

// Offline maintenance entry point. Dry-run is the default. Only weekly ranking
// projections may be written; game records, rewards and profiles are read-only.
const { createHash } = require('node:crypto');
const { weekAt, root, prepareRankingUpdate } = require('../weplayRankingStore');

const PAGE_SIZE = 200;
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const fingerprint = value => hash(JSON.stringify(stable(value)) ?? '__missing__');
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const within = (value, week) => Number.isSafeInteger(value) && value >= week.startsAtMs && value < week.endsAtMs;
const fields = {
  board: ['gameId', 'category', 'classId', 'trackingSinceMs'],
  entry: ['uid', 'studentLabel', 'score', 'achievedAtMs', 'classId', 'difficulty', 'classKey', 'sessionId'],
  period: ['battleVersion', 'startsAtMs', 'endsAtMs'],
  classroom: ['semesterId', 'status', 'readOnly', 'grade', 'classNumber', 'displayName'],
  room: ['status', 'createdAtMs', 'winnerUid', 'finishReason', 'rankingRecordedAtMs', 'weeklyRankingRecordedAtMs', 'lastEvent.kind', 'lastEvent.atMs', 'lastEvent.move.uid', 'enrollmentIds'],
  enrollment: ['studentUid', 'semesterId', 'classId'],
  profile: ['role', 'isDeleted', 'deletedAt', 'weplayDeletionPending', 'registrationApprovalStatus'],
  session: ['uid', 'studentLabel', 'mode', 'battleVersion', 'status', 'periodId', 'classKey', 'classId', 'difficulty', 'rankingWeekId', 'result.score', 'result.finishedAtMs'],
};

function parseArgs(args) {
  const options = { project: 'history-quiz-yongsin', apply: false, writersDeployed: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') { options.apply = true; continue; }
    if (argument === '--writers-deployed') { options.writersDeployed = true; continue; }
    if (argument === '--help') { options.help = true; continue; }
    const [key, inline] = argument.split('=', 2);
    if (!['--project', '--semester-id', '--week'].includes(key)) throw new Error('invalid-arguments');
    const value = inline === undefined ? args[++index] : inline;
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid-arguments');
    options[{ '--project': 'project', '--semester-id': 'semesterId', '--week': 'weekId' }[key]] = value;
  }
  if (options.help) return options;
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)
    || !/^\d{4}-[12]$/.test(options.semesterId || '')
    || (options.weekId && !/^\d{4}-\d{2}-\d{2}$/.test(options.weekId))) throw new Error('invalid-arguments');
  if (options.apply && !options.writersDeployed) throw new Error('writers-deployment-required');
  return options;
}

// Cursor pages cover the complete server-filtered result; PAGE_SIZE is not a
// total-record cap. Field masks reduce transfer, not Firestore billed reads.
async function readPages(query, stats) {
  const documents = [];
  let cursor;
  for (;;) {
    const snapshot = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    stats.queryPages++;
    stats.sourceDocumentsRead += snapshot.size;
    documents.push(...snapshot.docs);
    if (snapshot.size < PAGE_SIZE) return documents;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function planMigration({ db, options, now = Date.now, documentId = '__name__' }) {
  const atMs = now(), week = weekAt(atMs);
  const scope = { year: options.semesterId.slice(0, 4), semester: options.semesterId.slice(5), id: options.semesterId };
  const base = root(scope), issues = {}, records = [];
  const stats = { sourceDocumentsRead: 0, queryPages: 0, legacyBoards: 0, navalPeriods: 0, futurePeriodMetadataSkipped: 0, navalSessions: 0, excludedNativeNavalSessions: 0, sourcePlayers: 0, verifiedYutWins: 0, yutCompletionTimeFallbackWins: 0, excludedNativeYutWins: 0, skippedIneligiblePlayers: 0, plannedPlayers: 0 };
  const issue = code => { issues[code] = (issues[code] || 0) + 1; };
  const watch = (snapshot, fieldMask) => ({ ref: snapshot.ref, fieldMask, fingerprint: fingerprint(snapshot.data()) });
  const read = async (path, fieldMask) => {
    const [snapshot] = await db.getAll(db.doc(path), { fieldMask });
    stats.sourceDocumentsRead++;
    return snapshot;
  };
  if (options.weekId && options.weekId !== week.id) issue('requested-week-is-not-current');
  const common = [];
  const pointer = await read('site_settings/semester_active', ['semesterId', 'revision']);
  const manifest = await read(`semester_manifests/${scope.id}`, ['status', 'readOnly', 'revision']);
  const config = await read('site_settings/config', ['year', 'semester']);
  common.push(watch(pointer, ['semesterId', 'revision']), watch(manifest, ['status', 'readOnly', 'revision']), watch(config, ['year', 'semester']));
  if (pointer.data()?.semesterId !== scope.id || manifest.data()?.status !== 'ACTIVE' || manifest.data()?.readOnly === true
    || !Number.isSafeInteger(manifest.data()?.revision) || manifest.data().revision < 1 || pointer.data()?.revision !== manifest.data()?.revision
    || String(config.data()?.year) !== scope.year || String(config.data()?.semester) !== scope.semester) issue('semester-is-not-active');

  const classes = await readPages(db.collection('semester_classes').where('semesterId', '==', scope.id)
    .select(...fields.classroom).orderBy(documentId), stats);
  const classMap = new Map(classes.map(snapshot => [snapshot.id, snapshot]));
  const classKeyMap = new Map();
  for (const snapshot of classes) {
    const value = snapshot.data();
    if (value.status !== 'ACTIVE' || value.readOnly === true) continue;
    const grade = String(value.grade || '').replace(/학년$/, '').trim(), number = String(value.classNumber || '').replace(/반$/, '').trim();
    if (/^\d{1,3}$/.test(grade) && /^\d{1,3}$/.test(number)) {
      const key = `${Number(grade)}-${Number(number)}`;
      classKeyMap.set(key, classKeyMap.has(key) ? null : snapshot.id);
    }
  }
  const resolveClass = classId => {
    const snapshot = classMap.get(classId), value = snapshot?.data();
    if (!value || value.status !== 'ACTIVE' || value.readOnly === true) { issue('class-is-missing-or-inactive'); return null; }
    const grade = String(value.grade || '').replace(/학년$/, '').trim(), number = String(value.classNumber || '').replace(/반$/, '').trim();
    return { classId, classLabel: /^\d{1,3}$/.test(grade) && /^\d{1,3}$/.test(number)
      ? `${Number(grade)}학년 ${Number(number)}반` : String(value.displayName || '학급').slice(0, 60), source: watch(snapshot, fields.classroom) };
  };
  const profileCache = new Map();
  const profileFor = async uid => {
    if (!profileCache.has(uid)) profileCache.set(uid, await read(`users/${uid}`, fields.profile));
    const snapshot = profileCache.get(uid), value = snapshot.data();
    if (!value || value.role !== 'student' || value.isDeleted || value.deletedAt || value.weplayDeletionPending
      || (Object.hasOwn(value, 'registrationApprovalStatus') && value.registrationApprovalStatus !== 'APPROVED')) return null;
    return watch(snapshot, fields.profile);
  };
  const append = async (row, gameId, category, classroom, sources, extra = {}) => {
    if (!identifier(row.uid) || !Number.isSafeInteger(row.score) || row.score <= 0 || !within(row.achievedAtMs, week)
      || typeof row.studentLabel !== 'string' || !row.studentLabel || row.studentLabel.length > 60) { issue('invalid-source-player'); return; }
    const profile = await profileFor(row.uid);
    if (!profile) { stats.skippedIneligiblePlayers++; return; }
    if (!classroom) return;
    records.push({ gameId, category, actor: { uid: row.uid, rankingLabel: row.studentLabel, classId: classroom.classId, classLabel: classroom.classLabel },
      score: row.score, atMs: row.achievedAtMs, ...extra, sources: [...sources, classroom.source, profile] });
  };

  const boards = await readPages(db.collection(`${base}/weplay_rankings`).where('gameId', 'in', ['joseon-yut', 'gungdeok-rock'])
    .select(...fields.board).orderBy(documentId), stats);
  stats.legacyBoards = boards.length;
  const yutSources = [];
  for (const snapshot of boards) {
    const board = snapshot.data();
    const entries = await readPages(snapshot.ref.collection('players').select(...fields.entry).orderBy(documentId), stats);
    stats.sourcePlayers += entries.length;
    if (!entries.length) continue;
    const classroom = resolveClass(board.classId), sources = [watch(snapshot, fields.board)];
    if (board.gameId === 'gungdeok-rock') {
      const { RHYTHM_SONGS } = require('../rhythmRankingCore/rhythmSongs');
      const [songId, difficulty, extra] = String(board.category || '').split(':');
      if (extra || !RHYTHM_SONGS.some(song => song.id === songId) || !['easy', 'normal', 'hard'].includes(difficulty)) { issue('invalid-rhythm-category'); continue; }
      if (!within(board.trackingSinceMs, week)) { issue('rhythm-lifetime-best-cannot-prove-weekly-best'); continue; }
      for (const entry of entries) {
        const row = entry.data();
        if (row.uid !== entry.id || row.achievedAtMs < board.trackingSinceMs) { issue('invalid-rhythm-source-time'); continue; }
        await append(row, board.gameId, board.category, classroom, [...sources, watch(entry, fields.entry)]);
      }
    } else {
      if (board.category !== 'wins') { issue('invalid-yut-category'); continue; }
      for (const entry of entries) {
        const row = entry.data();
        if (row.uid !== entry.id || !identifier(row.uid) || !Number.isSafeInteger(row.score) || row.score <= 0) { issue('invalid-yut-source-player'); continue; }
        yutSources.push({ row, classroom, sources: [...sources, watch(entry, fields.entry)], sourceId: hash(snapshot.ref.path), wins: [] });
      }
    }
  }

  if (yutSources.length) {
    const rooms = await readPages(db.collection(`${base}/yut_rooms`).where('rankingRecordedAtMs', '>=', week.startsAtMs)
      .where('rankingRecordedAtMs', '<', week.endsAtMs).select(...fields.room).orderBy('rankingRecordedAtMs').orderBy(documentId), stats);
    const enrollmentCache = new Map();
    const byWinner = new Map();
    for (const source of yutSources) {
      const list = byWinner.get(source.row.uid) || []; list.push(source); byWinner.set(source.row.uid, list);
    }
    for (const snapshot of rooms) {
      const room = snapshot.data(), candidates = byWinner.get(room.winnerUid);
      if (!candidates) continue;
      if (room.weeklyRankingRecordedAtMs) { stats.excludedNativeYutWins++; continue; }
      const directFinish = room.lastEvent?.kind === 'finish';
      const recordedThisWeek = within(room.rankingRecordedAtMs, week) && room.rankingRecordedAtMs <= atMs;
      const exactTime = directFinish && room.lastEvent?.move?.uid === room.winnerUid && within(room.lastEvent?.atMs, week)
        && room.lastEvent.atMs <= room.rankingRecordedAtMs
        && (room.createdAtMs === undefined || (Number.isSafeInteger(room.createdAtMs) && room.createdAtMs <= room.lastEvent.atMs));
      // The server sets immutable createdAtMs once; a room cannot restart or be
      // recreated with the same ID. Its legacy ranking marker is written only
      // after completion. Thus created <= completion <= recorded proves the
      // week even after leave/close overwrites lastEvent. Keep the old record
      // time as the tie key; never present it as an exact completion timestamp.
      const intervalProof = !directFinish && ['leave', 'close'].includes(room.lastEvent?.kind)
        && within(room.createdAtMs, week) && room.createdAtMs <= room.rankingRecordedAtMs
        && Number.isSafeInteger(room.lastEvent?.atMs) && room.lastEvent.atMs >= room.createdAtMs && room.lastEvent.atMs <= atMs;
      if (!['finished', 'closed'].includes(room.status) || room.finishReason !== 'completion' || !recordedThisWeek
        || (!exactTime && !intervalProof)) { issue('yut-completion-time-is-unverifiable'); continue; }
      const achievedAtMs = exactTime ? room.lastEvent.atMs : room.rankingRecordedAtMs;
      const enrollmentId = room.enrollmentIds?.[room.winnerUid];
      if (!identifier(enrollmentId)) { issue('yut-completion-class-is-unverifiable'); continue; }
      if (!enrollmentCache.has(enrollmentId)) enrollmentCache.set(enrollmentId, await read(`semester_enrollments/${enrollmentId}`, fields.enrollment));
      const enrollment = enrollmentCache.get(enrollmentId), value = enrollment.data();
      if (value?.studentUid !== room.winnerUid || value?.semesterId !== scope.id) { issue('yut-completion-class-is-unverifiable'); continue; }
      const source = candidates.find(candidate => candidate.classroom?.classId === value.classId);
      if (!source) { issue('yut-completion-class-is-unverifiable'); continue; }
      if (!exactTime) stats.yutCompletionTimeFallbackWins++;
      source.wins.push(achievedAtMs);
      source.sources.push(watch(snapshot, fields.room), watch(enrollment, fields.enrollment));
    }
    for (const source of yutSources) {
      if (source.wins.length !== source.row.score) { issue('yut-cumulative-total-cannot-prove-weekly-wins'); continue; }
      stats.verifiedYutWins += source.wins.length;
      await append({ ...source.row, achievedAtMs: Math.max(...source.wins) }, 'joseon-yut', 'wins', source.classroom,
        source.sources, { increment: true, legacySourceId: source.sourceId });
    }
  }

  // One indexed time range reads only candidate period metadata, including any
  // monthly period spanning the whole week. Future metadata is discarded before
  // reading student records. This avoids adding a one-off migration index.
  const periods = await readPages(db.collection(`${base}/weplay_periods`).where('endsAtMs', '>', week.startsAtMs)
    .select(...fields.period).orderBy('endsAtMs').orderBy(documentId), stats);
  stats.navalPeriods = periods.length;
  for (const snapshot of periods) {
    const period = snapshot.data();
    if (period.battleVersion !== 1) continue;
    if (period.startsAtMs >= week.endsAtMs) { stats.futurePeriodMetadataSkipped++; continue; }
    if (!Number.isSafeInteger(period.startsAtMs) || !Number.isSafeInteger(period.endsAtMs)
      || period.startsAtMs < week.startsAtMs || period.endsAtMs > week.endsAtMs || !(period.startsAtMs < period.endsAtMs)) { issue('naval-period-overlaps-another-week'); continue; }
    // Per-period entries keep only one best per UID, losing a former class's
    // lower best after a class change. Finished sessions retain both records.
    const sessions = await readPages(db.collection(`${base}/weplay_sessions`).where('periodId', '==', snapshot.id)
      .where('mode', '==', 'challenge').where('status', '==', 'finished')
      .select(...fields.session).orderBy(documentId), stats);
    stats.navalSessions += sessions.length;
    if (!sessions.length) continue;
    const bests = new Map();
    for (const session of sessions) {
      const value = session.data();
      if (!within(value.result?.finishedAtMs, week) || value.result.finishedAtMs > atMs) { issue('naval-result-is-unverifiable'); continue; }
      if (value.rankingWeekId === week.id) { stats.excludedNativeNavalSessions++; continue; }
      if (value.rankingWeekId || value.battleVersion !== 1 || !['mild', 'medium', 'spicy'].includes(value.difficulty)
        || !Number.isSafeInteger(value.result?.score) || value.result.score < 0) { issue('naval-result-is-unverifiable'); continue; }
      if (value.result.score === 0) continue;
      const classId = value.classId || classKeyMap.get(value.classKey);
      if (!classId || (value.classId && classKeyMap.get(value.classKey) !== value.classId)) { issue('naval-class-is-ambiguous'); continue; }
      const key = `${value.uid}\n${classId}\n${value.difficulty}`, previous = bests.get(key);
      if (!previous || value.result.score > previous.value.result.score
        || (value.result.score === previous.value.result.score && value.result.finishedAtMs < previous.value.result.finishedAtMs)) bests.set(key, { value, session, classId });
    }
    for (const { value, session, classId } of bests.values()) {
      const row = { uid: value.uid, studentLabel: value.studentLabel, score: value.result.score, achievedAtMs: value.result.finishedAtMs };
      await append(row, 'history-rain', value.difficulty, resolveClass(classId), [watch(snapshot, fields.period), watch(session, fields.session)]);
    }
  }
  stats.plannedPlayers = records.length;
  return { scope, week, issues, stats, records, common };
}

async function applyPlan({ db, plan, now = Date.now }) {
  if (Object.keys(plan.issues).length) throw new Error('source-validation-blocked');
  let changed = 0, unchanged = 0;
  for (const record of plan.records) {
    const result = await db.runTransaction(async transaction => {
      if (weekAt(now()).id !== plan.week.id) throw new Error('week-changed');
      // Re-read relevant source fields and authorization before projection reads
      // or writes. Concurrent writers contend on the same weekly player/boards.
      const sources = new Map([...plan.common, ...record.sources].map(source => [source.ref.path, source]));
      for (const source of sources.values()) {
        const [snapshot] = await transaction.getAll(source.ref, { fieldMask: source.fieldMask });
        if (fingerprint(snapshot.data()) !== source.fingerprint) throw new Error('source-changed-rerun-dry-run');
      }
      const update = await prepareRankingUpdate({ db, transaction, scope: plan.scope, ...record });
      update.apply();
      return update.changed;
    });
    if (result) changed++; else unchanged++;
  }
  return { changed, unchanged };
}

async function runMigration({ db, options, now = Date.now, documentId }) {
  if (options.apply && !options.writersDeployed) throw new Error('writers-deployment-required');
  const plan = await planMigration({ db, options, now, documentId });
  const report = { mode: options.apply ? 'apply' : 'dry-run', semesterId: plan.scope.id, weekId: plan.week.id,
    blocked: Object.keys(plan.issues).length > 0, issues: plan.issues, ...plan.stats, changed: 0, unchanged: 0 };
  if (options.apply && !report.blocked) Object.assign(report, await applyPlan({ db, plan, now }));
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node functions/scripts/migrate-weplay-weekly-rankings.cjs --semester-id YYYY-S [--week YYYY-MM-DD] [--project history-quiz-yongsin] [--apply --writers-deployed]');
    return;
  }
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  const { resolveCredential } = require('./rebuild-wis-ranking-index.cjs');
  const credential = process.env.FIRESTORE_EMULATOR_HOST ? undefined : await resolveCredential();
  const app = initializeApp({ projectId: options.project, ...(credential ? { credential } : {}) }, 'weplay-weekly-migration');
  try {
    const report = await runMigration({ db: getFirestore(app), options, documentId: FieldPath.documentId() });
    console.log(JSON.stringify(report));
    if (report.blocked) process.exitCode = 2;
  } finally { await deleteApp(app); }
}

if (require.main === module) main().catch(error => {
  const safe = new Set(['invalid-arguments', 'writers-deployment-required', 'source-validation-blocked', 'week-changed', 'source-changed-rerun-dry-run']);
  // Never print SDK errors, document paths, UID, names, access tokens or rows.
  console.error(JSON.stringify({ blocked: true, error: safe.has(error.message) ? error.message
    : error.code === 9 ? 'source-query-index-required' : 'migration-operation-failed' }));
  process.exitCode = 2;
});

module.exports = { parseArgs, readPages, planMigration, applyPlan, runMigration };
