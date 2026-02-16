import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Header from '../../components/common/Header';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, setDoc, getDocs, addDoc, updateDoc, serverTimestamp, query, where, limit } from 'firebase/firestore';

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

const ManageLesson = () => {
    const { user } = useAuth();
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeTitle, setSelectedNodeTitle] = useState<string>("");
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Editor State
    const [lessonTitle, setLessonTitle] = useState("");
    const [lessonVideo, setLessonVideo] = useState("");
    const [lessonContent, setLessonContent] = useState(""); // Using textarea for now

    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'root' | 'child' | 'rename' | null>(null);
    const [targetNode, setTargetNode] = useState<TreeNode | null>(null);
    const [modalInput, setModalInput] = useState("");

    // Preview
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        loadTree();
    }, []);

    const loadTree = async () => {
        try {
            // Path: curriculum/tree (Global or Semester based? The original code tried both. We'll use global for simplicity or stick to current semester if intended.)
            // Original code: window.getCollection('curriculum').doc('tree') -> checks current config
            // For now, let's assume it is global or hardcoded to a collection for simplicity, or we check config.
            // Let's us 'curriculum' collection in root for now as per original code fallback

            const docRef = doc(db, 'curriculum', 'tree');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists() && docSnap.data().tree) {
                setTreeData(docSnap.data().tree);
            } else {
                setTreeData([{ id: 'root-' + Date.now(), title: '새 대단원', children: [] }]);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const saveTree = async (newData: TreeNode[]) => {
        try {
            await setDoc(doc(db, 'curriculum', 'tree'), {
                tree: newData,
                updatedAt: serverTimestamp()
            });
            setTreeData(newData);
        } catch (e) {
            alert("구조 저장 실패");
        }
    };

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedIds(newSet);
    };

    const handleNodeClick = (node: TreeNode, level: number) => {
        if (level < 2) {
            toggleExpand(node.id);
        } else {
            // Select Leaf
            setSelectedNodeId(node.id);
            setSelectedNodeTitle(node.title);
            loadLessonContent(node.id, node.title);
        }
    };

    // --- Tree Manipulation ---
    const openModal = (mode: 'root' | 'child' | 'rename', node: TreeNode | null = null) => {
        setModalMode(mode);
        setTargetNode(node);
        setModalInput(mode === 'rename' && node ? node.title : '');
        setModalOpen(true);
    };

    const handleModalConfirm = () => {
        if (!modalInput.trim()) return;
        const newTree = JSON.parse(JSON.stringify(treeData)); // Deep copy

        const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
            for (const n of nodes) {
                if (n.id === id) return n;
                if (n.children) {
                    const found = findNode(n.children, id);
                    if (found) return found;
                }
            }
            return null;
        };

        if (modalMode === 'root') {
            newTree.push({ id: 'u-' + Date.now(), title: modalInput, children: [] });
        } else if (modalMode === 'child' && targetNode) {
            const parent = findNode(newTree, targetNode.id);
            if (parent) {
                if (!parent.children) parent.children = [];
                parent.children.push({ id: 'u-' + Date.now(), title: modalInput, children: [] });
                setExpandedIds(new Set(expandedIds).add(parent.id));
            }
        } else if (modalMode === 'rename' && targetNode) {
            const node = findNode(newTree, targetNode.id);
            if (node) {
                node.title = modalInput;
                if (selectedNodeId === node.id) setSelectedNodeTitle(modalInput);
            }
        }

        saveTree(newTree);
        setModalOpen(false);
    };

    const handleDeleteNode = (node: TreeNode, parentArr: TreeNode[]) => {
        if (!window.confirm(`'${node.title}' 및 하위 내용을 삭제하시겠습니까?`)) return;

        // Recursive delete in local state
        // We need to find parent array in the real tree data
        // Easier to just traverse and filter
        const deleteFromTree = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.filter(n => {
                if (n.id === node.id) return false;
                if (n.children) n.children = deleteFromTree(n.children);
                return true;
            });
        };

        const newTree = deleteFromTree(treeData);
        if (selectedNodeId === node.id) setSelectedNodeId(null);
        saveTree(newTree);
    };

    const Card = ({ node, level, parentArr }: { node: TreeNode, level: number, parentArr: TreeNode[] }) => {
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedNodeId === node.id;
        const isLeaf = level >= 2;

        return (
            <div className={`ml-${level * 4} mb-1 select-none`}>
                <div
                    className={`flex items-center p-2 rounded cursor-pointer transition-colors group ${isSelected ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50'}`}
                    onClick={(e) => { e.stopPropagation(); handleNodeClick(node, level); }}
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
                                onClick={(e) => { e.stopPropagation(); openModal('child', node); }}
                                className="text-green-600 hover:bg-green-100 p-1 rounded"
                                title="하위 단원 추가"
                            >
                                <i className="fas fa-plus text-xs"></i>
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); openModal('rename', node); }}
                            className="text-blue-600 hover:bg-blue-100 p-1 rounded"
                            title="이름 변경"
                        >
                            <i className="fas fa-pen text-xs"></i>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteNode(node, parentArr); }}
                            className="text-red-600 hover:bg-red-100 p-1 rounded"
                            title="삭제"
                        >
                            <i className="fas fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
                {isExpanded && node.children && (
                    <div className="border-l border-dashed border-gray-200 ml-3">
                        {node.children.map(child => (
                            <Card key={child.id} node={child} level={level + 1} parentArr={node.children} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // --- Content Editor ---
    const loadLessonContent = async (unitId: string, title: string) => {
        setLessonTitle(title);
        setLessonVideo("");
        setLessonContent("");

        try {
            const lessonsRef = collection(db, 'lessons');
            const q = query(lessonsRef, where('unitId', '==', unitId), limit(1));
            const snap = await getDocs(q);

            if (!snap.empty) {
                const d = snap.docs[0].data() as LessonData;
                setLessonTitle(d.title);
                setLessonVideo(d.videoUrl || "");
                setLessonContent(d.contentHtml || "");
            }
        } catch (e) {
            console.error(e);
        }
    };

    const saveLesson = async () => {
        if (!selectedNodeId) return;

        try {
            const lessonsRef = collection(db, 'lessons');
            const q = query(lessonsRef, where('unitId', '==', selectedNodeId), limit(1));
            const snap = await getDocs(q);

            const data = {
                unitId: selectedNodeId,
                title: lessonTitle,
                videoUrl: lessonVideo,
                contentHtml: lessonContent,
                updatedAt: serverTimestamp()
            };

            if (snap.empty) {
                await addDoc(lessonsRef, data);
            } else {
                await updateDoc(doc(lessonsRef, snap.docs[0].id), { ...data });
            }
            alert("저장되었습니다.");
        } catch (e) {
            alert("저장 실패");
        }
    };

    const handlePreview = () => {
        setPreviewOpen(true);
    };

    // Helper to render cloze inputs in preview
    const renderPreviewContent = (html: string) => {
        // Simple replacement of [ans] -> input
        // React's dangerouslySetInnerHTML is okay here for admin content, but we need to inject inputs.
        // A safer way: split and map
        const parts = html.split(/(\[.*?\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[') && part.endsWith(']')) {
                const ans = part.slice(1, -1);
                return (
                    <input
                        key={i}
                        type="text"
                        readOnly
                        value={`정답: ${ans}`}
                        className="border-b-2 border-blue-500 text-blue-600 font-bold text-center px-2 py-0.5 mx-1 w-32 bg-transparent"
                    />
                );
            }
            return <span key={i} dangerouslySetInnerHTML={{ __html: part }}></span>;
        });
    };

    // Video Embed Helper
    const getEmbedUrl = (url: string) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}` : null;
    };


    return (
        <div className="bg-gray-50 flex flex-col min-h-screen">
            <Header />
            <main className="flex-1 w-full max-w-[90rem] mx-auto px-4 lg:px-6 py-6 h-full flex flex-col">
                <div className="flex justify-between items-center mb-4 shrink-0">
                    <h1 className="text-xl lg:text-2xl font-bold text-gray-800"><i className="fas fa-sitemap text-blue-500 mr-2"></i>수업 자료 관리</h1>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 h-full pb-4">
                    {/* Sidebar */}
                    <div className="w-full lg:w-1/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[400px]">
                        <div className="p-4 border-b bg-gray-50 font-bold text-gray-700 flex justify-between items-center">
                            <span className="flex items-center gap-2"><i className="fas fa-list"></i> 단원 목차</span>
                            <button
                                onClick={() => openModal('root')}
                                className="text-xs bg-stone-800 text-white px-3 py-1.5 rounded hover:bg-stone-900 shadow-sm flex items-center transition"
                            >
                                <i className="fas fa-plus mr-1"></i>추가
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {treeData.map(node => (
                                <Card key={node.id} node={node} level={0} parentArr={treeData} />
                            ))}
                        </div>
                    </div>

                    {/* Editor */}
                    <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col relative min-h-[600px]">
                        {!selectedNodeId ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                <i className="far fa-hand-point-left text-4xl mb-4 lg:block hidden"></i>
                                <p className="text-lg font-bold">수업 자료를 선택해주세요</p>
                                <p className="text-sm mt-2">왼쪽 목차에서 <strong>소단원</strong>을 선택하세요.</p>
                            </div>
                        ) : (
                            <>
                                <div className="p-4 border-b flex justify-between items-center bg-gray-50 shrink-0">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded font-bold">EDIT</span>
                                        <span className="font-bold text-gray-700 truncate">{selectedNodeTitle}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={handlePreview} className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-bold hover:bg-gray-50 text-xs md:text-sm">
                                            미리보기
                                        </button>
                                        <button onClick={saveLesson} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-md text-xs md:text-sm">
                                            저장
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
                                            onChange={e => setLessonTitle(e.target.value)}
                                            placeholder="제목을 입력하세요"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">YouTube 영상 링크 (선택)</label>
                                        <input
                                            type="text"
                                            className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 focus:bg-white transition"
                                            value={lessonVideo}
                                            onChange={e => setLessonVideo(e.target.value)}
                                            placeholder="https://youtu.be/..."
                                        />
                                    </div>
                                    <div className="flex-1 flex flex-col h-full min-h-[400px]">
                                        <label className="block text-xs font-bold text-gray-500 mb-1 flex justify-between">
                                            <span>학습 내용 (HTML)</span>
                                            <span className="text-blue-600 text-[10px]">빈칸: [정답]</span>
                                        </label>
                                        <textarea
                                            className="w-full flex-1 border rounded-lg p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={lessonContent}
                                            onChange={e => setLessonContent(e.target.value)}
                                            placeholder="<div>학습 내용을 HTML로 작성하세요...</div>"
                                        ></textarea>
                                        <p className="text-xs text-gray-400 mt-1">* 현재 Rich Text Editor(Quill) 라이브러리 부재로 HTML 직접 입력 모드입니다.</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </main>

            {/* Tree Name Modal */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
                        <h3 className="font-bold text-lg text-gray-800 mb-4">
                            {modalMode === 'root' ? "새 대단원 추가" : (modalMode === 'child' ? "하위 단원 추가" : "이름 변경")}
                        </h3>
                        <input
                            type="text"
                            autoFocus
                            className="w-full border-2 border-gray-200 rounded-lg p-3 text-lg font-bold focus:border-blue-500 outline-none mb-6"
                            placeholder="이름 입력"
                            value={modalInput}
                            onChange={e => setModalInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleModalConfirm()}
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg">취소</button>
                            <button onClick={handleModalConfirm} className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">확인</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {previewOpen && (
                <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewOpen(false)}>
                    <div className="bg-white w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative" onClick={e => e.stopPropagation()}>
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
