import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import {
    DEFAULT_PDF_ERA_TAGS,
    DEFAULT_PDF_REGION_TAGS,
    DEFAULT_PDF_TAG_SECTIONS,
    type PdfMapPageImage,
    type PdfMapRegion,
    type PdfTagSection,
} from '../../lib/mapResources';
import { extractPdfTextRegions } from '../../lib/pdfTextRegions';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

interface PdfMapViewerProps {
    fileUrl: string;
    storagePath?: string;
    title: string;
    pageImages?: PdfMapPageImage[];
    regions?: PdfMapRegion[];
    tagSections?: PdfTagSection[];
    onRenameTagSection?: (sectionId: string) => void;
    onAddTagSection?: () => void;
}

interface RegionHit {
    label: string;
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
    shortcutEnabled?: boolean;
    tags?: string[];
}

interface TagSection {
    id: string;
    heading: string;
    tags: string[];
}

const PREVIEW_PADDING = 24;
const BUILT_IN_TAG_ORDER = [...DEFAULT_PDF_REGION_TAGS, ...DEFAULT_PDF_ERA_TAGS];
const SHORTCUT_LIMIT = 6;
const TAG_ROW_LIMIT = 5;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const createRegionKey = (region: RegionHit) => `${region.label}-${region.page}-${region.left}-${region.top}`;

const getRegionOverlayMetrics = (
    region: RegionHit,
    label: string,
    scale: number,
    minWidthPx: number,
    minHeightPx: number,
    padXPx: number,
    padYPx: number,
) => {
    const estimatedLabelWidth = Math.max(0, label.length) * 11 + 24;
    const rawWidth = region.width * scale;
    const rawHeight = region.height * scale;
    const extraScale = Math.max(0, scale - 1);
    const effectivePadY = padYPx + Math.min(extraScale * 3.5, 8);
    const effectiveMinHeight = Math.max(minHeightPx, rawHeight * Math.min(1.2, 0.82 + (extraScale * 0.24)));
    const verticalBiasRatio = Math.min(0.52, 0.22 + (extraScale * 0.12));
    const heightTrimRatio = Math.min(0.12, 0.02 + (extraScale * 0.03));
    const verticalBias = Math.min(Math.max(rawHeight * verticalBiasRatio, 3), 14);
    const width = Math.max(rawWidth + (padXPx * 2), minWidthPx, estimatedLabelWidth);
    const height = Math.max(rawHeight + (effectivePadY * 2) - verticalBias - (rawHeight * heightTrimRatio), effectiveMinHeight);
    const left = Math.max(0, (region.left * scale) - padXPx);
    const top = Math.max(0, (region.top * scale) - effectivePadY + verticalBias);

    return {
        width,
        height,
        left,
        top,
    };
};

const getRegionOverlayStyle = (
    region: RegionHit,
    label: string,
    scale: number,
    minWidthPx: number,
    minHeightPx: number,
    padXPx: number,
    padYPx: number,
) => {
    const metrics = getRegionOverlayMetrics(region, label, scale, minWidthPx, minHeightPx, padXPx, padYPx);

    return {
        left: `${metrics.left}px`,
        top: `${metrics.top}px`,
        width: `${metrics.width}px`,
        height: `${metrics.height}px`,
    };
};

const getRegionLabelStyle = (
    region: RegionHit,
    scale: number,
    minWidthPx: number,
    padXPx: number,
    padYPx: number,
) => {
    const metrics = getRegionOverlayMetrics(region, region.label, scale, minWidthPx, 0, padXPx, padYPx);

    return {
        maxWidth: `${Math.max(metrics.width, 88)}px`,
        top: metrics.top > 34 ? '-26px' : 'calc(100% + 6px)',
    };
};

const getRegionFocusZoom = (
    fitZoom: number,
    isMobileViewport: boolean,
) => clamp(
    Math.max(fitZoom * (isMobileViewport ? 1.45 : 1.7), isMobileViewport ? 1.1 : 1.25),
    Math.max(fitZoom, 1),
    isMobileViewport ? 1.85 : 2.35,
);

const sanitizeRegionLabel = (value: string) => value
    .replace(/\s*[→].*$/u, '')
    .replace(/\([^)]*\)/gu, '')
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/[,:;]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`${label}-timeout`)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
        }
    }
};

const sortTags = (tags: string[]) => [...tags].sort((a, b) => {
    const indexA = BUILT_IN_TAG_ORDER.indexOf(a as (typeof BUILT_IN_TAG_ORDER)[number]);
    const indexB = BUILT_IN_TAG_ORDER.indexOf(b as (typeof BUILT_IN_TAG_ORDER)[number]);
    if (indexA !== -1 || indexB !== -1) {
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    }
    return a.localeCompare(b, 'ko');
});

