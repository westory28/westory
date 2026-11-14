import { WisStockRuleError, quoteWisStockOrder, wisStockKstSession } from './wisStockMarketRules.mjs';
const MAX = Number.MAX_SAFE_INTEGER;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const valid = (value, min = 0, max = MAX) => Number.isSafeInteger(value) && value >= min && value <= max;
const fail = (reason, message) => { throw new WisStockRuleError(reason, message); };
const safe = value => {
  if (value < -BigInt(MAX) || value > BigInt(MAX)) fail('WIS_STOCK_UNSAFE_TOTAL', '계산 가능한 주문 범위를 넘었습니다.');
  return Number(value);
};
export const EMPTY_WIS_STOCK_RESERVATIONS = Object.freeze({ cash: 0, buyQuantity: 0, buyFees: 0, sellQuantity: 0, sellPrincipal: 0, sellCostBasis: 0 });
const emptyEffects = () => ({ mainCashDelta: 0, stockCashDelta: 0, holdingQuantityDelta: 0, holdingPrincipalDelta: 0,
  holdingCostBasisDelta: 0, reservedCashDelta: 0, reservedBuyQuantityDelta: 0, reservedBuyFeesDelta: 0,
  reservedSellQuantityDelta: 0, reservedSellPrincipalDelta: 0, reservedSellCostBasisDelta: 0,
  availableSharesDelta: 0, marketReservedBuyQuantityDelta: 0, dailyBuyAmountDelta: 0, dailyOrderCountDelta: 0,
  counterDayKey: null, lastOrderAtMs: null, cumulativeRealizedPnlDelta: 0, profitHighWatermarkDelta: 0, earnedDelta: 0, rankEarnedDelta: 0 });
const result = (order, effects = emptyEffects(), changed = false) => ({ changed, order: { ...order }, effects, executable: false });
const binding = (accountId, semesterId) => {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(accountId || '') || !/^20\d{2}-[12]$/.test(semesterId || ''))
    fail('WIS_STOCK_ORDER_SCOPE_INVALID', '주문 계좌와 학기를 확인해 주세요.');
};
const reservationsValid = reservations => record(reservations)
  && Object.keys(EMPTY_WIS_STOCK_RESERVATIONS).every(key => valid(reservations[key]))
  && reservations.buyFees <= reservations.cash && reservations.sellPrincipal <= reservations.sellCostBasis;
function validateSnapshot(portfolio, reservations, supply) {
  if (!record(portfolio) || !reservationsValid(reservations) || !record(supply)
    || !['cashBalance', 'holdingQuantity', 'holdingPrincipal', 'holdingCostBasis', 'dailyBuyAmount', 'dailyOrderCount', 'profitHighWatermark'].every(key => valid(portfolio[key]))
    || !valid(portfolio.cumulativeRealizedPnl, -MAX) || portfolio.holdingPrincipal > portfolio.holdingCostBasis
    || portfolio.profitHighWatermark < Math.max(0, portfolio.cumulativeRealizedPnl)
    || !valid(supply.issuedShares, 1, 1000000000) || !valid(supply.availableShares) || !valid(supply.reservedBuyQuantity)
    || reservations.buyQuantity > supply.reservedBuyQuantity
    || BigInt(portfolio.holdingQuantity) + BigInt(supply.availableShares) + BigInt(supply.reservedBuyQuantity) > BigInt(supply.issuedShares))
    fail('WIS_STOCK_RESERVATION_INVALID', '현재 잔액·보유량·예약량·발행 수량을 확인해 주세요.');
}
function validateOrder(order, accountId, semesterId) {
  binding(accountId, semesterId);
  if (!record(order) || order.schemaVersion !== 1 || order.accountId !== accountId || order.semesterId !== semesterId
    || !/^[A-Za-z0-9_-]{8,120}$/.test(order.id || '') || !/^stock_[a-f0-9]{24}$/.test(order.stockId || '')
    || typeof order.requestKey !== 'string' || !['PENDING', 'FILLED', 'CANCELLED'].includes(order.status)
    || order.revision !== (order.status === 'PENDING' ? 1 : 2) || !['BUY', 'SELL'].includes(order.side)
    || !valid(order.quantity, 1, 1000000000) || !valid(order.unitPrice, 1, 1000000)
    || !valid(order.gross) || !valid(order.fee, 0, order.gross)
    || BigInt(order.quantity) * BigInt(order.unitPrice) !== BigInt(order.gross)
    || !valid(order.reservedPrincipal) || !valid(order.reservedCostBasis) || order.reservedPrincipal > order.reservedCostBasis
    || !valid(order.acceptedAtMs) || !valid(order.dueAtMs) || !valid(order.delaySeconds, 5, 60)
    || order.dueAtMs !== order.acceptedAtMs + order.delaySeconds * 1000
    || order.dayKey !== wisStockKstSession(order.acceptedAtMs).dayKey
    || order.cashDebit !== (order.side === 'BUY' ? order.gross + order.fee : 0)
    || order.cashCredit !== (order.side === 'SELL' ? order.gross - order.fee : 0)
    || (order.side === 'BUY' && (order.reservedPrincipal !== 0 || order.reservedCostBasis !== 0)))
    fail('WIS_STOCK_ORDER_INVALID', '고정된 주문 계약을 확인하지 못했습니다.');
}

