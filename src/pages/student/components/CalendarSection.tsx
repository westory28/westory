import React, { useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { CalendarEvent } from '../../../types';
// import '@fullcalendar/react/dist/vdom'; // Not needed for v6+

interface CalendarSectionProps {
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    onEventClick: (event: CalendarEvent) => void;
    onSearchClick: () => void;
    calendarRef: React.RefObject<FullCalendar>;
}

const CalendarSection: React.FC<CalendarSectionProps> = ({ events, onDateClick, onEventClick, onSearchClick, calendarRef }) => {

    // Convert logic for holidays to classNames or verify events structure
    // Since we pass pre-processed events from Dashboard, we can just use them.
    // However, FullCalendar events prop expects specific format.
    // We map our CalendarEvent to FullCalendar event object.

    const fcEvents = events.map(e => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        backgroundColor: e.eventType === 'holiday' ? 'transparent' : undefined, // Handled by CSS class usually or specific prop
        borderColor: 'transparent',
        textColor: e.eventType === 'holiday' ? '#ef4444' : undefined,
        classNames: e.eventType === 'holiday' ? ['holiday-text-event'] : [],
        extendedProps: { ...e }
    }));

    // Custom CSS for holiday text event
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .holiday-text-event { background-color: transparent !important; border: none !important; }
            .holiday-text-event .fc-event-title { color: #ef4444; font-size: 0.75rem; font-weight: 800; }
            .fc-day-selected { background-color: #f3f4f6 !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
            .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700; }
            .fc-day-sat a { color: #3b82f6 !important; text-decoration: none; font-weight: 700; }
            .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
            .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
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
                    events={fcEvents}
                    dateClick={(arg) => onDateClick(arg.dateStr)}
                    eventClick={(arg) => onEventClick(arg.event.extendedProps as CalendarEvent)}
                    height="100%"
                    contentHeight="100%"
                    dayMaxEvents={true}
                    fixedWeekCount={false}
                    showNonCurrentDates={false}
                // dayCellClassNames logic mainly for holidays which we handle via events mostly, 
                // or we can add logic to check holiday events on that day.
                // Simplified for migration: rely on events rendering.
                />
            </div>
        </div>
    );
};

export default CalendarSection;
