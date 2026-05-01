import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppToast } from '../../components/common/AppToastProvider';
import { InlineLoading } from '../../components/common/LoadingState';
import {
    POINT_HISTORY_FILTER_LABELS,
    STUDENT_POINT_TAB_LABELS,
} from '../../constants/pointLabels';
import { useAuth } from '../../contexts/AuthContext';
import { subscribePointsUpdated } from '../../lib/appEvents';
import {
    createSecurePurchaseRequest,
    getPointPolicy,
    getPointRankManualAdjustEarnedPointsByUid,
    getPointWalletByUid,
    listPointOrders,
    listPointProducts,
    listPointTransactionsByUid,
    POINT_POLICY_FALLBACK,
} from '../../lib/points';
import { formatWisAmount } from '../../lib/pointFormatters';
import { getPointRankDisplay, needsPointRankLegacyFallback } from '../../lib/pointRanks';
import {
    findWisHallOfFameEntryByUid,
    getWisHallOfFameSnapshot,
} from '../../lib/wisHallOfFame';
import type {
    PointOrder,
    PointOrderStatus,
    PointProduct,
    PointTransaction,
    PointWallet,
    WisHallOfFameSnapshot,
} from '../../types';
import StudentPointHallOfFameTab from './components/points/StudentPointHallOfFameTab';
import StudentPointHistoryTab from './components/points/StudentPointHistoryTab';
import StudentPointOrdersTab from './components/points/StudentPointOrdersTab';
import StudentPointShopTab from './components/points/StudentPointShopTab';
import StudentPointSummaryTab from './components/points/StudentPointSummaryTab';

type StudentPointTab = keyof typeof STUDENT_POINT_TAB_LABELS;
type HistoryFilter = keyof typeof POINT_HISTORY_FILTER_LABELS;
type OrderFilter = 'all' | PointOrderStatus;
type DeferredLoadOptions = { force?: boolean };
type CoreLoadOptions = { showLoading?: boolean; setRecentTransactions?: boolean };

const DEFAULT_WALLET: PointWallet = {
    uid: '',
    studentName: '',
    grade: '',
    class: '',
    number: '',
    balance: 0,
    earnedTotal: 0,
    rankEarnedTotal: 0,
    spentTotal: 0,
    adjustedTotal: 0,
    rankSnapshot: null,
    lastTransactionAt: null,
};

const isPurchaseTransaction = (type: PointTransaction['type']) => (
    type === 'purchase_hold' || type === 'purchase_confirm' || type === 'purchase_cancel'
);

const getTransactionCategory = (transaction: PointTransaction) => {
    if (transaction.delta > 0) return 'earned';
    if (transaction.delta < 0) return 'spent';
    return 'all';
};

