import React, { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { getScheduleCategoryMeta } from '../../../lib/scheduleCategories';
import type { ScheduleCategory } from '../../../lib/scheduleCategories';
import { CalendarEvent } from '../../../types';

const toExclusiveEnd = (start?: string, end?: string) => {
    if (!start || !end || end <= start) return undefined;
    const endDate = new Date(`${end}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    const offset = endDate.getTimezoneOffset() * 60000;
    return new Date(endDate.getTime() - offset).toISOString().split('T')[0];
};

interface CalendarSectionProps {
    categories: ScheduleCategory[];
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    onEventClick: (event: CalendarEvent) => void;
    onSearchClick: () => void;
    onAttendanceCheck: () => void;
    calendarRef: React.RefObject<FullCalendar>;
    selectedDate?: string | null;
    attendanceLoading?: boolean;
    attendanceChecked?: boolean;
    attendanceMessage?: string;
    attendanceDates?: string[];
    attendanceGoalText?: string;
}

const CalendarSection: React.FC<CalendarSectionProps> = ({
    categories,
    events,
    onDateClick,
    onEventClick,
    onSearchClick,
    onAttendanceCheck,
    calendarRef,
    selectedDate,
    attendanceLoading = false,
    attendanceChecked = false,
    attendanceMessage = '',
    attendanceDates = [],
    attendanceGoalText = '',
}) => {
    const [currentViewType, setCurrentViewType] = useState('dayGridMonth');
    const [visibleRange, setVisibleRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [listTopOffset, setListTopOffset] = useState(88);
    const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
    const attendanceDateSet = useMemo(() => new Set(attendanceDates), [attendanceDates]);

    const formatEventTargetLabel = (event?: CalendarEvent) => {
        if (!event || event.eventType === 'holiday' || event.targetType === 'all' || event.targetType === 'common') {
            return '전체';
        }
        const [gradeValue, classValue] = String(event.targetClass || '').split('-');
        if (!gradeValue || !classValue) return '전체';
        return `${gradeValue}학년 ${classValue}반`;
    };

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

    const formatDayHeading = (dateText: string) => {
        const parsed = new Date(`${dateText}T00:00:00`);
        return new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
        }).format(parsed);
    };

    const formatEventTitle = (event: CalendarEvent) => {
        const rawTitle = String(event.title || '').trim();
        if (rawTitle) return rawTitle;
        if (event.eventType === 'holiday') return '공휴일';
        return getScheduleCategoryMeta(event.eventType, categories).label || '일정';
    };

    const listRows = useMemo(() => {
        if (currentViewType !== 'listMonth' || !visibleRange.start || !visibleRange.end) return [];

        const filtered = events
            .filter((event) => String(event.start).split('T')[0] >= visibleRange.start && String(event.start).split('T')[0] < visibleRange.end)
            .sort((a, b) => {
                const aDate = String(a.start).split('T')[0];
                const bDate = String(b.start).split('T')[0];
                if (aDate !== bDate) return aDate.localeCompare(bDate);
                return a.title.localeCompare(b.title);
            });

        const grouped = new Map<string, CalendarEvent[]>();
        filtered.forEach((event) => {
            const key = String(event.start).split('T')[0];
            const current = grouped.get(key) || [];
            current.push(event);
            grouped.set(key, current);
        });

        return Array.from(grouped.entries()).map(([date, dateEvents]) => ({
            date,
            events: dateEvents,
        }));
    }, [currentViewType, events, visibleRange.end, visibleRange.start]);

    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .fc-header-toolbar {
                gap: 0.5rem 0.75rem;
                align-items: flex-start;
                flex-wrap: wrap;
            }
            .fc-toolbar-chunk {
                min-width: 0;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 0.35rem;
            }
            .fc-toolbar-title {
                font-size: clamp(1.55rem, 4vw, 2.2rem) !important;
                font-weight: 800;
                line-height: 1.05;
                letter-spacing: -0.04em;
                color: #111827;
            }
            @media (max-width: 640px) {
                .fc-header-toolbar {
                    align-items: stretch;
                }
                .fc-toolbar-chunk {
                    justify-content: flex-start;
                }
                .fc-toolbar-chunk:nth-child(2) {
                    order: -1;
                    width: 100%;
                }
                .fc-toolbar-title {
                    font-size: clamp(1.35rem, 5vw, 1.8rem) !important;
                }
            }
            .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
            .fc-daygrid-event.holiday-text-event .fc-event-title { color: #ffffff !important; font-size: 0.75rem; font-weight: 800; }
            .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700; }
            .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700; }
            .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
            .fc-day-holiday .fc-daygrid-day-number { color: #ef4444 !important; font-weight: 700 !important; }
            .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
            .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
            .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
            .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
            .fc-list table,
            .fc-list-table {
                table-layout: fixed !important;
                width: 100% !important;
            }
            .fc-list-event-graphic,
            .fc-list-event-time,
            .fc-list-event-dot {
                display: none !important;
                width: 0 !important;
                padding: 0 !important;
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
            .fc-list-event td {
                text-align: left !important;
            }
            .fc-list-event-title {
                width: 100% !important;
                padding: 0 !important;
                text-align: left !important;
            }
            .fc-list-event-title > a,
            .fc-list-event-title .fc-event-main {
                display: block !important;
                width: 100% !important;
                text-align: left !important;
            }
            .fc-list-row-grid {
                display: grid !important;
                grid-template-columns: 140px minmax(0, 1fr) 92px;
                align-items: center;
                gap: 12px;
                width: 100%;
                min-width: 0;
            }
            .fc-list-category-cell,
            .fc-list-title-cell,
            .fc-list-target-cell {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .fc-list-category-cell {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                color: #374151;
            }
            .fc-list-category-dot {
                display: inline-block;
                width: 14px;
                height: 14px;
                border-radius: 9999px;
                flex: 0 0 auto;
            }
            .fc-list-category-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .fc-list-title-cell {
                font-weight: 700;
                color: #111827;
            }
            .fc-list-target-cell {
                font-size: 0.86rem;
                font-weight: 600;
                color: #4b5563;
            }
            .fc-daygrid-event .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
            .fc-list-event .holiday-segment-title { color: #ef4444 !important; font-weight: 800 !important; }
            .custom-list-active .fc-view-harness {
                display: none !important;
            }
            .custom-schedule-list {
                height: calc(100% - 1px);
            }
            .fc-attendance-button {
                border-radius: 0.85rem !important;
                padding: 0.62rem 1rem !important;
                background-color: #f59e0b !important;
                border-color: #f59e0b !important;
                color: #ffffff !important;
                box-shadow: 0 12px 24px rgba(245, 158, 11, 0.22) !important;
            }
            .fc-attendance-button.fc-button:disabled,
            .fc-attendance-button.fc-button-primary:disabled {
                background-color: #fef3c7 !important;
                border-color: #fcd34d !important;
                color: #92400e !important;
                opacity: 1 !important;
                box-shadow: none !important;
            }
            .fc-attendance-goal {
                display: inline-flex;
                align-items: center;
                min-height: 2.7rem;
                border-radius: 9999px;
                border: 1px solid #fde68a;
                background: #fff7d6;
                color: #92400e;
                padding: 0.45rem 0.85rem;
                font-size: 0.78rem;
                font-weight: 800;
                letter-spacing: -0.01em;
                white-space: nowrap;
            }
            .fc-day-attendance .fc-daygrid-day-top::after {
                content: '출석';
                display: inline-flex;
                align-self: flex-start;
                border: 1px solid #ef4444;
                border-radius: 0.35rem;
                background: rgba(254, 242, 242, 0.9);
                color: #b91c1c;
                font-size: 0.68rem;
                font-weight: 800;
                line-height: 1;
                letter-spacing: -0.01em;
                padding: 0.16rem 0.42rem;
                white-space: nowrap;
            }
            .fc .fc-daygrid-day-top {
                display: flex;
                flex-direction: row;
                align-items: flex-start;
                justify-content: space-between;
                gap: 0.4rem;
                padding: 0.35rem 0.4rem 0 0.4rem;
                min-height: 1.9rem;
            }
            .fc .fc-daygrid-day-number {
                padding: 0 !important;
                font-weight: 800;
                text-align: left;
            }
            .fc .fc-daygrid-day-frame {
                display: flex;
                min-height: 100%;
                flex-direction: column;
            }
            .fc .fc-daygrid-day-events {
                margin-top: 0.25rem;
                padding: 0 0.28rem 0.35rem;
            }
            .fc .fc-daygrid-day.fc-day-today {
                background: rgba(219, 234, 254, 0.24) !important;
            }
            .fc .fc-scrollgrid-sync-table {
                height: 100% !important;
            }
            .fc .fc-daygrid-body,
            .fc .fc-scrollgrid-sync-table tbody,
            .fc .fc-scrollgrid-sync-table tr {
                height: 100%;
            }
            @media (max-width: 640px) {
                .fc-attendance-goal {
                    min-height: 2.45rem;
                    font-size: 0.72rem;
                    padding: 0.4rem 0.7rem;
                }
                .fc .fc-daygrid-day-top {
                    padding: 0.28rem 0.28rem 0 0.28rem;
                }
                .fc .fc-daygrid-day-top::after {
                    font-size: 0.62rem;
                    padding: 0.14rem 0.34rem;
                }
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    useEffect(() => {
        const updateListTopOffset = () => {
            const wrapper = calendarWrapperRef.current;
            if (!wrapper) return;
            const toolbar = wrapper.querySelector('.fc-header-toolbar') as HTMLElement | null;
            if (!toolbar) return;
            const wrapperRect = wrapper.getBoundingClientRect();
            const toolbarRect = toolbar.getBoundingClientRect();
            const nextOffset = Math.max(72, Math.round(toolbarRect.bottom - wrapperRect.top + 8));
            setListTopOffset(nextOffset);
        };

        const frameId = window.requestAnimationFrame(updateListTopOffset);
        window.addEventListener('resize', updateListTopOffset);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', updateListTopOffset);
        };
    }, [currentViewType, visibleRange.end, visibleRange.start]);

    useEffect(() => {
        const button = document.querySelector<HTMLButtonElement>('.fc-attendanceCheck-button');
        if (!button) return;
        button.disabled = attendanceLoading || attendanceChecked;
        button.classList.add('fc-attendance-button');
        button.title = attendanceMessage || '출석 체크';
        const toolbarChunk = button.closest('.fc-toolbar-chunk');
        if (!toolbarChunk) return;
        let goalLabel = toolbarChunk.querySelector<HTMLElement>('.fc-attendance-goal');
        if (!attendanceGoalText) {
            goalLabel?.remove();
            return;
        }
        if (!goalLabel) {
            goalLabel = document.createElement('span');
            goalLabel.className = 'fc-attendance-goal';
            toolbarChunk.insertBefore(goalLabel, button.nextSibling);
        }
        goalLabel.textContent = attendanceGoalText;
        goalLabel.title = attendanceGoalText;
    }, [attendanceChecked, attendanceGoalText, attendanceLoading, attendanceMessage]);

    return (
        <div className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-xl bg-white p-4 shadow-sm md:min-h-0">
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
            <div
                ref={calendarWrapperRef}
                className={`calendar-wrapper relative flex-1 min-h-0 overflow-hidden ${currentViewType === 'listMonth' ? 'custom-list-active' : ''}`}
            >
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                    initialView="dayGridMonth"
                    locale="ko"
                    allDayText=""
                    displayEventTime={false}
                    customButtons={{
                        attendanceCheck: {
                            text: attendanceChecked ? '오늘 출석 완료' : attendanceLoading ? '처리 중...' : '출석 체크',
                            click: onAttendanceCheck,
                        },
                    }}
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'attendanceCheck dayGridMonth,listMonth',
                    }}
                    buttonText={{
                        dayGridMonth: '달력',
                        listMonth: '목록',
                    }}
                    events={fcEvents}
                    datesSet={(arg) => {
                        setCurrentViewType(arg.view.type);
                        setVisibleRange({
                            start: toLocalYmd(arg.start),
                            end: toLocalYmd(arg.end),
                        });
                        window.setTimeout(() => {
                            const button = document.querySelector<HTMLButtonElement>('.fc-attendanceCheck-button');
                            if (!button) return;
                            button.disabled = attendanceLoading || attendanceChecked;
                            button.classList.add('fc-attendance-button');
                            button.title = attendanceMessage || '출석 체크';
                        }, 0);
                    }}
                    dateClick={(arg) => onDateClick(arg.dateStr)}
                    eventClick={(arg) => onEventClick(arg.event.extendedProps as CalendarEvent)}
                    eventContent={(arg) => {
                        const event = arg.event.extendedProps as CalendarEvent;
                        const isHoliday = event?.eventType === 'holiday';
                        const eventTitle = String(arg.event.title || '').trim();
                        const meta = getScheduleCategoryMeta(event?.eventType, categories);
                        const categoryLabel = isHoliday ? '공휴일' : meta.label;
                        const categoryColor = isHoliday ? '#ef4444' : meta.color;
                        const targetLabel = formatEventTargetLabel(event);
                        const safeTitle = eventTitle || (isHoliday ? '공휴일' : '일정');

                        if (arg.view.type === 'listMonth') {
                            return (
                                <div className="fc-list-row-grid" title={`${categoryLabel} | ${safeTitle} | ${targetLabel}`}>
                                    <div className="fc-list-category-cell">
                                        <span className="fc-list-category-dot" style={{ backgroundColor: categoryColor }}></span>
                                        <span className="fc-list-category-label">{categoryLabel}</span>
                                    </div>
                                    <div className={`fc-list-title-cell ${isHoliday ? 'holiday-segment-title' : ''}`}>{safeTitle}</div>
                                    <div className="fc-list-target-cell">{targetLabel}</div>
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
                    expandRows
                    dayMaxEvents
                    fixedWeekCount
                    showNonCurrentDates={false}
                    dayCellClassNames={(arg) => {
                        const dateStr = toLocalYmd(arg.date);
                        const classes: string[] = [];
                        if (holidayDateSet.has(dateStr)) classes.push('fc-day-holiday');
                        if (selectedDate === dateStr) classes.push('fc-day-selected');
                        if (attendanceDateSet.has(dateStr)) classes.push('fc-day-attendance');
                        return classes;
                    }}
                />
                {currentViewType === 'listMonth' && (
                    <div
                        className="custom-schedule-list absolute inset-x-0 overflow-y-auto rounded-b-xl border border-t-0 border-gray-200 bg-white"
                        style={{ top: `${listTopOffset}px`, height: `calc(100% - ${listTopOffset}px)` }}
                    >
                        {listRows.map((group) => (
                            <div key={group.date}>
                                <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-lg font-extrabold text-gray-900 first:border-t-0">
                                    {formatDayHeading(group.date)}
                                </div>
                                {group.events.map((event) => {
                                    const isHoliday = event.eventType === 'holiday';
                                    const meta = getScheduleCategoryMeta(event.eventType, categories);
                                    const categoryLabel = isHoliday ? '공휴일' : meta.label;
                                    const categoryColor = isHoliday ? '#ef4444' : meta.color;
                                    const eventTitle = formatEventTitle(event);
                                    const targetLabel = formatEventTargetLabel(event);

                                    return (
                                        <button
                                            key={event.id}
                                            type="button"
                                            onClick={() => onEventClick(event)}
                                            className="grid w-full cursor-pointer grid-cols-[170px_minmax(0,1fr)_116px] items-center gap-5 px-4 py-3 text-left transition hover:bg-slate-50"
                                        >
                                            <div className="flex min-w-0 items-center gap-2 font-bold text-gray-700">
                                                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor }}></span>
                                                <span className="truncate">{categoryLabel}</span>
                                            </div>
                                            <div
                                                className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold ${
                                                    isHoliday ? 'text-red-500' : 'text-gray-900'
                                                }`}
                                                title={eventTitle}
                                            >
                                                {eventTitle}
                                            </div>
                                            <div className="truncate text-sm font-semibold text-gray-600" title={targetLabel}>
                                                {targetLabel}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CalendarSection;
