import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';

interface TreeUnit {
    id: string;
    title: string;
    children?: TreeUnit[];
}

interface Question {
    id: number;
    category: string;
    unitId: string;
    subUnitId?: string | null;
    type: string;
    question: string;
    answer: string | number;
    image?: string;
    refBig?: string;
    refMid?: string;
    refSmall?: string;
}

interface BankFilterState {
    big: string;
    mid: string;
    small: string;
    type: string;
    evalType: string;
}

const EVAL_TYPE_MAP: Record<string, string> = {
    diagnosis: 'diagnostic',
    formative: 'formative',
    exam: 'exam_prep',
};

const QuizBankTab: React.FC = () => {
    const { config } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [treeData, setTreeData] = useState<TreeUnit[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<BankFilterState>({
        big: '',
        mid: '',
        small: '',
        type: '',
        evalType: '',
    });

    useEffect(() => {
        const loadAll = async () => {
            setLoading(true);
            try {
                const [questionsResult, treeResult] = await Promise.all([
                    loadQuestions(),
                    loadTreeData(),
                ]);
                setQuestions(questionsResult);
                setTreeData(treeResult);
            } finally {
                setLoading(false);
            }
        };
        void loadAll();
    }, [config]);

    const loadQuestions = async () => {
        try {
            let snap = await getDocs(collection(db, getSemesterCollectionPath(config, 'quiz_questions')));
            if (snap.empty) {
                snap = await getDocs(collection(db, 'quiz_questions'));
            }

            const list: Question[] = [];
            snap.forEach((d) => {
                const parsed = parseInt(d.id, 10);
                list.push({
                    id: Number.isNaN(parsed) ? 0 : parsed,
                    ...(d.data() as Omit<Question, 'id'>),
                });
            });
            return list;
        } catch (error) {
            console.error(error);
            return [];
        }
    };

    const loadTreeData = async () => {
        try {
            const scoped = await getDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree')));
            if (scoped.exists()) return (scoped.data().tree || []) as TreeUnit[];

            const legacy = await getDoc(doc(db, 'curriculum', 'tree'));
            if (legacy.exists()) return (legacy.data().tree || []) as TreeUnit[];
        } catch (error) {
            console.error(error);
        }
        return [];
    };

    const selectedBig = useMemo(
        () => treeData.find((big) => big.id === filters.big),
        [filters.big, treeData],
    );

    const midOptions = selectedBig?.children || [];

    const selectedMid = useMemo(
        () => midOptions.find((mid) => mid.id === filters.mid),
        [filters.mid, midOptions],
    );

    const smallOptions = selectedMid?.children || [];

    const filteredQuestions = useMemo(() => {
        let list = [...questions];

        list = list.filter((q) => {
            if (filters.big) {
                const selectedBigNode = treeData.find((big) => big.id === filters.big);
                if (!selectedBigNode) return false;
                const midIds = (selectedBigNode.children || []).map((mid) => mid.id);

                if (q.category === 'exam_prep') {
                    if (q.refBig !== filters.big) return false;
                } else if (!midIds.includes(q.unitId)) {
                    return false;
                }
            }

            if (filters.mid) {
                if (q.category === 'exam_prep') {
                    if (q.refMid !== filters.mid) return false;
                } else if (q.unitId !== filters.mid) {
                    return false;
                }
            }

            if (filters.small) {
                if (q.category === 'exam_prep') {
                    if (q.refSmall !== filters.small) return false;
                } else if ((q.subUnitId || '') !== filters.small) {
                    return false;
                }
            }

            if (filters.type && q.type !== filters.type) return false;

            if (filters.evalType) {
                const mappedCategory = EVAL_TYPE_MAP[filters.evalType];
                if (q.category !== mappedCategory) return false;
            }

            return true;
        });

        list.sort((a, b) => a.id - b.id);
        return list;
    }, [filters, questions, treeData]);

    const handleBigChange = (value: string) => {
        setFilters((prev) => ({
            ...prev,
            big: value,
            mid: '',
            small: '',
        }));
    };

    const handleMidChange = (value: string) => {
        setFilters((prev) => ({
            ...prev,
            mid: value,
            small: '',
        }));
    };

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-2 items-center shrink-0">
                <select value={filters.big} onChange={(e) => handleBigChange(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">대단원 전체</option>
                    {treeData.map((big) => (
                        <option key={big.id} value={big.id}>{big.title}</option>
                    ))}
                </select>

                <select value={filters.mid} onChange={(e) => handleMidChange(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">중단원 전체</option>
                    {midOptions.map((mid) => (
                        <option key={mid.id} value={mid.id}>{mid.title}</option>
                    ))}
                </select>

                <select value={filters.small} onChange={(e) => setFilters((prev) => ({ ...prev, small: e.target.value }))} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">소단원 전체</option>
                    {smallOptions.map((small) => (
                        <option key={small.id} value={small.id}>{small.title}</option>
                    ))}
                </select>

                <select value={filters.type} onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">유형 전체</option>
                    <option value="choice">객관식</option>
                    <option value="ox">O/X</option>
                    <option value="word">단답형</option>
                    <option value="order">순서 배열</option>
                </select>

                <select value={filters.evalType} onChange={(e) => setFilters((prev) => ({ ...prev, evalType: e.target.value }))} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">평가유형 전체</option>
                    <option value="diagnosis">진단평가</option>
                    <option value="formative">형성평가</option>
                    <option value="exam">실전 모의고사</option>
                </select>

                <button
                    onClick={() => setFilters({ big: '', mid: '', small: '', type: '', evalType: '' })}
                    className="ml-auto text-xs text-gray-500 hover:text-blue-600"
                    title="필터 초기화"
                >
                    <i className="fas fa-sync-alt"></i>
                </button>

                <div className="text-xs text-gray-500">총 <span className="font-bold text-blue-600">{filteredQuestions.length}</span>문제</div>
            </div>

            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white font-bold text-gray-700 sticky top-0 shadow-sm z-10">
                        <tr>
                            <th className="p-3 w-16 text-center">ID</th>
                            <th className="p-3 w-28 text-center">평가유형</th>
                            <th className="p-3 w-24 text-center">유형</th>
                            <th className="p-3">문제</th>
                            <th className="p-3 w-40">정답</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {loading && (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-400">문제를 불러오는 중...</td>
                            </tr>
                        )}

                        {!loading && filteredQuestions.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-400">검색 결과가 없습니다.</td>
                            </tr>
                        )}

                        {!loading && filteredQuestions.map((q) => (
                            <tr key={`${q.id}-${q.question.slice(0, 10)}`} className="hover:bg-blue-50 transition">
                                <td className="p-3 text-center text-gray-500 text-xs">{q.id}</td>
                                <td className="p-3 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        q.category === 'diagnostic'
                                            ? 'bg-green-100 text-green-700'
                                            : q.category === 'formative'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-purple-100 text-purple-700'
                                    }`}>
                                        {q.category === 'diagnostic' ? '진단' : q.category === 'formative' ? '형성' : '실전'}
                                    </span>
                                </td>
                                <td className="p-3 text-center text-xs font-bold text-gray-600">{q.type}</td>
                                <td className="p-3">
                                    <div className="flex items-start gap-2">
                                        {q.image && <i className="fas fa-image text-blue-500 mt-1"></i>}
                                        <span className="font-bold text-gray-800 line-clamp-2">{q.question}</span>
                                    </div>
                                </td>
                                <td className="p-3 text-sm font-bold text-blue-600 truncate max-w-[140px]">{q.answer}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default QuizBankTab;
