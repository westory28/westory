const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWeplayFunctions } = require('../weplay');
const { DEFAULT_GAME_SETTINGS, DEFAULT_POLICY, GAME_ID } = require('../weplayCore');

const prefix = 'years/2026/semesters/2';
const scopedPath = `${prefix}/lessons`;
const lesson = (unitId, extra = {}) => ({ unitId, title: unitId, contentHtml: '[고조선] [훈민정음] [삼국통일]', ...extra });
class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }

function fixture({ settings = {}, scoped = {}, legacy = {} } = {}) {
  const records = new Map([
    ['site_settings/config', { year: '2026', semester: '2' }],
    ['users/student', { role: 'student', name: '합성학생' }],
    [`${prefix}/weplay_games/${GAME_ID}`, { ...structuredClone(DEFAULT_GAME_SETTINGS), ...settings }],
    [`${prefix}/weplay_policies/current`, structuredClone(DEFAULT_POLICY)],
    [`${prefix}/weplay_meta/current`, { periodId: 'current-period' }],
    [`${prefix}/weplay_periods/current-period`, { id: 'current-period', status: 'open', battleVersion: 1,
      startsAtMs: Date.now() - 1000, endsAtMs: Date.now() + 3600000, difficulties: DEFAULT_GAME_SETTINGS.difficulties }],
    [`${prefix}/point_wallets/student`, { balance: 10 }],
    ...Object.entries(scoped).map(([id, value]) => [`${scopedPath}/${id}`, value]),
    ...Object.entries(legacy).map(([id, value]) => [`lessons/${id}`, value]),
  ]);
  const reads = [], writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), ref: { path }, exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const query = (path, filters = [], fields = null, limit = Infinity) => ({
    where: (field, op, value) => query(path, [...filters, { field, op, value }], fields, limit),
    select: (...selected) => query(path, filters, selected, limit),
    orderBy: () => query(path, filters, fields, limit),
    limit: count => query(path, filters, fields, count),
    get: async () => {
      let rows = [...records.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).sort();
      rows = rows.filter(key => filters.every(({ field, op, value }) => {
        assert.ok(op === '==' || op === 'in');
        if (op === 'in') { assert.ok(value.length > 0 && value.length <= 30); return value.includes(records.get(key)[field]); }
        return records.get(key)[field] === value;
      })).slice(0, limit);
      if (path === scopedPath || path === 'lessons') reads.push({ path, filters, fields, documents: rows.length });
      return { docs: rows.map(key => {
        const doc = snapshot(key), raw = doc.data();
        return { ...doc, data: () => fields ? Object.fromEntries(Object.entries(raw).filter(([field]) => fields.includes(field))) : raw };
      }) };
    },
  });
  const db = {
    doc: path => ({ path, get: async () => snapshot(path), collection: name => query(path + '/' + name) }),
    collection: path => query(path),
    runTransaction: async callback => {
      const staged = [];
      const result = await callback({
        get: async ref => snapshot(ref.path),
        getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
        create: (ref, value) => staged.push([ref.path, value]),
        set: (ref, value, options) => staged.push([ref.path, options?.merge ? { ...records.get(ref.path), ...value } : value]),
      });
      for (const [path, value] of staged) { writes.push(path); records.set(path, structuredClone(value)); }
      return result;
    },
  };
  const api = createWeplayFunctions({
    db, HttpsError: ApiError, FieldValue: { serverTimestamp: () => ({ synthetic: true }) }, REGION: 'asia-northeast3',
    onCall: (_options, handler) => handler, onSchedule: (_options, handler) => handler,
    assertAllowedWestoryUser: request => {
      if (!request.auth?.uid) throw new ApiError('unauthenticated', '로그인 필요');
      return { uid: request.auth.uid };
    },
    assertWeplayReader: async request => { if (request.auth?.uid !== 'teacher') throw new ApiError('permission-denied', '교사 필요'); },
    getUserProfile: async uid => ({ profile: records.get(`users/${uid}`) || {} }),
    buildWalletBase: uid => ({ uid }),
  });
  const call = (name, data = {}, uid = name === 'getWeplayLobby' || name === 'startWeplayGame' ? 'student' : 'teacher') => api[name]({
    auth: uid ? { uid } : null, data: { year: '2026', semester: '2', gameId: GAME_ID, difficulty: 'medium', ...data },
  });
  return { call, reads, writes, records };
}

test('selected student lobby/start read only selected scoped lessons and no shadowed legacy', async () => {
  const scoped = { chosen: lesson('chosen') };
  for (let i = 0; i < 1000; i++) scoped[`unrelated-${i}`] = lesson(`other-${i}`);
  const f = fixture({ settings: { sourceMode: 'selected', unitIds: ['chosen'] }, scoped,
    legacy: { chosen: lesson('chosen', { contentHtml: '[옛자료]' }), unrelated: lesson('legacy-other') } });
  const lobby = await f.call('getWeplayLobby');
  assert.deepEqual(lobby.lessons.map(item => item.unitId), ['chosen']);
  assert.equal(lobby.wordCount, 3);
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.reads[0].filters, [{ field: 'unitId', op: 'in', value: ['chosen'] }]);
  assert.equal(f.reads[0].documents, 1, 'one selected document read instead of all 1,003 scoped+legacy documents');
  f.reads.length = 0;
  const session = await f.call('startWeplayGame', { mode: 'practice', requestKey: 'selected-start' });
  assert.ok(session.words.every(word => word.unitId === 'chosen'));
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].documents, 1);
});

