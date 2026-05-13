import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageLoading } from "../../../components/common/LoadingState";
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
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import {
  createDefaultAssessmentConfigEntry,
  getAssessmentConfigKey,
  getGrade3ClassIdsFromSchoolConfig,
  isAssessmentVisibleToStudent,
  readAssessmentConfigMap,
} from "../../../lib/assessmentConfig";
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

const QUIZ_PROGRESS_SAVE_DELAY_MS = 1500;

interface Question {
  id: number;
  type: "choice" | "ox" | "short" | "word" | "order" | "matching";
  question: string;
  options?: string[];
  answer: string | number;
  matchingPairs?: MatchingPair[];
  explanation?: string;
  image?: string;
  hintEnabled?: boolean;
  hint?: string;
  refBig?: string;
  refMid?: string;
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
}

interface ResultDetail {
  q: string;
  u: string | undefined;
  a: string | number;
  correct: boolean;
  exp?: string;
  type?: Question["type"];
  matchingPairs?: MatchingPair[];
}

interface QuizLogDetail {
  id: number;
  correct: boolean;
  u: string;
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userData, config, currentUser } = useAuth();

  const unitId = searchParams.get("unitId");
  const category = searchParams.get("category");
  const title = searchParams.get("title") || "평가";

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
  const [startingQuiz, setStartingQuiz] = useState(false);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [quizDeadlineMs, setQuizDeadlineMs] = useState<number | null>(null);

  const [score, setScore] = useState(0);
  const [results, setResults] = useState<ResultDetail[]>([]);
  const [pointNotice, setPointNotice] = useState("");
  const [finishSubmitting, setFinishSubmitting] = useState(false);

  const timerRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  const persistInFlightRef = useRef(false);
  const timeoutHandledRef = useRef(false);
  const authIdentityRef = useRef<{ uid: string; email: string }>({
    uid: "",
    email: "",
  });

  const maxHintUses = quizConfig?.hintLimit ?? 2;
  const fallbackStudentUid =
    normalizeStudentText(currentUser?.uid) ||
    normalizeStudentText(userData?.uid);
  const fallbackStudentEmail =
    normalizeStudentEmail(currentUser?.email) ||
    normalizeStudentEmail(userData?.email);
  const activeSubmissionPath =
    fallbackStudentUid && unitId && category
      ? getQuizSubmissionDocPath(config, fallbackStudentUid, unitId, category)
      : "";

  const parseOrderAnswer = (value: string) =>
    value.split(ORDER_DELIMITER).filter(Boolean);

  const parseMatchingPairs = (question: Question): MatchingPair[] => {
    if (Array.isArray(question.matchingPairs) && question.matchingPairs.length) {
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
    randomOrder: boolean,
  ) => {
    let pool = all.filter((question) => !solvedIds.has(question.id));
    if (pool.length < targetCount) {
      pool = [...all];
    }

    const orderedPool = randomOrder
      ? [...pool].sort(() => 0.5 - Math.random())
      : [...pool].sort((left, right) => left.id - right.id);
    const selected = orderedPool.slice(0, targetCount);

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
      nextOrderMap[question.id] = [...base].sort(() => 0.5 - Math.random());
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
        type: question.type,
        matchingPairs:
          question.type === "matching" ? parseMatchingPairs(question) : [],
      });

      logDetails.push({
        id: question.id,
        correct: isCorrect,
        u: userAnswer,
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
      category: String(category || "").trim(),
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
  }, [config, unitId, category, fallbackStudentUid]);

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

      const grade3ClassIds = await getGrade3ClassIdsFromSchoolConfig();
      const assessmentConfigMap = await readAssessmentConfigMap(
        config,
        grade3ClassIds,
      );
      const configKey = getAssessmentConfigKey(unitId || "", category || "");
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
        fetchedQuestions.push({
          id: parseInt(questionDoc.id, 10),
          ...questionDoc.data(),
        } as Question);
      });

      if (!fetchedQuestions.length) {
        throw new Error("등록된 문제가 없습니다.");
      }

      const historySnap = await getDocs(
        query(
          collection(db, getSemesterCollectionPath(config, "quiz_results")),
          where("uid", "==", fallbackStudentUid),
          where("unitId", "==", unitId),
          where("category", "==", category),
        ),
      );

      const historyDocs = [...historySnap.docs].sort((left, right) => {
        const leftMs = readTimestampMs(left.data().timestamp);
        const rightMs = readTimestampMs(right.data().timestamp);
        return rightMs - leftMs;
      });
      setHistoryCount(historyDocs.length);

      const submissionRef = doc(db, activeSubmissionPath);
      const submissionSnap = await getDoc(submissionRef).catch(() => null);
      const existingSubmission =
        submissionSnap?.exists() &&
        submissionSnap.data()?.uid === fallbackStudentUid &&
        submissionSnap.data()?.unitId === unitId &&
        submissionSnap.data()?.category === category
          ? normalizeQuizSubmissionDoc(
              submissionSnap.id,
              submissionSnap.data() as Partial<QuizSubmissionDoc>,
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

      if (
        !nextQuizConfig.allowRetake &&
        historyDocs.length > 0 &&
        unitId !== "exam_prep"
      ) {
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
      historyDocs.forEach((historyDoc) => {
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

      const selection = selectQuestions(
        fetchedQuestions,
        solvedIds,
        nextQuizConfig.questionCount || 10,
        nextQuizConfig.randomOrder ?? true,
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
    if (hintUsedCount >= maxHintUses) {
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

  const nextQuestion = () => {
    emitSessionActivity();
    if (currentIndex < selectedQuestions.length - 1) {
      setMatchingActiveLeft("");
      setCurrentIndex((prev) => prev + 1);
      schedulePersistQuizProgress();
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
    return (
      <PageLoading message="퀴즈를 준비하는 중입니다." />
    );
  }

  if (view === "intro") {
    const timeLimitMinutes = Math.max(1, Math.round(timeLimitSeconds / 60));
    const questionCount =
      selectedQuestions.length || quizConfig?.questionCount || 10;
    const introActionLabel = startingQuiz
      ? "준비 중..."
      : activeSubmission?.status === "in_progress"
        ? "이어하기"
        : "평가 시작하기";

    return (
      <div className="mx-auto flex min-h-screen max-w-2xl animate-fadeIn flex-col items-center justify-center px-4 py-8 text-center">
        <div className="relative w-full rounded-2xl border border-gray-100 bg-white p-8 shadow-lg">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-3xl text-blue-600">
            <i className="fas fa-file-signature"></i>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mb-6 inline-block rounded-full bg-gray-50 px-4 py-1 text-sm font-medium text-gray-500">
            {category === "diagnostic"
              ? "진단평가"
              : category === "formative"
                ? "형성평가"
                : "학기 시험 대비"}
          </p>

          <div className="mb-8 space-y-4 rounded-xl border border-blue-100 bg-blue-50 p-5 text-left text-base">
            <div className="flex justify-between border-b border-blue-200 pb-2">
              <span className="text-gray-600">제한 시간</span>
              <span className="text-lg font-bold text-blue-800">
                {timeLimitMinutes}분
              </span>
            </div>
            <div className="flex justify-between border-b border-blue-200 pb-2">
              <span className="text-gray-600">출제 문항 수</span>
              <span className="text-lg font-bold text-blue-800">
                {questionCount}문항
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">응시 횟수</span>
              <span className="text-lg font-bold text-gray-800">
                {historyCount}회
              </span>
            </div>
          </div>

          {resumeNotice && !blockReason && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-bold text-emerald-700">
              {resumeNotice}
            </div>
          )}

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 font-bold text-red-500">
              {errorMsg}
            </div>
          )}

          {!blockReason ? (
            <button
              type="button"
              onClick={() => void startQuiz()}
              disabled={startingQuiz}
              className="w-full rounded-xl bg-blue-600 py-4 text-lg font-bold text-white shadow-md transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {introActionLabel}
            </button>
          ) : (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 font-bold text-red-500">
              <i className="fas fa-ban mr-2"></i>
              {blockReason}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-4 text-sm text-gray-400 hover:underline"
          >
            돌아가기
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

    const progress = Math.max(
      0,
      Math.min(100, (timeLeft / timeLimitSeconds) * 100),
    );
    const currentAnswer = answers[String(question.id)] || "";

    return (
      <div className="mx-auto flex min-h-screen max-w-2xl animate-fadeIn flex-col px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="font-bold text-gray-500">
            <span className="text-blue-600">{currentIndex + 1}</span> /{" "}
            {selectedQuestions.length}
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
              힌트 {hintUsedCount}/{maxHintUses}
            </div>
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

        <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-2 rounded-full transition-all duration-1000 ease-linear ${
              progress < 20 ? "bg-red-500" : "bg-blue-500"
            }`}
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="flex flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
          {question.image && (
            <div className="mb-4 text-center">
              <img
                src={question.image}
                className="mx-auto max-h-48 rounded-lg border border-gray-100"
                alt="Question"
              />
            </div>
          )}

          <h2 className="mb-8 break-keep text-xl font-bold leading-snug text-gray-800 md:text-2xl">
            {question.question}
          </h2>

          {!!(question.hintEnabled && question.hint) && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => revealHint(question)}
                disabled={
                  !!revealedHints[question.id] || hintUsedCount >= maxHintUses
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

          <div className="flex-1 space-y-3">
            {question.type === "choice" &&
              question.options?.map((option, index) => (
                <div
                  key={option}
                  onClick={() => handleAnswer(option)}
                  className={`flex cursor-pointer items-center rounded-xl border-2 p-4 transition ${
                    currentAnswer === option
                      ? "border-blue-500 bg-blue-50 font-bold text-blue-800"
                      : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <div
                    className={`mr-3 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                      currentAnswer === option
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>{option}</div>
                </div>
              ))}

            {question.type === "ox" &&
              ["O", "X"].map((option) => (
                <div
                  key={option}
                  onClick={() => handleAnswer(option)}
                  className={`cursor-pointer rounded-xl border-2 p-6 text-center text-xl font-bold transition ${
                    currentAnswer === option
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  {option}
                </div>
              ))}

            {(question.type === "short" || question.type === "word") && (
              <input
                type="text"
                value={currentAnswer}
                onChange={(event) => handleAnswer(event.target.value)}
                className="w-full border-b-2 border-gray-300 bg-transparent p-3 text-center text-lg outline-none focus:border-blue-500"
                placeholder="정답을 입력하세요"
              />
            )}

            {question.type === "order" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(orderOptionMap[question.id] || question.options || []).map(
                    (option, index) => {
                      const selected =
                        parseOrderAnswer(currentAnswer).includes(option);
                      return (
                        <button
                          key={`${option}-${index}`}
                          type="button"
                          onClick={() => appendOrderSelection(option)}
                          className={`rounded-lg border-2 px-3 py-2 text-sm font-bold transition ${
                            selected
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-gray-200 hover:border-blue-300"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="min-h-[84px] rounded-xl border border-dashed border-blue-300 bg-blue-50 p-3">
                  <div className="mb-2 text-xs text-gray-500">
                    선택한 순서 (클릭하면 제거)
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {parseOrderAnswer(currentAnswer).map((item, index, list) => (
                      <React.Fragment key={`${item}-${index}`}>
                        <button
                          type="button"
                          onClick={() => removeOrderSelection(index)}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm"
                        >
                          {item}
                        </button>
                        {index < list.length - 1 && (
                          <i className="fas fa-arrow-right text-blue-500"></i>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {question.type === "matching" && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  {parseMatchingPairs(question).map((pair, index) => {
                    const selectedRight =
                      parseMatchingAnswer(currentAnswer)[pair.left] || "";
                    return (
                      <button
                        key={`${pair.left}-${index}`}
                        type="button"
                        onClick={() => setMatchingActiveLeft(pair.left)}
                        className={`w-full rounded-xl border-2 p-4 text-left transition ${
                          matchingActiveLeft === pair.left
                            ? "border-blue-500 bg-blue-50 text-blue-800"
                            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        <div className="font-bold">{pair.left}</div>
                        {selectedRight && (
                          <div className="mt-2 flex items-center gap-2 text-sm font-bold text-blue-600">
                            <i className="fas fa-arrow-right"></i>
                            <span>{selectedRight}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {(
                    orderOptionMap[question.id] ||
                    parseMatchingPairs(question).map((pair) => pair.right)
                  ).map((right, index) => {
                    const sourcePair = parseMatchingPairs(question).find(
                      (pair) => pair.right === right,
                    );
                    const used = Object.values(
                      parseMatchingAnswer(currentAnswer),
                    ).includes(right);
                    return (
                      <button
                        key={`${right}-${index}`}
                        type="button"
                        onClick={() => handleMatchingRightSelect(right)}
                        className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
                          used
                            ? "border-blue-500 bg-blue-50 font-bold text-blue-700"
                            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
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
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={prevQuestion}
              disabled={currentIndex === 0}
              className={`flex items-center rounded-xl px-6 py-3 font-bold shadow-sm transition ${
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
              onClick={nextQuestion}
              disabled={finishSubmitting}
              className="flex items-center rounded-xl bg-gray-800 px-8 py-3 font-bold text-white shadow-lg transition hover:bg-gray-900 disabled:opacity-60"
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
    return (
      <div className="mx-auto min-h-screen max-w-2xl animate-fadeIn px-4 py-8 text-center">
        <div className="mb-8 rounded-2xl border-t-8 border-blue-500 bg-white p-8 shadow-xl">
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

          <div className="mb-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("review-section")
                  ?.classList.toggle("hidden")
              }
              className="rounded-xl border-2 border-gray-200 bg-white py-3 font-bold text-gray-700 transition hover:bg-gray-50"
            >
              오답 노트
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

        <div
          id="review-section"
          className="hidden animate-slideDown rounded-2xl border border-red-100 bg-white p-6 text-left shadow-lg"
        >
          <h3 className="mb-4 border-b pb-2 text-lg font-bold text-red-500">
            <i className="fas fa-check-circle mr-2"></i>
            채점 결과 확인
          </h3>
          <div className="space-y-6">
            {results.map((result, index) => (
              <div
                key={`${result.q}-${index}`}
                className={`border-b pb-4 last:border-0 ${
                  result.correct ? "opacity-50" : ""
                }`}
              >
                <div className="mb-2 flex items-start gap-2">
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      result.correct
                        ? "bg-green-100 text-green-600"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    Q{index + 1}
                  </span>
                  <div className="font-bold text-gray-800">{result.q}</div>
                </div>
                <div className="mb-2 ml-8 flex gap-4 text-sm">
                  <span
                    className={`font-bold ${
                      result.correct
                        ? "text-green-500"
                        : "text-red-500 line-through"
                    }`}
                  >
                    {formatAnswerForDisplay(result.u, result.type)}
                  </span>
                  {!result.correct && (
                    <span className="font-bold text-blue-600">
                      <i className="fas fa-arrow-right mr-1"></i>
                      {formatAnswerForDisplay(result.a, result.type)}
                    </span>
                  )}
                </div>
                <div className="ml-8 rounded bg-gray-50 p-3 text-xs text-gray-600">
                  {result.exp || "해설 없음"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <div></div>;
};

export default QuizRunner;
