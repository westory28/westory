import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import Chart from 'chart.js/auto';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';

// Interfaces
interface Question {
    id: number;
    type: 'choice' | 'ox' | 'short' | 'word' | 'order';
    question: string;
    options?: string[]; // For choice
    answer: string | number;
    explanation?: string;
    image?: string;
    hintEnabled?: boolean;
    hint?: string;
    refBig?: string;
    refMid?: string;
    category?: string;
}

interface QuizConfig {
    active: boolean;
    timeLimit?: number;
    allowRetake?: boolean;
    cooldown?: number;
    questionCount?: number;
    hintLimit?: number;
    randomOrder?: boolean;
}

const QuizRunner: React.FC = () => {
    const ORDER_DELIMITER = '||';
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { userData, config } = useAuth();
    const unitId = searchParams.get('unitId');
    const category = searchParams.get('category');
    const title = searchParams.get('title') || '평가';

    // States for Flow
    const [view, setView] = useState<'loading' | 'intro' | 'quiz' | 'result'>('loading');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [blockReason, setBlockReason] = useState<string | null>(null);

    // Data States
    const [quizConfig, setQuizConfig] = useState<QuizConfig | null>(null);
    const [allQuestions, setAllQuestions] = useState<Question[]>([]);
    const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);
    const [historyCount, setHistoryCount] = useState(0);

    // Quiz Execution States
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<{ [key: number]: string }>({});
    const [timeLeft, setTimeLeft] = useState(0);
    const [hintUsedCount, setHintUsedCount] = useState(0);
    const [revealedHints, setRevealedHints] = useState<Record<number, boolean>>({});
    const [orderOptionMap, setOrderOptionMap] = useState<Record<number, string[]>>({});
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Result States
    const [score, setScore] = useState(0);
    const [results, setResults] = useState<any[]>([]);
    const maxHintUses = quizConfig?.hintLimit ?? 2;

    useEffect(() => {
        if (!unitId || !category || !userData) return;
        initializeQuiz();
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [config, unitId, category, userData]);

    const initializeQuiz = async () => {
        try {
            // 1. Fetch Config
            let settingsDoc = await getDoc(doc(db, getSemesterDocPath(config, 'assessment_config', 'settings')));
            if (!settingsDoc.exists()) {
                settingsDoc = await getDoc(doc(db, 'assessment_config', 'settings'));
            }
            const key = `${unitId}_${category}`;
            const settingsData = settingsDoc.exists() ? settingsDoc.data() : {};
            const quizConfig: QuizConfig = settingsData[key] || { active: true, timeLimit: 60, allowRetake: true, cooldown: 0, questionCount: 10, hintLimit: 2, randomOrder: true };

            setQuizConfig(quizConfig);

            if (!quizConfig.active && unitId !== 'exam_prep') {
                throw new Error('현재 비활성화된 평가입니다.');
            }

            // 2. Fetch Questions
            let qQuery;
            const qRef = collection(db, getSemesterCollectionPath(config, 'quiz_questions'));
            if (unitId === 'exam_prep') {
                qQuery = query(qRef, where('category', '==', 'exam_prep'));
            } else {
                qQuery = query(qRef, where('unitId', '==', unitId), where('category', '==', category));
            }

            let qSnap = await getDocs(qQuery);
            if (qSnap.empty) {
                const legacyRef = collection(db, 'quiz_questions');
                if (unitId === 'exam_prep') {
                    qSnap = await getDocs(query(legacyRef, where('category', '==', 'exam_prep')));
                } else {
                    qSnap = await getDocs(query(legacyRef, where('unitId', '==', unitId), where('category', '==', category)));
                }
            }
            const fetchedQuestions: Question[] = [];
            qSnap.forEach(d => fetchedQuestions.push({ id: parseInt(d.id), ...d.data() } as Question));

            if (fetchedQuestions.length === 0) throw new Error('등록된 문제가 없습니다.');
            setAllQuestions(fetchedQuestions);

            // 3. Check History (avoid composite index by sorting client-side)
            const hRef = collection(db, getSemesterCollectionPath(config, 'quiz_results'));
            const historyQuery = query(
                hRef,
                where('uid', '==', userData?.uid),
                where('unitId', '==', unitId),
                where('category', '==', category),
            );
            let hSnap = await getDocs(historyQuery);
            if (hSnap.empty) {
                const legacyHistoryQuery = query(
                    collection(db, 'quiz_results'),
                    where('uid', '==', userData?.uid),
                    where('unitId', '==', unitId),
                    where('category', '==', category),
                );
                hSnap = await getDocs(legacyHistoryQuery);
            }
            const historyDocs = [...hSnap.docs].sort((a, b) => {
                const aSec = a.data().timestamp?.seconds || 0;
                const bSec = b.data().timestamp?.seconds || 0;
                return bSec - aSec;
            });
            setHistoryCount(historyDocs.length);

            if (!quizConfig.allowRetake && historyDocs.length > 0 && unitId !== 'exam_prep') {
                setBlockReason("재응시가 허용되지 않는 평가입니다.");
                setView('intro');
                return;
            }

            if ((quizConfig.cooldown || 0) > 0 && historyDocs.length > 0) {
                const lastAttempt = historyDocs[0].data().timestamp?.toDate();
                if (lastAttempt) {
                    const diffMins = (new Date().getTime() - lastAttempt.getTime()) / 1000 / 60;
                    if (diffMins < (quizConfig.cooldown || 0)) {
                        const remain = Math.ceil((quizConfig.cooldown || 0) - diffMins);
                        setBlockReason(`재응시 대기 시간: ${remain}분 남음`);
                        setView('intro');
                        return;
                    }
                }
            }

            // Ready to start
            const solvedIds = new Set<number>();
            historyDocs.forEach(doc => {
                const d = doc.data();
                if (d.details) d.details.forEach((log: any) => solvedIds.add(parseInt(log.id)));
            });

            // Smart Selection Logic (Simplified)
            selectQuestions(fetchedQuestions, solvedIds, quizConfig.questionCount || 10, quizConfig.randomOrder ?? true);

            setView('intro');

        } catch (err: any) {
            setErrorMsg(err.message || '초기화 중 오류가 발생했습니다.');
            setView('intro'); // Show error in intro View or generic error
        }
    };

    const selectQuestions = (all: Question[], solvedIds: Set<number>, targetCount: number, randomOrder: boolean) => {
        let pool = all.filter(q => !solvedIds.has(q.id));
        if (pool.length < targetCount) {
            pool = [...all]; // Fallback
        }
        // 랜덤 출제 여부 설정에 따라 출제 순서를 분기한다.
        const orderedPool = randomOrder
            ? [...pool].sort(() => 0.5 - Math.random())
            : [...pool].sort((a, b) => a.id - b.id);
        const selected = orderedPool.slice(0, targetCount);
        setSelectedQuestions(selected);

        // 순서 나열형은 학생에게 보기 순서를 섞어서 보여주되,
        // 한 번 시작한 응시에서는 동일 문항에 대해 고정 순서를 유지한다.
        const nextOrderMap: Record<number, string[]> = {};
        selected.forEach((q) => {
            if (q.type !== 'order') return;
            const base = (q.options && q.options.length > 0)
                ? [...q.options]
                : String(q.answer || '').split(ORDER_DELIMITER).filter(Boolean);
            nextOrderMap[q.id] = [...base].sort(() => 0.5 - Math.random());
        });
        setOrderOptionMap(nextOrderMap);
    };

    const startQuiz = () => {
        setCurrentIndex(0);
        setAnswers({});
        setTimeLeft(quizConfig?.timeLimit || 60);
        setHintUsedCount(0);
        setRevealedHints({});
        setView('quiz');

        // Start Timer
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    finishQuiz(true); // Timeout
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const handleAnswer = (val: string) => {
        const qId = selectedQuestions[currentIndex].id;
        setAnswers(prev => ({ ...prev, [qId]: val }));
    };

    const parseOrderAnswer = (value: string) => value.split(ORDER_DELIMITER).filter(Boolean);

    const appendOrderSelection = (option: string) => {
        const qId = selectedQuestions[currentIndex].id;
        const current = parseOrderAnswer(answers[qId] || '');
        if (current.includes(option)) return;
        handleAnswer([...current, option].join(ORDER_DELIMITER));
    };

    const removeOrderSelection = (index: number) => {
        const qId = selectedQuestions[currentIndex].id;
        const current = parseOrderAnswer(answers[qId] || '');
        handleAnswer(current.filter((_, i) => i !== index).join(ORDER_DELIMITER));
    };

    const revealHint = (question: Question) => {
        const qId = question.id;
        if (revealedHints[qId]) return;
        if (hintUsedCount >= maxHintUses) {
            alert(`힌트는 한 번의 평가에서 최대 ${maxHintUses}회만 사용할 수 있습니다.`);
            return;
        }
        setRevealedHints((prev) => ({ ...prev, [qId]: true }));
        setHintUsedCount((prev) => prev + 1);
    };

    const nextQuestion = () => {
        // Confirmation if empty?
        // if (!answers[selectedQuestions[currentIndex].id] && !confirm('정답을 입력하지 않았습니다. 다음으로 넘어가시겠습니까?')) return;

        if (currentIndex < selectedQuestions.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            finishQuiz();
        }
    };

    const prevQuestion = () => {
        if (currentIndex <= 0) return;
        setCurrentIndex((prev) => prev - 1);
    };

    const finishQuiz = async (isTimeout = false) => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isTimeout) alert('제한 시간이 종료되었습니다.');

        let correctCnt = 0;
        const resultDetails: any[] = [];
        const logDetails: any[] = [];

        selectedQuestions.forEach(q => {
            const userAns = (answers[q.id] || "").toString().replace(/\s+/g, '').trim();
            const realAns = q.answer.toString().replace(/\s+/g, '').trim();
            const isCorrect = (userAns === realAns);
            if (isCorrect) correctCnt++;

            resultDetails.push({
                q: q.question,
                u: answers[q.id],
                a: q.answer,
                correct: isCorrect,
                exp: q.explanation
            });

            logDetails.push({ id: q.id, correct: isCorrect, u: userAns }); // For DB
        });

        const finalScore = Math.round((correctCnt / selectedQuestions.length) * 100);
        setScore(finalScore);
        setResults(resultDetails);

        // Save to Firestore
        if (userData) {
            try {
                await addDoc(collection(db, getSemesterCollectionPath(config, 'quiz_results')), {
                    uid: userData.uid,
                    name: userData.name || 'Student',
                    email: userData.email || '',
                    class: userData.class || 0,
                    number: userData.number || 0,
                    gradeClass: `${userData.grade || ''}학년 ${userData.class || ''}반 ${userData.number || ''}번`,
                    unitId: unitId,
                    category: category,
                    score: finalScore,
                    details: logDetails,
                    status: isTimeout ? '시간 초과' : '완료',
                    timestamp: serverTimestamp(),
                    timeString: new Date().toLocaleString()
                });
            } catch (e) {
                console.error("Failed to save result", e);
            }
        }

        setView('result');
    };

    // Render Views
    if (view === 'loading') return <div className="flex h-screen items-center justify-center font-bold text-gray-500">로딩 중...</div>;

    if (view === 'intro') {
        const timeLimitSeconds = quizConfig?.timeLimit || 60;
        const timeLimitMinutes = Math.max(1, Math.round(timeLimitSeconds / 60));
        const qCount = quizConfig?.questionCount || 10;

        return (
            <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen flex flex-col items-center justify-center text-center animate-fadeIn">
                <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 w-full relative">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6">
                        <i className="fas fa-file-signature"></i>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
                    <p className="text-gray-500 mb-6 font-medium bg-gray-50 inline-block px-4 py-1 rounded-full text-sm">
                        {category === 'diagnostic' ? '진단평가' : (category === 'formative' ? '형성평가' : '학기 시험 대비')}
                    </p>

                    <div className="space-y-4 mb-8 text-left bg-blue-50 p-5 rounded-xl border border-blue-100 text-base">
                        <div className="flex justify-between border-b border-blue-200 pb-2">
                            <span className="text-gray-600">제한 시간</span>
                            <span className="font-bold text-blue-800 text-lg">{timeLimitMinutes}분</span>
                        </div>
                        <div className="flex justify-between border-b border-blue-200 pb-2">
                            <span className="text-gray-600">출제 문항 수</span>
                            <span className="font-bold text-blue-800 text-lg">{qCount}문항</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">응시 횟수</span>
                            <span className="font-bold text-gray-800 text-lg">{historyCount}회</span>
                        </div>
                    </div>

                    {errorMsg && <div className="text-red-500 font-bold mb-4">{errorMsg}</div>}

                    {!blockReason ? (
                        <button onClick={startQuiz} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-md transition transform active:scale-95 text-lg">
                            평가 시작하기
                        </button>
                    ) : (
                        <div className="text-red-500 font-bold p-4 bg-red-50 rounded-xl border border-red-100">
                            <i className="fas fa-ban mr-2"></i>{blockReason}
                        </div>
                    )}

                    <button onClick={() => navigate(-1)} className="mt-4 text-gray-400 text-sm hover:underline">돌아가기</button>
                </div>
            </div>
        );
    }

    if (view === 'quiz') {
        const q = selectedQuestions[currentIndex];
        const progress = ((timeLeft / (quizConfig?.timeLimit || 60)) * 100);
        const currentAns = answers[q.id] || '';

        return (
            <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen flex flex-col animate-fadeIn">
                <div className="flex justify-between items-center mb-6">
                    <div className="font-bold text-gray-500">
                        <span className="text-blue-600">{currentIndex + 1}</span> / {selectedQuestions.length}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="bg-amber-50 border border-amber-200 px-3 py-1 rounded-full text-xs font-bold text-amber-700">
                            힌트 {hintUsedCount}/{maxHintUses}
                        </div>
                        <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-200">
                        <i className="fas fa-stopwatch text-red-500"></i>
                        <span className="font-mono font-bold text-lg text-gray-700 w-12 text-center">
                            {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}
                        </span>
                    </div>
                    </div>
                </div>

                <div className="w-full bg-gray-200 rounded-full h-2 mb-8 overflow-hidden">
                    <div
                        className={`h-2 rounded-full transition-all duration-1000 ease-linear ${progress < 20 ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col">
                    {q.image && (
                        <div className="mb-4 text-center">
                            <img src={q.image} className="max-h-48 mx-auto rounded-lg border border-gray-100" alt="Question" />
                        </div>
                    )}

                    <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-8 leading-snug break-keep">
                        {q.question}
                    </h2>

                    {!!(q.hintEnabled && q.hint) && (
                        <div className="mb-4">
                            <button
                                type="button"
                                onClick={() => revealHint(q)}
                                disabled={!!revealedHints[q.id] || hintUsedCount >= maxHintUses}
                                className={`px-3 py-2 rounded-lg text-sm font-bold transition ${
                                    revealedHints[q.id]
                                        ? 'bg-amber-100 text-amber-700'
                                        : hintUsedCount >= maxHintUses
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-amber-500 text-white hover:bg-amber-600'
                                }`}
                            >
                                {revealedHints[q.id] ? '힌트 확인됨' : '힌트 보기'}
                            </button>
                            {revealedHints[q.id] && (
                                <div className="mt-2 border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-amber-900">
                                    <i className="fas fa-lightbulb mr-2"></i>{q.hint}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-3 flex-1">
                        {q.type === 'choice' && q.options?.map((opt, i) => (
                            <div
                                key={i}
                                onClick={() => handleAnswer(opt)}
                                className={`
                                    border-2 rounded-xl p-4 cursor-pointer transition flex items-center
                                    ${currentAns === opt ? 'border-blue-500 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'}
                                `}
                            >
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center mr-3 text-sm font-bold ${currentAns === opt ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</div>
                                <div>{opt}</div>
                            </div>
                        ))}

                        {q.type === 'ox' && ['O', 'X'].map((opt) => (
                            <div
                                key={opt}
                                onClick={() => handleAnswer(opt)}
                                className={`
                                    border-2 rounded-xl p-6 cursor-pointer transition text-center text-xl font-bold
                                    ${currentAns === opt ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'}
                                `}
                            >
                                {opt}
                            </div>
                        ))}

                        {(q.type === 'short' || q.type === 'word') && (
                            <input
                                type="text"
                                value={currentAns}
                                onChange={(e) => handleAnswer(e.target.value)}
                                className="w-full border-b-2 border-gray-300 p-3 text-lg focus:border-blue-500 outline-none text-center bg-transparent"
                                placeholder="정답을 입력하세요"
                            />
                        )}

                        {q.type === 'order' && (
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    {(orderOptionMap[q.id] || q.options || []).map((opt, i) => {
                                        const selected = parseOrderAnswer(currentAns).includes(opt);
                                        return (
                                            <button
                                                key={`${opt}-${i}`}
                                                type="button"
                                                onClick={() => appendOrderSelection(opt)}
                                                className={`px-3 py-2 rounded-lg border-2 text-sm font-bold transition ${selected ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300'}`}
                                            >
                                                {opt}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-3 min-h-[84px]">
                                    <div className="text-xs text-gray-500 mb-2">선택한 순서 (클릭하면 제거)</div>
                                    <div className="flex flex-wrap gap-2">
                                        {parseOrderAnswer(currentAns).map((item, i) => (
                                            <button
                                                key={`${item}-${i}`}
                                                type="button"
                                                onClick={() => removeOrderSelection(i)}
                                                className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-bold"
                                            >
                                                {i + 1}. {item}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-between">
                        <button
                            onClick={prevQuestion}
                            disabled={currentIndex === 0}
                            className={`px-6 py-3 rounded-xl font-bold transition shadow-sm flex items-center ${
                                currentIndex === 0
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            <i className="fas fa-arrow-left mr-2"></i>
                            이전 문제
                        </button>
                        <button
                            onClick={nextQuestion}
                            className="bg-gray-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-900 transition shadow-lg flex items-center"
                        >
                            {currentIndex === selectedQuestions.length - 1 ? '제출하기' : '다음 문제'}
                            {currentIndex === selectedQuestions.length - 1 ? <i className="fas fa-check ml-2"></i> : <i className="fas fa-arrow-right ml-2"></i>}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'result') {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen text-center animate-fadeIn">
                <div className="bg-white p-8 rounded-2xl shadow-xl border-t-8 border-blue-500 mb-8">
                    <h2 className="text-3xl font-black text-gray-800 mb-2">평가 종료</h2>
                    <p className="text-gray-500 mb-8">수고하셨습니다. 결과를 확인하세요.</p>

                    <div className="relative w-48 h-48 mx-auto mb-6 flex items-center justify-center rounded-full border-8 border-blue-50">
                        {/* Simple Score Display instead of Chart.js for simplicity/speed in this component, or we can add Chart later */}
                        <div className="flex flex-col items-center justify-center">
                            <span className="text-5xl font-black text-blue-600">{score}</span>
                            <span className="text-sm text-gray-400 font-bold">점</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <button
                            onClick={() => document.getElementById('review-section')?.classList.toggle('hidden')}
                            className="bg-white border-2 border-gray-200 text-gray-700 font-bold py-3 rounded-xl hover:bg-gray-50 transition"
                        >
                            오답 노트
                        </button>
                        <button
                            onClick={() => navigate('/student/quiz')}
                            className="bg-gray-800 text-white font-bold py-3 rounded-xl hover:bg-gray-900 shadow-md transition"
                        >
                            목록으로
                        </button>
                    </div>
                </div>

                <div id="review-section" className="hidden text-left bg-white p-6 rounded-2xl shadow-lg border border-red-100 animate-slideDown">
                    <h3 className="font-bold text-lg text-red-500 mb-4 border-b pb-2">
                        <i className="fas fa-check-circle mr-2"></i>채점 결과 확인
                    </h3>
                    <div className="space-y-6">
                        {results.map((r, i) => (
                            <div key={i} className={`border-b pb-4 last:border-0 ${r.correct ? 'opacity-50' : ''}`}>
                                <div className="flex gap-2 items-start mb-2">
                                    <span className={`text-xs font-bold px-2 py-1 rounded ${r.correct ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                        Q{i + 1}
                                    </span>
                                    <div className="font-bold text-gray-800">{r.q}</div>
                                </div>
                                <div className="flex gap-4 text-sm ml-8 mb-2">
                                    <span className={`font-bold ${r.correct ? 'text-green-500' : 'text-red-500 line-through'}`}>
                                        {r.u || '(미입력)'}
                                    </span>
                                    {!r.correct && (
                                        <span className="text-blue-600 font-bold">
                                            <i className="fas fa-arrow-right mr-1"></i>{r.a}
                                        </span>
                                    )}
                                </div>
                                <div className="ml-8 bg-gray-50 p-3 rounded text-xs text-gray-600">
                                    {r.exp || '해설 없음'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return <div></div>;
};

export default QuizRunner;


