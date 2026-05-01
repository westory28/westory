import React, { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import {
  compareSchedulePeriod,
  getSchedulePeriodLabel,
  getSchedulePeriodOrder,
} from "../../lib/schedulePeriods";
import { loadVisibleCalendarEvents } from "../../lib/visibleSchedule";

interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string YYYY-MM-DD
  end?: string;
  startPeriod?: string;
  endPeriod?: string;
  period?: string;
  eventType:
    | "exam"
    | "performance"
    | "event"
    | "diagnosis"
    | "formative"
    | "holiday";
  targetType: "common" | "class";
  targetClass?: string;
  description?: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  classNames?: string[];
}

const toDateKey = (value?: string) =>
  String(value || "")
    .split("T")[0]
    .trim();

const getInclusiveSpanDays = (start?: string, end?: string) => {
  const startDateKey = toDateKey(start);
  if (!startDateKey) return 1;
  const endDateKey = toDateKey(end);
  const resolvedEndDateKey =
    endDateKey && endDateKey > startDateKey ? endDateKey : startDateKey;
  const startDate = new Date(`${startDateKey}T00:00:00`);
  const endDate = new Date(`${resolvedEndDateKey}T00:00:00`);
  const diffDays = Math.round(
    (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  return diffDays + 1;
};

const Calendar = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [userClass, setUserClass] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<{
    year: string;
    semester: string;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );

  const colorMap: { [key: string]: string } = {
    exam: "#ef4444", // Red
    performance: "#f97316", // Orange
    event: "#10b981", // Green
    diagnosis: "#3b82f6", // Blue
    formative: "#3b82f6", // Blue
  };

  const typeLabelMap: { [key: string]: string } = {
    exam: "정기 시험",
    performance: "수행평가",
    event: "행사",
    diagnosis: "진단평가",
    formative: "형성평가",
  };

  const toLocalYmd = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split("T")[0];
  };

  const toExclusiveEnd = (start?: string, end?: string) => {
    if (!start || !end || end <= start) return undefined;
    const endDate = new Date(`${end}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    return toLocalYmd(endDate);
  };

  const holidayDateSet = useMemo(() => {
    const set = new Set<string>();
    events.forEach((eventItem: any) => {
      const date = String(eventItem.start || "").split("T")[0];
      const title = String(eventItem.title || "");
      const isHolidayEvent =
        eventItem.classNames?.includes("holiday-text-event") ||
        eventItem.extendedProps?.eventType === "holiday" ||
        /공휴일|대체공휴일/.test(title);

      if (date && isHolidayEvent) {
        set.add(date);
      }
    });
    return set;
  }, [events]);

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
        ).map((event) => {
          const isHoliday = event.eventType === "holiday";
          const inclusiveSpanDays = getInclusiveSpanDays(
            event.start,
            event.end,
          );
          const isMultiDayRange = inclusiveSpanDays > 1;

          return {
            id: event.id,
            title: event.title,
            start: event.start,
            end: toExclusiveEnd(event.start, event.end),
            backgroundColor: isHoliday
              ? "#ef4444"
              : colorMap[event.eventType] || "#6b7280",
            borderColor: isHoliday
              ? "#ef4444"
              : colorMap[event.eventType] || "#6b7280",
            textColor: isHoliday ? "#ffffff" : undefined,
            classNames: [
              ...(isHoliday ? ["holiday-text-event"] : []),
              ...(isMultiDayRange
                ? ["student-calendar-page-range-event"]
                : ["student-calendar-page-single-event"]),
            ],
            extendedProps: {
              ...event,
              inclusiveSpanDays,
              isMultiDayRange,
              periodOrder: getSchedulePeriodOrder(
                event.startPeriod ?? event.period,
              ),
            },
          };
        });
        setEvents(loadedEvents);
      } catch (e) {
        console.error("Error fetching events:", e);
      }
    };

    fetchEvents();
  }, [currentConfig, userClass]);

  const handleEventClick = (info: any) => {
    const props = info.event.extendedProps as CalendarEvent & {
      inclusiveSpanDays?: number;
      isMultiDayRange?: boolean;
    };
    if (props.eventType === "holiday") return; // Skip holidays
    setSelectedEvent(props);
    setModalOpen(true);
  };

  const handleDateClick = (arg: any) => {
    setSelectedDate(arg.dateStr);
  };

  return (
    <div className="bg-gray-50 flex flex-col min-h-screen">
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 h-full flex flex-col">
        <div className="mb-4 shrink-0">
          <h1 className="text-2xl font-bold text-gray-800">
            <i className="fas fa-calendar-check text-green-500 mr-2"></i>학사
            일정
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            우리 반의 주요 일정과 평가 계획을 확인하세요.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 md:p-6 flex flex-col relative min-h-[600px]">
          <div className="flex items-center gap-4 mb-4 text-xs font-bold text-gray-500 justify-end">
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-red-500 mr-1"></span>정기
              시험
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-orange-500 mr-1"></span>
              수행평가
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-blue-500 mr-1"></span>
              진단/형성
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-green-500 mr-1"></span>
              행사
            </div>
          </div>

          <div className="flex-1 calendar-wrapper">
            <FullCalendar
              plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
              initialView="dayGridMonth"
              locale="ko"
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,listMonth",
              }}
              events={events}
              eventOrder={(left, right) =>
                compareSchedulePeriod(
                  left.extendedProps as CalendarEvent,
                  right.extendedProps as CalendarEvent,
                )
              }
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventDidMount={(arg) => {
                const event = arg.event.extendedProps as CalendarEvent & {
                  inclusiveSpanDays?: number;
                  isMultiDayRange?: boolean;
                };
                const isRangeEvent =
                  typeof event.inclusiveSpanDays === "number"
                    ? event.inclusiveSpanDays > 1
                    : Boolean(event.isMultiDayRange);
                const harness = arg.el.closest(
                  ".fc-daygrid-event-harness, .fc-daygrid-event-harness-abs",
                );
                if (!harness) return;
                harness.classList.toggle(
                  "student-calendar-page-event-harness--range",
                  isRangeEvent,
                );
                harness.classList.toggle(
                  "student-calendar-page-event-harness--single",
                  !isRangeEvent,
                );
              }}
              eventContent={(arg) => {
                if (arg.view.type !== "dayGridMonth") return undefined;
                return (
                  <div className="fc-segment-title" title={arg.event.title}>
                    {arg.event.title}
                  </div>
                );
              }}
              height="auto" // Allow it to grow
              dayCellClassNames={(arg) => {
                const dateStr = toLocalYmd(arg.date);
                const classes: string[] = [];
                if (holidayDateSet.has(dateStr)) classes.push("fc-day-holiday");
                if (selectedDate === dateStr) classes.push("fc-day-selected");
                return classes;
              }}
            />
          </div>
        </div>
      </main>

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
                  backgroundColor:
                    colorMap[selectedEvent.eventType] || "#6b7280",
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
                      {getSchedulePeriodLabel(
                        selectedEvent.startPeriod ?? selectedEvent.period,
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

      <style>{`
                .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
                .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
                .fc-daygrid-event { cursor: pointer; border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; font-weight: 600; border: none; }
                .fc-daygrid-event-harness.student-calendar-page-event-harness--single,
                .fc-daygrid-event-harness-abs.student-calendar-page-event-harness--single {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 0 !important;
                    overflow: hidden !important;
                }
                .fc-daygrid-event-harness-abs.student-calendar-page-event-harness--single {
                    left: 0 !important;
                    right: 0 !important;
                    inset-inline: 0 !important;
                }
                .fc-daygrid-event-harness.student-calendar-page-event-harness--range,
                .fc-daygrid-event-harness-abs.student-calendar-page-event-harness--range {
                    width: auto !important;
                    min-width: 0 !important;
                    max-width: none !important;
                    overflow: visible !important;
                }
                .fc-daygrid-event.student-calendar-page-single-event,
                .fc-daygrid-event.student-calendar-page-single-event .fc-event-main,
                .fc-daygrid-event.student-calendar-page-single-event .fc-event-main-frame,
                .fc-daygrid-event.student-calendar-page-single-event .fc-event-title-container {
                    min-width: 0;
                    width: 100%;
                    max-width: 100%;
                    overflow: hidden;
                }
                .fc-daygrid-event.student-calendar-page-range-event,
                .fc-daygrid-event.student-calendar-page-range-event .fc-event-main,
                .fc-daygrid-event.student-calendar-page-range-event .fc-event-main-frame,
                .fc-daygrid-event.student-calendar-page-range-event .fc-event-title-container {
                    min-width: 0;
                    width: 100%;
                    max-width: 100%;
                    overflow: visible;
                }
                .fc-daygrid-event.student-calendar-page-range-event {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: 100% !important;
                    overflow: visible !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    border-radius: 0 !important;
                    position: relative;
                    z-index: 2;
                }
                .fc-daygrid-event.student-calendar-page-range-event.fc-event-start {
                    border-top-left-radius: 4px !important;
                    border-bottom-left-radius: 4px !important;
                }
                .fc-daygrid-event.student-calendar-page-range-event.fc-event-end {
                    border-top-right-radius: 4px !important;
                    border-bottom-right-radius: 4px !important;
                }
                .fc-daygrid-event.student-calendar-page-range-event.fc-event-start.fc-event-end {
                    border-radius: 4px !important;
                }
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday .fc-daygrid-day-number { color: #ef4444 !important; font-weight: 700 !important; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
                .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
                .fc-daygrid-event.holiday-text-event .fc-segment-title { color: #ffffff !important; font-size: 0.75rem; font-weight: 800; }
                .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
                .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
            `}</style>
    </div>
  );
};

export default Calendar;
