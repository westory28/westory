const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { createStudentAttendanceHandler, accountIdFor, ledgerIdFor } = require('../studentAttendance');

process.env.GCLOUD_PROJECT = 'demo-westory-session-attendance';
process.env.WESTORY_SESSION_IDLE_MODE = 'ENFORCE';
process.env.WESTORY_APP_CHECK_MODE = 'DISABLED';

const UID = 'attendance-student';
const YEAR = '2026';
const SEMESTER = '2';
const TODAY = '2026-09-29';
const NOW = new Date(`${TODAY}T03:00:00Z`);
const AUTH_TIME = Math.floor(NOW.getTime() / 1000) - 60;
const PROOF = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const SESSION_PATH = `application_sessions/${UID}/sessions/${AUTH_TIME}`;
const SCOPE_PATH = `years/${YEAR}/semesters/${SEMESTER}`;
const ATTENDANCE_PATH = `users/${UID}/attendance/${YEAR}_${SEMESTER}_${TODAY}`;
const SCOPE = `${YEAR}-${SEMESTER}`;
const ACCOUNT_ID = accountIdFor(SCOPE, UID);
const ACCOUNT_PATH = `semester_wis_accounts/${ACCOUNT_ID}`;
const SLOT_PATH = `semester_enrollment_slots/slot_${createHash('sha256').update(`${SCOPE}\n${UID}`).digest('hex').slice(0, 40)}`;
const POLICY_PATH = `${SCOPE_PATH}/point_policies/current`;

const clone = (value) => {
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

// A deliberately strict Firestore transaction boundary. Every transaction reads
// a fixed snapshot, rejects reads after writes, and retries optimistic conflicts.
// No Firebase emulator, credentials, or production data is used by this script.
function memoryFirestore(initial) {
  const documents = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  let revision = 0;
  let writeCount = 0;
  let retryCount = 0;
  const reads = [];
  const ref = (path) => ({ path, id: path.split('/').pop(), get: async () => snapshot(ref(path), documents) });
  const snapshot = (item, source) => ({ id: item.id, ref: item, exists: source.has(item.path), data: () => clone(source.get(item.path)) });
  const field = (value, key) => key.split('.').reduce((entry, part) => entry?.[part], value);
  const collection = (path, constraints = [], maximum = Infinity) => ({
    path, query: true, constraints, maximum,
    doc: (id) => ref(`${path}/${id}`),
    where: (key, operator, value) => collection(path, [...constraints, { key, operator, value }], maximum),
    limit: (limit) => collection(path, constraints, limit),
    orderBy: () => collection(path, constraints, maximum),
  });
  const resolveWrite = (value, previous) => {
    if (value?.constructor?.name === 'ServerTimestampTransform') return Timestamp.fromDate(NOW);
    if (value?.constructor?.name === 'NumericIncrementTransform') return Number(previous || 0) + value.operand;
    if (value?.constructor?.name === 'DeleteTransform') return undefined;
    if (Array.isArray(value)) return value.map((item, index) => resolveWrite(item, previous?.[index]));
    if (value && typeof value === 'object' && !(value instanceof Timestamp) && !(value instanceof Date)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveWrite(item, previous?.[key])]));
    }
    return value;
  };
  const db = {
    doc: ref,
    collection,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const startRevision = revision;
        const source = new Map([...documents].map(([key, value]) => [key, clone(value)]));
        const writes = [];
        const transaction = {
          async get(item) {
            assert.equal(writes.length, 0, 'Firestore rejects transaction reads after writes');
            reads.push(item.path);
            if (!item.query) return snapshot(item, source);
            const docs = [...source.keys()].filter((path) => path.startsWith(`${item.path}/`) && !path.slice(item.path.length + 1).includes('/'))
              .filter((path) => item.constraints.every(({ key, operator, value }) => {
                const actual = field(source.get(path), key);
                if (operator === '==') return actual === value;
                if (operator === '>=') return actual >= value;
                if (operator === '<=') return actual <= value;
                if (operator === '>') return actual > value;
                if (operator === '<') return actual < value;
                if (operator === 'in') return value.includes(actual);
                throw new Error(`Unsupported test query operator ${operator}`);
              })).slice(0, item.maximum).map((path) => snapshot(ref(path), source));
            return { docs, size: docs.length, empty: docs.length === 0, forEach: (handler) => docs.forEach(handler) };
          },
          getAll(...items) { return Promise.all(items.map((item) => transaction.get(item))); },
          set(item, value, options) { writes.push({ kind: 'set', item, value, merge: options?.merge }); },
          create(item, value) { writes.push({ kind: 'create', item, value }); },
          update(item, value) { writes.push({ kind: 'update', item, value, merge: true }); },
          delete(item) { writes.push({ kind: 'delete', item }); },
        };
        const result = await callback(transaction);
        if (startRevision !== revision) { retryCount++; continue; }
        for (const write of writes) {
          if (write.kind === 'create') assert.equal(documents.has(write.item.path), false, `Duplicate create: ${write.item.path}`);
          if (write.kind === 'update') assert.equal(documents.has(write.item.path), true, `Missing update: ${write.item.path}`);
        }
        for (const { kind, item, value, merge } of writes) {
          if (kind === 'delete') documents.delete(item.path);
          else documents.set(item.path, { ...(merge ? documents.get(item.path) : {}), ...resolveWrite(value, documents.get(item.path)) });
        }
        if (writes.length) revision++;
        writeCount += writes.length;
        return result;
      }
      throw new Error('Test transaction exceeded retry limit');
    },
  };
  return { db, documents, reads, get writes() { return writeCount; }, get retries() { return retryCount; } };
}

