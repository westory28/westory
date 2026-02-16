import React, { useEffect, useState } from 'react';
import { db } from '../../../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface TreeUnit {
    id: string;
    title: string;
    children?: TreeUnit[];
}

interface QuizUnitTreeProps {
    onSelect: (node: TreeUnit, type: 'special' | 'normal', parentTitle?: string) => void;
}

const QuizUnitTree: React.FC<QuizUnitTreeProps> = ({ onSelect }) => {
    const [treeData, setTreeData] = useState<TreeUnit[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        const loadTree = async () => {
            try {
                const snap = await getDoc(doc(db, 'curriculum', 'tree'));
                if (snap.exists()) {
                    setTreeData(snap.data().tree || []);
                }
            } catch (e) {
                console.error("Failed to load curriculum tree", e);
            }
        };
        loadTree();
    }, []);

    const handleSelect = (node: TreeUnit, type: 'special' | 'normal', parentTitle?: string) => {
        setActiveId(node.id);
        onSelect(node, type, parentTitle);
    };

    return (
        <div className="h-full overflow-y-auto p-4">
            {/* Exam Prep Special Node */}
            <div
                className={`flex items-center p-3 rounded-lg cursor-pointer transition mb-4 border ${activeId === 'exam_prep'
                        ? 'bg-yellow-50 border-yellow-400 text-yellow-800 font-bold'
                        : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'
                    }`}
                onClick={() => handleSelect({ id: 'exam_prep', title: '정기 시험 대비 실전' }, 'special')}
            >
                <i className="fas fa-file-contract mr-2"></i> 정기 시험 대비 실전
            </div>

            <div className="space-y-1">
                {treeData.map(big => (
                    <div key={big.id} className="mb-2">
                        <div className="font-bold text-gray-800 py-1 select-none px-2">{big.title}</div>
                        {big.children && (
                            <div className="ml-2 border-l border-dashed border-gray-300 pl-2 space-y-1">
                                {big.children.map(mid => (
                                    <div
                                        key={mid.id}
                                        className={`flex items-center px-3 py-2 rounded-lg cursor-pointer text-sm transition ${activeId === mid.id
                                                ? 'bg-blue-50 text-blue-600 font-bold'
                                                : 'hover:bg-gray-100 text-gray-600'
                                            }`}
                                        onClick={() => handleSelect(mid, 'normal', big.title)}
                                    >
                                        <i className="fas fa-folder text-yellow-400 mr-2"></i>
                                        {mid.title}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default QuizUnitTree;
