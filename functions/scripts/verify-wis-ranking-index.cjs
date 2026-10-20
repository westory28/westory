const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  WIS_RANKING_INDEX_COLLECTION: COLLECTION,
  buildWisRankingPublicId, deriveWisRankingPreviewEntry,
  createWisRankingIndexService, createWisRankingIndexTriggers,
} = require('../wisRankingIndex');
const { accountIdFor } = require('../studentWisWallet');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const { parseArgs, resolveCredential, runBackfill } = require('./rebuild-wis-ranking-index.cjs');

const clone = value => value === undefined ? undefined : structuredClone(value);
const source = (uid = 'student', scope = '2026-2', score = 100) => {
  const accountId = accountIdFor(scope, uid);
  const enrollmentId = `enrollment-${scope}-${uid}`;
  const classId = `class-${scope}`;
  return {
    accountId, uid, scope, enrollmentId, classId,
    accountPath: `semester_wis_accounts/${accountId}`, entryPath: `${COLLECTION}/${accountId}`,
    slotPath: `semester_enrollment_slots/${buildEnrollmentSlotId(scope, uid)}`,
    enrollmentPath: `semester_enrollments/${enrollmentId}`, classPath: `semester_classes/${classId}`,
    account: { accountId, studentUid: uid, semesterId: scope, rankEarnedTotal: score,
      status: 'ACTIVE', grade: 'old-grade', classNumber: 'old-class', displayName: '오래된 계좌 이름',
      enrollmentId, classId, balance: 999999, recentLedgerEntries: [{ private: 'large history' }] },
    slot: { semesterId: scope, studentUid: uid, activeEnrollmentId: enrollmentId },
    enrollment: { enrollmentId, semesterId: scope, studentUid: uid, enrollmentStatus: 'ACTIVE',
      classId, displayName: '현재 학생', studentNumber: '7', snapshot: { grade: '3', classNumber: '2' } },
    semesterClass: { classId, semesterId: scope, status: 'ACTIVE', grade: '3', classNumber: '2' },
  };
};
const event = (before, after, params) => ({ params, data: {
  before: { exists: before !== undefined, data: () => clone(before) },
  after: { exists: after !== undefined, data: () => clone(after) },
} });

function fixture() {
  const documents = new Map(), versions = new Map(), writes = [], queries = [], reads = [];
  let conflict, attempts = 0, concurrency = 0, maximumConcurrency = 0;
  const put = (path, data) => { documents.set(path, clone(data)); versions.set(path, (versions.get(path) || 0) + 1); };
  const remove = path => { documents.delete(path); versions.set(path, (versions.get(path) || 0) + 1); };
  const ref = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) });
  const snapshot = path => ({ exists: documents.has(path), ref: ref(path), id: path.split('/').at(-1), data: () => clone(documents.get(path)) });
  const query = (path, state = {}) => ({
    where: (field, operator, value) => { assert.equal(operator, '=='); return query(path, { ...state, field, value }); },
    limit: limit => query(path, { ...state, limit }),
    get: async () => {
      queries.push({ path, ...state });
      const docs = [...documents.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === 2)
        .map(snapshot).filter(document => document.data()?.[state.field] === state.value).slice(0, state.limit);
      return { docs };
    },
  });
  const db = { doc: ref, collection: path => query(path), runTransaction: async callback => {
    concurrency++; maximumConcurrency = Math.max(maximumConcurrency, concurrency);
    try {
      for (let retry = 0; retry < 5; retry++) {
        attempts++;
        const readVersions = new Map(), pending = [];
        const get = async reference => {
          assert.equal(pending.length, 0, 'All source reads precede writes');
          reads.push(reference.path); readVersions.set(reference.path, versions.get(reference.path) || 0);
          return snapshot(reference.path);
        };
        const result = await callback({ get, getAll: (...references) => Promise.all(references.map(get)),
          set: (reference, data, options) => {
            assert.ok(reference.path.startsWith(`${COLLECTION}/`), 'No account/user/ledger source may be written');
            assert.equal(options, undefined, 'Replace stale index fields instead of retaining unknown data');
            pending.push([reference.path, clone(data)]);
          },
          delete: () => assert.fail('Entries are disabled, never deleted'),
        });
        if (conflict) { const hook = conflict; conflict = undefined; await hook(); }
        if ([...readVersions].some(([path, version]) => version !== (versions.get(path) || 0))) continue;
        for (const [path, data] of pending) { writes.push({ path, data }); put(path, data); }
        return result;
      }
      throw new Error('Synthetic retry exhausted');
    } finally { concurrency--; }
  } };
  const seed = data => {
    put(data.accountPath, data.account); put(data.slotPath, data.slot);
    put(data.enrollmentPath, data.enrollment); put(data.classPath, data.semesterClass);
  };
  const get = path => clone(documents.get(path));
  const allSources = () => [...documents].filter(([path]) => !path.startsWith(`${COLLECTION}/`));
  return { db, documents, writes, queries, reads, put, remove, seed, get, allSources,
    service: createWisRankingIndexService({ db }), conflictOnce: hook => { conflict = hook; },
    get attempts() { return attempts; }, get maximumConcurrency() { return maximumConcurrency; } };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
