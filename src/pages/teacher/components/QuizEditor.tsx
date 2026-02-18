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

type QuestionType = 'choice' | 'ox' | 'word' | 'order';

interface Question {
    id: number;
    unitId: string;
    subUnitId?: string | null;
    category: string;
    type: QuestionType;
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

const ORDER_DELIMITER = '||';
const TYPE_LABEL: Record<QuestionType, string> = {
    choice: '객관식',
    ox: 'O/X',
    word: '단답형',
    order: '순서 나열형',
};

const shuffle = <T,>(input: T[]): T[] => {
    const list = [...input];
    for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
};

const QuizEditor: React.FC<QuizEditorProps> = ({ node, type, parentTitle, treeData, onOpenSettings }) => {
    const { config } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [category, setCategory] = useState<string>('diagnostic');
    const [loading, setLoading] = useState(false);
    const [epFilter, setEpFilter] = useState<CascadingFilter>({ big: '', mid: '', small: '' });
    const [epSource, setEpSource] = useState<CascadingFilter>({ big: '', mid: '', small: '' });

    const [formType, setFormType] = useState<QuestionType>('choice');
    const [formText, setFormText] = useState('');
    const [formExp, setFormExp] = useState('');
    const [formImage, setFormImage] = useState<string | null>(null);
    const [formSubUnit, setFormSubUnit] = useState('');
    const [choiceOptions, setChoiceOptions] = useState<string[]>(['', '']);
    const [choiceAnswerIndex, setChoiceAnswerIndex] = useState<number | null>(null);
    const [oxAnswer, setOxAnswer] = useState<'O' | 'X' | ''>('');
    const [wordAnswer, setWordAnswer] = useState('');
    const [orderItems, setOrderItems] = useState<string[]>(['', '']);

    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewChoiceAnswer, setPreviewChoiceAnswer] = useState('');
    const [previewOxAnswer, setPreviewOxAnswer] = useState('');
    const [previewWordAnswer, setPreviewWordAnswer] = useState('');
    const [previewOrderPool, setPreviewOrderPool] = useState<string[]>([]);
    const [previewOrderAnswer, setPreviewOrderAnswer] = useState<string[]>([]);
    const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);

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

    const trimList = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);
    const resetPreview = () => {
        setPreviewChoiceAnswer('');
        setPreviewOxAnswer('');
        setPreviewWordAnswer('');
        setPreviewOrderAnswer([]);
    };

    const resetForm = () => {
        setEditingQuestionId(null);
        setFormText('');
        setFormExp('');
        setFormImage(null);
        setChoiceOptions(['', '']);
        setChoiceAnswerIndex(null);
        setOxAnswer('');
        setWordAnswer('');
        setOrderItems(['', '']);
        setPreviewOpen(false);
        resetPreview();
        if (type !== 'special') setFormSubUnit('');
        else setEpSource({ big: '', mid: '', small: '' });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) setFormImage(ev.target.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleTypeChange = (nextType: QuestionType) => {
        setFormType(nextType);
        setPreviewOpen(false);
        resetPreview();
    };

    const startEdit = (question: Question) => {
        setEditingQuestionId(question.id);
        setFormType(question.type);
        setFormText(question.question || '');
        setFormExp(question.explanation || '');
        setFormImage(question.image || null);
        setPreviewOpen(false);
        resetPreview();

        if (type === 'normal') {
            setFormSubUnit(question.subUnitId || '');
        } else {
            setEpSource({
                big: question.refBig || '',
                mid: question.refMid || '',
                small: question.refSmall || '',
            });
        }

        if (question.type === 'choice') {
            const options = (question.options || []).filter(Boolean);
            const normalizedOptions = options.length >= 2 ? options : ['', ''];
            setChoiceOptions(normalizedOptions);
            const answerIndex = normalizedOptions.findIndex((opt) => opt.trim() === String(question.answer).trim());
            setChoiceAnswerIndex(answerIndex >= 0 ? answerIndex : null);
            setOxAnswer('');
            setWordAnswer('');
            setOrderItems(['', '']);
            return;
        }

        if (question.type === 'ox') {
            setChoiceOptions(['', '']);
            setChoiceAnswerIndex(null);
            setOxAnswer(question.answer === 'O' || question.answer === 'X' ? question.answer : '');
            setWordAnswer('');
            setOrderItems(['', '']);
            return;
        }

        if (question.type === 'word') {
            setChoiceOptions(['', '']);
            setChoiceAnswerIndex(null);
            setOxAnswer('');
            setWordAnswer(String(question.answer || ''));
            setOrderItems(['', '']);
            return;
        }

        const orderOptions = (question.options && question.options.length > 0)
            ? question.options
            : String(question.answer || '')
                .split(ORDER_DELIMITER)
                .filter(Boolean);
        setChoiceOptions(['', '']);
        setChoiceAnswerIndex(null);
        setOxAnswer('');
        setWordAnswer('');
        setOrderItems(orderOptions.length >= 2 ? orderOptions : ['', '']);
    };

    const addChoiceOption = () => setChoiceOptions((prev) => [...prev, '']);
    const removeChoiceOption = (index: number) => {
        if (choiceOptions.length <= 2) return;
        setChoiceOptions((prev) => prev.filter((_, i) => i !== index));
        if (choiceAnswerIndex === index) setChoiceAnswerIndex(null);
        if (choiceAnswerIndex !== null && choiceAnswerIndex > index) setChoiceAnswerIndex(choiceAnswerIndex - 1);
    };
    const moveOrderItem = (index: number, direction: 'up' | 'down') => {
        setOrderItems((prev) => {
            const target = direction === 'up' ? index - 1 : index + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const openPreview = () => {
        const opening = !previewOpen;
        setPreviewOpen(opening);
        resetPreview();
        if (opening && formType === 'order') setPreviewOrderPool(shuffle(trimList(orderItems)));
    };

    const buildQuestionPayload = (): { answer: string; options: string[] } | null => {
        if (!formText.trim()) {
            alert('문제 내용을 입력하세요.');
            return null;
        }
        if (formType === 'choice') {
            const options = trimList(choiceOptions);
            if (options.length < 2) return alert('객관식 보기는 최소 2개 이상 필요합니다.'), null;
            if (choiceAnswerIndex === null) return alert('객관식 정답 보기를 선택하세요.'), null;
            const answer = choiceOptions[choiceAnswerIndex]?.trim() || '';
            if (!answer) return alert('정답으로 선택한 보기에 내용을 입력하세요.'), null;
            return { answer, options };
        }
        if (formType === 'ox') {
            if (!oxAnswer) return alert('O/X 정답을 선택하세요.'), null;
            return { answer: oxAnswer, options: ['O', 'X'] };
        }
        if (formType === 'word') {
            if (!wordAnswer.trim()) return alert('단답형 정답을 입력하세요.'), null;
            return { answer: wordAnswer.trim(), options: [] };
        }
        const options = trimList(orderItems);
        if (options.length < 2) return alert('순서 나열형 항목은 최소 2개 이상 필요합니다.'), null;
        return { answer: options.join(ORDER_DELIMITER), options };
    };

    const handleAdd = async () => {
        const payload = buildQuestionPayload();
        if (!payload) return;
        const targetId = editingQuestionId ?? Date.now();
        const newQuestion: Question = {
            id: targetId,
            unitId: node.id,
            subUnitId: type === 'special' ? (epSource.small || epSource.mid || epSource.big || null) : (formSubUnit || null),
            category,
            type: formType,
            question: formText.trim(),
            answer: payload.answer,
            options: payload.options,
            explanation: formExp.trim(),
            image: formImage,
            ...(type === 'special' && epSource.big ? { refBig: epSource.big } : {}),
            ...(type === 'special' && epSource.mid ? { refMid: epSource.mid } : {}),
            ...(type === 'special' && epSource.small ? { refSmall: epSource.small } : {}),
        };
        try {
            await setDoc(
                doc(db, getSemesterDocPath(config, 'quiz_questions', String(targetId))),
                {
                    ...newQuestion,
                    updatedAt: serverTimestamp(),
                    ...(editingQuestionId ? {} : { createdAt: serverTimestamp() }),
                },
                { merge: true },
            );
            setQuestions((prev) => (
                editingQuestionId
                    ? prev.map((q) => (q.id === targetId ? newQuestion : q))
                    : [...prev, newQuestion]
            ));
            resetForm();
        } catch (error: any) {
            console.error('Add question failed', error);
            const code = error?.code ? ` (${error.code})` : '';
            alert(`문제 등록에 실패했습니다${code}.`);
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

    const formatAnswer = (question: Question) => {
        if (question.type === 'order') return question.answer.split(ORDER_DELIMITER).join(' -> ');
        return question.answer;
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <div>
                    <div className="text-xs text-gray-500 font-bold mb-1">{type === 'special' ? '학기 시험 대비' : `${parentTitle} > ${node.title}`}</div>
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
                        <span className="font-bold text-blue-800 mr-1">단원 필터</span>
                        <select value={epFilter.big} onChange={(e) => setEpFilter({ big: e.target.value, mid: '', small: '' })} className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white">
                            <option value="">대단원 전체</option>
                            {allBigUnits.map((big) => <option key={big.id} value={big.id}>{big.title}</option>)}
                        </select>
                        <select value={epFilter.mid} onChange={(e) => setEpFilter((prev) => ({ ...prev, mid: e.target.value, small: '' }))} className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white">
                            <option value="">중단원 전체</option>
                            {filterMidUnits.map((mid) => <option key={mid.id} value={mid.id}>{mid.title}</option>)}
                        </select>
                        <select value={epFilter.small} onChange={(e) => setEpFilter((prev) => ({ ...prev, small: e.target.value }))} className="border border-blue-200 rounded px-2 py-1 text-xs w-28 bg-white">
                            <option value="">소단원 전체</option>
                            {filterSmallUnits.map((small) => <option key={small.id} value={small.id}>{small.title}</option>)}
                        </select>
                        <button onClick={() => setEpFilter({ big: '', mid: '', small: '' })} className="ml-auto text-xs text-blue-400 hover:text-blue-600" title="필터 초기화">
                            <i className="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                {loading ? (
                    <div className="text-center p-10 text-gray-400">문제를 불러오는 중...</div>
                ) : filteredQuestions.length === 0 ? (
                    <div className="text-center p-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">등록된 문제가 없습니다.</div>
                ) : (
                    filteredQuestions.map((q, idx) => (
                        <div key={q.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                                <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded">Q{idx + 1} | {TYPE_LABEL[q.type] || q.type}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => startEdit(q)}
                                        className="text-gray-300 hover:text-blue-500"
                                        title="문제 수정"
                                    >
                                        <i className="fas fa-pen"></i>
                                    </button>
                                    <button onClick={() => void handleDelete(q.id)} className="text-gray-300 hover:text-red-500" title="문제 삭제"><i className="fas fa-trash"></i></button>
                                </div>
                            </div>
                            <p className="font-bold text-gray-800 mb-1 text-sm">{q.question}</p>
                            <p className="text-xs text-gray-500">
                                <span className="text-blue-600 font-bold mr-2">정답: {formatAnswer(q)}</span>
                                {q.options && q.options.length > 0 ? `(${q.options.join(', ')})` : ''}
                            </p>
                        </div>
                    ))
                )}

                <div className="mt-8 bg-white p-5 rounded-xl border-2 border-dashed border-gray-300">
                    <h3 className="font-bold text-gray-700 mb-4 flex items-center">
                        <i className={`fas ${editingQuestionId ? 'fa-pen' : 'fa-plus-circle'} text-blue-500 mr-2`}></i>
                        {editingQuestionId ? '문제 수정' : '새 문제 추가'}
                    </h3>
                    <div className="space-y-4">
                        <div className={`grid gap-3 ${type === 'normal' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <select value={formType} onChange={(e) => handleTypeChange(e.target.value as QuestionType)} className="border p-2 rounded text-sm bg-gray-50">
                                <option value="choice">객관식</option>
                                <option value="ox">O/X</option>
                                <option value="word">단답형</option>
                                <option value="order">순서 나열형</option>
                            </select>
                            {type === 'normal' && (
                                <select value={formSubUnit} onChange={(e) => setFormSubUnit(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                    <option value="">소단원 전체</option>
                                    {normalSubUnits.map((sub) => <option key={sub.id} value={sub.id}>{sub.title}</option>)}
                                </select>
                            )}
                        </div>

                        {type === 'special' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-blue-50 p-2 rounded border border-blue-100">
                                <select value={epSource.big} onChange={(e) => setEpSource({ big: e.target.value, mid: '', small: '' })} className="border border-blue-200 rounded p-1.5 text-xs bg-white">
                                    <option value="">대단원 선택</option>
                                    {allBigUnits.map((big) => <option key={big.id} value={big.id}>{big.title}</option>)}
                                </select>
                                <select value={epSource.mid} onChange={(e) => setEpSource((prev) => ({ ...prev, mid: e.target.value, small: '' }))} className="border border-blue-200 rounded p-1.5 text-xs bg-white">
                                    <option value="">중단원 선택</option>
                                    {sourceMidUnits.map((mid) => <option key={mid.id} value={mid.id}>{mid.title}</option>)}
                                </select>
                                <select value={epSource.small} onChange={(e) => setEpSource((prev) => ({ ...prev, small: e.target.value }))} className="border border-blue-200 rounded p-1.5 text-xs bg-white">
                                    <option value="">소단원 선택</option>
                                    {sourceSmallUnits.map((small) => <option key={small.id} value={small.id}>{small.title}</option>)}
                                </select>
                            </div>
                        )}

                        <input type="text" placeholder="문제 내용을 입력하세요" value={formText} onChange={(e) => setFormText(e.target.value)} className="w-full border p-2 rounded text-sm" />

                        <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer hover:text-blue-600 bg-gray-100 px-3 py-1 rounded transition w-fit">
                            <i className="fas fa-image"></i> 이미지 첨부
                            <input type="file" className="hidden" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} />
                        </label>

                        {formType === 'choice' && (
                            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-gray-600">객관식 보기</p>
                                    <button type="button" onClick={addChoiceOption} className="text-xs font-bold text-blue-600 hover:text-blue-700"><i className="fas fa-plus mr-1"></i>보기 추가</button>
                                </div>
                                {choiceOptions.map((option, index) => (
                                    <div key={`choice-option-${index}`} className="flex items-center gap-2">
                                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">{index + 1}</span>
                                        <input type="text" value={option} onChange={(e) => setChoiceOptions((prev) => prev.map((opt, i) => (i === index ? e.target.value : opt)))} placeholder={`${index + 1}번 보기`} className="flex-1 border rounded p-2 text-sm bg-white" />
                                        <button type="button" onClick={() => setChoiceAnswerIndex(index)} className={`text-xs px-2 py-1 rounded border ${choiceAnswerIndex === index ? 'border-blue-500 bg-blue-100 text-blue-700 font-bold' : 'border-gray-300 text-gray-500'}`}>정답</button>
                                        <button type="button" onClick={() => removeChoiceOption(index)} className="text-gray-400 hover:text-red-500 px-1"><i className="fas fa-times"></i></button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {formType === 'ox' && (
                            <div className="grid grid-cols-2 gap-2">
                                {(['O', 'X'] as const).map((value) => (
                                    <button key={value} type="button" onClick={() => setOxAnswer(value)} className={`py-3 rounded-lg border-2 font-bold transition ${oxAnswer === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500 hover:border-blue-300'}`}>{value}</button>
                                ))}
                            </div>
                        )}

                        {formType === 'word' && <input type="text" value={wordAnswer} onChange={(e) => setWordAnswer(e.target.value)} placeholder="단답형 정답 입력" className="w-full border rounded p-2 text-sm bg-white" />}

                        {formType === 'order' && (
                            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-gray-600">순서 항목 (위에서 아래 순서가 정답)</p>
                                    <button type="button" onClick={() => setOrderItems((prev) => [...prev, ''])} className="text-xs font-bold text-blue-600 hover:text-blue-700"><i className="fas fa-plus mr-1"></i>항목 추가</button>
                                </div>
                                {orderItems.map((item, index) => (
                                    <div key={`order-item-${index}`} className="flex items-center gap-2">
                                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">{index + 1}</span>
                                        <input type="text" value={item} onChange={(e) => setOrderItems((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))} className="flex-1 border rounded p-2 text-sm bg-white" />
                                        <button type="button" onClick={() => moveOrderItem(index, 'up')} className="text-gray-400 hover:text-blue-600 px-1"><i className="fas fa-arrow-up"></i></button>
                                        <button type="button" onClick={() => moveOrderItem(index, 'down')} className="text-gray-400 hover:text-blue-600 px-1"><i className="fas fa-arrow-down"></i></button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <textarea placeholder="해설 (선택)" value={formExp} onChange={(e) => setFormExp(e.target.value)} className="w-full border p-2 rounded text-sm h-16 resize-none" />

                        {previewOpen && (
                            <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                                <div className="text-sm font-bold text-blue-800">학생 화면 미리보기</div>
                                <div className="bg-white rounded-lg border border-blue-100 p-4">
                                    <h4 className="font-bold text-gray-800 mb-4">{formText || '문제 문구를 입력하면 여기 표시됩니다.'}</h4>
                                    {formType === 'choice' && trimList(choiceOptions).map((opt, index) => (
                                        <button key={`preview-choice-${index}`} type="button" onClick={() => setPreviewChoiceAnswer(opt)} className={`w-full border-2 rounded-lg p-3 text-left transition flex items-center gap-2 mb-2 ${previewChoiceAnswer === opt ? 'border-blue-500 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200 hover:border-blue-300'}`}>
                                            <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center ${previewChoiceAnswer === opt ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{index + 1}</span>
                                            <span>{opt}</span>
                                        </button>
                                    ))}
                                    {formType === 'ox' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['O', 'X'] as const).map((opt) => <button key={`preview-ox-${opt}`} type="button" onClick={() => setPreviewOxAnswer(opt)} className={`border-2 rounded-lg py-3 font-bold transition ${previewOxAnswer === opt ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300'}`}>{opt}</button>)}
                                        </div>
                                    )}
                                    {formType === 'word' && <input type="text" value={previewWordAnswer} onChange={(e) => setPreviewWordAnswer(e.target.value)} placeholder="정답 입력 칸 미리보기" className="w-full border-b-2 border-gray-300 p-2 text-center text-sm focus:border-blue-500 outline-none" />}
                                    {formType === 'order' && (
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap gap-2">
                                                {previewOrderPool.map((item) => <button key={`preview-order-pool-${item}`} type="button" onClick={() => !previewOrderAnswer.includes(item) && setPreviewOrderAnswer((prev) => [...prev, item])} className={`px-3 py-2 rounded border-2 text-sm transition ${previewOrderAnswer.includes(item) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300'}`}>{item}</button>)}
                                            </div>
                                            <div className="rounded border border-dashed border-blue-300 bg-white p-3 min-h-[60px]">
                                                {previewOrderAnswer.map((item, index) => <button key={`preview-order-selected-${index}-${item}`} type="button" onClick={() => setPreviewOrderAnswer((prev) => prev.filter((_, i) => i !== index))} className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold mr-2 mb-2">{index + 1}. {item}</button>)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className={`grid gap-2 ${editingQuestionId ? 'grid-cols-3' : 'grid-cols-2'}`}>
                            <button type="button" onClick={openPreview} className={`font-bold py-2 rounded transition border ${previewOpen ? 'bg-white text-blue-700 border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-700'}`}>{previewOpen ? '미리보기 닫기' : '미리보기'}</button>
                            <button onClick={() => void handleAdd()} className="bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition">{editingQuestionId ? '수정 저장' : '등록'}</button>
                            {editingQuestionId && (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="bg-gray-100 text-gray-700 font-bold py-2 rounded hover:bg-gray-200 transition"
                                >
                                    취소
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuizEditor;
