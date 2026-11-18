const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const CAMPAIGN_ID = 'wispi-deposit-500-v1';
const THRESHOLD = 500;
const BONUS = 500;
const CONFIG_PATH = 'site_settings/wis_stock_deposit_campaign';
const receiptPath = uid => `wis_stock_campaign_receipts/${CAMPAIGN_ID}_${createHash('sha256').update(uid).digest('hex')}`;
const invalid = () => { throw new HttpsError('failed-precondition', '위스피 이벤트 지급 기록을 확인해 주세요.', { reason: 'WIS_STOCK_CAMPAIGN_INVALID' }); };

// The global identity receipt includes historical automatic grants. A new
// semester or request ID must never make the same student eligible twice.
async function getDepositBonusStatus({ db, tx, uid }) {
  const [config, paid] = await tx.getAll(db.doc(CONFIG_PATH), db.doc(receiptPath(uid)));
  if (config.exists && config.data().campaignId !== CAMPAIGN_ID) invalid();
  const result = { campaignId: CAMPAIGN_ID, threshold: THRESHOLD, amount: BONUS, qualifyingDepositAmount: 0 };
  if (paid.exists) {
    const value = paid.data();
    if (value.campaignId !== CAMPAIGN_ID || value.studentUid !== uid || value.amount !== BONUS || value.status !== 'APPLIED') invalid();
    return { ...result, status: 'CLAIMED', qualifyingDepositAmount: THRESHOLD };
  }
  if (!config.exists || config.data().enabled !== true) return { ...result, status: 'DISABLED' };
  let provenDeposits = 0;
  // Every canonical DEPOSIT is an integer >= 1. The first 500 deposits prove
  // eligibility; fewer rows cover the complete matching ledger. This is a
  // capped eligibility result, not a truncated lifetime-total report.
  const snapshot = await tx.get(db.collectionGroup('wis_stock_history')
    .where('studentUid', '==', uid).where('kind', '==', 'DEPOSIT').limit(THRESHOLD)
    .select('studentUid', 'kind', 'amount', 'stockCashDelta', 'mainCashDelta'));
  for (const doc of snapshot.docs) {
    const value = doc.data(), parts = doc.ref.path.split('/');
    if (parts.length !== 6 || parts[0] !== 'years' || !/^20\d{2}$/.test(parts[1])
      || parts[2] !== 'semesters' || !/^[12]$/.test(parts[3])
      || value.studentUid !== uid || value.kind !== 'DEPOSIT'
      || !Number.isSafeInteger(value.amount) || value.amount < 1 || value.stockCashDelta !== value.amount
      || value.mainCashDelta !== -value.amount) invalid();
    provenDeposits = Math.min(THRESHOLD, provenDeposits + value.amount);
  }
  return { ...result, status: provenDeposits >= THRESHOLD ? 'ELIGIBLE' : 'INELIGIBLE', qualifyingDepositAmount: provenDeposits };
}

function createDepositBonusReceipt({ uid, account, atMs, requestId }) {
  return { schemaVersion: 1, campaignId: CAMPAIGN_ID, studentUid: uid, accountId: account.accountId,
    semesterId: account.semesterId, amount: BONUS, threshold: THRESHOLD, status: 'APPLIED', appliedAtMs: atMs,
    requestId, eligibility: 'LIFETIME_CUMULATIVE_DEPOSIT_AT_LEAST_500', outstandingPrincipalDelta: 0,
    eventBonusRestrictionVersion: 1, eventBonusRestrictedCashDelta: BONUS };
}

module.exports = { CAMPAIGN_ID, THRESHOLD, BONUS, CONFIG_PATH, receiptPath, getDepositBonusStatus, createDepositBonusReceipt };
