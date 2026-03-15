import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { readLocalOnly, removeStorage, writeLocalOnly } from '../../../lib/safeStorage';
import {
    normalizeHistoryClassroomAssignment,
    normalizeHistoryClassroomResult,
    type HistoryClassroomAssignment,
} from '../../../lib/historyClassroom';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';
import { claimPointActivityReward } from '../../../lib/points';

const BLANK_SCALE = 1;
const HISTORY_CLASSROOM_LOCK_PREFIX = 'westoryHistoryClassroomLock';

const getCooldownLockKey = (assignmentId: string, uid: string) => `${HISTORY_CLASSROOM_LOCK_PREFIX}:${assignmentId}:${uid}`;

const readCooldownLockUntil = (assignmentId: string, uid: string): number => {
    const raw = readLocalOnly(getCooldownLockKey(assignmentId, uid));
    if (!raw) return 0;

    try {
        const parsed = JSON.parse(raw) as { blockedUntil?: number };
        const blockedUntil = Number(parsed.blockedUntil) || 0;
        if (blockedUntil > Date.now()) return blockedUntil;
    } catch (error) {
        console.warn('Failed to read history classroom cooldown lock', error);
    }

    removeStorage(getCooldownLockKey(assignmentId, uid));
    return 0;
};

const writeCooldownLock = (assignmentId: string, uid: string, blockedUntil: number, reason: string) => {
    writeLocalOnly(getCooldownLockKey(assignmentId, uid), JSON.stringify({
        blockedUntil,
        reason,
        savedAt: Date.now(),
    }));
};

const clearCooldownLock = (assignmentId: string, uid: string) => {
    removeStorage(getCooldownLockKey(assignmentId, uid));
};

