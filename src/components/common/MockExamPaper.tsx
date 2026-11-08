import React, {
  useEffect,
  useId,
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
import {
  getMockExamPaperTitle,
  normalizeMockExamPaperHeader,
  type MockExamPaperHeaderSettings,
} from "../../lib/mockExamPaperHeader";
import {
  formatMockExamChoiceLabel,
  getMockExamChoiceColumns,
} from "../../lib/mockExamChoiceLayout";
import {
  getMockExamSetRun,
  type MockExamPassageSet,
} from "../../lib/mockExamMaterials";
import "./mockExamPaper.css";

export interface MockExamPaperQuestion {
  id: string | number;
  type: string;
  question: string;
  options?: string[];
  choiceOptionImages?: Array<string | null>;
  image?: string | null;
  passage?: string | null;
  examplePassage?: string | null;
  passageSet?: MockExamPassageSet | null;
  examRound?: string;
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

export function MockExamAnswerCheck() {
  const maskId = useId();
  return (
    <svg
      className="mock-exam-answer-check"
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="36"
          height="36"
        >
          <path
            className="mock-exam-answer-check-reveal"
            d="M6 19L14 28L31 5"
            pathLength="100"
          />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <path className="mock-exam-answer-check-ink" d="M7 18L14 27L30 5" />
        <path className="mock-exam-answer-check-grain" d="M6 20L13 29L31 7" />
        <path className="mock-exam-answer-check-grain" d="M8 19L14 26L29 6" />
      </g>
    </svg>
  );
}

function ApprovalStamp({ role }: { role: string }) {
  const royal = role === "왕";
  return (
    <svg
      className={`mock-exam-stamp${royal ? " mock-exam-stamp--royal" : ""}`}
      viewBox="0 0 56 56"
      role="img"
      aria-label={`${role} 도장`}
    >
      {royal ? (
        <>
          <path d="M7 6L50 7L49 50L6 49Z M11 11L45 11L45 45L11 45Z" />
          <g className="mock-exam-seal-letters">
            <text x="20" y="25">
              國
            </text>
            <text x="36" y="25">
              王
            </text>
            <text x="20" y="41">
              之
            </text>
            <text x="36" y="41">
              印
            </text>
          </g>
        </>
      ) : (
        <>
          <ellipse cx="28" cy="28" rx={role === "양반" ? 22 : 20} ry="22" />
          <ellipse cx="28" cy="28" rx={role === "양반" ? 18 : 16} ry="18" />
          <text x="28" y="33">
            {role}
          </text>
        </>
      )}
      <path
        className="mock-exam-stamp-wear"
        d="M5 16L42 12M14 37L51 32M8 45L24 42M30 6L33 50"
      />
    </svg>
  );
}

export function MockExamPaperHeader({
  round,
  settings,
  studentLabel = "3학년　　반　　번　 이름:",
  score,
}: {
  round?: unknown;
  settings?: MockExamPaperHeaderSettings;
  studentLabel?: string;
  score?: number | null;
}) {
  const title = getMockExamPaperTitle(round, settings);
  const heading = normalizeMockExamPaperHeader(settings).paperHeading;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const fit = () => {
      if (!element.clientWidth) return;
      element.style.fontSize = "24px";
      const ratio = Math.min(1, element.clientWidth / element.scrollWidth);
      element.style.fontSize = `${24 * ratio}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (element.parentElement) observer.observe(element.parentElement);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [title]);
  return (
    <>
      <div className="mock-exam-cover-line">
        {heading && <p className="mock-exam-paper-heading">{heading}</p>}
        {score != null && (
          <strong
            className="mock-exam-score"
            aria-label={`점수 ${score}점, 100점 만점`}
          >
            {score}
            <small>/100</small>
          </strong>
        )}
        <table className="mock-exam-approval" aria-label="시험지 결재란">
          <thead>
            <tr>
              {["노비", "상민", "양반", "왕"].map((role) => (
                <th key={role} scope="col">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {["노비", "상민", "양반", "왕"].map((role) => (
                <td key={role}>
                  <ApprovalStamp role={role} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <header className="mock-exam-title-box">
        <h2 ref={titleRef}>{title}</h2>
        <p className="mock-exam-student">{studentLabel}</p>
      </header>
    </>
  );
}

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
  showPassageSet = true,
  setQuestionRange,
  gradingMark,
}: {
  question: MockExamPaperQuestion;
  index: number;
  answer?: string;
  hideAnswers?: boolean;
  showPassageSet?: boolean;
  setQuestionRange?: [number, number];
  gradingMark?: React.ReactNode;
}) {
  const options = question.type === "ox" ? ["O", "X"] : question.options || [];
  const choiceColumns = getMockExamChoiceColumns(
    options,
    question.choiceOptionImages,
  );
  return (
    <div className="mock-exam-question-ink">
      {showPassageSet && question.passageSet && (
        <MockExamSetPassage
          value={question.passageSet}
          questionRange={setQuestionRange}
        />
      )}
      <p className="mock-exam-stem">
        {gradingMark}
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
      {question.examplePassage?.trim() && (
        <fieldset className="mock-exam-example">
          <legend>&lt;보기&gt;</legend>
          <QuizPassage
            value={question.examplePassage}
            className="mock-exam-passage"
          />
        </fieldset>
      )}
      {!hideAnswers && options.length > 0 && (
        <ol className={`mock-exam-options mock-exam-options--${choiceColumns}`}>
          {options.map((option, optionIndex) => (
            <li
              key={optionIndex}
              className={answer === option ? "is-selected" : ""}
            >
              <span className="mock-exam-option-number">
                {examChoiceNumber(optionIndex)}{" "}
                {answer === option && <MockExamAnswerCheck />}
              </span>
              <span className="mock-exam-option-text">
                {formatMockExamChoiceLabel(option)}
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

export function MockExamSetPassage({
  value,
  questionRange,
}: {
  value: MockExamPassageSet;
  questionRange?: [number, number];
}) {
  return (
    <section className="mock-exam-set-passage" aria-label="공통 지문">
      <p className="mock-exam-set-instruction">
        {questionRange && (
          <strong>
            [{questionRange[0]}
            {questionRange[0] !== questionRange[1]
              ? `~${questionRange[1]}`
              : ""}
            ]{" "}
          </strong>
        )}
        {value.instruction || "다음 자료를 읽고 물음에 답하시오."}
      </p>
      {value.passage && (
        <QuizPassage value={value.passage} className="mock-exam-passage" />
      )}
      {value.image && (
        <MockExamImage
          src={value.image}
          alt="공통 지문 자료"
          className="mock-exam-image"
        />
      )}
    </section>
  );
}

function PencilMark({
  correct,
  animate = false,
}: {
  correct: boolean | null;
  animate?: boolean;
}) {
  const maskId = useId();
  if (correct == null) return null;
  const stroke = correct
    ? "M59 12C41 2 17 8 10 29C1 53 20 72 43 70C64 69 76 48 70 29C67 17 57 9 47 8"
    : "M63 9C54 24 43 38 34 49L17 70";
  return (
    <span
      className={`mock-exam-pencil ${correct ? "is-correct" : "is-incorrect"} ${animate ? "is-drawing" : ""}`}
      role="img"
      aria-label={correct ? "정답" : "오답"}
    >
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="80"
            height="80"
          >
            <path
              className="mock-exam-pencil-reveal"
              d={stroke}
              pathLength="100"
            />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <path className="mock-exam-pencil-core" d={stroke} />
          <path
            className="mock-exam-pencil-grain"
            d={stroke}
            transform="translate(0.8 -0.7)"
          />
          <path
            className="mock-exam-pencil-grain is-light"
            d={stroke}
            transform="translate(-0.9 0.8)"
          />
          <path className="mock-exam-pencil-fiber" d={stroke} />
        </g>
      </svg>
    </span>
  );
}

type PaperPage = { columns: number[][]; height: number };
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const QUESTION_GAPS = [12, 10, 8];
const FOOTER_GAP = 16;

export default function MockExamPaper({
  questions,
  answers = {},
  round = "round_1",
  studentLabel = "3학년　　반　　번　 이름:",
  paperHeader,
  score,
  checks = [],
  onQuestionSelect,
  selectedQuestionId,
  animateGrading = false,
  onGradingComplete,
  fit = "default",
  availableHeight,
  disabled = false,
}: {
  questions: MockExamPaperQuestion[];
  answers?: Record<string, string>;
  round?: unknown;
  studentLabel?: string;
  paperHeader?: MockExamPaperHeaderSettings;
  score?: number | null;
  checks?: MockExamPaperCheck[];
  onQuestionSelect?: (index: number) => void;
  selectedQuestionId?: string | number | null;
  animateGrading?: boolean;
  onGradingComplete?: () => void;
  fit?: "default" | "width" | "page";
  availableHeight?: number;
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const measurements = useRef<HTMLDivElement>(null);
  const instructions = useRef<HTMLElement>(null);
  const firstSheet = useRef<HTMLElement>(null);
  const firstColumns = useRef<HTMLDivElement>(null);
  const firstFooter = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(PAGE_WIDTH);
  const [heights, setHeights] = useState<number[]>([]);
  const [density, setDensity] = useState(0);
  const [measuredDensity, setMeasuredDensity] = useState(-1);
  const questionGap = QUESTION_GAPS[density];
  const paperIdentity = questions
    .map((question) => String(question.id))
    .join("|");
  const [instructionsHeight, setInstructionsHeight] = useState(120);
  const [pageLayout, setPageLayout] = useState({
    firstTop: 194,
    laterTop: 116,
    footerReserve: 90,
  });
  const [lastSelectedId, setLastSelectedId] = useState<string | number | null>(
    null,
  );
  const selection =
    selectedQuestionId === undefined ? lastSelectedId : selectedQuestionId;
  const selectQuestion = (index: number) => {
    if (disabled || !gradingComplete || !onQuestionSelect) return;
    setLastSelectedId(questions[index].id);
    onQuestionSelect(index);
  };
  const gradingKey = animateGrading
    ? JSON.stringify([
        paperIdentity,
        score,
        checks.map((check) => [check.id, check.correct]),
      ])
    : "";
  const [grading, setGrading] = useState({ key: "", index: 0, drawing: false });
  const gradingIndex = grading.key === gradingKey ? grading.index : 0;
  const gradingComplete = !animateGrading || gradingIndex >= questions.length;
  const gradingDrawing = grading.key === gradingKey && grading.drawing;
  const layoutReady =
    measuredDensity === density && heights.length === questions.length;
  const title = getMockExamPaperTitle(round, paperHeader);
  const totalPoints = Number(
    questions
      .reduce(
        (sum, question) =>
          sum + (Number.isFinite(question.points) ? question.points! : 1),
        0,
      )
      .toFixed(2),
  );
  const questionGroups = [
    {
      label: "선다형",
      types: ["choice", "ox"],
      instruction: "물음에 알맞은 답 하나를 골라 해당 보기를 선택하시오.",
    },
    {
      label: "단답형",
      types: ["short", "word"],
      instruction: "물음에 알맞은 답을 답안 입력칸에 작성하시오.",
    },
    {
      label: "순서형",
      types: ["order"],
      instruction: "보기를 알맞은 순서대로 선택하시오.",
    },
    {
      label: "연결형",
      types: ["matching"],
      instruction: "각 항목에 알맞은 답을 선택하시오.",
    },
  ]
    .map((group) => {
      const items = questions.filter((question) =>
        group.types.includes(question.type),
      );
      return {
        ...group,
        count: items.length,
        points: Number(
          items
            .reduce(
              (sum, question) =>
                sum + (Number.isFinite(question.points) ? question.points! : 1),
              0,
            )
            .toFixed(2),
        ),
      };
    })
    .filter((group, index) => index < 2 || group.count > 0);
  const checkMap = useMemo(
    () => new Map(checks.map((check) => [String(check.id), check.correct])),
    [checks],
  );

  useLayoutEffect(() => {
    setDensity(0);
    setMeasuredDensity(-1);
  }, [paperIdentity]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = instructions.current;
    if (!element) return;
    const update = () => {
      if (element.offsetWidth > 0)
        setInstructionsHeight(
          element.offsetHeight +
            parseFloat(getComputedStyle(element).marginBottom),
        );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const sheet = firstSheet.current;
    const columns = firstColumns.current;
    const footer = firstFooter.current;
    if (!sheet || !columns || !footer) return;
    let active = true;
    const update = () => {
      if (!active || sheet.offsetWidth === 0) return;
      const sheetStyle = getComputedStyle(sheet);
      const next = {
        firstTop: columns.offsetTop,
        laterTop:
          parseFloat(sheetStyle.paddingTop) +
          parseFloat(
            sheetStyle.getPropertyValue("--mock-exam-running-title-height"),
          ),
        footerReserve:
          footer.offsetHeight +
          parseFloat(getComputedStyle(footer).bottom) +
          FOOTER_GAP,
      };
      setPageLayout((previous) =>
        previous.firstTop === next.firstTop &&
        previous.laterTop === next.laterTop &&
        previous.footerReserve === next.footerReserve
          ? previous
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    Array.from(sheet.children).forEach((node) => observer.observe(node));
    void document.fonts.ready.then(update);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const element = measurements.current;
    if (!element) return;
    let active = true;
    const update = () => {
      if (!active || element.offsetWidth === 0) return;
      const next = Array.from(element.children).map((node) =>
        Math.ceil((node as HTMLElement).offsetHeight),
      );
      setHeights((previous) =>
        previous.join() === next.join() ? previous : next,
      );
      if (
        document.fonts.status === "loaded" &&
        Array.from(element.querySelectorAll("img")).every(
          (image) => image.complete,
        )
      ) {
        setMeasuredDensity(density);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    Array.from(element.children).forEach((node) => observer.observe(node));
    void document.fonts.ready.then(update);
    element.addEventListener("load", update, true);
    element.addEventListener("error", update, true);
    return () => {
      active = false;
      observer.disconnect();
      element.removeEventListener("load", update, true);
      element.removeEventListener("error", update, true);
    };
  }, [questions, answers, density]);
  useEffect(() => {
    setGrading({ key: gradingKey, index: 0, drawing: false });
  }, [gradingKey]);
  useEffect(() => {
    if (!gradingKey || grading.key !== gradingKey || !layoutReady) return;
    if (grading.index >= questions.length) {
      if (onGradingComplete) onGradingComplete();
      else
        firstSheet.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
      return;
    }
    // Scroll the actual paper (including nested/fullscreen scroll containers),
    // then draw one server-supplied result. No grading or persistence occurs here.
    if (!grading.drawing) {
      container.current
        ?.querySelector<HTMLElement>(
          `[data-question-index="${grading.index}"] .mock-exam-stem`,
        )
        ?.scrollIntoView({ block: "center", behavior: "instant" });
    }
    const timer = window.setTimeout(
      () => {
        setGrading((previous) =>
          grading.drawing
            ? { ...previous, index: previous.index + 1, drawing: false }
            : { ...previous, drawing: true },
        );
      },
      grading.drawing ? 900 : 160,
    );
    return () => window.clearTimeout(timer);
  }, [grading, gradingKey, layoutReady, questions.length, onGradingComplete]);

  const pages = useMemo(() => {
    const output: PaperPage[] = [{ columns: [[], []], height: PAGE_HEIGHT }];
    let column = 0,
      used = instructionsHeight;
    for (let index = 0; index < questions.length; ) {
      const run = getMockExamSetRun(questions, index);
      const last = run?.end ?? index;
      let page = output[output.length - 1];
      const room =
        PAGE_HEIGHT -
        (output.length === 1 ? pageLayout.firstTop : pageLayout.laterTop) -
        pageLayout.footerReserve;
      const height =
        Array.from(
          { length: last - index + 1 },
          (_, i) => heights[index + i] || 260,
        ).reduce((sum, value) => sum + value, 0) +
        questionGap * (last - index);
      if (
        page.columns[column].length > 0 &&
        used + questionGap + height > room
      ) {
        if (column === 0) column = 1;
        else {
          output.push({ columns: [[], []], height: PAGE_HEIGHT });
          column = 0;
        }
        used = 0;
      }
      page = output[output.length - 1];
      if (page.columns[column].length > 0) used += questionGap;
      for (let i = index; i <= last; i++) page.columns[column].push(i);
      used += height;
      page.height = Math.max(
        page.height,
        used +
          (output.length === 1 ? pageLayout.firstTop : pageLayout.laterTop) +
          pageLayout.footerReserve,
      );
      index = last + 1;
    }
    return output;
  }, [questions, heights, instructionsHeight, pageLayout, questionGap]);
  useLayoutEffect(() => {
    // Compact only when the actual first five questions need it. Measurement
    // uses the same typography/images as the paper; never crop content or
    // shrink text below 12px to force an unusually long passage onto A4.
    if (
      questions.length < 5 ||
      measuredDensity !== density ||
      heights.length !== questions.length ||
      density >= QUESTION_GAPS.length - 1
    )
      return;
    if (pages[0].columns.flat().length < 5) {
      setMeasuredDensity(-1);
      setDensity((previous) => previous + 1);
    }
  }, [pages, questions.length, heights.length, measuredDensity, density]);
  const pageScale = (height: number) =>
    Math.max(
      0.05,
      Math.min(
        width / PAGE_WIDTH,
        fit === "page" && availableHeight ? availableHeight / height : Infinity,
      ),
    );
  return (
    <div
      ref={container}
      className="mock-exam-paper"
      data-fit={fit}
      data-density={density}
      data-grading-state={
        animateGrading ? (gradingComplete ? "complete" : "grading") : undefined
      }
      data-grading-question={
        animateGrading && !gradingComplete ? gradingIndex + 1 : undefined
      }
      aria-busy={(animateGrading && !gradingComplete) || undefined}
      aria-label={`${title} 시험지`}
    >
      <div ref={measurements} className="mock-exam-measure" aria-hidden="true">
        {questions.map((question, index) => (
          <div key={question.id} className="mock-exam-question">
            <MockExamQuestionContent
              question={question}
              index={index}
              answer={answers[String(question.id)]}
              showPassageSet={
                getMockExamSetRun(questions, index)?.start === index
              }
              setQuestionRange={
                question.passageSet
                  ? [
                      index + 1,
                      (getMockExamSetRun(questions, index)?.end ?? index) + 1,
                    ]
                  : undefined
              }
            />
          </div>
        ))}
      </div>
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="mock-exam-sheet-space"
          style={{
            width: PAGE_WIDTH * pageScale(page.height),
            height: page.height * pageScale(page.height),
          }}
        >
          <section
            ref={pageIndex === 0 ? firstSheet : undefined}
            className="mock-exam-sheet"
            aria-label={`${pageIndex + 1}쪽`}
            style={{
              width: PAGE_WIDTH,
              minHeight: page.height,
              transform: `scale(${pageScale(page.height)})`,
            }}
          >
            {pageIndex === 0 ? (
              <MockExamPaperHeader
                round={round}
                settings={paperHeader}
                studentLabel={studentLabel}
                score={gradingComplete ? score : null}
              />
            ) : (
              <header className="mock-exam-running-title">{title}</header>
            )}
            <div
              ref={pageIndex === 0 ? firstColumns : undefined}
              className="mock-exam-columns"
              style={{
                minHeight:
                  page.height -
                  (pageIndex === 0
                    ? pageLayout.firstTop
                    : pageLayout.laterTop) -
                  pageLayout.footerReserve,
              }}
            >
              {page.columns.map((items, column) => (
                <div className="mock-exam-column" key={column}>
                  {pageIndex === 0 && column === 0 && (
                    <aside
                      ref={instructions}
                      className="mock-exam-instructions"
                      aria-label="시험 안내사항"
                    >
                      <h3>시험 안내사항</h3>
                      <ol>
                        <li>문제지가 총 {pages.length}쪽인지 확인하시오.</li>
                        <li>
                          화면에 표시된 학년, 반, 번호, 이름과 과목을
                          확인하시오.
                        </li>
                        <li>
                          답안은 다음과 같은 방식으로 작성하시오.
                          <ul>
                            {questionGroups.map((group) => (
                              <li key={group.label}>
                                {group.label}: {group.instruction}
                              </li>
                            ))}
                          </ul>
                          제출 전까지 답안을 수정할 수 있습니다.
                        </li>
                        <li>
                          <strong>
                            배점: 총 {questions.length}문항 · 총 {totalPoints}점
                          </strong>
                          <ul>
                            {questionGroups.map((group) => (
                              <li key={group.label}>
                                {group.label}: {group.count}문항 · 총{" "}
                                {group.points}점
                              </li>
                            ))}
                          </ul>
                        </li>
                      </ol>
                    </aside>
                  )}
                  {items.map((index) => {
                    const question = questions[index];
                    return (
                      <article
                        key={question.id}
                        data-question-index={index}
                        className={`mock-exam-question ${onQuestionSelect ? "is-interactive" : ""} ${selection != null && String(selection) === String(question.id) ? "is-current" : ""}`}
                        role={onQuestionSelect ? "button" : undefined}
                        tabIndex={
                          onQuestionSelect && !disabled && gradingComplete
                            ? 0
                            : undefined
                        }
                        aria-disabled={
                          disabled || !gradingComplete || undefined
                        }
                        aria-pressed={
                          onQuestionSelect
                            ? selection != null &&
                              String(selection) === String(question.id)
                            : undefined
                        }
                        aria-label={
                          onQuestionSelect
                            ? `${index + 1}번 문제 확대${answers[String(question.id)] ? ", 답안 입력됨" : ""}`
                            : undefined
                        }
                        onClick={() => selectQuestion(index)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (
                            onQuestionSelect &&
                            !disabled &&
                            gradingComplete &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            selectQuestion(index);
                          }
                        }}
                      >
                        <MockExamQuestionContent
                          question={question}
                          index={index}
                          gradingMark={
                            (gradingComplete ||
                              index < gradingIndex ||
                              (index === gradingIndex && gradingDrawing)) && (
                              <PencilMark
                                correct={
                                  checkMap.get(String(question.id)) ?? null
                                }
                                animate={
                                  animateGrading &&
                                  index === gradingIndex &&
                                  gradingDrawing
                                }
                              />
                            )
                          }
                          answer={answers[String(question.id)]}
                          showPassageSet={
                            getMockExamSetRun(questions, index)?.start === index
                          }
                          setQuestionRange={
                            question.passageSet
                              ? [
                                  index + 1,
                                  (getMockExamSetRun(questions, index)?.end ??
                                    index) + 1,
                                ]
                              : undefined
                          }
                        />
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
            <footer
              ref={pageIndex === 0 ? firstFooter : undefined}
              className="mock-exam-page-number"
            >
              <div>
                3학년 역사　{pages.length} - {pageIndex + 1}
              </div>
              <div className="mock-exam-copyright">
                <p>이 시험문제의 저작권은 위스토리에 있습니다.</p>
                <p>
                  저작권법에 보호받는 저작물이므로 무단 전재 및 복제는 금지되며,
                  이를 어길 시 저작권법에 의거해 처벌될 수 있습니다.
                </p>
              </div>
            </footer>
          </section>
        </div>
      ))}
      {animateGrading && (
        <span className="mock-exam-sr-only" role="status">
          {gradingComplete
            ? `채점 완료. ${score ?? ""}점입니다.`
            : `${gradingIndex + 1}번 문항 채점 중`}
        </span>
      )}
    </div>
  );
}
