import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { getBlob, getBytes, getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

interface PdfMapViewerProps {
    fileUrl: string;
    storagePath?: string;
    title: string;
}

interface RegionHit {
    label: string;
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

const hasUsefulLetters = (text: string) => /[가-힣A-Za-z]/.test(text);

const isLikelyRegionLabel = (value: string) => {
    const text = value.trim();
    if (text.length < 2 || text.length > 20) return false;
    if (/^\d+$/.test(text)) return false;
    if (!hasUsefulLetters(text)) return false;
    if (/^[^가-힣A-Za-z0-9]+$/.test(text)) return false;
    return true;
};

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

const PdfMapViewer: React.FC<PdfMapViewerProps> = ({ fileUrl, storagePath, title }) => {
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1.2);
    const [regionHits, setRegionHits] = useState<RegionHit[]>([]);
    const [selectedRegion, setSelectedRegion] = useState<RegionHit | null>(null);
    const [pdfObjectUrl, setPdfObjectUrl] = useState('');
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState('');
    const pageWrapRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let revokedUrl = '';
        let active = true;

        const loadPdf = async () => {
            setLoadingPdf(true);
            setLoadError('');
            setPdfObjectUrl('');
            setCurrentPage(1);
            setZoom(1.2);
            setRegionHits([]);
            setSelectedRegion(null);
            setNumPages(0);

            try {
                let blob: Blob | null = null;

                if (fileUrl) {
                    const response = await withTimeout(fetch(fileUrl, { mode: 'cors' }), 20000, 'pdf-fetch');
                    if (!response.ok) {
                        throw new Error(`pdf-fetch-failed:${response.status}`);
                    }
                    blob = await withTimeout(response.blob(), 15000, 'pdf-blob');
                } else if (storagePath) {
                    const fileRef = ref(storage, storagePath);

                    try {
                        const downloadUrl = await withTimeout(getDownloadURL(fileRef), 15000, 'storage-download-url');
                        const response = await withTimeout(fetch(downloadUrl, { mode: 'cors' }), 20000, 'storage-fetch');
                        if (!response.ok) {
                            throw new Error(`storage-fetch-failed:${response.status}`);
                        }
                        blob = await withTimeout(response.blob(), 15000, 'storage-fetch-blob');
                    } catch (downloadError) {
                        console.warn('Storage download fetch failed, falling back to SDK blob APIs:', downloadError);

                        try {
                            blob = await withTimeout(getBlob(fileRef), 15000, 'storage-get-blob');
                        } catch (blobError) {
                            console.warn('Storage getBlob failed, falling back to getBytes:', blobError);
                            const bytes = await withTimeout(getBytes(fileRef, MAX_PDF_BYTES), 15000, 'storage-get-bytes');
                            blob = new Blob([bytes], { type: 'application/pdf' });
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
    }, [fileUrl, storagePath]);

    const visibleRegionHits = useMemo(() => {
        const seen = new Set<string>();

        return regionHits.filter((item) => {
            if (seen.has(item.label)) return false;
            seen.add(item.label);
            return true;
        }).slice(0, 40);
    }, [regionHits]);

    const handleLoadSuccess = async (pdf: PDFDocumentProxy) => {
        setNumPages(pdf.numPages);
        const nextHits: RegionHit[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();

            textContent.items.forEach((item) => {
                if (!('str' in item)) return;

                const textItem = item as TextItem;
                const label = String(textItem.str || '').trim();
                if (!isLikelyRegionLabel(label)) return;

                const [, , scaleX, scaleY, x, y] = textItem.transform;
                nextHits.push({
                    label,
                    page: pageNumber,
                    left: Math.max(0, x),
                    top: Math.max(0, viewport.height - y),
                    width: Math.max(70, Math.abs(scaleX) * Math.max(label.length, 2)),
                    height: Math.max(28, Math.abs(scaleY) + 14),
                });
            });
        }

        setRegionHits(nextHits);
    };

    const handleSelectRegion = (region: RegionHit) => {
        setSelectedRegion(region);
        setCurrentPage(region.page);
        setZoom(2.2);

        window.setTimeout(() => {
            pageWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    };

    const handleLoadError = (error: Error) => {
        console.error('Failed to render PDF file:', error);
        setLoadError(error.message || 'pdf-render-failed');
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-extrabold text-gray-900">PDF 지도 보기</h3>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setZoom((prev) => Math.max(0.8, Number((prev - 0.2).toFixed(1))))}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            축소
                        </button>
                        <span className="w-16 text-center text-sm font-bold text-gray-600">
                            {Math.round(zoom * 100)}%
                        </span>
                        <button
                            type="button"
                            onClick={() => setZoom((prev) => Math.min(3, Number((prev + 0.2).toFixed(1))))}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            확대
                        </button>
                    </div>
                </div>

                {visibleRegionHits.length > 0 && (
                    <div className="mb-4">
                        <div className="mb-2 text-xs font-bold text-gray-500">PDF에서 추출한 지역 이름</div>
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

                <div ref={pageWrapRef} className="overflow-auto rounded-2xl border border-gray-200 bg-gray-100 p-3">
                    {loadingPdf && (
                        <div className="rounded-xl bg-white px-4 py-6 text-sm text-gray-500">
                            PDF 파일을 준비하는 중입니다.
                        </div>
                    )}

                    {!loadingPdf && loadError && (
                        <div className="rounded-xl bg-white px-4 py-6 text-sm text-red-600">
                            PDF 파일을 불러오지 못했습니다. 파일 형식이나 다운로드 경로를 확인해 주세요.
                            <div className="mt-2 text-xs text-gray-500">{loadError}</div>
                        </div>
                    )}

                    {!loadingPdf && !loadError && pdfObjectUrl && (
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

                <p className="mt-3 text-xs leading-6 text-gray-500">
                    PDF는 브라우저 기본 뷰어 대신 <code>pdf.js</code>로 렌더링해서 확대와 축소를 지원하고,
                    본문 글자도 가능한 한 안정적으로 보여줍니다. 다만 원본 PDF의 폰트 포함 상태에 따라 일부
                    글자 모양은 달라질 수 있습니다.
                </p>
                <p className="mt-2 text-xs leading-6 text-gray-500">
                    상단 지역 이름은 PDF 텍스트에서 자동 추출한 후보입니다. Google 지도에는 이 기능이 적용되지 않습니다.
                </p>
                <p className="mt-2 text-xs font-medium text-gray-600">{title}</p>
            </div>
        </div>
    );
};

export default PdfMapViewer;
