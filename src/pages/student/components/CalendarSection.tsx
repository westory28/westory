import React, { useEffect, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { getScheduleCategoryMeta, useScheduleCategories } from '../../../lib/scheduleCategories';
import { CalendarEvent } from '../../../types';

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
    const { categories } = useScheduleCategories();

    const fcEvents = events.map((event) => {
        const meta = getScheduleCategoryMeta(event.eventType, categories);
        const isHoliday = event.eventType === 'holiday';

        return {
            id: event.id,
            title: event.title,
            start: event.start,
            end: toExclusiveEnd(event.start, event.end),
            backgroundColor: isHoliday ? '#ef4444' : meta.color,
            borderColor: isHoliday ? '#ef4444' : meta.color,
            textColor: isHoliday ? '#ffffff' : undefined,
            classNames: isHoliday ? ['holiday-text-event'] : [],
            extendedProps: { ...event },
        };
    });

    const holidayDateSet = useMemo(() => {
        const set = new Set<string>();
        events.forEach((event) => {
            if (event.eventType === 'holiday') set.add(String(event.start).split('T')[0]);
        });
        return set;
    }, [events]);

    const toLocalYmd = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
    };

    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
            .fc-daygrid-event.holiday-text-event .fc-event-title { color: #ffffff !important; font-size: 0.75rem; font-weight: 800; }
            .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700; }
            .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700; }
            .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
            .fc-day-holiday .fc-daygrid-day-number { color: #ef4444 !important; font-weight: 700 !important; }
            .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
            .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
            .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
            .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
            .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
            .fc-list table,
            .fc-list-table {
                table-layout: fixed !important;
                width: 100% !important;
            }
            .fc-list-event-graphic {
                display: none !important;
                width: 0 !important;
                padding: 0 !important;
            }
            .fc-list-event-dot {
                display: none !important;
            }
            .fc-list-day-cushion {
                display: flex !important;
                justify-content: flex-start !important;
                align-items: center;
                gap: 12px;
            }
            .fc-list-day-text,
            .fc-list-day-side-text {
                float: none !important;
            }
            .fc-list-event-time {
                display: none !important;
            }
            .fc-list-event-title {
                width: auto;
                padding: 0 !important;
                text-align: left !important;
            }
            .fc-list-event td {
                text-align: left !important;
            }
            .fc-list-event-title > a {
                display: block !important;
                width: 100% !important;
                text-align: left !important;
            }
            .fc-list-event-title .fc-event-main {
                display: block !important;
                width: 100% !important;
            }
            .fc-list-row-grid {
                display: grid !important;
                grid-template-columns: 92px minmax(0, 1fr);
                gap: 8px;
                width: 100%;
                min-width: 0;
                align-items: center;
            }
            .fc-list-category-cell,
            .fc-list-title-cell {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .fc-list-category-cell {
                font-weight: 700;
                color: #374151;
            }
            .fc-list-title-cell {
                font-weight: 700;
                text-align: left;
            }
            .fc-daygrid-event .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
            .fc-list-event .holiday-segment-title { color: #ef4444 !important; font-weight: 800 !important; }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    return (
        <div className="flex h-full min-h-[500px] flex-col rounded-xl bg-white p-4 shadow-sm md:min-h-0">
            <div className="mb-2 flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
                <h2 className="whitespace-nowrap text-lg font-bold text-gray-800">
                    <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
                </h2>
                <button
                    onClick={onSearchClick}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-gray-600 transition hover:text-blue-600"
                    title="일정 검색"
                >
                    <i className="fas fa-search"></i>
                </button>
            </div>
            <div className="calendar-wrapper flex-1">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                    initialView="dayGridMonth"
                    locale="ko"
                    allDayText=""
                    displayEventTime={false}
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth,listMonth',
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
                        const meta = getScheduleCategoryMeta(arg.event.extendedProps?.eventType, categories);
                        const label = arg.event.extendedProps?.eventType === 'holiday' ? '공휴일' : `${meta.emoji} ${meta.label}`;
                        const timeCell = arg.el.querySelector('.fc-list-event-time');
                        if (timeCell) timeCell.textContent = `${label} |`;
                    }}
                    eventContent={(arg) => {
                        const isHoliday = arg.event.extendedProps?.eventType === 'holiday';
                        const eventTitle = String(arg.event.title || '').trim();
                        const meta = getScheduleCategoryMeta(arg.event.extendedProps?.eventType, categories);
                        const categoryLabel = arg.event.extendedProps?.eventType === 'holiday' ? '공휴일' : `${meta.emoji} ${meta.label}`;
                        const safeTitle = eventTitle || (isHoliday ? '공휴일' : '일정');

                        if (arg.view.type === 'listMonth') {
                            return (
                                <div className="fc-list-row-grid" title={safeTitle}>
                                    <div className="fc-list-category-cell">{categoryLabel}</div>
                                    <div className={`fc-list-title-cell ${isHoliday ? 'holiday-segment-title' : ''}`}>{safeTitle}</div>
                                </div>
                            );
                        }

                        if (arg.view.type !== 'dayGridMonth') return undefined;
                        return (
                            <div className={`fc-segment-title ${isHoliday ? 'holiday-segment-title' : ''}`} title={safeTitle}>
                                {safeTitle}
                            </div>
                        );
                    }}
                    height="100%"
                    contentHeight="100%"
                    dayMaxEvents
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
