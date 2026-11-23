const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const projectId = 'demo-westory-session-wis-stock-trading';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '') || process.env.GCLOUD_PROJECT !== projectId)
  throw new Error('Dedicated local demo-westory-session-wis-stock-trading emulator required. No production access permitted.');
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const sourceDir = process.env.WIS_STOCK_SOURCE_DIR || path.join(__dirname, '..');
const { createWisStockTrading } = require(path.join(sourceDir, 'wisStockTrading'));
const { createWisStockInvestmentHistory } = require(process.env.WIS_STOCK_HISTORY_SOURCE_DIR
  ? path.join(process.env.WIS_STOCK_HISTORY_SOURCE_DIR, 'wisStockInvestmentHistory.js') : '../wisStockInvestmentHistory');
const { accountIdFor } = require('../studentWisWallet');
const { blankMarket, normalizeSettings, createWisStockHandlers } = require(path.join(sourceDir, 'wisStocks'));
const { reconstructWisStockIndex, validWisStockIndex } = require('../wisStockIndex');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const { inspectWisLedger } = require('../wisLedgerIntegrity');
const app = initializeApp({ projectId }), db = getFirestore(app);
const base = 'years/2026/semesters/2', scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const defaultStockId = 'stock_' + 'a'.repeat(24), hash = text => createHash('sha256').update(text).digest('hex');
let stockId = defaultStockId;
const authTime = Math.floor(Date.now() / 1000) - 10, proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'b'.repeat(64) };
let clock = Date.parse('2026-11-16T01:00:00Z'), draw = 60, commits = [], tasks = [], rejected = [];
const observedDb = { doc: value => db.doc(value), collection: value => db.collection(value), collectionGroup: value => db.collectionGroup(value),
  runTransaction: async (callback, options) => {
    const attempts = [];
    try {
      const result = await db.runTransaction(async tx => {
        const attempt = { reads: [], writes: [] }; attempts.push(attempt);
        const proxy = { get: async ref => {
          attempt.reads.push(ref.path || 'query-document');
          const snapshot = await tx.get(ref);
          // Projection/field selection does not reduce document reads. Count
          // query documents, including Firestore's empty-query minimum of one.
          if (!ref.path && snapshot.docs?.length > 1) attempt.reads.push(...Array(snapshot.docs.length - 1).fill('query-document'));
          return snapshot;
        },
          getAll: async (...refs) => { attempt.reads.push(...refs.map(ref => ref.path)); return tx.getAll(...refs); } };
        for (const name of ['set', 'create', 'update', 'delete']) proxy[name] = (ref, ...args) => { attempt.writes.push(ref.path); tx[name](ref, ...args); return proxy; };
        return callback(proxy);
      }, options);
      commits.push({ attempts: attempts.length, reads: attempts.flatMap(row => row.reads).length, finalReads: attempts.at(-1).reads.length,
        finalReadPaths: attempts.at(-1).reads,
        writes: attempts.at(-1).writes }); return result;
    } catch (error) { rejected.push({ code: error.code, reason: error.details?.reason || error.reason || '', attempts: attempts.length,
      reads: attempts.reduce((n, attempt) => n + attempt.reads.length, 0) }); throw error; }
  } };
const api = createWisStockTrading({ db: observedDb, now: () => clock, delaySeconds: () => draw,
  enqueueTask: async (data, options) => { tasks.push({ data, ...options }); } });
const request = (uid, data = {}) => ({ auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime } },
  data: { year: '2026', semester: '2', _session: proof, ...data } });
const get = async key => (await db.doc(key).get()).data();
const acctPath = uid => `${base}/wis_stock_accounts/${accountIdFor(scope.semesterId, uid)}`;
const mainPath = uid => `semester_wis_accounts/${accountIdFor(scope.semesterId, uid)}`;
const sessionPath = uid => `application_sessions/${uid}/sessions/${authTime}`;
const state = uid => api.getStudentWisStockState(request(uid));
const transfer = (uid, direction, amount, requestId = `transfer_${uid}_00000001`) => api.transferStudentWisStock(request(uid, { direction, amount, requestId }));
const place = async (uid, side = 'BUY', quantity = 1, requestId = `order_${uid}_00000000001`, quote) => {
  const market = await get(`${base}/wis_stock_markets/current`);
  return api.placeStudentWisStockOrder(request(uid, { requestId, stockId, side, quantity,
    quote: quote || { price: market.stocks[0].price, atMs: clock, marketRevision: market.revision } }));
};
const settle = orderId => api.settleWisStockOrderTask({ data: { year: '2026', semester: '2', kind: 'ORDER', orderId } });
const errorIs = reason => error => error.details?.reason === reason || error.reason === reason;
const denied = (promise, reason) => assert.rejects(promise, errorIs(reason));
const marketWrite = async update => { const before = await db.doc(`${base}/wis_stock_markets/current`).get();
  await db.doc(`${base}/wis_stock_markets/current`).set(update, { merge: true }); const after = await db.doc(before.ref.path).get();
  return { params: { year: '2026', semester: '2' }, data: { before, after } }; };
