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

export const getTightTextRegionBounds = (
    region: LessonWorksheetTextRegion,
    pageImage?: LessonWorksheetPageImage | null,
) => {
    if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
        return null;
    }

    const label = String(region.label || '').trim();
    const charCount = Math.max(label.replace(/\s+/g, '').length, 1);
    const targetHeight = Math.max(12, region.height * 0.76);
    const estimatedCharWidth = targetHeight * 0.9;
    const targetWidth = Math.min(
        region.width,
        Math.max(targetHeight * 1.2, (estimatedCharWidth * charCount) + targetHeight * 0.35),
    );
    const insetX = Math.max(0, (region.width - targetWidth) / 2);
    const insetY = Math.max(0, (region.height - targetHeight) / 2);

    const left = region.left + insetX;
    const top = region.top + insetY;
    const width = Math.max(targetWidth, targetHeight * 1.15);
    const height = Math.max(targetHeight, 10);

    return {
        left,
        top,
        width,
        height,
        leftRatio: clampRatio(left / pageImage.width),
        topRatio: clampRatio(top / pageImage.height),
        widthRatio: clampRatio(width / pageImage.width),
        heightRatio: clampRatio(height / pageImage.height),
    };
};

export const createBlankFromRegion = (
    region: LessonWorksheetTextRegion,
    pageImage?: LessonWorksheetPageImage | null,
): LessonWorksheetBlank | null => {
    const bounds = getTightTextRegionBounds(region, pageImage);
    if (!bounds) {
        return null;
    }

    return {
        id: `blank-${region.page}-${Math.round(region.left)}-${Math.round(region.top)}-${Date.now()}`,
        page: region.page,
        leftRatio: bounds.leftRatio,
        topRatio: bounds.topRatio,
        widthRatio: bounds.widthRatio,
        heightRatio: bounds.heightRatio,
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
