import React from "react";
import LessonWorksheetStage from "../../../components/common/LessonWorksheetStage";
import type {
  LessonData,
  LessonFootnote,
  LessonFootnotePlacement,
  LessonFootnoteUsage,
} from "../../../lib/lessonData";
import type {
  LessonWorksheetBlank,
  LessonWorksheetPageImage,
  LessonWorksheetTextRegion,
} from "../../../lib/lessonWorksheet";
import LessonContent from "../../student/lesson/components/LessonContent";

export type LessonEditorTab = "meta" | "body" | "pdf" | "student-preview";

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
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
};

type LessonPdfSectionProps = {
  pdfBusy: boolean;
  selectedPdfFile: File | null;
  lessonPdfName: string;
  lessonPdfUrl: string;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  worksheetTool: "ocr" | "box";
  activeBlankId: string | null;
  draftBlank: LessonWorksheetBlank | null;
  draftBlankAnswer: string;
  draftBlankPrompt: string;
  sortedBlanks: LessonWorksheetBlank[];
  pdfInputRef: React.RefObject<HTMLInputElement>;
  onPdfFileChange: (file: File | null) => void;
  onPreparePdf: () => void;
  onRemovePdf: () => void;
  onWorksheetToolChange: (value: "ocr" | "box") => void;
  onSelectBlank: (blankId: string) => void;
  onDeleteBlank: (blankId: string) => void;
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
  if (!usage || usage.count === 0) return "Not linked";
  if (usage.count === 1) return "Linked";
  return `Linked ${usage.count} times`;
}

