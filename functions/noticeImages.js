const { randomUUID } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");
const sharp = require("sharp");
const { onCallWithStudentMaintenance } = require("./studentMaintenance");
const {
  assertStudentRegistrationAccess,
} = require("./studentRegistrationAccess");
const { assertActiveApplicationSession } = require("./sessionAuthority");

const BUCKET_NAME = "history-quiz-yongsin.firebasestorage.app";
const ADMIN_EMAIL = "westoria28@gmail.com";
const MAX_IMAGE_BYTES = 700 * 1024;
const MAX_IMAGE_PIXELS = 4096 * 4096;
const NOTICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const NOTICE_PATH_PATTERN =
  /^years\/(\d{4})\/semesters\/([12])\/notice_images\/([A-Za-z0-9_-]{1,80})\/notice-(?:\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(?:webp|png|jpg)$/;

const invalid = (message) => new HttpsError("invalid-argument", message);
const assertPayload = (data, keys) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw invalid("이미지 요청 정보를 확인해 주세요.");
  }
  const { _session, ...payload } = data;
  if (Object.keys(payload).sort().join("|") !== [...keys].sort().join("|")) {
    throw invalid("이미지 요청 항목이 올바르지 않습니다.");
  }
  return payload;
};

const validateImage = async (imageBase64, contentType) => {
  if (
    !["image/webp", "image/png", "image/jpeg"].includes(contentType) ||
    typeof imageBase64 !== "string" ||
    !imageBase64.length ||
    imageBase64.length > Math.ceil((MAX_IMAGE_BYTES - 1) / 3) * 4 ||
    imageBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)
  ) {
    throw invalid("700KB 미만의 WebP, PNG, JPEG 이미지를 사용해 주세요.");
  }
  const buffer = Buffer.from(imageBase64, "base64");
  if (
    !buffer.length ||
    buffer.length >= MAX_IMAGE_BYTES ||
    buffer.toString("base64") !== imageBase64
  ) {
    throw invalid("이미지 데이터 또는 용량이 올바르지 않습니다.");
  }
  const format =
    contentType === "image/webp"
      ? "webp"
      : contentType === "image/png"
        ? "png"
        : "jpeg";
  const validMagic =
    format === "webp"
      ? buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      : format === "png"
        ? buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : buffer.length >= 3 &&
          buffer[0] === 255 &&
          buffer[1] === 216 &&
          buffer[2] === 255;
  if (!validMagic)
    throw invalid("이미지 형식과 실제 파일 내용이 일치하지 않습니다.");
  try {
    const decoder = sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 4096 ||
      metadata.height > 4096 ||
      (metadata.pages || 1) !== 1
    ) {
      throw new Error("Unsupported dimensions or image format");
    }
    // Decode the entire image, not only its header, before accepting its bytes.
    await decoder.stats();
    return {
      buffer,
      width: metadata.width,
      height: metadata.height,
      mimeType: contentType,
      extension: format === "jpeg" ? "jpg" : format,
    };
  } catch (_error) {
    throw invalid(
      "이미지를 읽을 수 없습니다. 4096px 이하의 정지 이미지를 사용해 주세요.",
    );
  }
};

