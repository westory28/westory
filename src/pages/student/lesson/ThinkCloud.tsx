import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    addDoc,
    collection,
    doc,
    onSnapshot,
    query,
    serverTimestamp,
    where,
} from 'firebase/firestore';
import { useAppToast } from '../../../components/common/AppToastProvider';
import { useAuth } from '../../../contexts/AuthContext';
import WordCloudView from '../../../components/common/WordCloudView';
import { notifyPointsUpdated } from '../../../lib/appEvents';
import { db } from '../../../lib/firebase';
import {
    buildThinkCloudRewardSourceId,
    claimPointActivityReward,
} from '../../../lib/points';
import {
    buildThinkCloudResponsesCollectionPath,
    buildThinkCloudSessionCollectionPath,
    buildThinkCloudStateDocPath,
    DEFAULT_THINK_CLOUD_OPTIONS,
    formatClassLabel,
    formatGradeLabel,
    getInputValidationError,
    normalizeResponseText,
    normalizeSchoolField,
    normalizeThinkCloudOptions,
    type ThinkCloudOptions,
    type ThinkCloudResponse,
    type ThinkCloudSession,
} from '../../../lib/thinkCloud';

type SessionWithId = ThinkCloudSession & { id: string };

const BANNED_WORDS = ['욕설', '비속어'];

