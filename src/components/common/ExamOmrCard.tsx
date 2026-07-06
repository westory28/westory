import React from "react";
import {
  EXAM_OMR_CHOICES,
  getExamOmrCorrectChoices,
  getExamOmrCorrectState,
  getExamOmrStudentChoice,
  getExamOmrStudentChoices,
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
  scoreLabel?: string;
  className?: string;
};

type ExamOmrAnswerStripProps = {
  items: ExamOmrQuestionResult[];
  wrap?: boolean;
  className?: string;
};

const formatChoices = (choices: ExamOmrChoice[]) =>
  choices.length ? choices.map((choice) => `${choice}번`).join(", ") : "미응답";

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
  studentChoices,
  correctChoices,
}: {
  choice: ExamOmrChoice;
  studentChoices: ExamOmrChoice[];
  correctChoices: ExamOmrChoice[];
}) => {
  const isMarked = studentChoices.includes(choice);
  const isCorrectAnswer = correctChoices.includes(choice);

  if (isMarked && isCorrectAnswer) {
    return "border-blue-600 bg-blue-600 text-white shadow-sm";
  }
  if (isMarked) return "border-rose-600 bg-rose-600 text-white shadow-sm";
  if (isCorrectAnswer) return "border-blue-500 bg-blue-50 text-blue-700";
  return "border-slate-300 bg-white text-slate-500";
};

const getAnswerStripClassName = (item: ExamOmrQuestionResult) => {
  const correctState = getExamOmrCorrectState(item);
  if (correctState === true) {
    return "border-blue-600 bg-blue-600 text-white";
  }
  if (correctState === false) {
    return "border-rose-600 bg-rose-600 text-white";
  }
  return "border-slate-300 bg-white text-slate-500";
};

const chunkExamOmrItems = (items: ExamOmrQuestionResult[], size = 5) => {
  const chunks: ExamOmrQuestionResult[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const ExamOmrAnswerStrip: React.FC<ExamOmrAnswerStripProps> = ({
  items,
  wrap = false,
  className = "",
}) => (
  <div
    className={[
      "flex min-w-0 items-center gap-x-0.5 gap-y-1",
      wrap ? "flex-wrap" : "flex-nowrap",
      className,
    ].join(" ")}
    aria-label="서답형 정오표"
  >
    {items.map((item, index) => {
      const statusText = getStatusText(item);
      const studentChoices = getExamOmrStudentChoices(item);
      const correctChoices = getExamOmrCorrectChoices(item);
      return (
        <span
          key={String(item.questionNumber)}
          className={[
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-black leading-none",
            index > 0 && index % 5 === 0 ? "ml-2" : "",
            getAnswerStripClassName(item),
          ].join(" ")}
          title={`${item.questionNumber}번 ${statusText}, 학생 답 ${formatChoices(
            studentChoices,
          )}, 정답 ${formatChoices(correctChoices)}`}
          aria-label={`${item.questionNumber}번 ${statusText}`}
        >
          {item.questionNumber}
        </span>
      );
    })}
  </div>
);

const ExamOmrQuestionRow: React.FC<{
  item: ExamOmrQuestionResult;
  compact: boolean;
  showScore: boolean;
}> = ({ item, compact, showScore }) => {
  const studentChoices = getExamOmrStudentChoices(item);
  const correctChoices = getExamOmrCorrectChoices(item);
  const statusText = getStatusText(item);
  const scoreText = formatScore(item);
  const itemLabel = `${item.questionNumber}번 문항, ${statusText}, 학생 답 ${formatChoices(
    studentChoices,
  )}, 정답 ${formatChoices(correctChoices)}${scoreText ? `, ${scoreText}` : ""}`;

  return (
    <div
      className={[
        "grid min-w-0 grid-cols-[2.75rem_auto] items-center gap-2",
        compact ? "text-sm" : "text-base",
      ].join(" ")}
      aria-label={itemLabel}
    >
      <span className="whitespace-nowrap text-right font-black text-slate-900">
        {item.questionNumber}번
      </span>

      <div
        className={["grid grid-cols-5", compact ? "gap-1" : "gap-1.5"].join(
          " ",
        )}
        aria-hidden="true"
      >
        {EXAM_OMR_CHOICES.map((choice) => (
          <span
            key={choice}
            className={[
              "flex shrink-0 items-center justify-center rounded-full border-2 font-extrabold leading-none transition-colors",
              compact ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm",
              getBubbleClassName({
                choice,
                studentChoices,
                correctChoices,
              }),
            ].join(" ")}
          >
            {choice}
          </span>
        ))}
      </div>
      <span className="sr-only">
        {statusText}
        {showScore && scoreText ? `, ${scoreText}` : ""}
      </span>
    </div>
  );
};

const ExamOmrGroup: React.FC<{
  items: ExamOmrQuestionResult[];
  index: number;
  compact: boolean;
  showScore: boolean;
}> = ({ items, index, compact, showScore }) => {
  const first = items[0]?.questionNumber;
  const last = items[items.length - 1]?.questionNumber;

  return (
    <section
      className={[
        "min-w-0 rounded-lg",
        index % 2 === 0 ? "bg-slate-50" : "bg-blue-50/60",
        compact ? "px-3 py-3" : "px-4 py-4",
      ].join(" ")}
      aria-label={`${first}-${last}번 OMR 답안`}
    >
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
  scoreLabel,
  className = "",
}) => {
  const answeredCount = items.filter((item) =>
    getExamOmrStudentChoice(item),
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
          {scoreLabel && (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
              {scoreLabel}
            </span>
          )}
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
            응답 {answeredCount}/{items.length}
          </span>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-4">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {itemGroups.map((group, index) => (
              <ExamOmrGroup
                key={`${group[0]?.questionNumber || index}-${group[group.length - 1]?.questionNumber || index}`}
                items={group}
                index={index}
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
