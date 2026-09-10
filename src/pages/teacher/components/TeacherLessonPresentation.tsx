import React, { useEffect, useMemo, useState } from "react";
import LessonFootnoteDialog from "../../../components/common/LessonFootnoteDialog";
import LessonWorksheetStage from "../../../components/common/LessonWorksheetStage";
import {
  getLessonContentSections,
  type LessonFootnote,
  type LessonData,
} from "../../../lib/lessonData";

export interface TeacherLessonPresentationProps {
  lesson: LessonData;
  fallbackTitle?: string | null;
  fullscreenPreview?: boolean;
  onClosePreview?: () => void;
}

// Presentations do not read or persist teacher ink or page positions.
// Student answers and rewards use their own command boundaries.
const TeacherLessonPresentation: React.FC<TeacherLessonPresentationProps> = ({
  lesson,
  fallbackTitle,
  fullscreenPreview = false,
  onClosePreview,
}) => {
  const { bodyHtml, footnotes, worksheet } = useMemo(
    () => getLessonContentSections(lesson),
    [lesson],
  );
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [activeFootnote, setActiveFootnote] = useState<LessonFootnote | null>(
    null,
  );
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  useEffect(() => {
    setCurrentPage(null);
    setActiveFootnote(null);
    setActiveAnchorId(null);
  }, [lesson.unitId]);
  const footnoteById = useMemo(
    () => new Map(footnotes.map((item) => [item.id, item])),
    [footnotes],
  );
  const footnoteTitles = useMemo(
    () =>
      Object.fromEntries(
        footnotes.map((item) => [
          item.id,
          item.title?.trim() || item.label?.trim() || "각주",
        ]),
      ),
    [footnotes],
  );
  const openFootnote = (anchorId: string) => {
    const anchor = worksheet.footnoteAnchors.find(
      (item) => item.id === anchorId,
    );
    const footnote = anchor && footnoteById.get(anchor.footnoteId);
    if (!footnote) return;
    setActiveAnchorId(anchorId);
    setActiveFootnote(footnote);
  };
  const videoMatch = String(lesson.videoUrl || "").match(
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/,
  );
  const embedUrl =
    videoMatch?.[2]?.length === 11
      ? "https://www.youtube.com/embed/" + videoMatch[2]
      : null;
  const content = (
    <div
      className={
        fullscreenPreview
          ? "mx-auto w-full max-w-[min(100vw-1.5rem,1600px)] animate-fadeIn"
          : "mx-auto max-w-6xl animate-fadeIn"
      }
    >
      <div
        className={
          "rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur " +
          (fullscreenPreview ? "p-4 md:p-4" : "mb-5 p-4 md:p-5")
        }
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              교사용 수업 화면
            </div>
            <h2 className="mt-2 text-xl font-extrabold leading-tight text-slate-900 md:text-2xl">
              {lesson.title || fallbackTitle || "제목 없음"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                현재 페이지{" "}
                {currentPage ?? worksheet.pageImages[0]?.page ?? "-"}
              </div>
            </div>
          </div>
          {fullscreenPreview && onClosePreview && (
            <button
              type="button"
              onClick={onClosePreview}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <i className="fas fa-times text-xs" aria-hidden="true"></i>닫기
            </button>
          )}
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
              title="수업 영상"
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
              selectedFootnoteAnchorId={activeAnchorId}
              footnoteTitles={footnoteTitles}
              onActivateFootnoteAnchor={openFootnote}
              mode="teacher-present"
              annotationEnabled={false}
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
          open={Boolean(activeFootnote)}
          footnote={activeFootnote}
          badgeLabel="PDF"
          onClose={() => {
            setActiveFootnote(null);
            setActiveAnchorId(null);
          }}
        />
      </div>
    </div>
  );
  return fullscreenPreview ? (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(254,243,199,0.78),_rgba(241,245,249,0.96)_38%,_rgba(226,232,240,1)_100%)] p-2 md:p-4">
      {content}
    </div>
  ) : (
    content
  );
};
export default TeacherLessonPresentation;
