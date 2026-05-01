import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db, storage } from "../../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  type StorageReference,
  uploadBytes,
} from "firebase/storage";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../lib/semesterScope";
import {
  getPdfPageImageExtension,
  processPdfMapFile,
  type ProcessedPdfMap,
} from "../../lib/pdfMapProcessor";
import {
  clampRatio,
  normalizeWorksheetBlanks,
  getTightTextRegionBounds,
  normalizeWorksheetFootnoteAnchors,
  normalizeWorksheetPageImages,
  normalizeWorksheetTextRegions,
  type LessonWorksheetBlank,
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
import {
  buildFailedLessonPdfProcessingMeta,
  buildQueuedLessonPdfProcessingMeta,
  createEmptyLessonPdfProcessingMeta,
  normalizeLessonPdfProcessingMeta,
  type LessonPdfProcessingMeta,
} from "../../lib/lessonPdfExtraction";
import {
  tryDeleteLessonFootnoteAsset,
  uploadLessonFootnoteAsset,
} from "../../lib/lessonFootnoteAssets";
import { canWriteLessonManagement } from "../../lib/permissions";
import { createManagedNotifications } from "../../lib/notifications";
import { subscribeSourceArchiveAssets } from "../../lib/sourceArchive";
import {
  buildTeacherPresentationClassId,
  buildTeacherPresentationClassLabel,
  getRecentTeacherPresentationItems,
  getTeacherPresentationRuntimeBadge,
  getTeacherPresentationWarningState,
  normalizeTeacherPresentationClassSummary,
  readRecentTeacherPresentationClass,
  resolveTeacherPresentationClassLabel,
  sortTeacherPresentationClasses,
  type TeacherPresentationClassSummary,
  type TeacherPresentationRuntimeStatus,
} from "../../lib/teacherPresentation";
import { emitSessionActivity } from "../../lib/sessionActivity";
import type { SourceArchiveAsset } from "../../types";
import TeacherPresentationLauncher from "./components/TeacherPresentationLauncher";
import TeacherLessonPresentation from "./components/TeacherLessonPresentation";
import LessonSourceArchivePickerModal from "./components/LessonSourceArchivePickerModal";
import {
  LessonBodyEditor,
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

type PresentationClassOption = {
  classId: string;
  classLabel: string;
  grade: string;
  className: string;
};

const extractPresentationClassParts = (params: {
  classId?: string | null;
  classLabel?: string | null;
  grade?: string | null;
  className?: string | null;
}) => {
  const grade = String(params.grade || "").trim();
  const className = String(params.className || "").trim();
  if (grade && className) {
    return { grade, className };
  }

  for (const candidate of [params.classLabel, params.classId]) {
    const matches = String(candidate || "").match(/\d+/g);
    if (matches && matches.length >= 2) {
      return {
        grade: matches[0],
        className: matches[1],
      };
    }
  }

  return {
    grade: "",
    className: "",
  };
};

const normalizePresentationClassOption = (params: {
  classId?: string | null;
  classLabel?: string | null;
  grade?: string | null;
  className?: string | null;
}): PresentationClassOption => {
  const { grade, className } = extractPresentationClassParts(params);
  const classId =
    grade && className
      ? buildTeacherPresentationClassId(grade, className)
      : String(params.classId || "").trim() || "preview-default";

  return {
    classId,
    classLabel: resolveTeacherPresentationClassLabel({
      classId,
      classLabel: params.classLabel,
      grade,
      className,
    }),
    grade,
    className,
  };
};

const FIXED_PRESENTATION_CLASS_OPTIONS: PresentationClassOption[] = Array.from(
  { length: 10 },
  (_, index) =>
    normalizePresentationClassOption({
      grade: "3",
      className: String(index + 1),
    }),
);

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

const ManageLesson: React.FC = () => {
  const { config, userData, currentUser } = useAuth();
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
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [preparedPdf, setPreparedPdf] = useState<ProcessedPdfMap | null>(null);
  const [activeBlankId, setActiveBlankId] = useState<string | null>(null);
  const [draftBlank, setDraftBlank] = useState<LessonWorksheetBlank | null>(
    null,
  );
  const [draftBlankAnswer, setDraftBlankAnswer] = useState("");
  const [draftBlankPrompt, setDraftBlankPrompt] = useState("");
  const [blankEditorMode, setBlankEditorMode] = useState<
    "draft" | "existing" | null
  >(null);
  const [worksheetTool, setWorksheetTool] = useState<
    "ocr" | "box" | "footnote"
  >("box");
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
  const [teacherPreviewOpen, setTeacherPreviewOpen] = useState(false);
  const [presentationClassOptions, setPresentationClassOptions] = useState<
    PresentationClassOption[]
  >([]);
  const [teacherPreviewClassId, setTeacherPreviewClassId] = useState("");
  const [teacherPreviewClassLabel, setTeacherPreviewClassLabel] = useState("");
  const [teacherPreviewClassSummaries, setTeacherPreviewClassSummaries] =
    useState<Record<string, TeacherPresentationClassSummary>>({});
  const [teacherPreviewClassLoadState, setTeacherPreviewClassLoadState] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [
    presentationClassOptionLoadState,
    setPresentationClassOptionLoadState,
  ] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [cachedTeacherPreviewSummary, setCachedTeacherPreviewSummary] =
    useState<TeacherPresentationClassSummary | null>(null);
  const [teacherPreviewRuntimeStatus, setTeacherPreviewRuntimeStatus] =
    useState<TeacherPresentationRuntimeStatus | null>(null);
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
  const lastSavedMetaSnapshotRef = useRef("");
  const lastSavedPdfSnapshotRef = useRef("");
  const deletedFootnoteAssetPathsRef = useRef<string[]>([]);
  const canEdit = canWriteLessonManagement(userData, currentUser?.email || "");
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
  const sortedPresentationClassOptions = useMemo(() => {
    const optionMap = new Map<string, TeacherPresentationClassSummary>();

    presentationClassOptions.forEach((option) => {
      const normalizedOption = normalizePresentationClassOption(option);
      const matchedSummary =
        Object.values(teacherPreviewClassSummaries).find(
          (summary) =>
            normalizePresentationClassOption(summary).classId ===
            normalizedOption.classId,
        ) || null;
      optionMap.set(normalizedOption.classId, {
        ...(matchedSummary || {}),
        classId: normalizedOption.classId,
        classLabel: normalizedOption.classLabel,
        grade: normalizedOption.grade,
        className: normalizedOption.className,
      });
    });

    Object.values(teacherPreviewClassSummaries).forEach((summary) => {
      const normalizedSummary = normalizePresentationClassOption(summary);
      optionMap.set(normalizedSummary.classId, {
        ...(optionMap.get(normalizedSummary.classId) || {}),
        ...summary,
        classId: normalizedSummary.classId,
        classLabel: normalizedSummary.classLabel,
        grade: normalizedSummary.grade,
        className: normalizedSummary.className,
        hasSavedState: summary.hasSavedState ?? true,
      });
    });

    if (cachedTeacherPreviewSummary) {
      const normalizedCached = normalizePresentationClassOption(
        cachedTeacherPreviewSummary,
      );
      optionMap.set(normalizedCached.classId, {
        ...cachedTeacherPreviewSummary,
        classId: normalizedCached.classId,
        classLabel: normalizedCached.classLabel,
        grade: normalizedCached.grade,
        className: normalizedCached.className,
        isFallback: !Object.values(teacherPreviewClassSummaries).some(
          (summary) =>
            normalizePresentationClassOption(summary).classId ===
            normalizedCached.classId,
        ),
      });
    }

    return sortTeacherPresentationClasses(
      Array.from(optionMap.values()),
      teacherPreviewClassId,
    );
  }, [
    cachedTeacherPreviewSummary,
    presentationClassOptions,
    teacherPreviewClassId,
    teacherPreviewClassSummaries,
  ]);
  const selectedTeacherPreviewSummary = useMemo(() => {
    const matchedSummary =
      Object.values(teacherPreviewClassSummaries).find(
        (summary) =>
          normalizePresentationClassOption(summary).classId ===
          teacherPreviewClassId,
      ) || null;
    if (matchedSummary) return matchedSummary;
    if (!cachedTeacherPreviewSummary) return null;
    return normalizePresentationClassOption(cachedTeacherPreviewSummary)
      .classId === teacherPreviewClassId
      ? cachedTeacherPreviewSummary
      : null;
  }, [
    cachedTeacherPreviewSummary,
    teacherPreviewClassId,
    teacherPreviewClassSummaries,
  ]);
  const resolvedTeacherPreviewClassLabel = useMemo(() => {
    const matchedOption = sortedPresentationClassOptions.find(
      (option) => option.classId === teacherPreviewClassId,
    );
    if (matchedOption?.classLabel) {
      return matchedOption.classLabel;
    }

    if (selectedTeacherPreviewSummary?.classLabel) {
      return selectedTeacherPreviewSummary.classLabel;
    }

    if (cachedTeacherPreviewSummary) {
      const normalizedCached = normalizePresentationClassOption(
        cachedTeacherPreviewSummary,
      );
      if (normalizedCached.classId === teacherPreviewClassId) {
        return normalizedCached.classLabel;
      }
    }

    if (!teacherPreviewClassId) return "미리보기용 공용 상태";

    return resolveTeacherPresentationClassLabel({
      classId: teacherPreviewClassId,
      classLabel: teacherPreviewClassLabel,
    });
  }, [
    cachedTeacherPreviewSummary,
    selectedTeacherPreviewSummary,
    sortedPresentationClassOptions,
    teacherPreviewClassId,
    teacherPreviewClassLabel,
  ]);
  const recentTeacherPreviewSummary = useMemo(
    () =>
      sortTeacherPresentationClasses(
        [
          ...Object.values(teacherPreviewClassSummaries),
          ...(cachedTeacherPreviewSummary ? [cachedTeacherPreviewSummary] : []),
        ],
        teacherPreviewClassId,
      ).find((item) => item.hasSavedState) || null,
    [
      cachedTeacherPreviewSummary,
      teacherPreviewClassId,
      teacherPreviewClassSummaries,
    ],
  );
  const recentTeacherPreviewItems = useMemo(
    () =>
      getRecentTeacherPresentationItems(
        [
          ...Object.values(teacherPreviewClassSummaries),
          ...(cachedTeacherPreviewSummary ? [cachedTeacherPreviewSummary] : []),
        ],
        3,
      ),
    [cachedTeacherPreviewSummary, teacherPreviewClassSummaries],
  );
  const teacherPreviewWarningState = useMemo(
    () =>
      teacherPreviewRuntimeStatus
        ? getTeacherPresentationWarningState({
            saveState: teacherPreviewRuntimeStatus.saveState,
            hasUnsavedChanges: teacherPreviewRuntimeStatus.hasUnsavedChanges,
            classLabel: teacherPreviewRuntimeStatus.classLabel,
          })
        : null,
    [teacherPreviewRuntimeStatus],
  );
  const selectedTeacherPreviewBadge = useMemo(
    () => getTeacherPresentationRuntimeBadge(selectedTeacherPreviewSummary),
    [selectedTeacherPreviewSummary],
  );
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
      selectedPdfFile,
      preparedPdf,
      footnoteImageDrafts,
      pendingFootnoteEditorSnapshot,
    ],
  );
  const hasUnsavedMetaChanges =
    currentMetaSnapshot !== lastSavedMetaSnapshotRef.current;
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

      const legacyRef = collection(db, "lessons");
      const legacySnap = await getDocs(
        query(legacyRef, where("unitId", "==", unitId), limit(1)),
      );
      if (!legacySnap.empty) {
        return doc(legacyRef, legacySnap.docs[0].id);
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
      const lessonDocRef = await findLessonDocRefByUnitId(unitId);
      if (!lessonDocRef) return null;

      const lessonSnap = await getDocFromServer(lessonDocRef).catch(() =>
        getDoc(lessonDocRef),
      );
      if (!lessonSnap.exists()) return null;

      const lessonData = lessonSnap.data() || {};
      const normalizedLesson = normalizeLessonData(lessonData, {
        unitId,
        title:
          String(
            lessonData.title || lessonTitle || selectedNodeTitle || "",
          ).trim() || unitId,
      });
      const nextPdfSnapshot = createPdfEditorSnapshot({
        selectedNodeId: unitId,
        lessonContent,
        lessonFootnotes,
        worksheetFootnoteAnchors,
        lessonPdfName: normalizedLesson.pdfName,
        lessonPdfUrl: normalizedLesson.pdfUrl,
        lessonPdfStoragePath: normalizedLesson.pdfStoragePath,
        lessonPdfProcessing: normalizedLesson.pdfProcessing,
        worksheetPageImages: normalizedLesson.worksheetPageImages,
        worksheetTextRegions: normalizedLesson.worksheetTextRegions,
        worksheetBlanks: normalizedLesson.worksheetBlanks,
        selectedPdfFile: null,
        preparedPdf: null,
        footnoteImageDrafts: {},
      });
      const currentPdfSnapshot = createPdfEditorSnapshot({
        selectedNodeId: unitId,
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
        selectedPdfFile: null,
        preparedPdf: null,
        footnoteImageDrafts: {},
      });

      if (selectedNodeId === unitId && currentPdfSnapshot !== nextPdfSnapshot) {
        const hasPageImageChange =
          JSON.stringify(worksheetPageImages) !==
          JSON.stringify(normalizedLesson.worksheetPageImages);
        if (hasPageImageChange) {
          revokeBlobUrls(worksheetPageImages);
        }

        setLessonPdfName(normalizedLesson.pdfName);
        setLessonPdfUrl(normalizedLesson.pdfUrl);
        setLessonPdfStoragePath(normalizedLesson.pdfStoragePath);
        setLessonPdfProcessing(normalizedLesson.pdfProcessing);
        setWorksheetPageImages(normalizedLesson.worksheetPageImages);
        setWorksheetTextRegions(normalizedLesson.worksheetTextRegions);
        setWorksheetBlanks(normalizedLesson.worksheetBlanks);
        syncSavedPdfState({
          selectedNodeId: unitId,
          lessonContent,
          lessonFootnotes,
          worksheetFootnoteAnchors,
          lessonPdfName: normalizedLesson.pdfName,
          lessonPdfUrl: normalizedLesson.pdfUrl,
          lessonPdfStoragePath: normalizedLesson.pdfStoragePath,
          lessonPdfProcessing: normalizedLesson.pdfProcessing,
          worksheetPageImages: normalizedLesson.worksheetPageImages,
          worksheetTextRegions: normalizedLesson.worksheetTextRegions,
          worksheetBlanks: normalizedLesson.worksheetBlanks,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
      }

      return normalizedLesson.pdfProcessing;
    },
    [
      findLessonDocRefByUnitId,
      lessonContent,
      lessonFootnotes,
      lessonPdfName,
      lessonPdfProcessing,
      lessonPdfStoragePath,
      lessonPdfUrl,
      lessonTitle,
      revokeBlobUrls,
      selectedNodeId,
      selectedNodeTitle,
      syncSavedPdfState,
      worksheetBlanks,
      worksheetFootnoteAnchors,
      worksheetPageImages,
      worksheetTextRegions,
    ],
  );

  const retryLessonPdfExtraction = useCallback(async () => {
    const normalizedProcessing = normalizeLessonPdfProcessingMeta(
      lessonPdfProcessing,
      {
        pdfName: lessonPdfName,
        pdfStoragePath: lessonPdfStoragePath,
      },
    );
    const retryPdfStoragePath =
      normalizedProcessing.file.storagePath || lessonPdfStoragePath;

    if (!selectedNodeId || !retryPdfStoragePath) {
      setPdfSaveFeedback({
        tone: "error",
        message:
          "저장된 원본 PDF를 찾지 못해 구조 추출을 다시 요청할 수 없습니다.",
      });
      return;
    }
    if (selectedPdfFile || preparedPdf || hasUnsavedPdfChanges) {
      alert(
        "저장하지 않은 PDF 편집 내용이 있습니다. 먼저 저장한 뒤 다시 요청해 주세요.",
      );
      return;
    }

    let lessonDocRef: ReturnType<typeof doc> | null = null;
    let keepPdfBusyUntilPollingCompletes = false;
    const retryStartedAt = Date.now();
    emitSessionActivity();
    setPdfBusy(true);
    setPdfExtractionRetryOverlay({
      unitId: selectedNodeId,
      startedAt: retryStartedAt,
      phase: "requesting",
      message: "원본 PDF 구조 추출을 다시 요청하는 중입니다...",
    });
    setPdfSaveFeedback(null);

    try {
      lessonDocRef = await runPdfExtractionStepWithTimeout(
        findLessonDocRefByUnitId(selectedNodeId),
        PDF_EXTRACTION_RETRY_REQUEST_TIMEOUT_MS,
        "lesson-pdf-retry-request-timeout",
      );
      if (!lessonDocRef) {
        throw new Error("lesson-doc-not-found");
      }

      const uploadToken = crypto.randomUUID();
      const basePath = `${getSemesterCollectionPath(config, "lesson_pdfs")}/${selectedNodeId}`;
      const pendingUploadPath = `${basePath}/incoming/${uploadToken}.pdf`;
      const queuedProcessing = buildQueuedLessonPdfProcessingMeta({
        pdfName:
          lessonPdfName ||
          lessonPdfProcessing.file.originalName ||
          "lesson.pdf",
        pdfStoragePath: retryPdfStoragePath,
        byteSize: Number(lessonPdfProcessing.file.byteSize) || 0,
        pageCount:
          worksheetPageImages.length || lessonPdfProcessing.pageCount || 0,
        pendingUploadToken: uploadToken,
        pendingUploadPath,
        previous: lessonPdfProcessing,
      });

      await setDoc(
        lessonDocRef,
        {
          pdfProcessing: queuedProcessing,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await runPdfExtractionStepWithTimeout(
        uploadBytes(
          ref(storage, pendingUploadPath),
          new Blob([], { type: "application/pdf" }),
          {
            contentType: "application/pdf",
            cacheControl: "private,no-store,max-age=0",
            customMetadata: {
              lessonDocId: lessonDocRef.id,
              unitId: selectedNodeId,
              sourceStoragePath: retryPdfStoragePath,
              sourceOriginalName:
                lessonPdfName ||
                lessonPdfProcessing.file.originalName ||
                "lesson.pdf",
              sourceByteSize: String(
                Number(lessonPdfProcessing.file.byteSize) || 0,
              ),
            },
          },
        ),
        PDF_EXTRACTION_RETRY_REQUEST_TIMEOUT_MS,
        "lesson-pdf-retry-request-timeout",
      );

      setLessonPdfProcessing(queuedProcessing);
      syncSavedPdfState({
        selectedNodeId,
        lessonContent,
        lessonFootnotes,
        worksheetFootnoteAnchors,
        lessonPdfName,
        lessonPdfUrl,
        lessonPdfStoragePath,
        lessonPdfProcessing: queuedProcessing,
        worksheetPageImages,
        worksheetTextRegions,
        worksheetBlanks,
        selectedPdfFile: null,
        preparedPdf: null,
        footnoteImageDrafts: {},
      });
      setPdfSaveFeedback({
        tone: "success",
        message:
          "원본 PDF 구조 추출을 다시 요청했습니다. 상태가 바뀌면 화면에 자동으로 반영됩니다.",
      });
      setPdfExtractionRetryOverlay({
        unitId: selectedNodeId,
        startedAt: retryStartedAt,
        phase: "polling",
        message: "원본 PDF 구조 추출 상태를 확인하는 중입니다...",
      });
      keepPdfBusyUntilPollingCompletes = true;
    } catch (error) {
      console.error("Failed to retry lesson pdf extraction:", error);
      const shouldPersistFailure =
        shouldPersistPdfExtractionRetryFailure(error);
      if (shouldPersistFailure) {
        const failedProcessing = buildFailedLessonPdfProcessingMeta(
          lessonPdfProcessing,
          String(
            (error as { message?: string })?.message ||
              "lesson-pdf-extraction-retry-failed",
          ),
        );

        if (lessonDocRef) {
          await setDoc(
            lessonDocRef,
            {
              pdfProcessing: failedProcessing,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ).catch(() => undefined);
        }

        setLessonPdfProcessing(failedProcessing);
        syncSavedPdfState({
          selectedNodeId,
          lessonContent,
          lessonFootnotes,
          worksheetFootnoteAnchors,
          lessonPdfName,
          lessonPdfUrl,
          lessonPdfStoragePath,
          lessonPdfProcessing: failedProcessing,
          worksheetPageImages,
          worksheetTextRegions,
          worksheetBlanks,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
      }
      setPdfSaveFeedback({
        tone: "error",
        message: getPdfExtractionRetryFeedbackMessage(error),
      });
      setPdfExtractionRetryOverlay(null);
    } finally {
      if (!keepPdfBusyUntilPollingCompletes) {
        setPdfBusy(false);
      }
      setScreenBusyMessage(null);
    }
  }, [
    config,
    findLessonDocRefByUnitId,
    hasUnsavedPdfChanges,
    lessonContent,
    lessonFootnotes,
    lessonPdfName,
    lessonPdfProcessing,
    lessonPdfStoragePath,
    lessonPdfUrl,
    preparedPdf,
    selectedNodeId,
    selectedPdfFile,
    syncSavedPdfState,
    worksheetBlanks,
    worksheetFootnoteAnchors,
    worksheetPageImages,
    worksheetTextRegions,
  ]);

  useEffect(() => {
    void loadTree();
  }, [config]);
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
  useEffect(() => {
    setCachedTeacherPreviewSummary(
      normalizeTeacherPresentationClassSummary(
        readRecentTeacherPresentationClass({
          teacherUid: currentUser?.uid,
          lessonId: selectedNodeId,
        }),
      ),
    );
  }, [currentUser?.uid, selectedNodeId]);
  useEffect(() => {
    const loadPresentationClasses = async () => {
      setPresentationClassOptionLoadState("loading");
      try {
        setPresentationClassOptions(FIXED_PRESENTATION_CLASS_OPTIONS);
        setPresentationClassOptionLoadState("ready");
      } catch (error) {
        console.error(
          "Failed to load class options for teacher presentation:",
          error,
        );
        setPresentationClassOptions([]);
        setPresentationClassOptionLoadState("error");
      }
    };
    void loadPresentationClasses();
  }, []);
  useEffect(() => {
    const loadTeacherPreviewSummaries = async () => {
      if (!teacherPreviewOpen || !selectedNodeId || !currentUser?.uid) return;
      setTeacherPreviewClassLoadState("loading");
      if (cachedTeacherPreviewSummary) {
        setTeacherPreviewClassSummaries((prev) => ({
          ...prev,
          [cachedTeacherPreviewSummary.classId]: cachedTeacherPreviewSummary,
        }));
      }
      try {
        const snapshot = await getDocs(
          collection(
            db,
            `${getSemesterCollectionPath(config, "lesson_presentations")}/${selectedNodeId}/teachers/${currentUser.uid}/classes`,
          ),
        );
        const nextSummaries: Record<string, TeacherPresentationClassSummary> =
          {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as {
            classLabel?: string;
            grade?: string;
            className?: string;
            currentPage?: number;
            updatedAt?: { toDate?: () => Date };
            lastUsedAt?: { toDate?: () => Date };
          };
          const normalizedSummary = normalizeTeacherPresentationClassSummary({
            classId: docSnap.id,
            classLabel: resolveTeacherPresentationClassLabel({
              classId: docSnap.id,
              classLabel: String(data.classLabel || "").trim(),
              grade: String(data.grade || "").trim(),
              className: String(data.className || "").trim(),
            }),
            grade: String(data.grade || "").trim(),
            className: String(data.className || "").trim(),
            currentPage:
              typeof data.currentPage === "number" ? data.currentPage : null,
            updatedAt: data.updatedAt?.toDate?.() || null,
            lastUsedAt: data.lastUsedAt?.toDate?.() || null,
            hasSavedState: true,
          });
          if (!normalizedSummary) return;
          nextSummaries[docSnap.id] = normalizedSummary;
        });
        setTeacherPreviewClassSummaries((prev) => ({
          ...prev,
          ...nextSummaries,
        }));
        setTeacherPreviewClassLoadState("ready");
      } catch (error) {
        console.error("Failed to load teacher preview class summaries:", error);
        setTeacherPreviewClassSummaries((prev) =>
          cachedTeacherPreviewSummary
            ? {
                ...prev,
                [cachedTeacherPreviewSummary.classId]:
                  cachedTeacherPreviewSummary,
              }
            : prev,
        );
        setTeacherPreviewClassLoadState("error");
      }
    };
    void loadTeacherPreviewSummaries();
  }, [
    cachedTeacherPreviewSummary,
    config,
    currentUser?.uid,
    selectedNodeId,
    teacherPreviewOpen,
  ]);
  useEffect(() => {
    if (!sortedPresentationClassOptions.length) {
      if (cachedTeacherPreviewSummary && !teacherPreviewClassId) {
        setTeacherPreviewClassId(cachedTeacherPreviewSummary.classId);
        setTeacherPreviewClassLabel(cachedTeacherPreviewSummary.classLabel);
        return;
      }
      if (!teacherPreviewClassId) {
        setTeacherPreviewClassId("preview-default");
        setTeacherPreviewClassLabel("미리보기용 공용 상태");
      }
      return;
    }
    const matched = sortedPresentationClassOptions.find(
      (option) => option.classId === teacherPreviewClassId,
    );
    if (matched) {
      if (teacherPreviewClassLabel !== matched.classLabel) {
        setTeacherPreviewClassLabel(matched.classLabel);
      }
      return;
    }
    setTeacherPreviewClassId(sortedPresentationClassOptions[0].classId);
    setTeacherPreviewClassLabel(sortedPresentationClassOptions[0].classLabel);
  }, [
    cachedTeacherPreviewSummary,
    sortedPresentationClassOptions,
    teacherPreviewClassId,
    teacherPreviewClassLabel,
  ]);
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
  useEffect(() => {
    if (!teacherPreviewRuntimeStatus || !selectedNodeId || !currentUser?.uid) {
      return;
    }

    const runtimeSummary = normalizeTeacherPresentationClassSummary({
      classId: teacherPreviewRuntimeStatus.classId,
      classLabel: teacherPreviewRuntimeStatus.classLabel,
      currentPage: teacherPreviewRuntimeStatus.currentPage,
      updatedAt: teacherPreviewRuntimeStatus.lastSavedAt,
      lastUsedAt: teacherPreviewRuntimeStatus.lastSavedAt,
      hasSavedState: Boolean(teacherPreviewRuntimeStatus.lastSavedAt),
      runtimeState: teacherPreviewRuntimeStatus.saveState,
      hasUnsavedChanges: teacherPreviewRuntimeStatus.hasUnsavedChanges,
      statusText: teacherPreviewRuntimeStatus.statusText,
    });

    if (!runtimeSummary) return;
    setTeacherPreviewClassSummaries((prev) => ({
      ...prev,
      [runtimeSummary.classId]: {
        ...(prev[runtimeSummary.classId] || {}),
        ...runtimeSummary,
      },
    }));
    if (runtimeSummary.classId === teacherPreviewClassId) {
      setCachedTeacherPreviewSummary(runtimeSummary);
    }
  }, [
    currentUser?.uid,
    selectedNodeId,
    teacherPreviewClassId,
    teacherPreviewRuntimeStatus,
  ]);
  useEffect(() => {
    if (!teacherPreviewRuntimeStatus) return;
    if (teacherPreviewRuntimeStatus.classId !== teacherPreviewClassId) return;
    setTeacherPreviewClassLabel(
      resolveTeacherPresentationClassLabel({
        classId: teacherPreviewRuntimeStatus.classId,
        classLabel: teacherPreviewRuntimeStatus.classLabel,
      }),
    );
  }, [teacherPreviewClassId, teacherPreviewRuntimeStatus]);

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
    setWorksheetFootnoteAnchors([]);
    setPreparedPdf(null);
    setSelectedPdfFile(null);
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
      selectedPdfFile: null,
      preparedPdf: null,
      footnoteImageDrafts: {},
    });
    setLessonSaveState("saved");
    setPdfSaveState("saved");
  };

  const confirmDiscardChanges = () =>
    !hasUnsavedLessonChanges || window.confirm(unsavedLessonWarningMessage);

  const loadTree = async () => {
    try {
      const scopedDoc = await getDoc(
        doc(db, getSemesterDocPath(config, "curriculum", "tree")),
      );
      if (scopedDoc.exists() && scopedDoc.data().tree)
        return setTreeData(scopedDoc.data().tree);
      const legacyDoc = await getDoc(doc(db, "curriculum", "tree"));
      if (legacyDoc.exists() && legacyDoc.data().tree)
        return setTreeData(legacyDoc.data().tree);
      setTreeData([
        { id: `root-${Date.now()}`, title: "수업 자료", children: [] },
      ]);
    } catch (error) {
      console.error(error);
    }
  };

  const saveTree = async (newTree: TreeNode[], silent = true) => {
    if (!canEdit) return;
    setScreenBusyMessage("트리 구조를 저장하는 중입니다...");
    try {
      await setDoc(doc(db, getSemesterDocPath(config, "curriculum", "tree")), {
        tree: newTree,
        updatedAt: serverTimestamp(),
      });
      setTreeData(newTree);
      if (!silent) alert("트리 구조를 저장했습니다.");
    } catch (error) {
      console.error(error);
      alert("트리 저장에 실패했습니다.");
    }
    setScreenBusyMessage(null);
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

  const handleModalConfirm = () => {
    if (!canEdit) return;
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
        if (selectedNodeId === node.id) setSelectedNodeTitle(value);
      }
    }
    void saveTree(nextTree);
    setModalOpen(false);
  };

  const handleDeleteNode = (node: TreeNode) => {
    if (!canEdit) return;
    if (!window.confirm(`'${node.title}' 및 하위 항목을 삭제할까요?`)) return;
    const removeRecursive = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter((item) => item.id !== node.id)
        .map((item) => ({
          ...item,
          children: removeRecursive(item.children || []),
        }));
    const nextTree = removeRecursive(treeData);
    if (selectedNodeId === node.id) {
      setSelectedNodeId(null);
      setSelectedNodeTitle("");
      clearLessonEditor(true);
    }
    void saveTree(nextTree);
  };

  const loadLessonContent = async (unitId: string, title: string) => {
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
      let snap = await getDocs(scopedQuery);
      if (snap.empty)
        snap = await getDocs(
          query(
            collection(db, "lessons"),
            where("unitId", "==", unitId),
            limit(1),
          ),
        );
      if (!snap.empty) {
        const data = normalizeLessonData(snap.docs[0].data(), {
          unitId,
          title,
        });
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
        syncSavedSnapshots({
          selectedNodeId: unitId,
          lessonTitle: data.title || title,
          lessonVideo: data.videoUrl,
          lessonVisibleToStudents: data.isVisibleToStudents,
          lessonContent: data.contentHtml,
          lessonFootnotes: data.footnotes,
          worksheetFootnoteAnchors: normalizeWorksheetFootnoteAnchors(
            data.worksheetFootnoteAnchors,
          ),
          lessonPdfName: data.pdfName,
          lessonPdfUrl: data.pdfUrl,
          lessonPdfStoragePath: data.pdfStoragePath,
          lessonPdfProcessing: data.pdfProcessing,
          worksheetPageImages: normalizeWorksheetPageImages(
            data.worksheetPageImages,
          ),
          worksheetTextRegions: normalizeWorksheetTextRegions(
            data.worksheetTextRegions,
          ),
          worksheetBlanks: data.worksheetBlanks,
          selectedPdfFile: null,
          preparedPdf: null,
          footnoteImageDrafts: {},
        });
      } else {
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
    } catch (error) {
      console.error(error);
    }
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
      setWorksheetFootnoteAnchors([]);
      setBlankEditorMode(null);
      setActiveBlankId(null);
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

  const deleteStorageFolderRecursive = async (
    folderRef: StorageReference,
  ): Promise<void> => {
    const listing = await listAll(folderRef);
    await Promise.all(
      listing.items.map((item) => deleteObject(item).catch(() => undefined)),
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
  ): Promise<UploadedWorksheetAssets> => {
    if (!selectedPdfFile || !preparedPdf) {
      return {
        pdfName: lessonPdfName,
        pdfUrl: lessonPdfUrl,
        pdfStoragePath: lessonPdfStoragePath,
        pageImages: worksheetPageImages,
        textRegions: worksheetTextRegions,
        pdfProcessing: lessonPdfProcessing,
        pendingIncomingUpload: null,
      };
    }
    const basePath = `${getSemesterCollectionPath(config, "lesson_pdfs")}/${unitId}`;
    const uploadToken = crypto.randomUUID();
    const pendingUploadPath = `${basePath}/incoming/${uploadToken}.pdf`;
    const pageImages: LessonWorksheetPageImage[] = [];
    const uploadedPagePaths = new Set<string>();
    for (const page of preparedPdf.pageImages) {
      const pageExtension = getPdfPageImageExtension(page.blob);
      const pagePath = `${basePath}/page-${page.page}.${pageExtension}`;
      const pageRef = ref(storage, pagePath);
      await uploadBytes(pageRef, page.blob, {
        contentType: page.blob.type || "image/png",
        cacheControl: LESSON_PDF_UPLOAD_CACHE_CONTROL,
      });
      uploadedPagePaths.add(pagePath);
      pageImages.push({
        page: page.page,
        imageUrl: await getDownloadURL(pageRef),
        width: page.width,
        height: page.height,
      });
    }
    const previousMaxPage = Math.max(
      0,
      ...savedLessonState.worksheetPageImages.map((item) => item.page || 0),
    );
    if (previousMaxPage > 0) {
      const nextPages = new Set(pageImages.map((item) => item.page));
      const cleanupPaths: string[] = [];
      for (let page = 1; page <= previousMaxPage; page += 1) {
        cleanupPaths.push(`${basePath}/page-${page}.png`);
        if (!nextPages.has(page)) {
          cleanupPaths.push(`${basePath}/page-${page}.webp`);
        }
      }
      void Promise.all(
        Array.from(new Set(cleanupPaths)).map(async (path) => {
          if (uploadedPagePaths.has(path)) return;
          try {
            await deleteObject(ref(storage, path));
          } catch {
            // Best-effort cleanup only. Missing old page files are expected.
          }
        }),
      );
    }
    return {
      pdfName: selectedPdfFile.name,
      pdfUrl: "",
      pdfStoragePath: pendingUploadPath,
      pageImages,
      textRegions: preparedPdf.regions,
      pdfProcessing: buildQueuedLessonPdfProcessingMeta({
        pdfName: selectedPdfFile.name,
        pdfStoragePath: pendingUploadPath,
        byteSize: selectedPdfFile.size || 0,
        pageCount: preparedPdf.pageImages.length,
        pendingUploadToken: uploadToken,
        pendingUploadPath,
        previous: lessonPdfProcessing,
      }),
      pendingIncomingUpload: {
        file: selectedPdfFile,
        storagePath: pendingUploadPath,
        uploadToken,
      },
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
  ) => {
    const nextFootnotes: LessonFootnote[] = [];
    const staleAssetPathsToDelete: string[] = [];

    for (const footnote of footnotes) {
      const draft = footnoteImageDrafts[footnote.id];
      let nextFootnote = { ...footnote };

      if (draft?.file) {
        const uploadedAsset = await uploadLessonFootnoteAsset({
          config,
          unitId,
          footnoteId: footnote.id,
          file: draft.file,
        });
        nextFootnote = {
          ...nextFootnote,
          imageUrl: uploadedAsset.imageUrl,
          imageStoragePath: uploadedAsset.imageStoragePath,
        };
        if (
          footnote.imageStoragePath &&
          footnote.imageStoragePath !== uploadedAsset.imageStoragePath
        ) {
          staleAssetPathsToDelete.push(footnote.imageStoragePath);
        }
      } else if (draft?.removeExisting) {
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
    if (!canEdit || !selectedNodeId) return;
    emitSessionActivity();
    const source = options?.source || "header";
    const shouldSavePdf =
      source === "pdf-floating" ||
      (source === "header" && hasUnsavedPdfChanges);
    const shouldSaveMeta = source === "header" && hasUnsavedMetaChanges;

    if (!shouldSaveMeta && !shouldSavePdf) return;
    if (shouldSavePdf && selectedPdfFile && !preparedPdf) {
      alert("PDF 페이지 추출이 끝날 때까지 기다려 주세요.");
      return;
    }

    const committedFootnoteEditor = footnoteEditorSession
      ? commitFootnoteEditorSession({
          session: footnoteEditorSession,
          lessonContent,
          lessonFootnotes,
          worksheetFootnoteAnchors,
          bodySelection,
        })
      : null;
    const lessonContentForSave =
      committedFootnoteEditor?.lessonContent ?? lessonContent;
    const lessonFootnotesForSave =
      committedFootnoteEditor?.lessonFootnotes ?? lessonFootnotes;
    const worksheetFootnoteAnchorsForSave =
      committedFootnoteEditor?.worksheetFootnoteAnchors ??
      worksheetFootnoteAnchors;

    const normalizedGeneralDraft = buildNormalizedGeneralLessonDraft({
      lessonTitle,
      lessonVideo,
      lessonVisibleToStudents,
    });
    const persistedMetaTitle = shouldSaveMeta
      ? normalizedGeneralDraft.title
      : savedLessonState.title || selectedNodeTitle;
    const persistedMetaVideoUrl = shouldSaveMeta
      ? normalizedGeneralDraft.videoUrl
      : savedLessonState.videoUrl;
    const persistedMetaVisibleToStudents = shouldSaveMeta
      ? normalizedGeneralDraft.isVisibleToStudents
      : savedLessonState.isVisibleToStudents;
    let metaSaved = false;
    try {
      const lessonDocRef =
        await findOrCreateLessonDocRefByUnitId(selectedNodeId);
      if (shouldSaveMeta) {
        setLessonSaveState("saving");
      }
      if (shouldSavePdf) {
        setPdfSaveState("saving");
        setPdfSaveFeedback(null);
      }
      setScreenBusyMessage(
        shouldSaveMeta && shouldSavePdf
          ? "수업 자료를 저장하는 중입니다..."
          : shouldSavePdf
            ? "PDF 편집 내용을 저장하는 중입니다..."
            : "제목과 공개 설정을 저장하는 중입니다...",
      );

      if (shouldSaveMeta) {
        await setDoc(
          lessonDocRef,
          {
            unitId: selectedNodeId,
            title: normalizedGeneralDraft.title,
            videoUrl: normalizedGeneralDraft.videoUrl,
            isVisibleToStudents: normalizedGeneralDraft.isVisibleToStudents,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setLessonTitle(normalizedGeneralDraft.title);
        setLessonVideo(normalizedGeneralDraft.videoUrl);
        if (
          normalizedGeneralDraft.title &&
          normalizedGeneralDraft.title !== selectedNodeTitle
        ) {
          const nextTree = replaceNodeTitle(
            treeData,
            selectedNodeId,
            normalizedGeneralDraft.title,
          );
          await setDoc(
            doc(db, getSemesterDocPath(config, "curriculum", "tree")),
            { tree: nextTree, updatedAt: serverTimestamp() },
          );
          setTreeData(nextTree);
          setSelectedNodeTitle(normalizedGeneralDraft.title);
        }
        syncSavedMetaState({
          selectedNodeId,
          lessonTitle: normalizedGeneralDraft.title,
          lessonVideo: normalizedGeneralDraft.videoUrl,
          lessonVisibleToStudents: normalizedGeneralDraft.isVisibleToStudents,
        });
        setLessonSaveState("saved");
        metaSaved = true;
        if (!shouldSavePdf) {
          alert("제목과 공개 설정을 저장했습니다.");
          return;
        }
      }
      const normalizedDraft = buildNormalizedPdfEditorDraft({
        lessonContent: lessonContentForSave,
        lessonFootnotes: lessonFootnotesForSave,
        worksheetFootnoteAnchors: worksheetFootnoteAnchorsForSave,
        lessonPdfName,
        lessonPdfUrl,
        lessonPdfStoragePath,
        lessonPdfProcessing,
        worksheetPageImages,
        worksheetTextRegions,
        worksheetBlanks,
      });
      const uploadedWorksheet = await uploadWorksheetAssets(selectedNodeId);
      const { footnotes: uploadedFootnotes, staleAssetPathsToDelete } =
        await uploadFootnoteAssets(selectedNodeId, normalizedDraft.footnotes);
      let resolvedPdfProcessing = uploadedWorksheet.pdfProcessing;
      let resolvedPdfUrl = uploadedWorksheet.pdfUrl;
      let resolvedPdfStoragePath = uploadedWorksheet.pdfStoragePath;
      const draftForPersist = buildNormalizedPdfEditorDraft({
        lessonContent: normalizedDraft.contentHtml,
        lessonFootnotes: uploadedFootnotes,
        worksheetFootnoteAnchors: normalizedDraft.worksheetFootnoteAnchors,
        lessonPdfName: uploadedWorksheet.pdfName,
        lessonPdfUrl: uploadedWorksheet.pdfUrl,
        lessonPdfStoragePath: uploadedWorksheet.pdfStoragePath,
        lessonPdfProcessing: resolvedPdfProcessing,
        worksheetPageImages: uploadedWorksheet.pageImages,
        worksheetTextRegions: uploadedWorksheet.textRegions,
        worksheetBlanks: normalizedDraft.worksheetBlanks,
      });
      const payload = {
        unitId: selectedNodeId,
        title: persistedMetaTitle,
        videoUrl: persistedMetaVideoUrl,
        isVisibleToStudents: persistedMetaVisibleToStudents,
        contentHtml: draftForPersist.contentHtml,
        pdfName: draftForPersist.pdfName,
        pdfUrl: draftForPersist.pdfUrl,
        pdfStoragePath: draftForPersist.pdfStoragePath,
        worksheetPageImages: draftForPersist.worksheetPageImages,
        worksheetTextRegions: draftForPersist.worksheetTextRegions,
        worksheetBlanks: draftForPersist.worksheetBlanks,
        worksheetFootnoteAnchors: draftForPersist.worksheetFootnoteAnchors,
        pdfProcessing: draftForPersist.pdfProcessing,
        footnotes: draftForPersist.footnotes,
        updatedAt: serverTimestamp(),
      };
      await setDoc(lessonDocRef, payload, { merge: true });
      if (uploadedWorksheet.pendingIncomingUpload) {
        try {
          await uploadBytes(
            ref(storage, uploadedWorksheet.pendingIncomingUpload.storagePath),
            uploadedWorksheet.pendingIncomingUpload.file,
            {
              contentType: "application/pdf",
              cacheControl: "private,no-store,max-age=0",
              customMetadata: {
                lessonDocId: lessonDocRef.id,
                unitId: selectedNodeId,
              },
            },
          );
        } catch (error) {
          const message = String(
            (error as { message?: string })?.message ||
              "lesson-pdf-extraction-upload-failed",
          );
          const failedProcessing = buildFailedLessonPdfProcessingMeta(
            uploadedWorksheet.pdfProcessing,
            message,
          );
          resolvedPdfProcessing = {
            ...failedProcessing,
            file: {
              ...failedProcessing.file,
              storagePath: "",
              originalAvailable: false,
              pendingUploadToken: "",
              pendingUploadPath: "",
            },
          };
          resolvedPdfUrl = "";
          resolvedPdfStoragePath = "";
          await setDoc(
            lessonDocRef,
            {
              pdfUrl: "",
              pdfStoragePath: "",
              pdfProcessing: resolvedPdfProcessing,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
      const savedDraft = buildNormalizedPdfEditorDraft({
        lessonContent: normalizedDraft.contentHtml,
        lessonFootnotes: uploadedFootnotes,
        worksheetFootnoteAnchors: normalizedDraft.worksheetFootnoteAnchors,
        lessonPdfName: uploadedWorksheet.pdfName,
        lessonPdfUrl: resolvedPdfUrl,
        lessonPdfStoragePath: resolvedPdfStoragePath,
        lessonPdfProcessing: resolvedPdfProcessing,
        worksheetPageImages: uploadedWorksheet.pageImages,
        worksheetTextRegions: uploadedWorksheet.textRegions,
        worksheetBlanks: normalizedDraft.worksheetBlanks,
      });
      setLessonContent(savedDraft.contentHtml);
      setLessonPdfName(savedDraft.pdfName);
      setLessonPdfUrl(savedDraft.pdfUrl);
      setLessonPdfStoragePath(savedDraft.pdfStoragePath);
      setLessonPdfProcessing(savedDraft.pdfProcessing);
      setWorksheetPageImages(savedDraft.worksheetPageImages);
      setWorksheetTextRegions(savedDraft.worksheetTextRegions);
      setWorksheetBlanks(savedDraft.worksheetBlanks);
      setWorksheetFootnoteAnchors(savedDraft.worksheetFootnoteAnchors);
      setLessonFootnotes(savedDraft.footnotes);
      if (committedFootnoteEditor) {
        setLessonContent(savedDraft.contentHtml);
        setActiveFootnoteId(committedFootnoteEditor.activeFootnoteId);
        setActiveFootnoteAnchorId(
          committedFootnoteEditor.activeFootnoteAnchorId,
        );
        if (committedFootnoteEditor.bodyInsertMessage) {
          setBodyInsertMessage(committedFootnoteEditor.bodyInsertMessage);
        }
        setFootnoteEditorSession(null);
        setSourceArchivePickerFootnoteId(null);
        setSourceArchiveSearch("");
      }
      setPreparedPdf(null);
      setSelectedPdfFile(null);
      resetFootnoteImageDrafts();
      const cleanupTargets = Array.from(
        new Set([
          ...staleAssetPathsToDelete,
          ...deletedFootnoteAssetPathsRef.current,
        ]),
      );
      deletedFootnoteAssetPathsRef.current = [];
      if (cleanupTargets.length) {
        void Promise.all(
          cleanupTargets.map((path) => tryDeleteLessonFootnoteAsset(path)),
        );
      }
      if (savedLessonState.pdfStoragePath && !savedDraft.pdfStoragePath) {
        const folderRef = ref(
          storage,
          `${getSemesterCollectionPath(config, "lesson_pdfs")}/${selectedNodeId}`,
        );
        void deleteStorageFolderRecursive(folderRef).catch((cleanupError) => {
          console.error(
            "Failed to delete lesson pdf assets after save:",
            cleanupError,
          );
        });
      }
      syncSavedSnapshots({
        selectedNodeId,
        lessonTitle: persistedMetaTitle,
        lessonVideo: persistedMetaVideoUrl,
        lessonVisibleToStudents: persistedMetaVisibleToStudents,
        lessonContent: savedDraft.contentHtml,
        lessonFootnotes: savedDraft.footnotes,
        worksheetFootnoteAnchors: savedDraft.worksheetFootnoteAnchors,
        lessonPdfName: savedDraft.pdfName,
        lessonPdfUrl: savedDraft.pdfUrl,
        lessonPdfStoragePath: savedDraft.pdfStoragePath,
        lessonPdfProcessing: savedDraft.pdfProcessing,
        worksheetPageImages: savedDraft.worksheetPageImages,
        worksheetTextRegions: savedDraft.worksheetTextRegions,
        worksheetBlanks: savedDraft.worksheetBlanks,
        selectedPdfFile: null,
        preparedPdf: null,
        footnoteImageDrafts: {},
      });
      if (shouldSaveMeta) {
        setLessonSaveState("saved");
      }
      setPdfSaveState("saved");
      const isNewlyVisibleToStudents =
        shouldSaveMeta &&
        persistedMetaVisibleToStudents &&
        savedLessonState.isVisibleToStudents === false;
      const shouldNotifyStudents =
        source === "header" && isNewlyVisibleToStudents;
      if (shouldNotifyStudents) {
        void createManagedNotifications(config, {
          recipientMode: "all_students",
          type: "lesson_worksheet_published",
          title: "새 학습지가 업데이트되었습니다",
          body: `${persistedMetaTitle || selectedNodeTitle || "수업자료"} 자료를 확인해 보세요.`,
          targetUrl: `/student/lesson/note?id=${encodeURIComponent(selectedNodeId)}&title=${encodeURIComponent(persistedMetaTitle || selectedNodeTitle || "")}`,
          entityType: "lesson",
          entityId: selectedNodeId,
          dedupeKey: `lesson_worksheet_published:${selectedNodeId}`,
        }).catch((notificationError) => {
          console.error(
            "Failed to create lesson worksheet notifications:",
            notificationError,
          );
        });
      }
      const successMessage =
        resolvedPdfProcessing.extractionStatus === "failed"
          ? shouldSaveMeta
            ? "PDF 편집 내용과 제목/공개 설정을 저장했습니다. PDF 구조 추출 등록은 실패했습니다."
            : "PDF 편집 내용을 저장했습니다. PDF 구조 추출 등록은 실패했습니다."
          : resolvedPdfProcessing.extractionStatus === "queued" ||
              resolvedPdfProcessing.extractionStatus === "processing"
            ? shouldSaveMeta
              ? "PDF 편집 내용과 제목/공개 설정을 저장했습니다. 원본 PDF 구조 추출 상태는 자동으로 다시 표시됩니다."
              : "PDF 편집 내용을 저장했습니다. 원본 PDF 구조 추출 상태는 자동으로 다시 표시됩니다."
            : shouldSaveMeta
              ? "PDF 편집 내용과 제목/공개 설정을 저장했습니다."
              : "PDF 편집 내용을 저장했습니다.";
      setPdfSaveFeedback({
        tone: "success",
        message: successMessage,
      });
      if (source === "header") {
        alert(successMessage);
      }
    } catch (error) {
      console.error("Failed to save lesson PDF edits:", error, {
        source,
        selectedNodeId,
        shouldSaveMeta,
        shouldSavePdf,
        footnoteCount: lessonFootnotesForSave.length,
        worksheetFootnoteAnchorCount: worksheetFootnoteAnchorsForSave.length,
        footnoteContentTypes: lessonFootnotesForSave.map((footnote) => ({
          id: footnote.id,
          anchorKey: footnote.anchorKey,
          contentType: footnote.contentType,
        })),
      });
      if (shouldSaveMeta) {
        setLessonSaveState(metaSaved ? "saved" : "dirty");
      } else if (hasUnsavedMetaChanges) {
        setLessonSaveState("dirty");
      }
      if (shouldSavePdf) {
        setPdfSaveState("dirty");
        const errorMessage = shouldSaveMeta
          ? metaSaved
            ? "제목/공개 설정은 저장했지만 PDF 편집 내용을 저장하지 못했습니다."
            : "제목/공개 설정과 PDF 편집 내용을 저장하지 못했습니다."
          : "PDF 편집 내용을 저장하지 못했습니다.";
        setPdfSaveFeedback({
          tone: "error",
          message: errorMessage,
        });
        if (source === "header") {
          alert(errorMessage);
        }
      } else {
        alert("제목과 공개 설정 저장에 실패했습니다.");
      }
    } finally {
      setScreenBusyMessage(null);
    }
  };

  const handleTeacherPreviewRuntimeStatusChange = (
    status: TeacherPresentationRuntimeStatus,
  ) => {
    setTeacherPreviewRuntimeStatus(status);
  };

  const handleTeacherPreviewClassChange = (nextId: string) => {
    if (nextId === teacherPreviewClassId) return;
    if (
      teacherPreviewWarningState?.shouldWarnOnClassSwitch &&
      !window.confirm(teacherPreviewWarningState.classSwitchMessage)
    ) {
      return;
    }
    const matched = sortedPresentationClassOptions.find(
      (option) => option.classId === nextId,
    );
    setTeacherPreviewClassId(nextId);
    setTeacherPreviewClassLabel(
      resolveTeacherPresentationClassLabel({
        classId: nextId,
        classLabel:
          matched?.classLabel || cachedTeacherPreviewSummary?.classLabel || "",
        grade: matched?.grade || "",
        className: matched?.className || "",
      }),
    );
  };

  const handleTeacherPreviewClose = () => {
    setTeacherPreviewOpen(false);
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

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="relative flex flex-1 flex-col px-4 py-6 lg:px-6 xl:px-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 lg:text-2xl">
            <i className="fas fa-sitemap mr-2 text-blue-500"></i>수업 자료 관리
          </h1>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 lg:hidden"
          >
            <i className="fas fa-bars mr-2"></i>트리
          </button>
        </div>
        {!canEdit && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            이 화면은 조회 전용입니다. 편집과 저장은 관리자만 가능합니다.
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
                  수업 자료를 선택해 주세요.
                </p>
                <p className="mt-2 text-sm">
                  왼쪽 트리에서 말단 수업 항목을 선택하면 편집을 시작할 수
                  있습니다.
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
                  onOpenTeacherPreview={() => setTeacherPreviewOpen(true)}
                />
                <div className="border-b border-gray-200 bg-white px-4 pb-2 pt-2">
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100/90 p-1">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleEditorTabChange(tab.id)}
                        className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${editorTab === tab.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/80 hover:text-slate-900"}`}
                      >
                        <i className={`fas ${tab.icon} mr-2 text-xs`}></i>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 lg:p-6">
                  {editorTab === "pdf" && (
                    <div className="space-y-8">
                      <LessonPdfSection
                        pdfBusy={pdfBusy}
                        selectedPdfFile={selectedPdfFile}
                        lessonPdfName={lessonPdfName}
                        lessonPdfUrl={lessonPdfUrl}
                        pdfProcessing={lessonPdfProcessing}
                        worksheetPageImages={worksheetPageImages}
                        worksheetTextRegions={worksheetTextRegions}
                        worksheetBlanks={worksheetBlanks}
                        worksheetFootnoteAnchors={worksheetFootnoteAnchors}
                        worksheetTool={worksheetTool}
                        activeBlankId={activeBlankId}
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
                      <LessonBodyEditor
                        lessonContent={lessonContent}
                        onLessonContentChange={setLessonContent}
                        bodyInsertMessage={bodyInsertMessage}
                        footnotes={lessonFootnotes}
                        footnoteUsageMap={footnoteUsageMap}
                        footnoteAnchorCountMap={footnoteAnchorCountMap}
                        selectedFootnoteId={activeFootnoteId}
                        onBodySelectionChange={handleBodySelectionChange}
                        onAddFootnote={handleAddFootnote}
                        onAddFootnoteAndInsert={handleAddFootnoteAndInsert}
                        onOpenFootnoteEditor={openEditFootnoteEditor}
                        onFootnoteDraftChange={handleFootnoteEditorDraftChange}
                        onSaveFootnoteEditor={handleSaveFootnoteEditor}
                        onCloseFootnoteEditor={handleCloseFootnoteEditor}
                        onMoveFootnote={handleMoveFootnote}
                        onDeleteFootnote={handleDeleteFootnote}
                        onInsertFootnoteToken={insertFootnoteTokenIntoContent}
                        footnoteEditorSession={
                          footnoteEditorSession
                            ? {
                                mode: footnoteEditorSession.mode,
                                draft: footnoteEditorSession.draft,
                                pendingAnchorPlacement:
                                  footnoteEditorSession.pendingAnchorPlacement
                                    ? {
                                        page: footnoteEditorSession
                                          .pendingAnchorPlacement.page,
                                      }
                                    : null,
                                insertIntoBody:
                                  footnoteEditorSession.insertIntoBody,
                              }
                            : null
                        }
                        onSelectFootnoteImage={handleSelectFootnoteImage}
                        onRemoveFootnoteImage={handleRemoveFootnoteImage}
                        onOpenSourceArchivePicker={
                          handleOpenSourceArchivePicker
                        }
                        onClearSourceArchiveImage={
                          handleClearSourceArchiveImage
                        }
                        getFootnotePreviewUrl={getFootnotePreviewUrl}
                        sourceArchivePickerOpen={Boolean(
                          sourceArchivePickerFootnoteId,
                        )}
                      />
                    </div>
                  )}
                  {editorTab === "student-preview" && (
                    <>
                      <LessonPreviewLauncher
                        lesson={lessonDraft}
                        unitId={selectedNodeId}
                        fallbackTitle={selectedNodeTitle}
                        onOpenTeacherPreview={() => setTeacherPreviewOpen(true)}
                      />
                      {teacherPreviewRuntimeStatus && !teacherPreviewOpen && (
                        <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                                마지막 교사용 판서 상태
                              </div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">
                                {teacherPreviewRuntimeStatus.classLabel}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {teacherPreviewRuntimeStatus.statusText}
                              </div>
                            </div>
                            <div
                              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                                selectedTeacherPreviewBadge.tone === "rose"
                                  ? "bg-rose-100 text-rose-700"
                                  : selectedTeacherPreviewBadge.tone === "amber"
                                    ? "bg-amber-100 text-amber-700"
                                    : selectedTeacherPreviewBadge.tone ===
                                        "blue"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {selectedTeacherPreviewBadge.tone === "rose" && (
                                <i className="fas fa-triangle-exclamation text-[11px]"></i>
                              )}
                              {selectedTeacherPreviewBadge.tone === "amber" && (
                                <i className="fas fa-pen text-[11px]"></i>
                              )}
                              {selectedTeacherPreviewBadge.tone === "blue" && (
                                <i className="fas fa-check text-[11px]"></i>
                              )}
                              {selectedTeacherPreviewBadge.tone === "slate" && (
                                <i className="fas fa-clock text-[11px]"></i>
                              )}
                              {selectedTeacherPreviewBadge.text}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
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
      {/* ManageLesson is the current official teacher-present entry point.
          Future entry points should pass the same class context contract. */}
      {teacherPreviewOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm">
          <div className="h-full overflow-y-auto p-3 md:p-4">
            <TeacherPresentationLauncher
              recentItems={recentTeacherPreviewItems}
              selectedSummary={selectedTeacherPreviewSummary}
              selectedClassId={teacherPreviewClassId}
              selectedClassLabel={resolvedTeacherPreviewClassLabel}
              classOptions={sortedPresentationClassOptions}
              optionLoadState={presentationClassOptionLoadState}
              classLoadState={teacherPreviewClassLoadState}
              cachedSummary={cachedTeacherPreviewSummary}
              onSelectClass={handleTeacherPreviewClassChange}
            />
            <TeacherLessonPresentation
              key={`${lessonDraft.unitId || "lesson"}-${teacherPreviewClassId || "preview-default"}`}
              lesson={lessonDraft}
              fallbackTitle={selectedNodeTitle}
              fullscreenPreview
              classId={teacherPreviewClassId}
              classLabel={resolvedTeacherPreviewClassLabel}
              onRuntimeStatusChange={handleTeacherPreviewRuntimeStatusChange}
              onClosePreview={handleTeacherPreviewClose}
            />
          </div>
        </div>
      )}
      {(screenBusyMessage || pdfExtractionRetryOverlay) && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="rounded-2xl bg-white px-6 py-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <i className="fas fa-spinner fa-spin text-xl"></i>
            </div>
            <div className="text-sm font-bold text-gray-800">
              {pdfExtractionRetryOverlay?.message ||
                screenBusyMessage ||
                "잠시만 기다려 주세요."}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {screenBusyMessage
                ? "잠시만 기다려 주세요."
                : pdfExtractionRetryOverlay?.phase === "requesting"
                  ? "재요청을 준비하는 중입니다."
                  : "완료되면 이 창이 자동으로 닫힙니다."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageLesson;
