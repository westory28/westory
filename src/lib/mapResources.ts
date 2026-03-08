export type MapResourceType = 'image' | 'iframe' | 'google' | 'pdf';

export interface PdfMapPageImage {
    page: number;
    imageUrl: string;
    width: number;
    height: number;
}

export interface PdfMapRegion {
    label: string;
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface MapResource {
    id: string;
    title: string;
    category: string;
    description: string;
    type: MapResourceType;
    imageUrl?: string;
    fileUrl?: string;
    storagePath?: string;
    fileName?: string;
    mimeType?: string;
    embedUrl?: string;
    googleQuery?: string;
    externalUrl?: string;
    pdfPageImages?: PdfMapPageImage[];
    pdfRegions?: PdfMapRegion[];
    sortOrder: number;
}

export const GOOGLE_MAP_RESOURCE_ID = 'google-maps';

export const DEFAULT_GOOGLE_MAP_RESOURCE: MapResource = {
    id: GOOGLE_MAP_RESOURCE_ID,
    title: '구글 지도',
    category: '실시간 지도',
    description: 'Google Maps Embed API를 연결하면 원하는 지역 지도를 바로 수업에 넣을 수 있습니다.',
    type: 'google',
    googleQuery: '대한민국 서울 경복궁',
    externalUrl: 'https://www.google.com/maps',
    sortOrder: 0,
};

const GOOGLE_MAPS_EMBED_KEY = (import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY || '').trim();

const deriveStoragePathFromUrl = (fileUrl?: string) => {
    const raw = String(fileUrl || '').trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        const objectPath = url.pathname.match(/\/o\/(.+)$/)?.[1];
        if (!objectPath) return '';
        return decodeURIComponent(objectPath);
    } catch {
        return '';
    }
};

export const normalizeMapResource = (id: string, raw: Partial<MapResource>): MapResource => ({
    id,
    title: String(raw.title || '').trim() || '지도 자료',
    category: String(raw.category || '').trim() || '기타 지도',
    description: String(raw.description || '').trim(),
    type: raw.type === 'image' || raw.type === 'iframe' || raw.type === 'google' || raw.type === 'pdf'
        ? raw.type
        : 'image',
    imageUrl: String(raw.imageUrl || '').trim(),
    fileUrl: String(raw.fileUrl || '').trim(),
    storagePath: String(raw.storagePath || '').trim() || deriveStoragePathFromUrl(raw.fileUrl),
    fileName: String(raw.fileName || '').trim(),
    mimeType: String(raw.mimeType || '').trim(),
    embedUrl: String(raw.embedUrl || '').trim(),
    googleQuery: String(raw.googleQuery || '').trim(),
    externalUrl: String(raw.externalUrl || '').trim(),
    pdfPageImages: Array.isArray(raw.pdfPageImages)
        ? raw.pdfPageImages
            .map((page) => ({
                page: Number(page?.page) || 1,
                imageUrl: String(page?.imageUrl || '').trim(),
                width: Number(page?.width) || 0,
                height: Number(page?.height) || 0,
            }))
            .filter((page) => page.imageUrl)
            .sort((a, b) => a.page - b.page)
        : [],
    pdfRegions: Array.isArray(raw.pdfRegions)
        ? raw.pdfRegions
            .map((region) => ({
                label: String(region?.label || '').trim(),
                page: Number(region?.page) || 1,
                left: Number(region?.left) || 0,
                top: Number(region?.top) || 0,
                width: Number(region?.width) || 0,
                height: Number(region?.height) || 0,
            }))
            .filter((region) => region.label)
        : [],
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 999,
});

export const mergeMapResources = (resources: MapResource[]) => {
    const deduped = new Map<string, MapResource>();

    [DEFAULT_GOOGLE_MAP_RESOURCE, ...resources].forEach((item) => {
        deduped.set(item.id, { ...item });
    });

    return Array.from(deduped.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.title.localeCompare(b.title, 'ko');
    });
};

export const getGoogleMapsEmbedUrl = (query?: string) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery || !GOOGLE_MAPS_EMBED_KEY) return '';

    return `https://www.google.com/maps/embed/v1/search?key=${encodeURIComponent(GOOGLE_MAPS_EMBED_KEY)}&q=${encodeURIComponent(normalizedQuery)}&language=ko`;
};

export const getGoogleMapsExternalUrl = (query?: string) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return 'https://www.google.com/maps';

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalizedQuery)}`;
};
