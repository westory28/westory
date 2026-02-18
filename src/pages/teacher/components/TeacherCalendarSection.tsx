import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { CalendarEvent } from '../../../types';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';

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

const TeacherCalendarSection: React.FC<TeacherCalendarSectionProps> = ({
    events, onDateClick, onDateDoubleClick, onEventClick, onAddEvent, onSearchClick, calendarRef, filterClass, onFilterChange, selectedDate,
}) => {
    const { config } = useAuth();
    const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [classOptions, setClassOptions] = useState<SchoolOption[]>(
        Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` }))
    );

    const fcEvents = events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        backgroundColor: e.eventType === 'holiday' ? 'transparent' : (EVENT_COLOR_MAP[e.eventType] || '#6b7280'),
        borderColor: e.eventType === 'holiday' ? 'transparent' : (EVENT_COLOR_MAP[e.eventType] || '#6b7280'),
        textColor: e.eventType === 'holiday' ? '#ef4444' : undefined,
        classNames: e.eventType === 'holiday' ? ['holiday-text-event'] : [],
        extendedProps: { ...e },
    }));

    const holidayDateSet = useMemo(() => {
        const set = new Set<string>();
        events.forEach((eventItem) => {
            if (eventItem.eventType === 'holiday') {
                set.add(eventItem.start);
            }
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

            holidaySnap.forEach((snap) => batch.delete(snap.ref));
            holidays.forEach((h) => {
                const docId = `holiday_${h.start}_${h.title.replace(/\s+/g, '')}`;
                const ref = doc(db, path, docId);
                batch.set(ref, {
                    title: h.title,
                    start: h.start,
                    end: h.start,
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
        } catch (e: any) {
            console.error(e);
            alert(`공휴일 적용 실패: ${e.message}`);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col min-h-[500px] md:min-h-0 h-full">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 gap-2">
                <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap">
                    <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
                </h2>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                    <button onClick={onSearchClick} className="bg-gray-50 border border-gray-200 text-gray-600 hover:text-blue-600 p-1.5 rounded-lg transition shrink-0" title="검색">
                        <i className="fas fa-search"></i>
                    </button>

                    <select
                        value={filterClass}
                        onChange={(e) => onFilterChange(e.target.value)}
                        className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg p-1.5 outline-none shrink-0 max-w-[100px]"
                    >
                        <option value="all">전체</option>
                        <option value="common">공통</option>
                        {classTargets.map((target) => (
                            <option key={target.value} value={target.value}>{target.label}</option>
                        ))}
                    </select>

                    <div className="flex items-center gap-1 ml-auto md:ml-2">
                        <button onClick={onAddEvent} className="bg-blue-600 text-white px-2 py-1.5 rounded-md text-xs font-bold hover:bg-blue-700 shadow-sm transition whitespace-nowrap">
                            <i className="fas fa-plus"></i> 추가
                        </button>
                        <button onClick={populateHolidays} className="bg-green-600 text-white px-2 py-1.5 rounded-md hover:bg-green-700 transition shadow-sm text-xs font-bold whitespace-nowrap" title="공휴일 불러오기">
                            <i className="fas fa-calendar-check"></i> 공휴일
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 calendar-wrapper">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                    initialView="dayGridMonth"
                    locale="ko"
                    headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }}
                    buttonText={{
                        dayGridMonth: '달력',
                        listMonth: '목록',
                    }}
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
                        const label = getEventTypeLabel(arg.event.extendedProps?.eventType);
                        const timeCell = arg.el.querySelector('.fc-list-event-time');
                        if (timeCell) {
                            timeCell.textContent = `${label} |`;
                        }
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
                .holiday-text-event { background-color: transparent !important; border: none !important; }
                .holiday-text-event .fc-event-title { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            `}</style>
        </div>
    );
};

export default TeacherCalendarSection;
