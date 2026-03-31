import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import {
    buildPointRankPolicySavePayload,
    buildPointRankEarnedPointsByUid,
    DEFAULT_POINT_RANK_POLICY,
    resolvePointRankPolicy,
    sumPointRankEarnedPoints,
} from './pointRanks';
import { getYearSemester } from './semesterScope';
import type {
    PointOrder,
    PointOrderStatus,
    PointPolicy,
    PointProduct,
    PointStudentTarget,
    PointTransaction,
    PointTransactionType,
    PointWallet,
    SystemConfig,
} from '../types';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;
type PointActivityRewardType = Extract<
    PointTransactionType,
    'attendance' | 'quiz' | 'lesson' | 'think_cloud' | 'map_tag' | 'history_classroom'
>;

interface ActorInfo {
    uid: string;
    name?: string;
}

interface AdjustPointsInput {
    config: ConfigLike;
    uid: string;
    delta: number;
    sourceId?: string;
    sourceLabel?: string;
    policyId?: string;
    mode?: 'grant' | 'reclaim';
    actor: ActorInfo;
}

interface ReviewPointOrderInput {
    config: ConfigLike;
    orderId: string;
    nextStatus: Extract<PointOrderStatus, 'approved' | 'rejected' | 'fulfilled' | 'cancelled'>;
    actor: ActorInfo;
    memo?: string;
}

interface ClaimPointActivityInput {
    config: ConfigLike;
    activityType: PointActivityRewardType;
    sourceId: string;
    sourceLabel?: string;
    score?: number | null;
}

export interface PointActivityRewardResult {
    awarded: boolean;
    duplicate: boolean;
    amount: number;
    bonusAwarded?: boolean;
    bonusAmount?: number;
    bonusType?: Extract<
        PointTransactionType,
        'attendance_monthly_bonus' | 'attendance_milestone_bonus' | 'quiz_bonus' | 'history_classroom_bonus'
    > | '';
    monthlyBonusAwarded?: boolean;
    monthlyBonusAmount?: number;
    totalAwarded?: number;
    targetMonth?: string;
    balance: number;
    transactionId: string;
    sourceId: string;
    policyId: string;
    blockedReason?: 'duplicate_source' | 'cooldown_active' | 'max_claims_reached' | '';
    blockedMessage?: string;
    nextEligibleAt?: string;
    claimCount?: number;
    maxClaims?: number;
}

export interface ResolvedPointActivityRewardItem {
    type: PointTransactionType;
    amount: number;
    sourceId: string;
    sourceLabel: string;
    targetMonth?: string;
    targetDate?: string;
}

export interface ResolvedPointActivityReward {
    activityType: PointActivityRewardType;
    baseAmount: number;
    bonusAmount: number;
    totalAmount: number;
    items: ResolvedPointActivityRewardItem[];
}

interface SecurePurchaseRequestInput {
    config: ConfigLike;
    productId: string;
    memo?: string;
    requestKey: string;
}

interface UpdatePointAdjustmentInput {
    config: ConfigLike;
    transactionId: string;
    action: 'update' | 'cancel';
    nextDelta?: number;
}

interface UpdateStudentProfileIconInput {
    config: ConfigLike;
    emojiId: string;
}

interface SchoolOption {
    value: string;
    label: string;
}