const PdfMapViewer: React.FC<PdfMapViewerProps> = ({
    fileUrl,
    storagePath,
    title,
    pageImages = [],
    regions = [],
    tagSections: tagSectionConfig = DEFAULT_PDF_TAG_SECTIONS,
    onRenameTagSection,
    onAddTagSection,
}) => {
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [fitZoom, setFitZoom] = useState(1);
    const [regionHits, setRegionHits] = useState<RegionHit[]>([]);
    const [selectedRegion, setSelectedRegion] = useState<RegionHit | null>(null);
    const [selectedTag, setSelectedTag] = useState('');
    const [showAllShortcuts, setShowAllShortcuts] = useState(false);
    const [isInlineTagCatalogOpen, setIsInlineTagCatalogOpen] = useState(false);
    const [isModalTagCatalogOpen, setIsModalTagCatalogOpen] = useState(false);
    const [expandedTagSections, setExpandedTagSections] = useState<Record<string, boolean>>({});
    const [pdfSourceUrl, setPdfSourceUrl] = useState('');
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [nativeViewerFallback, setNativeViewerFallback] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [previewScale, setPreviewScale] = useState(1);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isMobileTagPanelOpen, setIsMobileTagPanelOpen] = useState(false);

    const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
    const inlineShortcutRef = useRef<HTMLDivElement | null>(null);
    const modalSurfaceRef = useRef<HTMLDivElement | null>(null);
    const modalRegionHighlightRef = useRef<HTMLDivElement | null>(null);
    const modalPageFrameRef = useRef<HTMLDivElement | null>(null);
    const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
    const dragStateRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const touchDragStateRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const hasManualZoomRef = useRef(false);
    const pendingAutoFocusRegionKeyRef = useRef('');

    const usingPreprocessedPages = pageImages.length > 0;
    const allRegionHits = useMemo(() => (usingPreprocessedPages ? regions : regionHits), [regionHits, regions, usingPreprocessedPages]);

    const visibleRegionHits = useMemo(() => {
        const seen = new Set<string>();
        return allRegionHits
            .map((item) => ({
                ...item,
                label: sanitizeRegionLabel(item.label),
                tags: Array.from(new Set((item.tags || []).map((tag) => String(tag || '').trim()).filter(Boolean))),
            }))
            .filter((item) => {
                if (item.shortcutEnabled === false) return false;
                if (!item.label || item.label.length > 12) return false;
                if (/[(){}\[\]<>]/u.test(item.label)) return false;
                if (seen.has(item.label)) return false;
                seen.add(item.label);
                return true;
            });
    }, [allRegionHits]);

    const availableTags = useMemo(() => {
        const nextTags = new Set<string>();
        visibleRegionHits.forEach((region) => (region.tags || []).forEach((tag) => nextTags.add(tag)));
        return sortTags(Array.from(nextTags));
    }, [visibleRegionHits]);

    const normalizedTagSections = useMemo(() => (
        tagSectionConfig.map((section) => ({ ...section, tags: sortTags([...(section.tags || [])]) }))
    ), [tagSectionConfig]);

    const resolvedTagSections = useMemo<TagSection[]>(() => {
        const usedTags = new Set<string>();
        const configuredSections = normalizedTagSections.map((section) => {
            const nextTags = section.tags.filter((tag) => availableTags.includes(tag));
            nextTags.forEach((tag) => usedTags.add(tag));
            return {
                id: section.id,
                heading: section.label,
                tags: nextTags,
            };
        });

        const uncategorizedTags = availableTags.filter((tag) => !usedTags.has(tag));
        if (uncategorizedTags.length > 0) {
            configuredSections.push({
                id: 'uncategorized',
                heading: '사용자 태그',
                tags: uncategorizedTags,
            });
        }

        return configuredSections.filter((section) => section.tags.length > 0 || !!onRenameTagSection || !!onAddTagSection);
    }, [availableTags, normalizedTagSections, onAddTagSection, onRenameTagSection]);

    const filteredRegionHits = useMemo(() => (
        selectedTag ? visibleRegionHits.filter((region) => (region.tags || []).includes(selectedTag)) : visibleRegionHits
    ), [selectedTag, visibleRegionHits]);

    const shortcutSections = useMemo(() => {
        const groups = new Map<string, RegionHit[]>();
        const source = selectedTag ? filteredRegionHits : visibleRegionHits;

        const appendRegion = (tag: string, region: RegionHit) => {
            const current = groups.get(tag) || [];
            if (!current.some((item) => createRegionKey(item) === createRegionKey(region))) {
                current.push(region);
                groups.set(tag, current);
            }
        };

        source.forEach((region) => {
            const tags = sortTags((region.tags || []).filter(Boolean));
            if (selectedTag) {
                if (tags.includes(selectedTag)) {
                    appendRegion(selectedTag, region);
                }
                return;
            }

            if (tags.length === 0) {
                appendRegion('기타', region);
                return;
            }

            tags.forEach((tag) => appendRegion(tag, region));
        });

        return resolvedTagSections
            .flatMap((section) => section.tags)
            .filter((tag) => groups.has(tag))
            .map((tag) => ({
                tag,
                items: [...(groups.get(tag) || [])].sort((a, b) => a.label.localeCompare(b.label, 'ko')),
                heading: resolvedTagSections.find((section) => section.tags.includes(tag))?.heading || '사용자 태그',
            }));
    }, [filteredRegionHits, resolvedTagSections, selectedTag, visibleRegionHits]);

    const currentPageImage = pageImages[currentPage - 1] || null;
    const currentPageWidth = currentPageImage?.width || 1200;
    const currentPageHeight = currentPageImage?.height || 1600;

    useEffect(() => {
        let active = true;

        const loadPdf = async () => {
            setLoadingPdf(true);
            setLoadError('');
            setPdfSourceUrl('');
            setNativeViewerFallback(false);
            setCurrentPage(1);
            setSelectedRegion(null);
            setSelectedTag('');
            setRegionHits([]);
            setNumPages(usingPreprocessedPages ? pageImages.length : 0);
            hasManualZoomRef.current = false;

            if (usingPreprocessedPages) {
                setLoadingPdf(false);
                return;
            }

            try {
                if (fileUrl) {
                    if (!active) return;
                    setPdfSourceUrl(fileUrl);
                    return;
                }
                if (storagePath) {
                    const downloadUrl = await withTimeout(getDownloadURL(ref(storage, storagePath)), 30000, 'storage-download-url');
                    if (!active) return;
                    setPdfSourceUrl(downloadUrl);
                    return;
                }
                throw new Error('pdf-source-missing');
            } catch (error) {
                console.error('Failed to prepare PDF file:', error);
                if (!active) return;
                setLoadError(error instanceof Error ? error.message : 'pdf-load-failed');
                if (fileUrl) setNativeViewerFallback(true);
            } finally {
                if (active) setLoadingPdf(false);
            }
        };

        void loadPdf();
        return () => {
            active = false;
        };
    }, [fileUrl, pageImages.length, storagePath, usingPreprocessedPages]);

    React.useLayoutEffect(() => {
        if (!isModalOpen || !modalSurfaceRef.current || currentPageWidth <= 0 || currentPageHeight <= 0) return undefined;

        const surface = modalSurfaceRef.current;
        const updateModalFitZoom = () => {
            const insetPadding = isMobileViewport ? 8 : 48;
            const frameWidth = Math.max(0, surface.clientWidth - insetPadding);
            const frameHeight = Math.max(0, surface.clientHeight - insetPadding);
            if (!frameWidth || !frameHeight) return;

            const nextFitZoom = clamp(
                currentPageHeight > currentPageWidth
                    ? (frameHeight / currentPageHeight)
                    : Math.min(frameWidth / currentPageWidth, frameHeight / currentPageHeight),
                0.25,
                2.2,
            );

            setFitZoom(nextFitZoom);
            if (!selectedRegion && !hasManualZoomRef.current) {
                setZoom(nextFitZoom);
                surface.scrollTo({ left: 0, top: 0 });
            }
        };

        updateModalFitZoom();
        const frameId = window.requestAnimationFrame(updateModalFitZoom);
        const observer = new ResizeObserver(updateModalFitZoom);
        observer.observe(surface);
        window.addEventListener('resize', updateModalFitZoom);

        return () => {
            window.cancelAnimationFrame(frameId);
            observer.disconnect();
            window.removeEventListener('resize', updateModalFitZoom);
        };
    }, [currentPageHeight, currentPageWidth, isMobileViewport, isModalOpen, selectedRegion]);

    useEffect(() => {
        if (!usingPreprocessedPages || currentPageWidth <= 0 || !previewSurfaceRef.current) return;
        const updatePreviewScale = () => {
            if (!previewSurfaceRef.current) return;
            const nextWidth = Math.max(0, previewSurfaceRef.current.clientWidth - PREVIEW_PADDING);
            if (!nextWidth) return;
            setPreviewScale(nextWidth / currentPageWidth);
        };
        updatePreviewScale();
        const observer = new ResizeObserver(updatePreviewScale);
        observer.observe(previewSurfaceRef.current);
        window.addEventListener('resize', updatePreviewScale);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updatePreviewScale);
        };
    }, [currentPageWidth, usingPreprocessedPages]);

    useEffect(() => {
        if (!isModalOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsModalOpen(false);
        };
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = '';
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isModalOpen]);

    useEffect(() => {
        if (selectedTag && !availableTags.includes(selectedTag)) setSelectedTag('');
    }, [availableTags, selectedTag]);

    useEffect(() => {
        setExpandedTagSections({});
        setIsInlineTagCatalogOpen(false);
        setIsModalTagCatalogOpen(false);
    }, [title]);

    useEffect(() => {
        const updateViewportMode = () => {
            setIsMobileViewport(window.innerWidth < 768);
        };

        updateViewportMode();
        window.addEventListener('resize', updateViewportMode);
        return () => window.removeEventListener('resize', updateViewportMode);
    }, []);

    useEffect(() => {
        if (!isModalOpen) {
            setIsMobileTagPanelOpen(false);
            pendingAutoFocusRegionKeyRef.current = '';
        }
    }, [isModalOpen]);

    useEffect(() => {
        setShowAllShortcuts(false);
    }, [currentPage, selectedTag, title]);

    useEffect(() => {
        if (!selectedTag || !inlineShortcutRef.current) return;
        inlineShortcutRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [selectedTag]);

    useEffect(() => {
        if (!selectedRegion) return;
        if (!visibleRegionHits.find((region) => createRegionKey(region) === createRegionKey(selectedRegion))) {
            setSelectedRegion(null);
        }
    }, [selectedRegion, visibleRegionHits]);

    useEffect(() => {
        if (!isModalOpen || !selectedRegion || !modalSurfaceRef.current || selectedRegion.page !== currentPage) return undefined;
        if (pendingAutoFocusRegionKeyRef.current !== createRegionKey(selectedRegion)) return undefined;

        const targetZoom = getRegionFocusZoom(fitZoom, isMobileViewport);

        if (Math.abs(zoom - targetZoom) > 0.02) {
            setZoom(Number(targetZoom.toFixed(2)));
            return undefined;
        }

        const frameId = window.requestAnimationFrame(() => {
            const currentSurface = modalSurfaceRef.current;
            const highlight = modalRegionHighlightRef.current;
            const pageFrame = modalPageFrameRef.current;
            if (!currentSurface || !highlight || !pageFrame) return;

            const surfaceRect = currentSurface.getBoundingClientRect();
            const frameRect = pageFrame.getBoundingClientRect();
            const centerX = (selectedRegion.left + (selectedRegion.width / 2)) * zoom;
            const centerY = (selectedRegion.top + (selectedRegion.height / 2)) * zoom;
            const frameOffsetLeft = currentSurface.scrollLeft + (frameRect.left - surfaceRect.left);
            const frameOffsetTop = currentSurface.scrollTop + (frameRect.top - surfaceRect.top);
            const targetLeft = frameOffsetLeft + centerX - (currentSurface.clientWidth / 2);
            const focusTopRatio = isMobileViewport ? 0.22 : 0.28;
            const targetTop = frameOffsetTop + centerY - (currentSurface.clientHeight * focusTopRatio);

            currentSurface.scrollTo({
                left: Math.max(0, targetLeft),
                top: Math.max(0, targetTop),
                behavior: 'smooth',
            });
            pendingAutoFocusRegionKeyRef.current = '';
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [currentPage, fitZoom, isMobileViewport, isModalOpen, selectedRegion, zoom]);

    const handleLoadSuccess = async (pdf: PDFDocumentProxy) => {
        setNumPages(pdf.numPages);
        const nextHits: RegionHit[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();
            const pageHits = extractPdfTextRegions(
                textContent.items.filter((item): item is TextItem => 'str' in item),
                viewport.height,
            ).map((region) => ({ ...region, page: pageNumber, shortcutEnabled: true, tags: [] }));
            nextHits.push(...pageHits);
        }
        setRegionHits(nextHits);
    };

    const handleSelectRegion = (region: RegionHit) => {
        setIsMobileTagPanelOpen(false);
        setCurrentPage(region.page);
        setSelectedRegion(region);
        hasManualZoomRef.current = false;
        pendingAutoFocusRegionKeyRef.current = createRegionKey(region);
        if (!isModalOpen) {
            setIsModalOpen(true);
            return;
        }
    };

    const openModal = () => {
        if (loadingPdf) return;
        if (!selectedRegion) {
            hasManualZoomRef.current = false;
            setZoom(fitZoom);
        }
        setIsModalOpen(true);
    };

    const changeZoom = (delta: number) => {
        hasManualZoomRef.current = true;
        pendingAutoFocusRegionKeyRef.current = '';
        setZoom((prev) => clamp(Number((prev + delta).toFixed(2)), Math.max(0.25, fitZoom * 0.7), 4));
    };

    const handleWheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
        if (!isModalOpen) return;
        event.preventDefault();
        changeZoom(event.deltaY < 0 ? 0.12 : -0.12);
    };

    const distanceBetweenTouches = (touches: React.TouchList) => Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
    );

    const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        if (!modalSurfaceRef.current) return;
        if (event.touches.length === 2) {
            event.preventDefault();
            hasManualZoomRef.current = true;
            pendingAutoFocusRegionKeyRef.current = '';
            pinchStateRef.current = { distance: distanceBetweenTouches(event.touches), zoom };
            touchDragStateRef.current = null;
            return;
        }
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchDragStateRef.current = {
                x: touch.clientX,
                y: touch.clientY,
                left: modalSurfaceRef.current.scrollLeft,
                top: modalSurfaceRef.current.scrollTop,
            };
        }
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (!modalSurfaceRef.current) return;
        if (event.touches.length === 2 && pinchStateRef.current) {
            event.preventDefault();
            const nextDistance = distanceBetweenTouches(event.touches);
            const ratio = nextDistance / pinchStateRef.current.distance;
            setZoom(clamp(Number((pinchStateRef.current.zoom * ratio).toFixed(2)), Math.max(0.25, fitZoom * 0.7), 4));
            return;
        }
        if (event.touches.length === 1 && touchDragStateRef.current) {
            event.preventDefault();
            const touch = event.touches[0];
            modalSurfaceRef.current.scrollLeft = touchDragStateRef.current.left - (touch.clientX - touchDragStateRef.current.x);
            modalSurfaceRef.current.scrollTop = touchDragStateRef.current.top - (touch.clientY - touchDragStateRef.current.y);
        }
    };

    const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !modalSurfaceRef.current) return;
        event.preventDefault();
        pendingAutoFocusRegionKeyRef.current = '';
        dragStateRef.current = {
            x: event.clientX,
            y: event.clientY,
            left: modalSurfaceRef.current.scrollLeft,
            top: modalSurfaceRef.current.scrollTop,
        };
    };

    const handleDragMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!modalSurfaceRef.current || !dragStateRef.current) return;
        event.preventDefault();
        modalSurfaceRef.current.scrollLeft = dragStateRef.current.left - (event.clientX - dragStateRef.current.x);
        modalSurfaceRef.current.scrollTop = dragStateRef.current.top - (event.clientY - dragStateRef.current.y);
    };

    const handleDragEnd = () => {
        dragStateRef.current = null;
        pinchStateRef.current = null;
        touchDragStateRef.current = null;
    };

    const renderTagFilters = (
        isOpen: boolean,
        setIsOpen: React.Dispatch<React.SetStateAction<boolean>>,
    ) => resolvedTagSections.length > 0 && (
        <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/80 px-3 py-3">
                <div>
                    <div className="text-xs font-bold text-gray-500">태그 목차</div>
                    <div className="mt-1 text-[11px] text-gray-400">
                        {resolvedTagSections.length}개 범주, {availableTags.length}개 태그
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {onAddTagSection && isOpen && (
                        <button
                            type="button"
                            onClick={onAddTagSection}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            aria-label="태그 범주 추가"
                            title="태그 범주 추가"
                        >
                            <i className="fas fa-plus text-xs"></i>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsOpen((prev) => !prev)}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                        {isOpen ? '목차 접기' : '목차 펼치기'}
                    </button>
                </div>
            </div>
            {isOpen && (
                <>
                    <button
                        type="button"
                        onClick={() => setSelectedTag('')}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${!selectedTag ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                        전체
                    </button>
                    {resolvedTagSections.map((section) => (
                        <div key={section.heading} className="rounded-2xl border border-gray-200 bg-white/80 px-3 py-2">
                            <div className="flex items-start gap-3 text-sm">
                                <div className="shrink-0 pt-1 text-xs font-bold text-gray-400">
                                    <div className="inline-flex items-center gap-1.5">
                                        <span>{section.heading}</span>
                                        {onRenameTagSection && section.id !== 'uncategorized' && (
                                            <button
                                                type="button"
                                                onClick={() => onRenameTagSection(section.id)}
                                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                                aria-label={`${section.heading} 이름 수정`}
                                                title="범주 이름 수정"
                                            >
                                                <i className="fas fa-pen text-[10px]"></i>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {(expandedTagSections[section.heading] ? section.tags : section.tags.slice(0, TAG_ROW_LIMIT)).map((tag) => (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => setSelectedTag((prev) => (prev === tag ? '' : tag))}
                                                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition ${selectedTag === tag ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                            >
                                                <span>{tag}</span>
                                                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-700">
                                                    {visibleRegionHits.filter((region) => (region.tags || []).includes(tag)).length}
                                                </span>
                                            </button>
                                        ))}
                                        {section.tags.length > TAG_ROW_LIMIT && (
                                            <button
                                                type="button"
                                                onClick={() => setExpandedTagSections((prev) => ({
                                                    ...prev,
                                                    [section.heading]: !prev[section.heading],
                                                }))}
                                                className="inline-flex items-center rounded-full px-2 py-1 text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                                aria-label={`${section.heading} 태그 ${expandedTagSections[section.heading] ? '접기' : '펼치기'}`}
                                                title={expandedTagSections[section.heading] ? '접기' : '펼치기'}
                                            >
                                                ...
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );

    const renderShortcutList = (buttonClassName: string) => (
        <>
            <div className="mb-2 text-xs font-bold text-gray-500">지역 목차</div>
            {shortcutSections.length > 0 ? (
                <div className="space-y-4">
                    {shortcutSections.map((section, index) => {
                        const visibleItems = showAllShortcuts || selectedTag ? section.items : section.items.slice(0, SHORTCUT_LIMIT);
                        const showHeading = index === 0 || shortcutSections[index - 1]?.heading !== section.heading;

                        return (
                            <div key={section.tag} className="space-y-2">
                                {showHeading && (
                                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">{section.heading}</div>
                                )}
                                <div className="rounded-2xl border border-gray-200 bg-white/80 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedTag((prev) => (prev === section.tag ? '' : section.tag))}
                                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition ${selectedTag === section.tag ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                        >
                                            <span>{section.tag}</span>
                                            <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-700">{section.items.length}</span>
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {visibleItems.map((region) => (
                                            <button
                                                key={`${section.tag}-${createRegionKey(region)}`}
                                                type="button"
                                                onClick={() => handleSelectRegion(region)}
                                                className={`${buttonClassName} ${selectedRegion && createRegionKey(selectedRegion) === createRegionKey(region) ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                            >
                                                {region.label}
                                            </button>
                                        ))}
                                    </div>
                                    {!showAllShortcuts && !selectedTag && section.items.length > SHORTCUT_LIMIT && (
                                        <div className="mt-2 text-[11px] font-medium text-gray-400">+ {section.items.length - SHORTCUT_LIMIT}개 더 있음</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {shortcutSections.some((section) => section.items.length > SHORTCUT_LIMIT) && !selectedTag && (
                        <button
                            type="button"
                            onClick={() => setShowAllShortcuts((prev) => !prev)}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                        >
                            {showAllShortcuts ? '접기' : '전체 펼치기'}
                        </button>
                    )}
                </div>
            ) : (
                <p className="text-xs text-gray-500">선택한 태그에 해당하는 지역이 없습니다.</p>
            )}
        </>
    );

    const renderPageSurface = (interactive: boolean, compact = false) => {
        const surfaceScale = interactive && usingPreprocessedPages ? previewScale || 1 : zoom;
        const isPortrait = currentPageHeight > currentPageWidth;

        return (
            <div
                ref={interactive ? previewSurfaceRef : undefined}
                className={`${
                    compact
                        ? 'h-full rounded-none border-0 bg-transparent p-0'
                        : 'rounded-2xl border border-gray-200 bg-gray-100 p-3'
                } ${interactive ? 'cursor-zoom-in overflow-auto' : 'overflow-visible'}`}
                onClick={interactive ? openModal : undefined}
            >
                {loadingPdf && <div className="rounded-xl bg-white px-4 py-6 text-sm text-gray-500">PDF 파일을 준비하고 있습니다.</div>}
                {!loadingPdf && loadError && !nativeViewerFallback && (
                    <div className="rounded-xl bg-white px-4 py-6 text-sm text-red-600">
                        PDF 파일을 불러오지 못했습니다.
                        <div className="mt-2 text-xs text-gray-500">{loadError}</div>
                    </div>
                )}
                {!loadingPdf && nativeViewerFallback && fileUrl && (
                    <div className="space-y-3">
                        <div className="rounded-xl bg-white px-4 py-4 text-sm text-amber-700">
                            PDF 추출 보기에 실패해 브라우저 기본 뷰어로 대신 표시합니다.
                            <div className="mt-2 text-xs text-gray-500">{loadError}</div>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                            <iframe src={fileUrl} title={`${title} PDF`} className="h-[72vh] w-full" />
                        </div>
                    </div>
                )}
                {!loadingPdf && usingPreprocessedPages && currentPageImage && (
                    <div className={`relative flex ${compact || isPortrait ? 'justify-center' : 'justify-start'}`}>
                        <div
                            ref={interactive ? undefined : modalPageFrameRef}
                            className="relative inline-block"
                        >
                            <img
                                src={currentPageImage.imageUrl}
                                alt={`${title} ${currentPage}페이지`}
                                style={{
                                    width: `${currentPageImage.width * surfaceScale}px`,
                                    maxWidth: interactive ? '100%' : 'none',
                                    height: 'auto',
                                }}
                            />
                            {selectedRegion && selectedRegion.page === currentPage && (
                                <div
                                    ref={interactive ? undefined : modalRegionHighlightRef}
                                    className="pointer-events-none absolute"
                                    style={getRegionOverlayStyle(
                                        selectedRegion,
                                        selectedRegion.label,
                                        surfaceScale,
                                        interactive ? 96 : 108,
                                        interactive ? 28 : 32,
                                        interactive ? 12 : 16,
                                        interactive ? 4 : 5,
                                    )}
                                >
                                    <div className="relative h-full w-full rounded-lg border-[3px] border-red-500 bg-red-200/10 shadow-[0_0_0_2px_rgba(255,255,255,0.92)]">
                                        <div
                                            className="absolute left-0 whitespace-nowrap rounded-full border border-red-300 bg-white px-2 py-0.5 text-[10px] font-extrabold leading-none text-red-600 shadow-sm"
                                            style={getRegionLabelStyle(
                                                selectedRegion,
                                                surfaceScale,
                                                interactive ? 96 : 108,
                                                interactive ? 12 : 16,
                                                interactive ? 4 : 5,
                                            )}
                                        >
                                            {selectedRegion.label}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {!loadingPdf && !loadError && !usingPreprocessedPages && pdfSourceUrl && (
                    <Document
                        file={pdfSourceUrl}
                        onLoadSuccess={handleLoadSuccess}
                        onLoadError={(error) => setLoadError(error.message || 'pdf-render-failed')}
                        loading="PDF를 불러오는 중입니다."
                    >
                        <div
                            ref={interactive ? undefined : modalPageFrameRef}
                            className="relative inline-block"
                        >
                            <Page pageNumber={currentPage} scale={zoom} renderTextLayer renderAnnotationLayer loading="페이지를 불러오는 중입니다." />
                            {selectedRegion && selectedRegion.page === currentPage && (
                                <div
                                    ref={interactive ? undefined : modalRegionHighlightRef}
                                    className="pointer-events-none absolute"
                                    style={getRegionOverlayStyle(
                                        selectedRegion,
                                        selectedRegion.label,
                                        zoom,
                                        isMobileViewport ? 96 : 136,
                                        isMobileViewport ? 28 : 34,
                                        isMobileViewport ? 12 : 18,
                                        isMobileViewport ? 4 : 6,
                                    )}
                                >
                                    <div className="relative h-full w-full rounded-lg border-[3px] border-red-500 bg-red-200/10 shadow-[0_0_0_2px_rgba(255,255,255,0.92)]">
                                        <div
                                            className="absolute left-0 whitespace-nowrap rounded-full border border-red-300 bg-white px-2.5 py-1 text-[11px] font-extrabold leading-none text-red-600 shadow-sm"
                                            style={getRegionLabelStyle(
                                                selectedRegion,
                                                zoom,
                                                isMobileViewport ? 96 : 136,
                                                isMobileViewport ? 12 : 18,
                                                isMobileViewport ? 4 : 6,
                                            )}
                                        >
                                            {selectedRegion.label}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Document>
                )}
            </div>
        );
    };

    const modalContent = isModalOpen ? (
        <div className={`fixed inset-0 z-[70] flex bg-slate-950/70 ${isMobileViewport ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-2 sm:p-4'}`} onClick={() => setIsModalOpen(false)}>
            <div className={`relative flex w-full flex-col overflow-hidden bg-white shadow-2xl ${isMobileViewport ? 'h-screen max-w-none rounded-none' : 'h-[94vh] max-w-[96vw] rounded-2xl sm:h-[90vh] sm:rounded-3xl'}`} onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-3 sm:px-5 sm:py-4">
                            <div>
                                <div className="text-base font-extrabold text-gray-900 sm:text-lg">{title}</div>
                                {!isMobileViewport && <div className="text-xs text-gray-500">바깥 클릭 또는 Esc로 닫습니다.</div>}
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedRegion(null);
                                        hasManualZoomRef.current = false;
                                        setZoom(fitZoom);
                                        modalSurfaceRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
                                    }}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm"
                                >
                                    전체 보기
                                </button>
                                <button type="button" onClick={() => changeZoom(-0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm">-</button>
                                <div className="w-14 text-center text-xs font-bold text-gray-700 sm:w-16 sm:text-sm">{Math.round(zoom * 100)}%</div>
                                <button type="button" onClick={() => changeZoom(0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm">+</button>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm">닫기</button>
                            </div>
                        </div>
                        <div className={`grid min-h-0 flex-1 ${isMobileViewport ? 'grid-cols-1' : 'lg:grid-cols-[21rem_minmax(0,1fr)]'}`}>
                            {!isMobileViewport && (
                            <aside className="order-2 min-h-0 border-t border-gray-200 bg-gray-50 p-3 lg:order-1 lg:border-r lg:border-t-0 lg:p-4">
                                {renderTagFilters(isModalTagCatalogOpen, setIsModalTagCatalogOpen)}
                                <div className="max-h-52 overflow-y-auto pr-1 lg:max-h-[calc(90vh-12rem)]">
                                    {renderShortcutList('rounded-xl px-3 py-2 text-left text-xs font-bold transition')}
                                </div>
                            </aside>
                            )}
                            <div className="order-1 flex min-h-0 flex-1 flex-col lg:order-2">
                                <div className="flex items-center justify-center border-b border-gray-200 px-3 py-2 sm:px-5 sm:py-3">
                                    <div className="text-sm font-bold text-gray-600">{currentPage} / {numPages || '-'}</div>
                                </div>
                                <div className={`flex min-h-0 flex-1 items-center justify-center bg-slate-100 ${isMobileViewport ? 'p-0' : 'p-2 sm:p-4'}`}>
                                    <div className={`flex h-full w-full flex-col overflow-hidden bg-slate-100 ${isMobileViewport ? 'rounded-none border-0' : 'rounded-2xl border border-gray-200 shadow-sm'}`}>
                                        <div
                                            ref={modalSurfaceRef}
                                            className={`min-h-0 flex-1 cursor-grab overflow-auto bg-slate-100 active:cursor-grabbing ${isMobileViewport ? 'p-0' : 'p-0'}`}
                                            style={isMobileViewport ? { touchAction: 'none' } : undefined}
                                            onWheel={handleWheelZoom}
                                            onTouchStart={handleTouchStart}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={handleDragEnd}
                                            onTouchCancel={handleDragEnd}
                                            onMouseDown={handleDragStart}
                                            onMouseMove={handleDragMove}
                                            onMouseUp={handleDragEnd}
                                            onMouseLeave={handleDragEnd}
                                        >
                                            <div className={`flex min-h-full items-start ${zoom > (fitZoom + 0.01) ? 'justify-start' : 'justify-center'}`}>
                                                {renderPageSurface(false, isMobileViewport)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        {isMobileViewport && visibleRegionHits.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setIsMobileTagPanelOpen((prev) => !prev)}
                                    className="absolute bottom-5 right-5 z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl transition hover:bg-blue-700"
                                    aria-label="태그 목록 열기"
                                >
                                    <i className="fas fa-tags text-lg"></i>
                                </button>
                                {isMobileTagPanelOpen && (
                                    <div className="absolute inset-x-0 bottom-0 z-30 max-h-[58vh] rounded-t-[28px] border-t border-gray-200 bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.2)]">
                                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                                            <div>
                                                <div className="text-sm font-extrabold text-gray-900">태그 목록</div>
                                                <div className="text-xs text-gray-500">태그를 누르면 지도 위치로 이동합니다.</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setIsMobileTagPanelOpen(false)}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500"
                                                aria-label="태그 목록 닫기"
                                            >
                                                <i className="fas fa-times text-xs"></i>
                                            </button>
                                        </div>
                                        <div className="max-h-[calc(58vh-4.5rem)] overflow-y-auto p-4">
                                            {renderShortcutList('rounded-xl px-3 py-2 text-left text-sm font-bold transition')}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
            </div>
        </div>
    ) : null;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <h3 className="text-base font-extrabold text-gray-900 sm:text-lg">{title || '지도'}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={openModal} disabled={loadingPdf} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40 sm:text-sm">확대 보기</button>
                        <button type="button" onClick={() => changeZoom(-0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm">축소</button>
                        <span className="w-14 text-center text-xs font-bold text-gray-600 sm:w-16 sm:text-sm">{Math.round(zoom * 100)}%</span>
                        <button type="button" onClick={() => changeZoom(0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:text-sm">확대</button>
                    </div>
                </div>
                {visibleRegionHits.length > 0 && (
                    <div className="mb-4">
                        {renderTagFilters(isInlineTagCatalogOpen, setIsInlineTagCatalogOpen)}
                    </div>
                )}
                {selectedTag && (
                    <div ref={inlineShortcutRef} className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
                        {renderShortcutList('rounded-xl px-3 py-2 text-left text-xs font-bold transition')}
                    </div>
                )}
                {renderPageSurface(true)}
                <p className="mt-3 text-xs leading-6 text-gray-500">PDF 지도를 클릭하면 확대 모달이 열립니다. 모바일에서는 핀치 확대와 스크롤 이동으로 볼 수 있습니다.</p>
                <p className="mt-2 text-xs leading-6 text-gray-500">태그 목차는 기본으로 접혀 있으며, 필요할 때 펼쳐서 범주별로 볼 수 있습니다.</p>
            </div>
            {modalContent && typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent}
        </div>
    );
};

export default PdfMapViewer;
