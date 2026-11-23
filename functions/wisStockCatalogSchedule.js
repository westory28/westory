const { createHmac } = require('node:crypto');
const catalog = require('./wisStockCatalog.json');
const { catalogSessionAtMs, catalogExitAtMs } = require('./wisStockCatalogTimeline');
const { normalizeWisStockMarketRules, isWisStockTradingSession, wisStockKstSession, nextWisStockPriceTick } = require('./wisStockMarketRules');

// The same reviewed dates feed the teacher plan and the server. Exits require
// a separate authenticated activation; synthetic prices never become quotes.
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
  if (!record(value) || Object.keys(value).some(key => !['version', 'startsAtMs', 'exitsEnabledAtMs', 'exitOverrides'].includes(key))
    || value.version !== 1 || !Number.isSafeInteger(value.startsAtMs) || value.startsAtMs < 0
    || value.startsAtMs > 8_640_000_000_000_000 - KST_OFFSET - PLAN_SPAN
    || value.startsAtMs % HOUR !== 0) invalidPlan();
  const session = wisStockKstSession(value.startsAtMs);
  if (session.dayOfWeek !== 1 || session.minute !== 540) invalidPlan();
  const plan = { version: 1, startsAtMs: value.startsAtMs };
  if (value.exitsEnabledAtMs !== undefined) {
    if (!Number.isSafeInteger(value.exitsEnabledAtMs) || value.exitsEnabledAtMs <= 0
      || value.exitsEnabledAtMs > 8_640_000_000_000_000 - KST_OFFSET) invalidPlan();
    plan.exitsEnabledAtMs = value.exitsEnabledAtMs;
  }
  if (value.exitOverrides !== undefined) {
    if (!record(value.exitOverrides)) invalidPlan();
    const overrides = {};
    for (const [id, atMs] of Object.entries(value.exitOverrides).sort(([a], [b]) => a.localeCompare(b))) {
      const entry = catalog.find(item => item.id === id && item.exitKind !== 'survive' && item.exitSession !== null);
      if (!entry || !Number.isSafeInteger(atMs) || atMs < catalogSessionAtMs(entry.exitSession, value.startsAtMs)
        || atMs > 8_640_000_000_000_000 - KST_OFFSET || atMs % (30 * 60_000) !== 0) invalidPlan();
      overrides[id] = atMs;
    }
    plan.exitOverrides = overrides;
  }
  return plan;
}

function listingAtMs(entry, plan) {
  return catalogSessionAtMs(entry.listingSession, plan.startsAtMs);
}

function readCatalogPlan(market) {
  const plan = normalizeCatalogPlan(market.catalogPlan);
  if (market.catalogExits === undefined) return plan;
  // Keep the stored v1 listing plan compatible with existing student workers.
  // The management DTO combines both records for the shared teacher timeline.
  const exits = market.catalogExits;
  if (!plan || !record(exits) || Object.keys(exits).some(key => !['enabledAtMs', 'overrides'].includes(key))
    || exits.enabledAtMs === undefined || exits.overrides === undefined) invalidPlan();
  return normalizeCatalogPlan({ ...plan, exitsEnabledAtMs: exits.enabledAtMs, exitOverrides: exits.overrides });
}

function applyDueCatalogExits(market, atMs) {
  const plan = readCatalogPlan(market);
  if (!plan?.exitsEnabledAtMs || plan.exitsEnabledAtMs > atMs || market.studentOpen !== true)
    return { market, exited: [] };
  const rules = normalizeWisStockMarketRules(market.rules);
  if (rules.halted || !isWisStockTradingSession(rules, atMs)) return { market, exited: [] };
  const exited = [];
  const stocks = market.stocks.map(stock => {
    // Only canonical catalog IDs carry scheduled lifecycle authority. A custom
    // stock with a matching display name must not be liquidated automatically.
    const entry = catalog.find(item => item.id === stock.id && item.exitKind !== 'survive');
    const plannedAtMs = entry ? catalogExitAtMs(entry, plan) : null;
    if (plannedAtMs === null || plannedAtMs > atMs || stock.settings.tradingStatus === 'GRADUATED') return stock;
    exited.push({ stockId: stock.id, unitPrice: stock.price, atMs, plannedAtMs, exitKind: entry.exitKind });
    return { ...stock, settings: { ...stock.settings, tradingStatus: 'GRADUATED' },
      graduation: { unitPrice: stock.price, atMs, plannedAtMs, exitKind: entry.exitKind } };
  });
  return exited.length ? { market: { ...market, stocks }, exited } : { market, exited };
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
  const plan = readCatalogPlan(market);
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

const MIN_LISTING_PRICE = 100;
const MAX_LISTING_PRICE = 500;

// A separate stream per instrument makes the first quote reproducible across
// transaction retries, delayed listing batches and changes in listing order.
function drawListingPrice(seed, semesterId, stockId, minimum = MIN_LISTING_PRICE, maximum = MAX_LISTING_PRICE) {
  const sample = createHmac('sha256', seed || '').update(`wispi-listing-v1\n${semesterId}\n${stockId}`).digest().readUInt32BE();
  return minimum + Math.floor(sample / 0x1_0000_0000 * (maximum - minimum + 1));
}
function listingSettings(entry, initialPrice) {
  return { name: entry.name, period: entry.week ? periods[entry.week - 1] : '상시 가치 종목',
    description: `${entry.tagline}\n${entry.fact}`, initialPrice,
    minimumPrice: 1, maximumPrice: 1_000_000,
    volatilityBps: entry.growthProfile === 'VALUE' ? 180 : 300,
    trendBps: entry.growthProfile === 'VALUE' ? 35 : 0,
    intervalHours: 1, automatic: true, growthProfile: entry.growthProfile,
    issuedShares: 100_000, lotSize: 1, tradingStatus: 'ACTIVE' };
}

function applyDueCatalogListings(market, atMs, openingPrice = drawListingPrice) {
  const plan = normalizeCatalogPlan(market.catalogPlan);
  if (!plan || market.studentOpen !== true) return { market, addedIds: [] };
  const rules = normalizeWisStockMarketRules(market.rules);
  if (rules.halted || !isWisStockTradingSession(rules, atMs)) return { market, addedIds: [] };
  const pending = pendingEntries(market, plan).filter(item => item.atMs <= atMs);
  if (!pending.length) return { market, addedIds: [] };
  const { dayKey } = wisStockKstSession(atMs);
  const added = pending.map(({ entry }) => {
    const settings = listingSettings(entry, openingPrice(market.priceSeed, market.semesterId, entry.id));
    return { id: entry.id, settings, price: settings.initialPrice, listedAtMs: atMs,
      priceModel: { version: 1, anchorAtMs: atMs, anchorPrice: settings.initialPrice },
      dayKey, dayOpenPrice: settings.initialPrice, haltedUntilMs: 0,
      updatedAtMs: atMs, nextTickAtMs: nextWisStockPriceTick(atMs),
      history: [{ atMs, price: settings.initialPrice }] };
  });
  // The caller owns capacity checks, revision, audit receipt and atomic public
  // projection. Retrying its transaction sees these stable IDs and adds none.
  return { market: { ...market, stocks: [...market.stocks, ...added] }, addedIds: added.map(stock => stock.id) };
}

module.exports = { normalizeCatalogPlan, readCatalogPlan, catalogScheduleState, applyDueCatalogListings, applyDueCatalogExits,
  drawListingPrice, MIN_LISTING_PRICE, MAX_LISTING_PRICE };