const toFiniteNumber = (value: unknown, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const toNonNegativeNumber = (value: unknown, fallback = 0) => (
    Math.max(0, toFiniteNumber(value, fallback))
);

const toPositiveThreshold = (value: unknown, fallback = 100) => (
    Math.max(0, Math.round(toFiniteNumber(value, fallback)))
);

const toPositiveInteger = (value: unknown, fallback = 1) => (
    Math.max(1, Math.round(toFiniteNumber(value, fallback)))
);

const toNonNegativeInteger = (value: unknown, fallback = 0) => (
    Math.max(0, Math.round(toFiniteNumber(value, fallback)))
);

const resolveAutoRewardEnabled = (policy?: Partial<PointPolicy> | null) => {
    const nestedRewardPolicy = (policy as any)?.rewardPolicy || {};
    return nestedRewardPolicy?.autoEnabled ?? (policy as any)?.autoRewardEnabled;
};

const resolveQuizBonusInput = (policy?: Partial<PointPolicy> | null) => {
    const nestedRewardPolicy = (policy as any)?.rewardPolicy || {};
    const legacyBonus = (policy as any)?.quizBonus || (policy as any)?.quizPerfectBonus || {};
    const nestedBonus = nestedRewardPolicy?.quizBonus || legacyBonus || {};

    return {
        enabled: (policy as any)?.quizBonusEnabled ?? (policy as any)?.quizPerfectBonusEnabled ?? nestedBonus?.enabled,
        threshold: (policy as any)?.quizBonusThreshold ?? (policy as any)?.quizPerfectBonusThreshold ?? nestedBonus?.thresholdScore ?? nestedBonus?.threshold,
        amount: (policy as any)?.quizBonusAmount ?? (policy as any)?.quizPerfectBonusAmount ?? nestedBonus?.amount,
    };
};

export const getDefaultPointPolicy = (): PointPolicy => ({
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
    rankPolicy: resolvePointRankPolicy(DEFAULT_POINT_RANK_POLICY),
    updatedBy: '',
});

const DEFAULT_POINT_POLICY = getDefaultPointPolicy();

export const normalizePointPolicy = (policy?: Partial<PointPolicy> | null): PointPolicy => {
    const defaults = getDefaultPointPolicy();
    const quizBonus = resolveQuizBonusInput(policy);
    const autoRewardEnabled = resolveAutoRewardEnabled(policy) !== false;
    const controlPolicy = (policy as any)?.controlPolicy || {};
    const rewardPolicy = (policy as any)?.rewardPolicy || {};
    const manualAdjustEnabled = (controlPolicy?.manualAdjustEnabled ?? policy?.manualAdjustEnabled) === true;
    const allowNegativeBalance = (controlPolicy?.allowNegativeBalance ?? policy?.allowNegativeBalance) === true;
    const thinkCloudRule = rewardPolicy?.thinkCloud || {};
    const mapTagRule = rewardPolicy?.mapTag || {};
    const historyClassroomRule = rewardPolicy?.historyClassroom || {};
    const historyClassroomBonusRule = rewardPolicy?.historyClassroomBonus || {};
    const attendanceMilestoneBonusRule = rewardPolicy?.attendanceMilestoneBonus || {};
    const thinkCloudEnabled = ((policy as any)?.thinkCloudEnabled ?? thinkCloudRule?.enabled ?? defaults.thinkCloudEnabled) === true;
    const thinkCloudAmount = toNonNegativeNumber(
        (policy as any)?.thinkCloudAmount ?? thinkCloudRule?.amount,
        defaults.thinkCloudAmount,
    );
    const thinkCloudMaxClaims = toPositiveInteger(
        (policy as any)?.thinkCloudMaxClaims ?? thinkCloudRule?.maxClaims,
        defaults.thinkCloudMaxClaims,
    );
    const mapTagEnabled = ((policy as any)?.mapTagEnabled ?? mapTagRule?.enabled ?? defaults.mapTagEnabled) === true;
    const mapTagAmount = toNonNegativeNumber(
        (policy as any)?.mapTagAmount ?? mapTagRule?.amount,
        defaults.mapTagAmount,
    );
    const mapTagMaxClaims = toPositiveInteger(
        (policy as any)?.mapTagMaxClaims ?? mapTagRule?.maxClaims,
        defaults.mapTagMaxClaims,
    );
    const historyClassroomEnabled = ((policy as any)?.historyClassroomEnabled ?? historyClassroomRule?.enabled ?? defaults.historyClassroomEnabled) === true;
    const historyClassroomAmount = toNonNegativeNumber(
        (policy as any)?.historyClassroomAmount ?? historyClassroomRule?.amount,
        defaults.historyClassroomAmount,
    );
    const historyClassroomBonusEnabled = ((policy as any)?.historyClassroomBonusEnabled
        ?? historyClassroomBonusRule?.enabled
        ?? defaults.historyClassroomBonusEnabled) === true;
    const historyClassroomBonusThreshold = toPositiveThreshold(
        (policy as any)?.historyClassroomBonusThreshold ?? historyClassroomBonusRule?.thresholdScore,
        defaults.historyClassroomBonusThreshold,
    );
    const historyClassroomBonusAmount = toNonNegativeNumber(
        (policy as any)?.historyClassroomBonusAmount ?? historyClassroomBonusRule?.amount,
        defaults.historyClassroomBonusAmount,
    );
    const attendanceMilestoneBonusEnabled = ((policy as any)?.attendanceMilestoneBonusEnabled
        ?? attendanceMilestoneBonusRule?.enabled
        ?? defaults.attendanceMilestoneBonusEnabled) === true;
    const attendanceMilestone50 = toNonNegativeNumber(
        (policy as any)?.attendanceMilestone50 ?? attendanceMilestoneBonusRule?.amounts?.['50'],
        defaults.attendanceMilestone50,
    );
    const attendanceMilestone100 = toNonNegativeNumber(
        (policy as any)?.attendanceMilestone100 ?? attendanceMilestoneBonusRule?.amounts?.['100'],
        defaults.attendanceMilestone100,
    );
    const attendanceMilestone200 = toNonNegativeNumber(
        (policy as any)?.attendanceMilestone200 ?? attendanceMilestoneBonusRule?.amounts?.['200'],
        defaults.attendanceMilestone200,
    );
    const attendanceMilestone300 = toNonNegativeNumber(
        (policy as any)?.attendanceMilestone300 ?? attendanceMilestoneBonusRule?.amounts?.['300'],
        defaults.attendanceMilestone300,
    );

    return {
        ...defaults,
        ...policy,
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
                cooldownHours: toPositiveInteger(
                    thinkCloudRule?.cooldownHours,
                    defaults.rewardPolicy.thinkCloud.cooldownHours,
                ),
                maxClaims: thinkCloudMaxClaims,
            },
            mapTag: {
                enabled: autoRewardEnabled && mapTagEnabled,
                amount: mapTagAmount,
                cooldownHours: toPositiveInteger(
                    mapTagRule?.cooldownHours,
                    defaults.rewardPolicy.mapTag.cooldownHours,
                ),
                maxClaims: mapTagMaxClaims,
            },
            historyClassroom: {
                enabled: autoRewardEnabled && historyClassroomEnabled,
                amount: historyClassroomAmount,
                cooldownHours: toPositiveInteger(
                    historyClassroomRule?.cooldownHours,
                    defaults.rewardPolicy.historyClassroom.cooldownHours,
                ),
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
        rankPolicy: resolvePointRankPolicy(policy?.rankPolicy),
        updatedBy: String(policy?.updatedBy || '').trim(),
    };
};

const mergePointPolicy = (policy?: Partial<PointPolicy> | null): PointPolicy => normalizePointPolicy(policy);

export const POINT_POLICY_FALLBACK = getDefaultPointPolicy();

const sortByTimestampDesc = <T extends { createdAt?: any; requestedAt?: any }>(items: T[], key: 'createdAt' | 'requestedAt') =>
    [...items].sort((a, b) => {
        const aSeconds = Number(a[key]?.seconds || 0);
        const bSeconds = Number(b[key]?.seconds || 0);
        return bSeconds - aSeconds;
    });

export const getPointCollectionPath = (config: ConfigLike, collectionName: string) => {
    const { year, semester } = getYearSemester(config);
    return `years/${year}/semesters/${semester}/${collectionName}`;
};

export const getPointWalletDocPath = (config: ConfigLike, uid: string) =>
    `${getPointCollectionPath(config, 'point_wallets')}/${uid}`;

export const getPointPolicyDocPath = (config: ConfigLike) =>
    `${getPointCollectionPath(config, 'point_policies')}/current`;

const normalizePointKeyPart = (value: string) => String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'empty';

export const getKstDateKey = (date = new Date()) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(date);
};

