import React from "react";
import { getScheduleCategoryMeta } from "../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../lib/scheduleCategories";
import { getSchedulePeriodLabel } from "../../lib/schedulePeriods";
import type { CalendarEvent } from "../../types";

interface ScheduleEventDetailModalProps {
  event: CalendarEvent | null;
  categories: ScheduleCategory[];
  onClose: () => void;
  onEdit?: (event: CalendarEvent) => void;
}

const ScheduleEventDetailModal: React.FC<ScheduleEventDetailModalProps> = ({
  event,
  categories,
  onClose,
  onEdit,
}) => {
  if (!event) return null;

  const isHoliday = event.eventType === "holiday";
  const categoryMeta = getScheduleCategoryMeta(event.eventType, categories);
  const categoryLabel = isHoliday ? "공휴일" : `${categoryMeta.emoji} ${categoryMeta.label}`;
  const categoryColor = isHoliday ? "#ef4444" : categoryMeta.color;
  const periodLabel = getSchedulePeriodLabel(event.startPeriod ?? event.period);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h4 className="text-lg font-extrabold text-gray-900">일정 상세</h4>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="닫기"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-extrabold text-white"
              style={{ backgroundColor: categoryColor }}
            >
              {categoryLabel}
            </span>
            <h3 className="mt-3 text-xl font-black leading-snug text-gray-900">
              {event.title}
            </h3>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start gap-3 text-sm">
              <i className="fas fa-calendar-day mt-1 text-blue-500"></i>
              <div>
                <div className="font-extrabold text-gray-800">일자</div>
                <div className="mt-0.5 font-semibold text-gray-600">
                  {event.start}
                  {event.end && event.start !== event.end ? ` ~ ${event.end}` : ""}
                  {!isHoliday && (
                    <span className="ml-2 font-extrabold text-blue-600">
                      {periodLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-4">
            <div className="mb-2 text-sm font-extrabold text-gray-800">메모</div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
              {event.description?.trim() || "상세 내용이 등록되지 않았습니다."}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          {onEdit && !isHoliday && (
            <button
              type="button"
              onClick={() => onEdit(event)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-700 hover:bg-blue-100"
            >
              수정
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-gray-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleEventDetailModal;
