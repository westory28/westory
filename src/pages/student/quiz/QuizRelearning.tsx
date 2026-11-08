import { useEffect, useRef, useState } from "react";
import {
  SHORT_ANSWER_MAX_LENGTH,
  limitShortAnswer,
} from "../../../lib/assessmentAnswerLimits";
import InfoHelp from "../../../components/common/InfoHelp";
import QuizPassage from "../../../components/common/QuizPassage";
import { useQuizContentProtection } from "./useQuizContentProtection";
import QuizQuestionText from "../../../components/common/QuizQuestionText";
import {
  QuizChoiceColumnHeaders,
  QuizChoiceColumnCells,
} from "../../../components/common/QuizChoiceColumns";
import { getQuizChoiceColumnCount } from "../../../lib/quizChoiceColumns";
import type {
  QuizReviewNoteDraft,
  QuizReviewNotes,
} from "../../../lib/quizReviewNotes";
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

const emptyNotes: QuizReviewNotes = { revision: 0, items: [], updatedAt: "" };
const getDraft = (
  questionId: string,
  notes: QuizReviewNotes,
): QuizReviewNoteDraft => {
  const saved = notes.items.find((note) => note.questionId === questionId);
  return {
    questionId,
    practiceAnswer: saved?.practiceAnswer || "",
    reason: saved?.reason || "",
    note: saved?.note || "",
  };
};
const draftKey = (draft: QuizReviewNoteDraft) =>
  JSON.stringify([draft.practiceAnswer, draft.reason, draft.note]);

