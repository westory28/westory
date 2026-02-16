import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

interface Log {
    id: string;
    timestamp: any;
    gradeClass: string;
    studentName: string;
    email: string;
    score: number;
    // Helper fields
    classOnly: string;
    studentNumber: string;
}

const QuizLogTab: React.FC = () => {
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(false);
    const [classFilter, setClassFilter] = useState('');

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'quiz_submissions'), orderBy('timestamp', 'desc'), limit(50));
            const snap = await getDocs(q);
            const list: Log[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                let stdNum = '-';
                if (d.gradeClass) {
                    const parts = d.gradeClass.split(' ');
                    if (parts.length >= 3) stdNum = parts[2].replace('번', '');
                } else if (d.number) {
                    stdNum = d.number;
                }

                list.push({
                    id: doc.id,
                    timestamp: d.timestamp,
                    gradeClass: d.gradeClass,
                    studentName: d.name || d.studentName,
                    email: d.email,
                    score: d.score,
                    classOnly: d.gradeClass ? d.gradeClass.split(' ')[1] : '-',
                    studentNumber: stdNum
                });
            });
            setLogs(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filteredLogs = classFilter
        ? logs.filter(l => l.gradeClass && l.gradeClass.includes(`${classFilter}반`))
        : logs;

    return (
        <div className="h-full overflow-y-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">제출 현황 <span className="text-sm font-normal text-gray-500">({filteredLogs.length}건)</span></h2>
                <div className="flex gap-2">
                    <select
                        value={classFilter}
                        onChange={(e) => setClassFilter(e.target.value)}
                        className="border rounded px-3 py-2 text-sm font-bold"
                    >
                        <option value="">전체 (최근 50개)</option>
                        {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}반</option>)}
                    </select>
                    <button onClick={fetchLogs} className="bg-gray-100 p-2 rounded hover:bg-gray-200 transition">
                        <i className="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-gray-50 text-gray-600 font-bold border-b">
                        <tr>
                            <th className="p-4 w-32">시간</th>
                            <th className="p-4 w-16">반</th>
                            <th className="p-4 w-16">번호</th>
                            <th className="p-4 w-32">학생</th>
                            <th className="p-4 w-24">점수</th>
                            <th className="p-4 w-24">상태</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? <tr><td colSpan={6} className="p-4 text-center">로딩 중...</td></tr> :
                            filteredLogs.length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-gray-400">내역 없음</td></tr> :
                                filteredLogs.map(log => (
                                    <tr key={log.id} className="hover:bg-gray-50 transition">
                                        <td className="p-4 text-gray-500">
                                            {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : '-'}
                                        </td>
                                        <td className="p-4 font-bold text-gray-600">{log.classOnly}</td>
                                        <td className="p-4 font-bold text-gray-600">{log.studentNumber}번</td>
                                        <td className="p-4">
                                            <div className="font-bold text-gray-800">{log.studentName}</div>
                                            <div className="text-xs text-gray-400 truncate max-w-[150px]">{log.email}</div>
                                        </td>
                                        <td className={`p-4 font-bold ${log.score >= 80 ? 'text-green-600' : 'text-red-600'}`}>
                                            {log.score}점
                                        </td>
                                        <td className="p-4">
                                            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">제출완료</span>
                                        </td>
                                    </tr>
                                ))
                        }
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default QuizLogTab;
