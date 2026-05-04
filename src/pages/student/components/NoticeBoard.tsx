import React, { useEffect, useState } from "react";
import { InlineLoading } from "../../../components/common/LoadingState";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  getStudentClassKey,
  subscribeVisibleNotices,
  type VisibleNotice,
} from "../../../lib/visibleSchedule";

type Notice = VisibleNotice;

const getCategoryLabel = (category?: string) => {
  if (category === "event") return "학교 행사";
  if (category === "exam") return "정기 시험";
  if (category === "performance") return "수행평가";
  if (category === "prep") return "준비";
  if (category === "dday") return "D-Day";
  return "공지";
};

const NoticeBoard: React.FC = () => {
  const { config, userData } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const { year, semester } = getYearSemester(config);

    const path = `years/${year}/semesters/${semester}/notices`;
    const userClassStr = getStudentClassKey(userData?.grade, userData?.class);
    const unsubscribe = subscribeVisibleNotices(
      db,
      path,
      userClassStr,
      (loadedNotices) => {
        setNotices(loadedNotices.filter((notice) => Boolean(notice.imageUrl)));
        setLoading(false);
      },
      (error) => {
        console.error("Notice fetch error:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [config?.year, config?.semester, userData?.class, userData?.grade]);

  useEffect(() => {
    setActiveIndex(0);
    setIsPaused(false);
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const showCarousel = notices.length > 1;

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
    <div className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-bullhorn mr-2 text-blue-600"></i>
          알림장
        </h3>
        {showCarousel && (
          <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
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
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <InlineLoading
            className="flex h-full min-h-[180px] items-center"
            message="알림장을 불러오는 중입니다."
            showWarning
          />
        )}

        {!loading && !activeNotice && (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
            등록된 알림 이미지가 없습니다.
          </div>
        )}

        {!loading && activeNotice && (
          <div className="flex h-full flex-col">
            <div className="relative aspect-[16/9] w-full flex-none overflow-hidden rounded-xl bg-gray-100">
              <div
                className="flex h-full w-full transition-transform duration-500 ease-out will-change-transform motion-reduce:transition-none"
                style={{
                  transform: `translateX(-${activeIndex * 100}%)`,
                }}
              >
                {notices.map((notice) => (
                  <img
                    key={notice.id}
                    src={notice.imageUrl}
                    alt="알림장"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full shrink-0 object-cover"
                  />
                ))}
              </div>
              <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                {getCategoryLabel(activeNotice.category)}
              </span>
            </div>

            {showCarousel && (
              <div className="mt-3 flex items-center justify-center gap-1.5">
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
          </div>
        )}
      </div>
    </div>
  );
};

export default NoticeBoard;
