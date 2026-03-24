import React, { useState } from 'react';
import { getScheduleCategoryMeta } from '../../../lib/scheduleCategories';
import type { ScheduleCategory } from '../../../lib/scheduleCategories';
import { CalendarEvent } from '../../../types';

interface EventDetailPanelProps {
    categories: ScheduleCategory[];
    selectedDate: string | null;
    events: CalendarEvent[];
    onEventClick?: (event: CalendarEvent) => void;
}

const EventDetailPanel: React.FC<EventDetailPanelProps> = ({ categories, selectedDate, events, onEventClick }) => {
    const [detailModalEvent, setDetailModalEvent] = useState<CalendarEvent | null>(null);
    const isTeacherMode = !!onEventClick;

    const handleSelectEvent = (event: CalendarEvent) => {
        if (isTeacherMode) {
            onEventClick?.(event);
            return;
        }
        setDetailModalEvent(event);
    };

    const formatDateHeader = (dateStr: string) => {
        const dateObj = new Date(dateStr);
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        return (
            <span className="inline-flex items-center rounded-lg border-2 border-blue-300 bg-blue-50 px-3 py-1">
                <span className="text-lg font-extrabold text-blue-800">{dateObj.getMonth() + 1}월 {dateObj.getDate()}일</span>
                <span className="ml-1 text-sm font-bold text-blue-500">({days[dateObj.getDay()]})</span>
            </span>
        );
    };

    return (
        <div className="flex h-full min-h-[300px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
            <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                <h3 className="flex items-center text-lg font-bold text-gray-800">
                    <i className="fas fa-info-circle mr-2 text-blue-500"></i>일정 상세
                </h3>
                <span className="text-sm font-bold text-gray-500">
                    {selectedDate ? formatDateHeader(selectedDate) : '날짜를 선택하세요'}
                </span>
            </div>

            <div className="custom-scroll flex-1 overflow-y-auto pr-2">
                {!selectedDate ? (
                    <div className="flex h-full flex-col items-center justify-center text-gray-400">
                        <i className="far fa-calendar-check mb-3 text-4xl text-gray-200"></i>
                        <p className="text-center text-sm">달력에서 날짜 또는 일정을 클릭하면 상세 내용을 확인할 수 있습니다.</p>
                    </div>
                ) : events.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center text-gray-400">
                        <i className="far fa-calendar-times mb-2 text-3xl"></i>
                        <p className="text-sm">일정이 없습니다.</p>
                    </div>
                ) : (
                    events.map((event) => {
                        const isHoliday = event.eventType === 'holiday';
                        const categoryMeta = getScheduleCategoryMeta(event.eventType, categories);
                        const typeLabel = isHoliday ? '공휴일' : `${categoryMeta.emoji} ${categoryMeta.label}`;

                        if (isHoliday) {
                            return (
                                <div key={event.id} className="group mb-3 rounded-r-lg border-l-4 border-red-400 bg-red-50 p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">공휴일</span>
                                        <h4 className="text-sm font-bold text-red-700">{event.title}</h4>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={event.id}
                                className="group mb-3 cursor-pointer rounded-r-lg border-l-4 border-gray-200 bg-gray-50 p-3 transition hover:bg-gray-100"
                                onClick={() => handleSelectEvent(event)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleSelectEvent(event);
                                    }
                                }}
                                title={isTeacherMode ? '클릭하여 일정 수정' : '클릭하면 상세 일정 내용을 표시합니다'}
                            >
                                <div className="mb-1 flex items-center gap-2">
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: categoryMeta.color }}>
                                        {typeLabel}
                                    </span>
                                    <h4 className="text-sm font-bold text-gray-800">{event.title}</h4>
                                </div>
                                <p className="text-xs text-gray-500">
                                    {event.start}
                                    {event.end && event.start !== event.end ? ` ~ ${event.end}` : ''}
                                </p>
                            </div>
                        );
                    })
                )}
            </div>

            {!isTeacherMode && selectedDate && events.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="px-1 text-xs text-gray-400">일정 바를 클릭하면 상세 내용이 팝업으로 표시됩니다.</p>
                </div>
            )}

            {!isTeacherMode && detailModalEvent && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setDetailModalEvent(null)}
                >
                    <div
                        className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-100 p-4">
                            <h4 className="font-bold text-gray-900">일정 상세</h4>
                            <button
                                onClick={() => setDetailModalEvent(null)}
                                className="text-gray-400 transition hover:text-gray-700"
                                aria-label="팝업 닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="space-y-2 p-4">
                            <p className="text-sm font-bold text-gray-900">{detailModalEvent.title}</p>
                            <p className="text-xs text-gray-500">
                                {detailModalEvent.start}
                                {detailModalEvent.end && detailModalEvent.start !== detailModalEvent.end ? ` ~ ${detailModalEvent.end}` : ''}
                            </p>
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                                <p className="whitespace-pre-wrap text-sm text-gray-700">
                                    {detailModalEvent.description?.trim() || '상세 내용이 등록되지 않았습니다.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EventDetailPanel;
