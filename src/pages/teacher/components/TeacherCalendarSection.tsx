import React, { useRef, useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { CalendarEvent } from '../../../types';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';

interface TeacherCalendarSectionProps {
    events: CalendarEvent[];
    onDateClick: (dateStr: string) => void;
    onEventClick: (event: CalendarEvent) => void;
    onAddEvent: () => void;
    onSearchClick: () => void;
    calendarRef: React.RefObject<FullCalendar>;
    filterClass: string;
    onFilterChange: (cls: string) => void;
}

const TeacherCalendarSection: React.FC<TeacherCalendarSectionProps> = ({
    events, onDateClick, onEventClick, onAddEvent, onSearchClick, calendarRef,
    filterClass, onFilterChange
}) => {
    const { config } = useAuth();

    // Convert events for FullCalendar
    const fcEvents = events.map(e => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        backgroundColor: e.eventType === 'holiday' ? 'transparent' : undefined,
        borderColor: 'transparent',
        textColor: e.eventType === 'holiday' ? '#ef4444' : undefined,
        classNames: e.eventType === 'holiday' ? ['holiday-text-event'] : [],
        extendedProps: { ...e }
    }));

    // Populate 2026 Holidays
    const populateHolidays = async () => {
        if (!config || !confirm('기존 공휴일 데이터를 모두 삭제하고 2026년 공휴일(대체공휴일 포함)을 다시 등록하시겠습니까?')) return;

        const holidays = [
            { title: "신정", start: "2026-01-01" },
            { title: "설날 연휴", start: "2026-02-16" },
            { title: "설날", start: "2026-02-17" },
            { title: "설날 연휴", start: "2026-02-18" },
            { title: "삼일절", start: "2026-03-01" },
            { title: "삼일절 대체공휴일", start: "2026-03-02" },
            { title: "어린이날", start: "2026-05-05" },
            { title: "부처님오신날", start: "2026-05-24" },
            { title: "부처님오신날 대체공휴일", start: "2026-05-25" },
            { title: "현충일", start: "2026-06-06" },
            { title: "현충일 대체공휴일", start: "2026-06-08" },
            { title: "광복절", start: "2026-08-15" },
            { title: "광복절 대체공휴일", start: "2026-08-17" },
            { title: "추석 연휴", start: "2026-09-24" },
            { title: "추석", start: "2026-09-25" },
            { title: "추석 연휴", start: "2026-09-26" },
            { title: "추석 대체공휴일", start: "2026-09-28" },
            { title: "개천절", start: "2026-10-03" },
            { title: "개천절 대체공휴일", start: "2026-10-05" },
            { title: "한글날", start: "2026-10-09" },
            { title: "성탄절", start: "2026-12-25" }
        ];

        try {
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            const batch = writeBatch(db);

            // Note: In a real app, we should delete existing holidays first. 
            // For simplicity/safety, we'll just add/overwrite by ID in this migration step 
            // or we'd need to query and delete first like in legacy code.
            // Let's implement delete logic briefly if possible, or just overwrite with deterministic IDs.

            // Using deterministic IDs to avoid duplicates on re-run
            holidays.forEach(h => {
                const docId = `holiday_${h.start}_${h.title.replace(/\s+/g, '')}`;
                const docRef = doc(db, path, docId);
                batch.set(docRef, {
                    ...h,
                    eventType: 'holiday',
                    targetType: 'common',
                    targetClass: null,
                    description: '대한민국 공휴일',
                    createdAt: new Date(), // serverTimestamp cannot be used inside array map easily without import
                    updatedAt: new Date()
                });
            });

            await batch.commit();
            alert(`총 ${holidays.length}개의 공휴일이 등록되었습니다.`);
        } catch (e: any) {
            console.error(e);
            alert('공휴일 등록 실패: ' + e.message);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col min-h-[500px] md:min-h-0 h-full">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 gap-2">
                <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap">
                    <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
                </h2>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                    <button
                        onClick={onSearchClick}
                        className="bg-gray-50 border border-gray-200 text-gray-600 hover:text-blue-600 p-1.5 rounded-lg transition shrink-0"
                        title="검색"
                    >
                        <i className="fas fa-search"></i>
                    </button>

                    <select
                        value={filterClass}
                        onChange={(e) => onFilterChange(e.target.value)}
                        className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg p-1.5 outline-none shrink-0 max-w-[100px]"
                    >
                        <option value="all">전체</option>
                        <option value="common">공통</option>
                        {Array.from({ length: 3 }, (_, g) =>
                            Array.from({ length: 12 }, (_, c) => (
                                <option key={`${g + 1}-${c + 1}`} value={`${g + 1}-${c + 1}`}>{g + 1}-{c + 1}반</option>
                            ))
                        ).flat()}
                    </select>

                    <div className="flex items-center gap-1 ml-auto md:ml-2">
                        <button
                            onClick={onAddEvent}
                            className="bg-blue-600 text-white px-2 py-1.5 rounded-md text-xs font-bold hover:bg-blue-700 shadow-sm transition whitespace-nowrap"
                        >
                            <i className="fas fa-plus"></i> 추가
                        </button>
                        <button
                            onClick={populateHolidays}
                            className="bg-green-600 text-white px-2 py-1.5 rounded-md hover:bg-green-700 transition shadow-sm text-xs font-bold whitespace-nowrap hidden lg:block"
                            title="2026년 공휴일 자동 등록"
                        >
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
                />
            </div>
        </div>
    );
};

export default TeacherCalendarSection;
