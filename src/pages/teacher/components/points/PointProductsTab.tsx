import React, { useMemo, useRef, useState } from "react";
import NumericInput from "../../../../components/common/NumericInput";
import InfoHelp from "../../../../components/common/InfoHelp";
import WisProductCard, {
  WIS_PRODUCT_CARD_GRID_CLASSNAME,
} from "../../../../components/common/WisProductCard";
import WisProductDetailModal from "../../../../components/common/WisProductDetailModal";
import { getPointFeedbackToneClass } from "../../../../constants/pointLabels";
import { formatWisAmount } from "../../../../lib/pointFormatters";
import type { PointProduct } from "../../../../types";
import "./TeacherWisShop.css";

type ProductFormState = {
  id: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  imageUrl: string;
  previewImageUrl: string;
  imageStoragePath: string;
  previewStoragePath: string;
  sortOrder: string;
  isActive: boolean;
};

interface PointProductsTabProps {
  products: PointProduct[];
  productForm: ProductFormState;
  productFeedback: string;
  canManage: boolean;
  productImagePreviewUrl: string;
  productImageUploading: boolean;
  productOrderDirty: boolean;
  productOrderSaving: boolean;
  productOrderFeedback: string;
  onProductFormChange: (
    updater: (prev: ProductFormState) => ProductFormState,
  ) => void;
  onProductImageChange: (file: File | null) => void;
  onEditProduct: (product: PointProduct) => void;
  onResetForm: () => void;
  onToggleProduct: (product: PointProduct) => void;
  onDeleteProduct: (product: PointProduct) => void;
  onReorderProducts: (sourceId: string, targetId: string) => void;
  onSaveProductOrder: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

type ProductFilter = "all" | "selling" | "low" | "soldout" | "hidden";
const normalizeSearchValue = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");
const availableStock = (product: PointProduct) =>
  Math.max(0, Number(product.availableStock ?? product.stock ?? 0));
const matchesFilter = (product: PointProduct, filter: ProductFilter) => {
  const available = availableStock(product);
  if (filter === "selling") return product.isActive !== false && available > 0;
  if (filter === "low")
    return product.isActive !== false && available > 0 && available <= 3;
  if (filter === "soldout")
    return product.isActive !== false && available === 0;
  if (filter === "hidden") return product.isActive === false;
  return true;
};
const FILTERS: { value: ProductFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "selling", label: "판매 중" },
  { value: "low", label: "3개 이하" },
  { value: "soldout", label: "품절" },
  { value: "hidden", label: "숨김" },
];

