const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");

const {
  SOURCE_ARCHIVE_MEDIA_KIND,
  SOURCE_ARCHIVE_PDF_MEDIA_KIND,
  SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  normalizePreviewText,
  normalizeText,
  mergeSearchText,
  buildRevisionPaths,
  buildPdfRevisionPaths,
  saveOriginalSourceArchiveFile,
  renderSourceArchiveVariants,
  buildSourceArchiveSearchState,
} = require("./sourceArchiveProcessor");
const { saveSourceArchivePdfArtifacts } = require("./sourceArchivePdfAdapter");
Object.assign(exports, require("./lessonPdfBeta"));

const db = getFirestore();
const storage = getStorage();

const REGION = "asia-northeast3";
const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "history-quiz-yongsin.firebasestorage.app";
const ADMIN_EMAIL = "westoria28@gmail.com";
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;
const SOURCE_ARCHIVE_COLLECTION = "source_archive";
const SOURCE_ARCHIVE_PREFIX = "source-archive";

const getAuthEmail = (request) =>
  String(request.auth?.token?.email || "")
    .trim()
    .toLowerCase();

const assertAllowedWestoryUser = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const email = getAuthEmail(request);
  if (!email || (!SCHOOL_EMAIL_PATTERN.test(email) && email !== ADMIN_EMAIL)) {
    throw new HttpsError(
      "permission-denied",
      "This account cannot use Westory source archive functions.",
    );
  }

  return { uid: request.auth.uid, email };
};

const getUserProfile = async (uid) => {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile is missing.");
  }
  return userSnap.data() || {};
};

const assertSourceArchiveManager = async (request) => {
  const actor = assertAllowedWestoryUser(request);
  if (actor.email === ADMIN_EMAIL) {
    return actor;
  }

  const profile = await getUserProfile(actor.uid);
  if (normalizeText(profile.role) === "teacher") {
    return actor;
  }

  throw new HttpsError(
    "permission-denied",
    "Only teacher accounts can modify source archive assets.",
  );
};

const buildAssetDocPath = (assetId) =>
  `${SOURCE_ARCHIVE_COLLECTION}/${assetId}`;
const buildAssetPrefix = (assetId) => `${SOURCE_ARCHIVE_PREFIX}/${assetId}/`;
const buildAssetRevisionPrefix = (assetId, revision) =>
  `${SOURCE_ARCHIVE_PREFIX}/${assetId}/${revision}/`;

const parseIncomingPath = (objectName) => {
  const match = normalizeText(objectName).match(
    /^source-archive\/([^/]+)\/incoming\/([^/.]+)(?:\.[^.]+)?$/,
  );
  if (!match) return null;

  return {
    assetId: match[1],
    uploadToken: match[2],
  };
};

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

const normalizeFailureMessage = (error) => {
  const message = normalizeText(error?.message || "processing-failed");
  return message ? message.slice(0, 240) : "processing-failed";
};

const isPdfUpload = (asset, contentType, objectName) =>
  normalizeText(asset?.mediaKind) === SOURCE_ARCHIVE_PDF_MEDIA_KIND ||
  normalizeText(contentType) === "application/pdf" ||
  /\.pdf$/i.test(normalizeText(objectName));

const getPendingUploadToken = (asset) =>
  normalizeText(
    asset?.file?.pendingUploadToken || asset?.image?.pendingUploadToken,
  );

const buildPdfSearchState = (revisionPaths, extractionResult) => ({
  status: "ready",
  artifactPath: revisionPaths.extractedManifestPath,
  previewText: normalizePreviewText(extractionResult.previewText),
});

const buildEmptyPdfExtractionFields = () => ({
  previewText: "",
  extractionStatus: "not-applicable",
  extractionVersion: "",
  extractedAt: null,
  extractedContentPath: "",
  extractedManifestPath: "",
  pageCount: 0,
  parseErrorMessage: "",
  parserKind: "",
});

const collectAssetStoragePaths = (asset) =>
  Array.from(
    new Set(
      [
        normalizeText(asset?.file?.storagePath),
        normalizeText(asset?.search?.artifactPath),
        normalizeText(asset?.extractedContentPath),
        normalizeText(asset?.extractedManifestPath),
        normalizeText(asset?.image?.originalPath),
        normalizeText(asset?.image?.displayPath),
        normalizeText(asset?.image?.thumbPath),
      ].filter(Boolean),
    ),
  );

