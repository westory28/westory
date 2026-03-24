import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from './firebase';
import type {
  SourceArchiveAsset,
  SourceArchiveAssetType,
  SourceArchiveDraft,
  SourceArchiveFileMeta,
  SourceArchiveImageMeta,
  SourceArchiveMediaKind,
  SourceArchiveProcessingStatus,
  SourceArchiveSearchMeta,
  SourceArchiveSearchStatus,
} from '../types';
import type { PreparedSourceArchiveUpload } from './sourceArchiveImage';

export const SOURCE_ARCHIVE_COLLECTION = 'source_archive';
export const SOURCE_ARCHIVE_RENDER_PAGE_SIZE = 12;
export const SOURCE_ARCHIVE_SCHEMA_VERSION = 2;
export const SOURCE_ARCHIVE_MEDIA_KIND: SourceArchiveMediaKind = 'image';

export const SOURCE_ARCHIVE_TYPE_LABELS: Record<SourceArchiveAssetType, string> = {
  photo: '사진',
  map: '지도',
  document: '문서',
  poster: '포스터',
  artifact: '유물',
  other: '기타',
};

export const SOURCE_ARCHIVE_STATUS_LABELS: Record<SourceArchiveProcessingStatus, string> = {
  uploading: '업로드 중',
  queued: '처리 대기',
  processing: '처리 중',
  ready: '사용 가능',
  failed: '재업로드 필요',
  archived: '보관됨',
};

export const EMPTY_SOURCE_ARCHIVE_FILE: SourceArchiveFileMeta = {
  storagePath: '',
  originalName: '',
  mimeType: '',
  byteSize: 0,
  width: 0,
  height: 0,
  revision: '',
  originalAvailable: false,
  legacyPreviewOnly: false,
};

export const EMPTY_SOURCE_ARCHIVE_SEARCH: SourceArchiveSearchMeta = {
  status: 'metadata-only',
  artifactPath: '',
  previewText: '',
};

export const EMPTY_SOURCE_ARCHIVE_IMAGE: SourceArchiveImageMeta = {
  storagePath: '',
  originalPath: '',
  thumbPath: '',
  displayPath: '',
  mime: '',
  originalMime: '',
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
  revision: '',
  originalName: '',
  pendingUploadToken: '',
  pendingUploadPath: '',
};

const normalizeText = (value: unknown) => String(value || '').trim();

const normalizeSourceArchiveType = (value: unknown): SourceArchiveAssetType => {
  if (
    value === 'photo'
    || value === 'map'
    || value === 'document'
    || value === 'poster'
    || value === 'artifact'
    || value === 'other'
  ) {
    return value;
  }
  return 'photo';
};

const normalizeProcessingStatus = (value: unknown): SourceArchiveProcessingStatus => {
  if (
    value === 'uploading'
    || value === 'queued'
    || value === 'processing'
    || value === 'ready'
    || value === 'failed'
    || value === 'archived'
  ) {
    return value;
  }
  return 'processing';
};

const normalizeSearchStatus = (value: unknown): SourceArchiveSearchStatus => {
  if (value === 'metadata-only' || value === 'pending' || value === 'ready' || value === 'failed') {
    return value;
  }
  return 'metadata-only';
};

const getRevisionFromPath = (path: string) => {
  const normalized = normalizeText(path);
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
};

export const normalizeSourceArchiveTags = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => normalizeText(item))
        .filter(Boolean),
    ),
  );

const normalizeSourceArchiveImage = (value: unknown): SourceArchiveImageMeta => {
  const source = value && typeof value === 'object'
    ? value as Partial<SourceArchiveImageMeta>
    : {};

  const displayPath = normalizeText(source.displayPath);
  const thumbPath = normalizeText(source.thumbPath);
  const originalPath = normalizeText(source.originalPath);
  const storagePath = normalizeText(source.storagePath);
  const revision = normalizeText(source.revision) || getRevisionFromPath(displayPath || thumbPath || originalPath);

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
): SourceArchiveFileMeta => {
  const source = value && typeof value === 'object'
    ? value as Partial<SourceArchiveFileMeta>
    : {};
  const storagePath = normalizeText(source.storagePath)
    || image.originalPath
    || image.displayPath;
  const revision = normalizeText(source.revision)
    || image.revision
    || getRevisionFromPath(storagePath);
  const originalAvailable = source.originalAvailable === true
    || Boolean(image.originalPath)
    || (Boolean(storagePath) && !image.originalPath && !searchText);
  const legacyPreviewOnly = source.legacyPreviewOnly === true
    || (!image.originalPath && Boolean(image.displayPath));

  return {
    ...EMPTY_SOURCE_ARCHIVE_FILE,
    storagePath,
    originalName: normalizeText(source.originalName) || image.originalName || '',
    mimeType: normalizeText(source.mimeType) || image.originalMime || image.mime || '',
    byteSize: Number(source.byteSize) || image.originalByteSize || image.displayByteSize || image.byteSize || 0,
    width: Number(source.width) || image.originalWidth || image.displayWidth || image.width || 0,
    height: Number(source.height) || image.originalHeight || image.displayHeight || image.height || 0,
    revision,
    originalAvailable,
    legacyPreviewOnly,
  };
};

