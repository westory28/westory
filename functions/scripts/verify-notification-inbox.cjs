const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { createNotificationInboxHandler } = require('../notificationInbox');

const scope = 'years/2026/semesters/2/notification_inboxes/teacher';
const at = 100000;
const item = (readAt = null, createdAt = 1000) => ({ readAt, createdAt: Timestamp.fromMillis(createdAt) });
const fake = (overrides = {}) => {
  const state = new Map(Object.entries({
    'users/teacher': { role: 'teacher' },
    'site_settings/semester_active': { semesterId: '2026-2', revision: 4 },
    'semester_manifests/2026-2': { semesterId: '2026-2', revision: 4, status: 'ACTIVE' },
    [scope]: { uid: 'teacher', unreadCount: 2 },
    [`${scope}/items/displayed`]: item(), [`${scope}/items/arrived-later`]: item(),
    ...overrides,
  }));
  let committed = 0;
  const ref = path => ({ path });
  const snapshot = path => ({ ref: ref(path), exists: state.has(path), data: () => state.get(path) });
  const collection = (path, condition, limit = 10000) => ({
    path, condition, bound: limit, doc: id => ref(`${path}/${id}`),
    where: (field, operator, value) => collection(path, { field, operator, value }, limit),
    limit: value => collection(path, condition, value),
  });
  const db = {
    doc: ref, collection,
    runTransaction: async callback => {
      const writes = [];
      const read = value => {
        assert.equal(writes.length, 0, 'All authorization, inbox and item reads precede writes');
        if (!value.bound) return snapshot(value.path);
        const docs = [...state.keys()].filter(path => path.startsWith(`${value.path}/`)
          && !path.slice(value.path.length + 1).includes('/'))
          .filter(path => !value.condition || state.get(path)[value.condition.field]?.toMillis() <= value.condition.value.toMillis())
          .slice(0, value.bound).map(snapshot);
        return { docs };
      };
      const transaction = {
        getAll: async (...refs) => refs.map(read), get: async ref => read(ref),
        set: (ref, data, options) => writes.push({ ref, data, options }),
        delete: ref => writes.push({ ref, remove: true }),
      };
      const result = await callback(transaction);
      writes.forEach(write => write.remove ? state.delete(write.ref.path)
        : state.set(write.ref.path, write.options?.merge ? { ...state.get(write.ref.path), ...write.data } : write.data));
      committed += writes.length;
      return result;
    },
  };
  const request = data => ({ auth: { uid: 'teacher', token: { email: 'teacher@yongshin-ms.ms.kr' } },
    data: { year: '2026', semester: '2', action: 'MARK_READ', itemIds: ['displayed'], ...data } });
  const handler = createNotificationInboxHandler({ db, assertSession: async () => {}, now: () => at });
  return { state, db, request, handler, writes: () => committed };
};

(async () => {
  const f = fake();
  assert.deepEqual(await f.handler(f.request()), { updatedCount: 1 });
  assert(f.state.get(`${scope}/items/displayed`).readAt instanceof Timestamp);
  assert.equal(f.state.get(`${scope}/items/arrived-later`).readAt, null);
  assert.equal(f.state.get(scope).unreadCount, 1, 'An unseen arrival remains unread');
  const writes = f.writes();
  assert.deepEqual(await f.handler(f.request()), { updatedCount: 0 });
  assert.equal(f.writes(), writes, 'Repeated acknowledgement does not decrement or emit another inbox update');
  await f.handler(f.request({ itemIds: [], broadcastReadThroughMs: 1500 }));
  assert.equal(f.state.get(scope).lastBroadcastReadAt.toMillis(), 1500);
  assert.equal(f.state.get(scope).unreadCount, 1);
  assert.equal(f.state.get(`${scope}/items/arrived-later`).readAt, null);
  const broadcastWrites = f.writes();
  await f.handler(f.request({ itemIds: [], broadcastReadThroughMs: 1000 }));
  assert.equal(f.writes(), broadcastWrites, 'Older broadcast state cannot move the watermark backwards');
  await assert.rejects(() => f.handler(f.request({ itemIds: ['../other'] })), error => error.code === 'invalid-argument');
  await assert.rejects(() => f.handler(f.request({ recipientUid: 'other' })), error => error.code === 'invalid-argument');
  await assert.rejects(() => f.handler(f.request({ itemIds: ['displayed', 'displayed'] })), error => error.code === 'invalid-argument');
  await assert.rejects(() => f.handler(f.request({ broadcastReadThroughMs: at + 1 })), error => error.code === 'invalid-argument');
  const missing = fake();
  const emptyRequest = missing.request(); delete emptyRequest.auth;
  await assert.rejects(() => missing.handler(emptyRequest), error => error.code === 'unauthenticated');
  assert.equal(missing.writes(), 0);
  const deniedSession = createNotificationInboxHandler({ db: missing.db,
    assertSession: async () => { throw new Error('expired session'); }, now: () => at });
  await assert.rejects(() => deniedSession(missing.request()), /expired session/);
  assert.equal(missing.writes(), 0);
  for (const [key, value] of [
    ['site_settings/semester_active', { semesterId: '2026-1', revision: 4 }],
    ['semester_manifests/2026-2', { semesterId: '2026-2', revision: 5, status: 'ACTIVE' }],
    ['semester_manifests/2026-2', { semesterId: '2026-2', revision: 4, status: 'ARCHIVED', readOnly: true }],
    ['users/teacher', { role: 'visitor' }],
  ]) {
    const denied = fake({ [key]: value });
    await assert.rejects(() => denied.handler(denied.request()));
    assert.equal(denied.writes(), 0);
  }
  const entries = Object.fromEntries(Array.from({ length: 405 }, (_, index) => [`${scope}/items/old-${index}`, item()]));
  const clear = fake({ ...entries, [scope]: { uid: 'teacher', unreadCount: 408 },
    [`${scope}/items/after-clear`]: item(null, at + 1) });
  assert.deepEqual(await clear.handler(clear.request({ action: 'CLEAR', itemIds: undefined })), { deletedCount: 407 });
  assert.equal(clear.state.get(scope).unreadCount, 1);
  assert(clear.state.has(`${scope}/items/after-clear`));
  assert.equal(clear.state.get(scope).broadcastClearedAt.toMillis(), at);
  const newerWatermarks = fake({ [scope]: { uid: 'teacher', unreadCount: 2,
    lastReadAt: Timestamp.fromMillis(at + 50), lastBroadcastReadAt: Timestamp.fromMillis(at + 80),
    broadcastClearedAt: Timestamp.fromMillis(at + 70), updatedAt: Timestamp.fromMillis(at + 90) } });
  await newerWatermarks.handler(newerWatermarks.request({ action: 'CLEAR', itemIds: undefined }));
  assert.equal(newerWatermarks.state.get(scope).lastReadAt.toMillis(), at + 50);
  assert.equal(newerWatermarks.state.get(scope).lastBroadcastReadAt.toMillis(), at + 80);
  assert.equal(newerWatermarks.state.get(scope).broadcastClearedAt.toMillis(), at + 70);
  assert.equal(newerWatermarks.state.get(scope).updatedAt.toMillis(), at + 90);
  console.log('PASS notification inbox: session/scope/owner guards, exact fetched IDs, unseen arrivals, replay, broadcast watermark and bounded clear preserve new notifications');
})().catch(error => { console.error(error); process.exitCode = 1; });