const projection = data => deriveWisRankingPreviewEntry(data);

test('pure canonical projection and byte-identical public IDs', () => {
  const data = source(); const entry = projection(data);
  assert.deepEqual(Object.keys(entry).sort(), ['schemaVersion', 'accountId', 'studentUid', 'semesterId', 'rankEarnedTotal',
    'publicId', 'grade', 'classNumber', 'classId', 'enrollmentId', 'displayName', 'studentNumber', 'hallZeroEligible', 'eligible'].sort());
  assert.equal(entry.schemaVersion, 1); assert.equal(entry.grade, '3'); assert.equal(entry.classNumber, '2');
  assert.equal(entry.displayName, '현재 학생'); assert.equal(entry.studentNumber, '7'); assert.equal(entry.eligible, true);
  assert.equal(entry.rankEarnedTotal, 100); assert.equal(entry.hallZeroEligible, true);
  for (const scope of ['2026-1', '2026-2', '2025-2']) for (const uid of ['student', '학생-1', 'BangTest']) {
    const expected = `wispublic_${createHash('sha256').update(`${scope}\n${uid}`, 'utf8').digest('hex').slice(0, 24)}`;
    assert.equal(buildWisRankingPublicId(scope, uid), expected);
  }
  assert.equal(JSON.stringify(entry).includes('large history'), false);
});

test('positive eligibility preserves account/class status semantics; zero requires both ACTIVE', () => {
  for (const score of [0, 10]) for (const accountStatus of ['ACTIVE', 'CLOSED', 'ARCHIVED']) for (const classStatus of ['ACTIVE', 'CLOSED']) {
    const data = source('student', '2026-2', score); data.account.status = accountStatus; data.semesterClass.status = classStatus;
    const entry = projection(data); const zero = accountStatus === 'ACTIVE' && classStatus === 'ACTIVE';
    assert.equal(entry.hallZeroEligible, zero); assert.equal(entry.eligible, score > 0 || zero);
    if (!entry.eligible) { assert.equal(entry.displayName, ''); assert.equal(entry.studentNumber, ''); }
  }
});

test('operator test identities excluded, partial matches preserved', () => {
  for (const name of ['방테스트', '방 테 스 트', 'BangTest', 'bang.test', 'BANG_TEST']) {
    const data = source(); data.enrollment.displayName = name;
    const entry = projection(data); assert.equal(entry.eligible, false); assert.equal(entry.displayName, '');
  }
  assert.equal(projection(source('BangTest')).eligible, false);
  for (const name of ['방테스트 학생', '학생 BangTest', '방 테스트중']) {
    const data = source(); data.enrollment.displayName = name; assert.equal(projection(data).eligible, true);
  }
});

