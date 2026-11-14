const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeWisStockInvestmentBoardScope: scope, parseWisStockInvestmentBoardSnapshot: parse,
  buildWisStockInvestmentBoard: build, parseWisStockInvestmentBoardSession: session } = require('../wisStockInvestmentBoard');
const all = scope({ year: '2026', semester: '2' });
const classroom = scope({ year: '2026', semester: '2', grade: '3', classNumber: '1' });
const row = (number = 1, patch = {}) => ({ studentKey: `student_${number.toString(16).padStart(24, '0')}`,
  grade: '3', classNumber: '1', studentNumber: String(number), displayName: `합성 학생 ${number}`,
  stockCash: 1000, reservedCash: 400, holdingCount: 2, holdingValue: 700, holdingCostBasis: 800, realizedPnl: 50, ...patch });
const input = () => ({ scope: all, revision: 1, asOfMs: 1794700000000, sourceRevision: 7, priceRevision: 9,
  classes: [{ grade: '3', classNumber: '1' }], rows: [row()] });
const reason = expected => error => error.reason === expected;

test('own-session parser binds identity, protocol and an exact ENFORCE deadline without granting from cache', () => {
  const now = 1794700000000, identity = { uid: 'teacher', authTime: 1794699900 };
  const raw = { ...identity, status: 'active', schemaVersion: 2, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2,
    sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: { toMillis: () => now + 1 } };
  assert.equal(session(raw, identity, now).deadlineAtMs, now + 1);
  assert.throws(() => session(raw, identity, now + 1), reason('WIS_STOCK_BOARD_SESSION_EXPIRED'));
  for (const patch of [{ uid: 'another' }, { authTime: identity.authTime - 1 }, { status: 'closed' },
    { privateField: true }, { sessionRevision: 'bad' }, { generalExpiresAt: now + 1 }, { protocolVersion: 1 }])
    assert.throws(() => session({ ...raw, ...patch }, identity, now), reason('WIS_STOCK_BOARD_SESSION_INVALID'));
  for (const authorityModeAtOpen of ['OBSERVE_ONLY', 'DISABLED'])
    assert.equal(session({ ...raw, authorityModeAtOpen }, identity, now + 2).deadlineAtMs, null);
});