const HistoryClassroomRunner: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { userData, config } = useAuth();
    const assignmentId = searchParams.get('id') || '';

    const [assignment, setAssignment] = useState<HistoryClassroomAssignment | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedAnswer, setSelectedAnswer] = useState('');
    const [showAnswers, setShowAnswers] = useState(true);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [error, setError] = useState('');
    const [resultText, setResultText] = useState('');
    const [pointNotice, setPointNotice] = useState('');
    const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
    const cancellationInFlightRef = useRef(false);
    const timeoutHandledRef = useRef(false);

    useEffect(() => {
        const loadAssignment = async () => {
            if (!assignmentId || !userData?.uid) return;
            setLoading(true);
            setError('');

            try {
                let snap = await getDoc(doc(db, getSemesterDocPath(config, 'history_classrooms', assignmentId)));
                if (!snap.exists()) {
                    snap = await getDoc(doc(db, `history_classrooms/${assignmentId}`));
                }
                if (!snap.exists()) throw new Error('역사교실 자료를 찾을 수 없습니다.');

                const loaded = normalizeHistoryClassroomAssignment(snap.id, snap.data());
                const assignedStudentUids = loaded.targetStudentUids.length
                    ? loaded.targetStudentUids
                    : (loaded.targetStudentUid ? [loaded.targetStudentUid] : []);
                if (!assignedStudentUids.includes(userData.uid)) {
                    throw new Error('이 과제는 현재 계정에 배정되지 않았습니다.');
                }
                if (!loaded.isPublished) {
                    throw new Error('아직 공개되지 않은 과제입니다.');
                }

                let resultSnap = await getDocs(query(
                    collection(db, getSemesterCollectionPath(config, 'history_classroom_results')),
                    where('uid', '==', userData.uid),
                    where('assignmentId', '==', loaded.id),
                ));
                if (resultSnap.empty) {
                    resultSnap = await getDocs(query(
                        collection(db, 'history_classroom_results'),
                        where('uid', '==', userData.uid),
                        where('assignmentId', '==', loaded.id),
                    ));
                }

                const latest = resultSnap.docs
                    .map((docSnap) => normalizeHistoryClassroomResult(docSnap.id, docSnap.data()))
                    .sort((a, b) => Number((b.createdAt as { seconds?: number } | undefined)?.seconds || 0)
                        - Number((a.createdAt as { seconds?: number } | undefined)?.seconds || 0))[0];

                const lastSeconds = Number((latest?.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                if (lastSeconds && loaded.cooldownMinutes > 0) {
                    const availableAt = lastSeconds * 1000 + loaded.cooldownMinutes * 60 * 1000;
                    if (availableAt > Date.now()) {
                        const remain = Math.ceil((availableAt - Date.now()) / 60000);
                        throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
                    }
                }

                const localAvailableAt = readCooldownLockUntil(loaded.id, userData.uid);
                if (localAvailableAt > Date.now()) {
                    const remain = Math.ceil((localAvailableAt - Date.now()) / 60000);
                    throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
                }
                if (localAvailableAt) {
                    clearCooldownLock(loaded.id, userData.uid);
                }

                setAssignment(loaded);
                setCurrentPage(loaded.pdfPageImages?.[0]?.page || 1);
                setRemainingSeconds(loaded.timeLimitMinutes > 0 ? loaded.timeLimitMinutes * 60 : null);
                timeoutHandledRef.current = false;
            } catch (loadError) {
                console.error(loadError);
                setError(loadError instanceof Error ? loadError.message : '과제를 불러오지 못했습니다.');
            } finally {
                setLoading(false);
            }
        };

        void loadAssignment();
    }, [assignmentId, config, userData?.uid]);

    const pageImage = useMemo(
        () => assignment?.pdfPageImages?.find((page) => page.page === currentPage) || null,
        [assignment?.pdfPageImages, currentPage],
    );

    const currentBlanks = useMemo(
        () => assignment?.blanks.filter((blank) => blank.page === currentPage) || [],
        [assignment?.blanks, currentPage],
    );

    const saveResult = async (options: { status: 'passed' | 'failed' | 'cancelled'; cancellationReason?: string }) => {
        if (!assignment || !userData) return;
        const total = assignment.blanks.length;
        const score = assignment.blanks.reduce((sum, blank) => sum + (answers[blank.id] === blank.answer ? 1 : 0), 0);
        const percent = total > 0 ? Math.round((score / total) * 100) : 0;
        const passed = options.status === 'cancelled' ? false : percent >= assignment.passThresholdPercent;
        const status = options.status === 'cancelled' ? 'cancelled' : (passed ? 'passed' : 'failed');

        const resultRef = await addDoc(collection(db, getSemesterCollectionPath(config, 'history_classroom_results')), {
            assignmentId: assignment.id,
            assignmentTitle: assignment.title,
            uid: userData.uid,
            studentName: userData.name || '',
            studentGrade: String(userData.grade || ''),
            studentClass: String(userData.class || ''),
            studentNumber: String(userData.number || ''),
            answers,
            score,
            total,
            percent,
            passThresholdPercent: assignment.passThresholdPercent,
            passed,
            status,
            cancellationReason: options.cancellationReason || '',
            createdAt: serverTimestamp(),
        });

        return { score, total, percent, status, passed, resultId: resultRef.id };
    };

    const applyQuizPointReward = async (resultId: string) => {
        try {
            const pointResult = await claimPointActivityReward({
                config,
                activityType: 'quiz',
                sourceId: `history-classroom-${resultId}`,
                sourceLabel: assignment?.title || '역사교실 제출 완료',
            });
            if (pointResult.awarded && pointResult.amount > 0) {
                setPointNotice(`문제 풀이 포인트가 적립되었습니다. +${pointResult.amount}포인트`);
            } else if (pointResult.duplicate) {
                setPointNotice('이번 제출 포인트는 이미 반영되었습니다.');
            } else {
                setPointNotice('');
            }
        } catch (pointError) {
            console.error('Failed to claim history classroom point reward:', pointError);
            setPointNotice('문제 풀이 포인트를 바로 반영하지 못했습니다.');
        }
    };

    const handleForcedCancel = async (reason: string) => {
        if (!assignment || !userData || completed || submitting || cancellationInFlightRef.current) return;
        cancellationInFlightRef.current = true;
        if (assignment.cooldownMinutes > 0) {
            writeCooldownLock(
                assignment.id,
                userData.uid,
                Date.now() + assignment.cooldownMinutes * 60 * 1000,
                reason,
            );
        }
        try {
            await saveResult({ status: 'cancelled', cancellationReason: reason });
            setCompleted(true);
            setResultText('화면 이탈로 응시가 자동 취소되었습니다. 재응시 제한이 시작됩니다.');
            navigate('/student/history-classroom', { replace: true });
        } catch (cancelError) {
            console.error('Failed to save cancelled attempt:', cancelError);
        }
    };

    const handleTimeLimitExpired = async () => {
        if (!assignment || !userData || completed || submitting || timeoutHandledRef.current) return;
        timeoutHandledRef.current = true;
        setSubmitting(true);
        try {
            const result = await saveResult({ status: 'failed' });
            setCompleted(true);
            if (!result) return;
            const statusLabel = result.status === 'passed' ? '통과' : '미통과';
            setResultText(`제한 시간이 종료되어 자동 제출되었습니다. ${result.score}/${result.total} (${result.percent}%) · ${statusLabel}`);
            await applyQuizPointReward(result.resultId);
        } catch (submitError) {
            console.error(submitError);
            setResultText('시간 초과 제출 처리에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (!assignment || completed) return undefined;

        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                void handleForcedCancel('visibility-hidden');
            }
        };
        const handlePageHide = () => {
            void handleForcedCancel('pagehide');
        };
        const handleBlur = () => {
            window.setTimeout(() => {
                if (!document.hasFocus()) {
                    void handleForcedCancel('window-blur');
                }
            }, 0);
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('blur', handleBlur);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('blur', handleBlur);
        };
    }, [assignment, completed, submitting]);

    useEffect(() => {
        if (!assignment?.timeLimitMinutes || completed || submitting) return undefined;

        const timerId = window.setInterval(() => {
            setRemainingSeconds((prev) => {
                if (prev == null) return prev;
                if (prev <= 1) {
                    window.clearInterval(timerId);
                    void handleTimeLimitExpired();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => window.clearInterval(timerId);
    }, [assignment?.timeLimitMinutes, completed, submitting]);

    const totalTimeSeconds = assignment?.timeLimitMinutes ? assignment.timeLimitMinutes * 60 : 0;
    const timeProgressPercent = totalTimeSeconds > 0 && remainingSeconds != null
        ? Math.max(0, Math.min(100, (remainingSeconds / totalTimeSeconds) * 100))
        : 100;
    const countdownLabel = remainingSeconds == null
        ? null
        : `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;

    const placeAnswer = (blankId: string) => {
        if (!selectedAnswer) return;
        setAnswers((prev) => ({ ...prev, [blankId]: selectedAnswer }));
    };

    const submitAnswers = async () => {
        if (!assignment || !userData) return;
        setSubmitting(true);
        try {
            const result = await saveResult({ status: 'failed' });
            setCompleted(true);
            if (!result) return;
            const statusLabel = result.status === 'passed' ? '통과' : '미통과';
            setResultText(`제출 완료: ${result.score}/${result.total} (${result.percent}%) · ${statusLabel}`);
            await applyQuizPointReward(result.resultId);
        } catch (submitError) {
            console.error(submitError);
            setResultText('제출에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="p-10 text-center text-gray-400">역사교실을 준비하는 중입니다.</div>;
    }

    if (error || !assignment) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-10">
                <div className="rounded-3xl border border-red-200 bg-white p-8 text-center text-red-600">
                    {error || '과제를 불러오지 못했습니다.'}
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-bold text-orange-500">역사교실</div>
                        <h1 className="mt-1 text-3xl font-black text-gray-900">{assignment.title}</h1>
                        <p className="mt-2 text-sm text-gray-600">{assignment.description}</p>
                        <p className="mt-2 text-xs font-bold text-gray-500">통과 기준: {assignment.passThresholdPercent}% 이상</p>
                    </div>
                        {assignment.timeLimitMinutes > 0 && countdownLabel && (
                            <div className="mt-4 max-w-md">
                                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
                                    <span>제한 시간</span>
                                    <span>{countdownLabel}</span>
                                </div>
                                <div className="h-3 overflow-hidden rounded-full bg-gray-200">
                                    <div
                                        className={`h-full rounded-full transition-[width] duration-1000 ${
                                            timeProgressPercent <= 20 ? 'bg-red-500' : timeProgressPercent <= 50 ? 'bg-amber-500' : 'bg-blue-500'
                                        }`}
                                        style={{ width: `${timeProgressPercent}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    <button
                        type="button"
                        onClick={() => navigate('/student/history-classroom')}
                        className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                    >
                        목록으로
                    </button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                        <div className="text-sm font-bold text-gray-600">
                            페이지 {currentPage} / {assignment.pdfPageImages?.length || 1}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                            >
                                이전
                            </button>
                            <button
                                type="button"
                                disabled={currentPage >= (assignment.pdfPageImages?.length || 1)}
                                onClick={() => setCurrentPage((prev) => Math.min(assignment.pdfPageImages?.length || 1, prev + 1))}
                                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                            >
                                다음
                            </button>
                        </div>
                    </div>
                    {pageImage && (
                        <div className="overflow-auto rounded-3xl border border-gray-200 bg-gray-100 p-4">
                            <div className="relative inline-block">
                                <img
                                    src={pageImage.imageUrl}
                                    alt={`${assignment.title} ${currentPage}`}
                                    style={{ width: `${pageImage.width * BLANK_SCALE}px`, maxWidth: 'none' }}
                                />
                                {currentBlanks.map((blank) => (
                                    <button
                                        key={blank.id}
                                        type="button"
                                        onClick={() => placeAnswer(blank.id)}
                                        className="absolute rounded-xl border-2 border-dashed border-orange-500 bg-white/90 px-3 text-left text-sm font-bold text-gray-700 shadow-sm"
                                        style={{
                                            left: `${blank.left * BLANK_SCALE}px`,
                                            top: `${blank.top * BLANK_SCALE}px`,
                                            width: `${blank.width * BLANK_SCALE}px`,
                                            height: `${blank.height * BLANK_SCALE}px`,
                                        }}
                                    >
                                        <span className="line-clamp-2">{answers[blank.id] || '빈칸 선택'}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                <aside className="space-y-4">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <button
                            type="button"
                            onClick={() => setShowAnswers((prev) => !prev)}
                            className="w-full rounded-2xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 hover:bg-orange-100"
                        >
                            {showAnswers ? '정답 보기 닫기' : '정답 보기'}
                        </button>
                        {showAnswers && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {assignment.answerOptions.map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => setSelectedAnswer(option)}
                                        className={`rounded-full px-3 py-2 text-sm font-bold transition ${
                                            selectedAnswer === option ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-orange-100'
                                        }`}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="text-sm font-bold text-gray-700">안내</div>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                            <li>1. 오른쪽 정답 보기에서 답 하나를 선택합니다.</li>
                            <li>2. 지도 위 빈칸을 눌러 답을 채웁니다.</li>
                            <li>3. 다른 창 전환, 홈 이동, 멀티태스킹 시 자동 취소됩니다.</li>
                        </ul>
                        <button
                            type="button"
                            onClick={() => void submitAnswers()}
                            disabled={submitting || completed}
                            className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {submitting ? '제출 중...' : completed ? '제출 완료' : '제출하기'}
                        </button>
                        {resultText && <div className="mt-3 text-sm font-bold text-blue-700">{resultText}</div>}
                        {pointNotice && (
                            <div className={`mt-3 text-sm font-bold ${pointNotice.includes('못했습니다') ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {pointNotice}
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default HistoryClassroomRunner;
