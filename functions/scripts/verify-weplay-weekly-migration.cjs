'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, planMigration, applyPlan, runMigration, readPages } = require('./migrate-weplay-weekly-rankings.cjs');
const { prepareRankingUpdate, weekAt, weeklyBoardId, boardId } = require('../weplayRankingStore');
const { RHYTHM_SONGS } = require('../rhythmRankingCore/rhythmSongs');
const time = Date.parse('2026-11-16T10:00:00+09:00'), week = weekAt(time);
const base = 'years/2026/semesters/2', scope = { year: '2026', semester: '2' };
const options = { semesterId: '2026-2', weekId: week.id, apply: false, writersDeployed: false };
const category = `${RHYTHM_SONGS[0].id}:easy`;
const getField = (value, key) => key.split('.').reduce((result, part) => result?.[part], value);
const setField = (value, key, next) => { const parts = key.split('.'); let target = value; for (const part of parts.slice(0, -1)) target = target[part] ||= {}; target[parts.at(-1)] = next; };

function memoryDb(seed = {}) {
  const docs = new Map(Object.entries(structuredClone(seed)));
  let writes = 0;
  const db = {};
  const snapshot = (path, mask) => {
    const source = docs.get(path);
    let data = source;
    if (source && mask) { data = {}; for (const key of mask) { const value = getField(source, key); if (value !== undefined) setField(data, key, value); } }
    return { id: path.split('/').at(-1), ref: db.doc(path), exists: !!source, data: () => structuredClone(data) };
  };
  class Query {
    constructor(path, filters = [], mask, orders = [], size = Infinity, cursor) { Object.assign(this, { path, filters, mask, orders, size, cursor }); }
    copy(patch) { const next = new Query(this.path, this.filters, this.mask, this.orders, this.size, this.cursor); return Object.assign(next, patch); }
    where(...filter) { return this.copy({ filters: [...this.filters, filter] }); }
    select(...mask) { return this.copy({ mask }); }
    orderBy(key) { return this.copy({ orders: [...this.orders, key] }); }
    limit(size) { return this.copy({ size }); }
    startAfter(cursor) { return this.copy({ cursor }); }
    doc(id) { return db.doc(`${this.path}/${id}`); }
    async get() {
      let paths = [...docs.keys()].filter(path => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1);
      paths = paths.filter(path => this.filters.every(([key, op, value]) => {
        const actual = getField(docs.get(path), key);
        if (op === '==') return actual === value;
        if (op === 'in') return value.includes(actual);
        if (op === '>=') return actual >= value;
        if (op === '>') return actual > value;
        if (op === '<') return actual < value;
        throw new Error('unsupported synthetic filter');
      }));
      paths.sort((left, right) => {
        for (const key of this.orders) { const a = key === '__name__' ? left : getField(docs.get(left), key), b = key === '__name__' ? right : getField(docs.get(right), key); if (a !== b) return a < b ? -1 : 1; }
        return left.localeCompare(right);
      });
      if (this.cursor) paths = paths.slice(paths.indexOf(this.cursor.ref.path) + 1);
      const result = paths.slice(0, this.size).map(path => snapshot(path, this.mask));
      return { size: result.length, docs: result };
    }
  }
  db.doc = path => ({ path, id: path.split('/').at(-1), collection: child => new Query(`${path}/${child}`) });
  db.collection = path => new Query(path);
  db.getAll = async (...args) => { const mask = args.at(-1)?.fieldMask; return args.filter(arg => arg.path).map(ref => snapshot(ref.path, mask)); };
  db.runTransaction = async callback => {
    const pending = [];
    const transaction = {
      getAll: async (...args) => { assert.equal(pending.length, 0, 'Firestore reads must precede every write'); return db.getAll(...args); },
      set: (ref, value) => { assert.ok(ref.path.includes('/weplay_weekly_rankings/'), 'migration may only write new projections'); pending.push([ref.path, structuredClone(value)]); },
    };
    const result = await callback(transaction);
    for (const [path, value] of pending) docs.set(path, value);
    writes += pending.length;
    return result;
  };
  return { db, docs, writes: () => writes };
}

