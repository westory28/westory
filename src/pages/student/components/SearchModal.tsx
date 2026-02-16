import React, { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore'; // Check imports
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { CalendarEvent } from '../../../types';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectEvent: (dateStr: string) => void;
}

const colorMap: Record<string, string> = {
    'exam': '#ef4444',
    'performance': '#f97316',
    'event': '#10b981',
    'diagnosis': '#3b82f6',
    'formative': '#3b82f6'
};

const typeLabelMap: Record<string, string> = {
    'exam': '정기 시험', 'performance': '수행평가', 'event': '행사', 'diagnosis': '진단평가', 'formative': '형성평가'
};

const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onSelectEvent }) => {
    const { config, userData } = useAuth();
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

            snapshot.forEach(doc => {
                const d = doc.data() as any;
                // Filter
                const isCommon = d.targetType === 'common';
                const isHoliday = d.eventType === 'holiday';
                const isMyClass = d.targetType === 'class' && d.targetClass === userClassStr;

                if (!isCommon && !isHoliday && !isMyClass) return;

                const titleMatch = d.title && d.title.toLowerCase().includes(qLower);
                // description might be missing in type but exist in data
                const descMatch = d.description && d.description.toLowerCase().includes(qLower);

                if (titleMatch || descMatch) {
                    matched.push({ id: doc.id, ...d, ...d }); // Spread d just in case
                }
            });
            setResults(matched as CalendarEvent[]);
        } catch (e) {
            console.error("Search error", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-start justify-center pt-20" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-4" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800"><i className="fas fa-search text-blue-500 mr-2"></i>일정 검색</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                        <i className="fas fa-times fa-lg"></i>
                    </button>
                </div>

                <div className="relative mb-4">
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyUp={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-full border-2 border-blue-100 rounded-xl p-3 pl-10 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition font-bold text-lg"
                        placeholder="검색어 입력 (예: 정기 시험, 수행평가 등)"
                        autoFocus
                    />
                    <i className="fas fa-search absolute left-4 top-4 text-gray-400"></i>
                    <button
                        onClick={handleSearch}
                        className="absolute right-2 top-2 bg-blue-600 text-white px-4 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition"
                    >
                        검색
                    </button>
                </div>

                <div className="h-64 overflow-y-auto custom-scroll space-y-2">
                    {loading && <div className="text-center text-gray-400 py-10"><i className="fas fa-spinner fa-spin mr-2"></i>검색 중...</div>}

                    {!loading && !searched && (
                        <div className="text-center text-gray-400 py-10">검색어를 입력하고 엔터를 누르세요.</div>
                    )}

                    {!loading && searched && results.length === 0 && (
                        <div className="text-center text-gray-400 py-10">
                            <i className="far fa-folder-open text-2xl mb-2"></i><br />
                            "{q}"이(가) 포함된 제목 또는 내용이 없습니다.
                        </div>
                    )}

                    {!loading && results.map(r => {
                        const bgColor = colorMap[r.eventType] || '#6b7280';
                        const typeLabel = typeLabelMap[r.eventType] || '일정';
                        return (
                            <div
                                key={r.id}
                                onClick={() => { onSelectEvent(r.start); onClose(); }}
                                className="p-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer rounded-lg transition"
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] text-white px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: bgColor }}>{typeLabel}</span>
                                    <span className="font-bold text-sm text-gray-800">{r.title}</span>
                                </div>
                                <div className="text-xs text-gray-500">
                                    {r.start}
                                    {r.end && r.start !== r.end ? ` ~ ${r.end}` : ''}
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
