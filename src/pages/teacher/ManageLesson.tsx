import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
import {
  LoadingOverlay,
  PageDataLoading,
} from "../../components/common/LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import { db, getFirebaseStorage } from "../../lib/firebase";
import {
  saveLessonDocument,
  saveLessonTree,
  uploadLessonAsset,
  downloadLessonPdfReference,
  retryLessonDocumentSave,
} from "../../lib/lessonManagement";
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  getBlob,
  getDownloadURL,
  listAll,
  ref,
  type StorageReference,
} from "firebase/storage";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../lib/semesterScope";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { type ProcessedPdfMap } from "../../lib/pdfMapProcessor";
import {
  clampRatio,
  normalizeWorksheetBlanks,
  normalizeWorksheetExamHighlights,
  getTightTextRegionBounds,
  normalizeWorksheetFootnoteAnchors,
  normalizeWorksheetPageImages,
  normalizeWorksheetTextRegions,
  type LessonWorksheetBlank,
  type LessonWorksheetExamHighlight,
  type LessonWorksheetFootnoteAnchor,
  type LessonWorksheetPageImage,
  type LessonWorksheetTextRegion,
} from "../../lib/lessonWorksheet";
import {
  buildFootnoteToken,
  createLessonFootnoteDraft,
  getLessonFootnoteUsageMap,
  normalizeLessonData,
  replaceOrInsertFootnoteToken,
  sanitizeLessonFootnote,
  sanitizeLessonFootnoteAnchorKey,
  sortLessonFootnotes,
  type LessonData,
  type LessonFootnote,
  type NormalizedLessonData,
} from "../../lib/lessonData";
import { findLessonTreeSelectionByUnitId } from "../../lib/lessonTreeSelection";
import { findInitialLessonSelection } from "../../lib/lessonInitialSelection";
import {
  lessonWriteRecovery,
  lessonWriteFailureMessage,
  isLessonDocumentUnconfirmed,
  type LessonWriteRecovery,
  type LessonWriteOutcome,
} from "../../lib/lessonWriteRecovery";
import {
  buildFailedLessonPdfProcessingMeta,
  buildQueuedLessonPdfProcessingMeta,
  createEmptyLessonPdfProcessingMeta,
  normalizeLessonPdfProcessingMeta,
  type LessonPdfProcessingMeta,
} from "../../lib/lessonPdfExtraction";
import { LEGACY_LESSON_READ_ONLY_MESSAGE } from "../../lib/legacyLessonSafetyAdapter";
import { canWriteLessonManagement } from "../../lib/permissions";
import { subscribeSourceArchiveAssets } from "../../lib/sourceArchive";
import {
  buildLegacyLessonManagementHandoffMessage,
  shouldHandoffLegacyLessonManagementMutation,
} from "../../lib/legacyLessonManagementHandoff";
import { emitSessionActivity } from "../../lib/sessionActivity";
import type { SourceArchiveAsset } from "../../types";
import LessonSourceArchivePickerModal from "./components/LessonSourceArchivePickerModal";
import {
  FootnoteEditorDialog,
  LessonEditorHeader,
  LessonPdfSection,
  LessonPreviewLauncher,
  LessonTreePanel,
  type LessonEditorTab,
  type LessonTreeNode,
} from "./components/LessonEditorPanels";

type TreeNode = LessonTreeNode;

const TABS: Array<{ id: LessonEditorTab; label: string; icon: string }> = [
  { id: "pdf", label: "PDF 편집", icon: "fa-file-pdf" },
  { id: "student-preview", label: "학생 미리보기", icon: "fa-user-graduate" },
];

const PDF_EXTRACTION_RETRY_REQUEST_TIMEOUT_MS = 45000;
const PDF_EXTRACTION_RETRY_TIMEOUT_MS = 120000;

type PdfExtractionRetryOverlayState = {
  unitId: string;
  startedAt: number;
  phase: "requesting" | "polling";
  message: string;
};

const createPdfExtractionRetryError = (code: string) => {
  const error = new Error(code) as Error & { code?: string };
  error.code = code;
  return error;
};

const runPdfExtractionStepWithTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(createPdfExtractionRetryError(code)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const getPdfExtractionRetryErrorCode = (error: unknown) =>
  String(
    (error as { code?: string; message?: string })?.code ||
      (error as { message?: string })?.message ||
      "",
  ).trim();

const shouldPersistPdfExtractionRetryFailure = (error: unknown) =>
  ![
    "lesson-pdf-source-missing",
    "lesson-pdf-retry-request-timeout",
    "lesson-pdf-retry-status-timeout",
    "lesson-pdf-retry-status-refresh-failed",
  ].includes(getPdfExtractionRetryErrorCode(error));

const getPdfExtractionRetryFeedbackMessage = (error: unknown) => {
  const code = getPdfExtractionRetryErrorCode(error);

  if (code === "lesson-pdf-source-missing") {
    return "저장된 원본 PDF를 찾지 못해 구조 추출을 다시 요청할 수 없습니다.";
  }
  if (code === "lesson-doc-not-found") {
    return "수업 자료를 찾지 못해 구조 추출을 다시 요청하지 못했습니다.";
  }
  if (code === "lesson-pdf-retry-request-timeout") {
    return "구조 추출 재요청이 예상보다 오래 걸리고 있습니다. 잠시 후 상태를 다시 확인해 주세요.";
  }
  if (code === "lesson-pdf-retry-status-timeout") {
    return "구조 추출이 아직 끝나지 않았습니다. 잠시 후 다시 확인해 주세요.";
  }
  if (code === "lesson-pdf-retry-status-refresh-failed") {
    return "구조 추출 상태를 확인하는 중 문제가 발생했습니다. 잠시 후 다시 확인해 주세요.";
  }

  return "원본 PDF 구조 추출을 다시 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};

const createBlankFromRect = (
  page: number,
  rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  },
  source: "ocr" | "manual" = "manual",
): LessonWorksheetBlank => ({
  id: `blank-${page}-${Date.now()}`,
  page,
  leftRatio: rect.leftRatio,
  topRatio: rect.topRatio,
  widthRatio: rect.widthRatio,
  heightRatio: rect.heightRatio,
  answer: "",
  prompt: "",
  source,
});

const createExamHighlightFromRect = (
  page: number,
  rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  },
): LessonWorksheetExamHighlight => ({
  id: `exam-highlight-${page}-${Date.now()}`,
  page,
  leftRatio: rect.leftRatio,
  topRatio: rect.topRatio,
  widthRatio: rect.widthRatio,
  heightRatio: rect.heightRatio,
});

const getBlankAnswerFromRegions = (regions: LessonWorksheetTextRegion[]) =>
  regions
    .map((region) => String(region.label || "").trim())
    .filter(Boolean)
    .join(" ");

const getBoundsFromRegions = (
  regions: LessonWorksheetTextRegion[],
  pageImage?: LessonWorksheetPageImage | null,
) => {
  if (
    !regions.length ||
    !pageImage ||
    pageImage.width <= 0 ||
    pageImage.height <= 0
  )
    return null;
  const tightened = regions
    .map((region) => getTightTextRegionBounds(region, pageImage))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!tightened.length) return null;
  const left = Math.min(...tightened.map((region) => region.left));
  const top = Math.min(...tightened.map((region) => region.top));
  const right = Math.max(
    ...tightened.map((region) => region.left + region.width),
  );
  const bottom = Math.max(
    ...tightened.map((region) => region.top + region.height),
  );
  return {
    leftRatio: clampRatio(left / pageImage.width),
    topRatio: clampRatio(top / pageImage.height),
    widthRatio: clampRatio((right - left) / pageImage.width),
    heightRatio: clampRatio((bottom - top) / pageImage.height),
  };
};

const revokeBlobUrls = (pages: LessonWorksheetPageImage[]) => {
  pages.forEach((page) => {
    if (page.imageUrl.startsWith("blob:")) URL.revokeObjectURL(page.imageUrl);
  });
};

type FootnoteImageDraft = {
  file: File | null;
  previewUrl: string;
  removeExisting: boolean;
};
type LessonUploadContext = {
  expectedRevision: number;
  expectedUid: string;
  assetUploadIds: string[];
};

type PendingLessonPdfUpload = {
  file: File;
  storagePath: string;
  uploadToken: string;
};

type UploadedWorksheetAssets = {
  pdfName: string;
  pdfUrl: string;
  pdfStoragePath: string;
  pageImages: LessonWorksheetPageImage[];
  textRegions: LessonWorksheetTextRegion[];
  pdfProcessing: LessonPdfProcessingMeta;
  pendingIncomingUpload: PendingLessonPdfUpload | null;
};

const LESSON_PDF_UPLOAD_CACHE_CONTROL = "public,max-age=3600";

type PendingFootnoteAnchorPlacement = {
  page: number;
  rect: {
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  };
};

type FootnoteEditorSession = {
  mode: "create" | "edit";
  draft: LessonFootnote;
  sourceFootnoteId: string | null;
  initialImageDraft: FootnoteImageDraft | null;
  pendingAnchorPlacement: PendingFootnoteAnchorPlacement | null;
  insertIntoBody: boolean;
};

const reindexFootnotes = (footnotes: LessonFootnote[]) =>
  sortLessonFootnotes(footnotes).map((footnote, index) => ({
    ...footnote,
    order: index,
  }));

const mergeFootnotePatch = (
  target: LessonFootnote,
  patch: Partial<LessonFootnote>,
  existingFootnotes: LessonFootnote[],
) => {
  const merged = {
    ...target,
    ...patch,
  };
  const resolvedAnchorKey =
    patch.anchorKey !== undefined
      ? patch.anchorKey
      : target.anchorKey || merged.anchorKey;

  return sanitizeLessonFootnote(
    {
      ...merged,
      anchorKey: resolvedAnchorKey || merged.anchorKey,
    },
    existingFootnotes.filter((footnote) => footnote.id !== target.id),
  );
};

const mergeFootnoteDraftPatch = (
  target: LessonFootnote,
  patch: Partial<LessonFootnote>,
) => ({
  ...target,
  ...patch,
});

const sortWorksheetBlanks = (blanks: LessonWorksheetBlank[]) =>
  [...blanks].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    if (left.topRatio !== right.topRatio) return left.topRatio - right.topRatio;
    if (left.leftRatio !== right.leftRatio) {
      return left.leftRatio - right.leftRatio;
    }
    return left.id.localeCompare(right.id);
  });

const sortWorksheetExamHighlights = (
  highlights: LessonWorksheetExamHighlight[],
) =>
  [...highlights].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    if (left.topRatio !== right.topRatio) return left.topRatio - right.topRatio;
    if (left.leftRatio !== right.leftRatio) {
      return left.leftRatio - right.leftRatio;
    }
    return left.id.localeCompare(right.id);
  });

const sortWorksheetTextRegions = (regions: LessonWorksheetTextRegion[]) =>
  [...regions].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    if (left.top !== right.top) return left.top - right.top;
    if (left.left !== right.left) return left.left - right.left;
    if (left.width !== right.width) return left.width - right.width;
    if (left.height !== right.height) return left.height - right.height;
    return left.label.localeCompare(right.label);
  });

const cloneFootnoteImageDraft = (
  draft?: FootnoteImageDraft | null,
): FootnoteImageDraft | null =>
  draft
    ? {
        file: draft.file,
        previewUrl: draft.previewUrl,
        removeExisting: draft.removeExisting,
      }
    : null;

const sortWorksheetFootnoteAnchors = (
  anchors: LessonWorksheetFootnoteAnchor[],
) =>
  [...anchors].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    if (left.topRatio !== right.topRatio) return left.topRatio - right.topRatio;
    if (left.leftRatio !== right.leftRatio) {
      return left.leftRatio - right.leftRatio;
    }
    return left.id.localeCompare(right.id);
  });

const normalizeLessonContentForSave = (value: string) =>
  String(value || "").replace(
    /(^|>)([ \t]+)(?=\S)/gm,
    (_match, prefix: string, spaces: string) =>
      `${prefix}${spaces.replace(/\t/g, "    ").replace(/ /g, "&nbsp;")}`,
  );

const buildNormalizedLessonDraft = (params: {
  lessonTitle: string;
  lessonVideo: string;
  lessonContent: string;
  lessonVisibleToStudents: boolean;
  lessonFootnotes: LessonFootnote[];
  worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
  lessonPdfName: string;
  lessonPdfUrl: string;
  lessonPdfStoragePath: string;
  lessonPdfProcessing: LessonPdfProcessingMeta;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  worksheetExamHighlights: LessonWorksheetExamHighlight[];
}) => {
  const sanitizedFootnotes = reindexFootnotes(
    params.lessonFootnotes.map((footnote) =>
      sanitizeLessonFootnote(
        {
          ...footnote,
          anchorKey: sanitizeLessonFootnoteAnchorKey(footnote.anchorKey),
        },
        params.lessonFootnotes.filter((item) => item.id !== footnote.id),
      ),
    ),
  );

  return normalizeLessonData({
    title: String(params.lessonTitle || "").trim(),
    videoUrl: String(params.lessonVideo || "").trim(),
    contentHtml: normalizeLessonContentForSave(params.lessonContent),
    isVisibleToStudents: params.lessonVisibleToStudents,
    pdfName: String(params.lessonPdfName || "").trim(),
    pdfUrl: String(params.lessonPdfUrl || "").trim(),
    pdfStoragePath: String(params.lessonPdfStoragePath || "").trim(),
    pdfProcessing: normalizeLessonPdfProcessingMeta(
      params.lessonPdfProcessing,
      {
        ...createEmptyLessonPdfProcessingMeta(),
        pdfName: String(params.lessonPdfName || "").trim(),
        pdfStoragePath: String(params.lessonPdfStoragePath || "").trim(),
      },
    ),
    worksheetPageImages: normalizeWorksheetPageImages(
      params.worksheetPageImages,
    ),
    worksheetTextRegions: sortWorksheetTextRegions(
      normalizeWorksheetTextRegions(params.worksheetTextRegions),
    ),
    worksheetBlanks: sortWorksheetBlanks(
      normalizeWorksheetBlanks(params.worksheetBlanks),
    ),
    worksheetExamHighlights: sortWorksheetExamHighlights(
      normalizeWorksheetExamHighlights(params.worksheetExamHighlights),
    ),
    worksheetFootnoteAnchors: sortWorksheetFootnoteAnchors(
      normalizeWorksheetFootnoteAnchors(params.worksheetFootnoteAnchors),
    ),
    footnotes: sanitizedFootnotes,
  });
};

const buildNormalizedGeneralLessonDraft = (params: {
  lessonTitle: string;
  lessonVideo: string;
  lessonVisibleToStudents: boolean;
}) => {
  const normalized = buildNormalizedLessonDraft({
    lessonTitle: params.lessonTitle,
    lessonVideo: params.lessonVideo,
    lessonContent: "",
    lessonVisibleToStudents: params.lessonVisibleToStudents,
    lessonFootnotes: [],
    worksheetFootnoteAnchors: [],
    lessonPdfName: "",
    lessonPdfUrl: "",
    lessonPdfStoragePath: "",
    lessonPdfProcessing: createEmptyLessonPdfProcessingMeta(),
    worksheetPageImages: [],
    worksheetTextRegions: [],
    worksheetBlanks: [],
    worksheetExamHighlights: [],
  });

  return {
    title: normalized.title,
    videoUrl: normalized.videoUrl,
    isVisibleToStudents: normalized.isVisibleToStudents,
  };
};

