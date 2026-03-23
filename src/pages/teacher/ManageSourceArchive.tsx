import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import StorageImage from '../../components/common/StorageImage';
import { useAuth } from '../../contexts/AuthContext';
import { canReadLessonManagement, canWriteLessonManagement } from '../../lib/permissions';
import {
  SOURCE_ARCHIVE_RENDER_PAGE_SIZE,
  SOURCE_ARCHIVE_STATUS_LABELS,
  SOURCE_ARCHIVE_TYPE_LABELS,
  buildSourceArchiveDraft,
  buildSourceArchiveSearchText,
  createEmptySourceArchiveDraft,
  deleteSourceArchiveAsset,
  saveSourceArchiveAsset,
  subscribeSourceArchiveAssets,
} from '../../lib/sourceArchive';
import { buildSourceArchiveUpload } from '../../lib/sourceArchiveImage';
import type {
  SourceArchiveAsset,
  SourceArchiveAssetType,
  SourceArchiveDraft,
  SourceArchiveProcessingStatus,
} from '../../types';

type PanelMode = 'view' | 'create' | 'edit';
type FilterType = 'all' | SourceArchiveAssetType;
type FilterStatus = 'all' | SourceArchiveProcessingStatus;

const UI = {
  title: '\uC0AC\uB8CC \uCC3D\uACE0(Beta)',
  readOnly: '\uD604\uC7AC \uACC4\uC815\uC740 \uC77D\uAE30 \uC804\uC6A9\uC785\uB2C8\uB2E4.',
  noAccess: '\uC774 \uD654\uBA74\uC744 \uBCFC \uC218 \uC788\uB294 \uAD50\uC0AC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.',
  emptyList: '\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC0AC\uB8CC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',
  emptyDetail: '\uC544\uC9C1 \uB4F1\uB85D\uB41C \uC0AC\uB8CC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',
  listHint: '\uBAA9\uB85D\uC740 \uC378\uB124\uC77C\uB9CC, \uC0C1\uC138\uB294 \uD45C\uC2DC\uC6A9 \uC774\uBBF8\uC9C0\uB9CC \uC0AC\uC6A9\uD569\uB2C8\uB2E4.',
  saveDone: '\uC0AC\uB8CC\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.',
  saveProcessing: '\uC0AC\uB8CC\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4. \uC774\uBBF8\uC9C0 \uCC98\uB9AC \uC911 \uC0C1\uD0DC\uAC00 \uC7A0\uC2DC \uBCF4\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
  deleteDone: '\uC0AC\uB8CC\uB97C \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.',
  loadingError: '\uC0AC\uB8CC \uCC3D\uACE0(Beta)\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.',
  processing: '\uC774\uBBF8\uC9C0 \uCC98\uB9AC \uC911',
  imageUnavailable: '\uC774\uBBF8\uC9C0\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC74C',
  processingHelp: '\uC5C5\uB85C\uB4DC\uD55C \uC774\uBBF8\uC9C0\uB97C \uC555\uCD95\uD558\uACE0 \uD45C\uC2DC\uC6A9 \uC774\uBBF8\uC9C0\uB97C \uC900\uBE44\uD558\uB294 \uC911\uC785\uB2C8\uB2E4.',
  failedHelp: '\uC774\uBBF8\uC9C0 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC218\uC815\uD574 \uC8FC\uC138\uC694.',
};

const STATUS_BADGE_CLASS: Record<SourceArchiveProcessingStatus, string> = {
  processing: 'bg-amber-100 text-amber-700',
  ready: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
};

