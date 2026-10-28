const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { HttpsError } = require('firebase-functions/v2/https');
const { createStudentAvatarHandlers, createStudentAvatarDeletionHandler, encodeThumbnail } = require('../studentAvatar');
const { defaultLook, catalog, sanitizePublicAvatar, lookHash } = require('../studentAvatarCatalog');
const { accountIdFor } = require('../studentWisWallet');

const uid = 'avatar-student', semesterId = '2026-2', accountId = accountIdFor(semesterId, uid);
const accountPath = `semester_wis_accounts/${accountId}`, avatarPath = `student_avatars/${uid}`;
const paid = catalog.items.filter(item => item.price > 0);
const req = data => ({ auth: { uid }, data: { _session: {}, ...data } });
const purchase = (item = paid[0], requestId = 'purchase-0001') => req({ year: '2026', semester: '2', itemId: item.id, requestId });
const initialDocuments = (balance = 1000) => ({
  'site_settings/semester_active': { semesterId, revision: 1 },
  [`semester_manifests/${semesterId}`]: { semesterId, status: 'ACTIVE', revision: 1 },
  [`semester_wis_economies/${semesterId}`]: { semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
  [`users/${uid}`]: { uid, email: 'avatar@yongshin-ms.ms.kr', role: 'student', registrationApprovalStatus: 'APPROVED', untouched: 'kept' },
  [`student_identities/${uid}`]: { studentUid: uid, accountStatus: 'ACTIVE' },
  [`semester_enrollment_slots/slot_${createHash('sha256').update(`${semesterId}\n${uid}`).digest('hex').slice(0, 40)}`]: { studentUid: uid, semesterId, status: 'ACTIVE', activeEnrollmentId: 'one' },
  'semester_enrollments/one': { enrollmentId: 'one', studentUid: uid, semesterId, enrollmentStatus: 'ACTIVE', classId: 'one' },
  'semester_classes/one': { classId: 'one', semesterId, status: 'ACTIVE' },
  [accountPath]: { schemaVersion: 1, policyVersion: 'w7-v1', accountId, studentUid: uid, semesterId,
    enrollmentId: 'one', classId: 'one', status: 'ACTIVE', revision: 1, balance,
    earnedTotal: 2000, rankEarnedTotal: 1900, spentTotal: 500, adjustedTotal: -500, recentLedgerEntries: [] },
  [`years/2026/semesters/2/point_wallets/${uid}`]: { balance: 999999 },
});
function memoryBucket() {
  const objects = new Map();
  const bucket = { name: 'avatar-test.appspot.com', objects, fail: false, afterSave: null, file(path) { return {
    async save(bytes, options) {
      if (bucket.fail) throw Object.assign(new Error('storage unavailable'), { code: 503 });
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
      if (objects.has(path)) throw Object.assign(new Error('immutable'), { code: 412 });
      objects.set(path, { bytes, ...options.metadata });
      if (bucket.afterSave) await bucket.afterSave();
    },
    async getMetadata() { return [objects.get(path)]; },
    async delete() { objects.delete(path); },
  }; } };
  bucket.deleteFiles = async ({ prefix, force }) => {
    if (bucket.fail) throw new Error('storage unavailable');
    assert.equal(force, true);
    for (const path of objects.keys()) if (path.startsWith(prefix)) objects.delete(path);
  };
  return bucket;
}
function fixture(balance = 1000) {
  const documents = new Map(Object.entries(initialDocuments(balance))), versions = new Map(), writes = [], reads = [];
  let clock = 100000, rejectSession = false, sessionUid;
  const snapshot = (source, path) => ({ exists: source.has(path), data: () => structuredClone(source.get(path)) });
  const db = {
    doc(path) { return { path, get: async () => snapshot(documents, path) }; },
    async recursiveDelete(ref) {
      for (const path of documents.keys()) if (path === ref.path || path.startsWith(`${ref.path}/`)) {
        documents.delete(path); versions.set(path, (versions.get(path) || 0) + 1);
      }
    },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const source = new Map([...documents].map(([path, data]) => [path, structuredClone(data)]));
        const baseline = new Map(versions), readPaths = new Set(), pending = [];
        const tx = {
          async get(ref) { assert.equal(pending.length, 0, 'All transaction reads precede writes'); reads.push(ref.path); readPaths.add(ref.path); return snapshot(source, ref.path); },
          getAll(...refs) { return Promise.all(refs.map(ref => tx.get(ref))); },
          set(ref, data, options) { pending.push({ path: ref.path, data, options }); },
          create(ref, data) { pending.push({ path: ref.path, data, create: true }); },
          delete(ref) { pending.push({ path: ref.path, delete: true }); },
        };
        const result = await callback(tx);
        if ([...readPaths].some(path => baseline.get(path) !== versions.get(path))) continue;
        for (const entry of pending) if (entry.create) assert.equal(documents.has(entry.path), false, 'Immutable create only');
        for (const entry of pending) {
          if (entry.delete) documents.delete(entry.path);
          else documents.set(entry.path, { ...(entry.options?.merge ? documents.get(entry.path) : {}), ...entry.data });
          versions.set(entry.path, (versions.get(entry.path) || 0) + 1); writes.push(entry);
        }
        return result;
      }
      throw new Error('Transaction retry exhausted');
    },
  };
  const bucket = memoryBucket();
  const api = createStudentAvatarHandlers({ db, bucket, now: () => clock, assertSession: async request => {
    if (rejectSession || !request.auth?.uid) throw new HttpsError('unauthenticated', 'Fixture expired session');
    return { uid: sessionUid || request.auth.uid };
  } });
  return { api, db, bucket, documents, writes, reads, advance: () => { clock += 3000; },
    rejectSession: () => { rejectSession = true; }, sessionActor: value => { sessionUid = value; } };
}
const thumbnail = sharp({ create: { width: 512, height: 512, channels: 4, background: '#e8d5c2' } }).webp().toBuffer()
  .then(value => `data:image/webp;base64,${value.toString('base64')}`);
