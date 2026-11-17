const { createHash } = require('node:crypto');
const { Timestamp, FieldPath } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFunctions } = require('firebase-admin/functions');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { resolveSessionAuthorityConfig } = require('./sessionAuthority');
const { createStudentWisWallet, accountIdFor } = require('./studentWisWallet');
const { evaluateStudentMaintenanceAccess, DEFAULT_DISABLED_CONFIG } = require('./studentMaintenance');
const { readMarket, publicStockSettings } = require('./wisStocks');
const { assertStudentWispiMenuVisible } = require('./studentMenuVisibility');
const { planWisStockTransfer, getWisStockFundingLimits } = require('./wisStockAccount');
const { acceptWisStockOrder, finalizeWisStockOrder, cancelWisStockOrder, createWisStockOrderDelaySeconds } = require('./wisStockOrderLifecycle');
const { wisStockKstSession } = require('./wisStockMarketRules');
const { buildWisStockInvestmentBoard, parseWisStockInvestmentBoardSnapshot, normalizeWisStockInvestmentBoardScope } = require('./wisStockInvestmentBoard');

const { prepareDepositBonus, receiptPath: campaignReceiptPath } = require('./wisStockDepositCampaign');
const { createWisStockGraduation } = require('./wisStockGraduation');

const MAX = Number.MAX_SAFE_INTEGER, MAX_PENDING = 20;
const hash = value => createHash('sha256').update(value).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safe = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const integer = value => { if (value > BigInt(MAX) || value < -BigInt(MAX)) fail('WIS_STOCK_UNSAFE_TOTAL'); return Number(value); };
const sum = values => integer(values.reduce((total, item) => total + BigInt(item), 0n));
const multiply = (a, b) => integer(BigInt(a) * BigInt(b));
function fail(reason, message = '위스피 거래 상태를 다시 확인해 주세요.', code = 'failed-precondition') { throw new HttpsError(code, message, { reason }); }
const rootPath = scope => `years/${scope.year}/semesters/${scope.semester}`;
const scopeOf = input => {
  if (!record(input) || typeof input.year !== 'string' || !/^20\d{2}$/.test(input.year)
    || typeof input.semester !== 'string' || !/^[12]$/.test(input.semester)) fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
  return { year: input.year, semester: input.semester, semesterId: `${input.year}-${input.semester}` };
};
const validateInput = (input, fields) => {
  if (!record(input) || Object.keys(input).some(key => !['year', 'semester', '_session', ...fields].includes(key))) fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
};
const requestIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);
const orderIdValid = value => typeof value === 'string' && /^stockord_[a-f0-9]{64}$/.test(value);
const accountPath = (scope, uid) => `${rootPath(scope)}/wis_stock_accounts/${accountIdFor(scope.semesterId, uid)}`;
const orderPath = (scope, id) => `${rootPath(scope)}/wis_stock_orders/${id}`;
const studentKeyFor = uid => `student_${hash(uid).slice(0, 24)}`;
const emptyPosition = () => ({ quantity: 0, principal: 0, costBasis: 0, reservedBuyQuantity: 0,
  reservedSellQuantity: 0, reservedSellPrincipal: 0, reservedSellCostBasis: 0 });
const rosterFor = (wallet, scope, uid) => ({ studentKey: studentKeyFor(uid), grade: String(wallet.grade || ''),
  classNumber: String(wallet.classNumber || ''), studentNumber: String(wallet.studentNumber || ''), displayName: wallet.displayName || '',
  enrollmentId: wallet.enrollmentId, enrollmentSlotId: `slot_${hash(scope.semesterId + '\n' + uid).slice(0, 40)}`, classId: wallet.classId });