test('absent server data is NOT_READY with unknown totals, never fabricated zero balances or students', () => {
  for (const absent of [null, undefined]) {
    const state = parse(absent, all);
    assert.equal(state.status, 'NOT_READY'); assert.equal(state.totals, null);
    assert.deepEqual(state.rows, []); assert.deepEqual(state.classes, []); assert.equal(state.asOfMs, 0);
  }
  for (const patch of [{ grade: '3' }, { grade: '0', classNumber: '1' }, { grade: '3', classNumber: '01' },
    { semester: '3' }, { semesterId: '2025-2' }, { documentId: 'private' }])
    assert.throws(() => scope({ year: '2026', semester: '2', ...patch }), reason('WIS_STOCK_BOARD_SCOPE_INVALID'));
});
test('complete server snapshot preserves cash reservations and computes assets, cost and PnL once', () => {
  const source = input(), before = structuredClone(source), document = build(source), state = parse(document, all);
  assert.deepEqual(source, before); assert.equal(state.status, 'READY');
  assert.deepEqual(state.totals, { studentCount: 1, stockCash: 1000, reservedCash: 400, holdingValue: 700,
    holdingCostBasis: 800, totalAssets: 1700, realizedPnl: 50, unrealizedPnl: -100 });
  assert.equal(state.rows[0].totalAssets, 1700); assert.equal(state.rows[0].unrealizedPnl, -100);
  assert.equal(Object.hasOwn(document.rows[0], 'totalAssets'), false);
  document.rows[0].displayName = '다른 표시'; assert.equal(source.rows[0].displayName, before.rows[0].displayName);
  const empty = parse(build({ ...input(), rows: [] }), all);
  assert.equal(empty.status, 'READY'); assert.equal(empty.totals.studentCount, 0);
});
test('class feeds cannot include another class, cross semesters, duplicate students or duplicate roster seats', () => {
  const document = build({ ...input(), scope: classroom });
  assert.equal(parse(document, classroom).rows.length, 1);
  assert.throws(() => parse(document, all), reason('WIS_STOCK_BOARD_INVALID'));
  assert.throws(() => parse(document, scope({ year: '2025', semester: '2', grade: '3', classNumber: '1' })), reason('WIS_STOCK_BOARD_INVALID'));
  for (const source of [
    { ...input(), scope: classroom, classes: [{ grade: '3', classNumber: '2' }] },
    { ...input(), classes: [] }, { ...input(), rows: [row(), row(2, { studentKey: row().studentKey })] },
    { ...input(), rows: [row(), row(2, { studentNumber: '1' })] },
    { ...input(), classes: [{ grade: '3', classNumber: '1' }, { grade: '3', classNumber: '1' }] },
  ]) assert.throws(() => build(source), reason('WIS_STOCK_BOARD_INVALID'));
});
test('a canonically valued total loss remains visible while a missing valuation cannot masquerade as zero', () => {
  const document = build({ ...input(), rows: [row(1, { holdingValue: 0, holdingCostBasis: 800 })] });
  const state = parse(document, all);
  assert.equal(state.rows[0].holdingCount, 2); assert.equal(state.totals.holdingValue, 0);
  assert.equal(state.totals.unrealizedPnl, -800); assert.equal(state.totals.totalAssets, 1000);
  const incomplete = row(); delete incomplete.holdingValue;
  assert.throws(() => build({ ...input(), rows: [incomplete] }), reason('WIS_STOCK_BOARD_INVALID'));
  assert.throws(() => parse({ ...document, complete: false }, all), reason('WIS_STOCK_BOARD_INVALID'));
});
test('private fields, partial feeds, unknown source and malformed financial backing fail closed', () => {
  const document = build(input());
  for (const patch of [{ priceSeed: 'private' }, { complete: false }, { source: 'DEMO' }, { revision: 0 },
    { sourceRevision: 0 }, { asOfMs: 0 }, { status: 'NOT_READY' }])
    assert.throws(() => parse({ ...document, ...patch }, all), reason('WIS_STOCK_BOARD_INVALID'));
  for (const patch of [{ email: 'never-return@example.invalid' }, { stockCash: -1 }, { reservedCash: 1001 },
    { holdingCount: 0 }, { holdingCount: 1.5 }, { holdingCostBasis: 0 }, { realizedPnl: Infinity },
    { studentKey: 'raw-auth-uid' }, { displayName: ' 잘못된 이름 ' }, { studentNumber: 1 }])
    assert.throws(() => build({ ...input(), rows: [row(1, patch)] }), reason('WIS_STOCK_BOARD_INVALID'));
});
test('persisted totals must match every complete row and cannot omit or double-count a reservation', () => {
  const document = build({ ...input(), rows: [row(), row(2)] });
  for (const patch of [{ studentCount: 1 }, { totalAssets: 4200 }, { stockCash: '2000' }, { unrealizedPnl: 0 }])
    assert.throws(() => parse({ ...document, totals: { ...document.totals, ...patch } }, all), reason('WIS_STOCK_BOARD_TOTALS_INVALID'));
  assert.throws(() => parse({ ...document, rows: document.rows.slice(0, 1) }, all), reason('WIS_STOCK_BOARD_TOTALS_INVALID'));
});
test('BigInt summation rejects unsafe assets and preserves signed PnL even through large intermediate sums', () => {
  assert.throws(() => build({ ...input(), rows: [row(1, { stockCash: Number.MAX_SAFE_INTEGER })] }), reason('WIS_STOCK_BOARD_UNSAFE_TOTAL'));
  const flat = { stockCash: 0, reservedCash: 0, holdingCount: 0, holdingValue: 0, holdingCostBasis: 0 };
  const source = { ...input(), rows: [row(1, { ...flat, realizedPnl: Number.MAX_SAFE_INTEGER }),
    row(2, { ...flat, realizedPnl: Number.MAX_SAFE_INTEGER }), row(3, { ...flat, realizedPnl: -Number.MAX_SAFE_INTEGER })] };
  assert.equal(parse(build(source), all).totals.realizedPnl, Number.MAX_SAFE_INTEGER);
  assert.throws(() => build({ ...source, rows: source.rows.slice(0, 2) }), reason('WIS_STOCK_BOARD_UNSAFE_TOTAL'));
});
test('oversized complete data fails with a capacity error rather than clipping students', () => {
  const source = input(); source.rows = []; source.classes = [];
  for (let classNumber = 1; classNumber <= 30; classNumber++) {
    source.classes.push({ grade: '3', classNumber: String(classNumber) });
    for (let number = 1; number <= 99; number++) source.rows.push(row(classNumber * 100 + number,
      { classNumber: String(classNumber), studentNumber: String(number), displayName: '가'.repeat(80) }));
  }
  const count = source.rows.length;
  assert.throws(() => build(source), reason('WIS_STOCK_BOARD_CAPACITY'));
  assert.equal(source.rows.length, count);
});
