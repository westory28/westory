import React, { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { useSearchParams } from 'react-router-dom';
import { TEACHER_POINT_TAB_LABELS } from '../../constants/pointLabels';
import { useAppToast } from '../../components/common/AppToastProvider';
import { useAuth } from '../../contexts/AuthContext';
import {
    adjustPoints,
    getPointSchoolOptions,
    getPointPolicy,
    getPointRankManualAdjustEarnedPointsMap,
    listPointStudentTargets,
    listPointOrders,
    listPointProducts,
    listPointStudentTargetsByClass,
    listPointTransactionsByUid,
    listPointWallets,
    POINT_POLICY_FALLBACK,
    reviewPointOrder,
    updatePointAdjustment,
    upsertPointPolicy,
    upsertPointProduct,
} from '../../lib/points';
import {
    getPointRankPolicyValidationError,
    getPointWalletCumulativeEarned,
    needsPointRankLegacyFallback,
    resolvePointRankPolicyDraft,
} from '../../lib/pointRanks';
import { canManagePoints, canReadPoints } from '../../lib/permissions';
import { getYearSemester } from '../../lib/semesterScope';
import type {
    PointOrder,
    PointOrderStatus,
    PointPolicy,
    PointProduct,
    PointRankEmojiRegistryEntry,
    PointRankPolicy,
    PointRankPolicyTier,
    PointStudentTarget,
    PointTransaction,
    PointWallet,
} from '../../types';
import PointGrantTab from './components/points/PointGrantTab';
import PointPolicyTab from './components/points/PointPolicyTab';
import PointRanksTab, {
    type RankEmojiCollectionDraft,
    type RankPanelSaveTone,
    type RankSettingsDraft,
    type RankThemeDraft,
} from './components/points/PointRanksTab';
import PointProductsTab from './components/points/PointProductsTab';
import PointRequestsTab from './components/points/PointRequestsTab';
import PointsOverviewTab from './components/points/PointsOverviewTab';
import HallOfFameManagementTab from './components/points/HallOfFameManagementTab';

type TeacherPointTab = keyof typeof TEACHER_POINT_TAB_LABELS;
type GrantMode = 'grant' | 'reclaim';
type OrderFilter = 'all' | PointOrderStatus;
type PolicyFeedbackTone = RankPanelSaveTone;
type SchoolOption = { value: string; label: string };
type OverviewSortKey = 'none' | 'affiliation' | 'balance' | 'earnedTotal' | 'spentTotal';
type OverviewSortDirection = 'asc' | 'desc';
type ProductFormState = {
    id: string;
    name: string;
    description: string;
    price: string;
    stock: string;
    imageUrl: string;
    previewImageUrl: string;
    imageStoragePath: string;
    previewStoragePath: string;
    sortOrder: string;
    isActive: boolean;
};

const EMPTY_POLICY: PointPolicy = POINT_POLICY_FALLBACK;

const createEmptyProductForm = (): ProductFormState => ({
    id: '',
    name: '',
    description: '',
    price: '0',
    stock: '0',
    imageUrl: '',
    previewImageUrl: '',
    imageStoragePath: '',
    previewStoragePath: '',
    sortOrder: '',
    isActive: true,
});

const normalizeValue = (value: unknown) => String(value || '').trim();
const normalizeSearchValue = (value: unknown) => normalizeValue(value).toLowerCase();
const OVERVIEW_PAGE_SIZE = 20;

const sortPointProducts = (items: PointProduct[]) => [...items].sort((left, right) => {
    const sortGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (sortGap !== 0) return sortGap;
    return normalizeValue(left.name).localeCompare(normalizeValue(right.name), 'ko-KR', { numeric: true });
});

const getNextPointProductSortOrder = (items: PointProduct[]) => (
    items.reduce((maxValue, item) => Math.max(maxValue, Number(item.sortOrder || 0)), -10) + 10
);

const resequencePointProducts = (items: PointProduct[]) => items.map((item, index) => ({
    ...item,
    sortOrder: (index + 1) * 10,
}));

const reorderPointProducts = (
    items: PointProduct[],
    sourceId: string,
    targetId: string,
) => {
    const orderedItems = sortPointProducts(items);
    const sourceIndex = orderedItems.findIndex((item) => item.id === sourceId);
    const targetIndex = orderedItems.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return items;
    }

    const nextItems = [...orderedItems];
    const [movedItem] = nextItems.splice(sourceIndex, 1);
    nextItems.splice(targetIndex, 0, movedItem);
    return resequencePointProducts(nextItems);
};

const mergePointProductIntoList = (
    items: PointProduct[],
    nextItem: PointProduct,
) => {
    const nextItems = items.some((item) => item.id === nextItem.id)
        ? items.map((item) => (item.id === nextItem.id ? { ...item, ...nextItem } : item))
        : [...items, nextItem];
    return sortPointProducts(nextItems);
};

const sortOverviewWallets = (
    wallets: PointWallet[],
    sortKey: OverviewSortKey,
    sortDirection: OverviewSortDirection,
) => {
    if (sortKey === 'none') {
        return wallets;
    }

    const direction = sortDirection === 'asc' ? 1 : -1;

    return wallets
        .map((wallet, index) => ({ wallet, index }))
        .sort((left, right) => {
            let comparison = 0;

            if (sortKey === 'affiliation') {
                comparison = normalizeValue(left.wallet.grade).localeCompare(normalizeValue(right.wallet.grade), 'ko-KR', { numeric: true })
                    || normalizeValue(left.wallet.class).localeCompare(normalizeValue(right.wallet.class), 'ko-KR', { numeric: true })
                    || normalizeValue(left.wallet.number).localeCompare(normalizeValue(right.wallet.number), 'ko-KR', { numeric: true })
                    || normalizeValue(left.wallet.studentName).localeCompare(normalizeValue(right.wallet.studentName), 'ko-KR', { numeric: true });
            } else if (sortKey === 'balance') {
                comparison = (left.wallet.balance || 0) - (right.wallet.balance || 0);
            } else if (sortKey === 'earnedTotal') {
                comparison = getPointWalletCumulativeEarned(left.wallet)
                    - getPointWalletCumulativeEarned(right.wallet);
            } else if (sortKey === 'spentTotal') {
                comparison = (left.wallet.spentTotal || 0) - (right.wallet.spentTotal || 0);
            }

            if (comparison !== 0) {
                return comparison * direction;
            }

            return left.index - right.index;
        })
        .map(({ wallet }) => wallet);
};

const cloneRankTiers = (tiers: PointRankPolicyTier[] = []) => tiers.map((tier) => ({
    ...tier,
    allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
}));

const cloneRankThemes = (
    themes: PointRankPolicy['themes'] = {},
): PointRankPolicy['themes'] => Object.fromEntries(
    Object.entries(themes || {}).map(([themeId, themeConfig]) => [
        themeId,
        {
            ...themeConfig,
            tiers: Object.fromEntries(
                Object.entries(themeConfig?.tiers || {}).map(([tierCode, tierOverride]) => [
                    tierCode,
                    { ...tierOverride },
                ]),
            ),
        },
    ]),
) as PointRankPolicy['themes'];

const cloneRankEmojiRegistry = (emojiRegistry: PointRankEmojiRegistryEntry[] = []) => emojiRegistry.map((entry) => ({
    ...entry,
    legacyValues: [...(entry.legacyValues || [])],
}));

