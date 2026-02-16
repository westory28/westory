import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const SettingsInterface: React.FC = () => {
    const [config, setConfig] = useState({
        mainEmoji: '📚',
        mainSubtitle: '우리가 써 내려가는 이야기',
        ddayEnabled: false,
        ddayTitle: '',
        ddayDate: '',
        footerText: ''
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'interface_config');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setConfig({
                    mainEmoji: data.mainEmoji || '📚',
                    mainSubtitle: data.mainSubtitle || '우리가 써 내려가는 이야기',
                    ddayEnabled: data.ddayEnabled || false,
                    ddayTitle: data.ddayTitle || '',
                    ddayDate: data.ddayDate || '',
                    footerText: data.footerText || ''
                });
            }
        } catch (error) {
            console.error("Failed to load interface config:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSave = async () => {
        if (config.ddayEnabled && (!config.ddayTitle || !config.ddayDate)) {
            alert('D-Day 사용 시 제목과 날짜를 입력해주세요.');
            return;
        }

        try {
            const docRef = doc(db, 'site_settings', 'interface_config');
            await setDoc(docRef, {
                ...config,
                mainEmoji: config.mainEmoji.trim() || '📚',
                mainSubtitle: config.mainSubtitle.trim() || '우리가 써 내려가는 이야기',
                updatedAt: serverTimestamp()
            });
            alert('인터페이스 설정이 저장되었습니다.');
        } catch (error: any) {
            console.error("Failed to save interface config:", error);
            alert('저장 실패: ' + error.message);
        }
    };

    if (loading) return <div className="text-center py-10">Loading...</div>;

    return (
        <div className="max-w-3xl space-y-8">
            {/* Section 1: Landing Page Text */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">
                        <i className="fas fa-home text-blue-500 mr-2"></i>메인 화면 설정
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">로그인(메인) 화면의 문구와 이모지를 설정합니다.</p>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">메인 이모지</label>
                        <input
                            type="text"
                            name="mainEmoji"
                            value={config.mainEmoji}
                            onChange={handleChange}
                            placeholder="예: 📚"
                            className="w-24 text-center text-2xl border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <p className="text-xs text-gray-400 mt-1">이모지 1개를 입력하세요. (윈도우 키 + .)</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">서브 타이틀 (문구)</label>
                        <input
                            type="text"
                            name="mainSubtitle"
                            value={config.mainSubtitle}
                            onChange={handleChange}
                            placeholder="예: 우리가 써 내려가는 이야기"
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* Section 2: Footer Settings */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">
                        <i className="fas fa-copyright text-gray-500 mr-2"></i>푸터(Footer) 설정
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">사이트 하단의 저작권 문구를 설정합니다.</p>
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">저작권 문구</label>
                    <input
                        type="text"
                        name="footerText"
                        value={config.footerText}
                        onChange={handleChange}
                        placeholder="예: Copyright © 용신중학교 역사교사 방재석. All rights reserved."
                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                    />
                </div>
            </div>

            {/* Section 3: D-Day */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">
                                <i className="fas fa-hourglass-half text-orange-500 mr-2"></i>D-Day 표시
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">메인 화면에 D-Day 카운터를 표시합니다.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                name="ddayEnabled"
                                checked={config.ddayEnabled}
                                onChange={handleChange}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            <span className="ml-3 text-sm font-medium text-gray-900">사용</span>
                        </label>
                    </div>
                </div>

                <div className={`space-y-6 transition-opacity duration-200 ${config.ddayEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                        <input
                            type="text"
                            name="ddayTitle"
                            value={config.ddayTitle}
                            onChange={handleChange}
                            placeholder="예: 수능, 중간고사"
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">목표 날짜</label>
                        <input
                            type="date"
                            name="ddayDate"
                            value={config.ddayDate}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>
            </div>

            <div className="text-right pb-8">
                <button
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-10 rounded-xl shadow-lg transition transform active:scale-95 text-base"
                >
                    <i className="fas fa-save mr-2"></i>전체 저장
                </button>
            </div>
        </div>
    );
};

export default SettingsInterface;