export const getDaysInMonthFromMonthKey = (monthKey: string) => {
    const [year, month] = String(monthKey || '').split('-').map((value) => Number(value));
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return 0;
    }
    return new Date(year, month, 0).getDate();
};

export const buildAttendanceSourceId = (date = new Date()) => `attendance-${getKstDateKey(date)}`;

export const buildThinkCloudRewardSourceId = (sessionId: string, responseId: string) => (
    `think-cloud:${String(sessionId || '').trim()}:${String(responseId || '').trim()}`
);

export const buildMapTagRewardSourceId = (
    mapId: string,
    tag: string,
    nonce = `${Date.now()}`,
) => (
    `map-tag:${encodeURIComponent(String(mapId || '').trim())}:${encodeURIComponent(String(tag || '').trim())}:${normalizePointKeyPart(String(nonce || ''))}`
);

export const buildHistoryClassroomRewardSourceId = (resultId: string) => (
    `history-classroom-${String(resultId || '').trim()}`
);

export const buildPointActivityTransactionId = (
    uid: string,
    type: PointActivityRewardType,
    sourceId: string,
) => `activity_${normalizePointKeyPart(uid)}_${type}_${normalizePointKeyPart(sourceId)}`;

export const getPointActivityTransactionPath = (
    config: ConfigLike,
    uid: string,
    type: PointActivityRewardType,
    sourceId: string,
) => `${getPointCollectionPath(config, 'point_transactions')}/${buildPointActivityTransactionId(uid, type, sourceId)}`;

