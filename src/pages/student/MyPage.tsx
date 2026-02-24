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
    myPageSubjectGoals?: Record<string, number>;
}

interface GradingPlanItem {
    type?: string;
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
    entered: boolean;
    type: 'exam' | 'performance' | 'other';
}

interface ScoreRow {
    subject: string;
    total: number;
    breakdown: ScoreBreakdownItem[];
}

interface SubjectScoreInsight {
    subject: string;
    current: number;
    target: number;
    gap: number;
    remainingPotential: number;
    requiredRate: number;
    examCurrent: number;
    performanceCurrent: number;
    otherCurrent: number;
    examNeed: number;
    performanceNeed: number;
    missingExamCount: number;
    missingPerformanceCount: number;
    mood: 'good' | 'care';
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

const normalizeClassValue = (value: unknown): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';
    const digits = normalized.match(/\d+/)?.[0] || '';
    if (!digits) return normalized;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(parsed);
};

const withSuffix = (label: string, suffix: string) => {
    if (!label) return '';
    return label.endsWith(suffix) ? label : `${label}${suffix}`;
};

const classifyBreakdownType = (name: string): 'exam' | 'performance' | 'other' => {
    const key = String(name || '').toLowerCase();
    if (/정기|지필|중간|기말|시험|omr|서술|exam|midterm|final/.test(key)) return 'exam';
    if (/수행|과제|발표|실험|프로젝트|실습|performance|project|assignment/.test(key)) return 'performance';
    return 'other';
};

const normalizePlanItemType = (rawType: unknown, fallbackName: string): 'exam' | 'performance' | 'other' => {
    const typeKey = String(rawType ?? '').toLowerCase();
    if (/정기|regular|exam|midterm|final|omr/.test(typeKey)) return 'exam';
    if (/수행|performance|project|assignment/.test(typeKey)) return 'performance';
    return classifyBreakdownType(fallbackName);
};

const getTypeLabel = (type: 'exam' | 'performance' | 'other') => {
    if (type === 'exam') return '정기시험';
    if (type === 'performance') return '수행평가';
    return '기타';
};

