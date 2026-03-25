import React from "react";
import StorageImage from "../../../components/common/StorageImage";
import type { SourceArchiveAsset } from "../../../types";

type LessonSourceArchivePickerModalProps = {
  open: boolean;
  assets: SourceArchiveAsset[];
  loading: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onSelectAsset: (asset: SourceArchiveAsset) => void;
};

const LessonSourceArchivePickerModal: React.FC<
  LessonSourceArchivePickerModalProps
> = ({
  open,
  assets,
  loading,
  searchValue,
  onSearchChange,
  onClose,
  onSelectAsset,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] bg-black/45 backdrop-blur-sm">
      <div className="flex h-full items-end justify-center p-3 md:items-center md:p-6">
        <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                사료창고
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                각주에 넣을 이미지를 선택하세요
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              닫기
            </button>
          </div>
          <div className="border-b border-slate-200 px-5 py-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                검색
              </span>
              <input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="제목, 설명, 태그로 찾기"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
                사료창고 목록을 불러오는 중입니다.
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
                선택할 수 있는 이미지 사료가 없습니다.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onSelectAsset(asset)}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
                  >
                    <div className="aspect-[4/3] bg-slate-100">
                      {asset.image.thumbPath || asset.image.displayPath ? (
                        <StorageImage
                          path={asset.image.thumbPath || asset.image.displayPath}
                          alt={asset.title}
                          className="h-full w-full object-cover"
                          fallback={
                            <div className="flex h-full items-center justify-center text-sm text-slate-400">
                              이미지 없음
                            </div>
                          }
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">
                          이미지 없음
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 px-4 py-4">
                      <div className="line-clamp-1 text-base font-bold text-slate-900">
                        {asset.title}
                      </div>
                      <div className="line-clamp-2 text-sm text-slate-500">
                        {asset.description || "설명이 없습니다."}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {asset.tags.slice(0, 3).map((tag) => (
                          <span
                            key={`${asset.id}-${tag}`}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LessonSourceArchivePickerModal;
