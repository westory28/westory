import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import type { SystemConfig } from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export interface NoticeImageUploadResult {
  imageUrl: string;
  imageStoragePath: string;
  imageByteSize: number;
  imageWidth: number;
  imageHeight: number;
  imageMimeType: string;
}

const MAX_NOTICE_IMAGE_WIDTH = 1200;
const MAX_NOTICE_IMAGE_HEIGHT = 800;
const TARGET_NOTICE_IMAGE_BYTES = 460 * 1024;
const MAX_NOTICE_IMAGE_BYTES = 680 * 1024;
const NOTICE_IMAGE_QUALITY_STEPS = [0.9, 0.84, 0.78, 0.72, 0.66, 0.6, 0.54, 0.48];
const NOTICE_IMAGE_SIZE_STEPS = [1, 0.875, 0.75, 0.625];

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

const getNoticeImageStoragePath = (config: ConfigLike, noticeId: string) => {
  const year = String(config?.year || "").trim();
  const semester = String(config?.semester || "").trim();
  const safeNoticeId = String(noticeId || "notice")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80);
  if (!year || !semester) {
    throw new Error("학년도/학기 정보를 확인할 수 없습니다.");
  }
  return `years/${year}/semesters/${semester}/notice_images/${safeNoticeId}/notice-${Date.now()}.webp`;
};

const drawNoticeImageCanvas = (
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
  return canvas;
};

export const compressNoticeImage = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있습니다.");
  }

  const source = await loadImageElement(file);
  const scale = Math.min(
    1,
    MAX_NOTICE_IMAGE_WIDTH / source.naturalWidth,
    MAX_NOTICE_IMAGE_HEIGHT / source.naturalHeight,
  );
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));

  type CompressionCandidate = {
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
    quality: number;
    sizeStep: number;
  };
  const getCandidateScore = (candidate: CompressionCandidate) =>
    candidate.quality * 1000 + candidate.sizeStep * 100;
  let targetCandidate: CompressionCandidate | null = null;
  let fallback: CompressionCandidate | null = null;

  for (const sizeStep of NOTICE_IMAGE_SIZE_STEPS) {
    const nextWidth = Math.max(1, Math.round(width * sizeStep));
    const nextHeight = Math.max(1, Math.round(height * sizeStep));
    const canvas = drawNoticeImageCanvas(source, nextWidth, nextHeight);

    for (const quality of NOTICE_IMAGE_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      const candidate = {
        blob,
        width: nextWidth,
        height: nextHeight,
        mimeType: blob.type || "image/webp",
        quality,
        sizeStep,
      };

      if (blob.size <= TARGET_NOTICE_IMAGE_BYTES) {
        if (!targetCandidate || getCandidateScore(candidate) > getCandidateScore(targetCandidate)) {
          targetCandidate = candidate;
        }
      }
      if (
        blob.size <= MAX_NOTICE_IMAGE_BYTES
        && (!fallback || getCandidateScore(candidate) > getCandidateScore(fallback))
      ) {
        fallback = candidate;
      }
    }
  }

  if (targetCandidate) {
    return targetCandidate;
  }
  if (fallback) {
    return fallback;
  }

  throw new Error("이미지를 더 작게 줄일 수 없습니다. 더 단순한 이미지를 사용해 주세요.");
};

export const uploadNoticeImage = async ({
  config,
  noticeId,
  file,
}: {
  config: ConfigLike;
  noticeId: string;
  file: File;
}): Promise<NoticeImageUploadResult> => {
  const compressed = await compressNoticeImage(file);
  const storagePath = getNoticeImageStoragePath(config, noticeId);
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, compressed.blob, {
    contentType: compressed.mimeType,
    cacheControl: "public,max-age=86400",
  });
  return {
    imageUrl: await getDownloadURL(storageRef),
    imageStoragePath: storageRef.fullPath,
    imageByteSize: compressed.blob.size,
    imageWidth: compressed.width,
    imageHeight: compressed.height,
    imageMimeType: compressed.mimeType,
  };
};

export const tryDeleteNoticeImage = async (storagePath?: string | null) => {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return false;
  try {
    await deleteObject(ref(storage, normalizedPath));
    return true;
  } catch (error) {
    console.warn("Failed to delete notice image:", error);
    return false;
  }
};
