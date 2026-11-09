import { useEffect, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import { MockExamQuestionContent } from "../../../components/common/MockExamPaper";
import MockExamAnswerControls from "../../../components/common/MockExamAnswerControls";
import { useQuizContentProtection } from "./useQuizContentProtection";
import "./QuizNotebook.css";
import type {
  QuizReviewNoteDraft,
  QuizReviewNotes,
} from "../../../lib/quizReviewNotes";
import {
  formatQuizPracticeAnswer,
  getQuizPracticeOrderOptions,
  getQuizPracticePairs,
  isQuizPracticeAnswerCorrect,
  type QuizRelearningItem,
} from "./quizPracticeData";

const reflectionReasons = [
  "실수했어요",
  "몰랐어요",
  "잘못 읽었어요",
  "찍었어요",
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
  onShowAnswers,
  questionNumbers,
  closeLabel = "결과로",
}: {
  items: QuizRelearningItem[];
  onClose: () => void;
  onShowAnswers?: () => void;
  questionNumbers?: Record<string, number>;
  closeLabel?: string;
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
  const leave = (action: () => void) => {
    if (saveBusy.current) return;
    if (
      dirtyIds.length &&
      !window.confirm(
        "저장하지 않은 오답 노트가 있어요. 저장하지 않고 나갈까요?",
      )
    )
      return;
    action();
  };
  const close = () => leave(onClose);
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
            {closeLabel === "결과로" ? "평가 결과로" : closeLabel}
          </button>
        </div>
      </section>
    );
  }

  const checked = stage === "checked";
  const reviewing = stage === "review";
  const order = answer ? answer.split("||") : [];
  const pairs = item.type === "matching" ? getQuizPracticePairs(item) : [];
  const complete =
    item.type === "matching"
      ? pairs.every((pair) => Boolean(matching[pair.left]))
      : item.type === "order"
        ? order.length === getQuizPracticeOrderOptions(item).length
        : Boolean(answer.trim());

  const practiceQuestion =
    item.type === "matching"
      ? {
          ...item,
          matchingPairs: pairs,
          matchingRightOptions: [...pairs].sort((a, b) =>
            a.right.localeCompare(b.right, "ko"),
          ),
        }
      : item;
  const updatePracticeAnswer = (value: string) => {
    if (item.type !== "matching") return setAnswer(value);
    const next = Object.fromEntries(
      value
        .split("||")
        .filter(Boolean)
        .map((part) => part.split("=>")),
    );
    const changed = Object.keys(next).find(
      (left) => next[left] !== matching[left],
    );
    if (changed && next[changed]) {
      for (const left of Object.keys(next)) {
        if (left !== changed && next[left] === next[changed]) delete next[left];
      }
    }
    setAnswer(
      pairs
        .filter((pair) => next[pair.left])
        .map((pair) => `${pair.left}=>${next[pair.left]}`)
        .join("||"),
    );
  };
  const questionIndex =
    (questionNumbers?.[item.id] ||
      item.paperOrder ||
      items.findIndex((entry) => entry.id === item.id) + 1) - 1;
  const selectQuestion = (next: number) => {
    if (saveBusy.current) return;
    setIndex(next);
    setStage("review");
    setSaveError("");
    setConflict(false);
    setReloaded(false);
    setSavedMessage("");
  };
  return (
    <section
      ref={contentProtectionRef}
      data-quiz-content-protected
      className="student-quiz-relearning quiz-notebook"
      aria-label="오답 복습"
    >
      <div className="student-quiz-relearning-header">
        <h2 ref={headingRef} tabIndex={-1}>
          오답 노트 {index + 1} / {queue.length}
        </h2>
        <InfoHelp label="오답 복습 기록 안내">
          {onSave
            ? "노트 저장을 누르면 선택한 이유와 메모, 연습 답안을 저장합니다. "
            : "선택한 이유와 연습 답안은 이 화면에서만 사용합니다. "}
          평가 점수·응시 횟수·위스에는 반영하지 않습니다.
        </InfoHelp>
        {onShowAnswers && (
          <button
            type="button"
            className="student-quiz-secondary-action"
            disabled={saving}
            onClick={() => leave(onShowAnswers)}
          >
            전체 답안 보기
          </button>
        )}
        <button
          type="button"
          className="student-quiz-secondary-action"
          onClick={close}
          disabled={saving}
        >
          {closeLabel}
        </button>
      </div>
      <nav className="quiz-notebook__questions" aria-label="오답 문항 선택">
        {queue.map((entry, position) => (
          <button
            key={entry.id}
            type="button"
            aria-current={index === position ? "step" : undefined}
            disabled={saving}
            onClick={() => selectQuestion(position)}
          >
            {questionNumbers?.[entry.id] ||
              entry.paperOrder ||
              items.findIndex((original) => original.id === entry.id) + 1}
            번
            {dirtyIds.includes(entry.id) && (
              <span className="sr-only"> · 저장하지 않음</span>
            )}
          </button>
        ))}
      </nav>
      <div className="quiz-notebook__workspace">
        <article className="quiz-notebook__paper" aria-label="복습할 문제">
          <MockExamQuestionContent
            question={practiceQuestion}
            index={questionIndex}
            answer={reviewing ? item.submittedAnswer : answer}
            hideAnswers={!reviewing}
            correct={reviewing ? false : undefined}
          />
          {!reviewing && (
            <MockExamAnswerControls
              question={practiceQuestion}
              index={questionIndex}
              answer={answer}
              onAnswer={updatePracticeAnswer}
              disabled={checked}
              choiceLayout="paper"
              orderOptions={getQuizPracticeOrderOptions(item)}
              correct={checked ? results[item.id] : undefined}
            />
          )}
        </article>
        <div className="quiz-notebook__review">
          {(reviewing || checked) && (
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
                      : formatQuizPracticeAnswer(item.submittedAnswer) ||
                        "미응답"}
                  </dd>
                </div>
                <div className="student-quiz-relearning-correct-answer">
                  <dt>정답</dt>
                  <dd>{formatQuizPracticeAnswer(item.answer)}</dd>
                </div>
              </dl>
              <section
                className="student-quiz-relearning-explanation"
                aria-label="해설과 관련 자료"
              >
                <h3>해설</h3>
                <p>{item.explanation || "보관된 해설이 없습니다."}</p>
                {item.concepts.length > 0 && (
                  <p className="student-quiz-relearning-concepts">
                    {item.concepts.join(" · ")}
                  </p>
                )}
              </section>
            </>
          )}
          {item.reviewLessonId && (
            <a
              className="quiz-notebook__lesson"
              href={`#/student/lesson/note?id=${encodeURIComponent(item.reviewLessonId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 5v15M12 5C8 2 4 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1Z" />
              </svg>
              연결된 학습지 열기 <span aria-hidden="true">↗</span>
              <span className="sr-only">(새 탭)</span>
            </a>
          )}
          {checked && (
            <p className="student-quiz-relearning-feedback" role="status">
              {results[item.id]
                ? "다시 맞혔어요."
                : "정답과 근거를 한 번 더 확인해 보세요."}
            </p>
          )}
          <div className="quiz-notebook__practice-actions">
            {reviewing ? (
              <button
                type="button"
                className="student-quiz-secondary-action"
                onClick={startPractice}
              >
                해설 가리고 다시 풀기
              </button>
            ) : (
              <>
                {!checked && (
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
                <button
                  type="button"
                  className="student-quiz-secondary-action"
                  onClick={() => setStage("review")}
                >
                  해설 다시 보기
                </button>
                {checked && (
                  <button
                    type="button"
                    className="student-quiz-secondary-action"
                    disabled={saving}
                    onClick={advance}
                  >
                    {index + 1 < queue.length ? "다음 오답" : "복습 결과 확인"}
                  </button>
                )}
              </>
            )}
          </div>
          <fieldset className="student-quiz-relearning-reflection quiz-notebook__reflection">
            <legend>
              왜 틀렸나요? <span>(선택)</span>
            </legend>
            <div>
              {reflectionReasons.map((reason) => (
                <label
                  key={reason}
                  className={draft?.reason === reason ? "is-selected" : ""}
                >
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
            </div>
          </fieldset>
          {reviewing && answer && (
            <p>연습한 답: {formatQuizPracticeAnswer(answer)}</p>
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
                  <p>
                    {getDraft(item.id, savedNotes).note || "작성한 노트 없음"}
                  </p>
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
        </div>
      </div>
    </section>
  );
}
