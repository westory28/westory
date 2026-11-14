// Safe projection protocol only: no I/O, clock, student account creation,
// wallet mutation, synthetic student fallback, or executable trading endpoint.
const MAX = Number.MAX_SAFE_INTEGER;
const MAX_BYTES = 900 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, min = 0, max = MAX) => Number.isSafeInteger(value) && value >= min && value <= max;
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const classFields = ['grade', 'classNumber'];
const rowFields = ['studentKey', 'grade', 'classNumber', 'studentNumber', 'displayName', 'stockCash', 'reservedCash',
  'holdingCount', 'holdingValue', 'holdingCostBasis', 'realizedPnl'];
const totalFields = ['studentCount', 'stockCash', 'reservedCash', 'holdingValue', 'holdingCostBasis', 'totalAssets', 'realizedPnl', 'unrealizedPnl'];
const documentFields = ['schemaVersion', 'status', 'source', 'complete', 'semesterId', 'grade', 'classNumber',
  'revision', 'asOfMs', 'sourceRevision', 'priceRevision', 'classes', 'rows', 'totals'];
const sessionFields = ['uid', 'email', 'authTime', 'status', 'createdAt', 'lastActivityAt', 'lastTouchAt',
  'generalExpiresAt', 'highRiskExpiresAt', 'closedAt', 'schemaVersion', 'authorityGeneration', 'protocolVersion',
  'sessionRevision', 'authorityModeAtOpen'];
export class WisStockInvestmentBoardError extends Error {
  constructor(reason, message) { super(message); this.name = 'WisStockInvestmentBoardError'; this.reason = reason; }
}
const fail = (reason = 'WIS_STOCK_BOARD_INVALID') => {
  throw new WisStockInvestmentBoardError(reason, '투자 현황의 범위와 집계 자료를 확인하지 못했습니다. 다시 조회해 주세요.');
};
const classValid = value => typeof value.grade === 'string' && /^[1-3]$/.test(value.grade)
  && typeof value.classNumber === 'string' && /^[1-9][0-9]?$/.test(value.classNumber);
