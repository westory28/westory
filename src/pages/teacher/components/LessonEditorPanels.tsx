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
  if (!usage || usage.count === 0) return "미연결";
  if (usage.count === 1) return "본문 연결됨";
  return `본문 ${usage.count}곳`;
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
              {footnote.title?.trim() || `각주 ${index + 1}`}
            </strong>
            <span className={usageBadgeClass(usage)}>
              {usageBadgeLabel(usage)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              [fn:{footnote.anchorKey}]
            </code>
            <button
              type="button"
              onClick={() => onCopyFootnoteToken?.(footnote.anchorKey)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <i className="fas fa-copy text-[11px]"></i>
              토큰 복사
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
            anchorKey
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
            라벨
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
            제목
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
          설명 HTML
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
            참고 이미지
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
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          본문
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          본문과 참고자료 연결
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          본문에 <code>[fn:anchorKey]</code> 토큰을 넣으면 학생 화면에서
          참고자료 버튼으로 바뀝니다.
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
              각주 토큰 넣기
            </div>
            <p className="mt-1 text-sm text-slate-600">
              커서 위치에 선택한 각주 토큰을 바로 넣습니다. 커서를 두지 않으면
              본문 끝에 추가됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnoteAndInsert}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <i className="fas fa-magic text-xs"></i>새 각주 만들고 넣기
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
              각주 / 참고자료
            </div>
            <p className="mt-1 text-sm text-slate-500">
              등록된 각주 {footnotes.length}개 중 {connectedCount}개가 본문과
              연결되어 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddFootnote}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <i className="fas fa-plus text-xs"></i>
            각주 추가
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {footnotes.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-5 text-sm text-slate-500">
              <i className="fas fa-file-alt text-sm"></i>
              아직 각주가 없습니다. 먼저 추가한 뒤 본문에 토큰을 넣어 연결해
              보세요.
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
            본문에 넣을 각주 선택
          </div>
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
                  <span>[fn:{footnote.anchorKey}]</span>
                  <span
                    className={
                      usage && usage.count > 0
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
                        : "rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500"
                    }
                  >
                    {usage && usage.count > 0 ? "사용 중" : "미사용"}
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
  onUpdateBlank,
}: LessonPdfSectionProps) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            PDF 학습지
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            빈칸 제작 편집
          </h3>
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
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        <button
          type="button"
          onClick={() => onWorksheetToolChange("box")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${worksheetTool === "box" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          박스 생성
        </button>
        <button
          type="button"
          onClick={() => onWorksheetToolChange("ocr")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${worksheetTool === "ocr" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          OCR 기반
        </button>
        <div className="text-sm text-slate-500">
          현재 파일: {selectedPdfFile?.name || lessonPdfName || "없음"}
        </div>
      </div>
      {draftBlank && (
        <div className="rounded-3xl border border-blue-200 bg-blue-50/80 p-5">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <i className="fas fa-pencil-alt text-sm"></i>새 빈칸 확인
          </div>
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
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-3">
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
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-base font-bold text-slate-900">빈칸 목록</div>
            {sortedBlanks.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                아직 빈칸이 없습니다.
              </div>
            ) : (
              sortedBlanks.map((blank) => (
                <div
                  key={blank.id}
                  className={`rounded-2xl border p-3 ${activeBlankId === blank.id ? "border-blue-300 bg-blue-50/70" : "border-slate-200 bg-slate-50/70"}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectBlank(blank.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-slate-800">
                        p.{blank.page + 1}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteBlank(blank.id);
                        }}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                      >
                        <i className="fas fa-trash text-[11px]"></i>
                      </button>
                    </div>
                  </button>
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        정답
                      </span>
                      <input
                        value={blank.answer}
                        onChange={(event) =>
                          onUpdateBlank(blank.id, {
                            answer: event.target.value,
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        학생 안내 문구
                      </span>
                      <input
                        value={blank.prompt || ""}
                        onChange={(event) =>
                          onUpdateBlank(blank.id, {
                            prompt: event.target.value,
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
          PDF를 준비하면 여기에서 OCR 결과와 빈칸을 편집할 수 있습니다.
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
