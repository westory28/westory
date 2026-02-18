import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterDocPath } from '../../../lib/semesterScope';

interface QuizSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    nodeId: string;
    category: string;
}

const QuizSettingsModal: React.FC<QuizSettingsModalProps> = ({ isOpen, onClose, nodeId, category }) => {
    const { config } = useAuth();
    const [settings, setSettings] = useState({
        active: false,
        questionCount: 10,
        timeLimitMinutes: 1,
        allowRetake: true,
        cooldown: 0,
        hintLimit: 2
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && nodeId) {
            loadSettings();
        }
    }, [config, isOpen, nodeId, category]);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const key = `${nodeId}_${category}`;
            let snap = await getDoc(doc(db, getSemesterDocPath(config, 'assessment_config', 'settings')));
            if (!snap.exists()) {
                snap = await getDoc(doc(db, 'assessment_config', 'settings'));
            }

            if (snap.exists()) {
                const data = snap.data() as Record<string, any>;
                if (data[key]) {
                    setSettings({
                        active: data[key].active ?? false,
                        questionCount: data[key].questionCount ?? 10,
                        timeLimitMinutes: Math.max(1, Math.round((data[key].timeLimit ?? 60) / 60)),
                        allowRetake: data[key].allowRetake ?? true,
                        cooldown: data[key].cooldown ?? 0,
                        hintLimit: data[key].hintLimit ?? 2
                    });
                } else {
                    // Default
                    setSettings({ active: false, questionCount: 10, timeLimitMinutes: 1, allowRetake: true, cooldown: 0, hintLimit: 2 });
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const key = `${nodeId}_${category}`;
            const payload = {
                ...settings,
                timeLimit: Math.max(1, settings.timeLimitMinutes) * 60,
            } as any;
            delete payload.timeLimitMinutes;
            await setDoc(doc(db, getSemesterDocPath(config, 'assessment_config', 'settings')), {
                [key]: payload
            }, { merge: true });
            alert('설정이 저장되었습니다.');
            onClose();
        } catch (e) {
            console.error(e);
            alert('저장에 실패했습니다.');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl z-10 w-96 p-6 mx-4 animate-fadeScale">
                <h3 className="font-bold text-lg text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
                    <i className="fas fa-sliders-h text-blue-500"></i>평가 상세 설정
                </h3>

                {loading ? (
                    <div className="p-8 text-center text-gray-400">로딩 중...</div>
                ) : (
                    <div className="space-y-5">
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <span className="text-sm font-bold text-gray-600">학생에게 공개</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.active}
                                    onChange={(e) => setSettings({ ...settings, active: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">한 번에 출제할 문항 수</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={settings.questionCount}
                                    onChange={(e) => setSettings({ ...settings, questionCount: parseInt(e.target.value) || 10 })}
                                    className="flex-1 border rounded p-2 text-center font-bold text-blue-600 text-lg"
                                />
                                <span className="text-sm font-bold text-gray-600">개</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">제한 시간 (분)</label>
                            <input
                                type="number"
                                value={settings.timeLimitMinutes}
                                onChange={(e) => setSettings({ ...settings, timeLimitMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                className="w-full border rounded p-2 text-center font-bold text-lg"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">힌트 사용 가능 횟수</label>
                            <input
                                type="number"
                                min={0}
                                max={20}
                                value={settings.hintLimit}
                                onChange={(e) => setSettings({ ...settings, hintLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                className="w-full border rounded p-2 text-center font-bold text-lg"
                            />
                        </div>

                        <div>
                            <label className="flex items-center justify-between cursor-pointer p-3 bg-gray-50 rounded-lg border border-gray-200 mb-2">
                                <span className="text-sm font-bold text-gray-600">재응시 허용</span>
                                <input
                                    type="checkbox"
                                    checked={settings.allowRetake}
                                    onChange={(e) => setSettings({ ...settings, allowRetake: e.target.checked })}
                                    className="w-5 h-5 text-blue-600 rounded"
                                />
                            </label>
                            <div className={`transition-opacity ${settings.allowRetake ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <label className="block text-xs font-bold text-gray-500 mb-1">재응시 대기 시간 (분)</label>
                                <input
                                    type="number"
                                    value={settings.cooldown}
                                    onChange={(e) => setSettings({ ...settings, cooldown: parseInt(e.target.value) || 0 })}
                                    disabled={!settings.allowRetake}
                                    className="w-full border rounded p-2 text-center font-bold text-lg"
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-8 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100 font-bold transition">닫기</button>
                    <button
                        onClick={handleSave}
                        className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg font-bold hover:bg-blue-700 shadow-lg transition transform active:scale-95"
                    >
                        설정 저장하기
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuizSettingsModal;

