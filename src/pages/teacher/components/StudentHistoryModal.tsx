import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

interface StudentHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    studentId: string;
    studentName: string;
}

const StudentHistoryModal: React.FC<StudentHistoryModalProps> = ({ isOpen, onClose, studentId, studentName }) => {
    const { config } = useAuth();
    const [historyGroups, setHistoryGroups] = useState<{ [date: string]: any[] }>({});
    const [loading, setLoading] = useState(false);
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (isOpen && studentId) {
            fetchHistory();
        }
    }, [config, isOpen, studentId]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            let q = query(
                collection(db, getSemesterCollectionPath(config, 'quiz_results')),
                where('uid', '==', studentId),
                orderBy('timestamp', 'desc')
            );
            let snap = await getDocs(q);
            if (snap.empty) {
                q = query(collection(db, 'quiz_results'), where('uid', '==', studentId), orderBy('timestamp', 'desc'));
                snap = await getDocs(q);
            }

            const groups: { [date: string]: any[] } = {};
            snap.forEach(doc => {
                const d = doc.data();
                const dateKey = d.timeString ? d.timeString.split(' ')[0] : 'Unknown';
                if (!groups[dateKey]) groups[dateKey] = [];
                groups[dateKey].push(d);
            });
            setHistoryGroups(groups);
        } catch (error) {
            console.error("Error fetching history:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleDate = (date: string) => {
        const newSet = new Set(expandedDates);
        if (newSet.has(date)) newSet.delete(date);
        else newSet.add(date);
        setExpandedDates(newSet);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl z-10 w-full max-w-3xl p-6 mx-4 max-h-[85vh] flex flex-col animate-fadeScale">
                <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-4">
                    <div>
                        <h3 className="font-bold text-xl text-gray-800">{studentName} 기록</h3>
                        <p className="text-xs text-gray-500">학생의 문제 풀이 내역을 날짜별로 확인합니다.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition">
                        <i className="fas fa-times text-gray-400 hover:text-gray-600 text-xl"></i>
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 pr-2">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <div className="loader-spinner mb-4"></div>
                            <p>기록을 불러오는 중...</p>
                        </div>
                    ) : Object.keys(historyGroups).length === 0 ? (
                        <div className="text-center py-20 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                            해당 학생의 문제 풀이 기록이 없습니다.
                        </div>
                    ) : (
                        Object.keys(historyGroups).map(date => (
                            <div key={date} className="border border-gray-200 rounded-xl overflow-hidden mb-4 shadow-sm">
                                <div
                                    className="bg-gray-50 px-4 py-3 font-bold text-gray-700 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition"
                                    onClick={() => toggleDate(date)}
                                >
                                    <span>📅 {date} 응시 ({historyGroups[date].length}건)</span>
                                    <i className={`fas fa-chevron-down text-gray-400 transition-transform ${expandedDates.has(date) ? 'rotate-180' : ''}`}></i>
                                </div>
                                {expandedDates.has(date) && (
                                    <div className="bg-white p-4 space-y-4 border-t border-gray-100">
                                        {historyGroups[date].map((record, idx) => (
                                            <div key={idx} className="bg-white">
                                                <div className="flex justify-between items-center text-sm mb-2 border-b border-gray-100 pb-2">
                                                    <span className={`font-bold ${record.score >= 80 ? 'text-blue-600' : (record.score >= 60 ? 'text-green-600' : 'text-red-600')}`}>
                                                        {record.score}점
                                                    </span>
                                                    <span className="text-gray-400 text-xs">
                                                        {record.timeString.split(' ').slice(1).join(' ')}
                                                    </span>
                                                </div>
                                                <div className="space-y-2">
                                                    {(record.details || []).map((q: any, qIdx: number) => (
                                                        <div key={qIdx} className={`flex items-start gap-2 text-sm ${q.correct ? 'text-green-700' : 'text-red-500'}`}>
                                                            <span className="font-mono font-bold w-6 bg-gray-100 text-center rounded text-xs py-0.5">Q{qIdx + 1}</span>
                                                            <span className="flex-1 truncate">
                                                                {q.correct ? '✅ 정답' : `❌ 오답 (제출: ${q.u || '미입력'})`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentHistoryModal;