const buildReadyImagePayload = ({
  asset,
  revisionPaths,
  originalInfo,
  rendered,
  searchState,
}) => ({
  schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
  mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
  status: "ready",
  currentRevision: revisionPaths.revision,
  searchText: mergeSearchText(asset.searchText, searchState.previewText),
  file: {
    storagePath: revisionPaths.originalPath,
    originalName: normalizeText(
      asset.file?.originalName || asset.image?.originalName,
    ),
    mimeType: originalInfo.mimeType,
    byteSize: originalInfo.byteSize,
    width: rendered.originalWidth,
    height: rendered.originalHeight,
    revision: revisionPaths.revision,
    originalAvailable: true,
    legacyPreviewOnly: false,
    pendingUploadToken: "",
    pendingUploadPath: "",
  },
  search: {
    status: normalizeText(searchState.status) || "metadata-only",
    artifactPath: normalizeText(searchState.artifactPath),
    previewText: normalizePreviewText(searchState.previewText),
    updatedAt: FieldValue.serverTimestamp(),
  },
  processingStatus: "ready",
  processingError: "",
  processedAt: FieldValue.serverTimestamp(),
  image: {
    storagePath: revisionPaths.basePath,
    originalPath: revisionPaths.originalPath,
    thumbPath: revisionPaths.thumbPath,
    displayPath: revisionPaths.displayPath,
    mime: "image/webp",
    originalMime: originalInfo.mimeType,
    width: Number(rendered.displayResult.info.width || 0),
    height: Number(rendered.displayResult.info.height || 0),
    byteSize: Number(
      rendered.displayResult.info.size || rendered.displayResult.data.length,
    ),
    originalWidth: rendered.originalWidth,
    originalHeight: rendered.originalHeight,
    originalByteSize: originalInfo.byteSize,
    thumbWidth: Number(rendered.thumbResult.info.width || 0),
    thumbHeight: Number(rendered.thumbResult.info.height || 0),
    thumbByteSize: Number(
      rendered.thumbResult.info.size || rendered.thumbResult.data.length,
    ),
    displayWidth: Number(rendered.displayResult.info.width || 0),
    displayHeight: Number(rendered.displayResult.info.height || 0),
    displayByteSize: Number(
      rendered.displayResult.info.size || rendered.displayResult.data.length,
    ),
    revision: revisionPaths.revision,
    originalName: normalizeText(
      asset.file?.originalName || asset.image?.originalName,
    ),
    pendingUploadToken: "",
    pendingUploadPath: "",
  },
  ...buildEmptyPdfExtractionFields(),
  updatedAt: FieldValue.serverTimestamp(),
});

