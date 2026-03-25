import type {
    PointRankEmojiPolicy,
    PointRankEmojiPolicyTiers,
    PointRankPolicyTier,
    PointRankTierCode,
} from '../types';

export interface ProfileEmojiRegistryEntry {
    id: string;
    value: string;
    label: string;
    unlockTierCode: PointRankTierCode;
}

const parseTierIndex = (tierCode: PointRankTierCode) => {
    const parsed = Number(String(tierCode || '').replace('tier_', ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const DEFAULT_PROFILE_EMOJI_ID = 'smile';

export const PROFILE_EMOJI_REGISTRY: ProfileEmojiRegistryEntry[] = [
    { id: 'smile', value: '😀', label: '웃는 얼굴', unlockTierCode: 'tier_1' },
    { id: 'soft_smile', value: '🙂', label: '미소', unlockTierCode: 'tier_1' },
    { id: 'note', value: '📝', label: '메모', unlockTierCode: 'tier_1' },
    { id: 'book', value: '📚', label: '책', unlockTierCode: 'tier_1' },
    { id: 'cool', value: '😎', label: '선글라스', unlockTierCode: 'tier_2' },
    { id: 'brain', value: '🧠', label: '두뇌', unlockTierCode: 'tier_2' },
    { id: 'clover', value: '🍀', label: '행운', unlockTierCode: 'tier_2' },
    { id: 'target', value: '🎯', label: '목표', unlockTierCode: 'tier_2' },
    { id: 'nerd', value: '🤓', label: '공부 모드', unlockTierCode: 'tier_3' },
    { id: 'trophy', value: '🏆', label: '트로피', unlockTierCode: 'tier_3' },
    { id: 'rocket', value: '🚀', label: '로켓', unlockTierCode: 'tier_3' },
    { id: 'school', value: '🏫', label: '학교', unlockTierCode: 'tier_3' },
    { id: 'sparkles', value: '🌟', label: '반짝별', unlockTierCode: 'tier_4' },
    { id: 'science', value: '🧪', label: '실험', unlockTierCode: 'tier_4' },
    { id: 'tiger', value: '🐯', label: '호랑이', unlockTierCode: 'tier_4' },
    { id: 'panda', value: '🐼', label: '판다', unlockTierCode: 'tier_4' },
    { id: 'pencil', value: '✏️', label: '연필', unlockTierCode: 'tier_5' },
    { id: 'bear', value: '🐻', label: '곰', unlockTierCode: 'tier_5' },
    { id: 'fox', value: '🦊', label: '여우', unlockTierCode: 'tier_5' },
    { id: 'dolphin', value: '🐬', label: '돌고래', unlockTierCode: 'tier_5' },
    { id: 'owl', value: '🦉', label: '부엉이', unlockTierCode: 'tier_5' },
    { id: 'whale', value: '🐳', label: '고래', unlockTierCode: 'tier_5' },
];

const PROFILE_EMOJI_BY_ID = new Map(PROFILE_EMOJI_REGISTRY.map((entry) => [entry.id, entry]));
const PROFILE_EMOJI_BY_VALUE = new Map(PROFILE_EMOJI_REGISTRY.map((entry) => [entry.value, entry]));

const normalizePreferredEmojiValues = (preferredValues: unknown) => (
    Array.isArray(preferredValues)
        ? Array.from(new Set(
            preferredValues
                .map((value) => String(value || '').trim())
                .filter(Boolean),
        ))
        : []
);

const getClampedTierCode = (requestedTierCode: PointRankTierCode, tiers: PointRankPolicyTier[]) => {
    if (tiers.length === 0) return requestedTierCode;
    const requestedIndex = parseTierIndex(requestedTierCode);
    const match = tiers
        .map((tier) => ({ tier, index: parseTierIndex(tier.code) }))
        .find(({ index }) => index >= requestedIndex);

    return match?.tier.code || tiers[tiers.length - 1].code;
};

export const getProfileEmojiRegistry = (preferredValues?: unknown) => {
    const orderedPreferredValues = normalizePreferredEmojiValues(preferredValues);
    if (orderedPreferredValues.length === 0) return PROFILE_EMOJI_REGISTRY;

    const preferredEntries = orderedPreferredValues
        .map((value) => PROFILE_EMOJI_BY_VALUE.get(value))
        .filter((entry): entry is ProfileEmojiRegistryEntry => Boolean(entry));
    const preferredIds = new Set(preferredEntries.map((entry) => entry.id));

    return [
        ...preferredEntries,
        ...PROFILE_EMOJI_REGISTRY.filter((entry) => !preferredIds.has(entry.id)),
    ];
};

export const getProfileEmojiEntryById = (emojiId: string) => PROFILE_EMOJI_BY_ID.get(String(emojiId || '').trim()) || null;

export const getProfileEmojiEntryByValue = (value: string) => PROFILE_EMOJI_BY_VALUE.get(String(value || '').trim()) || null;

export const getProfileEmojiValueById = (emojiId: string) => getProfileEmojiEntryById(emojiId)?.value || '';

export const getDefaultProfileEmojiValue = () => getProfileEmojiValueById(DEFAULT_PROFILE_EMOJI_ID) || '😀';

export const sanitizeProfileEmojiIds = (raw: unknown) => Array.from(new Set(
    Array.isArray(raw)
        ? raw
            .map((value) => String(value || '').trim())
            .filter((value) => PROFILE_EMOJI_BY_ID.has(value))
        : [],
));

export const buildDefaultPointRankEmojiPolicy = (tiers: PointRankPolicyTier[]): PointRankEmojiPolicy => {
    const tierUnlocks = tiers.reduce<PointRankEmojiPolicyTiers>((accumulator, tier) => ({
        ...accumulator,
        [tier.code]: {
            allowedEmojiIds: [],
        },
    }), {});

    PROFILE_EMOJI_REGISTRY.forEach((entry) => {
        const clampedTierCode = getClampedTierCode(entry.unlockTierCode, tiers);
        const target = tierUnlocks[clampedTierCode] || { allowedEmojiIds: [] };
        target.allowedEmojiIds = [...target.allowedEmojiIds, entry.id];
        tierUnlocks[clampedTierCode] = target;
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