test('invalid canonical scope, ownership, scores and membership fail closed', () => {
  const mutations = [
    data => { data.account.accountId = 'forged'; }, data => { data.account.studentUid = 'another'; },
    data => { data.account.semesterId = '2026-1'; }, data => { data.account.rankEarnedTotal = -1; },
    data => { data.account.rankEarnedTotal = '100'; }, data => { data.account.rankEarnedTotal = Infinity; },
    data => { data.account.rankEarnedTotal = Number.MAX_SAFE_INTEGER + 1; },
    data => { data.slot.semesterId = '2026-1'; }, data => { data.slot.studentUid = 'another'; },
    data => { data.slot.status = 'INACTIVE'; }, data => { data.slot.activeEnrollmentId = 'other'; },
    data => { data.enrollment.studentUid = 'another'; }, data => { data.enrollment.semesterId = '2026-1'; },
    data => { data.enrollment.enrollmentStatus = 'WITHDRAWN'; }, data => { data.enrollment.enrollmentId = 'other'; },
    data => { data.enrollment.classId = '../invalid'; }, data => { data.semesterClass.semesterId = '2026-1'; },
    data => { data.semesterClass.classId = 'other'; }, data => { data.enrollment = undefined; }, data => { data.semesterClass = undefined; },
  ];
  for (const mutate of mutations) {
    const data = source(); mutate(data); const entry = projection(data);
    assert.equal(entry.eligible, false); assert.equal(entry.displayName, ''); assert.equal(entry.studentNumber, '');
  }
});

test('transaction writes only private entry; no source, history, profile or balance changes', async () => {
  const f = fixture(), data = source(); f.seed(data); f.put('users/student', { role: 'student', private: 'profile' });
  f.put('semester_wis_ledger/fixture', { delta: 100 });
  const original = clone(f.allSources());
  assert.equal((await f.service.reconcileAccount(data.accountId, { apply: false })).status, 'updated');
  assert.equal(f.writes.length, 0);
  const result = await f.service.reconcileAccount(data.accountId); assert.equal(result.eligible, true);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].path, data.entryPath);
  assert.deepEqual(f.allSources(), original); assert.deepEqual(f.get(data.entryPath), projection(data));
  assert.equal((await f.service.reconcileAccount(data.accountId)).status, 'unchanged');
  assert.equal(f.writes.length, 1);
  f.put(data.entryPath, { ...f.get(data.entryPath), obsoletePrivateName: '삭제할 이전 이름' });
  await f.service.reconcileAccount(data.accountId); assert.equal('obsoletePrivateName' in f.get(data.entryPath), false);
});

test('account events skip balance/ledger/revision noise and settle duplicate/out-of-order delivery', async () => {
  const f = fixture(), data = source(); f.seed(data);
  const noisy = { ...data.account, balance: 1, recentLedgerEntries: [], revision: 3, updatedAt: 'later' };
  assert.equal(await f.service.handleAccountWritten(event(data.account, noisy, { accountId: data.accountId })), null);
  assert.equal(f.reads.length, 0);
  await f.service.handleAccountWritten(event(undefined, data.account, { accountId: data.accountId }));
  const after = { ...data.account, rankEarnedTotal: 0 }; f.put(data.accountPath, after);
  await f.service.handleAccountWritten(event(data.account, after, { accountId: data.accountId }));
  assert.equal(f.get(data.entryPath).rankEarnedTotal, 0); assert.equal(f.get(data.entryPath).eligible, true);
  const writes = f.writes.length;
  await f.service.handleAccountWritten(event(after, data.account, { accountId: data.accountId }));
  assert.equal(f.writes.length, writes); assert.equal(f.get(data.entryPath).rankEarnedTotal, 0);
  const recreatedService = createWisRankingIndexService({ db: f.db });
  assert.equal((await recreatedService.reconcileAccount(data.accountId)).status, 'unchanged', 'No instance memory is required');
});

