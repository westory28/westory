import React, { useEffect, useMemo, useState } from "react";
import LessonFootnoteDialog from "../../../components/common/LessonFootnoteDialog";
import LessonWorksheetStage from "../../../components/common/LessonWorksheetStage";
import {
  getLessonContentSections,
  type LessonFootnote,
  type LessonData,
} from "../../../lib/lessonData";
import {
  normalizeTeacherPresentationClassContext,
  type TeacherPresentationRuntimeStatus,
} from "../../../lib/teacherPresentation";

export interface TeacherLessonPresentationProps {
  lesson: LessonData;
  fallbackTitle?: string | null;
  fullscreenPreview?: boolean;
  onClosePreview?: () => void;
  classId?: string | null;
  classLabel?: string | null;
  onRuntimeStatusChange?: (status: TeacherPresentationRuntimeStatus) => void;
}

const TeacherLessonPresentation: React.FC<TeacherLessonPresentationProps> = ({
  lesson,
  fallbackTitle,
  fullscreenPreview = false,
  onClosePreview,
  classId,
  classLabel,
  onRuntimeStatusChange,
}) => {
  const classContext = useMemo(
    () => normalizeTeacherPresentationClassContext({ classId, classLabel }),
    [classId, classLabel],
  );
  const { bodyHtml, footnotes, worksheet } = useMemo(
    () => getLessonContentSections(lesson),
    [lesson],
  );
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [activeWorksheetFootnote, setActiveWorksheetFootnote] =
    useState<LessonFootnote | null>(null);
  const [activeWorksheetFootnoteAnchorId, setActiveWorksheetFootnoteAnchorId] =
    useState<string | null>(null);
  const [worksheetFootnoteOpen, setWorksheetFootnoteOpen] = useState(false);
  const footnoteByIdMap = useMemo(
    () => new Map(footnotes.map((footnote) => [footnote.id, footnote])),
    [footnotes],
  );
  const footnoteTitles = useMemo(
    () =>
      footnotes.reduce<Record<string, string>>((titles, footnote) => {
        titles[footnote.id] =
          footnote.title?.trim() || footnote.label?.trim() || "각주";
        return titles;
      }, {}),
    [footnotes],
  );

  useEffect(() => {
    setCurrentPage(worksheet.pageImages[0]?.page ?? null);
    setActiveWorksheetFootnote(null);
    setActiveWorksheetFootnoteAnchorId(null);
    setWorksheetFootnoteOpen(false);
  }, [classContext.classId, lesson.unitId, worksheet.pageImages]);

  useEffect(() => {
    onRuntimeStatusChange?.({
      classId: classContext.classId,
      classLabel: classContext.classLabel,
      currentPage,
      saveState: "idle",
      lastSavedAt: null,
      hasUnsavedChanges: false,
      statusText: "",
    });
  }, [
    classContext.classId,
    classContext.classLabel,
    currentPage,
    onRuntimeStatusChange,
  ]);

  const handleOpenWorksheetFootnoteAnchor = (anchorId: string) => {
    const anchor = worksheet.footnoteAnchors.find(
      (item) => item.id === anchorId,
    );
    if (!anchor) return;
    const footnote = footnoteByIdMap.get(anchor.footnoteId);
    if (!footnote) return;
    setActiveWorksheetFootnote(footnote);
    setActiveWorksheetFootnoteAnchorId(anchorId);
    setWorksheetFootnoteOpen(true);
  };

  const getVideoEmbedUrl = (url?: string) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11
      ? `https://www.youtube.com/embed/${match[2]}`
      : null;
  };

  const embedUrl = getVideoEmbedUrl(lesson.videoUrl);
  const content = (
    <div
      className={
        fullscreenPreview
          ? "mx-auto w-full max-w-[min(100vw-1.5rem,1600px)] animate-fadeIn"
          : "mx-auto max-w-6xl animate-fadeIn"
      }
    >
      <div
        className={`rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur ${
          fullscreenPreview ? "p-4 md:p-4" : "mb-5 p-4 md:p-5"
        }`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              교사용 수업 화면
            </div>
            <h1 className="mt-2 text-xl font-extrabold leading-tight text-slate-900 md:text-2xl">
              {lesson.title || fallbackTitle || "제목 없음"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                현재 반 {classContext.classLabel}
              </div>
              <div className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                현재 페이지{" "}
                {currentPage ?? worksheet.pageImages[0]?.page ?? "-"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fullscreenPreview && onClosePreview && (
              <button
                type="button"
                onClick={onClosePreview}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <i className="fas fa-times text-xs"></i>
                닫기
              </button>
            )}
          </div>
        </div>

        {embedUrl && (
          <div
            className="relative mb-6 h-0 overflow-hidden rounded-2xl bg-black shadow-md"
            style={{ paddingBottom: "56.25%" }}
          >
            <iframe
              className="absolute left-0 top-0 h-full w-full"
              src={embedUrl}
              frameBorder="0"
              allowFullScreen
              title="Lesson Video"
            />
          </div>
        )}

        {!!worksheet.pageImages.length && (
          <div className="space-y-4">
            <LessonWorksheetStage
              pageImages={worksheet.pageImages}
              blanks={worksheet.blanks}
              examHighlights={worksheet.examHighlights}
              textRegions={worksheet.textRegions}
              footnoteAnchors={worksheet.footnoteAnchors}
              selectedFootnoteAnchorId={activeWorksheetFootnoteAnchorId}
              footnoteTitles={footnoteTitles}
              onActivateFootnoteAnchor={handleOpenWorksheetFootnoteAnchor}
              mode="teacher-present"
              teacherCurrentPage={currentPage}
              onTeacherCurrentPageChange={setCurrentPage}
            />
          </div>
        )}

        {!!bodyHtml && (
          <div
            className="note-content mt-6 rounded-3xl border border-slate-200 bg-white p-6 leading-loose text-slate-700 shadow-sm md:p-10"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
        <LessonFootnoteDialog
          open={worksheetFootnoteOpen}
          footnote={activeWorksheetFootnote}
          onClose={() => {
            setWorksheetFootnoteOpen(false);
            setActiveWorksheetFootnoteAnchorId(null);
          }}
        />
      </div>
    </div>
  );

  if (!fullscreenPreview) {
    return content;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(254,243,199,0.78),_rgba(241,245,249,0.96)_38%,_rgba(226,232,240,1)_100%)] p-2 md:p-4">
      {content}
    </div>
  );
};

export default TeacherLessonPresentation;
