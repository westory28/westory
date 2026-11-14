import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import { drawBrandWatermark, prepareBrandWatermark } from "./brandWatermark";

export interface DeveloperLogImageUploadResult {
  imageUrl: string;
  imageStoragePath: string;
  imageByteSize: number;
  imageWidth: number;
  imageHeight: number;
  imageMimeType: string;
}

const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 1600;
const TARGET_IMAGE_BYTES = 540 * 1024;
const MAX_IMAGE_BYTES = 700 * 1024;
const IMAGE_QUALITY_STEPS = [0.9, 0.84, 0.78, 0.72, 0.66, 0.6, 0.54, 0.48];
const IMAGE_SIZE_STEPS = [1, 0.9, 0.8, 0.7, 0.6];

const loadImageElement = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러오지 못했습니다."));
    };
    image.src = url;
  });

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("이미지를 압축하지 못했습니다."));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });

const callDeveloperLogImageService = async <Response>(
  name: "uploadDeveloperLogImageContent" | "deleteDeveloperLogImageContent",
  input: Record<string, unknown>,
  user: User | null,
): Promise<Response> => {
  const assertOwner = () => {
    if (!user || auth.currentUser !== user) {
      throw new Error("로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.");
    }
  };
  assertOwner();
  const result = await callWithApplicationSession<
    Record<string, unknown>,
    Response
  >(name, input, user);
  assertOwner();
  return result.data;
};

const imageBlobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator === -1) {
        reject(new Error("이미지 전송 데이터를 준비하지 못했습니다."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () =>
      reject(new Error("이미지 전송 데이터를 준비하지 못했습니다."));
    reader.readAsDataURL(blob);
  });

const drawCanvas = (
  source: HTMLImageElement,
  width: number,
  height: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("이미지 처리 환경을 준비하지 못했습니다.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  drawBrandWatermark(context, width, height);
  return canvas;
};

export const compressDeveloperLogImage = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있습니다.");
  }

  const source = await loadImageElement(file);
  await prepareBrandWatermark();
  const scale = Math.min(
    1,
    MAX_IMAGE_WIDTH / source.naturalWidth,
    MAX_IMAGE_HEIGHT / source.naturalHeight,
  );
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));

  type Candidate = {
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
    quality: number;
    sizeStep: number;
  };

  const score = (candidate: Candidate) =>
    candidate.quality * 1000 + candidate.sizeStep * 100;

  let target: Candidate | null = null;
  let fallback: Candidate | null = null;

  for (const sizeStep of IMAGE_SIZE_STEPS) {
    const nextWidth = Math.max(1, Math.round(width * sizeStep));
    const nextHeight = Math.max(1, Math.round(height * sizeStep));
    const canvas = drawCanvas(source, nextWidth, nextHeight);

    for (const quality of IMAGE_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      const candidate = {
        blob,
        width: nextWidth,
        height: nextHeight,
        mimeType: blob.type || "image/webp",
        quality,
        sizeStep,
      };

      if (blob.size <= TARGET_IMAGE_BYTES) {
        if (!target || score(candidate) > score(target)) target = candidate;
      }
      if (blob.size <= MAX_IMAGE_BYTES) {
        if (!fallback || score(candidate) > score(fallback))
          fallback = candidate;
      }
    }
  }

  if (target) return target;
  if (fallback) return fallback;
  throw new Error(
    "이미지 용량을 충분히 줄이지 못했습니다. 더 단순한 이미지를 사용해 주세요.",
  );
};

export const uploadDeveloperLogImage = async ({
  postId,
  file,
}: {
  postId: string;
  file: File;
}): Promise<DeveloperLogImageUploadResult> => {
  const user = auth.currentUser;
  const compressed = await compressDeveloperLogImage(file);
  return callDeveloperLogImageService<DeveloperLogImageUploadResult>(
    "uploadDeveloperLogImageContent",
    {
      postId,
      imageBase64: await imageBlobToBase64(compressed.blob),
      contentType: compressed.mimeType,
    },
    user,
  );
};

export const tryDeleteDeveloperLogImage = async (
  storagePath?: string | null,
) => {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return false;
  try {
    const result = await callDeveloperLogImageService<{ deleted: boolean }>(
      "deleteDeveloperLogImageContent",
      { storagePath: normalizedPath },
      auth.currentUser,
    );
    return result.deleted;
  } catch (error) {
    console.warn("Failed to delete developer log image:", error);
    return false;
  }
};
