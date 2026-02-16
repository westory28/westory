import React, { useEffect, useState, useRef } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

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
    node: { id: string, title: string };
    type: 'special' | 'normal'; // special = exam_prep
    parentTitle?: string;
    treeData: TreeUnit[];
    onOpenSettings: (category: string) => void;
}

const QuizEditor: React.FC<QuizEditorProps> = ({ node, type, parentTitle, treeData, onOpenSettings }) => {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [category, setCategory] = useState<string>('diagnostic');
    const [loading, setLoading] = useState(false);

    // Exam Prep Filters
    const [epFilter, setEpFilter] = useState({ big: '', mid: '', small: '' });

    // New Question Form
    const [formType, setFormType] = useState('choice');
    const [formText, setFormText] = useState('');
    const [formOptions, setFormOptions] = useState('');
    const [formAnswer, setFormAnswer] = useState('');
    const [formExp, setFormExp] = useState('');
    const [formImage, setFormImage] = useState<string | null>(null);
    const [formSubUnit, setFormSubUnit] = useState('');

    // Exam Prep Form Source
    const [epSource, setEpSource] = useState({ big: '', mid: '', small: '' });

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (type === 'special') {
            setCategory('exam_prep');
        } else {
            setCategory('diagnostic');
        }
        setEpFilter({ big: '', mid: '', small: '' });
        fetchQuestions();
    }, [node, type]);

    const fetchQuestions = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'quiz_questions'), where('unitId', '==', node.id));
            const snap = await getDocs(q);
            const list: Question[] = [];
            snap.forEach(d => list.push({ id: parseInt(d.id), ...d.data() } as Question));
            setQuestions(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) setFormImage(ev.target.result as string);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleAdd = async () => {
        if (!formText || !formAnswer) {
            alert("문제 내용과 정답은 필수입니다.");
            return;
        }

        const newId = Date.now();
        let subUnitId = null;
        let refIds = {};

        if (type === 'special') {
            refIds = { refBig: epSource.big, refMid: epSource.mid, refSmall: epSource.small };
            subUnitId = epSource.small || epSource.mid || epSource.big || null;
        } else {
            subUnitId = formSubUnit || null;
        }

        const newQ: Question = {
            id: newId,
            unitId: node.id,
            category,
            subUnitId,
            type: formType,
            question: formText,
            answer: formAnswer,
            options: formOptions ? formOptions.split(',').map(s => s.trim()) : [],
            explanation: formExp,
            image: formImage,
            ...refIds
        };

        try {
            // @ts-ignore - serverTimestamp type mismatch usually fine in standard usage
            await setDoc(doc(db, 'quiz_questions', String(newId)), {
                ...newQ,
                createdAt: serverTimestamp()
            });
            setQuestions([...questions, newQ]);
            resetForm();
        } catch (e) {
            console.error("Add failed", e);
            alert("등록 실패");
        }
    };

    const resetForm = () => {
        setFormText('');
        setFormOptions('');
        setFormAnswer('');
        setFormExp('');
        setFormImage(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDelete = async (id: number) => {
        if (!confirm("삭제하시겠습니까?")) return;
        try {
            await deleteDoc(doc(db, 'quiz_questions', String(id)));
            setQuestions(questions.filter(q => q.id !== id));
        } catch (e) {
            console.error("Delete failed", e);
        }
    };

    const filteredQuestions = questions.filter(q => {
        if (q.category !== category) return false;
        if (type === 'special') {
            if (epFilter.big && q.refBig !== epFilter.big) return false;
            if (epFilter.mid && q.refMid !== epFilter.mid) return false;
            if (epFilter.small && q.refSmall !== epFilter.small) return false;
        }
        return true;
    });

    // Subunit options for Normal Mode
    const subUnits = treeData.find(b => b.title === parentTitle)?.children?.find(m => m.id === node.id)?.children || [];

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <div>
                    <div className="text-xs text-gray-500 font-bold mb-1">
                        {type === 'special' ? '특별 학습' : `${parentTitle} > ${node.title}`}
                    </div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-gray-800">{node.title}</h2>
                        <button onClick={() => onOpenSettings(category)} className="text-gray-400 hover:text-blue-600 transition p-1">
                            <i className="fas fa-cog"></i>
                        </button>
                    </div>
                </div>
            </div>

            {/* Sub Tabs for Normal Mode */}
            {type !== 'special' && (
                <div className="flex border-b border-gray-200 px-4 pt-2">
                    {['diagnostic', 'formative'].map(cat => (
                        <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={`py-2 px-4 font-bold text-sm border-b-2 transition ${category === cat
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            {cat === 'diagnostic' ? '진단평가' : '형성평가'}
                        </button>
                    ))}
                </div>
            )}

            {/* Questions List */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                {loading ? <div className="text-center p-10 text-gray-400">문제 로딩 중...</div> :
                    filteredQuestions.length === 0 ? (
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
                                    <button onClick={() => handleDelete(q.id)} className="text-gray-300 hover:text-red-500">
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </div>
                                <div className="flex gap-4">
                                    {q.image && (
                                        <img src={q.image} alt="Q" className="w-16 h-16 object-cover rounded border border-gray-100" />
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

                {/* Add Form */}
                <div className="mt-8 bg-white p-5 rounded-xl border-2 border-dashed border-gray-300 relative">
                    <h3 className="font-bold text-gray-700 mb-4 flex items-center">
                        <i className="fas fa-plus-circle text-blue-500 mr-2"></i>새 문제 추가
                    </h3>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <select
                                value={formType}
                                onChange={(e) => setFormType(e.target.value)}
                                className="border p-2 rounded text-sm bg-gray-50"
                            >
                                <option value="choice">객관식</option>
                                <option value="ox">O/X</option>
                                <option value="word">단답형</option>
                                <option value="order">순서나열</option>
                            </select>

                            {type === 'normal' && (
                                <select
                                    value={formSubUnit}
                                    onChange={(e) => setFormSubUnit(e.target.value)}
                                    className="border p-2 rounded text-sm bg-gray-50"
                                >
                                    <option value="">소단원 (전체)</option>
                                    {subUnits.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                                </select>
                            )}
                        </div>

                        {/* TODO: Implement Cascading Selects for Exam Prep Source if needed, simplifying for now */}

                        <input
                            type="text"
                            placeholder="문제 내용"
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
                        {formImage && <img src={formImage} className="h-20 object-contain rounded border" />}

                        <input
                            type="text"
                            placeholder="보기 (콤마로 구분)"
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

                        <button
                            onClick={handleAdd}
                            className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition"
                        >
                            등록
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuizEditor;
