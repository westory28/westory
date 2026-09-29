import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type { CalendarEvent } from "../../../types";
import {
  getScheduleCategoryMeta,
  getScheduleEventColor,
  type ScheduleCategory,
} from "../../../lib/scheduleCategories";
import {
  compareCalendarSchedule,
  getSchedulePeriodRangeLabel,
} from "../../../lib/schedulePeriods";
import NavigationIcon from "../../../components/layout/TeacherNavigationIcon";
import StudentScheduleTitle from "./StudentScheduleTitle";
import "./studentWeekSchedule.css";
import {
  calendarDateKey,
  calendarEventEndDate,
  eventIncludesDate,
  getKoreanDateKey,
  getWeekEvents,
  getWeekStart,
  shiftCalendarDate,
} from "../../../lib/calendarWeek";

interface Props {
  events: CalendarEvent[];
  categories: ScheduleCategory[];
  weekStart: string;
  selectedDate: string | null;
  loading: boolean;
  error: boolean;
  attendanceLoading: boolean;
  attendanceChecked: boolean;
  attendanceMessage: string;
  attendanceDates: string[];
  attendanceGoalText: string;
  onAttendanceCheck: () => void;
  onWeekChange: (date: string) => void;
  onDateClick: (date: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSearchSelect: (date: string) => void;
}

const readableDate = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
const compactDate = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// Keep the configured hue readable on both white and the date badge's 22% tint.
const readableEventColor = (color: string) => {
  const rgb = color
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => parseInt(part, 16));
  const luminance = (channels: number[]) =>
    channels.reduce((sum, channel, index) => {
      const value = channel / 255;
      return (
        sum +
        (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][index]
      );
    }, 0);
  const background = luminance(
    rgb.map((channel) => channel * 0.22 + 255 * 0.78),
  );
  let text = rgb;
  while ((background + 0.05) / (luminance(text) + 0.05) < 4.5) {
    text = text.map((channel) => Math.floor(channel * 0.9));
  }
  return `rgb(${text.join(", ")})`;
};

