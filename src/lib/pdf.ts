declare global {
    interface Window {
        pdfjsLib?: {
            GlobalWorkerOptions: { workerSrc: string };
            getDocument: (src: { data: Uint8Array }) => {
                promise: Promise<{
                    numPages: number;
                    getPage: (pageNumber: number) => Promise<{
                        getTextContent: () => Promise<{
                            items: Array<{ str?: string; hasEOL?: boolean }>;
                        }>;
                    }>;
                }>;
            };
        };
    }
}

const PDF_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_JS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let loaderPromise: Promise<NonNullable<Window['pdfjsLib']>> | null = null;

const loadScript = (src: string) =>
    new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
            if (window.pdfjsLib) {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });

export const ensurePdfJs = async () => {
    if (typeof window === 'undefined') {
        throw new Error('PDF extraction is only available in the browser.');
    }

    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_SRC;
        return window.pdfjsLib;
    }

    if (!loaderPromise) {
        loaderPromise = loadScript(PDF_JS_SRC).then(() => {
            if (!window.pdfjsLib) {
                throw new Error('PDF.js did not initialize.');
            }
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_SRC;
            return window.pdfjsLib;
        });
    }

    return loaderPromise;
};

const normalizePdfText = (text: string) =>
    text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

export const extractTextFromPdf = async (file: File) => {
    const pdfjs = await ensurePdfJs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`)
            .join('')
            .replace(/[ ]{2,}/g, ' ');
        pages.push(normalizePdfText(pageText));
    }

    return normalizePdfText(pages.join('\n\n'));
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export const textToLessonHtml = (text: string) => {
    const blocks = text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    if (blocks.length === 0) {
        return '';
    }

    return blocks
        .map((block) => {
            const lines = block
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            return `<p>${lines.map(escapeHtml).join('<br />')}</p>`;
        })
        .join('');
};

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'than', 'have', 'will',
    'were', 'been', 'about', 'lesson', 'study', 'class', 'chapter', 'unit', 'student', 'teacher',
]);

export const buildClozeDraftFromText = (text: string) => {
    let replacements = 0;
    const lines = text
        .split('\n')
        .map((line) => {
            const words = line.split(/(\s+)/);
            return words
                .map((token) => {
                    const trimmed = token.trim();
                    if (!trimmed) return token;
                    if (replacements >= 12) return token;
                    if (trimmed.length < 2 || /\d/.test(trimmed) || STOP_WORDS.has(trimmed.toLowerCase())) return token;
                    if (!/[\uAC00-\uD7A3A-Za-z]/.test(trimmed)) return token;
                    replacements += 1;
                    return `[${trimmed}]`;
                })
                .join('');
        })
        .join('\n');

    return {
        html: textToLessonHtml(lines),
        blankCount: replacements,
    };
};

export {};
