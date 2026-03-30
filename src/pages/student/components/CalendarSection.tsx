import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { getScheduleCategoryMeta } from "../../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../../lib/scheduleCategories";
import { CalendarEvent } from "../../../types";

const toExclusiveEnd = (start?: string, end?: string) => {
  if (!start || !end || end <= start) return undefined;
  const endDate = new Date(`${end}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const offset = endDate.getTimezoneOffset() * 60000;
  return new Date(endDate.getTime() - offset).toISOString().split("T")[0];
};

interface CalendarSectionProps {
  categories: ScheduleCategory[];
  events: CalendarEvent[];
  onDateClick: (dateStr: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSearchClick: () => void;
  onAttendanceCheck: () => void;
  calendarRef: React.RefObject<FullCalendar>;
  selectedDate?: string | null;
  attendanceLoading?: boolean;
  attendanceChecked?: boolean;
  attendanceMessage?: string;
  attendanceDates?: string[];
  attendanceGoalText?: string;
}

const CalendarSection: React.FC<CalendarSectionProps> = ({
  categories,
  events,
  onDateClick,
  onEventClick,
  onSearchClick,
  onAttendanceCheck,
  calendarRef,
  selectedDate,
  attendanceLoading = false,
  attendanceChecked = false,
  attendanceMessage = "",
  attendanceDates = [],
  attendanceGoalText = "",
}) => {
  const [currentViewType, setCurrentViewType] = useState<
    "dayGridMonth" | "listMonth"
  >("dayGridMonth");
  const [currentTitle, setCurrentTitle] = useState("");
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });

  const attendanceDateSet = useMemo(
    () => new Set(attendanceDates),
    [attendanceDates],
  );

  const attendanceStatusText = attendanceLoading
    ? "출석 처리 중"
    : /오류|실패/.test(attendanceMessage)
      ? "출석 처리 오류"
      : attendanceChecked
        ? "오늘 출석 완료"
        : "오늘 출석 가능";

  const attendanceStatusClassName = /오류|실패/.test(attendanceMessage)
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : attendanceChecked
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : attendanceLoading
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-gray-200 bg-white text-gray-600";

  const attendanceButtonLabel = attendanceChecked
    ? "오늘 출석 완료"
    : attendanceLoading
      ? "처리 중..."
      : "출석 체크";

  const formatEventTargetLabel = (event?: CalendarEvent) => {
    if (
      !event ||
      event.eventType === "holiday" ||
      event.targetType === "all" ||
      event.targetType === "common"
    ) {
      return "전체";
    }
    const [gradeValue, classValue] = String(event.targetClass || "").split("-");
    if (!gradeValue || !classValue) return "전체";
    return `${gradeValue}학년 ${classValue}반`;
  };

  const fcEvents = events.map((event) => {
    const meta = getScheduleCategoryMeta(event.eventType, categories);
    const isHoliday = event.eventType === "holiday";

    return {
      id: event.id,
      title: event.title,
      start: event.start,
      end: toExclusiveEnd(event.start, event.end),
      backgroundColor: isHoliday ? "#ef4444" : meta.color,
      borderColor: isHoliday ? "#ef4444" : meta.color,
      textColor: isHoliday ? "#ffffff" : undefined,
      classNames: isHoliday ? ["holiday-text-event"] : [],
      extendedProps: { ...event },
    };
  });

  const holidayDateSet = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      if (event.eventType === "holiday") {
        set.add(String(event.start).split("T")[0]);
      }
    });
    return set;
  }, [events]);

  const toLocalYmd = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split("T")[0];
  };

  const formatDayHeading = (dateText: string) => {
    const parsed = new Date(`${dateText}T00:00:00`);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(parsed);
  };

  const formatEventTitle = (event: CalendarEvent) => {
    const rawTitle = String(event.title || "").trim();
    if (rawTitle) return rawTitle;
    if (event.eventType === "holiday") return "공휴일";
    return getScheduleCategoryMeta(event.eventType, categories).label || "일정";
  };

  const listRows = useMemo(() => {
    if (
      currentViewType !== "listMonth" ||
      !visibleRange.start ||
      !visibleRange.end
    )
      return [];

    const filtered = events
      .filter((event) => {
        const dateKey = String(event.start).split("T")[0];
        return dateKey >= visibleRange.start && dateKey < visibleRange.end;
      })
      .sort((left, right) => {
        const leftDate = String(left.start).split("T")[0];
        const rightDate = String(right.start).split("T")[0];
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        return left.title.localeCompare(right.title);
      });

    const grouped = new Map<string, CalendarEvent[]>();
    filtered.forEach((event) => {
      const key = String(event.start).split("T")[0];
      const current = grouped.get(key) || [];
      current.push(event);
      grouped.set(key, current);
    });

    return Array.from(grouped.entries()).map(([date, dateEvents]) => ({
      date,
      events: dateEvents,
    }));
  }, [currentViewType, events, visibleRange.end, visibleRange.start]);

  const handleNavigate = (action: "prev" | "next" | "today") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (action === "prev") api.prev();
    if (action === "next") api.next();
    if (action === "today") api.today();
  };

  const handleViewChange = (viewType: "dayGridMonth" | "listMonth") => {
    const api = calendarRef.current?.getApi();
    if (!api || api.view.type === viewType) return;
    api.changeView(viewType);
  };

  return (
    <div className="student-calendar-section student-calendar-shell grid h-full min-h-[36rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 border-b border-gray-100 pb-3">
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-800">
                <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사
                일정
              </h2>
              <p className="mt-1 truncate text-sm font-semibold text-gray-500">
                {currentTitle || "이번 달 일정을 확인하세요."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="inline-flex items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => handleNavigate("prev")}
                  className="inline-flex h-10 w-10 items-center justify-center border-r border-gray-200 text-gray-600 transition hover:bg-gray-50 hover:text-blue-700"
                  aria-label="이전 달"
                >
                  <i className="fas fa-chevron-left text-xs"></i>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate("next")}
                  className="inline-flex h-10 w-10 items-center justify-center text-gray-600 transition hover:bg-gray-50 hover:text-blue-700"
                  aria-label="다음 달"
                >
                  <i className="fas fa-chevron-right text-xs"></i>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleNavigate("today")}
                className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                오늘
              </button>

              <div className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => handleViewChange("dayGridMonth")}
                  aria-pressed={currentViewType === "dayGridMonth"}
                  className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-bold transition ${
                    currentViewType === "dayGridMonth"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-gray-600 hover:text-blue-700"
                  }`}
                >
                  달력
                </button>
                <button
                  type="button"
                  onClick={() => handleViewChange("listMonth")}
                  aria-pressed={currentViewType === "listMonth"}
                  className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-bold transition ${
                    currentViewType === "listMonth"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-gray-600 hover:text-blue-700"
                  }`}
                >
                  목록
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onSearchClick}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              title="일정 검색"
            >
              <i className="fas fa-search text-xs"></i>
              일정 검색
            </button>

            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <span
                className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-bold ${attendanceStatusClassName}`}
                title={attendanceMessage || attendanceStatusText}
              >
                {attendanceStatusText}
              </span>
              {attendanceGoalText && (
                <span
                  className="inline-flex h-10 max-w-full items-center rounded-full border border-amber-200 bg-[#fff7d6] px-4 text-sm font-bold text-amber-800 sm:max-w-[240px]"
                  title={attendanceGoalText}
                >
                  <span className="truncate">{attendanceGoalText}</span>
                </span>
              )}
              <button
                type="button"
                onClick={onAttendanceCheck}
                disabled={attendanceLoading || attendanceChecked}
                title={attendanceMessage || "출석 체크"}
                className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-[0_12px_24px_rgba(245,158,11,0.22)] transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:border disabled:border-amber-300 disabled:bg-amber-100 disabled:text-amber-800 disabled:shadow-none"
              >
                {attendanceButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`calendar-wrapper student-calendar-shell__body relative flex-1 min-h-[420px] overflow-hidden md:min-h-0 ${currentViewType === "listMonth" ? "custom-list-active" : ""}`}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale="ko"
          allDayText=""
          displayEventTime={false}
          headerToolbar={false}
          events={fcEvents}
          datesSet={(arg) => {
            setCurrentViewType(arg.view.type as "dayGridMonth" | "listMonth");
            setCurrentTitle(arg.view.title);
            setVisibleRange({
              start: toLocalYmd(arg.start),
              end: toLocalYmd(arg.end),
            });
          }}
          dateClick={(arg) => onDateClick(arg.dateStr)}
          eventClick={(arg) =>
            onEventClick(arg.event.extendedProps as CalendarEvent)
          }
          dayCellContent={(arg) => {
            const dateStr = toLocalYmd(arg.date);
            const dayLabel = arg.dayNumberText.replace(/[^\d]/g, "");
            return (
              <div className="student-calendar-day-head">
                <span className="student-calendar-day-number">{dayLabel}</span>
                {attendanceDateSet.has(dateStr) && (
                  <span className="student-calendar-day-attendance">출석</span>
                )}
              </div>
            );
          }}
          eventContent={(arg) => {
            const event = arg.event.extendedProps as CalendarEvent;
            const isHoliday = event?.eventType === "holiday";
            const eventTitle = String(arg.event.title || "").trim();
            const meta = getScheduleCategoryMeta(event?.eventType, categories);
            const categoryLabel = isHoliday ? "공휴일" : meta.label;
            const categoryColor = isHoliday ? "#ef4444" : meta.color;
            const targetLabel = formatEventTargetLabel(event);
            const safeTitle = eventTitle || (isHoliday ? "공휴일" : "일정");

            if (arg.view.type === "listMonth") {
              return (
                <div
                  className="fc-list-row-grid"
                  title={`${categoryLabel} | ${safeTitle} | ${targetLabel}`}
                >
                  <div className="fc-list-category-cell">
                    <span
                      className="fc-list-category-dot"
                      style={{ backgroundColor: categoryColor }}
                    ></span>
                    <span className="fc-list-category-label">
                      {categoryLabel}
                    </span>
                  </div>
                  <div
                    className={`fc-list-title-cell ${isHoliday ? "holiday-segment-title" : ""}`}
                  >
                    {safeTitle}
                  </div>
                  <div className="fc-list-target-cell">{targetLabel}</div>
                </div>
              );
            }

            if (arg.view.type !== "dayGridMonth") return undefined;
            return (
              <div
                className={`student-calendar-event-chip ${isHoliday ? "holiday-segment-title" : ""}`}
                title={safeTitle}
              >
                {safeTitle}
              </div>
            );
          }}
          height="100%"
          contentHeight="100%"
          expandRows
          eventDisplay="block"
          dayMaxEvents={2}
          fixedWeekCount
          showNonCurrentDates={false}
          dayCellClassNames={(arg) => {
            const dateStr = toLocalYmd(arg.date);
            const classes: string[] = [];
            if (holidayDateSet.has(dateStr)) classes.push("fc-day-holiday");
            if (selectedDate === dateStr) classes.push("fc-day-selected");
            return classes;
          }}
        />

        {currentViewType === "listMonth" && (
          <div className="custom-schedule-list absolute inset-0 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            {listRows.map((group) => (
              <div key={group.date}>
                <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-lg font-extrabold text-gray-900 first:border-t-0">
                  {formatDayHeading(group.date)}
                </div>
                {group.events.map((event) => {
                  const isHoliday = event.eventType === "holiday";
                  const meta = getScheduleCategoryMeta(
                    event.eventType,
                    categories,
                  );
                  const categoryLabel = isHoliday ? "공휴일" : meta.label;
                  const categoryColor = isHoliday ? "#ef4444" : meta.color;
                  const eventTitle = formatEventTitle(event);
                  const targetLabel = formatEventTargetLabel(event);

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onEventClick(event)}
                      className="grid w-full cursor-pointer grid-cols-[170px_minmax(0,1fr)_116px] items-center gap-5 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-2 font-bold text-gray-700">
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: categoryColor }}
                        ></span>
                        <span className="truncate">{categoryLabel}</span>
                      </div>
                      <div
                        className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold ${
                          isHoliday ? "text-red-500" : "text-gray-900"
                        }`}
                        title={eventTitle}
                      >
                        {eventTitle}
                      </div>
                      <div
                        className="truncate text-sm font-semibold text-gray-600"
                        title={targetLabel}
                      >
                        {targetLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarSection;
