// Reconstruct only from immutable filled trades and actual stored quotations.
// No I/O, synthetic backfill, current-position extrapolation, or money writes.
const MAX = Number.MAX_SAFE_INTEGER;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const stockKey = value => typeof value === 'string' && /^stock_[a-f0-9]{24}$/.test(value);
const fail = () => { const error = new Error('확정 거래와 현재 보유 주식이 일치하지 않아 수익률 이력을 표시할 수 없습니다.');
  error.reason = 'WIS_STOCK_INVESTMENT_HISTORY_INVALID'; throw error; };
const safe = value => { if (value > BigInt(MAX) || value < -BigInt(MAX)) fail(); return Number(value); };
const add = (a, b) => safe(BigInt(a) + BigInt(b));
const multiply = (a, b) => safe(BigInt(a) * BigInt(b));

export function buildWisStockInvestmentHistorySeries({ account, fills, stocks, asOfMs }) {
  if (!record(account) || !record(account.positions) || !integer(account.revision) || !Array.isArray(fills)
    || !fills.every(record) || !Array.isArray(stocks) || !stocks.every(record) || !integer(asOfMs, 1)) fail();
  const trades = [...fills].sort((a, b) => a.sequence - b.sequence), used = new Set(), positions = new Map();
  let previousSequence = 0, previousTime = 0;
  for (const trade of trades) {
    if (!integer(trade.sequence, 1) || trade.sequence <= previousSequence || trade.sequence > account.revision
      || !integer(trade.atMs, 1) || trade.atMs < previousTime || trade.atMs > asOfMs
      || !stockKey(trade.stockId) || !['BUY', 'SELL'].includes(trade.side) || !integer(trade.quantity, 1)
      || !integer(trade.unitPrice, 1) || !integer(trade.fee) || !integer(trade.stockCashDelta, -MAX)
      || !integer(trade.realizedPnl, -MAX)) fail();
    const gross = multiply(trade.quantity, trade.unitPrice);
    if (trade.side === 'BUY' ? trade.stockCashDelta !== -add(gross, trade.fee) || trade.realizedPnl !== 0
      : trade.stockCashDelta !== add(gross, -trade.fee)) fail();
    previousSequence = trade.sequence; previousTime = trade.atMs; used.add(trade.stockId);
  }
  const apply = trade => {
    const current = positions.get(trade.stockId) || { quantity: 0, costBasis: 0 };
    const quantity = add(current.quantity, trade.side === 'BUY' ? trade.quantity : -trade.quantity);
    const removedCost = trade.side === 'SELL' ? add(trade.stockCashDelta, -trade.realizedPnl) : 0;
    const costBasis = add(current.costBasis, trade.side === 'BUY' ? -trade.stockCashDelta : -removedCost);
    if (quantity < 0 || costBasis < 0 || removedCost < 0 || (quantity === 0 ? costBasis !== 0 : costBasis === 0)) fail();
    positions.set(trade.stockId, { quantity, costBasis });
  };
  const quotes = new Map();
  for (const stock of stocks) {
    if (!stockKey(stock.id) || quotes.has(stock.id) || !integer(stock.price, 1) || !Array.isArray(stock.history) || !stock.history.every(record)) fail();
    const sorted = [...stock.history].sort((a, b) => a.atMs - b.atMs);
    if (sorted.some((point, index) => !integer(point.atMs, 1) || point.atMs > asOfMs || !integer(point.price, 1)
      || (index > 0 && point.atMs === sorted[index - 1].atMs && point.price !== sorted[index - 1].price))) fail();
    // The current price is confirmed at this read, not retroactively at the
    // last history time (a manual settings update may have changed it).
    quotes.set(stock.id, [...sorted.filter(point => point.atMs < asOfMs), { atMs: asOfMs, price: stock.price }]);
  }
  const firstTradeAtMs = trades[0]?.atMs ?? asOfMs;
  const times = new Set([asOfMs, ...trades.map(trade => trade.atMs)]);
  for (const id of used) for (const point of quotes.get(id) || []) if (point.atMs >= firstTradeAtMs) times.add(point.atMs);
  const points = [], quoteIndices = new Map();
  let tradeIndex = 0, incompleteBeforeMs = null;
  for (const atMs of [...times].sort((a, b) => a - b)) {
    while (tradeIndex < trades.length && trades[tradeIndex].atMs <= atMs) apply(trades[tradeIndex++]);
    let holdingValue = 0, holdingCostBasis = 0, missing = false;
    for (const [id, position] of positions) {
      if (!position.quantity) continue;
      holdingCostBasis = add(holdingCostBasis, position.costBasis);
      const history = quotes.get(id) || [];
      let index = quoteIndices.get(id) ?? -1;
      while (index + 1 < history.length && history[index + 1].atMs <= atMs) index++;
      quoteIndices.set(id, index);
      if (index < 0) missing = true;
      else holdingValue = add(holdingValue, multiply(position.quantity, history[index].price));
    }
    if (missing) incompleteBeforeMs = atMs;
    const point = { atMs, holdingValue: missing ? null : holdingValue, holdingCostBasis: missing ? null : holdingCostBasis };
    // Keep unchanged observations too: dropping the last flat observation
    // would draw a slope before the price actually moved.
    points.push(point);
  }
  for (const id of new Set([...positions.keys(), ...Object.keys(account.positions)])) {
    const expected = account.positions[id] || { quantity: 0, costBasis: 0 }, restored = positions.get(id) || { quantity: 0, costBasis: 0 };
    if (!stockKey(id) || !integer(expected.quantity) || !integer(expected.costBasis)
      || restored.quantity !== expected.quantity || restored.costBasis !== expected.costBasis) fail();
  }
  return { points, incompleteBeforeMs };
}
