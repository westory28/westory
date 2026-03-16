import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEACHER_POINT_TAB_LABELS } from '../../constants/pointLabels';
import { useAuth } from '../../contexts/AuthContext';
import {
    adjustPoints,
    getPointPolicy,
    listPointOrders,
    listPointProducts,
    listPointTransactionsByUid,
    listPointWallets,
    reviewPointOrder,
    upsertPointPolicy,
    upsertPointProduct,
} from '../../lib/points';
import { canManagePoints, canReadPoints } from '../../lib/permissions';
import type { PointOrder, PointOrderStatus, PointPolicy, PointProduct, PointTransaction, PointWallet } from '../../types';
import PointPolicyTab from './components/points/PointPolicyTab';
import PointProductsTab from './components/points/PointProductsTab';
import PointRequestsTab from './components/points/PointRequestsTab';
import PointsOverviewTab from './components/points/PointsOverviewTab';

type TeacherPointTab = keyof typeof TEACHER_POINT_TAB_LABELS;
type OrderFilter = 'all' | PointOrderStatus;
type ProductFormState = {
    id: string;
    name: string;
    description: string;
    price: string;
    stock: string;
    imageUrl: string;
    sortOrder: string;
    isActive: boolean;
};

const EMPTY_POLICY: PointPolicy = {
    attendanceDaily: 5,
    attendanceMonthlyBonus: 20,
    lessonView: 3,
    quizSolve: 10,
    manualAdjustEnabled: false,
    allowNegativeBalance: false,
    updatedBy: '',
};

const EMPTY_PRODUCT_FORM: ProductFormState = {
    id: '',
    name: '',
    description: '',
    price: '0',
    stock: '0',
    imageUrl: '',
    sortOrder: '0',
    isActive: true,
};

const normalizeValue = (value: unknown) => String(value || '').trim();

