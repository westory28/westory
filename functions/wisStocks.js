const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { sampleWisStockPriceStep, sampleWisStockMarketFactors, wisStockPriceModelAnchor, wisStockPreviousMarketReturn, wisStockMarketStress, wisStockSector } = require('./wisStockPriceModel');
const { createForecastReader, specialSessions, specialPrice, planWindow } = require('./wisStockQuotePlan');
const { normalizeWisStockMarketRules, normalizeWisStockTradingSettings,
  isWisStockTradingSession, wisStockKstSession, wisStockDailyBounds,
  WIS_STOCK_PRICE_INTERVAL_MS, wisStockPriceSlot, nextWisStockPriceTick } = require('./wisStockMarketRules');
const { drawListingPrice, MIN_LISTING_PRICE, MAX_LISTING_PRICE, catalogHistoryTrendBps } = require('./wisStockCatalogSchedule');
const { catalogExitAtMs, catalogSessionAtMs } = require('./wisStockCatalogTimeline');
const { DOMESTIC } = require('./wisStockVenues');
const { WIS_STOCK_FX_PATH, parseWisStockFxRate } = require('./wisStockFx');
const { INDEX_HISTORY_LIMIT, emptyIndex, validWisStockIndex, updateWisStockIndex, wisStockIndexState } = require('./wisStockIndex');

// Teacher market administration. Student orders remain separate server commands.
const MAX_STOCKS = 100;
const HISTORY_LIMIT = 120;
const MAX_PRICE = 1_000_000;
const MAX_MARKET_BYTES = 960 * 1024;
const HOUR = 3_600_000;
const ADMIN_EMAIL = 'westoria28@gmail.com';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const invalid = () => fail('invalid-argument', '종목 입력값을 확인해 주세요.', 'WIS_STOCK_INPUT_INVALID');
const safeInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const allowed = (value, fields) => record(value) && Object.keys(value).every(key => fields.includes(key));
const scopeInput = input => {
  if (!record(input) || !/^20\d{2}$/.test(input.year) || !/^[12]$/.test(input.semester)) invalid();
  return { year: input.year, semester: input.semester, semesterId: `${input.year}-${input.semester}` };
};
const marketPath = ({ year, semester }, venue = DOMESTIC) => `years/${year}/semesters/${semester}/wis_stock_markets/${venue.marketDoc}`;
const publicStockPath = ({ year, semester }, documentId) => `years/${year}/semesters/${semester}/wis_stock_public/${documentId}`;
const receiptPath = (scope, uid, requestId, venue = DOMESTIC) => `years/${scope.year}/semesters/${scope.semester}/${venue.receipts}/${hash(`${uid}\n${requestId}`)}`;
const blankMarket = (scope, venue = DOMESTIC) => ({ schemaVersion: 1, semesterId: scope.semesterId, revision: 0, studentOpen: false,
  tradingEpoch: 0, publicationRevision: 0, publicationUpdatedAtMs: 0,
  rules: normalizeWisStockMarketRules(venue.ruleOverrides || {}), stocks: [], updatedAtMs: 0 });
