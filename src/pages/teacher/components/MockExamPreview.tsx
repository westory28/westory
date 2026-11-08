import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isQuizAnswerCorrect } from "../../../lib/quizAnswerMatching";
import { formatMockExamRoundShortLabel } from "../../../lib/mockExamRounds";
import type { QuizQuestionDraft } from "./QuizEditor";
import {
  QUIZ_QUESTION_PAGE_SIZE,
  type QuizQuestionCatalogEntry,
} from "./quizQuestionPaging";
import { useQuizDialog } from "./useQuizDialog";
import MockExamPaper, {
  MockExamQuestionContent,
  type MockExamPaperCheck,
} from "../../../components/common/MockExamPaper";
import MockExamAnswerControls from "../../../components/common/MockExamAnswerControls";
import "./MockExamPreview.css";
import type { MockExamPaperHeaderSettings } from "../../../lib/mockExamPaperHeader";

interface Props {
  disabled?: boolean;
  entries: QuizQuestionCatalogEntry[];
  loadQuestions: (
    entries: QuizQuestionCatalogEntry[],
  ) => Promise<QuizQuestionDraft[]>;
  loadPaperHeader?: (round: string) => Promise<MockExamPaperHeaderSettings>;
}

export default function MockExamPreview({
  disabled = false,
  entries,
  loadQuestions,
  loadPaperHeader,
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const [questions, setQuestions] = useState<QuizQuestionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewRound, setPreviewRound] = useState("round_1");
  const [paperHeaders, setPaperHeaders] = useState<
    Record<string, MockExamPaperHeaderSettings>
  >({});
  const [headerError, setHeaderError] = useState("");
  const [headerRetry, setHeaderRetry] = useState(0);
  const headerLoader = useRef(loadPaperHeader);
  headerLoader.current = loadPaperHeader;
  const [practiceAnswers, setPracticeAnswers] = useState<
    Record<string, string>
  >({});
  const [questionIndex, setQuestionIndex] = useState<number | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    checks: MockExamPaperCheck[];
    score: number;
    earnedPoints: number;
  } | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingRun, setGradingRun] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState<
    string | number | null
  >(null);
  const body = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const paperScroll = useRef(0);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    setQuestions([]);
    setPracticeAnswers({});
    setPreviewResult(null);
    setIsGrading(false);
    setQuestionIndex(null);
    setSelectedQuestionId(null);
    setPaperHeaders({});
    setHeaderError("");
  };
  useEffect(() => {
    if (
      !questions.length ||
      !headerLoader.current ||
      paperHeaders[previewRound]
    )
      return;
    let active = true;
    setHeaderError("");
    void headerLoader
      .current(previewRound)
      .then((settings) => {
        if (active)
          setPaperHeaders((previous) => ({
            ...previous,
            [previewRound]: settings,
          }));
      })
      .catch(() => {
        if (active) setHeaderError("시험지 상단 문구를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [questions.length, previewRound, headerRetry]);
  const returnToPaper = () => {
    setQuestionIndex(null);
    requestAnimationFrame(() => {
      if (body.current) body.current.scrollTop = paperScroll.current;
      const selected = dialog.current?.querySelector<HTMLElement>(
        '.mock-exam-question[aria-pressed="true"]',
      );
      selected?.focus({ preventScroll: true });
      if (selected && body.current) {
        const questionBounds = selected.getBoundingClientRect();
        const viewportBounds = body.current.getBoundingClientRect();
        if (
          questionBounds.top < viewportBounds.top ||
          questionBounds.bottom > viewportBounds.bottom
        )
          selected.scrollIntoView({ block: "nearest" });
      }
    });
  };
  useQuizDialog(questions.length > 0, dialog, () =>
    questionIndex == null ? close() : returnToPaper(),
  );
  useEffect(() => {
    if (!questions.length) return;
    // Safari does not focus a clicked button. Restore the trigger explicitly
    // after useQuizDialog releases its scroll lock and previous focus.
    return () => previewButton.current?.focus({ preventScroll: true });
  }, [questions.length]);
  useEffect(() => {
    if (questionIndex == null) return;
    if (body.current) body.current.scrollTop = 0;
    backButton.current?.focus();
  }, [questionIndex]);

  const preview = async () => {
    if (disabled || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const loaded: QuizQuestionDraft[] = [];
      for (
        let start = 0;
        start < entries.length;
        start += QUIZ_QUESTION_PAGE_SIZE
      ) {
        loaded.push(
          ...(await loadQuestions(
            entries.slice(start, start + QUIZ_QUESTION_PAGE_SIZE),
          )),
        );
        if (!active.current) return;
      }
      if (!loaded.length) throw new Error("미리 볼 문항이 없습니다.");
      setPreviewRound(loaded[0].examRound || "round_1");
      setQuestions(loaded);
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "시험지를 불러오지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const previewQuestions = useMemo(
    () =>
      questions
        .filter((q) => (q.examRound || "round_1") === previewRound)
        .sort(
          (a, b) => Number(a.paperOrder || a.id) - Number(b.paperOrder || b.id),
        ),
    [questions, previewRound],
  );
  const headerReady = !loadPaperHeader || !!paperHeaders[previewRound];
  const gradePreview = () => {
    if (isGrading || !headerReady || !previewQuestions.length) return;
    // Match the server's typed answer comparison and weighted percentage.
    // This is a local teacher rehearsal; it never submits a student attempt.
    const checks = previewQuestions.map((question) => ({
      id: question.id,
      correct: isQuizAnswerCorrect(
        question.type,
        practiceAnswers[String(question.id)],
        question.answer,
      ),
    }));
    const points = previewQuestions.map((question) =>
      Number.isFinite(question.points) ? question.points! : 1,
    );
    const roundedPoints = (value: number) => Math.round(value * 10000) / 10000;
    const total = roundedPoints(points.reduce((sum, value) => sum + value, 0));
    const earned = roundedPoints(
      points.reduce(
        (sum, value, index) => sum + (checks[index].correct ? value : 0),
        0,
      ),
    );
    setPreviewResult({
      checks,
      score: total > 0 ? Math.round((earned / total) * 10000) / 100 : 0,
      earnedPoints: earned,
    });
    setQuestionIndex(null);
    setSelectedQuestionId(null);
    setIsGrading(true);
    setGradingRun((previous) => previous + 1);
    paperScroll.current = 0;
  };
  const scrollToScore = useCallback(() => {
    body.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);
  const showFinalScore = useCallback(() => {
    setIsGrading(false);
    scrollToScore();
  }, [scrollToScore]);
  const currentQuestion =
    questionIndex == null ? null : previewQuestions[questionIndex];

  return (
    <>
      <button
        ref={previewButton}
        type="button"
        className="quiz-authoring-button"
        disabled={disabled || busy || !entries.length}
        onClick={() => void preview()}
      >
        {busy ? "불러오는 중…" : "미리보기"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
      {!!questions.length && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="시험지 미리보기"
            tabIndex={-1}
            className="quiz-authoring-surface quiz-composer-dialog"
          >
            <div className="quiz-composer-header mock-exam-preview-toolbar">
              <label className="mock-exam-preview-round">
                <span>
                  <span className="mock-exam-preview-round-prefix">
                    모의고사{" "}
                  </span>
                  회차
                </span>
                <select
                  value={previewRound}
                  disabled={isGrading}
                  onChange={(event) => {
                    setPreviewRound(event.target.value);
                    setPreviewResult(null);
                    setSelectedQuestionId(null);
                    setQuestionIndex(null);
                    paperScroll.current = 0;
                    if (body.current) body.current.scrollTop = 0;
                  }}
                >
                  {[...new Set(questions.map((q) => q.examRound || "round_1"))]
                    .sort()
                    .map((round) => (
                      <option key={round} value={round}>
                        {formatMockExamRoundShortLabel(round)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="mock-exam-preview-actions">
                <button
                  type="button"
                  className="quiz-authoring-button mock-exam-preview-grade"
                  disabled={
                    isGrading || !headerReady || !previewQuestions.length
                  }
                  aria-busy={isGrading || undefined}
                  onClick={gradePreview}
                >
                  채점
                </button>
                <button
                  type="button"
                  className="quiz-authoring-button"
                  onClick={close}
                >
                  닫기
                </button>
              </div>
            </div>
            <div ref={body} className="quiz-composer-body">
              {loadPaperHeader && !paperHeaders[previewRound] ? (
                <div role={headerError ? "alert" : "status"}>
                  {headerError || "시험지 상단 문구를 불러오는 중입니다."}
                  {headerError && (
                    <button
                      type="button"
                      className="quiz-authoring-button"
                      onClick={() => setHeaderRetry((value) => value + 1)}
                    >
                      다시 불러오기
                    </button>
                  )}
                </div>
              ) : (
                <div hidden={questionIndex != null}>
                  <MockExamPaper
                    key={`${previewRound}:${gradingRun}`}
                    questions={previewQuestions}
                    round={previewRound}
                    paperHeader={paperHeaders[previewRound]}
                    answers={practiceAnswers}
                    checks={previewResult?.checks}
                    score={previewResult?.score}
                    earnedPoints={previewResult?.earnedPoints}
                    onScoreStart={scrollToScore}
                    animateGrading={!!previewResult}
                    onGradingComplete={showFinalScore}
                    selectedQuestionId={selectedQuestionId}
                    onQuestionSelect={(index) => {
                      paperScroll.current = body.current?.scrollTop || 0;
                      setSelectedQuestionId(previewQuestions[index].id);
                      setQuestionIndex(index);
                    }}
                  />
                  <details className="py-3">
                    <summary className="min-h-11 cursor-pointer text-sm font-bold">
                      정답·해설 확인
                    </summary>
                    {previewQuestions.map((q, index) => (
                      <section
                        key={q.id}
                        className="border-b border-gray-200 py-3"
                      >
                        <h4 className="font-bold">
                          {q.paperOrder || index + 1}번 · {q.points ?? 1}점
                        </h4>
                        <p className="mt-2 text-sm text-blue-700">
                          정답: {q.answer}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {q.explanation}
                        </p>
                      </section>
                    ))}
                  </details>
                </div>
              )}
              {currentQuestion && questionIndex != null && (
                <section
                  className="mock-exam-preview-question"
                  aria-label={`${questionIndex + 1}번 문제 풀이 미리보기`}
                >
                  <MockExamQuestionContent
                    question={currentQuestion}
                    index={questionIndex}
                    hideAnswers
                    correct={
                      previewResult?.checks.find(
                        (check) =>
                          String(check.id) === String(currentQuestion.id),
                      )?.correct
                    }
                  />
                  <MockExamAnswerControls
                    question={currentQuestion}
                    index={questionIndex}
                    choiceLayout="paper"
                    correct={
                      previewResult?.checks.find(
                        (check) =>
                          String(check.id) === String(currentQuestion.id),
                      )?.correct
                    }
                    answer={practiceAnswers[String(currentQuestion.id)] || ""}
                    onAnswer={(value) => {
                      setPreviewResult(null);
                      setPracticeAnswers((previous) => ({
                        ...previous,
                        [String(currentQuestion.id)]: value,
                      }));
                    }}
                  />
                  <details className="py-3">
                    <summary className="min-h-11 cursor-pointer text-sm font-bold">
                      정답·해설 확인
                    </summary>
                    <p className="mt-2 text-sm text-blue-700">
                      정답: {currentQuestion.answer}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {currentQuestion.explanation}
                    </p>
                  </details>
                </section>
              )}
            </div>
            {questionIndex != null && (
              <div className="quiz-composer-footer mock-exam-preview-footer">
                <button
                  ref={backButton}
                  type="button"
                  className="quiz-authoring-button mock-exam-preview-back"
                  onClick={returnToPaper}
                >
                  시험지로 돌아가기
                </button>
                <div className="quiz-composer-footer-actions">
                  <button
                    type="button"
                    className="quiz-authoring-button"
                    disabled={questionIndex === 0}
                    onClick={() => {
                      setQuestionIndex(questionIndex - 1);
                      setSelectedQuestionId(
                        previewQuestions[questionIndex - 1].id,
                      );
                    }}
                  >
                    이전 문제
                  </button>
                  <button
                    type="button"
                    className="quiz-authoring-button"
                    disabled={questionIndex >= previewQuestions.length - 1}
                    onClick={() => {
                      setQuestionIndex(questionIndex + 1);
                      setSelectedQuestionId(
                        previewQuestions[questionIndex + 1].id,
                      );
                    }}
                  >
                    다음 문제
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