test('canonical slot move changes grade/class/name despite stale account metadata', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  const next = { ...data.enrollment, enrollmentId: 'moved-enrollment', classId: 'moved-class', displayName: '이동 후 학생',
    studentNumber: '22', snapshot: { grade: '1', classNumber: '7' } };
  const nextSlot = { ...data.slot, activeEnrollmentId: next.enrollmentId };
  f.put('semester_enrollments/moved-enrollment', next);
  f.put('semester_classes/moved-class', { classId: 'moved-class', semesterId: data.scope, grade: '1', classNumber: '7', status: 'ACTIVE' });
  f.put(data.slotPath, nextSlot);
  await f.service.handleSlotWritten(event(data.slot, nextSlot, { slotId: buildEnrollmentSlotId(data.scope, data.uid) }));
  const entry = f.get(data.entryPath);
  assert.equal(entry.grade, '1'); assert.equal(entry.classNumber, '7'); assert.equal(entry.classId, 'moved-class');
  assert.equal(entry.enrollmentId, 'moved-enrollment'); assert.equal(entry.displayName, '이동 후 학생'); assert.equal(entry.studentNumber, '22');
  await f.service.handleSlotWritten(event(nextSlot, data.slot, { slotId: buildEnrollmentSlotId(data.scope, data.uid) }));
  await f.service.handleEnrollmentWritten(event(data.enrollment, { ...data.enrollment, displayName: '옛 이름' }, { enrollmentId: data.enrollmentId }));
  assert.deepEqual(f.get(data.entryPath), entry, 'Delayed old-slot/enrollment events cannot restore a former grade');
});

test('enrollment name and number events use latest canonical data', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  const after = { ...data.enrollment, displayName: '현재 이름 수정', studentNumber: '9' }; f.put(data.enrollmentPath, after);
  await f.service.handleEnrollmentWritten(event(data.enrollment, after, { enrollmentId: data.enrollmentId }));
  assert.equal(f.get(data.entryPath).displayName, '현재 이름 수정'); assert.equal(f.get(data.entryPath).studentNumber, '9');
  const writes = f.writes.length;
  await f.service.handleEnrollmentWritten(event(after, data.enrollment, { enrollmentId: data.enrollmentId }));
  assert.equal(f.writes.length, writes);
  assert.equal(await f.service.handleEnrollmentWritten(event(after, { ...after, updatedAt: 'noise' }, { enrollmentId: data.enrollmentId })), null);
});

test('withdrawal, enrollment deletion and reactivation clear then restore the public name', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  const withdrawn = { ...data.enrollment, enrollmentStatus: 'WITHDRAWN' }; f.put(data.enrollmentPath, withdrawn);
  await f.service.handleEnrollmentWritten(event(data.enrollment, withdrawn, { enrollmentId: data.enrollmentId }));
  assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  f.remove(data.enrollmentPath);
  await f.service.handleEnrollmentWritten(event(withdrawn, undefined, { enrollmentId: data.enrollmentId }));
  assert.equal(f.get(data.entryPath).eligible, false);
  f.put(data.enrollmentPath, data.enrollment);
  await f.service.handleEnrollmentWritten(event(undefined, data.enrollment, { enrollmentId: data.enrollmentId }));
  assert.equal(f.get(data.entryPath).eligible, true); assert.equal(f.get(data.entryPath).displayName, '현재 학생');
});

test('slot deletion and malformed identity cannot publish another student', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  const slotId = buildEnrollmentSlotId(data.scope, data.uid); f.remove(data.slotPath);
  await f.service.handleSlotWritten(event(data.slot, undefined, { slotId }));
  assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  f.put(data.slotPath, { ...data.slot, studentUid: 'another' });
  await f.service.handleSlotWritten(event(data.slot, { ...data.slot, studentUid: 'another' }, { slotId }));
  assert.equal(f.get(data.entryPath).eligible, false);
  f.put(data.slotPath, data.slot);
  await f.service.handleSlotWritten(event(undefined, data.slot, { slotId }));
  assert.equal(f.get(data.entryPath).eligible, true);
  const writes = f.writes.length;
  await f.service.handleSlotWritten(event(undefined, data.slot, { slotId: 'forged-slot' }));
  assert.equal(f.writes.length, writes, 'Event identity must hash to the addressed canonical slot');
});

