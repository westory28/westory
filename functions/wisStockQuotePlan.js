'use strict';

const { WIS_STOCK_PRICE_INTERVAL_MS: INTERVAL, wisStockKstSession, isWisStockTradingSession, nextWisStockPriceTick } = require('./wisStockMarketRules');
const { readCatalogPlan } = require('./wisStockCatalogSchedule');
const { setImmediate } = require('node:timers/promises');
const { HttpsError } = require('firebase-functions/v2/https');
const catalog = require('./wisStockCatalog.json');
const DAY = 86_400_000;
const specialSessions = Object.freeze([
  { dayKey: '2026-12-16', label: '검은 화요일', changeBps: -2000 },
  { dayKey: '2026-12-23', label: '크리스마스 랠리', changeBps: 1000 },
  { dayKey: '2026-12-24', label: '크리스마스 랠리', changeBps: 1000 },
]);

function specialPrice(event, minute, rules, openPrice) {
  const first = Math.ceil(rules.openMinuteKst / 10) * 10;
  const last = Math.floor((rules.closeMinuteKst - 1) / 10) * 10;
  const progress = Math.min(1, Math.max(0, (minute - first + 10) / (last - first + 10)));
  const rawTarget = openPrice * (10000 + event.changeBps) / 10000;
  const target = event.changeBps > 0 ? Math.ceil(rawTarget) : Math.round(rawTarget);
  const bounded = Math.max(1, Math.min(1_000_000, target));
  return Math.round(openPrice + (bounded - openPrice) * progress);
}

// All required settings, past observations and the private seed are already in
// one authorized market snapshot. The projection never runs workers or writes
// historical, public, receipt or graduation documents.
function planWindow(market, asOfMs) {
  const slotStart = nextWisStockPriceTick(asOfMs) - INTERVAL;
  const startsAtMs = readCatalogPlan(market)?.startsAtMs ?? slotStart;
  const endsAtMs = Math.min(startsAtMs + 42 * DAY, slotStart + 42 * DAY);
  const firstDay = wisStockKstSession(startsAtMs).dayKey, lastDay = wisStockKstSession(endsAtMs - 1).dayKey;
  return { startsAtMs, endsAtMs, specialSessions: specialSessions.filter(item => firstDay <= item.dayKey && item.dayKey <= lastDay) };
}

async function projectMarket(market, asOfMs, { startsAtMs, endsAtMs }, advanceSlot, isCurrent) {
  const first = nextWisStockPriceTick(asOfMs), paths = new Map(), samples = new Map();
  const size = Math.max(0, Math.ceil((endsAtMs - first) / INTERVAL));
  let activeSlots = 0;
  for (let atMs = first; atMs < endsAtMs; atMs += INTERVAL) {
    if (!isWisStockTradingSession(market.rules, atMs)) continue;
    market = advanceSlot(market, atMs, samples).updated;
    // Time is implicit in the array index. Even at 100 stocks trading around
    // the clock for 42 days the retained numeric series take under 2.5 MiB.
    if (atMs >= startsAtMs) {
      const { dayKey } = wisStockKstSession(atMs);
      const event = specialSessions.some(item => item.dayKey === dayKey);
      for (const stock of market.stocks) {
        if (['HALTED', 'GRADUATED'].includes(stock.settings.tradingStatus) || (!event && !stock.settings.automatic)) continue;
        let values = paths.get(stock.id);
        if (!values) { values = new Int32Array(size); paths.set(stock.id, values); }
        values[(atMs - first) / INTERVAL] = stock.price;
      }
    }
    if (++activeSlots % 24 === 0) {
      await setImmediate();
      if (!isCurrent()) throw new HttpsError('aborted', '시세 기준이 변경되었습니다. 다시 조회해 주세요.');
    }
  }
  return { first, paths };
}

function createForecastReader(advanceSlot) {
  let cached;
  return async (market, stockId, asOfMs) => {
    const entry = catalog.find(item => item.id === stockId);
    const sameName = entry ? market.stocks.filter(item => item.settings.name.trim() === entry.name) : [];
    const stock = market.stocks.find(item => item.id === stockId) || (sameName.length === 1 ? sameName[0] : undefined);
    if (!stock && !entry) return null;
    const window = planWindow(market, asOfMs);
    const result = { semesterId: market.semesterId, stockId, revision: market.revision, asOfMs, ...window, history: [] };
    if (market.rules.halted || !market.rules.automaticPrices || !market.studentOpen || asOfMs >= window.endsAtMs
      || window.startsAtMs >= window.endsAtMs || (!stock && !market.catalogPlan) || ['HALTED', 'GRADUATED'].includes(stock?.settings.tradingStatus)) return result;
    // Authorization and the current market snapshot were checked by the caller.
    // Keep only the current semester/revision/slot, including overlapping calls.
    const key = `${market.semesterId}/${market.revision}/${nextWisStockPriceTick(asOfMs)}`;
    if (cached?.key !== key) {
      const projection = Promise.resolve().then(() => projectMarket(market, asOfMs, window, advanceSlot, () => cached?.key === key));
      cached = { key, projection };
      projection.catch(() => { if (cached?.projection === projection) cached = undefined; });
    }
    const { first, paths } = await cached.projection;
    paths.get(stock?.id ?? stockId)?.forEach((price, index) => {
      if (price > 0) result.history.push({ atMs: first + index * INTERVAL, price });
    });
    return result;
  };
}

module.exports = { createForecastReader, specialSessions, specialPrice, planWindow };
