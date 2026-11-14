// Dedicated synthetic emulator only. Never connects to production or seeds live data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { normalizeWisStockInvestmentBoardScope as scope, buildWisStockInvestmentBoard as build,
  parseWisStockInvestmentBoardSnapshot as parse, parseWisStockInvestmentBoardSession as parseSession } from '../functions/wisStockInvestmentBoard.mjs';
const projectId = 'demo-westory-wispi-board';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18257');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const auditedFiles = ['firestore.rules', 'functions/wisStockInvestmentBoard.mjs', 'functions/wisStockInvestmentBoard.d.mts'];
const sourceHashes = () => Object.fromEntries(auditedFiles.map(file => [file,
  createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex')]));
const initialHashes = sourceHashes();
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18257,
  rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const app = initializeApp({ projectId }), db = getFirestore(app);
const prefix = 'years/2026/semesters/2', allPath = `${prefix}/wis_stock_investment_boards/all`;
const classPath = `${prefix}/wis_stock_investment_boards/class_3_1`;
const currentScope = scope({ year: '2026', semester: '2' }), authTime = Math.floor(Date.now() / 1000) - 30;
const checks = [], observers = [];
const user = (role, extra = {}) => ({ role, registrationApprovalStatus: 'APPROVED', ...extra });
const activeSession = uid => ({ uid, email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`,
  schemaVersion: 2, status: 'active', authTime, authorityGeneration: 'w1r2-2026-08-09',
  protocolVersion: 2, sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: new Date(Date.now() + 3600000) });
const client = (uid, token = {}) => env.authenticatedContext(uid, { email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime, ...token }).firestore();
function observe(database, target) {
  const events = [], errors = [], waiting = new Set();
  const notify = () => { for (const check of [...waiting]) check(); };
  const stop = onSnapshot(doc(database, target), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata.fromCache) { events.push(snapshot); notify(); }
  }, error => { errors.push(error); notify(); });
  const watch = { events, errors, stop, until(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(check); reject(new Error(`Listener did not reach expected state: ${target}`)); }, 10000);
      const check = () => { if (predicate(watch)) { clearTimeout(timer); waiting.delete(check); resolve(); } };
      waiting.add(check); check();
    });
  } };
  observers.push(watch); return watch;
}
const source = (revision = 1, boardScope = currentScope) => build({ scope: boardScope, revision, asOfMs: Date.now(), sourceRevision: revision, priceRevision: 2,
  classes: [{ grade: '3', classNumber: '1' }], rows: [{ studentKey: `student_${'a'.repeat(24)}`, grade: '3', classNumber: '1', studentNumber: '1',
    displayName: '합성 학생', stockCash: 1000, reservedCash: 200, holdingCount: 1, holdingValue: 600, holdingCostBasis: 500, realizedPnl: 40 }] });
try {
  await env.clearFirestore();
  const seed = db.batch();
  const profiles = { teacher: user('teacher'), reader: user('staff', { teacherPortalEnabled: true, staffPermissions: ['point_read'] }),
    manager: user('staff', { teacherPortalEnabled: true, staffPermissions: ['point_manage'] }), student: user('student'),
    impostor: user('student', { teacherPortalEnabled: true, staffPermissions: ['point_manage'] }), staff: user('staff'), admin: user('staff'),
    pending: user('teacher', { registrationApprovalStatus: 'PENDING' }), disabled: user('teacher', { disabled: true }),
    deleted: user('teacher', { deletedAt: new Date() }) };
  for (const [uid, profile] of Object.entries(profiles)) {
    seed.set(db.doc(`users/${uid}`), profile);
    seed.set(db.doc(`application_sessions/${uid}/sessions/${authTime}`), activeSession(uid));
  }
  seed.set(db.doc('site_settings/config'), { year: '2026', semester: '2', activeSemesterId: '2026-2' });
  seed.set(db.doc('site_settings/semester_active'), { semesterId: '2026-2', revision: 3 });
  seed.set(db.doc('semester_manifests/2026-2'), { semesterId: '2026-2', status: 'ACTIVE', readOnly: false, revision: 3 });
  seed.set(db.doc('site_settings/student_maintenance'), { enabled: true, blockedRoles: ['student'],
    bypassUids: Array.from({ length: 20 }, (_, index) => `unrelated_${index}`), title: '합성 점검', message: '합성 점검 자료',
    startedAt: new Date(), updatedAt: new Date(), updatedBy: 'synthetic-admin', revision: 1 });
  seed.set(db.doc(`${prefix}/wis_stock_markets/current`), { priceSeed: 'private-server-only', studentOpen: false });
  seed.set(db.doc('semester_wis_accounts/protected'), { balance: 700, earnedTotal: 900, rankEarnedTotal: 400, revision: 3 });
  await seed.commit();
  const protectedBefore = (await db.doc('semester_wis_accounts/protected').get()).data();

  for (const uid of ['teacher', 'reader', 'manager', 'admin']) {
    const absent = await assertSucceeds(getDoc(doc(client(uid), allPath)));
    assert.equal(absent.exists(), false); assert.equal(parse(null, currentScope).totals, null);
    await assertSucceeds(getDoc(doc(client(uid), classPath)));
  }
  for (const uid of ['student', 'impostor', 'staff', 'pending', 'disabled', 'deleted'])
    await assertFails(getDoc(doc(client(uid), allPath)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), allPath)));
  await assertFails(getDoc(doc(client('teacher', { email: 'teacher@external.invalid' }), allPath)));
  await assertFails(getDoc(doc(client('teacher', { auth_time: authTime - 1 }), allPath)));
  checks.push('Exact missing-document reads allow only active approved teacher/admin/point staff even with the full 20-entry maintenance fence; students, forged point permissions, disabled/deleted/unapproved/external/old sessions are denied');

  const live = observe(client('teacher'), allPath);
  await live.until(w => w.events.length === 1);
  assert.equal(parse(live.events[0].data(), currentScope).status, 'NOT_READY');
  await db.doc(allPath).set(source());
  await live.until(w => w.events.some(event => event.data()?.revision === 1));
  assert.equal(parse(live.events.at(-1).data(), currentScope).totals.totalAssets, 1600);
  await db.doc(allPath).set(source(2));
  await live.until(w => w.events.some(event => event.data()?.revision === 2));
  await db.doc(allPath).delete();
  await live.until(w => w.events.length >= 4 && !w.events.at(-1).exists());
  assert.equal(parse(live.events.at(-1).data(), currentScope).totals, null);
  live.stop();
  await db.doc(allPath).set(source(3));
  await db.doc(classPath).set(source(3, scope({ year: '2026', semester: '2', grade: '3', classNumber: '1' })));
  checks.push('One document listener observes NOT_READY then first trusted feed, replacement and deletion without polling or fabricated zero totals');

  for (const uid of ['teacher', 'reader', 'manager', 'admin']) {
    const database = client(uid);
    await assertSucceeds(getDoc(doc(database, classPath)));
    await assertFails(getDocs(collection(database, `${prefix}/wis_stock_investment_boards`)));
    for (const target of [allPath, classPath]) {
      await assertFails(setDoc(doc(database, target), source()));
      await assertFails(updateDoc(doc(database, target), { revision: 999 }));
      await assertFails(deleteDoc(doc(database, target)));
    }
    for (const target of [`${prefix}/wis_stock_investment_boards/class_4_1`, `${prefix}/wis_stock_investment_boards/private`,
      'years/2025/semesters/2/wis_stock_investment_boards/all', `${prefix}/wis_stock_markets/current`,
      `${prefix}/wis_stock_receipts/private`, `${prefix}/wis_stock_accounts/student`, `${prefix}/wis_stock_orders/private`])
      await assertFails(getDoc(doc(database, target)));
  }
  checks.push('All exact class reads work; collection enumeration, every client write, wrong semester/scope and raw market seed/account/order/receipt reads stay denied even for admin');

  for (const uid of ['teacher', 'reader', 'manager', 'admin']) {
    const database = client(uid), target = `application_sessions/${uid}/sessions/${authTime}`;
    const session = await assertSucceeds(getDoc(doc(database, target)));
    assert.ok(parseSession(session.data(), { uid, authTime }, Date.now()).deadlineAtMs > Date.now());
    await assertFails(getDocs(collection(database, `application_sessions/${uid}/sessions`)));
    await assertFails(getDoc(doc(database, `application_sessions/${uid}/sessions/${authTime - 1}`)));
    await assertFails(getDoc(doc(database, `application_sessions/${uid === 'teacher' ? 'admin' : 'teacher'}/sessions/${authTime}`)));
    await assertFails(setDoc(doc(database, target), activeSession(uid)));
    await assertFails(updateDoc(doc(database, target), { status: 'active' }));
    await assertFails(deleteDoc(doc(database, target)));
  }
  for (const uid of ['student', 'impostor', 'staff', 'pending', 'disabled', 'deleted'])
    await assertFails(getDoc(doc(client(uid), `application_sessions/${uid}/sessions/${authTime}`)));
  for (const patch of [{ semesterId: '2025-2' }, { priceSeed: 'private' }, { complete: false }, { grade: '3', classNumber: '2' }]) {
    await db.doc(allPath).set({ ...source(3), ...patch });
    await assertFails(getDoc(doc(client('teacher'), allPath)));
  }
  await db.doc(allPath).set(source(3));
  checks.push('Current-own-session fence permits only board-authorized exact reads; student/other-owner/other-auth-time/list/write denied; misplaced or private-field board payloads are denied by rules before delivery');

  const revoked = observe(client('reader'), allPath);
  await revoked.until(w => w.events.length === 1);
  await db.doc('users/reader').update({ staffPermissions: [] });
  await assertFails(getDoc(doc(client('reader'), allPath)));
  await db.doc(allPath).set(source(4));
  await revoked.until(w => w.errors.length === 1);
  assert.equal(revoked.errors[0].code, 'permission-denied'); assert.equal(revoked.events.length, 1);
  checks.push('Removed point_read denies fresh reads and the next feed update without leaking the changed board; immediate local clearing uses the existing own-profile AuthContext listener');

  const closed = observe(client('manager'), `application_sessions/manager/sessions/${authTime}`);
  await closed.until(w => w.events.length === 1);
  await db.doc(`application_sessions/manager/sessions/${authTime}`).update({ status: 'closed' });
  await closed.until(w => w.errors.length === 1); assert.equal(closed.errors[0].code, 'permission-denied');
  await db.doc('application_session_transitions/manager').set({ schemaVersion: 1, status: 'pending',
    authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, fromAuthTime: authTime - 1, expiresAt: new Date(Date.now() + 60000) });
  await assertFails(getDoc(doc(client('manager'), classPath)));
  checks.push('Session closure immediately revokes the own-session authority listener; a reauthentication transition does not reopen the projection');

  const expired = observe(client('teacher'), `application_sessions/teacher/sessions/${authTime}`);
  await expired.until(w => w.events.length === 1);
  await db.doc(`application_sessions/teacher/sessions/${authTime}`).update({ generalExpiresAt: new Date(Date.now() - 1000) });
  await expired.until(w => w.errors.length === 1); assert.equal(expired.errors[0].code, 'permission-denied');
  await db.doc(`application_sessions/teacher/sessions/${authTime}`).set(activeSession('teacher'));
  const changedScope = observe(client('teacher'), allPath);
  await changedScope.until(w => w.events.length === 1);
  await db.doc('site_settings/semester_active').update({ semesterId: '2027-1' });
  await assertFails(getDoc(doc(client('teacher'), allPath)));
  await db.doc(allPath).set(source(5));
  await changedScope.until(w => w.errors.length === 1); assert.equal(changedScope.errors[0].code, 'permission-denied');
  await db.doc('site_settings/semester_active').update({ semesterId: '2026-2' });
  const readonly = observe(client('teacher'), allPath);
  await readonly.until(w => w.events.length === 1);
  await db.doc('semester_manifests/2026-2').update({ readOnly: true });
  await assertFails(getDoc(doc(client('teacher'), allPath)));
  await db.doc(allPath).set(source(6));
  await readonly.until(w => w.errors.length === 1); assert.equal(readonly.errors[0].code, 'permission-denied');
  checks.push('Own-session expiry update revokes the authority listener immediately; active-semester/read-only changes deny fresh reads and the next feed update');

  assert.deepEqual((await db.doc('semester_wis_accounts/protected').get()).data(), protectedBefore);
  assert.deepEqual((await db.doc(`${prefix}/wis_stock_markets/current`).get()).data(), { priceSeed: 'private-server-only', studentOpen: false });
  assert.deepEqual(sourceHashes(), initialHashes, 'Audited runtime/rules changed during the test');
  const report = { projectId, checks, passed: checks.length, sourceHashes: initialHashes, productionWrites: 0,
    stockOrGeneralWalletMutations: 0, listenerDocumentScope: 1, authorityListenerDocumentScope: 1, pollingRequests: 0,
    budget: 'Each active scope watches one projection plus the current-own-session document. Rules evaluate up to six distinct session/profile/maintenance/config/pointer/manifest dependencies. Idle listeners do not poll; existing profile/config listeners provide immediate context revocation.' };
  const directory = new URL('../output/wispi-board-20261115/backend/', import.meta.url);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(new URL('investment-board-rules.json', directory), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  observers.forEach(observer => observer.stop());
  await env.cleanup(); await deleteApp(app);
}
