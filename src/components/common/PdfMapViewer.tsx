import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import {
    DEFAULT_PDF_ERA_TAGS,
    DEFAULT_PDF_REGION_TAGS,
    type PdfMapPageImage,
    type PdfMapRegion,
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
    heading: string;
    tags: string[];
}

const PREVIEW_PADDING = 24;
const BUILT_IN_TAG_ORDER = [...DEFAULT_PDF_REGION_TAGS, ...DEFAULT_PDF_ERA_TAGS];
const SHORTCUT_LIMIT = 6;
const TAG_SECTION_ORDER = ['시대별', '지도 관련', '사용자 태그'] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const createRegionKey = (region: RegionHit) => `${region.label}-${region.page}-${region.left}-${region.top}`;

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

const getTagSectionHeading = (tag: string) => {
    if (DEFAULT_PDF_ERA_TAGS.includes(tag as (typeof DEFAULT_PDF_ERA_TAGS)[number])) return '시대별';
    if (DEFAULT_PDF_REGION_TAGS.includes(tag as (typeof DEFAULT_PDF_REGION_TAGS)[number])) return '지도 관련';
    return '사용자 태그';
};

const PdfMapViewer: React.FC<PdfMapViewerProps> = ({
    fileUrl,
    storagePath,
    title,
    pageImages = [],
    regions = [],
}) => {
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [fitZoom, setFitZoom] = useState(1);
    const [regionHits, setRegionHits] = useState<RegionHit[]>([]);
    const [selectedRegion, setSelectedRegion] = useState<RegionHit | null>(null);
    const [selectedTag, setSelectedTag] = useState('');
    const [showAllShortcuts, setShowAllShortcuts] = useState(false);
    const [pdfSourceUrl, setPdfSourceUrl] = useState('');
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [nativeViewerFallback, setNativeViewerFallback] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [previewScale, setPreviewScale] = useState(1);

    const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
    const modalSurfaceRef = useRef<HTMLDivElement | null>(null);
    const modalRegionHighlightRef = useRef<HTMLDivElement | null>(null);
    const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
    const dragStateRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

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

    const tagSections = useMemo<TagSection[]>(() => {
        const sections = new Map<string, string[]>();
        availableTags.forEach((tag) => {
            const heading = getTagSectionHeading(tag);
            const current = sections.get(heading) || [];
            current.push(tag);
            sections.set(heading, current);
        });

        return TAG_SECTION_ORDER
            .filter((heading) => (sections.get(heading) || []).length > 0)
            .map((heading) => ({
                heading,
                tags: sortTags(sections.get(heading) || []),
            }));
    }, [availableTags]);

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

        return tagSections
            .flatMap((section) => section.tags)
            .filter((tag) => groups.has(tag))
            .map((tag) => ({
                tag,
                items: [...(groups.get(tag) || [])].sort((a, b) => a.label.localeCompare(b.label, 'ko')),
                heading: getTagSectionHeading(tag),
            }));
    }, [filteredRegionHits, selectedTag, tagSections, visibleRegionHits]);

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

    useEffect(() => {
        if (!isModalOpen || !modalSurfaceRef.current || currentPageWidth <= 0 || currentPageHeight <= 0) return;

        const frameWidth = Math.max(0, modalSurfaceRef.current.clientWidth - 48);
        const frameHeight = Math.max(0, modalSurfaceRef.current.clientHeight - 48);
        const nextFitZoom = clamp(
            currentPageHeight > currentPageWidth
                ? (frameHeight / currentPageHeight)
                : Math.min(frameWidth / currentPageWidth, frameHeight / currentPageHeight),
            0.25,
            2.2,
        );

        setFitZoom(nextFitZoom);
        if (!selectedRegion) {
            setZoom(nextFitZoom);
            modalSurfaceRef.current.scrollTo({ left: 0, top: 0 });
        }
    }, [currentPageHeight, currentPageWidth, isModalOpen, selectedRegion]);

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
        setShowAllShortcuts(false);
    }, [currentPage, selectedTag, title]);

    useEffect(() => {
        if (!selectedRegion) return;
        if (!visibleRegionHits.find((region) => createRegionKey(region) === createRegionKey(selectedRegion))) {
            setSelectedRegion(null);
        }
    }, [selectedRegion, visibleRegionHits]);

    useEffect(() => {
        if (!isModalOpen || !selectedRegion || !modalSurfaceRef.current || selectedRegion.page !== currentPage) return undefined;
        const frameId = window.requestAnimationFrame(() => {
            const surface = modalSurfaceRef.current;
            const highlight = modalRegionHighlightRef.current;
            if (!surface || !highlight) return;
            const surfaceRect = surface.getBoundingClientRect();
            const highlightRect = highlight.getBoundingClientRect();
            surface.scrollTo({
                left: Math.max(0, surface.scrollLeft + (highlightRect.left - surfaceRect.left) - ((surface.clientWidth - highlightRect.width) / 2)),
                top: Math.max(0, surface.scrollTop + (highlightRect.top - surfaceRect.top) - ((surface.clientHeight - highlightRect.height) / 2)),
                behavior: 'smooth',
            });
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [currentPage, isModalOpen, selectedRegion, zoom]);

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
        setCurrentPage(region.page);
        setSelectedRegion(region);
        if (!isModalOpen) {
            setIsModalOpen(true);
            return;
        }
        setZoom((prev) => Math.max(prev, fitZoom * 1.4, 1.1));
    };

    const openModal = () => {
        if (loadingPdf) return;
        if (!selectedRegion) setZoom(fitZoom);
        setIsModalOpen(true);
    };

    const changeZoom = (delta: number) => {
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
        if (event.touches.length !== 2) return;
        pinchStateRef.current = { distance: distanceBetweenTouches(event.touches), zoom };
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 2 || !pinchStateRef.current) return;
        event.preventDefault();
        const nextDistance = distanceBetweenTouches(event.touches);
        const ratio = nextDistance / pinchStateRef.current.distance;
        setZoom(clamp(Number((pinchStateRef.current.zoom * ratio).toFixed(2)), Math.max(0.25, fitZoom * 0.7), 4));
    };

    const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !modalSurfaceRef.current) return;
        event.preventDefault();
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
    };

    const renderTagFilters = () => tagSections.length > 0 && (
        <div className="mb-4 space-y-3">
            <div className="text-xs font-bold text-gray-500">태그 목차</div>
            <button
                type="button"
                onClick={() => setSelectedTag('')}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${!selectedTag ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
                전체
            </button>
            {tagSections.map((section) => (
                <div key={section.heading} className="space-y-2 rounded-2xl border border-gray-200 bg-white/80 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">{section.heading}</div>
                    <div className="flex flex-wrap gap-2">
                        {section.tags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setSelectedTag(tag)}
                                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition ${selectedTag === tag ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                            >
                                <span>{tag}</span>
                                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-700">
                                    {visibleRegionHits.filter((region) => (region.tags || []).includes(tag)).length}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
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

    const renderPageSurface = (interactive: boolean) => {
        const surfaceScale = interactive && usingPreprocessedPages ? previewScale || 1 : zoom;
        const isPortrait = currentPageHeight > currentPageWidth;

        return (
            <div
                ref={interactive ? previewSurfaceRef : undefined}
                className={`rounded-2xl border border-gray-200 bg-gray-100 p-3 ${interactive ? 'cursor-zoom-in overflow-auto' : 'overflow-visible'}`}
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
                    <div className={`relative flex ${isPortrait ? 'justify-center' : 'justify-start'}`}>
                        <div className="relative inline-block">
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
                                    className="pointer-events-none absolute rounded border-4 border-red-500 bg-red-200/30"
                                    style={{
                                        left: `${selectedRegion.left * surfaceScale - 16}px`,
                                        top: `${selectedRegion.top * surfaceScale - 16}px`,
                                        width: `${selectedRegion.width * surfaceScale + 32}px`,
                                        height: `${selectedRegion.height * surfaceScale + 24}px`,
                                    }}
                                />
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
                        <div className="relative inline-block">
                            <Page pageNumber={currentPage} scale={zoom} renderTextLayer renderAnnotationLayer loading="페이지를 불러오는 중입니다." />
                            {selectedRegion && selectedRegion.page === currentPage && (
                                <div
                                    ref={interactive ? undefined : modalRegionHighlightRef}
                                    className="pointer-events-none absolute rounded border-4 border-red-500 bg-red-200/30"
                                    style={{
                                        left: `${selectedRegion.left * zoom - 16}px`,
                                        top: `${selectedRegion.top * zoom - 16}px`,
                                        width: `${selectedRegion.width * zoom + 32}px`,
                                        height: `${selectedRegion.height * zoom + 24}px`,
                                    }}
                                />
                            )}
                        </div>
                    </Document>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-extrabold text-gray-900">PDF 지도 보기</h3>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={openModal} disabled={loadingPdf} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40">확대 보기</button>
                        <button type="button" onClick={() => changeZoom(-0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">축소</button>
                        <span className="w-16 text-center text-sm font-bold text-gray-600">{Math.round(zoom * 100)}%</span>
                        <button type="button" onClick={() => changeZoom(0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">확대</button>
                    </div>
                </div>
                {visibleRegionHits.length > 0 && <div className="mb-4">{renderTagFilters()}{renderShortcutList('rounded-full px-3 py-1.5 text-xs font-bold transition')}</div>}
                <div className="mb-4 flex items-center justify-center"><div className="text-sm font-bold text-gray-600">{currentPage} / {numPages || '-'}</div></div>
                {renderPageSurface(true)}
                <p className="mt-3 text-xs leading-6 text-gray-500">PDF 지도를 클릭하면 확대 모달이 열립니다. 모달에서는 휠로 확대하고 드래그로 이동할 수 있습니다.</p>
                <p className="mt-2 text-xs leading-6 text-gray-500">태그는 시대별, 지도 관련, 사용자 태그 목차로 정리됩니다.</p>
            </div>
            {isModalOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setIsModalOpen(false)}>
                    <div className="flex h-[90vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                            <div>
                                <div className="text-lg font-extrabold text-gray-900">{title}</div>
                                <div className="text-xs text-gray-500">바깥 클릭 또는 Esc로 닫습니다.</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedRegion(null);
                                        setZoom(fitZoom);
                                        modalSurfaceRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
                                    }}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    전체 보기
                                </button>
                                <button type="button" onClick={() => changeZoom(-0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">-</button>
                                <div className="w-16 text-center text-sm font-bold text-gray-700">{Math.round(zoom * 100)}%</div>
                                <button type="button" onClick={() => changeZoom(0.2)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">+</button>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">닫기</button>
                            </div>
                        </div>
                        <div className="grid min-h-0 flex-1 lg:grid-cols-[21rem_minmax(0,1fr)]">
                            <aside className="min-h-0 border-r border-gray-200 bg-gray-50 p-4">
                                {renderTagFilters()}
                                <div className="max-h-[calc(90vh-12rem)] overflow-y-auto pr-1">
                                    {renderShortcutList('rounded-xl px-3 py-2 text-left text-xs font-bold transition')}
                                </div>
                            </aside>
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="flex items-center justify-center border-b border-gray-200 px-5 py-3">
                                    <div className="text-sm font-bold text-gray-600">{currentPage} / {numPages || '-'}</div>
                                </div>
                                <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-4">
                                    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                                        <div
                                            ref={modalSurfaceRef}
                                            className="min-h-0 flex-1 cursor-grab overflow-auto bg-slate-100 p-4 active:cursor-grabbing"
                                            onWheel={handleWheelZoom}
                                            onTouchStart={handleTouchStart}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={handleDragEnd}
                                            onMouseDown={handleDragStart}
                                            onMouseMove={handleDragMove}
                                            onMouseUp={handleDragEnd}
                                            onMouseLeave={handleDragEnd}
                                        >
                                            <div className="flex min-h-full items-start justify-center">
                                                {renderPageSurface(false)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PdfMapViewer;
