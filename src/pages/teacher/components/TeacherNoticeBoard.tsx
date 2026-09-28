import React, { useEffect, useRef, useState } from "react";
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
import NoticeManagerModal from "./NoticeManagerModal";
import { getYearSemester } from "../../../lib/semesterScope";
import { NOTICE_IMAGE_RECOMMENDED_WIDTH } from "../../../lib/noticeImages";

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
  developerLogPostId?: string;
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

interface TeacherNoticeBoardProps {
  openManager?: boolean;
  onManagerOpened?: () => void;
}

const TeacherNoticeBoard: React.FC<TeacherNoticeBoardProps> = ({
  openManager = false,
  onManagerOpened,
}) => {
  const { config } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotice, setSelectedNotice] = useState<Notice | undefined>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const width = Math.round(viewport.clientWidth);
      const height = Math.round(viewport.clientHeight);
      setViewportSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Uploads retain the existing 16:9 crop. Recommend that same ratio within
  // the available slot so a suggested source will not be cropped on upload.
  const recommendedUnit = Math.max(
    1,
    Math.min(
      NOTICE_IMAGE_RECOMMENDED_WIDTH / 16,
      Math.ceil(Math.min(viewportSize.width / 16, viewportSize.height / 9) * 2),
    ),
  );
  const recommendedImageSize =
    viewportSize.width > 0 && viewportSize.height > 0
      ? { width: recommendedUnit * 16, height: recommendedUnit * 9 }
      : undefined;

  useEffect(() => {
    if (!openManager) return;
    setSelectedNotice(undefined);
    setIsModalOpen(true);
    onManagerOpened?.();
  }, [openManager, onManagerOpened]);

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
              noticeOrder: Number.isFinite(explicitOrder)
                ? explicitOrder
                : index,
            });
          }
        });
        setNotices(
          loadedNotices.sort(
            (left, right) =>
              Number(left.noticeOrder || 0) - Number(right.noticeOrder || 0),
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
    setIsPaused(false);
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const showCarousel = notices.length > 1;

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

  useEffect(() => {
    if (!showCarousel || isPaused) return undefined;

    const timerId = window.setInterval(() => {
      move(1);
    }, 5000);

    return () => window.clearInterval(timerId);
  }, [showCarousel, isPaused, notices.length]);

  return (
    <div className="teacher-notice-board flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-bullhorn mr-2 text-blue-600"></i>
          알림장
        </h3>
      </div>

      <div
        ref={viewportRef}
        className="teacher-notice-board__viewport relative min-h-0 flex-1 overflow-hidden rounded-xl"
      >
        {loading && (
          <InlineLoading
            className="flex h-full items-center"
            message="알림장을 불러오는 중입니다."
            showWarning
          />
        )}

        {!loading && !activeNotice && (
          <button
            type="button"
            onClick={handleCreate}
            className="flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/40 text-sm font-bold text-blue-700"
          >
            <i className="far fa-image mb-2 text-3xl"></i>
            알림장 이미지를 등록해 주세요.
          </button>
        )}

        {!loading && activeNotice && (
          <>
            <button
              type="button"
              onClick={() => handleEdit(activeNotice)}
              className="group block h-full w-full text-left"
              title="알림장 이미지 수정"
            >
              <div
                className="teacher-notice-board__image-track flex h-full w-full transition-transform duration-500 ease-out will-change-transform motion-reduce:transition-none"
                style={{
                  transform: `translateX(-${activeIndex * 100}%)`,
                }}
              >
                {notices.map((notice) => (
                  <img
                    key={notice.id}
                    src={notice.imageUrl}
                    alt="알림장"
                    loading={notice.id === activeNotice.id ? "eager" : "lazy"}
                    decoding="async"
                    className="teacher-notice-board__image h-full w-full shrink-0 object-contain"
                  />
                ))}
              </div>
            </button>
            <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
              {getCategoryLabel(activeNotice.category)}
            </span>
          </>
        )}
      </div>
      {!loading && activeNotice && (
        <div className="teacher-notice-board__controls mt-4 flex flex-wrap items-center gap-2">
          {showCarousel && (
            <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => move(-1)}
                className="inline-flex h-9 w-9 items-center justify-center text-blue-700 transition hover:bg-blue-50"
                aria-label="이전 알림"
              >
                <i className="fas fa-chevron-left text-xs"></i>
              </button>
              <button
                type="button"
                onClick={() => setIsPaused((prev) => !prev)}
                className="inline-flex h-9 w-9 items-center justify-center border-x border-gray-200 text-blue-700 transition hover:bg-blue-50"
                aria-label={
                  isPaused ? "알림 자동 넘김 재생" : "알림 자동 넘김 일시정지"
                }
                title={isPaused ? "재생" : "일시정지"}
              >
                <i
                  className={`fas ${isPaused ? "fa-play" : "fa-pause"} text-xs`}
                ></i>
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                className="inline-flex h-9 w-9 items-center justify-center text-blue-700 transition hover:bg-blue-50"
                aria-label="다음 알림"
              >
                <i className="fas fa-chevron-right text-xs"></i>
              </button>
            </div>
          )}

          {showCarousel && (
            <div className="ml-5 flex items-center gap-1.5">
              {notices.map((notice, index) => (
                <button
                  key={`${notice.id}-dot`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`h-2.5 rounded-full transition ${
                    activeIndex === index
                      ? "w-6 bg-blue-600"
                      : "w-2.5 bg-gray-200"
                  }`}
                  aria-label={`${index + 1}번째 알림 보기`}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleEdit(activeNotice)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-extrabold text-gray-600 transition hover:bg-gray-50 hover:text-blue-700"
          >
            <i className="fas fa-hand-pointer text-gray-400"></i>
            이미지 수정
          </button>
          {activeNotice.developerLogPostId && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
              <i className="fas fa-link text-[10px]"></i>
              게시물 연동
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
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
      )}
      <p
        className="teacher-notice-board__size-hint"
        title={`현재 표시 영역 ${viewportSize.width} × ${viewportSize.height}px. 16:9 맞춤 표시 크기의 2배 기준, 최대 1200 × 675px.`}
      >
        {recommendedImageSize
          ? `권장 이미지 ${recommendedImageSize.width} × ${recommendedImageSize.height}px · 16:9`
          : "이미지 권장 크기를 확인하는 중입니다."}
      </p>

      {(isModalOpen || isOrderModalOpen) && (
        <NoticeManagerModal
          notices={notices}
          initialNotice={selectedNotice}
          initialOrder={isOrderModalOpen}
          recommendedImageSize={recommendedImageSize}
          onClose={() => {
            setIsModalOpen(false);
            setIsOrderModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default TeacherNoticeBoard;