test('selected legacy-only units remain available but hidden/deleted scoped revisions suppress old copies', async () => {
  const f = fixture({ settings: { sourceMode: 'selected', unitIds: ['legacy-only', 'hidden', 'deleted'] },
    scoped: { hidden: lesson('hidden', { isVisibleToStudents: false }), deleted: lesson('deleted', { deletedAt: 1 }) },
    legacy: { legacy: lesson('legacy-only'), hidden: lesson('hidden'), deleted: lesson('deleted'), unused: lesson('unused') } });
  const lobby = await f.call('getWeplayLobby');
  assert.deepEqual(lobby.lessons.map(item => item.unitId), ['legacy-only']);
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.reads[1].filters[0].value, ['legacy-only']);
  assert.equal(f.reads.reduce((sum, read) => sum + read.documents, 0), 3);
  f.reads.length = 0;
  const preview = await f.call('previewWeplayGame', { unitIds: ['hidden'] });
  assert.ok(preview.words.every(word => word.unitId === 'hidden'));
  assert.equal(f.reads.length, 1);
  assert.equal(f.writes.length, 0, 'preview and an established lobby never write for catalog reads');
  await assert.rejects(f.call('previewWeplayGame', { unitIds: ['deleted'] }), error => error.code === 'invalid-argument');
});

test('all mode and teacher management keep the complete effective catalog', async () => {
  const source = { scoped: { a: lesson('a'), hidden: lesson('hidden', { isVisibleToStudents: false }) }, legacy: { b: lesson('b') } };
  const all = fixture(source);
  assert.deepEqual((await all.call('getWeplayLobby')).lessons.map(item => item.unitId), ['a', 'b']);
  assert.equal(all.reads.length, 2);
  assert.ok(all.reads.every(read => read.filters.length === 0));
  const selected = fixture({ ...source, settings: { sourceMode: 'selected', unitIds: ['a'] } });
  const management = await selected.call('getWeplayManagement');
  assert.deepEqual(management.lessons.map(item => item.unitId), ['a', 'hidden', 'b']);
  assert.equal(selected.reads.length, 2);
  assert.ok(selected.reads.every(read => read.filters.length === 0));
});

test('selected empty is zero lesson reads, empty lobby and failed-precondition start/preview; it never means all', async () => {
  const f = fixture({ settings: { sourceMode: 'selected', unitIds: [] }, scoped: { a: lesson('a') } });
  assert.equal((await f.call('getWeplayLobby')).wordCount, 0);
  await assert.rejects(f.call('startWeplayGame', { mode: 'practice', requestKey: 'empty-start' }), error => error.code === 'failed-precondition');
  await assert.rejects(f.call('previewWeplayGame'), error => error.code === 'failed-precondition');
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
  const all = fixture({ scoped: { a: lesson('a') } });
  await assert.rejects(all.call('previewWeplayGame', { unitIds: [] }), error => error.code === 'failed-precondition');
  assert.deepEqual(all.reads, []);
});

test('preview overrides keep validation, hidden access, exclusions and authored PDF blank eligibility', async () => {
  const f = fixture({ settings: { sourceMode: 'selected', unitIds: ['a'], enabled: false }, scoped: {
    a: lesson('a'), b: lesson('b', { isVisibleToStudents: false, contentHtml: '[거북선] [한산도] [제외어]',
      worksheetPageImages: [{ page: 1, imageUrl: 'https://example.test/page.png' }],
      worksheetBlanks: [{ page: 1, answer: '이순신', widthRatio: 1, heightRatio: 1 }, { page: 2, answer: '삭제페이지', widthRatio: 1, heightRatio: 1 }] }),
  } });
  const settings = { ...structuredClone(DEFAULT_GAME_SETTINGS), sourceMode: 'selected', unitIds: ['b'], excludedWords: ['제외어'] };
  const preview = await f.call('previewWeplayGame', { settings });
  assert.deepEqual(new Set(preview.words.map(word => word.text)), new Set(['거북선', '한산도', '이순신']));
  assert.deepEqual(f.reads[0].filters[0].value, ['b']);
  assert.deepEqual(f.writes, []);
  await assert.rejects(f.call('previewWeplayGame', { unitIds: ['missing'] }), error => error.code === 'invalid-argument');
  await assert.rejects(f.call('previewWeplayGame', { unitIds: ['../invalid'] }), error => error.code === 'invalid-argument');
  await assert.rejects(f.call('previewWeplayGame', {}, 'student'), error => error.code === 'permission-denied');
});

test('chunked selection stays within 30 operands and preserves full-query document ordering for duplicate words', async () => {
  const scoped = {}, unitIds = [];
  for (let i = 0; i < 65; i++) {
    const id = `unit-${String(i).padStart(2, '0')}`;
    unitIds.push(id);
    scoped[`doc-${String(65 - i).padStart(2, '0')}`] = lesson(id);
  }
  scoped.unrelated = lesson('outside-selection');
  const f = fixture({ settings: { sourceMode: 'selected', unitIds }, scoped });
  const preview = await f.call('previewWeplayGame');
  assert.deepEqual(f.reads.map(read => read.filters[0].value.length), [30, 30, 5]);
  assert.equal(f.reads.reduce((sum, read) => sum + read.documents, 0), 65);
  assert.ok(preview.words.every(word => word.unitId === 'unit-00'), 'duplicate answer provenance stays with the final scoped document, not the final chunk');
  assert.deepEqual(f.writes, []);
});
