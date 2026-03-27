import React, { useEffect } from "react";
import { formatWisAmount } from "../../lib/pointFormatters";
import type { PointProduct } from "../../types";
import { getWisProductCardStatus } from "./WisProductCard";

interface WisProductDetailModalProps {
  open: boolean;
  product: PointProduct | null;
  walletBalance: number;
  onClose: () => void;
  footer?: React.ReactNode;
}

const WisProductDetailModal: React.FC<WisProductDetailModalProps> = ({
  open,
  product,
  walletBalance,
  onClose,
  footer,
}) => {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !product) return null;

  const { price, stock, statusText, statusClassName } = getWisProductCardStatus(
    product,
    walletBalance,
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(90vh,52rem)] w-full max-w-[min(960px,100%)] min-w-0 flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${statusClassName}`}
              >
                {statusText}
              </span>
              <span className="inline-flex whitespace-nowrap rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
                재고 {stock}개
              </span>
            </div>
            <h3 className="mt-3 text-xl font-extrabold text-gray-900 sm:text-2xl">
              {product.name}
            </h3>
            <div className="mt-2 whitespace-nowrap text-lg font-black text-blue-700 sm:text-xl">
              {formatWisAmount(price)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50"
            aria-label="상품 상세 닫기"
          >
            <i className="fas fa-times text-sm" aria-hidden="true"></i>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <div className="overflow-hidden rounded-[1.6rem] border border-gray-200 bg-gray-50">
              {product.previewImageUrl || product.imageUrl ? (
                <img
                  src={product.previewImageUrl || product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex min-h-[18rem] items-center justify-center text-5xl text-gray-300">
                  <i className="fas fa-gift" aria-hidden="true"></i>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col">
              <div className="rounded-[1.5rem] border border-gray-200 bg-gray-50/70 p-5">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
                  상세 정보
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 sm:text-[15px]">
                  {product.description?.trim() ||
                    "등록된 상품 설명이 없습니다."}
                </p>
              </div>

              {footer && <div className="mt-5">{footer}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WisProductDetailModal;
