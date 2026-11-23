// Synthetic Firestore emulator only. Never reads or writes the live project.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, limit } from 'firebase/firestore';
const projectId = 'demo-westory-wispi-access';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18259');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisStockHandlers, marketPath, publicStockPath } = require('../functions/wisStocks');
const app = initializeApp({ projectId }), db = getFirestore(app);
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18259, rules } });
const scope = { year: '2026', semester: '2', semesterId: '2026-2' }, prefix = 'years/2026/semesters/2';
const statusPath = publicStockPath(scope, 'current'), pricesPath = publicStockPath(scope, 'market');
const authTime = Math.floor(Date.now() / 1000) - 30;
const session = uid => ({ uid, authTime, status: 'active', schemaVersion: 2, protocolVersion: 2,
  authorityGeneration: 'w1r2-2026-08-09', sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE',
  generalExpiresAt: new Date(Date.now() + 3600000) });
const client = (uid, token = {}) => env.authenticatedContext(uid, { email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime, ...token }).firestore();
const request = data => ({ auth: { uid: 'teacher', token: { email: 'teacher@yongshin-ms.ms.kr' } }, data: { year: '2026', semester: '2', ...data } });
let clock = Date.parse('2026-11-16T00:00:00Z');
const commits = [], reads = [];
const observedDb = { doc: path => db.doc(path), runTransaction: async (callback, options) => {
  const attempts = [];
  const result = await db.runTransaction(async tx => {
    const writes = []; attempts.push(writes);
    const proxy = { get: ref => { reads.push(ref.path); return tx.get(ref); } };
    for (const name of ['set', 'update', 'create']) proxy[name] = (ref, ...args) => { writes.push(ref.path); tx[name](ref, ...args); };
    return callback(proxy);
  }, options);
  commits.push(attempts.at(-1)); return result;
} };
const api = createWisStockHandlers({ db: observedDb, assertSession: async req => ({ uid: req.auth.uid, email: req.auth.token.email }), now: () => clock });
const settings = { name: '합성 역사 종목', description: '학생의 실제 자료가 아닙니다.', period: '합성 시대', initialPrice: 100,
  minimumPrice: 1, maximumPrice: 10000, volatilityBps: 0, trendBps: 300, intervalHours: 1, automatic: true };
