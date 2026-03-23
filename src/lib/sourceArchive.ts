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
import { ref, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from './firebase';
import type {
  SourceArchiveAsset,
  SourceArchiveAssetType,
  SourceArchiveDraft,
  SourceArchiveImageMeta,
  SourceArchiveProcessingStatus,
} from '../types';
import type { PreparedSourceArchiveUpload } from './sourceArchiveImage';

export const SOURCE_ARCHIVE_COLLECTION = 'source_archive';
export const SOURCE_ARCHIVE_RENDER_PAGE_SIZE = 12;

export const SOURCE_ARCHIVE_TYPE_LABELS: Record<SourceArchiveAssetType, string> = {
  photo: '\uC0AC\uC9C4',
  map: '\uC9C0\uB3C4',
  document: '\uBB38\uC11C',
  poster: '\uD3EC\uC2A4\uD130',
  artifact: '\uC720\uBB3C',
  other: '\uAE30\uD0C0',
};

export const SOURCE_ARCHIVE_STATUS_LABELS: Record<SourceArchiveProcessingStatus, string> = {
  processing: '\uCC98\uB9AC \uC911',
  ready: '\uC900\uBE44\uB428',
  failed: '\uC2E4\uD328',
};

export const EMPTY_SOURCE_ARCHIVE_IMAGE: SourceArchiveImageMeta = {
  storagePath: '',
  thumbPath: '',
  displayPath: '',
  mime: '',
  width: 0,
  height: 0,
  byteSize: 0,
  thumbWidth: 0,
  thumbHeight: 0,
  thumbByteSize: 0,
  displayWidth: 0,
  displayHeight: 0,
  displayByteSize: 0,
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
  if (value === 'processing' || value === 'ready' || value === 'failed') {
    return value;
  }
  return 'processing';
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

  return {
    ...EMPTY_SOURCE_ARCHIVE_IMAGE,
    storagePath: normalizeText(source.storagePath),
    thumbPath: normalizeText(source.thumbPath),
    displayPath: normalizeText(source.displayPath),
    mime: normalizeText(source.mime),
    width: Number(source.width) || 0,
    height: Number(source.height) || 0,
    byteSize: Number(source.byteSize) || 0,
    thumbWidth: Number(source.thumbWidth) || 0,
    thumbHeight: Number(source.thumbHeight) || 0,
    thumbByteSize: Number(source.thumbByteSize) || 0,
    displayWidth: Number(source.displayWidth) || 0,
    displayHeight: Number(source.displayHeight) || 0,
    displayByteSize: Number(source.displayByteSize) || 0,
    originalName: normalizeText(source.originalName),
    pendingUploadToken: normalizeText(source.pendingUploadToken),
    pendingUploadPath: normalizeText(source.pendingUploadPath),
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
  title: '',
  description: '',
  era: '',
  subject: '',
  unit: '',
  type: 'photo',
  tags: [],
  source: '',
  processingStatus: 'processing',
  processingError: '',
  image: { ...EMPTY_SOURCE_ARCHIVE_IMAGE },
});

export const buildSourceArchiveDraft = (asset?: SourceArchiveAsset): SourceArchiveDraft => {
  if (!asset) return createEmptySourceArchiveDraft();

  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    era: asset.era,
    subject: asset.subject,
    unit: asset.unit,
    type: asset.type,
    tags: [...asset.tags],
    source: asset.source,
    searchText: asset.searchText,
    processingStatus: asset.processingStatus,
    processingError: asset.processingError,
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

  return {
    id,
    title: draftForSearch.title || '\uC774\uB984 \uC5C6\uB294 \uC0AC\uB8CC',
    description: draftForSearch.description,
    era: draftForSearch.era,
    subject: draftForSearch.subject,
    unit: draftForSearch.unit,
    type,
    tags,
    source: draftForSearch.source,
    searchText: normalizeText(source.searchText || buildSourceArchiveSearchText(draftForSearch)).toLowerCase(),
    processingStatus: normalizeProcessingStatus(source.processingStatus),
    processingError: normalizeText(source.processingError),
    image: normalizeSourceArchiveImage(source.image),
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

export const saveSourceArchiveAsset = async (params: {
  draft: SourceArchiveDraft;
  actorUid: string;
  imageUpload?: PreparedSourceArchiveUpload | null;
}) => {
  const normalizedDraft: SourceArchiveDraft = {
    ...createEmptySourceArchiveDraft(),
    ...params.draft,
    id: normalizeText(params.draft.id) || undefined,
    title: normalizeText(params.draft.title),
    description: normalizeText(params.draft.description),
    era: normalizeText(params.draft.era),
    subject: normalizeText(params.draft.subject),
    unit: normalizeText(params.draft.unit),
    type: normalizeSourceArchiveType(params.draft.type),
    tags: normalizeSourceArchiveTags(params.draft.tags),
    source: normalizeText(params.draft.source),
    processingStatus: normalizeProcessingStatus(params.draft.processingStatus),
    processingError: normalizeText(params.draft.processingError),
    image: normalizeSourceArchiveImage(params.draft.image),
  };

  if (!normalizedDraft.title) {
    throw new Error('\uC81C\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.');
  }
  if (!normalizedDraft.era && !normalizedDraft.subject && !normalizedDraft.unit) {
    throw new Error('\uC2DC\uB300, \uC8FC\uC81C, \uB2E8\uC6D0 \uC911 \uD558\uB098 \uC774\uC0C1\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.');
  }

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
    pendingUploadToken: params.imageUpload ? uploadToken : '',
    pendingUploadPath: params.imageUpload ? incomingUploadPath : '',
  };

  if (!params.imageUpload && !nextImage.displayPath && !nextImage.thumbPath) {
    throw new Error('\uC774\uBBF8\uC9C0\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.');
  }

  await setDoc(
    assetRef,
    {
      title: normalizedDraft.title,
      description: normalizedDraft.description,
      era: normalizedDraft.era,
      subject: normalizedDraft.subject,
      unit: normalizedDraft.unit,
      type: normalizedDraft.type,
      tags: normalizedDraft.tags,
      source: normalizedDraft.source,
      searchText: buildSourceArchiveSearchText(normalizedDraft),
      processingStatus: params.imageUpload ? 'processing' : normalizedDraft.processingStatus,
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
    return assetRef.id;
  } catch (error) {
    await setDoc(
      assetRef,
      {
        processingStatus: 'failed',
        processingError: String((error as { message?: string })?.message || 'upload-failed'),
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