const PointProductsTab: React.FC<PointProductsTabProps> = ({
  products,
  productForm,
  productFeedback,
  canManage,
  productImagePreviewUrl,
  productImageUploading,
  productOrderFeedback,
  onProductFormChange,
  onProductImageChange,
  onEditProduct,
  onResetForm,
  onToggleProduct,
  onDeleteProduct,
  onSubmit,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSelectedProduct, setPreviewSelectedProduct] =
    useState<PointProduct | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const normalizedSearchQuery = normalizeSearchValue(searchQuery);
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          matchesFilter(product, filter) &&
          normalizeSearchValue(
            `${product.name} ${product.description}`,
          ).includes(normalizedSearchQuery),
      ),
    [products, filter, normalizedSearchQuery],
  );
  const previewProducts = products.filter(
    (product) => product.isActive !== false,
  );
  const editingProduct = products.find(
    (product) => product.id === productForm.id,
  );
  const committedStock =
    Number(editingProduct?.reservedStock || 0) +
    Number(editingProduct?.soldStock || 0);

  const openEditor = (trigger: HTMLButtonElement, product?: PointProduct) => {
    editorTriggerRef.current = trigger;
    if (product) onEditProduct(product);
    else onResetForm();
    setEditorOpen(true);
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
      editorRef.current
        ?.querySelector<HTMLInputElement>("input[name='product-name']")
        ?.focus();
    });
  };
  const closeEditor = () => {
    setEditorOpen(false);
    editorTriggerRef.current?.focus();
  };

  return (
    <section className="teacher-wis-shop" aria-label="상점 상품 관리">
      <header className="teacher-wis-shop__heading">
        <div>
          <span className="teacher-wis-shop__eyebrow">위스 상점</span>
          <h2>상품과 재고</h2>
        </div>
        <div className="teacher-wis-shop__actions">
          <button
            type="button"
            className="teacher-wis-shop__button"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
          >
            {previewOpen ? "상품 관리 보기" : "학생 상점 미리보기"}
          </button>
          {canManage && (
            <button
              type="button"
              className="teacher-wis-shop__button is-primary"
              disabled={productImageUploading}
              onClick={(event) => openEditor(event.currentTarget)}
            >
              <i className="fas fa-plus" aria-hidden="true" /> 상품 등록
            </button>
          )}
          {!canManage && (
            <span className="teacher-wis-shop__badge">조회 전용</span>
          )}
        </div>
      </header>

      {previewOpen ? (
        <div className="teacher-wis-shop__preview">
          <h3>
            학생 상점 미리보기 <span>{previewProducts.length}개</span>
          </h3>
          {previewProducts.length ? (
            <div className={WIS_PRODUCT_CARD_GRID_CLASSNAME}>
              {previewProducts.map((product) => (
                <WisProductCard
                  key={product.id}
                  product={{ ...product, stock: availableStock(product) }}
                  walletBalance={Number(product.price || 0)}
                  previewOnly
                  onCardClick={() =>
                    setPreviewSelectedProduct({
                      ...product,
                      stock: availableStock(product),
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="teacher-wis-shop__empty">
              학생에게 공개된 상품이 없습니다.
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="teacher-wis-shop__toolbar">
            <div
              className="teacher-wis-shop__filters"
              role="group"
              aria-label="상품 상태"
            >
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                  <span>
                    {
                      products.filter((product) =>
                        matchesFilter(product, item.value),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <label className="teacher-wis-shop__search">
              <i className="fas fa-search" aria-hidden="true" />
              <span className="sr-only">상품명 또는 설명 검색</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="상품명 또는 설명 검색"
              />
            </label>
          </div>

          <div className="teacher-wis-shop__inventory-label">
            <span aria-live="polite">{filteredProducts.length}개 상품</span>
            <span>
              재고 기준{" "}
              <InfoHelp
                label="재고 기준"
                sections={[
                  {
                    rows: [
                      {
                        label: "총 입고",
                        content:
                          "처음 등록한 수량과 추가 입고를 합친 누적 수량입니다.",
                      },
                      {
                        label: "판매 가능",
                        content:
                          "총 입고에서 주문 확보 수량과 지급 완료 수량을 뺀 값입니다.",
                      },
                      {
                        label: "주문 확보",
                        content:
                          "구매 요청부터 지급 전까지 확보한 수량입니다. 반려·취소 시 판매 가능 수량으로 돌아갑니다.",
                      },
                    ],
                  },
                ]}
              />
            </span>
          </div>

          {filteredProducts.length ? (
            <div className="teacher-wis-shop__products">
              {filteredProducts.map((product) => {
                const available = availableStock(product);
                const hasStockLedger =
                  typeof product.reservedStock === "number" &&
                  typeof product.soldStock === "number";
                const status =
                  product.isActive === false
                    ? "숨김"
                    : available === 0
                      ? "품절"
                      : "판매 중";
                return (
                  <article
                    className="teacher-wis-shop__product"
                    key={product.id}
                  >
                    <button
                      type="button"
                      className="teacher-wis-shop__product-image"
                      onClick={() =>
                        setPreviewSelectedProduct({
                          ...product,
                          stock: available,
                        })
                      }
                      aria-label={`${product.name} 상세 보기`}
                    >
                      {product.previewImageUrl || product.imageUrl ? (
                        <img
                          src={product.previewImageUrl || product.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <i className="fas fa-gift" aria-hidden="true" />
                      )}
                    </button>
                    <div className="teacher-wis-shop__product-main">
                      <div className="teacher-wis-shop__product-title">
                        <h3>{product.name}</h3>
                        <span
                          className={`teacher-wis-shop__badge ${status === "판매 중" ? "is-selling" : status === "품절" ? "is-warning" : ""}`}
                        >
                          {status}
                        </span>
                      </div>
                      <strong className="teacher-wis-shop__price">
                        {formatWisAmount(product.price)}
                      </strong>
                      {product.description && (
                        <p className="teacher-wis-shop__description">
                          {product.description}
                        </p>
                      )}
                      <dl className="teacher-wis-shop__stock">
                        <div className={available <= 3 ? "is-low" : ""}>
                          <dt>
                            {product.readOnly && !hasStockLedger
                              ? "보관된 재고"
                              : "판매 가능"}
                          </dt>
                          <dd>
                            {available}
                            <span>개</span>
                          </dd>
                        </div>
                        {hasStockLedger && (
                          <>
                            <div>
                              <dt>주문 확보</dt>
                              <dd>
                                {product.reservedStock}
                                <span>개</span>
                              </dd>
                            </div>
                            <div>
                              <dt>지급 완료</dt>
                              <dd>
                                {product.soldStock}
                                <span>개</span>
                              </dd>
                            </div>
                            <div>
                              <dt>총 입고</dt>
                              <dd>
                                {product.stock}
                                <span>개</span>
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                    </div>
                    {canManage && (
                      <div className="teacher-wis-shop__product-actions">
                        <button
                          type="button"
                          className="teacher-wis-shop__button"
                          disabled={productImageUploading}
                          onClick={(event) =>
                            openEditor(event.currentTarget, product)
                          }
                        >
                          상품·재고 수정
                        </button>
                        <button
                          type="button"
                          className="teacher-wis-shop__button is-quiet"
                          disabled={productImageUploading}
                          onClick={() => onToggleProduct(product)}
                        >
                          {product.isActive !== false ? "숨기기" : "판매 재개"}
                        </button>
                        {available <= 0 &&
                          Number(product.reservedStock || 0) === 0 && (
                            <button
                              type="button"
                              className="teacher-wis-shop__button is-danger"
                              disabled={productImageUploading}
                              onClick={() => onDeleteProduct(product)}
                            >
                              보관
                            </button>
                          )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="teacher-wis-shop__empty">
              <i className="fas fa-store" aria-hidden="true" />
              <p>
                {products.length
                  ? "조건에 맞는 상품이 없습니다."
                  : "등록된 상품이 없습니다."}
              </p>
              {products.length > 0 && (
                <button
                  type="button"
                  className="teacher-wis-shop__button"
                  onClick={() => {
                    setFilter("all");
                    setSearchQuery("");
                  }}
                >
                  전체 상품 보기
                </button>
              )}
            </div>
          )}
        </>
      )}

      {productOrderFeedback && (
        <p
          role="status"
          className={`teacher-wis-shop__feedback ${getPointFeedbackToneClass(productOrderFeedback)}`}
        >
          {productOrderFeedback}
        </p>
      )}
      {!editorOpen && productFeedback && (
        <p
          role="status"
          className={`teacher-wis-shop__feedback ${getPointFeedbackToneClass(productFeedback)}`}
        >
          {productFeedback}
        </p>
      )}

      {editorOpen && canManage && (
        <form
          ref={editorRef}
          onSubmit={onSubmit}
          className="teacher-wis-shop__editor"
          aria-labelledby="wis-product-editor-title"
          aria-busy={productImageUploading}
        >
          <div className="teacher-wis-shop__heading">
            <h3 id="wis-product-editor-title">
              {productForm.id ? "상품·재고 수정" : "새 상품 등록"}
            </h3>
            <button
              type="button"
              className="teacher-wis-shop__button is-quiet"
              disabled={productImageUploading}
              onClick={closeEditor}
            >
              닫기
            </button>
          </div>
          <fieldset disabled={productImageUploading}>
            <div className="teacher-wis-shop__editor-layout">
              <div className="teacher-wis-shop__image-editor">
                <div className="teacher-wis-shop__image-preview">
                  {productImagePreviewUrl ? (
                    <img
                      src={productImagePreviewUrl}
                      alt="선택한 상품 이미지"
                    />
                  ) : (
                    <i className="fas fa-image" aria-hidden="true" />
                  )}
                </div>
                <label className="teacher-wis-shop__field">
                  <span>상품 사진</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      onProductImageChange(event.target.files?.[0] || null);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="teacher-wis-shop__fields">
                <label className="teacher-wis-shop__field">
                  <span>상품명</span>
                  <input
                    name="product-name"
                    value={productForm.name}
                    required
                    maxLength={120}
                    onChange={(event) =>
                      onProductFormChange((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="teacher-wis-shop__field">
                  <span>상품 설명</span>
                  <textarea
                    rows={3}
                    value={productForm.description}
                    onChange={(event) =>
                      onProductFormChange((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="teacher-wis-shop__field-pair">
                  <label className="teacher-wis-shop__field">
                    <span>가격 (위스)</span>
                    <NumericInput
                      allowEmpty
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={productForm.price}
                      onChange={(event) =>
                        onProductFormChange((prev) => ({
                          ...prev,
                          price: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="teacher-wis-shop__field">
                    <span>총 입고 (개)</span>
                    <NumericInput
                      allowEmpty
                      type="number"
                      min={committedStock}
                      step="1"
                      required
                      value={productForm.stock}
                      onChange={(event) =>
                        onProductFormChange((prev) => ({
                          ...prev,
                          stock: event.target.value,
                        }))
                      }
                    />
                    {committedStock > 0 && (
                      <small>주문 확보·지급 완료 {committedStock}개 이상</small>
                    )}
                  </label>
                </div>
                {editingProduct && (
                  <div className="teacher-wis-shop__stock-result">
                    저장 후 판매 가능{" "}
                    <strong>
                      {Math.max(
                        0,
                        Number(productForm.stock || 0) - committedStock,
                      )}
                      개
                    </strong>
                  </div>
                )}
                <label className="teacher-wis-shop__checkbox">
                  <input
                    type="checkbox"
                    checked={productForm.isActive}
                    onChange={(event) =>
                      onProductFormChange((prev) => ({
                        ...prev,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  <span>학생 상점에 공개</span>
                </label>
              </div>
            </div>
          </fieldset>
          {productFeedback && (
            <p
              role="status"
              className={`teacher-wis-shop__feedback ${getPointFeedbackToneClass(productFeedback)}`}
            >
              {productFeedback}
            </p>
          )}
          <div className="teacher-wis-shop__editor-footer">
            <button
              type="submit"
              className="teacher-wis-shop__button is-primary"
              disabled={productImageUploading}
            >
              {productImageUploading ? "저장 중…" : "상품 저장"}
            </button>
          </div>
        </form>
      )}
      <WisProductDetailModal
        open={Boolean(previewSelectedProduct)}
        product={previewSelectedProduct}
        walletBalance={Math.max(0, Number(previewSelectedProduct?.price || 0))}
        onClose={() => setPreviewSelectedProduct(null)}
      />
    </section>
  );
};

export default PointProductsTab;
