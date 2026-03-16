import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { STUDENT_POINT_TAB_LABELS } from '../../constants/pointLabels';
import { useAuth } from '../../contexts/AuthContext';
import {
    createSecurePurchaseRequest,
    getPointWalletByUid,
    listPointOrders,
    listPointProducts,
    listPointTransactionsByUid,
} from '../../lib/points';
import type { PointOrder, PointOrderStatus, PointProduct, PointTransaction, PointWallet } from '../../types';
import StudentPointHistoryTab from './components/points/StudentPointHistoryTab';
import StudentPointOrdersTab from './components/points/StudentPointOrdersTab';
import StudentPointShopTab from './components/points/StudentPointShopTab';
import StudentPointSummaryTab from './components/points/StudentPointSummaryTab';

type StudentPointTab = keyof typeof STUDENT_POINT_TAB_LABELS;
type HistoryFilter = 'all' | 'earned' | 'spent' | 'attendance' | 'attendance_monthly_bonus' | 'quiz' | 'lesson' | 'manual_adjust' | 'purchase';
type OrderFilter = 'all' | PointOrderStatus;

const DEFAULT_WALLET: PointWallet = {
    uid: '',
    studentName: '',
    grade: '',
    class: '',
    number: '',
    balance: 0,
    earnedTotal: 0,
    spentTotal: 0,
    adjustedTotal: 0,
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

const Points: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<StudentPointTab>('overview');
    const [wallet, setWallet] = useState<PointWallet | null>(null);
    const [transactions, setTransactions] = useState<PointTransaction[]>([]);
    const [products, setProducts] = useState<PointProduct[]>([]);
    const [orders, setOrders] = useState<PointOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
    const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [purchaseMemo, setPurchaseMemo] = useState('');
    const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
    const [purchaseFeedback, setPurchaseFeedback] = useState('');
    const [purchaseRequestKey, setPurchaseRequestKey] = useState('');

    const uid = currentUser?.uid || userData?.uid || '';

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab === 'history' || requestedTab === 'shop' || requestedTab === 'orders') {
            setActiveTab(requestedTab);
            return;
        }
        setActiveTab('overview');
    }, [searchParams]);

    const loadPointData = async () => {
        if (!uid) return;

        setLoading(true);
        setErrorMessage('');
        try {
            const [loadedWallet, loadedTransactions, loadedProducts, loadedOrders] = await Promise.all([
                getPointWalletByUid(config, uid),
                listPointTransactionsByUid(config, uid, 100),
                listPointProducts(config, true),
                listPointOrders(config, { uid, limitCount: 100 }),
            ]);
            setWallet(loadedWallet);
            setTransactions(loadedTransactions);
            setProducts(loadedProducts);
            setOrders(loadedOrders);
        } catch (error) {
            console.error('Failed to load student point data:', error);
            setErrorMessage('\uD3EC\uC778\uD2B8 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!uid) return;
        void loadPointData();
    }, [config, uid]);

    const safeWallet = wallet || DEFAULT_WALLET;
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
            await loadPointData();
            setPurchaseMemo('');
            setSelectedProductId('');
            setPurchaseRequestKey('');
            setPurchaseFeedback('\uAD6C\uB9E4 \uC694\uCCAD\uC774 \uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4.');
            setSearchParams({ tab: 'orders' });
        } catch (error: any) {
            console.error('Failed to create point purchase request:', error);
            if (error?.message?.includes('Insufficient point balance')) {
                setPurchaseFeedback('\uD3EC\uC778\uD2B8\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4.');
            } else if (error?.message?.includes('out of stock')) {
                setPurchaseFeedback('\uC7AC\uACE0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.');
            } else {
                setPurchaseFeedback('\uAD6C\uB9E4 \uC694\uCCAD\uC744 \uCC98\uB9AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.');
            }
        } finally {
            setPurchaseSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
                <div className="mb-6 rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">{'\uD3EC\uC778\uD2B8'}</h1>
                            <p className="mt-1 text-sm text-gray-500">
                                {'\uB0B4 \uD3EC\uC778\uD2B8 \uD604\uD669\uC744 \uD655\uC778\uD558\uACE0, \uC0C1\uC810 \uC0C1\uD488\uACFC \uAD6C\uB9E4 \uC9C4\uD589 \uC0C1\uD0DC\uB97C \uD55C\uACF3\uC5D0\uC11C \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}
                            </p>
                        </div>
                        <div className="rounded-xl bg-blue-50 px-5 py-3 text-right">
                            <div className="text-xs font-bold text-blue-500">{'\uD604\uC7AC \uBCF4\uC720 \uD3EC\uC778\uD2B8'}</div>
                            <div className="mt-1 text-3xl font-black text-blue-700">{safeWallet.balance || 0}</div>
                        </div>
                    </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200">
                    {(Object.keys(STUDENT_POINT_TAB_LABELS) as StudentPointTab[]).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => handleTabChange(tab)}
                            className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
                                activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {STUDENT_POINT_TAB_LABELS[tab]}
                        </button>
                    ))}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    {loading && (
                        <div className="py-16 text-center text-gray-400">
                            <div className="mb-2 text-2xl">
                                <i className="fas fa-spinner fa-spin"></i>
                            </div>
                            <p className="font-bold">{'\uD3EC\uC778\uD2B8 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.'}</p>
                        </div>
                    )}

                    {!loading && !!errorMessage && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    {!loading && !errorMessage && activeTab === 'overview' && (
                        <StudentPointSummaryTab
                            wallet={safeWallet}
                            recentTransactions={recentTransactions}
                            onOpenHistory={() => handleTabChange('history')}
                        />
                    )}

                    {!loading && !errorMessage && activeTab === 'history' && (
                        <StudentPointHistoryTab
                            historyFilter={historyFilter}
                            transactions={filteredTransactions}
                            onHistoryFilterChange={setHistoryFilter}
                        />
                    )}

                    {!loading && !errorMessage && activeTab === 'shop' && (
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

                    {!loading && !errorMessage && activeTab === 'orders' && (
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
