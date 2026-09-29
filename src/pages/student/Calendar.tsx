import { getScheduleEventColor } from "../../lib/scheduleCategories";
import React, { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import { getSchedulePeriodRangeLabel } from "../../lib/schedulePeriods";
import { loadVisibleCalendarEvents } from "../../lib/visibleSchedule";
import StudentCalendarSection from "./components/StudentCalendarSection";
import type { CalendarEvent } from "../../types";
import { useAttendanceDates } from "./hooks/useAttendanceDates";

const Calendar = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [userClass, setUserClass] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<{
    year: string;
    semester: string;
  } | null>(null);
  const attendance = useAttendanceDates(user?.uid, currentConfig);
  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );

  const typeLabelMap: { [key: string]: string } = {
    exam: "정기 시험",
    performance: "수행평가",
    event: "행사",
    diagnosis: "진단평가",
    formative: "형성평가",
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configDoc = await getDoc(doc(db, "site_settings", "config"));
        if (configDoc.exists()) {
          setCurrentConfig(
            configDoc.data() as { year: string; semester: string },
          );
        }
      } catch (error) {
        console.error("Error fetching config:", error);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!user) return;
    const loadUserClass = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const d = userDoc.data();
          if (d.grade && d.class) {
            setUserClass(`${d.grade}-${d.class}`);
          }
        }
      } catch (error) {
        console.error("Error loading user class:", error);
      }
    };
    loadUserClass();
  }, [user]);

  useEffect(() => {
    if (!currentConfig || !userClass) return;

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
        setEvents(loadedEvents);
      } catch (e) {
        console.error("Error fetching events:", e);
      }
    };

    fetchEvents();
  }, [currentConfig, userClass]);

  const handleEventClick = (event: CalendarEvent) => {
    if (event.eventType === "holiday") return;
    setSelectedEvent(event);
    setModalOpen(true);
  };

  return (
    <div className="student-calendar-page mx-auto w-full max-w-[1536px] px-4 py-4 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-gray-900">학사 일정</h1>
        {currentConfig && (
          <span className="text-sm text-gray-500">
            {currentConfig.year}학년도 {currentConfig.semester}학기
          </span>
        )}
      </div>
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
          attendanceDates={attendance.dates}
          onEventClick={handleEventClick}
        />
      </div>

      {/* Detail Modal */}
      {modalOpen && selectedEvent && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4 relative transform transition-all scale-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <span
                className="px-2 py-1 rounded text-xs font-bold text-white inline-block mb-2"
                style={{
                  backgroundColor: getScheduleEventColor(selectedEvent),
                }}
              >
                {typeLabelMap[selectedEvent.eventType] || "일정"}
              </span>
              <h3 className="text-xl font-bold text-gray-900 leading-tight">
                {selectedEvent.title}
              </h3>
            </div>

            <div className="space-y-3 text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6">
              <div className="flex items-start gap-3">
                <i className="fas fa-clock mt-1 text-blue-500"></i>
                <div>
                  <p className="font-bold text-gray-800">기간</p>
                  <p>
                    {selectedEvent.start}{" "}
                    {selectedEvent.end &&
                    selectedEvent.end !== selectedEvent.start
                      ? `~ ${selectedEvent.end}`
                      : ""}
                    <span className="ml-2 font-bold text-blue-600">
                      {getSchedulePeriodRangeLabel(
                        selectedEvent.startPeriod ?? selectedEvent.period,
                        selectedEvent.endPeriod,
                      )}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <i className="fas fa-align-left mt-1 text-blue-500"></i>
                <div>
                  <p className="font-bold text-gray-800">상세 내용</p>
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {selectedEvent.description || "-"}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setModalOpen(false)}
              className="w-full bg-gray-800 text-white font-bold py-3 rounded-xl hover:bg-gray-900 transition"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
