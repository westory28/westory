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
    image?: string | null;
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

type QuestionType = 'choice' | 'ox' | 'word' | 'order';
type SortKey = 'none' | 'code' | 'rate' | 'category' | 'type';
type SortDirection = 'asc' | 'desc';

interface BankFilterState {
    big: string;
    mid: string;
    small: string;
}
const ORDER_DELIMITER = '||';

const QUESTION_TYPE_LABEL: Record<string, string> = {
    choice: '객관식',
    ox: 'O/X',
    word: '단답형',
    short: '단답형',
    order: '순서 나열형',
};

const normalizeQuestionType = (type: string): QuestionType => (type === 'short' ? 'word' : ((type as QuestionType) || 'choice'));

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
    });
    const [sortKey, setSortKey] = useState<SortKey>('none');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const toRoman = (value: number) => {
        const romans = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
        return romans[value] || String(value);
    };

    const [editCategory, setEditCategory] = useState('diagnostic');
    const [editType, setEditType] = useState<QuestionType>('choice');
    const [editQuestionText, setEditQuestionText] = useState('');
    const [editExplanationText, setEditExplanationText] = useState('');
    const [editImage, setEditImage] = useState<string | null>(null);
    const [editChoiceOptions, setEditChoiceOptions] = useState<string[]>(['', '']);
    const [editChoiceAnswerIndex, setEditChoiceAnswerIndex] = useState<number | null>(null);
    const [editOxAnswer, setEditOxAnswer] = useState<'O' | 'X' | ''>('');
    const [editWordAnswer, setEditWordAnswer] = useState('');
    const [editOrderItems, setEditOrderItems] = useState<string[]>(['', '']);
    const [editHintEnabled, setEditHintEnabled] = useState(false);
    const [editHintText, setEditHintText] = useState('');
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewChoiceAnswer, setPreviewChoiceAnswer] = useState('');
    const [previewOxAnswer, setPreviewOxAnswer] = useState('');
    const [previewWordAnswer, setPreviewWordAnswer] = useState('');
    const [previewOrderPool, setPreviewOrderPool] = useState<string[]>([]);
    const [previewOrderAnswer, setPreviewOrderAnswer] = useState<string[]>([]);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    const trimList = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);
    const shuffle = <T,>(input: T[]): T[] => {
        const list = [...input];
        for (let i = list.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
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

    const questionDisplayMeta = useMemo(() => {
        const map: Record<string, { big: number; mid: number; seq: number }> = {};
        const grouped: Record<string, Question[]> = {};

        questions.forEach((q) => {
            const bigId = q.category === 'exam_prep' ? (q.refBig || '') : (treeIndexes.midToBig[q.unitId || ''] || q.refBig || '');
            const midId = q.category === 'exam_prep' ? (q.refMid || '') : (q.unitId || '');
            const key = `${bigId || 'x'}__${midId || 'x'}`;
            grouped[key] = grouped[key] || [];
            grouped[key].push(q);
        });

        Object.entries(grouped).forEach(([key, list]) => {
            const [bigId, midId] = key.split('__');
            const bigIndex = treeIndexes.bigOrder[bigId] || 0;
            const midIndex = treeIndexes.midOrder[midId] || 0;
            list
                .sort((a, b) => a.id - b.id || String(a.docId).localeCompare(String(b.docId)))
                .forEach((q, idx) => {
                    map[q.docId] = { big: bigIndex, mid: midIndex, seq: idx + 1 };
                });
        });

        return map;
    }, [questions, treeIndexes]);

    function getRateInfo(q: Question) {
        const stat = questionStats[String(q.docId)] || questionStats[String(q.id)] || { attempts: 0, correct: 0 };
        if (!stat.attempts) {
            return { rate: 0, attempts: 0, text: '응시 없음' };
        }
        const rate = Math.round((stat.correct / stat.attempts) * 100);
        return { rate, attempts: stat.attempts, text: `${rate}% (${stat.correct}/${stat.attempts})` };
    }

    function getCategoryLabel(category: string) {
        if (category === 'diagnostic') return '진단';
        if (category === 'formative') return '형성';
        if (category === 'exam_prep') return '시험 대비';
        return '기타';
    }

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

            return true;
        });

        list.sort((a, b) => {
            if (sortKey === 'code') {
                const am = questionDisplayMeta[a.docId] || { big: 0, mid: 0, seq: 0 };
                const bm = questionDisplayMeta[b.docId] || { big: 0, mid: 0, seq: 0 };
                if (am.big !== bm.big) return sortDirection === 'asc' ? am.big - bm.big : bm.big - am.big;
                if (am.mid !== bm.mid) return sortDirection === 'asc' ? am.mid - bm.mid : bm.mid - am.mid;
                if (am.seq !== bm.seq) return sortDirection === 'asc' ? am.seq - bm.seq : bm.seq - am.seq;
            }
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
    }, [filters, questions, treeData, sortKey, sortDirection, questionStats, questionDisplayMeta]);

    const getCategoryPillLabel = (category: string) => {
        if (category === 'diagnostic') return '진단평가';
        if (category === 'formative') return '형성평가';
        if (category === 'exam_prep') return '학기 시험 대비';
        return '기타';
    };

    const getNodeTitle = (id?: string) => {
        if (!id) return '';
        for (const big of treeData) {
            if (big.id === id) return big.title;
            for (const mid of big.children || []) {
                if (mid.id === id) return mid.title;
                for (const small of mid.children || []) {
                    if (small.id === id) return small.title;
                }
            }
        }
        return id;
    };

    const getQuestionPathText = (q: Question) => {
        let bigId = '';
        let midId = '';
        let smallId = '';
        if (q.category === 'exam_prep') {
            bigId = q.refBig || '';
            midId = q.refMid || '';
            smallId = q.refSmall || '';
        } else {
            midId = q.unitId || '';
            smallId = q.subUnitId || '';
            bigId = treeIndexes.midToBig[midId] || q.refBig || '';
        }
        const bigTitle = getNodeTitle(bigId) || '대단원 미지정';
        const midTitle = getNodeTitle(midId) || '중단원 미지정';
        const smallTitle = getNodeTitle(smallId) || '소단원 전체';
        return `${bigTitle} > ${midTitle} > ${smallTitle}`;
    };

    const addChoiceOption = () => setEditChoiceOptions((prev) => [...prev, '']);
    const removeChoiceOption = (index: number) => {
        if (editChoiceOptions.length <= 2) return;
        setEditChoiceOptions((prev) => prev.filter((_, i) => i !== index));
        if (editChoiceAnswerIndex === index) setEditChoiceAnswerIndex(null);
        if (editChoiceAnswerIndex !== null && editChoiceAnswerIndex > index) setEditChoiceAnswerIndex(editChoiceAnswerIndex - 1);
    };

    const moveOrderItem = (index: number, direction: 'up' | 'down') => {
        setEditOrderItems((prev) => {
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
        setPreviewChoiceAnswer('');
        setPreviewOxAnswer('');
        setPreviewWordAnswer('');
        setPreviewOrderAnswer([]);
        if (opening && editType === 'order') {
            setPreviewOrderPool(shuffle(trimList(editOrderItems)));
        }
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) setEditImage(ev.target.result as string);
        };
        reader.readAsDataURL(file);
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
        const normalizedType = normalizeQuestionType(question.type);
        setEditingQuestion(question);
        setEditCategory(question.category || 'diagnostic');
        setEditType(normalizedType);
        setEditQuestionText(question.question || '');
        setEditExplanationText(question.explanation || '');
        setEditImage(question.image || null);
        setEditHintEnabled(!!(question.hintEnabled && question.hint));
        setEditHintText(question.hint || '');
        setPreviewOpen(false);
        setPreviewChoiceAnswer('');
        setPreviewOxAnswer('');
        setPreviewWordAnswer('');
        setPreviewOrderPool([]);
        setPreviewOrderAnswer([]);

        if (normalizedType === 'choice') {
            const options = (question.options || []).filter(Boolean);
            const normalizedOptions = options.length >= 2 ? options : ['', ''];
            setEditChoiceOptions(normalizedOptions);
            const answerIndex = normalizedOptions.findIndex((opt) => opt.trim() === String(question.answer).trim());
            setEditChoiceAnswerIndex(answerIndex >= 0 ? answerIndex : null);
            setEditOxAnswer('');
            setEditWordAnswer('');
            setEditOrderItems(['', '']);
            return;
        }

        if (normalizedType === 'ox') {
            setEditChoiceOptions(['', '']);
            setEditChoiceAnswerIndex(null);
            setEditOxAnswer(question.answer === 'O' || question.answer === 'X' ? question.answer : '');
            setEditWordAnswer('');
            setEditOrderItems(['', '']);
            return;
        }

        if (normalizedType === 'word') {
            setEditChoiceOptions(['', '']);
            setEditChoiceAnswerIndex(null);
            setEditOxAnswer('');
            setEditWordAnswer(String(question.answer || ''));
            setEditOrderItems(['', '']);
            return;
        }

        const orderOptions = (question.options && question.options.length > 0)
            ? question.options
            : String(question.answer || '')
                .split(ORDER_DELIMITER)
                .filter(Boolean);
        setEditChoiceOptions(['', '']);
        setEditChoiceAnswerIndex(null);
        setEditOxAnswer('');
        setEditWordAnswer('');
        setEditOrderItems(orderOptions.length >= 2 ? orderOptions : ['', '']);
    };

    const buildCurrentEditSnapshot = () => {
        const choiceOptions = trimList(editChoiceOptions);
        const orderOptions = trimList(editOrderItems);
        let answer = '';
        let options: string[] = [];

        if (editType === 'choice') {
            answer = editChoiceAnswerIndex !== null ? (editChoiceOptions[editChoiceAnswerIndex]?.trim() || '') : '';
            options = choiceOptions;
        } else if (editType === 'ox') {
            answer = editOxAnswer;
            options = ['O', 'X'];
        } else if (editType === 'word') {
            answer = editWordAnswer.trim();
            options = [];
        } else {
            answer = orderOptions.join(ORDER_DELIMITER);
            options = orderOptions;
        }

        return {
            category: editCategory || 'diagnostic',
            type: editType,
            question: editQuestionText.trim(),
            explanation: editExplanationText.trim(),
            image: editImage || '',
            options,
            answer,
            hintEnabled: editHintEnabled,
            hint: editHintEnabled ? editHintText.trim() : '',
        };
    };

    const buildOriginalEditSnapshot = (question: Question) => {
        const normalizedType = normalizeQuestionType(question.type);
        let options: string[] = [];
        let answer = '';

        if (normalizedType === 'choice') {
            options = trimList(question.options || []);
            answer = String(question.answer || '').trim();
        } else if (normalizedType === 'ox') {
            options = ['O', 'X'];
            answer = question.answer === 'O' || question.answer === 'X' ? question.answer : '';
        } else if (normalizedType === 'word') {
            options = [];
            answer = String(question.answer || '').trim();
        } else {
            options = trimList(
                (question.options && question.options.length > 0)
                    ? question.options
                    : String(question.answer || '').split(ORDER_DELIMITER),
            );
            answer = options.join(ORDER_DELIMITER);
        }

        return {
            category: question.category || 'diagnostic',
            type: normalizedType,
            question: (question.question || '').trim(),
            explanation: (question.explanation || '').trim(),
            image: question.image || '',
            options,
            answer,
            hintEnabled: !!(question.hintEnabled && question.hint),
            hint: question.hintEnabled && question.hint ? String(question.hint).trim() : '',
        };
    };

    const hasUnsavedEditChanges = useMemo(() => {
        if (!editingQuestion) return false;
        const current = buildCurrentEditSnapshot();
        const original = buildOriginalEditSnapshot(editingQuestion);
        return JSON.stringify(current) !== JSON.stringify(original);
    }, [
        editingQuestion,
        editCategory,
        editType,
        editQuestionText,
        editExplanationText,
        editImage,
        editChoiceOptions,
        editChoiceAnswerIndex,
        editOxAnswer,
        editWordAnswer,
        editOrderItems,
        editHintEnabled,
        editHintText,
    ]);

    const closeEditModal = (force = false) => {
        if (savingEdit) return;
        if (!force && hasUnsavedEditChanges) {
            const confirmed = window.confirm('수정 중인 내용이 있습니다. 정말로 닫으시겠습니까?');
            if (!confirmed) return;
        }
        setEditingQuestion(null);
        setEditCategory('diagnostic');
        setEditType('choice');
        setEditQuestionText('');
        setEditExplanationText('');
        setEditImage(null);
        setEditChoiceOptions(['', '']);
        setEditChoiceAnswerIndex(null);
        setEditOxAnswer('');
        setEditWordAnswer('');
        setEditOrderItems(['', '']);
        setEditHintEnabled(false);
        setEditHintText('');
        setPreviewOpen(false);
        setPreviewChoiceAnswer('');
        setPreviewOxAnswer('');
        setPreviewWordAnswer('');
        setPreviewOrderPool([]);
        setPreviewOrderAnswer([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const saveEditedQuestion = async () => {
        if (!editingQuestion) return;
        if (!editQuestionText.trim()) {
            alert('문제 내용을 입력하세요.');
            return;
        }

        const choiceOptions = trimList(editChoiceOptions);
        const orderOptions = trimList(editOrderItems);
        let answer = '';
        let options: string[] = [];

        if (editType === 'choice') {
            if (choiceOptions.length < 2) {
                alert('객관식 보기는 최소 2개 이상 필요합니다.');
                return;
            }
            if (editChoiceAnswerIndex === null) {
                alert('객관식 정답 보기를 선택하세요.');
                return;
            }
            answer = editChoiceOptions[editChoiceAnswerIndex]?.trim() || '';
            if (!answer) {
                alert('정답으로 선택한 보기에 내용을 입력하세요.');
                return;
            }
            options = choiceOptions;
        } else if (editType === 'ox') {
            if (!editOxAnswer) {
                alert('O/X 정답을 선택하세요.');
                return;
            }
            answer = editOxAnswer;
            options = ['O', 'X'];
        } else if (editType === 'word') {
            if (!editWordAnswer.trim()) {
                alert('단답형 정답을 입력하세요.');
                return;
            }
            answer = editWordAnswer.trim();
            options = [];
        } else {
            if (orderOptions.length < 2) {
                alert('순서 나열형 항목은 최소 2개 이상 필요합니다.');
                return;
            }
            answer = orderOptions.join(ORDER_DELIMITER);
            options = orderOptions;
        }

        if (editHintEnabled && !editHintText.trim()) {
            alert('힌트 제공을 선택한 경우 힌트 내용을 입력하세요.');
            return;
        }

        const payload: Question = {
            ...editingQuestion,
            category: editCategory || editingQuestion.category,
            type: editType || (editingQuestion.type as QuestionType),
            question: editQuestionText.trim(),
            answer,
            explanation: editExplanationText.trim(),
            // Firestore rejects undefined values (invalid-argument),
            // so we store null when the editor has no image.
            image: editImage || null,
            options,
            hintEnabled: editHintEnabled,
            hint: editHintEnabled ? editHintText.trim() : '',
        };

        setSavingEdit(true);
        try {
            await setDoc(
                doc(db, getSemesterDocPath(config, 'quiz_questions', String(editingQuestion.docId))),
                { ...payload, updatedAt: serverTimestamp() },
                { merge: true },
            );
            setQuestions((prev) => prev.map((q) => (q.docId === editingQuestion.docId ? payload : q)));
            closeEditModal(true);
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
                <span className="text-gray-400 text-sm font-bold">{'>'}</span>

                <select value={filters.mid} onChange={(e) => handleMidChange(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">중단원 전체</option>
                    {midOptions.map((mid) => (
                        <option key={mid.id} value={mid.id}>{mid.title}</option>
                    ))}
                </select>
                <span className="text-gray-400 text-sm font-bold">{'>'}</span>

                <select value={filters.small} onChange={(e) => setFilters((prev) => ({ ...prev, small: e.target.value }))} className="border rounded px-2 py-1 text-sm bg-white">
                    <option value="">소단원 전체</option>
                    {smallOptions.map((small) => (
                        <option key={small.id} value={small.id}>{small.title}</option>
                    ))}
                </select>

                <button
                    onClick={() => setFilters({ big: '', mid: '', small: '' })}
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
                            <th className="p-3 w-24 text-center">
                                <button type="button" onClick={() => toggleSort('code')} className="inline-flex items-center gap-1 hover:text-blue-600 whitespace-nowrap">
                                    번호
                                    <i className={`fas ${sortIndicator('code')} text-xs`}></i>
                                </button>
                            </th>
                            <th className="p-3 w-28 text-center">
                                <button type="button" onClick={() => toggleSort('category')} className="inline-flex items-center gap-1 hover:text-blue-600">
                                    평가 유형
                                    <i className={`fas ${sortIndicator('category')} text-xs`}></i>
                                </button>
                            </th>
                            <th className="p-3 w-32 text-center whitespace-nowrap">
                                <button type="button" onClick={() => toggleSort('type')} className="inline-flex items-center gap-1 hover:text-blue-600 whitespace-nowrap">
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
                                <td className="p-3 text-center text-xs font-bold text-gray-600 whitespace-nowrap">{QUESTION_TYPE_LABEL[q.type] || q.type}</td>
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
                <div className="fixed inset-0 z-50" onClick={() => closeEditModal()}>
                    <div className="absolute inset-0 bg-black/45" />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div
                            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-bold text-gray-800 text-lg flex items-center">
                                        <i className="fas fa-pen text-blue-500 mr-2"></i>
                                        문제 수정
                                    </h3>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                        <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 font-bold">{getQuestionPathText(editingQuestion)}</span>
                                        <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold">{getCategoryPillLabel(editCategory)}</span>
                                    </div>
                                </div>
                                <button type="button" onClick={() => closeEditModal()} className="text-gray-400 hover:text-gray-700">
                                    <i className="fas fa-times text-lg"></i>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <select value={editType} onChange={(e) => setEditType(e.target.value as QuestionType)} className="border p-2 rounded text-sm bg-gray-50">
                                        <option value="choice">객관식</option>
                                        <option value="ox">O/X</option>
                                        <option value="word">단답형</option>
                                        <option value="order">순서 나열형</option>
                                    </select>
                                    <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="border p-2 rounded text-sm bg-gray-50">
                                        <option value="diagnostic">진단평가</option>
                                        <option value="formative">형성평가</option>
                                        <option value="exam_prep">학기 시험 대비</option>
                                    </select>
                                </div>

                                <input
                                    type="text"
                                    value={editQuestionText}
                                    onChange={(e) => setEditQuestionText(e.target.value)}
                                    placeholder="문제 내용"
                                    className="w-full border p-2 rounded text-sm"
                                />

                                <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer hover:text-blue-600 bg-gray-100 px-3 py-1 rounded transition w-fit">
                                    <i className="fas fa-image"></i> 이미지 첨부
                                    <input type="file" className="hidden" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} />
                                </label>
                                {editImage && (
                                    <div className="relative border rounded p-2 bg-gray-50">
                                        <img src={editImage} alt="문항 첨부 이미지" className="max-h-44 mx-auto rounded" />
                                        <button type="button" onClick={() => setEditImage(null)} className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-white border text-gray-500 hover:text-red-500">
                                            제거
                                        </button>
                                    </div>
                                )}

                                {editType === 'choice' && (
                                    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold text-gray-600">객관식 보기</p>
                                            <button type="button" onClick={addChoiceOption} className="text-xs font-bold text-blue-600 hover:text-blue-700"><i className="fas fa-plus mr-1"></i>보기 추가</button>
                                        </div>
                                        {editChoiceOptions.map((option, index) => (
                                            <div key={`choice-option-${index}`} className="flex items-center gap-2">
                                                <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">{index + 1}</span>
                                                <input type="text" value={option} onChange={(e) => setEditChoiceOptions((prev) => prev.map((opt, i) => (i === index ? e.target.value : opt)))} placeholder={`${index + 1}번 보기`} className="flex-1 border rounded p-2 text-sm bg-white" />
                                                <button type="button" onClick={() => setEditChoiceAnswerIndex(index)} className={`text-xs px-2 py-1 rounded border ${editChoiceAnswerIndex === index ? 'border-blue-500 bg-blue-100 text-blue-700 font-bold' : 'border-gray-300 text-gray-500'}`}>정답</button>
                                                <button type="button" onClick={() => removeChoiceOption(index)} className="text-gray-400 hover:text-red-500 px-1"><i className="fas fa-times"></i></button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {editType === 'ox' && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {(['O', 'X'] as const).map((value) => (
                                            <button key={value} type="button" onClick={() => setEditOxAnswer(value)} className={`py-3 rounded-lg border-2 font-bold transition ${editOxAnswer === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500 hover:border-blue-300'}`}>{value}</button>
                                        ))}
                                    </div>
                                )}

                                {editType === 'word' && (
                                    <input type="text" value={editWordAnswer} onChange={(e) => setEditWordAnswer(e.target.value)} placeholder="단답형 정답 입력" className="w-full border rounded p-2 text-sm bg-white" />
                                )}

                                {editType === 'order' && (
                                    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold text-gray-600">순서 항목 (위에서 아래 순서가 정답)</p>
                                            <button type="button" onClick={() => setEditOrderItems((prev) => [...prev, ''])} className="text-xs font-bold text-blue-600 hover:text-blue-700"><i className="fas fa-plus mr-1"></i>항목 추가</button>
                                        </div>
                                        {editOrderItems.map((item, index) => (
                                            <div key={`order-item-${index}`} className="flex items-center gap-2">
                                                <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">{index + 1}</span>
                                                <input type="text" value={item} onChange={(e) => setEditOrderItems((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))} className="flex-1 border rounded p-2 text-sm bg-white" />
                                                <button type="button" onClick={() => moveOrderItem(index, 'up')} className="text-gray-400 hover:text-blue-600 px-1"><i className="fas fa-arrow-up"></i></button>
                                                <button type="button" onClick={() => moveOrderItem(index, 'down')} className="text-gray-400 hover:text-blue-600 px-1"><i className="fas fa-arrow-down"></i></button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <textarea
                                    value={editExplanationText}
                                    onChange={(e) => setEditExplanationText(e.target.value)}
                                    placeholder="해설 (선택)"
                                    className="w-full border p-2 rounded text-sm min-h-[80px]"
                                />

                                <div className="border border-gray-200 rounded-lg p-3 bg-amber-50">
                                    <label className="inline-flex items-center gap-2 text-sm font-bold text-amber-800 cursor-pointer">
                                        <input type="checkbox" checked={editHintEnabled} onChange={(e) => setEditHintEnabled(e.target.checked)} />
                                        힌트 제공
                                    </label>
                                    {editHintEnabled && (
                                        <textarea
                                            placeholder="학생에게 보여줄 힌트를 입력하세요"
                                            value={editHintText}
                                            onChange={(e) => setEditHintText(e.target.value)}
                                            className="mt-2 w-full border p-2 rounded text-sm h-16 resize-none bg-white"
                                        />
                                    )}
                                </div>

                                {previewOpen && (
                                    <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                                        <div className="text-sm font-bold text-blue-800">학생 화면 미리보기</div>
                                        <div className="bg-white rounded-lg border border-blue-100 p-4">
                                            <h4 className="font-bold text-gray-800 mb-4">{editQuestionText || '문제 문구를 입력하면 여기 표시됩니다.'}</h4>
                                            {editType === 'choice' && trimList(editChoiceOptions).map((opt, index) => (
                                                <button key={`preview-choice-${index}`} type="button" onClick={() => setPreviewChoiceAnswer(opt)} className={`w-full border-2 rounded-lg p-3 text-left transition flex items-center gap-2 mb-2 ${previewChoiceAnswer === opt ? 'border-blue-500 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200 hover:border-blue-300'}`}>
                                                    <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center ${previewChoiceAnswer === opt ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{index + 1}</span>
                                                    <span>{opt}</span>
                                                </button>
                                            ))}
                                            {editType === 'ox' && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    {(['O', 'X'] as const).map((opt) => <button key={`preview-ox-${opt}`} type="button" onClick={() => setPreviewOxAnswer(opt)} className={`border-2 rounded-lg py-3 font-bold transition ${previewOxAnswer === opt ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300'}`}>{opt}</button>)}
                                                </div>
                                            )}
                                            {editType === 'word' && <input type="text" value={previewWordAnswer} onChange={(e) => setPreviewWordAnswer(e.target.value)} placeholder="정답 입력 칸 미리보기" className="w-full border-b-2 border-gray-300 p-2 text-center text-sm focus:border-blue-500 outline-none" />}
                                            {editType === 'order' && (
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

                                <div className="grid grid-cols-3 gap-2">
                                    <button type="button" onClick={openPreview} className={`font-bold py-2 rounded transition border ${previewOpen ? 'bg-white text-blue-700 border-blue-500' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-700'}`}>
                                        {previewOpen ? '미리보기 닫기' : '미리보기'}
                                    </button>
                                    <button type="button" onClick={() => void saveEditedQuestion()} disabled={savingEdit} className="bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition disabled:bg-blue-300">
                                        {savingEdit ? '저장 중...' : '수정 저장'}
                                    </button>
                                    <button type="button" onClick={() => closeEditModal()} className="bg-gray-100 text-gray-700 font-bold py-2 rounded hover:bg-gray-200 transition">
                                        취소
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
