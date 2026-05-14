const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

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
  historyDictionaryEnabled: true,
  historyDictionaryAmount: 50,
  historyDictionaryMaxDailyClaims: 4,
  historyDictionaryMinDefinitionLength: 20,
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
    historyDictionary: {
      enabled: true,
      amount: 50,
      maxDailyClaims: 4,
      minDefinitionLength: 20,
    },
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
  const historyDictionaryRule = rewardPolicy?.historyDictionary || {};
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
  const historyDictionaryEnabled = (policy?.historyDictionaryEnabled ?? historyDictionaryRule?.enabled ?? defaults.historyDictionaryEnabled) === true;
  const historyDictionaryAmount = toNonNegativeNumber(
    policy?.historyDictionaryAmount ?? historyDictionaryRule?.amount,
    defaults.historyDictionaryAmount,
  );
  const historyDictionaryMaxDailyClaims = Math.max(
    1,
    Math.round(toFiniteNumber(
      policy?.historyDictionaryMaxDailyClaims ?? historyDictionaryRule?.maxDailyClaims,
      defaults.historyDictionaryMaxDailyClaims,
    )),
  );
  const historyDictionaryMinDefinitionLength = Math.max(
    1,
    Math.round(toFiniteNumber(
      policy?.historyDictionaryMinDefinitionLength ?? historyDictionaryRule?.minDefinitionLength,
      defaults.historyDictionaryMinDefinitionLength,
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
    historyDictionaryEnabled,
    historyDictionaryAmount,
    historyDictionaryMaxDailyClaims,
    historyDictionaryMinDefinitionLength,
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
      historyDictionary: {
        enabled: autoRewardEnabled && historyDictionaryEnabled,
        amount: historyDictionaryAmount,
        maxDailyClaims: historyDictionaryMaxDailyClaims,
        minDefinitionLength: historyDictionaryMinDefinitionLength,
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
    historyDictionaryEnabled: normalizedPolicy.historyDictionaryEnabled,
    historyDictionaryAmount: normalizedPolicy.historyDictionaryAmount,
    historyDictionaryMaxDailyClaims: normalizedPolicy.historyDictionaryMaxDailyClaims,
    historyDictionaryMinDefinitionLength: normalizedPolicy.historyDictionaryMinDefinitionLength,
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
const getNotificationInboxPath = (year, semester, uid) => `${getSemesterRoot(year, semester)}/notification_inboxes/${uid}`;
const getNotificationItemsPath = (year, semester, uid) => `${getNotificationInboxPath(year, semester, uid)}/items`;
const getBroadcastNotificationsPath = (year, semester) => `${getSemesterRoot(year, semester)}/broadcast_notifications`;
const NOTIFICATION_CONFIG_PATH = 'site_settings/notification_config';
const NOTIFICATION_EVENT_AUDIENCE = {
  history_classroom_assigned: 'students',
  history_classroom_passed: 'teachers',
  history_classroom_submitted: 'teachers',
  history_dictionary_requested: 'teachers',
  history_dictionary_resolved: 'students',
  history_dictionary_rejected: 'students',
  point_order_requested: 'teachers',
  point_order_reviewed: 'students',
  lesson_worksheet_published: 'students',
  question_created: 'teachers',
  question_replied: 'students',
  quiz_submitted: 'teachers',
  lesson_unit_completed: 'teachers',
  think_cloud_submitted: 'teachers',
  system_notice: 'students',
};
const HISTORY_DICTIONARY_TERMS_COLLECTION = 'history_dictionary_terms';
const HISTORY_DICTIONARY_REQUESTS_COLLECTION = 'history_dictionary_requests';
const NOTIFICATION_RETENTION_DAYS = 30;
const WIS_HALL_OF_FAME_DOC_ID = 'hall_of_fame';
const WIS_HALL_OF_FAME_SNAPSHOT_VERSION = 6;
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

const sanitizeNotificationText = (value, maxLength, fallback = '') => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength);
};

const buildNotificationId = (dedupeKey) => {
  const normalized = sanitizeNotificationText(dedupeKey, 240);
  if (!normalized) return crypto.randomUUID();
  return `n_${crypto.createHash('sha1').update(normalized).digest('hex')}`;
};

const resolveNotificationAudience = (type, fallbackAudience = '') => {
  const requested = String(fallbackAudience || '').trim();
  if (requested === 'students' || requested === 'teachers') return requested;
  return NOTIFICATION_EVENT_AUDIENCE[type] || 'students';
};

const loadNotificationConfigSafely = async () => {
  try {
    const snap = await db.doc(NOTIFICATION_CONFIG_PATH).get();
    return snap.exists ? snap.data() || {} : {};
  } catch (error) {
    console.warn('Failed to load notification config. Notifications will use defaults.', error);
    return {};
  }
};

const normalizeNotificationTemplateValues = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, raw]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return acc;
    acc[normalizedKey] = String(raw ?? '').trim();
    return acc;
  }, {});
};

const getNotificationTemplateKeys = (template) => {
  const keys = new Set();
  for (const match of String(template || '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    keys.add(match[1]);
  }
  return Array.from(keys);
};

const renderNotificationTemplate = (template, values) => {
  const text = String(template || '').trim();
  if (!text) return '';
  const keys = getNotificationTemplateKeys(text);
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(values, key))) {
    return '';
  }
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] || '');
};

const resolveNotificationTemplateText = (template, fallback, values) => {
  const rendered = renderNotificationTemplate(template, values);
  return rendered || String(fallback || '').trim();
};

const resolveNotificationTargetUrl = (template, fallback, values) => {
  const fallbackUrl = String(fallback || '').trim();
  const policyUrl = String(template || '').trim();
  if (!policyUrl) return fallbackUrl;
  if (!fallbackUrl) return renderNotificationTemplate(policyUrl, values) || policyUrl;
  return getNotificationTemplateKeys(policyUrl).length > 0
    ? renderNotificationTemplate(policyUrl, values) || fallbackUrl
    : fallbackUrl;
};

const getNotificationPolicy = (config, type) => {
  const policies = config?.eventPolicies;
  if (!policies || typeof policies !== 'object') return null;
  const policy = policies[type];
  return policy && typeof policy === 'object' ? policy : null;
};

const prepareNotificationInput = async (year, semester, input, fallbackAudience = '') => {
  const type = sanitizeNotificationText(input.type, 80, 'system_notice');
  const audience = resolveNotificationAudience(type, fallbackAudience || input.audience);
  const config = await loadNotificationConfigSafely();
  const policy = getNotificationPolicy(config, type);

  if (
    config.enabled === false
    || (audience === 'students' && config.studentNotificationsEnabled === false)
    || (audience === 'teachers' && config.teacherNotificationsEnabled === false)
    || policy?.enabled === false
  ) {
    return { skipped: true, type, audience, reason: 'disabled_by_notification_config' };
  }

  const templateValues = normalizeNotificationTemplateValues(input.templateValues);
  const resolvedTitle = resolveNotificationTemplateText(policy?.titleTemplate, input.title, templateValues);
  const resolvedBody = resolveNotificationTemplateText(policy?.bodyTemplate, input.body, templateValues);
  const body = type === 'history_dictionary_requested'
    ? resolvedBody.replace(/학생이\s+"([^"]+)"\s+뜻풀이를 요청했습니다\./g, '학생이 $1 뜻풀이를 요청했습니다.')
    : resolvedBody;
  return {
    skipped: false,
    type,
    audience,
    title: resolvedTitle,
    body,
    targetUrl: resolveNotificationTargetUrl(policy?.targetUrl, input.targetUrl, templateValues),
    entityType: input.entityType,
    entityId: input.entityId,
    actorUid: input.actorUid,
    priority: policy?.priority === 'high' || input.priority === 'high' ? 'high' : 'normal',
    dedupeKey: input.dedupeKey,
  };
};

const normalizeHistoryDictionaryWord = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const sanitizeHistoryDictionaryWord = (value) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);

const sanitizeHistoryDictionaryText = (value, maxLength) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const sanitizeHistoryDictionaryTags = (value) => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const seen = new Set();
  return rawItems
    .map((item) => sanitizeHistoryDictionaryText(item, 24))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
};

const buildHistoryDictionaryHash = (value) =>
  crypto.createHash('sha1').update(String(value || '')).digest('hex');

const buildHistoryDictionaryTermId = (normalizedWord) =>
  `term_${buildHistoryDictionaryHash(normalizedWord)}`;

const buildHistoryDictionaryRequestId = (year, semester, uid, normalizedWord) =>
  `req_${buildHistoryDictionaryHash(`${year}:${semester}:${uid}:${normalizedWord}`)}`;

const getHistoryDictionaryTermPath = (termId) =>
  `${HISTORY_DICTIONARY_TERMS_COLLECTION}/${termId}`;

const getHistoryDictionaryRequestPath = (requestId) =>
  `${HISTORY_DICTIONARY_REQUESTS_COLLECTION}/${requestId}`;

const getStudentHistoryDictionaryWordPath = (uid, termId) =>
  `users/${uid}/history_dictionary_words/${termId}`;

const MAX_HISTORY_DICTIONARY_BULK_TERMS = 200;

const getNotificationExpiryTimestamp = () => Timestamp.fromMillis(
  Date.now() + NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
);

const normalizeHallOfFameText = (value) => String(value || '').trim();

const normalizeHallOfFameSchoolValue = (value) => {
  const normalized = normalizeHallOfFameText(value);
  if (!normalized) return '';
  const digits = normalized.match(/\d+/)?.[0] || '';
  if (!digits) return normalized;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : normalized;
};