function blankAccount(scope, uid, wallet, atMs) {
  return { schemaVersion: 1, semesterId: scope.semesterId, accountId: accountIdFor(scope.semesterId, uid), studentUid: uid,
    ...rosterFor(wallet, scope, uid), boardEligible: true, revision: 0, stockCash: 0, reservedCash: 0, reservedBuyFees: 0, outstandingPrincipal: 0,
    lastDepositAtMs: 0, positions: {}, pendingOrders: {}, recentOrders: [], dayKey: wisStockKstSession(atMs).dayKey,
    dailyBuyAmount: 0, dailyOrderCount: 0, lastOrderAtMs: 0, cumulativeRealizedPnl: 0, profitHighWatermark: 0 };
}
function validateAccount(account, scope, uid) {
  if (!record(account) || account.schemaVersion !== 1 || account.semesterId !== scope.semesterId || account.studentUid !== uid
    || account.accountId !== accountIdFor(scope.semesterId, uid) || !safe(account.revision)
    || account.studentKey !== studentKeyFor(uid)
    || (account.boardEligible !== undefined && typeof account.boardEligible !== 'boolean')
    || !['stockCash', 'reservedCash', 'reservedBuyFees', 'outstandingPrincipal', 'lastDepositAtMs', 'dailyBuyAmount', 'dailyOrderCount', 'lastOrderAtMs', 'profitHighWatermark'].every(key => safe(account[key]))
    || (account.eventBonusTotal !== undefined && !safe(account.eventBonusTotal))
    || !safe(account.cumulativeRealizedPnl, -MAX) || account.profitHighWatermark < Math.max(0, account.cumulativeRealizedPnl)
    || !record(account.positions) || Object.keys(account.positions).length > 100 || !record(account.pendingOrders)
    || Object.keys(account.pendingOrders).length > MAX_PENDING || !Array.isArray(account.recentOrders) || account.recentOrders.length > 10
    || account.reservedCash > account.stockCash || account.reservedBuyFees > account.reservedCash) fail('WIS_STOCK_ACCOUNT_INVALID');
  const expected = {};
  for (const [id, order] of Object.entries(account.pendingOrders)) {
    if (!orderIdValid(id) || order.id !== id || order.accountId !== account.accountId || order.semesterId !== scope.semesterId
      || order.status !== 'PENDING' || !['BUY', 'SELL'].includes(order.side)
      || !['quantity', 'cashDebit', 'fee', 'reservedPrincipal', 'reservedCostBasis'].every(key => safe(order[key]))) fail('WIS_STOCK_ACCOUNT_INVALID');
    const totals = expected[order.stockId] ||= emptyPosition();
    if (order.side === 'BUY') totals.reservedBuyQuantity = sum([totals.reservedBuyQuantity, order.quantity]);
    else for (const [key, field] of [['reservedSellQuantity', 'quantity'], ['reservedSellPrincipal', 'reservedPrincipal'], ['reservedSellCostBasis', 'reservedCostBasis']]) totals[key] = sum([totals[key], order[field]]);
  }
  const orders = Object.values(account.pendingOrders);
  if (account.reservedCash !== sum(orders.map(order => order.cashDebit))
    || account.reservedBuyFees !== sum(orders.filter(order => order.side === 'BUY').map(order => order.fee))) fail('WIS_STOCK_ACCOUNT_INVALID');
  for (const [stockId, position] of Object.entries(account.positions)) {
    if (!/^stock_[a-f0-9]{24}$/.test(stockId) || !record(position) || !Object.keys(emptyPosition()).every(key => safe(position[key]))
      || position.principal > position.costBasis || position.reservedSellQuantity > position.quantity
      || position.reservedSellPrincipal > position.principal || position.reservedSellCostBasis > position.costBasis
      || (position.quantity === 0 && (position.principal !== 0 || position.costBasis !== 0))) fail('WIS_STOCK_ACCOUNT_INVALID');
    for (const key of ['reservedBuyQuantity', 'reservedSellQuantity', 'reservedSellPrincipal', 'reservedSellCostBasis'])
      if (position[key] !== (expected[stockId]?.[key] || 0)) fail('WIS_STOCK_ACCOUNT_INVALID');
  }
  if (Object.keys(expected).some(stockId => !account.positions[stockId])) fail('WIS_STOCK_ACCOUNT_INVALID');
  return account;
}
function supplyFor(snapshot, stock, scope) {
  const value = snapshot.exists ? snapshot.data() : { schemaVersion: 1, semesterId: scope.semesterId, stockId: stock.id,
    issuedShares: stock.settings.issuedShares, availableShares: stock.settings.issuedShares, reservedBuyQuantity: 0, holders: {}, revision: 0 };
  if (value.schemaVersion !== 1 || value.semesterId !== scope.semesterId || value.stockId !== stock.id
    || value.issuedShares !== stock.settings.issuedShares || !['issuedShares', 'availableShares', 'reservedBuyQuantity', 'revision'].every(key => safe(value[key]))
    || !record(value.holders) || Object.entries(value.holders).some(([key, quantity]) => !/^student_[a-f0-9]{24}$/.test(key) || !safe(quantity, 1))
    || sum([value.availableShares, value.reservedBuyQuantity, ...Object.values(value.holders)]) !== value.issuedShares) fail('WIS_STOCK_SUPPLY_INVALID');
  return value;
}
const timestampMs = value => typeof value?.toMillis === 'function' ? value.toMillis() : NaN;
function sessionValid(session, uid, authTime, revision, atMs) {
  const runtime = resolveSessionAuthorityConfig();
  const expiresAtMs = timestampMs(session?.generalExpiresAt);
  return session?.uid === uid && session.authTime === authTime && session.status === 'active' && session.schemaVersion === 2
    && session.authorityGeneration === 'w1r2-2026-08-09' && safe(session.protocolVersion, 2) && session.sessionRevision === revision
    && /^[a-f0-9]{64}$/.test(revision || '') && runtime.valid && safe(expiresAtMs)
    && ['ENFORCE', 'OBSERVE_ONLY', 'DISABLED'].includes(session.authorityModeAtOpen)
    && (!(runtime.mode === 'ENFORCE' || session.authorityModeAtOpen === 'ENFORCE') || expiresAtMs > atMs);
}
function portfolioFor(account, market, stockId) {
  const prices = new Map(market.stocks.map(stock => [stock.id, stock.price]));
  const position = account.positions[stockId] || emptyPosition();
  const values = Object.entries(account.positions).map(([id, p]) => {
    if (p.quantity && !prices.has(id)) fail('WIS_STOCK_PRICE_MISSING');
    return multiply(p.quantity, prices.get(id) || 0);
  });
  return { cashBalance: account.stockCash, holdingQuantity: position.quantity, holdingPrincipal: position.principal,
    holdingCostBasis: position.costBasis, portfolioValue: sum([account.stockCash, ...values]), dayKey: account.dayKey,
    dailyBuyAmount: account.dailyBuyAmount, dailyOrderCount: account.dailyOrderCount, lastOrderAtMs: account.lastOrderAtMs,
    cumulativeRealizedPnl: account.cumulativeRealizedPnl, profitHighWatermark: account.profitHighWatermark };
}
const reservationsFor = (account, stockId) => { const p = account.positions[stockId] || emptyPosition();
  return { cash: account.reservedCash, buyFees: account.reservedBuyFees, buyQuantity: p.reservedBuyQuantity,
    sellQuantity: p.reservedSellQuantity, sellPrincipal: p.reservedSellPrincipal, sellCostBasis: p.reservedSellCostBasis }; };
function applyOrder(account, supply, transition) {
  const next = structuredClone(account), nextSupply = structuredClone(supply), effects = transition.effects, order = transition.order;
  const p = next.positions[order.stockId] ||= emptyPosition();
  for (const [key, field] of Object.entries({ stockCash: 'stockCashDelta', reservedCash: 'reservedCashDelta', reservedBuyFees: 'reservedBuyFeesDelta',
    dailyBuyAmount: 'dailyBuyAmountDelta', dailyOrderCount: 'dailyOrderCountDelta', cumulativeRealizedPnl: 'cumulativeRealizedPnlDelta', profitHighWatermark: 'profitHighWatermarkDelta' })) next[key] = sum([next[key], effects[field]]);
  for (const [key, field] of Object.entries({ quantity: 'holdingQuantityDelta', principal: 'holdingPrincipalDelta', costBasis: 'holdingCostBasisDelta',
    reservedBuyQuantity: 'reservedBuyQuantityDelta', reservedSellQuantity: 'reservedSellQuantityDelta', reservedSellPrincipal: 'reservedSellPrincipalDelta', reservedSellCostBasis: 'reservedSellCostBasisDelta' })) p[key] = sum([p[key], effects[field]]);
  nextSupply.availableShares = sum([nextSupply.availableShares, effects.availableSharesDelta]);
  nextSupply.reservedBuyQuantity = sum([nextSupply.reservedBuyQuantity, effects.marketReservedBuyQuantityDelta]);
  nextSupply.revision = sum([nextSupply.revision, 1]);
  if (p.quantity) nextSupply.holders[next.studentKey] = p.quantity; else delete nextSupply.holders[next.studentKey];
  if (effects.counterDayKey !== null) next.dayKey = effects.counterDayKey;
  if (effects.lastOrderAtMs !== null) next.lastOrderAtMs = effects.lastOrderAtMs;
  if (order.status === 'PENDING') next.pendingOrders[order.id] = order;
  else { delete next.pendingOrders[order.id]; next.recentOrders = [order, ...next.recentOrders.filter(item => item.id !== order.id)].slice(0, 10); }
  if (Object.values(p).every(value => value === 0)) delete next.positions[order.stockId];
  next.revision = sum([next.revision, 1]);
  return { next, nextSupply };
}
function safeOrder(order) { return Object.fromEntries(['id', 'stockId', 'side', 'quantity', 'unitPrice', 'gross', 'fee', 'cashDebit', 'cashCredit',
  'acceptedAtMs', 'dueAtMs', 'status', 'revision', 'settledAtMs', 'cancellationReason'].filter(key => order[key] !== undefined).map(key => [key, order[key]])); }

