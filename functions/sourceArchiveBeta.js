const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const sharp = require('sharp');

const db = getFirestore();
const storage = getStorage();

const REGION = 'asia-northeast3';
const ADMIN_EMAIL = 'westoria28@gmail.com';
const SCHOOL_EMAIL_PATTERN = /@yongshin-ms\.ms\.kr$/i;
const SOURCE_ARCHIVE_COLLECTION = 'source_archive';
const SOURCE_ARCHIVE_PREFIX = 'source-archive';
const SOURCE_ARCHIVE_DISPLAY_EDGE = 1920;
const SOURCE_ARCHIVE_THUMB_EDGE = 480;
const SOURCE_ARCHIVE_MAX_PIXELS = 50_000_000;

const normalizeText = (value) => String(value || '').trim();

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
    paths
      .filter(Boolean)
      .map((path) => deleteFileIfExists(bucket.file(path))),
  );
};

const normalizeFailureMessage = (error) => {
  const message = normalizeText(error?.message || 'processing-failed');
  return message ? message.slice(0, 240) : 'processing-failed';
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

    try {
      const assetSnap = await assetRef.get();
      if (!assetSnap.exists) {
        return;
      }

      const asset = assetSnap.data() || {};
      const pendingUploadToken = normalizeText(asset.image?.pendingUploadToken);
      if (!pendingUploadToken || pendingUploadToken !== parsed.uploadToken) {
        return;
      }

      const [inputBuffer] = await incomingFile.download();
      const sourceImage = sharp(inputBuffer, {
        failOn: 'error',
        limitInputPixels: SOURCE_ARCHIVE_MAX_PIXELS,
      }).rotate();
      const metadata = await sourceImage.metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error('invalid-image-metadata');
      }

      const revision = `v-${Date.now()}`;
      const basePath = `${SOURCE_ARCHIVE_PREFIX}/${parsed.assetId}/${revision}`;
      const displayPath = `${basePath}/display.webp`;
      const thumbPath = `${basePath}/thumb.webp`;
      const previousPaths = [
        normalizeText(asset.image?.displayPath),
        normalizeText(asset.image?.thumbPath),
      ];

      const [displayResult, thumbResult] = await Promise.all([
        sourceImage
          .clone()
          .resize({
            width: SOURCE_ARCHIVE_DISPLAY_EDGE,
            height: SOURCE_ARCHIVE_DISPLAY_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 82, effort: 4 })
          .toBuffer({ resolveWithObject: true }),
        sourceImage
          .clone()
          .resize({
            width: SOURCE_ARCHIVE_THUMB_EDGE,
            height: SOURCE_ARCHIVE_THUMB_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 68, effort: 4 })
          .toBuffer({ resolveWithObject: true }),
      ]);

      await Promise.all([
        bucket.file(displayPath).save(displayResult.data, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          },
        }),
        bucket.file(thumbPath).save(thumbResult.data, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'public,max-age=31536000,immutable',
          },
        }),
      ]);

      await assetRef.set(
        {
          processingStatus: 'ready',
          processingError: '',
          image: {
            storagePath: basePath,
            thumbPath,
            displayPath,
            mime: 'image/webp',
            width: Number(displayResult.info.width || 0),
            height: Number(displayResult.info.height || 0),
            byteSize: Number(displayResult.info.size || displayResult.data.length),
            thumbWidth: Number(thumbResult.info.width || 0),
            thumbHeight: Number(thumbResult.info.height || 0),
            thumbByteSize: Number(thumbResult.info.size || thumbResult.data.length),
            displayWidth: Number(displayResult.info.width || 0),
            displayHeight: Number(displayResult.info.height || 0),
            displayByteSize: Number(displayResult.info.size || displayResult.data.length),
            originalName: normalizeText(asset.image?.originalName),
            pendingUploadToken: '',
            pendingUploadPath: '',
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await deleteStoragePaths(
        bucket,
        previousPaths.filter(
          (path) => path && path !== displayPath && path !== thumbPath,
        ),
      );
    } catch (error) {
      console.error('Failed to process source archive image:', error);
      await assetRef
        .set(
          {
            processingStatus: 'failed',
            processingError: normalizeFailureMessage(error),
            image: {
              pendingUploadToken: '',
              pendingUploadPath: '',
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
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
