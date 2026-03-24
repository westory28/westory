import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, functions, storage } from "./firebase";
import type {
  SourceArchiveAsset,
  SourceArchiveAssetType,
  SourceArchiveDraft,
  SourceArchiveExtractionStatus,
  SourceArchiveFileMeta,
  SourceArchiveImageMeta,
  SourceArchiveMediaKind,
  SourceArchiveProcessingStatus,
  SourceArchiveSearchMeta,
  SourceArchiveSearchStatus,
} from "../types";
import type { PreparedSourceArchiveUpload } from "./sourceArchiveImage";
import type { PreparedSourceArchivePdfUpload } from "./sourceArchivePdf";

export const SOURCE_ARCHIVE_COLLECTION = "source_archive";
export const SOURCE_ARCHIVE_RENDER_PAGE_SIZE = 12;
export const SOURCE_ARCHIVE_SCHEMA_VERSION = 3;
export const SOURCE_ARCHIVE_MEDIA_KIND: SourceArchiveMediaKind = "image";

export const SOURCE_ARCHIVE_TYPE_LABELS: Record<
  SourceArchiveAssetType,
  string
> = {
  photo: "사진",
  map: "지도",
  document: "문서",
  poster: "포스터",
  artifact: "유물",
  other: "기타",
};

export const SOURCE_ARCHIVE_STATUS_LABELS: Record<
  SourceArchiveProcessingStatus,
  string
> = {
  uploading: "업로드 중",
  queued: "처리 대기",
  processing: "처리 중",
  ready: "사용 가능",
  failed: "재업로드 필요",
  archived: "보관됨",
};

export const EMPTY_SOURCE_ARCHIVE_FILE: SourceArchiveFileMeta = {
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

export const EMPTY_SOURCE_ARCHIVE_SEARCH: SourceArchiveSearchMeta = {
  status: "metadata-only",
  artifactPath: "",
  previewText: "",
};

export const EMPTY_SOURCE_ARCHIVE_IMAGE: SourceArchiveImageMeta = {
  storagePath: "",
  originalPath: "",
  thumbPath: "",
  displayPath: "",
  mime: "",
  originalMime: "",
  width: 0,
  height: 0,
  byteSize: 0,
  originalWidth: 0,
  originalHeight: 0,
  originalByteSize: 0,
  thumbWidth: 0,
  thumbHeight: 0,
  thumbByteSize: 0,
  displayWidth: 0,
  displayHeight: 0,
  displayByteSize: 0,
  revision: "",
  originalName: "",
  pendingUploadToken: "",
  pendingUploadPath: "",
};

const EMPTY_EXTRACTION_VERSION = "";
const EMPTY_EXTRACTION_PATH = "";
const EMPTY_PARSER_KIND = "";

const normalizeText = (value: unknown) => String(value || "").trim();

const normalizeSourceArchiveType = (value: unknown): SourceArchiveAssetType => {
  if (
    value === "photo" ||
    value === "map" ||
    value === "document" ||
    value === "poster" ||
    value === "artifact" ||
    value === "other"
  ) {
    return value;
  }
  return "photo";
};

const normalizeSourceArchiveMediaKind = (
  value: unknown,
  fallback?: { mimeType?: string; storagePath?: string } | null,
): SourceArchiveMediaKind => {
  if (value === "pdf") return "pdf";

  const mimeType = normalizeText(fallback?.mimeType).toLowerCase();
  const storagePath = normalizeText(fallback?.storagePath).toLowerCase();
  if (mimeType === "application/pdf" || storagePath.endsWith(".pdf")) {
    return "pdf";
  }

  return "image";
};

const normalizeProcessingStatus = (
  value: unknown,
): SourceArchiveProcessingStatus => {
  if (
    value === "uploading" ||
    value === "queued" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed" ||
    value === "archived"
  ) {
    return value;
  }
  return "processing";
};

const normalizeExtractionStatus = (
  value: unknown,
  mediaKind: SourceArchiveMediaKind,
  processingStatus?: SourceArchiveProcessingStatus,
): SourceArchiveExtractionStatus => {
  if (
    value === "not-applicable" ||
    value === "queued" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed"
  ) {
    return value;
  }

  if (mediaKind !== "pdf") {
    return "not-applicable";
  }

  if (processingStatus === "processing") return "processing";
  if (processingStatus === "ready") return "ready";
  if (processingStatus === "failed") return "failed";
  return "queued";
};

const normalizeSearchStatus = (value: unknown): SourceArchiveSearchStatus => {
  if (
    value === "metadata-only" ||
    value === "pending" ||
    value === "ready" ||
    value === "failed"
  ) {
    return value;
  }
  return "metadata-only";
};

const getRevisionFromPath = (path: string) => {
  const normalized = normalizeText(path);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
};

export const normalizeSourceArchiveTags = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => normalizeText(item))
        .filter(Boolean),
    ),
  );

