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
const hasVisibleKeywordChars = (text: string) => /[가-ힱA-Za-z0-9]/u.test(text);
const looksCorruptedText = (text: string) => /[?\uFFFD]/u.test(text);

// Keep text inside brackets and only drop the bracket characters themselves.
const sanitizeRegionLabel = (value: string) => value
    .replace(/\s*[?？]{2}.*$/u, '')
    .replace(/[\[\](){}<>]/gu, ' ')
    .replace(/[,:;]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const isLikelyRegionLabel = (value: string) => {
    const text = sanitizeRegionLabel(value);
    if (text.length < 1 || text.length > 24) return false;
    if (/^\d+$/u.test(text)) return false;
    if (!hasUsefulLetters(text)) return false;
    if (!hasVisibleKeywordChars(text)) return false;
    if (looksCorruptedText(text)) return false;
    if (/^[^\p{L}\p{N}]+$/u.test(text)) return false;
    if (text.split(' ').length > 4) return false;
    return true;
};

const collapseRepeatedWordSequence = (words: string[]) => {
    if (words.length < 2) return words;

    for (let size = 1; size <= Math.floor(words.length / 2); size += 1) {
        if (words.length % size !== 0) continue;
        const chunk = words.slice(0, size);
        let matches = true;

        for (let index = 0; index < words.length; index += size) {
            const nextChunk = words.slice(index, index + size);
            if (nextChunk.join('\u0000') !== chunk.join('\u0000')) {
                matches = false;
                break;
            }
        }

        if (matches) {
            return chunk;
        }
    }

    return words;
};

const collapseRepeatedLabel = (value: string) => {
    let text = value.replace(/\s+/gu, ' ').trim();
    if (!text) return text;

    let previous = '';
    while (text && text !== previous) {
        previous = text;

        const words = text.split(' ').filter(Boolean);
        const collapsedWords = collapseRepeatedWordSequence(words);
        text = collapsedWords.join(' ');

        // Also collapse duplicated leading phrase patterns such as
        // "중원경 충주 중원경 충주", even when OCR adds slight spacing noise.
        text = text.replace(/^(.{2,24}?)\s+\1$/u, '$1').trim();
        text = text.replace(/^(.{2,24}?)\1$/u, '$1').trim();
        text = text.replace(/(.{2,16}?)\s+\1(?=\s|$)/gu, '$1').trim();
        text = text.replace(/(.{2,16}?)\1(?=\s|$)/gu, '$1').trim();
    }

    return text;
};

const normalizeSegmentText = (value: string) => value.replace(/\s+/g, ' ').trim();

const resolveLabelBounds = (segment: TextSegment, normalizedText: string, label: string) => {
    const segmentWidth = Math.max(segment.right - segment.left, 1);
    const averageCharWidth = segmentWidth / Math.max(normalizedText.length, 1);
    const labelIndex = normalizedText.indexOf(label);

    if (labelIndex < 0) {
        return {
            left: segment.left,
            width: segmentWidth,
        };
    }

    const left = segment.left + (averageCharWidth * labelIndex);
    const width = Math.max(averageCharWidth * Math.max(label.length, 1), segment.height * 1.15);

    return {
        left,
        width,
    };
};

const shouldInsertSpace = (segmentText: string, nextText: string, gap: number, height: number) => {
    if (!segmentText) return false;
    if (/\s$/u.test(segmentText) || /^\s/u.test(nextText)) return false;
    return gap > Math.max(4, height * 0.2);
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

        const normalizedText = normalizeSegmentText(current.text);
        const label = collapseRepeatedLabel(sanitizeRegionLabel(normalizedText));
        if (isLikelyRegionLabel(label)) {
            const bounds = resolveLabelBounds(current, normalizedText, label);
            regions.push({
                label,
                page: 1,
                left: Math.max(0, bounds.left) * scale,
                top: Math.max(0, pageHeight - current.baselineY - current.height) * scale,
                width: Math.max(18, bounds.width + 4) * scale,
                height: Math.max(12, current.height + 4) * scale,
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

        const sameLine = Math.abs(y - current.baselineY) <= Math.max(current.height, height) * 0.45;
        const gap = left - current.right;
        const isJoinable = sameLine && gap <= Math.max(8, Math.max(current.height, height) * 0.55);

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
