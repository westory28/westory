import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { InlineLoading } from "../../components/common/LoadingState";
import StatePanel from "../../components/common/StatePanel";
import MapSidebar from "../../components/common/MapSidebar";
import MapViewer from "../../components/common/MapViewer";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import {
  DEFAULT_GOOGLE_MAP_RESOURCE,
  DEFAULT_PDF_TAG_SECTIONS,
  GOOGLE_MAP_RESOURCE_ID,
  getPdfSectionTagOptions,
  groupMapResourcesForDisplay,
  mergeMapResources,
  normalizeMapResource,
  type MapResource,
  type MapResourceType,
  type PdfMapPageImage,
  type PdfMapRegion,
  type PdfTagSection,
} from "../../lib/mapResources";
import type { ProcessedPdfMap } from "../../lib/pdfMapProcessor";
import { getSemesterCollectionPath } from "../../lib/semesterScope";
import { canWriteLessonManagement } from "../../lib/permissions";
import {
  deleteMapResource,
  fingerprintMapSource,
  getAttachedMapUploadIds,
  mapEditorRecovery,
  saveMapResources,
  toMapDocument,
  uploadMapAsset,
  type MapSource,
  type MapSavedSource,
  type RetainedMapAsset,
} from "../../lib/mapManagement";

type StorageScope = "semester" | "legacy";

type StoredMapResource = MapResource & {
  storageScope?: StorageScope;
  sourceExists?: boolean;
  sourceHash?: string;
};

interface PendingPdfUpload {
  id: string;
  file: File;
  processed: ProcessedPdfMap;
  pageImages: PdfMapPageImage[];
  regions: PdfMapRegion[];
}
interface EditorRecoverySnapshot {
  items: StoredMapResource[];
  draft: StoredMapResource;
  selectedFile: File | null;
  pendingPdfUploads: PendingPdfUpload[];
  sources: Array<[string, MapSource]>;
  pendingAssets: Array<[string, RetainedMapAsset[]]>;
  pendingCommit: StoredMapResource[] | null;
}

const PdfMapViewer = lazyWithRetry(
  () => import("../../components/common/PdfMapViewer"),
  "manage-maps-pdf-map-viewer",
);

const createDraft = (): StoredMapResource => ({
  id: "",
  title: "",
  category: "",
  tabGroup: "",
  description: "",
  type: "pdf",
  imageUrl: "",
  fileUrl: "",
  storagePath: "",
  fileName: "",
  mimeType: "",
  embedUrl: "",
  googleQuery: "",
  externalUrl: "",
  pdfPageImages: [],
  pdfRegions: [],
  pdfTagSections: DEFAULT_PDF_TAG_SECTIONS.map((section) => ({
    ...section,
    tags: [...section.tags],
  })),
  sortOrder: 99,
  storageScope: "semester",
});

const normalizeRegionTags = (tags: string[]) =>
  Array.from(
    new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "ko"));

const clonePdfTagSections = (sections: PdfTagSection[]) =>
  sections.map((section) => ({
    ...section,
    tags: [...section.tags],
  }));

const fileNameWithoutExtension = (value: string) =>
  value.replace(/\.[^.]+$/u, "").trim();

const getPreferredMapGroup = <
  T extends { key: string; title: string; items: Array<{ id: string }> },
>(
  groups: T[],
) =>
  groups.find((group) => group.title.includes("한국사")) || groups[0] || null;

const normalizeErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code || "")
      : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: string }).message || "")
      : "";

  if (code) return `${code}${message ? `: ${message}` : ""}`;
  return message || "unknown-error";
};

const requestLocalPdfFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };

    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] || null);
      },
      { once: true },
    );

    input.addEventListener(
      "cancel",
      () => {
        finish(null);
      },
      { once: true },
    );

    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (!settled && !input.files?.length) {
            finish(null);
          }
        }, 1500);
      },
      { once: true },
    );

    input.click();
  });

