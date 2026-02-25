import React, { useEffect, useMemo, useState } from 'react';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import WordCloudView from '../../components/common/WordCloudView';
import {
    buildThinkCloudResponsesCollectionPath,
    buildThinkCloudSessionCollectionPath,
    buildThinkCloudStateDocPath,
    DEFAULT_THINK_CLOUD_OPTIONS,
    formatClassLabel,
    formatGradeLabel,
    type ThinkCloudOptions,
    type ThinkCloudResponse,
    type ThinkCloudSession,
} from '../../lib/thinkCloud';

type SessionWithId = ThinkCloudSession & { id: string };
type SchoolOption = { value: string; label: string };

const defaultGradeOptions: SchoolOption[] = [
    { value: '1', label: '1학년' },
    { value: '2', label: '2학년' },
    { value: '3', label: '3학년' },
];

const defaultClassOptions: SchoolOption[] = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}반`,
}));

const ManageThinkCloud: React.FC = () => {
    const { config, currentUser, userData } = useAuth();
    const [activeSessionId, setActiveSessionId] = useState('');
    const [sessions, setSessions] = useState<SessionWithId[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [responses, setResponses] = useState<Array<ThinkCloudResponse & { id: string }>>([]);
    const [loadingAction, setLoadingAction] = useState(false);
    const [message, setMessage] = useState('');
    const [isCreateMode, setIsCreateMode] = useState(false);
    const [cloudModalOpen, setCloudModalOpen] = useState(false);
    const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>(defaultGradeOptions);
    const [classOptions, setClassOptions] = useState<SchoolOption[]>(defaultClassOptions);
    const [targetGrade, setTargetGrade] = useState(defaultGradeOptions[0].value);
    const [targetClass, setTargetClass] = useState(defaultClassOptions[0].value);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [options, setOptions] = useState<ThinkCloudOptions>(DEFAULT_THINK_CLOUD_OPTIONS);

    const selectedSession = useMemo(
        () => sessions.find((session) => session.id === selectedSessionId) || null,
        [sessions, selectedSessionId],
    );

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
        const sessionsRef = collection(db, buildThinkCloudSessionCollectionPath(config));
        const unsubscribe = onSnapshot(sessionsRef, (snap) => {
            const loaded = snap.docs.map((item) => ({
                id: item.id,
                ...(item.data() as ThinkCloudSession),
            }));
            loaded.sort((a, b) => {
                const ta = Number((a.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                const tb = Number((b.createdAt as { seconds?: number } | undefined)?.seconds || 0);
                return tb - ta;
            });
            setSessions(loaded);
            if (!selectedSessionId && loaded.length > 0) {
                setSelectedSessionId(loaded[0].id);
            }
            if (selectedSessionId && !loaded.some((item) => item.id === selectedSessionId)) {
                setSelectedSessionId(loaded.length > 0 ? loaded[0].id : '');
            }
        });
        return () => unsubscribe();
    }, [config, selectedSessionId]);

    useEffect(() => {
        if (!selectedSessionId) {
            setResponses([]);
            return;
        }
        const responsesRef = collection(db, buildThinkCloudResponsesCollectionPath(config, selectedSessionId));
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
    }, [config, selectedSessionId]);

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

    const resetCreateForm = () => {
        setTitle('');
        setDescription('');
        setOptions(DEFAULT_THINK_CLOUD_OPTIONS);
        setTargetGrade(gradeOptions[0]?.value || '1');
        setTargetClass(classOptions[0]?.value || '1');
    };

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const schoolSnap = await getDoc(doc(db, 'site_settings', 'school_config'));
                if (!schoolSnap.exists()) return;
                const data = schoolSnap.data() as {
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                };

                if (Array.isArray(data.grades) && data.grades.length > 0) {
                    const nextGrades = data.grades
                        .map((item) => ({
                            value: String(item.value || '').trim(),
                            label: String(item.label || '').trim(),
                        }))
                        .filter((item) => item.value && item.label);
                    if (nextGrades.length > 0) setGradeOptions(nextGrades);
                }

                if (Array.isArray(data.classes) && data.classes.length > 0) {
                    const nextClasses = data.classes
                        .map((item) => ({
                            value: String(item.value || '').trim(),
                            label: String(item.label || '').trim(),
                        }))
                        .filter((item) => item.value && item.label);
                    if (nextClasses.length > 0) setClassOptions(nextClasses);
                }
            } catch (error) {
                console.warn('Failed to load school options for think cloud:', error);
            }
        };

        void loadSchoolConfig();
    }, []);

    useEffect(() => {
        if (!gradeOptions.some((item) => item.value === targetGrade)) {
            setTargetGrade(gradeOptions[0]?.value || '1');
        }
    }, [gradeOptions, targetGrade]);

    useEffect(() => {
        if (!classOptions.some((item) => item.value === targetClass)) {
            setTargetClass(classOptions[0]?.value || '1');
        }
    }, [classOptions, targetClass]);

    const selectSession = (id: string) => {
        setIsCreateMode(false);
        setSelectedSessionId(id);
        setMessage('');
    };

    const openCreateMode = () => {
        setIsCreateMode(true);
        setSelectedSessionId('');
        setMessage('');
        resetCreateForm();
    };

    const handleStartSession = async () => {
        const safeTitle = title.trim();
        if (!safeTitle) {
            setMessage('주제를 입력해 주세요.');
            return;
        }
        if (!targetGrade || !targetClass) {
            setMessage('학년과 반을 선택해 주세요.');
            return;
        }
        if (!currentUser) return;

        setLoadingAction(true);
        setMessage('');
        try {
            const stateRef = doc(db, buildThinkCloudStateDocPath(config));
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
                targetGrade,
                targetClass,
                targetGradeLabel: gradeOptions.find((item) => item.value === targetGrade)?.label || '',
                targetClassLabel: classOptions.find((item) => item.value === targetClass)?.label || '',
                status: 'active',
                options,
                createdBy: currentUser.uid,
                createdByName: (userData?.name || '교사').trim() || '교사',
                createdAt: serverTimestamp(),
                activatedAt: serverTimestamp(),
            };

            const added = await addDoc(collection(db, buildThinkCloudSessionCollectionPath(config)), payload);
            await setDoc(stateRef, {
                activeSessionId: added.id,
                updatedAt: serverTimestamp(),
            });
            setMessage('새 생각모아 세션을 시작했습니다.');
            setIsCreateMode(false);
            setSelectedSessionId(added.id);
        } catch (error) {
            console.error('Failed to start think cloud session:', error);
            setMessage('세션 시작에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const handleCloseSession = async () => {
        if (!selectedSessionId) return;
        setLoadingAction(true);
        setMessage('');
        try {
            const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), selectedSessionId);
            await updateDoc(sessionRef, {
                status: 'closed',
                closedAt: serverTimestamp(),
            });

            if (selectedSessionId === activeSessionId) {
                await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                    activeSessionId: '',
                    updatedAt: serverTimestamp(),
                });
            }
            setMessage('선택한 세션을 종료했습니다.');
        } catch (error) {
            console.error('Failed to close think cloud session:', error);
            setMessage('세션 종료에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const handlePauseSession = async () => {
        if (!selectedSessionId) return;
        setLoadingAction(true);
        setMessage('');
        try {
            const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), selectedSessionId);
            await updateDoc(sessionRef, { status: 'paused' });
            if (selectedSessionId === activeSessionId) {
                await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                    activeSessionId: '',
                    updatedAt: serverTimestamp(),
                });
            }
            setMessage('선택한 세션을 일시 정지했습니다.');
        } catch (error) {
            console.error('Failed to pause think cloud session:', error);
            setMessage('일시 정지에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const handleResumeSession = async () => {
        if (!selectedSessionId) return;
        setLoadingAction(true);
        setMessage('');
        try {
            if (activeSessionId && activeSessionId !== selectedSessionId) {
                const previousRef = doc(db, buildThinkCloudSessionCollectionPath(config), activeSessionId);
                await updateDoc(previousRef, { status: 'paused' });
            }

            const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), selectedSessionId);
            await updateDoc(sessionRef, {
                status: 'active',
                activatedAt: serverTimestamp(),
            });
            await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                activeSessionId: selectedSessionId,
                updatedAt: serverTimestamp(),
            });
            setMessage('선택한 세션을 재개했습니다.');
        } catch (error) {
            console.error('Failed to resume think cloud session:', error);
            setMessage('재개에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const handleDeleteSession = async () => {
        if (!selectedSessionId) return;
        const confirmed = window.confirm('선택한 주제를 삭제할까요? 해당 주제의 응답도 함께 삭제됩니다.');
        if (!confirmed) return;

        setLoadingAction(true);
        setMessage('');
        try {
            const responsesRef = collection(db, buildThinkCloudResponsesCollectionPath(config, selectedSessionId));
            const responsesSnap = await getDocs(responsesRef);
            if (!responsesSnap.empty) {
                const batch = writeBatch(db);
                responsesSnap.docs.forEach((item) => {
                    batch.delete(item.ref);
                });
                await batch.commit();
            }

            const sessionRef = doc(db, buildThinkCloudSessionCollectionPath(config), selectedSessionId);
            await deleteDoc(sessionRef);

            if (selectedSessionId === activeSessionId) {
                await setDoc(doc(db, buildThinkCloudStateDocPath(config)), {
                    activeSessionId: '',
                    updatedAt: serverTimestamp(),
                });
            }

            setSelectedSessionId('');
            setMessage('선택한 주제를 삭제했습니다.');
        } catch (error) {
            console.error('Failed to delete think cloud session:', error);
            setMessage('삭제에 실패했습니다.');
        } finally {
            setLoadingAction(false);
        }
    };

    const renderCreatePanel = () => (
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="border-b border-gray-100 pb-4 mb-6">
                <h2 className="text-lg font-extrabold text-gray-900">새 생각모아 주제</h2>
                <p className="text-sm text-gray-500 mt-1">주제와 옵션을 설정한 뒤 세션을 시작하세요.</p>
            </div>

                <div className="space-y-6">
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">주제</label>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="예: 조선 후기 사회 변화를 한 단어로 표현해 보세요"
                        className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
                    />
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">설명</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="학생 안내 문구를 입력해 주세요."
                        className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none resize-y"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">학년</span>
                        <select
                            value={targetGrade}
                            onChange={(e) => setTargetGrade(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
                        >
                            {gradeOptions.map((grade) => (
                                <option key={grade.value} value={grade.value}>{grade.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">반</span>
                        <select
                            value={targetClass}
                            onChange={(e) => setTargetClass(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
                        >
                            {classOptions.map((cls) => (
                                <option key={cls.value} value={cls.value}>{cls.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">중복 제출 허용</span>
                        <input
                            type="checkbox"
                            checked={options.allowDuplicatePerUser}
                            onChange={(e) => setOptions((prev) => ({ ...prev, allowDuplicatePerUser: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">익명 표시</span>
                        <input
                            type="checkbox"
                            checked={options.anonymous}
                            onChange={(e) => setOptions((prev) => ({ ...prev, anonymous: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">금칙어 필터</span>
                        <input
                            type="checkbox"
                            checked={options.profanityFilter}
                            onChange={(e) => setOptions((prev) => ({ ...prev, profanityFilter: e.target.checked }))}
                            className="w-5 h-5"
                        />
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-700">입력 형식</span>
                        <select
                            value={options.inputMode}
                            onChange={(e) => setOptions((prev) => ({ ...prev, inputMode: e.target.value as ThinkCloudOptions['inputMode'] }))}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
                        >
                            <option value="word">단어 1개</option>
                            <option value="sentence">짧은 문장</option>
                        </select>
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 md:col-span-2">
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
                            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 font-bold text-right bg-white"
                        />
                    </label>
                </div>

                <div className="text-right">
                    <button
                        onClick={() => void handleStartSession()}
                        disabled={loadingAction}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition disabled:opacity-60"
                    >
                        {loadingAction ? '처리 중...' : '세션 시작'}
                    </button>
                </div>
            </div>
        </section>
    );

    const renderDetailPanel = () => {
        if (!selectedSession) {
            return (
                <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <p className="text-gray-500 font-bold">좌측에서 주제를 선택하거나 새 주제를 추가해 주세요.</p>
                </section>
            );
        }

        const isActive = selectedSession.id === activeSessionId && selectedSession.status === 'active';
        const isPaused = selectedSession.status === 'paused';

        return (
            <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-extrabold text-gray-900">{selectedSession.title}</h2>
                        <p className="text-sm text-gray-500 mt-1">{selectedSession.description || '설명 없음'}</p>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isPaused ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {isActive ? '진행 중' : isPaused ? '일시 정지' : '종료됨'}
                    </span>
                </div>

                <div className="flex flex-wrap gap-2 mb-4 text-xs font-bold">
                    <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        대상 {formatGradeLabel(selectedSession.targetGrade, selectedSession.targetGradeLabel)} {formatClassLabel(selectedSession.targetClass, selectedSession.targetClassLabel)}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        {selectedSession.options.inputMode === 'word' ? '단어 1개 입력' : '짧은 문장 입력'}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        최대 {selectedSession.options.maxLength}자
                    </span>
                    <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                        {selectedSession.options.allowDuplicatePerUser ? '중복 제출 허용' : '중복 제출 제한'}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                        {selectedSession.options.anonymous ? '익명 표시' : '이름 표시'}
                    </span>
                </div>

                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-800">실시간 집계</h3>
                    <span className="text-sm font-bold text-gray-500">응답 {responses.length}개</span>
                </div>

                {cloudEntries.length === 0 ? (
                    <p className="text-sm text-gray-500 font-bold">아직 제출된 응답이 없습니다.</p>
                ) : (
                    <button
                        type="button"
                        onClick={() => setCloudModalOpen(true)}
                        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl"
                        title="클릭해서 크게 보기"
                    >
                        <WordCloudView entries={cloudEntries} showSubmitters={!selectedSession.options.anonymous} />
                    </button>
                )}

                <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <button
                        onClick={() => void handlePauseSession()}
                        disabled={!isActive || loadingAction}
                        className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
                    >
                        {loadingAction ? '처리 중...' : '일시 정지'}
                    </button>
                    <button
                        onClick={() => void handleResumeSession()}
                        disabled={isActive || selectedSession.status === 'closed' || loadingAction}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
                    >
                        {loadingAction ? '처리 중...' : '재개'}
                    </button>
                    <button
                        onClick={() => void handleCloseSession()}
                        disabled={!isActive || loadingAction}
                        className="bg-gray-700 hover:bg-gray-800 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
                    >
                        {loadingAction ? '처리 중...' : '이 세션 종료'}
                    </button>
                    <button
                        onClick={() => void handleDeleteSession()}
                        disabled={loadingAction}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
                    >
                        {loadingAction ? '처리 중...' : '주제 삭제'}
                    </button>
                </div>
            </section>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-8 gap-6 max-w-7xl mx-auto w-full">
                <aside className="w-full lg:w-72 shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-gray-100">
                            <h1 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                                <i className="fas fa-cloud text-blue-500"></i> 생각모아
                            </h1>
                            <button
                                onClick={openCreateMode}
                                className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg"
                            >
                                + 새 주제
                            </button>
                        </div>

                        <nav className="max-h-[60vh] overflow-y-auto">
                            {sessions.length === 0 && (
                                <p className="p-4 text-sm font-bold text-gray-500">저장된 주제가 없습니다.</p>
                            )}
                            {sessions.map((session) => {
                                const isSelected = !isCreateMode && selectedSessionId === session.id;
                                const isActive = session.id === activeSessionId && session.status === 'active';
                                return (
                                    <button
                                        key={session.id}
                                        onClick={() => selectSession(session.id)}
                                        className={`w-full px-4 py-3 text-left border-l-4 transition ${isSelected ? 'bg-blue-50 text-blue-700 border-blue-600' : 'text-gray-700 border-transparent hover:bg-gray-50'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-bold truncate">{session.title}</p>
                                            {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">LIVE</span>}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1 truncate">
                                            {formatGradeLabel(session.targetGrade, session.targetGradeLabel)} {formatClassLabel(session.targetClass, session.targetClassLabel)} · {session.description || '설명 없음'}
                                        </p>
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </aside>

                <div className="flex-1">
                    {isCreateMode ? renderCreatePanel() : renderDetailPanel()}
                    {message && <p className="mt-3 text-sm font-bold text-blue-700">{message}</p>}
                </div>
            </main>

            {cloudModalOpen && (
                <div
                    className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setCloudModalOpen(false)}
                >
                    <div
                        className="w-full max-w-[96vw] h-[92vh] bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 md:p-6 flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-lg md:text-xl font-extrabold text-gray-900">
                                생각모아 워드클라우드 대형 보기
                            </h3>
                            <button
                                type="button"
                                onClick={() => setCloudModalOpen(false)}
                                className="w-10 h-10 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                aria-label="닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="text-sm font-bold text-gray-600 mb-3">
                            TV 출력용 모드입니다. 응답 {responses.length}개
                        </div>
                        <div className="flex-1 flex items-center justify-center">
                            <WordCloudView
                                entries={cloudEntries}
                                showSubmitters={!!selectedSession && !selectedSession.options.anonymous}
                                className="h-full w-full"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageThinkCloud;
