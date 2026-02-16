import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterDocPath } from '../../../lib/semesterScope';

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

const ExamOmrConfig: React.FC = () => {
    const { config } = useAuth();
    const [objective, setObjective] = useState<ObjectiveItem[]>([]);
    const [subjective, setSubjective] = useState<SubjectiveItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadConfig();
    }, [config]);

    const loadConfig = async () => {
        setLoading(true);
        try {
            let snap = await getDoc(doc(db, getSemesterDocPath(config, 'exam_config', 'final_exam')));
            if (!snap.exists()) {
                snap = await getDoc(doc(db, 'exam_config', 'final_exam'));
            }
            if (snap.exists()) {
                const d = snap.data();
                setObjective(d.objective || []);
                setSubjective(d.subjective || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            try {
                await setDoc(doc(db, getSemesterDocPath(config, 'exam_config', 'final_exam')), {
                    objective,
                    subjective,
                    updatedAt: serverTimestamp()
                });
            } catch {
                await setDoc(doc(db, 'exam_config', 'final_exam'), {
                    objective,
                    subjective,
                    updatedAt: serverTimestamp()
                });
            }
            alert("저장되었습니다.");
        } catch (e) {
            console.error(e);
            alert("저장 실패");
        }
    };

    const getTotals = () => {
        let score = 0;
        let count = 0;
        objective.forEach(i => { score += i.score; count++; });
        subjective.forEach(p => p.subItems.forEach(i => { score += i.score; count++; }));
        return { score, count };
    };

    const addObjective = () => setObjective([...objective, { score: 4, answer: 0 }]);
    const removeObjective = (idx: number) => setObjective(objective.filter((_, i) => i !== idx));
    const updateObjective = (idx: number, field: keyof ObjectiveItem, val: any) => {
        const newObj = [...objective];
        // @ts-ignore
        newObj[idx][field] = val;
        setObjective(newObj);
    };

    const addSubjectiveParent = () => setSubjective([...subjective, { subItems: [] }]);
    const removeSubjectiveParent = (idx: number) => setSubjective(subjective.filter((_, i) => i !== idx));

    const addSubjectiveSub = (pIdx: number) => {
        const newSub = [...subjective];
        newSub[pIdx].subItems.push({ score: 5, answer: '' });
        setSubjective(newSub);
    };

    const updateSubjectiveSub = (pIdx: number, sIdx: number, field: keyof SubjectiveSubItem, val: any) => {
        const newSub = [...subjective];
        // @ts-ignore
        newSub[pIdx].subItems[sIdx][field] = val;
        setSubjective(newSub);
    };

    return (
        <div className="h-full relative pb-20">
            {/* Bottom Floater */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-2xl rounded-2xl px-6 py-3 flex items-center gap-4 z-50 animate-fadeUp">
                <div className="flex items-center gap-3 text-sm font-bold">
                    <span className="text-gray-500">총점</span>
                    <span className="text-2xl font-extrabold text-blue-600">{getTotals().score}</span>
                    <span className="text-gray-400">점</span>
                    <span className="mx-1 text-gray-300">|</span>
                    <span className="text-gray-500">문항</span>
                    <span className="text-lg font-extrabold text-gray-700">{getTotals().count}</span>
                </div>
                <button
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2 rounded-xl text-sm transition shadow-md"
                >
                    <i className="fas fa-save mr-1"></i>저장
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-32">
                {/* Objective */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-center mb-6 pb-2 border-b">
                        <h2 className="font-bold text-lg text-gray-700">객관식 문항</h2>
                        <button onClick={addObjective} className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded font-bold hover:bg-green-100 border border-green-200">
                            + 문항 추가
                        </button>
                    </div>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                        {loading && <div className="text-center text-gray-400">로딩 중...</div>}
                        {objective.map((item, i) => (
                            <div key={i} className="flex items-center gap-4 bg-gray-50 p-3 rounded border border-gray-100">
                                <span className="font-bold text-gray-500 w-8 text-center">{i + 1}</span>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => updateObjective(i, 'answer', n)}
                                            className={`w-8 h-8 rounded-full border border-gray-300 font-bold transition flex items-center justify-center ${item.answer === n
                                                ? 'bg-red-500 text-white border-red-500'
                                                : 'text-gray-500 hover:bg-gray-100'
                                                }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="number"
                                    className="w-16 p-1 text-center border rounded text-sm font-bold text-blue-600"
                                    value={item.score}
                                    onChange={(e) => updateObjective(i, 'score', Number(e.target.value))}
                                />
                                <span className="text-xs text-gray-400">점</span>
                                <button onClick={() => removeObjective(i)} className="ml-auto text-gray-300 hover:text-red-500">
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Subjective */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-center mb-6 pb-2 border-b">
                        <h2 className="font-bold text-lg text-gray-700">서술형 문항</h2>
                        <button onClick={addSubjectiveParent} className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded font-bold hover:bg-indigo-100 border border-indigo-200">
                            + 큰 문항 추가
                        </button>
                    </div>
                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                        {subjective.map((parent, pIdx) => (
                            <div key={pIdx} className="bg-gray-50 p-4 rounded border border-gray-200">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-bold text-indigo-600">서술형 {pIdx + 1}번</span>
                                    <div className="space-x-2">
                                        <button onClick={() => addSubjectiveSub(pIdx)} className="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-50">
                                            + 소문항
                                        </button>
                                        <button onClick={() => removeSubjectiveParent(pIdx)} className="text-gray-400 hover:text-red-500">
                                            <i className="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {parent.subItems.map((sub, sIdx) => (
                                        <div key={sIdx} className="pl-4 border-l-2 border-indigo-100">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-gray-500">({sIdx + 1})</span>
                                                <input
                                                    type="number"
                                                    className="w-14 p-1 text-center border rounded text-xs font-bold"
                                                    value={sub.score}
                                                    onChange={(e) => updateSubjectiveSub(pIdx, sIdx, 'score', Number(e.target.value))}
                                                />
                                                <span className="text-xs text-gray-400">점</span>
                                            </div>
                                            <textarea
                                                className="w-full p-2 border rounded text-sm h-16 resize-none"
                                                placeholder="모범 답안 입력"
                                                value={sub.answer}
                                                onChange={(e) => updateSubjectiveSub(pIdx, sIdx, 'answer', e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExamOmrConfig;