const ManageMaps: React.FC = () => {
  const { config, userData, currentUser } = useAuth();
  const [items, setItems] = useState<StoredMapResource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<StoredMapResource>(createDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isTabRenameOpen, setIsTabRenameOpen] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreviewUrl, setSelectedFilePreviewUrl] = useState("");
  const [pendingPdfUploads, setPendingPdfUploads] = useState<
    PendingPdfUpload[]
  >([]);
  const [activePendingPdfId, setActivePendingPdfId] = useState("");
  const [isPdfShortcutExpanded, setIsPdfShortcutExpanded] = useState(false);
  const [isPreparingPdfUploads, setIsPreparingPdfUploads] = useState(false);
  const [sectionTagInputs, setSectionTagInputs] = useState<
    Record<string, string>
  >({});
  const [tabRenameSourceKey, setTabRenameSourceKey] = useState("");
  const [tabRenameValue, setTabRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mutationFlight = useRef(false);
  const sources = useRef(new Map<string, MapSource>());
  const pendingAssets = useRef(new Map<string, RetainedMapAsset[]>());
  const uploadOwner = useRef("");
  const pendingCommit = useRef<StoredMapResource[] | null>(null);
  const restoredDraft = useRef(false);
  const mutationSucceeded = useRef(false);
  const activeRecovery = useRef<ReturnType<typeof mapEditorRecovery.get>>();
  const recoveryKey = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}`;
  const canEdit = canWriteLessonManagement(userData, currentUser?.email || "");

  const collectionPath = useMemo(
    () => getSemesterCollectionPath(config, "map_resources"),
    [config],
  );
  const legacyCollectionPath = "map_resources";

  const revokePendingPdfUploadResources = (uploads: PendingPdfUpload[]) => {
    uploads.forEach((upload) => {
      upload.pageImages.forEach((page) => {
        if (page.imageUrl.startsWith("blob:")) {
          URL.revokeObjectURL(page.imageUrl);
        }
      });
    });
  };

  const resetFileInput = () => {
    setSelectedFile(null);
    setSelectedFilePreviewUrl("");
    setActivePendingPdfId("");
    setPendingPdfUploads((prev) => {
      revokePendingPdfUploadResources(prev);
      return [];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const loadFromScope = async (
    scope: StorageScope,
  ): Promise<StoredMapResource[]> => {
    const path = scope === "semester" ? collectionPath : legacyCollectionPath;
    const snapshot = await getDocs(
      query(collection(db, path), orderBy("sortOrder", "asc")),
    );

    return Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const sourceHash = await fingerprintMapSource(docSnap.data());
        const item = {
          ...normalizeMapResource(docSnap.id, docSnap.data()),
          storageScope: scope,
          sourceExists: true,
          sourceHash,
        };
        return item;
      }),
    );
  };

  useEffect(() => {
    let cancelled = false;
    const loadMaps = async () => {
      setLoading(true);
      const recovery = mapEditorRecovery.get(recoveryKey);
      if (recovery?.pending) await recovery.settled;
      if (cancelled) return;
      if (recovery && !recovery.succeeded) {
        const snapshot = recovery.snapshot as EditorRecoverySnapshot;
        sources.current = new Map(snapshot.sources);
        pendingAssets.current = new Map(snapshot.pendingAssets);
        pendingCommit.current = snapshot.pendingCommit;
        const uploads = snapshot.pendingPdfUploads.map((upload) => ({
          ...upload,
          pageImages: upload.processed.pageImages.map((page) => ({
            page: page.page,
            imageUrl: URL.createObjectURL(page.blob),
            width: page.width,
            height: page.height,
          })),
        }));
        const upload = uploads.find(
          (item) => item.file.name === snapshot.selectedFile?.name,
        );
        restoredDraft.current = true;
        setItems(snapshot.items);
        setSelectedId(snapshot.draft.id);
        setDraft({
          ...snapshot.draft,
          ...(upload ? { pdfPageImages: upload.pageImages } : {}),
        });
        setSelectedFile(snapshot.selectedFile);
        setPendingPdfUploads(uploads);
        setIsSettingsOpen(true);
        setLoading(false);
        mapEditorRecovery.delete(recoveryKey);
        return;
      }
      if (recovery) mapEditorRecovery.delete(recoveryKey);
      sources.current.clear();
      pendingAssets.current.clear();

      try {
        let resourceList = await loadFromScope("semester");
        if (cancelled) return;
        if (resourceList.length === 0) {
          resourceList = await loadFromScope("legacy");
        }
        if (cancelled) return;
        sources.current = new Map(
          resourceList.map((item) => [
            item.id,
            {
              mapId: item.id,
              originScope: item.storageScope || "semester",
              expectedRevision: item.contentRevision || 0,
              sourceExists: true,
              sourceHash: item.sourceHash!,
            },
          ]),
        );

        const baseScope: StorageScope =
          resourceList[0]?.storageScope || "semester";
        const merged = mergeMapResources(resourceList).map((item) => {
          const existing = resourceList.find(
            (resource) => resource.id === item.id,
          );
          return {
            ...item,
            storageScope: existing?.storageScope || baseScope,
          };
        });
        const firstGroup = getPreferredMapGroup(
          groupMapResourcesForDisplay(merged),
        );
        const initial = firstGroup?.items[0] ||
          merged[0] || {
            ...DEFAULT_GOOGLE_MAP_RESOURCE,
            storageScope: baseScope,
          };
        setItems(merged);
        setSelectedId(initial.id);
        setDraft(initial);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load teacher map resources:", error);
        const fallback = [
          { ...DEFAULT_GOOGLE_MAP_RESOURCE, storageScope: "semester" as const },
        ];
        const firstGroup = getPreferredMapGroup(
          groupMapResourcesForDisplay(fallback),
        );
        const initial = firstGroup?.items[0] || fallback[0];
        setItems(fallback);
        setSelectedId(initial.id);
        setDraft(initial);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadMaps();
    return () => {
      cancelled = true;
    };
  }, [collectionPath, recoveryKey]);

  useEffect(() => {
    if (restoredDraft.current) {
      restoredDraft.current = false;
      return;
    }
    const next = items.find((item) => item.id === selectedId);
    if (!next) return;

    setDraft(next);
    setSectionTagInputs({});
    setIsPdfShortcutExpanded(false);
    resetFileInput();
  }, [items, selectedId]);

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFilePreviewUrl("");
      return;
    }

    const previewUrl = URL.createObjectURL(selectedFile);
    setSelectedFilePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedFile]);

  useEffect(
    () => () => {
      revokePendingPdfUploadResources(pendingPdfUploads);
    },
    [pendingPdfUploads],
  );

  const handleDraftChange = (
    field: keyof MapResource,
    value: string | number,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePdfRegionLabelChange = (index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) =>
        regionIndex === index ? { ...region, label: value.trim() } : region,
      ),
    }));
  };

  const handlePdfRegionShortcutToggle = (index: number, checked: boolean) => {
    setDraft((prev) => ({
      ...prev,
      pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) =>
        regionIndex === index
          ? { ...region, shortcutEnabled: checked }
          : region,
      ),
    }));
  };

  const updatePdfRegion = (
    index: number,
    updater: (region: PdfMapRegion) => PdfMapRegion,
  ) => {
    setDraft((prev) => ({
      ...prev,
      pdfRegions: (prev.pdfRegions || []).map((region, regionIndex) =>
        regionIndex === index ? updater(region) : region,
      ),
    }));
  };

  const handlePdfRegionTagToggle = (
    index: number,
    tag: string,
    checked: boolean,
  ) => {
    updatePdfRegion(index, (region) => {
      const currentTags = normalizeRegionTags(region.tags || []);
      const nextTags = checked
        ? normalizeRegionTags([...currentTags, tag])
        : currentTags.filter((item) => item !== tag);
      return { ...region, tags: nextTags };
    });
  };

  const handleRenamePdfTagSection = (sectionId: string) => {
    const current = (draft.pdfTagSections || []).find(
      (section) => section.id === sectionId,
    );
    if (!current) return;
    const nextLabel = window.prompt("태그 범주 이름", current.label)?.trim();
    if (!nextLabel || nextLabel === current.label) return;

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(prev.pdfTagSections || []).map(
        (section) =>
          section.id === sectionId ? { ...section, label: nextLabel } : section,
      ),
    }));
  };

  const handleAddPdfTagSection = () => {
    const nextLabel = window.prompt("새 태그 범주 이름")?.trim();
    if (!nextLabel) return;

    setDraft((prev) => {
      const existing = clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      );
      const nextIdBase =
        nextLabel
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-_]/g, "") || `custom-${existing.length + 1}`;
      let nextId = nextIdBase;
      let suffix = 2;
      while (existing.some((section) => section.id === nextId)) {
        nextId = `${nextIdBase}-${suffix}`;
        suffix += 1;
      }
      return {
        ...prev,
        pdfTagSections: [
          ...existing,
          { id: nextId, label: nextLabel, tags: [] },
        ],
      };
    });
  };

  const handleSectionTagInputChange = (sectionId: string, value: string) => {
    setSectionTagInputs((prev) => ({
      ...prev,
      [sectionId]: value,
    }));
  };

  const handleDeletePdfTagSection = (sectionId: string) => {
    const sections = clonePdfTagSections(
      draft.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
    );
    const target = sections.find((section) => section.id === sectionId);
    if (!target || sections.length <= 1) return;
    if (
      !window.confirm(
        `'${target.label}' 범주를 삭제하시겠습니까? 포함된 태그는 다른 범주로 이동합니다.`,
      )
    ) {
      return;
    }

    const fallbackSection = sections.find(
      (section) => section.id !== sectionId,
    );
    if (!fallbackSection) return;

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      )
        .filter((section) => section.id !== sectionId)
        .map((section) =>
          section.id === fallbackSection.id
            ? {
                ...section,
                tags: normalizeRegionTags([
                  ...(section.tags || []),
                  ...(target.tags || []),
                ]),
              }
            : section,
        ),
    }));
  };

  const handleAddSectionTag = (sectionId: string) => {
    const nextTag = String(sectionTagInputs[sectionId] || "").trim();
    if (!nextTag) return;

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      ).map((section) =>
        section.id === sectionId
          ? {
              ...section,
              tags: normalizeRegionTags([...(section.tags || []), nextTag]),
            }
          : section,
      ),
    }));
    setSectionTagInputs((prev) => ({
      ...prev,
      [sectionId]: "",
    }));
  };

  const handleRenameSectionTag = (sectionId: string, tag: string) => {
    const nextTag = window.prompt("태그 이름 수정", tag)?.trim();
    if (!nextTag || nextTag === tag) return;

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      ).map((section) =>
        section.id === sectionId
          ? {
              ...section,
              tags: normalizeRegionTags(
                section.tags.map((item) => (item === tag ? nextTag : item)),
              ),
            }
          : section,
      ),
      pdfRegions: (prev.pdfRegions || []).map((region) => ({
        ...region,
        tags: normalizeRegionTags(
          (region.tags || []).map((item) => (item === tag ? nextTag : item)),
        ),
      })),
    }));
  };

  const handleMoveSectionTag = (
    sourceSectionId: string,
    tag: string,
    targetSectionId: string,
  ) => {
    const normalizedTargetSectionId = String(targetSectionId || "").trim();
    if (
      !normalizedTargetSectionId ||
      normalizedTargetSectionId === sourceSectionId
    )
      return;

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      ).map((section) => {
        if (section.id === sourceSectionId) {
          return {
            ...section,
            tags: section.tags.filter((item) => item !== tag),
          };
        }
        if (section.id === normalizedTargetSectionId) {
          return {
            ...section,
            tags: normalizeRegionTags([...(section.tags || []), tag]),
          };
        }
        return section;
      }),
    }));
  };

  const handleDeleteSectionTag = (sectionId: string, tag: string) => {
    if (
      !window.confirm(
        `'${tag}' 태그를 삭제하시겠습니까? 이 태그는 지역 태그 지정에서도 함께 제거됩니다.`,
      )
    ) {
      return;
    }

    setDraft((prev) => ({
      ...prev,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      ).map((section) =>
        section.id === sectionId
          ? { ...section, tags: section.tags.filter((item) => item !== tag) }
          : section,
      ),
      pdfRegions: (prev.pdfRegions || []).map((region) => ({
        ...region,
        tags: (region.tags || []).filter((item) => item !== tag),
      })),
    }));
  };

  const handleOpenTagManager = (itemId: string) => {
    const target = items.find((item) => item.id === itemId);
    if (!target || target.type !== "pdf") return;
    setSelectedId(itemId);
    setDraft(target);
    setSectionTagInputs({});
    setIsTagManagerOpen(true);
  };

  const buildPendingPdfUpload = async (
    file: File,
  ): Promise<PendingPdfUpload> => {
    const { processPdfMapFile } = await import("../../lib/pdfMapProcessor");
    const processed = await processPdfMapFile(file);
    return {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      processed,
      pageImages: processed.pageImages.map((page) => ({
        page: page.page,
        imageUrl: URL.createObjectURL(page.blob),
        width: page.width,
        height: page.height,
      })),
      regions: processed.regions,
    };
  };

  const applyPendingPdfUpload = (upload: PendingPdfUpload) => {
    setActivePendingPdfId(upload.id);
    setSelectedFile(upload.file);
    setSectionTagInputs({});
    setIsPdfShortcutExpanded(false);
    setDraft((prev) => ({
      ...prev,
      fileName: upload.file.name,
      mimeType: upload.file.type || "application/pdf",
      pdfPageImages: upload.pageImages,
      pdfRegions: upload.regions,
      pdfTagSections: clonePdfTagSections(
        prev.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS,
      ),
      title:
        prev.id || prev.title
          ? prev.title
          : fileNameWithoutExtension(upload.file.name),
    }));
  };

  const handlePendingPdfUploadSelect = (uploadId: string) => {
    const next = pendingPdfUploads.find((upload) => upload.id === uploadId);
    if (!next) return;
    applyPendingPdfUpload(next);
  };

  const handlePendingPdfUploadRemove = (uploadId: string) => {
    setPendingPdfUploads((prev) => {
      const nextUploads = prev.filter((upload) => upload.id !== uploadId);
      const removed = prev.find((upload) => upload.id === uploadId);
      if (removed) {
        revokePendingPdfUploadResources([removed]);
      }

      if (activePendingPdfId === uploadId) {
        const fallback = nextUploads[0];
        if (fallback) {
          applyPendingPdfUpload(fallback);
        } else {
          setActivePendingPdfId("");
          setSelectedFile(null);
          setSectionTagInputs({});
          setDraft((current) => ({
            ...current,
            fileName: "",
            mimeType: "",
            pdfPageImages: [],
            pdfRegions: [],
          }));
        }
      }

      return nextUploads;
    });
  };

  const handleFileInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    if (draft.type !== "pdf") {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(files[0].type) ||
        files[0].size > 6 * 1024 * 1024
      ) {
        alert("이미지는 PNG, JPEG, WebP 형식의 6MB 이하 파일을 선택해 주세요.");
        return;
      }
      setSelectedFile(files[0] || null);
      return;
    }
    if (files.some((file) => file.size > 20 * 1024 * 1024)) {
      alert("PDF는 파일당 20MB 이하여야 합니다.");
      return;
    }

    setIsPreparingPdfUploads(true);
    try {
      const uploads: PendingPdfUpload[] = [];
      for (const file of files) {
        uploads.push(await buildPendingPdfUpload(file));
      }

      setPendingPdfUploads((prev) => {
        revokePendingPdfUploadResources(prev);
        return uploads;
      });

      if (uploads[0]) {
        applyPendingPdfUpload(uploads[0]);
      }
    } catch (error) {
      console.error("Failed to prepare local PDF previews:", error);
      alert(
        `PDF 미리보기를 준비하지 못했습니다.\n${normalizeErrorMessage(error)}`,
      );
    } finally {
      setIsPreparingPdfUploads(false);
    }
  };

  const handleCreateNew = () => {
    if (mutationFlight.current || pendingCommit.current) return;
    mapEditorRecovery.delete(recoveryKey);
    setSelectedId("");
    resetFileInput();
    setDraft({
      ...createDraft(),
      storageScope: items[0]?.storageScope || "semester",
    });
    setIsSettingsOpen(true);
  };

  const handleOpenSettings = (itemId: string) => {
    if (mutationFlight.current) return;
    if (!pendingCommit.current) mapEditorRecovery.delete(recoveryKey);
    if (!loading) {
      setSelectedId(itemId);
    }
    setIsSettingsOpen(true);
  };

  const handleSaveTagManager = async () => {
    if (!canEdit || draft.type !== "pdf" || !draft.id || !beginMutation())
      return;

    setSaving(true);
    try {
      const payload = normalizeMapResource(draft.id, draft);
      await persistMapPayload(payload, draft.storageScope || "semester");
      setIsTagManagerOpen(false);
    } catch (error) {
      console.error("Failed to save tag settings:", error);
      alert(`태그 설정 저장에 실패했습니다.\n${normalizeErrorMessage(error)}`);
    } finally {
      finishMutation();
    }
  };

  const handleOpenTabRename = (groupKey: string) => {
    const targetGroup = displayGroupMap.get(groupKey);
    setTabRenameSourceKey(groupKey);
    setTabRenameValue(targetGroup?.title || "");
    setIsTabRenameOpen(true);
  };

  const sourceFor = (id: string, scope: StorageScope): MapSource =>
    sources.current.get(id) || {
      mapId: id,
      originScope: scope,
      expectedRevision: 0,
      sourceExists: false,
      sourceHash: "",
    };

  const rememberSaved = (rows: MapSavedSource[]) => {
    for (const row of rows) {
      sources.current.set(row.mapId, {
        mapId: row.mapId,
        originScope: row.originScope,
        expectedRevision: row.contentRevision,
        sourceExists: true,
        sourceHash: row.sourceHash,
      });
      pendingAssets.current.delete(row.mapId);
    }
  };

  const persistBatch = async (resources: StoredMapResource[]) => {
    const ownerUid = uploadOwner.current || currentUser?.uid;
    if (!ownerUid) throw new Error("로그인 상태를 확인해 주세요.");
    if (
      pendingCommit.current &&
      JSON.stringify(pendingCommit.current) !== JSON.stringify(resources)
    )
      throw new Error(
        "직전 저장 결과를 먼저 확인해야 합니다. 지도 설정에서 저장을 다시 눌러 주세요.",
      );
    pendingCommit.current = structuredClone(resources);
    if (activeRecovery.current) {
      const snapshot = activeRecovery.current
        .snapshot as EditorRecoverySnapshot;
      snapshot.pendingCommit = pendingCommit.current;
      snapshot.pendingAssets = [...pendingAssets.current];
      snapshot.sources = [...sources.current];
    }
    let result;
    try {
      result = await saveMapResources(
        config,
        resources.map((item) => {
          const document = toMapDocument(normalizeMapResource(item.id, item));
          return {
            ...sourceFor(item.id, item.storageScope || "semester"),
            document,
            assetUploadIds: getAttachedMapUploadIds(
              document,
              pendingAssets.current.get(item.id) || [],
            ),
          };
        }),
        ownerUid,
      );
    } catch (error) {
      if (
        !(error as { retryable?: boolean })?.retryable &&
        (error as { reason?: string })?.reason !== "COMMAND_OUTCOME_UNCONFIRMED"
      )
        pendingCommit.current = null;
      if (activeRecovery.current)
        (
          activeRecovery.current.snapshot as EditorRecoverySnapshot
        ).pendingCommit = pendingCommit.current;
      throw error;
    }
    pendingCommit.current = null;
    mutationSucceeded.current = true;
    rememberSaved(result.resources);
    return resources.map((item) => {
      const source = sources.current.get(item.id)!;
      return {
        ...item,
        contentRevision: source.expectedRevision,
        storageScope: source.originScope,
        sourceExists: true,
        sourceHash: source.sourceHash,
      };
    });
  };

  const handleMoveItem = async (itemId: string, direction: "up" | "down") => {
    if (!canEdit || mutationFlight.current) return;
    const groups = groupMapResourcesForDisplay(items);
    const index = groups.findIndex(
      (group) =>
        group.key === itemId.replace(/^map-group:/u, "") ||
        group.items.some((item) => item.id === itemId),
    );
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= groups.length) return;
    const [moved] = groups.splice(index, 1);
    groups.splice(targetIndex, 0, moved);
    const ordered = groups
      .flatMap((group) => group.items)
      .map((item, sortOrder) => ({ ...item, sortOrder }));
    if (!beginMutation()) return;
    try {
      setItems(await persistBatch(ordered));
      setSelectedId(moved.items[0]?.id || selectedId);
    } catch (error) {
      alert(
        `지도 순서를 변경하지 못했습니다.\n${normalizeErrorMessage(error)}`,
      );
    } finally {
      finishMutation();
    }
  };

  const persistMapPayload = async (
    payload: MapResource,
    preferredScope: StorageScope,
  ) => {
    const [saved] = await persistBatch([
      { ...payload, storageScope: preferredScope },
    ]);
    const merged = mergeMapResources([
      ...items.filter((item) => item.id !== payload.id),
      saved,
    ]).map((item) => ({
      ...item,
      storageScope:
        item.id === saved.id
          ? saved.storageScope
          : items.find((existing) => existing.id === item.id)?.storageScope ||
            preferredScope,
    }));
    setItems(merged);
    setSelectedId(saved.id);
    setDraft(saved);
    resetFileInput();
    setIsSettingsOpen(false);
    alert("지도 자료를 저장했습니다.");
  };

  const uploadSelectedFile = async (
    resourceId: string,
    fileOverride?: File | null,
    processedOverride?: ProcessedPdfMap | null,
  ) => {
    const file = fileOverride ?? selectedFile;
    if (!file)
      return {
        fileUrl: draft.fileUrl || "",
        imageUrl: draft.imageUrl || "",
        storagePath: draft.storagePath || "",
        fileName: draft.fileName || "",
        mimeType: draft.mimeType || "",
        pdfPageImages: draft.pdfPageImages || [],
        pdfRegions: draft.pdfRegions || [],
      };
    const ownerUid = uploadOwner.current;
    if (!ownerUid) throw new Error("로그인 상태를 확인해 주세요.");
    const source = sourceFor(resourceId, draft.storageScope || "semester");
    const main = await uploadMapAsset(
      config,
      source,
      file,
      draft.type === "pdf" ? "PDF" : "IMAGE",
      ownerUid,
      "",
      0,
      file.name,
    );
    const uploadAssets: RetainedMapAsset[] = [
      { ...main, kind: draft.type === "pdf" ? "PDF" : "IMAGE" },
    ];
    const pages: PdfMapPageImage[] = [];
    let regions: PdfMapRegion[] = [];
    if (draft.type === "pdf") {
      const processed =
        processedOverride ||
        (await (
          await import("../../lib/pdfMapProcessor")
        ).processPdfMapFile(file));
      if (
        processed.pageImages.length > 150 ||
        processed.pageImages.reduce(
          (sum, page) => sum + page.blob.size,
          file.size,
        ) >
          100 * 1024 * 1024
      )
        throw new Error("PDF는 150쪽, 전체 업로드는 100MB 이하여야 합니다.");
      for (const page of processed.pageImages) {
        const uploaded = await uploadMapAsset(
          config,
          source,
          page.blob,
          "PAGE",
          ownerUid,
          main.uploadId,
          page.page,
        );
        uploadAssets.push({
          ...uploaded,
          kind: "PAGE",
          sourceUploadId: main.uploadId,
        });
        pages.push({
          page: page.page,
          imageUrl: uploaded.url,
          width: uploaded.width!,
          height: uploaded.height!,
        });
      }
      regions = processed.regions;
    }
    pendingAssets.current.set(resourceId, uploadAssets);
    return {
      fileUrl: main.url,
      imageUrl: draft.type === "image" ? main.url : "",
      storagePath: main.storagePath,
      fileName: file.name,
      mimeType:
        file.type || (draft.type === "pdf" ? "application/pdf" : "image/png"),
      pdfPageImages: pages,
      pdfRegions: regions,
    };
  };
  const handleTypeChange = (nextType: MapResourceType) => {
    resetFileInput();

    setDraft((prev) => ({
      ...prev,
      type: nextType,
      imageUrl: nextType === "image" ? prev.imageUrl : "",
      fileUrl: nextType === "image" || nextType === "pdf" ? prev.fileUrl : "",
      storagePath:
        nextType === "image" || nextType === "pdf" ? prev.storagePath : "",
      fileName: nextType === "image" || nextType === "pdf" ? prev.fileName : "",
      mimeType: nextType === "image" || nextType === "pdf" ? prev.mimeType : "",
      embedUrl: nextType === "iframe" ? prev.embedUrl : "",
      googleQuery: nextType === "google" ? prev.googleQuery : "",
      pdfPageImages: nextType === "pdf" ? prev.pdfPageImages : [],
      pdfRegions: nextType === "pdf" ? prev.pdfRegions : [],
    }));
  };

  const beginMutation = () => {
    if (!canEdit || mutationFlight.current) return false;
    mutationFlight.current = true;
    uploadOwner.current = currentUser?.uid || "";
    setSaving(true);
    mutationSucceeded.current = false;
    let settle!: () => void;
    const record = {
      snapshot: {
        items,
        draft,
        selectedFile,
        pendingPdfUploads,
        sources: [...sources.current],
        pendingAssets: [...pendingAssets.current],
        pendingCommit: pendingCommit.current,
      } as EditorRecoverySnapshot,
      pending: true,
      succeeded: false,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
      finish: (succeeded: boolean) => {
        record.pending = false;
        record.succeeded = succeeded;
        settle();
      },
    };
    mapEditorRecovery.set(recoveryKey, record);
    activeRecovery.current = record;
    return true;
  };
  const finishMutation = () => {
    activeRecovery.current?.finish(mutationSucceeded.current);
    if (mutationSucceeded.current) mapEditorRecovery.delete(recoveryKey);
    mutationFlight.current = false;
    uploadOwner.current = "";
    setSaving(false);
  };

  const handleSave = async () => {
    if (!canEdit || mutationFlight.current) return;
    if (pendingCommit.current) {
      if (!beginMutation()) return;
      try {
        const saved = await persistBatch(pendingCommit.current);
        setItems([
          ...items.filter((item) => !saved.some((row) => row.id === item.id)),
          ...saved,
        ]);
        setSelectedId(saved[0].id);
        setDraft(saved[0]);
        resetFileInput();
        setIsSettingsOpen(false);
        alert("직전 지도 저장 결과를 확인했습니다.");
      } catch (error) {
        alert(
          `지도 저장 결과를 확인하지 못했습니다.\n${normalizeErrorMessage(error)}`,
        );
      } finally {
        finishMutation();
      }
      return;
    }
    if (!draft.title.trim() || !draft.category.trim()) {
      alert("지도 제목과 분류를 입력해 주세요.");
      return;
    }
    const resourceId = draft.id || `map-${crypto.randomUUID()}`;
    const payloadBase = normalizeMapResource(resourceId, draft);
    if (payloadBase.type === "iframe" && !payloadBase.embedUrl) {
      alert("iframe 지도를 사용하려면 iframe URL을 입력해 주세요.");
      return;
    }
    if (payloadBase.type === "google" && !payloadBase.googleQuery) {
      alert("구글 지도를 사용하려면 검색어를 입력해 주세요.");
      return;
    }
    if (
      ["image", "pdf"].includes(payloadBase.type) &&
      !selectedFile &&
      !(payloadBase.type === "image"
        ? payloadBase.imageUrl
        : payloadBase.fileUrl)
    ) {
      alert(
        payloadBase.type === "pdf"
          ? "PDF 파일을 선택해 주세요."
          : "이미지 파일을 선택해 주세요.",
      );
      return;
    }
    if (!beginMutation()) return;
    try {
      if (payloadBase.type === "pdf" && pendingPdfUploads.length > 1) {
        const created: StoredMapResource[] = [];
        const totalBytes = pendingPdfUploads.reduce(
          (sum, upload) =>
            sum +
            upload.file.size +
            upload.processed.pageImages.reduce(
              (size, page) => size + page.blob.size,
              0,
            ),
          0,
        );
        if (pendingPdfUploads.length > 100 || totalBytes > 100 * 1024 * 1024)
          throw new Error(
            "한 번에 저장할 지도는 100개, 전체 파일은 100MB 이하여야 합니다.",
          );
        for (const upload of pendingPdfUploads) {
          const id = `map-${crypto.randomUUID()}`;
          const info = await uploadSelectedFile(
            id,
            upload.file,
            upload.processed,
          );
          created.push({
            ...normalizeMapResource(id, {
              ...draft,
              title: fileNameWithoutExtension(upload.file.name),
            }),
            ...info,
            storageScope: draft.storageScope || "semester",
          });
        }
        const saved = await persistBatch(created);
        setItems(
          mergeMapResources([...items, ...saved]).map((item) => ({
            ...item,
            storageScope:
              saved.find((row) => row.id === item.id)?.storageScope ||
              items.find((row) => row.id === item.id)?.storageScope ||
              "semester",
          })),
        );
        setSelectedId(saved[0].id);
        setDraft(saved[0]);
        resetFileInput();
        setIsSettingsOpen(false);
        alert(`${saved.length}개의 PDF 지도를 한 번에 저장했습니다.`);
      } else {
        const info = await uploadSelectedFile(resourceId);
        const payload = { ...payloadBase, ...info };
        await persistMapPayload(payload, draft.storageScope || "semester");
      }
    } catch (error) {
      alert(`지도 저장에 실패했습니다.\n${normalizeErrorMessage(error)}`);
    } finally {
      finishMutation();
    }
  };

  const handleReprocessPdf = async () => {
    if (!canEdit || mutationFlight.current || draft.type !== "pdf" || !draft.id)
      return;
    let file = selectedFile;
    if (!file) {
      alert("PDF 재처리를 위해 같은 PDF 파일을 다시 선택해 주세요.");
      file = await requestLocalPdfFile();
      if (!file) return;
      setSelectedFile(file);
    }
    if (!beginMutation()) return;
    try {
      // Reprocessing attaches the selected original and its derived pages in
      // one command, so an unrelated old PDF cannot remain as their source.
      const info = await uploadSelectedFile(draft.id, file);
      await persistMapPayload(
        { ...normalizeMapResource(draft.id, draft), ...info },
        draft.storageScope || "semester",
      );
    } catch (error) {
      alert(`PDF 재처리에 실패했습니다.\n${normalizeErrorMessage(error)}`);
    } finally {
      finishMutation();
    }
  };

  const handleDelete = async () => {
    if (!canEdit || mutationFlight.current || !draft.id) return;
    if (draft.id === GOOGLE_MAP_RESOURCE_ID) {
      alert("구글 지도 기본 항목은 삭제할 수 없습니다.");
      return;
    }
    if (
      !window.confirm(`'${draft.title}' 지도를 삭제하시겠습니까?`) ||
      !beginMutation()
    )
      return;
    try {
      await deleteMapResource(
        config,
        sourceFor(draft.id, draft.storageScope || "semester"),
        uploadOwner.current,
      );
      mutationSucceeded.current = true;
      sources.current.delete(draft.id);
      pendingAssets.current.delete(draft.id);
      const next = mergeMapResources(
        items.filter((item) => item.id !== draft.id),
      ).map((item) => ({
        ...item,
        storageScope:
          items.find((row) => row.id === item.id)?.storageScope || "semester",
      }));
      setItems(next);
      setSelectedId(next[0]?.id || "");
      setDraft(next[0] || createDraft());
      resetFileInput();
      setIsSettingsOpen(false);
    } catch (error) {
      alert(`지도 삭제에 실패했습니다.\n${normalizeErrorMessage(error)}`);
    } finally {
      finishMutation();
    }
  };

  const handleSaveTabRename = async () => {
    if (!canEdit || mutationFlight.current) return;
    const name = tabRenameValue.trim();
    if (!tabRenameSourceKey || !name) {
      alert("지도 탭 이름을 입력해 주세요.");
      return;
    }
    const group = displayGroupMap.get(tabRenameSourceKey);
    if (!group?.items.length || !beginMutation()) return;
    try {
      const saved = await persistBatch(
        group.items.map((item) => ({ ...item, tabGroup: name })),
      );
      setItems(
        items.map((item) => saved.find((row) => row.id === item.id) || item),
      );
      setIsTabRenameOpen(false);
    } catch (error) {
      alert(
        `지도 탭 이름을 변경하지 못했습니다.\n${normalizeErrorMessage(error)}`,
      );
    } finally {
      finishMutation();
    }
  };
  const selectedPreview = draft.id ? draft : null;
  const displayGroups = useMemo(
    () => groupMapResourcesForDisplay(items),
    [items],
  );
  const displayGroupMap = useMemo(
    () => new Map(displayGroups.map((group) => [group.key, group])),
    [displayGroups],
  );
  const currentDisplayGroup =
    displayGroups.find((group) =>
      group.items.some((item) => item.id === selectedId),
    ) ||
    displayGroups[0] ||
    null;
  const currentDisplayItems = currentDisplayGroup?.items || [];
  const currentPreviewItem =
    currentDisplayItems.find((item) => item.id === selectedId) ||
    currentDisplayItems[0] ||
    selectedPreview;
  const sidebarItems = useMemo<MapResource[]>(
    () =>
      displayGroups.map((group) => ({
        ...group.representative,
        id: `map-group:${group.key}`,
        title: group.title,
      })),
    [displayGroups],
  );
  const acceptsFile = draft.type === "pdf" || draft.type === "image";
  const currentSettingsTabGroup = (
    draft.tabGroup ||
    draft.category ||
    ""
  ).trim();
  const settingsTabs = useMemo(
    () =>
      items.filter(
        (item) =>
          (item.tabGroup || item.category || "").trim() ===
          currentSettingsTabGroup,
      ),
    [currentSettingsTabGroup, items],
  );
  const currentPdfTagSections = useMemo(
    () => clonePdfTagSections(draft.pdfTagSections || DEFAULT_PDF_TAG_SECTIONS),
    [draft.pdfTagSections],
  );
  const allPdfTagOptions = useMemo(
    () => getPdfSectionTagOptions(currentPdfTagSections),
    [currentPdfTagSections],
  );
  const displayedPdfRegions = useMemo(
    () =>
      isPdfShortcutExpanded
        ? draft.pdfRegions || []
        : (draft.pdfRegions || []).slice(0, 12),
    [draft.pdfRegions, isPdfShortcutExpanded],
  );
  const activePdfShortcutCount = useMemo(
    () =>
      (draft.pdfRegions || []).filter(
        (region) => region.shortcutEnabled !== false,
      ).length,
    [draft.pdfRegions],
  );
  const activePdfTagCount = useMemo(
    () =>
      new Set((draft.pdfRegions || []).flatMap((region) => region.tags || []))
        .size,
    [draft.pdfRegions],
  );
  const pdfTagUsageMap = useMemo(
    () =>
      new Map(
        allPdfTagOptions.map((tag) => [
          tag,
          (draft.pdfRegions || []).filter((region) =>
            (region.tags || []).includes(tag),
          ).length,
        ]),
      ),
    [allPdfTagOptions, draft.pdfRegions],
  );
  const activePendingPdfUpload = useMemo(
    () =>
      pendingPdfUploads.find((upload) => upload.id === activePendingPdfId) ||
      pendingPdfUploads[0] ||
      null,
    [activePendingPdfId, pendingPdfUploads],
  );
  const settingsPdfPreviewUrl =
    draft.type === "pdf" ? selectedFilePreviewUrl || draft.fileUrl || "" : "";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 lg:flex-row lg:p-10">
        <MapSidebar
          heading="지도"
          items={sidebarItems}
          selectedId={`map-group:${currentDisplayGroup?.key || ""}`}
          onSelect={(id) => {
            const nextGroupKey = id.replace(/^map-group:/u, "");
            const nextGroup = displayGroupMap.get(nextGroupKey);
            setSelectedId(nextGroup?.items[0]?.id || "");
          }}
          action={
            canEdit ? (
              <button
                type="button"
                onClick={handleCreateNew}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
              >
                <i className="fas fa-plus"></i>
                추가
              </button>
            ) : undefined
          }
          headingAction={
            canEdit ? (
              <button
                type="button"
                onClick={() => setIsReorderMode((prev) => !prev)}
                className={`inline-flex min-w-[44px] items-center justify-center rounded-lg border px-2 py-1 text-xs font-extrabold leading-none transition ${
                  isReorderMode
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                }`}
                aria-label="지도 순서 변경"
                title="지도 순서 변경"
              >
                순서
              </button>
            ) : undefined
          }
          renderItemAction={(item) =>
            !canEdit ? undefined : isReorderMode ? (
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => void handleMoveItem(item.id, "up")}
                  disabled={
                    displayGroups[0]?.key ===
                    item.id.replace(/^map-group:/u, "")
                  }
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-30"
                  aria-label={`${item.title} 위로 이동`}
                  title="위로 이동"
                >
                  <i className="fas fa-chevron-up text-xs"></i>
                </button>
                <button
                  type="button"
                  onClick={() => void handleMoveItem(item.id, "down")}
                  disabled={
                    displayGroups[displayGroups.length - 1]?.key ===
                    item.id.replace(/^map-group:/u, "")
                  }
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-30"
                  aria-label={`${item.title} 아래로 이동`}
                  title="아래로 이동"
                >
                  <i className="fas fa-chevron-down text-xs"></i>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenTabRename(item.id.replace(/^map-group:/u, ""));
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-gray-400 transition hover:border-gray-200 hover:bg-white hover:text-gray-700"
                aria-label={`${item.title} 탭 이름 설정`}
                title="탭 이름 설정"
              >
                <i className="fas fa-cog text-sm"></i>
              </button>
            )
          }
          reorderMode={isReorderMode}
        />

        <section className="min-w-0 flex-1 space-y-5 sm:space-y-6">
          {!canEdit && (
            <StatePanel
              state="DISABLED"
              title="지도 자료는 읽기 전용입니다."
              description="현재 계정은 저장 권한이 없어 지도 자료를 조회만 할 수 있습니다."
              readOnly
              compact
            />
          )}
          {loading ? (
            <InlineLoading
              message="지도 자료를 불러오는 중입니다."
              showWarning
            />
          ) : currentPreviewItem ? (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 p-4 pb-4 sm:p-6 sm:pb-4 lg:p-8 lg:pb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {currentPreviewItem.category}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-extrabold text-gray-900 sm:text-2xl">
                        {currentDisplayGroup?.title || currentPreviewItem.title}
                      </h2>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenSettings(currentPreviewItem.id)
                          }
                          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                          편집
                        </button>
                      )}
                    </div>
                  </div>
                  {canEdit && currentPreviewItem.type === "pdf" && (
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenTagManager(currentPreviewItem.id)
                      }
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 sm:w-auto"
                    >
                      <i className="fas fa-tags"></i>
                      태그 설정
                    </button>
                  )}
                </div>
              </div>

              {currentDisplayItems.length > 1 && (
                <div className="border-b border-gray-100 px-6">
                  <div className="flex overflow-x-auto">
                    {currentDisplayItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={`shrink-0 border-b-2 px-4 py-4 text-sm font-bold transition ${
                          currentPreviewItem.id === item.id
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-gray-50 p-4 md:p-6">
                <MapViewer
                  item={currentPreviewItem}
                  googleSearchQuery={
                    canEdit && currentPreviewItem.type === "google"
                      ? currentPreviewItem.googleQuery || ""
                      : undefined
                  }
                  onGoogleSearchQueryChange={
                    currentPreviewItem.type === "google"
                      ? (value) => handleDraftChange("googleQuery", value)
                      : undefined
                  }
                  showShell={false}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
              지도를 선택해 주세요.
            </div>
          )}
        </section>
      </div>

      {canEdit && isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 p-6 md:p-8">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">
                  지도 편집
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  지도 탭, 제목, 분류, 파일, 태그, 바로가기를 이 창에서
                  편집합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="설정 닫기"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {settingsTabs.length > 1 && (
              <div className="overflow-x-auto border-y border-gray-100 px-6 md:px-8">
                <div className="flex min-w-max">
                  {settingsTabs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleOpenSettings(item.id)}
                      className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
                        draft.id === item.id
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 p-4 sm:p-6 md:p-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      지도 탭
                    </label>
                    <input
                      type="text"
                      value={draft.tabGroup || ""}
                      onChange={(e) =>
                        handleDraftChange("tabGroup", e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="예: 한반도"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      해당 지도가 속하는 상위 탭 이름입니다.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      지도 제목
                    </label>
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) =>
                        handleDraftChange("title", e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="예: 한반도 자연지형 지도"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      가로 하위 탭에 표시되는 제목입니다.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      분류
                    </label>
                    <input
                      type="text"
                      value={draft.category}
                      onChange={(e) =>
                        handleDraftChange("category", e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="예: 한국사"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      지도 이름 옆 배지에만 표시되는 유형입니다.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      지도 유형
                    </label>
                    <select
                      value={draft.type}
                      onChange={(e) =>
                        handleTypeChange(e.target.value as MapResourceType)
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="pdf">PDF</option>
                      <option value="image">이미지</option>
                      <option value="iframe">iframe 지도</option>
                      <option value="google">구글 지도</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      지도 순서
                    </label>
                    <input
                      type="number"
                      value={draft.sortOrder}
                      onChange={(e) =>
                        handleDraftChange(
                          "sortOrder",
                          Number(e.target.value) || 0,
                        )
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-xs font-bold text-gray-500">
                    설명
                  </label>
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      handleDraftChange("description", e.target.value)
                    }
                    rows={4}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="학생에게 보여줄 지도 설명을 입력하세요."
                  />
                </div>
                {acceptsFile && (
                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-gray-500">
                        {draft.type === "pdf"
                          ? "PDF 파일 업로드"
                          : "이미지 파일 업로드"}
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={
                          draft.type === "pdf"
                            ? ".pdf,application/pdf"
                            : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        }
                        multiple={draft.type === "pdf"}
                        onClick={(e) => {
                          (e.currentTarget as HTMLInputElement).value = "";
                        }}
                        onChange={(e) => void handleFileInputChange(e)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                      {draft.type === "pdf" && pendingPdfUploads.length > 0 && (
                        <div className="mt-3 space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                          {pendingPdfUploads.map((upload) => (
                            <div
                              key={upload.id}
                              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
                                activePendingPdfUpload?.id === upload.id
                                  ? "border-blue-200 bg-blue-50"
                                  : "border-gray-200 bg-white"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handlePendingPdfUploadSelect(upload.id)
                                }
                                className="min-w-0 flex-1 truncate text-left font-medium text-gray-700"
                              >
                                {upload.file.name}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handlePendingPdfUploadRemove(upload.id)
                                }
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:bg-white hover:text-red-500"
                                aria-label={`${upload.file.name} 삭제`}
                                title="파일 삭제"
                              >
                                <i className="fas fa-times text-xs"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {isPreparingPdfUploads && (
                        <div className="mt-2 text-xs font-medium text-blue-600">
                          PDF 미리보기와 키워드를 추출하는 중입니다.
                        </div>
                      )}
                      {draft.type === "pdf" && (
                        <div className="mt-2 text-xs text-gray-500">
                          여러 파일을 함께 선택하면 각각 별도 지도 자료로
                          저장됩니다.
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-xs leading-6 text-gray-500">
                      <div>
                        현재 파일:{" "}
                        {selectedFile?.name ||
                          draft.fileName ||
                          "선택된 파일 없음"}
                      </div>
                      <div>
                        {draft.type === "pdf"
                          ? "여러 PDF를 동시에 고르면 각각의 지도 자료로 저장할 수 있습니다."
                          : "이미지 파일은 업로드 후 바로 미리보기에 반영됩니다."}
                      </div>
                    </div>
                  </div>
                )}

                {draft.type === "iframe" && (
                  <div className="mt-4">
                    <label className="mb-1 block text-xs font-bold text-gray-500">
                      iframe URL
                    </label>
                    <input
                      type="text"
                      value={draft.embedUrl || ""}
                      onChange={(e) =>
                        handleDraftChange("embedUrl", e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="https://..."
                    />
                  </div>
                )}

                {draft.type === "google" && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-gray-500">
                        구글 지도 검색어
                      </label>
                      <input
                        type="text"
                        value={draft.googleQuery || ""}
                        onChange={(e) =>
                          handleDraftChange("googleQuery", e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="예: 서울 경복궁"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-gray-500">
                        외부 링크
                      </label>
                      <input
                        type="text"
                        value={draft.externalUrl || ""}
                        onChange={(e) =>
                          handleDraftChange("externalUrl", e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="https://www.google.com/maps"
                      />
                    </div>
                  </div>
                )}

                {draft.type === "pdf" &&
                  (draft.pdfRegions?.length || 0) > 0 && (
                    <div className="mt-6">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">
                            지역 바로가기 명칭 수정
                          </h3>
                          <p className="mt-1 text-xs text-gray-500">
                            이름 수정, 바로가기 표시, 태그 지정을 함께
                            편집합니다.
                          </p>
                        </div>
                        <div className="text-xs font-medium text-gray-400">
                          {(draft.pdfRegions || []).length}개
                        </div>
                      </div>
                      <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        {displayedPdfRegions.map((region) => {
                          const index = (draft.pdfRegions || []).findIndex(
                            (item) =>
                              item.page === region.page &&
                              item.left === region.left &&
                              item.top === region.top &&
                              item.label === region.label,
                          );

                          return (
                            <div
                              key={`${region.page}-${region.left}-${region.top}-${index}`}
                              className="space-y-3 rounded-xl bg-white p-3"
                            >
                              <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
                                <div className="text-xs font-bold text-gray-500">
                                  p.{region.page}
                                </div>
                                <input
                                  type="text"
                                  value={region.label}
                                  onChange={(e) =>
                                    handlePdfRegionLabelChange(
                                      index,
                                      e.target.value,
                                    )
                                  }
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                  placeholder="지역 바로가기 이름"
                                />
                                <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600">
                                  <input
                                    type="checkbox"
                                    checked={region.shortcutEnabled !== false}
                                    onChange={(e) =>
                                      handlePdfRegionShortcutToggle(
                                        index,
                                        e.target.checked,
                                      )
                                    }
                                    className="h-4 w-4 rounded border-gray-300"
                                  />
                                  바로가기
                                </label>
                              </div>

                              <div>
                                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">
                                  Tag
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {allPdfTagOptions.map((tag) => {
                                    const checked = (
                                      region.tags || []
                                    ).includes(tag);
                                    return (
                                      <label
                                        key={`${region.page}-${index}-${tag}`}
                                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                                          checked
                                            ? "border-blue-200 bg-blue-50 text-blue-700"
                                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) =>
                                            handlePdfRegionTagToggle(
                                              index,
                                              tag,
                                              e.target.checked,
                                            )
                                          }
                                          className="h-3.5 w-3.5 rounded border-gray-300"
                                        />
                                        {tag}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {(draft.pdfRegions || []).length > 12 && (
                        <button
                          type="button"
                          onClick={() =>
                            setIsPdfShortcutExpanded((prev) => !prev)
                          }
                          className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                          {isPdfShortcutExpanded
                            ? "접기"
                            : `더 보기 (${(draft.pdfRegions || []).length - 12}개 더)`}
                        </button>
                      )}
                    </div>
                  )}
              </div>
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
                      Preview
                    </div>
                    <h3 className="mt-2 text-lg font-extrabold text-gray-900">
                      {draft.type === "pdf" ? "PDF 상세 보기" : "미리보기"}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {draft.type === "pdf"
                        ? "업로드한 PDF 파일과 추출 상태를 우측에서 바로 확인합니다."
                        : "현재 설정한 지도 내용을 우측 미리보기에서 바로 확인합니다."}
                    </p>
                  </div>
                  {draft.type === "pdf" && (
                    <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold text-gray-600">
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] text-gray-400">파일</div>
                        <div className="mt-1">
                          {selectedFile
                            ? "준비됨"
                            : draft.fileUrl
                              ? "저장됨"
                              : "신규"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] text-gray-400">페이지</div>
                        <div className="mt-1">
                          {draft.pdfPageImages?.length || 0}
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] text-gray-400">
                          바로가기
                        </div>
                        <div className="mt-1">{activePdfShortcutCount}</div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] text-gray-400">태그</div>
                        <div className="mt-1">{activePdfTagCount}</div>
                      </div>
                    </div>
                  )}
                </div>

                {draft.type === "pdf" ? (
                  settingsPdfPreviewUrl ? (
                    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                      <React.Suspense
                        fallback={
                          <InlineLoading message="PDF 지도를 준비하는 중입니다." />
                        }
                      >
                        <PdfMapViewer
                          fileUrl={settingsPdfPreviewUrl}
                          storagePath={
                            selectedFile ? undefined : draft.storagePath
                          }
                          title={
                            draft.title || selectedFile?.name || "PDF 지도"
                          }
                          pageImages={draft.pdfPageImages || []}
                          regions={draft.pdfRegions || []}
                          tagSections={currentPdfTagSections}
                        />
                      </React.Suspense>
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-sm text-gray-500">
                      PDF 파일을 선택하면 이 영역에서 미리보기와 추출 결과를
                      바로 확인할 수 있습니다.
                    </div>
                  )
                ) : (
                  <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                    <MapViewer
                      item={draft}
                      googleSearchQuery={
                        draft.type === "google"
                          ? draft.googleQuery || ""
                          : undefined
                      }
                      onGoogleSearchQueryChange={
                        draft.type === "google"
                          ? (value) => handleDraftChange("googleQuery", value)
                          : undefined
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 px-6 py-6 md:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {draft.id && draft.type === "pdf" && draft.fileUrl && (
                    <button
                      type="button"
                      onClick={() => void handleReprocessPdf()}
                      disabled={saving}
                      className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    >
                      PDF 재처리
                    </button>
                  )}
                  {draft.id && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {canEdit && isTagManagerOpen && draft.type === "pdf" && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-6">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">
                  태그 설정
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  범주를 정리하고 태그를 추가, 수정, 이동, 삭제할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTagManagerOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="태그 설정 닫기"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              <div className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <div className="text-sm font-bold text-gray-900">
                    {draft.title || "PDF 지도"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {currentPdfTagSections.length}개 범주,{" "}
                    {allPdfTagOptions.length}개 태그
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddPdfTagSection}
                  className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                  범주 추가
                </button>
              </div>

              <div className="space-y-3">
                {currentPdfTagSections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-2xl border border-gray-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-gray-900">
                          {section.label}
                        </div>
                        <div className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                          {section.tags.length}개
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleRenamePdfTagSection(section.id)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                        >
                          범주 이름 수정
                        </button>
                        {currentPdfTagSections.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              handleDeletePdfTagSection(section.id)
                            }
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                          >
                            범주 삭제
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 md:flex-row">
                      <input
                        type="text"
                        value={sectionTagInputs[section.id] || ""}
                        onChange={(e) =>
                          handleSectionTagInputChange(
                            section.id,
                            e.target.value,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddSectionTag(section.id);
                          }
                        }}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder={`${section.label} 범주에 태그 추가`}
                      />
                      <button
                        type="button"
                        onClick={() => handleAddSectionTag(section.id)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 md:w-28"
                      >
                        태그 추가
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {section.tags.length > 0 ? (
                        section.tags.map((tag) => (
                          <div
                            key={`${section.id}-${tag}`}
                            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 md:flex-row md:items-center"
                          >
                            <div className="flex min-w-0 items-center gap-2 md:flex-1">
                              <span className="truncate text-sm font-bold text-gray-800">
                                {tag}
                              </span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-gray-500">
                                {pdfTagUsageMap.get(tag) || 0}곳
                              </span>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <button
                                type="button"
                                onClick={() =>
                                  handleRenameSectionTag(section.id, tag)
                                }
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-white"
                              >
                                태그 수정
                              </button>
                              <select
                                defaultValue={section.id}
                                onChange={(e) => {
                                  handleMoveSectionTag(
                                    section.id,
                                    tag,
                                    e.target.value,
                                  );
                                  e.currentTarget.value = section.id;
                                }}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:min-w-[10rem]"
                              >
                                <option value={section.id}>
                                  다른 범주로 이동
                                </option>
                                {currentPdfTagSections
                                  .filter((item) => item.id !== section.id)
                                  .map((item) => (
                                    <option
                                      key={`${section.id}-${tag}-${item.id}`}
                                      value={item.id}
                                    >
                                      {item.label}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteSectionTag(section.id, tag)
                                }
                                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                              >
                                태그 삭제
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-400">
                          아직 등록된 태그가 없습니다.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-5">
              <button
                type="button"
                onClick={() => setIsTagManagerOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTagManager()}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "저장 중..." : "태그 설정 저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canEdit && isTabRenameOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">
                  지도 탭 이름 변경
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  좌측 탭에 표시되는 이름만 먼저 바꿉니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTabRenameOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="탭 이름 설정 닫기"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-xs font-bold text-gray-500">
                지도 탭
              </label>
              <input
                type="text"
                value={tabRenameValue}
                onChange={(e) => setTabRenameValue(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="예: 한반도"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsTabRenameOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTabRename()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMaps;