test('class removal/scope corruption retains routing for safe restoration', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  f.remove(data.classPath);
  await f.service.handleClassWritten(event(data.semesterClass, undefined, { classId: data.classId }));
  assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  assert.equal(f.get(data.entryPath).classId, data.classId);
  f.put(data.classPath, { ...data.semesterClass, semesterId: '2026-1' });
  await f.service.handleClassWritten(event(undefined, { ...data.semesterClass, semesterId: '2026-1' }, { classId: data.classId }));
  assert.equal(f.get(data.entryPath).eligible, false);
  f.put(data.classPath, data.semesterClass);
  await f.service.handleClassWritten(event(undefined, data.semesterClass, { classId: data.classId }));
  assert.equal(f.get(data.entryPath).eligible, true);
});

test('class fallback fields and fresh zero-score account status reconcile without scans', async () => {
  const f = fixture(), data = source('student', '2026-2', 0);
  data.enrollment.snapshot = {}; data.enrollment.grade = ''; data.enrollment.classNumber = ''; f.seed(data);
  await f.service.reconcileAccount(data.accountId);
  const next = { ...data.semesterClass, grade: '2', classNumber: '9', status: 'CLOSED' }; f.put(data.classPath, next);
  await f.service.handleClassWritten(event(data.semesterClass, next, { classId: data.classId }));
  assert.equal(f.get(data.entryPath).grade, '2'); assert.equal(f.get(data.entryPath).classNumber, '9');
  assert.equal(f.get(data.entryPath).eligible, false);
  const current = { ...data.account, rankEarnedTotal: 5, status: 'CLOSED' }; f.put(data.accountPath, current);
  await f.service.handleAccountWritten(event(data.account, current, { accountId: data.accountId }));
  assert.equal(f.get(data.entryPath).eligible, true, 'Positive canonical earnings preserve existing status semantics');
  assert.equal(f.queries.length, 1); assert.deepEqual(f.queries[0], { path: COLLECTION, field: 'classId', value: data.classId, limit: 2001 });
});

test('account deletion, recreation and invalid owner/score remove stale exposure', async () => {
  const f = fixture(), data = source(); f.seed(data); await f.service.reconcileAccount(data.accountId);
  f.remove(data.accountPath);
  await f.service.handleAccountWritten(event(data.account, undefined, { accountId: data.accountId }));
  assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  assert.equal(f.get(data.entryPath).rankEarnedTotal, 0);
  f.put(data.accountPath, data.account);
  await f.service.handleAccountWritten(event(data.account, undefined, { accountId: data.accountId }));
  assert.equal(f.get(data.entryPath).eligible, true, 'Delayed deletion must re-read the recreated source');
  for (const change of [{ studentUid: 'another' }, { semesterId: '2026-1' }, { accountId: 'forged' }, { rankEarnedTotal: NaN }]) {
    f.put(data.accountPath, { ...data.account, ...change });
    await f.service.handleAccountWritten(event(data.account, { ...data.account, ...change }, { accountId: data.accountId }));
    assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  }
  assert.equal((await f.service.reconcileAccount('../invalid')).status, 'skipped');
});

test('archived and independent semester entries never borrow current scope', async () => {
  const f = fixture(); const current = source('student', '2026-2', 25), archived = source('student', '2025-2', 50);
  f.seed(current); f.seed(archived); f.put('site_settings/semester_active', { semesterId: '2026-2' });
  f.put('semester_manifests/2025-2', { semesterId: '2025-2', status: 'ARCHIVED' });
  await f.service.reconcileAccount(current.accountId); await f.service.reconcileAccount(archived.accountId);
  assert.equal(f.get(current.entryPath).rankEarnedTotal, 25); assert.equal(f.get(archived.entryPath).rankEarnedTotal, 50);
  assert.notEqual(f.get(current.entryPath).publicId, f.get(archived.entryPath).publicId);
  assert.ok(f.reads.every(path => !path.startsWith('years/') && !path.startsWith('users/')));
});

