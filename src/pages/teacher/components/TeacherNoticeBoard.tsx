import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { InlineLoading } from "../../../components/common/LoadingState";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import NoticeModal from "./NoticeModal";
import NoticeOrderModal from "./NoticeOrderModal";
import { getYearSemester } from "../../../lib/semesterScope";

interface Notice {
  id: string;
  targetType: string;
  targetClass?: string;
  category: string;
  content: string;
  imageUrl?: string;
  imageStoragePath?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageByteSize?: number;
  noticeOrder?: number;
  createdAt: any;
  targetDate?: string;
}

const getCategoryLabel = (category?: string) => {
  if (category === "event") return "학교 행사";
  if (category === "exam") return "정기 시험";
  if (category === "performance") return "수행평가";
  if (category === "prep") return "준비";
  if (category === "dday") return "D-Day";
  return "공지";
};

const TeacherNoticeBoard: React.FC = () => {
  const { config } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotice, setSelectedNotice] = useState<Notice | undefined>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const { year, semester } = getYearSemester(config);

    const path = `years/${year}/semesters/${semester}/notices`;
    const noticeQuery = query(
      collection(db, path),
      orderBy("createdAt", "desc"),
      limit(20),
    );

    const unsubscribe = onSnapshot(
      noticeQuery,
      (snapshot) => {
        const loadedNotices: Notice[] = [];
        snapshot.docs.forEach((docSnap, index) => {
          const notice = { id: docSnap.id, ...docSnap.data() } as Notice;
          if (notice.imageUrl) {
            const explicitOrder = Number(notice.noticeOrder);
            loadedNotices.push({
              ...notice,
              noticeOrder: Number.isFinite(explicitOrder) ? explicitOrder : index,
            });
          }
        });
        setNotices(
          loadedNotices.sort(
            (left, right) => Number(left.noticeOrder || 0) - Number(right.noticeOrder || 0),
          ),
        );
        setLoading(false);
      },
      (error) => {
        console.error("Notice fetch error:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [config]);

  useEffect(() => {
    setActiveIndex(0);
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const showCarousel = notices.length > 1;
  const activeImageRatio = useMemo(() => {
    if (!activeNotice?.imageWidth || !activeNotice?.imageHeight) return "16 / 9";
    return `${activeNotice.imageWidth} / ${activeNotice.imageHeight}`;
  }, [activeNotice]);

  const handleCreate = () => {
    setSelectedNotice(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (notice: Notice) => {
    setSelectedNotice(notice);
    setIsModalOpen(true);
  };

  const move = (direction: -1 | 1) => {
    setActiveIndex((prev) => {
      if (notices.length <= 1) return 0;
      return (prev + direction + notices.length) % notices.length;
    });
  };

  return (
    <div className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-bullhorn mr-2 text-blue-600"></i>
          알림장
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOrderModalOpen(true)}
            disabled={notices.length <= 1}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <i className="fas fa-list-ol mr-1"></i>
            순서
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
          >
            <i className="fas fa-plus mr-1"></i>
            쓰기
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <InlineLoading className="flex h-full min-h-[180px] items-center" message="알림장을 불러오는 중입니다." showWarning />
        )}

        {!loading && !activeNotice && (
          <button
            type="button"
            onClick={handleCreate}
            className="flex h-full min-h-[180px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/40 text-sm font-bold text-blue-700"
          >
            <i className="far fa-image mb-2 text-3xl"></i>
            알림장 이미지를 등록해 주세요.
          </button>
        )}

        {!loading && activeNotice && (
          <div className="flex h-full flex-col">
            <button
              type="button"
              onClick={() => handleEdit(activeNotice)}
              className="group relative block min-h-0 flex-1 overflow-hidden rounded-xl text-left"
              title="알림장 이미지 수정"
            >
              <img
                src={activeNotice.imageUrl}
                alt="알림장"
                loading="lazy"
                decoding="async"
                className="h-full min-h-[180px] w-full object-contain transition group-hover:scale-[1.01]"
                style={{ aspectRatio: activeImageRatio }}
              />
              <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                {getCategoryLabel(activeNotice.category)}
              </span>
            </button>

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleEdit(activeNotice)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-extrabold text-gray-600 transition hover:bg-gray-50 hover:text-blue-700"
              >
                <i className="fas fa-hand-pointer text-gray-400"></i>
                이미지 수정
              </button>

              {showCarousel && (
                <div className="flex items-center gap-2">
                  <div className="mr-1 flex items-center gap-1.5">
                    {notices.map((notice, index) => (
                      <button
                        key={`${notice.id}-dot`}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        className={`h-2.5 rounded-full transition ${
                          activeIndex === index ? "w-6 bg-blue-600" : "w-2.5 bg-gray-200"
                        }`}
                        aria-label={`${index + 1}번째 알림 보기`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => move(-1)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-blue-600 transition hover:bg-blue-50"
                    aria-label="이전 알림"
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(1)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-blue-600 transition hover:bg-blue-50"
                    aria-label="다음 알림"
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <NoticeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        noticeData={selectedNotice}
        onSave={() => {
          /* Real-time updates handle list refresh */
        }}
      />
      <NoticeOrderModal
        isOpen={isOrderModalOpen}
        notices={notices}
        onClose={() => setIsOrderModalOpen(false)}
      />
    </div>
  );
};

export default TeacherNoticeBoard;
