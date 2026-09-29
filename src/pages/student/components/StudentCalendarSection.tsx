import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { CalendarEvent } from "../../../types";
import {
  getScheduleCategoryMeta,
  getScheduleEventColor,
  useScheduleCategories,
} from "../../../lib/scheduleCategories";
import {
  compareCalendarSchedule,
  compareFullCalendarSchedulePeriod,
  getSchedulePeriodOrder,
} from "../../../lib/schedulePeriods";
import ScheduleMorePopover from "../../../components/common/ScheduleMorePopover";
import type { ScheduleMorePopoverAnchor } from "../../../components/common/ScheduleMorePopover";
import AttendanceStamp from "./AttendanceStamp";
import SearchModal from "./SearchModal";
import "./studentCalendar.css";

const dateKey = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split("T")[0];
};
const startKey = (value: string) => value.split("T")[0];
type View = "dayGridMonth" | "listMonth";

interface Props {
  events: CalendarEvent[];
  attendanceDates: string[];
  onEventClick: (event: CalendarEvent) => void;
}

// Uses the same calendar shell and grid styles as TeacherCalendarSection.
export default function StudentCalendarSection({
  events,
  attendanceDates,
  onEventClick,
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const { categories } = useScheduleCategories();
  const [view, setView] = useState<View>("dayGridMonth");
  const [title, setTitle] = useState("");
  const [range, setRange] = useState({ start: "", end: "" });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [more, setMore] = useState<{
    date: string;
    anchorRect: ScheduleMorePopoverAnchor;
  } | null>(null);
  const attended = useMemo(() => new Set(attendanceDates), [attendanceDates]);
  const holidays = useMemo(() => {
    const result = new Map<string, string>();
    events
      .filter((event) => event.eventType === "holiday")
      .forEach((event) => {
        const key = startKey(event.start);
        result.set(
          key,
          [result.get(key), event.title].filter(Boolean).join(" · "),
        );
      });
    return result;
  }, [events]);
  const fcEvents = useMemo(
    () =>
      events
        .filter(
          (event) => view !== "dayGridMonth" || event.eventType !== "holiday",
        )
        .map((event) => {
          const start = startKey(event.start);
          const inclusiveEnd = startKey(event.end || event.start);
          const isRange = inclusiveEnd > start;
          const end = new Date(`${inclusiveEnd}T00:00:00`);
          end.setDate(end.getDate() + 1);
          const color = getScheduleEventColor(event, categories);
          return {
            id: event.id,
            title: event.title,
            start,
            end: isRange ? dateKey(end) : undefined,
            allDay: true,
            backgroundColor: `color-mix(in srgb, ${color} 22%, var(--ws-surface))`,
            borderColor: color,
            textColor: "var(--ws-text-strong)",
            classNames: [
              isRange
                ? "student-calendar-range-event"
                : "student-calendar-single-event",
            ],
            extendedProps: {
              ...event,
              isMultiDayRange: isRange,
              periodOrder: getSchedulePeriodOrder(
                event.startPeriod ?? event.period,
              ),
            },
          };
        }),
    [events, categories, view],
  );
  const listRows = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    [...events].sort(compareCalendarSchedule).forEach((event) => {
      const start = startKey(event.start);
      const end = startKey(event.end || event.start);
      const last = end > start ? end : start;
      if (!range.start || start >= range.end || last < range.start) return;
      const day = new Date(
        `${start > range.start ? start : range.start}T00:00:00`,
      );
      for (
        let key = dateKey(day);
        key <= last && key < range.end;
        key = dateKey(day)
      ) {
        groups.set(key, [...(groups.get(key) || []), event]);
        day.setDate(day.getDate() + 1);
      }
    });
    // Attendance remains visible even on days without a school event.
    attendanceDates
      .filter((key) => key >= range.start && key < range.end)
      .forEach((key) => {
        if (!groups.has(key)) groups.set(key, []);
      });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, attendanceDates, range]);
  const navigate = (action: "prev" | "next" | "today") =>
    calendarRef.current?.getApi()[action]();
  const openEvent = (event: CalendarEvent) => {
    setMore(null);
    if (event.eventType !== "holiday") onEventClick(event);
  };

  return (
    <section
      className={`student-calendar-section student-calendar-shell student-full-calendar ${view === "dayGridMonth" ? "student-calendar-shell--month" : ""}`}
      aria-label="학사 일정 달력"
    >
      <div className="student-calendar-shell__header">
        <div className="student-calendar-shell__header-main">
          <div className="student-calendar-shell__heading-group">
            <span className="student-calendar-shell__eyebrow">
              <span className="student-calendar-shell__eyebrow-icon">
                <i className="far fa-calendar" aria-hidden="true" />
              </span>
              학사 일정
            </span>
            <div className="student-calendar-shell__month-row">
              <div className="student-calendar-shell__month-badge">
                <button
                  type="button"
                  className="student-calendar-shell__nav-button student-calendar-shell__nav-button--month"
                  onClick={() => navigate("prev")}
                  aria-label="이전 달"
                >
                  <i className="fas fa-chevron-left" aria-hidden="true" />
                </button>
                <div className="student-calendar-shell__month-label">
                  <h2
                    className="student-calendar-shell__month-title"
                    aria-live="polite"
                  >
                    {title || "학사 일정"}
                  </h2>
                </div>
                <button
                  type="button"
                  className="student-calendar-shell__nav-button student-calendar-shell__nav-button--month"
                  onClick={() => navigate("next")}
                  aria-label="다음 달"
                >
                  <i className="fas fa-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div className="student-calendar-shell__toolbar">
            <div className="student-calendar-shell__calendar-tools">
              <div className="student-calendar-shell__control-cluster">
                <button
                  type="button"
                  className="student-calendar-shell__control-button"
                  onClick={() => navigate("today")}
                >
                  오늘
                </button>
              </div>
              <div className="student-calendar-shell__control-cluster student-calendar-shell__control-cluster--view">
                <div className="student-calendar-shell__view-toggle">
                  {(
                    [
                      ["dayGridMonth", "달력"],
                      ["listMonth", "목록"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={view === value}
                      className={`student-calendar-shell__view-button ${view === value ? "is-active" : ""}`}
                      onClick={() =>
                        calendarRef.current?.getApi().changeView(value)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="student-calendar-shell__search-button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="일정 검색"
                >
                  <i className="fas fa-search" aria-hidden="true" />
                  <span>검색</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        className="calendar-wrapper student-calendar-shell__body student-full-calendar__body"
        data-calendar-view={view}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale="ko"
          headerToolbar={false}
          events={fcEvents}
          eventOrder={compareFullCalendarSchedulePeriod}
          displayEventTime={false}
          allDayText=""
          datesSet={(arg) => {
            setMore(null);
            setView(arg.view.type as View);
            setTitle(arg.view.title);
            setRange({ start: dateKey(arg.start), end: dateKey(arg.end) });
          }}
          dateClick={(arg) => {
            setMore(null);
            setSelectedDate(arg.dateStr);
          }}
          eventClick={(arg) =>
            openEvent(arg.event.extendedProps as CalendarEvent)
          }
          dayCellContent={(arg) => {
            const key = dateKey(arg.date);
            const holiday = holidays.get(key);
            return (
              <span className="student-calendar-day-head">
                <span className="student-calendar-day-date">
                  <span className="student-calendar-day-label">
                    {arg.date.getDate()}
                  </span>
                  {attended.has(key) && <AttendanceStamp date={key} />}
                </span>
                {holiday && (
                  <span
                    className="student-calendar-day-holiday-label"
                    title={holiday}
                  >
                    {holiday}
                  </span>
                )}
              </span>
            );
          }}
          dayCellClassNames={(arg) => {
            const key = dateKey(arg.date);
            return [
              holidays.has(key) ? "fc-day-holiday" : "",
              selectedDate === key ? "fc-day-selected" : "",
            ].filter(Boolean);
          }}
          eventDidMount={(arg) => {
            const isRange = Boolean(arg.event.extendedProps.isMultiDayRange);
            const harness = arg.el.closest(
              ".fc-daygrid-event-harness, .fc-daygrid-event-harness-abs",
            );
            harness?.classList.toggle(
              "student-calendar-event-harness--range",
              isRange,
            );
            harness?.classList.toggle(
              "student-calendar-event-harness--single",
              !isRange,
            );
          }}
          eventContent={(arg) => (
            <div
              className={`student-calendar-event-label ${arg.event.extendedProps.isMultiDayRange ? "is-range" : "is-single"} ${arg.isStart ? "is-start" : ""} ${arg.isEnd ? "is-end" : ""}`}
              title={arg.event.title}
            >
              <span className="student-calendar-event-label__text">
                {arg.event.title}
              </span>
            </div>
          )}
          height="100%"
          contentHeight="100%"
          expandRows
          eventDisplay="block"
          dayMaxEvents
          fixedWeekCount={false}
          showNonCurrentDates
          moreLinkText={(count) => `+${count}개`}
          moreLinkClick={(arg) => {
            arg.jsEvent.preventDefault();
            const target = arg.jsEvent.target;
            const element =
              target instanceof Element
                ? target.closest<HTMLElement>(".fc-more-link")
                : null;
            if (element) {
              const rect = element.getBoundingClientRect();
              setMore({
                date: dateKey(arg.date),
                anchorRect: {
                  top: rect.top,
                  bottom: rect.bottom,
                  left: rect.left,
                  right: rect.right,
                  width: rect.width,
                  height: rect.height,
                },
              });
            }
            return true as unknown as string;
          }}
        />
        {view === "listMonth" && (
          <div className="custom-schedule-list absolute inset-0 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            {listRows.length === 0 && (
              <p className="p-4 text-sm text-gray-500">
                등록된 일정이 없습니다.
              </p>
            )}
            {listRows.map(([date, dayEvents]) => (
              <div key={date}>
                <div className="student-full-calendar__list-heading border-t border-gray-200 bg-gray-50 px-4 py-3 font-extrabold text-gray-900 first:border-t-0">
                  <span>
                    {new Intl.DateTimeFormat("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    }).format(new Date(`${date}T00:00:00`))}
                  </span>
                  {attended.has(date) && <AttendanceStamp date={date} />}
                </div>
                {dayEvents.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    className="student-full-calendar__list-event"
                    disabled={event.eventType === "holiday"}
                    onClick={() => openEvent(event)}
                  >
                    <span className="student-full-calendar__category">
                      <span
                        className="student-full-calendar__category-dot"
                        style={{
                          backgroundColor: getScheduleEventColor(
                            event,
                            categories,
                          ),
                        }}
                      />
                      {
                        getScheduleCategoryMeta(event.eventType, categories)
                          .label
                      }
                    </span>
                    <span
                      className="student-full-calendar__list-title"
                      title={event.title}
                    >
                      {event.title}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {more && (
        <ScheduleMorePopover
          {...more}
          events={events}
          categories={categories}
          hideHolidays
          onClose={() => setMore(null)}
          onEventClick={openEvent}
        />
      )}
      {searchOpen && (
        <SearchModal
          events={events}
          categories={categories}
          isOpen
          onClose={() => setSearchOpen(false)}
          onSelectEvent={(date) => {
            calendarRef.current?.getApi().gotoDate(date);
            setSelectedDate(date);
            setSearchOpen(false);
          }}
        />
      )}
    </section>
  );
}