export const resolveActivityReward = ({
    policy,
    activityType,
    sourceId,
    sourceLabel,
    todayKey,
    monthKey,
    includeAttendanceMonthlyBonus = false,
    attendanceMilestoneReached,
    score,
}: {
    policy?: Partial<PointPolicy> | null;
    activityType: PointActivityRewardType;
    sourceId: string;
    sourceLabel?: string;
    todayKey?: string;
    monthKey?: string;
    includeAttendanceMonthlyBonus?: boolean;
    attendanceMilestoneReached?: 50 | 100 | 200 | 300 | null;
    score?: number | null;
}): ResolvedPointActivityReward => {
    const normalizedPolicy = normalizePointPolicy(policy);
    const items: ResolvedPointActivityRewardItem[] = [];
    if (!normalizedPolicy.autoRewardEnabled) {
        return {
            activityType,
            baseAmount: 0,
            bonusAmount: 0,
            totalAmount: 0,
            items,
        };
    }

    const baseAmount = activityType === 'attendance'
        ? normalizedPolicy.attendanceDaily
        : activityType === 'quiz'
            ? normalizedPolicy.quizSolve
            : activityType === 'lesson'
                ? normalizedPolicy.lessonView
                : activityType === 'think_cloud'
                    ? normalizedPolicy.rewardPolicy.thinkCloud.amount
                    : activityType === 'map_tag'
                        ? normalizedPolicy.rewardPolicy.mapTag.amount
                        : normalizedPolicy.rewardPolicy.historyClassroom.amount;

    if (baseAmount > 0) {
        items.push({
            type: activityType,
            amount: baseAmount,
            sourceId,
            sourceLabel: String(sourceLabel || '').trim() || (
                activityType === 'attendance'
                    ? `${String(todayKey || '').trim()} 출석 체크`
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
            targetMonth: activityType === 'attendance' ? String(monthKey || '').trim() : '',
            targetDate: activityType === 'attendance' ? String(todayKey || '').trim() : '',
        });
    }

    if (activityType === 'attendance' && includeAttendanceMonthlyBonus && normalizedPolicy.attendanceMonthlyBonus > 0) {
        items.push({
            type: 'attendance_monthly_bonus',
            amount: normalizedPolicy.attendanceMonthlyBonus,
            sourceId: String(monthKey || '').trim(),
            sourceLabel: `${String(monthKey || '').trim()} 월간 개근 보너스`,
            targetMonth: String(monthKey || '').trim(),
            targetDate: String(todayKey || '').trim(),
        });
    }

    if (
        activityType === 'attendance'
        && attendanceMilestoneReached
        && normalizedPolicy.rewardPolicy.attendanceMilestoneBonus.enabled
    ) {
        const milestoneKey = String(attendanceMilestoneReached) as '50' | '100' | '200' | '300';
        const milestoneAmount = Number(
            normalizedPolicy.rewardPolicy.attendanceMilestoneBonus.amounts[milestoneKey] || 0,
        );
        if (milestoneAmount > 0) {
            items.push({
                type: 'attendance_milestone_bonus',
                amount: milestoneAmount,
                sourceId: `attendance-milestone-${attendanceMilestoneReached}`,
                sourceLabel: `출석 ${attendanceMilestoneReached}회 달성 보너스`,
                targetMonth: String(monthKey || '').trim(),
                targetDate: String(todayKey || '').trim(),
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
        });
    }

    const totalAmount = items.reduce((total, item) => total + Number(item.amount || 0), 0);
    return {
        activityType,
        baseAmount,
        bonusAmount: Math.max(0, totalAmount - Math.max(0, baseAmount)),
        totalAmount,
        items,
    };
};

// Read helpers
export const getPointWalletByUid = async (config: ConfigLike, uid: string) => {
    const snap = await getDoc(doc(db, getPointWalletDocPath(config, uid)));
    if (!snap.exists()) return null;
    return snap.data() as PointWallet;
};

export const listPointWallets = async (config: ConfigLike) => {
    const snapshot = await getDocs(collection(db, getPointCollectionPath(config, 'point_wallets')));
    const items: PointWallet[] = [];
    snapshot.forEach((item) => {
        items.push(item.data() as PointWallet);
    });
    return [...items].sort((a, b) => {
        const balanceGap = Number(b.balance || 0) - Number(a.balance || 0);
        if (balanceGap !== 0) return balanceGap;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko');
    });
};

export const getPointSchoolOptions = async () => {
    const snap = await getDoc(doc(db, 'site_settings', 'school_config'));
    const defaultGrades: SchoolOption[] = [
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ];
    const defaultClasses: SchoolOption[] = Array.from({ length: 12 }, (_, index) => ({
        value: String(index + 1),
        label: `${index + 1}반`,
    }));

    if (!snap.exists()) {
        return { grades: defaultGrades, classes: defaultClasses };
    }

    const data = snap.data() as {
        grades?: Array<{ value?: string; label?: string }>;
        classes?: Array<{ value?: string; label?: string }>;
    };

    const grades = (data.grades || [])
        .map((grade) => ({ value: String(grade?.value || '').trim(), label: String(grade?.label || '').trim() }))
        .filter((grade) => grade.value && grade.label);
    const classes = (data.classes || [])
        .map((classOption) => ({ value: String(classOption?.value || '').trim(), label: String(classOption?.label || '').trim() }))
        .filter((classOption) => classOption.value && classOption.label);

    return {
        grades: grades.length > 0 ? grades : defaultGrades,
        classes: classes.length > 0 ? classes : defaultClasses,
    };
};

const resolveStudentField = (data: Record<string, any>, keys: string[]) => {
    for (const key of keys) {
        const value = String(data[key] || '').trim();
        if (value) return value;
    }
    return '';
};

export const listPointStudentTargets = async () => {
    const snapshot = await getDocs(collection(db, 'users'));
    const items: PointStudentTarget[] = [];

    snapshot.forEach((item) => {
        const data = item.data() as Record<string, any>;
        const email = String(data.email || '').trim();
        const role = String(data.role || '').trim();
        if (role === 'teacher') return;

        const studentName = resolveStudentField(data, ['studentName', 'name', 'displayName', 'nickname', 'customName']);
        const grade = resolveStudentField(data, ['studentGrade', 'grade']);
        const className = resolveStudentField(data, ['studentClass', 'class']);
        const number = resolveStudentField(data, ['studentNumber', 'number']);

        if (!studentName || (!grade && !className && !number)) return;

        items.push({
            uid: item.id,
            studentName,
            grade,
            class: className,
            number,
            email,
        });
    });

    return items.sort((a, b) => {
        const gradeGap = Number(a.grade || 0) - Number(b.grade || 0);
        if (gradeGap !== 0) return gradeGap;
        const classGap = Number(a.class || 0) - Number(b.class || 0);
        if (classGap !== 0) return classGap;
        const numberGap = Number(a.number || 0) - Number(b.number || 0);
        if (numberGap !== 0) return numberGap;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko');
    });
};

export const listPointStudentTargetsByClass = async (grade: string, className: string) => {
    const normalizedGrade = String(grade || '').trim();
    const normalizedClass = String(className || '').trim();
    if (!normalizedGrade || !normalizedClass) return [];

    const queryCombos: Array<[string, string]> = [
        ['studentGrade', 'studentClass'],
        ['studentGrade', 'class'],
        ['grade', 'studentClass'],
        ['grade', 'class'],
    ];
    const seen = new Set<string>();
    const items: PointStudentTarget[] = [];

    const snapshots = await Promise.all(queryCombos.map(([gradeField, classField]) => getDocs(query(
        collection(db, 'users'),
        where(gradeField, '==', normalizedGrade),
        where(classField, '==', normalizedClass),
    ))));

    snapshots.forEach((snapshot) => {
        snapshot.forEach((item) => {
            if (seen.has(item.id)) return;
            const data = item.data() as Record<string, any>;
            const role = String(data.role || '').trim();
            if (role === 'teacher') return;

            const studentName = resolveStudentField(data, ['studentName', 'name', 'displayName', 'nickname', 'customName']);
            const resolvedGrade = resolveStudentField(data, ['studentGrade', 'grade']);
            const resolvedClass = resolveStudentField(data, ['studentClass', 'class']);
            const number = resolveStudentField(data, ['studentNumber', 'number']);
            if (!studentName) return;

            seen.add(item.id);
            items.push({
                uid: item.id,
                studentName,
                grade: resolvedGrade,
                class: resolvedClass,
                number,
                email: String(data.email || '').trim(),
            });
        });
    });

    return items.sort((a, b) => {
        const numberGap = Number(a.number || 0) - Number(b.number || 0);
        if (numberGap !== 0) return numberGap;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko');
    });
};

export const getPointPolicy = async (config: ConfigLike) => {
    const snap = await getDoc(doc(db, getPointPolicyDocPath(config)));
    if (!snap.exists()) return POINT_POLICY_FALLBACK;
    return normalizePointPolicy(snap.data() as Partial<PointPolicy>);
};

export const listPointTransactions = async (config: ConfigLike, options?: { uid?: string; type?: PointTransactionType }) => {
    const constraints = [];
    if (options?.uid) constraints.push(where('uid', '==', options.uid));
    if (options?.type) constraints.push(where('type', '==', options.type));

    const snapshot = constraints.length > 0
        ? await getDocs(query(
            collection(db, getPointCollectionPath(config, 'point_transactions')),
            ...constraints,
        ))
        : await getDocs(collection(db, getPointCollectionPath(config, 'point_transactions')));
    const items: PointTransaction[] = [];
    snapshot.forEach((item) => {
        items.push({ id: item.id, ...(item.data() as Omit<PointTransaction, 'id'>) });
    });
    return sortByTimestampDesc(items, 'createdAt');
};

export const listPointTransactionsByUid = async (config: ConfigLike, uid: string, limitCount = 100) => {
    const items = await listPointTransactions(config, { uid });
    return items.slice(0, limitCount);
};

export const getPointRankManualAdjustEarnedPointsByUid = async (config: ConfigLike, uid: string) => {
    const transactions = await listPointTransactions(config, { uid, type: 'manual_adjust' });
    return sumPointRankEarnedPoints(transactions);
};

export const getPointRankManualAdjustEarnedPointsMap = async (config: ConfigLike) => {
    const transactions = await listPointTransactions(config, { type: 'manual_adjust' });
    return buildPointRankEarnedPointsByUid(transactions);
};

export const getPointActivityTransaction = async (
    config: ConfigLike,
    uid: string,
    type: PointActivityRewardType,
    sourceId: string,
) => {
    const snap = await getDoc(doc(db, getPointActivityTransactionPath(config, uid, type, sourceId)));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<PointTransaction, 'id'>) } as PointTransaction;
};

