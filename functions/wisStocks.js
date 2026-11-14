const { createHash, randomBytes } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { nextWisStockModelPrice, wisStockPriceModelAnchor } = require('./wisStockPriceModel');
const { normalizeWisStockMarketRules, normalizeWisStockTradingSettings,
  isWisStockTradingSession, wisStockKstSession, wisStockDailyBounds } = require('./wisStockMarketRules');

// A teacher-only simulation. There are deliberately no student order handlers.
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
const marketPath = ({ year, semester }) => `years/${year}/semesters/${semester}/wis_stock_markets/current`;
const receiptPath = (scope, uid, requestId) => `years/${scope.year}/semesters/${scope.semester}/wis_stock_receipts/${hash(`${uid}\n${requestId}`)}`;
const blankMarket = scope => ({ schemaVersion: 1, semesterId: scope.semesterId, revision: 0, studentOpen: false, rules: normalizeWisStockMarketRules(), stocks: [], updatedAtMs: 0 });
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
function reservedMarketBytes(market, scope) {
  const { stocks, ...fields } = market;
  const pointSize = fieldBytes({ atMs: Number.MAX_SAFE_INTEGER, price: MAX_PRICE });
  return marketPath(scope).split('/').reduce((sum, part) => sum + fieldBytes(part), 16)
    + fieldBytes(fields) + fieldBytes('stocks') + stocks.reduce((sum, stock) => {
      const { history, ...data } = stock;
      // Also reserve the model anchor for seedless legacy instruments.
      if (!data.priceModel) data.priceModel = { version: 1, anchorAtMs: 0, anchorPrice: MAX_PRICE };
      return sum + fieldBytes(data) + fieldBytes('history') + HISTORY_LIMIT * pointSize;
    }, 0);
}
function assertMarketCapacity(market, scope) {
  if (reservedMarketBytes(market, scope) > MAX_MARKET_BYTES) {
    fail('resource-exhausted', '가격 기록을 보관할 공간이 부족합니다. 종목 설명을 줄이거나 등록할 종목 수를 조정해 주세요.', 'WIS_STOCK_STORAGE_CAPACITY');
  }
}
const TRADING_SETTINGS = ['issuedShares', 'lotSize', 'tradingStatus'];
const SETTINGS = ['name', 'description', 'period', 'initialPrice', 'minimumPrice', 'maximumPrice', 'volatilityBps', 'trendBps', 'intervalHours', 'automatic', ...TRADING_SETTINGS, 'growthProfile'];
const ruleInput = value => {
  try { return normalizeWisStockMarketRules(value); }
  catch (error) { fail('invalid-argument', error.message, error.reason || 'WIS_STOCK_RULES_INVALID'); }
};
function normalizeSettings(value) {
  if (!allowed(value, SETTINGS)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60
    || typeof value.description !== 'string' || value.description.trim().length > 1000
    || typeof value.period !== 'string' || value.period.trim().length > 80
    || !safeInt(value.initialPrice, 1, MAX_PRICE)
    || !safeInt(value.minimumPrice, 1, MAX_PRICE) || !safeInt(value.maximumPrice, 1, MAX_PRICE)
    || value.minimumPrice > value.initialPrice || value.initialPrice > value.maximumPrice
    || !safeInt(value.volatilityBps, 0, 1000) || !safeInt(value.trendBps, -300, 300)
    || ![1, 6, 24].includes(value.intervalHours) || typeof value.automatic !== 'boolean'
    || !['HISTORICAL', 'VALUE'].includes(value.growthProfile ?? 'HISTORICAL') || value.growthProfile === null) invalid();
  let trading;
  try { trading = normalizeWisStockTradingSettings(Object.fromEntries(TRADING_SETTINGS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))); }
  catch { invalid(); }
  return Object.fromEntries(SETTINGS.map(key => [key, key === 'growthProfile' ? value.growthProfile ?? 'HISTORICAL' : Object.hasOwn(trading, key) ? trading[key]
    : typeof value[key] === 'string' ? value[key].trim() : value[key]]));
}
function readMarket(snapshot, scope) {
  if (!snapshot.exists) return blankMarket(scope);
  const value = snapshot.data();
  const validStock = stock => {
    try { normalizeSettings(stock.settings); } catch { return false; }
    return /^stock_[a-f0-9]{24}$/.test(stock.id) && safeInt(stock.price, stock.settings.minimumPrice, stock.settings.maximumPrice)
      && safeInt(stock.updatedAtMs, 0, Number.MAX_SAFE_INTEGER) && safeInt(stock.nextTickAtMs, 0, Number.MAX_SAFE_INTEGER)
      && Array.isArray(stock.history) && stock.history.length > 0 && stock.history.length <= HISTORY_LIMIT
      && stock.history.every(point => safeInt(point.atMs, 0, Number.MAX_SAFE_INTEGER) && safeInt(point.price, 1, MAX_PRICE));
  };
  let rules;
  try { rules = normalizeWisStockMarketRules(value.rules); } catch { rules = null; }
  if (value.schemaVersion !== 1 || value.semesterId !== scope.semesterId || value.studentOpen !== false
    || !rules || (value.priceSeed !== undefined && !/^[a-f0-9]{64}$/.test(value.priceSeed))
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
    return normalized;
  });
  return { ...value, rules, stocks };
}
const state = market => ({ semesterId: market.semesterId, revision: market.revision, studentOpen: false,
  rules: market.rules,
  maxStocks: MAX_STOCKS, historyLimit: HISTORY_LIMIT, updatedAtMs: market.updatedAtMs,
  stocks: market.stocks.map(({ id, settings, price, updatedAtMs, nextTickAtMs, history, dayKey, dayOpenPrice, haltedUntilMs, priceModel }) => ({ id, settings, price, updatedAtMs, nextTickAtMs, history, dayKey, dayOpenPrice, haltedUntilMs, ...(priceModel ? { priceModel } : {}) })) });