const normalizeSourceArchiveSearch = (
  value: unknown,
  fallbackSearchText: string,
): SourceArchiveSearchMeta => {
  const source = value && typeof value === 'object'
    ? value as Partial<SourceArchiveSearchMeta>
    : {};

  return {
    ...EMPTY_SOURCE_ARCHIVE_SEARCH,
    status: normalizeSearchStatus(source.status || (fallbackSearchText ? 'metadata-only' : 'pending')),
    artifactPath: normalizeText(source.artifactPath),
    previewText: normalizeText(source.previewText),
    updatedAt: source.updatedAt,
  };
};

const buildSourceArchiveFilePayload = (
  image: SourceArchiveImageMeta,
  file?: Partial<SourceArchiveFileMeta> | null,
): SourceArchiveFileMeta => {
  const next = file && typeof file === 'object' ? file : {};
  const storagePath = normalizeText(next.storagePath)
    || image.originalPath
    || image.displayPath;

  return {
    ...EMPTY_SOURCE_ARCHIVE_FILE,
    storagePath,
    originalName: normalizeText(next.originalName) || image.originalName || '',
    mimeType: normalizeText(next.mimeType) || image.originalMime || image.mime || '',
    byteSize: Number(next.byteSize) || image.originalByteSize || image.displayByteSize || image.byteSize || 0,
    width: Number(next.width) || image.originalWidth || image.displayWidth || image.width || 0,
    height: Number(next.height) || image.originalHeight || image.displayHeight || image.height || 0,
    revision: normalizeText(next.revision) || image.revision || getRevisionFromPath(storagePath),
    originalAvailable: next.originalAvailable === true || Boolean(image.originalPath),
    legacyPreviewOnly: next.legacyPreviewOnly === true || (!image.originalPath && Boolean(image.displayPath)),
  };
};

const buildSourceArchiveSearchPayload = (
  searchText: string,
  search?: Partial<SourceArchiveSearchMeta> | null,
): SourceArchiveSearchMeta => {
  const next = search && typeof search === 'object' ? search : {};

  return {
    ...EMPTY_SOURCE_ARCHIVE_SEARCH,
    status: normalizeSearchStatus(next.status || (searchText ? 'metadata-only' : 'pending')),
    artifactPath: normalizeText(next.artifactPath),
    previewText: normalizeText(next.previewText),
    updatedAt: next.updatedAt,
  };
};

export const buildSourceArchiveSearchText = (draft: Pick<
  SourceArchiveDraft,
  'title' | 'description' | 'era' | 'subject' | 'unit' | 'source' | 'tags' | 'type'
>) =>
  [
    normalizeText(draft.title),
    normalizeText(draft.description),
    normalizeText(draft.era),
    normalizeText(draft.subject),
    normalizeText(draft.unit),
    normalizeText(draft.source),
    SOURCE_ARCHIVE_TYPE_LABELS[normalizeSourceArchiveType(draft.type)],
    ...normalizeSourceArchiveTags(draft.tags),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export const createEmptySourceArchiveDraft = (): SourceArchiveDraft => ({
  schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
  mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
  status: 'processing',
  currentRevision: '',
  title: '',
  description: '',
  era: '',
  subject: '',
  unit: '',
  type: 'photo',
  tags: [],
  source: '',
  file: { ...EMPTY_SOURCE_ARCHIVE_FILE },
  search: { ...EMPTY_SOURCE_ARCHIVE_SEARCH },
  processingStatus: 'processing',
  processingError: '',
  image: { ...EMPTY_SOURCE_ARCHIVE_IMAGE },
});

export const buildSourceArchiveDraft = (asset?: SourceArchiveAsset): SourceArchiveDraft => {
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
    file: { ...asset.file },
    search: { ...asset.search },
    processingStatus: asset.processingStatus,
    processingError: asset.processingError,
    processedAt: asset.processedAt,
    image: { ...asset.image },
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    createdBy: asset.createdBy,
    updatedBy: asset.updatedBy,
  };
};

