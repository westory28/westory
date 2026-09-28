import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
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
import TeacherNavigationIcon from "../../../components/layout/TeacherNavigationIcon";
import {
  calendarDateKey,
  calendarEventEndDate,
  eventIncludesDate,
  getKoreanDateKey,
  getWeekEvents,
  getWeekStart,
  shiftCalendarDate,
} from "./teacherDashboardWeek";

interface Props {
  events: CalendarEvent[];
  categories: ScheduleCategory[];
  weekStart: string;
  selectedDate: string | null;
  loading: boolean;
  error: boolean;
  filterClass: string;
  availableClassTargets: string[];
  onWeekChange: (date: string) => void;
  onDateClick: (date: string) => void;
  onDateDoubleClick: (date: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSearchSelect: (date: string) => void;
  onAddEvent: () => void;
  onFilterChange: (value: string) => void;
}

const readableDate = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;

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

const TeacherWeekSchedule: React.FC<Props> = ({
  events,
  categories,
  weekStart,
  selectedDate,
  loading,
  error,
  filterClass,
  availableClassTargets,
  onWeekChange,
  onDateClick,
  onDateDoubleClick,
  onEventClick,
  onSearchSelect,
  onAddEvent,
  onFilterChange,
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
  const [schoolLabels, setSchoolLabels] = useState<{
    grades: Record<string, string>;
    classes: Record<string, string>;
  }>({ grades: {}, classes: {} });
  useEffect(() => {
    let active = true;
    void getDoc(doc(db, "site_settings", "school_config"))
      .then((snapshot) => {
        if (!active || !snapshot.exists()) return;
        const data = snapshot.data();
        const labels = (
          items: Array<{ value?: string; label?: string }> = [],
        ) =>
          Object.fromEntries(
            items
              .map((item) => [
                String(item?.value ?? "").trim(),
                String(item?.label ?? "").trim(),
              ])
              .filter(([value, label]) => value && label),
          );
        setSchoolLabels({
          grades: labels(data.grades),
          classes: labels(data.classes),
        });
      })
      .catch((error) => console.error("Failed to load school config:", error));
    return () => {
      active = false;
    };
  }, []);
  const classLabel = (value: string) => {
    const [grade, classroom] = value.split("-");
    const gradeLabel =
      schoolLabels.grades[grade] || (grade ? `${grade}학년` : "");
    const classroomLabel =
      schoolLabels.classes[classroom] || (classroom ? `${classroom}반` : "");
    return `${gradeLabel} ${classroomLabel}`.trim() || value;
  };
  const previousWeek = useRef(weekStart);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fromWeek = previousWeek.current;
    previousWeek.current = weekStart;
    const content = contentRef.current;
    if (fromWeek === weekStart || !content) return;
    // Explicitly requested for user-triggered week changes, including reduced-motion mode.
    const animations = Array.from(
      content.querySelectorAll<HTMLElement>(
        ".teacher-week-strip__number, .teacher-week-event__date-label, .teacher-week-event__title, .teacher-week-event__category-label, .teacher-week-event__period-label, .teacher-week-events__status",
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
      ".teacher-week-event.is-selected",
    );
    list.scrollTop = selectedRow ? selectedRow.offsetTop : 0;
  }, [selectedDate, weekStart, weekEvents]);
  const sameMonth = weekStart.slice(0, 7) === days[6].slice(0, 7);
  const weekLabel = `${readableDate(weekStart)} – ${sameMonth ? `${Number(days[6].slice(8, 10))}일` : readableDate(days[6])}`;
  const weekDescription = `${weekStart.slice(0, 4)}년 ${readableDate(weekStart)}부터 ${days[6].slice(0, 4)}년 ${readableDate(days[6])}까지`;

  return (
    <section
      className="teacher-week-schedule"
      aria-labelledby="teacher-week-title"
    >
      <div className="teacher-week-schedule__heading">
        <h2 id="teacher-week-title">
          <TeacherNavigationIcon name="calendar" />
          이번 주 학사 일정
        </h2>
      </div>
      <div className="teacher-week-schedule__toolbar">
        <span
          className="teacher-week-schedule__range"
          aria-live="polite"
          aria-label={weekDescription}
        >
          {weekLabel}
        </span>
        <button
          type="button"
          className="teacher-week-schedule__today"
          onClick={() => {
            onWeekChange(getWeekStart(today));
            onDateClick(today);
          }}
        >
          이번 주
        </button>
        <div className="teacher-week-schedule__filters">
          <select
            className="student-calendar-shell__filter-select"
            aria-label="일정 대상 필터"
            value={filterClass}
            onChange={(event) => onFilterChange(event.target.value)}
          >
            <option value="all">전체 일정</option>
            <option value="common">공통 일정</option>
            {availableClassTargets.map((target) => (
              <option key={target} value={target}>
                {classLabel(target)}
              </option>
            ))}
          </select>
          <div className="teacher-week-schedule__actions">
            <div
              className={`teacher-week-search${searchOpen ? " is-open" : ""}`}
            >
              <div
                className="teacher-week-search__input-wrap"
                aria-hidden={!searchOpen}
              >
                <input
                  id="teacher-week-search-input"
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
                className="student-calendar-shell__search-button teacher-week-schedule__icon-button"
                onClick={() =>
                  searchOpen ? closeSearch() : setSearchOpen(true)
                }
                aria-label={searchOpen ? "일정 검색 닫기" : "일정 검색"}
                aria-expanded={searchOpen}
                aria-controls="teacher-week-search-input"
                title={searchOpen ? "검색 닫기" : "일정 검색"}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6" />
                  <path d="m15 15 5 5" />
                </svg>
              </button>
            </div>
            <Link
              to="/teacher/schedule"
              className="teacher-week-schedule__calendar-link"
              aria-label="전체 캘린더 보기"
              title="전체 캘린더 보기"
            >
              <TeacherNavigationIcon name="calendar" />
            </Link>
            <button
              type="button"
              className="student-calendar-shell__control-button student-calendar-shell__action-button teacher-week-schedule__icon-button"
              onClick={onAddEvent}
              aria-label="일정 추가"
              title="일정 추가"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="teacher-week-schedule__viewport">
        <div ref={contentRef} className="teacher-week-schedule__content">
          <div className="teacher-week-strip" aria-label="주간 날짜">
            <button
              type="button"
              className="teacher-week-strip__previous"
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
                  className={`teacher-week-strip__day${date === today ? " is-today" : ""}${date === selectedDate ? " is-selected" : ""}${ribbonEvent ? " has-ribbon" : ""}${holiday || index === 0 ? " is-holiday" : index === 6 ? " is-saturday" : ""}`}
                  aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${["일", "월", "화", "수", "목", "금", "토"][index]}요일, 일정 ${dayEvents.length}개${ribbonEvent ? `, 표시 리본: ${ribbonEvent.title}` : ""}`}
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
                  onDoubleClick={() => onDateDoubleClick(date)}
                >
                  <span>
                    {["일", "월", "화", "수", "목", "금", "토"][index]}
                  </span>
                  <strong>
                    <span className="teacher-week-strip__number">
                      {Number(date.slice(8, 10))}
                    </span>
                  </strong>
                  <span
                    className={`teacher-week-strip__marker${dayEvents.length ? " has-events" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
            <button
              type="button"
              className="teacher-week-strip__next"
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
            className="teacher-week-events"
            aria-busy={loading}
          >
            {loading && (
              <p className="teacher-week-events__status" role="status">
                일정을 불러오는 중입니다.
              </p>
            )}
            {!loading && error && (
              <p className="teacher-week-events__status" role="alert">
                일정을 불러오지 못했습니다.{" "}
                <Link to="/teacher/schedule">캘린더에서 다시 확인</Link>
              </p>
            )}
            {searchTerm && !loading && !error && (
              <p className="teacher-week-search__summary" role="status">
                검색 결과 {displayedEvents.length}건
              </p>
            )}
            {!loading && !error && !displayedEvents.length && (
              <p className="teacher-week-events__status">
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
                  className={`teacher-week-event${selectedDate && eventIncludesDate(event, selectedDate) ? " is-selected" : ""}`}
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
                    className={`teacher-week-event__date${event.eventType !== "holiday" ? " teacher-week-event__date-badge" : ""}`}
                  >
                    <span className="teacher-week-event__date-label">
                      {dateLabel}
                    </span>
                  </span>
                  <span className="teacher-week-event__body">
                    <strong
                      className="teacher-week-event__title"
                      title={event.title}
                    >
                      {event.title}
                    </strong>
                    <span className="teacher-week-event__metadata">
                      {event.eventType !== "holiday" && (
                        <span
                          className="teacher-week-event__category"
                          title={`${event.targetType === "class" && event.targetClass ? `${classLabel(event.targetClass)} · ` : ""}${meta.label}`}
                        >
                          <span className="teacher-week-event__category-label">
                            {event.targetType === "class" && event.targetClass
                              ? `${classLabel(event.targetClass)} · `
                              : ""}
                            {meta.label}
                          </span>
                        </span>
                      )}
                      {event.eventType !== "holiday" && (
                        <span
                          className="teacher-week-event__divider"
                          aria-hidden="true"
                        />
                      )}
                      <span className="teacher-week-event__period">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8.5" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                        <span className="teacher-week-event__period-label">
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

export default TeacherWeekSchedule;
