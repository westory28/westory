import React from "react";
import {
  EXAM_OMR_CHOICES,
  getExamOmrCorrectChoice,
  getExamOmrCorrectState,
  getExamOmrStudentChoice,
  type ExamOmrChoice,
  type ExamOmrQuestionResult,
} from "./examOmr";

type ExamOmrCardProps = {
  items: ExamOmrQuestionResult[];
  title?: string;
  description?: string;
  mode?: "student" | "teacher";
  compact?: boolean;
  showScore?: boolean;
  className?: string;
};

const formatAnswer = (choice: ExamOmrChoice | null) =>
  choice ? `${choice}번` : "미응답";

const formatScore = (item: ExamOmrQuestionResult) => {
  if (item.scoreEntered === false) return "점수 미입력";
  if (item.score == null && item.maxScore == null) return "";
  if (item.maxScore == null) return `${item.score ?? 0}점`;
  return `${item.score ?? 0}/${item.maxScore}점`;
};

const getStatusText = (item: ExamOmrQuestionResult) => {
  if (item.invalid) return "확인 필요";

  const correctState = getExamOmrCorrectState(item);
  if (correctState === true) return "정답";
  if (correctState === false) return "오답";
  return "채점 대기";
};

const getStatusClassName = (item: ExamOmrQuestionResult) => {
  if (item.invalid) return "border-rose-200 bg-rose-50 text-rose-700";

  const correctState = getExamOmrCorrectState(item);
  if (correctState === true) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (correctState === false) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const getBubbleClassName = ({
  choice,
  studentChoice,
  correctChoice,
  status,
}: {
  choice: ExamOmrChoice;
  studentChoice: ExamOmrChoice | null;
  correctChoice: ExamOmrChoice | null;
  status: boolean | null;
}) => {
  const isMarked = choice === studentChoice;
  const isCorrectAnswer = choice === correctChoice;

  if (isMarked && status === true) {
    return "border-emerald-600 bg-emerald-600 text-white shadow-sm";
  }
  if (isMarked && status === false) {
    return "border-rose-600 bg-rose-600 text-white shadow-sm";
  }
  if (isMarked) return "border-blue-600 bg-blue-600 text-white shadow-sm";
  if (isCorrectAnswer) return "border-blue-500 bg-blue-50 text-blue-700";
  return "border-slate-300 bg-white text-slate-500";
};

const ExamOmrItem: React.FC<{
  item: ExamOmrQuestionResult;
  compact: boolean;
  showScore: boolean;
}> = ({ item, compact, showScore }) => {
  const studentChoice = getExamOmrStudentChoice(item);
  const correctChoice = getExamOmrCorrectChoice(item);
  const correctState = getExamOmrCorrectState(item);
  const statusText = getStatusText(item);
  const scoreText = formatScore(item);
  const itemLabel = `${item.questionNumber}번 문항, ${statusText}, 학생 답 ${formatAnswer(
    studentChoice,
  )}, 정답 ${formatAnswer(correctChoice)}${scoreText ? `, ${scoreText}` : ""}`;

  return (
    <article
      className={[
        "min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm",
        compact ? "px-3 py-2" : "px-4 py-3",
      ].join(" ")}
      aria-label={itemLabel}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={[
              "flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-extrabold text-slate-800",
              compact ? "h-8 w-8 text-sm" : "h-9 w-9 text-base",
            ].join(" ")}
            aria-hidden="true"
          >
            {item.questionNumber}
          </span>
          <div className="min-w-0">
            <p className="break-keep text-sm font-extrabold leading-5 text-slate-900">
              {item.questionNumber}번
            </p>
            {!compact && (
              <p className="break-keep text-xs font-medium leading-4 text-slate-500">
                학생 답 {formatAnswer(studentChoice)}
              </p>
            )}
          </div>
        </div>
        <span
          className={[
            "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-extrabold leading-none",
            getStatusClassName(item),
          ].join(" ")}
        >
          {statusText}
        </span>
      </div>

      <div
        className={[
          "mt-3 grid grid-cols-5",
          compact ? "gap-1.5" : "gap-2",
        ].join(" ")}
        aria-hidden="true"
      >
        {EXAM_OMR_CHOICES.map((choice) => (
          <span
            key={choice}
            className={[
              "flex items-center justify-center rounded-full border-2 font-extrabold transition-colors",
              compact ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm",
              getBubbleClassName({
                choice,
                studentChoice,
                correctChoice,
                status: correctState,
              }),
            ].join(" ")}
          >
            {choice}
          </span>
        ))}
      </div>

      <div
        className={[
          "mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold leading-5",
          compact ? "text-slate-500" : "text-slate-600",
        ].join(" ")}
      >
        <span>정답 {formatAnswer(correctChoice)}</span>
        {compact && <span>학생 답 {formatAnswer(studentChoice)}</span>}
        {showScore && scoreText && <span>{scoreText}</span>}
        {item.invalid && <span className="text-rose-700">답안 확인 필요</span>}
      </div>
    </article>
  );
};

export const ExamOmrCard: React.FC<ExamOmrCardProps> = ({
  items,
  title = "OMR 답안 확인",
  description,
  mode = "student",
  compact = mode === "teacher",
  showScore = true,
  className = "",
}) => {
  const answeredCount = items.filter((item) =>
    getExamOmrStudentChoice(item),
  ).length;
  const correctCount = items.filter(
    (item) => getExamOmrCorrectState(item) === true,
  ).length;

  return (
    <section
      className={[
        "rounded-lg border border-slate-200 bg-white shadow-sm",
        compact ? "p-4" : "p-5",
        className,
      ].join(" ")}
      aria-label={title}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold leading-6 text-slate-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
              {description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-xs font-extrabold">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
            응답 {answeredCount}/{items.length}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
            정답 {correctCount}
          </span>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 overflow-x-auto pb-1">
          <div
            className="grid grid-cols-1 gap-3 lg:grid-flow-col lg:grid-cols-none lg:grid-rows-5"
            style={{
              gridAutoColumns: compact
                ? "minmax(12rem, 1fr)"
                : "minmax(15rem, 1fr)",
            }}
          >
            {items.map((item) => (
              <ExamOmrItem
                key={String(item.questionNumber)}
                item={item}
                compact={compact}
                showScore={showScore}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-semibold text-slate-600">
          표시할 OMR 답안이 없습니다.
        </div>
      )}
    </section>
  );
};

export type { ExamOmrCardProps };
export default ExamOmrCard;