const resolveHallOfFameProfileField = (profile, keys) => {
  for (const key of keys) {
    const value = normalizeHallOfFameText(profile?.[key]);
    if (value) return value;
  }
  return '';
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
    first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
    second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
    third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
  },
  mobile: {
    first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
    second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
    third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
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
  widthPercent: normalizeHallOfFameBoundedNumber(
    value?.widthPercent,
    fallback.widthPercent >= 90 ? 78 : 24,
    fallback.widthPercent >= 90 ? 100 : 38,
    fallback.widthPercent,
  ),
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
  const grade = normalizeHallOfFameSchoolValue(
    resolveHallOfFameProfileField(profile, ['studentGrade', 'grade']) || wallet?.grade,
  );
  const className = normalizeHallOfFameSchoolValue(
    resolveHallOfFameProfileField(profile, ['studentClass', 'class']) || wallet?.class,
  );
  const displayName = normalizeHallOfFameText(
    resolveHallOfFameProfileField(
      profile,
      ['displayName', 'customName', 'studentName', 'name', 'nickname'],
    ) || wallet?.studentName,
  );
  const studentName = normalizeHallOfFameText(
    resolveHallOfFameProfileField(
      profile,
      ['studentName', 'name', 'displayName', 'nickname', 'customName'],
    ) || wallet?.studentName || displayName,
  );
  const classKey = buildWisHallOfFameClassKey(grade, className);
  const emojiEntry = getProfileEmojiEntryById(
    normalizeHallOfFameText(profile?.profileEmojiId || wallet?.profileEmojiId),
    PROFILE_EMOJI_REGISTRY,
  );
  if (!uid || !grade || !className || !studentName || !classKey) {
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

const sanitizeWisHallOfFameEntryForStorage = (entry) => {
  const sanitized = {
    uid: normalizeHallOfFameText(entry?.uid),
    rank: Math.max(1, Number(entry?.rank || 0)),
    grade: normalizeHallOfFameSchoolValue(entry?.grade),
    class: normalizeHallOfFameSchoolValue(entry?.class),
    classKey: normalizeHallOfFameText(entry?.classKey),
    studentName: normalizeHallOfFameText(entry?.studentName),
    displayName: normalizeHallOfFameText(entry?.displayName || entry?.studentName),
    currentBalance: Math.max(0, Number(entry?.currentBalance || 0)),
    cumulativeEarned: Math.max(0, Number(entry?.cumulativeEarned || 0)),
    profileIcon: normalizeHallOfFameText(entry?.profileIcon) || DEFAULT_HALL_OF_FAME_PROFILE_ICON,
  };
  const profileEmojiId = normalizeHallOfFameText(entry?.profileEmojiId);
  const podiumSlot = Number(entry?.podiumSlot || 0);

  if (profileEmojiId) {
    sanitized.profileEmojiId = profileEmojiId;
  }
  if (podiumSlot === 1 || podiumSlot === 2 || podiumSlot === 3) {
    sanitized.podiumSlot = podiumSlot;
  }

  return sanitized;
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
  .filter((entry) => Number(entry.rank || 0) > 0 && Number(entry.rank || 0) <= 3)
  .map((entry) => ({
    ...sanitizeWisHallOfFameEntryForStorage(entry),
    podiumSlot: Number(entry.rank || 0),
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
    return sanitizeWisHallOfFameEntryForStorage({
      ...entry,
      rank: lastRank,
      podiumSlot: index < 3 ? index + 1 : undefined,
    });
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

const createHallOfFameRefreshError = (stage, message, cause) => {
  const error = new Error(String(message || 'Failed to refresh wis hall of fame snapshot.'));
  error.stage = String(stage || 'unknown').trim() || 'unknown';
  if (cause) {
    error.cause = cause;
  }
  return error;
};

const normalizeHallOfFameRefreshError = (error, fallbackStage = 'unknown') => {
  if (error?.stage) {
    return error;
  }
  return createHallOfFameRefreshError(
    fallbackStage,
    error?.message || 'Failed to refresh wis hall of fame snapshot.',
    error,
  );
};

const runHallOfFameRefreshStage = async (stage, runner, message) => {
  try {
    return await runner();
  } catch (error) {
    throw createHallOfFameRefreshError(
      stage,
      message || error?.message || 'Failed to refresh wis hall of fame snapshot.',
      error,
    );
  }
};

const buildWisHallOfFamePayload = async (year, semester) => {
  const leaderboardPolicy = await runHallOfFameRefreshStage(
    'policy_load',
    () => resolveHallOfFameLeaderboardPolicy(),
    'Failed to read hall of fame leaderboard policy.',
  );
  const walletSnapshot = await runHallOfFameRefreshStage(
    'wallet_read',
    () => db.collection(getPointCollectionPath(year, semester, 'point_wallets')).get(),
    'Failed to read point_wallets for the selected semester.',
  );
  const wallets = walletSnapshot.docs
    .map((docSnapshot) => ({ uid: docSnapshot.id, ...(docSnapshot.data() || {}) }))
    .filter((wallet) => normalizeHallOfFameText(wallet.uid));
  const profileSnapshots = await runHallOfFameRefreshStage(
    'profile_read',
    () => Promise.all(
      wallets.map((wallet) => db.doc(`users/${wallet.uid}`).get().catch(() => null)),
    ),
    'Failed to read student profiles for hall of fame ranking.',
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
    sourceUpdatedAt: FieldValue.serverTimestamp(),
    sourceUpdatedAtMs: updatedAtMs,
  };
};

const refreshWisHallOfFame = async (year, semester, options = {}) => {
  const payload = await buildWisHallOfFamePayload(year, semester);
  await runHallOfFameRefreshStage(
    'snapshot_write',
    () => db.doc(getWisHallOfFamePath(year, semester)).set(payload),
    'Failed to write the public hall of fame snapshot.',
  );
  return {
    ensured: true,
    snapshotKey: payload.snapshotKey,
    snapshotVersion: WIS_HALL_OF_FAME_SNAPSHOT_VERSION,
    source: String(options.source || '').trim() || undefined,
  };
};

const refreshWisHallOfFameOrThrowHttps = async (
  year,
  semester,
  options = {},
) => {
  try {
    return await refreshWisHallOfFame(year, semester, options);
  } catch (error) {
    const failure = normalizeHallOfFameRefreshError(error);
    console.error('Failed to refresh wis hall of fame snapshot:', {
      year,
      semester,
      source: String(options.source || '').trim() || 'unknown',
      stage: failure.stage || 'unknown',
      message: failure.message,
      cause: failure.cause || null,
    });
    throw new HttpsError(
      'internal',
      'Failed to refresh wis hall of fame snapshot.',
      {
        stage: failure.stage || 'unknown',
        detail: String(failure.message || '').trim(),
        source: String(options.source || '').trim() || 'unknown',
        year,
        semester,
      },
    );
  }
};

const markWisHallOfFameDirty = async (year, semester) => {
  const sourceUpdatedAtMs = Date.now();
  await db.doc(getWisHallOfFamePath(year, semester)).set({
    sourceUpdatedAt: FieldValue.serverTimestamp(),
    sourceUpdatedAtMs,
  }, { merge: true });
  return sourceUpdatedAtMs;
};

const hasWisHallOfFameSnapshotRankingData = (data) => Object.keys(data?.gradeTop3ByGrade || {}).length > 0
  || Object.keys(data?.classTop3ByClassKey || {}).length > 0
  || Object.keys(data?.gradeLeaderboardByGrade || {}).length > 0
  || Object.keys(data?.classLeaderboardByClassKey || {}).length > 0;

const hasWisHallOfFameSnapshotLeaderboardData = (data) => Object.keys(data?.gradeLeaderboardByGrade || {}).length > 0
  || Object.keys(data?.classLeaderboardByClassKey || {}).length > 0;

const hasWisHallOfFameSnapshotLeaderboardMeta = (data) => Object.keys(data?.gradeLeaderboardMetaByGrade || {}).length > 0
  || Object.keys(data?.classLeaderboardMetaByClassKey || {}).length > 0;

const hasCompleteHallOfFameLeaderboardEntries = (leaderboardMap, metaMap) => Object.entries(metaMap || {})
  .every(([key, meta]) => {
    const expectedVisibleCount = Math.max(0, Number(meta?.visibleCount || 0));
    const totalCandidates = Math.max(0, Number(meta?.totalCandidates || 0));
    const actualVisibleCount = Array.isArray(leaderboardMap?.[key])
      ? leaderboardMap[key].length
      : 0;
    if (expectedVisibleCount > 0 && actualVisibleCount < expectedVisibleCount) {
      return false;
    }
    if (totalCandidates > 3 && actualVisibleCount <= 3) {
      return false;
    }
    return true;
  });

const hasCompleteHallOfFameLeaderboardScopes = (podiumMap, leaderboardMap, metaMap) => {
  const scopeKeys = new Set([
    ...Object.keys(podiumMap || {}),
    ...Object.keys(leaderboardMap || {}),
    ...Object.keys(metaMap || {}),
  ]);

  return Array.from(scopeKeys).every((key) => {
    const podiumEntries = podiumMap?.[key] || [];
    const leaderboardEntries = leaderboardMap?.[key] || [];
    const scopeMeta = metaMap?.[key] || null;
    const hasPodiumEntries = podiumEntries.length > 0;
    const hasLeaderboardEntries = leaderboardEntries.length > 0;

    if ((hasPodiumEntries || hasLeaderboardEntries) && !scopeMeta) {
      return false;
    }
    if (hasPodiumEntries && !hasLeaderboardEntries) {
      return false;
    }
    if (!scopeMeta) {
      return true;
    }
    return leaderboardEntries.length >= Math.max(0, Number(scopeMeta.visibleCount || 0));
  });
};

const isWisHallOfFameSnapshotStale = (data) => {
  if (!data) return true;
  if (Number(data.snapshotVersion || 0) !== WIS_HALL_OF_FAME_SNAPSHOT_VERSION) {
    return true;
  }
  if (
    hasWisHallOfFameSnapshotRankingData(data)
    && (
      !hasWisHallOfFameSnapshotLeaderboardData(data)
      || !hasWisHallOfFameSnapshotLeaderboardMeta(data)
      || !hasCompleteHallOfFameLeaderboardEntries(
        data?.gradeLeaderboardByGrade,
        data?.gradeLeaderboardMetaByGrade,
      )
      || !hasCompleteHallOfFameLeaderboardEntries(
        data?.classLeaderboardByClassKey,
        data?.classLeaderboardMetaByClassKey,
      )
      || !hasCompleteHallOfFameLeaderboardScopes(
        data?.gradeTop3ByGrade,
        data?.gradeLeaderboardByGrade,
        data?.gradeLeaderboardMetaByGrade,
      )
      || !hasCompleteHallOfFameLeaderboardScopes(
        data?.classTop3ByClassKey,
        data?.classLeaderboardByClassKey,
        data?.classLeaderboardMetaByClassKey,
      )
    )
  ) {
    return true;
  }
  const updatedAtMs = Number(data.updatedAtMs || 0) > 0
    ? Number(data.updatedAtMs || 0)
    : typeof data.updatedAt?.toMillis === 'function'
      ? data.updatedAt.toMillis()
      : Number(data.updatedAt?.seconds || 0) * 1000;
  if (!updatedAtMs) return true;
  const sourceUpdatedAtMs = Number(data.sourceUpdatedAtMs || 0) > 0
    ? Number(data.sourceUpdatedAtMs || 0)
    : typeof data.sourceUpdatedAt?.toMillis === 'function'
      ? data.sourceUpdatedAt.toMillis()
      : Number(data.sourceUpdatedAt?.seconds || 0) * 1000;
  if (sourceUpdatedAtMs > updatedAtMs) return true;
  return Date.now() - updatedAtMs > WIS_HALL_OF_FAME_STALE_MS;
};

const markWisHallOfFameDirtySafely = async (year, semester) => {
  try {
    await markWisHallOfFameDirty(year, semester);
  } catch (error) {
    console.error('Failed to mark wis hall of fame snapshot dirty:', error);
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

const getCurrentConfiguredYearSemester = async () => {
  const configSnap = await db.doc('site_settings/config').get();
  if (!configSnap.exists) return null;
  const data = configSnap.data() || {};
  const year = String(data.year || '').trim();
  const semester = String(data.semester || '').trim();
  if (!year || !semester) return null;
  return { year, semester };
};

const getOptionalYearSemester = (data) => {
  const year = String(data?.year || '').trim();
  const semester = String(data?.semester || '').trim();
  if (!year || !semester) return null;
  return { year, semester };
};

const resolveHallOfFameTargetYearSemester = async (data, options = {}) => {
  const providedYearSemester = getOptionalYearSemester(data);
  const preferConfiguredCurrent = options.preferConfiguredCurrent === true;
  const configuredYearSemester = (preferConfiguredCurrent || !providedYearSemester)
    ? await getCurrentConfiguredYearSemester()
    : null;

  if (preferConfiguredCurrent && configuredYearSemester) {
    if (
      providedYearSemester
      && (
        providedYearSemester.year !== configuredYearSemester.year
        || providedYearSemester.semester !== configuredYearSemester.semester
      )
    ) {
      console.warn('Hall of fame refresh request semester differed from current configured semester. Using configured semester instead.', {
        requested: providedYearSemester,
        configured: configuredYearSemester,
        source: String(options.source || '').trim() || 'unknown',
      });
    }
    return configuredYearSemester;
  }

  if (providedYearSemester) {
    return providedYearSemester;
  }

  if (configuredYearSemester) {
    return configuredYearSemester;
  }

  if (options.allowMissing === true) {
    return null;
  }

  throw new HttpsError(
    'failed-precondition',
    'Current year/semester is not configured.',
    { stage: 'current_semester' },
  );
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

const assertHallOfFameManager = async (request) => {
  const { uid, email } = assertAllowedWestoryUser(request);
  if (email === ADMIN_EMAIL) {
    return { uid, email, profile: null };
  }

  const { profile } = await getUserProfile(uid);
  if (profile?.role !== 'teacher' && !hasStaffPermission(profile, 'point_manage')) {
    throw new HttpsError(
      'permission-denied',
      'teacher, admin, or point_manage permission is required.',
    );
  }
  return { uid, email, profile };
};

const normalizeSchoolToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw;
};

const buildQuizClassId = (grade, className) => {
  const normalizedGrade = normalizeSchoolToken(grade);
  const normalizedClass = normalizeSchoolToken(className);
  if (!normalizedGrade || !normalizedClass) return '';
  return `${normalizedGrade}-${normalizedClass}`;
};

const assertQuizManager = async (request) => {
  const { uid, email } = assertAllowedWestoryUser(request);
  if (email === ADMIN_EMAIL) {
    return { uid, email, profile: null };
  }

  const { profile } = await getUserProfile(uid);
  if (String(profile?.role || '').trim() !== 'teacher') {
    throw new HttpsError(
      'permission-denied',
      'teacher or admin permission is required.',
    );
  }
  return { uid, email, profile };
};

const assertNotificationManager = async (request) => {
  const { uid, email } = assertAllowedWestoryUser(request);
  if (email === ADMIN_EMAIL) {
    return { uid, email, profile: null };
  }

  const { profile } = await getUserProfile(uid);
  if (
    String(profile?.role || '').trim() !== 'teacher'
    && !hasStaffPermission(profile, 'lesson_read')
    && !hasStaffPermission(profile, 'quiz_read')
    && !hasStaffPermission(profile, 'point_manage')
  ) {
    throw new HttpsError(
      'permission-denied',
      'teacher or staff permission is required.',
    );
  }
  return { uid, email, profile };
};

const uniqueNonEmptyStrings = (values, maxCount = 200) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
)).slice(0, maxCount);

const runInChunks = async (items, chunkSize, handler) => {
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    await Promise.all(chunk.map(handler));
  }
};

const createUserNotificationWithPreparedInput = async (year, semester, recipientUid, input) => {
  const uid = String(recipientUid || '').trim();
  if (!uid) return { created: false, recipientUid: uid };

  const type = input.type;
  const entityType = sanitizeNotificationText(input.entityType, 80);
  const entityId = sanitizeNotificationText(input.entityId, 160);
  const dedupeKey = sanitizeNotificationText(
    input.dedupeKey || `${type}:${entityType}:${entityId}:${uid}:${input.title}`,
    240,
  );
  const notificationId = buildNotificationId(dedupeKey);
  const inboxRef = db.doc(getNotificationInboxPath(year, semester, uid));
  const itemRef = db.doc(`${getNotificationItemsPath(year, semester, uid)}/${notificationId}`);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(itemRef);
    if (existing.exists) {
      return { created: false, recipientUid: uid, notificationId };
    }

    const payload = {
      type,
      title: sanitizeNotificationText(input.title, 80, '알림'),
      body: sanitizeNotificationText(input.body, 500),
      targetUrl: sanitizeNotificationText(input.targetUrl, 240),
      entityType,
      entityId,
      actorUid: sanitizeNotificationText(input.actorUid, 160),
      recipientUid: uid,
      priority: input.priority === 'high' ? 'high' : 'normal',
      dedupeKey,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: getNotificationExpiryTimestamp(),
    };

    transaction.set(inboxRef, {
      uid,
      unreadCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(itemRef, payload);
    return { created: true, recipientUid: uid, notificationId };
  });
};

const createUserNotification = async (year, semester, recipientUid, input) => {
  const preparedInput = await prepareNotificationInput(year, semester, input);
  if (preparedInput.skipped) {
    return {
      created: false,
      skipped: true,
      recipientUid: String(recipientUid || '').trim(),
      reason: preparedInput.reason,
    };
  }
  return createUserNotificationWithPreparedInput(year, semester, recipientUid, preparedInput);
};

const createBroadcastNotification = async (year, semester, input) => {
  const preparedInput = await prepareNotificationInput(year, semester, input, 'students');
  if (preparedInput.skipped) {
    return { created: false, skipped: true, reason: preparedInput.reason };
  }

  const type = preparedInput.type;
  const entityType = sanitizeNotificationText(input.entityType, 80);
  const entityId = sanitizeNotificationText(input.entityId, 160);
  const dedupeKey = sanitizeNotificationText(
    preparedInput.dedupeKey || `${type}:${entityType}:${entityId}:${preparedInput.title}`,
    240,
  );
  const notificationId = buildNotificationId(`broadcast:${dedupeKey}`);
  const itemRef = db.doc(`${getBroadcastNotificationsPath(year, semester)}/${notificationId}`);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(itemRef);
    if (existing.exists) {
      return { created: false, notificationId };
    }

    transaction.set(itemRef, {
      type,
      title: sanitizeNotificationText(preparedInput.title, 80, '알림'),
      body: sanitizeNotificationText(preparedInput.body, 500),
      targetUrl: sanitizeNotificationText(preparedInput.targetUrl, 240),
      entityType,
      entityId,
      actorUid: sanitizeNotificationText(preparedInput.actorUid, 160),
      recipientUid: '',
      audience: 'all_students',
      priority: preparedInput.priority === 'high' ? 'high' : 'normal',
      dedupeKey,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: getNotificationExpiryTimestamp(),
    });
    return { created: true, notificationId };
  });
};

const createUserNotifications = async (year, semester, recipientUids, input) => {
  const targets = uniqueNonEmptyStrings(recipientUids, 500);
  const preparedInput = await prepareNotificationInput(year, semester, input);
  if (preparedInput.skipped) {
    return targets.map((recipientUid) => ({
      created: false,
      skipped: true,
      recipientUid,
      reason: preparedInput.reason,
    }));
  }
  const results = [];
  await runInChunks(targets, 20, async (recipientUid) => {
    results.push(await createUserNotificationWithPreparedInput(year, semester, recipientUid, preparedInput));
  });
  return results;
};

const getAdminRecipientUids = async () => {
  const snap = await db.collection('users').where('email', '==', ADMIN_EMAIL).get();
  return snap.docs.map((docSnap) => docSnap.id);
};

const resolvePointManagerRecipientUids = async () => {
  const [adminUids, managerSnap] = await Promise.all([
    getAdminRecipientUids(),
    db.collection('users').where('staffPermissions', 'array-contains', 'point_manage').get(),
  ]);
  return uniqueNonEmptyStrings([
    ...adminUids,
    ...managerSnap.docs.map((docSnap) => docSnap.id),
  ]);
};

const resolveTeacherNotificationRecipientUids = async () => {
  const [adminUids, teacherSnap, quizStaffSnap] = await Promise.all([
    getAdminRecipientUids(),
    db.collection('users').where('role', '==', 'teacher').get(),
    db.collection('users').where('staffPermissions', 'array-contains', 'quiz_read').get(),
  ]);
  return uniqueNonEmptyStrings([
    ...adminUids,
    ...teacherSnap.docs.map((docSnap) => docSnap.id),
    ...quizStaffSnap.docs.map((docSnap) => docSnap.id),
  ]);
};

const createHistoryClassroomPassedNotifications = async (year, semester, input) => {
  const resultId = sanitizeNotificationText(input.resultId, 160);
  if (!resultId) return [];

  const studentName = sanitizeNotificationText(input.studentName, 40, '학생');
  const assignmentTitle = sanitizeNotificationText(
    input.assignmentTitle,
    80,
    '역사교실',
  );
  const percent = Math.max(0, Math.min(100, Number(input.percent || 0)));
  const recipients = await resolveTeacherNotificationRecipientUids();

  return createUserNotifications(year, semester, recipients, {
    type: 'history_classroom_passed',
    title: '역사교실 통과 알림',
    body: `${studentName} 학생이 ${assignmentTitle}을(를) ${percent}%로 통과했습니다.`,
    targetUrl: '/teacher/quiz/history-classroom',
    entityType: 'history_classroom_result',
    entityId: resultId,
    actorUid: input.actorUid,
    priority: 'normal',
    dedupeKey: `history_classroom_passed:${year}:${semester}:${resultId}`,
    templateValues: {
      studentName,
      assignmentTitle,
      percent,
    },
  });
};

const loadHistoryClassroomResultForNotification = async (year, semester, resultId) => {
  const safeResultId = sanitizeNotificationText(resultId, 160);
  if (!safeResultId) return null;

  const semesterSnap = await db
    .doc(`${getSemesterRoot(year, semester)}/history_classroom_results/${safeResultId}`)
    .get();
  if (semesterSnap.exists) {
    return {
      id: semesterSnap.id,
      data: semesterSnap.data() || {},
      collectionPath: `${getSemesterRoot(year, semester)}/history_classroom_results`,
    };
  }

  const legacySnap = await db.doc(`history_classroom_results/${safeResultId}`).get();
  if (legacySnap.exists) {
    return {
      id: legacySnap.id,
      data: legacySnap.data() || {},
      collectionPath: 'history_classroom_results',
    };
  }

  return null;
};

const resolveHistoryDictionaryManagerRecipientUids = async () => {
  const [adminUids, teacherSnap, lessonStaffSnap] = await Promise.all([
    getAdminRecipientUids(),
    db.collection('users').where('role', '==', 'teacher').get(),
    db.collection('users').where('staffPermissions', 'array-contains', 'lesson_read').get(),
  ]);
  return uniqueNonEmptyStrings([
    ...adminUids,
    ...teacherSnap.docs.map((docSnap) => docSnap.id),
    ...lessonStaffSnap.docs.map((docSnap) => docSnap.id),
  ]);
};

const assertHistoryDictionaryManager = async (request) => {
  const { uid, email } = assertAllowedWestoryUser(request);
  if (email === ADMIN_EMAIL) {
    return { uid, email, profile: null };
  }

  const { profile } = await getUserProfile(uid);
  if (String(profile?.role || '').trim() !== 'teacher' && !hasStaffPermission(profile, 'lesson_read')) {
    throw new HttpsError(
      'permission-denied',
      'teacher or lesson_read permission is required.',
    );
  }
  return { uid, email, profile };
};

const ensureStudentProfile = async (uid) => {
  const { ref, profile } = await getUserProfile(uid);
  return { ref, profile };
};

const isQuizStudentProfile = (profile = {}) => {
  const role = String(profile.role || '').trim();
  return role === 'student';
};

const getQuizAttemptClassCandidates = (attempt = {}) => {
  const candidates = new Set();
  const gradeValue = normalizeSchoolToken(attempt.studentGrade || attempt.grade);
  const classValue = normalizeSchoolToken(attempt.studentClass || attempt.class);
  const explicitClassId = buildQuizClassId(gradeValue, classValue);
  if (explicitClassId) {
    candidates.add(explicitClassId);
  }

  const gradeClassDigits = String(attempt.gradeClass || '').match(/\d+/g) || [];
  const gradeClassId = buildQuizClassId(gradeClassDigits[0], gradeClassDigits[1]);
  if (gradeClassId) {
    candidates.add(gradeClassId);
  }

  return candidates;
};

const quizAttemptMatchesClass = (attempt = {}, normalizedClassId) => {
  if (!normalizedClassId) return false;
  const candidates = getQuizAttemptClassCandidates(attempt);
  if (candidates.has(normalizedClassId)) return true;

  const [targetGrade, targetClass] = normalizedClassId.split('-');
  const classValue = normalizeSchoolToken(attempt.studentClass || attempt.class);
  const gradeClassLabel = String(attempt.gradeClass || '').trim();
  if (!targetGrade || !targetClass || !classValue || classValue !== targetClass || !gradeClassLabel) {
    return false;
  }

  const gradeClassDigits = gradeClassLabel.match(/\d+/g) || [];
  if (normalizeSchoolToken(gradeClassDigits[0]) === targetGrade) {
    return true;
  }
  if (/^\d+$/.test(targetGrade) || /^\d+$/.test(targetClass)) {
    return false;
  }

  return gradeClassLabel.includes(targetGrade) && gradeClassLabel.includes(targetClass);
};

const shouldCountTowardsEarnedTotal = (pointTransaction = {}) => {
  const type = String(pointTransaction.type || '').trim();
  const delta = Number(pointTransaction.delta || 0);
  if (type === 'history_dictionary' && pointTransaction.reclaimed === true) {
    return false;
  }
  if (delta <= 0) return false;
  if (type === 'manual_adjust') return true;
  if (type === 'manual_reclaim') return false;
  if (type.startsWith('purchase_')) return false;
  return true;
};

const calculatePointWalletTotals = (transactionDocs) => {
  const safeTransactionDocs = Array.isArray(transactionDocs) ? transactionDocs : [];
  const sortedDocs = sortPointTransactionDocsDesc(safeTransactionDocs);
  const balance = safeTransactionDocs.reduce(
    (total, docSnap) => total + Number(docSnap.data()?.delta || 0),
    0,
  );
  const earnedTotal = safeTransactionDocs.reduce((total, docSnap) => {
    const pointTransaction = docSnap.data() || {};
    return shouldCountTowardsEarnedTotal(pointTransaction)
      ? total + Number(pointTransaction.delta || 0)
      : total;
  }, 0);
  const spentTotal = safeTransactionDocs.reduce((total, docSnap) => {
    const pointTransaction = docSnap.data() || {};
    const type = String(pointTransaction.type || '').trim();
    if (type !== 'purchase_hold' && type !== 'purchase_cancel') {
      return total;
    }
    return total - Number(pointTransaction.delta || 0);
  }, 0);
  const adjustedTotal = safeTransactionDocs.reduce((total, docSnap) => {
    const pointTransaction = docSnap.data() || {};
    const type = String(pointTransaction.type || '').trim();
    if (type !== 'manual_adjust' && type !== 'manual_reclaim') {
      return total;
    }
    return total + Number(pointTransaction.delta || 0);
  }, 0);

  return {
    balance,
    earnedTotal,
    spentTotal: Math.max(0, spentTotal),
    adjustedTotal,
    lastTransactionAt: sortedDocs[0]?.data()?.createdAt || null,
  };
};

const buildQuizResetWalletSnapshot = ({ uid, profile, transactionDocs, rankPolicy }) => {
  const totals = calculatePointWalletTotals(transactionDocs);

  return {
    ...buildWalletBase(uid, profile),
    balance: totals.balance,
    earnedTotal: totals.earnedTotal,
    ...buildWalletRankState(totals.earnedTotal, rankPolicy),
    spentTotal: totals.spentTotal,
    adjustedTotal: totals.adjustedTotal,
    lastTransactionAt: totals.lastTransactionAt,
  };
};

const walletRankFieldsNeedRebuild = (wallet, rankEarnedTotal, rankPolicy) => {
  const safeRankEarnedTotal = Math.max(0, Number(rankEarnedTotal || 0));
  const nextRankSnapshot = buildRankSnapshot(safeRankEarnedTotal, rankPolicy);
  const currentRankSnapshot = wallet?.rankSnapshot || {};
  return Number(wallet?.earnedTotal) !== safeRankEarnedTotal
    || Number(wallet?.rankEarnedTotal) !== safeRankEarnedTotal
    || String(currentRankSnapshot.tierCode || '') !== String(nextRankSnapshot.tierCode || '')
    || Number(currentRankSnapshot.metricValue) !== safeRankEarnedTotal
    || String(currentRankSnapshot.basedOn || '') !== String(nextRankSnapshot.basedOn || '');
};

const commitPointWalletBackfillWrites = async (writes) => {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach(({ ref, payload }) => {
      batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
  }
};

const buildPointWalletRankBackfillPlan = async ({ year, semester, rankPolicy }) => {
  const [walletSnapshot, transactionSnapshot] = await Promise.all([
    db.collection(getPointCollectionPath(year, semester, 'point_wallets')).get(),
    db.collection(getPointCollectionPath(year, semester, 'point_transactions')).get(),
  ]);
  const walletsByUid = new Map();
  const transactionDocsByUid = new Map();
  const uidSet = new Set();

  walletSnapshot.docs.forEach((docSnap) => {
    const wallet = docSnap.data() || {};
    const uid = String(wallet.uid || docSnap.id || '').trim();
    if (!uid) return;
    walletsByUid.set(uid, { ref: docSnap.ref, wallet });
    uidSet.add(uid);
  });

  transactionSnapshot.docs.forEach((docSnap) => {
    const transaction = docSnap.data() || {};
    const uid = String(transaction.uid || '').trim();
    if (!uid) return;
    if (!transactionDocsByUid.has(uid)) {
      transactionDocsByUid.set(uid, []);
    }
    transactionDocsByUid.get(uid).push(docSnap);
    uidSet.add(uid);
  });

  const writes = [];
  let skippedMissingProfileCount = 0;

  for (const uid of uidSet) {
    const transactionDocs = transactionDocsByUid.get(uid) || [];
    const totals = calculatePointWalletTotals(transactionDocs);
    const existingWallet = walletsByUid.get(uid);
    const rankEarnedTotal = Math.max(0, Number(
      transactionDocs.length > 0
        ? totals.earnedTotal
        : existingWallet?.wallet?.rankEarnedTotal ?? existingWallet?.wallet?.earnedTotal ?? 0,
    ));

    if (existingWallet) {
      if (!walletRankFieldsNeedRebuild(existingWallet.wallet, rankEarnedTotal, rankPolicy)) {
        continue;
      }
      writes.push({
        ref: existingWallet.ref,
        payload: {
          earnedTotal: rankEarnedTotal,
          ...buildWalletRankState(rankEarnedTotal, rankPolicy),
        },
        create: false,
      });
      continue;
    }

    if (!transactionDocs.length) {
      continue;
    }

    let profile = {};
    try {
      ({ profile } = await ensureStudentProfile(uid));
    } catch (error) {
      skippedMissingProfileCount += 1;
      console.warn('Skipping point wallet rank backfill for uid without profile.', {
        uid,
        errorMessage: String(error?.message || 'profile-missing'),
      });
      continue;
    }

    writes.push({
      ref: db.doc(getPointWalletPath(year, semester, uid)),
      payload: {
        ...buildWalletBase(uid, profile),
        balance: totals.balance,
        earnedTotal: rankEarnedTotal,
        ...buildWalletRankState(rankEarnedTotal, rankPolicy),
        spentTotal: totals.spentTotal,
        adjustedTotal: totals.adjustedTotal,
        lastTransactionAt: totals.lastTransactionAt,
      },
      create: true,
    });
  }

  return {
    writes,
    scannedWalletCount: walletSnapshot.size,
    scannedTransactionCount: transactionSnapshot.size,
    processedUidCount: uidSet.size,
    skippedMissingProfileCount,
    createdWalletCount: writes.filter((write) => write.create).length,
    updatedWalletCount: writes.filter((write) => !write.create).length,
  };
};

const rebuildQuizResetWallet = async ({ year, semester, uid, rankPolicy }) => {
  let profile = {};
  try {
    ({ profile } = await ensureStudentProfile(uid));
  } catch (error) {
    console.warn('Rebuilding quiz reset wallet without an active user profile.', {
      uid,
      errorMessage: String(error?.message || 'profile-missing'),
    });
  }
  const pointTransactionsSnapshot = await db
    .collection(getPointCollectionPath(year, semester, 'point_transactions'))
    .where('uid', '==', uid)
    .get();

  const nextWallet = buildQuizResetWalletSnapshot({
    uid,
    profile,
    transactionDocs: pointTransactionsSnapshot.docs,
    rankPolicy,
  });

  await db.doc(getPointWalletPath(year, semester, uid)).set(nextWallet, { merge: true });
  return nextWallet;
};

const commitDeleteRefsInChunks = async (refs) => {
  const uniqueRefs = Array.from(
    new Map(
      refs
        .filter(Boolean)
        .map((ref) => [ref.path, ref]),
    ).values(),
  );
  for (let index = 0; index < uniqueRefs.length; index += 400) {
    const batch = db.batch();
    uniqueRefs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return uniqueRefs.length;
};

const collectMatchingQuizAttemptDocsByClass = async ({
  collectionRef,
  unitId,
  category,
  className,
  normalizedClassId,
}) => {
  const snapshots = await Promise.all(
    ['class', 'studentClass'].map((classField) =>
      collectionRef
        .where(classField, '==', className)
        .get()
        .catch((error) => {
          console.warn('Failed to query quiz attempts by class field.', {
            collectionPath: collectionRef.path,
            classField,
            className,
            errorMessage: String(error?.message || 'query-failed'),
          });
          return null;
        }),
    ),
  );
  const docsByPath = new Map();
  snapshots.forEach((snapshot) => {
    snapshot?.forEach((docSnap) => {
      docsByPath.set(docSnap.ref.path, docSnap);
    });
  });

  return Array.from(docsByPath.values()).filter((docSnap) => {
    const data = docSnap.data() || {};
    return (
      String(data.unitId || '').trim() === unitId
      && String(data.category || '').trim() === category
      && quizAttemptMatchesClass(data, normalizedClassId)
    );
  });
};

const filterExistingRefs = async (refs) => {
  const uniqueRefs = Array.from(
    new Map(
      refs
        .filter(Boolean)
        .map((ref) => [ref.path, ref]),
    ).values(),
  );
  const existingRefs = [];
  for (let index = 0; index < uniqueRefs.length; index += 100) {
    const snapshotBatch = await Promise.all(
      uniqueRefs.slice(index, index + 100).map((ref) => ref.get().catch(() => null)),
    );
    snapshotBatch.forEach((snapshot, snapshotIndex) => {
      if (!snapshot?.exists) return;
      existingRefs.push(uniqueRefs[index + snapshotIndex]);
    });
  }
  return existingRefs;
};

const resetAssessmentAttemptsByClassHandler = onCall(
  { region: REGION, timeoutSeconds: 180 },
  async (request) => {
    const { uid, email } = await assertQuizManager(request);
    const { year, semester } = assertYearSemester(request.data || {});
    const unitId = String(request.data?.unitId || '').trim();
    const category = String(request.data?.category || '').trim();
    const classId = String(request.data?.classId || '').trim();

    if (!unitId || !category || !classId) {
      throw new HttpsError(
        'invalid-argument',
        'unitId, category, and classId are required.',
      );
    }

    const [grade, className] = classId
      .split('-')
      .map((value) => normalizeSchoolToken(value));
    const normalizedClassId = buildQuizClassId(grade, className);
    if (!normalizedClassId) {
      throw new HttpsError(
        'invalid-argument',
        'classId must follow the {grade}-{class} format.',
      );
    }

    const semesterRoot = getSemesterRoot(year, semester);
    const auditRef = db.collection(`${semesterRoot}/quiz_reset_audits`).doc();
    await auditRef.set({
      actorUid: uid,
      actorEmail: email,
      unitId,
      category,
      requestedClassId: classId,
      resolvedClassId: normalizedClassId,
      status: 'started',
      startedAt: FieldValue.serverTimestamp(),
    });

    try {
      const userQueryCombos = [
        ['studentGrade', 'studentClass'],
        ['studentGrade', 'class'],
        ['grade', 'studentClass'],
        ['grade', 'class'],
      ];
      const userSnapshots = await Promise.all(
        userQueryCombos.map(([gradeField, classField]) =>
          db
            .collection('users')
            .where(gradeField, '==', grade)
            .where(classField, '==', className)
            .get()
            .catch(() => null),
        ),
      );

      const studentUids = new Set();
      userSnapshots.forEach((snapshot) => {
        snapshot?.forEach((docSnap) => {
          const profile = docSnap.data() || {};
          if (!isQuizStudentProfile(profile)) return;
          const profileClassId = buildQuizClassId(
            profile.studentGrade || profile.grade,
            profile.studentClass || profile.class,
          );
          if (profileClassId === normalizedClassId) {
            studentUids.add(docSnap.id);
          }
        });
      });

      const quizResultsCollection = db.collection(`${semesterRoot}/quiz_results`);
      const quizSubmissionsCollection = db.collection(`${semesterRoot}/quiz_submissions`);
      const resultRefs = [];
      const submissionRefs = [];
      const pointTransactionRefs = [];
      const affectedStudentUids = new Set();

      const [classResultDocs, classSubmissionDocs] = await Promise.all([
        collectMatchingQuizAttemptDocsByClass({
          collectionRef: quizResultsCollection,
          unitId,
          category,
          className,
          normalizedClassId,
        }),
        collectMatchingQuizAttemptDocsByClass({
          collectionRef: quizSubmissionsCollection,
          unitId,
          category,
          className,
          normalizedClassId,
        }),
      ]);

      for (const studentUid of studentUids) {
        const [resultSnap, submissionSnap] = await Promise.all([
          quizResultsCollection.where('uid', '==', studentUid).get(),
          quizSubmissionsCollection.where('uid', '==', studentUid).get().catch(() => null),
        ]);

        resultSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          if (
            String(data.uid || '').trim() !== studentUid
            || String(data.unitId || '').trim() !== unitId
            || String(data.category || '').trim() !== category
          ) {
            return;
          }
          resultRefs.push(docSnap.ref);
          affectedStudentUids.add(studentUid);

          const sourceId = `quiz-result-${docSnap.id}`;
          pointTransactionRefs.push(
            db.doc(
              `${getPointCollectionPath(year, semester, 'point_transactions')}/${buildActivityTransactionId(studentUid, 'quiz', sourceId)}`,
            ),
          );
          pointTransactionRefs.push(
            db.doc(
              `${getPointCollectionPath(year, semester, 'point_transactions')}/${buildActivityTransactionId(studentUid, 'quiz_bonus', sourceId)}`,
            ),
          );
        });

        submissionSnap?.forEach((docSnap) => {
          const data = docSnap.data() || {};
          if (
            String(data.uid || '').trim() !== studentUid
            || String(data.unitId || '').trim() !== unitId
            || String(data.category || '').trim() !== category
          ) {
            return;
          }
          submissionRefs.push(docSnap.ref);
          affectedStudentUids.add(studentUid);
        });
      }

      classResultDocs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = String(data.uid || '').trim();
        if (!studentUid) return;
        resultRefs.push(docSnap.ref);
        affectedStudentUids.add(studentUid);

        const sourceId = `quiz-result-${docSnap.id}`;
        pointTransactionRefs.push(
          db.doc(
            `${getPointCollectionPath(year, semester, 'point_transactions')}/${buildActivityTransactionId(studentUid, 'quiz', sourceId)}`,
          ),
        );
        pointTransactionRefs.push(
          db.doc(
            `${getPointCollectionPath(year, semester, 'point_transactions')}/${buildActivityTransactionId(studentUid, 'quiz_bonus', sourceId)}`,
          ),
        );
      });

      classSubmissionDocs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = String(data.uid || '').trim();
        if (!studentUid) return;
        submissionRefs.push(docSnap.ref);
        affectedStudentUids.add(studentUid);
      });

      const deletedQuizResultCount = await commitDeleteRefsInChunks(resultRefs);
      const deletedSubmissionCount = await commitDeleteRefsInChunks(submissionRefs);
      const existingPointTransactionRefs = await filterExistingRefs(pointTransactionRefs);
      const deletedPointTransactionCount = await commitDeleteRefsInChunks(existingPointTransactionRefs);

      const affectedStudentList = Array.from(affectedStudentUids);
      const pointPolicy = await db.runTransaction((transaction) =>
        loadPolicy(transaction, year, semester),
      );
      const walletRebuildErrors = [];
      for (const studentUid of affectedStudentList) {
        try {
          await rebuildQuizResetWallet({
            year,
            semester,
            uid: studentUid,
            rankPolicy: pointPolicy.rankPolicy,
          });
        } catch (error) {
          walletRebuildErrors.push({
            uid: studentUid,
            errorMessage: String(error?.message || 'wallet-rebuild-failed').slice(0, 160),
          });
          console.error('Failed to rebuild wallet after quiz reset.', {
            uid: studentUid,
            year,
            semester,
            error,
          });
        }
      }
      const recalculatedWalletCount = affectedStudentList.length - walletRebuildErrors.length;

      if (deletedPointTransactionCount > 0) {
        await markWisHallOfFameDirtySafely(year, semester);
      }

      await auditRef.set(
        {
          status: 'completed',
          targetStudentCount: studentUids.size,
          affectedStudentCount: affectedStudentList.length,
          deletedQuizResultCount,
          deletedSubmissionCount,
          deletedPointTransactionCount,
          recalculatedWalletCount,
          walletRebuildErrorCount: walletRebuildErrors.length,
          walletRebuildErrors: walletRebuildErrors.slice(0, 20),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      console.info('Assessment attempts reset for class.', {
        actorUid: uid,
        year,
        semester,
        unitId,
        category,
        classId: normalizedClassId,
        targetStudentCount: studentUids.size,
        affectedStudentCount: affectedStudentList.length,
        deletedQuizResultCount,
        deletedSubmissionCount,
        deletedPointTransactionCount,
        recalculatedWalletCount,
        walletRebuildErrorCount: walletRebuildErrors.length,
      });

      return {
        classId: normalizedClassId,
        targetStudentCount: studentUids.size,
        affectedStudentCount: affectedStudentList.length,
        deletedQuizResultCount,
        deletedSubmissionCount,
        deletedPointTransactionCount,
        recalculatedWalletCount,
        walletRebuildErrorCount: walletRebuildErrors.length,
      };
    } catch (error) {
      await auditRef.set(
        {
          status: 'failed',
          errorMessage: String(error?.message || 'reset-failed').slice(0, 240),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ).catch(() => undefined);
      throw error;
    }
  },
);

exports.resetAssessmentAttemptsByClass = resetAssessmentAttemptsByClassHandler;
exports.resetQuizAttemptsForClass = resetAssessmentAttemptsByClassHandler;

const buildWalletBase = (uid, profile) => ({
  uid,
  studentName: String(
    profile.studentName
    || profile.name
    || profile.displayName
    || profile.customName
    || profile.nickname
    || '',
  ).trim(),
  grade: String(profile.studentGrade || profile.grade || '').trim(),
  class: String(profile.studentClass || profile.class || '').trim(),
  number: String(profile.studentNumber || profile.number || '').trim(),
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
    let historyResultSnap = await transaction.get(historyResultRef);
    if (!historyResultSnap.exists) {
      const legacyHistoryResultRef = db.doc(`history_classroom_results/${historyResultId}`);
      historyResultSnap = await transaction.get(legacyHistoryResultRef);
    }
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

const normalizeQuizCorrectionAnswer = (value) => String(value ?? '')
  .replace(/\s+/g, '')
  .trim();

const quizDetailMatchesQuestion = (detail, questionDocId, questionId) => {
  const detailQuestionId = String(detail?.id ?? detail?.qid ?? '').trim();
  if (!detailQuestionId) return false;
  return detailQuestionId === questionDocId || detailQuestionId === questionId;
};

const commitQuizCorrectionWrites = async (writes) => {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach(({ ref, payload }) => {
      batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
  }
};

const awardQuizCorrectionBonus = async ({ year, semester, uid, resultId, score }) => {
  const sourceId = `quiz-result-${resultId}`;
  let profile = {};
  try {
    ({ profile } = await ensureStudentProfile(uid));
  } catch (error) {
    console.warn('Awarding quiz correction bonus without an active user profile.', {
      uid,
      resultId,
      errorMessage: String(error?.message || 'profile-missing'),
    });
  }

  return db.runTransaction(async (transaction) => {
    const policy = await loadPolicy(transaction, year, semester);
    if (
      !policy.quizBonusEnabled
      || Number(policy.quizBonusAmount || 0) <= 0
      || Number(score || 0) < Number(policy.quizBonusThreshold || 100)
    ) {
      return { awarded: false, amount: 0, duplicate: false };
    }

    const transactionId = buildActivityTransactionId(uid, 'quiz_bonus', sourceId);
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
    const existingTx = await transaction.get(txRef);
    if (existingTx.exists) {
      return { awarded: false, amount: 0, duplicate: true, transactionId };
    }

    const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
    const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
    const amount = Number(policy.quizBonusAmount || 0);
    const nextBalance = Number(wallet.balance || 0) + amount;
    const nextEarnedTotal = Number(wallet.earnedTotal || 0) + amount;
    const nextRankEarnedTotal = currentRankEarnedTotal + amount;

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
      type: 'quiz_bonus',
      delta: amount,
      balanceAfter: nextBalance,
      sourceId,
      sourceLabel: 'Quiz correction bonus',
      policyId: 'current',
      createdBy: 'system:quiz-correction',
    }));

    return { awarded: true, amount, duplicate: false, transactionId };
  });
};

exports.recalculateQuizResultsAfterQuestionCorrection = onCall(
  { region: REGION, timeoutSeconds: 180, memory: '512MiB' },
  async (request) => {
    const { uid } = await assertQuizManager(request);
    const { year, semester } = assertYearSemester(request.data || {});
    const questionDocId = String(request.data?.questionDocId || '').trim();
    const questionId = String(request.data?.questionId || '').trim();

    if (!questionDocId && !questionId) {
      throw new HttpsError(
        'invalid-argument',
        'questionDocId or questionId is required.',
      );
    }

    const questionRef = questionDocId
      ? db.doc(`${getSemesterRoot(year, semester)}/quiz_questions/${questionDocId}`)
      : null;
    const questionSnap = questionRef ? await questionRef.get() : null;
    if (questionRef && !questionSnap.exists) {
      throw new HttpsError('not-found', 'Question does not exist.');
    }

    const question = questionSnap?.data?.() || {};
    const nextAnswer = normalizeQuizCorrectionAnswer(question.answer);
    if (!nextAnswer) {
      throw new HttpsError('failed-precondition', 'Question answer is empty.');
    }

    const quizResultsSnap = await db
      .collection(`${getSemesterRoot(year, semester)}/quiz_results`)
      .get();
    const writes = [];
    const bonusTargets = [];
    let improvedAnswerCount = 0;

    quizResultsSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const details = Array.isArray(data.details) ? data.details : [];
      if (!details.length) return;

      let changed = false;
      const nextDetails = details.map((detail) => {
        if (!quizDetailMatchesQuestion(detail, questionDocId, questionId)) {
          return detail;
        }
        if (detail?.correct === true) return detail;

        const studentAnswer = normalizeQuizCorrectionAnswer(
          detail?.u ?? detail?.userAnswer ?? detail?.answer,
        );
        if (!studentAnswer || studentAnswer !== nextAnswer) return detail;

        changed = true;
        improvedAnswerCount += 1;
        return {
          ...detail,
          correct: true,
          correctedByAnswerKey: true,
        };
      });

      if (!changed) return;

      const totalCount = nextDetails.length;
      const correctCount = nextDetails.filter((detail) => detail?.correct === true).length;
      const previousScore = Math.max(0, Number(data.score || 0));
      const nextScore = totalCount ? Math.round((correctCount / totalCount) * 100) : 0;
      const resultUid = String(data.uid || '').trim();

      writes.push({
        ref: docSnap.ref,
        payload: {
          details: nextDetails,
          score: nextScore,
          correctedAt: FieldValue.serverTimestamp(),
          correctedBy: uid,
          correctionMeta: {
            questionDocId,
            questionId,
            previousScore,
            nextScore,
            reason: 'answer_key_correction',
          },
        },
      });

      if (resultUid && nextScore > previousScore) {
        bonusTargets.push({
          uid: resultUid,
          resultId: docSnap.id,
          score: nextScore,
        });
      }
    });

    await commitQuizCorrectionWrites(writes);

    let bonusAwardedCount = 0;
    let bonusAmount = 0;
    for (const target of bonusTargets) {
      const bonusResult = await awardQuizCorrectionBonus({
        year,
        semester,
        uid: target.uid,
        resultId: target.resultId,
        score: target.score,
      });
      if (bonusResult.awarded) {
        bonusAwardedCount += 1;
        bonusAmount += Number(bonusResult.amount || 0);
      }
    }

    if (bonusAwardedCount > 0) {
      await markWisHallOfFameDirtySafely(year, semester);
    }

    return {
      scannedResultCount: quizResultsSnap.size,
      updatedResultCount: writes.length,
      improvedAnswerCount,
      bonusAwardedCount,
      bonusAmount,
      hallOfFameDirty: bonusAwardedCount > 0,
    };
  },
);

