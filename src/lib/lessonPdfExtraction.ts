export type LessonPdfMediaKind = "" | "pdf";

export type LessonPdfExtractionStatus =
  | "not-applicable"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export interface LessonPdfFileMeta {
  storagePath: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  revision: string;
  originalAvailable: boolean;
  legacyPreviewOnly: boolean;
  pendingUploadToken: string;
  pendingUploadPath: string;
}

export interface LessonPdfProcessingMeta {
  mediaKind: LessonPdfMediaKind;
  currentRevision: string;
  file: LessonPdfFileMeta;
  previewText: string;
  pageCount: number;
  extractionStatus: LessonPdfExtractionStatus;
  extractionVersion: string;
  extractedAt?: unknown;
  extractedContentPath: string;
  extractedManifestPath: string;
  parserKind: string;
  parseErrorMessage: string;
}

type LessonPdfProcessingFallback = Partial<LessonPdfProcessingMeta> & {
  pdfName?: string;
  pdfStoragePath?: string;
};

const normalizeText = (value: unknown) => String(value || "").trim();

const normalizeMediaKind = (
  value: unknown,
  hasAttachedPdf: boolean,
): LessonPdfMediaKind => {
  if (value === "pdf") return "pdf";
  return hasAttachedPdf ? "pdf" : "";
};

const normalizeExtractionStatus = (
  value: unknown,
): LessonPdfExtractionStatus => {
  if (
    value === "not-applicable" ||
    value === "queued" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed"
  ) {
    return value;
  }
  return "not-applicable";
};

const normalizeErrorMessage = (value: unknown) =>
  normalizeText(value).slice(0, 240);

export const EMPTY_LESSON_PDF_FILE_META: LessonPdfFileMeta = {
  storagePath: "",
  originalName: "",
  mimeType: "",
  byteSize: 0,
  width: 0,
  height: 0,
  revision: "",
  originalAvailable: false,
  legacyPreviewOnly: false,
  pendingUploadToken: "",
  pendingUploadPath: "",
};

export const createEmptyLessonPdfProcessingMeta =
  (): LessonPdfProcessingMeta => ({
    mediaKind: "",
    currentRevision: "",
    file: { ...EMPTY_LESSON_PDF_FILE_META },
    previewText: "",
    pageCount: 0,
    extractionStatus: "not-applicable",
    extractionVersion: "",
    extractedAt: null,
    extractedContentPath: "",
    extractedManifestPath: "",
    parserKind: "",
    parseErrorMessage: "",
  });

export const normalizeLessonPdfProcessingMeta = (
  value: unknown,
  fallback: LessonPdfProcessingFallback = {},
): LessonPdfProcessingMeta => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<LessonPdfProcessingMeta>)
      : {};
  const fileSource =
    source.file && typeof source.file === "object"
      ? (source.file as Partial<LessonPdfFileMeta>)
      : {};
  const fallbackPdfName = normalizeText(fallback.pdfName);
  const fallbackPdfStoragePath = normalizeText(fallback.pdfStoragePath);
  const normalizedStoragePath =
    normalizeText(fileSource.storagePath) || fallbackPdfStoragePath;
  const hasAttachedPdf = Boolean(
    fallbackPdfName ||
    normalizedStoragePath ||
    normalizeText(source.currentRevision) ||
    normalizeText(source.extractedManifestPath),
  );
  const extractionStatus = normalizeExtractionStatus(source.extractionStatus);

  return {
    ...createEmptyLessonPdfProcessingMeta(),
    mediaKind: normalizeMediaKind(source.mediaKind, hasAttachedPdf),
    currentRevision: normalizeText(source.currentRevision),
    file: {
      ...EMPTY_LESSON_PDF_FILE_META,
      storagePath: normalizedStoragePath,
      originalName:
        normalizeText(fileSource.originalName) || fallbackPdfName || "",
      mimeType:
        normalizeText(fileSource.mimeType) ||
        (hasAttachedPdf ? "application/pdf" : ""),
      byteSize: Number(fileSource.byteSize) || 0,
      width: Number(fileSource.width) || 0,
      height: Number(fileSource.height) || 0,
      revision: normalizeText(fileSource.revision),
      originalAvailable:
        fileSource.originalAvailable === true || Boolean(normalizedStoragePath),
      legacyPreviewOnly: fileSource.legacyPreviewOnly === true,
      pendingUploadToken: normalizeText(fileSource.pendingUploadToken),
      pendingUploadPath: normalizeText(fileSource.pendingUploadPath),
    },
    previewText: normalizeText(source.previewText),
    pageCount: Number(source.pageCount) || 0,
    extractionStatus:
      hasAttachedPdf || extractionStatus !== "not-applicable"
        ? extractionStatus
        : "not-applicable",
    extractionVersion: normalizeText(source.extractionVersion),
    extractedAt: source.extractedAt ?? null,
    extractedContentPath: normalizeText(source.extractedContentPath),
    extractedManifestPath: normalizeText(source.extractedManifestPath),
    parserKind: normalizeText(source.parserKind),
    parseErrorMessage: normalizeErrorMessage(source.parseErrorMessage),
  };
};

