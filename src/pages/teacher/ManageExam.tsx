import React, { useState } from 'react';
import ExamGradingPlan from './components/ExamGradingPlan';
import ExamOmrConfig from './components/ExamOmrConfig';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ManageExam: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'preview' | 'omr'>('preview');
    const [searchParams] = useSearchParams();
    const { userConfig } = useAuth();

    const semesterBadgeText = `${userConfig?.year || '2025'}학년도 ${userConfig?.semester || '1'}학기`;

    React.useEffect(() => {
        setActiveTab(searchParams.get('tab') === 'omr' ? 'omr' : 'preview');
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="w-full max-w-7xl mx-auto px-4 py-6 flex-1 flex flex-col">
                <div className="flex justify-between items-end mb-4 flex-shrink-0">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                            📊 점수 및 평가 기준 관리
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">성적 산출 기준을 설정하고, 정기 시험 정답을 관리하세요.</p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {semesterBadgeText}
                    </span>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 mb-0 bg-white rounded-t-lg overflow-hidden flex-shrink-0 shadow-sm">
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`flex-1 py-3 px-6 font-bold text-sm border-b-2 transition text-center ${activeTab === 'preview' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        1. 성적 산출 관리
                    </button>
                    <button
                        onClick={() => setActiveTab('omr')}
                        className={`flex-1 py-3 px-6 font-bold text-sm border-b-2 transition text-center ${activeTab === 'omr' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        2. 정기 시험 정답 (OMR)
                    </button>
                </div>

                {/* Content Container */}
                <div className="bg-white border-x border-b border-gray-200 rounded-b-lg p-6 flex-1 min-h-[500px] relative overflow-hidden">
                    {activeTab === 'preview' && <ExamGradingPlan />}
                    {activeTab === 'omr' && <ExamOmrConfig />}
                </div>
            </main>
        </div>
    );
};

export default ManageExam;
