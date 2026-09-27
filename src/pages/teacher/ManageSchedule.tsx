import React, { useEffect, useMemo, useRef, useState } from "react";
import type FullCalendar from "@fullcalendar/react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { CalendarEvent } from "../../types";
import { getYearSemester } from "../../lib/semesterScope";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import { runWhenIdle } from "../../lib/browserTasks";
import {
  ensureKoreanPublicHolidaysSynced,
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import TeacherCalendarSection from "./components/TeacherCalendarSection";
import EventModal from "./components/EventModal";
import SearchModal from "../student/components/SearchModal";
import ScheduleEventDetailModal from "../../components/common/ScheduleEventDetailModal";
import { getKoreanDateKey } from "./components/teacherDashboardWeek";

const ManageSchedule = () => {
  const { config, configReady } = useAuth();
  const { year, semester } = getYearSemester(config);
  const scopeReady = Boolean(
    configReady &&
    config &&
    /^\d{4}$/.test(String(config.year)) &&
    ["1", "2"].includes(String(config.semester)),
  );
  const { categories } = useScheduleCategories();
  const calendarRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filterClass, setFilterClass] = useState("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<
    CalendarEvent | undefined
  >();
  const [modalInitialDate, setModalInitialDate] = useState("");
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    if (!scopeReady) {
      setEvents([]);
      setLoading(!configReady);
      setLoadError(false);
      return;
    }
    let active = true;
    let snapshotVersion = 0;
    setLoading(true);
    setLoadError(false);
    const path = `years/${year}/semesters/${semester}/calendar`;
    const unsubscribe = onSnapshot(
      collection(db, path),
      (snapshot) => {
        const version = ++snapshotVersion;
        const loadedEvents: CalendarEvent[] = [];
        snapshot.forEach((document) => {
          loadedEvents.push({
            id: document.id,
            ...document.data(),
          } as CalendarEvent);
        });
        if (!active) return;
        setEvents(loadedEvents);
        setLoading(false);
        void getKoreanPublicHolidays(year)
          .then((holidays) => {
            if (!active || version !== snapshotVersion) return;
            setEvents(
              mergeEventsWithKoreanPublicHolidays(loadedEvents, holidays),
            );
          })
          .catch((error) => {
            console.error("Failed to load Korean public holidays:", error);
          });
      },
      (error) => {
        console.error("Failed to load calendar events:", error);
        if (active) {
          setLoadError(true);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configReady, scopeReady, year, semester]);

  useEffect(() => {
    if (!scopeReady) return;
    return runWhenIdle(() => {
      void ensureKoreanPublicHolidaysSynced({ db, year, semester }).catch(
        (error) => {
          console.error("Failed to sync Korean public holidays:", error);
        },
      );
    }, 1200);
  }, [scopeReady, year, semester]);

  const availableClassTargets = useMemo(() => {
    const targets = new Set<string>();
    events.forEach((event) => {
      const targetClass = String(event.targetClass || "").trim();
      if (event.targetType === "class" && targetClass) targets.add(targetClass);
    });
    return [...targets].sort((left, right) =>
      left.localeCompare(right, "ko", { numeric: true }),
    );
  }, [events]);

  const effectiveFilterClass =
    filterClass === "all" ||
    filterClass === "common" ||
    availableClassTargets.includes(filterClass)
      ? filterClass
      : "all";

  useEffect(() => {
    if (filterClass !== effectiveFilterClass)
      setFilterClass(effectiveFilterClass);
  }, [filterClass, effectiveFilterClass]);

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        if (effectiveFilterClass === "all") return true;
        const isCommon =
          event.targetType === "common" || event.targetType === "all";
        if (isCommon || event.eventType === "holiday") return true;
        return (
          effectiveFilterClass !== "common" &&
          event.targetType === "class" &&
          String(event.targetClass || "").trim() === effectiveFilterClass
        );
      }),
    [events, effectiveFilterClass],
  );

  const handleAddEvent = (date?: string) => {
    setSelectedEvent(undefined);
    setModalInitialDate(date || selectedDate || getKoreanDateKey());
    setIsEventModalOpen(true);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedDate(event.start.split("T")[0]);
    setDetailEvent(event);
  };

  const handleEditEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setDetailEvent(null);
    setIsEventModalOpen(true);
  };

  const handleSelectSearchResult = (date: string) => {
    calendarRef.current?.getApi().gotoDate(date);
    setSelectedDate(date);
  };

  return (
    <div
      className="mx-auto w-full max-w-[1536px] px-4 py-4 md:px-6"
      data-patch-target="teacher-schedule"
      data-patch-label="학사 일정 관리"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-gray-900">학사 일정 관리</h1>
        {scopeReady && (
          <span className="text-sm text-gray-500">
            {year}학년도 {semester}학기
          </span>
        )}
      </div>
      {loading && (
        <p className="mb-3 text-sm text-gray-500" role="status">
          학사 일정을 불러오는 중입니다.
        </p>
      )}
      {loadError && (
        <p className="mb-3 text-sm text-red-700" role="alert">
          학사 일정을 불러오지 못했습니다. 화면을 새로고침해 주세요.
        </p>
      )}
      {configReady && !scopeReady && (
        <p className="mb-3 text-sm text-red-700" role="alert">
          현재 학기를 확인하지 못했습니다. 화면을 새로고침해 주세요.
        </p>
      )}
      {scopeReady && (
        <div style={{ height: "calc(100dvh - 176px)", minHeight: 600 }}>
          <TeacherCalendarSection
            events={visibleEvents}
            onDateClick={setSelectedDate}
            onDateDoubleClick={handleAddEvent}
            onEventClick={handleEventClick}
            onAddEvent={() => handleAddEvent()}
            onSearchClick={() => setIsSearchOpen(true)}
            calendarRef={calendarRef}
            filterClass={effectiveFilterClass}
            availableClassTargets={availableClassTargets}
            onFilterChange={setFilterClass}
            selectedDate={selectedDate}
          />
        </div>
      )}
      {isSearchOpen && (
        <SearchModal
          events={visibleEvents}
          categories={categories}
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onSelectEvent={handleSelectSearchResult}
        />
      )}
      {isEventModalOpen && (
        <EventModal
          isOpen={isEventModalOpen}
          onClose={() => setIsEventModalOpen(false)}
          eventData={selectedEvent}
          initialDate={modalInitialDate}
          onSave={() => {
            /* The calendar subscription receives the saved revision. */
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
    </div>
  );
};

export default ManageSchedule;
