export interface LessonWorksheetPageImage {
    page: number;
    imageUrl: string;
    width: number;
    height: number;
}

export interface LessonWorksheetTextRegion {
    label: string;
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface LessonWorksheetBlank {
    id: string;
    page: number;
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
    answer: string;
    prompt?: string;
}

export const clampRatio = (value: number) => Math.min(1, Math.max(0, value));

export const normalizeBlankText = (value: string) => String(value || '').trim().replace(/\s+/g, '');

export const createBlankFromRegion = (
    region: LessonWorksheetTextRegion,
    pageImage?: LessonWorksheetPageImage | null,
): LessonWorksheetBlank | null => {
    if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
        return null;
    }

    return {
        id: `blank-${region.page}-${Math.round(region.left)}-${Math.round(region.top)}-${Date.now()}`,
        page: region.page,
        leftRatio: clampRatio(region.left / pageImage.width),
        topRatio: clampRatio(region.top / pageImage.height),
        widthRatio: clampRatio(region.width / pageImage.width),
        heightRatio: clampRatio(region.height / pageImage.height),
        answer: String(region.label || '').trim(),
        prompt: '',
    };
};

export const normalizeWorksheetBlanks = (raw: unknown): LessonWorksheetBlank[] => {
    if (!Array.isArray(raw)) return [];

    return raw
        .map((item, index) => ({
            id: String(item && typeof item === 'object' && 'id' in item ? (item as { id?: string }).id : '').trim() || `blank-${index + 1}`,
            page: Math.max(1, Number(item && typeof item === 'object' && 'page' in item ? (item as { page?: number }).page : 1) || 1),
            leftRatio: clampRatio(Number(item && typeof item === 'object' && 'leftRatio' in item ? (item as { leftRatio?: number }).leftRatio : 0) || 0),
            topRatio: clampRatio(Number(item && typeof item === 'object' && 'topRatio' in item ? (item as { topRatio?: number }).topRatio : 0) || 0),
            widthRatio: clampRatio(Number(item && typeof item === 'object' && 'widthRatio' in item ? (item as { widthRatio?: number }).widthRatio : 0) || 0),
            heightRatio: clampRatio(Number(item && typeof item === 'object' && 'heightRatio' in item ? (item as { heightRatio?: number }).heightRatio : 0) || 0),
            answer: String(item && typeof item === 'object' && 'answer' in item ? (item as { answer?: string }).answer : '').trim(),
            prompt: String(item && typeof item === 'object' && 'prompt' in item ? (item as { prompt?: string }).prompt : '').trim(),
        }))
        .filter((item) => item.widthRatio > 0 && item.heightRatio > 0);
};
