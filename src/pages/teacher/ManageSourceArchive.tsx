import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import StorageImage from '../../components/common/StorageImage';
import { useAuth } from '../../contexts/AuthContext';
import { canReadLessonManagement, canWriteLessonManagement } from '../../lib/permissions';
import {
  SOURCE_ARCHIVE_RENDER_PAGE_SIZE,
  SOURCE_ARCHIVE_STATUS_LABELS,
  SOURCE_ARCHIVE_TYPE_LABELS,
  buildSourceArchiveDraft,
  createEmptySourceArchiveDraft,
  deleteSourceArchiveAsset,
  getSourceArchiveDownloadUrl,
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
type SortOption = 'updatedDesc' | 'titleAsc';

const UI = {
  title: '사료 창고',
  readOnly: '현재 계정은 읽기 전용입니다.',
  noAccess: '이 화면을 볼 수 있는 교사 권한이 없습니다.',
  emptyList: '조건에 맞는 사료가 없습니다.',
  emptyDetail: '선택한 사료가 없습니다.',
  listHint: '업로드 원본을 보존하고, 목록과 상세에는 썸네일과 표시용 이미지를 사용합니다.',
  saveDone: '사료를 저장했습니다.',
  saveProcessing: '사료를 저장했습니다. 업로드 원본을 보존하고 미리보기 자산을 준비하는 중입니다.',
  deleteDone: '사료를 삭제했습니다.',
  loadingError: '사료 창고를 불러오지 못했습니다.',
  previewEmpty: '이미지를 선택하면 미리보기가 표시됩니다.',
  imageUnavailable: '미리보기를 불러올 수 없습니다.',
  processingHelp: '업로드 원본은 저장되었고, 썸네일과 표시용 이미지를 준비하는 중입니다.',
  failedHelp: '미리보기 생성에 실패했습니다. 필요하면 새 이미지를 다시 올려 주세요.',
  legacyHelp: '기존 베타 자료입니다. 현재는 미리보기 자산만 연결되어 있습니다. 새 이미지를 다시 저장하면 정식 구조로 승격됩니다.',
  discardConfirm: '편집 중인 내용이 있습니다. 닫고 계속할까요?',
  originalOpenError: '연결된 파일을 열지 못했습니다.',
};

const STATUS_BADGE_CLASS: Record<SourceArchiveProcessingStatus, string> = {
  uploading: 'bg-sky-100 text-sky-700',
  queued: 'bg-amber-100 text-amber-700',
  processing: 'bg-amber-100 text-amber-700',
  ready: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  archived: 'bg-gray-100 text-gray-600',
};

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'updatedDesc', label: '최근 수정순' },
  { value: 'titleAsc', label: '제목순' },
];

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
  Array.from(new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)));

const getAspectRatio = (asset?: SourceArchiveAsset | null) => {
  const width = Number(asset?.image?.displayWidth || asset?.image?.width || 0);
  const height = Number(asset?.image?.displayHeight || asset?.image?.height || 0);
  return width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3';
};

const getStatusPlaceholderLabel = (status: SourceArchiveProcessingStatus) => {
  if (status === 'uploading') return '업로드 중';
  if (status === 'queued') return '처리 대기';
  if (status === 'processing') return '처리 중';
  if (status === 'failed') return '미리보기 없음';
  if (status === 'archived') return '보관됨';
  return UI.imageUnavailable;
};

const imagePlaceholder = (status: SourceArchiveProcessingStatus, label?: string) => (
  <div className="flex h-full w-full items-center justify-center bg-gray-100 px-4 text-center text-sm font-semibold text-gray-500">
    {label || getStatusPlaceholderLabel(status)}
  </div>
);

const draftSnapshot = (draft: SourceArchiveDraft, tagInput: string) =>
  JSON.stringify({
    title: draft.title.trim(),
    description: draft.description.trim(),
    era: draft.era.trim(),
    subject: draft.subject.trim(),
    unit: draft.unit.trim(),
    type: draft.type,
    source: draft.source.trim(),
    tags: normalizeTagInput(tagInput),
    image: draft.image?.displayPath || '',
  });