// Firestore's documented storage calculation, not JSON/wire byte length. Maps
// include 32 bytes; UTF-8 strings and field names include one terminator byte.
// Reserve a full history now so later price ticks never outgrow the document.
// https://firebase.google.com/docs/firestore/storage-size
const fieldBytes = value => {
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + fieldBytes(item), 0);
  if (record(value)) return 32 + Object.entries(value).reduce((sum, [key, item]) => sum + fieldBytes(key) + fieldBytes(item), 0);
  return Infinity;
};
function reservedMarketBytes(market, scope, venue = DOMESTIC) {
  const { stocks, marketIndex, ...fields } = market;
  const reservedIndex = { ...emptyIndex(), ...(marketIndex || {}), dayKey: '0000-00-00', history: [] };
  const indexBytes = fieldBytes('marketIndex') + fieldBytes(reservedIndex)
    + INDEX_HISTORY_LIMIT * fieldBytes({ atMs: Number.MAX_SAFE_INTEGER, value: 1000 });
  const pointSize = fieldBytes({ atMs: Number.MAX_SAFE_INTEGER, price: MAX_PRICE });
  return marketPath(scope, venue).split('/').reduce((sum, part) => sum + fieldBytes(part), 16)
    + fieldBytes({ ...fields, lastPriceSlot: 0, lastTenMinutePriceSlot: 0 }) + indexBytes + fieldBytes('stocks') + stocks.reduce((sum, stock) => {
      const { history, ...data } = stock;
      // Also reserve the model anchor for seedless legacy instruments.
      if (!data.priceModel) data.priceModel = { version: 1, anchorAtMs: 0, anchorPrice: MAX_PRICE };
      if (!data.graduation) data.graduation = { unitPrice: MAX_PRICE, atMs: Number.MAX_SAFE_INTEGER,
        plannedAtMs: Number.MAX_SAFE_INTEGER, exitKind: 'delist' };
      return sum + fieldBytes({ ...data, autoEnabledAtMs: 0 }) + fieldBytes('history') + HISTORY_LIMIT * pointSize;
    }, 0);
}
function assertMarketCapacity(market, scope, venue = DOMESTIC) {
  if (reservedMarketBytes(market, scope, venue) > MAX_MARKET_BYTES) {
    fail('resource-exhausted', '가격 기록을 보관할 공간이 부족합니다. 종목 설명을 줄이거나 등록할 종목 수를 조정해 주세요.', 'WIS_STOCK_STORAGE_CAPACITY');
  }
}
function assertCatalogCapacity(market, scope, venue = DOMESTIC) {
  const plan = venue.schedule.normalizeCatalogPlan(market.catalogPlan);
  const reserved = plan ? venue.schedule.applyDueCatalogListings({ ...market, studentOpen: true,
    rules: { ...market.rules, halted: false, tradingDays: [0, 1, 2, 3, 4, 5, 6], openMinuteKst: 0, closeMinuteKst: 1440 } },
  plan.startsAtMs + 42 * 24 * HOUR, () => MAX_LISTING_PRICE).market : market;
  if (reserved.stocks.length > MAX_STOCKS)
    fail('resource-exhausted', '상장 예정 종목을 포함하면 등록 한도를 초과합니다.', 'WIS_STOCK_CAPACITY');
  assertMarketCapacity(reserved, scope, venue);
}
const TRADING_SETTINGS = ['issuedShares', 'lotSize', 'tradingStatus'];
const SETTINGS = ['name', 'description', 'period', 'initialPrice', 'minimumPrice', 'maximumPrice', 'volatilityBps', 'trendBps', 'intervalHours', 'automatic', ...TRADING_SETTINGS, 'growthProfile'];
const ruleInput = value => {
  try { return normalizeWisStockMarketRules(value); }
  catch (error) { fail('invalid-argument', error.message, error.reason || 'WIS_STOCK_RULES_INVALID'); }
};
function normalizeSettings(value, newListing = false) {
  if (!allowed(value, SETTINGS)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60
    || typeof value.description !== 'string' || value.description.trim().length > 1000
    || typeof value.period !== 'string' || value.period.trim().length > 80
    || !safeInt(value.initialPrice, 1, MAX_PRICE)
    || !safeInt(value.minimumPrice, 1, MAX_PRICE) || !safeInt(value.maximumPrice, 1, MAX_PRICE)
    || value.minimumPrice > value.maximumPrice
    || (!newListing && (value.minimumPrice > value.initialPrice || value.initialPrice > value.maximumPrice))
    || !safeInt(value.volatilityBps, 0, 1000) || !safeInt(value.trendBps, -300, 300)
    || ![1, 6, 24].includes(value.intervalHours) || typeof value.automatic !== 'boolean'
    || !['HISTORICAL', 'VALUE'].includes(value.growthProfile ?? 'HISTORICAL') || value.growthProfile === null) invalid();
  let trading;
  try { trading = normalizeWisStockTradingSettings(Object.fromEntries(TRADING_SETTINGS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))); }
  catch { invalid(); }
  return Object.fromEntries(SETTINGS.map(key => [key, key === 'growthProfile' ? value.growthProfile ?? 'HISTORICAL' : Object.hasOwn(trading, key) ? trading[key]
    : typeof value[key] === 'string' ? value[key].trim() : value[key]]));
}
// Old writers stored 1/6/24-hour deadlines, and still consume those settings
// in orders and receipts. Shorten the deadline without rewriting idle markets.
function priceDueAt(stock) {
  const since = Math.max(stock.updatedAtMs, stock.autoEnabledAtMs || 0, (stock.haltedUntilMs || 0) - 1);
  return Math.min(stock.nextTickAtMs, nextWisStockPriceTick(since));
}
function readMarket(snapshot, scope, venue = DOMESTIC) {
  if (!snapshot.exists) return blankMarket(scope, venue);
  const value = snapshot.data();
  const validStock = stock => {
    try { normalizeSettings(stock.settings); } catch { return false; }
    return /^stock_[a-f0-9]{24}$/.test(stock.id) && safeInt(stock.price, stock.settings.minimumPrice, stock.settings.maximumPrice)
      && (stock.settings.tradingStatus !== 'GRADUATED' || (record(stock.graduation)
        && stock.graduation.unitPrice === stock.price && safeInt(stock.graduation.atMs, 1, Number.MAX_SAFE_INTEGER)))
      && safeInt(stock.updatedAtMs, 0, Number.MAX_SAFE_INTEGER) && safeInt(stock.nextTickAtMs, 0, Number.MAX_SAFE_INTEGER)
      && (stock.listedAtMs === undefined || safeInt(stock.listedAtMs, 0, stock.updatedAtMs))
      && (stock.autoEnabledAtMs === undefined || safeInt(stock.autoEnabledAtMs, 0, Number.MAX_SAFE_INTEGER))
      && Array.isArray(stock.history) && stock.history.length > 0 && stock.history.length <= HISTORY_LIMIT
      && stock.history.every(point => safeInt(point.atMs, 0, Number.MAX_SAFE_INTEGER) && safeInt(point.price, 1, MAX_PRICE));
  };
  let rules;
  try { rules = normalizeWisStockMarketRules(value.rules); venue.schedule.readCatalogPlan(value); } catch { rules = null; }
  if (value.schemaVersion !== 1 || value.semesterId !== scope.semesterId || typeof value.studentOpen !== 'boolean'
    || !rules || (value.priceSeed !== undefined && !/^[a-f0-9]{64}$/.test(value.priceSeed))
    || (value.marketIndex !== undefined && !validWisStockIndex(value.marketIndex))
    || (value.lastPriceSlot !== undefined && !safeInt(value.lastPriceSlot, 0, Number.MAX_SAFE_INTEGER))
    || (value.lastTenMinutePriceSlot !== undefined && !safeInt(value.lastTenMinutePriceSlot, 0, Number.MAX_SAFE_INTEGER))
    || !safeInt(value.tradingEpoch ?? 0, 0, Number.MAX_SAFE_INTEGER - 1)
    || !safeInt(value.publicationRevision ?? 0, 0, Number.MAX_SAFE_INTEGER - 1)
    || !safeInt(value.publicationUpdatedAtMs ?? 0, 0, Number.MAX_SAFE_INTEGER)
    || !safeInt(value.revision, 1, Number.MAX_SAFE_INTEGER - 1) || !Array.isArray(value.stocks)
    || value.stocks.length > MAX_STOCKS || !value.stocks.every(validStock)
    || new Set(value.stocks.map(stock => stock.id)).size !== value.stocks.length) {
    fail('failed-precondition', '주식 설정을 확인하지 못했습니다. 관리자에게 문의해 주세요.', 'WIS_STOCK_MARKET_INVALID');
  }
  const stocks = value.stocks.map(stock => {
    const normalized = { ...stock, settings: normalizeSettings(stock.settings), dayKey: stock.dayKey || '',
      dayOpenPrice: stock.dayOpenPrice ?? stock.price, haltedUntilMs: stock.haltedUntilMs ?? 0 };
    if ((normalized.dayKey && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.dayKey))
      || !safeInt(normalized.dayOpenPrice, 1, MAX_PRICE) || !safeInt(normalized.haltedUntilMs, 0, Number.MAX_SAFE_INTEGER)
      || (stock.priceModel !== undefined && (!allowed(stock.priceModel, ['version', 'anchorAtMs', 'anchorPrice'])
        || stock.priceModel.version !== 1 || !safeInt(stock.priceModel.anchorAtMs, 0, Number.MAX_SAFE_INTEGER)
        || !safeInt(stock.priceModel.anchorPrice, 1, MAX_PRICE)))) {
      fail('failed-precondition', '주식 설정을 확인하지 못했습니다. 관리자에게 문의해 주세요.', 'WIS_STOCK_MARKET_INVALID');
    }
    if (normalized.settings.automatic) normalized.nextTickAtMs = priceDueAt(normalized);
    return normalized;
  });
  return { ...value, rules, stocks, tradingEpoch: value.tradingEpoch ?? 0,
    publicationRevision: value.publicationRevision ?? 0, publicationUpdatedAtMs: value.publicationUpdatedAtMs ?? 0 };
}
const state = (market, atMs, venue = DOMESTIC) => ({ semesterId: market.semesterId, revision: market.revision, studentOpen: market.studentOpen,
  ...(venue === DOMESTIC ? {} : { venue: venue.id, unit: venue.unit }),
  specialSessions: venue.specialSessions ? planWindow(market, atMs).specialSessions : [],
  catalogSchedule: venue.schedule.catalogScheduleState(market, atMs),
  marketIndex: wisStockIndexState(market, atMs),
  tradingEpoch: market.tradingEpoch ?? 0,
  rules: market.rules,
  maxStocks: MAX_STOCKS, historyLimit: HISTORY_LIMIT, updatedAtMs: market.updatedAtMs,
  stocks: market.stocks.map(({ id, settings, price, updatedAtMs, nextTickAtMs, history, dayKey, dayOpenPrice, haltedUntilMs, priceModel }) => ({ id, settings, price, updatedAtMs, nextTickAtMs, history, dayKey, dayOpenPrice, haltedUntilMs, ...(priceModel ? { priceModel } : {}) })) });
