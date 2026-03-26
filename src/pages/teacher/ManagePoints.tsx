import React, { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { useSearchParams } from 'react-router-dom';
import { TEACHER_POINT_TAB_LABELS } from '../../constants/pointLabels';
import { useAuth } from '../../contexts/AuthContext';
import {
    adjustPoints,
    getPointSchoolOptions,
    getPointPolicy,
    getPointRankManualAdjustEarnedPointsMap,
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

type TeacherPointTab = keyof typeof TEACHER_POINT_TAB_LABELS;
type OrderFilter = 'all' | PointOrderStatus;
type PolicyFeedbackTone = RankPanelSaveTone;
type SchoolOption = { value: string; label: string };
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

const EMPTY_PRODUCT_FORM: ProductFormState = {
    id: '',
    name: '',
    description: '',
    price: '0',
    stock: '0',
    imageUrl: '',
    previewImageUrl: '',
    imageStoragePath: '',
    previewStoragePath: '',
    sortOrder: '0',
    isActive: true,
};

const normalizeValue = (value: unknown) => String(value || '').trim();

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
    const { config, currentUser, userData } = useAuth();
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
    const [grantGradeFilter, setGrantGradeFilter] = useState('all');
    const [grantClassFilter, setGrantClassFilter] = useState('all');
    const [grantNumberFilter, setGrantNumberFilter] = useState('all');
    const [grantNameSearch, setGrantNameSearch] = useState('');
    const [grantSelectedUid, setGrantSelectedUid] = useState('');
    const [grantAmount, setGrantAmount] = useState('');
    const [grantReason, setGrantReason] = useState('');
    const [grantFeedback, setGrantFeedback] = useState('');
    const [grantGradeOptions, setGrantGradeOptions] = useState<SchoolOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [grantClassOptions, setGrantClassOptions] = useState<SchoolOption[]>(
        Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}반` })),
    );
    const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
    const [productImageFile, setProductImageFile] = useState<File | null>(null);
    const [productImagePreviewUrl, setProductImagePreviewUrl] = useState('');
    const [productImageUploading, setProductImageUploading] = useState(false);
    const [productFeedback, setProductFeedback] = useState('');
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

    const selectedWallet = useMemo(
        () => wallets.find((wallet) => wallet.uid === selectedUid) || null,
        [selectedUid, wallets],
    );

    const walletMap = useMemo(
        () => new Map(wallets.map((wallet) => [wallet.uid, wallet])),
        [wallets],
    );

    const grantNumberOptions = useMemo(
        () => Array.from(new Set(
            students
                .map((student) => normalizeValue(student.number))
                .filter(Boolean),
        )).sort((a, b) => Number(a) - Number(b)),
        [students],
    );

    const filteredGrantStudents = useMemo(() => students
        .filter((student) => {
            const matchesGrade = grantGradeFilter === 'all' || normalizeValue(student.grade) === grantGradeFilter;
            const matchesClass = grantClassFilter === 'all' || normalizeValue(student.class) === grantClassFilter;
            const matchesNumber = grantNumberFilter === 'all' || normalizeValue(student.number) === grantNumberFilter;
            const keyword = grantNameSearch.trim();
            const matchesName = !keyword || normalizeValue(student.studentName).includes(keyword);
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
        if (requestedTab === 'grant' || requestedTab === 'policy' || requestedTab === 'ranks' || requestedTab === 'products' || requestedTab === 'requests') {
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
        if (selectedUid && !filteredWallets.some((wallet) => wallet.uid === selectedUid)) {
            setSelectedUid(filteredWallets[0]?.uid || '');
        }
    }, [filteredWallets, selectedUid]);

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
        if (grantGradeFilter === 'all' || grantClassFilter === 'all') {
            setStudents([]);
            setGrantSelectedUid('');
            setGrantNumberFilter('all');
            return;
        }

        let cancelled = false;
        const loadGrantStudents = async () => {
            setGrantLoading(true);
            try {
                const nextStudents = await listPointStudentTargetsByClass(grantGradeFilter, grantClassFilter);
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
    }, [grantClassFilter, grantGradeFilter]);

    useEffect(() => {
        setOrderMemo(selectedOrder?.memo || '');
    }, [selectedOrder?.id, selectedOrder?.memo]);

    useEffect(() => () => {
        if (productImagePreviewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(productImagePreviewUrl);
        }
    }, [productImagePreviewUrl]);

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

    const handleSaveGrant = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedGrantStudent || !canManage) return;

        const numericAmount = Number(grantAmount);
        if (!numericAmount || numericAmount < 1) {
            setGrantFeedback('포인트 수량은 1 이상으로 입력해 주세요.');
            return;
        }
        if (!grantReason.trim()) {
            setGrantFeedback('포인트 부여 사유를 입력해 주세요.');
            return;
        }

        try {
            await adjustPoints({
                config,
                uid: selectedGrantStudent.uid,
                delta: numericAmount,
                sourceId: `manual_${Date.now()}`,
                sourceLabel: grantReason.trim(),
                actor,
            });
            setGrantAmount('');
            setGrantReason('');
            setGrantFeedback('학생 포인트를 반영했습니다.');

            const nextWallets = await listPointWallets(config);
            const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) => needsPointRankLegacyFallback(wallet))
                ? await getPointRankManualAdjustEarnedPointsMap(config)
                : {};
            setWallets(nextWallets);
            setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);

            const nextSelectedUid = selectedUid && nextWallets.some((wallet) => wallet.uid === selectedUid)
                ? selectedUid
                : nextWallets[0]?.uid || '';
            setSelectedUid(nextSelectedUid);
            await loadTransactionsForWallet(nextSelectedUid);
        } catch (error: any) {
            console.error('Failed to adjust points:', error);
            setGrantFeedback(error?.message || '포인트 부여에 실패했습니다.');
        }
    };

    const handleSavePolicy = async () => {
        if (!canManage) return;

        const sanitizedPolicy: PointPolicy = {
            ...savedPolicy,
            ...policyDraft,
            attendanceDaily: Math.max(0, Number(policyDraft.attendanceDaily || 0)),
            attendanceMonthlyBonus: Math.max(0, Number(policyDraft.attendanceMonthlyBonus || 0)),
            quizSolve: Math.max(0, Number(policyDraft.quizSolve || 0)),
            lessonView: Math.max(0, Number(policyDraft.lessonView || 0)),
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
            setRankSettingsFeedbackMessage('등급 설정이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save rank settings:', error);
            setRankSettingsFeedbackTone('error');
            setRankSettingsFeedbackMessage('등급 설정 저장에 실패했습니다. 다시 시도해 주세요.');
        }
    };

    const handleSaveRankEmojiCollection = async () => {
        if (!canManage) return;

        const mergedRankPolicy = resolvePointRankPolicyDraft({
            ...savedRankPolicy,
            emojiRegistry: cloneRankEmojiRegistry(rankEmojiDraft.emojiRegistry),
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
            await upsertPointProduct(config, {
                id: productForm.id || undefined,
                name: productForm.name.trim(),
                description: productForm.description.trim(),
                price: Number(productForm.price || 0),
                stock: Number(productForm.stock || 0),
                imageUrl: productForm.imageUrl.trim(),
                sortOrder: Number(productForm.sortOrder || 0),
                isActive: productForm.isActive,
            }, actor);
            setProductForm(EMPTY_PRODUCT_FORM);
            setProductFeedback('상품 정보를 저장했습니다.');
            setProducts(await listPointProducts(config, false));
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
                sortOrder: Number(productForm.sortOrder || 0),
                isActive: productForm.isActive,
            }, actor);
            setProductForm(EMPTY_PRODUCT_FORM);
            setProductImageFile(null);
            setProductImagePreviewUrl('');
            setProductFeedback('상품 정보를 저장했습니다.');
            setProducts(await listPointProducts(config, false));
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
            setProducts(await listPointProducts(config, false));
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
            setAdjustmentFeedback('수정 포인트는 0이 아닌 숫자로 입력해 주세요.');
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
            setAdjustmentFeedback('포인트를 수정했습니다.');
        } catch (error: any) {
            console.error('Failed to update point adjustment:', error);
            setAdjustmentFeedback(error?.message || '포인트 수정에 실패했습니다.');
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
            setAdjustmentFeedback('포인트 부여를 취소했습니다.');
        } catch (error: any) {
            console.error('Failed to cancel point adjustment:', error);
            setAdjustmentFeedback(error?.message || '포인트 부여 취소에 실패했습니다.');
        } finally {
            setAdjustmentSaving(false);
        }
    };

    if (!canRead) {
        return (
            <div className="flex min-h-screen flex-col bg-gray-50">
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm font-bold text-red-700">
                        포인트 관리 화면을 볼 권한이 없습니다.
                    </div>
                </main>
            </div>
        );
    }

    const usesSharedPanelFrame = activeTab !== 'ranks';

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
                            <p className="font-bold">포인트 정보를 불러오는 중입니다.</p>
                        </div>
                    )}

                    {!loading && activeTab === 'overview' && (
                        <PointsOverviewTab
                            wallets={filteredWallets}
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
                                setProductForm(EMPTY_PRODUCT_FORM);
                                setProductImageFile(null);
                                setProductImagePreviewUrl('');
                                setProductFeedback('');
                            }}
                            onToggleProduct={(product) => void handleToggleProduct(product)}
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
