import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
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

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

type MenuKey = 'profile' | 'score' | 'wrong';

interface UserProfile {
  name?: string;
  grade?: number;
  class?: number;
  number?: number;
  profileIcon?: string;
}

interface QuizDetail {
  id: string | number;
  correct: boolean;
  u: string;
}

interface QuizResult {
  id: string;
  unitId?: string;
  category?: string;
  score: number;
  timestamp?: any;
  timeString?: string;
  details?: QuizDetail[];
}

interface WrongItem {
  key: string;
  question: string;
  answer: string;
  explanation: string;
  userAnswer: string;
  unitTitle: string;
  category: string;
  categoryLabel: string;
  dateText: string;
}

const SUBJECT_PRIORITY = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '체육', '미술', '음악', '정보'];
const SAFE_STUDENT_ICONS = ['😀', '😎', '🧠', '📚', '✏️', '🧪', '🏫', '🌟', '🚀', '🐯', '🐻', '🦊', '🐼', '🐬', '🦉'];

const categoryLabel = (category?: string) => {
  if (category === 'diagnostic') return '진단평가';
  if (category === 'formative') return '형성평가';
  if (category === 'exam_prep') return '학기 시험 대비';
  return '기타';
};

const categoryShort = (category?: string) => {
  if (category === 'diagnostic') return '진단';
  if (category === 'formative') return '형성';
  if (category === 'exam_prep') return '학기시험';
  return '기타';
};

const formatDate = (result: QuizResult) => {
  if (result.timestamp?.seconds) return new Date(result.timestamp.seconds * 1000).toLocaleString();
  return result.timeString || '-';
};