const buildFailedImagePayload = ({
  asset,
  revisionPaths,
  originalInfo,
  rendered,
  error,
}) => {
  const existingImage = asset.image || {};
  const hasOriginal = Boolean(revisionPaths && originalInfo);

  return {
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
    status: "failed",
    currentRevision: hasOriginal
      ? revisionPaths.revision
      : normalizeText(asset.currentRevision),
    searchText: normalizeText(asset.searchText),
    file: {
      ...(hasOriginal
        ? {
            storagePath: revisionPaths.originalPath,
            originalName: normalizeText(
              asset.file?.originalName || asset.image?.originalName,
            ),
            mimeType: originalInfo.mimeType,
            byteSize: originalInfo.byteSize,
            width:
              rendered?.originalWidth ||
              Number(existingImage.originalWidth || 0),
            height:
              rendered?.originalHeight ||
              Number(existingImage.originalHeight || 0),
            revision: revisionPaths.revision,
            originalAvailable: true,
            legacyPreviewOnly: false,
          }
        : asset.file || {}),
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
    search: {
      status: "failed",
      artifactPath: normalizeText(asset.search?.artifactPath),
      previewText: normalizePreviewText(asset.search?.previewText),
      updatedAt: FieldValue.serverTimestamp(),
    },
    processingStatus: "failed",
    processingError: normalizeFailureMessage(error),
    processedAt: FieldValue.serverTimestamp(),
    image: {
      storagePath: hasOriginal
        ? revisionPaths.basePath
        : normalizeText(existingImage.storagePath),
      originalPath: hasOriginal
        ? revisionPaths.originalPath
        : normalizeText(existingImage.originalPath),
      thumbPath: normalizeText(existingImage.thumbPath),
      displayPath: normalizeText(existingImage.displayPath),
      mime: normalizeText(existingImage.mime),
      originalMime: hasOriginal
        ? originalInfo.mimeType
        : normalizeText(existingImage.originalMime),
      width: Number(existingImage.width || 0),
      height: Number(existingImage.height || 0),
      byteSize: Number(existingImage.byteSize || 0),
      originalWidth: hasOriginal
        ? rendered?.originalWidth || 0
        : Number(existingImage.originalWidth || 0),
      originalHeight: hasOriginal
        ? rendered?.originalHeight || 0
        : Number(existingImage.originalHeight || 0),
      originalByteSize: hasOriginal
        ? originalInfo.byteSize
        : Number(existingImage.originalByteSize || 0),
      thumbWidth: Number(existingImage.thumbWidth || 0),
      thumbHeight: Number(existingImage.thumbHeight || 0),
      thumbByteSize: Number(existingImage.thumbByteSize || 0),
      displayWidth: Number(existingImage.displayWidth || 0),
      displayHeight: Number(existingImage.displayHeight || 0),
      displayByteSize: Number(existingImage.displayByteSize || 0),
      revision: hasOriginal
        ? revisionPaths.revision
        : normalizeText(existingImage.revision),
      originalName: normalizeText(
        asset.file?.originalName || asset.image?.originalName,
      ),
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
    ...buildEmptyPdfExtractionFields(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const buildReadyPdfPayload = ({
  asset,
  revisionPaths,
  originalInfo,
  extractionResult,
}) => {
  const searchState = buildPdfSearchState(revisionPaths, extractionResult);
  const previewText = normalizePreviewText(searchState.previewText);

  return {
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: SOURCE_ARCHIVE_PDF_MEDIA_KIND,
    status: "ready",
    currentRevision: revisionPaths.revision,
    searchText: mergeSearchText(asset.searchText, previewText),
    file: {
      storagePath: revisionPaths.originalPath,
      originalName: normalizeText(
        asset.file?.originalName || asset.image?.originalName,
      ),
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
    search: {
      status: searchState.status,
      artifactPath: searchState.artifactPath,
      previewText,
      updatedAt: FieldValue.serverTimestamp(),
    },
    previewText,
    extractionStatus: "ready",
    extractionVersion: normalizeText(
      extractionResult.extractionVersion ||
        SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
    ),
    extractedAt: FieldValue.serverTimestamp(),
    extractedContentPath: revisionPaths.extractedContentPath,
    extractedManifestPath: revisionPaths.extractedManifestPath,
    pageCount: Number(extractionResult.pageCount || 0),
    parseErrorMessage: "",
    parserKind: normalizeText(extractionResult.parserKind),
    processingStatus: "ready",
    processingError: "",
    processedAt: FieldValue.serverTimestamp(),
    image: {
      storagePath: "",
      originalPath: "",
      thumbPath: "",
      displayPath: "",
      mime: "",
      originalMime: originalInfo.mimeType,
      width: 0,
      height: 0,
      byteSize: 0,
      originalWidth: 0,
      originalHeight: 0,
      originalByteSize: originalInfo.byteSize,
      thumbWidth: 0,
      thumbHeight: 0,
      thumbByteSize: 0,
      displayWidth: 0,
      displayHeight: 0,
      displayByteSize: 0,
      revision: "",
      originalName: normalizeText(
        asset.file?.originalName || asset.image?.originalName,
      ),
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const buildFailedPdfPayload = ({
  asset,
  revisionPaths,
  originalInfo,
  error,
}) => {
  const hasOriginal = Boolean(revisionPaths && originalInfo);
  const previousPreviewText = normalizePreviewText(
    asset.previewText || asset.search?.previewText,
  );

  return {
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: SOURCE_ARCHIVE_PDF_MEDIA_KIND,
    status: "failed",
    currentRevision: hasOriginal
      ? revisionPaths.revision
      : normalizeText(asset.currentRevision),
    searchText: normalizeText(asset.searchText),
    file: {
      ...(hasOriginal
        ? {
            storagePath: revisionPaths.originalPath,
            originalName: normalizeText(
              asset.file?.originalName || asset.image?.originalName,
            ),
            mimeType: originalInfo.mimeType,
            byteSize: originalInfo.byteSize,
            width: 0,
            height: 0,
            revision: revisionPaths.revision,
            originalAvailable: true,
            legacyPreviewOnly: false,
          }
        : asset.file || {}),
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
    search: {
      status: "failed",
      artifactPath: hasOriginal
        ? ""
        : normalizeText(asset.search?.artifactPath),
      previewText: previousPreviewText,
      updatedAt: FieldValue.serverTimestamp(),
    },
    previewText: previousPreviewText,
    extractionStatus: "failed",
    extractionVersion: normalizeText(
      asset.extractionVersion || SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
    ),
    extractedAt: hasOriginal ? null : asset.extractedAt || null,
    extractedContentPath: hasOriginal
      ? ""
      : normalizeText(asset.extractedContentPath),
    extractedManifestPath: hasOriginal
      ? ""
      : normalizeText(asset.extractedManifestPath),
    pageCount: hasOriginal ? 0 : Number(asset.pageCount || 0),
    parseErrorMessage: normalizeFailureMessage(error),
    parserKind: normalizeText(asset.parserKind),
    processingStatus: "failed",
    processingError: normalizeFailureMessage(error),
    processedAt: FieldValue.serverTimestamp(),
    image: {
      storagePath: "",
      originalPath: "",
      thumbPath: "",
      displayPath: "",
      mime: "",
      originalMime: hasOriginal
        ? originalInfo.mimeType
        : normalizeText(asset.image?.originalMime),
      width: 0,
      height: 0,
      byteSize: 0,
      originalWidth: 0,
      originalHeight: 0,
      originalByteSize: hasOriginal
        ? originalInfo.byteSize
        : Number(asset.image?.originalByteSize || 0),
      thumbWidth: 0,
      thumbHeight: 0,
      thumbByteSize: 0,
      displayWidth: 0,
      displayHeight: 0,
      displayByteSize: 0,
      revision: "",
      originalName: normalizeText(
        asset.file?.originalName || asset.image?.originalName,
      ),
      pendingUploadToken: "",
      pendingUploadPath: "",
    },
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const cleanupPreviousRevision = async ({
  bucket,
  assetId,
  previousAsset,
  nextRevision,
  nextPaths,
}) => {
  const previousRevision = normalizeText(
    previousAsset?.currentRevision ||
      previousAsset?.file?.revision ||
      previousAsset?.image?.revision,
  );

  if (previousRevision && previousRevision !== nextRevision) {
    await deleteStoragePrefix(
      bucket,
      buildAssetRevisionPrefix(assetId, previousRevision),
    );
  }

  await deleteStoragePaths(
    bucket,
    collectAssetStoragePaths(previousAsset).filter(
      (storagePath) => !nextPaths.has(storagePath),
    ),
  );
};

exports.processSourceArchiveIncomingUpload = onObjectFinalized(
  {
    region: REGION,
    bucket: STORAGE_BUCKET,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    const objectName = normalizeText(event.data.name);
    const parsed = parseIncomingPath(objectName);
    if (!parsed) return;

    const bucket = storage.bucket(event.data.bucket);
    const incomingFile = bucket.file(objectName);
    const assetRef = db.doc(buildAssetDocPath(parsed.assetId));

    let revisionPaths = null;
    let originalInfo = null;
    let rendered = null;
    let generatedPaths = [];
    let asset = null;
    let mediaKind = SOURCE_ARCHIVE_MEDIA_KIND;

    try {
      const assetSnap = await assetRef.get();
      if (!assetSnap.exists) {
        return;
      }

      asset = assetSnap.data() || {};
      const pendingUploadToken = getPendingUploadToken(asset);
      if (!pendingUploadToken || pendingUploadToken !== parsed.uploadToken) {
        return;
      }

      const contentType = normalizeText(
        event.data.contentType ||
          asset.file?.mimeType ||
          asset.image?.originalMime ||
          asset.image?.mime ||
          "image/jpeg",
      );
      mediaKind = isPdfUpload(asset, contentType, objectName)
        ? SOURCE_ARCHIVE_PDF_MEDIA_KIND
        : SOURCE_ARCHIVE_MEDIA_KIND;

      await assetRef.set(
        {
          status: "processing",
          processingStatus: "processing",
          processingError: "",
          extractionStatus:
            mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND ? "processing" : "not-applicable",
          parseErrorMessage: "",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const [inputBuffer] = await incomingFile.download();
      const revision = `v-${Date.now()}`;

      revisionPaths =
        mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
          ? buildPdfRevisionPaths({
              assetId: parsed.assetId,
              revision,
            })
          : buildRevisionPaths({
              assetId: parsed.assetId,
              revision,
              contentType,
              objectName,
            });

      originalInfo = await saveOriginalSourceArchiveFile({
        bucket,
        originalPath: revisionPaths.originalPath,
        inputBuffer,
        contentType,
      });
      generatedPaths.push(revisionPaths.originalPath);

      if (mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND) {
        const extractionResult = await saveSourceArchivePdfArtifacts({
          bucket,
          inputBuffer,
          originalName: normalizeText(
            asset.file?.originalName ||
              asset.image?.originalName ||
              "document.pdf",
          ),
          revisionPaths,
        });
        generatedPaths.push(...extractionResult.generatedPaths);

        const latestSnap = await assetRef.get();
        if (!latestSnap.exists) {
          await deleteStoragePaths(bucket, generatedPaths);
          return;
        }

        const latestAsset = latestSnap.data() || {};
        if (getPendingUploadToken(latestAsset) !== parsed.uploadToken) {
          await deleteStoragePaths(bucket, generatedPaths);
          return;
        }

        await assetRef.set(
          buildReadyPdfPayload({
            asset: latestAsset,
            revisionPaths,
            originalInfo,
            extractionResult,
          }),
          { merge: true },
        );

        await cleanupPreviousRevision({
          bucket,
          assetId: parsed.assetId,
          previousAsset: latestAsset,
          nextRevision: revisionPaths.revision,
          nextPaths: new Set(generatedPaths),
        });
      } else {
        rendered = await renderSourceArchiveVariants({ inputBuffer });

        await Promise.all([
          bucket
            .file(revisionPaths.displayPath)
            .save(rendered.displayResult.data, {
              resumable: false,
              metadata: {
                contentType: "image/webp",
                cacheControl: "public,max-age=31536000,immutable",
              },
            }),
          bucket.file(revisionPaths.thumbPath).save(rendered.thumbResult.data, {
            resumable: false,
            metadata: {
              contentType: "image/webp",
              cacheControl: "public,max-age=31536000,immutable",
            },
          }),
        ]);
        generatedPaths.push(revisionPaths.displayPath, revisionPaths.thumbPath);

        const searchState = await buildSourceArchiveSearchState({
          bucket,
          assetId: parsed.assetId,
          revision,
          basePath: revisionPaths.basePath,
          currentAsset: asset,
        });
        if (normalizeText(searchState.artifactPath)) {
          generatedPaths.push(normalizeText(searchState.artifactPath));
        }

        const latestSnap = await assetRef.get();
        if (!latestSnap.exists) {
          await deleteStoragePaths(bucket, generatedPaths);
          return;
        }

        const latestAsset = latestSnap.data() || {};
        if (getPendingUploadToken(latestAsset) !== parsed.uploadToken) {
          await deleteStoragePaths(bucket, generatedPaths);
          return;
        }

        await assetRef.set(
          buildReadyImagePayload({
            asset: latestAsset,
            revisionPaths,
            originalInfo,
            rendered,
            searchState,
          }),
          { merge: true },
        );

        await cleanupPreviousRevision({
          bucket,
          assetId: parsed.assetId,
          previousAsset: latestAsset,
          nextRevision: revisionPaths.revision,
          nextPaths: new Set(generatedPaths),
        });
      }
    } catch (error) {
      console.error(
        mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
          ? "Failed to process source archive pdf:"
          : "Failed to process source archive image:",
        error,
      );

      if (
        mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND &&
        revisionPaths?.originalPath &&
        generatedPaths.length > 1
      ) {
        await deleteStoragePaths(
          bucket,
          generatedPaths.filter(
            (storagePath) => storagePath !== revisionPaths.originalPath,
          ),
        ).catch(() => undefined);
      }

      await assetRef
        .set(
          mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
            ? buildFailedPdfPayload({
                asset: asset || {},
                revisionPaths,
                originalInfo,
                error,
              })
            : buildFailedImagePayload({
                asset: asset || {},
                revisionPaths,
                originalInfo,
                rendered,
                error,
              }),
          { merge: true },
        )
        .catch(() => undefined);
    } finally {
      await deleteFileIfExists(incomingFile);
    }
  },
);

exports.deleteSourceArchiveAsset = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    await assertSourceArchiveManager(request);

    const assetId = normalizeText(request.data?.assetId);
    if (!assetId || !/^[a-zA-Z0-9_-]{1,128}$/.test(assetId)) {
      throw new HttpsError("invalid-argument", "assetId is required.");
    }

    const bucket = storage.bucket();
    const docRef = db.doc(buildAssetDocPath(assetId));
    const [files] = await bucket.getFiles({
      prefix: buildAssetPrefix(assetId),
    });

    await Promise.all(files.map((file) => deleteFileIfExists(file)));
    await docRef.delete().catch(() => undefined);

    return {
      assetId,
      deleted: true,
      fileCount: files.length,
    };
  },
);
