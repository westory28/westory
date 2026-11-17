const { createHash } = require('node:crypto');
const { validateWisStockBonusAccount } = require('./wisStockBonusAccounting');
const { CAMPAIGN_ID, BONUS } = require('./wisStockDepositCampaign');

const POLICY = 'wispi-bonus-restriction-v1';
const int = value => Number.isSafeInteger(value) && value >= 0;
const check = (condition, message) => { if (!condition) throw new Error(`Bonus migration stopped: ${message}`); };
const total = (...values) => {
  const value = values.reduce((sum, item) => sum + BigInt(item), 0n);
  check(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER), 'unsafe or negative total');
  return Number(value);
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Operator-only historical conversion. The old campaign treated the grant as
// withdrawable principal. Replay only the exact target account's complete
// ledger, separating any already-completed grant withdrawal without reversing
// its receipt or changing either cash balance. Post-grant trades require a
// separate reviewed provenance migration and are deliberately rejected.
function planWisStockBonusMigration({ account, campaignReceipt, history, atMs }) {
  check(account && int(account.stockCash) && int(account.outstandingPrincipal)
    && int(account.revision) && int(atMs) && atMs > 0, 'invalid account or time');
  check(campaignReceipt?.campaignId === CAMPAIGN_ID && campaignReceipt.amount === BONUS
    && campaignReceipt.status === 'APPLIED' && campaignReceipt.studentUid === account.studentUid
    && campaignReceipt.accountId === account.accountId && campaignReceipt.semesterId === account.semesterId,
  'campaign/account binding mismatch');
  if (account.eventBonusRestrictionVersion === 1) {
    validateWisStockBonusAccount(account);
    return { changed: false, next: account, digest: digest([POLICY, account.accountId, 'already-migrated']) };
  }
  check(account.schemaVersion === 1 && account.eventBonusTotal === BONUS, 'unexpected legacy schema or reward');
  check(account.pendingOrders && Object.keys(account.pendingOrders).length === 0
    && account.reservedCash === 0 && account.reservedBuyFees === 0, 'pending order must finish or be cancelled first');
  check(Object.values(account.positions || {}).every(position => !position.eventBonusLots), 'unexpected tagged holdings');
  check(Array.isArray(history) && history.length > 0, 'complete account history required');
  const entries = [...history].sort((a, b) => a.sequence - b.sequence);
  let cash = 0, oldPrincipal = 0, ownPrincipal = 0, restricted = 0, legacyWithdrawn = 0, seenBonus = false, sequence = -1;
  for (const entry of entries) {
    check(entry.accountId === account.accountId && entry.semesterId === account.semesterId
      && entry.studentUid === account.studentUid, 'history identity mismatch');
    check(int(entry.sequence) && entry.sequence > sequence && entry.sequence <= account.revision
      && int(entry.atMs) && Number.isSafeInteger(entry.stockCashDelta), 'invalid or duplicate history sequence');
    sequence = entry.sequence;
    if (entry.kind === 'EVENT_BONUS') {
      check(!seenBonus && entry.campaignId === CAMPAIGN_ID && entry.amount === BONUS
        && entry.stockCashDelta === BONUS && entry.atMs === campaignReceipt.appliedAtMs, 'reward history mismatch');
      seenBonus = true; restricted = BONUS; oldPrincipal = total(oldPrincipal, BONUS);
    } else if (entry.kind === 'DEPOSIT') {
      check(int(entry.amount) && entry.amount > 0 && entry.stockCashDelta === entry.amount, 'invalid deposit');
      oldPrincipal = total(oldPrincipal, entry.amount); ownPrincipal = total(ownPrincipal, entry.amount);
    } else if (entry.kind === 'WITHDRAW') {
      check(int(entry.amount) && entry.amount > 0 && entry.stockCashDelta === -entry.amount
        && entry.amount <= cash && entry.principalReturned === Math.min(entry.amount, oldPrincipal), 'invalid withdrawal');
      const consumed = Math.max(0, entry.amount - (cash - restricted));
      check(consumed <= restricted, 'withdrawal exceeds remaining reward');
      restricted -= consumed; legacyWithdrawn = total(legacyWithdrawn, consumed);
      oldPrincipal -= entry.principalReturned;
      // A previously withdrawn gift is not a return of personal deposits.
      ownPrincipal -= Math.min(ownPrincipal, entry.amount - consumed);
    } else {
      check(['ORDER_ACCEPTED', 'ORDER_FILLED', 'ORDER_CANCELLED'].includes(entry.kind), 'unknown history kind');
      check(!(seenBonus && entry.kind === 'ORDER_FILLED'), 'post-reward trade requires provenance reconstruction');
      check(entry.kind === 'ORDER_FILLED' || entry.stockCashDelta === 0, 'non-settlement cash movement');
    }
    cash = total(cash, entry.stockCashDelta);
    check(restricted <= cash, 'reward exceeds available cash');
  }
  check(seenBonus && cash === account.stockCash && oldPrincipal === account.outstandingPrincipal,
    'history does not reconcile with current cash/principal');
  const next = { ...structuredClone(account), schemaVersion: 2,
    eventBonusRestrictionVersion: 1, eventBonusRestrictedCash: restricted, eventBonusReservedCash: 0,
    eventBonusLossCarryforward: 0, eventBonusLegacyWithdrawn: legacyWithdrawn,
    outstandingPrincipal: ownPrincipal, revision: total(account.revision, 1), updatedAtMs: atMs };
  validateWisStockBonusAccount(next);
  const planDigest = digest([POLICY, account.accountId, account.revision, account.stockCash,
    account.outstandingPrincipal, ownPrincipal, restricted, legacyWithdrawn, entries]);
  return { changed: true, next, digest: planDigest, receipt: { schemaVersion: 1, policy: POLICY,
    campaignId: CAMPAIGN_ID, accountId: account.accountId, studentUid: account.studentUid,
    semesterId: account.semesterId, previousRevision: account.revision, revision: next.revision,
    restrictedCash: restricted, legacyBonusWithdrawn: legacyWithdrawn,
    previousOutstandingPrincipal: account.outstandingPrincipal, outstandingPrincipal: ownPrincipal,
    stockCashDelta: 0, mainCashDelta: 0, earnedDelta: 0, rankEarnedDelta: 0,
    historyRows: entries.length, planDigest, status: 'APPLIED', appliedAtMs: atMs } };
}
module.exports = { POLICY, planWisStockBonusMigration };
