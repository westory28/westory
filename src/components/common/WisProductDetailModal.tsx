import React, { useEffect, useId, useRef } from "react";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import { formatWisAmount } from "../../lib/pointFormatters";
import type { PointProduct } from "../../types";
import { getWisProductCardStatus } from "./WisProductCard";
import "./wisShop.css";
interface WisProductDetailModalProps {
  open: boolean;
  product: PointProduct | null;
  walletBalance: number;
  onClose: () => void;
  footer?: React.ReactNode;
  busy?: boolean;
}
const WisProductDetailModal: React.FC<WisProductDetailModalProps> = ({
  open,
  product,
  walletBalance,
  onClose,
  footer,
  busy = false,
}) => {
  const titleId = useId(),
    dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose),
    busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = acquirePageScrollLock();
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      release();
      document.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open || !product) return null;
  const { price, stock, statusText, statusClassName } = getWisProductCardStatus(
    product,
    walletBalance,
  );
  return (
    <div
      className="wis-product-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="wis-product-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wis-product-dialog-header">
          <span>상품 상세</span>
          <button
            className="wis-shop-icon-button"
            type="button"
            aria-label="상품 상세 닫기"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="wis-product-dialog-scroll">
          <div className="wis-product-detail-photo">
            {product.imageUrl || product.previewImageUrl ? (
              <img
                src={product.imageUrl || product.previewImageUrl}
                alt={product.name}
                decoding="async"
                width={1200}
                height={1600}
              />
            ) : (
              <span>등록된 이미지가 없습니다.</span>
            )}
          </div>
          <div className="wis-product-detail-info">
            <span className={statusClassName}>{statusText}</span>
            <h2 id={titleId}>{product.name}</h2>
            <strong className="wis-product-detail-price">
              {formatWisAmount(price)}
            </strong>
            <dl className="wis-product-detail-facts">
              <div>
                <dt>남은 수량</dt>
                <dd>{stock.toLocaleString()}개</dd>
              </div>
            </dl>
            {product.description?.trim() && (
              <p className="wis-product-detail-description">
                {product.description}
              </p>
            )}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
};
export default WisProductDetailModal;
