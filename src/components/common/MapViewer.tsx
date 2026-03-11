import React, { useEffect, useState } from 'react';
import type { MapResource } from '../../lib/mapResources';
import { getGoogleMapsEmbedUrl, getGoogleMapsExternalUrl } from '../../lib/mapResources';
import PdfMapViewer from './PdfMapViewer';

interface MapViewerProps {
    item: MapResource | null;
    googleSearchQuery?: string;
    onGoogleSearchQueryChange?: (value: string) => void;
    showShell?: boolean;
}

const MapViewer: React.FC<MapViewerProps> = ({
    item,
    googleSearchQuery,
    onGoogleSearchQueryChange,
    showShell = true,
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

    const renderGoogleSearchInput = (id: string) => (
        item.type === 'google' && onGoogleSearchQueryChange && (
            <div className="w-full">
                <label className="sr-only" htmlFor={id}>구글 지도 검색</label>
                <div className="flex items-center gap-2">
                    <input
                        id={id}
                        type="text"
                        value={googleSearchQuery ?? ''}
                        onChange={(e) => onGoogleSearchQueryChange(e.target.value)}
                        placeholder="구글 지도 검색"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
                        <i className="fas fa-search"></i>
                    </span>
                </div>
            </div>
        )
    );

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
                    <div className="pointer-events-none relative aspect-[16/10]">
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
                    <div className="pointer-events-none relative aspect-[16/10]">
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
                    tagSections={item.pdfTagSections}
                />
            )}
        </>
    );

    const content = (
        <>
            {showShell && (
                <div className="border-b border-gray-100 p-4 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                                {item.category}
                            </div>
                            <h1 className="text-xl font-extrabold text-gray-900 sm:text-2xl">{item.title}</h1>
                        </div>

                        <div className="flex w-full flex-col items-stretch gap-3 lg:w-auto lg:min-w-[20rem] lg:items-end">
                            {renderGoogleSearchInput('map-google-search')}

                            {externalUrl && (
                                <a
                                    href={externalUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 lg:w-auto"
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
            )}

            <div className={showShell ? 'bg-gray-50 p-4 md:p-6' : 'space-y-4'}>
                {!showShell && item.type === 'google' && onGoogleSearchQueryChange && (
                    <div className="flex justify-stretch sm:justify-end">{renderGoogleSearchInput('map-google-search-inline')}</div>
                )}

                {renderPrimarySurface()}

                {showEmptyState && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-10 text-center text-amber-900">
                        <div className="mb-3 text-4xl">
                            <i className="fas fa-map-marked-alt"></i>
                        </div>
                        <h2 className="text-lg font-bold">지도를 표시할 준비가 아직 끝나지 않았습니다.</h2>
                        <p className="mt-2 text-sm leading-6">
                            {item.type === 'google'
                                ? '구글 지도는 검색어를 입력하면 바로 표시됩니다.'
                                : item.type === 'pdf'
                                    ? 'PDF 파일을 업로드하면 확대, 축소, 태그, 지역 이동 기능을 사용할 수 있습니다.'
                                    : '지도 정보를 입력하면 화면에 바로 표시됩니다.'}
                        </p>
                    </div>
                )}
            </div>
        </>
    );

    return (
        <div className="space-y-5">
            {showShell ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    {content}
                </div>
            ) : content}

            {isModalOpen && (item.type === 'image' || item.type === 'iframe' || item.type === 'google') && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-2 sm:p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[84vh] sm:rounded-3xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5 sm:py-4">
                            <div>
                                <div className="text-base font-extrabold text-gray-900 sm:text-lg">{item.title}</div>
                                <div className="text-xs text-gray-500">바깥 클릭 또는 `Esc`로 닫습니다.</div>
                            </div>
                            <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
                                {item.type === 'google' && onGoogleSearchQueryChange && (
                                    <div className="flex min-w-0 flex-1 items-center gap-2 lg:min-w-[18rem] lg:max-w-[28rem] lg:flex-none">
                                        {renderGoogleSearchInput('map-google-search-modal')}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    닫기
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2 sm:p-4">
                            <div className="flex min-h-full items-center justify-center">
                                {item.type === 'image' && item.imageUrl && (
                                    <div className="flex h-full w-full items-center justify-center">
                                        <img
                                            src={item.imageUrl}
                                            alt={item.title}
                                            className="h-full w-full rounded-2xl bg-white object-contain shadow-lg"
                                        />
                                    </div>
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
                                            allowFullScreen
                                        />
                                    </div>
                                )}
                            </div>
                            {(item.type === 'google' || item.type === 'iframe') && (
                                <div className="mt-3 text-center text-xs text-gray-500">
                                    모달 안에서는 원본 인터랙션이 그대로 동작합니다.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MapViewer;
