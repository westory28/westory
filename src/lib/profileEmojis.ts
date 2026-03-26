import type {
    PointRankEmojiPolicy,
    PointRankEmojiPolicyTiers,
    PointRankEmojiRegistryEntry,
    PointRankPolicyTier,
    PointRankTierCode,
} from '../types';

const parseTierIndex = (tierCode: PointRankTierCode) => {
    const parsed = Number(String(tierCode || '').replace('tier_', ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeEmojiText = (value: unknown) => String(value || '').trim();

export const normalizeProfileEmojiValue = (value: unknown) => (
    normalizeEmojiText(value).normalize('NFC')
);

const normalizeTierCode = (value: unknown): PointRankTierCode | null => {
    const raw = String(value || '').trim();
    return /^tier_\d+$/.test(raw) ? raw as PointRankTierCode : null;
};

const buildEmojiValueAlias = (entry: Omit<PointRankEmojiRegistryEntry, 'value'>): PointRankEmojiRegistryEntry => ({
    ...entry,
    value: entry.emoji,
});

const DEFAULT_PROFILE_EMOJI_REGISTRY_BASE: Array<Omit<PointRankEmojiRegistryEntry, 'value'>> = [
    { id: 'smile', emoji: '😀', label: '웃는 얼굴', category: '기본', sortOrder: 10, enabled: true, unlockTierCode: 'tier_1' },
    { id: 'soft_smile', emoji: '🙂', label: '미소', category: '기본', sortOrder: 20, enabled: true, unlockTierCode: 'tier_1' },
    { id: 'note', emoji: '📝', label: '메모', category: '학습', sortOrder: 30, enabled: true, unlockTierCode: 'tier_1' },
    { id: 'book', emoji: '📚', label: '책', category: '학습', sortOrder: 40, enabled: true, unlockTierCode: 'tier_1' },
    { id: 'cool', emoji: '😎', label: '선글라스', category: '표정', sortOrder: 50, enabled: true, unlockTierCode: 'tier_2' },
    { id: 'brain', emoji: '🧠', label: '두뇌', category: '학습', sortOrder: 60, enabled: true, unlockTierCode: 'tier_2' },
    { id: 'clover', emoji: '🍀', label: '행운', category: '자연', sortOrder: 70, enabled: true, unlockTierCode: 'tier_2' },
    { id: 'target', emoji: '🎯', label: '목표', category: '학습', sortOrder: 80, enabled: true, unlockTierCode: 'tier_2' },
    { id: 'nerd', emoji: '🤓', label: '공부 모드', category: '표정', sortOrder: 90, enabled: true, unlockTierCode: 'tier_3' },
    { id: 'trophy', emoji: '🏆', label: '트로피', category: '성취', sortOrder: 100, enabled: true, unlockTierCode: 'tier_3' },
    { id: 'rocket', emoji: '🚀', label: '로켓', category: '성취', sortOrder: 110, enabled: true, unlockTierCode: 'tier_3' },
    { id: 'school', emoji: '🏫', label: '학교', category: '학습', sortOrder: 120, enabled: true, unlockTierCode: 'tier_3' },
    { id: 'sparkles', emoji: '🌟', label: '반짝별', category: '반짝임', sortOrder: 130, enabled: true, unlockTierCode: 'tier_4' },
    { id: 'science', emoji: '🧪', label: '실험', category: '학습', sortOrder: 140, enabled: true, unlockTierCode: 'tier_4' },
    { id: 'tiger', emoji: '🐯', label: '호랑이', category: '동물', sortOrder: 150, enabled: true, unlockTierCode: 'tier_4' },
    { id: 'panda', emoji: '🐼', label: '판다', category: '동물', sortOrder: 160, enabled: true, unlockTierCode: 'tier_4' },
    { id: 'pencil', emoji: '✏️', label: '연필', category: '학습', sortOrder: 170, enabled: true, unlockTierCode: 'tier_5' },
    { id: 'bear', emoji: '🐻', label: '곰', category: '동물', sortOrder: 180, enabled: true, unlockTierCode: 'tier_5' },
    { id: 'fox', emoji: '🦊', label: '여우', category: '동물', sortOrder: 190, enabled: true, unlockTierCode: 'tier_5' },
    { id: 'dolphin', emoji: '🐬', label: '돌고래', category: '동물', sortOrder: 200, enabled: true, unlockTierCode: 'tier_5' },
    { id: 'owl', emoji: '🦉', label: '부엉이', category: '동물', sortOrder: 210, enabled: true, unlockTierCode: 'tier_5' },
    { id: 'whale', emoji: '🐳', label: '고래', category: '동물', sortOrder: 220, enabled: true, unlockTierCode: 'tier_5' },
];

export const DEFAULT_PROFILE_EMOJI_ID = 'smile';

export const DEFAULT_PROFILE_EMOJI_REGISTRY: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY_BASE.map(buildEmojiValueAlias);

export const PROFILE_EMOJI_REGISTRY = DEFAULT_PROFILE_EMOJI_REGISTRY;

const sortRegistry = (entries: PointRankEmojiRegistryEntry[]) => (
    [...entries].sort((a, b) => {
        const sortGap = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (sortGap !== 0) return sortGap;
        return String(a.label || '').localeCompare(String(b.label || ''), 'ko');
    })
);

const slugifyEmojiId = (value: string, fallbackIndex: number) => {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return slug || `emoji_${fallbackIndex + 1}`;
};

const ensureUniqueId = (candidateId: string, usedIds: Set<string>, fallbackIndex: number) => {
    const baseId = slugifyEmojiId(candidateId, fallbackIndex);
    let nextId = baseId;
    let suffix = 2;
    while (usedIds.has(nextId)) {
        nextId = `${baseId}_${suffix}`;
        suffix += 1;
    }
    usedIds.add(nextId);
    return nextId;
};

const normalizeLegacyValues = (rawLegacyValues: unknown, currentEmoji: string, rawValue: string) => Array.from(new Set(
    [
        ...(
            Array.isArray(rawLegacyValues)
                ? rawLegacyValues.map((value) => normalizeEmojiText(value)).filter(Boolean)
                : []
        ),
        rawValue && rawValue !== currentEmoji ? rawValue : '',
    ].filter(Boolean),
));

const getDefaultRegistryEntry = (index: number) => DEFAULT_PROFILE_EMOJI_REGISTRY[index] || null;

const normalizeRegistryEntry = (
    rawEntry: Partial<PointRankEmojiRegistryEntry> | null | undefined,
    index: number,
    usedIds: Set<string>,
): PointRankEmojiRegistryEntry | null => {
    const fallbackEntry = getDefaultRegistryEntry(index);
    const emoji = normalizeEmojiText(rawEntry?.emoji ?? rawEntry?.value ?? fallbackEntry?.emoji);
    if (!emoji) return null;

    const rawValue = normalizeEmojiText(rawEntry?.value);
    const label = String(rawEntry?.label || fallbackEntry?.label || `이모지 ${index + 1}`).trim();
    const category = String(rawEntry?.category || fallbackEntry?.category || '기타').trim() || '기타';
    const sortOrder = Number.isFinite(Number(rawEntry?.sortOrder))
        ? Number(rawEntry?.sortOrder)
        : Number(fallbackEntry?.sortOrder || (index + 1) * 10);
    const unlockTierCode = normalizeTierCode(rawEntry?.unlockTierCode) || fallbackEntry?.unlockTierCode;

    return buildEmojiValueAlias({
        id: ensureUniqueId(String(rawEntry?.id || fallbackEntry?.id || label || emoji), usedIds, index),
        emoji,
        label,
        category,
        sortOrder,
        enabled: rawEntry?.enabled !== false,
        legacyValues: normalizeLegacyValues(rawEntry?.legacyValues, emoji, rawValue),
        ...(unlockTierCode ? { unlockTierCode } : {}),
    });
};

const buildEmojiMaps = (registry: PointRankEmojiRegistryEntry[]) => {
    const byId = new Map<string, PointRankEmojiRegistryEntry>();
    const byValue = new Map<string, PointRankEmojiRegistryEntry>();

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

    return {
        byId,
        byValue,
    };
};

export const resolveProfileEmojiRegistry = (
    rawRegistry?: unknown,
    options?: { sort?: boolean },
) => {
    const fallbackRegistry = DEFAULT_PROFILE_EMOJI_REGISTRY.map((entry) => ({
        ...entry,
        legacyValues: [...(entry.legacyValues || [])],
    }));
    if (!Array.isArray(rawRegistry)) {
        return options?.sort === false ? fallbackRegistry : sortRegistry(fallbackRegistry);
    }

    const usedIds = new Set<string>();
    const entries = rawRegistry
        .map((entry, index) => normalizeRegistryEntry(entry as Partial<PointRankEmojiRegistryEntry>, index, usedIds))
        .filter((entry): entry is PointRankEmojiRegistryEntry => Boolean(entry));

    if (entries.length === 0) {
        return options?.sort === false ? fallbackRegistry : sortRegistry(fallbackRegistry);
    }

    return options?.sort === false ? entries : sortRegistry(entries);
};

const getEnabledRegistryEntries = (registry: PointRankEmojiRegistryEntry[]) => registry.filter((entry) => entry.enabled !== false);

const normalizePreferredEmojiValues = (preferredValues: unknown) => (
    Array.isArray(preferredValues)
        ? Array.from(new Set(
            preferredValues
                .map((value) => normalizeEmojiText(value))
                .filter(Boolean),
        ))
        : []
);

export const getProfileEmojiRegistry = (
    preferredValues?: unknown,
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
    options?: { includeDisabled?: boolean },
) => {
    const targetRegistry = options?.includeDisabled ? [...registry] : getEnabledRegistryEntries(registry);
    const orderedRegistry = sortRegistry(targetRegistry);
    const preferredEntries = normalizePreferredEmojiValues(preferredValues)
        .map((value) => getProfileEmojiEntryByValue(value, orderedRegistry))
        .filter((entry): entry is PointRankEmojiRegistryEntry => Boolean(entry));
    const preferredIds = new Set(preferredEntries.map((entry) => entry.id));

    return [
        ...preferredEntries,
        ...orderedRegistry.filter((entry) => !preferredIds.has(entry.id)),
    ];
};

export const getProfileEmojiEntryById = (
    emojiId: string,
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
) => buildEmojiMaps(registry).byId.get(String(emojiId || '').trim()) || null;

export const getProfileEmojiEntryByValue = (
    value: string,
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
) => buildEmojiMaps(registry).byValue.get(normalizeEmojiText(value)) || null;

export const getProfileEmojiValueById = (
    emojiId: string,
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
) => getProfileEmojiEntryById(emojiId, registry)?.emoji || '';

export const findDuplicateProfileEmojiEntry = (
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
    emoji: string,
    options?: { excludeId?: string | null },
) => {
    const normalizedEmoji = normalizeProfileEmojiValue(emoji);
    if (!normalizedEmoji) return null;
    const excludedId = String(options?.excludeId || '').trim();

    return registry.find((entry) => (
        entry.id !== excludedId
        && normalizeProfileEmojiValue(entry.emoji) === normalizedEmoji
    )) || null;
};

export const getDefaultProfileEmojiValue = (registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY) => {
    const defaultEntry = getProfileEmojiEntryById(DEFAULT_PROFILE_EMOJI_ID, registry)
        || getEnabledRegistryEntries(registry)[0]
        || registry[0];
    return defaultEntry?.emoji || '😀';
};

export const sanitizeProfileEmojiIds = (
    raw: unknown,
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
) => {
    const { byId } = buildEmojiMaps(registry);
    return Array.from(new Set(
        Array.isArray(raw)
            ? raw
                .map((value) => String(value || '').trim())
                .filter((value) => {
                    const entry = byId.get(value);
                    return Boolean(entry && entry.enabled !== false);
                })
            : [],
    ));
};

const getClampedTierCode = (requestedTierCode: PointRankTierCode, tiers: PointRankPolicyTier[]) => {
    if (tiers.length === 0) return requestedTierCode;
    const requestedIndex = parseTierIndex(requestedTierCode);
    const match = tiers
        .map((tier) => ({ tier, index: parseTierIndex(tier.code) }))
        .find(({ index }) => index >= requestedIndex);

    return match?.tier.code || tiers[tiers.length - 1].code;
};

export const buildDefaultPointRankEmojiPolicy = (
    tiers: PointRankPolicyTier[],
    registry: PointRankEmojiRegistryEntry[] = DEFAULT_PROFILE_EMOJI_REGISTRY,
): PointRankEmojiPolicy => {
    const enabledRegistry = getEnabledRegistryEntries(registry);
    const tierUnlocks = tiers.reduce<PointRankEmojiPolicyTiers>((accumulator, tier) => ({
        ...accumulator,
        [tier.code]: {
            allowedEmojiIds: [],
        },
    }), {});

    enabledRegistry.forEach((entry) => {
        const requestedTierCode = normalizeTierCode(entry.unlockTierCode) || tiers[0]?.code || 'tier_1';
        const clampedTierCode = getClampedTierCode(requestedTierCode, tiers);
        const target = tierUnlocks[clampedTierCode] || { allowedEmojiIds: [] };
        target.allowedEmojiIds = [...target.allowedEmojiIds, entry.id];
        tierUnlocks[clampedTierCode] = target;
    });

    const firstTierCode = tiers[0]?.code;
    const defaultEmojiId = getProfileEmojiEntryById(DEFAULT_PROFILE_EMOJI_ID, enabledRegistry)?.id
        || enabledRegistry[0]?.id
        || DEFAULT_PROFILE_EMOJI_ID;
    if (firstTierCode) {
        const firstTier = tierUnlocks[firstTierCode] || { allowedEmojiIds: [] };
        if (!firstTier.allowedEmojiIds.includes(defaultEmojiId)) {
            firstTier.allowedEmojiIds = [defaultEmojiId, ...firstTier.allowedEmojiIds];
        }
        tierUnlocks[firstTierCode] = {
            allowedEmojiIds: Array.from(new Set(firstTier.allowedEmojiIds)),
        };
    }

    return {
        enabled: true,
        defaultEmojiId,
        legacyMode: 'keep_selected',
        tiers: tierUnlocks,
    };
};
