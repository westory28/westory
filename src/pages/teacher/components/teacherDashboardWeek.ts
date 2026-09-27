import type { CalendarEvent } from "../../../types";
import { compareSchedulePeriod } from "../../../lib/schedulePeriods";

const DAY_MS = 24 * 60 * 60 * 1000;

export const getKoreanDateKey = (date = new Date()) =>
  new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const calendarDateKey = (value?: string) => {
  if (!value) return "";
  // Calendar documents store inclusive date-only ranges. Zoned timestamps,
  // when present, still belong to the school's Korean calendar date.
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : getKoreanDateKey(date);
  }
  const key = value.slice(0, 10);
  const time = Date.parse(`${key}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === key
    ? key
    : "";
};

export const shiftCalendarDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

export const getWeekStart = (date: string) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftCalendarDate(date, -(weekday === 0 ? 6 : weekday - 1));
};

export const calendarEventEndDate = (event: CalendarEvent) => {
  const start = calendarDateKey(event.start);
  const end = calendarDateKey(event.end);
  if (!end || end < start) return start;
  // Date-only values are the existing editor's inclusive end dates. A timed
  // interval ending at midnight does not occupy the following calendar day.
  if (event.end?.includes("T")) {
    const timestamp = Date.parse(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(event.end)
        ? event.end
        : `${event.end}+09:00`,
    );
    if (Number.isFinite(timestamp)) {
      const lastDate = getKoreanDateKey(new Date(timestamp - 1));
      return lastDate > start ? lastDate : start;
    }
  }
  return end;
};

export const eventIncludesDate = (event: CalendarEvent, date: string) => {
  const start = calendarDateKey(event.start);
  const end = calendarEventEndDate(event);
  return Boolean(start && start <= date && (end > start ? end : start) >= date);
};

export const getWeekEvents = (events: CalendarEvent[], weekStart: string) => {
  const weekEnd = shiftCalendarDate(weekStart, 6);
  return events
    .filter((event) => {
      const start = calendarDateKey(event.start);
      const end = calendarEventEndDate(event);
      return Boolean(
        start && start <= weekEnd && (end > start ? end : start) >= weekStart,
      );
    })
    .sort((left, right) => {
      const leftDate = calendarDateKey(left.start);
      const rightDate = calendarDateKey(right.start);
      const visibleLeft = leftDate < weekStart ? weekStart : leftDate;
      const visibleRight = rightDate < weekStart ? weekStart : rightDate;
      return (
        visibleLeft.localeCompare(visibleRight) ||
        compareSchedulePeriod(left, right)
      );
    });
};
