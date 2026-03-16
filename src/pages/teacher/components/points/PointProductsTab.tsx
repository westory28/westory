import React from 'react';
import { getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import type { PointProduct } from '../../../../types';

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
    onProductFormChange: (updater: (prev: ProductFormState) => ProductFormState) => void;
    onProductImageChange: (file: File | null) => void;
    onEditProduct: (product: PointProduct) => void;
    onResetForm: () => void;
    onToggleProduct: (product: PointProduct) => void;
    onSubmit: (event: React.FormEvent) => void;
}

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
}) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 p-5">
                <h2 className="text-lg font-bold text-gray-800">상점 상품 목록</h2>
                <div className="text-sm text-gray-500">{products.length}개</div>
            </div>
            <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm text-left">
                    <colgroup>
                        <col />
                        <col className="w-[96px]" />
                        <col className="w-[88px]" />
                        <col className="w-[92px]" />
                        <col className="w-[120px]" />
                    </colgroup>
                    <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                        <tr>
                            <th className="p-4">상품명</th>
                            <th className="p-4 text-right">가격</th>
                            <th className="p-4 text-right">재고</th>
                            <th className="p-4 text-center">상태</th>
                            <th className="p-4 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {products.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-10 text-center text-gray-400">등록된 상품이 없습니다.</td>
                            </tr>
                        )}
                        {products.map((product) => (
                            <tr key={product.id} className="transition hover:bg-gray-50">
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                                            {(product.previewImageUrl || product.imageUrl) ? (
                                                <img src={product.previewImageUrl || product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                            ) : (
                                                <i className="fas fa-image text-gray-300"></i>
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate font-bold text-gray-800">{product.name}</div>
                                            <div className="mt-1 truncate text-xs text-gray-500">{product.description || '설명이 아직 없습니다.'}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-right font-bold text-gray-800">{product.price}</td>
                                <td className="p-4 text-right text-gray-700">{product.stock}</td>
                                <td className="p-4 text-center">
                                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${product.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {product.isActive ? '노출 중' : '숨김'}
                                    </span>
                                </td>
                                <td className="p-4 text-center">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <button type="button" onClick={() => onEditProduct(product)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-100">
                                            수정
                                        </button>
                                        <button type="button" disabled={!canManage} onClick={() => onToggleProduct(product)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-60">
                                            {product.isActive ? '숨기기' : '다시 노출'}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">{productForm.id ? '상품 정보 수정' : '새 상품 등록'}</h2>
                    <p className="mt-1 text-sm text-gray-500">학생 포인트 상점에 노출할 상품을 관리합니다.</p>
                </div>
                {productForm.id && (
                    <button type="button" onClick={onResetForm} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50">
                        새 상품 작성
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4">
                <input value={productForm.name} onChange={(event) => onProductFormChange((prev) => ({ ...prev, name: event.target.value }))} placeholder="상품명" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm" />
                <textarea value={productForm.description} onChange={(event) => onProductFormChange((prev) => ({ ...prev, description: event.target.value }))} rows={3} placeholder="상품 설명" className="rounded-lg border border-gray-300 px-4 py-3 text-sm" />
                <div className="grid grid-cols-2 gap-4">
                    <input type="number" min="0" value={productForm.price} onChange={(event) => onProductFormChange((prev) => ({ ...prev, price: event.target.value }))} placeholder="가격" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm" />
                    <input type="number" min="0" value={productForm.stock} onChange={(event) => onProductFormChange((prev) => ({ ...prev, stock: event.target.value }))} placeholder="재고" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm" />
                </div>
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                    <div className="flex items-start gap-4">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
                            {productImagePreviewUrl ? (
                                <img src={productImagePreviewUrl} alt="상품 미리보기" className="h-full w-full object-cover" />
                            ) : (
                                <i className="fas fa-image text-2xl text-gray-300"></i>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-gray-800">상품 이미지 업로드</div>
                            <p className="mt-1 text-xs leading-5 text-gray-500">업로드 시 자동으로 압축하고, 학생 목록에서는 저해상도 미리보기 이미지를 사용합니다.</p>
                            <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => onProductImageChange(event.target.files?.[0] || null)}
                                />
                                이미지 파일 선택
                            </label>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <input type="number" min="0" value={productForm.sortOrder} onChange={(event) => onProductFormChange((prev) => ({ ...prev, sortOrder: event.target.value }))} placeholder="정렬 순서" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm" />
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold text-gray-500">
                        {productImageUploading ? '이미지 처리 중...' : productImagePreviewUrl ? '미리보기 이미지 준비됨' : '이미지 없음'}
                    </div>
                </div>
                <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <span className="font-bold text-gray-800">학생 화면에 노출하기</span>
                    <input type="checkbox" checked={productForm.isActive} onChange={(event) => onProductFormChange((prev) => ({ ...prev, isActive: event.target.checked }))} className="h-4 w-4" />
                </label>
            </div>

            {!!productFeedback && <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-bold ${getPointFeedbackToneClass(productFeedback)}`}>{productFeedback}</div>}

            <button type="submit" disabled={!canManage || productImageUploading} className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300">
                상품 저장
            </button>
        </form>
    </div>
);

export default PointProductsTab;
