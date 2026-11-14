// Pure market rules shared by teacher previews and server validation. No I/O,
// clock, random source, credentials, or wallet mutation belongs in this module.
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const BPS = 10000n;
const KST_OFFSET = 9 * 3600000;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const int = (value, min = 0, max = MAX_SAFE) => Number.isSafeInteger(value) && value >= min && value <= max;
export class WisStockRuleError extends Error {
  constructor(reason, message) { super(message); this.name = 'WisStockRuleError'; this.reason = reason; }
}
const reject = (reason, message) => { throw new WisStockRuleError(reason, message); };
export const DEFAULT_WIS_STOCK_MARKET_RULES = Object.freeze({
  buyFeeBps: 100, sellFeeBps: 100, tradingDays: Object.freeze([1, 2, 3, 4, 5]),
  openMinuteKst: 540, closeMinuteKst: 960, maxOrderQuantity: 100, maxOrderAmount: 10000,
  maxHoldingQuantity: 1000, maxConcentrationBps: 5000, minimumCashReserve: 500,
  dailyBuyLimit: 20000, dailyOrderLimit: 20, cooldownSeconds: 10,
  quoteTtlSeconds: 30, maxSlippageBps: 100, automaticPrices: true,
  dailyPriceLimitBps: 1000, circuitBreakerBps: 700, circuitBreakerMinutes: 60, halted: false,
});
export const WIS_STOCK_RULE_LIMITS = Object.freeze({
  buyFeeBps: [0, 1000], sellFeeBps: [0, 1000], openMinuteKst: [0, 1439], closeMinuteKst: [1, 1440],
  maxOrderQuantity: [1, 1000000], maxOrderAmount: [1, 1000000000000], maxHoldingQuantity: [1, 1000000000],
  maxConcentrationBps: [1, 10000], minimumCashReserve: [0, 1000000000000], dailyBuyLimit: [1, 1000000000000],
  dailyOrderLimit: [1, 10000], cooldownSeconds: [0, 3600], quoteTtlSeconds: [1, 300], maxSlippageBps: [0, 1000],
  dailyPriceLimitBps: [1, 3000], circuitBreakerBps: [1, 3000], circuitBreakerMinutes: [1, 1440],
});
export function normalizeWisStockMarketRules(input = {}) {
  const invalid = () => reject('WIS_STOCK_RULES_INVALID', '시장 규칙의 입력 범위와 제한 간 관계를 확인해 주세요.');
  if (!record(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_WIS_STOCK_MARKET_RULES, key))) invalid();
  const rules = { ...DEFAULT_WIS_STOCK_MARKET_RULES, ...input };
  for (const [key, [min, max]] of Object.entries(WIS_STOCK_RULE_LIMITS)) if (!int(rules[key], min, max)) invalid();
  if (!Array.isArray(rules.tradingDays) || !rules.tradingDays.length || rules.tradingDays.length > 7
    || rules.tradingDays.some(day => !int(day, 0, 6)) || new Set(rules.tradingDays).size !== rules.tradingDays.length
    || typeof rules.automaticPrices !== 'boolean' || typeof rules.halted !== 'boolean'
    || rules.openMinuteKst >= rules.closeMinuteKst || rules.maxOrderQuantity > rules.maxHoldingQuantity
    || rules.maxOrderAmount > rules.dailyBuyLimit || rules.circuitBreakerBps > rules.dailyPriceLimitBps) invalid();
  return { ...rules, tradingDays: [...rules.tradingDays].sort((a, b) => a - b) };
}
export const DEFAULT_WIS_STOCK_TRADING_SETTINGS = Object.freeze({ issuedShares: 100000, lotSize: 1, tradingStatus: 'ACTIVE' });
export function normalizeWisStockTradingSettings(input = {}) {
  const value = { ...DEFAULT_WIS_STOCK_TRADING_SETTINGS, ...input };
  if (!record(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_WIS_STOCK_TRADING_SETTINGS, key))
    || !int(value.issuedShares, 1, 1000000000) || !int(value.lotSize, 1, 1000000)
    || value.lotSize > value.issuedShares || value.issuedShares % value.lotSize !== 0
    || !['ACTIVE', 'HALTED', 'SELL_ONLY'].includes(value.tradingStatus)) {
    reject('WIS_STOCK_INPUT_INVALID', '발행 수량·거래 단위·거래 상태를 확인해 주세요.');
  }
  return value;
}
export function wisStockKstSession(atMs) {
  if (!int(atMs, 0, 8640000000000000 - KST_OFFSET)) reject('WIS_STOCK_TRADE_INPUT_INVALID', '기준 시각을 확인해 주세요.');
  const date = new Date(atMs + KST_OFFSET);
  return { dayKey: date.toISOString().slice(0, 10), dayOfWeek: date.getUTCDay(), minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
}
export function isWisStockTradingSession(rulesInput, atMs) {
  const rules = normalizeWisStockMarketRules(rulesInput), session = wisStockKstSession(atMs);
  return rules.tradingDays.includes(session.dayOfWeek) && session.minute >= rules.openMinuteKst && session.minute < rules.closeMinuteKst;
}
const safe = value => {
  if (value > BigInt(MAX_SAFE) || value < -BigInt(MAX_SAFE)) reject('WIS_STOCK_UNSAFE_TOTAL', '계산 가능한 금액 범위를 넘었습니다.');
  return Number(value);
};
const multiply = (a, b) => safe(BigInt(a) * BigInt(b));
const feeFor = (gross, bps) => safe((BigInt(gross) * BigInt(bps) + BPS - 1n) / BPS);
export function wisStockDailyBounds(openPrice, limitBps) {
  if (!int(openPrice, 1, 1000000) || !int(limitBps, 1, 3000)) reject('WIS_STOCK_RULES_INVALID', '당일 기준가와 가격 제한을 확인해 주세요.');
  return { minimum: Math.max(1, safe((BigInt(openPrice) * (BPS - BigInt(limitBps)) + BPS - 1n) / BPS)),
    maximum: safe(BigInt(openPrice) * (BPS + BigInt(limitBps)) / BPS) };
}

// This is a synthetic teacher quote, never an authorization or executable order.
// A future order transaction must re-read and validate all of these snapshots.
export function quoteWisStockOrder(input) {
  const bad = () => reject('WIS_STOCK_TRADE_INPUT_INVALID', '견적에 필요한 수량·시세·지갑·보유 원가를 확인해 주세요.');
  if (!record(input) || !record(input.stock) || !record(input.quote) || !record(input.portfolio)
    || !['BUY', 'SELL'].includes(input.side) || !int(input.quantity, 1, 1000000000)) bad();
  const { stock, quote, portfolio: p, side, quantity, nowMs } = input;
  if (!record(input.rules) || !Object.keys(DEFAULT_WIS_STOCK_MARKET_RULES).every(key => Object.hasOwn(input.rules, key))
    || !record(stock.settings) || !Object.keys(DEFAULT_WIS_STOCK_TRADING_SETTINGS).every(key => Object.hasOwn(stock.settings, key))) bad();
  const rules = normalizeWisStockMarketRules(input.rules);
  const settings = normalizeWisStockTradingSettings(stock.settings);
  const session = wisStockKstSession(nowMs);
  if (typeof stock.id !== 'string' || !/^stock_[a-f0-9]{24}$/.test(stock.id) || quote.stockId !== stock.id
    || !int(stock.price, 1, 1000000) || !int(quote.price, 1, 1000000) || !int(quote.atMs)
    || !int(stock.haltedUntilMs ?? 0) || !int(input.marketRevision) || !int(quote.marketRevision)
    || !int(stock.availableShares, 0, settings.issuedShares) || !/^\d{4}-\d{2}-\d{2}$/.test(p.dayKey || '')
    || !['cashBalance', 'holdingQuantity', 'holdingPrincipal', 'holdingCostBasis', 'portfolioValue',
      'dailyBuyAmount', 'dailyOrderCount', 'lastOrderAtMs', 'profitHighWatermark'].every(key => int(p[key]))
    || !int(p.cumulativeRealizedPnl, -MAX_SAFE) || p.profitHighWatermark < Math.max(0, p.cumulativeRealizedPnl)
    || p.holdingCostBasis < p.holdingPrincipal || p.holdingQuantity > settings.issuedShares
    || BigInt(p.holdingQuantity) + BigInt(stock.availableShares) > BigInt(settings.issuedShares)
    || (p.holdingQuantity === 0 && (p.holdingPrincipal !== 0 || p.holdingCostBasis !== 0))
    || p.lastOrderAtMs > nowMs || quote.atMs > nowMs) bad();
  const dayTime = Date.parse(`${p.dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(dayTime) || new Date(dayTime).toISOString().slice(0, 10) !== p.dayKey || p.dayKey > session.dayKey) bad();
  if (quote.marketRevision !== input.marketRevision) reject('WIS_STOCK_QUOTE_CHANGED', '시장 규칙이나 시세가 바뀌었습니다. 새 견적을 확인해 주세요.');
  const positionValue = multiply(p.holdingQuantity, stock.price);
  if (BigInt(p.portfolioValue) < BigInt(p.cashBalance) + BigInt(positionValue)) bad();
  if (rules.halted) reject('WIS_STOCK_MARKET_HALTED', '시장이 일시 정지되어 있습니다.');
  if (!isWisStockTradingSession(rules, nowMs)) reject('WIS_STOCK_TRADING_CLOSED', '설정된 거래 요일과 시간이 아닙니다.');
  if (settings.tradingStatus === 'HALTED' || (stock.haltedUntilMs || 0) > nowMs) reject('WIS_STOCK_INSTRUMENT_HALTED', '이 종목은 일시 정지되어 있습니다.');
  if (side === 'BUY' && settings.tradingStatus === 'SELL_ONLY') reject('WIS_STOCK_SELL_ONLY', '이 종목은 매도만 허용합니다.');
  if (nowMs - quote.atMs > rules.quoteTtlSeconds * 1000) reject('WIS_STOCK_QUOTE_EXPIRED', '시세의 유효 시간이 지났습니다. 새로 확인해 주세요.');
  if (BigInt(Math.abs(stock.price - quote.price)) * BPS > BigInt(quote.price) * BigInt(rules.maxSlippageBps)) reject('WIS_STOCK_SLIPPAGE', '허용한 범위를 넘어 시세가 변했습니다.');
  if (quantity % settings.lotSize !== 0) reject('WIS_STOCK_ORDER_LIMIT', '거래 단위의 배수로 수량을 입력해 주세요.');
  const gross = multiply(quantity, stock.price), fee = feeFor(gross, side === 'BUY' ? rules.buyFeeBps : rules.sellFeeBps);
  const cashDebit = side === 'BUY' ? safe(BigInt(gross) + BigInt(fee)) : 0;
  const cashCredit = side === 'SELL' ? gross - fee : 0;
  if (quantity > rules.maxOrderQuantity || gross > rules.maxOrderAmount) reject('WIS_STOCK_ORDER_LIMIT', '한 번에 주문할 수 있는 수량이나 금액을 넘었습니다.');
  const dailyBuyAmount = p.dayKey === session.dayKey ? p.dailyBuyAmount : 0;
  const dailyOrderCount = p.dayKey === session.dayKey ? p.dailyOrderCount : 0;
  if (dailyOrderCount >= rules.dailyOrderLimit || (side === 'BUY' && BigInt(dailyBuyAmount) + BigInt(cashDebit) > BigInt(rules.dailyBuyLimit))) reject('WIS_STOCK_DAILY_LIMIT', '하루 매수 금액 또는 주문 횟수 한도를 넘었습니다.');
  if (p.lastOrderAtMs > 0 && nowMs - p.lastOrderAtMs < rules.cooldownSeconds * 1000) reject('WIS_STOCK_COOLDOWN', '이전 주문 후 대기 시간이 지나지 않았습니다.');
  if (side === 'BUY' && BigInt(p.cashBalance) < BigInt(cashDebit) + BigInt(rules.minimumCashReserve)) reject('WIS_STOCK_INSUFFICIENT_CASH', '매수 금액·수수료·최소 보유 현금을 충족하지 못합니다.');
  if (side === 'SELL' && quantity > p.holdingQuantity) reject('WIS_STOCK_INSUFFICIENT_HOLDING', '보유 수량보다 많이 매도할 수 없습니다.');
  if ((side === 'BUY' && quantity > stock.availableShares) || (side === 'SELL' && stock.availableShares + quantity > settings.issuedShares)) reject('WIS_STOCK_ISSUED_LIMIT', '시장에 남아 있는 발행 수량을 확인해 주세요.');
  const nextHoldingQuantity = side === 'BUY' ? safe(BigInt(p.holdingQuantity) + BigInt(quantity)) : p.holdingQuantity - quantity;
  if (side === 'BUY' && (nextHoldingQuantity > settings.issuedShares || nextHoldingQuantity > rules.maxHoldingQuantity)) reject('WIS_STOCK_HOLDING_LIMIT', '발행 수량 또는 한 종목 보유 한도를 넘었습니다.');
  if (side === 'BUY' && BigInt(nextHoldingQuantity) * BigInt(stock.price) * BPS > BigInt(p.portfolioValue - fee) * BigInt(rules.maxConcentrationBps)) reject('WIS_STOCK_CONCENTRATION_LIMIT', '한 종목에 보유할 수 있는 자산 비중을 넘었습니다.');
  const principalRemoved = side === 'SELL' ? safe(BigInt(p.holdingPrincipal) * BigInt(quantity) / BigInt(p.holdingQuantity)) : 0;
  const costBasisRemoved = side === 'SELL' ? safe(BigInt(p.holdingCostBasis) * BigInt(quantity) / BigInt(p.holdingQuantity)) : 0;
  const realizedPnl = side === 'SELL' ? cashCredit - costBasisRemoved : 0;
  const cumulativeRealizedPnl = safe(BigInt(p.cumulativeRealizedPnl) + BigInt(realizedPnl));
  const profitHighWatermark = Math.max(p.profitHighWatermark, cumulativeRealizedPnl, 0);
  return { side, quantity, unitPrice: stock.price, gross, fee, cashDebit, cashCredit,
    walletDelta: cashCredit - cashDebit, principalRemoved, costBasisRemoved,
    buyFeesRemoved: costBasisRemoved - principalRemoved, principalRecovered: Math.min(cashCredit, principalRemoved),
    realizedPnl, cumulativeRealizedPnl, profitHighWatermark,
    // Trading stays inside the separate stock account. General Wis earnings
    // are recognized only by the separately reviewed withdrawal policy.
    earnedDelta: 0, rankEarnedDelta: 0,
    nextCashBalance: safe(BigInt(p.cashBalance) + BigInt(cashCredit) - BigInt(cashDebit)), nextHoldingQuantity,
    nextHoldingPrincipal: safe(BigInt(p.holdingPrincipal) - BigInt(principalRemoved) + (side === 'BUY' ? BigInt(gross) : 0n)),
    nextHoldingCostBasis: safe(BigInt(p.holdingCostBasis) - BigInt(costBasisRemoved) + BigInt(cashDebit)),
    dayKey: session.dayKey, nextDailyBuyAmount: safe(BigInt(dailyBuyAmount) + BigInt(cashDebit)), nextDailyOrderCount: dailyOrderCount + 1,
    nextAvailableShares: side === 'BUY' ? stock.availableShares - quantity : stock.availableShares + quantity,
    executable: false, studentOpen: false };
}
