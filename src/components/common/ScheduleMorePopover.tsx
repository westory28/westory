import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  compareCalendarSchedule,
  getSchedulePeriodLabel,
} from "../../lib/schedulePeriods";
import { getScheduleCategoryMeta } from "../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../lib/scheduleCategories";
import type { CalendarEvent } from "../../types";

export interface ScheduleMorePopoverAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface ScheduleMorePopoverProps {
  date: string;
  anchorRect: ScheduleMorePopoverAnchor;
  events: CalendarEvent[];
  categories: ScheduleCategory[];
  hideHolidays?: boolean;
  onClose: () => void;
  onEventClick: (event: CalendarEvent) => void;
}

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 12;

const toDateKey = (value?: string) =>
  String(value || "")
    .split("T")[0]
    .trim();

const eventOccursOnDate = (event: CalendarEvent, date: string) => {
  const start = toDateKey(event.start);
  if (!start) return false;
  const end = toDateKey(event.end) || start;
  return start <= date && date <= end;
};

const formatDateTitle = (date: string) => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
};

const formatTargetLabel = (event: CalendarEvent) => {
  if (
    event.eventType === "holiday" ||
    event.targetType === "all" ||
    event.targetType === "common"
  ) {
    return "전체 공통";
  }

  const [gradeValue, classValue] = String(event.targetClass || "").split("-");
  if (gradeValue && classValue) return `${gradeValue}학년 ${classValue}반`;
  return "반별 지정";
};

const getPopoverPosition = (anchorRect: ScheduleMorePopoverAnchor) => {
  if (typeof window === "undefined") {
    return { left: anchorRect.left, top: anchorRect.bottom + 8 };
  }

  const width = Math.min(
    POPOVER_WIDTH,
    window.innerWidth - VIEWPORT_MARGIN * 2,
  );
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_MARGIN),
    Math.max(maxLeft, VIEWPORT_MARGIN),
  );

  const belowTop = anchorRect.bottom + 8;
  const aboveTop = anchorRect.top - POPOVER_MAX_HEIGHT - 8;
  const top =
    belowTop + POPOVER_MAX_HEIGHT > window.innerHeight - VIEWPORT_MARGIN &&
    aboveTop > VIEWPORT_MARGIN
      ? aboveTop
      : Math.min(
          belowTop,
          Math.max(
            VIEWPORT_MARGIN,
            window.innerHeight - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN,
          ),
        );

  return { left, top, width };
};

const ScheduleMorePopover: React.FC<ScheduleMorePopoverProps> = ({
  date,
  anchorRect,
  events,
  categories,
  hideHolidays = false,
  onClose,
  onEventClick,
}) => {
  const dayEvents = useMemo(
    () =>
      events
        .filter((event) => !hideHolidays || event.eventType !== "holiday")
        .filter((event) => eventOccursOnDate(event, date))
        .sort(compareCalendarSchedule),
    [date, events, hideHolidays],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const position = getPopoverPosition(anchorRect);

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[9997] cursor-default bg-transparent"
        aria-label="일정 더보기 닫기"
        onClick={onClose}
      />
      <section
        className="fixed z-[9998] overflow-hidden rounded-xl border border-blue-100 bg-white shadow-2xl shadow-slate-900/18 ring-1 ring-slate-900/5"
        style={{
          left: position.left,
          top: position.top,
          width: position.width ?? POPOVER_WIDTH,
          maxWidth: "calc(100vw - 24px)",
        }}
        role="dialog"
        aria-label={`${formatDateTitle(date)} 일정 더보기`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-blue-50/70 px-4 py-3">
          <div>
            <div className="text-sm font-black text-slate-900">
              {formatDateTitle(date)}
            </div>
            <div className="mt-0.5 text-xs font-bold text-blue-600">
              {dayEvents.length}개 일정
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
            aria-label="닫기"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <div
          className="custom-scroll max-h-[300px] space-y-2 overflow-y-auto p-3"
          data-testid="schedule-more-popover-list"
        >
          {dayEvents.map((event) => {
            const isHoliday = event.eventType === "holiday";
            const meta = getScheduleCategoryMeta(event.eventType, categories);
            const categoryLabel = isHoliday ? "공휴일" : meta.label;
            const categoryColor = isHoliday ? "#ef4444" : meta.color;
            const periodLabel = getSchedulePeriodLabel(
              event.startPeriod ?? event.period,
            );
            const targetLabel = formatTargetLabel(event);
            const title = String(event.title || categoryLabel).trim();

            return (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  onEventClick(event);
                  onClose();
                }}
                className="group w-full rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-blue-200 hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-flex max-w-[96px] shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-black text-white"
                    style={{ backgroundColor: categoryColor }}
                    title={categoryLabel}
                  >
                    <span className="truncate">{categoryLabel}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-900 group-hover:text-blue-700">
                    {title}
                  </span>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-500">
                  {!isHoliday && (
                    <>
                      <span className="text-blue-600">{periodLabel}</span>
                      <span className="text-slate-300">·</span>
                    </>
                  )}
                  <span className="truncate">{targetLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>,
    document.body,
  );
};

export default ScheduleMorePopover;
