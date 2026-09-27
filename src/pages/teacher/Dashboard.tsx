import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { CalendarEvent } from "../../types";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import TeacherNoticeBoard from "./components/TeacherNoticeBoard";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import { getYearSemester } from "../../lib/semesterScope";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import { runWhenIdle } from "../../lib/browserTasks";
import { archiveScope, isSemesterArchive } from "../../lib/semesterArchive";
import TeacherWeekSchedule from "./components/TeacherWeekSchedule";
import {
  calendarDateKey,
  getKoreanDateKey,
  getWeekStart,
} from "./components/teacherDashboardWeek";
import "./teacherDashboard.css";
import {
  ensureKoreanPublicHolidaysSynced,
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";

const EventModal = lazyWithRetry(
  () => import("./components/EventModal"),
  "teacher-dashboard-event",
);
const ScheduleEventDetailModal = lazyWithRetry(
  () => import("../../components/common/ScheduleEventDetailModal"),
  "teacher-dashboard-event-detail",
);

const getVisibleCalendarEvents = (
  events: CalendarEvent[],
  filterClass: string,
) => {
  return events.filter((event) => {
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
};

const TeacherDashboard: React.FC = () => {
  const { config } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const initialDate =
    isSemesterArchive && archiveScope
      ? `${archiveScope.year}-${archiveScope.semester === "1" ? "03" : "08"}-01`
      : getKoreanDateKey();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate));

  // UI State
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>(
    undefined,
  );
  const [modalInitialDate, setModalInitialDate] = useState("");
  const [filterClass, setFilterClass] = useState("all");
  const { categories } = useScheduleCategories();

  // Fetch Events real-time
  useEffect(() => {
    const { year, semester } = getYearSemester(config);

    const path = `years/${year}/semesters/${semester}/calendar`;
    let active = true;
    setEventsLoading(true);
    setEventsError(false);
    const unsubscribe = onSnapshot(
      collection(db, path),
      (snapshot) => {
        const loadedEvents: CalendarEvent[] = [];

        snapshot.forEach((doc) => {
          const d = doc.data();
          loadedEvents.push({ id: doc.id, ...d } as CalendarEvent);
        });
        if (active) {
          setEvents(loadedEvents);
          setEventsLoading(false);
        }
        void getKoreanPublicHolidays(year)
          .then((holidays) => {
            if (!active) return;
            setEvents(
              mergeEventsWithKoreanPublicHolidays(loadedEvents, holidays),
            );
          })
          .catch((error) => {
            console.error("Failed to load Korean public holidays:", error);
            if (active) setEvents(loadedEvents);
          });
      },
      (error) => {
        console.error("Failed to load calendar events:", error);
        if (active) {
          setEventsError(true);
          setEventsLoading(false);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [config]);

  useEffect(() => {
    const { year, semester } = getYearSemester(config);
    return runWhenIdle(() => {
      void ensureKoreanPublicHolidaysSynced({ db, year, semester }).catch(
        (error) => {
          console.error("Failed to sync Korean public holidays:", error);
        },
      );
    }, 1200);
  }, [config]);

  const availableClassTargets = useMemo(() => {
    const targets = new Set<string>();
    events.forEach((event) => {
      if (event.targetType !== "class") return;
      const targetClass = String(event.targetClass || "").trim();
      if (!targetClass) return;
      targets.add(targetClass);
    });
    return Array.from(targets).sort((a, b) =>
      a.localeCompare(b, "ko", { numeric: true }),
    );
  }, [events]);

  const effectiveFilterClass = useMemo(() => {
    if (filterClass === "all" || filterClass === "common") return filterClass;
    return availableClassTargets.includes(filterClass) ? filterClass : "all";
  }, [availableClassTargets, filterClass]);

  useEffect(() => {
    if (filterClass === effectiveFilterClass) return;
    setFilterClass(effectiveFilterClass);
  }, [effectiveFilterClass, filterClass]);

  const visibleEvents = useMemo(
    () => getVisibleCalendarEvents(events, effectiveFilterClass),
    [effectiveFilterClass, events],
  );

  const handleDateClick = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedDate(calendarDateKey(event.start));
    setDetailEvent(event);
  };

  const handleEditEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setDetailEvent(null);
    setIsEventModalOpen(true);
  };

  const handleAddEvent = (dateStr?: string) => {
    setSelectedEvent(undefined);
    setModalInitialDate(dateStr || selectedDate || getKoreanDateKey());
    setIsEventModalOpen(true);
  };

  const handleSelectSearchResults = (dateStr: string) => {
    const date = calendarDateKey(dateStr);
    if (!date) return;
    setWeekStart(getWeekStart(date));
    handleDateClick(date);
  };

  const handleNoticeManagerOpened = () => {
    if (searchParams.get("notice") === "manage") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("notice");
      setSearchParams(nextParams, { replace: true });
    }
  };

  return (
    <div
      className="teacher-weekly-dashboard"
      data-patch-target="teacher-dashboard"
      data-patch-label="교사 대시보드"
    >
      <div className="teacher-weekly-dashboard__semester">
        {config && (
          <h1 className="inline-flex shrink-0 rounded-full bg-blue-600 px-4 py-2 text-base font-bold text-white">
            {config.year}학년도 {config.semester}학기
          </h1>
        )}
      </div>

      <div
        className="teacher-weekly-dashboard__grid"
        data-patch-target="teacher-dashboard-grid"
        data-patch-label="대시보드 주요 영역"
      >
        <div
          className="teacher-weekly-dashboard__schedule"
          data-patch-target="teacher-dashboard-calendar"
          data-patch-label="대시보드 학사 일정"
        >
          <TeacherWeekSchedule
            events={visibleEvents}
            categories={categories}
            weekStart={weekStart}
            selectedDate={selectedDate}
            loading={eventsLoading}
            error={eventsError}
            onWeekChange={setWeekStart}
            onDateClick={handleDateClick}
            onDateDoubleClick={handleAddEvent}
            onEventClick={handleEventClick}
            onSearchSelect={handleSelectSearchResults}
            onAddEvent={() => handleAddEvent()}
            filterClass={effectiveFilterClass}
            availableClassTargets={availableClassTargets}
            onFilterChange={setFilterClass}
          />
        </div>
        <div
          className="teacher-weekly-dashboard__notice"
          data-patch-target="teacher-dashboard-notice"
          data-patch-label="대시보드 알림장"
        >
          <TeacherNoticeBoard
            openManager={searchParams.get("notice") === "manage"}
            onManagerOpened={handleNoticeManagerOpened}
          />
        </div>
        <div
          className="teacher-weekly-dashboard__ranking"
          data-patch-target="teacher-dashboard-ranking"
          data-patch-label="대시보드 위스 순위"
        >
          <WisRankingPanel
            config={config}
            hallOfFamePath="/teacher/points?tab=hall-of-fame"
          />
        </div>
      </div>

      <React.Suspense
        fallback={
          <div className="teacher-dashboard-dialog-loading" role="status">
            창을 여는 중입니다.
          </div>
        }
      >
        {isEventModalOpen && (
          <EventModal
            isOpen={isEventModalOpen}
            onClose={() => setIsEventModalOpen(false)}
            eventData={selectedEvent}
            initialDate={modalInitialDate}
            onSave={() => {
              /* Real-time updates handle refresh */
            }}
          />
        )}

        {detailEvent && (
          <ScheduleEventDetailModal
            event={detailEvent}
            categories={categories}
            onClose={() => setDetailEvent(null)}
            onEdit={handleEditEvent}
          />
        )}
      </React.Suspense>
    </div>
  );
};

export default TeacherDashboard;
