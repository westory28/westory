import React, { useEffect, useState } from 'react';
import { db } from '../../../../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

interface Question {
    id: number;
    category: string;
    unitId: string;
    type: string;
    question: string;
    answer: string;
    image?: string;
}

const QuizBankTab: React.FC = () => {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(false);

    // Filters
    const [typeFilter, setTypeFilter] = useState('');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const snap = await getDocs(collection(db, 'quiz_questions'));
                const list: Question[] = [];
                snap.forEach(d => list.push({ id: parseInt(d.id), ...d.data() } as Question));
                setQuestions(list);
            } catch (e) { console.error(e); }
            finally { setLoading(false); }
        };
        load();
    }, []);

    const filtered = typeFilter ? questions.filter(q => q.type === typeFilter) : questions;

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-3 items-center shrink-0">
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="border rounded px-2 py-1 text-sm text-gray-700"
                >
                    <option value="">유형 전체</option>
                    <option value="choice">객관식</option>
                    <option value="ox">O/X</option>
                    <option value="word">단답형</option>
                    <option value="order">순서</option>
                </select>
                <div className="ml-auto text-xs text-gray-500">총 <span className="font-bold text-blue-600">{filtered.length}</span>문제</div>
            </div>

            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white font-bold text-gray-700 sticky top-0 shadow-sm z-10">
                        <tr>
                            <th className="p-3 w-16 text-center">ID</th>
                            <th className="p-3 w-20 text-center">분류</th>
                            <th className="p-3 w-20 text-center">유형</th>
                            <th className="p-3">문제</th>
                            <th className="p-3 w-32">정답</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {loading ? <tr><td colSpan={5} className="p-4 text-center">로딩 중...</td></tr> :
                            filtered.map(q => (
                                <tr key={q.id} className="hover:bg-blue-50 transition">
                                    <td className="p-3 text-center text-gray-500 text-xs">{q.id}</td>
                                    <td className="p-3 text-center">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${q.category === 'diagnostic' ? 'bg-green-100 text-green-700' :
                                                q.category === 'formative' ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                                            }`}>
                                            {q.category === 'diagnostic' ? '진단' : q.category === 'formative' ? '형성' : '실전'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-center text-xs font-bold text-gray-600">{q.type}</td>
                                    <td className="p-3">
                                        <div className="flex items-start gap-2">
                                            {q.image && <i className="fas fa-image text-blue-500"></i>}
                                            <span className="font-bold text-gray-800 line-clamp-2">{q.question}</span>
                                        </div>
                                    </td>
                                    <td className="p-3 text-sm font-bold text-blue-600 truncate max-w-[100px]">{q.answer}</td>
                                </tr>
                            ))
                        }
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default QuizBankTab;
