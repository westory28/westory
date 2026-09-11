const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");

const SOURCE_ARCHIVE_COMMAND_TYPES = Object.freeze({
  PREPARE_SOURCE_ARCHIVE_UPLOAD: "prepareSourceArchiveUpload",
  SAVE_SOURCE_ARCHIVE_METADATA: "saveSourceArchiveMetadata",
  DELETE_SOURCE_ARCHIVE_ASSET: "deleteSourceArchiveAsset",
});
const UPLOAD_COLLECTION = "source_archive_uploads";
const METADATA_KEYS = [
  "title",
  "description",
  "era",
  "subject",
  "unit",
  "type",
  "tags",
  "source",
];
const MAX_REFERENCE_SCAN = 500;
const fail = (code, reason, message = "사료 저장 요청을 확인해 주세요.") => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () =>
  fail("invalid-argument", "SOURCE_ARCHIVE_PAYLOAD_INVALID");
const key = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const exact = (value, allowed) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((name) => !allowed.includes(name))
  )
    invalid();
};
const version = (value) =>
  value &&
  Number.isSafeInteger(value.seconds) &&
  Number.isSafeInteger(value.nanoseconds)
    ? `${value.seconds}:${value.nanoseconds}`
    : "";
const normalizeMetadata = (value) => {
  exact(value, METADATA_KEYS);
  for (const name of METADATA_KEYS.filter((name) => name !== "tags")) {
    if (
      typeof value[name] !== "string" ||
      value[name].length > (name === "description" ? 10000 : 1000)
    )
      invalid();
  }
  if (
    !value.title.trim() ||
    ![value.era, value.subject, value.unit].some((text) => text.trim()) ||
    !["photo", "map", "document", "poster", "artifact", "other"].includes(
      value.type,
    )
  )
    invalid();
  if (
    !Array.isArray(value.tags) ||
    value.tags.length > 100 ||
    value.tags.some(
      (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100,
    )
  )
    invalid();
  return Object.fromEntries(
    METADATA_KEYS.map((name) => [
      name,
      name === "tags"
        ? [...new Set(value.tags.map((tag) => tag.trim()))]
        : value[name].trim(),
    ]),
  );
};
const normalizeSourceArchivePayload = (type, value) => {
  const common = ["assetId", "expectedUpdatedAt"];
  exact(
    value,
    type === "prepareSourceArchiveUpload"
      ? [...common, "metadata", "upload"]
      : type === "saveSourceArchiveMetadata"
        ? [...common, "metadata"]
        : common,
  );
  if (
    !Object.values(SOURCE_ARCHIVE_COMMAND_TYPES).includes(type) ||
    (value.assetId !== "" && !key(value.assetId)) ||
    typeof value.expectedUpdatedAt !== "string" ||
    !/^(?:\d+:\d+)?$/.test(value.expectedUpdatedAt)
  )
    invalid();
  const result = {
    assetId: value.assetId,
    expectedUpdatedAt: value.expectedUpdatedAt,
  };
  if (
    !value.assetId &&
    (type !== "prepareSourceArchiveUpload" || value.expectedUpdatedAt)
  )
    invalid();
  if (type === "deleteSourceArchiveAsset") return result;
  result.metadata = normalizeMetadata(value.metadata);
  if (type === "saveSourceArchiveMetadata") return result;
  const upload = value.upload;
  exact(upload, [
    "mediaKind",
    "contentType",
    "byteSize",
    "sha256",
    "originalName",
    "originalMimeType",
    "originalByteSize",
    "originalWidth",
    "originalHeight",
  ]);
  if (
    !["image", "pdf"].includes(upload.mediaKind) ||
    (upload.mediaKind === "pdf"
      ? upload.contentType !== "application/pdf"
      : !["image/jpeg", "image/png", "image/webp"].includes(
          upload.contentType,
        )) ||
    !Number.isSafeInteger(upload.byteSize) ||
    upload.byteSize < 1 ||
    upload.byteSize > (upload.mediaKind === "pdf" ? 20 : 4.5) * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(upload.sha256)
  )
    invalid();
  for (const name of ["originalName", "originalMimeType"])
    if (typeof upload[name] !== "string" || upload[name].length > 255)
      invalid();
  for (const name of ["originalByteSize", "originalWidth", "originalHeight"])
    if (
      !Number.isSafeInteger(upload[name]) ||
      upload[name] < 0 ||
      upload[name] > 1000000000
    )
      invalid();
  return { ...result, upload: { ...upload } };
};
const assertActor = (actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole))
    fail(
      "permission-denied",
      "SOURCE_ARCHIVE_MANAGER_REQUIRED",
      "사료 관리 권한이 필요합니다.",
    );
};
const resolveAsset = async (transaction, payload, commandId) => {
  const assetId = payload.assetId || `asset-${commandId}`;
  const path = `source_archive/${assetId}`;
  const snapshot = await transaction.get(path);
  if (
    snapshot.exists !== Boolean(payload.assetId) ||
    (snapshot.exists &&
      (version(snapshot.data.updatedAt) !== payload.expectedUpdatedAt ||
        snapshot.data.deletedAt))
  )
    fail(
      "aborted",
      "SOURCE_ARCHIVE_CONTENT_CONFLICT",
      "다른 화면에서 사료를 변경했습니다. 편집 내용을 보관한 뒤 다시 열어 주세요.",
    );
  return { assetId, path, data: snapshot.data || {}, exists: snapshot.exists };
};
const assertNoReferences = async (transaction, assetId) => {
  const lessons = await transaction.queryGroup("lessons", {
    limit: MAX_REFERENCE_SCAN + 1,
  });
  if (lessons.length > MAX_REFERENCE_SCAN)
    fail(
      "failed-precondition",
      "SOURCE_ARCHIVE_REFERENCE_SCAN_LIMIT",
      "연결된 수업자료 전체를 확인할 수 없어 삭제를 중단했습니다. 사료는 그대로 보존됩니다.",
    );
  const prefix = `source-archive/${assetId}/`;
  const referencesAsset = (value) => {
    if (typeof value === "string")
      return (
        value.includes(prefix) || value.includes(encodeURIComponent(prefix))
      );
    if (Array.isArray(value)) return value.some(referencesAsset);
    if (value && typeof value === "object")
      return (
        value.sourceArchiveAssetId === assetId ||
        Object.values(value).some(referencesAsset)
      );
    return false;
  };
  if (lessons.some((lesson) => referencesAsset(lesson.data)))
    fail(
      "failed-precondition",
      "SOURCE_ARCHIVE_IN_USE",
      "수업자료에 연결된 사료입니다. 연결을 해제한 뒤 삭제해 주세요.",
    );
};
const searchText = (metadata, preview = "") =>
  [
    metadata.title,
    metadata.description,
    metadata.era,
    metadata.subject,
    metadata.unit,
    metadata.source,
    {
      photo: "사진",
      map: "지도",
      document: "문서",
      poster: "포스터",
      artifact: "유물",
      other: "기타",
    }[metadata.type],
    ...metadata.tags,
    preview.slice(0, 1200),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
const createSourceArchiveCommandAdapter = ({ now = Date.now } = {}) => ({
  apply: async ({
    transaction,
    payload,
    actor,
    commandType,
    commandId,
    timestamp,
  }) => {
    assertActor(actor);
    const current = await resolveAsset(transaction, payload, commandId);
    const done = (result, refs = [current.path]) => ({
      target: { kind: commandType, id: current.assetId, refs },
      sourceHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      result,
    });
    if (commandType === "deleteSourceArchiveAsset") {
      if (current.data.uploadWriteLeaseExpiresAtMs > now())
        fail(
          "failed-precondition",
          "SOURCE_ARCHIVE_UPLOAD_ACTIVE",
          "파일을 올리고 있습니다. 업로드 결과를 확인한 뒤 삭제해 주세요.",
        );
      if (current.data.processingStatus === "processing")
        fail(
          "failed-precondition",
          "SOURCE_ARCHIVE_PROCESSING_ACTIVE",
          "파일을 처리하고 있습니다. 처리가 끝난 뒤 삭제해 주세요.",
        );
      await assertNoReferences(transaction, current.assetId);
      transaction.set(
        current.path,
        {
          deletedAt: timestamp,
          deletedBy: actor.actorUid,
          deleteCommandId: commandId,
          deletionStatus: "PENDING",
          status: "archived",
          processingStatus: "archived",
          updatedAt: timestamp,
          file: {
            ...(current.data.file || {}),
            pendingUploadToken: "",
            pendingUploadPath: "",
          },
          image: {
            ...(current.data.image || {}),
            pendingUploadToken: "",
            pendingUploadPath: "",
          },
        },
        { merge: true },
      );
      return done({
        assetId: current.assetId,
        deleted: true,
        cleanupPending: true,
      });
    }
    if (commandType === "saveSourceArchiveMetadata") {
      transaction.set(
        current.path,
        {
          ...payload.metadata,
          searchText: searchText(
            payload.metadata,
            current.data.previewText || current.data.search?.previewText || "",
          ),
          updatedAt: timestamp,
          updatedBy: actor.actorUid,
        },
        { merge: true },
      );
      return done({ assetId: current.assetId });
    }
    if (current.data.processingStatus === "processing")
      fail(
        "failed-precondition",
        "SOURCE_ARCHIVE_PROCESSING_ACTIVE",
        "파일을 처리하고 있습니다. 처리가 끝난 뒤 다시 저장해 주세요.",
      );
    // Existing lesson links retain their revision paths. The processor must never
    // delete an older revision when a shared archive original is replaced.
    const uploadId = commandId,
      upload = payload.upload;
    const extension = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[upload.contentType];
    const storagePath = `source-archive/${current.assetId}/incoming/${uploadId}.${extension}`;
    const ticketPath = `${UPLOAD_COLLECTION}/${uploadId}`;
    if ((await transaction.get(ticketPath)).exists)
      fail("already-exists", "SOURCE_ARCHIVE_UPLOAD_ID_CONFLICT");
    const pending = {
      pendingUploadToken: uploadId,
      pendingUploadPath: storagePath,
    };
    const clearPending = { pendingUploadToken: "", pendingUploadPath: "" };
    transaction.set(
      current.path,
      {
        ...payload.metadata,
        schemaVersion: 3,
        mediaKind: upload.mediaKind,
        status: "uploading",
        processingStatus: "uploading",
        processingError: "",
        searchText: searchText(payload.metadata),
        previewText: "",
        extractionStatus:
          upload.mediaKind === "pdf" ? "queued" : "not-applicable",
        parseErrorMessage: "",
        extractedContentPath: "",
        extractedManifestPath: "",
        extractionVersion: "",
        parserKind: "",
        pageCount: 0,
        file: {
          ...(current.data.file || {}),
          originalName: upload.originalName,
          mimeType: upload.contentType,
          byteSize: upload.byteSize,
          ...(upload.mediaKind === "pdf" ? pending : clearPending),
        },
        image: {
          ...(current.data.image || {}),
          originalName: upload.originalName,
          originalMime: upload.originalMimeType,
          originalWidth: upload.originalWidth,
          originalHeight: upload.originalHeight,
          originalByteSize: upload.originalByteSize,
          ...(upload.mediaKind === "image" ? pending : clearPending),
        },
        search: {
          ...(current.data.search || {}),
          status: "pending",
          previewText: "",
        },
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
        ...(!current.exists
          ? { createdAt: timestamp, createdBy: actor.actorUid }
          : {}),
      },
      { merge: true },
    );
    transaction.create(ticketPath, {
      ...upload,
      uploadId,
      assetId: current.assetId,
      storagePath,
      ownerUid: actor.actorUid,
      status: "PENDING",
      expiresAtMs: now() + 3600000,
      createdAt: timestamp,
    });
    return done({ assetId: current.assetId, uploadId, storagePath }, [
      current.path,
      ticketPath,
    ]);
  },
});

const assertCallableActor = async (db, assertSession, request) => {
  const email = String(request.auth?.token?.email || "")
    .trim()
    .toLowerCase();
  if (email !== "westoria28@gmail.com" && !/@yongshin-ms\.ms\.kr$/.test(email))
    fail("permission-denied", "SOURCE_ARCHIVE_ACCOUNT_NOT_ALLOWED");
  const { uid } = await assertSession(request, {
    recentAuth: true,
    highRisk: true,
  });
  const profile = await db.doc(`users/${uid}`).get();
  if (!(email === "westoria28@gmail.com" || profile.data()?.role === "teacher"))
    fail("permission-denied", "SOURCE_ARCHIVE_MANAGER_REQUIRED");
  return uid;
};
const pendingToken = (asset) =>
  asset?.file?.pendingUploadToken || asset?.image?.pendingUploadToken || "";
const createSourceArchiveUploadHandler =
  ({
    db,
    bucket,
    assertSession,
    now = Date.now,
    imageMetadata = (bytes) =>
      require("sharp")(bytes, { limitInputPixels: 50000000 }).metadata(),
  }) =>
  async (request) => {
    const uid = await assertCallableActor(db, assertSession, request);
    exact(request.data, ["uploadId", "contentBase64"]);
    const { uploadId, contentBase64 } = request.data;
    if (
      !key(uploadId) ||
      typeof contentBase64 !== "string" ||
      !contentBase64.length ||
      contentBase64.length > 28 * 1024 * 1024 ||
      contentBase64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    )
      invalid();
    const ticketRef = db.doc(`${UPLOAD_COLLECTION}/${uploadId}`);
    const ticketSnap = await ticketRef.get(),
      ticket = ticketSnap.data();
    if (!ticketSnap.exists || ticket.ownerUid !== uid || !key(ticket.assetId))
      fail("permission-denied", "SOURCE_ARCHIVE_UPLOAD_NOT_OWNED");
    const bytes = Buffer.from(contentBase64, "base64");
    if (
      bytes.length !== ticket.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== ticket.sha256
    )
      invalid();
    const assetRef = db.doc(`source_archive/${ticket.assetId}`);
    const writeLeaseId = randomUUID();
    const state = await db.runTransaction(async (transaction) => {
      const [asset, latest] = await transaction.getAll(assetRef, ticketRef);
      const data = asset.data(),
        latestTicket = latest.data();
      if (!asset.exists || data.deletedAt)
        fail(
          "failed-precondition",
          "SOURCE_ARCHIVE_DELETED",
          "삭제된 사료에는 파일을 올릴 수 없습니다.",
        );
      if (
        ["UPLOADED", "PROCESSING", "COMPLETED"].includes(latestTicket?.status)
      )
        return "UPLOADED";
      if (latestTicket?.status === "FAILED")
        fail(
          "failed-precondition",
          "SOURCE_ARCHIVE_PROCESSING_FAILED",
          "파일은 저장되었지만 처리에 실패했습니다. 목록에서 저장된 사료를 다시 열어 파일을 올려 주세요. 편집 내용과 선택한 파일은 유지됩니다.",
        );
      if (pendingToken(data) !== uploadId || latestTicket?.expiresAtMs <= now())
        fail(
          "failed-precondition",
          "SOURCE_ARCHIVE_UPLOAD_EXPIRED",
          "업로드 준비가 만료되었거나 다른 파일로 바뀌었습니다. 사료를 다시 열어 저장해 주세요.",
        );
      if (data.uploadWriteLeaseExpiresAtMs > now())
        fail(
          "unavailable",
          "SOURCE_ARCHIVE_UPLOAD_ACTIVE",
          "파일 업로드 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
        );
      transaction.set(
        assetRef,
        {
          uploadWriteLeaseId: writeLeaseId,
          uploadWriteLeaseExpiresAtMs: now() + 150000,
        },
        { merge: true },
      );
      return "PENDING";
    });
    const result = { assetId: ticket.assetId, uploadId, uploaded: true };
    if (state === "UPLOADED") return result;
    if (ticket.mediaKind === "pdf") {
      if (
        !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")) ||
        !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))
      )
        invalid();
    } else {
      const meta = await imageMetadata(bytes);
      if (
        { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[
          meta.format
        ] !== ticket.contentType ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > 50000000
      )
        invalid();
    }
    const expectedPath = `source-archive/${ticket.assetId}/incoming/${uploadId}.${{ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[ticket.contentType]}`;
    if (ticket.storagePath !== expectedPath) invalid();
    const file = bucket.file(expectedPath);
    try {
      await file.save(bytes, {
        resumable: false,
        contentType: ticket.contentType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: "private,no-store,max-age=0",
          metadata: { uploadId, ownerUid: uid, sha256: ticket.sha256 },
        },
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      const [metadata] = await file.getMetadata();
      if (
        metadata.metadata?.sha256 !== ticket.sha256 ||
        Number(metadata.size) !== ticket.byteSize
      )
        fail("failed-precondition", "SOURCE_ARCHIVE_UPLOAD_OBJECT_CONFLICT");
    }
    await db.runTransaction(async (transaction) => {
      const [latest, latestAsset] = await transaction.getAll(
        ticketRef,
        assetRef,
      );
      if (latest.data()?.status === "PENDING")
        transaction.set(
          ticketRef,
          { status: "UPLOADED", uploadedAtMs: now() },
          { merge: true },
        );
      if (latestAsset.data()?.uploadWriteLeaseId === writeLeaseId)
        transaction.set(
          assetRef,
          { uploadWriteLeaseId: "", uploadWriteLeaseExpiresAtMs: 0 },
          { merge: true },
        );
    });
    return result;
  };

const createSourceArchiveCleanupHandler =
  ({ db, bucket, assertSession, now = Date.now }) =>
  async (request) => {
    await assertCallableActor(db, assertSession, request);
    exact(request.data, ["assetId", "deleteCommandId"]);
    const { assetId, deleteCommandId } = request.data;
    if (!key(assetId) || !key(deleteCommandId)) invalid();
    const assetRef = db.doc(`source_archive/${assetId}`);
    const snapshot = await assetRef.get(),
      asset = snapshot.data();
    if (
      !snapshot.exists ||
      !asset.deletedAt ||
      asset.deleteCommandId !== deleteCommandId
    )
      fail("failed-precondition", "SOURCE_ARCHIVE_DELETE_NOT_PREPARED");
    try {
      // A tombstone is retained permanently, so delayed processors cannot recreate
      // the asset. Never suppress Storage errors or claim a partial delete succeeded.
      const prefix = `source-archive/${assetId}/`;
      for (let page = 0; page < 5; page += 1) {
        const [files] = await bucket.getFiles({
          prefix,
          autoPaginate: false,
          maxResults: 100,
        });
        for (const file of files) await file.delete({ ignoreNotFound: true });
        if (files.length < 100) break;
      }
      const [remaining] = await bucket.getFiles({
        prefix,
        autoPaginate: false,
        maxResults: 1,
      });
      if (remaining.length)
        fail("unavailable", "SOURCE_ARCHIVE_CLEANUP_PENDING");
      await assetRef.set(
        {
          deletionStatus: "COMPLETED",
          cleanupCompletedAtMs: now(),
          cleanupError: "",
        },
        { merge: true },
      );
      return { assetId, deleted: true };
    } catch (error) {
      await assetRef.set(
        {
          deletionStatus: "FAILED",
          cleanupError:
            "파일 정리가 끝나지 않았습니다. 삭제를 다시 눌러 이어서 정리해 주세요.",
        },
        { merge: true },
      );
      throw new HttpsError(
        "unavailable",
        "파일 정리가 끝나지 않았습니다. 삭제를 다시 눌러 이어서 정리해 주세요.",
        { reason: "SOURCE_ARCHIVE_CLEANUP_PENDING" },
      );
    }
  };

// Explicit maintenance helper only. It is not scheduled and never deletes
// originals or derived revisions; interrupted cleanup remains EXPIRING to retry.
const cleanupExpiredSourceArchiveUploads = async ({
  db,
  bucket,
  now = Date.now,
  limit = 100,
}) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid();
  const snapshots = await db
    .collection(UPLOAD_COLLECTION)
    .where("expiresAtMs", "<=", now())
    .limit(limit)
    .get();
  const result = { inspected: snapshots.docs.length, cleaned: 0, failed: 0 };
  for (const snapshot of snapshots.docs) {
    const ticket = snapshot.data();
    if (["COMPLETED", "EXPIRED", "CLEANUP_BLOCKED"].includes(ticket.status)) {
      await snapshot.ref.set(
        { expiresAtMs: FieldValue.delete() },
        { merge: true },
      );
      continue;
    }
    if (
      !key(ticket.assetId) ||
      !key(ticket.uploadId) ||
      !["PENDING", "UPLOADED", "FAILED", "EXPIRING", "PROCESSING"].includes(
        ticket.status,
      )
    ) {
      await snapshot.ref.set(
        {
          status: "CLEANUP_BLOCKED",
          expiresAtMs: FieldValue.delete(),
          cleanupError: "업로드 기록의 식별자 또는 상태를 확인해 주세요.",
        },
        { merge: true },
      );
      continue;
    }
    const prefix = `source-archive/${ticket.assetId}/incoming/${ticket.uploadId}.`;
    if (
      !ticket.storagePath?.startsWith(prefix) ||
      ticket.storagePath.slice(prefix.length).includes("/")
    ) {
      await snapshot.ref.set(
        {
          status: "CLEANUP_BLOCKED",
          expiresAtMs: FieldValue.delete(),
          cleanupError: "업로드 기록의 파일 경로를 확인해 주세요.",
        },
        { merge: true },
      );
      continue;
    }
    const assetRef = db.doc(`source_archive/${ticket.assetId}`);
    try {
      const claimed = await db.runTransaction(async (transaction) => {
        const [assetSnap, latestTicket] = await transaction.getAll(
          assetRef,
          snapshot.ref,
        );
        const asset = assetSnap.data(),
          latest = latestTicket.data();
        if (
          !latest ||
          latest.expiresAtMs > now() ||
          !["PENDING", "UPLOADED", "FAILED", "EXPIRING", "PROCESSING"].includes(
            latest.status,
          )
        )
          return false;
        if (
          asset?.processingStatus === "processing" &&
          (!asset.processingLeaseExpiresAtMs ||
            asset.processingLeaseExpiresAtMs > now())
        )
          return false;
        if (asset?.uploadWriteLeaseExpiresAtMs > now()) return false;
        if (
          assetSnap.exists &&
          !asset.deletedAt &&
          pendingToken(asset) === ticket.uploadId
        )
          transaction.set(
            assetRef,
            {
              status: "failed",
              processingStatus: "failed",
              processingLeaseId: "",
              processingLeaseExpiresAtMs: 0,
              processingError:
                "업로드 준비가 만료되었습니다. 파일을 다시 선택해 저장해 주세요.",
              file: {
                ...(asset.file || {}),
                pendingUploadToken: "",
                pendingUploadPath: "",
              },
              image: {
                ...(asset.image || {}),
                pendingUploadToken: "",
                pendingUploadPath: "",
              },
            },
            { merge: true },
          );
        transaction.set(snapshot.ref, { status: "EXPIRING" }, { merge: true });
        return true;
      });
      if (!claimed) continue;
      await bucket.file(ticket.storagePath).delete({ ignoreNotFound: true });
      await snapshot.ref.set(
        {
          status: "EXPIRED",
          expiresAtMs: FieldValue.delete(),
          expiredAtMs: now(),
          cleanupError: "",
        },
        { merge: true },
      );
      result.cleaned += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

module.exports = {
  SOURCE_ARCHIVE_COMMAND_TYPES,
  UPLOAD_COLLECTION,
  MAX_REFERENCE_SCAN,
  version,
  normalizeSourceArchivePayload,
  createSourceArchiveCommandAdapter,
  createSourceArchiveUploadHandler,
  createSourceArchiveCleanupHandler,
  cleanupExpiredSourceArchiveUploads,
};