const chunk = (arr: string[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const MyPage: React.FC = () => {
  const { user, userData } = useAuth();
  const [config, setConfig] = useState<{ year: string; semester: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [icon, setIcon] = useState('😀');
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);
  const [menu, setMenu] = useState<MenuKey>('profile');

  const [unitTitleMap, setUnitTitleMap] = useState<Record<string, string>>({ exam_prep: '학기 시험 대비' });
  const [scoreData, setScoreData] = useState<any>(null);
  const [quizLineData, setQuizLineData] = useState<any>(null);
  const [wrongItems, setWrongItems] = useState<WrongItem[]>([]);
  const [loadingWrong, setLoadingWrong] = useState(false);
  const [expandedWrongKey, setExpandedWrongKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const d = await getDoc(doc(db, 'site_settings', 'config'));
      if (d.exists()) setConfig(d.data() as { year: string; semester: string });
    })();
  }, []);

  useEffect(() => {
    if (!user || !config) return;
    void loadProfile();
    void loadUnitMap();
    void loadScoreChart();
    void loadQuizAndWrong();
  }, [user, config]);

  useEffect(() => {
    if (!user || !config) return;
    void loadQuizAndWrong();
  }, [unitTitleMap]);

  const loadProfile = async () => {
    if (!user) return;
    const d = await getDoc(doc(db, 'users', user.uid));
    if (!d.exists()) return;
    const p = d.data() as UserProfile;
    setProfile(p);
    setIcon(p.profileIcon || '😀');
  };

  const loadUnitMap = async () => {
    if (!config) return;
    let d = await getDoc(doc(db, 'years', config.year, 'semesters', config.semester, 'curriculum', 'tree'));
    if (!d.exists()) d = await getDoc(doc(db, 'curriculum', 'tree'));
    if (!d.exists()) return;

    const map: Record<string, string> = { exam_prep: '학기 시험 대비' };
    (d.data().tree || []).forEach((big: any) => (big.children || []).forEach((mid: any) => {
      if (mid?.id && mid?.title) map[mid.id] = mid.title;
    }));
    setUnitTitleMap(map);
  };

  const loadQuizResults = async (): Promise<QuizResult[]> => {
    if (!user || !config) return [];
    let s = await getDocs(query(collection(db, 'years', config.year, 'semesters', config.semester, 'quiz_results'), where('uid', '==', user.uid)));
    if (s.empty) s = await getDocs(query(collection(db, 'quiz_results'), where('uid', '==', user.uid)));
    const out: QuizResult[] = [];
    s.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
    out.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    return out;
  };

  const loadScoreChart = async () => {
    if (!user || !config) return;
    const scoreDoc = await getDoc(doc(db, 'users', user.uid, 'academic_records', `${config.year}_${config.semester}`));
    const userScores = scoreDoc.exists() ? scoreDoc.data().scores || {} : {};
    const plansSnap = await getDocs(collection(db, 'years', config.year, 'semesters', config.semester, 'grading_plans'));
    const subjects: Record<string, number> = {};

    plansSnap.forEach((d) => {
      const p = d.data();
      let total = 0;
      (p.items || []).forEach((it: any, idx: number) => {
        const v = parseFloat(userScores[`${d.id}_${idx}`]);
        if (!Number.isNaN(v)) total += (v / it.maxScore) * it.ratio;
      });
      if (p.subject) subjects[p.subject] = +total.toFixed(1);
    });

    const rows = Object.entries(subjects).sort((a, b) => {
      const p = (s: string) => {
        const idx = SUBJECT_PRIORITY.findIndex((k) => s.includes(k));
        return idx === -1 ? 999 : idx;
      };
      return p(a[0]) - p(b[0]);
    });

    setScoreData(rows.length ? {
      labels: rows.map((x) => x[0]),
      datasets: [{
        label: '환산 점수',
        data: rows.map((x) => x[1]),
        backgroundColor: 'rgba(59,130,246,.6)',
        borderColor: 'rgba(59,130,246,1)',
        borderWidth: 1,
        borderRadius: 4,
      }],
    } : null);
  };

  const loadQuizAndWrong = async () => {
    if (!user || !config) return;
    setLoadingWrong(true);

    const results = await loadQuizResults();
    const last10 = results.slice(0, 10).reverse();
    setQuizLineData(last10.length ? {
      labels: last10.map((r, i) => `${i + 1}. ${(unitTitleMap[r.unitId || ''] || r.unitId || '단원 미지정')} · ${categoryShort(r.category)}`),
      datasets: [{
        label: '점수',
        data: last10.map((r) => r.score || 0),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      }],
    } : null);

    const wrongLogs: Array<{ qid: string; userAnswer: string; unitTitle: string; category: string; dateText: string }> = [];
    results.forEach((r) => (r.details || []).forEach((d) => {
      if (!d.correct) {
        wrongLogs.push({
          qid: String(d.id),
          userAnswer: d.u || '',
          unitTitle: unitTitleMap[r.unitId || ''] || r.unitId || '단원 미지정',
          category: r.category || 'other',
          dateText: formatDate(r),
        });
      }
    }));

    if (!wrongLogs.length) {
      setWrongItems([]);
      setLoadingWrong(false);
      return;
    }

    const ids = Array.from(new Set(wrongLogs.map((x) => x.qid)));
    const questionMap: Record<string, any> = {};

    await Promise.all(chunk(ids, 10).map(async (chunkIds) => {
      const s = await getDocs(query(collection(db, 'years', config.year, 'semesters', config.semester, 'quiz_questions'), where(documentId(), 'in', chunkIds)));
      s.forEach((d) => { questionMap[d.id] = d.data(); });
    }));

    const missing = ids.filter((id) => !questionMap[id]);
    if (missing.length) {
      await Promise.all(chunk(missing, 10).map(async (chunkIds) => {
        const s = await getDocs(query(collection(db, 'quiz_questions'), where(documentId(), 'in', chunkIds)));
        s.forEach((d) => { questionMap[d.id] = d.data(); });
      }));
    }

    const dedupe = new Set<string>();
    const list: WrongItem[] = [];
    wrongLogs.forEach((log) => {
      const q = questionMap[log.qid];
      if (!q) return;
      const key = `${log.qid}_${log.unitTitle}_${log.category}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);
      list.push({
        key,
        question: q.question || '문항 텍스트 없음',
        answer: q.answer || '-',
        explanation: q.explanation || '해설 정보가 없습니다.',
        userAnswer: log.userAnswer,
        unitTitle: log.unitTitle,
        category: log.category,
        categoryLabel: categoryLabel(log.category),
        dateText: log.dateText,
      });
    });

    setWrongItems(list);
    setLoadingWrong(false);
  };

  const wrongGrouped = useMemo(() => {
    const map: Record<string, WrongItem[]> = {};
    wrongItems.forEach((w) => {
      const key = `${w.category}_${w.unitTitle}`;
      map[key] = map[key] || [];
      map[key].push(w);
    });
    return map;
  }, [wrongItems]);

  const saveIcon = async (nextIcon: string) => {
    if (!user) return;
    setSavingIcon(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { profileIcon: nextIcon, updatedAt: serverTimestamp() }, { merge: true });
      setIcon(nextIcon);
      setIconModalOpen(false);
    } catch {
      alert('아이콘 저장에 실패했습니다.');
    } finally {
      setSavingIcon(false);
    }
  };

  const menus: Array<{ key: MenuKey; label: string; icon: string }> = [
    { key: 'profile', label: '나의 기본 정보', icon: 'fa-id-card' },
    { key: 'score', label: '나의 성적표', icon: 'fa-chart-column' },
    { key: 'wrong', label: '오답 노트', icon: 'fa-circle-exclamation' },
  ];

  return (
    <div className="bg-gray-50 min-h-screen">
      <main className="w-full max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <aside className="lg:w-72 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 font-bold text-gray-700">마이페이지 메뉴</div>
            <div className="p-2 space-y-1">
              {menus.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMenu(m.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg font-bold text-sm transition ${menu === m.key ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <i className={`fas ${m.icon} mr-2`}></i>{m.label}
                </button>
              ))}
            </div>
          </aside>

          <section className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            {menu === 'profile' && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-gray-800">나의 기본 정보</h2>
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-full bg-blue-100 text-3xl flex items-center justify-center relative">
                    {icon}
                    <button type="button" onClick={() => setIconModalOpen(true)} className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border border-gray-200 rounded-full text-xs">✎</button>
                  </div>
                  <div>
                    <div className="font-bold text-lg text-gray-800">{profile?.name || userData?.name || '학생'}</div>
                    <div className="text-gray-500 text-sm">{profile ? `${profile.grade || '--'}학년 ${profile.class || '--'}반 ${profile.number || '--'}번` : '--학년 --반 --번'}</div>
                  </div>
                </div>
              </div>
            )}

            {menu === 'score' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-bold text-gray-800 mb-3">나의 성적표</h2>
                  <div className="h-72">{scoreData ? <Bar data={scoreData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }} /> : <div className="text-gray-400">성적 데이터가 없습니다.</div>}</div>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-3">퀴즈 성장 그래프 <span className="text-xs text-gray-400 ml-2">라벨: 단원 · 평가 유형</span></h3>
                  <div className="h-72">{quizLineData ? <Line data={quizLineData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 }, x: { ticks: { callback: (_v, i) => `${Number(i) + 1}회` } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => String(it[0]?.label || ''), label: (it) => `점수 ${it.formattedValue}점` } } } }} /> : <div className="text-gray-400">퀴즈 응시 기록이 없습니다.</div>}</div>
                </div>
              </div>
            )}

            {menu === 'wrong' && (
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-3">오답 노트 <span className="text-xs text-gray-400 ml-2">(진단·형성·정기시험 대비 모음)</span></h2>
                {loadingWrong ? (
                  <div className="text-gray-400 py-8">오답 데이터를 분석하고 있습니다...</div>
                ) : Object.keys(wrongGrouped).length === 0 ? (
                  <div className="text-gray-400 py-8">오답이 없습니다.</div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(wrongGrouped).map(([groupKey, items]) => (
                      <div key={groupKey} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 font-bold text-sm text-gray-700">{items[0].unitTitle} · {items[0].categoryLabel}</div>
                        <div className="divide-y">
                          {items.map((w) => (
                            <div key={w.key}>
                              <button type="button" onClick={() => setExpandedWrongKey((prev) => (prev === w.key ? null : w.key))} className="w-full p-3 text-left hover:bg-gray-50 flex justify-between items-center">
                                <span className="font-bold text-gray-800">{w.question}</span>
                                <i className={`fas fa-chevron-down text-gray-400 ${expandedWrongKey === w.key ? 'rotate-180' : ''}`}></i>
                              </button>
                              {expandedWrongKey === w.key && (
                                <div className="px-4 pb-4 text-sm text-gray-700 bg-red-50">
                                  <div className="mb-1 text-xs text-gray-500">최근 오답 일시: {w.dateText}</div>
                                  <div>나의 오답: <span className="font-bold text-red-500">{w.userAnswer || '(미입력)'}</span></div>
                                  <div>정답: <span className="font-bold text-green-600">{w.answer}</span></div>
                                  <div>해설: {w.explanation}</div>
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
            )}
          </section>
        </div>
      </main>

      {iconModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setIconModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800">프로필 아이콘 선택</h3>
              <button onClick={() => setIconModalOpen(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {SAFE_STUDENT_ICONS.map((v) => (
                <button key={v} type="button" disabled={savingIcon} onClick={() => void saveIcon(v)} className={`h-11 rounded border text-2xl ${icon === v ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  {v}
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

