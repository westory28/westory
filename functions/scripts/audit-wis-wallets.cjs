// Read-only production reconciliation. Never logs student names or identifiers.
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { resolveCredential } = require('./rebuild-wis-ranking-index.cjs');

const reconcile = (account, entries, balance, ranking) => {
  const issues = [];
  if (!Number.isSafeInteger(account.balance) || account.balance < 0) issues.push('invalid_balance');
  let total = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.delta) || !Number.isSafeInteger(entry.balanceBefore) ||
      !Number.isSafeInteger(entry.balanceAfter) || entry.balanceBefore + entry.delta !== entry.balanceAfter)
      issues.push('invalid_ledger_amount');
    total += entry.delta;
  }
  if (!Number.isSafeInteger(total) || total !== account.balance) issues.push('ledger_balance_mismatch');
  for (const [label, projection] of [['balance', balance], ['ranking', ranking]]) {
    if (!projection || projection.balance !== account.balance || projection.ledgerRevision !== account.revision)
      issues.push(`${label}_projection_mismatch`);
  }
  const ids = new Set(entries.map(entry => entry.ledgerEntryId));
  if (ids.size !== entries.length) issues.push('duplicate_ledger_id');
  if ((account.recentLedgerEntries || []).some(entry => !ids.has(entry.ledgerEntryId)))
    issues.push('recent_entry_missing_from_ledger');
  if (!Array.isArray(account.recentLedgerEntries) ||
    account.recentLedgerEntries.length !== Math.min(100, entries.length))
    issues.push('recent_cache_incomplete');
  const byId = new Map(entries.map(entry => [entry.ledgerEntryId, entry]));
  if ((account.recentLedgerEntries || []).some(entry => byId.get(entry.ledgerEntryId)?.delta !== entry.delta))
    issues.push('recent_cache_amount_mismatch');
  return [...new Set(issues)];
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg.startsWith('--apply'))) throw new Error('This audit is read-only.');
  const projectIndex = args.indexOf('--project');
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : 'history-quiz-yongsin';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId || '')) throw new Error('Invalid project.');
  const app = initializeApp({ projectId, credential: await resolveCredential() }, 'wis-wallet-audit');
  const db = getFirestore(app);
  try {
    const pointer = await db.doc('site_settings/semester_active').get();
    const semesterId = pointer.data()?.semesterId;
    if (!/^\d{4}-[12]$/.test(semesterId || '')) throw new Error('Missing active semester.');
    const accounts = await db.collection('semester_wis_accounts').where('semesterId', '==', semesterId).limit(2001).get();
    if (accounts.size > 2000) throw new Error('Account audit bound exceeded.');
    const summary = { mode: 'read-only', projectId, semesterId, accounts: accounts.size, ledgerEntries: 0,
      accountsBeyondRecentLimit: 0, mismatchedAccounts: 0, issues: {}, activityCounts: {}, writes: 0 };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, accounts.size) }, async () => {
      while (next < accounts.size) {
        const ref = accounts.docs[next++].ref;
        const result = await db.runTransaction(async tx => {
          const [account, balance, ranking] = await tx.getAll(ref,
            db.doc(`semester_wis_balances/${ref.id}`), db.doc(`semester_wis_rankings/${ref.id}`));
          const ledger = await tx.get(db.collection('semester_wis_ledger').where('accountId', '==', ref.id).limit(10001));
          if (ledger.size > 10000) throw new Error('Per-account ledger audit bound exceeded.');
          const entries = ledger.docs.map(doc => doc.data());
          return { entries, issues: reconcile(account.data(), entries, balance.data(), ranking.data()) };
        }, { readOnly: true });
        summary.ledgerEntries += result.entries.length;
        if (result.entries.length > 100) summary.accountsBeyondRecentLimit++;
        if (result.issues.length) summary.mismatchedAccounts++;
        for (const issue of result.issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
        for (const entry of result.entries) {
          const type = String(entry.activityType || entry.type || 'unknown');
          summary.activityCounts[type] = (summary.activityCounts[type] || 0) + 1;
        }
      }
    }));
    console.log(JSON.stringify(summary, null, 2));
    if (summary.mismatchedAccounts) process.exitCode = 2;
  } finally { await deleteApp(app); }
};
module.exports = { reconcile };
if (require.main === module) main().catch(() => {
  console.error('Read-only Wis audit failed; check credentials, active semester and audit bounds. No writes were made.');
  process.exitCode = 1;
});
