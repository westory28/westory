const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");
const { assertActiveApplicationSession } = require("./sessionAuthority");
const { validateLessonAssetBytes } = require("./lessonAssetVerification");

const uploadResult = (uploadId, replayed, ticket) => ({
  uploadId,
  accepted: true,
  replayed,
  ...(["VERIFIED", "ATTACHED"].includes(ticket.status) && ticket.url
    ? {
        verifiedAsset: {
          status: ticket.status,
          url: ticket.url,
          storagePath: ticket.storagePath,
          ...(ticket.pdfProcessing
            ? { pdfProcessing: ticket.pdfProcessing }
            : {}),
        },
      }
    : {}),
});

const createUploadHandler =
  ({
    db,
    bucket,
    assertSession = assertActiveApplicationSession,
    now = Date.now,
  }) =>
  async (request) => {
    const { uid } = await assertSession(request, {
      recentAuth: false,
      highRisk: false,
    });
    const { uploadId, contentBase64 } = request.data || {};
    if (
      typeof uploadId !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(uploadId) ||
      typeof contentBase64 !== "string" ||
      !contentBase64.length ||
      contentBase64.length > 28 * 1024 * 1024 ||
      contentBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    )
      throw new HttpsError(
        "invalid-argument",
        "파일 업로드 요청을 확인해 주세요.",
      );
    const ticketRef = db.doc(`lesson_asset_uploads/${uploadId}`);
    const [ticketSnap, profileSnap, pointerSnap] = await db.getAll(
      ticketRef,
      db.doc(`users/${uid}`),
      db.doc("site_settings/semester_active"),
    );
    const ticket = ticketSnap.data();
    if (
      !ticketSnap.exists ||
      ticket.ownerUid !== uid ||
      !(
        profileSnap.data()?.role === "teacher" ||
        request.auth?.token?.email === "westoria28@gmail.com"
      ) ||
      ticket.storagePath !== `lesson_uploads/${uploadId}/source` ||
      !Number.isFinite(ticket.expiresAtMs) ||
      ticket.expiresAtMs <= now() ||
      !["PENDING", "VERIFIED", "ATTACHED"].includes(ticket.status)
    )
      throw new HttpsError(
        "permission-denied",
        "유효한 본인 업로드 요청이 필요합니다.",
      );
    const manifest = (
      await db.doc(`semester_manifests/${ticket.semesterId}`).get()
    ).data();
    const pointer = pointerSnap.data();
    if (
      !manifest ||
      manifest.status !== "ACTIVE" ||
      pointer?.semesterId !== ticket.semesterId ||
      pointer.revision !== ticket.expectedSemesterRevision ||
      manifest.revision !== ticket.expectedSemesterRevision
    )
      throw new HttpsError(
        "failed-precondition",
        "현재 학기가 변경되었습니다.",
      );
    const bytes = Buffer.from(contentBase64, "base64");
    let pdfProcessing;
    try {
      pdfProcessing = await validateLessonAssetBytes(ticket, bytes);
    } catch (error) {
      throw new HttpsError(
        "invalid-argument",
        String(error.message || "파일 내용을 확인해 주세요."),
      );
    }
    if (ticket.status !== "PENDING")
      return uploadResult(uploadId, true, ticket);
    const file = bucket.file(ticket.storagePath);
    const metadata = {
      firebaseStorageDownloadTokens: ticket.downloadToken,
      ownerUid: uid,
      uploadId,
    };
    let replayed = false;
    try {
      // Immutable object creation: a lost acknowledgement can be retried safely.
      // Publish the token only after the supplied bytes pass all format checks.
      await file.save(bytes, {
        resumable: false,
        contentType: ticket.contentType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { metadata, cacheControl: "private,max-age=3600" },
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      replayed = true;
    }
    // The Storage SDK fills file.metadata from the successful upload response.
    // A retry must inspect the existing immutable generation instead.
    const verifyStoredBytes = replayed || !file.metadata?.generation;
    const object = !verifyStoredBytes
      ? file.metadata
      : (await file.getMetadata())[0];
    const generation = String(object.generation || "");
    if (
      !generation ||
      Number(object.size) !== ticket.byteSize ||
      object.contentType !== ticket.contentType ||
      object.metadata?.ownerUid !== uid ||
      object.metadata?.uploadId !== uploadId
    )
      throw new HttpsError(
        "failed-precondition",
        "저장된 파일을 확인할 수 없습니다.",
      );
    if (verifyStoredBytes) {
      // 412 may follow an interrupted older transport. Never assume that the
      // bytes submitted on this retry are the bytes stored by the first request.
      const existing = bucket.file(ticket.storagePath, { generation });
      const [stored] = await existing.download();
      await validateLessonAssetBytes(ticket, stored);
      if (
        object.metadata.firebaseStorageDownloadTokens !== ticket.downloadToken
      )
        await existing.setMetadata({
          metadata,
          cacheControl: "private,max-age=3600",
        });
    }
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(ticket.storagePath)}?alt=media&token=${ticket.downloadToken}`;
    const verified = await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(ticketRef);
      const current = latest.data();
      if (
        !latest.exists ||
        !["PENDING", "VERIFIED", "ATTACHED"].includes(current.status) ||
        current.expiresAtMs <= now() ||
        current.ownerUid !== uid ||
        [
          "uploadId",
          "storagePath",
          "sha256",
          "byteSize",
          "contentType",
          "kind",
          "downloadToken",
          "semesterId",
          "expectedSemesterRevision",
        ].some((key) => current[key] !== ticket[key]) ||
        (current.generation && current.generation !== generation)
      )
        throw new HttpsError(
          "failed-precondition",
          "업로드 요청이 변경되었습니다.",
        );
      const update = {
        status: current.status === "ATTACHED" ? "ATTACHED" : "VERIFIED",
        generation,
        url,
        verifiedAt: current.verifiedAt || FieldValue.serverTimestamp(),
        ...(pdfProcessing
          ? { pdfProcessing: current.pdfProcessing || pdfProcessing }
          : {}),
      };
      transaction.set(ticketRef, update, { merge: true });
      return { ...current, ...update };
    });
    return uploadResult(uploadId, replayed, verified);
  };
exports.createUploadHandler = createUploadHandler;
exports.uploadLessonAssetContent = onCall(
  {
    region: "asia-northeast3",
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  (request) =>
    createUploadHandler({ db: getFirestore(), bucket: getStorage().bucket() })(
      request,
    ),
);
