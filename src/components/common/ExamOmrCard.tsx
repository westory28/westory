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
    return "border-blue-600 bg-blue-600 text-white shadow-sm";
  }
  if (isMarked && status === false) {
    return "border-slate-700 bg-slate-700 text-white shadow-sm";
  }
  if (isMarked) return "border-slate-700 bg-slate-700 text-white shadow-sm";
  if (isCorrectAnswer) return "border-blue-500 bg-blue-50 text-blue-700";
  return "border-slate-300 bg-white text-slate-500";
};

const chunkExamOmrItems = (items: ExamOmrQuestionResult[], size = 5) => {
  const chunks: ExamOmrQuestionResult[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const ExamOmrQuestionRow: React.FC<{
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
    <div
      className={[
        "grid min-w-0 items-center gap-2",
        compact
          ? "grid-cols-[2.25rem_minmax(9rem,1fr)_minmax(3.75rem,auto)]"
          : "grid-cols-[2.5rem_minmax(10rem,1fr)_minmax(4.25rem,auto)]",
      ].join(" ")}
      aria-label={itemLabel}
    >
      <span
        className={[
          "whitespace-nowrap text-right font-black text-slate-900",
          compact ? "text-sm" : "text-base",
        ].join(" ")}
      >
        {item.questionNumber}번
      </span>

      <div
        className={[
          "flex min-w-0 items-center",
          compact ? "gap-1.5" : "gap-2",
        ].join(" ")}
        aria-hidden="true"
      >
        {EXAM_OMR_CHOICES.map((choice) => (
          <span
            key={choice}
            className={[
              "flex shrink-0 items-center justify-center rounded-full border-2 font-extrabold transition-colors",
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

      <div className="min-w-0 text-right">
        {showScore && scoreText ? (
          <span
            className={[
              "whitespace-nowrap font-black",
              correctState === true ? "text-blue-700" : "text-slate-600",
              compact ? "text-xs" : "text-sm",
            ].join(" ")}
          >
            {scoreText}
          </span>
        ) : (
          <span className="sr-only">{statusText}</span>
        )}
      </div>
    </div>
  );
};

const ExamOmrGroup: React.FC<{
  items: ExamOmrQuestionResult[];
  compact: boolean;
  showScore: boolean;
}> = ({ items, compact, showScore }) => {
  const first = items[0]?.questionNumber;
  const last = items[items.length - 1]?.questionNumber;
  const correctCount = items.filter(
    (item) => getExamOmrCorrectState(item) === true,
  ).length;

  return (
    <section
      className={[
        "min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm",
        compact ? "px-3 py-3" : "px-4 py-4",
      ].join(" ")}
      aria-label={`${first}-${last}번 OMR 답안`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3
          className={[
            "font-black text-slate-900",
            compact ? "text-sm" : "text-base",
          ].join(" ")}
        >
          {first === last ? `${first}번` : `${first}-${last}번`}
        </h3>
        <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
          정답 {correctCount}
        </span>
      </div>
      <div
        className={["min-w-0", compact ? "space-y-2" : "space-y-2.5"].join(" ")}
      >
        {items.map((item) => (
          <ExamOmrQuestionRow
            key={String(item.questionNumber)}
            item={item}
            compact={compact}
            showScore={showScore}
          />
        ))}
      </div>
    </section>
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
  const itemGroups = chunkExamOmrItems(items);

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
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            정답 {correctCount}
          </span>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 overflow-x-auto pb-1">
          <div className="grid min-w-[20rem] grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {itemGroups.map((group, index) => (
              <ExamOmrGroup
                key={`${group[0]?.questionNumber || index}-${group[group.length - 1]?.questionNumber || index}`}
                items={group}
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