export const normalizeSourceArchiveAsset = (id: string, raw: unknown): SourceArchiveAsset => {
  const source = raw && typeof raw === 'object'
    ? raw as Partial<SourceArchiveAsset>
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
    source.searchText || buildSourceArchiveSearchText(draftForSearch),
  ).toLowerCase();
  const image = normalizeSourceArchiveImage(source.image);
  const file = normalizeSourceArchiveFile(source.file, image, searchText);
  const search = normalizeSourceArchiveSearch(source.search, searchText);
  const status = normalizeProcessingStatus(source.status || source.processingStatus);

  return {
    id,
    schemaVersion: Number(source.schemaVersion) || SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: source.mediaKind === SOURCE_ARCHIVE_MEDIA_KIND ? source.mediaKind : SOURCE_ARCHIVE_MEDIA_KIND,
    status,
    currentRevision: normalizeText(source.currentRevision) || file.revision,
    title: draftForSearch.title || '이름 없는 사료',
    description: draftForSearch.description,
    era: draftForSearch.era,
    subject: draftForSearch.subject,
    unit: draftForSearch.unit,
    type,
    tags,
    source: draftForSearch.source,
    searchText,
    file,
    search,
    processingStatus: status,
    processingError: normalizeText(source.processingError),
    processedAt: source.processedAt,
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
    query(collection(db, SOURCE_ARCHIVE_COLLECTION), orderBy('updatedAt', 'desc')),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => normalizeSourceArchiveAsset(item.id, item.data())));
    },
    (error) => {
      onError?.(error as Error);
    },
  );

const buildIncomingUploadPath = (assetId: string, uploadToken: string, extension: string) =>
  `source-archive/${assetId}/incoming/${uploadToken}.${extension}`;

export const getSourceArchiveDownloadUrl = async (storagePath: string) => {
  const normalizedPath = normalizeText(storagePath);
  if (!normalizedPath) {
    throw new Error('다운로드할 파일 경로가 없습니다.');
  }
  return getDownloadURL(ref(storage, normalizedPath));
};

