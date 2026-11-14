const { HttpsError } = require('firebase-functions/v2/https');
const COLLECTION = 'semester_wis_accounts';
const FIELDS = ['accountId', 'semesterId', 'studentUid', 'displayName', 'enrollmentId', 'classId',
  'status', 'provenance', 'readOnly', 'revision', 'balance', 'initialGrantLedgerEntryId', 'grade',
  'classNumber', 'studentNumber', 'earnedTotal', 'rankEarnedTotal', 'spentTotal', 'adjustedTotal', 'lastTransactionAt', 'updatedAt'];
const invalid = () => { throw new HttpsError('invalid-argument', '위스 명단의 검색 조건을 확인해 주세요.', { reason: 'WIS_QUERY_INVALID' }); };
const normalizeWisOverviewQuery = (raw, audience, projection) => {
  if (raw === undefined) return null;
  if (audience !== 'teacher' || projection !== 'overview' || !raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !['grade', 'classNumber', 'studentNumber', 'namePrefix', 'sortField', 'direction'].includes(key))) invalid();
  const result = {};
  for (const key of ['grade', 'classNumber', 'studentNumber']) {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || (value && !/^[1-9]\d{0,2}$/.test(value))) invalid();
    result[key] = value;
  }
  if ((result.classNumber && !result.grade) || (result.studentNumber && !result.classNumber)) invalid();
  result.namePrefix = raw.namePrefix ?? '';
  if (typeof result.namePrefix !== 'string' || result.namePrefix !== result.namePrefix.trim()
    || result.namePrefix.length > 60 || /[\x00-\x1f]/.test(result.namePrefix)) invalid();
  result.sortField = raw.sortField || 'balance';
  result.direction = raw.direction || 'desc';
  if (!['balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal'].includes(result.sortField)
    || !['asc', 'desc'].includes(result.direction)) invalid();
  return result;
};
const matches = (row, scope, filters) => row?.semesterId === scope &&
  ['grade', 'classNumber', 'studentNumber'].every(key => !filters[key] || String(row[key]) === filters[key]) &&
  (!filters.namePrefix || String(row.displayName || '').startsWith(filters.namePrefix));
const queryWisOverviewPage = async (transaction, query) => {
  const selection = query.overview;
  if (!selection || query.limit > 50) invalid();
  const filters = [{ field: 'semesterId', operator: '==', value: query.semesterId }];
  for (const key of ['grade', 'classNumber', 'studentNumber']) {
    if (selection[key]) filters.push({ field: key, operator: '==', value: selection[key] });
  }
  if (selection.namePrefix) {
    filters.push({ field: 'displayName', operator: '>=', value: selection.namePrefix },
      { field: 'displayName', operator: '<=', value: selection.namePrefix + '\uf8ff' });
  }
  const direction = selection.namePrefix ? 'asc' : selection.direction;
  const orderField = selection.namePrefix ? 'displayName' : selection.sortField;
  const revision = Number(query.economyRevision || 0);
  let cursorId = '';
  if (query.cursor) {
    let token;
    try { token = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { invalid(); }
    if (!Array.isArray(token) || token.length !== 6 || token[0] !== 1 || !Number.isSafeInteger(token[1])
      || token[2] !== orderField || token[3] !== direction || typeof token[5] !== 'string'
      || !/^[A-Za-z0-9_-]{1,160}$/.test(token[5])
      || (orderField === 'displayName' ? typeof token[4] !== 'string' || token[4].length > 200 : !Number.isSafeInteger(token[4]))) invalid();
    const changed = () => { throw new HttpsError('failed-precondition', '위스 명단이 변경되었습니다. 첫 페이지부터 다시 확인해 주세요.', { reason: 'WIS_OVERVIEW_PAGE_CHANGED' }); };
    if (token[1] !== revision) changed();
    cursorId = token[5];
    const cursor = await transaction.get(`${COLLECTION}/${cursorId}`);
    if (!cursor.exists || !matches(cursor.data, query.semesterId, selection) || cursor.data[orderField] !== token[4]) changed();
  }
  const rows = await transaction.query(COLLECTION, {
    filters, orderBy: { field: orderField, direction },
    documentIdOrder: 'asc',
    ...(cursorId ? { startAfterPath: `${COLLECTION}/${cursorId}` } : {}),
    fieldMask: FIELDS, limit: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  if (page.some(row => !matches(row.data, query.semesterId, selection))) invalid();
  return { rows: page.map(row => row.data),
    nextCursor: rows.length > query.limit && page.length ? Buffer.from(JSON.stringify([
      1, revision, orderField, direction, page.at(-1).data[orderField], page.at(-1).path.split('/').pop(),
    ])).toString('base64url') : '' };
};
module.exports = { normalizeWisOverviewQuery, queryWisOverviewPage, matchesWisOverview: matches };