const createEmptyNormalizedLessonData = (): NormalizedLessonData =>
  buildNormalizedLessonDraft({
    lessonTitle: "",
    lessonVideo: "",
    lessonContent: "",
    lessonVisibleToStudents: true,
    lessonFootnotes: [],
    worksheetFootnoteAnchors: [],
    lessonPdfName: "",
    lessonPdfUrl: "",
    lessonPdfStoragePath: "",
    lessonPdfProcessing: createEmptyLessonPdfProcessingMeta(),
    worksheetPageImages: [],
    worksheetTextRegions: [],
    worksheetBlanks: [],
    worksheetExamHighlights: [],
  });

const buildNormalizedPdfEditorDraft = (params: {
  lessonContent: string;
  lessonFootnotes: LessonFootnote[];
  worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
  lessonPdfName: string;
  lessonPdfUrl: string;
  lessonPdfStoragePath: string;
  lessonPdfProcessing: LessonPdfProcessingMeta;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  worksheetExamHighlights: LessonWorksheetExamHighlight[];
}) => {
  const normalized = buildNormalizedLessonDraft({
    lessonTitle: "",
    lessonVideo: "",
    lessonContent: params.lessonContent,
    lessonVisibleToStudents: true,
    lessonFootnotes: params.lessonFootnotes,
    worksheetFootnoteAnchors: params.worksheetFootnoteAnchors,
    lessonPdfName: params.lessonPdfName,
    lessonPdfUrl: params.lessonPdfUrl,
    lessonPdfStoragePath: params.lessonPdfStoragePath,
    lessonPdfProcessing: params.lessonPdfProcessing,
    worksheetPageImages: params.worksheetPageImages,
    worksheetTextRegions: params.worksheetTextRegions,
    worksheetBlanks: params.worksheetBlanks,
    worksheetExamHighlights: params.worksheetExamHighlights,
  });

  return {
    contentHtml: normalized.contentHtml,
    footnotes: normalized.footnotes,
    worksheetFootnoteAnchors: normalized.worksheetFootnoteAnchors,
    pdfName: normalized.pdfName,
    pdfUrl: normalized.pdfUrl,
    pdfStoragePath: normalized.pdfStoragePath,
    pdfProcessing: normalized.pdfProcessing,
    worksheetPageImages: normalized.worksheetPageImages,
    worksheetTextRegions: normalized.worksheetTextRegions,
    worksheetBlanks: normalized.worksheetBlanks,
    worksheetExamHighlights: normalized.worksheetExamHighlights,
  };
};

const createGeneralEditorSnapshot = (params: {
  selectedNodeId: string | null;
  lessonTitle: string;
  lessonVideo: string;
  lessonVisibleToStudents: boolean;
}) =>
  JSON.stringify({
    lesson: buildNormalizedGeneralLessonDraft(params),
  });

const createPdfEditorSnapshot = (params: {
  selectedNodeId: string | null;
  lessonContent: string;
  lessonFootnotes: LessonFootnote[];
  worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
  lessonPdfName: string;
  lessonPdfUrl: string;
  lessonPdfStoragePath: string;
  lessonPdfProcessing: LessonPdfProcessingMeta;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  worksheetExamHighlights: LessonWorksheetExamHighlight[];
  selectedPdfFile: File | null;
  preparedPdf: ProcessedPdfMap | null;
  footnoteImageDrafts: Record<string, FootnoteImageDraft>;
  pendingFootnoteEditor?: {
    mode: "create" | "edit";
    sourceFootnoteId: string | null;
    insertIntoBody: boolean;
    pendingAnchorPlacement: {
      page: number;
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    } | null;
    draft: LessonFootnote;
  } | null;
}) =>
  JSON.stringify({
    lesson: buildNormalizedPdfEditorDraft({
      lessonContent: params.lessonContent,
      lessonFootnotes: params.lessonFootnotes,
      worksheetFootnoteAnchors: params.worksheetFootnoteAnchors,
      lessonPdfName: params.lessonPdfName,
      lessonPdfUrl: params.lessonPdfUrl,
      lessonPdfStoragePath: params.lessonPdfStoragePath,
      lessonPdfProcessing: params.lessonPdfProcessing,
      worksheetPageImages: params.worksheetPageImages,
      worksheetTextRegions: params.worksheetTextRegions,
      worksheetBlanks: params.worksheetBlanks,
      worksheetExamHighlights: params.worksheetExamHighlights,
    }),
    footnoteImageDrafts: Object.entries(params.footnoteImageDrafts)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([footnoteId, draft]) => ({
        footnoteId,
        fileName: draft.file?.name || "",
        removeExisting: draft.removeExisting,
        hasFile: Boolean(draft.file),
      })),
    pendingFootnoteEditor: params.pendingFootnoteEditor || null,
    pendingPdfFileName: params.selectedPdfFile?.name || "",
    preparedPdfPageCount: params.preparedPdf?.pageImages.length || 0,
  });

const EMPTY_META_EDITOR_SNAPSHOT = createGeneralEditorSnapshot({
  selectedNodeId: null,
  lessonTitle: "",
  lessonVideo: "",
  lessonVisibleToStudents: true,
});

const EMPTY_PDF_EDITOR_SNAPSHOT = createPdfEditorSnapshot({
  selectedNodeId: null,
  lessonContent: "",
  lessonFootnotes: [],
  worksheetFootnoteAnchors: [],
  lessonPdfName: "",
  lessonPdfUrl: "",
  lessonPdfStoragePath: "",
  lessonPdfProcessing: createEmptyLessonPdfProcessingMeta(),
  worksheetPageImages: [],
  worksheetTextRegions: [],
  worksheetBlanks: [],
  worksheetExamHighlights: [],
  selectedPdfFile: null,
  preparedPdf: null,
  footnoteImageDrafts: {},
});

