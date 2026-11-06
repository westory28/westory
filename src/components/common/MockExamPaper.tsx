import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@fontsource/noto-serif-kr/400.css";
import "@fontsource/noto-serif-kr/700.css";
import "@fontsource/noto-serif-kr/900.css";
import QuizPassage from "./QuizPassage";
import QuizQuestionText from "./QuizQuestionText";
import { getMockExamRoundNumber } from "../../lib/mockExamRounds";
import "./mockExamPaper.css";

export interface MockExamPaperQuestion {
  id: string | number;
  type: string;
  question: string;
  options?: string[];
  choiceOptionImages?: Array<string | null>;
  image?: string | null;
  passage?: string | null;
  answer?: string | number;
  explanation?: string;
  points?: number;
  paperOrder?: number;
  paperBreakBefore?: boolean;
  matchingPairs?: Array<{
    left: string;
    right: string;
    rightImage?: string | null;
  }>;
  matchingLeftOptions?: string[];
  matchingRightOptions?: Array<{ right: string; rightImage?: string | null }>;
}
export interface MockExamPaperCheck {
  id: string | number;
  correct: boolean | null;
}
export const examChoiceNumber = (index: number) =>
  ["①", "②", "③", "④", "⑤"][index] || `${index + 1}.`;

export function MockExamImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className="mock-exam-image-wrap">
      <img
        key={`${src}-${retry}`}
        className={className}
        src={src}
        alt={alt}
        onLoad={() => setFailed(false)}
        onError={() => setFailed(true)}
      />
      {failed && (
        <span className="mock-exam-image-error" role="alert">
          자료를 불러오지 못했습니다.{" "}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            자료 다시 불러오기
          </button>
        </span>
      )}
    </span>
  );
}

