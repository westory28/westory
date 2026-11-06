import React, { useEffect, useRef, useState } from "react";
import MockExamPaper, {
  MockExamQuestionContent,
  MockExamImage,
  examChoiceNumber,
  type MockExamPaperCheck,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";
import { SHORT_ANSWER_MAX_LENGTH } from "../../../lib/assessmentAnswerLimits";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import { formatMockExamRoundLabel } from "../../../lib/mockExamRounds";
import "./mockExamWorkspace.css";

interface Props {
  questions: MockExamPaperQuestion[];
  answers: Record<string, string>;
  round: unknown;
  studentLabel: string;
  currentIndex: number;
  onSelect: (index: number) => void;
  onAnswer?: (value: string) => void;
  onSubmit?: () => void;
  submitting?: boolean;
  submitError?: string;
  submitConflict?: boolean;
  timeLeft?: number;
  saveStatus?: string;
  onSaveRetry?: () => void;
  checks?: MockExamPaperCheck[];
  score?: number;
  onReview?: () => void;
  onReturn?: () => void;
  orderOptions?: Record<number, string[]>;
  onImageReady?: (source: string, failed?: boolean) => void;
  answeredCount?: number;
}

export default function MockExamWorkspace(props: Props) {
  const {
    questions,
    answers,
    round,
    studentLabel,
    currentIndex,
    onSelect,
    onAnswer,
    onSubmit,
    submitting,
    checks = [],
    score,
  } = props;
  const [zoomed, setZoomed] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [touch, setTouch] = useState(
    window.matchMedia("(pointer: coarse)").matches,
  );
  const zoomPanel = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const zoomScroll = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const question = questions[currentIndex];
  const result = typeof score === "number";
  const rotated =
    touch &&
    viewport.width > viewport.height &&
    Math.min(viewport.width, viewport.height) <= 1024;
  const fixed = fullPage || rotated;
  const answer = question ? answers[String(question.id)] || "" : "";
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const resize = () => {
      setTouch(media.matches);
      setViewport((previous) => {
        const editing = document.activeElement?.matches(
          "input, textarea, select",
        );
        // A keyboard may shrink the viewport without rotating the device.
        if (editing && Math.abs(previous.width - window.innerWidth) < 4)
          return previous;
        return { width: window.innerWidth, height: window.innerHeight };
      });
    };
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    media.addEventListener("change", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      media.removeEventListener("change", resize);
    };
  }, []);
  useEffect(() => {
    if (!fixed) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = acquirePageScrollLock();
    workspace.current
      ?.querySelector<HTMLButtonElement>(".mock-exam-toolbar button")
      ?.focus();
    return () => {
      release();
      if (previous?.isConnected) previous.focus();
    };
  }, [fixed]);
  useEffect(() => {
    if (!zoomed) return;
    const release = acquirePageScrollLock();
    zoomPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      release();
      lastFocus.current?.isConnected && lastFocus.current.focus();
    };
  }, [zoomed]);
  useEffect(() => {
    zoomScroll.current?.scrollTo(0, 0);
  }, [currentIndex]);
  useEffect(() => {
    if (result) setZoomed(false);
  }, [result]);
  const openQuestion = (index: number) => {
    lastFocus.current = document.activeElement as HTMLElement;
    onSelect(index);
    setZoomed(true);
  };
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (zoomed) {
        event.stopPropagation();
        setZoomed(false);
      } else setFullPage(false);
    }
    if (event.key !== "Tab" || (!zoomed && !fixed)) return;
    const focusRoot = zoomed ? zoomPanel.current : workspace.current;
    const items = Array.from(
      focusRoot?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) || [],
    ).filter(
      (element) =>
        element.getClientRects().length && !element.closest("[inert]"),
    );
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === items[items.length - 1]
    ) {
      event.preventDefault();
      items[0]?.focus();
    }
  };
  const order = answer.split("||").filter(Boolean);
  const orderOptions = question
    ? props.orderOptions?.[Number(question.id)] || question.options || []
    : [];
  const pairs =
    question?.matchingLeftOptions ||
    question?.matchingPairs?.map((pair) => pair.left) ||
    [];
  const rightOptions =
    question?.matchingRightOptions || question?.matchingPairs || [];
  const matching = Object.fromEntries(
    answer
      .split("||")
      .filter(Boolean)
      .map((part) => part.split("=>")),
  );
  return (
    <div
      ref={workspace}
      className={`mock-exam-workspace ${fixed ? "is-fixed" : ""} ${rotated ? "is-rotated" : ""}`}
      style={
        {
          "--exam-viewport-width": `${viewport.width}px`,
          "--exam-viewport-height": `${viewport.height}px`,
        } as React.CSSProperties
      }
      onKeyDown={keyDown}
      onLoadCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          props.onImageReady?.(event.target.getAttribute("src") || "");
      }}
      onErrorCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          props.onImageReady?.(event.target.getAttribute("src") || "", true);
      }}
    >
      <div
        className="mock-exam-workspace-base"
        {...(zoomed ? ({ inert: "" } as Record<string, string>) : {})}
      >
        <header className="mock-exam-toolbar">
          <h1>{formatMockExamRoundLabel(round)}</h1>
          {!result && (
            <span
              className={(props.timeLeft || 0) <= 60 ? "is-urgent" : ""}
              aria-label="평가 남은 시간"
            >
              {Math.floor((props.timeLeft || 0) / 60)
                .toString()
                .padStart(2, "0")}
              :{((props.timeLeft || 0) % 60).toString().padStart(2, "0")}
            </span>
          )}
          <button
            type="button"
            onClick={() => setFullPage((previous) => !previous)}
            aria-pressed={fullPage}
          >
            {fullPage ? "전체 화면 닫기" : "전체 화면"}
          </button>
        </header>
        <div className="mock-exam-workspace-scroll">
          <MockExamPaper
            questions={questions}
            answers={answers}
            round={round}
            studentLabel={studentLabel}
            score={score}
            checks={checks}
            onQuestionSelect={openQuestion}
            animateGrading={result}
            disabled={submitting}
          />
        </div>
        <footer className="mock-exam-submit-bar">
          {result ? (
            <>
              <button type="button" onClick={props.onReturn}>
                평가 목록
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={props.onReview}
              >
                저장된 답안·해설
              </button>
            </>
          ) : (
            <>
              <div>
                <span>
                  {props.answeredCount ??
                    questions.filter((item) => answers[String(item.id)]?.trim())
                      .length}{" "}
                  / {questions.length}문항
                </span>
                <span role="status">
                  {(
                    {
                      saving: "저장 중",
                      pending: "저장 대기",
                      saved: "저장됨",
                      error: "저장 실패",
                    } as Record<string, string>
                  )[props.saveStatus || ""] || ""}
                </span>
              </div>
              {props.saveStatus === "error" && (
                <button
                  type="button"
                  onClick={props.onSaveRetry}
                  disabled={submitting}
                >
                  다시 저장
                </button>
              )}
              <button
                type="button"
                className="is-primary"
                disabled={submitting || props.submitConflict}
                onClick={onSubmit}
              >
                {submitting
                  ? "제출 중…"
                  : props.submitError && !props.submitConflict
                    ? "다시 제출"
                    : "제출하기"}
              </button>
            </>
          )}
          {props.submitError && (
            <p className="mock-exam-submit-error" role="alert">
              {props.submitError}
            </p>
          )}
        </footer>
      </div>
      {zoomed && question && (
        <div
          className="mock-exam-zoom-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setZoomed(false);
          }}
        >
          <div
            ref={zoomPanel}
            className="mock-exam-zoom"
            role="dialog"
            aria-modal="true"
            aria-label={`${currentIndex + 1}번 문제 확대`}
          >
            <header>
              <strong>
                {currentIndex + 1} / {questions.length}번
              </strong>
              <button type="button" onClick={() => setZoomed(false)}>
                시험지로 돌아가기
              </button>
            </header>
            <div ref={zoomScroll} className="mock-exam-zoom-scroll">
              <MockExamQuestionContent
                question={question}
                index={currentIndex}
                answer={answer}
                hideAnswers={!result}
              />
              {result ? (
                <div className="mock-exam-review-answer">
                  <strong>
                    {checks.find(
                      (check) => String(check.id) === String(question.id),
                    )?.correct === true
                      ? "정답"
                      : checks.find(
                            (check) => String(check.id) === String(question.id),
                          )?.correct === false
                        ? "오답"
                        : "채점 정보 없음"}
                  </strong>
                  <p>내 답안: {answer || "미응답"}</p>
                  <p>정답: {question.answer || "미보관"}</p>
                  {question.explanation && <p>{question.explanation}</p>}
                </div>
              ) : (
                <fieldset
                  disabled={submitting}
                  className="mock-exam-answer-controls"
                >
                  <legend className="mock-exam-sr-only">
                    {currentIndex + 1}번 답안
                  </legend>
                  {["choice", "ox"].includes(question.type) && (
                    <div role="radiogroup" aria-label="답안 선택">
                      {(question.type === "ox"
                        ? ["O", "X"]
                        : question.options || []
                      ).map((option, index) => (
                        <label
                          key={index}
                          className={answer === option ? "is-selected" : ""}
                        >
                          <input
                            type="radio"
                            name={`exam-answer-${question.id}`}
                            value={option}
                            checked={answer === option}
                            onChange={() => onAnswer?.(option)}
                          />
                          <span>{examChoiceNumber(index)}</span>
                          <span>
                            {option}
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
                  )}
                  {["short", "word"].includes(question.type) && (
                    <label className="mock-exam-short-label">
                      답안
                      <input
                        value={answer}
                        maxLength={SHORT_ANSWER_MAX_LENGTH}
                        onChange={(event) => onAnswer?.(event.target.value)}
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
                              onAnswer?.(
                                order.filter((_, i) => i !== index).join("||"),
                              )
                            }
                          >
                            {index + 1}. {option}{" "}
                            <span aria-label="선택 취소">×</span>
                          </button>
                        ))}
                      </div>
                      <div>
                        {orderOptions.map((option) => (
                          <button
                            type="button"
                            key={option}
                            disabled={order.includes(option)}
                            onClick={() =>
                              onAnswer?.([...order, option].join("||"))
                            }
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
                            value={matching[left] || ""}
                            onChange={(event) => {
                              const next = {
                                ...matching,
                                [left]: event.target.value,
                              };
                              onAnswer?.(
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
                  {answer && (
                    <button
                      type="button"
                      className="mock-exam-clear-answer"
                      onClick={() => onAnswer?.("")}
                    >
                      답안 지우기
                    </button>
                  )}
                </fieldset>
              )}
            </div>
            <footer>
              <button
                type="button"
                disabled={currentIndex === 0 || submitting}
                onClick={() => onSelect(currentIndex - 1)}
              >
                이전 문제
              </button>
              <button
                type="button"
                disabled={currentIndex >= questions.length - 1 || submitting}
                onClick={() => onSelect(currentIndex + 1)}
              >
                다음 문제
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
