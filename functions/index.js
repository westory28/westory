const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();
Object.assign(exports, require('./sourceArchiveBeta'));

const db = getFirestore();
const REGION = 'asia-northeast3';
const ADMIN_EMAIL = 'westoria28@gmail.com';
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;
const DEFAULT_POINT_RANK_TIERS = [
  { code: 'tier_1', minPoints: 0 },
  { code: 'tier_2', minPoints: 50 },
  { code: 'tier_3', minPoints: 150 },
  { code: 'tier_4', minPoints: 300 },
  { code: 'tier_5', minPoints: 500 },
];

const DEFAULT_PROFILE_EMOJI_ID = 'smile';
const PROFILE_EMOJI_REGISTRY = [
  { id: 'smile', value: '😀', unlockTierCode: 'tier_1' },
  { id: 'soft_smile', value: '🙂', unlockTierCode: 'tier_1' },
  { id: 'note', value: '📝', unlockTierCode: 'tier_1' },
  { id: 'book', value: '📚', unlockTierCode: 'tier_1' },
  { id: 'cool', value: '😎', unlockTierCode: 'tier_2' },
  { id: 'brain', value: '🧠', unlockTierCode: 'tier_2' },
  { id: 'clover', value: '🍀', unlockTierCode: 'tier_2' },
  { id: 'target', value: '🎯', unlockTierCode: 'tier_2' },
  { id: 'nerd', value: '🤓', unlockTierCode: 'tier_3' },
  { id: 'trophy', value: '🏆', unlockTierCode: 'tier_3' },
  { id: 'rocket', value: '🚀', unlockTierCode: 'tier_3' },
  { id: 'school', value: '🏫', unlockTierCode: 'tier_3' },
  { id: 'sparkles', value: '🌟', unlockTierCode: 'tier_4' },
  { id: 'science', value: '🧪', unlockTierCode: 'tier_4' },
  { id: 'tiger', value: '🐯', unlockTierCode: 'tier_4' },
  { id: 'panda', value: '🐼', unlockTierCode: 'tier_4' },
  { id: 'pencil', value: '✏️', unlockTierCode: 'tier_5' },
  { id: 'bear', value: '🐻', unlockTierCode: 'tier_5' },
  { id: 'fox', value: '🦊', unlockTierCode: 'tier_5' },
  { id: 'dolphin', value: '🐬', unlockTierCode: 'tier_5' },
  { id: 'owl', value: '🦉', unlockTierCode: 'tier_5' },
  { id: 'whale', value: '🐳', unlockTierCode: 'tier_5' },
];

const getProfileEmojiEntryById = (emojiId) =>
  PROFILE_EMOJI_REGISTRY.find((entry) => entry.id === String(emojiId || '').trim()) || null;

