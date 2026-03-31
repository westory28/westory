const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();
Object.assign(exports, require('./sourceArchiveBeta'));
Object.assign(exports, require('./lessonPdfBeta'));

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
const DEFAULT_THEME_ID = 'korean_golpum';
const DEFAULT_PROFILE_EMOJI_ID = 'smile';
const PROFILE_EMOJI_REGISTRY = [
  { id: 'smile', emoji: '😀', value: '😀', label: '웃는 얼굴', category: '기본', sortOrder: 10, enabled: true, unlockTierCode: 'tier_1', legacyValues: [] },
  { id: 'soft_smile', emoji: '🙂', value: '🙂', label: '미소', category: '기본', sortOrder: 20, enabled: true, unlockTierCode: 'tier_1', legacyValues: [] },
  { id: 'note', emoji: '📝', value: '📝', label: '메모', category: '학습', sortOrder: 30, enabled: true, unlockTierCode: 'tier_1', legacyValues: [] },
  { id: 'book', emoji: '📚', value: '📚', label: '책', category: '학습', sortOrder: 40, enabled: true, unlockTierCode: 'tier_1', legacyValues: [] },
  { id: 'cool', emoji: '😎', value: '😎', label: '선글라스', category: '표정', sortOrder: 50, enabled: true, unlockTierCode: 'tier_2', legacyValues: [] },
  { id: 'brain', emoji: '🧠', value: '🧠', label: '두뇌', category: '학습', sortOrder: 60, enabled: true, unlockTierCode: 'tier_2', legacyValues: [] },
  { id: 'clover', emoji: '🍀', value: '🍀', label: '행운', category: '자연', sortOrder: 70, enabled: true, unlockTierCode: 'tier_2', legacyValues: [] },
  { id: 'target', emoji: '🎯', value: '🎯', label: '목표', category: '학습', sortOrder: 80, enabled: true, unlockTierCode: 'tier_2', legacyValues: [] },
  { id: 'nerd', emoji: '🤓', value: '🤓', label: '공부 모드', category: '표정', sortOrder: 90, enabled: true, unlockTierCode: 'tier_3', legacyValues: [] },
  { id: 'trophy', emoji: '🏆', value: '🏆', label: '트로피', category: '성취', sortOrder: 100, enabled: true, unlockTierCode: 'tier_3', legacyValues: [] },
  { id: 'rocket', emoji: '🚀', value: '🚀', label: '로켓', category: '성취', sortOrder: 110, enabled: true, unlockTierCode: 'tier_3', legacyValues: [] },
  { id: 'school', emoji: '🏫', value: '🏫', label: '학교', category: '학습', sortOrder: 120, enabled: true, unlockTierCode: 'tier_3', legacyValues: [] },
  { id: 'sparkles', emoji: '🌟', value: '🌟', label: '반짝별', category: '반짝임', sortOrder: 130, enabled: true, unlockTierCode: 'tier_4', legacyValues: [] },
  { id: 'science', emoji: '🧪', value: '🧪', label: '실험', category: '학습', sortOrder: 140, enabled: true, unlockTierCode: 'tier_4', legacyValues: [] },
  { id: 'tiger', emoji: '🐯', value: '🐯', label: '호랑이', category: '동물', sortOrder: 150, enabled: true, unlockTierCode: 'tier_4', legacyValues: [] },
  { id: 'panda', emoji: '🐼', value: '🐼', label: '판다', category: '동물', sortOrder: 160, enabled: true, unlockTierCode: 'tier_4', legacyValues: [] },
  { id: 'pencil', emoji: '✏️', value: '✏️', label: '연필', category: '학습', sortOrder: 170, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
  { id: 'bear', emoji: '🐻', value: '🐻', label: '곰', category: '동물', sortOrder: 180, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
  { id: 'fox', emoji: '🦊', value: '🦊', label: '여우', category: '동물', sortOrder: 190, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
  { id: 'dolphin', emoji: '🐬', value: '🐬', label: '돌고래', category: '동물', sortOrder: 200, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
  { id: 'owl', emoji: '🦉', value: '🦉', label: '부엉이', category: '동물', sortOrder: 210, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
  { id: 'whale', emoji: '🐳', value: '🐳', label: '고래', category: '동물', sortOrder: 220, enabled: true, unlockTierCode: 'tier_5', legacyValues: [] },
];

const cloneDefaultEmojiRegistry = () => PROFILE_EMOJI_REGISTRY.map((entry) => ({
  ...entry,
  legacyValues: [...(entry.legacyValues || [])],
}));

const normalizeThemeId = (value) => (
  value === 'world_nobility' ? 'world_nobility' : DEFAULT_THEME_ID
);

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
  allowedEmojiIds: Array.isArray(tier?.allowedEmojiIds)
    ? tier.allowedEmojiIds.map((value) => String(value || '').trim()).filter(Boolean)
    : undefined,
});

const buildEmojiMaps = (registry) => {
  const byId = new Map();
  const byValue = new Map();
  registry.forEach((entry) => {
    byId.set(entry.id, entry);
    byValue.set(entry.emoji, entry);
    byValue.set(entry.value || entry.emoji, entry);
    (entry.legacyValues || []).forEach((legacyValue) => {
      if (!byValue.has(legacyValue)) {
        byValue.set(legacyValue, entry);
      }
    });
  });
  return { byId, byValue };
};

const getProfileEmojiEntryById = (emojiId, registry = PROFILE_EMOJI_REGISTRY) =>
  buildEmojiMaps(registry).byId.get(String(emojiId || '').trim()) || null;

const getEnabledEmojiRegistry = (registry) => registry.filter((entry) => entry.enabled !== false);

const ensureUniqueEmojiId = (candidateId, usedIds, fallbackIndex) => {
  const baseId = String(candidateId || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `emoji_${fallbackIndex + 1}`;
  let nextId = baseId;
  let suffix = 2;
  while (usedIds.has(nextId)) {
    nextId = `${baseId}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(nextId);
  return nextId;
};

const resolveEmojiRegistry = (rawRegistry) => {
  if (!Array.isArray(rawRegistry)) {
    return cloneDefaultEmojiRegistry();
  }

  const usedIds = new Set();
  const entries = rawRegistry.map((entry, index) => {
    const fallbackEntry = PROFILE_EMOJI_REGISTRY[index] || {};
    const emoji = String(entry?.emoji || entry?.value || fallbackEntry.emoji || '').trim();
    if (!emoji) return null;
    const rawValue = String(entry?.value || '').trim();
    return {
      id: ensureUniqueEmojiId(entry?.id || fallbackEntry.id || entry?.label || emoji, usedIds, index),
      emoji,
      value: emoji,
      label: String(entry?.label || fallbackEntry.label || `이모지 ${index + 1}`).trim(),
      category: String(entry?.category || fallbackEntry.category || '기타').trim() || '기타',
      sortOrder: Number.isFinite(Number(entry?.sortOrder)) ? Number(entry.sortOrder) : Number(fallbackEntry.sortOrder || (index + 1) * 10),
      enabled: entry?.enabled !== false,
      unlockTierCode: /^tier_\d+$/.test(String(entry?.unlockTierCode || '')) ? String(entry.unlockTierCode).trim() : fallbackEntry.unlockTierCode,
      legacyValues: Array.from(new Set([
        ...(Array.isArray(entry?.legacyValues) ? entry.legacyValues.map((value) => String(value || '').trim()).filter(Boolean) : []),
        rawValue && rawValue !== emoji ? rawValue : '',
      ].filter(Boolean))),
    };
  }).filter(Boolean);

  if (!entries.length) {
    return cloneDefaultEmojiRegistry();
  }

  return [...entries].sort((a, b) => {
    const sortGap = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (sortGap !== 0) return sortGap;
    return String(a.label || '').localeCompare(String(b.label || ''), 'ko');
  });
};

const sanitizeEmojiIds = (raw, registry) => Array.from(new Set(
  Array.isArray(raw)
    ? raw
      .map((value) => String(value || '').trim())
      .filter((emojiId) => {
        const entry = getProfileEmojiEntryById(emojiId, registry);
        return Boolean(entry && entry.enabled !== false);
      })
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

const buildDefaultRankEmojiPolicy = (tiers, registry) => {
  const enabledRegistry = getEnabledEmojiRegistry(registry);
  const tierUnlocks = tiers.reduce((accumulator, tier) => ({
    ...accumulator,
    [tier.code]: {
      allowedEmojiIds: [],
    },
  }), {});

  enabledRegistry.forEach((entry) => {
    const tierCode = getClampedTierCode(entry.unlockTierCode || tiers[0]?.code || 'tier_1', tiers);
    const currentTier = tierUnlocks[tierCode] || { allowedEmojiIds: [] };
    currentTier.allowedEmojiIds = [...currentTier.allowedEmojiIds, entry.id];
    tierUnlocks[tierCode] = currentTier;
  });

  const requestedDefaultEmojiId = getProfileEmojiEntryById(DEFAULT_PROFILE_EMOJI_ID, enabledRegistry)?.id
    || enabledRegistry[0]?.id
    || DEFAULT_PROFILE_EMOJI_ID;
  const firstTierCode = tiers[0]?.code;
  if (firstTierCode) {
    const firstTier = tierUnlocks[firstTierCode] || { allowedEmojiIds: [] };
    if (!firstTier.allowedEmojiIds.includes(requestedDefaultEmojiId)) {
      firstTier.allowedEmojiIds = [requestedDefaultEmojiId, ...firstTier.allowedEmojiIds];
    }
    tierUnlocks[firstTierCode] = {
      allowedEmojiIds: Array.from(new Set(firstTier.allowedEmojiIds)),
    };
  }

  return {
    enabled: true,
    defaultEmojiId: requestedDefaultEmojiId,
    legacyMode: 'keep_selected',
    tiers: tierUnlocks,
  };
};

const resolveRankPolicy = (rawRankPolicy) => {
  const emojiRegistry = resolveEmojiRegistry(rawRankPolicy?.emojiRegistry);
  const tiers = Array.isArray(rawRankPolicy?.tiers)
    ? rawRankPolicy.tiers
      .map((tier, index) => normalizeRankTier(tier, index))
      .sort((a, b) => a.minPoints - b.minPoints)
    : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const normalizedTiers = tiers.length > 0 ? tiers : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const defaultEmojiPolicy = buildDefaultRankEmojiPolicy(normalizedTiers, emojiRegistry);
  const usedEmojiIds = new Set();
  const nextTiers = normalizedTiers.map((tier) => {
    const hasExplicitAllowedEmojiIds = Array.isArray(tier.allowedEmojiIds)
      || Array.isArray(rawRankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds);
    const requestedAllowedEmojiIds = hasExplicitAllowedEmojiIds
      ? (tier.allowedEmojiIds || rawRankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds || [])
      : (defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || []);
    const allowedEmojiIds = sanitizeEmojiIds(requestedAllowedEmojiIds, emojiRegistry).filter((emojiId) => {
      if (usedEmojiIds.has(emojiId)) return false;
      usedEmojiIds.add(emojiId);
      return true;
    });
    return {
      ...tier,
      allowedEmojiIds,
    };
  });

  const enabledRegistry = getEnabledEmojiRegistry(emojiRegistry);
  const defaultEmojiId = getProfileEmojiEntryById(rawRankPolicy?.emojiPolicy?.defaultEmojiId, enabledRegistry)?.id
    || getProfileEmojiEntryById(defaultEmojiPolicy.defaultEmojiId, enabledRegistry)?.id
    || enabledRegistry[0]?.id
    || DEFAULT_PROFILE_EMOJI_ID;
  const firstTierCode = nextTiers[0]?.code;
  if (firstTierCode) {
    nextTiers.forEach((tier) => {
      tier.allowedEmojiIds = (tier.allowedEmojiIds || []).filter((emojiId) => (
        tier.code === firstTierCode || emojiId !== defaultEmojiId
      ));
    });
    nextTiers[0].allowedEmojiIds = Array.from(new Set([defaultEmojiId, ...(nextTiers[0].allowedEmojiIds || [])]));
  }

  const emojiPolicyTiers = nextTiers.reduce((accumulator, tier) => {
    accumulator[tier.code] = {
      allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
    };
    return accumulator;
  }, {});

  return {
    enabled: rawRankPolicy?.enabled !== false,
    activeThemeId: normalizeThemeId(rawRankPolicy?.activeThemeId ?? rawRankPolicy?.themeId),
    themeId: normalizeThemeId(rawRankPolicy?.activeThemeId ?? rawRankPolicy?.themeId),
    basedOn: rawRankPolicy?.basedOn === 'earnedTotal' || rawRankPolicy?.basedOn === 'earnedTotal_plus_positive_manual_adjust'
      ? rawRankPolicy.basedOn
      : 'earnedTotal_plus_positive_manual_adjust',
    tiers: nextTiers,
    emojiRegistry,
    emojiPolicy: {
      enabled: rawRankPolicy?.emojiPolicy?.enabled !== false,
      defaultEmojiId,
      legacyMode: rawRankPolicy?.emojiPolicy?.legacyMode === 'strict' ? 'strict' : 'keep_selected',
      tiers: emojiPolicyTiers,
    },
    celebrationPolicy: {
      enabled: rawRankPolicy?.celebrationPolicy?.enabled !== false,
      effectLevel: rawRankPolicy?.celebrationPolicy?.effectLevel === 'subtle' ? 'subtle' : 'standard',
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
  const enabledRegistry = getEnabledEmojiRegistry(resolvedRankPolicy.emojiRegistry);
  if (!resolvedRankPolicy.emojiPolicy.enabled) {
    return enabledRegistry.map((entry) => entry.id);
  }

  const targetTierCode = currentTierCode || resolvedRankPolicy.tiers[0]?.code || 'tier_1';
  const targetTierIndex = resolvedRankPolicy.tiers.findIndex((tier) => tier.code === targetTierCode);
  const safeTargetTierIndex = targetTierIndex >= 0 ? targetTierIndex : 0;
  const allowedEmojiIds = resolvedRankPolicy.tiers.reduce((accumulator, tier, index) => {
    if (index > safeTargetTierIndex) {
      return accumulator;
    }
    return [
      ...accumulator,
      ...(tier.allowedEmojiIds || []),
    ];
  }, []);
  const uniqueAllowedEmojiIds = Array.from(new Set(
    allowedEmojiIds.filter((emojiId) => {
      const entry = getProfileEmojiEntryById(emojiId, resolvedRankPolicy.emojiRegistry);
      return Boolean(entry && entry.enabled !== false);
    }),
  ));

  return uniqueAllowedEmojiIds.length > 0
    ? uniqueAllowedEmojiIds
    : [resolvedRankPolicy.emojiPolicy.defaultEmojiId];
};

const getCurrentTierCodeForRankTotal = (rankEarnedTotal, rankPolicy) =>
  buildRankSnapshot(rankEarnedTotal, rankPolicy).tierCode;

const toFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) =>
  Math.max(0, toFiniteNumber(value, fallback));

const toPositiveThreshold = (value, fallback = 100) =>
  Math.max(0, Math.round(toFiniteNumber(value, fallback)));

const toPositiveInteger = (value, fallback = 1) =>
  Math.max(1, Math.round(toFiniteNumber(value, fallback)));

const resolveAutoRewardEnabled = (policy) => {
  const nestedRewardPolicy = policy?.rewardPolicy || {};
  return nestedRewardPolicy?.autoEnabled ?? policy?.autoRewardEnabled;
};

const resolveQuizBonusInput = (policy) => {
  const nestedRewardPolicy = policy?.rewardPolicy || {};
  const legacyBonus = policy?.quizBonus || policy?.quizPerfectBonus || {};
  const nestedBonus = nestedRewardPolicy?.quizBonus || legacyBonus || {};
  return {
    enabled: policy?.quizBonusEnabled ?? policy?.quizPerfectBonusEnabled ?? nestedBonus?.enabled,
    threshold: policy?.quizBonusThreshold ?? policy?.quizPerfectBonusThreshold ?? nestedBonus?.thresholdScore ?? nestedBonus?.threshold,
    amount: policy?.quizBonusAmount ?? policy?.quizPerfectBonusAmount ?? nestedBonus?.amount,
  };
};

const getDefaultPointPolicy = () => ({
  attendanceDaily: 5,
  attendanceMonthlyBonus: 20,
  lessonView: 3,
  quizSolve: 10,
  thinkCloudEnabled: true,
  thinkCloudAmount: 20,
  thinkCloudMaxClaims: 5,
  mapTagEnabled: true,
  mapTagAmount: 10,
  mapTagMaxClaims: 5,
  historyClassroomEnabled: true,
  historyClassroomAmount: 50,
  historyClassroomBonusEnabled: false,
  historyClassroomBonusThreshold: 100,
  historyClassroomBonusAmount: 0,
  attendanceMilestoneBonusEnabled: false,
  attendanceMilestone50: 0,
  attendanceMilestone100: 0,
  attendanceMilestone200: 0,
  attendanceMilestone300: 0,
  autoRewardEnabled: true,
  quizBonusEnabled: false,
  quizBonusThreshold: 100,
  quizBonusAmount: 0,
  manualAdjustEnabled: false,
  allowNegativeBalance: false,
  rewardPolicy: {
    autoEnabled: true,
    attendance: { enabled: true, amount: 5 },
    quiz: { enabled: true, amount: 10 },
    lesson: { enabled: true, amount: 3 },
    thinkCloud: { enabled: true, amount: 20, cooldownHours: 24, maxClaims: 5 },
    mapTag: { enabled: true, amount: 10, cooldownHours: 24, maxClaims: 5 },
    historyClassroom: { enabled: true, amount: 50, cooldownHours: 24 },
    attendanceMonthlyBonus: { enabled: true, amount: 20 },
    quizBonus: { enabled: false, thresholdScore: 100, amount: 0 },
    historyClassroomBonus: { enabled: false, thresholdScore: 100, amount: 0 },
    attendanceMilestoneBonus: {
      enabled: false,
      amounts: {
        '50': 0,
        '100': 0,
        '200': 0,
        '300': 0,
      },
    },
  },
  controlPolicy: {
    manualAdjustEnabled: false,
    allowNegativeBalance: false,
  },
  rankPolicy: resolveRankPolicy({
    enabled: true,
    activeThemeId: 'korean_golpum',
    basedOn: 'earnedTotal_plus_positive_manual_adjust',
    tiers: DEFAULT_POINT_RANK_TIERS,
  }),
  updatedBy: '',
});

const DEFAULT_POINT_POLICY = getDefaultPointPolicy();

const normalizePointPolicy = (policy) => {
  const defaults = getDefaultPointPolicy();
  const quizBonus = resolveQuizBonusInput(policy);
  const autoRewardEnabled = resolveAutoRewardEnabled(policy) !== false;
  const controlPolicy = policy?.controlPolicy || {};
  const rewardPolicy = policy?.rewardPolicy || {};
  const manualAdjustEnabled = (controlPolicy?.manualAdjustEnabled ?? policy?.manualAdjustEnabled) === true;
  const allowNegativeBalance = (controlPolicy?.allowNegativeBalance ?? policy?.allowNegativeBalance) === true;
  const thinkCloudRule = rewardPolicy?.thinkCloud || {};
  const mapTagRule = rewardPolicy?.mapTag || {};
  const historyClassroomRule = rewardPolicy?.historyClassroom || {};
  const historyClassroomBonusRule = rewardPolicy?.historyClassroomBonus || {};
  const attendanceMilestoneBonusRule = rewardPolicy?.attendanceMilestoneBonus || {};
  const thinkCloudEnabled = (policy?.thinkCloudEnabled ?? thinkCloudRule?.enabled ?? defaults.thinkCloudEnabled) === true;
  const thinkCloudAmount = toNonNegativeNumber(
    policy?.thinkCloudAmount ?? thinkCloudRule?.amount,
    defaults.thinkCloudAmount,
  );
  const thinkCloudMaxClaims = Math.max(
    1,
    Math.round(toFiniteNumber(
      policy?.thinkCloudMaxClaims ?? thinkCloudRule?.maxClaims,
      defaults.thinkCloudMaxClaims,
    )),
  );
  const mapTagEnabled = (policy?.mapTagEnabled ?? mapTagRule?.enabled ?? defaults.mapTagEnabled) === true;
  const mapTagAmount = toNonNegativeNumber(
    policy?.mapTagAmount ?? mapTagRule?.amount,
    defaults.mapTagAmount,
  );
  const mapTagMaxClaims = Math.max(
    1,
    Math.round(toFiniteNumber(
      policy?.mapTagMaxClaims ?? mapTagRule?.maxClaims,
      defaults.mapTagMaxClaims,
    )),
  );
  const historyClassroomEnabled = (policy?.historyClassroomEnabled ?? historyClassroomRule?.enabled ?? defaults.historyClassroomEnabled) === true;
  const historyClassroomAmount = toNonNegativeNumber(
    policy?.historyClassroomAmount ?? historyClassroomRule?.amount,
    defaults.historyClassroomAmount,
  );
  const historyClassroomBonusEnabled = (policy?.historyClassroomBonusEnabled
    ?? historyClassroomBonusRule?.enabled
    ?? defaults.historyClassroomBonusEnabled) === true;
  const historyClassroomBonusThreshold = toPositiveThreshold(
    policy?.historyClassroomBonusThreshold ?? historyClassroomBonusRule?.thresholdScore,
    defaults.historyClassroomBonusThreshold,
  );
  const historyClassroomBonusAmount = toNonNegativeNumber(
    policy?.historyClassroomBonusAmount ?? historyClassroomBonusRule?.amount,
    defaults.historyClassroomBonusAmount,
  );
  const attendanceMilestoneBonusEnabled = (policy?.attendanceMilestoneBonusEnabled
    ?? attendanceMilestoneBonusRule?.enabled
    ?? defaults.attendanceMilestoneBonusEnabled) === true;
  const attendanceMilestone50 = toNonNegativeNumber(
    policy?.attendanceMilestone50 ?? attendanceMilestoneBonusRule?.amounts?.['50'],
    defaults.attendanceMilestone50,
  );
  const attendanceMilestone100 = toNonNegativeNumber(
    policy?.attendanceMilestone100 ?? attendanceMilestoneBonusRule?.amounts?.['100'],
    defaults.attendanceMilestone100,
  );
  const attendanceMilestone200 = toNonNegativeNumber(
    policy?.attendanceMilestone200 ?? attendanceMilestoneBonusRule?.amounts?.['200'],
    defaults.attendanceMilestone200,
  );
  const attendanceMilestone300 = toNonNegativeNumber(
    policy?.attendanceMilestone300 ?? attendanceMilestoneBonusRule?.amounts?.['300'],
    defaults.attendanceMilestone300,
  );

  return {
    ...defaults,
    ...(policy || {}),
    attendanceDaily: toNonNegativeNumber(policy?.attendanceDaily, defaults.attendanceDaily),
    attendanceMonthlyBonus: toNonNegativeNumber(policy?.attendanceMonthlyBonus, defaults.attendanceMonthlyBonus),
    lessonView: toNonNegativeNumber(policy?.lessonView, defaults.lessonView),
    quizSolve: toNonNegativeNumber(policy?.quizSolve, defaults.quizSolve),
    thinkCloudEnabled,
    thinkCloudAmount,
    thinkCloudMaxClaims,
    mapTagEnabled,
    mapTagAmount,
    mapTagMaxClaims,
    historyClassroomEnabled,
    historyClassroomAmount,
    historyClassroomBonusEnabled,
    historyClassroomBonusThreshold,
    historyClassroomBonusAmount,
    attendanceMilestoneBonusEnabled,
    attendanceMilestone50,
    attendanceMilestone100,
    attendanceMilestone200,
    attendanceMilestone300,
    autoRewardEnabled,
    quizBonusEnabled: quizBonus.enabled === true,
    quizBonusThreshold: toPositiveThreshold(quizBonus.threshold, defaults.quizBonusThreshold),
    quizBonusAmount: toNonNegativeNumber(quizBonus.amount, defaults.quizBonusAmount),
    manualAdjustEnabled,
    allowNegativeBalance,
    rewardPolicy: {
      autoEnabled: autoRewardEnabled,
      attendance: {
        enabled: autoRewardEnabled,
        amount: toNonNegativeNumber(policy?.attendanceDaily, defaults.attendanceDaily),
      },
      quiz: {
        enabled: autoRewardEnabled,
        amount: toNonNegativeNumber(policy?.quizSolve, defaults.quizSolve),
      },
      lesson: {
        enabled: autoRewardEnabled,
        amount: toNonNegativeNumber(policy?.lessonView, defaults.lessonView),
      },
      thinkCloud: {
        enabled: autoRewardEnabled && thinkCloudEnabled,
        amount: thinkCloudAmount,
        cooldownHours: Math.max(1, Math.round(toFiniteNumber(
          thinkCloudRule?.cooldownHours,
          defaults.rewardPolicy.thinkCloud.cooldownHours,
        ))),
        maxClaims: thinkCloudMaxClaims,
      },
      mapTag: {
        enabled: autoRewardEnabled && mapTagEnabled,
        amount: mapTagAmount,
        cooldownHours: Math.max(1, Math.round(toFiniteNumber(
          mapTagRule?.cooldownHours,
          defaults.rewardPolicy.mapTag.cooldownHours,
        ))),
        maxClaims: mapTagMaxClaims,
      },
      historyClassroom: {
        enabled: autoRewardEnabled && historyClassroomEnabled,
        amount: historyClassroomAmount,
        cooldownHours: Math.max(1, Math.round(toFiniteNumber(
          historyClassroomRule?.cooldownHours,
          defaults.rewardPolicy.historyClassroom.cooldownHours,
        ))),
      },
      attendanceMonthlyBonus: {
        enabled: autoRewardEnabled,
        amount: toNonNegativeNumber(policy?.attendanceMonthlyBonus, defaults.attendanceMonthlyBonus),
      },
      quizBonus: {
        enabled: quizBonus.enabled === true,
        thresholdScore: toPositiveThreshold(quizBonus.threshold, defaults.quizBonusThreshold),
        amount: toNonNegativeNumber(quizBonus.amount, defaults.quizBonusAmount),
      },
      historyClassroomBonus: {
        enabled: historyClassroomBonusEnabled,
        thresholdScore: historyClassroomBonusThreshold,
        amount: historyClassroomBonusAmount,
      },
      attendanceMilestoneBonus: {
        enabled: attendanceMilestoneBonusEnabled,
        amounts: {
          '50': attendanceMilestone50,
          '100': attendanceMilestone100,
          '200': attendanceMilestone200,
          '300': attendanceMilestone300,
        },
      },
    },
    controlPolicy: {
      manualAdjustEnabled,
      allowNegativeBalance,
    },
    rankPolicy: resolveRankPolicy(policy?.rankPolicy),
    updatedBy: String(policy?.updatedBy || '').trim(),
  };
};

const buildPointPolicyPayload = (policy, actorUid) => {
  const normalizedPolicy = normalizePointPolicy(policy);
  return {
    attendanceDaily: normalizedPolicy.attendanceDaily,
    attendanceMonthlyBonus: normalizedPolicy.attendanceMonthlyBonus,
    lessonView: normalizedPolicy.lessonView,
    quizSolve: normalizedPolicy.quizSolve,
    thinkCloudEnabled: normalizedPolicy.thinkCloudEnabled,
    thinkCloudAmount: normalizedPolicy.thinkCloudAmount,
    thinkCloudMaxClaims: normalizedPolicy.thinkCloudMaxClaims,
    mapTagEnabled: normalizedPolicy.mapTagEnabled,
    mapTagAmount: normalizedPolicy.mapTagAmount,
    mapTagMaxClaims: normalizedPolicy.mapTagMaxClaims,
    historyClassroomEnabled: normalizedPolicy.historyClassroomEnabled,
    historyClassroomAmount: normalizedPolicy.historyClassroomAmount,
    historyClassroomBonusEnabled: normalizedPolicy.historyClassroomBonusEnabled,
    historyClassroomBonusThreshold: normalizedPolicy.historyClassroomBonusThreshold,
    historyClassroomBonusAmount: normalizedPolicy.historyClassroomBonusAmount,
    attendanceMilestoneBonusEnabled: normalizedPolicy.attendanceMilestoneBonusEnabled,
    attendanceMilestone50: normalizedPolicy.attendanceMilestone50,
    attendanceMilestone100: normalizedPolicy.attendanceMilestone100,
    attendanceMilestone200: normalizedPolicy.attendanceMilestone200,
    attendanceMilestone300: normalizedPolicy.attendanceMilestone300,
    autoRewardEnabled: normalizedPolicy.autoRewardEnabled,
    quizBonusEnabled: normalizedPolicy.quizBonusEnabled,
    quizBonusThreshold: normalizedPolicy.quizBonusThreshold,
    quizBonusAmount: normalizedPolicy.quizBonusAmount,
    manualAdjustEnabled: normalizedPolicy.manualAdjustEnabled,
    allowNegativeBalance: normalizedPolicy.allowNegativeBalance,
    rewardPolicy: normalizedPolicy.rewardPolicy,
    controlPolicy: normalizedPolicy.controlPolicy,
    rankPolicy: resolveRankPolicy(normalizedPolicy.rankPolicy),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: String(actorUid || '').trim(),
  };
};

const getSemesterRoot = (year, semester) => `years/${year}/semesters/${semester}`;
const getPointCollectionPath = (year, semester, collectionName) => `${getSemesterRoot(year, semester)}/${collectionName}`;
const getPointWalletPath = (year, semester, uid) => `${getPointCollectionPath(year, semester, 'point_wallets')}/${uid}`;
const getPointPolicyPath = (year, semester) => `${getPointCollectionPath(year, semester, 'point_policies')}/current`;
const WIS_HALL_OF_FAME_DOC_ID = 'hall_of_fame';
const WIS_HALL_OF_FAME_SNAPSHOT_VERSION = 2;
const WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS = 4;
const WIS_HALL_OF_FAME_STALE_MS = WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
const WIS_HALL_OF_FAME_GRADE_KEY = '3';
const DEFAULT_HALL_OF_FAME_PROFILE_ICON = '😀';
const DEFAULT_HALL_OF_FAME_GRADE_RANK_LIMIT = 10;
const DEFAULT_HALL_OF_FAME_CLASS_RANK_LIMIT = 10;
const DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT = 20;
const DEFAULT_HALL_OF_FAME_INCLUDE_TIES = true;
const getWisHallOfFamePath = (year, semester) => `${getPointCollectionPath(year, semester, 'point_public')}/${WIS_HALL_OF_FAME_DOC_ID}`;

const sanitizeKeyPart = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120) || 'empty';

const normalizeHallOfFameText = (value) => String(value || '').trim();

const normalizeHallOfFameSchoolValue = (value) => {
  const normalized = normalizeHallOfFameText(value);
  if (!normalized) return '';
  const digits = normalized.match(/\d+/)?.[0] || '';
  if (!digits) return normalized;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : normalized;
};

const buildWisHallOfFameClassKey = (grade, className) => {
  const normalizedGrade = normalizeHallOfFameSchoolValue(grade);
  const normalizedClass = normalizeHallOfFameSchoolValue(className);
  if (!normalizedGrade || !normalizedClass) return '';
  return `${normalizedGrade}-${normalizedClass}`;
};

const DEFAULT_HALL_OF_FAME_POSITION_PRESET = 'classic_podium_v1';
const DEFAULT_HALL_OF_FAME_POSITIONS = {
  desktop: {
    first: { leftPercent: 50, topPercent: 25, widthPercent: 24 },
    second: { leftPercent: 22, topPercent: 43, widthPercent: 22 },
    third: { leftPercent: 78, topPercent: 43, widthPercent: 22 },
  },
  mobile: {
    first: { leftPercent: 50, topPercent: 27, widthPercent: 31 },
    second: { leftPercent: 22, topPercent: 50, widthPercent: 27 },
    third: { leftPercent: 78, topPercent: 50, widthPercent: 27 },
  },
};
const DEFAULT_HALL_OF_FAME_LEADERBOARD_PANEL = {
  desktop: { leftPercent: 71, topPercent: 0, widthPercent: 29 },
  mobile: { leftPercent: 50, topPercent: 0, widthPercent: 100 },
};
const DEFAULT_HALL_OF_FAME_RECOGNITION_POPUP = {
  enabled: true,
  gradeEnabled: true,
  classEnabled: true,
};

const normalizeHallOfFameBoundedNumber = (value, minimum, maximum, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, numericValue));
};

const normalizeHallOfFamePodiumSlotPosition = (value, fallback) => ({
  leftPercent: normalizeHallOfFameBoundedNumber(value?.leftPercent, 0, 100, fallback.leftPercent),
  topPercent: normalizeHallOfFameBoundedNumber(value?.topPercent, 0, 100, fallback.topPercent),
  widthPercent: normalizeHallOfFameBoundedNumber(value?.widthPercent, 8, 72, fallback.widthPercent),
});

const normalizeHallOfFamePodiumPositions = (value, fallback) => ({
  first: normalizeHallOfFamePodiumSlotPosition(value?.first, fallback.first),
  second: normalizeHallOfFamePodiumSlotPosition(value?.second, fallback.second),
  third: normalizeHallOfFamePodiumSlotPosition(value?.third, fallback.third),
});

const normalizeHallOfFameLeaderboardPanelPosition = (value, fallback) => ({
  leftPercent: normalizeHallOfFameBoundedNumber(value?.leftPercent, 0, 100, fallback.leftPercent),
  topPercent: normalizeHallOfFameBoundedNumber(value?.topPercent, 0, 100, fallback.topPercent),
  widthPercent: normalizeHallOfFameBoundedNumber(value?.widthPercent, 40, 100, fallback.widthPercent),
});

const normalizeHallOfFameRankLimit = (value, fallback) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT, Math.max(4, parsed));
};

const resolveHallOfFameLeaderboardPolicy = async () => {
  try {
    const interfaceSnapshot = await db.doc('site_settings/interface_config').get();
    const data = interfaceSnapshot.exists ? (interfaceSnapshot.data() || {}) : {};
    const publicRange = data?.hallOfFame?.publicRange || {};
    return {
      gradeRankLimit: normalizeHallOfFameRankLimit(
        publicRange.gradeRankLimit,
        DEFAULT_HALL_OF_FAME_GRADE_RANK_LIMIT,
      ),
      classRankLimit: normalizeHallOfFameRankLimit(
        publicRange.classRankLimit,
        DEFAULT_HALL_OF_FAME_CLASS_RANK_LIMIT,
      ),
      includeTies: publicRange.includeTies !== false,
      storedRankLimit: DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT,
    };
  } catch (error) {
    console.warn('Failed to read hall of fame public range config, using defaults:', error);
    return {
      gradeRankLimit: DEFAULT_HALL_OF_FAME_GRADE_RANK_LIMIT,
      classRankLimit: DEFAULT_HALL_OF_FAME_CLASS_RANK_LIMIT,
      includeTies: DEFAULT_HALL_OF_FAME_INCLUDE_TIES,
      storedRankLimit: DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT,
    };
  }
};

const resolveHallOfFameInterfaceConfig = (value = {}) => ({
  podiumImageUrl: normalizeHallOfFameText(value?.podiumImageUrl),
  podiumStoragePath: normalizeHallOfFameText(value?.podiumStoragePath),
  positionPreset: normalizeHallOfFameText(value?.positionPreset) || DEFAULT_HALL_OF_FAME_POSITION_PRESET,
  positions: {
    desktop: normalizeHallOfFamePodiumPositions(
      value?.positions?.desktop,
      DEFAULT_HALL_OF_FAME_POSITIONS.desktop,
    ),
    mobile: normalizeHallOfFamePodiumPositions(
      value?.positions?.mobile,
      DEFAULT_HALL_OF_FAME_POSITIONS.mobile,
    ),
  },
  leaderboardPanel: {
    desktop: normalizeHallOfFameLeaderboardPanelPosition(
      value?.leaderboardPanel?.desktop,
      DEFAULT_HALL_OF_FAME_LEADERBOARD_PANEL.desktop,
    ),
    mobile: normalizeHallOfFameLeaderboardPanelPosition(
      value?.leaderboardPanel?.mobile,
      DEFAULT_HALL_OF_FAME_LEADERBOARD_PANEL.mobile,
    ),
  },
  publicRange: {
    gradeRankLimit: normalizeHallOfFameRankLimit(
      value?.publicRange?.gradeRankLimit,
      DEFAULT_HALL_OF_FAME_GRADE_RANK_LIMIT,
    ),
    classRankLimit: normalizeHallOfFameRankLimit(
      value?.publicRange?.classRankLimit,
      DEFAULT_HALL_OF_FAME_CLASS_RANK_LIMIT,
    ),
    includeTies: value?.publicRange?.includeTies !== false,
  },
  recognitionPopup: {
    enabled: value?.recognitionPopup?.enabled !== false,
    gradeEnabled: value?.recognitionPopup?.gradeEnabled !== false,
    classEnabled: value?.recognitionPopup?.classEnabled !== false,
  },
});

const resolveWisHallOfFameCumulativeEarned = (wallet) => {
  const rankEarnedTotal = Number(wallet?.rankEarnedTotal);
  if (Number.isFinite(rankEarnedTotal)) {
    return Math.max(0, rankEarnedTotal);
  }
  return Math.max(0, Number(wallet?.earnedTotal || 0));
};

const buildWisHallOfFameEntry = (wallet, profile = {}) => {
  const uid = normalizeHallOfFameText(wallet?.uid);
  const grade = normalizeHallOfFameSchoolValue(profile?.grade || wallet?.grade);
  const className = normalizeHallOfFameSchoolValue(profile?.class || wallet?.class);
  const displayName = normalizeHallOfFameText(
    profile?.displayName || profile?.customName || profile?.name || wallet?.studentName,
  );
  const studentName = normalizeHallOfFameText(profile?.name || wallet?.studentName || displayName);
  const classKey = buildWisHallOfFameClassKey(grade, className);
  const emojiEntry = getProfileEmojiEntryById(
    normalizeHallOfFameText(profile?.profileEmojiId || wallet?.profileEmojiId),
    PROFILE_EMOJI_REGISTRY,
  );
  if (!uid || !grade || !className || !studentName || !displayName || !classKey) {
    return null;
  }

  return {
    uid,
    rank: 1,
    grade,
    class: className,
    classKey,
    studentName,
    displayName,
    currentBalance: Math.max(0, Number(wallet?.balance || 0)),
    cumulativeEarned: resolveWisHallOfFameCumulativeEarned(wallet),
    profileIcon: normalizeHallOfFameText(profile?.profileIcon) || emojiEntry?.emoji || DEFAULT_HALL_OF_FAME_PROFILE_ICON,
    profileEmojiId: normalizeHallOfFameText(profile?.profileEmojiId),
  };
};

const compareWisHallOfFameEntries = (left, right) => {
  const cumulativeGap = Number(right.cumulativeEarned || 0) - Number(left.cumulativeEarned || 0);
  if (cumulativeGap !== 0) return cumulativeGap;

  const balanceGap = Number(right.currentBalance || 0) - Number(left.currentBalance || 0);
  if (balanceGap !== 0) return balanceGap;

  const nameCompare = String(left.displayName || left.studentName || '').localeCompare(
    String(right.displayName || right.studentName || ''),
    'ko',
  );
  if (nameCompare !== 0) return nameCompare;

  return String(left.uid || '').localeCompare(String(right.uid || ''), 'en');
};

const buildPodiumWisHallOfFameEntries = (entries) => buildRankedWisHallOfFameEntries(entries)
  .slice(0, 3)
  .map((entry, index) => ({
    ...entry,
    podiumSlot: index + 1,
  }));

const buildRankedWisHallOfFameEntries = (entries) => {
  const sortedEntries = [...entries].sort(compareWisHallOfFameEntries);
  let lastMetric = null;
  let lastRank = 0;

  return sortedEntries.map((entry, index) => {
    const currentMetric = Number(entry.cumulativeEarned || 0);
    if (lastMetric === null || currentMetric !== lastMetric) {
      lastRank = index + 1;
      lastMetric = currentMetric;
    }
    return {
      ...entry,
      rank: lastRank,
      podiumSlot: index < 3 ? index + 1 : undefined,
    };
  });
};

const buildLeaderboardWisHallOfFameEntries = (rankedEntries, rankLimit, includeTies) => {
  const safeLimit = normalizeHallOfFameRankLimit(rankLimit, DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT);
  if (safeLimit <= 0) {
    return [];
  }
  const visibleEntries = rankedEntries.slice(0, safeLimit);
  if (!includeTies || visibleEntries.length >= rankedEntries.length) {
    return visibleEntries;
  }

  const cutoffEntry = visibleEntries[visibleEntries.length - 1];
  if (!cutoffEntry) {
    return visibleEntries;
  }

  const cutoffMetric = Number(cutoffEntry.cumulativeEarned || 0);
  let endIndex = visibleEntries.length;
  while (
    endIndex < rankedEntries.length
    && Number(rankedEntries[endIndex]?.cumulativeEarned || 0) === cutoffMetric
  ) {
    endIndex += 1;
  }

  return rankedEntries.slice(0, endIndex);
};

const buildHallOfFameLeaderboardMeta = (rankedEntries, visibleEntries, rankLimit, includeTies) => {
  const safeLimit = normalizeHallOfFameRankLimit(rankLimit, DEFAULT_HALL_OF_FAME_STORED_RANK_LIMIT);
  if (!visibleEntries.length) {
    return {
      storedRankLimit: safeLimit,
      visibleCount: 0,
      totalCandidates: Array.isArray(rankedEntries) ? rankedEntries.length : 0,
      cutoffOrdinal: 0,
      cutoffRank: 0,
      cutoffCumulativeEarned: 0,
      includeTies,
    };
  }

  const cutoffOrdinal = Math.min(safeLimit, rankedEntries.length);
  const cutoffEntry = rankedEntries[Math.max(0, cutoffOrdinal - 1)] || null;

  return {
    storedRankLimit: safeLimit,
    visibleCount: visibleEntries.length,
    totalCandidates: Array.isArray(rankedEntries) ? rankedEntries.length : visibleEntries.length,
    cutoffOrdinal,
    cutoffRank: Number(cutoffEntry?.rank || 0),
    cutoffCumulativeEarned: Number(cutoffEntry?.cumulativeEarned || 0),
    includeTies,
  };
};

const buildWisHallOfFameSnapshotKey = (year, semester, snapshot) => {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      gradeTop3ByGrade: snapshot.gradeTop3ByGrade,
      classTop3ByClassKey: snapshot.classTop3ByClassKey,
      gradeLeaderboardByGrade: snapshot.gradeLeaderboardByGrade,
      classLeaderboardByClassKey: snapshot.classLeaderboardByClassKey,
      gradeLeaderboardMetaByGrade: snapshot.gradeLeaderboardMetaByGrade,
      classLeaderboardMetaByClassKey: snapshot.classLeaderboardMetaByClassKey,
      leaderboardPolicy: snapshot.leaderboardPolicy,
    }))
    .digest('hex')
    .slice(0, 16);
  return `${year}-${semester}-${digest}`;
};

const getSortedHallOfFameBucketKeys = (buckets) => Object.keys(buckets)
  .sort((left, right) => String(left || '').localeCompare(String(right || ''), 'ko', { numeric: true }))

const buildWisHallOfFamePayload = async (year, semester) => {
  const leaderboardPolicy = await resolveHallOfFameLeaderboardPolicy();
  const walletSnapshot = await db.collection(getPointCollectionPath(year, semester, 'point_wallets')).get();
  const wallets = walletSnapshot.docs
    .map((docSnapshot) => ({ uid: docSnapshot.id, ...(docSnapshot.data() || {}) }))
    .filter((wallet) => normalizeHallOfFameText(wallet.uid));
  const profileSnapshots = await Promise.all(
    wallets.map((wallet) => db.doc(`users/${wallet.uid}`).get().catch(() => null)),
  );

  const gradeBuckets = {};
  const classBuckets = {};

  wallets.forEach((wallet, index) => {
    const profileSnapshot = profileSnapshots[index];
    const profile = profileSnapshot?.exists ? (profileSnapshot.data() || {}) : {};
    if (normalizeHallOfFameText(profile?.role) && normalizeHallOfFameText(profile?.role) !== 'student') {
      return;
    }
    const entry = buildWisHallOfFameEntry(wallet, profile);
    if (!entry) return;

    gradeBuckets[entry.grade] = [...(gradeBuckets[entry.grade] || []), entry];
    classBuckets[entry.classKey] = [...(classBuckets[entry.classKey] || []), entry];
  });

  const gradeTop3ByGrade = {};
  const classTop3ByClassKey = {};
  const gradeLeaderboardByGrade = {};
  const classLeaderboardByClassKey = {};
  const gradeLeaderboardMetaByGrade = {};
  const classLeaderboardMetaByClassKey = {};

  getSortedHallOfFameBucketKeys(gradeBuckets).forEach((key) => {
    const rankedEntries = buildRankedWisHallOfFameEntries(gradeBuckets[key] || []);
    const visibleEntries = buildLeaderboardWisHallOfFameEntries(
      rankedEntries,
      leaderboardPolicy.storedRankLimit,
      true,
    );
    gradeTop3ByGrade[key] = buildPodiumWisHallOfFameEntries(rankedEntries);
    gradeLeaderboardByGrade[key] = visibleEntries;
    gradeLeaderboardMetaByGrade[key] = buildHallOfFameLeaderboardMeta(
      rankedEntries,
      visibleEntries,
      leaderboardPolicy.storedRankLimit,
      true,
    );
  });

  getSortedHallOfFameBucketKeys(classBuckets).forEach((key) => {
    const rankedEntries = buildRankedWisHallOfFameEntries(classBuckets[key] || []);
    const visibleEntries = buildLeaderboardWisHallOfFameEntries(
      rankedEntries,
      leaderboardPolicy.storedRankLimit,
      true,
    );
    classTop3ByClassKey[key] = buildPodiumWisHallOfFameEntries(rankedEntries);
    classLeaderboardByClassKey[key] = visibleEntries;
    classLeaderboardMetaByClassKey[key] = buildHallOfFameLeaderboardMeta(
      rankedEntries,
      visibleEntries,
      leaderboardPolicy.storedRankLimit,
      true,
    );
  });
  const updatedAtMs = Date.now();

  const snapshot = {
    year,
    semester,
    snapshotVersion: WIS_HALL_OF_FAME_SNAPSHOT_VERSION,
    rankingMetric: 'cumulativeEarned',
    primaryGradeKey: WIS_HALL_OF_FAME_GRADE_KEY,
    gradeTop3ByGrade,
    classTop3ByClassKey,
    gradeLeaderboardByGrade,
    classLeaderboardByClassKey,
    gradeLeaderboardMetaByGrade,
    classLeaderboardMetaByClassKey,
    leaderboardPolicy,
  };

  return {
    ...snapshot,
    snapshotKey: buildWisHallOfFameSnapshotKey(year, semester, snapshot),
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs,
  };
};

const refreshWisHallOfFame = async (year, semester) => {
  const payload = await buildWisHallOfFamePayload(year, semester);
  await db.doc(getWisHallOfFamePath(year, semester)).set(payload);
  return {
    ensured: true,
    snapshotKey: payload.snapshotKey,
    snapshotVersion: WIS_HALL_OF_FAME_SNAPSHOT_VERSION,
  };
};

const isWisHallOfFameSnapshotStale = (data) => {
  if (!data) return true;
  if (Number(data.snapshotVersion || 0) !== WIS_HALL_OF_FAME_SNAPSHOT_VERSION) {
    return true;
  }
  const updatedAtMs = Number(data.updatedAtMs || 0) > 0
    ? Number(data.updatedAtMs || 0)
    : typeof data.updatedAt?.toMillis === 'function'
      ? data.updatedAt.toMillis()
      : Number(data.updatedAt?.seconds || 0) * 1000;
  if (!updatedAtMs) return true;
  return Date.now() - updatedAtMs > WIS_HALL_OF_FAME_STALE_MS;
};

const tryRefreshWisHallOfFame = async (year, semester) => {
  try {
    const snapshotRef = db.doc(getWisHallOfFamePath(year, semester));
    const snapshot = await snapshotRef.get();
    const data = snapshot.exists ? (snapshot.data() || {}) : null;
    if (!isWisHallOfFameSnapshotStale(data)) {
      return {
        ensured: false,
        snapshotKey: String(data?.snapshotKey || '').trim(),
        snapshotVersion: Number(data?.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION),
      };
    }
    return await refreshWisHallOfFame(year, semester);
  } catch (error) {
    console.error('Failed to refresh wis hall of fame snapshot:', error);
    return {
      ensured: false,
      snapshotKey: '',
      snapshotVersion: WIS_HALL_OF_FAME_SNAPSHOT_VERSION,
    };
  }
};

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
    return getDefaultPointPolicy();
  }

  return normalizePointPolicy(policySnap.data() || {});
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

const extractActivityDocumentId = (sourceId, prefix) => {
  const normalizedSourceId = String(sourceId || '').trim();
  const normalizedPrefix = `${prefix}-`;
  return normalizedSourceId.startsWith(normalizedPrefix)
    ? normalizedSourceId.slice(normalizedPrefix.length).trim()
    : '';
};

const loadQuizActivityScore = async (transaction, year, semester, uid, sourceId) => {
  const quizResultId = extractActivityDocumentId(sourceId, 'quiz-result');
  if (quizResultId) {
    const quizResultRef = db.doc(`${getSemesterRoot(year, semester)}/quiz_results/${quizResultId}`);
    const quizResultSnap = await transaction.get(quizResultRef);
    if (!quizResultSnap.exists) {
      return null;
    }
    const data = quizResultSnap.data() || {};
    if (String(data.uid || '').trim() !== uid) {
      throw new HttpsError('permission-denied', 'Quiz result does not belong to the caller.');
    }
    return toNonNegativeNumber(data.score, 0);
  }

  const historyResultId = extractActivityDocumentId(sourceId, 'history-classroom');
  if (historyResultId) {
    const historyResultRef = db.doc(`${getSemesterRoot(year, semester)}/history_classroom_results/${historyResultId}`);
    const historyResultSnap = await transaction.get(historyResultRef);
    if (!historyResultSnap.exists) {
      return null;
    }
    const data = historyResultSnap.data() || {};
    if (String(data.uid || '').trim() !== uid) {
      throw new HttpsError('permission-denied', 'History classroom result does not belong to the caller.');
    }
    return toNonNegativeNumber(data.percent, 0);
  }

  return null;
};

const getTransactionCreatedAtMs = (docOrData) => {
  const createdAt = typeof docOrData?.data === 'function'
    ? docOrData.data()?.createdAt
    : docOrData?.createdAt;
  return (Number(createdAt?.seconds || 0) * 1000) + Math.floor(Number(createdAt?.nanoseconds || 0) / 1000000);
};

const listActivityTransactionsByType = async (transaction, year, semester, uid, type) => {
  const activityQuery = db.collection(getPointCollectionPath(year, semester, 'point_transactions'))
    .where('uid', '==', uid)
    .where('type', '==', type);
  const activitySnapshot = await transaction.get(activityQuery);
  return sortPointTransactionDocsDesc(activitySnapshot.docs);
};

const safeDecodeURIComponent = (value) => {
  try {
    return decodeURIComponent(String(value || '').trim());
  } catch {
    return String(value || '').trim();
  }
};

const parseThinkCloudRewardSource = (sourceId) => {
  const parts = String(sourceId || '').trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'think-cloud') {
    return null;
  }

  const sessionId = String(parts[1] || '').trim();
  const responseId = String(parts[2] || '').trim();
  if (!sessionId || !responseId) {
    return null;
  }

  return {
    sessionId,
    responseId,
  };
};

const assertThinkCloudRewardSource = async (transaction, year, semester, uid, sourceId) => {
  const parsedSource = parseThinkCloudRewardSource(sourceId);
  if (!parsedSource) {
    throw new HttpsError('invalid-argument', 'Invalid think cloud reward source.');
  }

  const responseRef = db.doc(
    `${getSemesterRoot(year, semester)}/think_cloud_sessions/${parsedSource.sessionId}/responses/${parsedSource.responseId}`,
  );
  const responseSnap = await transaction.get(responseRef);
  if (!responseSnap.exists) {
    throw new HttpsError('not-found', 'Think cloud response does not exist.');
  }

  const responseData = responseSnap.data() || {};
  if (String(responseData.uid || '').trim() !== uid) {
    throw new HttpsError('permission-denied', 'Think cloud response does not belong to the caller.');
  }

  return parsedSource;
};

const parseMapTagRewardSource = (sourceId) => {
  const parts = String(sourceId || '').trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'map-tag') {
    return null;
  }

  const mapId = safeDecodeURIComponent(parts[1]);
  const tag = safeDecodeURIComponent(parts[2]);
  const nonce = String(parts[3] || '').trim();
  if (!mapId || !tag || !nonce) {
    return null;
  }

  return {
    mapId,
    tag,
    nonce,
  };
};

const collectMapResourceTags = (resource) => {
  const rawTags = [];
  if (Array.isArray(resource?.pdfTagSections)) {
    resource.pdfTagSections.forEach((section) => {
      if (Array.isArray(section?.tags)) {
        rawTags.push(...section.tags);
      }
    });
  }
  if (Array.isArray(resource?.pdfRegions)) {
    resource.pdfRegions.forEach((region) => {
      if (Array.isArray(region?.tags)) {
        rawTags.push(...region.tags);
      }
    });
  }

  return new Set(
    rawTags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean),
  );
};

const assertMapTagRewardSource = async (transaction, year, semester, sourceId) => {
  const parsedSource = parseMapTagRewardSource(sourceId);
  if (!parsedSource) {
    throw new HttpsError('invalid-argument', 'Invalid map tag reward source.');
  }

  const scopedResourceRef = db.doc(`${getSemesterRoot(year, semester)}/map_resources/${parsedSource.mapId}`);
  let resourceSnap = await transaction.get(scopedResourceRef);
  if (!resourceSnap.exists) {
    const legacyResourceRef = db.doc(`map_resources/${parsedSource.mapId}`);
    resourceSnap = await transaction.get(legacyResourceRef);
  }
  if (!resourceSnap.exists) {
    throw new HttpsError('not-found', 'Map resource does not exist.');
  }

  const availableTags = collectMapResourceTags(resourceSnap.data() || {});
  if (!availableTags.has(parsedSource.tag)) {
    throw new HttpsError('invalid-argument', 'Map tag does not exist in the selected resource.');
  }

  return parsedSource;
};

const resolveActivityReward = ({
  policy,
  activityType,
  sourceId,
  sourceLabel,
  todayKey,
  monthKey,
  score,
  includeAttendanceMonthlyBonus = false,
  attendanceMilestoneReached = null,
}) => {
  const normalizedPolicy = normalizePointPolicy(policy);
  if (!normalizedPolicy.autoRewardEnabled) {
    return {
      baseAmount: 0,
      bonusAmount: 0,
      totalAmount: 0,
      items: [],
    };
  }

  const baseAmount = activityType === 'attendance'
    ? normalizedPolicy.attendanceDaily
    : activityType === 'quiz'
      ? normalizedPolicy.quizSolve
      : activityType === 'lesson'
        ? normalizedPolicy.lessonView
        : activityType === 'think_cloud'
          ? (normalizedPolicy.rewardPolicy.thinkCloud.enabled ? normalizedPolicy.rewardPolicy.thinkCloud.amount : 0)
          : activityType === 'map_tag'
            ? (normalizedPolicy.rewardPolicy.mapTag.enabled ? normalizedPolicy.rewardPolicy.mapTag.amount : 0)
            : (normalizedPolicy.rewardPolicy.historyClassroom.enabled ? normalizedPolicy.rewardPolicy.historyClassroom.amount : 0);
  const normalizedSourceLabel = String(sourceLabel || '').trim();
  const items = [];

  if (baseAmount > 0) {
    items.push({
      type: activityType,
      amount: baseAmount,
      sourceId,
      sourceLabel: normalizedSourceLabel || (
        activityType === 'attendance'
          ? `${todayKey} 출석 체크`
          : activityType === 'quiz'
            ? '문제 풀이'
            : activityType === 'lesson'
              ? '수업 자료 확인'
              : activityType === 'think_cloud'
                ? '생각모아 참여'
                : activityType === 'map_tag'
                  ? '지도 태그 탐색'
                  : '역사교실 제출 완료'
      ),
      targetMonth: activityType === 'attendance' ? monthKey : '',
      targetDate: activityType === 'attendance' ? todayKey : '',
    });
  }

  if (activityType === 'attendance' && includeAttendanceMonthlyBonus && normalizedPolicy.attendanceMonthlyBonus > 0) {
    items.push({
      type: 'attendance_monthly_bonus',
      amount: normalizedPolicy.attendanceMonthlyBonus,
      sourceId: monthKey,
      sourceLabel: `${monthKey} 월간 개근 보너스`,
      targetMonth: monthKey,
      targetDate: todayKey,
    });
  }

  if (
    activityType === 'attendance'
    && attendanceMilestoneReached
    && normalizedPolicy.rewardPolicy.attendanceMilestoneBonus.enabled
  ) {
    const milestoneKey = String(attendanceMilestoneReached);
    const milestoneAmount = Number(
      normalizedPolicy.rewardPolicy.attendanceMilestoneBonus.amounts?.[milestoneKey] || 0,
    );
    if (milestoneAmount > 0) {
      items.push({
        type: 'attendance_milestone_bonus',
        amount: milestoneAmount,
        sourceId: `attendance-milestone-${attendanceMilestoneReached}`,
        sourceLabel: `출석 ${attendanceMilestoneReached}회 달성 보너스`,
        targetMonth: monthKey,
        targetDate: todayKey,
      });
    }
  }

  if (
    activityType === 'quiz'
    && normalizedPolicy.quizBonusEnabled
    && normalizedPolicy.quizBonusAmount > 0
    && Number(score || 0) >= normalizedPolicy.quizBonusThreshold
  ) {
    items.push({
      type: 'quiz_bonus',
      amount: normalizedPolicy.quizBonusAmount,
      sourceId,
      sourceLabel: normalizedPolicy.quizBonusThreshold >= 100
        ? '문제 풀이 만점 보너스'
        : `문제 풀이 ${normalizedPolicy.quizBonusThreshold}점 이상 보너스`,
      targetMonth: '',
      targetDate: '',
    });
  }

  if (
    activityType === 'history_classroom'
    && normalizedPolicy.rewardPolicy.historyClassroomBonus.enabled
    && normalizedPolicy.rewardPolicy.historyClassroomBonus.amount > 0
    && Number(score || 0) >= normalizedPolicy.rewardPolicy.historyClassroomBonus.thresholdScore
  ) {
    items.push({
      type: 'history_classroom_bonus',
      amount: normalizedPolicy.rewardPolicy.historyClassroomBonus.amount,
      sourceId,
      sourceLabel: normalizedPolicy.rewardPolicy.historyClassroomBonus.thresholdScore >= 100
        ? '역사교실 성과 보너스'
        : `역사교실 정답률 ${normalizedPolicy.rewardPolicy.historyClassroomBonus.thresholdScore}% 이상 보너스`,
      targetMonth: '',
      targetDate: '',
    });
  }

  const totalAmount = items.reduce((total, item) => total + Number(item.amount || 0), 0);
  return {
    baseAmount,
    bonusAmount: Math.max(0, totalAmount - Math.max(0, baseAmount)),
    totalAmount,
    items,
  };
};

const sortPointTransactionDocsDesc = (docs) => [...docs].sort((a, b) => {
  const aCreatedAt = a.data()?.createdAt || null;
  const bCreatedAt = b.data()?.createdAt || null;
  const secondGap = Number(bCreatedAt?.seconds || 0) - Number(aCreatedAt?.seconds || 0);
  if (secondGap !== 0) return secondGap;
  return Number(bCreatedAt?.nanoseconds || 0) - Number(aCreatedAt?.nanoseconds || 0);
});

exports.ensureWisHallOfFame = onCall({ region: REGION }, async (request) => {
  assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const forceRefresh = request.data?.force === true;
  const snapshotRef = db.doc(getWisHallOfFamePath(year, semester));
  const snapshot = await snapshotRef.get();
  const data = snapshot.exists ? (snapshot.data() || {}) : null;

  if (forceRefresh) {
    await assertPointManager(request);
  }

  if (!forceRefresh && !isWisHallOfFameSnapshotStale(data)) {
    return {
      ensured: false,
      snapshotKey: String(data.snapshotKey || '').trim(),
      snapshotVersion: Number(data.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION),
    };
  }

  return refreshWisHallOfFame(year, semester);
});

exports.saveWisHallOfFameConfig = onCall({ region: REGION }, async (request) => {
  const { uid } = await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const shouldRefreshSnapshot = request.data?.refreshSnapshot === true;
  const hallOfFamePatch = request.data?.hallOfFame && typeof request.data.hallOfFame === 'object'
    ? request.data.hallOfFame
    : {};
  const interfaceRef = db.doc('site_settings/interface_config');
  const interfaceSnap = await interfaceRef.get();
  const existing = interfaceSnap.exists ? (interfaceSnap.data() || {}) : {};
  const existingHallOfFame = existing?.hallOfFame && typeof existing.hallOfFame === 'object'
    ? existing.hallOfFame
    : {};
  const mergedHallOfFame = {
    ...existingHallOfFame,
    ...hallOfFamePatch,
    positions: {
      ...(existingHallOfFame.positions || {}),
      ...(hallOfFamePatch.positions || {}),
      desktop: {
        ...(existingHallOfFame.positions?.desktop || {}),
        ...(hallOfFamePatch.positions?.desktop || {}),
      },
      mobile: {
        ...(existingHallOfFame.positions?.mobile || {}),
        ...(hallOfFamePatch.positions?.mobile || {}),
      },
    },
    leaderboardPanel: {
      ...(existingHallOfFame.leaderboardPanel || {}),
      ...(hallOfFamePatch.leaderboardPanel || {}),
      desktop: {
        ...(existingHallOfFame.leaderboardPanel?.desktop || {}),
        ...(hallOfFamePatch.leaderboardPanel?.desktop || {}),
      },
      mobile: {
        ...(existingHallOfFame.leaderboardPanel?.mobile || {}),
        ...(hallOfFamePatch.leaderboardPanel?.mobile || {}),
      },
    },
    publicRange: {
      ...(existingHallOfFame.publicRange || {}),
      ...(hallOfFamePatch.publicRange || {}),
    },
    recognitionPopup: {
      ...(existingHallOfFame.recognitionPopup || {}),
      ...(hallOfFamePatch.recognitionPopup || {}),
    },
  };
  const normalizedHallOfFame = resolveHallOfFameInterfaceConfig(mergedHallOfFame);

  await interfaceRef.set({
    ...existing,
    hallOfFame: normalizedHallOfFame,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });

  if (shouldRefreshSnapshot) {
    try {
      await refreshWisHallOfFame(year, semester);
    } catch (error) {
      console.error('Failed to refresh wis hall of fame snapshot after config save:', error);
    }
  }

  return {
    saved: true,
    hallOfFame: normalizedHallOfFame,
  };
});

exports.applyPointActivityReward = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const activityType = String(request.data?.activityType || '').trim();
  const allowedTypes = ['attendance', 'quiz', 'lesson', 'think_cloud', 'map_tag', 'history_classroom'];
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

  const result = await db.runTransaction(async (transaction) => {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const todayKey = getKstDateKey();
    const monthKey = todayKey.slice(0, 7);
    const currentBalance = Number(wallet.balance || 0);
    const currentEarnedTotal = Number(wallet.earnedTotal || 0);
    const activityScore = (activityType === 'quiz' || activityType === 'history_classroom')
      ? await loadQuizActivityScore(transaction, year, semester, uid, sourceId)
      : null;
    const fallbackTransactionId = buildActivityTransactionId(uid, activityType, sourceId);

    if (activityType === 'think_cloud') {
      await assertThinkCloudRewardSource(transaction, year, semester, uid, sourceId);
    }
    if (activityType === 'map_tag') {
      await assertMapTagRewardSource(transaction, year, semester, sourceId);
    }

    let claimCount = 0;
    if (activityType === 'think_cloud' || activityType === 'map_tag' || activityType === 'history_classroom') {
      const activityHistory = await listActivityTransactionsByType(transaction, year, semester, uid, activityType);
      const latestActivityDoc = activityHistory[0] || null;
      claimCount = activityHistory.length;
      const rewardRule = activityType === 'think_cloud'
        ? policy.rewardPolicy.thinkCloud
        : activityType === 'map_tag'
          ? policy.rewardPolicy.mapTag
          : policy.rewardPolicy.historyClassroom;
      const maxClaims = Number(rewardRule?.maxClaims || 0);
      if (maxClaims > 0 && claimCount >= maxClaims) {
        return {
          awarded: false,
          duplicate: true,
          amount: 0,
          bonusAwarded: false,
          bonusAmount: 0,
          bonusType: '',
          monthlyBonusAwarded: false,
          monthlyBonusAmount: 0,
          totalAwarded: 0,
          targetMonth: '',
          balance: currentBalance,
          transactionId: fallbackTransactionId,
          sourceId,
          policyId: 'current',
          blockedReason: 'max_claims_reached',
          blockedMessage: `누적 최대 ${maxClaims}회까지 적립됩니다.`,
          claimCount,
          maxClaims,
        };
      }

      const latestCreatedAtMs = getTransactionCreatedAtMs(latestActivityDoc);
      const cooldownHours = Math.max(1, Number(rewardRule?.cooldownHours || 24));
      const cooldownMs = cooldownHours * 60 * 60 * 1000;
      const nextEligibleAtMs = latestCreatedAtMs ? latestCreatedAtMs + cooldownMs : 0;
      if (nextEligibleAtMs && nextEligibleAtMs > Date.now()) {
        return {
          awarded: false,
          duplicate: true,
          amount: 0,
          bonusAwarded: false,
          bonusAmount: 0,
          bonusType: '',
          monthlyBonusAwarded: false,
          monthlyBonusAmount: 0,
          totalAwarded: 0,
          targetMonth: '',
          balance: currentBalance,
          transactionId: fallbackTransactionId,
          sourceId,
          policyId: 'current',
          blockedReason: 'cooldown_active',
          blockedMessage: `${cooldownHours}시간마다 1회만 적립됩니다.`,
          nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
          claimCount,
          maxClaims,
        };
      }
    }

    let includeAttendanceMonthlyBonus = false;
    let attendanceMilestoneReached = null;
    if (
      activityType === 'attendance'
      && Number(policy.attendanceMonthlyBonus || 0) > 0
      && isLastDayOfMonth()
    ) {
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
      includeAttendanceMonthlyBonus = attendanceDateSet.size >= getDaysInMonthFromMonthKey(monthKey);
    }

    if (activityType === 'attendance' && policy.rewardPolicy.attendanceMilestoneBonus.enabled) {
      const attendanceScope = `${year}_${semester}`;
      const attendanceDocQuery = db.collection(`users/${uid}/attendance`)
        .where('scope', '==', attendanceScope);
      const attendanceDocSnapshot = await transaction.get(attendanceDocQuery);
      const attendanceDateSet = new Set(
        attendanceDocSnapshot.docs
          .map((doc) => String(doc.data()?.date || '').trim())
          .filter(Boolean),
      );
      attendanceDateSet.add(todayKey);
      const attendanceCount = attendanceDateSet.size;
      const milestoneCandidates = [50, 100, 200, 300];
      attendanceMilestoneReached = milestoneCandidates.find((milestone) => (
        attendanceCount === milestone
        && Number(policy.rewardPolicy.attendanceMilestoneBonus.amounts?.[String(milestone)] || 0) > 0
      )) || null;
      claimCount = attendanceCount;
    }

    const rewardPlan = resolveActivityReward({
      policy,
      activityType,
      sourceId,
      sourceLabel: requestedLabel,
      todayKey,
      monthKey,
      score: activityScore,
      includeAttendanceMonthlyBonus,
      attendanceMilestoneReached,
    });

    const rewardDocs = [];
    for (const item of rewardPlan.items.filter((candidate) => Number(candidate.amount || 0) > 0)) {
      const transactionId = buildActivityTransactionId(uid, item.type, item.sourceId);
      const ref = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
      const snap = await transaction.get(ref);
      rewardDocs.push({
        item,
        ref,
        snap,
        transactionId,
      });
    }

    const newRewardDocs = rewardDocs.filter(({ snap }) => !snap.exists);
    const baseRewardDoc = newRewardDocs.find(({ item }) => item.type === activityType) || null;
    const newBonusDocs = newRewardDocs.filter(({ item }) => item.type !== activityType);
    const awardedBaseAmount = baseRewardDoc ? Number(baseRewardDoc.item.amount || 0) : 0;
    const bonusAmount = newBonusDocs.reduce((total, { item }) => total + Number(item.amount || 0), 0);
    const totalAwarded = newRewardDocs.reduce((total, { item }) => total + Number(item.amount || 0), 0);
    const monthlyBonusAmount = newBonusDocs
      .filter(({ item }) => item.type === 'attendance_monthly_bonus')
      .reduce((total, { item }) => total + Number(item.amount || 0), 0);
    const bonusType = newBonusDocs[0]?.item.type || '';
    const resolvedFallbackTransactionId = rewardDocs[0]?.transactionId || fallbackTransactionId;

    if (totalAwarded <= 0) {
      return {
        awarded: false,
        duplicate: rewardDocs.length > 0,
        amount: 0,
        bonusAwarded: false,
        bonusAmount: 0,
        bonusType: '',
        monthlyBonusAwarded: false,
        monthlyBonusAmount: 0,
        totalAwarded: 0,
        targetMonth: activityType === 'attendance' ? monthKey : '',
        balance: currentBalance,
        transactionId: resolvedFallbackTransactionId,
        sourceId,
        policyId: 'current',
        blockedReason: rewardDocs.length > 0 ? 'duplicate_source' : '',
        blockedMessage: rewardDocs.length > 0 ? '이미 지급된 기록입니다.' : '',
        claimCount,
        maxClaims: activityType === 'think_cloud'
          ? Number(policy.rewardPolicy.thinkCloud.maxClaims || 0)
          : activityType === 'map_tag'
            ? Number(policy.rewardPolicy.mapTag.maxClaims || 0)
            : 0,
      };
    }

    const nextBalance = currentBalance + totalAwarded;
    const nextRankEarnedTotal = currentRankEarnedTotal + totalAwarded;
    const nextEarnedTotal = currentEarnedTotal + totalAwarded;

    transaction.set(walletRef, {
      ...buildWalletBase(uid, profile),
      balance: nextBalance,
      earnedTotal: nextEarnedTotal,
      ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0),
      adjustedTotal: Number(wallet.adjustedTotal || 0),
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    let runningBalance = currentBalance;
    newRewardDocs.forEach(({ item, ref }) => {
      runningBalance += Number(item.amount || 0);
      transaction.set(ref, createTransactionPayload({
        uid,
        type: item.type,
        delta: Number(item.amount || 0),
        balanceAfter: runningBalance,
        sourceId: item.sourceId,
        sourceLabel: item.sourceLabel,
        policyId: 'current',
        createdBy: 'system:auto',
        targetMonth: item.targetMonth,
        targetDate: item.targetDate,
      }));
    });

    return {
      awarded: true,
      duplicate: false,
      amount: awardedBaseAmount,
      bonusAwarded: bonusAmount > 0,
      bonusAmount,
      bonusType,
      monthlyBonusAwarded: monthlyBonusAmount > 0,
      monthlyBonusAmount,
      totalAwarded,
      targetMonth: activityType === 'attendance' ? monthKey : '',
      balance: nextBalance,
      transactionId: baseRewardDoc?.transactionId || newRewardDocs[0]?.transactionId || resolvedFallbackTransactionId,
      sourceId,
      policyId: 'current',
      blockedReason: '',
      blockedMessage: '',
      claimCount: activityType === 'attendance'
        ? claimCount
        : claimCount + (baseRewardDoc ? 1 : 0),
      maxClaims: activityType === 'think_cloud'
        ? Number(policy.rewardPolicy.thinkCloud.maxClaims || 0)
        : activityType === 'map_tag'
          ? Number(policy.rewardPolicy.mapTag.maxClaims || 0)
          : 0,
    };
  });

  if (result.awarded) {
    await tryRefreshWisHallOfFame(year, semester);
  }
  return result;
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

  const result = await db.runTransaction(async (transaction) => {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const productRef = db.doc(`${getPointCollectionPath(year, semester, 'point_products')}/${productId}`);
    const productSnap = await transaction.get(productRef);
    if (!productSnap.exists) {
      throw new HttpsError('not-found', 'Point product does not exist.');
    }

    const product = { id: productSnap.id, ...(productSnap.data() || {}) };
    const productPrice = toNonNegativeNumber(product.price, 0);
    const productStock = Math.max(0, Math.floor(toFiniteNumber(product.stock, 0)));
    if (product.isActive === false) {
      throw new HttpsError('failed-precondition', 'Point product is inactive.');
    }
    if (productPrice <= 0) {
      throw new HttpsError('failed-precondition', 'Point product price must be greater than zero.');
    }
    if (productStock <= 0) {
      throw new HttpsError('failed-precondition', 'Point product is out of stock.');
    }
    if (Number(wallet.balance || 0) < productPrice) {
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

    const nextBalance = Number(wallet.balance || 0) - productPrice;
    transaction.set(walletRef, {
      ...buildWalletBase(uid, profile),
      balance: nextBalance,
      earnedTotal: Number(wallet.earnedTotal || 0),
      ...buildWalletRankState(currentRankEarnedTotal, policy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0) + productPrice,
      adjustedTotal: Number(wallet.adjustedTotal || 0),
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(productRef, {
      stock: Math.max(0, productStock - 1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(orderRef, {
      uid,
      studentName: String(wallet.studentName || profile.name || '').trim(),
      productId,
      productName: String(product.name || '').trim(),
      priceSnapshot: productPrice,
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
      delta: -productPrice,
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

  if (result.created) {
    await tryRefreshWisHallOfFame(year, semester);
  }
  return result;
});

exports.adjustTeacherPoints = onCall({ region: REGION }, async (request) => {
  const manager = await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const targetUid = String(request.data?.uid || '').trim();
  const delta = Number(request.data?.delta || 0);
  const requestedMode = String(request.data?.mode || '').trim();
  const sourceId = String(request.data?.sourceId || `manual_${Date.now()}`).trim();
  const sourceLabel = String(request.data?.sourceLabel || '').trim();
  const policyId = String(request.data?.policyId || '').trim();
  const mode = requestedMode === 'reclaim'
    ? 'reclaim'
    : requestedMode === 'grant'
      ? 'grant'
      : delta > 0
        ? 'grant'
        : 'reclaim';
  const transactionType = mode === 'reclaim' ? 'manual_reclaim' : 'manual_adjust';

  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Target uid is required.');
  }
  if (!Number.isFinite(delta) || delta === 0) {
    throw new HttpsError('invalid-argument', 'Point delta must be a non-zero finite number.');
  }
  if (!sourceLabel) {
    throw new HttpsError('invalid-argument', 'A reason is required for manual point adjustment.');
  }
  if ((mode === 'grant' && delta < 0) || (mode === 'reclaim' && delta > 0)) {
    throw new HttpsError('invalid-argument', 'Manual adjustment mode does not match the point delta.');
  }

  const { profile } = await ensureStudentProfile(targetUid);

  const result = await db.runTransaction(async (transaction) => {
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
      type: transactionType,
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
      type: transactionType,
    };
  });

  await tryRefreshWisHallOfFame(year, semester);
  return result;
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

  const result = await db.runTransaction(async (transaction) => {
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
    const txSnap = await transaction.get(txRef);
    if (!txSnap.exists) {
      throw new HttpsError('not-found', 'Point transaction does not exist.');
    }

    const pointTransaction = { id: txSnap.id, ...(txSnap.data() || {}) };
    if (!['manual_adjust', 'manual_reclaim'].includes(pointTransaction.type)) {
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
    if (action === 'update') {
      if (pointTransaction.type === 'manual_adjust' && nextDelta < 0) {
        throw new HttpsError('failed-precondition', 'Manual grants can only keep a positive delta.');
      }
      if (pointTransaction.type === 'manual_reclaim' && nextDelta > 0) {
        throw new HttpsError('failed-precondition', 'Manual reclaims can only keep a negative delta.');
      }
    }
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

  await tryRefreshWisHallOfFame(year, semester);
  return result;
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

  const result = await db.runTransaction(async (transaction) => {
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

  if (!result.duplicate) {
    await tryRefreshWisHallOfFame(year, semester);
  }
  return result;
});

exports.updateStudentProfileIcon = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const emojiId = String(request.data?.emojiId || '').trim();

  if (!emojiId) {
    throw new HttpsError('invalid-argument', 'A valid emojiId is required.');
  }

  const result = await db.runTransaction(async (transaction) => {
    const { ref: userRef, profile } = await getUserProfile(uid);
    const { wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const policy = await loadPolicy(transaction, year, semester);
    const emojiEntry = getProfileEmojiEntryById(emojiId, policy.rankPolicy.emojiRegistry);

    if (!emojiEntry || emojiEntry.enabled === false) {
      throw new HttpsError('invalid-argument', 'A valid emojiId is required.');
    }

    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const currentTierCode = getCurrentTierCodeForRankTotal(currentRankEarnedTotal, policy.rankPolicy);
    const allowedEmojiIds = getAllowedEmojiIdsForTier(policy.rankPolicy, currentTierCode);

    if (!allowedEmojiIds.includes(emojiId)) {
      throw new HttpsError('failed-precondition', 'This profile emoji is locked for the current rank.');
    }

    transaction.set(userRef, {
      profileEmojiId: emojiEntry.id,
      profileIcon: emojiEntry.emoji,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      emojiId,
      profileIcon: emojiEntry.emoji,
      tierCode: currentTierCode,
    };
  });

  await tryRefreshWisHallOfFame(year, semester);
  return result;
});
