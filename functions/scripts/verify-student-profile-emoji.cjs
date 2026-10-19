const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { createStudentProfileEmojiHandler } = require('../studentProfileEmoji');
const { accountIdFor } = require('../studentWisWallet');
const { resolveStudentProfileEmoji, resolveRankPolicy, getCurrentTierCodeForRankTotal } = require('../studentProfileEmojiPolicy');

// Isolated in-memory transactions only; no credentials or production data.
const uid = 'emoji-student', semesterId = '2026-2';
const accountId = accountIdFor(semesterId, uid);
const accountPath = `semester_wis_accounts/${accountId}`;
const profilePath = `users/${uid}`;
const policyPath = 'years/2026/semesters/2/point_policies/current';
const slotPath = `semester_enrollment_slots/slot_${createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex').slice(0, 40)}`;
const registry = [
  { id: 'smile', emoji: '😀', enabled: true, unlockTierCode: 'tier_1' },
  { id: 'cool', emoji: '😎', enabled: true, unlockTierCode: 'tier_2' },
  { id: 'fox', emoji: '🦊', enabled: true, unlockTierCode: 'tier_5' },
  { id: 'disabled', emoji: '🚫', enabled: false, unlockTierCode: 'tier_1' },
];
const request = (overrides = {}) => ({
  auth: { uid },
  data: { year: '2026', semester: '2', emojiId: 'smile', _session: { revision: 'current' }, ...overrides },
});

function fixture({ rank = 0, balance = 0, assertSession } = {}) {
  const documents = new Map(Object.entries({
    'site_settings/semester_active': { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    [profilePath]: { role: 'student', registrationApprovalStatus: 'APPROVED', profileEmojiId: 'fox', profileIcon: '🦊', untouched: 'preserved' },
    [`student_identities/${uid}`]: { studentUid: uid, accountStatus: 'ACTIVE' },
    [slotPath]: { studentUid: uid, semesterId, status: 'ACTIVE', activeEnrollmentId: 'enrollment-one' },
    'semester_enrollments/enrollment-one': { enrollmentId: 'enrollment-one', studentUid: uid, semesterId, enrollmentStatus: 'ACTIVE', classId: 'class-one' },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE' },
    [accountPath]: { schemaVersion: 1, policyVersion: 'w7-v1', accountId, studentUid: uid, semesterId,
      enrollmentId: 'enrollment-one', classId: 'class-one', status: 'ACTIVE', revision: 1, balance,
      earnedTotal: rank, rankEarnedTotal: rank, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] },
    [policyPath]: { rankPolicy: { emojiRegistry: registry } },
    [`years/2026/semesters/1/point_wallets/${uid}`]: { balance: 10000, earnedTotal: 10000, rankEarnedTotal: 10000 },
    [`years/2026/semesters/2/point_wallets/${uid}`]: { balance: 10000, earnedTotal: 10000, rankEarnedTotal: 10000 },
  }));
  const reads = [], writes = [];
  const db = {
    doc: path => ({ path }),
    async runTransaction(callback) {
      const source = new Map([...documents].map(([path, data]) => [path, structuredClone(data)]));
      const pending = [];
      const transaction = {
        async get(ref) {
          assert.equal(pending.length, 0, 'No transaction reads after writes');
          reads.push(ref.path);
          return { exists: source.has(ref.path), data: () => structuredClone(source.get(ref.path)) };
        },
        getAll(...refs) { return Promise.all(refs.map(ref => transaction.get(ref))); },
        set(ref, data, options) { pending.push({ path: ref.path, data, options }); },
      };
      const result = await callback(transaction);
      for (const write of pending) {
        documents.set(write.path, { ...(write.options?.merge ? documents.get(write.path) : {}), ...write.data });
        writes.push(write);
      }
      return result;
    },
  };
  let sessionCalls = 0;
  const handler = createStudentProfileEmojiHandler({
    db,
    assertSession: async req => {
      sessionCalls++;
      assert.equal(reads.length, 0, 'Session must precede domain reads');
      if (assertSession) return assertSession(req);
      if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Missing session');
      return { uid: req.auth.uid };
    },
    loadPolicy: async (transaction, year, semester) =>
      (await transaction.get(db.doc(`years/${year}/semesters/${semester}/point_policies/current`))).data(),
  });
  return { handler, documents, reads, writes, get sessionCalls() { return sessionCalls; } };
}

let count = 0;
async function test(name, callback) { await callback(); count++; console.log(`PASS ${name}`); }
const rejected = async (state, input, code = 'failed-precondition') => {
  const before = new Map([...state.documents].map(([path, data]) => [path, structuredClone(data)]));
  await assert.rejects(state.handler(input), error => error.code === code);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.documents, before);
};

