import type {
    PointPolicy,
    PointRankTierCode,
    PointWallet,
    SystemConfig,
} from '../types';
import { getPointPolicy, getPointRankManualAdjustEarnedPointsByUid, getPointWalletByUid } from './points';
import {
    getPointRankDisplayByTierCode,
    getPointRankDisplay,
    getPointRankNewlyUnlockedEmojiEntries,
    type PointRankDisplay,
    getPointRankTierPosition,
    needsPointRankLegacyFallback,
    resolvePointRankPolicy,
} from './pointRanks';
import { getYearSemester } from './semesterScope';
import { readLocalOnly, writeLocalOnly } from './safeStorage';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

const STORAGE_PREFIX = 'westory:student-rank-promotion:v1';
const SNAPSHOT_CACHE_TTL_MS = 60_000;
const pendingLoads = new Map<string, Promise<StudentRankPromotionSnapshot>>();
const snapshotCache = new Map<string, { expiresAt: number; value: StudentRankPromotionSnapshot }>();

export interface StudentRankPromotionSnapshot {
    policy: PointPolicy;
    wallet: PointWallet | null;
    rank: PointRankDisplay | null;
    manualAdjustPoints: number;
}

export interface StudentRankPromotionPreview {
    rank: PointRankDisplay | null;
    effectLevel: 'subtle' | 'standard';
    previewEmojiEntries: ReturnType<typeof getStudentRankPromotionPreviewEmojiEntries>;
    celebrationEnabled: boolean;
    targetTierCode: PointRankTierCode | null;
    previousTierCode: PointRankTierCode | null;
}

const normalizeTierCode = (value: string | null | undefined): PointRankTierCode | null => {
    const raw = String(value || '').trim();
    return /^tier_\d+$/.test(raw) ? raw as PointRankTierCode : null;
};

export const getStudentRankPromotionStorageKey = (config: ConfigLike, uid: string) => {
    const { year, semester } = getYearSemester(config);
    const normalizedUid = String(uid || '').trim();
    return `${STORAGE_PREFIX}:${year}:${semester}:${normalizedUid}`;
};

export const readStudentRankPromotionTierCode = (config: ConfigLike, uid: string) => (
    normalizeTierCode(readLocalOnly(getStudentRankPromotionStorageKey(config, uid)))
);

export const writeStudentRankPromotionTierCode = (config: ConfigLike, uid: string, tierCode: PointRankTierCode) => {
    writeLocalOnly(getStudentRankPromotionStorageKey(config, uid), tierCode);
};

export const isStudentRankPromotionEligible = (
    rankPolicy: PointPolicy['rankPolicy'] | null | undefined,
    previousTierCode: PointRankTierCode | null | undefined,
    currentTierCode: PointRankTierCode | null | undefined,
) => {
    const previousIndex = previousTierCode ? getPointRankTierPosition(rankPolicy, previousTierCode) : -1;
    const currentIndex = currentTierCode ? getPointRankTierPosition(rankPolicy, currentTierCode) : -1;
    return currentIndex > previousIndex;
};

export const getStudentRankPromotionPreviewEmojiEntries = (
    rankPolicy: PointPolicy['rankPolicy'] | null | undefined,
    previousTierCode: PointRankTierCode | null | undefined,
    currentTierCode: PointRankTierCode | null | undefined,
    limit = 4,
) => getPointRankNewlyUnlockedEmojiEntries({
    rankPolicy,
    previousTierCode: previousTierCode || undefined,
    currentTierCode: currentTierCode || undefined,
}).slice(0, Math.max(0, limit));

export const buildStudentRankPromotionPreview = (
    rankPolicy: PointPolicy['rankPolicy'] | null | undefined,
    requestedTierCode?: PointRankTierCode | null,
    requestedPreviousTierCode?: PointRankTierCode | null,
): StudentRankPromotionPreview => {
    const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
    const targetTier = resolvedPolicy.tiers.find((tier) => tier.code === requestedTierCode)
        || resolvedPolicy.tiers[1]
        || resolvedPolicy.tiers[0]
        || null;
    const effectLevel = resolvedPolicy.celebrationPolicy?.effectLevel === 'subtle'
        ? 'subtle'
        : 'standard';
    const celebrationEnabled = resolvedPolicy.celebrationPolicy?.enabled !== false;

    if (!targetTier) {
        return {
            rank: null,
            effectLevel,
            previewEmojiEntries: [],
            celebrationEnabled,
            targetTierCode: null,
            previousTierCode: null,
        };
    }

    const targetIndex = resolvedPolicy.tiers.findIndex((tier) => tier.code === targetTier.code);
    const previousTier = resolvedPolicy.tiers.find((tier) => tier.code === requestedPreviousTierCode)
        || resolvedPolicy.tiers[targetIndex - 1]
        || null;
    const previewLimit = effectLevel === 'subtle' ? 3 : 5;
    const rank = getPointRankDisplayByTierCode({
        rankPolicy: resolvedPolicy,
        tierCode: targetTier.code,
    });

    return {
        rank,
        effectLevel,
        previewEmojiEntries: getStudentRankPromotionPreviewEmojiEntries(
            resolvedPolicy,
            previousTier?.code || null,
            targetTier.code,
            previewLimit,
        ),
        celebrationEnabled,
        targetTierCode: targetTier.code,
        previousTierCode: previousTier?.code || null,
    };
};

export const invalidateStudentRankPromotionSnapshotCache = (config?: ConfigLike, uid?: string) => {
    const normalizedUid = String(uid || '').trim();
    if (!config || !normalizedUid) {
        pendingLoads.clear();
        snapshotCache.clear();
        return;
    }
    const { year, semester } = getYearSemester(config);
    const cacheKey = `${year}:${semester}:${normalizedUid}`;
    pendingLoads.delete(cacheKey);
    snapshotCache.delete(cacheKey);
};

export const loadStudentRankPromotionSnapshot = async (
    config: ConfigLike,
    uid: string,
): Promise<StudentRankPromotionSnapshot> => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) {
        throw new Error('Student uid is required.');
    }

    const { year, semester } = getYearSemester(config);
    const cacheKey = `${year}:${semester}:${normalizedUid}`;
    const cached = snapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    const pending = pendingLoads.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
        const [wallet, policy] = await Promise.all([
            getPointWalletByUid(config, normalizedUid),
            getPointPolicy(config),
        ]);

        const manualAdjustPoints = wallet && needsPointRankLegacyFallback(wallet)
            ? await getPointRankManualAdjustEarnedPointsByUid(config, normalizedUid)
            : 0;

        const rank = getPointRankDisplay({
            rankPolicy: policy.rankPolicy,
            wallet: wallet || null,
            earnedPointsFromTransactions: manualAdjustPoints,
        });

        return {
            policy,
            wallet: wallet || null,
            rank,
            manualAdjustPoints,
        };
    })();

    pendingLoads.set(cacheKey, promise);

    try {
        const value = await promise;
        snapshotCache.set(cacheKey, {
            expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS,
            value,
        });
        return value;
    } finally {
        pendingLoads.delete(cacheKey);
    }
};
