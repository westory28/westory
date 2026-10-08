const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { randomUUID } = require("node:crypto");
const { getStorage } = require("firebase-admin/storage");
const { storageBucket } = require("firebase-functions/params");
const { HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const {
  onCallWithStudentMaintenance: onCall,
} = require("./studentMaintenance");

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
const { assertActiveApplicationSession } = require("./sessionAuthority");
Object.assign(exports, require("./lessonPdfBeta"));

const db = getFirestore();
const storage = getStorage();

const REGION = "asia-northeast3";
const STORAGE_BUCKET = storageBucket;
const ADMIN_EMAIL = "westoria28@gmail.com";
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;
const SOURCE_ARCHIVE_COLLECTION = "source_archive";
const SOURCE_ARCHIVE_PREFIX = "source-archive";

const getAuthEmail = (request) =>
  String(request.auth?.token?.email || "")
    .trim()
    .toLowerCase();

const assertAllowedWestoryUser = async (request, options = {}) => {
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

  await assertActiveApplicationSession(request, options);

  return { uid: request.auth.uid, email };
};

const getUserProfile = async (uid) => {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile is missing.");
  }
  return userSnap.data() || {};
};

const assertSourceArchiveManager = async (request, options = {}) => {
  const actor = await assertAllowedWestoryUser(request, options);
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
  await file.delete({ ignoreNotFound: true });
};

