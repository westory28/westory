const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

// Never run the latency/settlement fixtures against a real project.
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'demo-westory-weplay' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Run with the isolated demo-westory-weplay Firestore emulator.');
}

// Optional local comparison: supply the previous weplay.js saved outside the
// checkout. Relative dependencies still resolve from the production module.
if (process.env.WEPLAY_BASELINE_SOURCE) {
  const filename = require.resolve('../weplay');
  const baseline = new Module(filename, module);
  baseline.filename = filename;
  baseline.paths = module.paths;
  baseline._compile(fs.readFileSync(process.env.WEPLAY_BASELINE_SOURCE, 'utf8'), filename);
  require.cache[filename] = baseline;
}

const firestore = require('@google-cloud/firestore');
let measurements = null;
const originals = [];
const projectedPaths = new WeakMap();
const select = firestore.Query.prototype.select;
originals.push(() => { firestore.Query.prototype.select = select; });
firestore.Query.prototype.select = function (...fields) {
  const query = select.apply(this, fields);
  projectedPaths.set(query, this.path || projectedPaths.get(this));
  return query;
};
for (const [prototype, method, kind] of [
  [firestore.DocumentReference.prototype, 'get', 'document'],
  [firestore.Query.prototype, 'get', 'query'],
  [firestore.Transaction.prototype, 'get', 'transaction'],
  [firestore.Transaction.prototype, 'getAll', 'batch'],
]) {
  const original = prototype[method];
  originals.push(() => { prototype[method] = original; });
  prototype[method] = async function (...args) {
    const metrics = measurements;
    const queryPath = this.path || projectedPaths.get(this);
    const row = { kind, paths: kind === 'query' || kind === 'document' ? [queryPath] : args.map((ref) => ref.path) };
    if (metrics) metrics.push(row);
    const result = await original.apply(this, args);
    if (metrics && kind === 'query' && /(^|\/)lessons$/.test(queryPath || '')) {
      row.lessonBytes = Buffer.byteLength(JSON.stringify(result.docs.map((doc) => doc.data())));
      row.hasOcr = result.docs.some((doc) => Object.hasOwn(doc.data(), 'worksheetOcrPages'));
    }
    return result;
  };
}

