import React, { useEffect, useState, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, query, where } from 'firebase/firestore';

interface CalendarEvent {
    id?: string;
    title: string;
    start: string;
    end?: string;
    eventType: 'exam' | 'performance' | 'event' | 'diagnosis' | 'formative';
    targetType: 'common' | 'class';
    targetClass?: string;
    description?: string;
}

const ManageSchedule = () => {
    const { user } = useAuth();
    const [events, setEvents] = useState<any[]>([]);
    const [currentConfig, setCurrentConfig] = useState<{ year: string; semester: string } | null>(null);
    const [filter, setFilter] = useState('all');

    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formData, setFormData] = useState<CalendarEvent>({
        title: '',
        start: '',
        end: '',
        eventType: 'performance',
        targetType: 'common',
        targetClass: '2-1',
        description: ''
    });
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const calendarRef = useRef<FullCalendar>(null);

    const colorMap: { [key: string]: string } = {
        'exam': '#ef4444',       // Red
        'performance': '#f97316', // Orange
        'event': '#10b981',       // Green
        'diagnosis': '#3b82f6',   // Blue
        'formative': '#3b82f6'    // Blue
    };

    // Holidays (Simplified for prototype, ideally fetched or calculated)
    const holidays: { [key: string]: string } = {
        '2025-01-01': '신정', '2025-03-01': '삼일절', '2025-05-05': '어린이날',
        '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절',
        '2025-10-09': '한글날', '2025-12-25': '성탄절'
    };


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

    const fetchEvents = async () => {
        if (!currentConfig) return;
        const calRef = collection(db, 'years', currentConfig.year, 'calendar');
        try {
            const snap = await getDocs(calRef);
            const loadedEvents: any[] = [];

            // Add Holidays
            Object.keys(holidays).forEach(date => {
                loadedEvents.push({
                    id: 'holiday-' + date,
                    title: holidays[date],
                    start: date,
                    allDay: true,
                    textColor: '#ef4444',
                    backgroundColor: 'transparent',
                    borderColor: 'transparent',
                    classNames: ['holiday-text-event'],
                    editable: false
                });
            });

            snap.forEach(docData => {
                const d = docData.data() as CalendarEvent;
                const id = docData.id;

                let isVisible = true;
                if (filter !== 'all') {
                    if (filter === 'common') {
                        if (d.targetType !== 'common') isVisible = false;
                    } else {
                        // Filter is a specific class like '2-1'
                        if (d.targetType === 'class' && d.targetClass !== filter) isVisible = false;
                    }
                }

                if (isVisible) {
                    loadedEvents.push({
                        id: id,
                        title: d.title,
                        start: d.start,
                        end: d.end || d.start,
                        backgroundColor: colorMap[d.eventType] || '#6b7280',
                        borderColor: colorMap[d.eventType] || '#6b7280',
                        extendedProps: d
                    });
                }
            });
            setEvents(loadedEvents);
        } catch (e) {
            console.error("Error fetching events:", e);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, [currentConfig, filter]);

    const handleDateClick = (arg: any) => {
        openModal(null, arg.dateStr);
    };

    const handleEventClick = (info: any) => {
        if (info.event.classNames.includes('holiday-text-event')) return;
        const props = info.event.extendedProps;
        openModal({ ...props, id: info.event.id });
    };

    const openModal = (eventData: any | null, dateStr?: string) => {
        if (eventData) {
            setIsEditMode(true);
            setSelectedEventId(eventData.id);
            setFormData({
                title: eventData.title,
                start: eventData.start,
                end: eventData.end || '',
                eventType: eventData.eventType || 'performance',
                targetType: eventData.targetType || 'common',
                targetClass: eventData.targetClass || '2-1',
                description: eventData.description || ''
            });
        } else {
            setIsEditMode(false);
            setSelectedEventId(null);
            setFormData({
                title: '',
                start: dateStr || new Date().toISOString().split('T')[0],
                end: '',
                eventType: 'performance',
                targetType: 'common',
                targetClass: '2-1',
                description: ''
            });
        }
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
    };

    const handleSave = async () => {
        if (!formData.title || !formData.start) {
            alert("제목과 시작 날짜는 필수입니다.");
            return;
        }
        if (!currentConfig) return;

        const calRef = collection(db, 'years', currentConfig.year, 'calendar');
        const dataToSave = {
            ...formData,
            updatedAt: serverTimestamp()
        };

        try {
            if (isEditMode && selectedEventId) {
                await updateDoc(doc(calRef, selectedEventId), dataToSave);
            } else {
                // @ts-ignore
                dataToSave.createdAt = serverTimestamp();
                await addDoc(calRef, dataToSave);
            }
            closeModal();
            fetchEvents();
        } catch (e: any) {
            alert("저장 실패: " + e.message);
        }
    };

    const handleDelete = async () => {
        if (!selectedEventId || !currentConfig) return;
        if (!window.confirm("정말 삭제하시겠습니까?")) return;

        try {
            await deleteDoc(doc(db, 'years', currentConfig.year, 'calendar', selectedEventId));
            closeModal();
            fetchEvents();
        } catch (e: any) {
            alert("삭제 실패: " + e.message);
        }
    };

    return (
        <div className="bg-gray-50 flex flex-col min-h-screen">
            <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-6 h-full flex flex-col">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 shrink-0">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-800"><i className="fas fa-calendar-alt text-blue-500 mr-2"></i>학사 일정 관리</h1>
                        <p className="text-xs md:text-sm text-gray-500 mt-1">수행평가, 정기 시험 등 주요 학사 일정을 관리하세요.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <span className="text-sm font-bold text-gray-600">보기 필터:</span>
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="border border-gray-300 rounded px-3 py-2 text-sm font-bold focus:border-blue-500 outline-none"
                        >
                            <option value="all">전체 일정</option>
                            <option value="common">공통 일정만</option>
                            {[...Array(12)].map((_, i) => (
                                <option key={i} value={`2-${i + 1}`}>2-{i + 1}반</option>
                            ))}
                        </select>
                        <button
                            onClick={() => openModal(null)}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-700 shadow-sm ml-2"
                        >
                            <i className="fas fa-plus mr-1"></i> 일정 추가
                        </button>
                    </div>
                </div>

                <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col min-h-[600px]">
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
                        events={events}
                        dateClick={handleDateClick}
                        eventClick={handleEventClick}
                        height="100%"
                        dayCellClassNames={(arg) => {
                            // Holiday styling if needed directly on cell
                            return [];
                        }}
                    />
                </div>
            </main>

            {/* Modal */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative">
                        <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2 flex items-center">
                            <i className="fas fa-edit text-blue-500 mr-2"></i>
                            {isEditMode ? "일정 수정" : "일정 등록"}
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">일정 제목</label>
                                <input
                                    type="text"
                                    className="w-full border rounded p-2 text-sm font-bold focus:border-blue-500 outline-none"
                                    placeholder="예: 역사 수행평가"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">시작 날짜</label>
                                    <input
                                        type="date"
                                        className="w-full border rounded p-2 text-sm"
                                        value={formData.start}
                                        onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">종료 날짜 (선택)</label>
                                    <input
                                        type="date"
                                        className="w-full border rounded p-2 text-sm"
                                        value={formData.end}
                                        onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">일정 종류</label>
                                <select
                                    className="w-full border rounded p-2 text-sm font-bold bg-white"
                                    value={formData.eventType}
                                    onChange={(e) => setFormData({ ...formData, eventType: e.target.value as any })}
                                >
                                    <option value="performance">⚡ 수행평가 (Orange)</option>
                                    <option value="exam">🔥 지필평가 (Red)</option>
                                    <option value="diagnosis">📝 진단평가 (Blue)</option>
                                    <option value="formative">✍️ 형성평가 (Blue)</option>
                                    <option value="event">🎉 행사/기타 (Green)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2">대상 선택</label>
                                <div className="flex gap-4 mb-2">
                                    <label className="flex items-center cursor-pointer">
                                        <input
                                            type="radio"
                                            name="targetType"
                                            value="common"
                                            checked={formData.targetType === 'common'}
                                            onChange={() => setFormData({ ...formData, targetType: 'common' })}
                                            className="w-4 h-4 text-blue-600"
                                        />
                                        <span className="ml-2 text-sm font-bold">전체 공통</span>
                                    </label>
                                    <label className="flex items-center cursor-pointer">
                                        <input
                                            type="radio"
                                            name="targetType"
                                            value="class"
                                            checked={formData.targetType === 'class'}
                                            onChange={() => setFormData({ ...formData, targetType: 'class' })}
                                            className="w-4 h-4 text-blue-600"
                                        />
                                        <span className="ml-2 text-sm font-bold">반 선택</span>
                                    </label>
                                </div>
                                <select
                                    className="w-full border rounded p-2 text-sm bg-gray-50 disabled:opacity-50"
                                    disabled={formData.targetType !== 'class'}
                                    value={formData.targetClass}
                                    onChange={(e) => setFormData({ ...formData, targetClass: e.target.value })}
                                >
                                    {[...Array(12)].map((_, i) => (
                                        <option key={i} value={`2-${i + 1}`}>2-{i + 1}반</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">상세 내용</label>
                                <textarea
                                    className="w-full border rounded p-2 text-sm h-20 resize-none"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                ></textarea>
                            </div>
                        </div>

                        <div className="flex justify-between items-center mt-6 pt-4 border-t">
                            {isEditMode ? (
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    className="text-red-500 font-bold text-sm hover:text-red-700"
                                >
                                    <i className="fas fa-trash mr-1"></i>삭제
                                </button>
                            ) : <div></div>}

                            <div className="flex gap-2 ml-auto">
                                <button
                                    onClick={closeModal}
                                    className="px-4 py-2 bg-gray-100 text-gray-600 rounded font-bold text-sm hover:bg-gray-200"
                                >
                                    취소
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-6 py-2 bg-blue-600 text-white rounded font-bold text-sm hover:bg-blue-700 shadow-md"
                                >
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <style>{`
                .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
                .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
                .fc-daygrid-event { cursor: pointer; border-radius: 4px; padding: 2px 4px; font-size: 0.85rem; font-weight: 600; border: none; }
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; }
                .holiday-text-event { background-color: transparent !important; border: none !important; }
                .holiday-text-event .fc-event-title { color: #ef4444; font-size: 0.75rem; font-weight: 800; }
            `}</style>
        </div>
    );
};

export default ManageSchedule;
