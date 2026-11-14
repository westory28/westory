const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeWisOverviewQuery, queryWisOverviewPage } = require('../wisOverviewQuery');
const scope = '2026-2';
const normalized = value => normalizeWisOverviewQuery(value, 'teacher', 'overview');
const fixture = () => {
  const documents = new Map(Array.from({ length: 75 }, (_, index) => {
    const accountId = `account_${String(index).padStart(3, '0')}`;
    return [`semester_wis_accounts/${accountId}`, { accountId, semesterId: index < 73 ? scope : '2026-1',
      studentUid: `student-${index}`, grade: '3', classNumber: index < 35 ? '1' : '2', studentNumber: String(index % 35 + 1),
      displayName: `${index < 40 ? '가' : '나'}학생${String(index).padStart(3, '0')}`,
      balance: Math.floor(index / 3), rankEarnedTotal: index * 3, spentTotal: index, recentLedgerEntries: [{ secret: true }] }];
  }));
  const reads = [], queries = [];
  const tx = {
    async get(path) { reads.push(path); return { exists: documents.has(path), data: documents.get(path) }; },
    async query(collection, options) {
      queries.push(options);
      let rows = [...documents].filter(([path, value]) => path.startsWith(`${collection}/`) && options.filters.every(filter =>
        filter.operator === '==' ? value[filter.field] === filter.value : filter.operator === '>='
          ? value[filter.field] >= filter.value : value[filter.field] <= filter.value));
      const order = options.orderBy;
      rows.sort(([leftPath, left], [rightPath, right]) => {
        const a = left[order.field], b = right[order.field];
        return (a < b ? -1 : a > b ? 1 : 0) * (order.direction === 'desc' ? -1 : 1) || leftPath.localeCompare(rightPath);
      });
      if (options.startAfterPath) rows = rows.slice(rows.findIndex(([path]) => path === options.startAfterPath) + 1);
      return rows.slice(0, options.limit).map(([path, value]) => ({ path,
        data: Object.fromEntries(options.fieldMask.map(field => [field, value[field]])) }));
    },
  };
  return { tx, reads, queries, documents };
};
test('bounded current-scope pages preserve equal-score ties without duplicate or skipped rows', async () => {
  const f = fixture(), ids = [], overview = normalized({ sortField: 'balance', direction: 'desc' });
  let cursor = '';
  do {
    const page = await queryWisOverviewPage(f.tx, { semesterId: scope, overview, cursor, limit: 20 });
    assert(page.rows.length <= 20); assert(page.rows.every(row => row.semesterId === scope && !('recentLedgerEntries' in row)));
    ids.push(...page.rows.map(row => row.accountId)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 73); assert.equal(new Set(ids).size, 73);
  assert.equal(f.queries.length, 4); assert.equal(f.reads.length, 3);
  assert(f.queries.every(query => query.limit === 21 && query.documentIdOrder === 'asc'));
  assert(f.queries.every(query => query.filters.some(filter => filter.field === 'semesterId' && filter.value === scope)));
});
test('grade/class/number and name prefix are Firestore filters, never a whole-school browser filter', async () => {
  const f = fixture();
  const overview = normalized({ grade: '3', classNumber: '2', studentNumber: '1', namePrefix: '나학생' });
  const page = await queryWisOverviewPage(f.tx, { semesterId: scope, overview, cursor: '', limit: 20 });
  assert.equal(page.rows.length, 1); assert.equal(page.rows[0].accountId, 'account_070');
  assert.deepEqual(f.queries[0].filters.map(filter => [filter.field, filter.operator]), [
    ['semesterId', '=='], ['grade', '=='], ['classNumber', '=='], ['studentNumber', '=='], ['displayName', '>='], ['displayName', '<='],
  ]);
  assert.deepEqual(f.queries[0].orderBy, { field: 'displayName', direction: 'asc' });
  assert.equal(f.reads.length, 0); assert.equal(f.queries.length, 1);
});
test('invalid selectors, foreign cursors and oversized pages fail before the page read', async () => {
  for (const raw of [{ classNumber: '1' }, { studentNumber: '2' }, { grade: '-1' }, { namePrefix: ' name' },
    { direction: 'random' }, { sortField: 'studentUid' }, { unknown: true }]) assert.throws(() => normalized(raw));
  assert.throws(() => normalizeWisOverviewQuery({}, 'student', 'overview'));
  assert.throws(() => normalizeWisOverviewQuery({}, 'teacher', 'account'));
  const f = fixture(), overview = normalized({ grade: '3', classNumber: '1' });
  for (const cursor of ['account_073', 'account_040', 'missing']) {
    await assert.rejects(queryWisOverviewPage(f.tx, { semesterId: scope, overview, cursor, limit: 20 }),
      error => error.details?.reason === 'WIS_QUERY_INVALID');
  }
  await assert.rejects(queryWisOverviewPage(f.tx, { semesterId: scope, overview, cursor: '', limit: 51 }));
  assert.equal(f.queries.length, 0);
});
test('each numeric order and direction is delegated to the server with immutable account-ID tie order', async () => {
  for (const sortField of ['balance', 'rankEarnedTotal', 'spentTotal']) for (const direction of ['asc', 'desc']) {
    const f = fixture();
    const page = await queryWisOverviewPage(f.tx, { semesterId: scope, overview: normalized({ sortField, direction }), cursor: '', limit: 20 });
    assert.equal(page.rows.length, 20);
    assert.deepEqual(f.queries[0].orderBy, { field: sortField, direction });
    assert.equal(f.queries[0].documentIdOrder, 'asc');
    const values = page.rows.map(row => row[sortField]);
    assert(values.every((value, index) => index === 0 || (direction === 'asc' ? value >= values[index - 1] : value <= values[index - 1])));
  }
});

test('a changed balance boundary or economy generation cannot silently skip remaining pupils', async () => {
  const f = fixture(), overview = normalized({ sortField: 'balance' });
  const query = { semesterId: scope, overview, cursor: '', limit: 20, economyRevision: 7 };
  const first = await queryWisOverviewPage(f.tx, query);
  const id = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString())[5];
  f.documents.get(`semester_wis_accounts/${id}`).balance = -100;
  await assert.rejects(queryWisOverviewPage(f.tx, { ...query, cursor: first.nextCursor }),
    error => error.details?.reason === 'WIS_OVERVIEW_PAGE_CHANGED');
  assert.equal(f.queries.length, 1);
  // A different account moving across the boundary also invalidates the generation,
  // with no additional document read beyond the already-loaded economy snapshot.
  const readsBefore = f.reads.length;
  await assert.rejects(queryWisOverviewPage(f.tx, { ...query, cursor: first.nextCursor, economyRevision: 8 }),
    error => error.details?.reason === 'WIS_OVERVIEW_PAGE_CHANGED');
  assert.equal(f.queries.length, 1); assert.equal(f.reads.length, readsBefore);
  assert.equal((await queryWisOverviewPage(f.tx, { ...query, economyRevision: 8 })).rows.length, 20);
});
