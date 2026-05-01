import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

type WrongNoteReadScope = 'current' | 'history';
type WrongNoteSource = 'current' | 'legacy';

interface StudentWrongNoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    studentId: string;
    studentName: string;
    readScope?: WrongNoteReadScope;
    launchContextLabel?: string;
}

interface WrongItem {
    key: string;
    question: string;
    userAnswer: string;
    answer: string;
    explanation: string;
    unitTitle: string;
    categoryLabel: string;
    timeText: string;
}

const categoryLabel = (category?: string) => {
    if (category === 'diagnostic') return '진단평가';
    if (category === 'formative') return '형성평가';
    if (category === 'exam_prep') return '학기 시험 대비';
    return '기타';
};

const chunk = <T,>(arr: T[], size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const StudentWrongNoteModal: React.FC<StudentWrongNoteModalProps> = ({
    isOpen,
    onClose,
    studentId,
    studentName,
    readScope = 'current',
    launchContextLabel,
}) => {
    const { config } = useAuth();
    const allowLegacyLookup = readScope === 'history';
    const [loading, setLoading] = useState(false);
    const [source, setSource] = useState<WrongNoteSource>('current');
    const [wrongItems, setWrongItems] = useState<WrongItem[]>([]);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setSource('current');
    }, [isOpen, studentId, readScope]);

    useEffect(() => {
        if (!isOpen || !studentId) return;
        void loadWrongNotes(allowLegacyLookup ? source : 'current');
    }, [allowLegacyLookup, config, isOpen, source, studentId]);

    const loadWrongNotes = async (selectedSource: WrongNoteSource) => {
        setLoading(true);
        setWrongItems([]);
        setExpandedKey(null);

        const resultCollectionPath =
            selectedSource === 'legacy' ? 'quiz_results' : getSemesterCollectionPath(config, 'quiz_results');
        const curriculumCollectionPath =
            selectedSource === 'legacy' ? 'curriculum' : getSemesterCollectionPath(config, 'curriculum');
        const questionCollectionPath =
            selectedSource === 'legacy' ? 'quiz_questions' : getSemesterCollectionPath(config, 'quiz_questions');

        try {
            const resultSnap = await getDocs(query(collection(db, resultCollectionPath), where('uid', '==', studentId)));

            const results: any[] = [];
            resultSnap.forEach((doc) => results.push({ id: doc.id, ...doc.data() }));
            results.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

            const wrongLogs: Array<{
                qid: string;
                userAnswer: string;
                unitId: string;
                category: string;
                timeText: string;
            }> = [];

            results.forEach((result) => {
                (result.details || []).forEach((detail: any) => {
                    if (detail.correct) return;
                    wrongLogs.push({
                        qid: String(detail.id || ''),
                        userAnswer: detail.u || '',
                        unitId: result.unitId || '',
                        category: result.category || '',
                        timeText: result.timestamp?.seconds
                            ? new Date(result.timestamp.seconds * 1000).toLocaleString('ko-KR')
                            : (result.timeString || '-'),
                    });
                });
            });

            if (wrongLogs.length === 0) return;

            const unitTitleMap: Record<string, string> = { exam_prep: '학기 시험 대비' };
            try {
                const treeSnap = await getDoc(doc(db, curriculumCollectionPath, 'tree'));
                const tree = treeSnap.exists() ? ((treeSnap.data() as any).tree || []) : [];
                tree.forEach((big: any) =>
                    (big.children || []).forEach((mid: any) => {
                        if (mid?.id && mid?.title) unitTitleMap[mid.id] = mid.title;
                    }),
                );
            } catch (error) {
                console.error(error);
            }

            const questionIds = Array.from(new Set(wrongLogs.map((item) => item.qid).filter(Boolean)));
            const questionMap: Record<string, any> = {};

            if (questionIds.length > 0) {
                await Promise.all(
                    chunk(questionIds, 10).map(async (ids) => {
                        const questionSnap = await getDocs(
                            query(collection(db, questionCollectionPath), where(documentId(), 'in', ids)),
                        );
                        questionSnap.forEach((doc) => {
                            questionMap[doc.id] = doc.data();
                        });
                    }),
                );
            }

            const seen = new Set<string>();
            const items: WrongItem[] = [];
            wrongLogs.forEach((log) => {
                const questionDoc = questionMap[log.qid] || {};
                const key = `${log.qid}_${log.unitId}_${log.category}`;
                if (seen.has(key)) return;
                seen.add(key);
                items.push({
                    key,
                    question: String(questionDoc.question || '문항 정보 없음'),
                    userAnswer: log.userAnswer || '(미입력)',
                    answer: questionDoc.answer ? String(questionDoc.answer) : '-',
                    explanation: String(questionDoc.explanation || '해설이 등록되지 않았습니다.'),
                    unitTitle: unitTitleMap[log.unitId] || log.unitId || '단원 정보 없음',
                    categoryLabel: categoryLabel(log.category),
                    timeText: log.timeText,
                });
            });

            setWrongItems(items);
        } catch (error) {
            console.error(error);
            setWrongItems([]);
        } finally {
            setLoading(false);
        }
    };

    const groupedItems = useMemo(() => {
        const grouped: Record<string, WrongItem[]> = {};
        wrongItems.forEach((item) => {
            const key = `${item.unitTitle}_${item.categoryLabel}`;
            grouped[key] = grouped[key] || [];
            grouped[key].push(item);
        });
        return Object.entries(grouped);
    }, [wrongItems]);

    const activeSource = allowLegacyLookup ? source : 'current';
    const scopeBadgeLabel = allowLegacyLookup
        ? (activeSource === 'legacy' ? '이전 기록 조회 중' : '현재 학기 조회 중')
        : '현재 학기 전용';
    const scopeDescription = allowLegacyLookup
        ? (activeSource === 'legacy'
            ? `${launchContextLabel ? `${launchContextLabel}에서 연 ` : ''}오답 조회 창입니다. 이전 기록만 따로 확인하고 있습니다.`
            : `${launchContextLabel ? `${launchContextLabel}에서 연 ` : ''}오답 조회 창입니다. 현재 학기 오답을 먼저 보여 주며, 필요하면 이전 기록으로 전환할 수 있습니다.`)
        : `${launchContextLabel ? `${launchContextLabel}에서 연 ` : ''}현재 학기 오답만 확인합니다. 이전 기록은 이 화면에 섞어 보여 주지 않습니다.`;
    const loadingText = activeSource === 'legacy' ? '이전 오답 기록을 불러오는 중...' : '현재 학기 오답 노트를 불러오는 중...';
    const emptyTitle = activeSource === 'legacy' ? '이전 오답 기록이 없습니다.' : '현재 학기 오답 기록이 없습니다.';
    const emptyDescription = activeSource === 'legacy'
        ? '이 학생의 이전 학기 오답 기록은 아직 확인되지 않았습니다.'
        : allowLegacyLookup
            ? '현재 운영 학기에는 아직 오답 기록이 없습니다. 과거 오답은 상단에서 이전 기록을 선택해 확인해 주세요.'
            : '현재 운영 학기 제출 기준으로 아직 오답 기록이 없습니다.';

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">{studentName} 오답 노트</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                                {scopeBadgeLabel}
                            </span>
                            {launchContextLabel && (
                                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                                    {launchContextLabel}
                                </span>
                            )}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">학생 이름을 클릭하면 오답 기록과 문항 해설을 바로 확인할 수 있습니다.</p>
                        <p className="mt-1 text-xs text-gray-400">{scopeDescription}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded hover:bg-gray-100">
                        <i className="fas fa-times text-gray-400"></i>
                    </button>
                </div>

                {allowLegacyLookup && (
                    <div className="px-5 pt-4">
                        <div className="flex gap-2">
                            {(['current', 'legacy'] as WrongNoteSource[]).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setSource(item)}
                                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                                        source === item
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {item === 'current' ? '현재 학기 오답' : '이전 기록'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-5">
                    {loading ? (
                        <div className="text-center py-12 text-gray-500">{loadingText}</div>
                    ) : groupedItems.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                            <div className="text-sm font-bold text-gray-500">{emptyTitle}</div>
                            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-gray-400">{emptyDescription}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {groupedItems.map(([groupKey, items]) => (
                                <div key={groupKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-gray-50 text-sm font-bold text-gray-700">
                                        {items[0].unitTitle} / {items[0].categoryLabel}
                                    </div>
                                    <div className="divide-y divide-gray-100">
                                        {items.map((item) => (
                                            <div key={item.key}>
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedKey((prev) => (prev === item.key ? null : item.key))}
                                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 flex justify-between items-center"
                                                >
                                                    <span className="font-bold text-gray-800">{item.question}</span>
                                                    <i className={`fas fa-chevron-down text-gray-400 transition ${expandedKey === item.key ? 'rotate-180' : ''}`}></i>
                                                </button>
                                                {expandedKey === item.key && (
                                                    <div className="px-4 pb-4 text-sm bg-red-50 text-gray-700">
                                                        <div className="text-xs text-gray-500 mb-1">최근 오답 시각: {item.timeText}</div>
                                                        <div>제출 답안: <span className="font-bold text-red-500">{item.userAnswer}</span></div>
                                                        <div>정답: <span className="font-bold text-green-600">{item.answer}</span></div>
                                                        <div>해설: {item.explanation}</div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentWrongNoteModal;
