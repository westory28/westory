import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import type { CalendarEvent } from "../../../types";
import {
  getScheduleCategoryMeta,
  getScheduleEventColor,
  type ScheduleCategory,
} from "../../../lib/scheduleCategories";
import { getSchedulePeriodRangeLabel } from "../../../lib/schedulePeriods";
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
  onSearchClick: () => void;
  onAddEvent: () => void;
  onFilterChange: (value: string) => void;
}

const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;

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
  onSearchClick,
  onAddEvent,
  onFilterChange,
}) => {
  const today = getKoreanDateKey();
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
  const slideFrom = weekStart < previousWeek.current ? "-16px" : "16px";
  useEffect(() => {
    previousWeek.current = weekStart;
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
  const eventListRef = useRef<HTMLDivElement>(null);
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
  const month = Number(weekStart.slice(5, 7));
  const lastMonth = Number(days[6].slice(5, 7));

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
        <Link to="/teacher/schedule" className="teacher-dashboard-link">
          전체 보기 <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="teacher-week-schedule__toolbar">
        <span className="teacher-week-schedule__range" aria-live="polite">
          {weekStart.replace(/-/g, ".")} – {days[6].replace(/-/g, ".")}
        </span>
        <div className="teacher-week-schedule__navigation">
          <button
            type="button"
            aria-label="이전 주"
            onClick={() => onWeekChange(shiftCalendarDate(weekStart, -7))}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              onWeekChange(getWeekStart(today));
              onDateClick(today);
            }}
          >
            이번 주
          </button>
          <button
            type="button"
            aria-label="다음 주"
            onClick={() => onWeekChange(shiftCalendarDate(weekStart, 7))}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <div
        key={weekStart}
        className="teacher-week-schedule__content"
        style={{ "--week-slide-from": slideFrom } as React.CSSProperties}
      >
        <div className="teacher-week-strip" aria-label="주간 날짜">
          <strong className="teacher-week-strip__month">
            {month === lastMonth ? `${month}월` : `${month}·${lastMonth}월`}
          </strong>
          {days.map((date, index) => {
            const dayEvents = weekEvents.filter((event) =>
              eventIncludesDate(event, date),
            );
            const holiday = dayEvents.some(
              (event) => event.eventType === "holiday",
            );
            return (
              <button
                key={date}
                type="button"
                className={`teacher-week-strip__day${date === today ? " is-today" : ""}${date === selectedDate ? " is-selected" : ""}${holiday || index === 6 ? " is-holiday" : index === 5 ? " is-saturday" : ""}`}
                aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${["월", "화", "수", "목", "금", "토", "일"][index]}요일, 일정 ${dayEvents.length}개`}
                aria-current={date === today ? "date" : undefined}
                aria-pressed={date === selectedDate}
                onClick={() => onDateClick(date)}
                onDoubleClick={() => onDateDoubleClick(date)}
              >
                <span>{["월", "화", "수", "목", "금", "토", "일"][index]}</span>
                <strong>{Number(date.slice(8, 10))}</strong>
                <span
                  className={`teacher-week-strip__marker${dayEvents.length ? " has-events" : ""}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
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
            <button
              type="button"
              className="student-calendar-shell__search-button"
              onClick={onSearchClick}
              aria-label="일정 검색"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="m15 15 5 5" />
              </svg>
              검색
            </button>
            <button
              type="button"
              className="student-calendar-shell__control-button student-calendar-shell__action-button"
              onClick={onAddEvent}
              aria-label="일정 추가"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              추가
            </button>
          </div>
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
          {!loading && !error && !weekEvents.length && (
            <p className="teacher-week-events__status">
              이번 주에 등록된 일정이 없습니다.
            </p>
          )}
          {weekEvents.map((event) => {
            const start = calendarDateKey(event.start);
            const end = calendarEventEndDate(event);
            const isToday = eventIncludesDate(event, today);
            const meta = getScheduleCategoryMeta(event.eventType, categories);
            const dateLabel =
              end > start
                ? `${shortDate(start)}–${shortDate(end)}`
                : isToday
                  ? "오늘"
                  : shortDate(start);
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
                onClick={() => onEventClick(event)}
              >
                <span className="teacher-week-event__date">
                  <span
                    className="teacher-week-event__dot"
                    style={{
                      backgroundColor: getScheduleEventColor(event, categories),
                    }}
                    aria-hidden="true"
                  />
                  {dateLabel}
                </span>
                <span className="teacher-week-event__body">
                  <strong>{event.title}</strong>
                  <span>
                    {event.targetType === "class" && event.targetClass
                      ? `${classLabel(event.targetClass)} · `
                      : ""}
                    {event.eventType === "holiday" ? "공휴일" : meta.label}
                  </span>
                </span>
                <span className="teacher-week-event__period">
                  {periodLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TeacherWeekSchedule;
