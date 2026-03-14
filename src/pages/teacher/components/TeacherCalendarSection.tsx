import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { getScheduleCategoryMeta, useScheduleCategories } from '../../../lib/scheduleCategories';
import { CalendarEvent } from '../../../types';

interface TeacherCalendarSectionProps {
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    onDateDoubleClick: (dateStr: string) => void;
    onEventClick: (event: CalendarEvent) => void;
    onAddEvent: () => void;
    onSearchClick: () => void;
    calendarRef: React.RefObject<FullCalendar>;
    filterClass: string;
    onFilterChange: (cls: string) => void;
    selectedDate?: string | null;
}

type HolidayItem = { title: string; start: string; eventType?: 'holiday' };
type SchoolOption = { value: string; label: string };

const DEFAULT_2026_HOLIDAYS: HolidayItem[] = [
    { title: '신정', start: '2026-01-01', eventType: 'holiday' },
    { title: '설날 연휴', start: '2026-02-16', eventType: 'holiday' },
    { title: '설날', start: '2026-02-17', eventType: 'holiday' },
    { title: '설날 연휴', start: '2026-02-18', eventType: 'holiday' },
    { title: '삼일절', start: '2026-03-01', eventType: 'holiday' },
    { title: '삼일절 대체공휴일', start: '2026-03-02', eventType: 'holiday' },
    { title: '어린이날', start: '2026-05-05', eventType: 'holiday' },
    { title: '부처님오신날', start: '2026-05-24', eventType: 'holiday' },
    { title: '부처님오신날 대체공휴일', start: '2026-05-25', eventType: 'holiday' },
    { title: '현충일', start: '2026-06-06', eventType: 'holiday' },
    { title: '현충일 대체공휴일', start: '2026-06-08', eventType: 'holiday' },
    { title: '광복절', start: '2026-08-15', eventType: 'holiday' },
    { title: '광복절 대체공휴일', start: '2026-08-17', eventType: 'holiday' },
    { title: '추석 연휴', start: '2026-09-24', eventType: 'holiday' },
    { title: '추석', start: '2026-09-25', eventType: 'holiday' },
    { title: '추석 연휴', start: '2026-09-26', eventType: 'holiday' },
    { title: '추석 대체공휴일', start: '2026-09-28', eventType: 'holiday' },
    { title: '개천절', start: '2026-10-03', eventType: 'holiday' },
    { title: '개천절 대체공휴일', start: '2026-10-05', eventType: 'holiday' },
    { title: '한글날', start: '2026-10-09', eventType: 'holiday' },
    { title: '성탄절', start: '2026-12-25', eventType: 'holiday' },
];

