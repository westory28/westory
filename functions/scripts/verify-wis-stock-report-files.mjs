// Run from the root with the normal Firebase CLI and Java runtime:
// firebase emulators:exec --only firestore --config firebase.wis-stock-access-test.json --project demo-westory-session-weekly-report-qa "node functions/scripts/verify-wis-stock-report-files.mjs"
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, setLogLevel } from 'firebase/firestore';

const projectId = 'demo-westory-session-weekly-report-qa';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const source = process.env.WIS_STOCK_REPORT_SOURCE_DIR || fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(source, 'package.json'));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }), db = getFirestore(app);
const api = require('./wisStockWeeklyReport').createWisStockWeeklyReport({ db });
const scope = { year: '2026', semester: '2' }, prefix = 'years/2026/semesters/2';
const week = '2026-11-23', reports = db.collection(prefix + '/wis_stock_weekly_reports');
const report = reports.doc(week), parts = report.collection('parts');
const pointer = { semesterId: '2026-2', revision: 1 };
const manifest = { ...pointer, status: 'ACTIVE' };
const authority = 'w1r2-2026-08-09', revision = 'd'.repeat(64);
const fresh = Math.floor(Date.now() / 1000) - 5, stale = fresh - 601;
const protectedPaths = ['wis_stock_public/market', 'wis_stock_markets/current', 'wis_stock_history/fill',
  'wis_stock_accounts/account', 'wis_stock_orders/order'].map(name => prefix + '/' + name);
const file = { fileName: 'fixture.txt', title: '합성 보고서', expectedRevision: 0,
  contentBase64: Buffer.from('합성 보고서 본문').toString('base64') };

function request(uid, action, fields = {}, authTime = fresh) {
  return {
    auth: uid ? { uid, token: { email: uid + '@yongshin-ms.ms.kr', auth_time: authTime } } : null,
    app: { appId: 'fixture-app' },
    data: { ...scope, action, weekStart: week, _session: { authorityGeneration: authority,
      protocolVersion: 2, revision }, ...fields },
  };
}

function session(uid, authTime) {
  return { uid, authTime, status: 'active', schemaVersion: 2, protocolVersion: 2,
    authorityGeneration: authority, sessionRevision: revision, authorityModeAtOpen: 'ENFORCE',
    generalExpiresAt: new Date(Date.now() + 3_600_000), highRiskExpiresAt: new Date(Date.now() + 3_600_000) };
}

const reject = (req, code) => assert.rejects(() => api(req), error => error.code === code);

async function verifyClientRules() {
  const port = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]);
  const rulesPath = process.env.WIS_STOCK_REPORT_RULES_FILE || fileURLToPath(new URL('../../firestore.rules', import.meta.url));
  const rules = await readFile(rulesPath, 'utf8');
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port, rules } });
  const protectedDocs = [report.path, parts.doc('0').path, prefix + '/wis_stock_report_intervals/' + week + '_AM',
    prefix + '/wis_stock_report_keys/continuations', prefix + '/wis_stock_history/fill'];
  setLogLevel('silent');
  try {
    const seed = db.batch();
    seed.set(db.doc('semester_manifests/2026-2'), manifest);
    seed.set(db.doc('site_settings/config'), { ...scope, studentMenuVisibility: { wispi: true } });
    seed.set(db.doc('student_identities/student'), { studentUid: 'student', accountStatus: 'ACTIVE' });
    const statusPath = prefix + '/wis_stock_public/current';
    seed.set(db.doc(statusPath), { schemaVersion: 1, semesterId: '2026-2', studentOpen: true, halted: false,
      tradingEpoch: 1, revision: 1, updatedAtMs: 12 });
    for (const name of protectedDocs) seed.set(db.doc(name), { fixture: 'protected', published: true });
    await seed.commit();

    for (const uid of ['student', 'staff', 'teacher', null]) {
      const client = uid ? env.authenticatedContext(uid, {
        email: uid + '@yongshin-ms.ms.kr', auth_time: fresh,
      }).firestore() : env.unauthenticatedContext().firestore();
      if (uid) assert((await assertSucceeds(getDoc(doc(client, 'users/' + uid)))).exists());
      if (uid === 'student') assert((await assertSucceeds(getDoc(doc(client, statusPath)))).exists());
      for (const name of protectedDocs) {
        const ref = doc(client, name);
        await assertFails(getDoc(ref));
        await assertFails(getDocs(query(collection(client, ref.parent.path), limit(1))));
        await assertFails(setDoc(ref, { fixture: 'overwritten' }));
        await assertFails(deleteDoc(ref));
      }
      await assertFails(getDocs(query(collectionGroup(client, 'parts'), limit(1))));
    }
    for (const name of protectedDocs) assert.equal((await db.doc(name).get()).data().fixture, 'protected');
  } finally {
    await env.cleanup();
  }
}