export const listPointProducts = async (config: ConfigLike, activeOnly = false) => {
    const snapshot = await getDocs(query(
        collection(db, getPointCollectionPath(config, 'point_products')),
        orderBy('sortOrder', 'asc'),
    ));
    const items: PointProduct[] = [];
    snapshot.forEach((item) => {
        items.push({ id: item.id, ...(item.data() as Omit<PointProduct, 'id'>) });
    });
    return activeOnly ? items.filter((item) => item.isActive) : items;
};

export const listPointOrders = async (config: ConfigLike, options?: { uid?: string; limitCount?: number }) => {
    const baseRef = collection(db, getPointCollectionPath(config, 'point_orders'));
    const snapshot = options?.uid
        ? await getDocs(query(baseRef, where('uid', '==', options.uid)))
        : await getDocs(query(baseRef, orderBy('requestedAt', 'desc')));
    const items: PointOrder[] = [];
    snapshot.forEach((item) => {
        items.push({ id: item.id, ...(item.data() as Omit<PointOrder, 'id'>) });
    });
    const sorted = sortByTimestampDesc(items, 'requestedAt');
    return typeof options?.limitCount === 'number' ? sorted.slice(0, options.limitCount) : sorted;
};

// Admin write helpers
// Important:
// Admin mutations now also use trusted Callable Functions so clients never write wallet/order/ledger
// state directly. Policy/product management remains direct for now because those documents are
// teacher-only and do not mutate student balances.
export const adjustPoints = async ({ config, uid, delta, sourceId, sourceLabel, policyId, mode, actor }: AdjustPointsInput) => {
    if (!Number.isFinite(delta) || delta === 0) {
        throw new Error('Point delta must be a non-zero finite number.');
    }
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'adjustTeacherPoints');
    const result = await callable({
        year,
        semester,
        uid,
        delta,
        sourceId: String(sourceId || '').trim(),
        sourceLabel: String(sourceLabel || '').trim(),
        policyId: String(policyId || '').trim(),
        mode: mode || (delta > 0 ? 'grant' : 'reclaim'),
        actorUid: actor.uid,
    });
    return result.data as {
        walletId: string;
        transactionId: string;
        balance: number;
        type: Extract<PointTransactionType, 'manual_adjust' | 'manual_reclaim'>;
    };
};

