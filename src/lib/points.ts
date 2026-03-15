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
import { getYearSemester } from './semesterScope';
import type {
    PointOrder,
    PointOrderStatus,
    PointPolicy,
    PointProduct,
    PointTransaction,
    PointTransactionType,
    PointWallet,
    SystemConfig,
} from '../types';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

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
    activityType: Extract<PointTransactionType, 'attendance' | 'quiz' | 'lesson'>;
    sourceId: string;
    sourceLabel?: string;
}

interface SecurePurchaseRequestInput {
    config: ConfigLike;
    productId: string;
    memo?: string;
    requestKey: string;
}

const DEFAULT_POINT_POLICY: PointPolicy = {
    attendanceDaily: 5,
    lessonView: 3,
    quizSolve: 10,
    manualAdjustEnabled: false,
    allowNegativeBalance: false,
    updatedBy: '',
};

export const POINT_POLICY_FALLBACK = DEFAULT_POINT_POLICY;

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

export const buildAttendanceSourceId = (date = new Date()) => `attendance-${getKstDateKey(date)}`;

export const buildPointActivityTransactionId = (
    uid: string,
    type: Extract<PointTransactionType, 'attendance' | 'quiz' | 'lesson'>,
    sourceId: string,
) => `activity_${normalizePointKeyPart(uid)}_${type}_${normalizePointKeyPart(sourceId)}`;

export const getPointActivityTransactionPath = (
    config: ConfigLike,
    uid: string,
    type: Extract<PointTransactionType, 'attendance' | 'quiz' | 'lesson'>,
    sourceId: string,
) => `${getPointCollectionPath(config, 'point_transactions')}/${buildPointActivityTransactionId(uid, type, sourceId)}`;

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

export const getPointPolicy = async (config: ConfigLike) => {
    const snap = await getDoc(doc(db, getPointPolicyDocPath(config)));
    if (!snap.exists()) return DEFAULT_POINT_POLICY;
    return {
        ...DEFAULT_POINT_POLICY,
        ...(snap.data() as Partial<PointPolicy>),
    } as PointPolicy;
};

export const listPointTransactionsByUid = async (config: ConfigLike, uid: string, limitCount = 100) => {
    const snapshot = await getDocs(query(
        collection(db, getPointCollectionPath(config, 'point_transactions')),
        where('uid', '==', uid),
    ));
    const items: PointTransaction[] = [];
    snapshot.forEach((item) => {
        items.push({ id: item.id, ...(item.data() as Omit<PointTransaction, 'id'>) });
    });
    return sortByTimestampDesc(items, 'createdAt').slice(0, limitCount);
};

export const getPointActivityTransaction = async (
    config: ConfigLike,
    uid: string,
    type: Extract<PointTransactionType, 'attendance' | 'quiz' | 'lesson'>,
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
export const adjustPoints = async ({ config, uid, delta, sourceId, sourceLabel, policyId, actor }: AdjustPointsInput) => {
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
        actorUid: actor.uid,
    });
    return result.data as {
        walletId: string;
        transactionId: string;
        balance: number;
    };
};

export const upsertPointPolicy = async (config: ConfigLike, policy: Partial<PointPolicy>, actor: ActorInfo) => {
    const targetRef = doc(db, getPointPolicyDocPath(config));
    const payload: PointPolicy = {
        ...DEFAULT_POINT_POLICY,
        ...policy,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
    } as PointPolicy;
    await setDoc(targetRef, payload, { merge: true });
    return payload;
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

// Student trusted-callable wrappers
export const claimPointActivityReward = async ({ config, activityType, sourceId, sourceLabel }: ClaimPointActivityInput) => {
    const { year, semester } = getYearSemester(config);
    const callable = httpsCallable(functions, 'applyPointActivityReward');
    const result = await callable({
        year,
        semester,
        activityType,
        sourceId,
        sourceLabel: String(sourceLabel || '').trim(),
    });
    return result.data as {
        awarded: boolean;
        duplicate: boolean;
        amount: number;
        balance: number;
        transactionId: string;
        sourceId: string;
        policyId: string;
    };
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
