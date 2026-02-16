import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../../lib/firebase';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';

interface TreeUnit {
    id: string;
    title: string;
    children?: TreeUnit[];
}

interface Question {
    id: number;
    unitId: string;
    subUnitId?: string | null;
    category: string;
    type: string;
    question: string;
    options?: string[];
    answer: string;
    explanation?: string;
    image?: string | null;
    refBig?: string;
    refMid?: string;
    refSmall?: string;
}

interface QuizEditorProps {
    node: { id: string; title: string };
    type: 'special' | 'normal';
    parentTitle?: string;
    treeData: TreeUnit[];
    onOpenSettings: (category: string) => void;
}

interface CascadingFilter {
    big: string;
    mid: string;
    small: string;
}

const QuizEditor: React.FC<QuizEditorProps> = ({ node, type, parentTitle, treeData, onOpenSettings }) => {
    const { config } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [category, setCategory] = useState<string>('diagnostic');
    const [loading, setLoading] = useState(false);
    const [epFilter, setEpFilter] = useState<CascadingFilter>({ big: '', mid: '', small: '' });
    const [epSource, setEpSource] = useState<CascadingFilter>({ big: '', mid: '', small: '' });

    const [formType, setFormType] = useState('choice');
    const [formText, setFormText] = useState('');
    const [formOptions, setFormOptions] = useState('');
    const [formAnswer, setFormAnswer] = useState('');
    const [formExp, setFormExp] = useState('');
    const [formImage, setFormImage] = useState<string | null>(null);
    const [formSubUnit, setFormSubUnit] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (type === 'special') {
            setCategory('exam_prep');
        } else {
            setCategory('diagnostic');
        }
        setEpFilter({ big: '', mid: '', small: '' });
        setEpSource({ big: '', mid: '', small: '' });
        void fetchQuestions();
    }, [config, node, type]);

    const fetchQuestions = async () => {
        setLoading(true);
        try {
            const scopedRef = collection(db, getSemesterCollectionPath(config, 'quiz_questions'));
            let snap = await getDocs(query(scopedRef, where('unitId', '==', node.id)));
            if (snap.empty) {
                const legacyRef = collection(db, 'quiz_questions');
                snap = await getDocs(query(legacyRef, where('unitId', '==', node.id)));
            }

            const list: Question[] = [];
            snap.forEach((d) => {
                list.push({ id: parseInt(d.id, 10), ...(d.data() as Omit<Question, 'id'>) });
            });
            setQuestions(list);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const allBigUnits = useMemo(() => treeData, [treeData]);
    const filterMidUnits = useMemo(() => allBigUnits.find((big) => big.id === epFilter.big)?.children || [], [allBigUnits, epFilter.big]);
    const filterSmallUnits = useMemo(() => filterMidUnits.find((mid) => mid.id === epFilter.mid)?.children || [], [filterMidUnits, epFilter.mid]);
    const sourceMidUnits = useMemo(() => allBigUnits.find((big) => big.id === epSource.big)?.children || [], [allBigUnits, epSource.big]);
    const sourceSmallUnits = useMemo(() => sourceMidUnits.find((mid) => mid.id === epSource.mid)?.children || [], [sourceMidUnits, epSource.mid]);

    const normalSubUnits = useMemo(
        () => treeData.find((big) => big.title === parentTitle)?.children?.find((mid) => mid.id === node.id)?.children || [],
        [treeData, parentTitle, node.id],
    );

    const filteredQuestions = useMemo(() => {
        const list = questions.filter((q) => {
            if (q.category !== category) return false;
            if (type !== 'special') return true;

            if (epFilter.big && q.refBig !== epFilter.big) return false;
            if (epFilter.mid && q.refMid !== epFilter.mid) return false;
            if (epFilter.small && q.refSmall !== epFilter.small) return false;
            return true;
        });

        return list.sort((a, b) => a.id - b.id);
    }, [category, epFilter.big, epFilter.mid, epFilter.small, questions, type]);

    const resetForm = () => {
        setFormText('');
        setFormOptions('');
        setFormAnswer('');
        setFormExp('');
        setFormImage(null);
        if (type !== 'special') {
            setFormSubUnit('');
        } else {
            setEpSource({ big: '', mid: '', small: '' });
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) {
                setFormImage(ev.target.result as string);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleAdd = async () => {
        if (!formText.trim() || !formAnswer.trim()) {
            alert('문제 내용과 정답은 필수입니다.');
            return;
        }

        const newId = Date.now();
        const newQuestion: Question = {
            id: newId,
            unitId: node.id,
            subUnitId: type === 'special' ? (epSource.small || epSource.mid || epSource.big || null) : (formSubUnit || null),
            category,
            type: formType,
            question: formText,
            answer: formAnswer,
            options: formOptions ? formOptions.split(',').map((s) => s.trim()) : [],
            explanation: formExp,
            image: formImage,
            refBig: type === 'special' ? (epSource.big || undefined) : undefined,
            refMid: type === 'special' ? (epSource.mid || undefined) : undefined,
            refSmall: type === 'special' ? (epSource.small || undefined) : undefined,
        };

        try {
            await setDoc(doc(db, getSemesterDocPath(config, 'quiz_questions', String(newId))), {
                ...newQuestion,
                createdAt: serverTimestamp(),
            });
            setQuestions((prev) => [...prev, newQuestion]);
            resetForm();
        } catch (error) {
            console.error('Add question failed', error);
            alert('문제 등록에 실패했습니다.');
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('이 문제를 삭제하시겠습니까?')) return;
        try {
            try {
                await deleteDoc(doc(db, getSemesterDocPath(config, 'quiz_questions', String(id))));
            } catch {
                await deleteDoc(doc(db, 'quiz_questions', String(id)));
            }
            setQuestions((prev) => prev.filter((q) => q.id !== id));
        } catch (error) {
            console.error('Delete question failed', error);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <div>
                    <div className="text-xs text-gray-500 font-bold mb-1">
                        {type === 'special' ? '학기 시험 대비' : `${parentTitle} > ${node.title}`}
                    </div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-gray-800">{node.title}</h2>
                        <button onClick={() => onOpenSettings(category)} className="text-gray-400 hover:text-blue-600 transition p-1" title="평가 설정">
                            <i className="fas fa-cog"></i>
                        </button>
                    </div>
                </div>
            </div>

            {type !== 'special' && (
                <div className="flex border-b border-gray-200 px-4 pt-2">
                    {['diagnostic', 'formative'].map((cat) => (
                        <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={`py-2 px-4 font-bold text-sm border-b-2 transition ${category === cat ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        >
                            {cat === 'diagnostic' ? '진단평가' : '형성평가'}
                        </button>
                    ))}
                </div>
            )}

            {type === 'special' && (
                <div className="bg-blue-50 border-b border-blue-100 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <i className="fas fa-filter text-blue-500"></i>
                        <span className="font-bold text-blue-800 mr-1">단원 필터</span>
                        <select
                            value={epFilter.big}
                            onChange={(e) => setEpFilter({ big: e.target.value, mid: '', small: '' })}
                            className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white"
                        >
                            <option value="">대단원 전체</option>
                            {allBigUnits.map((big) => (
                                <option key={big.id} value={big.id}>{big.title}</option>
                            ))}
                        </select>
                        <i className="fas fa-chevron-right text-blue-300 text-xs"></i>
                        <select
                            value={epFilter.mid}
                            onChange={(e) => setEpFilter((prev) => ({ ...prev, mid: e.target.value, small: '' }))}
                            className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white"
                        >
                            <option value="">중단원 전체</option>
                            {filterMidUnits.map((mid) => (
                                <option key={mid.id} value={mid.id}>{mid.title}</option>
                            ))}
                        </select>
                        <i className="fas fa-chevron-right text-blue-300 text-xs"></i>
                        <select
                            value={epFilter.small}
                            onChange={(e) => setEpFilter((prev) => ({ ...prev, small: e.target.value }))}
                            className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white"
                        >
                            <option value="">소단원 전체</option>
                            {filterSmallUnits.map((small) => (
                                <option key={small.id} value={small.id}>{small.title}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => setEpFilter({ big: '', mid: '', small: '' })}
                            className="ml-auto text-xs text-blue-400 hover:text-blue-600"
                            title="필터 초기화"
                        >
                            <i className="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                {loading ? (
                    <div className="text-center p-10 text-gray-400">문제를 불러오는 중...</div>
                ) : filteredQuestions.length === 0 ? (
                    <div className="text-center p-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                        등록된 문제가 없습니다.
                    </div>
                ) : (
                    filteredQuestions.map((q, idx) => (
                        <div key={q.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm relative group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded">
                                    Q{idx + 1} | {q.type}
                                </span>
                                <button onClick={() => void handleDelete(q.id)} className="text-gray-300 hover:text-red-500">
                                    <i className="fas fa-trash"></i>
                                </button>
                            </div>
                            <div className="flex gap-4">
                                {q.image && (
                                    <img src={q.image} alt="문항 이미지" className="w-16 h-16 object-cover rounded border border-gray-100" />
                                )}
                                <div>
                                    <p className="font-bold text-gray-800 mb-2 text-sm">{q.question}</p>
                                    <div className="text-xs text-gray-500">
                                        <span className="text-blue-600 font-bold mr-2">정답: {q.answer}</span>
                                        {q.options && q.options.length > 0 && (
                                            <span className="text-xs text-gray-400">({q.options.join(', ')})</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}

                <div className="mt-8 bg-white p-5 rounded-xl border-2 border-dashed border-gray-300 relative">
                    <h3 className="font-bold text-gray-700 mb-4 flex items-center">
                        <i className="fas fa-plus-circle text-blue-500 mr-2"></i>새 문제 추가
                    </h3>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <select value={formType} onChange={(e) => setFormType(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                <option value="choice">객관식</option>
                                <option value="ox">O/X</option>
                                <option value="word">단답형</option>
                                <option value="order">순서 배열</option>
                            </select>

                            {type === 'normal' && (
                                <select value={formSubUnit} onChange={(e) => setFormSubUnit(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                    <option value="">소단원 전체</option>
                                    {normalSubUnits.map((sub) => (
                                        <option key={sub.id} value={sub.id}>{sub.title}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {type === 'special' && (
                            <div className="bg-blue-50 p-2 rounded border border-blue-100">
                                <div className="text-xs font-bold text-blue-600 mb-1 flex items-center">
                                    <i className="fas fa-tag mr-1"></i>문항 출처 단원
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <select
                                        value={epSource.big}
                                        onChange={(e) => setEpSource({ big: e.target.value, mid: '', small: '' })}
                                        className="border border-blue-200 rounded p-1.5 text-xs bg-white"
                                    >
                                        <option value="">대단원 선택</option>
                                        {allBigUnits.map((big) => (
                                            <option key={big.id} value={big.id}>{big.title}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={epSource.mid}
                                        onChange={(e) => setEpSource((prev) => ({ ...prev, mid: e.target.value, small: '' }))}
                                        className="border border-blue-200 rounded p-1.5 text-xs bg-white"
                                    >
                                        <option value="">중단원 선택</option>
                                        {sourceMidUnits.map((mid) => (
                                            <option key={mid.id} value={mid.id}>{mid.title}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={epSource.small}
                                        onChange={(e) => setEpSource((prev) => ({ ...prev, small: e.target.value }))}
                                        className="border border-blue-200 rounded p-1.5 text-xs bg-white"
                                    >
                                        <option value="">소단원 선택</option>
                                        {sourceSmallUnits.map((small) => (
                                            <option key={small.id} value={small.id}>{small.title}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        <input
                            type="text"
                            placeholder="문제 내용을 입력하세요"
                            value={formText}
                            onChange={(e) => setFormText(e.target.value)}
                            className="w-full border p-2 rounded text-sm"
                        />

                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer hover:text-blue-600 bg-gray-100 px-3 py-1 rounded transition">
                                <i className="fas fa-image"></i> 이미지 첨부
                                <input
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    ref={fileInputRef}
                                    onChange={handleImageSelect}
                                />
                            </label>
                            {formImage && <span className="text-xs text-green-600 font-bold">이미지 선택됨</span>}
                        </div>
                        {formImage && <img src={formImage} alt="미리보기" className="h-20 object-contain rounded border" />}

                        <input
                            type="text"
                            placeholder="보기 (쉼표로 구분)"
                            value={formOptions}
                            onChange={(e) => setFormOptions(e.target.value)}
                            className="w-full border p-2 rounded text-sm"
                        />
                        <input
                            type="text"
                            placeholder="정답"
                            value={formAnswer}
                            onChange={(e) => setFormAnswer(e.target.value)}
                            className="w-full border p-2 rounded text-sm font-bold text-blue-600"
                        />
                        <textarea
                            placeholder="해설 (선택)"
                            value={formExp}
                            onChange={(e) => setFormExp(e.target.value)}
                            className="w-full border p-2 rounded text-sm h-16 resize-none"
                        />

                        <button onClick={() => void handleAdd()} className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition">
                            등록
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuizEditor;
