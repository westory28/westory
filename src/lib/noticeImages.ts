import type { User } from "firebase/auth";
import { auth, getHttpsCallable } from "./firebase";
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

export const NOTICE_IMAGE_RECOMMENDED_WIDTH = 1200;
export const NOTICE_IMAGE_RECOMMENDED_HEIGHT = 675;

const NOTICE_IMAGE_ASPECT_RATIO =
  NOTICE_IMAGE_RECOMMENDED_WIDTH / NOTICE_IMAGE_RECOMMENDED_HEIGHT;
const MAX_NOTICE_IMAGE_WIDTH = NOTICE_IMAGE_RECOMMENDED_WIDTH;
const MAX_NOTICE_IMAGE_HEIGHT = NOTICE_IMAGE_RECOMMENDED_HEIGHT;
const TARGET_NOTICE_IMAGE_BYTES = 460 * 1024;
const MAX_NOTICE_IMAGE_BYTES = 680 * 1024;
const NOTICE_IMAGE_QUALITY_STEPS = [
  0.9, 0.84, 0.78, 0.72, 0.66, 0.6, 0.54, 0.48,
];
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

const getNoticeImageScope = (config: ConfigLike, noticeId: string) => {
  const year = String(config?.year || "").trim();
  const semester = String(config?.semester || "").trim();
  const safeNoticeId = String(noticeId || "notice")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80);
  if (!year || !semester) {
    throw new Error("학년도/학기 정보를 확인할 수 없습니다.");
  }
  return { year, semester, noticeId: safeNoticeId };
};

type NoticeSession = {
  status: string;
  authTime: number;
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
};

// Notice uploads use the server's existing session and permission guards.
// Storage rules cannot fit session, maintenance and profile reads in one write.
const callNoticeImageService = async <Response>(
  name: "uploadNoticeImageContent" | "deleteNoticeImageContent",
  input: Record<string, unknown>,
  user: User | null,
): Promise<Response> => {
  const assertOwner = () => {
    if (!user || auth.currentUser !== user) {
      throw new Error("로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.");
    }
  };
  assertOwner();
  const token = await user!.getIdTokenResult();
  assertOwner();
  const open = await getHttpsCallable<
    { authorityGeneration: string; protocolVersion: number },
    NoticeSession
  >("openApplicationSession");
  assertOwner();
  const { data: session } = await open({
    authorityGeneration: "w1r2-2026-08-09",
    protocolVersion: 2,
  });
  assertOwner();
  if (
    session.status !== "active" ||
    session.authTime !== Number(token.claims.auth_time) ||
    session.authorityGeneration !== "w1r2-2026-08-09" ||
    !Number.isInteger(session.protocolVersion) ||
    session.protocolVersion < 2 ||
    !/^[a-f0-9]{64}$/.test(session.revision)
  ) {
    throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
  }
  const callable = await getHttpsCallable<Record<string, unknown>, Response>(
    name,
  );
  const currentToken = await user!.getIdTokenResult();
  assertOwner();
  if (currentToken.claims.auth_time !== token.claims.auth_time) {
    throw new Error("로그인 상태가 바뀌었습니다. 다시 저장해 주세요.");
  }
  const result = await callable({
    ...input,
    _session: {
      authorityGeneration: session.authorityGeneration,
      protocolVersion: session.protocolVersion,
      revision: session.revision,
    },
  });
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

const getNoticeImageCenterCrop = (
  sourceWidth: number,
  sourceHeight: number,
) => {
  const sourceRatio = sourceWidth / sourceHeight;

  if (sourceRatio > NOTICE_IMAGE_ASPECT_RATIO) {
    const width = sourceHeight * NOTICE_IMAGE_ASPECT_RATIO;
    return {
      sx: (sourceWidth - width) / 2,
      sy: 0,
      sw: width,
      sh: sourceHeight,
    };
  }

  const height = sourceWidth / NOTICE_IMAGE_ASPECT_RATIO;
  return {
    sx: 0,
    sy: (sourceHeight - height) / 2,
    sw: sourceWidth,
    sh: height,
  };
};

const drawNoticeImageCanvas = ({
  source,
  width,
  height,
  crop,
}: {
  source: HTMLImageElement;
  width: number;
  height: number;
  crop: ReturnType<typeof getNoticeImageCenterCrop>;
}) => {
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
  context.drawImage(
    source,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    width,
    height,
  );
  return canvas;
};

export const compressNoticeImage = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있습니다.");
  }

  const source = await loadImageElement(file);
  const crop = getNoticeImageCenterCrop(
    source.naturalWidth,
    source.naturalHeight,
  );
  const scale = Math.min(
    1,
    MAX_NOTICE_IMAGE_WIDTH / crop.sw,
    MAX_NOTICE_IMAGE_HEIGHT / crop.sh,
  );
  const width = Math.max(1, Math.round(crop.sw * scale));

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
    const nextHeight = Math.max(
      1,
      Math.round(nextWidth / NOTICE_IMAGE_ASPECT_RATIO),
    );
    const canvas = drawNoticeImageCanvas({
      source,
      width: nextWidth,
      height: nextHeight,
      crop,
    });

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
        if (
          !targetCandidate ||
          getCandidateScore(candidate) > getCandidateScore(targetCandidate)
        ) {
          targetCandidate = candidate;
        }
      }
      if (
        blob.size <= MAX_NOTICE_IMAGE_BYTES &&
        (!fallback ||
          getCandidateScore(candidate) > getCandidateScore(fallback))
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

  throw new Error(
    "이미지를 더 작게 줄일 수 없습니다. 더 단순한 이미지를 사용해 주세요.",
  );
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
  const user = auth.currentUser;
  const scope = getNoticeImageScope(config, noticeId);
  const compressed = await compressNoticeImage(file);
  return callNoticeImageService<NoticeImageUploadResult>(
    "uploadNoticeImageContent",
    {
      ...scope,
      imageBase64: await imageBlobToBase64(compressed.blob),
      contentType: compressed.mimeType,
    },
    user,
  );
};

export const tryDeleteNoticeImage = async (storagePath?: string | null) => {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return false;
  try {
    const result = await callNoticeImageService<{ deleted: boolean }>(
      "deleteNoticeImageContent",
      { storagePath: normalizedPath },
      auth.currentUser,
    );
    return result.deleted;
  } catch (error) {
    console.warn("Failed to delete notice image:", error);
    return false;
  }
};
