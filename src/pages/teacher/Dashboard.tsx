import React, { useEffect, useState, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import { useAuth } from '../../contexts/AuthContext';
import { CalendarEvent } from '../../types';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import TeacherNoticeBoard from './components/TeacherNoticeBoard';
import TeacherCalendarSection from './components/TeacherCalendarSection';
import EventDetailPanel from '../student/components/EventDetailPanel'; // Reuse student panel for basic viewing
import SearchModal from '../student/components/SearchModal'; // Reuse search modal
import EventModal from './components/EventModal';
import { useScheduleCategories } from '../../lib/scheduleCategories';
import { getYearSemester } from '../../lib/semesterScope';

const getVisibleCalendarEvents = (events: CalendarEvent[], filterClass: string) => {
    return events.filter((event) => {
        const isCommon = event.targetType === 'common';
        const isHoliday = event.eventType === 'holiday';
        const targetClass = String(event.targetClass || '').trim();

        if (filterClass === 'all') return true;
        if (filterClass === 'common') return isCommon || isHoliday;

        return isCommon || isHoliday || (event.targetType === 'class' && targetClass === filterClass);
    });
};

const TeacherDashboard: React.FC = () => {
    const { config } = useAuth();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);

    // UI State
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>(undefined);
    const [modalInitialDate, setModalInitialDate] = useState('');
    const [filterClass, setFilterClass] = useState('all');

    const calendarRef = useRef<FullCalendar>(null);
    const { categories } = useScheduleCategories();

    // Fetch Events real-time
    useEffect(() => {
        const { year, semester } = getYearSemester(config);

        const path = `years/${year}/semesters/${semester}/calendar`;
        const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
            const loadedEvents: CalendarEvent[] = [];

            snapshot.forEach((doc) => {
                const d = doc.data();
                loadedEvents.push({ id: doc.id, ...d } as CalendarEvent);
            });
            setEvents(loadedEvents);
        });

        return () => unsubscribe();
    }, [config]);

    const availableClassTargets = useMemo(() => {
        const targets = new Set<string>();
        events.forEach((event) => {
            if (event.targetType !== 'class') return;
            const targetClass = String(event.targetClass || '').trim();
            if (!targetClass) return;
            targets.add(targetClass);
        });
        return Array.from(targets).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    }, [events]);

    const effectiveFilterClass = useMemo(() => {
        if (filterClass === 'all' || filterClass === 'common') return filterClass;
        return availableClassTargets.includes(filterClass) ? filterClass : 'all';
    }, [availableClassTargets, filterClass]);

    const visibleEvents = useMemo(
        () => getVisibleCalendarEvents(events, effectiveFilterClass),
        [effectiveFilterClass, events],
    );

    const handleDateClick = (dateStr: string) => {
        setSelectedDate(dateStr);
    };

    const handleEventClick = (event: CalendarEvent) => {
        setSelectedEvent(event);
        setIsEventModalOpen(true);
    };

    const handleAddEvent = (dateStr?: string) => {
        setSelectedEvent(undefined);
        setModalInitialDate(dateStr || selectedDate || new Date().toISOString().split('T')[0]);
        setIsEventModalOpen(true);
    };

    const handleSelectSearchResults = (dateStr: string) => {
        if (calendarRef.current) {
            calendarRef.current.getApi().gotoDate(dateStr);
            handleDateClick(dateStr);
        }
    };

    useEffect(() => {
        if (!selectedDate) {
            setDailyEvents([]);
            return;
        }

        const filtered = visibleEvents.filter((event) => {
            const start = new Date(event.start);
            const end = new Date(event.end || event.start);
            const target = new Date(selectedDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(0, 0, 0, 0);
            target.setHours(0, 0, 0, 0);
            return target >= start && target <= end;
        });

        setDailyEvents(filtered);
    }, [selectedDate, visibleEvents]);

    return (
        <div className="dashboard-container w-full max-w-7xl mx-auto px-4 py-6 flex-1">
                <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">
                            대시보드
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
                        <TeacherNoticeBoard />
                    </div>

                    {/* 2. Calendar (Mobile: Order 2 / Desktop: Order 1, Left Full Height) */}
                    <div className="order-2 md:order-1 md:col-span-3 md:row-span-2">
                        <TeacherCalendarSection
                            events={visibleEvents}
                            onDateClick={handleDateClick}
                            onDateDoubleClick={handleAddEvent}
                            onEventClick={handleEventClick}
                            onAddEvent={handleAddEvent}
                            onSearchClick={() => setIsSearchOpen(true)}
                            calendarRef={calendarRef}
                            filterClass={effectiveFilterClass}
                            availableClassTargets={availableClassTargets}
                            onFilterChange={setFilterClass}
                            selectedDate={selectedDate}
                        />
                    </div>

                    {/* 3. Event Details (Mobile: Order 3 / Desktop: Order 3, Right Bottom) */}
                    <div className="order-3 md:order-3 md:col-span-2 md:row-span-1">
                        <div className="min-h-[260px] h-full">
                            <EventDetailPanel
                                categories={categories}
                                selectedDate={selectedDate}
                                events={dailyEvents}
                                onEventClick={handleEventClick}
                            />
                        </div>
                    </div>
                </div>

                <SearchModal
                    categories={categories}
                    isOpen={isSearchOpen}
                    onClose={() => setIsSearchOpen(false)}
                    onSelectEvent={handleSelectSearchResults}
                />

                <EventModal
                    isOpen={isEventModalOpen}
                    onClose={() => setIsEventModalOpen(false)}
                    eventData={selectedEvent}
                    initialDate={modalInitialDate}
                    onSave={() => { /* Real-time updates handle refresh */ }}
                />
        </div>
    );
};

export default TeacherDashboard;
