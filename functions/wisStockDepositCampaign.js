const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const CAMPAIGN_ID = 'wispi-deposit-500-v1';
const THRESHOLD = 500;
const BONUS = 500;
const CONFIG_PATH = 'site_settings/wis_stock_deposit_campaign';
const receiptPath = uid => `wis_stock_campaign_receipts/${CAMPAIGN_ID}_${createHash('sha256').update(uid).digest('hex')}`;
const invalid = () => { throw new HttpsError('failed-precondition', '위스피 이벤트 지급 기록을 확인해 주세요.', { reason: 'WIS_STOCK_CAMPAIGN_INVALID' }); };

// The identity receipt is global: changing semesters, replaying a transfer, or
// concurrent backfill and deposits cannot pay the same person twice.
async function prepareDepositBonus({ db, tx, uid, account, incomingDeposit = 0, atMs, allowDisabled = false }) {
  const [config, paid] = await tx.getAll(db.doc(CONFIG_PATH), db.doc(receiptPath(uid)));
  if (config.exists && config.data().campaignId !== CAMPAIGN_ID) invalid();
  if ((!config.exists || config.data().enabled !== true) && !allowDisabled) return null;
  if (paid.exists) {
    const value = paid.data();
    if (value.campaignId !== CAMPAIGN_ID || value.studentUid !== uid || value.amount !== BONUS || value.status !== 'APPLIED') invalid();
    return null;
  }
  let provenDeposits = incomingDeposit;
  if (provenDeposits < THRESHOLD) {
    // Every canonical DEPOSIT is an integer >= 1. The first 500 deposits prove
    // eligibility; fewer rows mean the entire matching ledger was read. This
    // bound cannot hide an eligible person and is not a truncated total report.
    const snapshot = await tx.get(db.collectionGroup('wis_stock_history')
      .where('studentUid', '==', uid).where('kind', '==', 'DEPOSIT').limit(THRESHOLD));
    for (const doc of snapshot.docs) {
      const value = doc.data(), parts = doc.ref.path.split('/');
      if (parts.length !== 6 || parts[0] !== 'years' || parts[2] !== 'semesters'
        || value.studentUid !== uid || value.kind !== 'DEPOSIT'
        || !Number.isSafeInteger(value.amount) || value.amount < 1 || value.stockCashDelta !== value.amount
        || value.mainCashDelta !== -value.amount) invalid();
      provenDeposits = Math.min(THRESHOLD, provenDeposits + value.amount);
    }
  }
  if (provenDeposits < THRESHOLD) return null;
  return { schemaVersion: 1, campaignId: CAMPAIGN_ID, studentUid: uid, accountId: account.accountId,
    semesterId: account.semesterId, amount: BONUS, threshold: THRESHOLD, status: 'APPLIED', appliedAtMs: atMs,
    eligibility: 'LIFETIME_CUMULATIVE_DEPOSIT_AT_LEAST_500', outstandingPrincipalDelta: 0,
    eventBonusRestrictionVersion: 1, eventBonusRestrictedCashDelta: BONUS };
}

module.exports = { CAMPAIGN_ID, THRESHOLD, BONUS, CONFIG_PATH, receiptPath, prepareDepositBonus };
