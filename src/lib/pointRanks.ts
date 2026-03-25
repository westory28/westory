import type {
    PointRankBasedOn,
    PointRankEmojiPolicyTier,
    PointRankPolicy,
    PointRankPolicyTier,
    PointRankThemeId,
    PointRankTierCode,
    PointTransaction,
    PointWallet,
} from '../types';
import {
    buildDefaultPointRankEmojiPolicy,
    DEFAULT_PROFILE_EMOJI_ID,
    getProfileEmojiEntryById,
    PROFILE_EMOJI_REGISTRY,
    sanitizeProfileEmojiIds,
} from './profileEmojis';

export interface PointRankThemeTierMeta {
    label: string;
    description: string;
    badgeClass: string;
}

interface PointRankThemeMeta {
    themeName: string;
    tiers: Partial<Record<PointRankTierCode, PointRankThemeTierMeta>>;
}

export interface PointRankDisplay {
    themeId: PointRankThemeId;
    themeName: string;
    tierCode: PointRankTierCode;
    label: string;
    description: string;
    badgeClass: string;
    metricValue: number;
    minPoints: number;
    nextLabel: string | null;
    nextMinPoints: number | null;
    remainingToNext: number;
    progressPercent: number;
    basedOn: PointRankBasedOn;
    enabled: boolean;
}

type PointRankInput = {
    rankPolicy?: Partial<PointRankPolicy> | null;
    wallet?: Pick<PointWallet, 'earnedTotal' | 'rankEarnedTotal'> | null;
    earnedPointsFromTransactions?: number;
};

const DEFAULT_THEME_ID: PointRankThemeId = 'korean_golpum';

const DEFAULT_TIERS: PointRankPolicyTier[] = [
    { code: 'tier_1', minPoints: 0 },
    { code: 'tier_2', minPoints: 50 },
    { code: 'tier_3', minPoints: 150 },
    { code: 'tier_4', minPoints: 300 },
    { code: 'tier_5', minPoints: 500 },
];

const FALLBACK_BADGE_CLASSES = [
    'border-stone-200 bg-stone-50 text-stone-700',
    'border-blue-200 bg-blue-50 text-blue-700',
    'border-emerald-200 bg-emerald-50 text-emerald-700',
    'border-amber-200 bg-amber-50 text-amber-700',
    'border-rose-200 bg-rose-50 text-rose-700',
];

export const POINT_RANK_THEME_MAP: Record<PointRankThemeId, PointRankThemeMeta> = {
    korean_golpum: {
        themeName: '골품제',
        tiers: {
            tier_1: {
                label: '4두품',
                description: '누적 획득 포인트 성장을 막 시작한 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[0],
            },
            tier_2: {
                label: '5두품',
                description: '꾸준히 포인트를 쌓아 가는 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[1],
            },
            tier_3: {
                label: '6두품',
                description: '학습 활동 누적이 눈에 띄게 쌓인 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[2],
            },
            tier_4: {
                label: '진골',
                description: '높은 누적 포인트를 달성한 상위 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[3],
            },
            tier_5: {
                label: '성골',
                description: '가장 높은 누적 포인트 등급입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[4],
            },
        },
    },
    world_nobility: {
        themeName: '유럽 작위',
        tiers: {
            tier_1: {
                label: '남작',
                description: '누적 획득 포인트 성장을 막 시작한 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[0],
            },
            tier_2: {
                label: '자작',
                description: '꾸준히 포인트를 쌓아 가는 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[1],
            },
            tier_3: {
                label: '백작',
                description: '학습 활동 누적이 눈에 띄게 쌓인 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[2],
            },
            tier_4: {
                label: '후작',
                description: '높은 누적 포인트를 달성한 상위 단계입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[3],
            },
            tier_5: {
                label: '공작',
                description: '가장 높은 누적 포인트 등급입니다.',
                badgeClass: FALLBACK_BADGE_CLASSES[4],
            },
        },
    },
};

