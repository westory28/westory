import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';

// Operator-only. Exact campaign receipts scope the scan; no student identities
// or balances are printed or written to local plans. This never reverses a
// historical withdrawal, changes general Wis, or rewrites old transaction logs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wispi-event-principal-lock-20261117');
const require = createRequire(path.join(root, 'functions/package.json'));
const { Firestore, FieldPath } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const args = process.argv.slice(2), apply = args.includes('--apply');
assert(args.every(arg => ['--apply', '--dry-run'].includes(arg) || arg.startsWith('--confirm-plan=')));
assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
const projectId = 'history-quiz-yongsin', campaignId = 'wispi-deposit-500-v1';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let sourceDir = path.join(root, 'functions');
if (apply) {
  // Re-verify every deployed source/runtime before an irreversible operator run.
  execFileSync(process.execPath, ['scripts/verify-wispi-bonus-restriction-release.mjs', '--after'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
  const groups = JSON.parse(await fs.readFile(path.join(audit, 'release/prepared.json'), 'utf8'));
  const group = groups.find(item => item.targets.some(target => target.name === 'transferStudentWisStock'));
  assert(group); sourceDir = path.join(group.directory, 'functions');
}
const { createWisStockTrading } = require(path.join(sourceDir, 'wisStockTrading.js'));
const auth = new OAuth2Client({ eagerRefreshThresholdMillis: 30000 });
auth.setCredentials({ access_token: await accessToken(), expiry_date: Date.now() + 600000 });
auth.refreshHandler = async () => ({ access_token: await accessToken(), expiry_date: Date.now() + 600000 });
const db = new Firestore({ projectId, preferRest: true, auth });
try {
  const api = createWisStockTrading({ db });
  const members = [], aggregate = { examined: 0, eligible: 0, alreadyProtected: 0,
    restrictedCash: 0, legacyBonusWithdrawn: 0, personalPrincipalCorrection: 0 };
  let cursor = null;
  do {
    let query = db.collection('wis_stock_campaign_receipts').where('campaignId', '==', campaignId)
      .orderBy(FieldPath.documentId()).select('studentUid', 'accountId', 'semesterId', 'status', 'amount').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) {
      const receipt = document.data();
      assert.equal(receipt.status, 'APPLIED'); assert.equal(receipt.amount, 500);
      assert(/^20\d{2}-[12]$/.test(receipt.semesterId));
      const [year, semester] = receipt.semesterId.split('-');
      const input = { year, semester, uid: receipt.studentUid };
      const result = await api.migrateWisStockBonusRestriction({ ...input, dryRun: true });
      aggregate.examined++;
      if (result.eligible) {
        assert(/^[a-f0-9]{64}$/.test(result.digest));
        members.push({ ...input, accountId: receipt.accountId, digest: result.digest });
        aggregate.eligible++; aggregate.restrictedCash += result.restrictedCash;
        aggregate.legacyBonusWithdrawn += result.legacyBonusWithdrawn;
        aggregate.personalPrincipalCorrection += result.principalCorrection;
      } else aggregate.alreadyProtected++;
    }
    cursor = page.size === 100 ? page.docs.at(-1).id : null;
  } while (cursor);
  const plan = { schemaVersion: 1, projectId, campaignId, policy: 'wispi-bonus-restriction-v1',
    historicalWithdrawals: 'PRESERVE_AS_APPROVED', ...aggregate,
    membersDigest: sha(members.map(member => [member.accountId, member.digest]).sort(([a], [b]) => a.localeCompare(b))) };
  const planHash = sha(plan), planFile = path.join(audit, 'migration-plan.json');
  if (!apply) {
    await fs.mkdir(audit, { recursive: true });
    await fs.writeFile(planFile, JSON.stringify({ ...plan, planHash, createdAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ mode: 'DRY_RUN', ...plan, planHash, productionWrites: 0 }));
  } else {
    const prior = JSON.parse(await fs.readFile(planFile, 'utf8'));
    assert.equal(args.find(arg => arg.startsWith('--confirm-plan='))?.slice(15), prior.planHash);
    assert.equal(planHash, prior.planHash, 'Account state changed; inspect a new dry run before applying');
    assert(Date.now() - Date.parse(prior.createdAt) < 3600000, 'Plan expired');
    let changed = 0, duplicate = 0;
    for (const member of members) {
      const result = await api.migrateWisStockBonusRestriction({ ...member, dryRun: false, expectedDigest: member.digest });
      if (result.changed) changed++; else duplicate++;
    }
    const result = { mode: 'APPLIED', projectId, campaignId, planHash, changed, duplicate,
      restrictedCash: aggregate.restrictedCash, preservedHistoricalBonusWithdrawal: aggregate.legacyBonusWithdrawn,
      mainWalletWrites: 0, oldTransactionWrites: 0, completedAt: new Date().toISOString() };
    await fs.writeFile(path.join(audit, 'migration-applied.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
} finally { await db.terminate(); }