test('equal scores use stable public IDs and score decrease reaches the new entry', async () => {
  const f = fixture();
  const students = Array.from({ length: 8 }, (_, index) => source(`student-${index}`, '2026-2', 100));
  students.forEach(f.seed); await f.service.rebuildSemester({ semesterId: '2026-2', apply: true });
  const rows = students.map(data => f.get(data.entryPath)).sort((left, right) =>
    right.rankEarnedTotal - left.rankEarnedTotal || left.publicId.localeCompare(right.publicId));
  assert.deepEqual(rows.map(row => row.publicId), rows.map(row => row.publicId).sort((a, b) => a.localeCompare(b)));
  const first = students.find(data => data.accountId === rows[0].accountId);
  f.put(first.accountPath, { ...first.account, rankEarnedTotal: 1 }); await f.service.reconcileAccount(first.accountId);
  assert.equal(f.get(first.entryPath).rankEarnedTotal, 1);
});

test('bounded class fan-out uses one simple query and at most ten transactions', async () => {
  const f = fixture(); const students = Array.from({ length: 35 }, (_, index) => source(`student-${index}`, '2026-2', index % 2 ? 0 : 10));
  students.forEach(f.seed); await f.service.rebuildSemester({ semesterId: '2026-2', apply: true });
  const data = students[0], next = { ...data.semesterClass, status: 'CLOSED' }; f.put(data.classPath, next);
  const beforeQueries = f.queries.length;
  const totals = await f.service.handleClassWritten(event(data.semesterClass, next, { classId: data.classId }));
  assert.equal(totals.scanned, 35); assert.equal(totals.eligible, 18); assert.equal(totals.updated, 35);
  assert.equal(f.queries.length, beforeQueries + 1); assert.ok(f.maximumConcurrency > 1 && f.maximumConcurrency <= 10);
  assert.deepEqual(f.queries.at(-1), { path: COLLECTION, field: 'classId', value: data.classId, limit: 2001 });
  const writes = f.writes.length;
  await f.service.handleClassWritten(event(next, data.semesterClass, { classId: data.classId }));
  assert.equal(f.writes.length, writes, 'Replayed class events settle using current class status');
});

test('class and account bounds stop before any partial work', async () => {
  const f = fixture(); const data = source();
  for (let index = 0; index < 2001; index++) {
    const item = source(`student-${index}`);
    f.put(item.entryPath, { accountId: item.accountId, classId: data.classId });
    f.put(item.accountPath, item.account);
  }
  await assert.rejects(() => f.service.handleClassWritten(event(undefined, data.semesterClass, { classId: data.classId })), /limit exceeded/);
  await assert.rejects(() => f.service.rebuildSemester({ semesterId: '2026-2', apply: true }), /limit exceeded/);
  assert.equal(f.writes.length, 0); assert.equal(f.attempts, 0);
  assert.equal(f.queries.every(query => query.limit === 2001), true);
});

test('transaction conflict retries current enrollment and commits one latest entry', async () => {
  const f = fixture(), data = source(); f.seed(data);
  f.conflictOnce(() => f.put(data.enrollmentPath, { ...data.enrollment, displayName: '동시 수정된 이름' }));
  await f.service.reconcileAccount(data.accountId);
  assert.equal(f.attempts, 2); assert.equal(f.writes.length, 1); assert.equal(f.get(data.entryPath).displayName, '동시 수정된 이름');
});

test('dry-run backfill defaults to authoritative pointer, returns counts and never student data', async () => {
  const f = fixture(), students = Array.from({ length: 6 }, (_, index) => source(`student-${index}`));
  students.forEach(f.seed); f.put('site_settings/semester_active', { semesterId: '2026-2' });
  const original = clone(f.allSources());
  const options = parseArgs(['--project', 'demo-westory-ranking']);
  const dry = await runBackfill({ db: f.db, options });
  assert.equal(dry.mode, 'dry-run'); assert.equal(dry.scanned, 6); assert.equal(dry.updated, 6); assert.equal(dry.applied, 0);
  assert.equal(f.writes.length, 0); assert.equal(JSON.stringify(dry).includes('student-'), false);
  const applied = await runBackfill({ db: f.db, options: { ...options, apply: true } });
  assert.equal(applied.applied, 6); assert.equal(applied.eligible, 6);
  const repeated = await runBackfill({ db: f.db, options: { ...options, apply: true } });
  assert.equal(repeated.applied, 0); assert.equal(repeated.unchanged, 6); assert.deepEqual(f.allSources(), original);
  f.remove('site_settings/semester_active'); await assert.rejects(() => runBackfill({ db: f.db, options }), /pointer/);
});

