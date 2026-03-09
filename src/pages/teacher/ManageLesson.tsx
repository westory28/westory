import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../lib/firebase';
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
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import QuillEditor from '../../components/common/QuillEditor';
import LessonWorksheetStage from '../../components/common/LessonWorksheetStage';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../lib/semesterScope';
import { processPdfMapFile, type ProcessedPdfMap } from '../../lib/pdfMapProcessor';
import {
    clampRatio,
    normalizeWorksheetBlanks,
    type LessonWorksheetBlank,
    type LessonWorksheetPageImage,
    type LessonWorksheetTextRegion,
} from '../../lib/lessonWorksheet';

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
    isVisibleToStudents?: boolean;
    pdfName?: string;
    pdfUrl?: string;
    pdfStoragePath?: string;
    worksheetPageImages?: LessonWorksheetPageImage[];
    worksheetTextRegions?: LessonWorksheetTextRegion[];
    worksheetBlanks?: LessonWorksheetBlank[];
}

const createBlankFromRect = (page: number, rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
}): LessonWorksheetBlank => ({
    id: `blank-${page}-${Date.now()}`,
    page,
    leftRatio: rect.leftRatio,
    topRatio: rect.topRatio,
    widthRatio: rect.widthRatio,
    heightRatio: rect.heightRatio,
    answer: '',
    prompt: '',
});

const DEFAULT_BLANK_WIDTH_RATIO = 0.16;
const DEFAULT_BLANK_HEIGHT_RATIO = 0.045;

const createBlankFromPoint = (page: number, point: { x: number; y: number }): LessonWorksheetBlank => {
    const widthRatio = DEFAULT_BLANK_WIDTH_RATIO;
    const heightRatio = DEFAULT_BLANK_HEIGHT_RATIO;
    const leftRatio = clampRatio(Math.min(point.x - widthRatio / 2, 1 - widthRatio));
    const topRatio = clampRatio(Math.min(point.y - heightRatio / 2, 1 - heightRatio));

    return createBlankFromRect(page, {
        leftRatio: Math.max(0, leftRatio),
        topRatio: Math.max(0, topRatio),
        widthRatio,
        heightRatio,
    });
};

const getBlankAnswerFromRegions = (regions: LessonWorksheetTextRegion[]) => regions
    .map((region) => String(region.label || '').trim())
    .filter(Boolean)
    .join(' ');

const normalizePageImages = (raw: unknown): LessonWorksheetPageImage[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((page) => ({
            page: Math.max(1, Number(page && typeof page === 'object' && 'page' in page ? (page as { page?: number }).page : 1) || 1),
            imageUrl: String(page && typeof page === 'object' && 'imageUrl' in page ? (page as { imageUrl?: string }).imageUrl : '').trim(),
            width: Number(page && typeof page === 'object' && 'width' in page ? (page as { width?: number }).width : 0) || 0,
            height: Number(page && typeof page === 'object' && 'height' in page ? (page as { height?: number }).height : 0) || 0,
        }))
        .filter((page) => page.imageUrl)
        .sort((a, b) => a.page - b.page);
};

const normalizeTextRegions = (raw: unknown): LessonWorksheetTextRegion[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((region) => ({
            label: String(region && typeof region === 'object' && 'label' in region ? (region as { label?: string }).label : '').trim(),
            page: Math.max(1, Number(region && typeof region === 'object' && 'page' in region ? (region as { page?: number }).page : 1) || 1),
            left: Number(region && typeof region === 'object' && 'left' in region ? (region as { left?: number }).left : 0) || 0,
            top: Number(region && typeof region === 'object' && 'top' in region ? (region as { top?: number }).top : 0) || 0,
            width: Number(region && typeof region === 'object' && 'width' in region ? (region as { width?: number }).width : 0) || 0,
            height: Number(region && typeof region === 'object' && 'height' in region ? (region as { height?: number }).height : 0) || 0,
        }))
        .filter((region) => region.width > 0 && region.height > 0);
};

