const { createHash, randomUUID } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const sharp = require('sharp');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { createStudentWisWallet } = require('./studentWisWallet');
const { catalog, items, defaultLook, validateLook, lookHash } = require('./studentAvatarCatalog');

const hash = value => createHash('sha256').update(value).digest('hex');
const safe = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const fail = (code, message, reason, extra = {}) => { throw new HttpsError(code, message, { reason, ...extra }); };
const invalid = () => fail('invalid-argument', '아바타 선택 내용을 확인해 주세요.', 'AVATAR_INPUT_INVALID');
const keysOnly = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));
const scopeOf = data => {
  if (!/^\d{4}$/.test(data.year || '') || !/^[12]$/.test(data.semester || '')) invalid();
  return { year: String(data.year), semester: String(data.semester) };
};
const requestKey = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalid();
  return hash(value);
};
const publicState = state => ({
  schemaVersion: 1, catalogVersion: catalog.version, look: state.look,
  revision: state.revision, lookHash: lookHash(state.look),
  ...(state.thumbnailUrl ? { thumbnailUrl: state.thumbnailUrl } : {}),
});
const privateState = state => ({ ...publicState(state), ownedItemIds: [...state.ownedItemIds] });
const walletState = account => Object.fromEntries(['semesterId', 'accountId', 'balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal', 'adjustedTotal', 'revision'].map(key => [key, account[key]]));

