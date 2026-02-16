import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';

interface TreeItem {
    id: string;
    title: string;
    children?: TreeItem[];
}

interface AssessmentConfig {
    [key: string]: {
        active: boolean;
        [key: string]: any;
    };
}

const QuizIndex: React.FC = () => {
    const { userData, config } = useAuth(); // Global config might have semester info
    const navigate = useNavigate();

    const [tree, setTree] = useState<TreeItem[]>([]);
    const [assessmentConfig, setAssessmentConfig] = useState<AssessmentConfig>({});
    const [loading, setLoading] = useState(true);
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Fetch Curriculum Tree
                // Try legacy global path first as per HTML logic
                let treeDoc = await getDoc(doc(db, 'curriculum', 'tree'));
                if (treeDoc.exists() && treeDoc.data().tree) {
                    setTree(treeDoc.data().tree);
                }

                // 2. Fetch Assessment Config
                let settingsDoc = await getDoc(doc(db, 'assessment_config', 'settings'));
                if (settingsDoc.exists()) {
                    setAssessmentConfig(settingsDoc.data() as AssessmentConfig);
                } else {
                    // Fallback check for status doc (legacy)
                    let statusDoc = await getDoc(doc(db, 'assessment_config', 'status'));
                    if (statusDoc.exists()) {
                        const raw = statusDoc.data();
                        const converted: AssessmentConfig = {};
                        for (const key in raw) {
                            converted[key] = { active: raw[key] };
                        }
                        setAssessmentConfig(converted);
                    }
                }

            } catch (error) {
                console.error("Error fetching quiz data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const toggleAccordion = (index: number) => {
        const newSet = new Set(expandedItems);
        if (newSet.has(index)) {
            newSet.delete(index);
        } else {
            newSet.add(index);
        }
        setExpandedItems(newSet);
    };

    const startQuiz = (unitId: string, category: string, title: string) => {
        navigate(`/student/quiz/run?unitId=${unitId}&category=${category}&title=${encodeURIComponent(title)}`);
    };

    const isExamPrepActive = assessmentConfig['exam_prep_exam_prep']?.active === true;

    if (loading) {
        return <div className="flex justify-center items-center h-64"><div className="loader-spinner"></div></div>;
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 animate-fadeIn">

            {/* Greeting */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-8 flex items-center gap-3 animate-slideIn">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-xl">🔥</div>
                <div>
                    <div className="font-bold text-gray-800">
                        <span className="text-blue-600">{userData?.name || '학생'}</span>님, 오늘도 화이팅!
                    </div>
                </div>
            </div>

            {/* Exam Prep Banner */}
            <section className="mb-10">
                <h2 className="text-lg font-bold text-gray-800 mb-3 ml-1 flex items-center gap-2">
                    <i className="fas fa-flag-checkered text-blue-600"></i> 실전 대비
                </h2>
                <div
                    onClick={() => isExamPrepActive && startQuiz('exam_prep', 'exam_prep', '정기 시험 대비 실전')}
                    className={`
                        relative overflow-hidden rounded-2xl p-6 transition-transform duration-200 shadow-lg group
                        ${isExamPrepActive
                            ? 'bg-gradient-to-br from-blue-800 to-blue-500 text-white cursor-pointer hover:scale-[1.01]'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                    `}
                >
                    <i className={`fas fa-pen-fancy absolute -right-5 -bottom-5 text-8xl opacity-10 transform -rotate-15 ${!isExamPrepActive && 'hidden'}`}></i>

                    <div className="relative z-10">
                        <div className={`text-[10px] font-bold px-2 py-1 rounded inline-block mb-2 shadow-sm ${isExamPrepActive ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'}`}>
                            {isExamPrepActive ? 'FINAL CHECK' : '비공개'}
                        </div>
                        <h3 className="text-2xl font-black mb-1">정기 시험 대비 {isExamPrepActive ? '실전 문제' : '(준비중)'}</h3>
                        <p className={`text-sm font-medium ${isExamPrepActive ? 'text-blue-100 opacity-90' : 'text-gray-400'}`}>
                            {isExamPrepActive ? '실제 시험처럼 문제를 풀어보고 실력을 점검하세요.' : '선생님이 평가를 활성화하면 시작할 수 있습니다.'}
                        </p>
                    </div>

                    {isExamPrepActive && (
                        <div className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-white/20 backdrop-blur-sm p-3 rounded-full text-white group-hover:bg-white group-hover:text-blue-600 transition hidden md:block">
                            <i className="fas fa-chevron-right text-xl"></i>
                        </div>
                    )}
                </div>
            </section>

            {/* Assessment List */}
            <section>
                <h2 className="text-lg font-bold text-gray-800 mb-4 ml-1 flex items-center gap-2">
                    <i className="fas fa-layer-group text-amber-500"></i> 단원별 평가
                </h2>

                <div className="space-y-4">
                    {tree.length === 0 && (
                        <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-200">
                            등록된 단원이 없습니다.<br /><span className="text-xs">선생님이 아직 단원을 등록하지 않았습니다.</span>
                        </div>
                    )}

                    {tree.map((big, idx) => (
                        <div key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-shadow hover:shadow-sm">
                            <div
                                onClick={() => toggleAccordion(idx)}
                                className="flex justify-between items-center p-5 cursor-pointer bg-white hover:bg-gray-50 transition-colors"
                            >
                                <span className="font-extrabold text-gray-800 text-lg">{big.title}</span>
                                <i className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${expandedItems.has(idx) ? 'rotate-180 text-blue-500' : ''}`}></i>
                            </div>

                            {expandedItems.has(idx) && (
                                <div className="bg-gray-50 border-t border-gray-100">
                                    {big.children?.map((mid, mIdx) => {
                                        const diagActive = assessmentConfig[`${mid.id}_diagnostic`]?.active === true;
                                        const formActive = assessmentConfig[`${mid.id}_formative`]?.active === true;

                                        return (
                                            <div key={mIdx} className="flex flex-col md:flex-row md:items-center justify-between p-4 border-b border-gray-200 last:border-0 gap-3">
                                                <div className="flex items-center text-gray-700 font-semibold">
                                                    <i className="fas fa-folder text-amber-400 mr-3"></i>
                                                    {mid.title}
                                                </div>
                                                <div className="flex gap-2 self-end md:self-auto">
                                                    <button
                                                        onClick={() => diagActive && startQuiz(mid.id, 'diagnostic', mid.title)}
                                                        disabled={!diagActive}
                                                        className={`
                                                            px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 border transition-all
                                                            ${diagActive
                                                                ? 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white hover:border-blue-600'
                                                                : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}
                                                        `}
                                                    >
                                                        {diagActive ? <i className="fas fa-stethoscope"></i> : <i className="fas fa-lock"></i>}
                                                        {diagActive ? '진단평가' : '진단'}
                                                    </button>

                                                    <button
                                                        onClick={() => formActive && startQuiz(mid.id, 'formative', mid.title)}
                                                        disabled={!formActive}
                                                        className={`
                                                            px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 border transition-all
                                                            ${formActive
                                                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white hover:border-emerald-600'
                                                                : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}
                                                        `}
                                                    >
                                                        {formActive ? <i className="fas fa-pencil-alt"></i> : <i className="fas fa-lock"></i>}
                                                        {formActive ? '형성평가' : '형성'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default QuizIndex;