const ManageLesson: React.FC = () => {
  const { config, configReady, userData, currentUser } = useAuth();
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeTitle, setSelectedNodeTitle] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<LessonEditorTab>("pdf");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonVideo, setLessonVideo] = useState("");
  const [lessonContent, setLessonContent] = useState("");
  const [lessonVisibleToStudents, setLessonVisibleToStudents] = useState(true);
  const [lessonFootnotes, setLessonFootnotes] = useState<LessonFootnote[]>([]);
  const [worksheetFootnoteAnchors, setWorksheetFootnoteAnchors] = useState<
    LessonWorksheetFootnoteAnchor[]
  >([]);
  const [activeFootnoteId, setActiveFootnoteId] = useState<string | null>(null);
  const [activeFootnoteAnchorId, setActiveFootnoteAnchorId] = useState<
    string | null
  >(null);
  const [footnoteEditorSession, setFootnoteEditorSession] =
    useState<FootnoteEditorSession | null>(null);
  const [lessonPdfName, setLessonPdfName] = useState("");
  const [lessonPdfUrl, setLessonPdfUrl] = useState("");
  const [lessonPdfStoragePath, setLessonPdfStoragePath] = useState("");
  const [lessonPdfProcessing, setLessonPdfProcessing] =
    useState<LessonPdfProcessingMeta>(() =>
      createEmptyLessonPdfProcessingMeta(),
    );
  const [worksheetPageImages, setWorksheetPageImages] = useState<
    LessonWorksheetPageImage[]
  >([]);
  const [worksheetTextRegions, setWorksheetTextRegions] = useState<
    LessonWorksheetTextRegion[]
  >([]);
  const [worksheetBlanks, setWorksheetBlanks] = useState<
    LessonWorksheetBlank[]
  >([]);
  const [worksheetExamHighlights, setWorksheetExamHighlights] = useState<
    LessonWorksheetExamHighlight[]
  >([]);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [preparedPdf, setPreparedPdf] = useState<ProcessedPdfMap | null>(null);
  const [activeBlankId, setActiveBlankId] = useState<string | null>(null);
  const [activeExamHighlightId, setActiveExamHighlightId] = useState<
    string | null
  >(null);
  const [draftBlank, setDraftBlank] = useState<LessonWorksheetBlank | null>(
    null,
  );
  const [draftBlankAnswer, setDraftBlankAnswer] = useState("");
  const [draftBlankPrompt, setDraftBlankPrompt] = useState("");
  const [blankEditorMode, setBlankEditorMode] = useState<
    "draft" | "existing" | null
  >(null);
  const [worksheetTool, setWorksheetTool] = useState<
    "pan" | "ocr" | "box" | "exam" | "footnote"
  >("pan");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [screenBusyMessage, setScreenBusyMessage] = useState<string | null>(
    null,
  );
  const [pdfExtractionRetryOverlay, setPdfExtractionRetryOverlay] =
    useState<PdfExtractionRetryOverlayState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<
    "root" | "child" | "rename" | null
  >(null);
  const [targetNode, setTargetNode] = useState<TreeNode | null>(null);
  const [modalInput, setModalInput] = useState("");
  const [lessonSaveState, setLessonSaveState] = useState<
    "saved" | "saving" | "dirty"
  >("saved");
  const [pdfSaveState, setPdfSaveState] = useState<
    "saved" | "saving" | "dirty"
  >("saved");
  const [bodyInsertMessage, setBodyInsertMessage] = useState("");
  const [bodySelection, setBodySelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [footnoteImageDrafts, setFootnoteImageDrafts] = useState<
    Record<string, FootnoteImageDraft>
  >({});
  const [sourceArchiveAssets, setSourceArchiveAssets] = useState<
    SourceArchiveAsset[]
  >([]);
  const [sourceArchiveSearch, setSourceArchiveSearch] = useState("");
  const [sourceArchivePickerFootnoteId, setSourceArchivePickerFootnoteId] =
    useState<string | null>(null);
  const [pdfSaveFeedback, setPdfSaveFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const lastSavedMetaSnapshotRef = useRef(EMPTY_META_EDITOR_SNAPSHOT);
  const lastSavedPdfSnapshotRef = useRef(EMPTY_PDF_EDITOR_SNAPSHOT);
  const deletedFootnoteAssetPathsRef = useRef<string[]>([]);
  const lessonRevisionRef = useRef<number | null>(null);
  const treeRevisionRef = useRef(0);
  const treeLoadedRef = useRef(false);
  const treeLoadIdRef = useRef(0);
  const lessonLoadIdRef = useRef(0);
  const recoveredAssetIdsRef = useRef<string[]>([]);
  const [unconfirmedWrite, setUnconfirmedWrite] =
    useState<LessonWriteRecovery | null>(null);
  const editorMountedRef = useRef(true);
  useEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
      ++treeLoadIdRef.current;
      ++lessonLoadIdRef.current;
    };
  }, []);
  const editorContext = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}/${selectedNodeId || ""}`;
  const editorSessionRef = useRef({ context: editorContext, saving: false });
  if (editorSessionRef.current.context !== editorContext) {
    editorSessionRef.current = { context: editorContext, saving: false };
    lessonRevisionRef.current = null;
    recoveredAssetIdsRef.current = [];
  }
  const teacherScope = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}`;
  const teacherScopeRef = useRef(teacherScope);
  if (teacherScopeRef.current !== teacherScope) {
    teacherScopeRef.current = teacherScope;
    treeLoadedRef.current = false;
  }
  const [handoffAction, setHandoffAction] = useState("");
  const canEdit = canWriteLessonManagement(userData, currentUser?.email || "");
  const blockLegacyLessonMutationAsync = useCallback(
    async <T = never,>(..._ignored: unknown[]): Promise<T> => {
      setHandoffAction((current) => current || "수업 자료 변경 저장");
      throw new Error(
        buildLegacyLessonManagementHandoffMessage("수업 자료 변경 저장"),
      );
    },
    [],
  );
  const [savedLessonState, setSavedLessonState] =
    useState<NormalizedLessonData>(() => createEmptyNormalizedLessonData());

  const sortedBlanks = useMemo(
    () =>
      [...worksheetBlanks].sort(
        (a, b) =>
          a.page - b.page ||
          a.topRatio - b.topRatio ||
          a.leftRatio - b.leftRatio,
      ),
    [worksheetBlanks],
  );
  const sortedExamHighlights = useMemo(
    () => sortWorksheetExamHighlights(worksheetExamHighlights),
    [worksheetExamHighlights],
  );
  const lessonDraft = useMemo<LessonData>(
    () => ({
      unitId: selectedNodeId || undefined,
      title: lessonTitle || selectedNodeTitle,
      videoUrl: lessonVideo,
      contentHtml: savedLessonState.contentHtml,
      isVisibleToStudents: lessonVisibleToStudents,
      pdfName: savedLessonState.pdfName,
      pdfUrl: savedLessonState.pdfUrl,
      pdfStoragePath: savedLessonState.pdfStoragePath,
      pdfProcessing: savedLessonState.pdfProcessing,
      worksheetPageImages: savedLessonState.worksheetPageImages,
      worksheetTextRegions: savedLessonState.worksheetTextRegions,
      worksheetBlanks: savedLessonState.worksheetBlanks,
      worksheetExamHighlights: savedLessonState.worksheetExamHighlights,
      worksheetFootnoteAnchors: savedLessonState.worksheetFootnoteAnchors,
      footnotes: savedLessonState.footnotes,
    }),
    [
      selectedNodeId,
      selectedNodeTitle,
      lessonTitle,
      lessonVideo,
      lessonVisibleToStudents,
      savedLessonState,
    ],
  );
  const footnoteUsageMap = useMemo(
    () => getLessonFootnoteUsageMap(lessonContent, lessonFootnotes),
    [lessonContent, lessonFootnotes],
  );
  const footnoteAnchorCountMap = useMemo(() => {
    const nextMap = new Map<string, number>();
    worksheetFootnoteAnchors.forEach((anchor) => {
      nextMap.set(anchor.footnoteId, (nextMap.get(anchor.footnoteId) || 0) + 1);
    });
    return nextMap;
  }, [worksheetFootnoteAnchors]);
  const footnoteTitles = useMemo(
    () =>
      lessonFootnotes.reduce<Record<string, string>>(
        (accumulator, footnote) => {
          accumulator[footnote.id] =
            footnote.title?.trim() ||
            footnote.label?.trim() ||
            footnote.sourceArchiveTitle?.trim() ||
            "각주";
          return accumulator;
        },
        {},
      ),
    [lessonFootnotes],
  );
  const filteredSourceArchiveAssets = useMemo(() => {
    const keyword = sourceArchiveSearch.trim().toLowerCase();
    if (!keyword) return sourceArchiveAssets;
    return sourceArchiveAssets.filter((asset) =>
      [asset.title, asset.description, asset.previewText, ...(asset.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [sourceArchiveAssets, sourceArchiveSearch]);
  const pendingFootnoteEditorSnapshot = useMemo(() => {
    if (!footnoteEditorSession) return null;

    return {
      mode: footnoteEditorSession.mode,
      sourceFootnoteId: footnoteEditorSession.sourceFootnoteId,
      insertIntoBody: footnoteEditorSession.insertIntoBody,
      pendingAnchorPlacement: footnoteEditorSession.pendingAnchorPlacement
        ? {
            page: footnoteEditorSession.pendingAnchorPlacement.page,
            leftRatio:
              footnoteEditorSession.pendingAnchorPlacement.rect.leftRatio,
            topRatio:
              footnoteEditorSession.pendingAnchorPlacement.rect.topRatio,
            widthRatio:
              footnoteEditorSession.pendingAnchorPlacement.rect.widthRatio,
            heightRatio:
              footnoteEditorSession.pendingAnchorPlacement.rect.heightRatio,
          }
        : null,
      draft: footnoteEditorSession.draft,
    };
  }, [footnoteEditorSession]);
  const currentMetaSnapshot = useMemo(
    () =>
      createGeneralEditorSnapshot({
        selectedNodeId,
        lessonTitle,
        lessonVideo,
        lessonVisibleToStudents,
      }),
    [selectedNodeId, lessonTitle, lessonVideo, lessonVisibleToStudents],
  );
  const currentPdfSnapshot = useMemo(
    () =>
      createPdfEditorSnapshot({
        selectedNodeId,
        lessonContent,
        lessonFootnotes,
        worksheetFootnoteAnchors,
        lessonPdfName,
        lessonPdfUrl,
        lessonPdfStoragePath,
        lessonPdfProcessing,
        worksheetPageImages,
        worksheetTextRegions,
        worksheetBlanks,
        worksheetExamHighlights,
        selectedPdfFile,
        preparedPdf,
        footnoteImageDrafts,
        pendingFootnoteEditor: pendingFootnoteEditorSnapshot,
      }),
    [
      selectedNodeId,
      lessonContent,
      lessonFootnotes,
      worksheetFootnoteAnchors,
      lessonPdfName,
      lessonPdfUrl,
      lessonPdfStoragePath,
      lessonPdfProcessing,
      worksheetPageImages,
      worksheetTextRegions,
      worksheetBlanks,
      worksheetExamHighlights,
      selectedPdfFile,
      preparedPdf,
      footnoteImageDrafts,
      pendingFootnoteEditorSnapshot,
    ],
  );
  const hasUnsavedMetaChanges =
    currentMetaSnapshot !== lastSavedMetaSnapshotRef.current;
  const livePdfSnapshotRef = useRef(currentPdfSnapshot);
  livePdfSnapshotRef.current = currentPdfSnapshot;
  const hasUnsavedPdfChanges =
    currentPdfSnapshot !== lastSavedPdfSnapshotRef.current;
  const hasUnsavedLessonChanges = hasUnsavedMetaChanges || hasUnsavedPdfChanges;
  const combinedSaveStateTone =
    lessonSaveState === "saving" || pdfSaveState === "saving"
      ? "saving"
      : hasUnsavedLessonChanges
        ? "dirty"
        : "saved";
  const unsavedLessonWarningMessage =
    hasUnsavedMetaChanges && hasUnsavedPdfChanges
      ? "저장하지 않은 PDF 편집 내용과 제목/공개 설정 변경이 있습니다. 이동하면 현재 편집 내용이 사라집니다."
      : hasUnsavedPdfChanges
        ? "저장하지 않은 PDF 편집 내용이 있습니다. 이동하면 현재 편집 내용이 사라집니다."
        : hasUnsavedMetaChanges
          ? "저장하지 않은 제목/공개 설정 변경이 있습니다. 이동하면 현재 편집 내용이 사라집니다."
          : "";
  const primarySaveStateLabel =
    combinedSaveStateTone === "saving"
      ? hasUnsavedMetaChanges && hasUnsavedPdfChanges
        ? "전체 저장 중..."
        : hasUnsavedPdfChanges
          ? "PDF 저장 중..."
          : "제목/공개 저장 중..."
      : hasUnsavedMetaChanges && hasUnsavedPdfChanges
        ? "전체 저장 필요"
        : hasUnsavedPdfChanges
          ? "PDF 저장 필요"
          : hasUnsavedMetaChanges
            ? "제목/공개 저장 필요"
            : "모든 변경 저장됨";
  const primarySaveButtonLabel =
    combinedSaveStateTone === "saving"
      ? hasUnsavedMetaChanges && hasUnsavedPdfChanges
        ? "전체 저장 중..."
        : hasUnsavedPdfChanges
          ? "PDF 저장 중..."
          : "제목/공개 저장 중..."
      : hasUnsavedMetaChanges && hasUnsavedPdfChanges
        ? "전체 저장"
        : hasUnsavedPdfChanges
          ? "PDF 저장"
          : hasUnsavedMetaChanges
            ? "제목/공개 저장"
            : "저장";
  const disableHeaderSave =
    !canEdit ||
    !selectedNodeId ||
    !hasUnsavedLessonChanges ||
    combinedSaveStateTone === "saving";

  const syncSavedMetaState = useCallback(
    (params: {
      selectedNodeId: string | null;
      lessonTitle: string;
      lessonVideo: string;
      lessonVisibleToStudents: boolean;
    }) => {
      const normalizedGeneralDraft = buildNormalizedGeneralLessonDraft({
        lessonTitle: params.lessonTitle,
        lessonVideo: params.lessonVideo,
        lessonVisibleToStudents: params.lessonVisibleToStudents,
      });
      setSavedLessonState((prev) => ({
        ...prev,
        title: normalizedGeneralDraft.title,
        videoUrl: normalizedGeneralDraft.videoUrl,
        isVisibleToStudents: normalizedGeneralDraft.isVisibleToStudents,
      }));
      lastSavedMetaSnapshotRef.current = createGeneralEditorSnapshot({
        selectedNodeId: params.selectedNodeId,
        lessonTitle: normalizedGeneralDraft.title,
        lessonVideo: normalizedGeneralDraft.videoUrl,
        lessonVisibleToStudents: normalizedGeneralDraft.isVisibleToStudents,
      });
    },
    [],
  );
  const syncSavedPdfState = useCallback(
    (params: {
      selectedNodeId: string | null;
      lessonContent: string;
      lessonFootnotes: LessonFootnote[];
      worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
      lessonPdfName: string;
      lessonPdfUrl: string;
      lessonPdfStoragePath: string;
      lessonPdfProcessing: LessonPdfProcessingMeta;
      worksheetPageImages: LessonWorksheetPageImage[];
      worksheetTextRegions: LessonWorksheetTextRegion[];
      worksheetBlanks: LessonWorksheetBlank[];
      worksheetExamHighlights: LessonWorksheetExamHighlight[];
      selectedPdfFile: File | null;
      preparedPdf: ProcessedPdfMap | null;
      footnoteImageDrafts: Record<string, FootnoteImageDraft>;
    }) => {
      const normalizedPdfDraft = buildNormalizedPdfEditorDraft({
        lessonContent: params.lessonContent,
        lessonFootnotes: params.lessonFootnotes,
        worksheetFootnoteAnchors: params.worksheetFootnoteAnchors,
        lessonPdfName: params.lessonPdfName,
        lessonPdfUrl: params.lessonPdfUrl,
        lessonPdfStoragePath: params.lessonPdfStoragePath,
        lessonPdfProcessing: params.lessonPdfProcessing,
        worksheetPageImages: params.worksheetPageImages,
        worksheetTextRegions: params.worksheetTextRegions,
        worksheetBlanks: params.worksheetBlanks,
        worksheetExamHighlights: params.worksheetExamHighlights,
      });
      setSavedLessonState((prev) => ({
        ...prev,
        contentHtml: normalizedPdfDraft.contentHtml,
        footnotes: normalizedPdfDraft.footnotes,
        worksheetFootnoteAnchors: normalizedPdfDraft.worksheetFootnoteAnchors,
        pdfName: normalizedPdfDraft.pdfName,
        pdfUrl: normalizedPdfDraft.pdfUrl,
        pdfStoragePath: normalizedPdfDraft.pdfStoragePath,
        pdfProcessing: normalizedPdfDraft.pdfProcessing,
        worksheetPageImages: normalizedPdfDraft.worksheetPageImages,
        worksheetTextRegions: normalizedPdfDraft.worksheetTextRegions,
        worksheetBlanks: normalizedPdfDraft.worksheetBlanks,
        worksheetExamHighlights: normalizedPdfDraft.worksheetExamHighlights,
      }));
      lastSavedPdfSnapshotRef.current = createPdfEditorSnapshot({
        selectedNodeId: params.selectedNodeId,
        lessonContent: normalizedPdfDraft.contentHtml,
        lessonFootnotes: normalizedPdfDraft.footnotes,
        worksheetFootnoteAnchors: normalizedPdfDraft.worksheetFootnoteAnchors,
        lessonPdfName: normalizedPdfDraft.pdfName,
        lessonPdfUrl: normalizedPdfDraft.pdfUrl,
        lessonPdfStoragePath: normalizedPdfDraft.pdfStoragePath,
        lessonPdfProcessing: normalizedPdfDraft.pdfProcessing,
        worksheetPageImages: normalizedPdfDraft.worksheetPageImages,
        worksheetTextRegions: normalizedPdfDraft.worksheetTextRegions,
        worksheetBlanks: normalizedPdfDraft.worksheetBlanks,
        worksheetExamHighlights: normalizedPdfDraft.worksheetExamHighlights,
        selectedPdfFile: params.selectedPdfFile,
        preparedPdf: params.preparedPdf,
        footnoteImageDrafts: params.footnoteImageDrafts,
      });
    },
    [],
  );
  const syncSavedSnapshots = useCallback(
    (params: {
      selectedNodeId: string | null;
      lessonTitle: string;
      lessonVideo: string;
      lessonVisibleToStudents: boolean;
      lessonContent: string;
      lessonFootnotes: LessonFootnote[];
      worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
      lessonPdfName: string;
      lessonPdfUrl: string;
      lessonPdfStoragePath: string;
      lessonPdfProcessing: LessonPdfProcessingMeta;
      worksheetPageImages: LessonWorksheetPageImage[];
      worksheetTextRegions: LessonWorksheetTextRegion[];
      worksheetBlanks: LessonWorksheetBlank[];
      worksheetExamHighlights: LessonWorksheetExamHighlight[];
      selectedPdfFile: File | null;
      preparedPdf: ProcessedPdfMap | null;
      footnoteImageDrafts: Record<string, FootnoteImageDraft>;
    }) => {
      syncSavedMetaState({
        selectedNodeId: params.selectedNodeId,
        lessonTitle: params.lessonTitle,
        lessonVideo: params.lessonVideo,
        lessonVisibleToStudents: params.lessonVisibleToStudents,
      });
      syncSavedPdfState({
        selectedNodeId: params.selectedNodeId,
        lessonContent: params.lessonContent,
        lessonFootnotes: params.lessonFootnotes,
        worksheetFootnoteAnchors: params.worksheetFootnoteAnchors,
        lessonPdfName: params.lessonPdfName,
        lessonPdfUrl: params.lessonPdfUrl,
        lessonPdfStoragePath: params.lessonPdfStoragePath,
        lessonPdfProcessing: params.lessonPdfProcessing,
        worksheetPageImages: params.worksheetPageImages,
        worksheetTextRegions: params.worksheetTextRegions,
        worksheetBlanks: params.worksheetBlanks,
        worksheetExamHighlights: params.worksheetExamHighlights,
        selectedPdfFile: params.selectedPdfFile,
        preparedPdf: params.preparedPdf,
        footnoteImageDrafts: params.footnoteImageDrafts,
      });
    },
    [syncSavedMetaState, syncSavedPdfState],
  );

  const findLessonDocRefByUnitId = useCallback(
    async (unitId: string) => {
      const scopedRef = collection(
        db,
        getSemesterCollectionPath(config, "lessons"),
      );
      const scopedSnap = await getDocs(
        query(scopedRef, where("unitId", "==", unitId), limit(1)),
      );
      if (!scopedSnap.empty) {
        return doc(scopedRef, scopedSnap.docs[0].id);
      }

      return null;
    },
    [config],
  );

  const findOrCreateLessonDocRefByUnitId = useCallback(
    async (unitId: string) => {
      const existingLessonDocRef = await findLessonDocRefByUnitId(unitId);
      if (existingLessonDocRef) {
        return existingLessonDocRef;
      }
      const scopedRef = collection(
        db,
        getSemesterCollectionPath(config, "lessons"),
      );
      return doc(scopedRef);
    },
    [config, findLessonDocRefByUnitId],
  );

  const refreshLessonPdfProcessing = useCallback(
    async (unitId: string) => {
      const session = editorSessionRef.current;
      const loadId = lessonLoadIdRef.current;
      const snapshot = livePdfSnapshotRef.current;
      const revision = lessonRevisionRef.current;
      if (session.saving || hasUnsavedPdfChanges || selectedNodeId !== unitId)
        return null;
      const lessonDocRef = await findLessonDocRefByUnitId(unitId);
      if (!lessonDocRef) return null;
      const lessonSnap = await getDocFromServer(lessonDocRef);
      if (
        !lessonSnap.exists() ||
        editorSessionRef.current !== session ||
        lessonLoadIdRef.current !== loadId ||
        lessonRevisionRef.current !== revision ||
        livePdfSnapshotRef.current !== snapshot ||
        session.saving
      )
        return null;
      const data = normalizeLessonData(lessonSnap.data());
      if (
        data.contentRevision !== revision ||
        data.pdfStoragePath !== lessonPdfStoragePath
      )
        return null;
      if (
        JSON.stringify(data.pdfProcessing) !==
        JSON.stringify(lessonPdfProcessing)
      ) {
        setLessonPdfProcessing(data.pdfProcessing);
        syncSavedPdfState({
          selectedNodeId: unitId,
          lessonContent,
          lessonFootnotes,
          worksheetFootnoteAnchors,
          lessonPdfName,
          lessonPdfUrl,
          lessonPdfStoragePath,
          lessonPdfProcessing: data.pdfProcessing,
          worksheetPageImages,
          worksheetTextRegions,
          worksheetBlanks,
          worksheetExamHighlights,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
      }
      return data.pdfProcessing;
    },
    [
      findLessonDocRefByUnitId,
      hasUnsavedPdfChanges,
      selectedNodeId,
      lessonPdfStoragePath,
      lessonPdfProcessing,
      lessonContent,
      lessonFootnotes,
      worksheetFootnoteAnchors,
      lessonPdfName,
      lessonPdfUrl,
      worksheetPageImages,
      worksheetTextRegions,
      worksheetBlanks,
      worksheetExamHighlights,
      syncSavedPdfState,
    ],
  );

  const retryLessonPdfExtraction = async () => {
    if (
      !canEdit ||
      !selectedNodeId ||
      editorSessionRef.current.saving ||
      lessonRevisionRef.current === null
    )
      return;
    if (selectedPdfFile || preparedPdf || hasUnsavedPdfChanges)
      return alert("PDF 편집 내용을 먼저 저장해 주세요.");
    const path = lessonPdfProcessing.file.storagePath || lessonPdfStoragePath;
    if (!path) return alert("다시 추출할 원본 PDF가 없습니다.");
    const session = editorSessionRef.current;
    const expectedRevision = lessonRevisionRef.current;
    session.saving = true;
    setScreenBusyMessage(
      "원본 PDF를 확인하고 구조 추출을 다시 요청하는 중입니다...",
    );
    try {
      let asset = { storagePath: path, url: lessonPdfUrl };
      const result = await saveLessonDocument(
        config,
        {
          unitId: selectedNodeId,
          expectedRevision,
          assetUploadIds: [],
          document: {
            pdfName: lessonPdfName,
            pdfStoragePath: path,
            pdfUrl: lessonPdfUrl,
          },
        },
        {
          localDraft: { pdfFile: null, preparedPdf: null, footnotes: {} },
          prepare: async (ownerUid) => {
            const original = await downloadLessonPdfReference(
              lessonPdfUrl,
              path,
            );
            const uploaded = await uploadLessonAsset(config, {
              unitId: selectedNodeId,
              expectedRevision,
              expectedUid: ownerUid,
              kind: "PDF",
              file: new Blob([original], { type: "application/pdf" }),
              originalName: lessonPdfName || "lesson.pdf",
            });
            asset = uploaded;
            return {
              assetUploadIds: [uploaded.uploadId],
              document: {
                pdfName: lessonPdfName,
                pdfStoragePath: uploaded.storagePath,
                pdfUrl: uploaded.url,
              },
            };
          },
        },
      );
      if (!editorMountedRef.current || editorSessionRef.current !== session)
        return;
      lessonRevisionRef.current = result.contentRevision;
      lessonWriteRecovery.acknowledge(lessonWriteRecovery.peek(teacherScope));
      const processing = normalizeLessonPdfProcessingMeta(result.pdfProcessing);
      setLessonPdfStoragePath(asset.storagePath);
      setLessonPdfUrl(asset.url);
      setLessonPdfProcessing(processing);
      syncSavedPdfState({
        selectedNodeId,
        lessonContent,
        lessonFootnotes,
        worksheetFootnoteAnchors,
        lessonPdfName,
        lessonPdfUrl: asset.url,
        lessonPdfStoragePath: asset.storagePath,
        lessonPdfProcessing: processing,
        worksheetPageImages,
        worksheetTextRegions,
        worksheetBlanks,
        worksheetExamHighlights,
        selectedPdfFile: null,
        preparedPdf: null,
        footnoteImageDrafts: {},
      });
      setPdfSaveFeedback({
        tone: "success",
        message:
          "PDF 구조 추출을 다시 요청했습니다. 완료되면 상태가 자동으로 반영됩니다.",
      });
    } catch (error) {
      if (editorMountedRef.current && editorSessionRef.current === session) {
        const recovery = lessonWriteRecovery.peek(teacherScope);
        if (isLessonDocumentUnconfirmed(recovery))
          setUnconfirmedWrite(recovery!);
        else lessonWriteRecovery.acknowledge(recovery);
        setPdfSaveFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "PDF 구조 추출을 요청하지 못했습니다.",
        });
      }
    } finally {
      session.saving = false;
      if (editorMountedRef.current && editorSessionRef.current === session)
        setScreenBusyMessage(null);
    }
  };

  useEffect(() => {
    ++treeLoadIdRef.current;
    ++lessonLoadIdRef.current;
    treeLoadedRef.current = false;
    setSelectedNodeId(null);
    setSelectedNodeTitle("");
    clearLessonEditor(true);
    setTreeData([]);
    setScreenBusyMessage(null);
    if (!configReady) return;
    if (!config?.year || !config?.semester) {
      setPdfSaveFeedback({
        tone: "error",
        message:
          "학기 설정을 불러오지 못했습니다. 연결을 확인한 뒤 화면을 다시 열어 주세요.",
      });
      return;
    }
    void loadTree(true);
  }, [teacherScope, configReady]);
  useEffect(() => {
    const unsubscribe = subscribeSourceArchiveAssets(
      (items) => {
        setSourceArchiveAssets(
          items.filter(
            (item) =>
              item.mediaKind !== "pdf" && item.processingStatus === "ready",
          ),
        );
      },
      (error) => {
        console.error("Failed to load source archive assets:", error);
        setSourceArchiveAssets([]);
      },
    );
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (
      activeFootnoteId &&
      !lessonFootnotes.some((item) => item.id === activeFootnoteId)
    ) {
      setActiveFootnoteId(null);
    }
  }, [activeFootnoteId, lessonFootnotes]);
  useEffect(() => {
    if (
      footnoteEditorSession?.mode === "edit" &&
      footnoteEditorSession.sourceFootnoteId &&
      !lessonFootnotes.some(
        (item) => item.id === footnoteEditorSession.sourceFootnoteId,
      )
    ) {
      setFootnoteEditorSession(null);
    }
  }, [footnoteEditorSession, lessonFootnotes]);
  useEffect(() => {
    if (
      activeFootnoteAnchorId &&
      !worksheetFootnoteAnchors.some(
        (item) => item.id === activeFootnoteAnchorId,
      )
    ) {
      setActiveFootnoteAnchorId(null);
    }
  }, [activeFootnoteAnchorId, worksheetFootnoteAnchors]);
  useEffect(() => {
    if (!sourceArchivePickerFootnoteId) {
      setSourceArchiveSearch("");
    }
  }, [sourceArchivePickerFootnoteId]);
  useEffect(() => {
    if (hasUnsavedPdfChanges && pdfSaveFeedback?.tone === "success") {
      setPdfSaveFeedback(null);
    }
  }, [hasUnsavedPdfChanges, pdfSaveFeedback]);

  useEffect(() => {
    if (!pdfExtractionRetryOverlay) return;
    if (pdfExtractionRetryOverlay.unitId === selectedNodeId) return;
    setPdfExtractionRetryOverlay(null);
    setPdfBusy(false);
    setScreenBusyMessage(null);
  }, [pdfExtractionRetryOverlay, selectedNodeId]);

  useEffect(() => {
    if (
      !pdfExtractionRetryOverlay ||
      pdfExtractionRetryOverlay.unitId !== selectedNodeId
    ) {
      return;
    }

    if (lessonPdfProcessing.extractionStatus === "ready") {
      setPdfExtractionRetryOverlay(null);
      setPdfBusy(false);
      setScreenBusyMessage(null);
      setPdfSaveFeedback({
        tone: "success",
        message: "원본 PDF 구조 추출이 완료되어 화면 상태를 새로 반영했습니다.",
      });
      return;
    }

    if (lessonPdfProcessing.extractionStatus === "failed") {
      setPdfExtractionRetryOverlay(null);
      setPdfBusy(false);
      setScreenBusyMessage(null);
      setPdfSaveFeedback({
        tone: "error",
        message:
          "원본 PDF 구조 추출을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }, [
    lessonPdfProcessing.extractionStatus,
    pdfExtractionRetryOverlay,
    selectedNodeId,
  ]);

  useEffect(() => {
    const normalizedProcessing = normalizeLessonPdfProcessingMeta(
      lessonPdfProcessing,
      {
        pdfName: lessonPdfName,
        pdfStoragePath: lessonPdfStoragePath,
      },
    );
    const hasStoredPdfSource = Boolean(
      normalizedProcessing.file.storagePath ||
      lessonPdfStoragePath ||
      lessonPdfUrl,
    );

    if (
      !selectedNodeId ||
      !hasStoredPdfSource ||
      selectedPdfFile ||
      preparedPdf ||
      hasUnsavedPdfChanges ||
      (lessonPdfProcessing.extractionStatus !== "queued" &&
        lessonPdfProcessing.extractionStatus !== "processing")
    ) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    const finalizeRetryOverlay = (
      nextFeedback: {
        tone: "success" | "error";
        message: string;
      } | null,
      logMessage?: string,
    ) => {
      if (logMessage) {
        console.warn(logMessage, {
          unitId: selectedNodeId,
          extractionStatus: lessonPdfProcessing.extractionStatus,
        });
      }
      setPdfExtractionRetryOverlay((current) => {
        if (!current || current.unitId !== selectedNodeId) return current;
        return null;
      });
      setPdfBusy(false);
      setScreenBusyMessage(null);
      if (nextFeedback) {
        setPdfSaveFeedback(nextFeedback);
      }
    };

    const handleRefresh = async () => {
      if (refreshInFlight || cancelled) return;
      refreshInFlight = true;
      try {
        const nextProcessing = await runPdfExtractionStepWithTimeout(
          refreshLessonPdfProcessing(selectedNodeId),
          12_000,
          "lesson-pdf-retry-status-refresh-failed",
        );
        if (cancelled) return;

        const activeRetryOverlay =
          pdfExtractionRetryOverlay?.unitId === selectedNodeId
            ? pdfExtractionRetryOverlay
            : null;

        if (!activeRetryOverlay) return;

        if (!nextProcessing) {
          finalizeRetryOverlay(
            {
              tone: "error",
              message:
                "원본 PDF 구조 추출 상태를 다시 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
            },
            "Lesson PDF extraction retry overlay closed because lesson data could not be refreshed.",
          );
          return;
        }

        if (nextProcessing.extractionStatus === "ready") {
          finalizeRetryOverlay({
            tone: "success",
            message:
              "원본 PDF 구조 추출이 완료되어 화면 상태를 새로 반영했습니다.",
          });
          return;
        }

        if (nextProcessing.extractionStatus === "failed") {
          finalizeRetryOverlay({
            tone: "error",
            message:
              "원본 PDF 구조 추출을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          });
        }
      } catch (error) {
        console.error("Failed to refresh lesson pdf processing state:", error);
        if (
          !cancelled &&
          pdfExtractionRetryOverlay?.unitId === selectedNodeId
        ) {
          finalizeRetryOverlay(
            {
              tone: "error",
              message:
                "원본 PDF 구조 추출 상태를 확인하는 중 문제가 발생했습니다. 잠시 후 다시 확인해 주세요.",
            },
            "Lesson PDF extraction retry overlay closed because polling raised an exception.",
          );
        }
      } finally {
        refreshInFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void handleRefresh();
    }, 4000);

    void handleRefresh();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    hasUnsavedPdfChanges,
    lessonPdfName,
    lessonPdfProcessing,
    lessonPdfStoragePath,
    lessonPdfUrl,
    pdfExtractionRetryOverlay,
    preparedPdf,
    refreshLessonPdfProcessing,
    selectedNodeId,
    selectedPdfFile,
  ]);
  useEffect(() => {
    if (
      !pdfExtractionRetryOverlay ||
      pdfExtractionRetryOverlay.unitId !== selectedNodeId
    ) {
      return;
    }

    const isRequesting = pdfExtractionRetryOverlay.phase === "requesting";

    const timeoutId = window.setTimeout(
      () => {
        console.warn("Lesson PDF extraction retry overlay timed out.", {
          unitId: selectedNodeId,
          startedAt: pdfExtractionRetryOverlay.startedAt,
          phase: pdfExtractionRetryOverlay.phase,
        });
        setPdfExtractionRetryOverlay((current) => {
          if (!current || current.unitId !== selectedNodeId) return current;
          return null;
        });
        setPdfBusy(false);
        setScreenBusyMessage(null);
        setPdfSaveFeedback({
          tone: "error",
          message: isRequesting
            ? "구조 추출 재요청이 예상보다 오래 걸리고 있습니다. 잠시 후 상태를 다시 확인해 주세요."
            : "원본 PDF 구조 추출이 예상보다 오래 걸리고 있습니다. 잠시 후 상태를 다시 확인해 주세요.",
        });
      },
      isRequesting
        ? PDF_EXTRACTION_RETRY_REQUEST_TIMEOUT_MS
        : PDF_EXTRACTION_RETRY_TIMEOUT_MS,
    );

    return () => window.clearTimeout(timeoutId);
  }, [pdfExtractionRetryOverlay, selectedNodeId]);
  useEffect(
    () => () => {
      revokeBlobUrls(worksheetPageImages);
    },
    [worksheetPageImages],
  );
  useEffect(() => {
    if (lessonSaveState === "saving") return;
    setLessonSaveState(hasUnsavedMetaChanges ? "dirty" : "saved");
  }, [hasUnsavedMetaChanges, lessonSaveState]);
  useEffect(() => {
    if (pdfSaveState === "saving") return;
    setPdfSaveState(hasUnsavedPdfChanges ? "dirty" : "saved");
  }, [hasUnsavedPdfChanges, pdfSaveState]);
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedLessonChanges) return;
      event.preventDefault();
      event.returnValue = unsavedLessonWarningMessage;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedLessonChanges, unsavedLessonWarningMessage]);
  useEffect(
    () => () => {
      Object.values(footnoteImageDrafts).forEach((draft) => {
        if (draft.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(draft.previewUrl);
        }
      });
    },
    [footnoteImageDrafts],
  );
  useEffect(() => {
    if (!bodyInsertMessage) return;
    const timeout = window.setTimeout(() => setBodyInsertMessage(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [bodyInsertMessage]);
  const resetBlankEditor = useCallback(() => {
    setBlankEditorMode(null);
    setActiveBlankId(null);
    setDraftBlank(null);
    setDraftBlankAnswer("");
    setDraftBlankPrompt("");
  }, []);

  const resetWorksheetState = (revokeExisting = false) => {
    if (revokeExisting) revokeBlobUrls(worksheetPageImages);
    setLessonPdfName("");
    setLessonPdfUrl("");
    setLessonPdfStoragePath("");
    setLessonPdfProcessing(createEmptyLessonPdfProcessingMeta());
    setWorksheetPageImages([]);
    setWorksheetTextRegions([]);
    setWorksheetBlanks([]);
    setWorksheetExamHighlights([]);
    setWorksheetFootnoteAnchors([]);
    setPreparedPdf(null);
    setSelectedPdfFile(null);
    setActiveExamHighlightId(null);
    setActiveFootnoteAnchorId(null);
    resetBlankEditor();
  };

  const resetFootnoteImageDrafts = () => {
    Object.values(footnoteImageDrafts).forEach((draft) => {
      if (draft.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(draft.previewUrl);
      }
    });
    setFootnoteImageDrafts({});
  };

  const clearLessonEditor = (revokeExisting = false) => {
    setLessonTitle("");
    setLessonVideo("");
    setLessonContent("");
    setBodySelection(null);
    setBodyInsertMessage("");
    setLessonVisibleToStudents(true);
    setLessonFootnotes([]);
    setActiveFootnoteId(null);
    setSourceArchivePickerFootnoteId(null);
    setFootnoteEditorSession(null);
    setPdfSaveFeedback(null);
    resetFootnoteImageDrafts();
    resetWorksheetState(revokeExisting);
    deletedFootnoteAssetPathsRef.current = [];
    syncSavedSnapshots({
      selectedNodeId: null,
      lessonTitle: "",
      lessonVideo: "",
      lessonVisibleToStudents: true,
      lessonContent: "",
      lessonFootnotes: [],
      worksheetFootnoteAnchors: [],
      lessonPdfName: "",
      lessonPdfUrl: "",
      lessonPdfStoragePath: "",
      lessonPdfProcessing: createEmptyLessonPdfProcessingMeta(),
      worksheetPageImages: [],
      worksheetTextRegions: [],
      worksheetBlanks: [],
      worksheetExamHighlights: [],
      selectedPdfFile: null,
      preparedPdf: null,
      footnoteImageDrafts: {},
    });
    setLessonSaveState("saved");
    setPdfSaveState("saved");
  };

  const confirmDiscardChanges = () =>
    !hasUnsavedLessonChanges || window.confirm(unsavedLessonWarningMessage);

  const loadTree = async (resetSelection = false) => {
    const scope = teacherScope;
    const requestId = ++treeLoadIdRef.current;
    const lessonLoadId = lessonLoadIdRef.current;
    const isCurrent = () =>
      editorMountedRef.current &&
      teacherScopeRef.current === scope &&
      treeLoadIdRef.current === requestId;
    try {
      const recovery = lessonWriteRecovery.peek(scope);
      if (recovery?.pending)
        setScreenBusyMessage("수업 자료 저장 결과를 확인하는 중입니다...");
      const outcome = recovery ? await recovery.settled : undefined;
      if (!isCurrent()) return;
      if (isLessonDocumentUnconfirmed(recovery)) {
        setUnconfirmedWrite(recovery!);
        return;
      }
      const applyLoadedTree = async (nextTree: TreeNode[]) => {
        if (!isCurrent()) return;
        setTreeData(nextTree);
        treeLoadedRef.current = true;
        if (selectedNodeId && !resetSelection) return;

        if (recovery?.kind === "document") {
          const selection = findLessonTreeSelectionByUnitId(
            nextTree,
            recovery.input.unitId,
          );
          if (selection) {
            setExpandedIds(new Set(selection.pathIds.slice(0, -1)));
            setSelectedNodeId(selection.node.id);
            setSelectedNodeTitle(selection.node.title);
            setEditorTab("pdf");
            await loadLessonContent(selection.node.id, selection.node.title, {
              recovery,
              outcome: outcome!,
            });
            return;
          }
          setPdfSaveFeedback({
            tone: "error",
            message:
              "저장하던 수업 자료가 목차에 없습니다. 자료와 목차를 다시 확인해 주세요.",
          });
          return;
        }
        if (recovery?.kind === "tree") {
          if (outcome && !outcome.ok) {
            setTreeData(recovery.input.tree as TreeNode[]);
            treeRevisionRef.current = recovery.input.expectedRevision;
            setPdfSaveFeedback({
              tone: "error",
              message: lessonWriteFailureMessage(outcome.error),
            });
            lessonWriteRecovery.acknowledge(recovery);
            return;
          }
          lessonWriteRecovery.acknowledge(recovery);
        }

        const initialDocuments = new Map<string, QueryDocumentSnapshot>();
        const latestSelection =
          await findInitialLessonSelection<QueryDocumentSnapshot>({
            tree: nextTree,
            collectionPaths: [getSemesterCollectionPath(config, "lessons")],
            isCurrent: () =>
              isCurrent() && lessonLoadIdRef.current === lessonLoadId,
            readPage: async (collectionPath, cursor, pageSize) => {
              const snap = await getDocsFromServer(
                query(
                  collection(db, collectionPath),
                  orderBy("updatedAt", "desc"),
                  ...(cursor ? [startAfter(cursor)] : []),
                  limit(pageSize),
                ),
              );
              for (const lesson of snap.docs) {
                const unitId = String(lesson.data().unitId || "");
                if (
                  collectionPath ===
                    getSemesterCollectionPath(config, "lessons") &&
                  !initialDocuments.has(unitId)
                )
                  initialDocuments.set(unitId, lesson);
              }
              return {
                lessons: snap.docs.map(
                  (docSnap) => docSnap.data() as LessonData,
                ),
                nextCursor:
                  snap.size === pageSize
                    ? snap.docs[snap.docs.length - 1]
                    : undefined,
              };
            },
          });

        if (
          !latestSelection ||
          !isCurrent() ||
          lessonLoadIdRef.current !== lessonLoadId
        )
          return;
        setExpandedIds(new Set(latestSelection.pathIds.slice(0, -1)));
        setSelectedNodeId(latestSelection.node.id);
        setSelectedNodeTitle(latestSelection.node.title);
        setEditorTab("pdf");
        await loadLessonContent(
          latestSelection.node.id,
          latestSelection.node.title,
          undefined,
          initialDocuments.get(latestSelection.node.id),
        );
      };

      const scopedDoc = await getDocFromServer(
        doc(db, getSemesterDocPath(config, "curriculum", "tree")),
      );
      if (!isCurrent()) return;
      if (scopedDoc.exists() && scopedDoc.data().tree) {
        treeRevisionRef.current = scopedDoc.data().contentRevision ?? 0;
        await applyLoadedTree(scopedDoc.data().tree);
        return;
      }
      treeRevisionRef.current = 0;
      await applyLoadedTree([
        { id: `root-${Date.now()}`, title: "수업 자료", children: [] },
      ]);
    } catch (error) {
      console.error(error);
      if (isCurrent())
        setPdfSaveFeedback({
          tone: "error",
          message:
            "최신 수업 자료를 불러오지 못했습니다. 연결을 확인한 뒤 화면을 다시 열어 주세요.",
        });
    } finally {
      if (isCurrent()) setScreenBusyMessage(null);
    }
  };

  const saveTree = async (newTree: TreeNode[], silent = true) => {
    if (!canEdit || !treeLoadedRef.current || editorSessionRef.current.saving)
      return false;
    const session = editorSessionRef.current;
    session.saving = true;
    setScreenBusyMessage("목차를 저장하는 중입니다...");
    try {
      const result = await saveLessonTree(config, {
        expectedRevision: treeRevisionRef.current,
        tree: newTree,
      });
      if (!editorMountedRef.current || editorSessionRef.current !== session)
        return false;
      lessonWriteRecovery.acknowledge(lessonWriteRecovery.peek(teacherScope));
      treeRevisionRef.current = result.contentRevision;
      setTreeData(newTree);
      if (!silent) alert("목차를 저장했습니다.");
      return true;
    } catch (error) {
      if (editorMountedRef.current && editorSessionRef.current === session) {
        lessonWriteRecovery.acknowledge(lessonWriteRecovery.peek(teacherScope));
        alert(
          error instanceof Error ? error.message : "목차 저장에 실패했습니다.",
        );
      }
      return false;
    } finally {
      session.saving = false;
      if (editorMountedRef.current && editorSessionRef.current === session)
        setScreenBusyMessage(null);
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const openModal = (
    mode: "root" | "child" | "rename",
    node: TreeNode | null = null,
  ) => {
    setModalMode(mode);
    setTargetNode(node);
    setModalInput(mode === "rename" && node ? node.title : "");
    setModalOpen(true);
  };

  const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  };

  const replaceNodeTitle = (
    nodes: TreeNode[],
    id: string,
    title: string,
  ): TreeNode[] =>
    nodes.map((node) => {
      if (node.id === id) return { ...node, title };
      if (!node.children?.length) return node;
      return { ...node, children: replaceNodeTitle(node.children, id, title) };
    });

  const handleNodeClick = (node: TreeNode, level: number) => {
    if (level < 2) return toggleExpand(node.id);
    if (selectedNodeId !== node.id && !confirmDiscardChanges()) return;
    setSelectedNodeId(node.id);
    setSelectedNodeTitle(node.title);
    setSidebarOpen(false);
    setEditorTab("pdf");
    void loadLessonContent(node.id, node.title);
  };

  const handleModalConfirm = async () => {
    if (!canEdit) {
      alert(LEGACY_LESSON_READ_ONLY_MESSAGE);
      return;
    }
    const value = modalInput.trim();
    if (!value) return alert("이름을 입력해 주세요.");

    const nextTree = JSON.parse(JSON.stringify(treeData)) as TreeNode[];
    if (modalMode === "root") {
      const id = `u-${Date.now()}`;
      nextTree.push({ id, title: value, children: [] });
      setExpandedIds((prev) => new Set(prev).add(id));
    } else if (modalMode === "child" && targetNode) {
      const parent = findNode(nextTree, targetNode.id);
      if (parent) {
        const id = `u-${Date.now()}`;
        parent.children.push({ id, title: value, children: [] });
        setExpandedIds((prev) => new Set(prev).add(parent.id));
      }
    } else if (modalMode === "rename" && targetNode) {
      const node = findNode(nextTree, targetNode.id);
      if (node) {
        node.title = value;
      }
    }
    if (await saveTree(nextTree)) {
      if (modalMode === "rename" && selectedNodeId === targetNode?.id)
        setSelectedNodeTitle(value);
      setModalOpen(false);
    }
  };

  const handleDeleteNode = async (node: TreeNode) => {
    if (!canEdit) {
      alert(LEGACY_LESSON_READ_ONLY_MESSAGE);
      return;
    }
    if (!window.confirm(`'${node.title}' 및 하위 항목을 삭제할까요?`)) return;

    const removeRecursive = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter((item) => item.id !== node.id)
        .map((item) => ({
          ...item,
          children: removeRecursive(item.children || []),
        }));
    const nextTree = removeRecursive(treeData);
    if (!(await saveTree(nextTree))) return;
    if (selectedNodeId && findNode([node], selectedNodeId)) {
      setSelectedNodeId(null);
      setSelectedNodeTitle("");
      clearLessonEditor(true);
    }
  };

  const loadLessonContent = async (
    unitId: string,
    title: string,
    restored?: { recovery: LessonWriteRecovery; outcome: LessonWriteOutcome },
    initialSnapshot?: QueryDocumentSnapshot,
  ) => {
    const loadId = ++lessonLoadIdRef.current;
    const loadContext = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}/${unitId}`;
    // Selection state may not have committed yet when a server read resolves.
    // Bind the request immediately so a fast response does not leave revision null.
    if (editorSessionRef.current.context !== loadContext) {
      editorSessionRef.current = { context: loadContext, saving: false };
      recoveredAssetIdsRef.current = [];
    }
    lessonRevisionRef.current = null;
    setLessonTitle(title);
    setLessonVideo("");
    setLessonContent("");
    setBodySelection(null);
    setBodyInsertMessage("");
    setLessonVisibleToStudents(true);
    setLessonFootnotes([]);
    setFootnoteEditorSession(null);
    setPdfSaveFeedback(null);
    resetFootnoteImageDrafts();
    resetWorksheetState(true);
    deletedFootnoteAssetPathsRef.current = [];
    setScreenBusyMessage("수업 자료를 불러오는 중입니다...");
    try {
      const scopedRef = collection(
        db,
        getSemesterCollectionPath(config, "lessons"),
      );
      const scopedQuery = query(
        scopedRef,
        where("unitId", "==", unitId),
        limit(1),
      );
      const documents =
        initialSnapshot && !restored
          ? [initialSnapshot]
          : (await getDocsFromServer(scopedQuery)).docs;
      if (
        !editorMountedRef.current ||
        loadId !== lessonLoadIdRef.current ||
        editorSessionRef.current.context !== loadContext
      )
        return;
      if (documents.length === 0 && restored?.outcome.ok)
        throw new Error("저장 결과를 서버에서 확인하지 못했습니다.");
      if (documents.length > 0 || restored?.recovery.kind === "document") {
        const savedData = normalizeLessonData(documents[0]?.data() || {}, {
          unitId,
          title,
        });
        const failedInput =
          restored?.recovery.kind === "document" && !restored.outcome.ok
            ? restored.recovery.submission?.preparedInput ||
              restored.recovery.input
            : undefined;
        const localDraft =
          restored?.recovery.kind === "document"
            ? restored.recovery.localDraft
            : undefined;
        let data = failedInput
          ? normalizeLessonData({ ...savedData, ...failedInput.document })
          : savedData;
        if (localDraft?.general)
          data = normalizeLessonData({ ...data, ...localDraft.general });
        lessonRevisionRef.current =
          failedInput?.expectedRevision ?? savedData.contentRevision ?? 0;
        if (failedInput) {
          recoveredAssetIdsRef.current = [
            ...(failedInput.assetUploadIds || []),
          ];
          if (failedInput.tree) {
            setTreeData(failedInput.tree as TreeNode[]);
            treeRevisionRef.current = failedInput.expectedTreeRevision!;
          }
        }
        setLessonTitle(data.title || title);
        setLessonVideo(data.videoUrl);
        setLessonContent(data.contentHtml);
        setLessonVisibleToStudents(data.isVisibleToStudents);
        setLessonFootnotes(data.footnotes);
        setWorksheetFootnoteAnchors(
          normalizeWorksheetFootnoteAnchors(data.worksheetFootnoteAnchors),
        );
        setActiveFootnoteId(null);
        setActiveFootnoteAnchorId(null);
        setSourceArchivePickerFootnoteId(null);
        setLessonPdfName(data.pdfName);
        setLessonPdfUrl(data.pdfUrl);
        setLessonPdfStoragePath(data.pdfStoragePath);
        setLessonPdfProcessing(data.pdfProcessing);
        setWorksheetPageImages(
          normalizeWorksheetPageImages(data.worksheetPageImages),
        );
        setWorksheetTextRegions(
          normalizeWorksheetTextRegions(data.worksheetTextRegions),
        );
        setWorksheetBlanks(data.worksheetBlanks);
        setWorksheetExamHighlights(data.worksheetExamHighlights);
        if (failedInput && localDraft && !localDraft.uploaded) {
          setSelectedPdfFile(localDraft.pdfFile);
          setPreparedPdf(localDraft.preparedPdf);
          if (localDraft.preparedPdf) {
            setWorksheetPageImages(
              localDraft.preparedPdf.pageImages.map((page) => ({
                page: page.page,
                width: page.width,
                height: page.height,
                imageUrl: URL.createObjectURL(page.blob),
              })),
            );
          }
          setFootnoteImageDrafts(
            Object.fromEntries(
              Object.entries(localDraft.footnotes).map(([id, item]) => [
                id,
                {
                  ...item,
                  previewUrl: item.file ? URL.createObjectURL(item.file) : "",
                },
              ]),
            ),
          );
        }
        syncSavedSnapshots({
          selectedNodeId: unitId,
          lessonTitle: savedData.title || title,
          lessonVideo: savedData.videoUrl,
          lessonVisibleToStudents: savedData.isVisibleToStudents,
          lessonContent: savedData.contentHtml,
          lessonFootnotes: savedData.footnotes,
          worksheetFootnoteAnchors: normalizeWorksheetFootnoteAnchors(
            savedData.worksheetFootnoteAnchors,
          ),
          lessonPdfName: savedData.pdfName,
          lessonPdfUrl: savedData.pdfUrl,
          lessonPdfStoragePath: savedData.pdfStoragePath,
          lessonPdfProcessing: savedData.pdfProcessing,
          worksheetPageImages: normalizeWorksheetPageImages(
            savedData.worksheetPageImages,
          ),
          worksheetTextRegions: normalizeWorksheetTextRegions(
            savedData.worksheetTextRegions,
          ),
          worksheetBlanks: savedData.worksheetBlanks,
          worksheetExamHighlights: savedData.worksheetExamHighlights,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
      } else {
        lessonRevisionRef.current = 0;
        syncSavedSnapshots({
          selectedNodeId: unitId,
          lessonTitle: title,
          lessonVideo: "",
          lessonVisibleToStudents: true,
          lessonContent: "",
          lessonFootnotes: [],
          worksheetFootnoteAnchors: [],
          lessonPdfName: "",
          lessonPdfUrl: "",
          lessonPdfStoragePath: "",
          lessonPdfProcessing: createEmptyLessonPdfProcessingMeta(),
          worksheetPageImages: [],
          worksheetTextRegions: [],
          worksheetBlanks: [],
          worksheetExamHighlights: [],
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
        setWorksheetFootnoteAnchors([]);
        setActiveFootnoteId(null);
        setActiveFootnoteAnchorId(null);
        setSourceArchivePickerFootnoteId(null);
      }
      setLessonSaveState("saved");
      setPdfSaveState("saved");
      if (restored) {
        if (!restored.outcome.ok) {
          setPdfSaveFeedback({
            tone: "error",
            message: lessonWriteFailureMessage(restored.outcome.error),
          });
        }
        lessonWriteRecovery.acknowledge(restored.recovery);
      }
    } catch (error) {
      console.error(error);
      if (
        editorMountedRef.current &&
        loadId === lessonLoadIdRef.current &&
        editorSessionRef.current.context === loadContext
      )
        setPdfSaveFeedback({
          tone: "error",
          message:
            "최신 수업 자료를 불러오지 못했습니다. 연결을 확인한 뒤 화면을 다시 열어 주세요.",
        });
    }
    if (
      editorMountedRef.current &&
      loadId === lessonLoadIdRef.current &&
      editorSessionRef.current.context === loadContext
    )
      setScreenBusyMessage(null);
  };

  const handleEditorTabChange = (nextTab: LessonEditorTab) => {
    if (editorTab === nextTab) return;
    if (editorTab === "pdf" && nextTab !== "pdf" && hasUnsavedPdfChanges) {
      const confirmed = window.confirm(
        "저장하지 않은 PDF 편집 내용이 있습니다. 탭을 바꾸면 현재 편집 내용을 다시 확인해야 할 수 있습니다. 이동할까요?",
      );
      if (!confirmed) return;
    }
    setEditorTab(nextTab);
  };

  const handlePdfFileChange = (file: File | null) => {
    if (!file) {
      setSelectedPdfFile(null);
      setPreparedPdf(null);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      return;
    }
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    )
      return alert("PDF 파일만 업로드할 수 있습니다.");
    setSelectedPdfFile(file);
    void handlePreparePdf(file);
  };

  const handlePreparePdf = async (fileOverride?: File | null) => {
    const targetFile = fileOverride ?? selectedPdfFile;
    if (!targetFile) return alert("먼저 PDF 파일을 선택해 주세요.");
    setPdfBusy(true);
    setScreenBusyMessage("PDF 페이지를 준비하는 중입니다...");
    try {
      const { processPdfMapFile } = await import("../../lib/pdfMapProcessor");
      const processed = await processPdfMapFile(targetFile);
      const nextPageImages = processed.pageImages.map((page) => ({
        page: page.page,
        imageUrl: URL.createObjectURL(page.blob),
        width: page.width,
        height: page.height,
      }));
      revokeBlobUrls(worksheetPageImages);
      setPreparedPdf(processed);
      setSelectedPdfFile(targetFile);
      setLessonPdfName(targetFile.name);
      setWorksheetPageImages(nextPageImages);
      setWorksheetTextRegions(processed.regions);
      setWorksheetBlanks([]);
      setWorksheetExamHighlights([]);
      setWorksheetFootnoteAnchors([]);
      setBlankEditorMode(null);
      setActiveBlankId(null);
      setActiveExamHighlightId(null);
      setActiveFootnoteAnchorId(null);
      setDraftBlank(null);
      setDraftBlankAnswer("");
      setDraftBlankPrompt("");
    } catch (error) {
      console.error(error);
      alert("PDF 준비에 실패했습니다.");
    } finally {
      setPdfBusy(false);
      setScreenBusyMessage(null);
    }
  };

  const handleCreateBlankFromSelection = (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
    matchedRegions: LessonWorksheetTextRegion[],
    source: "ocr" | "manual",
  ) => {
    const pageImage =
      worksheetPageImages.find((item) => item.page === page) || null;
    const regionBounds = getBoundsFromRegions(matchedRegions, pageImage);
    const blank = createBlankFromRect(
      page,
      regionBounds || rect,
      matchedRegions.length ? "ocr" : source,
    );
    setBlankEditorMode("draft");
    setDraftBlank(blank);
    setDraftBlankAnswer(getBlankAnswerFromRegions(matchedRegions));
    setDraftBlankPrompt("");
    setActiveBlankId(null);
    setActiveExamHighlightId(null);
  };

  const handleConfirmDraftBlank = () => {
    const answer = draftBlankAnswer.trim();
    if (!answer) return alert("빈칸 정답을 입력해 주세요.");

    if (draftBlank) {
      const nextBlank = {
        ...draftBlank,
        answer,
        prompt: draftBlankPrompt.trim(),
      };
      setWorksheetBlanks((prev) => [...prev, nextBlank]);
      setBlankEditorMode(null);
      setDraftBlank(null);
      setDraftBlankAnswer("");
      setDraftBlankPrompt("");
      setActiveBlankId(null);
      return;
    }

    if (!activeBlankId) return;
    setWorksheetBlanks((prev) =>
      prev.map((blank) =>
        blank.id === activeBlankId
          ? {
              ...blank,
              answer,
              prompt: draftBlankPrompt.trim(),
            }
          : blank,
      ),
    );
    setBlankEditorMode(null);
    setDraftBlankAnswer("");
    setDraftBlankPrompt("");
    setActiveBlankId(null);
  };

  const handleSelectBlank = (blankId: string) => {
    const targetBlank =
      worksheetBlanks.find((blank) => blank.id === blankId) || null;
    if (!targetBlank) {
      resetBlankEditor();
      return;
    }
    setBlankEditorMode("existing");
    setActiveBlankId(blankId);
    setActiveExamHighlightId(null);
    setDraftBlank(null);
    setDraftBlankAnswer(targetBlank.answer);
    setDraftBlankPrompt(targetBlank.prompt || "");
  };

  const updateBlank = (
    blankId: string,
    patch: Partial<LessonWorksheetBlank>,
  ) => {
    setWorksheetBlanks((prev) =>
      prev.map((blank) =>
        blank.id === blankId ? { ...blank, ...patch } : blank,
      ),
    );
  };

  const handleDeleteBlank = (blankId: string) => {
    setWorksheetBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
    if (activeBlankId === blankId) {
      setBlankEditorMode(null);
      setActiveBlankId(null);
      setDraftBlankAnswer("");
      setDraftBlankPrompt("");
    }
  };

  const handleCreateExamHighlightFromSelection = (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
  ) => {
    const highlight = createExamHighlightFromRect(page, rect);
    setWorksheetExamHighlights((prev) => [...prev, highlight]);
    setActiveExamHighlightId(highlight.id);
    resetBlankEditor();
  };

  const handleSelectExamHighlight = (highlightId: string) => {
    const targetHighlight =
      worksheetExamHighlights.find(
        (highlight) => highlight.id === highlightId,
      ) || null;
    if (!targetHighlight) {
      setActiveExamHighlightId(null);
      return;
    }
    setActiveExamHighlightId(highlightId);
    resetBlankEditor();
  };

  const handleDeleteExamHighlight = (highlightId: string) => {
    setWorksheetExamHighlights((prev) =>
      prev.filter((highlight) => highlight.id !== highlightId),
    );
    if (activeExamHighlightId === highlightId) {
      setActiveExamHighlightId(null);
    }
  };

  const deleteStorageFolderRecursive = async (
    folderRef: StorageReference,
  ): Promise<void> => {
    const listing = await listAll(folderRef);
    await Promise.all(
      listing.items.map(() =>
        blockLegacyLessonMutationAsync().catch(() => undefined),
      ),
    );
    await Promise.all(
      listing.prefixes.map((childRef) =>
        deleteStorageFolderRecursive(childRef),
      ),
    );
  };

  const removeAttachedPdf = () => {
    if (!canEdit) return;
    if (!window.confirm("연결된 PDF 학습지를 제거할까요?")) return;
    resetWorksheetState(true);
    setPdfSaveFeedback(null);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  const uploadWorksheetAssets = async (
    unitId: string,
    context: LessonUploadContext,
  ): Promise<UploadedWorksheetAssets> => {
    if (!selectedPdfFile || !preparedPdf)
      return {
        pdfName: lessonPdfName,
        pdfUrl: lessonPdfUrl,
        pdfStoragePath: lessonPdfStoragePath,
        pageImages: worksheetPageImages,
        textRegions: worksheetTextRegions,
        pdfProcessing: lessonPdfProcessing,
        pendingIncomingUpload: null,
      };
    const { expectedRevision, expectedUid } = context;
    const pageImages: LessonWorksheetPageImage[] = [];
    for (const page of preparedPdf.pageImages) {
      const asset = await uploadLessonAsset(config, {
        unitId,
        expectedRevision,
        expectedUid,
        kind: "PAGE",
        file: page.blob,
      });
      context.assetUploadIds.push(asset.uploadId);
      pageImages.push({
        page: page.page,
        imageUrl: asset.url,
        width: page.width,
        height: page.height,
      });
    }
    const original = await uploadLessonAsset(config, {
      unitId,
      expectedRevision,
      expectedUid,
      kind: "PDF",
      file: selectedPdfFile,
      originalName: selectedPdfFile.name,
    });
    context.assetUploadIds.push(original.uploadId);
    return {
      pdfName: selectedPdfFile.name,
      pdfUrl: original.url,
      pdfStoragePath: original.storagePath,
      pageImages,
      textRegions: preparedPdf.regions,
      pdfProcessing: normalizeLessonPdfProcessingMeta(original.pdfProcessing),
      pendingIncomingUpload: null,
    };
  };

  const restoreFootnoteImageDraft = (
    footnoteId: string,
    draft: FootnoteImageDraft | null,
  ) => {
    setFootnoteImageDrafts((prev) => {
      const current = prev[footnoteId];
      if (
        current?.previewUrl.startsWith("blob:") &&
        current.previewUrl !== draft?.previewUrl
      ) {
        URL.revokeObjectURL(current.previewUrl);
      }
      if (!draft) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[footnoteId];
        return next;
      }
      return {
        ...prev,
        [footnoteId]: draft,
      };
    });
  };

  const openCreateFootnoteEditor = (options?: {
    pendingAnchorPlacement?: PendingFootnoteAnchorPlacement | null;
    insertIntoBody?: boolean;
  }) => {
    const draft = createLessonFootnoteDraft({}, lessonFootnotes);
    setFootnoteEditorSession({
      mode: "create",
      draft,
      sourceFootnoteId: null,
      initialImageDraft: cloneFootnoteImageDraft(footnoteImageDrafts[draft.id]),
      pendingAnchorPlacement: options?.pendingAnchorPlacement || null,
      insertIntoBody: Boolean(options?.insertIntoBody),
    });
    setActiveFootnoteId(null);
    setActiveFootnoteAnchorId(null);
  };

  const openEditFootnoteEditor = (footnoteId: string) => {
    const target = lessonFootnotes.find(
      (footnote) => footnote.id === footnoteId,
    );
    if (!target) return;
    setFootnoteEditorSession({
      mode: "edit",
      draft: { ...target },
      sourceFootnoteId: footnoteId,
      initialImageDraft: cloneFootnoteImageDraft(
        footnoteImageDrafts[footnoteId],
      ),
      pendingAnchorPlacement: null,
      insertIntoBody: false,
    });
    setActiveFootnoteId(footnoteId);
  };

  const handleAddFootnote = () => {
    openCreateFootnoteEditor();
  };

  const handleMoveFootnote = (footnoteId: string, direction: -1 | 1) => {
    setLessonFootnotes((prev) => {
      const currentIndex = prev.findIndex(
        (footnote) => footnote.id === footnoteId,
      );
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [target] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, target);
      return reindexFootnotes(next);
    });
  };

  const handleDeleteFootnote = (footnoteId: string) => {
    const currentFootnote = lessonFootnotes.find(
      (footnote) => footnote.id === footnoteId,
    );
    const draft = footnoteImageDrafts[footnoteId];
    if (draft?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(draft.previewUrl);
    }
    if (currentFootnote?.imageStoragePath) {
      deletedFootnoteAssetPathsRef.current.push(
        currentFootnote.imageStoragePath,
      );
    }
    setFootnoteImageDrafts((prev) => {
      const next = { ...prev };
      delete next[footnoteId];
      return next;
    });
    setLessonFootnotes((prev) =>
      reindexFootnotes(prev.filter((footnote) => footnote.id !== footnoteId)),
    );
    setWorksheetFootnoteAnchors((prev) =>
      prev.filter((anchor) => anchor.footnoteId !== footnoteId),
    );
    if (activeFootnoteId === footnoteId) {
      setActiveFootnoteId(null);
      setActiveFootnoteAnchorId(null);
    }
    if (sourceArchivePickerFootnoteId === footnoteId) {
      setSourceArchivePickerFootnoteId(null);
    }
    if (footnoteEditorSession?.draft.id === footnoteId) {
      setFootnoteEditorSession(null);
    }
  };

  const handleSelectFootnoteImage = (footnoteId: string, file: File | null) => {
    setFootnoteImageDrafts((prev) => {
      const existing = prev[footnoteId];
      if (existing?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(existing.previewUrl);
      }
      if (!file) {
        return prev;
      }
      return {
        ...prev,
        [footnoteId]: {
          file,
          previewUrl: URL.createObjectURL(file),
          removeExisting: false,
        },
      };
    });
  };

  const handleRemoveFootnoteImage = (footnoteId: string) => {
    setFootnoteImageDrafts((prev) => {
      const existing = prev[footnoteId];
      if (existing?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(existing.previewUrl);
      }
      return {
        ...prev,
        [footnoteId]: {
          file: null,
          previewUrl: "",
          removeExisting: true,
        },
      };
    });
    if (footnoteEditorSession?.draft.id === footnoteId) {
      setFootnoteEditorSession((prev) =>
        prev
          ? {
              ...prev,
              draft: {
                ...prev.draft,
                imageUrl: "",
                imageStoragePath: "",
              },
            }
          : prev,
      );
      return;
    }
    setLessonFootnotes((prev) =>
      prev.map((footnote) =>
        footnote.id === footnoteId
          ? { ...footnote, imageUrl: "", imageStoragePath: "" }
          : footnote,
      ),
    );
  };

  const getFootnotePreviewUrl = <
    T extends { id: string; imageUrl?: string | null },
  >(
    footnote: T,
  ) => {
    const draft = footnoteImageDrafts[footnote.id];
    if (!draft) return footnote.imageUrl || "";
    if (draft.removeExisting) return "";
    return draft.previewUrl || footnote.imageUrl || "";
  };

  const handleBodySelectionChange = (selection: {
    start: number;
    end: number;
  }) => {
    setBodySelection(selection);
  };

  const insertFootnoteTokenIntoContent = (anchorKey: string) => {
    const token = buildFootnoteToken(anchorKey);
    setLessonContent((prev) =>
      replaceOrInsertFootnoteToken(prev, token, {
        selectionStart: bodySelection?.start,
        selectionEnd: bodySelection?.end,
        insertMode: bodySelection ? "cursor" : "end",
      }),
    );
    setBodyInsertMessage(
      "본문에 각주 버튼을 넣었습니다. 오른쪽 저장 버튼을 눌러 반영하세요.",
    );
  };

  const handleAddFootnoteAndInsert = () => {
    openCreateFootnoteEditor({ insertIntoBody: true });
  };

  const handleOpenSourceArchivePicker = (footnoteId: string) => {
    if (footnoteEditorSession?.draft.id === footnoteId) {
      setActiveFootnoteId(
        footnoteEditorSession.sourceFootnoteId || activeFootnoteId,
      );
    } else {
      setActiveFootnoteId(footnoteId);
    }
    setSourceArchiveSearch("");
    setSourceArchivePickerFootnoteId(footnoteId);
  };

  const handleClearSourceArchiveImage = (footnoteId: string) => {
    if (footnoteEditorSession?.draft.id === footnoteId) {
      setFootnoteEditorSession((prev) =>
        prev
          ? {
              ...prev,
              draft: {
                ...prev.draft,
                sourceArchiveAssetId: "",
                sourceArchiveImagePath: "",
                sourceArchiveThumbPath: "",
                sourceArchiveTitle: "",
              },
            }
          : prev,
      );
      return;
    }
    setLessonFootnotes((prev) =>
      prev.map((footnote) =>
        footnote.id === footnoteId
          ? {
              ...footnote,
              sourceArchiveAssetId: "",
              sourceArchiveImagePath: "",
              sourceArchiveThumbPath: "",
              sourceArchiveTitle: "",
            }
          : footnote,
      ),
    );
  };

  const handleSelectSourceArchiveAsset = (asset: SourceArchiveAsset) => {
    if (!sourceArchivePickerFootnoteId) return;
    if (footnoteEditorSession?.draft.id === sourceArchivePickerFootnoteId) {
      setFootnoteEditorSession((prev) =>
        prev
          ? {
              ...prev,
              draft: {
                ...prev.draft,
                sourceArchiveAssetId: asset.id,
                sourceArchiveImagePath:
                  asset.image.displayPath ||
                  asset.image.thumbPath ||
                  asset.image.originalPath,
                sourceArchiveThumbPath: asset.image.thumbPath || "",
                sourceArchiveTitle:
                  asset.title || asset.image.originalName || "",
              },
            }
          : prev,
      );
      setSourceArchiveSearch("");
      setSourceArchivePickerFootnoteId(null);
      return;
    }
    setLessonFootnotes((prev) =>
      prev.map((footnote) =>
        footnote.id === sourceArchivePickerFootnoteId
          ? {
              ...footnote,
              sourceArchiveAssetId: asset.id,
              sourceArchiveImagePath:
                asset.image.displayPath ||
                asset.image.thumbPath ||
                asset.image.originalPath,
              sourceArchiveThumbPath: asset.image.thumbPath || "",
              sourceArchiveTitle: asset.title || asset.image.originalName || "",
            }
          : footnote,
      ),
    );
    setActiveFootnoteId(sourceArchivePickerFootnoteId);
    setSourceArchiveSearch("");
    setSourceArchivePickerFootnoteId(null);
  };

  const handleSelectFootnote = (footnoteId: string) => {
    setActiveFootnoteId(footnoteId);
    setActiveFootnoteAnchorId(null);
  };

  const handleSelectFootnoteAnchor = (anchorId: string) => {
    const matchedAnchor = worksheetFootnoteAnchors.find(
      (anchor) => anchor.id === anchorId,
    );
    setActiveFootnoteAnchorId(anchorId);
    if (matchedAnchor?.footnoteId) {
      setActiveFootnoteId(matchedAnchor.footnoteId);
    }
  };

  const handleOpenFootnoteEditorFromAnchor = (anchorId: string) => {
    const matchedAnchor = worksheetFootnoteAnchors.find(
      (anchor) => anchor.id === anchorId,
    );
    if (!matchedAnchor?.footnoteId) return;
    handleSelectFootnoteAnchor(anchorId);
    openEditFootnoteEditor(matchedAnchor.footnoteId);
  };

  const handleDeleteFootnoteAnchor = (anchorId: string) => {
    setWorksheetFootnoteAnchors((prev) =>
      prev.filter((anchor) => anchor.id !== anchorId),
    );
    if (activeFootnoteAnchorId === anchorId) {
      setActiveFootnoteAnchorId(null);
    }
  };

  const handleCreateFootnoteAnchorFromSelection = (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
  ) => {
    openCreateFootnoteEditor({
      pendingAnchorPlacement: {
        page,
        rect,
      },
    });
  };

  const commitFootnoteEditorSession = useCallback(
    (params: {
      session: FootnoteEditorSession;
      lessonContent: string;
      lessonFootnotes: LessonFootnote[];
      worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
      bodySelection: {
        start: number;
        end: number;
      } | null;
    }) => {
      const { session } = params;
      const isEditMode = session.mode === "edit" && session.sourceFootnoteId;
      const sourceFootnoteId = session.sourceFootnoteId;
      const existingFootnote =
        isEditMode && sourceFootnoteId
          ? params.lessonFootnotes.find(
              (footnote) => footnote.id === sourceFootnoteId,
            ) || null
          : null;
      const nextFootnote = existingFootnote
        ? mergeFootnotePatch(
            existingFootnote,
            session.draft,
            params.lessonFootnotes,
          )
        : sanitizeLessonFootnote(session.draft, params.lessonFootnotes);
      const nextFootnotes =
        existingFootnote && sourceFootnoteId
          ? reindexFootnotes(
              params.lessonFootnotes.map((footnote) =>
                footnote.id === sourceFootnoteId ? nextFootnote : footnote,
              ),
            )
          : reindexFootnotes([...params.lessonFootnotes, nextFootnote]);
      const nextAnchorId = session.pendingAnchorPlacement
        ? `footnote-anchor-${Date.now()}`
        : "";
      const nextAnchors = session.pendingAnchorPlacement
        ? sortWorksheetFootnoteAnchors([
            ...params.worksheetFootnoteAnchors,
            {
              id: nextAnchorId,
              footnoteId: nextFootnote.id,
              page: session.pendingAnchorPlacement.page,
              leftRatio: session.pendingAnchorPlacement.rect.leftRatio,
              topRatio: session.pendingAnchorPlacement.rect.topRatio,
              widthRatio: session.pendingAnchorPlacement.rect.widthRatio,
              heightRatio: session.pendingAnchorPlacement.rect.heightRatio,
            },
          ])
        : params.worksheetFootnoteAnchors;

      const nextLessonContent = session.insertIntoBody
        ? replaceOrInsertFootnoteToken(
            params.lessonContent,
            buildFootnoteToken(nextFootnote.anchorKey),
            {
              selectionStart: params.bodySelection?.start,
              selectionEnd: params.bodySelection?.end,
              insertMode: params.bodySelection ? "cursor" : "end",
            },
          )
        : params.lessonContent;

      return {
        lessonContent: nextLessonContent,
        lessonFootnotes: nextFootnotes,
        worksheetFootnoteAnchors: nextAnchors,
        activeFootnoteId: nextFootnote.id,
        activeFootnoteAnchorId: nextAnchorId || null,
        bodyInsertMessage: session.insertIntoBody
          ? "본문에 각주 버튼을 넣었습니다. 상단 저장 또는 오른쪽 PDF 저장 버튼으로 최종 저장하세요."
          : null,
      };
    },
    [],
  );

  const handleFootnoteEditorDraftChange = (patch: Partial<LessonFootnote>) => {
    setFootnoteEditorSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        draft: mergeFootnoteDraftPatch(prev.draft, patch),
      };
    });
  };

  const handleCloseFootnoteEditor = () => {
    if (footnoteEditorSession) {
      restoreFootnoteImageDraft(
        footnoteEditorSession.draft.id,
        footnoteEditorSession.initialImageDraft,
      );
    }
    setFootnoteEditorSession(null);
    setActiveFootnoteId(null);
    setActiveFootnoteAnchorId(null);
    setSourceArchivePickerFootnoteId(null);
    setSourceArchiveSearch("");
  };

  const handleSaveFootnoteEditor = () => {
    if (!footnoteEditorSession) return;
    const committed = commitFootnoteEditorSession({
      session: footnoteEditorSession,
      lessonContent,
      lessonFootnotes,
      worksheetFootnoteAnchors,
      bodySelection,
    });
    setLessonContent(committed.lessonContent);
    setLessonFootnotes(committed.lessonFootnotes);
    setWorksheetFootnoteAnchors(committed.worksheetFootnoteAnchors);
    if (committed.bodyInsertMessage) {
      setBodyInsertMessage(committed.bodyInsertMessage);
    }
    setActiveFootnoteId(committed.activeFootnoteId);
    setActiveFootnoteAnchorId(committed.activeFootnoteAnchorId);
    setFootnoteEditorSession(null);
    setSourceArchivePickerFootnoteId(null);
    setSourceArchiveSearch("");
  };

  const uploadFootnoteAssets = async (
    unitId: string,
    footnotes: LessonFootnote[],
    context: LessonUploadContext,
  ) => {
    const nextFootnotes: LessonFootnote[] = [];
    const staleAssetPathsToDelete: string[] = [];

    for (const footnote of footnotes) {
      const draft = footnoteImageDrafts[footnote.id];
      let nextFootnote = { ...footnote };

      // Publish only the selected archive image as a lesson-owned attachment.
      // Students never receive permission to browse the teacher archive.
      if (footnote.sourceArchiveImagePath && !draft?.file) {
        const file = await getBlob(
          ref(await getFirebaseStorage(), footnote.sourceArchiveImagePath),
          6 * 1024 * 1024,
        );
        const asset = await uploadLessonAsset(config, {
          unitId,
          expectedRevision: context.expectedRevision,
          expectedUid: context.expectedUid,
          kind: "FOOTNOTE",
          file,
          originalName: footnote.sourceArchiveTitle || "",
        });
        context.assetUploadIds.push(asset.uploadId);
        nextFootnote = {
          ...nextFootnote,
          contentType: "image",
          imageUrl: asset.url,
          imageStoragePath: asset.storagePath,
          sourceArchiveAssetId: "",
          sourceArchiveImagePath: "",
          sourceArchiveThumbPath: "",
          sourceArchiveTitle: "",
        };
      }

      if (draft?.file) {
        const asset = await uploadLessonAsset(config, {
          unitId,
          expectedRevision: context.expectedRevision,
          expectedUid: context.expectedUid,
          kind: "FOOTNOTE",
          file: draft.file,
          originalName: draft.file.name,
        });
        context.assetUploadIds.push(asset.uploadId);
        const uploadedAsset = {
          imageUrl: asset.url,
          imageStoragePath: asset.storagePath,
        };
        nextFootnote = {
          ...nextFootnote,
          contentType: "image",
          sourceArchiveAssetId: "",
          sourceArchiveImagePath: "",
          sourceArchiveThumbPath: "",
          sourceArchiveTitle: "",
          imageUrl: uploadedAsset.imageUrl,
          imageStoragePath: uploadedAsset.imageStoragePath,
        };
        if (
          footnote.imageStoragePath &&
          footnote.imageStoragePath !== uploadedAsset.imageStoragePath
        ) {
          staleAssetPathsToDelete.push(footnote.imageStoragePath);
        }
      } else if (draft?.removeExisting && !footnote.sourceArchiveImagePath) {
        if (footnote.imageStoragePath) {
          staleAssetPathsToDelete.push(footnote.imageStoragePath);
        }
        nextFootnote = {
          ...nextFootnote,
          imageUrl: "",
          imageStoragePath: "",
        };
      }

      nextFootnotes.push(nextFootnote);
    }

    return {
      footnotes: reindexFootnotes(nextFootnotes),
      staleAssetPathsToDelete,
    };
  };

  const saveLesson = async (options?: {
    source?: "header" | "pdf-floating";
  }) => {
    if (
      !canEdit ||
      !selectedNodeId ||
      editorSessionRef.current.saving ||
      lessonRevisionRef.current === null
    )
      return;
    const session = editorSessionRef.current;
    const source = options?.source || "header";
    const savePdf =
      source === "pdf-floating" ||
      (source === "header" && hasUnsavedPdfChanges);
    const saveMeta = source === "header" && hasUnsavedMetaChanges;
    if (!savePdf && !saveMeta) return;
    if (savePdf && selectedPdfFile && !preparedPdf)
      return alert("PDF 페이지 추출이 끝날 때까지 기다려 주세요.");
    const committed = footnoteEditorSession
      ? commitFootnoteEditorSession({
          session: footnoteEditorSession,
          lessonContent,
          lessonFootnotes,
          worksheetFootnoteAnchors,
          bodySelection,
        })
      : null;
    const meta = buildNormalizedGeneralLessonDraft({
      lessonTitle,
      lessonVideo,
      lessonVisibleToStudents,
    });
    const title = saveMeta
      ? meta.title
      : savedLessonState.title || selectedNodeTitle;
    const videoUrl = saveMeta ? meta.videoUrl : savedLessonState.videoUrl;
    const visible = saveMeta
      ? meta.isVisibleToStudents
      : savedLessonState.isVisibleToStudents;
    const expectedRevision = lessonRevisionRef.current;
    const expectedTreeRevision = treeRevisionRef.current;
    const retainedAssetIds = [...recoveredAssetIdsRef.current];
    const normalized = savePdf
      ? buildNormalizedPdfEditorDraft({
          lessonContent: committed?.lessonContent ?? lessonContent,
          lessonFootnotes: committed?.lessonFootnotes ?? lessonFootnotes,
          worksheetFootnoteAnchors:
            committed?.worksheetFootnoteAnchors ?? worksheetFootnoteAnchors,
          lessonPdfName,
          lessonPdfUrl,
          lessonPdfStoragePath,
          lessonPdfProcessing,
          worksheetPageImages,
          worksheetTextRegions,
          worksheetBlanks,
          worksheetExamHighlights,
        })
      : null;
    const nextTree =
      saveMeta && title !== selectedNodeTitle
        ? replaceNodeTitle(treeData, selectedNodeId, title)
        : undefined;
    const documentFor = (pdf: typeof normalized) => ({
      title,
      videoUrl,
      isVisibleToStudents: visible,
      ...(pdf
        ? {
            contentHtml: pdf.contentHtml,
            pdfName: pdf.pdfName,
            pdfUrl: pdf.pdfUrl,
            pdfStoragePath: pdf.pdfStoragePath,
            worksheetPageImages: pdf.worksheetPageImages,
            worksheetTextRegions: pdf.worksheetTextRegions,
            worksheetBlanks: pdf.worksheetBlanks,
            worksheetExamHighlights: pdf.worksheetExamHighlights,
            worksheetFootnoteAnchors: pdf.worksheetFootnoteAnchors,
            footnotes: pdf.footnotes,
          }
        : {}),
    });
    session.saving = true;
    setScreenBusyMessage("파일을 확인하고 수업 자료를 저장하는 중입니다...");
    if (saveMeta) setLessonSaveState("saving");
    if (savePdf) setPdfSaveState("saving");
    try {
      emitSessionActivity();
      let draft = normalized;
      const result = await saveLessonDocument(
        config,
        {
          unitId: selectedNodeId,
          expectedRevision,
          assetUploadIds: retainedAssetIds,
          document: documentFor(normalized),
          ...(nextTree ? { tree: nextTree, expectedTreeRevision } : {}),
        },
        normalized
          ? {
              localDraft: {
                pdfFile: selectedPdfFile,
                preparedPdf,
                footnotes: Object.fromEntries(
                  Object.entries(footnoteImageDrafts).map(([id, item]) => [
                    id,
                    { file: item.file, removeExisting: item.removeExisting },
                  ]),
                ),
                ...(!saveMeta && hasUnsavedMetaChanges
                  ? { general: meta }
                  : {}),
              },
              prepare: async (ownerUid) => {
                const context = {
                  expectedRevision,
                  expectedUid: ownerUid,
                  assetUploadIds: [...retainedAssetIds],
                };
                const worksheet = await uploadWorksheetAssets(
                  selectedNodeId,
                  context,
                );
                const notes = await uploadFootnoteAssets(
                  selectedNodeId,
                  normalized.footnotes,
                  context,
                );
                draft = buildNormalizedPdfEditorDraft({
                  lessonContent: normalized.contentHtml,
                  lessonFootnotes: notes.footnotes,
                  worksheetFootnoteAnchors: normalized.worksheetFootnoteAnchors,
                  lessonPdfName: worksheet.pdfName,
                  lessonPdfUrl: worksheet.pdfUrl,
                  lessonPdfStoragePath: worksheet.pdfStoragePath,
                  lessonPdfProcessing: worksheet.pdfProcessing,
                  worksheetPageImages: worksheet.pageImages,
                  worksheetTextRegions: worksheet.textRegions,
                  worksheetBlanks: normalized.worksheetBlanks,
                  worksheetExamHighlights: normalized.worksheetExamHighlights,
                });
                return {
                  document: documentFor(draft),
                  assetUploadIds: context.assetUploadIds,
                };
              },
            }
          : undefined,
      );
      if (!editorMountedRef.current || editorSessionRef.current !== session)
        return;
      lessonRevisionRef.current = result.contentRevision;
      if (nextTree && result.treeRevision !== null) {
        treeRevisionRef.current = result.treeRevision;
        setTreeData(nextTree);
        setSelectedNodeTitle(title);
      }
      if (saveMeta) {
        setLessonTitle(title);
        setLessonVideo(videoUrl);
        syncSavedMetaState({
          selectedNodeId,
          lessonTitle: title,
          lessonVideo: videoUrl,
          lessonVisibleToStudents: visible,
        });
        setLessonSaveState("saved");
      }
      if (draft) {
        draft = {
          ...draft,
          pdfProcessing: normalizeLessonPdfProcessingMeta(
            result.pdfProcessing,
            { pdfName: draft.pdfName, pdfStoragePath: draft.pdfStoragePath },
          ),
        };
        setLessonContent(draft.contentHtml);
        setLessonFootnotes(draft.footnotes);
        setLessonPdfName(draft.pdfName);
        setLessonPdfUrl(draft.pdfUrl);
        setLessonPdfStoragePath(draft.pdfStoragePath);
        setLessonPdfProcessing(draft.pdfProcessing);
        setWorksheetPageImages(draft.worksheetPageImages);
        setWorksheetTextRegions(draft.worksheetTextRegions);
        setWorksheetBlanks(draft.worksheetBlanks);
        setWorksheetExamHighlights(draft.worksheetExamHighlights);
        setWorksheetFootnoteAnchors(draft.worksheetFootnoteAnchors);
        setPreparedPdf(null);
        setSelectedPdfFile(null);
        resetFootnoteImageDrafts();
        deletedFootnoteAssetPathsRef.current = [];
        if (committed) {
          setFootnoteEditorSession(null);
          setActiveFootnoteId(committed.activeFootnoteId);
          setActiveFootnoteAnchorId(committed.activeFootnoteAnchorId);
          setSourceArchivePickerFootnoteId(null);
          setSourceArchiveSearch("");
        }
        syncSavedPdfState({
          selectedNodeId,
          lessonContent: draft.contentHtml,
          lessonFootnotes: draft.footnotes,
          worksheetFootnoteAnchors: draft.worksheetFootnoteAnchors,
          lessonPdfName: draft.pdfName,
          lessonPdfUrl: draft.pdfUrl,
          lessonPdfStoragePath: draft.pdfStoragePath,
          lessonPdfProcessing: draft.pdfProcessing,
          worksheetPageImages: draft.worksheetPageImages,
          worksheetTextRegions: draft.worksheetTextRegions,
          worksheetBlanks: draft.worksheetBlanks,
          worksheetExamHighlights: draft.worksheetExamHighlights,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
        setPdfSaveState("saved");
      }
      setPdfSaveFeedback({
        tone: "success",
        message: "수업 자료를 저장했습니다.",
      });
      if (source === "header") alert("수업 자료를 저장했습니다.");
      recoveredAssetIdsRef.current = [];
      lessonWriteRecovery.acknowledge(lessonWriteRecovery.peek(teacherScope));
    } catch (error) {
      if (!editorMountedRef.current || editorSessionRef.current !== session)
        return;
      const recovery = lessonWriteRecovery.peek(teacherScope);
      if (isLessonDocumentUnconfirmed(recovery)) setUnconfirmedWrite(recovery!);
      else lessonWriteRecovery.acknowledge(recovery);
      const message =
        error instanceof Error
          ? error.message
          : "수업 자료를 저장하지 못했습니다. 입력 내용을 유지했습니다.";
      if (saveMeta) setLessonSaveState("dirty");
      if (savePdf) setPdfSaveState("dirty");
      setPdfSaveFeedback({ tone: "error", message });
      if (source === "header") alert(message);
    } finally {
      session.saving = false;
      if (editorMountedRef.current && editorSessionRef.current === session)
        setScreenBusyMessage(null);
    }
  };

  const retryUnconfirmedWrite = async () => {
    const recovery = unconfirmedWrite;
    if (!recovery || recovery.scope !== teacherScope || recovery.pending)
      return;
    setScreenBusyMessage("처음 요청한 저장 결과를 다시 확인하는 중입니다...");
    try {
      await retryLessonDocumentSave(recovery);
    } catch (error) {
      if (
        teacherScopeRef.current === recovery.scope &&
        editorMountedRef.current
      )
        setPdfSaveFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "저장 결과를 다시 확인해 주세요.",
        });
    } finally {
      if (
        teacherScopeRef.current === recovery.scope &&
        editorMountedRef.current
      ) {
        setScreenBusyMessage(null);
        if (!isLessonDocumentUnconfirmed(recovery)) {
          setUnconfirmedWrite(null);
          await loadTree(true);
        }
      }
    }
  };

  const TreeCard = ({ node, level }: { node: TreeNode; level: number }) => {
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const isLeaf = level >= 2;
    const canManageUnit = level <= 2;
    return (
      <div
        style={{ marginLeft: level > 0 ? 16 : 0 }}
        className="mb-1 select-none"
      >
        <div
          className={`group flex cursor-pointer items-start rounded p-2 transition-colors ${isSelected ? "bg-blue-50 font-bold text-blue-600" : "hover:bg-gray-50"}`}
          onClick={(event) => {
            event.stopPropagation();
            handleNodeClick(node, level);
          }}
        >
          <div className="mr-1 w-6 text-center text-gray-400">
            {!isLeaf && (
              <i
                className={`fas fa-caret-${isExpanded ? "down" : "right"} transition-transform`}
              ></i>
            )}
          </div>
          <div className="mr-2 text-yellow-500">
            <i
              className={`fas ${isLeaf ? "fa-file-alt text-gray-400" : isExpanded ? "fa-folder-open" : "fa-folder"}`}
            ></i>
          </div>
          <div className="min-w-0 flex-1">
            <span
              className="block truncate text-sm leading-5 group-hover:whitespace-normal group-hover:break-words"
              title={node.title}
            >
              {node.title}
            </span>
          </div>
          {canManageUnit && (
            <div className="pointer-events-none ml-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              {!isLeaf && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openModal("child", node);
                  }}
                  className="rounded p-1 text-green-600 hover:bg-green-100"
                  title="하위 항목 추가"
                >
                  <i className="fas fa-plus text-xs"></i>
                </button>
              )}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  openModal("rename", node);
                }}
                className="rounded p-1 text-blue-600 hover:bg-blue-100"
                title="이름 수정"
              >
                <i className="fas fa-pen text-xs"></i>
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteNode(node);
                }}
                className="rounded p-1 text-red-600 hover:bg-red-100"
                title="삭제"
              >
                <i className="fas fa-trash text-xs"></i>
              </button>
            </div>
          )}
        </div>
        {!isLeaf && isExpanded && node.children?.length > 0 && (
          <div className="mt-1">
            {node.children.map((child) => (
              <TreeCard key={child.id} node={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (unconfirmedWrite?.scope === teacherScope)
    return (
      <div key="unconfirmed" className="min-h-screen bg-gray-50 p-4 md:p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-800">
            저장 결과 확인이 필요합니다.
          </h2>
          <p role="status" className="mt-3 text-sm leading-6 text-gray-600">
            처음 요청한 내용과 파일을 보관하고 있습니다. 저장 결과를 확인한 뒤
            편집을 이어갈 수 있습니다.
          </p>
          {pdfSaveFeedback?.tone === "error" && (
            <p className="mt-3 text-sm text-red-600">
              {pdfSaveFeedback.message}
            </p>
          )}
          <button
            type="button"
            autoFocus
            disabled={unconfirmedWrite.pending}
            onClick={() => void retryUnconfirmedWrite()}
            className="mt-4 min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {unconfirmedWrite.pending
              ? "저장 결과 확인 중..."
              : "저장 결과 다시 확인"}
          </button>
        </div>
      </div>
    );

  return (
    <div key="editor" className="flex min-h-screen flex-col bg-gray-50">
      <div
        ref={(node) => {
          if (node) node.inert = Boolean(screenBusyMessage);
        }}
        className="relative flex flex-1 flex-col px-4 py-6 lg:px-6 xl:px-8"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-xl font-bold text-gray-800 lg:text-2xl">
            <i className="fas fa-sitemap mr-2 text-blue-500"></i>수업 자료 관리
          </h2>
        </div>
        {!canEdit && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            <p>{LEGACY_LESSON_READ_ONLY_MESSAGE}</p>
          </div>
        )}
        {handoffAction && (
          <div
            className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800"
            role="status"
          >
            <p>{buildLegacyLessonManagementHandoffMessage(handoffAction)}</p>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-6 pb-4 lg:flex-row">
          <LessonTreePanel
            treeData={treeData}
            sidebarOpen={sidebarOpen}
            onCloseSidebar={() => setSidebarOpen(false)}
            onOpenRootModal={() => openModal("root")}
            onSaveTree={() => void saveTree(treeData, false)}
            renderTreeNode={(node, level) => (
              <TreeCard key={node.id} node={node} level={level} />
            )}
          />
          <div className="relative flex min-h-[600px] min-w-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
            {!selectedNodeId ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white p-6 text-center text-gray-400">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-50">
                  <i className="fas fa-list text-4xl text-blue-400"></i>
                </div>
                <p className="text-lg font-bold text-gray-600">
                  {!configReady
                    ? "학기 설정을 확인하는 중입니다."
                    : pdfSaveFeedback?.tone === "error"
                      ? "수업 자료를 준비하지 못했습니다."
                      : "수업 자료를 선택해 주세요."}
                </p>
                <p className="mt-2 text-sm">
                  {pdfSaveFeedback?.tone === "error"
                    ? pdfSaveFeedback.message
                    : "왼쪽 트리에서 말단 수업 항목을 선택하면 편집을 시작할 수 있습니다."}
                </p>
              </div>
            ) : (
              <>
                <LessonEditorHeader
                  lessonTitle={lessonTitle}
                  lessonVisibleToStudents={lessonVisibleToStudents}
                  saveStateLabel={primarySaveStateLabel}
                  saveStateTone={combinedSaveStateTone}
                  saveButtonLabel={primarySaveButtonLabel}
                  disableSave={disableHeaderSave}
                  onLessonTitleChange={setLessonTitle}
                  onToggleVisible={setLessonVisibleToStudents}
                  onSave={() => void saveLesson({ source: "header" })}
                />
                <div className="border-b border-gray-200 bg-white px-4 py-2">
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleEditorTabChange(tab.id)}
                        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${editorTab === tab.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/80 hover:text-slate-900"}`}
                      >
                        <i className={`fas ${tab.icon} mr-2 text-xs`}></i>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 flex-1 p-3 lg:p-4">
                  {editorTab === "pdf" && (
                    <div className="space-y-4">
                      <LessonPdfSection
                        pdfBusy={pdfBusy}
                        selectedPdfFile={selectedPdfFile}
                        lessonPdfName={lessonPdfName}
                        lessonPdfUrl={lessonPdfUrl}
                        pdfProcessing={lessonPdfProcessing}
                        worksheetPageImages={worksheetPageImages}
                        worksheetTextRegions={worksheetTextRegions}
                        worksheetBlanks={worksheetBlanks}
                        worksheetExamHighlights={sortedExamHighlights}
                        worksheetFootnoteAnchors={worksheetFootnoteAnchors}
                        worksheetTool={worksheetTool}
                        activeBlankId={activeBlankId}
                        activeExamHighlightId={activeExamHighlightId}
                        activeFootnoteAnchorId={activeFootnoteAnchorId}
                        draftBlank={draftBlank}
                        draftBlankAnswer={draftBlankAnswer}
                        draftBlankPrompt={draftBlankPrompt}
                        blankEditorMode={blankEditorMode}
                        sortedBlanks={sortedBlanks}
                        pdfInputRef={pdfInputRef}
                        onPdfFileChange={handlePdfFileChange}
                        onPreparePdf={() => void handlePreparePdf()}
                        onRemovePdf={() => void removeAttachedPdf()}
                        onWorksheetToolChange={setWorksheetTool}
                        onSelectBlank={handleSelectBlank}
                        onDeleteBlank={handleDeleteBlank}
                        onSelectExamHighlight={handleSelectExamHighlight}
                        onDeleteExamHighlight={handleDeleteExamHighlight}
                        onSelectFootnoteAnchor={handleSelectFootnoteAnchor}
                        onDeleteFootnoteAnchor={handleDeleteFootnoteAnchor}
                        onActivateFootnoteAnchor={
                          handleOpenFootnoteEditorFromAnchor
                        }
                        footnoteTitles={footnoteTitles}
                        footnotes={lessonFootnotes}
                        footnoteUsageMap={footnoteUsageMap}
                        footnoteAnchorCountMap={footnoteAnchorCountMap}
                        selectedFootnoteId={activeFootnoteId}
                        onSelectFootnote={handleSelectFootnote}
                        onAddFootnote={handleAddFootnote}
                        onAddFootnoteAndInsert={handleAddFootnoteAndInsert}
                        onOpenFootnoteEditor={openEditFootnoteEditor}
                        onInsertFootnoteToken={insertFootnoteTokenIntoContent}
                        onCreateBlankFromSelection={
                          handleCreateBlankFromSelection
                        }
                        onCreateExamHighlightFromSelection={
                          handleCreateExamHighlightFromSelection
                        }
                        onCreateFootnoteAnchorFromSelection={
                          handleCreateFootnoteAnchorFromSelection
                        }
                        onDraftBlankAnswerChange={setDraftBlankAnswer}
                        onDraftBlankPromptChange={setDraftBlankPrompt}
                        onConfirmDraftBlank={handleConfirmDraftBlank}
                        onCancelDraftBlank={resetBlankEditor}
                        onUpdateBlank={updateBlank}
                        hasUnsavedPdfChanges={hasUnsavedPdfChanges}
                        pdfSaveState={pdfSaveState}
                        pdfSaveFeedback={pdfSaveFeedback}
                        onSavePdf={() =>
                          void saveLesson({ source: "pdf-floating" })
                        }
                        onRetryPdfExtraction={() =>
                          void retryLessonPdfExtraction()
                        }
                        disablePdfSave={
                          !canEdit ||
                          !selectedNodeId ||
                          !hasUnsavedPdfChanges ||
                          pdfSaveState === "saving"
                        }
                      />
                      {footnoteEditorSession && (
                        <FootnoteEditorDialog
                          session={footnoteEditorSession}
                          footnotes={lessonFootnotes}
                          footnoteUsageMap={footnoteUsageMap}
                          footnoteAnchorCountMap={footnoteAnchorCountMap}
                          onFootnoteDraftChange={
                            handleFootnoteEditorDraftChange
                          }
                          onSaveFootnoteEditor={handleSaveFootnoteEditor}
                          onCloseFootnoteEditor={handleCloseFootnoteEditor}
                          onMoveFootnote={handleMoveFootnote}
                          onDeleteFootnote={handleDeleteFootnote}
                          onSelectFootnoteImage={handleSelectFootnoteImage}
                          onRemoveFootnoteImage={handleRemoveFootnoteImage}
                          onOpenSourceArchivePicker={
                            handleOpenSourceArchivePicker
                          }
                          onClearSourceArchiveImage={
                            handleClearSourceArchiveImage
                          }
                          getFootnotePreviewUrl={getFootnotePreviewUrl}
                          isNestedModalOpen={Boolean(
                            sourceArchivePickerFootnoteId,
                          )}
                        />
                      )}
                    </div>
                  )}
                  {editorTab === "student-preview" && (
                    <>
                      <LessonPreviewLauncher
                        lesson={lessonDraft}
                        unitId={selectedNodeId}
                        fallbackTitle={selectedNodeTitle}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 sm:bottom-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] sm:right-[calc(env(safe-area-inset-right,0px)+1.5rem)] lg:hidden"
          aria-label="수업 자료 목차 열기"
          aria-controls="lesson-tree-drawer"
          aria-expanded={sidebarOpen}
          title="목차"
        >
          <i className="fas fa-list text-lg" aria-hidden="true"></i>
        </button>
      </div>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-96 rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-gray-800">
              {modalMode === "root"
                ? "최상위 항목 추가"
                : modalMode === "child"
                  ? "하위 항목 추가"
                  : "이름 수정"}
            </h3>
            <input
              type="text"
              autoFocus
              className="mb-6 w-full rounded-lg border-2 border-gray-200 p-3 text-lg font-bold outline-none focus:border-blue-500"
              placeholder="이름 입력"
              value={modalInput}
              onChange={(event) => setModalInput(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && handleModalConfirm()
              }
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-4 py-2 font-bold text-gray-500 hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={handleModalConfirm}
                className="rounded-lg bg-blue-600 px-6 py-2 font-bold text-white hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      <LessonSourceArchivePickerModal
        open={Boolean(sourceArchivePickerFootnoteId)}
        assets={filteredSourceArchiveAssets}
        loading={
          Boolean(sourceArchivePickerFootnoteId) &&
          sourceArchiveAssets.length === 0
        }
        searchValue={sourceArchiveSearch}
        onSearchChange={setSourceArchiveSearch}
        onClose={() => setSourceArchivePickerFootnoteId(null)}
        onSelectAsset={handleSelectSourceArchiveAsset}
      />
      {screenBusyMessage?.includes("불러오는") && !pdfExtractionRetryOverlay ? (
        <PageDataLoading />
      ) : (
        (screenBusyMessage || pdfExtractionRetryOverlay) && (
          <LoadingOverlay
            message={
              pdfExtractionRetryOverlay?.message ||
              screenBusyMessage ||
              "잠시만 기다려 주세요."
            }
            detail={
              screenBusyMessage
                ? "잠시만 기다려 주세요."
                : pdfExtractionRetryOverlay?.phase === "requesting"
                  ? "재요청을 준비하는 중입니다."
                  : "완료되면 이 창이 자동으로 닫힙니다."
            }
          />
        )
      )}
    </div>
  );
};

export default ManageLesson;