const publicStockStatus = market => ({ schemaVersion: 1, semesterId: market.semesterId,
  studentOpen: market.studentOpen, halted: !market.studentOpen || market.rules.halted,
  tradingEpoch: market.tradingEpoch ?? 0, revision: market.publicationRevision ?? 0,
  updatedAtMs: market.publicationUpdatedAtMs ?? 0 });
const publicStockSettings = settings => {
  const normalized = normalizeSettings(settings);
  return Object.fromEntries(['name', 'description', 'period', 'issuedShares', 'lotSize', 'tradingStatus']
    .map(key => [key, normalized[key]]));
};
// Venues that publish their catalog list the entries not yet listed: name,
// era, one-line tagline and listing time only. Scenario reasons (future rises,
// falls and exits) stay server-side. The domestic projection is unchanged.
function publicUpcomingListings(market, venue) {
  if (!venue.publishUpcoming) return {};
  let plan;
  try { plan = venue.schedule.readCatalogPlan(market); } catch { return {}; }
  if (!plan) return {};
  const ids = new Set(market.stocks.map(stock => stock.id));
  const names = new Set(market.stocks.map(stock => stock.settings.name.trim()));
  return { upcoming: venue.schedule.catalog.filter(entry => !ids.has(entry.id) && !names.has(entry.name))
    .map(entry => ({ id: entry.id, name: entry.name, period: venue.schedule.periods[entry.week - 1] || '',
      tagline: entry.tagline, listingAtMs: catalogSessionAtMs(entry.listingSession, plan.startsAtMs) }))
    .sort((a, b) => a.listingAtMs - b.listingAtMs || (a.id < b.id ? -1 : 1)) };
}
const publicStockMarket = (market, venue = DOMESTIC) => ({ schemaVersion: 1, semesterId: market.semesterId,
  studentOpen: true, tradingEpoch: market.tradingEpoch ?? 0, revision: market.revision,
  updatedAtMs: market.updatedAtMs, rules: market.rules,
  ...publicUpcomingListings(market, venue),
  stocks: market.stocks.map(({ id, settings, price, updatedAtMs, nextTickAtMs, history, dayKey, dayOpenPrice, haltedUntilMs, listedAtMs, graduation }) =>
    ({ id, settings: publicStockSettings(settings), price, updatedAtMs, nextTickAtMs,
      history: history.map(({ atMs, price: observedPrice }) => ({ atMs, price: observedPrice })),
      dayKey: dayKey || '', dayOpenPrice: dayOpenPrice ?? price, haltedUntilMs: haltedUntilMs ?? 0,
      // Student alerts: listing time and a trading end. A teacher's manual end
      // has no catalog kind; the student screen reads it as an ordinary close.
      ...(Number.isSafeInteger(listedAtMs) ? { listedAtMs } : {}),
      ...(settings.tradingStatus === 'GRADUATED' && record(graduation) && Number.isSafeInteger(graduation.atMs)
        ? { exit: { atMs: graduation.atMs, kind: ['merge', 'delist'].includes(graduation.exitKind) ? graduation.exitKind : 'close' } } : {}) })) });
