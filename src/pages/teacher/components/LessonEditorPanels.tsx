import React from "react";
import LessonWorksheetStage from "../../../components/common/LessonWorksheetStage";
import StorageImage from "../../../components/common/StorageImage";
import {
  getLessonPdfExtractionHelpText,
  getLessonPdfExtractionStatusLabel,
  getLessonPdfExtractionStatusTone,
  type LessonPdfProcessingMeta,
} from "../../../lib/lessonPdfExtraction";
import type {
  LessonData,
  LessonFootnote,
  LessonFootnoteUsage,
} from "../../../lib/lessonData";
import { getLessonFootnoteDisplayTitle } from "../../../lib/lessonData";
import type {
  LessonWorksheetBlank,
  LessonWorksheetFootnoteAnchor,
  LessonWorksheetPageImage,
  LessonWorksheetTextRegion,
} from "../../../lib/lessonWorksheet";
import LessonContent from "../../student/lesson/components/LessonContent";

export type LessonEditorTab = "pdf" | "student-preview";

export type LessonTreeNode = {
  id: string;
  title: string;
  children: LessonTreeNode[];
};

type SaveStateTone = "saved" | "saving" | "dirty";

type LessonTreePanelProps = {
  treeData: LessonTreeNode[];
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onOpenRootModal: () => void;
  onSaveTree: () => void;
  renderTreeNode: (node: LessonTreeNode, level: number) => React.ReactNode;
};

type LessonEditorHeaderProps = {
  lessonTitle: string;
  lessonVisibleToStudents: boolean;
  saveStateLabel?: string;
  saveStateTone?: SaveStateTone;
  saveButtonLabel?: string;
  disableSave?: boolean;
  onLessonTitleChange: (value: string) => void;
  onToggleVisible: (value: boolean) => void;
  onSave: () => void;
  onOpenTeacherPreview: () => void;
};

type LessonBodyEditorProps = {
  lessonContent: string;
  onLessonContentChange: (value: string) => void;
  bodyInsertMessage?: string;
  footnotes?: LessonFootnote[];
  footnoteUsageMap?: Map<string, LessonFootnoteUsage>;
  footnoteAnchorCountMap?: Map<string, number>;
  selectedFootnoteId?: string | null;
  footnoteEditorSession?: {
    mode: "create" | "edit";
    draft: LessonFootnote;
    pendingAnchorPlacement?: {
      page: number;
    } | null;
    insertIntoBody?: boolean;
  } | null;
  onBodySelectionChange?: (selection: { start: number; end: number }) => void;
  onAddFootnote?: () => void;
  onAddFootnoteAndInsert?: () => void;
  onOpenFootnoteEditor?: (footnoteId: string) => void;
  onFootnoteDraftChange?: (patch: Partial<LessonFootnote>) => void;
  onSaveFootnoteEditor?: () => void;
  onCloseFootnoteEditor?: () => void;
  onMoveFootnote?: (footnoteId: string, direction: -1 | 1) => void;
  onDeleteFootnote?: (footnoteId: string) => void;
  onInsertFootnoteToken?: (anchorKey: string) => void;
  onSelectFootnoteImage?: (footnoteId: string, file: File | null) => void;
  onRemoveFootnoteImage?: (footnoteId: string) => void;
  onOpenSourceArchivePicker?: (footnoteId: string) => void;
  onClearSourceArchiveImage?: (footnoteId: string) => void;
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
  sourceArchivePickerOpen?: boolean;
};

type LessonPdfSectionProps = {
  pdfBusy: boolean;
  selectedPdfFile: File | null;
  lessonPdfName: string;
  lessonPdfUrl: string;
  pdfProcessing: LessonPdfProcessingMeta;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  worksheetFootnoteAnchors: LessonWorksheetFootnoteAnchor[];
  worksheetTool: "ocr" | "box" | "footnote";
  activeBlankId: string | null;
  activeFootnoteAnchorId?: string | null;
  draftBlank: LessonWorksheetBlank | null;
  draftBlankAnswer: string;
  draftBlankPrompt: string;
  blankEditorMode: "draft" | "existing" | null;
  sortedBlanks: LessonWorksheetBlank[];
  pdfInputRef: React.RefObject<HTMLInputElement>;
  onPdfFileChange: (file: File | null) => void;
  onPreparePdf: () => void;
  onRemovePdf: () => void;
  onWorksheetToolChange: (value: "ocr" | "box" | "footnote") => void;
  onSelectBlank: (blankId: string) => void;
  onDeleteBlank: (blankId: string) => void;
  onSelectFootnoteAnchor?: (anchorId: string) => void;
  onDeleteFootnoteAnchor?: (anchorId: string) => void;
  onActivateFootnoteAnchor?: (anchorId: string) => void;
  footnoteTitles?: Record<string, string>;
  footnotes?: LessonFootnote[];
  footnoteUsageMap?: Map<string, LessonFootnoteUsage>;
  footnoteAnchorCountMap?: Map<string, number>;
  selectedFootnoteId?: string | null;
  onSelectFootnote?: (footnoteId: string) => void;
  onAddFootnote?: () => void;
  onAddFootnoteAndInsert?: () => void;
  onOpenFootnoteEditor?: (footnoteId: string) => void;
  onInsertFootnoteToken?: (anchorKey: string) => void;
  onCreateBlankFromSelection: (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
    matchedRegions: LessonWorksheetTextRegion[],
    source: "ocr" | "manual",
  ) => void;
  onCreateFootnoteAnchorFromSelection?: (
    page: number,
    rect: {
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    },
  ) => void;
  onDraftBlankAnswerChange: (value: string) => void;
  onDraftBlankPromptChange: (value: string) => void;
  onConfirmDraftBlank: () => void;
  onCancelDraftBlank: () => void;
  onUpdateBlank: (
    blankId: string,
    patch: Partial<LessonWorksheetBlank>,
  ) => void;
  hasUnsavedPdfChanges: boolean;
  pdfSaveState: SaveStateTone;
  pdfSaveFeedback?: {
    tone: "success" | "error";
    message: string;
  } | null;
  onSavePdf: () => void;
  disablePdfSave: boolean;
};