const ThinkCloud: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const { showToast } = useAppToast();
    const [activeSessionId, setActiveSessionId] = useState('');
    const activeSessionIdRef = useRef('');
    const [sessions, setSessions] = useState<SessionWithId[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [responses, setResponses] = useState<Array<ThinkCloudResponse & { id: string }>>([]);
    const [draftInput, setDraftInput] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [submitLoading, setSubmitLoading] = useState(false);

    const selectedSession = useMemo(
        () => sessions.find((session) => session.id === selectedSessionId) || null,
        [sessions, selectedSessionId],
    );

    const isActiveSession = !!selectedSession && selectedSession.id === activeSessionId && selectedSession.status === 'active';
    const isPausedSession = !!selectedSession && selectedSession.status === 'paused';
    const options: ThinkCloudOptions = selectedSession?.options || DEFAULT_THINK_CLOUD_OPTIONS;
    const studentGrade = normalizeSchoolField(userData?.grade);
    const studentClass = normalizeSchoolField(userData?.class);
    const stateDocPath = useMemo(() => buildThinkCloudStateDocPath(config), [config]);
    const sessionCollectionPath = useMemo(() => buildThinkCloudSessionCollectionPath(config), [config]);
    const responseSessionId = selectedSession?.id || '';
    const responsesCollectionPath = useMemo(
        () => responseSessionId ? buildThinkCloudResponsesCollectionPath(config, responseSessionId) : '',
        [config, responseSessionId],
    );

    useEffect(() => {
        const stateRef = doc(db, stateDocPath);
        const unsubscribe = onSnapshot(stateRef, (snap) => {
            if (!snap.exists()) {
                activeSessionIdRef.current = '';
                setActiveSessionId('');
                return;
            }
            const nextActiveSessionId = String(snap.data().activeSessionId || '').trim();
            activeSessionIdRef.current = nextActiveSessionId;
            setActiveSessionId(nextActiveSessionId);
        });
        return () => unsubscribe();
    }, [stateDocPath]);

    useEffect(() => {
        if (!studentGrade || !studentClass) {
            setSessions([]);
            setSelectedSessionId('');
            return;
        }

        const sessionsRef = collection(db, sessionCollectionPath);
        const q = query(
            sessionsRef,
            where('targetGrade', '==', studentGrade),
            where('targetClass', '==', studentClass),
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            const loaded = snap.docs.map((item) => {
                const raw = item.data() as ThinkCloudSession;
                return {
                    ...raw,
                    id: item.id,
                    options: normalizeThinkCloudOptions(raw.options),
                };
            });
            loaded.sort((a, b) => {
                const ta = Number((a.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                const tb = Number((b.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                return tb - ta;
            });
            setSessions(loaded);
            setSelectedSessionId((currentSelectedSessionId) => {
                if (currentSelectedSessionId && loaded.some((item) => item.id === currentSelectedSessionId)) {
                    return currentSelectedSessionId;
                }
                if (loaded.length === 0) {
                    return '';
                }
                const defaultId = loaded.find((item) => item.id === activeSessionIdRef.current)?.id || loaded[0].id;
                return defaultId;
            });
        });

        return () => unsubscribe();
    }, [sessionCollectionPath, studentClass, studentGrade]);

    useEffect(() => {
        if (!responsesCollectionPath) {
            setResponses([]);
            return;
        }

        const responsesRef = collection(db, responsesCollectionPath);
        const unsubscribe = onSnapshot(responsesRef, (snap) => {
            const loaded = snap.docs.map((item) => ({
                id: item.id,
                ...(item.data() as ThinkCloudResponse),
            }));
            loaded.sort((a, b) => {
                const ta = Number((a.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                const tb = Number((b.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                return tb - ta;
            });
            setResponses(loaded);
        });

        return () => unsubscribe();
    }, [responsesCollectionPath]);

    const cloudEntries = useMemo(() => {
        const buckets = new Map<string, { count: number; submitters: Set<string> }>();
        for (const item of responses) {
            const key = item.textNormalized || '';
            if (!key) continue;
            const current = buckets.get(key) || { count: 0, submitters: new Set<string>() };
            current.count += 1;
            const name = String(item.displayName || '').trim();
            if (name) current.submitters.add(name);
            buckets.set(key, current);
        }
        return Array.from(buckets.entries())
            .map(([text, info]) => ({
                text,
                count: info.count,
                submitters: Array.from(info.submitters),
            }))
            .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
            .slice(0, 50);
    }, [responses]);

    const handleSubmit = async () => {
        if (!selectedSessionId || !selectedSession || !currentUser) return;
        if (!isActiveSession) {
            setSubmitError('진행 중인 주제에서만 제출할 수 있습니다.');
            return;
        }

        const validationError = getInputValidationError(draftInput, options);
        if (validationError) {
            setSubmitError(validationError);
            return;
        }

        const rawText = draftInput.trim();
        const normalizedText = normalizeResponseText(rawText, options.inputMode);
        if (!normalizedText) {
            setSubmitError('내용을 입력해 주세요.');
            return;
        }

        if (options.profanityFilter) {
            const hasBannedWord = BANNED_WORDS.some((word) => normalizedText.includes(word));
            if (hasBannedWord) {
                setSubmitError('사용할 수 없는 단어가 포함되어 있습니다.');
                return;
            }
        }

        setSubmitLoading(true);
        setSubmitError('');
        try {
            const responsesPath = buildThinkCloudResponsesCollectionPath(config, selectedSessionId);

            if (!options.allowDuplicateByStudent) {
                const hasSubmittedByCurrentUser = responses.some(
                    (item) => String(item.uid || '').trim() === currentUser.uid,
                );
                if (hasSubmittedByCurrentUser) {
                    setSubmitError('이미 제출한 학생은 다시 제출할 수 없습니다.');
                    setSubmitLoading(false);
                    return;
                }
            }

            if (!options.allowDuplicateWord) {
                const hasSameWord = responses.some(
                    (item) => String(item.textNormalized || '').trim() === normalizedText,
                );
                if (hasSameWord) {
                    setSubmitError('이미 제출된 단어/문장입니다.');
                    setSubmitLoading(false);
                    return;
                }
            }

            const payload: ThinkCloudResponse = {
                uid: currentUser.uid,
                displayName: (userData?.name || '학생').trim() || '학생',
                textRaw: rawText,
                textNormalized: normalizedText,
                createdAt: serverTimestamp(),
            };

            const responseRef = await addDoc(collection(db, responsesPath), payload);
            setDraftInput('');

            try {
                const pointResult = await claimPointActivityReward({
                    config,
                    activityType: 'think_cloud',
                    sourceId: buildThinkCloudRewardSourceId(selectedSessionId, responseRef.id),
                    sourceLabel: selectedSession.title || '생각모아 참여',
                });
                if (pointResult.awarded && (pointResult.totalAwarded || pointResult.amount)) {
                    notifyPointsUpdated();
                }
                if ((pointResult.totalAwarded || pointResult.amount) > 0) {
                    const totalAwarded = Number(pointResult.totalAwarded || pointResult.amount || 0);
                    showToast({
                        tone: 'success',
                        title: '생각모아 참여 완료',
                        message: pointResult.bonusAwarded && pointResult.bonusAmount
                            ? `기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`
                            : `+${totalAwarded}위스가 반영되었습니다.`,
                    });
                } else if (pointResult.duplicate) {
                    const duplicateMessage = pointResult.blockedMessage || '이번 생각모아 위스는 이미 반영되었습니다.';
                    showToast({
                        tone: 'info',
                        title: duplicateMessage,
                    });
                }
            } catch (pointError) {
                console.error('Failed to claim think cloud point reward:', pointError);
                showToast({
                    tone: 'warning',
                    title: '생각모아 응답은 저장되었습니다.',
                    message: '위스 반영 상태를 바로 확인하지 못했습니다.',
                });
            }
        } catch (error) {
            console.error('Failed to submit think cloud response:', error);
            setSubmitError('제출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setSubmitLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-8 gap-6 max-w-7xl mx-auto w-full">
                <aside className="w-full lg:w-72 shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-gray-100">
                            <h1 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                                <i className="fas fa-lightbulb text-blue-500"></i> 생각모아
                            </h1>
                            <p className="text-xs text-gray-500 mt-1 font-bold">지금까지 진행한 주제를 확인할 수 있습니다.</p>
                        </div>
                        <nav className="max-h-[60vh] overflow-y-auto">
                            {sessions.length === 0 && (
                                <p className="p-4 text-sm font-bold text-gray-500">아직 등록된 주제가 없습니다.</p>
                            )}
                            {sessions.map((session) => {
                                const isSelected = selectedSessionId === session.id;
                                const isLive = session.id === activeSessionId && session.status === 'active';
                                return (
                                    <button
                                        key={session.id}
                                        onClick={() => {
                                            setSelectedSessionId(session.id);
                                            setSubmitError('');
                                        }}
                                        className={`w-full px-4 py-3 text-left border-l-4 transition ${isSelected ? 'bg-blue-50 text-blue-700 border-blue-600' : 'text-gray-700 border-transparent hover:bg-gray-50'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-bold truncate">{session.title}</p>
                                            {isLive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">LIVE</span>}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1 truncate">{session.description || '설명 없음'}</p>
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </aside>

                <div className="flex-1 space-y-4">
                    {!selectedSession && (
                        <section className="bg-white border border-gray-200 rounded-2xl p-6">
                            <p className="text-gray-500 font-bold">좌측에서 주제를 선택해 주세요.</p>
                        </section>
                    )}

                    {selectedSession && (
                        <>
                            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-xl font-extrabold text-gray-900">{selectedSession.title}</h2>
                                        {selectedSession.description && <p className="text-sm text-gray-600 mt-2">{selectedSession.description}</p>}
                                    </div>
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${isActiveSession ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                                        {isActiveSession ? '진행 중' : isPausedSession ? '일시 정지' : '종료됨'}
                                    </span>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                                    <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                                        대상 {formatGradeLabel(selectedSession.targetGrade, selectedSession.targetGradeLabel)} {formatClassLabel(selectedSession.targetClass, selectedSession.targetClassLabel)}
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                        {options.inputMode === 'word' ? '단어 1개 입력' : '짧은 문장 입력'}
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                        최대 {options.maxLength}자
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                        {options.allowDuplicateWord ? '중복 단어 제출 허용' : '중복 단어 제출 제한'}
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                        {options.allowDuplicateByStudent ? '동일 학생 중복 제출 허용' : '동일 학생 중복 제출 제한'}
                                    </span>
                                </div>
                            </section>

                            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        value={draftInput}
                                        onChange={(e) => setDraftInput(e.target.value)}
                                        maxLength={Math.max(1, options.maxLength)}
                                        disabled={!isActiveSession}
                                        placeholder={options.inputMode === 'word' ? '단어를 입력해 주세요' : '짧은 문장을 입력해 주세요'}
                                        className="flex-1 border border-gray-300 rounded-xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                void handleSubmit();
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => void handleSubmit()}
                                        disabled={submitLoading || !isActiveSession}
                                        className="px-5 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {submitLoading ? '제출 중...' : '제출'}
                                    </button>
                                </div>
                                {!isActiveSession && (
                                    <p className="mt-2 text-sm font-bold text-gray-500">
                                        {isPausedSession ? '일시 정지된 주제입니다. 재개되면 제출할 수 있습니다.' : '종료된 주제입니다. 제출은 진행 중인 주제에서만 가능합니다.'}
                                    </p>
                                )}
                                {submitError && <p className="mt-2 text-sm font-bold text-red-600">{submitError}</p>}
                            </section>

                            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-lg font-extrabold text-gray-900">응답 구름</h3>
                                    <span className="text-sm font-bold text-gray-500">응답 {responses.length}개</span>
                                </div>

                                {cloudEntries.length === 0 ? (
                                    <p className="text-sm text-gray-500 font-bold">아직 제출된 응답이 없습니다.</p>
                                ) : (
                                    <WordCloudView entries={cloudEntries} showSubmitters={!options.anonymous} />
                                )}
                            </section>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
};

export default ThinkCloud;
