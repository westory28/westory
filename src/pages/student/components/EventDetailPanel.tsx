import React, { useState } from 'react';
import { CalendarEvent } from '../../../types';

interface EventDetailPanelProps {
    selectedDate: string | null;
    events: CalendarEvent[];
    onEventClick?: (event: CalendarEvent) => void;
}

const COLOR_MAP: Record<string, string> = {
    exam: '#ef4444',
    performance: '#f97316',
    event: '#10b981',
    diagnosis: '#3b82f6',
    formative: '#3b82f6',
    holiday: 'transparent',
};

const TYPE_LABEL_MAP: Record<string, string> = {
    exam: '정기 시험',
    performance: '수행평가',
    event: '행사',
    diagnosis: '진단평가',
    formative: '형성평가',
    holiday: '공휴일',
};

const EventDetailPanel: React.FC<EventDetailPanelProps> = ({ selectedDate, events, onEventClick }) => {
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
            <span className="inline-flex items-center bg-blue-50 border-2 border-blue-300 rounded-lg px-3 py-1">
                <span className="text-lg font-extrabold text-blue-800">{dateObj.getMonth() + 1}월 {dateObj.getDate()}일</span>
                <span className="ml-1 text-sm font-bold text-blue-500">({days[dateObj.getDay()]})</span>
            </span>
        );
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col min-h-[300px] md:min-h-0 h-full">
            <div className="flex justify-between items-center mb-3 border-b border-gray-100 pb-2">
                <h3 className="text-lg font-bold text-gray-800 flex items-center">
                    <i className="fas fa-info-circle mr-2 text-blue-500"></i>일정 상세
                </h3>
                <span className="text-sm font-bold text-gray-500">
                    {selectedDate ? formatDateHeader(selectedDate) : '날짜를 선택하세요'}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scroll">
                {!selectedDate ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <i className="far fa-calendar-check text-4xl mb-3 text-gray-200"></i>
                        <p className="text-sm text-center">달력에서 날짜 또는 일정을 클릭하면 상세 내용을 확인할 수 있습니다.</p>
                    </div>
                ) : events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                        <i className="far fa-calendar-times text-3xl mb-2"></i>
                        <p className="text-sm">일정이 없습니다.</p>
                    </div>
                ) : (
                    events.map((event) => {
                        const isHoliday = event.eventType === 'holiday';
                        const bgColor = isHoliday ? 'transparent' : (COLOR_MAP[event.eventType] || '#999');
                        const typeLabel = TYPE_LABEL_MAP[event.eventType] || '일정';

                        if (isHoliday) {
                            return (
                                <div key={event.id} className="group p-3 border-l-4 border-red-400 bg-red-50 mb-3 rounded-r-lg">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-white px-1.5 py-0.5 rounded font-bold bg-red-500">공휴일</span>
                                        <h4 className="font-bold text-red-700 text-sm">{event.title}</h4>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={event.id}
                                className="group p-3 border-l-4 mb-3 rounded-r-lg transition cursor-pointer border-gray-200 bg-gray-50 hover:bg-gray-100"
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
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] text-white px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: bgColor }}>
                                        {typeLabel}
                                    </span>
                                    <h4 className="font-bold text-gray-800 text-sm">{event.title}</h4>
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
                    <p className="text-xs text-gray-400 px-1">일정 바를 클릭하면 상세 내용이 팝업으로 표시됩니다.</p>
                </div>
            )}

            {!isTeacherMode && detailModalEvent && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setDetailModalEvent(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b border-gray-100">
                            <h4 className="font-bold text-gray-900">일정 상세</h4>
                            <button
                                onClick={() => setDetailModalEvent(null)}
                                className="text-gray-400 hover:text-gray-700 transition"
                                aria-label="팝업 닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-4 space-y-2">
                            <p className="text-sm font-bold text-gray-900">{detailModalEvent.title}</p>
                            <p className="text-xs text-gray-500">
                                {detailModalEvent.start}
                                {detailModalEvent.end && detailModalEvent.start !== detailModalEvent.end ? ` ~ ${detailModalEvent.end}` : ''}
                            </p>
                            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">
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
