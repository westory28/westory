const { randomUUID } = require('node:crypto');
const { getStorage } = require('firebase-admin/storage');
const { HttpsError } = require('firebase-functions/v2/https');
const sharp = require('sharp');
const { ADMIN_EMAIL, onCallWithStudentMaintenance } = require('./studentMaintenance');
const { assertActiveApplicationSession } = require('./sessionAuthority');
const { assertRasterImageBytes } = require('./rasterImageSafety');

const BUCKET_NAME = 'history-quiz-yongsin.firebasestorage.app';
const MAX_IMAGE_BYTES = 720 * 1024;
const MAX_IMAGE_PIXELS = 4096 * 4096;
const POST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const IMAGE_PATH = /^developer_log_images\/[A-Za-z0-9_-]{1,80}\/card-(?:\d{1,20}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(?:webp|png|jpg)$/;
const invalid = message => new HttpsError('invalid-argument', message);
const payload = (data, keys) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('이미지 요청 정보를 확인해 주세요.');
  const { _session, ...value } = data;
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw invalid('이미지 요청 항목이 올바르지 않습니다.');
  return value;
};
const validateImage = async (imageBase64, contentType) => {
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(contentType)
    || typeof imageBase64 !== 'string' || !imageBase64.length
    || imageBase64.length > Math.ceil((MAX_IMAGE_BYTES - 1) / 3) * 4
    || imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64))
    throw invalid('720KB 미만의 WebP, PNG, JPEG 이미지를 사용해 주세요.');
  const buffer = Buffer.from(imageBase64, 'base64');
  if (!buffer.length || buffer.length >= MAX_IMAGE_BYTES || buffer.toString('base64') !== imageBase64)
    throw invalid('이미지 데이터 또는 용량이 올바르지 않습니다.');
  // Reject SVG and MIME spoofing before invoking a native image decoder.
  const format = assertRasterImageBytes(buffer, contentType);
  try {
    const decoder = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height
      || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages || 1) !== 1)
      throw new Error('Unsupported image');
    await decoder.stats();
    return { buffer, width: metadata.width, height: metadata.height, mimeType: contentType, extension: format === 'jpeg' ? 'jpg' : format };
  } catch (_) { throw invalid('이미지를 읽을 수 없습니다. 4096px 이하의 정지 이미지를 사용해 주세요.'); }
};

const createDeveloperLogImageHandlers = ({ bucket, assertSession = assertActiveApplicationSession, createId = randomUUID } = {}) => {
  if (!bucket || typeof assertSession !== 'function' || typeof createId !== 'function') throw new TypeError('Image handlers require storage and session guard.');
  const assertDeveloper = async request => {
    const identity = await assertSession(request);
    if (!request.auth?.uid || (identity?.uid && identity.uid !== request.auth.uid)) throw new HttpsError('unauthenticated', '다시 로그인해 주세요.');
    // This is the same exact normalized identity predicate as isDeveloperUser.
    if (String(request.auth.token?.email || '').trim().toLowerCase() !== ADMIN_EMAIL)
      throw new HttpsError('permission-denied', '개발자 일지 이미지를 관리할 권한이 없습니다.');
  };
  const upload = async request => {
    await assertDeveloper(request);
    const { postId, imageBase64, contentType } = payload(request.data, ['postId', 'imageBase64', 'contentType']);
    if (typeof postId !== 'string' || !POST_ID.test(postId)) throw invalid('게시글 식별자가 올바르지 않습니다.');
    const image = await validateImage(imageBase64, contentType);
    // The client reserves the post ID first and publishes only after all images
    // succeed. Requiring a Firestore post here would recreate partial posts.
    const storagePath = `developer_log_images/${postId}/card-${createId()}.${image.extension}`;
    const token = createId();
    await bucket.file(storagePath).save(image.buffer, {
      resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: image.mimeType, cacheControl: 'public,max-age=86400',
        metadata: { firebaseStorageDownloadTokens: token } },
    });
    return { imageUrl: `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
      imageStoragePath: storagePath, imageByteSize: image.buffer.length, imageWidth: image.width, imageHeight: image.height, imageMimeType: image.mimeType };
  };
  const remove = async request => {
    await assertDeveloper(request);
    const { storagePath } = payload(request.data, ['storagePath']);
    if (typeof storagePath !== 'string' || storagePath.length > 220 || !IMAGE_PATH.test(storagePath)) throw invalid('개발자 일지 이미지 경로가 올바르지 않습니다.');
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    return { deleted: true };
  };
  return { upload, remove };
};
let defaultHandlers;
const handlers = () => defaultHandlers ||= createDeveloperLogImageHandlers({ bucket: getStorage().bucket(BUCKET_NAME) });
const callableOptions = { region: 'asia-northeast3', memory: '512MiB', timeoutSeconds: 60, concurrency: 4, minInstances: 0, maxInstances: 5 };
module.exports = {
  createDeveloperLogImageHandlers,
  uploadDeveloperLogImageContent: onCallWithStudentMaintenance(callableOptions, request => handlers().upload(request)),
  deleteDeveloperLogImageContent: onCallWithStudentMaintenance(callableOptions, request => handlers().remove(request)),
};
