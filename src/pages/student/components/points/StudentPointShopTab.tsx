import React from "react";
import WisProductDetailModal from "../../../../components/common/WisProductDetailModal";
import WisProductCard, {
  getWisProductCardStatus,
  WIS_PRODUCT_CARD_GRID_CLASSNAME,
} from "../../../../components/common/WisProductCard";
import { getPointFeedbackToneClass } from "../../../../constants/pointLabels";
import { formatWisAmount } from "../../../../lib/pointFormatters";
import type { PointProduct, PointWallet } from "../../../../types";

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
}) => {
  const selectedProductStatus = selectedProduct
    ? getWisProductCardStatus(selectedProduct, Number(wallet.balance || 0))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-800">위스 상점</h2>
          <p className="mt-1 text-sm text-gray-500">
            현재 보유 위스로 요청할 수 있는 상품을 확인하고 바로 구매 요청까지
            진행할 수 있습니다.
          </p>
        </div>
        <div className="text-sm font-bold text-gray-500 whitespace-nowrap">
          사용 가능 위스{" "}
          <span className="text-blue-700">
            {formatWisAmount(wallet.balance || 0)}
          </span>
        </div>
      </div>

      {!!purchaseFeedback && !selectedProduct && (
        <div
          className={`rounded-xl px-5 py-4 text-sm font-bold ${getPointFeedbackToneClass(purchaseFeedback)}`}
        >
          {purchaseFeedback}
        </div>
      )}

      {products.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-12 text-center text-gray-500">
          지금은 구매 가능한 상품이 없습니다.
        </div>
      )}

      {products.length > 0 && (
        <div className={WIS_PRODUCT_CARD_GRID_CLASSNAME}>
          {products.map((product) => (
            <WisProductCard
              key={product.id}
              product={product}
              walletBalance={Number(wallet.balance || 0)}
              onCardClick={() => onSelectProduct(product.id)}
              onAction={() => onSelectProduct(product.id)}
            />
          ))}
        </div>
      )}

      <WisProductDetailModal
        open={Boolean(selectedProduct)}
        product={selectedProduct}
        walletBalance={Number(wallet.balance || 0)}
        onClose={onCloseRequest}
        footer={
          selectedProduct ? (
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-blue-200 bg-blue-50 p-5">
                <div className="text-sm font-bold text-gray-800">
                  {`${formatWisAmount(selectedProduct.price)}를 사용해 구매 요청을 보냅니다. 교사 확인 후 처리 상태가 변경됩니다.`}
                </div>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  메모는 선택 사항이며, 상품 설명은 이 화면에서만 전체 확인할 수
                  있습니다.
                </p>
                <textarea
                  value={purchaseMemo}
                  onChange={(event) => onPurchaseMemoChange(event.target.value)}
                  rows={3}
                  placeholder="요청 메모가 있으면 남겨 주세요. (선택)"
                  className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm"
                />
                {purchaseFeedback && (
                  <div
                    className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${getPointFeedbackToneClass(purchaseFeedback)}`}
                  >
                    {purchaseFeedback}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onSubmitPurchaseRequest}
                  disabled={
                    purchaseSubmitting || !selectedProductStatus?.canRequest
                  }
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300 whitespace-nowrap"
                >
                  {purchaseSubmitting ? "요청 접수 중..." : "구매 요청 확정"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCloseRequest();
                    onOpenOrders();
                  }}
                  className="rounded-xl border border-blue-200 bg-white px-5 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 whitespace-nowrap"
                >
                  구매 내역 보기
                </button>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
};

export default StudentPointShopTab;
