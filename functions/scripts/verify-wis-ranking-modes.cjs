const assert = require('node:assert/strict');
const { setup, accountPath, previewPath, publicId } = require('./verify-wis-ranking-preview.cjs');
const scope = '2026-2';
const rows = state => Object.values(state.hallOfFame.gradeLeaderboardByGrade).flat();
const prepare = (count = 80) => {
  const ctx = setup(count);
  for (const [path, account] of ctx.store.docs) if (path.startsWith('semester_wis_accounts/'))
    ctx.store.patch(path, { earnedTotal: account.rankEarnedTotal });
  return ctx;
};
const update = (ctx, uid, patch, index = true) => {
  if ('rankEarnedTotal' in patch && !('earnedTotal' in patch)) patch = { ...patch, earnedTotal: patch.rankEarnedTotal };
  ctx.store.patch(accountPath(scope, uid), patch);
  if (index) ctx.store.patch(previewPath(scope, uid), patch);
};
const move = (ctx, uid, grade, classNumber) => {
  const account = ctx.store.docs.get(accountPath(scope, uid));
  const classId = `class-${scope}-${grade}-${classNumber}`;
  ctx.store.set(`semester_classes/${classId}`, { classId, semesterId: scope, grade, classNumber, status: 'ACTIVE' });
  ctx.store.patch(`semester_enrollments/${account.enrollmentId}`, { classId, snapshot: { grade, classNumber } });
  update(ctx, uid, { grade, classNumber, classId });
};
const request = (ctx, metric = 'cumulative', classKey = '', extra = {}) => ctx.request({
  uid: 'teacher', audience: 'teacher', rankingMetric: metric, rankingClassKey: classKey, ...extra,
});
const checks = [];
const check = async (name, test) => { await test(); checks.push(name); };