function createWisStockTrading({ db, assertSession = assertScoreWorkflowSession, now = Date.now, delaySeconds = createWisStockOrderDelaySeconds,
  enqueueTask = (data, options) => getFunctions().taskQueue('locations/us-central1/functions/settleWisStockOrderTask').enqueue(data, options) }) {
  // A process-local admission queue reduces bursts contending on the complete
  // board/supply projection. It is not an authority lock: all money/reservations
  // remain protected by Firestore across instances, retries and cold starts.
  const queues = new Map();
  async function mutate(scope, callback) {
    const key = scope.semesterId, entry = queues.get(key) || { tail: Promise.resolve(), pending: 0 };
    if (entry.pending >= 40) fail('WIS_STOCK_RETRY_REQUIRED', '거래가 많아 잠시 대기 중입니다. 같은 요청으로 다시 시도해 주세요.', 'resource-exhausted');
    queues.set(key, entry); entry.pending++;
    const previous = entry.tail; let release;
    entry.tail = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      const started = Date.now();
      try { return await db.runTransaction(callback, { maxAttempts: 10 }); }
      catch (error) {
        // The emulator/transport can close a contended transaction with code 3
        // instead of ABORTED, which the SDK does not retry. One fresh transaction
        // is safe because every mutation rechecks its durable receipt/order.
        if (error?.code !== 3 || !/Transaction is invalid or closed/i.test(error.message || '') || Date.now() - started > 25000) throw error;
        return await db.runTransaction(callback, { maxAttempts: 10 });
      }
    }
    finally { release(); entry.pending--; if (!entry.pending) queues.delete(key); }
  }
  const actorFor = async request => {
    const authority = await assertSession(request);
    const uid = request.auth?.uid, authTime = request.auth?.token?.auth_time, revision = request.data?._session?.revision;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !safe(authTime, 1)
      || authority.uid !== uid || !/^[a-f0-9]{64}$/.test(revision || '')) fail('WIS_STOCK_SESSION_INVALID', undefined, 'unauthenticated');
    return { uid, authTime, revision };
  };
  async function load(tx, scope, actor, atMs, { task = false } = {}) {
    let profile;
    const adapter = createStudentWisWallet({ db, validateStudentProfile: value => {
      profile = value; if (value.disabled || value.weplayDeletionPending) fail('WIS_STOCK_STUDENT_REQUIRED');
    } });
    let loaded, eligible = true;
    try { loaded = await adapter.read(tx, scope, actor.uid); }
    catch (error) { if (!task || error.code !== 'failed-precondition') throw error; eligible = false; }
    const paths = ['site_settings/config', `${rootPath(scope)}/wis_stock_markets/current`, accountPath(scope, actor.uid),
      `application_sessions/${actor.uid}/sessions/${actor.authTime}`, 'site_settings/student_maintenance'];
    const snapshots = await tx.getAll(...paths.map(path => db.doc(path)));
    const [config, marketSnapshot, accountSnapshot, sessionSnapshot, maintenanceSnapshot] = snapshots;
    const settings = config.data() || {}, market = readMarket(marketSnapshot, scope);
    const active = String(settings.year) === scope.year && String(settings.semester) === scope.semester;
    const authorized = sessionValid(sessionSnapshot.data(), actor.uid, actor.authTime, actor.revision, atMs)
      && evaluateStudentMaintenanceAccess({ auth: { uid: actor.uid, token: { email: profile?.email || '' } },
        config: maintenanceSnapshot.exists ? maintenanceSnapshot.data() : DEFAULT_DISABLED_CONFIG, profile: profile || {}, profileExists: !!profile }).allowed;
    if (!task && !active) fail('WIS_STOCK_SCOPE_CHANGED');
    if (!task && !authorized) fail('WIS_STOCK_SESSION_INVALID', undefined, 'unauthenticated');
    const account = accountSnapshot.exists ? validateAccount(accountSnapshot.data(), scope, actor.uid)
      : loaded ? blankAccount(scope, actor.uid, loaded.wallet, atMs) : null;
    return { loaded, market, account, accountExists: accountSnapshot.exists, config: settings, active,
      authorized: eligible && authorized, actor, scope, atMs };
  }
  const assertOpen = context => {
    if (!context.market.studentOpen || context.market.rules.halted) fail('WIS_STOCK_MARKET_CLOSED', '지금은 위스피 거래가 중지되어 있습니다.');
    assertStudentWispiMenuVisible(context.config);
  };
  function state(context, account = context.account, mainCash = context.loaded.wallet.balance, exists = context.accountExists) {
    return { semesterId: context.scope.semesterId, serverNowMs: context.atMs, studentOpen: context.market.studentOpen,
      halted: !context.market.studentOpen || context.market.rules.halted, tradingEpoch: context.market.tradingEpoch || 0,
      marketRevision: context.market.revision, rules: context.market.rules, mainCash,
      accountPath: accountPath(context.scope, context.actor.uid),
      stocks: context.market.studentOpen ? context.market.stocks.map(({ id, settings, price, updatedAtMs, haltedUntilMs }) =>
        ({ id, settings: publicStockSettings(settings), price, updatedAtMs, haltedUntilMs })) : [],
      account: { accountId: account.accountId, revision: account.revision, stockCash: account.stockCash, reservedCash: account.reservedCash,
        outstandingPrincipal: account.outstandingPrincipal, lastDepositAtMs: account.lastDepositAtMs,
        eventBonusTotal: account.eventBonusTotal || 0,
        cumulativeRealizedPnl: account.cumulativeRealizedPnl,
        positions: Object.entries(account.positions).filter(([, p]) => p.quantity || p.reservedBuyQuantity || p.reservedSellQuantity).map(([stockId, p]) => ({ stockId, ...p })),
        pendingOrders: Object.values(account.pendingOrders).map(safeOrder), recentOrders: account.recentOrders.map(safeOrder) },
      funding: getWisStockFundingLimits({ mainCash, stockCash: account.stockCash, reservedCash: account.reservedCash,
        outstandingPrincipal: account.outstandingPrincipal, lastDepositAtMs: account.lastDepositAtMs }, context.atMs) };
  }
  async function prepareBoard(tx, scope, market, previous, next, supplyChanges = new Map()) {
    const allRef = db.doc(`${rootPath(scope)}/wis_stock_investment_boards/all`), metaRef = db.doc(`${rootPath(scope)}/wis_stock_trade_state/current`);
    const [allSnap, metaSnap] = await tx.getAll(allRef, metaRef);
    if (!allSnap.exists && !next) return null;
    if (allSnap.exists !== metaSnap.exists || (!allSnap.exists && previous?.revision > 0)) fail('WIS_STOCK_BOARD_SOURCE_INVALID');
    const boardScope = normalizeWisStockInvestmentBoardScope(scope), old = allSnap.exists ? allSnap.data() : null;
    if (old) parseWisStockInvestmentBoardSnapshot(old, boardScope);
    const meta = metaSnap.exists ? metaSnap.data() : { schemaVersion: 1, semesterId: scope.semesterId, revision: 0, prices: {}, priceRevision: 0 };
    if (meta.schemaVersion !== 1 || meta.semesterId !== scope.semesterId || !record(meta.prices)
      || (old && (old.revision !== meta.revision || old.priceRevision !== meta.priceRevision))) fail('WIS_STOCK_BOARD_SOURCE_INVALID');
    const excluded = new Set(meta.excludedStudentKeys || []);
    if (!Array.isArray(meta.excludedStudentKeys ?? []) || [...excluded].some(key => !/^student_[a-f0-9]{24}$/.test(key))) fail('WIS_STOCK_BOARD_SOURCE_INVALID');
    if (next) { if (next.boardEligible === false) excluded.add(next.studentKey); else excluded.delete(next.studentKey); }
    const prices = Object.fromEntries(market.stocks.map(stock => [stock.id, stock.price]));
    const changed = market.stocks.filter(stock => meta.prices[stock.id] !== undefined && meta.prices[stock.id] !== stock.price);
    if (!next && !changed.length) return null;
    const rows = new Map((old?.rows || []).map(row => [row.studentKey, { ...row }])), touchedClasses = new Set();
    for (const stock of changed) {
      const supply = supplyChanges.get(stock.id) || supplyFor(await tx.get(db.doc(`${rootPath(scope)}/wis_stock_supplies/${stock.id}`)), stock, scope);
      for (const [key, quantity] of Object.entries(supply.holders)) {
        // The changed account is replaced from its complete current positions below.
        if (key === next?.studentKey || excluded.has(key)) continue;
        const row = rows.get(key); if (!row) fail('WIS_STOCK_BOARD_SOURCE_INVALID');
        row.holdingValue = sum([row.holdingValue, multiply(quantity, stock.price - meta.prices[stock.id])]);
        touchedClasses.add(`${row.grade}_${row.classNumber}`);
      }
    }
    if (next) {
      const oldRow = rows.get(next.studentKey); if (oldRow) touchedClasses.add(`${oldRow.grade}_${oldRow.classNumber}`);
      const positions = Object.entries(next.positions).filter(([, p]) => p.quantity > 0);
      const holdingValue = sum(positions.map(([id, p]) => { if (!safe(prices[id], 1)) fail('WIS_STOCK_PRICE_MISSING'); return multiply(p.quantity, prices[id]); }));
      if (next.boardEligible === false) rows.delete(next.studentKey);
      else rows.set(next.studentKey, { studentKey: next.studentKey, grade: next.grade, classNumber: next.classNumber,
        studentNumber: next.studentNumber, displayName: next.displayName, accountRevision: next.revision,
        stockCash: next.stockCash, reservedCash: next.reservedCash,
        holdingCount: positions.length, holdingValue, holdingCostBasis: sum(positions.map(([, p]) => p.costBasis)), realizedPnl: next.cumulativeRealizedPnl });
      touchedClasses.add(`${next.grade}_${next.classNumber}`);
    }
    const classes = [...new Set([...rows.values()].map(row => `${row.grade}_${row.classNumber}`))].map(key => { const [grade, classNumber] = key.split('_'); return { grade, classNumber }; });
    const revision = sum([meta.revision, 1]), common = { revision, asOfMs: now(), sourceRevision: revision, priceRevision: market.revision };
    const all = buildWisStockInvestmentBoard({ ...common, scope: boardScope, classes, rows: [...rows.values()] });
    const boards = [...touchedClasses].map(key => { const [grade, classNumber] = key.split('_');
      const selected = normalizeWisStockInvestmentBoardScope({ ...scope, grade, classNumber });
      return [db.doc(`${rootPath(scope)}/wis_stock_investment_boards/${selected.documentId}`), buildWisStockInvestmentBoard({ ...common,
        scope: selected, classes: [{ grade, classNumber }], rows: [...rows.values()].filter(row => row.grade === grade && row.classNumber === classNumber) })]; });
    return () => { tx.set(allRef, all); tx.set(metaRef, { schemaVersion: 1, semesterId: scope.semesterId, revision, prices,
      priceRevision: market.revision, excludedStudentKeys: [...excluded].sort() });
      for (const [ref, board] of boards) tx.set(ref, board); };
  }
  function history(tx, context, next, kind, reference, detail = {}) {
    const id = `stockhist_${hash(`${next.accountId}\n${kind}\n${reference}`)}`;
    const entry = { schemaVersion: 1, id, accountId: next.accountId, studentUid: next.studentUid, semesterId: context.scope.semesterId,
      sequence: next.revision, kind, atMs: context.atMs, stockCashDelta: 0, mainCashDelta: 0, earnedDelta: 0, ...detail };
    tx.create(db.doc(`${rootPath(context.scope)}/wis_stock_history/${id}`), entry);
  }
  function postGeneralTransfer(tx, context, transfer) {
    const { wallet, economy } = context.loaded, delta = transfer.effects.mainCashDelta, timestamp = Timestamp.fromMillis(context.atMs);
    const type = delta < 0 ? 'STOCK_TRANSFER_OUT' : 'STOCK_TRANSFER_IN', receipt = transfer.receipt;
    const sourceId = `wis_stock_transfer:${receipt.id}`, ledgerEntryId = `wisled_${hash([context.scope.semesterId, wallet.accountId, type, sourceId].join('\n'))}`;
    const totals = { balance: sum([wallet.balance, delta]), earnedTotal: sum([wallet.earnedTotal, transfer.effects.earnedDelta]),
      rankEarnedTotal: wallet.rankEarnedTotal, spentTotal: wallet.spentTotal, adjustedTotal: sum([wallet.adjustedTotal, delta]) };
    const revision = sum([wallet.revision, 1]);
    const ledger = { schemaVersion: 1, policyVersion: 'w7-v1', ledgerEntryId, semesterId: context.scope.semesterId,
      accountId: wallet.accountId, studentUid: context.actor.uid, type, activityType: delta < 0 ? 'wis_stock_deposit' : 'wis_stock_withdrawal',
      delta, balanceBefore: wallet.balance, balanceAfter: totals.balance, sourceId, stockTransferId: receipt.id,
      principalReturned: receipt.principalReturned, withdrawnProfit: receipt.withdrawnProfit,
      reason: delta < 0 ? '위스피 계좌 입금' : '위스피 계좌 출금', actorUid: context.actor.uid, actorRole: 'student', initiatedByUid: context.actor.uid,
      commandId: receipt.id, receiptId: `${rootPath(context.scope)}/wis_stock_transfer_receipts/${receipt.id}`, createdAt: timestamp,
      targetDate: wisStockKstSession(context.atMs).dayKey };
    tx.create(db.doc(`semester_wis_ledger/${ledgerEntryId}`), ledger);
    tx.set(db.doc(`semester_wis_accounts/${wallet.accountId}`), { ...totals, revision, updatedAt: timestamp, updatedBy: context.actor.uid,
      recentLedgerEntries: [ledger, ...wallet.recentLedgerEntries].slice(0, 100) }, { merge: true });
    const common = { schemaVersion: 1, policyVersion: 'w7-v1', accountId: wallet.accountId, studentUid: context.actor.uid,
      semesterId: context.scope.semesterId, ledgerRevision: revision, updatedAt: timestamp };
    tx.set(db.doc(`semester_wis_balances/${wallet.accountId}`), { ...common, ...totals }, { merge: true });
    tx.set(db.doc(`semester_wis_rankings/${wallet.accountId}`), { ...common, displayName: wallet.displayName || '', classId: wallet.classId,
      grade: wallet.grade || '', classNumber: wallet.classNumber || '', balance: totals.balance, earnedTotal: totals.earnedTotal, rankEarnedTotal: totals.rankEarnedTotal }, { merge: true });
    tx.set(db.doc(`semester_wis_economies/${context.scope.semesterId}`), { revision: sum([economy.revision, 1]),
      ledgerEntryCount: sum([economy.ledgerEntryCount, 1]), updatedAt: timestamp, updatedBy: context.actor.uid }, { merge: true });
    return totals.balance;
  }
  const updateRoster = (next, context) => {
    if (context.loaded) Object.assign(next, rosterFor(context.loaded.wallet, context.scope, context.actor.uid), { boardEligible: true });
    next.updatedAtMs = context.atMs;
    return validateAccount(next, context.scope, context.actor.uid);
  };
  const checked = handler => async request => {
    try { return await handler(request); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      if (typeof error?.reason === 'string') fail(error.reason, error.message);
      if (error?.code === 10 || (error?.code === 3 && /Transaction is invalid or closed/i.test(error.message || '')))
        fail('WIS_STOCK_RETRY_REQUIRED', '다른 거래가 함께 처리되고 있습니다. 같은 요청으로 다시 시도해 주세요.', 'aborted');
      throw error;
    }
  };
  const getStudentWisStockState = checked(async request => {
    validateInput(request.data, []);
    const scope = scopeOf(request.data), actor = await actorFor(request);
    return db.runTransaction(async tx => state(await load(tx, scope, actor, now())), { readOnly: true });
  });
  function addBonus(next, bonus) {
    if (!bonus) return;
    next.stockCash = sum([next.stockCash, bonus.amount]);
    // Reward principal is not trading profit. Returning it to the main wallet
    // later must not inflate earnedTotal or activity rank a second time.
    next.outstandingPrincipal = sum([next.outstandingPrincipal, bonus.amount]);
    next.eventBonusTotal = sum([next.eventBonusTotal || 0, bonus.amount]);
    next.revision = sum([next.revision, 1]);
  }
  function writeBonus(tx, context, next, bonus) {
    if (!bonus) return;
    tx.create(db.doc(campaignReceiptPath(context.actor.uid)), bonus);
    history(tx, context, next, 'EVENT_BONUS', bonus.campaignId,
      { campaignId: bonus.campaignId, amount: bonus.amount, stockCashDelta: bonus.amount,
        outstandingPrincipalDelta: bonus.amount });
  }
  // Internal-only operator runner; deliberately not exported as a callable.
  // It uses the same live receipt transaction as an incoming transfer.
  const grantWisStockDepositBonus = async ({ year, semester, uid, dryRun = true }) => {
    const scope = scopeOf({ year, semester });
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) fail('WIS_STOCK_INPUT_INVALID');
    return mutate(scope, async tx => {
      const loaded = await createStudentWisWallet({ db, validateStudentProfile: value => {
        if (value.disabled || value.weplayDeletionPending) fail('WIS_STOCK_STUDENT_REQUIRED');
      } }).read(tx, scope, uid);
      const [accountSnap, marketSnap] = await tx.getAll(db.doc(accountPath(scope, uid)), db.doc(`${rootPath(scope)}/wis_stock_markets/current`));
      const atMs = now();
      const account = accountSnap.exists ? validateAccount(accountSnap.data(), scope, uid)
        : blankAccount(scope, uid, loaded.wallet, atMs);
      const bonus = await prepareDepositBonus({ db, tx, uid, account, atMs, allowDisabled: dryRun });
      if (!bonus || dryRun) return { eligible: !!bonus, changed: false, amount: bonus?.amount || 0 };
      const market = readMarket(marketSnap, scope), next = structuredClone(account);
      const context = { scope, actor: { uid }, atMs, loaded };
      addBonus(next, bonus); updateRoster(next, context);
      const writeBoards = await prepareBoard(tx, scope, market, account, next);
      tx.set(db.doc(accountPath(scope, uid)), next); writeBonus(tx, context, next, bonus); writeBoards();
      return { eligible: true, changed: true, amount: bonus.amount };
    });
  };
  const transferStudentWisStock = checked(async request => {
    const input = request.data;
    validateInput(input, ['requestId', 'direction', 'amount']);
    const scope = scopeOf(input), actor = await actorFor(request);
    if (!requestIdValid(input.requestId)) fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
    const id = `stocktr_${hash(`${scope.semesterId}\n${actor.uid}\n${input.requestId}`)}`;
    return mutate(scope, async tx => {
      const context = await load(tx, scope, actor, now()), account = context.account;
      const receiptRef = db.doc(`${rootPath(scope)}/wis_stock_transfer_receipts/${id}`), receiptSnap = await tx.get(receiptRef);
      const transfer = planWisStockTransfer({ transferId: id, accountId: account.accountId, semesterId: scope.semesterId,
        direction: input.direction, amount: input.amount, nowMs: context.atMs,
        snapshot: { mainCash: context.loaded.wallet.balance, stockCash: account.stockCash, reservedCash: account.reservedCash,
          outstandingPrincipal: account.outstandingPrincipal, lastDepositAtMs: account.lastDepositAtMs },
        existingReceipt: receiptSnap.exists ? receiptSnap.data() : null });
      if (!transfer.changed) return { changed: false, duplicate: true, receipt: transfer.receipt, state: state(context) };
      assertOpen(context);
      const next = structuredClone(account), effect = transfer.effects;
      next.stockCash = sum([next.stockCash, effect.stockCashDelta]);
      next.outstandingPrincipal = sum([next.outstandingPrincipal, effect.outstandingPrincipalDelta]);
      if (effect.lastDepositAtMs !== null) next.lastDepositAtMs = effect.lastDepositAtMs;
      next.revision = sum([next.revision, 1]);
      const transferSequence = next.revision;
      const bonus = input.direction === 'DEPOSIT' ? await prepareDepositBonus({ db, tx, uid: actor.uid,
        account, incomingDeposit: input.amount, atMs: context.atMs }) : null;
      addBonus(next, bonus); updateRoster(next, context);
      const writeBoards = await prepareBoard(tx, scope, context.market, account, next);
      const mainCash = postGeneralTransfer(tx, context, transfer);
      tx.set(db.doc(accountPath(scope, actor.uid)), next);
      tx.create(receiptRef, transfer.receipt);
      history(tx, context, { ...next, revision: transferSequence }, input.direction, id, { amount: input.amount, stockCashDelta: effect.stockCashDelta,
        mainCashDelta: effect.mainCashDelta, earnedDelta: effect.earnedDelta,
        principalReturned: transfer.receipt.principalReturned, withdrawnProfit: transfer.receipt.withdrawnProfit });
      writeBonus(tx, context, next, bonus); writeBoards();
      return { changed: true, duplicate: false, receipt: transfer.receipt, bonusAmount: bonus?.amount || 0, state: state(context, next, mainCash, true) };
    });
  });
  const placeStudentWisStockOrder = checked(async request => {
    const input = request.data;
    validateInput(input, ['requestId', 'stockId', 'side', 'quantity', 'quote']);
    const scope = scopeOf(input), actor = await actorFor(request);
    if (!requestIdValid(input.requestId) || !/^stock_[a-f0-9]{24}$/.test(input.stockId || '')
      || !['BUY', 'SELL'].includes(input.side) || !safe(input.quantity, 1)
      || !record(input.quote) || Object.keys(input.quote).sort().join(',') !== 'atMs,marketRevision,price'
      || !safe(input.quote.price, 1) || !safe(input.quote.atMs, 1) || !safe(input.quote.marketRevision))
      fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
    const id = `stockord_${hash(`${scope.semesterId}\n${actor.uid}\n${input.requestId}`)}`;
    const payloadHash = hash(JSON.stringify([input.stockId, input.side, input.quantity, input.quote.price, input.quote.atMs, input.quote.marketRevision]));
    // Draw only once per logical request; Firestore may retry the transaction body.
    const delay = delaySeconds();
    return mutate(scope, async tx => {
      const context = await load(tx, scope, actor, now()), account = context.account;
      const orderRef = db.doc(orderPath(scope, id)), old = await tx.get(orderRef);
      if (old.exists) {
        const order = old.data();
        if (order.studentUid !== actor.uid || order.accountId !== account.accountId || order.payloadHash !== payloadHash)
          fail('WIS_STOCK_REQUEST_CONFLICT');
        return { changed: false, duplicate: true, order: safeOrder(order), state: state(context) };
      }
      assertOpen(context);
      if (!context.accountExists) fail('WIS_STOCK_ACCOUNT_REQUIRED', '먼저 주식 계좌에 위스를 입금해 주세요.');
      if (Object.keys(account.pendingOrders).length >= MAX_PENDING) fail('WIS_STOCK_PENDING_LIMIT');
      const stock = context.market.stocks.find(item => item.id === input.stockId);
      if (!stock) fail('WIS_STOCK_NOT_FOUND');
      const supplyRef = db.doc(`${rootPath(scope)}/wis_stock_supplies/${stock.id}`), supply = supplyFor(await tx.get(supplyRef), stock, scope);
      if ((supply.holders[account.studentKey] || 0) !== (account.positions[stock.id]?.quantity || 0)) fail('WIS_STOCK_SUPPLY_INVALID');
      if (input.quote.atMs > context.atMs + 5000) fail('WIS_STOCK_QUOTE_EXPIRED');
      const transition = acceptWisStockOrder({ orderId: id, accountId: account.accountId, semesterId: scope.semesterId,
        delaySeconds: delay, reservations: reservationsFor(account, stock.id), supplyReservedBuyQuantity: supply.reservedBuyQuantity,
        quoteInput: { rules: context.market.rules, side: input.side, quantity: input.quantity, nowMs: context.atMs,
          marketRevision: context.market.revision, stock: { id: stock.id, price: stock.price, availableShares: supply.availableShares,
            settings: { issuedShares: stock.settings.issuedShares, lotSize: stock.settings.lotSize, tradingStatus: stock.settings.tradingStatus },
            haltedUntilMs: stock.haltedUntilMs || 0 },
          quote: { ...input.quote, stockId: stock.id, atMs: Math.min(context.atMs, input.quote.atMs) },
          portfolio: portfolioFor(account, context.market, stock.id) } });
      const { next, nextSupply } = applyOrder(account, supply, transition); updateRoster(next, context);
      const rawOrder = { ...transition.order, studentUid: actor.uid, year: scope.year, semester: scope.semester,
        authTime: actor.authTime, sessionRevision: actor.revision, tradingEpoch: context.market.tradingEpoch || 0, payloadHash };
      const writeBoards = await prepareBoard(tx, scope, context.market, account, next, new Map([[stock.id, nextSupply]]));
      tx.set(db.doc(accountPath(scope, actor.uid)), next); tx.set(supplyRef, nextSupply); tx.create(orderRef, rawOrder);
      history(tx, context, next, 'ORDER_ACCEPTED', id, { stockId: stock.id, side: input.side, quantity: input.quantity,
        unitPrice: transition.order.unitPrice, fee: transition.order.fee, orderId: id });
      writeBoards();
      return { changed: true, duplicate: false, order: safeOrder(rawOrder), state: state(context, next) };
    });
  });
  async function finishOrder(tx, scope, rawOrder, context, cancel) {
    const account = context.account;
    if (!account || !account.pendingOrders[rawOrder.id]
      || account.pendingOrders[rawOrder.id].requestKey !== rawOrder.requestKey) fail('WIS_STOCK_RESERVATION_INVALID');
    const stock = context.market.stocks.find(item => item.id === rawOrder.stockId);
    if (!stock) fail('WIS_STOCK_NOT_FOUND');
    const supplyRef = db.doc(`${rootPath(scope)}/wis_stock_supplies/${stock.id}`), supply = supplyFor(await tx.get(supplyRef), stock, scope);
    if ((supply.holders[account.studentKey] || 0) !== (account.positions[stock.id]?.quantity || 0)) fail('WIS_STOCK_SUPPLY_INVALID');
    const pureOrder = account.pendingOrders[rawOrder.id];
    if (Object.keys(pureOrder).some(key => pureOrder[key] !== rawOrder[key])) fail('WIS_STOCK_RESERVATION_INVALID');
    const input = { order: pureOrder, accountId: account.accountId, semesterId: scope.semesterId, nowMs: context.atMs,
      portfolio: portfolioFor(account, context.market, stock.id), reservations: reservationsFor(account, stock.id),
      supply: { issuedShares: supply.issuedShares, availableShares: supply.availableShares, reservedBuyQuantity: supply.reservedBuyQuantity } };
    let menuAllowed = true;
    try { assertStudentWispiMenuVisible(context.config); } catch { menuAllowed = false; }
    const transition = cancel ? cancelWisStockOrder(input) : finalizeWisStockOrder({ ...input, execution: {
      serviceAllowed: context.market.studentOpen && menuAllowed && rawOrder.tradingEpoch === (context.market.tradingEpoch || 0),
      authorized: context.authorized, scopeActive: context.active, marketHalted: context.market.rules.halted,
      tradingStatus: stock.settings.tradingStatus, haltedUntilMs: stock.haltedUntilMs || 0 } });
    const { next, nextSupply } = applyOrder(account, supply, transition); updateRoster(next, context);
    const writeBoards = await prepareBoard(tx, scope, context.market, account, next, new Map([[stock.id, nextSupply]]));
    const resultOrder = { ...rawOrder, ...transition.order };
    tx.set(db.doc(accountPath(scope, context.actor.uid)), next); tx.set(supplyRef, nextSupply);
    tx.set(db.doc(orderPath(scope, rawOrder.id)), resultOrder);
    history(tx, context, next, transition.order.status === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_CANCELLED', rawOrder.id,
      { orderId: rawOrder.id, stockId: rawOrder.stockId, side: rawOrder.side, quantity: rawOrder.quantity, unitPrice: rawOrder.unitPrice,
        fee: rawOrder.fee, stockCashDelta: transition.effects.stockCashDelta, realizedPnl: transition.effects.cumulativeRealizedPnlDelta,
        ...(transition.order.cancellationReason ? { cancellationReason: transition.order.cancellationReason } : {}) });
    writeBoards();
    return { changed: true, duplicate: false, order: safeOrder(resultOrder), next };
  }
  const cancelStudentWisStockOrder = checked(async request => {
    validateInput(request.data, ['orderId']);
    const scope = scopeOf(request.data), actor = await actorFor(request), id = request.data.orderId;
    if (!orderIdValid(id)) fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
    return mutate(scope, async tx => {
      const context = await load(tx, scope, actor, now()), snapshot = await tx.get(db.doc(orderPath(scope, id)));
      if (!snapshot.exists || snapshot.data().studentUid !== actor.uid || snapshot.data().accountId !== context.account.accountId)
        fail('WIS_STOCK_ORDER_NOT_FOUND', undefined, 'not-found');
      const order = snapshot.data();
      if (order.status !== 'PENDING') return { changed: false, duplicate: true, order: safeOrder(order), state: state(context) };
      const result = await finishOrder(tx, scope, order, context, true);
      return { changed: result.changed, duplicate: false, order: result.order, state: state(context, result.next) };
    });
  });
  const getStudentWisStockHistory = checked(async request => {
    const input = request.data; validateInput(input, ['cursor', 'limit']);
    const scope = scopeOf(input), actor = await actorFor(request), limit = input.limit ?? 20;
    if (!safe(limit, 1) || limit > 50 || (input.cursor !== undefined && typeof input.cursor !== 'string')) fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
    let cursor;
    if (input.cursor) {
      try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); } catch { fail('WIS_STOCK_CURSOR_INVALID'); }
      if (input.cursor.length > 1000 || !record(cursor) || cursor.scope !== scope.semesterId || cursor.accountId !== accountIdFor(scope.semesterId, actor.uid)
        || !safe(cursor.sequence, 1) || !/^stockhist_[a-f0-9]{64}$/.test(cursor.id)) fail('WIS_STOCK_CURSOR_INVALID');
    }
    return db.runTransaction(async tx => {
      const context = await load(tx, scope, actor, now());
      let query = db.collection(`${rootPath(scope)}/wis_stock_history`).where('accountId', '==', context.account.accountId)
        .orderBy('sequence', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit + 1);
      if (cursor) query = query.startAfter(cursor.sequence, cursor.id);
      const snapshot = await tx.get(query), hasMore = snapshot.docs.length > limit, docs = snapshot.docs.slice(0, limit);
      const rows = docs.map(doc => {
        const row = doc.data();
        if (row.studentUid !== actor.uid || row.semesterId !== scope.semesterId || row.accountId !== context.account.accountId) fail('WIS_STOCK_HISTORY_INVALID');
        return Object.fromEntries(['id', 'kind', 'atMs', 'stockId', 'side', 'quantity', 'unitPrice', 'amount', 'fee', 'orderId',
          'stockCashDelta', 'mainCashDelta', 'earnedDelta', 'realizedPnl', 'principalReturned', 'withdrawnProfit', 'cancellationReason', 'campaignId', 'automaticSettlement']
          .filter(key => row[key] !== undefined).map(key => [key, row[key]]));
      });
      const last = docs.at(-1);
      return { semesterId: scope.semesterId, entries: rows, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ scope: scope.semesterId,
        accountId: context.account.accountId, sequence: last.data().sequence, id: last.id })).toString('base64url') : '' };
    }, { readOnly: true });
  });
  async function settleOne(scope, id) {
    if (!orderIdValid(id)) fail('WIS_STOCK_ORDER_INVALID');
    return mutate(scope, async tx => {
      const snapshot = await tx.get(db.doc(orderPath(scope, id)));
      if (!snapshot.exists) return { changed: false, missing: true };
      const order = snapshot.data();
      if (order.status !== 'PENDING') return { changed: false, duplicate: true, order: safeOrder(order) };
      if (order.semesterId !== scope.semesterId || order.id !== id || order.accountId !== accountIdFor(scope.semesterId, order.studentUid)) fail('WIS_STOCK_ORDER_INVALID');
      const actor = { uid: order.studentUid, authTime: order.authTime, revision: order.sessionRevision };
      const context = await load(tx, scope, actor, now(), { task: true });
      const result = await finishOrder(tx, scope, order, context, false);
      return { changed: result.changed, duplicate: false, order: result.order };
    });
  }
  async function enqueue(data, id, atMs) {
    try { await enqueueTask(data, { id, scheduleTime: new Date(atMs), dispatchDeadlineSeconds: 60 }); }
    catch (error) { if (error?.code !== 'functions/task-already-exists' && error?.code !== 6) throw error; }
  }
  async function sweep(scope, afterId = '', generation = 0) {
    if (afterId && !orderIdValid(afterId)) fail('WIS_STOCK_TASK_INVALID');
    let query = db.collection(`${rootPath(scope)}/wis_stock_orders`).where('status', '==', 'PENDING').orderBy(FieldPath.documentId()).limit(50);
    if (afterId) query = query.startAfter(afterId);
    const snapshot = await query.get();
    const results = [], failures = [];
    for (const doc of snapshot.docs) {
      try { results.push(await settleOne(scope, doc.id)); }
      catch (error) { if (error?.reason !== 'WIS_STOCK_ORDER_NOT_DUE' && error?.details?.reason !== 'WIS_STOCK_ORDER_NOT_DUE')
        failures.push(error?.details?.reason || error?.reason || String(error?.code || 'UNKNOWN')); }
    }
    // Advance by immutable document ID, including past new orders accepted
    // after reopening. They must not hide older reservations further down.
    if (snapshot.size === 50) {
      const nextId = snapshot.docs.at(-1).id, id = `sweep_${hash(`${scope.semesterId}\n${generation}\n${nextId}`)}`;
      await enqueue({ kind: 'SWEEP', year: scope.year, semester: scope.semester, afterId: nextId, generation }, id, now() + 1000);
    }
    if (failures.length) console.error('Wis stock sweep retained failed orders for recovery.', { count: failures.length, reasons: [...new Set(failures)] });
    return { examined: snapshot.size, changed: results.filter(result => result.changed).length, ...(failures.length ? { failed: failures.length } : {}) };
  }
  const graduation = createWisStockGraduation({ db, now, mutate, scopeOf, rootPath, accountPath, orderPath,
    hash, fail, sum, multiply, validateAccount, readMarket, supplyFor, portfolioFor, reservationsFor,
    applyOrder, cancelWisStockOrder, prepareBoard, history, enqueue, FieldPath });
  const settleWisStockOrderTask = checked(async request => {
    const data = request.data, scope = scopeOf(data);
    if (data.kind === 'GRADUATION') return graduation.sweepGraduation(scope, data.stockId, data.after || null, data.generation || 0);
    if (data.kind === 'SWEEP') return sweep(scope, data.afterId || '', data.generation || 0);
    if (data.kind !== 'ORDER') fail('WIS_STOCK_TASK_INVALID');
    return settleOne(scope, data.orderId);
  });
  async function onWisStockOrderCreated(event) {
    const snapshot = event.data;
    if (!snapshot?.exists) return;
    const order = snapshot.data(), scope = scopeOf({ year: event.params.year, semester: event.params.semester });
    if (order.status !== 'PENDING' || !orderIdValid(order.id) || !safe(order.dueAtMs, 1)) return;
    await enqueue({ kind: 'ORDER', year: scope.year, semester: scope.semester, orderId: order.id }, order.id, Math.max(now(), order.dueAtMs));
  }
  async function onWisStockMarketTradingWrite(event) {
    if (!event.data?.after?.exists) return;
    const scope = scopeOf({ year: event.params.year, semester: event.params.semester });
    const before = event.data.before?.data() || {}, after = event.data.after.data();
    if ((after.tradingEpoch || 0) > (before.tradingEpoch || 0) || (after.rules?.halted && !before.rules?.halted)) await sweep(scope, '', after.tradingEpoch || 0);
    for (const stock of after.stocks || []) {
      if (stock.settings?.tradingStatus !== 'GRADUATED'
        || (before.stocks || []).some(old => old.id === stock.id && old.settings?.tradingStatus === 'GRADUATED')) continue;
      // Holders' reservations are cancelled in the liquidation transaction.
      // Buy-only accounts already have a due-time task (<= 60 seconds); its
      // execution gate cancels them. Do not sweep unrelated stocks' orders.
      const generation = after.revision || 0;
      await enqueue({ kind: 'GRADUATION', year: scope.year, semester: scope.semester, stockId: stock.id, generation },
        `grad_${hash(`${scope.semesterId}\n${stock.id}\n${generation}\nMARKET`)}`, now());
    }
    return mutate(scope, async tx => {
      const market = readMarket(await tx.get(db.doc(`${rootPath(scope)}/wis_stock_markets/current`)), scope);
      const writeBoards = await prepareBoard(tx, scope, market, null, null);
      if (writeBoards) writeBoards();
      return { changed: !!writeBoards };
    });
  }
  async function recoverWisStockOrders() {
    const snapshot = await db.collectionGroup('wis_stock_orders').where('status', '==', 'PENDING')
      .where('dueAtMs', '<=', now()).orderBy('dueAtMs', 'asc').limit(50).get();
    let changed = 0; const failures = [];
    // Bounded fallback for a failed enqueue/trigger. Durable orders remain for
    // the next pass, while normal settlement is dispatched at its exact due time.
    for (const doc of snapshot.docs) {
      const parts = doc.ref.path.split('/');
      try {
        if (parts.length !== 6 || parts[0] !== 'years' || parts[2] !== 'semesters') fail('WIS_STOCK_ORDER_INVALID');
        const result = await settleOne(scopeOf({ year: parts[1], semester: parts[3] }), doc.id);
        if (result.changed) changed++;
      } catch (error) { failures.push(error?.details?.reason || error?.reason || String(error?.code || 'UNKNOWN')); }
    }
    if (failures.length) console.error('Wis stock recovery retained failed orders.', { count: failures.length, reasons: [...new Set(failures)] });
    const graduated = await graduation.recoverGraduations();
    return { examined: snapshot.size, changed, graduationJobsQueued: graduated.queued, ...(failures.length ? { failed: failures.length } : {}) };
  }
  async function onWisStockEnrollmentSlotWritten(event) {
    const candidate = event.data?.after?.data() || event.data?.before?.data();
    if (!candidate || !/^20\d{2}-[12]$/.test(candidate.semesterId || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.studentUid || '')) return { changed: false };
    const [year, semester] = candidate.semesterId.split('-'), scope = scopeOf({ year, semester }), uid = candidate.studentUid;
    const slotId = `slot_${hash(`${scope.semesterId}\n${uid}`).slice(0, 40)}`;
    if (event.params.slotId !== slotId) fail('WIS_STOCK_SCOPE_CHANGED');
    return mutate(scope, async tx => {
      const [slotSnap, accountSnap] = await tx.getAll(db.doc(`semester_enrollment_slots/${slotId}`), db.doc(accountPath(scope, uid)));
      if (!accountSnap.exists) return { changed: false };
      // Late Eventarc deliveries from an archived semester must not repeatedly
      // enter the active-wallet guard or rewrite historical projections.
      const pointer = await tx.get(db.doc('site_settings/semester_active'));
      if (pointer.data()?.semesterId !== scope.semesterId) return { changed: false };
      const previous = validateAccount(accountSnap.data(), scope, uid), next = structuredClone(previous), slot = slotSnap.data();
      const eligible = !!slot && slot.studentUid === uid && slot.semesterId === scope.semesterId
        && (slot.status === undefined || slot.status === 'ACTIVE') && typeof slot.activeEnrollmentId === 'string' && !!slot.activeEnrollmentId;
      if (eligible) {
        const loaded = await createStudentWisWallet({ db }).read(tx, scope, uid);
        Object.assign(next, rosterFor(loaded.wallet, scope, uid));
      }
      next.boardEligible = eligible;
      const metadata = ['studentKey', 'grade', 'classNumber', 'studentNumber', 'displayName', 'enrollmentId', 'enrollmentSlotId', 'classId'];
      if ((previous.boardEligible !== false) === eligible && metadata.every(key => next[key] === previous[key])) return { changed: false };
      next.revision = sum([next.revision, 1]); next.updatedAtMs = now();
      const market = readMarket(await tx.get(db.doc(`${rootPath(scope)}/wis_stock_markets/current`)), scope);
      const writeBoards = await prepareBoard(tx, scope, market, previous, next);
      tx.set(db.doc(accountPath(scope, uid)), next); writeBoards();
      return { changed: true };
    });
  }
  return { getStudentWisStockState, transferStudentWisStock, placeStudentWisStockOrder, cancelStudentWisStockOrder,
    getStudentWisStockHistory, settleWisStockOrderTask, onWisStockOrderCreated, onWisStockMarketTradingWrite, recoverWisStockOrders,
    onWisStockEnrollmentSlotWritten, grantWisStockDepositBonus };
}
module.exports = { createWisStockTrading, createWisStockTradingHandlers: createWisStockTrading };