const getTypeFixedColor = (type: 'exam' | 'performance' | 'other') => {
    if (type === 'exam') return '#b91c1c';
    if (type === 'performance') return '#fca5a5';
    return '#94a3b8';
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
    const [subjectGoals, setSubjectGoals] = useState<Record<string, number>>({});
    const [selectedSubject, setSelectedSubject] = useState('');
    const [savingGoal, setSavingGoal] = useState(false);

    const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
    const [scoreChartData, setScoreChartData] = useState<any>(null);

    const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
    const [quizLineData, setQuizLineData] = useState<any>(null);
    const [wrongItems, setWrongItems] = useState<WrongNoteItem[]>([]);
    const [expandedWrongKey, setExpandedWrongKey] = useState<string | null>(null);
    const [loadingWrong, setLoadingWrong] = useState(false);
    const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>({});
    const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>({});

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

        const [userSnap, interfaceSnap, schoolSnap] = await Promise.all([
            getDoc(doc(db, 'users', user.uid)),
            getDoc(doc(db, 'site_settings', 'interface_config')),
            getDoc(doc(db, 'site_settings', 'school_config')),
        ]);

        if (userSnap.exists()) {
            const data = userSnap.data() as UserProfileDoc;
            setProfile(data);
            setProfileIcon(data.profileIcon || '😀');
            setGoalScore(data.myPageGoalScore || '');
            setSubjectGoals(data.myPageSubjectGoals || {});
        } else {
            setProfile(null);
            setProfileIcon('😀');
            setGoalScore('');
            setSubjectGoals({});
        }

        if (interfaceSnap.exists()) {
            setEmojiOptions(normalizeEmojiList(interfaceSnap.data().studentProfileEmojis));
        } else {
            setEmojiOptions(DEFAULT_EMOJIS);
        }

        if (schoolSnap.exists()) {
            const data = schoolSnap.data() as {
                grades?: Array<{ value?: string; label?: string }>;
                classes?: Array<{ value?: string; label?: string }>;
            };
            const nextGradeMap: Record<string, string> = {};
            const nextClassMap: Record<string, string> = {};
            (data.grades || []).forEach((item) => {
                const value = String(item?.value ?? '').trim();
                const label = String(item?.label ?? '').trim();
                if (value && label) nextGradeMap[value] = label;
            });
            (data.classes || []).forEach((item) => {
                const value = String(item?.value ?? '').trim();
                const label = String(item?.label ?? '').trim();
                if (value && label) nextClassMap[value] = label;
            });
            setGradeLabelMap(nextGradeMap);
            setClassLabelMap(nextClassMap);
        } else {
            setGradeLabelMap({});
            setClassLabelMap({});
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
                const scoreKey = `${plan.id}_${idx}`;
                const entered = Object.prototype.hasOwnProperty.call(scoreMap, scoreKey);
                const rawValue = Number(entered ? scoreMap[scoreKey] : 0);
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
                    entered,
                    type: normalizePlanItemType(item.type, String(item.name || '')),
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
                    myPageSubjectGoals: subjectGoals,
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

    const subjectInsights = useMemo<SubjectScoreInsight[]>(() => {
        return scoreRows.map((row) => {
            const target = Number(subjectGoals[row.subject] ?? 85);
            const current = Number(row.total || 0);
            const gap = Math.max(0, target - current);

            let examCurrent = 0;
            let performanceCurrent = 0;
            let otherCurrent = 0;
            let examRemain = 0;
            let performanceRemain = 0;
            let otherRemain = 0;
            let missingExamCount = 0;
            let missingPerformanceCount = 0;

            row.breakdown.forEach((item) => {
                const type = item.type;
                const left = Math.max(0, Number(item.ratio || 0) - Number(item.weighted || 0));
                if (type === 'exam') {
                    examCurrent += item.weighted;
                    examRemain += left;
                    if (!item.entered) missingExamCount += 1;
                } else if (type === 'performance') {
                    performanceCurrent += item.weighted;
                    performanceRemain += left;
                    if (!item.entered) missingPerformanceCount += 1;
                } else {
                    otherCurrent += item.weighted;
                    otherRemain += left;
                }
            });

            const remainingPotential = Number((examRemain + performanceRemain + otherRemain).toFixed(1));
            const requiredRate = remainingPotential > 0 ? Math.min(100, Number(((gap / remainingPotential) * 100).toFixed(1))) : 100;
            const examNeed = gap > 0 && remainingPotential > 0 ? Number(((gap * examRemain) / remainingPotential).toFixed(1)) : 0;
            const performanceNeed = gap > 0 && remainingPotential > 0 ? Number(((gap * performanceRemain) / remainingPotential).toFixed(1)) : 0;
            const mood: 'good' | 'care' = gap <= 0 || requiredRate <= 70 ? 'good' : 'care';

            return {
                subject: row.subject,
                current: Number(current.toFixed(1)),
                target: Number(target.toFixed(1)),
                gap: Number(gap.toFixed(1)),
                remainingPotential,
                requiredRate,
                examCurrent: Number(examCurrent.toFixed(1)),
                performanceCurrent: Number(performanceCurrent.toFixed(1)),
                otherCurrent: Number(otherCurrent.toFixed(1)),
                examNeed,
                performanceNeed,
                missingExamCount,
                missingPerformanceCount,
                mood,
            };
        });
    }, [scoreRows, subjectGoals]);

    useEffect(() => {
        if (!subjectInsights.length) {
            setSelectedSubject('');
            return;
        }
        if (!selectedSubject || !subjectInsights.some((item) => item.subject === selectedSubject)) {
            setSelectedSubject(subjectInsights[0].subject);
        }
    }, [subjectInsights, selectedSubject]);

    const selectedInsight = useMemo(
        () => subjectInsights.find((item) => item.subject === selectedSubject) || null,
        [subjectInsights, selectedSubject],
    );

    const teacherAdviceText = useMemo(() => {
        if (!selectedInsight) return '';
        if (selectedInsight.gap <= 0) {
            return '선생님의 조언: 목표를 이미 달성했습니다. 남은 평가에서도 현재 페이스를 유지하세요.';
        }

        const parts: string[] = [];
        if (selectedInsight.missingExamCount > 0) {
            const examPerItem = Math.ceil((selectedInsight.examNeed / selectedInsight.missingExamCount) * 10) / 10;
            parts.push(`남은 정기시험 ${selectedInsight.missingExamCount}개에서 평균 ${examPerItem}점 이상 획득하도록 하세요.`);
        }
        if (selectedInsight.missingPerformanceCount > 0) {
            const perfPerItem = Math.ceil((selectedInsight.performanceNeed / selectedInsight.missingPerformanceCount) * 10) / 10;
            parts.push(`남은 수행평가 ${selectedInsight.missingPerformanceCount}개에서 평균 ${perfPerItem}점 이상 획득하도록 하세요.`);
        }

        if (!parts.length) {
            return '선생님의 조언: 남은 입력 가능한 평가가 없어 목표 달성에 필요한 점수를 반영하기 어렵습니다. 목표 점수를 조정하거나 교사와 상담하세요.';
        }

        return `선생님의 조언: ${parts.join(' ')}`;
    }, [selectedInsight]);

    const totalStackChartData = useMemo(() => {
        const labels = scoreRows.map((row) => row.subject);
        const itemNames = Array.from(
            new Set(scoreRows.flatMap((row) => row.breakdown.map((item) => item.name))),
        );

        const datasets = itemNames.map((itemName) => {
            const rowsByItem = scoreRows.map((row) => row.breakdown.find((item) => item.name === itemName) || null);
            const firstFound = rowsByItem.find(Boolean);
            const itemType = firstFound?.type || 'other';
            return {
                label: itemName,
                data: rowsByItem.map((found) => Number((found?.weighted || 0).toFixed(1))),
                rawScores: rowsByItem.map((found) => Number((found?.score || 0).toFixed(1))),
                maxScores: rowsByItem.map((found) => Number((found?.maxScore || 0).toFixed(1))),
                itemTypes: rowsByItem.map((found) => found?.type || itemType),
                backgroundColor: getTypeFixedColor(itemType),
                borderColor: getTypeFixedColor(itemType),
                borderWidth: 1,
                borderRadius: 0,
                stack: 'total',
            } as any;
        });

        return { labels, datasets };
    }, [scoreRows]);

    const stackHoverGuidePlugin = useMemo(
        () => ({
            id: 'stackHoverGuide',
            afterDraw: (chart: any) => {
                const active = chart?.tooltip?.getActiveElements?.() || [];
                if (!active.length) return;
                const y = active[0]?.element?.y;
                if (typeof y !== 'number') return;

                const { ctx, chartArea } = chart;
                if (!ctx || !chartArea) return;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#64748b';
                ctx.setLineDash([5, 4]);
                ctx.stroke();
                ctx.restore();
            },
        }),
        [],
    );

    const gapBarData = useMemo(() => {
        if (!selectedInsight) return null;
        return {
            labels: ['현재 반영', '목표까지 필요', '남은 최대 반영'],
            datasets: [
                {
                    label: selectedInsight.subject,
                    data: [selectedInsight.current, selectedInsight.gap, selectedInsight.remainingPotential],
                    backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
                    borderRadius: 8,
                },
            ],
        };
    }, [selectedInsight]);

    const leftMenus: Array<{ key: MainMenu; title: string; icon: string }> = [
        { key: 'profile', title: '나의 기본 정보', icon: 'fa-id-card' },
        { key: 'score', title: '나의 성적표', icon: 'fa-chart-column' },
        { key: 'wrong_note', title: '오답 노트', icon: 'fa-book-open' },
    ];
    const profileGradeValue = normalizeClassValue(profile?.grade ?? userData?.grade);
    const profileClassValue = normalizeClassValue(profile?.class ?? userData?.class);
    const profileNumberValue = String(profile?.number ?? userData?.number ?? '--').trim() || '--';
    const profileGradeLabel = gradeLabelMap[profileGradeValue] || profileGradeValue || '--';
    const profileClassLabel = classLabelMap[profileClassValue] || profileClassValue || '--';

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                <aside className="w-full lg:w-64 shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden sticky top-8">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                                <i className="fas fa-user-circle text-gray-400"></i>
                                마이페이지
                            </h2>
                        </div>
                        <nav className="flex flex-col">
                            {leftMenus.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => setMenu(item.key)}
                                    className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${
                                        menu === item.key
                                            ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                                            : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'
                                    }`}
                                >
                                    <div className="w-6 text-center">
                                        <i className={`fas ${item.icon}`}></i>
                                    </div>
                                    {item.title}
                                </button>
                            ))}
                        </nav>
                    </div>
                </aside>

                <section className="flex-1">
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 lg:p-8">
                        {menu === 'profile' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-gray-800">나의 기본 정보</h2>
                                <div className="rounded-2xl bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-500 text-white p-6 md:p-7 shadow-lg">
                                    <div className="flex items-center gap-5">
                                    <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-sm text-4xl flex items-center justify-center relative border border-white/40">
                                        {profileIcon}
                                        <button
                                            type="button"
                                            onClick={() => setIconModalOpen(true)}
                                            className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border border-blue-100 rounded-full text-xs text-blue-700 font-bold"
                                        >
                                            변경
                                        </button>
                                    </div>
                                    <div>
                                            <div className="text-2xl font-extrabold tracking-tight">{profile?.name || userData?.name || '학생'}</div>
                                            <div className="mt-2 text-2xl md:text-3xl font-black tracking-tight">
                                                <span>{withSuffix(profileGradeLabel, '학년')}</span>
                                                <span className="mx-2 opacity-80">·</span>
                                                <span>{withSuffix(profileClassLabel, '반')}</span>
                                                <span className="mx-2 opacity-80">·</span>
                                                <span>{profileNumberValue}번</span>
                                            </div>
                                        <div className="mt-2 text-sm text-blue-100">학년, 반, 번호 정보가 표시됩니다.</div>
                                    </div>
                                </div>
                                </div>
                            </div>
                        )}

                        {menu === 'score' && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-gray-800">나의 성적표</h2>

                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="font-bold text-gray-800">종합 성적 그래프 (정기시험/수행평가 반영)</h3>
                                        <div className="flex flex-col items-end gap-1">
                                            <span className="text-xs text-gray-500">마우스를 올리면 영역별 점수가 표시됩니다.</span>
                                            <div className="flex items-center gap-2 text-[11px] font-bold text-gray-600">
                                                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-700"></span>정기시험</span>
                                                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-300"></span>수행평가</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-72">
                                        {subjectInsights.length > 0 ? (
                                            <Bar
                                                data={totalStackChartData}
                                                plugins={[stackHoverGuidePlugin]}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    interaction: { mode: 'index', intersect: false },
                                                    scales: {
                                                        y: { beginAtZero: true, max: 100, stacked: true },
                                                        x: { stacked: true },
                                                    },
                                                    plugins: {
                                                        legend: { display: false },
                                                        tooltip: {
                                                            enabled: true,
                                                            filter: (ctx: any) => Number(ctx?.parsed?.y || 0) > 0,
                                                            callbacks: {
                                                                label: (ctx: any) => {
                                                                    const dataIndex = ctx.dataIndex || 0;
                                                                    const ds = ctx.dataset || {};
                                                                    const itemType = getTypeLabel((ds.itemTypes?.[dataIndex] || 'other') as any);
                                                                    const raw = Number(ds.rawScores?.[dataIndex] || 0).toFixed(1);
                                                                    const max = Number(ds.maxScores?.[dataIndex] || 0).toFixed(1);
                                                                    return `[${itemType}] ${ctx.dataset.label}: ${raw} / ${max}점`;
                                                                },
                                                            },
                                                        },
                                                    },
                                                }}
                                            />
                                        ) : (
                                            <div className="text-gray-400 py-8 text-center">아직 성적 데이터가 없습니다.</div>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-[110px_1fr] gap-4 min-h-[560px]">
                                    <div className="border border-gray-200 rounded-2xl bg-gray-50 p-2 overflow-auto">
                                        <div className="flex lg:flex-col gap-2">
                                            {subjectInsights.map((item) => (
                                                <button
                                                    key={item.subject}
                                                    type="button"
                                                    onClick={() => setSelectedSubject(item.subject)}
                                                    className={`px-2 py-3 rounded-xl text-xs font-extrabold whitespace-nowrap transition ${
                                                        selectedSubject === item.subject
                                                            ? 'bg-blue-600 text-white shadow'
                                                            : 'bg-white text-gray-700 border border-gray-200 hover:bg-blue-50'
                                                    }`}
                                                >
                                                    {item.subject}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="border border-gray-200 rounded-2xl bg-white p-4">
                                        {selectedInsight ? (
                                            <div className="space-y-5">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                                                        <div className="text-xs font-bold text-blue-700">현재 점수</div>
                                                        <div className="text-3xl font-black text-blue-700">{selectedInsight.current}점</div>
                                                    </div>
                                                    <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                                                        <div className="text-xs font-bold text-violet-700">목표 점수</div>
                                                        <div className="text-3xl font-black text-violet-700">{selectedInsight.target}점</div>
                                                    </div>
                                                    <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                                                        <div className="text-xs font-bold text-amber-700">목표까지 차이</div>
                                                        <div className="text-3xl font-black text-amber-700">{selectedInsight.gap}점</div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <label className="text-sm font-bold text-gray-700">과목 목표 점수</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={100}
                                                        value={subjectGoals[selectedInsight.subject] ?? 85}
                                                        onChange={(event) =>
                                                            setSubjectGoals((prev) => ({
                                                                ...prev,
                                                                [selectedInsight.subject]: Number(event.target.value || 0),
                                                            }))
                                                        }
                                                        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => void saveGoal()}
                                                        disabled={savingGoal}
                                                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-blue-300"
                                                    >
                                                        {savingGoal ? '저장 중...' : '저장'}
                                                    </button>
                                                </div>

                                                <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                                                    <div
                                                        className={`hidden w-fit ml-auto mb-2 rounded-full px-4 py-1 text-xs font-black shadow ${
                                                            selectedInsight.mood === 'good'
                                                                ? 'bg-emerald-500 text-white'
                                                                : 'bg-orange-500 text-white'
                                                        }`}
                                                    >
                                                        {selectedInsight.mood === 'good' ? '목표 달성 유력' : '끝까지 힘내요'}
                                                    </div>
                                                    <div className="text-sm font-bold text-gray-700 mb-2">목표 점수 대비 현재 점수 차이 그래프</div>
                                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                                                        <div className="h-56">
                                                            {gapBarData && (
                                                                <Bar
                                                                    data={gapBarData}
                                                                    options={{
                                                                        indexAxis: 'y' as const,
                                                                        responsive: true,
                                                                        maintainAspectRatio: false,
                                                                        scales: { x: { beginAtZero: true, max: 100 } },
                                                                        plugins: { legend: { display: false }, tooltip: { enabled: true } },
                                                                    }}
                                                                />
                                                            )}
                                                        </div>
                                                        <div
                                                            className={`self-start rounded-xl px-4 py-2 text-sm font-extrabold shadow whitespace-nowrap ${
                                                                selectedInsight.mood === 'good'
                                                                    ? 'bg-emerald-500 text-white'
                                                                    : 'bg-orange-500 text-white'
                                                            }`}
                                                        >
                                                            {selectedInsight.mood === 'good' ? '목표 달성 유력' : '끝까지 힘내요'}
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 text-sm font-bold text-gray-700">
                                                        남은 평가에서 필요한 점수: 정기시험 {selectedInsight.examNeed}점 / 수행평가 {selectedInsight.performanceNeed}점
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        남은 최대 반영점수 {selectedInsight.remainingPotential}점, 필요 달성률 {selectedInsight.requiredRate}%
                                                    </div>
                                                    <div className="mt-2 text-sm font-bold text-gray-700">
                                                        {teacherAdviceText}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-gray-400 py-12 text-center">과목을 선택해 주세요.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {menu === 'score' && false && (
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
                    </div>
                </section>
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
