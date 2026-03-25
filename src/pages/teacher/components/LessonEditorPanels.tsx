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
  LessonFootnotePlacement,
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

export type LessonEditorTab = "meta" | "pdf" | "student-preview";

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
  onLessonTitleChange: (value: string) => void;
  onToggleVisible: (value: boolean) => void;
  onSave: () => void;
  onOpenTeacherPreview: () => void;
};

type LessonMetaFormProps = {
  lessonVideo: string;
  onLessonVideoChange: (value: string) => void;
  selectedNodeTitle?: string;
};

type LessonBodyEditorProps = {
  lessonContent: string;
  onLessonContentChange: (value: string) => void;
  bodyInsertMessage?: string;
  footnotes?: LessonFootnote[];
  footnoteUsageMap?: Map<string, LessonFootnoteUsage>;
  footnoteAnchorCountMap?: Map<string, number>;
  selectedFootnoteId?: string | null;
  onBodySelectionChange?: (selection: { start: number; end: number }) => void;
  onAddFootnote?: () => void;
  onAddFootnoteAndInsert?: () => void;
  onUpdateFootnote?: (
    footnoteId: string,
    patch: Partial<LessonFootnote>,
  ) => void;
  onMoveFootnote?: (footnoteId: string, direction: -1 | 1) => void;
  onDeleteFootnote?: (footnoteId: string) => void;
  onCopyFootnoteToken?: (anchorKey: string) => void;
  onInsertFootnoteToken?: (anchorKey: string) => void;
  onSelectFootnoteImage?: (footnoteId: string, file: File | null) => void;
  onRemoveFootnoteImage?: (footnoteId: string) => void;
  onOpenSourceArchivePicker?: (footnoteId: string) => void;
  onClearSourceArchiveImage?: (footnoteId: string) => void;
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
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
};

type LessonPreviewLauncherProps = {
  lesson: LessonData;
  unitId: string;
  fallbackTitle?: string;
  onOpenTeacherPreview: () => void;
};

const FOOTNOTE_PLACEMENTS: LessonFootnotePlacement[] = [
  "inline-bottom",
  "reference-panel",
];

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
  if (!usage || usage.count === 0) return "아직 연결 안 됨";
  if (usage.count === 1) return "본문 연결됨";
  return `본문 ${usage.count}곳 연결`;
}

function footnoteAnchorBadgeLabel(count = 0) {
  if (count <= 0) return "PDF 앵커 없음";
  if (count === 1) return "PDF 앵커 1개";
  return `PDF 앵커 ${count}개`;
}

