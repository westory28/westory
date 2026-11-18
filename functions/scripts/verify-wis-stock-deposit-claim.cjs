const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CAMPAIGN_ID, THRESHOLD, BONUS, CONFIG_PATH, receiptPath, getDepositBonusStatus, createDepositBonusReceipt } = require('../wisStockDepositCampaign');

function fixture({ amounts = [], extra = [], paid, enabled = true, malformed } = {}) {
  const rows = [...amounts.map((amount, index) => ({ path: `years/2026/semesters/${index % 2 + 1}/wis_stock_history/deposit_${index}`,
    value: { studentUid: 'student', kind: 'DEPOSIT', amount, stockCashDelta: amount, mainCashDelta: -amount, privateUnusedField: 'excluded' } })), ...extra];
  if (malformed) Object.assign(rows[0].value, malformed);
  const calls = { documents: [], queries: [], readCount: 0 };
  const snapshot = value => ({ exists: value !== undefined, data: () => value });
  const db = { doc: path => ({ path }), collectionGroup: name => {
    const query = { name, filters: [], maximum: Infinity, fields: null,
      where(...filter) { this.filters.push(filter); return this; }, limit(value) { this.maximum = value; return this; },
      select(...fields) { this.fields = fields; return this; } }; return query;
  } };
  const tx = { getAll: async (...refs) => {
    calls.documents.push(...refs.map(ref => ref.path)); calls.readCount += refs.length;
    return refs.map(ref => snapshot(ref.path === CONFIG_PATH ? { campaignId: CAMPAIGN_ID, enabled } : paid));
  }, get: async query => {
    calls.queries.push(query);
    const selected = rows.filter(row => query.filters.every(([field, operation, value]) => operation === '==' && row.value[field] === value)).slice(0, query.maximum);
    calls.readCount += Math.max(1, selected.length);
    return { docs: selected.map(row => ({ ref: { path: row.path }, data: () => Object.fromEntries(query.fields.map(field => [field, row.value[field]])) })) };
  } };
  return { calls, read: () => getDepositBonusStatus({ db, tx, uid: 'student' }) };
}

test('the preserved 500 threshold yields capped server eligibility, including split and previous-semester deposits', async () => {
  assert.equal(THRESHOLD, 500); assert.equal(BONUS, 500);
  for (const [amounts, status, amount] of [[[], 'INELIGIBLE', 0], [[100], 'INELIGIBLE', 100], [[499], 'INELIGIBLE', 499],
    [[500], 'ELIGIBLE', 500], [[249, 251], 'ELIGIBLE', 500], [[1000], 'ELIGIBLE', 500]]) {
    const { read, calls } = fixture({ amounts });
    assert.deepEqual(await read(), { campaignId: CAMPAIGN_ID, threshold: 500, amount: 500, status, qualifyingDepositAmount: amount });
    assert.equal(calls.readCount, 2 + Math.max(1, amounts.length));
    assert.deepEqual(calls.documents, [CONFIG_PATH, receiptPath('student')]);
  }
});
test('bounded eligibility reads filter the owner and deposits on the server and project only validation fields', async () => {
  const { read, calls } = fixture({ amounts: Array(501).fill(1), extra: [
    { path: 'years/2026/semesters/2/wis_stock_history/other', value: { studentUid: 'other', kind: 'DEPOSIT', amount: 999999 } },
    { path: 'years/2026/semesters/2/wis_stock_history/withdraw', value: { studentUid: 'student', kind: 'WITHDRAW', amount: 999999 } },
  ] });
  assert.equal((await read()).qualifyingDepositAmount, 500); assert.equal(calls.readCount, 502);
  assert.equal(calls.queries.length, 1);
  const query = calls.queries[0]; assert.equal(query.name, 'wis_stock_history'); assert.equal(query.maximum, 500);
  assert.deepEqual(query.filters, [['studentUid', '==', 'student'], ['kind', '==', 'DEPOSIT']]);
  assert.deepEqual(query.fields, ['studentUid', 'kind', 'amount', 'stockCashDelta', 'mainCashDelta']);
  assert.equal((await fixture({ amounts: [1], extra: [
    { path: 'years/2026/semesters/2/wis_stock_history/other', value: { studentUid: 'other', kind: 'DEPOSIT', amount: 1000 } },
  ] }).read()).qualifyingDepositAmount, 1);
});
test('disabled and already-claimed campaigns skip historical queries, including old automatic receipts', async () => {
  const disabled = fixture({ enabled: false, amounts: [500] });
  assert.equal((await disabled.read()).status, 'DISABLED'); assert.equal(disabled.calls.readCount, 2); assert.equal(disabled.calls.queries.length, 0);
  const old = { campaignId: CAMPAIGN_ID, studentUid: 'student', amount: 500, status: 'APPLIED', semesterId: '2025-2', threshold: 500 };
  for (const enabled of [true, false]) {
    const paid = fixture({ enabled, paid: old });
    assert.equal((await paid.read()).status, 'CLAIMED'); assert.equal(paid.calls.readCount, 2); assert.equal(paid.calls.queries.length, 0);
  }
});
test('malformed receipt and nonpositive or inconsistent deposit evidence fail closed', async () => {
  const reason = error => error.details?.reason === 'WIS_STOCK_CAMPAIGN_INVALID';
  for (const amount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(fixture({ amounts: [amount] }).read(), reason);
  for (const malformed of [{ stockCashDelta: 499 }, { mainCashDelta: -499 }])
    await assert.rejects(fixture({ amounts: [500], malformed }).read(), reason);
  for (const patch of [{ studentUid: 'other' }, { amount: 1000 }, { status: 'PENDING' }, { campaignId: 'other' }])
    await assert.rejects(fixture({ paid: { campaignId: CAMPAIGN_ID, studentUid: 'student', amount: 500, status: 'APPLIED', ...patch } }).read(), reason);
});
test('manual claim receipt retains global campaign identity and restricted principal without general-Wis credit', () => {
  const value = createDepositBonusReceipt({ uid: 'student', account: { accountId: 'own-account', semesterId: '2026-2' }, atMs: 123, requestId: 'claim_request_0001' });
  assert.equal(value.campaignId, CAMPAIGN_ID); assert.equal(value.threshold, 500); assert.equal(value.amount, 500);
  assert.equal(value.requestId, 'claim_request_0001'); assert.equal(value.status, 'APPLIED'); assert.equal(value.appliedAtMs, 123);
  assert.equal(value.outstandingPrincipalDelta, 0); assert.equal(value.eventBonusRestrictedCashDelta, 500);
  assert.equal(value.eventBonusRestrictionVersion, 1); assert.equal(value.eligibility, 'LIFETIME_CUMULATIVE_DEPOSIT_AT_LEAST_500');
});