/** Practice never mutates an assessment; optional reflection saves are explicit. */
export default function QuizRelearning({
  items,
  onClose,
  reviewNotes = emptyNotes,
  onSave,
  onReload,
}: {
  items: QuizRelearningItem[];
  onClose: () => void;
  reviewNotes?: QuizReviewNotes;
  onSave?: (
    draft: QuizReviewNoteDraft,
    expectedRevision: number,
    saveId: string,
  ) => Promise<QuizReviewNotes>;
  onReload?: () => Promise<QuizReviewNotes>;
}) {
  const contentProtectionRef = useRef<HTMLElement>(null);
  useQuizContentProtection(contentProtectionRef);
  const [queue, setQueue] = useState(items);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<"review" | "practice" | "checked">(
    "review",
  );
  const [savedNotes, setSavedNotes] = useState(reviewNotes);
  const [drafts, setDrafts] = useState<Record<string, QuizReviewNoteDraft>>(
    () =>
      Object.fromEntries(
        items.map((item) => [item.id, getDraft(item.id, reviewNotes)]),
      ),
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [reloaded, setReloaded] = useState(false);
  const saveBusy = useRef(false);
  const pendingSave = useRef<{ key: string; saveId: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const item = queue[index];
  const finished = index >= queue.length;
  const draft = item ? drafts[item.id] || getDraft(item.id, savedNotes) : null;
  const answer = draft?.practiceAnswer || "";
  const matching = Object.fromEntries(
    answer
      .split("||")
      .filter(Boolean)
      .map((pair) => pair.split("=>")),
  );
  const dirtyIds = onSave
    ? items
        .filter(
          (entry) =>
            draftKey(drafts[entry.id] || getDraft(entry.id, savedNotes)) !==
            draftKey(getDraft(entry.id, savedNotes)),
        )
        .map((entry) => entry.id)
    : [];
  const dirty = Boolean(item && dirtyIds.includes(item.id));
  const updateDraft = (change: Partial<QuizReviewNoteDraft>) => {
    if (!item) return;
    setDrafts((previous) => ({
      ...previous,
      [item.id]: {
        ...(previous[item.id] || getDraft(item.id, savedNotes)),
        ...change,
      },
    }));
    setSavedMessage("");
  };
  const setAnswer = (practiceAnswer: string) => updateDraft({ practiceAnswer });
  const close = () => {
    if (saveBusy.current) return;
    if (
      dirtyIds.length &&
      !window.confirm(
        "저장하지 않은 오답 노트가 있어요. 저장하지 않고 나갈까요?",
      )
    )
      return;
    onClose();
  };
  useEffect(() => {
    if (!dirtyIds.length) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirtyIds.length]);

  const save = async () => {
    if (!onSave || !draft || !dirty || saveBusy.current) return;
    const submitted = { ...draft };
    const key = JSON.stringify([
      submitted.questionId,
      draftKey(submitted),
      savedNotes.revision,
    ]);
    if (pendingSave.current?.key !== key)
      pendingSave.current = { key, saveId: crypto.randomUUID() };
    saveBusy.current = true;
    setSaving(true);
    setSaveError("");
    setSavedMessage("");
    try {
      const next = await onSave(
        submitted,
        savedNotes.revision,
        pendingSave.current.saveId,
      );
      setSavedNotes(next);
      setDrafts((previous) =>
        draftKey(previous[submitted.questionId]) === draftKey(submitted)
          ? {
              ...previous,
              [submitted.questionId]: getDraft(submitted.questionId, next),
            }
          : previous,
      );
      pendingSave.current = null;
      setConflict(false);
      setReloaded(false);
      setSavedMessage(
        draftKey(draftsRef.current[submitted.questionId]) ===
          draftKey(submitted)
          ? "저장했어요."
          : "이전 내용은 저장했어요. 변경한 내용은 다시 저장해 주세요.",
      );
    } catch (error) {
      const code = (error as { details?: { reason?: string } }).details?.reason;
      const isConflict = code === "QUIZ_REVIEW_REVISION_CONFLICT";
      setConflict(isConflict);
      setSaveError(
        isConflict
          ? "다른 화면에서 노트가 변경됐어요. 저장된 내용을 확인한 뒤 다시 저장해 주세요."
          : code === "QUIZ_REVIEW_SOURCE_UNAVAILABLE"
            ? "이 문제의 원문을 확인할 수 없어 노트를 저장하지 못했어요. 작성한 내용은 유지됩니다."
            : "노트를 저장하지 못했어요. 작성한 내용은 유지됩니다. 연결을 확인한 뒤 다시 저장해 주세요.",
      );
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  };
  const reloadNotes = async () => {
    if (!onReload || saveBusy.current) return;
    saveBusy.current = true;
    setSaving(true);
    setReloading(true);
    try {
      const next = await onReload();
      setDrafts((previous) =>
        Object.fromEntries(
          items.map((entry) => {
            const current =
              previous[entry.id] || getDraft(entry.id, savedNotes);
            return [
              entry.id,
              draftKey(current) === draftKey(getDraft(entry.id, savedNotes))
                ? getDraft(entry.id, next)
                : current,
            ];
          }),
        ),
      );
      setSavedNotes(next);
      setConflict(false);
      setReloaded(true);
      setSaveError("");
      pendingSave.current = null;
    } catch {
      setSaveError(
        "저장된 노트를 불러오지 못했어요. 작성한 내용은 유지됩니다.",
      );
    } finally {
      saveBusy.current = false;
      setSaving(false);
      setReloading(false);
    }
  };

  useEffect(() => {
    headingRef.current?.focus();
  }, [index, stage, finished]);

  const startPractice = () => {
    setStage("practice");
  };
  const advance = () => {
    if (saveBusy.current) return;
    setIndex(index + 1);
    setSaveError("");
    setSavedMessage("");
    setConflict(false);
    setReloaded(false);
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
          {dirtyIds.length > 0 && (
            <button
              type="button"
              className="student-quiz-secondary-action"
              onClick={() => {
                setQueue(items);
                setIndex(items.findIndex((entry) => entry.id === dirtyIds[0]));
                setStage("review");
              }}
            >
              저장하지 않은 노트 {dirtyIds.length}개 확인
            </button>
          )}
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
            onClick={close}
          >
            평가 결과로
          </button>
        </div>
      </section>
    );
  }

  const checked = stage === "checked";
  const reviewing = stage === "review";
  const choiceColumnCount = getQuizChoiceColumnCount(item.options || []);
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
    <section
      ref={contentProtectionRef}
      data-quiz-content-protected
      className="student-quiz-relearning"
      aria-label="오답 복습"
    >
      <div className="student-quiz-relearning-header">
        <h2 ref={headingRef} tabIndex={-1}>
          오답 복습 {index + 1} / {queue.length}
        </h2>
        <InfoHelp label="오답 복습 기록 안내">
          {onSave
            ? "노트 저장을 누르면 연습 답안과 선택한 이유, 작성한 노트를 다음에도 볼 수 있어요. "
            : "연습 답안과 선택한 이유는 이 화면에서만 사용합니다. "}
          평가 점수·응시 횟수·위스에는 반영하지 않습니다.
        </InfoHelp>
        <button
          type="button"
          className="student-quiz-secondary-action"
          onClick={close}
          disabled={saving}
        >
          결과로
        </button>
      </div>
      <article
        className="student-quiz-relearning-question"
        aria-label="복습할 문제"
      >
        <div className="student-quiz-relearning-question-label">
          <strong>{reviewing ? "문제" : "다시 풀기"}</strong>
          {item.concepts.length > 0 && (
            <span className="student-quiz-relearning-concepts">
              {item.concepts.join(" · ")}
            </span>
          )}
        </div>
        <h3>
          <QuizQuestionText value={item.question} />
        </h3>
        {item.passageSet && (
          <section
            className="student-quiz-relearning-shared"
            aria-label="공통 자료"
          >
            {item.passageSet.instruction && (
              <p>{item.passageSet.instruction}</p>
            )}
            {item.passageSet.passage && (
              <QuizPassage value={item.passageSet.passage} surface="white" />
            )}
            {item.passageSet.image && (
              <img
                className="student-quiz-relearning-image"
                src={item.passageSet.image}
                alt="공통 자료 이미지"
              />
            )}
          </section>
        )}
        {item.image && (
          <img
            className="student-quiz-relearning-image"
            src={item.image}
            alt="문항 자료"
          />
        )}
        {item.passage && <QuizPassage value={item.passage} surface="white" />}
        {item.examplePassage && (
          <fieldset className="student-quiz-relearning-example">
            <legend>보기</legend>
            <QuizPassage value={item.examplePassage} surface="white" />
          </fieldset>
        )}
        {reviewing && (item.type === "choice" || item.type === "ox") && (
          <div className="student-quiz-review-options" aria-label="문제의 보기">
            {choiceColumnCount > 1 && (
              <div className="student-quiz-review-options-header">
                <QuizChoiceColumnHeaders count={choiceColumnCount} />
              </div>
            )}
            <ol>
              {(item.type === "ox" ? ["O", "X"] : item.options || []).map(
                (option, optionIndex) => (
                  <li key={`${option}-${optionIndex}`}>
                    <span aria-hidden="true">{optionIndex + 1}.</span>
                    <div>
                      {choiceColumnCount > 1 ? (
                        <QuizChoiceColumnCells value={option} />
                      ) : (
                        <span>{option}</span>
                      )}
                      {item.choiceOptionImages?.[optionIndex] && (
                        <img
                          className="student-quiz-relearning-image"
                          src={item.choiceOptionImages[optionIndex]!}
                          alt={`${optionIndex + 1}번 보기 이미지`}
                        />
                      )}
                    </div>
                  </li>
                ),
              )}
            </ol>
          </div>
        )}
      </article>

      {reviewing ? (
        <>
          <dl
            className="student-quiz-relearning-answers"
            aria-label="제출 답안과 정답"
          >
            <div>
              <dt>제출한 답</dt>
              <dd>
                {item.submittedAnswerAvailable === false
                  ? "제출 답안 미보관"
                  : formatQuizPracticeAnswer(item.submittedAnswer) || "미응답"}
              </dd>
            </div>
            <div className="student-quiz-relearning-correct-answer">
              <dt>정답</dt>
              <dd>{formatQuizPracticeAnswer(item.answer)}</dd>
            </div>
          </dl>
          {(item.explanation || item.reviewLessonId) && (
            <section
              className="student-quiz-relearning-explanation"
              aria-label="해설과 관련 자료"
            >
              <h3>해설</h3>
              {item.explanation && <p>{item.explanation}</p>}
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
            </section>
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
                  checked={draft?.reason === reason}
                  onChange={() => updateDraft({ reason })}
                  onClick={() => {
                    if (draft?.reason === reason) updateDraft({ reason: "" });
                  }}
                />
                {reason}
              </label>
            ))}
          </fieldset>
          {answer && <p>연습한 답: {formatQuizPracticeAnswer(answer)}</p>}
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
              {item.type === "choice" && choiceColumnCount > 1 && (
                <div className="student-quiz-column-header">
                  <QuizChoiceColumnHeaders count={choiceColumnCount} />
                </div>
              )}
              {(item.type === "ox" ? ["O", "X"] : item.options || []).map(
                (option, optionIndex) => (
                  <button
                    type="button"
                    key={`${option}-${optionIndex}`}
                    className={`student-quiz-choice ${choiceColumnCount > 1 ? "student-quiz-column-row" : ""} ${answer === option ? "is-selected" : ""}`}
                    aria-pressed={answer === option}
                    disabled={checked}
                    onClick={() => setAnswer(answer === option ? "" : option)}
                  >
                    {choiceColumnCount > 1 ? (
                      <>
                        <span className="student-quiz-column-number">
                          {optionIndex + 1}
                        </span>
                        <span className="student-quiz-column-content">
                          <QuizChoiceColumnCells value={option} />
                          {item.choiceOptionImages?.[optionIndex] && (
                            <img
                              src={item.choiceOptionImages[optionIndex]!}
                              alt={`${optionIndex + 1}번 보기 이미지`}
                            />
                          )}
                        </span>
                      </>
                    ) : (
                      <>
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
                      </>
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
                maxLength={SHORT_ANSWER_MAX_LENGTH}
                placeholder={`최대 ${SHORT_ANSWER_MAX_LENGTH}자`}
                onChange={(event) =>
                  setAnswer(limitShortAnswer(event.target.value))
                }
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
              {item.explanation && (
                <div className="student-quiz-relearning-checked-explanation">
                  <strong>해설</strong>
                  <p>{item.explanation}</p>
                </div>
              )}
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
                    [item.id]: isQuizPracticeAnswerCorrect(
                      answer,
                      item.answer,
                      item.type,
                    ),
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
      {onSave && draft && (
        <div className="student-quiz-review-note">
          <label htmlFor="quiz-review-note-text">오답 노트</label>
          <textarea
            id="quiz-review-note-text"
            rows={4}
            maxLength={1000}
            value={draft.note}
            onChange={(event) => updateDraft({ note: event.target.value })}
          />
          <span className="student-quiz-review-note-count">
            {draft.note.length} / 1000자
          </span>
          {reloaded && (
            <div className="student-quiz-review-note-latest" role="status">
              <strong>다른 화면에서 저장한 내용</strong>
              <p>
                {getDraft(item.id, savedNotes).reason || "선택한 이유 없음"}
              </p>
              <p>{getDraft(item.id, savedNotes).note || "작성한 노트 없음"}</p>
              <p>
                연습한 답:{" "}
                {formatQuizPracticeAnswer(
                  getDraft(item.id, savedNotes).practiceAnswer,
                ) || "미작성"}
              </p>
            </div>
          )}
          {saveError && <p role="alert">{saveError}</p>}
          {savedMessage && <p role="status">{savedMessage}</p>}
          <div className="student-quiz-relearning-actions">
            {conflict && onReload && (
              <button
                type="button"
                className="student-quiz-secondary-action"
                disabled={saving}
                onClick={() => void reloadNotes()}
              >
                저장된 노트 다시 불러오기
              </button>
            )}
            <button
              type="button"
              className="student-quiz-primary-action"
              disabled={saving || !dirty || conflict}
              onClick={() => void save()}
            >
              {saving
                ? reloading
                  ? "불러오는 중…"
                  : "저장 중…"
                : saveError && !conflict
                  ? "다시 저장"
                  : "노트 저장"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
