import React, { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

interface StudentHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    studentId: string;
    studentName: string;
}

interface QuizResultDetail {
    id?: string | number;
    correct?: boolean;
    u?: string;
}

interface QuizResultRecord {
    id: string;
    uid?: string;
    score?: number;
    category?: string;
    unitId?: string;
    timeString?: string;
    timestamp?: { seconds?: number };
    details?: QuizResultDetail[];
}

interface QuestionDoc {
    question?: string;
    answer?: string;
    explanation?: string;
}

interface ResolvedDetail extends QuizResultDetail {
    questionText: string;
    answerText: string;
    explanationText: string;
}

interface HistoryGroup {
    date: string;
    records: QuizResultRecord[];
}

const BATCH_SIZE = 10;

const chunk = <T,>(arr: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const getCategoryLabel = (category?: string): string => {
    if (category === 'diagnostic') return '진단평가';
    if (category === 'formative') return '형성평가';
    if (category === 'exam_prep') return '학기 시험 대비';
    return '기타';
};

const getDateKey = (record: QuizResultRecord): string => {
    if (record.timestamp?.seconds) {
        return new Date(record.timestamp.seconds * 1000).toLocaleDateString('ko-KR');
    }
    if (record.timeString) {
        const parsed = new Date(record.timeString);
        if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('ko-KR');
        return String(record.timeString).split(' ')[0];
    }
    return '날짜 미상';
};

const getTimeText = (record: QuizResultRecord): string => {
    if (record.timestamp?.seconds) {
        return new Date(record.timestamp.seconds * 1000).toLocaleString('ko-KR');
    }
    return record.timeString || '-';
};

const StudentHistoryModal: React.FC<StudentHistoryModalProps> = ({ isOpen, onClose, studentId, studentName }) => {
    const { config } = useAuth();
    const [loading, setLoading] = useState(false);
    const [groups, setGroups] = useState<HistoryGroup[]>([]);
    const [questionMap, setQuestionMap] = useState<Record<string, QuestionDoc>>({});
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
    const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set());
    const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!isOpen || !studentId) return;
        void fetchHistory();
    }, [config, isOpen, studentId]);

    const fetchHistory = async () => {
        setLoading(true);
        setGroups([]);
        setQuestionMap({});
        setExpandedDates(new Set());
        setExpandedRecords(new Set());
        setExpandedQuestions(new Set());

        try {
            let scopedSnap = await getDocs(
                query(
                    collection(db, getSemesterCollectionPath(config, 'quiz_results')),
                    where('uid', '==', studentId),
                    orderBy('timestamp', 'desc'),
                ),
            );
            if (scopedSnap.empty) {
                scopedSnap = await getDocs(
                    query(collection(db, 'quiz_results'), where('uid', '==', studentId), orderBy('timestamp', 'desc')),
                );
            }

            const records: QuizResultRecord[] = [];
            scopedSnap.forEach((doc) => {
                records.push({ id: doc.id, ...(doc.data() as Omit<QuizResultRecord, 'id'>) });
            });

            const grouped: Record<string, QuizResultRecord[]> = {};
            records.forEach((record) => {
                const date = getDateKey(record);
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(record);
            });

            const groupedList = Object.keys(grouped).map((date) => ({ date, records: grouped[date] }));
            setGroups(groupedList);

            const allQuestionIds = Array.from(
                new Set(
                    records.flatMap((record) =>
                        (record.details || [])
                            .map((detail) => String(detail.id || '').trim())
                            .filter((id) => id.length > 0),
                    ),
                ),
            );

            if (allQuestionIds.length) {
                const resolvedQuestionMap: Record<string, QuestionDoc> = {};

                await Promise.all(
                    chunk(allQuestionIds, BATCH_SIZE).map(async (ids) => {
                        const scopedQuestions = await getDocs(
                            query(collection(db, getSemesterCollectionPath(config, 'quiz_questions')), where(documentId(), 'in', ids)),
                        );
                        scopedQuestions.forEach((doc) => {
                            resolvedQuestionMap[doc.id] = doc.data() as QuestionDoc;
                        });
                    }),
                );

                const missingIds = allQuestionIds.filter((id) => !resolvedQuestionMap[id]);
                if (missingIds.length) {
                    await Promise.all(
                        chunk(missingIds, BATCH_SIZE).map(async (ids) => {
                            const legacyQuestions = await getDocs(
                                query(collection(db, 'quiz_questions'), where(documentId(), 'in', ids)),
                            );
                            legacyQuestions.forEach((doc) => {
                                resolvedQuestionMap[doc.id] = doc.data() as QuestionDoc;
                            });
                        }),
                    );
                }

                setQuestionMap(resolvedQuestionMap);
            }
        } catch (error) {
            console.error('Error fetching student history:', error);
        } finally {
            setLoading(false);
        }
    };

    const resolvedGroups = useMemo(
        () =>
            groups.map((group) => ({
                ...group,
                records: group.records.map((record) => ({
                    ...record,
                    resolvedDetails: (record.details || []).map((detail, idx) => {
                        const qid = String(detail.id || '').trim();
                        const question = qid ? questionMap[qid] : undefined;
                        const no = idx + 1;
                        return {
                            ...detail,
                            questionText: question?.question || `Q${no} 문항 정보 없음`,
                            answerText: question?.answer ? String(question.answer) : '-',
                            explanationText: question?.explanation || '해설이 등록되지 않았습니다.',
                        } as ResolvedDetail;
                    }),
                })),
            })),
        [groups, questionMap],
    );

    const toggleDate = (date: string) => {
        setExpandedDates((prev) => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date);
            else next.add(date);
            return next;
        });
    };

    const toggleRecord = (recordId: string) => {
        setExpandedRecords((prev) => {
            const next = new Set(prev);
            if (next.has(recordId)) next.delete(recordId);
            else next.add(recordId);
            return next;
        });
    };

    const toggleQuestion = (key: string) => {
        setExpandedQuestions((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={onClose}
            role="button"
            tabIndex={-1}
        >
            <div
                className="bg-white rounded-xl shadow-2xl z-10 w-full max-w-4xl p-6 max-h-[88vh] flex flex-col animate-fadeScale"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-4">
                    <div>
                        <h3 className="font-bold text-xl text-gray-800">{studentName} 응시 기록</h3>
                        <p className="text-xs text-gray-500">날짜별 응시 기록을 접고 펼쳐서 오답 상세까지 확인할 수 있습니다.</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition">
                        <i className="fas fa-times text-gray-400 hover:text-gray-600 text-xl"></i>
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 pr-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-gray-500">응시 기록을 불러오는 중...</div>
                    ) : resolvedGroups.length === 0 ? (
                        <div className="text-center py-20 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                            응시 기록이 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {resolvedGroups.map((group) => (
                                <div key={group.date} className="border border-gray-200 rounded-xl overflow-hidden">
                                    <button
                                        type="button"
                                        className="w-full bg-gray-50 px-4 py-3 font-bold text-gray-700 flex justify-between items-center hover:bg-gray-100 transition"
                                        onClick={() => toggleDate(group.date)}
                                    >
                                        <span>📅 {group.date} 응시 ({group.records.length}건)</span>
                                        <i className={`fas fa-chevron-down text-gray-400 transition-transform ${expandedDates.has(group.date) ? 'rotate-180' : ''}`}></i>
                                    </button>

                                    {expandedDates.has(group.date) && (
                                        <div className="bg-white p-3 space-y-3 border-t border-gray-100">
                                            {group.records.map((record, rIdx) => {
                                                const recordKey = record.id || `${group.date}_${rIdx}`;
                                                const isRecordExpanded = expandedRecords.has(recordKey);
                                                const details = (record as QuizResultRecord & { resolvedDetails?: ResolvedDetail[] }).resolvedDetails || [];
                                                const wrongCount = details.filter((detail) => !detail.correct).length;

                                                return (
                                                    <div key={recordKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleRecord(recordKey)}
                                                            className="w-full px-4 py-3 bg-white hover:bg-gray-50 text-left flex items-center justify-between"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className={`font-bold ${Number(record.score || 0) >= 80 ? 'text-blue-600' : Number(record.score || 0) >= 60 ? 'text-green-600' : 'text-red-500'}`}>
                                                                        {record.score ?? 0}점
                                                                    </span>
                                                                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">{getCategoryLabel(record.category)}</span>
                                                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">오답 {wrongCount}개</span>
                                                                </div>
                                                                <div className="text-xs text-gray-500 mt-1">{getTimeText(record)}</div>
                                                            </div>
                                                            <i className={`fas fa-chevron-down text-gray-400 transition-transform ${isRecordExpanded ? 'rotate-180' : ''}`}></i>
                                                        </button>

                                                        {isRecordExpanded && (
                                                            <div className="border-t border-gray-100 px-3 py-3 bg-gray-50 space-y-2">
                                                                {details.length === 0 && (
                                                                    <div className="text-sm text-gray-500 px-2 py-1">문항 상세 정보가 없습니다.</div>
                                                                )}
                                                                {details.map((detail, qIdx) => {
                                                                    const qKey = `${recordKey}_${qIdx}`;
                                                                    const open = expandedQuestions.has(qKey);
                                                                    const wrong = !detail.correct;
                                                                    return (
                                                                        <div key={qKey} className={`rounded-lg border ${wrong ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleQuestion(qKey)}
                                                                                className="w-full px-3 py-2 text-left flex items-start gap-2 justify-between"
                                                                            >
                                                                                <div className="min-w-0">
                                                                                    <div className={`text-xs font-bold mb-1 ${wrong ? 'text-red-600' : 'text-green-700'}`}>Q{qIdx + 1} {wrong ? '오답' : '정답'}</div>
                                                                                    <div className="text-sm text-gray-800 line-clamp-1">{detail.questionText}</div>
                                                                                </div>
                                                                                <i className={`fas fa-chevron-down text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
                                                                            </button>
                                                                            {open && (
                                                                                <div className="px-3 pb-3 text-sm text-gray-700 space-y-1">
                                                                                    <div className="font-semibold text-gray-900">{detail.questionText}</div>
                                                                                    <div>학생 답: <span className={`font-semibold ${wrong ? 'text-red-600' : 'text-green-700'}`}>{detail.u || '(미입력)'}</span></div>
                                                                                    <div>정답: <span className="font-semibold text-blue-700">{detail.answerText}</span></div>
                                                                                    <div className="text-gray-600">해설: {detail.explanationText}</div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentHistoryModal;