async function encodeThumbnail(input) {
  if (typeof input !== 'string' || input.length > 175000 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(input)) invalid();
  const bytes = Buffer.from(input.slice(23), 'base64');
  if (bytes.length < 20 || bytes.length > 128 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP') invalid();
  try {
    const meta = await sharp(bytes, { limitInputPixels: 512 * 512, animated: true }).metadata();
    if (meta.format !== 'webp' || !meta.width || !meta.height || meta.width > 512 || meta.height > 512 || (meta.pages || 1) !== 1) invalid();
    for (const quality of [84, 72, 60]) {
      const result = await sharp(bytes, { limitInputPixels: 512 * 512 }).rotate()
        .resize({ width: 384, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 }).toBuffer();
      if (result.length <= 64 * 1024) return result;
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    invalid();
  }
  invalid();
}

const createStudentAvatarHandlers = ({ db, bucket, assertSession = assertScoreWorkflowSession, now = () => Date.now() }) => {
  const canonicalWallet = createStudentWisWallet({ db, actorUid: 'system:student-avatar' });
  const authenticate = async request => {
    const identity = await assertSession(request);
    const uid = request.auth?.uid;
    if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || (identity?.uid && identity.uid !== uid)) {
      fail('unauthenticated', '학생 계정으로 다시 로그인해 주세요.', 'AVATAR_SESSION_INVALID');
    }
    return uid;
  };
  const readStudent = async (tx, uid) => {
    const [user, identity, deletion] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`student_identities/${uid}`), db.doc(`student_avatar_deletions/${uid}`));
    if (deletion.exists) fail('failed-precondition', '계정 정리 중입니다. 잠시 후 다시 시도해 주세요.', 'AVATAR_DELETION_PENDING');
    const profile = user.data() || {}, actor = identity.data() || {};
    if (!user.exists || profile.role !== 'student' || profile.deletedAt || profile.isDeleted || profile.weplayDeletionPending
      || (profile.registrationApprovalStatus && profile.registrationApprovalStatus !== 'APPROVED')
      || !identity.exists || actor.studentUid !== uid || (actor.accountStatus && actor.accountStatus !== 'ACTIVE')) {
      fail('permission-denied', '승인된 학생 계정에서 사용할 수 있습니다.', 'AVATAR_STUDENT_REQUIRED');
    }
  };
  const readState = async (tx, uid) => {
    const doc = await tx.get(db.doc(`student_avatars/${uid}`));
    if (!doc.exists) return { studentUid: uid, revision: 0, ownedItemIds: [], look: defaultLook() };
    const value = doc.data();
    if (value.studentUid !== uid || value.schemaVersion !== 1 || !safe(value.revision, 1)
      || !Array.isArray(value.ownedItemIds) || value.ownedItemIds.length > 500
      || value.ownedItemIds.some(id => typeof id !== 'string' || id.length > 100)
      || new Set(value.ownedItemIds).size !== value.ownedItemIds.length
      || !validateLook(value.look, value.ownedItemIds) || value.lookHash !== lookHash(value.look)) {
      fail('failed-precondition', '아바타 보관함을 확인하지 못했습니다.', 'AVATAR_STATE_INVALID');
    }
    return value;
  };
  const readReceipt = async (tx, ref, uid, digest) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const receipt = snapshot.data();
    if (receipt.studentUid !== uid || receipt.payloadHash !== digest) {
      fail('already-exists', '이 요청 번호는 다른 선택에 사용되었습니다. 다시 시도해 주세요.', 'AVATAR_REQUEST_REUSED');
    }
    return { ...receipt.result, duplicate: true };
  };
  const writeState = (tx, uid, state, timestamp) => {
    const data = { ...state, schemaVersion: 1, catalogVersion: catalog.version, studentUid: uid, lookHash: lookHash(state.look), updatedAt: timestamp };
    tx.set(db.doc(`student_avatars/${uid}`), data);
    tx.set(db.doc(`users/${uid}`), { avatar: publicState(data), updatedAt: timestamp }, { merge: true });
  };
  const writeReceipt = (tx, ref, uid, digest, result, timestamp) => tx.create(ref, {
    schemaVersion: 1, studentUid: uid, payloadHash: digest, result, createdAt: timestamp,
  });

  const getStudentAvatar = async request => {
    const uid = await authenticate(request), data = request.data || {};
    if (!keysOnly(data, ['_session', 'year', 'semester'])) invalid();
    if (data.year !== undefined || data.semester !== undefined) scopeOf(data);
    return db.runTransaction(async tx => { await readStudent(tx, uid); return privateState(await readState(tx, uid)); }, { readOnly: true });
  };

  const purchaseStudentAvatarItem = async request => {
    const uid = await authenticate(request), data = request.data || {};
    if (!keysOnly(data, ['_session', 'year', 'semester', 'itemId', 'requestId'])) invalid();
    const scope = scopeOf(data), key = requestKey(data.requestId), item = items.get(data.itemId);
    if (!item) invalid();
    const digest = hash(JSON.stringify(['purchase', uid, scope, item.id]));
    const receiptRef = db.doc(`student_avatars/${uid}/requests/${key}`);
    return db.runTransaction(async tx => {
      await readStudent(tx, uid);
      const previous = await readReceipt(tx, receiptRef, uid, digest);
      if (previous) return previous;
      const state = await readState(tx, uid);
      const { wallet, economy } = await canonicalWallet.read(tx, scope, uid);
      const timestamp = Timestamp.fromMillis(now());
      const alreadyOwned = item.price === 0 || state.ownedItemIds.includes(item.id);
      const result = { itemId: item.id, charged: 0, alreadyOwned, duplicate: false, ledgerEntryId: null, wallet: walletState(wallet), avatar: privateState(state) };
      // No-charge probes must not grow a receipt collection. An earlier charged
      // receipt was already checked above and still replays exactly once.
      if (alreadyOwned) return result;
      if (!alreadyOwned) {
        if (wallet.balance < item.price) fail('failed-precondition', '위스 잔액이 부족합니다.', 'WIS_INSUFFICIENT_BALANCE', { balance: wallet.balance, required: item.price });
        if (![wallet.revision + 1, wallet.spentTotal + item.price, economy.revision + 1, economy.ledgerEntryCount + 1, state.revision + 1].every(value => safe(value, 1))) {
          fail('failed-precondition', '위스 계좌의 금액과 합계를 확인해 주세요.', 'WIS_ACCOUNT_TOTALS_INVALID');
        }
        const sourceId = `avatar:${hash(`${uid}\n${key}`)}`;
        const ledgerEntryId = `wisled_${hash([wallet.semesterId, wallet.accountId, 'ORDER_DEBIT', sourceId].join('\n'))}`;
        const ledger = {
          schemaVersion: 1, policyVersion: 'w7-v1', ledgerEntryId, semesterId: wallet.semesterId,
          accountId: wallet.accountId, studentUid: uid, type: 'ORDER_DEBIT', activityType: 'avatar_purchase',
          delta: -item.price, balanceBefore: wallet.balance, balanceAfter: wallet.balance - item.price,
          sourceId, reason: `아바타 구매: ${item.label}`, actorUid: uid, actorRole: 'student',
          commandId: `avatar_${key}`, receiptId: receiptRef.path, createdAt: timestamp,
          avatarItemId: item.id, catalogVersion: catalog.version,
        };
        const totals = { balance: wallet.balance - item.price, earnedTotal: wallet.earnedTotal,
          rankEarnedTotal: wallet.rankEarnedTotal, spentTotal: wallet.spentTotal + item.price, adjustedTotal: wallet.adjustedTotal };
        const nextWallet = { ...wallet, ...totals, revision: wallet.revision + 1 };
        const nextState = { ...state, revision: state.revision + 1, ownedItemIds: [...state.ownedItemIds, item.id].sort() };
        const common = { schemaVersion: 1, policyVersion: 'w7-v1', accountId: wallet.accountId,
          semesterId: wallet.semesterId, studentUid: uid, ledgerRevision: nextWallet.revision, updatedAt: timestamp };
        tx.create(db.doc(`semester_wis_ledger/${ledgerEntryId}`), ledger);
        tx.set(db.doc(`semester_wis_accounts/${wallet.accountId}`), { ...totals, revision: nextWallet.revision,
          recentLedgerEntries: [ledger, ...wallet.recentLedgerEntries].slice(0, 100), updatedAt: timestamp, updatedBy: uid }, { merge: true });
        tx.set(db.doc(`semester_wis_balances/${wallet.accountId}`), { ...common, ...totals }, { merge: true });
        tx.set(db.doc(`semester_wis_rankings/${wallet.accountId}`), { ...common, displayName: wallet.displayName || '',
          classId: wallet.classId, grade: String(wallet.grade || ''), classNumber: String(wallet.classNumber || ''),
          balance: totals.balance, rankEarnedTotal: totals.rankEarnedTotal }, { merge: true });
        tx.set(db.doc(`semester_wis_economies/${wallet.semesterId}`), { revision: economy.revision + 1,
          ledgerEntryCount: economy.ledgerEntryCount + 1, updatedAt: timestamp, updatedBy: uid }, { merge: true });
        writeState(tx, uid, nextState, timestamp);
        Object.assign(result, { charged: item.price, ledgerEntryId, wallet: walletState(nextWallet), avatar: privateState(nextState) });
      }
      writeReceipt(tx, receiptRef, uid, digest, result, timestamp);
      return result;
    });
  };

  const saveStudentAvatar = async request => {
    const uid = await authenticate(request), data = request.data || {};
    if (!keysOnly(data, ['_session', 'look', 'expectedRevision', 'requestId', 'thumbnailWebp']) || !safe(data.expectedRevision)) invalid();
    const look = validateLook(data.look), key = requestKey(data.requestId);
    if (!look) invalid();
    // Never accept a URL, SVG, HTML or client-chosen Storage path. Pixel truth is
    // profile-image trust; decode/re-encode cannot prove a screenshot depicts look.
    const bytes = await encodeThumbnail(data.thumbnailWebp), thumbnailHash = hash(bytes);
    const digest = hash(JSON.stringify(['save', uid, lookHash(look), data.expectedRevision, thumbnailHash]));
    const receiptRef = db.doc(`student_avatars/${uid}/requests/${key}`);
    const validateSave = async tx => {
      await readStudent(tx, uid);
      const previous = await readReceipt(tx, receiptRef, uid, digest);
      if (previous) return { previous };
      const state = await readState(tx, uid);
      if (state.revision !== data.expectedRevision) fail('aborted', '다른 화면에서 아바타가 변경되었습니다. 보관함을 새로고침해 주세요.', 'AVATAR_REVISION_CONFLICT', { currentRevision: state.revision });
      if (!validateLook(look, state.ownedItemIds)) fail('permission-denied', '구매한 아이템만 저장할 수 있습니다.', 'AVATAR_ITEM_NOT_OWNED');
      if (!safe(state.revision + 1, 1)) fail('failed-precondition', '아바타 보관함을 확인해 주세요.', 'AVATAR_STATE_INVALID');
      if (state.lastSavedAtMs && now() - state.lastSavedAtMs < 2000) fail('resource-exhausted', '잠시 후 다시 저장해 주세요.', 'AVATAR_SAVE_RATE_LIMIT');
      return { state };
    };
    const prepared = await db.runTransaction(validateSave, { readOnly: true });
    if (prepared.previous) return prepared.previous;
    const storageBucket = typeof bucket === 'function' ? bucket() : bucket;
    if (!storageBucket) fail('unavailable', '아바타 이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'AVATAR_STORAGE_UNAVAILABLE');
    const objectPath = `student_avatar_thumbnails/v1/${hash(uid)}/${hash(`${key}\n${digest}`)}.webp`;
    const file = storageBucket.file(objectPath);
    let token = randomUUID(), created = false;
    try {
      await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable',
          metadata: { firebaseStorageDownloadTokens: token, avatarLookHash: lookHash(look), avatarThumbnailHash: thumbnailHash } } });
      created = true;
    } catch (error) {
      if (Number(error.code) !== 412) fail('unavailable', '아바타 이미지를 저장하지 못했습니다. 기존 모습은 유지됩니다.', 'AVATAR_STORAGE_UNAVAILABLE');
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.avatarLookHash !== lookHash(look) || metadata.metadata?.avatarThumbnailHash !== thumbnailHash
        || !/^[a-f0-9-]{36}$/.test(metadata.metadata?.firebaseStorageDownloadTokens || '')) {
        fail('failed-precondition', '아바타 이미지 정보를 확인하지 못했습니다.', 'AVATAR_THUMBNAIL_CONFLICT');
      }
      token = metadata.metadata.firebaseStorageDownloadTokens;
    }
    const thumbnailUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    try {
      let retiredPath = null;
      const result = await db.runTransaction(async tx => {
        const checked = await validateSave(tx);
        if (checked.previous) return checked.previous;
        const state = checked.state, timestamp = Timestamp.fromMillis(now());
        retiredPath = state.previousThumbnailPath || null;
        const next = { ...state, look, revision: state.revision + 1, thumbnailUrl, thumbnailPath: objectPath,
          previousThumbnailPath: state.thumbnailPath || null, lastSavedAtMs: now() };
        writeState(tx, uid, next, timestamp);
        const saved = { ...privateState(next), duplicate: false };
        writeReceipt(tx, receiptRef, uid, digest, saved, timestamp);
        return saved;
      });
      // Retain current and previous image so normal page/cache transitions work.
      // Cleanup is best-effort; failures must not turn a committed save into failure.
      if (retiredPath && retiredPath !== objectPath && retiredPath.startsWith(`student_avatar_thumbnails/v1/${hash(uid)}/`)) {
        try {
          const current = (await db.doc(`student_avatars/${uid}`).get()).data() || {};
          if (![current.thumbnailPath, current.previousThumbnailPath].includes(retiredPath)) await storageBucket.file(retiredPath).delete({ ignoreNotFound: true });
        } catch (_) { /* Retention cleanup may be retried operationally. */ }
      }
      return result;
    } catch (error) {
      if (created) {
        try {
          const receipt = await receiptRef.get();
          if (!receipt.exists) await file.delete({ ignoreNotFound: true });
        } catch (_) { /* An unknown commit outcome must never delete a live image. */ }
      }
      throw error;
    }
  };
  return { getStudentAvatar, purchaseStudentAvatarItem, saveStudentAvatar };
};

