import React, { useEffect, useMemo, useState } from "react";
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
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const showCarousel = notices.length > 1;
  const activeImageRatio = useMemo(() => {
    if (!activeNotice?.imageWidth || !activeNotice?.imageHeight) return "16 / 9";
    return `${activeNotice.imageWidth} / ${activeNotice.imageHeight}`;
  }, [activeNotice]);

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
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm font-bold text-gray-400">
            불러오는 중...
          </div>
        )}

        {!loading && !activeNotice && (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
            등록된 알림 이미지가 없습니다.
          </div>
        )}

        {!loading && activeNotice && (
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl">
              <img
                src={activeNotice.imageUrl}
                alt="알림장"
                loading="lazy"
                decoding="async"
                className="h-full min-h-[180px] w-full object-contain"
                style={{ aspectRatio: activeImageRatio }}
              />
              <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                {getCategoryLabel(activeNotice.category)}
              </span>
            </div>

            {showCarousel && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
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
                <div className="flex items-center gap-2">
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NoticeBoard;
