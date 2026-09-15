const { createHash } = require('node:crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const GENERATION = 'w1r2-2026-08-09';
const MODES = ['ENFORCE', 'OBSERVE_ONLY', 'DISABLED'];
const PERIODS = ['', 'allDay', 'beforeCheck', 'check', 'period1', 'period2', 'period3', 'period4', 'period5', 'period6', 'period7', 'closing', 'afterSchool'];
const PERIOD_LABELS = ['', '하루종일', '조회 전', '조회', '1교시', '2교시', '3교시', '4교시', '5교시', '6교시', '7교시', '종례', '방과 후'];
const TARGET_CLASS = /^[1-9]\d{0,3}-[1-9]\d{0,3}$/;
const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };
const invalid = (field) => fail('invalid-argument', 'CALENDAR_INPUT_INVALID', `${field} 입력을 확인해 주세요.`);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, field, max, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) invalid(field);
  return value.trim();
};
const identifier = (value, field) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalid(field);
  return value;
};
const date = (value, field) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(field);
  return value;
};
const color = (value) => {
  if (typeof value !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value)) invalid('라벨 색상');
  return value.toLowerCase();
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function normalizeEvent(input) {
  if (!record(input)) invalid('일정');
  const allowed = ['title', 'start', 'end', 'allDay', 'startPeriod', 'endPeriod', 'period', 'description', 'eventType', 'labelColor', 'targetType', 'targetClass'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid('일정 항목');
  const event = { ...input, title: text(input.title, '제목', 200), start: date(input.start, '시작일'), end: date(input.end || input.start, '종료일') };
  if (event.end < event.start || new Date(event.end) - new Date(event.start) > 366 * 86400000) invalid('일정 기간');
  event.eventType = identifier(input.eventType, '일정 종류');
  if (event.eventType === 'holiday') fail('permission-denied', 'HOLIDAY_MANAGED', '공휴일은 공휴일 동기화로 관리해 주세요.');
  if (!['common', 'class', 'all'].includes(input.targetType)) invalid('공개 대상');
  // The school configuration can provide grades beyond the middle-school default 1–3.
  if (input.targetType === 'class' && (typeof input.targetClass !== 'string' || !TARGET_CLASS.test(input.targetClass))) invalid('대상 학급');
  if (input.targetClass != null && (typeof input.targetClass !== 'string' || (input.targetClass !== '' && !TARGET_CLASS.test(input.targetClass)))) invalid('대상 학급');
  if ('allDay' in input && typeof input.allDay !== 'boolean') invalid('종일 여부');
  if ('description' in input) event.description = text(input.description, '설명', 10000, true);
  if ('labelColor' in input) event.labelColor = input.labelColor === '' ? '' : color(input.labelColor);
  for (const key of ['period', 'startPeriod', 'endPeriod']) {
    if (!(key in input)) continue;
    if (!PERIODS.includes(input[key]) && !PERIOD_LABELS.includes(input[key])) invalid('교시');
    event[key] = PERIOD_LABELS.includes(input[key]) ? PERIODS[PERIOD_LABELS.indexOf(input[key])] : input[key];
  }
  const startPeriod = event.startPeriod || event.period;
  const endPeriod = event.endPeriod || startPeriod;
  if (event.start === event.end && startPeriod && endPeriod && ![startPeriod, endPeriod].includes('allDay') && PERIODS.indexOf(endPeriod) < PERIODS.indexOf(startPeriod)) invalid('종료 교시');
  return event;
}

function normalizeCategories(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50 || !items.some((item) => record(item) && item.hidden !== true)) invalid('표시할 일정 종류');
  const seen = new Set();
  return items.map((item) => {
    if (!record(item) || Object.keys(item).some((key) => !['key', 'label', 'color', 'emoji', 'order', 'hidden', 'locked'].includes(key))) invalid('일정 종류');
    const key = identifier(item.key, '종류 식별자');
    if (seen.has(key) || key === 'holiday') invalid('종류 식별자');
    seen.add(key);
    if (!Number.isInteger(item.order) || item.order < 0 || item.order > 10000) invalid('종류 순서');
    for (const flag of ['hidden', 'locked']) if (flag in item && typeof item[flag] !== 'boolean') invalid('종류 설정');
    return { ...item, key, label: text(item.label, '종류 이름', 100), color: color(item.color), emoji: text(item.emoji, '종류 아이콘', 24, true) };
  });
}

function normalizeHolidays(items, year) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 64) invalid('공휴일 목록');
  const seen = new Set();
  return items.map((item) => {
    if (!record(item) || Object.keys(item).some((key) => !['title', 'start', 'source'].includes(key))) invalid('공휴일');
    const title = text(item.title, '공휴일 이름', 100);
    const start = date(item.start, '공휴일 날짜');
    if (!start.startsWith(`${year}-`) || !['generated', 'kasi'].includes(item.source)) invalid('공휴일');
    const id = `holiday_${start}_${title.normalize('NFKC').replace(/[^\p{L}\p{N}-]+/gu, '').slice(0, 60)}`;
    if (seen.has(id)) invalid('중복 공휴일');
    seen.add(id);
    return { id, title, start, end: start, eventType: 'holiday', targetType: 'common', targetClass: null, holidaySource: item.source,
      description: item.source === 'kasi' ? '한국천문연구원 특일 정보 기준 공휴일' : '대한민국 공휴일 규칙 기준 자동 생성' };
  });
}

