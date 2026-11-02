const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { TYPE, noticeId, createStudentRegistrationNotificationService,
  createStudentRegistrationNotificationTriggers } = require('../studentRegistrationNotifications');

const root = 'years/2026/semesters/2';
const student = { role: 'student', email: 'applicant@yongshin-ms.ms.kr', name: '테스트',
  grade: '3', class: '2', number: '15', registrationApprovalStatus: 'PENDING' };
const inboxPath = recipient => `${root}/notification_inboxes/${recipient}`;
const itemPath = recipient => `${inboxPath(recipient)}/items/${noticeId('student')}`;
const receiptPath = `${root}/student_registration_notification_receipts/${noticeId('student')}`;

const fixture = (overrides = {}) => {
  const values = new Map(), versions = new Map(), writes = [];
  let beforeCommit, clock = 100000;
  const put = (path, data) => {
    values.set(path, data); versions.set(path, (versions.get(path) || 0) + 1);
    const collection = path.split('/').slice(0, -1).join('/');
    versions.set(collection, (versions.get(collection) || 0) + 1);
  };
  const ref = path => ({ path, get: async () => snapshot(path) });
  const snapshot = path => ({ ref: ref(path), id: path.split('/').at(-1), exists: values.has(path), data: () => values.get(path) });
  const query = (path, filters = [], bound = 10000) => ({ path, query: true,
    where: (field, operator, value) => query(path, [...filters, { field, operator, value }], bound),
    limit: count => query(path, filters, count),
    get: async () => ({ docs: [...values.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map(snapshot).filter(row => filters.every(f => f.operator === '==' ? row.data()?.[f.field] === f.value : f.value.includes(row.data()?.[f.field])))
      .slice(0, bound) }),
  });
  const db = { doc: ref, collection: query, runTransaction: async run => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map(), pending = [];
      const get = async target => {
        assert.equal(pending.length, 0, 'All canonical, permission, receipt, inbox and item reads precede writes');
        reads.set(target.path, versions.get(target.path) || 0);
        return target.query ? target.get() : snapshot(target.path);
      };
      const result = await run({ get, getAll: (...targets) => Promise.all(targets.map(get)),
        set: (target, data, options) => pending.push({ path: target.path, data, options }),
        delete: target => pending.push({ path: target.path, remove: true }) });
      if (beforeCommit) { const hook = beforeCommit; beforeCommit = undefined; hook(); }
      if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
      for (const write of pending) {
        writes.push(write);
        if (write.remove) values.delete(write.path);
        else put(write.path, write.options?.merge ? { ...values.get(write.path), ...write.data } : write.data);
      }
      return result;
    }
    throw new Error('Fixture transaction retry exceeded');
  } };
  Object.entries({
    'users/student': { ...student },
    'users/teacher': { role: 'teacher', email: 'teacher@yongshin-ms.ms.kr' },
    'users/staff': { role: 'staff', email: 'staff@yongshin-ms.ms.kr', staffPermissions: ['student_list_read'] },
    'users/external': { role: 'teacher', email: 'external@example.com' },
    'users/disabled': { role: 'teacher', email: 'disabled@yongshin-ms.ms.kr', disabled: true },
    'users/deleted': { role: 'teacher', email: 'deleted@yongshin-ms.ms.kr', isDeleted: true },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 4 },
    'semester_manifests/2026-2': { semesterId: '2026-2', revision: 4, status: 'ACTIVE' },
    ...overrides,
  }).forEach(([path, data]) => put(path, data));
  const service = createStudentRegistrationNotificationService({ db, resolveAdminUid: async () => 'admin', now: () => clock });
  const event = (before, after) => ({ params: { uid: 'student' }, data: {
    before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after },
  } });
  return { values, writes, put, db, service, event, tick: () => { clock += 1000; },
    race: hook => { beforeCommit = hook; } };
};