const getOriginalFileLabel = (asset: SourceArchiveAsset) => {
  if (asset.file.originalName) return asset.file.originalName;
  const path = asset.file.storagePath || asset.image.originalPath;
  return path ? path.split('/').pop() || '-' : '-';
};

const getOpenAssetLabel = (asset: SourceArchiveAsset) =>
  asset.file.originalAvailable ? '업로드 원본 열기' : '현재 자산 열기';

const getStatusHelp = (asset: SourceArchiveAsset) => {
  if (asset.file.legacyPreviewOnly) return UI.legacyHelp;
  if (asset.processingStatus === 'failed') return UI.failedHelp;
  if (asset.processingStatus === 'uploading' || asset.processingStatus === 'queued' || asset.processingStatus === 'processing') {
    return UI.processingHelp;
  }
  return '';
};

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
  const [sortOption, setSortOption] = useState<SortOption>('updatedDesc');
  const [visibleCount, setVisibleCount] = useState(SOURCE_ARCHIVE_RENDER_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState('');
  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [draft, setDraft] = useState<SourceArchiveDraft>(() => createEmptySourceArchiveDraft());
  const [tagInput, setTagInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [editorBaseline, setEditorBaseline] = useState(() => draftSnapshot(createEmptySourceArchiveDraft(), ''));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openingOriginalId, setOpeningOriginalId] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedId) || null, [assets, selectedId]);

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
    setVisibleCount(SOURCE_ARCHIVE_RENDER_PAGE_SIZE);
  }, [deferredSearchText, sortOption, statusFilter, tagFilter, typeFilter]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const availableTags = useMemo(
    () => Array.from(new Set(assets.flatMap((item) => item.tags))).filter(Boolean).sort((left, right) => left.localeCompare(right, 'ko')),
    [assets],
  );

  const filteredAssets = useMemo(() => {
    const normalizedSearch = deferredSearchText.trim().toLowerCase();
    const nextItems = assets.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (tagFilter !== 'all' && !item.tags.includes(tagFilter)) return false;
      if (statusFilter !== 'all' && item.processingStatus !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return item.searchText.includes(normalizedSearch);
    });
    return sortOption === 'titleAsc'
      ? [...nextItems].sort((left, right) => left.title.localeCompare(right.title, 'ko'))
      : nextItems;
  }, [assets, deferredSearchText, sortOption, statusFilter, tagFilter, typeFilter]);

  const visibleAssets = useMemo(() => filteredAssets.slice(0, visibleCount), [filteredAssets, visibleCount]);

  useEffect(() => {
    if (panelMode !== 'view') return;
    if (!filteredAssets.length) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !filteredAssets.some((item) => item.id === selectedId)) {
      setSelectedId(filteredAssets[0].id);
    }
  }, [filteredAssets, panelMode, selectedId]);

  const isEditorDirty = useMemo(
    () => selectedFile !== null || editorBaseline !== draftSnapshot(draft, tagInput),
    [draft, editorBaseline, selectedFile, tagInput],
  );

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setSelectedFile(null);
  };

  const applyEditorState = (nextDraft: SourceArchiveDraft, nextTagInput: string) => {
    setDraft(nextDraft);
    setTagInput(nextTagInput);
    setEditorBaseline(draftSnapshot(nextDraft, nextTagInput));
  };

  const resetEditor = () => {
    clearPreview();
    applyEditorState(createEmptySourceArchiveDraft(), '');
  };

  const confirmDiscardIfDirty = () => (!isEditorDirty ? true : window.confirm(UI.discardConfirm));

  const openCreate = () => {
    if (!confirmDiscardIfDirty()) return;
    resetEditor();
    setMessage('');
    setErrorMessage('');
    setPanelMode('create');
  };

  const openEdit = (asset: SourceArchiveAsset) => {
    if (!canWrite || !confirmDiscardIfDirty()) return;
    clearPreview();
    const nextDraft = buildSourceArchiveDraft(asset);
    applyEditorState(nextDraft, asset.tags.join(', '));
    setMessage('');
    setErrorMessage('');
    setPanelMode('edit');
  };

  const closeEditor = () => {
    if (!confirmDiscardIfDirty()) return;
    resetEditor();
    setPanelMode('view');
  };

  const handleSelectAsset = (assetId: string) => {
    if (panelMode !== 'view' && !confirmDiscardIfDirty()) return;
    if (panelMode !== 'view') {
      resetEditor();
      setPanelMode('view');
    }
    setSelectedId(assetId);
  };

  const resetFilters = () => {
    setSearchText('');
    setTypeFilter('all');
    setTagFilter('all');
    setStatusFilter('all');
    setSortOption('updatedDesc');
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    clearPreview();
    if (!file) return;
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
        draft: { ...draft, tags: normalizeTagInput(tagInput) },
        actorUid: currentUser.uid,
        imageUpload,
      });
      setSelectedId(assetId);
      resetEditor();
      setPanelMode('view');
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
    if (!window.confirm(`"${asset.title}" 사료를 삭제할까요?`)) return;
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

  const handleOpenOriginal = async (asset: SourceArchiveAsset) => {
    const storagePath = asset.file.storagePath || asset.image.originalPath;
    if (!storagePath) return;
    setOpeningOriginalId(asset.id);
    setErrorMessage('');
    try {
      const downloadUrl = await getSourceArchiveDownloadUrl(storagePath);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open source archive original file:', error);
      setErrorMessage(UI.originalOpenError);
    } finally {
      setOpeningOriginalId('');
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

  const detailHelp = selectedAsset ? getStatusHelp(selectedAsset) : '';
  const showingFilteredResult = filteredAssets.length !== assets.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">{UI.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{UI.listHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            전체 {assets.length}건
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              사료 등록
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-500">검색</span>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="제목, 설명, 태그, 출처 검색"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-500">유형</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as FilterType)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
            >
              <option value="all">전체 유형</option>
              {Object.entries(SOURCE_ARCHIVE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-500">태그</span>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
            >
              <option value="all">전체 태그</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-500">상태</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
            >
              <option value="all">전체 상태</option>
              {Object.entries(SOURCE_ARCHIVE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-500">정렬</span>
            <select
              value={sortOption}
              onChange={(event) => setSortOption(event.target.value as SortOption)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="font-medium text-gray-500">
            {showingFilteredResult
              ? `전체 ${assets.length}건 중 ${filteredAssets.length}건`
              : `현재 ${filteredAssets.length}건`}
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
          >
            필터 초기화
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-gray-900">사료 목록</h2>
            <span className="text-sm text-gray-500">{filteredAssets.length}건</span>
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
                    onClick={() => handleSelectAsset(asset.id)}
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
                          {asset.description || '설명이 없습니다.'}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-gray-500">
                        {[asset.era, asset.subject, asset.unit].filter(Boolean).join(' · ') || '분류 미입력'}
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
                    더 보기
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="self-start rounded-3xl border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
          {panelMode === 'view' && !selectedAsset ? (
            <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-sm text-gray-500">
              {filteredAssets.length === 0 ? UI.emptyList : UI.emptyDetail}
            </div>
          ) : panelMode === 'view' && selectedAsset ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">{selectedAsset.title}</h2>
                  <p className="mt-2 text-sm text-gray-500">
                    등록 {formatTimestamp(selectedAsset.createdAt)} · 수정 {formatTimestamp(selectedAsset.updatedAt)}
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

              {detailHelp && (
                <div className={`rounded-2xl px-4 py-3 text-sm ${
                  selectedAsset.processingStatus === 'failed'
                    ? 'border border-rose-200 bg-rose-50 text-rose-700'
                    : selectedAsset.file.legacyPreviewOnly
                      ? 'border border-blue-200 bg-blue-50 text-blue-700'
                      : 'border border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {detailHelp}
                </div>
              )}

              <div className="grid gap-3 text-sm">
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">분류</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {[selectedAsset.era, selectedAsset.subject, selectedAsset.unit].filter(Boolean).join(' · ') || '미입력'}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">유형 / 출처</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {SOURCE_ARCHIVE_TYPE_LABELS[selectedAsset.type]} / {selectedAsset.source || '미입력'}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">업로드 원본</div>
                  <div className="mt-1 font-semibold text-gray-800">{getOriginalFileLabel(selectedAsset)}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedAsset.file.originalAvailable
                      ? `${Math.round(Number(selectedAsset.file.byteSize || 0) / 1024)} KB · ${selectedAsset.file.width || 0} x ${selectedAsset.file.height || 0}`
                      : '미리보기 자산만 연결됨'}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">상태 기록</div>
                  <div className="mt-1 font-semibold text-gray-800">
                    미리보기 {SOURCE_ARCHIVE_STATUS_LABELS[selectedAsset.processingStatus]}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    마지막 처리 {formatTimestamp(selectedAsset.processedAt)}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">설명</div>
                  <div className="mt-1 whitespace-pre-wrap font-medium text-gray-700">
                    {selectedAsset.description || '설명이 없습니다.'}
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

              <div className="flex flex-wrap gap-2">
                {selectedAsset.file.storagePath && (
                  <button
                    type="button"
                    onClick={() => handleOpenOriginal(selectedAsset)}
                    disabled={openingOriginalId === selectedAsset.id}
                    className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {openingOriginalId === selectedAsset.id ? '파일 여는 중...' : getOpenAssetLabel(selectedAsset)}
                  </button>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => openEdit(selectedAsset)}
                    className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                  >
                    수정
                  </button>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedAsset)}
                    disabled={deleting}
                    className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSave}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">
                    {panelMode === 'edit' ? '사료 수정' : '사료 등록'}
                  </h2>
                  <p className="mt-2 text-sm text-gray-500">
                    업로드 원본을 보존하고, 서버가 썸네일과 표시용 이미지를 정리합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-gray-200 px-3 py-1 text-sm font-semibold text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                >
                  닫기
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
                    fallback={imagePlaceholder('processing', UI.previewEmpty)}
                  />
                ) : imagePlaceholder('processing', UI.previewEmpty)}
              </div>

              <label className="block space-y-1">
                <span className="block text-xs font-semibold text-gray-500">사료 이미지</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="block w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700"
                />
                <span className="block text-xs text-gray-500">
                  새 이미지를 올리면 업로드 원본과 미리보기 자산을 함께 갱신합니다.
                </span>
              </label>

              <label className="block space-y-1">
                <span className="block text-xs font-semibold text-gray-500">제목</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="제목"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-gray-500">유형</span>
                  <select
                    value={draft.type}
                    onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as SourceArchiveAssetType }))}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                  >
                    {Object.entries(SOURCE_ARCHIVE_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-gray-500">출처</span>
                  <input
                    value={draft.source}
                    onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
                    placeholder="출처"
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-gray-500">시대</span>
                  <input
                    value={draft.era}
                    onChange={(event) => setDraft((current) => ({ ...current, era: event.target.value }))}
                    placeholder="시대"
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-gray-500">주제</span>
                  <input
                    value={draft.subject}
                    onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
                    placeholder="주제"
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-gray-500">단원</span>
                  <input
                    value={draft.unit}
                    onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))}
                    placeholder="단원"
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="block text-xs font-semibold text-gray-500">태그</span>
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="태그를 쉼표로 구분해 입력"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs font-semibold text-gray-500">설명</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={5}
                  placeholder="설명"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition focus:border-blue-400"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? '저장 중...' : panelMode === 'edit' ? '수정 저장' : '등록 저장'}
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
                >
                  취소
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
