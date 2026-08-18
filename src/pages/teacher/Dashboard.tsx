import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type FullCalendar from "@fullcalendar/react";
import { useNavigate } from "react-router-dom";
import { InlineLoading } from "../../components/common/LoadingState";
import ScheduleEventDetailModal from "../../components/common/ScheduleEventDetailModal";
import StatePanel from "../../components/common/StatePanel";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import { useAuth } from "../../contexts/AuthContext";
import { runAfterNextPaint } from "../../lib/browserTasks";
import { db } from "../../lib/firebase";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { canManageW8Domains, canReadPoints } from "../../lib/permissions";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import { getYearSemester } from "../../lib/semesterScope";
import {
  subscribeVisibleNotices,
  type VisibleNotice,
} from "../../lib/visibleSchedule";
import {
  W8DomainError,
  getW8DomainState,
  toW8LocalDateTimeInput,
  toW8StatePanelState,
  type W8ScheduleEvent,
} from "../../lib/w8Domains";
import type { CalendarEvent, SystemConfig } from "../../types";

const TeacherCalendarSection = lazyWithRetry(
  () => import("./components/TeacherCalendarSection"),
  "teacher-calendar-section",
);

const getVisibleCalendarEvents = (
  events: CalendarEvent[],
  filterClass: string,
) =>
  events.filter((event) => {
    const isCommon =
      event.targetType === "common" || event.targetType === "all";
    const isHoliday = event.eventType === "holiday";
    const targetClass = String(event.targetClass || "").trim();
    if (filterClass === "all") return true;
    if (filterClass === "common") return isCommon || isHoliday;
    return (
      isCommon ||
      isHoliday ||
      (event.targetType === "class" && targetClass === filterClass)
    );
  });

const legacyEventTypeFromW8 = (event: W8ScheduleEvent) => {
  const sourceMatch = event.sourceReference.match(
    /^legacy-calendar:(exam|performance|event|diagnosis|formative):/u,
  );
  if (sourceMatch) return sourceMatch[1];
  if (event.eventType === "HOLIDAY") return "holiday";
  if (event.eventType === "ASSESSMENT") return "performance";
  if (event.eventType === "LEARNING_DEADLINE") return "formative";
  return "event";
};

const toLegacyDate = (value: string) =>
  toW8LocalDateTimeInput(value).split("T")[0] || value.split("T")[0] || "";