function fixture() {
  const yutBoard = `${base}/weplay_rankings/${boardId('joseon-yut', 'wins', 'class-one')}`;
  const rhythmBoard = `${base}/weplay_rankings/${boardId('gungdeok-rock', category, 'class-one')}`;
  const seed = {
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { status: 'ACTIVE', revision: 1 },
    'semester_classes/class-one': { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: '1' },
    'users/synthetic': { role: 'student', registrationApprovalStatus: 'APPROVED' },
    'semester_enrollments/synthetic-en': { studentUid: 'synthetic', semesterId: '2026-2', classId: 'class-one' },
    [yutBoard]: { gameId: 'joseon-yut', category: 'wins', classId: 'class-one', trackingSinceMs: time - 1000 },
    [`${yutBoard}/players/synthetic`]: { uid: 'synthetic', studentLabel: '1번 합○', score: 2, achievedAtMs: time - 100 },
    [rhythmBoard]: { gameId: 'gungdeok-rock', category, classId: 'class-one', trackingSinceMs: time - 1000 },
    [`${rhythmBoard}/players/synthetic`]: { uid: 'synthetic', studentLabel: '1번 합○', score: 300, achievedAtMs: time - 100 },
    [`${base}/weplay_periods/period-one`]: { battleVersion: 1, startsAtMs: week.startsAtMs, endsAtMs: week.endsAtMs },
    [`${base}/weplay_periods/period-one/entries/entry-one`]: { uid: 'synthetic', studentLabel: '1번 합○', score: 250, achievedAtMs: time - 100, difficulty: 'mild', classKey: '3-1', sessionId: 'session-one' },
    [`${base}/weplay_sessions/session-one`]: { uid: 'synthetic', studentLabel: '1번 합○', mode: 'challenge', battleVersion: 1, status: 'finished', periodId: 'period-one', classKey: '3-1', difficulty: 'mild', result: { score: 250, finishedAtMs: time - 100 } },
  };
  for (let index = 0; index < 2; index++) seed[`${base}/yut_rooms/room-${index}`] = { status: 'finished', createdAtMs: time - 500, winnerUid: 'synthetic', finishReason: 'completion', rankingRecordedAtMs: time - 200 + index,
    lastEvent: { kind: 'finish', atMs: time - 300 + index, move: { uid: 'synthetic' } }, enrollmentIds: { synthetic: 'synthetic-en' } };
  return { ...memoryDb(seed), yutBoard, rhythmBoard };
}
const loadPlan = db => planMigration({ db, options, now: () => time });
const apply = (db, plan) => applyPlan({ db, plan, now: () => time });
const weeklyEntry = (game, category) => `${base}/weplay_weekly_rankings/${weeklyBoardId(game, category, '', week.id)}/players/synthetic`;

test('default dry-run reads all sources and writes nothing', async () => {
  const state = fixture(), report = await runMigration({ db: state.db, options, now: () => time });
  assert.equal(report.blocked, false); assert.equal(report.plannedPlayers, 3); assert.equal(report.verifiedYutWins, 2); assert.equal(state.writes(), 0);
  assert.equal(JSON.stringify(report).includes('synthetic'), false);
  assert.equal(parseArgs(['--semester-id', '2026-2']).apply, false);
  assert.throws(() => parseArgs(['--semester-id', '2026-2', '--apply']), /writers-deployment-required/);
});

test('native wins concurrent with migration and retry preserve exact counts and latest tie time', async () => {
  const state = fixture(), plan = await loadPlan(state.db);
  const actor = { uid: 'synthetic', classId: 'class-one', classLabel: '3학년 1반', rankingLabel: '1번 합○' };
  const native = () => state.db.runTransaction(async transaction => (await prepareRankingUpdate({ db: state.db, transaction, scope, gameId: 'joseon-yut', category: 'wins', actor, score: 1, increment: true, atMs: time })).apply());
  await native();
  assert.deepEqual(await apply(state.db, plan), { changed: 3, unchanged: 0 });
  let entry = state.docs.get(weeklyEntry('joseon-yut', 'wins'));
  assert.equal(entry.score, 3); assert.equal(entry.achievedAtMs, time); assert.equal(entry.classScores['class-one'].score, 3);
  const before = state.writes(); assert.deepEqual(await apply(state.db, plan), { changed: 0, unchanged: 3 }); assert.equal(state.writes(), before);
  await native(); await apply(state.db, plan); entry = state.docs.get(weeklyEntry('joseon-yut', 'wins')); assert.equal(entry.score, 4);
});

