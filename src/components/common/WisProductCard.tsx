import React from "react";
import { formatWisAmount } from "../../lib/pointFormatters";
import { getProductCardImage } from "../../lib/pointProductImages";
import type { PointProduct } from "../../types";
import "./wisShop.css";

export const WIS_PRODUCT_CARD_GRID_CLASSNAME = "wis-shop-grid";
export const getWisProductCardStatus = (
  product: PointProduct,
  walletBalance: number,
) => {
  const price = Math.max(0, Number(product.price || 0));
  const stock = Math.max(
    0,
    Number(product.availableStock ?? product.stock ?? 0),
  );
  const isVisible = product.isActive !== false;
  const canAfford = walletBalance >= price,
    hasStock = stock > 0;
  return {
    price,
    stock,
    isVisible,
    canAfford,
    hasStock,
    canRequest: isVisible && hasStock && canAfford && !product.readOnly,
    statusText: !isVisible
      ? "판매 중지"
      : !hasStock
        ? "품절"
        : !canAfford
          ? "위스 부족"
          : "구매 가능",
    statusClassName:
      !isVisible || !hasStock || !canAfford
        ? "wis-shop-status--muted"
        : "wis-shop-status--available",
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
  showAction?: boolean;
  actionRequiresEligibility?: boolean;
}
const WisProductCard: React.FC<WisProductCardProps> = ({
  product,
  walletBalance,
  actionLabel = "상품 선택",
  actionDisabled = false,
  actionBusy = false,
  onAction,
  onCardClick,
  statusNote = "",
  previewOnly = false,
  showAction = true,
  actionRequiresEligibility = true,
}) => {
  const { price, stock, canRequest, statusText, statusClassName } =
    getWisProductCardStatus(product, walletBalance);
  const image = getProductCardImage(product);
  const photo = (
    <div className="wis-product-photo">
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          width={640}
          height={853}
        />
      ) : (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path d="M12 25h40v29H12zM8 17h48v9H8zM32 17v37M32 17C12 17 15 2 24 7c5 3 8 10 8 10Zm0 0C52 17 49 2 40 7c-5 3-8 10-8 10Z" />
        </svg>
      )}
      {!stock && <span className="wis-product-soldout">품절</span>}
    </div>
  );
  return (
    <article className="wis-product-card">
      {onCardClick ? (
        <button
          type="button"
          className="wis-product-photo-button"
          onClick={onCardClick}
          aria-label={product.name + " 상세 보기"}
        >
          {photo}
        </button>
      ) : (
        photo
      )}
      <div className="wis-product-info">
        <h3>
          {onCardClick ? (
            <button type="button" onClick={onCardClick} tabIndex={-1}>
              {product.name}
            </button>
          ) : (
            product.name
          )}
        </h3>
        {product.description?.trim() && (
          <p className="wis-product-description">{product.description}</p>
        )}
        <strong className="wis-product-price">{formatWisAmount(price)}</strong>
        <div className="wis-product-meta">
          <span>
            {stock > 0
              ? "남은 수량 " + stock.toLocaleString() + "개"
              : "재고 없음"}
          </span>
          <span className={statusClassName}>{statusText}</span>
        </div>
        {statusNote && <p className="wis-shop-note">{statusNote}</p>}
        {!previewOnly && showAction && (
          <button
            type="button"
            className="wis-shop-button wis-product-action"
            onClick={onAction}
            disabled={
              (actionRequiresEligibility && !canRequest) ||
              actionBusy ||
              actionDisabled
            }
          >
            {actionBusy ? "처리 중…" : actionLabel}
          </button>
        )}
      </div>
    </article>
  );
};
export default WisProductCard;
