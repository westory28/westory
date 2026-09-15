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
const METADATA_KEYS = [
  "publishAt",
  "expiresAt",
  "category",
  "targetType",
  "targetClass",
  "targetDate",
  "developerLogPostId",
];
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const normalizeMetadata = (data) => {
  const result = {};
  for (const key of METADATA_KEYS) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (["publishAt", "expiresAt"].includes(key)) {
      if (
        value !== null &&
        (typeof value !== "string" ||
          value.length > 40 ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            value,
          ) ||
          !Number.isFinite(Date.parse(value)) ||
          !Number.isFinite(Date.parse(value.slice(0, 10))) ||
          new Date(value.slice(0, 10)).toISOString().slice(0, 10) !==
            value.slice(0, 10) ||
          Number(value.slice(11, 13)) > 23)
      )
        fail("invalid-argument", "공개 일시를 확인해 주세요.");
      result[key] = value === null ? null : new Date(value).toISOString();
    } else if (key === "category") {
      if (
        ![
          "event",
          "exam",
          "performance",
          "prep",
          "dday",
          "normal",
          "notice",
        ].includes(value)
      )
        fail("invalid-argument", "배너 분류를 확인해 주세요.");
      result[key] = value;
    } else if (key === "targetType") {
      if (!["common", "all", "class"].includes(value))
        fail("invalid-argument", "공개 대상을 확인해 주세요.");
      result[key] = value;
    } else if (key === "targetClass") {
      if (
        value !== null &&
        (typeof value !== "string" || !/^[1-9]\d?-[1-9]\d?$/.test(value))
      )
        fail("invalid-argument", "대상 학급을 확인해 주세요.");
      result[key] = value;
    } else if (key === "targetDate") {
      if (
        value !== null &&
        (typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        fail("invalid-argument", "D-Day 날짜를 확인해 주세요.");
      result[key] = value;
    } else {
      if (value !== null && !validId(value))
        fail("invalid-argument", "연결할 개발자 일지를 확인해 주세요.");
      result[key] = value;
    }
  }
  return result;
};
const effectiveMetadata = (metadata, previous, timestamp) => {
  const millis = (value) =>
    value?.toMillis ? value.toMillis() : Date.parse(value);
  const expiryUnchanged =
    !Object.hasOwn(metadata, "expiresAt") ||
    (metadata.expiresAt === null && previous?.expiresAt == null) ||
    (metadata.expiresAt !== null &&
      previous?.expiresAt != null &&
      millis(metadata.expiresAt) === millis(previous.expiresAt));
  // Older banners can have an end date but no start date. Editing their title or
  // image must preserve that open-ended start, including already expired banners.
  // Changing either bound still uses the regular publication-range validation.
  const preserveLegacyStart =
    Boolean(previous) &&
    previous.publishAt == null &&
    (!Object.hasOwn(metadata, "publishAt") || metadata.publishAt === null) &&
    expiryUnchanged;
  const result = {
    category: "event",
    targetType: "common",
    targetClass: null,
    targetDate: null,
    developerLogPostId: null,
    publishAt: timestamp,
    expiresAt: null,
  };
  for (const key of METADATA_KEYS) {
    if (previous && previous[key] !== undefined) result[key] = previous[key];
    if (Object.hasOwn(metadata, key))
      result[key] = ["publishAt", "expiresAt"].includes(key)
        ? metadata[key] === null
          ? key === "publishAt"
            ? timestamp
            : null
          : Timestamp.fromDate(new Date(metadata[key]))
        : metadata[key];
  }
  if (result.targetType === "class" && !result.targetClass)
    fail("invalid-argument", "공개할 학급을 선택해 주세요.");
  if (["common", "all"].includes(result.targetType)) result.targetClass = null;
  if (result.category === "dday" && !result.targetDate)
    fail("invalid-argument", "D-Day 날짜를 선택해 주세요.");
  if (result.category !== "dday") result.targetDate = null;
  if (preserveLegacyStart) result.publishAt = null;
  if (
    result.expiresAt &&
    !preserveLegacyStart &&
    !(millis(result.expiresAt) > millis(result.publishAt))
  )
    fail("invalid-argument", "공개 종료 일시는 시작 일시보다 뒤여야 합니다.");
  return result;
};
const createWritableCheck =
  ({ db, identity, semesterId }) =>
  async (transaction) => {
    const [profile, pointer, manifest, config] = await transaction.getAll(
      db.doc(`users/${identity.uid}`),
      db.doc("site_settings/semester_active"),
      db.doc(`semester_manifests/${semesterId}`),
      db.doc("site_settings/config"),
    );
    if (
      !(
        profile.data()?.role === "teacher" ||
        identity.email === "westoria28@gmail.com"
      )
    )
      fail("permission-denied", "학교 배너를 관리할 교사 권한이 필요합니다.");
    const current = pointer.data(),
      scope = manifest.data(),
      settings = config.data();
    if (
      !current ||
      !scope ||
      current.semesterId !== semesterId ||
      scope.semesterId !== semesterId ||
      scope.status !== "ACTIVE" ||
      scope.readOnly === true ||
      !Number.isSafeInteger(scope.revision) ||
      scope.revision < 1 ||
      current.revision !== scope.revision ||
      (settings?.activeSemesterId && settings.activeSemesterId !== semesterId)
    )
      fail(
        "failed-precondition",
        "현재 학기가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      );
  };
const assertBannerRevision = (snapshot, expected) => {
  if (!snapshot.exists || !snapshot.data()?.imageUrl)
    fail(
      "not-found",
      "학교 배너를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
    );
  if ((snapshot.data().revision ?? 0) !== expected)
    fail(
      "aborted",
      "다른 화면에서 배너를 변경했습니다. 목록을 새로고침해 주세요.",
    );
};
const ownedImagePath = (root, noticeId, path) =>
  typeof path === "string" &&
  path.startsWith(`${root}/notice_images/${noticeId}/`) &&
  /^[^/]+$/.test(path.slice(`${root}/notice_images/${noticeId}/`.length));
const createCleanup =
  ({ db, bucket, receiptRef, noticeRef, root, noticeId }) =>
  async (path) => {
    if (!ownedImagePath(root, noticeId, path)) return;
    try {
      const safe = await db.runTransaction(async (transaction) => {
        const [receiptSnapshot, noticeSnapshot] = await transaction.getAll(
          receiptRef,
          noticeRef,
        );
        const receipt = receiptSnapshot.data();
        if (!receipt || noticeSnapshot.data()?.imageStoragePath === path)
          return false;
        const references = await transaction.get(
          db
            .collection(`${root}/notices`)
            .where("imageStoragePath", "==", path)
            .limit(1),
        );
        if (!references.empty) return false;
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
          "noticeId",
          "expectedRevision",
          ...METADATA_KEYS,
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
    (data.noticeId !== undefined &&
      (!validId(data.noticeId) || !validRevision(data.expectedRevision))) ||
    (data.noticeId === undefined && data.expectedRevision !== undefined) ||
    (data.contentBase64 !== undefined &&
      (typeof data.contentBase64 !== "string" ||
        !data.contentBase64.length ||
        data.contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
        data.contentBase64.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data.contentBase64))) ||
    (!data.noticeId && !data.contentBase64)
  )
    fail("invalid-argument", "배너 제목과 이미지 파일을 확인해 주세요.");
  const bytes = data.contentBase64
    ? Buffer.from(data.contentBase64, "base64")
    : null;
  if (
    bytes &&
    (!bytes.length ||
      bytes.length > MAX_BYTES ||
      bytes.toString("base64") !== data.contentBase64)
  )
    fail("invalid-argument", "배너 이미지 용량이나 파일 형식을 확인해 주세요.");
  return {
    semesterId: data.semesterId,
    requestId: data.requestId,
    title: data.title.trim(),
    bytes,
    noticeId: data.noticeId || null,
    expectedRevision: data.expectedRevision ?? null,
    metadata: normalizeMetadata(data),
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
    const requestKey = `banner_${hash(`${uid}\n${input.semesterId}\n${input.requestId}`)}`;
    const noticeId = input.noticeId || requestKey;
    // Keep the first create API's receipt hashes valid for retries after deployment.
    const payloadHash =
      !input.noticeId && !Object.keys(input.metadata).length
        ? hash(`${input.title}\n${hash(input.bytes)}`)
        : hash(
            JSON.stringify({
              title: input.title,
              bytes: input.bytes ? hash(input.bytes) : null,
              noticeId: input.noticeId,
              expectedRevision: input.expectedRevision,
              metadata: input.metadata,
            }),
          );
    const [year, semester] = input.semesterId.split("-");
    const root = `years/${year}/semesters/${semester}`;
    const receiptRef = db.doc(`school_banner_registrations/${requestKey}`);
    const noticeRef = db.doc(`${root}/notices/${noticeId}`);
    const attemptId = uuid();
    const storagePath = input.bytes
      ? `${root}/notice_images/${noticeId}/${attemptId}.webp`
      : null;
    const assertWritable = createWritableCheck({
      db,
      identity,
      semesterId: input.semesterId,
    });
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
      const currentNotice = await transaction.get(noticeRef);
      if (input.noticeId)
        assertBannerRevision(currentNotice, input.expectedRevision);
      effectiveMetadata(
        input.metadata,
        currentNotice.data(),
        Timestamp.fromMillis(now()),
      );
      if (
        input.metadata.developerLogPostId &&
        !(
          await transaction.get(
            db.doc(
              `site_settings/developer_logs/items/${input.metadata.developerLogPostId}`,
            ),
          )
        ).exists
      )
        fail("not-found", "연결할 개발자 일지를 찾을 수 없습니다.");
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
    const remove = createCleanup({
      db,
      bucket,
      receiptRef,
      noticeRef,
      root,
      noticeId,
    });
    // Failed deletion paths survive receipt updates and are retried on the next request,
    // including a replay after successful registration. Published images are excluded.
    for (const path of reservation.cleanupPaths) await remove(path);
    if (reservation.response)
      return { ...reservation.response, replayed: true };
    try {
      let uploadedImage = null;
      if (input.bytes) {
        const image = await processImage(input.bytes);
        const token = uuid();
        await bucket.file(storagePath).save(image.data, {
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
        uploadedImage = {
          noticeId,
          imageUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
          imageStoragePath: storagePath,
          imageWidth: image.info.width,
          imageHeight: image.info.height,
          imageByteSize: image.data.length,
          imageMimeType: "image/webp",
        };
      }
      // Recheck session, role and semester after uploading; publish only in the current writable semester.
      await assertSession(request, { recentAuth: true, highRisk: true });
      const result = await db.runTransaction(async (transaction) => {
        await assertWritable(transaction);
        const receipt = (await transaction.get(receiptRef)).data();
        if (receipt?.status === "COMPLETED") return receipt.response;
        if (receipt?.attemptId !== attemptId || receipt?.status !== "UPLOADING")
          fail("aborted", "등록 요청이 갱신되었습니다. 다시 시도해 주세요.");
        const currentNotice = await transaction.get(noticeRef);
        if (input.noticeId)
          assertBannerRevision(currentNotice, input.expectedRevision);
        if (
          input.metadata.developerLogPostId &&
          !(
            await transaction.get(
              db.doc(
                `site_settings/developer_logs/items/${input.metadata.developerLogPostId}`,
              ),
            )
          ).exists
        )
          fail("not-found", "연결할 개발자 일지를 찾을 수 없습니다.");
        const timestamp = Timestamp.fromMillis(now());
        const previous = currentNotice.data();
        const metadata = effectiveMetadata(input.metadata, previous, timestamp);
        const retainedImage = {};
        for (const key of [
          "imageUrl",
          "imageStoragePath",
          "imageWidth",
          "imageHeight",
          "imageByteSize",
          "imageMimeType",
        ])
          if (previous?.[key] !== undefined) retainedImage[key] = previous[key];
        const response = {
          noticeId,
          ...(uploadedImage || retainedImage),
          revision: (previous?.revision ?? 0) + 1,
        };
        const savedNotice = {
          ...response,
          ...metadata,
          content: input.title,
          updatedAt: timestamp,
          updatedBy: uid,
          registrationRequestId: input.requestId,
        };
        if (input.noticeId) transaction.update(noticeRef, savedNotice);
        else
          transaction.create(noticeRef, {
            ...savedNotice,
            createdAt: timestamp,
            createdBy: uid,
            noticeOrder: -now(),
          });
        const cleanupPaths = [
          ...new Set([
            ...(receipt.cleanupPaths || []),
            ...(uploadedImage &&
            previous?.imageStoragePath &&
            previous.imageStoragePath !== storagePath &&
            ownedImagePath(root, noticeId, previous.imageStoragePath)
              ? [previous.imageStoragePath]
              : []),
          ]),
        ];
        transaction.update(receiptRef, {
          status: "COMPLETED",
          response,
          cleanupPaths,
          updatedAt: timestamp,
        });
        return response;
      });
      if (storagePath && result.imageStoragePath !== storagePath)
        await remove(storagePath);
      const savedReceipt = (
        await db.runTransaction((transaction) => transaction.get(receiptRef))
      ).data();
      for (const path of savedReceipt?.cleanupPaths || []) await remove(path);
      return {
        ...result,
        replayed: Boolean(
          storagePath && result.imageStoragePath !== storagePath,
        ),
      };
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

const createManageSchoolBannersHandler =
  ({
    db,
    bucket,
    assertSession = assertActiveApplicationSession,
    now = Date.now,
  } = {}) =>
  async (request) => {
    const identity = await assertSession(request, {
      recentAuth: true,
      highRisk: true,
    });
    const data = request.data;
    const commonKeys = ["semesterId", "requestId", "action", "_session"];
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.semesterId !== "string" ||
      !/^\d{4}-[12]$/.test(data.semesterId) ||
      typeof data.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(data.requestId) ||
      !["DELETE", "REORDER"].includes(data.action) ||
      Object.keys(data).some(
        (key) =>
          ![
            ...commonKeys,
            ...(data.action === "DELETE"
              ? ["noticeId", "expectedRevision"]
              : ["items"]),
          ].includes(key),
      )
    )
      fail("invalid-argument", "배너 관리 요청을 확인해 주세요.");
    let payload;
    if (data.action === "DELETE") {
      if (!validId(data.noticeId) || !validRevision(data.expectedRevision))
        fail("invalid-argument", "삭제할 배너를 확인해 주세요.");
      payload = {
        action: data.action,
        noticeId: data.noticeId,
        expectedRevision: data.expectedRevision,
      };
    } else {
      if (
        !Array.isArray(data.items) ||
        data.items.length < 1 ||
        data.items.length > 200 ||
        data.items.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            Object.keys(item).some(
              (key) => !["id", "revision"].includes(key),
            ) ||
            !validId(item.id) ||
            !validRevision(item.revision),
        ) ||
        new Set(data.items.map((item) => item.id)).size !== data.items.length
      )
        fail(
          "invalid-argument",
          "순서를 변경할 전체 배너 목록을 확인해 주세요. 한 번에 200개까지 변경할 수 있습니다.",
        );
      payload = {
        action: data.action,
        items: data.items.map((item) => ({
          id: item.id,
          revision: item.revision,
        })),
      };
    }
    const [year, semester] = data.semesterId.split("-");
    const root = `years/${year}/semesters/${semester}`;
    const requestKey = `manage_${hash(`${identity.uid}\n${data.semesterId}\n${data.requestId}`)}`;
    const receiptRef = db.doc(`school_banner_registrations/${requestKey}`);
    const payloadHash = hash(JSON.stringify(payload));
    const assertWritable = createWritableCheck({
      db,
      identity,
      semesterId: data.semesterId,
    });
    const result = await db
      .runTransaction(async (transaction) => {
        await assertWritable(transaction);
        const receipt = (await transaction.get(receiptRef)).data();
        if (receipt && receipt.payloadHash !== payloadHash)
          fail(
            "already-exists",
            "이미 사용한 관리 요청입니다. 목록을 새로고침해 주세요.",
          );
        if (receipt?.status === "COMPLETED")
          return {
            response: receipt.response,
            cleanupPaths: receipt.cleanupPaths || [],
            replayed: true,
          };
        const timestamp = Timestamp.fromMillis(now());
        let response,
          cleanupPaths = [];
        if (payload.action === "DELETE") {
          const ref = db.doc(`${root}/notices/${payload.noticeId}`);
          const current = await transaction.get(ref);
          assertBannerRevision(current, payload.expectedRevision);
          const path = current.data().imageStoragePath;
          if (ownedImagePath(root, payload.noticeId, path))
            cleanupPaths = [path];
          transaction.delete(ref);
          response = { noticeId: payload.noticeId, deleted: true };
        } else {
          const snapshot = await transaction.get(
            db.collection(`${root}/notices`),
          );
          const banners = snapshot.docs.filter((item) =>
            Boolean(item.data()?.imageUrl),
          );
          if (
            banners.length !== payload.items.length ||
            banners.some(
              (item) => !payload.items.some((target) => target.id === item.id),
            )
          )
            fail(
              "aborted",
              "배너 목록이 변경되었습니다. 목록을 새로고침한 뒤 순서를 다시 변경해 주세요.",
            );
          const byId = new Map(banners.map((item) => [item.id, item]));
          for (const item of payload.items)
            assertBannerRevision(byId.get(item.id), item.revision);
          for (const [index, item] of payload.items.entries())
            transaction.update(db.doc(`${root}/notices/${item.id}`), {
              noticeOrder: index,
              revision: item.revision + 1,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
          response = {
            items: payload.items.map((item, index) => ({
              id: item.id,
              revision: item.revision + 1,
              noticeOrder: index,
            })),
          };
        }
        transaction.create(receiptRef, {
          ownerUid: identity.uid,
          semesterId: data.semesterId,
          payloadHash,
          action: payload.action,
          status: "COMPLETED",
          response,
          cleanupPaths,
          updatedAt: timestamp,
        });
        return { response, cleanupPaths, replayed: false };
      })
      .catch(async (error) => {
        if (error instanceof HttpsError) throw error;
        try {
          const receipt = (
            await db.runTransaction((transaction) =>
              transaction.get(receiptRef),
            )
          ).data();
          if (
            receipt?.payloadHash === payloadHash &&
            receipt.status === "COMPLETED"
          )
            return {
              response: receipt.response,
              cleanupPaths: receipt.cleanupPaths || [],
              replayed: true,
            };
        } catch {
          /* A later retry can reconcile a lost acknowledgement. */
        }
        fail(
          "unavailable",
          "배너 변경을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      });
    if (payload.action === "DELETE") {
      const remove = createCleanup({
        db,
        bucket,
        receiptRef,
        noticeRef: db.doc(`${root}/notices/${payload.noticeId}`),
        root,
        noticeId: payload.noticeId,
      });
      for (const path of result.cleanupPaths) await remove(path);
    }
    return { ...result.response, replayed: result.replayed };
  };

exports.createRegisterSchoolBannerHandler = createRegisterSchoolBannerHandler;
exports.createManageSchoolBannersHandler = createManageSchoolBannersHandler;
exports.manageSchoolBanners = onCall(
  {
    region: "asia-northeast3",
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  (request) =>
    createManageSchoolBannersHandler({
      db: getFirestore(),
      bucket: getStorage().bucket(),
    })(request),
);
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
