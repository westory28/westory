const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { assertStudentWispiMenuVisible } = require('./studentMenuVisibility');
const { accountIdFor } = require('./studentWisWallet');
const { readMarket } = require('./wisStocks');
const { normalizeWisStockInvestmentBoardScope, parseWisStockInvestmentBoardSnapshot } = require('./wisStockInvestmentBoard');
const { buildWisStockInvestmentHistorySeries } = require('./wisStockInvestmentHistorySeries.mjs');

const HOUR = 3_600_000, DAY = 24 * HOUR;
const rootOf = scope => `years/${scope.year}/semesters/${scope.semester}`;
const rankingPath = scope => `${rootOf(scope)}/wis_stock_student_rankings/current`;
const hash = text => createHash('sha256').update(text).digest('hex');
const invalid = () => { throw new Error('위스피 순위 집계 원본을 확인해 주세요.'); };
const denied = () => { throw new HttpsError('permission-denied', '현재 학기의 학생만 투자 랭킹을 볼 수 있습니다.'); };
const unavailable = () => { throw new HttpsError('failed-precondition', '투자 랭킹 목록을 다시 불러와 주세요.'); };
const scopeOf = (year, semester) => normalizeWisStockInvestmentBoardScope({ year, semester });
const activeScope = (scope, config, pointer, manifest) => String(config?.year) === scope.year
  && String(config?.semester) === scope.semester && pointer?.semesterId === scope.semesterId
  && Number.isSafeInteger(pointer.revision) && pointer.revision > 0 && manifest?.revision === pointer.revision
  && manifest.semesterId === scope.semesterId && manifest.status === 'ACTIVE' && manifest.readOnly !== true;

function previousRankingTime(nowMs) {
  // A whole minute also supports Firestore PITR when the first run or retry is later in the day.
  const asOfMs = Math.floor((nowMs + 9 * HOUR) / DAY) * DAY - 9 * HOUR - 60_000;
  return { dayKey: new Date(asOfMs + 9 * HOUR).toISOString().slice(0, 10), asOfMs };
}
function topReturns(rows) {
  return rows.filter(row => row.holdingCount > 0 && row.holdingCostBasis > 0).sort((a, b) => {
    const left = BigInt(a.holdingValue) * BigInt(b.holdingCostBasis);
    const right = BigInt(b.holdingValue) * BigInt(a.holdingCostBasis);
    return (left === right ? 0 : left > right ? -1 : 1) || a.grade - b.grade || a.classNumber - b.classNumber
      || a.studentNumber - b.studentNumber || a.studentKey.localeCompare(b.studentKey);
  });
}
const percent = (value, cost) => cost > 0 && value !== null ? (value - cost) / cost * 100 : null;
function hourlyReturns(points, asOfMs) {
  const byHour = new Map();
  for (const point of points) if (point.atMs > asOfMs - 30 * DAY) {
    byHour.set(Math.floor(point.atMs / HOUR), { atMs: point.atMs,
      returnPercent: percent(point.holdingValue, point.holdingCostBasis) });
  }
  return [...byHour.values()];
}

async function readAccounts(tx, db, scope, rows) {
  const accounts = new Map();
  for (let start = 0; start < rows.length; start += 30) {
    const group = rows.slice(start, start + 30);
    const query = db.collection(`${rootOf(scope)}/wis_stock_accounts`).where('studentKey', 'in', group.map(r => r.studentKey))
      .select('schemaVersion', 'semesterId', 'accountId', 'studentKey', 'studentUid', 'enrollmentId', 'boardEligible', 'revision', 'positions');
    const result = await tx.get(query);
    if (result.size !== group.length) invalid();
    for (const doc of result.docs) {
      const a = doc.data();
      if (![1, 2].includes(a.schemaVersion) || a.semesterId !== scope.semesterId || a.boardEligible === false
        || typeof a.studentUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(a.studentUid)
        || typeof a.enrollmentId !== 'string' || !a.enrollmentId || a.enrollmentId.includes('/')
        || a.accountId !== doc.id || doc.id !== accountIdFor(scope.semesterId, a.studentUid)
        || a.studentKey !== 'student_' + hash(a.studentUid).slice(0, 24) || accounts.has(a.studentKey)) invalid();
      accounts.set(a.studentKey, a);
    }
  }
  return accounts;
}