const toExclusiveEnd = (start?: string, end?: string) => {
    if (!start || !end || end <= start) return undefined;
    const endDate = new Date(`${end}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    const offset = endDate.getTimezoneOffset() * 60000;
    return new Date(endDate.getTime() - offset).toISOString().split('T')[0];
};

const TeacherCalendarSection: React.FC<TeacherCalendarSectionProps> = ({
    events,
    onDateClick,
    onDateDoubleClick,
    onEventClick,
    onAddEvent,
    onSearchClick,
    calendarRef,
    filterClass,
    onFilterChange,
    selectedDate,
}) => {
    const { config } = useAuth();
    const { categories } = useScheduleCategories();
    const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [classOptions, setClassOptions] = useState<SchoolOption[]>(
        Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` }))
    );

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
            if (event.eventType === 'holiday') set.add(event.start);
        });
        return set;
    }, [events]);

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const snap = await getDoc(doc(db, 'site_settings', 'school_config'));
                if (!snap.exists()) return;
                const data = snap.data() as {
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                };
                const nextGrades = (data.grades || [])
                    .map((g) => ({ value: String(g?.value ?? '').trim(), label: String(g?.label ?? '').trim() }))
                    .filter((g) => g.value && g.label);
                const nextClasses = (data.classes || [])
                    .map((c) => ({ value: String(c?.value ?? '').trim(), label: String(c?.label ?? '').trim() }))
                    .filter((c) => c.value && c.label);
                if (nextGrades.length > 0) setGradeOptions(nextGrades);
                if (nextClasses.length > 0) setClassOptions(nextClasses);
            } catch (error) {
                console.error('Failed to load school config:', error);
            }
        };
        void loadSchoolConfig();
    }, []);

    const classTargets = gradeOptions.flatMap((gradeOpt) =>
        classOptions.map((classOpt) => ({
            value: `${gradeOpt.value}-${classOpt.value}`,
            label: `${gradeOpt.label} ${classOpt.label}`,
        }))
    );

    const formatEventTargetLabel = (event?: CalendarEvent) => {
        if (!event || event.eventType === 'holiday' || event.targetType === 'all' || event.targetType === 'common') {
            return '전체';
        }

        const [gradeValue, classValue] = String(event.targetClass || '').split('-');
        const gradeLabel = gradeOptions.find((item) => item.value === gradeValue)?.label || (gradeValue ? `${gradeValue}학년` : '');
        const classLabel = classOptions.find((item) => item.value === classValue)?.label || (classValue ? `${classValue}반` : '');
        return `${gradeLabel} ${classLabel}`.trim() || '전체';
    };

    const toLocalYmd = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
    };

    const loadHolidaySource = async (): Promise<HolidayItem[]> => {
        const byConfig = await getDoc(doc(db, 'site_settings', 'holidays_2026'));
        if (byConfig.exists()) {
            const data = byConfig.data() as { items?: HolidayItem[] };
            if (Array.isArray(data.items) && data.items.length > 0) {
                return data.items.map((it) => ({ ...it, eventType: 'holiday' }));
            }
        }
        return DEFAULT_2026_HOLIDAYS;
    };

    const populateHolidays = async () => {
        if (!config) return;
        if (!confirm('기존 공휴일을 초기화하고 다시 불러오시겠습니까?')) return;

        try {
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            const holidayQuery = query(collection(db, path), where('eventType', '==', 'holiday'));
            const holidaySnap = await getDocs(holidayQuery);

            const holidays = await loadHolidaySource();
            const batch = writeBatch(db);

            holidaySnap.forEach((item) => batch.delete(item.ref));
            holidays.forEach((holiday) => {
                const docId = `holiday_${holiday.start}_${holiday.title.replace(/\s+/g, '')}`;
                const ref = doc(db, path, docId);
                batch.set(ref, {
                    title: holiday.title,
                    start: holiday.start,
                    end: holiday.start,
                    eventType: 'holiday',
                    targetType: 'common',
                    targetClass: null,
                    description: '대한민국 공휴일',
                    updatedAt: new Date(),
                    createdAt: new Date(),
                });
            });

            await batch.commit();
            alert(`공휴일 ${holidays.length}건을 적용했습니다.`);
        } catch (error: any) {
            console.error(error);
            alert(`공휴일 적용 실패: ${error.message}`);
        }
    };

    return (
        <div className="flex h-full min-h-[500px] flex-col rounded-xl bg-white p-4 shadow-sm md:min-h-0">
            <div className="mb-2 flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
                <h2 className="whitespace-nowrap text-lg font-bold text-gray-800">
                    <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
                </h2>

                <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
                    <button
                        onClick={onSearchClick}
                        className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-gray-600 transition hover:text-blue-600"
                        title="검색"
                    >
                        <i className="fas fa-search"></i>
                    </button>

                    <select
                        value={filterClass}
                        onChange={(e) => onFilterChange(e.target.value)}
                        className="max-w-[120px] shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-sm text-gray-700 outline-none"
                    >
                        <option value="all">전체</option>
                        <option value="common">공통</option>
                        {classTargets.map((target) => (
                            <option key={target.value} value={target.value}>{target.label}</option>
                        ))}
                    </select>

                    <div className="ml-auto flex items-center gap-1 md:ml-2">
                        <button onClick={onAddEvent} className="whitespace-nowrap rounded-md bg-blue-600 px-2 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700">
                            <i className="fas fa-plus"></i> 추가
                        </button>
                        <button onClick={populateHolidays} className="whitespace-nowrap rounded-md bg-green-600 px-2 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-green-700" title="공휴일 불러오기">
                            <i className="fas fa-calendar-check"></i> 공휴일
                        </button>
                    </div>
                </div>
            </div>

            <div className="calendar-wrapper flex-1">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                    initialView="dayGridMonth"
                    locale="ko"
                    headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }}
                    buttonText={{ dayGridMonth: '달력', listMonth: '목록' }}
                    events={fcEvents}
                    dateClick={(arg) => onDateClick(arg.dateStr)}
                    dayCellDidMount={(arg) => {
                        arg.el.ondblclick = () => {
                            const dateStr = toLocalYmd(arg.date);
                            onDateClick(dateStr);
                            onDateDoubleClick(dateStr);
                        };
                    }}
                    eventClick={(arg) => onEventClick(arg.event.extendedProps as CalendarEvent)}
                    eventDidMount={(arg) => {
                        if (arg.view.type !== 'listMonth') return;
                        const event = arg.event.extendedProps as CalendarEvent;
                        const meta = getScheduleCategoryMeta(event?.eventType, categories);
                        const label = event?.eventType === 'holiday' ? '공휴일' : `${meta.emoji} ${meta.label}`;
                        const timeCell = arg.el.querySelector('.fc-list-event-time');
                        if (timeCell) timeCell.textContent = label;
                    }}
                    eventContent={(arg) => {
                        const event = arg.event.extendedProps as CalendarEvent;
                        const isHoliday = event?.eventType === 'holiday';
                        const eventTitle = String(arg.event.title || '').trim();
                        const safeTitle = eventTitle || (isHoliday ? '공휴일' : '일정');
                        const targetLabel = formatEventTargetLabel(event);

                        if (arg.view.type === 'listMonth') {
                            return (
                                <div className={`fc-list-row-grid ${isHoliday ? 'holiday-list-row-grid' : ''}`} title={`${safeTitle} | ${targetLabel}`}>
                                    <div className={`fc-list-title-cell ${isHoliday ? 'holiday-segment-title' : ''}`}>
                                        {safeTitle}
                                    </div>
                                    <div className="fc-list-target-cell">
                                        {targetLabel}
                                    </div>
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

            <style>{`
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
                .fc-daygrid-event.holiday-text-event .fc-event-title { color: #ffffff !important; font-weight: 800 !important; }
                .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
                .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
                .fc-list table { table-layout: fixed; }
                .fc-list-event-graphic {
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
                    width: 92px !important;
                    white-space: nowrap;
                    font-weight: 700;
                    color: #374151;
                    vertical-align: middle;
                    padding-right: 6px !important;
                }
                .fc-list-event-title {
                    width: auto;
                    padding-left: 0 !important;
                }
                .fc-list-event-title a {
                    display: block !important;
                    width: 100% !important;
                    text-align: left !important;
                }
                .fc-list-row-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    align-items: center;
                    gap: 6px;
                    width: 100%;
                }
                .fc-list-title-cell,
                .fc-list-target-cell {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .fc-list-title-cell {
                    font-weight: 700;
                    color: #111827;
                    text-align: left;
                    justify-self: stretch;
                }
                .fc-list-target-cell {
                    min-width: 68px;
                    max-width: 86px;
                    font-size: 0.86rem;
                    font-weight: 600;
                    color: #4b5563;
                    text-align: left;
                }
                .fc-daygrid-event .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
                .fc-list-event .holiday-segment-title { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            `}</style>
        </div>
    );
};

export default TeacherCalendarSection;
