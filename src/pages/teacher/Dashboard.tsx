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

const TeacherDashboard: React.FC = () => {
    const { userData, config } = useAuth();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);
    const [welcomeText, setWelcomeText] = useState('교사 대시보드');

    // UI State
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>(undefined);
    const [modalInitialDate, setModalInitialDate] = useState('');
    const [filterClass, setFilterClass] = useState('all');

    const calendarRef = useRef<FullCalendar>(null);

    // Initial welcome text
    useEffect(() => {
        if (userData) {
            setWelcomeText(`${userData.name || '선생님'}의 대시보드`);
        }
    }, [userData]);

    // Fetch Events real-time
    useEffect(() => {
        if (!config || !config.year || !config.semester) return;

        const path = `years/${config.year}/semesters/${config.semester}/calendar`;
        const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
            const loadedEvents: CalendarEvent[] = [];

            snapshot.forEach(doc => {
                const d = doc.data();
                // Client-side filtering based on 'filterClass' state
                // Common events always show. Holiday always show.
                // Class events show if filterClass is 'all' OR matches targetClass

                const isCommon = d.targetType === 'common';
                const isHoliday = d.eventType === 'holiday';
                const isTargetClass = d.targetType === 'class' && d.targetClass === filterClass;

                let shouldShow = false;
                if (filterClass === 'all') shouldShow = true;
                else if (filterClass === 'common') shouldShow = (isCommon || isHoliday);
                else shouldShow = (isCommon || isHoliday || isTargetClass);

                if (shouldShow) {
                    loadedEvents.push({ id: doc.id, ...d } as CalendarEvent);
                }
            });
            setEvents(loadedEvents);
        });

        return () => unsubscribe();
    }, [config, filterClass]);

    const handleDateClick = (dateStr: string) => {
        setSelectedDate(dateStr);
        const filtered = events.filter(e => {
            if (!e.end) return e.start === dateStr;
            const start = new Date(e.start);
            const end = new Date(e.end);
            const target = new Date(dateStr);
            return target >= start && target < end;
        });
        setDailyEvents(filtered);
    };

    const handleEventClick = (event: CalendarEvent) => {
        // Teacher clicks event -> Edit Mode
        if (event.eventType === 'holiday') return; // Holidays might be editable, but let's restrict for now or handle separate
        setSelectedEvent(event);
        setIsEventModalOpen(true);
    };

    const handleAddEvent = () => {
        setSelectedEvent(undefined);
        setModalInitialDate(selectedDate || new Date().toISOString().split('T')[0]);
        setIsEventModalOpen(true);
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
                    <TeacherNoticeBoard />
                </div>

                {/* 2. Calendar (Mobile: Order 2 / Desktop: Order 1, Left Full Height) */}
                <div className="order-2 md:order-1 md:col-span-3 md:row-span-2">
                    <TeacherCalendarSection
                        events={events}
                        onDateClick={handleDateClick}
                        onEventClick={handleEventClick}
                        onAddEvent={handleAddEvent}
                        onSearchClick={() => setIsSearchOpen(true)}
                        calendarRef={calendarRef}
                        filterClass={filterClass}
                        onFilterChange={setFilterClass}
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
