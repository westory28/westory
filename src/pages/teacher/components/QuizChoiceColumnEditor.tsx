import React from "react";
import QuizTextField from "./QuizTextField";
import {
  QUIZ_CHOICE_COLUMN_LABELS,
  decodeQuizChoiceColumns,
  encodeQuizChoiceColumns,
  getQuizChoiceColumnCount,
} from "../../../lib/quizChoiceColumns";
import "./QuizChoiceColumnEditor.css";

export function QuizChoiceColumnTools({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const count = getQuizChoiceColumnCount(options);
  const resize = (nextCount: number) => {
    const rows = options.map((value) =>
      count > 1 ? decodeQuizChoiceColumns(value) || [value] : [value],
    );
    if (
      nextCount < count &&
      rows.some((row) => row[count - 1]?.trim()) &&
      !window.confirm("마지막 열에 입력한 내용이 삭제됩니다. 열을 삭제할까요?")
    )
      return;
    onChange(
      rows.map((row) =>
        encodeQuizChoiceColumns(
          Array.from({ length: nextCount }, (_, index) => row[index] || ""),
        ),
      ),
    );
  };
  return (
    <span className="quiz-choice-column-tools">
      {count > 1 && (
        <button
          type="button"
          className="quiz-authoring-button"
          onClick={() => resize(count - 1)}
        >
          열 삭제
        </button>
      )}
      <button
        type="button"
        className="quiz-authoring-button"
        disabled={count >= QUIZ_CHOICE_COLUMN_LABELS.length}
        onClick={() => resize(count + 1)}
      >
        열 추가
      </button>
    </span>
  );
}

export function QuizChoiceColumnInputs({
  value,
  index,
  count,
  onChange,
  onKeyDown,
  grow = false,
}: {
  value: string;
  index: number;
  count: number;
  onChange: (value: string) => void;
  onKeyDown?: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    column: number,
  ) => void;
  grow?: boolean;
}) {
  const cells = count > 1 ? decodeQuizChoiceColumns(value) || [value] : [value];
  return (
    <div
      className="quiz-choice-column-inputs"
      style={{ "--choice-input-columns": count } as React.CSSProperties}
    >
      {Array.from({ length: count }, (_, column) => (
        <label key={column} className="quiz-choice-column-field">
          {count > 1 && index === 0 && (
            <span className="quiz-choice-column-label">
              ({QUIZ_CHOICE_COLUMN_LABELS[column]})
            </span>
          )}
          <QuizTextField
            grow={grow}
            lang="ko"
            inputMode="text"
            value={cells[column] || ""}
            onChange={(event) => {
              const next = Array.from({ length: count }, (_, current) =>
                current === column ? event.target.value : cells[current] || "",
              );
              onChange(
                count === 1
                  ? event.target.value
                  : encodeQuizChoiceColumns(next),
              );
            }}
            onKeyDown={(event) => onKeyDown?.(event, column)}
            aria-label={`${index + 1}번 보기${count > 1 ? ` (${QUIZ_CHOICE_COLUMN_LABELS[column]})` : ""}`}
            data-choice-column={column}
            className="quiz-compose-field w-full border rounded p-2 text-sm bg-white"
          />
        </label>
      ))}
    </div>
  );
}
