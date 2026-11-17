const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { accountIdFor } = require('../studentWisWallet');
const { normalizeWisStockInvestmentBoardScope, buildWisStockInvestmentBoard } = require('../wisStockInvestmentBoard');
// Only the unchanged market decoder is stubbed. Scope, session, permission,
// account binding and actual history reconstruction execute their real code.
const marketModule = require('../wisStocks');
const originalReadMarket = marketModule.readMarket;
let marketDecodes = 0;
marketModule.readMarket = snapshot => { marketDecodes++; return snapshot.data(); };
const { createWisStockInvestmentHistory } = require('../wisStockInvestmentHistory');
marketModule.readMarket = originalReadMarket;
const root = 'years/2026/semesters/2', semesterId = '2026-2', atMs = 10000;
const stockId = 'stock_' + 'a'.repeat(24), sessionRevision = 'a'.repeat(64);
const keys = [], accounts = [], fills = [], rows = [];
for (let i = 1; i <= 6; i++) {
  const studentUid = 'fixture_student_' + i, studentKey = 'student_' + createHash('sha256').update(studentUid).digest('hex').slice(0, 24);
  const accountId = accountIdFor(semesterId, studentUid); keys.push(studentKey);
  accounts.push({ id: accountId, schemaVersion: 1, semesterId, studentUid, studentKey, accountId,
    grade: '3', classNumber: '1', revision: 2, positions: { [stockId]: { quantity: 8, costBasis: 800 } } });
  const common = { semesterId, studentUid, accountId, stockId, kind: 'ORDER_FILLED', fee: 0 };
  fills.push({ ...common, id: 'buy_' + i, sequence: 1, atMs: 1000, side: 'BUY', quantity: 10, unitPrice: 100, stockCashDelta: -1000, realizedPnl: 0 },
    { ...common, id: 'sell_' + i, sequence: 2, atMs: 2000, side: 'SELL', quantity: 2, unitPrice: 110, stockCashDelta: 220, realizedPnl: 20 });
  rows.push({ studentKey, grade: '3', classNumber: '1', studentNumber: String(i), displayName: '검증 학생 ' + i,
    stockCash: 220, reservedCash: 0, holdingCount: 1, holdingValue: 880, holdingCostBasis: 800, realizedPnl: 20 });
}
const scope = normalizeWisStockInvestmentBoardScope({ year: '2026', semester: '2' });
const baseDocuments = {
  'users/teacher': { role: 'teacher' },
  'site_settings/config': { year: '2026', semester: '2' },
  'site_settings/semester_active': { semesterId, revision: 1 },
  'semester_manifests/2026-2': { semesterId, revision: 1, status: 'ACTIVE' },
  [`${root}/wis_stock_investment_boards/all`]: buildWisStockInvestmentBoard({ scope, revision: 1, asOfMs: atMs, sourceRevision: 2, priceRevision: 1,
    classes: [{ grade: '3', classNumber: '1' }], rows }),
  [`${root}/wis_stock_markets/current`]: { revision: 1, stocks: [{ id: stockId, price: 110, history: [{ atMs: 1000, price: 100 }, { atMs: 2000, price: 110 }] }] },
  'application_sessions/teacher/sessions/9': { uid: 'teacher', authTime: 9, status: 'active', schemaVersion: 2, authorityGeneration: 'w1r2-2026-08-09',
    protocolVersion: 2, sessionRevision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: { toMillis: () => atMs + 1000 } },
};
function fixture(patches = {}) {
  const documents = { ...baseDocuments, ...patches }, reads = [], queries = [];
  const snapshot = (data, id) => ({ id, exists: data !== undefined, data: () => data });
  class Query {
    constructor(path) { this.path = path; this.filters = []; }
    where(field, op, value) { assert.equal(op, '=='); this.filters.push([field, value]); return this; }
    select(...fields) { this.fields = fields; return this; }
    limit(limit) { this.cap = limit; return this; }
  }
  const read = async ref => {
    if (typeof ref === 'string') { reads.push(ref); return snapshot(documents[ref], ref.split('/').at(-1)); }
    assert(ref.fields.length > 0, 'projection required');
    const accountQuery = ref.path === `${root}/wis_stock_accounts`;
    assert(accountQuery || ref.path === `${root}/wis_stock_history`, 'only scoped collections');
    assert.deepEqual(ref.filters.map(([key]) => key), accountQuery ? ['studentKey'] : ['accountId', 'kind']);
    assert.equal(ref.cap, accountQuery ? 2 : undefined, 'complete filled history must not be truncated');
    queries.push(ref);
    let matching = (accountQuery ? accounts : fills).filter(row => ref.filters.every(([key, value]) => row[key] === value));
    if (ref.cap) matching = matching.slice(0, ref.cap);
    matching.forEach(row => reads.push(ref.path + '/' + row.id));
    return { size: matching.length, docs: matching.map(row => snapshot(row, row.id)) };
  };
  const db = { doc: path => path, collection: path => new Query(path), runTransaction: async (callback, options) => {
    assert.deepEqual(options, { readOnly: true });
    return callback({ get: read, getAll: (...refs) => Promise.all(refs.map(read)) });
  } };
  return { call: createWisStockInvestmentHistory({ db, now: () => atMs, assertSession: async () => ({ uid: 'teacher' }) }), reads, queries };
}
const request = data => ({ auth: { uid: 'teacher', token: { auth_time: 9, email: 'fixture@example.invalid' } }, data: { year: '2026', semester: '2', _session: { revision: sessionRevision }, ...data } });
async function main() {
  const all = fixture();
  const result = await all.call(request({ studentKeys: keys.slice(0, 5) }));
  assert.equal(result.histories.length, 5); assert.deepEqual(result.histories.map(row => row.studentKey), keys.slice(0, 5));
  assert(result.histories.every(row => row.points.at(-1).holdingValue === 880 && row.points.at(-1).holdingCostBasis === 800));
  assert.equal(all.reads.length, 8 + 5 + 10); assert.equal(all.queries.length, 10); assert.equal(marketDecodes, 1);
  assert(all.queries.every(query => !query.filters.some(([, value]) => value === keys[5] || value === accounts[5].accountId)));
  const single = fixture(), legacy = await single.call(request({ studentKey: keys[0] }));
  assert.equal(legacy.studentKey, keys[0]); assert.equal(legacy.histories, undefined); assert.equal(single.reads.length, 11);
  for (const data of [{ studentKeys: [] }, { studentKeys: keys }, { studentKeys: [keys[0], keys[0]] }, { studentKeys: ['invalid'] },
    { studentKeys: [keys[0]], studentKey: keys[0] }, { studentKeys: 'invalid' }]) {
    const invalid = fixture(); await assert.rejects(invalid.call(request(data)), error => error.code === 'invalid-argument'); assert.equal(invalid.reads.length, 0);
  }
  const missing = fixture(); await assert.rejects(missing.call(request({ studentKeys: ['student_' + 'f'.repeat(24)] })), error => error.code === 'not-found');
  assert.equal(missing.queries.length, 0);
  for (const [path, value, code] of [['users/teacher', { role: 'student' }, 'permission-denied'],
    ['users/teacher', { role: 'teacher', disabled: true }, 'permission-denied'],
    ['site_settings/semester_active', { semesterId: '2027-1', revision: 1 }, 'failed-precondition'],
    ['application_sessions/teacher/sessions/9', { ...baseDocuments['application_sessions/teacher/sessions/9'], sessionRevision: 'b'.repeat(64) }, 'unauthenticated']]) {
    const denied = fixture({ [path]: value }); await assert.rejects(denied.call(request({ studentKeys: [keys[0]] })), error => error.code === code); assert.equal(denied.queries.length, 0);
  }
  console.log(JSON.stringify({ passed: 14, fiveStudentDocumentReads: all.reads.length, fiveStudentQueries: all.queries.length,
    sharedDocumentReads: 8, marketDecodesForBatch: 1, writes: 0, productionReads: 0,
    checks: 'bounded batch, legacy single input, account-scoped complete ledger projections, real reconstruction, immutable read-only transaction, role/session/semester/membership denial' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