const createStudentAvatarDeletionHandler = ({ db, bucket }) => async event => {
  const uid = event.params?.uid;
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || event.data?.data()?.role !== 'student'
    || typeof event.id !== 'string' || !event.id || event.id.length > 256) return;
  const eventHash = hash(event.id), userRef = db.doc(`users/${uid}`), lockRef = db.doc(`student_avatar_deletions/${uid}`);
  // The lock shares every avatar transaction's read set. A recreated identity
  // cannot save new avatar data while old subcollections/assets are removed.
  const acquired = await db.runTransaction(async tx => {
    const [user, lock] = await tx.getAll(userRef, lockRef);
    if (user.exists) {
      if (lock.exists && lock.data().eventHash === eventHash) tx.delete(lockRef);
      return false;
    }
    if (lock.exists && lock.data().eventHash !== eventHash) return false;
    tx.set(lockRef, { eventHash, startedAt: Timestamp.now() });
    return true;
  });
  if (!acquired) return;
  const storageBucket = typeof bucket === 'function' ? bucket() : bucket;
  if (!storageBucket) throw new Error('Avatar cleanup storage unavailable');
  await storageBucket.deleteFiles({ prefix: `student_avatar_thumbnails/v1/${hash(uid)}/`, force: true });
  await db.recursiveDelete(db.doc(`student_avatars/${uid}`));
  await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    if (lock.exists && lock.data().eventHash === eventHash) tx.delete(lockRef);
  });
};

module.exports = { createStudentAvatarHandlers, createStudentAvatarDeletionHandler, encodeThumbnail };
