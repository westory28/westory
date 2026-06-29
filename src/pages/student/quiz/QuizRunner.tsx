import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MatchingConnectionLines from "../../../components/common/MatchingConnectionLines";
import { PageLoading } from "../../../components/common/LoadingState";
import QuizPassage from "../../../components/common/QuizPassage";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
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
import { claimPointActivityReward } from "../../../lib/points";
import {
  getQuizSubmissionDeadlineMs,
  getQuizSubmissionDocPath,
  getQuizSubmissionRemainingSeconds,
  getQuizSubmissionServerOffsetMs,
  normalizeQuizSubmissionDoc,
  readTimestampMs,
  type QuizSubmissionDoc,
} from "../../../lib/quizSubmissions";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";
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

interface ResultDetail {
  q: string;
  u: string | undefined;
  a: string | number;
  correct: boolean;
  exp?: string;
  image?: string;
  passage?: string;
  type?: Question["type"];
  matchingPairs?: MatchingPair[];
}

interface QuizLogDetail {
  id: number;
  correct: boolean;
  u: string;
  displayU?: string;
}

const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

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

const readCommittedQuizSubmission = async (
  submissionRef: ReturnType<typeof doc>,
) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snap = await getDoc(submissionRef);
    if (snap.exists()) {
      const normalized = normalizeQuizSubmissionDoc(
        snap.id,
        snap.data() as Partial<QuizSubmissionDoc>,
      );
      if (readTimestampMs(normalized.startedAt) > 0) {
        return normalized;
      }
    }
    if (attempt < 3) {
      await wait(140 * (attempt + 1));
    }
  }
  return null;
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
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [activeSubmission, setActiveSubmission] =
    useState<QuizSubmissionDoc | null>(null);

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
  const [results, setResults] = useState<ResultDetail[]>([]);
  const [pointNotice, setPointNotice] = useState("");
  const [finishSubmitting, setFinishSubmitting] = useState(false);
  const [finalizedResultId, setFinalizedResultId] = useState("");

  const timerRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  const persistInFlightRef = useRef(false);
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
  const activeSubmissionPath =
    fallbackStudentUid && unitId && category
      ? getQuizSubmissionDocPath(
          config,
          fallbackStudentUid,
          unitId,
          category,
          examRound,
        )
      : "";

  const parseOrderAnswer = (value: string) =>
    value.split(ORDER_DELIMITER).filter(Boolean);

  const parseMatchingPairs = (question: Question): MatchingPair[] => {
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

  const parseMatchingAnswer = (value: string) =>
    Object.fromEntries(
      value
        .split(ORDER_DELIMITER)
        .map((item) => {
          const [left = "", right = ""] = item.split(MATCHING_PAIR_DELIMITER);
          return [left.trim(), right.trim()];
        })
        .filter(([left, right]) => left && right),
    );

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

  const getResolvedStudentEmail = () =>
    authIdentityRef.current.email || fallbackStudentEmail;

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

  const buildSubmissionPayload = (
    status: QuizSubmissionDoc["status"],
    overrides: Partial<QuizSubmissionDoc> = {},
  ) => ({
    uid: getResolvedStudentUid(),
    name: normalizeStudentText(userData?.name) || "Student",
    email: getResolvedStudentEmail(),
    class: normalizeStudentText(userData?.class),
    number: normalizeStudentText(userData?.number),
    gradeClass: buildGradeClassLabel(userData || undefined),
    unitId: String(unitId || "").trim(),
    category: String(category || "").trim(),
    title: String(title || "").trim(),
    status,
    questionIds:
      overrides.questionIds ||
      selectedQuestions.map((question) => String(question.id)),
    answers: overrides.answers || answers,
    currentIndex: overrides.currentIndex ?? currentIndex,
    hintUsedCount: overrides.hintUsedCount ?? hintUsedCount,
    revealedHintIds:
      overrides.revealedHintIds ||
      Object.entries(revealedHints)
        .filter(([, value]) => value)
        .map(([key]) => String(key)),
    orderOptionMap:
      overrides.orderOptionMap ||
      Object.fromEntries(
        Object.entries(orderOptionMap).map(([key, value]) => [
          String(key),
          value,
        ]),
      ),
    timeLimitSeconds: Math.max(60, Number(quizConfig?.timeLimit) || 60),
    clientStartedAtMs:
      overrides.clientStartedAtMs ??
      activeSubmission?.clientStartedAtMs ??
      Date.now(),
    lastClientSavedAtMs: Date.now(),
    resultId: overrides.resultId ?? activeSubmission?.resultId ?? "",
  });

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
    setServerTimeOffsetMs(getQuizSubmissionServerOffsetMs(submission));
    const deadlineMs = getQuizSubmissionDeadlineMs(submission);
    setQuizDeadlineMs(deadlineMs || null);
    setTimeLeft(getQuizSubmissionRemainingSeconds(submission));
    timeoutHandledRef.current = false;
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

    let correctCount = 0;
    const resultDetails: ResultDetail[] = [];
    const logDetails: QuizLogDetail[] = [];

    questionList.forEach((question) => {
      const storedAnswer = answerMap[String(question.id)] || "";
      const userAnswer = storedAnswer.toString().replace(/\s+/g, "").trim();
      const actualAnswer = question.answer
        .toString()
        .replace(/\s+/g, "")
        .trim();
      const isCorrect = userAnswer === actualAnswer;

      if (isCorrect) {
        correctCount += 1;
      }

      resultDetails.push({
        q: question.question,
        u: storedAnswer,
        a: question.answer,
        correct: isCorrect,
        exp: question.explanation,
        image: question.image,
        passage: question.passage,
        type: question.type,
        matchingPairs:
          question.type === "matching" ? parseMatchingPairs(question) : [],
      });

      logDetails.push({
        id: question.id,
        correct: isCorrect,
        u: userAnswer,
        displayU: storedAnswer,
      });
    });

    const finalScore = questionList.length
      ? Math.round((correctCount / questionList.length) * 100)
      : 0;
    const resolvedUserData = userData;

    const resultPayload = {
      uid: getResolvedStudentUid(),
      name: normalizeStudentText(resolvedUserData?.name) || "Student",
      email: getResolvedStudentEmail(),
      class: normalizeStudentText(resolvedUserData?.class),
      number: normalizeStudentText(resolvedUserData?.number),
      gradeClass: buildGradeClassLabel(resolvedUserData),
      unitId: String(unitId || "").trim(),
      category: getMockExamResultCategory(category, examRound),
      ...(isMockExamCategory(category) ? { examRound } : {}),
      score: finalScore,
      details: logDetails,
      status: isTimeout ? "시간 초과" : "완료",
      timestamp: serverTimestamp(),
      timeString: new Date().toLocaleString("ko-KR"),
    };

    console.info("[QuizRunner] Saving quiz result", {
      resultCollectionPath: getSemesterCollectionPath(config, "quiz_results"),
      submissionPath: activeSubmissionPath,
      payload: {
        uid: resultPayload.uid,
        unitId: resultPayload.unitId,
        category: resultPayload.category,
        score: resultPayload.score,
        status: resultPayload.status,
      },
    });

    const resultRef = await addDoc(
      collection(db, getSemesterCollectionPath(config, "quiz_results")),
      resultPayload,
    );

    if (activeSubmissionPath) {
      try {
        await setDoc(
          doc(db, activeSubmissionPath),
          {
            ...buildSubmissionPayload(isTimeout ? "timed_out" : "submitted", {
              answers: answerMap,
              hintUsedCount: hintCount,
              revealedHintIds,
              resultId: resultRef.id,
            }),
            lastSavedAt: serverTimestamp(),
            submittedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (submissionError) {
        console.error("Failed to update quiz submission after result save", {
          submissionPath: activeSubmissionPath,
          submissionError,
        });
      }
    }

    setScore(finalScore);
    setResults(resultDetails);
    setFinalizedResultId(resultRef.id);
    setPointNotice("");
    setActiveSubmission((prev) =>
      prev
        ? normalizeQuizSubmissionDoc(prev.id, {
            ...prev,
            status: isTimeout ? "timed_out" : "submitted",
            answers: answerMap,
            hintUsedCount: hintCount,
            revealedHintIds,
            resultId: resultRef.id,
          })
        : prev,
    );
    setQuizDeadlineMs(null);

    return {
      resultId: resultRef.id,
      finalScore,
      resultDetails,
    };
  };

  const persistQuizProgress = async () => {
    if (
      !getResolvedStudentUid() ||
      !unitId ||
      !category ||
      !activeSubmissionPath ||
      view !== "quiz" ||
      finishSubmitting ||
      startingQuiz
    ) {
      return;
    }
    if (persistInFlightRef.current) return;

    persistInFlightRef.current = true;

    try {
      const payload = {
        ...buildSubmissionPayload("in_progress"),
        lastSavedAt: serverTimestamp(),
      };

      console.info("[QuizRunner] Saving quiz progress", {
        submissionPath: activeSubmissionPath,
        payload: {
          currentIndex: payload.currentIndex,
          answerCount: Object.keys(payload.answers).length,
          hintUsedCount: payload.hintUsedCount,
        },
      });

      await setDoc(doc(db, activeSubmissionPath), payload, { merge: true });
    } catch (saveError) {
      console.error("Failed to save quiz progress", {
        submissionPath: activeSubmissionPath,
        saveError,
      });
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const schedulePersistQuizProgress = () => {
    if (view !== "quiz" || finishSubmitting || startingQuiz) return;
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
    if (!unitId || !category || !fallbackStudentUid) return;
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
    if (view !== "quiz" || !activeSubmissionPath) return;

    return () => {
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
        void persistQuizProgress();
      }
    };
  }, [activeSubmissionPath, view]);

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
      setErrorMsg(null);
      setBlockReason(null);
      setResumeNotice("");
      setStartingQuiz(false);
      setFinishSubmitting(false);
      setPointNotice("");
      setActiveSubmission(null);
      setQuizDeadlineMs(null);
      setServerTimeOffsetMs(0);
      timeoutHandledRef.current = false;

      const [grade3ClassIds, curriculumTree] = await Promise.all([
        getGrade3ClassIdsFromSchoolConfig(),
        readStudentCurriculumTree(config),
      ]);
      unitOrderMapRef.current = buildUnitOrderMap(curriculumTree);
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

      if (!fetchedQuestions.length) {
        throw new Error("등록된 문제가 없습니다.");
      }

      const resultCollectionRef = collection(
        db,
        getSemesterCollectionPath(config, "quiz_results"),
      );
      const historyCategory = getMockExamResultCategory(category, examRound);
      const historyQueries = [
        query(
          resultCollectionRef,
          where("uid", "==", fallbackStudentUid),
          where("unitId", "==", unitId),
          where("category", "==", historyCategory),
        ),
      ];
      if (isMockExamCategory(category) && historyCategory !== category) {
        historyQueries.push(
          query(
            resultCollectionRef,
            where("uid", "==", fallbackStudentUid),
            where("unitId", "==", unitId),
            where("category", "==", category),
          ),
        );
      }
      const historySnaps = await Promise.all(
        historyQueries.map((historyQuery) => getDocs(historyQuery)),
      );

      const historyDocs = historySnaps
        .flatMap((historySnap) => historySnap.docs)
        .filter((historyDoc, index, docs) => {
          if (docs.findIndex((item) => item.id === historyDoc.id) !== index) {
            return false;
          }
          const historyData = historyDoc.data();
          return mockExamRoundMatches(
            historyData.category || category,
            historyData.examRound,
            examRound,
          );
        })
        .sort((left, right) => {
          const leftMs = readTimestampMs(left.data().timestamp);
          const rightMs = readTimestampMs(right.data().timestamp);
          return rightMs - leftMs;
        });
      setHistoryCount(historyDocs.length);

      let solvedHistoryDocs = historyDocs;
      if (isMockExamCategory(category)) {
        try {
          const allMockHistorySnap = await getDocs(
            query(
              resultCollectionRef,
              where("uid", "==", fallbackStudentUid),
              where("unitId", "==", unitId),
            ),
          );
          solvedHistoryDocs = allMockHistorySnap.docs.filter((historyDoc) => {
            const historyData = historyDoc.data();
            return isMockExamCategory(historyData.category || category);
          });
        } catch (mockHistoryError) {
          console.warn(
            "Failed to load all mock exam attempts for question selection:",
            mockHistoryError,
          );
        }
      }

      const submissionRef = doc(db, activeSubmissionPath);
      const submissionSnap = await getDoc(submissionRef).catch(() => null);
      const submissionData = submissionSnap?.data();
      const submissionRoundMatches =
        !isMockExamCategory(category) ||
        !submissionData?.examRound ||
        mockExamRoundMatches(category, submissionData.examRound, examRound);
      const existingSubmission =
        submissionSnap?.exists() &&
        submissionData?.uid === fallbackStudentUid &&
        submissionData?.unitId === unitId &&
        submissionData?.category === category &&
        submissionRoundMatches
          ? normalizeQuizSubmissionDoc(
              submissionSnap.id,
              submissionData as Partial<QuizSubmissionDoc>,
            )
          : null;

      if (existingSubmission?.status === "in_progress") {
        const questionMap = new Map(
          fetchedQuestions.map((question) => [String(question.id), question]),
        );
        const restoredQuestions = existingSubmission.questionIds
          .map((questionId) => questionMap.get(questionId))
          .filter((question): question is Question => Boolean(question));

        if (
          restoredQuestions.length === existingSubmission.questionIds.length
        ) {
          restoreSubmissionState(existingSubmission, restoredQuestions);

          const remainingSeconds =
            getQuizSubmissionRemainingSeconds(existingSubmission);
          if (remainingSeconds <= 0) {
            const finalized = await finalizeQuizAttempt({
              isTimeout: true,
              questionList: restoredQuestions,
              answerMap: existingSubmission.answers,
              hintCount: existingSubmission.hintUsedCount,
              revealedHintIds: existingSubmission.revealedHintIds,
            });
            setScore(finalized.finalScore);
            setResults(finalized.resultDetails);
            setResumeNotice(
              "저장된 응시가 종료 시각을 지나 자동 제출되었습니다.",
            );
            setView("result");
            return;
          }

          setResumeNotice("저장된 진행 상태를 이어서 풀 수 있습니다.");
          setView("intro");
          return;
        }
      }

      const allowRetakeForAttempt = isMockExamCategory(category)
        ? isAdditionalMockExamRound(examRound)
        : nextQuizConfig.allowRetake;

      if (!allowRetakeForAttempt && historyDocs.length > 0) {
        setBlockReason("재응시가 허용되지 않는 평가입니다.");
        setView("intro");
        return;
      }

      const cooldownMinutes = Number(nextQuizConfig.cooldown || 0);
      if (cooldownMinutes > 0 && historyDocs.length > 0) {
        const lastAttemptMs = readTimestampMs(historyDocs[0].data().timestamp);
        if (lastAttemptMs > 0) {
          const remainingMinutes =
            cooldownMinutes - (Date.now() - lastAttemptMs) / 1000 / 60;
          if (remainingMinutes > 0) {
            setBlockReason(
              `재응시 대기 시간: ${Math.ceil(remainingMinutes)}분 남음`,
            );
            setView("intro");
            return;
          }
        }
      }

      const solvedIds = new Set<number>();
      solvedHistoryDocs.forEach((historyDoc) => {
        const details = Array.isArray(historyDoc.data().details)
          ? historyDoc.data().details
          : [];
        details.forEach((detail: { id?: string | number }) => {
          const parsed = Number(detail?.id);
          if (Number.isFinite(parsed)) {
            solvedIds.add(parsed);
          }
        });
      });

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
      setTimeLeft(getQuizSubmissionRemainingSeconds(activeSubmission));
      timeoutHandledRef.current = false;
      setView("quiz");
      return;
    }

    setStartingQuiz(true);
    let submissionEmail = "";
    let startPayloadSummary: {
      uid: string;
      unitId: string;
      category: string;
      questionCount: number;
      title: string;
      status: string;
    } | null = null;
    try {
      const identity = await resolveStudentIdentity();
      const submissionRef = doc(db, activeSubmissionPath);
      const clientStartedAtMs = Date.now();
      submissionEmail = identity.email;
      if (!submissionEmail) {
        throw new Error("평가 시작에 필요한 이메일 정보를 찾지 못했습니다.");
      }
      const payload = {
        ...buildSubmissionPayload("in_progress", {
          answers: {},
          currentIndex: 0,
          hintUsedCount: 0,
          revealedHintIds: [],
          clientStartedAtMs,
        }),
        startedAt: serverTimestamp(),
        lastSavedAt: serverTimestamp(),
      };
      startPayloadSummary = {
        uid: payload.uid,
        unitId: payload.unitId,
        category: payload.category,
        questionCount: payload.questionIds.length,
        title: payload.title,
        status: payload.status,
      };

      console.info("[QuizRunner] Starting quiz attempt", {
        submissionPath: activeSubmissionPath,
        payload: {
          ...startPayloadSummary,
          email: submissionEmail,
        },
      });

      await setDoc(submissionRef, payload);
      const committedSubmission =
        (await readCommittedQuizSubmission(submissionRef)) ||
        normalizeQuizSubmissionDoc(submissionRef.id, {
          ...payload,
          startedAt: { seconds: Math.floor(clientStartedAtMs / 1000) },
        });

      setAnswers({});
      setCurrentIndex(0);
      setHintUsedCount(0);
      setRevealedHints({});
      restoreSubmissionState(committedSubmission, selectedQuestions);
      setResumeNotice("저장된 진행 상태를 이어서 풀 수 있습니다.");
      setView("quiz");
    } catch (error) {
      console.error("Failed to start quiz attempt", {
        submissionPath: activeSubmissionPath,
        payload: startPayloadSummary,
        currentUserUid: currentUser?.uid || "",
        currentUserEmail: submissionEmail,
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
    if (!question) return;

    emitSessionActivity();
    setAnswers((prev) => ({
      ...prev,
      [String(question.id)]: value,
    }));
    schedulePersistQuizProgress();
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
    setRevealedHints((prev) => ({
      ...prev,
      [questionId]: true,
    }));
    setHintUsedCount((prev) => prev + 1);
    schedulePersistQuizProgress();
  };

  const nextQuestion = async () => {
    emitSessionActivity();
    if (currentIndex < selectedQuestions.length - 1) {
      setMatchingActiveLeft("");
      setCurrentIndex((prev) => prev + 1);
      schedulePersistQuizProgress();
      return;
    }

    const confirmed = await confirm({
      title: "평가를 제출할까요?",
      message: "제출 후에는 답안을 수정할 수 없습니다.",
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
    if (currentIndex <= 0) return;
    emitSessionActivity();
    setMatchingActiveLeft("");
    setCurrentIndex((prev) => prev - 1);
    schedulePersistQuizProgress();
  };

  const goToQuestion = async (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= selectedQuestions.length) return;
    if (targetIndex === currentIndex) return;

    const confirmed = await confirm({
      title: `${targetIndex + 1}번 문제로 이동하시겠습니까?`,
      message: "지금까지 입력한 답안은 자동 저장됩니다.",
      confirmLabel: "이동하기",
      cancelLabel: "취소",
      tone: "info",
    });
    if (!confirmed) return;

    emitSessionActivity();
    setMatchingActiveLeft("");
    setCurrentIndex(targetIndex);
    schedulePersistQuizProgress();
  };

  const finishQuiz = async (isTimeout = false) => {
    if (finishSubmitting) return;
    if (!isTimeout) {
      emitSessionActivity();
    }

    setFinishSubmitting(true);
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

      try {
        const pointResult = await claimPointActivityReward({
          config,
          activityType: "quiz",
          sourceId: `quiz-result-${finalized.resultId}`,
          sourceLabel: title || "문제 풀이 완료",
        });
        if (
          pointResult.awarded &&
          (pointResult.totalAwarded || pointResult.amount)
        ) {
          notifyPointsUpdated();
        }
        if ((pointResult.totalAwarded || pointResult.amount) > 0) {
          const totalAwarded = Number(
            pointResult.totalAwarded || pointResult.amount || 0,
          );
          if (pointResult.bonusAwarded && pointResult.bonusAmount) {
            setPointNotice(
              `문제 풀이 위스가 적립되었습니다. 기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스`,
            );
            showToast({
              tone: "success",
              title: "문제 풀이 완료",
              message: `기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`,
            });
          } else {
            setPointNotice(
              `문제 풀이 위스가 적립되었습니다. +${totalAwarded}위스`,
            );
            showToast({
              tone: "success",
              title: "문제 풀이 완료",
              message: `+${totalAwarded}위스가 반영되었습니다.`,
            });
          }
        } else if (pointResult.duplicate) {
          setPointNotice("이번 문제 풀이 위스는 이미 반영되었습니다.");
          showToast({
            tone: "info",
            title: "문제 풀이 위스가 이미 반영되었습니다.",
          });
        }
      } catch (pointError) {
        console.error("Failed to claim quiz point reward", pointError);
        setPointNotice("문제 풀이 위스를 바로 반영하지 못했습니다.");
        showToast({
          tone: "warning",
          title: "문제 풀이 결과는 저장되었습니다.",
          message: "위스 반영 상태를 바로 확인하지 못했습니다.",
        });
      }

      setView("result");
    } catch (error) {
      console.error("Failed to finish quiz", error);
      showToast({
        tone: "error",
        title: "문제 풀이 결과 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
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
    const questionCount =
      selectedQuestions.length || quizConfig?.questionCount || 10;
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
    const introDescription = isMockExamAttempt
      ? "실제 시험 흐름에 맞춰 제한 시간 안에 모든 문항을 풀어 보세요."
      : "문항 수와 제한 시간을 확인한 뒤 바로 시작하세요.";
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

              <h1 className="mt-3 break-keep text-2xl font-black leading-tight text-slate-950 sm:mt-4 sm:text-3xl">
                {title}
              </h1>
              <p className="mt-2 max-w-2xl break-keep text-sm font-semibold leading-6 text-slate-500">
                {introDescription}
              </p>

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
                  시작하면 타이머가 바로 작동합니다. 답안을 확인한 뒤 마지막
                  문항에서 제출하세요.
                </p>
              </div>

              <div className="space-y-3">
                {!blockReason ? (
                  <button
                    type="button"
                    onClick={() => void startQuiz()}
                    disabled={startingQuiz}
                    className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 text-base font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 sm:h-12"
                  >
                    {introActionLabel}
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
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
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
    const answeredQuestionCount = selectedQuestions.filter((item) =>
      hasStudentAnswer(answers[String(item.id)]),
    ).length;
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
      <div className="student-quiz-runner mx-auto flex max-w-6xl animate-fadeIn flex-col px-3 py-3 sm:px-4 lg:max-w-7xl">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 shadow-sm">
              <i className="fas fa-file-signature shrink-0 text-[11px]"></i>
              <span className="min-w-0 truncate">{assessmentBadgeLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canUseHints && (
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                힌트 {hintUsedCount}/{maxHintUses}
              </div>
            )}
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-sm">
              <i className="fas fa-stopwatch text-red-500"></i>
              <span className="w-12 text-center font-mono text-lg font-bold text-gray-700">
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
          className="mb-3 shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
          aria-label="문항 이동"
        >
          <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
            <span>응시 진척도</span>
            <span>
              <span className="text-blue-600">{answeredQuestionCount}</span>/
              {selectedQuestions.length}문항 완료
            </span>
          </div>
          <div className="student-quiz-progress-scroll -mx-1 overflow-x-auto px-1 pb-0.5">
            <div
              className="grid min-w-full gap-1"
              style={{
                gridTemplateColumns: `repeat(${selectedQuestions.length}, minmax(1.5rem, 1fr))`,
              }}
            >
              {selectedQuestions.map((item, index) => {
                const answered = hasStudentAnswer(answers[String(item.id)]);
                const active = index === currentIndex;
                return (
                  <button
                    key={`question-progress-${item.id}-${index}`}
                    type="button"
                    onClick={() => void goToQuestion(index)}
                    aria-current={active ? "step" : undefined}
                    aria-label={`${index + 1}번 문제${
                      answered ? " 답안 입력됨" : " 미입력"
                    }`}
                    className={`flex h-7 items-center justify-center rounded-md border text-[10px] font-black leading-none transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${
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
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="student-quiz-shell flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <div
            className={`student-quiz-body-split min-h-0 flex-1 ${
              hasQuestionSupportPanel ? "student-quiz-body-has-support" : ""
            }`}
          >
            <section className="student-quiz-question-panel min-h-0 rounded-xl border border-gray-100 bg-slate-50/70 p-4">
              <div className="mb-4">
                <div className="mb-2 text-xs font-black text-blue-600">
                  문제
                </div>
                <h2 className="break-keep text-lg font-bold leading-snug text-gray-900 md:text-xl">
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
                    className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
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
                        src={question.image}
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

            <section className="student-quiz-answer-panel min-h-0 rounded-xl border border-gray-100 bg-white p-4">
              <div className="mb-3 text-xs font-black text-blue-600">
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
                        className={
                          hasChoiceOptionImages
                            ? `group flex h-full min-h-0 flex-col rounded-xl border-2 bg-white p-2 text-left transition ${
                                selected
                                  ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm"
                                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                              }`
                            : `flex cursor-pointer items-start rounded-xl border-2 px-3 py-2.5 text-left transition ${
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
                                  src={optionImage}
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
                              <div className="mt-2 line-clamp-2 min-h-[2.5rem] w-full break-keep text-center text-sm font-bold leading-5">
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
                                src={optionImage}
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
                  type="text"
                  value={currentAnswer}
                  onChange={(event) => handleAnswer(event.target.value)}
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
                              className={`relative z-20 flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
                                used
                                  ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                                  : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              {sourcePair?.rightImage && (
                                <img
                                  src={sourcePair.rightImage}
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
            </section>
          </div>

          <div className="mt-3 flex shrink-0 items-center justify-between border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={prevQuestion}
              disabled={currentIndex === 0}
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

    return (
      <div className="student-quiz-result mx-auto flex w-full max-w-2xl animate-fadeIn items-center px-4 py-4 text-center sm:py-6">
        <div className="w-full rounded-2xl border-t-8 border-blue-500 bg-white p-6 shadow-xl sm:p-8">
          <h2 className="mb-2 text-3xl font-black text-gray-800">평가 종료</h2>
          <p className="mb-8 text-gray-500">
            수고하셨습니다. 결과를 확인하세요.
          </p>
          {!!pointNotice && (
            <div
              className={`mb-6 rounded-xl px-4 py-3 text-sm font-bold ${
                pointNotice.includes("못했습니다")
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {pointNotice}
            </div>
          )}

          <div className="relative mx-auto mb-6 flex h-48 w-48 items-center justify-center rounded-full border-8 border-blue-50">
            <div className="flex flex-col items-center justify-center">
              <span className="text-5xl font-black text-blue-600">{score}</span>
              <span className="text-sm font-bold text-gray-400">점</span>
            </div>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate(resultReviewUrl)}
              className="rounded-xl border-2 border-blue-100 bg-blue-50 py-3 font-bold text-blue-700 transition hover:border-blue-200 hover:bg-blue-100"
            >
              오답노트에서 확인
            </button>
            <button
              type="button"
              onClick={() => navigate("/student/quiz")}
              className="rounded-xl bg-gray-800 py-3 font-bold text-white shadow-md transition hover:bg-gray-900"
            >
              목록으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <div></div>;
};

export default QuizRunner;
