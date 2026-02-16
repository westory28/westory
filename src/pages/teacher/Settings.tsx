import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsGeneral from './components/SettingsGeneral';
import SettingsSchool from './components/SettingsSchool';
import SettingsInterface from './components/SettingsInterface';
import SettingsPrivacy from './components/SettingsPrivacy';

const Settings: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'general' | 'school' | 'interface' | 'privacy'>('general');

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                {/* Sidebar Navigation */}
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
                                학교급·학년·학급
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
                    <button
                        onClick={() => navigate('/teacher/dashboard')}
                        className="w-full mt-4 p-4 bg-white border border-gray-200 rounded-xl text-gray-500 font-bold hover:bg-gray-50 hover:text-gray-700 transition shadow-sm flex items-center justify-center gap-2"
                    >
                        <i className="fas fa-arrow-left"></i> 대시보드로 돌아가기
                    </button>
                </aside>

                {/* Main Content Area */}
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