const StudentWeekSchedule: React.FC<Props> = ({
  events,
  categories,
  weekStart,
  selectedDate,
  loading,
  error,
  attendanceLoading,
  attendanceChecked,
  attendanceMessage,
  attendanceDates,
  attendanceGoalText,
  onAttendanceCheck,
  onWeekChange,
  onDateClick,
  onEventClick,
  onSearchSelect,
}) => {
  const today = getKoreanDateKey();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchTerm = searchOpen ? query.trim().toLowerCase() : "";
  const searchResults = useMemo(
    () =>
      !searchTerm
        ? []
        : events
            .filter(
              (event) =>
                event.title?.toLowerCase().includes(searchTerm) ||
                event.description?.toLowerCase().includes(searchTerm),
            )
            .sort(compareCalendarSchedule),
    [events, searchTerm],
  );
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    searchButtonRef.current?.focus();
  };
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  const attendanceDateSet = useMemo(
    () => new Set(attendanceDates),
    [attendanceDates],
  );
  const attendanceHasError = /오류|실패/.test(attendanceMessage);
  const attendanceDescription = [attendanceMessage, attendanceGoalText]
    .filter(Boolean)
    .join(" · ");
  const previousWeek = useRef(weekStart);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fromWeek = previousWeek.current;
    previousWeek.current = weekStart;
    const content = contentRef.current;
    if (fromWeek === weekStart || !content) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations = Array.from(
      content.querySelectorAll<HTMLElement>(
        ".student-week-strip__number, .student-week-event__date-label, .student-week-event__title, .student-week-event__category-label, .student-week-event__period-label, .student-week-events__status",
      ),
      (text) =>
        text.animate(
          [
            {
              transform: `translateX(${weekStart < fromWeek ? -12 : 12}px)`,
              opacity: 0.35,
            },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration: 140, easing: "ease-out" },
        ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [weekStart]);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        shiftCalendarDate(weekStart, index),
      ),
    [weekStart],
  );
  const weekEvents = useMemo(
    () => getWeekEvents(events, weekStart),
    [events, weekStart],
  );
  const displayedEvents = searchTerm ? searchResults : weekEvents;
  const eventListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (eventListRef.current) eventListRef.current.scrollTop = 0;
  }, [searchTerm]);
  const previousSelection = useRef({ selectedDate, weekStart });
  useEffect(() => {
    const list = eventListRef.current;
    if (!list) return;
    const dateChanged = previousSelection.current.selectedDate !== selectedDate;
    const weekChanged = previousSelection.current.weekStart !== weekStart;
    previousSelection.current = { selectedDate, weekStart };
    if (!dateChanged) {
      if (weekChanged) list.scrollTop = 0;
      return;
    }
    const selectedRow = list.querySelector<HTMLElement>(
      ".student-week-event.is-selected",
    );
    list.scrollTop = selectedRow ? selectedRow.offsetTop : 0;
  }, [selectedDate, weekStart, weekEvents]);
  const sameMonth = weekStart.slice(0, 7) === days[6].slice(0, 7);
  const weekLabel = `${readableDate(weekStart)} – ${sameMonth ? `${Number(days[6].slice(8, 10))}일` : readableDate(days[6])}`;
  const weekDescription = `${weekStart.slice(0, 4)}년 ${readableDate(weekStart)}부터 ${days[6].slice(0, 4)}년 ${readableDate(days[6])}까지`;

  return (
    <section
      className="student-week-schedule"
      aria-labelledby="student-week-title"
    >
      <div className="student-week-schedule__heading">
        <h2 id="student-week-title">
          <NavigationIcon name="calendar" />
          이번 주 학사 일정
        </h2>
      </div>
      <div className="student-week-schedule__toolbar">
        <span
          className="student-week-schedule__range"
          aria-live="polite"
          aria-label={weekDescription}
        >
          {weekLabel}
        </span>
        <button
          type="button"
          className="student-week-schedule__today"
          onClick={() => {
            onWeekChange(getWeekStart(today));
            onDateClick(today);
          }}
        >
          이번 주
        </button>
        <div className="student-week-schedule__filters">
          <div className="student-week-schedule__actions">
            <div
              className={`student-week-search${searchOpen ? " is-open" : ""}`}
            >
              <div
                className="student-week-search__input-wrap"
                aria-hidden={!searchOpen}
              >
                <input
                  lang="ko"
                  inputMode="text"
                  id="student-week-search-input"
                  ref={searchInputRef}
                  type="search"
                  aria-label="일정 검색어"
                  placeholder="일정 검색"
                  value={query}
                  disabled={!searchOpen}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeSearch();
                  }}
                />
              </div>
              <button
                ref={searchButtonRef}
                type="button"
                className="student-week-schedule__icon-button"
                onClick={() =>
                  searchOpen ? closeSearch() : setSearchOpen(true)
                }
                aria-label={searchOpen ? "일정 검색 닫기" : "일정 검색"}
                aria-expanded={searchOpen}
                aria-controls="student-week-search-input"
                title={searchOpen ? "검색 닫기" : "일정 검색"}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6" />
                  <path d="m15 15 5 5" />
                </svg>
              </button>
            </div>
            <Link
              to="/student/calendar"
              className="student-week-schedule__calendar-link"
              aria-label="전체 캘린더 보기"
              title="전체 캘린더 보기"
            >
              <NavigationIcon name="calendar" />
            </Link>
            {attendanceChecked ? (
              <span
                className="student-week-attendance is-complete"
                title={attendanceDescription || "오늘 출석 완료"}
              >
                출석 완료
              </span>
            ) : (
              <button
                type="button"
                className="student-week-attendance"
                disabled={attendanceLoading}
                onClick={onAttendanceCheck}
                title={attendanceDescription || "출석 체크"}
              >
                {attendanceLoading ? "처리 중…" : "출석 체크"}
              </button>
            )}
          </div>
        </div>
      </div>
      {attendanceHasError && (
        <p className="student-week-attendance__error" role="alert">
          {attendanceMessage}
        </p>
      )}
      <div className="student-week-schedule__viewport">
        <div ref={contentRef} className="student-week-schedule__content">
          <div className="student-week-strip" aria-label="주간 날짜">
            <button
              type="button"
              className="student-week-strip__previous"
              aria-label="이전 주"
              onClick={() => onWeekChange(shiftCalendarDate(weekStart, -7))}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            {days.map((date, index) => {
              const dayEvents = weekEvents.filter((event) =>
                eventIncludesDate(event, date),
              );
              const holiday = dayEvents.some(
                (event) => event.eventType === "holiday",
              );
              const ribbonEvent = dayEvents.find(
                (event) => event.eventType !== "holiday",
              );
              const ribbonColor = ribbonEvent
                ? readableEventColor(
                    getScheduleEventColor(ribbonEvent, categories),
                  )
                : undefined;
              return (
                <button
                  key={index}
                  type="button"
                  className={`student-week-strip__day${date === today ? " is-today" : ""}${date === selectedDate ? " is-selected" : ""}${ribbonEvent ? " has-ribbon" : ""}${holiday || index === 0 ? " is-holiday" : index === 6 ? " is-saturday" : ""}`}
                  aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${["일", "월", "화", "수", "목", "금", "토"][index]}요일, 일정 ${dayEvents.length}개${ribbonEvent ? `, 표시 리본: ${ribbonEvent.title}` : ""}${attendanceDateSet.has(date) ? ", 출석 완료" : ""}`}
                  title={
                    ribbonEvent ? `표시 리본: ${ribbonEvent.title}` : undefined
                  }
                  style={
                    ribbonColor
                      ? ({
                          "--week-ribbon-color": ribbonColor,
                        } as React.CSSProperties)
                      : undefined
                  }
                  aria-current={date === today ? "date" : undefined}
                  aria-pressed={date === selectedDate}
                  onClick={() => onDateClick(date)}
                >
                  <span>
                    {["일", "월", "화", "수", "목", "금", "토"][index]}
                  </span>
                  <strong>
                    <span className="student-week-strip__number">
                      {Number(date.slice(8, 10))}
                    </span>
                    {attendanceDateSet.has(date) && (
                      <span
                        className="student-week-strip__attendance"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    )}
                  </strong>
                  <span
                    className={`student-week-strip__marker${dayEvents.length ? " has-events" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
            <button
              type="button"
              className="student-week-strip__next"
              aria-label="다음 주"
              onClick={() => onWeekChange(shiftCalendarDate(weekStart, 7))}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <div
            ref={eventListRef}
            className="student-week-events"
            aria-busy={loading}
          >
            {loading && (
              <p className="student-week-events__status" role="status">
                일정을 불러오는 중입니다.
              </p>
            )}
            {!loading && error && (
              <p className="student-week-events__status" role="alert">
                일정을 불러오지 못했습니다.{" "}
                <Link to="/student/calendar">캘린더에서 다시 확인</Link>
              </p>
            )}
            {searchTerm && !loading && !error && (
              <p className="student-week-search__summary" role="status">
                검색 결과 {displayedEvents.length}건
              </p>
            )}
            {!loading && !error && !displayedEvents.length && (
              <p className="student-week-events__status">
                {searchTerm
                  ? "검색어와 일치하는 일정이 없습니다."
                  : "이번 주에 등록된 일정이 없습니다."}
              </p>
            )}
            {displayedEvents.map((event) => {
              const start = calendarDateKey(event.start);
              const end = calendarEventEndDate(event);
              const meta = getScheduleCategoryMeta(event.eventType, categories);
              const eventColor =
                event.eventType === "holiday"
                  ? "var(--ws-danger-text, #b91c1c)"
                  : getScheduleEventColor(event, categories);
              const dateLabel =
                end > start
                  ? `${readableDate(start)} – ${readableDate(end)}`
                  : readableDate(start);
              const periodLabel =
                event.eventType === "holiday"
                  ? "종일"
                  : getSchedulePeriodRangeLabel(
                      event.startPeriod ?? event.period,
                      event.endPeriod,
                    );
              return (
                <button
                  key={event.id}
                  type="button"
                  aria-label={`${dateLabel}, ${event.title}, ${event.eventType !== "holiday" ? `${meta.label}, ` : ""}${periodLabel}`}
                  className={`student-week-event${selectedDate && eventIncludesDate(event, selectedDate) ? " is-selected" : ""}`}
                  onClick={() => {
                    if (searchTerm) {
                      onSearchSelect(event.start);
                      closeSearch();
                    } else onEventClick(event);
                  }}
                  style={
                    {
                      "--schedule-event-color": eventColor,
                      "--schedule-event-text-color":
                        event.eventType === "holiday"
                          ? eventColor
                          : readableEventColor(eventColor),
                    } as React.CSSProperties
                  }
                >
                  <span
                    title={dateLabel}
                    aria-label={dateLabel}
                    className={`student-week-event__date${event.eventType !== "holiday" ? " student-week-event__date-badge" : ""}`}
                  >
                    <span
                      className="student-week-event__date-label student-week-event__date-label--full"
                      aria-hidden="true"
                    >
                      {dateLabel}
                    </span>
                    <span
                      className="student-week-event__date-label student-week-event__date-label--compact"
                      aria-hidden="true"
                    >
                      {end > start
                        ? `${compactDate(start)}–${compactDate(end)}`
                        : compactDate(start)}
                    </span>
                  </span>
                  <span className="student-week-event__body">
                    <strong
                      className="student-week-event__title"
                      title={event.title}
                    >
                      <StudentScheduleTitle title={event.title} />
                    </strong>
                    <span className="student-week-event__metadata">
                      {event.eventType !== "holiday" && (
                        <span
                          className="student-week-event__category"
                          title={`${meta.label}`}
                        >
                          <span className="student-week-event__category-label">
                            {meta.label}
                          </span>
                        </span>
                      )}
                      {event.eventType !== "holiday" && (
                        <span
                          className="student-week-event__divider"
                          aria-hidden="true"
                        />
                      )}
                      <span className="student-week-event__period">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8.5" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                        <span className="student-week-event__period-label">
                          {periodLabel}
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default StudentWeekSchedule;