async function buildRanking(tx, db, scope, asOfMs) {
  const root = rootOf(scope);
  const [pointer, manifest, config, boardDoc, marketDoc] = await tx.getAll(...[
    'site_settings/semester_active', `semester_manifests/${scope.semesterId}`, 'site_settings/config',
    `${root}/wis_stock_investment_boards/all`, `${root}/wis_stock_markets/current`,
  ].map(path => db.doc(path)));
  if (!activeScope(scope, config.data(), pointer.data(), manifest.data())) return [];
  const board = parseWisStockInvestmentBoardSnapshot(boardDoc.data(), scope);
  const market = readMarket(marketDoc, scope), stocks = new Map(market.stocks.map(stock => [stock.id, stock]));
  if (board.asOfMs > asOfMs || market.updatedAtMs > asOfMs) invalid();
  const held = board.rows.filter(row => row.holdingCount > 0);
  let accounts;
  if (board.priceRevision !== market.revision) {
    // Account and board writes are atomic. The price trigger is asynchronous, so revalue all
    // held positions at this readTime when it has not yet observed the market revision.
    accounts = await readAccounts(tx, db, scope, held);
    for (const row of held) {
      const account = accounts.get(row.studentKey);
      let value = 0n, cost = 0n;
      for (const [stockId, p] of Object.entries(account.positions)) {
        if (!Number.isSafeInteger(p.quantity) || p.quantity < 0 || !Number.isSafeInteger(p.costBasis) || p.costBasis < 0) invalid();
        if (!p.quantity) continue;
        if (!stocks.has(stockId)) invalid();
        value += BigInt(p.quantity) * BigInt(stocks.get(stockId).price);
        cost += BigInt(p.costBasis);
      }
      if (cost !== BigInt(row.holdingCostBasis) || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
      row.holdingValue = Number(value);
    }
  }
  const winners = topReturns(held);
  accounts ??= await readAccounts(tx, db, scope, winners);
  const classRanks = new Map();
  return Promise.all(winners.map(async (row, index) => {
    const account = accounts.get(row.studentKey);
    const classKey = `${row.grade}_${row.classNumber}`;
    const classRank = (classRanks.get(classKey) || 0) + 1;
    classRanks.set(classKey, classRank);
    const entry = { globalRank: index + 1, classRank, classKey, displayName: row.displayName,
      returnPercent: percent(row.holdingValue, row.holdingCostBasis),
      slotId: 'slot_' + account.accountId.slice(8, 48), enrollmentId: account.enrollmentId,
      accountId: account.accountId, studentUid: account.studentUid,
      holdingValue: row.holdingValue, holdingCostBasis: row.holdingCostBasis };
    // Only the default five graphs are prepared daily. Other graphs are read on demand.
    if (index >= 5) return entry;
    entry.points = await buildDetail(tx, db, scope, account, market, asOfMs, row);
    return entry;
  }));
}

async function buildDetail(tx, db, scope, account, market, asOfMs, row) {
    const ledger = await tx.get(db.collection(`${rootOf(scope)}/wis_stock_history`)
      .where('accountId', '==', account.accountId).where('kind', '==', 'ORDER_FILLED')
      .select('accountId', 'studentUid', 'semesterId', 'sequence', 'atMs', 'stockId', 'side', 'quantity', 'unitPrice', 'fee', 'stockCashDelta', 'realizedPnl'));
    const fills = ledger.docs.map(doc => {
      const entry = doc.data();
      if (entry.studentUid !== account.studentUid || entry.accountId !== account.accountId || entry.semesterId !== scope.semesterId) invalid();
      return entry;
    });
    const { points } = buildWisStockInvestmentHistorySeries({ account, fills, stocks: market.stocks, asOfMs });
    const last = points.at(-1);
    if (row && (last.holdingValue !== row.holdingValue || last.holdingCostBasis !== row.holdingCostBasis)) invalid();
    return hourlyReturns(points, asOfMs);
}

const classPattern = /^[1-3]_[1-9][0-9]?$/;
const rowFields = ['schemaVersion', 'semesterId', 'dayKey', 'asOfMs', 'globalRank', 'classRank', 'classKey',
  'displayName', 'returnPercent', 'slotId', 'enrollmentId', 'accountId', 'studentUid', 'holdingValue', 'holdingCostBasis'];
const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(value) {
  try {
    if (typeof value !== 'string' || value.length > 300) unavailable();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!Number.isSafeInteger(cursor.after) || cursor.after < 1 || !Number.isSafeInteger(cursor.rank) || cursor.rank < 1) unavailable();
    return cursor;
  } catch { unavailable(); }
}
const entriesRef = (head, generation) => head.collection('snapshots').doc(generation).collection('entries');