export const buildPointPolicyPayload = (policy: Partial<PointPolicy>, actor: ActorInfo) => {
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
        rankPolicy: buildPointRankPolicySavePayload(normalizedPolicy.rankPolicy),
        updatedAt: serverTimestamp(),
        updatedBy: String(actor.uid || '').trim(),
    };
};

export const upsertPointPolicy = async (config: ConfigLike, policy: Partial<PointPolicy>, actor: ActorInfo) => {
    const targetRef = doc(db, getPointPolicyDocPath(config));
    const payload = buildPointPolicyPayload(policy, actor);
    await setDoc(targetRef, payload);
    return payload as PointPolicy;
};

export const upsertPointProduct = async (
    config: ConfigLike,
    product: Partial<PointProduct> & Pick<PointProduct, 'name' | 'price'>,
    actor: ActorInfo,
) => {
    const productRef = product.id
        ? doc(db, getPointCollectionPath(config, 'point_products'), product.id)
        : doc(collection(db, getPointCollectionPath(config, 'point_products')));
    const payload = {
        name: String(product.name || '').trim(),
        description: String(product.description || '').trim(),
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        isActive: product.isActive !== false,
        sortOrder: Number(product.sortOrder || 0),
        imageUrl: String(product.imageUrl || '').trim(),
        previewImageUrl: String(product.previewImageUrl || '').trim(),
        imageStoragePath: String(product.imageStoragePath || '').trim(),
        previewStoragePath: String(product.previewStoragePath || '').trim(),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
        ...(product.id ? {} : { createdAt: serverTimestamp() }),
    };
    await setDoc(productRef, payload, { merge: true });
    return {
        id: productRef.id,
        ...payload,
    };
};