function blankBadgeLabel(blank: LessonWorksheetBlank) {
  return (
    blank.answer?.trim() ||
    blank.prompt?.trim() ||
    `p.${blank.page + 1} 빈칸`
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
            className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            저장
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

export function LessonMetaForm({
  lessonVideo,
  onLessonVideoChange,
  selectedNodeTitle,
}: LessonMetaFormProps) {
  return (
    <section className="space-y-6">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          기본 정보
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          {selectedNodeTitle || "선택한 자료"} 기본 설정
        </h3>
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          영상 URL
        </span>
        <input
          value={lessonVideo}
          onChange={(event) => onLessonVideoChange(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
        />
      </label>
    </section>
  );
}

function FootnoteCard({
  footnote,
  index,
  total,
  usage,
  pdfAnchorCount = 0,
  selected = false,
  onUpdateFootnote,
  onMoveFootnote,
  onDeleteFootnote,
  onCopyFootnoteToken,
  onSelectFootnoteImage,
  onRemoveFootnoteImage,
  onOpenSourceArchivePicker,
  onClearSourceArchiveImage,
  getFootnotePreviewUrl,
}: {
  footnote: LessonFootnote;
  index: number;
  total: number;
  usage?: LessonFootnoteUsage;
  pdfAnchorCount?: number;
  selected?: boolean;
  onUpdateFootnote?: (
    footnoteId: string,
    patch: Partial<LessonFootnote>,
  ) => void;
  onMoveFootnote?: (footnoteId: string, direction: -1 | 1) => void;
  onDeleteFootnote?: (footnoteId: string) => void;
  onCopyFootnoteToken?: (anchorKey: string) => void;
  onSelectFootnoteImage?: (footnoteId: string, file: File | null) => void;
  onRemoveFootnoteImage?: (footnoteId: string) => void;
  onOpenSourceArchivePicker?: (footnoteId: string) => void;
  onClearSourceArchiveImage?: (footnoteId: string) => void;
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
}) {
  const previewUrl =
    getFootnotePreviewUrl?.(footnote) || footnote.imageUrl || "";

  return (
    <div
      className={`rounded-3xl border bg-white p-5 shadow-sm ${
        selected
          ? "border-blue-300 ring-2 ring-blue-100"
          : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base text-slate-900">
              {footnote.title?.trim() || `참고자료 ${index + 1}`}
            </strong>
            <span className={usageBadgeClass(usage)}>
              {usageBadgeLabel(usage)}
            </span>
            <span
              className={
                pdfAnchorCount > 0
                  ? "rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                  : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500"
              }
            >
              {footnoteAnchorBadgeLabel(pdfAnchorCount)}
            </span>
            {selected && (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                현재 선택
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              연결 코드 [fn:{footnote.anchorKey}]
            </span>
            <button
              type="button"
              onClick={() => onCopyFootnoteToken?.(footnote.anchorKey)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <i className="fas fa-copy text-[11px]"></i>
              코드 복사
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMoveFootnote?.(footnote.id, -1)}
            disabled={index === 0}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40"
          >
            <i className="fas fa-arrow-up text-xs"></i>
          </button>
          <button
            type="button"
            onClick={() => onMoveFootnote?.(footnote.id, 1)}
            disabled={index === total - 1}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40"
          >
            <i className="fas fa-arrow-down text-xs"></i>
          </button>
          <button
            type="button"
            onClick={() => onDeleteFootnote?.(footnote.id)}
            className="rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50"
          >
            <i className="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            연결 코드
          </span>
          <input
            value={footnote.anchorKey}
            onChange={(event) =>
              onUpdateFootnote?.(footnote.id, { anchorKey: event.target.value })
            }
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            버튼 이름
          </span>
          <input
            value={footnote.label ?? ""}
            onChange={(event) =>
              onUpdateFootnote?.(footnote.id, { label: event.target.value })
            }
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            참고자료 제목
          </span>
          <input
            value={footnote.title ?? ""}
            onChange={(event) =>
              onUpdateFootnote?.(footnote.id, { title: event.target.value })
            }
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            표시 위치
          </span>
          <select
            value={footnote.placement}
            onChange={(event) =>
              onUpdateFootnote?.(footnote.id, {
                placement: event.target.value as LessonFootnotePlacement,
              })
            }
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          >
            {FOOTNOTE_PLACEMENTS.map((placement) => (
              <option key={placement} value={placement}>
                {placement === "inline-bottom" ? "본문 아래" : "참고자료 패널"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          각주 설명
        </span>
        <textarea
          value={footnote.bodyHtml ?? ""}
          onChange={(event) =>
            onUpdateFootnote?.(footnote.id, { bodyHtml: event.target.value })
          }
          rows={5}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
        />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          유튜브 링크
        </span>
        <input
          value={footnote.youtubeUrl ?? ""}
          onChange={(event) =>
            onUpdateFootnote?.(footnote.id, { youtubeUrl: event.target.value })
          }
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
        />
      </label>
      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">
            업로드 이미지
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
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
            {(previewUrl || footnote.imageStoragePath) && (
              <button
                type="button"
                onClick={() => onRemoveFootnoteImage?.(footnote.id)}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                <i className="fas fa-trash text-[11px]"></i>
                이미지 제거
              </button>
            )}
          </div>
        </div>
        {previewUrl ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <img
              src={previewUrl}
              alt={footnote.title || footnote.label || "각주 이미지"}
              className="max-h-72 w-full object-contain"
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-500">
            <i className="fas fa-image text-sm"></i>
            아직 연결된 이미지가 없습니다.
          </div>
        )}
      </div>
      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-700">
              사료창고 이미지
            </div>
            <p className="mt-1 text-xs text-slate-500">
              기존 사료창고 자료를 각주 팝업에 연결할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenSourceArchivePicker?.(footnote.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <i className="fas fa-landmark text-[11px]"></i>
              사료창고에서 선택
            </button>
            {footnote.sourceArchiveImagePath && (
              <button
                type="button"
                onClick={() => onClearSourceArchiveImage?.(footnote.id)}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                <i className="fas fa-trash text-[11px]"></i>
                사료창고 이미지 제거
              </button>
            )}
          </div>
        </div>
        {footnote.sourceArchiveImagePath ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
              {footnote.sourceArchiveTitle || getLessonFootnoteDisplayTitle(footnote)}
            </div>
            <StorageImage
              path={footnote.sourceArchiveImagePath}
              alt={footnote.sourceArchiveTitle || footnote.title || footnote.label || "사료창고 이미지"}
              className="max-h-72 w-full object-contain"
              fallback={
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
                  <i className="fas fa-image text-sm"></i>
                  사료창고 이미지를 불러오지 못했습니다.
                </div>
              }
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-500">
            <i className="fas fa-landmark text-sm"></i>
            아직 연결된 사료창고 이미지가 없습니다.
          </div>
        )}
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
  onBodySelectionChange,
  onAddFootnote,
  onAddFootnoteAndInsert,
  onUpdateFootnote,
  onMoveFootnote,
  onDeleteFootnote,
  onCopyFootnoteToken,
  onInsertFootnoteToken,
  onSelectFootnoteImage,
  onRemoveFootnoteImage,
  onOpenSourceArchivePicker,
  onClearSourceArchiveImage,
  getFootnotePreviewUrl,
}: LessonBodyEditorProps) {
  const connectedCount = footnotes.filter(
    (footnote) => (footnoteUsageMap.get(footnote.anchorKey)?.count ?? 0) > 0,
  ).length;
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const selectedCardRef = React.useRef<HTMLDivElement | null>(null);

  const reportSelection = () => {
    const element = textareaRef.current;
    if (!element || !onBodySelectionChange) return;
    onBodySelectionChange({
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? 0,
    });
  };

  React.useEffect(() => {
    if (!selectedFootnoteId || !selectedCardRef.current) return;
    selectedCardRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selectedFootnoteId]);

  return (
    <section className="space-y-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          본문 및 참고자료
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          본문과 PDF 각주 내용을 함께 관리합니다
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          기존 본문 내용은 그대로 유지되고, PDF 위 각주도 같은 참고자료 목록을
          사용합니다.
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">
              본문에 참고자료 연결
            </div>
            <p className="mt-1 text-sm text-slate-600">
              아래 버튼으로 참고자료 연결 코드를 넣을 수 있습니다. 커서를 두면
              그 위치에, 선택하지 않으면 본문 끝에 들어갑니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnoteAndInsert}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <i className="fas fa-magic text-xs"></i>참고자료 만들고 본문에 연결
          </button>
        </div>
        {!!bodyInsertMessage && (
          <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-blue-700">
            {bodyInsertMessage}
          </div>
        )}
      </div>
      <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-base font-bold text-slate-900">
              <i className="fas fa-link text-sm"></i>
              참고자료 목록
            </div>
            <p className="mt-1 text-sm text-slate-500">
              등록된 참고자료 {footnotes.length}개 중 {connectedCount}개가 본문에
              연결되어 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnote}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <i className="fas fa-plus text-xs"></i>
            참고자료 추가
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {footnotes.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-5 text-sm text-slate-500">
              <i className="fas fa-file-alt text-sm"></i>
              아직 참고자료가 없습니다. 먼저 참고자료를 추가해 보세요.
            </div>
          ) : (
            footnotes.map((footnote, index) => (
              <div
                key={footnote.id}
                ref={
                  selectedFootnoteId === footnote.id ? selectedCardRef : undefined
                }
              >
                <FootnoteCard
                  footnote={footnote}
                  index={index}
                  total={footnotes.length}
                  usage={footnoteUsageMap.get(footnote.anchorKey)}
                  pdfAnchorCount={
                    footnoteAnchorCountMap.get(footnote.id) ?? 0
                  }
                  selected={selectedFootnoteId === footnote.id}
                  onUpdateFootnote={onUpdateFootnote}
                  onMoveFootnote={onMoveFootnote}
                  onDeleteFootnote={onDeleteFootnote}
                  onCopyFootnoteToken={onCopyFootnoteToken}
                  onSelectFootnoteImage={onSelectFootnoteImage}
                  onRemoveFootnoteImage={onRemoveFootnoteImage}
                  onOpenSourceArchivePicker={onOpenSourceArchivePicker}
                  onClearSourceArchiveImage={onClearSourceArchiveImage}
                  getFootnotePreviewUrl={getFootnotePreviewUrl}
                />
              </div>
            ))
          )}
        </div>
      </div>
      {!!footnotes.length && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <i className="fas fa-pen-nib text-sm"></i>
            본문에 연결할 참고자료
          </div>
          <p className="mt-1 text-sm text-slate-500">
            참고자료를 누르면 본문에 연결 코드가 들어갑니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {footnotes.map((footnote) => {
              const usage = footnoteUsageMap.get(footnote.anchorKey);
              return (
                <button
                  key={`insert-${footnote.id}`}
                  type="button"
                  onClick={() => onInsertFootnoteToken?.(footnote.anchorKey)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span>
                    {footnote.title?.trim() ||
                      footnote.label?.trim() ||
                      `참고자료 ${footnote.anchorKey}`}
                  </span>
                  <span
                    className={
                      usage && usage.count > 0
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
                        : "rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500"
                    }
                  >
                    {usage && usage.count > 0 ? "본문 연결됨" : "아직 연결 안 됨"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
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
  onCreateBlankFromSelection,
  onCreateFootnoteAnchorFromSelection,
  onDraftBlankAnswerChange,
  onDraftBlankPromptChange,
  onConfirmDraftBlank,
  onCancelDraftBlank,
  onUpdateBlank: _onUpdateBlank,
}: LessonPdfSectionProps) {
  const [isBlankManagerOpen, setIsBlankManagerOpen] = React.useState(false);
  const [showAllBlanks, setShowAllBlanks] = React.useState(false);
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
  const activeBlank = React.useMemo(
    () => sortedBlanks.find((blank) => blank.id === activeBlankId) || null,
    [activeBlankId, sortedBlanks],
  );
  const visibleBlanks = React.useMemo(
    () => (showAllBlanks ? sortedBlanks : sortedBlanks.slice(0, 5)),
    [showAllBlanks, sortedBlanks],
  );

  React.useEffect(() => {
    if (!isBlankManagerOpen) {
      setShowAllBlanks(false);
    }
  }, [isBlankManagerOpen]);

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
            PDF를 준비한 뒤 오른쪽 플로팅 아이콘으로 OCR 선택, 텍스트 박스,
            각주 앵커를 바로 만들 수 있습니다.
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
          오른쪽 플로팅 아이콘으로 제작 도구, 각주 추가, 키워드 목록을 확인할
          수 있습니다.
        </span>
      </div>
      {!!pdfStatusHelpText && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {pdfStatusHelpText}
        </div>
      )}
      {draftBlank && (
        <div className="rounded-3xl border border-blue-200 bg-blue-50/80 p-4">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <i className="fas fa-pencil-alt text-sm"></i>새 키워드 확인
          </div>
          <p className="mt-1 text-sm text-slate-600">
            방금 만든 영역의 정답과 학생 안내 문구를 간단히 확인해 주세요.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                정답
              </span>
              <input
                value={draftBlankAnswer}
                onChange={(event) =>
                  onDraftBlankAnswerChange(event.target.value)
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
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
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirmDraftBlank}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              빈칸 추가
            </button>
            <button
              type="button"
              onClick={onCancelDraftBlank}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600"
            >
              취소
            </button>
          </div>
        </div>
      )}
      {!!worksheetPageImages.length ? (
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
          <div className="pointer-events-none fixed bottom-6 right-4 z-40 flex flex-col items-end gap-3 md:right-8">
            {isBlankManagerOpen && (
              <div className="pointer-events-auto w-[min(320px,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white/97 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      키워드 목록
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      만든 키워드를 빠르게 확인하고 선택하거나 지울 수 있습니다.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {sortedBlanks.length}개
                  </span>
                </div>
                {sortedBlanks.length === 0 ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    아직 만든 키워드가 없습니다.
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
                            aria-label="키워드 삭제"
                            title="키워드 삭제"
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
                            showAllBlanks ? "fa-chevron-up" : "fa-chevron-down"
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
                    선택한 키워드:{" "}
                    <span className="font-semibold text-slate-800">
                      {blankBadgeLabel(activeBlank)}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="pointer-events-auto inline-flex flex-col gap-2 rounded-[28px] border border-slate-200 bg-white/96 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
              <button
                type="button"
                onClick={() => onWorksheetToolChange("ocr")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                  worksheetTool === "ocr"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-label="OCR 기반 선택"
                title="OCR 기반 선택"
              >
                <i className="fas fa-wand-magic-sparkles"></i>
              </button>
              <button
                type="button"
                onClick={() => onWorksheetToolChange("box")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                  worksheetTool === "box"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-label="박스 생성"
                title="박스 생성"
              >
                <i className="fas fa-vector-square"></i>
              </button>
              <button
                type="button"
                onClick={() => onWorksheetToolChange("footnote")}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                  worksheetTool === "footnote"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-label="각주 추가"
                title="각주 추가"
              >
                <i className="fas fa-comment-dots"></i>
              </button>
              <button
                type="button"
                onClick={() => setIsBlankManagerOpen((prev) => !prev)}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                  isBlankManagerOpen
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-label="키워드 목록"
                title="키워드 목록"
              >
                <i className="fas fa-tags"></i>
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
    </section>
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
          annotationUiMode="always"
        />
      </div>
    </section>
  );
}