const normalizeSourceArchiveImage = (
  value: unknown,
): SourceArchiveImageMeta => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<SourceArchiveImageMeta>)
      : {};

  const displayPath = normalizeText(source.displayPath);
  const thumbPath = normalizeText(source.thumbPath);
  const originalPath = normalizeText(source.originalPath);
  const storagePath = normalizeText(source.storagePath);
  const revision =
    normalizeText(source.revision) ||
    getRevisionFromPath(displayPath || thumbPath || originalPath);

  return {
    ...EMPTY_SOURCE_ARCHIVE_IMAGE,
    storagePath,
    originalPath,
    thumbPath,
    displayPath,
    mime: normalizeText(source.mime),
    originalMime: normalizeText(source.originalMime),
    width: Number(source.width) || 0,
    height: Number(source.height) || 0,
    byteSize: Number(source.byteSize) || 0,
    originalWidth: Number(source.originalWidth) || 0,
    originalHeight: Number(source.originalHeight) || 0,
    originalByteSize: Number(source.originalByteSize) || 0,
    thumbWidth: Number(source.thumbWidth) || 0,
    thumbHeight: Number(source.thumbHeight) || 0,
    thumbByteSize: Number(source.thumbByteSize) || 0,
    displayWidth: Number(source.displayWidth) || 0,
    displayHeight: Number(source.displayHeight) || 0,
    displayByteSize: Number(source.displayByteSize) || 0,
    revision,
    originalName: normalizeText(source.originalName),
    pendingUploadToken: normalizeText(source.pendingUploadToken),
    pendingUploadPath: normalizeText(source.pendingUploadPath),
  };
};

const normalizeSourceArchiveFile = (
  value: unknown,
  image: SourceArchiveImageMeta,
  searchText: string,
  mediaKind: SourceArchiveMediaKind,
): SourceArchiveFileMeta => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<SourceArchiveFileMeta>)
      : {};
  const storagePath =
    normalizeText(source.storagePath) ||
    image.originalPath ||
    image.displayPath;
  const revision =
    normalizeText(source.revision) ||
    image.revision ||
    getRevisionFromPath(storagePath);
  const originalAvailable =
    source.originalAvailable === true ||
    Boolean(image.originalPath) ||
    (mediaKind === "pdf" && Boolean(storagePath)) ||
    (Boolean(storagePath) && !image.originalPath && !searchText);
  const legacyPreviewOnly =
    source.legacyPreviewOnly === true ||
    (!image.originalPath && Boolean(image.displayPath));

  return {
    ...EMPTY_SOURCE_ARCHIVE_FILE,
    storagePath,
    originalName:
      normalizeText(source.originalName) || image.originalName || "",
    mimeType:
      normalizeText(source.mimeType) || image.originalMime || image.mime || "",
    byteSize:
      Number(source.byteSize) ||
      image.originalByteSize ||
      image.displayByteSize ||
      image.byteSize ||
      0,
    width:
      Number(source.width) ||
      image.originalWidth ||
      image.displayWidth ||
      image.width ||
      0,
    height:
      Number(source.height) ||
      image.originalHeight ||
      image.displayHeight ||
      image.height ||
      0,
    revision,
    originalAvailable,
    legacyPreviewOnly,
    pendingUploadToken: normalizeText(source.pendingUploadToken),
    pendingUploadPath: normalizeText(source.pendingUploadPath),
  };
};

