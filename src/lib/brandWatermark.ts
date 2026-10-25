import wordmarkUrl from "../assets/brand/westory-wordmark.png";

let wordmark: HTMLCanvasElement | null = null;
let wordmarkFlight: Promise<void> | null = null;

// Keep the generated master intact; trim its transparent gutter only in memory.
const trimWordmark = (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("워터마크를 준비하지 못했습니다.");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top)
    throw new Error("워터마크 이미지를 확인해 주세요.");
  const trimmed = document.createElement("canvas");
  trimmed.width = right - left + 1;
  trimmed.height = bottom - top + 1;
  const target = trimmed.getContext("2d");
  if (!target) throw new Error("워터마크를 준비하지 못했습니다.");
  target.drawImage(
    canvas,
    left,
    top,
    trimmed.width,
    trimmed.height,
    0,
    0,
    trimmed.width,
    trimmed.height,
  );
  return trimmed;
};

export const prepareBrandWatermark = (): Promise<void> => {
  if (wordmark) return Promise.resolve();
  if (wordmarkFlight) return wordmarkFlight;
  wordmarkFlight = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        wordmark = trimWordmark(image);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () =>
      reject(new Error("워터마크를 불러오지 못했습니다. 다시 시도해 주세요."));
    image.src = wordmarkUrl;
  }).catch((error) => {
    wordmarkFlight = null;
    throw error;
  });
  return wordmarkFlight;
};

export const drawBrandWatermark = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  if (width <= 0 || height <= 0) return;
  if (!wordmark) throw new Error("워터마크를 먼저 준비해 주세요.");
  const edge = Math.min(width, height);
  const logoWidth = edge * 0.24;
  const logoHeight = (logoWidth * wordmark.height) / wordmark.width;
  const margin = edge * 0.04;
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.shadowColor = "rgba(255, 255, 255, 0.95)";
  context.shadowBlur = Math.max(0.5, edge * 0.002);
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.drawImage(
    wordmark,
    width - margin - logoWidth,
    height - margin - logoHeight,
    logoWidth,
    logoHeight,
  );
  context.restore();
};

// Direct map images do not use the notice/product compression paths.
// Return new bytes before the caller computes upload size and fingerprint.
export const watermarkImageBlob = async (file: Blob): Promise<Blob> => {
  await prepareBrandWatermark();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw new Error("이미지 해상도를 4천만 화소 이하로 줄여 주세요.");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 준비하지 못했습니다.");
    context.drawImage(image, 0, 0);
    drawBrandWatermark(context, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("이미지를 저장하지 못했습니다.")),
        file.type,
        0.92,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
};
