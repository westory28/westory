const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onObjectFinalized } = require('firebase-functions/v2/storage');

const {
  SOURCE_ARCHIVE_MEDIA_KIND,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  normalizeText,
  buildRevisionPaths,
  saveOriginalSourceArchiveFile,
  renderSourceArchiveVariants,
  buildSourceArchiveSearchState,
} = require('./sourceArchiveProcessor');

const db = getFirestore();
const storage = getStorage();

const REGION = 'asia-northeast3';
const ADMIN_EMAIL = 'westoria28@gmail.com';
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;
const SOURCE_ARCHIVE_COLLECTION = 'source_archive';
const SOURCE_ARCHIVE_PREFIX = 'source-archive';

const getAuthEmail = (request) =>
  String(request.auth?.token?.email || '').trim().toLowerCase();

const assertAllowedWestoryUser = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const email = getAuthEmail(request);
  if (!email || (!SCHOOL_EMAIL_PATTERN.test(email) && email !== ADMIN_EMAIL)) {
    throw new HttpsError(
      'permission-denied',
      'This account cannot use Westory source archive functions.',
    );
  }

  return { uid: request.auth.uid, email };
};

const getUserProfile = async (uid) => {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError('failed-precondition', 'User profile is missing.');
  }
  return userSnap.data() || {};
};

const assertSourceArchiveManager = async (request) => {
  const actor = assertAllowedWestoryUser(request);
  if (actor.email === ADMIN_EMAIL) {
    return actor;
  }

  const profile = await getUserProfile(actor.uid);
  if (normalizeText(profile.role) === 'teacher') {
    return actor;
  }

  throw new HttpsError(
    'permission-denied',
    'Only teacher accounts can modify source archive assets.',
  );
};

const buildAssetDocPath = (assetId) => `${SOURCE_ARCHIVE_COLLECTION}/${assetId}`;
const buildAssetPrefix = (assetId) => `${SOURCE_ARCHIVE_PREFIX}/${assetId}/`;

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
    Array.from(new Set(paths.filter(Boolean)))
      .map((path) => deleteFileIfExists(bucket.file(path))),
  );
};

const normalizeFailureMessage = (error) => {
  const message = normalizeText(error?.message || 'processing-failed');
  return message ? message.slice(0, 240) : 'processing-failed';
};

const collectAssetStoragePaths = (asset) =>
  Array.from(
    new Set([
      normalizeText(asset?.file?.storagePath),
      normalizeText(asset?.search?.artifactPath),
      normalizeText(asset?.image?.originalPath),
      normalizeText(asset?.image?.displayPath),
      normalizeText(asset?.image?.thumbPath),
    ].filter(Boolean)),
  );

const buildReadyPayload = ({
  asset,
  revisionPaths,
  originalInfo,
  rendered,
  searchState,
}) => ({
  schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
  mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
  status: 'ready',
  currentRevision: revisionPaths.revision,
  file: {
    storagePath: revisionPaths.originalPath,
    originalName: normalizeText(asset.file?.originalName || asset.image?.originalName),
    mimeType: originalInfo.mimeType,
    byteSize: originalInfo.byteSize,
    width: rendered.originalWidth,
    height: rendered.originalHeight,
    revision: revisionPaths.revision,
    originalAvailable: true,
    legacyPreviewOnly: false,
  },
  search: {
    status: normalizeText(searchState.status) || 'metadata-only',
    artifactPath: normalizeText(searchState.artifactPath),
    previewText: normalizeText(searchState.previewText),
    updatedAt: FieldValue.serverTimestamp(),
  },
  processingStatus: 'ready',
  processingError: '',
  processedAt: FieldValue.serverTimestamp(),
  image: {
    storagePath: revisionPaths.basePath,
    originalPath: revisionPaths.originalPath,
    thumbPath: revisionPaths.thumbPath,
    displayPath: revisionPaths.displayPath,
    mime: 'image/webp',
    originalMime: originalInfo.mimeType,
    width: Number(rendered.displayResult.info.width || 0),
    height: Number(rendered.displayResult.info.height || 0),
    byteSize: Number(rendered.displayResult.info.size || rendered.displayResult.data.length),
    originalWidth: rendered.originalWidth,
    originalHeight: rendered.originalHeight,
    originalByteSize: originalInfo.byteSize,
    thumbWidth: Number(rendered.thumbResult.info.width || 0),
    thumbHeight: Number(rendered.thumbResult.info.height || 0),
    thumbByteSize: Number(rendered.thumbResult.info.size || rendered.thumbResult.data.length),
    displayWidth: Number(rendered.displayResult.info.width || 0),
    displayHeight: Number(rendered.displayResult.info.height || 0),
    displayByteSize: Number(rendered.displayResult.info.size || rendered.displayResult.data.length),
    revision: revisionPaths.revision,
    originalName: normalizeText(asset.file?.originalName || asset.image?.originalName),
    pendingUploadToken: '',
    pendingUploadPath: '',
  },
  updatedAt: FieldValue.serverTimestamp(),
});

