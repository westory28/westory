import React, { useEffect, useState, useRef } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import GradeChart from './components/GradeChart';
import ScoreCard from './components/ScoreCard';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

interface GradingPlan {
    id: string;
    subject: string;
    items: any[];
    targetGrade?: string;
    academicYear?: string;
    semester?: string;
    createdAt?: any;
}

const ScoreDashboard: React.FC = () => {
    const { userData, config } = useAuth();
    const [loading, setLoading] = useState(true);
    const [plans, setPlans] = useState<GradingPlan[]>([]);
    const [userScores, setUserScores] = useState<{ [key: string]: string }>({});
    const [saving, setSaving] = useState(false);
    const [showWarning, setShowWarning] = useState(false);
    const [agree, setAgree] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [warningSaving, setWarningSaving] = useState(false);

    // Filters
    const [semester, setSemester] = useState(config?.semester || '1');
    const [grade, setGrade] = useState(userData?.grade || '1');
    const [sortMode, setSortMode] = useState('importance');

    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const didInitDefaultsRef = useRef(false);

    const getDraftKey = (targetSemester: string) => {
        const year = config?.year || '2025';
        const uid = userData?.uid || 'anonymous';
        return `scoreDraft:${uid}:${year}:${targetSemester}`;
    };

    const persistDraftScores = (targetSemester: string, scoresToDraft: { [key: string]: string }) => {
        try {
            localStorage.setItem(getDraftKey(targetSemester), JSON.stringify({
                scores: scoresToDraft,
                savedAt: Date.now()
            }));
        } catch (error) {
            console.error('Failed to persist temporary scores:', error);
        }
    };

    const loadDraftScores = (targetSemester: string): { [key: string]: string } => {
        try {
            const raw = localStorage.getItem(getDraftKey(targetSemester));
            if (!raw) return {};
            const parsed = JSON.parse(raw) as { scores?: { [key: string]: string } };
            return parsed?.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
        } catch (error) {
            console.error('Failed to load temporary scores:', error);
            return {};
        }
    };

    const clearDraftScores = (targetSemester: string) => {
        try {
            localStorage.removeItem(getDraftKey(targetSemester));
        } catch (error) {
            console.error('Failed to clear temporary scores:', error);
        }
    };

    useEffect(() => {
        if (!userData || didInitDefaultsRef.current) return;
        setSemester(config?.semester || '1');
        setGrade(userData.grade || '1');
        setSortMode('importance');
        didInitDefaultsRef.current = true;
    }, [userData, config]);

    useEffect(() => {
        if (userData) {
            fetchData(semester);
            return;
        }
        setLoading(false);
    }, [userData, config, semester]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (!lastSavedAt) return;
        const timer = window.setTimeout(() => setLastSavedAt(null), 2000);
        return () => window.clearTimeout(timer);
    }, [lastSavedAt]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            persistDraftScores(semester, userScores);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                persistDraftScores(semester, userScores);
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [semester, userScores]);

    const fetchData = async (targetSemester: string = semester) => {
        setLoading(true);
        try {
            // 1. Fetch Plans
            let snap = await getDocs(query(
                collection(db, getSemesterCollectionPath({ year: config?.year || '2026', semester: targetSemester }, 'grading_plans')),
                orderBy('createdAt', 'desc')
            ));
            if (snap.empty) {
                snap = await getDocs(query(collection(db, 'grading_plans'), orderBy('createdAt', 'desc')));
            }
            const loadedPlans: GradingPlan[] = [];
            snap.forEach(d => loadedPlans.push({ id: d.id, ...d.data() } as GradingPlan));
            setPlans(loadedPlans);

            // 2. Fetch User Scores
            const year = config?.year || '2025';
            const scoreDocId = `${year}_${targetSemester}`;
            // IMPORTANT: Based on previous logic, scores are stored under users/{uid}/academic_records/{scoreDocId}
            if (userData) {
                const scoreRef = doc(db, 'users', userData.uid, 'academic_records', scoreDocId);
                const scoreSnap = await getDoc(scoreRef);
                const remoteScores = scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {};
                const draftScores = loadDraftScores(targetSemester);
                const mergedScores = { ...remoteScores, ...draftScores };
                setUserScores(mergedScores);

                const userRef = doc(db, 'users', userData.uid);
                const userSnap = await getDoc(userRef);
                const warningAcknowledged = userSnap.exists() && userSnap.data().scoreWarningAcknowledged === true;
                setShowWarning(!warningAcknowledged);
                setAgree(warningAcknowledged);
            }

        } catch (error) {
            console.error("Error loading score data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleScoreChange = (planId: string, idx: number, val: string) => {
        const numVal = parseFloat(val);
        // Find max score for validation
        const plan = plans.find(p => p.id === planId);
        const item = plan?.items[idx];
        let finalVal = val;

        if (item && !isNaN(numVal)) {
            if (numVal > item.maxScore) finalVal = item.maxScore.toString();
            if (numVal < 0) finalVal = '0';
        }

        const key = `${planId}_${idx}`;
        const newScores = { ...userScores, [key]: finalVal };
        setUserScores(newScores);
        setSaveError(null);
        persistDraftScores(semester, newScores);

        // Debounce Save
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        setSaving(true);
        const semesterForSave = semester;
        saveTimeoutRef.current = setTimeout(async () => {
            await saveScores(newScores, semesterForSave);
            setSaving(false);
        }, 1000);
    };

    const sanitizeScores = (scoresToSave: { [key: string]: string }) => {
        const sanitized: { [key: string]: string } = {};
        Object.entries(scoresToSave || {}).forEach(([key, rawValue]) => {
            if (!key || key.length > 120 || !/^.+_\d+$/.test(key)) return;
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1000) return;
            sanitized[key] = String(numeric);
        });
        return sanitized;
    };

    const saveScores = async (scoresToSave: { [key: string]: string }, targetSemester: string = semester) => {
        if (!userData) return;
        const year = config?.year || '2025';
        const scoreDocId = `${year}_${targetSemester}`;
        const sanitizedScores = sanitizeScores(scoresToSave);
        try {
            await setDoc(doc(db, 'users', userData.uid, 'academic_records', scoreDocId), {
                scores: sanitizedScores,
                updatedAt: serverTimestamp()
            }, { merge: true });
            setLastSavedAt(Date.now());
            setSaveError(null);
            clearDraftScores(targetSemester);
        } catch (e) {
            console.error("Save failed", e);
            setSaveError("저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        }
    };

    const handleManualSave = async () => {
        setSaving(true);
        await saveScores(userScores, semester);
        setSaving(false);
    };

    const handleConfirmWarning = async () => {
        if (!agree || !userData) return;
        setWarningSaving(true);
        try {
            await setDoc(doc(db, 'users', userData.uid), {
                scoreWarningAcknowledged: true,
                scoreWarningAcknowledgedAt: serverTimestamp()
            }, { merge: true });
            setShowWarning(false);
        } catch (e) {
            console.error("Warning agreement save failed", e);
            alert("동의 상태 저장에 실패했습니다. 다시 시도해 주세요.");
        } finally {
            setWarningSaving(false);
        }
    };

    // Processing for Display
    const getFilteredAndSortedPlans = () => {
        const year = config?.year || '2025';

        let filtered = plans.filter(p => {
            const pGrade = p.targetGrade || "2";
            const pYear = p.academicYear;
            const pSem = p.semester;
            // Filter logic matches existing dashboard
            const yearMatch = !pYear || pYear === year;
            const semesterMatch = !pSem || pSem === semester;
            return String(pGrade) === grade && yearMatch && semesterMatch;
        });

        // Calculate Totals
        const processed = filtered.map(p => {
            let total = 0;
            let hasData = false;
            p.items.forEach((item, idx) => {
                const key = `${p.id}_${idx}`;
                const saved = userScores[key];
                if (saved !== undefined && saved !== "" && saved !== null) {
                    hasData = true;
                    const val = parseFloat(saved);
                    if (!isNaN(val)) total += (val / item.maxScore) * item.ratio;
                }
            });
            return { ...p, currentScore: parseFloat(total.toFixed(1)), hasData };
        });

        // Sort
        const SUBJECT_PRIORITY = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '기가', '정보', '음악', '미술', '체육'];

        if (sortMode === 'name') {
            processed.sort((a, b) => a.subject.localeCompare(b.subject));
        } else if (sortMode === 'importance') {
            processed.sort((a, b) => {
                const getIdx = (subj: string) => {
                    const idx = SUBJECT_PRIORITY.findIndex(key => subj.includes(key));
                    return idx === -1 ? 999 : idx;
                };
                return getIdx(a.subject) - getIdx(b.subject) || a.subject.localeCompare(b.subject);
            });
        } else {
            // Latest
            processed.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        }

        return processed;
    };

    const displayPlans = getFilteredAndSortedPlans();

    // Chart Data
    const chartLabels = displayPlans.map(p => p.subject);
    const chartData = displayPlans.map(p => p.currentScore);
    // Determine colors helper
    const getChartColor = (score: number, subj: string) => {
        const isArtsPE = ['음악', '미술', '체육'].some(key => subj.includes(key));
        if (isArtsPE) {
            if (score >= 80) return '#fa5252';
            if (score >= 60) return '#fab005';
            return '#339af0';
        }
        if (score >= 90) return '#fa5252';
        if (score >= 80) return '#fd7e14';
        if (score >= 70) return '#fab005';
        if (score >= 60) return '#51cf66';
        return '#339af0';
    };
    const chartColors = displayPlans.map(p => getChartColor(p.currentScore, p.subject));


    if (loading) return <div className="flex justify-center items-center h-screen"><div className="loader-spinner"></div></div>;

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-fadeIn">
            {/* Warning Modal Overlay */}
            {showWarning && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center backdrop-blur-sm p-4">
                    <div className="bg-white p-8 rounded-2xl w-full max-w-md text-center shadow-2xl animate-fadeScale">
                        <div className="text-4xl mb-2">⚠️</div>
                        <h3 className="text-xl font-bold text-amber-600 mb-4">주의사항 안내</h3>
                        <div className="text-sm text-gray-600 mb-6 leading-relaxed">
                            이 결과는 <strong>참고용 시뮬레이션</strong>이며,<br />
                            정확한 성적은 <u>나이스(NEIS)</u> 및 <u>성적 통지표</u>를 확인하세요.
                        </div>
                        <div className="text-xs text-gray-400 mb-4 bg-gray-50 p-2 rounded">
                            입력한 점수는 사용자의 계정에 안전하게 저장됩니다.
                        </div>
                        <div
                            className="flex items-center justify-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition mb-4"
                            onClick={() => setAgree(!agree)}
                        >
                            <input
                                type="checkbox"
                                checked={agree}
                                onChange={(e) => setAgree(e.target.checked)}
                                className="w-4 h-4 text-blue-600"
                            />
                            <label className="text-sm font-bold text-gray-700 cursor-pointer">위 내용을 확인하였으며 동의합니다.</label>
                        </div>
                        <button
                            onClick={handleConfirmWarning}
                            disabled={!agree || warningSaving}
                            className={`w-full py-3.5 rounded-xl font-bold text-lg transition ${agree && !warningSaving ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                        >
                            {warningSaving ? '저장 중...' : '확 인'}
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-gray-800 pb-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-baseline">
                    나의 성적표
                    <span className="text-lg font-normal text-gray-500 ml-2">({config?.year}학년도)</span>
                </h1>
                <div className="text-blue-600 font-bold mt-2 md:mt-0">
                    {userData?.name || '학생'} 학생, 화이팅!
                </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6 flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-600">학기</span>
                    <select
                        value={semester}
                        onChange={(e) => setSemester(e.target.value)}
                        className="p-2 border border-gray-300 rounded text-sm min-w-[100px]"
                    >
                        <option value="1">1학기</option>
                        <option value="2">2학기</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-600">학년</span>
                    <select
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        className="p-2 border border-gray-300 rounded text-sm min-w-[100px]"
                    >
                        <option value="1">1학년</option>
                        <option value="2">2학년</option>
                        <option value="3">3학년</option>
                    </select>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-sm font-bold text-gray-600">정렬</span>
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value)}
                        className="p-2 border border-gray-300 rounded text-sm min-w-[120px]"
                    >
                        <option value="latest">등록순 (최신)</option>
                        <option value="name">과목명 (가나다)</option>
                        <option value="importance">중요도순 (국영수...)</option>
                    </select>
                </div>
                <button
                    onClick={handleManualSave}
                    disabled={saving || showWarning}
                    className={`px-4 py-2 rounded text-sm font-bold transition ${saving || showWarning ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                    저장
                </button>
            </div>

            {saveError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {saveError}
                </div>
            )}

            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
                {/* Left: Cards */}
                <div>
                    {displayPlans.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-400">
                            해당 학기의 평가 기준 데이터가 없습니다.
                        </div>
                    ) : (
                        displayPlans.map(plan => (
                            <ScoreCard
                                key={plan.id}
                                plan={plan}
                                userScores={userScores}
                                onScoreChange={handleScoreChange}
                                totalScore={plan.currentScore}
                                hasData={plan.hasData}
                            />
                        ))
                    )}
                </div>

                {/* Right: Chart */}
                <div>
                    <div className="bg-white p-5 rounded-xl border border-gray-100 sticky top-20 shadow-sm">
                        <div className="text-base font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4">성취도 그래프</div>
                        <div className="h-[300px]">
                            <GradeChart labels={chartLabels} data={chartData} colors={chartColors} />
                        </div>
                        {/* Legend Bar */}
                        <div className="flex h-8 rounded-lg overflow-hidden mt-6 text-xs font-bold text-white shadow-inner">
                            <div className="flex-1 flex items-center justify-center bg-red-500">A</div>
                            <div className="flex-1 flex items-center justify-center bg-orange-500">B</div>
                            <div className="flex-1 flex items-center justify-center bg-yellow-500">C</div>
                            <div className="flex-1 flex items-center justify-center bg-green-500">D</div>
                            <div className="flex-1 flex items-center justify-center bg-blue-500">E</div>
                        </div>
                        <div className="text-[10px] text-gray-400 text-right mt-2 w-full pr-1">
                            * 예체능은 A/B/C 3단계 평가
                        </div>
                    </div>
                </div>
            </div>

            {/* Save Indicator */}
            {saving && (
                <div className="fixed bottom-5 right-5 bg-gray-800 text-white px-5 py-2.5 rounded-full text-xs flex items-center gap-2 shadow-lg z-50 animate-fadeIn">
                    <i className="fas fa-sync fa-spin"></i> 저장 중...
                </div>
            )}
            {!saving && lastSavedAt && !saveError && (
                <div className="fixed bottom-5 right-5 bg-emerald-700 text-white px-5 py-2.5 rounded-full text-xs flex items-center gap-2 shadow-lg z-50 animate-fadeIn">
                    <i className="fas fa-check"></i> 저장 완료
                </div>
            )}
        </div>
    );
};

export default ScoreDashboard;