exports.ensureWisHallOfFame = onCall({ region: REGION }, async (request) => {
  assertAllowedWestoryUser(request);
  const forceRefresh = request.data?.force === true;
  const { year, semester } = await resolveHallOfFameTargetYearSemester(
    request.data,
    {
      preferConfiguredCurrent: forceRefresh,
      source: forceRefresh ? 'manual' : 'ensure',
    },
  );
  const snapshotRef = db.doc(getWisHallOfFamePath(year, semester));
  const snapshot = await snapshotRef.get();
  const data = snapshot.exists ? (snapshot.data() || {}) : null;

  if (forceRefresh) {
    await assertHallOfFameManager(request);
    return refreshWisHallOfFameOrThrowHttps(year, semester, {
      source: 'manual',
    });
  }

  return {
    ensured: false,
    available: snapshot.exists,
    stale: isWisHallOfFameSnapshotStale(data),
    snapshotKey: String(data?.snapshotKey || '').trim(),
    snapshotVersion: Number(
      data?.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION,
    ),
  };
});

exports.markNotificationsRead = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const inboxRef = db.doc(getNotificationInboxPath(year, semester, uid));
  const unreadSnap = await db.collection(getNotificationItemsPath(year, semester, uid))
    .where('readAt', '==', null)
    .limit(100)
    .get();

  const batch = db.batch();
  unreadSnap.docs.forEach((docSnap) => {
    batch.set(docSnap.ref, { readAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  batch.set(inboxRef, {
    uid,
    unreadCount: 0,
    lastReadAt: FieldValue.serverTimestamp(),
    lastBroadcastReadAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return { updatedCount: unreadSnap.size };
});

exports.clearNotifications = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const inboxRef = db.doc(getNotificationInboxPath(year, semester, uid));
  let deletedCount = 0;

  while (true) {
    const snap = await db.collection(getNotificationItemsPath(year, semester, uid))
      .limit(450)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      deletedCount += 1;
    });
    batch.set(inboxRef, {
      uid,
      unreadCount: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
  }

  await inboxRef.set({
    uid,
    unreadCount: 0,
    lastBroadcastReadAt: FieldValue.serverTimestamp(),
    broadcastClearedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { deletedCount };
});

const deleteNotificationQueryBatch = async (querySnapshot) => {
  if (querySnapshot.empty) return 0;
  const batch = db.batch();
  querySnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
  return querySnapshot.size;
};

const cleanupSemesterNotifications = async (year, semester, cutoff) => {
  const inboxRefs = await db
    .collection(getPointCollectionPath(year, semester, 'notification_inboxes'))
    .listDocuments();
  let deletedCount = 0;

  for (const inboxRef of inboxRefs) {
    while (true) {
      const oldItems = await inboxRef
        .collection('items')
        .where('createdAt', '<', cutoff)
        .limit(400)
        .get();
      const deleted = await deleteNotificationQueryBatch(oldItems);
      deletedCount += deleted;
      if (!deleted) break;
    }
  }

  while (true) {
    const oldBroadcasts = await db
      .collection(getBroadcastNotificationsPath(year, semester))
      .where('createdAt', '<', cutoff)
      .limit(400)
      .get();
    const deleted = await deleteNotificationQueryBatch(oldBroadcasts);
    deletedCount += deleted;
    if (!deleted) break;
  }

  return deletedCount;
};

exports.cleanupOldNotifications = onSchedule(
  {
    region: REGION,
    schedule: '25 3 * * *',
    timeZone: 'Asia/Seoul',
  },
  async () => {
    const configSnap = await db.doc('site_settings/config').get();
    const config = configSnap.data() || {};
    const year = String(config.year || '').trim();
    const semester = String(config.semester || '').trim();
    if (!year || !semester) {
      console.warn('Skipped notification cleanup because site_settings/config is missing year/semester.');
      return;
    }

    const cutoff = Timestamp.fromMillis(
      Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const deletedCount = await cleanupSemesterNotifications(year, semester, cutoff);
    console.info(`Cleaned up ${deletedCount} old notification documents.`);
  },
);

exports.createManagedNotifications = onCall({ region: REGION }, async (request) => {
  const manager = await assertNotificationManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const recipientMode = String(request.data?.recipientMode || 'explicit').trim();
  const type = sanitizeNotificationText(request.data?.type, 80, 'system_notice');
  const allowedTypes = new Set([
    'history_classroom_assigned',
    'lesson_worksheet_published',
    'question_replied',
    'system_notice',
  ]);
  if (!allowedTypes.has(type)) {
    throw new HttpsError('invalid-argument', 'Unsupported notification type.');
  }

  if (recipientMode === 'all_students') {
    const result = await createBroadcastNotification(year, semester, {
      type,
      title: request.data?.title,
      body: request.data?.body,
      targetUrl: request.data?.targetUrl,
      entityType: request.data?.entityType,
      entityId: request.data?.entityId,
      priority: request.data?.priority,
      dedupeKey: request.data?.dedupeKey,
      actorUid: manager.uid,
      templateValues: request.data?.templateValues,
    });
    return {
      createdCount: result.created ? 1 : 0,
      recipientCount: 1,
      broadcast: true,
    };
  }

  const recipientUids = uniqueNonEmptyStrings(request.data?.recipientUids, 300);
  if (!recipientUids.length) {
    return { createdCount: 0, recipientCount: 0 };
  }

  const results = await createUserNotifications(year, semester, recipientUids, {
    type,
    title: request.data?.title,
    body: request.data?.body,
    targetUrl: request.data?.targetUrl,
    entityType: request.data?.entityType,
    entityId: request.data?.entityId,
    priority: request.data?.priority,
    dedupeKey: request.data?.dedupeKey,
    actorUid: manager.uid,
    templateValues: request.data?.templateValues,
  });

  return {
    createdCount: results.filter((result) => result.created).length,
    recipientCount: recipientUids.length,
  };
});

const normalizeHistoryClassroomAnswerText = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/[^\p{L}\p{N}]/gu, '')
  .toLocaleLowerCase('ko-KR');

const normalizeHistoryClassroomAnswersForWrite = (answers) => {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(answers)
      .map(([key, value]) => [String(key || '').trim(), String(value ?? '')])
      .filter(([key]) => key)
      .slice(0, 200),
  );
};

const normalizeHistoryClassroomBlanksForScoring = (blanks) => (
  Array.isArray(blanks)
    ? blanks.map((blank, index) => ({
      id: String(blank?.id || `blank-${index + 1}`).trim(),
      page: Math.max(1, Number(blank?.page) || 1),
      answer: String(blank?.answer ?? '').trim(),
    })).filter((blank) => blank.id)
    : []
);

const collectHistoryClassroomAssignedUidsForFunction = (assignment) => Array.from(new Set([
  ...(Array.isArray(assignment?.targetStudentUids)
    ? assignment.targetStudentUids.map((uid) => String(uid || '').trim()).filter(Boolean)
    : []),
  ...(String(assignment?.targetStudentUid || '').trim()
    ? [String(assignment.targetStudentUid || '').trim()]
    : []),
  ...(
    assignment?.targetStudentAccessMap && typeof assignment.targetStudentAccessMap === 'object'
      ? Object.entries(assignment.targetStudentAccessMap)
        .filter(([, allowed]) => allowed === true)
        .map(([uid]) => String(uid || '').trim())
        .filter(Boolean)
      : []
  ),
]));

const buildHistoryClassroomServerScore = (assignment, answers) => {
  const blanks = normalizeHistoryClassroomBlanksForScoring(assignment?.blanks);
  const checks = blanks.map((blank, index) => {
    const studentAnswer = String(answers[blank.id] ?? '');
    const correctAnswer = String(blank.answer ?? '');
    return {
      blankId: blank.id,
      blankNumber: index + 1,
      page: blank.page,
      studentAnswer,
      correctAnswer,
      correct: normalizeHistoryClassroomAnswerText(studentAnswer)
        === normalizeHistoryClassroomAnswerText(correctAnswer),
    };
  });
  const score = checks.filter((check) => check.correct).length;
  const total = checks.length;
  return {
    checks,
    score,
    total,
    percent: total > 0 ? Math.round((score / total) * 100) : 0,
  };
};

const loadHistoryClassroomAssignmentForSubmit = async (year, semester, assignmentId) => {
  const semesterRef = db.doc(`${getSemesterRoot(year, semester)}/history_classrooms/${assignmentId}`);
  let snap = await semesterRef.get();
  if (!snap.exists) {
    snap = await db.doc(`history_classrooms/${assignmentId}`).get();
  }
  if (!snap.exists) {
    throw new HttpsError('not-found', 'History classroom assignment does not exist.');
  }
  return {
    id: snap.id,
    data: snap.data() || {},
  };
};

exports.submitHistoryClassroomResult = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const assignmentId = String(request.data?.assignmentId || '').trim();
  const requestedResultId = String(request.data?.resultId || '').trim();
  const requestedStatus = String(request.data?.status || '').trim();
  const cancellationReason = String(request.data?.cancellationReason || '').trim().slice(0, 120);

  if (!assignmentId) {
    throw new HttpsError('invalid-argument', 'Assignment id is required.');
  }
  if (requestedStatus && !['passed', 'failed', 'cancelled'].includes(requestedStatus)) {
    throw new HttpsError('invalid-argument', 'Invalid result status.');
  }

  const assignment = await loadHistoryClassroomAssignmentForSubmit(year, semester, assignmentId);
  const assignmentData = assignment.data;
  if (assignmentData.deletedAt) {
    throw new HttpsError('failed-precondition', 'History classroom assignment was deleted.');
  }
  if (assignmentData.isPublished !== true) {
    throw new HttpsError('failed-precondition', 'History classroom assignment is not published.');
  }
  if (!collectHistoryClassroomAssignedUidsForFunction(assignmentData).includes(uid)) {
    throw new HttpsError('permission-denied', 'History classroom assignment is not assigned to the caller.');
  }

  const answers = normalizeHistoryClassroomAnswersForWrite(request.data?.answers);
  const scoreSummary = buildHistoryClassroomServerScore(assignmentData, answers);
  const { profile } = await getUserProfile(uid);
  const passThresholdPercent = Math.min(100, Math.max(0, Number(assignmentData.passThresholdPercent) || 80));
  const passed = requestedStatus === 'cancelled'
    ? false
    : scoreSummary.percent >= passThresholdPercent;
  const status = requestedStatus === 'cancelled'
    ? 'cancelled'
    : passed
      ? 'passed'
      : 'failed';

  const resultCollectionPath = `${getSemesterRoot(year, semester)}/history_classroom_results`;
  const resultRef = requestedResultId
    ? db.doc(`${resultCollectionPath}/${requestedResultId}`)
    : db.collection(resultCollectionPath).doc();
  const resultSnap = await resultRef.get();
  if (resultSnap.exists && String(resultSnap.data()?.uid || '').trim() !== uid) {
    throw new HttpsError('permission-denied', 'History classroom result id belongs to another user.');
  }

  const resultPayload = {
    assignmentId: assignment.id,
    assignmentTitle: String(assignmentData.title || '').trim(),
    uid,
    studentName: String(profile.name || '').trim(),
    studentGrade: String(profile.grade || '').trim(),
    studentClass: String(profile.class || '').trim(),
    studentNumber: String(profile.number || '').trim(),
    answers,
    score: scoreSummary.score,
    total: scoreSummary.total,
    percent: scoreSummary.percent,
    passThresholdPercent,
    passed,
    status,
    answerChecks: scoreSummary.checks,
    cancellationReason,
    createdAt: FieldValue.serverTimestamp(),
  };

  await resultRef.set(resultPayload, { merge: false });

  let notificationCreatedCount = 0;
  let notificationRecipientCount = 0;
  if (passed) {
    try {
      const notificationResults = await createHistoryClassroomPassedNotifications(year, semester, {
        resultId: resultRef.id,
        assignmentTitle: resultPayload.assignmentTitle,
        studentName: resultPayload.studentName,
        percent: scoreSummary.percent,
        actorUid: uid,
      });
      notificationCreatedCount = notificationResults.filter((result) => result.created).length;
      notificationRecipientCount = notificationResults.length;
    } catch (notificationError) {
      console.error('Failed to create history classroom passed notifications:', notificationError);
    }
  }

  return {
    resultId: resultRef.id,
    resultCollectionPath,
    score: scoreSummary.score,
    total: scoreSummary.total,
    percent: scoreSummary.percent,
    passed,
    status,
    answerChecks: scoreSummary.checks,
    notificationCreatedCount,
    notificationRecipientCount,
  };
});

exports.notifyHistoryClassroomSubmitted = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const assignmentId = sanitizeNotificationText(request.data?.assignmentId, 160);
  const resultId = sanitizeNotificationText(request.data?.resultId, 160);
  const assignmentTitle = sanitizeNotificationText(
    request.data?.assignmentTitle,
    80,
    '역사교실',
  );
  const percent = Math.max(0, Math.min(100, Number(request.data?.percent || 0)));
  if (!assignmentId || !resultId) {
    throw new HttpsError('invalid-argument', 'assignmentId and resultId are required.');
  }

  const { profile: profileForNotification } = await getUserProfile(uid);
  const savedResult = await loadHistoryClassroomResultForNotification(year, semester, resultId);
  if (!savedResult) {
    throw new HttpsError('not-found', 'History classroom result does not exist.');
  }

  const savedResultData = savedResult.data;
  const resultUid = String(savedResultData.uid || '').trim();
  if (resultUid !== uid) {
    throw new HttpsError('permission-denied', 'History classroom result belongs to another user.');
  }
  if (String(savedResultData.assignmentId || '').trim() !== assignmentId) {
    throw new HttpsError('invalid-argument', 'History classroom result does not match assignment id.');
  }
  if (savedResultData.passed !== true && String(savedResultData.status || '').trim() !== 'passed') {
    return {
      createdCount: 0,
      recipientCount: 0,
      skipped: true,
      reason: 'result_not_passed',
    };
  }

  const notificationResults = await createHistoryClassroomPassedNotifications(year, semester, {
    resultId,
    assignmentTitle: savedResultData.assignmentTitle || assignmentTitle,
    studentName: savedResultData.studentName || profileForNotification.name,
    percent: Number(savedResultData.percent || percent),
    actorUid: uid,
  });

  return {
    createdCount: notificationResults.filter((result) => result.created).length,
    recipientCount: notificationResults.length,
  };

});

