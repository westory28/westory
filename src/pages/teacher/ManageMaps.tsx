import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { getBlob, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import MapSidebar from '../../components/common/MapSidebar';
import MapViewer from '../../components/common/MapViewer';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../lib/firebase';
import {
    DEFAULT_GOOGLE_MAP_RESOURCE,
    GOOGLE_MAP_RESOURCE_ID,
    mergeMapResources,
    normalizeMapResource,
    type MapResource,
    type MapResourceType,
} from '../../lib/mapResources';
import { processPdfMapFile } from '../../lib/pdfMapProcessor';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

type StorageScope = 'semester' | 'legacy';

type StoredMapResource = MapResource & {
    storageScope?: StorageScope;
};

const createDraft = (): StoredMapResource => ({
    id: '',
    title: '',
    category: '',
    description: '',
    type: 'image',
    imageUrl: '',
    fileUrl: '',
    storagePath: '',
    fileName: '',
    mimeType: '',
    embedUrl: '',
    googleQuery: '',
    externalUrl: '',
    pdfPageImages: [],
    pdfRegions: [],
    sortOrder: 99,
    storageScope: 'semester',
});

const normalizeErrorMessage = (error: unknown) => {
    const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: string }).code || '')
        : '';
    const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';

    if (code) return `${code}${message ? `: ${message}` : ''}`;
    return message || 'unknown-error';
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timeoutId: number | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error(`${label}-timeout`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
        }
    }
};

const requestLocalPdfFile = (): Promise<File | null> => new Promise((resolve) => {
    if (typeof document === 'undefined') {
        resolve(null);
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
    };

    const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file);
    };

    input.addEventListener('change', () => {
        finish(input.files?.[0] || null);
    }, { once: true });

    window.addEventListener('focus', () => {
        window.setTimeout(() => {
            if (!settled) {
                finish(null);
            }
        }, 500);
    }, { once: true });

    input.click();
});

const blobToPdfFile = (blob: Blob, resourceId: string, fileName?: string, mimeType?: string) =>
    new File(
        [blob],
        fileName || `${resourceId}.pdf`,
        { type: blob.type || mimeType || 'application/pdf' },
    );

const ManageMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<StoredMapResource[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState<StoredMapResource>(createDraft());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const collectionPath = useMemo(() => getSemesterCollectionPath(config, 'map_resources'), [config]);
    const legacyCollectionPath = 'map_resources';

    const resetFileInput = () => {
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const loadFromScope = async (scope: StorageScope): Promise<StoredMapResource[]> => {
        const path = scope === 'semester' ? collectionPath : legacyCollectionPath;
        const snapshot = await getDocs(query(collection(db, path), orderBy('sortOrder', 'asc')));

        return snapshot.docs.map((docSnap) => ({
            ...normalizeMapResource(docSnap.id, docSnap.data()),
            storageScope: scope,
        }));
    };

    useEffect(() => {
        const loadMaps = async () => {
            setLoading(true);

            try {
                let resourceList = await loadFromScope('semester');
                if (resourceList.length === 0) {
                    resourceList = await loadFromScope('legacy');
                }

                const baseScope: StorageScope = resourceList[0]?.storageScope || 'semester';
                const merged = mergeMapResources(resourceList).map((item) => {
                    const existing = resourceList.find((resource) => resource.id === item.id);
                    return {
                        ...item,
                        storageScope: existing?.storageScope || baseScope,
                    };
                });

                const initial = merged[0] || { ...DEFAULT_GOOGLE_MAP_RESOURCE, storageScope: baseScope };
                setItems(merged);
                setSelectedId(initial.id);
                setDraft(initial);
            } catch (error) {
                console.error('Failed to load teacher map resources:', error);
                const fallback = [{ ...DEFAULT_GOOGLE_MAP_RESOURCE, storageScope: 'semester' as const }];
                setItems(fallback);
                setSelectedId(fallback[0].id);
                setDraft(fallback[0]);
            } finally {
                setLoading(false);
            }
        };

        void loadMaps();
    }, [collectionPath]);

    useEffect(() => {
        const next = items.find((item) => item.id === selectedId);
        if (!next) return;

        setDraft(next);
        resetFileInput();
    }, [items, selectedId]);

    const handleDraftChange = (field: keyof MapResource, value: string | number) => {
        setDraft((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleCreateNew = () => {
        setSelectedId('');
        resetFileInput();
        setDraft(createDraft());
        setIsSettingsOpen(true);
    };

    const handleOpenSettings = (itemId: string) => {
        if (!loading) {
            setSelectedId(itemId);
        }
        setIsSettingsOpen(true);
    };

    const persistOrderedItems = async (orderedItems: StoredMapResource[]) => {
        for (let index = 0; index < orderedItems.length; index += 1) {
            const item = orderedItems[index];
            const nextPayload: MapResource = {
                ...normalizeMapResource(item.id, item),
                sortOrder: index,
            };
            const targetScope = item.storageScope || 'semester';
            await persistToScope(targetScope, nextPayload);
        }
    };

    const handleMoveItem = async (itemId: string, direction: 'up' | 'down') => {
        const currentIndex = items.findIndex((item) => item.id === itemId);
        if (currentIndex < 0) return;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= items.length) return;

        const nextItems = [...items];
        const [movedItem] = nextItems.splice(currentIndex, 1);
        nextItems.splice(targetIndex, 0, movedItem);

        const orderedItems = nextItems.map((item, index) => ({
            ...item,
            sortOrder: index,
        }));

        setItems(orderedItems);
        setSelectedId(itemId);

        try {
            await persistOrderedItems(orderedItems);
        } catch (error) {
            console.error('Failed to reorder map resources:', error);
            alert(`지도 순서 저장에 실패했습니다.\n${normalizeErrorMessage(error)}`);
        }
    };

    const persistToScope = async (scope: StorageScope, payload: MapResource) => {
        const path = scope === 'semester' ? collectionPath : legacyCollectionPath;

        await setDoc(
            doc(db, `${path}/${payload.id}`),
            {
                ...payload,
                updatedAt: serverTimestamp(),
            },
            { merge: true },
        );
    };

    const uploadProcessedPdfPages = async (
        resourceId: string,
        processed: Awaited<ReturnType<typeof processPdfMapFile>>,
    ) => {
        const uploadedPages = [];

        for (const page of processed.pageImages) {
            const pageRef = ref(storage, `map-resources/${resourceId}/page-${page.page}.png`);
            await withTimeout(
                uploadBytes(pageRef, page.blob, {
                    contentType: 'image/png',
                }),
                20000,
                `storage-upload-page-${page.page}`,
            );
            const pageUrl = await withTimeout(getDownloadURL(pageRef), 10000, `storage-page-url-${page.page}`);
            uploadedPages.push({
                page: page.page,
                imageUrl: pageUrl,
                width: page.width,
                height: page.height,
            });
        }

        return uploadedPages;
    };

    const loadStoredPdfSourceFile = async (resourceId: string) => {
        const candidateRefs = [
            draft.storagePath ? ref(storage, draft.storagePath) : null,
            draft.fileUrl ? ref(storage, draft.fileUrl) : null,
        ].filter(Boolean) as ReturnType<typeof ref>[];

        let lastError: unknown = null;

        for (const fileRef of candidateRefs) {
            try {
                const blob = await withTimeout(getBlob(fileRef), 45000, 'storage-pdf-blob');
                return blobToPdfFile(blob, resourceId, draft.fileName, draft.mimeType);
            } catch (blobError) {
                lastError = blobError;
                try {
                    const bytes = await withTimeout(getBytes(fileRef, 40 * 1024 * 1024), 45000, 'storage-pdf-bytes');
                    return blobToPdfFile(
                        new Blob([bytes], { type: draft.mimeType || 'application/pdf' }),
                        resourceId,
                        draft.fileName,
                        draft.mimeType,
                    );
                } catch (bytesError) {
                    lastError = bytesError;
                }
            }
        }

        if (draft.fileUrl) {
            try {
                const response = await withTimeout(fetch(draft.fileUrl, { mode: 'cors' }), 45000, 'pdf-reprocess-fetch');
                if (!response.ok) {
                    throw new Error(`pdf-reprocess-fetch-failed:${response.status}`);
                }
                const blob = await withTimeout(response.blob(), 30000, 'pdf-reprocess-blob');
                return blobToPdfFile(blob, resourceId, draft.fileName, draft.mimeType);
            } catch (fetchError) {
                lastError = fetchError;
            }
        }

        throw lastError || new Error('pdf-reprocess-source-missing');
    };

    const persistMapPayload = async (payload: MapResource, preferredScope: StorageScope) => {
        const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';
        let resolvedScope = preferredScope;

        try {
            await persistToScope(preferredScope, payload);
        } catch (primaryError) {
            console.error(`Failed to save map resource to ${preferredScope}:`, primaryError);
            await persistToScope(fallbackScope, payload);
            resolvedScope = fallbackScope;
        }

        const merged = mergeMapResources([
            ...items.filter((item) => item.id !== payload.id),
            { ...payload, storageScope: resolvedScope },
        ]).map((item) => {
            const existing = items.find((resource) => resource.id === item.id);
            if (item.id === payload.id) {
                return { ...item, storageScope: resolvedScope };
            }
            return { ...item, storageScope: existing?.storageScope || resolvedScope };
        });

        setItems(merged);
        setSelectedId(payload.id);
        setDraft({ ...payload, storageScope: resolvedScope });
        resetFileInput();
        setIsSettingsOpen(false);

        if (resolvedScope === preferredScope) {
            alert('지도 자료를 저장했습니다.');
        } else {
            alert('지도 자료를 저장했습니다. 학기 범위 경로 대신 기본 컬렉션에 저장되었습니다.');
        }
    };

    const uploadSelectedFile = async (resourceId: string) => {
        if (!selectedFile) {
            return {
                fileUrl: draft.fileUrl || '',
                imageUrl: draft.imageUrl || '',
                storagePath: draft.storagePath || '',
                fileName: draft.fileName || '',
                mimeType: draft.mimeType || '',
                pdfPageImages: draft.pdfPageImages || [],
                pdfRegions: draft.pdfRegions || [],
            };
        }

        const extension = selectedFile.name.includes('.')
            ? `.${selectedFile.name.split('.').pop()}`
            : '';
        const objectRef = ref(storage, `map-resources/${resourceId}/${Date.now()}${extension}`);

        await withTimeout(
            uploadBytes(objectRef, selectedFile, {
                contentType: selectedFile.type || undefined,
            }),
            20000,
            'storage-upload',
        );

        const fileUrl = await withTimeout(getDownloadURL(objectRef), 10000, 'storage-download-url');

        if (draft.type === 'pdf') {
            const processed = await processPdfMapFile(selectedFile);
            const uploadedPages = await uploadProcessedPdfPages(resourceId, processed);

            return {
                fileUrl,
                imageUrl: '',
                storagePath: objectRef.fullPath,
                fileName: selectedFile.name,
                mimeType: selectedFile.type || '',
                pdfPageImages: uploadedPages,
                pdfRegions: processed.regions,
            };
        }

        return {
            fileUrl,
            imageUrl: draft.type === 'image' ? fileUrl : '',
            storagePath: objectRef.fullPath,
            fileName: selectedFile.name,
            mimeType: selectedFile.type || '',
            pdfPageImages: [],
            pdfRegions: [],
        };
    };

    const handleTypeChange = (nextType: MapResourceType) => {
        resetFileInput();

        setDraft((prev) => ({
            ...prev,
            type: nextType,
            imageUrl: nextType === 'image' ? prev.imageUrl : '',
            fileUrl: nextType === 'image' || nextType === 'pdf' ? prev.fileUrl : '',
            storagePath: nextType === 'image' || nextType === 'pdf' ? prev.storagePath : '',
            fileName: nextType === 'image' || nextType === 'pdf' ? prev.fileName : '',
            mimeType: nextType === 'image' || nextType === 'pdf' ? prev.mimeType : '',
            embedUrl: nextType === 'iframe' ? prev.embedUrl : '',
            googleQuery: nextType === 'google' ? prev.googleQuery : '',
            pdfPageImages: nextType === 'pdf' ? prev.pdfPageImages : [],
            pdfRegions: nextType === 'pdf' ? prev.pdfRegions : [],
        }));
    };

    const handleSave = async () => {
        const resourceId = draft.id || `map-${Date.now()}`;
        const payloadBase = normalizeMapResource(resourceId, draft);

        if (!payloadBase.title || !payloadBase.category) {
            alert('지도 제목과 분류를 입력해 주세요.');
            return;
        }

        if (payloadBase.type === 'iframe' && !payloadBase.embedUrl) {
            alert('iframe 지도는 iframe URL이 필요합니다.');
            return;
        }

        if (payloadBase.type === 'google' && !payloadBase.googleQuery) {
            alert('Google 지도는 검색어를 입력해 주세요.');
            return;
        }

        if ((payloadBase.type === 'image' || payloadBase.type === 'pdf')
            && !selectedFile
            && !(payloadBase.type === 'image' ? payloadBase.imageUrl : payloadBase.fileUrl)) {
            alert(payloadBase.type === 'pdf' ? 'PDF 파일을 업로드해 주세요.' : '이미지 파일을 업로드해 주세요.');
            return;
        }

        setSaving(true);

        try {
            const fileInfo = await uploadSelectedFile(resourceId);
            const payload: MapResource = {
                ...payloadBase,
                ...fileInfo,
                imageUrl: payloadBase.type === 'image'
                    ? (fileInfo.imageUrl || payloadBase.imageUrl)
                    : '',
                fileUrl: payloadBase.type === 'image' || payloadBase.type === 'pdf'
                    ? (fileInfo.fileUrl || payloadBase.fileUrl)
                    : '',
                storagePath: payloadBase.type === 'image' || payloadBase.type === 'pdf'
                    ? (fileInfo.storagePath || payloadBase.storagePath)
                    : '',
                fileName: payloadBase.type === 'image' || payloadBase.type === 'pdf'
                    ? (fileInfo.fileName || payloadBase.fileName)
                    : '',
                mimeType: payloadBase.type === 'image' || payloadBase.type === 'pdf'
                    ? (fileInfo.mimeType || payloadBase.mimeType)
                    : '',
                embedUrl: payloadBase.type === 'iframe' ? payloadBase.embedUrl : '',
                googleQuery: payloadBase.type === 'google' ? payloadBase.googleQuery : '',
                pdfPageImages: payloadBase.type === 'pdf'
                    ? (fileInfo.pdfPageImages || payloadBase.pdfPageImages || [])
                    : [],
                pdfRegions: payloadBase.type === 'pdf'
                    ? (fileInfo.pdfRegions || payloadBase.pdfRegions || [])
                    : [],
            };

            await persistMapPayload(payload, draft.storageScope || 'semester');
            return;

            const preferredScope: StorageScope = draft.storageScope || 'semester';
            const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';
            let resolvedScope = preferredScope;

            try {
                await persistToScope(preferredScope, payload);
            } catch (primaryError) {
                console.error(`Failed to save map resource to ${preferredScope}:`, primaryError);
                await persistToScope(fallbackScope, payload);
                resolvedScope = fallbackScope;
            }

            const merged = mergeMapResources([
                ...items.filter((item) => item.id !== payload.id),
                { ...payload, storageScope: resolvedScope },
            ]).map((item) => {
                const existing = items.find((resource) => resource.id === item.id);
                if (item.id === payload.id) {
                    return { ...item, storageScope: resolvedScope };
                }
                return { ...item, storageScope: existing?.storageScope || resolvedScope };
            });

            setItems(merged);
            setSelectedId(payload.id);
            setDraft({ ...payload, storageScope: resolvedScope });
            resetFileInput();
            setIsSettingsOpen(false);

            if (resolvedScope === preferredScope) {
                alert('지도 자료를 저장했습니다.');
            } else {
                alert('지도 자료를 저장했습니다. 학기 범위 경로 대신 기본 컬렉션에 저장되었습니다.');
            }
        } catch (error) {
            console.error('Failed to save map resource:', error);
            const message = normalizeErrorMessage(error);
            const storageHint = message.includes('storage-upload-timeout') || message.includes('storage-download-url-timeout')
                ? '\nFirebase Storage 버킷 또는 Storage 규칙이 아직 준비되지 않았을 가능성이 큽니다.'
                : '';
            alert(`지도 자료 저장에 실패했습니다.\n${message}${storageHint}`);
        } finally {
            setSaving(false);
        }
    };

    const handleReprocessPdf = async () => {
        if (draft.type !== 'pdf' || !draft.id) return;

        setSaving(true);

        try {
            let sourceFile = selectedFile;

            if (!sourceFile) {
                try {
                    sourceFile = await loadStoredPdfSourceFile(draft.id);
                } catch (remoteError) {
                    console.warn('Stored PDF reload failed, asking for local PDF file:', remoteError);
                    alert('기존 PDF를 자동으로 다시 읽지 못했습니다. 같은 PDF 파일을 한 번 선택해 주시면 재처리를 이어갑니다.');
                    sourceFile = await requestLocalPdfFile();
                    if (!sourceFile) {
                        throw remoteError;
                    }
                    setSelectedFile(sourceFile);
                }
            }

            const processed = await processPdfMapFile(sourceFile);
            const uploadedPages = await uploadProcessedPdfPages(draft.id, processed);
            const payload: MapResource = {
                ...normalizeMapResource(draft.id, draft),
                pdfPageImages: uploadedPages,
                pdfRegions: processed.regions,
            };

            await persistMapPayload(payload, draft.storageScope || 'semester');
        } catch (error) {
            console.error('Failed to reprocess PDF map:', error);
            alert(`PDF 재처리에 실패했습니다.\n${normalizeErrorMessage(error)}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!draft.id) return;

        if (draft.id === GOOGLE_MAP_RESOURCE_ID) {
            alert('구글 지도 기본 항목은 삭제할 수 없습니다.');
            return;
        }

        if (!window.confirm(`'${draft.title}' 지도를 삭제하시겠습니까?`)) {
            return;
        }

        try {
            const preferredScope: StorageScope = draft.storageScope || 'semester';
            const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';
            const primaryPath = preferredScope === 'semester' ? collectionPath : legacyCollectionPath;
            const fallbackPath = fallbackScope === 'semester' ? collectionPath : legacyCollectionPath;

            try {
                await deleteDoc(doc(db, `${primaryPath}/${draft.id}`));
            } catch (primaryError) {
                console.error(`Failed to delete map resource from ${primaryPath}:`, primaryError);
                await deleteDoc(doc(db, `${fallbackPath}/${draft.id}`));
            }

            const nextItems = mergeMapResources(items.filter((item) => item.id !== draft.id)).map((item) => {
                const existing = items.find((resource) => resource.id === item.id);
                return { ...item, storageScope: existing?.storageScope || 'semester' };
            });

            setItems(nextItems);
            setSelectedId(nextItems[0]?.id || '');
            setDraft(nextItems[0] || createDraft());
            resetFileInput();
            setIsSettingsOpen(false);
        } catch (error) {
            console.error('Failed to delete map resource:', error);
            alert(`지도 자료 삭제에 실패했습니다.\n${normalizeErrorMessage(error)}`);
        }
    };

    const selectedPreview = draft.id ? draft : null;
    const acceptsFile = draft.type === 'image' || draft.type === 'pdf';

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 lg:flex-row lg:p-10">
                <MapSidebar
                    heading="지도"
                    items={items}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    action={(
                        <button
                            type="button"
                            onClick={handleCreateNew}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <i className="fas fa-plus"></i>
                            추가
                        </button>
                    )}
                    headingAction={(
                        <button
                            type="button"
                            onClick={() => setIsReorderMode((prev) => !prev)}
                            className={`inline-flex min-w-[42px] items-center justify-center rounded-lg border px-2 py-1 text-xs font-extrabold leading-none transition ${
                                isReorderMode
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : 'border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700'
                            }`}
                            aria-label="지도 순서 변경"
                            title="지도 순서 변경"
                        >
                            ↑↓
                        </button>
                    )}
                    renderItemAction={(item) => (
                        isReorderMode ? (
                            <div
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    onClick={() => void handleMoveItem(item.id, 'up')}
                                    disabled={items[0]?.id === item.id}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-30"
                                    aria-label={`${item.title} 위로 이동`}
                                    title="위로 이동"
                                >
                                    <i className="fas fa-chevron-up text-xs"></i>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleMoveItem(item.id, 'down')}
                                    disabled={items[items.length - 1]?.id === item.id}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-30"
                                    aria-label={`${item.title} 아래로 이동`}
                                    title="아래로 이동"
                                >
                                    <i className="fas fa-chevron-down text-xs"></i>
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenSettings(item.id);
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-gray-400 transition hover:border-gray-200 hover:bg-white hover:text-gray-700"
                                aria-label={`${item.title} 설정 열기`}
                                title="설정"
                            >
                                <i className="fas fa-cog text-sm"></i>
                            </button>
                        )
                    )}
                    reorderMode={isReorderMode}
                />

                <section className="min-w-0 flex-1 space-y-6">
                    {loading ? (
                        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-400 shadow-sm">
                            <i className="fas fa-spinner fa-spin text-2xl"></i>
                            <p className="mt-3">지도를 불러오는 중입니다.</p>
                        </div>
                    ) : (
                        <>
                            <MapViewer
                                item={selectedPreview}
                                googleSearchQuery={draft.type === 'google' ? (draft.googleQuery || '') : undefined}
                                onGoogleSearchQueryChange={draft.type === 'google'
                                    ? (value) => handleDraftChange('googleQuery', value)
                                    : undefined}
                            />

                        </>
                    )}
                </section>
            </main>

            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                    <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl md:p-8">
                        <div className="mb-6 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-extrabold text-gray-900">지도 설정</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    지도 순서와 표시 방식을 여기서 바꿀 수 있습니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                                aria-label="설정창 닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-bold text-gray-500">지도 제목</label>
                                <input
                                    type="text"
                                    value={draft.title}
                                    onChange={(e) => handleDraftChange('title', e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                    placeholder="예: 조선 후기 한반도 지도"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold text-gray-500">분류</label>
                                <input
                                    type="text"
                                    value={draft.category}
                                    onChange={(e) => handleDraftChange('category', e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                    placeholder="예: 한국사 지도"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold text-gray-500">지도 유형</label>
                                <select
                                    value={draft.type}
                                    onChange={(e) => handleTypeChange(e.target.value as MapResourceType)}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                                >
                                    <option value="image">이미지</option>
                                    <option value="pdf">PDF</option>
                                    <option value="iframe">외부 iframe</option>
                                    <option value="google">Google 지도</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold text-gray-500">지도 순서</label>
                                <input
                                    type="number"
                                    value={draft.sortOrder}
                                    onChange={(e) => handleDraftChange('sortOrder', Number(e.target.value) || 0)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="mt-4">
                            <label className="mb-1 block text-xs font-bold text-gray-500">설명</label>
                            <textarea
                                value={draft.description}
                                onChange={(e) => handleDraftChange('description', e.target.value)}
                                rows={4}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                placeholder="학생이 지도를 볼 때 함께 보일 설명을 입력해 주세요."
                            />
                        </div>

                        {acceptsFile && (
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-gray-500">
                                        {draft.type === 'pdf' ? 'PDF 파일 업로드' : '이미지 파일 업로드'}
                                    </label>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept={draft.type === 'pdf' ? '.pdf,application/pdf' : 'image/*'}
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="text-xs leading-6 text-gray-500">
                                    <div>현재 파일: {selectedFile?.name || draft.fileName || '없음'}</div>
                                    <div>
                                        {draft.type === 'pdf'
                                            ? 'PDF는 확대와 축소를 지원하고, 상단에서 지역 이름 후보를 눌러 해당 위치를 크게 볼 수 있습니다.'
                                            : '이미지 지도는 업로드 후 학생 화면에 바로 표시됩니다.'}
                                    </div>
                                </div>
                            </div>
                        )}

                        {draft.type === 'iframe' && (
                            <div className="mt-4">
                                <label className="mb-1 block text-xs font-bold text-gray-500">iframe URL</label>
                                <input
                                    type="text"
                                    value={draft.embedUrl || ''}
                                    onChange={(e) => handleDraftChange('embedUrl', e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                    placeholder="https://..."
                                />
                            </div>
                        )}

                        {draft.type === 'google' && (
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-gray-500">Google 지도 검색어</label>
                                    <input
                                        type="text"
                                        value={draft.googleQuery || ''}
                                        onChange={(e) => handleDraftChange('googleQuery', e.target.value)}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="예: 대한민국 서울 경복궁"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-gray-500">외부 링크</label>
                                    <input
                                        type="text"
                                        value={draft.externalUrl || ''}
                                        onChange={(e) => handleDraftChange('externalUrl', e.target.value)}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="https://www.google.com/maps"
                                    />
                                </div>
                                <p className="text-xs leading-6 text-gray-500 md:col-span-2">
                                    Google 지도는 검색어 기반 iframe으로 표시됩니다. PDF 전용 지역 이름 추출 기능은
                                    Google 지도에는 적용되지 않습니다.
                                </p>
                            </div>
                        )}

                        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                                {draft.id && draft.type === 'pdf' && draft.fileUrl && (
                                    <button
                                        type="button"
                                        onClick={() => void handleReprocessPdf()}
                                        disabled={saving}
                                        className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                                    >
                                        PDF 재처리
                                    </button>
                                )}
                                {draft.id && (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                                    >
                                        삭제
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsSettingsOpen(false)}
                                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    닫기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleSave()}
                                    disabled={saving}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {saving ? '저장 중...' : '저장'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageMaps;