const parseTierIndex = (tierCode) => {
  const parsed = Number(String(tierCode || '').replace('tier_', ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeTierCode = (value, index) => {
  const raw = String(value || '').trim();
  return /^tier_\d+$/.test(raw) ? raw : `tier_${index + 1}`;
};

const normalizeRankTier = (tier, index) => ({
  code: normalizeTierCode(tier?.code, index),
  minPoints: Math.max(0, Number(tier?.minPoints ?? tier?.threshold ?? 0)),
});

const sanitizeEmojiIds = (raw) => Array.from(new Set(
  Array.isArray(raw)
    ? raw
      .map((value) => String(value || '').trim())
      .filter((emojiId) => Boolean(getProfileEmojiEntryById(emojiId)))
    : [],
));

const getClampedTierCode = (requestedTierCode, tiers) => {
  if (!tiers.length) return requestedTierCode;
  const requestedIndex = parseTierIndex(requestedTierCode);
  const matchedTier = tiers
    .map((tier) => ({ tier, index: parseTierIndex(tier.code) }))
    .find(({ index }) => index >= requestedIndex);
  return matchedTier?.tier.code || tiers[tiers.length - 1].code;
};

const buildDefaultRankEmojiPolicy = (tiers) => {
  const tierUnlocks = tiers.reduce((accumulator, tier) => ({
    ...accumulator,
    [tier.code]: {
      allowedEmojiIds: [],
    },
  }), {});

  PROFILE_EMOJI_REGISTRY.forEach((entry) => {
    const tierCode = getClampedTierCode(entry.unlockTierCode, tiers);
    const currentTier = tierUnlocks[tierCode] || { allowedEmojiIds: [] };
    currentTier.allowedEmojiIds = [...currentTier.allowedEmojiIds, entry.id];
    tierUnlocks[tierCode] = currentTier;
  });

  const firstTierCode = tiers[0]?.code;
  if (firstTierCode) {
    const firstTier = tierUnlocks[firstTierCode] || { allowedEmojiIds: [] };
    if (!firstTier.allowedEmojiIds.includes(DEFAULT_PROFILE_EMOJI_ID)) {
      firstTier.allowedEmojiIds = [DEFAULT_PROFILE_EMOJI_ID, ...firstTier.allowedEmojiIds];
    }
    tierUnlocks[firstTierCode] = {
      allowedEmojiIds: Array.from(new Set(firstTier.allowedEmojiIds)),
    };
  }

  return {
    enabled: true,
    defaultEmojiId: DEFAULT_PROFILE_EMOJI_ID,
    tiers: tierUnlocks,
  };
};

const resolveRankPolicy = (rawRankPolicy) => {
  const tiers = Array.isArray(rawRankPolicy?.tiers)
    ? rawRankPolicy.tiers
      .map((tier, index) => normalizeRankTier(tier, index))
      .sort((a, b) => a.minPoints - b.minPoints)
    : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const normalizedTiers = tiers.length > 0 ? tiers : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const defaultEmojiPolicy = buildDefaultRankEmojiPolicy(normalizedTiers);
  const emojiPolicyTiers = normalizedTiers.reduce((accumulator, tier) => {
    const allowedEmojiIds = sanitizeEmojiIds(rawRankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds);
    accumulator[tier.code] = {
      allowedEmojiIds: allowedEmojiIds.length > 0
        ? allowedEmojiIds
        : [...(defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || [])],
    };
    return accumulator;
  }, {});

  const defaultEmojiId = getProfileEmojiEntryById(rawRankPolicy?.emojiPolicy?.defaultEmojiId)
    ? String(rawRankPolicy?.emojiPolicy?.defaultEmojiId || '').trim()
    : defaultEmojiPolicy.defaultEmojiId;
  const firstTierCode = normalizedTiers[0]?.code;
  if (firstTierCode) {
    const firstTier = emojiPolicyTiers[firstTierCode] || { allowedEmojiIds: [] };
    emojiPolicyTiers[firstTierCode] = {
      allowedEmojiIds: Array.from(new Set([defaultEmojiId, ...firstTier.allowedEmojiIds])),
    };
  }

  return {
    enabled: rawRankPolicy?.enabled !== false,
    themeId: rawRankPolicy?.themeId === 'world_nobility' ? 'world_nobility' : 'korean_golpum',
    basedOn: rawRankPolicy?.basedOn === 'earnedTotal' || rawRankPolicy?.basedOn === 'earnedTotal_plus_positive_manual_adjust'
      ? rawRankPolicy.basedOn
      : 'earnedTotal_plus_positive_manual_adjust',
    tiers: normalizedTiers,
    emojiPolicy: {
      enabled: rawRankPolicy?.emojiPolicy?.enabled !== false,
      defaultEmojiId,
      tiers: emojiPolicyTiers,
    },
  };
};

const buildRankSnapshot = (rankEarnedTotal, rankPolicy) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  const metricValue = Math.max(0, Number(rankEarnedTotal || 0));
  let activeTier = resolvedRankPolicy.tiers[0] || { code: 'tier_1' };

  resolvedRankPolicy.tiers.forEach((tier) => {
    if (metricValue >= Number(tier.minPoints || 0)) {
      activeTier = tier;
    }
  });

  return {
    tierCode: activeTier.code,
    metricValue,
    basedOn: resolvedRankPolicy.basedOn,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const buildWalletRankState = (rankEarnedTotal, rankPolicy) => {
  const safeRankEarnedTotal = Math.max(0, Number(rankEarnedTotal || 0));
  return {
    rankEarnedTotal: safeRankEarnedTotal,
    rankSnapshot: buildRankSnapshot(safeRankEarnedTotal, rankPolicy),
  };
};

const sumPositiveManualAdjustDocs = (docs) => docs.reduce((total, docSnapshot) => {
  const transaction = docSnapshot?.data ? docSnapshot.data() : docSnapshot;
  if (transaction?.type !== 'manual_adjust') return total;
  const delta = Number(transaction?.delta || 0);
  return delta > 0 ? total + delta : total;
}, 0);

const getCurrentRankEarnedTotal = async (transaction, year, semester, uid, wallet) => {
  if (Number.isFinite(Number(wallet?.rankEarnedTotal))) {
    return Math.max(0, Number(wallet.rankEarnedTotal || 0));
  }

  const manualAdjustQuery = db.collection(getPointCollectionPath(year, semester, 'point_transactions'))
    .where('uid', '==', uid)
    .where('type', '==', 'manual_adjust');
  const manualAdjustSnap = await transaction.get(manualAdjustQuery);
  return Math.max(0, Number(wallet?.earnedTotal || 0) + sumPositiveManualAdjustDocs(manualAdjustSnap.docs));
};

const getAllowedEmojiIdsForTier = (rankPolicy, currentTierCode) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  if (!resolvedRankPolicy.emojiPolicy.enabled) {
    return PROFILE_EMOJI_REGISTRY.map((entry) => entry.id);
  }

  const targetTierCode = currentTierCode || resolvedRankPolicy.tiers[0]?.code || 'tier_1';
  const targetTierIndex = parseTierIndex(targetTierCode);
  const allowedEmojiIds = resolvedRankPolicy.tiers.reduce((accumulator, tier) => {
    if (parseTierIndex(tier.code) > targetTierIndex) {
      return accumulator;
    }
    return [
      ...accumulator,
      ...(resolvedRankPolicy.emojiPolicy.tiers[tier.code]?.allowedEmojiIds || []),
    ];
  }, []);
  const uniqueAllowedEmojiIds = Array.from(new Set(
    allowedEmojiIds.filter((emojiId) => Boolean(getProfileEmojiEntryById(emojiId))),
  ));

  return uniqueAllowedEmojiIds.length > 0
    ? uniqueAllowedEmojiIds
    : [resolvedRankPolicy.emojiPolicy.defaultEmojiId];
};

const getCurrentTierCodeForRankTotal = (rankEarnedTotal, rankPolicy) =>
  buildRankSnapshot(rankEarnedTotal, rankPolicy).tierCode;

const DEFAULT_POINT_POLICY = {
  attendanceDaily: 5,
  attendanceMonthlyBonus: 20,
  lessonView: 3,
  quizSolve: 10,
  manualAdjustEnabled: false,
  allowNegativeBalance: false,
  rankPolicy: resolveRankPolicy({
    enabled: true,
    themeId: 'korean_golpum',
    basedOn: 'earnedTotal_plus_positive_manual_adjust',
    tiers: DEFAULT_POINT_RANK_TIERS,
  }),
  updatedBy: '',
};

const getSemesterRoot = (year, semester) => `years/${year}/semesters/${semester}`;
const getPointCollectionPath = (year, semester, collectionName) => `${getSemesterRoot(year, semester)}/${collectionName}`;
const getPointWalletPath = (year, semester, uid) => `${getPointCollectionPath(year, semester, 'point_wallets')}/${uid}`;
const getPointPolicyPath = (year, semester) => `${getPointCollectionPath(year, semester, 'point_policies')}/current`;

const sanitizeKeyPart = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120) || 'empty';

const buildActivityTransactionId = (uid, type, sourceId) =>
  `activity_${sanitizeKeyPart(uid)}_${type}_${sanitizeKeyPart(sourceId)}`;

const buildPurchaseRequestId = (uid, requestKey) => {
  const digest = crypto.createHash('sha256').update(`${uid}:${requestKey}`).digest('hex').slice(0, 24);
  return `order_${sanitizeKeyPart(uid)}_${digest}`;
};

const buildOrderReviewTransactionId = (orderId, nextStatus) => {
  if (nextStatus === 'rejected' || nextStatus === 'cancelled') {
    return `purchase_cancel_${sanitizeKeyPart(orderId)}_${nextStatus}`;
  }
  return `purchase_confirm_${sanitizeKeyPart(orderId)}_${nextStatus}`;
};

const getKstDateKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const getAttendanceSourceId = () => `attendance-${getKstDateKey()}`;
const getAttendanceMonthKey = () => getKstDateKey().slice(0, 7);
const getDaysInMonthFromMonthKey = (monthKey) => {
  const [year, month] = String(monthKey || '').split('-').map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 0;
  }
  return new Date(year, month, 0).getDate();
};
const isLastDayOfMonth = () => {
  const today = getKstDateKey();
  const monthKey = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  return day === getDaysInMonthFromMonthKey(monthKey);
};

const getAuthEmail = (request) => String(request.auth?.token?.email || '').trim().toLowerCase();

const assertAuth = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }
  return request.auth.uid;
};