const api = require('../index');
const { getFirestore } = require('firebase-admin/firestore');
const { DEFAULT_POLICY } = require('../weplayCore');
const db = getFirestore();
const prefix = 'years/2026/semesters/2';
const call = (name, data = {}, uid = 'student') => api[name].run({
  auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr` } },
  data: { year: '2026', semester: '2', gameId: 'history-rain', difficulty: 'mild', ...data },
});
const get = async (path) => (await db.doc(path).get()).data();
const expected = new Set(['고조선', '훈민정음', '거북선', '천상열차분야지도', '정도전', '세종']);

async function measure(label, action) {
  measurements = [];
  const started = performance.now();
  const result = await action();
  const reads = measurements;
  measurements = null;
  const summary = {
    label, ms: Math.round(performance.now() - started), readRequests: reads.length,
    documentReads: reads.reduce((sum, row) => sum + (row.kind === 'query' ? 0 : row.paths.length), 0),
    lessonBytes: reads.reduce((sum, row) => sum + (row.lessonBytes || 0), 0),
  };
  if (!process.env.WEPLAY_BASELINE_SOURCE) {
    assert.ok(reads.filter((row) => row.lessonBytes).every((row) => !row.hasOcr), 'Lesson reads must omit unused OCR fields.');
    if (label.startsWith('lobby')) {
      assert.equal(reads.filter((row) => row.kind === 'document' && row.paths[0] === `${prefix}/weplay_players/student`).length, 1, 'An idle lobby must not re-read its player document.');
    }
  }
  console.log(JSON.stringify(summary));
  return result;
}

async function main() {
  const reset = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(reset.ok);
  await db.doc('site_settings/config').set({ year: '2026', semester: '2' });
  const users = ['student', 'fresh', ...Array.from({ length: 3 }, (_, index) => `practice-${index}`), ...Array.from({ length: 3 }, (_, index) => `challenge-${index}`)];
  for (const uid of users) {
    await db.doc(`users/${uid}`).set({ role: 'student', name: '검증학생', studentGrade: '2', studentClass: '1', email: `${uid}@yongshin-ms.ms.kr` });
    await db.doc(`${prefix}/point_wallets/${uid}`).set({ uid, balance: 30, earnedTotal: 30, rankEarnedTotal: 30, spentTotal: 0 });
  }
  await db.doc('users/teacher').set({ role: 'teacher', name: '검증 교사' });
  await db.doc(`${prefix}/weplay_policies/current`).set({ ...DEFAULT_POLICY, resultRewards: [{ minCorrect: 0, amount: 1 }] });
  await db.doc(`${prefix}/lessons/public`).set({ unitId: 'public', title: '공개 자료', contentHtml: '[고조선] [훈민정음] [거북선]', worksheetOcrPages: [{ text: '이유의 강원도황해도 '.repeat(12000) }], worksheetPageTexts: ['본문 '.repeat(12000)] });
  await db.doc(`${prefix}/lessons/pdf`).set({ unitId: 'pdf', title: '학습지', worksheetPageImages: [{ page: 1, imageUrl: 'fixture-page.webp' }], worksheetBlanks: ['천상열차분야지도', '정도전'].map((answer) => ({ answer, page: 1, widthRatio: 0.1, heightRatio: 0.1 })) });
  for (const [unitId, fields] of [['hidden', { isVisibleToStudents: false }], ['deleted', { deletedAt: '2026-10-07' }]]) {
    await db.doc(`${prefix}/lessons/${unitId}`).set({ unitId, contentHtml: '[숨긴정답]', ...fields });
    await db.doc(`lessons/${unitId}`).set({ unitId, contentHtml: '[과거정답]' });
  }
  await db.doc(`${prefix}/lessons/older`).set({ unitId: 'newest', contentHtml: '[옛연표]', updatedAt: '2026-09-01' });
  await db.doc(`${prefix}/lessons/newer`).set({ unitId: 'newest', contentHtml: '[최근정답]', isVisibleToStudents: false, updatedAt: '2026-10-01' });
  await db.doc('lessons/legacy').set({ unitId: 'legacy', contentHtml: '[세종]' });

  // Warm SDK/channel and establish the existing period before comparing paths.
  assert.equal((await call('getWeplayLobby')).wordCount, expected.size);
  for (let index = 0; index < 3; index++) {
    const lobby = await measure(`lobby-${index}`, () => call('getWeplayLobby'));
    assert.equal(lobby.wordCount, expected.size);
    assert.equal(lobby.balance, 30);
  }
  let challenge;
  for (const mode of ['practice', 'challenge']) {
    for (let index = 0; index < 3; index++) {
      const session = await measure(`${mode}-${index}`, () => call('startWeplayGame', { mode, requestKey: 'start' }, `${mode}-${index}`));
      assert.ok(session.words.every((word) => expected.has(word.text)), 'Projected source must retain only authored blanks and legacy visibility boundaries.');
      assert.equal((await get(`${prefix}/point_wallets/${mode}-${index}`)).balance, mode === 'challenge' ? 28 : 30);
      if (mode === 'challenge' && index === 0) challenge = session;
    }
  }
  const replay = await call('startWeplayGame', { mode: 'challenge', requestKey: 'start' }, 'challenge-0');
  assert.equal(replay.id, challenge.id);
  assert.equal((await get(`${prefix}/point_wallets/challenge-0`)).balance, 28);

  // Recovery is allowed to run beside catalog reads, but its new wallet, record
  // and ranking must all be visible in the SAME lobby response.
  const startsAtMs = Date.now() - 100000;
  await db.doc(`${prefix}/weplay_sessions/${challenge.id}`).update({ startsAtMs, endsAtMs: startsAtMs + 90000, acceptedWordIds: [challenge.words[0].id], acceptedEvents: [{ wordId: challenge.words[0].id, elapsedMs: 500 }] });
  const recovered = await call('getWeplayLobby', {}, 'challenge-0');
  assert.equal(recovered.activeSession, null);
  assert.equal(recovered.balance, 29);
  assert.equal(recovered.records[0].sessionId, challenge.id);
  assert.ok(recovered.rankingByDifficulty.mild.some((entry) => entry.isMe));

  // No shared catalog cache may revive a worksheet hidden after entering lobby.
  await db.doc(`${prefix}/lessons/public`).update({ isVisibleToStudents: false });
  const fresh = await call('startWeplayGame', { mode: 'practice', requestKey: 'fresh' }, 'fresh');
  assert.ok(fresh.words.every((word) => ['천상열차분야지도', '정도전', '세종'].includes(word.text)));
  const management = await call('getWeplayManagement', {}, 'teacher');
  assert.equal(management.availableWordCount, 3);
  assert.ok(management.lessons.some((lesson) => lesson.unitId === 'public' && lesson.wordCount === 3 && lesson.isVisibleToStudents === false));
  console.log('PASS projected HTML/PDF blanks, current/legacy visibility and freshness, charge replay, and post-recovery wallet/records/ranking consistency.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  originals.forEach((restore) => restore());
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map(deleteApp));
});