function createAcademicCalendarHandler({ db, now = Date.now, environment = process.env }) {
  return async (request) => {
    const uid = request.auth?.uid;
    const token = request.auth?.token;
    if (typeof uid !== 'string' || !uid || uid.includes('/') || !Number.isInteger(token?.auth_time) || token.auth_time <= 0) fail('unauthenticated', 'SESSION_AUTH_REQUIRED', '다시 로그인한 뒤 저장해 주세요.');
    // Keep the deployed legacy calendar's administrator-only write authority.
    if (token.email !== 'westoria28@gmail.com') fail('permission-denied', 'CALENDAR_ADMIN_REQUIRED', '학사 일정은 관리자만 변경할 수 있습니다.');
    const idleMode = String(environment.WESTORY_SESSION_IDLE_MODE || 'OBSERVE_ONLY').trim().toUpperCase();
    const appMode = String(environment.WESTORY_APP_CHECK_MODE || 'OBSERVE_ONLY').trim().toUpperCase();
    if (!MODES.includes(idleMode) || !MODES.includes(appMode)) fail('unavailable', 'SESSION_AUTHORITY_CONFIG_INVALID', '세션 설정을 확인해야 합니다.');
    if (appMode === 'ENFORCE' && !request.app?.appId) fail('unauthenticated', 'APP_CHECK_REQUIRED', '앱 인증을 확인한 뒤 다시 시도해 주세요.');
    const data = request.data;
    if (!record(data) || !['SAVE_EVENT', 'DELETE_EVENT', 'SAVE_CATEGORIES', 'SYNC_HOLIDAYS'].includes(data.action)) invalid('작업');
    const actionFields = {
      SAVE_EVENT: ['event', 'eventId', 'expectedRevision'],
      DELETE_EVENT: ['eventId', 'expectedRevision'],
      SAVE_CATEGORIES: ['items'],
      SYNC_HOLIDAYS: ['holidays'],
    };
    const allowedFields = ['action', 'year', 'semester', 'requestId', '_session', ...actionFields[data.action]];
    if (Object.keys(data).some((key) => !allowedFields.includes(key))) invalid('요청 항목');
    const year = String(data.year), semester = String(data.semester);
    if (!/^\d{4}$/.test(year) || !['1', '2'].includes(semester)) invalid('학기');
    const requestId = identifier(data.requestId, '요청 식별자');
    if (requestId.length > 100) invalid('요청 식별자');
    const eventId = data.eventId == null ? `event_${requestId}` : identifier(data.eventId, '일정 식별자');
    if (data.action === 'DELETE_EVENT' && !data.eventId) invalid('일정 식별자');
    const expectedRevision = data.expectedRevision ?? 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid('일정 버전');
    const event = data.action === 'SAVE_EVENT' ? normalizeEvent(data.event) : null;
    const items = data.action === 'SAVE_CATEGORIES' ? normalizeCategories(data.items) : null;
    const holidays = data.action === 'SYNC_HOLIDAYS' ? normalizeHolidays(data.holidays, year) : null;
    const { _session, ...hashPayload } = data;
    const payloadHash = hash(hashPayload);
    const receiptRef = db.doc(`academic_calendar_requests/${hash([uid, requestId])}`);
    const calendarPath = `years/${year}/semesters/${semester}/calendar`;
    const targetRef = data.action === 'SAVE_CATEGORIES' ? db.doc('site_settings/schedule_categories') : db.doc(`${calendarPath}/${eventId}`);
    return db.runTransaction(async (transaction) => {
      // All authority and scope reads are inside the transaction, including retries.
      const refs = [db.doc(`application_sessions/${uid}/sessions/${token.auth_time}`), db.doc('site_settings/config'), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${year}-${semester}`), receiptRef];
      const [sessionSnap, configSnap, pointerSnap, manifestSnap, receiptSnap] = await transaction.getAll(...refs);
      const session = sessionSnap.data() || {};
      if (!sessionSnap.exists || session.status !== 'active' || session.authTime !== token.auth_time) fail('unauthenticated', 'SESSION_EXPIRED', '세션이 만료되었습니다. 다시 로그인해 주세요.');
      if (session.schemaVersion !== 2 || session.authorityGeneration !== GENERATION || !Number.isInteger(session.protocolVersion) || session.protocolVersion < 2 || typeof session.sessionRevision !== 'string' || !/^[a-f0-9]{64}$/.test(session.sessionRevision)) fail('unauthenticated', 'SESSION_PROTOCOL_OUTDATED', '새로고침한 뒤 다시 로그인해 주세요.');
      if (!_session || _session.authorityGeneration !== GENERATION || _session.protocolVersion !== session.protocolVersion || _session.revision !== session.sessionRevision) fail('unauthenticated', 'SESSION_PROOF_INVALID', '로그인 상태를 확인할 수 없습니다. 다시 로그인해 주세요.');
      const expiry = typeof session.generalExpiresAt?.toMillis === 'function' ? session.generalExpiresAt.toMillis() : NaN;
      if (!MODES.includes(session.authorityModeAtOpen) || !Number.isFinite(expiry) || ((idleMode === 'ENFORCE' || session.authorityModeAtOpen === 'ENFORCE') && expiry <= now())) fail('unauthenticated', 'SESSION_EXPIRED', '세션이 만료되었습니다. 다시 로그인해 주세요.');
      // Deployed schedule commands, holiday synchronization, and category settings
      // all require a high-risk session and recent authentication.
      const highRiskExpiry = typeof session.highRiskExpiresAt?.toMillis === 'function' ? session.highRiskExpiresAt.toMillis() : NaN;
      if (!Number.isFinite(highRiskExpiry) || ((idleMode === 'ENFORCE' || session.authorityModeAtOpen === 'ENFORCE') && highRiskExpiry <= now())) fail('unauthenticated', 'SESSION_EXPIRED', '학사 일정을 변경하려면 다시 로그인해 주세요.');
      const authAge = now() - token.auth_time * 1000;
      if (authAge < -60000 || authAge > 300000) fail('failed-precondition', 'RECENT_AUTH_REQUIRED', '학사 일정 변경은 로그인 후 5분 이내에 가능합니다. 다시 로그인한 뒤 변경해 주세요.');
      const config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
      const semesterId = `${year}-${semester}`;
      if (config.year !== year || config.semester !== semester || ('activeSemesterId' in config && config.activeSemesterId !== semesterId) || pointer.semesterId !== semesterId || !Number.isInteger(pointer.revision) || pointer.revision < 0 || manifest.semesterId !== semesterId || manifest.revision !== pointer.revision || manifest.status !== 'ACTIVE' || manifest.readOnly === true) fail('failed-precondition', 'CALENDAR_SCOPE_STALE', '현재 운영 학기가 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.');
      if (receiptSnap.exists) {
        const receipt = receiptSnap.data();
        if (receipt.payloadHash !== payloadHash) fail('already-exists', 'CALENDAR_REQUEST_REUSED', '다른 내용으로 사용된 요청입니다. 다시 저장해 주세요.');
        return receipt.result;
      }
      let result;
      if (holidays) {
        const existing = await transaction.get(db.collection(calendarPath).where('eventType', '==', 'holiday').limit(65));
        if (existing.size > 64) fail('failed-precondition', 'CALENDAR_HOLIDAY_LIMIT', '기존 공휴일 수가 많아 관리자 점검이 필요합니다.');
        const incomingRefs = holidays.map((holiday) => db.doc(`${calendarPath}/${holiday.id}`));
        const incoming = await transaction.getAll(...incomingRefs);
        if (incoming.some((snap) => snap.exists && snap.data().eventType !== 'holiday')) fail('already-exists', 'CALENDAR_HOLIDAY_COLLISION', '공휴일 식별자가 일반 일정과 겹칩니다.');
        const nextIds = new Set(holidays.map((holiday) => holiday.id));
        existing.docs.filter((snap) => !nextIds.has(snap.id)).forEach((snap) => transaction.delete(snap.ref));
        holidays.forEach((holiday, index) => transaction.set(incomingRefs[index], { ...holiday, updatedAt: FieldValue.serverTimestamp(), createdAt: incoming[index].data()?.createdAt || FieldValue.serverTimestamp() }));
        result = { count: holidays.length };
      } else {
        const target = await transaction.get(targetRef);
        const previous = target.data() || {};
        if (items) {
          transaction.set(targetRef, { items, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
          result = { saved: true };
        } else {
          if (previous.eventType === 'holiday' || eventId.startsWith('holiday_')) fail('permission-denied', 'HOLIDAY_MANAGED', '공휴일은 공휴일 동기화로 관리해 주세요.');
          if (data.eventId && !target.exists) fail('not-found', 'CALENDAR_EVENT_MISSING', '일정이 이미 삭제되었습니다. 목록을 새로고침해 주세요.');
          const revision = previous.revision ?? 0;
          if (!Number.isSafeInteger(revision) || revision !== expectedRevision || (!data.eventId && target.exists)) fail('aborted', 'CALENDAR_REVISION_CONFLICT', '다른 변경 사항이 있습니다. 일정을 다시 열어 확인해 주세요.');
          if (data.action === 'DELETE_EVENT') {
            transaction.delete(targetRef);
            result = { deleted: true };
          } else {
            transaction.set(targetRef, { ...event, revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid, ...(target.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: uid }) }, { merge: true });
            result = { eventId, revision: revision + 1 };
          }
        }
      }
      transaction.set(receiptRef, { uid, requestId, payloadHash, result, createdAt: FieldValue.serverTimestamp() });
      return result;
    });
  };
}

exports.createAcademicCalendarHandler = createAcademicCalendarHandler;
exports.manageAcademicCalendar = onCall({ region: 'asia-northeast3' }, (request) => createAcademicCalendarHandler({ db: getFirestore() })(request));