export function MockExamQuestionContent({
  question,
  index,
  answer = "",
  hideAnswers = false,
}: {
  question: MockExamPaperQuestion;
  index: number;
  answer?: string;
  hideAnswers?: boolean;
}) {
  const options = question.type === "ox" ? ["O", "X"] : question.options || [];
  const imageOptions = question.choiceOptionImages?.some(Boolean);
  const shortOptions =
    !imageOptions &&
    options.length === 5 &&
    options.every((option) => option.length <= 5);
  const mediumOptions =
    !imageOptions &&
    options.length === 5 &&
    options.every((option) => option.length <= 12);
  return (
    <div className="mock-exam-question-ink">
      <p className="mock-exam-stem">
        <strong className="mock-exam-number">{index + 1}.</strong>{" "}
        <QuizQuestionText value={question.question} />
        {Number.isFinite(question.points) && (
          <span className="mock-exam-points"> [{question.points}점]</span>
        )}
      </p>
      {question.passage && (
        <QuizPassage value={question.passage} className="mock-exam-passage" />
      )}
      {question.image && (
        <MockExamImage
          className="mock-exam-image"
          src={question.image}
          alt={`${index + 1}번 자료`}
        />
      )}
      {!hideAnswers && options.length > 0 && (
        <ol
          className={`mock-exam-options ${shortOptions ? "mock-exam-options--five" : mediumOptions ? "mock-exam-options--two" : ""}`}
        >
          {options.map((option, optionIndex) => (
            <li
              key={optionIndex}
              className={answer === option ? "is-selected" : ""}
            >
              <span className="mock-exam-option-number">
                {examChoiceNumber(optionIndex)}
              </span>
              <span>
                {option}
                {question.choiceOptionImages?.[optionIndex] && (
                  <MockExamImage
                    src={question.choiceOptionImages[optionIndex]!}
                    alt={`${optionIndex + 1}번 보기 자료`}
                  />
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!hideAnswers && question.type === "matching" && (
        <div className="mock-exam-matching-material">
          <div>
            {(
              question.matchingLeftOptions ||
              question.matchingPairs?.map((pair) => pair.left) ||
              []
            ).map((left, i) => (
              <p key={i}>
                {i + 1}. {left}
              </p>
            ))}
          </div>
          <div>
            {(
              question.matchingRightOptions ||
              question.matchingPairs ||
              []
            ).map((pair, i) => (
              <p key={i}>
                {examChoiceNumber(i)} {pair.right}
                {pair.rightImage && (
                  <MockExamImage
                    src={pair.rightImage}
                    alt={`${i + 1}번 연결 자료`}
                  />
                )}
              </p>
            ))}
          </div>
        </div>
      )}
      {!hideAnswers && !["choice", "ox"].includes(question.type) && (
        <p className="mock-exam-written-answer">
          답:{" "}
          {answer.split("||").join(" → ").split("=>").join(" → ") ||
            "　　　　　　　　　　　　　　　　　"}
        </p>
      )}
    </div>
  );
}

function PencilMark({ correct }: { correct: boolean | null }) {
  if (correct == null) return null;
  return (
    <span
      className={`mock-exam-pencil ${correct ? "is-correct" : "is-incorrect"}`}
      role="img"
      aria-label={correct ? "정답" : "오답"}
    >
      <svg viewBox="0 0 80 80" aria-hidden="true">
        {correct ? (
          <>
            <path d="M60 12C37-1 8 13 9 39C8 66 38 77 59 62C83 44 72 14 50 9" />
            <path d="M57 10C31 0 6 19 12 46C18 72 53 76 68 49C77 30 64 12 47 10" />
          </>
        ) : (
          <>
            <path d="M63 9L17 69" />
            <path d="M66 10L19 72" />
          </>
        )}
      </svg>
    </span>
  );
}

type PaperPage = { columns: number[][]; height: number };
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const COLUMN_ROOM = 930;
const FIRST_COLUMN_ROOM = 842;

export default function MockExamPaper({
  questions,
  answers = {},
  round = "round_1",
  studentLabel = "3학년　　반　　번　 이름:",
  score,
  checks = [],
  onQuestionSelect,
  animateGrading = false,
  disabled = false,
}: {
  questions: MockExamPaperQuestion[];
  answers?: Record<string, string>;
  round?: unknown;
  studentLabel?: string;
  score?: number | null;
  checks?: MockExamPaperCheck[];
  onQuestionSelect?: (index: number) => void;
  animateGrading?: boolean;
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const measurements = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PAGE_WIDTH);
  const [heights, setHeights] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(
    animateGrading ? 0 : questions.length,
  );
  const roundNumber = getMockExamRoundNumber(round);
  const roundName =
    ["초시", "복시", "전시"][roundNumber - 1] || `${roundNumber}회`;
  const title = `중학교 3학년 ${roundName}`;
  const checkMap = useMemo(
    () => new Map(checks.map((check) => [String(check.id), check.correct])),
    [checks],
  );

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => setWidth(Math.min(PAGE_WIDTH, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = measurements.current;
    if (!element) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const next = Array.from(element.children).map(
        (node) => Math.ceil((node as HTMLElement).offsetHeight) + 24,
      );
      setHeights((previous) =>
        previous.join() === next.join() ? previous : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    Array.from(element.children).forEach((node) => observer.observe(node));
    void document.fonts.ready.then(update);
    element.addEventListener("load", update, true);
    return () => {
      active = false;
      observer.disconnect();
      element.removeEventListener("load", update, true);
    };
  }, [questions, answers]);
  useEffect(() => {
    if (
      !animateGrading ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setRevealed(questions.length);
      return;
    }
    setRevealed(0);
    const interval = window.setInterval(
      () =>
        setRevealed((previous) => {
          if (previous + 1 >= questions.length) window.clearInterval(interval);
          return Math.min(previous + 1, questions.length);
        }),
      180,
    );
    return () => window.clearInterval(interval);
  }, [animateGrading, questions.length]);

  const pages = useMemo(() => {
    const output: PaperPage[] = [{ columns: [[], []], height: PAGE_HEIGHT }];
    let column = 0,
      used = 0;
    questions.forEach((question, index) => {
      let page = output[output.length - 1];
      const room = output.length === 1 ? FIRST_COLUMN_ROOM : COLUMN_ROOM;
      const height = heights[index] || 260;
      if (
        question.paperBreakBefore &&
        page.columns.some((items) => items.length)
      ) {
        output.push({ columns: [[], []], height: PAGE_HEIGHT });
        column = 0;
        used = 0;
      } else if (used > 0 && used + height > room) {
        if (column === 0) column = 1;
        else {
          output.push({ columns: [[], []], height: PAGE_HEIGHT });
          column = 0;
        }
        used = 0;
      }
      page = output[output.length - 1];
      page.columns[column].push(index);
      used += height;
      page.height = Math.max(
        page.height,
        used +
          (output.length === 1
            ? PAGE_HEIGHT - FIRST_COLUMN_ROOM
            : PAGE_HEIGHT - COLUMN_ROOM),
      );
    });
    return output;
  }, [questions, heights]);
  const scale = Math.max(0.1, width / PAGE_WIDTH);
  return (
    <div
      ref={container}
      className="mock-exam-paper"
      aria-label={`${title} 시험지`}
    >
      <div ref={measurements} className="mock-exam-measure" aria-hidden="true">
        {questions.map((question, index) => (
          <div key={question.id} className="mock-exam-question">
            <MockExamQuestionContent
              question={question}
              index={index}
              answer={answers[String(question.id)]}
            />
          </div>
        ))}
      </div>
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="mock-exam-sheet-space"
          style={{ height: page.height * scale }}
        >
          <section
            className="mock-exam-sheet"
            aria-label={`${pageIndex + 1}쪽`}
            style={{
              width: PAGE_WIDTH,
              minHeight: page.height,
              transform: `scale(${scale})`,
            }}
          >
            {pageIndex === 0 ? (
              <>
                <div className="mock-exam-cover-line">
                  <span>역사과 · {roundNumber}회 모의고사</span>
                  {score != null && revealed >= questions.length && (
                    <strong
                      className="mock-exam-score"
                      aria-label={`점수 ${score}점, 100점 만점`}
                    >
                      {score}
                      <small>/100</small>
                    </strong>
                  )}
                </div>
                <header className="mock-exam-title-box">
                  <h2>{title}</h2>
                  <p>역사과　({roundNumber}회 모의고사)</p>
                  <p className="mock-exam-student">{studentLabel}</p>
                </header>
                <div className="mock-exam-meta">
                  <span>총 {questions.length}문항</span>
                  <span>
                    {questions.every((question) =>
                      Number.isFinite(question.points),
                    )
                      ? `총 ${questions.reduce((sum, question) => sum + (question.points || 0), 0)}점`
                      : "100점 만점"}
                  </span>
                </div>
              </>
            ) : (
              <header className="mock-exam-running-title">
                {title} · 역사과
              </header>
            )}
            <div className="mock-exam-columns">
              {page.columns.map((items, column) => (
                <div className="mock-exam-column" key={column}>
                  {items.map((index) => {
                    const question = questions[index];
                    return (
                      <article
                        key={question.id}
                        className={`mock-exam-question ${onQuestionSelect ? "is-interactive" : ""}`}
                        role={onQuestionSelect ? "button" : undefined}
                        tabIndex={onQuestionSelect && !disabled ? 0 : undefined}
                        aria-disabled={disabled || undefined}
                        aria-label={
                          onQuestionSelect
                            ? `${index + 1}번 문제 확대${answers[String(question.id)] ? ", 답안 입력됨" : ""}`
                            : undefined
                        }
                        onClick={() => !disabled && onQuestionSelect?.(index)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (
                            onQuestionSelect &&
                            !disabled &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            onQuestionSelect(index);
                          }
                        }}
                      >
                        <MockExamQuestionContent
                          question={question}
                          index={index}
                          answer={answers[String(question.id)]}
                        />
                        {index < revealed && (
                          <PencilMark
                            correct={checkMap.get(String(question.id)) ?? null}
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
            <footer className="mock-exam-page-number">
              3학년 역사　{pages.length} - {pageIndex + 1}
            </footer>
          </section>
        </div>
      ))}
      {animateGrading && (
        <span className="mock-exam-sr-only" role="status">
          {revealed < questions.length
            ? "채점 결과를 표시하고 있습니다."
            : "채점 결과 표시가 완료되었습니다."}
        </span>
      )}
    </div>
  );
}
