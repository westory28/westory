import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { auth, db, getFirebaseStorage, getHttpsCallable } from "./firebase";
import { executeWestoryCommand, WestoryCommandError } from "./commandGateway";
import {
  createStableLegacyMutationActionKey,
  getOrCreateLegacyWisMutationIntent,
  forgetLegacyWisMutationIntent,
} from "./legacyWisMutationIntent";
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
export type SourceArchiveManagedAsset = SourceArchiveAsset & {
  deleteCommandId?: string;
  deletionStatus?: string;
};
export type SourceArchiveEditorSnapshot = {
  draft: SourceArchiveDraft;
  selectedFile: File | null;
  tagInput: string;
  panelMode: "create" | "edit";
};
type SourceArchiveWriteOutcome =
  | { ok: true; assetId: string }
  | { ok: false; error: unknown };
type SourceArchiveEditorRecovery = SourceArchiveEditorSnapshot & {
  pending: boolean;
  settled: Promise<SourceArchiveWriteOutcome>;
};
// Raw files and draft text remain in this tab's memory across step-up remounts.
const editorRecoveries = new Map<string, SourceArchiveEditorRecovery>();
export const sourceArchiveEditorRecovery = {
  peek: (ownerUid: string) => editorRecoveries.get(ownerUid),
  acknowledge: (ownerUid: string, record: SourceArchiveEditorRecovery) => {
    if (editorRecoveries.get(ownerUid) === record && !record.pending)
      editorRecoveries.delete(ownerUid);
  },
  run: (
    ownerUid: string,
    snapshot: SourceArchiveEditorSnapshot,
    execute: (snapshot: SourceArchiveEditorSnapshot) => Promise<string>,
  ) => {
    if (editorRecoveries.get(ownerUid)?.pending)
      throw new Error(
        "앞선 사료 저장 결과를 확인하고 있습니다. 잠시만 기다려 주세요.",
      );
    const task = Promise.resolve().then(() => execute(snapshot));
    const record: SourceArchiveEditorRecovery = {
      ...snapshot,
      pending: true,
      settled: task.then(
        (assetId) => {
          record.pending = false;
          return { ok: true, assetId };
        },
        (error: unknown) => {
          record.pending = false;
          return { ok: false, error };
        },
      ),
    };
    editorRecoveries.set(ownerUid, record);
    return record;
  },
};
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
): SourceArchiveManagedAsset => {
  const source =
    raw && typeof raw === "object"
      ? (raw as Partial<SourceArchiveManagedAsset>)
      : {};
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
    deleteCommandId: normalizeText(source.deleteCommandId),
    deletionStatus: normalizeText(source.deletionStatus),
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
  onChange: (items: SourceArchiveManagedAsset[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, SOURCE_ARCHIVE_COLLECTION),
      orderBy("updatedAt", "desc"),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs
          .filter((item) => item.data().deletionStatus !== "COMPLETED")
          .map((item) => normalizeSourceArchiveAsset(item.id, item.data())),
      );
    },
    (error) => {
      onError?.(error as Error);
    },
  );

export const getSourceArchiveDownloadUrl = async (storagePath: string) => {
  const normalizedPath = normalizeText(storagePath);
  if (!normalizedPath) {
    throw new Error("다운로드할 파일 경로가 없습니다.");
  }
  const storage = await getFirebaseStorage();
  return getDownloadURL(ref(storage, normalizedPath));
};

const archiveVersion = (value: unknown) => {
  const timestamp = value as { seconds?: number; nanoseconds?: number } | null;
  return timestamp &&
    Number.isSafeInteger(timestamp.seconds) &&
    Number.isSafeInteger(timestamp.nanoseconds)
    ? `${timestamp.seconds}:${timestamp.nanoseconds}`
    : "";
};

const archiveMetadata = (draft: SourceArchiveDraft) => ({
  title: normalizeText(draft.title),
  description: normalizeText(draft.description),
  era: normalizeText(draft.era),
  subject: normalizeText(draft.subject),
  unit: normalizeText(draft.unit),
  type: normalizeSourceArchiveType(draft.type),
  tags: normalizeSourceArchiveTags(draft.tags),
  source: normalizeText(draft.source),
});

const forgetConfirmedFailure = (intentKey: string, error: unknown) => {
  if (
    error instanceof WestoryCommandError &&
    error.outcomeConfirmed &&
    ["failed", "conflict", "unauthorized"].includes(error.state)
  ) {
    forgetLegacyWisMutationIntent(intentKey);
  }
};

