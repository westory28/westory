import React, { useEffect, useState } from 'react';
import { db } from '../../../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../../../contexts/AuthContext';
import { getSemesterDocPath } from '../../../../lib/semesterScope';

interface LessonSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectUnit: (unitId: string, title: string) => void;
    selectedUnitId: string | null;
}

interface TreeItem {
    id: string;
    title: string;
    children?: TreeItem[];
}

const LessonSidebar: React.FC<LessonSidebarProps> = ({ isOpen, onClose, onSelectUnit, selectedUnitId }) => {
    const { config } = useAuth();
    const [tree, setTree] = useState<TreeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set([0])); // Default open first group

    useEffect(() => {
        const fetchTree = async () => {
            try {
                const semesterTree = await getDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree')));
                if (semesterTree.exists() && semesterTree.data().tree) {
                    setTree(semesterTree.data().tree);
                    return;
                }

                const globalTree = await getDoc(doc(db, 'curriculum', 'tree'));
                if (globalTree.exists() && globalTree.data().tree) {
                    setTree(globalTree.data().tree);
                }
            } catch (error) {
                console.error("Error fetching curriculum:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchTree();
    }, [config]);

    const toggleGroup = (index: number) => {
        const newSet = new Set(expandedGroups);
        if (newSet.has(index)) {
            newSet.delete(index);
        } else {
            newSet.add(index);
        }
        setExpandedGroups(newSet);
    };

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
                    onClick={onClose}
                ></div>
            )}

            <aside
                className={`
                    fixed lg:static inset-y-0 left-0 z-40
                    w-[80%] max-w-[320px] lg:w-[300px] lg:max-w-none
                    bg-white border-r border-gray-200 shadow-xl lg:shadow-none
                    transform transition-transform duration-300 ease-in-out
                    flex flex-col
                    ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
                    mt-16 lg:mt-0 lg:h-[calc(100vh-64px)]
                `}
            >
                <div className="p-4 border-b border-gray-100 font-extrabold text-gray-800 flex justify-between items-center bg-white sticky top-0">
                    <span>📑 수업 목차</span>
                    <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-gray-600">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 custom-scroll">
                    {loading && <div className="text-center text-gray-400 py-10 text-sm">목차 로딩 중...</div>}
                    {!loading && tree.length === 0 && (
                        <div className="p-4 text-center text-gray-400 text-sm">등록된 목차가 없습니다.</div>
                    )}

                    {tree.map((big, bigIdx) => (
                        <div key={bigIdx} className="mb-3">
                            <div
                                onClick={() => toggleGroup(bigIdx)}
                                className={`
                                    flex items-center p-2 rounded-lg cursor-pointer transition select-none
                                    text-sm font-bold text-gray-700 hover:bg-gray-50
                                    ${expandedGroups.has(bigIdx) ? 'bg-gray-50' : ''}
                                `}
                            >
                                <i className={`fas fa-chevron-right text-xs text-gray-400 mr-2 transition-transform ${expandedGroups.has(bigIdx) ? 'rotate-90 text-blue-500' : ''}`}></i>
                                <span>{big.title}</span>
                            </div>

                            {expandedGroups.has(bigIdx) && (
                                <div className="pl-4 mt-1 border-l-2 border-gray-100 ml-2.5">
                                    {(big.children || []).map((mid, midIdx) => (
                                        <div key={midIdx} className="mb-2">
                                            <div className="text-xs font-bold text-gray-400 px-2 py-1 select-none">
                                                {mid.title}
                                            </div>
                                            {(mid.children || []).map((small, smallIdx) => (
                                                <div
                                                    key={small.id || smallIdx}
                                                    onClick={() => {
                                                        onSelectUnit(small.id, small.title);
                                                        if (window.innerWidth < 1024) onClose();
                                                    }}
                                                    className={`
                                                        flex items-center px-2 py-2 rounded-md cursor-pointer transition mb-0.5
                                                        text-[0.9rem] no-underline select-none
                                                        ${selectedUnitId === small.id
                                                            ? 'bg-blue-600 text-white font-bold shadow-sm'
                                                            : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'}
                                                    `}
                                                >
                                                    <i className={`far fa-file-alt mr-2 text-sm ${selectedUnitId === small.id ? 'text-white' : ''}`}></i>
                                                    <span className="truncate">{small.title}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </aside>
        </>
    );
};

export default LessonSidebar;