export const parsePointRankTierIndex = (tierCode: PointRankTierCode) => {
    const parsed = Number(String(tierCode).replace('tier_', ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const getFallbackBadgeClass = (tierCode: PointRankTierCode) => (
    FALLBACK_BADGE_CLASSES[(parsePointRankTierIndex(tierCode) - 1) % FALLBACK_BADGE_CLASSES.length]
);

const normalizeTierCode = (value: unknown, index: number): PointRankTierCode => {
    const raw = String(value || '').trim();
    if (/^tier_\d+$/.test(raw)) return raw as PointRankTierCode;
    return `tier_${index + 1}` as PointRankTierCode;
};

const normalizeTier = (
    tier: (Partial<PointRankPolicyTier> & { threshold?: unknown }) | null | undefined,
    index: number,
): PointRankPolicyTier => ({
    code: normalizeTierCode(tier?.code, index),
    minPoints: Math.max(0, Number(tier?.minPoints ?? tier?.threshold ?? 0)),
});

const isValidBasedOn = (value: unknown): value is PointRankBasedOn => (
    value === 'earnedTotal'
    || value === 'earnedTotal_plus_positive_manual_adjust'
);

const normalizeEmojiTier = (
    rawTier: Partial<PointRankEmojiPolicyTier> | null | undefined,
    fallbackAllowedEmojiIds: string[],
): PointRankEmojiPolicyTier => {
    const allowedEmojiIds = sanitizeProfileEmojiIds(rawTier?.allowedEmojiIds);
    return {
        allowedEmojiIds: allowedEmojiIds.length > 0
            ? allowedEmojiIds
            : [...fallbackAllowedEmojiIds],
    };
};

const buildResolvedEmojiPolicy = (rankPolicy: Partial<PointRankPolicy> | null | undefined, tiers: PointRankPolicyTier[]) => {
    const defaultEmojiPolicy = buildDefaultPointRankEmojiPolicy(tiers);
    const resolvedTiers = tiers.reduce<PointRankPolicy['emojiPolicy']['tiers']>((accumulator, tier) => {
        accumulator[tier.code] = normalizeEmojiTier(
            rankPolicy?.emojiPolicy?.tiers?.[tier.code],
            defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || [],
        );
        return accumulator;
    }, {});

    const firstTierCode = tiers[0]?.code;
    const defaultEmojiId = getProfileEmojiEntryById(rankPolicy?.emojiPolicy?.defaultEmojiId || '')
        ? String(rankPolicy?.emojiPolicy?.defaultEmojiId || '').trim()
        : defaultEmojiPolicy.defaultEmojiId || DEFAULT_PROFILE_EMOJI_ID;

    if (firstTierCode) {
        const firstTier = resolvedTiers[firstTierCode] || { allowedEmojiIds: [] };
        resolvedTiers[firstTierCode] = {
            allowedEmojiIds: Array.from(new Set([defaultEmojiId, ...firstTier.allowedEmojiIds])),
        };
    }

    return {
        enabled: rankPolicy?.emojiPolicy?.enabled !== false,
        defaultEmojiId,
        tiers: resolvedTiers,
    };
};

export const DEFAULT_POINT_RANK_POLICY: PointRankPolicy = {
    enabled: true,
    themeId: DEFAULT_THEME_ID,
    basedOn: 'earnedTotal_plus_positive_manual_adjust',
    tiers: DEFAULT_TIERS.map((tier) => ({ ...tier })),
    emojiPolicy: buildDefaultPointRankEmojiPolicy(DEFAULT_TIERS),
};

export const resolvePointRankPolicy = (rankPolicy?: Partial<PointRankPolicy> | null): PointRankPolicy => {
    const tiers = Array.isArray(rankPolicy?.tiers)
        ? rankPolicy.tiers.map((tier, index) => normalizeTier(tier, index)).sort((a, b) => a.minPoints - b.minPoints)
        : DEFAULT_POINT_RANK_POLICY.tiers.map((tier) => ({ ...tier }));
    const normalizedTiers = tiers.length > 0 ? tiers : DEFAULT_POINT_RANK_POLICY.tiers.map((tier) => ({ ...tier }));

    return {
        enabled: rankPolicy?.enabled !== false,
        themeId: rankPolicy?.themeId === 'world_nobility' ? 'world_nobility' : DEFAULT_THEME_ID,
        basedOn: isValidBasedOn(rankPolicy?.basedOn) ? rankPolicy.basedOn : DEFAULT_POINT_RANK_POLICY.basedOn,
        tiers: normalizedTiers,
        emojiPolicy: buildResolvedEmojiPolicy(rankPolicy, normalizedTiers),
    };
};

export const getPointRankTierMeta = (themeId: PointRankThemeId, tierCode: PointRankTierCode): PointRankThemeTierMeta => {
    const theme = POINT_RANK_THEME_MAP[themeId] || POINT_RANK_THEME_MAP[DEFAULT_THEME_ID];
    const tier = theme.tiers[tierCode];
    if (tier) return tier;

    const tierIndex = parsePointRankTierIndex(tierCode);
    return {
        label: `${theme.themeName} ${tierIndex}단계`,
        description: '누적 획득 포인트를 기준으로 계산한 등급입니다.',
        badgeClass: getFallbackBadgeClass(tierCode),
    };
};

export const isPointRankEarnTransaction = (transaction: Pick<PointTransaction, 'type' | 'delta'>) => (
    ['attendance', 'attendance_monthly_bonus', 'quiz', 'lesson', 'manual_adjust'].includes(transaction.type)
    && Number(transaction.delta || 0) > 0
);

export const sumPointRankEarnedPoints = (
    transactions: Array<Pick<PointTransaction, 'type' | 'delta'>>,
) => transactions.reduce((total, transaction) => (
    isPointRankEarnTransaction(transaction)
        ? total + Number(transaction.delta || 0)
        : total
), 0);

export const buildPointRankEarnedPointsByUid = (
    transactions: Array<Pick<PointTransaction, 'uid' | 'type' | 'delta'>>,
) => transactions.reduce<Record<string, number>>((accumulator, transaction) => {
    const uid = String(transaction.uid || '').trim();
    if (!uid || !isPointRankEarnTransaction(transaction)) return accumulator;
    accumulator[uid] = Number(accumulator[uid] || 0) + Number(transaction.delta || 0);
    return accumulator;
}, {});

export const hasPointRankEarnedTotalSnapshot = (
    wallet?: Pick<PointWallet, 'rankEarnedTotal'> | null,
) => Number.isFinite(Number(wallet?.rankEarnedTotal));

export const needsPointRankLegacyFallback = (
    wallet?: Pick<PointWallet, 'rankEarnedTotal'> | null,
) => !hasPointRankEarnedTotalSnapshot(wallet);

const getStoredRankEarnedTotal = (wallet?: Pick<PointWallet, 'rankEarnedTotal'> | null) => (
    hasPointRankEarnedTotalSnapshot(wallet)
        ? Math.max(0, Number(wallet?.rankEarnedTotal || 0))
        : null
);

const getPointRankMetricValue = ({ wallet, rankPolicy, earnedPointsFromTransactions = 0 }: PointRankInput) => {
    const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
    const storedRankEarnedTotal = getStoredRankEarnedTotal(wallet);
    if (storedRankEarnedTotal !== null) {
        return storedRankEarnedTotal;
    }
    if (resolvedPolicy.basedOn === 'earnedTotal') {
        return Math.max(0, Number(wallet?.earnedTotal || 0));
    }
    return Math.max(0, Number(wallet?.earnedTotal || 0) + Number(earnedPointsFromTransactions || 0));
};

export const getPointRankAllowedEmojiIds = (
    rankPolicy?: Partial<PointRankPolicy> | null,
    currentTierCode?: PointRankTierCode | null,
) => {
    const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
    if (!resolvedPolicy.emojiPolicy.enabled) {
        return PROFILE_EMOJI_REGISTRY.map((entry) => entry.id);
    }

    const targetTierCode = currentTierCode || resolvedPolicy.tiers[0]?.code || 'tier_1';
    const targetTierIndex = parsePointRankTierIndex(targetTierCode);
    const allowedEmojiIds = resolvedPolicy.tiers.reduce<string[]>((accumulator, tier) => {
        if (parsePointRankTierIndex(tier.code) > targetTierIndex) return accumulator;
        return [
            ...accumulator,
            ...(resolvedPolicy.emojiPolicy.tiers[tier.code]?.allowedEmojiIds || []),
        ];
    }, []);
    const uniqueAllowedEmojiIds = Array.from(new Set(
        allowedEmojiIds.filter((emojiId) => Boolean(getProfileEmojiEntryById(emojiId))),
    ));

    return uniqueAllowedEmojiIds.length > 0
        ? uniqueAllowedEmojiIds
        : [resolvedPolicy.emojiPolicy.defaultEmojiId];
};

export const getPointRankUnlockTierCodeForEmoji = (
    rankPolicy: Partial<PointRankPolicy> | null | undefined,
    emojiId: string,
) => {
    const normalizedEmojiId = String(emojiId || '').trim();
    if (!normalizedEmojiId) return null;

    const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
    const match = resolvedPolicy.tiers.find((tier) => (
        (resolvedPolicy.emojiPolicy.tiers[tier.code]?.allowedEmojiIds || []).includes(normalizedEmojiId)
    ));
    if (match) return match.code;

    if (normalizedEmojiId === resolvedPolicy.emojiPolicy.defaultEmojiId) {
        return resolvedPolicy.tiers[0]?.code || 'tier_1';
    }

    return null;
};

export const isPointRankEmojiUnlocked = ({
    rankPolicy,
    currentTierCode,
    emojiId,
}: {
    rankPolicy?: Partial<PointRankPolicy> | null;
    currentTierCode?: PointRankTierCode | null;
    emojiId: string;
}) => getPointRankAllowedEmojiIds(rankPolicy, currentTierCode).includes(String(emojiId || '').trim());

export const getPointRankDisplay = ({
    rankPolicy,
    wallet,
    earnedPointsFromTransactions = 0,
}: PointRankInput): PointRankDisplay | null => {
    const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
    if (!resolvedPolicy.enabled) return null;

    const metricValue = getPointRankMetricValue({ wallet, rankPolicy: resolvedPolicy, earnedPointsFromTransactions });
    let activeTier = resolvedPolicy.tiers[0];
    let nextTier: PointRankPolicyTier | null = null;

    resolvedPolicy.tiers.forEach((tier, index) => {
        if (metricValue >= tier.minPoints) {
            activeTier = tier;
            nextTier = resolvedPolicy.tiers[index + 1] || null;
        }
    });

    if (!nextTier) {
        nextTier = resolvedPolicy.tiers.find((tier) => tier.minPoints > metricValue) || null;
    }

    const theme = POINT_RANK_THEME_MAP[resolvedPolicy.themeId] || POINT_RANK_THEME_MAP[DEFAULT_THEME_ID];
    const tierMeta = getPointRankTierMeta(resolvedPolicy.themeId, activeTier.code);
    const nextTierMeta = nextTier ? getPointRankTierMeta(resolvedPolicy.themeId, nextTier.code) : null;
    const remainingToNext = nextTier ? Math.max(0, nextTier.minPoints - metricValue) : 0;
    const progressPercent = nextTier
        ? Math.min(
            100,
            Math.max(
                0,
                ((metricValue - activeTier.minPoints) / Math.max(nextTier.minPoints - activeTier.minPoints, 1)) * 100,
            ),
        )
        : 100;

    return {
        themeId: resolvedPolicy.themeId,
        themeName: theme.themeName,
        tierCode: activeTier.code,
        label: tierMeta.label,
        description: tierMeta.description,
        badgeClass: tierMeta.badgeClass,
        metricValue,
        minPoints: activeTier.minPoints,
        nextLabel: nextTierMeta?.label || null,
        nextMinPoints: nextTier?.minPoints ?? null,
        remainingToNext,
        progressPercent,
        basedOn: resolvedPolicy.basedOn,
        enabled: resolvedPolicy.enabled,
    };
};
