const { createHash } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");
const { assertActiveApplicationSession } = require("./sessionAuthority");

const createUploadHandler =
  ({
    db,
    bucket,
    assertSession = assertActiveApplicationSession,
    now = Date.now,
  }) =>
  async (request) => {
    const { uid } = await assertSession(request, {
      recentAuth: true,
      highRisk: true,
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
    const [ticketSnap, profileSnap, pointerSnap] = await db.getAll(
      db.doc(`lesson_asset_uploads/${uploadId}`),
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
    if (
      bytes.length !== ticket.byteSize ||
      bytes.length > 20 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== ticket.sha256
    )
      throw new HttpsError(
        "invalid-argument",
        "파일 내용이 업로드 요청과 일치하지 않습니다.",
      );
    if (ticket.status !== "PENDING")
      return { uploadId, accepted: true, replayed: true };
    try {
      // Immutable object creation: a lost acknowledgement can be retried safely.
      await bucket.file(ticket.storagePath).save(bytes, {
        resumable: false,
        contentType: ticket.contentType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { metadata: { ownerUid: uid, uploadId } },
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      return { uploadId, accepted: true, replayed: true };
    }
    return { uploadId, accepted: true, replayed: false };
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