exports.saveWisHallOfFameConfig = onCall({ region: REGION }, async (request) => {
  const { uid } = await assertHallOfFameManager(request);
  const { year, semester } = await resolveHallOfFameTargetYearSemester(
    request.data,
    {
      preferConfiguredCurrent: true,
      source: 'config_save',
    },
  );
  const shouldRefreshSnapshot = false;
  const hallOfFamePatch = request.data?.hallOfFame && typeof request.data.hallOfFame === 'object'
    ? request.data.hallOfFame
    : {};
  const interfaceRef = db.doc('site_settings/interface_config');
  let normalizedHallOfFame = null;

  try {
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
    normalizedHallOfFame = resolveHallOfFameInterfaceConfig(mergedHallOfFame);

    await interfaceRef.set({
      hallOfFame: normalizedHallOfFame,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    }, { merge: true });
  } catch (error) {
    console.error('Failed to save hall of fame interface config:', error);
    throw new HttpsError(
      'internal',
      '학생 화면 설정 저장 중 서버 오류가 발생했습니다.',
      { stage: 'config_save' },
    );
  }

  if (shouldRefreshSnapshot) {
    try {
      await refreshWisHallOfFameOrThrowHttps(year, semester, {
        source: 'config_save',
      });
    } catch (error) {
      console.error('Failed to refresh wis hall of fame snapshot after config save:', error);
      throw new HttpsError(
        'internal',
        '학생 화면 설정 저장 후 공개 랭킹 새로고침에 실패했습니다.',
        {
          stage: 'snapshot_refresh',
          refreshStage: String(error?.details?.stage || '').trim(),
          refreshDetail: String(error?.details?.detail || '').trim(),
        },
      );
    }
  }

  return {
    saved: true,
    hallOfFame: normalizedHallOfFame,
  };
});

