import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, getDocs, query, where, orderBy, limit, documentId, setDoc, serverTimestamp } from 'firebase/firestore';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface UserProfile {
    name: string;
    grade?: number;
    class?: number;
    number?: number;
    profileIcon?: string;
}

interface QuizResult {
    score: number;
    timestamp: any;
    timeString?: string;
    details?: any[];
}

const SUBJECT_PRIORITY = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '기가', '정보', '음악', '미술', '체육'];
const SAFE_STUDENT_ICONS = [
    '🧑‍🎓', '👨‍🎓', '👩‍🎓', '🧑', '👦', '👧', '🧒', '🙋', '🙋‍♂️', '🙋‍♀️',
    '📚', '📝', '✍️', '🎯', '🔍', '💡', '🌱', '🌟', '🚀'
];

const MyPage = () => {
    const { user, userData } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [quizCount, setQuizCount] = useState(0);
    const [scoreCount, setScoreCount] = useState(0);
    const [scoreData, setScoreData] = useState<any>(null);
    const [quizData, setQuizData] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<'wrong' | 'activity'>('wrong');
    const [wrongAnswers, setWrongAnswers] = useState<any[]>([]);
    const [loadingWrong, setLoadingWrong] = useState(false);
    const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
    const [profileIcon, setProfileIcon] = useState('🧑‍🎓');
    const [iconPickerOpen, setIconPickerOpen] = useState(false);
    const [savingIcon, setSavingIcon] = useState(false);

    const [currentConfig, setCurrentConfig] = useState<{ year: string; semester: string } | null>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const configDoc = await getDoc(doc(db, 'site_settings', 'config'));
                if (configDoc.exists()) {
                    setCurrentConfig(configDoc.data() as { year: string; semester: string });
                }
            } catch (error) {
                console.error("Error fetching config:", error);
            }
        };
        fetchConfig();
    }, []);

    useEffect(() => {
        if (!user || !currentConfig) return;

        const loadProfile = async () => {
            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    const loaded = userDoc.data() as UserProfile;
                    setProfile(loaded);
                    setProfileIcon(loaded.profileIcon || '🧑‍🎓');
                }
            } catch (error) {
                console.error("Error loading profile:", error);
            }
        };

        const loadDashboardData = async () => {
            try {
                await Promise.all([
                    renderScoreChart(),
                    renderQuizChart(),
                    renderWrongAnswers()
                ]);
            } catch (e) {
                console.error("Dashboard Load Error", e);
            }
        };

        loadProfile();
        loadDashboardData();
    }, [user, currentConfig]);


    const renderScoreChart = async () => {
        if (!user || !currentConfig) return;
        const scoreDocId = `${currentConfig.year}_${currentConfig.semester}`;

        // Fetch User Scores
        // Path: users/{uid}/academic_records/{year_semester}
        const scoreDocRef = doc(db, 'users', user.uid, 'academic_records', scoreDocId);
        const scoreDoc = await getDoc(scoreDocRef);
        const userScores = scoreDoc.exists() ? scoreDoc.data().scores || {} : {};

        // Fetch Grading Plans
        // Path: years/{year}/semesters/{semester}/grading_plans
        const plansRef = collection(db, 'years', currentConfig.year, 'semesters', currentConfig.semester, 'grading_plans');
        const plansSnap = await getDocs(query(plansRef, orderBy("createdAt", "desc")));

        const subjects: { [key: string]: number } = {};

        plansSnap.forEach(doc => {
            const plan = doc.data();
            let total = 0;
            if (plan.items && Array.isArray(plan.items)) {
                plan.items.forEach((item: any, idx: number) => {
                    const key = `${doc.id}_${idx}`;
                    const saved = userScores[key];
                    if (saved) {
                        const val = parseFloat(saved);
                        if (!isNaN(val)) total += (val / item.maxScore) * item.ratio;
                    }
                });
                // Store highest if duplicates exists (or just overwrite)
                subjects[plan.subject] = parseFloat(total.toFixed(1));
            }
        });

        const sortedEntries = Object.entries(subjects).sort((a, b) => {
            const getPriority = (subject: string) => {
                const idx = SUBJECT_PRIORITY.findIndex((key) => subject.includes(key));
                return idx === -1 ? 999 : idx;
            };
            return getPriority(a[0]) - getPriority(b[0]) || a[0].localeCompare(b[0]);
        });

        const labels = sortedEntries.map(([subject]) => subject);
        const data = sortedEntries.map(([, score]) => score);
        setScoreCount(labels.length);

        if (data.length > 0) {
            setScoreData({
                labels,
                datasets: [{
                    label: '환산 점수',
                    data: data,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            });
        } else {
            setScoreData(null);
        }
    };


    const renderQuizChart = async () => {
        if (!user || !currentConfig) return;
        // Path: years/{year}/semesters/{semester}/quiz_results
        const resultsRef = collection(db, 'years', currentConfig.year, 'semesters', currentConfig.semester, 'quiz_results');
        const q = query(resultsRef, where('uid', '==', user.uid), orderBy('timestamp', 'desc'), limit(10));
        const snap = await getDocs(q);

        const results: QuizResult[] = [];
        snap.forEach(doc => results.push(doc.data() as QuizResult));
        setQuizCount(results.length); // Note: this is just recent 10 count, ideally we need total count

        results.reverse();

        if (results.length > 0) {
            setQuizData({
                labels: results.map((_, i) => `${i + 1}회`),
                datasets: [{
                    label: '점수',
                    data: results.map(r => r.score),
                    borderColor: '#10b981', // emerald-500
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4
                }]
            });
        } else {
            setQuizData(null);
        }
    };

    const renderWrongAnswers = async () => {
        if (!user || !currentConfig) return;
        setLoadingWrong(true);
        // Path: years/{year}/semesters/{semester}/quiz_results
        const resultsRef = collection(db, 'years', currentConfig.year, 'semesters', currentConfig.semester, 'quiz_results');
        const q = query(resultsRef, where('uid', '==', user.uid), orderBy('timestamp', 'desc'), limit(20));
        const snap = await getDocs(q);

        const questionIds = new Set<string>();
        const logMap: { qid: string; u: any; date: any }[] = [];

        snap.forEach(doc => {
            const data = doc.data();
            if (data.details && Array.isArray(data.details)) {
                data.details.forEach((log: any) => {
                    if (!log.correct) {
                        questionIds.add(String(log.id));
                        logMap.push({ qid: String(log.id), u: log.u, date: data.timeString });
                    }
                });
            }
        });

        if (questionIds.size === 0) {
            setWrongAnswers([]);
            setLoadingWrong(false);
            return;
        }

        const idsArray = Array.from(questionIds);
        const chunks = [];
        for (let i = 0; i < idsArray.length; i += 10) chunks.push(idsArray.slice(i, i + 10));

        const questionDetails: { [key: string]: any } = {};
        const questionsRef = collection(db, 'years', currentConfig.year, 'semesters', currentConfig.semester, 'quiz_questions');

        await Promise.all(chunks.map(async chunk => {
            const qSnap = await getDocs(query(questionsRef, where(documentId(), 'in', chunk)));
            qSnap.forEach(d => questionDetails[d.id] = d.data());
        }));

        const compiledWrongAnswers: any[] = [];
        const renderedQids = new Set();

        logMap.forEach(item => {
            if (renderedQids.has(item.qid)) return;
            const qData = questionDetails[item.qid];
            if (!qData) return;

            renderedQids.add(item.qid);
            compiledWrongAnswers.push({
                ...qData,
                userAnswer: item.u,
                date: item.date
            });
        });

        setWrongAnswers(compiledWrongAnswers);
        setLoadingWrong(false);
    };

    const toggleAccordion = (index: string) => {
        setExpandedQuestionId(expandedQuestionId === index ? null : index);
    };

    const getTitleBadges = () => {
        const badges: string[] = [];
        if (scoreCount >= 8) badges.push('수업 시간에 집중하는');
        if (quizCount >= 8) badges.push('역사에 열정적인');
        if (wrongAnswers.length > 0 && wrongAnswers.length <= 3) badges.push('실수를 성장으로 바꾸는');
        if (wrongAnswers.length === 0 && quizCount >= 3) badges.push('꼼꼼하게 정답을 만드는');
        if (badges.length === 0) badges.push('배움의 씨앗을 키우는');
        return badges.slice(0, 2);
    };

    const titleBadges = getTitleBadges();

    const handleProfileIconChange = async (nextIcon: string) => {
        if (!user) return;
        setSavingIcon(true);
        try {
            await setDoc(doc(db, 'users', user.uid), {
                profileIcon: nextIcon,
                updatedAt: serverTimestamp()
            }, { merge: true });
            setProfileIcon(nextIcon);
            setProfile((prev) => (prev ? { ...prev, profileIcon: nextIcon } : prev));
            setIconPickerOpen(false);
        } catch (error) {
            console.error('Failed to save profile icon:', error);
            alert('아이콘 저장에 실패했습니다.');
        } finally {
            setSavingIcon(false);
        }
    };

    return (
        <div className="bg-gray-50 min-h-screen flex flex-col">
            <main className="flex-grow w-full max-w-6xl mx-auto px-4 py-8">

                {/* 1. Profile Section */}
                <section className="mb-8">
                    <div className="bg-gradient-to-br from-blue-800 to-blue-600 text-white rounded-3xl p-8 flex flex-col md:flex-row items-center gap-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-16 -mt-16 blur-2xl"></div>

                        <div className="relative z-10">
                            <div className="w-24 h-24 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-4xl border-4 border-white/30 shadow-lg">
                                {profileIcon}
                            </div>
                            <button
                                type="button"
                                onClick={() => setIconPickerOpen(true)}
                                className="absolute bottom-0 right-0 bg-white text-blue-600 text-xs font-bold w-7 h-7 rounded-full shadow-md border border-blue-100 hover:bg-blue-50 transition flex items-center justify-center"
                                title="아이콘 수정"
                            >
                                <i className="fas fa-pen"></i>
                            </button>
                        </div>
                        <div className="text-center md:text-left flex-1 z-10">
                            <div className="mb-2 flex flex-wrap gap-2 justify-center md:justify-start">
                                {titleBadges.map((badge) => (
                                    <span key={badge} className="inline-flex items-center bg-white/20 text-blue-50 backdrop-blur rounded-full px-3 py-1 text-xs font-bold border border-white/30">
                                        🏅 {badge}
                                    </span>
                                ))}
                            </div>
                            <h1 className="text-3xl font-extrabold mb-1">{profile?.name || userData?.name || '학생'}</h1>
                            <p className="text-blue-100 font-medium mb-3">
                                {profile ? `${profile.grade || '--'}학년 ${profile.class || '--'}반 ${profile.number || '--'}번` : '--학년 --반 --번'}
                            </p>
                            <div className="inline-flex items-center bg-black/20 rounded-lg px-4 py-2 text-sm backdrop-blur-sm">
                                <i className="fas fa-trophy text-yellow-300 mr-2"></i>
                                <span>퀴즈 참여: <span className="font-bold text-white ml-1">{quizCount}</span>회</span>
                                <div className="w-px h-3 bg-white/30 mx-3"></div>
                                <i className="fas fa-pencil-alt text-green-300 mr-2"></i>
                                <span>성적 입력: <span className="font-bold text-white ml-1">{scoreCount}</span>과목</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 2. Charts Section */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Academic Score Chart */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col h-80">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-800 text-lg flex items-center">
                                <span className="w-1.5 h-6 bg-blue-600 rounded-full mr-2"></span>나의 성적표
                            </h3>
                            <span className="text-xs text-gray-400 font-mono">
                                {currentConfig ? `${currentConfig.year}-${currentConfig.semester}` : 'Loading...'}
                            </span>
                        </div>
                        <div className="flex-1 flex items-center justify-center relative w-full h-full">
                            {scoreData ? (
                                <Bar
                                    data={scoreData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        scales: { y: { beginAtZero: true, max: 100 } },
                                        plugins: { legend: { display: false } }
                                    }}
                                />
                            ) : (
                                <div className="text-gray-400 text-sm font-bold">성적 데이터가 없습니다.</div>
                            )}
                        </div>
                        <p className="text-xs text-center text-gray-400 mt-2">* 입력된 수행/정기 시험 점수 기준</p>
                    </div>

                    {/* Quiz Growth Chart */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col h-80">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-800 text-lg flex items-center">
                                <span className="w-1.5 h-6 bg-green-500 rounded-full mr-2"></span>퀴즈 성장 그래프
                            </h3>
                            <span className="text-xs text-gray-400">최근 10회</span>
                        </div>
                        <div className="flex-1 flex items-center justify-center relative w-full h-full">
                            {quizData ? (
                                <Line
                                    data={quizData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        scales: { y: { beginAtZero: true, max: 100 } },
                                        plugins: { legend: { display: false } }
                                    }}
                                />
                            ) : (
                                <div className="text-gray-400 text-sm font-bold">퀴즈 응시 기록이 없습니다.</div>
                            )}
                        </div>
                        <p className="text-xs text-center text-gray-400 mt-2">* 형성/진단 평가 종합</p>
                    </div>
                </section>

                {/* 3. Bottom Tabs */}
                <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden min-h-[400px]">
                    <div className="flex border-b border-gray-100">
                        <button
                            onClick={() => setActiveTab('wrong')}
                            className={`px-6 py-4 font-bold transition-all border-b-2 ${activeTab === 'wrong' ? 'text-blue-600 border-blue-600' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
                        >
                            <i className="fas fa-times-circle mr-2 text-red-400"></i>오답 노트
                        </button>
                        <button
                            onClick={() => setActiveTab('activity')}
                            className={`px-6 py-4 font-bold transition-all border-b-2 ${activeTab === 'activity' ? 'text-blue-600 border-blue-600' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
                        >
                            <i className="fas fa-file-alt mr-2 text-blue-400"></i>활동지 (준비중)
                        </button>
                    </div>

                    {/* Tab Content: Wrong Answers */}
                    {activeTab === 'wrong' && (
                        <div className="p-6">
                            {loadingWrong ? (
                                <div className="text-center py-10 text-gray-400">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-2"></div>
                                    <p>오답 데이터를 분석하고 있습니다...</p>
                                </div>
                            ) : wrongAnswers.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl">
                                    <i className="fas fa-check-circle text-4xl mb-4 text-green-300"></i>
                                    <p>최근 20회 퀴즈에서 오답이 없습니다. 훌륭해요!</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {wrongAnswers.map((q, idx) => (
                                        <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden hover:border-red-300 transition bg-white">
                                            <div
                                                className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50"
                                                onClick={() => toggleAccordion(String(idx))}
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded shrink-0">오답</span>
                                                    <h4 className="font-bold text-gray-800 truncate">{q.question}</h4>
                                                </div>
                                                <i className={`fas fa-chevron-down text-gray-400 transition-transform ${expandedQuestionId === String(idx) ? 'rotate-180' : ''}`}></i>
                                            </div>
                                            <div className={`bg-red-50 p-4 border-t border-gray-100 ${expandedQuestionId === String(idx) ? 'block' : 'hidden'}`}>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3 text-sm">
                                                    <div className="bg-white p-3 rounded border border-red-100">
                                                        <div className="text-xs text-gray-500 mb-1">나의 오답</div>
                                                        <div className="font-bold text-red-500 line-through">{q.userAnswer || '(미입력)'}</div>
                                                    </div>
                                                    <div className="bg-white p-3 rounded border border-green-100">
                                                        <div className="text-xs text-gray-500 mb-1">정답</div>
                                                        <div className="font-bold text-green-600">{q.answer}</div>
                                                    </div>
                                                </div>
                                                <div className="bg-white p-3 rounded border border-gray-200">
                                                    <div className="text-xs text-blue-500 font-bold mb-1"><i className="fas fa-lightbulb mr-1"></i>해설</div>
                                                    <p className="text-gray-700 text-sm leading-relaxed">{q.explanation || '해설 정보가 없습니다.'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tab Content: Activities */}
                    {activeTab === 'activity' && (
                        <div className="p-6">
                            <div className="text-center py-20 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                                <i className="fas fa-tools text-4xl mb-4 text-gray-300"></i>
                                <p className="font-bold">활동지 모아보기 기능은 준비 중입니다.</p>
                                <p className="text-sm mt-1">수업 시간에 작성한 빈칸 채우기 내용을 이곳에서 한눈에 볼 수 있습니다.</p>
                            </div>
                        </div>
                    )}
                </section>
            </main>

            {iconPickerOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setIconPickerOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-800">프로필 아이콘 선택</h3>
                            <button onClick={() => setIconPickerOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">학생용 아이콘만 제공합니다. 마음에 드는 아이콘을 선택하세요.</p>
                        <div className="grid grid-cols-5 gap-2">
                            {SAFE_STUDENT_ICONS.map((icon) => (
                                <button
                                    key={icon}
                                    type="button"
                                    disabled={savingIcon}
                                    onClick={() => void handleProfileIconChange(icon)}
                                    className={`h-11 rounded-lg border text-2xl transition ${profileIcon === icon ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                                    title={`아이콘 ${icon}`}
                                >
                                    {icon}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MyPage;
