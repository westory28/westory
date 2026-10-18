export interface ProductImageCrop {
  zoom: number;
  x: number;
  y: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

// x/y describe the available travel: 0 is the start, 0.5 the center, 1 the end.
export const getProductCropRect = (
  width: number,
  height: number,
  crop: ProductImageCrop,
): { x: number; y: number; size: number } => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("상품 이미지 크기가 올바르지 않습니다.");
  if (
    !crop ||
    !Number.isFinite(crop.zoom) ||
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y)
  )
    throw new Error("이미지 자르기 위치가 올바르지 않습니다.");

  const size = Math.max(1, Math.min(width, height) / clamp(crop.zoom, 1, 3));
  return {
    x: (width - size) * clamp(crop.x, 0, 1),
    y: (height - size) * clamp(crop.y, 0, 1),
    size,
  };
};

export const cropProductImage = async (
  file: File,
  crop: ProductImageCrop,
): Promise<File> => {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw new Error("20MB 이하의 이미지 파일을 선택해 주세요.");

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("상품 이미지를 읽지 못했습니다.");
    }
    if (image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error("이미지 해상도를 4천만 화소 이하로 줄여 주세요.");

    const rectangle = getProductCropRect(
      image.naturalWidth,
      image.naturalHeight,
      crop,
    );
    const outputSize = Math.floor(Math.min(rectangle.size, 1200));
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("이미지를 준비하지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputSize, outputSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      rectangle.x,
      rectangle.y,
      rectangle.size,
      rectangle.size,
      0,
      0,
      outputSize,
      outputSize,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("상품 이미지를 저장하지 못했습니다.")),
        "image/png",
      );
    });
    const name = file.name.replace(/\.[^/.]+$/, "") || "product";
    return new File([blob], `${name}-cropped.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
};
