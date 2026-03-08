import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { getBlob, getBytes, getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import type { PdfMapPageImage, PdfMapRegion } from '../../lib/mapResources';
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
}

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const BASE_MODAL_RATIO = 0.92;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const PdfMapViewer: React.FC<PdfMapViewerProps> = ({
    fileUrl,
    storagePath,
    title,
    pageImages = [],
    regions = [],
}) => {
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1.2);
    const [fitZoom, setFitZoom] = useState(1);
    const [regionHits, setRegionHits] = useState<RegionHit[]>([]);
    const [selectedRegion, setSelectedRegion] = useState<RegionHit | null>(null);
    const [pdfObjectUrl, setPdfObjectUrl] = useState('');
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [nativeViewerFallback, setNativeViewerFallback] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const pageWrapRef = useRef<HTMLDivElement | null>(null);
    const modalSurfaceRef = useRef<HTMLDivElement | null>(null);
    const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
    const dragStateRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const usingPreprocessedPages = pageImages.length > 0;

    const allRegionHits = useMemo<RegionHit[]>(
        () => (usingPreprocessedPages ? regions : regionHits),
        [regionHits, regions, usingPreprocessedPages],
    );

    const visibleRegionHits = useMemo(() => {
        const seen = new Set<string>();
        return allRegionHits.filter((item) => {
            if (seen.has(item.label)) return false;
            seen.add(item.label);
            return true;
        }).slice(0, 40);
    }, [allRegionHits]);

    const currentPageWidth = useMemo(() => {
        if (usingPreprocessedPages) {
            return pageImages[currentPage - 1]?.width || 0;
        }
        return 1200;
    }, [currentPage, pageImages, usingPreprocessedPages]);

    useEffect(() => {
        let revokedUrl = '';
        let active = true;

        const loadPdf = async () => {
            setLoadingPdf(true);
            setLoadError('');
            setPdfObjectUrl('');
            setNativeViewerFallback(false);
            setCurrentPage(1);
            setSelectedRegion(null);
            setRegionHits([]);
            setNumPages(usingPreprocessedPages ? pageImages.length : 0);

            if (usingPreprocessedPages) {
                setLoadingPdf(false);
                return;
            }

            try {
                let blob: Blob | null = null;

                if (fileUrl) {
                    try {
                        const response = await withTimeout(fetch(fileUrl, { mode: 'cors' }), 45000, 'pdf-fetch');
                        if (!response.ok) {
                            throw new Error(`pdf-fetch-failed:${response.status}`);
                        }
                        blob = await withTimeout(response.blob(), 30000, 'pdf-blob');
                    } catch (urlError) {
                        console.warn('Direct PDF fetch failed, trying storage path fallback:', urlError);
                    }
                }

                if (!blob) {
                    const storageCandidates = [
                        storagePath ? ref(storage, storagePath) : null,
                        fileUrl ? ref(storage, fileUrl) : null,
                    ].filter(Boolean) as ReturnType<typeof ref>[];

                    for (const fileRef of storageCandidates) {
                        try {
                            const downloadUrl = await withTimeout(getDownloadURL(fileRef), 30000, 'storage-download-url');
                            const response = await withTimeout(fetch(downloadUrl, { mode: 'cors' }), 45000, 'storage-fetch');
                            if (!response.ok) {
                                throw new Error(`storage-fetch-failed:${response.status}`);
                            }
                            blob = await withTimeout(response.blob(), 30000, 'storage-fetch-blob');
                            if (blob) break;
                        } catch (downloadError) {
                            console.warn('Storage download fetch failed, falling back to SDK blob APIs:', downloadError);
                            try {
                                blob = await withTimeout(getBlob(fileRef), 45000, 'storage-get-blob');
                                if (blob) break;
                            } catch (blobError) {
                                console.warn('Storage getBlob failed, falling back to getBytes:', blobError);
                                const bytes = await withTimeout(getBytes(fileRef, MAX_PDF_BYTES), 45000, 'storage-get-bytes');
                                blob = new Blob([bytes], { type: 'application/pdf' });
                                if (blob) break;
                            }
                        }
                    }
                }

                if (!blob) {
                    throw new Error('pdf-source-missing');
                }
                if (blob.type && !blob.type.includes('pdf')) {
                    throw new Error(`pdf-invalid-mime:${blob.type}`);
                }

                revokedUrl = URL.createObjectURL(blob);
                if (!active) return;
                setPdfObjectUrl(revokedUrl);
            } catch (error) {
                console.error('Failed to prepare PDF file:', error);
                if (!active) return;
                setLoadError(error instanceof Error ? error.message : 'pdf-load-failed');
                if (fileUrl) {
                    setNativeViewerFallback(true);
                }
            } finally {
                if (active) {
                    setLoadingPdf(false);
                }
            }
        };

        void loadPdf();

        return () => {
            active = false;
            if (revokedUrl) {
                URL.revokeObjectURL(revokedUrl);
            }
        };
    }, [fileUrl, storagePath, usingPreprocessedPages, pageImages.length]);

    useEffect(() => {
        if (!isModalOpen || !modalSurfaceRef.current || currentPageWidth <= 0) return;

        const containerWidth = modalSurfaceRef.current.clientWidth - 32;
        const nextFitZoom = clamp((containerWidth / currentPageWidth) * BASE_MODAL_RATIO, 0.45, 2.2);
        setFitZoom(nextFitZoom);
        setZoom(nextFitZoom);
    }, [isModalOpen, currentPage, currentPageWidth]);

    useEffect(() => {
        if (!isModalOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsModalOpen(false);
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = '';
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isModalOpen]);

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
            ).map((region) => ({
                ...region,
                page: pageNumber,
            }));
            nextHits.push(...pageHits);
        }

        setRegionHits(nextHits);
    };

    const handleLoadError = (error: Error) => {
        console.error('Failed to render PDF file:', error);
        setLoadError(error.message || 'pdf-render-failed');
    };

    const handleSelectRegion = (region: RegionHit) => {
        setSelectedRegion(region);
        setCurrentPage(region.page);
        setZoom(Math.max(fitZoom, 2.2));

        window.setTimeout(() => {
            pageWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    };

    const openModal = () => {
        if (loadingPdf) return;
        setIsModalOpen(true);
    };

    const changeZoom = (delta: number) => {
        setZoom((prev) => clamp(Number((prev + delta).toFixed(2)), Math.max(0.3, fitZoom * 0.7), 4));
    };

    const handleWheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
        if (!isModalOpen) return;
        event.preventDefault();
        changeZoom(event.deltaY < 0 ? 0.12 : -0.12);
    };

    const distanceBetweenTouches = (touches: React.TouchList) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 2) return;
        pinchStateRef.current = {
            distance: distanceBetweenTouches(event.touches),
            zoom,
        };
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 2 || !pinchStateRef.current) return;
        event.preventDefault();
        const nextDistance = distanceBetweenTouches(event.touches);
        const ratio = nextDistance / pinchStateRef.current.distance;
        setZoom(clamp(Number((pinchStateRef.current.zoom * ratio).toFixed(2)), Math.max(0.3, fitZoom * 0.7), 4));
    };

    const handleTouchEnd = () => {
        pinchStateRef.current = null;
    };

    const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!modalSurfaceRef.current) return;
        dragStateRef.current = {
            x: event.clientX,
            y: event.clientY,
            left: modalSurfaceRef.current.scrollLeft,
            top: modalSurfaceRef.current.scrollTop,
        };
    };

    const handleDragMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!modalSurfaceRef.current || !dragStateRef.current) return;
        modalSurfaceRef.current.scrollLeft = dragStateRef.current.left - (event.clientX - dragStateRef.current.x);
        modalSurfaceRef.current.scrollTop = dragStateRef.current.top - (event.clientY - dragStateRef.current.y);
    };

    const handleDragEnd = () => {
        dragStateRef.current = null;
    };

    const renderPageSurface = (interactive: boolean) => (
        <div
            ref={interactive ? pageWrapRef : undefined}
            className={`overflow-auto rounded-2xl border border-gray-200 bg-gray-100 p-3 ${
                interactive ? 'cursor-zoom-in' : ''
            }`}
            onClick={interactive ? openModal : undefined}
        >
            {loadingPdf && (
                <div className="rounded-xl bg-white px-4 py-6 text-sm text-gray-500">
                    PDF 파일을 준비하고 있습니다.
                </div>
            )}

            {!loadingPdf && loadError && !nativeViewerFallback && (
                <div className="rounded-xl bg-white px-4 py-6 text-sm text-red-600">
                    PDF 파일을 불러오지 못했습니다. 파일 형식이나 다운로드 경로를 확인해 주세요.
                    <div className="mt-2 text-xs text-gray-500">{loadError}</div>
                </div>
            )}

            {!loadingPdf && nativeViewerFallback && fileUrl && (
                <div className="space-y-3">
                    <div className="rounded-xl bg-white px-4 py-4 text-sm text-amber-700">
                        PDF 추출 보기에는 실패해서 브라우저 기본 뷰어로 대신 표시합니다.
                        <div className="mt-2 text-xs text-gray-500">{loadError}</div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                        <iframe src={fileUrl} title={`${title} PDF`} className="h-[72vh] w-full" />
                    </div>
                </div>
            )}

            {!loadingPdf && usingPreprocessedPages && pageImages[currentPage - 1] && (
                <div className="relative inline-block">
                    <img
                        src={pageImages[currentPage - 1].imageUrl}
                        alt={`${title} ${currentPage}페이지`}
                        className={interactive ? 'transition-transform' : ''}
                        style={{
                            width: `${pageImages[currentPage - 1].width * zoom}px`,
                            maxWidth: 'none',
                        }}
                    />
                    {selectedRegion && selectedRegion.page === currentPage && (
                        <div
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
            )}

            {!loadingPdf && !loadError && !usingPreprocessedPages && pdfObjectUrl && (
                <Document
                    file={pdfObjectUrl}
                    onLoadSuccess={handleLoadSuccess}
                    onLoadError={handleLoadError}
                    loading="PDF를 불러오는 중입니다."
                >
                    <div className="relative inline-block">
                        <Page
                            pageNumber={currentPage}
                            scale={zoom}
                            renderTextLayer
                            renderAnnotationLayer
                            loading="페이지를 불러오는 중입니다."
                        />
                        {selectedRegion && selectedRegion.page === currentPage && (
                            <div
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

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-extrabold text-gray-900">PDF 지도 보기</h3>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={openModal}
                            disabled={loadingPdf}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                        >
                            확대 보기
                        </button>
                        <button
                            type="button"
                            onClick={() => changeZoom(-0.2)}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            축소
                        </button>
                        <span className="w-16 text-center text-sm font-bold text-gray-600">
                            {Math.round(zoom * 100)}%
                        </span>
                        <button
                            type="button"
                            onClick={() => changeZoom(0.2)}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            확대
                        </button>
                    </div>
                </div>

                {visibleRegionHits.length > 0 && (
                    <div className="mb-4">
                        <div className="mb-2 text-xs font-bold text-gray-500">상단 지역 이름</div>
                        <div className="flex flex-wrap gap-2">
                            {visibleRegionHits.map((region) => (
                                <button
                                    key={`${region.label}-${region.page}`}
                                    type="button"
                                    onClick={() => handleSelectRegion(region)}
                                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                                        selectedRegion?.label === region.label
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                                    }`}
                                >
                                    {region.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mb-4 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                        이전 페이지
                    </button>
                    <div className="text-sm font-bold text-gray-600">
                        {currentPage} / {numPages || '-'}
                    </div>
                    <button
                        type="button"
                        disabled={numPages === 0 || currentPage >= numPages}
                        onClick={() => setCurrentPage((prev) => Math.min(numPages, prev + 1))}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                        다음 페이지
                    </button>
                </div>

                {renderPageSurface(true)}

                <p className="mt-3 text-xs leading-6 text-gray-500">
                    PDF 지도는 클릭하면 확대 팝업으로 열립니다. 팝업에서는 PC 휠, 모바일과 태블릿 핀치로 확대/축소할 수 있습니다.
                </p>
                <p className="mt-2 text-xs leading-6 text-gray-500">
                    업로드 시 저장된 지역 좌표를 사용하므로 화면 크기가 달라도 같은 지점을 기준으로 강조됩니다.
                </p>
                <p className="mt-2 text-xs font-medium text-gray-600">{title}</p>
            </div>

            {isModalOpen && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                            <div>
                                <div className="text-lg font-extrabold text-gray-900">{title}</div>
                                <div className="text-xs text-gray-500">밖을 클릭하거나 `Esc`를 누르면 닫힙니다.</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setZoom(fitZoom)}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    맞춤
                                </button>
                                <button
                                    type="button"
                                    onClick={() => changeZoom(-0.2)}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    -
                                </button>
                                <div className="w-16 text-center text-sm font-bold text-gray-700">
                                    {Math.round(zoom * 100)}%
                                </div>
                                <button
                                    type="button"
                                    onClick={() => changeZoom(0.2)}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    닫기
                                </button>
                            </div>
                        </div>

                        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
                            <div className="border-b border-gray-200 bg-gray-50 p-4 lg:border-b-0 lg:border-r">
                                <div className="mb-3 text-xs font-bold text-gray-500">지역 바로가기</div>
                                <div className="flex max-h-[22vh] flex-wrap gap-2 overflow-auto lg:max-h-[calc(88vh-9rem)] lg:block lg:space-y-2 lg:overflow-y-auto">
                                    {visibleRegionHits.map((region) => (
                                        <button
                                            key={`modal-${region.label}-${region.page}`}
                                            type="button"
                                            onClick={() => handleSelectRegion(region)}
                                            className={`rounded-full px-3 py-2 text-xs font-bold transition lg:flex lg:w-full lg:items-center lg:justify-between lg:rounded-xl ${
                                                selectedRegion?.label === region.label
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-white text-gray-700 hover:bg-blue-50'
                                            }`}
                                        >
                                            <span>{region.label}</span>
                                            <span className="ml-2 text-[11px] opacity-70">p.{region.page}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex min-h-0 flex-col">
                                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                                    <button
                                        type="button"
                                        disabled={currentPage <= 1}
                                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                    >
                                        이전 페이지
                                    </button>
                                    <div className="text-sm font-bold text-gray-600">
                                        {currentPage} / {numPages || '-'}
                                    </div>
                                    <button
                                        type="button"
                                        disabled={numPages === 0 || currentPage >= numPages}
                                        onClick={() => setCurrentPage((prev) => Math.min(numPages, prev + 1))}
                                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                    >
                                        다음 페이지
                                    </button>
                                </div>

                                <div
                                    ref={modalSurfaceRef}
                                    className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 cursor-grab active:cursor-grabbing"
                                    onWheel={handleWheelZoom}
                                    onTouchStart={handleTouchStart}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={handleTouchEnd}
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
            )}
        </div>
    );
};

export default PdfMapViewer;
