import { pdfjs } from "react-pdf";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PdfMapPageImage, PdfMapRegion } from "./mapResources";
import { extractPdfTextRegions } from "./pdfTextRegions";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Keep saved worksheet/map coordinates independent of image resolution.
const PDF_PAGE_LOGICAL_SCALE = 1.6;
const PDF_PAGE_RENDER_SCALE = 3;
const PDF_PAGE_MAX_SIDE = 2560;
const PDF_PAGE_MAX_PIXELS = 4_000_000;
const PDF_PAGE_IMAGE_TYPE = "image/webp";
const PDF_PAGE_IMAGE_QUALITY = 0.9;
const PDF_PAGE_IMAGE_TARGET_BYTES = 1024 * 1024;

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("pdf-page-image-blob-failed"));
      },
      PDF_PAGE_IMAGE_TYPE,
      quality,
    );
  });

export const getPdfPageImageExtension = (blob: Blob) => {
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/jpeg") return "jpg";
  return "png";
};

export interface ProcessedPdfMap {
  pageImages: Array<PdfMapPageImage & { blob: Blob }>;
  regions: PdfMapRegion[];
}

export const processPdfMapFile = async (
  file: File,
): Promise<ProcessedPdfMap> => {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageImages: Array<PdfMapPageImage & { blob: Blob }> = [];
  const regions: PdfMapRegion[] = [];

  try {
    // Convert once on the uploading device, one page at a time. Viewing a page
    // continues to reuse the stored image without server-side rendering.
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const canvas = document.createElement("canvas");
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const logicalViewport = page.getViewport({
          scale: PDF_PAGE_LOGICAL_SCALE,
        });
        const renderScale = Math.min(
          PDF_PAGE_RENDER_SCALE,
          PDF_PAGE_MAX_SIDE / Math.max(baseViewport.width, baseViewport.height),
          Math.sqrt(
            PDF_PAGE_MAX_PIXELS / (baseViewport.width * baseViewport.height),
          ),
        );
        const viewport = page.getViewport({ scale: renderScale });
        // Floor dimensions so rounding cannot exceed the pixel/memory budget.
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("pdf-canvas-context-missing");
        }

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;

        let blob = await canvasToBlob(canvas, PDF_PAGE_IMAGE_QUALITY);
        // A soft transfer budget: preserve text resolution, and only recompress
        // unusually heavy (e.g. scanned/photo) pages. At most two encodes/page.
        if (blob.size > PDF_PAGE_IMAGE_TARGET_BYTES) {
          const compressed = await canvasToBlob(canvas, 0.82);
          if (compressed.size < blob.size) blob = compressed;
        }
        pageImages.push({
          page: pageNumber,
          imageUrl: "",
          width: Math.ceil(logicalViewport.width),
          height: Math.ceil(logicalViewport.height),
          blob,
        });

        const textContent = await page.getTextContent();
        const pageRegions = extractPdfTextRegions(
          textContent.items.filter((item): item is TextItem => "str" in item),
          baseViewport.height,
          PDF_PAGE_LOGICAL_SCALE,
        ).map((region) => ({
          ...region,
          page: pageNumber,
        }));
        regions.push(...pageRegions);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }

  return { pageImages, regions };
};
