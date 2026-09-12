import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type FullCalendar from "@fullcalendar/react";
import {
  InlineLoading,
  PageDataLoading,
} from "../../components/common/LoadingState";
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
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../lib/semesterScope";
import {
  loadVisibleNotices,
  type VisibleNotice,
} from "../../lib/visibleSchedule";
import {
  W8DomainError,
  getW8DomainState,
  toW8LocalDateTimeInput,
  toW8StatePanelState,
  type W8ScheduleEvent,
  type W8DomainState,
} from "../../lib/w8Domains";
import type { CalendarEvent, SystemConfig } from "../../types";
import TeacherCalendarEventModal from "./components/TeacherCalendarEventModal";
import SearchModal from "../student/components/SearchModal";
import { getArchiveEnrollmentState } from "../../lib/archiveEnrollment";
import {
  buildScheduleClassOptions,
  projectScheduleTargets,
  type ScheduleClassOption,
} from "../../lib/scheduleClassTargets";

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
      (event.targetType === "class" &&
        (event.targetClassIds || [targetClass]).includes(filterClass))
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

const projectScheduleEvent = (
  event: W8ScheduleEvent,
  classes: ScheduleClassOption[],
): CalendarEvent => ({
  id: event.eventId,
  title: event.title,
  description: event.description,
  start: toLegacyDate(event.startAt),
  end: toLegacyDate(event.endAt),
  period: event.period,
  eventType: legacyEventTypeFromW8(event),
  ...projectScheduleTargets(event.classIds, event.targetUserIds, classes),
});

