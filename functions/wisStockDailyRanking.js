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
  }).slice(0, 5);
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
  return Promise.all(winners.map(async (row, index) => {
    const account = accounts.get(row.studentKey);
    const ledger = await tx.get(db.collection(`${root}/wis_stock_history`)
      .where('accountId', '==', account.accountId).where('kind', '==', 'ORDER_FILLED')
      .select('accountId', 'studentUid', 'semesterId', 'sequence', 'atMs', 'stockId', 'side', 'quantity', 'unitPrice', 'fee', 'stockCashDelta', 'realizedPnl'));
    const fills = ledger.docs.map(doc => {
      const entry = doc.data();
      if (entry.studentUid !== account.studentUid || entry.accountId !== account.accountId || entry.semesterId !== scope.semesterId) invalid();
      return entry;
    });
    const { points } = buildWisStockInvestmentHistorySeries({ account, fills, stocks: market.stocks, asOfMs });
    const last = points.at(-1);
    if (last.holdingValue !== row.holdingValue || last.holdingCostBasis !== row.holdingCostBasis) invalid();
    const holdings = Object.entries(account.positions).filter(([, p]) => p.quantity > 0)
      .map(([id, p]) => ({ name: stocks.get(id).settings.name, quantity: p.quantity })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { row: { rank: index + 1, displayName: row.displayName, returnPercent: percent(last.holdingValue, last.holdingCostBasis),
      slotId: 'slot_' + account.accountId.slice(8, 48), enrollmentId: account.enrollmentId },
    detail: { holdings, points: hourlyReturns(points, asOfMs) } };
  }));
}

function createWisStockDailyRanking({ db, now = Date.now, assertSession = assertScoreWorkflowSession }) {
  async function publishWisStockDailyRanking() {
    const { dayKey, asOfMs } = previousRankingTime(now());
    const settings = (await db.doc('site_settings/config').get()).data();
    if (!settings) return { changed: false };
    const scope = scopeOf(String(settings.year), String(settings.semester));
    const head = db.doc(rankingPath(scope));
    if ((await head.get()).data()?.asOfMs >= asOfMs) return { changed: false };
    const entries = await db.runTransaction(tx => buildRanking(tx, db, scope, asOfMs),
      { readOnly: true, readTime: Timestamp.fromMillis(asOfMs) });
    return db.runTransaction(async tx => {
      const existing = (await tx.get(head)).data();
      if (existing?.asOfMs >= asOfMs || previousRankingTime(now()).asOfMs !== asOfMs) return { changed: false };
      const base = { schemaVersion: 1, semesterId: scope.semesterId, dayKey, asOfMs };
      tx.set(head, { ...base, rows: entries.map(entry => entry.row) });
      for (const { row, detail } of entries) tx.set(head.collection('entries').doc(String(row.rank)), { ...base, rank: row.rank, ...detail });
      for (let rank = entries.length + 1; rank <= (existing?.rows.length || 0); rank++) tx.delete(head.collection('entries').doc(String(rank)));
      return { changed: true, students: entries.length };
    });
  }

  async function getStudentWisStockRanking(request) {
    const data = request.data, detail = data?.rank !== undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.year !== 'string' || !/^20\d{2}$/.test(data.year)
      || typeof data.semester !== 'string' || !/^[12]$/.test(data.semester)
      || Object.keys(data).some(key => !['year', 'semester', '_session', 'dayKey', 'rank'].includes(key))
      || (detail !== Object.hasOwn(data, 'dayKey')) || (detail && (!Number.isInteger(data.rank) || data.rank < 1 || data.rank > 5
        || typeof data.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dayKey))))
      throw new HttpsError('invalid-argument', '순위 조회 범위를 확인해 주세요.');
    const actor = await assertSession(request), uid = request.auth?.uid;
    if (typeof uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) || actor.uid !== uid) denied();
    const scope = scopeOf(data.year, data.semester);
    return db.runTransaction(async tx => {
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
        { fieldMask: ['classId', 'semesterId', 'status', 'readOnly', 'schemaVersion', 'dayKey', 'asOfMs', 'rows'] })).map(doc => doc.data());
      if (classroom?.classId !== enrollment.classId || classroom.semesterId !== scope.semesterId || classroom.status !== 'ACTIVE' || classroom.readOnly) denied();
      const base = { semesterId: scope.semesterId, ...cutoff };
      if (summary?.dayKey !== dayKey || summary.asOfMs !== asOfMs) {
        if (detail) unavailable();
        return { ...base, status: 'NOT_READY', rows: [] };
      }
      if (summary.semesterId !== scope.semesterId || summary.schemaVersion !== 1 || !Array.isArray(summary.rows)
        || summary.rows.length > 5 || summary.rows.some((r, i) => r.rank !== i + 1 || typeof r.displayName !== 'string'
          || !r.displayName || !Number.isFinite(r.returnPercent) || !/^slot_[a-f0-9]{40}$/.test(r.slotId))) unavailable();
      const candidates = detail ? summary.rows.filter(row => row.rank === data.rank) : summary.rows;
      // Retired or changed enrollment may no longer be disclosed. Never substitute a sixth student.
      const targetSlots = candidates.length ? await tx.getAll(...candidates.map(row => db.doc(`semester_enrollment_slots/${row.slotId}`)),
        { fieldMask: ['status', 'activeEnrollmentId', 'semesterId'] }) : [];
      const rows = candidates.filter((row, i) => {
        const target = targetSlots[i].data();
        return target?.semesterId === scope.semesterId && target.activeEnrollmentId === row.enrollmentId && (target.status ?? 'ACTIVE') === 'ACTIVE';
      }).map(({ rank, displayName, returnPercent }) => ({ rank, displayName, returnPercent }));
      if (!detail) return { ...base, status: 'READY', rows };
      if (rows.length !== 1) unavailable();
      const entry = (await tx.get(head.collection('entries').doc(String(data.rank)))).data();
      if (entry?.semesterId !== scope.semesterId || entry.schemaVersion !== 1 || entry.dayKey !== dayKey
        || entry.asOfMs !== asOfMs || entry.rank !== data.rank || !Array.isArray(entry.points) || !Array.isArray(entry.holdings)) unavailable();
      return { ...base, rank: data.rank, displayName: rows[0].displayName,
        points: entry.points.map(({ atMs, returnPercent }) => {
          if (!Number.isSafeInteger(atMs) || atMs <= 0 || atMs > asOfMs || !(returnPercent === null || Number.isFinite(returnPercent))) unavailable();
          return { atMs, returnPercent };
        }), holdings: entry.holdings.map(({ name, quantity }) => {
          if (typeof name !== 'string' || !name || !Number.isSafeInteger(quantity) || quantity <= 0) unavailable();
          return { name, quantity };
        }) };
    }, { readOnly: true });
  }
  return { getStudentWisStockRanking, publishWisStockDailyRanking };
}
module.exports = { createWisStockDailyRanking, previousRankingTime, topReturns };
