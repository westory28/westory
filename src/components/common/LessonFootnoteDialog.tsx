import React from "react";

import {
  getLessonFootnoteDisplayTitle,
  getLessonFootnotePrimaryContentType,
  getLessonFootnoteYouTubeEmbedUrl,
  type LessonFootnote,
} from "../../lib/lessonData";
import StorageImage from "./StorageImage";

interface LessonFootnoteDialogProps {
  open: boolean;
  footnote: LessonFootnote | null;
  badgeLabel?: string | null;
  onClose: () => void;
}

const LessonFootnoteDialog: React.FC<LessonFootnoteDialogProps> = ({
  open,
  footnote,
  badgeLabel,
  onClose,
}) => {
  if (!open || !footnote) return null;

  const title = getLessonFootnoteDisplayTitle(footnote) || "각주";
  const primaryType = getLessonFootnotePrimaryContentType(footnote);
  const youtubeEmbedUrl = getLessonFootnoteYouTubeEmbedUrl(footnote.youtubeUrl);
  const hasDescription = Boolean(String(footnote.bodyHtml || "").trim());

  return (
    <div className="fixed inset-0 z-[85] bg-black/45 backdrop-blur-sm">
      <div className="flex h-full items-end justify-center p-3 md:items-center md:p-6">
        <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                각주
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {badgeLabel ? `${badgeLabel} ` : ""}
                {title}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              닫기
            </button>
          </div>
          <div className="max-h-[calc(88vh-88px)] space-y-5 overflow-y-auto px-5 py-5">
            {primaryType === "youtube" && youtubeEmbedUrl ? (
              <div
                className="relative overflow-hidden rounded-3xl border border-slate-200 bg-black"
                style={{ paddingBottom: "56.25%" }}
              >
                <iframe
                  className="absolute left-0 top-0 h-full w-full"
                  src={youtubeEmbedUrl}
                  title={title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : null}

            {primaryType === "image" && footnote.imageUrl ? (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <img
                  src={footnote.imageUrl}
                  alt={title}
                  className="max-h-[60vh] w-full object-contain"
                />
              </div>
            ) : null}

            {primaryType === "sourceArchiveImage" &&
            footnote.sourceArchiveImagePath ? (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <StorageImage
                  path={footnote.sourceArchiveImagePath}
                  alt={title}
                  className="max-h-[60vh] w-full object-contain"
                  fallback={
                    <div className="flex min-h-[18rem] items-center justify-center bg-slate-100 text-sm text-slate-500">
                      사료창고 이미지를 불러오는 중입니다.
                    </div>
                  }
                />
              </div>
            ) : null}

            {hasDescription ? (
              <div
                className="prose prose-slate max-w-none text-slate-700"
                dangerouslySetInnerHTML={{
                  __html: String(footnote.bodyHtml || ""),
                }}
              />
            ) : null}

            {!hasDescription &&
            !(primaryType === "youtube" && youtubeEmbedUrl) &&
            !(primaryType === "image" && footnote.imageUrl) &&
            !(primaryType === "sourceArchiveImage" &&
              footnote.sourceArchiveImagePath) ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                아직 등록된 각주 내용이 없습니다.
              </div>
            ) : null}

            {primaryType === "youtube" &&
            footnote.youtubeUrl &&
            !youtubeEmbedUrl ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                유효한 유튜브 링크가 아닙니다.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LessonFootnoteDialog;
