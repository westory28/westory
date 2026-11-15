const assert = require('node:assert/strict');
const { reconcile } = require('./audit-wis-wallets.cjs');
const identity = { accountId: 'account', semesterId: '2026-2', studentUid: 'student' };
const entries = [
  { ledgerEntryId: 'initial', type: 'INITIAL_GRANT', delta: 500, balanceBefore: 0, balanceAfter: 500 },
  { ledgerEntryId: 'game-cost', type: 'DEDUCT', activityType: 'weplay_cost', delta: -10, balanceBefore: 500, balanceAfter: 490 },
  { ledgerEntryId: 'game-reward', type: 'GRANT', activityType: 'weplay_reward', delta: 20, balanceBefore: 490, balanceAfter: 510 },
].map(entry => ({ ...identity, ...entry }));
const totals = { earnedTotal: 520, rankEarnedTotal: 20, spentTotal: 0, adjustedTotal: 10 };
const account = { ...identity, ...totals, balance: 510, revision: 4, recentLedgerEntries: [...entries].reverse() };
const projection = { ...identity, ...totals, balance: 510, ledgerRevision: 4 };
assert.deepEqual(reconcile(account, entries, projection, projection), []);
assert.ok(reconcile({ ...account, balance: 520 }, entries, projection, projection).includes('ledger_balance_mismatch'));
assert.ok(reconcile(account, [entries[0], entries[2]], projection, projection).includes('ledger_balance_mismatch'));
assert.ok(reconcile(account, [...entries, entries[2]], projection, projection).includes('duplicate_ledger_id'));
assert.ok(reconcile(account, entries, { ...projection, ledgerRevision: 3 }, projection).includes('balance_projection_mismatch'));
assert.ok(reconcile({ ...account, recentLedgerEntries: [] }, entries, projection, projection).includes('recent_cache_incomplete'));
assert.ok(reconcile(account, entries.map(row => ({ ...row, balanceAfter: row.balanceAfter + 1 })), projection, projection).includes('invalid_ledger_amount'));
assert.ok(reconcile(account, entries.map(row => ({ ...row, studentUid: 'other' })), projection, projection).includes('ledger_scope_mismatch'));
assert.ok(reconcile(account, entries, projection, { ...projection, rankEarnedTotal: 510 }).includes('ranking_projection_totals_mismatch'));
assert.ok(reconcile({ ...account, rankEarnedTotal: 510 }, entries, projection, projection).includes('ledger_rankEarnedTotal_mismatch'));
assert.ok(reconcile(account, entries, { ...projection, spentTotal: 5 }, projection).includes('balance_projection_totals_mismatch'));
assert.ok(reconcile(account, entries.map(row => row.ledgerEntryId === 'game-cost'
  ? { ...row, balanceBefore: 700, balanceAfter: 690 } : row), projection, projection).includes('ledger_balance_chain_mismatch'));
const cycle = [
  { ...identity, ledgerEntryId: 'cycle-credit', type: 'GRANT', delta: 10, balanceBefore: 999, balanceAfter: 1009 },
  { ...identity, ledgerEntryId: 'cycle-debit', type: 'DEDUCT', delta: -10, balanceBefore: 1009, balanceAfter: 999 },
];
assert.ok(reconcile(account, [...entries, ...cycle], projection, projection).includes('ledger_balance_chain_mismatch'));
// Input order cannot invalidate valid multi-post or refund trails.
assert.deepEqual(reconcile(account, [entries[2], entries[0], entries[1]], projection, projection), []);
const overflow = entries.map(row => row.ledgerEntryId === 'game-reward'
  ? { ...row, delta: Number.MAX_SAFE_INTEGER, balanceAfter: Number.MAX_SAFE_INTEGER + 490 } : row);
assert.ok(reconcile(account, overflow, projection, projection).includes('invalid_ledger_amount'));
assert.ok(reconcile(account, [...entries, { ...identity, ledgerEntryId: 'orphan-reversal', type: 'REVERSAL',
  sourceId: 'missing', delta: -20, reversedDelta: 20, reversedType: 'GRANT', balanceBefore: 510, balanceAfter: 490 }],
projection, projection).includes('invalid_ledger_reversal'));
console.log('PASS read-only wallet audit: signed costs/rewards, complete balance trails, cumulative totals, account scope, projections and cache integrity');

// Moving principal between separate accounts cannot create cumulative Wis.
const stockEntries = [
  { ledgerEntryId: 'stock-opening', type: 'INITIAL_GRANT', delta: 1000, balanceBefore: 0, balanceAfter: 1000 },
  { ledgerEntryId: 'stock-out', type: 'STOCK_TRANSFER_OUT', delta: -500, balanceBefore: 1000, balanceAfter: 500,
    stockTransferId: 'deposit_1', sourceId: 'wis_stock_transfer:deposit_1', principalReturned: 0, withdrawnProfit: 0 },
  { ledgerEntryId: 'stock-in', type: 'STOCK_TRANSFER_IN', delta: 600, balanceBefore: 500, balanceAfter: 1100,
    stockTransferId: 'withdrawal_1', sourceId: 'wis_stock_transfer:withdrawal_1', principalReturned: 500, withdrawnProfit: 100 },
].map(entry => ({ ...identity, ...entry }));
const stockTotals = { earnedTotal: 1100, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 100 };
const stockAccount = { ...identity, ...stockTotals, balance: 1100, revision: 3, recentLedgerEntries: [...stockEntries].reverse() };
const stockProjection = { ...identity, ...stockTotals, balance: 1100, ledgerRevision: 3 };
assert.deepEqual(reconcile(stockAccount, stockEntries, stockProjection, stockProjection), []);
assert.ok(reconcile(stockAccount, stockEntries.map(entry => entry.type === 'STOCK_TRANSFER_IN'
  ? { ...entry, withdrawnProfit: 600 } : entry), stockProjection, stockProjection).includes('invalid_stock_transfer'));
assert.ok(reconcile(stockAccount, stockEntries.map(entry => entry.type === 'STOCK_TRANSFER_OUT'
  ? { ...entry, withdrawnProfit: 500 } : entry), stockProjection, stockProjection).includes('invalid_stock_transfer'));
assert.doesNotThrow(() => reconcile(stockAccount, stockEntries.map(entry => entry.type === 'STOCK_TRANSFER_IN'
  ? { ...entry, delta: NaN } : entry), stockProjection, stockProjection));
console.log('PASS stock transfer audit: principal exclusion, withdrawn profit only, zero activity-rank gain and malformed receipt rejection');
