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
    shortcutEnabled?: boolean;
    tags?: string[];
}

export interface PdfTagSection {
    id: string;
    label: string;
    tags: string[];
}

export interface MapResource {
    id: string;
    title: string;
    category: string;
    tabGroup?: string;
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
    pdfTagSections?: PdfTagSection[];
    sortOrder: number;
}

export interface MapResourceDisplayGroup<T extends MapResource = MapResource> {
    key: string;
    title: string;
    representative: T;
    items: T[];
}

export const GOOGLE_MAP_RESOURCE_ID = 'google-maps';

export const DEFAULT_PDF_REGION_TAGS = [
    '하천',
    '평야',
    '지방',
    '반도',
    '산맥',
    '고원',
    '비석',
    '지명',
] as const;

export const DEFAULT_PDF_ERA_TAGS = [
    '고조선',
    '삼국시대',
    '통일신라',
    '고려',
    '조선',
    '개항기',
    '일제강점기',
] as const;

export const DEFAULT_PDF_TAG_SECTIONS: PdfTagSection[] = [
    { id: 'era', label: '시대별', tags: [...DEFAULT_PDF_ERA_TAGS] },
    { id: 'region', label: '지리 관련', tags: [...DEFAULT_PDF_REGION_TAGS] },
];

export const DEFAULT_GOOGLE_MAP_RESOURCE: MapResource = {
    id: GOOGLE_MAP_RESOURCE_ID,
    title: '구글 지도',
    category: '실시간 지도',
    tabGroup: '구글 지도',
    description: 'Google Maps Embed API를 연결하면 원하는 지명을 바로 검색할 수 있습니다.',
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

const normalizeRegionTags = (tags: unknown) => {
    if (!Array.isArray(tags)) return [];

    return Array.from(new Set(
        tags
            .map((tag) => String(tag || '').trim())
            .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'ko'));
};

export const getPdfSectionTagOptions = (sections: PdfTagSection[]) => normalizeRegionTags(
    sections.flatMap((section) => section.tags || []),
);

const normalizePdfTagSections = (sections: unknown): PdfTagSection[] => {
    const defaults = DEFAULT_PDF_TAG_SECTIONS.map((section) => ({ ...section, tags: [...section.tags] }));
    if (!Array.isArray(sections)) return defaults;

    const parsed = sections
        .map((section, index) => ({
            id: String(section && typeof section === 'object' && 'id' in section ? (section as { id?: string }).id : '').trim() || `custom-${index + 1}`,
            label: String(section && typeof section === 'object' && 'label' in section ? (section as { label?: string }).label : '').trim(),
            tags: normalizeRegionTags(section && typeof section === 'object' && 'tags' in section ? (section as { tags?: unknown }).tags : []),
        }))
        .filter((section) => section.label);

    return parsed.length > 0 ? parsed : defaults;
};

export const normalizeMapResource = (id: string, raw: Partial<MapResource>): MapResource => {
    const pdfTagSections = normalizePdfTagSections(raw.pdfTagSections);
    const allowedTagSet = new Set(getPdfSectionTagOptions(pdfTagSections));

    return {
        id,
        title: String(raw.title || '').trim() || '지도 자료',
        category: String(raw.category || '').trim() || '기타 지도',
        tabGroup: String(raw.tabGroup || raw.category || '').trim() || '기타 지도',
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
                    shortcutEnabled: region?.shortcutEnabled !== false,
                    tags: normalizeRegionTags(region?.tags).filter((tag) => allowedTagSet.has(tag)),
                }))
                .filter((region) => region.label)
            : [],
        pdfTagSections,
        sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 999,
    };
};

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

const getMapResourceGroupSeed = (item: MapResource) => {
    const normalizedTabGroup = String(item.tabGroup || '').trim();
    if (normalizedTabGroup) return normalizedTabGroup;

    if (item.type === 'google') return item.title || `google:${item.id}`;

    return String(item.title || '').trim() || item.id;
};

const sortMapResources = <T extends MapResource>(items: T[]) => (
    [...items].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.title.localeCompare(b.title, 'ko');
    })
);

export const groupMapResourcesForDisplay = <T extends MapResource>(resources: T[]): MapResourceDisplayGroup<T>[] => {
    const buckets = new Map<string, T[]>();

    sortMapResources(resources).forEach((item) => {
        const key = getMapResourceGroupSeed(item);
        const current = buckets.get(key) || [];
        current.push(item);
        buckets.set(key, current);
    });

    return Array.from(buckets.entries())
        .map(([key, items]) => {
            const representative = [...items].sort((a, b) => {
                if (a.title.length !== b.title.length) return a.title.length - b.title.length;
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.title.localeCompare(b.title, 'ko');
            })[0];

            return {
                key,
                title: key || representative?.title || items[0]?.title || '지도 자료',
                representative: representative || items[0],
                items,
            };
        })
        .sort((a, b) => {
            if (a.representative.sortOrder !== b.representative.sortOrder) {
                return a.representative.sortOrder - b.representative.sortOrder;
            }
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
