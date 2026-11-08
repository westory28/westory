import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadMyQuizHistory,
  loadMyQuizHistoryDetail,
  type MyQuizHistoryPage,
  type MyQuizHistoryRow,
  type MyQuizHistoryDetail,
} from "../../../lib/myQuizHistory";
import { saveMyQuizReviewNote } from "../../../lib/quizReviewNotes";
import { normalizeMockExamPaperHeader } from "../../../lib/mockExamPaperHeader";
import QuizPassage from "../../../components/common/QuizPassage";
import QuizQuestionText from "../../../components/common/QuizQuestionText";
import MockExamPaper from "../../../components/common/MockExamPaper";
import { isMockExamCategory } from "../../../lib/mockExamRounds";
import QuizRelearning from "../quiz/QuizRelearning";
import { useQuizContentProtection } from "../quiz/useQuizContentProtection";
import { formatQuizPracticeAnswer } from "../quiz/quizPracticeData";
import { formatRecordedScore } from "./assessmentRecords";
import {
  formatHistoryDate,
  historyCategoryLabel,
  historyReviewQuestion,
} from "./historyReviewData";
import "../quiz/QuizLearning.css";
import "./MyQuizHistory.css";

interface Props {
  semesterId: string;
  active: boolean;
  requestedAttemptId: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  onStart: () => void;
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function MyQuizHistory({
  semesterId,
  active,
  requestedAttemptId,
  onSelect,
  onClose,
  onStart,
}: Props) {
  const contentProtectionRef = useRef<HTMLElement>(null);
  useQuizContentProtection(contentProtectionRef);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState<MyQuizHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<
    | (MyQuizHistoryDetail & {
        row?: MyQuizHistoryRow;
      })
    | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [index, setIndex] = useState(0);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [practicing, setPracticing] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const loadedCategory = useRef("");
  const detailCache = useRef(new Map<string, MyQuizHistoryDetail>());
  const heading = useRef<HTMLHeadingElement>(null);
  const activeDetail = useRef("");
  const returnFocusKey = useRef("");
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const listHeading = useRef<HTMLHeadingElement>(null);
  const questionDetail = useRef<HTMLElement>(null);

  const loadList = async (more = false, refresh = false) => {
    const request = ++listRequest.current;
    setLoading(true);
    setError("");
    if (!more) setPage(null);
    try {
      const next = await loadMyQuizHistory({
        semesterId,
        ...(category !== "all" ? { category } : {}),
        ...(more && page?.nextCursor ? { cursor: page.nextCursor } : {}),
        ...(refresh ? { forceRefresh: true } : {}),
      });
      if (request !== listRequest.current) return;
      loadedCategory.current = category;
      setPage((previous) =>
        more && previous
          ? {
              ...next,
              rows: [
                ...previous.rows,
                ...next.rows.filter(
                  (row) => !previous.rows.some((old) => old.key === row.key),
                ),
              ],
            }
          : next,
      );
      if (refresh) detailCache.current.clear();
    } catch (caught) {
      if (request === listRequest.current)
        setError(
          errorText(
            caught,
            "응시 기록을 불러오지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  };

  const loadDetail = async (requestedKey: string) => {
    const request = ++detailRequest.current;
    const row = page?.rows.find(
      (item) => item.key === requestedKey || item.id === requestedKey,
    );
    const key =
      row?.key ||
      (/^(canonical|legacy):/.test(requestedKey)
        ? requestedKey
        : `canonical:${requestedKey}`);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setIndex(0);
    setWrongOnly(false);
    setPracticing(false);
    try {
      let loaded = detailCache.current.get(key);
      if (!loaded) {
        try {
          loaded = await loadMyQuizHistoryDetail(semesterId, key);
        } catch (caught) {
          // Older result links have no source prefix. Only a missing own result may try legacy.
          const code = (caught as { code?: string })?.code || "";
          if (row || requestedKey.includes(":") || !code.endsWith("not-found"))
            throw caught;
          loaded = await loadMyQuizHistoryDetail(
            semesterId,
            `legacy:${requestedKey}`,
          );
        }
      }
      if (request !== detailRequest.current) return;
      detailCache.current.set(key, loaded);
      if (detailCache.current.size > 3)
        detailCache.current.delete(detailCache.current.keys().next().value!);
      setDetail({ ...loaded, row });
    } catch (caught) {
      if (request === detailRequest.current)
        setDetailError(
          errorText(
            caught,
            "평가 결과를 불러오지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (active && loadedCategory.current !== category)
      void loadList(false, Boolean(requestedAttemptId));
  }, [active, category, semesterId]);
  useEffect(() => {
    if (!active || !requestedAttemptId) {
      detailRequest.current += 1;
      activeDetail.current = "";
      setDetail(null);
      setDetailLoading(false);
      setDetailError("");
      setPracticing(false);
      return;
    }
    if (activeDetail.current === requestedAttemptId) return;
    activeDetail.current = requestedAttemptId;
    void loadDetail(requestedAttemptId);
  }, [active, requestedAttemptId, semesterId]);
  useEffect(
    () => () => {
      listRequest.current += 1;
      detailRequest.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (detail || detailError) heading.current?.focus();
  }, [detail?.key, detailError]);
  useEffect(() => {
    if (active && !requestedAttemptId && returnFocusKey.current) {
      (
        rowButtons.current.get(returnFocusKey.current) || listHeading.current
      )?.focus();
      returnFocusKey.current = "";
    }
  }, [active, requestedAttemptId]);

  const questions = useMemo(
    () => (detail?.record.details || []).map(historyReviewQuestion),
    [detail],
  );
  const reviewItems = useMemo(
    () =>
      questions
        .filter((item) => item.practiceAvailable)
        .map((item) => item.snapshot),
    [questions],
  );
  const paperQuestions = useMemo(
    () => questions.map((item) => item.snapshot),
    [questions],
  );
  const paperAnswers = useMemo(
    () =>
      Object.fromEntries(
        questions
          .filter((item) => item.saved.userAnswerAvailable)
          .map((item) => [item.snapshot.id, item.snapshot.submittedAnswer]),
      ),
    [questions],
  );
  const paperChecks = useMemo(
    () =>
      questions.map((item) => ({
        id: item.snapshot.id,
        correct: typeof item.correct === "boolean" ? item.correct : null,
      })),
    [questions],
  );
  const hasSavedPaper =
    isMockExamCategory(detail?.row?.category || detail?.record.category) &&
    questions.length > 0 &&
    questions.every((item) => item.saved.questionAvailable);
  const visibleQuestions = wrongOnly
    ? questions.filter((item) => item.correct === false)
    : questions;
  const current =
    visibleQuestions[Math.min(index, Math.max(0, visibleQuestions.length - 1))];
  const currentNote = detail?.reviewNotes?.items.find(
    (note) => note.questionId === current?.snapshot.id,
  );
  const incorrectCount = questions.filter(
    (item) => item.correct === false,
  ).length;
  if (!active) return null;

  if (requestedAttemptId) {
    const title =
      detail?.row?.title ||
      String(detail?.record.title || detail?.record.unitTitle || "평가 결과");
    return (
      <section
        ref={contentProtectionRef}
        data-quiz-content-protected
        className="my-quiz-history student-quiz-learning-result"
        aria-label="평가 결과 상세"
      >
        <header className="my-quiz-history__header">
          {!practicing && (
            <button
              type="button"
              onClick={() => {
                returnFocusKey.current =
                  detail?.row?.key || detail?.key || requestedAttemptId;
                onClose();
              }}
            >
              ← 응시 기록
            </button>
          )}
          <h3 ref={heading} tabIndex={-1}>
            {title}
          </h3>
        </header>
        {detailLoading ? (
          <p role="status">평가 결과를 불러오는 중입니다.</p>
        ) : detailError ? (
          <div role="alert">
            <p>{detailError}</p>
            <button
              type="button"
              onClick={() => void loadDetail(requestedAttemptId)}
            >
              다시 불러오기
            </button>
          </div>
        ) : (
          detail && (
            <>
              <div className="my-quiz-history__result-meta">
                <strong>{formatRecordedScore(detail.record.score)}</strong>
                <span>
                  {formatHistoryDate(
                    detail.row?.submittedAtMs ??
                      detail.record.recordedAtMs ??
                      (detail.record.timestamp?.seconds || 0) * 1000,
                  )}
                </span>
                <span>
                  {historyCategoryLabel(
                    detail.row?.category || detail.record.category || "",
                    detail.row?.examRound || detail.record.examRound,
                  )}
                </span>
              </div>
              {practicing ? (
                <QuizRelearning
                  key={detail.key}
                  items={reviewItems}
                  reviewNotes={detail.reviewNotes}
                  onReload={async () => {
                    const latest = await loadMyQuizHistoryDetail(
                      semesterId,
                      detail.key,
                    );
                    for (const [cacheKey, cached] of detailCache.current) {
                      if (cached.key === detail.key)
                        detailCache.current.set(cacheKey, latest);
                    }
                    detailCache.current.set(detail.key, latest);
                    if (detailCache.current.size > 3)
                      detailCache.current.delete(
                        detailCache.current.keys().next().value!,
                      );
                    setDetail((current) =>
                      current?.key === detail.key
                        ? { ...latest, row: current.row }
                        : current,
                    );
                    return (
                      latest.reviewNotes || {
                        revision: 0,
                        items: [],
                        updatedAt: "",
                      }
                    );
                  }}
                  onSave={async (draft, expectedRevision, saveId) => {
                    const response = await saveMyQuizReviewNote({
                      semesterId,
                      key: detail.key,
                      ...draft,
                      expectedRevision,
                      saveId,
                    });
                    const next = {
                      ...detail,
                      reviewNotes: response.reviewNotes,
                    };
                    for (const [cacheKey, cached] of detailCache.current) {
                      if (cached.key === detail.key)
                        detailCache.current.set(cacheKey, next);
                    }
                    setDetail((current) =>
                      current?.key === detail.key
                        ? { ...current, reviewNotes: response.reviewNotes }
                        : current,
                    );
                    return response.reviewNotes;
                  }}
                  onClose={() => setPracticing(false)}
                />
              ) : (
                <>
                  {hasSavedPaper && (
                    <MockExamPaper
                      questions={paperQuestions}
                      answers={paperAnswers}
                      checks={paperChecks}
                      round={detail.row?.examRound || detail.record.examRound}
                      paperHeader={normalizeMockExamPaperHeader(
                        detail.record.paperHeader,
                      )}
                      score={detail.record.score ?? undefined}
                      onQuestionSelect={(questionIndex) => {
                        setWrongOnly(false);
                        setIndex(questionIndex);
                        requestAnimationFrame(() => {
                          questionDetail.current?.scrollIntoView({
                            block: "start",
                          });
                          questionDetail.current?.focus({
                            preventScroll: true,
                          });
                        });
                      }}
                    />
                  )}
                  <div className="my-quiz-history__toolbar">
                    <span>
                      채점 기록{" "}
                      {
                        questions.filter((item) => item.saved.correctKnown)
                          .length
                      }
                      문항 · 오답 {incorrectCount}개
                    </span>
                    {reviewItems.length > 0 && (
                      <button
                        type="button"
                        className="student-quiz-primary-action"
                        onClick={() => setPracticing(true)}
                      >
                        오답 {reviewItems.length}문제 복습하기
                      </button>
                    )}
                  </div>
                  {incorrectCount > reviewItems.length && (
                    <p className="my-quiz-history__muted">
                      문제 원문이나 정답이 없는 오답{" "}
                      {incorrectCount - reviewItems.length}개는 다시 풀 수
                      없습니다.
                    </p>
                  )}
                  {questions.length > 0 ? (
                    <>
                      <div className="my-quiz-history__toolbar">
                        <label className="my-quiz-history__check">
                          <input
                            type="checkbox"
                            checked={wrongOnly}
                            onChange={(event) => {
                              setWrongOnly(event.target.checked);
                              setIndex(0);
                            }}
                          />
                          오답만 보기
                        </label>
                        <label>
                          문항{" "}
                          <select
                            aria-label="확인할 문항"
                            value={index}
                            onChange={(event) =>
                              setIndex(Number(event.target.value))
                            }
                            disabled={!visibleQuestions.length}
                          >
                            {visibleQuestions.map((item, questionIndex) => (
                              <option
                                key={`${item.snapshot.id}:${questionIndex}`}
                                value={questionIndex}
                              >
                                {questions.indexOf(item) + 1}번 ·{" "}
                                {item.saved.correctKnown
                                  ? item.correct
                                    ? "정답"
                                    : "오답"
                                  : "채점 기록 없음"}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {current ? (
                        <article
                          ref={questionDetail}
                          tabIndex={-1}
                          className="my-quiz-history__question"
                          aria-label={`${questions.indexOf(current) + 1}번 문항 상세`}
                        >
                          <h4>
                            {questions.indexOf(current) + 1}번 ·{" "}
                            {current.saved.correctKnown
                              ? current.correct
                                ? "정답"
                                : "오답"
                              : "채점 기록 없음"}
                          </h4>
                          <QuizQuestionText
                            value={
                              current.saved.questionAvailable
                                ? current.snapshot.question
                                : "문제 원문이 보관되어 있지 않습니다."
                            }
                          />
                          {current.snapshot.passageSet && (
                            <section aria-label="공통 지문">
                              <p>{current.snapshot.passageSet.instruction}</p>
                              {current.snapshot.passageSet.passage && (
                                <QuizPassage
                                  value={current.snapshot.passageSet.passage}
                                />
                              )}
                              {current.snapshot.passageSet.image && (
                                <img
                                  src={current.snapshot.passageSet.image}
                                  alt="공통 지문 자료"
                                  loading="lazy"
                                />
                              )}
                            </section>
                          )}
                          {current.snapshot.passage && (
                            <QuizPassage value={current.snapshot.passage} />
                          )}
                          {current.snapshot.image && (
                            <img
                              src={current.snapshot.image}
                              alt="문제 자료"
                              loading="lazy"
                            />
                          )}
                          {current.snapshot.examplePassage && (
                            <section aria-label="보기">
                              <h5>〈보기〉</h5>
                              <QuizPassage
                                value={current.snapshot.examplePassage}
                              />
                            </section>
                          )}
                          {(current.snapshot.type === "choice" ||
                            current.snapshot.type === "ox") &&
                          current.snapshot.options?.length ? (
                            <ol className="my-quiz-history__options">
                              {current.snapshot.options.map(
                                (option, optionIndex) => (
                                  <li key={optionIndex}>
                                    {current.snapshot.choiceOptionImages?.[
                                      optionIndex
                                    ] && (
                                      <img
                                        src={
                                          current.snapshot.choiceOptionImages[
                                            optionIndex
                                          ]!
                                        }
                                        alt={`보기 ${optionIndex + 1} 자료`}
                                        loading="lazy"
                                      />
                                    )}
                                    <span>{option}</span>
                                    {current.snapshot.answer === option && (
                                      <strong>정답</strong>
                                    )}
                                    {current.snapshot.submittedAnswer ===
                                      option && <span>내 답</span>}
                                  </li>
                                ),
                              )}
                            </ol>
                          ) : null}
                          <dl className="student-quiz-relearning-answers">
                            <div>
                              <dt>내 답</dt>
                              <dd>
                                {current.saved.userAnswerAvailable
                                  ? formatQuizPracticeAnswer(
                                      current.snapshot.submittedAnswer,
                                    ) || "미응답"
                                  : "답안 미보관"}
                              </dd>
                            </div>
                            <div>
                              <dt>정답</dt>
                              <dd>
                                {current.saved.answerAvailable
                                  ? formatQuizPracticeAnswer(
                                      current.snapshot.answer,
                                    ) || "정답 미보관"
                                  : "정답 미보관"}
                              </dd>
                            </div>
                          </dl>
                          {current.snapshot.explanation && (
                            <div className="student-quiz-relearning-explanation">
                              <h4>해설</h4>
                              <p>{current.snapshot.explanation}</p>
                            </div>
                          )}
                          {currentNote && (
                            <section
                              className="student-quiz-relearning-explanation"
                              aria-label="저장한 오답노트"
                            >
                              <h4>내 오답노트</h4>
                              {currentNote.reason && (
                                <p>{currentNote.reason}</p>
                              )}
                              {currentNote.note && (
                                <p style={{ whiteSpace: "pre-wrap" }}>
                                  {currentNote.note}
                                </p>
                              )}
                              {currentNote.practiceAnswer && (
                                <p>
                                  다시 푼 답:{" "}
                                  {formatQuizPracticeAnswer(
                                    currentNote.practiceAnswer,
                                  )}{" "}
                                  ·{" "}
                                  {currentNote.correct === null
                                    ? "미채점"
                                    : currentNote.correct
                                      ? "정답"
                                      : "다시 확인"}
                                </p>
                              )}
                            </section>
                          )}
                          {current.snapshot.reviewLessonId && (
                            <a
                              className="my-quiz-history__lesson"
                              href={`#/student/lesson/note?id=${encodeURIComponent(current.snapshot.reviewLessonId)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              연결된 수업 자료 보기 ↗
                            </a>
                          )}
                        </article>
                      ) : (
                        <p>이 평가에는 오답이 없습니다.</p>
                      )}
                    </>
                  ) : (
                    <p>문항별 답안 기록이 없습니다.</p>
                  )}
                </>
              )}
            </>
          )
        )}
      </section>
    );
  }

  return (
    <section
      className="my-quiz-history"
      aria-labelledby="my-quiz-history-title"
    >
      <header className="my-quiz-history__header">
        <h3 id="my-quiz-history-title" ref={listHeading} tabIndex={-1}>
          응시 기록
        </h3>
        <div>
          <button type="button" onClick={onStart}>
            평가 풀기
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadList(false, true)}
          >
            새로고침
          </button>
        </div>
      </header>
      <div className="my-quiz-history__toolbar">
        <label>
          평가 종류{" "}
          <select
            value={category}
            onChange={(event) => {
              loadedCategory.current = "";
              setCategory(event.target.value);
            }}
          >
            <option value="all">전체</option>
            <option value="diagnostic">진단평가</option>
            <option value="formative">형성평가</option>
            <option value="exam_prep">모의고사</option>
          </select>
        </label>
        {page && <span>총 {page.totalCount}회 · 최신순</span>}
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadList(false, true)}
          >
            처음부터 새로고침
          </button>
        </div>
      )}
      {page?.rows.length ? (
        <ul className="my-quiz-history__list">
          {page.rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                ref={(element) => {
                  if (element) rowButtons.current.set(row.key, element);
                  else rowButtons.current.delete(row.key);
                }}
                onClick={() => onSelect(row.key)}
                aria-label={`${row.title}, ${formatRecordedScore(row.score)}, 결과 보기`}
              >
                <div className="my-quiz-history__identity">
                  <span>
                    {historyCategoryLabel(row.category, row.examRound)}
                  </span>
                  <strong>{row.title}</strong>
                  <time>{formatHistoryDate(row.submittedAtMs)}</time>
                </div>
                <div className="my-quiz-history__score">
                  <strong>{formatRecordedScore(row.score)}</strong>
                  <span>
                    {row.wrongCount === null
                      ? "문항별 기록 없음"
                      : `오답 ${row.wrongCount}개${row.totalCount === null ? "" : ` / ${row.totalCount}문항`}`}
                  </span>
                  <span className="my-quiz-history__open">결과 보기 →</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !loading &&
        !error && (
          <div className="my-quiz-history__empty">
            <p>
              {category === "all"
                ? "아직 응시한 평가가 없습니다."
                : "이 종류의 응시 기록이 없습니다."}
            </p>
            <button type="button" onClick={onStart}>
              평가 풀기
            </button>
          </div>
        )
      )}
      {loading && <p role="status">응시 기록을 불러오는 중입니다.</p>}
      {page?.nextCursor && (
        <button
          type="button"
          className="my-quiz-history__more"
          disabled={loading || !!error}
          onClick={() => void loadList(true)}
        >
          이전 기록 더 보기
        </button>
      )}
    </section>
  );
}
