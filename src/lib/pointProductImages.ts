import {
  drawProductWatermark,
  prepareProductWatermarkFont,
} from "./pointProductWatermark";

const imageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("상품 이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
const encode = (canvas: HTMLCanvasElement, quality: number, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("상품 이미지를 압축하지 못했습니다.")),
      type,
      quality,
    ),
  );

export const PRODUCT_IMAGE_LIMITS = {
  detail: { maxSize: 1200, maxBytes: 300 * 1024 },
  preview: { maxSize: 640, maxBytes: 96 * 1024 },
} as const;

export const optimizeProductImage = async (
  file: File,
  variant: keyof typeof PRODUCT_IMAGE_LIMITS,
) => {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw new Error("20MB 이하의 이미지 파일을 선택해 주세요.");
  const image = await imageFromFile(file);
  const limits = PRODUCT_IMAGE_LIMITS[variant];
  const originalMax = Math.max(image.naturalWidth, image.naturalHeight);
  if (!originalMax || image.naturalWidth * image.naturalHeight > 40_000_000)
    throw new Error("이미지 해상도를 4천만 화소 이하로 줄여 주세요.");
  await prepareProductWatermarkFont();
  let maxSize = Math.min(originalMax, limits.maxSize);
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(
      1,
      Math.round((image.naturalWidth * maxSize) / originalMax),
    );
    canvas.height = Math.max(
      1,
      Math.round((image.naturalHeight * maxSize) / originalMax),
    );
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("이미지를 준비하지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawProductWatermark(context, canvas.width, canvas.height);
    for (const quality of [0.88, 0.82, 0.76, 0.7]) {
      let blob = await encode(canvas, quality, "image/webp");
      if (blob.type !== "image/webp")
        blob = await encode(canvas, quality, "image/jpeg");
      if (blob.size <= limits.maxBytes) return blob;
    }
    maxSize = Math.round(maxSize * 0.85);
  }
  throw new Error(
    "이미지 용량을 줄이지 못했습니다. 다른 이미지를 선택해 주세요.",
  );
};

// Old 320px previews are too small on high-density screens. Their already
// compressed detail file is a better fallback until a new photo is uploaded.
export const getProductCardImage = (product: {
  imageUrl: string;
  previewImageUrl?: string;
}) =>
  product.previewImageUrl?.includes("preview-640-")
    ? product.previewImageUrl
    : product.imageUrl || product.previewImageUrl || "";
