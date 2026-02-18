import React, { useEffect, useMemo, useState } from 'react';
import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Filler,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    Title,
    Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

type MainMenu = 'profile' | 'score' | 'wrong_note';
type CategoryTab = 'all' | 'diagnostic' | 'formative' | 'exam_prep';

interface UserProfileDoc {
    name?: string;
    grade?: string;
    class?: string;
    number?: string;
    profileIcon?: string;
    myPageGoalScore?: string;
}

interface GradingPlanItem {
    name?: string;
    maxScore: number;
    ratio: number;
}

interface GradingPlanDoc {
    id: string;
    subject?: string;
    items?: GradingPlanItem[];
}

interface ScoreBreakdownItem {
    name: string;
    score: number;
    maxScore: number;
    ratio: number;
    weighted: number;
}

interface ScoreRow {
    subject: string;
    total: number;
    breakdown: ScoreBreakdownItem[];
}

interface QuizResultDetail {
    id: string | number;
    correct: boolean;
    u?: string;
}

interface QuizResultDoc {
    id: string;
    unitId?: string;
    category?: string;
    score?: number;
    timestamp?: { seconds?: number };
    timeString?: string;
    details?: QuizResultDetail[];
}

interface WrongNoteItem {
    key: string;
    question: string;
    answer: string;
    explanation: string;
    userAnswer: string;
    unitId: string;
    unitTitle: string;
    category: CategoryTab | 'other';
    categoryLabel: string;
    dateText: string;
}

interface TrendPoint {
    label: string;
    unitId: string;
    category: CategoryTab | 'other';
    score: number;
}

const DEFAULT_EMOJIS = ['😀', '😎', '🤓', '🙂', '🧠', '📝', '📚', '🏆', '🚀', '🌟', '🍀', '🎯', '🐯', '🐳', '🐼'];
const SUBJECT_PRIORITY = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '체육', '미술', '음악', '정보'];
const CATEGORY_LABELS: Array<{ key: CategoryTab; label: string }> = [
    { key: 'diagnostic', label: '진단평가' },
    { key: 'formative', label: '형성평가' },
    { key: 'exam_prep', label: '학기 시험 대비' },
];

const getCategoryLabel = (category?: string) => {
    if (category === 'diagnostic') return '진단평가';
    if (category === 'formative') return '형성평가';
    if (category === 'exam_prep') return '학기 시험 대비';
    return '기타';
};

const getCategoryShort = (category?: string) => {
    if (category === 'diagnostic') return '진단';
    if (category === 'formative') return '형성';
    if (category === 'exam_prep') return '시험대비';
    return '기타';
};

const normalizeEmojiList = (raw: unknown) => {
    if (!Array.isArray(raw)) return DEFAULT_EMOJIS;
    const list = Array.from(new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean)));
    return list.length > 0 ? list : DEFAULT_EMOJIS;
};

