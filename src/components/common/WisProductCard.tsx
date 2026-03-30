import React from "react";
import { formatWisAmount } from "../../lib/pointFormatters";
import type { PointProduct } from "../../types";

export const WIS_PRODUCT_CARD_GRID_CLASSNAME =
  "grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4";

export const getWisProductCardStatus = (
  product: PointProduct,
  walletBalance: number,
) => {
  const price = Math.max(0, Number(product.price || 0));
  const stock = Math.max(0, Number(product.stock || 0));
  const isVisible = product.isActive !== false;
  const canAfford = walletBalance >= price;
  const hasStock = stock > 0;

  return {
    price,
    stock,
    isVisible,
    canAfford,
    hasStock,
    canRequest: isVisible && hasStock && canAfford,
    statusText: !isVisible
      ? "학생 화면 비노출"
      : !hasStock
        ? "재고 없음"
        : !canAfford
          ? "위스 부족"
          : "구매 가능",
    statusClassName:
      !isVisible || !hasStock || !canAfford
        ? "border-rose-200 bg-rose-50 text-rose-600"
        : "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
};

interface WisProductCardProps {
  product: PointProduct;
  walletBalance: number;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionBusy?: boolean;
  onAction?: () => void;
  onCardClick?: () => void;
  statusNote?: string;
  previewOnly?: boolean;
}

const WisProductCard: React.FC<WisProductCardProps> = ({
  product,
  walletBalance,
  actionLabel = "구매 요청하기",
  actionDisabled = false,
  actionBusy = false,
  onAction,
  onCardClick,
  statusNote = "",
  previewOnly = false,
}) => {
  const { price, stock, canRequest, statusText, statusClassName } =
    getWisProductCardStatus(product, walletBalance);
  const isInteractive = Boolean(onCardClick);

  return (
    <article
      className={[
        "flex h-full min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-gray-200 bg-white shadow-sm transition",
        isInteractive
          ? "cursor-pointer hover:border-gray-300 hover:shadow-md focus-within:ring-4 focus-within:ring-blue-50"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onCardClick}
      onKeyDown={(event) => {
        if (!isInteractive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCardClick?.();
        }
      }}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `${product.name} 상세 보기` : undefined}
    >
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

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="min-h-[2.75rem] line-clamp-2 text-[13px] font-bold leading-5 text-gray-800 sm:min-h-[3rem] sm:text-base sm:leading-6">
                {product.name}
              </h3>
            </div>
            <div className="min-w-0 shrink-0 text-left sm:text-right">
              <div className="text-[11px] font-bold text-gray-400">가격</div>
              <div className="mt-1 break-keep text-sm font-black text-blue-700 sm:text-lg">
                {formatWisAmount(price)}
              </div>
            </div>
          </div>

          <div className="mt-auto flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-bold text-gray-500 sm:text-sm">
              재고 {stock}개
            </span>
            <span
              className={`inline-flex max-w-full rounded-full border px-3 py-1 text-[11px] font-bold sm:text-xs ${statusClassName}`}
            >
              {statusText}
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
            onClick={(event) => {
              event.stopPropagation();
              onAction?.();
            }}
            disabled={!canRequest || actionBusy}
            className="mt-4 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-[13px] font-bold text-white transition hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 sm:px-4 sm:text-sm"
          >
            {actionBusy ? "처리 중..." : actionLabel}
          </button>
        )}
      </div>
    </article>
  );
};

export default WisProductCard;
