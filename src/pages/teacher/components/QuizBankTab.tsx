import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';

interface TreeUnit {
    id: string;
    title: string;
    children?: TreeUnit[];
}

interface Question {
    docId: string;
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
    options?: string[];
    explanation?: string;
    hintEnabled?: boolean;
    hint?: string;
}

interface QuestionStat {
    attempts: number;
    correct: number;
}

type SortKey = 'none' | 'rate' | 'category' | 'type';
type SortDirection = 'asc' | 'desc';

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

const QUESTION_TYPE_LABEL: Record<string, string> = {
    choice: '객관식',
    ox: 'O/X',
    word: '단답형',
    short: '단답형',
    order: '순서 나열형',
};

const QuizBankTab: React.FC = () => {
    const { config } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [questionStats, setQuestionStats] = useState<Record<string, QuestionStat>>({});
    const [treeData, setTreeData] = useState<TreeUnit[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<BankFilterState>({
        big: '',
        mid: '',
        small: '',
        type: '',
        evalType: '',
    });
    const [sortKey, setSortKey] = useState<SortKey>('none');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const toRoman = (value: number) => {
        const romans = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
        return romans[value] || String(value);
    };

    const [editCategory, setEditCategory] = useState('');
    const [editType, setEditType] = useState('');
    const [editQuestionText, setEditQuestionText] = useState('');
    const [editAnswerText, setEditAnswerText] = useState('');
    const [editExplanationText, setEditExplanationText] = useState('');
    const [editOptionsText, setEditOptionsText] = useState('');

    const toggleSort = (key: Exclude<SortKey, 'none'>) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDirection('desc');
            return;
        }
        if (sortDirection === 'desc') {
            setSortDirection('asc');
            return;
        }
        setSortKey('none');
        setSortDirection('desc');
    };

    const sortIndicator = (key: Exclude<SortKey, 'none'>) => {
        if (sortKey !== key) return 'fa-sort text-gray-300';
        return sortDirection === 'desc' ? 'fa-sort-down text-blue-600' : 'fa-sort-up text-blue-600';
    };

    useEffect(() => {
        const loadAll = async () => {
            setLoading(true);
            try {
                const [questionsResult, treeResult, statsResult] = await Promise.all([
                    loadQuestions(),
                    loadTreeData(),
                    loadQuestionStats(),
                ]);
                setQuestions(questionsResult);
                setTreeData(treeResult);
                setQuestionStats(statsResult);
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
                    docId: d.id,
                    id: Number.isNaN(parsed) ? 0 : parsed,
                    ...(d.data() as Omit<Question, 'id' | 'docId'>),
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

    const loadQuestionStats = async (): Promise<Record<string, QuestionStat>> => {
        try {
            let snap = await getDocs(collection(db, getSemesterCollectionPath(config, 'quiz_results')));
            if (snap.empty) {
                snap = await getDocs(collection(db, 'quiz_results'));
            }

            const stats: Record<string, QuestionStat> = {};
            snap.forEach((d) => {
                const details = (d.data() as any).details || [];
                details.forEach((item: any) => {
                    const qid = String(item.id);
                    if (!stats[qid]) {
                        stats[qid] = { attempts: 0, correct: 0 };
                    }
                    stats[qid].attempts += 1;
                    if (item.correct) {
                        stats[qid].correct += 1;
                    }
                });
            });
            return stats;
        } catch (error) {
            console.error(error);
            return {};
        }
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

    const treeIndexes = useMemo(() => {
        const bigOrder: Record<string, number> = {};
        const midOrder: Record<string, number> = {};
        const midToBig: Record<string, string> = {};

        treeData.forEach((big, bigIdx) => {
            bigOrder[big.id] = bigIdx + 1;
            (big.children || []).forEach((mid, midIdx) => {
                midOrder[mid.id] = midIdx + 1;
                midToBig[mid.id] = big.id;
            });
        });

        return { bigOrder, midOrder, midToBig };
    }, [treeData]);

    const questionDisplayCodes = useMemo(() => {
        const grouped: Record<string, Question[]> = {};

        const resolveBigMid = (q: Question) => {
            if (q.category === 'exam_prep') {
                return { bigId: q.refBig || '', midId: q.refMid || '' };
            }
            const midId = q.unitId || '';
            const bigId = treeIndexes.midToBig[midId] || q.refBig || '';
            return { bigId, midId };
        };

        questions.forEach((q) => {
            const { bigId, midId } = resolveBigMid(q);
            const key = `${bigId || 'x'}__${midId || 'x'}`;
            grouped[key] = grouped[key] || [];
            grouped[key].push(q);
        });

        const codeMap: Record<string, string> = {};
        Object.entries(grouped).forEach(([key, list]) => {
            const [bigId, midId] = key.split('__');
            const bigIndex = treeIndexes.bigOrder[bigId] || 0;
            const midIndex = treeIndexes.midOrder[midId] || 0;

            list
                .sort((a, b) => a.id - b.id || String(a.docId).localeCompare(String(b.docId)))
                .forEach((q, idx) => {
                    const bigPart = bigIndex > 0 ? toRoman(bigIndex) : '?';
                    const midPart = midIndex > 0 ? String(midIndex) : '?';
                    codeMap[q.docId] = `${bigPart}-${midPart}-${idx + 1}`;
                });
        });

        return codeMap;
    }, [questions, treeIndexes]);

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

        list.sort((a, b) => {
            if (sortKey === 'rate') {
                const aRate = getRateInfo(a).rate;
                const bRate = getRateInfo(b).rate;
                if (aRate !== bRate) return sortDirection === 'asc' ? aRate - bRate : bRate - aRate;
            }
            if (sortKey === 'category') {
                const aLabel = getCategoryLabel(a.category);
                const bLabel = getCategoryLabel(b.category);
                if (aLabel !== bLabel) {
                    return sortDirection === 'asc' ? aLabel.localeCompare(bLabel) : bLabel.localeCompare(aLabel);
                }
            }
            if (sortKey === 'type') {
                const aLabel = QUESTION_TYPE_LABEL[a.type] || a.type;
                const bLabel = QUESTION_TYPE_LABEL[b.type] || b.type;
                if (aLabel !== bLabel) {
                    return sortDirection === 'asc' ? aLabel.localeCompare(bLabel) : bLabel.localeCompare(aLabel);
                }
            }
            return a.id - b.id;
        });
        return list;
    }, [filters, questions, treeData, sortKey, sortDirection, questionStats]);

    const getRateInfo = (q: Question) => {
        const stat = questionStats[String(q.docId)] || questionStats[String(q.id)] || { attempts: 0, correct: 0 };
        if (!stat.attempts) {
            return { rate: 0, attempts: 0, text: '응시 없음' };
        }
        const rate = Math.round((stat.correct / stat.attempts) * 100);
        return { rate, attempts: stat.attempts, text: `${rate}% (${stat.correct}/${stat.attempts})` };
    };

    const getCategoryLabel = (category: string) => {
        if (category === 'diagnostic') return '진단';
        if (category === 'formative') return '형성';
        if (category === 'exam_prep') return '시험 대비';
        return '기타';
    };

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

    const openEditModal = (question: Question) => {
        setEditingQuestion(question);
        setEditCategory(question.category || 'diagnostic');
        setEditType(question.type || 'choice');
        setEditQuestionText(question.question || '');
        setEditAnswerText(String(question.answer || ''));
        setEditExplanationText(question.explanation || '');
        setEditOptionsText((question.options || []).join('\n'));
    };

    const closeEditModal = () => {
        if (savingEdit) return;
        setEditingQuestion(null);
        setEditCategory('');
        setEditType('');
        setEditQuestionText('');
        setEditAnswerText('');
        setEditExplanationText('');
        setEditOptionsText('');
    };

    const saveEditedQuestion = async () => {
        if (!editingQuestion) return;
        if (!editQuestionText.trim()) {
            alert('문제 내용을 입력하세요.');
            return;
        }
        if (!editAnswerText.trim()) {
            alert('정답을 입력하세요.');
            return;
        }

        const options = editOptionsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        const payload: Question = {
            ...editingQuestion,
            category: editCategory || editingQuestion.category,
            type: editType || editingQuestion.type,
            question: editQuestionText.trim(),
            answer: editAnswerText.trim(),
            explanation: editExplanationText.trim(),
            options,
        };

        setSavingEdit(true);
        try {
            await setDoc(
                doc(db, getSemesterDocPath(config, 'quiz_questions', String(editingQuestion.docId))),
                { ...payload, updatedAt: serverTimestamp() },
                { merge: true },
            );
            setQuestions((prev) => prev.map((q) => (q.docId === editingQuestion.docId ? payload : q)));
            closeEditModal();
        } catch (error: any) {
            console.error(error);
            alert(`문제 수정에 실패했습니다${error?.code ? ` (${error.code})` : ''}.`);
        } finally {
            setSavingEdit(false);
        }
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
                    <option value="order">순서 나열형</option>
                </select>

                <select value={filters.evalType} onChange={(e) => setFilters((prev) => ({ ...prev, evalType: e.target.value }))} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">평가 유형 전체</option>
                    <option value="diagnosis">진단평가</option>
                    <option value="formative">형성평가</option>
                    <option value="exam">학기 시험 대비</option>
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
                            <th className="p-3 w-24 text-center">번호</th>
                            <th className="p-3 w-28 text-center">
                                <button type="button" onClick={() => toggleSort('category')} className="inline-flex items-center gap-1 hover:text-blue-600">
                                    평가 유형
                                    <i className={`fas ${sortIndicator('category')} text-xs`}></i>
                                </button>
                            </th>
                            <th className="p-3 w-24 text-center">
                                <button type="button" onClick={() => toggleSort('type')} className="inline-flex items-center gap-1 hover:text-blue-600">
                                    문항 유형
                                    <i className={`fas ${sortIndicator('type')} text-xs`}></i>
                                </button>
                            </th>
                            <th className="p-3">문제</th>
                            <th className="p-3 w-40">정답</th>
                            <th className="p-3 w-48">
                                <button type="button" onClick={() => toggleSort('rate')} className="inline-flex items-center gap-1 hover:text-blue-600">
                                    정답률
                                    <i className={`fas ${sortIndicator('rate')} text-xs`}></i>
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {loading && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-400">문제를 불러오는 중...</td>
                            </tr>
                        )}

                        {!loading && filteredQuestions.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-400">검색 결과가 없습니다.</td>
                            </tr>
                        )}

                        {!loading && filteredQuestions.map((q) => (
                            <tr
                                key={`${q.docId}-${q.question.slice(0, 10)}`}
                                className="hover:bg-blue-50 transition cursor-pointer"
                                onClick={() => openEditModal(q)}
                            >
                                <td className="p-3 text-center text-gray-500 text-xs" title={`문항 ID: ${q.docId}`}>{questionDisplayCodes[q.docId] || '-'}</td>
                                <td className="p-3 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        q.category === 'diagnostic'
                                            ? 'bg-green-100 text-green-700'
                                            : q.category === 'formative'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-purple-100 text-purple-700'
                                    }`}>
                                        {q.category === 'diagnostic' ? '진단' : q.category === 'formative' ? '형성' : '시험 대비'}
                                    </span>
                                </td>
                                <td className="p-3 text-center text-xs font-bold text-gray-600">{QUESTION_TYPE_LABEL[q.type] || q.type}</td>
                                <td className="p-3">
                                    <div className="flex items-start gap-2">
                                        {q.image && <i className="fas fa-image text-blue-500 mt-1"></i>}
                                        <span className="font-bold text-gray-800 line-clamp-2">{q.question}</span>
                                    </div>
                                </td>
                                <td className="p-3 text-sm font-bold text-blue-600 truncate max-w-[140px]">{q.answer}</td>
                                <td className="p-3">
                                    <div className="text-xs font-bold text-gray-700 mb-1">{getRateInfo(q).text}</div>
                                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${getRateInfo(q).rate}%` }}></div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {editingQuestion && (
                <div className="fixed inset-0 z-50">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/45"
                        onClick={closeEditModal}
                        aria-label="문제 수정 팝업 닫기"
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-bold text-gray-800 text-lg flex items-center">
                                        <i className="fas fa-pen text-blue-500 mr-2"></i>
                                        문제 수정
                                    </h3>
                                    <div className="mt-2 text-xs text-gray-500">
                                        문항 ID: {editingQuestion.docId} / 표시 번호: {questionDisplayCodes[editingQuestion.docId] || '-'}
                                    </div>
                                </div>
                                <button type="button" onClick={closeEditModal} className="text-gray-400 hover:text-gray-700">
                                    <i className="fas fa-times text-lg"></i>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                        <option value="diagnostic">진단평가</option>
                                        <option value="formative">형성평가</option>
                                        <option value="exam_prep">학기 시험 대비</option>
                                    </select>
                                    <select value={editType} onChange={(e) => setEditType(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                        <option value="choice">객관식</option>
                                        <option value="ox">O/X</option>
                                        <option value="word">단답형</option>
                                        <option value="order">순서 나열형</option>
                                    </select>
                                </div>

                                <textarea
                                    value={editQuestionText}
                                    onChange={(e) => setEditQuestionText(e.target.value)}
                                    placeholder="문제 내용"
                                    className="w-full border p-2 rounded text-sm min-h-[90px]"
                                />

                                <input
                                    type="text"
                                    value={editAnswerText}
                                    onChange={(e) => setEditAnswerText(e.target.value)}
                                    placeholder="정답"
                                    className="w-full border p-2 rounded text-sm"
                                />

                                <textarea
                                    value={editOptionsText}
                                    onChange={(e) => setEditOptionsText(e.target.value)}
                                    placeholder="보기/순서 항목 (줄바꿈으로 구분, 선택 입력)"
                                    className="w-full border p-2 rounded text-sm min-h-[90px]"
                                />

                                <textarea
                                    value={editExplanationText}
                                    onChange={(e) => setEditExplanationText(e.target.value)}
                                    placeholder="해설 (선택)"
                                    className="w-full border p-2 rounded text-sm min-h-[80px]"
                                />

                                <div className="grid grid-cols-2 gap-2">
                                    <button type="button" onClick={closeEditModal} className="bg-gray-100 text-gray-700 font-bold py-2 rounded hover:bg-gray-200 transition">
                                        취소
                                    </button>
                                    <button type="button" onClick={() => void saveEditedQuestion()} disabled={savingEdit} className="bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition disabled:bg-blue-300">
                                        {savingEdit ? '저장 중...' : '수정 저장'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuizBankTab;
