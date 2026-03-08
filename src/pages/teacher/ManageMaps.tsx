import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import MapSidebar from '../../components/common/MapSidebar';
import MapViewer from '../../components/common/MapViewer';
import PdfMapViewer from '../../components/common/PdfMapViewer';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../lib/firebase';
import {
    DEFAULT_GOOGLE_MAP_RESOURCE,
    DEFAULT_PDF_ERA_TAGS,
    DEFAULT_PDF_REGION_TAGS,
    GOOGLE_MAP_RESOURCE_ID,
    getGoogleMapsExternalUrl,
    groupMapResourcesForDisplay,
    mergeMapResources,
    normalizeMapResource,
    type MapResource,
    type MapResourceType,
    type PdfMapPageImage,
    type PdfMapRegion,
} from '../../lib/mapResources';
import { processPdfMapFile, type ProcessedPdfMap } from '../../lib/pdfMapProcessor';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

type StorageScope = 'semester' | 'legacy';

type StoredMapResource = MapResource & {
    storageScope?: StorageScope;
};

interface PendingPdfUpload {
    id: string;
    file: File;
    processed: ProcessedPdfMap;
    pageImages: PdfMapPageImage[];
    regions: PdfMapRegion[];
}

const createDraft = (): StoredMapResource => ({
    id: '',
    title: '',
    category: '',
    tabGroup: '',
    description: '',
    type: 'pdf',
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

const DEFAULT_PDF_TAG_OPTIONS = [...DEFAULT_PDF_REGION_TAGS, ...DEFAULT_PDF_ERA_TAGS];

const normalizeRegionTags = (tags: string[]) => Array.from(new Set(
    tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean),
)).sort((a, b) => a.localeCompare(b, 'ko'));

const fileNameWithoutExtension = (value: string) => value.replace(/\.[^.]+$/u, '').trim();

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

    input.addEventListener('cancel', () => {
        finish(null);
    }, { once: true });

    window.addEventListener('focus', () => {
        window.setTimeout(() => {
            if (!settled && !input.files?.length) {
                finish(null);
            }
        }, 1500);
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
    const [isTabRenameOpen, setIsTabRenameOpen] = useState(false);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedFilePreviewUrl, setSelectedFilePreviewUrl] = useState('');
    const [pendingPdfUploads, setPendingPdfUploads] = useState<PendingPdfUpload[]>([]);
    const [activePendingPdfId, setActivePendingPdfId] = useState('');
    const [isPdfShortcutExpanded, setIsPdfShortcutExpanded] = useState(false);
    const [isPreparingPdfUploads, setIsPreparingPdfUploads] = useState(false);
    const [customTagInputs, setCustomTagInputs] = useState<Record<number, string>>({});
    const [tabRenameSourceKey, setTabRenameSourceKey] = useState('');
    const [tabRenameValue, setTabRenameValue] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const collectionPath = useMemo(() => getSemesterCollectionPath(config, 'map_resources'), [config]);
    const legacyCollectionPath = 'map_resources';

    const revokePendingPdfUploadResources = (uploads: PendingPdfUpload[]) => {
        uploads.forEach((upload) => {
            upload.pageImages.forEach((page) => {
                if (page.imageUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(page.imageUrl);
                }
            });
        });
    };

    const resetFileInput = () => {
        setSelectedFile(null);
        setSelectedFilePreviewUrl('');
        setActivePendingPdfId('');
        setPendingPdfUploads((prev) => {
            revokePendingPdfUploadResources(prev);
            return [];
        });
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
        setCustomTagInputs({});
        setIsPdfShortcutExpanded(false);
        resetFileInput();
    }, [items, selectedId]);

    useEffect(() => {
        if (!selectedFile) {
            setSelectedFilePreviewUrl('');
            return;
        }

        const previewUrl = URL.createObjectURL(selectedFile);
        setSelectedFilePreviewUrl(previewUrl);
        return () => URL.revokeObjectURL(previewUrl);
    }, [selectedFile]);

    useEffect(() => () => {
        revokePendingPdfUploadResources(pendingPdfUploads);
    }, [pendingPdfUploads]);

    const handleDraftChange = (field: keyof MapResource, value: string | number) => {
        setDraft((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handlePdfRegionLabelChange = (index: number, value: string) => {
        setDraft((prev) => ({
            ...prev,
            pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) => (
                regionIndex === index
                    ? { ...region, label: value.trim() }
                    : region
            )),
        }));
    };

    const handlePdfRegionShortcutToggle = (index: number, checked: boolean) => {
        setDraft((prev) => ({
            ...prev,
            pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) => (
                regionIndex === index
                    ? { ...region, shortcutEnabled: checked }
                    : region
            )),
        }));
    };

    const updatePdfRegion = (index: number, updater: (region: PdfMapRegion) => PdfMapRegion) => {
        setDraft((prev) => ({
            ...prev,
            pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) => (
                regionIndex === index ? updater(region) : region
            )),
        }));
    };

    const handlePdfRegionTagToggle = (index: number, tag: string, checked: boolean) => {
        updatePdfRegion(index, (region) => {
            const currentTags = normalizeRegionTags(region.tags || []);
            const nextTags = checked
                ? normalizeRegionTags([...currentTags, tag])
                : currentTags.filter((item) => item !== tag);
            return { ...region, tags: nextTags };
        });
    };

    const handlePdfRegionCustomTagInputChange = (index: number, value: string) => {
        setCustomTagInputs((prev) => ({
            ...prev,
            [index]: value,
        }));
    };

    const handlePdfRegionAddCustomTag = (index: number) => {
        const nextTag = String(customTagInputs[index] || '').trim();
        if (!nextTag) return;

        updatePdfRegion(index, (region) => ({
            ...region,
            tags: normalizeRegionTags([...(region.tags || []), nextTag]),
        }));

        setCustomTagInputs((prev) => ({
            ...prev,
            [index]: '',
        }));
    };

    const buildPendingPdfUpload = async (file: File): Promise<PendingPdfUpload> => {
        const processed = await processPdfMapFile(file);
        return {
            id: `${file.name}-${file.size}-${file.lastModified}`,
            file,
            processed,
            pageImages: processed.pageImages.map((page) => ({
                page: page.page,
                imageUrl: URL.createObjectURL(page.blob),
                width: page.width,
                height: page.height,
            })),
            regions: processed.regions,
        };
    };

    const applyPendingPdfUpload = (upload: PendingPdfUpload) => {
        setActivePendingPdfId(upload.id);
        setSelectedFile(upload.file);
        setCustomTagInputs({});
        setIsPdfShortcutExpanded(false);
        setDraft((prev) => ({
            ...prev,
            fileName: upload.file.name,
            mimeType: upload.file.type || 'application/pdf',
            pdfPageImages: upload.pageImages,
            pdfRegions: upload.regions,
            title: prev.id || prev.title
                ? prev.title
                : fileNameWithoutExtension(upload.file.name),
        }));
    };

    const handlePendingPdfUploadSelect = (uploadId: string) => {
        const next = pendingPdfUploads.find((upload) => upload.id === uploadId);
        if (!next) return;
        applyPendingPdfUpload(next);
    };

    const handlePendingPdfUploadRemove = (uploadId: string) => {
        setPendingPdfUploads((prev) => {
            const nextUploads = prev.filter((upload) => upload.id !== uploadId);
            const removed = prev.find((upload) => upload.id === uploadId);
            if (removed) {
                revokePendingPdfUploadResources([removed]);
            }

            if (activePendingPdfId === uploadId) {
                const fallback = nextUploads[0];
                if (fallback) {
                    applyPendingPdfUpload(fallback);
                } else {
                    setActivePendingPdfId('');
                    setSelectedFile(null);
                    setCustomTagInputs({});
                    setDraft((current) => ({
                        ...current,
                        fileName: '',
                        mimeType: '',
                        pdfPageImages: [],
                        pdfRegions: [],
                    }));
                }
            }

            return nextUploads;
        });
    };

    const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        if (draft.type !== 'pdf') {
            setSelectedFile(files[0] || null);
            return;
        }

        setIsPreparingPdfUploads(true);
        try {
            const uploads: PendingPdfUpload[] = [];
            for (const file of files) {
                uploads.push(await buildPendingPdfUpload(file));
            }

            setPendingPdfUploads((prev) => {
                revokePendingPdfUploadResources(prev);
                return uploads;
            });

            if (uploads[0]) {
                applyPendingPdfUpload(uploads[0]);
            }
        } catch (error) {
            console.error('Failed to prepare local PDF previews:', error);
            alert(`PDF 미리보기를 준비하지 못했습니다.\n${normalizeErrorMessage(error)}`);
        } finally {
            setIsPreparingPdfUploads(false);
        }
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

    const handleOpenTabRename = (groupKey: string) => {
        const targetGroup = displayGroupMap.get(groupKey);
        setTabRenameSourceKey(groupKey);
        setTabRenameValue(targetGroup?.title || '');
        setIsTabRenameOpen(true);
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
        const currentGroups = groupMapResourcesForDisplay(items);
        const currentGroupIndex = currentGroups.findIndex((group) =>
            group.key === itemId.replace(/^map-group:/u, '')
            || group.items.some((item) => item.id === itemId),
        );
        if (currentGroupIndex < 0) return;

        const targetGroupIndex = direction === 'up' ? currentGroupIndex - 1 : currentGroupIndex + 1;
        if (targetGroupIndex < 0 || targetGroupIndex >= currentGroups.length) return;

        const nextGroups = [...currentGroups];
        const [movedGroup] = nextGroups.splice(currentGroupIndex, 1);
        nextGroups.splice(targetGroupIndex, 0, movedGroup);

        const orderedItems = nextGroups
            .flatMap((group) => group.items)
            .map((item, index) => ({
                ...item,
                sortOrder: index,
            }));

        setItems(orderedItems);
        setSelectedId(movedGroup.items[0]?.id || selectedId);

        try {
            await persistOrderedItems(orderedItems);
        } catch (error) {
            console.error('Failed to reorder map resources:', error);
            alert(`지도 순서를 변경하지 못했습니다.\n${normalizeErrorMessage(error)}`);
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
            alert('지도 자료를 저장했습니다. 기본 저장 경로에 실패해 대체 경로에 저장했습니다.');
        }
    };

    const uploadSelectedFile = async (
        resourceId: string,
        fileOverride?: File | null,
        processedOverride?: ProcessedPdfMap | null,
    ) => {
        const targetFile = fileOverride ?? selectedFile;

        if (!targetFile) {
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

        const extension = targetFile.name.includes('.')
            ? `.${targetFile.name.split('.').pop()}`
            : '';
        const objectRef = ref(storage, `map-resources/${resourceId}/${Date.now()}${extension}`);

        await withTimeout(
            uploadBytes(objectRef, targetFile, {
                contentType: targetFile.type || undefined,
            }),
            20000,
            'storage-upload',
        );

        const fileUrl = await withTimeout(getDownloadURL(objectRef), 10000, 'storage-download-url');

        if (draft.type === 'pdf') {
            const processed = processedOverride || await processPdfMapFile(targetFile);
            const uploadedPages = await uploadProcessedPdfPages(resourceId, processed);

            return {
                fileUrl,
                imageUrl: '',
                storagePath: objectRef.fullPath,
                fileName: targetFile.name,
                mimeType: targetFile.type || '',
                pdfPageImages: uploadedPages,
                pdfRegions: processed.regions,
            };
        }

        return {
            fileUrl,
            imageUrl: draft.type === 'image' ? fileUrl : '',
            storagePath: objectRef.fullPath,
            fileName: targetFile.name,
            mimeType: targetFile.type || '',
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
            alert('iframe 지도를 사용하려면 iframe URL을 입력해 주세요.');
            return;
        }

        if (payloadBase.type === 'google' && !payloadBase.googleQuery) {
            alert('구글 지도를 사용하려면 검색어를 입력해 주세요.');
            return;
        }

        if ((payloadBase.type === 'image' || payloadBase.type === 'pdf')
            && !selectedFile
            && !(payloadBase.type === 'image' ? payloadBase.imageUrl : payloadBase.fileUrl)) {
            alert(payloadBase.type === 'pdf' ? 'PDF 파일을 선택해 주세요.' : '이미지 파일을 선택해 주세요.');
            return;
        }

        setSaving(true);

        try {
            if (payloadBase.type === 'pdf' && pendingPdfUploads.length > 1) {
                const createdPayloads: Array<MapResource & { storageScope?: StorageScope }> = [];
                const preferredScope = draft.storageScope || 'semester';
                const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';

                for (let index = 0; index < pendingPdfUploads.length; index += 1) {
                    const upload = pendingPdfUploads[index];
                    const nextResourceId = `map-${Date.now()}-${index}`;
                    const payloadSeed = normalizeMapResource(nextResourceId, {
                        ...draft,
                        id: nextResourceId,
                        title: fileNameWithoutExtension(upload.file.name),
                        fileName: upload.file.name,
                        mimeType: upload.file.type || 'application/pdf',
                        pdfRegions: upload.regions,
                        pdfPageImages: upload.pageImages,
                    });
                    const fileInfo = await uploadSelectedFile(nextResourceId, upload.file, upload.processed);
                    const payload: MapResource = {
                        ...payloadSeed,
                        ...fileInfo,
                        imageUrl: '',
                        fileUrl: fileInfo.fileUrl || '',
                        storagePath: fileInfo.storagePath || '',
                        fileName: fileInfo.fileName || upload.file.name,
                        mimeType: fileInfo.mimeType || upload.file.type || '',
                        pdfPageImages: fileInfo.pdfPageImages || [],
                        pdfRegions: fileInfo.pdfRegions || [],
                    };

                    let resolvedScope = preferredScope;
                    try {
                        await persistToScope(preferredScope, payload);
                    } catch (primaryError) {
                        console.error(`Failed to save map resource to ${preferredScope}:`, primaryError);
                        await persistToScope(fallbackScope, payload);
                        resolvedScope = fallbackScope;
                    }

                    createdPayloads.push({ ...payload, storageScope: resolvedScope });
                }

                const merged = mergeMapResources([
                    ...items,
                    ...createdPayloads,
                ]).map((item) => {
                    const created = createdPayloads.find((payload) => payload.id === item.id);
                    const existing = items.find((resource) => resource.id === item.id);
                    return { ...item, storageScope: created?.storageScope || existing?.storageScope || preferredScope };
                });

                setItems(merged);
                if (createdPayloads[0]) {
                    setSelectedId(createdPayloads[0].id);
                    setDraft(createdPayloads[0]);
                }
                resetFileInput();
                setIsSettingsOpen(false);
                alert(`${createdPayloads.length}개의 PDF 지도를 한 번에 저장했습니다.`);
                return;
            }

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
                alert('?轅붽틓???????????????μ떝?롧땟?삵맪??????');
            } else {
                alert('?轅붽틓???????????????μ떝?롧땟?삵맪?????? ???????틯 ?嶺???????β뼯援????る쑏????????????????β뼯爰????癲ル슢???с궘?????녾낮?녔틦?쀂???????????낆젵.');
            }
        } catch (error) {
            console.error('Failed to save map resource:', error);
            const message = normalizeErrorMessage(error);
            const storageHint = message.includes('storage-upload-timeout') || message.includes('storage-download-url-timeout')
                ? '\nFirebase Storage 응답이 지연되고 있습니다. 잠시 후 다시 시도하거나 파일 크기를 줄여 보세요.'
                : '';
            alert(`지도 저장에 실패했습니다.\n${message}${storageHint}`);
        } finally {
            setSaving(false);
        }
    };

    const handleReprocessPdf = async () => {
        if (draft.type !== 'pdf' || !draft.id) return;

        let sourceFile = selectedFile;
        if (!sourceFile) {
            alert('PDF 재처리를 위해 같은 PDF 파일을 다시 선택해 주세요.');
            sourceFile = await requestLocalPdfFile();
            if (!sourceFile) {
                return;
            }
            setSelectedFile(sourceFile);
        }

        setSaving(true);

        try {
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
            alert(`지도 삭제에 실패했습니다.\n${normalizeErrorMessage(error)}`);
        }
    };

    const handleSaveTabRename = async () => {
        const nextTabGroup = tabRenameValue.trim();
        if (!tabRenameSourceKey || !nextTabGroup) {
            alert('지도 탭 이름을 입력해 주세요.');
            return;
        }

        const targetGroup = displayGroupMap.get(tabRenameSourceKey);
        if (!targetGroup?.items.length) {
            setIsTabRenameOpen(false);
            return;
        }

        try {
            const nextItems = items.map((item) => {
                if (!targetGroup.items.some((groupItem) => groupItem.id === item.id)) return item;
                return { ...item, tabGroup: nextTabGroup };
            });

            for (const item of nextItems) {
                const existing = items.find((current) => current.id === item.id);
                if (!existing || existing.tabGroup === item.tabGroup) continue;
                await persistToScope(
                    item.storageScope || 'semester',
                    { ...normalizeMapResource(item.id, item), tabGroup: nextTabGroup },
                );
            }

            setItems(nextItems);
            setDraft((prev) => (
                targetGroup.items.some((item) => item.id === prev.id)
                    ? { ...prev, tabGroup: nextTabGroup }
                    : prev
            ));
            setIsTabRenameOpen(false);
        } catch (error) {
            console.error('Failed to rename map tab:', error);
            alert(`지도 탭 이름을 변경하지 못했습니다.\n${normalizeErrorMessage(error)}`);
        }
    };

    const selectedPreview = draft.id ? draft : null;
    const displayGroups = useMemo(() => groupMapResourcesForDisplay(items), [items]);
    const displayGroupMap = useMemo(
        () => new Map(displayGroups.map((group) => [group.key, group])),
        [displayGroups],
    );
    const currentDisplayGroup = displayGroups.find((group) => group.items.some((item) => item.id === selectedId))
        || displayGroups[0]
        || null;
    const currentDisplayItems = currentDisplayGroup?.items || [];
    const currentPreviewItem = currentDisplayItems.find((item) => item.id === selectedId)
        || currentDisplayItems[0]
        || selectedPreview;
    const sidebarItems = useMemo<MapResource[]>(() => (
        displayGroups.map((group) => ({
            ...group.representative,
            id: `map-group:${group.key}`,
            title: group.title,
        }))
    ), [displayGroups]);
    const previewExternalUrl = currentPreviewItem?.type === 'google'
        ? (currentPreviewItem.externalUrl || getGoogleMapsExternalUrl(currentPreviewItem.googleQuery || ''))
        : (currentPreviewItem?.externalUrl || currentPreviewItem?.fileUrl || '');
    const acceptsFile = draft.type === 'pdf';
    const currentSettingsTabGroup = (draft.tabGroup || draft.category || '').trim();
    const settingsTabs = useMemo(
        () => items.filter((item) => (
            (item.tabGroup || item.category || '').trim() === currentSettingsTabGroup
        )),
        [currentSettingsTabGroup, items],
    );
    const allPdfTagOptions = useMemo(() => normalizeRegionTags([
        ...DEFAULT_PDF_TAG_OPTIONS,
        ...(draft.pdfRegions || []).flatMap((region) => region.tags || []),
    ]), [draft.pdfRegions]);
    const displayedPdfRegions = useMemo(
        () => isPdfShortcutExpanded ? (draft.pdfRegions || []) : (draft.pdfRegions || []).slice(0, 12),
        [draft.pdfRegions, isPdfShortcutExpanded],
    );
    const activePdfShortcutCount = useMemo(
        () => (draft.pdfRegions || []).filter((region) => region.shortcutEnabled !== false).length,
        [draft.pdfRegions],
    );
    const activePdfTagCount = useMemo(
        () => new Set((draft.pdfRegions || []).flatMap((region) => region.tags || [])).size,
        [draft.pdfRegions],
    );
    const activePendingPdfUpload = useMemo(
        () => pendingPdfUploads.find((upload) => upload.id === activePendingPdfId) || pendingPdfUploads[0] || null,
        [activePendingPdfId, pendingPdfUploads],
    );
    const settingsPdfPreviewUrl = draft.type === 'pdf'
        ? (selectedFilePreviewUrl || draft.fileUrl || '')
        : '';

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 lg:flex-row lg:p-10">
                <MapSidebar
                    heading="지도"
                    items={sidebarItems}
                    selectedId={`map-group:${currentDisplayGroup?.key || ''}`}
                    onSelect={(id) => {
                        const nextGroupKey = id.replace(/^map-group:/u, '');
                        const nextGroup = displayGroupMap.get(nextGroupKey);
                        setSelectedId(nextGroup?.items[0]?.id || '');
                    }}
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
                            className={`inline-flex min-w-[44px] items-center justify-center rounded-lg border px-2 py-1 text-xs font-extrabold leading-none transition ${
                                isReorderMode
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : 'border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700'
                            }`}
                            aria-label="지도 순서 변경"
                            title="지도 순서 변경"
                        >
                            순서
                        </button>
                    )}
                    renderItemAction={(item) => (
                        isReorderMode ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    onClick={() => void handleMoveItem(item.id, 'up')}
                                    disabled={displayGroups[0]?.key === item.id.replace(/^map-group:/u, '')}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-30"
                                    aria-label={`${item.title} 위로 이동`}
                                    title="위로 이동"
                                >
                                    <i className="fas fa-chevron-up text-xs"></i>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleMoveItem(item.id, 'down')}
                                    disabled={displayGroups[displayGroups.length - 1]?.key === item.id.replace(/^map-group:/u, '')}
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
                                    handleOpenTabRename(item.id.replace(/^map-group:/u, ''));
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-gray-400 transition hover:border-gray-200 hover:bg-white hover:text-gray-700"
                                aria-label={`${item.title} 탭 이름 설정`}
                                title="탭 이름 설정"
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
                            <p className="mt-3">지도 자료를 불러오는 중입니다.</p>
                        </div>
                    ) : currentPreviewItem ? (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            <div className="border-b border-gray-100 p-8 pb-4">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                                            {currentPreviewItem.category}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h1 className="text-2xl font-extrabold text-gray-900">
                                                {currentDisplayGroup?.title || currentPreviewItem.title}
                                            </h1>
                                            <button
                                                type="button"
                                                onClick={() => handleOpenSettings(currentPreviewItem.id)}
                                                className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                            >
                                                편집
                                            </button>
                                        </div>
                                    </div>
                                    {previewExternalUrl && (
                                        <a
                                            href={previewExternalUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                        >
                                            <i className="fas fa-up-right-from-square"></i>
                                            새 창에서 열기
                                        </a>
                                    )}
                                </div>
                            </div>

                            {currentDisplayItems.length > 1 && (
                                <div className="border-b border-gray-100 px-6">
                                    <div className="flex overflow-x-auto">
                                        {currentDisplayItems.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => setSelectedId(item.id)}
                                                className={`shrink-0 border-b-2 px-4 py-4 text-sm font-bold transition ${
                                                    currentPreviewItem.id === item.id
                                                        ? 'border-blue-600 text-blue-600'
                                                        : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                                }`}
                                            >
                                                {item.title}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-gray-50 p-4 md:p-6">
                                <MapViewer
                                    item={currentPreviewItem}
                                    googleSearchQuery={currentPreviewItem.type === 'google'
                                        ? (currentPreviewItem.googleQuery || '')
                                        : undefined}
                                    onGoogleSearchQueryChange={currentPreviewItem.type === 'google'
                                        ? (value) => handleDraftChange('googleQuery', value)
                                        : undefined}
                                    showShell={false}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                            지도를 선택해 주세요.
                        </div>
                    )}
                </section>
            </main>

            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                    <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 p-6 md:p-8">
                            <div>
                                <h2 className="text-xl font-extrabold text-gray-900">지도 편집</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    지도 탭, 제목, 분류, 파일, 태그, 바로가기를 이 창에서 편집합니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                                aria-label="설정 닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {settingsTabs.length > 1 && (
                            <div className="overflow-x-auto border-y border-gray-100 px-6 md:px-8">
                                <div className="flex min-w-max">
                                    {settingsTabs.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleOpenSettings(item.id)}
                                            className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
                                                draft.id === item.id
                                                    ? 'border-blue-600 text-blue-600'
                                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                                            }`}
                                        >
                                            {item.title}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
                            <div className="min-w-0">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">지도 탭</label>
                                        <input
                                            type="text"
                                            value={draft.tabGroup || ''}
                                            onChange={(e) => handleDraftChange('tabGroup', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="예: 한반도"
                                        />
                                        <p className="mt-1 text-xs text-gray-400">해당 지도가 속하는 상위 탭 이름입니다.</p>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">지도 제목</label>
                                        <input
                                            type="text"
                                            value={draft.title}
                                            onChange={(e) => handleDraftChange('title', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="예: 한반도 자연지형 지도"
                                        />
                                        <p className="mt-1 text-xs text-gray-400">가로 하위 탭에 표시되는 제목입니다.</p>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">분류</label>
                                        <input
                                            type="text"
                                            value={draft.category}
                                            onChange={(e) => handleDraftChange('category', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="예: 한국사"
                                        />
                                        <p className="mt-1 text-xs text-gray-400">지도 이름 옆 배지에만 표시되는 유형입니다.</p>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">지도 유형</label>
                                        <select
                                            value={draft.type}
                                            onChange={(e) => handleTypeChange(e.target.value as MapResourceType)}
                                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                                        >
                                            <option value="pdf">PDF</option>
                                            <option value="google">구글 지도</option>
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
                                        placeholder="학생에게 보여줄 지도 설명을 입력하세요."
                                    />
                                </div>
                                {acceptsFile && (
                                    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-gray-500">
                                                PDF 파일 업로드
                                            </label>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".pdf,application/pdf"
                                                multiple={draft.type === 'pdf'}
                                                onClick={(e) => {
                                                    (e.currentTarget as HTMLInputElement).value = '';
                                                }}
                                                onChange={(e) => void handleFileInputChange(e)}
                                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                                            />
                                            {draft.type === 'pdf' && pendingPdfUploads.length > 0 && (
                                                <div className="mt-3 space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                    {pendingPdfUploads.map((upload) => (
                                                        <div
                                                            key={upload.id}
                                                            className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
                                                                activePendingPdfUpload?.id === upload.id
                                                                    ? 'border-blue-200 bg-blue-50'
                                                                    : 'border-gray-200 bg-white'
                                                            }`}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePendingPdfUploadSelect(upload.id)}
                                                                className="min-w-0 flex-1 truncate text-left font-medium text-gray-700"
                                                            >
                                                                {upload.file.name}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePendingPdfUploadRemove(upload.id)}
                                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:bg-white hover:text-red-500"
                                                                aria-label={`${upload.file.name} 삭제`}
                                                                title="파일 삭제"
                                                            >
                                                                <i className="fas fa-times text-xs"></i>
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {isPreparingPdfUploads && (
                                                <div className="mt-2 text-xs font-medium text-blue-600">PDF 미리보기와 키워드를 추출하는 중입니다.</div>
                                            )}
                                            {draft.type === 'pdf' && (
                                                <div className="mt-2 text-xs text-gray-500">
                                                    여러 파일을 함께 선택하면 각각 별도 지도 자료로 저장됩니다.
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-2 text-xs leading-6 text-gray-500">
                                            <div>현재 파일: {selectedFile?.name || draft.fileName || '선택된 파일 없음'}</div>
                                            <div>
                                                {draft.type === 'pdf'
                                                    ? '여러 PDF를 동시에 고르면 각각의 지도 자료로 저장할 수 있습니다.'
                                                    : '이미지 파일은 업로드 후 바로 미리보기에 반영됩니다.'}
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
                                            <label className="mb-1 block text-xs font-bold text-gray-500">구글 지도 검색어</label>
                                            <input
                                                type="text"
                                                value={draft.googleQuery || ''}
                                                onChange={(e) => handleDraftChange('googleQuery', e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="예: 서울 경복궁"
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
                                    </div>
                                )}

                                {draft.type === 'pdf' && (draft.pdfRegions?.length || 0) > 0 && (
                                    <div className="mt-6">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-900">지역 바로가기 명칭 수정</h3>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    이름 수정, 바로가기 표시, 태그 지정을 함께 편집합니다.
                                                </p>
                                            </div>
                                            <div className="text-xs font-medium text-gray-400">{(draft.pdfRegions || []).length}개</div>
                                        </div>
                                        <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                            {displayedPdfRegions.map((region) => {
                                                const index = (draft.pdfRegions || []).findIndex((item) => (
                                                    item.page === region.page
                                                    && item.left === region.left
                                                    && item.top === region.top
                                                    && item.label === region.label
                                                ));

                                                return (
                                                    <div key={`${region.page}-${region.left}-${region.top}-${index}`} className="space-y-3 rounded-xl bg-white p-3">
                                                        <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
                                                            <div className="text-xs font-bold text-gray-500">p.{region.page}</div>
                                                            <input
                                                                type="text"
                                                                value={region.label}
                                                                onChange={(e) => handlePdfRegionLabelChange(index, e.target.value)}
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="지역 바로가기 이름"
                                                            />
                                                            <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={region.shortcutEnabled !== false}
                                                                    onChange={(e) => handlePdfRegionShortcutToggle(index, e.target.checked)}
                                                                    className="h-4 w-4 rounded border-gray-300"
                                                                />
                                                                바로가기
                                                            </label>
                                                        </div>

                                                        <div>
                                                            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Tag</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {allPdfTagOptions.map((tag) => {
                                                                    const checked = (region.tags || []).includes(tag);
                                                                    return (
                                                                        <label
                                                                            key={`${region.page}-${index}-${tag}`}
                                                                            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                                                                                checked
                                                                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                                            }`}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={checked}
                                                                                onChange={(e) => handlePdfRegionTagToggle(index, tag, e.target.checked)}
                                                                                className="h-3.5 w-3.5 rounded border-gray-300"
                                                                            />
                                                                            {tag}
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-col gap-2 md:flex-row">
                                                            <input
                                                                type="text"
                                                                value={customTagInputs[index] || ''}
                                                                onChange={(e) => handlePdfRegionCustomTagInputChange(index, e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        handlePdfRegionAddCustomTag(index);
                                                                    }
                                                                }}
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                placeholder="직접 태그 추가"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePdfRegionAddCustomTag(index)}
                                                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                                            >
                                                                태그 추가
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {(draft.pdfRegions || []).length > 12 && (
                                            <button
                                                type="button"
                                                onClick={() => setIsPdfShortcutExpanded((prev) => !prev)}
                                                className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                            >
                                                {isPdfShortcutExpanded ? '접기' : `더 보기 (${(draft.pdfRegions || []).length - 12}개 더)`}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0 space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">Preview</div>
                                        <h3 className="mt-2 text-lg font-extrabold text-gray-900">
                                            {draft.type === 'pdf' ? 'PDF 상세 보기' : '미리보기'}
                                        </h3>
                                        <p className="mt-1 text-sm text-gray-500">
                                            {draft.type === 'pdf'
                                                ? '업로드한 PDF 파일과 추출 상태를 우측에서 바로 확인합니다.'
                                                : '현재 설정한 지도 내용을 우측 미리보기에서 바로 확인합니다.'}
                                        </p>
                                    </div>
                                    {draft.type === 'pdf' && (
                                        <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold text-gray-600">
                                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                <div className="text-[11px] text-gray-400">파일</div>
                                                <div className="mt-1">{selectedFile ? '준비됨' : draft.fileUrl ? '저장됨' : '신규'}</div>
                                            </div>
                                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                <div className="text-[11px] text-gray-400">페이지</div>
                                                <div className="mt-1">{draft.pdfPageImages?.length || 0}</div>
                                            </div>
                                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                <div className="text-[11px] text-gray-400">바로가기</div>
                                                <div className="mt-1">{activePdfShortcutCount}</div>
                                            </div>
                                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                <div className="text-[11px] text-gray-400">태그</div>
                                                <div className="mt-1">{activePdfTagCount}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {draft.type === 'pdf' ? (
                                    settingsPdfPreviewUrl ? (
                                        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                                            <PdfMapViewer
                                                fileUrl={settingsPdfPreviewUrl}
                                                storagePath={selectedFile ? undefined : draft.storagePath}
                                                title={draft.title || selectedFile?.name || 'PDF 지도'}
                                                pageImages={draft.pdfPageImages || []}
                                                regions={draft.pdfRegions || []}
                                            />
                                        </div>
                                    ) : (
                                        <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-sm text-gray-500">
                                            PDF 파일을 선택하면 이 영역에서 미리보기와 추출 결과를 바로 확인할 수 있습니다.
                                        </div>
                                    )
                                ) : (
                                    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                                        <MapViewer
                                            item={draft}
                                            googleSearchQuery={draft.type === 'google' ? (draft.googleQuery || '') : undefined}
                                            onGoogleSearchQueryChange={draft.type === 'google'
                                                ? (value) => handleDraftChange('googleQuery', value)
                                                : undefined}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-t border-gray-100 px-6 py-6 md:px-8">
                            <div className="flex flex-wrap items-center justify-between gap-3">
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
                </div>
            )}

            {isTabRenameOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-extrabold text-gray-900">지도 탭 이름 변경</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    좌측 탭에 표시되는 이름만 먼저 바꿉니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsTabRenameOpen(false)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                                aria-label="탭 이름 설정 닫기"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="mt-5">
                            <label className="mb-1 block text-xs font-bold text-gray-500">지도 탭</label>
                            <input
                                type="text"
                                value={tabRenameValue}
                                onChange={(e) => setTabRenameValue(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                placeholder="예: 한반도"
                            />
                        </div>

                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsTabRenameOpen(false)}
                                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                            >
                                닫기
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveTabRename()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                            >
                                저장
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageMaps;
