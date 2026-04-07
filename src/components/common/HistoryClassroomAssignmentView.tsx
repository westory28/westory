import React from "react";
import {
  getHistoryClassroomBlankRenderRect,
  type HistoryClassroomAssignment,
} from "../../lib/historyClassroom";

interface HistoryClassroomAssignmentViewProps {
  assignment: HistoryClassroomAssignment;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  answers: Record<string, string>;
  selectedAnswer: string;
  onSelectAnswer: (answer: string) => void;
  showAnswers: boolean;
  onToggleShowAnswers: () => void;
  onPlaceAnswer?: (blankId: string) => void;
  onSubmit?: () => void;
  submitting?: boolean;
  completed?: boolean;
  readOnly?: boolean;
  resultText?: string;
  pointNotice?: string;
  countdownLabel?: string | null;
  timeProgressPercent?: number;
  dueStatusLabel?: string | null;
  dueStatusTone?: "slate" | "amber" | "rose";
  headerAction?: React.ReactNode;
  helperItems?: string[];
  layoutVariant?: "default" | "modalPreview";
}

const DEFAULT_HELPER_ITEMS = [
  "오른쪽 정답 보기에서 단어를 고릅니다.",
  "지도 위 빈칸을 눌러 선택한 답을 채웁니다.",
  "다른 창 전환, 화면 이동, 멀티태스킹 시 자동 취소됩니다.",
];

const TONE_CLASS_NAME: Record<
  NonNullable<HistoryClassroomAssignmentViewProps["dueStatusTone"]>,
  string
> = {
  slate: "border-gray-200 bg-gray-100 text-gray-600",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
};

const getBlankFontSize = (
  pixelWidth: number,
  pixelHeight: number,
  contentLength: number,
) => {
  const safeLength = Math.max(1, contentLength);
  const widthBased =
    Math.max(1, pixelWidth - 10) / Math.max(1.2, safeLength * 0.82);
  const heightBased = Math.max(1, pixelHeight - 6) * 0.78;
  return Math.max(10, Math.min(22, widthBased, heightBased));
};

const HistoryClassroomAssignmentView: React.FC<
  HistoryClassroomAssignmentViewProps
