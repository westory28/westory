import React, { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

interface StudentWrongNoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    studentId: string;
    studentName: string;
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

const StudentWrongNoteModal: React.FC<StudentWrongNoteModalProps> = ({ isOpen, onClose, studentId, studentName }) => {
    const { config } = useAuth();
    const [loading, setLoading] = useState(false);
    const [wrongItems, setWrongItems] = useState<WrongItem[]>([]);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !studentId) return;
        void loadWrongNotes();
    }, [isOpen, studentId, config]);

    const loadWrongNotes = async () => {
        setLoading(true);
        try {
            let resultSnap = await getDocs(
                query(collection(db, getSemesterCollectionPath(config, 'quiz_results')), where('uid', '==', studentId)),
            );
            if (resultSnap.empty) {
                resultSnap = await getDocs(query(collection(db, 'quiz_results'), where('uid', '==', studentId)));
            }

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

            results.forEach((r) => {
                (r.details || []).forEach((d: any) => {
                    if (d.correct) return;
                    wrongLogs.push({
                        qid: String(d.id),
                        userAnswer: d.u || '',
                        unitId: r.unitId || '',
                        category: r.category || '',
                        timeText: r.timestamp?.seconds
                            ? new Date(r.timestamp.seconds * 1000).toLocaleString('ko-KR')
                            : (r.timeString || '-'),
                    });
                });
            });

            if (wrongLogs.length === 0) {
                setWrongItems([]);
                return;
            }

            const unitTitleMap: Record<string, string> = { exam_prep: '학기 시험 대비' };
            try {
                let treeSnap = await getDocs(query(collection(db, getSemesterCollectionPath(config, 'curriculum'))));
                if (treeSnap.empty) {
                    treeSnap = await getDocs(query(collection(db, 'curriculum')));
                }
                treeSnap.forEach((doc) => {
                    if (doc.id !== 'tree') return;
                    const tree = (doc.data() as any).tree || [];
                    tree.forEach((big: any) =>
                        (big.children || []).forEach((mid: any) => {
                            if (mid?.id && mid?.title) unitTitleMap[mid.id] = mid.title;
                        }),
                    );
                });
            } catch (error) {
                console.error(error);
            }

            const questionIds = Array.from(new Set(wrongLogs.map((x) => x.qid)));
            const questionMap: Record<string, any> = {};

            await Promise.all(
                chunk(questionIds, 10).map(async (ids) => {
                    const scopedSnap = await getDocs(
                        query(collection(db, getSemesterCollectionPath(config, 'quiz_questions')), where(documentId(), 'in', ids)),
                    );
                    scopedSnap.forEach((doc) => {
                        questionMap[doc.id] = doc.data();
                    });
                }),
            );

            const missing = questionIds.filter((id) => !questionMap[id]);
            if (missing.length) {
                await Promise.all(
                    chunk(missing, 10).map(async (ids) => {
                        const legacySnap = await getDocs(
                            query(collection(db, 'quiz_questions'), where(documentId(), 'in', ids)),
                        );
                        legacySnap.forEach((doc) => {
                            questionMap[doc.id] = doc.data();
                        });
                    }),
                );
            }

            const seen = new Set<string>();
            const items: WrongItem[] = [];
            wrongLogs.forEach((log) => {
                const q = questionMap[log.qid];
                if (!q) return;
                const key = `${log.qid}_${log.unitId}_${log.category}`;
                if (seen.has(key)) return;
                seen.add(key);
                items.push({
                    key,
                    question: q.question || '문항 텍스트 없음',
                    userAnswer: log.userAnswer || '(미입력)',
                    answer: String(q.answer || '-'),
                    explanation: q.explanation || '해설이 등록되지 않았습니다.',
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
                        <p className="text-xs text-gray-500">학생 이름을 클릭하면 최근 오답 요약을 확인할 수 있습니다.</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded hover:bg-gray-100">
                        <i className="fas fa-times text-gray-400"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {loading ? (
                        <div className="text-center py-12 text-gray-500">오답 노트를 불러오는 중...</div>
                    ) : groupedItems.length === 0 ? (
                        <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                            오답 기록이 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {groupedItems.map(([groupKey, items]) => (
                                <div key={groupKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-gray-50 text-sm font-bold text-gray-700">
                                        {items[0].unitTitle} · {items[0].categoryLabel}
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
