const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const MAX_READ_ITEMS = 100;
const CLEAR_BATCH_SIZE = 400;
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 180
  && !/[\/\\\s\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value);
const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };

const createNotificationInboxHandler = ({ db, assertSession = assertScoreWorkflowSession,
  now = Date.now }) => async request => {
  const uid = request.auth?.uid;
  if (!id(uid)) fail('unauthenticated', 'NOTIFICATION_AUTH_REQUIRED', '로그인 후 알림을 확인해 주세요.');
  await assertSession(request);
  const input = request.data || {};
  const allowed = ['year', 'semester', 'action', 'itemIds', 'broadcastReadThroughMs', '_session'];
  if (Object.keys(input).some(key => !allowed.includes(key))
    || !/^\d{4}$/.test(input.year || '') || !/^[12]$/.test(input.semester || '')
    || !['MARK_READ', 'CLEAR'].includes(input.action)) {
    fail('invalid-argument', 'NOTIFICATION_INPUT_INVALID', '알림 처리 정보를 확인해 주세요.');
  }
  const itemIds = input.itemIds === undefined ? [] : input.itemIds;
  const timestamp = now();
  const through = input.broadcastReadThroughMs ?? 0;
  if (!Array.isArray(itemIds) || itemIds.length > MAX_READ_ITEMS || itemIds.some(value => !id(value))
    || new Set(itemIds).size !== itemIds.length || !Number.isSafeInteger(through) || through < 0 || through > timestamp
    || input.action === 'CLEAR' && (itemIds.length || through)) {
    fail('invalid-argument', 'NOTIFICATION_INPUT_INVALID', '알림 처리 정보를 확인해 주세요.');
  }
  const semesterId = `${input.year}-${input.semester}`;
  const root = `years/${input.year}/semesters/${input.semester}/notification_inboxes/${uid}`;
  const inboxRef = db.doc(root);
  const items = db.collection(`${root}/items`);
  const at = Timestamp.fromMillis(timestamp);
  let total = 0;
  for (let batchIndex = 0; batchIndex < (input.action === 'CLEAR' ? 20 : 1); batchIndex++) {
    const result = await db.runTransaction(async transaction => {
      const [user, pointer, manifest, inbox] = await transaction.getAll(db.doc(`users/${uid}`),
        db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${semesterId}`), inboxRef);
      const profile = user.data() || {};
      const email = String(request.auth?.token?.email || '').trim().toLowerCase();
      if ((!/@yongshin-ms\.ms\.kr$/i.test(email) && email !== ADMIN_EMAIL)
        || email !== ADMIN_EMAIL && (!user.exists || !['teacher', 'student'].includes(profile.role)
          && profile.teacherPortalEnabled !== true)) {
        fail('permission-denied', 'NOTIFICATION_ACCESS_DENIED', '알림을 처리할 권한이 없습니다.');
      }
      const p = pointer.data() || {}, m = manifest.data() || {};
      if (!pointer.exists || !manifest.exists || p.semesterId !== semesterId || m.semesterId !== semesterId
        || !Number.isSafeInteger(p.revision) || p.revision < 1 || p.revision !== m.revision
        || m.status !== 'ACTIVE' || m.readOnly === true) {
        fail('failed-precondition', 'NOTIFICATION_SEMESTER_CHANGED', '현재 학기가 변경되었습니다. 화면을 새로 열어 주세요.');
      }
      const state = inbox.data() || {};
      const snapshots = input.action === 'CLEAR'
        ? (await transaction.get(items.where('createdAt', '<=', at).limit(CLEAR_BATCH_SIZE))).docs
        : itemIds.length ? await transaction.getAll(...itemIds.map(itemId => items.doc(itemId))) : [];
      const unread = snapshots.filter(snapshot => snapshot.exists && !snapshot.data()?.readAt);
      const existingCount = Math.max(0, Number(state.unreadCount) || 0);
      const lastBroadcastReadMs = millis(state.lastBroadcastReadAt);
      const lastReadAt = Timestamp.fromMillis(Math.max(millis(state.lastReadAt), timestamp));
      const updatedAt = Timestamp.fromMillis(Math.max(millis(state.updatedAt), timestamp));
      const broadcastAdvanced = input.action === 'MARK_READ' && through > lastBroadcastReadMs;
      if (input.action === 'CLEAR') {
        snapshots.forEach(snapshot => transaction.delete(snapshot.ref));
        transaction.set(inboxRef, {
          uid, unreadCount: Math.max(0, existingCount - unread.length),
          lastReadAt, updatedAt,
          lastBroadcastReadAt: Timestamp.fromMillis(Math.max(lastBroadcastReadMs, timestamp)),
          broadcastClearedAt: Timestamp.fromMillis(Math.max(millis(state.broadcastClearedAt), timestamp)),
        }, { merge: true });
      } else if (unread.length || broadcastAdvanced) {
        unread.forEach(snapshot => transaction.set(snapshot.ref, { readAt: at }, { merge: true }));
        transaction.set(inboxRef, {
          uid, unreadCount: Math.max(0, existingCount - unread.length),
          lastReadAt, updatedAt,
          ...(broadcastAdvanced ? { lastBroadcastReadAt: Timestamp.fromMillis(through) } : {}),
        }, { merge: true });
      }
      return { count: input.action === 'CLEAR' ? snapshots.length : unread.length,
        more: input.action === 'CLEAR' && snapshots.length === CLEAR_BATCH_SIZE };
    });
    total += result.count;
    if (!result.more) return input.action === 'CLEAR' ? { deletedCount: total } : { updatedCount: total };
  }
  fail('resource-exhausted', 'NOTIFICATION_CLEAR_LIMIT', '일부 알림을 삭제했습니다. 다시 눌러 남은 알림을 삭제해 주세요.');
};

module.exports = { createNotificationInboxHandler };