const nextTick = (atMs, hours) => (Math.floor(atMs / (hours * HOUR)) + 1) * hours * HOUR;
function nextPrice(stock, semesterId, slot, priceSeed = '') {
  // The private seed never enters callable responses. A missing legacy seed is
  // still deterministic; reads and unchanged saves never migrate documents.
  const prefix = `${priceSeed}\n${semesterId}\n${stock.id}\nwispi-price-v2\n`;
  return nextWisStockModelPrice(stock, semesterId, slot, priceSeed,
    key => Number.parseInt(hash(prefix + key).slice(0, 8), 16) / 4294967296);
}
function advanceMarket(market, atMs) {
  const rules = normalizeWisStockMarketRules(market.rules);
  if (!rules.automaticPrices || rules.halted || !isWisStockTradingSession(rules, atMs)) return market;
  const { dayKey } = wisStockKstSession(atMs);
  let changed = false;
  const stocks = market.stocks.map(stock => {
    const settings = normalizeSettings(stock.settings);
    if (!settings.automatic || settings.tradingStatus === 'HALTED' || stock.nextTickAtMs > atMs || (stock.haltedUntilMs || 0) > atMs) return stock;
    const slot = Math.floor(atMs / (stock.settings.intervalHours * HOUR));
    const dayOpenPrice = stock.dayKey === dayKey ? stock.dayOpenPrice : stock.price;
    const bounds = wisStockDailyBounds(dayOpenPrice, rules.dailyPriceLimitBps);
    const price = Math.max(settings.minimumPrice, bounds.minimum, Math.min(settings.maximumPrice, bounds.maximum,
      nextPrice(stock, market.semesterId, slot, market.priceSeed)));
    if (price < settings.minimumPrice || price > settings.maximumPrice || price < bounds.minimum || price > bounds.maximum) return stock;
    // The first large move pauses discovery. Once that pause expires, admit one
    // freshly calculated, bounded price; otherwise a sustained correction could
    // retrigger forever without ever updating the price. Never backdate a print.
    const resumingCircuit = (stock.haltedUntilMs || 0) > 0 && stock.haltedUntilMs <= atMs;
    if (!resumingCircuit && Math.abs(price - stock.price) * 10000 >= stock.price * rules.circuitBreakerBps) {
      changed = true;
      return { ...stock, dayKey, dayOpenPrice, haltedUntilMs: atMs + rules.circuitBreakerMinutes * 60000,
        nextTickAtMs: nextTick(atMs, settings.intervalHours) };
    }
    // The deterministic sample makes a flat retry a no-op too. History stores
    // price changes rather than fabricating points for unchanged prices.
    if (price === stock.price) return stock;
    changed = true;
    return { ...stock, price, priceModel: wisStockPriceModelAnchor(stock), dayKey, dayOpenPrice, haltedUntilMs: 0, updatedAtMs: atMs, nextTickAtMs: nextTick(atMs, stock.settings.intervalHours),
      history: [...stock.history, { atMs, price }].slice(-HISTORY_LIMIT) };
  });
  return changed ? { ...market, rules, stocks, revision: market.revision + 1, updatedAtMs: atMs } : market;
}
function createWisStockHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now }) {
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
    if (!allowed(input, ['year', 'semester', '_session'])) invalid();
    const scope = scopeInput(input);
    return db.runTransaction(async tx => {
      await authority(tx, actor, false);
      await activeScope(tx, scope);
      return state(readMarket(await tx.get(db.doc(marketPath(scope))), scope));
    }, { readOnly: true });
  };
  const saveWisStock = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'stockId', 'settings'])
      || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)
      || (input.stockId !== '' && !/^stock_[a-f0-9]{24}$/.test(input.stockId))) invalid();
    const scope = scopeInput(input), settings = normalizeSettings(input.settings);
    const payloadHash = hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId, settings]));
    const preProfilePayloadHash = !Object.hasOwn(input.settings, 'growthProfile')
      ? hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId,
        Object.fromEntries(SETTINGS.filter(key => key !== 'growthProfile').map(key => [key, settings[key]]))])) : '';
    const legacyPayloadHash = !Object.hasOwn(input.settings, 'growthProfile') && TRADING_SETTINGS.every(key => !Object.hasOwn(input.settings, key))
      ? hash(JSON.stringify([scope.semesterId, input.expectedRevision, input.stockId,
        Object.fromEntries(SETTINGS.filter(key => key !== 'growthProfile' && !TRADING_SETTINGS.includes(key)).map(key => [key, settings[key]]))])) : '';
    const atMs = now(), newPriceSeed = randomBytes(32).toString('hex');
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId));
      const [marketSnapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(marketSnapshot, scope);
      if (receipt.exists) {
        const saved = receipt.data();
        const legacyReplay = legacyPayloadHash && !saved.commandType && record(saved.settings)
          && TRADING_SETTINGS.every(key => !Object.hasOwn(saved.settings, key))
          && /^stock_[a-f0-9]{24}$/.test(saved.stockId || '') && saved.payloadHash === legacyPayloadHash;
        const preProfileReplay = preProfilePayloadHash && !saved.commandType && record(saved.settings)
          && !Object.hasOwn(saved.settings, 'growthProfile') && /^stock_[a-f0-9]{24}$/.test(saved.stockId || '')
          && saved.payloadHash === preProfilePayloadHash;
        if (saved.payloadHash !== payloadHash && !legacyReplay && !preProfileReplay) fail('already-exists', '같은 저장 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...state(market), savedStockId: receipt.data().stockId, duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision) fail('aborted', '가격이나 종목 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      const previous = market.stocks.find(stock => stock.id === input.stockId);
      if (input.stockId && !previous) fail('not-found', '종목을 찾지 못했습니다. 새로고침해 주세요.', 'WIS_STOCK_NOT_FOUND');
      if (previous && (settings.initialPrice !== previous.settings.initialPrice
        || previous.price < settings.minimumPrice || previous.price > settings.maximumPrice)) {
        fail('invalid-argument', '기준가는 등록 후 바꿀 수 없으며, 가격 범위에는 현재가가 포함되어야 합니다.', 'WIS_STOCK_PRICE_RANGE_INVALID');
      }
      if (previous && JSON.stringify(previous.settings) === JSON.stringify(settings)) {
        return { ...state(market), savedStockId: previous.id, duplicate: false, changed: false };
      }
      if (!previous && market.stocks.length >= MAX_STOCKS) fail('resource-exhausted', `종목은 학기당 ${MAX_STOCKS}개까지 등록할 수 있습니다.`, 'WIS_STOCK_CAPACITY');
      const id = previous?.id || `stock_${hash(`${scope.semesterId}\n${actor.uid}\n${input.requestId}`).slice(0, 24)}`;
      const stock = previous ? { ...previous, settings } : { id, settings, price: settings.initialPrice,
        priceModel: { version: 1, anchorAtMs: atMs, anchorPrice: settings.initialPrice },
        dayKey: wisStockKstSession(atMs).dayKey, dayOpenPrice: settings.initialPrice, haltedUntilMs: 0,
        updatedAtMs: atMs, nextTickAtMs: nextTick(atMs, settings.intervalHours), history: [{ atMs, price: settings.initialPrice }] };
      if (previous && (previous.settings.automatic !== settings.automatic || previous.settings.intervalHours !== settings.intervalHours)) {
        stock.nextTickAtMs = nextTick(atMs, settings.intervalHours);
      }
      if (previous && previous.settings.growthProfile !== settings.growthProfile) {
        stock.priceModel = { version: 1, anchorAtMs: atMs, anchorPrice: previous.price };
      }
      const updated = { ...market, priceSeed: market.priceSeed || newPriceSeed,
        stocks: previous ? market.stocks.map(item => item.id === id ? stock : item) : [...market.stocks, stock],
        revision: market.revision + 1, updatedAtMs: atMs };
      assertMarketCapacity(updated, scope);
      tx.set(marketRef, updated);
      tx.create(receiptRef, { schemaVersion: 1, semesterId: scope.semesterId, actorUid: actor.uid, stockId: id,
        payloadHash, revision: updated.revision, previousSettings: previous?.settings || null, settings, createdAtMs: atMs });
      return { ...state(updated), savedStockId: id, duplicate: false, changed: true };
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
      const marketRef = db.doc(marketPath(scope)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope);
      if (receipt.exists) {
        if (receipt.data().payloadHash !== payloadHash) fail('already-exists', '같은 저장 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...state(market), duplicate: true, changed: false };
      }
      if (market.revision !== input.expectedRevision) fail('aborted', '가격이나 시장 규칙이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      // General rule saves (including old clients) never change the emergency
      // switch. Only the dedicated stop/resume command owns this flag.
      const effectiveRules = { ...rules, halted: market.rules.halted };
      if (JSON.stringify(market.rules) === JSON.stringify(effectiveRules)) return { ...state(market), duplicate: false, changed: false };
      const updated = { ...market, rules: effectiveRules, priceSeed: market.priceSeed || newPriceSeed,
        revision: market.revision + 1, updatedAtMs: atMs };
      tx.set(marketRef, updated);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'saveWisStockMarketRules', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, revision: updated.revision, previousRules: market.rules, rules: effectiveRules, createdAtMs: atMs });
      return { ...state(updated), duplicate: false, changed: true };
    });
  };
  const setWisStockMarketHalted = async request => {
    const actor = await identity(request, true), input = request.data;
    if (!allowed(input, ['year', 'semester', '_session', 'requestId', 'expectedRevision', 'halted'])
      || typeof input.halted !== 'boolean' || !safeInt(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)) invalid();
    const scope = scopeInput(input), atMs = now();
    const payloadHash = hash(JSON.stringify(['setWisStockMarketHalted', scope.semesterId, input.expectedRevision, input.halted]));
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId));
      const [snapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(snapshot, scope);
      if (receipt.exists) {
        if (receipt.data().commandType !== 'setWisStockMarketHalted' || receipt.data().payloadHash !== payloadHash)
          fail('already-exists', '같은 거래 정지 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
        return { ...state(market), duplicate: true, changed: false };
      }
      // Stopping must survive concurrent price/rule writes. Resuming requires
      // the observed revision so a delayed resume cannot override a new stop.
      if (!input.halted && market.revision !== input.expectedRevision)
        fail('aborted', '시장 상태가 변경되었습니다. 최신 자료를 확인한 뒤 거래 재개를 다시 확인해 주세요.', 'WIS_STOCK_REVISION_CONFLICT');
      // A NEW stop is also a fence against any resume that observed the old
      // revision, even when trading was already stopped. Only the receipt
      // replay above is a zero-write stop; an unchanged resume remains a no-op.
      if (!input.halted && !market.rules.halted) return { ...state(market), duplicate: false, changed: false };
      const updated = { ...market, rules: { ...market.rules, halted: input.halted }, revision: market.revision + 1, updatedAtMs: atMs };
      if (snapshot.exists) tx.update(marketRef, { 'rules.halted': input.halted, revision: updated.revision, updatedAtMs: atMs });
      else tx.set(marketRef, updated);
      tx.create(receiptRef, { schemaVersion: 1, commandType: 'setWisStockMarketHalted', semesterId: scope.semesterId,
        actorUid: actor.uid, payloadHash, revision: updated.revision, previousHalted: market.rules.halted,
        halted: input.halted, createdAtMs: atMs });
      return { ...state(updated), duplicate: false, changed: true };
    });
  };
  const advanceWisStockPrices = async () => db.runTransaction(async tx => {
    const config = await tx.get(db.doc('site_settings/config'));
    if (!config.exists) return { changed: false };
    const scope = scopeInput({ year: String(config.data().year), semester: String(config.data().semester) });
    const [pointer, manifest, snapshot] = await Promise.all([
      tx.get(db.doc('site_settings/semester_active')), tx.get(db.doc(`semester_manifests/${scope.semesterId}`)),
      tx.get(db.doc(marketPath(scope))),
    ]);
    if (!snapshot.exists || !pointer.exists || pointer.data().semesterId !== scope.semesterId
      || !manifest.exists || manifest.data().status !== 'ACTIVE') return { changed: false };
    const current = readMarket(snapshot, scope), updated = advanceMarket(current, now());
    if (updated === current) return { changed: false };
    tx.set(db.doc(marketPath(scope)), updated);
    return { changed: true, revision: updated.revision };
  });
  return { getWisStockManagement, saveWisStock, saveWisStockMarketRules, setWisStockMarketHalted, advanceWisStockPrices };
}
module.exports = { createWisStockHandlers, MAX_STOCKS, HISTORY_LIMIT, MAX_PRICE, marketPath, receiptPath,
  MAX_MARKET_BYTES, reservedMarketBytes, normalizeSettings, nextPrice, advanceMarket, blankMarket };