exports.refreshWisHallOfFameOnSchedule = onSchedule(
  {
    region: REGION,
    schedule: '0 */4 * * *',
    timeZone: 'Asia/Seoul',
  },
  async () => {
    const currentYearSemester = await resolveHallOfFameTargetYearSemester(
      null,
      {
        preferConfiguredCurrent: true,
        allowMissing: true,
        source: 'schedule',
      },
    );
    if (!currentYearSemester) {
      console.warn('Skipped scheduled hall of fame refresh because site_settings/config is missing year/semester.');
      return;
    }

    const { year, semester } = currentYearSemester;
    try {
      const snapshot = await db.doc(getWisHallOfFamePath(year, semester)).get();
      const data = snapshot.exists ? (snapshot.data() || {}) : null;
      if (!isWisHallOfFameSnapshotStale(data)) {
        console.log('Skipped scheduled hall of fame refresh because snapshot is fresh:', {
          year,
          semester,
          snapshotKey: String(data?.snapshotKey || '').trim(),
          snapshotVersion: Number(data?.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION),
        });
        return;
      }

      const result = await refreshWisHallOfFame(year, semester, {
        source: 'schedule',
      });
      console.log('Scheduled hall of fame refresh completed:', {
        year,
        semester,
        ...result,
      });
    } catch (error) {
      const failure = normalizeHallOfFameRefreshError(error);
      console.error('Scheduled hall of fame refresh failed:', {
        year,
        semester,
        stage: failure.stage || 'unknown',
        message: failure.message,
        cause: failure.cause || null,
      });
      throw error;
    }
  },
);

