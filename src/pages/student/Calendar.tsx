import React, { useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

interface CalendarEvent {
    id: string;
    title: string;
    start: string; // ISO string YYYY-MM-DD
    end?: string;
    eventType: 'exam' | 'performance' | 'event' | 'diagnosis' | 'formative' | 'holiday';
    targetType: 'common' | 'class';
    targetClass?: string;
    description?: string;
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    classNames?: string[];
}

const Calendar = () => {
    const { user } = useAuth();
    const [events, setEvents] = useState<any[]>([]);
    const [userClass, setUserClass] = useState<string | null>(null);
    const [currentConfig, setCurrentConfig] = useState<{ year: string; semester: string } | null>(null);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

    const colorMap: { [key: string]: string } = {
        'exam': '#ef4444',       // Red
        'performance': '#f97316', // Orange
        'event': '#10b981',       // Green
        'diagnosis': '#3b82f6',   // Blue
        'formative': '#3b82f6'    // Blue
    };

    const typeLabelMap: { [key: string]: string } = {
        'exam': '정기 시험',
        'performance': '수행평가',
        'event': '행사',
        'diagnosis': '진단평가',
        'formative': '형성평가'
    };

    const toLocalYmd = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
    };

    const holidayDateSet = useMemo(() => {
        const set = new Set<string>();
        events.forEach((eventItem: any) => {
            const date = String(eventItem.start || '').split('T')[0];
            const title = String(eventItem.title || '');
            const isHolidayEvent =
                eventItem.classNames?.includes('holiday-text-event') ||
                eventItem.extendedProps?.eventType === 'holiday' ||
                /공휴일|대체공휴일/.test(title);

            if (date && isHolidayEvent) {
                set.add(date);
            }
        });
        return set;
    }, [events]);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const configDoc = await getDoc(doc(db, 'site_settings', 'config'));
                if (configDoc.exists()) {
                    setCurrentConfig(configDoc.data() as { year: string; semester: string });
                }
            } catch (error) {
                console.error("Error fetching config:", error);
            }
        };
        fetchConfig();
    }, []);

    useEffect(() => {
        if (!user) return;
        const loadUserClass = async () => {
            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    const d = userDoc.data();
                    if (d.grade && d.class) {
                        setUserClass(`${d.grade}-${d.class}`);
                    }
                }
            } catch (error) {
                console.error("Error loading user class:", error);
            }
        };
        loadUserClass();
    }, [user]);

    useEffect(() => {
        if (!currentConfig || !userClass) return;

        const fetchEvents = async () => {
            // Path: years/{year}/calendar
            const calRef = collection(db, 'years', currentConfig.year, 'calendar');
            // Fetch all events for the year (optimization: filtering by date range)
            // For simplicity in this migration, we fetch all and filter in memory or let FullCalendar handle it via event sources if strictly needed.
            // But Firestore doesn't support complex OR queries well for "common OR class".
            // So we fetch all and filter.

            try {
                const snap = await getDocs(calRef);
                const loadedEvents: any[] = [];

                snap.forEach(doc => {
                    const d = doc.data() as CalendarEvent;
                    d.id = doc.id;

                    let isVisible = false;
                    if (d.targetType === 'common') isVisible = true;
                    // Check if targetClass matches userClass (e.g. "2-3" matches "2-3")
                    else if (d.targetType === 'class' && d.targetClass === userClass) isVisible = true;

                    if (isVisible) {
                        const isHoliday = d.eventType === 'holiday';
                        loadedEvents.push({
                            id: d.id,
                            title: d.title,
                            start: d.start,
                            end: d.end || d.start,
                            backgroundColor: isHoliday ? 'transparent' : (colorMap[d.eventType] || '#6b7280'),
                            borderColor: isHoliday ? 'transparent' : (colorMap[d.eventType] || '#6b7280'),
                            textColor: isHoliday ? '#ef4444' : undefined,
                            classNames: isHoliday ? ['holiday-text-event'] : [],
                            extendedProps: d // Store full data
                        });
                    }
                });
                setEvents(loadedEvents);

            } catch (e) {
                console.error("Error fetching events:", e);
            }
        };

        fetchEvents();
    }, [currentConfig, userClass]);

    const handleEventClick = (info: any) => {
        const props = info.event.extendedProps.extendedProps; // Inherited from above structure
        if (props.eventType === 'holiday') return; // Skip holidays
        setSelectedEvent(props);
        setModalOpen(true);
    };

    const handleDateClick = (arg: any) => {
        setSelectedDate(arg.dateStr);
    };

    return (
        <div className="bg-gray-50 flex flex-col min-h-screen">
            <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 h-full flex flex-col">
                <div className="mb-4 shrink-0">
                    <h1 className="text-2xl font-bold text-gray-800"><i className="fas fa-calendar-check text-green-500 mr-2"></i>학사 일정</h1>
                    <p className="text-sm text-gray-500 mt-1">우리 반의 주요 일정과 평가 계획을 확인하세요.</p>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 md:p-6 flex flex-col relative min-h-[600px]">
                    <div className="flex items-center gap-4 mb-4 text-xs font-bold text-gray-500 justify-end">
                        <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-red-500 mr-1"></span>정기 시험</div>
                        <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-orange-500 mr-1"></span>수행평가</div>
                        <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-blue-500 mr-1"></span>진단/형성</div>
                        <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-green-500 mr-1"></span>행사</div>
                    </div>

                    <div className="flex-1 calendar-wrapper">
                        <FullCalendar
                            plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
                            initialView="dayGridMonth"
                            locale="ko"
                            headerToolbar={{
                                left: 'prev,next today',
                                center: 'title',
                                right: 'dayGridMonth,listMonth'
                            }}
                            events={events}
                            dateClick={handleDateClick}
                            eventClick={handleEventClick}
                            height="auto" // Allow it to grow
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
            </main>

            {/* Detail Modal */}
            {modalOpen && selectedEvent && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4 relative transform transition-all scale-100" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-4">
                            <span
                                className="px-2 py-1 rounded text-xs font-bold text-white inline-block mb-2"
                                style={{ backgroundColor: colorMap[selectedEvent.eventType] || '#6b7280' }}
                            >
                                {typeLabelMap[selectedEvent.eventType] || '일정'}
                            </span>
                            <h3 className="text-xl font-bold text-gray-900 leading-tight">{selectedEvent.title}</h3>
                        </div>

                        <div className="space-y-3 text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6">
                            <div className="flex items-start gap-3">
                                <i className="fas fa-clock mt-1 text-blue-500"></i>
                                <div>
                                    <p className="font-bold text-gray-800">기간</p>
                                    <p>{selectedEvent.start} {selectedEvent.end && selectedEvent.end !== selectedEvent.start ? `~ ${selectedEvent.end}` : ''}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <i className="fas fa-align-left mt-1 text-blue-500"></i>
                                <div>
                                    <p className="font-bold text-gray-800">상세 내용</p>
                                    <p className="whitespace-pre-wrap leading-relaxed">{selectedEvent.description || '-'}</p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setModalOpen(false)}
                            className="w-full bg-gray-800 text-white font-bold py-3 rounded-xl hover:bg-gray-900 transition"
                        >
                            닫기
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
                .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
                .fc-daygrid-event { cursor: pointer; border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; font-weight: 600; border: none; }
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday .fc-daygrid-day-number { color: #ef4444 !important; font-weight: 700 !important; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
                .holiday-text-event { background-color: transparent !important; border: none !important; }
                .holiday-text-event .fc-event-title { color: #ef4444; font-size: 0.75rem; font-weight: 800; }
            `}</style>
        </div>
    );
};

export default Calendar;