export const buildQueuedLessonPdfProcessingMeta = (params: {
  pdfName: string;
  pdfStoragePath: string;
  byteSize: number;
  pageCount: number;
  pendingUploadToken: string;
  pendingUploadPath: string;
  previous?: LessonPdfProcessingMeta | null;
}) => {
  const previous = normalizeLessonPdfProcessingMeta(params.previous, {
    pdfName: params.pdfName,
    pdfStoragePath: params.pdfStoragePath,
  });
  const nextStoragePath =
    normalizeText(params.pdfStoragePath) || previous.file.storagePath;

  return {
    ...previous,
    mediaKind: "pdf" as const,
    previewText: "",
    pageCount: Math.max(0, Number(params.pageCount) || 0),
    extractionStatus: "queued" as const,
    extractionVersion: "",
    extractedAt: null,
    extractedContentPath: "",
    extractedManifestPath: "",
    parserKind: "",
    parseErrorMessage: "",
    file: {
      ...previous.file,
      storagePath: nextStoragePath,
      originalName: normalizeText(params.pdfName) || previous.file.originalName,
      mimeType: "application/pdf",
      byteSize: Math.max(0, Number(params.byteSize) || 0),
      width: 0,
      height: 0,
      originalAvailable: Boolean(nextStoragePath),
      legacyPreviewOnly: false,
      pendingUploadToken: normalizeText(params.pendingUploadToken),
      pendingUploadPath: normalizeText(params.pendingUploadPath),
    },
  } satisfies LessonPdfProcessingMeta;
};

export const buildFailedLessonPdfProcessingMeta = (
  current: LessonPdfProcessingMeta | null | undefined,
  errorMessage: string,
) => {
  const normalized = normalizeLessonPdfProcessingMeta(current);

  return {
    ...normalized,
    mediaKind: normalized.mediaKind || ("pdf" as const),
    extractionStatus: "failed" as const,
    parseErrorMessage: normalizeErrorMessage(errorMessage),
    file: {
      ...normalized.file,
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
  } satisfies LessonPdfProcessingMeta;
};

export const getLessonPdfExtractionStatusLabel = (
  value: LessonPdfProcessingMeta | null | undefined,
) => {
  const meta = normalizeLessonPdfProcessingMeta(value);
  if (meta.mediaKind !== "pdf") return "";

  if (meta.extractionStatus === "queued") {
    return "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C \uB300\uAE30\uC911";
  }
  if (meta.extractionStatus === "processing") {
    return "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C \uC911";
  }
  if (meta.extractionStatus === "ready") {
    return meta.pageCount > 0
      ? `\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C \uC644\uB8CC ${meta.pageCount}\uCABD`
      : "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C \uC644\uB8CC";
  }
  if (meta.extractionStatus === "failed") {
    return "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C \uC2E4\uD328";
  }
  return "";
};

export const getLessonPdfExtractionStatusTone = (
  value: LessonPdfProcessingMeta | null | undefined,
) => {
  const meta = normalizeLessonPdfProcessingMeta(value);
  if (meta.mediaKind !== "pdf") return "slate" as const;
  if (meta.extractionStatus === "queued") return "amber" as const;
  if (meta.extractionStatus === "processing") return "blue" as const;
  if (meta.extractionStatus === "ready") return "emerald" as const;
  if (meta.extractionStatus === "failed") return "rose" as const;
  return "slate" as const;
};

export const getLessonPdfExtractionHelpText = (
  value: LessonPdfProcessingMeta | null | undefined,
) => {
  const meta = normalizeLessonPdfProcessingMeta(value);
  if (meta.mediaKind !== "pdf") return "";

  if (meta.extractionStatus === "queued") {
    return "\uC6D0\uBCF8 PDF\uB294 \uC5C5\uB85C\uB4DC\uB418\uC5C8\uACE0, \uD14D\uC2A4\uD2B8 \uAD6C\uC870 \uCD94\uCD9C \uB300\uAE30\uC5F4\uC5D0 \uB4F1\uB85D\uB410\uC2B5\uB2C8\uB2E4.";
  }
  if (meta.extractionStatus === "processing") {
    return "\uC6D0\uBCF8 PDF\uB294 \uBCF4\uC874\uB418\uC5C8\uACE0, \uD14D\uC2A4\uD2B8 \uAD6C\uC870\uB97C \uCD94\uCD9C\uD558\uB294 \uC911\uC785\uB2C8\uB2E4.";
  }
  if (meta.extractionStatus === "ready") {
    return "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C\uC774 \uC644\uB8CC\uB410\uC2B5\uB2C8\uB2E4.";
  }
  if (meta.extractionStatus === "failed") {
    return "\uC6D0\uBCF8 PDF \uAD6C\uC870 \uCD94\uCD9C\uC740 \uC2E4\uD328\uD588\uC9C0\uB9CC, PDF \uD559\uC2B5\uC9C0 \uC6D0\uBCF8 \uC811\uADFC\uC740 \uACC4\uC18D \uAC00\uB2A5\uD569\uB2C8\uB2E4.";
  }
  return "";
};
