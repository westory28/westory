import type {
    PointPolicy,
    PointRankDisplay,
    PointRankTierCode,
    PointWallet,
    SystemConfig,
} from '../types';
import { getPointPolicy, getPointRankManualAdjustEarnedPointsByUid, getPointWalletByUid } from './points';
import {
    getPointRankDisplay,
    getPointRankNewlyUnlockedEmojiEntries,
    getPointRankTierPosition,
    needsPointRankLegacyFallback,
} from './pointRanks';
import { getYearSemester } from './semesterScope';
import { readLocalOnly, writeLocalOnly } from './safeStorage';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

const STORAGE_PREFIX = 'westory:student-rank-promotion:v1';
const pendingLoads = new Map<string, Promise<StudentRankPromotionSnapshot>>();

export interface StudentRankPromotionSnapshot {
    policy: PointPolicy;
    wallet: PointWallet | null;
    rank: PointRankDisplay | null;
    manualAdjustPoints: number;
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
        return await promise;
    } finally {
        pendingLoads.delete(cacheKey);
    }
};