const buildFailurePayload = ({
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
    status: 'failed',
    currentRevision: hasOriginal
      ? revisionPaths.revision
      : normalizeText(asset.currentRevision),
    file: hasOriginal
      ? {
          storagePath: revisionPaths.originalPath,
          originalName: normalizeText(asset.file?.originalName || asset.image?.originalName),
          mimeType: originalInfo.mimeType,
          byteSize: originalInfo.byteSize,
          width: rendered?.originalWidth || Number(existingImage.originalWidth || 0),
          height: rendered?.originalHeight || Number(existingImage.originalHeight || 0),
          revision: revisionPaths.revision,
          originalAvailable: true,
          legacyPreviewOnly: false,
        }
      : asset.file,
    search: {
      status: 'failed',
      artifactPath: normalizeText(asset.search?.artifactPath),
      previewText: normalizeText(asset.search?.previewText),
      updatedAt: FieldValue.serverTimestamp(),
    },
    processingStatus: 'failed',
    processingError: normalizeFailureMessage(error),
    processedAt: FieldValue.serverTimestamp(),
    image: {
      storagePath: hasOriginal ? revisionPaths.basePath : normalizeText(existingImage.storagePath),
      originalPath: hasOriginal ? revisionPaths.originalPath : normalizeText(existingImage.originalPath),
      thumbPath: normalizeText(existingImage.thumbPath),
      displayPath: normalizeText(existingImage.displayPath),
      mime: normalizeText(existingImage.mime),
      originalMime: hasOriginal ? originalInfo.mimeType : normalizeText(existingImage.originalMime),
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
      originalName: normalizeText(asset.file?.originalName || asset.image?.originalName),
      pendingUploadToken: '',
      pendingUploadPath: '',
    },
    updatedAt: FieldValue.serverTimestamp(),
  };
};

exports.processSourceArchiveIncomingUpload = onObjectFinalized(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: '512MiB',
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

    try {
      const assetSnap = await assetRef.get();
      if (!assetSnap.exists) {
        return;
      }

      asset = assetSnap.data() || {};
      const pendingUploadToken = normalizeText(asset.image?.pendingUploadToken);
      if (!pendingUploadToken || pendingUploadToken !== parsed.uploadToken) {
        return;
      }

      await assetRef.set(
        {
          status: 'processing',
          processingStatus: 'processing',
          processingError: '',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const [inputBuffer] = await incomingFile.download();
      const contentType = normalizeText(
        event.data.contentType
          || asset.file?.mimeType
          || asset.image?.originalMime
          || asset.image?.mime
          || 'image/jpeg',
      );
      const revision = `v-${Date.now()}`;
      revisionPaths = buildRevisionPaths({
        assetId: parsed.assetId,
        revision,
        contentType,
        objectName,
      });
      generatedPaths = [
        revisionPaths.originalPath,
        revisionPaths.displayPath,
        revisionPaths.thumbPath,
      ];

      originalInfo = await saveOriginalSourceArchiveFile({
        bucket,
        originalPath: revisionPaths.originalPath,
        inputBuffer,
        contentType,
      });
      rendered = await renderSourceArchiveVariants({ inputBuffer });

      await Promise.all([
        bucket.file(revisionPaths.displayPath).save(rendered.displayResult.data, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          },
        }),
        bucket.file(revisionPaths.thumbPath).save(rendered.thumbResult.data, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          },
        }),
      ]);

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
      const latestToken = normalizeText(latestAsset.image?.pendingUploadToken);
      if (latestToken !== parsed.uploadToken) {
        await deleteStoragePaths(bucket, generatedPaths);
        return;
      }

      await assetRef.set(
        buildReadyPayload({
          asset: latestAsset,
          revisionPaths,
          originalInfo,
          rendered,
          searchState,
        }),
        { merge: true },
      );

      const newPaths = new Set(generatedPaths);
      await deleteStoragePaths(
        bucket,
        collectAssetStoragePaths(latestAsset).filter((path) => !newPaths.has(path)),
      );
    } catch (error) {
      console.error('Failed to process source archive image:', error);
      await assetRef
        .set(
          buildFailurePayload({
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
    memory: '256MiB',
  },
  async (request) => {
    await assertSourceArchiveManager(request);

    const assetId = normalizeText(request.data?.assetId);
    if (!assetId || !/^[a-zA-Z0-9_-]{1,128}$/.test(assetId)) {
      throw new HttpsError('invalid-argument', 'assetId is required.');
    }

    const bucket = storage.bucket();
    const docRef = db.doc(buildAssetDocPath(assetId));
    const [files] = await bucket.getFiles({ prefix: buildAssetPrefix(assetId) });

    await Promise.all(files.map((file) => deleteFileIfExists(file)));
    await docRef.delete().catch(() => undefined);

    return {
      assetId,
      deleted: true,
      fileCount: files.length,
    };
  },
);
