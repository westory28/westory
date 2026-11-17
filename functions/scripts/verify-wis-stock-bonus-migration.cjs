const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planWisStockBonusMigration } = require('../wisStockBonusMigration');
const { CAMPAIGN_ID } = require('../wisStockDepositCampaign');
const stockId = `stock_${'a'.repeat(24)}`;
const binding = { accountId: 'account_fixture', semesterId: '2026-2', studentUid: 'fixture_student' };
const record = (sequence, kind, stockCashDelta, extra = {}) => ({ ...binding,
  sequence, kind, stockCashDelta, atMs: 1000 + sequence, ...extra });
function fixture() {
  const account = { ...binding, schemaVersion: 1, revision: 3, stockCash: 1100,
    outstandingPrincipal: 1500, eventBonusTotal: 500, reservedCash: 0, reservedBuyFees: 0,
    pendingOrders: {}, positions: { [stockId]: { quantity: 4, costBasis: 400 } } };
  const history = [record(1, 'DEPOSIT', 1000, { amount: 1000 }),
    record(2, 'ORDER_FILLED', -400), record(3, 'EVENT_BONUS', 500, { campaignId: CAMPAIGN_ID, amount: 500 })];
  const campaignReceipt = { ...binding, campaignId: CAMPAIGN_ID, amount: 500, status: 'APPLIED', appliedAtMs: 1003 };
  return { account, history, campaignReceipt, atMs: 2000 };
}
function withdraw(input, amount) {
  const principalReturned = Math.min(amount, input.account.outstandingPrincipal);
  input.account.stockCash -= amount; input.account.outstandingPrincipal -= principalReturned;
  input.account.revision++;
  input.history.push(record(input.account.revision, 'WITHDRAW', -amount, { amount, principalReturned }));
}
test('existing holdings remain personal; cash/positions/old ledger unchanged', () => {
  const input = fixture(), before = structuredClone(input), result = planWisStockBonusMigration(input);
  assert.equal(result.next.eventBonusRestrictedCash, 500);
  assert.equal(result.next.outstandingPrincipal, 1000);
  assert.equal(result.next.eventBonusLegacyWithdrawn, 0);
  assert.equal(result.next.schemaVersion, 2);
  assert.deepEqual(result.next.positions, before.account.positions);
  assert.equal(result.next.stockCash, before.account.stockCash);
  assert.deepEqual(input, before);
  for (const key of ['stockCashDelta', 'mainCashDelta', 'earnedDelta', 'rankEarnedDelta']) assert.equal(result.receipt[key], 0);
});
test('prior personal-only withdrawal does not consume bonus', () => {
  const input = fixture(); withdraw(input, 600);
  const { next } = planWisStockBonusMigration(input);
  assert.equal(next.eventBonusRestrictedCash, 500); assert.equal(next.outstandingPrincipal, 400);
});
test('partial historical bonus withdrawal preserves unreturned personal deposits', () => {
  const input = fixture(); withdraw(input, 1000);
  const { next } = planWisStockBonusMigration(input);
  assert.equal(next.stockCash, 100); assert.equal(next.eventBonusRestrictedCash, 100);
  assert.equal(next.eventBonusLegacyWithdrawn, 400); assert.equal(next.outstandingPrincipal, 400);
});
test('full historical bonus withdrawal does not confiscate main wallet or personal holdings', () => {
  const input = fixture(); withdraw(input, 1100);
  const { next } = planWisStockBonusMigration(input);
  assert.equal(next.eventBonusRestrictedCash, 0); assert.equal(next.eventBonusLegacyWithdrawn, 500);
  assert.equal(next.outstandingPrincipal, 400); assert.equal(next.stockCash, 0);
});
test('repeated withdrawal and later own deposit remain distinct', () => {
  const input = fixture(); withdraw(input, 700);
  input.account.revision++; input.account.stockCash += 500; input.account.outstandingPrincipal += 500;
  input.history.push(record(input.account.revision, 'DEPOSIT', 500, { amount: 500 })); withdraw(input, 550);
  const { next } = planWisStockBonusMigration(input);
  assert.equal(next.eventBonusRestrictedCash, 350); assert.equal(next.eventBonusLegacyWithdrawn, 150);
  assert.equal(next.outstandingPrincipal, 400);
});
test('old personal loss cannot be financed by converting bonus principal', () => {
  const input = fixture(); input.history[1].stockCashDelta = -1000; input.account.stockCash = 500;
  input.account.positions[stockId] = { quantity: 0, costBasis: 0 }; withdraw(input, 500);
  const { next } = planWisStockBonusMigration(input);
  assert.equal(next.outstandingPrincipal, 1000); assert.equal(next.eventBonusLegacyWithdrawn, 500);
});
test('repeat after conversion is a no-write no-op', () => {
  const input = fixture(), first = planWisStockBonusMigration(input);
  const second = planWisStockBonusMigration({ ...input, account: first.next });
  assert.equal(second.changed, false); assert.strictEqual(second.next, first.next);
});
test('plan digest is stable across time and query order, but changes with transaction state', () => {
  const input = fixture(), first = planWisStockBonusMigration(input);
  assert.equal(first.digest, planWisStockBonusMigration({ ...input, atMs: 3000, history: [...input.history].reverse() }).digest);
  withdraw(input, 100); assert.notEqual(first.digest, planWisStockBonusMigration(input).digest);
});
for (const [name, mutate] of [
  ['missing ledger rows', input => input.history.shift()],
  ['cash mismatch', input => input.account.stockCash++],
  ['principal mismatch', input => input.account.outstandingPrincipal++],
  ['wrong account history', input => input.history[0].accountId = 'another'],
  ['wrong student history', input => input.history[0].studentUid = 'another'],
  ['wrong semester history', input => input.history[0].semesterId = '2025-2'],
  ['wrong campaign receipt', input => input.campaignReceipt.campaignId = 'another'],
  ['duplicate sequence', input => input.history.push(input.history[0])],
  ['pending order', input => input.account.pendingOrders.order = {}],
  ['post-reward trade', input => { input.account.revision++; input.history.push(record(4, 'ORDER_FILLED', 0)); }],
  ['unknown cash operation', input => { input.account.revision++; input.history.push(record(4, 'OTHER', 0)); }],
  ['wrong recorded principal return', input => { withdraw(input, 100); input.history.at(-1).principalReturned = 99; }],
  ['unsafe revision', input => input.account.revision = Number.MAX_SAFE_INTEGER],
]) test(`fails closed: ${name}`, () => { const input = fixture(); mutate(input); assert.throws(() => planWisStockBonusMigration(input)); });
