import React from 'react';
import { getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import type { PointProduct, PointWallet } from '../../../../types';

interface StudentPointShopTabProps {
    wallet: PointWallet;
    products: PointProduct[];
    selectedProduct: PointProduct | null;
    purchaseMemo: string;
    purchaseSubmitting: boolean;
    purchaseFeedback: string;
    onSelectProduct: (productId: string) => void;
    onPurchaseMemoChange: (value: string) => void;
    onCloseRequest: () => void;
    onSubmitPurchaseRequest: () => void;
    onOpenOrders: () => void;
}

const StudentPointShopTab: React.FC<StudentPointShopTabProps> = ({
    wallet,
    products,
    selectedProduct,
    purchaseMemo,
    purchaseSubmitting,
    purchaseFeedback,
    onSelectProduct,
    onPurchaseMemoChange,
    onCloseRequest,
    onSubmitPurchaseRequest,
    onOpenOrders,
}) => (
    <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
                <h2 className="text-lg font-bold text-gray-800">포인트 상점</h2>
                <p className="mt-1 text-sm text-gray-500">현재 포인트로 구매할 수 있는 상품을 확인하고 요청할 수 있습니다.</p>
            </div>
            <div className="text-sm font-bold text-gray-500">
                사용 가능 포인트 <span className="text-blue-700">{wallet.balance || 0}점</span>
            </div>
        </div>

        {!!purchaseFeedback && (
            <div className={`rounded-xl px-5 py-4 text-sm font-bold ${getPointFeedbackToneClass(purchaseFeedback)}`}>
                {purchaseFeedback}
            </div>
        )}

        {products.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-12 text-center text-gray-500">
                지금은 구매 가능한 상품이 없습니다.
            </div>
        )}

        {products.length > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {products.map((product) => {
                    const canAfford = (wallet.balance || 0) >= Number(product.price || 0);
                    const hasStock = Number(product.stock || 0) > 0;
                    const canRequest = canAfford && hasStock;

                    return (
                        <article key={product.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            {product.imageUrl ? (
                                <div className="aspect-[4/3] bg-gray-100">
                                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-gray-100 text-4xl text-gray-300">
                                    <i className="fas fa-gift"></i>
                                </div>
                            )}
                            <div className="p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-800">{product.name}</h3>
                                        <p className="mt-1 text-sm leading-6 text-gray-500">{product.description || '상품 설명이 아직 없습니다.'}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-gray-400">가격</div>
                                        <div className="text-xl font-black text-blue-700">{product.price}</div>
                                    </div>
                                </div>
                                <div className="mt-4 flex items-center justify-between text-sm">
                                    <span className="font-bold text-gray-500">재고 {product.stock}개</span>
                                    {!hasStock && <span className="font-bold text-rose-500">재고가 없습니다</span>}
                                    {hasStock && !canAfford && <span className="font-bold text-rose-500">포인트가 부족합니다</span>}
                                    {canRequest && <span className="font-bold text-emerald-600">구매 가능</span>}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onSelectProduct(product.id)}
                                    disabled={!canRequest}
                                    className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
                                >
                                    구매 요청하기
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
        )}

        {selectedProduct && (
            <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">{selectedProduct.name} 구매 요청</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {selectedProduct.price}점을 사용해 구매 요청을 보냅니다. 교사 확인 후 처리 상태가 변경됩니다.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onCloseRequest}
                        className="self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                    >
                        닫기
                    </button>
                </div>
                <textarea
                    value={purchaseMemo}
                    onChange={(event) => onPurchaseMemoChange(event.target.value)}
                    rows={3}
                    placeholder="요청 메모가 있으면 남겨 주세요. (선택)"
                    className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm"
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={onSubmitPurchaseRequest}
                        disabled={purchaseSubmitting}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                    >
                        {purchaseSubmitting ? '요청 접수 중...' : '구매 요청 확정'}
                    </button>
                    <button
                        type="button"
                        onClick={onOpenOrders}
                        className="rounded-xl border border-blue-200 bg-white px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                        구매 내역 보기
                    </button>
                </div>
            </section>
        )}
    </div>
);

export default StudentPointShopTab;