const w8ClassIdForLegacyClass = async (
  semesterId: string,
  legacyClass: string,
) => {
  const [grade, classNumber] = legacyClass.split("-");
  if (!grade || !classNumber || !globalThis.crypto?.subtle) return legacyClass;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${semesterId}\n${grade.normalize("NFKC").toLowerCase()}::${classNumber
        .normalize("NFKC")
        .toLowerCase()}`,
    ),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `class_${hash.slice(0, 32)}`;
};

const buildLegacyClassByW8Id = async (semesterId: string) => {
  const legacyClasses = Array.from({ length: 3 }, (_, gradeIndex) =>
    Array.from(
      { length: 12 },
      (_, classIndex) => `${gradeIndex + 1}-${classIndex + 1}`,
    ),
  ).flat();
  const pairs = await Promise.all(
    legacyClasses.map(
      async (legacyClass) =>
        [
          await w8ClassIdForLegacyClass(semesterId, legacyClass),
          legacyClass,
        ] as const,
    ),
  );
  return new Map(pairs);
};

const projectScheduleEvent = (
  event: W8ScheduleEvent,
  legacyClassByW8Id: Map<string, string>,
): CalendarEvent => ({
  id: event.eventId,
  title: event.title,
  description: event.description,
  start: toLegacyDate(event.startAt),
  end: toLegacyDate(event.endAt),
  period: event.period,
  eventType: legacyEventTypeFromW8(event),
  targetType: event.classIds.length ? "class" : "common",
  targetClass: event.classIds.length
    ? legacyClassByW8Id.get(event.classIds[0]) || event.classIds[0]
    : undefined,
});

const getCategoryLabel = (category?: string) => {
  if (category === "event") return "학교 행사";
  if (category === "exam") return "정기 시험";
  if (category === "performance") return "수행평가";
  if (category === "prep") return "준비";
  if (category === "dday") return "D-Day";
  return "공지";
};

const ReadOnlyTeacherNoticeBoard: React.FC<{
  config: SystemConfig | null;
  canManage: boolean;
  onOpenCommunication: () => void;
}> = ({ config, canManage, onOpenCommunication }) => {
  const [notices, setNotices] = useState<VisibleNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const { year, semester } = getYearSemester(config);
    const path = `years/${year}/semesters/${semester}/notices`;
    setLoading(true);
    return subscribeVisibleNotices(
      db,
      path,
      undefined,
      (loadedNotices) => {
        setNotices(loadedNotices.filter((notice) => Boolean(notice.imageUrl)));
        setLoading(false);
      },
      (noticeError) => {
        console.error("Notice fetch error:", noticeError);
        setLoading(false);
      },
    );
  }, [config]);

  useEffect(() => {
    setActiveIndex(0);
    setIsPaused(false);
  }, [notices.length]);

  const activeNotice = notices[activeIndex] || notices[0] || null;
  const showCarousel = notices.length > 1;
  const activeImageRatio = useMemo(() => {
    if (!activeNotice?.imageWidth || !activeNotice?.imageHeight)
      return "16 / 9";
    return `${activeNotice.imageWidth} / ${activeNotice.imageHeight}`;
  }, [activeNotice]);
  const move = useCallback(
    (direction: -1 | 1) => {
      setActiveIndex((current) => {
        if (notices.length <= 1) return 0;
        return (current + direction + notices.length) % notices.length;
      });
    },
    [notices.length],
  );

  useEffect(() => {
    if (!showCarousel || isPaused) return undefined;
    const timerId = window.setInterval(() => move(1), 5000);
    return () => window.clearInterval(timerId);
  }, [isPaused, move, showCarousel]);

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

        {!loading &&
          !activeNotice &&
          (canManage ? (
            <button
              type="button"
              onClick={onOpenCommunication}
              className="flex h-full min-h-[180px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/40 text-sm font-bold text-blue-700"
            >
              <i className="far fa-image mb-2 text-3xl"></i>
              알림장 이미지를 등록해 주세요.
            </button>
          ) : (
            <div className="flex h-full min-h-[180px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
              등록된 알림 이미지가 없습니다.
            </div>
          ))}

        {!loading && activeNotice && (
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl">
              <button
                type="button"
                onClick={canManage ? onOpenCommunication : undefined}
                disabled={!canManage}
                className="group block h-full w-full text-left"
                title={canManage ? "알림장 이미지 수정" : "알림장 이미지"}
              >
                <div
                  className="flex h-full min-h-[180px] w-full transition-transform duration-500 ease-out will-change-transform motion-reduce:transition-none"
                  style={{
                    aspectRatio: activeImageRatio,
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
                      className="h-full min-h-[180px] w-full shrink-0 object-contain transition-transform duration-500 group-hover:scale-[1.01]"
                    />
                  ))}
                </div>
              </button>
              <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                {getCategoryLabel(activeNotice.category)}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
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
                    onClick={() => setIsPaused((current) => !current)}
                    className="inline-flex h-9 w-9 items-center justify-center border-x border-gray-200 text-blue-700 transition hover:bg-blue-50"
                    aria-label={
                      isPaused
                        ? "알림 자동 넘김 재생"
                        : "알림 자동 넘김 일시정지"
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

              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={onOpenCommunication}
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
                      onClick={onOpenCommunication}
                      disabled={notices.length <= 1}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <i className="fas fa-list-ol mr-1"></i>
                      순서
                    </button>
                    <button
                      type="button"
                      onClick={onOpenCommunication}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                    >
                      <i className="fas fa-plus mr-1"></i>
                      쓰기
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TeacherDashboard: React.FC = () => {
  const { config, configReady, currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [filterClass, setFilterClass] = useState("all");
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const calendarRef = useRef<FullCalendar>(null);
  const { categories } = useScheduleCategories();
  const canManageDomains =
    canManageW8Domains(userData, currentUser?.email) && !readOnly;
  const canOpenPoints = canReadPoints(userData, currentUser?.email);

  useEffect(() => {
    const cancel = runAfterNextPaint(() => setSecondaryPanelsReady(true));
    return cancel;
  }, []);

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      const nextState = await getW8DomainState({
        config,
        domain: "DASHBOARD",
        audience: "teacher",
        source: "CURRENT",
      });
      const legacyClassByW8Id = await buildLegacyClassByW8Id(
        nextState.semesterId,
      );
      const projectedEvents = nextState.scheduleEvents
        .filter((event) => event.status === "ACTIVE")
        .map((event) => projectScheduleEvent(event, legacyClassByW8Id));
      const year = nextState.semesterId.split("-")[0] || config?.year || "";
      try {
        const holidays = await getKoreanPublicHolidays(year);
        setEvents(
          mergeEventsWithKoreanPublicHolidays(projectedEvents, holidays),
        );
      } catch (holidayError) {
        console.error("Failed to load Korean public holidays:", holidayError);
        setEvents(projectedEvents);
      }
      setReadOnly(nextState.readOnly);
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError(
              "UNKNOWN",
              "교사 업무 요약을 불러오지 못했습니다.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableClassTargets = useMemo(() => {
    const targets = new Set<string>();
    events.forEach((event) => {
      if (event.targetType !== "class") return;
      const targetClass = String(event.targetClass || "").trim();
      if (targetClass) targets.add(targetClass);
    });
    return Array.from(targets).sort((left, right) =>
      left.localeCompare(right, "ko", { numeric: true }),
    );
  }, [events]);
  const effectiveFilterClass = useMemo(() => {
    if (filterClass === "all" || filterClass === "common") return filterClass;
    return availableClassTargets.includes(filterClass) ? filterClass : "all";
  }, [availableClassTargets, filterClass]);

  useEffect(() => {
    if (filterClass !== effectiveFilterClass) {
      setFilterClass(effectiveFilterClass);
    }
  }, [effectiveFilterClass, filterClass]);

  const visibleEvents = useMemo(
    () => getVisibleCalendarEvents(events, effectiveFilterClass),
    [effectiveFilterClass, events],
  );
  const handleDateClick = (dateStr: string) => setSelectedDate(dateStr);
  const openSchedule = () => {
    if (canManageDomains) navigate("/teacher/schedule");
  };
  const handleEventClick = (event: CalendarEvent) => {
    setSelectedDate(event.start);
    setDetailEvent(event);
  };
  const handleEditEvent = () => {
    setDetailEvent(null);
    openSchedule();
  };

  if (loading) return <StatePanel state="LOADING" />;
  if (error) {
    return (
      <StatePanel
        state={toW8StatePanelState(error)}
        description={error.message}
        action={{ label: "다시 불러오기", onClick: () => void load() }}
        retryable
      />
    );
  }

  return (
    <div
      className="dashboard-container teacher-dashboard-container w-full max-w-7xl mx-auto px-4 py-6 flex-1"
      data-patch-target="teacher-dashboard"
      data-patch-label="교사 대시보드"
    >
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">
            대시보드
          </h1>
          {config && (
            <span className="bg-blue-600 text-white font-bold px-3 py-1 rounded-full text-xs md:text-sm shadow-md shrink-0">
              {config.year}학년도 {config.semester}학기
            </span>
          )}
        </div>
      </div>

      <div
        className="teacher-dashboard-grid flex flex-col md:grid md:grid-cols-5 md:grid-rows-2 gap-4 h-auto md:h-[calc(100vh-140px)] min-h-[500px]"
        data-patch-target="teacher-dashboard-grid"
        data-patch-label="대시보드 주요 영역"
      >
        <div
          className="teacher-dashboard-notice order-1 md:order-2 md:col-span-2 md:row-span-1"
          data-patch-target="teacher-dashboard-notice"
          data-patch-label="대시보드 알림장"
        >
          {secondaryPanelsReady ? (
            <ReadOnlyTeacherNoticeBoard
              config={config}
              canManage={canManageDomains}
              onOpenCommunication={() => navigate("/teacher/communication")}
            />
          ) : (
            <div className="rounded-xl border border-yellow-200 bg-[#fffbeb] p-4 text-sm font-semibold text-amber-800/70">
              알림장을 준비 중입니다.
            </div>
          )}
        </div>

        <div
          className="teacher-dashboard-calendar order-2 md:order-1 md:col-span-3 md:row-span-2"
          data-patch-target="teacher-dashboard-calendar"
          data-patch-label="대시보드 학사 일정"
        >
          {!canManageDomains && (
            <style>{`
              .teacher-dashboard-calendar .student-calendar-shell__action-button,
              .teacher-dashboard-calendar .student-calendar-shell__search-button { display: none !important; }
            `}</style>
          )}
          <React.Suspense
            fallback={
              <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-500 shadow-sm">
                학사 일정을 준비하는 중입니다.
              </div>
            }
          >
            <TeacherCalendarSection
              events={visibleEvents}
              onDateClick={handleDateClick}
              onDateDoubleClick={
                canManageDomains ? openSchedule : handleDateClick
              }
              onEventClick={handleEventClick}
              onAddEvent={openSchedule}
              onSearchClick={openSchedule}
              calendarRef={calendarRef}
              filterClass={effectiveFilterClass}
              availableClassTargets={availableClassTargets}
              onFilterChange={setFilterClass}
              selectedDate={selectedDate}
            />
          </React.Suspense>
        </div>

        <div
          className="teacher-dashboard-ranking order-3 md:order-3 md:col-span-2 md:row-span-1"
          data-patch-target="teacher-dashboard-ranking"
          data-patch-label="대시보드 위스 순위"
        >
          <div className="min-h-[260px] h-full">
            {secondaryPanelsReady ? (
              <WisRankingPanel
                config={config}
                hallOfFamePath={
                  canOpenPoints ? "/teacher/points?tab=hall-of-fame" : undefined
                }
              />
            ) : (
              <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl border border-blue-100 bg-white p-4 text-sm font-semibold text-blue-700/70 shadow-sm">
                위스 순위를 준비 중입니다.
              </div>
            )}
          </div>
        </div>
      </div>

      <ScheduleEventDetailModal
        event={detailEvent}
        categories={categories}
        onClose={() => setDetailEvent(null)}
        onEdit={canManageDomains ? handleEditEvent : undefined}
      />
    </div>
  );
};

export default TeacherDashboard;
