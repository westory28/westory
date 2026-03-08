import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PdfMapRegion } from './mapResources';

interface TextSegment {
    text: string;
    left: number;
    right: number;
    baselineY: number;
    height: number;
}

const hasUsefulLetters = (text: string) => /[\p{L}]/u.test(text);

const sanitizeRegionLabel = (value: string) => value
    .replace(/\s*[→>-].*$/u, '')
    .replace(/\([^)]*\)/gu, '')
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/[,:;]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const isLikelyRegionLabel = (value: string) => {
    const text = sanitizeRegionLabel(value);
    if (text.length < 2 || text.length > 14) return false;
    if (/^\d+$/u.test(text)) return false;
    if (!hasUsefulLetters(text)) return false;
    if (/^[^\p{L}\p{N}]+$/u.test(text)) return false;
    if (/[(){}\[\]<>]/u.test(text)) return false;
    if (/설명|유역|기후|분포|국경|수도|왕조|제국/u.test(text)) return false;
    if (text.split(' ').length > 2) return false;
    return true;
};

const normalizeSegmentText = (value: string) => value.replace(/\s+/g, ' ').trim();

const shouldInsertSpace = (segmentText: string, nextText: string, gap: number, height: number) => {
    if (!segmentText) return false;
    if (/\s$/u.test(segmentText) || /^\s/u.test(nextText)) return false;
    return gap > Math.max(6, height * 0.35);
};

export const extractPdfTextRegions = (
    items: TextItem[],
    pageHeight: number,
    scale = 1,
): PdfMapRegion[] => {
    const regions: PdfMapRegion[] = [];
    let current: TextSegment | null = null;

    const flush = () => {
        if (!current) return;

        const label = sanitizeRegionLabel(normalizeSegmentText(current.text));
        if (isLikelyRegionLabel(label)) {
            regions.push({
                label,
                page: 1,
                left: Math.max(0, current.left) * scale,
                top: Math.max(0, pageHeight - current.baselineY - current.height) * scale,
                width: Math.max(70, current.right - current.left + 18) * scale,
                height: Math.max(28, current.height + 14) * scale,
            });
        }

        current = null;
    };

    items.forEach((item) => {
        const text = String(item.str || '');
        if (!text.trim()) {
            flush();
            return;
        }

        const [, , scaleX, scaleY, x, y] = item.transform;
        const width = Math.max(Number(item.width) || 0, Math.abs(scaleX) * Math.max(text.trim().length, 1));
        const height = Math.max(Number(item.height) || 0, Math.abs(scaleY), 12);
        const left = Math.max(0, x);
        const right = left + width;

        if (!current) {
            current = { text, left, right, baselineY: y, height };
            return;
        }

        const sameLine = Math.abs(y - current.baselineY) <= Math.max(current.height, height) * 0.65;
        const gap = left - current.right;
        const isJoinable = sameLine && gap <= Math.max(20, Math.max(current.height, height) * 1.4);

        if (!isJoinable) {
            flush();
            current = { text, left, right, baselineY: y, height };
            return;
        }

        current = {
            text: `${current.text}${shouldInsertSpace(current.text, text, gap, Math.max(current.height, height)) ? ' ' : ''}${text}`,
            left: Math.min(current.left, left),
            right: Math.max(current.right, right),
            baselineY: Math.max(current.baselineY, y),
            height: Math.max(current.height, height),
        };
    });

    flush();

    const deduped = new Map<string, PdfMapRegion>();
    for (const region of regions) {
        const existing = deduped.get(region.label);
        const nextArea = region.width * region.height;
        const currentArea = existing ? existing.width * existing.height : 0;
        if (!existing || nextArea >= currentArea) {
            deduped.set(region.label, region);
        }
    }

    return Array.from(deduped.values());
};