export const saveSourceArchiveAsset = async (params: {
  draft: SourceArchiveDraft;
  actorUid: string;
  fileUpload?:
    | PreparedSourceArchiveUpload
    | PreparedSourceArchivePdfUpload
    | null;
}) => {
  if (!params.actorUid || params.actorUid !== auth.currentUser?.uid)
    throw new Error("로그인 상태를 확인해 주세요.");
  const metadata = archiveMetadata(params.draft);
  if (!metadata.title) throw new Error("제목을 입력해 주세요.");
  if (!metadata.era && !metadata.subject && !metadata.unit)
    throw new Error("시대, 주제, 단원 중 하나 이상을 입력해 주세요.");
  const base = {
    assetId: params.draft.id || "",
    expectedUpdatedAt: archiveVersion(params.draft.updatedAt),
    metadata,
  };
  const upload = params.fileUpload;
  if (!upload) {
    if (!base.assetId) throw new Error("이미지나 PDF를 선택해 주세요.");
    const intentKey = createStableLegacyMutationActionKey(
      `source-archive:${params.actorUid}:metadata`,
      base,
    );
    const intent = getOrCreateLegacyWisMutationIntent(intentKey, () => base);
    try {
      const response = await executeWestoryCommand(
        "saveSourceArchiveMetadata",
        intent.payload,
        { commandId: intent.commandId, expectedUid: params.actorUid },
      );
      forgetLegacyWisMutationIntent(intentKey);
      return response.result.assetId;
    } catch (error) {
      forgetConfirmedFailure(intentKey, error);
      throw error;
    }
  }
  const bytes = new Uint8Array(await upload.blob.arrayBuffer());
  if (
    !bytes.length ||
    bytes.length > (upload.kind === "pdf" ? 20 : 4.5) * 1024 * 1024
  )
    throw new Error(
      upload.kind === "pdf"
        ? "PDF는 20MB 이하여야 합니다."
        : "이미지는 4.5MB 이하여야 합니다.",
    );
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const payload = {
    ...base,
    upload: {
      mediaKind: upload.kind,
      contentType: upload.mimeType,
      byteSize: bytes.length,
      sha256,
      originalName: upload.originalName,
      originalMimeType: upload.originalMimeType,
      originalByteSize: upload.originalByteSize,
      originalWidth: upload.originalWidth,
      originalHeight: upload.originalHeight,
    },
  };
  const intentKey = createStableLegacyMutationActionKey(
    `source-archive:${params.actorUid}:upload`,
    payload,
  );
  const intent = getOrCreateLegacyWisMutationIntent(intentKey, () => payload);
  try {
    const prepared = await executeWestoryCommand(
      "prepareSourceArchiveUpload",
      intent.payload,
      { commandId: intent.commandId, expectedUid: params.actorUid },
    );
    if (auth.currentUser?.uid !== params.actorUid)
      throw new Error(
        "로그인 사용자가 바뀌었습니다. 파일은 다시 로그인한 뒤 올려 주세요.",
      );
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const callable = await getHttpsCallable("uploadSourceArchiveAsset");
    await callable({
      uploadId: prepared.result.uploadId,
      contentBase64: btoa(binary),
    });
    forgetLegacyWisMutationIntent(intentKey);
    return prepared.result.assetId;
  } catch (error) {
    forgetConfirmedFailure(intentKey, error);
    throw error;
  }
};

export const deleteSourceArchiveAsset = async (
  asset: SourceArchiveManagedAsset,
) => {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("로그인 상태를 확인해 주세요.");
  const payload = {
    assetId: asset.id,
    expectedUpdatedAt: archiveVersion(asset.updatedAt),
  };
  const intentKey = createStableLegacyMutationActionKey(
    `source-archive:${actorUid}:delete`,
    { assetId: asset.id },
  );
  const intent = getOrCreateLegacyWisMutationIntent(intentKey, () => payload);
  try {
    // After a reload a visible tombstone offers the same cleanup retry, without
    // issuing another logical delete against the already-deleted document.
    const deleteCommandId =
      asset.deleteCommandId ||
      (
        await executeWestoryCommand(
          "deleteSourceArchiveAsset",
          intent.payload,
          { commandId: intent.commandId, expectedUid: actorUid },
        )
      ).commandId;
    if (auth.currentUser?.uid !== actorUid)
      throw new Error(
        "로그인 사용자가 바뀌었습니다. 다시 로그인한 뒤 삭제를 이어서 진행해 주세요.",
      );
    const callable = await getHttpsCallable("cleanupSourceArchiveAsset");
    const result = await callable({ assetId: asset.id, deleteCommandId });
    forgetLegacyWisMutationIntent(intentKey);
    return result.data as { assetId: string; deleted: boolean };
  } catch (error) {
    forgetConfirmedFailure(intentKey, error);
    throw error;
  }
};