async function seed(count = 2, issuedShares = 1000) {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  clock = Date.parse('2026-11-16T01:00:00Z'); draw = 60; commits = []; tasks = []; rejected = [];
  const rules = normalizeWisStockMarketRules({ halted: false, cooldownSeconds: 0, minimumCashReserve: 0, maxConcentrationBps: 10000,
    dailyOrderLimit: 100, dailyBuyLimit: 100000, maxOrderQuantity: 10000, maxHoldingQuantity: 10000 });
  const settings = normalizeSettings({ name: '합성검증종목', description: '', period: '합성검증', initialPrice: 100, minimumPrice: 1,
    maximumPrice: 1000000, volatilityBps: 0, trendBps: 0, intervalHours: 1, automatic: false, issuedShares, lotSize: 1, tradingStatus: 'ACTIVE' });
  const market = { ...blankMarket(scope), revision: 1, studentOpen: true, tradingEpoch: 1, rules,
    stocks: [{ id: stockId, settings, price: 100, updatedAtMs: clock, nextTickAtMs: clock + 3600000, history: [{ atMs: clock, price: 100 }] }] };
  const docs = { 'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/student_maintenance': { enabled: false, blockedRoles: ['student'], bypassUids: [], title: '합성점검', message: '합성검증', revision: 1,
      startedAt: null, updatedAt: Timestamp.fromMillis(clock), updatedBy: 'synthetic-admin' },
    'site_settings/semester_active': { semesterId: scope.semesterId, revision: 1 },
    'semester_manifests/2026-2': { semesterId: scope.semesterId, status: 'ACTIVE', revision: 1 },
    'semester_wis_economies/2026-2': { semesterId: scope.semesterId, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: count * 2 },
    'semester_classes/class-one': { classId: 'class-one', semesterId: scope.semesterId, grade: '3', classNumber: '1', status: 'ACTIVE' },
    [`${base}/wis_stock_markets/current`]: market };
  for (let index = 0; index < count; index++) {
    const uid = `student${index}`, accountId = accountIdFor(scope.semesterId, uid);
    const ledger = [{ ledgerEntryId: `initial_${uid}`, type: 'INITIAL_GRANT', delta: 500, balanceBefore: 0, balanceAfter: 500 },
      { ledgerEntryId: `grant_${uid}`, type: 'GRANT', delta: 9500, balanceBefore: 500, balanceAfter: 10000 }]
      .map(entry => ({ ...entry, accountId, studentUid: uid, semesterId: scope.semesterId, createdAt: Timestamp.fromMillis(clock - 1000) }));
    docs[`users/${uid}`] = { role: 'student', registrationApprovalStatus: 'APPROVED', name: '합성검증' };
    docs[`student_identities/${uid}`] = { studentUid: uid, accountStatus: 'ACTIVE' };
    docs[`semester_enrollment_slots/slot_${hash(scope.semesterId + '\n' + uid).slice(0, 40)}`] = {
      semesterId: scope.semesterId, studentUid: uid, status: 'ACTIVE', activeEnrollmentId: `enrollment-${uid}` };
    docs[`semester_enrollments/enrollment-${uid}`] = { semesterId: scope.semesterId, studentUid: uid, enrollmentId: `enrollment-${uid}`,
      enrollmentStatus: 'ACTIVE', classId: 'class-one' };
    docs[sessionPath(uid)] = { uid, authTime, schemaVersion: 2, status: 'active', authorityGeneration: proof.authorityGeneration,
      protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE',
      generalExpiresAt: Timestamp.fromMillis(Math.max(clock, Date.now()) + 7 * 86400000) };
    const wallet = { schemaVersion: 1, policyVersion: 'w7-v1', semesterId: scope.semesterId, accountId, studentUid: uid,
      enrollmentId: `enrollment-${uid}`, classId: 'class-one', grade: '3', classNumber: '1', studentNumber: String(index + 1), displayName: `합성 ${index + 1}`,
      status: 'ACTIVE', revision: 3, balance: 10000, earnedTotal: 10000, rankEarnedTotal: 9500, spentTotal: 0, adjustedTotal: 9500, recentLedgerEntries: ledger };
    docs[mainPath(uid)] = wallet;
    docs[`semester_wis_balances/${accountId}`] = { ...wallet, ledgerRevision: 3 };
    docs[`semester_wis_rankings/${accountId}`] = { ...wallet, ledgerRevision: 3 };
    for (const entry of ledger) docs[`semester_wis_ledger/${entry.ledgerEntryId}`] = entry;
    docs[`${base}/point_wallets/${uid}`] = { balance: 999999 };
  }
  const batch = db.batch(); for (const [key, value] of Object.entries(docs)) batch.set(db.doc(key), value); await batch.commit();
}
async function accounting(uid) {
  const main = await get(mainPath(uid));
  const ledger = (await db.collection('semester_wis_ledger').where('studentUid', '==', uid).get()).docs.map(doc => doc.data());
  assert.deepEqual(inspectWisLedger(main, ledger).issues, []);
  const balance = await get(`semester_wis_balances/${main.accountId}`), rank = await get(`semester_wis_rankings/${main.accountId}`);
  assert.equal(balance.balance, main.balance); assert.equal(balance.ledgerRevision, main.revision);
  assert.equal(rank.balance, main.balance); assert.equal(rank.rankEarnedTotal, 9500);
  assert.equal((await get(`${base}/point_wallets/${uid}`)).balance, 999999);
  return main;
}
const evidence = [];
async function test(name, fn, count = 2, supply = 1000, instrument = defaultStockId) {
  if (process.env.WIS_STOCK_TRADING_TEST_PATTERN && !name.includes(process.env.WIS_STOCK_TRADING_TEST_PATTERN)) return;
  stockId = instrument;
  await seed(count, supply); const started = Date.now(); await fn();
  evidence.push({ name, elapsedMs: Date.now() - started, transactions: commits.length,
    attemptedReads: commits.reduce((n, c) => n + c.reads, 0) + rejected.reduce((n, c) => n + c.reads, 0),
    committedWrites: commits.reduce((n, c) => n + c.writes.length, 0), maxAttempts: Math.max(0, ...commits.map(c => c.attempts)),
    readWriteBudgets: [...new Set(commits.map(c => `${c.finalReads}/${c.writes.length}`))], rejected });
  console.log(`PASS ${name}`);
}
const { CAMPAIGN_ID, CONFIG_PATH, receiptPath: bonusReceiptPath } = require(path.join(sourceDir, 'wisStockDepositCampaign'));
const enable = () => db.doc(CONFIG_PATH).set({ campaignId: CAMPAIGN_ID, enabled: true });
const bonusState = (uid, instance = api) => instance.getStudentWisStockBonus(request(uid));
const bonus = (uid, instance = api, requestId = `claim_${uid}_00000000001`) => instance.claimStudentWisStockBonus(request(uid, { requestId }));
const secondInstance = () => createWisStockTrading({ db: observedDb, now: () => clock, delaySeconds: () => draw,
  enqueueTask: async (data, options) => tasks.push({ data, ...options }) });
