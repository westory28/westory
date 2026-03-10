import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, limit, orderBy } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { normalizeHistoryClassroomResult, type HistoryClassroomResult } from '../../../lib/historyClassroom';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

const HistoryClassroomResultsPanel: React.FC = () => {
    const { config } = useAuth();
    const [results, setResults] = useState<HistoryClassroomResult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadResults = async () => {
            setLoading(true);
            try {
                let snap = await getDocs(query(
                    collection(db, getSemesterCollectionPath(config, 'history_classroom_results')),
                    orderBy('createdAt', 'desc'),
                    limit(12),
                ));
                if (snap.empty) {
                    snap = await getDocs(query(collection(db, 'history_classroom_results'), orderBy('createdAt', 'desc'), limit(12)));
                }
                setResults(snap.docs.map((docSnap) => normalizeHistoryClassroomResult(docSnap.id, docSnap.data())));
            } catch (error) {
                console.error('Failed to load history classroom results:', error);
            } finally {
                setLoading(false);
            }
        };
        void loadResults();
    }, [config]);

    const statusMeta = useMemo(() => ({
        passed: { label: '통과', className: 'bg-emerald-50 text-emerald-700' },
        failed: { label: '미통과', className: 'bg-rose-50 text-rose-700' },
        cancelled: { label: '자동취소', className: 'bg-amber-50 text-amber-700' },
    }), []);

    return (
        <div className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                <h3 className="text-lg font-bold text-gray-800">
                    <i className="fas fa-landmark mr-2 text-orange-500"></i>역사교실 결과
                </h3>
                <span className="text-xs font-bold text-gray-400">최근 12건</span>
            </div>

            <div className="space-y-3">
                {loading && <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>}
                {!loading && results.length === 0 && <div className="py-8 text-center text-sm text-gray-400">표시할 결과가 없습니다.</div>}
                {!loading && results.map((result) => (
                    <div key={result.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-gray-900">{result.assignmentTitle || '역사교실'}</div>
                                <div className="text-xs text-gray-500">
                                    {[result.studentGrade, result.studentClass, result.studentNumber].filter(Boolean).join('-')} {result.studentName}
                                </div>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusMeta[result.status].className}`}>
                                {statusMeta[result.status].label}
                            </span>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                            {result.score}/{result.total} · {result.percent}% · 기준 {result.passThresholdPercent}%
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HistoryClassroomResultsPanel;