export const saveSourceArchiveAsset = async (params: {
  draft: SourceArchiveDraft;
  actorUid: string;
  imageUpload?: PreparedSourceArchiveUpload | null;
}) => {
  const normalizedDraft: SourceArchiveDraft = {
    ...createEmptySourceArchiveDraft(),
    ...params.draft,
    id: normalizeText(params.draft.id) || undefined,
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
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
    file: buildSourceArchiveFilePayload(
      normalizeSourceArchiveImage(params.draft.image),
      params.draft.file,
    ),
    search: buildSourceArchiveSearchPayload(
      normalizeText(params.draft.searchText).toLowerCase(),
      params.draft.search,
    ),
    processingStatus: normalizeProcessingStatus(params.draft.processingStatus),
    processingError: normalizeText(params.draft.processingError),
    image: normalizeSourceArchiveImage(params.draft.image),
  };

  if (!normalizedDraft.title) {
    throw new Error('제목을 입력해 주세요.');
  }
  if (!normalizedDraft.era && !normalizedDraft.subject && !normalizedDraft.unit) {
    throw new Error('시대, 주제, 단원 중 하나 이상을 입력해 주세요.');
  }

  const searchText = buildSourceArchiveSearchText(normalizedDraft);
  const assetRef = normalizedDraft.id
    ? doc(db, SOURCE_ARCHIVE_COLLECTION, normalizedDraft.id)
    : doc(collection(db, SOURCE_ARCHIVE_COLLECTION));
  const uploadToken = params.imageUpload ? crypto.randomUUID() : '';
  const incomingUploadPath = params.imageUpload
    ? buildIncomingUploadPath(assetRef.id, uploadToken, params.imageUpload.extension)
    : '';
  const nextImage = {
    ...normalizeSourceArchiveImage(normalizedDraft.image),
    originalName: params.imageUpload?.originalName || normalizedDraft.image?.originalName || '',
    originalMime: params.imageUpload?.originalMimeType || normalizedDraft.image?.originalMime || '',
    originalWidth: params.imageUpload?.originalWidth || normalizedDraft.image?.originalWidth || 0,
    originalHeight: params.imageUpload?.originalHeight || normalizedDraft.image?.originalHeight || 0,
    originalByteSize: params.imageUpload?.originalByteSize || normalizedDraft.image?.originalByteSize || 0,
    pendingUploadToken: params.imageUpload ? uploadToken : '',
    pendingUploadPath: params.imageUpload ? incomingUploadPath : '',
  };
  const nextFile = {
    ...buildSourceArchiveFilePayload(nextImage, normalizedDraft.file),
    originalName: params.imageUpload?.originalName || normalizedDraft.file?.originalName || nextImage.originalName || '',
    mimeType: params.imageUpload?.originalMimeType || normalizedDraft.file?.mimeType || nextImage.originalMime || '',
    byteSize: params.imageUpload?.originalByteSize || normalizedDraft.file?.byteSize || nextImage.originalByteSize || 0,
    width: params.imageUpload?.originalWidth || normalizedDraft.file?.width || nextImage.originalWidth || 0,
    height: params.imageUpload?.originalHeight || normalizedDraft.file?.height || nextImage.originalHeight || 0,
    originalAvailable: Boolean(normalizedDraft.file?.storagePath || nextImage.originalPath),
    legacyPreviewOnly: Boolean(normalizedDraft.file?.legacyPreviewOnly),
  };
  const nextSearch = {
    ...buildSourceArchiveSearchPayload(searchText, normalizedDraft.search),
    status: params.imageUpload ? 'pending' : buildSourceArchiveSearchPayload(searchText, normalizedDraft.search).status,
  } satisfies SourceArchiveSearchMeta;

  if (!params.imageUpload && !nextImage.displayPath && !nextImage.thumbPath && !nextFile.storagePath) {
    throw new Error('이미지를 선택해 주세요.');
  }

  await setDoc(
    assetRef,
    {
      schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
      mediaKind: SOURCE_ARCHIVE_MEDIA_KIND,
      status: params.imageUpload ? 'uploading' : normalizedDraft.status,
      currentRevision: normalizedDraft.currentRevision,
      title: normalizedDraft.title,
      description: normalizedDraft.description,
      era: normalizedDraft.era,
      subject: normalizedDraft.subject,
      unit: normalizedDraft.unit,
      type: normalizedDraft.type,
      tags: normalizedDraft.tags,
      source: normalizedDraft.source,
      searchText,
      file: nextFile,
      search: nextSearch,
      processingStatus: params.imageUpload ? 'uploading' : normalizedDraft.processingStatus,
      processingError: params.imageUpload ? '' : normalizedDraft.processingError,
      image: nextImage,
      updatedAt: serverTimestamp(),
      updatedBy: params.actorUid,
      ...(normalizedDraft.id ? {} : {
        createdAt: serverTimestamp(),
        createdBy: params.actorUid,
      }),
    },
    { merge: true },
  );

  if (!params.imageUpload || !incomingUploadPath) {
    return assetRef.id;
  }

  try {
    await uploadBytes(ref(storage, incomingUploadPath), params.imageUpload.blob, {
      contentType: params.imageUpload.mimeType,
      cacheControl: 'private,no-store,max-age=0',
    });

    await setDoc(
      assetRef,
      {
        status: 'queued',
        processingStatus: 'queued',
        updatedAt: serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );

    return assetRef.id;
  } catch (error) {
    const message = String((error as { message?: string })?.message || 'upload-failed');
    await setDoc(
      assetRef,
      {
        status: 'failed',
        processingStatus: 'failed',
        processingError: message,
        search: {
          ...nextSearch,
          status: 'failed',
        },
        image: {
          ...nextImage,
          pendingUploadToken: '',
          pendingUploadPath: '',
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
  const callable = httpsCallable(functions, 'deleteSourceArchiveAsset');
  const result = await callable({ assetId: normalizeText(assetId) });
  return result.data as {
    assetId: string;
    deleted: boolean;
    fileCount: number;
  };
};
