import React, { useEffect, useState } from 'react';
import ExamGradingPlan from './components/ExamGradingPlan';
import ExamOmrConfig from './components/ExamOmrConfig';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { cloneDefaultMenus, sanitizeMenuConfig } from '../../constants/menus';

const ManageExam: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'preview' | 'omr'>('preview');
    const [tabLabels, setTabLabels] = useState({
        preview: '평가 반영 비율',
        omr: '정기시험 답안',
    });
    const [searchParams] = useSearchParams();
    const { userConfig } = useAuth();

    const semesterBadgeText = `${userConfig?.year || '2025'}학년도 ${userConfig?.semester || '1'}학기`;

    useEffect(() => {
        setActiveTab(searchParams.get('tab') === 'omr' ? 'omr' : 'preview');
    }, [searchParams]);

    useEffect(() => {
        const resolveMenuLabels = async () => {
            try {
                const menuSnap = await getDoc(doc(db, 'site_settings', 'menu_config'));
                const menuConfig = menuSnap.exists()
                    ? sanitizeMenuConfig(menuSnap.data())
                    : cloneDefaultMenus();
                const teacherExamMenu = (menuConfig.teacher || []).find((menu) => menu.url === '/teacher/exam');
                const children = teacherExamMenu?.children || [];
                const previewLabel = children.find((child) => child.url === '/teacher/exam')?.name || '평가 반영 비율';
                const omrLabel = children.find((child) => child.url === '/teacher/exam?tab=omr')?.name || '정기시험 답안';
                setTabLabels({ preview: previewLabel, omr: omrLabel });
            } catch (error) {
                console.error('Failed to load exam menu labels:', error);
                setTabLabels({ preview: '평가 반영 비율', omr: '정기시험 답안' });
            }
        };

        void resolveMenuLabels();
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="w-full max-w-7xl mx-auto px-4 py-6 flex-1 flex flex-col">
                <div className="mb-4 flex-shrink-0">
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3 flex-wrap">
                        📊 점수 및 평가 기준 관리
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            {semesterBadgeText}
                        </span>
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">{tabLabels.preview} 기준을 설정하고, {tabLabels.omr}을 관리하세요.</p>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 mb-0 bg-white rounded-t-lg overflow-hidden flex-shrink-0 shadow-sm">
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`flex-1 py-3 px-6 font-bold text-sm border-b-2 transition text-center ${activeTab === 'preview' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        {tabLabels.preview}
                    </button>
                    <button
                        onClick={() => setActiveTab('omr')}
                        className={`flex-1 py-3 px-6 font-bold text-sm border-b-2 transition text-center ${activeTab === 'omr' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        {tabLabels.omr}
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
