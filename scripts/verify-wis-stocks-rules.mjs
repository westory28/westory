// firebase emulators:exec --only firestore --config firebase.wis-stocks-test.json --project demo-westory-wis-stocks "node scripts/verify-wis-stocks-rules.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
const projectId = 'demo-westory-wis-stocks';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18256');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisStockHandlers } = require('./wisStocks');
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18256, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const app = initializeApp({ projectId }), db = getFirestore(app);
const root = 'years/2026/semesters/2';
let clock = 1794643200000;
const api = createWisStockHandlers({ db, assertSession: async request => ({ uid: request.auth.uid, email: request.auth.token.email }), now: () => clock });
const request = data => ({ auth: { uid: 'manager', token: { email: 'manager@yongshin-ms.ms.kr' } }, data: { year: '2026', semester: '2', ...data } });
const settings = { name: '합성 주식', description: '', period: '합성 시대', initialPrice: 100, minimumPrice: 1, maximumPrice: 1000, volatilityBps: 0, trendBps: 300, intervalHours: 1, automatic: true };
try {
  await env.clearFirestore();
  const authTime = Math.floor(Date.now() / 1000) - 60;
  await db.doc('site_settings/config').set({ year: '2026', semester: '2' });
  await db.doc('site_settings/semester_active').set({ semesterId: '2026-2' });
  await db.doc('semester_manifests/2026-2').set({ status: 'ACTIVE' });
  for (const uid of ['manager', 'student', 'admin']) {
    await db.doc(`users/${uid}`).set(uid === 'manager' ? { role: 'teacher' }
      : { role: uid === 'student' ? 'student' : 'teacher', teacherPortalEnabled: true, staffPermissions: ['point_read', 'point_manage'] });
    await db.doc(`application_sessions/${uid}/sessions/${authTime}`).set({ schemaVersion: 2, status: 'active', authTime, authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, sessionRevision: 'a'.repeat(64), authorityModeAtOpen: 'ENFORCE', generalExpiresAt: new Date(Date.now() + 3600000) });
  }
  assert.equal((await api.getWisStockManagement(request({}))).revision, 0);
  const command = request({ expectedRevision: 0, stockId: '', settings, requestId: 'concurrent-stock-request-1' });
  const created = await Promise.all(Array.from({ length: 8 }, () => api.saveWisStock(command)));
  assert(created.every(item => item.stocks.length === 1 && item.savedStockId === created[0].savedStockId));
  assert.equal((await db.collection(`${root}/wis_stock_receipts`).get()).size, 1);
  clock += 3600000;
  await Promise.all(Array.from({ length: 8 }, () => api.advanceWisStockPrices()));
  const market = await api.getWisStockManagement(request({}));
  assert.equal(market.stocks[0].price, 103); assert.equal(market.stocks[0].history.length, 2); assert.equal(market.revision, 2);
  const edits = await Promise.allSettled(['첫 수정', '둘째 수정'].map((name, index) => api.saveWisStock(request({ expectedRevision: 2,
    stockId: market.stocks[0].id, settings: { ...settings, name }, requestId: `conflicting-stock-request-${index}` }))));
  assert.equal(edits.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(edits.filter(item => item.status === 'rejected' && item.reason.details.reason === 'WIS_STOCK_REVISION_CONFLICT').length, 1);
  const receiptId = (await db.collection(`${root}/wis_stock_receipts`).limit(1).get()).docs[0].id;
  for (const uid of ['manager', 'student', 'admin']) {
    const client = env.authenticatedContext(uid, { email: uid === 'admin' ? 'westoria28@gmail.com' : `${uid}@yongshin-ms.ms.kr`, auth_time: authTime }).firestore();
    await assertSucceeds(getDoc(doc(client, `users/${uid}`)));
    for (const [collectionName, id] of [['wis_stock_markets', 'current'], ['wis_stock_receipts', receiptId]]) {
      const target = doc(client, `${root}/${collectionName}/${id}`);
      await assertFails(getDoc(target)); await assertFails(getDocs(collection(client, `${root}/${collectionName}`)));
      await assertFails(setDoc(target, { studentOpen: true })); await assertFails(updateDoc(target, { studentOpen: true })); await assertFails(deleteDoc(target));
    }
  }
  await assert.rejects(api.getWisStockManagement({ ...request({}), auth: { uid: 'student', token: { email: 'student@yongshin-ms.ms.kr' } } }), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  const beforeDenied = await db.doc(`${root}/wis_stock_markets/current`).get();
  await db.doc('users/manager').set({ role: 'teacher', disabled: true });
  await assert.rejects(api.getWisStockManagement(request({})), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  await assert.rejects(api.saveWisStock(command), error => error.details?.reason === 'WIS_STOCK_TEACHER_REQUIRED');
  assert.deepEqual((await db.doc(`${root}/wis_stock_markets/current`).get()).data(), beforeDenied.data());
  console.log('PASS actual Firestore: teacher-role-only read/write, 8-way duplicate save, 8-way scheduler, competing edits, disabled teacher/student API denial, all direct client read/write/list/delete paths denied.');
} finally { await env.cleanup(); await deleteApp(app); }