function publishStudentMarket(tx, db, scope, previous, updated, venue = DOMESTIC) {
  // No synthetic first publication, extra reads, or menu wakeups on price ticks.
  // A first open installs both safe documents in the same canonical transaction.
  if (!updated.studentOpen) return;
  tx.set(db.doc(publicStockPath(scope, venue.publicMarketDoc)), publicStockMarket(updated, venue));
  if (!previous.studentOpen || previous.publicationRevision !== updated.publicationRevision)
    tx.set(db.doc(publicStockPath(scope, venue.publicStatusDoc)), publicStockStatus(updated));
}
function queueCatalogGraduations(tx, db, scope, exited, venue = DOMESTIC) {
  for (const exit of exited) tx.create(db.doc(`${venue.graduations}/${scope.semesterId}_${exit.stockId}`), {
    schemaVersion: 1, ...scope, ...exit, status: 'PENDING',
  });
}
// Seven independently addressed draws per slot. One private AES-CTR block
// window supplies 64 consecutive slots, with non-overlapping counters, so a
// six-week projection avoids hashing each individual tick/shock several times.
const sampleInput = Buffer.alloc(64 * 8 * 4);
function streamSample(prefix, samples, id) {
  const recent = new Map(), windows = new Map();
  const cipherKey = createHash('sha256').update(prefix).digest();
  const sample = key => {
    const hit = recent.get(key);
    if (hit !== undefined) return hit;
    const value = Number.parseInt(hash(prefix + key).slice(0, 8), 16) / 4294967296;
    if (recent.size >= 256) recent.clear();
    recent.set(key, value);
    return value;
  };
  sample.tick = (slot, lane) => {
    const index = Math.floor(slot / 64);
    let window = windows.get(index);
    if (!window) {
      const iv = Buffer.alloc(16);
      iv.writeBigUInt64BE(BigInt(index) * BigInt(sampleInput.length / 16), 8);
      window = createCipheriv('aes-256-ctr', cipherKey, iv).update(sampleInput);
      if (windows.size >= 2) windows.delete(windows.keys().next().value);
      windows.set(index, window);
    }
    return window.readUInt32BE(((slot % 64) * 8 + lane) * 4) / 4294967296;
  };
  samples?.set(id, sample);
  return sample;
}
function nextPrice(stock, semesterId, slot, priceSeed = '', dailyPriceLimitBps, marketContext, samples) {
  // The private seed never enters callable responses. A missing legacy seed is
  // still deterministic; reads and unchanged saves never migrate documents.
  const sample = samples?.get(stock.id) ?? streamSample(`${priceSeed}\n${semesterId}\n${stock.id}\nwispi-price-v3\n`, samples, stock.id);
  const factor = samples?.get('market') ?? streamSample(`${priceSeed}\n${semesterId}\nwispi-factors-v1\n`, samples, 'market');
  let sampled = stock;
  if (stock.settings.growthProfile === 'VALUE') {
    const anchor = wisStockPriceModelAnchor(stock);
    sampled = { ...stock, priceModel: { ...anchor, anchorAtMs: wisStockPriceSlot(anchor.anchorAtMs) * WIS_STOCK_PRICE_INTERVAL_MS } };
  }
  const sector = wisStockSector(stock);
  const context = { ...marketContext, sampler: factor };
  let factors = context.sectorFactors?.get(sector);
  if (!factors && context.sectorFactors && stock.settings.volatilityBps) {
    factors = sampleWisStockMarketFactors(stock, semesterId, slot, priceSeed, context);
    context.sectorFactors.set(sector, factors);
  }
  const { movementBps } = sampleWisStockPriceStep(sampled, semesterId, slot, priceSeed, sample, dailyPriceLimitBps, context, factors);
  const { volatilityBps, minimumPrice, maximumPrice } = stock.settings;
  // Faster observations retain a shared market/sector trend. Short individual
  // moves and a weak pull toward the day's open give intraday candles wicks
  // without tripling the drift each time the clock gets faster.
  const scale = (dailyPriceLimitBps ?? 1000) / 1000;
  const open = marketContext?.dayOpenPrice ?? stock.price;
  const wick = (sample.tick(slot, 6) * 2 - 1) * 0.12 + (factor(`intraday:${sector}:${slot}`) * 2 - 1) * 0.13;
  const move = volatilityBps ? movementBps / 3 + wick * volatilityBps * scale
    + (open / stock.price - 1) * 10000 * 0.06 : movementBps;
  return Math.max(minimumPrice, Math.min(maximumPrice, Math.round(stock.price * (10000 + move) / 10000)));
}
function priceStock(stock, market, atMs, { dayKey, minute }, event, modelContext, samples) {
  const { settings } = stock, rules = market.rules;
  const slot = wisStockPriceSlot(atMs), boundary = slot * WIS_STOCK_PRICE_INTERVAL_MS;
  if ((!settings.automatic && !event) || ['HALTED', 'GRADUATED'].includes(settings.tradingStatus)
    || priceDueAt(stock) > boundary || (stock.haltedUntilMs || 0) > boundary) return stock;
  const dayOpenPrice = stock.dayKey === dayKey ? stock.dayOpenPrice : stock.price;
  const bounds = wisStockDailyBounds(dayOpenPrice, rules.dailyPriceLimitBps);
  const price = event ? specialPrice(event, minute, rules, dayOpenPrice)
    : Math.max(settings.minimumPrice, bounds.minimum, Math.min(settings.maximumPrice, bounds.maximum,
      nextPrice(modelStock(stock, modelContext, boundary), market.semesterId, slot, market.priceSeed, rules.dailyPriceLimitBps,
        { ...modelContext, atMs: boundary, dayOpenPrice }, samples)));
  if (!event && (price < settings.minimumPrice || price > settings.maximumPrice || price < bounds.minimum || price > bounds.maximum)) return stock;
  // The first large move pauses discovery. Once that pause expires, admit one
  // freshly calculated, bounded price; otherwise a sustained correction could
  // retrigger forever without ever updating the price. Never backdate a print.
  const resumingCircuit = (stock.haltedUntilMs || 0) > 0 && stock.haltedUntilMs <= atMs;
  if (!event && !resumingCircuit && Math.abs(price - stock.price) * 10000 >= stock.price * rules.circuitBreakerBps) {
    return { ...stock, dayKey, dayOpenPrice, haltedUntilMs: boundary + rules.circuitBreakerMinutes * 60000,
      nextTickAtMs: nextWisStockPriceTick(atMs) };
  }
  // The deterministic sample makes a flat retry a no-op too. History stores
  // price changes rather than fabricating points for unchanged prices.
  if (price === stock.price) return stock;
  // Event closes take precedence over custom instrument bands. Widen only the
  // crossed bound so previous readers accept the quote and the next ordinary
  // tick does not snap the price back to the old band.
  const effectiveSettings = event && (price < settings.minimumPrice || price > settings.maximumPrice)
    ? { ...settings, minimumPrice: Math.min(settings.minimumPrice, price), maximumPrice: Math.max(settings.maximumPrice, price) } : settings;
  return { ...stock, settings: effectiveSettings, price, priceModel: wisStockPriceModelAnchor(stock), dayKey, dayOpenPrice, haltedUntilMs: 0, updatedAtMs: atMs, nextTickAtMs: nextWisStockPriceTick(atMs),
    history: [...stock.history, { atMs, price }].slice(-HISTORY_LIMIT) };
}
// A catalog venue with history-led pricing replaces only the model's drift for
// this tick. The stored settings, bounds and teacher-visible trend never change.
function modelStock(stock, modelContext, atMs) {
  const trendBps = modelContext?.trendFor?.(stock, atMs);
  return Number.isSafeInteger(trendBps) && trendBps !== stock.settings.trendBps
    ? { ...stock, settings: { ...stock.settings, trendBps: Math.max(-300, Math.min(300, trendBps)) } } : stock;
}
function advanceMarket(market, atMs, samples, venue = DOMESTIC) {
  const rules = normalizeWisStockMarketRules(market.rules);
  const slot = wisStockPriceSlot(atMs);
  const previousSlot = Math.max(market.lastTenMinutePriceSlot ?? -1, (market.lastPriceSlot ?? -1) * 3);
  if (!rules.automaticPrices || rules.halted || slot <= previousSlot || !isWisStockTradingSession(rules, atMs)) return market;
  const session = wisStockKstSession(slot * WIS_STOCK_PRICE_INTERVAL_MS);
  const event = venue.specialSessions ? specialSessions.find(item => item.dayKey === session.dayKey) : undefined;
  const current = { ...market, rules };
  const plan = venue.historyTrend ? venue.schedule.readCatalogPlan(market) : null;
  const modelContext = { priorMarketReturnBps: wisStockPreviousMarketReturn(market.marketIndex, atMs),
    marketStress: wisStockMarketStress(market.marketIndex, atMs), sectorFactors: new Map(),
    ...(plan ? { trendFor: (stock, boundary) => catalogHistoryTrendBps(venue.schedule.catalogEntry(stock.id), plan, boundary) } : {}) };
  const stocks = market.stocks.map(stock => priceStock(stock, current, atMs, session, event, modelContext, samples));
  return stocks.some((stock, i) => stock !== market.stocks[i]) ? { ...current, stocks,
    lastPriceSlot: Math.floor(slot / 3), lastTenMinutePriceSlot: slot, revision: market.revision + 1, updatedAtMs: atMs } : market;
}
function advanceScheduledSlot(current, atMs, samples, venue = DOMESTIC) {
  const { market: listed, addedIds } = venue.schedule.applyDueCatalogListings(current, atMs);
  const { market: ended, exited } = venue.schedule.applyDueCatalogExits(listed, atMs);
  const priced = advanceMarket(ended, atMs, samples, venue);
  const changed = addedIds.length || exited.length ? { ...priced, revision: current.revision + 1, updatedAtMs: atMs } : priced;
  return { updated: changed === current ? current : updateWisStockIndex(current, changed, atMs), addedIds, exited };
}
function createWisStockHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now, openingPrice = drawListingPrice,
  venue = DOMESTIC, fxRefresh = null }) {
  const managementState = market => state(market, now(), venue);
  // The daily public rate shown beside a 유스 venue. An invalid or missing
  // document is reported as unavailable instead of blocking management reads.
  const readFx = async tx => {
    const snapshot = await tx.get(db.doc(WIS_STOCK_FX_PATH));
    try { return snapshot.exists ? parseWisStockFxRate(snapshot.data(), now()) : null; } catch { return null; }
  };
  const forecastStock = createForecastReader(advanceScheduledSlot);
  const identity = async (request, write = false) => {
    const session = await assertSession(request, write ? { highRisk: true, recentAuth: true } : {});
    const uid = request.auth?.uid;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || (session?.uid && session.uid !== uid)) {
      fail('unauthenticated', '다시 로그인해 주세요.', 'WIS_STOCK_SESSION_INVALID');
    }
    return { uid, email: String(session?.email || request.auth?.token?.email || '').trim().toLowerCase() };
  };
  const authority = async (tx, actor, write) => {
    const snapshot = await tx.get(db.doc(`users/${actor.uid}`)), profile = snapshot.data() || {};
    const perms = profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) ? profile.staffPermissions : [];
    if (!snapshot.exists || profile.disabled || profile.deletedAt || profile.isDeleted || profile.weplayDeletionPending
      || (actor.email !== ADMIN_EMAIL && profile.role !== 'teacher' && (profile.role === 'student'
        || !(perms.includes('point_manage') || (!write && perms.includes('point_read')))))) {
      fail('permission-denied', '위스 주식 관리 권한이 없습니다.', 'WIS_STOCK_TEACHER_REQUIRED');
    }
  };
  const activeScope = async (tx, scope) => {
    const [config, pointer, manifest] = await Promise.all([
      tx.get(db.doc('site_settings/config')), tx.get(db.doc('site_settings/semester_active')),
      tx.get(db.doc(`semester_manifests/${scope.semesterId}`)),
    ]);
    if (!config.exists || String(config.data().year) !== scope.year || String(config.data().semester) !== scope.semester
      || !pointer.exists || pointer.data().semesterId !== scope.semesterId
      || !manifest.exists || manifest.data().status !== 'ACTIVE') {
      fail('failed-precondition', '현재 운영 중인 학기에서 다시 열어 주세요.', 'WIS_STOCK_SCOPE_CHANGED');
    }
  };
  const getWisStockManagement = async request => {
    const actor = await identity(request), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'forecastStockId'])
      || (Object.hasOwn(input, 'forecastStockId') && (!venue.forecast || typeof input.forecastStockId !== 'string' || !/^stock_[a-f0-9]{24}$/.test(input.forecastStockId)))) invalid();
    const scope = scopeInput(input);
    const { market, fx } = await db.runTransaction(async tx => {
      await authority(tx, actor, false);
      await activeScope(tx, scope);
      const market = readMarket(await tx.get(db.doc(marketPath(scope, venue))), scope, venue);
      return { market, fx: venue === DOMESTIC ? undefined : await readFx(tx) };
    }, { readOnly: true });
    if (!input.forecastStockId) return { ...managementState(market), ...(fx !== undefined ? { fx } : {}) };
    const forecast = await forecastStock(market, input.forecastStockId, now());
    if (!forecast) fail('not-found', '해당 종목을 찾을 수 없습니다.', 'WIS_STOCK_NOT_FOUND');
    return forecast;
  };
  const saveWisStock = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'stockId', 'settings'])
      || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)
      || (input.stockId !== '' && !/^stock_[a-f0-9]{24}$/.test(input.stockId))) invalid();
    const scope = scopeInput(input), submitted = normalizeSettings(input.settings, input.stockId === '');
    const payloadHash = hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId, submitted]));
    const preProfilePayloadHash = !Object.hasOwn(input.settings, 'growthProfile')
      ? hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId,
        Object.fromEntries(SETTINGS.filter(key => key !== 'growthProfile').map(key => [key, submitted[key]]))])) : '';
    const legacyPayloadHash = !Object.hasOwn(input.settings, 'growthProfile') && TRADING_SETTINGS.every(key => !Object.hasOwn(input.settings, key))
      ? hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId,
        Object.fromEntries(SETTINGS.filter(key => key !== 'growthProfile' && !TRADING_SETTINGS.includes(key)).map(key => [key, submitted[key]]))])) : '';
    const atMs = now(), newPriceSeed = randomBytes(32).toString('hex');
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope, venue)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId, venue));
      const [marketSnapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(marketSnapshot, scope, venue);
      if (receipt.exists) {
        const saved = receipt.data();
        const legacyReplay = legacyPayloadHash && !saved.commandType && record(saved.settings)
          && TRADING_SETTINGS.every(key => !Object.hasOwn(saved.settings, key))
          && /^stock_[a-f0-9]{24}$/.test(saved.stockId || '') && saved.payloadHash === legacyPayloadHash;
        const preProfileReplay = preProfilePayloadHash && !saved.commandType && record(saved.settings)
          && !Object.hasOwn(saved.settings, 'growthProfile') && /^stock_[a-f0-9]{24}$/.test(saved.stockId || '')
          && saved.payloadHash === preProfilePayloadHash;
        if (saved.payloadHash !== payloadHash && !legacyReplay && !preProfileReplay) fail('already-exists', '같은 저장 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...managementState(market), savedStockId: receipt.data().stockId, duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision) fail('aborted', '가격이나 종목 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      const previous = market.stocks.find(stock => stock.id === input.stockId);
      if (input.stockId && !previous) fail('not-found', '종목을 찾지 못했습니다. 새로고침해 주세요.', 'WIS_STOCK_NOT_FOUND');
      const id = previous?.id || `stock_${hash(`${scope.semesterId}\n${actor.uid}\n${input.requestId}`).slice(0, 24)}`;
      const settings = { ...submitted };
      if (!previous) {
        const minimum = Math.max(MIN_LISTING_PRICE, settings.minimumPrice), maximum = Math.min(MAX_LISTING_PRICE, settings.maximumPrice);
        if (minimum > maximum) fail('invalid-argument', '최저가와 최고가 사이에 100~500위스의 상장가가 포함되어야 합니다.', 'WIS_STOCK_LISTING_RANGE_INVALID');
        settings.initialPrice = openingPrice(market.priceSeed || newPriceSeed, scope.semesterId, id, minimum, maximum);
      }
      if (previous && (settings.initialPrice !== previous.settings.initialPrice
        || previous.price < settings.minimumPrice || previous.price > settings.maximumPrice)) {
        fail('invalid-argument', '기준가는 등록 후 바꿀 수 없으며, 가격 범위에는 현재가가 포함되어야 합니다.', 'WIS_STOCK_PRICE_RANGE_INVALID');
      }
      if (previous && market.studentOpen && (settings.issuedShares !== previous.settings.issuedShares
        || settings.lotSize !== previous.settings.lotSize)) {
        fail('failed-precondition', '처음 개장한 뒤에는 발행 수량과 거래 단위를 변경할 수 없습니다.', 'WIS_STOCK_SUPPLY_LOCKED');
      }
      if ((!previous && settings.tradingStatus === 'GRADUATED')
        || (previous?.settings.tradingStatus === 'GRADUATED' && JSON.stringify(previous.settings) !== JSON.stringify(settings))) {
        fail('failed-precondition', '졸업한 종목의 설정은 변경할 수 없습니다.', 'WIS_STOCK_GRADUATED');
      }
      if (previous && JSON.stringify(previous.settings) === JSON.stringify(settings)) {
        return { ...managementState(market), savedStockId: previous.id, duplicate: false, changed: false };
      }
      if (!previous && market.stocks.length >= MAX_STOCKS) fail('resource-exhausted', `종목은 학기당 ${MAX_STOCKS}개까지 등록할 수 있습니다.`, 'WIS_STOCK_CAPACITY');
      const stock = previous ? { ...previous, settings } : { id, settings, price: settings.initialPrice, listedAtMs: atMs,
        priceModel: { version: 1, anchorAtMs: atMs, anchorPrice: settings.initialPrice },
        dayKey: wisStockKstSession(atMs).dayKey, dayOpenPrice: settings.initialPrice, haltedUntilMs: 0,
        updatedAtMs: atMs, nextTickAtMs: nextWisStockPriceTick(atMs), history: [{ atMs, price: settings.initialPrice }] };
      if (previous && !previous.settings.automatic && settings.automatic) {
        stock.autoEnabledAtMs = atMs;
        stock.nextTickAtMs = nextWisStockPriceTick(atMs);
      }
      if (previous && previous.settings.growthProfile !== settings.growthProfile) {
        stock.priceModel = { version: 1, anchorAtMs: atMs, anchorPrice: previous.price };
      }
      if (previous && previous.settings.tradingStatus !== 'GRADUATED' && settings.tradingStatus === 'GRADUATED') {
        // The market transaction freezes its final quote and durably queues all
        // settlements. The job survives delayed triggers, task failures and a
        // semester switch; each account receives an atomic receipt of its own.
        stock.graduation = { unitPrice: previous.price, atMs };
        tx.create(db.doc(`wis_stock_graduations/${scope.semesterId}_${id}`), {
          schemaVersion: 1, ...scope, stockId: id, unitPrice: previous.price, atMs, status: 'PENDING',
        });
      }
      const updated = updateWisStockIndex(market, { ...market, priceSeed: market.priceSeed || newPriceSeed,
        stocks: previous ? market.stocks.map(item => item.id === id ? stock : item) : [...market.stocks, stock],
        revision: market.revision + 1, updatedAtMs: atMs }, atMs);
      assertCatalogCapacity(updated, scope, venue);
      tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, market, updated, venue);
      tx.create(receiptRef, { schemaVersion: 1, semesterId: scope.semesterId, actorUid: actor.uid, stockId: id,
        payloadHash, revision: updated.revision, previousSettings: previous?.settings || null, settings, createdAtMs: atMs });
      return { ...managementState(updated), savedStockId: id, duplicate: false, changed: true };
    });
  };
  const saveWisStockMarketRules = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'rules'])
      || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId) || !record(input.rules)) invalid();
    const scope = scopeInput(input), rules = ruleInput(input.rules);
    const payloadHash = hash(JSON.stringify(['saveWisStockMarketRules', scope.semesterId, input.expectedRevision, rules]));
    const atMs = now(), newPriceSeed = randomBytes(32).toString('hex');
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope, venue)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId, venue));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope, venue);
      if (receipt.exists) {
        if (receipt.data().payloadHash !== payloadHash) fail('already-exists', '같은 저장 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...managementState(market), duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision) fail('aborted', '가격이나 시장 규칙이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      // General rule saves (including old clients) never change the emergency
      // switch. Only the dedicated stop/resume command owns this flag.
      const effectiveRules = { ...rules, halted: market.rules.halted };
      if (JSON.stringify(market.rules) === JSON.stringify(effectiveRules)) return { ...managementState(market), duplicate: false, changed: false };
      const updated = { ...market, rules: effectiveRules, priceSeed: market.priceSeed || newPriceSeed,
        revision: market.revision + 1, updatedAtMs: atMs };
      tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, market, updated, venue);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'saveWisStockMarketRules', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, revision: updated.revision, previousRules: market.rules, rules: effectiveRules, createdAtMs: atMs });
      return { ...managementState(updated), duplicate: false, changed: true };
    });
  };
  const setWisStockMarketHalted = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'halted'])
      || typeof input.halted !== 'boolean' || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)) invalid();
    const scope = scopeInput(input), atMs = now(), newPriceSeed = randomBytes(32).toString('hex');
    const payloadHash = hash(JSON.stringify(['setWisStockMarketHalted', scope.semesterId, input.expectedRevision, input.halted]));
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope, venue)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId, venue));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope, venue);
      if (receipt.exists) {
        if (receipt.data().commandType !== 'setWisStockMarketHalted' || receipt.data().payloadHash !== payloadHash)
          fail('already-exists', '같은 거래 정지 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...managementState(market), duplicate: true, changed: false };
      }
      // Stopping must survive concurrent price/rule writes. Resuming requires
      // the observed revision so a delayed resume cannot override a new stop.
      if (!input.halted && market.revision !== input.expectedRevision)
        fail('aborted', '시장 상태가 변경되었습니다. 최신 자료를 확인한 뒤 거래 재개를 다시 확인해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      // A NEW stop is also a fence against any resume that observed the old
      // revision, even when trading was already stopped. Only the receipt
      // replay above is a zero-write stop; an unchanged resume remains a no-op.
      if (!input.halted && market.studentOpen && !market.rules.halted) return { ...managementState(market), duplicate: false, changed: false };
      const resumed = { ...market, studentOpen: market.studentOpen || !input.halted,
        rules: { ...market.rules, halted: input.halted }, revision: market.revision + 1, updatedAtMs: atMs,
        tradingEpoch: market.tradingEpoch + (input.halted ? 1 : 0),
        publicationRevision: market.publicationRevision + 1, publicationUpdatedAtMs: atMs,
        ...(!input.halted && !market.priceSeed ? { priceSeed: newPriceSeed } : {}) };
      const { market: listed, addedIds } = venue.schedule.applyDueCatalogListings(resumed, atMs);
      const { market: ended, exited } = venue.schedule.applyDueCatalogExits(listed, atMs);
      const instrumentsChanged = addedIds.length || exited.length;
      const updated = instrumentsChanged ? updateWisStockIndex(market, ended, atMs) : ended;
      if (instrumentsChanged) assertCatalogCapacity(updated, scope, venue);
      if (snapshot.exists) tx.update(marketRef, { 'rules.halted': input.halted, studentOpen: updated.studentOpen,
        tradingEpoch: updated.tradingEpoch, publicationRevision: updated.publicationRevision, publicationUpdatedAtMs: atMs,
        ...(updated.priceSeed ? { priceSeed: updated.priceSeed } : {}),
        ...(instrumentsChanged ? { stocks: updated.stocks, marketIndex: updated.marketIndex } : {}), revision: updated.revision, updatedAtMs: atMs });
      else tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, market, updated, venue);
      queueCatalogGraduations(tx, db, scope, exited, venue);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'setWisStockMarketHalted', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, revision: updated.revision, previousHalted: market.rules.halted,
        halted: input.halted, studentOpen: updated.studentOpen, tradingEpoch: updated.tradingEpoch,
        ...(addedIds.length ? { addedIds } : {}), ...(exited.length ? { exited } : {}), createdAtMs: atMs });
      return { ...managementState(updated), duplicate: false, changed: true };
    });
  };
  const activateWisStockCatalogPlan = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'startsAtMs'])
      || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)) invalid();
    const scope = scopeInput(input), atMs = now();
    let plan;
    try { plan = venue.schedule.normalizeCatalogPlan({ version: 1, startsAtMs: input.startsAtMs }); }
    catch (error) { fail('invalid-argument', error.message, 'WIS_STOCK_CATALOG_PLAN_INVALID'); }
    if (String(new Date(plan.startsAtMs + 9 * HOUR).getUTCFullYear()) !== scope.year) invalid();
    const newPriceSeed = randomBytes(32).toString('hex');
    const payloadHash = hash(JSON.stringify(['activateWisStockCatalogPlan', scope.semesterId, input.expectedRevision, plan]));
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope, venue)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId, venue));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope, venue);
      if (receipt.exists) {
        if (receipt.data().commandType !== 'activateWisStockCatalogPlan' || receipt.data().payloadHash !== payloadHash)
          fail('already-exists', '같은 일정 적용 요청의 내용이 달라졌습니다.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...managementState(market), duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision)
        fail('aborted', '시장 상태가 변경되었습니다. 최신 자료를 확인해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      if (market.catalogPlan) {
        if (JSON.stringify(venue.schedule.normalizeCatalogPlan(market.catalogPlan)) !== JSON.stringify(plan))
          fail('failed-precondition', '이미 적용한 상장 일정의 시작일은 변경할 수 없습니다.', 'WIS_STOCK_CATALOG_PLAN_LOCKED');
        return { ...managementState(market), duplicate: false, changed: false };
      }
      // A new venue starts from the domestic market's reviewed limits and hours.
      // This read precedes every write in the same transaction.
      const launchRules = !snapshot.exists && venue !== DOMESTIC
        ? normalizeWisStockMarketRules({ ...readMarket(await tx.get(db.doc(marketPath(scope, DOMESTIC))), scope, DOMESTIC).rules,
          ...(venue.ruleOverrides || {}), halted: false }) : market.rules;
      // Venues whose catalog delists with history apply exits with the plan;
      // a plan whose first exit has already passed would liquidate at once.
      const exits = venue.schedule.exitsWithPlan ? { enabledAtMs: atMs, overrides: {} } : null;
      if (exits) for (const entry of venue.schedule.catalog) {
        if (entry.exitKind !== 'survive' && entry.exitSession !== null && catalogExitAtMs(entry, plan) <= atMs)
          fail('failed-precondition', '이미 지난 상장 폐지 일정이 있는 시작일입니다. 더 늦은 월요일을 선택해 주세요.', 'WIS_STOCK_CATALOG_EXIT_PAST');
      }
      const planned = { ...market, rules: launchRules, catalogPlan: plan, ...(exits ? { catalogExits: exits } : {}),
        priceSeed: market.priceSeed || newPriceSeed };
      // Reserve the complete plan before accepting it. This in-memory projection
      // is only a capacity check; future stocks/history are never persisted.
      assertCatalogCapacity(planned, scope, venue);
      const { market: listed, addedIds } = venue.schedule.applyDueCatalogListings(planned, atMs);
      const updated = updateWisStockIndex(market, { ...listed,
        revision: market.revision + 1, updatedAtMs: atMs }, atMs);
      tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, market, updated, venue);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'activateWisStockCatalogPlan', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, plan, addedIds, revision: updated.revision, createdAtMs: atMs });
      return { ...managementState(updated), duplicate: false, changed: true };
    });
  };
  const activateWisStockCatalogExits = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'exitOverrides'])
      || !record(input.exitOverrides) || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)) invalid();
    const scope = scopeInput(input), atMs = now();
    const overrides = Object.fromEntries(Object.entries(input.exitOverrides).sort(([a], [b]) => a.localeCompare(b)));
    const payloadHash = hash(JSON.stringify(['activateWisStockCatalogExits', scope.semesterId, input.expectedRevision, overrides]));
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope, venue)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId, venue));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope, venue);
      if (receipt.exists) {
        if (receipt.data().commandType !== 'activateWisStockCatalogExits' || receipt.data().payloadHash !== payloadHash)
          fail('already-exists', '같은 종료 일정 요청의 내용이 달라졌습니다.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...managementState(market), duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision)
        fail('aborted', '시장 상태가 변경되었습니다. 최신 자료를 확인해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      if (!market.catalogPlan) fail('failed-precondition', '상장 일정을 먼저 적용해 주세요.', 'WIS_STOCK_CATALOG_PLAN_REQUIRED');
      const previousPlan = venue.schedule.readCatalogPlan(market);
      let plan;
      try { plan = venue.schedule.normalizeCatalogPlan({ ...previousPlan, exitsEnabledAtMs: previousPlan.exitsEnabledAtMs || atMs, exitOverrides: overrides }); }
      catch { fail('invalid-argument', '종목별 종료일은 원래 예정일 이후의 정각 또는 30분으로 설정해 주세요.', 'WIS_STOCK_CATALOG_EXITS_INVALID'); }
      if (previousPlan.exitsEnabledAtMs) {
        if (JSON.stringify(plan) !== JSON.stringify(previousPlan))
          fail('failed-precondition', '이미 적용한 종료 일정은 변경할 수 없습니다.', 'WIS_STOCK_CATALOG_EXITS_LOCKED');
        return { ...managementState(market), duplicate: false, changed: false };
      }
      for (const entry of venue.schedule.catalog) {
        if (entry.exitKind === 'survive' || entry.exitSession === null) continue;
        const stock = market.stocks.find(item => item.id === entry.id);
        if (stock?.settings.tradingStatus === 'GRADUATED') continue;
        if (catalogExitAtMs(entry, plan) <= atMs)
          fail('failed-precondition', '이미 지난 종료일은 현재 시각 이후로 조정해 주세요.', 'WIS_STOCK_CATALOG_EXIT_PAST');
      }
      // Activation is configuration only: never liquidate a holding or invent a
      // historical quote. The existing half-hour scheduler applies due exits.
      const updated = { ...market, catalogExits: { enabledAtMs: plan.exitsEnabledAtMs, overrides: plan.exitOverrides },
        revision: market.revision + 1, updatedAtMs: atMs };
      assertCatalogCapacity(updated, scope, venue);
      tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, market, updated, venue);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'activateWisStockCatalogExits', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, plan, revision: updated.revision, createdAtMs: atMs });
      return { ...managementState(updated), duplicate: false, changed: true };
    });
  };
  const advanceWisStockPrices = async event => {
    const atMs = now(), slot = wisStockPriceSlot(atMs);
    const scheduledMs = event?.scheduleTime === undefined ? atMs : Date.parse(event.scheduleTime);
    if (wisStockPriceSlot(scheduledMs) !== slot) return { changed: false };
    return db.runTransaction(async tx => {
      if (wisStockPriceSlot(now()) !== slot) return { changed: false };
      const config = await tx.get(db.doc('site_settings/config'));
      if (!config.exists) return { changed: false };
      const scope = scopeInput({ year: String(config.data().year), semester: String(config.data().semester) });
      const marketRef = db.doc(marketPath(scope, venue)), snapshot = await tx.get(marketRef);
      if (!snapshot.exists) return { changed: false };
      const current = readMarket(snapshot, scope, venue);
      if (current.updatedAtMs > atMs || !isWisStockTradingSession(current.rules, slot * WIS_STOCK_PRICE_INTERVAL_MS)
        || !isWisStockTradingSession(current.rules, atMs)) return { changed: false };
      const { updated, addedIds, exited } = advanceScheduledSlot(current, atMs, new Map(), venue);
      if (updated === current) return { changed: false };

      // Only a real mutation needs both active-semester guards. They remain in
      // this same transaction so an intervening semester switch forces a retry.
      const [pointer, manifest] = await Promise.all([
        tx.get(db.doc('site_settings/semester_active')), tx.get(db.doc(`semester_manifests/${scope.semesterId}`)),
      ]);
      if (!pointer.exists || pointer.data().semesterId !== scope.semesterId || !manifest.exists
        || manifest.data().status !== 'ACTIVE') return { changed: false };
      const checkedAtMs = now();
      if (wisStockPriceSlot(checkedAtMs) !== slot || !isWisStockTradingSession(current.rules, checkedAtMs)) return { changed: false };
      if (updated.stocks.length > MAX_STOCKS) fail('resource-exhausted', '종목 등록 한도를 초과합니다.', 'WIS_STOCK_CAPACITY');
      assertMarketCapacity(updated, scope, venue);
      tx.set(marketRef, updated);
      publishStudentMarket(tx, db, scope, current, updated, venue);
      queueCatalogGraduations(tx, db, scope, exited, venue);
      if (addedIds.length) tx.create(db.doc(receiptPath(scope, 'scheduler',
        hash(JSON.stringify([current.catalogPlan, addedIds])), venue)), {
        schemaVersion: 1, commandType: 'applyWisStockCatalogListings', semesterId: scope.semesterId,
        actorUid: 'scheduler', plan: current.catalogPlan, addedIds, revision: updated.revision, createdAtMs: atMs,
      });
      if (exited.length) tx.create(db.doc(receiptPath(scope, 'scheduler',
        hash(JSON.stringify(['catalogExits', current.catalogPlan, current.catalogExits, exited.map(exit => exit.stockId)])), venue)), {
        schemaVersion: 1, commandType: 'applyWisStockCatalogExits', semesterId: scope.semesterId,
        actorUid: 'scheduler', plan: venue.schedule.readCatalogPlan(current), exited, revision: updated.revision, createdAtMs: atMs,
      });
      return { changed: true, revision: updated.revision };
    });
  };
  // Teacher fallback for the daily job (e.g. the first day after deployment).
  // The same once-per-KST-day rule applies, so repeated clicks cost one read.
  const refreshWisStockFx = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!fxRefresh || !allowed(input, ['year', 'semester', '_session'])) invalid();
    const scope = scopeInput(input);
    await db.runTransaction(async tx => { await authority(tx, actor, true); await activeScope(tx, scope); }, { readOnly: true });
    let result;
    try { result = await fxRefresh(); }
    catch (error) {
      fail('unavailable', error?.reason === 'WIS_STOCK_FX_JUMP' ? error.message : '환율 자료를 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
        error?.reason || 'WIS_STOCK_FX_UNAVAILABLE');
    }
    const fx = await db.runTransaction(tx => readFx(tx), { readOnly: true });
    return { changed: result.changed === true, fx };
  };
  return { getWisStockManagement, saveWisStock, saveWisStockMarketRules, setWisStockMarketHalted,
    activateWisStockCatalogPlan, activateWisStockCatalogExits, advanceWisStockPrices, refreshWisStockFx };
}
module.exports = { createWisStockHandlers, MAX_STOCKS, HISTORY_LIMIT, MAX_PRICE, marketPath, receiptPath,
  publicStockPath, publicStockStatus, publicStockMarket, publicStockSettings, readMarket,
  MAX_MARKET_BYTES, reservedMarketBytes, normalizeSettings, nextPrice, advanceMarket, advanceScheduledSlot, blankMarket };
