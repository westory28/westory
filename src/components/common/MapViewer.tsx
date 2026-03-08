import React from 'react';
import type { MapResource } from '../../lib/mapResources';
import { getGoogleMapsEmbedUrl, getGoogleMapsExternalUrl } from '../../lib/mapResources';

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
    if (!item) {
        return (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center text-gray-500">
                지도를 선택해 주세요.
            </div>
        );
    }

    const effectiveGoogleQuery = item.type === 'google'
        ? (googleSearchQuery ?? item.googleQuery ?? '').trim()
        : '';
    const googleEmbedUrl = item.type === 'google' ? getGoogleMapsEmbedUrl(effectiveGoogleQuery) : '';
    const externalUrl = item.type === 'google'
        ? item.externalUrl || getGoogleMapsExternalUrl(effectiveGoogleQuery)
        : item.externalUrl || '';

    return (
        <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 mb-3">
                                {item.category}
                            </div>
                            <h1 className="text-2xl font-extrabold text-gray-900">{item.title}</h1>
                        </div>

                        <div className="flex flex-col items-end gap-3 w-full lg:w-auto lg:min-w-[20rem]">
                            {item.type === 'google' && onGoogleSearchQueryChange && (
                                <div className="w-full">
                                    <label className="sr-only" htmlFor="map-google-search">Google 지도 검색</label>
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
                        <p className="mt-3 text-sm leading-7 text-gray-600 whitespace-pre-wrap">{item.description}</p>
                    )}
                </div>

                <div className="p-4 md:p-6 bg-gray-50">
                    {item.type === 'image' && item.imageUrl && (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <img src={item.imageUrl} alt={item.title} className="w-full h-auto object-contain" />
                        </div>
                    )}

                    {item.type === 'iframe' && item.embedUrl && (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <div className="relative aspect-[16/10]">
                                <iframe
                                    src={item.embedUrl}
                                    className="absolute inset-0 h-full w-full"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                    title={item.title}
                                />
                            </div>
                        </div>
                    )}

                    {item.type === 'google' && googleEmbedUrl && (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <div className="relative aspect-[16/10]">
                                <iframe
                                    src={googleEmbedUrl}
                                    className="absolute inset-0 h-full w-full"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                    title={item.title}
                                />
                            </div>
                        </div>
                    )}

                    {((item.type === 'image' && !item.imageUrl)
                        || (item.type === 'iframe' && !item.embedUrl)
                        || (item.type === 'google' && !googleEmbedUrl)) && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-10 text-center text-amber-900">
                            <div className="text-4xl mb-3">🗺️</div>
                            <h2 className="text-lg font-bold">지도를 표시할 준비가 아직 끝나지 않았습니다</h2>
                            <p className="mt-2 text-sm leading-6">
                                {item.type === 'google'
                                    ? 'Google 지도는 API 키와 검색어가 모두 있어야 iframe으로 표시됩니다.'
                                    : '지도 URL을 저장하면 이 영역에 바로 표시됩니다.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MapViewer;