type LessonPreviewLauncherProps = {
  lesson: LessonData;
  unitId: string;
  fallbackTitle?: string;
  onOpenTeacherPreview: () => void;
};

function saveBadgeClass(tone: SaveStateTone = "saved") {
  if (tone === "saving")
    return "rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700";
  if (tone === "dirty")
    return "rounded-full bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700";
  return "rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700";
}

function usageBadgeClass(usage?: LessonFootnoteUsage) {
  return usage && usage.count > 0
    ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
    : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500";
}

function usageBadgeLabel(usage?: LessonFootnoteUsage) {
  if (!usage || usage.count === 0) return "본문 연결 없음";
  if (usage.count === 1) return "본문에 표시됨";
  return `본문 ${usage.count}곳에 표시됨`;
}

function footnoteAnchorBadgeLabel(count = 0) {
  if (count <= 0) return "PDF 위치 미지정";
  if (count === 1) return "PDF에 표시됨";
  return `PDF ${count}곳에 표시`;
}

const stripHtml = (value?: string) =>
  String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getFootnoteDisplayName = (footnote: LessonFootnote, index?: number) =>
  getLessonFootnoteDisplayTitle(footnote) ||
  (typeof index === "number" ? `각주 ${index + 1}` : "각주");

function blankBadgeLabel(blank: LessonWorksheetBlank) {
  return (
    blank.answer?.trim() || blank.prompt?.trim() || `p.${blank.page + 1} 빈칸`
  );
}

function pdfStatusBadgeClass(
  tone: ReturnType<typeof getLessonPdfExtractionStatusTone>,
) {
  if (tone === "rose") {
    return "rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-700";
  }
  if (tone === "emerald") {
    return "rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700";
  }
  if (tone === "blue") {
    return "rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700";
  }
  if (tone === "amber") {
    return "rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700";
  }
  return "rounded-full bg-white px-3 py-1 font-semibold text-slate-700";
}

export function LessonTreePanel({
  treeData,
  sidebarOpen,
  onCloseSidebar,
  onOpenRootModal,
  onSaveTree,
  renderTreeNode,
}: LessonTreePanelProps) {
  const content = (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">수업 자료 트리</h2>
          <p className="text-xs text-gray-500">
            단원과 자료 구조를 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenRootModal}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
          >
            새 묶음
          </button>
          <button
            type="button"
            onClick={onSaveTree}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700"
          >
            트리 저장
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {treeData.map((node) => renderTreeNode(node, 0))}
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden w-full max-w-sm lg:block">{content}</div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 lg:hidden">
          <div className="mx-auto h-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
              <div className="text-lg font-bold text-gray-800">
                수업 자료 트리
              </div>
              <button
                type="button"
                onClick={onCloseSidebar}
                className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
              >
                닫기
              </button>
            </div>
            <div className="h-[calc(100%-73px)] p-4">{content}</div>
          </div>
        </div>
      )}
    </>
  );
}

export function LessonEditorHeader({
  lessonTitle,
  lessonVisibleToStudents,
  saveStateLabel = "저장됨",
  saveStateTone = "saved",
  saveButtonLabel = "저장",
  disableSave = false,
  onLessonTitleChange,
  onToggleVisible,
  onSave,
  onOpenTeacherPreview,
}: LessonEditorHeaderProps) {
  return (
    <div className="border-b border-gray-200 bg-white px-4 py-4 lg:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            자료 제목
          </span>
          <input
            value={lessonTitle}
            onChange={(event) => onLessonTitleChange(event.target.value)}
            placeholder="수업 자료 제목을 입력하세요"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-lg font-bold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <div className={saveBadgeClass(saveStateTone)}>{saveStateLabel}</div>
          <label className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={lessonVisibleToStudents}
              onChange={(event) => onToggleVisible(event.target.checked)}
            />
            학생 공개
          </label>
          <button
            type="button"
            onClick={onSave}
            disabled={disableSave}
            className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saveButtonLabel}
          </button>
          <button
            type="button"
            onClick={onOpenTeacherPreview}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <i className="fas fa-chalkboard-teacher text-sm"></i>
            수업 화면
          </button>
        </div>
      </div>
    </div>
  );
}

