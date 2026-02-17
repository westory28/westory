import React, { useState, useEffect } from 'react';
import { db } from '../../../lib/firebase';
import { doc, setDoc, deleteDoc, serverTimestamp, collection } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { CalendarEvent } from '../../../types';

interface EventModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventData?: CalendarEvent; // If editing
    onSave: () => void;
    initialDate?: string; // If creating from date click
}

const EventModal: React.FC<EventModalProps> = ({ isOpen, onClose, eventData, onSave, initialDate }) => {
    const { config } = useAuth();
    const [title, setTitle] = useState('');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [description, setDescription] = useState('');
    const [eventType, setEventType] = useState('exam');
    const [targetType, setTargetType] = useState('common');
    const [targetGrade, setTargetGrade] = useState('1');
    const [targetClass, setTargetClass] = useState('1');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (eventData) {
                setTitle(eventData.title || '');
                setStart(eventData.start || '');
                setEnd(eventData.end || '');
                setDescription(eventData.description || '');
                setEventType(eventData.eventType || 'exam');
                setTargetType(eventData.targetType || 'common');
                const [g, c] = (eventData.targetClass || '1-1').split('-');
                setTargetGrade(g || '1');
                setTargetClass(c || '1');
            } else {
                setTitle('');
                setStart(initialDate || '');
                setEnd('');
                setDescription('');
                setEventType('exam');
                setTargetType('common');
                setTargetGrade('1');
                setTargetClass('1');
            }
        }
    }, [isOpen, eventData, initialDate]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!config || !title.trim() || !start) return;
        setLoading(true);

        try {
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            const docRef = eventData ? doc(db, path, eventData.id) : doc(collection(db, path));

            const data: any = {
                title: title.trim(),
                start,
                end: end || start, // If end is empty, use start for single day event
                description: description.trim(),
                eventType,
                targetType,
                targetClass: targetType === 'class' ? `${targetGrade}-${targetClass}` : null,
                updatedAt: serverTimestamp()
            };

            if (!eventData) {
                data.createdAt = serverTimestamp();
            }

            await setDoc(docRef, data, { merge: true });
            onSave();
            onClose();
        } catch (error) {
            console.error("Error saving event:", error);
            alert("일정 저장 실패");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!eventData || !config || !confirm("정말 삭제하시겠습니까?")) return;
        setLoading(true);
        try {
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            await deleteDoc(doc(db, path, eventData.id));
            onSave();
            onClose();
        } catch (error) {
            console.error("Error deleting event:", error);
            alert("일정 삭제 실패");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800"><i className="fas fa-edit text-blue-500 mr-2"></i>일정 등록</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                        <i className="fas fa-times fa-lg"></i>
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">일정 제목</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="예: 역사 수행평가"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">시작 날짜</label>
                            <input
                                type="date"
                                value={start}
                                onChange={e => setStart(e.target.value)}
                                className="w-full min-w-0 border border-gray-300 rounded-lg p-2.5 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">종료 날짜 (선택)</label>
                            <input
                                type="date"
                                value={end}
                                onChange={e => setEnd(e.target.value)}
                                className="w-full min-w-0 border border-gray-300 rounded-lg p-2.5 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">일정 종류</label>
                        <select
                            value={eventType}
                            onChange={e => setEventType(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none font-bold"
                        >
                            <option value="exam">🔴 정기 시험</option>
                            <option value="performance">⚡ 수행평가</option>
                            <option value="diagnosis">📝 진단평가</option>
                            <option value="formative">📘 형성평가</option>
                            <option value="event">🎉 행사</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">대상 선택</label>
                        <div className="flex items-center space-x-4 mb-2">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="radio"
                                    name="eventTargetType"
                                    value="common"
                                    checked={targetType === 'common'}
                                    onChange={() => setTargetType('common')}
                                    className="w-4 h-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm font-bold text-gray-700">전체 공통</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="radio"
                                    name="eventTargetType"
                                    value="class"
                                    checked={targetType === 'class'}
                                    onChange={() => setTargetType('class')}
                                    className="w-4 h-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm font-bold text-gray-700">반 선택</span>
                            </label>
                        </div>

                        <div className="flex gap-2">
                            <select
                                value={targetGrade}
                                onChange={e => setTargetGrade(e.target.value)}
                                disabled={targetType !== 'class'}
                                className="w-1/3 border border-gray-300 rounded-lg p-2.5 outline-none bg-gray-50 transition font-bold text-center disabled:opacity-50"
                            >
                                {[1, 2, 3].map(g => <option key={g} value={g}>{g}학년</option>)}
                            </select>
                            <select
                                value={targetClass}
                                onChange={e => setTargetClass(e.target.value)}
                                disabled={targetType !== 'class'}
                                className="w-2/3 border border-gray-300 rounded-lg p-2.5 outline-none bg-gray-50 transition font-bold disabled:opacity-50"
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(c => <option key={c} value={c}>{c}반</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">상세 내용 (선택)</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none resize-none"
                            placeholder="일정에 대한 상세 설명을 입력하세요..."
                        ></textarea>
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
                    {eventData && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={loading}
                            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg font-bold hover:bg-red-200 transition"
                        >
                            삭제
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 bg-gray-100 text-gray-600 rounded-lg font-bold hover:bg-gray-200 transition"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={loading}
                        className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-md transition transform active:scale-95 disabled:opacity-50"
                    >
                        {loading ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EventModal;