function blankBadgeLabel(blank: LessonWorksheetBlank) {
  return (
    blank.answer?.trim() ||
    blank.prompt?.trim() ||
    `p.${blank.page + 1} 鍮덉뭏`
  );
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
          <h2 className="text-lg font-bold text-gray-800">?섏뾽 ?먮즺 ?몃━</h2>
          <p className="text-xs text-gray-500">
            ?⑥썝怨??먮즺 援ъ“瑜?愿由ы빀?덈떎.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenRootModal}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
          >
            ??臾띠쓬
          </button>
          <button
            type="button"
            onClick={onSaveTree}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700"
          >
            ?몃━ ???
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
                ?섏뾽 ?먮즺 ?몃━
              </div>
              <button
                type="button"
                onClick={onCloseSidebar}
                className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
              >
                ?リ린
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
  saveStateLabel = "??λ맖",
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
            ?먮즺 ?쒕ぉ
          </span>
          <input
            value={lessonTitle}
            onChange={(event) => onLessonTitleChange(event.target.value)}
            placeholder="수업 자료 제목을 입력하세요."
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
            ?숈깮 怨듦컻
          </label>
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            ???
          </button>
          <button
            type="button"
            onClick={onOpenTeacherPreview}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <i className="fas fa-chalkboard-teacher text-sm"></i>
            ?섏뾽 ?붾㈃
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
          湲곕낯 ?뺣낫
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          {selectedNodeTitle || "?좏깮???먮즺"} 湲곕낯 ?ㅼ젙
        </h3>
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          ?곸긽 URL
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
  onUpdateFootnote,
  onMoveFootnote,
  onDeleteFootnote,
  onCopyFootnoteToken,
  onSelectFootnoteImage,
  onRemoveFootnoteImage,
  getFootnotePreviewUrl,
}: {
  footnote: LessonFootnote;
  index: number;
  total: number;
  usage?: LessonFootnoteUsage;
  onUpdateFootnote?: (
    footnoteId: string,
    patch: Partial<LessonFootnote>,
  ) => void;
  onMoveFootnote?: (footnoteId: string, direction: -1 | 1) => void;
  onDeleteFootnote?: (footnoteId: string) => void;
  onCopyFootnoteToken?: (anchorKey: string) => void;
  onSelectFootnoteImage?: (footnoteId: string, file: File | null) => void;
  onRemoveFootnoteImage?: (footnoteId: string) => void;
  getFootnotePreviewUrl?: (footnote: LessonFootnote) => string;
}) {
  const previewUrl =
    getFootnotePreviewUrl?.(footnote) || footnote.imageUrl || "";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base text-slate-900">
              {footnote.title?.trim() || `李멸퀬?먮즺 ${index + 1}`}
            </strong>
            <span className={usageBadgeClass(usage)}>
              {usageBadgeLabel(usage)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              ?곌껐 肄붾뱶 [fn:{footnote.anchorKey}]
            </span>
            <button
              type="button"
              onClick={() => onCopyFootnoteToken?.(footnote.anchorKey)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <i className="fas fa-copy text-[11px]"></i>
              肄붾뱶 蹂듭궗
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
            ?곌껐 肄붾뱶
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
            踰꾪듉 ?대쫫
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
            李멸퀬?먮즺 ?쒕ぉ
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
            ?쒖떆 ?꾩튂
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
                {placement === "inline-bottom" ? "蹂몃Ц ?꾨옒" : "李멸퀬?먮즺 ?⑤꼸"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          李멸퀬 ?ㅻ챸
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
      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">
            李멸퀬 ?대?吏
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <i className="fas fa-image text-[11px]"></i>
              ?대?吏 ?좏깮
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
                ?대?吏 ?쒓굅
              </button>
            )}
          </div>
        </div>
        {previewUrl ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <img
              src={previewUrl}
              alt={footnote.title || footnote.label || "媛곸＜ ?대?吏"}
              className="max-h-72 w-full object-contain"
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-500">
            <i className="fas fa-image text-sm"></i>
            ?꾩쭅 ?곌껐???대?吏媛 ?놁뒿?덈떎.
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
  getFootnotePreviewUrl,
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
          蹂몃Ц ?묒꽦
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          ?숈깮?먭쾶 蹂댁뿬以??섏뾽 ?댁슜???곸뼱 二쇱꽭??
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          蹂몃Ц??癒쇱? ?묒꽦???? ?꾩슂??怨녹뿉 李멸퀬?먮즺瑜??곌껐?섎㈃ ?숈깮 ?붾㈃?먯꽌
          李멸퀬 踰꾪듉?쇰줈 ?덈궡?⑸땲??
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
              蹂몃Ц??李멸퀬?먮즺 ?곌껐
            </div>
            <p className="mt-1 text-sm text-slate-600">
              ?꾨옒 踰꾪듉?쇰줈 李멸퀬?먮즺 ?곌껐 肄붾뱶瑜??ｌ쓣 ???덉뒿?덈떎. 而ㅼ꽌瑜??먮㈃
              洹??꾩튂?? ?좏깮?섏? ?딆쑝硫?蹂몃Ц ?앹뿉 ?ㅼ뼱媛묐땲??
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnoteAndInsert}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <i className="fas fa-magic text-xs"></i>李멸퀬?먮즺 留뚮뱾怨?蹂몃Ц???곌껐
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
              李멸퀬?먮즺 紐⑸줉
            </div>
            <p className="mt-1 text-sm text-slate-500">
              ?깅줉??李멸퀬?먮즺 {footnotes.length}媛?以?{connectedCount}媛쒓? 蹂몃Ц??
              ?곌껐?섏뼱 ?덉뒿?덈떎.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnote}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <i className="fas fa-plus text-xs"></i>
            李멸퀬?먮즺 異붽?
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {footnotes.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-5 text-sm text-slate-500">
              <i className="fas fa-file-alt text-sm"></i>
              ?꾩쭅 李멸퀬?먮즺媛 ?놁뒿?덈떎. 癒쇱? 李멸퀬?먮즺瑜?異붽???蹂댁꽭??
            </div>
          ) : (
            footnotes.map((footnote, index) => (
              <FootnoteCard
                key={footnote.id}
                footnote={footnote}
                index={index}
                total={footnotes.length}
                usage={footnoteUsageMap.get(footnote.anchorKey)}
                onUpdateFootnote={onUpdateFootnote}
                onMoveFootnote={onMoveFootnote}
                onDeleteFootnote={onDeleteFootnote}
                onCopyFootnoteToken={onCopyFootnoteToken}
                onSelectFootnoteImage={onSelectFootnoteImage}
                onRemoveFootnoteImage={onRemoveFootnoteImage}
                getFootnotePreviewUrl={getFootnotePreviewUrl}
              />
            ))
          )}
        </div>
      </div>
      {!!footnotes.length && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <i className="fas fa-pen-nib text-sm"></i>
            蹂몃Ц???곌껐??李멸퀬?먮즺
          </div>
          <p className="mt-1 text-sm text-slate-500">
            李멸퀬?먮즺瑜??꾨Ⅴ硫?蹂몃Ц???곌껐 肄붾뱶媛 ?ㅼ뼱媛묐땲??
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
                      `李멸퀬?먮즺 ${footnote.anchorKey}`}
                  </span>
                  <span
                    className={
                      usage && usage.count > 0
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
                        : "rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500"
                    }
                  >
                    {usage && usage.count > 0 ? "Linked" : "Not linked"}
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
  worksheetPageImages,
  worksheetTextRegions,
  worksheetBlanks,
  worksheetTool,
  activeBlankId,
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
  onCreateBlankFromSelection,
  onDraftBlankAnswerChange,
  onDraftBlankPromptChange,
  onConfirmDraftBlank,
  onCancelDraftBlank,
  onUpdateBlank: _onUpdateBlank,
}: LessonPdfSectionProps) {
  const [isBlankManagerOpen, setIsBlankManagerOpen] = React.useState(false);
  const [showAllBlanks, setShowAllBlanks] = React.useState(false);
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
            PDF ?숈뒿吏
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            PDF ?꾩뿉??諛붾줈 鍮덉뭏 留뚮뱾湲?
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            PDF瑜?以鍮꾪븳 ?? ?붾㈃ ???꾩씠肄섏쑝濡?OCR ?좏깮怨?諛뺤뒪 ?앹꽦??諛붾줈
            吏꾪뻾?섏꽭??
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <i className="fas fa-file-pdf text-sm"></i>
            PDF ?좏깮
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
              PDF ??젣
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">
          ?꾩옱 ?뚯씪: {selectedPdfFile?.name || lessonPdfName || "?놁쓬"}
        </span>
        <span>?ㅻⅨ履??뚮줈???꾩씠肄섏쑝濡??쒖옉 ?꾧뎄? ?ㅼ썙??紐⑸줉???뺤씤?????덉뒿?덈떎.</span>
      </div>
      {draftBlank && (
        <div className="rounded-3xl border border-blue-200 bg-blue-50/80 p-4">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <i className="fas fa-pencil-alt text-sm"></i>???ㅼ썙???뺤씤
          </div>
          <p className="mt-1 text-sm text-slate-600">
            諛⑷툑 留뚮뱺 ?곸뿭???뺣떟怨??숈깮 ?덈궡 臾멸뎄瑜?媛꾨떒???뺤씤??二쇱꽭??
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                ?뺣떟
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
                ?숈깮 ?덈궡 臾멸뎄
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
              鍮덉뭏 異붽?
            </button>
            <button
              type="button"
              onClick={onCancelDraftBlank}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600"
            >
              痍⑥냼
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
                      ??쇱뜖??筌뤴뫖以?                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      筌띾슢諭???쇱뜖??? ??쥓?ㅵ칰??類ㅼ뵥??랁??醫뤾문??띻탢??筌왖??????됰뮸??덈뼄.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {sortedBlanks.length}揶?
                  </span>
                </div>
                {sortedBlanks.length === 0 ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    ?袁⑹춦 筌띾슢諭???쇱뜖??? ??곷뮸??덈뼄.
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
                            aria-label="Delete blank"
                            title="Delete blank"
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
                          ? "Collapse"
                          : `${sortedBlanks.length - visibleBlanks.length} more`}
                      </button>
                    )}
                  </>
                )}
                {activeBlank && (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    ?醫뤾문????쇱뜖??{" "}
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
                aria-label="OCR 湲곕컲 ?좏깮"
                title="OCR 湲곕컲 ?좏깮"
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
                aria-label="諛뺤뒪 ?앹꽦"
                title="諛뺤뒪 ?앹꽦"
              >
                <i className="fas fa-vector-square"></i>
              </button>
              <button
                type="button"
                onClick={() => setIsBlankManagerOpen((prev) => !prev)}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                  isBlankManagerOpen
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-label="?ㅼ썙??紐⑸줉"
                title="?ㅼ썙??紐⑸줉"
              >
                <i className="fas fa-tags"></i>
              </button>
            </div>
            {isBlankManagerOpen && (
              <div className="pointer-events-auto w-[min(320px,calc(100vw-3rem))] rounded-3xl border border-slate-200 bg-white/97 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      ?ㅼ썙??紐⑸줉
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      留뚮뱺 ?ㅼ썙?쒕? 鍮좊Ⅴ寃??뺤씤?섍퀬 ?좏깮?섍굅??吏?????덉뒿?덈떎.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {sortedBlanks.length}媛?
                  </span>
                </div>
                {sortedBlanks.length === 0 ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    ?꾩쭅 留뚮뱺 ?ㅼ썙?쒓? ?놁뒿?덈떎.
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sortedBlanks.map((blank) => (
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
                          aria-label="?ㅼ썙????젣"
                          title="?ㅼ썙????젣"
                        >
                          <i className="fas fa-times text-[10px]"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {activeBlank && (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    ?좏깮???ㅼ썙??{" "}
                    <span className="font-semibold text-slate-800">
                      {blankBadgeLabel(activeBlank)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="p-3 md:p-4">
            <LessonWorksheetStage
              mode="teacher-edit"
              pageImages={worksheetPageImages}
              blanks={worksheetBlanks}
              textRegions={worksheetTextRegions}
              teacherTool={worksheetTool}
              selectedBlankId={activeBlankId}
              pendingBlank={draftBlank}
              onSelectBlank={onSelectBlank}
              onDeleteBlank={onDeleteBlank}
              onCreateBlankFromSelection={onCreateBlankFromSelection}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
          PDF瑜?以鍮꾪븯硫??ш린?먯꽌 OCR 寃곌낵? 鍮덉뭏???몄쭛?????덉뒿?덈떎.
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
            ?숈깮 誘몃━蹂닿린
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            ?꾩옱 ?숈깮 ?붾㈃ ?뺤씤
          </h3>
        </div>
        <button
          type="button"
          onClick={onOpenTeacherPreview}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-chalkboard-teacher text-sm"></i>
          援먯궗???섏뾽 ?붾㈃ ?닿린
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
