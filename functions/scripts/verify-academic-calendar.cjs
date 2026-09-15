const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { createAcademicCalendarHandler } = require('../academicCalendar');

const NOW = Date.UTC(2026, 8, 15);
const AUTH_TIME = Math.floor(NOW / 1000) - 60;
const sessionPath = `application_sessions/admin/sessions/${AUTH_TIME}`;
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const event = { title: '수학 수행평가', start: '2026-09-16', end: '2026-09-17', allDay: false, startPeriod: 'period1', endPeriod: 'period2', period: 'period1', description: '', eventType: 'performance', labelColor: '#3b82f6', targetType: 'class', targetClass: '2-1' };
const request = (data = {}) => ({ auth: { uid: 'admin', token: { email: 'westoria28@gmail.com', auth_time: AUTH_TIME } }, data: { action: 'SAVE_EVENT', year: '2026', semester: '2', requestId: 'request-1', _session: proof, ...(!data.action || data.action === 'SAVE_EVENT' ? { event: { ...event } } : {}), ...data } });
function fixture(environment = {}) {
  const docs = new Map(Object.entries({
    [sessionPath]: { status: 'active', authTime: AUTH_TIME, schemaVersion: 2, authorityGeneration: proof.authorityGeneration, protocolVersion: 2, sessionRevision: proof.revision, authorityModeAtOpen: 'ENFORCE', generalExpiresAt: Timestamp.fromMillis(NOW + 60000), highRiskExpiresAt: Timestamp.fromMillis(NOW + 60000) },
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 1 },
    'semester_manifests/2026-2': { semesterId: '2026-2', revision: 1, status: 'ACTIVE' },
  }));
  let writeCount = 0;
  const ref = (path) => ({ path, id: path.split('/').pop() });
  const snap = (item) => ({ ...item, ref: item, exists: docs.has(item.path), data: () => docs.get(item.path) });
  const reads = [];
  const db = {
    doc: ref,
    collection: (path) => ({ where: (field, operator, value) => ({ limit: (limit) => ({ path, field, value, limit, query: true }) }) }),
    async runTransaction(handler) {
      const pending = [];
      const tx = {
        async get(item) {
          assert.equal(pending.length, 0, 'Firestore disallows reads after writes');
          reads.push(item.path);
          if (!item.query) return snap(item);
          const matches = [...docs.keys()].filter((path) => path.startsWith(`${item.path}/`) && path.slice(item.path.length + 1).indexOf('/') < 0 && docs.get(path)[item.field] === item.value).slice(0, item.limit).map((path) => snap(ref(path)));
          return { docs: matches, size: matches.length };
        },
        async getAll(...items) { return Promise.all(items.map((item) => tx.get(item))); },
        set(item, value, options) { pending.push(() => docs.set(item.path, options?.merge ? { ...docs.get(item.path), ...value } : value)); },
        delete(item) { pending.push(() => docs.delete(item.path)); },
      };
      const result = await handler(tx);
      pending.forEach((write) => write());
      writeCount += pending.length;
      return result;
    },
  };
  return { docs, reads, get writes() { return writeCount; }, handler: createAcademicCalendarHandler({ db, now: () => NOW, environment }) };
}
let checks = 0;
async function rejects(mutate, code, reason, data = {}) {
  const f = fixture(); const req = request(data); mutate(f, req);
  await assert.rejects(() => f.handler(req), (error) => error.code === code && (!reason || error.details?.reason === reason));
  assert.equal(f.writes, 0); checks++;
}
async function main() {
  const f = fixture();
  const created = await f.handler(request());
  assert.deepEqual(created, { eventId: 'event_request-1', revision: 1 });
  const eventPath = `years/2026/semesters/2/calendar/${created.eventId}`;
  assert.equal(f.docs.get(eventPath).labelColor, '#3b82f6');
  const writes = f.writes;
  assert.deepEqual(await f.handler(request()), created);
  assert.equal(f.writes, writes, 'retry must not write twice');
  assert.equal(f.reads.filter((path) => path === sessionPath).length, 2, 'retry must recheck session'); checks += 3;
  const nextProof = { ...proof, revision: 'b'.repeat(64) };
  f.docs.get(sessionPath).sessionRevision = nextProof.revision;
  assert.deepEqual(await f.handler(request({ _session: nextProof })), created, 'session proof excluded from hash'); checks++;
  f.docs.get(sessionPath).sessionRevision = proof.revision;
  await assert.rejects(() => f.handler(request({ event: { ...event, title: 'changed' } })), (error) => error.details.reason === 'CALENDAR_REQUEST_REUSED'); checks++;
  f.docs.get(eventPath).legacyMetadata = 'preserved';
  assert.deepEqual(await f.handler(request({ requestId: 'edit', eventId: created.eventId, expectedRevision: 1, event: { ...event, title: '수정' } })), { eventId: created.eventId, revision: 2 });
  assert.equal(f.docs.get(eventPath).legacyMetadata, 'preserved'); checks++;
  await assert.rejects(() => f.handler(request({ requestId: 'conflict', eventId: created.eventId, expectedRevision: 1 })), (error) => error.code === 'aborted'); checks++;
  assert.deepEqual(await f.handler(request({ action: 'DELETE_EVENT', requestId: 'delete', eventId: created.eventId, expectedRevision: 2 })), { deleted: true });
  assert.equal(f.docs.has(eventPath), false); checks++;
  const legacy = fixture(); legacy.docs.set('years/2026/semesters/2/calendar/legacy', { ...event, legacyMetadata: 42 });
  await legacy.handler(request({ eventId: 'legacy' }));
  assert.equal(legacy.docs.get('years/2026/semesters/2/calendar/legacy').revision, 1); checks++;
  const categories = [{ key: 'exam', label: '시험', color: '#ef4444', emoji: '🔴', order: 0, hidden: true, locked: true }, { key: 'event', label: '행사', color: '#22c55e', emoji: '🟢', order: 1 }];
  assert.deepEqual(await f.handler(request({ action: 'SAVE_CATEGORIES', requestId: 'categories', items: categories })), { saved: true });
  assert.deepEqual(f.docs.get('site_settings/schedule_categories').items, categories); checks++;
  await rejects((f) => { delete f.docs.get(sessionPath).highRiskExpiresAt; }, 'unauthenticated', 'SESSION_EXPIRED', { action: 'SAVE_CATEGORIES', items: categories });
  await rejects((f) => { f.docs.get(sessionPath).highRiskExpiresAt = Timestamp.fromMillis(NOW - 1); }, 'unauthenticated', 'SESSION_EXPIRED', { action: 'SAVE_CATEGORIES', items: categories });
  for (const authAge of [301, -61]) {
    await rejects((f, req) => {
      const authTime = NOW / 1000 - authAge;
      const session = { ...f.docs.get(sessionPath), authTime };
      f.docs.delete(sessionPath);
      f.docs.set(`application_sessions/admin/sessions/${authTime}`, session);
      req.auth.token.auth_time = authTime;
    }, 'failed-precondition', 'RECENT_AUTH_REQUIRED', { action: 'SAVE_CATEGORIES', items: categories });
  }
  for (const mutation of [{}, { action: 'DELETE_EVENT', eventId: 'existing' }, { action: 'SYNC_HOLIDAYS', holidays: [{ title: '추석', start: '2026-09-25', source: 'generated' }] }]) {
    await rejects((f) => { delete f.docs.get(sessionPath).highRiskExpiresAt; }, 'unauthenticated', 'SESSION_EXPIRED', mutation);
    await rejects((f) => { f.docs.get(sessionPath).highRiskExpiresAt = Timestamp.fromMillis(NOW - 1); }, 'unauthenticated', 'SESSION_EXPIRED', mutation);
    await rejects((f, req) => {
      const authTime = NOW / 1000 - 301;
      const session = { ...f.docs.get(sessionPath), authTime };
      f.docs.delete(sessionPath);
      f.docs.set(`application_sessions/admin/sessions/${authTime}`, session);
      req.auth.token.auth_time = authTime;
    }, 'failed-precondition', 'RECENT_AUTH_REQUIRED', mutation);
  }
  for (const mode of ['OBSERVE_ONLY', 'DISABLED']) {
    const categoryObserver = fixture(); Object.assign(categoryObserver.docs.get(sessionPath), { authorityModeAtOpen: mode, highRiskExpiresAt: Timestamp.fromMillis(NOW - 1) });
    await categoryObserver.handler(request({ action: 'SAVE_CATEGORIES', items: categories })); checks++;
    const categoryEnforced = fixture({ WESTORY_SESSION_IDLE_MODE: 'ENFORCE' }); Object.assign(categoryEnforced.docs.get(sessionPath), { authorityModeAtOpen: mode, highRiskExpiresAt: Timestamp.fromMillis(NOW - 1) });
    await assert.rejects(() => categoryEnforced.handler(request({ action: 'SAVE_CATEGORIES', items: categories })), (error) => error.code === 'unauthenticated'); checks++;
  }
  await rejects((f, req) => { delete req.auth; }, 'unauthenticated');
  await rejects((f, req) => { req.auth.token.email = 'student@yongshin-ms.ms.kr'; }, 'permission-denied', 'CALENDAR_ADMIN_REQUIRED');
  await rejects((f, req) => { req.auth.token.email = 'teacher@yongshin-ms.ms.kr'; }, 'permission-denied');
  await rejects((f, req) => { req.auth.token.auth_time = '1234'; }, 'unauthenticated');
  await rejects((f) => { f.docs.delete(sessionPath); }, 'unauthenticated');
  await rejects((f) => { f.docs.get(sessionPath).status = 'revoked'; }, 'unauthenticated');
  await rejects((f) => { f.docs.get(sessionPath).schemaVersion = 1; }, 'unauthenticated');
  await rejects((f) => { f.docs.get(sessionPath).sessionRevision = 'invalid'; }, 'unauthenticated');
  await rejects((f, req) => { delete req.data._session; }, 'unauthenticated', 'SESSION_PROOF_INVALID');
  await rejects((f, req) => { req.data._session = { ...proof, revision: 'b'.repeat(64) }; }, 'unauthenticated', 'SESSION_PROOF_INVALID');
  await rejects((f) => { f.docs.get(sessionPath).generalExpiresAt = Timestamp.fromMillis(NOW - 1); }, 'unauthenticated');
  await rejects((f) => { f.docs.get(sessionPath).generalExpiresAt = 'tomorrow'; }, 'unauthenticated');
  await rejects((f) => { f.docs.get(sessionPath).authorityModeAtOpen = 'invalid'; }, 'unauthenticated');
  for (const mode of ['OBSERVE_ONLY', 'DISABLED']) {
    const observer = fixture(); Object.assign(observer.docs.get(sessionPath), { authorityModeAtOpen: mode, generalExpiresAt: Timestamp.fromMillis(NOW - 1) });
    await observer.handler(request()); checks++;
    const enforced = fixture({ WESTORY_SESSION_IDLE_MODE: 'ENFORCE' }); Object.assign(enforced.docs.get(sessionPath), { authorityModeAtOpen: mode, generalExpiresAt: Timestamp.fromMillis(NOW - 1) });
    await assert.rejects(() => enforced.handler(request()), (error) => error.code === 'unauthenticated'); checks++;
  }
  const appCheck = fixture({ WESTORY_APP_CHECK_MODE: 'ENFORCE' });
  await assert.rejects(() => appCheck.handler(request()), (error) => error.details.reason === 'APP_CHECK_REQUIRED');
  await appCheck.handler({ ...request(), app: { appId: 'valid-app' } }); checks++;
  for (const [path, patch] of [['site_settings/config', { year: '2025' }], ['site_settings/config', { activeSemesterId: '2025-1' }], ['site_settings/semester_active', { revision: 2 }], ['semester_manifests/2026-2', { status: 'ARCHIVED' }], ['semester_manifests/2026-2', { readOnly: true }]]) {
    await rejects((f) => Object.assign(f.docs.get(path), patch), 'failed-precondition', 'CALENDAR_SCOPE_STALE');
  }
  for (const patch of [{ start: '2026-02-30' }, { end: '2026-09-01' }, { startPeriod: 'fake' }, { labelColor: 'red' }, { targetClass: '0-99' }, { title: ' ' }, { surprise: true }, { eventType: 'holiday' }]) {
    await rejects((f, req) => Object.assign(req.data.event, patch), patch.eventType === 'holiday' ? 'permission-denied' : 'invalid-argument');
  }
  await rejects((f, req) => { req.data.eventId = '../escape'; }, 'invalid-argument');
  await rejects((f) => { f.docs.set('years/2026/semesters/2/calendar/legacy', { eventType: 'holiday' }); }, 'permission-denied', 'HOLIDAY_MANAGED', { eventId: 'legacy' });
  await rejects((f) => { f.docs.set('years/2026/semesters/2/calendar/legacy', { eventType: 'holiday' }); }, 'permission-denied', 'HOLIDAY_MANAGED', { action: 'DELETE_EVENT', eventId: 'legacy' });
  await rejects(() => {}, 'invalid-argument', null, { action: 'SAVE_CATEGORIES', items: [categories[0], categories[0]] });
  await rejects(() => {}, 'invalid-argument', null, { action: 'SAVE_CATEGORIES', items: [] });
  await rejects(() => {}, 'invalid-argument', null, { action: 'SAVE_CATEGORIES', items: [categories[0]] });
  await rejects(() => {}, 'invalid-argument', null, { unexpectedField: true });
  await rejects(() => {}, 'invalid-argument', null, { action: 'SAVE_CATEGORIES', items: categories, event });
  await rejects(() => {}, 'invalid-argument', null, { requestId: 'a'.repeat(101) });
  const longId = fixture();
  longId.docs.get('site_settings/config').activeSemesterId = '2026-2';
  const longCreated = await longId.handler(request({ requestId: 'a'.repeat(100), event: { ...event, targetClass: '6-120' } }));
  assert.equal(longCreated.eventId.length, 106);
  assert.deepEqual(await longId.handler(request({ requestId: 'edit-long', eventId: longCreated.eventId, expectedRevision: 1 })), { eventId: longCreated.eventId, revision: 2 }); checks++;
  const sync = fixture();
  sync.docs.set('years/2026/semesters/2/calendar/old_holiday', { eventType: 'holiday' });
  sync.docs.set('years/2026/semesters/2/calendar/ordinary', { eventType: 'exam', title: '유지' });
  const syncRequest = request({ action: 'SYNC_HOLIDAYS', holidays: [{ title: '추석 연휴', start: '2026-09-24', source: 'generated' }, { title: '추석', start: '2026-09-25', source: 'kasi' }] });
  assert.deepEqual(await sync.handler(syncRequest), { count: 2 });
  assert.equal(sync.docs.has('years/2026/semesters/2/calendar/old_holiday'), false);
  assert.equal(sync.docs.get('years/2026/semesters/2/calendar/ordinary').title, '유지');
  assert.equal(sync.docs.get('years/2026/semesters/2/calendar/holiday_2026-09-24_추석연휴').title, '추석 연휴');
  assert.deepEqual(await sync.handler(syncRequest), { count: 2 }); checks++;
  await rejects((f) => { f.docs.set('years/2026/semesters/2/calendar/holiday_2026-09-24_추석연휴', { eventType: 'exam' }); }, 'already-exists', 'CALENDAR_HOLIDAY_COLLISION', syncRequest.data);
  await rejects(() => {}, 'invalid-argument', null, { action: 'SYNC_HOLIDAYS', holidays: [{ title: '공휴일', start: '2025-09-24', source: 'generated' }] });
  f.docs.get(sessionPath).status = 'revoked';
  await assert.rejects(() => f.handler(request()), (error) => error.code === 'unauthenticated'); checks++;
  const retryScope = fixture(); await retryScope.handler(request()); retryScope.docs.get('semester_manifests/2026-2').status = 'CLOSED';
  await assert.rejects(() => retryScope.handler(request()), (error) => error.details.reason === 'CALENDAR_SCOPE_STALE'); checks++;
  console.log(`Academic calendar callable: ${checks} checks passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
