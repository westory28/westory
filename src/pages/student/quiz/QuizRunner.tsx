import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MatchingConnectionLines from "../../../components/common/MatchingConnectionLines";
import { PageLoading } from "../../../components/common/LoadingState";
import QuizPassage from "../../../components/common/QuizPassage";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  AssessmentTelemetryCollector,
  type AssessmentTelemetrySnapshot,
} from "../../../lib/assessmentTelemetry";
import "./QuizLearning.css";
import QuizLearningResult from "./QuizLearningResult";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import {
  createDefaultAssessmentConfigEntry,
  getAssessmentConfigKey,
  getGrade3ClassIdsFromSchoolConfig,
  isAssessmentVisibleToStudent,
  readAssessmentConfigMap,
  type AssessmentQuestionOrder,
} from "../../../lib/assessmentConfig";
import {
  formatMockExamRoundLabel,
  getMockExamResultCategory,
  isAdditionalMockExamRound,
  isMockExamCategory,
  mockExamRoundMatches,
  normalizeMockExamRound,
} from "../../../lib/mockExamRounds";
import { db } from "../../../lib/firebase";
import {
  getQuizSubmissionDeadlineMs,
  normalizeQuizSubmissionDoc,
  readTimestampMs,
  type QuizSubmissionDoc,
} from "../../../lib/quizSubmissions";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";
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
} from "../../../lib/assessmentLifecycle";
import {
  readStudentCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../lib/studentLessonReadCache";

const QUIZ_PROGRESS_SAVE_DELAY_MS = 1500;

interface Question {
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
  randomOrder?: boolean;
  questionOrder?: AssessmentQuestionOrder;
}

const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";

const normalizeStudentText = (value: unknown) => String(value ?? "").trim();
const normalizeStudentEmail = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
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
  const { showToast } = useAppToast();
  const { confirm } = useAppDialog();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userData, config, currentUser } = useAuth();

  const unitId = searchParams.get("unitId");
  const category = searchParams.get("category");
  const examRound = isMockExamCategory(category)
    ? normalizeMockExamRound(searchParams.get("round"))
    : "";
  const title =
    isMockExamCategory(category) && examRound
      ? formatMockExamRoundLabel(examRound)
      : searchParams.get("title") || "평가";

  const [view, setView] = useState<"loading" | "intro" | "quiz" | "result">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState("");

  const [quizConfig, setQuizConfig] = useState<QuizConfig | null>(null);
  const [questionBank, setQuestionBank] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
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
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [quizDeadlineMs, setQuizDeadlineMs] = useState<number | null>(null);

  const [score, setScore] = useState(0);
  const [resultCounts, setResultCounts] = useState({ correct: 0, total: 0 });
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [finishSubmitting, setFinishSubmitting] = useState(false);
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
  const unitOrderMapRef = useRef<Record<string, number>>({});
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

  const questionsForAttempt = (
    attempt: AssessmentAttemptState,
    bank: Question[],
  ): Question[] => {
    const presentation = new Map(
      (attempt.questionPresentation || []).map((item) => [
        String(item.id),
        item,
      ]),
    );
    const metadata = new Map(
      (attempt.learningSnapshot || []).map((item) => [String(item.id), item]),
    );
    const fallback = new Map(bank.map((item) => [String(item.id), item]));
    return attempt.questionIds
      .map((id) => {
        const item = presentation.get(id);
        // New attempts use the frozen server presentation. Legacy/oversized
        // items remain compatible, with missing historical snapshots explicit.
        return item
          ? ({
              ...metadata.get(id),
              ...item,
              id: Number(item.id),
              answer: "",
            } as Question)
          : fallback.get(id);
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

  const compareUnitKeys = (left: string, right: string) =>
    left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" });

  const buildUnitOrderMap = (tree: StudentCurriculumTreeItem[]) => {
    const next: Record<string, number> = {};
    let order = 0;
    const visit = (items: StudentCurriculumTreeItem[]) => {
      items.forEach((item) => {
        const id = String(item.id || "").trim();
        if (id && next[id] === undefined) {
          next[id] = order;
          order += 1;
        }
        visit(item.children || []);
      });
    };
    visit(tree);
    return next;
  };

  const compareUnitOrderIds = (left: string, right: string) => {
    const leftOrder = unitOrderMapRef.current[left];
    const rightOrder = unitOrderMapRef.current[right];
    const leftHasOrder = leftOrder !== undefined;
    const rightHasOrder = rightOrder !== undefined;
    if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
    return compareUnitKeys(left, right);
  };

  const getQuestionUnitOrderKeys = (question: Question) => [
    question.refBig || "",
    question.refMid || question.unitId || "",
    question.refSmall || question.subUnitId || "",
  ];

  const compareQuestionsByUnitOrder = (left: Question, right: Question) => {
    const leftKeys = getQuestionUnitOrderKeys(left);
    const rightKeys = getQuestionUnitOrderKeys(right);
    for (let index = 0; index < leftKeys.length; index += 1) {
      const gap = compareUnitOrderIds(leftKeys[index], rightKeys[index]);
      if (gap !== 0) return gap;
    }
    return left.id - right.id;
  };

  const normalizeQuestionOrder = (
    questionOrder: AssessmentQuestionOrder | undefined,
    randomOrder: boolean | undefined,
  ): AssessmentQuestionOrder => {
    if (
      questionOrder === "random" ||
      questionOrder === "created" ||
      questionOrder === "unit"
    ) {
      return questionOrder;
    }
    return randomOrder === false ? "created" : "random";
  };

  const orderQuestions = (
    questions: Question[],
    questionOrder: AssessmentQuestionOrder,
  ) => {
    if (questionOrder === "random") return shuffleItems(questions);
    if (questionOrder === "unit") {
      return [...questions].sort(compareQuestionsByUnitOrder);
    }
    return [...questions].sort((left, right) => left.id - right.id);
  };

  const getExamPrepSmallKey = (question: Question) =>
    question.refSmall ||
    question.subUnitId ||
    question.refMid ||
    question.refBig ||
    `question-${question.id}`;

  const getExamPrepBigKey = (question: Question) =>
    question.refBig || question.refMid || question.subUnitId || "unassigned";

  const orderExamPrepGroups = <
    T extends { bigKey: string; midKey: string; smallKey: string },
  >(
    groups: T[],
    questionOrder: AssessmentQuestionOrder,
  ) => {
    const orderedGroups =
      questionOrder === "random"
        ? shuffleItems(groups)
        : [...groups].sort(
            (left, right) =>
              compareUnitOrderIds(left.bigKey, right.bigKey) ||
              compareUnitOrderIds(left.midKey, right.midKey) ||
              compareUnitOrderIds(left.smallKey, right.smallKey),
          );
    const groupedByBig = new Map<string, T[]>();
    orderedGroups.forEach((group) => {
      const current = groupedByBig.get(group.bigKey) || [];
      current.push(group);
      groupedByBig.set(group.bigKey, current);
    });

    const bigKeys =
      questionOrder === "random"
        ? shuffleItems(Array.from(groupedByBig.keys()))
        : Array.from(groupedByBig.keys()).sort(compareUnitOrderIds);
    const balancedGroups: T[] = [];
    let added = true;
    while (added) {
      added = false;
      bigKeys.forEach((bigKey) => {
        const queue = groupedByBig.get(bigKey);
        const next = queue?.shift();
        if (next) {
          balancedGroups.push(next);
          added = true;
        }
      });
    }
    return balancedGroups;
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

  const selectQuestions = (
    all: Question[],
    solvedIds: Set<number>,
    targetCount: number,
    questionOrder: AssessmentQuestionOrder,
  ) => {
    const safeTargetCount = Math.min(Math.max(1, targetCount || 1), all.length);
    const selectedIds = new Set<number>();

    const selectStandardQuestions = () => {
      if (questionOrder === "unit") {
        const groupMap = new Map<
          string,
          {
            unitKey: string;
            unusedQuestions: Question[];
            repeatQuestions: Question[];
          }
        >();

        all.forEach((question) => {
          const unitKey =
            question.subUnitId || question.unitId || `question-${question.id}`;
          const group = groupMap.get(unitKey) || {
            unitKey,
            unusedQuestions: [],
            repeatQuestions: [],
          };
          if (solvedIds.has(question.id)) {
            group.repeatQuestions.push(question);
          } else {
            group.unusedQuestions.push(question);
          }
          groupMap.set(unitKey, group);
        });

        const groups = Array.from(groupMap.values()).map((group) => ({
          ...group,
          unusedQuestions: orderQuestions(group.unusedQuestions, questionOrder),
          repeatQuestions: orderQuestions(group.repeatQuestions, questionOrder),
        }));
        const orderedGroups = () =>
          [...groups].sort((left, right) =>
            compareUnitOrderIds(left.unitKey, right.unitKey),
          );
        const selected: Question[] = [];

        const takeBalanced = (
          source: "unusedQuestions" | "repeatQuestions",
        ) => {
          let added = true;
          while (added && selected.length < safeTargetCount) {
            added = false;
            orderedGroups().forEach((group) => {
              if (selected.length >= safeTargetCount) return;
              const candidate = group[source].find(
                (question) => !selectedIds.has(question.id),
              );
              if (!candidate) return;
              selected.push(candidate);
              selectedIds.add(candidate.id);
              added = true;
            });
          }
        };

        takeBalanced("unusedQuestions");
        takeBalanced("repeatQuestions");
        return orderQuestions(selected, questionOrder);
      }

      const unusedPool = orderQuestions(
        all.filter((question) => !solvedIds.has(question.id)),
        questionOrder,
      );
      const repeatPool = orderQuestions(
        all.filter((question) => solvedIds.has(question.id)),
        questionOrder,
      );
      const selected = [...unusedPool.slice(0, safeTargetCount)];
      selected.forEach((question) => selectedIds.add(question.id));
      if (selected.length < safeTargetCount) {
        repeatPool.some((question) => {
          if (selected.length >= safeTargetCount) return true;
          if (selectedIds.has(question.id)) return false;
          selected.push(question);
          selectedIds.add(question.id);
          return false;
        });
      }
      return orderQuestions(selected, questionOrder);
    };

    const selectExamPrepQuestions = () => {
      const groupMap = new Map<
        string,
        {
          bigKey: string;
          midKey: string;
          smallKey: string;
          unusedQuestions: Question[];
          repeatQuestions: Question[];
        }
      >();

      const orderExamPrepQuestionPool = (questions: Question[]) => {
        if (questionOrder === "created") {
          return orderQuestions(questions, "created");
        }
        return shuffleItems(questions);
      };

      const orderSelectedExamPrepQuestions = (questions: Question[]) => {
        if (questionOrder === "created") {
          return orderQuestions(questions, "created");
        }
        if (questionOrder === "random") {
          return shuffleItems(questions);
        }
        return [...questions].sort((left, right) => {
          const leftKeys = getQuestionUnitOrderKeys(left);
          const rightKeys = getQuestionUnitOrderKeys(right);
          for (let index = 0; index < leftKeys.length; index += 1) {
            const gap = compareUnitOrderIds(leftKeys[index], rightKeys[index]);
            if (gap !== 0) return gap;
          }
          return 0;
        });
      };

      all.forEach((question) => {
        const smallKey = getExamPrepSmallKey(question);
        const group = groupMap.get(smallKey) || {
          bigKey: getExamPrepBigKey(question),
          midKey: question.refMid || question.subUnitId || smallKey,
          smallKey,
          unusedQuestions: [],
          repeatQuestions: [],
        };
        if (solvedIds.has(question.id)) {
          group.repeatQuestions.push(question);
        } else {
          group.unusedQuestions.push(question);
        }
        groupMap.set(smallKey, group);
      });

      const groups = Array.from(groupMap.values()).map((group) => ({
        ...group,
        unusedQuestions: orderExamPrepQuestionPool(group.unusedQuestions),
        repeatQuestions: orderExamPrepQuestionPool(group.repeatQuestions),
      }));
      const selected: Question[] = [];
      const selectedByGroup = new Map<string, number>();

      const takeFromGroups = (
        source: "unusedQuestions" | "repeatQuestions",
        maxPerSmallUnit: number,
      ) => {
        for (let pass = 0; pass < maxPerSmallUnit; pass += 1) {
          if (selected.length >= safeTargetCount) return;
          orderExamPrepGroups(groups, questionOrder).forEach((group) => {
            if (selected.length >= safeTargetCount) return;
            const currentGroupCount = selectedByGroup.get(group.smallKey) || 0;
            if (currentGroupCount > pass) return;
            const candidate = group[source].find(
              (question) => !selectedIds.has(question.id),
            );
            if (!candidate) return;
            selected.push(candidate);
            selectedIds.add(candidate.id);
            selectedByGroup.set(group.smallKey, currentGroupCount + 1);
          });
        }
      };

      const fillRemaining = (source: "unusedQuestions" | "repeatQuestions") => {
        let added = true;
        while (added && selected.length < safeTargetCount) {
          added = false;
          orderExamPrepGroups(groups, questionOrder).forEach((group) => {
            if (selected.length >= safeTargetCount) return;
            const candidate = group[source].find(
              (question) => !selectedIds.has(question.id),
            );
            if (!candidate) return;
            selected.push(candidate);
            selectedIds.add(candidate.id);
            selectedByGroup.set(
              group.smallKey,
              (selectedByGroup.get(group.smallKey) || 0) + 1,
            );
            added = true;
          });
        }
      };

      takeFromGroups("unusedQuestions", 2);
      fillRemaining("unusedQuestions");
      takeFromGroups("repeatQuestions", 2);
      fillRemaining("repeatQuestions");

      return orderSelectedExamPrepQuestions(selected);
    };

    const selected =
      unitId === "exam_prep"
        ? selectExamPrepQuestions()
        : selectStandardQuestions();

    const nextOrderMap: Record<number, string[]> = {};
    selected.forEach((question) => {
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

    return { selected, orderOptionMap: nextOrderMap };
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
    setAnswers(submission.answers);
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
    setScore(submitted.percent);
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
            answers: answerMap,
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
            answers: answerMap,
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
      setQuestionBank([]);
      setActiveSubmission(null);
      setCanonicalAttempt(null);
      setHistoryCount(0);
      setView("intro");
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
  }, [config, unitId, category, examRound, fallbackStudentUid]);

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

  const initializeQuiz = async () => {
    if (!unitId || !category || !fallbackStudentUid) return;

    try {
      setView("loading");
      setErrorMsg(null);
      setBlockReason(null);
      setResumeNotice("");
      setStartingQuiz(false);
      setFinishSubmitting(false);
      setSubmitError("");
      setSubmitConflict(false);
      setActiveSubmission(null);
      setQuizDeadlineMs(null);
      setServerTimeOffsetMs(0);
      setSaveStatus("idle");
      telemetryRef.current = null;
      timeoutHandledRef.current = false;

      const assessmentState = await getAssessmentState({
        definitionId: assessmentDefinitionId,
      });
      if (!assessmentState.definition) {
        setBlockReason(
          "유효하지 않거나 더 이상 사용할 수 없는 평가 링크입니다.",
        );
        setView("intro");
        return;
      }
      setAssessmentTitle(
        normalizeStudentText(assessmentState.definition.title),
      );
      const stateBlockReason =
        assessmentState.status === "PERMISSION"
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
        setView("intro");
        return;
      }

      const [grade3ClassIds, curriculumTree] = await Promise.all([
        getGrade3ClassIdsFromSchoolConfig(),
        readStudentCurriculumTree(config),
      ]);
      unitOrderMapRef.current = buildUnitOrderMap(curriculumTree);
      const visitLabels = (items: StudentCurriculumTreeItem[]) => {
        items.forEach((item) => {
          curriculumLabelsRef.current[item.id] = item.title;
          visitLabels(item.children || []);
        });
      };
      curriculumLabelsRef.current = {};
      visitLabels(curriculumTree);
      const assessmentConfigMap = await readAssessmentConfigMap(
        config,
        grade3ClassIds,
      );
      const configKey = getAssessmentConfigKey(
        unitId || "",
        category || "",
        examRound || undefined,
      );
      const nextQuizConfig: QuizConfig =
        assessmentConfigMap[configKey] ||
        createDefaultAssessmentConfigEntry(grade3ClassIds);

      setQuizConfig(nextQuizConfig);

      if (!nextQuizConfig.active) {
        setBlockReason("현재 비활성화된 평가입니다.");
        setView("intro");
        return;
      }

      if (
        !isAssessmentVisibleToStudent(assessmentConfigMap[configKey], userData)
      ) {
        setBlockReason("현재 학급에는 공개되지 않은 평가입니다.");
        setView("intro");
        return;
      }

      const questionRef = collection(
        db,
        getSemesterCollectionPath(config, "quiz_questions"),
      );
      const questionQuery =
        unitId === "exam_prep"
          ? query(questionRef, where("category", "==", "exam_prep"))
          : query(
              questionRef,
              where("unitId", "==", unitId),
              where("category", "==", category),
            );

      const questionSnap = await getDocs(questionQuery);
      const fetchedQuestions: Question[] = [];
      questionSnap.forEach((questionDoc) => {
        const question = {
          id: parseInt(questionDoc.id, 10),
          ...questionDoc.data(),
        } as Question;
        if (
          unitId === "exam_prep" &&
          question.unitId &&
          question.unitId !== "exam_prep"
        ) {
          return;
        }
        fetchedQuestions.push(question);
      });

      if (
        !fetchedQuestions.length &&
        !assessmentState.attempt?.questionPresentation?.length
      ) {
        throw new Error("등록된 문제가 없습니다.");
      }
      setQuestionBank(fetchedQuestions);

      const canonicalExistingAttempt = assessmentState.attempt;
      setCanonicalAttempt(canonicalExistingAttempt);
      setHistoryCount(Number(canonicalExistingAttempt?.attemptNumber || 0));
      const existingSubmission = canonicalExistingAttempt
        ? mapCanonicalAttemptToSubmission(canonicalExistingAttempt)
        : null;

      if (existingSubmission?.status === "in_progress") {
        if (canonicalExistingAttempt)
          beginTelemetry(canonicalExistingAttempt, true);
        const restoredQuestions = canonicalExistingAttempt
          ? questionsForAttempt(canonicalExistingAttempt, fetchedQuestions)
          : [];

        if (
          restoredQuestions.length === existingSubmission.questionIds.length
        ) {
          const remainingSeconds = restoreSubmissionState(
            existingSubmission,
            restoredQuestions,
            assessmentState.serverNowIso,
          );
          setResumeNotice(
            remainingSeconds <= 0
              ? "제한 시간이 끝난 응시입니다. 이어하기를 누르면 저장된 답안으로 제출을 마칩니다."
              : "서버에 저장된 진행 상태를 이어서 풀 수 있습니다.",
          );
          setView("intro");
          return;
        }
      }

      if (canonicalExistingAttempt?.status === "SUBMITTED") {
        if (
          canonicalExistingAttempt.attemptNumber >=
          assessmentState.definition.maxAttempts
        ) {
          setBlockReason("응시 가능 횟수를 모두 사용했습니다.");
          setView("intro");
          return;
        }
        const retryAt =
          Date.parse(canonicalExistingAttempt.submittedAtIso) +
          assessmentState.definition.cooldownMinutes * 60000;
        if (retryAt > Date.parse(assessmentState.serverNowIso)) {
          setBlockReason(
            `${Math.ceil((retryAt - Date.parse(assessmentState.serverNowIso)) / 60000)}분 후 다시 응시할 수 있습니다.`,
          );
          setView("intro");
          return;
        }
      }
      const solvedIds = new Set<number>();
      const questionOrder = normalizeQuestionOrder(
        nextQuizConfig.questionOrder,
        nextQuizConfig.randomOrder,
      );
      const selection = selectQuestions(
        fetchedQuestions,
        solvedIds,
        nextQuizConfig.questionCount || 10,
        questionOrder,
      );

      setSelectedQuestions(selection.selected);
      setOrderOptionMap(selection.orderOptionMap);
      setCurrentIndex(0);
      setAnswers({});
      setHintUsedCount(0);
      setRevealedHints({});
      setTimeLeft(nextQuizConfig.timeLimit || 60);
      setView("intro");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "초기화 중 오류가 발생했습니다.";
      setErrorMsg(message);
      setView("intro");
    }
  };

  const startQuiz = async () => {
    if (
      !unitId ||
      !category ||
      !fallbackStudentUid ||
      !selectedQuestions.length
    ) {
      return;
    }

    if (activeSubmission?.status === "in_progress") {
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
      setView("quiz");
      return;
    }

    setStartingQuiz(true);
    try {
      await resolveStudentIdentity();
      const attempt = await startAssessmentAttempt({
        definitionId: assessmentDefinitionId,
      });
      const committedQuestions = questionsForAttempt(attempt, questionBank);
      if (committedQuestions.length !== attempt.questionIds.length) {
        throw new Error("서버가 확정한 평가 문항을 불러오지 못했습니다.");
      }
      const startedState = await getAssessmentState({
        attemptId: attempt.attemptId,
      });
      const committedSelection = selectQuestions(
        committedQuestions,
        new Set<number>(),
        committedQuestions.length,
        quizConfig?.questionOrder || "created",
      );
      const committedSubmission = mapCanonicalAttemptToSubmission(attempt);

      setAnswers({});
      setCurrentIndex(0);
      setHintUsedCount(0);
      setRevealedHints({});
      setCanonicalAttempt(attempt);
      beginTelemetry(attempt, attempt.resumed);
      setSelectedQuestions(committedSelection.selected);
      restoreSubmissionState(
        committedSubmission,
        committedSelection.selected,
        startedState.serverNowIso,
      );
      setOrderOptionMap(committedSelection.orderOptionMap);
      setResumeNotice(
        attempt.resumed
          ? "서버에 저장된 진행 상태를 이어서 풀 수 있습니다."
          : "응시가 시작되었습니다. 답안은 서버에 자동 저장됩니다.",
      );
      setView("quiz");
    } catch (error) {
      console.error("Failed to start quiz attempt", {
        definitionId: assessmentDefinitionId,
        currentUserUid: currentUser?.uid || "",
        userDataUid: userData?.uid || "",
        code:
          typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code || "")
            : "",
        message: error instanceof Error ? error.message : String(error || ""),
        error,
      });
      showToast({
        tone: "error",
        title: "평가를 시작하지 못했습니다.",
        message: "응시 상태 저장에 실패했습니다. 다시 시도해 주세요.",
      });
    } finally {
      setStartingQuiz(false);
    }
  };

  const handleAnswer = (value: string) => {
    const question = selectedQuestions[currentIndex];
    if (!question || finishSubmittingRef.current) return;
    if (answers[String(question.id)] !== value)
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

  const nextQuestion = async () => {
    if (finishSubmittingRef.current) return;
    emitSessionActivity();
    if (currentIndex < selectedQuestions.length - 1) {
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

  const timeLimitSeconds = useMemo(
    () =>
      Math.max(
        60,
        Number(activeSubmission?.timeLimitSeconds || quizConfig?.timeLimit) ||
          60,
      ),
    [activeSubmission?.timeLimitSeconds, quizConfig?.timeLimit],
  );

  if (view === "loading") {
    return <PageLoading message="퀴즈를 준비하는 중입니다." />;
  }

  if (view === "intro") {
    const timeLimitMinutes = Math.max(1, Math.round(timeLimitSeconds / 60));
    const questionCount = blockReason
      ? 0
      : selectedQuestions.length || quizConfig?.questionCount || 10;
    const assessmentTypeLabel =
      category === "diagnostic"
        ? "진단평가"
        : category === "formative"
          ? "형성평가"
          : "모의고사";
    const introStatusLabel = blockReason
      ? "응시 불가"
      : activeSubmission?.status === "in_progress"
        ? "이어 풀기"
        : "응시 전 확인";
    const introActionLabel = startingQuiz
      ? "준비 중..."
      : activeSubmission?.status === "in_progress"
        ? "이어하기"
        : "평가 시작하기";

    return (
      <div className="student-quiz-intro mx-auto flex min-h-0 w-full max-w-5xl flex-1 animate-fadeIn items-center px-4 py-2 lg:py-3">
        <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="grid md:grid-cols-[minmax(0,1.12fr)_minmax(18rem,0.88fr)]">
            <section className="p-4 text-left sm:p-6 lg:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                  <i className="fas fa-file-signature text-[11px]"></i>
                  {assessmentTypeLabel}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${
                    blockReason
                      ? "bg-rose-50 text-rose-600"
                      : activeSubmission?.status === "in_progress"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {introStatusLabel}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-1 sm:mt-4">
                <h1 className="break-keep text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
                  {title}
                </h1>
                <InfoHelp label="풀이 기록 수집 안내">
                  문항을 화면에서 본 시간, 첫 답과 마지막 답을 고른 시점, 답
                  변경·재방문·힌트 사용을 답안과 함께 저장합니다. 화면을 벗어난
                  시간은 풀이 시간에서 제외합니다. 시간만으로 실력이나 찍기를
                  판단하지 않으며, 풀이 기록은 점수와 위스에 영향을 주지
                  않습니다.
                </InfoHelp>
              </div>

              <dl className="mt-4 grid grid-cols-3 divide-x divide-blue-100 overflow-hidden rounded-xl border border-blue-100 bg-blue-50/70 text-left sm:mt-5">
                <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                  <dt className="text-xs font-bold text-slate-500">
                    제한 시간
                  </dt>
                  <dd className="mt-1 text-lg font-black text-blue-700 sm:text-xl">
                    {timeLimitMinutes}분
                  </dd>
                </div>
                <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                  <dt className="text-xs font-bold text-slate-500">
                    출제 문항
                  </dt>
                  <dd className="mt-1 text-lg font-black text-blue-700 sm:text-xl">
                    {questionCount}문항
                  </dd>
                </div>
                <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                  <dt className="text-xs font-bold text-slate-500">
                    응시 횟수
                  </dt>
                  <dd className="mt-1 text-lg font-black text-slate-900 sm:text-xl">
                    {historyCount}회
                  </dd>
                </div>
              </dl>

              {(resumeNotice || errorMsg) && (
                <div className="mt-4 space-y-2">
                  {resumeNotice && !blockReason && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                      {resumeNotice}
                    </div>
                  )}
                  {errorMsg && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-500">
                      {errorMsg}
                    </div>
                  )}
                </div>
              )}
            </section>

            <aside className="flex flex-col justify-between gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:p-6 md:border-l md:border-t-0">
              <div className="flex items-start gap-3 md:block">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-lg text-white shadow-lg shadow-blue-200 sm:h-12 sm:w-12 sm:text-xl">
                  <i className="fas fa-stopwatch"></i>
                </div>
                <p className="text-sm font-bold leading-6 text-slate-600 md:mt-4">
                  시작 후에는 화면을 벗어나도 제한 시간이 계속됩니다.
                </p>
              </div>

              <div className="space-y-3">
                {!blockReason ? (
                  <button
                    type="button"
                    onClick={() =>
                      errorMsg ? void initializeQuiz() : void startQuiz()
                    }
                    disabled={startingQuiz}
                    className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 text-base font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 sm:h-12"
                  >
                    {errorMsg ? "다시 불러오기" : introActionLabel}
                  </button>
                ) : (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-500">
                    <i className="fas fa-ban mr-2"></i>
                    {blockReason}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  돌아가기
                </button>
              </div>
            </aside>
          </div>
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
      <div className="student-quiz-runner student-quiz-learning mx-auto flex max-w-6xl animate-fadeIn flex-col px-3 py-3 sm:px-4 lg:max-w-7xl">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 shadow-sm">
              <i className="fas fa-file-signature shrink-0 text-[11px]"></i>
              <span
                className="student-quiz-context-title min-w-0 break-words"
                title={assessmentBadgeLabel}
              >
                {assessmentBadgeLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canUseHints && (
              <div className="shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                힌트 {hintUsedCount}/{maxHintUses}
              </div>
            )}
            <div
              aria-label="평가 남은 시간"
              className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-sm"
            >
              <i className="fas fa-stopwatch text-red-500"></i>
              <span className="min-w-12 whitespace-nowrap text-center font-mono text-lg font-bold text-gray-700">
                {Math.floor(timeLeft / 60)
                  .toString()
                  .padStart(2, "0")}
                :
                {Math.floor(timeLeft % 60)
                  .toString()
                  .padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>

        <nav
          ref={questionNavRef}
          className="mb-3 shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
          aria-label="문항 이동"
        >
          <div className="student-quiz-progress-summary mb-2 flex items-center justify-between gap-2 text-sm text-gray-500">
            <div>
              <p className="font-bold">
                현재 {currentIndex + 1}번 ·{" "}
                <span className="text-blue-600">{answeredQuestionCount}</span>/
                {selectedQuestions.length} 입력
              </p>
              <p role="status" aria-live="polite" className="text-xs">
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
                미완성 {incompleteIndexes.length}개 보기
              </button>
            )}
          </div>
          <div className="student-quiz-progress-scroll -mx-1 overflow-x-auto px-1 pb-0.5">
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
                    className={`student-quiz-progress-item flex items-center justify-center rounded-md border text-sm font-bold leading-none transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                      active
                        ? answered
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-blue-500 bg-white text-blue-700 shadow-sm"
                        : answered
                          ? "border-blue-300 bg-blue-100 text-blue-700 hover:border-blue-400 hover:bg-blue-200"
                          : "border-gray-200 bg-gray-100 text-gray-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                    }`}
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

        <div className="student-quiz-shell flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <fieldset
            disabled={finishSubmitting}
            className={`student-quiz-body-split min-h-0 flex-1 ${
              hasQuestionSupportPanel ? "student-quiz-body-has-support" : ""
            }`}
          >
            <section className="student-quiz-question-panel min-h-0 rounded-xl border border-gray-100 bg-slate-50/70 p-4">
              <div className="mb-4">
                <div className="mb-2 text-xs font-black text-blue-600">
                  {currentIndex + 1}번 문제
                </div>
                <h2
                  ref={questionHeadingRef}
                  tabIndex={-1}
                  className="student-quiz-question-heading break-words text-lg font-bold leading-relaxed text-gray-900 md:text-xl"
                >
                  {question.question}
                </h2>
              </div>

              {!!(canUseHints && question.hintEnabled && question.hint) && (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => revealHint(question)}
                    disabled={
                      !!revealedHints[question.id] ||
                      hintUsedCount >= maxHintUses
                    }
                    className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold transition ${
                      revealedHints[question.id]
                        ? "bg-amber-100 text-amber-700"
                        : hintUsedCount >= maxHintUses
                          ? "cursor-not-allowed bg-gray-100 text-gray-400"
                          : "bg-amber-500 text-white hover:bg-amber-600"
                    }`}
                  >
                    {revealedHints[question.id] ? "힌트 확인됨" : "힌트 보기"}
                  </button>
                  {revealedHints[question.id] && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <i className="fas fa-lightbulb mr-2"></i>
                      {question.hint}
                    </div>
                  )}
                </div>
              )}

              {hasQuestionSupportPanel && (
                <div className="student-quiz-support-panel flex min-h-0 flex-col gap-3 rounded-xl border border-gray-100 bg-white p-2 text-center">
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
                      size="large"
                      className="shrink-0 text-left"
                    />
                  )}
                </div>
              )}

              {question.type === "order" && (
                <div className="mt-4 rounded-xl border border-dashed border-blue-300 bg-blue-50 p-3">
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
              className="student-quiz-answer-panel min-h-0 rounded-xl border border-gray-100 bg-white p-4"
              aria-labelledby="quiz-answer-label"
            >
              <div
                id="quiz-answer-label"
                className="mb-3 text-xs font-black text-blue-600"
              >
                {answerPanelLabel}
              </div>

              {question.type === "choice" && (
                <div
                  className={
                    hasChoiceOptionImages
                      ? "student-quiz-choice-grid grid min-h-[16rem] grid-cols-2 auto-rows-fr gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
                      : "min-h-0 space-y-2 overflow-y-auto pr-1"
                  }
                >
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
                        className={
                          hasChoiceOptionImages
                            ? `group flex h-full min-h-0 flex-col rounded-xl border-2 bg-white p-2 text-left transition ${
                                selected
                                  ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm"
                                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                              }`
                            : `flex w-full cursor-pointer items-start rounded-xl border-2 px-3 py-2.5 text-left text-base leading-relaxed transition ${
                                selected
                                  ? "border-blue-500 bg-blue-50 font-bold text-blue-800"
                                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                              }`
                        }
                      >
                        {hasChoiceOptionImages ? (
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
                <div className="grid gap-3">
                  {["O", "X"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleAnswer(option)}
                      aria-pressed={currentAnswer === option}
                      className={`rounded-xl border-2 p-6 text-center text-xl font-bold transition ${
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
                  onChange={(event) => handleAnswer(event.target.value)}
                  onBlur={() =>
                    observe((collector) =>
                      collector.commitAnswer(String(question.id)),
                    )
                  }
                  className="w-full rounded-xl border-2 border-gray-200 bg-white p-3 text-center text-lg font-bold outline-none transition focus:border-blue-500"
                  placeholder="정답을 입력하세요"
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
                        className={`flex min-h-12 items-center gap-2 rounded-lg border-2 px-3 py-2 text-left text-sm font-bold transition ${
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
                              className={`relative z-20 w-full rounded-xl border-2 p-4 text-left transition ${
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
                              className={`relative z-20 flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
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

          <div className="student-quiz-actions mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={prevQuestion}
              disabled={currentIndex === 0 || finishSubmitting}
              className={`flex items-center rounded-xl px-5 py-2.5 font-bold shadow-sm transition ${
                currentIndex === 0
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <i className="fas fa-arrow-left mr-2"></i>
              이전 문제
            </button>
            <button
              type="button"
              onClick={() => void nextQuestion()}
              disabled={finishSubmitting}
              className={`flex items-center rounded-xl px-7 py-2.5 font-bold text-white shadow-lg transition disabled:opacity-60 ${
                currentIndex === selectedQuestions.length - 1
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-gray-800 hover:bg-gray-900"
              }`}
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
        onReview={() => navigate(resultReviewUrl)}
        onRetry={() => {
          setView("loading");
          void initializeQuiz();
        }}
      />
    );
  }

  return <div></div>;
};

export default QuizRunner;
