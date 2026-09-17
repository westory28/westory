const { createHash } = require("node:crypto");

// Both the synchronous transport and the retryable Storage worker enforce the
// same byte checks. PDF structure extraction remains a separate background job.
const validateLessonAssetBytes = async (ticket, buffer) => {
  if (
    buffer.length !== ticket.byteSize ||
    buffer.length > 20 * 1024 * 1024 ||
    createHash("sha256").update(buffer).digest("hex") !== ticket.sha256
  )
    throw new Error("파일 내용이 업로드 요청과 일치하지 않습니다.");
  if (ticket.kind === "PDF") {
    if (
      ticket.contentType !== "application/pdf" ||
      !buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    )
      throw new Error("올바른 PDF 파일이 아닙니다.");
    return {
      mediaKind: "pdf",
      currentRevision: ticket.uploadId,
      previewText: "",
      pageCount: 0,
      extractionStatus: "processing",
      extractionVersion: "",
      extractedAt: null,
      extractedContentPath: "",
      extractedManifestPath: "",
      parserKind: "",
      parseErrorMessage: "",
      file: {
        storagePath: ticket.storagePath,
        originalName: ticket.originalName,
        mimeType: ticket.contentType,
        byteSize: ticket.byteSize,
        width: 0,
        height: 0,
        revision: ticket.uploadId,
        originalAvailable: true,
        legacyPreviewOnly: false,
        pendingUploadToken: "",
        pendingUploadPath: "",
      },
    };
  }
  const info = await require("sharp")(buffer, {
    limitInputPixels: 50000000,
  }).metadata();
  const mime = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }[info.format];
  if (mime !== ticket.contentType || !info.width || !info.height)
    throw new Error("이미지 형식을 확인할 수 없습니다.");
  return undefined;
};

module.exports = { validateLessonAssetBytes };
