import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const SettingsGeneral: React.FC = () => {
    const [config, setConfig] = useState({
        year: '2025',
        semester: '2',
        showQuiz: true,
        showScore: true,
        showLesson: true
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'config');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setConfig({
                    year: data.year || '2025',
                    semester: data.semester || '2',
                    showQuiz: data.showQuiz !== false,
                    showScore: data.showScore !== false,
                    showLesson: data.showLesson !== false
                });
            }
        } catch (error) {
            console.error("Failed to load config:", error);
            alert("설정을 불러오는데 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;

        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSave = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'config');
            await setDoc(docRef, config, { merge: true });
            alert("기본 설정이 저장되었습니다. 변경 사항을 적용하기 위해 페이지를 새로고침합니다.");
            window.location.reload();
        } catch (error) {
            console.error("Failed to save config:", error);
            alert("설정 저장 실패: " + error);
        }
    };

    if (loading) return <div className="text-center py-10">Loading...</div>;

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm max-w-3xl">
            <div className="border-b border-gray-100 pb-4 mb-6">
                <h3 className="text-lg font-bold text-gray-900">시스템 기본 설정</h3>
                <p className="text-sm text-gray-500 mt-1">학년도, 학기 및 메뉴 표시 여부를 제어합니다.</p>
            </div>

            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">학년도</label>
                        <select
                            name="year"
                            value={config.year}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
                        >
                            <option value="2025">2025학년도</option>
                            <option value="2026">2026학년도</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">학기</label>
                        <select
                            name="semester"
                            value={config.semester}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
                        >
                            <option value="1">1학기</option>
                            <option value="2">2학기</option>
                        </select>
                    </div>
                </div>

                <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg border border-amber-200 font-bold flex items-start gap-2">
                    <i className="fas fa-exclamation-triangle mt-0.5"></i>
                    <span>학년도/학기를 변경하면 해당 기간의 데이터베이스로 즉시 전환됩니다. 학생들의 데이터 조회 범위도 변경됩니다.</span>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <label className="block text-sm font-bold text-gray-700 mb-4">학생 메뉴 표시 제어</label>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                    <i className="fas fa-gamepad"></i>
                                </div>
                                <span className="font-bold text-gray-700">평가(Quiz)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showQuiz"
                                checked={config.showQuiz}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                                    <i className="fas fa-chart-bar"></i>
                                </div>
                                <span className="font-bold text-gray-700">점수(Score)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showScore"
                                checked={config.showScore}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                                    <i className="fas fa-book-reader"></i>
                                </div>
                                <span className="font-bold text-gray-700">수업자료(Lesson)</span>
                            </div>
                            <input
                                type="checkbox"
                                name="showLesson"
                                checked={config.showLesson}
                                onChange={handleChange}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                        </label>
                    </div>
                </div>

                <div className="pt-4 text-right">
                    <button
                        onClick={handleSave}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition transform active:scale-95"
                    >
                        설정 저장
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsGeneral;
