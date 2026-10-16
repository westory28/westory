const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { createStudentWisWallet } = require('./studentWisWallet');

const createStudentProfileEmojiHandler = ({
  db,
  loadPolicy,
  getProfileEmojiEntryById,
  getCurrentTierCodeForRankTotal,
  getAllowedEmojiIdsForTier,
  assertSession = assertScoreWorkflowSession,
}) => {
  const canonicalWallet = createStudentWisWallet({ db });
  return async (request) => {
    const identity = await assertSession(request);
    const uid = String(request.auth?.uid || '').trim();
    if (!uid || (identity?.uid && identity.uid !== uid)) {
      throw new HttpsError('unauthenticated', '로그인한 뒤 다시 선택해 주세요.');
    }
    const data = request.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some((key) => !['year', 'semester', 'emojiId', '_session'].includes(key))) {
      throw new HttpsError('invalid-argument', '이모지 선택 정보를 확인해 주세요.');
    }
    const year = String(data.year || '').trim();
    const semester = String(data.semester || '').trim();
    const emojiId = typeof data.emojiId === 'string' ? data.emojiId.trim() : '';
    if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester) || !emojiId) {
      throw new HttpsError('invalid-argument', '이모지 선택 정보를 확인해 주세요.');
    }

    return db.runTransaction(async (transaction) => {
      // This read verifies the active semester, enrollment and canonical account.
      // Legacy wallets and a previously selected emoji never grant access.
      const { wallet } = await canonicalWallet.read(transaction, { year, semester }, uid);
      const policy = await loadPolicy(transaction, year, semester);
      const emojiEntry = getProfileEmojiEntryById(emojiId, policy.rankPolicy.emojiRegistry);
      if (!emojiEntry || emojiEntry.enabled === false) {
        throw new HttpsError('invalid-argument', '선택할 수 없는 이모지입니다.');
      }
      const tierCode = getCurrentTierCodeForRankTotal(wallet.rankEarnedTotal, policy.rankPolicy);
      if (!getAllowedEmojiIdsForTier(policy.rankPolicy, tierCode).includes(emojiId)) {
        throw new HttpsError('failed-precondition', '현재 학기 점수로 아직 선택할 수 없는 이모지입니다.');
      }
      transaction.set(db.doc(`users/${uid}`), {
        profileEmojiId: emojiEntry.id,
        profileIcon: emojiEntry.emoji,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { emojiId: emojiEntry.id, profileIcon: emojiEntry.emoji, tierCode };
    });
  };
};

module.exports = { createStudentProfileEmojiHandler };
