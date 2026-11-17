import { getStudentMenuLabel } from "../../constants/menus";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import React, { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import { loadVisibleCalendarEvents } from "../../lib/visibleSchedule";
import StudentCalendarSection from "./components/StudentCalendarSection";
import ScheduleEventDetailModal from "../../components/common/ScheduleEventDetailModal";
import type { CalendarEvent } from "../../types";
import { useAttendanceDates } from "./hooks/useAttendanceDates";
import { LoadingOverlay } from "../../components/common/LoadingState";

const Calendar = () => {
  const { user, menuConfig } = useAuth();
  const { categories } = useScheduleCategories();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [userClass, setUserClass] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [classLoading, setClassLoading] = useState(true);
  const [loadedEventScope, setLoadedEventScope] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [currentConfig, setCurrentConfig] = useState<{
    year: string;
    semester: string;
  } | null>(null);
  const attendance = useAttendanceDates(user?.uid, currentConfig);
  const eventScope =
    currentConfig && userClass
      ? `${currentConfig.year}/${currentConfig.semester}/${userClass}`
      : "";
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setConfigLoading(true);
    setLoadError("");
    const fetchConfig = async () => {
      try {
        const configDoc = await getDoc(doc(db, "site_settings", "config"));
        if (!active) return;
        if (configDoc.exists()) {
          setCurrentConfig(
            configDoc.data() as { year: string; semester: string },
          );
        } else {
          setCurrentConfig(null);
          setLoadError("학기 정보를 확인하지 못했습니다. 다시 시도해 주세요.");
        }
      } catch (error) {
        console.error("Error fetching config:", error);
        if (active) {
          setCurrentConfig(null);
          setLoadError("학기 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
        }
      } finally {
        if (active) setConfigLoading(false);
      }
    };
    fetchConfig();
    return () => {
      active = false;
    };
  }, [retryVersion]);

  useEffect(() => {
    let active = true;
    setUserClass(null);
    if (!user) {
      setClassLoading(false);
      return;
    }
    setClassLoading(true);
    const loadUserClass = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!active) return;
        if (userDoc.exists()) {
          const d = userDoc.data();
          if (d.grade && d.class) {
            setUserClass(`${d.grade}-${d.class}`);
          } else {
            setLoadError(
              "학급 정보를 확인하지 못했습니다. 선생님께 문의해 주세요.",
            );
          }
        } else {
          setLoadError("학생 정보를 확인하지 못했습니다. 다시 시도해 주세요.");
        }
      } catch (error) {
        console.error("Error loading user class:", error);
        if (active)
          setLoadError("학급 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        if (active) setClassLoading(false);
      }
    };
    loadUserClass();
    return () => {
      active = false;
    };
  }, [user?.uid, retryVersion]);

  useEffect(() => {
    if (configLoading || classLoading || !currentConfig || !userClass) return;
    let active = true;
    setLoadedEventScope("");

    const fetchEvents = async () => {
      // Path: years/{year}/semesters/{semester}/calendar
      try {
        const visibleEvents = (await loadVisibleCalendarEvents(
          db,
          `years/${currentConfig.year}/semesters/${currentConfig.semester}/calendar`,
          userClass,
        )) as CalendarEvent[];
        const holidays = await getKoreanPublicHolidays(currentConfig.year);
        const loadedEvents = mergeEventsWithKoreanPublicHolidays(
          visibleEvents,
          holidays,
        );
        if (active) setEvents(loadedEvents);
      } catch (e) {
        console.error("Error fetching events:", e);
        if (active)
          setLoadError("일정을 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        if (active) setLoadedEventScope(eventScope);
      }
    };

    fetchEvents();
    return () => {
      active = false;
    };
  }, [currentConfig, userClass, configLoading, classLoading]);

  const handleEventClick = (event: CalendarEvent) => {
    if (event.eventType === "holiday") return;
    setSelectedEvent(event);
  };

  return (
    <div className="student-calendar-page ws-page">
      {(configLoading ||
        classLoading ||
        (!!eventScope && loadedEventScope !== eventScope) ||
        attendance.loading) && <LoadingOverlay />}
      <div className="ws-page-header mb-4">
        <h1 className="text-xl font-extrabold text-gray-900">
          {getStudentMenuLabel(menuConfig, "/student/calendar", "학사 일정")}
        </h1>
        {currentConfig && (
          <span className="text-sm text-gray-500">
            {currentConfig.year}학년도 {currentConfig.semester}학기
          </span>
        )}
      </div>
      {loadError && (
        <div className="student-calendar-attendance-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRetryVersion((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      )}
      {attendance.error && (
        <div className="student-calendar-attendance-error" role="status">
          <span>출석 기록을 불러오지 못했습니다.</span>
          <button type="button" onClick={attendance.retry}>
            다시 시도
          </button>
        </div>
      )}
      <div
        className="student-calendar-page__canvas"
        aria-busy={attendance.loading}
      >
        <StudentCalendarSection
          events={events}
          categories={categories}
          attendanceDates={attendance.dates}
          onEventClick={handleEventClick}
        />
      </div>

      <ScheduleEventDetailModal
        event={selectedEvent}
        categories={categories}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
};

export default Calendar;