function createWisStockDailyRanking({ db, now = Date.now, assertSession = assertScoreWorkflowSession }) {
  // Public graph values only, bounded by semester/day/entry. Every request still checks
  // current session, publication and target enrollment before consulting this cache.
  const graphCache = new Map(), graphFlights = new Map();
  async function graph(scope, summary, row, head) {
    const key = `${scope.semesterId}:${summary.generation}:${row.globalRank}`;
    const cached = graphCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.points;
    if (graphFlights.has(key)) return graphFlights.get(key);
    const task = (async () => {
      let points;
      if (row.globalRank <= 5) {
        const saved = (await entriesRef(head, summary.generation).doc(String(row.globalRank)).get()).data();
        if (saved?.dayKey !== summary.dayKey || saved.asOfMs !== summary.asOfMs) unavailable();
        points = saved.points;
      } else {
        points = await db.runTransaction(async tx => {
          const [accountDoc, marketDoc] = await tx.getAll(
            db.doc(`${rootOf(scope)}/wis_stock_accounts/${row.accountId}`), db.doc(`${rootOf(scope)}/wis_stock_markets/current`));
          const account = accountDoc.data();
          if (![1, 2].includes(account?.schemaVersion) || account.semesterId !== scope.semesterId
            || account.accountId !== row.accountId || account.studentUid !== row.studentUid
            || account.enrollmentId !== row.enrollmentId || account.boardEligible === false) unavailable();
          const market = readMarket(marketDoc, scope);
          if (market.updatedAtMs > summary.asOfMs) unavailable();
          return buildDetail(tx, db, scope, account, market, summary.asOfMs, row);
        }, { readOnly: true, readTime: Timestamp.fromMillis(summary.asOfMs) });
      }
      if (!Array.isArray(points) || points.some((p, i) => !Number.isSafeInteger(p.atMs) || p.atMs <= 0
        || p.atMs > summary.asOfMs || (i && p.atMs <= points[i - 1].atMs)
        || !(p.returnPercent === null || Number.isFinite(p.returnPercent)))) unavailable();
      if (graphCache.size >= 128) graphCache.delete(graphCache.keys().next().value);
      graphCache.set(key, { points, expiresAt: now() + 30 * 60_000 });
      return points;
    })().finally(() => graphFlights.delete(key));
    graphFlights.set(key, task);
    return task;
  }
  async function publishWisStockDailyRanking() {
    const { dayKey, asOfMs } = previousRankingTime(now());
    const settings = (await db.doc('site_settings/config').get()).data();
    if (!settings) return { changed: false };
    const scope = scopeOf(String(settings.year), String(settings.semester));
    const head = db.doc(rankingPath(scope));
    const previous = (await head.get()).data();
    if (previous?.asOfMs > asOfMs || (previous?.asOfMs === asOfMs && previous.schemaVersion === 2)) return { changed: false };
    const entries = await db.runTransaction(tx => buildRanking(tx, db, scope, asOfMs),
      { readOnly: true, readTime: Timestamp.fromMillis(asOfMs) });
    const generation = `${dayKey}-v2`, target = entriesRef(head, generation);
    const base = { schemaVersion: 2, semesterId: scope.semesterId, dayKey, asOfMs };
    const counts = new Map();
    for (const row of entries) counts.set(row.classKey, (counts.get(row.classKey) || 0) + 1);
    const classes = [...counts].sort(([a], [b]) => {
      const [ag, ac] = a.split('_').map(Number), [bg, bc] = b.split('_').map(Number);
      return ag - bg || ac - bc;
    }).map(([key, count]) => ({ key, label: `${key.split('_')[0]}학년 ${key.split('_')[1]}반`, count }));
    // Stage immutable pages before atomically moving the head, without a 500-student cap.
    for (let start = 0; start < entries.length; start += 400) await db.runTransaction(async tx => {
      for (const row of entries.slice(start, start + 400)) tx.set(target.doc(String(row.globalRank)), { ...base, ...row });
    });
    const result = await db.runTransaction(async tx => {
      const existing = (await tx.get(head)).data();
      if (existing?.asOfMs > asOfMs || (existing?.asOfMs === asOfMs && existing.schemaVersion === 2)
        || previousRankingTime(now()).asOfMs !== asOfMs) return { changed: false };
      tx.set(head, { ...base, generation, classes, total: entries.length });
      return { changed: true, students: entries.length };
    });
    if (result.changed && previous) {
      const old = previous.schemaVersion === 2 ? entriesRef(head, previous.generation) : head.collection('entries');
      const count = previous.schemaVersion === 2 ? previous.total : previous.rows?.length || 0;
      for (let start = 1; start <= count; start += 400) await db.runTransaction(async tx => {
        for (let rank = start; rank < start + 400 && rank <= count; rank++) tx.delete(old.doc(String(rank)));
      });
    }
    return result;
  }

  async function getStudentWisStockRanking(request) {
    const raw = request.data;
    const legacy = raw?.filter === undefined && raw?.cursor === undefined && raw?.entryId === undefined;
    if (raw?.rank !== undefined && (!legacy || !Number.isInteger(raw.rank) || raw.rank < 1 || raw.rank > 5))
      throw new HttpsError('invalid-argument', '순위 조회 범위를 확인해 주세요.');
    const data = raw?.rank === undefined ? raw : { ...raw, entryId: String(raw.rank) };
    if (data && Object.hasOwn(data, 'rank')) delete data.rank;
    const detail = data?.entryId !== undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.year !== 'string' || !/^20\d{2}$/.test(data.year)
      || typeof data.semester !== 'string' || !/^[12]$/.test(data.semester)
      || Object.keys(data).some(key => !['year', 'semester', '_session', 'dayKey', 'entryId', 'filter', 'cursor', 'chartCount'].includes(key))
      || (data.filter !== undefined && !['all', 'my-class'].includes(data.filter) && !classPattern.test(data.filter))
      || (data.chartCount !== undefined && (!Number.isInteger(data.chartCount) || data.chartCount < 0 || data.chartCount > 5 || detail))
      || (detail !== Object.hasOwn(data, 'dayKey')) || (detail && (typeof data.entryId !== 'string' || !/^[1-9][0-9]{0,5}$/.test(data.entryId)
        || typeof data.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dayKey) || data.cursor !== undefined)))
      throw new HttpsError('invalid-argument', '순위 조회 범위를 확인해 주세요.');
    const actor = await assertSession(request), uid = request.auth?.uid;
    if (typeof uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || actor.uid !== uid) denied();
    const scope = scopeOf(data.year, data.semester);
    const loaded = await db.runTransaction(async tx => {
      const cutoff = previousRankingTime(now()), { dayKey, asOfMs } = cutoff;
      if (detail && data.dayKey !== dayKey) unavailable();
      const viewerSlot = 'slot_' + hash(`${scope.semesterId}\n${uid}`).slice(0, 40);
      const [profile, identity, slot, config, pointer, manifest, publication] = (await tx.getAll(...[
        `users/${uid}`, `student_identities/${uid}`, `semester_enrollment_slots/${viewerSlot}`,
        'site_settings/config', 'site_settings/semester_active', `semester_manifests/${scope.semesterId}`, `${rootOf(scope)}/wis_stock_public/current`,
      ].map(path => db.doc(path)), { fieldMask: ['role', 'disabled', 'isDeleted', 'deletedAt', 'weplayDeletionPending',
        'registrationApprovalStatus', 'enrollmentStatus', 'accountStatus', 'studentUid', 'semesterId', 'status', 'activeEnrollmentId',
        'year', 'semester', 'studentMenuVisibility', 'revision', 'readOnly', 'studentOpen', 'halted'] })).map(doc => doc.data());
      if (profile?.role !== 'student' || profile.disabled || profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending
        || (profile.registrationApprovalStatus ?? 'APPROVED') !== 'APPROVED' || ![undefined, '', 'active', null].includes(profile.enrollmentStatus)
        || identity?.studentUid !== uid || (identity.accountStatus ?? 'ACTIVE') !== 'ACTIVE' || slot?.studentUid !== uid
        || slot.semesterId !== scope.semesterId || (slot.status ?? 'ACTIVE') !== 'ACTIVE'
        || !slot.activeEnrollmentId || slot.activeEnrollmentId.includes('/') || !activeScope(scope, config, pointer, manifest)) denied();
      assertStudentWispiMenuVisible(config);
      if (publication?.semesterId !== scope.semesterId || publication.studentOpen !== true || publication.halted !== false) denied();
      const enrollment = (await tx.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data();
      if (enrollment?.studentUid !== uid || enrollment.enrollmentId !== slot.activeEnrollmentId || enrollment.semesterId !== scope.semesterId
        || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly || !enrollment.classId || enrollment.classId.includes('/')) denied();
      const head = db.doc(rankingPath(scope));
      const [classroom, summary] = (await tx.getAll(db.doc(`semester_classes/${enrollment.classId}`), head,
        { fieldMask: ['classId', 'semesterId', 'status', 'readOnly', 'grade', 'classNumber', 'schemaVersion', 'dayKey', 'asOfMs', 'generation', 'classes', 'total'] })).map(doc => doc.data());
      if (classroom?.classId !== enrollment.classId || classroom.semesterId !== scope.semesterId || classroom.status !== 'ACTIVE' || classroom.readOnly) denied();
      const myClassKey = `${classroom.grade}_${classroom.classNumber}`;
      if (!classPattern.test(myClassKey)) denied();
      const filter = data.filter === 'my-class' ? myClassKey : data.filter || 'all';
      const base = { semesterId: scope.semesterId, ...cutoff, filter, myClassKey };
      if (summary?.dayKey !== dayKey || summary.asOfMs !== asOfMs || summary.schemaVersion !== 2) {
        if (detail || data.cursor) unavailable();
        return { response: { ...base, status: 'NOT_READY', classes: [], rows: [], charts: [], hasMore: false, nextCursor: null } };
      }
      if (summary.semesterId !== scope.semesterId || summary.generation !== `${dayKey}-v2`
        || !Array.isArray(summary.classes) || !Number.isSafeInteger(summary.total) || summary.total < 0) unavailable();
      const classes = summary.classes.map(c => {
        if (!classPattern.test(c.key) || typeof c.label !== 'string' || !Number.isSafeInteger(c.count) || c.count < 1) unavailable();
        return { key: c.key, label: c.label };
      });
      const count = filter === 'all' ? Math.min(legacy ? 5 : 50, summary.total) : summary.classes.find(c => c.key === filter)?.count || 0;
      const cursor = data.cursor === undefined ? null : decodeCursor(data.cursor);
      if (cursor && (cursor.dayKey !== dayKey || cursor.filter !== filter || cursor.rank >= count
        || (filter === 'all' && cursor.after >= 50))) unavailable();
      const target = entriesRef(head, summary.generation);
      let candidates;
      if (detail) {
        const selected = (await tx.get(target.doc(data.entryId))).data();
        candidates = selected ? [selected] : [];
      } else {
        let query = target.orderBy('globalRank', 'asc');
        query = filter === 'all' ? query.where('globalRank', '<=', 50) : query.where('classKey', '==', filter);
        if (cursor) query = query.startAfter(cursor.after);
        candidates = (await tx.get(query.limit(legacy ? 5 : 10).select(...rowFields))).docs.map(doc => doc.data());
      }
      for (const row of candidates) {
        if (row.schemaVersion !== 2 || row.semesterId !== scope.semesterId || row.dayKey !== dayKey || row.asOfMs !== asOfMs
          || !Number.isSafeInteger(row.globalRank) || row.globalRank < 1 || !Number.isSafeInteger(row.classRank) || row.classRank < 1
          || typeof row.displayName !== 'string' || !row.displayName || !Number.isFinite(row.returnPercent)
          || !/^slot_[a-f0-9]{40}$/.test(row.slotId) || !/^wisacct_[a-f0-9]{64}$/.test(row.accountId)
          || (filter === 'all' ? row.globalRank > 50 : row.classKey !== filter)) unavailable();
      }
      const slots = candidates.length ? await tx.getAll(...candidates.map(row => db.doc(`semester_enrollment_slots/${row.slotId}`)),
        { fieldMask: ['status', 'activeEnrollmentId', 'semesterId'] }) : [];
      const active = candidates.filter((row, i) => {
        const target = slots[i].data();
        return target?.semesterId === scope.semesterId && target.activeEnrollmentId === row.enrollmentId && (target.status ?? 'ACTIVE') === 'ACTIVE';
      });
      const rankOf = row => filter === 'all' ? row.globalRank : row.classRank;
      const rows = active.map(row => ({ entryId: String(row.globalRank), rank: rankOf(row), displayName: row.displayName, returnPercent: row.returnPercent }));
      if (detail && rows.length !== 1) unavailable();
      const last = candidates.at(-1), hasMore = Boolean(last && rankOf(last) < count);
      const nextCursor = hasMore ? encodeCursor({ dayKey, filter, after: last.globalRank, rank: rankOf(last) }) : null;
      return { base, summary, head, active, rows, response: { ...base, status: 'READY', classes, rows, hasMore, nextCursor } };
    }, { readOnly: true });
    if (!loaded.active) return loaded.response;
    const selected = detail ? loaded.active : loaded.active.slice(0, legacy ? 0 : data.chartCount ?? (data.cursor ? 0 : 5));
    const charts = await Promise.all(selected.map(async row => ({ ...loaded.base,
      entryId: String(row.globalRank), rank: loaded.base.filter === 'all' ? row.globalRank : row.classRank,
      displayName: row.displayName, points: await graph(scope, loaded.summary, row, loaded.head) })));
    return detail ? (legacy ? { ...charts[0], holdings: [] } : charts[0]) : { ...loaded.response, charts };
  }
  return { getStudentWisStockRanking, publishWisStockDailyRanking };
}
module.exports = { createWisStockDailyRanking, previousRankingTime, topReturns };
