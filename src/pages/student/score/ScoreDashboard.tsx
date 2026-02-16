import React, { useEffect, useState, useRef } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import GradeChart from './components/GradeChart';
import ScoreCard from './components/ScoreCard';

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
    const [showWarning, setShowWarning] = useState(true);
    const [agree, setAgree] = useState(false);

    // Filters
    const [semester, setSemester] = useState(config?.semester || '1');
    const [grade, setGrade] = useState('1');
    const [sortMode, setSortMode] = useState('latest');

    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (userData && config) {
            setSemester(config.semester); // Sync with global config initially
            // Maybe set grade from user profile? 
            // setGrade(userData.grade || '1'); // If available
            fetchData();
        }
    }, [userData, config]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Plans
            const q = query(collection(db, 'grading_plans'), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            const loadedPlans: GradingPlan[] = [];
            snap.forEach(d => loadedPlans.push({ id: d.id, ...d.data() } as GradingPlan));
            setPlans(loadedPlans);

            // 2. Fetch User Scores
            const year = config?.year || '2025';
            const scoreDocId = `${year}_${semester}`;
            // IMPORTANT: Based on previous logic, scores are stored under users/{uid}/academic_records/{scoreDocId}
            if (userData) {
                const scoreRef = doc(db, 'users', userData.uid, 'academic_records', scoreDocId);
                const scoreSnap = await getDoc(scoreRef);
                if (scoreSnap.exists()) {
                    setUserScores(scoreSnap.data().scores || {});
                } else {
                    setUserScores({});
                }
            }

        } catch (error) {
            console.error("Error loading score data:", error);
        } finally {
            setLoading(false);
        }
    };

    // Re-fetch user scores when semester changes? 
    // Ideally we should refetch scores when semester changes, plans are global but filtered.
    useEffect(() => {
        if (!loading && userData) {
            const reloadScores = async () => {
                const year = config?.year || '2025';
                const scoreDocId = `${year}_${semester}`;
                const scoreRef = doc(db, 'users', userData.uid, 'academic_records', scoreDocId);
                const scoreSnap = await getDoc(scoreRef);
                if (scoreSnap.exists()) {
                    setUserScores(scoreSnap.data().scores || {});
                } else {
                    setUserScores({});
                }
            };
            reloadScores();
        }
    }, [semester]);


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

        // Debounce Save
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        setSaving(true);
        saveTimeoutRef.current = setTimeout(async () => {
            await saveScores(newScores);
            setSaving(false);
        }, 1000);
    };

    const saveScores = async (scoresToSave: any) => {
        if (!userData) return;
        const year = config?.year || '2025';
        const scoreDocId = `${year}_${semester}`;
        try {
            await setDoc(doc(db, 'users', userData.uid, 'academic_records', scoreDocId), {
                scores: scoresToSave,
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error("Save failed", e);
        }
    };

    // Processing for Display
    const getFilteredAndSortedPlans = () => {
        const year = config?.year || '2025';

        let filtered = plans.filter(p => {
            const pGrade = p.targetGrade || "2";
            const pYear = p.academicYear || "2025";
            const pSem = p.semester || "1";
            // Filter logic matches existing dashboard
            return String(pGrade) === grade && pYear === year && pSem === semester;
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
                            onClick={() => setShowWarning(false)}
                            disabled={!agree}
                            className={`w-full py-3.5 rounded-xl font-bold text-lg transition ${agree ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                        >
                            확 인
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
            </div>

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
        </div>
    );
};

export default ScoreDashboard;