test('old claim for a prior-week finish blocks instead of importing the cumulative total', async () => {
  const state = fixture(); state.docs.get(`${base}/yut_rooms/room-0`).lastEvent.atMs = week.startsAtMs - 1;
  const plan = await loadPlan(state.db); assert.equal(plan.issues['yut-completion-time-is-unverifiable'], 1); await assert.rejects(apply(state.db, plan), /source-validation-blocked/); assert.equal(state.writes(), 0);
});

test('leave/close without this-week creation evidence and absent rooms block restoration', async () => {
  const state = fixture(); state.docs.get(`${base}/yut_rooms/room-0`).lastEvent.kind = 'leave'; delete state.docs.get(`${base}/yut_rooms/room-0`).createdAtMs; state.docs.delete(`${base}/yut_rooms/room-1`);
  const plan = await loadPlan(state.db); assert.equal(plan.issues['yut-completion-time-is-unverifiable'], 1); assert.equal(plan.issues['yut-cumulative-total-cannot-prove-weekly-wins'], 1);
});

test('new native rooms are excluded from old baseline reconstruction', async () => {
  const state = fixture(); state.docs.set(`${base}/yut_rooms/room-native`, { ...structuredClone(state.docs.get(`${base}/yut_rooms/room-0`)), weeklyRankingRecordedAtMs: time - 100 });
  const plan = await loadPlan(state.db); assert.deepEqual(plan.issues, {}); assert.equal(plan.stats.excludedNativeYutWins, 1); assert.equal(plan.stats.verifiedYutWins, 2);
});

test('rhythm tracking before the week and overlapping naval monthly periods block', async () => {
  const state = fixture(); state.docs.get(state.rhythmBoard).trackingSinceMs = week.startsAtMs - 1; state.docs.get(`${base}/weplay_periods/period-one`).startsAtMs = week.startsAtMs - 1;
  const plan = await loadPlan(state.db); assert.equal(plan.issues['rhythm-lifetime-best-cannot-prove-weekly-best'], 1); assert.equal(plan.issues['naval-period-overlaps-another-week'], 1);
});

test('source changes after plan and Monday rollover cause no first-record writes', async () => {
  const state = fixture(), plan = await loadPlan(state.db); state.docs.get('site_settings/semester_active').revision = 2;
  await assert.rejects(apply(state.db, plan), /source-changed-rerun-dry-run/); assert.equal(state.writes(), 0);
  await assert.rejects(applyPlan({ db: state.db, plan, now: () => week.endsAtMs }), /week-changed/); assert.equal(state.writes(), 0);
});

test('deleted students are never recreated', async () => {
  const state = fixture(); state.docs.get('users/synthetic').isDeleted = true;
  const plan = await loadPlan(state.db); assert.equal(plan.records.length, 0); assert.equal(plan.stats.skippedIneligiblePlayers, 3); await apply(state.db, plan); assert.equal(state.writes(), 0);
});

test('cursor pagination covers more than a page without arbitrary truncation', async () => {
  const state = memoryDb(Object.fromEntries(Array.from({ length: 417 }, (_, index) => [`synthetic/${String(index).padStart(4, '0')}`, { value: index }])));
  const stats = { queryPages: 0, sourceDocumentsRead: 0 }; const docs = await readPages(state.db.collection('synthetic').select('value').orderBy('__name__'), stats);
  assert.equal(docs.length, 417); assert.equal(stats.queryPages, 3); assert.equal(stats.sourceDocumentsRead, 417);
});

test('naval session reconstruction keeps both class bests and excludes already weekly-recorded sessions', async () => {
  const state = fixture();
  state.docs.set('semester_classes/class-two', { semesterId: '2026-2', status: 'ACTIVE', grade: '3', classNumber: '2' });
  const original = state.docs.get(`${base}/weplay_sessions/session-one`);
  state.docs.set(`${base}/weplay_sessions/session-two`, { ...original, classKey: '3-2', result: { score: 500, finishedAtMs: time - 50 } });
  state.docs.set(`${base}/weplay_sessions/session-new`, { ...original, rankingWeekId: week.id, result: { score: 9999, finishedAtMs: time - 10 } });
  const plan = await loadPlan(state.db); assert.deepEqual(plan.issues, {}); assert.equal(plan.stats.excludedNativeNavalSessions, 1);
  await apply(state.db, plan); const entry = state.docs.get(weeklyEntry('history-rain', 'mild'));
  assert.equal(entry.score, 500); assert.equal(entry.classScores['class-one'].score, 250); assert.equal(entry.classScores['class-two'].score, 500);
});

