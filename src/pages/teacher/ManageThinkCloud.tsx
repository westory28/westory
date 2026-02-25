import React, { useEffect, useMemo, useState } from 'react';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import {
    buildThinkCloudResponsesCollectionPath,
    buildThinkCloudSessionCollectionPath,
    buildThinkCloudStateDocPath,
    DEFAULT_THINK_CLOUD_OPTIONS,
    type ThinkCloudOptions,
    type ThinkCloudResponse,
    type ThinkCloudSession,
} from '../../lib/thinkCloud';

const ManageThinkCloud: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const [activeSessionId, setActiveSessionId] = useState('');
    const [activeSession, setActiveSession] = useState<ThinkCloudSession | null>(null);
    const [responses, setResponses] = useState<Array<ThinkCloudResponse & { id: string }>>([]);
    const [loadingAction, setLoadingAction] = useState(false);
    const [message, setMessage] = useState('');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [options, setOptions] = useState<ThinkCloudOptions>(DEFAULT_THINK_CLOUD_OPTIONS);

    useEffect(() => {
        const stateRef = doc(db, buildThinkCloudStateDocPath(config));
        const unsubscribe = onSnapshot(stateRef, (snap) => {
            if (!snap.exists()) {
                setActiveSessionId('');
                return;
            }
            setActiveSessionId(String(snap.data().activeSessionId || '').trim());
        });
        return () => unsubscribe();
    }, [config]);

    useEffect(() => {
        if (!activeSessionId) {
            setActiveSession(null);
            setResponses([]);
            return;
        }

        const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), activeSessionId);
        const unsubscribeSession = onSnapshot(sessionRef, (snap) => {
            if (!snap.exists()) {
                setActiveSession(null);
                return;
            }
            setActiveSession(snap.data() as ThinkCloudSession);
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

    const minCount = cloudEntries.length > 0 ? Math.min(...cloudEntries.map((item) => item.count)) : 1;
    const maxCount = cloudEntries.length > 0 ? Math.max(...cloudEntries.map((item) => item.count)) : 1;
    const getFontSize = (count: number) => {
        if (maxCount === minCount) return 22;
        const ratio = (count - minCount) / (maxCount - minCount);
        return Math.round(14 + ratio * 28);
    };

    const handleStartSession = async () => {
        const safeTitle = title.trim();
        if (!safeTitle) {
            setMessage('주제를 입력해 주세요.');
            return;
        }
        if (!currentUser) return;

        setLoadingAction(true);
        setMessage('');
        try {
            const statePath = buildThinkCloudStateDocPath(config);
            const stateRef = doc(db, statePath);
            const stateSnap = await getDoc(stateRef);
            const previousSessionId = stateSnap.exists() ? String(stateSnap.data().activeSessionId || '').trim() : '';

            if (previousSessionId) {
                const previousRef = doc(db, buildThinkCloudSessionCollectionPath(config), previousSessionId);
                await updateDoc(previousRef, {
                    status: 'closed',
                    closedAt: serverTimestamp(),
                });
            }

            const payload: ThinkCloudSession = {
                title: safeTitle,
                description: description.trim(),
                status: 'active',
                options,
                createdBy: currentUser.uid,
                createdByName: (userData?.name || '교사').trim() || '교사',
                createdAt: serverTimestamp(),
                activatedAt: serverTimestamp(),
            };

            const added = await addDoc(collection(db, buildThinkCloudSessionCollectionPath(config)), payload);
            await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                activeSessionId: added.id,
                updatedAt: serverTimestamp(),
            });
            setMessage('새 생각모아 세션을 시작했습니다.');
        } catch (error) {
            console.error('Failed to start think cloud session:', error);
            setMessage('세션 시작에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const handleCloseSession = async () => {
        if (!activeSessionId) return;
        setLoadingAction(true);
        setMessage('');
        try {
            const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), activeSessionId);
            await updateDoc(sessionRef, {
                status: 'closed',
                closedAt: serverTimestamp(),
            });
            await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                activeSessionId: '',
                updatedAt: serverTimestamp(),
            });
            setMessage('진행 중인 세션을 종료했습니다.');
        } catch (error) {
            console.error('Failed to close think cloud session:', error);
            setMessage('세션 종료에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    return (
        <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <h1 className="text-2xl font-extrabold text-gray-900">생각모아 관리</h1>
                <p className="mt-2 text-sm text-gray-600 font-bold">주제와 옵션을 설정하고 세션을 시작하면 학생 화면에 즉시 반영됩니다.</p>
            </section>

            <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
                <h2 className="text-lg font-extrabold text-gray-900">새 세션 설정</h2>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-bold text-gray-700">주제</label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="예: 삼국 통일의 의의를 한 단어로 표현해 보세요"
                            className="mt-1 w-full border border-gray-300 rounded-xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-bold text-gray-700">설명</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="학생에게 보여줄 안내 문구를 입력해 주세요."
                            className="mt-1 w-full border border-gray-300 rounded-xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3">
                        <span className="font-bold text-gray-700">중복 제출 허용</span>
                        <input
                            type="checkbox"
                            checked={options.allowDuplicatePerUser}
                            onChange={(e) => setOptions((prev) => ({ ...prev, allowDuplicatePerUser: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>
                    <label className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3">
                        <span className="font-bold text-gray-700">익명 표시</span>
                        <input
                            type="checkbox"
                            checked={options.anonymous}
                            onChange={(e) => setOptions((prev) => ({ ...prev, anonymous: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>
                    <label className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3">
                        <span className="font-bold text-gray-700">금칙어 필터</span>
                        <input
                            type="checkbox"
                            checked={options.profanityFilter}
                            onChange={(e) => setOptions((prev) => ({ ...prev, profanityFilter: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>
                    <label className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3">
                        <span className="font-bold text-gray-700">입력 형식</span>
                        <select
                            value={options.inputMode}
                            onChange={(e) => setOptions((prev) => ({ ...prev, inputMode: e.target.value as ThinkCloudOptions['inputMode'] }))}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold"
                        >
                            <option value="word">단어 1개</option>
                            <option value="sentence">짧은 문장</option>
                        </select>
                    </label>
                    <label className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3 md:col-span-2">
                        <span className="font-bold text-gray-700">최대 입력 길이</span>
                        <input
                            type="number"
                            min={5}
                            max={100}
                            value={options.maxLength}
                            onChange={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                const next = Number.isFinite(parsed) ? Math.max(5, Math.min(100, parsed)) : 20;
                                setOptions((prev) => ({ ...prev, maxLength: next }));
                            }}
                            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 font-bold text-right"
                        />
                    </label>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => void handleStartSession()}
                        disabled={loadingAction}
                        className="px-5 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
                    >
                        {loadingAction ? '처리 중...' : '새 세션 시작'}
                    </button>
                    <button
                        onClick={() => void handleCloseSession()}
                        disabled={loadingAction || !activeSessionId}
                        className="px-5 py-3 rounded-xl bg-gray-700 text-white font-bold hover:bg-gray-800 disabled:opacity-50"
                    >
                        진행 세션 종료
                    </button>
                </div>
                {message && <p className="text-sm font-bold text-blue-700">{message}</p>}
            </section>

            <section className="bg-white border border-gray-200 rounded-2xl p-5">
                <h2 className="text-lg font-extrabold text-gray-900">진행 중 세션</h2>
                {!activeSession && <p className="mt-2 text-sm font-bold text-gray-500">현재 활성 세션이 없습니다.</p>}
                {activeSession && (
                    <div className="mt-2 space-y-1">
                        <p className="text-base font-black text-gray-900">{activeSession.title}</p>
                        {activeSession.description && <p className="text-sm text-gray-600 font-bold">{activeSession.description}</p>}
                        <p className="text-xs text-gray-500 font-bold">응답 {responses.length}개</p>
                    </div>
                )}

                {cloudEntries.length > 0 && (
                    <div className="mt-4 min-h-[220px] rounded-xl bg-gradient-to-br from-amber-50 via-white to-blue-50 border border-amber-100 p-4 flex flex-wrap content-start gap-3">
                        {cloudEntries.map((item) => (
                            <span
                                key={item.text}
                                className="font-black text-amber-700 leading-none"
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

export default ManageThinkCloud;
