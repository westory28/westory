import React, { useState } from 'react';
import SettingsGeneral from './components/SettingsGeneral';
import SettingsSchool from './components/SettingsSchool';
import SettingsInterface from './components/SettingsInterface';
import SettingsPrivacy from './components/SettingsPrivacy';

const Settings: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'general' | 'school' | 'interface' | 'privacy'>('general');

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                <aside className="w-full lg:w-64 shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden sticky top-8">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                                <i className="fas fa-cog text-gray-400"></i> 관리자 설정
                            </h2>
                        </div>
                        <nav className="flex flex-col">
                            <button
                                onClick={() => setActiveTab('general')}
                                className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                            >
                                <div className="w-6 text-center"><i className="fas fa-sliders-h"></i></div>
                                기본 환경 설정
                            </button>
                            <button
                                onClick={() => setActiveTab('school')}
                                className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${activeTab === 'school' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                            >
                                <div className="w-6 text-center"><i className="fas fa-school"></i></div>
                                학교/학년/학기
                            </button>
                            <button
                                onClick={() => setActiveTab('interface')}
                                className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${activeTab === 'interface' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                            >
                                <div className="w-6 text-center"><i className="fas fa-palette"></i></div>
                                인터페이스 설정
                            </button>
                            <button
                                onClick={() => setActiveTab('privacy')}
                                className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${activeTab === 'privacy' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                            >
                                <div className="w-6 text-center"><i className="fas fa-user-shield"></i></div>
                                개인정보 동의 관리
                            </button>
                        </nav>
                    </div>
                </aside>

                <div className="flex-1">
                    {activeTab === 'general' && <SettingsGeneral />}
                    {activeTab === 'school' && <SettingsSchool />}
                    {activeTab === 'interface' && <SettingsInterface />}
                    {activeTab === 'privacy' && <SettingsPrivacy />}
                </div>
            </main>
        </div>
    );
};

export default Settings;
