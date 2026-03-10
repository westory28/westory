import React, { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { getScheduleCategoryMeta, useScheduleCategories } from '../../../lib/scheduleCategories';
import { useAuth } from '../../../contexts/AuthContext';
import { CalendarEvent } from '../../../types';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectEvent: (dateStr: string) => void;
}

const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onSelectEvent }) => {
    const { config, userData } = useAuth();
    const { categories } = useScheduleCategories();
    const [q, setQ] = useState('');
    const [results, setResults] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    if (!isOpen) return null;

    const handleSearch = async () => {
        if (!q.trim() || !config || !userData) return;
        setLoading(true);
        setSearched(true);
        setResults([]);

        try {
            const userClassStr = (userData.grade && userData.class) ? `${userData.grade}-${userData.class}` : null;
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            const snapshot = await getDocs(collection(db, path));
            const matched: CalendarEvent[] = [];
            const qLower = q.toLowerCase();

            snapshot.forEach((item) => {
                const data = item.data() as Omit<CalendarEvent, 'id'>;
                const isCommon = data.targetType === 'common';
                const isHoliday = data.eventType === 'holiday';
                const isMyClass = data.targetType === 'class' && data.targetClass === userClassStr;

                if (!isCommon && !isHoliday && !isMyClass) return;

                const titleMatch = data.title?.toLowerCase().includes(qLower);
                const descMatch = data.description?.toLowerCase().includes(qLower);

                if (titleMatch || descMatch) {
                    matched.push({ id: item.id, ...data });
                }
            });

            setResults(matched);
        } catch (error) {
            console.error('Search error', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-20" onClick={onClose}>
            <div className="m-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-800"><i className="fas fa-search mr-2 text-blue-500"></i>일정 검색</h3>
                    <button onClick={onClose} className="text-gray-400 transition hover:text-gray-600">
                        <i className="fas fa-times fa-lg"></i>
                    </button>
                </div>

                <div className="relative mb-4">
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyUp={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-full rounded-xl border-2 border-blue-100 p-3 pl-10 text-lg font-bold outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        placeholder="검색어 입력"
                        autoFocus
                    />
                    <i className="fas fa-search absolute left-4 top-4 text-gray-400"></i>
                    <button
                        onClick={handleSearch}
                        className="absolute right-2 top-2 rounded-lg bg-blue-600 px-4 py-1.5 font-bold text-white transition hover:bg-blue-700"
                    >
                        검색
                    </button>
                </div>

                <div className="custom-scroll h-64 space-y-2 overflow-y-auto">
                    {loading && <div className="py-10 text-center text-gray-400"><i className="fas fa-spinner mr-2 fa-spin"></i>검색 중...</div>}

                    {!loading && !searched && (
                        <div className="py-10 text-center text-gray-400">검색어를 입력하고 엔터를 누르세요.</div>
                    )}

                    {!loading && searched && results.length === 0 && (
                        <div className="py-10 text-center text-gray-400">
                            <i className="far fa-folder-open mb-2 text-2xl"></i><br />
                            "{q}"와 일치하는 일정이 없습니다.
                        </div>
                    )}

                    {!loading && results.map((result) => {
                        const meta = getScheduleCategoryMeta(result.eventType, categories);
                        const bgColor = result.eventType === 'holiday' ? '#ef4444' : meta.color;
                        const typeLabel = result.eventType === 'holiday' ? '공휴일' : `${meta.emoji} ${meta.label}`;

                        return (
                            <div
                                key={result.id}
                                onClick={() => { onSelectEvent(result.start); onClose(); }}
                                className="cursor-pointer rounded-lg border-b border-gray-100 p-3 transition hover:bg-blue-50"
                            >
                                <div className="mb-1 flex items-center gap-2">
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: bgColor }}>{typeLabel}</span>
                                    <span className="text-sm font-bold text-gray-800">{result.title}</span>
                                </div>
                                <div className="text-xs text-gray-500">
                                    {result.start}
                                    {result.end && result.start !== result.end ? ` ~ ${result.end}` : ''}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default SearchModal;
