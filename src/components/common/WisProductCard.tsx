import React from 'react';
import { formatWisAmount } from '../../lib/pointFormatters';
import type { PointProduct } from '../../types';

interface WisProductCardProps {
    product: PointProduct;
    walletBalance: number;
    actionLabel?: string;
    actionDisabled?: boolean;
    actionBusy?: boolean;
    onAction?: () => void;
    statusNote?: string;
    previewOnly?: boolean;
}

const WisProductCard: React.FC<WisProductCardProps> = ({
    product,
    walletBalance,
    actionLabel = '구매 요청하기',
    actionDisabled = false,
    actionBusy = false,
    onAction,
    statusNote = '',
    previewOnly = false,
}) => {
    const price = Math.max(0, Number(product.price || 0));
    const stock = Math.max(0, Number(product.stock || 0));
    const isVisible = product.isActive !== false;
    const canAfford = walletBalance >= price;
    const hasStock = stock > 0;
    const canRequest = isVisible && hasStock && canAfford && !actionDisabled;

    const productStatusText = !isVisible
        ? '학생 화면 비노출'
        : !hasStock
            ? '재고 없음'
            : !canAfford
                ? '위스 부족'
                : '구매 가능';
    const productStatusClass = !isVisible || !hasStock || !canAfford
        ? 'border-rose-200 bg-rose-50 text-rose-600'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

    return (
        <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-gray-200 bg-white shadow-sm">
            {product.previewImageUrl || product.imageUrl ? (
                <div className="aspect-[16/10] bg-gray-100">
                    <img
                        src={product.previewImageUrl || product.imageUrl}
                        alt={product.name}
                        className="h-full w-full object-cover"
                    />
                </div>
            ) : (
                <div className="flex aspect-[16/10] items-center justify-center bg-gray-100 text-4xl text-gray-300">
                    <i className="fas fa-gift"></i>
                </div>
            )}

            <div className="flex flex-1 flex-col p-4">
                <div className="flex flex-1 flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <h3 className="min-h-[3rem] line-clamp-2 text-sm font-bold leading-6 text-gray-800 sm:text-base">
                                {product.name}
                            </h3>
                            <p className="mt-1 min-h-[2.625rem] line-clamp-2 text-sm leading-5 text-gray-500">
                                {product.description || '상품 설명이 아직 없습니다.'}
                            </p>
                        </div>
                        <div className="shrink-0 text-right">
                            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">
                                PRICE
                            </div>
                            <div className="mt-1 whitespace-nowrap text-base font-black text-blue-700 sm:text-lg">
                                {formatWisAmount(price)}
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto flex min-h-[24px] items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-500 sm:text-sm">
                            재고 {stock}개
                        </span>
                        <span className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-bold sm:text-xs ${productStatusClass}`}>
                            {productStatusText}
                        </span>
                    </div>

                    {statusNote && (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
                            {statusNote}
                        </div>
                    )}
                </div>

                {!previewOnly && (
                    <button
                        type="button"
                        onClick={onAction}
                        disabled={!canRequest || actionBusy}
                        className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
                    >
                        {actionBusy ? '처리 중...' : actionLabel}
                    </button>
                )}
            </div>
        </article>
    );
};

export default WisProductCard;
