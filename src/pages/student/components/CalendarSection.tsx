import React, { useEffect, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { CalendarEvent } from '../../../types';
// import '@fullcalendar/react/dist/vdom'; // Not needed for v6+

const EVENT_COLOR_MAP: Record<string, string> = {
    exam: '#ef4444',
    performance: '#f97316',
    event: '#10b981',
    diagnosis: '#3b82f6',
    formative: '#3b82f6',
};

const EVENT_LABEL_MAP: Record<string, string> = {
    holiday: '공휴일',
    exam: '정기시험',
    performance: '수행평가',
    event: '행사',
    diagnosis: '진단평가',
    formative: '형성평가',
};

const getEventTypeLabel = (eventType: unknown) => {
    const key = String(eventType || '').trim();
    return EVENT_LABEL_MAP[key] || '일정';
};

const toExclusiveEnd = (start?: string, end?: string) => {
    if (!start || !end || end <= start) return undefined;
    const endDate = new Date(`${end}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    const offset = endDate.getTimezoneOffset() * 60000;
    return new Date(endDate.getTime() - offset).toISOString().split('T')[0];
};

interface CalendarSectionProps {
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    onEventClick: (event: CalendarEvent) => void;
    onSearchClick: () => void;
    calendarRef: React.RefObject<FullCalendar>;
    selectedDate?: string | null;
}

const CalendarSection: React.FC<CalendarSectionProps> = ({
    events,
    onDateClick,
    onEventClick,
    onSearchClick,
    calendarRef,
    selectedDate,
}) => {

    // Convert logic for holidays to classNames or verify events structure
    // Since we pass pre-processed events from Dashboard, we can just use them.
    // However, FullCalendar events prop expects specific format.
    // We map our CalendarEvent to FullCalendar event object.

    const fcEvents = events.map(e => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: toExclusiveEnd(e.start, e.end),
        backgroundColor: e.eventType === 'holiday' ? '#ef4444' : (EVENT_COLOR_MAP[e.eventType] || '#6b7280'),
        borderColor: e.eventType === 'holiday' ? '#ef4444' : (EVENT_COLOR_MAP[e.eventType] || '#6b7280'),
        textColor: e.eventType === 'holiday' ? '#ffffff' : undefined,
        classNames: e.eventType === 'holiday' ? ['holiday-text-event'] : [],
        extendedProps: { ...e }
    }));

    const holidayDateSet = useMemo(() => {
        const set = new Set<string>();
        events.forEach((eventItem) => {
            if (eventItem.eventType === 'holiday') {
                set.add(String(eventItem.start).split('T')[0]);
            }
        });
        return set;
    }, [events]);

    const toLocalYmd = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
    };

    // Custom CSS for holiday text event
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
            .holiday-text-event .fc-event-title { color: #ffffff !important; font-size: 0.75rem; font-weight: 800; }
            .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700; }
            .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700; }
            .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
            .fc-day-holiday .fc-daygrid-day-number { color: #ef4444 !important; font-weight: 700 !important; }
            .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
            .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
            .holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
            .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
            .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    return (
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col min-h-[500px] md:min-h-0 h-full">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 gap-2">
                <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap">
                    <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
                </h2>
                <button
                    onClick={onSearchClick}
                    className="bg-gray-50 border border-gray-200 text-gray-600 hover:text-blue-600 p-1.5 rounded-lg transition"
                    title="일정 검색"
                >
                    <i className="fas fa-search"></i>
                </button>
            </div>
            <div className="flex-1 calendar-wrapper">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                    initialView="dayGridMonth"
                    locale="ko"
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth,listMonth'
                    }}
                    buttonText={{
                        dayGridMonth: '달력',
                        listMonth: '목록',
                    }}
                    events={fcEvents}
                    dateClick={(arg) => onDateClick(arg.dateStr)}
                    eventClick={(arg) => onEventClick(arg.event.extendedProps as CalendarEvent)}
                    eventDidMount={(arg) => {
                        if (arg.view.type !== 'listMonth') return;
                        const label = getEventTypeLabel(arg.event.extendedProps?.eventType);
                        const timeCell = arg.el.querySelector('.fc-list-event-time');
                        if (timeCell) {
                            timeCell.textContent = `${label} |`;
                        }
                    }}
                    eventContent={(arg) => {
                        const isHoliday = arg.event.extendedProps?.eventType === 'holiday';
                        const eventTitle = String(arg.event.title || '').trim();
                        const safeTitle = eventTitle || (isHoliday ? '공휴일' : '일정');

                        if (arg.view.type === 'listMonth') {
                            return (
                                <div className={`fc-segment-title ${isHoliday ? 'holiday-segment-title' : ''}`} title={safeTitle}>
                                    {safeTitle}
                                </div>
                            );
                        }

                        if (arg.view.type !== 'dayGridMonth') return undefined;
                        return (
                            <div
                                className={`fc-segment-title ${isHoliday ? 'holiday-segment-title' : ''}`}
                                title={isHoliday ? `공휴일 | ${safeTitle}` : safeTitle}
                            >
                                {isHoliday ? `공휴일 | ${safeTitle}` : safeTitle}
                            </div>
                        );
                    }}
                    height="100%"
                    contentHeight="100%"
                    dayMaxEvents={true}
                    fixedWeekCount={false}
                    showNonCurrentDates={false}
                    dayCellClassNames={(arg) => {
                        const dateStr = toLocalYmd(arg.date);
                        const classes: string[] = [];
                        if (holidayDateSet.has(dateStr)) classes.push('fc-day-holiday');
                        if (selectedDate === dateStr) classes.push('fc-day-selected');
                        return classes;
                    }}
                />
            </div>
        </div>
    );
};

export default CalendarSection;