const normalizeSourceArchiveSearch = (
  value: unknown,
  fallbackSearchText: string,
): SourceArchiveSearchMeta => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<SourceArchiveSearchMeta>)
      : {};

  return {
    ...EMPTY_SOURCE_ARCHIVE_SEARCH,
    status: normalizeSearchStatus(
      source.status || (fallbackSearchText ? "metadata-only" : "pending"),
    ),
    artifactPath: normalizeText(source.artifactPath),
    previewText: normalizeText(source.previewText),
    updatedAt: source.updatedAt,
  };
};

const buildSourceArchiveFilePayload = (
  image: SourceArchiveImageMeta,
  file?: Partial<SourceArchiveFileMeta> | null,
  mediaKind: SourceArchiveMediaKind = "image",
): SourceArchiveFileMeta => {
  const next = file && typeof file === "object" ? file : {};
  const storagePath =
    normalizeText(next.storagePath) || image.originalPath || image.displayPath;

  return {
    ...EMPTY_SOURCE_ARCHIVE_FILE,
    storagePath,
    originalName: normalizeText(next.originalName) || image.originalName || "",
    mimeType:
      normalizeText(next.mimeType) || image.originalMime || image.mime || "",
    byteSize:
      Number(next.byteSize) ||
      image.originalByteSize ||
      image.displayByteSize ||
      image.byteSize ||
      0,
    width:
      Number(next.width) ||
      image.originalWidth ||
      image.displayWidth ||
      image.width ||
      0,
    height:
      Number(next.height) ||
      image.originalHeight ||
      image.displayHeight ||
      image.height ||
      0,
    revision:
      normalizeText(next.revision) ||
      image.revision ||
      getRevisionFromPath(storagePath),
    originalAvailable:
      next.originalAvailable === true ||
      Boolean(image.originalPath) ||
      (mediaKind === "pdf" && Boolean(storagePath)),
    legacyPreviewOnly:
      next.legacyPreviewOnly === true ||
      (!image.originalPath && Boolean(image.displayPath)),
    pendingUploadToken: normalizeText(next.pendingUploadToken),
    pendingUploadPath: normalizeText(next.pendingUploadPath),
  };
};

const buildSourceArchiveSearchPayload = (
  searchText: string,
  search?: Partial<SourceArchiveSearchMeta> | null,
): SourceArchiveSearchMeta => {
  const next = search && typeof search === "object" ? search : {};

  return {
    ...EMPTY_SOURCE_ARCHIVE_SEARCH,
    status: normalizeSearchStatus(
      next.status || (searchText ? "metadata-only" : "pending"),
    ),
    artifactPath: normalizeText(next.artifactPath),
    previewText: normalizeText(next.previewText),
    updatedAt: next.updatedAt,
  };
};

