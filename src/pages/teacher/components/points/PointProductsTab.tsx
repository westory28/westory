import React, { useEffect, useMemo, useState } from "react";
import WisProductCard, {
  WIS_PRODUCT_CARD_GRID_CLASSNAME,
} from "../../../../components/common/WisProductCard";
import { getPointFeedbackToneClass } from "../../../../constants/pointLabels";
import { formatWisAmount } from "../../../../lib/pointFormatters";
import type { PointProduct } from "../../../../types";

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
  onProductFormChange: (
    updater: (prev: ProductFormState) => ProductFormState,
  ) => void;
  onProductImageChange: (file: File | null) => void;
  onEditProduct: (product: PointProduct) => void;
  onResetForm: () => void;
  onToggleProduct: (product: PointProduct) => void;
  onSubmit: (event: React.FormEvent) => void;
}

const formFieldClassName = "grid min-w-0 gap-2";
const inputClassName =
  "w-full min-w-0 rounded-lg border border-gray-300 px-4 py-2.5 text-sm box-border";
const textareaClassName =
  "w-full min-w-0 rounded-lg border border-gray-300 px-4 py-3 text-sm box-border";
const helperTextClassName = "text-xs leading-5 text-gray-500";

const normalizeSearchValue = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");

const PointProductsTab: React.FC<PointProductsTabProps> = ({
  products,
  productForm,
  productFeedback,
  canManage,
  productImagePreviewUrl,
  productImageUploading,
  onProductFormChange,
  onProductImageChange,
  onEditProduct,
  onResetForm,
  onToggleProduct,
  onSubmit,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const normalizedSearchQuery = normalizeSearchValue(searchQuery);
  const filteredProducts = useMemo(() => {
    if (!normalizedSearchQuery) return products;
    return products.filter((product) =>
      normalizeSearchValue(String(product.name || "")).includes(
        normalizedSearchQuery,
      ),
    );
  }, [normalizedSearchQuery, products]);

  const previewProducts = useMemo(() => {
    return filteredProducts.filter((product) => product.isActive !== false);
  }, [filteredProducts]);

  useEffect(() => {
    if (!previewOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewOpen]);

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.52fr)_minmax(320px,380px)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gray-50 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-800">
                  상점 상품 목록
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  상품명을 검색하고, 학생 상점 4열 레이아웃을 화면 안에서 바로
                  확인할 수 있습니다.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  {normalizedSearchQuery
                    ? `검색 결과 ${filteredProducts.length}개 / 전체 ${products.length}개`
                    : `${products.length}개`}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50 whitespace-nowrap"
                >
                  학생 상점 미리보기
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="상품명 검색"
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
              />
              {normalizedSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 whitespace-nowrap"
                >
                  검색 초기화
                </button>
              )}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <table className="w-full table-fixed text-sm text-left">
              <colgroup>
                <col />
                <col className="w-[108px]" />
                <col className="w-[78px]" />
                <col className="w-[96px]" />
                <col className="w-[136px]" />
              </colgroup>
              <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                <tr>
                  <th className="p-4 whitespace-nowrap">상품명</th>
                  <th className="p-4 text-right whitespace-nowrap">가격</th>
                  <th className="p-4 text-right whitespace-nowrap">재고</th>
                  <th className="p-4 text-center whitespace-nowrap">상태</th>
                  <th className="p-4 text-center whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-gray-400">
                      {normalizedSearchQuery
                        ? "검색 조건에 맞는 상품이 없습니다."
                        : "등록된 상품이 없습니다."}
                    </td>
                  </tr>
                )}
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="transition hover:bg-gray-50">
                    <td className="min-w-0 p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                          {product.previewImageUrl || product.imageUrl ? (
                            <img
                              src={product.previewImageUrl || product.imageUrl}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <i className="fas fa-image text-gray-300"></i>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-bold text-gray-800">
                            {product.name}
                          </div>
                          <div className="mt-1 truncate text-xs text-gray-500">
                            {product.description || "설명이 아직 없습니다."}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right font-bold text-gray-800 whitespace-nowrap">
                      {formatWisAmount(product.price)}
                    </td>
                    <td className="p-4 text-right text-gray-700 whitespace-nowrap">
                      {product.stock}개
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`inline-flex min-w-[86px] items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1 text-xs font-bold leading-none ${product.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}
                      >
                        {product.isActive ? "노출 중" : "숨김"}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="mx-auto grid w-full max-w-[96px] gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEditProduct(product)}
                          className="w-full rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-100 whitespace-nowrap"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => onToggleProduct(product)}
                          className="w-full rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-60 whitespace-nowrap"
                        >
                          {product.isActive ? "숨기기" : "다시 노출"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-800">
                {productForm.id ? "상품 정보 수정" : "새 상품 등록"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                학생 위스 상점에 노출할 상품 정보와 대표 이미지를 관리합니다.
              </p>
            </div>
            {productForm.id && (
              <button
                type="button"
                onClick={onResetForm}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 whitespace-nowrap"
              >
                새 상품 작성
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <label className={formFieldClassName}>
              <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                상품명
              </span>
              <input
                value={productForm.name}
                onChange={(event) =>
                  onProductFormChange((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="예: 문화상품권 5천원권"
                className={inputClassName}
              />
            </label>
            <label className={formFieldClassName}>
              <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                상품 설명
              </span>
              <textarea
                value={productForm.description}
                onChange={(event) =>
                  onProductFormChange((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                rows={3}
                placeholder="학생에게 보여줄 상품 설명을 입력하세요."
                className={textareaClassName}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className={formFieldClassName}>
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  가격(위스)
                </span>
                <input
                  type="number"
                  min="0"
                  value={productForm.price}
                  onChange={(event) =>
                    onProductFormChange((prev) => ({
                      ...prev,
                      price: event.target.value,
                    }))
                  }
                  placeholder="예: 500"
                  className={inputClassName}
                />
                <span className={helperTextClassName}>
                  학생 상점에는 {formatWisAmount(productForm.price || 0)} 형태로
                  표시됩니다.
                </span>
              </label>
              <label className={formFieldClassName}>
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  재고(개)
                </span>
                <input
                  type="number"
                  min="0"
                  value={productForm.stock}
                  onChange={(event) =>
                    onProductFormChange((prev) => ({
                      ...prev,
                      stock: event.target.value,
                    }))
                  }
                  placeholder="예: 20"
                  className={inputClassName}
                />
              </label>
            </div>
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-nowrap sm:items-start">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
                  {productImagePreviewUrl ? (
                    <img
                      src={productImagePreviewUrl}
                      alt="상품 미리보기"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <i className="fas fa-image text-2xl text-gray-300"></i>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-gray-800 whitespace-nowrap">
                    대표 이미지
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    학생 상점에 보일 대표 이미지를 등록하세요. 선택한 이미지는
                    자동으로 압축되어 저장됩니다.
                  </p>
                  <label className="mt-3 inline-flex w-full cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:w-auto whitespace-nowrap">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) =>
                        onProductImageChange(event.target.files?.[0] || null)
                      }
                    />
                    대표 이미지 선택
                  </label>
                  <p className="mt-2 text-xs text-gray-500">
                    파일을 선택한 뒤 상품 저장을 누르면 대표 이미지로
                    적용됩니다.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className={formFieldClassName}>
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  목록 표시 순서
                </span>
                <input
                  type="number"
                  min="0"
                  value={productForm.sortOrder}
                  onChange={(event) =>
                    onProductFormChange((prev) => ({
                      ...prev,
                      sortOrder: event.target.value,
                    }))
                  }
                  placeholder="예: 10"
                  className={inputClassName}
                />
                <span className={helperTextClassName}>
                  숫자가 작을수록 학생 상점에서 먼저 보입니다.
                </span>
              </label>
              <div className="grid min-w-0 gap-2">
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  대표 이미지 상태
                </span>
                <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold leading-5 text-gray-500 break-keep">
                  {productImageUploading
                    ? "대표 이미지를 준비하고 있습니다."
                    : productImagePreviewUrl
                      ? "대표 이미지가 준비되어 있습니다."
                      : "아직 등록된 대표 이미지가 없습니다."}
                </div>
                <span className={helperTextClassName}>
                  이미지를 선택한 뒤 저장하면 상품 대표 이미지로 적용됩니다.
                </span>
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="font-bold text-gray-800 whitespace-nowrap">
                학생 화면에 노출하기
              </span>
              <input
                type="checkbox"
                checked={productForm.isActive}
                onChange={(event) =>
                  onProductFormChange((prev) => ({
                    ...prev,
                    isActive: event.target.checked,
                  }))
                }
                className="h-4 w-4"
              />
            </label>
          </div>

          {!!productFeedback && (
            <div
              className={`mt-4 rounded-lg px-4 py-3 text-sm font-bold ${getPointFeedbackToneClass(productFeedback)}`}
            >
              {productFeedback}
            </div>
          )}

          <button
            type="submit"
            disabled={!canManage || productImageUploading}
            className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300 whitespace-nowrap"
          >
            상품 저장
          </button>
        </form>
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 sm:p-6"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="flex max-h-[min(88vh,54rem)] w-full max-w-[min(1100px,100%)] min-w-0 flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 flex-col gap-3 border-b border-gray-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900 whitespace-nowrap">
                  학생 상점 미리보기
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  현재 검색 조건에서 학생에게 실제로 보이는 상점 카드만 같은 4열
                  구조로 보여 줍니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50"
                aria-label="학생 상점 미리보기 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6 sm:py-6">
              {previewProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-12 text-center text-gray-500">
                  학생에게 보이는 상품이 없습니다.
                </div>
              ) : (
                <div className="pointer-events-none">
                  <div className={WIS_PRODUCT_CARD_GRID_CLASSNAME}>
                    {previewProducts.map((product) => (
                      <WisProductCard
                        key={`preview-${product.id}`}
                        product={product}
                        walletBalance={Math.max(0, Number(product.price || 0))}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PointProductsTab;
