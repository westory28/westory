const { randomUUID } = require("node:crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { storageBucket } = require("firebase-functions/params");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { ASSET_COLLECTION } = require("./lessonManagement");
const { validateLessonAssetBytes } = require("./lessonAssetVerification");
const {
  buildPdfRevisionPathsForBasePath,
} = require("./sourceArchiveProcessor");
const { savePdfStructureArtifacts } = require("./sourceArchivePdfAdapter");

exports.processLessonAssetUpload = onObjectFinalized(
  {
    region: "asia-northeast3",
    bucket: storageBucket,
    timeoutSeconds: 300,
    memory: "1GiB",
    retry: true,
  },
  async (event) => {
    const match = String(event.data.name || "").match(
      /^lesson_uploads\/([A-Za-z0-9_-]{1,160})\/source$/,
    );
    if (!match) return;
    const db = getFirestore();
    const ticketRef = db.doc(`${ASSET_COLLECTION}/${match[1]}`);
    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) return;
    const ticket = ticketSnap.data();
    if (
      ticket.storagePath !== event.data.name ||
      ticket.expiresAtMs <= Date.now() ||
      !["PENDING", "VERIFIED", "ATTACHED"].includes(ticket.status)
    )
      return;
    const generation = String(event.data.generation || "");
    if (ticket.generation && ticket.generation !== generation) return;
    if (
      ["VERIFIED", "ATTACHED"].includes(ticket.status) &&
      (ticket.kind !== "PDF" ||
        ["ready", "failed"].includes(ticket.pdfProcessing?.extractionStatus))
    )
      return;
    const bucket = getStorage().bucket(event.data.bucket);
    const file = bucket.file(ticket.storagePath, { generation });
    let pdfProcessing;
    try {
      if (
        Number(event.data.size) !== ticket.byteSize ||
        event.data.contentType !== ticket.contentType
      )
        throw new Error("파일 크기 또는 형식이 일치하지 않습니다.");
      const [buffer] = await file.download();
      pdfProcessing = await validateLessonAssetBytes(ticket, buffer);
      await file.setMetadata({
        metadata: {
          firebaseStorageDownloadTokens: ticket.downloadToken,
          ownerUid: ticket.ownerUid,
          uploadId: ticket.uploadId,
        },
        cacheControl: "private,max-age=3600",
      });
      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(ticket.storagePath)}?alt=media&token=${ticket.downloadToken}`;
      const verified = await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ticketRef);
        if (
          !latest.exists ||
          !["PENDING", "VERIFIED", "ATTACHED"].includes(latest.data().status) ||
          (latest.data().generation && latest.data().generation !== generation)
        )
          return false;
        transaction.set(
          ticketRef,
          {
            status:
              latest.data().status === "ATTACHED" ? "ATTACHED" : "VERIFIED",
            generation,
            url,
            verifiedAt: FieldValue.serverTimestamp(),
            ...(pdfProcessing
              ? { pdfProcessing: latest.data().pdfProcessing || pdfProcessing }
              : {}),
          },
          { merge: true },
        );
        return true;
      });
      if (!verified || ticket.kind !== "PDF") return;
      const extractionAttempt = randomUUID();
      const claimed = await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ticketRef);
        if (
          !latest.exists ||
          !["VERIFIED", "ATTACHED"].includes(latest.data().status) ||
          latest.data().generation !== generation ||
          ["ready", "failed"].includes(
            latest.data().pdfProcessing?.extractionStatus,
          )
        )
          return false;
        if (Number(latest.data().extractionLeaseUntil || 0) > Date.now())
          throw new Error("lesson-pdf-extraction-lease-busy");
        transaction.set(
          ticketRef,
          { extractionAttempt, extractionLeaseUntil: Date.now() + 310000 },
          { merge: true },
        );
        return true;
      });
      if (!claimed) return;
      const [year, term] = ticket.semesterId.split("-");
      const revisionPaths = buildPdfRevisionPathsForBasePath({
        basePath: `years/${year}/semesters/${term}/lesson_pdfs/${ticket.unitId}`,
        revision: ticket.uploadId,
      });
      try {
        const extraction = await savePdfStructureArtifacts({
          bucket,
          inputBuffer: buffer,
          originalName: ticket.originalName || "lesson.pdf",
          revisionPaths,
        });
        pdfProcessing = {
          ...pdfProcessing,
          previewText: extraction.previewText || "",
          pageCount: Number(extraction.pageCount) || 0,
          extractionStatus: "ready",
          extractionVersion: extraction.extractionVersion || "",
          extractedAt: FieldValue.serverTimestamp(),
          extractedContentPath: revisionPaths.extractedContentPath,
          extractedManifestPath: revisionPaths.extractedManifestPath,
          parserKind: extraction.parserKind || "",
        };
      } catch (error) {
        pdfProcessing = {
          ...pdfProcessing,
          extractionStatus: "failed",
          parseErrorMessage: String(
            error.message || "PDF 구조 추출에 실패했습니다.",
          ).slice(0, 240),
        };
      }
      // Attach and finalize can arrive in either order. Only this exact asset's
      // processing fields may change; newer content and answer IDs stay intact.
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ticketRef);
        const attached = latest.exists && latest.data().status === "ATTACHED";
        const lessonRef = db.doc(ticket.lessonPath);
        const currentLesson = attached
          ? await transaction.get(lessonRef)
          : null;
        if (
          !latest.exists ||
          latest.data().generation !== generation ||
          latest.data().extractionAttempt !== extractionAttempt ||
          ["ready", "failed"].includes(
            latest.data().pdfProcessing?.extractionStatus,
          ) ||
          !["VERIFIED", "ATTACHED"].includes(latest.data().status)
        )
          return;
        transaction.set(ticketRef, { pdfProcessing }, { merge: true });
        if (
          currentLesson?.exists &&
          currentLesson.data().pdfStoragePath === ticket.storagePath
        )
          transaction.set(lessonRef, { pdfProcessing }, { merge: true });
      });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ticketRef);
        if (latest.exists && latest.data().status === "PENDING")
          transaction.set(
            ticketRef,
            {
              status: "FAILED",
              error: String(error.message || "파일 검증에 실패했습니다.").slice(
                0,
                240,
              ),
            },
            { merge: true },
          );
      });
      // A verified upload may need a retried extraction/commit after a worker
      // interruption or a transient database failure. Keep the event retryable.
      if ((await ticketRef.get()).data()?.status !== "FAILED") throw error;
    }
  },
);