const ManagePoints: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const canRead = canReadPoints(userData, currentUser?.email);
    const canManage = canManagePoints(userData, currentUser?.email);

    const [activeTab, setActiveTab] = useState<TeacherPointTab>('overview');
    const [loading, setLoading] = useState(true);
    const [wallets, setWallets] = useState<PointWallet[]>([]);
    const [selectedUid, setSelectedUid] = useState('');
    const [transactions, setTransactions] = useState<PointTransaction[]>([]);
    const [policy, setPolicy] = useState<PointPolicy>(EMPTY_POLICY);
    const [products, setProducts] = useState<PointProduct[]>([]);
    const [orders, setOrders] = useState<PointOrder[]>([]);
    const [gradeFilter, setGradeFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [numberFilter, setNumberFilter] = useState('all');
    const [nameSearch, setNameSearch] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [action, setAction] = useState<'grant' | 'deduct'>('grant');
    const [feedback, setFeedback] = useState('');
    const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
    const [productFeedback, setProductFeedback] = useState('');
    const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
    const [selectedOrderId, setSelectedOrderId] = useState('');
    const [orderMemo, setOrderMemo] = useState('');
    const [orderFeedback, setOrderFeedback] = useState('');

    const actor = useMemo(() => ({
        uid: currentUser?.uid || userData?.uid || '',
        name: userData?.name || currentUser?.displayName || '',
    }), [currentUser?.displayName, currentUser?.uid, userData?.name, userData?.uid]);

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

    const filteredOrders = useMemo(() => (
        orderFilter === 'all' ? orders : orders.filter((order) => order.status === orderFilter)
    ), [orderFilter, orders]);

    const selectedOrder = useMemo(
        () => filteredOrders.find((order) => order.id === selectedOrderId)
            || orders.find((order) => order.id === selectedOrderId)
            || null,
        [filteredOrders, orders, selectedOrderId],
    );

    const loadAll = async () => {
        if (!canRead) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const [nextWallets, nextPolicy, nextProducts, nextOrders] = await Promise.all([
                listPointWallets(config),
                getPointPolicy(config),
                listPointProducts(config, false),
                listPointOrders(config),
            ]);

            setWallets(nextWallets);
            setPolicy(nextPolicy);
            setProducts(nextProducts);
            setOrders(nextOrders);

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
        if (requestedTab === 'policy' || requestedTab === 'products' || requestedTab === 'requests') {
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
        setOrderMemo(selectedOrder?.memo || '');
    }, [selectedOrder?.id, selectedOrder?.memo]);

    const handleTabChange = (tab: TeacherPointTab) => {
        setFeedback('');
        setProductFeedback('');
        setOrderFeedback('');
        setSearchParams(tab === 'overview' ? {} : { tab });
    };

    const handleSaveAdjust = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedWallet || !canManage) return;

        const numericAmount = Number(amount);
        if (!numericAmount || numericAmount < 1) {
            setFeedback('포인트 수량은 1 이상으로 입력해 주세요.');
            return;
        }
        if (!reason.trim()) {
            setFeedback('지급 또는 차감 사유를 입력해 주세요.');
            return;
        }

        try {
            const delta = action === 'grant' ? numericAmount : -numericAmount;
            await adjustPoints({
                config,
                uid: selectedWallet.uid,
                delta,
                sourceId: `manual_${Date.now()}`,
                sourceLabel: reason.trim(),
                actor,
            });
            setAmount('');
            setReason('');
            setFeedback('학생 포인트를 반영했습니다.');
            await loadAll();
        } catch (error: any) {
            console.error('Failed to adjust points:', error);
            setFeedback(error?.message || '포인트 조정에 실패했습니다.');
        }
    };

    const handleSavePolicy = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canManage) return;

        const sanitizedPolicy: PointPolicy = {
            ...policy,
            attendanceDaily: Math.max(0, Number(policy.attendanceDaily || 0)),
            attendanceMonthlyBonus: Math.max(0, Number(policy.attendanceMonthlyBonus || 0)),
            quizSolve: Math.max(0, Number(policy.quizSolve || 0)),
            lessonView: Math.max(0, Number(policy.lessonView || 0)),
        };

        try {
            const nextPolicy = await upsertPointPolicy(config, sanitizedPolicy, actor);
            setPolicy(nextPolicy);
        } catch (error) {
            console.error('Failed to save point policy:', error);
        }
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

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
                <div className="mb-6 rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">포인트 관리</h1>
                            <p className="mt-1 text-sm text-gray-500">
                                학생별 포인트 현황, 운영 정책, 상점 상품, 구매 요청을 현재 학기 기준으로 관리합니다.
                            </p>
                        </div>
                        {!canManage && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                                읽기 전용 권한으로 접속 중입니다.
                            </div>
                        )}
                    </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200">
                    {(Object.keys(TEACHER_POINT_TAB_LABELS) as TeacherPointTab[]).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => handleTabChange(tab)}
                            className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
                                activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {TEACHER_POINT_TAB_LABELS[tab]}
                        </button>
                    ))}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    {loading && (
                        <div className="py-16 text-center text-gray-400">
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
                            gradeFilter={gradeFilter}
                            classFilter={classFilter}
                            numberFilter={numberFilter}
                            nameSearch={nameSearch}
                            gradeOptions={gradeOptions}
                            classOptions={classOptions}
                            numberOptions={numberOptions}
                            transactions={transactions}
                            canManage={canManage}
                            amount={amount}
                            reason={reason}
                            action={action}
                            feedback={feedback}
                            onGradeFilterChange={setGradeFilter}
                            onClassFilterChange={setClassFilter}
                            onNumberFilterChange={setNumberFilter}
                            onNameSearchChange={setNameSearch}
                            onSelectWallet={setSelectedUid}
                            onAmountChange={setAmount}
                            onReasonChange={setReason}
                            onActionChange={setAction}
                            onSubmitAdjust={handleSaveAdjust}
                        />
                    )}

                    {!loading && activeTab === 'policy' && (
                        <PointPolicyTab
                            policy={policy}
                            canManage={canManage}
                            onPolicyChange={(updater) => setPolicy((prev) => updater(prev))}
                            onSubmit={handleSavePolicy}
                        />
                    )}

                    {!loading && activeTab === 'products' && (
                        <PointProductsTab
                            products={products}
                            productForm={productForm}
                            productFeedback={productFeedback}
                            canManage={canManage}
                            onProductFormChange={(updater) => setProductForm((prev) => updater(prev))}
                            onEditProduct={(product) => {
                                setProductForm({
                                    id: product.id,
                                    name: product.name || '',
                                    description: product.description || '',
                                    price: String(product.price || 0),
                                    stock: String(product.stock || 0),
                                    imageUrl: product.imageUrl || '',
                                    sortOrder: String(product.sortOrder || 0),
                                    isActive: product.isActive !== false,
                                });
                                setProductFeedback('');
                            }}
                            onResetForm={() => {
                                setProductForm(EMPTY_PRODUCT_FORM);
                                setProductFeedback('');
                            }}
                            onToggleProduct={(product) => void handleToggleProduct(product)}
                            onSubmit={handleSaveProduct}
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
