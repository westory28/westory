const MAX_SOURCE_ARCHIVE_UPLOAD_BYTES = 4.5 * 1024 * 1024;

const UPLOAD_VARIANTS = [
    { maxSide: 2560, mimeType: 'image/webp', quality: 0.82 },
    { maxSide: 2200, mimeType: 'image/webp', quality: 0.76 },
    { maxSide: 1920, mimeType: 'image/jpeg', quality: 0.78 },
    { maxSide: 1600, mimeType: 'image/jpeg', quality: 0.72 },
] as const;

export interface PreparedSourceArchiveUpload {
    blob: Blob;
    mimeType: string;
    width: number;
    height: number;
    byteSize: number;
    extension: string;
    originalName: string;
    originalMimeType: string;
    originalByteSize: number;
    originalWidth: number;
    originalHeight: number;
}

const loadImageElement = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
    };
    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('이미지를 불러오지 못했습니다.'));
    };
    image.src = objectUrl;
});

const canvasToBlob = (
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality: number,
) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (!blob) {
            reject(new Error('이미지를 압축하지 못했습니다.'));
            return;
        }
        resolve(blob);
    }, mimeType, quality);
});

const getExtensionFromMimeType = (mimeType: string) => {
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/png') return 'png';
    return 'jpg';
};

const renderVariant = async (
    image: HTMLImageElement,
    variant: (typeof UPLOAD_VARIANTS)[number],
) => {
    const scale = Math.min(1, variant.maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('이미지 캔버스를 준비하지 못했습니다.');
    }

    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, variant.mimeType, variant.quality);

    return {
        blob,
        mimeType: blob.type || variant.mimeType,
        width,
        height,
        byteSize: blob.size,
        extension: getExtensionFromMimeType(blob.type || variant.mimeType),
    } satisfies Omit<
        PreparedSourceArchiveUpload,
        'originalName' | 'originalMimeType' | 'originalByteSize' | 'originalWidth' | 'originalHeight'
    >;
};

export const buildSourceArchiveUpload = async (file: File): Promise<PreparedSourceArchiveUpload> => {
    const image = await loadImageElement(file);
    const sourceMeta = {
        originalName: file.name,
        originalMimeType: file.type || 'image/jpeg',
        originalByteSize: file.size || 0,
        originalWidth: image.width || 0,
        originalHeight: image.height || 0,
    };
    let lastResult: Omit<
        PreparedSourceArchiveUpload,
        'originalName' | 'originalMimeType' | 'originalByteSize' | 'originalWidth' | 'originalHeight'
    > | null = null;

    for (const variant of UPLOAD_VARIANTS) {
        try {
            const result = await renderVariant(image, variant);
            lastResult = result;
            if (result.byteSize <= MAX_SOURCE_ARCHIVE_UPLOAD_BYTES) {
                return {
                    ...result,
                    ...sourceMeta,
                };
            }
        } catch {
            continue;
        }
    }

    if (!lastResult) {
        throw new Error('업로드용 이미지를 준비하지 못했습니다.');
    }

    return {
        ...lastResult,
        ...sourceMeta,
    };
};
