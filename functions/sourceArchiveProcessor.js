const sharp = require('sharp');

const SOURCE_ARCHIVE_DISPLAY_EDGE = 1920;
const SOURCE_ARCHIVE_THUMB_EDGE = 480;
const SOURCE_ARCHIVE_MAX_PIXELS = 50_000_000;
const SOURCE_ARCHIVE_SCHEMA_VERSION = 2;
const SOURCE_ARCHIVE_MEDIA_KIND = 'image';
const SOURCE_ARCHIVE_PROCESSOR_VERSION = 'westory-source-archive-image/v2';

const normalizeText = (value) => String(value || '').trim();

const inferExtension = (contentType, objectName) => {
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/avif') return 'avif';
  const fileName = normalizeText(objectName).split('/').pop() || '';
  const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  return extension || 'jpg';
};

const buildRevisionPaths = ({ assetId, revision, contentType, objectName }) => {
  const basePath = `source-archive/${assetId}/${revision}`;
  const extension = inferExtension(contentType, objectName);
  return {
    revision,
    basePath,
    originalPath: `${basePath}/original.${extension}`,
    displayPath: `${basePath}/display.webp`,
    thumbPath: `${basePath}/thumb.webp`,
  };
};

const saveOriginalSourceArchiveFile = async ({
  bucket,
  originalPath,
  inputBuffer,
  contentType,
}) => {
  await bucket.file(originalPath).save(inputBuffer, {
    resumable: false,
    metadata: {
      contentType: contentType || 'image/jpeg',
      cacheControl: 'private,no-store,max-age=0',
    },
  });

  return {
    mimeType: contentType || 'image/jpeg',
    byteSize: inputBuffer.length,
  };
};

const renderSourceArchiveVariants = async ({ inputBuffer }) => {
  const sourceImage = sharp(inputBuffer, {
    failOn: 'error',
    limitInputPixels: SOURCE_ARCHIVE_MAX_PIXELS,
  }).rotate();
  const metadata = await sourceImage.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('invalid-image-metadata');
  }

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

  return {
    originalWidth: Number(metadata.width || 0),
    originalHeight: Number(metadata.height || 0),
    displayResult,
    thumbResult,
  };
};

const loadOptionalSearchAdapter = () => {
  try {
    return require('./sourceArchiveSearchAdapter');
  } catch {
    return null;
  }
};

const buildSourceArchiveSearchState = async ({
  bucket,
  assetId,
  revision,
  basePath,
  currentAsset,
}) => {
  const adapter = loadOptionalSearchAdapter();
  if (adapter && typeof adapter.buildSearchArtifacts === 'function') {
    return adapter.buildSearchArtifacts({
      bucket,
      assetId,
      revision,
      basePath,
      currentAsset,
    });
  }

  return {
    status: 'metadata-only',
    artifactPath: '',
    previewText: '',
    processorVersion: SOURCE_ARCHIVE_PROCESSOR_VERSION,
  };
};

module.exports = {
  SOURCE_ARCHIVE_MEDIA_KIND,
  SOURCE_ARCHIVE_PROCESSOR_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  normalizeText,
  buildRevisionPaths,
  saveOriginalSourceArchiveFile,
  renderSourceArchiveVariants,
  buildSourceArchiveSearchState,
};
