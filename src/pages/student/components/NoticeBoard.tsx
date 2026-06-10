import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null);
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const [isSliding, setIsSliding] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const slideFrameRef = useRef<number | null>(null);

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
    if (slideFrameRef.current !== null) {
      window.cancelAnimationFrame(slideFrameRef.current);
      slideFrameRef.current = null;
    }
    setActiveIndex(0);
    setIncomingIndex(null);
    setIsSliding(false);
    setIsPaused(false);
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const incomingNotice =
    incomingIndex === null ? null : notices[incomingIndex] || null;
  const showCarousel = notices.length > 1;
  const selectedIndex = incomingIndex ?? activeIndex;

  const finishSlide = useCallback(() => {
    if (incomingIndex !== null) {
      setActiveIndex(incomingIndex);
    }
    setIncomingIndex(null);
    setIsSliding(false);
  }, [incomingIndex]);

  const startSlide = useCallback(
    (nextIndex: number, direction: 1 | -1) => {
      if (!showCarousel || isSliding || incomingIndex !== null) return;
      const normalizedIndex = (nextIndex + notices.length) % notices.length;
      if (normalizedIndex === activeIndex) return;

      if (slideFrameRef.current !== null) {
        window.cancelAnimationFrame(slideFrameRef.current);
      }

      setSlideDirection(direction);
      setIncomingIndex(normalizedIndex);
      setIsSliding(false);
      slideFrameRef.current = window.requestAnimationFrame(() => {
        slideFrameRef.current = window.requestAnimationFrame(() => {
          setIsSliding(true);
          slideFrameRef.current = null;
        });
      });
    },
    [activeIndex, incomingIndex, isSliding, notices.length, showCarousel],
  );

  const move = useCallback(
    (direction: -1 | 1) => {
      startSlide(activeIndex + direction, direction);
    },
    [activeIndex, startSlide],
  );

  const selectNotice = (index: number) => {
    if (!showCarousel || index === selectedIndex) return;
    startSlide(index, index > activeIndex ? 1 : -1);
  };

  const openLinkedPost = (notice: Notice | null) => {
    const linkedPostId = String(notice?.developerLogPostId || "").trim();
    if (!linkedPostId) return;
    navigate(`/developer-log/${linkedPostId}`);
  };

  useEffect(() => {
    if (!isSliding || incomingIndex === null) return undefined;

    const timerId = window.setTimeout(finishSlide, 900);

    return () => window.clearTimeout(timerId);
  }, [finishSlide, incomingIndex, isSliding]);

  useEffect(
    () => () => {
      if (slideFrameRef.current !== null) {
        window.cancelAnimationFrame(slideFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showCarousel || isPaused || isSliding || incomingIndex !== null) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      move(1);
    }, 5000);

    return () => window.clearInterval(timerId);
  }, [incomingIndex, isPaused, isSliding, move, showCarousel]);

  return (
    <div className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-bullhorn mr-2 text-blue-600"></i>
          알림장
        </h3>
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
            <button
              type="button"
              onClick={() => openLinkedPost(activeNotice)}
              disabled={!activeNotice.developerLogPostId}
              className={`relative aspect-[16/9] w-full flex-none overflow-hidden rounded-xl bg-gray-100 text-left focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                activeNotice.developerLogPostId
                  ? "cursor-pointer transition hover:ring-4 hover:ring-blue-100"
                  : "cursor-default"
              }`}
              aria-label={
                activeNotice.developerLogPostId
                  ? "연결된 개발자 일지 열기"
                  : "알림장 이미지"
              }
            >
              {activeNotice && (
                <img
                  key={`active-${activeNotice.id}`}
                  src={activeNotice.imageUrl}
                  alt="알림장"
                  loading="eager"
                  decoding="async"
                  className={`absolute inset-0 h-full w-full object-cover object-center will-change-transform ${
                    isSliding
                      ? slideDirection === 1
                        ? "-translate-x-full"
                        : "translate-x-full"
                      : "translate-x-0"
                  }`}
                  style={{
                    transition: incomingNotice
                      ? "transform 820ms cubic-bezier(0.22, 1, 0.36, 1)"
                      : "none",
                  }}
                />
              )}
              {incomingNotice && (
                <img
                  key={`incoming-${incomingNotice.id}`}
                  src={incomingNotice.imageUrl}
                  alt="알림장"
                  loading="eager"
                  decoding="async"
                  className={`absolute inset-0 h-full w-full object-cover object-center will-change-transform ${
                    isSliding
                      ? "translate-x-0"
                      : slideDirection === 1
                        ? "translate-x-full"
                        : "-translate-x-full"
                  }`}
                  style={{
                    transition:
                      "transform 820ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                  onTransitionEnd={(event) => {
                    if (event.target === event.currentTarget) {
                      finishSlide();
                    }
                  }}
                />
              )}
              <span className="absolute bottom-4 left-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                {getCategoryLabel(activeNotice.category)}
              </span>
              {activeNotice.developerLogPostId && (
                <span className="absolute bottom-4 right-4 rounded-full bg-slate-950/80 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                  게시물 보기
                </span>
              )}
            </button>

            {showCarousel && (
              <div className="relative mt-3 flex min-h-8 items-center justify-center">
                <div className="absolute left-0 top-1/2 inline-flex -translate-y-1/2 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => move(-1)}
                    className="inline-flex h-8 w-8 items-center justify-center text-blue-700 transition hover:bg-blue-50"
                    aria-label="이전 알림"
                  >
                    <i className="fas fa-chevron-left text-[10px]"></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPaused((prev) => !prev)}
                    className="inline-flex h-8 w-8 items-center justify-center border-x border-gray-200 text-blue-700 transition hover:bg-blue-50"
                    aria-label={
                      isPaused
                        ? "알림 자동 넘김 재생"
                        : "알림 자동 넘김 일시정지"
                    }
                    title={isPaused ? "재생" : "일시정지"}
                  >
                    <i
                      className={`fas ${isPaused ? "fa-play" : "fa-pause"} text-[10px]`}
                    ></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(1)}
                    className="inline-flex h-8 w-8 items-center justify-center text-blue-700 transition hover:bg-blue-50"
                    aria-label="다음 알림"
                  >
                    <i className="fas fa-chevron-right text-[10px]"></i>
                  </button>
                </div>

                <div className="flex items-center justify-center gap-1.5">
                  {notices.map((notice, index) => (
                    <button
                      key={`${notice.id}-dot`}
                      type="button"
                      onClick={() => selectNotice(index)}
                      className={`h-2.5 rounded-full transition ${
                        selectedIndex === index
                          ? "w-6 bg-blue-600"
                          : "w-2.5 bg-gray-200"
                      }`}
                      aria-label={`${index + 1}번째 알림 보기`}
                    />
                  ))}
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