exports.rebuildPointWalletRankTotals = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const manager = await assertPointManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const dryRun = request.data?.dryRun === true;
  const policySnap = await db.doc(getPointPolicyPath(year, semester)).get();
  const policy = policySnap.exists
    ? normalizePointPolicy(policySnap.data() || {})
    : getDefaultPointPolicy();
  const plan = await buildPointWalletRankBackfillPlan({
    year,
    semester,
    rankPolicy: policy.rankPolicy,
  });
  const changedWalletCount = plan.writes.length;

  if (!dryRun && changedWalletCount > 0) {
    await commitPointWalletBackfillWrites(plan.writes);
    await markWisHallOfFameDirtySafely(year, semester);
  }

  return {
    year,
    semester,
    dryRun,
    scannedWalletCount: plan.scannedWalletCount,
    scannedTransactionCount: plan.scannedTransactionCount,
    processedUidCount: plan.processedUidCount,
    updatedWalletCount: plan.updatedWalletCount,
    createdWalletCount: plan.createdWalletCount,
    changedWalletCount,
    skippedMissingProfileCount: plan.skippedMissingProfileCount,
    hallOfFameDirty: !dryRun && changedWalletCount > 0,
    actorUid: manager.uid,
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
    await markWisHallOfFameDirtySafely(year, semester);
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

    transaction.set(orderRef, {
      uid,
      studentName: String(wallet.studentName || profile.name || '').trim(),
      productId,
      productName: String(product.name || '').trim(),
      priceSnapshot: productPrice,
      status: 'requested',
      stockDeducted: false,
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
      productName: String(product.name || '').trim(),
      studentName: String(wallet.studentName || profile.name || '').trim(),
    };
  });

  if (result.created) {
    await markWisHallOfFameDirtySafely(year, semester);
    const recipients = await resolvePointManagerRecipientUids();
    await createUserNotifications(year, semester, recipients, {
      type: 'point_order_requested',
      title: '상점 구매 요청',
      body: `${result.studentName || '학생'} 학생이 ${result.productName || '상품'} 구매를 요청했습니다.`,
      targetUrl: '/teacher/points?tab=requests',
      entityType: 'point_order',
      entityId: result.orderId,
      actorUid: uid,
      priority: 'normal',
      dedupeKey: `point_order_requested:${year}:${semester}:${result.orderId}`,
      templateValues: {
        studentName: result.studentName || '학생',
        productName: result.productName || '상품',
      },
    });
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
      // Keep cumulative earned aligned with the rank/hall-of-fame metric:
      // positive manual grants increase it, manual reclaims do not decrease it.
      earnedTotal: nextRankEarnedTotal,
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

  await markWisHallOfFameDirtySafely(year, semester);
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
      // Edits and cancellations follow the same cumulative-earned rule so
      // positive manual grants can be corrected without double counting.
      earnedTotal: nextRankEarnedTotal,
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

  await markWisHallOfFameDirtySafely(year, semester);
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
  if (!['requested', 'approved', 'rejected', 'fulfilled', 'cancelled'].includes(nextStatus)) {
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
      || (order.status === 'approved' && ['requested', 'fulfilled', 'cancelled'].includes(nextStatus))
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
    const currentProductStock = productSnap.exists
      ? Math.max(0, Math.floor(toFiniteNumber(productSnap.data().stock, 0)))
      : 0;
    const stockDeducted = order.stockDeducted !== false;

    transaction.set(orderRef, {
      status: nextStatus,
      stockDeducted: nextStatus === 'approved' || nextStatus === 'fulfilled',
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: manager.uid,
      memo: memo || String(order.memo || '').trim(),
    }, { merge: true });

    const transactionId = buildOrderReviewTransactionId(order.id, nextStatus);
    const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);

    if (nextStatus === 'requested') {
      if (stockDeducted && productSnap.exists) {
        transaction.set(productRef, {
          stock: currentProductStock + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      transaction.set(walletRef, {
        ...buildWalletBase(order.uid, profile),
        ...buildWalletRankState(currentRankEarnedTotal, policy.rankPolicy),
      }, { merge: true });

      return {
        orderId: order.id,
        transactionId: '',
        status: nextStatus,
        duplicate: false,
        uid: order.uid,
        productName: String(order.productName || '').trim(),
      };
    }

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

      if (stockDeducted && productSnap.exists) {
        transaction.set(productRef, {
          stock: currentProductStock + 1,
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
        uid: order.uid,
        productName: String(order.productName || '').trim(),
      };
    }

    if (nextStatus === 'approved') {
      if (!stockDeducted) {
        if (!productSnap.exists) {
          throw new HttpsError('not-found', 'Point product does not exist.');
        }
        if (currentProductStock <= 0) {
          throw new HttpsError('failed-precondition', 'Point product is out of stock.');
        }
        transaction.set(productRef, {
          stock: currentProductStock - 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
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
      uid: order.uid,
      productName: String(order.productName || '').trim(),
    };
  });

  if (!result.duplicate) {
    await markWisHallOfFameDirtySafely(year, semester);
    const statusLabel = {
      requested: '검토 대기',
      approved: '승인',
      rejected: '거절',
      fulfilled: '확정',
      cancelled: '취소',
    }[result.status] || result.status;
    await createUserNotification(year, semester, result.uid, {
      type: 'point_order_reviewed',
      title: '상점 구매 처리',
      body: `${result.productName || '상품'} 구매 요청이 ${statusLabel} 처리되었습니다.`,
      targetUrl: '/student/points?tab=orders',
      entityType: 'point_order',
      entityId: result.orderId,
      actorUid: manager.uid,
      priority: result.status === 'rejected' || result.status === 'cancelled' ? 'high' : 'normal',
      dedupeKey: `point_order_reviewed:${year}:${semester}:${result.orderId}:${result.status}`,
      templateValues: {
        productName: result.productName || '상품',
        statusLabel,
      },
    });
  }
  return result;
});

const getHistoryDictionaryRewardSourceId = (termId) =>
  `history-dictionary:${sanitizeKeyPart(termId)}`;

const getHistoryDictionaryRewardTransactionId = (uid, termId) =>
  buildActivityTransactionId(uid, 'history_dictionary', getHistoryDictionaryRewardSourceId(termId));

const getHistoryDictionaryDefinitionQualityLength = (definition) =>
  String(definition || '').replace(/\s+/g, '').trim().length;

const awardHistoryDictionaryRewardIfEligible = async ({
  transaction,
  year,
  semester,
  uid,
  profile,
  termId,
  word,
  definition,
}) => {
  const policy = await loadPolicy(transaction, year, semester);
  const rule = policy.rewardPolicy?.historyDictionary || {};
  const amount = Number(rule.amount || 0);
  const minDefinitionLength = Math.max(1, Number(rule.minDefinitionLength || 20));
  const qualityLength = getHistoryDictionaryDefinitionQualityLength(definition);
  if (!policy.autoRewardEnabled || rule.enabled !== true || amount <= 0 || qualityLength < minDefinitionLength) {
    return {
      awarded: false,
      amount: 0,
      blockedReason: qualityLength < minDefinitionLength ? 'definition_too_short' : 'policy_disabled',
    };
  }

  const todayKey = getKstDateKey();
  const sourceId = getHistoryDictionaryRewardSourceId(termId);
  const transactionId = getHistoryDictionaryRewardTransactionId(uid, termId);
  const txRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${transactionId}`);
  const txSnap = await transaction.get(txRef);
  if (txSnap.exists) {
    return {
      awarded: false,
      amount: 0,
      transactionId,
      blockedReason: 'duplicate_source',
    };
  }

  const dailySnapshot = await transaction.get(
    db.collection(getPointCollectionPath(year, semester, 'point_transactions'))
      .where('uid', '==', uid)
      .where('type', '==', 'history_dictionary')
      .where('targetDate', '==', todayKey),
  );
  const maxDailyClaims = Math.max(1, Number(rule.maxDailyClaims || 4));
  if (dailySnapshot.size >= maxDailyClaims) {
    return {
      awarded: false,
      amount: 0,
      blockedReason: 'daily_max_reached',
      claimCount: dailySnapshot.size,
      maxDailyClaims,
    };
  }

  const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
  const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
  const nextBalance = Number(wallet.balance || 0) + amount;
  const nextRankEarnedTotal = currentRankEarnedTotal + amount;
  const nextEarnedTotal = Number(wallet.earnedTotal || 0) + amount;

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
    type: 'history_dictionary',
    delta: amount,
    balanceAfter: nextBalance,
    sourceId,
    sourceLabel: `역사 사전 단어 등록: ${sanitizeHistoryDictionaryWord(word)}`,
    policyId: 'current',
    createdBy: 'system:auto',
    targetDate: todayKey,
  }));

  return {
    awarded: true,
    amount,
    transactionId,
    balance: nextBalance,
    claimCount: dailySnapshot.size + 1,
    maxDailyClaims,
  };
};

const reclaimHistoryDictionaryRewardIfNeeded = async ({
  transaction,
  year,
  semester,
  uid,
  profile,
  termId,
  word,
  actorUid,
  reason,
}) => {
  const rewardTransactionId = getHistoryDictionaryRewardTransactionId(uid, termId);
  const rewardTxRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${rewardTransactionId}`);
  const rewardTxSnap = await transaction.get(rewardTxRef);
  if (!rewardTxSnap.exists) {
    return { reclaimed: false, amount: 0, blockedReason: 'reward_not_found' };
  }

  const rewardTx = rewardTxSnap.data() || {};
  if (rewardTx.reclaimed === true) {
    return { reclaimed: false, amount: 0, blockedReason: 'already_reclaimed' };
  }

  const amount = Math.max(0, Number(rewardTx.delta || 0));
  if (amount <= 0) {
    return { reclaimed: false, amount: 0, blockedReason: 'empty_reward' };
  }

  const reclaimTxRef = db.doc(`${getPointCollectionPath(year, semester, 'point_transactions')}/${rewardTransactionId}_reclaim`);
  const reclaimTxSnap = await transaction.get(reclaimTxRef);
  if (reclaimTxSnap.exists) {
    transaction.set(rewardTxRef, {
      reclaimed: true,
      reclaimedAt: rewardTx.reclaimedAt || FieldValue.serverTimestamp(),
      reclaimedBy: rewardTx.reclaimedBy || actorUid,
      reclaimReason: rewardTx.reclaimReason || reason,
    }, { merge: true });
    return { reclaimed: false, amount: 0, blockedReason: 'reclaim_exists' };
  }

  const policy = await loadPolicy(transaction, year, semester);
  const { ref: walletRef, wallet } = await ensureWallet(transaction, year, semester, uid, profile);
  const currentRankEarnedTotal = await getCurrentRankEarnedTotal(transaction, year, semester, uid, wallet);
  const nextBalance = Number(wallet.balance || 0) - amount;
  const nextRankEarnedTotal = Math.max(0, currentRankEarnedTotal - amount);
  const nextEarnedTotal = Math.max(0, Number(wallet.earnedTotal || 0) - amount);

  transaction.set(walletRef, {
    ...buildWalletBase(uid, profile),
    balance: nextBalance,
    earnedTotal: nextEarnedTotal,
    ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
    spentTotal: Number(wallet.spentTotal || 0),
    adjustedTotal: Number(wallet.adjustedTotal || 0),
    lastTransactionAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  transaction.set(rewardTxRef, {
    reclaimed: true,
    reclaimedAt: FieldValue.serverTimestamp(),
    reclaimedBy: actorUid,
    reclaimReason: reason,
  }, { merge: true });

  transaction.set(reclaimTxRef, createTransactionPayload({
    uid,
    type: 'history_dictionary_reclaim',
    delta: -amount,
    balanceAfter: nextBalance,
    sourceId: String(rewardTx.sourceId || getHistoryDictionaryRewardSourceId(termId)),
    sourceLabel: `역사 사전 보상 회수: ${sanitizeHistoryDictionaryWord(word)}`,
    policyId: String(rewardTx.policyId || 'current'),
    createdBy: actorUid,
    targetDate: String(rewardTx.targetDate || ''),
  }));

  return {
    reclaimed: true,
    amount,
    transactionId: reclaimTxRef.id,
    balance: nextBalance,
  };
};

exports.requestHistoryDictionaryTerm = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const { year, semester } = assertYearSemester(request.data);
  const word = sanitizeHistoryDictionaryWord(request.data?.word);
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  const memo = sanitizeHistoryDictionaryText(request.data?.memo, 240);
  const warningAccepted = request.data?.warningAccepted === true;

  if (!word || !normalizedWord) {
    throw new HttpsError('invalid-argument', 'A word is required.');
  }
  if (word.length > 40) {
    throw new HttpsError('invalid-argument', 'Word is too long.');
  }
  if (!warningAccepted) {
    throw new HttpsError('failed-precondition', 'Dictionary request warning must be accepted.');
  }

  const { profile } = await ensureStudentProfile(uid);
  const termId = buildHistoryDictionaryTermId(normalizedWord);
  const requestId = buildHistoryDictionaryRequestId(year, semester, uid, normalizedWord);
  const termRef = db.doc(getHistoryDictionaryTermPath(termId));
  const requestRef = db.doc(getHistoryDictionaryRequestPath(requestId));
  const wordRef = db.doc(getStudentHistoryDictionaryWordPath(uid, termId));

  const result = await db.runTransaction(async (transaction) => {
    const [termSnap, requestSnap] = await Promise.all([
      transaction.get(termRef),
      transaction.get(requestRef),
    ]);
    const termData = termSnap.exists ? termSnap.data() || {} : null;
    const hasPublishedTerm = termData?.status === 'published' && String(termData.definition || '').trim();
    const nextStatus = hasPublishedTerm ? 'needs_approval' : 'requested';

    if (requestSnap.exists) {
      const existing = requestSnap.data() || {};
      const existingStatus = String(existing.status || '').trim();
      if (existingStatus === 'resolved') {
        return {
          requestId,
          termId,
          created: false,
          alreadyResolved: true,
          status: existingStatus,
          matchedTermId: String(existing.resolvedTermId || existing.matchedTermId || ''),
        };
      }
      transaction.set(requestRef, {
        word,
        normalizedWord,
        memo,
        status: existingStatus === 'needs_approval' || existingStatus === 'requested'
          ? existingStatus
          : nextStatus,
        matchedTermId: hasPublishedTerm ? termId : String(existing.matchedTermId || ''),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(wordRef, {
        termId,
        word,
        normalizedWord,
        definition: '',
        studentLevel: '',
        status: 'requested',
        requestId,
        uid,
        studentName: sanitizeHistoryDictionaryText(profile.name, 40) || '학생',
        grade: sanitizeHistoryDictionaryText(profile.grade, 8),
        class: sanitizeHistoryDictionaryText(profile.class, 8),
        number: sanitizeHistoryDictionaryText(profile.number, 8),
        memo,
        year,
        semester,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        requestId,
        termId,
        created: false,
        alreadyResolved: false,
        status: existingStatus || nextStatus,
        matchedTermId: hasPublishedTerm ? termId : String(existing.matchedTermId || ''),
      };
    }

    transaction.set(requestRef, {
      word,
      normalizedWord,
      uid,
      studentName: sanitizeHistoryDictionaryText(profile.name, 40) || '학생',
      grade: sanitizeHistoryDictionaryText(profile.grade, 8),
      class: sanitizeHistoryDictionaryText(profile.class, 8),
      number: sanitizeHistoryDictionaryText(profile.number, 8),
      memo,
      status: nextStatus,
      matchedTermId: hasPublishedTerm ? termId : '',
      resolvedTermId: '',
      resolvedBy: '',
      year,
      semester,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
    });
    transaction.set(wordRef, {
      termId,
      word,
      normalizedWord,
      definition: '',
      studentLevel: '',
      status: 'requested',
      requestId,
      uid,
      studentName: sanitizeHistoryDictionaryText(profile.name, 40) || '학생',
      grade: sanitizeHistoryDictionaryText(profile.grade, 8),
      class: sanitizeHistoryDictionaryText(profile.class, 8),
      number: sanitizeHistoryDictionaryText(profile.number, 8),
      memo,
      year,
      semester,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      requestId,
      termId,
      created: true,
      alreadyResolved: false,
      status: nextStatus,
      matchedTermId: hasPublishedTerm ? termId : '',
    };
  });

  if (result.created) {
    const recipients = await resolveHistoryDictionaryManagerRecipientUids();
    await createUserNotifications(year, semester, recipients, {
      type: 'history_dictionary_requested',
      title: '역사 사전 요청',
      body: `${profile.name || '학생'} 학생이 ${word} 뜻풀이를 요청했습니다.`,
      targetUrl: `/teacher/lesson/history-dictionary?panel=requests&requestId=${encodeURIComponent(requestId)}`,
      entityType: 'history_dictionary_request',
      entityId: requestId,
      actorUid: uid,
      priority: result.status === 'needs_approval' ? 'normal' : 'high',
      dedupeKey: `history_dictionary_requested:${year}:${semester}:${requestId}`,
      templateValues: {
        studentName: profile.name || '학생',
        word,
      },
    });
  }

  return result;
});

exports.saveStudentHistoryDictionaryWord = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const termId = sanitizeHistoryDictionaryText(request.data?.termId, 80);
  if (!termId) {
    throw new HttpsError('invalid-argument', 'termId is required.');
  }

  const termRef = db.doc(getHistoryDictionaryTermPath(termId));
  const wordRef = db.doc(getStudentHistoryDictionaryWordPath(uid, termId));
  return db.runTransaction(async (transaction) => {
    const termSnap = await transaction.get(termRef);
    if (!termSnap.exists) {
      throw new HttpsError('not-found', 'Dictionary term does not exist.');
    }
    const term = termSnap.data() || {};
    if (term.status !== 'published' || !String(term.definition || '').trim()) {
      throw new HttpsError('failed-precondition', 'Dictionary term is not published.');
    }

    transaction.set(wordRef, {
      termId,
      word: sanitizeHistoryDictionaryWord(term.word),
      normalizedWord: normalizeHistoryDictionaryWord(term.normalizedWord || term.word),
      definition: sanitizeHistoryDictionaryText(term.definition, 1200),
      studentLevel: sanitizeHistoryDictionaryText(term.studentLevel, 80),
      tags: sanitizeHistoryDictionaryTags(term.tags),
      status: 'saved',
      requestId: '',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { termId, saved: true };
  });
});

exports.saveStudentHistoryDictionaryEntry = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const word = sanitizeHistoryDictionaryWord(request.data?.word);
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  const definition = sanitizeHistoryDictionaryText(request.data?.definition, 1200);
  const scoped = getOptionalYearSemester(request.data) || await getCurrentConfiguredYearSemester();

  if (!word || !normalizedWord) {
    throw new HttpsError('invalid-argument', 'A word is required.');
  }
  if (!definition || definition.length < 2) {
    throw new HttpsError('invalid-argument', 'Definition is required.');
  }

  const termId = buildHistoryDictionaryTermId(normalizedWord);
  const wordRef = db.doc(getStudentHistoryDictionaryWordPath(uid, termId));
  const { profile } = await ensureStudentProfile(uid);
  const result = await db.runTransaction(async (transaction) => {
    const wordSnap = await transaction.get(wordRef);
    let reward = { awarded: false, amount: 0 };
    if (scoped) {
      reward = await awardHistoryDictionaryRewardIfEligible({
        transaction,
        year: scoped.year,
        semester: scoped.semester,
        uid,
        profile,
        termId,
        word,
        definition,
      });
    }

    const existingWord = wordSnap.data() || {};
    transaction.set(wordRef, {
      termId,
      word,
      normalizedWord,
      definition,
      studentLevel: '내가 정리한 뜻풀이',
      status: 'saved',
      requestId: '',
      definitionSource: 'student',
      rewardTransactionId: reward.transactionId || existingWord.rewardTransactionId || '',
      rewardAmount: reward.awarded ? reward.amount : Number(existingWord.rewardAmount || 0),
      rewardAwardedAt: reward.awarded ? FieldValue.serverTimestamp() : (existingWord.rewardAwardedAt || null),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: wordSnap.exists ? (existingWord.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
    }, { merge: true });

    return reward;
  });

  if (result.awarded && scoped) {
    await markWisHallOfFameDirtySafely(scoped.year, scoped.semester);
  }

  return {
    termId,
    saved: true,
    reward: result,
  };
});

exports.deleteStudentHistoryDictionaryWord = onCall({ region: REGION }, async (request) => {
  const { uid } = assertAllowedWestoryUser(request);
  const termId = sanitizeHistoryDictionaryText(request.data?.termId, 80);
  const scoped = getOptionalYearSemester(request.data) || await getCurrentConfiguredYearSemester();
  if (!termId) {
    throw new HttpsError('invalid-argument', 'termId is required.');
  }

  const wordRef = db.doc(getStudentHistoryDictionaryWordPath(uid, termId));
  const { profile } = await ensureStudentProfile(uid);
  const result = await db.runTransaction(async (transaction) => {
    const wordSnap = await transaction.get(wordRef);
    if (!wordSnap.exists) {
      return {
        termId,
        deleted: false,
        reward: { reclaimed: false, amount: 0, blockedReason: 'word_not_found' },
      };
    }

    const wordData = wordSnap.data() || {};
    let reward = { reclaimed: false, amount: 0 };
    if (scoped) {
      reward = await reclaimHistoryDictionaryRewardIfNeeded({
        transaction,
        year: scoped.year,
        semester: scoped.semester,
        uid,
        profile,
        termId,
        word: wordData.word || termId,
        actorUid: uid,
        reason: 'student_deleted_history_dictionary_word',
      });
    }

    transaction.delete(wordRef);
    return {
      termId,
      deleted: true,
      reward,
    };
  });

  if (result.reward?.reclaimed && scoped) {
    await markWisHallOfFameDirtySafely(scoped.year, scoped.semester);
  }

  return result;
});

exports.deleteStudentHistoryDictionaryWordByTeacher = onCall({ region: REGION }, async (request) => {
  const manager = await assertHistoryDictionaryManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const targetUid = String(request.data?.uid || '').trim();
  const requestId = sanitizeHistoryDictionaryText(request.data?.requestId, 100);
  const word = sanitizeHistoryDictionaryWord(request.data?.word);
  const normalizedWord = normalizeHistoryDictionaryWord(request.data?.normalizedWord || word);
  const termId = sanitizeHistoryDictionaryText(request.data?.termId, 80)
    || (normalizedWord ? buildHistoryDictionaryTermId(normalizedWord) : '');
  const reason = sanitizeHistoryDictionaryText(
    request.data?.reason || 'teacher_deleted_inappropriate_history_dictionary_word',
    160,
  );
  if (!targetUid || !termId) {
    throw new HttpsError('invalid-argument', 'uid and termId are required.');
  }

  const wordRef = db.doc(getStudentHistoryDictionaryWordPath(targetUid, termId));
  const requestRef = requestId ? db.doc(getHistoryDictionaryRequestPath(requestId)) : null;
  const { profile } = await ensureStudentProfile(targetUid);
  const result = await db.runTransaction(async (transaction) => {
    const [wordSnap, requestSnap] = await Promise.all([
      transaction.get(wordRef),
      requestRef ? transaction.get(requestRef) : Promise.resolve(null),
    ]);
    const wordData = wordSnap.exists ? wordSnap.data() || {} : {};
    let reward = { reclaimed: false, amount: 0 };
    reward = await reclaimHistoryDictionaryRewardIfNeeded({
      transaction,
      year,
      semester,
      uid: targetUid,
      profile,
      termId,
      word: wordData.word || word || termId,
      actorUid: manager.uid,
      reason,
    });

    if (wordSnap.exists) {
      transaction.delete(wordRef);
    }
    if (requestRef && requestSnap?.exists) {
      transaction.set(requestRef, {
        status: 'rejected',
        rejectedBy: manager.uid,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (requestRef) {
      transaction.set(requestRef, {
        word: word || wordData.word || termId,
        normalizedWord,
        uid: targetUid,
        studentName: sanitizeHistoryDictionaryText(profile.name, 40) || '학생',
        grade: sanitizeHistoryDictionaryText(profile.grade, 8),
        class: sanitizeHistoryDictionaryText(profile.class, 8),
        number: sanitizeHistoryDictionaryText(profile.number, 8),
        memo: '알림 기록에서 복구해 반려한 요청입니다.',
        status: 'rejected',
        matchedTermId: termId,
        resolvedTermId: '',
        resolvedBy: '',
        rejectedBy: manager.uid,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: reason,
        year,
        semester,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
      }, { merge: true });
    }

    return {
      termId,
      requestId,
      deleted: wordSnap.exists,
      reward,
    };
  });

  if (result.reward?.reclaimed) {
    await markWisHallOfFameDirtySafely(year, semester);
  }

  await createUserNotification(year, semester, targetUid, {
    type: 'history_dictionary_rejected',
    title: '역사 사전 단어 삭제',
    body: `"${word || '요청한 단어'}" 항목이 선생님 확인 후 삭제되었습니다.`,
    targetUrl: '/student/lesson/history-dictionary',
    entityType: 'history_dictionary_request',
    entityId: requestId || termId,
    actorUid: manager.uid,
    priority: 'normal',
    dedupeKey: `history_dictionary_rejected:${year}:${semester}:${targetUid}:${termId}:${Date.now()}`,
    templateValues: {
      word: word || '요청한 단어',
    },
  });

  return result;
});

const resolveHistoryDictionaryRequestsWithTerm = async ({
  managerUid,
  termId,
  requestId = '',
  fallbackRequestId = '',
  fallbackUid = '',
  year = '',
  semester = '',
}) => {
  const termRef = db.doc(getHistoryDictionaryTermPath(termId));
  const result = await db.runTransaction(async (transaction) => {
    const termSnap = await transaction.get(termRef);
    if (!termSnap.exists) {
      throw new HttpsError('not-found', 'Dictionary term does not exist.');
    }
    const term = termSnap.data() || {};
    if (term.status !== 'published' || !String(term.definition || '').trim()) {
      throw new HttpsError('failed-precondition', 'Dictionary term is not published.');
    }

    const normalizedWord = normalizeHistoryDictionaryWord(term.normalizedWord || term.word);
    let docs = [];
    if (requestId) {
      const requestSnap = await transaction.get(db.doc(getHistoryDictionaryRequestPath(requestId)));
      docs = [{ ref: requestSnap.ref, exists: requestSnap.exists, data: () => requestSnap.data() }];
    } else {
      const requestSnap = await transaction.get(
        db.collection(HISTORY_DICTIONARY_REQUESTS_COLLECTION)
          .where('normalizedWord', '==', normalizedWord)
          .limit(100),
      );
      docs = requestSnap.docs;
    }

    const resolved = [];
    docs.forEach((docSnap) => {
      if (!docSnap.exists) return;
      const data = docSnap.data() || {};
      if (year && String(data.year || '') !== year) return;
      if (semester && String(data.semester || '') !== semester) return;
      if (!['requested', 'needs_approval'].includes(String(data.status || '').trim())) return;
      const targetUid = String(data.uid || '').trim();
      if (!targetUid) return;
      transaction.set(docSnap.ref, {
        status: 'resolved',
        matchedTermId: termId,
        resolvedTermId: termId,
        resolvedBy: managerUid,
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(db.doc(getStudentHistoryDictionaryWordPath(targetUid, termId)), {
        termId,
        word: sanitizeHistoryDictionaryWord(term.word),
        normalizedWord,
        definition: sanitizeHistoryDictionaryText(term.definition, 1200),
        studentLevel: sanitizeHistoryDictionaryText(term.studentLevel, 80),
        tags: sanitizeHistoryDictionaryTags(term.tags),
        status: 'saved',
        requestId: docSnap.ref.id,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      resolved.push({
        uid: targetUid,
        requestId: docSnap.ref.id,
        word: sanitizeHistoryDictionaryWord(term.word),
      });
    });

    if (fallbackUid && !resolved.some((item) => item.uid === fallbackUid)) {
      if (fallbackRequestId) {
        transaction.set(db.doc(getHistoryDictionaryRequestPath(fallbackRequestId)), {
          word: sanitizeHistoryDictionaryWord(term.word),
          normalizedWord,
          uid: fallbackUid,
          studentName: '',
          grade: '',
          class: '',
          number: '',
          memo: '알림 기록에서 복구해 처리한 요청입니다.',
          status: 'resolved',
          matchedTermId: termId,
          resolvedTermId: termId,
          resolvedBy: managerUid,
          year,
          semester,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      transaction.set(db.doc(getStudentHistoryDictionaryWordPath(fallbackUid, termId)), {
        termId,
        word: sanitizeHistoryDictionaryWord(term.word),
        normalizedWord,
        definition: sanitizeHistoryDictionaryText(term.definition, 1200),
        studentLevel: sanitizeHistoryDictionaryText(term.studentLevel, 80),
        tags: sanitizeHistoryDictionaryTags(term.tags),
        status: 'saved',
        requestId: fallbackRequestId,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      resolved.push({
        uid: fallbackUid,
        requestId: fallbackRequestId,
        word: sanitizeHistoryDictionaryWord(term.word),
      });
    }

    return {
      termId,
      normalizedWord,
      resolved,
    };
  });

  return result;
};

exports.saveHistoryDictionaryTermsBulk = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: '512MiB',
}, async (request) => {
  const manager = await assertHistoryDictionaryManager(request);
  assertYearSemester(request.data);
  const rawTerms = Array.isArray(request.data?.terms) ? request.data.terms : [];
  if (!rawTerms.length) {
    throw new HttpsError('invalid-argument', 'Terms are required.');
  }
  if (rawTerms.length > MAX_HISTORY_DICTIONARY_BULK_TERMS) {
    throw new HttpsError(
      'invalid-argument',
      `Terms must be ${MAX_HISTORY_DICTIONARY_BULK_TERMS} or fewer.`,
    );
  }

  const seenWords = new Set();
  const terms = rawTerms.map((item, index) => {
    const word = sanitizeHistoryDictionaryWord(item?.word);
    const normalizedWord = normalizeHistoryDictionaryWord(word);
    const definition = sanitizeHistoryDictionaryText(item?.definition, 1200);
    const studentLevel = sanitizeHistoryDictionaryText(item?.studentLevel || '중학생 수준', 80);
    const relatedUnitId = sanitizeHistoryDictionaryText(item?.relatedUnitId, 120);
    const tags = sanitizeHistoryDictionaryTags(item?.tags);

    if (!word || !normalizedWord) {
      throw new HttpsError('invalid-argument', `A word is required at row ${index + 1}.`);
    }
    if (!definition || definition.length < 5) {
      throw new HttpsError('invalid-argument', `Definition is too short at row ${index + 1}.`);
    }
    if (seenWords.has(normalizedWord)) {
      throw new HttpsError('invalid-argument', `Duplicate word: ${word}`);
    }
    seenWords.add(normalizedWord);

    return {
      termId: buildHistoryDictionaryTermId(normalizedWord),
      word,
      normalizedWord,
      definition,
      studentLevel,
      relatedUnitId,
      tags,
    };
  });

  const termRefs = terms.map((term) =>
    db.doc(getHistoryDictionaryTermPath(term.termId)));
  const existingSnaps = await db.getAll(...termRefs);
  const batch = db.batch();

  terms.forEach((term, index) => {
    const existing = existingSnaps[index]?.exists
      ? (existingSnaps[index].data() || {})
      : {};
    batch.set(termRefs[index], {
      word: term.word,
      normalizedWord: term.normalizedWord,
      definition: term.definition,
      studentLevel: term.studentLevel,
      relatedUnitId: term.relatedUnitId,
      tags: term.tags,
      status: 'published',
      createdBy: existing.createdBy || manager.uid,
      updatedBy: manager.uid,
      createdAt: existing.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      publishedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();

  return {
    savedCount: terms.length,
    termIds: terms.map((term) => term.termId),
  };
});

exports.saveHistoryDictionaryTerm = onCall({ region: REGION }, async (request) => {
  const manager = await assertHistoryDictionaryManager(request);
  const word = sanitizeHistoryDictionaryWord(request.data?.word);
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  const definition = sanitizeHistoryDictionaryText(request.data?.definition, 1200);
  const studentLevel = sanitizeHistoryDictionaryText(request.data?.studentLevel || '중학생 수준', 80);
  const relatedUnitId = sanitizeHistoryDictionaryText(request.data?.relatedUnitId, 120);
  const tags = sanitizeHistoryDictionaryTags(request.data?.tags);
  const fallbackRequestId = sanitizeHistoryDictionaryText(request.data?.fallbackRequestId, 120);
  const fallbackUid = sanitizeHistoryDictionaryText(request.data?.fallbackUid, 80);

  if (!word || !normalizedWord) {
    throw new HttpsError('invalid-argument', 'A word is required.');
  }
  if (!definition || definition.length < 5) {
    throw new HttpsError('invalid-argument', 'Definition is too short.');
  }

  const termId = buildHistoryDictionaryTermId(normalizedWord);
  const termRef = db.doc(getHistoryDictionaryTermPath(termId));
  await db.runTransaction(async (transaction) => {
    const termSnap = await transaction.get(termRef);
    transaction.set(termRef, {
      word,
      normalizedWord,
      definition,
      studentLevel,
      relatedUnitId,
      tags,
      status: 'published',
      createdBy: termSnap.exists ? (termSnap.data()?.createdBy || manager.uid) : manager.uid,
      updatedBy: manager.uid,
      createdAt: termSnap.exists ? (termSnap.data()?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      publishedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const scoped = getOptionalYearSemester(request.data) || await getCurrentConfiguredYearSemester();
  const resolvedResult = await resolveHistoryDictionaryRequestsWithTerm({
    managerUid: manager.uid,
    termId,
    fallbackRequestId,
    fallbackUid,
    year: scoped?.year || '',
    semester: scoped?.semester || '',
  });
  if (scoped) {
    await createUserNotifications(scoped.year, scoped.semester, resolvedResult.resolved.map((item) => item.uid), {
      type: 'history_dictionary_resolved',
      title: '역사 사전 등록 완료',
      body: `요청한 "${word}" 뜻풀이가 등록되었습니다.`,
      targetUrl: '/student/lesson/history-dictionary',
      entityType: 'history_dictionary_term',
      entityId: termId,
      actorUid: manager.uid,
      priority: 'normal',
      dedupeKey: `history_dictionary_resolved:${termId}:${Date.now()}`,
      templateValues: {
        word,
      },
    });
  }

  return {
    termId,
    resolvedCount: resolvedResult.resolved.length,
  };
});

exports.approveHistoryDictionaryTermForRequests = onCall({ region: REGION }, async (request) => {
  const manager = await assertHistoryDictionaryManager(request);
  const { year, semester } = assertYearSemester(request.data);
  const termId = sanitizeHistoryDictionaryText(request.data?.termId, 80);
  const requestId = sanitizeHistoryDictionaryText(request.data?.requestId, 100);
  if (!termId) {
    throw new HttpsError('invalid-argument', 'termId is required.');
  }

  const result = await resolveHistoryDictionaryRequestsWithTerm({
    managerUid: manager.uid,
    termId,
    requestId,
    year,
    semester,
  });

  await createUserNotifications(year, semester, result.resolved.map((item) => item.uid), {
    type: 'history_dictionary_resolved',
    title: '역사 사전 등록 완료',
    body: `"${result.resolved[0]?.word || '요청한 단어'}" 뜻풀이가 선생님 승인 후 단어장에 들어왔습니다.`,
    targetUrl: '/student/lesson/history-dictionary',
    entityType: 'history_dictionary_term',
    entityId: termId,
    actorUid: manager.uid,
    priority: 'normal',
    dedupeKey: `history_dictionary_approved:${year}:${semester}:${termId}:${requestId || 'all'}`,
    templateValues: {
      word: result.resolved[0]?.word || '요청한 단어',
    },
  });

  return {
    termId,
    resolvedCount: result.resolved.length,
  };
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

  await markWisHallOfFameDirtySafely(year, semester);
  return result;
});