const createRankThemeDraft = (rankPolicy?: Partial<PointRankPolicy> | null): RankThemeDraft => {
    const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
    return {
        activeThemeId: resolvedPolicy.activeThemeId,
    };
};

const createRankSettingsDraft = (rankPolicy?: Partial<PointRankPolicy> | null): RankSettingsDraft => {
    const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
    return {
        tiers: cloneRankTiers(resolvedPolicy.tiers),
        themes: cloneRankThemes(resolvedPolicy.themes),
        celebrationPolicy: {
            ...resolvedPolicy.celebrationPolicy,
        },
    };
};

const createRankEmojiCollectionDraft = (rankPolicy?: Partial<PointRankPolicy> | null): RankEmojiCollectionDraft => {
    const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
    return {
        emojiRegistry: cloneRankEmojiRegistry(resolvedPolicy.emojiRegistry),
        tiers: cloneRankTiers(resolvedPolicy.tiers),
    };
};

const loadImageElement = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
    };
    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('상품 이미지를 읽지 못했습니다.'));
    };
    image.src = objectUrl;
});

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (!blob) {
            reject(new Error('상품 이미지를 압축하지 못했습니다.'));
            return;
        }
        resolve(blob);
    }, 'image/jpeg', quality);
});

const buildResizedImageBlob = async (file: File, maxSize: number, quality: number) => {
    const image = await loadImageElement(file);
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('상품 이미지 캔버스를 준비하지 못했습니다.');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, quality);
};

