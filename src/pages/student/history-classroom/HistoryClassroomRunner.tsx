import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppToast } from "../../../components/common/AppToastProvider";
import HistoryClassroomAssignmentView from "../../../components/common/HistoryClassroomAssignmentView";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import { db } from "../../../lib/firebase";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomRemainingMs,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  summarizeHistoryClassroomAnswers,
  type HistoryClassroomAnswerCheck,
  type HistoryClassroomAssignment,
} from "../../../lib/historyClassroom";
import { normalizeMapResource } from "../../../lib/mapResources";
import {
  readLocalOnly,
  removeStorage,
  writeLocalOnly,
} from "../../../lib/safeStorage";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import {
  getYearSemester,
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../../lib/semesterScope";
import {
  buildAssessmentDefinitionId,
  getAssessmentState,
  saveAssessmentProgress,
  startAssessmentAttempt,
  submitAssessmentAttempt,
} from "../../../lib/assessmentLifecycle";
import type {
  AssessmentAttemptState,
  AssessmentRewardResult,
} from "../../../lib/commandGateway";

const HISTORY_CLASSROOM_LOCK_PREFIX = "westoryHistoryClassroomLock";
const HISTORY_CLASSROOM_ATTEMPT_PREFIX = "westoryHistoryClassroomAttempt";
const HISTORY_CLASSROOM_ROTATION_PREFIX = "westoryHistoryClassroomRotation";
const SCREEN_ROTATION_GRACE_MS = 8000;

const formatRemainingDuration = (remainMs: number) => {
  if (remainMs <= 0) return "마감";

  const totalMinutes = Math.max(1, Math.ceil(remainMs / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }

  return `${minutes}분`;
};

const getCooldownLockKey = (assignmentId: string, uid: string) =>
  `${HISTORY_CLASSROOM_LOCK_PREFIX}:${assignmentId}:${uid}`;

const getAttemptProgressKey = (assignmentId: string, uid: string) =>
  `${HISTORY_CLASSROOM_ATTEMPT_PREFIX}:${assignmentId}:${uid}`;

const getExitCooldownMinutes = (
  assignment: Pick<HistoryClassroomAssignment, "cooldownMinutes"> | null,
) => Math.max(0, Number(assignment?.cooldownMinutes || 0));

const getRotationGraceKey = (assignmentId: string, uid: string) =>
  `${HISTORY_CLASSROOM_ROTATION_PREFIX}:${assignmentId}:${uid}`;

const readJsonObject = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (error) {
    console.warn("Failed to parse history classroom local state", error);
    return null;
  }
};

const clearCooldownLock = (assignmentId: string, uid: string) => {
  removeStorage(getCooldownLockKey(assignmentId, uid));
};

const writeRotationGrace = (assignmentId: string, uid: string) => {
  writeLocalOnly(
    getRotationGraceKey(assignmentId, uid),
    JSON.stringify({
      until: Date.now() + SCREEN_ROTATION_GRACE_MS,
      savedAt: Date.now(),
    }),
  );
};

const readRotationGraceUntil = (assignmentId: string, uid: string): number => {
  const key = getRotationGraceKey(assignmentId, uid);
  const parsed = readJsonObject(readLocalOnly(key));
  const until = Number(parsed?.until) || 0;
  if (until > Date.now()) return until;
  if (parsed) removeStorage(key);
  return 0;
};

const clearAttemptProgress = (assignmentId: string, uid: string) => {
  removeStorage(getAttemptProgressKey(assignmentId, uid));
  removeStorage(getRotationGraceKey(assignmentId, uid));
};

type HistoryClassroomResultWrongItem = {
  blankId: string;
  blankNumber: number;
  studentAnswer: string;
  correctAnswer: string;
};

type HistoryClassroomResultModalSummary = {
  total: number;
  correctCount: number;
  wrongCount: number;
  percent: number;
  passed: boolean;
  passThresholdPercent: number;
  answerChecks: HistoryClassroomAnswerCheck[];
  wrongItems: HistoryClassroomResultWrongItem[];
};

type HistoryClassroomExitAction = {
  reason: string;
  redirectTo?: string | null;
  replace?: boolean;
  mode?: "route" | "back" | "reload";
};
type HistoryClassroomExitRequestOptions = Omit<
  HistoryClassroomExitAction,
  "reason"
>;

const HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS = 20000;

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) => {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

const sanitizeHistoryClassroomAnswersForWrite = (
  rawAnswers: Record<string, string>,
) =>
  Object.fromEntries(
    Object.entries(rawAnswers)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
      .filter(([key]) => key),
  );

const sanitizeHistoryClassroomAnswerChecksForWrite = (
  checks: HistoryClassroomAnswerCheck[],
) =>
  checks
    .map((check, index) => ({
      blankId: String(check.blankId || "").trim(),
      blankNumber: Math.max(1, Number(check.blankNumber) || index + 1),
      page: Math.max(1, Number(check.page) || 1),
      studentAnswer: String(check.studentAnswer ?? ""),
      correctAnswer: String(check.correctAnswer ?? ""),
      correct: check.correct === true,
    }))
    .filter((check) => check.blankId);

const buildHistoryClassroomResultSummary = (
  assignment: HistoryClassroomAssignment,
  answers: Record<string, string>,
  passed: boolean,
  percent: number,
): HistoryClassroomResultModalSummary => {
  const summary = summarizeHistoryClassroomAnswers(assignment, answers);
  const wrongItems: HistoryClassroomResultWrongItem[] = summary.checks
    .filter((check) => !check.correct)
    .map((check) => ({
      blankId: check.blankId,
      blankNumber: check.blankNumber,
      studentAnswer: check.studentAnswer,
      correctAnswer: check.correctAnswer,
    }));

  return {
    total: summary.total,
    correctCount: summary.score,
    wrongCount: summary.total - summary.score,
    percent,
    passed,
    passThresholdPercent: assignment.passThresholdPercent,
    answerChecks: summary.checks,
    wrongItems,
  };
};

const HistoryClassroomRunner: React.FC = () => {
  const { showToast } = useAppToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userData, config } = useAuth();
  const assignmentId = searchParams.get("id") || "";
  const explicitLegacySource = searchParams.get("source") === "LEGACY";

  const [assignment, setAssignment] =
    useState<HistoryClassroomAssignment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [legacySource, setLegacySource] = useState(false);
  const [legacyNoticeOpen, setLegacyNoticeOpen] = useState(true);
  const [resultText, setResultText] = useState("");
  const [resultSummary, setResultSummary] =
    useState<HistoryClassroomResultModalSummary | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [pendingExitAction, setPendingExitAction] =
    useState<HistoryClassroomExitAction | null>(null);
  const [exitConfirmSubmitting, setExitConfirmSubmitting] = useState(false);
  const [isNetworkOffline, setIsNetworkOffline] = useState(() =>
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  const [pendingSubmitAfterOnline, setPendingSubmitAfterOnline] =
    useState(false);
  const [pointNotice, setPointNotice] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [remainingDueMs, setRemainingDueMs] = useState<number | null>(null);
  const [canonicalAttempt, setCanonicalAttempt] =
    useState<AssessmentAttemptState | null>(null);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [startingAttempt, setStartingAttempt] = useState(false);
  const canonicalAttemptRef = useRef<AssessmentAttemptState | null>(null);
  const progressSaveTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const latestProgressRef = useRef({ answers, currentPage });
  latestProgressRef.current = { answers, currentPage };
  const cancellationInFlightRef = useRef(false);
  const exitNavigationAllowedRef = useRef(false);
  const backGuardRearmRef = useRef<(() => void) | null>(null);
  const autoSubmitHandledRef = useRef(false);
  const resultSummaryShownRef = useRef(false);
  const completedRef = useRef(false);
  const submittingRef = useRef(false);
  const attemptDeadlineMsRef = useRef(0);
  const serverTimeOffsetMsRef = useRef(0);
  const networkOfflineRef = useRef(isNetworkOffline);
  const networkOfflineStartedAtRef = useRef<number | null>(
    isNetworkOffline ? Date.now() : null,
  );
  const screenRotationGraceUntilRef = useRef(0);
  const viewportOrientationRef = useRef<{
    width: number;
    height: number;
    landscape: boolean;
  } | null>(null);

  useEffect(() => {
    canonicalAttemptRef.current = canonicalAttempt;
  }, [canonicalAttempt]);

  useEffect(() => {
    const loadAssignment = async () => {
      if (!userData?.uid) return;
      if (!assignmentId) {
        setError(
          "역사교실 링크에 과제 ID가 없습니다. 목록에서 다시 선택해 주세요.",
        );
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      setLegacySource(false);
      setLegacyNoticeOpen(true);

      try {
        const { year, semester } = getYearSemester(config);
        const definitionId = buildAssessmentDefinitionId(
          `${year}-${semester}`,
          "HISTORY_CLASSROOM",
          assignmentId,
        );
        const assessmentState = explicitLegacySource
          ? null
          : await getAssessmentState({ definitionId });
        if (!explicitLegacySource && !assessmentState?.definition) {
          throw new Error(
            "유효하지 않거나 더 이상 사용할 수 없는 역사교실 링크입니다.",
          );
        }
        const stateError =
          assessmentState?.status === "PERMISSION"
            ? "현재 학기·학급 배정으로는 이 역사교실에 응시할 수 없습니다."
            : assessmentState?.status === "NOT_OPEN"
              ? "아직 응시할 수 있도록 공개되지 않은 역사교실입니다."
              : assessmentState?.status === "CLOSED"
                ? "응시 기간이 종료된 역사교실입니다."
                : assessmentState?.status === "ARCHIVED"
                  ? "지난 학기 역사교실로, 읽기 전용입니다."
                  : "";
        if (stateError) throw new Error(stateError);
        const snap = await getDoc(
          doc(
            db,
            explicitLegacySource
              ? `history_classrooms/${assignmentId}`
              : getSemesterDocPath(config, "history_classrooms", assignmentId),
          ),
        );
        if (!snap.exists()) {
          throw new Error("역사교실 자료를 찾을 수 없습니다.");
        }

        let loaded = normalizeHistoryClassroomAssignment(snap.id, snap.data());
        if (
          loaded.mapResourceId &&
          (!(loaded.pdfPageImages?.length || 0) ||
            !(loaded.pdfRegions?.length || 0))
        ) {
          const mapSnap = await getDoc(
            doc(
              db,
              explicitLegacySource
                ? `map_resources/${loaded.mapResourceId}`
                : getSemesterDocPath(
                    config,
                    "map_resources",
                    loaded.mapResourceId,
                  ),
            ),
          );
          if (mapSnap.exists()) {
            loaded = mergeHistoryClassroomMapSnapshot(
              loaded,
              normalizeMapResource(mapSnap.id, mapSnap.data()),
            );
          }
        }

        if (isHistoryClassroomDeleted(loaded)) {
          throw new Error("삭제된 역사교실입니다.");
        }

        const assignedStudentUids =
          getHistoryClassroomAssignedStudentUids(loaded);

        if (!assignedStudentUids.includes(userData.uid)) {
          throw new Error("이 과제는 현재 계정에 배정되지 않았습니다.");
        }
        if (!loaded.isPublished) {
          throw new Error("아직 공개되지 않은 과제입니다.");
        }

        if (isHistoryClassroomPastDue(loaded)) {
          throw new Error("응시 기간이 마감된 역사교실입니다.");
        }
        if (explicitLegacySource) {
          setAssignment(loaded);
          setLegacySource(true);
          setCurrentPage(loaded.pdfPageImages?.[0]?.page || 1);
          setAnswers({});
          setCanonicalAttempt(null);
          setAttemptStarted(false);
          setCompleted(false);
          return;
        }
        if (!assessmentState)
          throw new Error("역사교실 응시 상태를 확인할 수 없습니다.");
        const savedAttempt = assessmentState.attempt;
        const savedAnswers = savedAttempt?.answers || {};
        const savedPage = Number(savedAttempt?.currentItemId) || 0;
        const nextDeadlineMs = savedAttempt
          ? Date.parse(savedAttempt.deadlineAtIso)
          : 0;
        const initialRemainingSeconds = savedAttempt
          ? Math.max(
              0,
              Math.ceil(
                (nextDeadlineMs - Date.parse(assessmentState.serverNowIso)) /
                  1000,
              ),
            )
          : null;
        setAssignment(loaded);
        setCurrentPage(savedPage || loaded.pdfPageImages?.[0]?.page || 1);
        setAnswers(savedAnswers);
        setCanonicalAttempt(savedAttempt);
        setAttemptStarted(false);
        setCompleted(false);
        completedRef.current = false;
        submittingRef.current = false;
        setResultText("");
        setResultSummary(null);
        setResultDialogOpen(false);
        setPendingExitAction(null);
        setExitConfirmSubmitting(false);
        setPendingSubmitAfterOnline(false);
        resultSummaryShownRef.current = false;
        setPointNotice("");
        setRemainingSeconds(initialRemainingSeconds);
        setRemainingDueMs(
          getHistoryClassroomRemainingMs(
            loaded,
            Date.parse(assessmentState.serverNowIso),
          ),
        );
        cancellationInFlightRef.current = false;
        exitNavigationAllowedRef.current = false;
        autoSubmitHandledRef.current = false;
        attemptDeadlineMsRef.current = nextDeadlineMs;
        serverTimeOffsetMsRef.current =
          Date.parse(assessmentState.serverNowIso) - Date.now();
        screenRotationGraceUntilRef.current = 0;
      } catch (loadError) {
        console.error(loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "과제를 불러오지 못했습니다.",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadAssignment();
  }, [assignmentId, config, explicitLegacySource, userData?.uid]);

  const beginOrResumeAttempt = async () => {
    if (!assignment || !userData?.uid || startingAttempt) return;
    setStartingAttempt(true);
    setResultText("");
    try {
      const { year, semester } = getYearSemester(config);
      const definitionId = buildAssessmentDefinitionId(
        `${year}-${semester}`,
        "HISTORY_CLASSROOM",
        assignment.id,
      );
      const attempt = await startAssessmentAttempt({ definitionId });
      canonicalAttemptRef.current = attempt;
      setCanonicalAttempt(attempt);
      setAnswers(attempt.answers || {});
      const savedPage = Number(attempt.currentItemId) || 0;
      setCurrentPage(savedPage || assignment.pdfPageImages?.[0]?.page || 1);
      attemptDeadlineMsRef.current = Date.parse(attempt.deadlineAtIso);
      serverTimeOffsetMsRef.current =
        Date.parse(attempt.startedAtIso) - Date.now();
      setRemainingSeconds(
        Math.max(
          0,
          Math.ceil(
            (attemptDeadlineMsRef.current -
              (Date.now() + serverTimeOffsetMsRef.current)) /
              1000,
          ),
        ),
      );
      setAttemptStarted(true);
      setResultText(
        attempt.resumed
          ? "서버에 저장된 답안과 종료 시각을 이어받았습니다."
          : "응시가 시작되었습니다. 답안은 서버에 자동 저장됩니다.",
      );
    } catch (startError) {
      setResultText(
        startError instanceof Error
          ? startError.message
          : "응시를 시작하지 못했습니다.",
      );
    } finally {
      setStartingAttempt(false);
    }
  };

  const persistCanonicalProgress = (recoverable = false) => {
    const targetAttemptId = canonicalAttemptRef.current?.attemptId;
    const snapshot = latestProgressRef.current;
    const task = progressSaveTailRef.current
      .catch(() => undefined)
      .then(async () => {
        const activeAttempt = canonicalAttemptRef.current;
        if (
          !activeAttempt ||
          activeAttempt.attemptId !== targetAttemptId ||
          !["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(
            activeAttempt.status,
          )
        )
          return null;
        const saved = await saveAssessmentProgress({
          attemptId: activeAttempt.attemptId,
          expectedRevision: activeAttempt.revision,
          answers: sanitizeHistoryClassroomAnswersForWrite(snapshot.answers),
          currentItemId: String(snapshot.currentPage),
        });
        const current = canonicalAttemptRef.current;
        if (
          current?.attemptId === targetAttemptId &&
          ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(current.status) &&
          current.revision <= saved.revision
        ) {
          const nextAttempt: AssessmentAttemptState = {
            ...current,
            status: recoverable ? "RECOVERABLE" : "IN_PROGRESS",
            revision: saved.revision,
            answers: snapshot.answers,
            currentItemId: String(snapshot.currentPage),
            lastSavedAtIso: saved.savedAtIso,
          };
          serverTimeOffsetMsRef.current =
            Date.parse(saved.savedAtIso) - Date.now();
          canonicalAttemptRef.current = nextAttempt;
          setCanonicalAttempt(nextAttempt);
        }
        return saved;
      });
    progressSaveTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  const saveResult = async (options: {
    submitReason: "STUDENT" | "TIMEOUT";
  }) => {
    await progressSaveTailRef.current;
    const activeAttempt = canonicalAttemptRef.current;
    if (!assignment || !userData || !activeAttempt) return null;

    const sanitizedAnswers = sanitizeHistoryClassroomAnswersForWrite(answers);
    const answerSummary = summarizeHistoryClassroomAnswers(
      assignment,
      sanitizedAnswers,
    );
    const { checks: answerChecks, score, total, percent } = answerSummary;
    const sanitizedAnswerChecks =
      sanitizeHistoryClassroomAnswerChecksForWrite(answerChecks);
    const passed = percent >= assignment.passThresholdPercent;
    const status = passed ? "passed" : "failed";
    const submitted = await withTimeout(
      submitAssessmentAttempt({
        attemptId: activeAttempt.attemptId,
        expectedRevision: activeAttempt.revision,
        answers: sanitizedAnswers,
        submitReason: options.submitReason,
      }),
      HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
      "history classroom canonical submission",
    );

    clearAttemptProgress(assignment.id, userData.uid);
    attemptDeadlineMsRef.current = 0;
    const completedAttempt: AssessmentAttemptState = {
      ...activeAttempt,
      status: "SUBMITTED",
      revision: submitted.revision,
      answers: sanitizedAnswers,
      resultRef: submitted.resultRef,
    };
    canonicalAttemptRef.current = completedAttempt;
    setCanonicalAttempt(completedAttempt);

    return {
      score: submitted.score,
      total: submitted.total,
      percent: submitted.percent,
      status,
      passed: submitted.percent >= assignment.passThresholdPercent,
      answerChecks: sanitizedAnswerChecks.map((check) => ({
        ...check,
        correct:
          submitted.answerChecks.find((item) => item.id === check.blankId)
            ?.correct ?? check.correct,
      })),
      resultId: submitted.attemptId,
      resultCollectionPath: submitted.resultRef,
      usedLegacyResultFallback: false,
      reward: submitted.reward,
      replayedSubmission: submitted.replayedSubmission,
    };
  };

  const applyHistoryClassroomPointReward = (
    pointResult: AssessmentRewardResult | undefined,
    replayedSubmission: boolean,
  ) => {
    try {
      if (!pointResult || pointResult.status === "NOT_RECORDED") {
        setPointNotice("이전 제출에는 보상 내역이 기록되어 있지 않습니다.");
        return;
      }
      if (
        pointResult.status === "DISABLED" ||
        pointResult.status === "NOT_ELIGIBLE"
      ) {
        setPointNotice(
          pointResult.blockedMessage ||
            "이번 역사교실에 지급할 위스가 없습니다.",
        );
        return;
      }
      if (replayedSubmission || pointResult.status === "DUPLICATE") {
        setPointNotice(
          pointResult.blockedMessage ||
            "이번 역사교실 위스는 이미 반영되었습니다.",
        );
        return;
      }

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
          if (Number(pointResult.amount || 0) <= 0) {
            setPointNotice(
              `역사교실 성과 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`,
            );
            showToast({
              tone: "success",
              title: "역사교실 제출 완료",
              message: `성과 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`,
            });
            return;
          }

          setPointNotice(
            `역사교실 위스가 적립되었습니다. 기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스`,
          );
          showToast({
            tone: "success",
            title: "역사교실 제출 완료",
            message: `기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`,
          });
        } else {
          setPointNotice(
            `역사교실 위스가 적립되었습니다. +${totalAwarded}위스`,
          );
          showToast({
            tone: "success",
            title: "역사교실 제출 완료",
            message: `+${totalAwarded}위스가 반영되었습니다.`,
          });
        }
      } else if (pointResult.duplicate || pointResult.blockedMessage) {
        const duplicateNotice =
          pointResult.blockedMessage ||
          "이번 역사교실 위스는 이미 반영되었습니다.";
        setPointNotice(duplicateNotice);
        showToast({
          tone: "info",
          title: duplicateNotice,
        });
      } else {
        setPointNotice("");
      }
    } catch (pointError) {
      console.error(
        "Failed to display confirmed history classroom point reward:",
        pointError,
      );
      setPointNotice("역사교실 위스를 바로 반영하지 못했습니다.");
      showToast({
        tone: "warning",
        title: "제출 결과는 저장되었습니다.",
        message: "위스 반영 상태를 바로 확인하지 못했습니다.",
      });
    }
  };

  const markScreenRotationGrace = useCallback(() => {
    if (!assignment || !userData?.uid) return;
    const until = Date.now() + SCREEN_ROTATION_GRACE_MS;
    screenRotationGraceUntilRef.current = until;
    writeRotationGrace(assignment.id, userData.uid);
  }, [assignment, userData?.uid]);

  const isScreenRotationGraceActive = useCallback(() => {
    if (!assignment || !userData?.uid) return false;
    const storedUntil = readRotationGraceUntil(assignment.id, userData.uid);
    if (storedUntil > screenRotationGraceUntilRef.current) {
      screenRotationGraceUntilRef.current = storedUntil;
    }
    return screenRotationGraceUntilRef.current > Date.now();
  }, [assignment, userData?.uid]);

  const handleForcedCancel = async (
    reason: string,
    options: { redirectTo?: string | null; replace?: boolean } = {},
  ): Promise<boolean> => {
    if (
      !assignment ||
      !userData ||
      completedRef.current ||
      submittingRef.current ||
      cancellationInFlightRef.current
    ) {
      return false;
    }

    cancellationInFlightRef.current = true;
    try {
      const activeAttempt = canonicalAttemptRef.current;
      if (activeAttempt) {
        if (networkOfflineRef.current) {
          showToast({
            tone: "warning",
            title: "인터넷 연결을 확인해 주세요.",
            message:
              "답안을 저장한 뒤 나갈 수 있습니다. 연결 후 다시 시도해 주세요.",
          });
          return false;
        }
        const saved = await persistCanonicalProgress(true);
        if (!saved)
          throw new Error("Attempt changed before exit save completed.");
      }
      const redirectTo =
        "redirectTo" in options
          ? options.redirectTo
          : "/student/history-classroom";
      if (redirectTo) {
        exitNavigationAllowedRef.current = true;
        navigate(redirectTo, { replace: options.replace ?? true });
      }
      return true;
    } catch (saveError) {
      console.error("Failed to preserve recoverable attempt before exit", {
        reason,
        saveError,
      });
      showToast({
        tone: "warning",
        title: "답안 저장을 확인하지 못했습니다.",
        message: "현재 화면을 유지합니다. 잠시 후 나가기를 다시 눌러 주세요.",
      });
      return false;
    } finally {
      cancellationInFlightRef.current = false;
    }
  };

  const requestExit = useCallback(
    (reason: string, options: HistoryClassroomExitRequestOptions = {}) => {
      if (assignment && submittingRef.current) {
        return;
      }

      if (!assignment || completedRef.current) {
        if (options.mode === "reload") {
          window.location.reload();
          return;
        }
        if (options.mode === "back") {
          window.history.back();
          return;
        }
        navigate(options.redirectTo ?? "/student/history-classroom", {
          replace: options.replace,
        });
        return;
      }

      setPendingExitAction({
        ...options,
        reason,
        redirectTo:
          "redirectTo" in options
            ? options.redirectTo
            : "/student/history-classroom",
        mode: options.mode || "route",
      });
    },
    [assignment, navigate],
  );

  const cancelPendingExit = useCallback(() => {
    if (exitConfirmSubmitting) return;
    if (pendingExitAction?.mode === "back") {
      backGuardRearmRef.current?.();
    }
    setPendingExitAction(null);
  }, [exitConfirmSubmitting, pendingExitAction?.mode]);

  const confirmPendingExit = useCallback(async () => {
    if (!pendingExitAction || exitConfirmSubmitting) return;

    setExitConfirmSubmitting(true);
    const confirmedAction = pendingExitAction;
    const cancelled = await handleForcedCancel(confirmedAction.reason, {
      redirectTo:
        confirmedAction.mode === "back" || confirmedAction.mode === "reload"
          ? null
          : confirmedAction.redirectTo,
      replace: confirmedAction.replace,
    });

    if (!cancelled) {
      setExitConfirmSubmitting(false);
      return;
    }

    exitNavigationAllowedRef.current = true;
    if (confirmedAction.mode === "reload") {
      window.location.reload();
      return;
    }
    if (confirmedAction.mode === "back") {
      window.history.back();
      return;
    }
    setPendingExitAction(null);
    setExitConfirmSubmitting(false);
  }, [exitConfirmSubmitting, pendingExitAction]);

  useEffect(() => {
    if (!attemptStarted) return undefined;
    const persistAttemptProgress = () => {
      if (!assignment || !userData?.uid) return;
      writeLocalOnly(
        getAttemptProgressKey(assignment.id, userData.uid),
        JSON.stringify({
          deadlineMs: attemptDeadlineMsRef.current,
          currentPage,
          answers,
          savedAt: Date.now(),
        }),
      );
    };

    const markOffline = () => {
      networkOfflineRef.current = true;
      setIsNetworkOffline(true);
      if (networkOfflineStartedAtRef.current == null) {
        networkOfflineStartedAtRef.current = Date.now();
      }
      if (assignment && userData?.uid) {
        clearCooldownLock(assignment.id, userData.uid);
      }
      setResultText(
        "인터넷 연결이 끊겨 응시를 잠시 멈췄습니다. 연결이 돌아오면 계속 진행할 수 있습니다.",
      );
      persistAttemptProgress();
    };

    const markOnline = () => {
      const offlineStartedAt = networkOfflineStartedAtRef.current;
      networkOfflineRef.current = false;
      setIsNetworkOffline(false);
      networkOfflineStartedAtRef.current = null;

      if (offlineStartedAt && assignment?.timeLimitMinutes) {
        setRemainingSeconds(
          Math.max(
            0,
            Math.ceil(
              (attemptDeadlineMsRef.current -
                (Date.now() + serverTimeOffsetMsRef.current)) /
                1000,
            ),
          ),
        );
      }

      if (assignment && userData?.uid) {
        persistAttemptProgress();
      }

      setResultText((prev) =>
        prev.includes("인터넷 연결이 끊겨") ? "" : prev,
      );
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      markOffline();
    } else {
      markOnline();
    }

    window.addEventListener("offline", markOffline);
    window.addEventListener("online", markOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", markOnline);
    };
  }, [answers, assignment, attemptStarted, currentPage, userData?.uid]);

  useEffect(() => {
    if (!attemptStarted || !assignment || !userData?.uid || completed)
      return undefined;

    const getViewportState = () => {
      const width = Math.round(
        window.visualViewport?.width || window.innerWidth,
      );
      const height = Math.round(
        window.visualViewport?.height || window.innerHeight,
      );
      return {
        width,
        height,
        landscape: width > height,
      };
    };

    viewportOrientationRef.current = getViewportState();

    const handlePossibleRotation = () => {
      const previous = viewportOrientationRef.current;
      const next = getViewportState();
      viewportOrientationRef.current = next;
      if (!previous || previous.landscape !== next.landscape) {
        markScreenRotationGrace();
      }
    };

    window.addEventListener("orientationchange", markScreenRotationGrace);
    window.addEventListener("resize", handlePossibleRotation);
    window.visualViewport?.addEventListener("resize", handlePossibleRotation);
    window.screen.orientation?.addEventListener(
      "change",
      markScreenRotationGrace,
    );

    return () => {
      window.removeEventListener("orientationchange", markScreenRotationGrace);
      window.removeEventListener("resize", handlePossibleRotation);
      window.visualViewport?.removeEventListener(
        "resize",
        handlePossibleRotation,
      );
      window.screen.orientation?.removeEventListener(
        "change",
        markScreenRotationGrace,
      );
    };
  }, [
    assignment,
    attemptStarted,
    completed,
    markScreenRotationGrace,
    userData?.uid,
  ]);

  useEffect(() => {
    if (
      !attemptStarted ||
      !assignment ||
      !userData?.uid ||
      completed ||
      submitting
    ) {
      return undefined;
    }

    const persistAttemptProgress = () => {
      writeLocalOnly(
        getAttemptProgressKey(assignment.id, userData.uid),
        JSON.stringify({
          deadlineMs: attemptDeadlineMsRef.current,
          currentPage,
          answers,
          savedAt: Date.now(),
        }),
      );
    };

    persistAttemptProgress();
    return persistAttemptProgress;
  }, [
    answers,
    assignment,
    attemptStarted,
    completed,
    currentPage,
    submitting,
    userData?.uid,
  ]);

  useEffect(() => {
    if (
      !attemptStarted ||
      !canonicalAttempt ||
      completed ||
      submitting ||
      isNetworkOffline
    ) {
      return undefined;
    }
    const timerId = window.setTimeout(() => {
      if (
        submittingRef.current ||
        completedRef.current ||
        networkOfflineRef.current
      )
        return;
      void persistCanonicalProgress().catch((saveError) => {
        console.error("Failed to save History Classroom progress", saveError);
        setResultText(
          "답안을 서버에 저장하지 못했습니다. 연결을 확인한 뒤 다시 입력해 주세요.",
        );
      });
    }, 900);
    return () => window.clearTimeout(timerId);
  }, [
    answers,
    attemptStarted,
    canonicalAttempt?.attemptId,
    completed,
    currentPage,
    isNetworkOffline,
    submitting,
  ]);

  const finalizeExpiredAttempt = async (
    reason: "time-limit" | "due-window",
  ) => {
    if (
      !assignment ||
      !userData ||
      completed ||
      submitting ||
      autoSubmitHandledRef.current
    ) {
      return;
    }

    autoSubmitHandledRef.current = true;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await saveResult({ submitReason: "TIMEOUT" });
      setCompleted(true);
      completedRef.current = true;
      if (!result) return;

      if (!resultSummaryShownRef.current) {
        resultSummaryShownRef.current = true;
        setResultSummary(
          buildHistoryClassroomResultSummary(
            assignment,
            answers,
            result.passed,
            result.percent,
          ),
        );
        setResultDialogOpen(true);
      }
      setResultText("");
      submittingRef.current = false;
      setSubmitting(false);
      applyHistoryClassroomPointReward(
        result.reward,
        result.replayedSubmission,
      );
    } catch (submitError) {
      console.error(submitError);
      setResultText(
        reason === "due-window"
          ? "응시 기간 경과 자동 제출 처리에 실패했습니다."
          : "시간 초과 제출 처리에 실패했습니다.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!attemptStarted || !assignment || completed || submitting)
      return undefined;

    const guardState =
      window.history.state && typeof window.history.state === "object"
        ? { ...window.history.state, westoryHistoryClassroomGuard: true }
        : { westoryHistoryClassroomGuard: true };
    let disposed = false;

    const armBackGuard = () => {
      if (disposed || exitNavigationAllowedRef.current) return;
      window.history.pushState(guardState, "", window.location.href);
    };

    backGuardRearmRef.current = armBackGuard;
    armBackGuard();

    const handlePopState = () => {
      if (exitNavigationAllowedRef.current) return;
      if (submittingRef.current || completedRef.current) return;
      requestExit("browser-back", { mode: "back", redirectTo: null });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      disposed = true;
      backGuardRearmRef.current = null;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [assignment, attemptStarted, completed, requestExit, submitting]);

  useEffect(() => {
    if (!attemptStarted || !assignment || completed || submitting)
      return undefined;

    const getNavigationRoute = (anchor: HTMLAnchorElement) => {
      const rawHref = anchor.getAttribute("href") || "";
      if (!rawHref || rawHref.startsWith("javascript:")) return null;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return null;

      const hashRoute = url.hash.startsWith("#/") ? url.hash.slice(1) : null;
      const route = hashRoute || `${url.pathname}${url.search}${url.hash}`;
      const currentRoute = window.location.hash.startsWith("#/")
        ? window.location.hash.slice(1)
        : `${window.location.pathname}${window.location.search}${window.location.hash}`;

      return route === currentRoute ? null : route;
    };

    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }

      const route = getNavigationRoute(anchor);
      if (!route) return;
      if (submittingRef.current || completedRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      requestExit("link-navigation", { redirectTo: route });
    };

    document.addEventListener("click", handleLinkClick, true);
    return () => document.removeEventListener("click", handleLinkClick, true);
  }, [assignment, attemptStarted, completed, requestExit, submitting]);

  useEffect(() => {
    if (!attemptStarted || !assignment || completed || submitting)
      return undefined;

    const handleRefreshShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isRefreshShortcut =
        key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
      if (!isRefreshShortcut) return;
      if (submittingRef.current || completedRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestExit("refresh-shortcut", { mode: "reload", redirectTo: null });
    };

    window.addEventListener("keydown", handleRefreshShortcut, true);
    document.addEventListener("keydown", handleRefreshShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleRefreshShortcut, true);
      document.removeEventListener("keydown", handleRefreshShortcut, true);
    };
  }, [assignment, attemptStarted, completed, requestExit, submitting]);

  useEffect(() => {
    if (!attemptStarted || !assignment || completed) return undefined;

    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (submittingRef.current || completedRef.current) return;
      writeLocalOnly(
        getAttemptProgressKey(assignment.id, userData?.uid || "unknown"),
        JSON.stringify({
          deadlineMs: attemptDeadlineMsRef.current,
          currentPage,
          answers,
          savedAt: Date.now(),
        }),
      );
    };
    const handleBeforeUnload = () => {
      if (!assignment || !userData?.uid) return;
      if (submittingRef.current || completedRef.current) return;
      writeLocalOnly(
        getAttemptProgressKey(assignment.id, userData.uid),
        JSON.stringify({
          deadlineMs: attemptDeadlineMsRef.current,
          currentPage,
          answers,
          savedAt: Date.now(),
        }),
      );
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    answers,
    assignment,
    attemptStarted,
    completed,
    currentPage,
    submitting,
    userData,
  ]);

  useEffect(() => {
    if (
      !attemptStarted ||
      !assignment?.timeLimitMinutes ||
      completed ||
      submitting ||
      isNetworkOffline
    ) {
      return undefined;
    }

    if (!attemptDeadlineMsRef.current) {
      setResultText(
        "서버 종료 시각을 확인하지 못했습니다. 응시를 다시 불러와 주세요.",
      );
      return undefined;
    }

    const updateRemainingTime = () => {
      const nextRemainingSeconds = Math.max(
        0,
        Math.ceil(
          (attemptDeadlineMsRef.current -
            (Date.now() + serverTimeOffsetMsRef.current)) /
            1000,
        ),
      );
      setRemainingSeconds(nextRemainingSeconds);
      if (nextRemainingSeconds <= 0) {
        void finalizeExpiredAttempt("time-limit");
      }
    };

    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 1000);

    return () => window.clearInterval(timerId);
  }, [
    assignment?.timeLimitMinutes,
    attemptStarted,
    completed,
    isNetworkOffline,
    submitting,
  ]);

  useEffect(() => {
    if (
      !attemptStarted ||
      !assignment ||
      completed ||
      submitting ||
      isNetworkOffline
    ) {
      return undefined;
    }

    const nextRemainingMs = getHistoryClassroomRemainingMs(
      assignment,
      Date.now() + serverTimeOffsetMsRef.current,
    );
    if (nextRemainingMs == null) {
      setRemainingDueMs(null);
      return undefined;
    }

    const updateDueWindow = () => {
      const remainMs =
        getHistoryClassroomRemainingMs(
          assignment,
          Date.now() + serverTimeOffsetMsRef.current,
        ) ?? 0;
      setRemainingDueMs(remainMs);
      if (remainMs <= 0) {
        void finalizeExpiredAttempt("due-window");
      }
    };

    updateDueWindow();
    const timerId = window.setInterval(updateDueWindow, 1000);
    return () => window.clearInterval(timerId);
  }, [assignment, attemptStarted, completed, isNetworkOffline, submitting]);

  const totalTimeSeconds = assignment?.timeLimitMinutes
    ? assignment.timeLimitMinutes * 60
    : 0;
  const timeProgressPercent =
    totalTimeSeconds > 0 && remainingSeconds != null
      ? Math.max(0, Math.min(100, (remainingSeconds / totalTimeSeconds) * 100))
      : 100;
  const countdownLabel =
    remainingSeconds == null
      ? null
      : `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(
          remainingSeconds % 60,
        ).padStart(2, "0")}`;
  const showLowTimeWarning =
    remainingSeconds != null &&
    remainingSeconds > 0 &&
    remainingSeconds <= 60 &&
    !completed &&
    !submitting;

  const dueStatus = useMemo(() => {
    if (remainingDueMs == null) {
      return { label: null, tone: "slate" as const };
    }
    if (remainingDueMs <= 0) {
      return { label: "응시 기간 마감", tone: "rose" as const };
    }
    return {
      label: `응시 마감까지 ${formatRemainingDuration(remainingDueMs)}`,
      tone: "amber" as const,
    };
  }, [remainingDueMs]);

  const handleAnswerChange = (blankId: string, value: string) => {
    if (completed || submitting) return;
    emitSessionActivity();
    setAnswers((prev) => ({ ...prev, [blankId]: value }));
  };

  const handleCurrentPageChange = (page: number) => {
    emitSessionActivity();
    setCurrentPage(page);
  };

  const submitAnswers = async () => {
    if (!assignment || !userData) return;
    if (completedRef.current || submittingRef.current) return;
    if (networkOfflineRef.current) {
      setPendingSubmitAfterOnline(true);
      setResultText(
        "인터넷 연결이 끊겨 제출을 잠시 멈췄습니다. 연결이 돌아오면 자동으로 제출합니다.",
      );
      return;
    }

    emitSessionActivity();
    setPendingExitAction(null);
    setExitConfirmSubmitting(false);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await saveResult({ submitReason: "STUDENT" });
      setCompleted(true);
      completedRef.current = true;
      if (!result) return;

      if (!resultSummaryShownRef.current) {
        resultSummaryShownRef.current = true;
        setResultSummary(
          buildHistoryClassroomResultSummary(
            assignment,
            answers,
            result.passed,
            result.percent,
          ),
        );
        setResultDialogOpen(true);
      }
      setPendingSubmitAfterOnline(false);
      setResultText("");
      submittingRef.current = false;
      setSubmitting(false);
      applyHistoryClassroomPointReward(
        result.reward,
        result.replayedSubmission,
      );
    } catch (submitError) {
      console.error(submitError);
      if (networkOfflineRef.current) {
        setPendingSubmitAfterOnline(true);
        setResultText(
          "인터넷 연결이 끊겨 제출을 잠시 멈췄습니다. 연결이 돌아오면 자동으로 제출합니다.",
        );
      } else {
        setResultText(
          "제출에 실패했습니다. 답안은 화면에 남아 있으니 다시 제출해 주세요.",
        );
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      isNetworkOffline ||
      !pendingSubmitAfterOnline ||
      !assignment ||
      !userData ||
      completed ||
      submitting
    ) {
      return;
    }

    void submitAnswers();
  }, [
    assignment,
    completed,
    isNetworkOffline,
    pendingSubmitAfterOnline,
    submitting,
    userData,
  ]);

  if (loading) {
    return <PageLoading message="역사교실을 준비하는 중입니다." />;
  }

  if (error || !assignment) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-3xl border border-red-200 bg-white p-8 text-center text-red-600">
          {error || "과제를 불러오지 못했습니다."}
        </div>
      </div>
    );
  }

  if (legacySource) {
    return (
      <>
        <HistoryClassroomAssignmentView
          assignment={assignment}
          currentPage={currentPage}
          onCurrentPageChange={setCurrentPage}
          answers={{}}
          readOnly
          completed
          helperItems={[
            "이전 구조의 자료를 확인하는 화면입니다.",
            "답안 입력과 제출은 지원하지 않습니다.",
          ]}
        />
        {legacyNoticeOpen && (
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
            data-state="LEGACY"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-classroom-legacy-title"
            aria-describedby="history-classroom-legacy-description"
          >
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
              <div className="px-5 py-5 sm:px-6">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">
                  이전 자료 · 읽기 전용
                </div>
                <h2
                  id="history-classroom-legacy-title"
                  className="mt-2 text-xl font-black text-slate-900"
                >
                  {assignment.title || "이전 역사교실 자료"}
                </h2>
                <p
                  id="history-classroom-legacy-description"
                  className="mt-3 text-sm leading-6 text-slate-600"
                >
                  이 자료는 이전 저장 구조에서 확인되었습니다. 새 응시 기록은
                  만들지 않으며 읽기 전용으로만 안내합니다.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={() => navigate("/student/history-classroom")}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  목록으로 돌아가기
                </button>
                <button
                  type="button"
                  onClick={() => setLegacyNoticeOpen(false)}
                  className="rounded-xl border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  읽기 전용으로 보기
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (!attemptStarted && !completed) {
    const hasRecoverableAttempt = Boolean(
      canonicalAttempt &&
      ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(
        canonicalAttempt.status,
      ),
    );
    return (
      <>
        <HistoryClassroomAssignmentView
          assignment={assignment}
          currentPage={currentPage}
          onCurrentPageChange={handleCurrentPageChange}
          answers={answers}
          interactiveViewport
          answerChecks={resultSummary?.answerChecks || []}
          onAnswerChange={handleAnswerChange}
          onSubmit={() => void submitAnswers()}
          submitting={submitting || pendingSubmitAfterOnline}
          completed={completed}
          resultText={resultSummary ? "" : resultText}
          pointNotice={pointNotice}
          countdownLabel={countdownLabel}
          timeProgressPercent={timeProgressPercent}
          dueStatusLabel={dueStatus.label}
          dueStatusTone={dueStatus.tone}
        />
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-classroom-start-title"
          aria-describedby="history-classroom-start-description"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
            <div className="px-5 py-5 sm:px-6">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">
                {hasRecoverableAttempt ? "응시 복구" : "응시 준비"}
              </div>
              <h2
                id="history-classroom-start-title"
                className="mt-2 text-xl font-black text-slate-900"
              >
                {assignment.title || "역사교실 응시"}
              </h2>
              <p
                id="history-classroom-start-description"
                className="mt-3 text-sm leading-6 text-slate-600"
              >
                {hasRecoverableAttempt
                  ? "서버에 저장된 답안과 종료 시각이 있습니다. 이어하기를 누르면 같은 응시를 계속합니다."
                  : "응시를 시작하기 전까지 답안이나 응시 기록은 만들어지지 않습니다. 제한 시간과 제출 기준을 확인해 주세요."}
              </p>
              {resultText && (
                <p
                  className="mt-3 text-sm font-semibold leading-6 text-rose-700"
                  role="alert"
                >
                  {resultText}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={() => navigate("/student/history-classroom")}
                disabled={startingAttempt}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                목록으로 돌아가기
              </button>
              <button
                type="button"
                onClick={() => void beginOrResumeAttempt()}
                disabled={startingAttempt}
                className="rounded-xl border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startingAttempt
                  ? "응시 상태 확인 중"
                  : hasRecoverableAttempt
                    ? "저장된 응시 이어하기"
                    : "역사교실 시작하기"}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <HistoryClassroomAssignmentView
        assignment={assignment}
        currentPage={currentPage}
        onCurrentPageChange={handleCurrentPageChange}
        answers={answers}
        interactiveViewport
        answerChecks={resultSummary?.answerChecks || []}
        onAnswerChange={handleAnswerChange}
        onSubmit={() => void submitAnswers()}
        submitting={submitting || pendingSubmitAfterOnline}
        completed={completed}
        resultText={resultSummary ? "" : resultText}
        pointNotice={pointNotice}
        countdownLabel={countdownLabel}
        timeProgressPercent={timeProgressPercent}
        dueStatusLabel={dueStatus.label}
        dueStatusTone={dueStatus.tone}
      />
      {showLowTimeWarning && (
        <div
          className="pointer-events-none fixed left-1/2 top-4 z-[130] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-rose-200 bg-white/95 px-4 py-3 text-center text-sm font-black text-rose-700 shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
        >
          남은 시간이 1분 이내입니다. 작성 중인 답을 확인하고 빨리 제출해
          주세요.
        </div>
      )}
      {isNetworkOffline && (
        <div
          className="pointer-events-none fixed left-1/2 top-4 z-[135] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-amber-200 bg-white/95 px-4 py-3 text-center text-sm font-black text-amber-800 shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
        >
          인터넷 연결이 끊겨 응시 시간이 잠시 멈췄습니다. 연결이 돌아오면 이어서
          진행합니다.
        </div>
      )}
      {pendingExitAction && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-classroom-exit-title"
          aria-describedby="history-classroom-exit-description"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
            <div className="px-5 py-5 sm:px-6">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-rose-500">
                응시 중 이탈 확인
              </div>
              <h2
                id="history-classroom-exit-title"
                className="mt-2 text-xl font-black text-slate-900"
              >
                역사교실을 나가시겠습니까?
              </h2>
              <p
                id="history-classroom-exit-description"
                className="mt-3 text-sm leading-6 text-slate-600"
              >
                답안을 저장한 뒤 나갑니다. 응시 종료 시각은 그대로 유지됩니다.
                계속 풀려면 취소를 눌러 주세요.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={cancelPendingExit}
                disabled={exitConfirmSubmitting}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmPendingExit()}
                disabled={exitConfirmSubmitting}
                className="rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exitConfirmSubmitting ? "처리 중..." : "나가기"}
              </button>
            </div>
          </div>
        </div>
      )}
      {resultSummary && resultDialogOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-classroom-result-title"
          onClick={() => {
            setResultDialogOpen(false);
            setResultText("");
          }}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-500">
                    제출 결과
                  </div>
                  <h2
                    id="history-classroom-result-title"
                    className="mt-1 text-2xl font-black text-slate-900"
                  >
                    {resultSummary.passed ? "통과" : "미통과"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    전체 {resultSummary.total}문제 중 정답{" "}
                    {resultSummary.correctCount}개, 오답{" "}
                    {resultSummary.wrongCount}개, 달성 비율{" "}
                    {resultSummary.percent}%입니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResultDialogOpen(false);
                    setResultText("");
                  }}
                  className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold text-slate-500">
                    전체 문제 수
                  </div>
                  <div className="mt-1 text-2xl font-black text-slate-900">
                    {resultSummary.total}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-xs font-bold text-emerald-700">
                    맞은 개수
                  </div>
                  <div className="mt-1 text-2xl font-black text-emerald-700">
                    {resultSummary.correctCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <div className="text-xs font-bold text-rose-700">
                    틀린 개수
                  </div>
                  <div className="mt-1 text-2xl font-black text-rose-700">
                    {resultSummary.wrongCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="text-xs font-bold text-blue-700">
                    통과 여부
                  </div>
                  <div className="mt-1 text-lg font-black text-blue-700">
                    {resultSummary.passed ? "통과" : "미통과"}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-xs font-bold text-amber-700">
                    통과 기준
                  </div>
                  <div className="mt-1 text-lg font-black text-amber-800">
                    {resultSummary.passThresholdPercent}% 이상
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold text-slate-500">
                    달성 비율
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    {resultSummary.percent}%
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
                  <div className="text-sm font-bold text-slate-900">
                    틀린 문항
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    학생 입력값과 정답을 함께 확인하세요.
                  </div>
                </div>
                <div className="max-h-[min(42vh,24rem)] overflow-y-auto p-4 sm:p-5">
                  {resultSummary.wrongItems.length > 0 ? (
                    <div className="space-y-3">
                      {resultSummary.wrongItems.map((item) => (
                        <div
                          key={item.blankId}
                          className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-bold text-rose-800">
                              문항 {item.blankNumber}
                            </div>
                            <div className="text-xs font-semibold text-slate-500">
                              {item.blankId}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <div className="text-xs font-bold text-slate-500">
                                학생 입력값
                              </div>
                              <div className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                                {item.studentAnswer || "입력 없음"}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-500">
                                정답
                              </div>
                              <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                                {item.correctAnswer || "정답 없음"}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center text-sm font-bold text-emerald-700">
                      틀린 문항이 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setResultDialogOpen(false);
                  setResultText("");
                }}
                className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryClassroomRunner;