const createNoticeImageHandlers = ({
  db,
  bucket,
  assertSession = assertActiveApplicationSession,
  createId = randomUUID,
} = {}) => {
  if (!db || !bucket || typeof assertSession !== "function") {
    throw new TypeError(
      "Notice image handlers require database, bucket, and session guard.",
    );
  }
  const assertManager = async (request) => {
    await assertSession(request);
    const uid = request.auth?.uid;
    const email = String(request.auth?.token?.email || "")
      .trim()
      .toLowerCase();
    if (!uid) throw new HttpsError("unauthenticated", "다시 로그인해 주세요.");
    if (email === ADMIN_EMAIL) return;
    if (!/@yongshin-ms\.ms\.kr$/.test(email)) {
      throw new HttpsError(
        "permission-denied",
        "알림장 이미지를 관리할 권한이 없습니다.",
      );
    }
    const snapshot = await db.doc(`users/${uid}`).get();
    const profile = snapshot.exists ? snapshot.data() : undefined;
    assertStudentRegistrationAccess(profile, snapshot.exists);
    if (profile.role !== "teacher") {
      throw new HttpsError(
        "permission-denied",
        "알림장 이미지를 관리할 권한이 없습니다.",
      );
    }
  };
  const assertCurrentScope = async (year, semester) => {
    if (
      typeof year !== "string" ||
      !/^\d{4}$/.test(year) ||
      typeof semester !== "string" ||
      !/^[12]$/.test(semester)
    ) {
      throw invalid("학년도와 학기 정보를 확인해 주세요.");
    }
    const semesterId = `${year}-${semester}`;
    const [configSnap, pointerSnap, manifestSnap] = await Promise.all([
      db.doc("site_settings/config").get(),
      db.doc("site_settings/semester_active").get(),
      db.doc(`semester_manifests/${semesterId}`).get(),
    ]);
    const config = configSnap.exists ? configSnap.data() : {};
    const pointer = pointerSnap.exists ? pointerSnap.data() : {};
    const manifest = manifestSnap.exists ? manifestSnap.data() : {};
    const canonicalMatches =
      pointer.semesterId === semesterId &&
      Number.isSafeInteger(pointer.revision) &&
      pointer.revision >= 0 &&
      manifestSnap.exists &&
      manifest.semesterId === semesterId &&
      manifest.revision === pointer.revision &&
      manifest.status === "ACTIVE" &&
      manifest.readOnly !== true;
    const legacyMatches =
      configSnap.exists &&
      String(config.year || "") === year &&
      String(config.semester || "") === semester &&
      (!Object.hasOwn(config, "activeSemesterId") ||
        config.activeSemesterId === semesterId) &&
      (!manifestSnap.exists ||
        (manifest.semesterId === semesterId &&
          manifest.status === "ACTIVE" &&
          manifest.readOnly !== true));
    if (!(pointerSnap.exists ? canonicalMatches : legacyMatches)) {
      throw new HttpsError(
        "failed-precondition",
        "현재 학기가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    }
  };
  const upload = async (request) => {
    await assertManager(request);
    const { year, semester, noticeId, imageBase64, contentType } =
      assertPayload(request.data, [
        "year",
        "semester",
        "noticeId",
        "imageBase64",
        "contentType",
      ]);
    await assertCurrentScope(year, semester);
    if (typeof noticeId !== "string" || !NOTICE_ID_PATTERN.test(noticeId)) {
      throw invalid("알림장 식별자가 올바르지 않습니다.");
    }
    const image = await validateImage(imageBase64, contentType);
    const storagePath = `years/${year}/semesters/${semester}/notice_images/${noticeId}/notice-${createId()}.${image.extension}`;
    const token = createId();
    await bucket.file(storagePath).save(image.buffer, {
      resumable: false,
      validation: "crc32c",
      metadata: {
        contentType: image.mimeType,
        cacheControl: "public,max-age=86400",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    return {
      imageUrl: `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
      imageStoragePath: storagePath,
      imageByteSize: image.buffer.length,
      imageWidth: image.width,
      imageHeight: image.height,
      imageMimeType: image.mimeType,
    };
  };
  const remove = async (request) => {
    await assertManager(request);
    const { storagePath } = assertPayload(request.data, ["storagePath"]);
    const match =
      typeof storagePath === "string" && NOTICE_PATH_PATTERN.exec(storagePath);
    if (!match) throw invalid("알림장 이미지 경로가 올바르지 않습니다.");
    await assertCurrentScope(match[1], match[2]);
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    return { deleted: true };
  };
  return { upload, remove };
};

let defaultHandlers;
const getDefaultHandlers = () => {
  if (!defaultHandlers)
    defaultHandlers = createNoticeImageHandlers({
      db: getFirestore(),
      bucket: getStorage().bucket(BUCKET_NAME),
    });
  return defaultHandlers;
};
const callableOptions = {
  region: "asia-northeast3",
  memory: "512MiB",
  concurrency: 4,
  maxInstances: 5,
};
module.exports = {
  createNoticeImageHandlers,
  uploadNoticeImageContent: onCallWithStudentMaintenance(
    callableOptions,
    (request) => getDefaultHandlers().upload(request),
  ),
  deleteNoticeImageContent: onCallWithStudentMaintenance(
    callableOptions,
    (request) => getDefaultHandlers().remove(request),
  ),
};
