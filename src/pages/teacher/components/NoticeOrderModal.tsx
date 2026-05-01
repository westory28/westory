import React, { useEffect, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";

interface NoticeOrderItem {
  id: string;
  category: string;
  targetType: string;
  targetClass?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}

interface NoticeOrderModalProps {
  isOpen: boolean;
  notices: NoticeOrderItem[];
  onClose: () => void;
}

const getCategoryLabel = (category?: string) => {
  if (category === "event") return "학교 행사";
  if (category === "exam") return "정기 시험";
  if (category === "performance") return "수행평가";
  if (category === "prep") return "준비";
  if (category === "dday") return "D-Day";
  return "공지";
};

const NoticeOrderModal: React.FC<NoticeOrderModalProps> = ({
  isOpen,
  notices,
  onClose,
}) => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [items, setItems] = useState<NoticeOrderItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setItems(notices);
    }
  }, [isOpen, notices]);

  if (!isOpen) return null;

  const moveItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setItems((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const path = `years/${config.year}/semesters/${config.semester}/notices`;
      items.forEach((item, index) => {
        batch.set(
          doc(db, path, item.id),
          { noticeOrder: index, updatedAt: serverTimestamp() },
          { merge: true },
        );
      });
      await batch.commit();
      showToast({
        tone: "success",
        title: "알림장 순서가 저장되었습니다.",
      });
      onClose();
    } catch (error) {
      console.error("Failed to save notice order:", error);
      showToast({
        tone: "error",
        title: "순서 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <h3 className="text-xl font-extrabold text-gray-900">
              <i className="fas fa-list-ol mr-2 text-blue-600"></i>
              알림장 순서 편집
            </h3>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              위에 있는 이미지부터 학생 대시보드에 먼저 표시됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="닫기"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
              순서를 편집할 알림장 이미지가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[42px_88px_minmax(0,1fr)_84px] items-center gap-3 rounded-xl border border-gray-200 bg-white p-3"
                >
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                    {index + 1}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="aspect-video w-full object-contain"
                      />
                    ) : (
                      <div className="aspect-video w-full bg-gray-100" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-gray-900">
                      {getCategoryLabel(item.category)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-gray-500">
                      {item.targetType === "class" ? `${item.targetClass}반 대상` : "전체 공통"}
                    </div>
                  </div>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => moveItem(index, -1)}
                      disabled={index === 0 || saving}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="위로 이동"
                    >
                      <i className="fas fa-chevron-up"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, 1)}
                      disabled={index === items.length - 1 || saving}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="아래로 이동"
                    >
                      <i className="fas fa-chevron-down"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-extrabold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || items.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "순서 저장"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoticeOrderModal;
