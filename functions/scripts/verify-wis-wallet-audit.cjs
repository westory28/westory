const assert = require('node:assert/strict');
const { reconcile } = require('./audit-wis-wallets.cjs');
const entries = [
  { ledgerEntryId: 'initial', delta: 500, balanceBefore: 0, balanceAfter: 500 },
  { ledgerEntryId: 'game-cost', delta: -10, balanceBefore: 500, balanceAfter: 490 },
  { ledgerEntryId: 'game-reward', delta: 20, balanceBefore: 490, balanceAfter: 510 },
];
const account = { balance: 510, revision: 4, recentLedgerEntries: [...entries].reverse() };
const projection = { balance: 510, ledgerRevision: 4 };
assert.deepEqual(reconcile(account, entries, projection, projection), []);
assert.ok(reconcile({ ...account, balance: 520 }, entries, projection, projection).includes('ledger_balance_mismatch'));
assert.ok(reconcile(account, [entries[0], entries[2]], projection, projection).includes('ledger_balance_mismatch'));
assert.ok(reconcile(account, [...entries, entries[2]], projection, projection).includes('duplicate_ledger_id'));
assert.ok(reconcile(account, entries, { ...projection, ledgerRevision: 3 }, projection).includes('balance_projection_mismatch'));
assert.ok(reconcile({ ...account, recentLedgerEntries: [] }, entries, projection, projection).includes('recent_cache_incomplete'));
assert.ok(reconcile(account, entries.map(row => ({ ...row, balanceAfter: row.balanceAfter + 1 })), projection, projection).includes('invalid_ledger_amount'));
console.log('PASS read-only wallet audit: signed costs/rewards, missing/duplicate ledger, invalid arithmetic, stale projections and incomplete caches');