const gradTask = data => api.settleWisStockOrderTask({ data: { ...scope, kind: 'GRADUATION', stockId, ...data } });
async function graduate() {
  await db.doc('users/syntheticTeacher').set({ role: 'teacher', registrationApprovalStatus: 'APPROVED' });
  const management = createWisStockHandlers({ db: observedDb, now: () => clock, assertSession: async req => ({ uid: req.auth.uid }) });
  const market = await get(`${base}/wis_stock_markets/current`);
  const req = request('syntheticTeacher', { requestId: 'graduate_synthetic_000001', expectedRevision: market.revision,
    stockId, settings: { ...market.stocks[0].settings, tradingStatus: 'GRADUATED' } });
  const result = await management.saveWisStock(req);
  assert.equal(result.stocks[0].settings.tradingStatus, 'GRADUATED');
  assert.equal((await get(`${base}/wis_stock_markets/current`)).stocks[0].graduation.unitPrice, market.stocks[0].price);
  assert.equal((await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`)).unitPrice, market.stocks[0].price);
  assert.equal((await management.saveWisStock(req)).duplicate, true);
  await denied(management.saveWisStock(request('syntheticTeacher', { ...req.data, requestId: 'graduate_synthetic_000002',
    expectedRevision: result.revision, settings: { ...req.data.settings, tradingStatus: 'ACTIVE' } })), 'WIS_STOCK_GRADUATED');
}
function legacyTradingFactory() {
  // Pin the pre-change production baseline. Exercise its strict catalog-plan
  // reader and original graduation worker against the additive new metadata.
  const revision = '139ad72f4f67cc826a6579922c91b80ac9a2ac65';
  const originals = new Set(['./wisStocks', './wisStockCatalogSchedule', './wisStockTrading', './wisStockGraduation']);
  const cache = new Map(), nativeRequire = createRequire(path.join(__dirname, '../wisStockTrading.js'));
  const load = name => {
    if (!originals.has(name)) return nativeRequire(name);
    if (cache.has(name)) return cache.get(name).exports;
    const file = name.slice(2) + '.js';
    const source = execFileSync('git', ['show', `${revision}:functions/${file}`], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
    const module = { exports: {} }; cache.set(name, module);
    new Function('require', 'module', 'exports', '__filename', '__dirname', source)(load, module, module.exports,
      path.join(__dirname, '..', file), path.join(__dirname, '..'));
    return module.exports;
  };
  return load('./wisStockTrading').createWisStockTrading;
}
(async () => { try {
  await test('499 is ineligible and split 500 deposits require an explicit one-time restricted claim', async () => {
    await enable();
    assert.equal((await transfer('student0', 'DEPOSIT', 499)).bonusAmount, 0);
    assert(!commits.at(-1).finalReadPaths.some(value => value === CONFIG_PATH || value.includes('wis_stock_campaign_receipts') || value === 'query-document'));
    assert.deepEqual(await bonusState('student0'), { campaignId: CAMPAIGN_ID, threshold: 500, amount: 500, status: 'INELIGIBLE', qualifyingDepositAmount: 499 });
    assert.equal(commits.at(-1).writes.length, 0);
    await denied(bonus('student0'), 'WIS_STOCK_CAMPAIGN_INELIGIBLE');
    clock += 86400001;
    const deposit = await transfer('student0', 'DEPOSIT', 1, 'transfer_student0_00000002');
    assert.equal(deposit.bonusAmount, 0); assert.equal(deposit.state.account.stockCash, 500);
    assert.equal(await get(bonusReceiptPath('student0')), undefined);
    assert.deepEqual(await bonusState('student0'), { campaignId: CAMPAIGN_ID, threshold: 500, amount: 500, status: 'ELIGIBLE', qualifyingDepositAmount: 500 });
    const second = await bonus('student0');
    assert.equal(second.depositBonus.status, 'CLAIMED'); assert.equal(second.state.account.stockCash, 1000);
    assert.equal(second.state.account.outstandingPrincipal, 500);
    assert.equal(second.state.account.eventBonusRestrictedCash, 500);
    assert.equal(second.state.funding.maximumWithdrawal, 500);
    assert.equal(commits.at(-1).finalReads, 21); assert.equal(commits.at(-1).writes.length, 6);
    const replay = await bonus('student0');
    assert.equal(replay.duplicate, true); assert.equal(commits.at(-1).writes.length, 0);
    assert.equal(commits.at(-1).finalReads, 17);
    assert.equal((await bonus('student0', api, 'claim_another_request_0001')).duplicate, true);
    const history = (await db.collection(`${base}/wis_stock_history`).where('accountId', '==', second.state.account.accountId).get()).docs.map(d => d.data());
    assert.equal(history.filter(row => row.kind === 'EVENT_BONUS').length, 1);
    assert.equal(new Set(history.map(row => row.sequence)).size, history.length);
    await denied(transfer('student0', 'WITHDRAW', 1000, 'withdraw_student0_00000001'), 'WIS_STOCK_WITHDRAWAL_LIMIT');
    const withdrawn = await transfer('student0', 'WITHDRAW', 500, 'withdraw_student0_00000001');
    assert.equal(withdrawn.receipt.withdrawnProfit, 0);
    const main = await accounting('student0'); assert.equal(main.balance, 10000); assert.equal(main.earnedTotal, 10000);
    assert.equal((await get(bonusReceiptPath('student0'))).amount, 500);
    clock += 86400001;
    assert.equal((await transfer('student0', 'DEPOSIT', 500, 'transfer_student0_00000003')).bonusAmount, 0);
  });
  await test('historic 500 deposits after withdrawal qualify; disabled, failure retry and concurrent claims never double-pay', async () => {
    await transfer('student0', 'DEPOSIT', 500);
    await transfer('student0', 'WITHDRAW', 500, 'withdraw_student0_00000001');
    assert.equal((await bonusState('student0')).status, 'DISABLED'); assert.equal(commits.at(-1).writes.length, 0);
    assert.equal(commits.at(-1).finalReads, 17);
    await denied(bonus('student0'), 'WIS_STOCK_CAMPAIGN_DISABLED');
    assert.equal(await get(bonusReceiptPath('student0')), undefined);
    await enable();
    assert.equal((await bonusState('student0')).status, 'ELIGIBLE'); assert.equal(commits.at(-1).finalReads, 18);
    const broken = createWisStockTrading({ db: { ...observedDb, runTransaction: (cb, options) => observedDb.runTransaction(tx => cb({ ...tx,
      create(ref, value) { if (ref.path === bonusReceiptPath('student0')) throw new Error('SYNTHETIC_COMMIT_FAILURE'); return tx.create(ref, value); } }), options) }, now: () => clock });
    await assert.rejects(bonus('student0', broken), /SYNTHETIC_COMMIT_FAILURE/);
    assert.equal((await get(acctPath('student0'))).stockCash, 0); assert.equal(await get(bonusReceiptPath('student0')), undefined);
    const results = await Promise.all([bonus('student0'), bonus('student0', secondInstance(), 'claim_concurrent_request_01')]);
    assert.equal(results.filter(r => r.changed).length, 1);
    assert.equal((await get(acctPath('student0'))).stockCash, 500);
    assert.equal((await get(acctPath('student0'))).outstandingPrincipal, 0);
    assert.equal((await accounting('student0')).balance, 10000);
    assert.equal((await bonus('student0')).changed, false); assert.equal(commits.at(-1).writes.length, 0);
    await db.doc(CONFIG_PATH).update({ enabled: false });
    assert.equal((await bonusState('student0')).status, 'CLAIMED'); assert.equal(commits.at(-1).finalReads, 17);
    const before = commits.length;
    await denied(api.grantWisStockDepositBonus({ ...scope, uid: 'student0', dryRun: false }), 'WIS_STOCK_BONUS_CLAIM_REQUIRED');
    await denied(api.grantWisStockDepositBonus({ ...scope, uid: 'student0', dryRun: true }), 'WIS_STOCK_BONUS_CLAIM_REQUIRED');
    assert.equal(commits.length, before);
  });
  await test('prior semester deposits count and another identity is excluded', async () => {
    await transfer('student0', 'DEPOSIT', 1);
    await db.doc('years/2026/semesters/1/wis_stock_history/synthetic_older_deposit').set({ studentUid: 'student0', kind: 'DEPOSIT',
      amount: 499, stockCashDelta: 499, mainCashDelta: -499 });
    await enable();
    assert.equal((await bonus('student0')).changed, true);
    assert.equal((await bonusState('student1')).status, 'INELIGIBLE');
    assert.equal((await get(acctPath('student0'))).stockCash, 501);
  });
  await test('prior eligible depositor with no current stock account receives a new current account', async () => {
    await db.doc('years/2026/semesters/1/wis_stock_history/synthetic_older_deposit').set({ studentUid: 'student0', kind: 'DEPOSIT',
      amount: 500, stockCashDelta: 500, mainCashDelta: -500 });
    assert.equal(await get(acctPath('student0')), undefined);
    await enable();
    assert.equal((await bonusState('student0')).status, 'ELIGIBLE'); assert.equal(await get(acctPath('student0')), undefined);
    assert.equal((await bonus('student0')).changed, true);
    assert.equal((await get(acctPath('student0'))).stockCash, 500);
    assert.equal((await get(acctPath('student0'))).outstandingPrincipal, 0);
    assert.equal((await accounting('student0')).balance, 10000);
  });
  await test('historical automatic receipts survive semester changes and prevent a new claim or account creation', async () => {
    await db.doc(bonusReceiptPath('student0')).set({ schemaVersion: 1, campaignId: CAMPAIGN_ID, studentUid: 'student0',
      accountId: accountIdFor('2026-1', 'student0'), semesterId: '2026-1', threshold: 500, amount: 500, status: 'APPLIED' });
    await enable();
    const before = await accounting('student0');
    assert.equal((await bonusState('student0')).status, 'CLAIMED');
    assert.equal(commits.at(-1).finalReads, 17); assert.equal(commits.at(-1).writes.length, 0);
    assert.equal((await bonus('student0')).duplicate, true); assert.equal(commits.at(-1).writes.length, 0);
    assert.equal((await bonus('student0', api, 'claim_another_semester_01')).duplicate, true);
    assert.equal(await get(acctPath('student0')), undefined);
    assert.equal((await db.collection(`${base}/wis_stock_history`).get()).size, 0);
    assert.deepEqual(await accounting('student0'), before);
  });
  await test('bonus status and claims retain session, identity, active-semester, roster, maintenance and input boundaries', async () => {
    await enable(); await transfer('student0', 'DEPOSIT', 500);
    const before = await get(acctPath('student0')), beforeMain = await accounting('student0');
    for (const [target, patch] of [
      ['users/student0', { role: 'teacher' }], ['users/student0', { disabled: true }],
      ['users/student0', { registrationApprovalStatus: 'PENDING' }], ['users/student0', { deletedAt: Timestamp.now() }],
      ['student_identities/student0', { accountStatus: 'CLOSED' }],
      ['semester_enrollment_slots/slot_' + hash(scope.semesterId + '\nstudent0').slice(0, 40), { activeEnrollmentId: 'another-enrollment' }],
      ['semester_enrollments/enrollment-student0', { enrollmentStatus: 'CLOSED' }],
      ['semester_classes/class-one', { readOnly: true }], [mainPath('student0'), { studentUid: 'student1' }],
      ['site_settings/semester_active', { semesterId: '2027-1' }], ['semester_manifests/2026-2', { revision: 2 }],
      ['semester_wis_economies/2026-2', { readOnly: true }], ['site_settings/config', { semester: '1' }],
      [sessionPath('student0'), { status: 'closed' }], [sessionPath('student0'), { generalExpiresAt: Timestamp.fromMillis(1) }],
      ['site_settings/student_maintenance', { enabled: true, startedAt: Timestamp.fromMillis(clock) }],
    ]) {
      const original = await get(target), committedBefore = commits.length;
      await db.doc(target).set({ ...original, ...patch });
      await assert.rejects(bonusState('student0')); await assert.rejects(bonus('student0'));
      assert.equal(commits.length, committedBefore); await db.doc(target).set(original);
    }
    for (const invalid of [
      { ...request('student0'), auth: undefined },
      request('student0', { year: '2025' }), request('student0', { studentUid: 'student1' }),
      request('student0', { _session: { ...proof, revision: 'c'.repeat(64) } }),
    ]) {
      await assert.rejects(api.getStudentWisStockBonus(invalid));
      await assert.rejects(api.claimStudentWisStockBonus({ ...invalid, data: { ...invalid.data, requestId: 'claim_forbidden_000001' } }));
    }
    await denied(api.claimStudentWisStockBonus(request('student0', { requestId: 'short' })), 'WIS_STOCK_INPUT_INVALID');
    const market = await get(`${base}/wis_stock_markets/current`);
    await db.doc(`${base}/wis_stock_markets/current`).set({ ...market, rules: { ...market.rules, halted: true } });
    assert.equal((await bonusState('student0')).status, 'ELIGIBLE');
    await denied(bonus('student0'), 'WIS_STOCK_MARKET_CLOSED');
    await db.doc(`${base}/wis_stock_markets/current`).set(market);
    await db.doc('site_settings/config').update({ studentMenuVisibility: { wispi: false } });
    assert.equal((await bonusState('student0')).status, 'ELIGIBLE'); await assert.rejects(bonus('student0'));
    await db.doc('site_settings/config').update({ studentMenuVisibility: { wispi: true } });
    assert.deepEqual(await get(acctPath('student0')), before); assert.deepEqual(await accounting('student0'), beforeMain);
    assert.equal(await get(bonusReceiptPath('student0')), undefined);
    assert.equal((await bonus('student0')).changed, true);
  });
  await test('live deposit racing an explicit claim credits one bonus only', async () => {
    await transfer('student0', 'DEPOSIT', 500); clock += 86400001; await enable();
    await Promise.all([bonus('student0', secondInstance()), transfer('student0', 'DEPOSIT', 100, 'transfer_student0_00000002')]);
    assert.equal((await get(acctPath('student0'))).stockCash, 1100);
    assert.equal((await get(acctPath('student0'))).eventBonusTotal, 500);
    assert.equal((await accounting('student0')).balance, 9400);
    assert.equal((await db.collection('wis_stock_campaign_receipts').get()).size, 1);
  });
  await test('restricted support orders settle from persisted lots and only profit leaves the stock wallet', async () => {
    await enable(); await transfer('student0', 'DEPOSIT', 1000); await bonus('student0');
    const buy = await place('student0', 'BUY', 5); assert.equal(buy.state.account.eventBonusReservedCash, 500);
    clock += 60001; await settle(buy.order.id);
    const market = await get(`${base}/wis_stock_markets/current`); market.stocks[0].price = 120; market.revision++;
    await db.doc(`${base}/wis_stock_markets/current`).set(market);
    const sell = await place('student0', 'SELL', 5, 'sell_support_profit_0001');
    clock += 60001; await settle(sell.order.id);
    const refreshed = await state('student0'); assert.equal(refreshed.account.eventBonusRestrictedCash, 500);
    assert.equal(refreshed.funding.maximumWithdrawal, 1089);
    const withdrawn = await transfer('student0', 'WITHDRAW', 1089, 'withdraw_support_profit_01');
    assert.equal(withdrawn.receipt.principalReturned, 1000); assert.equal(withdrawn.receipt.withdrawnProfit, 89);
    assert.equal(withdrawn.state.account.stockCash, 500); assert.equal(withdrawn.state.funding.maximumWithdrawal, 0);
    assert.equal((await transfer('student0', 'WITHDRAW', 1089, 'withdraw_support_profit_01')).duplicate, true);
    await denied(transfer('student0', 'WITHDRAW', 1, 'withdraw_support_block_01'), 'WIS_STOCK_WITHDRAWAL_LIMIT');
    const main = await accounting('student0'); assert.equal(main.balance, 10089); assert.equal(main.earnedTotal, 10089);
  });
  await test('legacy campaign migration is scoped, fail-closed, digest checked and idempotent without cash movement', async () => {
    await enable(); await transfer('student0', 'DEPOSIT', 500); await bonus('student0');
    const legacy = await get(acctPath('student0')); legacy.schemaVersion = 1; legacy.outstandingPrincipal = 1000;
    for (const field of ['eventBonusRestrictionVersion', 'eventBonusRestrictedCash', 'eventBonusReservedCash',
      'eventBonusLossCarryforward', 'eventBonusLegacyWithdrawn']) delete legacy[field];
    await db.doc(acctPath('student0')).set(legacy);
    assert.equal((await state('student0')).funding.maximumWithdrawal, 0);
    await denied(transfer('student0', 'WITHDRAW', 1, 'migration_withdraw_block_01'), 'WIS_STOCK_BONUS_RESTRICTION_PENDING');
    await denied(place('student0', 'BUY', 1, 'migration_order_block_0001'), 'WIS_STOCK_BONUS_RESTRICTION_PENDING');
    const inputs = { ...scope, uid: 'student0' }, plan = await api.migrateWisStockBonusRestriction(inputs);
    assert.equal(plan.eligible, true); assert.equal(plan.restrictedCash, 500); assert.equal(plan.principalCorrection, -500);
    assert.equal(commits.at(-1).writes.length, 0);
    await denied(api.migrateWisStockBonusRestriction({ ...inputs, dryRun: false, expectedDigest: '0'.repeat(64) }), 'WIS_STOCK_BONUS_MIGRATION_CHANGED');
    const beforeMain = await accounting('student0');
    assert.equal((await api.migrateWisStockBonusRestriction({ ...inputs, dryRun: false, expectedDigest: plan.digest })).changed, true);
    assert.deepEqual(await accounting('student0'), beforeMain);
    const migrated = await state('student0'); assert.equal(migrated.account.stockCash, 1000);
    assert.equal(migrated.account.outstandingPrincipal, 500); assert.equal(migrated.funding.maximumWithdrawal, 500);
    assert.equal((await api.migrateWisStockBonusRestriction({ ...inputs, dryRun: false, expectedDigest: plan.digest })).duplicate, true);
    assert.equal(commits.at(-1).writes.length, 0);
  });
  await test('restricted mixed lots cancel and fill in reverse without duplicate principal release', async () => {
    await enable(); await transfer('student0', 'DEPOSIT', 1000); await bonus('student0');
    const first = await place('student0', 'BUY', 3, 'support_buy_first_00001');
    const second = await place('student0', 'BUY', 2, 'support_buy_second_0001');
    clock += 60001; await settle(second.order.id); await settle(first.order.id);
    const s1 = await place('student0', 'SELL', 1, 'support_sell_first_0001');
    const s2 = await place('student0', 'SELL', 1, 'support_sell_second_001');
    const s3 = await place('student0', 'SELL', 3, 'support_sell_third_0001');
    await api.cancelStudentWisStockOrder(request('student0', { orderId: s2.order.id }));
    clock += 60001; await settle(s3.order.id); await settle(s1.order.id);
    const last = await place('student0', 'SELL', 1, 'support_sell_final_0001'); clock += 60001; await settle(last.order.id);
    const account = await get(acctPath('student0'));
    assert.equal(account.positions[stockId], undefined); assert.equal(account.reservedCash, 0);
    assert.equal(account.eventBonusRestrictedCash + account.eventBonusLossCarryforward, 500);
    const before = structuredClone(account); await settle(last.order.id); assert.deepEqual(await get(acctPath('student0')), before);
  });
  await test('graduation returns support principal with losses retained and personal cash withdrawable', async () => {
    await enable(); await transfer('student0', 'DEPOSIT', 1000); await bonus('student0');
    const buy = await place('student0', 'BUY', 5); clock += 60001; await settle(buy.order.id);
    const pending = await place('student0', 'SELL', 2, 'support_grad_pending_001'); await graduate(); await gradTask({});
    const account = await get(acctPath('student0'));
    assert.equal(account.positions[stockId], undefined); assert.equal(account.eventBonusRestrictedCash, 496);
    assert.equal(account.eventBonusLossCarryforward, 4); assert.equal((await state('student0')).funding.maximumWithdrawal, 999);
    assert.equal((await get(`${base}/wis_stock_orders/${pending.order.id}`)).status, 'CANCELLED');
    const before = structuredClone(account); await gradTask({}); assert.deepEqual(await get(acctPath('student0')), before);
  });
  await test('scheduled exits defer past dates and atomically feed the unchanged production graduation worker', async () => {
    const catalog = require('../wisStockCatalog.json'), { catalogExitAtMs } = require('../wisStockCatalogTimeline');
    const start = Date.parse('2026-11-16T00:00:00Z');
    await transfer('student0', 'DEPOSIT', 5000);
    const buy = await place('student0', 'BUY', 10); clock += 60001; await settle(buy.order.id);
    const sell = await place('student0', 'SELL', 2, 'scheduled_sell_reserve01');
    const pendingBuy = await place('student0', 'BUY', 3, 'scheduled_buy_reserve001');
    clock = Date.parse('2026-11-23T12:00:00Z'); // Activation outside the market session.
    const market = await get(`${base}/wis_stock_markets/current`);
    market.catalogPlan = { version: 1, startsAtMs: start }; market.rules.automaticPrices = false;
    market.stocks[0].price = 123; market.stocks[0].history.push({ atMs: clock, price: 123 });
    market.stocks[0].updatedAtMs = clock; market.updatedAtMs = clock;
    await db.doc(`${base}/wis_stock_markets/current`).set(market);
    await db.doc('users/syntheticTeacher').set({ role: 'teacher', registrationApprovalStatus: 'APPROVED' });
    const managementOptions = { db: observedDb, now: () => clock, assertSession: async req => ({ uid: req.auth.uid }) };
    const management = createWisStockHandlers(managementOptions);
    const exitOverrides = Object.fromEntries(catalog.filter(entry => entry.exitKind !== 'survive'
      && catalogExitAtMs(entry, market.catalogPlan) <= clock).map(entry =>
      [entry.id, catalogExitAtMs(entry, market.catalogPlan) + 4 * 86400000]));
    const command = request('syntheticTeacher', { requestId: 'scheduled_exit_activate01', expectedRevision: market.revision, exitOverrides });
    const accountBefore = await get(acctPath('student0'));
    const activated = await management.activateWisStockCatalogExits(command);
    assert.equal(activated.stocks[0].settings.tradingStatus, 'ACTIVE');
    assert.deepEqual(await get(acctPath('student0')), accountBefore);
    assert.equal(await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`), undefined);
    const legacy = legacyTradingFactory()({ db: observedDb, now: () => clock, delaySeconds: () => draw,
      enqueueTask: async (data, options) => tasks.push({ data, ...options }) });
    assert.equal((await legacy.getStudentWisStockState(request('student0'))).stocks[0].settings.tradingStatus, 'ACTIVE');
    clock = Date.parse('2026-11-24T02:00:00Z');
    const original = await get(`${base}/wis_stock_markets/current`);
    const broken = createWisStockHandlers({ ...managementOptions, db: { ...observedDb,
      runTransaction: (cb, options) => observedDb.runTransaction(tx => cb({ ...tx, create(ref, value) {
        if (ref.path.startsWith('wis_stock_graduations/')) throw new Error('SYNTHETIC_SCHEDULE_COMMIT_FAILURE');
        return tx.create(ref, value);
      } }), options) } });
    await assert.rejects(broken.advanceWisStockPrices(), /SYNTHETIC_SCHEDULE_COMMIT_FAILURE/);
    assert.deepEqual(await get(`${base}/wis_stock_markets/current`), original);
    assert.equal(await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`), undefined);
    const results = await Promise.all(Array.from({ length: 4 }, () => management.advanceWisStockPrices()));
    assert.equal(results.filter(result => result.changed).length, 1);
    const ended = await get(`${base}/wis_stock_markets/current`), instrument = ended.stocks.find(item => item.id === stockId);
    assert.equal(instrument.price, 123); assert.equal(instrument.settings.tradingStatus, 'GRADUATED');
    assert.equal(instrument.graduation.plannedAtMs, exitOverrides[stockId]);
    assert.deepEqual(ended.catalogPlan, market.catalogPlan);
    const job = await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`);
    assert.equal(job.unitPrice, 123); assert.equal(job.status, 'PENDING');
    const worker = () => legacy.settleWisStockOrderTask({ data: { ...scope, kind: 'GRADUATION', stockId } });
    await Promise.all([worker(), worker()]);
    const account = await get(acctPath('student0'));
    assert.equal(account.stockCash, 5220); assert.equal(account.positions[stockId], undefined);
    assert.equal(account.reservedCash, 0); assert.equal(Object.keys(account.pendingOrders).length, 0);
    assert.equal((await get(`${base}/wis_stock_orders/${sell.order.id}`)).cancellationReason, 'STOCK_GRADUATED');
    assert.equal((await get(`${base}/wis_stock_orders/${pendingBuy.order.id}`)).status, 'CANCELLED');
    assert.equal((await db.collection(`${base}/wis_stock_graduation_receipts`).get()).size, 1);
    await worker(); assert.deepEqual(await get(acctPath('student0')), account);
    assert.equal((await accounting('student0')).balance, 5000);
  }, 2, 1000, require('../wisStockCatalog.json').find(entry => entry.name === '비파메탈').id);
  await test('graduation cancels reservations and liquidates the final price exactly once', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    const buy = await place('student0', 'BUY', 10); clock += 60001; await settle(buy.order.id);
    const sell = await place('student0', 'SELL', 2, 'sell_student0_00000001');
    const pendingBuy = await place('student0', 'BUY', 3, 'buy_student0_00000002');
    const market = await get(`${base}/wis_stock_markets/current`); market.stocks[0].price = 123;
    market.stocks[0].history.push({ atMs: clock, price: 123 }); market.revision++;
    await db.doc(`${base}/wis_stock_markets/current`).set(market);
    await graduate();
    await denied(place('student0', 'BUY', 1, 'buy_student0_graduated'), 'WIS_STOCK_GRADUATED');
    const results = await Promise.all([gradTask({}), secondInstance().settleWisStockOrderTask({ data: { ...scope, kind: 'GRADUATION', stockId } })]);
    assert.equal(results.reduce((n, r) => n + (r.changed || 0), 0), 1);
    const account = await get(acctPath('student0'));
    assert.equal(account.stockCash, 5220); assert.equal(account.positions[stockId], undefined);
    assert.equal(account.reservedCash, 0); assert.equal(Object.keys(account.pendingOrders).length, 0);
    assert.equal(account.cumulativeRealizedPnl, 220); assert.equal(account.outstandingPrincipal, 5000);
    assert.equal((await get(`${base}/wis_stock_orders/${sell.order.id}`)).cancellationReason, 'STOCK_GRADUATED');
    assert.equal((await get(`${base}/wis_stock_orders/${pendingBuy.order.id}`)).status, 'CANCELLED');
    const frozen = await get(`${base}/wis_stock_markets/current`);
    frozen.stocks[0].settings.automatic = true; frozen.stocks[0].nextTickAtMs = 0;
    assert.equal(require(path.join(sourceDir, 'wisStocks')).advanceMarket(frozen, clock + 3600000), frozen);
    const supply = await get(`${base}/wis_stock_supplies/${stockId}`);
    assert.equal(supply.availableShares, 1000); assert.equal(supply.reservedBuyQuantity, 0); assert.deepEqual(supply.holders, {});
    const receipts = await db.collection(`${base}/wis_stock_graduation_receipts`).get(); assert.equal(receipts.size, 1);
    assert.equal(receipts.docs[0].data().cashCredit, 1230);
    const fills = await db.collection(`${base}/wis_stock_history`).where('kind', '==', 'ORDER_FILLED').get();
    assert.equal(fills.docs.filter(d => d.data().automaticSettlement === 'GRADUATION').length, 1);
    assert.equal((await accounting('student0')).balance, 5000);
    await settle(sell.order.id); assert.equal(commits.at(-1).writes.length, 0);
    assert.equal((await gradTask({})).complete, true);
    const board = await get(`${base}/wis_stock_investment_boards/all`);
    assert.equal(board.totals.holdingValue, 0); assert.equal(board.totals.stockCash, account.stockCash);
  });
  await test('failed graduation commit rolls back money and reservations and retries from durable job', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    const buy = await place('student0', 'BUY', 1); clock += 60001; await settle(buy.order.id);
    const before = await get(acctPath('student0')); await graduate();
    const broken = createWisStockTrading({ db: { ...observedDb, runTransaction: (cb, options) => observedDb.runTransaction(tx => cb({ ...tx,
      create(ref, value) { if (ref.path.includes('/wis_stock_graduation_receipts/')) throw new Error('SYNTHETIC_GRADUATION_COMMIT_FAILURE'); return tx.create(ref, value); } }), options) }, now: () => clock });
    await assert.rejects(broken.settleWisStockOrderTask({ data: { ...scope, kind: 'GRADUATION', stockId } }), /Graduation retry required/);
    assert.deepEqual(await get(acctPath('student0')), before);
    assert.equal((await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`)).status, 'PENDING');
    await gradTask({}); assert.equal((await get(acctPath('student0'))).stockCash, 4999);
    assert.equal((await db.collection(`${base}/wis_stock_graduation_receipts`).get()).size, 1);
  });
  await test('buy-only reservation cancels on its task and graduation completion waits for release', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    const buy = await place('student0', 'BUY', 1); await graduate();
    await gradTask({});
    assert.equal((await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`)).status, 'PENDING');
    const result = await settle(buy.order.id); assert.equal(result.order.cancellationReason, 'STOCK_GRADUATED');
    assert.equal((await get(acctPath('student0'))).stockCash, 5000); assert.equal((await get(acctPath('student0'))).reservedCash, 0);
    await gradTask({}); assert.equal((await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`)).status, 'COMPLETE');
  });
  await test('graduation cursor visits all holders and recovery survives trigger loss', async () => {
    for (let i = 0; i < 12; i++) {
      await transfer(`student${i}`, 'DEPOSIT', 500);
      const order = await place(`student${i}`, 'BUY', 1, `order_student${i}_00000001`);
      clock += 60001; await settle(order.order.id);
    }
    await graduate(); tasks = [];
    await api.recoverWisStockOrders(); assert.equal(tasks.filter(t => t.data.kind === 'GRADUATION').length, 1);
    const initial = tasks.shift(); await gradTask(initial.data);
    const continuation = tasks.find(t => t.data.kind === 'GRADUATION'); assert.ok(continuation?.data.after);
    await gradTask(continuation.data);
    assert.equal((await db.collection(`${base}/wis_stock_graduation_receipts`).get()).size, 12);
    for (let i = 0; i < 12; i++) assert.equal((await get(acctPath(`student${i}`))).stockCash, 499);
    assert.equal((await get(`wis_stock_graduations/${scope.semesterId}_${stockId}`)).status, 'COMPLETE');
  }, 12);
  const evidenceDir = process.env.WIS_STOCK_TRADING_EVIDENCE_DIR;
  if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, 'graduation-event-integration.json'),
    JSON.stringify({ projectId, groups: evidence.length, budgetScope: 'Transaction query docs counted individually; empty query one. Successful callable session/maintenance guard adds three reads outside the transaction. Worker selection/fixture reads excluded.', evidence }, null, 2)); }
  console.log(`PASS ${evidence.length} graduation/event integration groups`);
} finally { await deleteApp(app); } })().catch(error => { console.error(error); process.exitCode = 1; });