/** Pure plan only. Read order + account + position + reservation counters +
 * supply in ONE future transaction; apply these deltas and the order receipt
 * atomically. Do not use an old quote's nextCashBalance as a wallet replacement.
 */
export function acceptWisStockOrder(input) {
  if (!record(input) || !record(input.quoteInput) || !record(input.quoteInput.stock) || !record(input.quoteInput.quote)
    || !/^[A-Za-z0-9_-]{8,120}$/.test(input.orderId || '')) fail('WIS_STOCK_ORDER_INVALID', '주문 접수 정보를 확인해 주세요.');
  binding(input.accountId, input.semesterId);
  const q = input.quoteInput, requestKey = JSON.stringify([input.accountId, input.semesterId, q.stock.id,
    q.side, q.quantity, q.quote.stockId, q.quote.price, q.quote.atMs, q.quote.marketRevision]);
  if (input.existingOrder) {
    validateOrder(input.existingOrder, input.accountId, input.semesterId);
    if (input.existingOrder.id !== input.orderId || input.existingOrder.requestKey !== requestKey)
      fail('WIS_STOCK_ORDER_CONFLICT', '같은 주문 요청의 내용이 달라졌습니다.');
    return result(input.existingOrder);
  }
  if (!valid(input.delaySeconds, 5, 60)) fail('WIS_STOCK_ORDER_INVALID', '주문 대기 시간은 5~60초여야 합니다.');
  const p = q.portfolio, r = input.reservations;
  const supply = { issuedShares: q.stock.settings?.issuedShares, availableShares: q.stock.availableShares, reservedBuyQuantity: input.supplyReservedBuyQuantity };
  validateSnapshot(p, r, supply);
  if (r.cash > p.cashBalance || r.sellQuantity > p.holdingQuantity || r.sellPrincipal > p.holdingPrincipal || r.sellCostBasis > p.holdingCostBasis)
    fail('WIS_STOCK_RESERVATION_INVALID', '예약을 제외한 잔액과 보유량을 다시 확인해 주세요.');
  if (q.stock.price !== q.quote.price) fail('WIS_STOCK_FIRM_QUOTE_CHANGED', '확인한 가격과 현재 가격이 다릅니다. 새 견적을 확인해 주세요.');
  const sellPortfolio = q.side === 'SELL' ? { ...p, holdingQuantity: p.holdingQuantity - r.sellQuantity,
    holdingPrincipal: p.holdingPrincipal - r.sellPrincipal, holdingCostBasis: p.holdingCostBasis - r.sellCostBasis } : p;
  const fixed = quoteWisStockOrder({ ...q, portfolio: sellPortfolio });
  if (q.side === 'BUY') {
    if (BigInt(p.cashBalance) - BigInt(r.cash) < BigInt(fixed.cashDebit) + BigInt(q.rules.minimumCashReserve))
      fail('WIS_STOCK_INSUFFICIENT_CASH', '예약되지 않은 주식 계좌 잔액이 부족합니다.');
    if (p.holdingQuantity + r.buyQuantity + q.quantity > q.rules.maxHoldingQuantity)
      fail('WIS_STOCK_HOLDING_LIMIT', '대기 주문을 포함한 보유 한도를 넘었습니다.');
    // Pending shares of this stock use the current mark. Pending cash for
    // other stocks is conservatively excluded until their positions settle.
    if (BigInt(p.holdingQuantity + r.buyQuantity + q.quantity) * BigInt(q.stock.price) * 10000n
      > (BigInt(p.portfolioValue) - BigInt(r.cash) + BigInt(r.buyQuantity) * BigInt(q.stock.price) - BigInt(fixed.fee)) * BigInt(q.rules.maxConcentrationBps))
      fail('WIS_STOCK_CONCENTRATION_LIMIT', '대기 주문을 포함한 종목 비중 한도를 넘었습니다.');
  }
  const order = { schemaVersion: 1, id: input.orderId, accountId: input.accountId, semesterId: input.semesterId,
    stockId: q.stock.id, requestKey, status: 'PENDING', revision: 1, side: q.side, quantity: q.quantity,
    unitPrice: fixed.unitPrice, gross: fixed.gross, fee: fixed.fee, cashDebit: fixed.cashDebit, cashCredit: fixed.cashCredit,
    reservedPrincipal: fixed.principalRemoved, reservedCostBasis: fixed.costBasisRemoved,
    acceptedAtMs: q.nowMs, dueAtMs: safe(BigInt(q.nowMs) + BigInt(input.delaySeconds * 1000)),
    delaySeconds: input.delaySeconds, dayKey: fixed.dayKey };
  const effects = emptyEffects();
  if (q.side === 'BUY') Object.assign(effects, { reservedCashDelta: fixed.cashDebit, reservedBuyQuantityDelta: q.quantity,
    reservedBuyFeesDelta: fixed.fee, availableSharesDelta: -q.quantity, marketReservedBuyQuantityDelta: q.quantity });
  else Object.assign(effects, { reservedSellQuantityDelta: q.quantity, reservedSellPrincipalDelta: fixed.principalRemoved,
    reservedSellCostBasisDelta: fixed.costBasisRemoved });
  Object.assign(effects, { dailyBuyAmountDelta: fixed.nextDailyBuyAmount - p.dailyBuyAmount,
    dailyOrderCountDelta: fixed.nextDailyOrderCount - p.dailyOrderCount, counterDayKey: fixed.dayKey, lastOrderAtMs: q.nowMs });
  return result(order, effects, true);
}
function context(input) {
  if (!record(input)) fail('WIS_STOCK_ORDER_INVALID', '주문 처리 정보를 확인해 주세요.');
  validateOrder(input.order, input.accountId, input.semesterId);
  if (input.order.status !== 'PENDING') return false;
  if (!valid(input.nowMs) || input.nowMs < input.order.acceptedAtMs) fail('WIS_STOCK_ORDER_INVALID', '주문 처리 시각을 확인해 주세요.');
  validateSnapshot(input.portfolio, input.reservations, input.supply);
  const { order: o, reservations: r } = input;
  if (o.side === 'BUY' ? (r.cash < o.cashDebit || r.buyFees < o.fee || r.buyQuantity < o.quantity || input.supply.reservedBuyQuantity < o.quantity)
    : (r.sellQuantity < o.quantity || r.sellPrincipal < o.reservedPrincipal || r.sellCostBasis < o.reservedCostBasis))
    fail('WIS_STOCK_RESERVATION_INVALID', '주문에 연결된 예약 기록이 맞지 않습니다.');
  return true;
}
function release(input) {
  const o = input.order, effects = emptyEffects();
  if (o.side === 'BUY') Object.assign(effects, { reservedCashDelta: -o.cashDebit, reservedBuyQuantityDelta: -o.quantity,
    reservedBuyFeesDelta: -o.fee, marketReservedBuyQuantityDelta: -o.quantity });
  else Object.assign(effects, { reservedSellQuantityDelta: -o.quantity, reservedSellPrincipalDelta: -o.reservedPrincipal,
    reservedSellCostBasisDelta: -o.reservedCostBasis });
  return effects;
}
function cancelled(input, reason) {
  const effects = release(input), o = input.order;
  if (o.side === 'BUY') {
    effects.availableSharesDelta = o.quantity;
    if (input.portfolio.dayKey === o.dayKey) {
      if (input.portfolio.dailyBuyAmount < o.cashDebit) fail('WIS_STOCK_RESERVATION_INVALID', '매수 금액 예약 기록이 맞지 않습니다.');
      effects.dailyBuyAmountDelta = -o.cashDebit; effects.counterDayKey = o.dayKey;
    }
  }
  // Accepted order count and cooldown are retained to prevent cancel spam;
  // only same-day buy budget is released, never a later day's fresh counter.
  return result({ ...o, status: 'CANCELLED', revision: 2, settledAtMs: input.nowMs, cancellationReason: reason }, effects, true);
}
export function cancelWisStockOrder(input) {
  if (!context(input)) return result(input.order);
  return cancelled(input, 'USER_CANCELLED');
}
export function finalizeWisStockOrder(input) {
  if (!context(input)) return result(input.order);
  const o = input.order, e = input.execution;
  if (!record(e) || !['serviceAllowed', 'authorized', 'scopeActive', 'marketHalted'].every(key => typeof e[key] === 'boolean')
    || !['ACTIVE', 'HALTED', 'SELL_ONLY'].includes(e.tradingStatus) || !valid(e.haltedUntilMs))
    fail('WIS_STOCK_ORDER_INVALID', '현재 집행 권한과 거래 상태를 확인해 주세요.');
  // The frozen contract survives quote expiry, market revision/fee/price
  // changes, and the daily session closing. Actual execution gates do not.
  const stop = !e.serviceAllowed ? 'SERVICE_CLOSED' : !e.authorized ? 'AUTHORITY_REVOKED' : !e.scopeActive ? 'SCOPE_CHANGED'
    : e.marketHalted ? 'MARKET_HALTED' : (e.tradingStatus === 'HALTED' || e.haltedUntilMs > input.nowMs) ? 'STOCK_HALTED'
      : o.side === 'BUY' && e.tradingStatus === 'SELL_ONLY' ? 'SELL_ONLY' : '';
  if (stop) return cancelled(input, stop);
  if (input.nowMs < o.dueAtMs) fail('WIS_STOCK_ORDER_NOT_DUE', '아직 주문 처리 대기 중입니다.');
  const p = input.portfolio, r = input.reservations;
  if (o.side === 'BUY' && p.cashBalance < r.cash) return cancelled(input, 'CASH_BACKING_CHANGED');
  if (o.side === 'SELL' && (p.holdingQuantity < r.sellQuantity || p.holdingPrincipal < r.sellPrincipal || p.holdingCostBasis < r.sellCostBasis))
    return cancelled(input, 'HOLDING_BACKING_CHANGED');
  const effects = release(input);
  if (o.side === 'BUY') Object.assign(effects, { stockCashDelta: -o.cashDebit, holdingQuantityDelta: o.quantity,
    holdingPrincipalDelta: o.gross, holdingCostBasisDelta: o.cashDebit });
  else {
    const realizedPnl = o.cashCredit - o.reservedCostBasis;
    const cumulative = safe(BigInt(p.cumulativeRealizedPnl) + BigInt(realizedPnl));
    const earned = Math.max(p.profitHighWatermark, cumulative, 0) - p.profitHighWatermark;
    Object.assign(effects, { stockCashDelta: o.cashCredit, holdingQuantityDelta: -o.quantity,
      holdingPrincipalDelta: -o.reservedPrincipal, holdingCostBasisDelta: -o.reservedCostBasis,
      availableSharesDelta: o.quantity, cumulativeRealizedPnlDelta: realizedPnl, profitHighWatermarkDelta: earned });
  }
  safe(BigInt(p.cashBalance) + BigInt(effects.stockCashDelta));
  safe(BigInt(p.holdingPrincipal) + BigInt(effects.holdingPrincipalDelta));
  safe(BigInt(p.holdingCostBasis) + BigInt(effects.holdingCostBasisDelta));
  return result({ ...o, status: 'FILLED', revision: 2, settledAtMs: input.nowMs,
    realizedPnl: effects.cumulativeRealizedPnlDelta, earnedDelta: effects.earnedDelta }, effects, true);
}
