import React, { useEffect, useMemo, useState } from 'react';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import {
    buildThinkCloudResponsesCollectionPath,
    buildThinkCloudSessionCollectionPath,
    buildThinkCloudStateDocPath,
    createResponseDedupeId,
    getInputValidationError,
    normalizeResponseText,
    type ThinkCloudOptions,
    type ThinkCloudResponse,
    type ThinkCloudSession,
    DEFAULT_THINK_CLOUD_OPTIONS,
} from '../../../lib/thinkCloud';

const BANNED_WORDS = ['욕설', '비속어'];

const ThinkCloud: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const [activeSessionId, setActiveSessionId] = useState('');
    const [session, setSession] = useState<ThinkCloudSession | null>(null);
    const [responses, setResponses] = useState<Array<ThinkCloudResponse & { id: string }>>([]);
    const [draftInput, setDraftInput] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [submitLoading, setSubmitLoading] = useState(false);

    const options: ThinkCloudOptions = session?.options || DEFAULT_THINK_CLOUD_OPTIONS;

    useEffect(() => {
        const stateDocPath = buildThinkCloudStateDocPath(config);
        const stateRef = doc(db, stateDocPath);
        const unsubscribe = onSnapshot(stateRef, (snap) => {
            if (!snap.exists()) {
                setActiveSessionId('');
                return;
            }
            const nextSessionId = String(snap.data().activeSessionId || '').trim();
            setActiveSessionId(nextSessionId);
        });
        return () => unsubscribe();
    }, [config]);

    useEffect(() => {
        if (!activeSessionId) {
            setSession(null);
            setResponses([]);
            return;
        }

        const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), activeSessionId);
        const unsubscribeSession = onSnapshot(sessionRef, (snap) => {
            if (!snap.exists()) {
                setSession(null);
                return;
            }
            setSession(snap.data() as ThinkCloudSession);
        });

        const responsesRef = collection(db, buildThinkCloudResponsesCollectionPath(config, activeSessionId));
        const unsubscribeResponses = onSnapshot(responsesRef, (snap) => {
            const loaded = snap.docs.map((item) => ({
                id: item.id,
                ...(item.data() as ThinkCloudResponse),
            }));
            setResponses(
                loaded.sort((a, b) => {
                    const ta = Number((a.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                    const tb = Number((b.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                    return tb - ta;
                }),
            );
        });

        return () => {
            unsubscribeSession();
            unsubscribeResponses();
        };
    }, [activeSessionId, config]);

    const cloudEntries = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of responses) {
            const key = item.textNormalized || '';
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([text, count]) => ({ text, count }))
            .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
            .slice(0, 50);
    }, [responses]);

    const handleSubmit = async () => {
        if (!activeSessionId || !session || !currentUser) return;

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
            const responsesPath = buildThinkCloudResponsesCollectionPath(config, activeSessionId);
            const payload: ThinkCloudResponse = {
                uid: currentUser.uid,
                displayName: (userData?.name || '학생').trim() || '학생',
                textRaw: rawText,
                textNormalized: normalizedText,
                createdAt: serverTimestamp(),
            };

            if (options.allowDuplicatePerUser) {
                await addDoc(collection(db, responsesPath), payload);
            } else {
                const dedupeId = createResponseDedupeId(currentUser.uid, normalizedText);
                const responseRef = doc(db, responsesPath, dedupeId);
                const existing = await getDoc(responseRef);
                if (existing.exists()) {
                    setSubmitError('이미 제출한 단어/의견입니다.');
                    setSubmitLoading(false);
                    return;
                }
                await setDoc(responseRef, payload);
            }

            setDraftInput('');
        } catch (error) {
            console.error('Failed to submit think cloud response:', error);
            setSubmitError('제출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setSubmitLoading(false);
        }
    };

    const minCount = cloudEntries.length > 0 ? Math.min(...cloudEntries.map((item) => item.count)) : 1;
    const maxCount = cloudEntries.length > 0 ? Math.max(...cloudEntries.map((item) => item.count)) : 1;
    const getFontSize = (count: number) => {
        if (maxCount === minCount) return 26;
        const ratio = (count - minCount) / (maxCount - minCount);
        return Math.round(18 + ratio * 30);
    };

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-6 space-y-4">
            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <h1 className="text-2xl font-extrabold text-gray-900">생각모아</h1>
                {!session && (
                    <p className="mt-3 text-gray-500 font-bold">진행 중인 생각모아가 없습니다.</p>
                )}
                {session && (
                    <div className="mt-3 space-y-3">
                        <div>
                            <p className="text-xs text-gray-500 font-bold">주제</p>
                            <p className="text-lg font-bold text-gray-900">{session.title}</p>
                            {session.description && <p className="text-sm text-gray-600 mt-1">{session.description}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-bold">
                            <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                {options.inputMode === 'word' ? '단어 1개 입력' : '짧은 문장 입력'}
                            </span>
                            <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                최대 {options.maxLength}자
                            </span>
                            <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                {options.allowDuplicatePerUser ? '중복 제출 허용' : '중복 제출 제한'}
                            </span>
                        </div>
                    </div>
                )}
            </section>

            {session && (
                <section className="bg-white border border-gray-200 rounded-2xl p-5">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            value={draftInput}
                            onChange={(e) => setDraftInput(e.target.value)}
                            maxLength={Math.max(1, options.maxLength)}
                            placeholder={options.inputMode === 'word' ? '단어를 입력해 주세요' : '짧은 문장으로 입력해 주세요'}
                            className="flex-1 border border-gray-300 rounded-xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleSubmit();
                                }
                            }}
                        />
                        <button
                            onClick={() => void handleSubmit()}
                            disabled={submitLoading}
                            className="px-5 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
                        >
                            {submitLoading ? '제출 중...' : '제출'}
                        </button>
                    </div>
                    {submitError && <p className="mt-2 text-sm font-bold text-red-600">{submitError}</p>}
                </section>
            )}

            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <h2 className="text-lg font-extrabold text-gray-900">실시간 생각 구름</h2>
                {cloudEntries.length === 0 && (
                    <p className="mt-3 text-sm text-gray-500 font-bold">아직 제출된 의견이 없습니다.</p>
                )}
                {cloudEntries.length > 0 && (
                    <div className="mt-4 min-h-[220px] rounded-xl bg-gradient-to-br from-blue-50 via-white to-cyan-50 border border-blue-100 p-4 flex flex-wrap content-start gap-3">
                        {cloudEntries.map((item) => (
                            <span
                                key={item.text}
                                className="font-black text-blue-700 leading-none"
                                style={{ fontSize: `${getFontSize(item.count)}px` }}
                                title={`${item.count}회`}
                            >
                                {item.text}
                            </span>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default ThinkCloud;

