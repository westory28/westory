import { useEffect, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import QuizPassage from "../../../components/common/QuizPassage";
import QuizQuestionText from "../../../components/common/QuizQuestionText";
import {
  encodeQuizPracticeMatching,
  formatQuizPracticeAnswer,
  getQuizPracticeOrderOptions,
  getQuizPracticePairs,
  isQuizPracticeAnswerCorrect,
  type QuizRelearningItem,
} from "./quizPracticeData";

const reflectionReasons = [
  "개념이 헷갈렸어요",
  "자료의 근거를 놓쳤어요",
  "답을 잘못 입력했어요",
];

/** Local practice only: no assessment mutation, reward or network dependency. */
export default function QuizRelearning({
  items,
  onClose,
}: {
  items: QuizRelearningItem[];
  onClose: () => void;
}) {
  const [queue, setQueue] = useState(items);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<"review" | "practice" | "checked">(
    "review",
  );
  const [answer, setAnswer] = useState("");
  const [matching, setMatching] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const item = queue[index];
  const finished = index >= queue.length;

  useEffect(() => {
    headingRef.current?.focus();
  }, [index, stage, finished]);

  const startPractice = () => {
    setAnswer("");
    setMatching({});
    setStage("practice");
  };
  const advance = () => {
    setIndex(index + 1);
    setAnswer("");
    setMatching({});
    setStage("review");
  };

  if (finished) {
    const remaining = items.filter((entry) => results[entry.id] !== true);
    const concepts = [...new Set(remaining.flatMap((entry) => entry.concepts))];
    return (
      <section className="student-quiz-relearning" aria-label="오답 복습 결과">
        <h2 ref={headingRef} tabIndex={-1}>
          이번 복습 결과
        </h2>
        <p className="student-quiz-result-count" role="status">
          다시 맞힌 문제 <strong>{items.length - remaining.length}</strong> /{" "}
          {items.length}문제
        </p>
        {remaining.length > 0 ? (
          <p>
            아직 확인할 문제 {remaining.length}개
            {concepts.length ? ` · ${concepts.join(" · ")}` : ""}
          </p>
        ) : (
          <p>이번 오답을 모두 다시 맞혔어요.</p>
        )}
        <div className="student-quiz-relearning-actions">
          {remaining.length > 0 && (
            <button
              type="button"
              className="student-quiz-primary-action"
              onClick={() => {
                setQueue(remaining);
                setIndex(0);
                setStage("review");
              }}
            >
              남은 오답 다시 확인
            </button>
          )}
          <button
            type="button"
            className={
              remaining.length
                ? "student-quiz-secondary-action"
                : "student-quiz-primary-action"
            }
            onClick={onClose}
          >
            평가 결과로
          </button>
        </div>
      </section>
    );
  }

  const checked = stage === "checked";
  const reviewing = stage === "review";
  const order = answer ? answer.split("||") : [];
  const pairs = item.type === "matching" ? getQuizPracticePairs(item) : [];
  const rightChoices = [...pairs].sort((a, b) =>
    a.right.localeCompare(b.right, "ko"),
  );
  const complete =
    item.type === "matching"
      ? pairs.every((pair) => Boolean(matching[pair.left]))
      : item.type === "order"
        ? order.length === getQuizPracticeOrderOptions(item).length
        : Boolean(answer.trim());

  return (
    <section className="student-quiz-relearning" aria-label="오답 복습">
      <div className="student-quiz-relearning-header">
        <h2 ref={headingRef} tabIndex={-1}>
          오답 복습 {index + 1} / {queue.length}
        </h2>
        <InfoHelp label="오답 복습 기록 안내">
          이번 제출에서 틀린 문제를 연습합니다. 연습 답안과 선택한 이유는 이
          화면에서만 사용하며, 평가 점수·응시 횟수·위스에는 반영하지 않습니다.
        </InfoHelp>
        <button
          type="button"
          className="student-quiz-secondary-action"
          onClick={onClose}
        >
          결과로
        </button>
      </div>
      <p className="student-quiz-relearning-stage">
        {reviewing ? "1. 해설과 근거 확인" : "2. 해설 없이 다시 풀기"}
      </p>
      {item.concepts.length > 0 && (
        <p className="student-quiz-relearning-concepts">
          {item.concepts.join(" · ")}
        </p>
      )}
      <h3>
        <QuizQuestionText value={item.question} />
      </h3>
      {item.image && (
        <img
          className="student-quiz-relearning-image"
          src={item.image}
          alt="문항 자료"
        />
      )}
      {item.passage && <QuizPassage value={item.passage} surface="white" />}

      {reviewing ? (
        <>
          <dl className="student-quiz-relearning-answers">
            <div>
              <dt>제출한 답</dt>
              <dd>
                {item.submittedAnswerAvailable === false
                  ? "제출 답안 미보관"
                  : formatQuizPracticeAnswer(item.submittedAnswer) || "미응답"}
              </dd>
            </div>
            <div>
              <dt>정답</dt>
              <dd>{formatQuizPracticeAnswer(item.answer)}</dd>
            </div>
          </dl>
          {item.explanation && (
            <div className="student-quiz-relearning-explanation">
              <strong>해설</strong>
              <p>{item.explanation}</p>
            </div>
          )}
          {item.reviewLessonId && (
            <a
              className="student-quiz-secondary-action"
              href={`#/student/lesson/note?id=${encodeURIComponent(item.reviewLessonId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              관련 수업자료 열기 <span className="sr-only">(새 탭)</span>
            </a>
          )}
          <fieldset className="student-quiz-relearning-reflection">
            <legend>
              어디에서 막혔나요? <span>(선택)</span>
            </legend>
            {reflectionReasons.map((reason) => (
              <label key={reason}>
                <input
                  type="radio"
                  name={`reflection-${item.id}`}
                  checked={reasons[item.id] === reason}
                  onChange={() =>
                    setReasons((previous) => ({
                      ...previous,
                      [item.id]: reason,
                    }))
                  }
                />
                {reason}
              </label>
            ))}
          </fieldset>
          <div className="student-quiz-relearning-actions">
            <button
              type="button"
              className="student-quiz-primary-action"
              onClick={startPractice}
            >
              해설 가리고 다시 풀기
            </button>
          </div>
        </>
      ) : (
        <>
          {(item.type === "choice" || item.type === "ox") && (
            <div
              className="student-quiz-choice-list"
              role="group"
              aria-label="연습 답안 선택"
            >
              {(item.type === "ox" ? ["O", "X"] : item.options || []).map(
                (option, optionIndex) => (
                  <button
                    type="button"
                    key={`${option}-${optionIndex}`}
                    className={`student-quiz-choice ${answer === option ? "is-selected" : ""}`}
                    aria-pressed={answer === option}
                    disabled={checked}
                    onClick={() => setAnswer(option)}
                  >
                    <span>
                      {item.type === "choice" ? `${optionIndex + 1}. ` : ""}
                      {option}
                    </span>
                    {item.choiceOptionImages?.[optionIndex] && (
                      <img
                        src={item.choiceOptionImages[optionIndex]!}
                        alt={`${optionIndex + 1}번 보기 이미지`}
                      />
                    )}
                  </button>
                ),
              )}
            </div>
          )}
          {(item.type === "short" || item.type === "word") && (
            <label className="student-quiz-relearning-input">
              연습 답안
              <input
                className="student-quiz-text-answer"
                value={answer}
                disabled={checked}
                maxLength={20000}
                onChange={(event) => setAnswer(event.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          {item.type === "order" && (
            <div
              className="student-quiz-choice-list"
              role="group"
              aria-label="순서대로 선택"
            >
              {getQuizPracticeOrderOptions(item).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="student-quiz-choice"
                  disabled={checked || order.includes(option)}
                  onClick={() => setAnswer([...order, option].join("||"))}
                >
                  {option}
                </button>
              ))}
              <p aria-live="polite">
                선택한 순서:{" "}
                {formatQuizPracticeAnswer(answer) || "아직 선택하지 않았어요"}
              </p>
              <button
                type="button"
                className="student-quiz-secondary-action"
                disabled={checked || !answer}
                onClick={() => setAnswer("")}
              >
                순서 다시 선택
              </button>
            </div>
          )}
          {item.type === "matching" && (
            <div className="student-quiz-relearning-matching">
              {pairs.map((pair) => (
                <label key={pair.left}>
                  <span>{pair.left}</span>
                  <select
                    aria-label={`${pair.left}에 연결할 답`}
                    disabled={checked}
                    value={matching[pair.left] || ""}
                    onChange={(event) => {
                      const selected = event.target.value;
                      const next = { ...matching, [pair.left]: selected };
                      for (const left of Object.keys(next))
                        if (
                          left !== pair.left &&
                          selected &&
                          next[left] === selected
                        )
                          next[left] = "";
                      setMatching(next);
                      setAnswer(encodeQuizPracticeMatching(item, next));
                    }}
                  >
                    <option value="">선택하세요</option>
                    {rightChoices.map((right) => (
                      <option key={right.right} value={right.right}>
                        {right.right}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {rightChoices.some((right) => right.rightImage) && (
                <div className="student-quiz-relearning-matching-images">
                  {rightChoices
                    .filter((right) => right.rightImage)
                    .map((right) => (
                      <figure key={right.right}>
                        <img src={right.rightImage!} alt={right.right} />
                        <figcaption>{right.right}</figcaption>
                      </figure>
                    ))}
                </div>
              )}
            </div>
          )}
          {checked && (
            <div className="student-quiz-relearning-feedback" role="status">
              <strong>
                {results[item.id]
                  ? "다시 맞혔어요."
                  : "정답과 근거를 한 번 더 확인해 보세요."}
              </strong>
              {!results[item.id] && (
                <p>정답: {formatQuizPracticeAnswer(item.answer)}</p>
              )}
              {item.explanation && <p>{item.explanation}</p>}
            </div>
          )}
          <div className="student-quiz-relearning-actions">
            {checked ? (
              <button
                type="button"
                className="student-quiz-primary-action"
                onClick={advance}
              >
                {index + 1 < queue.length ? "다음 오답" : "복습 결과 확인"}
              </button>
            ) : (
              <button
                type="button"
                className="student-quiz-primary-action"
                disabled={!complete}
                onClick={() => {
                  setResults((previous) => ({
                    ...previous,
                    [item.id]: isQuizPracticeAnswerCorrect(answer, item.answer),
                  }));
                  setStage("checked");
                }}
              >
                답 확인
              </button>
            )}
            {!checked && (
              <button
                type="button"
                className="student-quiz-secondary-action"
                onClick={() => setStage("review")}
              >
                해설 다시 보기
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
