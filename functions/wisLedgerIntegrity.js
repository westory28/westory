// Pure validation shared by the read-only audit and explicit projection rebuild.
// No Firestore reads, writes, identity details, or automatic balance repairs.
const LEDGER_TYPES = new Set(['INITIAL_GRANT', 'GRANT', 'DEDUCT', 'ADJUST',
  'REVERSAL', 'ORDER_DEBIT', 'ORDER_REFUND', 'LEGACY_OPENING', 'LEGACY_RECLAIM']);
const inspectWisLedger = (account, entries) => {
  const issues = new Set(), ids = new Set(), degree = new Map(), edges = new Map();
  const byId = new Map(entries.map(entry => [entry?.ledgerEntryId, entry]));
  const reversedIds = new Set();
  const validAmount = value => Number.isSafeInteger(value) && value >= 0;
  const addDegree = (value, delta) => degree.set(value, (degree.get(value) || 0) + delta);
  const connect = (from, to) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };
  let balance = 0;
  if (!validAmount(account?.balance)) issues.add('invalid_balance');
  for (const entry of entries) {
    if (!entry || entry.accountId !== account?.accountId || entry.semesterId !== account?.semesterId
      || entry.studentUid !== account?.studentUid) issues.add('ledger_scope_mismatch');
    if (!entry || typeof entry.ledgerEntryId !== 'string' || !entry.ledgerEntryId
      || ids.has(entry.ledgerEntryId)) issues.add('duplicate_or_invalid_ledger_id');
    ids.add(entry?.ledgerEntryId);
    if (!LEDGER_TYPES.has(entry?.type)) issues.add('invalid_ledger_type');
    if ((['INITIAL_GRANT', 'GRANT', 'ORDER_REFUND'].includes(entry?.type) && !(entry.delta > 0))
      || (['DEDUCT', 'ORDER_DEBIT', 'LEGACY_RECLAIM'].includes(entry?.type) && !(entry.delta < 0))
      || (['ADJUST', 'REVERSAL'].includes(entry?.type) && entry.delta === 0)
      || (entry?.type === 'LEGACY_OPENING' && !(entry.delta >= 0))) issues.add('invalid_ledger_sign');
    if (entry?.type === 'REVERSAL') {
      const original = byId.get(entry.sourceId);
      if (!original || !['GRANT', 'DEDUCT', 'ADJUST'].includes(original.type)
        || entry.delta !== -original.delta || entry.reversedType !== original.type
        || entry.reversedDelta !== original.delta || reversedIds.has(entry.sourceId)) issues.add('invalid_ledger_reversal');
      reversedIds.add(entry.sourceId);
    }
    if (!entry || !Number.isSafeInteger(entry.delta) || !validAmount(entry.balanceBefore)
      || !validAmount(entry.balanceAfter) || !Number.isSafeInteger(entry.balanceBefore + entry.delta)
      || entry.balanceBefore + entry.delta !== entry.balanceAfter) {
      issues.add('invalid_ledger_amount');
    } else {
      addDegree(entry.balanceBefore, 1);
      addDegree(entry.balanceAfter, -1);
      connect(entry.balanceBefore, entry.balanceAfter);
      connect(entry.balanceAfter, entry.balanceBefore);
    }
    balance += entry?.delta;
    if (!Number.isSafeInteger(balance)) issues.add('invalid_ledger_total');
  }
  if (!Number.isSafeInteger(balance) || balance !== account?.balance) issues.add('ledger_balance_mismatch');
  // Same-timestamp posts can arrive in either order. Validate that all immutable
  // entries form one complete balance trail from zero, without relying on IDs or
  // timestamp ordering (refunds can revisit a previous balance).
  if (!issues.has('invalid_ledger_amount') && entries.length) {
    addDegree(0, -1);
    addDegree(balance, 1);
    const visited = new Set([0]), pending = [0];
    while (pending.length) {
      for (const next of edges.get(pending.pop()) || []) {
        if (!visited.has(next)) { visited.add(next); pending.push(next); }
      }
    }
    if ([...degree.values()].some(value => value !== 0)
      || [...edges.keys()].some(value => !visited.has(value))) issues.add('ledger_balance_chain_mismatch');
  }
  return { balance, issues: [...issues] };
};
module.exports = { inspectWisLedger };