const accountId = 'wisacct_' + createHash('sha256').update('2026-2\nstudent').digest('hex');
const slotId = 'slot_' + accountId.slice(8, 48);
const accountPath = `${prefix}/wis_stock_accounts/${accountId}`;
const checks = [], observers = [];
function observe(database, target) {
  const events = [], errors = [], pending = new Set();
  const notify = () => [...pending].forEach(check => check());
  const stop = onSnapshot(doc(database, target), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata.fromCache) { events.push(snapshot); notify(); }
  }, error => { errors.push(error); notify(); });
  const value = { events, errors, stop, until(predicate) { return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(check); reject(new Error('Listener timeout: ' + target)); }, 10000);
    const check = () => { if (predicate(value)) { clearTimeout(timer); pending.delete(check); resolve(); } };
    pending.add(check); check();
  }); } }; observers.push(value); return value;
}
try {
  await env.clearFirestore();
  const seed = db.batch();
  for (const [uid, profile] of Object.entries({ teacher: { role: 'teacher' }, reader: { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['point_read'] },
    student: { role: 'student' }, other: { role: 'student' }, pending: { role: 'student', registrationApprovalStatus: 'PENDING' },
    disabled: { role: 'student', disabled: true }, deleted: { role: 'student', deletedAt: new Date() } })) {
    seed.set(db.doc(`users/${uid}`), { registrationApprovalStatus: 'APPROVED', ...profile });
    seed.set(db.doc(`application_sessions/${uid}/sessions/${authTime}`), session(uid));
    seed.set(db.doc(`student_identities/${uid}`), { studentUid: uid, accountStatus: 'ACTIVE' });
  }
  seed.set(db.doc('site_settings/config'), { year: '2026', semester: '2', studentMenuVisibility: { wispi: true } });
  seed.set(db.doc('site_settings/semester_active'), { semesterId: '2026-2', revision: 3 });
  seed.set(db.doc('semester_manifests/2026-2'), { semesterId: '2026-2', revision: 3, status: 'ACTIVE', readOnly: false });
  seed.set(db.doc(`semester_enrollment_slots/${slotId}`), { studentUid: 'student', semesterId: '2026-2', activeEnrollmentId: 'enrollment-synthetic', status: 'ACTIVE' });
  seed.set(db.doc('semester_enrollments/enrollment-synthetic'), { enrollmentId: 'enrollment-synthetic', studentUid: 'student', semesterId: '2026-2', enrollmentStatus: 'ACTIVE', classId: 'class-synthetic' });
  seed.set(db.doc('semester_classes/class-synthetic'), { classId: 'class-synthetic', semesterId: '2026-2', status: 'ACTIVE' });
  seed.set(db.doc(`semester_wis_accounts/${accountId}`), { accountId, studentUid: 'student', semesterId: '2026-2', schemaVersion: 1,
    policyVersion: 'w7-v1', status: 'ACTIVE', enrollmentId: 'enrollment-synthetic', classId: 'class-synthetic', balance: 10000 });
  seed.set(db.doc('site_settings/student_maintenance'), { enabled: false, blockedRoles: ['student'],
    bypassUids: Array.from({ length: 20 }, (_, index) => `unrelated_${index}`), title: '합성 점검', message: '합성 점검 자료',
    startedAt: null, updatedAt: new Date(), updatedBy: 'synthetic-admin', revision: 1 });
  seed.set(db.doc('semester_wis_accounts/protected-general'), { balance: 10000, earnedTotal: 10000, rankEarnedTotal: 300, revision: 1 });
  await seed.commit();
  const student = client('student'), other = client('other');
  const marketDisplayPath = `${prefix}/wis_stock_display/market`;
  const trades = uid => collection(client(uid), `${prefix}/wis_stock_display_trades`);
  await db.doc(`${prefix}/wis_stock_display_trades/example`).set({ atMs: 12, classKey: '3_1' });
  await assertSucceeds(getDoc(doc(client('teacher'), marketDisplayPath)));
  assert.equal((await assertSucceeds(getDocs(query(trades('teacher'), where('classKey', '==', '3_1'),
    orderBy('atMs', 'desc'), limit(20))))).size, 1);
  await assertFails(getDocs(trades('teacher')));
  await assertFails(getDocs(query(trades('teacher'), limit(21))));
  await assertFails(setDoc(doc(trades('teacher'), 'forged'), { atMs: 12 }));
  for (const uid of ['reader', 'pending', 'student']) {
    await assertFails(getDoc(doc(client(uid), marketDisplayPath)));
    await assertFails(getDocs(query(trades(uid), orderBy('atMs', 'desc'), limit(20))));
  }
  checks.push('Only a current teacher may open the exchange display and its bounded fills query; student and delegated point reader denied.');
  assert.equal((await assertSucceeds(getDoc(doc(student, statusPath)))).exists(), false);
  await assertFails(getDoc(doc(student, pricesPath)));
  assert.equal((await assertSucceeds(getDoc(doc(student, accountPath)))).exists(), false);
  await assertFails(getDoc(doc(other, accountPath)));
  await assertFails(getDoc(doc(student, `${prefix}/wis_stock_accounts/wisacct_${'a'.repeat(64)}`)));
  const firstAccount = observe(student, accountPath); await firstAccount.until(value => value.events.length === 1);
  const live = observe(student, statusPath); await live.until(value => value.events.length === 1);
  const created = await api.saveWisStock(request({ settings, stockId: '', expectedRevision: 0, requestId: 'synthetic-stock-create01' }));
  assert.equal((await db.doc(statusPath).get()).exists, false);
  const opened = await api.setWisStockMarketHalted(request({ halted: false, expectedRevision: created.revision, requestId: 'synthetic-first-open01' }));
  await live.until(value => value.events.some(event => event.data()?.studentOpen === true));
  assert.equal(commits.at(-1).length, 4);
  const published = (await assertSucceeds(getDoc(doc(student, pricesPath)))).data();
  assert.equal(published.revision, opened.revision); assert.equal(published.studentOpen, true);
  assert(!JSON.stringify(published).includes('priceSeed')); assert(!JSON.stringify(published).includes('priceModel'));
  const signal = (await db.doc(statusPath).get()).data();
  clock += 1800000; reads.length = 0;
  await api.advanceWisStockPrices(); assert.equal(commits.at(-1).length, 2); assert(!commits.at(-1).includes(statusPath));
  assert.deepEqual(reads.toSorted(), ['site_settings/config', 'site_settings/semester_active', 'semester_manifests/2026-2', marketPath(scope)].toSorted());
  assert.deepEqual((await db.doc(statusPath).get()).data(), signal);
  assert.equal((await getDoc(doc(student, pricesPath))).data().stocks[0].price, Math.round(created.stocks[0].price * 103 / 100));
  reads.length = 0;
  assert.equal((await api.advanceWisStockPrices()).changed, false);
  assert.deepEqual(reads, ['site_settings/config', marketPath(scope)]); assert.equal(commits.at(-1).length, 0);
  checks.push('Missing status and exact own account are readable before launch while page prices and other/missing-owner accounts are denied; first teacher open atomically publishes safe prices and status; a half-hour tick reads four documents and writes two, a same-slot retry reads two and writes zero, and the menu signal stays unchanged.');

  const closed = await api.setWisStockMarketHalted(request({ halted: true, expectedRevision: 0, requestId: 'synthetic-close-00001' }));
  await live.until(value => value.events.some(event => event.data()?.halted === true));
  assert.equal(closed.studentOpen, true); assert.equal(closed.tradingEpoch, 1);
  assert.equal((await assertSucceeds(getDoc(doc(student, pricesPath)))).data().rules.halted, true);
  const reopened = await api.setWisStockMarketHalted(request({ halted: false, expectedRevision: closed.revision, requestId: 'synthetic-reopen-0001' }));
  assert.equal(reopened.tradingEpoch, 1);
  checks.push('Closing leaves studentOpen latched and page reads available for the blur overlay; reopening never resets the order generation.');

  const legacyAccount = { schemaVersion: 1, accountId, semesterId: '2026-2', studentUid: 'student', enrollmentId: 'enrollment-synthetic',
    enrollmentSlotId: slotId, classId: 'class-synthetic', revision: 1, stockCash: 1000, reservedCash: 0 };
  await db.doc(accountPath).set(legacyAccount);
  await firstAccount.until(value => value.events.some(event => event.exists()));
  assert.deepEqual((await assertSucceeds(getDoc(doc(student, accountPath)))).data(), legacyAccount);
  const ownAccount = { ...legacyAccount, schemaVersion: 2, revision: 2, eventBonusRestrictionVersion: 1,
    eventBonusTotal: 500, eventBonusRestrictedCash: 500, eventBonusReservedCash: 0,
    eventBonusLossCarryforward: 0, eventBonusLegacyWithdrawn: 0 };
  await db.doc(accountPath).set(ownAccount);
  await firstAccount.until(value => value.errors.length || value.events.some(event => event.data()?.schemaVersion === 2));
  assert.deepEqual(firstAccount.errors, [], 'An existing own-account listener must survive the bonus schema migration');
  assert.deepEqual(firstAccount.events.at(-1).data(), ownAccount); firstAccount.stop();
  const bonusClient = client('student'), bonusAccount = observe(bonusClient, accountPath);
  await bonusAccount.until(value => value.errors.length || value.events.length);
  assert.deepEqual(bonusAccount.errors, [], 'A fresh own-account listener must accept migrated bonus accounts');
  assert.deepEqual(bonusAccount.events.at(-1).data(), ownAccount); bonusAccount.stop();
  await db.doc(accountPath).update({ schemaVersion: 3 });
  await assertFails(getDoc(doc(bonusClient, accountPath)));
  const unsupportedAccount = observe(bonusClient, accountPath);
  await unsupportedAccount.until(value => value.errors.length);
  assert.equal(unsupportedAccount.errors[0].code, 'permission-denied'); unsupportedAccount.stop();
  await db.doc(accountPath).set(ownAccount);
  const retriedAccount = observe(bonusClient, accountPath);
  await retriedAccount.until(value => value.errors.length || value.events.length);
  assert.deepEqual(retriedAccount.errors, [], 'An explicit resubscription must recover after the account schema is supported');
  assert.deepEqual(retriedAccount.events.at(-1).data(), ownAccount); retriedAccount.stop();
  for (const [field, invalid] of [['studentUid', 'other'], ['semesterId', '2025-2'], ['accountId', 'wisacct_' + 'b'.repeat(64)]]) {
    await db.doc(accountPath).update({ [field]: invalid });
    await assertFails(getDoc(doc(client('student'), accountPath)));
    await db.doc(accountPath).set(ownAccount);
  }
  assert.deepEqual((await assertSucceeds(getDoc(doc(student, accountPath)))).data(), ownAccount);
  checks.push('Version 1 own accounts remain readable; live migration to bonus schema 2, fresh schema 2 subscriptions and explicit recovery succeed. Unknown schema 3 and mismatched owner/account/semester remain denied.');
  for (const database of [other, client('teacher'), client('reader'), env.unauthenticatedContext().firestore()])
    await assertFails(getDoc(doc(database, accountPath)));
  await assertFails(getDocs(collection(student, `${prefix}/wis_stock_accounts`)));
  await db.doc('site_settings/config').update({ 'studentMenuVisibility.wispi': false });
  const hiddenClient = client('student');
  await assertFails(getDoc(doc(hiddenClient, statusPath))); await assertFails(getDoc(doc(hiddenClient, pricesPath)));
  assert.deepEqual((await assertSucceeds(getDoc(doc(student, accountPath)))).data(), ownAccount);
  await api.setWisStockMarketHalted(request({ halted: true, expectedRevision: 0, requestId: 'synthetic-close-00002' }));
  // Dependency-only changes are cleared by the client's live config/session
  // guards. Rules also revoke an existing listener on its next publication.
  await live.until(value => value.errors.length === 1); assert.equal(live.errors[0].code, 'permission-denied');
  await assertSucceeds(getDoc(doc(student, accountPath)));
  await db.doc('site_settings/config').update({ 'studentMenuVisibility.wispi': true });
  checks.push('Interface hiding denies both public documents and revokes the listener on its next publication; the client live config guard must clear dependency-only changes. Own account stays readable while hidden/stopped; other students/teacher/raw list cannot read it.');

  for (const uid of ['pending', 'disabled', 'deleted']) await assertFails(getDoc(doc(client(uid), statusPath)));
  await assertFails(getDoc(doc(client('student', { auth_time: authTime - 1 }), statusPath)));
  await assertFails(getDoc(doc(client('student', { email: 'student@external.invalid' }), statusPath)));
  for (const target of [marketPath(scope), `${prefix}/wis_stock_receipts/private`, `${prefix}/wis_stock_supplies/private`,
    `${prefix}/wis_stock_orders/private`, `${prefix}/wis_stock_public/private`, 'years/2025/semesters/2/wis_stock_public/current'])
    for (const uid of ['student', 'teacher']) await assertFails(getDoc(doc(client(uid), target)));
  for (const target of [statusPath, pricesPath, accountPath]) {
    await assertFails(setDoc(doc(student, target), {})); await assertFails(updateDoc(doc(student, target), { revision: 999 }));
    await assertFails(deleteDoc(doc(student, target)));
  }
  await assertFails(getDocs(collection(student, `${prefix}/wis_stock_public`)));
  await db.doc(statusPath).update({ priceSeed: 'must-never-be-readable' }); await assertFails(getDoc(doc(student, statusPath)));
  await db.doc(statusPath).set(signal);
  checks.push('Disabled/deleted/unapproved/old/external sessions, wrong scopes, private seeds/orders/supplies/receipts, extra publication fields, enumeration and all student writes are denied.');

  for (const [target, field, invalid, restored] of [
    ['semester_enrollments/enrollment-synthetic', 'enrollmentStatus', 'CLOSED', 'ACTIVE'],
    [`semester_enrollment_slots/${slotId}`, 'activeEnrollmentId', 'replacement', 'enrollment-synthetic'],
    ['semester_classes/class-synthetic', 'status', 'CLOSED', 'ACTIVE'],
    ['student_identities/student', 'accountStatus', 'CLOSED', 'ACTIVE'],
    [`semester_wis_accounts/${accountId}`, 'status', 'CLOSED', 'ACTIVE'],
    [`semester_wis_accounts/${accountId}`, 'schemaVersion', 2, 1],
  ]) {
    await db.doc(target).update({ [field]: invalid }); await assertFails(getDoc(doc(student, accountPath)));
    await db.doc(target).update({ [field]: restored }); await assertSucceeds(getDoc(doc(student, accountPath)));
  }
  await db.doc('semester_classes/class-moved').set({ classId: 'class-moved', semesterId: '2026-2', status: 'ACTIVE' });
  await db.doc('semester_enrollments/enrollment-synthetic').update({ classId: 'class-moved' });
  await db.doc(`semester_wis_accounts/${accountId}`).update({ classId: 'class-moved' });
  assert.deepEqual((await assertSucceeds(getDoc(doc(client('student'), accountPath)))).data(), ownAccount);
  await db.doc('semester_enrollments/enrollment-rejoined').set({ enrollmentId: 'enrollment-rejoined', studentUid: 'student',
    semesterId: '2026-2', enrollmentStatus: 'ACTIVE', classId: 'class-moved' });
  await db.doc(`semester_enrollment_slots/${slotId}`).update({ activeEnrollmentId: 'enrollment-rejoined' });
  await db.doc(`semester_wis_accounts/${accountId}`).update({ enrollmentId: 'enrollment-rejoined' });
  assert.deepEqual((await assertSucceeds(getDoc(doc(client('student'), accountPath)))).data(), ownAccount);
  await db.doc(`semester_wis_accounts/${accountId}`).update({ studentUid: 'other' });
  await assertFails(getDoc(doc(client('student'), accountPath)));
  await db.doc(`semester_wis_accounts/${accountId}`).update({ studentUid: 'student' });
  await db.doc('site_settings/config').update({ year: '2027', semester: '1' });
  await assertSucceeds(getDoc(doc(client('student'), accountPath)));
  await assertFails(getDoc(doc(client('student'), statusPath)));
  await db.doc('site_settings/config').update({ year: '2026', semester: '2' });
  checks.push('The exact missing own account listener sees the first creation; canonical wallet/slot/enrollment/class ownership permits class moves and re-enrollment without mutating stale stock metadata. Personal scope follows only the canonical active pointer and manifest, staying within ten dependent documents with a full maintenance config.');
  const ownSessionPath = `application_sessions/student/sessions/${authTime}`;
  for (const uid of ['student', 'teacher', 'reader'])
    await assertSucceeds(getDoc(doc(client(uid), `application_sessions/${uid}/sessions/${authTime}`)));
  for (const uid of ['other', 'pending', 'disabled', 'deleted'])
    await assertFails(getDoc(doc(client(uid), ownSessionPath)));
  for (const uid of ['pending', 'disabled', 'deleted'])
    await assertFails(getDoc(doc(client(uid), `application_sessions/${uid}/sessions/${authTime}`)));
  await assertFails(getDocs(collection(student, 'application_sessions/student/sessions')));
  await assertFails(setDoc(doc(student, ownSessionPath), session('student')));
  await assertFails(updateDoc(doc(student, ownSessionPath), { status: 'closed' }));
  await assertFails(deleteDoc(doc(student, ownSessionPath)));
  await db.doc(`application_sessions/student/sessions/${authTime - 1}`).set({ ...session('student'), authTime: authTime - 1 });
  await assertFails(getDoc(doc(student, `application_sessions/student/sessions/${authTime - 1}`)));
  await assertFails(getDoc(doc(client('student', { auth_time: authTime - 1 }), ownSessionPath)));
  for (const [patch, restored] of [
    [{ generalExpiresAt: new Date(Date.now() - 1000) }, session('student')],
    [{ status: 'closed' }, session('student')],
    [{ uid: 'other' }, session('student')],
    [{ unexpectedPrivateField: 'must-not-publish' }, session('student')],
  ]) {
    await db.doc(ownSessionPath).set({ ...session('student'), ...patch });
    await assertFails(getDoc(doc(client('student'), ownSessionPath))).catch(error => {
      throw new Error('Session mutation was not denied: ' + Object.keys(patch).join(','), { cause: error });
    });
    if ('generalExpiresAt' in patch || 'status' in patch)
      await assertFails(getDoc(doc(client('student'), accountPath)));
    await db.doc(ownSessionPath).set(restored);
  }
  await db.doc('student_identities/student').update({ accountStatus: 'CLOSED' });
  await assertFails(getDoc(doc(student, ownSessionPath)));
  await db.doc('student_identities/student').update({ accountStatus: 'ACTIVE' });
  const maintenanceRef = db.doc('site_settings/student_maintenance'), maintenance = (await maintenanceRef.get()).data();
  await maintenanceRef.update({ enabled: true, startedAt: new Date() });
  await assertFails(getDoc(doc(client('student'), ownSessionPath)));
  await assertFails(getDoc(doc(client('student'), accountPath)));
  await assertSucceeds(getDoc(doc(client('teacher'), `application_sessions/teacher/sessions/${authTime}`)));
  await maintenanceRef.update({ bypassUids: ['student', ...maintenance.bypassUids.slice(1)] });
  await assertSucceeds(getDoc(doc(client('student'), ownSessionPath)));
  await assertSucceeds(getDoc(doc(client('student'), accountPath)));
  await maintenanceRef.update({ bypassUids: [12] });
  await assertFails(getDoc(doc(client('student'), ownSessionPath)));
  await assertFails(getDoc(doc(client('student'), accountPath)));
  await maintenanceRef.set(maintenance);
  const sessionLive = observe(student, ownSessionPath); await sessionLive.until(value => value.events.length === 1);
  await db.doc(ownSessionPath).update({ status: 'closed' });
  await sessionLive.until(value => value.errors.length === 1);
  await assertFails(getDoc(doc(student, statusPath))); await assertFails(getDoc(doc(student, accountPath)));
  await db.doc(ownSessionPath).set(session('student'));
  checks.push('Authorized students and unchanged teacher roles can observe only their own current active session with the existing field allowlist; other/old/expired/unapproved/disabled/deleted sessions, enumeration and all writes are denied. Closing the observed session immediately rejects its listener.');
  await db.doc('site_settings/semester_active').update({ semesterId: '2027-1' });
  await assertFails(getDoc(doc(student, statusPath))); await assertFails(getDoc(doc(student, accountPath)));
  checks.push('Bonus schema 2 accounts retain general-wallet schema 1, active identity/enrollment/slot/class, unexpired active session, maintenance and active-semester boundaries; each invalidation denies reads.');
  assert.deepEqual((await db.doc('semester_wis_accounts/protected-general').get()).data(), { balance: 10000, earnedTotal: 10000, rankEarnedTotal: 300, revision: 1 });
  assert.deepEqual((await db.doc(accountPath).get()).data(), ownAccount);
  assert.equal(readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), rules, 'Rules changed during test');
  const report = { projectId, passed: checks.length, checks, productionReads: 0, productionWrites: 0,
    rulesHash: createHash('sha256').update(rules).digest('hex'), accountMutationsByCommands: 0 };
  const output = new URL('../output/wispi-access-20261115/server/', import.meta.url);
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(new URL('access-rules.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { observers.forEach(observer => observer.stop()); await env.cleanup(); await deleteApp(app); }
