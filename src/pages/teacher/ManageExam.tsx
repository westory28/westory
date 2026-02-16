import React, { useState } from 'react';
import ExamGradingPlan from './components/ExamGradingPlan';
import ExamOmrConfig from './components/ExamOmrConfig';
import Header from '../../components/common/Header';

const ManageExam: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'preview' | 'omr'>('preview');

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <Header />
            <main className="w-full max-w-7xl mx-auto px-4 py-6 flex-1 flex flex-col">
                <div className="flex justify-between items-end mb-4 flex-shrink-0">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                            📊 점수 및 평가 기준 관리
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">성적 산출 기준을 설정하고, 정기 시험 정답을 관리하세요.</p>
                    </div>
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