const formatTimestamp = (value: unknown) => {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'object' && value !== null && 'seconds' in value
        ? new Date(Number((value as { seconds?: number }).seconds || 0) * 1000)
        : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const normalizeTagInput = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const getAspectRatio = (asset?: SourceArchiveAsset | null) => {
  const width = Number(asset?.image?.displayWidth || asset?.image?.width || 0);
  const height = Number(asset?.image?.displayHeight || asset?.image?.height || 0);
  return width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3';
};

const imagePlaceholder = (status: SourceArchiveProcessingStatus) => (
  <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm font-semibold text-gray-500">
    {status === 'processing' ? UI.processing : UI.imageUnavailable}
  </div>
);

const ManageSourceArchive: React.FC = () => {
  const { currentUser, userData } = useAuth();
  const canRead = canReadLessonManagement(userData, currentUser?.email || '');
  const canWrite = canWriteLessonManagement(userData, currentUser?.email || '');

  const [assets, setAssets] = useState<SourceArchiveAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [visibleCount, setVisibleCount] = useState(SOURCE_ARCHIVE_RENDER_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState('');
  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [draft, setDraft] = useState<SourceArchiveDraft>(() => createEmptySourceArchiveDraft());
  const [tagInput, setTagInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deferredSearchText = useDeferredValue(searchText);
  const selectedAsset = useMemo(
    () => assets.find((item) => item.id === selectedId) || null,
    [assets, selectedId],
  );

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    const unsubscribe = subscribeSourceArchiveAssets(
      (items) => {
        setAssets(items);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to subscribe source archive assets:', error);
        setErrorMessage(UI.loadingError);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [canRead]);

  useEffect(() => {
    if (panelMode === 'create') return;
    if (!assets.length) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !assets.some((item) => item.id === selectedId)) {
      setSelectedId(assets[0].id);
    }
  }, [assets, panelMode, selectedId]);

  useEffect(() => {
    setVisibleCount(SOURCE_ARCHIVE_RENDER_PAGE_SIZE);
  }, [deferredSearchText, statusFilter, tagFilter, typeFilter]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(assets.flatMap((item) => item.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, 'ko')),
    [assets],
  );

  const filteredAssets = useMemo(() => {
    const normalizedSearch = deferredSearchText.trim().toLowerCase();
    return assets.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (tagFilter !== 'all' && !item.tags.includes(tagFilter)) return false;
      if (statusFilter !== 'all' && item.processingStatus !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return buildSourceArchiveSearchText(item).includes(normalizedSearch);
    });
  }, [assets, deferredSearchText, statusFilter, tagFilter, typeFilter]);

  const visibleAssets = useMemo(
    () => filteredAssets.slice(0, visibleCount),
    [filteredAssets, visibleCount],
  );

  const resetEditor = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setSelectedFile(null);
    setDraft(createEmptySourceArchiveDraft());
    setTagInput('');
  };

  const openCreate = () => {
    resetEditor();
    setMessage('');
    setErrorMessage('');
    setPanelMode('create');
  };

  const openEdit = (asset: SourceArchiveAsset) => {
    if (!canWrite) return;
    resetEditor();
    setDraft(buildSourceArchiveDraft(asset));
    setTagInput(asset.tags.join(', '));
    setMessage('');
    setErrorMessage('');
    setPanelMode('edit');
  };

  const closeEditor = () => {
    resetEditor();
    setPanelMode('view');
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl('');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite || !currentUser?.uid) return;

    setSaving(true);
    setMessage('');
    setErrorMessage('');

    try {
      const imageUpload = selectedFile ? await buildSourceArchiveUpload(selectedFile) : null;
      const assetId = await saveSourceArchiveAsset({
        draft: {
          ...draft,
          tags: normalizeTagInput(tagInput),
        },
        actorUid: currentUser.uid,
        imageUpload,
      });
      setSelectedId(assetId);
      closeEditor();
      setMessage(imageUpload ? UI.saveProcessing : UI.saveDone);
    } catch (error) {
      console.error('Failed to save source archive asset:', error);
      setErrorMessage(String((error as { message?: string })?.message || UI.loadingError));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (asset: SourceArchiveAsset) => {
    if (!canWrite) return;
    if (!window.confirm(`"${asset.title}" \uC0AC\uB8CC\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`)) {
      return;
    }

    setDeleting(true);
    setMessage('');
    setErrorMessage('');

    try {
      await deleteSourceArchiveAsset(asset.id);
      if (selectedId === asset.id) setSelectedId('');
      setMessage(UI.deleteDone);
    } catch (error) {
      console.error('Failed to delete source archive asset:', error);
      setErrorMessage(String((error as { message?: string })?.message || UI.loadingError));
    } finally {
      setDeleting(false);
    }
  };

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
          <h1 className="text-2xl font-extrabold">{UI.title}</h1>
          <p className="mt-2 text-sm">{UI.noAccess}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">{UI.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{UI.listHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            {'\uC804\uCCB4'} {assets.length}\uAC74
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              {'\uC0AC\uB8CC \uB4F1\uB85D'}
            </button>
          )}
        </div>
      </div>

      {!canWrite && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {UI.readOnly}
        </div>
      )}

      {(message || errorMessage) && (
        <div className={`mt-4 rounded-2xl px-4 py-3 text-sm font-medium ${
          errorMessage
            ? 'border border-rose-200 bg-rose-50 text-rose-700'
            : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {errorMessage || message}
        </div>
      )}

      <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={'\uC81C\uBAA9, \uC124\uBA85, \uD0DC\uADF8, \uCD9C\uCC98 \uAC80\uC0C9'}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as FilterType)}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
          >
            <option value="all">{'\uC804\uCCB4 \uC720\uD615'}</option>
            {Object.entries(SOURCE_ARCHIVE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
          >
            <option value="all">{'\uC804\uCCB4 \uD0DC\uADF8'}</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
          >
            <option value="all">{'\uC804\uCCB4 \uC0C1\uD0DC'}</option>
            {Object.entries(SOURCE_ARCHIVE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-gray-900">{'\uC0AC\uB8CC \uBAA9\uB85D'}</h2>
            <span className="text-sm text-gray-500">{filteredAssets.length}\uAC74</span>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-3xl border border-gray-200">
                  <div className="aspect-[4/3] animate-pulse bg-gray-100" />
                  <div className="space-y-2 p-4">
                    <div className="h-5 animate-pulse rounded bg-gray-100" />
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-sm text-gray-500">
              {UI.emptyList}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(asset.id);
                      if (panelMode !== 'view') closeEditor();
                    }}
                    className={`overflow-hidden rounded-3xl border text-left transition ${
                      selectedId === asset.id && panelMode === 'view'
                        ? 'border-blue-400 shadow-lg shadow-blue-100'
                        : 'border-gray-200 hover:border-blue-200 hover:shadow-md'
                    }`}
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-gray-100">
                      {asset.processingStatus === 'ready' && asset.image.thumbPath ? (
                        <StorageImage
                          path={asset.image.thumbPath}
                          alt={asset.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                          width={asset.image.thumbWidth || undefined}
                          height={asset.image.thumbHeight || undefined}
                          fallback={imagePlaceholder(asset.processingStatus)}
                        />
                      ) : imagePlaceholder(asset.processingStatus)}
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[asset.processingStatus]}`}>
                          {SOURCE_ARCHIVE_STATUS_LABELS[asset.processingStatus]}
                        </span>
                        <span className="text-xs font-semibold text-gray-500">{SOURCE_ARCHIVE_TYPE_LABELS[asset.type]}</span>
                      </div>
                      <div>
                        <h3 className="line-clamp-2 text-base font-extrabold text-gray-900">{asset.title}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                          {asset.description || '\uC124\uBA85\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-gray-500">
                        {[asset.era, asset.subject, asset.unit].filter(Boolean).join(' \u00B7 ') || '\uBD84\uB958 \uBBF8\uC785\uB825'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {visibleAssets.length < filteredAssets.length && (
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((current) => current + SOURCE_ARCHIVE_RENDER_PAGE_SIZE)}
                    className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                  >
                    {'\uB354 \uBCF4\uAE30'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="self-start rounded-3xl border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
          {panelMode === 'view' && !selectedAsset ? (
            <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-sm text-gray-500">
              {UI.emptyDetail}
            </div>
          ) : panelMode === 'view' && selectedAsset ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">{selectedAsset.title}</h2>
                  <p className="mt-2 text-sm text-gray-500">
                    {'\uC218\uC815\uC77C'} {formatTimestamp(selectedAsset.updatedAt)}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[selectedAsset.processingStatus]}`}>
                  {SOURCE_ARCHIVE_STATUS_LABELS[selectedAsset.processingStatus]}
                </span>
              </div>

              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-gray-100" style={{ aspectRatio: getAspectRatio(selectedAsset) }}>
                {selectedAsset.processingStatus === 'ready' && selectedAsset.image.displayPath ? (
                  <StorageImage
                    path={selectedAsset.image.displayPath}
                    alt={selectedAsset.title}
                    loading="eager"
                    className="h-full w-full object-contain"
                    width={selectedAsset.image.displayWidth || selectedAsset.image.width || undefined}
                    height={selectedAsset.image.displayHeight || selectedAsset.image.height || undefined}
                    fallback={imagePlaceholder(selectedAsset.processingStatus)}
                  />
                ) : imagePlaceholder(selectedAsset.processingStatus)}
              </div>

              {selectedAsset.processingStatus === 'failed' && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {selectedAsset.processingError || UI.failedHelp}
                </div>
              )}

              {selectedAsset.processingStatus === 'processing' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {UI.processingHelp}
                </div>
              )}

              <div className="grid gap-3 text-sm">
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{'\uBD84\uB958'}</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {[selectedAsset.era, selectedAsset.subject, selectedAsset.unit].filter(Boolean).join(' \u00B7 ') || '\uBBF8\uC785\uB825'}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{'\uC720\uD615 / \uCD9C\uCC98'}</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {SOURCE_ARCHIVE_TYPE_LABELS[selectedAsset.type]} / {selectedAsset.source || '\uBBF8\uC785\uB825'}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{'\uD45C\uC2DC\uC6A9 \uC774\uBBF8\uC9C0'}</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {selectedAsset.image.displayWidth || selectedAsset.image.width} x {selectedAsset.image.displayHeight || selectedAsset.image.height}
                    {' / '}
                    {Math.round(Number(selectedAsset.image.displayByteSize || selectedAsset.image.byteSize || 0) / 1024)} KB
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{'\uC124\uBA85'}</div>
                  <div className="mt-1 whitespace-pre-wrap font-medium text-gray-700">
                    {selectedAsset.description || '\uC124\uBA85\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                  </div>
                </div>
              </div>

              {selectedAsset.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedAsset.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(selectedAsset)}
                    className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                  >
                    {'\uC218\uC815'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedAsset)}
                    disabled={deleting}
                    className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {'\uC0AD\uC81C'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSave}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">
                    {panelMode === 'edit' ? '\uC0AC\uB8CC \uC218\uC815' : '\uC0AC\uB8CC \uB4F1\uB85D'}
                  </h2>
                  <p className="mt-2 text-sm text-gray-500">
                    {'\uD074\uB77C\uC774\uC5B8\uD2B8\uC5D0\uC11C 1\uCC28 \uC555\uCD95\uD558\uACE0 \uC11C\uBC84\uAC00 \uC378\uB124\uC77C\uACFC \uD45C\uC2DC\uC6A9 \uC774\uBBF8\uC9C0\uB97C \uC815\uB9AC\uD569\uB2C8\uB2E4.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-gray-200 px-3 py-1 text-sm font-semibold text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                >
                  {'\uB2EB\uAE30'}
                </button>
              </div>

              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-gray-100" style={{ aspectRatio: '4 / 3' }}>
                {previewUrl ? (
                  <img src={previewUrl} alt={UI.title} className="h-full w-full object-contain" />
                ) : draft.image?.displayPath ? (
                  <StorageImage
                    path={draft.image.displayPath}
                    alt={draft.title || UI.title}
                    loading="eager"
                    className="h-full w-full object-contain"
                    fallback={imagePlaceholder('processing')}
                  />
                ) : imagePlaceholder('processing')}
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700"
              />
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={'\uC81C\uBAA9'}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={draft.type}
                  onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as SourceArchiveAssetType }))}
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                >
                  {Object.entries(SOURCE_ARCHIVE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input
                  value={draft.source}
                  onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
                  placeholder={'\uCD9C\uCC98'}
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <input
                  value={draft.era}
                  onChange={(event) => setDraft((current) => ({ ...current, era: event.target.value }))}
                  placeholder={'\uC2DC\uB300'}
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
                <input
                  value={draft.subject}
                  onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
                  placeholder={'\uC8FC\uC81C'}
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
                <input
                  value={draft.unit}
                  onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))}
                  placeholder={'\uB2E8\uC6D0'}
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
              </div>

              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder={'\uD0DC\uADF8\uB97C \uC27C\uD45C\uB85C \uAD6C\uBD84\uD574 \uC785\uB825'}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
              />
              <textarea
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                rows={5}
                placeholder={'\uC124\uBA85'}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? '\uC800\uC7A5 \uC911...'
                    : panelMode === 'edit'
                      ? '\uC218\uC815 \uC800\uC7A5'
                      : '\uB4F1\uB85D \uC800\uC7A5'}
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
                >
                  {'\uCDE8\uC18C'}
                </button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
};

export default ManageSourceArchive;