export const reviewPointOrder = async ({ config, orderId, nextStatus, actor, memo }: ReviewPointOrderInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'reviewTeacherPointOrder');
    const result = await callable({
        year,
        semester,
        orderId,
        nextStatus,
        memo: String(memo || '').trim(),
        actorUid: actor.uid,
    });
    return result.data as {
        orderId: string;
        transactionId: string;
        status: PointOrderStatus;
        duplicate?: boolean;
    };
};

export const updatePointAdjustment = async ({ config, transactionId, action, nextDelta }: UpdatePointAdjustmentInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'updateTeacherPointAdjustment');
    const result = await callable({
        year,
        semester,
        transactionId,
        action,
        nextDelta: action === 'update' ? Number(nextDelta || 0) : undefined,
    });
    return result.data as {
        walletId: string;
        transactionId: string;
        balance: number;
        delta: number;
        cancelled: boolean;
    };
};

export const updateStudentProfileIcon = async ({ config, emojiId }: UpdateStudentProfileIconInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'updateStudentProfileIcon');
    const result = await callable({
        year,
        semester,
        emojiId: String(emojiId || '').trim(),
    });
    return result.data as {
        emojiId: string;
        profileIcon: string;
    };
};

// Student trusted-callable wrappers
export const claimPointActivityReward = async ({ config, activityType, sourceId, sourceLabel, score }: ClaimPointActivityInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'applyPointActivityReward');
    const result = await callable({
        year,
        semester,
        activityType,
        sourceId,
        sourceLabel: String(sourceLabel || '').trim(),
        score: score === null || score === undefined ? undefined : Number(score),
    });
    return result.data as PointActivityRewardResult;
};

