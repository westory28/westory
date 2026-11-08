import React from "react";
import {
  MockExamImage,
  MockExamAnswerCheck,
  examChoiceNumber,
  type MockExamPaperQuestion,
} from "./MockExamPaper";
import { SHORT_ANSWER_MAX_LENGTH } from "../../lib/assessmentAnswerLimits";
import {
  QuizChoiceColumnCells,
  QuizChoiceColumnHeaders,
} from "./QuizChoiceColumns";
import { getQuizChoiceColumnCount } from "../../lib/quizChoiceColumns";
import {
  formatMockExamChoiceLabel,
  getMockExamChoiceColumns,
} from "../../lib/mockExamChoiceLayout";
import "./mockExamAnswerControls.css";

export default function MockExamAnswerControls({
  question,
  index,
  answer,
  onAnswer,
  disabled = false,
  orderOptions = question.options || [],
  choiceLayout = "list",
}: {
  question: MockExamPaperQuestion;
  index: number;
  answer: string;
  onAnswer: (value: string) => void;
  disabled?: boolean;
  orderOptions?: string[];
  choiceLayout?: "list" | "paper";
}) {
  const options = question.type === "ox" ? ["O", "X"] : question.options || [];
  const tableColumns = getQuizChoiceColumnCount(options);
  const paperColumns = getMockExamChoiceColumns(
    options,
    question.choiceOptionImages,
  );
  const order = answer.split("||").filter(Boolean);
  const pairs =
    question.matchingLeftOptions ||
    question.matchingPairs?.map((pair) => pair.left) ||
    [];
  const rightOptions =
    question.matchingRightOptions || question.matchingPairs || [];
  const matching = Object.fromEntries(
    answer
      .split("||")
      .filter(Boolean)
      .map((part) => part.split("=>")),
  );
  return (
    <fieldset
      disabled={disabled}
      className={`mock-exam-answer-controls${choiceLayout === "paper" ? " mock-exam-answer-controls--paper" : ""}`}
    >
      <legend className="mock-exam-sr-only">{index + 1}번 답안</legend>
      {["choice", "ox"].includes(question.type) && (
        <>
          {tableColumns > 1 && (
            <div className="mock-exam-column-header">
              <span aria-hidden="true" />
              <QuizChoiceColumnHeaders count={tableColumns} />
            </div>
          )}
          <div
            role="radiogroup"
            aria-label="답안 선택"
            className={
              tableColumns > 1
                ? "mock-exam-options mock-exam-options--columns"
                : choiceLayout === "paper"
                  ? `mock-exam-options mock-exam-options--${paperColumns}`
                  : undefined
            }
          >
            {options.map((option, index) => (
              <label
                key={index}
                className={answer === option ? "is-selected" : ""}
              >
                <input
                  type="radio"
                  name={`exam-answer-${question.id}`}
                  value={option}
                  checked={answer === option}
                  onChange={() => onAnswer(option)}
                  onClick={() => {
                    if (!disabled && answer === option) onAnswer("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== " ") return;
                    event.preventDefault();
                    if (!disabled && !event.repeat)
                      onAnswer(answer === option ? "" : option);
                  }}
                />
                <span className="mock-exam-option-number">
                  {examChoiceNumber(index)}{" "}
                  {answer === option && <MockExamAnswerCheck />}
                </span>
                <span
                  className={
                    choiceLayout === "paper" || tableColumns > 1
                      ? "mock-exam-option-text"
                      : undefined
                  }
                >
                  {tableColumns > 1 ? (
                    <QuizChoiceColumnCells value={option} />
                  ) : choiceLayout === "paper" ? (
                    formatMockExamChoiceLabel(option)
                  ) : (
                    option
                  )}
                  {question.choiceOptionImages?.[index] && (
                    <MockExamImage
                      src={question.choiceOptionImages[index]!}
                      alt={`${index + 1}번 보기 자료`}
                    />
                  )}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {["short", "word"].includes(question.type) && (
        <label className="mock-exam-short-label">
          답안
          <input
            value={answer}
            maxLength={SHORT_ANSWER_MAX_LENGTH}
            onChange={(event) => onAnswer(event.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      {question.type === "order" && (
        <div className="mock-exam-order">
          <div>
            {order.map((option, index) => (
              <button
                type="button"
                key={option}
                onClick={() =>
                  onAnswer(order.filter((_, i) => i !== index).join("||"))
                }
              >
                {index + 1}. {option} <span aria-label="선택 취소">×</span>
              </button>
            ))}
          </div>
          <div>
            {orderOptions.map((option) => (
              <button
                type="button"
                key={option}
                disabled={order.includes(option)}
                onClick={() => onAnswer([...order, option].join("||"))}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
      {question.type === "matching" && (
        <div className="mock-exam-matching-input">
          {rightOptions.map((pair, index) => (
            <p key={index}>
              {examChoiceNumber(index)} {pair.right}
              {pair.rightImage && (
                <MockExamImage
                  src={pair.rightImage}
                  alt={`${index + 1}번 연결 자료`}
                />
              )}
            </p>
          ))}
          {pairs.map((left) => (
            <label key={left}>
              {left}
              <select
                aria-label={left}
                value={matching[left] || ""}
                onChange={(event) => {
                  const next = {
                    ...matching,
                    [left]: event.target.value,
                  };
                  onAnswer(
                    pairs
                      .filter((item) => next[item])
                      .map((item) => `${item}=>${next[item]}`)
                      .join("||"),
                  );
                }}
              >
                <option value="">선택</option>
                {rightOptions.map((pair, index) => (
                  <option key={index} value={pair.right}>
                    {examChoiceNumber(index)} {pair.right}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