const revokeBlobUrls = (pages: LessonWorksheetPageImage[]) => {
    pages.forEach((page) => {
        if (page.imageUrl.startsWith('blob:')) {
            URL.revokeObjectURL(page.imageUrl);
        }
    });
};

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
    const [lessonVisibleToStudents, setLessonVisibleToStudents] = useState(true);
    const [lessonPdfName, setLessonPdfName] = useState('');
    const [lessonPdfUrl, setLessonPdfUrl] = useState('');
    const [lessonPdfStoragePath, setLessonPdfStoragePath] = useState('');
    const [worksheetPageImages, setWorksheetPageImages] = useState<LessonWorksheetPageImage[]>([]);
    const [worksheetTextRegions, setWorksheetTextRegions] = useState<LessonWorksheetTextRegion[]>([]);
    const [worksheetBlanks, setWorksheetBlanks] = useState<LessonWorksheetBlank[]>([]);
    const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
    const [preparedPdf, setPreparedPdf] = useState<ProcessedPdfMap | null>(null);
    const [activeBlankId, setActiveBlankId] = useState<string | null>(null);
    const [draftBlank, setDraftBlank] = useState<LessonWorksheetBlank | null>(null);
    const [draftBlankAnswer, setDraftBlankAnswer] = useState('');
    const [draftBlankPrompt, setDraftBlankPrompt] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'root' | 'child' | 'rename' | null>(null);
    const [targetNode, setTargetNode] = useState<TreeNode | null>(null);
    const [modalInput, setModalInput] = useState('');
    const [previewOpen, setPreviewOpen] = useState(false);

    const selectedBlank = useMemo(
        () => worksheetBlanks.find((blank) => blank.id === activeBlankId) || null,
        [activeBlankId, worksheetBlanks],
    );

    const sortedBlanks = useMemo(
        () => [...worksheetBlanks].sort((a, b) => (a.page - b.page) || a.topRatio - b.topRatio || a.leftRatio - b.leftRatio),
        [worksheetBlanks],
    );

    useEffect(() => {
        void loadTree();
    }, [config]);

    useEffect(() => () => {
        revokeBlobUrls(worksheetPageImages);
    }, [worksheetPageImages]);

    const resetWorksheetState = (revokeExisting = false) => {
        if (revokeExisting) {
            revokeBlobUrls(worksheetPageImages);
        }
        setLessonPdfName('');
        setLessonPdfUrl('');
        setLessonPdfStoragePath('');
        setWorksheetPageImages([]);
        setWorksheetTextRegions([]);
        setWorksheetBlanks([]);
        setPreparedPdf(null);
        setSelectedPdfFile(null);
        setActiveBlankId(null);
        setDraftBlank(null);
        setDraftBlankAnswer('');
        setDraftBlankPrompt('');
    };

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
            if (!silent) alert('단원 구조를 저장했습니다.');
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
                if (selectedNodeId === node.id) setSelectedNodeTitle(value);
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
            setLessonVisibleToStudents(true);
            resetWorksheetState(true);
        }
        void saveTree(nextTree);
    };

    const TreeCard = ({ node, level }: { node: TreeNode; level: number }) => {
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedNodeId === node.id;
        const isLeaf = level >= 2;
        const canManageUnit = level <= 1;

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
                        {!isLeaf && <i className={`fas fa-caret-${isExpanded ? 'down' : 'right'} transition-transform`}></i>}
                    </div>
                    <div className="mr-2 text-yellow-500">
                        <i className={`fas ${isLeaf ? 'fa-file-alt text-gray-400' : (isExpanded ? 'fa-folder-open' : 'fa-folder')}`}></i>
                    </div>
                    <span className="flex-1 truncate text-sm">{node.title}</span>

                    {canManageUnit && (
                        <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
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
                                title="단원명 수정"
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
                    )}
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
        setLessonVisibleToStudents(true);
        resetWorksheetState(true);

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
                setLessonVisibleToStudents(data.isVisibleToStudents !== false);
                setLessonPdfName(data.pdfName || '');
                setLessonPdfUrl(data.pdfUrl || '');
                setLessonPdfStoragePath(data.pdfStoragePath || '');
                setWorksheetPageImages(normalizePageImages(data.worksheetPageImages));
                setWorksheetTextRegions(normalizeTextRegions(data.worksheetTextRegions));
                setWorksheetBlanks(normalizeWorksheetBlanks(data.worksheetBlanks));
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handlePdfFileChange = (file: File | null) => {
        if (!file) {
            setSelectedPdfFile(null);
            setPreparedPdf(null);
            return;
        }

        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('PDF 파일만 업로드할 수 있습니다.');
            return;
        }

        setSelectedPdfFile(file);
    };

    const handlePreparePdf = async () => {
        if (!selectedPdfFile) {
            alert('먼저 PDF 파일을 선택해 주세요.');
            return;
        }

        setPdfBusy(true);
        try {
            const processed = await processPdfMapFile(selectedPdfFile);
            const nextPageImages = processed.pageImages.map((page) => ({
                page: page.page,
                imageUrl: URL.createObjectURL(page.blob),
                width: page.width,
                height: page.height,
            }));

            revokeBlobUrls(worksheetPageImages);
            setPreparedPdf(processed);
            setLessonPdfName(selectedPdfFile.name);
            setWorksheetPageImages(nextPageImages);
            setWorksheetTextRegions(processed.regions);
            setWorksheetBlanks([]);
            setActiveBlankId(null);
            setDraftBlank(null);
            setDraftBlankAnswer('');
            setDraftBlankPrompt('');
        } catch (error) {
            console.error(error);
            alert('PDF 레이아웃 준비에 실패했습니다.');
        } finally {
            setPdfBusy(false);
        }
    };

    const handleCreateBlankAtPoint = (page: number, point: { x: number; y: number }) => {
        const blank = createBlankFromPoint(page, point);
        setDraftBlank(blank);
        setDraftBlankAnswer('');
        setDraftBlankPrompt('');
        setActiveBlankId(null);
    };

    const handleCreateBlankFromSelection = (page: number, rect: {
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
    }, matchedRegions: LessonWorksheetTextRegion[]) => {
        const blank = createBlankFromRect(page, rect);
        const autoAnswer = getBlankAnswerFromRegions(matchedRegions);

        setDraftBlank(blank);
        setDraftBlankAnswer(autoAnswer);
        setDraftBlankPrompt('');
        setActiveBlankId(null);
    };

    const handleConfirmDraftBlank = () => {
        if (!draftBlank) return;

        const answer = draftBlankAnswer.trim();
        if (!answer) {
            alert('빈칸 정답을 입력한 뒤 확인해 주세요.');
            return;
        }

        const nextBlank = {
            ...draftBlank,
            answer,
            prompt: draftBlankPrompt.trim(),
        };

        setWorksheetBlanks((prev) => [...prev, nextBlank]);
        setActiveBlankId(nextBlank.id);
        setDraftBlank(null);
        setDraftBlankAnswer('');
        setDraftBlankPrompt('');
    };

    const handleCancelDraftBlank = () => {
        setDraftBlank(null);
        setDraftBlankAnswer('');
        setDraftBlankPrompt('');
    };

    const handleSelectBlank = (blankId: string) => {
        setActiveBlankId(blankId);
        setDraftBlank(null);
        setDraftBlankAnswer('');
        setDraftBlankPrompt('');
    };

    const updateBlank = (blankId: string, patch: Partial<LessonWorksheetBlank>) => {
        setWorksheetBlanks((prev) => prev.map((blank) => (
            blank.id === blankId ? { ...blank, ...patch } : blank
        )));
    };

    const handleDeleteBlank = (blankId: string) => {
        setWorksheetBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
        if (activeBlankId === blankId) setActiveBlankId(null);
    };

    const removeAttachedPdf = async () => {
        if (!selectedNodeId) {
            resetWorksheetState(true);
            return;
        }

        if (!window.confirm('연결된 PDF 학습지를 해제하시겠습니까?')) return;

        try {
            const basePath = `${getSemesterCollectionPath(config, 'lesson_pdfs')}/${selectedNodeId}`;
            const folderRef = ref(storage, basePath);
            const listing = await listAll(folderRef);
            await Promise.all(listing.items.map((item) => deleteObject(item).catch(() => undefined)));
        } catch (error) {
            console.error('Failed to delete lesson pdf assets:', error);
        }

        resetWorksheetState(true);
    };

    const uploadWorksheetAssets = async (unitId: string) => {
        if (!selectedPdfFile || !preparedPdf) {
            return {
                pdfName: lessonPdfName,
                pdfUrl: lessonPdfUrl,
                pdfStoragePath: lessonPdfStoragePath,
                pageImages: worksheetPageImages,
                textRegions: worksheetTextRegions,
            };
        }

        const basePath = `${getSemesterCollectionPath(config, 'lesson_pdfs')}/${unitId}`;
        const pdfRef = ref(storage, `${basePath}/source.pdf`);
        await uploadBytes(pdfRef, selectedPdfFile, {
            contentType: 'application/pdf',
        });

        const pageImages: LessonWorksheetPageImage[] = [];
        for (const page of preparedPdf.pageImages) {
            const pageRef = ref(storage, `${basePath}/page-${page.page}.png`);
            await uploadBytes(pageRef, page.blob, {
                contentType: 'image/png',
            });
            pageImages.push({
                page: page.page,
                imageUrl: await getDownloadURL(pageRef),
                width: page.width,
                height: page.height,
            });
        }

        return {
            pdfName: selectedPdfFile.name,
            pdfUrl: await getDownloadURL(pdfRef),
            pdfStoragePath: pdfRef.fullPath,
            pageImages,
            textRegions: preparedPdf.regions,
        };
    };

    const saveLesson = async () => {
        if (!selectedNodeId) return;

        try {
            const scopedRef = collection(db, getSemesterCollectionPath(config, 'lessons'));
            const scopedQuery = query(scopedRef, where('unitId', '==', selectedNodeId), limit(1));
            const scopedSnap = await getDocs(scopedQuery);
            const normalizedContentHtml = lessonContent.replace(/(^|>)([ \t]+)(?=\S)/gm, (_match, prefix: string, spaces: string) => {
                const preserved = spaces.replace(/\t/g, '    ').replace(/ /g, '&nbsp;');
                return `${prefix}${preserved}`;
            });

            const uploadedWorksheet = await uploadWorksheetAssets(selectedNodeId);

            const payload = {
                unitId: selectedNodeId,
                title: lessonTitle,
                videoUrl: lessonVideo,
                contentHtml: normalizedContentHtml,
                isVisibleToStudents: lessonVisibleToStudents,
                pdfName: uploadedWorksheet.pdfName,
                pdfUrl: uploadedWorksheet.pdfUrl,
                pdfStoragePath: uploadedWorksheet.pdfStoragePath,
                worksheetPageImages: uploadedWorksheet.pageImages,
                worksheetTextRegions: uploadedWorksheet.textRegions,
                worksheetBlanks: worksheetBlanks,
                updatedAt: serverTimestamp(),
            };

            if (scopedSnap.empty) {
                await addDoc(scopedRef, payload);
            } else {
                await updateDoc(doc(scopedRef, scopedSnap.docs[0].id), payload);
            }

            setLessonPdfName(uploadedWorksheet.pdfName || '');
            setLessonPdfUrl(uploadedWorksheet.pdfUrl || '');
            setLessonPdfStoragePath(uploadedWorksheet.pdfStoragePath || '');
            setWorksheetPageImages(uploadedWorksheet.pageImages || []);
            setWorksheetTextRegions(uploadedWorksheet.textRegions || []);
            setPreparedPdf(null);
            setSelectedPdfFile(null);
            alert('수업 자료를 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('수업 자료 저장에 실패했습니다.');
        }
    };

    const getEmbedUrl = (url: string) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : null;
    };

    return (
        <div className="bg-gray-50 flex flex-col min-h-screen">
            <main className="flex-1 w-full px-4 lg:px-6 xl:px-8 py-6 h-full flex flex-col relative">
                <div className="flex justify-between items-center mb-4 shrink-0">
                    <h1 className="text-xl lg:text-2xl font-bold text-gray-800">
                        <i className="fas fa-sitemap text-blue-500 mr-2"></i>수업 자료 관리
                    </h1>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 h-full pb-4 relative">
                    {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}></div>}

                    <div className={`${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 fixed lg:static top-0 right-0 h-full lg:h-auto w-[85%] max-w-[380px] lg:w-[380px] lg:flex-none bg-white z-50 lg:z-auto shadow-xl lg:shadow-sm border border-gray-200 transition-transform duration-300 flex flex-col min-h-[300px] lg:min-h-0 rounded-none lg:rounded-xl`}>
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
                            {treeData.map((node) => <TreeCard key={node.id} node={node} level={0} />)}
                        </div>
                    </div>

                    <div className="min-w-0 flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col relative min-h-[600px]">
                        {!selectedNodeId ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-white z-10 rounded-xl p-6 text-center">
                                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                    <i className="fas fa-list text-4xl lg:block hidden text-blue-400"></i>
                                    <i className="fas fa-list text-3xl lg:hidden text-blue-400"></i>
                                </div>
                                <p className="text-lg font-bold text-gray-600">수업 자료를 선택해 주세요</p>
                                <p className="text-sm mt-2 hidden lg:block">단원 목록에서 <strong>소단원</strong>을 선택하면 내용을 편집할 수 있습니다.</p>
                                <p className="text-sm mt-2 lg:hidden">오른쪽 하단 <strong>목록 버튼</strong>으로 단원을 선택해 주세요.</p>
                            </div>
                        ) : (
                            <>
                                <div className="p-4 border-b flex flex-wrap justify-between items-center bg-gray-50 shrink-0 gap-2">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded font-bold shrink-0">EDIT</span>
                                        <span className="font-bold text-gray-700 truncate max-w-[150px] lg:max-w-none">{selectedNodeTitle}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <label className="inline-flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs md:text-sm font-bold text-gray-700">
                                            <span className={lessonVisibleToStudents ? 'text-emerald-600' : 'text-gray-400'}>학생 공개</span>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={lessonVisibleToStudents}
                                                onClick={() => setLessonVisibleToStudents((prev) => !prev)}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${lessonVisibleToStudents ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${lessonVisibleToStudents ? 'translate-x-5' : 'translate-x-1'}`} />
                                            </button>
                                        </label>
                                        <button onClick={() => setPreviewOpen(true)} className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg font-bold hover:bg-gray-50 text-xs md:text-sm">
                                            <i className="fas fa-eye mr-2"></i><span>미리보기</span>
                                        </button>
                                        <button onClick={() => void saveLesson()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-md text-xs md:text-sm">
                                            <i className="fas fa-save mr-2"></i><span>저장</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5">
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

                                    <div className="rounded-3xl border border-gray-200 bg-gray-50/80 p-4 md:p-5 space-y-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <div className="text-xs font-bold text-gray-500">PDF 학습지</div>
                                                <p className="mt-1 text-sm text-gray-500">원본 PDF 모양을 유지한 채 좌표형 빈칸을 올립니다. 지도처럼 페이지 이미지 위에 배치됩니다.</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <label className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white border border-gray-300 text-sm font-bold text-gray-700 cursor-pointer hover:bg-gray-100">
                                                    <i className="fas fa-file-pdf mr-2 text-red-500"></i>PDF 선택
                                                    <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => handlePdfFileChange(e.target.files?.[0] || null)} />
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => void handlePreparePdf()}
                                                    disabled={pdfBusy || !selectedPdfFile}
                                                    className="px-4 py-2 rounded-lg bg-stone-900 text-white text-sm font-bold disabled:opacity-50"
                                                >
                                                    <i className={`fas ${pdfBusy ? 'fa-spinner fa-spin' : 'fa-layer-group'} mr-2`}></i>레이아웃 불러오기
                                                </button>
                                                {(lessonPdfUrl || selectedPdfFile || worksheetPageImages.length > 0) && (
                                                    <button type="button" onClick={() => void removeAttachedPdf()} className="px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm font-bold">
                                                        PDF 해제
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="text-sm text-gray-600 space-y-1">
                                            {selectedPdfFile && <p>선택 파일: <span className="font-semibold">{selectedPdfFile.name}</span></p>}
                                            {!selectedPdfFile && lessonPdfName && <p>저장된 PDF: <span className="font-semibold">{lessonPdfName}</span></p>}
                                            {lessonPdfUrl && (
                                                <a href={lessonPdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-blue-600 font-semibold hover:underline">
                                                    <i className="fas fa-file-pdf mr-2"></i>원본 PDF 열기
                                                </a>
                                            )}
                                        </div>

                                        {worksheetPageImages.length > 0 ? (
                                            <div className="grid gap-5">
                                                <div className="min-w-0 order-2">
                                                    <LessonWorksheetStage
                                                        pageImages={worksheetPageImages}
                                                        blanks={worksheetBlanks}
                                                        textRegions={worksheetTextRegions}
                                                        mode="teacher"
                                                        selectedBlankId={activeBlankId}
                                                        pendingBlank={draftBlank}
                                                        onSelectBlank={handleSelectBlank}
                                                        onCreateBlankAtPoint={handleCreateBlankAtPoint}
                                                        onCreateBlankFromSelection={handleCreateBlankFromSelection}
                                                    />
                                                </div>

                                                <aside className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4 h-fit order-1">
                                                    <div>
                                                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">Blank List</div>
                                                        <p className="mt-1 text-sm text-gray-500">OCR 박스나 페이지 어디든 클릭하면 빈칸 초안이 생깁니다. 정답을 쓴 뒤 정답 확인으로 확정하세요.</p>
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-3 text-center">
                                                        <div className="rounded-xl bg-gray-50 px-3 py-2">
                                                            <div className="text-[11px] text-gray-400">페이지</div>
                                                            <div className="mt-1 font-bold text-gray-700">{worksheetPageImages.length}</div>
                                                        </div>
                                                        <div className="rounded-xl bg-gray-50 px-3 py-2">
                                                            <div className="text-[11px] text-gray-400">OCR 박스</div>
                                                            <div className="mt-1 font-bold text-gray-700">{worksheetTextRegions.length}</div>
                                                        </div>
                                                        <div className="rounded-xl bg-gray-50 px-3 py-2">
                                                            <div className="text-[11px] text-gray-400">빈칸</div>
                                                            <div className="mt-1 font-bold text-gray-700">{worksheetBlanks.length}</div>
                                                        </div>
                                                    </div>

                                                    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
                                                        {draftBlank ? (
                                                            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div className="text-sm font-bold text-amber-900">? ?? ??</div>
                                                                    <button type="button" onClick={handleCancelDraftBlank} className="text-xs font-bold text-gray-500">
                                                                        ??
                                                                    </button>
                                                                </div>
                                                                <div className="text-xs text-gray-500">p.{draftBlank.page} ??? ? ??? ??? ????.</div>
                                                                <input
                                                                    type="text"
                                                                    value={draftBlankAnswer}
                                                                    onChange={(e) => setDraftBlankAnswer(e.target.value)}
                                                                    className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
                                                                    placeholder="??? ?????"
                                                                    autoFocus
                                                                />
                                                                <input
                                                                    type="text"
                                                                    value={draftBlankPrompt}
                                                                    onChange={(e) => setDraftBlankPrompt(e.target.value)}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                    placeholder="?? ?? ?? (??)"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={handleConfirmDraftBlank}
                                                                    className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600"
                                                                >
                                                                    ?? ??
                                                                </button>
                                                            </div>
                                                        ) : selectedBlank ? (
                                                            <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div className="text-sm font-bold text-blue-900">??? ??</div>
                                                                    <button type="button" onClick={() => handleDeleteBlank(selectedBlank.id)} className="text-xs font-bold text-red-600">
                                                                        ??
                                                                    </button>
                                                                </div>
                                                                <div className="text-xs text-gray-500">p.{selectedBlank.page}</div>
                                                                <input
                                                                    type="text"
                                                                    value={selectedBlank.answer}
                                                                    onChange={(e) => updateBlank(selectedBlank.id, { answer: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                    placeholder="??"
                                                                />
                                                                <input
                                                                    type="text"
                                                                    value={selectedBlank.prompt || ''}
                                                                    onChange={(e) => updateBlank(selectedBlank.id, { prompt: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                    placeholder="?? ?? ?? (??)"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 flex items-center justify-center">
                                                                ??? ?? ??? ???? ? ??? ????, ?? ???? ?? ??? ?????.
                                                            </div>
                                                        )}

                                                        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                                                        {sortedBlanks.map((blank, index) => (
                                                            <button
                                                                key={blank.id}
                                                                type="button"
                                                                onClick={() => handleSelectBlank(blank.id)}
                                                                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                                                    activeBlankId === blank.id
                                                                        ? 'border-blue-300 bg-blue-50'
                                                                        : 'border-gray-200 bg-white hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div className="text-xs font-bold text-gray-400">#{index + 1} · p.{blank.page}</div>
                                                                    <span className="text-[11px] text-gray-500">{Math.round(blank.widthRatio * 100)}%</span>
                                                                </div>
                                                                <div className="mt-1 font-bold text-gray-800 truncate">{blank.answer || '정답 미입력'}</div>
                                                                {blank.prompt && <div className="mt-1 text-xs text-gray-500 truncate">{blank.prompt}</div>}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    </div>
                                                </aside>
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-sm text-gray-500">
                                                PDF를 선택한 뒤 <strong>레이아웃 불러오기</strong>를 누르면 페이지 이미지와 OCR 좌표가 준비됩니다.
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 flex flex-col h-full min-h-[240px]">
                                        <label className="block text-xs font-bold text-gray-500 mb-1 flex justify-between">
                                            <span>보조 설명/정리 내용</span>
                                            <span className="text-gray-400 text-[10px]">선택 입력</span>
                                        </label>
                                        <QuillEditor
                                            value={lessonContent}
                                            onChange={setLessonContent}
                                            placeholder="PDF 학습지 아래에 추가 설명이나 정리 내용을 넣고 싶다면 입력하세요."
                                            minHeight={260}
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
                            {modalMode === 'root' ? '새 대단원 추가' : modalMode === 'child' ? '하위 단원 추가' : '단원명 수정'}
                        </h3>
                        <input
                            type="text"
                            autoFocus
                            className="w-full border-2 border-gray-200 rounded-lg p-3 text-lg font-bold focus:border-blue-500 outline-none mb-6"
                            placeholder="단원명 입력"
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
                    <div className="bg-white w-full max-w-6xl h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-lg"><i className="fas fa-mobile-alt mr-2"></i>학생 화면 미리보기</h3>
                            <button onClick={() => setPreviewOpen(false)} className="text-gray-500 hover:text-gray-800"><i className="fas fa-times text-xl"></i></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-gray-50">
                            <div className="max-w-4xl mx-auto bg-white p-6 lg:p-8 rounded-xl shadow-sm border border-gray-200 min-h-full">
                                <h1 className="text-2xl font-bold mb-4 text-gray-900 border-b pb-4">{lessonTitle}</h1>

                                {!lessonVisibleToStudents ? (
                                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-10 text-center text-amber-800">
                                        <div className="text-4xl mb-3">🔒</div>
                                        <h2 className="text-xl font-bold">수업 자료가 공개되지 않았습니다</h2>
                                        <p className="mt-2 text-sm">학생은 교사가 공개한 자료만 확인할 수 있습니다.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {lessonVideo && getEmbedUrl(lessonVideo) && (
                                            <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-xl bg-black">
                                                <iframe src={getEmbedUrl(lessonVideo)!} className="absolute top-0 left-0 w-full h-full" frameBorder="0" allowFullScreen></iframe>
                                            </div>
                                        )}

                                        {worksheetPageImages.length > 0 && (
                                            <LessonWorksheetStage pageImages={worksheetPageImages} blanks={worksheetBlanks} mode="student" studentAnswers={{}} />
                                        )}

                                        {lessonContent && (
                                            <div className="prose max-w-none text-gray-800 leading-loose" dangerouslySetInnerHTML={{ __html: lessonContent }} />
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageLesson;
