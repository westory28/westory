const { createHash, randomUUID } = require("node:crypto");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");
const sharp = require("sharp");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");
const { assertActiveApplicationSession } = require("./sessionAuthority");

const MAX_BYTES = 680 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const normalize = (data) => {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some(
      (key) =>
        ![
          "semesterId",
          "requestId",
          "title",
          "contentBase64",
          "_session",
        ].includes(key),
    ) ||
    typeof data.semesterId !== "string" ||
    !/^\d{4}-[12]$/.test(data.semesterId) ||
    typeof data.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(data.requestId) ||
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.trim().length > 120 ||
    typeof data.contentBase64 !== "string" ||
    !data.contentBase64.length ||
    data.contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    data.contentBase64.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.contentBase64)
  )
    fail("invalid-argument", "배너 제목과 이미지 파일을 확인해 주세요.");
  const bytes = Buffer.from(data.contentBase64, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_BYTES ||
    bytes.toString("base64") !== data.contentBase64
  )
    fail("invalid-argument", "배너 이미지 용량이나 파일 형식을 확인해 주세요.");
  return {
    semesterId: data.semesterId,
    requestId: data.requestId,
    title: data.title.trim(),
    bytes,
  };
};
const processImage = async (bytes) => {
  try {
    const options = { limitInputPixels: 16_000_000, failOn: "error" };
    const metadata = await sharp(bytes, options).metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8000 ||
      metadata.height > 8000
    )
      throw new Error("Unsupported image");
    const result = await sharp(bytes, options)
      .rotate()
      .resize({
        width: 1200,
        height: 675,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_BYTES) throw new Error("Image too large");
    return result;
  } catch {
    fail(
      "invalid-argument",
      "정상적인 JPG, PNG 또는 WebP 이미지를 선택해 주세요.",
    );
  }
};