const save = async (overrides = {}) => req({ look: defaultLook(), expectedRevision: 0, requestId: 'save-0000001', thumbnailWebp: await thumbnail, ...overrides });
const reason = expected => error => error.details?.reason === expected;

if (require.main === module) {
test('default, 24 free catalog choices and private state never return another identity', async () => {
  const state = fixture(); const result = await state.api.getStudentAvatar(req({}));
  assert.deepEqual(result.look, defaultLook()); assert.equal(result.revision, 0); assert.deepEqual(result.ownedItemIds, []);
  assert.equal(catalog.items.filter(item => item.price === 0).length, 24);
  await assert.rejects(state.api.getStudentAvatar(req({ uid: 'foreign' })), reason('AVATAR_INPUT_INVALID'));
  assert.equal(state.writes.length, 0);
});
test('real purchase debits canonical balance, preserves rank/earned/adjustments, updates all projections and immutable ledger', async () => {
  const state = fixture(), result = await state.api.purchaseStudentAvatarItem(purchase());
  assert.equal(result.charged, paid[0].price); assert.equal(result.wallet.balance, 1000 - paid[0].price);
  const account = state.documents.get(accountPath);
  assert.equal(account.earnedTotal, 2000); assert.equal(account.rankEarnedTotal, 1900); assert.equal(account.adjustedTotal, -500);
  assert.equal(account.spentTotal, 500 + paid[0].price);
  for (const collection of ['semester_wis_balances', 'semester_wis_rankings']) {
    const projection = state.documents.get(`${collection}/${accountId}`);
    assert.equal(projection.balance, account.balance); assert.equal(projection.ledgerRevision, account.revision);
  }
  const ledger = state.documents.get(`semester_wis_ledger/${result.ledgerEntryId}`);
  assert.equal(ledger.type, 'ORDER_DEBIT'); assert.equal(ledger.delta, -paid[0].price);
  assert.equal(ledger.studentUid, uid); assert.equal(ledger.balanceBefore + ledger.delta, ledger.balanceAfter);
  assert.equal(state.documents.get(`years/2026/semesters/2/point_wallets/${uid}`).balance, 999999);
  assert.equal(state.reads.some(path => path.includes('point_wallets')), false);
});
test('parallel duplicate request retries create one debit and one ownership; distinct request for owned item costs zero', async () => {
  const state = fixture(); const results = await Promise.all(Array.from({ length: 4 }, () => state.api.purchaseStudentAvatarItem(purchase())));
  assert.equal(results.filter(value => !value.duplicate).length, 1);
  assert.equal([...state.documents.keys()].filter(key => key.startsWith('semester_wis_ledger/')).length, 1);
  const other = await state.api.purchaseStudentAvatarItem(purchase(paid[0], 'purchase-0002'));
  assert.equal(other.alreadyOwned, true); assert.equal(other.charged, 0);
  assert.equal(state.documents.get(accountPath).balance, 1000 - paid[0].price);
});
test('concurrent different requests for same item charge once', async () => {
  const state = fixture(); const values = await Promise.all([state.api.purchaseStudentAvatarItem(purchase()), state.api.purchaseStudentAvatarItem(purchase(paid[0], 'purchase-0002'))]);
  assert.equal(values.reduce((sum, value) => sum + value.charged, 0), paid[0].price);
  assert.equal(state.documents.get(avatarPath).ownedItemIds.length, 1);
});
test('concurrent different items cannot overspend the real remaining balance', async () => {
  const state = fixture(Math.max(paid[0].price, paid[1].price));
  const values = await Promise.allSettled([state.api.purchaseStudentAvatarItem(purchase()), state.api.purchaseStudentAvatarItem(purchase(paid[1], 'purchase-0002'))]);
  assert.equal(values.filter(value => value.status === 'fulfilled').length, 1);
  assert.ok(state.documents.get(accountPath).balance >= 0);
});
test('request ID cannot be reused across items or operations', async () => {
  const state = fixture(); await state.api.purchaseStudentAvatarItem(purchase());
  await assert.rejects(state.api.purchaseStudentAvatarItem(purchase(paid[1])), reason('AVATAR_REQUEST_REUSED'));
  await assert.rejects(state.api.saveStudentAvatar(await save({ requestId: 'purchase-0001', expectedRevision: 1 })), reason('AVATAR_REQUEST_REUSED'));
});
test('insufficient current wallet ignores rich legacy wallet; free item does not change wallet or grant a paid item', async () => {
  const state = fixture(0); await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()), reason('WIS_INSUFFICIENT_BALANCE'));
  const result = await state.api.purchaseStudentAvatarItem(purchase(catalog.items[0]));
  assert.equal(result.charged, 0); assert.equal(state.documents.get(accountPath).revision, 1);
  assert.equal([...state.documents.keys()].some(path => path.startsWith('semester_wis_ledger/')), false);
});
test('free or already-owned items with new request IDs cause zero writes and zero additional receipts', async () => {
  const state = fixture();
  for (let index = 0; index < 5; index++) await state.api.purchaseStudentAvatarItem(purchase(catalog.items[0], `free-${index}-request`));
  assert.equal(state.writes.length, 0);
  await state.api.purchaseStudentAvatarItem(purchase()); const baseline = state.writes.length;
  for (let index = 0; index < 5; index++) await state.api.purchaseStudentAvatarItem(purchase(paid[0], `owned-${index}-request`));
  assert.equal(state.writes.length, baseline);
  assert.equal([...state.documents.keys()].filter(path => path.startsWith(`${avatarPath}/requests/`)).length, 1);
  assert.equal((await state.api.purchaseStudentAvatarItem(purchase())).duplicate, true);
});
test('untrusted price, unknown item, malformed request IDs and cross-user parameters rejected', async () => {
  for (const patch of [{ price: 0 }, { uid: 'other' }, { itemId: 'unknown' }, { requestId: '../evil' }]) {
    const state = fixture(); const input = purchase(); Object.assign(input.data, patch);
    await assert.rejects(state.api.purchaseStudentAvatarItem(input), reason('AVATAR_INPUT_INVALID')); assert.equal(state.writes.length, 0);
  }
});
test('inactive semester, changed pointer, blocked migration, closed economy and missing account reject purchase', async () => {
  for (const [path, patch] of [
    ['site_settings/semester_active', { semesterId: '2026-1' }], ['semester_manifests/2026-2', { readOnly: true }],
    ['semester_wis_economies/2026-2', { status: 'CLOSED' }], ['wis_legacy_migration_controls/2026-2', { writesBlocked: true }],
    ['semester_enrollments/one', { enrollmentStatus: 'INACTIVE' }], [accountPath, { studentUid: 'other' }],
  ]) {
    const state = fixture(); state.documents.set(path, { ...state.documents.get(path), ...patch });
    await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()), error => error.code === 'failed-precondition'); assert.equal(state.writes.length, 0);
  }
  const state = fixture(); state.documents.delete(accountPath); await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()));
});
test('approved-student authority and valid application session precede all writes', async () => {
  for (const patch of [{ role: 'teacher' }, { registrationApprovalStatus: 'PENDING' }, { isDeleted: true }, { weplayDeletionPending: true }]) {
    const state = fixture(); state.documents.set(`users/${uid}`, { ...state.documents.get(`users/${uid}`), ...patch });
    await assert.rejects(state.api.getStudentAvatar(req({})), reason('AVATAR_STUDENT_REQUIRED')); assert.equal(state.writes.length, 0);
  }
  const state = fixture(); state.rejectSession(); await assert.rejects(state.api.getStudentAvatar(req({}))); assert.equal(state.reads.length, 0);
  const other = fixture(); other.sessionActor('foreign'); await assert.rejects(other.api.getStudentAvatar(req({}))); assert.equal(other.reads.length, 0);
});
test('save validates every equipped slot and ownership; girl-only hair cannot be put on boy', async () => {
  const state = fixture();
  const look = { ...defaultLook(), [paid[0].slot]: paid[0].value };
  await assert.rejects(state.api.saveStudentAvatar(await save({ look })), reason('AVATAR_ITEM_NOT_OWNED'));
  await assert.rejects(state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), character: 'boy' } })), reason('AVATAR_INPUT_INVALID'));
  await assert.rejects(state.api.saveStudentAvatar(await save({ look: { ...defaultLook(), top: 'none' } })), reason('AVATAR_INPUT_INVALID'));
  assert.equal(state.bucket.objects.size, 0); assert.equal(state.writes.length, 0);
});
test('save persists only validated public projection and immutable bounded reencoded WebP', async () => {
  const state = fixture(), saved = await state.api.saveStudentAvatar(await save());
  assert.equal(saved.revision, 1); assert.match(saved.thumbnailUrl, /^https:\/\/firebasestorage.googleapis.com\//);
  const projection = state.documents.get(`users/${uid}`).avatar;
  assert.equal(projection.studentUid, undefined); assert.equal(projection.ownedItemIds, undefined); assert.equal(projection.thumbnailPath, undefined);
  assert.deepEqual(sanitizePublicAvatar(projection), projection);
  assert.equal(state.documents.get(`users/${uid}`).untouched, 'kept');
  assert.equal(state.documents.get(accountPath).revision, 1);
  const image = [...state.bucket.objects.values()][0]; const meta = await sharp(image.bytes).metadata();
  assert.equal(meta.format, 'webp'); assert.ok(meta.width <= 384 && meta.height <= 512); assert.ok(image.bytes.length <= 64 * 1024); assert.equal(meta.exif, undefined);
});
test('duplicate save is idempotent; conflicting revision and save burst preserve existing profile', async () => {
  const state = fixture(), input = await save(); const saved = await state.api.saveStudentAvatar(input);
  assert.equal((await state.api.saveStudentAvatar(input)).duplicate, true); assert.equal(state.bucket.objects.size, 1);
  await assert.rejects(state.api.saveStudentAvatar(await save({ requestId: 'save-0000002' })), reason('AVATAR_REVISION_CONFLICT'));
  await assert.rejects(state.api.saveStudentAvatar(await save({ requestId: 'save-0000002', expectedRevision: 1 })), reason('AVATAR_SAVE_RATE_LIMIT'));
  assert.equal(state.documents.get(avatarPath).thumbnailUrl, saved.thumbnailUrl);
});
test('save continues across semester closure while monetary purchase stays gated', async () => {
  const state = fixture(); state.documents.delete(accountPath); state.documents.set('site_settings/semester_active', { semesterId: '2027-1' });
  assert.equal((await state.api.saveStudentAvatar(await save())).revision, 1);
});
test('storage failure preserves the last saved profile; transaction conflict removes only new orphan image', async () => {
  const state = fixture(); state.bucket.fail = true;
  await assert.rejects(state.api.saveStudentAvatar(await save()), reason('AVATAR_STORAGE_UNAVAILABLE'));
  assert.equal(state.documents.has(avatarPath), false);
  state.bucket.fail = false;
  state.bucket.afterSave = async () => { state.documents.set(avatarPath, { schemaVersion: 1, studentUid: uid, revision: 1, look: defaultLook(), lookHash: lookHash(defaultLook()), ownedItemIds: [] }); };
  await assert.rejects(state.api.saveStudentAvatar(await save()), reason('AVATAR_REVISION_CONFLICT')); assert.equal(state.bucket.objects.size, 0);
});
test('old thumbnails are bounded to current and previous after three committed saves', async () => {
  const state = fixture();
  for (let index = 0; index < 3; index++) { state.advance(); await state.api.saveStudentAvatar(await save({ expectedRevision: index, requestId: `save-000000${index}` })); }
  assert.equal(state.bucket.objects.size, 2);
});
test('URL, SVG, malformed, animated and oversized image inputs cannot become public image payloads', async () => {
  for (const value of ['https://evil.test/a.webp', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/webp;base64,YWJj', `data:image/webp;base64,${'A'.repeat(180000)}`]) {
    await assert.rejects(encodeThumbnail(value), reason('AVATAR_INPUT_INVALID'));
  }
  const big = await sharp({ create: { width: 513, height: 512, channels: 3, background: '#fff' } }).webp().toBuffer();
  await assert.rejects(encodeThumbnail(`data:image/webp;base64,${big.toString('base64')}`), reason('AVATAR_INPUT_INVALID'));
  const frames = Buffer.alloc(16 * 32 * 3, 128); frames.fill(255, 16 * 16 * 3);
  const animated = await sharp(frames, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp().toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(encodeThumbnail(`data:image/webp;base64,${animated.toString('base64')}`), reason('AVATAR_INPUT_INVALID'));
});
test('public sanitizer rejects invalid hashes/URLs, unsupported catalog and altered or missing slots', () => {
  const look = defaultLook(), value = { schemaVersion: 1, catalogVersion: catalog.version, look, lookHash: lookHash(look), revision: 1 };
  assert.ok(sanitizePublicAvatar(value)); assert.equal(sanitizePublicAvatar({ ...value, lookHash: 'bad' }), null);
  assert.equal(sanitizePublicAvatar({ ...value, catalogVersion: 999 }), null);
  assert.equal(sanitizePublicAvatar({ ...value, thumbnailUrl: 'javascript:evil' }).thumbnailUrl, undefined);
});
test('ranking preview and full hall reuse existing profile batches and expose only sanitized avatar fields', async () => {
  const { setup, publicId } = require('./verify-wis-ranking-preview.cjs');
  for (const projection of ['ranking-preview', 'hall-index']) {
    const ctx = setup();
    const args = { projection, ...(projection === 'hall-index' ? { uid: 'teacher', audience: 'teacher' } : {}) };
    await ctx.request(args); ctx.store.resetStats(); await ctx.request(args);
    const baselineReads = ctx.store.reads.filter(name => name.startsWith('users/')).length;
    const look = defaultLook(), value = { schemaVersion: 1, catalogVersion: catalog.version, look, lookHash: lookHash(look), revision: 1 };
    ctx.store.patch('users/student-0', { avatar: { ...value, ownedItemIds: ['secret'], studentUid: 'student-0' } });
    ctx.store.resetStats(); const result = await ctx.request(args);
    const entries = Object.values(result.hallOfFame.gradeLeaderboardByGrade).flat();
    const student = entries.find(entry => entry.uid === publicId('2026-2', 'student-0'));
    assert.deepEqual(student.avatar, value);
    assert.equal(ctx.store.reads.filter(name => name.startsWith('users/')).length, baselineReads);
    assert.equal(JSON.stringify(result).includes('ownedItemIds'), false);
    assert.equal(JSON.stringify(result).includes('studentUid'), false);
  }
});
test('student deletion removes only own private avatar tree and own hashed image prefix, including orphans; replay is harmless', async () => {
  const state = fixture(); await state.api.saveStudentAvatar(await save());
  const ownPrefix = `student_avatar_thumbnails/v1/${createHash('sha256').update(uid).digest('hex')}/`;
  state.bucket.objects.set(`${ownPrefix}orphan.webp`, {});
  state.bucket.objects.set('student_avatar_thumbnails/v1/other/image.webp', {});
  state.bucket.objects.set(`${ownPrefix.slice(0, -1)}-neighbor/image.webp`, {});
  state.documents.set('student_avatars/other/requests/private', { keep: true });
  state.documents.delete(`users/${uid}`);
  const cleanup = createStudentAvatarDeletionHandler(state);
  const event = { id: 'deletion-event', params: { uid }, data: { data: () => ({ role: 'student' }) } };
  await cleanup(event); await cleanup(event);
  assert.equal([...state.documents.keys()].some(path => path === avatarPath || path.startsWith(`${avatarPath}/`)), false);
  assert.equal(state.documents.has('student_avatars/other/requests/private'), true);
  assert.equal([...state.bucket.objects.keys()].some(path => path.startsWith(ownPrefix)), false);
  assert.equal(state.bucket.objects.size, 2);
  assert.equal(state.documents.has(`student_avatar_deletions/${uid}`), false);
  assert.equal(state.documents.get(accountPath).balance, 1000);
});
test('deletion ignores teachers and recreated users; failed cleanup keeps a retryable lock and blocks new avatar writes', async () => {
  const state = fixture(); await state.api.saveStudentAvatar(await save());
  const cleanup = createStudentAvatarDeletionHandler(state);
  const event = { id: 'deletion-event', params: { uid }, data: { data: () => ({ role: 'student' }) } };
  await cleanup(event); assert.equal(state.documents.has(avatarPath), true); assert.equal(state.bucket.objects.size, 1);
  state.documents.delete(`users/${uid}`);
  await cleanup({ ...event, data: { data: () => ({ role: 'teacher' }) } }); assert.equal(state.documents.has(avatarPath), true);
  state.bucket.fail = true; await assert.rejects(cleanup(event));
  assert.equal(state.documents.has(`student_avatar_deletions/${uid}`), true);
  state.documents.set(`users/${uid}`, initialDocuments()[`users/${uid}`]);
  await assert.rejects(state.api.getStudentAvatar(req({})), reason('AVATAR_DELETION_PENDING'));
  state.documents.delete(`users/${uid}`); state.bucket.fail = false; await cleanup(event);
  assert.equal(state.documents.has(avatarPath), false); assert.equal(state.documents.has(`student_avatar_deletions/${uid}`), false);
});

}
module.exports = { initialDocuments, memoryBucket, uid, semesterId, accountPath, avatarPath, req, purchase, save, paid };
