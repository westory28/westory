import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { getScheduleCategoryMeta } from "../../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../../lib/scheduleCategories";
import type { CalendarEvent } from "../../../types";

type CalendarViewType = "dayGridMonth" | "listMonth";

const LABELS = {
  all: "\uc804\uccb4",
  attendance: "\ucd9c\uc11d",
  attendanceAction: "\ucd9c\uc11d \uccb4\ud06c",
  attendanceDone: "\ucd9c\uc11d \uc644\ub8cc",
  attendanceDoneTitle: "\uc624\ub298 \ucd9c\uc11d \uc644\ub8cc",
  attendanceError: "\ucd9c\uc11d \ud655\uc778 \ud544\uc694",
  attendanceLoading: "\ucc98\ub9ac \uc911...",
  calendar: "\ub2ec\ub825",
  heading: "\ud559\uc0ac \uc77c\uc815",
  holiday: "\uacf5\ud734\uc77c",
  list: "\ubaa9\ub85d",
  nextMonth: "\ub2e4\uc74c \ub2ec",
  previousMonth: "\uc774\uc804 \ub2ec",
  search: "\uc77c\uc815 \uac80\uc0c9",
  schedule: "\uc77c\uc815",
  today: "\uc624\ub298",
} as const;

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

const ChevronLeftIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    width="16"
    height="16"
  >
    <path
      d="M12.5 4.5 7 10l5.5 5.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ChevronRightIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    width="16"
    height="16"
  >
    <path
      d="m7.5 4.5 5.5 5.5-5.5 5.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    width="16"
    height="16"
  >
    <circle
      cx="8.5"
      cy="8.5"
      r="4.75"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="m12 12 4 4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

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
}) => {
  const [currentViewType, setCurrentViewType] =
    useState<CalendarViewType>("dayGridMonth");
  const [currentTitle, setCurrentTitle] = useState("");
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });

  const attendanceDateSet = useMemo(
    () => new Set(attendanceDates),
    [attendanceDates],
  );
  const attendanceHasError = /\uc624\ub958|\uc2e4\ud328/.test(
    attendanceMessage,
  );
  const isMonthView = currentViewType === "dayGridMonth";

  const attendanceButtonLabel = attendanceLoading
    ? LABELS.attendanceLoading
    : attendanceHasError
      ? LABELS.attendanceError
      : LABELS.attendanceAction;

  const formatEventTargetLabel = (event?: CalendarEvent) => {
    if (
      !event ||
      event.eventType === "holiday" ||
      event.targetType === "all" ||
      event.targetType === "common"
    ) {
      return LABELS.all;
    }

    const [gradeValue, classValue] = String(event.targetClass || "").split("-");
    if (!gradeValue || !classValue) return LABELS.all;
    return `${gradeValue}\ud559\ub144 ${classValue}\ubc18`;
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
    if (event.eventType === "holiday") return LABELS.holiday;
    return (
      getScheduleCategoryMeta(event.eventType, categories).label ||
      LABELS.schedule
    );
  };

  const listRows = useMemo(() => {
    if (
      currentViewType !== "listMonth" ||
      !visibleRange.start ||
      !visibleRange.end
    ) {
      return [];
    }

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

  const handleViewChange = (viewType: CalendarViewType) => {
    const api = calendarRef.current?.getApi();
    if (!api || api.view.type === viewType) return;
    api.changeView(viewType);
  };

  const renderDayCellHeader = (date: Date, dayNumberText: string) => {
    const dateStr = toLocalYmd(date);
    const dayLabel = dayNumberText.replace(/[^\d]/g, "");

    return (
      <span className="student-calendar-day-head">
        <span className="student-calendar-day-label">{dayLabel}</span>
        {attendanceDateSet.has(dateStr) && (
          <span className="student-calendar-day-badge">
            {LABELS.attendance}
          </span>
        )}
      </span>
    );
  };

  return (
    <div
      className={`student-calendar-section student-calendar-shell ${
        isMonthView ? "student-calendar-shell--month" : ""
      }`}
    >
      <div className="student-calendar-shell__header">
        <div className="student-calendar-shell__header-row">
          <div className="student-calendar-shell__header-copy">
            <span className="student-calendar-shell__eyebrow">
              {LABELS.heading}
            </span>
          </div>

          <div className="student-calendar-shell__titlebar">
            <button
              type="button"
              onClick={() => handleNavigate("prev")}
              className="student-calendar-shell__nav-button"
              aria-label={LABELS.previousMonth}
              title={LABELS.previousMonth}
            >
              <ChevronLeftIcon />
            </button>

            <div className="student-calendar-shell__month-label">
              <h2 className="student-calendar-shell__month-title">
                {currentTitle || LABELS.heading}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => handleNavigate("next")}
              className="student-calendar-shell__nav-button"
              aria-label={LABELS.nextMonth}
              title={LABELS.nextMonth}
            >
              <ChevronRightIcon />
            </button>
          </div>

          <div className="student-calendar-shell__controls">
            <button
              type="button"
              onClick={() => handleNavigate("today")}
              className="student-calendar-shell__control-button"
            >
              {LABELS.today}
            </button>

            <div className="student-calendar-shell__view-toggle">
              <button
                type="button"
                onClick={() => handleViewChange("dayGridMonth")}
                aria-pressed={isMonthView}
                className={`student-calendar-shell__view-button ${
                  isMonthView ? "is-active" : ""
                }`}
              >
                {LABELS.calendar}
              </button>
              <button
                type="button"
                onClick={() => handleViewChange("listMonth")}
                aria-pressed={currentViewType === "listMonth"}
                className={`student-calendar-shell__view-button ${
                  currentViewType === "listMonth" ? "is-active" : ""
                }`}
              >
                {LABELS.list}
              </button>
            </div>

            <button
              type="button"
              onClick={onSearchClick}
              className="student-calendar-shell__icon-button"
              title={LABELS.search}
              aria-label={LABELS.search}
            >
              <SearchIcon />
            </button>

            {attendanceChecked ? (
              <span
                className="student-calendar-shell__attendance-indicator"
                title={attendanceMessage || LABELS.attendanceDoneTitle}
              >
                {LABELS.attendanceDone}
              </span>
            ) : (
              <button
                type="button"
                onClick={onAttendanceCheck}
                disabled={attendanceLoading}
                title={attendanceMessage || LABELS.attendanceAction}
                data-tone={
                  attendanceHasError
                    ? "error"
                    : attendanceLoading
                      ? "loading"
                      : "default"
                }
                className="student-calendar-shell__attendance-action"
              >
                {attendanceButtonLabel}
              </button>
            )}
          </div>
        </div>

        {attendanceHasError && (
          <p className="student-calendar-shell__error-message">
            {attendanceMessage}
          </p>
        )}
      </div>

      <div
        className={`calendar-wrapper student-calendar-shell__body ${
          currentViewType === "listMonth" ? "custom-list-active" : ""
        }`}
        data-calendar-view={currentViewType}
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
            setCurrentViewType(arg.view.type as CalendarViewType);
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
          dayCellContent={(arg) =>
            renderDayCellHeader(arg.date, arg.dayNumberText)
          }
          eventContent={(arg) => {
            const event = arg.event.extendedProps as CalendarEvent;
            const isHoliday = event?.eventType === "holiday";
            const eventTitle = String(arg.event.title || "").trim();
            const meta = getScheduleCategoryMeta(event?.eventType, categories);
            const categoryLabel = isHoliday ? LABELS.holiday : meta.label;
            const categoryColor = isHoliday ? "#ef4444" : meta.color;
            const targetLabel = formatEventTargetLabel(event);
            const safeTitle =
              eventTitle || (isHoliday ? LABELS.holiday : LABELS.schedule);

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
                    className={`fc-list-title-cell ${
                      isHoliday ? "holiday-segment-title" : ""
                    }`}
                  >
                    {safeTitle}
                  </div>
                  <div className="fc-list-target-cell">{targetLabel}</div>
                </div>
              );
            }

            if (!isMonthView) return undefined;

            return (
              <div
                className={`student-calendar-event-chip ${
                  isHoliday ? "holiday-segment-title" : ""
                }`}
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
                  const categoryLabel = isHoliday ? LABELS.holiday : meta.label;
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
