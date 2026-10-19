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

const getAllowedEmojiIdsForTier = (rankPolicy, currentTierCode) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  // Display flags never expand the student's current tier permissions.
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

const getCurrentTierCodeForRankTotal = (rankEarnedTotal, rankPolicy) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  const metricValue = Number.isSafeInteger(rankEarnedTotal) && rankEarnedTotal >= 0 ? rankEarnedTotal : 0;
  let activeTier = resolvedRankPolicy.tiers[0] || { code: 'tier_1' };
  resolvedRankPolicy.tiers.forEach((tier) => {
    if (metricValue >= Number(tier.minPoints || 0)) activeTier = tier;
  });
  return activeTier.code;
};

// A stored ID is authoritative. Raw icons can only identify legacy profiles
// with no ID, and never grant a tier unlock or override the registry glyph.
const resolveStudentProfileEmoji = ({ profileEmojiId, profileIcon, rankEarnedTotal, rankPolicy }) => {
  const policy = resolveRankPolicy(rankPolicy);
  const tierCode = getCurrentTierCodeForRankTotal(rankEarnedTotal, policy);
  const allowedIds = new Set(getAllowedEmojiIdsForTier(policy, tierCode));
  const defaultEntry = getProfileEmojiEntryById(policy.emojiPolicy.defaultEmojiId, policy.emojiRegistry);
  const fallbackEntry = defaultEntry && defaultEntry.enabled !== false
    ? defaultEntry : PROFILE_EMOJI_REGISTRY[0];
  const fallback = (reason) => ({
    profileEmojiId: fallbackEntry.id, profileIcon: fallbackEntry.emoji,
    tierCode, isValid: false, reason,
  });
  const hasStoredId = profileEmojiId !== undefined && profileEmojiId !== null && profileEmojiId !== '';
  const hasStoredIcon = profileIcon !== undefined && profileIcon !== null && profileIcon !== '';
  const storedId = typeof profileEmojiId === 'string' ? profileEmojiId.trim() : '';
  const storedIcon = typeof profileIcon === 'string' ? profileIcon.trim() : '';
  const entry = hasStoredId
    ? getProfileEmojiEntryById(storedId, policy.emojiRegistry)
    : buildEmojiMaps(policy.emojiRegistry).byValue.get(storedIcon);
  if (!entry) return fallback(hasStoredId ? 'unknown_id' : 'unknown_icon');
  if (entry.enabled === false) return fallback('disabled');
  if (!allowedIds.has(entry.id)) return fallback('tier_locked');
  if (hasStoredId && hasStoredIcon && storedIcon !== entry.emoji) return fallback('id_icon_mismatch');
  return {
    profileEmojiId: entry.id, profileIcon: entry.emoji,
    tierCode, isValid: true, reason: hasStoredId ? 'allowed' : 'legacy_icon',
  };
};

module.exports = {
  DEFAULT_POINT_RANK_TIERS, DEFAULT_PROFILE_EMOJI_ID, PROFILE_EMOJI_REGISTRY,
  resolveRankPolicy, getProfileEmojiEntryById, getAllowedEmojiIdsForTier,
  getCurrentTierCodeForRankTotal, resolveStudentProfileEmoji,
};