const normalizeSchoolField = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = raw.match(/\d+/)?.[0] || '';
    if (!digits) return raw;
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const Points: React.FC = () => {
    const { config, currentUser, userData, interfaceConfig } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<StudentPointTab>('overview');
    const [wallet, setWallet] = useState<PointWallet | null>(null);
    const [transactions, setTransactions] = useState<PointTransaction[]>([]);
    const [products, setProducts] = useState<PointProduct[]>([]);
    const [orders, setOrders] = useState<PointOrder[]>([]);
    const [policy, setPolicy] = useState(POINT_POLICY_FALLBACK);
    const [hallOfFame, setHallOfFame] = useState<WisHallOfFameSnapshot | null>(null);
    const [rankManualAdjustPoints, setRankManualAdjustPoints] = useState(0);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [historyLoading, setHistoryLoading] = useState(false);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [shopLoading, setShopLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [ordersLoaded, setOrdersLoaded] = useState(false);
    const [shopLoaded, setShopLoaded] = useState(false);
    const [historyErrorMessage, setHistoryErrorMessage] = useState('');
    const [ordersErrorMessage, setOrdersErrorMessage] = useState('');
    const [shopErrorMessage, setShopErrorMessage] = useState('');
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
    const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [purchaseMemo, setPurchaseMemo] = useState('');
    const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
    const [purchaseFeedback, setPurchaseFeedback] = useState('');
    const [purchaseRequestKey, setPurchaseRequestKey] = useState('');
    const { showToast } = useAppToast();
    const historyLoadInFlightRef = useRef(false);
    const ordersLoadInFlightRef = useRef(false);
    const shopLoadInFlightRef = useRef(false);

    const uid = currentUser?.uid || userData?.uid || '';

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab === 'hall-of-fame' || requestedTab === 'history' || requestedTab === 'shop' || requestedTab === 'orders') {
            setActiveTab(requestedTab);
            return;
        }
        setActiveTab('overview');
    }, [searchParams]);

    const loadCorePointData = async () => {
        const [loadedWallet, loadedRecentTransactions, loadedPolicy] = await Promise.all([
            getPointWalletByUid(config, uid),
            listPointTransactionsByUid(config, uid, 5),
            getPointPolicy(config),
        ]);
        const loadedRankManualAdjustPoints = loadedWallet && needsPointRankLegacyFallback(loadedWallet)
            ? await getPointRankManualAdjustEarnedPointsByUid(config, uid)
            : 0;

        return {
            loadedWallet,
            loadedRecentTransactions,
            loadedPolicy,
            loadedRankManualAdjustPoints,
        };
    };

    const loadHallOfFameData = async () => {
        if (!config?.year || !config?.semester) {
            setHallOfFame(null);
            return;
        }
        try {
            const snapshot = await getWisHallOfFameSnapshot(config);
            setHallOfFame(snapshot);
        } catch (error) {
            console.warn('Failed to load wis hall of fame snapshot:', error);
            setHallOfFame(null);
        }
    };

    const loadPointData = async ({ showLoading = true, setRecentTransactions = true }: CoreLoadOptions = {}) => {
        if (!uid) return;

        if (showLoading) setLoading(true);
        setErrorMessage('');
        try {
            const {
                loadedWallet,
                loadedRecentTransactions,
                loadedPolicy,
                loadedRankManualAdjustPoints,
            } = await loadCorePointData();
            setWallet(loadedWallet);
            if (setRecentTransactions) {
                setTransactions(loadedRecentTransactions);
            }
            setPolicy(loadedPolicy);
            setRankManualAdjustPoints(loadedRankManualAdjustPoints);
            void loadHallOfFameData();
        } catch (error) {
            console.error('Failed to load student point data:', error);
            setErrorMessage('위스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    const loadHistoryData = async ({ force = false }: DeferredLoadOptions = {}) => {
        if (!uid || (!force && historyLoaded) || historyLoadInFlightRef.current) return;

        historyLoadInFlightRef.current = true;
        setHistoryLoading(true);
        setHistoryErrorMessage('');
        try {
            const loadedTransactions = await listPointTransactionsByUid(config, uid, 100);
            setTransactions(loadedTransactions);
            setHistoryLoaded(true);
        } catch (error) {
            console.error('Failed to load student point history:', error);
            setHistoryErrorMessage('포인트 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            historyLoadInFlightRef.current = false;
            setHistoryLoading(false);
        }
    };

    const loadOrdersData = async ({ force = false }: DeferredLoadOptions = {}) => {
        if (!uid || (!force && ordersLoaded) || ordersLoadInFlightRef.current) return;

        ordersLoadInFlightRef.current = true;
        setOrdersLoading(true);
        setOrdersErrorMessage('');
        try {
            const loadedOrders = await listPointOrders(config, { uid, limitCount: 100 });
            setOrders(loadedOrders);
            setOrdersLoaded(true);
        } catch (error) {
            console.error('Failed to load student point orders:', error);
            setOrdersErrorMessage('구매 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            ordersLoadInFlightRef.current = false;
            setOrdersLoading(false);
        }
    };

    const loadShopData = async ({ force = false }: DeferredLoadOptions = {}) => {
        if (!uid || (!force && shopLoaded) || shopLoadInFlightRef.current) return;

        shopLoadInFlightRef.current = true;
        setShopLoading(true);
        setShopErrorMessage('');
        try {
            const loadedProducts = await listPointProducts(config, true);
            setProducts(loadedProducts);
            setShopLoaded(true);
        } catch (error) {
            console.error('Failed to load student point products:', error);
            setShopErrorMessage('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            shopLoadInFlightRef.current = false;
            setShopLoading(false);
        }
    };

    const refreshLoadedPointData = async () => {
        await loadPointData({ showLoading: false, setRecentTransactions: !historyLoaded });
        await Promise.all([
            historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
            ordersLoaded ? loadOrdersData({ force: true }) : Promise.resolve(),
            shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
        ]);
    };

    useEffect(() => {
        setTransactions([]);
        setProducts([]);
        setOrders([]);
        setHistoryLoaded(false);
        setOrdersLoaded(false);
        setShopLoaded(false);
        setHistoryErrorMessage('');
        setOrdersErrorMessage('');
        setShopErrorMessage('');
        setSelectedProductId('');
        setPurchaseMemo('');
        setPurchaseFeedback('');
        setPurchaseRequestKey('');

        if (!uid) {
            setWallet(null);
            setHallOfFame(null);
            setLoading(false);
            return;
        }
        void loadPointData({ setRecentTransactions: true });
    }, [config, uid]);

    useEffect(() => {
        if (!uid) return;
        if (activeTab === 'history') {
            void loadHistoryData();
        } else if (activeTab === 'orders') {
            void loadOrdersData();
        } else if (activeTab === 'shop') {
            void loadShopData();
        }
    }, [activeTab, config, uid, historyLoaded, ordersLoaded, shopLoaded]);

    useEffect(() => {
        if (!uid) return undefined;
        return subscribePointsUpdated(() => {
            void refreshLoadedPointData();
        });
    }, [config, uid, historyLoaded, ordersLoaded, shopLoaded]);

    const safeWallet = wallet || DEFAULT_WALLET;
    const legacyUserData = (userData || null) as Record<string, unknown> | null;
    const currentHallOfFameEntry = useMemo(
        () => (currentUser?.uid ? findWisHallOfFameEntryByUid(hallOfFame, currentUser.uid) : null),
        [currentUser?.uid, hallOfFame],
    );
    const currentHallGrade = normalizeSchoolField(
        userData?.grade
        || legacyUserData?.studentGrade
        || safeWallet.grade
        || currentHallOfFameEntry?.grade,
    );
    const currentHallClass = normalizeSchoolField(
        userData?.class
        || legacyUserData?.studentClass
        || safeWallet.class
        || currentHallOfFameEntry?.class,
    );
    const rank = getPointRankDisplay({
        rankPolicy: policy.rankPolicy,
        wallet: safeWallet,
        earnedPointsFromTransactions: rankManualAdjustPoints,
    });
    const recentTransactions = transactions.slice(0, 5);
    const selectedProduct = products.find((item) => item.id === selectedProductId) || null;

    const filteredTransactions = useMemo(() => transactions.filter((transaction) => {
        const typeKey = transaction.activityType || transaction.type;
        if (historyFilter === 'all') return true;
        if (historyFilter === 'earned') return getTransactionCategory(transaction) === 'earned';
        if (historyFilter === 'spent') return getTransactionCategory(transaction) === 'spent';
        if (historyFilter === 'purchase') return isPurchaseTransaction(transaction.type);
        return transaction.type === historyFilter || typeKey === historyFilter;
    }), [historyFilter, transactions]);

    const filteredOrders = useMemo(() => (
        orderFilter === 'all' ? orders : orders.filter((order) => order.status === orderFilter)
    ), [orderFilter, orders]);

    const handleTabChange = (tab: StudentPointTab) => {
        setPurchaseFeedback('');
        setSearchParams(tab === 'overview' ? {} : { tab });
    };

    const handleSelectProduct = (productId: string) => {
        setSelectedProductId(productId);
        setPurchaseFeedback('');
        setPurchaseRequestKey(`req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    };

    const handlePurchaseRequest = async () => {
        if (!selectedProduct || !uid) return;

        setPurchaseSubmitting(true);
        setPurchaseFeedback('');
        try {
            const requestKey = purchaseRequestKey || `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            await createSecurePurchaseRequest({
                config,
                productId: selectedProduct.id,
                memo: purchaseMemo,
                requestKey,
            });
            await Promise.all([
                loadPointData({ showLoading: false, setRecentTransactions: !historyLoaded }),
                loadOrdersData({ force: true }),
                shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
                historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
            ]);
            setPurchaseMemo('');
            setSelectedProductId('');
            setPurchaseRequestKey('');
            setPurchaseFeedback('구매 요청이 접수되었습니다.');
            showToast({
                tone: 'success',
                title: '구매 요청이 접수되었습니다.',
                message: `${selectedProduct.name} 요청과 위스 상태가 최신 정보로 반영되었습니다.`,
            });
            setSearchParams({ tab: 'orders' });
        } catch (error: any) {
            console.error('Failed to create point purchase request:', error);
            if (error?.message?.includes('Insufficient point balance')) {
                setPurchaseFeedback('보유 위스가 부족합니다.');
                showToast({
                    tone: 'warning',
                    title: '구매 요청을 보낼 수 없습니다.',
                    message: '보유 위스가 부족합니다.',
                });
            } else if (error?.message?.includes('out of stock')) {
                setPurchaseFeedback('재고가 없습니다.');
                showToast({
                    tone: 'warning',
                    title: '구매 요청을 보낼 수 없습니다.',
                    message: '선택한 상품의 재고가 없습니다.',
                });
            } else {
                setPurchaseFeedback('구매 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                showToast({
                    tone: 'error',
                    title: '구매 요청에 실패했습니다.',
                    message: '잠시 후 다시 시도해 주세요.',
                });
            }
        } finally {
            setPurchaseSubmitting(false);
        }
    };

    const isHallOfFameTab = activeTab === 'hall-of-fame';
    const activeTabLoading = (
        (activeTab === 'history' && historyLoading)
        || (activeTab === 'orders' && ordersLoading)
        || (activeTab === 'shop' && shopLoading)
    );
    const activeTabErrorMessage = (
        activeTab === 'history' ? historyErrorMessage
            : activeTab === 'orders' ? ordersErrorMessage
                : activeTab === 'shop' ? shopErrorMessage
                    : ''
    );
    const activeTabLoadingMessage = (
        activeTab === 'history' ? '포인트 내역을 불러오는 중입니다.'
            : activeTab === 'orders' ? '구매 내역을 불러오는 중입니다.'
                : activeTab === 'shop' ? '상품 목록을 불러오는 중입니다.'
                    : ''
    );

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className={`mx-auto w-full flex-1 px-4 py-8 ${
                isHallOfFameTab ? 'max-w-7xl' : 'max-w-6xl'
            }`}>
                <div className={`mb-5 rounded-2xl border border-gray-200 bg-white shadow-sm ${
                    isHallOfFameTab ? 'px-5 py-4' : 'px-6 py-5'
                }`}>
                    <div className={`flex flex-col gap-3 md:flex-row md:justify-between ${
                        isHallOfFameTab ? 'md:items-center' : 'md:items-end'
                    }`}>
                        <div className="flex items-center">
                            <h1 className="text-2xl font-bold text-gray-800">위스</h1>
                        </div>
                        <div className="flex flex-col items-stretch gap-3 md:items-end">
                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-right">
                                <div className="text-xs font-bold text-blue-500">현재 보유 위스</div>
                                <div className="mt-1 whitespace-nowrap text-3xl font-black leading-none text-blue-700">{formatWisAmount(safeWallet.balance || 0)}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200">
                    {(Object.keys(STUDENT_POINT_TAB_LABELS) as StudentPointTab[]).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => handleTabChange(tab)}
                            className={`border-b-2 px-4 py-3 text-sm font-bold transition whitespace-nowrap ${
                                activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {STUDENT_POINT_TAB_LABELS[tab]}
                        </button>
                    ))}
                </div>

                <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${
                    isHallOfFameTab ? 'p-4 sm:p-5 xl:p-6' : 'p-6'
                }`}>
                    {loading && (
                        <InlineLoading message="위스 정보를 불러오는 중입니다." showWarning />
                    )}

                    {!loading && !!errorMessage && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    {!loading && !errorMessage && activeTabLoading && (
                        <InlineLoading message={activeTabLoadingMessage} showWarning />
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !!activeTabErrorMessage && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                            {activeTabErrorMessage}
                        </div>
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !activeTabErrorMessage && activeTab === 'overview' && (
                        <StudentPointSummaryTab
                            wallet={safeWallet}
                            rank={rank}
                            recentTransactions={recentTransactions}
                            onOpenHistory={() => handleTabChange('history')}
                        />
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !activeTabErrorMessage && activeTab === 'hall-of-fame' && (
                        <StudentPointHallOfFameTab
                            snapshot={hallOfFame}
                            hallOfFameConfig={interfaceConfig?.hallOfFame}
                            currentGrade={currentHallGrade}
                            currentClass={currentHallClass}
                        />
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !activeTabErrorMessage && activeTab === 'history' && (
                        <StudentPointHistoryTab
                            historyFilter={historyFilter}
                            transactions={filteredTransactions}
                            onHistoryFilterChange={setHistoryFilter}
                        />
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !activeTabErrorMessage && activeTab === 'shop' && (
                        <StudentPointShopTab
                            wallet={safeWallet}
                            products={products}
                            selectedProduct={selectedProduct}
                            purchaseMemo={purchaseMemo}
                            purchaseSubmitting={purchaseSubmitting}
                            purchaseFeedback={purchaseFeedback}
                            onSelectProduct={handleSelectProduct}
                            onPurchaseMemoChange={setPurchaseMemo}
                            onCloseRequest={() => {
                                setSelectedProductId('');
                                setPurchaseMemo('');
                                setPurchaseRequestKey('');
                            }}
                            onSubmitPurchaseRequest={() => void handlePurchaseRequest()}
                            onOpenOrders={() => handleTabChange('orders')}
                        />
                    )}

                    {!loading && !errorMessage && !activeTabLoading && !activeTabErrorMessage && activeTab === 'orders' && (
                        <StudentPointOrdersTab
                            orderFilter={orderFilter}
                            orders={filteredOrders}
                            onOrderFilterChange={setOrderFilter}
                        />
                    )}
                </div>
            </main>
        </div>
    );
};

export default Points;