// The dashboard image carousel is independent of the retired notice-board editor.
// It performs one scoped read and never blocks the calendar or ranking queries.
const TeacherDashboardBanner: React.FC<{ config: SystemConfig | null }> = ({
  config,
}) => {
  const [images, setImages] = useState<VisibleNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const { year, semester } = getYearSemester(config);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setImages([]);
    setActiveIndex(0);
    void loadVisibleNotices(db, getSemesterCollectionPath(config, "notices"))
      .then((notices) => {
        if (active)
          setImages(notices.filter((notice) => Boolean(notice.imageUrl)));
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [year, semester]);

  useEffect(() => {
    if (paused || images.length < 2) return;
    const timer = window.setInterval(
      () => setActiveIndex((index) => (index + 1) % images.length),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [images.length, paused]);

  const image = images[activeIndex];
  return (
    <section
      className="teacher-dashboard-banner rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      aria-label="학교 배너"
    >
      <h2 className="mb-3 text-lg font-extrabold text-gray-900">학교 배너</h2>
      <div className="teacher-dashboard-banner__image">
        {loading ? (
          <InlineLoading message="배너를 불러오는 중입니다." />
        ) : image ? (
          <img
            src={image.imageUrl}
            alt={image.content || "학교 안내 배너"}
            decoding="async"
          />
        ) : (
          <p className="text-sm text-gray-500">
            {failed
              ? "배너를 불러오지 못했습니다."
              : "등록된 배너 이미지가 없습니다."}
          </p>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-gray-200 text-blue-700"
            aria-label="이전 배너"
            onClick={() =>
              setActiveIndex(
                (index) => (index + images.length - 1) % images.length,
              )
            }
          >
            ‹
          </button>
          <span className="text-sm text-gray-600">
            {activeIndex + 1} / {images.length}
          </span>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-gray-200 px-3 text-blue-700"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "자동 넘김 재생" : "자동 넘김 정지"}
          </button>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border border-gray-200 text-blue-700"
            aria-label="다음 배너"
            onClick={() =>
              setActiveIndex((index) => (index + 1) % images.length)
            }
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
};

const TeacherDashboard: React.FC = () => {
  const { config, configReady, currentUser, userData } = useAuth();
  const [domainState, setDomainState] = useState<W8DomainState | null>(null);
  const [holidays, setHolidays] = useState<
    Awaited<ReturnType<typeof getKoreanPublicHolidays>>
  >([]);
  const [editor, setEditor] = useState<{
    event: W8ScheduleEvent | null;
    date: string;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [classesError, setClassesError] = useState("");
  const [classesReady, setClassesReady] = useState(false);
  const loadSequence = useRef(0);
  const [scheduleClasses, setScheduleClasses] = useState<ScheduleClassOption[]>(
    [],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [filterClass, setFilterClass] = useState("all");
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);

  const calendarRef = useRef<FullCalendar>(null);
  const { categories } = useScheduleCategories();
  const canManageDomains =
    canManageW8Domains(userData, currentUser?.email) &&
    Boolean(domainState && !domainState.readOnly && classesReady && !loading);
  const canOpenPoints = canReadPoints(userData, currentUser?.email);

  useEffect(() => {
    const cancel = runAfterNextPaint(() => setSecondaryPanelsReady(true));
    return cancel;
  }, []);

  const { year, semester } = getYearSemester(config);
  useEffect(() => {
    let active = true;
    setHolidays([]);
    if (configReady) {
      void getKoreanPublicHolidays(String(year)).then(
        (nextHolidays) => {
          if (active) setHolidays(nextHolidays);
        },
        () => {
          /* School schedules remain available when the holiday source is unavailable. */
        },
      );
    }
    return () => {
      active = false;
    };
  }, [configReady, year]);

  const load = useCallback(async () => {
    if (!configReady) return;
    const sequence = ++loadSequence.current;
    const isCurrent = () => sequence === loadSequence.current;
    setLoading(true);
    setError(null);
    setClassesReady(false);
    setClassesError("");
    const scheduleRequest = getW8DomainState({
      config,
      domain: "SCHEDULE",
      audience: "teacher",
      source: "CURRENT",
    });
    const classRequest = getArchiveEnrollmentState({
      source: "CURRENT",
      callSite: "TeacherDashboard.scheduleClasses",
    });
    await Promise.allSettled([
      scheduleRequest.then(
        (nextState) => {
          if (!isCurrent()) return;
          setDomainState(nextState);
          setLoading(false);
        },
        (caught) => {
          if (!isCurrent()) return;
          setError(
            caught instanceof W8DomainError
              ? caught
              : new W8DomainError(
                  "UNKNOWN",
                  "학사 일정을 불러오지 못했습니다.",
                ),
          );
          setLoading(false);
        },
      ),
      Promise.all([scheduleRequest, classRequest])
        .then(([nextState, enrollmentState]) => {
          if (!isCurrent()) return;
          if (enrollmentState.semesterId !== nextState.semesterId)
            throw new Error("학기가 바뀌었습니다. 일정을 다시 불러와 주세요.");
          setScheduleClasses(
            buildScheduleClassOptions(
              nextState.semesterId,
              enrollmentState.classes,
            ),
          );
          setClassesReady(true);
        })
        .catch(() => {
          if (isCurrent())
            setClassesError(
              "학급 정보를 확인하지 못했습니다. 다시 불러온 뒤 일정을 수정해 주세요.",
            );
        }),
    ]);
  }, [configReady, year, semester]);

  useEffect(() => {
    setDomainState(null);
    setEditor(null);
    setDetailEvent(null);
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  const events = useMemo(
    () =>
      mergeEventsWithKoreanPublicHolidays(
        (domainState?.scheduleEvents || [])
          .filter((event) => event.status === "ACTIVE")
          .map((event) => projectScheduleEvent(event, scheduleClasses)),
        holidays,
      ),
    [domainState, scheduleClasses, holidays],
  );

  const availableClassTargets = useMemo(() => {
    const targets = new Set<string>();
    events.forEach((event) => {
      if (event.targetType !== "class") return;
      (event.targetClassIds || [event.targetClass || ""]).forEach((id) => {
        if (id) targets.add(id);
      });
    });
    return Array.from(targets).sort((left, right) =>
      left.localeCompare(right, "ko", { numeric: true }),
    );
  }, [events]);
  const classTargetLabels = useMemo(
    () =>
      Object.fromEntries(
        scheduleClasses.map((item) => [item.value, item.label]),
      ),
    [scheduleClasses],
  );
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
  const openSchedule = (
    date = selectedDate || new Date().toLocaleDateString("sv-SE"),
  ) => {
    if (canManageDomains) setEditor({ event: null, date });
  };
  const handleEventClick = (event: CalendarEvent) => {
    setSelectedDate(event.start);
    setDetailEvent(event);
  };
  const editableEvent =
    detailEvent &&
    domainState?.scheduleEvents.find(
      (event) =>
        event.eventId === detailEvent.id && event.sourceDomain === "USER",
    );
  const editEvent = (event: CalendarEvent) => {
    const original = domainState?.scheduleEvents.find(
      (item) => item.eventId === event.id,
    );
    if (!canManageDomains || !original || original.sourceDomain !== "USER")
      return;
    setDetailEvent(null);
    setEditor({ event: original, date: event.start });
  };

  return (
    <div
      className="dashboard-container teacher-dashboard-container w-full max-w-7xl mx-auto px-4 py-6 flex-1"
      data-patch-target="teacher-dashboard"
      data-patch-label="교사 대시보드"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="rounded-full bg-blue-600 px-4 py-1 text-xl font-extrabold text-white shadow-sm">
          {year}학년도 {semester}학기
        </h1>
      </div>

      <div
        className="teacher-dashboard-grid"
        data-patch-target="teacher-dashboard-grid"
        data-patch-label="교사 첫 화면 주요 영역"
      >
        <div
          className="teacher-dashboard-calendar min-w-0"
          data-patch-target="teacher-dashboard-calendar"
          data-patch-label="대시보드 학사 일정"
        >
          {error && (
            <StatePanel
              state={toW8StatePanelState(error)}
              description={error.message}
              action={{ label: "다시 불러오기", onClick: () => void load() }}
              retryable
            />
          )}
          {classesError && !error && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p>{classesError}</p>
              <button
                type="button"
                className="min-h-11 px-3 font-bold underline"
                onClick={() => void load()}
              >
                다시 불러오기
              </button>
            </div>
          )}
          {loading && !domainState && <PageDataLoading />}
          {loading && domainState && (
            <InlineLoading
              message="자료를 불러오는 중입니다."
              className="mb-3"
            />
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
              onEventDoubleClick={canManageDomains ? editEvent : undefined}
              onEventClick={handleEventClick}
              onAddEvent={canManageDomains ? () => openSchedule() : undefined}
              onSearchClick={() => setSearchOpen(true)}
              calendarRef={calendarRef}
              filterClass={effectiveFilterClass}
              availableClassTargets={availableClassTargets}
              classTargetLabels={classTargetLabels}
              onFilterChange={setFilterClass}
              selectedDate={selectedDate}
            />
          </React.Suspense>
        </div>

        <div className="teacher-dashboard-side">
          {configReady && (
            <TeacherDashboardBanner
              key={`${year}:${semester}`}
              config={config}
            />
          )}
          <div
            className="teacher-dashboard-ranking min-w-0"
            data-patch-target="teacher-dashboard-ranking"
            data-patch-label="대시보드 위스 순위"
          >
            <div className="teacher-dashboard-ranking-content">
              {secondaryPanelsReady ? (
                <WisRankingPanel
                  config={config}
                  hallOfFamePath={
                    canOpenPoints
                      ? "/teacher/points?tab=hall-of-fame"
                      : undefined
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
      </div>

      {editor && domainState && (
        <TeacherCalendarEventModal
          key={`${domainState.semesterId}:${editor.event?.eventId || editor.date}`}
          state={domainState}
          event={editor.event}
          initialDate={editor.date}
          classes={scheduleClasses}
          onClose={() => {
            setEditor(null);
            void load();
          }}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
      <SearchModal
        categories={categories}
        events={visibleEvents}
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectEvent={(date) => {
          setSearchOpen(false);
          setSelectedDate(date);
          calendarRef.current?.getApi().gotoDate(date);
        }}
      />
      <ScheduleEventDetailModal
        event={detailEvent}
        categories={categories}
        onClose={() => setDetailEvent(null)}
        onEdit={
          canManageDomains && editableEvent && detailEvent
            ? () => editEvent(detailEvent)
            : undefined
        }
      />
    </div>
  );
};

export default TeacherDashboard;