(async () => {
  const f = fixture();
  const dry = await f.service.reconcilePending({ expectedSemesterId: '2026-2' });
  assert.equal(dry.created, 2); assert.equal(f.writes.length, 0, 'Backfill defaults to read-only');
  assert.deepEqual(await f.service.handleUserWritten(f.event(null, student)), { status: 'pending', created: 2, updated: 0, applied: true });
  for (const recipient of ['admin', 'teacher']) {
    const notice = f.values.get(itemPath(recipient));
    assert.equal(notice.type, TYPE); assert.equal(notice.targetUrl, '/teacher/students?registration=student');
    assert.equal(notice.priority, 'high'); assert.equal(notice.readAt, null);
    assert.equal(f.values.get(inboxPath(recipient)).unreadCount, 1);
    assert(notice.createdAt instanceof Timestamp); assert(notice.expiresAt.toMillis() > notice.createdAt.toMillis());
    assert(!JSON.stringify(notice).includes(student.email), 'Notification omits student email');
  }
  assert.deepEqual(f.values.get('users/student'), student, 'Notification never grants access or changes application');
  assert(!f.writes.some(write => /broadcast_notifications|notification_inboxes\/(staff|external|disabled|deleted)\//.test(write.path)));
  const count = f.writes.length;
  assert.equal((await f.service.handleUserWritten(f.event(null, student))).status, 'unchanged');
  assert.equal(f.writes.length, count, 'Duplicate event increments no counter');
  assert.equal(await f.service.handleUserWritten(f.event(student, { ...student, lastLogin: 1234 })), null);
  assert.equal((await f.service.reconcilePending({ apply: true, expectedSemesterId: '2026-2' })).unchanged, 1);

  f.values.delete(itemPath('teacher'));
  f.put(inboxPath('teacher'), { unreadCount: 0 });
  f.put('users/student', { ...student, name: '수정된 이름' });
  f.tick();
  assert.equal((await f.service.reconcileStudent('student')).updated, 1);
  assert(!f.values.has(itemPath('teacher')), 'Cleared item is never recreated on profile update or retry');
  assert.equal(f.values.get(inboxPath('admin')).unreadCount, 1);
  f.put('users/student', { ...student, registrationApprovalStatus: 'APPROVED_PENDING_ACCOUNT', approvedSemesterId: '2026-2' });
  await f.service.reconcileStudent('student');
  assert.equal(f.values.get(itemPath('admin')).registrationStatus, 'APPROVED_PENDING_ACCOUNT');
  assert.equal(f.values.get(inboxPath('admin')).unreadCount, 1, 'Interrupted approval stays actionable');
  f.put('users/student', { ...student, registrationApprovalStatus: 'APPROVED', approvedSemesterId: '2026-2' });
  f.tick();
  await f.service.reconcileStudent('student');
  assert.equal(f.values.get(inboxPath('admin')).unreadCount, 0);
  assert(f.values.get(itemPath('admin')).readAt);
  assert.equal(f.values.get(receiptPath).status, 'APPROVED');
  assert.equal((await f.service.handleUserWritten(f.event(null, student))).status, 'unchanged', 'Delayed PENDING event reads latest approved state');

  const rejected = fixture();
  await rejected.service.reconcileStudent('student');
  rejected.put(inboxPath('admin'), { unreadCount: 8 });
  rejected.put(itemPath('teacher'), { ...rejected.values.get(itemPath('teacher')), readAt: Timestamp.fromMillis(10) });
  rejected.put(inboxPath('teacher'), { unreadCount: 4 });
  rejected.put('users/student', { ...student, registrationApprovalStatus: 'REJECTED' });
  await rejected.service.handleUserWritten(rejected.event(student, { ...student, registrationApprovalStatus: 'REJECTED' }));
  assert.equal(rejected.values.get(inboxPath('admin')).unreadCount, 7, 'Other unseen arrivals remain unread');
  assert.equal(rejected.values.get(inboxPath('teacher')).unreadCount, 4, 'Already read item does not decrement twice');
  assert.equal(rejected.values.get(itemPath('admin')).registrationStatus, 'REJECTED');

  for (const [path, value, reason] of [
    ['site_settings/semester_active', {}, 'active_semester_unavailable'],
    ['semester_manifests/2026-2', { semesterId: '2026-2', revision: 5, status: 'ACTIVE' }, 'active_semester_unavailable'],
    ['semester_manifests/2026-2', { semesterId: '2026-2', revision: 4, status: 'ARCHIVED' }, 'active_semester_unavailable'],
    ['users/student', { ...student, role: 'teacher' }, 'not_pending'],
    ['users/student', { ...student, email: 'outsider@example.com' }, 'not_pending'],
    ['users/student', { ...student, registrationApprovalStatus: 'REJECTED' }, 'not_pending'],
    ['users/student', { ...student, registrationApprovalStatus: undefined }, 'not_pending'],
    ['users/student', { ...student, registrationApprovalStatus: 'APPROVED_PENDING_ACCOUNT', approvedSemesterId: '2026-1' }, 'not_pending'],
  ]) {
    const denied = fixture({ [path]: value });
    assert.equal((await denied.service.reconcileStudent('student')).reason, reason); assert.equal(denied.writes.length, 0);
  }
  const stale = fixture();
  assert.equal((await stale.service.reconcileStudent('student', { expectedSemesterId: '2026-1' })).reason, 'semester_changed');
  assert.equal(stale.writes.length, 0);
  stale.race(() => stale.put('users/student', { ...student, registrationApprovalStatus: 'REJECTED' }));
  assert.equal((await stale.service.reconcileStudent('student')).reason, 'not_pending');
  assert.equal(stale.writes.length, 0, 'Concurrent rejection prevents stale signup alerts');
  const cutover = fixture({ 'site_settings/semester_active': {} });
  await assert.rejects(() => cutover.service.handleUserWritten(cutover.event(null, student)), /SEMESTER_UNAVAILABLE/);
  assert.equal(cutover.writes.length, 0, 'A transient cutover retries instead of dropping a signup event');

  const revoked = fixture();
  revoked.race(() => revoked.put('users/teacher', { role: 'student', email: 'teacher@yongshin-ms.ms.kr' }));
  assert.equal((await revoked.service.reconcileStudent('student')).created, 1);
  assert(!revoked.values.has(itemPath('teacher')), 'Concurrent teacher-role revocation is rechecked transactionally');
  const changedRecipient = fixture();
  await changedRecipient.service.reconcileStudent('student');
  const previousUpdate = changedRecipient.values.get(inboxPath('admin')).updatedAt.toMillis();
  changedRecipient.put('users/teacher', { role: 'student', email: 'teacher@yongshin-ms.ms.kr' });
  changedRecipient.put('users/student', { ...student, name: '변경된 이름' });
  await changedRecipient.service.reconcileStudent('student');
  assert(!changedRecipient.values.has(itemPath('teacher')), 'Demoted teacher receives no changed applicant information');
  assert.equal(changedRecipient.values.get(inboxPath('teacher')).unreadCount, 0);
  assert(changedRecipient.values.get(inboxPath('admin')).updatedAt.toMillis() > previousUpdate,
    'Same-millisecond updates still refresh an already open notification center');
  const absent = fixture({ 'users/teacher': { role: 'teacher', email: 'teacher@example.com' } });
  const noRecipient = createStudentRegistrationNotificationService({ db: absent.db });
  await assert.rejects(() => noRecipient.reconcileStudent('student'), /RECIPIENTS_UNAVAILABLE/);
  assert.equal(absent.writes.length, 0);

  const registrations = [];
  const triggers = createStudentRegistrationNotificationTriggers({ db: fixture().db,
    auth: { getUserByEmail: async email => { assert.equal(email, 'westoria28@gmail.com'); return { uid: 'admin', emailVerified: true }; } },
    register: (options, handler) => { registrations.push({ options, handler }); return handler; } });
  assert.equal(typeof triggers.notifyStudentRegistrationOnUserWrite, 'function');
  assert.equal(registrations[0].options.document, 'users/{uid}');
  assert.equal(registrations[0].options.retry, true);
  assert.equal(registrations[0].options.region, 'us-central1');
  await registrations[0].handler({ params: { uid: 'student' }, data: { after: { exists: true, data: () => student } } });
  console.log('PASS registration notifications: teacher/admin recipients, personal live inbox, scope, backfill, duplicates, clear, approval/rejection, stale events and concurrent role/status changes');
})().catch(error => { console.error(error); process.exitCode = 1; });
