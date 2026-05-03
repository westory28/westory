const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onObjectFinalized } = require("firebase-functions/v2/storage");

const {
  SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
  buildPdfRevisionPathsForBasePath,
  normalizeText,
  saveOriginalBinaryFile,
} = require("./sourceArchiveProcessor");
const { savePdfStructureArtifacts } = require("./sourceArchivePdfAdapter");

const db = getFirestore();
const storage = getStorage();

const REGION = "asia-northeast3";
const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "history-quiz-yongsin.firebasestorage.app";

const EMPTY_LESSON_PDF_FILE = {
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

const createEmptyLessonPdfProcessing = () => ({
  mediaKind: "",
  currentRevision: "",
  file: { ...EMPTY_LESSON_PDF_FILE },
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

const normalizeFailureMessage = (error) => {
  const message = normalizeText(error?.message || "processing-failed");
  return message ? message.slice(0, 240) : "processing-failed";
};

const normalizeLessonPdfProcessing = (value, fallback = {}) => {
  const source =
    value && typeof value === "object" ? value : {};
  const file =
    source.file && typeof source.file === "object" ? source.file : {};
  const fallbackPdfName = normalizeText(fallback.pdfName);
  const fallbackPdfStoragePath = normalizeText(fallback.pdfStoragePath);
  const normalizedStoragePath =
    normalizeText(file.storagePath) || fallbackPdfStoragePath;
  const hasAttachedPdf = Boolean(
    fallbackPdfName ||
      normalizedStoragePath ||
      normalizeText(source.currentRevision) ||
      normalizeText(source.extractedManifestPath),
  );

  return {
    ...createEmptyLessonPdfProcessing(),
    mediaKind: source.mediaKind === "pdf" || hasAttachedPdf ? "pdf" : "",
    currentRevision: normalizeText(source.currentRevision),
    file: {
      ...EMPTY_LESSON_PDF_FILE,
      storagePath: normalizedStoragePath,
      originalName: normalizeText(file.originalName) || fallbackPdfName,
      mimeType:
        normalizeText(file.mimeType) ||
        (hasAttachedPdf ? "application/pdf" : ""),
      byteSize: Number(file.byteSize) || 0,
      width: Number(file.width) || 0,
      height: Number(file.height) || 0,
      revision: normalizeText(file.revision),
      originalAvailable:
        file.originalAvailable === true || Boolean(normalizedStoragePath),
      legacyPreviewOnly: file.legacyPreviewOnly === true,
      pendingUploadToken: normalizeText(file.pendingUploadToken),
      pendingUploadPath: normalizeText(file.pendingUploadPath),
    },
    previewText: normalizeText(source.previewText),
    pageCount: Number(source.pageCount) || 0,
    extractionStatus:
      source.extractionStatus === "queued" ||
      source.extractionStatus === "processing" ||
      source.extractionStatus === "ready" ||
      source.extractionStatus === "failed"
        ? source.extractionStatus
        : "not-applicable",
    extractionVersion: normalizeText(source.extractionVersion),
    extractedAt: source.extractedAt || null,
    extractedContentPath: normalizeText(source.extractedContentPath),
    extractedManifestPath: normalizeText(source.extractedManifestPath),
    parserKind: normalizeText(source.parserKind),
    parseErrorMessage: normalizeFailureMessage({
      message: source.parseErrorMessage,
    }),
  };
};

const parseLessonPdfIncomingPath = (objectName) => {
  const normalized = normalizeText(objectName);

  const scopedMatch = normalized.match(
    /^years\/([^/]+)\/semesters\/([^/]+)\/lesson_pdfs\/([^/]+)\/incoming\/([^/.]+)(?:\.[^.]+)?$/,
  );
  if (scopedMatch) {
    const [, year, semester, unitId, uploadToken] = scopedMatch;
    return {
      year,
      semester,
      unitId,
      uploadToken,
      baseStoragePath: `years/${year}/semesters/${semester}/lesson_pdfs/${unitId}`,
      lessonCollectionPath: `years/${year}/semesters/${semester}/lessons`,
    };
  }

  const legacyMatch = normalized.match(
    /^lesson_pdfs\/([^/]+)\/incoming\/([^/.]+)(?:\.[^.]+)?$/,
  );
  if (legacyMatch) {
    const [, unitId, uploadToken] = legacyMatch;
    return {
      year: "",
      semester: "",
      unitId,
      uploadToken,
      baseStoragePath: `lesson_pdfs/${unitId}`,
      lessonCollectionPath: "lessons",
    };
  }

  return null;
};

const getCustomMetadata = (event) =>
  event?.data?.metadata && typeof event.data.metadata === "object"
    ? event.data.metadata
    : {};

const deleteFileIfExists = async (file) => {
  await file.delete({ ignoreNotFound: true }).catch(() => undefined);
};

const deleteStoragePaths = async (bucket, paths) => {
  await Promise.all(
    Array.from(new Set(paths.filter(Boolean))).map((storagePath) =>
      deleteFileIfExists(bucket.file(storagePath)),
    ),
  );
};

const deleteStoragePrefix = async (bucket, prefix) => {
  const normalizedPrefix = normalizeText(prefix);
  if (!normalizedPrefix) return;

  const [files] = await bucket.getFiles({ prefix: normalizedPrefix });
  await Promise.all(files.map((file) => deleteFileIfExists(file)));
};

const resolveLessonDocRef = async (parsed, customMetadata) => {
  const lessonDocId = normalizeText(customMetadata.lessonDocId);
  if (lessonDocId) {
    const directPaths = [parsed.lessonCollectionPath];
    if (parsed.lessonCollectionPath !== "lessons") {
      directPaths.push("lessons");
    }

    for (const collectionPath of directPaths) {
      const directRef = db.doc(`${collectionPath}/${lessonDocId}`);
      const directSnap = await directRef.get();
      if (directSnap.exists) return directRef;
    }
  }

  const collectionPaths = [parsed.lessonCollectionPath];
  if (parsed.lessonCollectionPath !== "lessons") {
    collectionPaths.push("lessons");
  }

  for (const collectionPath of collectionPaths) {
    const lessonQuery = await db
      .collection(collectionPath)
      .where("unitId", "==", parsed.unitId)
      .limit(1)
      .get();

    if (!lessonQuery.empty) {
      return lessonQuery.docs[0].ref;
    }
  }

  return null;
};

exports.processLessonPdfIncomingUpload = onObjectFinalized(
  {
    region: REGION,
    bucket: STORAGE_BUCKET,
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  async (event) => {
    const objectName = normalizeText(event.data.name);
    const parsed = parseLessonPdfIncomingPath(objectName);
    if (!parsed) return;

    const bucket = storage.bucket(event.data.bucket);
    const incomingFile = bucket.file(objectName);

    let lessonRef = null;
    let lessonData = {};
    let lessonPdfProcessing = createEmptyLessonPdfProcessing();
    let revisionPaths = null;
    let originalInfo = null;
    let generatedPaths = [];
    let shouldDeleteIncomingFile = false;
    let sourceStoragePath = "";

    try {
      const customMetadata = getCustomMetadata(event);
      sourceStoragePath = normalizeText(customMetadata.sourceStoragePath);
      lessonRef = await resolveLessonDocRef(parsed, customMetadata);
      if (!lessonRef) {
        return;
      }

      const lessonSnap = await lessonRef.get();
      if (!lessonSnap.exists) {
        return;
      }

      lessonData = lessonSnap.data() || {};
      lessonPdfProcessing = normalizeLessonPdfProcessing(
        lessonData.pdfProcessing,
        {
          pdfName: lessonData.pdfName,
          pdfStoragePath: lessonData.pdfStoragePath,
        },
      );

      if (lessonPdfProcessing.file.pendingUploadToken !== parsed.uploadToken) {
        shouldDeleteIncomingFile = true;
        return;
      }

      await lessonRef.set(
        {
          pdfProcessing: {
            ...lessonPdfProcessing,
            mediaKind: "pdf",
            extractionStatus: "processing",
            parseErrorMessage: "",
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const sourceFile = sourceStoragePath
        ? bucket.file(sourceStoragePath)
        : incomingFile;
      const [inputBuffer] = await sourceFile.download();
      const revision = `v-${Date.now()}`;
      const contentType =
        normalizeText(event.data.contentType) ||
        lessonPdfProcessing.file.mimeType ||
        "application/pdf";

      revisionPaths = buildPdfRevisionPathsForBasePath({
        basePath: parsed.baseStoragePath,
        revision,
      });

      originalInfo = await saveOriginalBinaryFile({
        bucket,
        originalPath: revisionPaths.originalPath,
        inputBuffer,
        contentType,
      });
      generatedPaths.push(revisionPaths.originalPath);

      const extractionResult = await savePdfStructureArtifacts({
        bucket,
        inputBuffer,
        originalName:
          normalizeText(
            lessonPdfProcessing.file.originalName || lessonData.pdfName,
          ) || "lesson.pdf",
        revisionPaths,
      });
      generatedPaths.push(...extractionResult.generatedPaths);

      const latestSnap = await lessonRef.get();
      if (!latestSnap.exists) {
        await deleteStoragePaths(bucket, generatedPaths);
        return;
      }

      const latestLesson = latestSnap.data() || {};
      const latestProcessing = normalizeLessonPdfProcessing(
        latestLesson.pdfProcessing,
        {
          pdfName: latestLesson.pdfName,
          pdfStoragePath: latestLesson.pdfStoragePath,
        },
      );

      if (latestProcessing.file.pendingUploadToken !== parsed.uploadToken) {
        await deleteStoragePaths(bucket, generatedPaths);
        shouldDeleteIncomingFile = true;
        return;
      }

      const previousRevision = normalizeText(
        latestProcessing.currentRevision || latestProcessing.file.revision,
      );

      await lessonRef.set(
        {
          pdfUrl: "",
          pdfStoragePath: revisionPaths.originalPath,
          pdfProcessing: {
            ...latestProcessing,
            mediaKind: "pdf",
            currentRevision: revisionPaths.revision,
            previewText: normalizeText(extractionResult.previewText),
            pageCount:
              Number(extractionResult.pageCount) ||
              Number(latestProcessing.pageCount) ||
              0,
            extractionStatus: "ready",
            extractionVersion:
              normalizeText(extractionResult.extractionVersion) ||
              SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
            extractedAt: FieldValue.serverTimestamp(),
            extractedContentPath: revisionPaths.extractedContentPath,
            extractedManifestPath: revisionPaths.extractedManifestPath,
            parserKind: normalizeText(extractionResult.parserKind),
            parseErrorMessage: "",
            file: {
              ...latestProcessing.file,
              storagePath: revisionPaths.originalPath,
              originalName:
                normalizeText(
                  latestProcessing.file.originalName || latestLesson.pdfName,
                ) || "lesson.pdf",
              mimeType: originalInfo.mimeType,
              byteSize: originalInfo.byteSize,
              width: 0,
              height: 0,
              revision: revisionPaths.revision,
              originalAvailable: true,
              legacyPreviewOnly: false,
              pendingUploadToken: "",
              pendingUploadPath: "",
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (previousRevision && previousRevision !== revisionPaths.revision) {
        await deleteStoragePrefix(
          bucket,
          `${parsed.baseStoragePath}/${previousRevision}/`,
        );
      }
      shouldDeleteIncomingFile = true;
    } catch (error) {
      console.error("Failed to process lesson pdf extraction:", error);
      shouldDeleteIncomingFile = Boolean(
        sourceStoragePath ||
          (revisionPaths?.originalPath &&
            generatedPaths.includes(revisionPaths.originalPath)),
      );

      if (revisionPaths?.extractedPath) {
        await deleteStoragePrefix(bucket, revisionPaths.extractedPath).catch(
          () => undefined,
        );
      }
      if (revisionPaths?.originalPath && generatedPaths.length > 1) {
        await deleteStoragePaths(
          bucket,
          generatedPaths.filter(
            (storagePath) => storagePath !== revisionPaths.originalPath,
          ),
        ).catch(() => undefined);
      }

      if (lessonRef) {
        const failedProcessing = {
          ...lessonPdfProcessing,
          mediaKind: lessonPdfProcessing.mediaKind || "pdf",
          currentRevision: revisionPaths?.revision || lessonPdfProcessing.currentRevision,
          previewText: revisionPaths ? "" : lessonPdfProcessing.previewText,
          pageCount: Number(lessonPdfProcessing.pageCount) || 0,
          extractionStatus: "failed",
          extractionVersion:
            normalizeText(lessonPdfProcessing.extractionVersion) ||
            SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
          extractedAt: revisionPaths ? null : lessonPdfProcessing.extractedAt,
          extractedContentPath: "",
          extractedManifestPath: "",
          parserKind: normalizeText(lessonPdfProcessing.parserKind),
          parseErrorMessage: normalizeFailureMessage(error),
          file: {
            ...lessonPdfProcessing.file,
            storagePath: revisionPaths?.originalPath || lessonPdfProcessing.file.storagePath,
            originalName:
              normalizeText(
                lessonPdfProcessing.file.originalName || lessonData.pdfName,
              ) || "lesson.pdf",
            mimeType:
              originalInfo?.mimeType ||
              lessonPdfProcessing.file.mimeType ||
              "application/pdf",
            byteSize:
              originalInfo?.byteSize ||
              Number(lessonPdfProcessing.file.byteSize) ||
              0,
            width: 0,
            height: 0,
            revision: revisionPaths?.revision || lessonPdfProcessing.file.revision,
            originalAvailable: Boolean(
              revisionPaths?.originalPath || lessonPdfProcessing.file.storagePath,
            ),
            legacyPreviewOnly: false,
            pendingUploadToken: "",
            pendingUploadPath: "",
          },
        };

        await lessonRef
          .set(
            {
              pdfProcessing: failedProcessing,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined);
      }
    } finally {
      if (!shouldDeleteIncomingFile) return;
      await deleteFileIfExists(incomingFile);
    }
  },
);