(async () => {
  await test('previous semester request cannot unlock emoji with old points', async () => {
    const state = fixture({ rank: 500 });
    await rejected(state, request({ semester: '1', emojiId: 'fox' }));
  });
  await test('high legacy wallets and saved fox cannot unlock a zero-score current account', async () => {
    const state = fixture();
    await rejected(state, request({ emojiId: 'fox' }));
    assert.equal(state.reads.some(path => path.includes('/point_wallets/') || path.includes('/point_transactions')), false);
  });
  await test('canonical rank unlocks independently of old wallet and remaining balance', async () => {
    const state = fixture({ rank: 500, balance: 0 });
    state.documents.set(`years/2026/semesters/2/point_wallets/${uid}`, { rankEarnedTotal: 0 });
    const before = new Map([...state.documents].filter(([path]) => path !== profilePath));
    assert.deepEqual(await state.handler(request({ emojiId: 'fox' })), { emojiId: 'fox', profileIcon: '🦊', tierCode: 'tier_5' });
    assert.equal(state.sessionCalls, 1);
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].path, profilePath);
    assert.deepEqual(Object.keys(state.writes[0].data).sort(), ['profileEmojiId', 'profileIcon', 'updatedAt']);
    assert.equal(state.writes[0].options.merge, true);
    assert.equal(state.documents.get(profilePath).untouched, 'preserved');
    assert.deepEqual(new Map([...state.documents].filter(([path]) => path !== profilePath)), before);
    assert.equal(state.reads.includes(policyPath), true);
  });
  await test('canonical rank threshold is inclusive and ignores balance', async () => {
    await rejected(fixture({ rank: 49, balance: 9999 }), request({ emojiId: 'cool' }));
    const state = fixture({ rank: 50 });
    assert.equal((await state.handler(request({ emojiId: 'cool' }))).tierCode, 'tier_2');
  });
  await test('missing canonical account never falls back to legacy wallet', async () => {
    const state = fixture(); state.documents.delete(accountPath);
    await rejected(state, request());
    assert.equal(state.reads.some(path => path.includes('/point_wallets/')), false);
  });
  await test('current pointer and manifest revision changes reject a stale screen', async () => {
    for (const pointer of [{ semesterId: '2026-1', revision: 1 }, { semesterId, revision: 2 }]) {
      const state = fixture(); state.documents.set('site_settings/semester_active', pointer);
      await rejected(state, request());
    }
  });
  await test('foreign account, inactive enrollment and pending registration cannot save', async () => {
    for (const [path, patch] of [[accountPath, { studentUid: 'other' }],
      ['semester_enrollments/enrollment-one', { enrollmentStatus: 'INACTIVE' }],
      [profilePath, { registrationApprovalStatus: 'PENDING' }]]) {
      const state = fixture(); state.documents.set(path, { ...state.documents.get(path), ...patch });
      await rejected(state, request());
    }
  });
  await test('stale or missing session denies before domain reads', async () => {
    const state = fixture({ assertSession: async () => { throw new HttpsError('unauthenticated', 'Expired session'); } });
    await rejected(state, request(), 'unauthenticated');
    assert.equal(state.reads.length, 0);
    await rejected(fixture(), { ...request(), auth: null }, 'unauthenticated');
  });
  await test('session actor mismatch denies before domain reads', async () => {
    const state = fixture({ assertSession: async () => ({ uid: 'another-student' }) });
    await rejected(state, request(), 'unauthenticated');
    assert.equal(state.reads.length, 0);
  });
  await test('disabled and unknown emoji never change profile', async () => {
    for (const emojiId of ['disabled', 'unknown']) await rejected(fixture({ rank: 500 }), request({ emojiId }), 'invalid-argument');
  });
  await test('semester policy thresholds and disabled entries govern saving', async () => {
    const rankPolicy = { emojiRegistry: registry, tiers: [
      { code: 'tier_1', minPoints: 0 }, { code: 'tier_2', minPoints: 2000 },
      { code: 'tier_5', minPoints: 5000 },
    ] };
    for (const emojiId of ['cool', 'fox']) {
      const locked = fixture({ rank: 1835 });
      locked.documents.set(policyPath, { rankPolicy });
      await rejected(locked, request({ emojiId }));
    }
    const state = fixture({ rank: 1835 });
    state.documents.set(policyPath, { rankPolicy });
    const saved = await state.handler(request());
    assert.equal(saved.profileIcon, '😀');
    assert.equal(saved.tierCode, 'tier_1');
  });
  await test('shared resolver defaults locked, disabled, unknown and mismatched IDs', async () => {
    const rankPolicy = { emojiRegistry: registry, emojiPolicy: { defaultEmojiId: 'cool' } };
    for (const [profileEmojiId, profileIcon, reason] of [
      ['fox', '🦊', 'tier_locked'], ['disabled', '🚫', 'disabled'],
      ['unknown', '😀', 'unknown_id'], ['smile', '🦊', 'id_icon_mismatch'],
      ['cool', '🦊', 'id_icon_mismatch'], ['smile', { icon: '😀' }, 'id_icon_mismatch'],
    ]) {
      const resolved = resolveStudentProfileEmoji({ profileEmojiId, profileIcon, rankEarnedTotal: 0, rankPolicy });
      assert.equal(resolved.profileEmojiId, 'cool');
      assert.equal(resolved.profileIcon, '😎');
      assert.equal(resolved.isValid, false);
      assert.equal(resolved.reason, reason);
    }
    const allowed = resolveStudentProfileEmoji({ profileEmojiId: 'smile', profileIcon: '😀', rankEarnedTotal: 0, rankPolicy });
    assert.equal(allowed.profileIcon, '😀');
    assert.equal(allowed.isValid, true);
    assert.equal(resolveStudentProfileEmoji({ profileEmojiId: 'smile', rankEarnedTotal: 0, rankPolicy }).profileIcon, '😀');
  });
  await test('legacy raw icons require current unlock and normalize to registry glyph', async () => {
    const rankPolicy = { emojiRegistry: registry.map(entry => entry.id === 'smile'
      ? { ...entry, legacyValues: ['☺️'] } : entry) };
    assert.equal(resolveStudentProfileEmoji({ profileIcon: '🦊', rankEarnedTotal: 0, rankPolicy }).profileIcon, '😀');
    assert.equal(resolveStudentProfileEmoji({ profileIcon: '🦊', rankEarnedTotal: 500, rankPolicy }).profileIcon, '🦊');
    assert.equal(resolveStudentProfileEmoji({ profileIcon: '☺️', rankEarnedTotal: 0, rankPolicy }).profileIcon, '😀');
  });
  await test('invalid canonical rank values fail closed instead of unlocking higher emojis', async () => {
    const rankPolicy = { emojiRegistry: registry };
    for (const rankEarnedTotal of [Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '500', -1, 500.5, null, undefined]) {
      assert.equal(getCurrentTierCodeForRankTotal(rankEarnedTotal, rankPolicy), 'tier_1');
      const resolved = resolveStudentProfileEmoji({ profileEmojiId: 'fox', profileIcon: '🦊', rankEarnedTotal, rankPolicy });
      assert.equal(resolved.profileEmojiId, 'smile');
      assert.equal(resolved.profileIcon, '😀');
      assert.equal(resolved.reason, 'tier_locked');
    }
    assert.equal(getCurrentTierCodeForRankTotal(500, rankPolicy), 'tier_5');
  });
  await test('disabled default falls back safely and display flags never disable tier authorization', async () => {
    const rankPolicy = { emojiRegistry: registry, emojiPolicy: { defaultEmojiId: 'disabled' } };
    assert.equal(resolveRankPolicy(rankPolicy).emojiPolicy.defaultEmojiId, 'smile');
    assert.equal(resolveStudentProfileEmoji({ profileEmojiId: 'unknown', rankEarnedTotal: 0, rankPolicy }).profileIcon, '😀');
    for (const flags of [{ enabled: false }, { emojiPolicy: { enabled: false } }]) {
      const resolved = resolveStudentProfileEmoji({ profileEmojiId: 'fox', profileIcon: '🦊', rankEarnedTotal: 0,
        rankPolicy: { emojiRegistry: registry, ...flags } });
      assert.equal(resolved.profileIcon, '😀');
      assert.equal(resolved.reason, 'tier_locked');
      const normalized = resolveRankPolicy({ emojiRegistry: registry, ...flags });
      assert.equal(flags.emojiPolicy ? normalized.emojiPolicy.enabled : normalized.enabled, false);
    }
    const state = fixture();
    state.documents.set(policyPath, { rankPolicy: { emojiRegistry: registry, emojiPolicy: { enabled: false } } });
    await rejected(state, request({ emojiId: 'fox' }));
    const unlocked = fixture({ rank: 500 });
    unlocked.documents.set(policyPath, { rankPolicy: { emojiRegistry: registry, emojiPolicy: { enabled: false } } });
    assert.equal((await unlocked.handler(request({ emojiId: 'fox' }))).profileIcon, '🦊');
    await rejected(fixture(), request({ emojiId: 'disabled' }), 'invalid-argument');
  });
  await test('invalid scope and client-supplied score or owner are rejected', async () => {
    for (const data of [{ year: '../2026' }, { semester: '3' }, { emojiId: '' }, { emojiId: {} },
      { uid: 'victim' }, { rankEarnedTotal: 9999 }]) {
      const state = fixture(); await rejected(state, request(data), 'invalid-argument');
      assert.equal(state.reads.length, 0);
    }
  });
  console.log(`PASS student profile emoji: ${count} current-semester and authorization regression groups`);
})().catch(error => { console.error(error); process.exitCode = 1; });