export const buildSourceArchiveSearchText = (
  draft: Pick<
    SourceArchiveDraft,
    | "title"
    | "description"
    | "era"
    | "subject"
    | "unit"
    | "source"
    | "tags"
    | "type"
  >,
  previewText = "",
) =>
  [
    normalizeText(draft.title),
    normalizeText(draft.description),
    normalizeText(draft.era),
    normalizeText(draft.subject),
    normalizeText(draft.unit),
    normalizeText(draft.source),
    SOURCE_ARCHIVE_TYPE_LABELS[normalizeSourceArchiveType(draft.type)],
    ...normalizeSourceArchiveTags(draft.tags),
    normalizeText(previewText).slice(0, 1200),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const createEmptySourceArchiveDraft = (): SourceArchiveDraft => ({
  schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
  mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
  status: "processing",
  currentRevision: "",
  title: "",
  description: "",
  era: "",
  subject: "",
  unit: "",
  type: "photo",
  tags: [],
  source: "",
  previewText: "",
  pageCount: 0,
  file: { ...EMPTY_SOURCE_ARCHIVE_FILE },
  search: { ...EMPTY_SOURCE_ARCHIVE_SEARCH },
  processingStatus: "processing",
  extractionStatus: "not-applicable",
  extractionVersion: EMPTY_EXTRACTION_VERSION,
  extractedContentPath: EMPTY_EXTRACTION_PATH,
  extractedManifestPath: EMPTY_EXTRACTION_PATH,
  parserKind: EMPTY_PARSER_KIND,
  parseErrorMessage: "",
  processingError: "",
  image: { ...EMPTY_SOURCE_ARCHIVE_IMAGE },
});

export const buildSourceArchiveDraft = (
  asset?: SourceArchiveAsset,
): SourceArchiveDraft => {
  if (!asset) return createEmptySourceArchiveDraft();

  return {
    id: asset.id,
    schemaVersion: asset.schemaVersion,
    mediaKind: asset.mediaKind,
    status: asset.status,
    currentRevision: asset.currentRevision,
    title: asset.title,
    description: asset.description,
    era: asset.era,
    subject: asset.subject,
    unit: asset.unit,
    type: asset.type,
    tags: [...asset.tags],
    source: asset.source,
    searchText: asset.searchText,
    previewText: asset.previewText,
    pageCount: asset.pageCount,
    file: { ...asset.file },
    search: { ...asset.search },
    processingStatus: asset.processingStatus,
    extractionStatus: asset.extractionStatus,
    extractionVersion: asset.extractionVersion,
    extractedContentPath: asset.extractedContentPath,
    extractedManifestPath: asset.extractedManifestPath,
    parserKind: asset.parserKind,
    parseErrorMessage: asset.parseErrorMessage,
    processingError: asset.processingError,
    processedAt: asset.processedAt,
    extractedAt: asset.extractedAt,
    image: { ...asset.image },
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    createdBy: asset.createdBy,
    updatedBy: asset.updatedBy,
  };
};

export const normalizeSourceArchiveAsset = (
  id: string,
  raw: unknown,
): SourceArchiveAsset => {
  const source =
    raw && typeof raw === "object" ? (raw as Partial<SourceArchiveAsset>) : {};
  const type = normalizeSourceArchiveType(source.type);
  const tags = normalizeSourceArchiveTags(source.tags);

  const draftForSearch = {
    title: normalizeText(source.title),
    description: normalizeText(source.description),
    era: normalizeText(source.era),
    subject: normalizeText(source.subject),
    unit: normalizeText(source.unit),
    source: normalizeText(source.source),
    tags,
    type,
  };
  const searchText = normalizeText(
    source.searchText ||
      buildSourceArchiveSearchText(
        draftForSearch,
        normalizeText(source.previewText || source.search?.previewText),
      ),
  ).toLowerCase();
  const image = normalizeSourceArchiveImage(source.image);
  const provisionalFile = normalizeSourceArchiveFile(
    source.file,
    image,
    searchText,
    "image",
  );
  const mediaKind = normalizeSourceArchiveMediaKind(source.mediaKind, {
    mimeType: provisionalFile.mimeType,
    storagePath: provisionalFile.storagePath,
  });
  const file = normalizeSourceArchiveFile(
    source.file,
    image,
    searchText,
    mediaKind,
  );
  const search = normalizeSourceArchiveSearch(source.search, searchText);
  const status = normalizeProcessingStatus(
    source.status || source.processingStatus,
  );
  const previewText = normalizeText(source.previewText || search.previewText);

  return {
    id,
    schemaVersion:
      Number(source.schemaVersion) || SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind,
    status,
    currentRevision: normalizeText(source.currentRevision) || file.revision,
    title: draftForSearch.title || "이름 없는 사료",
    description: draftForSearch.description,
    era: draftForSearch.era,
    subject: draftForSearch.subject,
    unit: draftForSearch.unit,
    type,
    tags,
    source: draftForSearch.source,
    searchText,
    previewText,
    pageCount: Number(source.pageCount) || 0,
    file,
    search,
    processingStatus: status,
    extractionStatus: normalizeExtractionStatus(
      source.extractionStatus,
      mediaKind,
      status,
    ),
    extractionVersion: normalizeText(source.extractionVersion),
    extractedContentPath: normalizeText(source.extractedContentPath),
    extractedManifestPath: normalizeText(source.extractedManifestPath),
    parserKind: normalizeText(source.parserKind),
    parseErrorMessage: normalizeText(source.parseErrorMessage),
    processingError: normalizeText(source.processingError),
    processedAt: source.processedAt,
    extractedAt: source.extractedAt,
    image,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    createdBy: normalizeText(source.createdBy),
    updatedBy: normalizeText(source.updatedBy),
  };
};

export const subscribeSourceArchiveAssets = (
  onChange: (items: SourceArchiveAsset[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, SOURCE_ARCHIVE_COLLECTION),
      orderBy("updatedAt", "desc"),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((item) =>
          normalizeSourceArchiveAsset(item.id, item.data()),
        ),
      );
    },
    (error) => {
      onError?.(error as Error);
    },
  );

