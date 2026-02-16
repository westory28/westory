import React, { useEffect, useState } from 'react';
import QuizUnitTree from './components/QuizUnitTree';
import QuizEditor from './components/QuizEditor';
import QuizLogTab from './components/QuizLogTab';
import QuizBankTab from './components/QuizBankTab';
import QuizSettingsModal from './components/QuizSettingsModal';
import { db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSemesterDocPath } from '../../lib/semesterScope';

interface TreeUnit {
    id: string;
    title: string;
    children?: TreeUnit[];
}

const ManageQuiz: React.FC = () => {
    const { config } = useAuth();
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<'manage' | 'log' | 'bank'>('manage');
    const [selectedNode, setSelectedNode] = useState<{ id: string; title: string } | null>(null);
    const [selectedNodeType, setSelectedNodeType] = useState<'special' | 'normal'>('normal');
    const [parentTitle, setParentTitle] = useState('');
    const [treeData, setTreeData] = useState<TreeUnit[]>([]);
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [settingsCategory, setSettingsCategory] = useState('diagnostic');

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab === 'log') setActiveTab('log');
        else if (requestedTab === 'bank') setActiveTab('bank');
        else setActiveTab('manage');
    }, [searchParams]);

    useEffect(() => {
        const loadTree = async () => {
            try {
                const semesterTree = await getDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree')));
                if (semesterTree.exists()) {
                    setTreeData(semesterTree.data().tree || []);
                    return;
                }

                const legacyTree = await getDoc(doc(db, 'curriculum', 'tree'));
                if (legacyTree.exists()) {
                    setTreeData(legacyTree.data().tree || []);
                }
            } catch (error) {
                console.error(error);
            }
        };
        void loadTree();
    }, [config]);

    const handleNodeSelect = (node: TreeUnit, type: 'special' | 'normal', parent?: string) => {
        setSelectedNode(node);
        setSelectedNodeType(type);
        setParentTitle(parent || '');
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 py-6 flex flex-col">
                <div className="flex border-b border-gray-200 mb-4 bg-white rounded-t-lg px-2 shrink-0 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('manage')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition ${activeTab === 'manage' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}
                    >
                        문제 등록
                    </button>
                    <button
                        onClick={() => setActiveTab('log')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition ${activeTab === 'log' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}
                    >
                        제출 현황
                    </button>
                    <button
                        onClick={() => setActiveTab('bank')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition ${activeTab === 'bank' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}
                    >
                        문제 은행
                    </button>
                </div>

                {activeTab === 'manage' && (
                    <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden pb-2">
                        <div className="w-full lg:w-1/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden h-[300px] lg:h-full">
                            <div className="p-4 border-b bg-gray-50 font-bold text-gray-700">
                                단원 및 평가 선택
                            </div>
                            <QuizUnitTree onSelect={handleNodeSelect} />
                        </div>

                        <div className="w-full lg:w-2/3 flex flex-col h-full overflow-hidden">
                            {selectedNode ? (
                                <QuizEditor
                                    node={selectedNode}
                                    type={selectedNodeType}
                                    parentTitle={parentTitle}
                                    treeData={treeData}
                                    onOpenSettings={(cat) => {
                                        setSettingsCategory(cat);
                                        setSettingsModalOpen(true);
                                    }}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">
                                    <i className="fas fa-mouse-pointer text-4xl mb-4"></i>
                                    <p className="text-lg text-center">
                                        목록에서 <strong>학기 시험 대비</strong> 또는<br />
                                        <strong>중단원</strong>을 선택해 문제를 관리하세요.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'log' && <QuizLogTab />}
                {activeTab === 'bank' && <QuizBankTab />}

                <QuizSettingsModal
                    isOpen={settingsModalOpen}
                    onClose={() => setSettingsModalOpen(false)}
                    nodeId={selectedNode?.id || ''}
                    category={settingsCategory}
                />
            </main>
        </div>
    );
};

export default ManageQuiz;
