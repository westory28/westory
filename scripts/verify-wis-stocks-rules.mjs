// firebase emulators:exec --only firestore --config firebase.wis-stocks-test.json --project demo-westory-wis-stocks "node scripts/verify-wis-stocks-rules.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
const projectId = 'demo-westory-wis-stocks';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18256');
const auditedSources = ['functions/wisStocks.js', 'functions/wisStockMarketRules.mjs', 'functions/wisStockOrderLifecycle.mjs',
  'functions/wisStockOrderLifecycle.js', 'functions/wisStockAccount.mjs', 'firestore.rules', 'scripts/verify-wis-stocks-rules.mjs'];
const hashAuditedSources = () => Object.fromEntries(auditedSources
  .map(file => [file, createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex')]));
const initialSourceHashes = hashAuditedSources();
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisStockHandlers } = require('./wisStocks');
const { accountIdFor } = require('./studentWisWallet');
const { inspectWisLedger } = require('./wisLedgerIntegrity');
const { DEFAULT_WIS_STOCK_MARKET_RULES, normalizeWisStockMarketRules, quoteWisStockOrder } = require('./wisStockMarketRules');
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18256, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const app = initializeApp({ projectId }), db = getFirestore(app);
const root = 'years/2026/semesters/2';
// Monday 10:00 KST, then later hourly slots remain inside the default session.
let clock = Date.parse('2026-11-16T01:00:00Z');
const commits = [], rejected = [], reads = [];
const observedDb = {
  doc: path => db.doc(path),
  async runTransaction(callback, options) {
    const attempts = [];
    try {
      const result = await db.runTransaction(async transaction => {
        const attempt = { reads: [], writes: [] }; attempts.push(attempt);
        const wrapped = {
          async get(ref, ...options) { attempt.reads.push(ref.path || 'query'); reads.push(ref.path || 'query'); return transaction.get(ref, ...options); },
          async getAll(...refs) { for (const ref of refs.filter(ref => ref.path)) { attempt.reads.push(ref.path); reads.push(ref.path); } return transaction.getAll(...refs); },
        };
        for (const operation of ['set', 'create', 'update', 'delete']) wrapped[operation] = (ref, ...args) => {
          attempt.writes.push({ operation, path: ref.path }); transaction[operation](ref, ...args); return wrapped;
        };
        return callback(wrapped);
      }, options);
      commits.push({ attempts: attempts.length, reads: attempts.flatMap(attempt => attempt.reads).length, writes: attempts.at(-1)?.writes || [] });
      return result;
    } catch (error) { rejected.push({ attempts: attempts.length, reason: error.details?.reason || error.code || 'rejected' }); throw error; }
  },
};
const api = createWisStockHandlers({ db: observedDb, assertSession: async request => ({ uid: request.auth.uid, email: request.auth.token.email }), now: () => clock });
const request = data => ({ auth: { uid: 'manager', token: { email: 'manager@yongshin-ms.ms.kr' } }, data: { year: '2026', semester: '2', ...data } });
const settings = { name: '합성 주식', description: '', period: '합성 시대', initialPrice: 100, minimumPrice: 1, maximumPrice: 1000, volatilityBps: 0, trendBps: 300, intervalHours: 1, automatic: true };
const totalWrites = () => commits.reduce((sum, commit) => sum + commit.writes.length, 0);
const accountId = accountIdFor('2026-2', 'student');
const protectedData = { schemaVersion: 1, policyVersion: 'w7-v1', accountId, studentUid: 'student', semesterId: '2026-2',
  status: 'ACTIVE', enrollmentId: 'synthetic-enrollment', classId: 'synthetic-class',
  balance: 700, earnedTotal: 900, rankEarnedTotal: 400, spentTotal: 200, adjustedTotal: 400, revision: 4 };
const ledgerEntries = [
  ['synthetic-initial', 'INITIAL_GRANT', 500, 0, 500], ['synthetic-grant', 'GRANT', 400, 500, 900],
  ['synthetic-order', 'ORDER_DEBIT', -200, 900, 700],
].map(([ledgerEntryId, type, delta, balanceBefore, balanceAfter]) => ({ ledgerEntryId, accountId, studentUid: 'student',
  semesterId: '2026-2', type, delta, balanceBefore, balanceAfter }));
assert.deepEqual(inspectWisLedger(protectedData, ledgerEntries).issues, []);
const protectedDocuments = new Map([
  [`semester_wis_accounts/${accountId}`, { ...protectedData, recentLedgerEntries: ledgerEntries }],
  [`semester_wis_balances/${accountId}`, { ...protectedData, ledgerRevision: 4 }],
  [`semester_wis_rankings/${accountId}`, { ...protectedData, ledgerRevision: 4 }],
  ...ledgerEntries.map(entry => [`semester_wis_ledger/${entry.ledgerEntryId}`, entry]),
  ['semester_wis_economies/2026-2', { semesterId: '2026-2', status: 'ACTIVE_OPEN', ledgerEntryCount: 3, revision: 4 }],
  [`${root}/point_wallets/student`, protectedData], [`${root}/point_transactions/synthetic-entry`, ledgerEntries[0]],
]);
const protectedPaths = [...protectedDocuments.keys()];
const checks = [];
const verifyQuoteMath = () => {
  const rules = normalizeWisStockMarketRules({ ...DEFAULT_WIS_STOCK_MARKET_RULES, buyFeeBps: 0, sellFeeBps: 0,
    minimumCashReserve: 0, maxConcentrationBps: 10000, cooldownSeconds: 0 });
  const seed = () => ({ rules, side: 'SELL', quantity: 1, nowMs: clock, marketRevision: 7,
    stock: { id: 'stock_' + 'a'.repeat(24), price: 200, availableShares: 999,
      settings: { issuedShares: 1000, lotSize: 1, tradingStatus: 'ACTIVE' } },
    quote: { stockId: 'stock_' + 'a'.repeat(24), price: 200, atMs: clock, marketRevision: 7 },
    portfolio: { cashBalance: 1000, holdingQuantity: 1, holdingPrincipal: 100, holdingCostBasis: 100,
      portfolioValue: 1200, dayKey: '2026-11-16', dailyBuyAmount: 0, dailyOrderCount: 0, lastOrderAtMs: 0,
      cumulativeRealizedPnl: 0, profitHighWatermark: 0 } });
  const earned = [], pnl = []; let cumulative = 0, highWatermark = 0;
  for (const price of [200, 20, 180]) {
    const input = seed(); input.stock.price = input.quote.price = price;
    input.portfolio.portfolioValue = 1000 + price;
    input.portfolio.cumulativeRealizedPnl = cumulative; input.portfolio.profitHighWatermark = highWatermark;
    const before = structuredClone(input), result = quoteWisStockOrder(input);
    assert.deepEqual(input, before, 'Quote is immutable');
    earned.push(result.earnedDelta); pnl.push(result.realizedPnl);
    cumulative = result.cumulativeRealizedPnl; highWatermark = result.profitHighWatermark;
    assert.equal(result.rankEarnedDelta, 0); assert.equal(result.executable, false); assert.equal(result.studentOpen, false);
  }
  assert.deepEqual(pnl, [100, -80, 80]); assert.deepEqual(earned, [0, 0, 0]); assert.equal(cumulative, 100); assert.equal(highWatermark, 100);
  const split = seed(); split.stock.price = split.quote.price = 500; split.stock.availableShares = 997;
  Object.assign(split.portfolio, { holdingQuantity: 3, holdingPrincipal: 1000, holdingCostBasis: 1001, portfolioValue: 2500 });
  let removedPrincipal = 0, removedCost = 0;
  for (let index = 0; index < 3; index++) {
    const result = quoteWisStockOrder(split); removedPrincipal += result.principalRemoved; removedCost += result.costBasisRemoved;
    Object.assign(split.portfolio, { cashBalance: result.nextCashBalance, holdingQuantity: result.nextHoldingQuantity,
      holdingPrincipal: result.nextHoldingPrincipal, holdingCostBasis: result.nextHoldingCostBasis,
      portfolioValue: result.nextCashBalance + result.nextHoldingQuantity * split.stock.price,
      cumulativeRealizedPnl: result.cumulativeRealizedPnl, profitHighWatermark: result.profitHighWatermark });
    split.stock.availableShares = result.nextAvailableShares;
  }
  assert.equal(removedPrincipal, 1000); assert.equal(removedCost, 1001);
  assert.equal(split.portfolio.holdingCostBasis, 0); assert.equal(split.portfolio.holdingPrincipal, 0);
  assert.equal(split.portfolio.cumulativeRealizedPnl, 499); assert.equal(split.stock.availableShares, 1000);
  const fee = seed(); fee.side = 'BUY'; fee.stock.price = fee.quote.price = 1; fee.rules = { ...rules, buyFeeBps: 1 };
  assert.equal(quoteWisStockOrder(fee).fee, 1, 'Sub-Wis fee rounds up once using exact integer arithmetic');
  const invalidCases = [
    [input => input.quote.marketRevision--, 'WIS_STOCK_QUOTE_CHANGED'],
    [input => { input.side = 'BUY'; input.stock.availableShares = 0; }, 'WIS_STOCK_ISSUED_LIMIT'],
    [input => input.stock.availableShares = 1000, 'WIS_STOCK_TRADE_INPUT_INVALID'],
    [input => input.portfolio.dayKey = '2026-02-30', 'WIS_STOCK_TRADE_INPUT_INVALID'],
    [input => input.portfolio.dayKey = '2026-11-17', 'WIS_STOCK_TRADE_INPUT_INVALID'],
    [input => input.quantity = Number.MAX_SAFE_INTEGER + 1, 'WIS_STOCK_TRADE_INPUT_INVALID'],
    [input => { input.portfolio.cumulativeRealizedPnl = Number.MAX_SAFE_INTEGER; input.portfolio.profitHighWatermark = Number.MAX_SAFE_INTEGER; }, 'WIS_STOCK_UNSAFE_TOTAL'],
    [input => { input.side = 'BUY'; input.portfolio.holdingCostBasis = Number.MAX_SAFE_INTEGER; }, 'WIS_STOCK_UNSAFE_TOTAL'],
    [input => input.rules = { ...rules, halted: true }, 'WIS_STOCK_MARKET_HALTED'],
    [input => input.stock.settings = { ...input.stock.settings, tradingStatus: 'HALTED' }, 'WIS_STOCK_INSTRUMENT_HALTED'],
  ];
  for (const [mutate, reason] of invalidCases) { const input = seed(); mutate(input); assert.throws(() => quoteWisStockOrder(input), error => error.reason === reason); }
  checks.push('Pure preview math: +100/-80/+80 remains stock-internal PnL/high-watermark with earned/rank 0; partial sales preserve all principal/cost; exact fees, supply, revision, dates, overflow and halt guards; non-executable and zero mutation');
};
const verifyOrderLifecycle = async () => {
  const { EMPTY_WIS_STOCK_RESERVATIONS, acceptWisStockOrder, finalizeWisStockOrder, cancelWisStockOrder } = await import('../functions/wisStockOrderLifecycle.mjs');
  const readsBefore = reads.length, writesBefore = totalWrites();
  const accountId = 'independent-stock-account', semesterId = '2026-2';
  const rules = normalizeWisStockMarketRules({ minimumCashReserve: 0, maxConcentrationBps: 10000 });
  const stockId = 'stock_' + 'c'.repeat(24);
  // An accepted order may complete after the market closes and its 30s quote expires.
  const acceptedAt = Date.parse('2026-11-16T06:59:30Z');
  const quoteInput = { rules, side: 'BUY', quantity: 2, nowMs: acceptedAt, marketRevision: 3,
    stock: { id: stockId, price: 100, availableShares: 1000, settings: { issuedShares: 1000, lotSize: 1, tradingStatus: 'ACTIVE' } },
    quote: { stockId, price: 100, atMs: acceptedAt, marketRevision: 3 },
    portfolio: { cashBalance: 1000, holdingQuantity: 0, holdingPrincipal: 0, holdingCostBasis: 0, portfolioValue: 1000,
      dayKey: '2026-11-16', dailyBuyAmount: 0, dailyOrderCount: 0, lastOrderAtMs: 0, cumulativeRealizedPnl: 0, profitHighWatermark: 0 } };
  const acceptInput = { orderId: 'independent-stock-order-01', accountId, semesterId, quoteInput,
    reservations: { ...EMPTY_WIS_STOCK_RESERVATIONS }, supplyReservedBuyQuantity: 0, delaySeconds: 60 };
  const originalInput = structuredClone(acceptInput), accepted = acceptWisStockOrder(acceptInput);
  assert.deepEqual(acceptInput, originalInput, 'Acceptance is immutable');
  assert.equal(accepted.order.status, 'PENDING'); assert.equal(accepted.order.dueAtMs, acceptedAt + 60000);
  assert.equal(accepted.effects.stockCashDelta, 0); assert.equal(accepted.effects.reservedCashDelta, 202);
  assert.equal(accepted.effects.availableSharesDelta, -2); assert.equal(accepted.effects.marketReservedBuyQuantityDelta, 2);
  assert.equal(accepted.effects.earnedDelta, 0); assert.equal(accepted.effects.rankEarnedDelta, 0);
  const state = {
    portfolio: structuredClone(quoteInput.portfolio), reservations: { ...EMPTY_WIS_STOCK_RESERVATIONS },
    supply: { issuedShares: 1000, availableShares: 1000, reservedBuyQuantity: 0 },
  };
  const apply = (state, effects) => {
    for (const [field, delta] of [['cashBalance', 'stockCashDelta'], ['holdingQuantity', 'holdingQuantityDelta'],
      ['holdingPrincipal', 'holdingPrincipalDelta'], ['holdingCostBasis', 'holdingCostBasisDelta'],
      ['cumulativeRealizedPnl', 'cumulativeRealizedPnlDelta'], ['profitHighWatermark', 'profitHighWatermarkDelta'],
      ['dailyBuyAmount', 'dailyBuyAmountDelta'], ['dailyOrderCount', 'dailyOrderCountDelta']]) state.portfolio[field] += effects[delta];
    for (const [field, delta] of [['cash', 'reservedCashDelta'], ['buyQuantity', 'reservedBuyQuantityDelta'], ['buyFees', 'reservedBuyFeesDelta'],
      ['sellQuantity', 'reservedSellQuantityDelta'], ['sellPrincipal', 'reservedSellPrincipalDelta'], ['sellCostBasis', 'reservedSellCostBasisDelta']]) state.reservations[field] += effects[delta];
    state.supply.availableShares += effects.availableSharesDelta; state.supply.reservedBuyQuantity += effects.marketReservedBuyQuantityDelta;
    if (effects.counterDayKey) state.portfolio.dayKey = effects.counterDayKey;
    if (effects.lastOrderAtMs !== null) state.portfolio.lastOrderAtMs = effects.lastOrderAtMs;
  };
  apply(state, accepted.effects);
  const execution = { serviceAllowed: true, authorized: true, scopeActive: true, marketHalted: false, tradingStatus: 'ACTIVE', haltedUntilMs: 0 };
  const context = (order, nowMs, current = state) => ({ order, accountId, semesterId, nowMs, ...current, execution });
  const zeroFinancialEffects = result => {
    assert.equal(result.changed, false);
    for (const [key, value] of Object.entries(result.effects)) if (key.endsWith('Delta')) assert.equal(value, 0, `Duplicate ${key} must be zero`);
  };
  zeroFinancialEffects(acceptWisStockOrder({ ...acceptInput, existingOrder: accepted.order, reservations: state.reservations }));
  let early;
  try { early = finalizeWisStockOrder(context(accepted.order, accepted.order.dueAtMs - 1)); }
  catch (error) { assert.match(error.reason || '', /^WIS_STOCK_/); }
  if (early) zeroFinancialEffects(early);
  // A separate later deposit is preserved: settlement applies deltas, not stale next balances.
  const fillState = structuredClone(state); fillState.portfolio.cashBalance += 100; fillState.portfolio.portfolioValue += 100;
  const filled = finalizeWisStockOrder(context(accepted.order, accepted.order.dueAtMs, fillState));
  assert.equal(filled.order.status, 'FILLED'); assert.equal(filled.order.unitPrice, 100); assert.equal(filled.order.fee, 2);
  assert.equal(filled.effects.stockCashDelta, -202); assert.equal(filled.effects.holdingQuantityDelta, 2);
  assert.equal(filled.effects.holdingCostBasisDelta, 202); assert.equal(filled.effects.reservedCashDelta, -202);
  apply(fillState, filled.effects);
  assert.equal(fillState.portfolio.cashBalance, 898); assert.equal(fillState.supply.availableShares, 998); assert.equal(fillState.supply.reservedBuyQuantity, 0);
  assert.equal(fillState.portfolio.cashBalance + fillState.portfolio.holdingCostBasis, 1100);
  zeroFinancialEffects(finalizeWisStockOrder(context(filled.order, filled.order.dueAtMs + 1, fillState)));
  zeroFinancialEffects(cancelWisStockOrder(context(filled.order, filled.order.dueAtMs + 1, fillState)));
  for (const block of [{ marketHalted: true }, { authorized: false }, { scopeActive: false }, { serviceAllowed: false }, { tradingStatus: 'HALTED' }, { tradingStatus: 'SELL_ONLY' }, { haltedUntilMs: accepted.order.dueAtMs + 1 }]) {
    const cancelled = finalizeWisStockOrder({ ...context(accepted.order, accepted.order.dueAtMs), execution: { ...execution, ...block } });
    assert.equal(cancelled.order.status, 'CANCELLED'); assert.equal(cancelled.effects.stockCashDelta, 0);
    const restored = structuredClone(state); apply(restored, cancelled.effects);
    assert.equal(restored.portfolio.cashBalance, 1000); assert.equal(restored.portfolio.holdingQuantity, 0);
    assert.equal(restored.reservations.cash, 0); assert.equal(restored.supply.availableShares, 1000); assert.equal(restored.supply.reservedBuyQuantity, 0);
    zeroFinancialEffects(cancelWisStockOrder(context(cancelled.order, accepted.order.dueAtMs + 1, restored)));
    zeroFinancialEffects(finalizeWisStockOrder(context(cancelled.order, accepted.order.dueAtMs + 1, restored)));
  }
  const cancelledEarly = cancelWisStockOrder(context(accepted.order, acceptedAt + 1000));
  assert.equal(cancelledEarly.order.status, 'CANCELLED'); assert.equal(cancelledEarly.effects.reservedCashDelta, -202);
  assert.equal(cancelledEarly.effects.dailyBuyAmountDelta, -202);
  assert.equal(cancelledEarly.effects.dailyOrderCountDelta, 0); assert.equal(cancelledEarly.effects.lastOrderAtMs, null);
  assert.equal(finalizeWisStockOrder({ ...context(accepted.order, accepted.order.dueAtMs), execution: { ...execution, haltedUntilMs: accepted.order.dueAtMs } }).order.status, 'FILLED');
  const tomorrow = structuredClone(state); tomorrow.portfolio.dayKey = '2026-11-17'; tomorrow.portfolio.dailyBuyAmount = 10;
  assert.equal(cancelWisStockOrder(context(accepted.order, acceptedAt + 86400000, tomorrow)).effects.dailyBuyAmountDelta, 0, 'Cancellation cannot release a previous-day reservation from today\'s counter');

  const sellQuote = structuredClone(quoteInput); sellQuote.side = 'SELL'; sellQuote.quantity = 1;
  sellQuote.stock.price = sellQuote.quote.price = 500; sellQuote.stock.availableShares = 997;
  Object.assign(sellQuote.portfolio, { cashBalance: 500, holdingQuantity: 3, holdingPrincipal: 1000, holdingCostBasis: 1001, portfolioValue: 2000 });
  const sellAccepted = acceptWisStockOrder({ ...acceptInput, orderId: 'independent-stock-order-02', quoteInput: sellQuote, delaySeconds: 5 });
  const sellState = { portfolio: structuredClone(sellQuote.portfolio), reservations: { ...EMPTY_WIS_STOCK_RESERVATIONS },
    supply: { issuedShares: 1000, availableShares: 997, reservedBuyQuantity: 0 } };
  apply(sellState, sellAccepted.effects);
  assert.equal(sellState.reservations.sellQuantity, 1); assert.equal(sellState.reservations.sellCostBasis, 333);
  assert.equal(sellState.supply.availableShares, 997, 'Reserved sale does not supply shares before fill');
  const sellFilled = finalizeWisStockOrder({ ...context(sellAccepted.order, sellAccepted.order.dueAtMs, sellState), execution: { ...execution, tradingStatus: 'SELL_ONLY' } });
  assert.equal(sellFilled.order.status, 'FILLED'); assert.equal(sellFilled.effects.stockCashDelta, 495);
  assert.equal(sellFilled.effects.cumulativeRealizedPnlDelta, 162); assert.equal(sellFilled.effects.earnedDelta, 0);
  assert.equal(sellFilled.effects.rankEarnedDelta, 0); assert.equal(sellFilled.effects.mainCashDelta, 0);
  apply(sellState, sellFilled.effects);
  assert.equal(sellState.portfolio.cashBalance, 995); assert.equal(sellState.portfolio.holdingCostBasis, 668);
  assert.equal(sellState.portfolio.holdingPrincipal, 667); assert.equal(sellState.supply.availableShares, 998);
  assert.equal(sellState.reservations.sellQuantity, 0); assert.equal(sellState.reservations.sellCostBasis, 0);
  zeroFinancialEffects(finalizeWisStockOrder(context(sellFilled.order, sellFilled.order.dueAtMs + 1, sellState)));
  const nextDayQuote = structuredClone(quoteInput); nextDayQuote.nowMs += 86400000; nextDayQuote.quote.atMs = nextDayQuote.nowMs;
  nextDayQuote.portfolio.dailyBuyAmount = 500; nextDayQuote.portfolio.dailyOrderCount = 4;
  const nextDay = acceptWisStockOrder({ ...acceptInput, orderId: 'independent-stock-order-03', quoteInput: nextDayQuote });
  const nextDayState = { portfolio: structuredClone(nextDayQuote.portfolio), reservations: { ...EMPTY_WIS_STOCK_RESERVATIONS },
    supply: { issuedShares: 1000, availableShares: 1000, reservedBuyQuantity: 0 } };
  apply(nextDayState, nextDay.effects);
  assert.equal(nextDayState.portfolio.dayKey, '2026-11-17'); assert.equal(nextDayState.portfolio.dailyBuyAmount, 202);
  assert.equal(nextDayState.portfolio.dailyOrderCount, 1, 'Date rollover uses returned deltas without another reset');
  assert.equal(reads.length, readsBefore); assert.equal(totalWrites(), writesBefore);
  checks.push('Delayed central-market order: immutable acceptance, 60s reservation, early fill blocked, close/quote-TTL expiry preserves fixed contract, later deposit preserved, fill/cancel/replay exactly once, halt/authority/scope/service restrictions release reservations, server I/O zero');
};
const verifyFundingAndWithdrawal = async () => {
  const { getWisStockFundingLimits, planWisStockTransfer } = await import('../functions/wisStockAccount.mjs');
  const readsBefore = reads.length, writesBefore = totalWrites(), day = 86400000;
  const seed = () => ({ mainCash: 1001, stockCash: 0, reservedCash: 0, lastDepositAtMs: 0, outstandingPrincipal: 0 });
  let nextId = 0;
  const request = (snapshot, direction, amount, nowMs = clock) => ({ snapshot, direction, amount, nowMs,
    accountId: 'independent-stock-account', semesterId: '2026-2', transferId: `independent-transfer-${++nextId}` });
  const apply = (snapshot, result) => ({ ...snapshot,
    mainCash: snapshot.mainCash + result.effects.mainCashDelta,
    stockCash: snapshot.stockCash + result.effects.stockCashDelta,
    outstandingPrincipal: snapshot.outstandingPrincipal + result.effects.outstandingPrincipalDelta,
    lastDepositAtMs: result.effects.lastDepositAtMs ?? snapshot.lastDepositAtMs });
  const initial = seed(), depositRequest = request(initial, 'DEPOSIT', 500), before = structuredClone(depositRequest);
  assert.equal(getWisStockFundingLimits(initial, clock).maximumDeposit, 500);
  assert.equal(getWisStockFundingLimits({ ...initial, stockCash: 1_000_000, outstandingPrincipal: 1_000_000 }, clock).maximumDeposit, 500, 'Stock assets never enter deposit denominator');
  const deposit = planWisStockTransfer(depositRequest); assert.deepEqual(depositRequest, before);
  assert.equal(deposit.effects.mainCashDelta, -500); assert.equal(deposit.effects.stockCashDelta, 500);
  assert.equal(deposit.effects.outstandingPrincipalDelta, 500); assert.equal(deposit.effects.earnedDelta, 0);
  assert.equal(deposit.effects.rankEarnedDelta, 0); assert.equal(deposit.effects.lastDepositAtMs, clock);
  let funded = apply(initial, deposit);
  assert.equal(funded.mainCash + funded.stockCash, 1001);
  assert.equal(getWisStockFundingLimits(funded, clock + day - 1).maximumDeposit, 0);
  assert.equal(getWisStockFundingLimits(funded, clock + day).maximumDeposit, 250);
  assert.throws(() => planWisStockTransfer(request(funded, 'DEPOSIT', 1, clock + day - 1)));
  assert.equal(planWisStockTransfer(request(funded, 'DEPOSIT', 250, clock + day)).effects.stockCashDelta, 250);
  const small = planWisStockTransfer(request(seed(), 'DEPOSIT', 1));
  assert.equal(getWisStockFundingLimits(apply(seed(), small), clock + 1).maximumDeposit, 0, 'A one-Wis success starts the full cooldown');
  assert.throws(() => planWisStockTransfer(request(seed(), 'DEPOSIT', 501)));
  assert.equal(seed().lastDepositAtMs, 0);
  const duplicate = planWisStockTransfer({ ...depositRequest, snapshot: funded, nowMs: clock + day, existingReceipt: deposit.receipt });
  assert.equal(duplicate.changed, false); assert.equal(duplicate.effects.stockCashDelta, 0); assert.equal(duplicate.effects.mainCashDelta, 0);
  assert.equal(duplicate.effects.outstandingPrincipalDelta, 0); assert.equal(duplicate.effects.lastDepositAtMs, null);
  assert.throws(() => planWisStockTransfer({ ...depositRequest, amount: 499, existingReceipt: deposit.receipt }));
  assert.throws(() => planWisStockTransfer(request({ ...seed(), lastDepositAtMs: clock + 1 }, 'DEPOSIT', 1)));
  assert.throws(() => planWisStockTransfer(request({ ...seed(), stockCash: Number.MAX_SAFE_INTEGER }, 'DEPOSIT', 1)));
  const reserved = { ...funded, mainCash: 500, stockCash: 500, reservedCash: 200, outstandingPrincipal: 500 };
  assert.equal(getWisStockFundingLimits(reserved, clock).maximumWithdrawal, 300);
  assert.throws(() => planWisStockTransfer(request(reserved, 'WITHDRAW', 301)));
  const released = planWisStockTransfer(request(reserved, 'WITHDRAW', 300));
  assert.equal(released.effects.mainCashDelta, 300); assert.equal(released.effects.stockCashDelta, -300);
  assert.equal(released.effects.earnedDelta, 0); assert.equal(released.effects.rankEarnedDelta, 0);
  assert.equal(released.effects.lastDepositAtMs, null); assert.equal(apply(reserved, released).lastDepositAtMs, clock);

  const profitable = { ...seed(), mainCash: 5000, stockCash: 6000, outstandingPrincipal: 5000, lastDepositAtMs: clock };
  const wholeRequest = request(profitable, 'WITHDRAW', 6000), whole = planWisStockTransfer(wholeRequest);
  assert.equal(whole.effects.mainCashDelta, 6000); assert.equal(whole.effects.earnedDelta, 1000);
  assert.equal(whole.effects.rankEarnedDelta, 0); assert.equal(whole.effects.outstandingPrincipalDelta, -5000);
  const wholeAfter = apply(profitable, whole);
  assert.equal(wholeAfter.outstandingPrincipal, 0); assert.equal(wholeAfter.mainCash, 11000);
  const wholeReplay = planWisStockTransfer({ ...wholeRequest, snapshot: wholeAfter, existingReceipt: whole.receipt });
  assert.equal(wholeReplay.changed, false); assert.equal(wholeReplay.effects.earnedDelta, 0); assert.equal(wholeReplay.effects.mainCashDelta, 0);
  const partial1 = planWisStockTransfer(request(profitable, 'WITHDRAW', 2000));
  const partialState = apply(profitable, partial1), partial2 = planWisStockTransfer(request(partialState, 'WITHDRAW', 4000));
  assert.equal(partial1.effects.earnedDelta, 0); assert.equal(partial2.effects.earnedDelta, 1000);
  assert.deepEqual(apply(partialState, partial2), wholeAfter, 'Partial withdrawals equal one full withdrawal');
  const reinvest = planWisStockTransfer(request(wholeAfter, 'DEPOSIT', 1000, clock + day));
  const reinvested = apply(wholeAfter, reinvest), returned = planWisStockTransfer(request(reinvested, 'WITHDRAW', 1000, clock + day));
  assert.equal(returned.effects.earnedDelta, 0, 'Re-depositing old profits cannot recognize income again');
  const loss = { ...profitable, stockCash: 4000 }, lossReturn = planWisStockTransfer(request(loss, 'WITHDRAW', 4000));
  const afterLoss = apply(loss, lossReturn); assert.equal(afterLoss.outstandingPrincipal, 1000); assert.equal(lossReturn.effects.earnedDelta, 0);
  afterLoss.mainCash += 1000; // A separate general-wallet grant, outside stock income.
  const secondDeposit = planWisStockTransfer(request(afterLoss, 'DEPOSIT', 5000, clock + day));
  const recovered = apply(afterLoss, secondDeposit); recovered.stockCash += 1000; // Synthetic realized stock recovery.
  const recoveryReturn = planWisStockTransfer(request(recovered, 'WITHDRAW', 6000, clock + day));
  assert.equal(recoveryReturn.effects.earnedDelta, 0); assert.equal(apply(recovered, recoveryReturn).outstandingPrincipal, 0);
  assert.equal(reads.length, readsBefore); assert.equal(totalWrites(), writesBefore);
  checks.push('Separate-account funding: current main-Wis-only half cap and exact 24h cutoff, tiny deposit cooldown, failed/replayed requests never extend cooldown, reserved withdrawals denied; current receives full withdrawal, only principal-first profit increases earned, rank zero, split/reinvest/loss-recovery cannot duplicate income, server I/O zero');
};
try {
  verifyQuoteMath();
  await verifyOrderLifecycle();
  await verifyFundingAndWithdrawal();
  await env.clearFirestore();
  const authTime = Math.floor(Date.now() / 1000) - 60;
  await db.doc('site_settings/config').set({ year: '2026', semester: '2' });
  await db.doc('site_settings/semester_active').set({ semesterId: '2026-2' });
  await db.doc('semester_manifests/2026-2').set({ status: 'ACTIVE' });
  for (const [path, data] of protectedDocuments) await db.doc(path).set(data);
  for (const uid of ['manager', 'student', 'admin']) {
    await db.doc(`users/${uid}`).set(uid === 'manager' ? { role: 'teacher' }
      : { role: uid === 'student' ? 'student' : 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_read', 'point_manage'] });
    await db.doc(`application_sessions/${uid}/sessions/${authTime}`).set({ schemaVersion: 2, status: 'active', authTime, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: new Date(Date.now() + 3600000) });
  }
  assert.equal((await api.getWisStockManagement(request({}))).revision, 0);
  assert.equal(totalWrites(), 0);
  const command = request({ expectedRevision: 0, stockId: '', settings, requestId: 'concurrent-stock-request-1' });
  const created = await Promise.all(Array.from({ length: 8 }, () => api.saveWisStock(command)));
  assert(created.every(item => item.stocks.length === 1 && item.savedStockId === created[0].savedStockId));
  assert.equal((await db.collection(`${root}/wis_stock_receipts`).get()).size, 1);
  assert.equal(totalWrites(), 2, 'Eight identical commands commit one market and one receipt write');
  checks.push('8 concurrent duplicate registrations produce one stock, one receipt, two committed writes');
  clock += 3600000;
  await Promise.all(Array.from({ length: 8 }, () => api.advanceWisStockPrices()));
  const market = await api.getWisStockManagement(request({}));
  assert.equal(market.stocks[0].price, 103); assert.equal(market.stocks[0].history.length, 2); assert.equal(market.revision, 2);
  assert.equal(totalWrites(), 3, 'Eight concurrent ticks commit one market write');
  await api.advanceWisStockPrices();
  assert.equal(totalWrites(), 3, 'Same slot scheduler retry makes zero writes');
  checks.push('8 concurrent ticks advance exactly once; same-slot retry writes zero');
  const edits = await Promise.allSettled(['첫 수정', '둘째 수정'].map((name, index) => api.saveWisStock(request({ expectedRevision: 2,
    stockId: market.stocks[0].id, settings: { ...settings, name }, requestId: `conflicting-stock-request-${index}` }))));
  assert.equal(edits.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(edits.filter(item => item.status === 'rejected' && item.reason.details.reason === 'WIS_STOCK_REVISION_CONFLICT').length, 1);
  assert.equal(totalWrites(), 5, 'Conflicting edit loser has no committed writes');
  const rulesBefore = await api.getWisStockManagement(request({}));
  const rules = { ...DEFAULT_WIS_STOCK_MARKET_RULES, buyFeeBps: 125 };
  const rulesCommand = request({ expectedRevision: rulesBefore.revision, rules, requestId: 'concurrent-market-rules-1' });
  const savedRules = await Promise.all(Array.from({ length: 8 }, () => api.saveWisStockMarketRules(rulesCommand)));
  assert(savedRules.every(result => result.rules.buyFeeBps === 125 && result.studentOpen === false));
  assert.equal(savedRules.filter(result => result.changed).length, 1);
  assert.equal(totalWrites(), 7, 'Eight identical rules saves commit one market and one receipt');
  const afterRules = await api.getWisStockManagement(request({}));
  await api.saveWisStockMarketRules(request({ expectedRevision: afterRules.revision, rules, requestId: 'unchanged-market-rules-1' }));
  assert.equal(totalWrites(), 7, 'Unchanged rules save has zero writes');
  await assert.rejects(api.saveWisStockMarketRules(request({ ...rulesCommand.data, rules: { ...rules, buyFeeBps: 126 } })),
    error => error.details?.reason === 'WIS_STOCK_REQUEST_CONFLICT');
  await assert.rejects(api.saveWisStockMarketRules(request({ expectedRevision: afterRules.revision,
    rules: { ...rules, studentOpen: true }, requestId: 'forged-student-open-1' })),
    error => error.details?.reason === 'WIS_STOCK_RULES_INVALID');
  assert.equal(totalWrites(), 7);
  checks.push('8 concurrent rule saves commit exactly twice; identical fresh save and repeated receipt write zero; request collision and forged student-open flag denied');

  clock += 3600000;
  const beforeRace = await api.getWisStockManagement(request({})), raceWrites = totalWrites();
  const racingRules = request({ expectedRevision: beforeRace.revision, rules: { ...rules, maxOrderQuantity: 90 }, requestId: 'racing-market-rules-1' });
  const racingStock = request({ expectedRevision: beforeRace.revision, stockId: '', settings: { ...settings, name: '경합 등록' }, requestId: 'racing-stock-create-1' });
  const race = await Promise.allSettled([
    api.saveWisStockMarketRules(racingRules), api.saveWisStock(racingStock),
    ...Array.from({ length: 8 }, () => api.advanceWisStockPrices()),
  ]);
  const commandWins = race.slice(0, 2).filter(result => result.status === 'fulfilled').length;
  assert(commandWins <= 1, 'Shared market revision allows at most one of the competing commands');
  assert(race.slice(0, 2).every(result => result.status === 'fulfilled' || result.reason.details?.reason === 'WIS_STOCK_REVISION_CONFLICT'));
  assert(race.slice(2).every(result => result.status === 'fulfilled'));
  assert.equal(race.slice(2).filter(result => result.value.changed).length, 1, 'One scheduled price transition despite eight concurrent tick workers');
  const afterRace = await api.getWisStockManagement(request({}));
  assert.equal(afterRace.revision, beforeRace.revision + commandWins + 1);
  assert.equal(afterRace.studentOpen, false);
  assert.equal(afterRace.stocks.find(stock => stock.id === market.stocks[0].id).price, 106);
  assert.equal(totalWrites() - raceWrites, commandWins * 2 + 1);
  for (const [index, command] of [racingRules, racingStock].entries()) if (race[index].status === 'fulfilled') {
    const writes = totalWrites();
    const duplicate = await (index === 0 ? api.saveWisStockMarketRules(command) : api.saveWisStock(command));
    assert.equal(duplicate.duplicate, true); assert.equal(totalWrites(), writes);
  }
  checks.push('Rule save, new registration and 8 tick workers race atomically: one teacher CAS winner at most, one price transition, exact market/receipt write budget, winner retry writes zero');
  const receiptId = (await db.collection(`${root}/wis_stock_receipts`).limit(1).get()).docs[0].id;
  for (const uid of ['manager', 'student', 'admin']) {
    const client = env.authenticatedContext(uid, { email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime }).firestore();
    await assertSucceeds(getDoc(doc(client, `users/${uid}`)));
    for (const [collectionName, id] of [['wis_stock_markets', 'current'], ['wis_stock_receipts', receiptId]]) {
      const target = doc(client, `${root}/${collectionName}/${id}`);
      await assertFails(getDoc(target)); await assertFails(getDocs(collection(client, `${root}/${collectionName}`)));
      await assertFails(setDoc(target, { studentOpen: true })); await assertFails(updateDoc(target, { studentOpen: true })); await assertFails(deleteDoc(target));
    }
  }
  await assert.rejects(api.getWisStockManagement({ ...request({}), auth: { uid: 'student', token: { email: 'student@yongshin-ms.ms.kr' } } }), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.saveWisStockMarketRules({ ...rulesCommand, auth: { uid: 'student', token: { email: 'student@yongshin-ms.ms.kr' } } }), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  const deniedWrites = totalWrites();
  await db.doc('users/reader').set({ role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] });
  const reader = { ...request({}), auth: { uid: 'reader', token: { email: 'reader@yongshin-ms.ms.kr' } } };
  assert.equal((await api.getWisStockManagement(reader)).studentOpen, false);
  await assert.rejects(api.saveWisStock({ ...command, auth: reader.auth }), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.saveWisStockMarketRules({ ...rulesCommand, auth: reader.auth }), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.getWisStockManagement(request({ semester: '1' })), error => error.details?.reason === 'WIS_STOCK_SCOPE_CHANGED');
  await assert.rejects(api.saveWisStockMarketRules(request({ ...rulesCommand.data, semester: '1' })), error => error.details?.reason === 'WIS_STOCK_SCOPE_CHANGED');
  await db.doc('site_settings/semester_active').set({ semesterId: '2026-1' });
  await assert.rejects(api.getWisStockManagement(request({})), error => error.details?.reason === 'WIS_STOCK_SCOPE_CHANGED');
  await assert.rejects(api.saveWisStockMarketRules(rulesCommand), error => error.details?.reason === 'WIS_STOCK_SCOPE_CHANGED');
  assert.equal((await api.advanceWisStockPrices()).changed, false);
  assert.equal(totalWrites(), deniedWrites, 'Read-only staff and inactive scope cannot cause writes, including receipt replay');
  await db.doc('site_settings/semester_active').set({ semesterId: '2026-2' });
  checks.push('point_read staff can view but cannot save either command; wrong or switched semester blocks reads, writes and receipt replay; inactive scheduler writes zero');
  const beforeDenied = await db.doc(`${root}/wis_stock_markets/current`).get();
  await db.doc('users/manager').set({ role: 'teacher', disabled: true });
  await assert.rejects(api.getWisStockManagement(request({})), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.saveWisStock(command), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.saveWisStockMarketRules(rulesCommand), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  assert.deepEqual((await db.doc(`${root}/wis_stock_markets/current`).get()).data(), beforeDenied.data());
  for (const [path, data] of protectedDocuments) assert.deepEqual((await db.doc(path).get()).data(), data, `${path} unchanged`);
  assert(commits.flatMap(commit => commit.writes).every(write =>
    write.path === `${root}/wis_stock_markets/current` || write.path.startsWith(`${root}/wis_stock_receipts/`)), 'Only market/receipt paths can be written');
  assert(reads.every(path => !/^semester_wis_(accounts|balances|rankings|ledger|economies)\//.test(path)
    && !/\/point_(wallets|transactions)\//.test(path)), 'Stock management never reads actual wallets or ledgers');
  checks.push('Student/disabled teacher API denial; direct client get/list/create/update/delete denied to students, teachers and administrator');
  checks.push('Seeded canonical and legacy wallets, projections, economy and ledger remain byte-for-byte unchanged; no wallet/ledger reads or writes');
  const evidence = process.env.WIS_STOCKS_RULES_EVIDENCE_DIR || path.join(os.tmpdir(), 'westory-wis-stock-market-qa');
  await fs.mkdir(evidence, { recursive: true });
  const sourceHashes = hashAuditedSources();
  assert.deepEqual(sourceHashes, initialSourceHashes, 'Audited source remains unchanged during the test run');
  await fs.writeFile(path.join(evidence, 'firestore-rules-report.json'), JSON.stringify({ status: 'PASS', checks,
    projectId, productionAccess: 0, sourceHashes, commits, rejected, committedWrites: totalWrites(), protectedPaths: protectedPaths.length }, null, 2));
  console.log(`PASS actual Firestore: ${checks.length} groups; duplicate/racing rules, registration and ticks; role/scope/client boundaries; 9 protected wallet/ledger documents unchanged with zero reads or writes; pure quote math.`);
} finally { await env.cleanup(); await deleteApp(app); }