const buildIncomingUploadPath = (
  assetId: string,
  uploadToken: string,
  extension: string,
) => `source-archive/${assetId}/incoming/${uploadToken}.${extension}`;

const buildCombinedSearchText = (searchText: string, previewText: string) =>
  [normalizeText(searchText), normalizeText(previewText)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const isImageUpload = (
  upload:
    | PreparedSourceArchiveUpload
    | PreparedSourceArchivePdfUpload
    | null
    | undefined,
): upload is PreparedSourceArchiveUpload => upload?.kind === "image";

const isPdfUpload = (
  upload:
    | PreparedSourceArchiveUpload
    | PreparedSourceArchivePdfUpload
    | null
    | undefined,
): upload is PreparedSourceArchivePdfUpload => upload?.kind === "pdf";

export const getSourceArchiveDownloadUrl = async (storagePath: string) => {
  const normalizedPath = normalizeText(storagePath);
  if (!normalizedPath) {
    throw new Error("다운로드할 파일 경로가 없습니다.");
  }
  return getDownloadURL(ref(storage, normalizedPath));
};

export const saveSourceArchiveAsset = async (params: {
  draft: SourceArchiveDraft;
  actorUid: string;
  fileUpload?:
    | PreparedSourceArchiveUpload
    | PreparedSourceArchivePdfUpload
    | null;
}) => {
  const requestedMediaKind = normalizeSourceArchiveMediaKind(
    params.draft.mediaKind,
    {
      mimeType: params.draft.file?.mimeType,
      storagePath: params.draft.file?.storagePath,
    },
  );
  const assetUpload = params.fileUpload || null;
  const nextMediaKind = assetUpload?.kind || requestedMediaKind;
  const normalizedImage =
    nextMediaKind === "pdf"
      ? { ...EMPTY_SOURCE_ARCHIVE_IMAGE }
      : normalizeSourceArchiveImage(params.draft.image);

  const normalizedDraft: SourceArchiveDraft = {
    ...createEmptySourceArchiveDraft(),
    ...params.draft,
    id: normalizeText(params.draft.id) || undefined,
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: nextMediaKind,
    status: normalizeProcessingStatus(params.draft.status),
    currentRevision: normalizeText(params.draft.currentRevision),
    title: normalizeText(params.draft.title),
    description: normalizeText(params.draft.description),
    era: normalizeText(params.draft.era),
    subject: normalizeText(params.draft.subject),
    unit: normalizeText(params.draft.unit),
    type: normalizeSourceArchiveType(params.draft.type),
    tags: normalizeSourceArchiveTags(params.draft.tags),
    source: normalizeText(params.draft.source),
    searchText: normalizeText(params.draft.searchText).toLowerCase(),
    previewText: normalizeText(params.draft.previewText),
    pageCount: Number(params.draft.pageCount) || 0,
    file: buildSourceArchiveFilePayload(
      normalizedImage,
      params.draft.file,
      nextMediaKind,
    ),
    search: buildSourceArchiveSearchPayload(
      normalizeText(params.draft.searchText).toLowerCase(),
      params.draft.search,
    ),
    processingStatus: normalizeProcessingStatus(params.draft.processingStatus),
    extractionStatus: normalizeExtractionStatus(
      params.draft.extractionStatus,
      nextMediaKind,
      normalizeProcessingStatus(params.draft.processingStatus),
    ),
    extractionVersion: normalizeText(params.draft.extractionVersion),
    extractedContentPath: normalizeText(params.draft.extractedContentPath),
    extractedManifestPath: normalizeText(params.draft.extractedManifestPath),
    parserKind: normalizeText(params.draft.parserKind),
    parseErrorMessage: normalizeText(params.draft.parseErrorMessage),
    processingError: normalizeText(params.draft.processingError),
    image: normalizedImage,
  };

  if (!normalizedDraft.title) {
    throw new Error("제목을 입력해 주세요.");
  }
  if (
    !normalizedDraft.era &&
    !normalizedDraft.subject &&
    !normalizedDraft.unit
  ) {
    throw new Error("시대, 주제, 단원 중 하나 이상을 입력해 주세요.");
  }

  const searchText = buildSourceArchiveSearchText(normalizedDraft);
  const assetRef = normalizedDraft.id
    ? doc(db, SOURCE_ARCHIVE_COLLECTION, normalizedDraft.id)
    : doc(collection(db, SOURCE_ARCHIVE_COLLECTION));
  const uploadToken = assetUpload ? crypto.randomUUID() : "";
  const incomingUploadPath = assetUpload
    ? buildIncomingUploadPath(assetRef.id, uploadToken, assetUpload.extension)
    : "";
  const nextImage = isImageUpload(assetUpload)
    ? {
        ...normalizeSourceArchiveImage(normalizedDraft.image),
        originalName:
          assetUpload.originalName || normalizedDraft.image?.originalName || "",
        originalMime:
          assetUpload.originalMimeType ||
          normalizedDraft.image?.originalMime ||
          "",
        originalWidth:
          assetUpload.originalWidth ||
          normalizedDraft.image?.originalWidth ||
          0,
        originalHeight:
          assetUpload.originalHeight ||
          normalizedDraft.image?.originalHeight ||
          0,
        originalByteSize:
          assetUpload.originalByteSize ||
          normalizedDraft.image?.originalByteSize ||
          0,
        pendingUploadToken: uploadToken,
        pendingUploadPath: incomingUploadPath,
      }
    : {
        ...EMPTY_SOURCE_ARCHIVE_IMAGE,
        ...(nextMediaKind === "image"
          ? normalizeSourceArchiveImage(normalizedDraft.image)
          : {}),
      };
  const nextFile = {
    ...buildSourceArchiveFilePayload(
      nextImage,
      normalizedDraft.file,
      nextMediaKind,
    ),
    originalName:
      assetUpload?.originalName ||
      normalizedDraft.file?.originalName ||
      nextImage.originalName ||
      "",
    mimeType:
      assetUpload?.originalMimeType ||
      normalizedDraft.file?.mimeType ||
      nextImage.originalMime ||
      "",
    byteSize:
      assetUpload?.originalByteSize ||
      normalizedDraft.file?.byteSize ||
      nextImage.originalByteSize ||
      0,
    width: isImageUpload(assetUpload)
      ? assetUpload.originalWidth ||
        normalizedDraft.file?.width ||
        nextImage.originalWidth ||
        0
      : nextMediaKind === "pdf"
        ? 0
        : normalizedDraft.file?.width || nextImage.originalWidth || 0,
    height: isImageUpload(assetUpload)
      ? assetUpload.originalHeight ||
        normalizedDraft.file?.height ||
        nextImage.originalHeight ||
        0
      : nextMediaKind === "pdf"
        ? 0
        : normalizedDraft.file?.height || nextImage.originalHeight || 0,
    originalAvailable: Boolean(
      normalizedDraft.file?.storagePath || nextImage.originalPath,
    ),
    legacyPreviewOnly:
      Boolean(normalizedDraft.file?.legacyPreviewOnly) &&
      nextMediaKind === "image",
    pendingUploadToken: isPdfUpload(assetUpload) ? uploadToken : "",
    pendingUploadPath: isPdfUpload(assetUpload) ? incomingUploadPath : "",
  };
  const nextSearch = {
    ...buildSourceArchiveSearchPayload(searchText, normalizedDraft.search),
    status: assetUpload
      ? "pending"
      : buildSourceArchiveSearchPayload(searchText, normalizedDraft.search)
          .status,
    previewText: assetUpload
      ? ""
      : normalizedDraft.previewText ||
        normalizedDraft.search?.previewText ||
        "",
  } satisfies SourceArchiveSearchMeta;

  if (
    !assetUpload &&
    nextMediaKind === "image" &&
    !nextImage.displayPath &&
    !nextImage.thumbPath &&
    !nextFile.storagePath
  ) {
    throw new Error("이미지를 선택해 주세요.");
  }
  if (!assetUpload && nextMediaKind === "pdf" && !nextFile.storagePath) {
    throw new Error("PDF를 선택해 주세요.");
  }

  await setDoc(
    assetRef,
    {
      schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
      mediaKind: nextMediaKind,
      status: assetUpload ? "uploading" : normalizedDraft.status,
      currentRevision: normalizedDraft.currentRevision,
      title: normalizedDraft.title,
      description: normalizedDraft.description,
      era: normalizedDraft.era,
      subject: normalizedDraft.subject,
      unit: normalizedDraft.unit,
      type: normalizedDraft.type,
      tags: normalizedDraft.tags,
      source: normalizedDraft.source,
      searchText: assetUpload
        ? searchText
        : buildCombinedSearchText(
            searchText,
            normalizedDraft.previewText || nextSearch.previewText,
          ),
      previewText: assetUpload ? "" : normalizedDraft.previewText,
      pageCount:
        assetUpload && nextMediaKind === "pdf" ? 0 : normalizedDraft.pageCount,
      file: nextFile,
      search: nextSearch,
      processingStatus: assetUpload
        ? "uploading"
        : normalizedDraft.processingStatus,
      extractionStatus:
        assetUpload && nextMediaKind === "pdf"
          ? "queued"
          : normalizedDraft.extractionStatus,
      extractionVersion: assetUpload
        ? EMPTY_EXTRACTION_VERSION
        : normalizedDraft.extractionVersion,
      extractedContentPath: assetUpload
        ? EMPTY_EXTRACTION_PATH
        : normalizedDraft.extractedContentPath,
      extractedManifestPath: assetUpload
        ? EMPTY_EXTRACTION_PATH
        : normalizedDraft.extractedManifestPath,
      parserKind: assetUpload ? EMPTY_PARSER_KIND : normalizedDraft.parserKind,
      parseErrorMessage: assetUpload ? "" : normalizedDraft.parseErrorMessage,
      processingError: assetUpload ? "" : normalizedDraft.processingError,
      image: nextImage,
      updatedAt: serverTimestamp(),
      updatedBy: params.actorUid,
      ...(normalizedDraft.id
        ? {}
        : {
            createdAt: serverTimestamp(),
            createdBy: params.actorUid,
          }),
    },
    { merge: true },
  );

  if (!assetUpload || !incomingUploadPath) {
    return assetRef.id;
  }

  try {
    await uploadBytes(ref(storage, incomingUploadPath), assetUpload.blob, {
      contentType: assetUpload.mimeType,
      cacheControl: "private,no-store,max-age=0",
    });

    await setDoc(
      assetRef,
      {
        status: "queued",
        processingStatus: "queued",
        extractionStatus:
          nextMediaKind === "pdf" ? "queued" : normalizedDraft.extractionStatus,
        updatedAt: serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );

    return assetRef.id;
  } catch (error) {
    const message = String(
      (error as { message?: string })?.message || "upload-failed",
    );
    await setDoc(
      assetRef,
      {
        status: "failed",
        processingStatus: "failed",
        extractionStatus:
          nextMediaKind === "pdf" ? "failed" : normalizedDraft.extractionStatus,
        parseErrorMessage:
          nextMediaKind === "pdf" ? message : normalizedDraft.parseErrorMessage,
        processingError: message,
        previewText: nextMediaKind === "pdf" ? "" : normalizedDraft.previewText,
        search: {
          ...nextSearch,
          status: "failed",
          previewText: nextMediaKind === "pdf" ? "" : nextSearch.previewText,
        },
        file: {
          ...nextFile,
          pendingUploadToken: "",
          pendingUploadPath: "",
        },
        image: {
          ...nextImage,
          pendingUploadToken: "",
          pendingUploadPath: "",
        },
        updatedAt: serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );
    throw error;
  }
};

export const deleteSourceArchiveAsset = async (assetId: string) => {
  const callable = httpsCallable(functions, "deleteSourceArchiveAsset");
  const result = await callable({ assetId: normalizeText(assetId) });
  return result.data as {
    assetId: string;
    deleted: boolean;
    fileCount: number;
  };
};