const assertAllowedWestoryUser = (request) => {
  const uid = assertAuth(request);
  const email = getAuthEmail(request);
  if (!email || (!SCHOOL_EMAIL_PATTERN.test(email) && email !== ADMIN_EMAIL)) {
    throw new HttpsError('permission-denied', 'This account cannot use Westory point functions.');
  }
  return { uid, email };
};

const assertYearSemester = (data) => {
  const year = String(data?.year || '').trim();
  const semester = String(data?.semester || '').trim();
  if (!year || !semester) {
    throw new HttpsError('invalid-argument', 'Year and semester are required.');
  }
  return { year, semester };
};

const getUserProfile = async (uid) => {
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('failed-precondition', 'User profile is missing.');
  }
  return {
    ref: userRef,
    profile: userSnap.data() || {},
  };
};

const hasStaffPermission = (profile, permission) =>
  profile.teacherPortalEnabled === true
  && Array.isArray(profile.staffPermissions)
  && profile.staffPermissions.includes(permission);

const assertPointManager = async (request) => {
  const { uid, email } = assertAllowedWestoryUser(request);
  if (email === ADMIN_EMAIL) {
    return { uid, email, profile: null };
  }

  const { profile } = await getUserProfile(uid);
  if (!hasStaffPermission(profile, 'point_manage')) {
    throw new HttpsError('permission-denied', 'point_manage permission is required.');
  }
  return { uid, email, profile };
};