const deleteStoragePaths = async (bucket, paths) => {
  await Promise.all(
    Array.from(new Set(paths.filter(Boolean))).map((storagePath) =>
      deleteFileIfExists(bucket.file(storagePath)),
    ),
  );
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
    const leaseId = randomUUID();
    const ticketRef = db.doc(`source_archive_uploads/${parsed.uploadToken}`);
    let deleteIncoming = false;
    const ownsLease = (latest) =>
      Boolean(
        latest &&
        !latest.deletedAt &&
        getPendingUploadToken(latest) === parsed.uploadToken &&
        latest.processingLeaseId === leaseId &&
        normalizeText(latest.currentRevision) ===
          normalizeText(asset?.currentRevision),
      );
    const cleanupAttemptArtifacts = async (keepOriginal = false) => {
      if (!revisionPaths?.basePath) return;
      // This prefix includes the invocation's random lease ID, never an older
      // shared revision. Listing also finds partial PDF writes before an error.
      const [files] = await bucket.getFiles({
        prefix: `${revisionPaths.basePath}/`,
      });
      const results = await Promise.allSettled(
        files
          .filter(
            (file) => !keepOriginal || file.name !== revisionPaths.originalPath,
          )
          .map((file) => file.delete({ ignoreNotFound: true })),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    };
    const discardGenerated = async () => {
      await cleanupAttemptArtifacts();
      const snapshot = await assetRef.get();
      const latest = snapshot.data();
      // A replacement lease for this same incoming object still owns the file.
      deleteIncoming =
        !snapshot.exists ||
        Boolean(latest.deletedAt) ||
        getPendingUploadToken(latest) !== parsed.uploadToken;
    };
    const commitResult = async (build, ticketStatus) =>
      db.runTransaction(async (transaction) => {
        const [latestSnap, ticketSnap] = await transaction.getAll(
          assetRef,
          ticketRef,
        );
        const latest = latestSnap.data();
        if (!latestSnap.exists || !ownsLease(latest)) return false;
        transaction.set(
          assetRef,
          {
            ...build(latest),
            processingLeaseId: "",
            processingLeaseExpiresAtMs: 0,
          },
          { merge: true },
        );
        if (ticketSnap.exists)
          transaction.set(
            ticketRef,
            {
              status: ticketStatus,
              processedAt: FieldValue.serverTimestamp(),
              ...(ticketStatus === "COMPLETED"
                ? { expiresAtMs: FieldValue.delete() }
                : {}),
            },
            { merge: true },
          );
        return true;
      });

    try {
      const claim = await db.runTransaction(async (transaction) => {
        const [snapshot, ticketSnap] = await transaction.getAll(
          assetRef,
          ticketRef,
        );
        const current = snapshot.data();
        if (
          !snapshot.exists ||
          current.deletedAt ||
          getPendingUploadToken(current) !== parsed.uploadToken
        )
          return { stale: true };
        if (
          current.processingLeaseId &&
          current.processingLeaseExpiresAtMs > Date.now()
        )
          return { busy: true };
        const contentType = normalizeText(
          event.data.contentType ||
            current.file?.mimeType ||
            current.image?.originalMime ||
            current.image?.mime ||
            "image/jpeg",
        );
        const kind = isPdfUpload(current, contentType, objectName)
          ? SOURCE_ARCHIVE_PDF_MEDIA_KIND
          : SOURCE_ARCHIVE_MEDIA_KIND;
        transaction.set(
          assetRef,
          {
            status: "processing",
            processingStatus: "processing",
            processingLeaseId: leaseId,
            processingLeaseExpiresAtMs: Date.now() + 150000,
            processingError: "",
            extractionStatus:
              kind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
                ? "processing"
                : "not-applicable",
            parseErrorMessage: "",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        if (ticketSnap.exists)
          transaction.set(ticketRef, { status: "PROCESSING" }, { merge: true });
        return { asset: current, contentType, kind };
      });
      if (claim.stale) {
        deleteIncoming = true;
        return;
      }
      if (claim.busy) return;
      asset = claim.asset;
      mediaKind = claim.kind;
      const contentType = claim.contentType;

      const [inputBuffer] = await incomingFile.download();
      const revision = `v-${Date.now()}-${leaseId}`;

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

      generatedPaths.push(revisionPaths.originalPath);
      originalInfo = await saveOriginalSourceArchiveFile({
        bucket,
        originalPath: revisionPaths.originalPath,
        inputBuffer,
        contentType,
      });

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

        const committed = await commitResult(
          (latest) =>
            buildReadyPdfPayload({
              asset: latest,
              revisionPaths,
              originalInfo,
              extractionResult,
            }),
          "COMPLETED",
        );
        if (!committed) {
          await discardGenerated();
          return;
        }
        deleteIncoming = true;
      } else {
        rendered = await renderSourceArchiveVariants({ inputBuffer });

        generatedPaths.push(revisionPaths.displayPath, revisionPaths.thumbPath);
        const renderWrites = await Promise.allSettled([
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
        const failedWrite = renderWrites.find(
          (write) => write.status === "rejected",
        );
        if (failedWrite) throw failedWrite.reason;

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

        const committed = await commitResult(
          (latest) =>
            buildReadyImagePayload({
              asset: latest,
              revisionPaths,
              originalInfo,
              rendered,
              searchState,
            }),
          "COMPLETED",
        );
        if (!committed) {
          await discardGenerated();
          return;
        }
        deleteIncoming = true;
      }
    } catch (error) {
      console.error(
        mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
          ? "Failed to process source archive pdf:"
          : "Failed to process source archive image:",
        error,
      );

      await cleanupAttemptArtifacts(Boolean(originalInfo));

      const committed = await commitResult(
        (latest) =>
          mediaKind === SOURCE_ARCHIVE_PDF_MEDIA_KIND
            ? buildFailedPdfPayload({
                asset: latest,
                revisionPaths,
                originalInfo,
                error,
              })
            : buildFailedImagePayload({
                asset: latest,
                revisionPaths,
                originalInfo,
                rendered,
                error,
              }),
        "FAILED",
      ).catch(() => false);
      deleteIncoming = committed;
      if (!committed) await discardGenerated();
    } finally {
      if (deleteIncoming) await deleteFileIfExists(incomingFile);
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
    await assertSourceArchiveManager(request, {
      recentAuth: true,
      highRisk: true,
    });

    throw new HttpsError(
      "failed-precondition",
      "최신 사료 창고 화면에서 삭제해 주세요.",
      { reason: "SOURCE_ARCHIVE_COMMAND_REQUIRED" },
    );
  },
);
