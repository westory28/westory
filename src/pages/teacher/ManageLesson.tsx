import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from 'firebase/firestore';
import QuillEditor from '../../components/common/QuillEditor';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../lib/semesterScope';

interface TreeNode {
    id: string;
    title: string;
    children: TreeNode[];
}

interface LessonData {
    unitId: string;
    title: string;
    videoUrl?: string;
    contentHtml?: string;
}

const ManageLesson: React.FC = () => {
    const { config } = useAuth();
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeTitle, setSelectedNodeTitle] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [lessonTitle, setLessonTitle] = useState('');
    const [lessonVideo, setLessonVideo] = useState('');
    const [lessonContent, setLessonContent] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'root' | 'child' | 'rename' | null>(null);
    const [targetNode, setTargetNode] = useState<TreeNode | null>(null);
    const [modalInput, setModalInput] = useState('');

    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void loadTree();
    }, [config]);

    const loadTree = async () => {
        try {
            const scopedDoc = await getDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree')));
            if (scopedDoc.exists() && scopedDoc.data().tree) {
                setTreeData(scopedDoc.data().tree);
                return;
            }

            const legacyDoc = await getDoc(doc(db, 'curriculum', 'tree'));
            if (legacyDoc.exists() && legacyDoc.data().tree) {
                setTreeData(legacyDoc.data().tree);
                return;
            }

            setTreeData([{ id: `root-${Date.now()}`, title: '새 대단원', children: [] }]);
        } catch (error) {
            console.error(error);
        }
    };

    const saveTree = async (newTree: TreeNode[], silent = true) => {
        try {
            await setDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree')), {
                tree: newTree,
                updatedAt: serverTimestamp(),
            });
            setTreeData(newTree);
            if (!silent) {
                alert('단원 구조를 저장했습니다.');
            }
        } catch (error) {
            console.error(error);
            alert('단원 구조 저장에 실패했습니다.');
        }
    };

    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    const handleNodeClick = (node: TreeNode, level: number) => {
        if (level < 2) {
            toggleExpand(node.id);
            return;
        }

        setSelectedNodeId(node.id);
        setSelectedNodeTitle(node.title);
        setSidebarOpen(false);
        void loadLessonContent(node.id, node.title);
    };

    const openModal = (mode: 'root' | 'child' | 'rename', node: TreeNode | null = null) => {
        setModalMode(mode);
        setTargetNode(node);
        setModalInput(mode === 'rename' && node ? node.title : '');
        setModalOpen(true);
    };

    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
        for (const node of nodes) {
            if (node.id === id) return node;
            const found = findNode(node.children || [], id);
            if (found) return found;
        }
        return null;
    };

    const handleModalConfirm = () => {
        const value = modalInput.trim();
        if (!value) {
            alert('이름을 입력해 주세요.');
            return;
        }

        const nextTree = JSON.parse(JSON.stringify(treeData)) as TreeNode[];

        if (modalMode === 'root') {
            const id = `u-${Date.now()}`;
            nextTree.push({ id, title: value, children: [] });
            setExpandedIds((prev) => new Set(prev).add(id));
        } else if (modalMode === 'child' && targetNode) {
            const parent = findNode(nextTree, targetNode.id);
            if (parent) {
                const id = `u-${Date.now()}`;
                parent.children.push({ id, title: value, children: [] });
                setExpandedIds((prev) => new Set(prev).add(parent.id));
            }
        } else if (modalMode === 'rename' && targetNode) {
            const node = findNode(nextTree, targetNode.id);
            if (node) {
                node.title = value;
                if (selectedNodeId === node.id) {
                    setSelectedNodeTitle(value);
                }
            }
        }

        void saveTree(nextTree);
        setModalOpen(false);
    };

    const handleDeleteNode = (node: TreeNode) => {
        if (!window.confirm(`'${node.title}' 및 하위 내용을 삭제하시겠습니까?`)) return;

        const removeRecursive = (nodes: TreeNode[]): TreeNode[] =>
            nodes
                .filter((n) => n.id !== node.id)
                .map((n) => ({ ...n, children: removeRecursive(n.children || []) }));

        const nextTree = removeRecursive(treeData);
        if (selectedNodeId === node.id) {
            setSelectedNodeId(null);
            setSelectedNodeTitle('');
            setLessonTitle('');
            setLessonVideo('');
            setLessonContent('');
        }
        void saveTree(nextTree);
    };

    const TreeCard = ({ node, level }: { node: TreeNode; level: number }) => {
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedNodeId === node.id;
        const isLeaf = level >= 2;

        return (
            <div style={{ marginLeft: level > 0 ? 16 : 0 }} className="mb-1 select-none">
                <div
                    className={`flex items-center p-2 rounded cursor-pointer transition-colors group ${isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50'}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleNodeClick(node, level);
                    }}
                >
                    <div className="w-6 text-center text-gray-400 mr-1">
                        {!isLeaf && (
                            <i className={`fas fa-caret-${isExpanded ? 'down' : 'right'} transition-transform`}></i>
                        )}
                    </div>
                    <div className="mr-2 text-yellow-500">
                        <i className={`fas ${isLeaf ? 'fa-file-alt text-gray-400' : (isExpanded ? 'fa-folder-open' : 'fa-folder')}`}></i>
                    </div>
                    <span className="flex-1 truncate text-sm">{node.title}</span>

                    <div className="hidden group-hover:flex gap-1 ml-2">
                        {!isLeaf && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openModal('child', node);
                                }}
                                className="text-green-600 hover:bg-green-100 p-1 rounded"
                                title="하위 단원 추가"
                            >
                                <i className="fas fa-plus text-xs"></i>
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                openModal('rename', node);
                            }}
                            className="text-blue-600 hover:bg-blue-100 p-1 rounded"
                            title="이름 변경"
                        >
                            <i className="fas fa-pen text-xs"></i>
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNode(node);
                            }}
                            className="text-red-600 hover:bg-red-100 p-1 rounded"
                            title="삭제"
                        >
                            <i className="fas fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>

                {isExpanded && node.children?.length > 0 && (
                    <div className="border-l border-dashed border-gray-200 ml-3">
                        {node.children.map((child) => (
                            <TreeCard key={child.id} node={child} level={level + 1} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const loadLessonContent = async (unitId: string, title: string) => {
        setLessonTitle(title);
        setLessonVideo('');
        setLessonContent('');

        try {
            const scopedRef = collection(db, getSemesterCollectionPath(config, 'lessons'));
            const scopedQuery = query(scopedRef, where('unitId', '==', unitId), limit(1));
            let snap = await getDocs(scopedQuery);

            if (snap.empty) {
                const legacyRef = collection(db, 'lessons');
                const legacyQuery = query(legacyRef, where('unitId', '==', unitId), limit(1));
                snap = await getDocs(legacyQuery);
            }

            if (!snap.empty) {
                const data = snap.docs[0].data() as LessonData;
                setLessonTitle(data.title || title);
                setLessonVideo(data.videoUrl || '');
                setLessonContent(data.contentHtml || '');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const saveLesson = async () => {
        if (!selectedNodeId) return;

        try {
            const scopedRef = collection(db, getSemesterCollectionPath(config, 'lessons'));
            const scopedQuery = query(scopedRef, where('unitId', '==', selectedNodeId), limit(1));
            const scopedSnap = await getDocs(scopedQuery);

            const payload = {
                unitId: selectedNodeId,
                title: lessonTitle,
                videoUrl: lessonVideo,
                contentHtml: lessonContent,
                updatedAt: serverTimestamp(),
            };

            if (scopedSnap.empty) {
                await addDoc(scopedRef, payload);
            } else {
                await updateDoc(doc(scopedRef, scopedSnap.docs[0].id), payload);
            }

            alert('수업 자료를 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('수업 자료 저장에 실패했습니다.');
        }
    };

    const renderPreviewContent = (html: string) => {
        const parts = html.split(/(\[.*?\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[') && part.endsWith(']')) {
                const answer = part.slice(1, -1);
                return (
                    <input
                        key={i}
                        type="text"
                        readOnly
                        value={`(정답: ${answer})`}
                        className="border-b-2 border-blue-500 text-blue-600 font-bold text-center px-2 py-0.5 mx-1 w-36 bg-transparent"
                    />
                );
            }
            return <span key={i} dangerouslySetInnerHTML={{ __html: part }}></span>;
        });
    };

    const getEmbedUrl = (url: string) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : null;
    };

    return (
        <div className="bg-gray-50 flex flex-col min-h-screen">
            <main className="flex-1 w-full max-w-[90rem] mx-auto px-4 lg:px-6 py-6 h-full flex flex-col relative">
                <div className="flex justify-between items-center mb-4 shrink-0">
                    <h1 className="text-xl lg:text-2xl font-bold text-gray-800">
                        <i className="fas fa-sitemap text-blue-500 mr-2"></i>수업 자료 관리
                    </h1>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 h-full pb-4 relative">
                    {sidebarOpen && (
                        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}></div>
                    )}

                    <div className={`${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 fixed lg:static top-0 right-0 h-full lg:h-auto w-[80%] max-w-[320px] lg:max-w-none lg:w-1/3 bg-white z-50 lg:z-auto shadow-xl lg:shadow-sm border border-gray-200 transition-transform duration-300 flex flex-col min-h-[300px] lg:min-h-0 rounded-none lg:rounded-xl`}>
                        <div className="p-4 border-b bg-gray-50 font-bold text-gray-700 flex justify-between items-center">
                            <span className="flex items-center gap-2"><i className="fas fa-list"></i> 단원 목록</span>
                            <div className="flex gap-1 items-center">
                                <button onClick={() => openModal('root')} className="text-xs bg-stone-800 text-white px-3 py-1.5 rounded hover:bg-stone-900 shadow-sm flex items-center transition">
                                    <i className="fas fa-plus mr-1"></i>추가
                                </button>
                                <button onClick={() => void saveTree(treeData, false)} className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-200 transition font-bold">
                                    저장
                                </button>
                                <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-1 text-gray-400 hover:text-gray-600">
                                    <i className="fas fa-times text-lg"></i>
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {treeData.map((node) => (
                                <TreeCard key={node.id} node={node} level={0} />
                            ))}
                        </div>
                    </div>

                    <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col relative min-h-[600px]">
                        {!selectedNodeId ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-white z-10 rounded-xl p-6 text-center">
                                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                    <i className="far fa-hand-point-left text-4xl lg:block hidden"></i>
                                    <i className="fas fa-list text-3xl lg:hidden text-blue-400"></i>
                                </div>
                                <p className="text-lg font-bold text-gray-600">수업 자료를 선택해 주세요</p>
                                <p className="text-sm mt-2 hidden lg:block">왼쪽 단원 목록에서 <strong>소단원</strong>을 선택하면 내용을 편집할 수 있습니다.</p>
                                <p className="text-sm mt-2 lg:hidden">오른쪽 하단 <strong>목록 버튼</strong>으로 단원을 선택해 주세요.</p>
                            </div>
                        ) : (
                            <>
                                <div className="p-4 border-b flex flex-wrap justify-between items-center bg-gray-50 shrink-0 gap-2">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded font-bold shrink-0">EDIT</span>
                                        <span className="font-bold text-gray-700 truncate max-w-[150px] lg:max-w-none">{selectedNodeTitle}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => setPreviewOpen(true)} className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-bold hover:bg-gray-50 text-xs md:text-sm">
                                            <i className="fas fa-eye md:mr-2"></i><span className="hidden md:inline">미리보기</span>
                                        </button>
                                        <button onClick={() => void saveLesson()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-md text-xs md:text-sm">
                                            <i className="fas fa-save md:mr-2"></i><span className="hidden md:inline">저장</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">자료 제목</label>
                                        <input
                                            type="text"
                                            className="w-full text-lg font-bold border-b-2 border-gray-200 focus:border-blue-500 outline-none py-2 px-1 transition"
                                            value={lessonTitle}
                                            onChange={(e) => setLessonTitle(e.target.value)}
                                            placeholder="제목을 입력해 주세요"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">YouTube 영상 링크 (선택)</label>
                                        <input
                                            type="text"
                                            className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 focus:bg-white transition"
                                            value={lessonVideo}
                                            onChange={(e) => setLessonVideo(e.target.value)}
                                            placeholder="https://youtu.be/..."
                                        />
                                    </div>

                                    <div className="flex-1 flex flex-col h-full min-h-[400px]">
                                        <label className="block text-xs font-bold text-gray-500 mb-1 flex justify-between">
                                            <span>학습 내용</span>
                                            <span className="text-blue-600 text-[10px]">빈칸 표기: [정답]</span>
                                        </label>
                                        <QuillEditor
                                            value={lessonContent}
                                            onChange={setLessonContent}
                                            placeholder="여기에 수업 내용을 작성하세요. 빈칸 문제는 [정답] 형식을 사용하세요."
                                            minHeight={460}
                                            toolbar={[
                                                [{ header: [1, 2, 3, false] }],
                                                ['bold', 'italic', 'underline', 'strike'],
                                                [{ color: [] }, { background: [] }],
                                                [{ list: 'ordered' }, { list: 'bullet' }],
                                                ['link', 'image'],
                                                ['clean'],
                                            ]}
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <button className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg z-30 lg:hidden" onClick={() => setSidebarOpen(true)}>
                    <i className="fas fa-list text-lg"></i>
                </button>
            </main>

            {modalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
                        <h3 className="font-bold text-lg text-gray-800 mb-4">
                            {modalMode === 'root' ? '새 대단원 추가' : modalMode === 'child' ? '하위 단원 추가' : '이름 변경'}
                        </h3>
                        <input
                            type="text"
                            autoFocus
                            className="w-full border-2 border-gray-200 rounded-lg p-3 text-lg font-bold focus:border-blue-500 outline-none mb-6"
                            placeholder="이름 입력"
                            value={modalInput}
                            onChange={(e) => setModalInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleModalConfirm()}
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg">취소</button>
                            <button onClick={handleModalConfirm} className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">확인</button>
                        </div>
                    </div>
                </div>
            )}

            {previewOpen && (
                <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewOpen(false)}>
                    <div className="bg-white w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-lg"><i className="fas fa-mobile-alt mr-2"></i>학생 화면 미리보기</h3>
                            <button onClick={() => setPreviewOpen(false)} className="text-gray-500 hover:text-gray-800"><i className="fas fa-times text-xl"></i></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-gray-50">
                            <div className="max-w-2xl mx-auto bg-white p-6 lg:p-8 rounded-xl shadow-sm border border-gray-200 min-h-full">
                                <h1 className="text-2xl font-bold mb-4 text-gray-900 border-b pb-4">{lessonTitle}</h1>

                                {lessonVideo && getEmbedUrl(lessonVideo) && (
                                    <div className="mb-6">
                                        <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-xl bg-black">
                                            <iframe
                                                src={getEmbedUrl(lessonVideo)!}
                                                className="absolute top-0 left-0 w-full h-full"
                                                frameBorder="0"
                                                allowFullScreen
                                            ></iframe>
                                        </div>
                                    </div>
                                )}

                                <div className="prose max-w-none text-gray-800 leading-loose">
                                    {renderPreviewContent(lessonContent)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageLesson;