const ensureStudentProfile = async (uid) => {
  const { ref, profile } = await getUserProfile(uid);
  return { ref, profile };
};

const buildWalletBase = (uid, profile) => ({
  uid,
  studentName: String(profile.name || '').trim(),
  grade: String(profile.grade || '').trim(),
  class: String(profile.class || '').trim(),
  number: String(profile.number || '').trim(),
});

const ensureWallet = async (transaction, year, semester, uid, profile) => {
  const walletRef = db.doc(getPointWalletPath(year, semester, uid));
  const walletSnap = await transaction.get(walletRef);
  if (walletSnap.exists) {
    return {
      ref: walletRef,
      wallet: walletSnap.data(),
    };
  }

  const wallet = {
    ...buildWalletBase(uid, profile),
    balance: 0,
    earnedTotal: 0,
    rankEarnedTotal: 0,
    spentTotal: 0,
    adjustedTotal: 0,
    rankSnapshot: null,
    lastTransactionAt: null,
  };
  return {
    ref: walletRef,
    wallet,
  };
};

const loadPolicy = async (transaction, year, semester) => {
  const policyRef = db.doc(getPointPolicyPath(year, semester));
  const policySnap = await transaction.get(policyRef);
  if (!policySnap.exists) {
    return DEFAULT_POINT_POLICY;
  }

  const data = policySnap.data() || {};
  return {
    ...DEFAULT_POINT_POLICY,
    ...data,
    rankPolicy: resolveRankPolicy(data.rankPolicy),
  };
};

const createTransactionPayload = ({
  uid,
  type,
  activityType,
  delta,
  balanceAfter,
  sourceId,
  sourceLabel,
  policyId,
  createdBy,
  targetMonth,
  targetDate,
}) => ({
  uid,
  type,
  activityType: activityType || type,
  delta,
  balanceAfter,
  sourceId,
  sourceLabel: String(sourceLabel || '').trim(),
  policyId: String(policyId || ''),
  createdBy,
  targetMonth: String(targetMonth || '').trim(),
  targetDate: String(targetDate || '').trim(),
  createdAt: FieldValue.serverTimestamp(),
});

const sortPointTransactionDocsDesc = (docs) => [...docs].sort((a, b) => {
  const aCreatedAt = a.data()?.createdAt || null;
  const bCreatedAt = b.data()?.createdAt || null;
  const secondGap = Number(bCreatedAt?.seconds || 0) - Number(aCreatedAt?.seconds || 0);
  if (secondGap !== 0) return secondGap;
  return Number(bCreatedAt?.nanoseconds || 0) - Number(aCreatedAt?.nanoseconds || 0);
});