test('future period metadata never causes future student sessions to be read or imported', async () => {
  const state = fixture();
  state.docs.set(`${base}/weplay_periods/future`, { battleVersion: 1, startsAtMs: week.endsAtMs, endsAtMs: week.endsAtMs + 86400000 * 7 });
  state.docs.set(`${base}/weplay_sessions/future`, { ...state.docs.get(`${base}/weplay_sessions/session-one`), periodId: 'future', result: { score: 999999, finishedAtMs: week.endsAtMs + 100 } });
  const plan = await loadPlan(state.db); assert.deepEqual(plan.issues, {}); assert.equal(plan.stats.futurePeriodMetadataSkipped, 1); assert.equal(plan.stats.navalSessions, 1);
});

test('a completed naval record outside its verified week is blocked', async () => {
  const state = fixture(); state.docs.get(`${base}/weplay_sessions/session-one`).result.finishedAtMs = week.startsAtMs - 1;
  const plan = await loadPlan(state.db); assert.equal(plan.issues['naval-result-is-unverifiable'], 1); assert.equal(state.writes(), 0);
});

test('this-week creation and legacy ranking receipt prove overwritten leave/close wins and preserve old tie time', async () => {
  const state = fixture();
  for (let index = 0; index < 2; index++) {
    const room = state.docs.get(`${base}/yut_rooms/room-${index}`); room.status = index ? 'closed' : 'finished';
    room.lastEvent = { kind: index ? 'close' : 'leave', atMs: time - 50 + index };
  }
  const plan = await loadPlan(state.db); assert.deepEqual(plan.issues, {}); assert.equal(plan.stats.yutCompletionTimeFallbackWins, 2);
  await apply(state.db, plan); assert.equal(state.docs.get(weeklyEntry('joseon-yut', 'wins')).score, 2);
  assert.equal(state.docs.get(weeklyEntry('joseon-yut', 'wins')).achievedAtMs, time - 199);
  const before = state.writes(); await apply(state.db, plan); assert.equal(state.writes(), before);
});

test('creation before this week, in future, or after the ranking receipt cannot justify a fallback', async () => {
  for (const invalidCreatedAt of [week.startsAtMs - 1, time + 1000, time - 100]) {
    const state = fixture(), room = state.docs.get(`${base}/yut_rooms/room-0`);
    room.lastEvent = { kind: 'leave', atMs: time - 50 }; room.createdAtMs = invalidCreatedAt;
    const plan = await loadPlan(state.db); assert.equal(plan.issues['yut-completion-time-is-unverifiable'], 1); assert.equal(state.writes(), 0);
  }
});

test('an intact previous-week finish is not rescued by a contradictory this-week creation value', async () => {
  const state = fixture(), room = state.docs.get(`${base}/yut_rooms/room-0`);
  room.lastEvent.atMs = week.startsAtMs - 1;
  const plan = await loadPlan(state.db); assert.equal(plan.issues['yut-completion-time-is-unverifiable'], 1); assert.equal(plan.stats.yutCompletionTimeFallbackWins, 0);
});

test('exact finish time remains the tie key when its event is available', async () => {
  const state = fixture(), plan = await loadPlan(state.db); await apply(state.db, plan);
  assert.equal(state.docs.get(weeklyEntry('joseon-yut', 'wins')).achievedAtMs, time - 299); assert.equal(plan.stats.yutCompletionTimeFallbackWins, 0);
});

test('changing creation evidence after dry-run aborts the source transaction', async () => {
  const state = fixture();
  for (let index = 0; index < 2; index++) state.docs.get(`${base}/yut_rooms/room-${index}`).lastEvent = { kind: 'leave', atMs: time - 50 };
  const plan = await loadPlan(state.db); state.docs.get(`${base}/yut_rooms/room-0`).createdAtMs--;
  await assert.rejects(apply(state.db, { ...plan, records: plan.records.filter(record => record.gameId === 'joseon-yut') }), /source-changed-rerun-dry-run/); assert.equal(state.writes(), 0);
});