try {
  const seed = db.batch();
  seed.set(db.doc('site_settings/config'), scope);
  seed.set(db.doc('site_settings/semester_active'), pointer);
  const manifestRef = db.doc('semester_manifests/2026-2');
  seed.set(manifestRef, manifest);
  for (const [uid, role] of Object.entries({ teacher: 'teacher', other: 'teacher', student: 'student', staff: 'staff' })) {
    seed.set(db.doc('users/' + uid), { registrationApprovalStatus: 'APPROVED', role,
      teacherPortalEnabled: true, staffPermissions: ['point_read', 'point_manage'] });
    seed.set(db.doc('application_sessions/' + uid + '/sessions/' + fresh), session(uid, fresh));
  }
  seed.set(db.doc('application_sessions/teacher/sessions/' + stale), session('teacher', stale));
  for (const name of protectedPaths) seed.set(db.doc(name), { fixture: 'original' });
  await seed.commit();

  for (const uid of [null, 'student', 'staff']) {
    for (const action of ['read', 'list', 'publish']) {
      await reject(request(uid, action, file), uid ? 'permission-denied' : 'unauthenticated');
    }
  }
  await reject(request('teacher', 'publish', file, stale), 'failed-precondition');
  const invalidProof = request('teacher', 'read');
  invalidProof.data._session.revision = 'e'.repeat(64);
  await reject(invalidProof, 'unauthenticated');
  await reject(request('teacher', 'publish', { ...file, semester: '1' }), 'failed-precondition');
  assert.deepEqual(await api(request('teacher', 'read')), { report: null });

  const partBytes = 512 * 1024, bytes = Buffer.alloc(6 * partBytes, 0x41);
  for (let i = 0; i < 6; i++) bytes[i * partBytes] = 0x42 + i;
  const large = { ...file, contentBase64: bytes.toString('base64') };
  const initial = await api(request('teacher', 'publish', large));
  assert.equal(initial.report.revision, 1);
  const chunks = await parts.get();
  assert.equal(chunks.size, 6);
  assert(chunks.docs.every(chunk => chunk.data().bytes.length === partBytes));
  const modification = (await report.get()).updateTime;
  assert.deepEqual(await api(request('teacher', 'publish', large)), initial);
  assert((await report.get()).updateTime.isEqual(modification));
  const restored = (await api(request('other', 'read'))).report;
  assert.equal(restored.contentBase64, large.contentBase64);
  assert(!Object.hasOwn(restored, 'publishedBy') && !Object.hasOwn(restored, 'hash'));

  const competing = await Promise.allSettled(['teacher', 'other'].map(uid =>
    api(request(uid, 'publish', { ...file, title: uid, expectedRevision: 1 }))));
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(competing.find(r => r.status === 'rejected').reason.code, 'aborted');
  assert.equal((await parts.get()).size, 1);
  assert.equal((await api(request('teacher', 'read'))).report.contentBase64, file.contentBase64);
  await reject(request('teacher', 'publish', { ...file, expectedRevision: 2,
    contentBase64: Buffer.alloc(bytes.length + 1, 0x41).toString('base64') }), 'invalid-argument');
  await parts.doc('0').set({ bytes: Buffer.from('corrupt') });
  await reject(request('teacher', 'read'), 'data-loss');

  const priorWeeks = [], history = db.batch();
  for (let index = 1; index <= 14; index++) {
    const weekStart = new Date(Date.parse(week + 'T00:00:00Z') - index * 7 * 86_400_000).toISOString().slice(0, 10);
    priorWeeks.push(weekStart);
    history.set(reports.doc(weekStart), { ...initial.report, weekStart });
  }
  await history.commit();
  const first = await api(request('teacher', 'list'));
  assert(!first.reports.some(row => Object.hasOwn(row, 'contentBase64')));
  assert.deepEqual(first.reports.map(row => row.weekStart), [week, ...priorWeeks.slice(0, 11)]);
  assert.equal(first.nextBefore, priorWeeks[10]);
  const second = await api(request('teacher', 'list', { before: first.nextBefore }));
  assert.deepEqual(second.reports.map(row => row.weekStart), priorWeeks.slice(11));
  assert.equal(second.nextBefore, null);

  for (const change of [{ semesterId: '2026-1' }, { readOnly: true }, { status: 'CLOSED' }, { revision: 2 }]) {
    await manifestRef.set({ ...manifest, ...change });
    for (const action of ['list', 'read', 'publish']) {
      await reject(request('teacher', action, file), 'failed-precondition');
    }
  }
  for (const item of protectedPaths) assert.deepEqual((await db.doc(item).get()).data(), { fixture: 'original' });
  console.log('Weekly report files passed real-session roles, semester fencing, six-part round trip, replay, concurrent replacement, corrupt content, pagination and ledger isolation.');
  await verifyClientRules();
  console.log('84 direct client access checks denied for report metadata, parts, raw fills, archive intervals and private keys. Active student market read succeeded.');
} finally {
  await deleteApp(app);
}
