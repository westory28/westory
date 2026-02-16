import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { getSemesterDocPath } from '../../lib/semesterScope';

interface ObjectiveItem {
    score: number;
    answer: number;
}

interface SubjectiveSubItem {
    score: number;
    answer: string;
}

interface SubjectiveItem {
    subItems: SubjectiveSubItem[];
}

interface ExamConfig {
    objective: ObjectiveItem[];
    subjective: SubjectiveItem[];
}

interface ObjectiveMark {
    selected: number;
    isCorrect: boolean;
}

const StudentExamAnswer: React.FC = () => {
    const { config } = useAuth();
    const [examConfig, setExamConfig] = useState<ExamConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [objectiveMarks, setObjectiveMarks] = useState<Record<number, ObjectiveMark>>({});
    const [subjectiveRevealed, setSubjectiveRevealed] = useState<Record<string, boolean>>({});
    const [subjectiveGrades, setSubjectiveGrades] = useState<Record<string, boolean | undefined>>({});

    useEffect(() => {
        const loadExamConfig = async () => {
            setLoading(true);
            try {
                let snap;
                if (config) {
                    snap = await getDoc(doc(db, getSemesterDocPath(config, 'exam_config', 'final_exam')));
                }
                if (!snap || !snap.exists()) {
                    snap = await getDoc(doc(db, 'exam_config', 'final_exam'));
                }

                if (!snap.exists()) {
                    setExamConfig(null);
                    return;
                }

                const data = snap.data();
                setExamConfig({
                    objective: Array.isArray(data.objective) ? data.objective : [],
                    subjective: Array.isArray(data.subjective) ? data.subjective : [],
                });
            } catch (error) {
                console.error('Failed to load exam config:', error);
                setExamConfig(null);
            } finally {
                setLoading(false);
            }
        };

        void loadExamConfig();
    }, [config]);

    const maxScore = useMemo(() => {
        if (!examConfig) return 0;
        const objectiveTotal = examConfig.objective.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
        const subjectiveTotal = examConfig.subjective.reduce(
            (sum, parent) => sum + (parent.subItems || []).reduce((subSum, sub) => subSum + (Number(sub.score) || 0), 0),
            0
        );
        return objectiveTotal + subjectiveTotal;
    }, [examConfig]);

    const objectiveScore = useMemo(() => {
        if (!examConfig) return 0;
        return Object.entries(objectiveMarks).reduce((sum, [indexStr, mark]) => {
            if (!mark.isCorrect) return sum;
            const question = examConfig.objective[Number(indexStr)];
            return sum + (Number(question?.score) || 0);
        }, 0);
    }, [examConfig, objectiveMarks]);

    const subjectiveScore = useMemo(() => {
        if (!examConfig) return 0;
        let total = 0;
        examConfig.subjective.forEach((parent, pIdx) => {
            (parent.subItems || []).forEach((sub, sIdx) => {
                const key = `${pIdx}-${sIdx}`;
                if (subjectiveGrades[key]) {
                    total += Number(sub.score) || 0;
                }
            });
        });
        return total;
    }, [examConfig, subjectiveGrades]);

    const totalScore = objectiveScore + subjectiveScore;

    const hasAnyInput = useMemo(() => {
        if (!examConfig) return false;
        const hasObjective = examConfig.objective.length > 0;
        const hasSubjective = examConfig.subjective.some((parent) => (parent.subItems || []).length > 0);
        return hasObjective || hasSubjective;
    }, [examConfig]);

    const handleObjectiveSelect = (index: number, selected: number) => {
        if (!examConfig) return;
        const answer = Number(examConfig.objective[index]?.answer) || 0;
        setObjectiveMarks((prev) => ({
            ...prev,
            [index]: {
                selected,
                isCorrect: selected === answer,
            },
        }));
    };

    const revealSubjective = (key: string) => {
        setSubjectiveRevealed((prev) => ({ ...prev, [key]: true }));
    };

    const gradeSubjective = (key: string, isCorrect: boolean) => {
        setSubjectiveGrades((prev) => ({ ...prev, [key]: isCorrect }));
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center text-gray-500">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-2"></div>
                    <p className="font-bold">시험 답안을 불러오는 중...</p>
                </div>
            </div>
        );
    }

    if (!hasAnyInput) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
                        <div className="text-4xl text-gray-300 mb-3">
                            <i className="fas fa-file-alt"></i>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">정기 시험 답안</h1>
                        <p className="text-gray-500 font-bold">아직 입력된게 없습니다.</p>
                        <p className="text-sm text-gray-400 mt-2">교사가 정기 시험 답안을 입력하면 이곳에 표시됩니다.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-4 mb-6 flex items-center justify-between">
                    <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <i className="fas fa-clipboard-check text-blue-500"></i>
                        정기 시험 답안
                    </h1>
                    <div className="text-right">
                        <div className="text-xs text-gray-400 font-bold">내 점수</div>
                        <div className="text-2xl font-black text-blue-600">
                            {totalScore}
                            <span className="text-sm font-bold text-gray-500 ml-1">/ {maxScore}점</span>
                        </div>
                    </div>
                </div>

                <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
                    <h2 className="font-bold text-lg text-gray-800 mb-4 border-b border-gray-100 pb-2">
                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded mr-2">선택형</span>
                        객관식 답안
                    </h2>

                    {examConfig?.objective.length ? (
                        <div className="space-y-3">
                            {examConfig.objective.map((item, index) => {
                                const mark = objectiveMarks[index];
                                const answer = Number(item.answer) || 0;

                                return (
                                    <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                                        <div className="flex items-center gap-4">
                                            <span className="w-8 text-center text-blue-600 font-bold">{index + 1}</span>
                                            <div className="flex gap-2">
                                                {[1, 2, 3, 4, 5].map((choice) => {
                                                    const isSelected = mark?.selected === choice;
                                                    const isCorrectSelected = isSelected && mark?.isCorrect;
                                                    const isWrongSelected = isSelected && !mark?.isCorrect;
                                                    const isMissedAnswer = !!mark && !mark.isCorrect && choice === answer;

                                                    return (
                                                        <button
                                                            key={choice}
                                                            onClick={() => handleObjectiveSelect(index, choice)}
                                                            className={`w-8 h-8 rounded-full border font-bold text-sm transition ${
                                                                isCorrectSelected
                                                                    ? 'bg-green-500 text-white border-green-500'
                                                                    : isWrongSelected
                                                                        ? 'bg-red-500 text-white border-red-500'
                                                                        : isMissedAnswer
                                                                            ? 'bg-white text-green-600 border-2 border-green-500'
                                                                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            {choice}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-bold text-gray-400">{item.score}점</span>
                                            <span className={`w-6 text-center font-black ${mark ? (mark.isCorrect ? 'text-green-600' : 'text-red-500') : 'text-gray-300'}`}>
                                                {mark ? (mark.isCorrect ? 'O' : 'X') : '-'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">등록된 객관식 문항이 없습니다.</p>
                    )}
                </section>

                <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                    <h2 className="font-bold text-lg text-gray-800 mb-4 border-b border-gray-100 pb-2">
                        <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded mr-2">논술형</span>
                        서술형 답안
                    </h2>

                    <div className="bg-yellow-50 text-yellow-800 text-sm p-3 rounded mb-4">
                        <i className="fas fa-info-circle mr-1"></i>
                        정답을 확인한 후 <strong>정답 인정</strong> 또는 <strong>오답</strong>을 선택하세요.
                    </div>

                    {examConfig?.subjective.some((parent) => (parent.subItems || []).length > 0) ? (
                        <div className="space-y-4">
                            {examConfig.subjective.map((parent, pIdx) => (
                                <div key={pIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="bg-gray-50 px-4 py-2 font-bold text-gray-700">서술형 {pIdx + 1}번</div>
                                    <div className="p-4 space-y-4">
                                        {(parent.subItems || []).map((sub, sIdx) => {
                                            const key = `${pIdx}-${sIdx}`;
                                            const revealed = !!subjectiveRevealed[key];
                                            const grade = subjectiveGrades[key];
                                            return (
                                                <div key={key} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-sm font-bold text-gray-700">({sIdx + 1}) 소문항</span>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs text-gray-400 font-bold">{sub.score}점</span>
                                                            <span className={`w-6 text-center font-black ${grade === undefined ? 'text-gray-300' : grade ? 'text-green-600' : 'text-red-500'}`}>
                                                                {grade === undefined ? '-' : grade ? 'O' : 'X'}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {!revealed ? (
                                                        <button
                                                            onClick={() => revealSubjective(key)}
                                                            className="w-full py-2.5 border-2 border-dashed border-indigo-200 text-indigo-500 rounded font-bold hover:bg-indigo-50 transition"
                                                        >
                                                            <i className="fas fa-eye mr-2"></i>정답 보기
                                                        </button>
                                                    ) : (
                                                        <div className="bg-gray-50 rounded p-3">
                                                            <div className="text-xs font-bold text-gray-500 mb-1">모범 답안</div>
                                                            <div className="text-sm font-bold text-red-600 whitespace-pre-wrap mb-3">
                                                                {sub.answer || '-'}
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => gradeSubjective(key, true)}
                                                                    className={`flex-1 py-2 rounded font-bold border transition ${
                                                                        grade === true
                                                                            ? 'bg-green-500 text-white border-green-500'
                                                                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                                                    }`}
                                                                >
                                                                    정답 인정
                                                                </button>
                                                                <button
                                                                    onClick={() => gradeSubjective(key, false)}
                                                                    className={`flex-1 py-2 rounded font-bold border transition ${
                                                                        grade === false
                                                                            ? 'bg-red-500 text-white border-red-500'
                                                                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                                                    }`}
                                                                >
                                                                    오답
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">등록된 서술형 문항이 없습니다.</p>
                    )}
                </section>
            </main>
        </div>
    );
};

export default StudentExamAnswer;
