import React, { useMemo, useState } from "react";
import WisProductDetailModal from "../../../../components/common/WisProductDetailModal";
import WisProductCard, {
  getWisProductCardStatus,
  WIS_PRODUCT_CARD_GRID_CLASSNAME,
} from "../../../../components/common/WisProductCard";
import { formatWisAmount } from "../../../../lib/pointFormatters";
import type { PointProduct, PointWallet } from "../../../../types";
interface StudentPointShopTabProps {
  wallet: PointWallet;
  products: PointProduct[];
  selectedProduct: PointProduct | null;
  purchaseMemo: string;
  purchaseSubmitting: boolean;
  purchaseFeedback: string;
  purchaseQuantity?: number;
  onPurchaseQuantityChange?: (quantity: number) => void;
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
  purchaseQuantity = 1,
  onPurchaseQuantityChange,
  onSelectProduct,
  onPurchaseMemoChange,
  onCloseRequest,
  onSubmitPurchaseRequest,
  onOpenOrders,
}) => {
  const [search, setSearch] = useState(""),
    [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState("default");
  const balance = Number(wallet.balance || 0);
  const status = selectedProduct
    ? getWisProductCardStatus(selectedProduct, balance)
    : null;
  const total = Number(selectedProduct?.price || 0) * purchaseQuantity;
  const maxQuantity = Math.min(99, status?.stock || 0);
  const canOrder =
    status?.canRequest &&
    purchaseQuantity >= 1 &&
    purchaseQuantity <= maxQuantity &&
    balance >= total;
  const visible = useMemo(() => {
    const list = products.filter(
      (product) =>
        (!search.trim() ||
          (product.name + " " + product.description)
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())) &&
        (!availableOnly ||
          getWisProductCardStatus(product, balance).canRequest),
    );
    if (sort === "price-low") list.sort((a, b) => a.price - b.price);
    if (sort === "price-high") list.sort((a, b) => b.price - a.price);
    return list;
  }, [products, search, availableOnly, sort, balance]);
  return (
    <section className="wis-shop" aria-label="위스 상점">
      <header className="ws-page-header wis-shop-header">
        <h2>위스 상점</h2>
        <div className="wis-shop-header-actions">
          <div className="wis-shop-balance">
            <span>보유 위스</span>
            <strong>{formatWisAmount(balance)}</strong>
          </div>
          <button
            type="button"
            className="wis-shop-button"
            onClick={onOpenOrders}
          >
            주문 내역
          </button>
        </div>
      </header>
      <div className="wis-shop-toolbar">
        <label className="wis-shop-search">
          <span className="sr-only">상품 검색</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="어떤 상품을 찾으세요?"
          />
        </label>
        <label className="wis-shop-toggle">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(event) => setAvailableOnly(event.target.checked)}
          />
          지금 구매 가능
        </label>
        <select
          aria-label="상품 정렬"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="default">기본순</option>
          <option value="price-low">낮은 가격순</option>
          <option value="price-high">높은 가격순</option>
        </select>
      </div>
      {purchaseFeedback && !selectedProduct && (
        <p className="wis-shop-feedback" role="status">
          {purchaseFeedback}
        </p>
      )}
      <p className="wis-shop-count" aria-live="polite">
        상품 {visible.length}개
      </p>
      {visible.length === 0 ? (
        <div className="wis-shop-empty">
          {products.length
            ? "조건에 맞는 상품이 없습니다."
            : "아직 등록된 상품이 없습니다."}
        </div>
      ) : (
        <div className={WIS_PRODUCT_CARD_GRID_CLASSNAME}>
          {visible.map((product) => (
            <WisProductCard
              key={product.id}
              product={product}
              walletBalance={balance}
              actionLabel="상품 선택"
              actionRequiresEligibility={false}
              onCardClick={() => onSelectProduct(product.id)}
              onAction={() => onSelectProduct(product.id)}
            />
          ))}
        </div>
      )}
      <WisProductDetailModal
        open={Boolean(selectedProduct)}
        product={selectedProduct}
        walletBalance={balance}
        onClose={onCloseRequest}
        busy={purchaseSubmitting}
        footer={
          selectedProduct && (
            <div className="wis-shop-checkout">
              <div className="wis-shop-quantity">
                <span>수량</span>
                <div className="wis-shop-quantity-control">
                  <button
                    type="button"
                    className="wis-shop-icon-button"
                    aria-label="수량 줄이기"
                    onClick={() =>
                      onPurchaseQuantityChange?.(purchaseQuantity - 1)
                    }
                    disabled={purchaseSubmitting || purchaseQuantity <= 1}
                  >
                    −
                  </button>
                  <input
                    aria-label="구매 수량"
                    type="number"
                    min={1}
                    max={Math.max(1, maxQuantity)}
                    value={purchaseQuantity}
                    disabled={purchaseSubmitting || maxQuantity < 1}
                    onChange={(event) =>
                      onPurchaseQuantityChange?.(
                        Math.max(
                          1,
                          Math.min(
                            Math.max(1, maxQuantity),
                            Math.floor(Number(event.target.value) || 1),
                          ),
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="wis-shop-icon-button"
                    aria-label="수량 늘리기"
                    onClick={() =>
                      onPurchaseQuantityChange?.(purchaseQuantity + 1)
                    }
                    disabled={
                      purchaseSubmitting || purchaseQuantity >= maxQuantity
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <label>
                요청 메모 <span className="sr-only">(선택)</span>
                <textarea
                  value={purchaseMemo}
                  onChange={(event) => onPurchaseMemoChange(event.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={purchaseSubmitting}
                  placeholder="색상 등 필요한 요청을 남겨 주세요. (선택)"
                />
              </label>
              <div className="wis-shop-total">
                <span>총 주문 금액</span>
                <strong>{formatWisAmount(total)}</strong>
              </div>
              <p className="wis-shop-note">
                {balance >= total
                  ? "주문 후 잔액 " + formatWisAmount(balance - total)
                  : formatWisAmount(total - balance) + "가 부족합니다."}
                <br />
                주문 시 위스가 차감되며, 취소·반려 시 돌려받습니다.
              </p>
              {purchaseFeedback && (
                <p className="wis-shop-feedback" role="alert">
                  {purchaseFeedback}
                </p>
              )}
              <button
                type="button"
                className="wis-shop-button wis-shop-button--primary"
                onClick={onSubmitPurchaseRequest}
                disabled={purchaseSubmitting || !canOrder}
              >
                {purchaseSubmitting ? "주문 처리 중…" : "주문하기"}
              </button>
            </div>
          )
        }
      />
    </section>
  );
};
export default StudentPointShopTab;
