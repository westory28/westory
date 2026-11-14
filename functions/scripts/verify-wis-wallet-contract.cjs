const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createStudentWisWallet, accountIdFor } = require('../studentWisWallet');

const scope = { year: '2026', semester: '2' }, semesterId = '2026-2', uid = 'wallet-fixture';
const accountId = accountIdFor(semesterId, uid), accountPath = `semester_wis_accounts/${accountId}`;
const slotId = createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex').slice(0, 40);
function fixture(patch = {}) {
  const docs = new Map(Object.entries({
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, revision: 1, status: 'ACTIVE' },
    [`semester_wis_economies/${semesterId}`]: { semesterId, revision: 1, status: 'ACTIVE_OPEN', ledgerEntryCount: 0 },
    [`users/${uid}`]: { role: 'student', registrationApprovalStatus: 'APPROVED' },
    [`student_identities/${uid}`]: { studentUid: uid, accountStatus: 'ACTIVE' },
    [`semester_enrollment_slots/slot_${slotId}`]: { semesterId, studentUid: uid, activeEnrollmentId: 'one' },
    'semester_enrollments/one': { enrollmentId: 'one', studentUid: uid, semesterId, classId: 'one', enrollmentStatus: 'ACTIVE' },
    'semester_classes/one': { classId: 'one', semesterId, status: 'ACTIVE' },
    [accountPath]: { schemaVersion: 1, policyVersion: 'w7-v1', accountId, studentUid: uid,
      semesterId, enrollmentId: 'one', classId: 'one', status: 'ACTIVE', revision: 1,
      balance: 100, earnedTotal: 150, rankEarnedTotal: 70, spentTotal: 20, adjustedTotal: -30,
      recentLedgerEntries: [], ...patch },
  }));
  const db = { doc: path => ({ path }) };
  const transaction = () => {
    const reads = [], writes = [];
    const tx = {
      async get(ref) { assert.equal(writes.length, 0); reads.push(ref.path);
        return { exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }; },
      getAll(...refs) { return Promise.all(refs.map(ref => tx.get(ref))); },
      create(ref, data) { writes.push({ path: ref.path, data, create: true }); },
      set(ref, data, options) { writes.push({ path: ref.path, data, options }); },
    };
    return { tx, reads, writes };
  };
  return { db, docs, transaction, wallet: createStudentWisWallet({ db }) };
}
const post = (wallet, tx, loaded, delta = -10, overrides = {}) => wallet.write(tx,
  overrides.scope || scope, overrides.uid || uid, delta, overrides.activity || 'weplay_cost',
  overrides.source || 'session-one', '합성 게임 비용', loaded,
  overrides.receipt || 'years/2026/semesters/2/point_transactions/weplay_cost_session-one');
const denied = operation => assert.throws(operation, error => error.code === 'failed-precondition');

test('one debit posts complete accounting with no extra reads and preserves cumulative earnings', async () => {
  const f = fixture(), t = f.transaction(), loaded = await f.wallet.read(t.tx, scope, uid);
  assert.equal(t.reads.length, 10);
  assert.equal(post(f.wallet, t.tx, loaded), 90);
  assert.equal(t.reads.length, 10);
  assert.equal(t.writes.length, 5);
  const account = t.writes.find(write => write.path === accountPath).data;
  assert.equal(account.rankEarnedTotal, 70); assert.equal(account.earnedTotal, 150);
  assert.equal(account.spentTotal, 20); assert.equal(account.adjustedTotal, -40);
  const ledger = t.writes.find(write => write.create).data;
  assert.equal(ledger.balanceBefore, 100); assert.equal(ledger.balanceAfter, 90);
  assert.equal(ledger.delta, -10); assert.equal(ledger.activityType, 'weplay_cost');
  assert.equal(t.writes.find(write => write.path === `semester_wis_rankings/${accountId}`).data.rankEarnedTotal, 70);
});

test('reused, copied, foreign and cross-transaction snapshots cannot post a second balance', async () => {
  const f = fixture(), t = f.transaction(), loaded = await f.wallet.read(t.tx, scope, uid);
  denied(() => post(f.wallet, t.tx, { ...loaded }));
  denied(() => post(f.wallet, f.transaction().tx, loaded));
  denied(() => post(f.wallet, t.tx, loaded, -10, { uid: 'other' }));
  denied(() => post(f.wallet, t.tx, loaded, -10, { scope: { year: '2026', semester: '1' } }));
  assert.equal(t.writes.length, 0);
  post(f.wallet, t.tx, loaded);
  denied(() => post(f.wallet, t.tx, loaded, -20));
  assert.equal(t.writes.length, 5);
});

test('separate adapter instances cannot overwrite the same transaction economy count', async () => {
  const f = fixture(), t = f.transaction(), another = createStudentWisWallet({ db: f.db });
  const first = await f.wallet.read(t.tx, scope, uid), second = await another.read(t.tx, scope, uid);
  post(f.wallet, t.tx, first);
  denied(() => post(another, t.tx, second));
  assert.equal(t.writes.length, 5);
});

test('caller-mutated snapshots cannot mint money; rejected amounts stage no writes and permit safe retry', async () => {
  const f = fixture(), t = f.transaction(), loaded = await f.wallet.read(t.tx, scope, uid);
  loaded.wallet.balance = 999999; loaded.wallet.rankEarnedTotal = 999999; loaded.economy.ledgerEntryCount = 999;
  denied(() => post(f.wallet, t.tx, loaded, -101));
  denied(() => post(f.wallet, t.tx, loaded, Number.MAX_SAFE_INTEGER));
  denied(() => post(f.wallet, t.tx, loaded, -0.5));
  denied(() => post(f.wallet, t.tx, loaded, -10, { receipt: 'years/2026/semesters/1/point_transactions/other' }));
  assert.equal(t.writes.length, 0);
  assert.equal(post(f.wallet, t.tx, loaded), 90);
  assert.equal(t.writes.find(write => write.path === accountPath).data.rankEarnedTotal, 70);
  assert.equal(t.writes.find(write => write.path === `semester_wis_economies/${semesterId}`).data.ledgerEntryCount, 1);
});

test('transaction retry receives a fresh snapshot and deterministic immutable ledger identity', async () => {
  const f = fixture(), first = f.transaction();
  const old = await f.wallet.read(first.tx, scope, uid);
  post(f.wallet, first.tx, await f.wallet.read(first.tx, scope, uid));
  const originalId = first.writes[0].path;
  // Like the Firestore SDK, retain the Transaction object but reset its staged
  // writes before invoking the callback again after a conflict.
  first.writes.length = 0;
  const fresh = await f.wallet.read(first.tx, scope, uid);
  denied(() => post(f.wallet, first.tx, old));
  assert.equal(first.writes.length, 0);
  post(f.wallet, first.tx, fresh);
  assert.equal(first.writes[0].path, originalId);
  assert.equal(first.writes.length, 5);
});
