const sharp = require("sharp");

const SOURCE_ARCHIVE_DISPLAY_EDGE = 1920;
const SOURCE_ARCHIVE_THUMB_EDGE = 480;
const SOURCE_ARCHIVE_MAX_PIXELS = 50_000_000;
const SOURCE_ARCHIVE_SCHEMA_VERSION = 3;
const SOURCE_ARCHIVE_MEDIA_KIND = "image";
const SOURCE_ARCHIVE_PDF_MEDIA_KIND = "pdf";
const SOURCE_ARCHIVE_PROCESSOR_VERSION = "westory-source-archive-image/v2";
const SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION = "westory-source-archive-pdf/v1";
const SOURCE_ARCHIVE_PDF_PREVIEW_LIMIT = 1200;
const SOURCE_ARCHIVE_SEARCH_TEXT_LIMIT = 5000;

const normalizeText = (value) => String(value || "").trim();

const normalizePreviewText = (value) =>
  normalizeText(String(value || "").replace(/\s+/g, " ")).slice(
    0,
    SOURCE_ARCHIVE_PDF_PREVIEW_LIMIT,
  );

const mergeSearchText = (...values) =>
  values
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ")
    .slice(0, SOURCE_ARCHIVE_SEARCH_TEXT_LIMIT);

const inferExtension = (contentType, objectName) => {
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/avif") return "avif";
  const fileName = normalizeText(objectName).split("/").pop() || "";
  const extension = fileName.includes(".")
    ? fileName.split(".").pop().toLowerCase()
    : "";
  return extension || "jpg";
};

const normalizeStorageBasePath = (value) =>
  normalizeText(value).replace(/^\/+|\/+$/g, "");

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

const buildPdfRevisionPaths = ({ assetId, revision }) => {
  return buildPdfRevisionPathsForBasePath({
    basePath: `source-archive/${assetId}`,
    revision,
  });
};

const buildPdfRevisionPathsForBasePath = ({ basePath, revision }) => {
  const normalizedBasePath = normalizeStorageBasePath(basePath);
  const normalizedRevision = normalizeText(revision);
  const revisionBasePath = `${normalizedBasePath}/${normalizedRevision}`;
  const extractedPath = `${revisionBasePath}/extracted`;
  return {
    revision: normalizedRevision,
    basePath: revisionBasePath,
    originalPath: `${revisionBasePath}/original.pdf`,
    extractedPath,
    extractedManifestPath: `${extractedPath}/manifest.json`,
    extractedContentPath: `${extractedPath}/content.md`,
    extractedPagesPath: `${extractedPath}/pages`,
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
      contentType: contentType || "image/jpeg",
      cacheControl: "private,no-store,max-age=0",
    },
  });

  return {
    mimeType: contentType || "image/jpeg",
    byteSize: inputBuffer.length,
  };
};

const saveOriginalBinaryFile = saveOriginalSourceArchiveFile;

const renderSourceArchiveVariants = async ({ inputBuffer }) => {
  const sourceImage = sharp(inputBuffer, {
    failOn: "error",
    limitInputPixels: SOURCE_ARCHIVE_MAX_PIXELS,
  }).rotate();
  const metadata = await sourceImage.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("invalid-image-metadata");
  }

  const [displayResult, thumbResult] = await Promise.all([
    sourceImage
      .clone()
      .resize({
        width: SOURCE_ARCHIVE_DISPLAY_EDGE,
        height: SOURCE_ARCHIVE_DISPLAY_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true }),
    sourceImage
      .clone()
      .resize({
        width: SOURCE_ARCHIVE_THUMB_EDGE,
        height: SOURCE_ARCHIVE_THUMB_EDGE,
        fit: "inside",
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

const saveJsonStorageFile = async ({
  bucket,
  storagePath,
  data,
  cacheControl = "private,no-store,max-age=0",
}) => {
  await bucket.file(storagePath).save(JSON.stringify(data, null, 2), {
    resumable: false,
    metadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl,
    },
  });
};

const saveTextStorageFile = async ({
  bucket,
  storagePath,
  text,
  contentType,
  cacheControl = "private,no-store,max-age=0",
}) => {
  await bucket.file(storagePath).save(String(text || ""), {
    resumable: false,
    metadata: {
      contentType,
      cacheControl,
    },
  });
};

const loadOptionalSearchAdapter = () => {
  try {
    return require("./sourceArchiveSearchAdapter");
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
  if (adapter && typeof adapter.buildSearchArtifacts === "function") {
    return adapter.buildSearchArtifacts({
      bucket,
      assetId,
      revision,
      basePath,
      currentAsset,
    });
  }

  return {
    status: "metadata-only",
    artifactPath: "",
    previewText: "",
    processorVersion: SOURCE_ARCHIVE_PROCESSOR_VERSION,
  };
};

module.exports = {
  SOURCE_ARCHIVE_MEDIA_KIND,
  SOURCE_ARCHIVE_PDF_MEDIA_KIND,
  SOURCE_ARCHIVE_PROCESSOR_VERSION,
  SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  normalizeText,
  normalizePreviewText,
  mergeSearchText,
  buildRevisionPaths,
  buildPdfRevisionPaths,
  buildPdfRevisionPathsForBasePath,
  saveOriginalSourceArchiveFile,
  saveOriginalBinaryFile,
  renderSourceArchiveVariants,
  saveJsonStorageFile,
  saveTextStorageFile,
  buildSourceArchiveSearchState,
};