exports.applyPointActivityReward = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const activityType = String(request.data?.activityType || '').trim();
  const allowedTypes = ['attendance', 'quiz', 'lesson'];
  if (!allowedTypes.includes(activityType)) {
    throw new HttpsError('invalid-argument', 'Unsupported point activity type.');
  }

  const sourceId = activityType === 'attendance'
    ? getAttendanceSourceId()
    : String(request.data?.sourceId || '').trim();
  if (!sourceId) {
    throw new HttpsError('invalid-argument', 'Activity sourceId is required.');
  }

  const requestedLabel = String(request.data?.sourceLabel || '').trim();
  const { profile } = await ensureStudentProfile(uid);

  return db.runTransaction(async (transaction) => {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const todayKey = getKstDateKey();
    const monthKey = todayKey.slice(0, 7);
    const rewardAmount = activityType === 'attendance'
      ? Number(policy.attendanceDaily || 0)
      : activityType === 'quiz'
        ? Number(policy.quizSolve || 0)
        : Number(policy.lessonView || 0);

    const transactionId = buildActivityTransactionId(uid, activityType, sourceId);
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
    const existingTx = await transaction.get(txRef);
    if (existingTx.exists) {
      const existing = existingTx.data() || {};
      return {
        awarded: false,
        duplicate: true,
        amount: Number(existing.delta || 0),
        balance: Number(existing.balanceAfter || wallet.balance || 0),
        transactionId,
        sourceId,
        policyId: 'current',
      };
    }

    if (rewardAmount <= 0) {
      return {
        awarded: false,
        duplicate: false,
        amount: 0,
        balance: Number(wallet.balance || 0),
        transactionId,
        sourceId,
        policyId: 'current',
      };
    }

    let nextBalance = Number(wallet.balance || 0) + rewardAmount;
    let totalAwarded = rewardAmount;
    let monthlyBonusAmount = 0;
    let monthlyBonusAwarded = false;
    let nextRankEarnedTotal = currentRankEarnedTotal + rewardAmount;
    let nextEarnedTotal = Number(wallet.earnedTotal || 0) + rewardAmount;
    let bonusTxRef = null;

    if (activityType === 'attendance') {
      const bonusAmount = Number(policy.attendanceMonthlyBonus || 0);
      const bonusTransactionId = buildActivityTransactionId(uid, 'attendance_monthly_bonus', monthKey);
      bonusTxRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${bonusTransactionId}`);
      const existingBonusTx = await transaction.get(bonusTxRef);

      if (!existingBonusTx.exists && bonusAmount > 0 && isLastDayOfMonth()) {
        const attendanceQuery = db.collection(getPointCollectionPath(year, semester, 'point_transactions'))
          .where('uid', '==', uid)
          .where('type', '==', 'attendance')
          .where('targetMonth', '==', monthKey);
        const attendanceSnapshot = await transaction.get(attendanceQuery);
        const attendanceDateSet = new Set(
          attendanceSnapshot.docs
            .map((doc) => String(doc.data().targetDate || '').trim())
            .filter(Boolean),
        );
        attendanceDateSet.add(todayKey);

        if (attendanceDateSet.size >= getDaysInMonthFromMonthKey(monthKey)) {
          monthlyBonusAmount = bonusAmount;
          monthlyBonusAwarded = true;
          totalAwarded += bonusAmount;
          nextBalance += bonusAmount;
          nextRankEarnedTotal += bonusAmount;
          nextEarnedTotal += bonusAmount;
        }
      }
    }
    transaction.set(walletRef, {
      ...buildWalletBase(uid, profile),
      balance: nextBalance,
      earnedTotal: nextEarnedTotal,
      ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0),
      adjustedTotal: Number(wallet.adjustedTotal || 0),
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(txRef, createTransactionPayload({
      uid,
      type: activityType,
      delta: rewardAmount,
      balanceAfter: Number(wallet.balance || 0) + rewardAmount,
      sourceId,
      sourceLabel: requestedLabel || (
        activityType === 'attendance'
          ? `${getKstDateKey()} attendance`
          : activityType === 'quiz'
            ? 'Quiz completed'
            : 'Lesson viewed'
      ),
      policyId: 'current',
      createdBy: 'system:auto',
      targetMonth: activityType === 'attendance' ? monthKey : '',
      targetDate: activityType === 'attendance' ? todayKey : '',
    }));

    if (monthlyBonusAwarded && bonusTxRef) {
      transaction.set(bonusTxRef, createTransactionPayload({
            uid,
            type: 'attendance_monthly_bonus',
            delta: monthlyBonusAmount,
            balanceAfter: nextBalance,
            sourceId: monthKey,
            sourceLabel: `${monthKey} 월간 개근 보너스`,
            policyId: 'current',
            createdBy: 'system:auto',
            targetMonth: monthKey,
            targetDate: todayKey,
          }));
    }

    return {
      awarded: true,
      duplicate: false,
      amount: rewardAmount,
      monthlyBonusAwarded,
      monthlyBonusAmount,
      totalAwarded,
      targetMonth: activityType === 'attendance' ? monthKey : '',
      balance: nextBalance,
      transactionId,
      sourceId,
      policyId: 'current',
    };
  });
});

exports.createPointPurchaseRequest = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const productId = String(request.data?.productId || '').trim();
  const requestKey = String(request.data?.requestKey || '').trim();
  const memo = String(request.data?.memo || '').trim();
  if (!productId || !requestKey) {
    throw new HttpsError('invalid-argument', 'productId and requestKey are required.');
  }

  const { profile } = await ensureStudentProfile(uid);

  return db.runTransaction(async (transaction) => {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const productRef = db.doc(`${getPointCollectionPath(year, semester, 'point_products')}/${productId}`);
    const productSnap = await transaction.get(productRef);
    if (!productSnap.exists) {
      throw new HttpsError('not-found', 'Point product does not exist.');
    }

    const product = { id: productSnap.id, ...(productSnap.data() || {}) };
    if (product.isActive === false) {
      throw new HttpsError('failed-precondition', 'Point product is inactive.');
    }
    if (Number(product.stock || 0) <= 0) {
      throw new HttpsError('failed-precondition', 'Point product is out of stock.');
    }
    if (Number(wallet.balance || 0) < Number(product.price || 0)) {
      throw new HttpsError('failed-precondition', 'Insufficient point balance.');
    }

    const orderId = buildPurchaseRequestId(uid, requestKey);
    const orderRef = db.doc(`${getPointCollectionPath(year, semester, 'point_orders')}/${orderId}`);
    const existingOrder = await transaction.get(orderRef);
    if (existingOrder.exists) {
      return {
        created: false,
        duplicate: true,
        orderId,
        transactionId: `purchase_hold_${orderId}`,
        balance: Number(wallet.balance || 0),
      };
    }

    const nextBalance = Number(wallet.balance || 0) - Number(product.price || 0);
    transaction.set(walletRef, {
      ...buildWalletBase(uid, profile),
      balance: nextBalance,
      earnedTotal: Number(wallet.earnedTotal || 0),
      ...buildWalletRankState(currentRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0) + Number(product.price || 0),
      adjustedTotal: Number(wallet.adjustedTotal || 0),
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(productRef, {
      stock: Math.max(0, Number(product.stock || 0) - 1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(orderRef, {
      uid,
      studentName: String(wallet.studentName || profile.name || '').trim(),
      productId,
      productName: String(product.name || '').trim(),
      priceSnapshot: Number(product.price || 0),
      status: 'requested',
      requestedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: '',
      memo,
    });

    const transactionId = `purchase_hold_${orderId}`;
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
    transaction.set(txRef, createTransactionPayload({
      uid,
      type: 'purchase_hold',
      delta: -Number(product.price || 0),
      balanceAfter: nextBalance,
      sourceId: orderId,
      sourceLabel: String(product.name || '').trim(),
      policyId: 'purchase',
      createdBy: uid,
    }));

    return {
      created: true,
      duplicate: false,
      orderId,
      transactionId,
      balance: nextBalance,
    };
  });
});

exports.adjustTeacherPoints = onCall({ region: REGION }, async (request) => {
  const manager = await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const targetUid = String(request.data?.uid || '').trim();
  const delta = Number(request.data?.delta || 0);
  const sourceId = String(request.data?.sourceId || `manual_${Date.now()}`).trim();
  const sourceLabel = String(request.data?.sourceLabel || '').trim();
  const policyId = String(request.data?.policyId || '').trim();

  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Target uid is required.');
  }
  if (!Number.isFinite(delta) || delta === 0) {
    throw new HttpsError('invalid-argument', 'Point delta must be a non-zero finite number.');
  }
  if (!sourceLabel) {
    throw new HttpsError('invalid-argument', 'A reason is required for manual point adjustment.');
  }

  const { profile } = await ensureStudentProfile(targetUid);

  return db.runTransaction(async (transaction) => {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, targetUid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, targetUid, wallet);

    if (!policy.manualAdjustEnabled) {
      throw new HttpsError('failed-precondition', 'Manual point adjustment is disabled by policy.');
    }

    const nextBalance = Number(wallet.balance || 0) + delta;
    const nextRankEarnedTotal = currentRankEarnedTotal + Math.max(0, delta);
    if (!policy.allowNegativeBalance && nextBalance < 0) {
      throw new HttpsError('failed-precondition', 'Insufficient point balance.');
    }

    transaction.set(walletRef, {
      ...buildWalletBase(targetUid, profile),
      balance: nextBalance,
      earnedTotal: Number(wallet.earnedTotal || 0),
      ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0),
      adjustedTotal: Number(wallet.adjustedTotal || 0) + delta,
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${crypto.randomUUID()}`);
    transaction.set(txRef, createTransactionPayload({
      uid: targetUid,
      type: 'manual_adjust',
      delta,
      balanceAfter: nextBalance,
      sourceId,
      sourceLabel,
      policyId,
      createdBy: manager.uid,
    }));

    return {
      walletId: walletRef.id,
      transactionId: txRef.id,
      balance: nextBalance,
    };
  });
});