const classKey = value => `${value.grade}_${value.classNumber}`;
const safe = value => {
  if (value > BigInt(MAX) || value < -BigInt(MAX)) fail('WIS_STOCK_BOARD_UNSAFE_TOTAL');
  return Number(value);
};
export function normalizeWisStockInvestmentBoardScope(input) {
  if (!record(input) || typeof input.year !== 'string' || !/^20\d{2}$/.test(input.year)
    || typeof input.semester !== 'string' || !/^[12]$/.test(input.semester)) fail('WIS_STOCK_BOARD_SCOPE_INVALID');
  const grade = input.grade ?? '', classNumber = input.classNumber ?? '';
  if (!((grade === '' && classNumber === '') || classValid({ grade, classNumber }))) fail('WIS_STOCK_BOARD_SCOPE_INVALID');
  const scope = { year: input.year, semester: input.semester, semesterId: `${input.year}-${input.semester}`,
    grade, classNumber, documentId: grade ? `class_${grade}_${classNumber}` : 'all' };
  if ((Object.hasOwn(input, 'semesterId') && input.semesterId !== scope.semesterId)
    || (Object.hasOwn(input, 'documentId') && input.documentId !== scope.documentId)) fail('WIS_STOCK_BOARD_SCOPE_INVALID');
  return scope;
}
export function parseWisStockInvestmentBoardSession(raw, identity, nowMs) {
  const invalid = () => fail('WIS_STOCK_BOARD_SESSION_INVALID');
  if (!record(raw) || !record(identity) || typeof identity.uid !== 'string' || !identity.uid
    || !int(identity.authTime, 1) || !int(nowMs, 1) || raw.uid !== identity.uid || raw.authTime !== identity.authTime
    || raw.status !== 'active' || raw.schemaVersion !== 2 || raw.authorityGeneration !== 'w1r2-2026-08-09'
    || !int(raw.protocolVersion, 2) || typeof raw.sessionRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sessionRevision)
    || !['ENFORCE', 'OBSERVE_ONLY', 'DISABLED'].includes(raw.authorityModeAtOpen)
    || Object.keys(raw).some(key => !sessionFields.includes(key)) || typeof raw.generalExpiresAt?.toMillis !== 'function') invalid();
  let expiresAtMs;
  try { expiresAtMs = raw.generalExpiresAt.toMillis(); } catch { invalid(); }
  if (!int(expiresAtMs, 0, 8640000000000000)) invalid();
  if (raw.authorityModeAtOpen === 'ENFORCE' && expiresAtMs <= nowMs) fail('WIS_STOCK_BOARD_SESSION_EXPIRED');
  return { authTime: raw.authTime, revision: raw.sessionRevision, authorityMode: raw.authorityModeAtOpen,
    expiresAtMs, deadlineAtMs: raw.authorityModeAtOpen === 'ENFORCE' ? expiresAtMs : null };
}
function rowsAndClasses(raw, scope) {
  if (!Array.isArray(raw.classes) || raw.classes.length > 297 || !Array.isArray(raw.rows)) fail();
  const classes = [], keys = new Set(), studentKeys = new Set(), seatKeys = new Set();
  for (const item of raw.classes) {
    if (!exact(item, classFields) || !classValid(item) || keys.has(classKey(item))
      || (scope.grade && classKey(item) !== classKey(scope))) fail();
    keys.add(classKey(item)); classes.push({ ...item });
  }
  if (scope.grade && (classes.length !== 1 || !keys.has(classKey(scope)))) fail();
  const rows = raw.rows.map(item => {
    if (!exact(item, rowFields) || typeof item.studentKey !== 'string' || !/^student_[a-f0-9]{24}$/.test(item.studentKey)
      || studentKeys.has(item.studentKey) || !classValid(item) || !keys.has(classKey(item))
      || typeof item.studentNumber !== 'string' || !/^[1-9][0-9]?$/.test(item.studentNumber)
      || typeof item.displayName !== 'string' || item.displayName !== item.displayName.trim()
      || item.displayName.length < 1 || item.displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(item.displayName)
      || !['stockCash', 'reservedCash', 'holdingValue', 'holdingCostBasis'].every(key => int(item[key]))
      || !int(item.holdingCount, 0, 100) || !int(item.realizedPnl, -MAX) || item.reservedCash > item.stockCash
      || (item.holdingCount === 0 ? item.holdingValue !== 0 || item.holdingCostBasis !== 0 : item.holdingCostBasis === 0)) fail();
    const seat = `${classKey(item)}_${item.studentNumber}`;
    if (seatKeys.has(seat)) fail();
    studentKeys.add(item.studentKey); seatKeys.add(seat);
    return { ...item, totalAssets: safe(BigInt(item.stockCash) + BigInt(item.holdingValue)),
      unrealizedPnl: safe(BigInt(item.holdingValue) - BigInt(item.holdingCostBasis)) };
  });
  classes.sort((a, b) => Number(a.grade) - Number(b.grade) || Number(a.classNumber) - Number(b.classNumber));
  rows.sort((a, b) => Number(a.grade) - Number(b.grade) || Number(a.classNumber) - Number(b.classNumber)
    || Number(a.studentNumber) - Number(b.studentNumber));
  // BigInt totals cannot lose a Wis through intermediate rounding or cancellation.
  const totals = { studentCount: rows.length };
  for (const key of totalFields.slice(1)) totals[key] = safe(rows.reduce((sum, row) => sum + BigInt(row[key]), 0n));
  return { classes, rows, totals };
}
const utf8Bytes = value => new TextEncoder().encode(value).length + 1;
function storedBytes(value) {
  if (typeof value === 'boolean' || value === null) return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return utf8Bytes(value);
  if (Array.isArray(value)) return value.reduce((size, item) => size + storedBytes(item), 0);
  if (record(value)) return 32 + Object.entries(value).reduce((size, [key, item]) => size + utf8Bytes(key) + storedBytes(item), 0);
  return Infinity;
}
function inspect(raw, scope) {
  if (!exact(raw, documentFields) || raw.schemaVersion !== 1 || raw.status !== 'READY'
    || raw.source !== 'CANONICAL_STOCK_LEDGER' || raw.complete !== true || raw.semesterId !== scope.semesterId
    || raw.grade !== scope.grade || raw.classNumber !== scope.classNumber || !int(raw.revision, 1)
    || !int(raw.asOfMs, 1, 8640000000000000) || !int(raw.sourceRevision, 1) || !int(raw.priceRevision)) fail();
  // Fail on oversized complete feeds; never silently truncate students.
  if (storedBytes(raw) + 1024 > MAX_BYTES) fail('WIS_STOCK_BOARD_CAPACITY');
  return rowsAndClasses(raw, scope);
}
export function parseWisStockInvestmentBoardSnapshot(raw, inputScope) {
  const scope = normalizeWisStockInvestmentBoardScope(inputScope);
  const empty = { status: 'NOT_READY', semesterId: scope.semesterId, grade: scope.grade, classNumber: scope.classNumber,
    revision: 0, asOfMs: 0, sourceRevision: 0, priceRevision: 0, classes: [], rows: [], totals: null };
  if (raw === null || raw === undefined) return empty;
  const parsed = inspect(raw, scope);
  if (!exact(raw.totals, totalFields) || totalFields.some(key => raw.totals[key] !== parsed.totals[key])) fail('WIS_STOCK_BOARD_TOTALS_INVALID');
  return { ...empty, status: 'READY', revision: raw.revision, asOfMs: raw.asOfMs,
    sourceRevision: raw.sourceRevision, priceRevision: raw.priceRevision, ...parsed };
}
// Future trusted writer: build ALL rows for this scope from canonical stock
// accounts and filled positions at ONE source/price revision, then atomically
// publish matching all/class projections. Missing source rows must fail before
// calling this helper. A confirmed worthless holding may have value zero; a
// missing price must never be substituted with zero to complete the feed.
// Never derive students from general-Wis wallets or copy
// private market fields, email, auth UID, ledger entries or order bodies here.
export function buildWisStockInvestmentBoard(input) {
  if (!record(input)) fail();
  const scope = normalizeWisStockInvestmentBoardScope(input.scope);
  const raw = { schemaVersion: 1, status: 'READY', source: 'CANONICAL_STOCK_LEDGER', complete: true,
    semesterId: scope.semesterId, grade: scope.grade, classNumber: scope.classNumber,
    revision: input.revision, asOfMs: input.asOfMs, sourceRevision: input.sourceRevision, priceRevision: input.priceRevision,
    classes: input.classes, rows: input.rows, totals: {} };
  const parsed = inspect(raw, scope);
  raw.classes = parsed.classes;
  raw.rows = parsed.rows.map(row => Object.fromEntries(rowFields.map(key => [key, row[key]])));
  raw.totals = parsed.totals;
  parseWisStockInvestmentBoardSnapshot(raw, scope);
  return raw;
}
