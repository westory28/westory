'use strict';

const { createCipheriv, createDecipheriv, createHmac, randomBytes } = require('node:crypto');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const { FieldPath, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { createWisStockReportAccess, scopeFor } = require('./wisStockReportAccess');
const { readMarket, HISTORY_LIMIT, advanceScheduledSlot } = require('./wisStocks');
const { readCatalogPlan } = require('./wisStockCatalogSchedule');
const { catalogSessionAtMs, catalogExitAtMs } = require('./wisStockCatalogTimeline');
const { projectMarket, planWindow, specialSessions } = require('./wisStockQuotePlan');
const { WIS_STOCK_PRICE_INTERVAL_MS } = require('./wisStockMarketRules');
const catalog = require('./wisStockCatalog.json');

const HOUR = 3_600_000, HALF = 12 * HOUR, DAY = 24 * HOUR, KST = 9 * HOUR;
const PAGE = 400, BATCH = 4000, MIN_ACCOUNTS = 5;
const dayKey = ms => new Date(ms + KST).toISOString().slice(0, 10);
const midnight = ms => Math.floor((ms + KST) / DAY) * DAY - KST;
const halfStart = ms => Math.floor((ms + KST) / HALF) * HALF - KST;
const rootOf = scope => 'years/' + scope.year + '/semesters/' + scope.semester;
const archiveId = start => dayKey(start) + (midnight(start) === start ? '_AM' : '_PM');
const archiveRef = (db, scope, start) => db.doc(rootOf(scope) + '/wis_stock_report_intervals/' + archiveId(start));
const invalidSource = () => { throw new HttpsError('failed-precondition', '보고서 원본 자료를 확인해 주세요.'); };
const invalidToken = () => { throw new HttpsError('invalid-argument', '이어받기 시간이 지났거나 입력값이 다릅니다. 처음부터 다시 내려받아 주세요.'); };
const catalogById = new Map(catalog.map(entry => [entry.id, entry]));
const stockPattern = /^stock_[0-9a-f]{24}$/;

function priceInterval(stock, start, end) {
  const history = stock.history;
  const points = history.filter(p => p.atMs >= start && p.atMs < end);
  const before = history.findLast(p => p.atMs < start);
  const listing = stock.listedAtMs ?? (history.length < HISTORY_LIMIT && history[0]?.price === stock.settings.initialPrice ? history[0].atMs : null);
  const coverage = listing !== null && listing >= end ? 'BEFORE_LISTING'
    : before || history[0]?.atMs === start || (listing !== null && listing >= start && history[0]?.atMs === listing)
      ? 'COMPLETE' : points.length ? 'PARTIAL' : 'UNAVAILABLE';
  const first = points[0], last = points.at(-1);
  return {
    coverage, priorClose: before?.price ?? null, closeAtEnd: last?.price ?? before?.price ?? null,
    observations: points.length, firstAtMs: first?.atMs ?? null, lastAtMs: last?.atMs ?? null,
    open: first?.price ?? null, high: points.length ? Math.max(...points.map(p => p.price)) : null,
    low: points.length ? Math.min(...points.map(p => p.price)) : null, close: last?.price ?? null,
  };
}
function indexInterval(market, start, end) {
  // Historical index calculations depend on issuance and listing order. Use
  // only the persisted index, never a retrospective current-weight valuation.
  const index = market.marketIndex;
  return priceInterval({ history: (index?.history || []).map(p => ({ atMs: p.atMs, price: p.value })),
    listedAtMs: index?.history?.length ? index.baseAtMs : null, settings: { initialPrice: index?.baseValue ?? -1 } }, start, end);
}

function combinePrices(parts) {
  const available = parts.filter(p => p.coverage !== 'BEFORE_LISTING'), prints = parts.filter(p => p.observations);
  const coverage = !parts.length ? 'UNAVAILABLE' : !available.length ? 'BEFORE_LISTING'
    : available.every(p => p.coverage === 'COMPLETE') ? 'COMPLETE'
      : available.every(p => p.coverage === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'PARTIAL';
  const priorClose = available[0]?.priorClose ?? null, closeAtEnd = available.at(-1)?.closeAtEnd ?? null;
  return { coverage, priorClose, closeAtEnd, observations: prints.reduce((n, p) => n + p.observations, 0),
    firstAtMs: prints[0]?.firstAtMs ?? null, lastAtMs: prints.at(-1)?.lastAtMs ?? null,
    open: prints[0]?.open ?? null, high: prints.length ? Math.max(...prints.map(p => p.high)) : null,
    low: prints.length ? Math.min(...prints.map(p => p.low)) : null, close: prints.at(-1)?.close ?? null,
    returnPercent: coverage === 'COMPLETE' && priorClose > 0 && closeAtEnd !== null ? (closeAtEnd / priorClose - 1) * 100 : null };
}

const exact = n => n >= -BigInt(Number.MAX_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
const add = (a, b) => exact(BigInt(a) + BigInt(b));
const bucket = () => ({ count: 0, shares: 0, valueWis: 0, accounts: [] });
function merge(target, part) {
  for (const key of ['count', 'shares', 'valueWis']) target[key] = add(target[key], part[key]);
  for (const account of part.accounts) {
    if (target.accounts.length === MIN_ACCOUNTS) break;
    if (!target.accounts.includes(account)) target.accounts.push(account);
  }
}

function finishDay(state, sectors) {
  // Every fill contributes to at most one published cell. Never release a
  // parent total that contains the hidden remainder of a smaller cell.
  for (const side of ['BUY', 'SELL', 'GRADUATION']) {
    const residual = new Map(), market = bucket();
    const publish = (level, group, values) => {
      const key = JSON.stringify([level, group, side]);
      const row = state.released[key] ||= { level, group, side, count: 0, shares: 0, valueWis: 0, includedDays: 0 };
      for (const field of ['count', 'shares', 'valueWis']) row[field] = add(row[field], values[field]);
      row.includedDays++;
    };
    for (const [stockId, sides] of Object.entries(state.buckets)) {
      const cell = sides[side];
      if (!cell) continue;
      if (cell.accounts.length >= MIN_ACCOUNTS) publish('STOCK', stockId, cell);
      else {
        const sector = sectors.get(stockId) || '기타 업종';
        if (!residual.has(sector)) residual.set(sector, bucket());
        merge(residual.get(sector), cell);
      }
    }
    for (const [sector, cell] of residual) {
      if (cell.accounts.length >= MIN_ACCOUNTS) publish('SECTOR_REMAINDER', sector, cell);
      else merge(market, cell);
    }
    if (market.accounts.length >= MIN_ACCOUNTS) publish('MARKET_REMAINDER', '업종 통합', market);
  }
  state.buckets = {};
}

function ingest(state, row, scope, from, to, sectors) {
  if (row.semesterId !== scope.semesterId || row.kind !== 'ORDER_FILLED' || !stockPattern.test(row.stockId)
    || !['BUY', 'SELL'].includes(row.side) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0
    || !Number.isSafeInteger(row.unitPrice) || row.unitPrice <= 0 || !Number.isSafeInteger(row.atMs)
    || row.atMs < from || row.atMs >= to || typeof row.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(row.accountId)
    || (row.automaticSettlement !== undefined && (row.automaticSettlement !== 'GRADUATION' || row.side !== 'SELL'))) invalidSource();
  const day = dayKey(row.atMs);
  if (state.day && state.day !== day) finishDay(state, sectors);
  state.day = day;
  const sides = state.buckets[row.stockId] ||= {}, side = row.automaticSettlement || row.side;
  merge(sides[side] ||= bucket(), { shares: row.quantity, count: 1, valueWis: exact(BigInt(row.quantity) * BigInt(row.unitPrice)), accounts: [row.accountId] });
}

function seal(state, key, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(state)))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function unseal(value, key, context, now) {
  try {
    if (typeof value !== 'string' || value.length > 600_000 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidToken();
    const bytes = Buffer.from(value, 'base64url'), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(bytes.subarray(12, 28));
    const plain = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    const state = JSON.parse(inflateRawSync(plain, { maxOutputLength: 2_000_000 }).toString());
    if (!Number.isSafeInteger(state.asOfMs) || state.asOfMs > now + 5_000 || now - state.asOfMs >= 50 * 60_000) invalidToken();
    return state;
  } catch { invalidToken(); }
}

const scopedKey = seed => createHmac('sha256', Buffer.from(seed, 'hex')).update('westory/wispi/weekly-export/continuation/v1').digest();
function sectorFor(stock) {
  return catalogById.get(stock.id)?.sector || '기타 업종';
}
function publicFlows(released, stockId) {
  const rows = Object.values(released).filter(row => row.level === 'STOCK' && row.group === stockId);
  const buy = rows.find(r => r.side === 'BUY'), sell = rows.find(r => r.side === 'SELL');
  return { cells: rows, publishedBuyMinusSellShares: buy && sell ? exact(BigInt(buy.shares) - BigInt(sell.shares)) : null,
    publishedBuyMinusSellValueWis: buy && sell ? exact(BigInt(buy.valueWis) - BigInt(sell.valueWis)) : null };
}

async function forecastWeek(market, asOfMs, start, end) {
  const plan = planWindow(market, asOfMs);
  const from = Math.max(start, plan.startsAtMs), until = Math.min(end, plan.endsAtMs);
  if (from >= until || asOfMs >= until || market.rules.halted || !market.studentOpen || !market.rules.automaticPrices) return new Map();
  const { first, paths } = await projectMarket(market, asOfMs, { startsAtMs: from, endsAtMs: until }, advanceScheduledSlot, () => true);
  const forecasts = new Map();
  for (const [id, values] of paths) {
    const days = new Map();
    values.forEach((price, i) => {
      if (!price) return;
      const atMs = first + i * WIS_STOCK_PRICE_INTERVAL_MS, key = dayKey(atMs);
      const row = days.get(key) || { dayKey: key, firstAtMs: atMs, open: price, high: price, low: price, slots: 0 };
      row.high = Math.max(row.high, price); row.low = Math.min(row.low, price);
      row.close = price; row.lastAtMs = atMs; row.slots++; days.set(key, row);
    });
    forecasts.set(id, [...days.values()]);
  }
  return forecasts;
}

function plannedEvents(market, start, end) {
  const plan = readCatalogPlan(market);
  const events = specialSessions.filter(item => item.dayKey >= dayKey(start) && item.dayKey < dayKey(end))
    .map(item => ({ kind: 'SPECIAL_SESSION', ...item }));
  if (plan) for (const entry of catalog) {
    const listing = catalogSessionAtMs(entry.listingSession, plan.startsAtMs);
    const exit = plan.exitsEnabledAtMs ? catalogExitAtMs(entry, plan) : null;
    for (const [kind, atMs] of [['LISTING', listing], ['EXIT', exit]]) if (atMs !== null && atMs >= start && atMs < end)
      events.push({ stockId: entry.id, name: entry.name, kind, atMs, dayKey: dayKey(atMs) });
  }
  return events.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || (a.atMs || 0) - (b.atMs || 0));
}

function createWisStockWeeklyExport({ db, assertSession, now = Date.now, batchSize = BATCH }) {
  const { actorFor, assertAccess, weekRange } = createWisStockReportAccess({ db, assertSession });
  let forecastCache;
  function forecast(market, asOfMs, start, end) {
    const key = [market.semesterId, market.revision, Math.floor(asOfMs / WIS_STOCK_PRICE_INTERVAL_MS), start, end].join('/');
    if (forecastCache?.key !== key) {
      const projection = forecastWeek(market, asOfMs, start, end);
      forecastCache = { key, projection };
      projection.catch(() => { if (forecastCache?.projection === projection) forecastCache = undefined; });
    }
    return forecastCache.projection;
  }
  // Only seedless legacy markets need a separate random report key, and only
  // when a second request is necessary. This document never stores report or
  // student data. Direct client access to this namespace is denied by rules.
  async function keyFor(seed, scope, create) {
    if (seed) return scopedKey(seed);
    const ref = db.doc(rootOf(scope) + '/wis_stock_report_keys/continuations');
    if (!create) {
      const key = (await ref.get()).data()?.key;
      if (!/^[0-9a-f]{64}$/.test(key || '')) invalidToken();
      return scopedKey(key);
    }
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const key = snap.exists ? snap.data().key : randomBytes(32).toString('hex');
      if (!/^[0-9a-f]{64}$/.test(key || '')) invalidSource();
      if (!snap.exists) tx.create(ref, { key });
      return scopedKey(key);
    });
  }
  async function exportWisStockWeeklyReportData(request) {
    const uid = await actorFor(request), input = request.data;
    if (!input || Object.keys(input).some(k => !['year', 'semester', 'weekStart', '_session', 'continuation'].includes(k)))
      throw new HttpsError('invalid-argument', '내보내기 요청을 확인해 주세요.');
    const scope = scopeFor(input), range = weekRange(input.weekStart), root = rootOf(scope);
    const marketRef = db.doc(root + '/wis_stock_markets/current');
    const initial = await db.runTransaction(async tx => {
      await assertAccess(tx, uid, scope);
      const snap = await tx.get(marketRef);
      return { market: readMarket(snap, scope), asOfMs: Math.floor(snap.readTime.toMillis()),
        readTime: [snap.readTime.seconds, snap.readTime.nanoseconds] };
    }, { readOnly: true });
    const context = JSON.stringify([1, uid, scope.semesterId, range.weekStart]);
    const resume = Object.hasOwn(input, 'continuation');
    if (resume && (typeof input.continuation !== 'string' || !/^[rs]\./.test(input.continuation))) invalidToken();
    const seed = resume && input.continuation.startsWith('r.') ? null : initial.market.priceSeed;
    const state = resume ? unseal(input.continuation.slice(2), await keyFor(seed, scope, false), context, now())
      : { asOfMs: initial.asOfMs, readTime: initial.readTime, day: '', buckets: {}, released: {}, cursor: null };
    const asOfMs = state.asOfMs, readAt = { readOnly: true, readTime: new Timestamp(...state.readTime) };
    const market = resume ? await db.runTransaction(async tx => readMarket(await tx.get(marketRef), scope), readAt) : initial.market;
    const sectors = new Map(market.stocks.map(s => [s.id, sectorFor(s)]));
    const flowEnd = Math.min(range.endMs, midnight(asOfMs));
    const query = db.collection(root + '/wis_stock_history').where('kind', '==', 'ORDER_FILLED')
      .where('atMs', '>=', range.startMs).where('atMs', '<', flowEnd).orderBy('atMs').orderBy(FieldPath.documentId())
      .select('semesterId', 'kind', 'atMs', 'stockId', 'side', 'quantity', 'unitPrice', 'accountId', 'automaticSettlement');
    if (flowEnd > range.startMs) {
      const more = await db.runTransaction(async tx => {
        let seen = 0;
        while (seen < batchSize) {
          const limit = Math.min(PAGE, batchSize - seen);
          const page = await tx.get((state.cursor ? query.startAfter(...state.cursor) : query).limit(limit));
          for (const doc of page.docs) {
            const row = doc.data();
            ingest(state, row, scope, range.startMs, flowEnd, sectors);
            state.cursor = [row.atMs, doc.id];
          }
          if (page.size < limit) return false;
          seen += page.size;
        }
        return true;
      }, readAt);
      if (more) return { continuation: (seed ? 's.' : 'r.') + seal(state, await keyFor(seed, scope, true), context) };
    }
    finishDay(state, sectors);
    const observedEnd = Math.min(range.endMs, asOfMs + 1);
    const slots = [];
    for (let start = range.startMs; start < observedEnd; start += HALF) slots.push(start);
    // The preceding Sunday PM contains the Monday opening shareholder count.
    const keys = [range.startMs - HALF, ...slots.filter(start => start + HALF <= observedEnd)];
    const snapshots = await db.runTransaction(tx => tx.getAll(...keys.map(start => archiveRef(db, scope, start))), readAt);
    const archives = new Map();
    snapshots.forEach((s, i) => {
      if (!s.exists) return;
      const a = s.data();
      if (a.schemaVersion !== 1 || a.semesterId !== scope.semesterId || a.startsAtMs !== keys[i] || a.endsAtMs !== keys[i] + HALF) invalidSource();
      archives.set(keys[i], a);
    });
    const outlookStart = range.endMs, outlookEnd = outlookStart + 7 * DAY;
    const forecasts = await forecast(market, asOfMs, outlookStart, outlookEnd);
    function series(interval) {
      const days = new Map();
      for (const start of slots) {
        const key = dayKey(start);
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(interval(archives.get(start), start, Math.min(start + HALF, observedEnd)));
      }
      return { daily: [...days].map(([day, parts]) => ({ dayKey: day, ...combinePrices(parts) })), weekly: combinePrices([...days.values()].flat()) };
    }
    const marketIndex = series((a, start, end) => a?.marketIndex || indexInterval(market, start, end));
    const stocks = market.stocks.map(stock => {
      const stockId = stock.id;
      const prices = series((a, start, end) => a?.prices?.[stockId] || priceInterval(stock, start, end));
      const newListing = stock.listedAtMs >= range.startMs && stock.listedAtMs < range.endMs;
      const startCount = archives.get(range.startMs - HALF)?.holderCounts?.[stockId] ?? (newListing ? 0 : null);
      const endCount = archives.get(range.endMs - HALF)?.holderCounts?.[stockId];
      const holders = Number.isInteger(startCount) && Number.isInteger(endCount)
        && (startCount === 0 || startCount >= MIN_ACCOUNTS) && (endCount === 0 || endCount >= MIN_ACCOUNTS)
        && (startCount === endCount || Math.abs(endCount - startCount) >= MIN_ACCOUNTS)
        ? { start: startCount, end: endCount, netChange: endCount - startCount } : null;
      const special = prices.daily.flatMap(day => {
        const event = specialSessions.find(e => e.dayKey === day.dayKey);
        if (!event) return [];
        const base = day.priorClose ?? (stock.listedAtMs != null && dayKey(stock.listedAtMs) === day.dayKey ? stock.settings.initialPrice : null);
        const raw = base * (10000 + event.changeBps) / 10000;
        const target = base === null ? null : Math.max(1, Math.min(1_000_000, event.changeBps > 0 ? Math.ceil(raw) : Math.round(raw)));
        const finished = event.dayKey < dayKey(asOfMs) && day.coverage === 'COMPLETE' && day.observations > 0;
        return [{ ...event, base, targetClose: target, actualClose: finished ? day.closeAtEnd : null,
          differenceWis: finished && target !== null ? day.closeAtEnd - target : null }];
      });
      return { stockId, name: stock.settings.name, sector: sectorFor(stock), listedAtMs: stock.listedAtMs ?? null,
        listingPriceWis: stock.settings.initialPrice, issuedSharesAsOfExport: stock.settings.issuedShares,
        graduatedAtMs: stock.graduation?.atMs ?? null, prices,
        flows: publicFlows(state.released, stockId), shareholders: holders, specialSessionComparisons: special,
        outlook: forecasts.get(stockId) || [] };
    });
    const currentIds = new Set(stocks.map(s => s.stockId));
    return { schemaVersion: 1, semesterId: scope.semesterId, weekStart: range.weekStart, startsAtMs: range.startMs, endsAtMs: range.endMs,
      asOfMs, timeZone: 'Asia/Seoul', sourceRevision: market.revision, flowEndsAtMsExclusive: Math.max(range.startMs, flowEnd),
      stocks, marketIndex, pooledFlows: Object.values(state.released).filter(r => r.level !== 'STOCK' || !currentIds.has(r.group)),
      outlook: { startsAtMs: outlookStart, endsAtMs: outlookEnd, asOfMs,
        events: plannedEvents(market, outlookStart, outlookEnd),
        futureListings: [...forecasts].filter(([id]) => !currentIds.has(id)).map(([stockId, daily]) => ({ stockId, name: catalogById.get(stockId)?.name || '', daily })) },
      methodology: {
        unit: '위스, 주. 큰 정수는 정밀도 보존을 위해 십진 문자열로 표시합니다.',
        marketIndex: '저장된 시장 지수의 실제 관측값으로 계산한 지수 포인트입니다. 종목의 발행 주수와 이름은 조회 시점 기준입니다.',
        prices: '한국 시간 월요일~일요일의 실제 관측 시세입니다. 고가·저가는 보존된 관측값 범위입니다. 이전 종가가 확인되는 경우에만 완전한 기간 수익률을 계산합니다. 거래 없는 구간의 이월 가격은 closeAtEnd에만 표시합니다.',
        coverage: { COMPLETE: '상장 이후 기간 시작부터 관측 자료가 보존됨', PARTIAL: '기간 앞부분 등 일부 관측 누락', UNAVAILABLE: '관측 또는 이전 가격 확인 불가', BEFORE_LISTING: '상장 전' },
        flows: '완료된 한국 날짜의 체결만 집계합니다. BUY는 자발적 매수, SELL은 자발적 매도, GRADUATION은 자동 졸업청산입니다. 거래대금은 수수료 전 수량×단가입니다. 같은 날짜·방향에서 5개 이상 계좌가 참여한 종목은 개별 집계하고 나머지는 업종, 이후 시장 순으로 묶습니다. 셀끼리 중복되지 않으며 최종 소수 셀은 제외합니다. 빈 값은 거래 0건을 뜻하지 않습니다. 순매수 지표는 개별 공개된 매수·매도 셀의 차이입니다.',
        shareholders: '주초와 다음 주초 직전 스냅샷의 보유계좌수 및 순증감입니다. 두 스냅샷이 모두 있고 소수 집단·소수 변동 보호 기준을 충족한 경우에만 제공합니다. 신규·이탈 인원은 체결 횟수와 구분합니다.',
        outlook: '선택 주의 다음 7일 중 조회 시각 이후이며 현행 6주 계획에 포함되는 가격결정 회차를 현재 운영 설정으로 계산한 일별 예상가입니다. 교사 설정 변경, 중지, 실제 실행 누락 시 달라질 수 있습니다. 과거 시점에 보관한 예측 시계열은 없으며, 특별장 비교는 현재 정의된 목표와 실제 종가를 사용합니다. 상장·퇴장 일정은 현재 운영 계획의 예정일입니다.',
      } };
  }

  async function archiveWisStockReportPrices(event = {}) {
    const scheduled = event.scheduleTime ? Date.parse(event.scheduleTime) : now();
    if (!Number.isSafeInteger(scheduled)) invalidSource();
    const end = halfStart(scheduled), start = end - HALF;
    // Read the boundary, not delayed execution time. The immediately preceding
    // millisecond excludes the new session's opening quote or trade.
    const boundary = Timestamp.fromMillis(end - 1);
    const data = await db.runTransaction(async tx => {
      const config = (await tx.get(db.doc('site_settings/config'))).data();
      if (!config) return null;
      const scope = scopeFor({ year: String(config.year), semester: String(config.semester) }), root = rootOf(scope);
      const [pointer, manifest, snapshot] = await tx.getAll(db.doc('site_settings/semester_active'),
        db.doc('semester_manifests/' + scope.semesterId), db.doc(root + '/wis_stock_markets/current'));
      if ((config.activeSemesterId !== undefined && config.activeSemesterId !== scope.semesterId)
        || pointer.data()?.semesterId !== scope.semesterId || manifest.data()?.semesterId !== scope.semesterId
        || manifest.data()?.status !== 'ACTIVE' || manifest.data()?.readOnly === true
        || !Number.isSafeInteger(pointer.data()?.revision) || pointer.data().revision !== manifest.data()?.revision || !snapshot.exists) return null;
      const market = readMarket(snapshot, scope);
      if (!market.stocks.length) return null;
      const prices = Object.fromEntries(market.stocks.map(stock => [stock.id, priceInterval(stock, start, end)]));
      const value = { schemaVersion: 1, semesterId: scope.semesterId, startsAtMs: start, endsAtMs: end, prices,
        marketIndex: indexInterval(market, start, end) };
      if (new Date(end + KST).getUTCDay() === 1 && end === midnight(end)) {
        const supplies = await tx.getAll(...market.stocks.map(s => db.doc(root + '/wis_stock_supplies/' + s.id)),
          { fieldMask: ['stockId', 'semesterId', 'holders'] });
        value.holderCounts = Object.fromEntries(supplies.map((doc, i) => {
          const stockId = market.stocks[i].id, v = doc.data();
          if (doc.exists && (v.stockId !== stockId || v.semesterId !== scope.semesterId || !v.holders || Array.isArray(v.holders)
            || typeof v.holders !== 'object' || Object.values(v.holders).some(q => !Number.isSafeInteger(q) || q < 1))) invalidSource();
          return [stockId, Object.keys(v?.holders || {}).length];
        }));
      }
      return { scope, value };
    }, { readOnly: true, readTime: boundary });
    if (!data) return { changed: false };
    try { await archiveRef(db, data.scope, start).create(data.value); }
    catch (error) { if (error?.code === 6 || error?.code === 'already-exists') return { changed: false }; throw error; }
    return { changed: true };
  }
  return { exportWisStockWeeklyReportData, archiveWisStockReportPrices };
}

module.exports = { createWisStockWeeklyExport };