exports.updateTeacherPointAdjustment = onCall({ region: REGION }, async (request) => {
  await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const transactionId = String(request.data?.transactionId || '').trim();
  const action = String(request.data?.action || 'update').trim();
  const requestedDelta = Number(request.data?.nextDelta || 0);

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'transactionId is required.');
  }
  if (!['update', 'cancel'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported action.');
  }
  if (action === 'update' && (!Number.isFinite(requestedDelta) || requestedDelta === 0)) {
    throw new HttpsError('invalid-argument', 'nextDelta must be a non-zero finite number.');
  }

  return db.runTransaction(async (transaction) => {
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
    const txSnap = await transaction.get(txRef);
    if (!txSnap.exists) {
      throw new HttpsError('not-found', 'Point transaction does not exist.');
    }

    const pointTransaction = { id: txSnap.id, ...(txSnap.data() || {}) };
    if (pointTransaction.type !== 'manual_adjust') {
      throw new HttpsError('failed-precondition', 'Only manual point adjustments can be edited.');
    }

    const targetUid = String(pointTransaction.uid || '').trim();
    if (!targetUid) {
      throw new HttpsError('failed-precondition', 'Transaction target uid is missing.');
    }

    const userTransactionQuery = db.collection(getPointCollectionPath(year, semester, 'point_transactions'))
      .where('uid', '==', targetUid);
    const userTransactionSnap = await transaction.get(userTransactionQuery);
    const sortedDocs = sortPointTransactionDocsDesc(userTransactionSnap.docs);
    if (!sortedDocs.length || sortedDocs[0].id !== transactionId) {
      throw new HttpsError('failed-precondition', 'Only the latest point transaction can be edited or cancelled.');
    }

    const { profile } = await ensureStudentProfile(targetUid);
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, targetUid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, targetUid, wallet);
    const previousDelta = Number(pointTransaction.delta || 0);
    const nextDelta = action === 'cancel' ? 0 : requestedDelta;
    const deltaDiff = nextDelta - previousDelta;
    const nextBalance = Number(wallet.balance || 0) + deltaDiff;
    const nextRankEarnedTotal = Math.max(
      0,
      currentRankEarnedTotal + Math.max(0, nextDelta) - Math.max(0, previousDelta),
    );

    if (!policy.allowNegativeBalance && nextBalance < 0) {
      throw new HttpsError('failed-precondition', 'Insufficient point balance.');
    }

    const nextLastTransactionAt = action === 'cancel'
      ? (sortedDocs[1]?.data()?.createdAt || null)
      : (pointTransaction.createdAt || wallet.lastTransactionAt || null);

    transaction.set(walletRef, {
      ...buildWalletBase(targetUid, profile),
      balance: nextBalance,
      earnedTotal: Number(wallet.earnedTotal || 0),
      ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0),
      adjustedTotal: Number(wallet.adjustedTotal || 0) + deltaDiff,
      lastTransactionAt: nextLastTransactionAt,
    }, { merge: true });

    if (action === 'cancel') {
      transaction.delete(txRef);
    } else {
      transaction.set(txRef, {
        delta: nextDelta,
        balanceAfter: nextBalance,
      }, { merge: true });
    }

    return {
      walletId: walletRef.id,
      transactionId,
      balance: nextBalance,
      delta: nextDelta,
      cancelled: action === 'cancel',
    };
  });
});

