import React, { useEffect, useRef } from "react";
import { getScheduleCategoryMeta } from "../../lib/scheduleCategories";
import type { ScheduleCategory } from "../../lib/scheduleCategories";
import { getSchedulePeriodRangeLabel } from "../../lib/schedulePeriods";
import type { CalendarEvent } from "../../types";

interface ScheduleEventDetailModalProps {
  event: CalendarEvent | null;
  categories: ScheduleCategory[];
  onClose: () => void;
  onEdit?: (event: CalendarEvent) => void;
}

const formatEventTargetLabel = (event: CalendarEvent) => {
  if (
    event.eventType === "holiday" ||
    event.targetType === "all" ||
    event.targetType === "common"
  ) {
    return "전체 공통";
  }

  const [gradeValue, classValue] = String(event.targetClass || "").split("-");
  if (gradeValue && classValue) {
    return `${gradeValue}학년 ${classValue}반`;
  }

  return "반별 지정";
};

const ScheduleEventDetailModal: React.FC<ScheduleEventDetailModalProps> = ({
  event,
  categories,
  onClose,
  onEdit,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!event || !dialog) return;
    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [event]);

  if (!event) return null;

  const isHoliday = event.eventType === "holiday";
  const categoryMeta = getScheduleCategoryMeta(event.eventType, categories);
  const categoryLabel = isHoliday
    ? "공휴일"
    : `${categoryMeta.emoji} ${categoryMeta.label}`;
  const categoryColor = isHoliday ? "#ef4444" : categoryMeta.color;
  const periodLabel = getSchedulePeriodRangeLabel(
    event.startPeriod ?? event.period,
    event.endPeriod,
  );
  const targetLabel = formatEventTargetLabel(event);

  return (
    <dialog
      ref={dialogRef}
      className="schedule-event-detail-overlay fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
      onCancel={(cancelEvent) => {
        cancelEvent.preventDefault();
        onClose();
      }}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        onClose();
      }}
      aria-labelledby="schedule-event-detail-title"
    >
      <div
        className="schedule-event-detail-dialog mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <h4
            id="schedule-event-detail-title"
            className="text-lg font-extrabold text-gray-900"
          >
            일정 상세
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="닫기"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="custom-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
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

          <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start gap-3 text-sm">
              <i className="fas fa-calendar-day mt-1 text-blue-500"></i>
              <div>
                <div className="font-extrabold text-gray-800">일자</div>
                <div className="mt-0.5 font-semibold text-gray-600">
                  {event.start}
                  {event.end && event.start !== event.end
                    ? ` ~ ${event.end}`
                    : ""}
                  {!isHoliday && (
                    <span className="ml-2 font-extrabold text-blue-600">
                      {periodLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <i className="fas fa-users mt-1 text-blue-500"></i>
              <div>
                <div className="font-extrabold text-gray-800">대상</div>
                <div className="mt-0.5 font-semibold text-gray-600">
                  {targetLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-4">
            <div className="mb-2 text-sm font-extrabold text-gray-800">
              메모
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
              {event.description?.trim() || "상세 내용이 등록되지 않았습니다."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-4">
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
    </dialog>
  );
};

export default ScheduleEventDetailModal;