function FootnoteSummaryCard({
  footnote,
  index,
  usage,
  pdfAnchorCount = 0,
  selected = false,
  onOpen,
}: {
  footnote: LessonFootnote;
  index: number;
  usage?: LessonFootnoteUsage;
  pdfAnchorCount?: number;
  selected?: boolean;
  onOpen?: () => void;
}) {
  const previewText = stripHtml(footnote.bodyHtml);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-3xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md ${
        selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
          {getFootnoteDisplayName(footnote, index)}
        </strong>
        {selected && (
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
            현재 편집 중
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={usageBadgeClass(usage)}>{usageBadgeLabel(usage)}</span>
        <span
          className={
            pdfAnchorCount > 0
              ? "rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
          }
        >
          {footnoteAnchorBadgeLabel(pdfAnchorCount)}
        </span>
      </div>
      <div className="mt-3 text-xs leading-5 text-slate-500">
        {previewText || "제목, 설명, 이미지, 유튜브를 간단히 채울 수 있습니다."}
      </div>
    </button>
  );
}

function FootnoteEditorDialog({
  session,
  footnotes,
  footnoteUsageMap,
  footnoteAnchorCountMap,
  onFootnoteDraftChange,
  onMoveFootnote,
  onDeleteFootnote,
  onSaveFootnoteEditor,
  onCloseFootnoteEditor,
  onSelectFootnoteImage,
  onRemoveFootnoteImage,
  onOpenSourceArchivePicker,
  onClearSourceArchiveImage,
  getFootnotePreviewUrl,
  isNestedModalOpen = false,
}: {
  session: NonNullable<LessonBodyEditorProps["footnoteEditorSession"]>;
  footnotes: LessonFootnote[];
  footnoteUsageMap: Map<string, LessonFootnoteUsage>;
  footnoteAnchorCountMap: Map<string, number>;
  onFootnoteDraftChange?: (patch: Partial<LessonFootnote>) => void;
  onMoveFootnote?: (footnoteId: string, direction: -1 | 1) => void;
  onDeleteFootnote?: (footnoteId: string) => void;
  onSaveFootnoteEditor?: () => void;
  onCloseFootnoteEditor?: () => void;
  onSelectFootnoteImage?: (footnoteId: string, file: File | null) => void;
  onRemoveFootnoteImage?: (footnoteId: string) => void;
  onOpenSourceArchivePicker?: (footnoteId: string) => void;
  onClearSourceArchiveImage?: (footnoteId: string) => void;
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
  isNestedModalOpen?: boolean;
}) {
  const footnote = session.draft;
  const usage = footnoteUsageMap.get(footnote.anchorKey);
  const pdfAnchorCount = footnoteAnchorCountMap.get(footnote.id) ?? 0;
  const previewUrl =
    getFootnotePreviewUrl?.(footnote) || footnote.imageUrl || "";
  const currentIndex = footnotes.findIndex((item) => item.id === footnote.id);
  const dialogTitleId = "lesson-footnote-editor-title";
  const nestedModalProps = isNestedModalOpen
    ? ({ inert: "" } as React.HTMLAttributes<HTMLDivElement>)
    : {};
  const locationMessage = session.pendingAnchorPlacement
    ? `PDF p.${session.pendingAnchorPlacement.page} 위치를 선택했습니다. 저장 버튼을 누르면 버튼이 생깁니다.`
    : footnoteAnchorBadgeLabel(pdfAnchorCount);
  const stopEditorEventPropagation = React.useCallback(
    (
      event:
        | React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
        | React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>
        | React.FormEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      event.stopPropagation();
    },
    [],
  );
  const handleFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      stopEditorEventPropagation(event);
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onCloseFootnoteEditor?.();
      }
    },
    [onCloseFootnoteEditor, stopEditorEventPropagation],
  );

  return (
    <div
      {...nestedModalProps}
      className={`fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-sm ${
        isNestedModalOpen ? "pointer-events-none" : ""
      }`}
      role="dialog"
      aria-modal={isNestedModalOpen ? undefined : true}
      aria-hidden={isNestedModalOpen}
      aria-labelledby={dialogTitleId}
    >
      <div className="flex h-full items-end justify-center p-3 md:items-center md:p-6">
        <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.2)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {session.mode === "create" ? "새 각주" : "각주 편집"}
              </div>
              <h4
                id={dialogTitleId}
                className="mt-1 text-lg font-bold text-slate-900"
              >
                {session.mode === "create"
                  ? "PDF 팝업 내용 입력"
                  : getFootnoteDisplayName(footnote)}
              </h4>
              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className={
                    pdfAnchorCount > 0 || session.pendingAnchorPlacement
                      ? "rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                      : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                  }
                >
                  {locationMessage}
                </span>
                {session.insertIntoBody && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    저장하면 본문에도 넣기
                  </span>
                )}
                {usage && (
                  <span className={usageBadgeClass(usage)}>
                    {usageBadgeLabel(usage)}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseFootnoteEditor}
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              닫기
            </button>
          </div>

          <div className="max-h-[calc(88vh-84px)] overflow-y-auto px-5 py-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                      팝업 제목
                    </span>
                    <input
                      value={footnote.title ?? ""}
                      onChange={(event) =>
                        onFootnoteDraftChange?.({ title: event.target.value })
                      }
                      onKeyDown={handleFieldKeyDown}
                      onKeyUp={stopEditorEventPropagation}
                      onBeforeInput={stopEditorEventPropagation}
                      onCompositionStart={stopEditorEventPropagation}
                      onCompositionUpdate={stopEditorEventPropagation}
                      onCompositionEnd={stopEditorEventPropagation}
                      placeholder="예: 독립신문 기사"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                      각주 버튼 이름
                    </span>
                    <input
                      value={footnote.label ?? ""}
                      onChange={(event) =>
                        onFootnoteDraftChange?.({ label: event.target.value })
                      }
                      onKeyDown={handleFieldKeyDown}
                      onKeyUp={stopEditorEventPropagation}
                      onBeforeInput={stopEditorEventPropagation}
                      onCompositionStart={stopEditorEventPropagation}
                      onCompositionUpdate={stopEditorEventPropagation}
                      onCompositionEnd={stopEditorEventPropagation}
                      placeholder="예: 기사 보기"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    팝업 내용
                  </span>
                  <textarea
                    value={footnote.bodyHtml ?? ""}
                    onChange={(event) =>
                      onFootnoteDraftChange?.({ bodyHtml: event.target.value })
                    }
                    onKeyDown={handleFieldKeyDown}
                    onKeyUp={stopEditorEventPropagation}
                    onBeforeInput={stopEditorEventPropagation}
                    onCompositionStart={stopEditorEventPropagation}
                    onCompositionUpdate={stopEditorEventPropagation}
                    onCompositionEnd={stopEditorEventPropagation}
                    rows={4}
                    placeholder="학생에게 보여 줄 설명이나 해설을 적어 주세요."
                    className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  />
                </label>

                <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                      유튜브 링크
                    </span>
                    <input
                      value={footnote.youtubeUrl ?? ""}
                      onChange={(event) =>
                        onFootnoteDraftChange?.({
                          youtubeUrl: event.target.value,
                        })
                      }
                      onKeyDown={handleFieldKeyDown}
                      onKeyUp={stopEditorEventPropagation}
                      onBeforeInput={stopEditorEventPropagation}
                      onCompositionStart={stopEditorEventPropagation}
                      onCompositionUpdate={stopEditorEventPropagation}
                      onCompositionEnd={stopEditorEventPropagation}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">
                      업로드 이미지
                    </div>
                    {(previewUrl || footnote.imageStoragePath) && (
                      <button
                        type="button"
                        onClick={() => onRemoveFootnoteImage?.(footnote.id)}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                      >
                        제거
                      </button>
                    )}
                  </div>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <i className="fas fa-image text-[11px]"></i>
                    이미지 선택
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) =>
                        onSelectFootnoteImage?.(
                          footnote.id,
                          event.target.files?.[0] ?? null,
                        )
                      }
                    />
                  </label>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={getFootnoteDisplayName(footnote)}
                        className="h-32 w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-slate-500">
                        선택한 이미지가 없으면 텍스트 내용만 표시됩니다.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">
                      사료창고 이미지
                    </div>
                    {footnote.sourceArchiveImagePath && (
                      <button
                        type="button"
                        onClick={() => onClearSourceArchiveImage?.(footnote.id)}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                      >
                        제거
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenSourceArchivePicker?.(footnote.id)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <i className="fas fa-landmark text-[11px]"></i>
                    사료창고에서 선택
                  </button>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {footnote.sourceArchiveImagePath ? (
                      <>
                        <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                          {footnote.sourceArchiveTitle ||
                            getFootnoteDisplayName(footnote)}
                        </div>
                        <StorageImage
                          path={footnote.sourceArchiveImagePath}
                          alt={
                            footnote.sourceArchiveTitle ||
                            getFootnoteDisplayName(footnote)
                          }
                          className="h-32 w-full object-contain"
                          fallback={
                            <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-slate-500">
                              사료 이미지를 불러오지 못했습니다.
                            </div>
                          }
                        />
                      </>
                    ) : (
                      <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-slate-500">
                        사료창고 이미지를 연결하면 팝업에 함께 보여 줄 수
                        있습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {session.mode === "edit" && currentIndex >= 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onMoveFootnote?.(footnote.id, -1)}
                    disabled={currentIndex === 0}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <i className="fas fa-arrow-up text-[10px]"></i>
                    위로
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveFootnote?.(footnote.id, 1)}
                    disabled={currentIndex === footnotes.length - 1}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <i className="fas fa-arrow-down text-[10px]"></i>
                    아래로
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFootnote?.(footnote.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    <i className="fas fa-trash text-[10px]"></i>
                    삭제
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onCloseFootnoteEditor}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={onSaveFootnoteEditor}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <i className="fas fa-check text-xs"></i>
                {session.mode === "create" ? "추가하기" : "변경 적용"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LessonBodyEditor({
  lessonContent,
  onLessonContentChange,
  bodyInsertMessage,
  footnotes = [],
  footnoteUsageMap = new Map<string, LessonFootnoteUsage>(),
  footnoteAnchorCountMap = new Map<string, number>(),
  selectedFootnoteId = null,
  footnoteEditorSession = null,
  onBodySelectionChange,
  onAddFootnote,
  onAddFootnoteAndInsert,
  onOpenFootnoteEditor,
  onFootnoteDraftChange,
  onSaveFootnoteEditor,
  onCloseFootnoteEditor,
  onMoveFootnote,
  onDeleteFootnote,
  onInsertFootnoteToken,
  onSelectFootnoteImage,
  onRemoveFootnoteImage,
  onOpenSourceArchivePicker,
  onClearSourceArchiveImage,
  getFootnotePreviewUrl,
  sourceArchivePickerOpen = false,
}: LessonBodyEditorProps) {
  const connectedCount = footnotes.filter(
    (footnote) => (footnoteUsageMap.get(footnote.anchorKey)?.count ?? 0) > 0,
  ).length;
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const reportSelection = () => {
    const element = textareaRef.current;
    if (!element || !onBodySelectionChange) return;
    onBodySelectionChange({
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? 0,
    });
  };

  return (
    <section className="space-y-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          본문 편집
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          본문은 문장 편집에만 집중합니다
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          각주 목록과 PDF 위치 관리는 오른쪽 플로팅 패널에서 진행하고, 여기서는
          본문 문장과 각주 토큰 배치만 확인합니다.
        </p>
      </div>
      <textarea
        ref={textareaRef}
        value={lessonContent}
        onChange={(event) => onLessonContentChange(event.target.value)}
        onClick={reportSelection}
        onKeyUp={reportSelection}
        onSelect={reportSelection}
        rows={16}
        className="w-full rounded-3xl border border-slate-200 px-4 py-4 text-sm leading-7 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
      />
      <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            등록 각주 {footnotes.length}개
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            본문 연결 {connectedCount}개
          </span>
          {selectedFootnoteId && (
            <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
              선택 각주 반영 중
            </span>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-600">
          오른쪽 목록 패널의 `각주` 탭에서 `본문에 넣기`를 누르면 현재 커서
          위치에 각주 표시가 들어가고, 선택 범위가 없으면 본문 끝에 추가됩니다.
        </p>
        {!!bodyInsertMessage && (
          <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-blue-700">
            {bodyInsertMessage}
          </div>
        )}
      </div>
      {footnoteEditorSession && (
        <FootnoteEditorDialog
          session={footnoteEditorSession}
          footnotes={footnotes}
          footnoteUsageMap={footnoteUsageMap}
          footnoteAnchorCountMap={footnoteAnchorCountMap}
          onFootnoteDraftChange={onFootnoteDraftChange}
          onMoveFootnote={onMoveFootnote}
          onDeleteFootnote={onDeleteFootnote}
          onSaveFootnoteEditor={onSaveFootnoteEditor}
          onCloseFootnoteEditor={onCloseFootnoteEditor}
          onSelectFootnoteImage={onSelectFootnoteImage}
          onRemoveFootnoteImage={onRemoveFootnoteImage}
          onOpenSourceArchivePicker={onOpenSourceArchivePicker}
          onClearSourceArchiveImage={onClearSourceArchiveImage}
          getFootnotePreviewUrl={getFootnotePreviewUrl}
          isNestedModalOpen={sourceArchivePickerOpen}
        />
      )}
    </section>
  );
}

export function LessonPdfSection({
  pdfBusy,
  selectedPdfFile,
  lessonPdfName,
  lessonPdfUrl,
  pdfProcessing,
  worksheetPageImages,
  worksheetTextRegions,
  worksheetBlanks,
  worksheetFootnoteAnchors,
  worksheetTool,
  activeBlankId,
  activeFootnoteAnchorId,
  draftBlank,
  draftBlankAnswer,
  draftBlankPrompt,
  blankEditorMode,
  sortedBlanks,
  pdfInputRef,
  onPdfFileChange,
  onPreparePdf,
  onRemovePdf,
  onWorksheetToolChange,
  onSelectBlank,
  onDeleteBlank,
  onSelectFootnoteAnchor,
  onDeleteFootnoteAnchor,
  onActivateFootnoteAnchor,
  footnoteTitles,
  footnotes = [],
  footnoteUsageMap = new Map<string, LessonFootnoteUsage>(),
  footnoteAnchorCountMap = new Map<string, number>(),
  selectedFootnoteId = null,
  onSelectFootnote,
  onAddFootnote,
  onAddFootnoteAndInsert,
  onOpenFootnoteEditor,
  onInsertFootnoteToken,
  onCreateBlankFromSelection,
  onCreateFootnoteAnchorFromSelection,
  onDraftBlankAnswerChange,
  onDraftBlankPromptChange,
  onConfirmDraftBlank,
  onCancelDraftBlank,
  hasUnsavedPdfChanges,
  pdfSaveState,
  pdfSaveFeedback,
  onSavePdf,
  disablePdfSave,
}: LessonPdfSectionProps) {
  const [activeFloatingPanel, setActiveFloatingPanel] = React.useState<
    "library" | null
  >(null);
  const [activeLibraryTab, setActiveLibraryTab] = React.useState<
    "blanks" | "footnotes"
  >("blanks");
  const [showAllBlanks, setShowAllBlanks] = React.useState(false);
  const [teacherCurrentPage, setTeacherCurrentPage] = React.useState<
    number | null
  >(worksheetPageImages[0]?.page ?? null);
  const pdfStatusLabel = React.useMemo(
    () => getLessonPdfExtractionStatusLabel(pdfProcessing),
    [pdfProcessing],
  );
  const pdfStatusTone = React.useMemo(
    () => getLessonPdfExtractionStatusTone(pdfProcessing),
    [pdfProcessing],
  );
  const pdfStatusHelpText = React.useMemo(
    () => getLessonPdfExtractionHelpText(pdfProcessing),
    [pdfProcessing],
  );
  const pdfSaveStatusTone = React.useMemo(() => {
    if (pdfSaveFeedback?.tone === "error") return "error";
    if (hasUnsavedPdfChanges) return "dirty";
    if (pdfSaveFeedback?.tone === "success") return "success";
    return null;
  }, [hasUnsavedPdfChanges, pdfSaveFeedback]);
  const pdfSaveStatusMessage = React.useMemo(() => {
    if (pdfSaveFeedback?.tone === "error") {
      return pdfSaveFeedback.message;
    }
    if (hasUnsavedPdfChanges) {
      return "저장하지 않은 PDF 편집 내용이 있습니다. 상단 저장 버튼이나 오른쪽 저장 버튼을 눌러 반영하세요. 저장 후 학생/수업 화면에 반영됩니다.";
    }
    return pdfSaveFeedback?.message || "";
  }, [hasUnsavedPdfChanges, pdfSaveFeedback]);
  const activeBlank = React.useMemo(
    () => sortedBlanks.find((blank) => blank.id === activeBlankId) || null,
    [activeBlankId, sortedBlanks],
  );
  const blankEditorAnswerInputRef = React.useRef<HTMLInputElement>(null);
  const blankEditorPage = draftBlank?.page ?? activeBlank?.page ?? null;
  const isBlankEditorOpen =
    (blankEditorMode === "draft" && !!draftBlank) ||
    (blankEditorMode === "existing" && !!activeBlank);
  const visibleBlanks = React.useMemo(
    () => (showAllBlanks ? sortedBlanks : sortedBlanks.slice(0, 5)),
    [showAllBlanks, sortedBlanks],
  );
  const isLibraryPanelOpen = activeFloatingPanel === "library";
  const footnoteAnchorsByFootnote = React.useMemo(() => {
    const grouped = new Map<string, LessonWorksheetFootnoteAnchor[]>();
    worksheetFootnoteAnchors.forEach((anchor) => {
      const current = grouped.get(anchor.footnoteId) || [];
      current.push(anchor);
      grouped.set(anchor.footnoteId, current);
    });
    grouped.forEach((anchors, footnoteId) => {
      grouped.set(
        footnoteId,
        [...anchors].sort(
          (left, right) =>
            left.page - right.page ||
            left.topRatio - right.topRatio ||
            left.leftRatio - right.leftRatio,
        ),
      );
    });
    return grouped;
  }, [worksheetFootnoteAnchors]);

  const handleApplyBlankEditor = React.useCallback(() => {
    onConfirmDraftBlank();
  }, [onConfirmDraftBlank]);

  React.useEffect(() => {
    if (!isLibraryPanelOpen || activeLibraryTab !== "blanks") {
      setShowAllBlanks(false);
    }
  }, [activeLibraryTab, isLibraryPanelOpen]);

  React.useEffect(() => {
    if (!worksheetPageImages.length) {
      setTeacherCurrentPage(null);
      return;
    }
    setTeacherCurrentPage((current) => {
      if (
        current != null &&
        worksheetPageImages.some((pageImage) => pageImage.page === current)
      ) {
        return current;
      }
      return worksheetPageImages[0].page;
    });
  }, [worksheetPageImages]);

  React.useEffect(() => {
    if (!isBlankEditorOpen) return;
    const frameId = window.requestAnimationFrame(() => {
      blankEditorAnswerInputRef.current?.focus();
      blankEditorAnswerInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeBlankId, draftBlank?.id, isBlankEditorOpen]);

  const toggleFloatingPanel = React.useCallback((panel: "library") => {
    setActiveFloatingPanel((prev) => (prev === panel ? null : panel));
  }, []);
  const openLibraryTab = React.useCallback((tab: "blanks" | "footnotes") => {
    setActiveLibraryTab(tab);
    setActiveFloatingPanel("library");
  }, []);
  const activeToolLabel = React.useMemo(() => {
    if (worksheetTool === "ocr") return "OCR 선택";
    if (worksheetTool === "box") return "빈칸 도구";
    return "각주 배치";
  }, [worksheetTool]);
  const librarySummaryText =
    activeLibraryTab === "blanks"
      ? "PDF 빈칸을 빠르게 확인하고 선택하거나 삭제할 수 있습니다."
      : "각주 위치 확인, 본문 연결, 각주 편집을 한곳에서 관리합니다.";
  const libraryCount =
    activeLibraryTab === "blanks" ? sortedBlanks.length : footnotes.length;
  const floatingButtonClass = (
    active: boolean,
    tone: "blue" | "slate" = "slate",
  ) =>
    `inline-flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 ${
      active
        ? tone === "blue"
          ? "bg-blue-600 text-white shadow-sm focus-visible:ring-blue-100"
          : "bg-slate-900 text-white shadow-sm focus-visible:ring-slate-200"
        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-100"
    }`;

  const focusFootnote = React.useCallback(
    (footnoteId: string) => {
      openLibraryTab("footnotes");
      onSelectFootnote?.(footnoteId);
      const primaryAnchor =
        footnoteAnchorsByFootnote.get(footnoteId)?.[0] || null;
      if (primaryAnchor) {
        setTeacherCurrentPage(primaryAnchor.page);
        onSelectFootnoteAnchor?.(primaryAnchor.id);
      }
    },
    [
      footnoteAnchorsByFootnote,
      onSelectFootnote,
      onSelectFootnoteAnchor,
      openLibraryTab,
    ],
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            PDF 편집
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            PDF 위에서 빈칸과 각주를 함께 편집합니다
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            PDF를 준비한 뒤 오른쪽 플로팅 UI에서 목록 패널과 제작 도구를 오가며
            빈칸 생성, 각주 배치, 저장까지 한 흐름으로 진행할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <i className="fas fa-file-pdf text-sm"></i>
            PDF 선택
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) =>
                onPdfFileChange(event.target.files?.[0] ?? null)
              }
            />
          </label>
          <button
            type="button"
            onClick={onPreparePdf}
            disabled={!selectedPdfFile || pdfBusy}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pdfBusy ? "준비 중..." : "PDF 준비"}
          </button>
          {(lessonPdfUrl || worksheetPageImages.length > 0) && (
            <button
              type="button"
              onClick={onRemovePdf}
              className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              PDF 삭제
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">
          현재 파일: {selectedPdfFile?.name || lessonPdfName || "없음"}
        </span>
        {!!pdfStatusLabel && (
          <span className={pdfStatusBadgeClass(pdfStatusTone)}>
            {pdfStatusLabel}
          </span>
        )}
        <span>
          오른쪽 플로팅 UI에서 목록 패널과 제작 도구를 전환하고, 빈칸을 만들면
          작은 팝업에서 바로 정답을 입력할 수 있습니다.
        </span>
      </div>
      {!!pdfSaveStatusTone && !!pdfSaveStatusMessage && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            pdfSaveStatusTone === "dirty"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : pdfSaveStatusTone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {pdfSaveStatusMessage}
        </div>
      )}
      {!!pdfStatusHelpText && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {pdfStatusHelpText}
        </div>
      )}
      {worksheetTool === "footnote" && !!worksheetPageImages.length && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
          원하는 위치를 한 번 눌러 각주 버튼을 찍어 주세요. 바로 작은 편집창이
          열립니다. 각주를 추가한 뒤 저장 버튼을 눌러 보관하세요.
        </div>
      )}
      {!!worksheetPageImages.length ? (
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
          <div className="pointer-events-none fixed bottom-6 right-4 z-40 flex flex-col items-end gap-3 md:right-8">
            {isLibraryPanelOpen && (
              <div className="pointer-events-auto w-[min(392px,calc(100vw-1.5rem))] rounded-[30px] border border-slate-200 bg-white/98 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      목록
                    </div>
                    <div className="mt-1 text-base font-bold text-slate-900">
                      빈칸과 각주를 한곳에서 관리합니다
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {librarySummaryText}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {libraryCount}개
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveFloatingPanel(null)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                      aria-label="목록 패널 닫기"
                    >
                      <i className="fas fa-times text-sm"></i>
                    </button>
                  </div>
                </div>
                <div className="mt-4 inline-flex rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveLibraryTab("blanks")}
                    className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                      activeLibraryTab === "blanks"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    aria-pressed={activeLibraryTab === "blanks"}
                  >
                    빈칸 {sortedBlanks.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveLibraryTab("footnotes")}
                    className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                      activeLibraryTab === "footnotes"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    aria-pressed={activeLibraryTab === "footnotes"}
                  >
                    각주 {footnotes.length}
                  </button>
                </div>
                {activeLibraryTab === "blanks" ? (
                  <>
                    {sortedBlanks.length === 0 ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                        아직 만든 빈칸이 없습니다.
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 flex max-h-[min(50vh,360px)] flex-wrap gap-2 overflow-y-auto pr-1">
                          {visibleBlanks.map((blank) => (
                            <div
                              key={blank.id}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                                activeBlankId === blank.id
                                  ? "border-blue-300 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectBlank(blank.id)}
                                className="max-w-[180px] truncate px-1 text-sm font-semibold"
                                title={blankBadgeLabel(blank)}
                              >
                                {blankBadgeLabel(blank)}
                              </button>
                              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                p.{blank.page + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => onDeleteBlank(blank.id)}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-rose-500 hover:bg-rose-50"
                                aria-label="빈칸 삭제"
                                title="빈칸 삭제"
                              >
                                <i className="fas fa-times text-[10px]"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                        {sortedBlanks.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setShowAllBlanks((prev) => !prev)}
                            className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            <i
                              className={`fas ${
                                showAllBlanks
                                  ? "fa-chevron-up"
                                  : "fa-chevron-down"
                              } text-[10px]`}
                            ></i>
                            {showAllBlanks
                              ? "접기"
                              : `${sortedBlanks.length - visibleBlanks.length}개 더보기`}
                          </button>
                        )}
                      </>
                    )}
                    {activeBlank && (
                      <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
                        선택한 빈칸:{" "}
                        <span className="font-semibold text-slate-800">
                          {blankBadgeLabel(activeBlank)}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onAddFootnote}
                        className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                      >
                        <i className="fas fa-plus text-[10px]"></i>새 각주
                      </button>
                      <button
                        type="button"
                        onClick={onAddFootnoteAndInsert}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <i className="fas fa-link text-[10px]"></i>
                        본문용 각주
                      </button>
                    </div>
                    {footnotes.length === 0 ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                        아직 각주가 없습니다. `새 각주`로 먼저 팝업을 만들어
                        주세요.
                      </div>
                    ) : (
                      <div className="mt-4 max-h-[min(56vh,460px)] space-y-3 overflow-y-auto pr-1">
                        {footnotes.map((footnote, index) => {
                          const anchors =
                            footnoteAnchorsByFootnote.get(footnote.id) || [];
                          const primaryAnchor = anchors[0] || null;
                          return (
                            <FootnoteFloatingListItem
                              key={footnote.id}
                              footnote={footnote}
                              index={index}
                              usage={footnoteUsageMap.get(footnote.anchorKey)}
                              pdfAnchorCount={
                                footnoteAnchorCountMap.get(footnote.id) ?? 0
                              }
                              selected={selectedFootnoteId === footnote.id}
                              primaryAnchorPage={primaryAnchor?.page ?? null}
                              onSelect={() => focusFootnote(footnote.id)}
                              onOpenEditor={() => {
                                focusFootnote(footnote.id);
                                onOpenFootnoteEditor?.(footnote.id);
                              }}
                              onInsertIntoBody={() =>
                                onInsertFootnoteToken?.(footnote.anchorKey)
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="pointer-events-auto w-40 rounded-[30px] border border-slate-200 bg-white/96 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
              <div className="px-1 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                관리
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => toggleFloatingPanel("library")}
                  className={floatingButtonClass(isLibraryPanelOpen, "blue")}
                  aria-label="빈칸과 각주 목록"
                  aria-pressed={isLibraryPanelOpen}
                  title="빈칸과 각주 목록"
                >
                  <i className="fas fa-layer-group text-sm"></i>
                  <span className="flex-1 text-left">목록</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isLibraryPanelOpen
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {sortedBlanks.length + footnotes.length}
                  </span>
                </button>
              </div>
              <div className="my-2 h-px bg-slate-200"></div>
              <div className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                도구
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onWorksheetToolChange("ocr")}
                  className={floatingButtonClass(worksheetTool === "ocr")}
                  aria-label="OCR 기반 선택"
                  aria-pressed={worksheetTool === "ocr"}
                  title="OCR 기반 선택"
                >
                  <i className="fas fa-wand-magic-sparkles text-sm"></i>
                  <span className="flex-1 text-left">OCR 선택</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onWorksheetToolChange("box");
                    openLibraryTab("blanks");
                  }}
                  className={floatingButtonClass(worksheetTool === "box")}
                  aria-label="빈칸 도구"
                  aria-pressed={worksheetTool === "box"}
                  title="빈칸 도구"
                >
                  <i className="fas fa-vector-square text-sm"></i>
                  <span className="flex-1 text-left">빈칸 도구</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onWorksheetToolChange("footnote");
                    openLibraryTab("footnotes");
                  }}
                  className={floatingButtonClass(worksheetTool === "footnote")}
                  aria-label="각주 위치 추가"
                  aria-pressed={worksheetTool === "footnote"}
                  title="각주 위치 추가"
                >
                  <i className="fas fa-location-crosshairs text-sm"></i>
                  <span className="flex-1 text-left">각주 배치</span>
                </button>
              </div>
              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">
                    현재 도구: {activeToolLabel}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${saveSummaryClassName}`}
                  >
                    {saveSummaryLabel}
                  </span>
                </div>
                <div className="mt-1">
                  {hasUnsavedPdfChanges
                    ? "변경 사항이 있습니다."
                    : "PDF 편집 내용이 저장된 상태입니다."}
                </div>
              </div>
              <div className="my-2 h-px bg-slate-200"></div>
              <button
                type="button"
                onClick={onSavePdf}
                disabled={disablePdfSave}
                className={`inline-flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 ${
                  disablePdfSave
                    ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    : hasUnsavedPdfChanges
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-200/70 ring-4 ring-blue-100 hover:bg-blue-700 focus-visible:ring-blue-100"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-100"
                }`}
                aria-label={
                  pdfSaveState === "saving" ? "PDF 저장 중" : "PDF 저장"
                }
                title={pdfSaveState === "saving" ? "PDF 저장 중" : "PDF 저장"}
              >
                <i
                  className={`fas ${
                    pdfSaveState === "saving"
                      ? "fa-spinner fa-spin"
                      : "fa-floppy-disk"
                  }`}
                ></i>
                <span className="flex-1 text-left">
                  {pdfSaveState === "saving" ? "저장 중" : "저장"}
                </span>
              </button>
            </div>
          </div>
          <div className="p-3 md:p-4">
            <LessonWorksheetStage
              mode="teacher-edit"
              pageImages={worksheetPageImages}
              blanks={worksheetBlanks}
              textRegions={worksheetTextRegions}
              teacherTool={worksheetTool}
              selectedBlankId={activeBlankId}
              footnoteAnchors={worksheetFootnoteAnchors}
              selectedFootnoteAnchorId={activeFootnoteAnchorId}
              pendingBlank={draftBlank}
              onSelectBlank={onSelectBlank}
              onDeleteBlank={onDeleteBlank}
              onSelectFootnoteAnchor={onSelectFootnoteAnchor}
              onDeleteFootnoteAnchor={onDeleteFootnoteAnchor}
              onActivateFootnoteAnchor={onActivateFootnoteAnchor}
              footnoteTitles={footnoteTitles}
              teacherCurrentPage={teacherCurrentPage}
              onTeacherCurrentPageChange={setTeacherCurrentPage}
              onCreateBlankFromSelection={onCreateBlankFromSelection}
              onCreateFootnoteAnchorFromSelection={
                onCreateFootnoteAnchorFromSelection
              }
            />
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
          PDF를 준비하면 여기에서 OCR 결과와 빈칸, 각주를 편집할 수 있습니다.
        </div>
      )}
      {isBlankEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="빈칸 편집 닫기"
            onClick={onCancelDraftBlank}
            className="absolute inset-0 bg-slate-950/10 backdrop-blur-[1px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lesson-blank-editor-title"
            className="relative z-10 w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.16)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  {blankEditorMode === "draft" ? "새 빈칸" : "선택한 빈칸"}
                </div>
                <h4
                  id="lesson-blank-editor-title"
                  className="mt-2 text-lg font-bold text-slate-900"
                >
                  {blankEditorMode === "draft"
                    ? "정답을 바로 입력해 추가합니다"
                    : "정답과 안내 문구를 수정합니다"}
                </h4>
                <p className="mt-1 text-sm text-slate-500">
                  {blankEditorPage
                    ? `p.${blankEditorPage} 빈칸에 바로 반영됩니다.`
                    : "현재 선택한 빈칸에 바로 반영됩니다."}
                </p>
              </div>
              <button
                type="button"
                onClick={onCancelDraftBlank}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                aria-label="빈칸 편집 닫기"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  정답
                </span>
                <input
                  ref={blankEditorAnswerInputRef}
                  value={draftBlankAnswer}
                  onChange={(event) =>
                    onDraftBlankAnswerChange(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelDraftBlank();
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleApplyBlankEditor();
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  placeholder="정답 입력"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  학생 안내 문구
                </span>
                <input
                  value={draftBlankPrompt}
                  onChange={(event) =>
                    onDraftBlankPromptChange(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelDraftBlank();
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleApplyBlankEditor();
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  placeholder="비워 두면 기본 빈칸 문구를 사용합니다"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelDraftBlank}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleApplyBlankEditor}
                className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {blankEditorMode === "draft" ? "적용하고 추가" : "적용"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FootnoteFloatingListItem({
  footnote,
  index,
  usage,
  pdfAnchorCount = 0,
  selected = false,
  primaryAnchorPage = null,
  onSelect,
  onOpenEditor,
  onInsertIntoBody,
}: {
  footnote: LessonFootnote;
  index: number;
  usage?: LessonFootnoteUsage;
  pdfAnchorCount?: number;
  selected?: boolean;
  primaryAnchorPage?: number | null;
  onSelect?: () => void;
  onOpenEditor?: () => void;
  onInsertIntoBody?: () => void;
}) {
  const previewText = stripHtml(footnote.bodyHtml);

  return (
    <div
      className={`rounded-[26px] border bg-white p-4 shadow-sm transition ${
        selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
              {getFootnoteDisplayName(footnote, index)}
            </strong>
            {selected && (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                선택됨
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={usageBadgeClass(usage)}>
              {usageBadgeLabel(usage)}
            </span>
            <span
              className={
                pdfAnchorCount > 0
                  ? "rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                  : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
              }
            >
              {footnoteAnchorBadgeLabel(pdfAnchorCount)}
            </span>
            {primaryAnchorPage != null && (
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                p.{primaryAnchorPage + 1}
              </span>
            )}
          </div>
          <div className="mt-3 text-xs leading-5 text-slate-500">
            {previewText ||
              "제목, 설명, 이미지, 유튜브를 간단히 채우고 PDF 위치와 본문 연결을 함께 관리할 수 있습니다."}
          </div>
        </button>
        <button
          type="button"
          onClick={onOpenEditor}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-pen text-[10px]"></i>
          편집
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          <i className="fas fa-location-dot text-[10px]"></i>
          {primaryAnchorPage != null ? "위치 보기" : "항목 선택"}
        </button>
        <button
          type="button"
          onClick={onInsertIntoBody}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          <i className="fas fa-link text-[10px]"></i>
          본문에 넣기
        </button>
      </div>
    </div>
  );
}

export function LessonPreviewLauncher({
  lesson,
  unitId,
  fallbackTitle,
  onOpenTeacherPreview,
}: LessonPreviewLauncherProps) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            학생 미리보기
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            현재 학생 화면 확인
          </h3>
        </div>
        <button
          type="button"
          onClick={onOpenTeacherPreview}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-chalkboard-teacher text-sm"></i>
          교사용 수업 화면 열기
        </button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <LessonContent
          unitId={unitId}
          fallbackTitle={fallbackTitle}
          lessonOverride={lesson}
          disablePersistence
          allowHiddenAccess
        />
      </div>
    </section>
  );
}