> = ({
  assignment,
  currentPage,
  onCurrentPageChange,
  answers,
  selectedAnswer,
  onSelectAnswer,
  showAnswers,
  onToggleShowAnswers,
  onPlaceAnswer,
  onSubmit,
  submitting = false,
  completed = false,
  readOnly = false,
  resultText = "",
  pointNotice = "",
  countdownLabel = null,
  timeProgressPercent = 100,
  dueStatusLabel = null,
  dueStatusTone = "slate",
  headerAction = null,
  helperItems = DEFAULT_HELPER_ITEMS,
  layoutVariant = "default",
}) => {
  const isModalPreview = layoutVariant === "modalPreview";
  const pageCount = assignment.pdfPageImages?.length || 1;
  const pageImage =
    assignment.pdfPageImages?.find((page) => page.page === currentPage) || null;
  const currentBlanks = assignment.blanks.filter(
    (blank) => blank.page === currentPage,
  );
  const currentTextRegions = (assignment.pdfRegions || []).filter(
    (region) => region.page === currentPage,
  );
  const isPointAwardedNotice = pointNotice.includes("+");

  return (
    <div
      className={
        isModalPreview
          ? "mx-auto w-full max-w-[96rem] px-5 py-5 lg:px-6"
          : "mx-auto max-w-7xl px-4 py-8"
      }
    >
      <div
        className={`rounded-3xl border border-gray-200 bg-white shadow-sm ${
          isModalPreview ? "mb-4 p-5" : "mb-6 p-6"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-orange-500">역사교실</div>
            <h1 className="mt-1 break-words text-3xl font-black text-gray-900">
              {assignment.title}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {assignment.description || "설명이 없습니다."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                통과 기준 {assignment.passThresholdPercent}% 이상
              </span>
              {dueStatusLabel && (
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                    TONE_CLASS_NAME[dueStatusTone]
                  }`}
                >
                  {dueStatusLabel}
                </span>
              )}
            </div>
          </div>
          {headerAction && <div className="min-w-[11rem]">{headerAction}</div>}
        </div>

        {assignment.timeLimitMinutes > 0 && countdownLabel && (
          <div className="mt-4 max-w-md">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
              <span>제한 시간</span>
              <span>{countdownLabel}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ${
                  timeProgressPercent <= 20
                    ? "bg-red-500"
                    : timeProgressPercent <= 50
                      ? "bg-amber-500"
                      : "bg-blue-500"
                }`}
                style={{ width: `${timeProgressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div
        className={
          isModalPreview
            ? "grid gap-4 lg:grid-cols-[minmax(0,1.34fr)_17.5rem] xl:grid-cols-[minmax(0,1.52fr)_18rem]"
            : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
        }
      >
        <section
          className={`rounded-3xl border border-gray-200 bg-white shadow-sm ${
            isModalPreview ? "flex min-h-[38rem] flex-col p-4 lg:p-5" : "p-5"
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold text-gray-600">
              페이지 {currentPage} / {pageCount}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => onCurrentPageChange(Math.max(1, currentPage - 1))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() =>
                  onCurrentPageChange(Math.min(pageCount, currentPage + 1))
                }
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>

          {pageImage && (
            <div
              className={`overflow-auto rounded-3xl border border-gray-200 bg-gray-100 ${
                isModalPreview ? "flex-1 min-h-[34rem] p-3 lg:min-h-[40rem]" : "p-4"
              }`}
            >
              <div className="relative inline-block">
                <img
                  src={pageImage.imageUrl}
                  alt={`${assignment.title} ${currentPage}`}
                  className="block"
                  style={{ width: `${pageImage.width}px`, maxWidth: "none" }}
                />
                {currentBlanks.map((blank) => {
                  const renderRect = getHistoryClassroomBlankRenderRect(
                    blank,
                    pageImage,
                    currentTextRegions,
                  );
                  const pixelWidth = renderRect.widthRatio * pageImage.width;
                  const pixelHeight = renderRect.heightRatio * pageImage.height;
                  const answerValue = String(answers[blank.id] || "").trim();
                  const placeholder = readOnly
                    ? blank.prompt || "빈칸"
                    : answerValue
                      ? answerValue
                      : "빈칸 선택";
                  const fontSize = getBlankFontSize(
                    pixelWidth,
                    pixelHeight,
                    (answerValue || placeholder).length,
                  );
                  const isFilled = Boolean(answerValue);

                  return (
                    <button
                      key={blank.id}
                      type="button"
                      disabled={readOnly || !onPlaceAnswer}
                      onClick={() => onPlaceAnswer?.(blank.id)}
                      className={`absolute z-10 overflow-hidden rounded-xl border text-left font-bold shadow-[0_6px_18px_rgba(15,23,42,0.12)] disabled:cursor-default ${
                        isFilled
                          ? "border-orange-300 text-orange-800"
                          : "border-slate-300 text-slate-700"
                      }`}
                      style={{
                        left: `${renderRect.leftRatio * 100}%`,
                        top: `${renderRect.topRatio * 100}%`,
                        width: `${renderRect.widthRatio * 100}%`,
                        height: `${renderRect.heightRatio * 100}%`,
                        minWidth: `${Math.max(pixelWidth, 32)}px`,
                        minHeight: `${Math.max(pixelHeight, 18)}px`,
                        backgroundColor: "#ffffff",
                        opacity: 1,
                      }}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-0 ${
                          isFilled ? "bg-orange-50" : "bg-white"
                        }`}
                      />
                      <span
                        className="relative z-[1] flex h-full w-full items-center justify-center px-1.5 text-center leading-none"
                        style={{
                          fontSize: `${fontSize}px`,
                          letterSpacing:
                            pixelWidth < 46 ? "-0.05em" : "-0.02em",
                        }}
                      >
                        {answerValue || placeholder}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className={isModalPreview ? "space-y-3" : "space-y-4"}>
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={onToggleShowAnswers}
              className="w-full rounded-2xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 hover:bg-orange-100"
            >
              {showAnswers ? "정답 보기 닫기" : "정답 보기"}
            </button>
            {showAnswers && (
              <div className="mt-4 flex flex-wrap gap-2">
                {assignment.answerOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onSelectAnswer(option)}
                    className={`rounded-full px-3 py-2 text-sm font-bold transition disabled:cursor-default disabled:opacity-70 ${
                      selectedAnswer === option
                        ? "bg-orange-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-orange-100"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-gray-700">안내</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
              {helperItems.map((item, index) => (
                <li key={`${item}-${index}`}>
                  {index + 1}. {item}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onSubmit}
              disabled={readOnly || submitting || completed || !onSubmit}
              className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {readOnly
                ? "읽기 전용 미리보기"
                : submitting
                  ? "제출 중..."
                  : completed
                    ? "제출 완료"
                    : "제출하기"}
            </button>
            {resultText && (
              <div className="mt-3 text-sm font-bold text-blue-700">
                {resultText}
              </div>
            )}
            {pointNotice && (
              <div
                className={`mt-3 text-sm font-bold ${
                  isPointAwardedNotice ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {pointNotice}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default HistoryClassroomAssignmentView;
