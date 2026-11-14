const assert = require('node:assert/strict');
const { setup, accountPath, previewPath, publicId } = require('./verify-wis-ranking-preview.cjs');
const scope = '2026-2';
const rows = state => Object.values(state.hallOfFame.gradeLeaderboardByGrade).flat();
const prepare = (count = 80) => setup(count);
const update = (ctx, uid, patch, index = true) => {
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
    assert(pages.every(item => item.limit === 20));
    assert.equal(ctx.store.queries.some(item => /preview_entries|ledger|rankings/.test(item.collection)), false);
    assert(pages.every(item => item.fieldMask.includes('balance') && !item.fieldMask.includes('recentLedgerEntries')));
  });
  await check('cold normal request reads one class directory and one 20-account page without rereading accounts', async () => {
    const ctx = prepare(200); ctx.store.resetStats();
    await request(ctx, 'current');
    assert.equal(ctx.store.queries.length, 2);
    assert.equal(ctx.store.queries.find(item => item.collection === 'semester_wis_accounts').returned, 20);
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
    assert.equal(pages.length, 2);
    assert.equal(pages[1].startAfterPath, pages[0].returnedPaths.at(-1));
    assert.equal(rows(result).length, 5);
  });
  console.log(JSON.stringify({ passed: true, cases: checks.length, checks, writes: 0, network: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
