import React, { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  compareCalendarSchedule,
  compareSchedulePeriod,
  getSchedulePeriodOrder,
} from "../../../lib/schedulePeriods";
import {
  getScheduleCategoryMeta,
  useScheduleCategories,
} from "../../../lib/scheduleCategories";
import { CalendarEvent } from "../../../types";

interface TeacherCalendarSectionProps {
  events: CalendarEvent[];
  onDateClick: (dateStr: string) => void;
  onDateDoubleClick: (dateStr: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onAddEvent: () => void;
  onSearchClick: () => void;
  calendarRef: React.RefObject<FullCalendar>;
  filterClass: string;
  availableClassTargets: string[];
  onFilterChange: (cls: string) => void;
  selectedDate?: string | null;
}

type SchoolOption = { value: string; label: string };
type CalendarViewType = "dayGridMonth" | "listMonth";

const toExclusiveEnd = (start?: string, end?: string) => {
  if (!start || !end || end <= start) return undefined;
  const endDate = new Date(`${end}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const offset = endDate.getTimezoneOffset() * 60000;
  return new Date(endDate.getTime() - offset).toISOString().split("T")[0];
};

const getInclusiveSpanDays = (start?: string, end?: string) => {
  const startDateKey = String(start || "").split("T")[0];
  if (!startDateKey) return 1;
  const endDateKey = String(end || "").split("T")[0];
  const resolvedEndDateKey =
    endDateKey && endDateKey > startDateKey ? endDateKey : startDateKey;
  const startDate = new Date(`${startDateKey}T00:00:00`);
  const endDate = new Date(`${resolvedEndDateKey}T00:00:00`);
  const diffDays = Math.round(
    (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  return diffDays + 1;
};

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

const CalendarBadgeIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    width="16"
    height="16"
  >
    <rect
      x="3"
      y="4.5"
      width="14"
      height="12.5"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      d="M6.5 3v3M13.5 3v3M3 8.25h14"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

const TeacherCalendarSection: React.FC<TeacherCalendarSectionProps> = ({
  events,
  onDateClick,
  onDateDoubleClick,
  onEventClick,
  onAddEvent,
  onSearchClick,
  calendarRef,
  filterClass,
  availableClassTargets,
  onFilterChange,
  selectedDate,
}) => {
  const { categories } = useScheduleCategories();
  const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>([
    { value: "1", label: "1학년" },
    { value: "2", label: "2학년" },
    { value: "3", label: "3학년" },
  ]);
  const [classOptions, setClassOptions] = useState<SchoolOption[]>(
    Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1}반`,
    })),
  );
  const [currentViewType, setCurrentViewType] =
    useState<CalendarViewType>("dayGridMonth");
  const [currentTitle, setCurrentTitle] = useState("");
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });
  const isMonthView = currentViewType === "dayGridMonth";

  const fcEvents = events
    .filter(
      (event) =>
        currentViewType !== "dayGridMonth" || event.eventType !== "holiday",
    )
    .map((event) => {
      const meta = getScheduleCategoryMeta(event.eventType, categories);
      const isHoliday = event.eventType === "holiday";
      const inclusiveSpanDays = getInclusiveSpanDays(event.start, event.end);
      const isMultiDayRange = inclusiveSpanDays > 1;
      return {
        id: event.id,
        title: event.title,
        start: event.start,
        end: toExclusiveEnd(event.start, event.end),
        backgroundColor: isHoliday ? "#ef4444" : meta.color,
        borderColor: isHoliday ? "#ef4444" : meta.color,
        textColor: isHoliday ? "#ffffff" : undefined,
        classNames: [
          ...(isHoliday ? ["holiday-text-event"] : []),
          ...(isMultiDayRange
            ? ["student-calendar-range-event"]
            : ["student-calendar-single-event"]),
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

  const holidayDateSet = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      if (event.eventType === "holiday") set.add(event.start);
    });
    return set;
  }, [events]);

  const holidayLabelByDate = useMemo(() => {
    const map = new Map<string, string>();
    events.forEach((event) => {
      if (event.eventType !== "holiday") return;
      const dateKey = String(event.start || "").split("T")[0];
      const title = String(event.title || "공휴일").trim();
      if (!dateKey || !title) return;
      const current = map.get(dateKey);
      map.set(dateKey, current ? `${current} · ${title}` : title);
    });
    return map;
  }, [events]);

  useEffect(() => {
    const loadSchoolConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "site_settings", "school_config"));
        if (!snap.exists()) return;
        const data = snap.data() as {
          grades?: Array<{ value?: string; label?: string }>;
          classes?: Array<{ value?: string; label?: string }>;
        };
        const nextGrades = (data.grades || [])
          .map((g) => ({
            value: String(g?.value ?? "").trim(),
            label: String(g?.label ?? "").trim(),
          }))
          .filter((g) => g.value && g.label);
        const nextClasses = (data.classes || [])
          .map((c) => ({
            value: String(c?.value ?? "").trim(),
            label: String(c?.label ?? "").trim(),
          }))
          .filter((c) => c.value && c.label);
        if (nextGrades.length > 0) setGradeOptions(nextGrades);
        if (nextClasses.length > 0) setClassOptions(nextClasses);
      } catch (error) {
        console.error("Failed to load school config:", error);
      }
    };
    void loadSchoolConfig();
  }, []);

  const classTargets = useMemo(() => {
    return availableClassTargets.map((value) => {
      const [gradeValue, classValue] = value.split("-");
      const gradeLabel =
        gradeOptions.find((item) => item.value === gradeValue)?.label ||
        (gradeValue ? `${gradeValue}학년` : "");
      const classLabel =
        classOptions.find((item) => item.value === classValue)?.label ||
        (classValue ? `${classValue}반` : "");
      return {
        value,
        label: `${gradeLabel} ${classLabel}`.trim() || value,
      };
    });
  }, [availableClassTargets, classOptions, gradeOptions]);

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
    const gradeLabel =
      gradeOptions.find((item) => item.value === gradeValue)?.label ||
      (gradeValue ? `${gradeValue}학년` : "");
    const classLabel =
      classOptions.find((item) => item.value === classValue)?.label ||
      (classValue ? `${classValue}반` : "");
    return `${gradeLabel} ${classLabel}`.trim() || "전체";
  };

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
      .filter(
        (event) =>
          event.start >= visibleRange.start && event.start < visibleRange.end,
      )
      .sort(compareCalendarSchedule);

    const grouped = new Map<string, CalendarEvent[]>();
    filtered.forEach((event) => {
      const key = event.start;
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
    const holidayLabel = holidayLabelByDate.get(dateStr);
    return (
      <span className="student-calendar-day-head">
        <span className="student-calendar-day-label">{dayLabel}</span>
        {holidayLabel && (
          <span
            className="student-calendar-day-holiday-label"
            title={holidayLabel}
          >
            {holidayLabel}
          </span>
        )}
      </span>
    );
  };

  return (
    <div
      className={`student-calendar-section student-calendar-shell teacher-calendar-shell ${isMonthView ? "student-calendar-shell--month" : ""}`}
    >
      <div className="student-calendar-shell__header">
        <div className="student-calendar-shell__header-main">
          <div className="student-calendar-shell__heading-group">
            <span className="student-calendar-shell__eyebrow">
              <span className="student-calendar-shell__eyebrow-icon">
                <CalendarBadgeIcon />
              </span>
              학사 일정
            </span>

            <div className="student-calendar-shell__month-row">
              <div className="student-calendar-shell__month-badge">
                <button
                  type="button"
                  onClick={() => handleNavigate("prev")}
                  className="student-calendar-shell__nav-button student-calendar-shell__nav-button--month"
                  aria-label="이전 달"
                  title="이전 달"
                >
                  <ChevronLeftIcon />
                </button>

                <div className="student-calendar-shell__month-label">
                  <h2 className="student-calendar-shell__month-title">
                    {currentTitle || "학사 일정"}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => handleNavigate("next")}
                  className="student-calendar-shell__nav-button student-calendar-shell__nav-button--month"
                  aria-label="다음 달"
                  title="다음 달"
                >
                  <ChevronRightIcon />
                </button>
              </div>
            </div>
          </div>

          <div className="student-calendar-shell__toolbar">
            <div className="student-calendar-shell__calendar-tools">
              <div className="student-calendar-shell__control-cluster">
                <button
                  type="button"
                  onClick={() => handleNavigate("today")}
                  className="student-calendar-shell__control-button"
                >
                  오늘
                </button>
              </div>

              <div className="student-calendar-shell__control-cluster student-calendar-shell__control-cluster--view">
                <div className="student-calendar-shell__view-toggle">
                  <button
                    type="button"
                    onClick={() => handleViewChange("dayGridMonth")}
                    aria-pressed={isMonthView}
                    className={`student-calendar-shell__view-button ${isMonthView ? "is-active" : ""}`}
                  >
                    달력
                  </button>
                  <button
                    type="button"
                    onClick={() => handleViewChange("listMonth")}
                    aria-pressed={currentViewType === "listMonth"}
                    className={`student-calendar-shell__view-button ${currentViewType === "listMonth" ? "is-active" : ""}`}
                  >
                    목록
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onSearchClick}
                  className="student-calendar-shell__search-button"
                  title="일정 검색"
                  aria-label="일정 검색"
                >
                  <SearchIcon />
                  <span>검색</span>
                </button>
              </div>

              <select
                value={filterClass}
                onChange={(e) => onFilterChange(e.target.value)}
                className="student-calendar-shell__filter-select"
                aria-label="일정 대상 필터"
              >
                <option value="all">전체</option>
                <option value="common">공통</option>
                {classTargets.map((target) => (
                  <option key={target.value} value={target.value}>
                    {target.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="student-calendar-shell__calendar-tools">
              <button
                type="button"
                onClick={onAddEvent}
                className="student-calendar-shell__control-button student-calendar-shell__action-button"
              >
                <i className="fas fa-plus mr-1"></i>
                추가
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`calendar-wrapper student-calendar-shell__body ${currentViewType === "listMonth" ? "custom-list-active" : ""}`}
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
          eventOrder={(left, right) =>
            compareSchedulePeriod(
              left.extendedProps as CalendarEvent,
              right.extendedProps as CalendarEvent,
            )
          }
          datesSet={(arg) => {
            setCurrentViewType(arg.view.type as CalendarViewType);
            setCurrentTitle(arg.view.title);
            setVisibleRange({
              start: toLocalYmd(arg.start),
              end: toLocalYmd(arg.end),
            });
          }}
          dateClick={(arg) => onDateClick(arg.dateStr)}
          dayCellDidMount={(arg) => {
            arg.el.ondblclick = () => {
              const dateStr = toLocalYmd(arg.date);
              onDateClick(dateStr);
              onDateDoubleClick(dateStr);
            };
          }}
          eventClick={(arg) =>
            onEventClick(arg.event.extendedProps as CalendarEvent)
          }
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
              "student-calendar-event-harness--range",
              isRangeEvent,
            );
            harness.classList.toggle(
              "student-calendar-event-harness--single",
              !isRangeEvent,
            );

            if (isRangeEvent) return;

            const harnessElement = harness as HTMLElement;
            const eventElement = arg.el as HTMLElement;
            harnessElement.style.setProperty("left", "0px");
            harnessElement.style.setProperty("right", "0px");
            harnessElement.style.setProperty("inset-inline", "0px");
            harnessElement.style.setProperty("width", "100%");
            harnessElement.style.setProperty("max-width", "100%");
            harnessElement.style.setProperty("min-width", "0px");
            harnessElement.style.setProperty("overflow", "hidden");
            eventElement.style.setProperty("width", "100%");
            eventElement.style.setProperty("max-width", "100%");
            eventElement.style.setProperty("min-width", "0px");
            eventElement.style.setProperty("overflow", "hidden");
          }}
          dayCellContent={(arg) =>
            renderDayCellHeader(arg.date, arg.dayNumberText)
          }
          eventContent={(arg) => {
            const event = arg.event.extendedProps as CalendarEvent & {
              inclusiveSpanDays?: number;
              isMultiDayRange?: boolean;
            };
            const isHoliday = event?.eventType === "holiday";
            const meta = getScheduleCategoryMeta(event?.eventType, categories);
            const safeTitle =
              String(arg.event.title || "").trim() ||
              (isHoliday ? "공휴일" : "일정");
            const categoryLabel = isHoliday ? "공휴일" : meta.label;
            const categoryColor = isHoliday ? "#ef4444" : meta.color;
            const targetLabel = formatEventTargetLabel(event);

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
            const isRangeEvent =
              typeof event.inclusiveSpanDays === "number"
                ? event.inclusiveSpanDays > 1
                : Boolean(event.isMultiDayRange);
            const eventLabelClassName = [
              "student-calendar-event-label",
              isRangeEvent
                ? "student-calendar-event-label--range"
                : "student-calendar-event-label--single",
              "fc-segment-title",
              isHoliday ? "is-holiday" : "",
              isRangeEvent ? "is-range" : "",
              !isRangeEvent ? "is-single" : "",
              arg.isStart ? "is-start" : "",
              arg.isEnd ? "is-end" : "",
              !arg.isStart && !arg.isEnd ? "is-middle" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div className={eventLabelClassName} title={safeTitle}>
                <span className="student-calendar-event-label__text">
                  {safeTitle}
                </span>
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

      <style>{`
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
                .fc-daygrid-event.holiday-text-event .fc-event-title { color: #ffffff !important; font-weight: 800 !important; }
                .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
                .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
                .fc-list table,
                .fc-list-table {
                    table-layout: fixed !important;
                    width: 100% !important;
                }
                .fc-list-event-graphic,
                .fc-list-event-time,
                .fc-list-event-dot {
                    display: none !important;
                    width: 0 !important;
                    padding: 0 !important;
                }
                .fc-list-day-cushion {
                    display: flex !important;
                    justify-content: flex-start !important;
                    align-items: center;
                    gap: 12px;
                }
                .fc-list-day-text,
                .fc-list-day-side-text {
                    float: none !important;
                }
                .fc-list-event td {
                    text-align: left !important;
                }
                .fc-list-event-title {
                    width: 100% !important;
                    padding: 0 !important;
                    text-align: left !important;
                }
                .fc-list-event-title > a,
                .fc-list-event-title .fc-event-main {
                    display: block !important;
                    width: 100% !important;
                    text-align: left !important;
                }
                .fc-list-row-grid {
                    display: grid !important;
                    grid-template-columns: 140px minmax(0, 1fr) 92px;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    min-width: 0;
                }
                .fc-list-category-cell,
                .fc-list-title-cell,
                .fc-list-target-cell {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .fc-list-category-cell {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 700;
                    color: #374151;
                }
                .fc-list-category-dot {
                    display: inline-block;
                    width: 14px;
                    height: 14px;
                    border-radius: 9999px;
                    flex: 0 0 auto;
                }
                .fc-list-category-label {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .fc-list-title-cell {
                    font-weight: 700;
                    color: #111827;
                }
                .fc-list-target-cell {
                    font-size: 0.86rem;
                    font-weight: 600;
                    color: #4b5563;
                }
                .fc-daygrid-event .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
                .fc-list-event .holiday-segment-title { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
                .custom-list-active .fc-view-harness {
                    display: none !important;
                }
                .custom-schedule-list {
                    height: calc(100% - 1px);
                }
            `}</style>
    </div>
  );
};

export default TeacherCalendarSection;
