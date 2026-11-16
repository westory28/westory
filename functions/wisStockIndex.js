'use strict';

// A chain-linked market-capitalization index. Constituents enter at their first
// actual observation; issuance changes affect subsequent weights, not returns.
const BASE_VALUE = 1000;
const INDEX_HISTORY_LIMIT = 120;
const KST_OFFSET = 9 * 3_600_000;
const dayKey = atMs => new Date(atMs + KST_OFFSET).toISOString().slice(0, 10);
const positive = value => Number.isFinite(value) && value > 0;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000 - KST_OFFSET;
const emptyIndex = () => ({ version: 1, baseValue: BASE_VALUE, baseAtMs: 0,
  value: BASE_VALUE, previousClose: BASE_VALUE, dayKey: '', updatedAtMs: 0, history: [] });

function validWisStockIndex(value) {
  if (!value || value.version !== 1 || value.baseValue !== BASE_VALUE
    || !timestamp(value.baseAtMs) || !timestamp(value.updatedAtMs)
    || !positive(value.value) || !positive(value.previousClose)
    || !Array.isArray(value.history) || value.history.length > INDEX_HISTORY_LIMIT) return false;
  if (!value.history.length) return value.baseAtMs === 0 && value.updatedAtMs === 0
    && value.value === BASE_VALUE && value.previousClose === BASE_VALUE && value.dayKey === '';
  return value.dayKey === dayKey(value.updatedAtMs)
    && value.history.every((point, i) => point && timestamp(point.atMs) && positive(point.value)
      && point.atMs >= value.baseAtMs && (!i || point.atMs > value.history[i - 1].atMs))
    && value.history.at(-1).atMs === value.updatedAtMs && value.history.at(-1).value === value.value;
}

function capitalization(stock, price = stock.price) {
  if (!Number.isSafeInteger(price) || price < 1
    || !Number.isSafeInteger(stock.settings.issuedShares) || stock.settings.issuedShares < 1)
    throw new TypeError('Invalid stock capitalization');
  // Sum before converting to a ratio: 100 * 1e6 * 1e9 exceeds safe Number integers.
  return BigInt(price) * BigInt(stock.settings.issuedShares);
}

function linkedValue(value, previousStocks, nextStocks) {
  const nextById = new Map(nextStocks.map(stock => [stock.id, stock]));
  let before = 0n, after = 0n;
  for (const stock of previousStocks) {
    const next = nextById.get(stock.id);
    if (!next) continue;
    before += capitalization(stock);
    after += capitalization(stock, next.price);
  }
  if (before === 0n || before === after) return value;
  const result = value * (Number(after) / Number(before));
  if (!positive(result)) throw new RangeError('Invalid market index value');
  return result;
}

function observe(index, value, atMs) {
  const observedDay = dayKey(atMs);
  if (!index.history.length) return { ...emptyIndex(), baseAtMs: atMs,
    value: BASE_VALUE, dayKey: observedDay, updatedAtMs: atMs, history: [{ atMs, value: BASE_VALUE }] };
  if (atMs < index.updatedAtMs) throw new RangeError('Market index observations must be chronological');
  const previousClose = observedDay !== index.dayKey ? index.value : index.previousClose;
  const history = index.history.at(-1).atMs === atMs ? index.history.slice(0, -1) : index.history;
  return { ...index, value, previousClose, dayKey: observedDay, updatedAtMs: atMs,
    history: [...history, { atMs, value }].slice(-INDEX_HISTORY_LIMIT) };
}

function reconstructWisStockIndex(market, atMs) {
  const events = new Map();
  for (const stock of market.stocks) {
    // Legacy storage has no historical share counts. Use its current issuance,
    // and only recorded prices; never infer prices before the retained history.
    const observations = new Map();
    for (const point of stock.history || []) {
      if (timestamp(point.atMs) && point.atMs <= atMs) observations.set(point.atMs, point.price);
    }
    if (timestamp(stock.updatedAtMs) && stock.updatedAtMs <= atMs)
      observations.set(stock.updatedAtMs, stock.price);
    for (const [observedAt, price] of observations) {
      if (!events.has(observedAt)) events.set(observedAt, []);
      events.get(observedAt).push({ ...stock, price });
    }
  }
  let index = emptyIndex();
  const basket = new Map();
  for (const observedAt of [...events.keys()].sort((a, b) => a - b)) {
    const previous = [...basket.values()];
    for (const stock of events.get(observedAt)) basket.set(stock.id, stock);
    index = observe(index, linkedValue(index.value, previous, [...basket.values()]), observedAt);
  }
  return index;
}

function currentWisStockIndex(market, atMs) {
  if (market.marketIndex !== undefined) {
    if (!validWisStockIndex(market.marketIndex)) throw new TypeError('Invalid stored market index');
    return market.marketIndex;
  }
  return reconstructWisStockIndex(market, atMs);
}

function updateWisStockIndex(previous, updated, atMs) {
  const index = currentWisStockIndex(previous, atMs);
  const before = new Map(previous.stocks.map(stock => [stock.id, stock]));
  const changed = previous.stocks.length !== updated.stocks.length || updated.stocks.some(stock => {
    const old = before.get(stock.id);
    return !old || old.price !== stock.price || old.settings.issuedShares !== stock.settings.issuedShares;
  });
  if (!changed) return { ...updated, marketIndex: index };
  return { ...updated, marketIndex: observe(index,
    linkedValue(index.value, previous.stocks, updated.stocks), atMs) };
}

function wisStockIndexState(market, atMs) {
  const index = currentWisStockIndex(market, atMs);
  return { baseValue: BASE_VALUE, baseAtMs: index.baseAtMs, value: index.value,
    previousClose: index.dayKey && dayKey(atMs) > index.dayKey ? index.value : index.previousClose,
    updatedAtMs: index.updatedAtMs, history: index.history.map(({ atMs: time, value }) => ({ atMs: time, value })) };
}

module.exports = { BASE_VALUE, INDEX_HISTORY_LIMIT, emptyIndex, validWisStockIndex,
  reconstructWisStockIndex, updateWisStockIndex, wisStockIndexState };
