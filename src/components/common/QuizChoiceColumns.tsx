import type { CSSProperties } from "react";
import {
  decodeQuizChoiceColumns,
  QUIZ_CHOICE_COLUMN_LABELS,
} from "../../lib/quizChoiceColumns";
import "./quizChoiceColumns.css";

const columnsStyle = (count: number) =>
  ({ "--quiz-choice-column-count": count }) as CSSProperties;

export function QuizChoiceColumnHeaders({ count }: { count: number }) {
  if (count < 2 || count > QUIZ_CHOICE_COLUMN_LABELS.length) return null;
  return (
    <span className="quiz-choice-column-headings" style={columnsStyle(count)}>
      {QUIZ_CHOICE_COLUMN_LABELS.slice(0, count).map((label) => (
        <span key={label}>({label})</span>
      ))}
    </span>
  );
}

export function QuizChoiceColumnCells({ value }: { value: string }) {
  const cells = decodeQuizChoiceColumns(value);
  if (!cells) return <>{value}</>;
  return (
    <span
      className="quiz-choice-column-cells"
      style={columnsStyle(cells.length)}
    >
      {cells.map((cell, index) => (
        <span key={index}>
          <span className="quiz-choice-column-sr-only">
            ({QUIZ_CHOICE_COLUMN_LABELS[index]}){" "}
          </span>
          {cell}
        </span>
      ))}
    </span>
  );
}