exports.reviewTeacherPointOrder = onCall({ region: REGION }, async (request) => {
  const manager = await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const orderId = String(request.data?.orderId || '').trim();
  const nextStatus = String(request.data?.nextStatus || '').trim();
  const memo = String(request.data?.memo || '').trim();

  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }
  if (!['approved', 'rejected', 'fulfilled', 'cancelled'].includes(nextStatus)) {
    throw new HttpsError('invalid-argument', 'Unsupported nextStatus.');
  }

  return db.runTransaction(async (transaction) => {
    const orderRef = db.doc(`${getPointCollectionPath(year, semester, 'point_orders')}/${orderId}`);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Point order does not exist.');
    }

    const order = { id: orderSnap.id, ...(orderSnap.data() || {}) };
    if (order.status === nextStatus) {
      return {
        orderId,
        transactionId: buildOrderReviewTransactionId(orderId, nextStatus),
        status: nextStatus,
        duplicate: true,
      };
    }

    const canTransition = (
      (order.status === 'requested' && ['approved', 'rejected', 'cancelled'].includes(nextStatus))
      || (order.status === 'approved' && nextStatus === 'fulfilled')
    );

    if (!canTransition) {
      throw new HttpsError('failed-precondition', 'Point order is not in a reviewable state.');
    }

    const { profile } = await ensureStudentProfile(order.uid);
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, order.uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, order.uid, wallet);
    const productRef = db.doc(`${getPointCollectionPath(year, semester, 'point_products')}/${order.productId}`);
    const productSnap = await transaction.get(productRef);

    transaction.set(orderRef, {
      status: nextStatus,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: manager.uid,
      memo: memo || String(order.memo || '').trim(),
    }, { merge: true });

    const transactionId = buildOrderReviewTransactionId(order.id, nextStatus);
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);

    if (nextStatus === 'rejected' || nextStatus === 'cancelled') {
      const restoredBalance = Number(wallet.balance || 0) + Number(order.priceSnapshot || 0);
      transaction.set(walletRef, {
        ...buildWalletBase(order.uid, profile),
        balance: restoredBalance,
        earnedTotal: Number(wallet.earnedTotal || 0),
        ...buildWalletRankState(currentRankEarnedTotal, policy.rankPolicy),
        spentTotal: Math.max(0, Number(wallet.spentTotal || 0) - Number(order.priceSnapshot || 0)),
        adjustedTotal: Number(wallet.adjustedTotal || 0),
        lastTransactionAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (productSnap.exists) {
        transaction.set(productRef, {
          stock: Number(productSnap.data().stock || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      transaction.set(txRef, createTransactionPayload({
        uid: order.uid,
        type: 'purchase_cancel',
        delta: Number(order.priceSnapshot || 0),
        balanceAfter: restoredBalance,
        sourceId: order.id,
        sourceLabel: String(order.productName || '').trim(),
        policyId: 'purchase',
        createdBy: manager.uid,
      }));

      return {
        orderId: order.id,
        transactionId,
        status: nextStatus,
        duplicate: false,
      };
    }

    transaction.set(walletRef, {
      ...buildWalletBase(order.uid, profile),
      ...buildWalletRankState(currentRankEarnedTotal, policy.rankPolicy),
    }, { merge: true });

    transaction.set(txRef, createTransactionPayload({
      uid: order.uid,
      type: 'purchase_confirm',
      delta: 0,
      balanceAfter: Number(wallet.balance || 0),
      sourceId: order.id,
      sourceLabel: String(order.productName || '').trim(),
      policyId: 'purchase',
      createdBy: manager.uid,
    }));

    return {
      orderId: order.id,
      transactionId,
      status: nextStatus,
      duplicate: false,
    };
  });
});

exports.updateStudentProfileIcon = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const emojiId = String(request.data?.emojiId || '').trim();
  const emojiEntry = getProfileEmojiEntryById(emojiId);

  if (!emojiEntry) {
    throw new HttpsError('invalid-argument', 'A valid emojiId is required.');
  }

  return db.runTransaction(async (transaction) => {
    const { ref: userRef, profile } = await getUserProfile(uid);
    const { wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const currentTierCode = getCurrentTierCodeForRankTotal(currentRankEarnedTotal, policy.rankPolicy);
    const allowedEmojiIds = getAllowedEmojiIdsForTier(policy.rankPolicy, currentTierCode);

    if (!allowedEmojiIds.includes(emojiId)) {
      throw new HttpsError('failed-precondition', 'This profile emoji is locked for the current rank.');
    }

    transaction.set(userRef, {
      profileIcon: emojiEntry.value,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      emojiId,
      profileIcon: emojiEntry.value,
      tierCode: currentTierCode,
    };
  });
});
