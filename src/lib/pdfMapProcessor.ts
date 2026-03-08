import { pdfjs } from 'react-pdf';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PdfMapPageImage, PdfMapRegion } from './mapResources';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const hasUsefulLetters = (text: string) => /[가-힣A-Za-z]/.test(text);

const isLikelyRegionLabel = (value: string) => {
    const text = value.trim();
    if (text.length < 2 || text.length > 20) return false;
    if (/^\d+$/.test(text)) return false;
    if (!hasUsefulLetters(text)) return false;
    if (/^[^가-힣A-Za-z0-9]+$/.test(text)) return false;
    return true;
};

const canvasToBlob = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error('pdf-page-image-blob-failed'));
        }, 'image/png');
    });

export interface ProcessedPdfMap {
    pageImages: Array<PdfMapPageImage & { blob: Blob }>;
    regions: PdfMapRegion[];
}

export const processPdfMapFile = async (file: File): Promise<ProcessedPdfMap> => {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pageImages: Array<PdfMapPageImage & { blob: Blob }> = [];
    const regions: PdfMapRegion[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('pdf-canvas-context-missing');
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        await page.render({
            canvas,
            canvasContext: context,
            viewport,
        }).promise;

        const blob = await canvasToBlob(canvas);
        pageImages.push({
            page: pageNumber,
            imageUrl: '',
            width: canvas.width,
            height: canvas.height,
            blob,
        });

        const textContent = await page.getTextContent();
        textContent.items.forEach((item) => {
            if (!('str' in item)) return;

            const textItem = item as TextItem;
            const label = String(textItem.str || '').trim();
            if (!isLikelyRegionLabel(label)) return;

            const [, , scaleX, scaleY, x, y] = textItem.transform;
            regions.push({
                label,
                page: pageNumber,
                left: Math.max(0, x) * 1.8,
                top: Math.max(0, page.getViewport({ scale: 1 }).height - y) * 1.8,
                width: Math.max(70, Math.abs(scaleX) * Math.max(label.length, 2)) * 1.8,
                height: Math.max(28, Math.abs(scaleY) + 14) * 1.8,
            });
        });
    }

    return { pageImages, regions };
};
