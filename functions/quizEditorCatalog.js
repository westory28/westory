const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const MAX_CATALOG_ENTRIES = 5000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
// A projection reduces payload bytes, not billed document reads. The editor
// loads this catalog once per visit and retrieves only the visible body IDs.
const CATALOG_FIELDS = Object.freeze([
  'id', 'unitId', 'subUnitId', 'category', 'type', 'refBig', 'refMid', 'refSmall',
  'createdAt', 'updatedAt', 'contentRevision', 'question', 'explanation',
  'passage', 'concepts',
]);

const fail = (code, message, reason) => {
  throw new HttpsError(code, message, { reason });
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizeQuery = (data) => {
  if (!isRecord(data) || Object.keys(data).some((key) => !['semesterId', 'unitId', '_session'].includes(key))
    || typeof data.semesterId !== 'string' || !/^\d{4}-[12]$/.test(data.semesterId)
    || typeof data.unitId !== 'string' || !data.unitId.trim() || data.unitId.length > 160
    || data.unitId !== data.unitId.trim() || /[\x00-\x1f/]/.test(data.unitId)
    || ['.', '..'].includes(data.unitId)) {
    fail('invalid-argument', '조회할 학기와 단원을 확인해 주세요.', 'QUIZ_CATALOG_QUERY_INVALID');
  }
  return { semesterId: data.semesterId, unitId: data.unitId };
};
const timestampMs = (value) => {
  const result = typeof value?.toMillis === 'function' ? value.toMillis()
    : value instanceof Date ? value.getTime()
      : typeof value === 'number' ? value
        : typeof value?.seconds === 'number'
          ? value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6)
          : 0;
  return Number.isFinite(result) ? result : 0;
};
const catalogEntry = (document) => {
  const value = document.data() || {};
  const id = Number(value.id ?? document.id);
  if (!Number.isSafeInteger(id) || id < 0) {
    fail('failed-precondition', '숫자 문항 번호가 없는 자료가 있어 목록을 열지 못했습니다.', 'QUIZ_CATALOG_ID_INVALID');
  }
  return {
    documentId: document.id,
    id,
    unitId: String(value.unitId || ''),
    subUnitId: value.subUnitId == null ? null : String(value.subUnitId),
    category: String(value.category || ''),
    type: String(value.type || ''),
    refBig: String(value.refBig || ''),
    refMid: String(value.refMid || ''),
    refSmall: String(value.refSmall || ''),
    createdAt: timestampMs(value.createdAt),
    updatedAt: timestampMs(value.updatedAt),
    contentRevision: Number(value.contentRevision || 0),
    // Preserve the editor's complete substring-search contract. No truncation,
    // tokenization or stripping markup that could silently hide search matches.
    searchText: [value.question, value.explanation, value.passage,
      ...(Array.isArray(value.concepts) ? value.concepts : [])].join(' ').toLowerCase(),
  };
};

const assertCurrentScope = (query, config, pointer, manifest) => {
  const scope = `${config?.year}-${config?.semester}`;
  if (scope !== query.semesterId || config?.activeSemesterId !== query.semesterId
    || pointer?.semesterId !== query.semesterId || manifest?.semesterId !== query.semesterId
    || manifest?.status !== 'ACTIVE' || manifest?.readOnly === true
    || !Number.isSafeInteger(manifest?.revision) || manifest.revision < 1
    || pointer?.revision !== manifest.revision) {
    fail('failed-precondition', '현재 운영 학기에서 문제 목록을 다시 열어 주세요.', 'QUIZ_CATALOG_SEMESTER_NOT_ACTIVE');
  }
};

const createQuizEditorCatalogHandler = ({ db, assertSession = assertScoreWorkflowSession }) => async (request) => {
  const identity = await assertSession(request, { recentAuth: false, highRisk: false });
  if (!identity?.uid || identity.uid !== request.auth?.uid) {
    fail('unauthenticated', '로그인 세션을 확인해 주세요.', 'QUIZ_CATALOG_SESSION_INVALID');
  }
  const query = normalizeQuery(request.data);
  const profile = (await db.doc(`users/${identity.uid}`).get()).data() || {};
  const admin = String(identity.email || '').toLowerCase() === ADMIN_EMAIL
    && String(request.auth?.token?.email || '').toLowerCase() === ADMIN_EMAIL;
  if (!admin && profile.role !== 'teacher'
    && !(profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions)
      && profile.staffPermissions.includes('quiz_read'))) {
    fail('permission-denied', '평가 문항 조회 권한이 필요합니다.', 'QUIZ_CATALOG_READ_FORBIDDEN');
  }
  const [config, pointer, manifest] = await db.getAll(
    db.doc('site_settings/config'), db.doc('site_settings/semester_active'),
    db.doc(`semester_manifests/${query.semesterId}`),
  );
  assertCurrentScope(query, config.data(), pointer.data(), manifest.data());
  const [year, semester] = query.semesterId.split('-');
  const stream = db.collection(`years/${year}/semesters/${semester}/quiz_questions`)
    .where('unitId', '==', query.unitId)
    .select(...CATALOG_FIELDS)
    .limit(MAX_CATALOG_ENTRIES + 1)
    .stream();
  const entries = [];
  // Stream the one bounded projection query so unusually long source text
  // cannot fill the function's memory before the response-size guard runs.
  let bytes = 1024;
  try {
    for await (const document of stream) {
      if (entries.length === MAX_CATALOG_ENTRIES) {
        fail('resource-exhausted', '단원 문항 수가 목록 조회 한도를 초과했습니다.', 'QUIZ_CATALOG_TOO_LARGE');
      }
      const entry = catalogEntry(document);
      bytes += Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      if (bytes > MAX_CATALOG_BYTES) {
        fail('resource-exhausted', '검색 자료가 너무 커 목록을 한 번에 불러오지 못했습니다.', 'QUIZ_CATALOG_TOO_LARGE');
      }
      entries.push(entry);
    }
  } finally {
    stream.destroy();
  }
  entries.sort((left, right) => left.id - right.id || left.documentId.localeCompare(right.documentId));
  return { semesterId: query.semesterId, unitId: query.unitId, entries };
};

module.exports = {
  CATALOG_FIELDS, MAX_CATALOG_ENTRIES, MAX_CATALOG_BYTES,
  normalizeQuery, catalogEntry, createQuizEditorCatalogHandler,
};
