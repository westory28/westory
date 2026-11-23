const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
const { createWisStockTrading } = require(process.env.WIS_STOCK_DISPLAY_SOURCE_DIR
  ? path.join(process.env.WIS_STOCK_DISPLAY_SOURCE_DIR, 'wisStockTrading') : '../wisStockTrading');
const { createWisStockInvestmentHistory } = require(process.env.WIS_STOCK_HISTORY_SOURCE_DIR
  ? path.join(process.env.WIS_STOCK_HISTORY_SOURCE_DIR, 'wisStockInvestmentHistory.js') : '../wisStockInvestmentHistory');
const { accountIdFor } = require('../studentWisWallet');
const { blankMarket, normalizeSettings, createWisStockHandlers } = require('../wisStocks');
const { reconstructWisStockIndex, validWisStockIndex } = require('../wisStockIndex');
const { normalizeWisStockMarketRules } = require('../wisStockMarketRules');
const { inspectWisLedger } = require('../wisLedgerIntegrity');
const app = initializeApp({ projectId }), db = getFirestore(app);
const base = 'years/2026/semesters/2', scope = { year: '2026', semester: '2', semesterId: '2026-2' };
const stockId = 'stock_' + 'a'.repeat(24), hash = text => createHash('sha256').update(text).digest('hex');
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
async function test(name, fn, count = 2, supply = 1000) {
  if (process.env.WIS_STOCK_TRADING_TEST_PATTERN && !name.includes(process.env.WIS_STOCK_TRADING_TEST_PATTERN)) return;
  await seed(count, supply); const started = Date.now(); await fn();
  evidence.push({ name, elapsedMs: Date.now() - started, transactions: commits.length,
    attemptedReads: commits.reduce((n, c) => n + c.reads, 0) + rejected.reduce((n, c) => n + c.reads, 0),
    committedWrites: commits.reduce((n, c) => n + c.writes.length, 0), maxAttempts: Math.max(0, ...commits.map(c => c.attempts)),
    readWriteBudgets: [...new Set(commits.map(c => `${c.finalReads}/${c.writes.length}`))], rejected });
  console.log(`PASS ${name}`);
}
(async () => { try {
  await test('teacher investment history reconstructs only selected filled ledger with no writes and current authority', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    await transfer('student1', 'DEPOSIT', 5000);
    const first = await place('student0', 'BUY', 2), unrelated = await place('student1', 'BUY', 1);
    clock += 60001; await settle(first.order.id); await settle(unrelated.order.id);
    const teacher = 'historyTeacher', key = `student_${hash('student0').slice(0, 24)}`;
    await db.doc(`users/${teacher}`).set({ role: 'teacher', registrationApprovalStatus: 'APPROVED' });
    await db.doc(sessionPath(teacher)).set({ ...(await get(sessionPath('student0'))), uid: teacher });
    const historyApi = createWisStockInvestmentHistory({ db: observedDb, now: () => clock });
    const read = (uid = teacher, extra = {}) => historyApi(request(uid, { studentKey: key, grade: '', classNumber: '', ...extra }));
    const historyStart = commits.length;
    const baseline = await read();
    assert.equal(baseline.studentKey, key); assert.equal(baseline.sourceRevision, 3);
    assert.deepEqual(baseline.points.at(-1), { atMs: clock, holdingValue: 200, holdingCostBasis: 202 });
    assert.equal(commits.at(-1).finalReads, 10); assert.equal(commits.at(-1).writes.length, 0);
    const beforeRetry = commits.length; assert.deepEqual(await read(), baseline);
    assert.equal(commits.length, beforeRetry + 1); assert.equal(commits.at(-1).writes.length, 0);
    assert.deepEqual((await read(teacher, { grade: '3', classNumber: '1' })).points, baseline.points);
    await denied(read(teacher, { grade: '3', classNumber: '2' }), 'WIS_STOCK_INVESTMENT_STUDENT_UNAVAILABLE');
    await denied(read('student0'), 'WIS_STOCK_TEACHER_REQUIRED');
    await db.doc(`users/${teacher}`).update({ role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] });
    assert.deepEqual((await read()).points, baseline.points);
    await db.doc(`users/${teacher}`).update({ staffPermissions: [] });
    await denied(read(), 'WIS_STOCK_TEACHER_REQUIRED');
    await db.doc(`users/${teacher}`).update({ role: 'teacher' });
    await db.doc(`users/${teacher}`).update({ registrationApprovalStatus: 'PENDING' });
    await denied(read(), 'STUDENT_REGISTRATION_APPROVAL_REQUIRED');
    await db.doc(`users/${teacher}`).update({ registrationApprovalStatus: 'APPROVED' });
    await denied(read(teacher, { year: '2025' }), 'WIS_STOCK_SCOPE_CHANGED');
    await db.doc(`semester_manifests/${scope.semesterId}`).update({ readOnly: true });
    await denied(read(), 'WIS_STOCK_SCOPE_CHANGED');
    await db.doc(`semester_manifests/${scope.semesterId}`).update({ readOnly: false });
    const account = await get(acctPath('student0'));
    await db.doc(acctPath('student0')).update({ [`positions.${stockId}.costBasis`]: 203 });
    await denied(read(), 'WIS_STOCK_INVESTMENT_HISTORY_INVALID');
    await db.doc(acctPath('student0')).set(account);
    await db.doc(sessionPath(teacher)).update({ status: 'closed' });
    await assert.rejects(read());
    assert.equal((await get(acctPath('student0'))).positions[stockId].costBasis, 202);
    assert.equal((await db.collection(`${base}/wis_stock_history`).where('accountId', '==', account.accountId)
      .where('kind', '==', 'ORDER_FILLED').get()).size, 1);
    const historyTransactions = commits.slice(historyStart);
    assert.ok(historyTransactions.every(transaction => transaction.writes.length === 0));
    console.log(JSON.stringify({ investmentHistorySource: process.env.WIS_STOCK_HISTORY_SOURCE_DIR || 'workspace',
      investmentHistorySuccesses: historyTransactions.length,
      investmentHistoryTransactionReadBudgets: [...new Set(historyTransactions.map(transaction => transaction.finalReads))],
      investmentHistoryWrites: 0, existingSessionAndMaintenanceGuardReadsPerSuccess: 3 }));
  });
  await test('read-only absence and pre-investment market ticks create no account or fake board', async () => {
    await db.doc('site_settings/student_maintenance').delete();
    const result = await state('student0'); assert.equal(result.accountPath, acctPath('student0')); assert.equal(result.account.stockCash, 0);
    assert.equal(Object.hasOwn(result.stocks[0].settings, 'trendBps'), false);
    const event = await marketWrite({ revision: 2 }); await api.onWisStockMarketTradingWrite(event);
    assert.equal(commits.reduce((n, c) => n + c.writes.length, 0), 0);
    assert.equal(commits.at(-1).finalReads, 3);
    assert.equal((await db.collection(`${base}/wis_stock_accounts`).get()).size, 0);
    assert.equal((await db.collection(`${base}/wis_stock_investment_boards`).get()).size, 0);
  });
  await test('60-percent rules and 120 floating index observations preserve wallet contracts and tick budgets', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    const marketPath = `${base}/wis_stock_markets/current`;
    const market = await get(marketPath), firstAt = clock - 119 * 3600000;
    market.rules = normalizeWisStockMarketRules({ ...market.rules, dailyPriceLimitBps: 6000, circuitBreakerBps: 6000 });
    market.stocks[0].settings = normalizeSettings({ ...market.stocks[0].settings, automatic: true, trendBps: 300 });
    market.stocks[0].history = Array.from({ length: 120 }, (_, i) => ({ atMs: firstAt + i * 3600000, price: i % 2 ? 100 : 101 }));
    market.marketIndex = reconstructWisStockIndex(market, clock);
    assert(validWisStockIndex(market.marketIndex));
    assert.equal(market.marketIndex.history.length, 120);
    assert.equal(Number.isInteger(market.marketIndex.value), false);
    await db.doc(marketPath).set(market);
    const protectedPaths = [mainPath('student0'), acctPath('student0'), `${base}/point_wallets/student0`,
      `semester_wis_balances/${accountIdFor(scope.semesterId, 'student0')}`,
      `semester_wis_rankings/${accountIdFor(scope.semesterId, 'student0')}`];
    const protectedBefore = await Promise.all(protectedPaths.map(get));
    const ledgerBefore = (await db.collection('semester_wis_ledger').where('studentUid', '==', 'student0').get()).docs.map(doc => doc.data());
    const value = await state('student0');
    assert.equal(value.rules.dailyPriceLimitBps, 6000);
    assert.equal(commits.at(-1).writes.length, 0);
    const management = createWisStockHandlers({ db: observedDb, now: () => clock });
    clock += 1800000;
    assert.equal((await management.advanceWisStockPrices()).changed, true);
    assert.equal(commits.at(-1).finalReads, 4);
    assert.equal(commits.at(-1).writes.length, 2);
    assert(commits.at(-1).writes.every(value => /wis_stock_(markets|public)/.test(value)));
    const changed = await get(marketPath);
    assert(validWisStockIndex(changed.marketIndex));
    assert.equal(changed.marketIndex.history.length, 120);
    assert.equal(changed.marketIndex.baseAtMs, firstAt);
    assert.equal(changed.stocks[0].price, 103);
    assert(Math.abs(changed.marketIndex.value - market.marketIndex.value * 1.03) < 1e-8);
    assert.equal(Object.hasOwn(await get(`${base}/wis_stock_public/market`), 'marketIndex'), false);
    assert.equal((await management.advanceWisStockPrices()).changed, false);
    assert.equal(commits.at(-1).finalReads, 2);
    assert.equal(commits.at(-1).writes.length, 0);
    assert.deepEqual(await Promise.all(protectedPaths.map(get)), protectedBefore);
    assert.deepEqual((await db.collection('semester_wis_ledger').where('studentUid', '==', 'student0').get()).docs.map(doc => doc.data()), ledgerBefore);
    const order = (await place('student0', 'BUY', 1, 'index-float-order-00001')).order;
    clock = order.dueAtMs;
    assert.equal((await settle(order.id)).order.status, 'FILLED');
    assert.equal((await state('student0')).account.positions[0].quantity, 1);
    assert.deepEqual(await get(mainPath('student0')), protectedBefore[0]);
    assert.deepEqual((await get(marketPath)).marketIndex, changed.marketIndex);
    await accounting('student0');
  });
  await test('eight duplicate deposits commit once, preserve ledger, and replay while halted with zero writes', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => transfer('student0', 'DEPOSIT', 5000)));
    assert.equal(results.filter(row => row.changed).length, 1);
    assert.equal((await accounting('student0')).balance, 5000);
    assert.equal((await get(acctPath('student0'))).stockCash, 5000);
    await marketWrite({ rules: { halted: true }, tradingEpoch: 2 });
    const replay = await transfer('student0', 'DEPOSIT', 5000); assert.equal(replay.duplicate, true); assert.equal(commits.at(-1).writes.length, 0);
    await denied(transfer('student0', 'DEPOSIT', 4000), 'WIS_STOCK_TRANSFER_CONFLICT');
    await denied(transfer('student1', 'DEPOSIT', 1), 'WIS_STOCK_MARKET_CLOSED');
  });
  await test('distinct concurrent deposits cannot bypass 50-percent cap or 24-hour cooldown', async () => {
    await denied(transfer('student0', 'DEPOSIT', 5001), 'WIS_STOCK_DEPOSIT_LIMIT');
    const results = await Promise.allSettled(['a', 'b'].map(key => transfer('student0', 'DEPOSIT', 1, `deposit_distinct_${key}`)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    const firstTime = (await get(acctPath('student0'))).lastDepositAtMs;
    clock = firstTime + 86400000 - 1; await denied(transfer('student0', 'DEPOSIT', 1, 'deposit_cooldown_end'), 'WIS_STOCK_DEPOSIT_COOLDOWN');
    clock++; await transfer('student0', 'DEPOSIT', 4999, 'deposit_cooldown_end');
    assert.equal((await accounting('student0')).balance, 5000);
  });
  await test('half-hour market revaluation reads only existing supplies across all changed ID batches', async () => {
    const market = await get(`${base}/wis_stock_markets/current`), held = market.stocks[0];
    const untraded = Array.from({ length: 60 }, (_, i) => ({
      ...held, id: 'stock_' + i.toString(16).padStart(24, '0'),
    }));
    await marketWrite({ stocks: [...untraded, held] });
    await transfer('student0', 'DEPOSIT', 5000);
    const order = (await place('student0', 'BUY', 2)).order;
    clock = order.dueAtMs;
    await settle(order.id);
    clock += 1800000;
    const event = await marketWrite({ revision: 2, updatedAtMs: clock,
      stocks: [...untraded, held].map(stock => ({ ...stock, updatedAtMs: clock, price: 115 })) });
    await api.onWisStockMarketTradingWrite(event);
    // Canonical market, display, overall board and trade state, plus two
    // empty-query minimums and the held supply in the final batch.
    assert.equal(commits.at(-1).finalReads, 7);
    assert.equal(commits.at(-1).writes.length, 4);
    for (const key of ['all', 'class_3_1']) {
      const board = await get(`${base}/wis_stock_investment_boards/${key}`);
      assert.equal(board.totals.holdingValue, 230);
    }
    await api.onWisStockMarketTradingWrite(event);
    assert.equal(commits.at(-1).finalReads, 4);
    assert.equal(commits.at(-1).writes.length, 0);
  });
  await test('fixed-price reservations settle once after sixty seconds even after quote expiry and price revision', async () => {
    await transfer('student0', 'DEPOSIT', 5000);
    const initial = await get(mainPath('student0'));
    const quote = { price: 100, atMs: clock, marketRevision: 1 }, id = 'same_order_request_01';
    const results = await Promise.all(Array.from({ length: 8 }, () => place('student0', 'BUY', 10, id, quote)));
    assert.equal(results.filter(row => row.changed).length, 1); const order = results[0].order;
    assert.equal(order.dueAtMs - clock, 60000); assert.equal((await state('student0')).account.reservedCash, 1010);
    await denied(settle(order.id), 'WIS_STOCK_ORDER_NOT_DUE');
    const market = await get(`${base}/wis_stock_markets/current`); market.stocks[0].price = 200; market.revision = 2;
    const event = await marketWrite(market); await api.onWisStockMarketTradingWrite(event);
    clock += 60000;
    const filled = await Promise.all(Array.from({ length: 8 }, () => settle(order.id)));
    assert.equal(filled.filter(row => row.changed).length, 1);
    const current = await state('student0'); assert.equal(current.account.stockCash, 3990); assert.equal(current.account.reservedCash, 0);
    assert.equal(current.account.positions[0].costBasis, 1010); assert.equal(current.account.positions[0].quantity, 10);
    assert.deepEqual(await get(mainPath('student0')), initial);
    const board = await get(`${base}/wis_stock_investment_boards/all`); assert.equal(board.totals.holdingValue, 2000);
    const accountKey = (await get(acctPath('student0'))).studentKey;
    const studentRow = board.rows.find(row => row.studentKey === accountKey);
    assert.ok(studentRow); assert.equal(studentRow.accountRevision, current.account.revision);
    await transfer('student1', 'DEPOSIT', 1000);
    const unrelated = await get(`${base}/wis_stock_investment_boards/all`);
    assert.ok(unrelated.sourceRevision > board.sourceRevision);
    assert.deepEqual(unrelated.rows.find(row => row.studentKey === studentRow.studentKey), studentRow);
    const pricesOnly = await get(`${base}/wis_stock_markets/current`);
    pricesOnly.stocks[0].price = 210; pricesOnly.revision++;
    await api.onWisStockMarketTradingWrite(await marketWrite(pricesOnly));
    const revalued = (await get(`${base}/wis_stock_investment_boards/all`)).rows.find(row => row.studentKey === studentRow.studentKey);
    assert.equal(revalued.holdingValue, 2100); assert.equal(revalued.accountRevision, studentRow.accountRevision);
    assert.equal((await place('student0', 'BUY', 10, id, quote)).duplicate, true); assert.equal(commits.at(-1).writes.length, 0);
    await denied(place('student0', 'BUY', 9, id, quote), 'WIS_STOCK_REQUEST_CONFLICT');
  });
  await test('close followed by reopen cancels an earlier generation; cancel/finalize races release exactly once', async () => {
    await transfer('student0', 'DEPOSIT', 5000); const order = (await place('student0')).order;
    const closeEvent = await marketWrite({ rules: { halted: true }, tradingEpoch: 2, revision: 2 });
    await marketWrite({ rules: { halted: false }, revision: 3 });
    await api.onWisStockMarketTradingWrite(closeEvent);
    assert.equal((await get(`${base}/wis_stock_orders/${order.id}`)).status, 'CANCELLED');
    assert.equal((await state('student0')).account.reservedCash, 0);
    const second = (await place('student0', 'BUY', 3, 'second_cancel_order_01')).order;
    await marketWrite({ rules: { halted: true }, tradingEpoch: 3 });
    await Promise.all([settle(second.id), api.cancelStudentWisStockOrder(request('student0', { orderId: second.id }))]);
    assert.equal((await state('student0')).account.stockCash, 5000);
    assert.equal((await get(`${base}/wis_stock_supplies/${stockId}`)).availableShares, 1000);
    const history = await api.getStudentWisStockHistory(request('student0')); assert.equal(history.entries.length, 5);
  });
  await test('buy versus withdrawal race never spends reserved cash; sell proceeds recognize only withdrawn profit', async () => {
    await transfer('student0', 'DEPOSIT', 5000); draw = 5;
    const results = await Promise.allSettled([place('student0', 'BUY', 40), transfer('student0', 'WITHDRAW', 1000, 'withdraw_race_00001')]);
    assert.ok(results.some(row => row.status === 'fulfilled'));
    const snap = await state('student0'); assert.ok(snap.account.reservedCash <= snap.account.stockCash);
    for (const order of snap.account.pendingOrders) await api.cancelStudentWisStockOrder(request('student0', { orderId: order.id }));
    // Use the second account for an exact buy/sell/withdraw accounting vector.
    await transfer('student1', 'DEPOSIT', 5000); const buy = (await place('student1', 'BUY', 10)).order; clock += 5000; await settle(buy.id);
    const market = await get(`${base}/wis_stock_markets/current`); market.stocks[0].price = 200; market.revision++;
    await api.onWisStockMarketTradingWrite(await marketWrite(market));
    const sell = (await place('student1', 'SELL', 10, 'sell_profit_request01')).order; clock += 5000; await settle(sell.id);
    assert.equal((await state('student1')).account.stockCash, 5970);
    assert.equal((await accounting('student1')).earnedTotal, 10000);
    const withdrawal = await transfer('student1', 'WITHDRAW', 5970, 'withdraw_profit_00001');
    assert.equal(withdrawal.receipt.principalReturned, 5000); assert.equal(withdrawal.receipt.withdrawnProfit, 970);
    const main = await accounting('student1'); assert.equal(main.balance, 10970); assert.equal(main.earnedTotal, 10970); assert.equal(main.rankEarnedTotal, 9500);
    assert.equal((await transfer('student1', 'WITHDRAW', 5970, 'withdraw_profit_00001')).duplicate, true);
    assert.equal(commits.at(-1).writes.length, 0);
  });
  await test('session revocation, menu hiding, inactive enrollment and foreign ownership fail closed', async () => {
    await transfer('student0', 'DEPOSIT', 5000); const order = (await place('student0')).order;
    await assert.rejects(api.cancelStudentWisStockOrder(request('student1', { orderId: order.id })), error => error.code === 'not-found');
    await db.doc(sessionPath('student0')).update({ status: 'closed' });
    await assert.rejects(state('student0'), error => error.code === 'unauthenticated');
    assert.equal((await settle(order.id)).order.status, 'CANCELLED');
    assert.equal((await db.collection(`${base}/wis_stock_display_trades`).get()).empty, true);
    await db.doc(sessionPath('student0')).update({ status: 'active' });
    await db.doc('site_settings/config').update({ studentMenuVisibility: { wispi: false } });
    assert.equal((await state('student0')).account.stockCash, 5000);
    await denied(transfer('student0', 'WITHDRAW', 100, 'hidden_withdraw_0001'), 'STUDENT_MENU_HIDDEN');
    await db.doc('semester_enrollments/enrollment-student0').update({ enrollmentStatus: 'WITHDRAWN' });
    await assert.rejects(state('student0'), error => error.code === 'failed-precondition');
    await assert.rejects(api.getStudentWisStockState(request('student1', { studentUid: 'student0' })), error => error.code === 'invalid-argument');
  });
  await test('immutable history cursors remain stable while new entries arrive and cannot cross accounts', async () => {
    await transfer('student0', 'DEPOSIT', 5000); const order = (await place('student0')).order;
    await api.cancelStudentWisStockOrder(request('student0', { orderId: order.id }));
    const first = await api.getStudentWisStockHistory(request('student0', { limit: 2 })); assert.equal(first.entries.length, 2); assert.equal(first.hasMore, true);
    await transfer('student0', 'WITHDRAW', 100, 'history_withdraw_001');
    const second = await api.getStudentWisStockHistory(request('student0', { limit: 2, cursor: first.nextCursor }));
    assert.equal(second.entries.length, 1); assert.equal(second.entries[0].kind, 'DEPOSIT'); assert.equal(second.hasMore, false);
    await denied(api.getStudentWisStockHistory(request('student1', { cursor: first.nextCursor })), 'WIS_STOCK_CURSOR_INVALID');
    assert.equal(commits.at(-1).writes.length, 0);
  });
  await test('durable creation trigger uses named due-time Tasks and bounded recovery settles missed dispatch', async () => {
    await transfer('student0', 'DEPOSIT', 5000); const order = (await place('student0')).order;
    const snapshot = await db.doc(`${base}/wis_stock_orders/${order.id}`).get();
    const event = { params: { year: '2026', semester: '2', orderId: order.id }, data: snapshot };
    await api.onWisStockOrderCreated(event); await api.onWisStockOrderCreated(event);
    assert.equal(tasks.length, 2); assert.equal(tasks[0].id, tasks[1].id); assert.equal(tasks[0].scheduleTime.getTime(), order.dueAtMs);
    assert.deepEqual(await api.recoverWisStockOrders(), { examined: 0, changed: 0, graduationJobsQueued: 0 });
    clock = order.dueAtMs; assert.deepEqual(await api.recoverWisStockOrders(), { examined: 1, changed: 1, graduationJobsQueued: 0 });
    assert.equal((await settle(order.id)).duplicate, true); assert.equal(commits.at(-1).writes.length, 0);
    const fills = await db.collection(`${base}/wis_stock_display_trades`).get();
    assert.equal(fills.size, 1);
    assert.deepEqual(fills.docs[0].data(), { semesterId: '2026-2', classKey: '3_1', atMs: clock,
      displayName: '합성 1', stockName: '합성검증종목', side: 'BUY', quantity: 1, unitPrice: 100 });
    const halt = await marketWrite({ rules: { ...(await get(`${base}/wis_stock_markets/current`)).rules, halted: true } });
    await api.onWisStockMarketTradingWrite(halt);
    const display = await get(`${base}/wis_stock_display/market`);
    assert.equal(display.halted, true);
    assert.deepEqual(display.index, { value: 1000, previousClose: 1000 });
    assert.deepEqual(display.stocks, [{ id: stockId, name: '합성검증종목', price: 100, previousClose: 100 }]);
    await api.onWisStockMarketTradingWrite(halt);
    assert.equal(commits.at(-1).writes.length, 0);
  });
  await test('supply exhaustion and parallel sell reservations never exceed issued or held quantities', async () => {
    for (let i = 0; i < 3; i++) await transfer(`student${i}`, 'DEPOSIT', 5000);
    const results = await Promise.allSettled([0, 1, 2].map(i => place(`student${i}`)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 2);
    assert.ok(errorIs('WIS_STOCK_ISSUED_LIMIT')(results.find(row => row.status === 'rejected').reason));
    clock += 60000;
    for (const row of results.filter(row => row.status === 'fulfilled')) await settle(row.value.order.id);
    const owner = results.findIndex(row => row.status === 'fulfilled'), uid = `student${owner}`;
    const sells = await Promise.allSettled(['a', 'b'].map(key => place(uid, 'SELL', 1, `sell_reserved_${key}_0001`)));
    assert.equal(sells.filter(row => row.status === 'fulfilled').length, 1);
    const pending = (await state(uid)).account.pendingOrders; assert.equal(pending.length, 1);
    await api.cancelStudentWisStockOrder(request(uid, { orderId: pending[0].id }));
    assert.equal((await get(`${base}/wis_stock_supplies/${stockId}`)).availableShares, 0);
    assert.equal((await state(uid)).account.positions[0].reservedSellQuantity, 0);
  }, 3, 2);
  await test('enrollment move, withdrawal and duplicate slot events preserve assets and atomically maintain class projections', async () => {
    await transfer('student0', 'DEPOSIT', 5000); draw = 5;
    const buy = (await place('student0', 'BUY', 2)).order; clock += 5000; await settle(buy.id);
    const slotId = `slot_${hash(scope.semesterId + '\nstudent0').slice(0, 40)}`, ref = db.doc(`semester_enrollment_slots/${slotId}`);
    const before = await ref.get(), batch = db.batch();
    batch.set(db.doc('semester_classes/class-two'), { classId: 'class-two', semesterId: scope.semesterId, grade: '3', classNumber: '2', status: 'ACTIVE' });
    batch.set(db.doc('semester_enrollments/enrollment-moved'), { enrollmentId: 'enrollment-moved', semesterId: scope.semesterId,
      studentUid: 'student0', classId: 'class-two', enrollmentStatus: 'ACTIVE' });
    batch.update(ref, { activeEnrollmentId: 'enrollment-moved', revision: 2 });
    batch.update(db.doc(mainPath('student0')), { enrollmentId: 'enrollment-moved', classId: 'class-two', classNumber: '2' }); await batch.commit();
    const event = { params: { slotId }, data: { before, after: await ref.get() } };
    const secondInstance = createWisStockTrading({ db: observedDb, now: () => clock, delaySeconds: () => draw, enqueueTask: async () => {} });
    await Promise.all([api.onWisStockEnrollmentSlotWritten(event), secondInstance.transferStudentWisStock(request('student0',
      { requestId: 'move_race_withdraw_01', direction: 'WITHDRAW', amount: 1 }))]);
    assert.equal((await get(`${base}/wis_stock_investment_boards/class_3_1`)).totals.studentCount, 0);
    assert.equal((await get(`${base}/wis_stock_investment_boards/class_3_2`)).totals.studentCount, 1);
    await api.onWisStockEnrollmentSlotWritten(event); assert.equal(commits.at(-1).writes.length, 0);
    await db.doc('site_settings/semester_active').update({ semesterId: '2027-1' });
    await api.onWisStockEnrollmentSlotWritten(event); assert.equal(commits.at(-1).writes.length, 0); assert.equal(commits.at(-1).finalReads, 3);
    await db.doc('site_settings/semester_active').update({ semesterId: scope.semesterId });
    const pending = (await place('student0', 'BUY', 1, 'inactive_pending_order')).order;
    const assets = await get(acctPath('student0')), previous = await ref.get();
    await ref.update({ activeEnrollmentId: null, status: 'CLOSED' });
    await db.doc('semester_enrollments/enrollment-moved').update({ enrollmentStatus: 'WITHDRAWN' });
    const closed = { params: { slotId }, data: { before: previous, after: await ref.get() } };
    await api.onWisStockEnrollmentSlotWritten(closed);
    const after = await get(acctPath('student0'));
    for (const key of ['stockCash', 'reservedCash', 'outstandingPrincipal', 'positions']) assert.deepEqual(after[key], assets[key]);
    assert.equal((await get(`${base}/wis_stock_investment_boards/all`)).totals.studentCount, 0);
    assert.equal((await settle(pending.id)).order.status, 'CANCELLED');
    const market = await get(`${base}/wis_stock_markets/current`); market.revision++; market.stocks[0].price = 150;
    await api.onWisStockMarketTradingWrite(await marketWrite(market));
    assert.equal((await get(`${base}/wis_stock_investment_boards/all`)).totals.studentCount, 0);
    await api.onWisStockEnrollmentSlotWritten(closed); assert.equal(commits.at(-1).writes.length, 0);
    const absentId = `slot_${hash(scope.semesterId + '\nstudent1').slice(0, 40)}`, absent = await db.doc(`semester_enrollment_slots/${absentId}`).get();
    await api.onWisStockEnrollmentSlotWritten({ params: { slotId: absentId }, data: { before: absent, after: absent } });
    assert.equal(commits.at(-1).writes.length, 0); assert.equal(commits.at(-1).finalReads, 2);
  });
  await test('disabled profile and expired current session cancel pending reservations without general-Wis writes', async () => {
    for (let i = 0; i < 2; i++) await transfer(`student${i}`, 'DEPOSIT', 5000);
    const first = (await place('student0')).order, second = (await place('student1')).order;
    await db.doc('users/student0').update({ disabled: true });
    await db.doc(sessionPath('student1')).update({ generalExpiresAt: Timestamp.fromMillis(1) });
    for (const order of [first, second]) assert.equal((await settle(order.id)).order.status, 'CANCELLED');
    for (let i = 0; i < 2; i++) {
      assert.equal((await get(acctPath(`student${i}`))).reservedCash, 0);
      assert.equal((await accounting(`student${i}`)).balance, 5000);
    }
  });
  await test('one inconsistent order cannot block recovery of other due orders or release unverified funds', async () => {
    for (let i = 0; i < 2; i++) await transfer(`student${i}`, 'DEPOSIT', 5000);
    const first = (await place('student0')).order, second = (await place('student1')).order;
    await db.doc(`${base}/wis_stock_orders/${first.id}`).update({ requestKey: 'synthetic-corrupted-contract' });
    clock += 60000;
    assert.deepEqual(await api.recoverWisStockOrders(), { examined: 2, changed: 1, graduationJobsQueued: 0, failed: 1 });
    assert.equal((await get(`${base}/wis_stock_orders/${first.id}`)).status, 'PENDING');
    assert.equal((await get(`${base}/wis_stock_orders/${second.id}`)).status, 'FILLED');
    assert.equal((await get(acctPath('student0'))).reservedCash, 101);
    for (let i = 0; i < 2; i++) assert.equal((await accounting(`student${i}`)).balance, 5000);
  });
  await test('thirty students concurrently reserve a shared supply and board without lost holdings or partial commits', async () => {
    // Deposit serially to isolate actual class-wide order contention in this case.
    for (let i = 0; i < 30; i++) await transfer(`student${i}`, 'DEPOSIT', 5000);
    const inputs = Array.from({ length: 30 }, (_, i) => ({ uid: `student${i}`, id: `class_order_request_${String(i).padStart(2, '0')}` }));
    // Ten separate queues simulate ten cold function instances. No process-wide
    // test mutex may turn this distributed-contention check into a serial test.
    const instances = Array.from({ length: 10 }, () => createWisStockTrading({ db: observedDb, now: () => clock, delaySeconds: () => draw,
      enqueueTask: async () => {} }));
    const first = await Promise.allSettled(inputs.map((row, index) => instances[index % instances.length].placeStudentWisStockOrder(request(row.uid,
      { requestId: row.id, stockId, side: 'BUY', quantity: 1, quote: { price: 100, atMs: clock, marketRevision: 1 } }))));
    for (let i = 0; i < first.length; i++) if (first[i].status === 'rejected') {
      assert.ok([10, 'aborted', 4, 'deadline-exceeded'].includes(first[i].reason.code), String(first[i].reason));
      await place(inputs[i].uid, 'BUY', 1, inputs[i].id);
    }
    const supply = await get(`${base}/wis_stock_supplies/${stockId}`); assert.equal(supply.availableShares, 970); assert.equal(supply.reservedBuyQuantity, 30);
    const board = await get(`${base}/wis_stock_investment_boards/all`); assert.equal(board.totals.studentCount, 30); assert.equal(board.totals.reservedCash, 3030);
    clock += 60000;
    const orders = (await db.collection(`${base}/wis_stock_orders`).get()).docs;
    const settled = await Promise.allSettled(orders.map((doc, index) => instances[index % instances.length].settleWisStockOrderTask({
      data: { kind: 'ORDER', year: '2026', semester: '2', orderId: doc.id } })));
    for (let i = 0; i < settled.length; i++) if (settled[i].status === 'rejected') await settle(orders[i].id);
    const after = await get(`${base}/wis_stock_supplies/${stockId}`);
    assert.equal(after.reservedBuyQuantity, 0); assert.equal(Object.values(after.holders).reduce((n, v) => n + v, 0), 30);
    assert.equal((await get(`${base}/wis_stock_investment_boards/all`)).totals.holdingValue, 3000);
    for (let i = 0; i < 30; i++) { const wallet = await accounting(`student${i}`); assert.equal(wallet.balance, 5000);
      const account = await get(acctPath(`student${i}`)); assert.equal(account.stockCash, 4899); assert.equal(account.positions[stockId].quantity, 1); }
    console.log(JSON.stringify({ classOrders: 30, initialRejected: first.filter(row => row.status === 'rejected').length,
      settlementRetries: settled.filter(row => row.status === 'rejected').length }));
  }, 30);
  const evidenceDir = process.env.WIS_STOCK_TRADING_EVIDENCE_DIR;
  if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, 'trading-integration.json'), JSON.stringify({ projectId, groups: evidence.length,
    budgetScope: 'Transaction document reads and committed writes; query rows counted individually, empty queries count one. Successful callable session/maintenance guard adds three reads outside the transaction. Worker selection queries read at most fifty documents, minimum one. Fixture setup/assertion reads are excluded.', evidence }, null, 2)); }
  console.log(`PASS ${evidence.length} trading integration groups (synthetic local data only)`);
} finally { await deleteApp(app); } })().catch(error => { console.error(error); process.exitCode = 1; });
