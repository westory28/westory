import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';

// Operator-only, default read-only. No UID, name, wallet amount or credentials
// are printed or saved in plans. Applying requires the exact reviewed digest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'functions/package.json'));
const { Firestore, FieldPath } = require('@google-cloud/firestore');
const sourceDir = path.join(root, 'output/wispi-graduation-event-20261117/release/prepared/transferStudentWisStock/functions');
const { createWisStockTrading } = require(path.join(sourceDir, 'wisStockTrading.js'));
const { CAMPAIGN_ID, CONFIG_PATH, BONUS } = require(path.join(sourceDir, 'wisStockDepositCampaign.js'));
const sha = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2), apply = args.includes('--apply');
assert(args.every(arg => arg === '--apply' || arg === '--dry-run' || arg.startsWith('--plan=') || arg.startsWith('--confirm-plan=')));
assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Production runner cannot use emulator overrides');
const projectId = 'history-quiz-yongsin';
const planFile = path.resolve(args.find(arg => arg.startsWith('--plan='))?.slice(7)
  || path.join(root, 'output/wispi-graduation-event-20261117/event-plan.json'));
const { OAuth2Client } = require('google-auth-library');
const cliClient = new OAuth2Client({ eagerRefreshThresholdMillis: 30000 });
cliClient.setCredentials({ access_token: await accessToken(), expiry_date: Date.now() + 600000 });
cliClient.refreshHandler = async () => ({ access_token: await accessToken(), expiry_date: Date.now() + 600000 });
// The existing CLI bearer stays in memory. Let the official OAuth client
// refresh through the same CLI provider; never create ADC or service keys.
const db = new Firestore({ projectId, preferRest: true, auth: cliClient });
const api = createWisStockTrading({ db });
try {
  console.log(JSON.stringify({ phase: 'READING_ACTIVE_SCOPE', mode: apply ? 'APPLY_VALIDATION' : 'DRY_RUN' }));
  let pointer;
  const initialTimer = setTimeout(() => { console.error('Initial read timed out before any writes.'); process.exit(1); }, 30000);
  try { pointer = (await db.doc('site_settings/semester_active').get()).data(); }
  finally { clearTimeout(initialTimer); }
  console.log(JSON.stringify({ phase: 'ACTIVE_SCOPE_READ' }));
  assert(/^20\d{2}-[12]$/.test(pointer?.semesterId || ''), 'Current semester unavailable');
  const [year, semester] = pointer.semesterId.split('-'), scope = { year, semester };
  const configuration = (await db.doc('site_settings/config').get()).data();
  assert.equal(`${configuration?.year}-${configuration?.semester}`, pointer.semesterId, 'Active semester mismatch');
  // General canonical accounts cover prior depositors who have not opened a
  // stock account this semester. Each candidate's current student/enrollment
  // authority and historical deposits are rechecked by the transaction.
  let cursor = null, examined = 0;
  const eligible = [], unavailable = {};
  const readers = Array.from({ length: 4 }, () => createWisStockTrading({ db }));
  do {
    let query = db.collection('semester_wis_accounts').where('semesterId', '==', pointer.semesterId)
      .where('status', '==', 'ACTIVE').orderBy(FieldPath.documentId()).select('studentUid', 'accountId').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    let nextIndex = 0;
    await Promise.all(readers.map(async reader => {
      while (nextIndex < page.docs.length) {
        const doc = page.docs[nextIndex++];
        const value = doc.data(); examined++;
        assert(typeof value.studentUid === 'string' && value.accountId === doc.id, 'Canonical account binding invalid');
        try {
          const result = await reader.grantWisStockDepositBonus({ ...scope, uid: value.studentUid, dryRun: true });
          if (result.eligible) eligible.push({ uid: value.studentUid, accountId: doc.id });
        } catch (error) {
          if (error?.code !== 'failed-precondition') throw error;
          const reason = error.details?.reason || 'CURRENT_STUDENT_ACCOUNT_UNAVAILABLE';
          // Corrupt money/receipt/history must stop, not be silently excluded.
          if (reason !== 'CURRENT_STUDENT_ACCOUNT_UNAVAILABLE' && reason !== 'WIS_STOCK_STUDENT_REQUIRED') throw error;
          unavailable[reason] = (unavailable[reason] || 0) + 1;
        }
      }
    }));
    console.log(JSON.stringify({ phase: 'ELIGIBILITY_SCAN', examined, eligible: eligible.length }));
    cursor = page.size === 100 ? page.docs.at(-1).id : null;
  } while (cursor);
  const membersDigest = sha(eligible.map(value => `${value.accountId}\n${value.uid}`).sort().join('\n'));
  const reviewed = { schemaVersion: 1, projectId, semesterId: pointer.semesterId, campaignId: CAMPAIGN_ID,
    threshold: 500, rewardPerPerson: BONUS, examined, eligible: eligible.length,
    totalReward: eligible.length * BONUS, unavailable: Object.fromEntries(Object.entries(unavailable).sort(([a], [b]) => a.localeCompare(b))), membersDigest };
  const planHash = sha(JSON.stringify(reviewed));
  if (!apply) {
    await fs.mkdir(path.dirname(planFile), { recursive: true });
    await fs.writeFile(planFile, JSON.stringify({ ...reviewed, planHash, createdAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ mode: 'DRY_RUN', ...reviewed, planHash, planFile }));
  } else {
    const prior = JSON.parse(await fs.readFile(planFile, 'utf8'));
    const confirmed = args.find(arg => arg.startsWith('--confirm-plan='))?.slice(15);
    assert.equal(confirmed, prior.planHash, 'Pass the reviewed --confirm-plan digest');
    assert.equal(planHash, prior.planHash, 'Eligibility changed; generate a fresh dry-run plan before applying');
    assert(Date.now() - Date.parse(prior.createdAt) < 3600000, 'Dry-run plan must be less than one hour old');
    const verified = JSON.parse(await fs.readFile(path.join(root, 'output/wispi-graduation-event-20261117/release/verify.json'), 'utf8'));
    assert(verified.some(value => value.name === 'transferStudentWisStock' && value.state === 'ACTIVE'), 'Verify the deployed transfer function before activation');
    await db.runTransaction(async tx => {
      const ref = db.doc(CONFIG_PATH), old = await tx.get(ref);
      assert(!old.exists || old.data().campaignId === CAMPAIGN_ID, 'Existing campaign mismatch');
      if (!old.exists || old.data().enabled !== true) tx.set(ref, { schemaVersion: 1, campaignId: CAMPAIGN_ID,
        enabled: true, threshold: 500, bonusAmount: BONUS, oncePerStudent: true,
        includesHistoricalDeposits: true, enabledAtMs: Date.now(), reviewedPlanHash: planHash });
    });
    let paid = 0, duplicateOrNoLongerEligible = 0;
    for (const member of eligible) {
      const result = await api.grantWisStockDepositBonus({ ...scope, uid: member.uid, dryRun: false });
      if (result.changed) paid++; else duplicateOrNoLongerEligible++;
    }
    const result = { mode: 'APPLIED', campaignId: CAMPAIGN_ID, semesterId: pointer.semesterId, planHash,
      paid, rewardTotal: paid * BONUS, duplicateOrNoLongerEligible, completedAt: new Date().toISOString() };
    await fs.writeFile(planFile.replace(/\.json$/i, '') + '-applied.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
} finally { await db.terminate(); }