const chunk = <T,>(arr: T[], size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const formatResultDate = (result: QuizResultDoc) => {
    if (result.timestamp?.seconds) {
        return new Date(result.timestamp.seconds * 1000).toLocaleString('ko-KR');
    }
    return result.timeString || '-';
};

const MyPage: React.FC = () => {
    const { user, userData, config } = useAuth();

    const [menu, setMenu] = useState<MainMenu>('profile');
    const [categoryTab, setCategoryTab] = useState<CategoryTab | 'all'>('all');
    const [selectedUnitId, setSelectedUnitId] = useState<string>('all');

    const [profile, setProfile] = useState<UserProfileDoc | null>(null);
    const [profileIcon, setProfileIcon] = useState('😀');
    const [iconModalOpen, setIconModalOpen] = useState(false);
    const [emojiOptions, setEmojiOptions] = useState<string[]>(DEFAULT_EMOJIS);
    const [savingIcon, setSavingIcon] = useState(false);

    const [goalScore, setGoalScore] = useState('');
    const [savingGoal, setSavingGoal] = useState(false);

    const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
    const [scoreChartData, setScoreChartData] = useState<any>(null);

    const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
    const [quizLineData, setQuizLineData] = useState<any>(null);
    const [wrongItems, setWrongItems] = useState<WrongNoteItem[]>([]);
    const [expandedWrongKey, setExpandedWrongKey] = useState<string | null>(null);
    const [loadingWrong, setLoadingWrong] = useState(false);

    const [unitTitleMap, setUnitTitleMap] = useState<Record<string, string>>({ exam_prep: '학기 시험 대비' });

    useEffect(() => {
        if (!user || !config) return;
        void loadMyPage();
    }, [user, config]);

    const loadMyPage = async () => {
        const titles = await loadUnitTitles();
        await Promise.all([loadProfileAndEmoji(), loadScoreData(), loadQuizData(titles)]);
    };

    const loadProfileAndEmoji = async () => {
        if (!user) return;

        const [userSnap, interfaceSnap] = await Promise.all([
            getDoc(doc(db, 'users', user.uid)),
            getDoc(doc(db, 'site_settings', 'interface_config')),
        ]);

        if (userSnap.exists()) {
            const data = userSnap.data() as UserProfileDoc;
            setProfile(data);
            setProfileIcon(data.profileIcon || '😀');
            setGoalScore(data.myPageGoalScore || '');
        } else {
            setProfile(null);
            setProfileIcon('😀');
            setGoalScore('');
        }

        if (interfaceSnap.exists()) {
            setEmojiOptions(normalizeEmojiList(interfaceSnap.data().studentProfileEmojis));
        } else {
            setEmojiOptions(DEFAULT_EMOJIS);
        }
    };

    const loadUnitTitles = async () => {
        if (!config) return { exam_prep: '학기 시험 대비' };

        let treeSnap = await getDoc(doc(db, getSemesterCollectionPath(config, 'curriculum'), 'tree'));
        if (!treeSnap.exists()) {
            treeSnap = await getDoc(doc(db, 'curriculum', 'tree'));
        }

        const map: Record<string, string> = { exam_prep: '학기 시험 대비' };
        if (treeSnap.exists()) {
            const tree = treeSnap.data().tree || [];
            tree.forEach((big: any) => {
                (big.children || []).forEach((mid: any) => {
                    if (mid?.id && mid?.title) {
                        map[mid.id] = mid.title;
                    }
                });
            });
        }

        setUnitTitleMap(map);
        return map;
    };

    const loadScoreData = async () => {
        if (!user || !config) return;

        const year = config.year || '2026';
        const semester = config.semester || '1';
        const scoreDocId = `${year}_${semester}`;

        const scoreSnap = await getDoc(doc(db, 'users', user.uid, 'academic_records', scoreDocId));
        const scoreMap = scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {};

        let plansSnap = await getDocs(collection(db, getSemesterCollectionPath(config, 'grading_plans')));
        if (plansSnap.empty) {
            plansSnap = await getDocs(collection(db, 'grading_plans'));
        }

        const rows: ScoreRow[] = [];
        plansSnap.forEach((planDoc) => {
            const plan = { id: planDoc.id, ...(planDoc.data() as Omit<GradingPlanDoc, 'id'>) };
            const items = Array.isArray(plan.items) ? plan.items : [];
            const breakdown: ScoreBreakdownItem[] = items.map((item, idx) => {
                const rawValue = Number(scoreMap[`${plan.id}_${idx}`] || 0);
                const score = Number.isFinite(rawValue) ? rawValue : 0;
                const maxScore = Number(item.maxScore || 0);
                const ratio = Number(item.ratio || 0);
                const weighted = maxScore > 0 ? (score / maxScore) * ratio : 0;

                return {
                    name: item.name || `${idx + 1}번 항목`,
                    score,
                    maxScore,
                    ratio,
                    weighted: Number(weighted.toFixed(1)),
                };
            });

            const total = Number(breakdown.reduce((acc, cur) => acc + cur.weighted, 0).toFixed(1));
            rows.push({
                subject: plan.subject || '과목',
                total,
                breakdown,
            });
        });

        rows.sort((a, b) => {
            const getPriority = (subject: string) => {
                const idx = SUBJECT_PRIORITY.findIndex((name) => subject.includes(name));
                return idx === -1 ? 999 : idx;
            };
            return getPriority(a.subject) - getPriority(b.subject) || a.subject.localeCompare(b.subject);
        });

        setScoreRows(rows);
        setScoreChartData(
            rows.length
                ? {
                      labels: rows.map((row) => row.subject),
                      datasets: [
                          {
                              label: '환산 점수',
                              data: rows.map((row) => row.total),
                              backgroundColor: 'rgba(37, 99, 235, 0.65)',
                              borderColor: 'rgba(29, 78, 216, 1)',
                              borderWidth: 1,
                              borderRadius: 6,
                          },
                      ],
                  }
                : null,
        );
    };

    const loadQuizData = async (titleMap: Record<string, string>) => {
        if (!user || !config) return;
        setLoadingWrong(true);

        let resultSnap = await getDocs(
            query(collection(db, getSemesterCollectionPath(config, 'quiz_results')), where('uid', '==', user.uid)),
        );
        if (resultSnap.empty) {
            resultSnap = await getDocs(query(collection(db, 'quiz_results'), where('uid', '==', user.uid)));
        }

        const results: QuizResultDoc[] = [];
        resultSnap.forEach((item) => {
            results.push({ id: item.id, ...(item.data() as Omit<QuizResultDoc, 'id'>) });
        });
        results.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        const latest = results.slice(0, 12).reverse();
        const points: TrendPoint[] = latest.map((result, idx) => {
            const unitId = result.unitId || 'unknown';
            const category = (result.category || 'other') as CategoryTab | 'other';
            const unitTitle = titleMap[unitId] || unitId;
            return {
                label: `${idx + 1}회 · ${unitTitle} · ${getCategoryShort(category)}`,
                unitId,
                category,
                score: Number(result.score || 0),
            };
        });
        setTrendPoints(points);

        setQuizLineData(
            points.length
                ? {
                      labels: points.map((point) => point.label),
                      datasets: [
                          {
                              label: '점수',
                              data: points.map((point) => point.score),
                              borderColor: '#059669',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              fill: true,
                              tension: 0.3,
                              pointRadius: 4,
                          },
                      ],
                  }
                : null,
        );

        const wrongLogs: Array<{
            qid: string;
            userAnswer: string;
            unitId: string;
            category: CategoryTab | 'other';
            dateText: string;
        }> = [];

        results.forEach((result) => {
            (result.details || []).forEach((detail) => {
                if (detail.correct) return;
                wrongLogs.push({
                    qid: String(detail.id),
                    userAnswer: detail.u || '',
                    unitId: result.unitId || 'unknown',
                    category: (result.category || 'other') as CategoryTab | 'other',
                    dateText: formatResultDate(result),
                });
            });
        });

        if (!wrongLogs.length) {
            setWrongItems([]);
            setLoadingWrong(false);
            return;
        }

        const questionMap: Record<string, any> = {};
        const questionIds = Array.from(new Set(wrongLogs.map((log) => log.qid)));

        await Promise.all(
            chunk(questionIds, 10).map(async (ids) => {
                const scopedSnap = await getDocs(
                    query(collection(db, getSemesterCollectionPath(config, 'quiz_questions')), where(documentId(), 'in', ids)),
                );
                scopedSnap.forEach((questionDoc) => {
                    questionMap[questionDoc.id] = questionDoc.data();
                });
            }),
        );

        const missingIds = questionIds.filter((qid) => !questionMap[qid]);
        if (missingIds.length) {
            await Promise.all(
                chunk(missingIds, 10).map(async (ids) => {
                    const legacySnap = await getDocs(
                        query(collection(db, 'quiz_questions'), where(documentId(), 'in', ids)),
                    );
                    legacySnap.forEach((questionDoc) => {
                        questionMap[questionDoc.id] = questionDoc.data();
                    });
                }),
            );
        }

        const seen = new Set<string>();
        const nextWrongItems: WrongNoteItem[] = [];

        wrongLogs.forEach((log) => {
            const question = questionMap[log.qid];
            if (!question) return;

            const key = `${log.qid}_${log.unitId}_${log.category}`;
            if (seen.has(key)) return;
            seen.add(key);

            nextWrongItems.push({
                key,
                question: question.question || '문항 텍스트 없음',
                answer: question.answer || '-',
                explanation: question.explanation || '해설이 등록되지 않았습니다.',
                userAnswer: log.userAnswer,
                unitId: log.unitId,
                unitTitle: titleMap[log.unitId] || log.unitId,
                category: log.category,
                categoryLabel: getCategoryLabel(log.category),
                dateText: log.dateText,
            });
        });

        setWrongItems(nextWrongItems);
        setLoadingWrong(false);
    };

    const saveGoal = async () => {
        if (!user) return;
        setSavingGoal(true);
        try {
            await setDoc(
                doc(db, 'users', user.uid),
                {
                    myPageGoalScore: goalScore.trim(),
                    updatedAt: serverTimestamp(),
                },
                { merge: true },
            );
        } finally {
            setSavingGoal(false);
        }
    };

    const saveProfileIcon = async (nextIcon: string) => {
        if (!user) return;
        setSavingIcon(true);
        try {
            await setDoc(
                doc(db, 'users', user.uid),
                {
                    profileIcon: nextIcon,
                    updatedAt: serverTimestamp(),
                },
                { merge: true },
            );
            setProfileIcon(nextIcon);
            setIconModalOpen(false);
        } finally {
            setSavingIcon(false);
        }
    };

    const filteredWrongItems = useMemo(
        () =>
            wrongItems.filter(
                (item) =>
                    (categoryTab === 'all' || item.category === categoryTab) &&
                    (selectedUnitId === 'all' || item.unitId === selectedUnitId),
            ),
        [wrongItems, categoryTab, selectedUnitId],
    );

    const wrongGroupEntries = useMemo(() => {
        const grouped: Record<string, WrongNoteItem[]> = {};
        filteredWrongItems.forEach((item) => {
            const key = `${item.unitId}_${item.category}`;
            grouped[key] = grouped[key] || [];
            grouped[key].push(item);
        });
        return Object.entries(grouped);
    }, [filteredWrongItems]);

    const scoreSummaryByUnit = useMemo(() => {
        const grouped: Record<string, { unitId: string; unitTitle: string; category: string; scores: number[] }> = {};
        trendPoints.forEach((point) => {
            const key = `${point.unitId}_${point.category}`;
            if (!grouped[key]) {
                grouped[key] = {
                    unitId: point.unitId,
                    unitTitle: unitTitleMap[point.unitId] || point.unitId,
                    category: point.category,
                    scores: [],
                };
            }
            grouped[key].scores.push(point.score);
        });

        return Object.values(grouped).map((group) => ({
            ...group,
            average: Number((group.scores.reduce((acc, cur) => acc + cur, 0) / Math.max(group.scores.length, 1)).toFixed(1)),
            count: group.scores.length,
        }));
    }, [trendPoints, unitTitleMap]);

    const availableUnitTabs = useMemo(() => {
        const source = new Set<string>();
        wrongItems.forEach((item) => source.add(item.unitId));
        trendPoints.forEach((point) => source.add(point.unitId));
        return Array.from(source).map((unitId) => ({
            id: unitId,
            title: unitTitleMap[unitId] || unitId,
        }));
    }, [wrongItems, trendPoints, unitTitleMap]);

    const leftMenus: Array<{ key: MainMenu; title: string; icon: string }> = [
        { key: 'profile', title: '나의 기본 정보', icon: 'fa-id-card' },
        { key: 'score', title: '나의 성적표', icon: 'fa-chart-column' },
        { key: 'wrong_note', title: '오답 노트', icon: 'fa-book-open' },
    ];

    return (
        <div className="bg-gray-50 min-h-screen">
            <main className="w-full max-w-7xl mx-auto px-4 py-6">
                <div className="flex flex-col lg:flex-row gap-6">
                    <aside className="lg:w-80">
                        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 space-y-3">
                            {leftMenus.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => setMenu(item.key)}
                                    className={`w-full rounded-xl border-2 px-4 h-20 transition text-left flex items-center ${
                                        menu === item.key
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-gray-50'
                                    }`}
                                >
                                    <i className={`fas ${item.icon} text-lg mr-3`}></i>
                                    <span className="font-bold text-base">{item.title}</span>
                                </button>
                            ))}
                        </div>
                    </aside>

                    <section className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
                        {menu === 'profile' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-gray-800">나의 기본 정보</h2>
                                <div className="flex items-center gap-5">
                                    <div className="w-24 h-24 rounded-full bg-blue-100 text-4xl flex items-center justify-center relative">
                                        {profileIcon}
                                        <button
                                            type="button"
                                            onClick={() => setIconModalOpen(true)}
                                            className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border border-gray-300 rounded-full text-xs"
                                        >
                                            변경
                                        </button>
                                    </div>
                                    <div>
                                        <div className="text-xl font-bold text-gray-800">{profile?.name || userData?.name || '학생'}</div>
                                        <div className="text-gray-500">
                                            {profile
                                                ? `${profile.grade || '--'}학년 ${profile.class || '--'}반 ${profile.number || '--'}번`
                                                : '--학년 --반 --번'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {menu === 'score' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-gray-800">나의 성적표</h2>
                                <div className="h-72">
                                    {scoreChartData ? (
                                        <Bar
                                            data={scoreChartData}
                                            options={{
                                                responsive: true,
                                                maintainAspectRatio: false,
                                                scales: { y: { beginAtZero: true, max: 100 } },
                                                plugins: { legend: { display: false } },
                                            }}
                                        />
                                    ) : (
                                        <div className="text-gray-400 py-8 text-center">아직 성적 데이터가 없습니다.</div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {scoreRows.map((row) => (
                                        <div key={row.subject} className="relative group border border-gray-200 rounded-xl p-4 bg-gray-50">
                                            <div className="font-bold text-gray-800">{row.subject}</div>
                                            <div className="text-2xl font-extrabold text-blue-700 mt-1">{row.total}점</div>
                                            <div className="text-xs text-gray-500 mt-1">마우스를 올리면 구성 점수를 볼 수 있어요.</div>

                                            <div className="hidden group-hover:block absolute z-10 left-0 top-full mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-xs text-gray-700">
                                                {row.breakdown.map((item, idx) => (
                                                    <div key={`${row.subject}-${idx}`} className="flex justify-between py-1 border-b last:border-0">
                                                        <span>{item.name}</span>
                                                        <span>
                                                            {item.score}/{item.maxScore} (비중 {item.ratio}%, 환산 {item.weighted})
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t pt-4">
                                    <label className="block text-sm font-bold text-gray-700 mb-2">하단 목표 성적</label>
                                    <div className="flex gap-2">
                                        <input
                                            value={goalScore}
                                            onChange={(event) => setGoalScore(event.target.value)}
                                            placeholder="예: 이번 학기 평균 85점 이상"
                                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void saveGoal()}
                                            disabled={savingGoal}
                                            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:bg-blue-300"
                                        >
                                            {savingGoal ? '저장 중...' : '목표 저장'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {menu === 'wrong_note' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-gray-800">오답 노트</h2>
                                <div>
                                    <h3 className="font-bold text-gray-800 mb-2">퀴즈 성장 그래프</h3>
                                    <div className="h-64">
                                        {quizLineData ? (
                                            <Line
                                                data={quizLineData}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    scales: { y: { beginAtZero: true, max: 100 } },
                                                    plugins: { legend: { display: false } },
                                                }}
                                            />
                                        ) : (
                                            <div className="text-gray-400 py-8 text-center">응시 기록이 아직 없습니다.</div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="border-b border-gray-100 p-3">
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setCategoryTab('all')}
                                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                                                    categoryTab === 'all' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                            >
                                                전체
                                            </button>
                                            {CATEGORY_LABELS.map((tab) => (
                                                <button
                                                    key={tab.key}
                                                    type="button"
                                                    onClick={() => setCategoryTab(tab.key)}
                                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                                                        categoryTab === tab.key ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {tab.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="p-3 border-b border-gray-100">
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedUnitId('all')}
                                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                                                    selectedUnitId === 'all' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                            >
                                                전체 목차
                                            </button>
                                            {availableUnitTabs.map((tab) => (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => setSelectedUnitId(tab.id)}
                                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                                                        selectedUnitId === tab.id ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {tab.title}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-bold text-gray-800 mb-2">목차별 진단/형성/시험대비 점수</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {scoreSummaryByUnit
                                            .filter(
                                                (item) =>
                                                    (categoryTab === 'all' || item.category === categoryTab) &&
                                                    (selectedUnitId === 'all' || item.unitId === selectedUnitId),
                                            )
                                            .map((item) => (
                                                <div key={`${item.unitId}_${item.category}`} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                                    <div className="font-bold text-gray-800">{item.unitTitle}</div>
                                                    <div className="text-xs text-gray-500">{getCategoryLabel(item.category)}</div>
                                                    <div className="text-sm text-blue-700 font-bold mt-1">평균 {item.average}점 · 응시 {item.count}회</div>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-bold text-gray-800 mb-2">오답 노트 분류</h3>
                                    {loadingWrong ? (
                                        <div className="text-gray-400 py-6">오답 데이터를 불러오는 중입니다...</div>
                                    ) : wrongGroupEntries.length === 0 ? (
                                        <div className="text-gray-400 py-6">조건에 맞는 오답이 없습니다.</div>
                                    ) : (
                                        <div className="space-y-3">
                                            {wrongGroupEntries.map(([groupKey, items]) => (
                                                <div key={groupKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                                    <div className="px-4 py-3 bg-gray-50 font-bold text-sm text-gray-700">
                                                        {items[0].unitTitle} · {items[0].categoryLabel}
                                                    </div>
                                                    <div className="divide-y">
                                                        {items.map((item) => (
                                                            <div key={item.key}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setExpandedWrongKey((prev) => (prev === item.key ? null : item.key))}
                                                                    className="w-full p-3 text-left hover:bg-gray-50 flex justify-between items-center"
                                                                >
                                                                    <span className="font-bold text-gray-800">{item.question}</span>
                                                                    <i className={`fas fa-chevron-down text-gray-400 transition ${expandedWrongKey === item.key ? 'rotate-180' : ''}`}></i>
                                                                </button>
                                                                {expandedWrongKey === item.key && (
                                                                    <div className="px-4 pb-4 text-sm text-gray-700 bg-red-50">
                                                                        <div className="mb-1 text-xs text-gray-500">최근 오답 일시: {item.dateText}</div>
                                                                        <div>나의 오답: <span className="font-bold text-red-500">{item.userAnswer || '(미입력)'}</span></div>
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
                        )}
                    </section>
                </div>
            </main>

            {iconModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setIconModalOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-md" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-gray-800">프로필 아이콘 선택</h3>
                            <button type="button" onClick={() => setIconModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                            {emojiOptions.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    disabled={savingIcon}
                                    onClick={() => void saveProfileIcon(emoji)}
                                    className={`h-11 rounded border text-2xl ${profileIcon === emoji ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                                >
                                    {emoji}
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
