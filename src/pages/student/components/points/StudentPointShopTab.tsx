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
                <h2 className="text-lg font-bold text-gray-800">{'\uD3EC\uC778\uD2B8 \uC0C1\uC810'}</h2>
                <p className="mt-1 text-sm text-gray-500">{'\uD604\uC7AC \uD3EC\uC778\uD2B8\uB85C \uAD6C\uB9E4\uD560 \uC218 \uC788\uB294 \uC0C1\uD488\uC744 \uD655\uC778\uD558\uACE0 \uC694\uCCAD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</p>
            </div>
            <div className="text-sm font-bold text-gray-500">
                {'\uC0AC\uC6A9 \uAC00\uB2A5 \uD3EC\uC778\uD2B8 '}<span className="text-blue-700">{`${wallet.balance || 0}\uC810`}</span>
            </div>
        </div>

        {!!purchaseFeedback && (
            <div className={`rounded-xl px-5 py-4 text-sm font-bold ${getPointFeedbackToneClass(purchaseFeedback)}`}>
                {purchaseFeedback}
            </div>
        )}

        {products.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-12 text-center text-gray-500">
                {'\uC9C0\uAE08\uC740 \uAD6C\uB9E4 \uAC00\uB2A5\uD55C \uC0C1\uD488\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </div>
        )}

        {products.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {products.map((product) => {
                    const canAfford = (wallet.balance || 0) >= Number(product.price || 0);
                    const hasStock = Number(product.stock || 0) > 0;
                    const canRequest = canAfford && hasStock;
                    const productStatusText = !hasStock ? '재고 없음' : !canAfford ? '포인트 부족' : '구매 가능';
                    const productStatusClass = !hasStock || !canAfford ? 'text-rose-500' : 'text-emerald-600';

                    return (
                        <article key={product.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            {(product.previewImageUrl || product.imageUrl) ? (
                                <div className="aspect-[3/2] bg-gray-100">
                                    <img src={product.previewImageUrl || product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                </div>
                            ) : (
                                <div className="flex aspect-[3/2] items-center justify-center bg-gray-100 text-4xl text-gray-300">
                                    <i className="fas fa-gift"></i>
                                </div>
                            )}
                            <div className="flex flex-1 flex-col p-4">
                                <div className="flex flex-1 flex-col gap-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="line-clamp-2 text-base font-bold leading-6 text-gray-800">{product.name}</h3>
                                            <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-gray-500">{product.description || '\uC0C1\uD488 \uC124\uBA85\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.'}</p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">{'\uAC00\uACA9'}</div>
                                            <div className="mt-1 text-lg font-black text-blue-700">{product.price}</div>
                                        </div>
                                    </div>
                                    <div className="mt-auto flex min-h-[20px] items-center justify-between gap-2 text-sm">
                                        <span className="font-bold text-gray-500">{`\uC7AC\uACE0 ${product.stock}\uAC1C`}</span>
                                        <span className={`text-right font-bold whitespace-nowrap ${productStatusClass}`}>{productStatusText}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onSelectProduct(product.id)}
                                    disabled={!canRequest}
                                    className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
                                >
                                    {'\uAD6C\uB9E4 \uC694\uCCAD\uD558\uAE30'}
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
                        <h3 className="text-lg font-bold text-gray-800">{`${selectedProduct.name} \uAD6C\uB9E4 \uC694\uCCAD`}</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            {`${selectedProduct.price}\uC810\uC744 \uC0AC\uC6A9\uD574 \uAD6C\uB9E4 \uC694\uCCAD\uC744 \uBCF4\uB0C5\uB2C8\uB2E4. \uAD50\uC0AC \uD655\uC778 \uD6C4 \uCC98\uB9AC \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB429\uB2C8\uB2E4.`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onCloseRequest}
                        className="self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                    >
                        {'\uB2EB\uAE30'}
                    </button>
                </div>
                <textarea
                    value={purchaseMemo}
                    onChange={(event) => onPurchaseMemoChange(event.target.value)}
                    rows={3}
                    placeholder={'\uC694\uCCAD \uBA54\uBAA8\uAC00 \uC788\uC73C\uBA74 \uB0A8\uACA8 \uC8FC\uC138\uC694. (\uC120\uD0DD)'}
                    className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm"
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={onSubmitPurchaseRequest}
                        disabled={purchaseSubmitting}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                    >
                        {purchaseSubmitting ? '\uC694\uCCAD \uC811\uC218 \uC911...' : '\uAD6C\uB9E4 \uC694\uCCAD \uD655\uC815'}
                    </button>
                    <button
                        type="button"
                        onClick={onOpenOrders}
                        className="rounded-xl border border-blue-200 bg-white px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                        {'\uAD6C\uB9E4 \uB0B4\uC5ED \uBCF4\uAE30'}
                    </button>
                </div>
            </section>
        )}
    </div>
);

export default StudentPointShopTab;
