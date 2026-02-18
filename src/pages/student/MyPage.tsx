import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

type Tab = 'wrong' | 'activity';
interface UserProfile { name?: string; grade?: number; class?: number; number?: number; profileIcon?: string }
interface QuizDetail { id: string | number; correct: boolean; u: string }
interface QuizResult { id: string; score: number; unitId?: string; category?: string; status?: string; timestamp?: any; timeString?: string; details?: QuizDetail[] }
interface WrongItem { key: string; question: string; answer: string; explanation: string; userAnswer: string; unitId: string; category: string; unitTitle: string; categoryLabel: string; dateText: string }

const SUBJECT_PRIORITY = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '체육', '미술', '음악', '정보'];
const SAFE_STUDENT_ICONS = ['😀', '😎', '🧠', '📚', '✏️', '🧪', '🏫', '🌟', '🚀', '🐯', '🐻', '🦊', '🐼', '🐬', '🦉'];
const cat = (v?: string) => (v === 'diagnostic' ? '진단평가' : v === 'formative' ? '형성평가' : v === 'exam_prep' ? '학기 시험 대비' : '기타 평가');
const catShort = (v?: string) => (v === 'diagnostic' ? '진단' : v === 'formative' ? '형성' : v === 'exam_prep' ? '학기 시험' : '기타');
const fmt = (r: QuizResult) => (r.timestamp?.seconds ? new Date(r.timestamp.seconds * 1000).toLocaleString() : r.timeString || '-');
const chunk = (a: string[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const MyPage: React.FC = () => {
  const { user, userData } = useAuth();
  const [cfg, setCfg] = useState<{ year: string; semester: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [icon, setIcon] = useState('😀');
  const [iconOpen, setIconOpen] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);
  const [scoreData, setScoreData] = useState<any>(null);
  const [quizData, setQuizData] = useState<any>(null);
  const [scoreCount, setScoreCount] = useState(0);
  const [quizCount, setQuizCount] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('wrong');
  const [unitMap, setUnitMap] = useState<Record<string, string>>({ exam_prep: '학기 시험 대비' });
  const [groups, setGroups] = useState<Record<string, QuizResult[]>>({});
  const [wrong, setWrong] = useState<WrongItem[]>([]);
  const [loadingWrong, setLoadingWrong] = useState(false);
  const [openWrong, setOpenWrong] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [fUnit, setFUnit] = useState('all');
  const [fCat, setFCat] = useState('all');

  useEffect(() => { void (async () => { const d = await getDoc(doc(db, 'site_settings', 'config')); if (d.exists()) setCfg(d.data() as any); })(); }, []);
  useEffect(() => { if (!user || !cfg) return; void loadProfile(); void loadUnitMap(); void loadScore(); }, [user, cfg]);
  useEffect(() => { if (!user || !cfg) return; void loadQuizBundle(); }, [user, cfg, unitMap]);

  const loadProfile = async () => {
    if (!user) return;
    const d = await getDoc(doc(db, 'users', user.uid));
    if (!d.exists()) return;
    const p = d.data() as UserProfile;
    setProfile(p);
    setIcon(p.profileIcon || '😀');
  };

  const loadUnitMap = async () => {
    if (!cfg) return;
    let d = await getDoc(doc(db, 'years', cfg.year, 'semesters', cfg.semester, 'curriculum', 'tree'));
    if (!d.exists()) d = await getDoc(doc(db, 'curriculum', 'tree'));
    if (!d.exists()) return;
    const map: Record<string, string> = { exam_prep: '학기 시험 대비' };
    (d.data().tree || []).forEach((big: any) => (big.children || []).forEach((mid: any) => { if (mid?.id && mid?.title) map[mid.id] = mid.title; }));
    setUnitMap(map);
  };

  const loadQuizResults = async (): Promise<QuizResult[]> => {
    if (!user || !cfg) return [];
    let s = await getDocs(query(collection(db, 'years', cfg.year, 'semesters', cfg.semester, 'quiz_results'), where('uid', '==', user.uid)));
    if (s.empty) s = await getDocs(query(collection(db, 'quiz_results'), where('uid', '==', user.uid)));
    const out: QuizResult[] = [];
    s.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
    out.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    return out;
  };

  const loadScore = async () => {
    if (!user || !cfg) return;
    const sd = await getDoc(doc(db, 'users', user.uid, 'academic_records', `${cfg.year}_${cfg.semester}`));
    const userScores = sd.exists() ? sd.data().scores || {} : {};
    const ps = await getDocs(collection(db, 'years', cfg.year, 'semesters', cfg.semester, 'grading_plans'));
    const sums: Record<string, number> = {};
    ps.forEach((d) => {
      const p = d.data(); let total = 0;
      (p.items || []).forEach((it: any, i: number) => { const v = parseFloat(userScores[`${d.id}_${i}`]); if (!Number.isNaN(v)) total += (v / it.maxScore) * it.ratio; });
      if (p.subject) sums[p.subject] = +total.toFixed(1);
    });
    const arr = Object.entries(sums).sort((a, b) => {
      const p = (s: string) => { const i = SUBJECT_PRIORITY.findIndex((k) => s.includes(k)); return i === -1 ? 999 : i; };
      return p(a[0]) - p(b[0]);
    });
    setScoreCount(arr.length);
    setScoreData(arr.length ? { labels: arr.map((x) => x[0]), datasets: [{ label: '환산 점수', data: arr.map((x) => x[1]), backgroundColor: 'rgba(59,130,246,.6)', borderColor: 'rgba(59,130,246,1)', borderWidth: 1, borderRadius: 4 }] } : null);
  };

  const loadQuizBundle = async () => {
    if (!user || !cfg) return;
    setLoadingWrong(true);
    const results = await loadQuizResults();
    setQuizCount(results.length);
    const last10 = results.slice(0, 10).reverse();
    setQuizData(last10.length ? {
      labels: last10.map((r, i) => `${i + 1}. ${(unitMap[r.unitId || ''] || r.unitId || '단원 미지정')} · ${catShort(r.category)}`),
      datasets: [{ label: '점수', data: last10.map((r) => r.score || 0), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.12)', fill: true, tension: .3, pointRadius: 4 }],
    } : null);

    const g: Record<string, QuizResult[]> = {};
    results.forEach((r) => { const k = `${r.unitId || 'unknown'}_${r.category || 'unknown'}`; g[k] = g[k] || []; g[k].push(r); });
    Object.keys(g).forEach((k) => g[k].sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    setGroups(g);

    const logs: Array<{ qid: string; u: string; unitId: string; category: string; dateText: string }> = [];
    results.slice(0, 20).forEach((r) => (r.details || []).forEach((d) => { if (!d.correct) logs.push({ qid: String(d.id), u: d.u || '', unitId: r.unitId || 'unknown', category: r.category || 'unknown', dateText: fmt(r) }); }));
    if (!logs.length) { setWrong([]); setLoadingWrong(false); return; }

    const qids = Array.from(new Set(logs.map((x) => x.qid)));
    const qMap: Record<string, any> = {};
    await Promise.all(chunk(qids, 10).map(async (ids) => {
      const s = await getDocs(query(collection(db, 'years', cfg.year, 'semesters', cfg.semester, 'quiz_questions'), where(documentId(), 'in', ids)));
      s.forEach((d) => { qMap[d.id] = d.data(); });
    }));
    const miss = qids.filter((id) => !qMap[id]);
    if (miss.length) await Promise.all(chunk(miss, 10).map(async (ids) => {
      const s = await getDocs(query(collection(db, 'quiz_questions'), where(documentId(), 'in', ids)));
      s.forEach((d) => { qMap[d.id] = d.data(); });
    }));

    const seen = new Set<string>(); const out: WrongItem[] = [];
    logs.forEach((l) => {
      const q = qMap[l.qid]; if (!q) return;
      const key = `${l.qid}_${l.unitId}_${l.category}`; if (seen.has(key)) return; seen.add(key);
      out.push({ key, question: q.question || '문항 텍스트 없음', answer: q.answer || '-', explanation: q.explanation || '해설 정보가 없습니다.', userAnswer: l.u, unitId: l.unitId, category: l.category, unitTitle: unitMap[l.unitId] || l.unitId || '단원 미지정', categoryLabel: cat(l.category), dateText: l.dateText });
    });
    setWrong(out);
    setLoadingWrong(false);
  };

  const saveIcon = async (v: string) => {
    if (!user) return;
    setSavingIcon(true);
    try { await setDoc(doc(db, 'users', user.uid), { profileIcon: v, updatedAt: serverTimestamp() }, { merge: true }); setIcon(v); setIconOpen(false); }
    catch { alert('아이콘 저장에 실패했습니다.'); }
    finally { setSavingIcon(false); }
  };

  const titleBadges = useMemo(() => {
    const a: string[] = [];
    if (scoreCount >= 8) a.push('성실한 학습자');
    if (quizCount >= 8) a.push('평가 참여 우수');
    if (wrong.length > 0 && wrong.length <= 3) a.push('오답 정리가 탄탄해요');
    if (!wrong.length && quizCount >= 3) a.push('정확도가 매우 높아요');
    if (!a.length) a.push('꾸준히 성장 중');
    return a.slice(0, 2);
  }, [scoreCount, quizCount, wrong.length]);

  const wrongFiltered = useMemo(() => wrong.filter((w) => (fUnit === 'all' || w.unitId === fUnit) && (fCat === 'all' || w.category === fCat)), [wrong, fUnit, fCat]);
  const wrongGrouped = useMemo(() => {
    const m: Record<string, WrongItem[]> = {};
    wrongFiltered.forEach((w) => { const k = `${w.unitId}_${w.category}`; m[k] = m[k] || []; m[k].push(w); });
    return m;
  }, [wrongFiltered]);
  const unitOptions = useMemo(() => Array.from(new Map(wrong.map((w) => [w.unitId, w.unitTitle])).entries()).map(([value, label]) => ({ value, label })), [wrong]);

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <main className="flex-grow w-full max-w-6xl mx-auto px-4 py-8">
        <section className="mb-8">
          <div className="bg-gradient-to-br from-blue-800 to-blue-600 text-white rounded-3xl p-8 flex flex-col md:flex-row items-center gap-6 shadow-xl relative overflow-hidden">
            <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center text-4xl border-4 border-white/30 shadow-lg relative">{icon}
              <button type="button" onClick={() => setIconOpen(true)} className="absolute bottom-0 right-0 bg-white text-blue-600 text-xs font-bold w-7 h-7 rounded-full">✎</button>
            </div>
            <div className="text-center md:text-left flex-1">
              <div className="mb-2 flex flex-wrap gap-2">{titleBadges.map((b) => <span key={b} className="bg-white/20 rounded-full px-3 py-1 text-xs font-bold">{b}</span>)}</div>
              <h1 className="text-3xl font-extrabold mb-1">{profile?.name || userData?.name || '학생'}</h1>
              <p className="text-blue-100">{profile ? `${profile.grade || '--'}학년 ${profile.class || '--'}반 ${profile.number || '--'}번` : '--학년 --반 --번'}</p>
              <div className="inline-flex items-center bg-black/20 rounded-lg px-4 py-2 text-sm mt-2"><span>퀴즈 참여 {quizCount}회</span><span className="mx-2">|</span><span>성적 입력 {scoreCount}과목</span></div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl border shadow-sm p-6 h-80 flex flex-col">
            <h3 className="font-bold text-gray-800 mb-4">나의 성적표</h3>
            <div className="flex-1">{scoreData ? <Bar data={scoreData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }} /> : <div className="text-gray-400 text-sm font-bold">성적 데이터가 없습니다.</div>}</div>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-6 h-80 flex flex-col">
            <h3 className="font-bold text-gray-800 mb-4">퀴즈 성장 그래프 <span className="text-xs text-gray-400 ml-2">최근 10회</span></h3>
            <div className="flex-1">{quizData ? <Line data={quizData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 }, x: { ticks: { callback: (_v, i) => `${Number(i) + 1}회` } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => String(it[0]?.label || ''), label: (it) => `점수 ${it.formattedValue}점` } } } }} /> : <div className="text-gray-400 text-sm font-bold">퀴즈 응시 기록이 없습니다.</div>}</div>
            <p className="text-xs text-center text-gray-400 mt-2">* 라벨: 단원 · 평가 유형</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="flex border-b">
            <button onClick={() => setActiveTab('wrong')} className={`px-6 py-4 font-bold border-b-2 ${activeTab === 'wrong' ? 'text-blue-600 border-blue-600' : 'text-gray-400 border-transparent'}`}>오답 노트</button>
            <button onClick={() => setActiveTab('activity')} className={`px-6 py-4 font-bold border-b-2 ${activeTab === 'activity' ? 'text-blue-600 border-blue-600' : 'text-gray-400 border-transparent'}`}>퀴즈 이력(단원/평가)</button>
          </div>

          {activeTab === 'wrong' && (
            <div className="p-6">
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                <select value={fUnit} onChange={(e) => setFUnit(e.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="all">전체 단원</option>{unitOptions.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
                <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="all">전체 평가</option><option value="diagnostic">진단평가</option><option value="formative">형성평가</option><option value="exam_prep">학기 시험 대비</option></select>
              </div>
              {loadingWrong ? <div className="text-center text-gray-400 py-10">오답 데이터를 분석하고 있습니다...</div> : Object.keys(wrongGrouped).length === 0 ? <div className="text-center text-gray-400 py-10 bg-gray-50 rounded-xl">최근 20회 퀴즈에서 오답이 없습니다.</div> : (
                <div className="space-y-4">
                  {Object.entries(wrongGrouped).map(([k, items]) => (
                    <div key={k} className="border rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 font-bold text-sm">{items[0].unitTitle} · {items[0].categoryLabel}</div>
                      <div className="divide-y">
                        {items.map((q) => (
                          <div key={q.key}>
                            <button type="button" className="w-full p-4 text-left hover:bg-gray-50 flex items-center justify-between" onClick={() => setOpenWrong((v) => (v === q.key ? null : q.key))}><span className="font-bold text-gray-800">{q.question}</span><i className={`fas fa-chevron-down text-gray-400 ${openWrong === q.key ? 'rotate-180' : ''}`}></i></button>
                            {openWrong === q.key && <div className="bg-red-50 p-4 text-sm"><div className="mb-2 text-xs text-gray-500">최근 오답 일시: {q.dateText}</div><div className="mb-1">나의 오답: <span className="font-bold text-red-500">{q.userAnswer || '(미입력)'}</span></div><div className="mb-1">정답: <span className="font-bold text-green-600">{q.answer}</span></div><div>해설: {q.explanation}</div></div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="p-6 space-y-4">
              {Object.keys(groups).length === 0 ? <div className="text-center text-gray-400 py-10 bg-gray-50 rounded-xl">퀴즈 이력이 없습니다.</div> : Object.entries(groups).sort((a, b) => ((b[1][0]?.timestamp?.seconds || 0) - (a[1][0]?.timestamp?.seconds || 0))).map(([k, arr]) => {
                const [unitId, category] = k.split('_');
                const avg = Math.round(arr.reduce((s, r) => s + (r.score || 0), 0) / arr.length);
                const latest = arr[0];
                const title = `${unitMap[unitId] || unitId || '단원 미지정'} · ${cat(category)}`;
                return (
                  <div key={k} className="border rounded-xl overflow-hidden">
                    <button type="button" onClick={() => setOpenGroup((v) => (v === k ? null : k))} className="w-full px-4 py-4 text-left hover:bg-gray-50 flex items-center justify-between"><div><div className="font-bold text-gray-800">{title}</div><div className="text-xs text-gray-500 mt-1">응시 {arr.length}회 · 평균 {avg}점 · 최근 {latest ? `${latest.score}점` : '-'}</div></div><i className={`fas fa-chevron-down text-gray-400 ${openGroup === k ? 'rotate-180' : ''}`}></i></button>
                    {openGroup === k && <div className="border-t bg-gray-50 px-4 py-3 space-y-2">{arr.map((r) => <div key={r.id} className="bg-white rounded-lg border px-3 py-2 text-sm flex items-center justify-between"><span>{fmt(r)}</span><span className="font-bold text-blue-700">{r.score || 0}점</span></div>)}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {iconOpen && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setIconOpen(false)}><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold text-gray-800">프로필 아이콘 선택</h3><button onClick={() => setIconOpen(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button></div><div className="grid grid-cols-5 gap-2">{SAFE_STUDENT_ICONS.map((v) => <button key={v} type="button" disabled={savingIcon} onClick={() => void saveIcon(v)} className={`h-11 rounded-lg border text-2xl ${icon === v ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>{v}</button>)}</div></div></div>}
    </div>
  );
};

export default MyPage;