test('backfill repairs orphan entries after a missed account deletion without source writes', async () => {
  const f = fixture(), data = source(); f.seed(data);
  await f.service.reconcileAccount(data.accountId);
  f.remove(data.accountPath);
  const dry = await f.service.rebuildSemester({ semesterId: data.scope });
  assert.equal(dry.scanned, 1); assert.equal(dry.updated, 1); assert.equal(dry.applied, 0);
  assert.equal(f.get(data.entryPath).eligible, true);
  const writes = f.writes.length;
  const applied = await f.service.rebuildSemester({ semesterId: data.scope, apply: true });
  assert.equal(applied.scanned, 1); assert.equal(applied.applied, 1);
  assert.equal(f.get(data.entryPath).eligible, false); assert.equal(f.get(data.entryPath).displayName, '');
  assert.equal(f.writes.length, writes + 1); assert.equal(f.writes.at(-1).path, data.entryPath);
  assert.equal(f.get(data.accountPath), undefined);
});

test('backfill arguments reject ambiguous flags and credentials stay in memory', async () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(['--apply', '--project=demo-westory-ranking', '--semester-id=2025-2']).semesterId, '2025-2');
  assert.throws(() => parseArgs(['--unknown']), /Unsupported/); assert.throws(() => parseArgs(['--project']), /value/);
  assert.throws(() => parseArgs(['--semester-id=../../secret']), /semester/);
  const defaultCredential = { getAccessToken: async () => ({ access_token: 'synthetic-adc' }) };
  assert.equal(await resolveCredential({ createDefault: () => defaultCredential,
    tokenProvider: () => assert.fail('gcloud fallback should not run') }), defaultCredential);
  let calls = 0, timestamp = 0;
  const credential = await resolveCredential({ createDefault: () => { throw new Error('no ADC'); },
    tokenProvider: () => `synthetic-token-${++calls}`, now: () => timestamp });
  assert.equal((await credential.getAccessToken()).access_token, 'synthetic-token-1'); assert.equal(calls, 1);
  timestamp = 3_000_001; assert.equal((await credential.getAccessToken()).access_token, 'synthetic-token-2');
  await assert.rejects(() => resolveCredential({ createDefault: () => { throw Error('no ADC'); },
    tokenProvider: () => { throw Error('private credential details'); } }), error =>
    error.message === 'ADC or an authenticated gcloud session is required.');
});

test('only four trusted us-central1 source-document triggers are registered', () => {
  const f = fixture(), registered = [];
  const triggers = createWisRankingIndexTriggers({ db: f.db, register: (options, handler) => {
    registered.push(options); return { options, handler };
  } });
  assert.equal(Object.keys(triggers).length, 4);
  assert.deepEqual(registered.map(options => options.document), ['semester_wis_accounts/{accountId}',
    'semester_enrollment_slots/{slotId}', 'semester_enrollments/{enrollmentId}', 'semester_classes/{classId}']);
  for (const options of registered) {
    assert.equal(options.region, 'us-central1'); assert.equal(options.database, '(default)');
    assert.equal(options.retry, false); assert.equal(options.maxInstances, 5); assert.equal(options.minInstances, undefined);
    assert.equal(options.document.includes(COLLECTION), false);
  }
});

(async () => {
  for (const item of tests) {
    try { await item.run(); }
    catch (error) { error.message = `${item.name}: ${error.message}`; throw error; }
  }
  console.log(JSON.stringify({ passed: true, cases: tests.length, network: 0,
    guarantees: ['canonical source transaction authority', 'idempotent private-entry-only writes',
      'moves, withdrawals, deletion, class changes, zero and test accounts', 'bounded 2000 fan-out and concurrency 10',
      'dry-run defaults and in-memory credentials', 'no cache, polling, timers or self-trigger loops'] }));
})().catch(error => { console.error(error); process.exitCode = 1; });
