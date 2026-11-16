const catalog = require('./wisStockCatalog.json');
const { normalizeWisStockMarketRules, isWisStockTradingSession, wisStockKstSession } = require('./wisStockMarketRules');

// The same reviewed catalog feeds the teacher plan and the server. Only listing
// times are operational here: synthetic future prices, exits and mergers are not.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;
const PLAN_SPAN = 39 * DAY + 6 * HOUR;
const periods = ['구석기~고조선', '삼국 시대', '통일신라와 발해', '후삼국과 고려',
  '조선 전기~왜란·호란', '붕당·탕평과 조선 후기 상업'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function invalidPlan() {
  const error = new RangeError('종목 상장 시작일은 월요일 오전 9시(한국 시간)로 설정해 주세요.');
  error.reason = 'WIS_STOCK_CATALOG_PLAN_INVALID';
  throw error;
}

function normalizeCatalogPlan(value) {
  if (value === undefined || value === null) return null;
  if (!record(value) || Object.keys(value).some(key => !['version', 'startsAtMs'].includes(key))
    || value.version !== 1 || !Number.isSafeInteger(value.startsAtMs) || value.startsAtMs < 0
    || value.startsAtMs > 8_640_000_000_000_000 - KST_OFFSET - PLAN_SPAN
    || value.startsAtMs % HOUR !== 0) invalidPlan();
  const session = wisStockKstSession(value.startsAtMs);
  if (session.dayOfWeek !== 1 || session.minute !== 540) invalidPlan();
  return { version: 1, startsAtMs: value.startsAtMs };
}

function listingAtMs(entry, plan) {
  const index = entry.listingSession - 1;
  const tradingDay = Math.floor(index / 7);
  return plan.startsAtMs + (Math.floor(tradingDay / 5) * 7 + tradingDay % 5) * DAY
    + (index % 7) * HOUR;
}

function pendingEntries(market, plan) {
  const ids = new Set(market.stocks.map(stock => stock.id));
  // A previously registered template can have a request-derived ID. Preserve
  // its saved settings, price and history rather than silently replacing it.
  const names = new Set(market.stocks.map(stock => stock.settings.name.trim()));
  return catalog.filter(entry => !ids.has(entry.id) && !names.has(entry.name))
    .map(entry => ({ entry, atMs: listingAtMs(entry, plan) }));
}

function nextTradingAtMs(rules, atMs) {
  if (isWisStockTradingSession(rules, atMs)) return atMs;
  const date = new Date(atMs + KST_OFFSET);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - KST_OFFSET;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = dayStart + offset * DAY + rules.openMinuteKst * 60_000;
    if (candidate >= atMs && isWisStockTradingSession(rules, candidate)) return candidate;
  }
  return null;
}

function catalogScheduleState(market, atMs) {
  const plan = normalizeCatalogPlan(market.catalogPlan);
  if (!plan) return { plan: null, totalCount: catalog.length, listedCount: 0,
    pendingCount: 0, dueCount: 0, nextListingAtMs: null };
  const pending = pendingEntries(market, plan);
  const rules = normalizeWisStockMarketRules(market.rules);
  const firstDue = pending.length ? Math.min(...pending.map(item => item.atMs)) : null;
  return { plan, totalCount: catalog.length, listedCount: catalog.length - pending.length,
    pendingCount: pending.length, dueCount: pending.filter(item => item.atMs <= atMs).length,
    nextListingAtMs: firstDue !== null && market.studentOpen === true && !rules.halted
      ? nextTradingAtMs(rules, Math.max(atMs, firstDue)) : null };
}

function listingSettings(entry) {
  return { name: entry.name, period: entry.week ? periods[entry.week - 1] : '상시 가치 종목',
    description: `${entry.tagline}\n${entry.fact}`, initialPrice: entry.basePrice,
    minimumPrice: 1, maximumPrice: 1_000_000,
    volatilityBps: entry.growthProfile === 'VALUE' ? 180 : 300,
    trendBps: entry.growthProfile === 'VALUE' ? 35 : 0,
    intervalHours: 1, automatic: true, growthProfile: entry.growthProfile,
    issuedShares: 100_000, lotSize: 1, tradingStatus: 'ACTIVE' };
}

function applyDueCatalogListings(market, atMs) {
  const plan = normalizeCatalogPlan(market.catalogPlan);
  if (!plan || market.studentOpen !== true) return { market, addedIds: [] };
  const rules = normalizeWisStockMarketRules(market.rules);
  if (rules.halted || !isWisStockTradingSession(rules, atMs)) return { market, addedIds: [] };
  const pending = pendingEntries(market, plan).filter(item => item.atMs <= atMs);
  if (!pending.length) return { market, addedIds: [] };
  const { dayKey } = wisStockKstSession(atMs);
  const added = pending.map(({ entry }) => {
    const settings = listingSettings(entry);
    return { id: entry.id, settings, price: settings.initialPrice,
      priceModel: { version: 1, anchorAtMs: atMs, anchorPrice: settings.initialPrice },
      dayKey, dayOpenPrice: settings.initialPrice, haltedUntilMs: 0,
      updatedAtMs: atMs, nextTickAtMs: (Math.floor(atMs / HOUR) + 1) * HOUR,
      history: [{ atMs, price: settings.initialPrice }] };
  });
  // The caller owns capacity checks, revision, audit receipt and atomic public
  // projection. Retrying its transaction sees these stable IDs and adds none.
  return { market: { ...market, stocks: [...market.stocks, ...added] }, addedIds: added.map(stock => stock.id) };
}

module.exports = { normalizeCatalogPlan, catalogScheduleState, applyDueCatalogListings };
