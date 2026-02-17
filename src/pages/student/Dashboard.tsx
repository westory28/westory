import React, { useEffect, useState, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import { useAuth } from '../../contexts/AuthContext';
import { CalendarEvent } from '../../types';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import NoticeBoard from './components/NoticeBoard';
import CalendarSection from './components/CalendarSection';
import EventDetailPanel from './components/EventDetailPanel';
import SearchModal from './components/SearchModal';
import { getYearSemester } from '../../lib/semesterScope';

const normalizeClassValue = (value: unknown): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';
    const digits = normalized.match(/\d+/)?.[0] || '';
    if (!digits) return normalized;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(parsed);
};

const StudentDashboard: React.FC = () => {
    const { userData, config } = useAuth();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);
    const [welcomeText, setWelcomeText] = useState('학년/반 정보를 불러오는 중...');
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const calendarRef = useRef<FullCalendar>(null);

    // Initial welcome text
    useEffect(() => {
        if (!userData) return;
        const gradeLabel = normalizeClassValue(userData.grade);
        const classLabel = normalizeClassValue(userData.class);
        if (gradeLabel && classLabel) {
            setWelcomeText(`${gradeLabel}학년 ${classLabel}반의 대시보드`);
        } else {
            setWelcomeText(`${(userData.name || '이름 미설정').trim()}님의 대시보드`);
        }
    }, [userData]);

    // Fetch Events real-time
    useEffect(() => {
        const { year, semester } = getYearSemester(config);

        const path = `years/${year}/semesters/${semester}/calendar`;
        const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
            const gradeLabel = normalizeClassValue(userData?.grade);
            const classLabel = normalizeClassValue(userData?.class);
            const userClassStr = gradeLabel && classLabel ? `${gradeLabel}-${classLabel}` : null;
            const loadedEvents: CalendarEvent[] = [];

            snapshot.forEach(doc => {
                const d = doc.data();
                // Filter
                const isCommon = d.targetType === 'common';
                const isHoliday = d.eventType === 'holiday';
                const isMyClass = d.targetType === 'class' && d.targetClass === userClassStr;

                if (isCommon || isHoliday || isMyClass) {
                    loadedEvents.push({ id: doc.id, ...d } as CalendarEvent);
                    // Add color mapping here if needed, but handled in CalendarSection
                }
            });
            setEvents(loadedEvents);
        });

        return () => unsubscribe();
    }, [config, userData]);

    const handleDateClick = (dateStr: string) => {
        setSelectedDate(dateStr);
        const filtered = events.filter(e => {
            const start = new Date(e.start);
            const end = new Date(e.end || e.start);
            const target = new Date(dateStr);
            start.setHours(0, 0, 0, 0);
            end.setHours(0, 0, 0, 0);
            target.setHours(0, 0, 0, 0);
            return target >= start && target <= end;
        });
        setDailyEvents(filtered);
    };

    const handleEventClick = (event: CalendarEvent) => {
        // Logic to highlight date or open details?
        // Current dashboard opens detail modal for single event
        // But dashboard also has a side panel.
        // Let's reuse side panel.
        handleDateClick(event.start);
    };

    const handleSelectSearchResults = (dateStr: string) => {
        if (calendarRef.current) {
            calendarRef.current.getApi().gotoDate(dateStr);
            handleDateClick(dateStr);
        }
    };

    return (
        <div className="dashboard-container w-full max-w-7xl mx-auto px-4 py-6">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">
                        {welcomeText}
                    </h1>
                    {config && (
                        <span className="bg-blue-600 text-white font-bold px-3 py-1 rounded-full text-xs md:text-sm shadow-md shrink-0">
                            {config.year}학년도 {config.semester}학기
                        </span>
                    )}
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="flex flex-col md:grid md:grid-cols-5 md:grid-rows-2 gap-4 h-auto md:h-[calc(100vh-140px)] min-h-[500px]">

                {/* 1. Notice Board (Mobile: Order 1 / Desktop: Order 2, Right Top) */}
                <div className="order-1 md:order-2 md:col-span-2 md:row-span-1">
                    <NoticeBoard />
                </div>

                {/* 2. Calendar (Mobile: Order 2 / Desktop: Order 1, Left Full Height) */}
                <div className="order-2 md:order-1 md:col-span-3 md:row-span-2">
                    <CalendarSection
                        events={events}
                        onDateClick={handleDateClick}
                        onEventClick={handleEventClick}
                        onSearchClick={() => setIsSearchOpen(true)}
                        calendarRef={calendarRef}
                        selectedDate={selectedDate}
                    />
                </div>

                {/* 3. Event Details (Mobile: Order 3 / Desktop: Order 3, Right Bottom) */}
                <div className="order-3 md:order-3 md:col-span-2 md:row-span-1">
                    <EventDetailPanel selectedDate={selectedDate} events={dailyEvents} />
                </div>
            </div>

            <SearchModal
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelectEvent={handleSelectSearchResults}
            />
        </div>
    );
};

export default StudentDashboard;