const createRegisterSchoolBannerHandler =
  ({
    db,
    bucket,
    assertSession = assertActiveApplicationSession,
    now = Date.now,
    uuid = randomUUID,
  } = {}) =>
  async (request) => {
    const identity = await assertSession(request, {
      recentAuth: true,
      highRisk: true,
    });
    const input = normalize(request.data);
    const uid = identity.uid;
    const noticeId = `banner_${hash(`${uid}\n${input.semesterId}\n${input.requestId}`)}`;
    const payloadHash = hash(`${input.title}\n${hash(input.bytes)}`);
    const [year, semester] = input.semesterId.split("-");
    const root = `years/${year}/semesters/${semester}`;
    const receiptRef = db.doc(`school_banner_registrations/${noticeId}`);
    const noticeRef = db.doc(`${root}/notices/${noticeId}`);
    const attemptId = uuid();
    const storagePath = `${root}/notice_images/${noticeId}/${attemptId}.webp`;
    const assertWritable = async (transaction) => {
      const [profile, pointer, manifest, config] = await transaction.getAll(
        db.doc(`users/${uid}`),
        db.doc("site_settings/semester_active"),
        db.doc(`semester_manifests/${input.semesterId}`),
        db.doc("site_settings/config"),
      );
      if (
        !(
          profile.data()?.role === "teacher" ||
          identity.email === "westoria28@gmail.com"
        )
      )
        fail("permission-denied", "학교 배너를 등록할 교사 권한이 필요합니다.");
      const current = pointer.data(),
        scope = manifest.data(),
        settings = config.data();
      if (
        !current ||
        !scope ||
        current.semesterId !== input.semesterId ||
        scope.semesterId !== input.semesterId ||
        scope.status !== "ACTIVE" ||
        scope.readOnly === true ||
        !Number.isSafeInteger(scope.revision) ||
        scope.revision < 1 ||
        current.revision !== scope.revision ||
        (settings?.activeSemesterId &&
          settings.activeSemesterId !== input.semesterId)
      )
        fail(
          "failed-precondition",
          "현재 학기가 변경되었습니다. 화면을 새로고침한 뒤 다시 등록해 주세요.",
        );
    };
    const reservation = await db.runTransaction(async (transaction) => {
      await assertWritable(transaction);
      const previous = (await transaction.get(receiptRef)).data();
      if (previous && previous.payloadHash !== payloadHash)
        fail(
          "already-exists",
          "이미 사용한 등록 요청입니다. 새 등록창에서 다시 시도해 주세요.",
        );
      if (previous?.status === "COMPLETED")
        return {
          response: previous.response,
          cleanupPaths: previous.cleanupPaths || [],
        };
      if (previous?.status === "UPLOADING" && previous.leaseExpiresAtMs > now())
        fail(
          "aborted",
          "배너를 등록하고 있습니다. 잠시 후 다시 시도해 주세요.",
        );
      const cleanupPaths = [
        ...new Set(
          [...(previous?.cleanupPaths || []), previous?.storagePath].filter(
            Boolean,
          ),
        ),
      ];
      transaction.set(receiptRef, {
        ownerUid: uid,
        semesterId: input.semesterId,
        payloadHash,
        attemptId,
        storagePath,
        status: "UPLOADING",
        leaseExpiresAtMs: now() + 150_000,
        cleanupPaths,
        updatedAt: Timestamp.fromMillis(now()),
      });
      return { cleanupPaths };
    });
    const remove = async (path) => {
      if (!path) return;
      try {
        const safe = await db.runTransaction(async (transaction) => {
          const receipt = (await transaction.get(receiptRef)).data();
          if (!receipt || receipt.response?.imageStoragePath === path)
            return false;
          transaction.update(receiptRef, {
            cleanupPaths: [...new Set([...(receipt.cleanupPaths || []), path])],
          });
          return true;
        });
        if (!safe) return;
        await bucket.file(path).delete({ ignoreNotFound: true });
        await db.runTransaction(async (transaction) => {
          const receipt = (await transaction.get(receiptRef)).data();
          if (receipt)
            transaction.update(receiptRef, {
              cleanupPaths: (receipt.cleanupPaths || []).filter(
                (item) => item !== path,
              ),
            });
        });
      } catch (error) {
        console.warn("School banner cleanup pending", {
          storagePath: path,
          code: error.code,
        });
      }
    };
    // Failed deletion paths survive receipt updates and are retried on the next request,
    // including a replay after successful registration. Published images are excluded.
    for (const path of reservation.cleanupPaths) await remove(path);
    if (reservation.response)
      return { ...reservation.response, replayed: true };
    try {
      const image = await processImage(input.bytes);
      const token = uuid();
      await bucket
        .file(storagePath)
        .save(image.data, {
          resumable: false,
          contentType: "image/webp",
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            cacheControl: "public,max-age=86400",
            metadata: {
              ownerUid: uid,
              noticeId,
              firebaseStorageDownloadTokens: token,
            },
          },
        });
      const response = {
        noticeId,
        imageUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
        imageStoragePath: storagePath,
        imageWidth: image.info.width,
        imageHeight: image.info.height,
        imageByteSize: image.data.length,
        imageMimeType: "image/webp",
      };
      // Recheck session, role and semester after uploading; publish only in the current writable semester.
      await assertSession(request, { recentAuth: true, highRisk: true });
      const result = await db.runTransaction(async (transaction) => {
        await assertWritable(transaction);
        const receipt = (await transaction.get(receiptRef)).data();
        if (receipt?.status === "COMPLETED") return receipt.response;
        if (receipt?.attemptId !== attemptId || receipt?.status !== "UPLOADING")
          fail("aborted", "등록 요청이 갱신되었습니다. 다시 시도해 주세요.");
        const timestamp = Timestamp.fromMillis(now());
        transaction.create(noticeRef, {
          ...response,
          content: input.title,
          category: "event",
          targetType: "common",
          targetClass: null,
          targetDate: null,
          expiresAt: null,
          publishAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          noticeOrder: -now(),
          createdBy: uid,
          registrationRequestId: input.requestId,
        });
        transaction.update(receiptRef, {
          status: "COMPLETED",
          response,
          updatedAt: timestamp,
        });
        return response;
      });
      if (result.imageStoragePath !== storagePath) await remove(storagePath);
      return { ...result, replayed: result.imageStoragePath !== storagePath };
    } catch (error) {
      // Fence this attempt before deleting. A lost Firestore commit acknowledgement can
      // already mean success; reconciliation must preserve that published object's bytes.
      let reconciliation;
      try {
        reconciliation = await db.runTransaction(async (transaction) => {
          const receipt = (await transaction.get(receiptRef)).data();
          if (receipt?.status === "COMPLETED")
            return { response: receipt.response };
          if (receipt?.attemptId === attemptId)
            transaction.update(receiptRef, {
              status: "FAILED",
              updatedAt: Timestamp.fromMillis(now()),
            });
          return { safeToDelete: true };
        });
      } catch {
        // Keep uncertain objects for a retry; never delete an object that may be published.
        console.warn("School banner registration reconciliation pending", {
          noticeId,
          storagePath,
        });
      }
      if (reconciliation?.response) {
        if (reconciliation.response.imageStoragePath !== storagePath)
          await remove(storagePath);
        return { ...reconciliation.response, replayed: true };
      }
      if (reconciliation?.safeToDelete) await remove(storagePath);
      if (error instanceof HttpsError) throw error;
      fail(
        "unavailable",
        "배너를 저장하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.",
      );
    }
  };

exports.createRegisterSchoolBannerHandler = createRegisterSchoolBannerHandler;
exports.registerSchoolBanner = onCall(
  {
    region: "asia-northeast3",
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  (request) =>
    createRegisterSchoolBannerHandler({
      db: getFirestore(),
      bucket: getStorage().bucket(),
    })(request),
);
