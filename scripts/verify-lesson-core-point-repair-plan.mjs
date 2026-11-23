import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildRepairPlan, loadRepairContract } from './repair-lesson-core-point-rewards.mjs';
import { createReadOnlyRestDb, curlReadConfig } from './core-point-readonly-rest.mjs';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const wis = require('../functions/productionGateway/wisEconomy.js');
const archive = require('../functions/productionGateway/archiveEnrollment.js');
const root = 'years/2026/semesters/2', semesterId = '2026-2';
const sha = value => createHash('sha256').update(value).digest('hex');
const point = { id: 'point', widthRatio: .1, heightRatio: .1 };

function fixture() {
  const docs = new Map(Object.entries({
    'site_settings/config': { year: '2026', semester: '2' },
    'site_settings/semester_active': { semesterId, revision: 3 },
    'semester_manifests/2026-2': { semesterId, revision: 3, status: 'ACTIVE' },
    'semester_wis_economies/2026-2': { status: 'ACTIVE_OPEN' },
    'semester_classes/class-one': { classId: 'class-one', semesterId, status: 'ACTIVE' },
    [`${root}/lessons/one`]: { unitId: 'unit', worksheetExamHighlights: [point], assignedClassIds: ['class-one'] },
    [`${root}/lessons/foreign`]: { unitId: 'foreign', worksheetExamHighlights: [point], assignedClassIds: ['class-two'] },
    [`${root}/lessons/hidden`]: { unitId: 'hidden', worksheetExamHighlights: [point], isVisibleToStudents: false },
    'semester_enrollments/other-semester': { semesterId: '2026-1', enrollmentStatus: 'ACTIVE', studentUid: 'foreign' },
    'semester_enrollments/withdrawn': { semesterId, enrollmentStatus: 'WITHDRAWN', studentUid: 'withdrawn' },
  }));
  const queries = [], documentReads = [], writes = [];
  const snapshot = (name, fields) => ({ id: name.split('/').at(-1), ref: { path: name }, exists: docs.has(name),
    data: () => docs.has(name) ? Object.fromEntries(Object.entries(structuredClone(docs.get(name)))
      .filter(([key]) => !fields || fields.includes(key))) : undefined });
  class Query {
    constructor(name, options = {}) { this.path = name; this.options = options; }
    next(delta) { return new Query(this.path, { ...this.options, ...delta }); }
    where(field, operator, value) { assert.equal(operator, '=='); return this.next({ filters: [...(this.options.filters || []), [field, value]] }); }
    select(...fields) { return this.next({ fields }); }
    orderBy(field) { assert.equal(field, '__name__'); return this; }
    limit(limit) { return this.next({ limit }); }
    startAfter(cursor) { return this.next({ cursor: cursor.ref.path }); }
    async get() {
      queries.push({ path: this.path, ...this.options });
      let matching = [...docs.keys()].filter(name => name.startsWith(this.path + '/') && !name.slice(this.path.length + 1).includes('/'))
        .filter(name => (this.options.filters || []).every(([field, value]) => docs.get(name)[field] === value))
        .sort().filter(name => !this.options.cursor || name > this.options.cursor);
      if (this.options.limit) matching = matching.slice(0, this.options.limit);
      return { docs: matching.map(name => snapshot(name, this.options.fields)) };
    }
  }
  const db = { doc: name => ({ path: name }), collection: name => new Query(name),
    getAll: async (...refs) => {
      const fieldMask = refs.at(-1)?.fieldMask;
      if (fieldMask) refs.pop();
      documentReads.push(...refs.map(ref => ref.path));
      return refs.map(ref => snapshot(ref.path, fieldMask));
    },
    runTransaction: () => { writes.push('forbidden'); throw Error('Read-only planner cannot write'); },
  };
  function student(index) {
    const uid = `student-${String(index).padStart(3, '0')}`, enrollmentId = `enrollment-${String(index).padStart(3, '0')}`;
    const accountId = wis.accountIdFor(semesterId, uid);
    docs.set(`semester_enrollments/${enrollmentId}`, { enrollmentId, semesterId, studentUid: uid, classId: 'class-one', enrollmentStatus: 'ACTIVE' });
    docs.set(`semester_enrollment_slots/${archive.buildEnrollmentSlotId(semesterId, uid)}`, { semesterId, studentUid: uid, activeEnrollmentId: enrollmentId, status: 'ACTIVE' });
    docs.set(`users/${uid}`, { role: 'student' });
    docs.set(`semester_wis_accounts/${accountId}`, { accountId, studentUid: uid, semesterId, status: 'ACTIVE', revision: 2 });
    docs.set(`${root}/lesson_progress/${uid}/units/unit`, { corePointFinds: ['point'] });
    return { uid, accountId, ledgerId: `wisled_${sha([semesterId, accountId, 'GRANT', 'lesson-core-points-all'].join('\n'))}` };
  }
  return { db, docs, queries, documentReads, writes, student };
}
const options = f => ({ db: f.db, year: '2026', semester: '2', projectId: 'demo-westory-repair-plan', documentId: '__name__' });
let checks = 0;
{
  const f = fixture(), contract = await loadRepairContract(f.db);
  for (let i = 0; i < 100; i++) {
    const student = f.student(i);
    f.docs.set(`semester_wis_ledger/${student.ledgerId}`, { studentUid: student.uid, sourceId: 'lesson-core-points-all', delta: 500 });
  }
  const eligible = f.student(100), incomplete = f.student(101), rootPaid = f.student(102), legacyPaid = f.student(103), reclaimed = f.student(104), noAccount = f.student(105);
  f.docs.set(`${root}/lesson_progress/${incomplete.uid}/units/unit`, { corePointFinds: [] });
  f.docs.set(`${root}/lesson_progress/${rootPaid.uid}`, { corePointRewardClaimed: true });
  f.docs.set(`${root}/point_transactions/${contract.legacyId(legacyPaid.uid, 'lesson_core_points', 'lesson-core-points-all')}`, { uid: legacyPaid.uid, delta: 500 });
  f.docs.set(`${root}/point_transactions/reclaim`, { uid: reclaimed.uid, activityType: 'lesson_core_points_reclaim', delta: -500 });
  f.docs.delete(`semester_wis_accounts/${noAccount.accountId}`);
  const plan = await buildRepairPlan(options(f));
  assert.deepEqual(plan.counts, { ALREADY_SETTLED: 102, REVIEW_ACCOUNT: 1, INCOMPLETE: 1, REVIEW_HISTORY: 1, ELIGIBLE: 1 }); checks++;
  assert.equal(plan.rows.find(row => row.status === 'ELIGIBLE').uid, eligible.uid);
  assert.equal(plan.totalReward, 500); assert.equal(plan.productionWrites, 0); assert.equal(f.writes.length, 0); checks++;
  assert.equal(f.queries.filter(query => query.path === 'semester_enrollments').length, 2, 'Second page must be read');
  for (const query of f.queries.filter(query => query.path === 'semester_enrollments'))
    assert.deepEqual(query.filters, [['semesterId', semesterId], ['enrollmentStatus', 'ACTIVE']]); checks++;
  assert.equal(f.queries.filter(query => query.path === `${root}/lessons`).length, 1, 'Current catalog is reused only for this audit');
  assert.equal(f.queries.filter(query => query.path.includes('/units')).length, 3, 'Only unpaid viable candidates need progress'); checks++;
  assert(!f.queries.some(query => query.path.includes('/lesson_progress/student-001/'))); checks++;
  assert(!f.documentReads.some(name => name.includes('/users/student-001'))); checks++;
  const replay = await buildRepairPlan(options(f));
  assert.equal(replay.planHash, plan.planHash, 'Read-only repeat has a stable plan'); checks++;
  f.docs.set(`semester_wis_ledger/${eligible.ledgerId}`, { studentUid: eligible.uid, sourceId: 'lesson-core-points-all', delta: 500 });
  const claimed = await buildRepairPlan(options(f));
  assert.equal(claimed.counts.ELIGIBLE, 0); assert.notEqual(claimed.planHash, plan.planHash); checks++;
}
for (const [name, delta] of [
  ['site_settings/config', { year: '2025', semester: '2' }],
  ['site_settings/semester_active', { semesterId: '2026-1', revision: 3 }],
  ['wis_legacy_migration_controls/2026-2', { writesBlocked: true }],
]) {
  const f = fixture(); f.student(1); f.docs.set(name, delta);
  await assert.rejects(buildRepairPlan(options(f))); assert.equal(f.writes.length, 0); checks++;
}
{
  const base = 'projects/demo-westory-repair-plan/databases/(default)/documents';
  const requests = [];
  let respond = () => [];
  const db = createReadOnlyRestDb({ projectId: 'demo-westory-repair-plan', request: async (url, body) => {
    requests.push({ url, body }); return respond(body);
  } });
  const config = curlReadConfig('https://firestore.googleapis.com/v1/' + base + ':batchGet', 'synthetic-token', { documents: [base + '/test/quoted"document'] });
  const lines = Object.fromEntries(config.trim().split('\n').map(line => { const at = line.indexOf(' = '); return [line.slice(0, at), JSON.parse(line.slice(at + 3))]; }));
  assert.equal(lines.request, 'POST');
  assert.equal(JSON.parse(lines.data).documents[0], base + '/test/quoted"document');
  assert.throws(() => curlReadConfig('https://firestore.googleapis.com/v1/' + base + ':commit', 'synthetic-token', {}));
  assert.throws(() => curlReadConfig('https://firestore.googleapis.com/v1/' + base + ':batchGet', 'bad\ntoken', {})); checks++;

  respond = () => [
    { missing: base + '/test/missing' },
    { found: { name: base + '/test/found', fields: {
      title: { stringValue: 'synthetic' }, corePointFinds: { arrayValue: { values: [{ stringValue: 'point' }] } },
      revision: { integerValue: '3' }, updatedAt: { timestampValue: '2026-11-23T01:00:00.123Z' },
      flags: { mapValue: { fields: { active: { booleanValue: true }, absent: { nullValue: null } } } },
    } } },
  ];
  const snapshots = await db.getAll(db.doc('test/found'), db.doc('test/missing'), { fieldMask: ['title', 'revision'] });
  assert.equal(snapshots[0].id, 'found'); assert.equal(snapshots[0].exists, true);
  assert.equal(snapshots[1].exists, false); assert.equal(snapshots[1].data(), undefined);
  assert.deepEqual(snapshots[0].data().corePointFinds, ['point']);
  assert.deepEqual(snapshots[0].data().flags, { active: true, absent: null });
  assert.equal(snapshots[0].data().updatedAt.nanoseconds, 123000000);
  assert.deepEqual(requests.at(-1).body.mask, { fieldPaths: ['title', 'revision'] }); checks++;

  respond = () => [{ document: { name: base + '/semester_enrollments/enrollment-100', fields: { studentUid: { stringValue: 'synthetic' } } } }];
  const query = db.collection('semester_enrollments').where('semesterId', '==', semesterId)
    .where('enrollmentStatus', '==', 'ACTIVE').orderBy('__name__').select('studentUid').limit(100);
  const first = await query.get(); await query.startAfter(first.docs[0]).get();
  const { url, body } = requests.at(-1);
  assert.equal(url, 'https://firestore.googleapis.com/v1/' + base + ':runQuery');
  assert.deepEqual(body.structuredQuery, {
    from: [{ collectionId: 'semester_enrollments' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    select: { fields: [{ fieldPath: 'studentUid' }] }, limit: 100,
    startAt: { values: [{ referenceValue: base + '/semester_enrollments/enrollment-100' }], before: false },
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'semesterId' }, op: 'EQUAL', value: { stringValue: semesterId } } },
      { fieldFilter: { field: { fieldPath: 'enrollmentStatus' }, op: 'EQUAL', value: { stringValue: 'ACTIVE' } } },
    ] } },
  }); checks++;
  respond = () => [{ readTime: '2026-11-23T01:00:00Z' }];
  const empty = await db.collection(root + '/lesson_progress/synthetic/units').select('corePointFinds').get();
  assert.equal(empty.empty, true);
  assert.equal(requests.at(-1).url, 'https://firestore.googleapis.com/v1/' + base + '/' + root + '/lesson_progress/synthetic:runQuery');
  assert.deepEqual(requests.at(-1).body.structuredQuery.from, [{ collectionId: 'units' }]); checks++;
  respond = body => body.documents.map(missing => ({ missing })).reverse();
  const many = await db.getAll(...Array.from({ length: 300 }, (_, index) => db.doc(`receipts/${index}`)), { fieldMask: ['delta'] });
  assert.equal(many.length, 300); assert.equal(many[299].id, '299'); checks++;
  respond = () => [];
  await assert.rejects(db.getAll(db.doc('test/incomplete')), /Incomplete Firestore batch/);
  respond = () => [{ found: { name: base + '/other/unrequested' } }];
  await assert.rejects(db.getAll(db.doc('test/incomplete')), /Unexpected or duplicate/); checks++;
}
console.log(JSON.stringify({ passed: true, checks, network: 0, productionReads: 0, productionWrites: 0,
  guarantees: ['active-semester enrollment server filters', 'complete cursor pagination', 'canonical and legacy duplicate exclusion',
    'reclaim/history manual review', 'unpaid-only progress', 'current class visibility', 'source and plan hashes', 'read-only repeat',
    'REST equality filters and cursor serialization', 'scoped query parent and field masks', 'unordered batchGet reconciliation', 'curl stdin credential isolation'] }));