(async () => {
  await check('game spend changes current ranking without lowering earned ranking', async () => {
    const ctx = prepare(); update(ctx, 'student-0', { balance: 1 });
    const cumulative = await request(ctx), current = await request(ctx, 'current');
    assert.equal(rows(cumulative)[0].uid, publicId(scope, 'student-0'));
    assert.equal(rows(cumulative)[0].cumulativeEarned, 1000);
    assert.equal(rows(cumulative)[0].currentBalance, 1);
    assert.equal(rows(current)[0].uid, publicId(scope, 'student-1'));
    assert.equal(current.hallOfFame.rankingMetric, 'currentBalance');
    assert.equal(ctx.store.writes, 0);
  });
  await check('teacher all ranks across grades; selected classes filter on the server', async () => {
    const ctx = prepare(); move(ctx, 'student-0', '2', '7'); move(ctx, 'student-1', '3', '2');
    const all = await request(ctx);
    assert.equal(rows(all)[0].uid, publicId(scope, 'student-0'));
    assert.equal(all.hallOfFame.primaryGradeKey, 'all');
    ctx.store.resetStats();
    const selected = await request(ctx, 'cumulative', '3-2');
    assert.equal(rows(selected).length, 1);
    assert.equal(rows(selected)[0].uid, publicId(scope, 'student-1'));
    const query = ctx.store.queries.find(item => item.collection === 'semester_wis_accounts');
    assert(query.filters.some(item => item.field === 'grade' && item.value === '3'));
    assert(query.filters.some(item => item.field === 'classNumber' && item.value === '2'));
    assert(selected.rankingClasses.some(item => item.key === '2-7'));
  });
  await check('student class choices stay inside the current grade and reject forged selection', async () => {
    const ctx = prepare(); move(ctx, 'student-0', '2', '7'); move(ctx, 'student-1', '3', '2');
    const args = { uid: 'student-79', audience: 'student' };
    const all = await request(ctx, 'current', '', args);
    assert(all.rankingClasses.every(item => item.grade === '3'));
    assert(rows(all).every(item => item.grade === '3'));
    const selected = await request(ctx, 'current', '3-2', args);
    assert.equal(rows(selected)[0].uid, publicId(scope, 'student-1'));
    await assert.rejects(request(ctx, 'current', '2-7', args), error => error.code === 'permission-denied');
  });
  await check('malformed student placement fails closed before any ranking or class directory query', async () => {
    const requests = [
      { projection: 'ranking-preview', rankingMetric: 'current' },
      { projection: 'ranking-preview', rankingMetric: 'cumulative' },
      { projection: 'hall-of-fame', rankingMetric: 'cumulative' },
      { projection: 'hall-view', rankingMetric: 'cumulative', hallView: 'grade' },
      { projection: 'hall-view', rankingMetric: 'cumulative', hallView: 'class', hallClassKey: '2-7' },
      { projection: 'ranking-preview' },
      { projection: 'hall-index' },
      { projection: 'hall-view', hallView: 'class' },
    ];
    for (const field of ['grade', 'classNumber']) for (const value of ['', ' ', null, undefined, 'invalid', '3-1', '0', '00', '01', '1000', '1.5', '-1']) {
      const ctx = prepare(8);
      move(ctx, 'student-0', '2', '7');
      // Corrupt both canonical sources; the account's cached placement must not
      // authorize a broader query when current enrollment placement is missing.
      const actor = ctx.store.docs.get(accountPath(scope, 'student-7'));
      const classId = 'malformed-actor-class';
      const placement = { grade: '3', classNumber: '1', [field]: value };
      ctx.store.set(`semester_classes/${classId}`, { semesterId: scope, classId, status: 'ACTIVE', ...placement });
      ctx.store.patch(`semester_enrollments/${actor.enrollmentId}`, { classId, snapshot: placement });
      for (const data of requests) {
        ctx.store.resetStats();
        const state = await ctx.request({ uid: 'student-7', audience: 'student', ...data });
        assert.equal(state.status, 'EMPTY');
        assert.equal(state.reason, 'WIS_ACTIVE_ENROLLMENT_REQUIRED');
        assert.equal(state.hallOfFame, null);
        assert.equal(ctx.store.queries.length, 0);
        assert.equal(ctx.store.reads.some(path => path.startsWith('users/') && path !== 'users/student-7'), false);
        assert.equal(ctx.store.writes, 0);
      }
    }
  });
  await check('ties use competition ranks and stable identity order for each metric', async () => {
    const ctx = prepare(); update(ctx, 'student-0', { balance: 1000 }); update(ctx, 'student-1', { balance: 1000 });
    const result = rows(await request(ctx, 'current'));
    assert.deepEqual(result.map(item => item.rank), [1, 1, 3, 4, 5]);
    assert.deepEqual(result.slice(0, 2).map(item => item.uid),
      ['student-0', 'student-1'].sort((a, b) => accountPath(scope, a).localeCompare(accountPath(scope, b)))
        .map(uid => publicId(scope, uid)));
  });
  await check('fresh balance decreases immediately reorder one bounded canonical page despite stale projections', async () => {
    const ctx = prepare();
    for (let i = 0; i < 20; i++) update(ctx, `student-${i}`, { balance: 0 }, false);
    ctx.store.resetStats();
    const result = rows(await request(ctx, 'current'));
    assert.equal(result[0].uid, publicId(scope, 'student-20'));
    const pages = ctx.store.queries.filter(item => item.collection === 'semester_wis_accounts');
    assert.equal(pages.length, 1);
    assert(pages.every(item => item.limit === 5));
    assert.equal(ctx.store.queries.some(item => /preview_entries|ledger|rankings/.test(item.collection)), false);
    assert(pages.every(item => item.fieldMask.includes('balance') && !item.fieldMask.includes('recentLedgerEntries')));
  });
  await check('cold normal request reads one class directory and only five account candidates without rereading accounts', async () => {
    const ctx = prepare(200); ctx.store.resetStats();
    await request(ctx, 'current');
    assert.equal(ctx.store.queries.length, 2);
    assert.equal(ctx.store.queries.find(item => item.collection === 'semester_wis_accounts').returned, 5);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('semester_wis_accounts/')).length, 0);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/student-')).length, 5);
    assert.equal(ctx.store.writes, 0);
  });
  await check('withdrawn candidates, foreign semester entries and malformed balances cannot enter current ranking', async () => {
    const ctx = prepare();
    const top = ctx.store.docs.get(accountPath(scope, 'student-0'));
    ctx.store.patch(`semester_enrollments/${top.enrollmentId}`, { enrollmentStatus: 'WITHDRAWN' });
    update(ctx, 'student-1', { balance: Number.MAX_SAFE_INTEGER + 1 });
    update(ctx, 'student-2', { semesterId: '2026-1' }, false);
    const result = rows(await request(ctx, 'current'));
    for (let i = 0; i < 3; i++) assert(result.every(item => item.uid !== publicId(scope, `student-${i}`)));
  });
  await check('current ranking excludes malformed total-earned amounts and backfills valid candidates', async () => {
    const ctx = prepare(30);
    const invalid = [undefined, null, '1000', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
    invalid.forEach((earnedTotal, index) => update(ctx, `student-${index}`, { earnedTotal }, false));
    ctx.store.resetStats();
    const result = rows(await request(ctx, 'current'));
    assert.deepEqual(result.map(item => item.uid), Array.from({ length: 5 }, (_, index) => publicId(scope, `student-${invalid.length + index}`)));
    assert(result.every(item => Number.isSafeInteger(item.cumulativeEarned) && item.cumulativeEarned >= 0));
    assert.equal(ctx.store.queries.filter(item => item.collection === 'semester_wis_accounts').length, 3);
    assert.equal(ctx.store.reads.filter(path => path.startsWith('users/student-')).length, 5);
    assert.equal(ctx.store.writes, 0);
  });
  await check('failure can be explicitly retried and revoked permissions are checked each time', async () => {
    const ctx = prepare();
    const originalQuery = ctx.store.query.bind(ctx.store); let failNext = true;
    ctx.store.query = (collection, query) => {
      if (collection === 'semester_wis_accounts' && failNext) { failNext = false; throw new Error('synthetic account query failure'); }
      return originalQuery(collection, query);
    };
    await assert.rejects(request(ctx, 'current'));
    assert.equal(rows(await request(ctx, 'current')).length, 5);
    ctx.store.patch('users/teacher', { staffPermissions: [] });
    await assert.rejects(request(ctx, 'current'), error => error.code === 'permission-denied');
    assert.equal(ctx.store.writes, 0);
  });
  await check('invalid mode and unrelated projection selectors fail before reading data', async () => {
    const ctx = prepare();
    await assert.rejects(request(ctx, 'balance'), error => error.code === 'invalid-argument');
    await assert.rejects(request(ctx, 'current', '3/1'), error => error.code === 'invalid-argument');
    await assert.rejects(ctx.request({ projection: 'student-core', rankingMetric: 'current' }), error => error.code === 'invalid-argument');
  });
  await check('archive selectors retain stored account placement without new index or active slot dependencies', async () => {
    const ctx = prepare();
    ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (const path of [...ctx.store.docs.keys()])
      if (/^semester_(wis_preview_entries|enrollment_slots|classes)\//.test(path)) ctx.store.docs.delete(path);
    update(ctx, 'student-0', { balance: 1 }, false);
    const result = await request(ctx, 'current', '3-1', { source: 'EXPLICIT' });
    assert.equal(result.readOnly, true);
    assert.equal(rows(result)[0].uid, publicId(scope, 'student-1'));
    assert.equal(rows(result)[0].cumulativeEarned, 999);
    assert.equal(result.rankingClasses[0].key, '3-1');
  });
  await check('configured positive-score ties fill the fifth preview position but never expand zero ties', async () => {
    const ctx = prepare();
    ctx.store.set('site_settings/interface_config', { hallOfFame: { publicRange: {
      gradeRankLimit: 4, classRankLimit: 4, includeTies: true,
    } } });
    for (let i = 0; i < 80; i++) update(ctx, `student-${i}`, { balance: 20 });
    assert.equal(rows(await request(ctx, 'current')).length, 5);
    for (let i = 0; i < 80; i++) update(ctx, `student-${i}`, { balance: 0 });
    assert.equal(rows(await request(ctx, 'current')).length, 4);
  });
  await check('a newly increased score below the old index page becomes first immediately for both metrics', async () => {
    for (const metric of ['current', 'cumulative']) {
      const ctx = prepare(80);
      update(ctx, 'student-79', metric === 'current' ? { balance: 2000 } : { rankEarnedTotal: 2000 }, false);
      ctx.store.resetStats();
      const result = await request(ctx, metric);
      assert.equal(rows(result)[0].uid, publicId(scope, 'student-79'));
      assert.equal(rows(result)[0].rank, 1);
      assert.equal(ctx.store.queries.filter(item => item.collection === 'semester_wis_accounts').length, 1);
      assert.equal(ctx.store.queries.some(item => /preview_entries|rankings/.test(item.collection)), false);
    }
  });
  await check('missing or arbitrarily stale preview indexes never affect current selectable rankings', async () => {
    const ctx = prepare();
    for (const path of [...ctx.store.docs.keys()])
      if (/^semester_wis_(preview_entries|rankings)\//.test(path)) ctx.store.docs.delete(path);
    const result = await request(ctx, 'current');
    assert.equal(rows(result)[0].uid, publicId(scope, 'student-0'));
    assert.equal(rows(result).length, 5);
    assert.equal(ctx.store.writes, 0);
  });
  await check('withdrawn leaders continue through canonical cursor pages to the first five eligible students', async () => {
    const ctx = prepare();
    for (let i = 0; i < 20; i++) {
      const account = ctx.store.docs.get(accountPath(scope, `student-${i}`));
      ctx.store.patch(`semester_enrollments/${account.enrollmentId}`, { enrollmentStatus: 'WITHDRAWN' });
    }
    ctx.store.resetStats();
    const result = await request(ctx, 'current');
    assert.equal(rows(result)[0].uid, publicId(scope, 'student-20'));
    const pages = ctx.store.queries.filter(item => item.collection === 'semester_wis_accounts');
    assert.equal(pages.length, 5);
    assert.equal(pages[1].startAfterPath, pages[0].returnedPaths.at(-1));
    assert.equal(rows(result).length, 5);
  });
  await check('total earned includes initial grants while spending and grade eligibility stay independent', async () => {
    const ctx = prepare();
    update(ctx, 'student-0', { earnedTotal: 8100, rankEarnedTotal: 7600, balance: 7910 });
    update(ctx, 'student-1', { earnedTotal: 8000, rankEarnedTotal: 8000, balance: 7800 });
    const result = rows(await request(ctx));
    assert.equal(result[0].uid, publicId(scope, 'student-0'));
    assert.equal(result[0].cumulativeEarned, 8100);
    assert.equal(result[0].rankEarnedTotal, 7600);
    assert.equal(result[0].currentBalance, 7910);
    const page = ctx.store.queries.find(item => item.collection === 'semester_wis_accounts');
    assert.equal(page.orderBy[0].field, 'earnedTotal');
    assert.equal(ctx.store.writes, 0);
  });
  await check('opt-in hall views use the same total-earned order and retain public rank limits', async () => {
    const ctx = prepare(80);
    update(ctx, 'student-0', { earnedTotal: 8100, rankEarnedTotal: 7600, balance: 7910 });
    update(ctx, 'student-1', { earnedTotal: 8000, rankEarnedTotal: 8000, balance: 7800 });
    for (const view of ['grade', 'class']) {
      ctx.store.resetStats();
      const state = await request(ctx, 'cumulative', '', { projection: 'hall-view', hallView: view,
        hallGradeKey: '3', hallClassKey: '3-1' });
      const groups = view === 'grade' ? state.hallOfFame.gradeLeaderboardByGrade : state.hallOfFame.classLeaderboardByClassKey;
      const entries = Object.values(groups).flat();
      assert.equal(entries[0].cumulativeEarned, 8100);
      assert.equal(entries[0].rankEarnedTotal, 7600);
      assert.equal(entries[0].podiumSlot, 1);
      assert.equal(entries.length, 10);
      assert(ctx.store.queries.filter(item => item.collection === 'semester_wis_accounts').every(item => item.limit === 20));
      assert.equal(ctx.store.queries.some(item => /preview_entries|rankings|ledger/.test(item.collection)), false);
    }
  });
  await check('total-earned hall ignores stale preview indexes and keeps student class boundaries', async () => {
    const ctx = prepare(); move(ctx, 'student-0', '2', '7'); move(ctx, 'student-1', '3', '2');
    const state = await request(ctx, 'cumulative', '', { uid: 'student-79', audience: 'student', projection: 'hall-of-fame' });
    assert.deepEqual(Object.keys(state.hallOfFame.gradeLeaderboardByGrade), ['3']);
    assert.deepEqual(Object.keys(state.hallOfFame.classLeaderboardByClassKey), ['3-1']);
    const selected = await request(ctx, 'cumulative', '', { uid: 'student-79', audience: 'student', projection: 'hall-view',
      hallView: 'class', hallClassKey: '2-7' });
    assert(Object.values(selected.hallOfFame.classLeaderboardByClassKey).flat().every(entry => entry.classKey === '3-1'));
    assert.equal(ctx.store.writes, 0);
  });
  await check('total-earned hall preserves empty groups, zero fillers, ties, and historical placement', async () => {
    const ctx = prepare(40);
    for (let i = 0; i < 40; i++) update(ctx, `student-${i}`, { earnedTotal: 2000 });
    const tied = await request(ctx, 'cumulative', '', { projection: 'hall-view', hallView: 'grade', hallGradeKey: '3' });
    assert.equal(rows(tied).length, 20); assert(rows(tied).every(entry => entry.rank === 1));
    for (let i = 0; i < 40; i++) update(ctx, `student-${i}`, { earnedTotal: 0 });
    assert.equal(rows(await request(ctx, 'cumulative', '', { projection: 'hall-view', hallView: 'grade', hallGradeKey: '3' })).length, 5);
    ctx.store.patch('semester_manifests/2026-2', { status: 'ARCHIVED' });
    for (const path of [...ctx.store.docs.keys()]) if (/^semester_(classes|enrollment_slots|wis_rankings|wis_preview_entries)\//.test(path)) ctx.store.docs.delete(path);
    update(ctx, 'student-0', { earnedTotal: 8100, rankEarnedTotal: 7600, balance: 7910 });
    const historical = await request(ctx, 'cumulative', '', { source: 'EXPLICIT', projection: 'hall-view', hallView: 'grade', hallGradeKey: '3' });
    assert.equal(rows(historical)[0].cumulativeEarned, 8100); assert.equal(historical.readOnly, true);
  });
  console.log(JSON.stringify({ passed: true, cases: checks.length, checks, writes: 0, network: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
