import { pdfjs } from 'react-pdf';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PdfMapPageImage, PdfMapRegion } from './mapResources';
import { extractPdfTextRegions } from './pdfTextRegions';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const PDF_PAGE_RENDER_SCALE = 1.6;
const PDF_PAGE_IMAGE_TYPE = 'image/webp';
const PDF_PAGE_IMAGE_QUALITY = 0.82;

const canvasToBlob = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error('pdf-page-image-blob-failed'));
        }, PDF_PAGE_IMAGE_TYPE, PDF_PAGE_IMAGE_QUALITY);
    });

export const getPdfPageImageExtension = (blob: Blob) => {
    if (blob.type === 'image/webp') return 'webp';
    if (blob.type === 'image/jpeg') return 'jpg';
    return 'png';
};

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
        const viewport = page.getViewport({ scale: PDF_PAGE_RENDER_SCALE });
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
        const pageRegions = extractPdfTextRegions(
            textContent.items.filter((item): item is TextItem => 'str' in item),
            page.getViewport({ scale: 1 }).height,
            PDF_PAGE_RENDER_SCALE,
        ).map((region) => ({
            ...region,
            page: pageNumber,
        }));
        regions.push(...pageRegions);
    }

    return { pageImages, regions };
};