export const buildPointRewardFeedback = ({
    actionLabel,
    duplicateMessage,
    result,
}: {
    actionLabel: string;
    duplicateMessage: string;
    result: {
        awarded?: boolean;
        duplicate?: boolean;
        amount?: number;
        bonusAwarded?: boolean;
        bonusAmount?: number;
        monthlyBonusAwarded?: boolean;
        monthlyBonusAmount?: number;
        totalAwarded?: number;
        blockedMessage?: string;
    };
}) => {
    const totalAwarded = Number(result.totalAwarded || result.amount || 0);
    if (totalAwarded > 0) {
        if (result.monthlyBonusAwarded && Number(result.monthlyBonusAmount || 0) > 0) {
            const totalBonusAmount = Number(result.bonusAmount || 0);
            const monthlyBonusAmount = Number(result.monthlyBonusAmount || 0);
            if (totalBonusAmount > monthlyBonusAmount) {
                return {
                    tone: 'reward' as const,
                    title: `${actionLabel} 완료`,
                    message: `기본 +${Number(result.amount || 0)}위스, 보너스 +${totalBonusAmount}위스`,
                };
            }
            return {
                tone: 'reward' as const,
                title: `${actionLabel} 완료`,
                message: `+${Number(result.amount || 0)}위스 지급, 월간 개근 보너스 +${monthlyBonusAmount}위스`,
            };
        }

        if (result.bonusAwarded && Number(result.bonusAmount || 0) > 0) {
            return {
                tone: 'reward' as const,
                title: `${actionLabel} 완료`,
                message: `기본 +${Number(result.amount || 0)}위스, 보너스 +${Number(result.bonusAmount || 0)}위스`,
            };
        }

        return {
            tone: 'reward' as const,
            title: `${actionLabel} 완료`,
            message: `+${totalAwarded}위스 지급`,
        };
    }

    if (result.duplicate) {
        return {
            tone: 'warning' as const,
            title: `${actionLabel} 안내`,
            message: result.blockedMessage || duplicateMessage,
        };
    }

    return null;
};

export const createSecurePurchaseRequest = async ({ config, productId, memo, requestKey }: SecurePurchaseRequestInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'createPointPurchaseRequest');
    const result = await callable({
        year,
        semester,
        productId,
        memo: String(memo || '').trim(),
        requestKey,
    });
    return result.data as {
        created: boolean;
        duplicate: boolean;
        orderId: string;
        transactionId: string;
        balance: number;
    };
};

export {
    buildWisHallOfFameClassKey,
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_POSITIONS,
    DEFAULT_WIS_HALL_OF_FAME_POSITION_PRESET,
    ensureWisHallOfFameSnapshot,
    findWisHallOfFameRecognition,
    getOrEnsureWisHallOfFameSnapshot,
    getWisHallOfFameClassEntries,
    getWisHallOfFameDocPath,
    getWisHallOfFameGradeEntries,
    getWisHallOfFameSnapshot,
    hasSeenWisHallOfFameRecognition,
    markWisHallOfFameRecognitionSeen,
    resolveHallOfFameInterfaceConfig,
    WIS_HALL_OF_FAME_DOC_ID,
    WIS_HALL_OF_FAME_GRADE_KEY,
} from './wisHallOfFame';
