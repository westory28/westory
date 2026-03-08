import React, { useEffect, useState } from 'react';
import type { MapResource } from '../../lib/mapResources';
import { getGoogleMapsEmbedUrl, getGoogleMapsExternalUrl } from '../../lib/mapResources';
import PdfMapViewer from './PdfMapViewer';

interface MapViewerProps {
    item: MapResource | null;
    googleSearchQuery?: string;
    onGoogleSearchQueryChange?: (value: string) => void;
}

const MapViewer: React.FC<MapViewerProps> = ({
    item,
    googleSearchQuery,
    onGoogleSearchQueryChange,
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

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

    if (!item) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                지도를 선택해 주세요.
            </div>
        );
    }

    const effectiveGoogleQuery = item.type === 'google'
        ? (googleSearchQuery ?? item.googleQuery ?? '').trim()
        : '';

    const googleEmbedUrl = item.type === 'google'
        ? getGoogleMapsEmbedUrl(effectiveGoogleQuery)
        : '';

    const externalUrl = item.type === 'google'
        ? item.externalUrl || getGoogleMapsExternalUrl(effectiveGoogleQuery)
        : item.externalUrl || item.fileUrl || item.imageUrl || '';

    const showEmptyState = (item.type === 'image' && !item.imageUrl)
        || (item.type === 'iframe' && !item.embedUrl)
        || (item.type === 'google' && !googleEmbedUrl)
        || (item.type === 'pdf' && !item.fileUrl);

    const openModal = () => {
        if (item.type === 'pdf' || showEmptyState) return;
        setIsModalOpen(true);
    };

    const renderPrimarySurface = () => (
        <>
            {item.type === 'image' && item.imageUrl && (
                <button
                    type="button"
                    onClick={openModal}
                    className="block w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left"
                >
                    <img src={item.imageUrl} alt={item.title} className="h-auto w-full object-contain" />
                </button>
            )}

            {item.type === 'iframe' && item.embedUrl && (
                <button
                    type="button"
                    onClick={openModal}
                    className="block w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left"
                >
                    <div className="relative aspect-[16/10] pointer-events-none">
                        <iframe
                            src={item.embedUrl}
                            className="absolute inset-0 h-full w-full"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            title={item.title}
                        />
                    </div>
                </button>
            )}

            {item.type === 'google' && googleEmbedUrl && (
                <button
                    type="button"
                    onClick={openModal}
                    className="block w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left"
                >
                    <div className="relative aspect-[16/10] pointer-events-none">
                        <iframe
                            src={googleEmbedUrl}
                            className="absolute inset-0 h-full w-full"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            title={item.title}
                        />
                    </div>
                </button>
            )}

            {item.type === 'pdf' && item.fileUrl && (
                <PdfMapViewer
                    fileUrl={item.fileUrl}
                    storagePath={item.storagePath}
                    title={item.title}
                    pageImages={item.pdfPageImages}
                    regions={item.pdfRegions}
                />
            )}
        </>
    );

    return (
        <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                                {item.category}
                            </div>
                            <h1 className="text-2xl font-extrabold text-gray-900">{item.title}</h1>
                        </div>

                        <div className="flex w-full flex-col items-end gap-3 lg:w-auto lg:min-w-[20rem]">
                            {item.type === 'google' && onGoogleSearchQueryChange && (
                                <div className="w-full">
                                    <label className="sr-only" htmlFor="map-google-search">
                                        Google 지도 검색
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            id="map-google-search"
                                            type="text"
                                            value={googleSearchQuery ?? ''}
                                            onChange={(e) => onGoogleSearchQueryChange(e.target.value)}
                                            placeholder="Google 지도 검색"
                                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                        />
                                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
                                            <i className="fas fa-search"></i>
                                        </span>
                                    </div>
                                </div>
                            )}

                            {externalUrl && (
                                <a
                                    href={externalUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    <i className="fas fa-up-right-from-square"></i>
                                    새 창에서 열기
                                </a>
                            )}
                        </div>
                    </div>

                    {item.description && (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-600">
                            {item.description}
                        </p>
                    )}
                </div>

                <div className="bg-gray-50 p-4 md:p-6">
                    {renderPrimarySurface()}

                    {showEmptyState && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-10 text-center text-amber-900">
                            <div className="mb-3 text-4xl">지도</div>
                            <h2 className="text-lg font-bold">지도를 표시할 준비가 아직 끝나지 않았습니다.</h2>
                            <p className="mt-2 text-sm leading-6">
                                {item.type === 'google'
                                    ? 'Google 지도는 API 설정과 검색어가 모두 있어야 iframe으로 표시됩니다.'
                                    : item.type === 'pdf'
                                        ? 'PDF 파일을 업로드하면 확대, 축소, 지역 이름 추출 기능을 사용할 수 있습니다.'
                                        : '지도 URL 또는 파일을 저장하면 학생 화면에 바로 표시됩니다.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {isModalOpen && (item.type === 'image' || item.type === 'iframe' || item.type === 'google') && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="flex h-[84vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                            <div>
                                <div className="text-lg font-extrabold text-gray-900">{item.title}</div>
                                <div className="text-xs text-gray-500">밖을 클릭하거나 `Esc`를 누르면 닫힙니다.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                            >
                                닫기
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
                            <div className="flex min-h-full items-center justify-center">
                                {item.type === 'image' && item.imageUrl && (
                                    <img
                                        src={item.imageUrl}
                                        alt={item.title}
                                        className="max-h-full w-auto max-w-full rounded-2xl bg-white shadow-lg"
                                    />
                                )}
                                {item.type === 'iframe' && item.embedUrl && (
                                    <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-lg">
                                        <iframe
                                            src={item.embedUrl}
                                            className="h-full min-h-[70vh] w-full"
                                            loading="lazy"
                                            referrerPolicy="no-referrer-when-downgrade"
                                            title={item.title}
                                        />
                                    </div>
                                )}
                                {item.type === 'google' && googleEmbedUrl && (
                                    <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-lg">
                                        <iframe
                                            src={googleEmbedUrl}
                                            className="h-full min-h-[70vh] w-full"
                                            loading="lazy"
                                            referrerPolicy="no-referrer-when-downgrade"
                                            title={item.title}
                                        />
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

export default MapViewer;