const ManagePoints: React.FC = () => {
    const { config, currentUser, userData, interfaceConfig, refreshInterfaceConfig } = useAuth();
    const { showToast } = useAppToast();
    const [searchParams, setSearchParams] = useSearchParams();

    const canRead = canReadPoints(userData, currentUser?.email);
    const canManage = canManagePoints(userData, currentUser?.email);

    const [activeTab, setActiveTab] = useState<TeacherPointTab>('overview');
    const [loading, setLoading] = useState(true);
    const [wallets, setWallets] = useState<PointWallet[]>([]);
    const [students, setStudents] = useState<PointStudentTarget[]>([]);
    const [grantLoading, setGrantLoading] = useState(false);
    const [selectedUid, setSelectedUid] = useState('');
    const [transactions, setTransactions] = useState<PointTransaction[]>([]);
    const [savedPolicy, setSavedPolicy] = useState<PointPolicy>(EMPTY_POLICY);
    const [policyDraft, setPolicyDraft] = useState<PointPolicy>(EMPTY_POLICY);
    const [policyDirty, setPolicyDirty] = useState(false);
    const [policyFeedbackMessage, setPolicyFeedbackMessage] = useState('');
    const [policyFeedbackTone, setPolicyFeedbackTone] = useState<PolicyFeedbackTone | null>(null);
    const [rankThemeDraft, setRankThemeDraft] = useState<RankThemeDraft>(() => createRankThemeDraft(EMPTY_POLICY.rankPolicy));
    const [rankThemeDirty, setRankThemeDirty] = useState(false);
    const [rankThemeFeedbackMessage, setRankThemeFeedbackMessage] = useState('');
    const [rankThemeFeedbackTone, setRankThemeFeedbackTone] = useState<PolicyFeedbackTone | null>(null);
    const [rankSettingsDraft, setRankSettingsDraft] = useState<RankSettingsDraft>(() => createRankSettingsDraft(EMPTY_POLICY.rankPolicy));
    const [rankSettingsDirty, setRankSettingsDirty] = useState(false);
    const [rankSettingsFeedbackMessage, setRankSettingsFeedbackMessage] = useState('');
    const [rankSettingsFeedbackTone, setRankSettingsFeedbackTone] = useState<PolicyFeedbackTone | null>(null);
    const [rankEmojiDraft, setRankEmojiDraft] = useState<RankEmojiCollectionDraft>(() => createRankEmojiCollectionDraft(EMPTY_POLICY.rankPolicy));
    const [rankEmojiDirty, setRankEmojiDirty] = useState(false);
    const [rankEmojiFeedbackMessage, setRankEmojiFeedbackMessage] = useState('');
    const [rankEmojiFeedbackTone, setRankEmojiFeedbackTone] = useState<PolicyFeedbackTone | null>(null);
    const [rankManualAdjustEarnedPointsByUid, setRankManualAdjustEarnedPointsByUid] = useState<Record<string, number>>({});
    const [products, setProducts] = useState<PointProduct[]>([]);
    const [orders, setOrders] = useState<PointOrder[]>([]);
    const [gradeFilter, setGradeFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [numberFilter, setNumberFilter] = useState('all');
    const [nameSearch, setNameSearch] = useState('');
    const [overviewSortKey, setOverviewSortKey] = useState<OverviewSortKey>('none');
    const [overviewSortDirection, setOverviewSortDirection] = useState<OverviewSortDirection>('desc');
    const [overviewPage, setOverviewPage] = useState(1);
    const [grantGradeFilter, setGrantGradeFilter] = useState('all');
    const [grantClassFilter, setGrantClassFilter] = useState('all');
    const [grantNumberFilter, setGrantNumberFilter] = useState('all');
    const [grantNameSearch, setGrantNameSearch] = useState('');
    const [grantSelectedUid, setGrantSelectedUid] = useState('');
    const [grantAmount, setGrantAmount] = useState('');
    const [grantReason, setGrantReason] = useState('');
    const [grantFeedback, setGrantFeedback] = useState('');
    const [grantSubmittingMode, setGrantSubmittingMode] = useState<GrantMode | null>(null);
    const [grantGradeOptions, setGrantGradeOptions] = useState<SchoolOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [grantClassOptions, setGrantClassOptions] = useState<SchoolOption[]>(
        Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}반` })),
    );
    const [productForm, setProductForm] = useState<ProductFormState>(() => createEmptyProductForm());
    const [productImageFile, setProductImageFile] = useState<File | null>(null);
    const [productImagePreviewUrl, setProductImagePreviewUrl] = useState('');
    const [productImageUploading, setProductImageUploading] = useState(false);
    const [productFeedback, setProductFeedback] = useState('');
    const [productOrderDirty, setProductOrderDirty] = useState(false);
    const [productOrderSaving, setProductOrderSaving] = useState(false);
    const [productOrderFeedback, setProductOrderFeedback] = useState('');
    const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
    const [selectedOrderId, setSelectedOrderId] = useState('');
    const [orderMemo, setOrderMemo] = useState('');
    const [orderFeedback, setOrderFeedback] = useState('');
    const [selectedEditableTransactionId, setSelectedEditableTransactionId] = useState('');
    const [adjustmentDraftValue, setAdjustmentDraftValue] = useState('');
    const [adjustmentFeedback, setAdjustmentFeedback] = useState('');
    const [adjustmentSaving, setAdjustmentSaving] = useState(false);

    const actor = useMemo(() => ({
        uid: currentUser?.uid || userData?.uid || '',
        name: userData?.name || currentUser?.displayName || '',
    }), [currentUser?.displayName, currentUser?.uid, userData?.name, userData?.uid]);
    const savedRankPolicy = useMemo(
        () => resolvePointRankPolicyDraft(savedPolicy.rankPolicy),
        [savedPolicy.rankPolicy],
    );

    const syncRankEmojiUnlockTierCodes = (
        tiers: PointRankPolicyTier[],
        emojiRegistry: PointRankEmojiRegistryEntry[],
    ) => cloneRankEmojiRegistry(emojiRegistry).map((entry) => {
        const assignedTier = tiers.find((tier) => (tier.allowedEmojiIds || []).includes(entry.id));
        return {
            ...entry,
            ...(assignedTier ? { unlockTierCode: assignedTier.code } : {}),
        };
    });

    const applyConfirmedPolicy = (
        confirmedPolicy: PointPolicy,
        options?: {
            resetThemeDraft?: boolean;
            resetRankSettingsDraft?: boolean;
            resetEmojiDraft?: boolean;
        },
    ) => {
        setSavedPolicy(confirmedPolicy);
        setPolicyDraft((prev) => (
            policyDirty
                ? {
                    ...prev,
                    rankPolicy: confirmedPolicy.rankPolicy,
                }
                : confirmedPolicy
        ));
        setRankThemeDraft((prev) => (
            options?.resetThemeDraft || !rankThemeDirty
                ? createRankThemeDraft(confirmedPolicy.rankPolicy)
                : prev
        ));
        setRankSettingsDraft((prev) => (
            options?.resetRankSettingsDraft || !rankSettingsDirty
                ? createRankSettingsDraft(confirmedPolicy.rankPolicy)
                : prev
        ));
        setRankEmojiDraft((prev) => (
            options?.resetEmojiDraft || !rankEmojiDirty
                ? createRankEmojiCollectionDraft(confirmedPolicy.rankPolicy)
                : prev
        ));
    };

    const gradeOptions = useMemo(
        () => Array.from(new Set(wallets.map((wallet) => normalizeValue(wallet.grade)).filter(Boolean))).sort((a, b) => Number(a) - Number(b)),
        [wallets],
    );

    const classOptions = useMemo(
        () => Array.from(new Set(
            wallets
                .filter((wallet) => gradeFilter === 'all' || normalizeValue(wallet.grade) === gradeFilter)
                .map((wallet) => normalizeValue(wallet.class))
                .filter(Boolean),
        )).sort((a, b) => Number(a) - Number(b)),
        [gradeFilter, wallets],
    );

    const numberOptions = useMemo(
        () => Array.from(new Set(
            wallets
                .filter((wallet) => gradeFilter === 'all' || normalizeValue(wallet.grade) === gradeFilter)
                .filter((wallet) => classFilter === 'all' || normalizeValue(wallet.class) === classFilter)
                .map((wallet) => normalizeValue(wallet.number))
                .filter(Boolean),
        )).sort((a, b) => Number(a) - Number(b)),
        [classFilter, gradeFilter, wallets],
    );

    const filteredWallets = useMemo(() => wallets.filter((wallet) => {
        const matchesGrade = gradeFilter === 'all' || normalizeValue(wallet.grade) === gradeFilter;
        const matchesClass = classFilter === 'all' || normalizeValue(wallet.class) === classFilter;
        const matchesNumber = numberFilter === 'all' || normalizeValue(wallet.number) === numberFilter;
        const keyword = nameSearch.trim();
        const matchesName = !keyword || normalizeValue(wallet.studentName).includes(keyword);
        return matchesGrade && matchesClass && matchesNumber && matchesName;
    }), [classFilter, gradeFilter, nameSearch, numberFilter, wallets]);

    const sortedWallets = useMemo(
        () => sortOverviewWallets(filteredWallets, overviewSortKey, overviewSortDirection),
        [filteredWallets, overviewSortDirection, overviewSortKey],
    );

    const overviewTotalPages = useMemo(
        () => Math.max(1, Math.ceil(sortedWallets.length / OVERVIEW_PAGE_SIZE)),
        [sortedWallets.length],
    );

    const currentOverviewPage = Math.min(overviewPage, overviewTotalPages);

    const paginatedWallets = useMemo(() => {
        const startIndex = (currentOverviewPage - 1) * OVERVIEW_PAGE_SIZE;
        return sortedWallets.slice(startIndex, startIndex + OVERVIEW_PAGE_SIZE);
    }, [currentOverviewPage, sortedWallets]);

    const selectedWallet = useMemo(
        () => wallets.find((wallet) => wallet.uid === selectedUid) || null,
        [selectedUid, wallets],
    );

    const walletMap = useMemo(
        () => new Map(wallets.map((wallet) => [wallet.uid, wallet])),
        [wallets],
    );
    const isGlobalGrantSearch = grantNameSearch.trim().length > 0;

    const grantNumberOptions = useMemo(
        () => Array.from(new Set(
            students
                .filter((student) => grantGradeFilter === 'all' || normalizeValue(student.grade) === grantGradeFilter)
                .filter((student) => grantClassFilter === 'all' || normalizeValue(student.class) === grantClassFilter)
                .map((student) => normalizeValue(student.number))
                .filter(Boolean),
        )).sort((a, b) => Number(a) - Number(b)),
        [grantClassFilter, grantGradeFilter, students],
    );

    const filteredGrantStudents = useMemo(() => students
        .filter((student) => {
            const matchesGrade = grantGradeFilter === 'all' || normalizeValue(student.grade) === grantGradeFilter;
            const matchesClass = grantClassFilter === 'all' || normalizeValue(student.class) === grantClassFilter;
            const matchesNumber = grantNumberFilter === 'all' || normalizeValue(student.number) === grantNumberFilter;
            const keyword = normalizeSearchValue(grantNameSearch);
            const matchesName = !keyword || normalizeSearchValue(student.studentName).includes(keyword);
            return matchesGrade && matchesClass && matchesNumber && matchesName;
        })
        .map((student) => ({
            ...student,
            wallet: walletMap.get(student.uid) || null,
        })), [grantClassFilter, grantGradeFilter, grantNameSearch, grantNumberFilter, students, walletMap]);

    const selectedGrantStudent = useMemo(() => {
        const matchedFilteredStudent = filteredGrantStudents.find((student) => student.uid === grantSelectedUid);
        if (matchedFilteredStudent) return matchedFilteredStudent;
        const matchedStudent = students.find((student) => student.uid === grantSelectedUid);
        if (!matchedStudent) return null;
        return {
            ...matchedStudent,
            wallet: walletMap.get(grantSelectedUid) || null,
        };
    }, [filteredGrantStudents, grantSelectedUid, students, walletMap]);

    const filteredOrders = useMemo(() => (
        orderFilter === 'all' ? orders : orders.filter((order) => order.status === orderFilter)
    ), [orderFilter, orders]);

    const selectedOrder = useMemo(
        () => filteredOrders.find((order) => order.id === selectedOrderId)
            || orders.find((order) => order.id === selectedOrderId)
            || null,
        [filteredOrders, orders, selectedOrderId],
    );

    const selectedEditableTransaction = useMemo(
        () => transactions.find((transaction) => transaction.id === selectedEditableTransactionId) || null,
        [selectedEditableTransactionId, transactions],
    );

    const loadTransactionsForWallet = async (uid: string) => {
        if (!uid) {
            setTransactions([]);
            return;
        }
        const nextTransactions = await listPointTransactionsByUid(config, uid, 20);
        setTransactions(nextTransactions);
    };

    const loadAll = async () => {
        if (!canRead) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const [nextWallets, nextSchoolOptions, nextPolicy, nextProducts, nextOrders] = await Promise.all([
                listPointWallets(config),
                getPointSchoolOptions(),
                getPointPolicy(config),
                listPointProducts(config, false),
                listPointOrders(config),
            ]);
            const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) => needsPointRankLegacyFallback(wallet))
                ? await getPointRankManualAdjustEarnedPointsMap(config)
                : {};

            setWallets(nextWallets);
            setGrantGradeOptions(nextSchoolOptions.grades);
            setGrantClassOptions(nextSchoolOptions.classes);
            setSavedPolicy(nextPolicy);
            setPolicyDraft(nextPolicy);
            setPolicyDirty(false);
            setPolicyFeedbackMessage('');
            setPolicyFeedbackTone(null);
            setRankThemeDraft(createRankThemeDraft(nextPolicy.rankPolicy));
            setRankThemeDirty(false);
            setRankThemeFeedbackMessage('');
            setRankThemeFeedbackTone(null);
            setRankSettingsDraft(createRankSettingsDraft(nextPolicy.rankPolicy));
            setRankSettingsDirty(false);
            setRankSettingsFeedbackMessage('');
            setRankSettingsFeedbackTone(null);
            setRankEmojiDraft(createRankEmojiCollectionDraft(nextPolicy.rankPolicy));
            setRankEmojiDirty(false);
            setRankEmojiFeedbackMessage('');
            setRankEmojiFeedbackTone(null);
            setProducts(nextProducts);
            setProductOrderDirty(false);
            setProductOrderSaving(false);
            setProductOrderFeedback('');
            setOrders(nextOrders);
            setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);

            const nextSelectedUid = selectedUid && nextWallets.some((wallet) => wallet.uid === selectedUid)
                ? selectedUid
                : nextWallets[0]?.uid || '';
            setSelectedUid(nextSelectedUid);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab === 'grant' || requestedTab === 'policy' || requestedTab === 'ranks' || requestedTab === 'hall-of-fame' || requestedTab === 'products' || requestedTab === 'requests') {
            setActiveTab(requestedTab);
            return;
        }
        setActiveTab('overview');
    }, [searchParams]);

    useEffect(() => {
        void loadAll();
    }, [canRead, config]);

    useEffect(() => {
        if (!selectedUid) {
            setTransactions([]);
            return;
        }

        let cancelled = false;
        const loadTransactions = async () => {
            const nextTransactions = await listPointTransactionsByUid(config, selectedUid, 20);
            if (!cancelled) setTransactions(nextTransactions);
        };

        void loadTransactions();
        return () => {
            cancelled = true;
        };
    }, [config, selectedUid]);

    useEffect(() => {
        if (!selectedEditableTransaction) {
            setAdjustmentDraftValue('');
            return;
        }
        setAdjustmentDraftValue(String(selectedEditableTransaction.delta || ''));
    }, [selectedEditableTransaction]);

    useEffect(() => {
        setSelectedEditableTransactionId('');
        setAdjustmentDraftValue('');
        setAdjustmentFeedback('');
    }, [selectedUid]);

    useEffect(() => {
        if (classFilter !== 'all' && !classOptions.includes(classFilter)) setClassFilter('all');
    }, [classFilter, classOptions]);

    useEffect(() => {
        if (numberFilter !== 'all' && !numberOptions.includes(numberFilter)) setNumberFilter('all');
    }, [numberFilter, numberOptions]);

    useEffect(() => {
        setOverviewPage(1);
    }, [classFilter, gradeFilter, nameSearch, numberFilter]);

    useEffect(() => {
        if (overviewPage > overviewTotalPages) {
            setOverviewPage(overviewTotalPages);
        }
    }, [overviewPage, overviewTotalPages]);

    useEffect(() => {
        if (sortedWallets.length === 0) {
            if (selectedUid) setSelectedUid('');
            return;
        }

        if (!selectedUid) {
            setSelectedUid(paginatedWallets[0]?.uid || sortedWallets[0]?.uid || '');
            return;
        }

        if (!filteredWallets.some((wallet) => wallet.uid === selectedUid)) {
            setSelectedUid(paginatedWallets[0]?.uid || sortedWallets[0]?.uid || '');
            return;
        }

        if (!paginatedWallets.some((wallet) => wallet.uid === selectedUid)) {
            setSelectedUid(paginatedWallets[0]?.uid || '');
        }
    }, [filteredWallets, paginatedWallets, selectedUid, sortedWallets]);

    useEffect(() => {
        if (grantClassFilter !== 'all' && !grantClassOptions.some((option) => option.value === grantClassFilter)) setGrantClassFilter('all');
    }, [grantClassFilter, grantClassOptions]);

    useEffect(() => {
        if (grantNumberFilter !== 'all' && !grantNumberOptions.includes(grantNumberFilter)) setGrantNumberFilter('all');
    }, [grantNumberFilter, grantNumberOptions]);

    useEffect(() => {
        if (grantSelectedUid && !filteredGrantStudents.some((student) => student.uid === grantSelectedUid)) {
            setGrantSelectedUid(filteredGrantStudents[0]?.uid || '');
        }
    }, [filteredGrantStudents, grantSelectedUid]);

    useEffect(() => {
        if (!isGlobalGrantSearch && (grantGradeFilter === 'all' || grantClassFilter === 'all')) {
            setStudents([]);
            setGrantSelectedUid('');
            setGrantNumberFilter('all');
            return;
        }

        let cancelled = false;
        const loadGrantStudents = async () => {
            setGrantLoading(true);
            try {
                const nextStudents = isGlobalGrantSearch
                    ? await listPointStudentTargets()
                    : await listPointStudentTargetsByClass(grantGradeFilter, grantClassFilter);
                if (cancelled) return;
                setStudents(nextStudents);
                setGrantSelectedUid((prev) => (
                    prev && nextStudents.some((student) => student.uid === prev)
                        ? prev
                        : nextStudents[0]?.uid || ''
                ));
            } finally {
                if (!cancelled) setGrantLoading(false);
            }
        };

        void loadGrantStudents();
        return () => {
            cancelled = true;
        };
    }, [grantClassFilter, grantGradeFilter, isGlobalGrantSearch]);

    useEffect(() => {
        setOrderMemo(selectedOrder?.memo || '');
    }, [selectedOrder?.id, selectedOrder?.memo]);

    useEffect(() => () => {
        if (productImagePreviewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(productImagePreviewUrl);
        }
    }, [productImagePreviewUrl]);

    const handleOverviewSortChange = (sortKey: Exclude<OverviewSortKey, 'none'>) => {
        const nextSortDirection: OverviewSortDirection = overviewSortKey === sortKey
            ? (overviewSortDirection === 'desc' ? 'asc' : 'desc')
            : (sortKey === 'affiliation' ? 'asc' : 'desc');
        const nextSortedWallets = sortOverviewWallets(filteredWallets, sortKey, nextSortDirection);
        const selectedIndex = nextSortedWallets.findIndex((wallet) => wallet.uid === selectedUid);

        setOverviewSortKey(sortKey);
        setOverviewSortDirection(nextSortDirection);
        setOverviewPage(selectedIndex >= 0 ? Math.floor(selectedIndex / OVERVIEW_PAGE_SIZE) + 1 : 1);
    };

    const handleOverviewPageChange = (page: number) => {
        const nextPage = Math.min(Math.max(page, 1), overviewTotalPages);
        setOverviewPage(nextPage);
    };

    const handleTabChange = (tab: TeacherPointTab) => {
        setGrantFeedback('');
        setPolicyFeedbackMessage('');
        setPolicyFeedbackTone(null);
        setProductFeedback('');
        setOrderFeedback('');
        setSearchParams(tab === 'overview' ? {} : { tab });
    };

    const updatePolicyDraft = (updater: (prev: PointPolicy) => PointPolicy) => {
        setPolicyDraft((prev) => updater(prev));
        setPolicyDirty(true);
        setPolicyFeedbackMessage('');
        setPolicyFeedbackTone(null);
    };

    const updateRankThemeDraft = (updater: (prev: RankThemeDraft) => RankThemeDraft) => {
        setRankThemeDraft((prev) => updater(prev));
        setRankThemeDirty(true);
        setRankThemeFeedbackMessage('');
        setRankThemeFeedbackTone(null);
    };

    const updateRankSettingsDraft = (updater: (prev: RankSettingsDraft) => RankSettingsDraft) => {
        setRankSettingsDraft((prev) => updater(prev));
        setRankSettingsDirty(true);
        setRankSettingsFeedbackMessage('');
        setRankSettingsFeedbackTone(null);
    };

    const updateRankEmojiDraft = (updater: (prev: RankEmojiCollectionDraft) => RankEmojiCollectionDraft) => {
        setRankEmojiDraft((prev) => updater(prev));
        setRankEmojiDirty(true);
        setRankEmojiFeedbackMessage('');
        setRankEmojiFeedbackTone(null);
    };

    const resolveProductSortOrder = (
        productId: string,
        fallbackSortOrder = '',
    ) => {
        if (productId) {
            const existingProduct = products.find((item) => item.id === productId);
            if (existingProduct) return Number(existingProduct.sortOrder || 0);
        }

        if (!productId) {
            return getNextPointProductSortOrder(products);
        }

        const numericFallback = Number(fallbackSortOrder);
        return Number.isFinite(numericFallback) ? numericFallback : getNextPointProductSortOrder(products);
    };

    const handleReorderProducts = (sourceId: string, targetId: string) => {
        const nextProducts = reorderPointProducts(products, sourceId, targetId);
        if (nextProducts === products) return;
        setProducts(nextProducts);
        setProductOrderDirty(true);
        setProductOrderFeedback('');
    };

    const handleSaveProductOrder = async () => {
        if (!canManage || !productOrderDirty || productOrderSaving) return;

        const orderedProducts = resequencePointProducts(sortPointProducts(products));
        setProductOrderSaving(true);
        setProductOrderFeedback('');

        try {
            await Promise.all(orderedProducts.map((product) => upsertPointProduct(config, {
                ...product,
                sortOrder: product.sortOrder,
            }, actor)));
            setProducts(orderedProducts);
            setProductOrderDirty(false);
            setProductOrderFeedback('상품 순서를 저장했습니다.');
        } catch (error: any) {
            console.error('Failed to save product order:', error);
            setProductOrderFeedback(error?.message || '상품 순서 저장에 실패했습니다.');
        } finally {
            setProductOrderSaving(false);
        }
    };

    const getGrantFailureMessage = (error: any, mode: GrantMode) => {
        const errorCode = normalizeValue(error?.code).toLowerCase();
        const rawMessage = normalizeValue(error?.message);
        const normalizedMessage = rawMessage.toLowerCase();

        if (
            errorCode === 'functions/permission-denied'
            || normalizedMessage.includes('permission is required')
            || normalizedMessage.includes('cannot use westory point functions')
        ) {
            return '위스 관리 권한을 확인한 뒤 다시 시도해 주세요.';
        }

        if (
            errorCode === 'functions/not-found'
            || normalizedMessage.includes('user profile is missing')
            || normalizedMessage.includes('target uid is required')
        ) {
            return '학생 정보를 다시 불러온 뒤 다시 시도해 주세요.';
        }

        if (
            errorCode === 'functions/failed-precondition'
            || errorCode === 'functions/invalid-argument'
        ) {
            if (normalizedMessage.includes('manual point adjustment is disabled')) {
                return '현재 위스 정책에서 지급 및 환수가 잠겨 있습니다. 정책 설정을 확인해 주세요.';
            }
            if (normalizedMessage.includes('insufficient point balance')) {
                return '환수할 위스가 부족합니다. 현재 보유 위스를 확인한 뒤 다시 시도해 주세요.';
            }
            if (normalizedMessage.includes('reason is required')) {
                return mode === 'grant'
                    ? '위스 지급 사유를 입력해 주세요.'
                    : '위스 환수 사유를 입력해 주세요.';
            }
            if (
                normalizedMessage.includes('point delta must be a non-zero finite number')
                || normalizedMessage.includes('manual adjustment mode does not match the point delta')
            ) {
                return '위스 수량을 다시 확인한 뒤 다시 시도해 주세요.';
            }
        }

        if (
            errorCode === 'functions/unavailable'
            || errorCode === 'functions/deadline-exceeded'
        ) {
            return '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
        }

        if (
            !rawMessage
            || normalizedMessage === 'internal'
            || errorCode === 'functions/internal'
        ) {
            return mode === 'grant'
                ? '위스 지급 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
                : '위스 환수 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
        }

        if (
            rawMessage.startsWith('functions/')
            || /^[a-z0-9 _.'-]+$/i.test(rawMessage)
        ) {
            return mode === 'grant'
                ? '위스 지급 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
                : '위스 환수 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
        }

        return rawMessage;
    };

    const handleSaveGrant = async (event: React.FormEvent, mode: GrantMode = 'grant') => {
        event.preventDefault();
        if (!selectedGrantStudent || !canManage || grantSubmittingMode) return;

        const numericAmount = Number(grantAmount);
        if (!numericAmount || numericAmount < 1) {
            setGrantFeedback('위스 수량은 1 이상으로 입력해 주세요.');
            return;
        }
        if (!grantReason.trim()) {
            setGrantFeedback(mode === 'grant' ? '위스 지급 사유를 입력해 주세요.' : '위스 환수 사유를 입력해 주세요.');
            return;
        }

        const actionLabel = mode === 'grant' ? '지급' : '환수';
        setGrantSubmittingMode(mode);
        setGrantFeedback('');
        try {
            await adjustPoints({
                config,
                uid: selectedGrantStudent.uid,
                delta: mode === 'reclaim' ? -numericAmount : numericAmount,
                sourceId: `manual_${Date.now()}`,
                sourceLabel: grantReason.trim(),
                mode,
                actor,
            });
            setGrantAmount('');
            setGrantReason('');
            setGrantFeedback(mode === 'grant' ? '지급되었습니다.' : '환수되었습니다.');

            const nextWallets = await listPointWallets(config);
            const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) => needsPointRankLegacyFallback(wallet))
                ? await getPointRankManualAdjustEarnedPointsMap(config)
                : {};
            setWallets(nextWallets);
            setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);

            const nextSelectedUid = nextWallets.some((wallet) => wallet.uid === selectedGrantStudent.uid)
                ? selectedGrantStudent.uid
                : selectedUid && nextWallets.some((wallet) => wallet.uid === selectedUid)
                    ? selectedUid
                : nextWallets[0]?.uid || '';
            setSelectedUid(nextSelectedUid);
            await loadTransactionsForWallet(nextSelectedUid);
            showToast({
                tone: 'success',
                title: `${actionLabel}되었습니다.`,
                message: `${selectedGrantStudent.studentName} 학생의 위스 현황을 최신 상태로 반영했습니다.`,
            });
        } catch (error: any) {
            console.error('Failed to adjust points:', error);
            const failureMessage = getGrantFailureMessage(error, mode);
            setGrantFeedback(failureMessage);
            showToast({
                tone: 'error',
                title: `위스 ${actionLabel}에 실패했습니다.`,
                message: failureMessage,
            });
        } finally {
            setGrantSubmittingMode(null);
        }
    };

    const handleSavePolicy = async () => {
        if (!canManage) return;

        const sanitizedPolicy: PointPolicy = {
            ...savedPolicy,
            ...policyDraft,
            rankPolicy: savedPolicy.rankPolicy,
        };

        try {
            await upsertPointPolicy(config, sanitizedPolicy, actor);
            const confirmedPolicy = await getPointPolicy(config);
            applyConfirmedPolicy(confirmedPolicy);
            setPolicyDraft(confirmedPolicy);
            setPolicyDirty(false);
            setPolicyFeedbackTone('success');
            setPolicyFeedbackMessage('운영 정책이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save point policy:', error);
            setPolicyFeedbackTone('error');
            setPolicyFeedbackMessage('저장 중 문제가 발생했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.');
        }
    };

    const handleSaveRankTheme = async () => {
        if (!canManage) return;

        const mergedRankPolicy = resolvePointRankPolicyDraft({
            ...savedRankPolicy,
            activeThemeId: rankThemeDraft.activeThemeId,
            themeId: rankThemeDraft.activeThemeId,
        });

        try {
            await upsertPointPolicy(config, {
                ...savedPolicy,
                rankPolicy: mergedRankPolicy,
            }, actor);
            const confirmedPolicy = await getPointPolicy(config);
            applyConfirmedPolicy(confirmedPolicy, { resetThemeDraft: true });
            setRankThemeDirty(false);
            setRankThemeFeedbackTone('success');
            setRankThemeFeedbackMessage('테마 설정이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save rank theme:', error);
            setRankThemeFeedbackTone('error');
            setRankThemeFeedbackMessage('테마 설정 저장에 실패했습니다. 다시 시도해 주세요.');
        }
    };

    const handleSaveRankSettings = async () => {
        if (!canManage) return;

        const nextTiers = cloneRankTiers(rankSettingsDraft.tiers);
        const nextThemes = cloneRankThemes(rankSettingsDraft.themes);
        const mergedRankPolicy = resolvePointRankPolicyDraft({
            ...savedRankPolicy,
            tiers: nextTiers,
            themes: nextThemes,
            celebrationPolicy: {
                ...rankSettingsDraft.celebrationPolicy,
            },
            emojiRegistry: syncRankEmojiUnlockTierCodes(nextTiers, savedRankPolicy.emojiRegistry),
        });
        const validationError = getPointRankPolicyValidationError(mergedRankPolicy);
        if (validationError) {
            setRankSettingsFeedbackTone('warning');
            setRankSettingsFeedbackMessage(`저장 전에 확인해 주세요. ${validationError}`);
            return;
        }

        try {
            await upsertPointPolicy(config, {
                ...savedPolicy,
                rankPolicy: mergedRankPolicy,
            }, actor);
            const confirmedPolicy = await getPointPolicy(config);
            applyConfirmedPolicy(confirmedPolicy, { resetRankSettingsDraft: true });
            setRankSettingsDirty(false);
            setRankSettingsFeedbackTone('success');
            setRankSettingsFeedbackMessage('등급 관리가 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save rank settings:', error);
            setRankSettingsFeedbackTone('error');
            setRankSettingsFeedbackMessage('등급 관리 저장에 실패했습니다. 다시 시도해 주세요.');
        }
    };

    const handleSaveRankEmojiCollection = async () => {
        if (!canManage) return;

        const mergedRankPolicy = resolvePointRankPolicyDraft({
            ...savedRankPolicy,
            tiers: cloneRankTiers(rankEmojiDraft.tiers),
            emojiRegistry: syncRankEmojiUnlockTierCodes(
                cloneRankTiers(rankEmojiDraft.tiers),
                cloneRankEmojiRegistry(rankEmojiDraft.emojiRegistry),
            ),
        });
        const validationError = getPointRankPolicyValidationError(mergedRankPolicy);
        if (validationError) {
            setRankEmojiFeedbackTone('warning');
            setRankEmojiFeedbackMessage(`저장 전에 확인해 주세요. ${validationError}`);
            return;
        }

        try {
            await upsertPointPolicy(config, {
                ...savedPolicy,
                rankPolicy: mergedRankPolicy,
            }, actor);
            const confirmedPolicy = await getPointPolicy(config);
            applyConfirmedPolicy(confirmedPolicy, { resetEmojiDraft: true });
            setRankEmojiDirty(false);
            setRankEmojiFeedbackTone('success');
            setRankEmojiFeedbackMessage('이모지 모음이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save rank emoji collection:', error);
            setRankEmojiFeedbackTone('error');
            setRankEmojiFeedbackMessage('이모지 모음 저장에 실패했습니다. 다시 시도해 주세요.');
        }
    };

    const handleProductImageChange = (file: File | null) => {
        setProductFeedback('');
        setProductImageFile(file);
        setProductImagePreviewUrl((prev) => {
            if (prev.startsWith('blob:')) {
                URL.revokeObjectURL(prev);
            }
            return file ? URL.createObjectURL(file) : (productForm.previewImageUrl || productForm.imageUrl || '');
        });
    };

    const handleSaveProduct = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canManage) return;
        if (!productForm.name.trim()) {
            setProductFeedback('상품명을 입력해 주세요.');
            return;
        }

        try {
            const sortOrder = resolveProductSortOrder(productForm.id, productForm.sortOrder);
            const savedProduct: PointProduct = {
                id: productForm.id || crypto.randomUUID(),
                name: productForm.name.trim(),
                description: productForm.description.trim(),
                price: Number(productForm.price || 0),
                stock: Number(productForm.stock || 0),
                imageUrl: productForm.imageUrl.trim(),
                previewImageUrl: productForm.previewImageUrl.trim(),
                imageStoragePath: productForm.imageStoragePath.trim(),
                previewStoragePath: productForm.previewStoragePath.trim(),
                sortOrder,
                isActive: productForm.isActive,
            };
            await upsertPointProduct(config, {
                ...savedProduct,
                id: productForm.id || undefined,
            }, actor);
            setProductForm(createEmptyProductForm());
            setProductFeedback('상품 정보를 저장했습니다.');
            setProducts((prev) => mergePointProductIntoList(prev, savedProduct));
        } catch (error: any) {
            console.error('Failed to save point product:', error);
            setProductFeedback(error?.message || '상품 저장에 실패했습니다.');
        }
    };

    const handleSaveProductWithUpload = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canManage) return;
        if (!productForm.name.trim()) {
            setProductFeedback('상품명을 입력해 주세요.');
            return;
        }

        try {
            const productId = productForm.id || crypto.randomUUID();
            const sortOrder = resolveProductSortOrder(productForm.id, productForm.sortOrder);
            let imagePayload = {
                imageUrl: productForm.imageUrl.trim(),
                previewImageUrl: productForm.previewImageUrl.trim(),
                imageStoragePath: productForm.imageStoragePath.trim(),
                previewStoragePath: productForm.previewStoragePath.trim(),
            };

            if (productImageFile) {
                setProductImageUploading(true);
                const { year, semester } = getYearSemester(config);
                const basePath = `years/${year}/semesters/${semester}/point_products/${productId}`;
                const compressedBlob = await buildResizedImageBlob(productImageFile, 960, 0.82);
                const previewBlob = await buildResizedImageBlob(productImageFile, 320, 0.62);
                const imageRef = ref(storage, `${basePath}/image.jpg`);
                const previewRef = ref(storage, `${basePath}/preview.jpg`);

                await uploadBytes(imageRef, compressedBlob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=86400' });
                await uploadBytes(previewRef, previewBlob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=86400' });

                imagePayload = {
                    imageUrl: await getDownloadURL(imageRef),
                    previewImageUrl: await getDownloadURL(previewRef),
                    imageStoragePath: imageRef.fullPath,
                    previewStoragePath: previewRef.fullPath,
                };
            }

            await upsertPointProduct(config, {
                id: productId,
                name: productForm.name.trim(),
                description: productForm.description.trim(),
                price: Number(productForm.price || 0),
                stock: Number(productForm.stock || 0),
                imageUrl: imagePayload.imageUrl,
                previewImageUrl: imagePayload.previewImageUrl,
                imageStoragePath: imagePayload.imageStoragePath,
                previewStoragePath: imagePayload.previewStoragePath,
                sortOrder,
                isActive: productForm.isActive,
            }, actor);
            setProductForm(createEmptyProductForm());
            setProductImageFile(null);
            setProductImagePreviewUrl('');
            setProductFeedback('상품 정보를 저장했습니다.');
            setProducts((prev) => mergePointProductIntoList(prev, {
                id: productId,
                name: productForm.name.trim(),
                description: productForm.description.trim(),
                price: Number(productForm.price || 0),
                stock: Number(productForm.stock || 0),
                imageUrl: imagePayload.imageUrl,
                previewImageUrl: imagePayload.previewImageUrl,
                imageStoragePath: imagePayload.imageStoragePath,
                previewStoragePath: imagePayload.previewStoragePath,
                sortOrder,
                isActive: productForm.isActive,
            }));
        } catch (error: any) {
            console.error('Failed to save point product with upload:', error);
            setProductFeedback(error?.message || '상품 저장에 실패했습니다.');
        } finally {
            setProductImageUploading(false);
        }
    };

    const handleToggleProduct = async (product: PointProduct) => {
        if (!canManage) return;

        try {
            await upsertPointProduct(config, {
                ...product,
                isActive: !product.isActive,
            }, actor);
            setProducts((prev) => prev.map((item) => (
                item.id === product.id
                    ? {
                        ...item,
                        isActive: !product.isActive,
                    }
                    : item
            )));
            setProductFeedback(product.isActive ? '상품을 비활성화했습니다.' : '상품을 다시 노출했습니다.');
        } catch (error: any) {
            console.error('Failed to toggle point product:', error);
            setProductFeedback(error?.message || '상품 상태 변경에 실패했습니다.');
        }
    };

    const handleSaveOrder = async (
        nextStatus: Extract<PointOrderStatus, 'approved' | 'rejected' | 'fulfilled' | 'cancelled'>,
    ) => {
        if (!selectedOrder || !canManage) return;

        try {
            await reviewPointOrder({
                config,
                orderId: selectedOrder.id,
                nextStatus,
                actor,
                memo: orderMemo,
            });
            setOrderFeedback('구매 요청 상태를 반영했습니다.');
            setOrders(await listPointOrders(config));
        } catch (error: any) {
            console.error('Failed to review point order:', error);
            setOrderFeedback(error?.message || '요청 상태 변경에 실패했습니다.');
        }
    };

    const handleSelectEditableTransaction = (transactionId: string) => {
        setAdjustmentFeedback('');
        setSelectedEditableTransactionId(transactionId);
    };

    const refreshOverviewData = async () => {
        const nextWallets = await listPointWallets(config);
        const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) => needsPointRankLegacyFallback(wallet))
            ? await getPointRankManualAdjustEarnedPointsMap(config)
            : {};
        setWallets(nextWallets);
        setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);
        if (selectedUid) {
            await loadTransactionsForWallet(selectedUid);
        }
    };

    const handleSubmitAdjustmentUpdate = async () => {
        if (!selectedEditableTransaction || !selectedUid || !canManage) return;

        const nextDelta = Number(adjustmentDraftValue);
        if (!Number.isFinite(nextDelta) || nextDelta === 0) {
            setAdjustmentFeedback('수정 위스는 0이 아닌 숫자로 입력해 주세요.');
            return;
        }

        try {
            setAdjustmentSaving(true);
            setAdjustmentFeedback('');
            await updatePointAdjustment({
                config,
                transactionId: selectedEditableTransaction.id,
                action: 'update',
                nextDelta,
            });
            await refreshOverviewData();
            setAdjustmentFeedback('직접 조정 위스를 수정했습니다.');
        } catch (error: any) {
            console.error('Failed to update point adjustment:', error);
            setAdjustmentFeedback(error?.message || '직접 조정 위스 수정에 실패했습니다.');
        } finally {
            setAdjustmentSaving(false);
        }
    };

    const handleSubmitAdjustmentCancel = async () => {
        if (!selectedEditableTransaction || !selectedUid || !canManage) return;

        try {
            setAdjustmentSaving(true);
            setAdjustmentFeedback('');
            await updatePointAdjustment({
                config,
                transactionId: selectedEditableTransaction.id,
                action: 'cancel',
            });
            await refreshOverviewData();
            setSelectedEditableTransactionId('');
            setAdjustmentDraftValue('');
            setAdjustmentFeedback('직접 조정 내역을 취소했습니다.');
        } catch (error: any) {
            console.error('Failed to cancel point adjustment:', error);
            setAdjustmentFeedback(error?.message || '직접 조정 취소에 실패했습니다.');
        } finally {
            setAdjustmentSaving(false);
        }
    };

    if (!canRead) {
        return (
            <div className="flex min-h-screen flex-col bg-gray-50">
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm font-bold text-red-700">
                        위스 관리 화면을 볼 권한이 없습니다.
                    </div>
                </main>
            </div>
        );
    }

    const usesSharedPanelFrame = activeTab !== 'ranks' && activeTab !== 'hall-of-fame';

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">
                <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
                    {(Object.keys(TEACHER_POINT_TAB_LABELS) as TeacherPointTab[]).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => handleTabChange(tab)}
                            className={`border-b-2 px-6 py-3 text-sm font-bold transition whitespace-nowrap ${
                                activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {TEACHER_POINT_TAB_LABELS[tab]}
                        </button>
                    ))}
                </div>

                {!canManage && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                        읽기 전용 권한으로 접속 중입니다.
                    </div>
                )}

                <div className={usesSharedPanelFrame ? 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm' : ''}>
                    {loading && (
                        <div className={usesSharedPanelFrame ? 'py-16 text-center text-gray-400' : 'rounded-2xl border border-gray-200 bg-white py-16 text-center text-gray-400 shadow-sm'}>
                            <div className="mb-2 text-2xl">
                                <i className="fas fa-spinner fa-spin"></i>
                            </div>
                            <p className="font-bold">위스 정보를 불러오는 중입니다.</p>
                        </div>
                    )}

                    {!loading && activeTab === 'overview' && (
                        <PointsOverviewTab
                            wallets={paginatedWallets}
                            totalWalletCount={sortedWallets.length}
                            currentPage={currentOverviewPage}
                            totalPages={overviewTotalPages}
                            sortKey={overviewSortKey}
                            sortDirection={overviewSortDirection}
                            selectedWallet={selectedWallet}
                            selectedUid={selectedUid}
                            rankPolicy={savedPolicy.rankPolicy}
                            rankManualAdjustEarnedPointsByUid={rankManualAdjustEarnedPointsByUid}
                            gradeFilter={gradeFilter}
                            classFilter={classFilter}
                            numberFilter={numberFilter}
                            nameSearch={nameSearch}
                            gradeOptions={gradeOptions}
                            classOptions={classOptions}
                            numberOptions={numberOptions}
                            transactions={transactions}
                            canManage={canManage}
                            selectedEditableTransactionId={selectedEditableTransactionId}
                            adjustmentDraftValue={adjustmentDraftValue}
                            adjustmentFeedback={adjustmentFeedback}
                            adjustmentSaving={adjustmentSaving}
                            onGradeFilterChange={setGradeFilter}
                            onClassFilterChange={setClassFilter}
                            onNumberFilterChange={setNumberFilter}
                            onNameSearchChange={setNameSearch}
                            onSortChange={handleOverviewSortChange}
                            onPageChange={handleOverviewPageChange}
                            onSelectWallet={setSelectedUid}
                            onSelectEditableTransaction={handleSelectEditableTransaction}
                            onAdjustmentDraftChange={setAdjustmentDraftValue}
                            onSubmitAdjustmentUpdate={handleSubmitAdjustmentUpdate}
                            onSubmitAdjustmentCancel={handleSubmitAdjustmentCancel}
                        />
                    )}

                    {!loading && activeTab === 'grant' && (
                        <PointGrantTab
                            students={filteredGrantStudents}
                            selectedStudent={selectedGrantStudent}
                            selectedUid={grantSelectedUid}
                            rankPolicy={savedPolicy.rankPolicy}
                            rankManualAdjustEarnedPointsByUid={rankManualAdjustEarnedPointsByUid}
                            canManage={canManage}
                            manualAdjustEnabled={savedPolicy.manualAdjustEnabled}
                            allowNegativeBalance={savedPolicy.allowNegativeBalance}
                            loading={grantLoading}
                            gradeFilter={grantGradeFilter}
                            classFilter={grantClassFilter}
                            numberFilter={grantNumberFilter}
                            nameSearch={grantNameSearch}
                            gradeOptions={grantGradeOptions.map((option) => option.value)}
                            classOptions={grantClassOptions.map((option) => option.value)}
                            numberOptions={grantNumberOptions}
                            amount={grantAmount}
                            reason={grantReason}
                            feedback={grantFeedback}
                            submittingMode={grantSubmittingMode}
                            onGradeFilterChange={setGrantGradeFilter}
                            onClassFilterChange={setGrantClassFilter}
                            onNumberFilterChange={setGrantNumberFilter}
                            onNameSearchChange={setGrantNameSearch}
                            onSelectStudent={setGrantSelectedUid}
                            onAmountChange={setGrantAmount}
                            onReasonChange={setGrantReason}
                            onSubmit={handleSaveGrant}
                        />
                    )}

                    {!loading && activeTab === 'policy' && (
                        <PointPolicyTab
                            policy={policyDraft}
                            canManage={canManage}
                            hasUnsavedChanges={policyDirty}
                            saveFeedbackMessage={policyFeedbackMessage}
                            saveFeedbackTone={policyFeedbackTone}
                            onPolicyChange={updatePolicyDraft}
                            onSubmit={handleSavePolicy}
                        />
                    )}

                    {!loading && activeTab === 'ranks' && (
                        <PointRanksTab
                            savedRankPolicy={savedRankPolicy}
                            canManage={canManage}
                            themeDraft={rankThemeDraft}
                            themeHasUnsavedChanges={rankThemeDirty}
                            themeSaveFeedbackMessage={rankThemeFeedbackMessage}
                            themeSaveFeedbackTone={rankThemeFeedbackTone}
                            onThemeDraftChange={updateRankThemeDraft}
                            onThemeSave={handleSaveRankTheme}
                            rankSettingsDraft={rankSettingsDraft}
                            rankSettingsHasUnsavedChanges={rankSettingsDirty}
                            rankSettingsSaveFeedbackMessage={rankSettingsFeedbackMessage}
                            rankSettingsSaveFeedbackTone={rankSettingsFeedbackTone}
                            onRankSettingsDraftChange={updateRankSettingsDraft}
                            onRankSettingsSave={handleSaveRankSettings}
                            emojiDraft={rankEmojiDraft}
                            emojiHasUnsavedChanges={rankEmojiDirty}
                            emojiSaveFeedbackMessage={rankEmojiFeedbackMessage}
                            emojiSaveFeedbackTone={rankEmojiFeedbackTone}
                            onEmojiDraftChange={updateRankEmojiDraft}
                            onEmojiSave={handleSaveRankEmojiCollection}
                        />
                    )}

                    {!loading && activeTab === 'hall-of-fame' && (
                        <HallOfFameManagementTab
                            config={config}
                            interfaceConfig={interfaceConfig}
                            canManage={canManage}
                            onInterfaceConfigRefresh={refreshInterfaceConfig}
                        />
                    )}

                    {!loading && activeTab === 'products' && (
                        <PointProductsTab
                            products={products}
                            productForm={productForm}
                            productFeedback={productFeedback}
                            canManage={canManage}
                            productImagePreviewUrl={productImagePreviewUrl}
                            productImageUploading={productImageUploading}
                            onProductFormChange={(updater) => setProductForm((prev) => updater(prev))}
                            onProductImageChange={handleProductImageChange}
                            onEditProduct={(product) => {
                                setProductForm({
                                    id: product.id,
                                    name: product.name || '',
                                    description: product.description || '',
                                    price: String(product.price || 0),
                                    stock: String(product.stock || 0),
                                    imageUrl: product.imageUrl || '',
                                    previewImageUrl: product.previewImageUrl || '',
                                    imageStoragePath: product.imageStoragePath || '',
                                    previewStoragePath: product.previewStoragePath || '',
                                    sortOrder: String(product.sortOrder || 0),
                                    isActive: product.isActive !== false,
                                });
                                setProductImageFile(null);
                                setProductImagePreviewUrl(product.previewImageUrl || product.imageUrl || '');
                                setProductFeedback('');
                            }}
                            onResetForm={() => {
                                setProductForm(createEmptyProductForm());
                                setProductImageFile(null);
                                setProductImagePreviewUrl('');
                                setProductFeedback('');
                            }}
                            onToggleProduct={(product) => void handleToggleProduct(product)}
                            productOrderDirty={productOrderDirty}
                            productOrderSaving={productOrderSaving}
                            productOrderFeedback={productOrderFeedback}
                            onReorderProducts={handleReorderProducts}
                            onSaveProductOrder={handleSaveProductOrder}
                            onSubmit={handleSaveProductWithUpload}
                        />
                    )}

                    {!loading && activeTab === 'requests' && (
                        <PointRequestsTab
                            orders={filteredOrders}
                            orderFilter={orderFilter}
                            selectedOrderId={selectedOrderId}
                            selectedOrder={selectedOrder}
                            orderMemo={orderMemo}
                            orderFeedback={orderFeedback}
                            canManage={canManage}
                            onFilterChange={setOrderFilter}
                            onSelectOrder={setSelectedOrderId}
                            onOrderMemoChange={setOrderMemo}
                            onSaveOrder={(status) => void handleSaveOrder(status)}
                        />
                    )}
                </div>
            </main>
        </div>
    );
};

export default ManagePoints;
