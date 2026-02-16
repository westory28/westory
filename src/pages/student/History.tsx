import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Header from '../../components/common/Header';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, getDocs, query, where, orderBy, documentId } from 'firebase/firestore';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface UserProfile {
    name: string;
    class?: string;
    number?: string;
}

interface QuizResult {
    score: number;
    timestamp: any;
    timeString?: string;
    details?: any[];
}

const StudentHistory = () => {
    const { user } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [historyData, setHistoryData] = useState<QuizResult[]>([]);
    const [chartData, setChartData] = useState<any>(null);
    const [stats, setStats] = useState({ total: 0, best: 0, avg: 0 });
    const [currentConfig, setCurrentConfig] = useState<{ year: string; semester: string } | null>(null);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedResult, setSelectedResult] = useState<QuizResult | null>(null);
    const [modalContent, setModalContent] = useState<any[]>([]);
    const [modalLoading, setModalLoading] = useState(false);

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

        const loadData = async () => {
            try {
                // Load User
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    setProfile(userDoc.data() as UserProfile);
                }

                // Load History
                // Path: years/{year}/semesters/{semester}/quiz_results
                const resultsRef = collection(db, 'years', currentConfig.year, 'semesters', currentConfig.semester, 'quiz_results');
                const q = query(resultsRef, where('uid', '==', user.uid), orderBy('timestamp', 'desc'));
                const snap = await getDocs(q);

                const results: QuizResult[] = [];
                snap.forEach(doc => results.push(doc.data() as QuizResult));

                setHistoryData(results);
                updateStats(results);
                renderChart(results);
            } catch (error) {
                console.error("Error loading history:", error);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [user, currentConfig]);

    const updateStats = (list: QuizResult[]) => {
        if (list.length === 0) {
            setStats({ total: 0, best: 0, avg: 0 });
            return;
        }
        const scores = list.map(i => i.score);
        const total = list.length;
        const best = Math.max(...scores);
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / total);
        setStats({ total, best, avg });
    };

    const renderChart = (list: QuizResult[]) => {
        if (list.length === 0) {
            setChartData(null);
            return;
        }
        const reversedList = [...list].reverse();
        setChartData({
            labels: reversedList.map((_, i) => i + 1 + "회"),
            datasets: [{
                label: '점수',
                data: reversedList.map(i => i.score),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#f59e0b',
                pointRadius: 5,
                pointHoverRadius: 7,
                pointBorderWidth: 2
            }]
        });
    };

    const openModal = async (result: QuizResult) => {
        setSelectedResult(result);
        setModalOpen(true);
        setModalLoading(true);
        setModalContent([]);

        try {
            const userLogs = result.details || [];
            if (userLogs.length === 0) throw new Error("저장된 문제 정보가 없습니다.");

            const ids = userLogs.map(log => String(log.id));
            const chunks = [];
            for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));

            const questionMap: { [key: string]: any } = {};
            const questionsRef = collection(db, 'years', currentConfig!.year, 'semesters', currentConfig!.semester, 'quiz_questions');

            await Promise.all(chunks.map(async (chunk) => {
                const qSnap = await getDocs(query(questionsRef, where(documentId(), 'in', chunk)));
                qSnap.forEach(doc => { questionMap[doc.id] = doc.data(); });
            }));

            const content = userLogs.map((log) => {
                const realQuestion = questionMap[log.id];
                return {
                    ...log,
                    question: realQuestion?.question || "문제 정보를 찾을 수 없습니다.",
                    answer: realQuestion?.answer || "",
                    explanation: realQuestion?.explanation || "해설 정보가 없습니다.",
                    isFound: !!realQuestion
                };
            });
            setModalContent(content);

        } catch (e) {
            console.error(e);
            alert("문제 정보를 불러오는 중 오류가 발생했습니다.");
        } finally {
            setModalLoading(false);
        }
    };

    const closeModal = () => {
        setModalOpen(false);
        setSelectedResult(null);
    };

    const linkify = (text: string) => {
        if (!text) return null;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);
        return parts.map((part, i) => {
            if (part.match(urlRegex)) {
                return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-bold hover:text-blue-800">참고 자료 보기</a>;
            }
            return part;
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-50 flex flex-col">
                <Header />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-400 mx-auto mb-2"></div>
                        <p className="text-stone-500 font-bold">학생 데이터를 통합하는 중...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-stone-50 min-h-screen flex flex-col font-sans text-stone-800">
            <Header />
            <main className="flex-grow w-full max-w-3xl mx-auto px-4 py-8">
                <div className="bg-white rounded-2xl shadow-lg border border-stone-100 overflow-hidden mb-8">
                    <div className="p-8 text-center bg-gradient-to-b from-white to-stone-50">
                        <div className="w-24 h-24 bg-white border-4 border-amber-100 rounded-full flex items-center justify-center text-4xl mb-4 shadow-sm mx-auto">
                            🎓
                        </div>
                        <h2 className="text-2xl font-bold text-stone-900 mb-1">{profile?.name || user?.displayName}</h2>
                        <p className="text-stone-500 text-sm font-medium">
                            {profile ? `${profile.class || '?'}반 ${profile.number || '?'}번` : '정보 로딩 중...'} | {user?.email}
                        </p>
                        <span className="inline-block mt-2 bg-stone-100 px-2 py-1 rounded text-xs text-stone-500 font-bold">
                            {currentConfig?.year}학년도 {currentConfig?.semester}학기
                        </span>
                    </div>
                    <div className="grid grid-cols-3 border-t border-b border-stone-100">
                        <div className="p-6 text-center border-r border-stone-100 hover:bg-stone-50 transition">
                            <div className="text-xs text-stone-400 font-bold mb-1 uppercase tracking-wider">총 응시</div>
                            <div className="font-bold text-2xl text-stone-800">{stats.total}회</div>
                        </div>
                        <div className="p-6 text-center border-r border-stone-100 hover:bg-stone-50 transition">
                            <div className="text-xs text-stone-400 font-bold mb-1 uppercase tracking-wider">최고 점수</div>
                            <div className="font-bold text-2xl text-amber-500">{stats.best}점</div>
                        </div>
                        <div className="p-6 text-center hover:bg-stone-50 transition">
                            <div className="text-xs text-stone-400 font-bold mb-1 uppercase tracking-wider">평균 점수</div>
                            <div className="font-bold text-2xl text-stone-800">{stats.avg}점</div>
                        </div>
                    </div>
                    <div className="p-6 h-64 bg-white relative">
                        <h3 className="text-sm font-bold text-stone-700 mb-4 flex items-center">
                            <span className="w-1.5 h-4 bg-amber-500 mr-2 rounded-full"></span> 성적 변화 그래프
                        </h3>
                        <div className="h-full pb-6 relative">
                            {chartData && (
                                <Line
                                    data={chartData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: {
                                            y: { beginAtZero: true, max: 100, grid: { color: '#f3f4f6' } },
                                            x: { display: false, grid: { display: false } }
                                        }
                                    }}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-lg border border-stone-100 overflow-hidden">
                    <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-white">
                        <h3 className="font-bold text-stone-800 flex items-center text-lg">📚 상세 학습 기록</h3>
                        <span className="text-xs text-stone-400 bg-stone-100 px-2 py-1 rounded">최신순</span>
                    </div>
                    <div className="divide-y divide-stone-100">
                        {historyData.length === 0 ? (
                            <div className="py-20 text-center">
                                <div className="bg-stone-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">📝</div>
                                <p className="text-stone-500 font-bold">아직 푼 문제가 없습니다.</p>
                            </div>
                        ) : (
                            historyData.map((item, index) => (
                                <div
                                    key={index}
                                    onClick={() => openModal(item)}
                                    className="p-6 flex justify-between items-center bg-white hover:bg-amber-50 transition cursor-pointer group"
                                >
                                    <div className="flex items-center gap-5">
                                        <div className="bg-stone-50 p-3 rounded-2xl text-stone-400 group-hover:bg-amber-100 group-hover:text-amber-600 transition shadow-sm relative border border-stone-100">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="font-bold text-lg text-stone-800 group-hover:text-stone-900 mb-1">
                                                {item.timeString ? item.timeString.split('오')[0] : '날짜 없음'}
                                                <span className="text-xs font-medium text-stone-500 ml-1 bg-stone-100 px-2 py-0.5 rounded-full">
                                                    {item.timeString && item.timeString.includes('오후') ? '오후' : '오전'}
                                                </span>
                                            </div>
                                            <div className="text-sm text-stone-400 flex gap-2 items-center">
                                                <span className="group-hover:text-amber-600 transition">상세보기 및 오답확인</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right flex items-center gap-6">
                                        <div className="text-center">
                                            <span className={`block text-2xl font-black ${item.score >= 80 ? 'text-green-500' : (item.score >= 60 ? 'text-amber-500' : 'text-red-400')}`}>
                                                {item.score}
                                            </span>
                                            <span className="text-[10px] text-stone-400 font-bold">SCORE</span>
                                        </div>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-stone-300 group-hover:text-amber-400 transform group-hover:translate-x-1 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </main>

            {/* Modal */}
            {modalOpen && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]"
                    onClick={closeModal}
                >
                    <div
                        className="bg-white w-full max-w-3xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-5 border-b border-stone-200 flex justify-between items-center bg-stone-50">
                            <div>
                                <h3 className="font-bold text-xl text-stone-900">📄 오답 노트 & 해설</h3>
                                <p className="text-sm text-stone-500 mt-1">
                                    {selectedResult?.timeString ? `${selectedResult.timeString} 응시 기록` : '-'}
                                </p>
                            </div>
                            <button onClick={closeModal} className="text-stone-400 hover:text-stone-700 p-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-stone-100 space-y-6">
                            {modalLoading ? (
                                <div className="flex flex-col items-center justify-center h-full text-stone-400">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-stone-400 mb-3"></div>
                                    <p>문제 정보를 불러오는 중입니다...</p>
                                </div>
                            ) : (
                                modalContent.map((log, i) => (
                                    <div key={i} className={`bg-white p-6 rounded-xl shadow-sm border transition hover:shadow-md ${log.correct ? 'border-stone-200' : 'border-red-300 bg-red-50/50'}`}>
                                        <div className="flex items-start gap-3 mb-4">
                                            <span className="bg-stone-800 text-white text-sm font-bold px-2.5 py-1 rounded shrink-0 mt-0.5">Q{i + 1}</span>
                                            <h4 className="text-lg font-bold text-stone-800 flex-1 leading-snug break-keep">
                                                {linkify(log.question)}
                                            </h4>
                                            <span className="text-2xl shrink-0">{log.correct ? '✅' : '❌'}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-3 mb-4 text-sm">
                                            <div className={`bg-white px-4 py-2.5 rounded-lg border shadow-sm flex items-center gap-2 ${log.correct ? 'border-green-200 text-green-700' : 'border-red-300 text-red-600'}`}>
                                                <span className="font-bold">✍️ 내가 쓴 답:</span>
                                                <span className="text-lg font-bold">{log.u || "미입력"}</span>
                                            </div>
                                            {!log.correct && (
                                                <div className="bg-white px-4 py-2.5 rounded-lg border border-green-500 text-green-700 shadow-sm flex items-center gap-2">
                                                    <span className="font-bold">💯 정답:</span>
                                                    <span className="text-lg font-bold">{log.answer}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-stone-100 p-4 rounded-lg text-sm text-stone-700 leading-relaxed border border-stone-200">
                                            <span className="font-bold text-indigo-600 block mb-1">💡 해설</span>
                                            {linkify(log.explanation)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="p-4 border-t border-stone-200 bg-white text-right">
                            <button onClick={closeModal} className="bg-stone-800 text-white px-6 py-2 rounded-lg hover:bg-stone-700 transition font-bold text-sm">
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentHistory;
