export interface QuizImageCompressionOptions {
  maxSide: number;
  targetDataUrlBytes: number;
  maxDataUrlBytes: number;
}

export const QUIZ_QUESTION_IMAGE_OPTIONS: QuizImageCompressionOptions = {
  maxSide: 840,
  targetDataUrlBytes: 110 * 1024,
  maxDataUrlBytes: 180 * 1024,
};

export const QUIZ_MATCHING_IMAGE_OPTIONS: QuizImageCompressionOptions = {
  maxSide: 320,
  targetDataUrlBytes: 30 * 1024,
  maxDataUrlBytes: 56 * 1024,
};

const IMAGE_QUALITY_STEPS = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];
const IMAGE_SIZE_STEPS = [1, 0.875, 0.75, 0.625, 0.5, 0.425, 0.35];
const IMAGE_MIME_TYPES = ["image/webp", "image/jpeg"] as const;
const MIN_PERCEIVED_QUALITY = 0.64;
const MIN_SIZE_STEP_FOR_QUALITY = 0.625;

const getDataUrlBytes = (value: string) => new Blob([value]).size;

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const value = event.target?.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });

const drawToCanvas = (
  image: HTMLImageElement,
  width: number,
  height: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("이미지 압축 환경을 준비하지 못했습니다.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas;
};

const makeCandidate = (
  canvas: HTMLCanvasElement,
  mimeType: (typeof IMAGE_MIME_TYPES)[number],
  quality: number,
) => {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  if (!dataUrl.startsWith(`data:${mimeType}`)) return null;
  return {
    dataUrl,
    byteSize: getDataUrlBytes(dataUrl),
    quality,
    pixelCount: canvas.width * canvas.height,
  };
};

const isGoodDisplayCandidate = (
  candidate: {
    quality: number;
  },
  sizeStep: number,
) =>
  candidate.quality >= MIN_PERCEIVED_QUALITY &&
  sizeStep >= MIN_SIZE_STEP_FOR_QUALITY;

const compressDataUrl = async (
  dataUrl: string,
  options: QuizImageCompressionOptions,
) => {
  const source = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    options.maxSide /
      Math.max(source.naturalWidth || 1, source.naturalHeight || 1),
  );
  const baseWidth = Math.max(1, Math.round((source.naturalWidth || 1) * scale));
  const baseHeight = Math.max(
    1,
    Math.round((source.naturalHeight || 1) * scale),
  );
  let displayCandidate: ReturnType<typeof makeCandidate> | null = null;
  let fallbackCandidate: ReturnType<typeof makeCandidate> | null = null;

  for (const sizeStep of IMAGE_SIZE_STEPS) {
    const width = Math.max(1, Math.round(baseWidth * sizeStep));
    const height = Math.max(1, Math.round(baseHeight * sizeStep));
    const canvas = drawToCanvas(source, width, height);

    for (const mimeType of IMAGE_MIME_TYPES) {
      for (const quality of IMAGE_QUALITY_STEPS) {
        const candidate = makeCandidate(canvas, mimeType, quality);
        if (!candidate) continue;
        if (
          candidate.byteSize <= options.targetDataUrlBytes &&
          isGoodDisplayCandidate(candidate, sizeStep) &&
          (!displayCandidate || candidate.byteSize < displayCandidate.byteSize)
        ) {
          displayCandidate = candidate;
        }
        if (
          candidate.byteSize <= options.maxDataUrlBytes &&
          (!fallbackCandidate ||
            candidate.byteSize < fallbackCandidate.byteSize)
        ) {
          fallbackCandidate = candidate;
        }
      }
    }
  }

  const selected = displayCandidate || fallbackCandidate;
  if (!selected) {
    throw new Error(
      "이미지를 충분히 줄이지 못했습니다. 더 단순하거나 작은 이미지를 사용해 주세요.",
    );
  }
  return selected.dataUrl;
};

export const optimizeQuizImageFile = async (
  file: File,
  options: QuizImageCompressionOptions,
) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 첨부할 수 있습니다.");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  return compressDataUrl(originalDataUrl, options);
};

export const optimizeQuizImageDataUrl = async (
  value: string | null | undefined,
  options: QuizImageCompressionOptions,
) => {
  if (!value || !value.startsWith("data:image/")) return value || null;
  if (getDataUrlBytes(value) <= options.targetDataUrlBytes) return value;
  return compressDataUrl(value, options);
};

export const getQuizImageDataUrlBytes = (value: string | null | undefined) =>
  value ? getDataUrlBytes(value) : 0;
