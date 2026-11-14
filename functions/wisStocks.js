const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

// A teacher-only simulation. There are deliberately no student order handlers.
const MAX_STOCKS = 40;
const HISTORY_LIMIT = 120;
const MAX_PRICE = 1_000_000;
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
const blankMarket = scope => ({ schemaVersion: 1, semesterId: scope.semesterId, revision: 0, studentOpen: false, stocks: [], updatedAtMs: 0 });
const SETTINGS = ['name', 'description', 'period', 'initialPrice', 'minimumPrice', 'maximumPrice', 'volatilityBps', 'trendBps', 'intervalHours', 'automatic'];
function normalizeSettings(value) {
  if (!allowed(value, SETTINGS)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60
    || typeof value.description !== 'string' || value.description.trim().length > 1000
    || typeof value.period !== 'string' || value.period.trim().length > 80
    || !safeInt(value.initialPrice, 1, MAX_PRICE)
    || !safeInt(value.minimumPrice, 1, MAX_PRICE) || !safeInt(value.maximumPrice, 1, MAX_PRICE)
    || value.minimumPrice > value.initialPrice || value.initialPrice > value.maximumPrice
    || !safeInt(value.volatilityBps, 0, 1000) || !safeInt(value.trendBps, -300, 300)
    || ![1, 6, 24].includes(value.intervalHours) || typeof value.automatic !== 'boolean') invalid();
  return Object.fromEntries(SETTINGS.map(key => [key, typeof value[key] === 'string' ? value[key].trim() : value[key]]));
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
  if (value.schemaVersion !== 1 || value.semesterId !== scope.semesterId || value.studentOpen !== false
    || !safeInt(value.revision, 1, Number.MAX_SAFE_INTEGER - 1) || !Array.isArray(value.stocks)
    || value.stocks.length > MAX_STOCKS || !value.stocks.every(validStock)
    || new Set(value.stocks.map(stock => stock.id)).size !== value.stocks.length) {
    fail('failed-precondition', '주식 설정을 확인하지 못했습니다. 관리자에게 문의해 주세요.', 'WIS_STOCK_MARKET_INVALID');
  }
  return value;
}
const state = market => ({ semesterId: market.semesterId, revision: market.revision, studentOpen: false,
  maxStocks: MAX_STOCKS, historyLimit: HISTORY_LIMIT, updatedAtMs: market.updatedAtMs,
  stocks: market.stocks.map(({ id, settings, price, updatedAtMs, nextTickAtMs, history }) => ({ id, settings, price, updatedAtMs, nextTickAtMs, history })) });
const nextTick = (atMs, hours) => (Math.floor(atMs / (hours * HOUR)) + 1) * hours * HOUR;
function nextPrice(stock, semesterId, slot) {
  const settings = stock.settings;
  const sample = Number.parseInt(hash(`${semesterId}\n${stock.id}\n${slot}`).slice(0, 8), 16);
  const movementBps = settings.trendBps + (sample % (settings.volatilityBps * 2 + 1) - settings.volatilityBps);
  return Math.max(settings.minimumPrice, Math.min(settings.maximumPrice, Math.round(stock.price * (10_000 + movementBps) / 10_000)));
}
function advanceMarket(market, atMs) {
  let changed = false;
  const stocks = market.stocks.map(stock => {
    if (!stock.settings.automatic || stock.nextTickAtMs > atMs) return stock;
    const slot = Math.floor(atMs / (stock.settings.intervalHours * HOUR));
    const price = nextPrice(stock, market.semesterId, slot);
    // The deterministic sample makes a flat retry a no-op too. History stores
    // price changes rather than fabricating points for unchanged prices.
    if (price === stock.price) return stock;
    changed = true;
    return { ...stock, price, updatedAtMs: atMs, nextTickAtMs: nextTick(atMs, stock.settings.intervalHours),
      history: [...stock.history, { atMs, price }].slice(-HISTORY_LIMIT) };
  });
  return changed ? { ...market, stocks, revision: market.revision + 1, updatedAtMs: atMs } : market;
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
    const atMs = now();
    return db.runTransaction(async tx => {
      await authority(tx, actor, true);
      await activeScope(tx, scope);
      const marketRef = db.doc(marketPath(scope)), receiptRef = db.doc(receiptPath(scope, actor.uid, input.requestId));
      const [marketSnapshot, receipt] = await Promise.all([tx.get(marketRef), tx.get(receiptRef)]);
      const market = readMarket(marketSnapshot, scope);
      if (receipt.exists) {
        if (receipt.data().payloadHash !== payloadHash) fail('already-exists', '같은 저장 요청의 내용이 달라졌습니다. 화면을 다시 열어 주세요.', 'WIS_STOCK_REQUEST_CONFLICT');
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
        updatedAtMs: atMs, nextTickAtMs: nextTick(atMs, settings.intervalHours), history: [{ atMs, price: settings.initialPrice }] };
      if (previous && (previous.settings.automatic !== settings.automatic || previous.settings.intervalHours !== settings.intervalHours)) {
        stock.nextTickAtMs = nextTick(atMs, settings.intervalHours);
      }
      const updated = { ...market, stocks: previous ? market.stocks.map(item => item.id === id ? stock : item) : [...market.stocks, stock],
        revision: market.revision + 1, updatedAtMs: atMs };
      tx.set(marketRef, updated);
      tx.create(receiptRef, { schemaVersion: 1, semesterId: scope.semesterId, actorUid: actor.uid, stockId: id,
        payloadHash, revision: updated.revision, previousSettings: previous?.settings || null, settings, createdAtMs: atMs });
      return { ...state(updated), savedStockId: id, duplicate: false, changed: true };
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
  return { getWisStockManagement, saveWisStock, advanceWisStockPrices };
}
module.exports = { createWisStockHandlers, MAX_STOCKS, HISTORY_LIMIT, MAX_PRICE, marketPath, receiptPath,
  normalizeSettings, nextPrice, advanceMarket, blankMarket };