const request = (data = {}) => ({
  auth: { uid: UID, token: { email: 'student@yongshin-ms.ms.kr', auth_time: AUTH_TIME } },
  data: { year: YEAR, semester: SEMESTER, _session: { ...PROOF }, ...data },
});

function fixture({ date = NOW, documents = {}, policy = {} } = {}) {
  const memory = memoryFirestore({
    [SESSION_PATH]: {
      status: 'active', authTime: AUTH_TIME, schemaVersion: 2,
      authorityGeneration: PROOF.authorityGeneration, protocolVersion: 2,
      sessionRevision: PROOF.revision, authorityModeAtOpen: 'ENFORCE',
      generalExpiresAt: Timestamp.fromMillis(date.getTime() + 3600000),
    },
    'site_settings/config': { year: YEAR, semester: SEMESTER },
    'site_settings/semester_active': { semesterId: SCOPE, revision: 1 },
    [`semester_manifests/${SCOPE}`]: { semesterId: SCOPE, revision: 1, status: 'ACTIVE' },
    [`users/${UID}`]: { role: 'student', registrationApprovalStatus: 'APPROVED' },
    [`student_identities/${UID}`]: { studentUid: UID, accountStatus: 'ACTIVE' },
    [SLOT_PATH]: { semesterId: SCOPE, studentUid: UID, activeEnrollmentId: 'enrollment-a', status: 'ACTIVE' },
    'semester_enrollments/enrollment-a': { enrollmentId: 'enrollment-a', semesterId: SCOPE, studentUid: UID, enrollmentStatus: 'ACTIVE', classId: 'class-a' },
    'semester_classes/class-a': { semesterId: SCOPE, classId: 'class-a', status: 'ACTIVE' },
    [ACCOUNT_PATH]: {
      schemaVersion: 1, policyVersion: 'w7-v1', accountId: ACCOUNT_ID, semesterId: SCOPE, studentUid: UID,
      status: 'ACTIVE', enrollmentId: 'enrollment-a', classId: 'class-a', revision: 1,
      balance: 100, earnedTotal: 100, rankEarnedTotal: 100, spentTotal: 0, adjustedTotal: 100,
      displayName: '출석 검증', grade: '1', classNumber: '1', recentLedgerEntries: [],
    },
    [`semester_wis_economies/${SCOPE}`]: { semesterId: SCOPE, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
    [POLICY_PATH]: { attendanceDaily: 75, attendanceMonthlyBonus: 1000, ...policy },
    ...documents,
  });
  memory.handler = createStudentAttendanceHandler({ db: memory.db, now: () => date });
  return memory;
}

const previousDates = (count, ending = TODAY) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${ending}T00:00:00Z`) - (count - index) * 86400000).toISOString().slice(0, 10));
const seedAttendance = (fixture, dates, trusted = true) => dates.forEach((date) => fixture.documents.set(`users/${UID}/attendance/${YEAR}_${SEMESTER}_${date}`, {
  uid: UID, scope: `${YEAR}_${SEMESTER}`, year: YEAR, semester: SEMESTER, date,
  ...(trusted ? { rewardProcessed: true } : {}),
}));
const ledgerRows = (fixture) => [...fixture.documents].filter(([path]) => path.startsWith('semester_wis_ledger/')).map(([, value]) => value);
const checkRejected = async (mutate, code = 'failed-precondition', reason) => {
  const f = fixture(), req = request();
  mutate(f, req);
  await assert.rejects(() => f.handler(req), (error) => error.code === code && (!reason || error.details?.reason === reason));
  assert.equal(f.writes, 0, 'Rejected attendance must not change attendance, balance, ledger or projections');
};

test('normal attendance awards configured 75 Wis in the canonical account, ledger and projections', async () => {
  const f = fixture();
  const result = await f.handler(request());
  assert.equal(result.attendanceRecorded, true);
  assert.equal(result.attendanceDate, TODAY);
  assert.equal(result.amount, 75);
  assert.equal(result.totalAwarded, 75);
  assert.equal(result.balance, 175);
  assert.equal(result.duplicate, false);
  assert.equal(result.claimCount, 1);
  const account = f.documents.get(ACCOUNT_PATH);
  for (const key of ['balance', 'earnedTotal', 'rankEarnedTotal', 'adjustedTotal']) assert.equal(account[key], 175, key);
  assert.equal(account.revision, 2);
  assert.equal(account.spentTotal, 0);
  assert.equal(f.documents.get(`semester_wis_balances/${ACCOUNT_ID}`).balance, 175);
  assert.equal(f.documents.get(`semester_wis_rankings/${ACCOUNT_ID}`).rankEarnedTotal, 175);
  assert.equal(f.documents.get(`semester_wis_economies/${SCOPE}`).ledgerEntryCount, 1);
  const [ledger] = ledgerRows(f);
  assert.equal(ledgerRows(f).length, 1);
  assert.equal(ledger.ledgerEntryId, ledgerIdFor(SCOPE, ACCOUNT_ID, `attendance:${TODAY}`));
  assert.equal(ledger.actorRole, 'system');
  assert.equal(ledger.activityType, 'attendance');
  assert.equal(ledger.delta, 75);
  assert.equal(ledger.balanceBefore, 100);
  assert.equal(ledger.balanceAfter, 175);
  assert.equal(f.documents.get(ATTENDANCE_PATH).rewardProcessed, true);
  assert.deepEqual(f.documents.get(ATTENDANCE_PATH).rewardLedgerIds, [ledger.ledgerEntryId]);
  assert.equal([...f.documents.keys()].some((path) => path.includes('/point_wallets/')), false, 'No retired wallet writes');
});

test('duplicate retry revalidates session but awards nothing and performs no writes', async () => {
  const f = fixture(); await f.handler(request()); const before = f.writes;
  const result = await f.handler(request());
  assert.equal(result.duplicate, true); assert.equal(result.totalAwarded, 0); assert.equal(result.balance, 175);
  assert.equal(f.writes, before); assert.equal(ledgerRows(f).length, 1);
  assert.equal(f.reads.filter((path) => path === SESSION_PATH).length, 2);
  f.documents.get(SESSION_PATH).status = 'revoked';
  await assert.rejects(() => f.handler(request()), (error) => error.code === 'unauthenticated');
  assert.equal(f.writes, before);
});

test('concurrent attendance requests conflict and retry without double payment', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.handler(request())));
  assert.equal(results.reduce((sum, result) => sum + result.totalAwarded, 0), 75);
  assert.equal(results.filter((result) => result.duplicate).length, 7);
  assert.equal(f.documents.get(ACCOUNT_PATH).balance, 175);
  assert.equal(ledgerRows(f).length, 1); assert(f.retries >= 7, 'Concurrent snapshots must retry');
});

test('month end complete attendance pays daily 75 plus monthly 1000 exactly once', async () => {
  const f = fixture({ date: new Date('2026-09-30T03:00:00Z') });
  seedAttendance(f, previousDates(29, '2026-09-30'));
  const result = await f.handler(request());
  assert.equal(result.amount, 75); assert.equal(result.monthlyBonusAmount, 1000); assert.equal(result.totalAwarded, 1075);
  assert.equal(result.balance, 1175); assert.equal(result.claimCount, 30); assert.equal(ledgerRows(f).length, 2);
  assert.equal((await f.handler(request())).totalAwarded, 0);
});

test('missing or forged prior date cannot create a monthly reward', async () => {
  for (const trusted of [true, false]) {
    const f = fixture({ date: new Date('2026-09-30T03:00:00Z') });
    seedAttendance(f, previousDates(trusted ? 28 : 29, '2026-09-30'), trusted);
    const result = await f.handler(request());
    assert.equal(result.monthlyBonusAmount, 0); assert.equal(result.totalAwarded, 75);
  }
});

test('50/100/200/300 attendance milestones pay configured bonuses once', async () => {
  for (const count of [50, 100, 200, 300]) {
    const f = fixture({ policy: { attendanceMilestoneBonusEnabled: true, [`attendanceMilestone${count}`]: 500 } });
    seedAttendance(f, previousDates(count - 1));
    const result = await f.handler(request());
    assert.equal(result.claimCount, count); assert.equal(result.milestoneBonusAmount, 500); assert.equal(result.totalAwarded, 575);
    assert.equal((await f.handler(request())).totalAwarded, 0);
  }
});

test('client-only dates and impossible/future dates do not establish milestone history', async () => {
  const f = fixture({ policy: { attendanceMilestoneBonusEnabled: true, attendanceMilestone50: 500 } });
  seedAttendance(f, previousDates(49), false);
  seedAttendance(f, ['2026-02-30', '2026-09-31', '2026-09-30']);
  const result = await f.handler(request());
  assert.equal(result.claimCount, 1); assert.equal(result.milestoneBonusAmount, 0); assert.equal(result.totalAwarded, 75);
});

test('trusted legacy and canonical attendance history counts, without re-paying an existing daily reward', async () => {
  const f = fixture({ policy: { attendanceMilestoneBonusEnabled: true, attendanceMilestone50: 500 } });
  previousDates(49).forEach((date, index) => {
    const path = index % 2 ? `${SCOPE_PATH}/point_transactions/old-${index}` : `semester_wis_ledger/history-${index}`;
    f.documents.set(path, index % 2 ? { uid: UID, type: 'attendance', sourceId: `attendance-${date}`, targetDate: date } : { studentUid: UID, semesterId: SCOPE, accountId: ACCOUNT_ID, type: 'GRANT', activityType: 'attendance', sourceId: `attendance:${date}`, targetDate: date });
  });
  f.documents.set(`${SCOPE_PATH}/point_transactions/today`, { uid: UID, type: 'attendance', sourceId: `attendance-${TODAY}` });
  const result = await f.handler(request());
  assert.equal(result.amount, 0); assert.equal(result.milestoneBonusAmount, 500); assert.equal(result.totalAwarded, 500);
  assert.equal(f.documents.get(ATTENDANCE_PATH).rewardProcessed, true);
});

test('legacy monthly/milestone rewards are not paid again', async () => {
  const f = fixture({ date: new Date('2026-09-30T03:00:00Z'), policy: { attendanceMilestoneBonusEnabled: true, attendanceMilestone50: 500 } });
  seedAttendance(f, previousDates(49, '2026-09-30'));
  f.documents.set(`${SCOPE_PATH}/point_transactions/month`, { uid: UID, type: 'attendance_monthly_bonus', sourceId: '2026-09' });
  f.documents.set(`${SCOPE_PATH}/point_transactions/milestone`, { uid: UID, type: 'attendance_milestone_bonus', sourceId: 'attendance-milestone-50' });
  const result = await f.handler(request());
  assert.equal(result.totalAwarded, 75); assert.equal(result.monthlyBonusAmount, 0); assert.equal(result.milestoneBonusAmount, 0);
});

test('disabled automatic rewards still record attendance with no money changes', async () => {
  for (const policy of [{ autoRewardEnabled: false }, { rewardPolicy: { autoEnabled: false } }, { rewardPolicy: { attendance: { enabled: false } } }]) {
    const f = fixture({ policy }); const result = await f.handler(request());
    assert.equal(result.attendanceRecorded, true); assert.equal(result.totalAwarded, 0); assert.equal(result.awarded, false);
    assert.equal(f.documents.get(ACCOUNT_PATH).balance, 100); assert.equal(ledgerRows(f).length, 0);
    assert.equal(f.writes, 1); assert.equal(f.documents.get(ATTENDANCE_PATH).rewardProcessed, true);
  }
});

test('nested monthly-disabled policy prevents month-end bonus', async () => {
  const f = fixture({ date: new Date('2026-09-30T03:00:00Z'), policy: { rewardPolicy: { attendanceMonthlyBonus: { enabled: false } } } });
  seedAttendance(f, previousDates(29, '2026-09-30'));
  assert.equal((await f.handler(request())).totalAwarded, 75);
});

test('forged input date and stale semester are rejected without writes', async () => {
  await checkRejected((f, req) => { req.data.date = '2026-01-01'; }, 'invalid-argument');
  await checkRejected((f, req) => { req.data.semester = '1'; });
  for (const [path, patch] of [
    ['site_settings/config', { year: '2025' }], ['site_settings/semester_active', { revision: 2 }],
    [`semester_manifests/${SCOPE}`, { status: 'ARCHIVED' }], [`semester_manifests/${SCOPE}`, { readOnly: true }],
  ]) await checkRejected((f) => Object.assign(f.documents.get(path), patch), 'failed-precondition', 'ATTENDANCE_SEMESTER_CHANGED');
});

test('auth, proof, inactive identity and teacher accounts are rejected', async () => {
  await checkRejected((f, req) => { delete req.auth; }, 'unauthenticated');
  await checkRejected((f, req) => { req.auth.token.email = 'person@example.com'; }, 'permission-denied');
  await checkRejected((f, req) => { delete req.data._session; }, 'unauthenticated');
  await checkRejected((f) => { f.documents.get(SESSION_PATH).status = 'revoked'; }, 'unauthenticated');
  await checkRejected((f) => { f.documents.get(`users/${UID}`).role = 'teacher'; }, 'permission-denied');
  await checkRejected((f) => { f.documents.get(`student_identities/${UID}`).accountStatus = 'DELETED'; }, 'permission-denied');
  await checkRejected((f) => { f.documents.get(`users/${UID}`).registrationApprovalStatus = 'PENDING'; }, 'permission-denied');
});

test('account, enrollment, class and economy guards reject all writes', async () => {
  for (const [path, patch] of [
    [ACCOUNT_PATH, { readOnly: true }], [ACCOUNT_PATH, { status: 'CLOSED' }], [ACCOUNT_PATH, { studentUid: 'other-student' }],
    [ACCOUNT_PATH, { balance: -1 }], [ACCOUNT_PATH, { enrollmentId: 'different' }],
    [SLOT_PATH, { status: 'CLOSED' }], ['semester_enrollments/enrollment-a', { enrollmentStatus: 'INACTIVE' }],
    ['semester_classes/class-a', { readOnly: true }], [`semester_wis_economies/${SCOPE}`, { status: 'CLOSED' }],
    [`semester_wis_economies/${SCOPE}`, { readOnly: true }],
  ]) await checkRejected((f) => Object.assign(f.documents.get(path), patch));
});

test('migration fence and maintenance reject before any attendance or ledger write', async () => {
  for (const flag of ['enabled', 'writesBlocked']) await checkRejected((f) => { f.documents.set(`wis_legacy_migration_controls/${SCOPE}`, { [flag]: true }); }, 'failed-precondition', 'ATTENDANCE_MIGRATION_BLOCKED');
  await checkRejected((f) => { f.documents.set('site_settings/student_maintenance', {
    enabled: true, blockedRoles: ['student'], bypassUids: [], title: '점검 중', message: '점검 후 이용해 주세요.',
    revision: 1, startedAt: Timestamp.fromDate(NOW), updatedAt: Timestamp.fromDate(NOW), updatedBy: 'teacher',
  }); }, 'failed-precondition', 'ATTENDANCE_MAINTENANCE');
  await checkRejected((f) => { f.documents.set('site_settings/student_maintenance', { enabled: true }); }, 'unavailable', 'ATTENDANCE_MAINTENANCE_CONFIG_INVALID');
});

test('an existing canonical grant repairs missing attendance without paying twice', async () => {
  const f = fixture();
  const first = await f.handler(request());
  f.documents.delete(ATTENDANCE_PATH);
  const result = await f.handler(request());
  assert.equal(first.totalAwarded, 75); assert.equal(result.totalAwarded, 0); assert.equal(result.balance, 175);
  assert.equal(ledgerRows(f).length, 1); assert.equal(f.documents.get(ATTENDANCE_PATH).rewardProcessed, true);
});

test('unconfirmed client attendance today cannot suppress the reward or forge its checkedAt time', async () => {
  const f = fixture();
  f.documents.set(ATTENDANCE_PATH, { uid: UID, scope: `${YEAR}_${SEMESTER}`, date: TODAY, checkedAt: Timestamp.fromMillis(0) });
  const result = await f.handler(request());
  assert.equal(result.totalAwarded, 75); assert.equal(result.duplicate, false);
  assert.equal(f.documents.get(ATTENDANCE_PATH).checkedAt.toMillis(), NOW.getTime());
  assert.equal(f.documents.get(ATTENDANCE_PATH).rewardProcessed, true);
});

test('invalid policy, overflow and excessive history fail atomically', async () => {
  await checkRejected((f) => { f.documents.get(POLICY_PATH).attendanceDaily = -1; }, 'failed-precondition', 'ATTENDANCE_POLICY_INVALID');
  await checkRejected((f) => { f.documents.get(ACCOUNT_PATH).balance = Number.MAX_SAFE_INTEGER; }, 'failed-precondition', 'ATTENDANCE_AMOUNT_OVERFLOW');
  await checkRejected((f) => { for (let index = 0; index < 4001; index++) f.documents.set(`users/${UID}/attendance/row-${index}`, { scope: `${YEAR}_${SEMESTER}`, date: '2026-09-01' }); }, 'failed-precondition', 'ATTENDANCE_HISTORY_LIMIT_EXCEEDED');
});

test('Korean midnight determines recorded date from server time', async () => {
  const f = fixture({ date: new Date('2026-09-29T15:00:00Z') });
  const result = await f.handler(request());
  assert.equal(result.attendanceDate, '2026-09-30');
  assert.equal(f.documents.has(`users/${UID}/attendance/${YEAR}_${SEMESTER}_2026-09-30`), true);
  assert.equal(f.documents.has(ATTENDANCE_PATH), false);
});
