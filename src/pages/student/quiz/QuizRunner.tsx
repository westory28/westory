import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  SHORT_ANSWER_MAX_LENGTH,
  limitShortAnswer,
  restoreAssessmentAnswers,
} from "../../../lib/assessmentAnswerLimits";
import MatchingConnectionLines from "../../../components/common/MatchingConnectionLines";
import {
  LoadingOverlay,
  PageLoading,
} from "../../../components/common/LoadingState";
import QuizPassage from "../../../components/common/QuizPassage";
import QuizQuestionText from "../../../components/common/QuizQuestionText";
import {
  QuizChoiceColumnHeaders,
  QuizChoiceColumnCells,
} from "../../../components/common/QuizChoiceColumns";
import { getQuizChoiceColumnCount } from "../../../lib/quizChoiceColumns";
import {
  AssessmentTelemetryCollector,
  type AssessmentTelemetrySnapshot,
} from "../../../lib/assessmentTelemetry";
import "./QuizLearning.css";
import QuizLearningResult from "./QuizLearningResult";
import { saveMyQuizReviewNote } from "../../../lib/quizReviewNotes";
import { loadMyQuizHistoryDetail } from "../../../lib/myQuizHistory";
import { watchQuizResultCorrections } from "../../../lib/quizResultCorrections";
import { historyReviewQuestion } from "../mypage/historyReviewData";
import MockExamWorkspace from "./MockExamWorkspace";
import { useQuizContentProtection } from "./useQuizContentProtection";
import type {
  MockExamPaperQuestion,
  MockExamPaperCheck,
} from "../../../components/common/MockExamPaper";
import {
  collectMockExamAssets,
  createMockExamAssetLoader,
  MockExamAssetError,
  type MockExamAssetManifest,
  type MockExamAssetProgress,
} from "../../../lib/mockExamAssets";
import {
  buildQuizRelearningItems,
  type QuizRelearningItem,
} from "./quizPracticeData";
import {
  loadQuizScoreComparison,
  type QuizScoreComparison,
} from "../../../lib/quizScoreComparison";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import {
  formatMockExamRoundLabel,
  formatMockExamRoundShortLabel,
  getMockExamResultCategory,
  isAdditionalMockExamRound,
  isMockExamCategory,
  normalizeMockExamRound,
} from "../../../lib/mockExamRounds";
import {
  getQuizSubmissionDeadlineMs,
  normalizeQuizSubmissionDoc,
  readTimestampMs,
  type QuizSubmissionDoc,
} from "../../../lib/quizSubmissions";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  buildAssessmentDefinitionId,
  getAssessmentState,
  isAssessmentRevisionConflict,
  saveAssessmentProgress,
  startAssessmentAttempt,
  submitAssessmentAttempt,
} from "../../../lib/assessmentLifecycle";
import type {
  AssessmentAttemptState,
  AssessmentRewardResult,
  AssessmentStateResponse,
} from "../../../lib/assessmentLifecycle";
import {
  readStudentCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../lib/studentLessonReadCache";

const QUIZ_PROGRESS_SAVE_DELAY_MS = 1500;
const OPERATION_LOADING_DELAY_MS = 600;

interface Question {
  examRound?: string;
  paperOrder?: number;
  points?: number;
  paperBreakBefore?: boolean;
  id: number;
  type: "choice" | "ox" | "short" | "word" | "order" | "matching";
  question: string;
  options?: string[];
  choiceOptionImages?: Array<string | null>;
  answer: string | number;
  matchingPairs?: MatchingPair[];
  matchingLeftOptions?: string[];
  matchingRightOptions?: Array<{ right: string; rightImage?: string | null }>;
  explanation?: string;
  image?: string;
  passage?: string;
  examplePassage?: string;
  passageSet?: {
    id: string;
    instruction: string;
    passage: string;
    image?: string | null;
  };
  hintEnabled?: boolean;
  hint?: string;
  unitId?: string;
  subUnitId?: string;
  refBig?: string;
  refMid?: string;
  refSmall?: string;
  category?: string;
  concepts?: string[];
  cognitiveProcess?: string;
  cognitiveProcesses?: string[];
  familyId?: string;
  reviewLessonId?: string;
  misconceptionTags?: Record<string, string>;
}

interface MatchingPair {
  left: string;
  right: string;
  rightImage?: string | null;
}

interface QuizConfig {
  active: boolean;
  timeLimit?: number;
  allowRetake?: boolean;
  cooldown?: number;
  questionCount?: number;
  hintLimit?: number;
  paperHeader?: { paperTitle?: string; paperHeading?: string };
}

const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";

const normalizeStudentText = (value: unknown) => String(value ?? "").trim();
const normalizeStudentEmail = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const getQuizEntryErrorMessage = (error: unknown) => {
  const failure = error as {
    code?: string;
    details?: { reason?: string };
    customData?: { details?: { reason?: string } };
  };
  const code = String(failure?.code || "").replace(/^functions\//, "");
  const reason =
    failure?.details?.reason || failure?.customData?.details?.reason || "";
  if (reason === "ASSESSMENT_PREREQUISITE_REQUIRED")
    return "앞 회차를 제출한 뒤 응시할 수 있습니다. 평가 목록에서 다시 확인해 주세요.";
  if (reason === "ASSESSMENT_COOLDOWN_ACTIVE")
    return "다시 응시할 수 있는 시간이 되지 않았습니다. 평가 목록에서 다시 확인해 주세요.";
  if (
    ["permission-denied", "not-found"].includes(code) ||
    /ASSESSMENT_(?:NOT_PUBLISHED|WINDOW_CLOSED|ATTEMPT_LIMIT_REACHED|SEMESTER_NOT_ACTIVE)/.test(
      reason,
    )
  )
    return "현재 이 평가에 응시할 수 없습니다. 평가 목록에서 다시 확인해 주세요.";
  if (reason === "SESSION_REAUTH_REQUIRED")
    return "로그인 상태를 다시 확인해야 합니다. 다시 로그인한 뒤 응시해 주세요.";
  if (code === "unauthenticated" || reason.startsWith("SESSION_"))
    return "로그인 연결을 확인하지 못했습니다. 다시 시도해 주세요.";
  if (
    [
      "unavailable",
      "deadline-exceeded",
      "cancelled",
      "internal",
      "unknown",
    ].includes(code) ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  )
    return "서버 연결을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  return "시험지를 불러오지 못했습니다. 다시 시도해 주세요.";
};
const hasStudentAnswer = (value: unknown) =>
  normalizeStudentText(value).length > 0;
const isGeneratedImageChoiceLabel = (value: string, index: number) => {
  const match = value.trim().match(/^(\d+)\s*번\s*보기$/);
  return Boolean(match && Number(match[1]) === index + 1);
};

const buildGradeClassLabel = (
  userData?: {
    grade?: unknown;
    class?: unknown;
    number?: unknown;
  } | null,
) => {
  const grade = normalizeStudentText(userData?.grade);
  const className = normalizeStudentText(userData?.class);
  const number = normalizeStudentText(userData?.number);
  return `${grade}학년 ${className}반 ${number}번`.trim();
};

const QuizRunner: React.FC = () => {
  const contentProtectionRef = useRef<HTMLDivElement>(null);
  useQuizContentProtection(contentProtectionRef);
  const { showToast } = useAppToast();
  const { confirm } = useAppDialog();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const automaticEntryRequested = location.state?.startAssessment === true;
  const automaticEntryConsumedRef = useRef(0);
  const explicitRetakeRequestedRef = useRef(false);
  const [automaticEntryInProgress, setAutomaticEntryInProgress] =
    useState(false);
  const [entryStage, setEntryStage] = useState("응시 상태 확인 중");
  const [entryTakingLong, setEntryTakingLong] = useState(false);
  const initializationGenerationRef = useRef(0);
  const initializedScopeRef = useRef("");
  const { userData, config, currentUser } = useAuth();
  const initialPreparationRef = useRef<{
    scope: string;
    owner: typeof currentUser;
    generation: number;
    state: Pick<AssessmentStateResponse, "status" | "preparedAssets">;
  } | null>(null);

  const unitId = searchParams.get("unitId");
  const category = searchParams.get("category");
  const examRound = isMockExamCategory(category)
    ? normalizeMockExamRound(searchParams.get("round"))
    : "";
  const title =
    isMockExamCategory(category) && examRound
      ? formatMockExamRoundLabel(examRound)
      : searchParams.get("title") || "평가";

  const [view, setView] = useState<"loading" | "entry" | "quiz" | "result">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  const [quizConfig, setQuizConfig] = useState<QuizConfig | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);
  const [activeSubmission, setActiveSubmission] =
    useState<QuizSubmissionDoc | null>(null);
  const [canonicalAttempt, setCanonicalAttemptState] =
    useState<AssessmentAttemptState | null>(null);
  const canonicalAttemptRef = useRef<AssessmentAttemptState | null>(null);
  const setCanonicalAttempt = (
    next: React.SetStateAction<AssessmentAttemptState | null>,
  ) => {
    const value =
      typeof next === "function" ? next(canonicalAttemptRef.current) : next;
    canonicalAttemptRef.current = value;
    setCanonicalAttemptState(value);
  };

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [hintUsedCount, setHintUsedCount] = useState(0);
  const [revealedHints, setRevealedHints] = useState<Record<number, boolean>>(
    {},
  );
  const [orderOptionMap, setOrderOptionMap] = useState<
    Record<number, string[]>
  >({});
  const [matchingActiveLeft, setMatchingActiveLeft] = useState("");
  const matchingConnectionContainerRef = useRef<HTMLDivElement | null>(null);
  const matchingLeftRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const matchingRightRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const [startingQuiz, setStartingQuiz] = useState(false);
  const startingQuizRef = useRef(false);
  const [paperPreparationError, setPaperPreparationError] = useState("");
  const [entryError, setEntryError] = useState("");
  const [paperPreparationProgress, setPaperPreparationProgress] =
    useState<MockExamAssetProgress | null>(null);
  const paperAssetLoaderRef = useRef<ReturnType<
    typeof createMockExamAssetLoader
  > | null>(null);
  const paperPreparationControllerRef = useRef<AbortController | null>(null);
  const preparationGenerationRef = useRef(0);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [quizDeadlineMs, setQuizDeadlineMs] = useState<number | null>(null);

  const [openHintQuestionId, setOpenHintQuestionId] = useState<number | null>(
    null,
  );
  const [score, setScore] = useState(0);
  const [scoreComparison, setScoreComparison] =
    useState<QuizScoreComparison | null>(null);
  const [resultCounts, setResultCounts] = useState({ correct: 0, total: 0 });
  const [reviewItems, setReviewItems] = useState<QuizRelearningItem[]>([]);
  const [updatedReviewItems, setUpdatedReviewItems] =
    useState<QuizRelearningItem[]>();
  const [paperResult, setPaperResult] = useState<{
    questions: MockExamPaperQuestion[];
    checks: MockExamPaperCheck[];
    earnedPoints?: number;
  } | null>(null);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [finishSubmitting, setFinishSubmitting] = useState(false);
  const [showOperationLoading, setShowOperationLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitConflict, setSubmitConflict] = useState(false);
  const [finalizedResultId, setFinalizedResultId] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const telemetryRef = useRef<AssessmentTelemetryCollector | null>(null);
  const pendingSubmitAnalyticsRef = useRef<AssessmentTelemetrySnapshot>();
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [imageReloadKey, setImageReloadKey] = useState(0);
  const questionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const questionNavRef = useRef<HTMLElement | null>(null);
  const curriculumLabelsRef = useRef<Record<string, string>>({});

  const timerRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  const persistInFlightRef = useRef(false);
  const persistSaveTailRef = useRef<Promise<void>>(Promise.resolve());
  const finishSubmittingRef = useRef(false);
  const persistQueuedRef = useRef(false);
  const progressChangeRef = useRef(0);
  const persistQuizProgressRef = useRef<() => Promise<void>>(async () => {});
  const timeoutHandledRef = useRef(false);
  const authIdentityRef = useRef<{ uid: string; email: string }>({
    uid: "",
    email: "",
  });

  const isMockExamAttempt = isMockExamCategory(category);
  const maxHintUses = isMockExamAttempt ? 0 : (quizConfig?.hintLimit ?? 2);
  const canUseHints = maxHintUses > 0;
  const fallbackStudentUid =
    normalizeStudentText(currentUser?.uid) ||
    normalizeStudentText(userData?.uid);
  const fallbackStudentEmail =
    normalizeStudentEmail(currentUser?.email) ||
    normalizeStudentEmail(userData?.email);
  const { year: assessmentYear, semester: assessmentSemester } =
    getYearSemester(config);
  const assessmentDefinitionId =
    unitId && category
      ? buildAssessmentDefinitionId(
          `${assessmentYear}-${assessmentSemester}`,
          "QUIZ",
          unitId,
          category,
          examRound,
        )
      : "";

  useEffect(() => {
    return () => {
      initializationGenerationRef.current += 1;
      preparationGenerationRef.current += 1;
      initialPreparationRef.current = null;
      explicitRetakeRequestedRef.current = false;
      startingQuizRef.current = false;
      paperPreparationControllerRef.current?.abort();
      paperPreparationControllerRef.current = null;
      paperAssetLoaderRef.current?.dispose();
      paperAssetLoaderRef.current = null;
    };
  }, [assessmentDefinitionId, fallbackStudentUid]);

  const operationPending = startingQuiz || finishSubmitting;
  useEffect(() => {
    setShowOperationLoading(false);
    if (!operationPending) return;
    const timer = window.setTimeout(
      () => setShowOperationLoading(true),
      OPERATION_LOADING_DELAY_MS,
    );
    if (view !== "quiz") return () => window.clearTimeout(timer);
    // A focused paper control must not react behind the loading overlay.
    // Keep browser shortcuts available while blocking page keyboard actions.
    const blockKeyboard = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (!event.ctrlKey && !event.metaKey && !event.altKey)
        event.preventDefault();
    };
    window.addEventListener("keydown", blockKeyboard, true);
    window.addEventListener("keyup", blockKeyboard, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", blockKeyboard, true);
      window.removeEventListener("keyup", blockKeyboard, true);
    };
  }, [operationPending, view]);

  const preparePaperAssets = async (manifest: MockExamAssetManifest) => {
    setEntryStage("시험지 그림·글꼴 준비 중");
    const controller = new AbortController();
    paperPreparationControllerRef.current?.abort();
    paperPreparationControllerRef.current = controller;
    const loader =
      paperAssetLoaderRef.current ||
      (paperAssetLoaderRef.current = createMockExamAssetLoader());
    const studentCharacters = `${buildGradeClassLabel(userData)} ${normalizeStudentText(userData?.name)}`;
    try {
      await loader.prepare(
        {
          ...manifest,
          fontCharacters: `${manifest.fontCharacters || ""}${studentCharacters}`,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted)
              setPaperPreparationProgress(progress);
          },
        },
      );
    } finally {
      if (paperPreparationControllerRef.current === controller) {
        paperPreparationControllerRef.current = null;
      }
    }
  };

  // Observation must never interrupt an answer, its save, or server grading.
  const observe = (
    action: (collector: AssessmentTelemetryCollector) => void,
  ) => {
    try {
      if (telemetryRef.current) action(telemetryRef.current);
    } catch {
      telemetryRef.current = null;
    }
  };
  const readTelemetry = (): AssessmentTelemetrySnapshot | undefined => {
    try {
      return telemetryRef.current?.snapshot();
    } catch {
      return undefined;
    }
  };
  const beginTelemetry = (
    attempt: AssessmentAttemptState,
    resumed: boolean,
  ) => {
    pendingSubmitAnalyticsRef.current = undefined;
    try {
      telemetryRef.current = new AssessmentTelemetryCollector(
        attempt.questionIds,
        {
          answers: attempt.answers,
          restored: attempt.analytics || undefined,
          resumed,
        },
      );
    } catch {
      telemetryRef.current = null;
    }
  };
  const currentQuestionImages = [
    selectedQuestions[currentIndex]?.image,
    ...(selectedQuestions[currentIndex]?.type === "choice"
      ? selectedQuestions[currentIndex]?.choiceOptionImages || []
      : []),
    ...(selectedQuestions[currentIndex]?.type === "matching"
      ? selectedQuestions[currentIndex]?.matchingRightOptions ||
        selectedQuestions[currentIndex]?.matchingPairs ||
        []
      : []
    ).map((pair) => pair.rightImage),
  ].filter((source): source is string => !!source);
  const waitingForQuestionImages = currentQuestionImages.some(
    (source) => !loadedImages.has(source),
  );
  const finishImageLoad = (source: string, failed = false) => {
    setLoadedImages((previous) => new Set(previous).add(source));
    if (failed) setFailedImages((previous) => new Set(previous).add(source));
  };

  const mapCanonicalAttemptToSubmission = (
    attempt: AssessmentAttemptState,
  ): QuizSubmissionDoc => ({
    id: attempt.attemptId,
    uid: fallbackStudentUid,
    name: normalizeStudentText(userData?.name),
    email: fallbackStudentEmail,
    class: normalizeStudentText(userData?.class),
    number: normalizeStudentText(userData?.number),
    gradeClass: buildGradeClassLabel(userData),
    unitId: String(unitId || ""),
    category: String(category || ""),
    examRound,
    title,
    status: attempt.status === "SUBMITTED" ? "submitted" : "in_progress",
    questionIds: attempt.questionIds,
    answers: attempt.answers,
    currentIndex: Math.max(
      0,
      attempt.questionIds.indexOf(attempt.currentItemId),
    ),
    hintUsedCount: 0,
    revealedHintIds: [],
    orderOptionMap: {},
    timeLimitSeconds: Math.max(
      60,
      Math.round(
        (Date.parse(attempt.deadlineAtIso) - Date.parse(attempt.startedAtIso)) /
          1000,
      ),
    ),
    clientStartedAtMs: Date.parse(attempt.startedAtIso),
    lastClientSavedAtMs: Date.parse(attempt.lastSavedAtIso),
    startedAt: { seconds: Math.floor(Date.parse(attempt.startedAtIso) / 1000) },
    lastSavedAt: {
      seconds: Math.floor(Date.parse(attempt.lastSavedAtIso) / 1000),
    },
    submittedAt: attempt.submittedAtIso
      ? { seconds: Math.floor(Date.parse(attempt.submittedAtIso) / 1000) }
      : undefined,
    resultId: attempt.resultRef,
  });

  const parseOrderAnswer = (value: string) =>
    value.split(ORDER_DELIMITER).filter(Boolean);

  const parseMatchingPairs = (question: Question): MatchingPair[] => {
    if (question.matchingLeftOptions && question.matchingRightOptions) {
      return question.matchingLeftOptions
        .map((left, index) => ({
          left,
          right: question.matchingRightOptions?.[index]?.right || "",
          rightImage:
            question.matchingRightOptions?.[index]?.rightImage || null,
        }))
        .filter((pair) => pair.left && pair.right);
    }
    if (
      Array.isArray(question.matchingPairs) &&
      question.matchingPairs.length
    ) {
      return question.matchingPairs
        .map((pair) => ({
          left: String(pair.left || "").trim(),
          right: String(pair.right || "").trim(),
          rightImage: pair.rightImage || null,
        }))
        .filter((pair) => pair.left && pair.right);
    }

    return String(question.answer || "")
      .split(ORDER_DELIMITER)
      .map((item) => {
        const [left = "", right = ""] = item.split(MATCHING_PAIR_DELIMITER);
        return { left: left.trim(), right: right.trim(), rightImage: null };
      })
      .filter((pair) => pair.left && pair.right);
  };

  const parseMatchingAnswer = (value: string): Record<string, string> =>
    value
      .split(ORDER_DELIMITER)
      .reduce<Record<string, string>>((result, item) => {
        const [left = "", right = ""] = item.split(MATCHING_PAIR_DELIMITER);
        const normalizedLeft = left.trim();
        const normalizedRight = right.trim();
        if (normalizedLeft && normalizedRight) {
          result[normalizedLeft] = normalizedRight;
        }
        return result;
      }, {});

  const questionsForAttempt = (attempt: AssessmentAttemptState): Question[] => {
    const presentation = new Map(
      (attempt.questionPresentation || []).map((item) => [
        String(item.id),
        item,
      ]),
    );
    const metadata = new Map(
      (attempt.learningSnapshot || []).map((item) => [String(item.id), item]),
    );
    return attempt.questionIds
      .map((id) => {
        const item = presentation.get(id);
        // Only the server-authorized presentation is visible before submission.
        return item
          ? ({
              ...metadata.get(id),
              ...item,
              id: Number(item.id),
              answer: "",
            } as Question)
          : undefined;
      })
      .filter((item): item is Question => !!item);
  };

  const getChoiceOptionImage = (question: Question, index: number) =>
    Array.isArray(question.choiceOptionImages)
      ? question.choiceOptionImages[index] || null
      : null;

  const encodeMatchingAnswer = (
    question: Question,
    valueMap: Record<string, string>,
  ) =>
    parseMatchingPairs(question)
      .map((pair) => {
        const selectedRight = valueMap[pair.left] || "";
        return selectedRight
          ? `${pair.left}${MATCHING_PAIR_DELIMITER}${selectedRight}`
          : "";
      })
      .filter(Boolean)
      .join(ORDER_DELIMITER);

  const formatAnswerForDisplay = (
    value: string | number | undefined,
    type?: Question["type"],
  ) => {
    const text = String(value ?? "");
    if (!text) return "(미입력)";
    if (type === "order") return parseOrderAnswer(text).join(" → ");
    if (type === "matching") {
      return text
        .split(ORDER_DELIMITER)
        .map((item) => item.split(MATCHING_PAIR_DELIMITER).join(" → "))
        .join(", ");
    }
    return text;
  };

  const shuffleItems = <T,>(items: T[]) => {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [next[index], next[target]] = [next[target], next[index]];
    }
    return next;
  };

  const getResolvedStudentUid = () =>
    authIdentityRef.current.uid || fallbackStudentUid;

  const resolveStudentIdentity = async () => {
    const uid = fallbackStudentUid;
    let email = fallbackStudentEmail;

    if (currentUser) {
      try {
        const tokenResult = await currentUser.getIdTokenResult();
        const tokenEmail =
          typeof tokenResult.claims.email === "string"
            ? normalizeStudentEmail(tokenResult.claims.email)
            : "";
        if (tokenEmail) {
          email = tokenEmail;
        }
      } catch (identityError) {
        console.warn("[QuizRunner] Failed to resolve auth token email", {
          uid,
          identityError,
        });
      }
    }

    authIdentityRef.current = { uid, email };
    return authIdentityRef.current;
  };

  const buildOrderOptionMap = (questions: Question[]) => {
    const nextOrderMap: Record<number, string[]> = {};
    questions.forEach((question) => {
      if (question.type !== "order" && question.type !== "matching") return;
      const base =
        question.type === "matching"
          ? parseMatchingPairs(question).map((pair) => pair.right)
          : question.options && question.options.length > 0
            ? [...question.options]
            : String(question.answer || "")
                .split(ORDER_DELIMITER)
                .filter(Boolean);
      nextOrderMap[question.id] = shuffleItems(base);
    });

    return nextOrderMap;
  };

  const restoreSubmissionState = (
    submission: QuizSubmissionDoc,
    questionList: Question[],
    authoritativeServerNowIso: string,
  ) => {
    const restoredHints = submission.revealedHintIds.reduce<
      Record<number, boolean>
    >((accumulator, questionId) => {
      const parsed = Number(questionId);
      if (Number.isFinite(parsed)) {
        accumulator[parsed] = true;
      }
      return accumulator;
    }, {});

    setSelectedQuestions(questionList);
    const restored = restoreAssessmentAnswers(submission.answers, questionList);
    setAnswers(restored.answers);
    if (restored.changed) {
      showToast({
        tone: "warning",
        title: "복원한 답안을 확인해 주세요.",
        message:
          "현재 출제된 문항의 답안을 불러왔습니다. 단답형은 앞 20자까지 복원했습니다.",
      });
    }
    setCurrentIndex(
      Math.min(
        Math.max(0, submission.currentIndex),
        Math.max(0, questionList.length - 1),
      ),
    );
    setHintUsedCount(submission.hintUsedCount);
    setRevealedHints(restoredHints);
    setOrderOptionMap(
      Object.fromEntries(
        Object.entries(submission.orderOptionMap).map(([key, value]) => [
          Number(key),
          value,
        ]),
      ),
    );
    setActiveSubmission(submission);
    const serverNowMs = Date.parse(authoritativeServerNowIso);
    const nextServerOffsetMs = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;
    setServerTimeOffsetMs(nextServerOffsetMs);
    const deadlineMs = getQuizSubmissionDeadlineMs(submission);
    setQuizDeadlineMs(deadlineMs || null);
    const remainingSeconds = deadlineMs
      ? Math.max(
          0,
          Math.ceil((deadlineMs - (Date.now() + nextServerOffsetMs)) / 1000),
        )
      : 0;
    setTimeLeft(remainingSeconds);
    timeoutHandledRef.current = false;
    return remainingSeconds;
  };

  const finalizeQuizAttempt = async (
    options: {
      isTimeout?: boolean;
      questionList?: Question[];
      answerMap?: Record<string, string>;
      hintCount?: number;
      revealedHintIds?: string[];
    } = {},
  ) => {
    if (!getResolvedStudentUid() || !unitId || !category) {
      throw new Error("응시 저장에 필요한 사용자 정보가 없습니다.");
    }
    await resolveStudentIdentity();

    const isTimeout = options.isTimeout === true;
    const questionList = options.questionList || selectedQuestions;
    const answerMap = options.answerMap || answers;
    const hintCount = options.hintCount ?? hintUsedCount;
    const revealedHintIds =
      options.revealedHintIds ||
      Object.entries(revealedHints)
        .filter(([, value]) => value)
        .map(([key]) => String(key));

    await persistSaveTailRef.current;
    const activeAttempt = canonicalAttemptRef.current;
    if (!activeAttempt) {
      throw new Error("응시 상태를 확인할 수 없습니다.");
    }
    observe((collector) => {
      collector.commitAnswer(String(questionList[currentIndex]?.id || ""));
      collector.setRunning(false);
    });
    pendingSubmitAnalyticsRef.current ??= readTelemetry();
    const submitted = await submitAssessmentAttempt({
      attemptId: activeAttempt.attemptId,
      expectedRevision: activeAttempt.revision,
      answers: answerMap,
      submitReason: isTimeout ? "TIMEOUT" : "STUDENT",
      analytics: pendingSubmitAnalyticsRef.current,
    });
    // A different tab may already have submitted. Display the server's frozen
    // answers alongside its checks, never the stale tab's unsubmitted draft.
    const submittedAnswers = submitted.answers ?? answerMap;
    setScore(submitted.percent);
    setPaperResult({
      questions: questionList.map(
        (question) =>
          submitted.questionSnapshots?.find(
            (snapshot) => String(snapshot.id) === String(question.id),
          ) || question,
      ),
      checks: submitted.answerChecks,
      earnedPoints: submitted.earnedPoints,
    });
    setAnswers(submittedAnswers);
    setReviewItems(buildQuizRelearningItems(submitted, submittedAnswers));
    setResultCounts({
      correct: submitted.answerChecks.filter((check) => check.correct === true)
        .length,
      total: submitted.answerChecks.length,
    });
    setFinalizedResultId(submitted.attemptId);
    setActiveSubmission((prev) =>
      prev
        ? normalizeQuizSubmissionDoc(prev.id, {
            ...prev,
            status: isTimeout ? "timed_out" : "submitted",
            answers: submittedAnswers,
            hintUsedCount: hintCount,
            revealedHintIds,
            resultId: submitted.resultRef,
          })
        : prev,
    );
    setQuizDeadlineMs(null);

    setCanonicalAttempt((previous) =>
      previous
        ? {
            ...previous,
            status: "SUBMITTED",
            revision: submitted.revision || previous.revision,
            answers: submittedAnswers,
            paperHeader: submitted.paperHeader || previous.paperHeader,
            resultRef: submitted.resultRef,
          }
        : previous,
    );

    return {
      resultId: submitted.attemptId,
      finalScore: submitted.percent,
      reward: submitted.reward,
      replayedSubmission: submitted.replayedSubmission,
    };
  };

  const persistQuizProgress = async () => {
    if (persistQuizProgressRef.current !== persistQuizProgress) {
      return persistQuizProgressRef.current();
    }
    if (
      !getResolvedStudentUid() ||
      !unitId ||
      !category ||
      !canonicalAttempt ||
      view !== "quiz" ||
      finishSubmittingRef.current ||
      startingQuiz
    ) {
      return;
    }
    if (persistInFlightRef.current) {
      persistQueuedRef.current = true;
      return;
    }

    persistInFlightRef.current = true;
    const savingChange = progressChangeRef.current;
    setSaveStatus("saving");

    try {
      const pendingSave = saveAssessmentProgress({
        attemptId: canonicalAttempt.attemptId,
        expectedRevision: canonicalAttempt.revision,
        answers,
        currentItemId: String(selectedQuestions[currentIndex]?.id || ""),
        analytics: readTelemetry(),
      }).then((saved) => {
        setCanonicalAttempt((previous) =>
          previous?.attemptId === canonicalAttempt.attemptId &&
          ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(previous.status) &&
          previous.revision <= saved.revision
            ? {
                ...previous,
                status: "IN_PROGRESS",
                revision: saved.revision,
                answers,
                currentItemId: String(
                  selectedQuestions[currentIndex]?.id || "",
                ),
                lastSavedAtIso: saved.savedAtIso,
              }
            : previous,
        );
      });
      persistSaveTailRef.current = pendingSave.then(
        () => undefined,
        () => undefined,
      );
      await pendingSave;
      setSaveStatus(
        savingChange === progressChangeRef.current ? "saved" : "pending",
      );
    } catch (saveError) {
      setSaveStatus("error");
      console.error("Failed to save quiz progress", {
        attemptId: canonicalAttempt.attemptId,
        saveError,
      });
    } finally {
      persistInFlightRef.current = false;
      if (persistQueuedRef.current) {
        persistQueuedRef.current = false;
        schedulePersistQuizProgress();
      }
    }
  };
  // Debounced saves must use the committed answer and revision from the latest render.
  persistQuizProgressRef.current = persistQuizProgress;

  useEffect(() => {
    setOpenHintQuestionId(null);
  }, [currentIndex]);

  useEffect(() => {
    if (view !== "result" || !finalizedResultId || !fallbackStudentUid) return;
    let active = true;
    const semesterId = `${assessmentYear}-${assessmentSemester}`;
    const stop = watchQuizResultCorrections({
      resultId: finalizedResultId,
      semesterId,
      onChange: async () => {
        const latest = await loadMyQuizHistoryDetail(
          semesterId,
          `canonical:${finalizedResultId}`,
        );
        if (!active) return;
        const rows = (latest.record.details || []).map(historyReviewQuestion);
        const checks = rows.map((row) => ({
          id: row.snapshot.id,
          correct: row.correct === true,
        }));
        if (typeof latest.record.score === "number")
          setScore(latest.record.score);
        setResultCounts({
          correct: checks.filter((check) => check.correct).length,
          total: checks.length,
        });
        setUpdatedReviewItems(rows.map((row) => row.snapshot));
        setReviewItems(
          rows
            .filter((row) => row.practiceAvailable)
            .map((row) => row.snapshot),
        );
        setPaperResult((previous) => ({
          questions:
            previous?.questions.map(
              (question) =>
                rows.find(
                  (row) =>
                    row.snapshot.id === String(question.id) &&
                    row.saved.questionAvailable,
                )?.snapshot || question,
            ) || rows.map((row) => row.snapshot),
          checks,
          earnedPoints:
            typeof latest.record.earnedPoints === "number"
              ? latest.record.earnedPoints
              : undefined,
        }));
      },
      onError: () =>
        showToast({
          tone: "warning",
          title: "변경된 평가 결과를 확인하지 못했습니다.",
          message: "오답 노트에서 결과를 다시 확인해 주세요.",
        }),
    });
    return () => {
      active = false;
      stop();
    };
  }, [
    view,
    finalizedResultId,
    fallbackStudentUid,
    assessmentYear,
    assessmentSemester,
  ]);

  useEffect(() => {
    let active = true;
    setScoreComparison(null);
    if (
      view !== "result" ||
      isMockExamAttempt ||
      !finalizedResultId ||
      !fallbackStudentUid ||
      !canonicalAttempt?.definitionId ||
      resultCounts.total === 0
    )
      return;
    void loadQuizScoreComparison({
      config,
      studentUid: fallbackStudentUid,
      semesterId: `${assessmentYear}-${assessmentSemester}`,
      definitionId: canonicalAttempt.definitionId,
      currentAttemptId: finalizedResultId,
      currentScorePercent: score,
    })
      .then((comparison) => {
        if (active) setScoreComparison(comparison);
      })
      .catch(() => {
        // Optional prior-score reads must never block the saved result or actions.
      });
    return () => {
      active = false;
    };
  }, [
    view,
    isMockExamAttempt,
    finalizedResultId,
    fallbackStudentUid,
    canonicalAttempt?.definitionId,
    assessmentYear,
    assessmentSemester,
    score,
    resultCounts.total,
  ]);

  useEffect(() => {
    observe((collector) => {
      collector.setRunning(
        view === "quiz" && !finishSubmitting && !waitingForQuestionImages,
      );
      collector.setVisible(document.visibilityState !== "hidden");
      if (view === "quiz") {
        collector.visit(String(selectedQuestions[currentIndex]?.id || ""));
      }
    });
  }, [
    view,
    currentIndex,
    selectedQuestions,
    finishSubmitting,
    waitingForQuestionImages,
  ]);

  useEffect(() => {
    const updateVisibility = () => {
      observe((collector) =>
        collector.setVisible(document.visibilityState !== "hidden"),
      );
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observe((collector) => collector.setRunning(false));
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (view !== "quiz") return;
    questionHeadingRef.current?.focus({ preventScroll: true });
    questionNavRef.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    questionHeadingRef.current
      ?.closest(".student-quiz-shell")
      ?.querySelectorAll(
        ".student-quiz-body-split, .student-quiz-question-panel, .student-quiz-answer-panel",
      )
      .forEach((panel) => {
        panel.scrollTop = 0;
      });
  }, [view, currentIndex]);

  const schedulePersistQuizProgress = () => {
    if (view !== "quiz" || finishSubmittingRef.current || startingQuiz) return;
    progressChangeRef.current += 1;
    setSaveStatus("pending");
    if (persistTimeoutRef.current) {
      window.clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      void persistQuizProgress();
    }, QUIZ_PROGRESS_SAVE_DELAY_MS);
  };

  useEffect(() => {
    if (!fallbackStudentUid) {
      authIdentityRef.current = { uid: "", email: "" };
      return;
    }

    void resolveStudentIdentity();
  }, [fallbackStudentUid, fallbackStudentEmail, currentUser]);

  useEffect(() => {
    if (!fallbackStudentUid) return;
    if (!unitId || !category) {
      setBlockReason(
        "평가 링크에 필요한 정보가 없습니다. 평가 목록에서 다시 선택해 주세요.",
      );
      setErrorMsg(null);
      setSelectedQuestions([]);
      setActiveSubmission(null);
      setCanonicalAttempt(null);
      setView("entry");
      return;
    }
    void initializeQuiz();

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
        void persistQuizProgress();
      }
    };
  }, [
    assessmentYear,
    assessmentSemester,
    unitId,
    category,
    examRound,
    fallbackStudentUid,
  ]);

  useEffect(() => {
    if (view !== "quiz" || !canonicalAttempt) return;

    return () => {
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
        void persistQuizProgress();
      }
    };
  }, [canonicalAttempt?.attemptId, view]);

  useEffect(() => {
    if (view !== "quiz" || !quizDeadlineMs || finishSubmitting) return;

    const updateTimer = () => {
      const nextTimeLeft = Math.max(
        0,
        Math.ceil((quizDeadlineMs - (Date.now() + serverTimeOffsetMs)) / 1000),
      );
      setTimeLeft(nextTimeLeft);
      if (nextTimeLeft <= 0 && !timeoutHandledRef.current) {
        timeoutHandledRef.current = true;
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        void finishQuiz(true);
      }
    };

    updateTimer();
    timerRef.current = window.setInterval(updateTimer, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [view, quizDeadlineMs, serverTimeOffsetMs, finishSubmitting]);

  useEffect(() => {
    if (view !== "quiz" || finishSubmitting) return undefined;
    emitSessionActivity();
    const timerId = window.setInterval(emitSessionActivity, 60 * 1000);
    return () => window.clearInterval(timerId);
  }, [finishSubmitting, view]);

  const initializeQuiz = async (retakeRequested = false) => {
    if (retakeRequested) explicitRetakeRequestedRef.current = true;
    setReviewItems([]);
    setUpdatedReviewItems(undefined);
    if (!unitId || !category || !fallbackStudentUid) return;
    const generation = ++initializationGenerationRef.current;
    // Explicit recovery replaces every phase of the previous entry. A late
    // START/assets response must not clear or overwrite the new entry's state.
    preparationGenerationRef.current += 1;
    paperPreparationControllerRef.current?.abort();
    paperPreparationControllerRef.current = null;
    const isCurrent = () => initializationGenerationRef.current === generation;
    initializedScopeRef.current = "";
    initialPreparationRef.current = null;

    try {
      setView("loading");
      setEntryStage("응시 상태 확인 중");
      setEntryTakingLong(false);
      setOpenHintQuestionId(null);
      setErrorMsg(null);
      setBlockReason(null);
      setStartingQuiz(false);
      setAutomaticEntryInProgress(false);
      startingQuizRef.current = false;
      setEntryError("");
      setPaperPreparationError("");
      setPaperPreparationProgress(null);
      setFinishSubmitting(false);
      setSubmitError("");
      setSubmitConflict(false);
      setActiveSubmission(null);
      setQuizDeadlineMs(null);
      setServerTimeOffsetMs(0);
      setSaveStatus("idle");
      telemetryRef.current = null;
      timeoutHandledRef.current = false;

      const curriculumRead = isMockExamAttempt
        ? null
        : readStudentCurriculumTree(config).then(
            (tree) => ({ ok: true as const, tree }),
            (error: unknown) => ({ ok: false as const, error }),
          );
      let preparationChecked = isMockExamAttempt;
      const assessmentState = await getAssessmentState({
        definitionId: assessmentDefinitionId,
        ...(isMockExamAttempt ? { prepareAssets: true } : {}),
      }).catch(async (error: unknown) => {
        const failure = error as {
          details?: { reason?: string };
          customData?: { details?: { reason?: string } };
        };
        const reason =
          failure?.details?.reason || failure?.customData?.details?.reason;
        if (
          !isMockExamAttempt ||
          reason !== "ASSESSMENT_ASSET_PREPARATION_FORBIDDEN"
        )
          throw error;
        if (!isCurrent()) throw error;
        // A closed paper may still contain an authorized recoverable attempt.
        // Retain the ordinary state gates; this fallback does not authorize
        // preparation or a new START and is never reused as a prepared state.
        preparationChecked = false;
        return getAssessmentState({ definitionId: assessmentDefinitionId });
      });
      if (!isCurrent()) return;
      if (!assessmentState.definition) {
        setBlockReason(
          "유효하지 않거나 더 이상 사용할 수 없는 평가 링크입니다.",
        );
        setView("entry");
        return;
      }
      setAssessmentTitle(
        normalizeStudentText(assessmentState.definition.title),
      );
      const stateBlockReason =
        assessmentState.status === "PREREQUISITE_REQUIRED"
          ? `${formatMockExamRoundShortLabel(assessmentState.requiredRound || "round_1")}를 제출한 뒤 응시할 수 있습니다.`
          : assessmentState.status === "PERMISSION"
            ? "현재 학기·학급 배정으로는 이 평가에 응시할 수 없습니다."
            : assessmentState.status === "NOT_OPEN"
              ? "아직 응시할 수 있도록 공개되지 않은 평가입니다."
              : assessmentState.status === "CLOSED"
                ? "응시 기간이 종료된 평가입니다."
                : assessmentState.status === "ARCHIVED"
                  ? "지난 학기 평가로, 읽기 전용입니다."
                  : "";
      if (stateBlockReason) {
        setBlockReason(stateBlockReason);
        setView("entry");
        return;
      }

      const visitLabels = (items: StudentCurriculumTreeItem[]) => {
        items.forEach((item) => {
          curriculumLabelsRef.current[item.id] = item.title;
          visitLabels(item.children || []);
        });
      };
      curriculumLabelsRef.current = {};
      // Labels enrich the review only. A slow or unavailable curriculum read
      // must not block an authorized server paper or start its clock late.
      void curriculumRead?.then((result) => {
        if (isCurrent() && result.ok) visitLabels(result.tree);
      });
      const definition = assessmentState.definition;
      const settings = definition.presentationSettings;
      const nextQuizConfig: QuizConfig = {
        active: definition.status === "PUBLISHED",
        timeLimit: definition.durationSeconds,
        allowRetake: definition.maxAttempts > 1,
        cooldown: definition.cooldownMinutes,
        questionCount: Math.min(
          definition.questionCount || definition.itemCount,
          definition.itemCount,
        ),
        hintLimit: Number(settings?.hintLimit) || 0,
        paperHeader: {
          paperTitle:
            typeof settings?.paperTitle === "string" ? settings.paperTitle : "",
          paperHeading:
            typeof settings?.paperHeading === "string"
              ? settings.paperHeading
              : "",
        },
      };
      setQuizConfig(nextQuizConfig);

      const canonicalExistingAttempt = assessmentState.attempt;
      setCanonicalAttempt(canonicalExistingAttempt);
      const existingSubmission = canonicalExistingAttempt
        ? mapCanonicalAttemptToSubmission(canonicalExistingAttempt)
        : null;

      if (existingSubmission?.status === "in_progress") {
        if (canonicalExistingAttempt)
          beginTelemetry(canonicalExistingAttempt, true);
        const restoredQuestions = canonicalExistingAttempt
          ? questionsForAttempt(canonicalExistingAttempt)
          : [];

        if (
          restoredQuestions.length === existingSubmission.questionIds.length
        ) {
          restoreSubmissionState(
            existingSubmission,
            restoredQuestions,
            assessmentState.serverNowIso,
          );
          initializedScopeRef.current = `${fallbackStudentUid}:${assessmentDefinitionId}`;
          setView("entry");
          return;
        }
      }

      if (!nextQuizConfig.questionCount) {
        setBlockReason("이 평가에 등록된 문항이 없습니다.");
        setView("entry");
        return;
      }

      if (canonicalExistingAttempt?.status === "SUBMITTED") {
        // A refresh/back navigation must not consume another permitted attempt.
        // Retakes are requested explicitly from the assessment list.
        if (!automaticEntryRequested && !explicitRetakeRequestedRef.current) {
          navigate("/student/quiz", { replace: true });
          return;
        }
        if (
          canonicalExistingAttempt.attemptNumber >=
          assessmentState.definition.maxAttempts
        ) {
          setBlockReason("응시 가능 횟수를 모두 사용했습니다.");
          setView("entry");
          return;
        }
        const retryAt =
          Date.parse(canonicalExistingAttempt.submittedAtIso) +
          assessmentState.definition.cooldownMinutes * 60000;
        if (retryAt > Date.parse(assessmentState.serverNowIso)) {
          setBlockReason(
            `${Math.ceil((retryAt - Date.parse(assessmentState.serverNowIso)) / 60000)}분 후 다시 응시할 수 있습니다.`,
          );
          setView("entry");
          return;
        }
      }
      // A fresh attempt receives its selected questions only when the server starts it.
      setSelectedQuestions([]);
      setOrderOptionMap({});
      setCurrentIndex(0);
      setAnswers({});
      setHintUsedCount(0);
      setRevealedHints({});
      setTimeLeft(nextQuizConfig.timeLimit || 60);
      initializedScopeRef.current = `${fallbackStudentUid}:${assessmentDefinitionId}`;
      if (preparationChecked) {
        initialPreparationRef.current = {
          scope: initializedScopeRef.current,
          owner: currentUser,
          generation,
          state: {
            status: assessmentState.status,
            preparedAssets: assessmentState.preparedAssets,
          },
        };
      }
      setView("entry");
    } catch (error) {
      if (!isCurrent()) return;
      const failure = error as {
        details?: { reason?: string; requiredRound?: string };
        customData?: {
          details?: {
            reason?: string;
            requiredRound?: string;
          };
        };
      };
      const details = failure?.details || failure?.customData?.details;
      if (details?.reason === "ASSESSMENT_PREREQUISITE_REQUIRED") {
        setBlockReason(
          `${formatMockExamRoundShortLabel(details.requiredRound || "round_1")}를 제출한 뒤 응시할 수 있습니다.`,
        );
      } else if (details?.reason === "ASSESSMENT_ATTEMPT_LIMIT_REACHED") {
        setBlockReason("응시 가능 횟수를 모두 사용했습니다.");
      } else if (
        details?.reason === "ASSESSMENT_ASSET_PREPARATION_FORBIDDEN" ||
        details?.reason === "ASSESSMENT_COOLDOWN_ACTIVE"
      ) {
        setBlockReason(getQuizEntryErrorMessage(error));
      } else {
        setErrorMsg(getQuizEntryErrorMessage(error));
      }
      setView("entry");
    }
  };

  const startQuiz = async (automaticEntry = false) => {
    if (
      !unitId ||
      !category ||
      !fallbackStudentUid ||
      (!quizConfig?.questionCount &&
        activeSubmission?.status !== "in_progress") ||
      startingQuizRef.current
    ) {
      return;
    }

    startingQuizRef.current = true;
    setStartingQuiz(true);
    setAutomaticEntryInProgress(automaticEntry);
    setEntryError("");
    setPaperPreparationError("");
    const generation = preparationGenerationRef.current;
    const assertCurrent = () => {
      if (preparationGenerationRef.current !== generation) {
        throw new DOMException("응시 준비가 취소되었습니다.", "AbortError");
      }
    };
    try {
      if (activeSubmission?.status === "in_progress") {
        if (
          isMockExamAttempt &&
          quizDeadlineMs &&
          quizDeadlineMs <= Date.now() + serverTimeOffsetMs
        ) {
          // An unavailable image must never prevent finishing an expired
          // attempt with the answers already saved on the server.
          timeoutHandledRef.current = true;
          await finishQuiz(true);
          return;
        }
        if (isMockExamAttempt) {
          await preparePaperAssets(collectMockExamAssets(selectedQuestions));
          assertCurrent();
        }
        emitSessionActivity();
        setTimeLeft(
          quizDeadlineMs
            ? Math.max(
                0,
                Math.ceil(
                  (quizDeadlineMs - (Date.now() + serverTimeOffsetMs)) / 1000,
                ),
              )
            : 0,
        );
        timeoutHandledRef.current = false;
        explicitRetakeRequestedRef.current = false;
        setView("quiz");
        return;
      }

      // Identity is resolved independently; START verifies the authenticated
      // account on the server and does not use a client-supplied email.
      assertCurrent();
      const startPreparedAttempt = async () => {
        let preparedSourceHash: string | undefined;
        if (isMockExamAttempt) {
          const initial = initialPreparationRef.current;
          // Consume once: every explicit retry and stale-source retry must
          // recheck the server instead of reusing an earlier authorization.
          initialPreparationRef.current = null;
          const prepared =
            initial?.scope ===
              `${fallbackStudentUid}:${assessmentDefinitionId}` &&
            initial.owner === currentUser &&
            initial.generation === initializationGenerationRef.current
              ? initial.state
              : await getAssessmentState({
                  definitionId: assessmentDefinitionId,
                  prepareAssets: true,
                });
          assertCurrent();
          if (
            !["READY", "RECOVERABLE", "SUBMITTED"].includes(prepared.status)
          ) {
            throw new Error(
              "현재 이 평가를 시작할 수 없습니다. 평가 목록에서 다시 확인해 주세요.",
            );
          }
          if (prepared.preparedAssets) {
            await preparePaperAssets(prepared.preparedAssets);
            preparedSourceHash = prepared.preparedAssets.sourceHash;
          } else {
            // A historical random paper has no fixed selection to preload.
            // Its authorized snapshot is still prepared before it is shown.
            await preparePaperAssets({ imageUrls: [] });
          }
          assertCurrent();
        }
        setEntryStage("시험 시작 확인 중");
        setPaperPreparationProgress(null);
        return startAssessmentAttempt({
          definitionId: assessmentDefinitionId,
          ...(preparedSourceHash ? { preparedSourceHash } : {}),
        });
      };
      let attempt: AssessmentAttemptState;
      try {
        attempt = await startPreparedAttempt();
      } catch (error) {
        const failure = error as {
          details?: { reason?: string };
          customData?: { details?: { reason?: string } };
        };
        const reason =
          failure?.details?.reason || failure?.customData?.details?.reason;
        if (reason !== "ASSESSMENT_PREPARED_SOURCE_STALE") throw error;
        // A teacher saved a new paper during preparation. Recheck once,
        // without creating an attempt for the outdated asset manifest.
        attempt = await startPreparedAttempt();
      }
      assertCurrent();
      const startedState =
        !attempt.serverNowIso || !attempt.questionPresentation?.length
          ? await getAssessmentState({ attemptId: attempt.attemptId })
          : null;
      assertCurrent();
      const committedAttempt = startedState?.attempt || attempt;
      const committedQuestions = questionsForAttempt(committedAttempt);
      if (committedQuestions.length !== attempt.questionIds.length) {
        throw new Error(
          "응시 문항이 변경되어 불러올 수 없습니다. 선생님께 확인해 주세요.",
        );
      }
      const committedSubmission =
        mapCanonicalAttemptToSubmission(committedAttempt);

      explicitRetakeRequestedRef.current = false;
      setAnswers({});
      setCurrentIndex(0);
      setHintUsedCount(0);
      setRevealedHints({});
      setCanonicalAttempt(committedAttempt);
      beginTelemetry(committedAttempt, attempt.resumed);
      restoreSubmissionState(
        committedSubmission,
        committedQuestions,
        startedState?.serverNowIso || attempt.serverNowIso!,
      );
      // Question numbers follow the frozen server attempt in both the runner
      // and result history. Only order/matching answer choices are shuffled.
      setOrderOptionMap(buildOrderOptionMap(committedQuestions));
      if (isMockExamAttempt) {
        // Also covers an already-running attempt resumed by the server and
        // old snapshots. Deadline/remaining time remain server-authoritative.
        await preparePaperAssets(collectMockExamAssets(committedQuestions));
        assertCurrent();
      }
      setView("quiz");
    } catch (error) {
      if (preparationGenerationRef.current !== generation) return;
      if (error instanceof MockExamAssetError) {
        setPaperPreparationError(error.message);
        return;
      }
      console.error("Failed to start quiz attempt", {
        code:
          typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code || "")
            : "",
      });
      setEntryError(getQuizEntryErrorMessage(error));
    } finally {
      if (preparationGenerationRef.current === generation) {
        startingQuizRef.current = false;
        setStartingQuiz(false);
        setAutomaticEntryInProgress(false);
        setPaperPreparationProgress(null);
      }
    }
  };

  useEffect(() => {
    if (
      view !== "entry" ||
      errorMsg ||
      blockReason ||
      entryError ||
      paperPreparationError ||
      (!quizConfig?.questionCount &&
        activeSubmission?.status !== "in_progress") ||
      initializedScopeRef.current !==
        `${fallbackStudentUid}:${assessmentDefinitionId}` ||
      automaticEntryConsumedRef.current === initializationGenerationRef.current
    )
      return;
    // Every authorized entry opens the paper directly, including refresh and
    // old links without router state. Consume this initialization before START
    // so StrictMode, state changes and failed requests cannot start it twice.
    automaticEntryConsumedRef.current = initializationGenerationRef.current;
    if (automaticEntryRequested) {
      // Retain explicit intent across an in-flight START and its recovery.
      // The router flag is consumed now; the intent ends at a confirmed START.
      explicitRetakeRequestedRef.current = true;
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: { ...location.state, startAssessment: false },
      });
    }
    void startQuiz(true);
  }, [
    automaticEntryRequested,
    view,
    errorMsg,
    blockReason,
    entryError,
    paperPreparationError,
    quizConfig?.questionCount,
    activeSubmission?.status,
    fallbackStudentUid,
    assessmentDefinitionId,
  ]);

  const entryPending =
    view === "loading" ||
    automaticEntryInProgress ||
    (view === "entry" &&
      !blockReason &&
      !errorMsg &&
      !entryError &&
      !paperPreparationError);
  useEffect(() => {
    setEntryTakingLong(false);
    if (!entryPending) return;
    const timer = window.setTimeout(() => setEntryTakingLong(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [entryPending, entryStage]);

  const handleAnswer = (input: string) => {
    const question = selectedQuestions[currentIndex];
    if (!question || finishSubmittingRef.current) return;
    const value =
      question.type === "short" || question.type === "word"
        ? limitShortAnswer(input)
        : input;
    if (answers[String(question.id)] === value) return;
    pendingSubmitAnalyticsRef.current = undefined;

    emitSessionActivity();
    const completedSelection =
      question.type === "choice" ||
      question.type === "ox" ||
      (question.type === "order" &&
        parseOrderAnswer(value).length ===
          (orderOptionMap[question.id] || question.options || []).length) ||
      (question.type === "matching" &&
        parseMatchingPairs(question).every((pair) =>
          Boolean(parseMatchingAnswer(value)[pair.left]),
        ));
    observe((collector) =>
      collector.answer(String(question.id), value, completedSelection),
    );
    setAnswers((prev) => ({
      ...prev,
      [String(question.id)]: value,
    }));
    schedulePersistQuizProgress();
  };

  const isQuestionAnswered = (question: Question) => {
    const answer = answers[String(question.id)] || "";
    if (!hasStudentAnswer(answer)) return false;
    if (question.type === "order") {
      const expected = orderOptionMap[question.id] || question.options || [];
      return (
        expected.length > 0 &&
        parseOrderAnswer(answer).length === expected.length
      );
    }
    if (question.type === "matching") {
      const pairs = parseMatchingPairs(question);
      const selected = parseMatchingAnswer(answer);
      return pairs.length > 0 && pairs.every((pair) => !!selected[pair.left]);
    }
    return true;
  };

  const appendOrderSelection = (option: string) => {
    const question = selectedQuestions[currentIndex];
    if (!question) return;

    const current = parseOrderAnswer(answers[String(question.id)] || "");
    if (current.includes(option)) return;
    handleAnswer([...current, option].join(ORDER_DELIMITER));
  };

  const removeOrderSelection = (index: number) => {
    const question = selectedQuestions[currentIndex];
    if (!question) return;

    const current = parseOrderAnswer(answers[String(question.id)] || "");
    handleAnswer(
      current
        .filter((_, itemIndex) => itemIndex !== index)
        .join(ORDER_DELIMITER),
    );
  };

  const handleMatchingRightSelect = (right: string) => {
    const question = selectedQuestions[currentIndex];
    if (!question || question.type !== "matching" || !matchingActiveLeft) {
      return;
    }

    const current = parseMatchingAnswer(answers[String(question.id)] || "");
    const next = { ...current, [matchingActiveLeft]: right };
    handleAnswer(encodeMatchingAnswer(question, next));
    setMatchingActiveLeft("");
  };

  const revealHint = (question: Question) => {
    if (isMockExamAttempt) return;
    const questionId = question.id;
    if (revealedHints[questionId]) return;
    if (!canUseHints || hintUsedCount >= maxHintUses) {
      alert(
        `힌트는 한 번의 평가에서 최대 ${maxHintUses}회만 사용할 수 있습니다.`,
      );
      return;
    }
    emitSessionActivity();
    observe((collector) => collector.markHintViewed(String(questionId)));
    setRevealedHints((prev) => ({
      ...prev,
      [questionId]: true,
    }));
    setHintUsedCount((prev) => prev + 1);
    schedulePersistQuizProgress();
  };

  const nextQuestion = async (submitAll = false) => {
    if (finishSubmittingRef.current) return;
    emitSessionActivity();
    if (!submitAll && currentIndex < selectedQuestions.length - 1) {
      setMatchingActiveLeft("");
      setCurrentIndex((prev) => prev + 1);
      schedulePersistQuizProgress();
      return;
    }

    const incompleteCount = selectedQuestions.filter(
      (item) => !isQuestionAnswered(item),
    ).length;
    const confirmed = await confirm({
      title: "평가를 제출할까요?",
      message: `${incompleteCount ? `답안을 완성하지 않은 문제가 ${incompleteCount}개 있습니다. ` : "모든 문제에 답안을 입력했습니다. "}제출 후에는 답안을 수정할 수 없습니다.`,
      confirmLabel: "제출하기",
      cancelLabel: "계속 풀기",
      tone: "warning",
    });
    if (!confirmed) {
      return;
    }

    void finishQuiz();
  };

  const prevQuestion = () => {
    if (currentIndex <= 0 || finishSubmittingRef.current) return;
    emitSessionActivity();
    setMatchingActiveLeft("");
    setCurrentIndex((prev) => prev - 1);
    schedulePersistQuizProgress();
  };

  const goToQuestion = async (targetIndex: number) => {
    if (finishSubmittingRef.current) return;
    if (targetIndex < 0 || targetIndex >= selectedQuestions.length) return;
    if (targetIndex === currentIndex) return;

    emitSessionActivity();
    setMatchingActiveLeft("");
    setCurrentIndex(targetIndex);
    schedulePersistQuizProgress();
  };

  const applyQuizPointReward = (
    pointResult: AssessmentRewardResult | undefined,
    replayedSubmission: boolean,
  ) => {
    if (
      !pointResult ||
      replayedSubmission ||
      ["NOT_RECORDED", "DISABLED", "NOT_ELIGIBLE", "DUPLICATE"].includes(
        pointResult.status,
      )
    )
      return;
    if (
      pointResult.awarded &&
      (pointResult.totalAwarded || pointResult.amount)
    ) {
      try {
        notifyPointsUpdated();
      } catch (error) {
        console.error("Failed to refresh confirmed quiz point reward", error);
      }
    }
  };

  const finishQuiz = async (isTimeout = false) => {
    if (finishSubmittingRef.current) return;
    finishSubmittingRef.current = true;
    if (!isTimeout) {
      emitSessionActivity();
    }

    setFinishSubmitting(true);
    setSubmitError("");
    setSubmitConflict(false);
    if (persistTimeoutRef.current) {
      window.clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      if (isTimeout) {
        alert("제한 시간이 종료되었습니다.");
      }

      const finalized = await finalizeQuizAttempt({ isTimeout });
      setFinalizedResultId(finalized.resultId);

      applyQuizPointReward(finalized.reward, finalized.replayedSubmission);

      setView("result");
    } catch (error) {
      console.error("Failed to finish quiz", error);
      const message = isAssessmentRevisionConflict(error)
        ? "다른 창에서 답안이 변경되었습니다. 입력한 답안을 보관한 뒤 새로고침하여 저장 상태를 확인해 주세요."
        : "제출을 완료하지 못했습니다. 연결을 확인한 뒤 다시 제출해 주세요.";
      setSubmitError(message);
      setSubmitConflict(isAssessmentRevisionConflict(error));
      showToast({
        tone: "error",
        title: "문제 풀이 결과 저장에 실패했습니다.",
        message,
      });
    } finally {
      finishSubmittingRef.current = false;
      setFinishSubmitting(false);
    }
  };

  const operationLoadingOverlay =
    showOperationLoading && operationPending
      ? createPortal(
          <LoadingOverlay zIndexClassName="z-[1400]" />,
          document.body,
        )
      : null;

  if (entryPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <PageLoading message="문제를 준비하는 중입니다." />
        <p role="status" className="pb-4 text-sm text-slate-600">
          {entryStage}
          {paperPreparationProgress &&
            ` · ${paperPreparationProgress.loaded}/${paperPreparationProgress.total}`}
        </p>
        {entryTakingLong && (
          <button
            type="button"
            onClick={() => void initializeQuiz()}
            className="mb-4 min-h-11 rounded-lg border border-slate-200 px-5 font-bold text-slate-700"
          >
            응시 상태 다시 확인
          </button>
        )}
      </div>
    );
  }

  if (view === "entry") {
    return (
      <div className="ws-page ws-page--reading">
        <h1 className="text-xl font-bold">{title}</h1>
        <p role="alert" className="my-4 text-sm text-red-600">
          {blockReason || errorMsg || paperPreparationError || entryError}
        </p>
        <div className="flex flex-wrap gap-3">
          {!blockReason && (
            <button
              type="button"
              onClick={() => void initializeQuiz()}
              disabled={startingQuiz}
              className="min-h-11 rounded-lg bg-blue-600 px-5 font-bold text-white disabled:opacity-50"
            >
              {paperPreparationError ? "자료 다시 불러오기" : "다시 시도"}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/student/quiz", { replace: true })}
            className="min-h-11 rounded-lg border border-slate-200 px-5 font-bold text-slate-700"
          >
            평가 목록
          </button>
        </div>
      </div>
    );
  }

  if (view === "quiz") {
    const question = selectedQuestions[currentIndex];
    if (!question) {
      return (
        <div className="flex h-screen items-center justify-center font-bold text-gray-500">
          문항을 불러오지 못했습니다.
        </div>
      );
    }

    if (isMockExamAttempt) {
      return (
        <>
          {operationLoadingOverlay}
          <MockExamWorkspace
            questions={selectedQuestions}
            paperHeader={
              canonicalAttempt
                ? canonicalAttempt.paperHeader || {}
                : quizConfig?.paperHeader
            }
            answers={answers}
            round={examRound}
            studentLabel={`${buildGradeClassLabel(userData)}　이름: ${normalizeStudentText(userData?.name)}`}
            currentIndex={currentIndex}
            onSelect={(index) => void goToQuestion(index)}
            onAnswer={handleAnswer}
            onSubmit={() => {
              if (submitError && !submitConflict)
                void finishQuiz(timeoutHandledRef.current);
              else void nextQuestion(true);
            }}
            submitting={finishSubmitting}
            submitError={submitError}
            submitConflict={submitConflict}
            timeLeft={timeLeft}
            saveStatus={saveStatus}
            onSaveRetry={() => void persistQuizProgress()}
            orderOptions={orderOptionMap}
            onImageReady={finishImageLoad}
            answeredCount={selectedQuestions.filter(isQuestionAnswered).length}
          />
        </>
      );
    }

    const currentAnswer = answers[String(question.id)] || "";
    const answeredQuestionCount =
      selectedQuestions.filter(isQuestionAnswered).length;
    const incompleteIndexes = selectedQuestions.flatMap((item, index) =>
      isQuestionAnswered(item) ? [] : [index],
    );
    const passageText = String(question.passage || "").trim();
    const hasQuestionSupportPanel = !!question.image || !!passageText;
    const hasChoiceOptionImages =
      question.type === "choice" &&
      (question.choiceOptionImages || []).some(Boolean);
    const choiceColumnCount = getQuizChoiceColumnCount(question.options || []);
    const selectedOrderItems =
      question.type === "order" ? parseOrderAnswer(currentAnswer) : [];
    const orderOptions =
      question.type === "order"
        ? orderOptionMap[question.id] || question.options || []
        : [];
    const orderSlotCount =
      question.type === "order"
        ? Math.max(orderOptions.length, selectedOrderItems.length, 1)
        : 0;
    const answerPanelLabel = question.type === "order" ? "보기" : "답안";
    const assessmentCategoryLabel =
      category === "diagnostic"
        ? "진단평가"
        : category === "formative"
          ? "형성평가"
          : "모의고사";
    const safeAssessmentTitle = String(title || "").trim();
    const assessmentBadgeLabel = isMockExamAttempt
      ? safeAssessmentTitle || assessmentCategoryLabel
      : safeAssessmentTitle && safeAssessmentTitle !== "평가"
        ? `${safeAssessmentTitle} · ${assessmentCategoryLabel}`
        : assessmentCategoryLabel;

    return (
      <div
        ref={contentProtectionRef}
        data-quiz-content-protected
        className="student-quiz-runner student-quiz-learning"
      >
        {operationLoadingOverlay}
        <header className="student-quiz-topbar">
          <p
            className="student-quiz-context-title"
            title={assessmentBadgeLabel}
          >
            {assessmentBadgeLabel}
          </p>
          <div
            className={`student-quiz-timer ${timeLeft <= 60 ? "student-quiz-timer-urgent" : ""}`}
            aria-label="평가 남은 시간"
          >
            <span>남은 시간</span>
            <strong>
              {Math.floor(timeLeft / 60)
                .toString()
                .padStart(2, "0")}
              :
              {Math.floor(timeLeft % 60)
                .toString()
                .padStart(2, "0")}
            </strong>
          </div>
        </header>

        <nav
          ref={questionNavRef}
          className="student-quiz-navigation"
          aria-label="문항 이동"
        >
          <div className="student-quiz-progress-summary">
            <div>
              <p className="student-quiz-progress-count">
                <strong>{answeredQuestionCount}</strong> /{" "}
                {selectedQuestions.length}문제 완료
              </p>
              <p
                role="status"
                aria-live="polite"
                className="student-quiz-save-status"
              >
                {saveStatus === "saving"
                  ? "답안 저장 중"
                  : saveStatus === "pending"
                    ? "저장 대기"
                    : saveStatus === "saved"
                      ? "답안 저장됨"
                      : saveStatus === "error"
                        ? "저장 재시도 필요"
                        : ""}
              </p>
            </div>
            {incompleteIndexes.length > 0 && (
              <button
                type="button"
                disabled={finishSubmitting}
                onClick={() =>
                  void goToQuestion(
                    incompleteIndexes.find((index) => index > currentIndex) ??
                      incompleteIndexes[0],
                  )
                }
              >
                미완성 {incompleteIndexes.length}개
              </button>
            )}
          </div>
          <div className="student-quiz-progress-scroll">
            <div className="student-quiz-progress-items">
              {selectedQuestions.map((item, index) => {
                const answered = isQuestionAnswered(item);
                const active = index === currentIndex;
                return (
                  <button
                    key={`question-progress-${item.id}-${index}`}
                    type="button"
                    onClick={() => void goToQuestion(index)}
                    disabled={finishSubmitting}
                    aria-current={active ? "step" : undefined}
                    aria-label={`${index + 1}번 문제${
                      answered ? " 답안 입력됨" : " 미입력"
                    }`}
                    className={`student-quiz-progress-item ${active ? "is-current" : ""} ${answered ? "is-answered" : ""}`}
                  >
                    {index + 1}
                    {answered && (
                      <span
                        className="student-quiz-progress-check"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {saveStatus === "error" && (
            <div className="student-quiz-save-error" role="alert">
              <span>
                답안을 저장하지 못했습니다. 연결을 확인한 뒤 다시 저장해 주세요.
              </span>
              <button
                type="button"
                onClick={() => void persistQuizProgress()}
                disabled={finishSubmitting}
              >
                다시 저장
              </button>
            </div>
          )}
        </nav>

        <div className="student-quiz-shell">
          <fieldset
            disabled={finishSubmitting}
            className={`student-quiz-body-split min-h-0 flex-1 ${
              hasQuestionSupportPanel ? "student-quiz-body-has-support" : ""
            }`}
          >
            <section className="student-quiz-question-panel">
              <div className="student-quiz-question-toolbar">
                <span className="student-quiz-question-number">
                  문제 {currentIndex + 1}
                </span>
                {!!(canUseHints && question.hintEnabled && question.hint) && (
                  <button
                    type="button"
                    className="student-quiz-hint-toggle"
                    onClick={() => {
                      if (openHintQuestionId === question.id) {
                        setOpenHintQuestionId(null);
                      } else {
                        if (!revealedHints[question.id]) revealHint(question);
                        setOpenHintQuestionId(question.id);
                      }
                    }}
                    disabled={
                      !revealedHints[question.id] &&
                      hintUsedCount >= maxHintUses
                    }
                    aria-expanded={openHintQuestionId === question.id}
                    aria-controls={`quiz-hint-${question.id}`}
                    aria-label={`${openHintQuestionId === question.id ? "힌트 닫기" : "힌트 보기"}${revealedHints[question.id] ? "" : `, 남은 ${Math.max(0, maxHintUses - hintUsedCount)}회`}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.6-1.5 1.5-1.5 2.5h-4c0-1-.6-1.9-1.5-2.5Z" />
                    </svg>
                    힌트
                  </button>
                )}
              </div>
              <h2
                ref={questionHeadingRef}
                tabIndex={-1}
                className="student-quiz-question-heading"
              >
                <QuizQuestionText value={question.question} />
              </h2>
              {canUseHints &&
                openHintQuestionId === question.id &&
                revealedHints[question.id] && (
                  <div
                    id={`quiz-hint-${question.id}`}
                    className="student-quiz-hint-content"
                  >
                    {question.hint}
                  </div>
                )}

              {hasQuestionSupportPanel && (
                <div className="student-quiz-support-panel">
                  {question.image && (
                    <div
                      className={`flex min-h-0 items-center justify-center ${
                        passageText ? "shrink-0" : "flex-1"
                      }`}
                    >
                      <img
                        key={`question-image-${imageReloadKey}`}
                        src={question.image}
                        onLoad={() => finishImageLoad(question.image!)}
                        onError={() => finishImageLoad(question.image!, true)}
                        className={`mx-auto max-w-full rounded-lg border border-gray-100 object-contain ${
                          passageText
                            ? "max-h-[min(30vh,280px)]"
                            : "max-h-[min(48vh,460px)]"
                        }`}
                        alt="문항 첨부 이미지"
                      />
                    </div>
                  )}
                  {passageText && (
                    <QuizPassage
                      value={passageText}
                      surface="white"
                      size="default"
                      className="student-quiz-passage"
                    />
                  )}
                </div>
              )}

              {question.type === "order" && (
                <div className="student-quiz-order-selection">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-bold text-gray-600">
                      선택한 순서
                    </div>
                    <div className="text-xs font-black text-blue-700">
                      {selectedOrderItems.length}/{orderSlotCount}
                    </div>
                  </div>
                  <div className="student-quiz-order-slots flex flex-col gap-2">
                    {Array.from({ length: orderSlotCount }).map((_, index) => {
                      const item = selectedOrderItems[index];
                      return item ? (
                        <button
                          key={`order-slot-${question.id}-${index}-${item}`}
                          type="button"
                          onClick={() => removeOrderSelection(index)}
                          className="flex min-h-12 w-full items-start gap-3 rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 break-words">
                            {item}
                          </span>
                        </button>
                      ) : (
                        <div
                          key={`order-slot-${question.id}-${index}-empty`}
                          className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-300"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-400">
                            {index + 1}
                          </span>
                          <span>빈칸</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section
              className="student-quiz-answer-panel"
              aria-labelledby="quiz-answer-label"
            >
              <div id="quiz-answer-label" className="student-quiz-answer-label">
                {answerPanelLabel}
              </div>

              {question.type === "choice" && (
                <div
                  className={
                    hasChoiceOptionImages && choiceColumnCount === 1
                      ? "student-quiz-choice-grid"
                      : "student-quiz-choice-list"
                  }
                >
                  {choiceColumnCount > 1 && (
                    <div className="student-quiz-column-header">
                      <QuizChoiceColumnHeaders count={choiceColumnCount} />
                    </div>
                  )}
                  {question.options?.map((option, index) => {
                    const optionImage = getChoiceOptionImage(question, index);
                    const visibleOptionText =
                      optionImage && isGeneratedImageChoiceLabel(option, index)
                        ? ""
                        : option;
                    const selected = currentAnswer === option;
                    return (
                      <button
                        type="button"
                        key={`${question.id}-choice-${index}`}
                        onClick={() => handleAnswer(option)}
                        aria-pressed={selected}
                        className={`student-quiz-choice ${choiceColumnCount > 1 ? "student-quiz-column-row" : hasChoiceOptionImages ? "student-quiz-image-choice" : ""} ${selected ? "is-selected" : ""}`}
                      >
                        {choiceColumnCount > 1 ? (
                          <>
                            <span className="student-quiz-column-number">
                              {index + 1}
                            </span>
                            <span className="student-quiz-column-content">
                              <QuizChoiceColumnCells value={option} />
                              {optionImage && (
                                <img
                                  key={`choice-image-${imageReloadKey}`}
                                  src={optionImage}
                                  onLoad={() => finishImageLoad(optionImage)}
                                  onError={() =>
                                    finishImageLoad(optionImage, true)
                                  }
                                  alt={`${index + 1}번 보기 이미지`}
                                />
                              )}
                            </span>
                          </>
                        ) : hasChoiceOptionImages ? (
                          <>
                            <div
                              className={`relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border ${
                                optionImage
                                  ? "border-gray-100 bg-white"
                                  : "border-dashed border-gray-200 bg-gray-50 px-2"
                              }`}
                            >
                              <span
                                className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm font-black shadow-sm ${
                                  selected
                                    ? "bg-blue-600 text-white"
                                    : "bg-white/95 text-gray-600 ring-1 ring-gray-200"
                                }`}
                              >
                                {index + 1}
                              </span>
                              {optionImage ? (
                                <img
                                  key={`choice-image-${imageReloadKey}`}
                                  src={optionImage}
                                  onLoad={() => finishImageLoad(optionImage)}
                                  onError={() =>
                                    finishImageLoad(optionImage, true)
                                  }
                                  alt={`${index + 1}번 보기`}
                                  className="max-h-full max-w-full object-contain"
                                />
                              ) : (
                                <span className="break-keep text-center text-sm font-bold text-gray-700">
                                  {visibleOptionText}
                                </span>
                              )}
                            </div>
                            {visibleOptionText && optionImage && (
                              <div className="mt-2 min-h-[2.5rem] w-full break-words text-center text-base font-bold leading-relaxed">
                                {visibleOptionText}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div
                              className={`mr-3 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                                selected
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-200 text-gray-500"
                              }`}
                            >
                              {index + 1}
                            </div>
                            {optionImage && (
                              <img
                                key={`choice-preview-${imageReloadKey}`}
                                src={optionImage}
                                onLoad={() => finishImageLoad(optionImage)}
                                onError={() =>
                                  finishImageLoad(optionImage, true)
                                }
                                alt={`${index + 1}번 보기 이미지`}
                                className="mr-3 h-24 w-28 shrink-0 rounded-lg border border-gray-100 bg-white object-contain"
                              />
                            )}
                            <div className="min-w-0 break-words">
                              {visibleOptionText}
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "ox" && (
                <div className="student-quiz-ox-options">
                  {["O", "X"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleAnswer(option)}
                      aria-pressed={currentAnswer === option}
                      className={`student-quiz-ox-option rounded-lg border p-6 text-center text-xl font-bold ${
                        currentAnswer === option
                          ? "border-blue-500 bg-blue-50 text-blue-800"
                          : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {(question.type === "short" || question.type === "word") && (
                <input
                  lang="ko"
                  inputMode="text"
                  type="text"
                  aria-label={`${currentIndex + 1}번 문제 답안`}
                  value={currentAnswer}
                  maxLength={SHORT_ANSWER_MAX_LENGTH}
                  onChange={(event) => handleAnswer(event.target.value)}
                  onBlur={() =>
                    observe((collector) =>
                      collector.commitAnswer(String(question.id)),
                    )
                  }
                  className="student-quiz-text-answer"
                  placeholder={`정답 입력 (최대 ${SHORT_ANSWER_MAX_LENGTH}자)`}
                />
              )}

              {question.type === "order" && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {orderOptions.map((option, index) => {
                    const selected = selectedOrderItems.includes(option);
                    return (
                      <button
                        key={`${option}-${index}`}
                        type="button"
                        onClick={() => appendOrderSelection(option)}
                        disabled={selected}
                        aria-pressed={selected}
                        className={`student-quiz-order-option flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left text-base ${
                          selected
                            ? "cursor-not-allowed border-blue-200 bg-blue-50 text-blue-700 opacity-75"
                            : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                            selected
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 break-words">
                          {option}
                        </span>
                        {selected && (
                          <span className="shrink-0 text-[11px] font-black text-blue-600">
                            선택됨
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "matching" &&
                (() => {
                  const matchingPairs = parseMatchingPairs(question);
                  const matchingAnswerMap = parseMatchingAnswer(currentAnswer);
                  const rightOptions =
                    orderOptionMap[question.id] ||
                    matchingPairs.map((pair) => pair.right);
                  const matchingConnections = Object.entries(matchingAnswerMap)
                    .filter(([, right]) => right)
                    .map(([left, right]) => ({
                      id: `${left}-${right}`,
                      leftKey: left,
                      rightKey: right,
                      active: matchingActiveLeft === left,
                    }));

                  return (
                    <div
                      ref={matchingConnectionContainerRef}
                      className="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <div className="space-y-2">
                        {matchingPairs.map((pair, index) => {
                          const selectedRight =
                            matchingAnswerMap[pair.left] || "";
                          return (
                            <button
                              key={`${pair.left}-${index}`}
                              data-matching-left-key={pair.left}
                              ref={(element) => {
                                matchingLeftRefs.current[pair.left] = element;
                              }}
                              type="button"
                              onClick={() => setMatchingActiveLeft(pair.left)}
                              aria-pressed={matchingActiveLeft === pair.left}
                              className={`student-quiz-matching-option relative z-20 w-full rounded-lg border p-4 text-left ${
                                matchingActiveLeft === pair.left
                                  ? "border-blue-500 bg-blue-50 text-blue-800"
                                  : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              <div className="font-bold">{pair.left}</div>
                              {selectedRight && (
                                <div className="mt-2 flex items-center gap-2 text-sm font-bold text-blue-600">
                                  <span>{selectedRight}</span>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        {rightOptions.map((right, index) => {
                          const sourcePair = matchingPairs.find(
                            (pair) => pair.right === right,
                          );
                          const used =
                            Object.values(matchingAnswerMap).includes(right);
                          return (
                            <button
                              key={`${right}-${index}`}
                              data-matching-right-key={right}
                              ref={(element) => {
                                matchingRightRefs.current[right] = element;
                              }}
                              type="button"
                              onClick={() => handleMatchingRightSelect(right)}
                              disabled={!matchingActiveLeft}
                              className={`student-quiz-matching-option relative z-20 flex w-full items-center gap-3 rounded-lg border p-3 text-left ${
                                used
                                  ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                                  : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              {sourcePair?.rightImage && (
                                <img
                                  key={`matching-image-${imageReloadKey}`}
                                  src={sourcePair.rightImage}
                                  onLoad={() =>
                                    finishImageLoad(sourcePair.rightImage!)
                                  }
                                  onError={() =>
                                    finishImageLoad(
                                      sourcePair.rightImage!,
                                      true,
                                    )
                                  }
                                  alt=""
                                  className="h-16 w-16 shrink-0 rounded-lg border border-gray-100 object-contain"
                                />
                              )}
                              <span className="font-bold">{right}</span>
                            </button>
                          );
                        })}
                      </div>
                      <MatchingConnectionLines
                        containerRef={matchingConnectionContainerRef}
                        leftRefs={matchingLeftRefs}
                        rightRefs={matchingRightRefs}
                        connections={matchingConnections}
                      />
                    </div>
                  );
                })()}
              {currentQuestionImages.some((source) =>
                failedImages.has(source),
              ) && (
                <div role="alert" className="mt-4 text-sm text-red-700">
                  <p>
                    문항 이미지를 불러오지 못했습니다. 연결을 확인해 주세요.
                  </p>
                  <button
                    type="button"
                    className="min-h-11 underline underline-offset-4"
                    onClick={() => {
                      setLoadedImages(
                        (previous) =>
                          new Set(
                            [...previous].filter(
                              (source) =>
                                !currentQuestionImages.includes(source),
                            ),
                          ),
                      );
                      setFailedImages(
                        (previous) =>
                          new Set(
                            [...previous].filter(
                              (source) =>
                                !currentQuestionImages.includes(source),
                            ),
                          ),
                      );
                      setImageReloadKey((value) => value + 1);
                    }}
                  >
                    이미지 다시 불러오기
                  </button>
                </div>
              )}
            </section>
          </fieldset>

          {submitError && (
            <div role="alert" className="student-quiz-save-error mt-3">
              <span>{submitError}</span>
              {!submitConflict && (
                <button
                  type="button"
                  disabled={finishSubmitting}
                  onClick={() => void finishQuiz(timeoutHandledRef.current)}
                >
                  다시 제출
                </button>
              )}
            </div>
          )}

          <div className="student-quiz-actions">
            <button
              type="button"
              onClick={prevQuestion}
              disabled={currentIndex === 0 || finishSubmitting}
              className="student-quiz-secondary-action"
            >
              <i className="fas fa-arrow-left mr-2"></i>
              이전 문제
            </button>
            <button
              type="button"
              onClick={() => void nextQuestion()}
              disabled={finishSubmitting}
              className="student-quiz-primary-action"
            >
              {currentIndex === selectedQuestions.length - 1
                ? finishSubmitting
                  ? "제출 중..."
                  : "제출하기"
                : "다음 문제"}
              {currentIndex === selectedQuestions.length - 1 ? (
                <i className="fas fa-check ml-2"></i>
              ) : (
                <i className="fas fa-arrow-right ml-2"></i>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "result") {
    const resultReviewUrl = finalizedResultId
      ? `/student/mypage?menu=wrong_note&attemptId=${encodeURIComponent(
          finalizedResultId,
        )}`
      : "/student/mypage?menu=wrong_note";
    if (isMockExamAttempt && paperResult && resultCounts.total > 0) {
      return (
        <MockExamWorkspace
          key={finalizedResultId}
          questions={paperResult.questions}
          paperHeader={canonicalAttempt?.paperHeader || {}}
          answers={answers}
          round={examRound}
          studentLabel={`${buildGradeClassLabel(userData)}　이름: ${normalizeStudentText(userData?.name)}`}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
          score={score}
          checks={paperResult.checks}
          earnedPoints={paperResult.earnedPoints}
          onReview={() => navigate(resultReviewUrl)}
          onReturn={() => navigate("/student/quiz")}
        />
      );
    }
    if (resultCounts.total === 0) {
      return (
        <div role="alert" className="mx-auto w-full max-w-2xl p-6">
          <p className="text-gray-700">
            제출은 완료되었지만 문항별 채점 결과를 확인할 수 없습니다.
          </p>
          <button
            type="button"
            className="mt-4 min-h-11 font-bold text-blue-700 underline"
            onClick={() => navigate(resultReviewUrl)}
          >
            저장된 답안 확인
          </button>
        </div>
      );
    }
    const unitNames = Array.from(
      new Set(
        selectedQuestions
          .map((question) => {
            return [
              question.refMid,
              question.subUnitId,
              question.refSmall,
              question.refBig,
              question.unitId,
            ]
              .map((id) => curriculumLabelsRef.current[id || ""])
              .find(Boolean);
          })
          .filter(Boolean),
      ),
    );
    const resultUnitTitle =
      curriculumLabelsRef.current[unitId || ""] ||
      unitNames.join(" · ") ||
      (!isMockExamCategory(category) ? searchParams.get("title") : "") ||
      "단원 정보 없음";

    return (
      <QuizLearningResult
        key={finalizedResultId}
        assessmentTitle={
          assessmentTitle ||
          (category === "diagnostic"
            ? "진단평가"
            : category === "formative"
              ? "형성평가"
              : title)
        }
        unitTitle={resultUnitTitle}
        score={score}
        correctCount={resultCounts.correct}
        totalCount={resultCounts.total}
        comparison={scoreComparison}
        reviewItems={reviewItems}
        updatedReviewItems={updatedReviewItems}
        onSaveReviewNote={
          finalizedResultId
            ? async (draft, expectedRevision, saveId) => {
                const saved = await saveMyQuizReviewNote({
                  semesterId: `${assessmentYear}-${assessmentSemester}`,
                  key: `canonical:${finalizedResultId}`,
                  ...draft,
                  expectedRevision,
                  saveId,
                });
                return saved.reviewNotes;
              }
            : undefined
        }
        onReloadReviewNotes={
          finalizedResultId
            ? async () => {
                const latest = await loadMyQuizHistoryDetail(
                  `${assessmentYear}-${assessmentSemester}`,
                  `canonical:${finalizedResultId}`,
                );
                return (
                  latest.reviewNotes || {
                    revision: 0,
                    items: [],
                    updatedAt: "",
                  }
                );
              }
            : undefined
        }
        onReview={() => navigate(resultReviewUrl)}
        onRetry={() => {
          setView("loading");
          void initializeQuiz(true);
        }}
      />
    );
  }

  return <div></div>;
};

export default QuizRunner;
