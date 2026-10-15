import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppToast } from "../../../components/common/AppToastProvider";
import HistoryClassroomAssignmentView from "../../../components/common/HistoryClassroomAssignmentView";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import { db } from "../../../lib/firebase";
import {
  buildAssessmentDefinitionId,
  getAssessmentState,
  saveAssessmentProgress,
  startAssessmentAttempt,
  submitAssessmentAttempt,
  lockHistoryClassroomAttempt,
  isAssessmentRevisionConflict,
  type AssessmentAttemptState,
  type AssessmentSubmissionResult,
} from "../../../lib/assessmentLifecycle";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomStudentRetryResetMs,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  summarizeHistoryClassroomAnswers,
  type HistoryClassroomAnswerCheck,
  type HistoryClassroomAssignment,
} from "../../../lib/historyClassroom";
import { normalizeMapResource } from "../../../lib/mapResources";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";

import {
  readLocalOnly,
  removeStorage,
  writeLocalOnly,
} from "../../../lib/safeStorage";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import {
  getYearSemester,
  getSemesterDocPath,
} from "../../../lib/semesterScope";

import {
  HISTORY_CLASSROOM_HINT_LIMIT,
  getHistoryClassroomRetryDelay,
  isHistoryClassroomTransientSaveError,
  normalizeHistoryClassroomHintUseCount,
  readHistoryClassroomPendingSubmission,
  type HistoryClassroomPendingSubmission,
  type HistoryClassroomSubmissionReason,
} from "../../../lib/historyClassroomAttemptRecovery";

const HISTORY_CLASSROOM_LOCK_PREFIX = "westoryHistoryClassroomLock";
const HISTORY_CLASSROOM_ATTEMPT_PREFIX = "westoryHistoryClassroomAttempt";
const HISTORY_CLASSROOM_ROTATION_PREFIX = "westoryHistoryClassroomRotation";
const SCREEN_ROTATION_GRACE_MS = 8000;
const VISIBILITY_CANCEL_DELAY_MS = 3000;

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

const writeCooldownLock = (
  assignmentId: string,
  uid: string,
  blockedUntil: number,
  reason: string,
) => {
  writeLocalOnly(
    getCooldownLockKey(assignmentId, uid),
    JSON.stringify({
      blockedUntil,
      reason,
      savedAt: Date.now(),
    }),
  );
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

const buildHistoryClassroomResultSummary = (
  assignment: HistoryClassroomAssignment,
  result: {
    total: number;
    score: number;
    passed: boolean;
    percent: number;
    answerChecks: HistoryClassroomAnswerCheck[];
    passThresholdPercent?: number;
  },
): HistoryClassroomResultModalSummary => ({
  total: result.total,
  correctCount: result.score,
  wrongCount: Math.max(0, result.total - result.score),
  percent: result.percent,
  passed: result.passed,
  passThresholdPercent: Number.isFinite(result.passThresholdPercent)
    ? Number(result.passThresholdPercent)
    : assignment.passThresholdPercent,
  answerChecks: result.answerChecks,
  wrongItems: result.answerChecks
    .filter((check) => !check.correct)
    .map((check) => ({
      blankId: check.blankId,
      blankNumber: check.blankNumber,
      studentAnswer: check.studentAnswer,
      correctAnswer: check.correctAnswer,
    })),
});

const HistoryClassroomRunner: React.FC = () => {
  const { showToast } = useAppToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userData, config } = useAuth();
  const assignmentId = searchParams.get("id") || "";

  const [assignment, setAssignment] =
    useState<HistoryClassroomAssignment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hintUseCount, setHintUseCount] = useState(0);
  const hintUseCountRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [assignmentReloadRevision, setAssignmentReloadRevision] = useState(0);
  const assignmentReadPathRef = useRef("");
  const loadedRetryResetAtRef = useRef(0);
  const [resultText, setResultText] = useState("");
  const [resultSummary, setResultSummary] =
    useState<HistoryClassroomResultModalSummary | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const resultDialogRef = useRef<HTMLDivElement | null>(null);
  const exitDialogRef = useRef<HTMLDivElement | null>(null);
  const [violationReason, setViolationReason] = useState<
    "VISIBILITY_HIDDEN" | "NAVIGATION" | null
  >(null);
  const violationRef = useRef<typeof violationReason>(null);
  const [violationSaved, setViolationSaved] = useState(false);
  const [violationRetry, setViolationRetry] = useState(0);
  const hiddenStartedAtRef = useRef(0);
  const [pendingExitAction, setPendingExitAction] =
    useState<HistoryClassroomExitAction | null>(null);
  const [exitConfirmSubmitting, setExitConfirmSubmitting] = useState(false);
  const [isNetworkOffline, setIsNetworkOffline] = useState(() =>
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  const [pendingSubmitAfterOnline, setPendingSubmitAfterOnline] =
    useState(false);
  const [nextSubmitRetryAt, setNextSubmitRetryAt] = useState<number | null>(
    null,
  );
  const pendingSubmissionRef = useRef<HistoryClassroomPendingSubmission | null>(
    null,
  );
  const attemptResultIdRef = useRef("");
  const retryFailureCountRef = useRef(0);
  const answersRef = useRef(answers);
  const currentPageRef = useRef(currentPage);
  const assignmentRef = useRef(assignment);
  answersRef.current = answers;
  currentPageRef.current = currentPage;
  assignmentRef.current = assignment;
  const [pointNotice, setPointNotice] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [remainingDueMs, setRemainingDueMs] = useState<number | null>(null);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [startingAttempt, setStartingAttempt] = useState(false);
  const [progressRetry, setProgressRetry] = useState(0);
  const canonicalAttemptRef = useRef<AssessmentAttemptState | null>(null);
  const confirmedSubmissionRef = useRef<AssessmentSubmissionResult | null>(
    null,
  );
  const serverTimeOffsetMsRef = useRef(0);
  const progressSaveTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingProgressRef = useRef<
    Parameters<typeof saveAssessmentProgress>[0] | null
  >(null);
  const cancellationInFlightRef = useRef(false);
  const exitNavigationAllowedRef = useRef(false);
  const backGuardRearmRef = useRef<(() => void) | null>(null);
  const autoSubmitHandledRef = useRef(false);
  const resultSummaryShownRef = useRef(false);
  const completedRef = useRef(false);
  const submittingRef = useRef(false);
  const attemptDeadlineMsRef = useRef(0);
  const visibilityCancelTimerRef = useRef<number | null>(null);
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

  const persistAttemptProgress = useCallback(
    (source = assignmentRef.current) => {
      if (!source || !userData?.uid || completedRef.current) return;
      writeLocalOnly(
        getAttemptProgressKey(source.id, userData.uid),
        JSON.stringify({
          ...getYearSemester(config),
          resultId: attemptResultIdRef.current,
          attemptId: canonicalAttemptRef.current?.attemptId || "",
          retryResetAtMs: loadedRetryResetAtRef.current,
          deadlineMs: attemptDeadlineMsRef.current,
          offlineStartedAt: networkOfflineStartedAtRef.current,
          currentPage: currentPageRef.current,
          answers: answersRef.current,
          hintUseCount: hintUseCountRef.current,
          pendingSubmission: pendingSubmissionRef.current,
          pendingViolation: violationRef.current,
          pendingProgress: pendingProgressRef.current,
          savedAt: Date.now(),
        }),
      );
    },
    [config, userData?.uid],
  );

  useEffect(() => {
    const loadAssignment = async () => {
      if (!assignmentId || !userData?.uid) return;
      setLoading(true);
      setError("");
      setAssignment(null);
      setAttemptStarted(false);
      canonicalAttemptRef.current = null;
      pendingProgressRef.current = null;
      setPendingSubmitAfterOnline(false);
      setNextSubmitRetryAt(null);
      violationRef.current = null;
      setViolationReason(null);
      setViolationSaved(false);

      try {
        const scope = getYearSemester(config);
        const definitionId = buildAssessmentDefinitionId(
          `${scope.year}-${scope.semester}`,
          "HISTORY_CLASSROOM",
          assignmentId,
        );
        const state = await getAssessmentState({ definitionId });
        if (!state.definition)
          throw new Error("현재 응시할 수 없는 역사교실입니다.");
        if (!["READY", "RECOVERABLE", "SUBMITTED"].includes(state.status)) {
          throw new Error(
            state.status === "PERMISSION"
              ? "이 과제는 현재 계정에 배정되지 않았습니다."
              : "현재 응시할 수 없는 역사교실입니다.",
          );
        }
        assignmentReadPathRef.current = getSemesterDocPath(
          config,
          "history_classrooms",
          assignmentId,
        );
        const snap = await getDoc(doc(db, assignmentReadPathRef.current));
        if (!snap.exists())
          throw new Error("역사교실 자료를 찾을 수 없습니다.");
        let loaded = normalizeHistoryClassroomAssignment(snap.id, snap.data());
        if (
          loaded.sourceType !== "lesson" &&
          loaded.mapResourceId &&
          (!(loaded.pdfPageImages?.length || 0) ||
            !(loaded.pdfRegions?.length || 0))
        ) {
          let mapSnap = await getDoc(
            doc(
              db,
              getSemesterDocPath(config, "map_resources", loaded.mapResourceId),
            ),
          );
          if (!mapSnap.exists())
            mapSnap = await getDoc(
              doc(db, `map_resources/${loaded.mapResourceId}`),
            );
          if (mapSnap.exists())
            loaded = mergeHistoryClassroomMapSnapshot(
              loaded,
              normalizeMapResource(mapSnap.id, mapSnap.data()),
            );
        }
        if (isHistoryClassroomDeleted(loaded) || !loaded.isPublished)
          throw new Error("현재 공개된 과제가 아닙니다.");
        if (
          !getHistoryClassroomAssignedStudentUids(loaded).includes(userData.uid)
        )
          throw new Error("이 과제는 현재 계정에 배정되지 않았습니다.");
        loadedRetryResetAtRef.current =
          getHistoryClassroomStudentRetryResetMs(loaded, userData.uid) || 0;
        if (state.attempt?.status === "LOCKED")
          throw new Error(
            "응시 화면 이탈로 재응시가 제한되었습니다. 선생님께 확인해 주세요.",
          );
        if (state.attempt?.status === "SUBMITTED") {
          const saved = await getDoc(doc(db, state.attempt.resultRef));
          const result = saved.data();
          if (
            !result ||
            result.studentUid !== userData.uid ||
            result.attemptId !== state.attempt.attemptId ||
            result.semesterId !== `${scope.year}-${scope.semester}`
          )
            throw new Error("제출 결과를 확인할 수 없습니다.");
          const previous = {
            ...result,
            attemptId: state.attempt.attemptId,
            revision: state.attempt.revision,
            status: "SUBMITTED",
            resultRef: state.attempt.resultRef,
            replayedSubmission: true,
          } as AssessmentSubmissionResult;
          const localReceipt = readJsonObject(
            readLocalOnly(getAttemptProgressKey(assignmentId, userData.uid)),
          );
          if (
            (previous.passed ??
              previous.percent >= loaded.passThresholdPercent) ||
            (localReceipt?.attemptId === previous.attemptId &&
              readHistoryClassroomPendingSubmission(
                localReceipt.pendingSubmission,
              ))
          ) {
            canonicalAttemptRef.current = state.attempt;
            confirmedSubmissionRef.current = previous;
            const checks = summarizeHistoryClassroomAnswers(
              loaded,
              state.attempt.answers,
            ).checks.map((check) => ({
              ...check,
              correct:
                previous.answerChecks.find((item) => item.id === check.blankId)
                  ?.correct === true,
            }));
            setAssignment(loaded);
            setAnswers(state.attempt.answers);
            setCompleted(true);
            completedRef.current = true;
            setResultSummary(
              buildHistoryClassroomResultSummary(loaded, {
                ...previous,
                passed:
                  previous.passed ??
                  previous.percent >= loaded.passThresholdPercent,
                answerChecks: checks,
              }),
            );
            setResultDialogOpen(true);
            resultSummaryShownRef.current = true;
            clearAttemptProgress(assignmentId, userData.uid);
            applyHistoryClassroomPointReward(
              previous.attemptId,
              previous.percent,
            );
            return;
          }
        }
        if (isHistoryClassroomPastDue(loaded) && !state.attempt)
          throw new Error("응시 기간이 마감된 역사교실입니다.");
        if (!state.attempt || state.attempt.status === "SUBMITTED") {
          canonicalAttemptRef.current = null;
          confirmedSubmissionRef.current = null;
          pendingSubmissionRef.current = null;
          setAssignment(loaded);
          setAnswers({});
          setCurrentPage(loaded.pdfPageImages?.[0]?.page || 1);
          setAttemptStarted(false);
          setCompleted(false);
          completedRef.current = false;
          setRemainingSeconds(null);
          setRemainingDueMs(getHistoryClassroomRemainingMs(loaded));
          return;
        }
        const latest = state;
        const attempt = latest.attempt;
        if (
          !attempt ||
          !["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(attempt.status)
        ) {
          throw new Error(
            "응시 상태가 바뀌었습니다. 목록에서 다시 열어 주세요.",
          );
        }
        canonicalAttemptRef.current = attempt;
        setAttemptStarted(true);
        clearCooldownLock(assignmentId, userData.uid);
        confirmedSubmissionRef.current = null;
        serverTimeOffsetMsRef.current =
          Date.parse(latest.serverNowIso) - Date.now();
        const stored = readJsonObject(
          readLocalOnly(getAttemptProgressKey(assignmentId, userData.uid)),
        );
        if (
          stored?.attemptId === attempt.attemptId &&
          stored.year === scope.year &&
          stored.semester === scope.semester &&
          (stored.pendingViolation === "VISIBILITY_HIDDEN" ||
            stored.pendingViolation === "NAVIGATION")
        ) {
          violationRef.current = stored.pendingViolation;
          setViolationReason(stored.pendingViolation);
        }
        // Local recovery belongs to this server attempt only; old attempts and
        // another semester never extend its deadline or replace its identity.
        const saved =
          stored?.attemptId === attempt.attemptId &&
          stored.year === scope.year &&
          stored.semester === scope.semester &&
          (stored.offlineStartedAt ||
            stored.pendingSubmission ||
            stored.pendingProgress ||
            Number(stored.savedAt) + serverTimeOffsetMsRef.current >=
              Date.parse(attempt.lastSavedAtIso))
            ? stored
            : null;
        const pendingProgress = saved?.pendingProgress as
          | Parameters<typeof saveAssessmentProgress>[0]
          | null;
        if (
          pendingProgress?.attemptId === attempt.attemptId &&
          pendingProgress.answers &&
          Number.isInteger(pendingProgress.expectedRevision)
        )
          pendingProgressRef.current = pendingProgress;
        const queued = readHistoryClassroomPendingSubmission(
          saved?.pendingSubmission,
        );
        const pendingSubmission =
          queued?.status === "cancelled" ? null : queued;
        const savedAnswers =
          saved?.answers && typeof saved.answers === "object"
            ? Object.fromEntries(
                Object.entries(saved.answers).map(([key, value]) => [
                  key,
                  String(value ?? ""),
                ]),
              )
            : attempt.answers;
        hintUseCountRef.current = normalizeHistoryClassroomHintUseCount(
          saved?.hintUseCount,
        );
        setHintUseCount(hintUseCountRef.current);
        const savedPage =
          Number(saved?.currentPage || attempt.currentItemId) ||
          loaded.pdfPageImages?.[0]?.page ||
          1;
        attemptResultIdRef.current = attempt.attemptId;
        pendingSubmissionRef.current = pendingSubmission;
        answersRef.current = pendingSubmission?.answers || savedAnswers;
        currentPageRef.current = savedPage;
        attemptDeadlineMsRef.current = Date.parse(attempt.deadlineAtIso);
        completedRef.current = false;
        setAssignment(loaded);
        setCurrentPage(savedPage);
        setAnswers(answersRef.current);
        setCompleted(false);
        submittingRef.current = false;
        setResultText("");
        setResultSummary(null);
        setResultDialogOpen(false);
        setPendingExitAction(null);
        setExitConfirmSubmitting(false);
        setPendingSubmitAfterOnline(!!pendingSubmission);
        setNextSubmitRetryAt(pendingSubmission ? Date.now() : null);
        resultSummaryShownRef.current = false;
        setPointNotice("");
        setRemainingSeconds(
          Math.max(
            0,
            Math.ceil(
              (attemptDeadlineMsRef.current - Date.parse(latest.serverNowIso)) /
                1000,
            ),
          ),
        );
        setRemainingDueMs(
          getHistoryClassroomRemainingMs(
            loaded,
            Date.parse(latest.serverNowIso),
          ),
        );
        cancellationInFlightRef.current = false;
        exitNavigationAllowedRef.current = false;
        autoSubmitHandledRef.current = !!pendingSubmission;
        screenRotationGraceUntilRef.current = 0;
        persistAttemptProgress(loaded);
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
  }, [assignmentId, config, userData?.uid, assignmentReloadRevision]);

  useEffect(() => {
    // A teacher's reset unlocks an already open error screen. Active attempts
    // deliberately keep their answers and timer until the student re-enters.
    if (!error || loading || !assignmentReadPathRef.current || !userData?.uid)
      return;
    return onSnapshot(
      doc(db, assignmentReadPathRef.current),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const resetAtMs =
          getHistoryClassroomStudentRetryResetMs(
            normalizeHistoryClassroomAssignment(snapshot.id, snapshot.data()),
            userData.uid,
          ) || 0;
        if (resetAtMs <= loadedRetryResetAtRef.current) return;
        loadedRetryResetAtRef.current = resetAtMs;
        setAssignmentReloadRevision((revision) => revision + 1);
      },
      () => {
        /* Normal load retains the access error; listeners never bypass it. */
      },
    );
  }, [error, loading, assignmentId, config, userData?.uid]);

  const beginCanonicalAttempt = async () => {
    if (!assignment || startingAttempt) return;
    setStartingAttempt(true);
    try {
      const { year, semester } = getYearSemester(config);
      await startAssessmentAttempt({
        definitionId: buildAssessmentDefinitionId(
          `${year}-${semester}`,
          "HISTORY_CLASSROOM",
          assignment.id,
        ),
      });
      setAssignmentReloadRevision((revision) => revision + 1);
    } catch (error) {
      setResultText(
        error instanceof Error
          ? error.message
          : "응시를 시작하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setStartingAttempt(false);
    }
  };

  useEffect(() => {
    if (
      !violationReason ||
      !canonicalAttemptRef.current ||
      isNetworkOffline ||
      violationSaved
    )
      return;
    let active = true;
    let retryTimer: number | undefined;
    const attemptId = canonicalAttemptRef.current.attemptId;
    void withTimeout(
      lockHistoryClassroomAttempt({ attemptId, reason: violationReason }),
      HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
      "history classroom violation",
    )
      .then((locked) => {
        if (!active || canonicalAttemptRef.current?.attemptId !== attemptId)
          return;
        if (locked.status === "SUBMITTED") {
          violationRef.current = null;
          setViolationReason(null);
          setAssignmentReloadRevision((revision) => revision + 1);
          return;
        }
        canonicalAttemptRef.current = {
          ...canonicalAttemptRef.current,
          ...locked,
        };
        setViolationSaved(true);
        persistAttemptProgress();
      })
      .catch(() => {
        if (active)
          retryTimer = window.setTimeout(
            () => setViolationRetry((revision) => revision + 1),
            getHistoryClassroomRetryDelay(violationRetry + 1),
          );
      });
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [
    violationReason,
    isNetworkOffline,
    violationSaved,
    violationRetry,
    assignment,
    persistAttemptProgress,
  ]);

  const recordAttemptViolation = (
    reason: NonNullable<typeof violationReason>,
  ) => {
    if (
      !canonicalAttemptRef.current ||
      completedRef.current ||
      submittingRef.current ||
      pendingSubmissionRef.current
    )
      return;
    violationRef.current = reason;
    setViolationReason(reason);
    setPendingExitAction(null);
    setExitConfirmSubmitting(false);
    persistAttemptProgress();
  };

  const persistCanonicalProgress = () => {
    const target = canonicalAttemptRef.current?.attemptId;
    const snapshot = {
      answers: { ...answersRef.current },
      currentPage: currentPageRef.current,
    };
    const task = progressSaveTailRef.current
      .catch(() => undefined)
      .then(async () => {
        const active = canonicalAttemptRef.current;
        if (
          !active ||
          active.attemptId !== target ||
          !["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(active.status)
        )
          return;
        const flush = async (
          input: Parameters<typeof saveAssessmentProgress>[0],
        ) => {
          pendingProgressRef.current = input;
          persistAttemptProgress();
          const saved = await withTimeout(
            saveAssessmentProgress(input),
            HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
            "history classroom autosave",
          );
          const current = canonicalAttemptRef.current;
          if (
            current?.attemptId === target &&
            ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(
              current.status,
            ) &&
            current.revision <= saved.revision
          ) {
            canonicalAttemptRef.current = {
              ...current,
              status: "IN_PROGRESS",
              revision: saved.revision,
              answers: input.answers,
              currentItemId: input.currentItemId,
              lastSavedAtIso: saved.savedAtIso,
            };
          }
          pendingProgressRef.current = null;
          persistAttemptProgress();
          return saved;
        };
        // Replay an ambiguous save with its original revision/payload before
        // sending newer input, so a lost acknowledgement cannot create a conflict.
        if (pendingProgressRef.current?.attemptId === target)
          await flush(pendingProgressRef.current);
        if (violationRef.current || pendingSubmissionRef.current) return;
        return flush({
          attemptId: active.attemptId,
          expectedRevision:
            canonicalAttemptRef.current?.revision ?? active.revision,
          answers: sanitizeHistoryClassroomAnswersForWrite(snapshot.answers),
          currentItemId: String(snapshot.currentPage),
        });
      });
    progressSaveTailRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  useEffect(() => {
    if (
      !assignment ||
      !attemptStarted ||
      completed ||
      submitting ||
      isNetworkOffline ||
      violationReason ||
      pendingSubmissionRef.current
    )
      return;
    let disposed = false;
    let retryTimer: number | undefined;
    const timer = window.setTimeout(() => {
      void persistCanonicalProgress()
        .then(() => {
          if (!disposed)
            setResultText((text) =>
              text.startsWith("답안을 자동 저장하지 못했습니다.") ? "" : text,
            );
        })
        .catch((error) => {
          if (disposed) return;
          setResultText(
            "답안을 자동 저장하지 못했습니다. 입력 내용은 이 기기에 보관했습니다.",
          );
          if (isHistoryClassroomTransientSaveError(error))
            retryTimer = window.setTimeout(
              () => setProgressRetry((revision) => revision + 1),
              getHistoryClassroomRetryDelay(progressRetry + 1),
            );
        });
    }, 900);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [
    answers,
    currentPage,
    assignment,
    completed,
    submitting,
    isNetworkOffline,
    violationReason,
    attemptStarted,
    progressRetry,
  ]);

  const saveResult = async (_options: {
    status: "passed" | "failed" | "cancelled";
    cancellationReason?: string;
  }) => {
    await progressSaveTailRef.current;
    if (pendingProgressRef.current) {
      try {
        await persistCanonicalProgress();
      } catch (error) {
        const reason = (error as { details?: { reason?: string } })?.details
          ?.reason;
        // An unaccepted offline autosave is no longer writable after expiry.
        // Its answers still belong in the TIMEOUT submission below.
        if (reason !== "ASSESSMENT_DEADLINE_EXPIRED") throw error;
        pendingProgressRef.current = null;
      }
    }
    const active = canonicalAttemptRef.current;
    if (!assignment || !userData || !active)
      throw new Error(
        "응시 상태를 확인하지 못했습니다. 연결 후 다시 시도해 주세요.",
      );
    const sanitizedAnswers = sanitizeHistoryClassroomAnswersForWrite(
      pendingSubmissionRef.current?.answers || answersRef.current,
    );
    const expired =
      Date.now() + serverTimeOffsetMsRef.current >=
      Date.parse(active.deadlineAtIso);
    const reason = pendingSubmissionRef.current?.reason;
    const submitted = await withTimeout(
      submitAssessmentAttempt({
        attemptId: active.attemptId,
        expectedRevision: active.revision,
        answers: sanitizedAnswers,
        submitReason:
          expired || (reason && reason !== "manual") ? "TIMEOUT" : "STUDENT",
      }),
      HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
      "history classroom submission",
    );
    canonicalAttemptRef.current = {
      ...active,
      status: "SUBMITTED",
      revision: submitted.revision || active.revision,
      answers: sanitizedAnswers,
      resultRef: submitted.resultRef,
    };
    confirmedSubmissionRef.current = submitted;
    const checks = summarizeHistoryClassroomAnswers(
      assignment,
      sanitizedAnswers,
    ).checks.map((check) => ({
      ...check,
      correct:
        submitted.answerChecks.find((item) => item.id === check.blankId)
          ?.correct === true,
    }));
    clearAttemptProgress(assignment.id, userData.uid);
    attemptDeadlineMsRef.current = 0;
    const passed =
      submitted.passed ?? submitted.percent >= assignment.passThresholdPercent;
    return {
      score: submitted.score,
      total: submitted.total,
      percent: submitted.percent,
      status: passed ? ("passed" as const) : ("failed" as const),
      passed,
      passThresholdPercent:
        submitted.passThresholdPercent ?? assignment.passThresholdPercent,
      answerChecks: checks,
      resultId: submitted.attemptId,
      resultCollectionPath: submitted.resultRef,
      usedLegacyResultFallback: false,
    };
  };
  const applyHistoryClassroomPointReward = async (
    resultId: string,
    percent: number,
  ) => {
    try {
      const confirmed = confirmedSubmissionRef.current;
      const pointResult = confirmed?.reward;
      if (!confirmed || confirmed.attemptId !== resultId || !pointResult)
        return;
      if (confirmed.replayedSubmission) {
        setPointNotice(
          pointResult.totalAwarded
            ? "이 제출의 위스는 이미 반영되었습니다."
            : pointResult.blockedMessage || "",
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
        "Failed to claim history classroom point reward:",
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
      submittingRef.current ||
      cancellationInFlightRef.current
    )
      return false;
    cancellationInFlightRef.current = true;
    try {
      if (reason !== "refresh-shortcut") {
        const violation =
          reason === "visibility-hidden" ? "VISIBILITY_HIDDEN" : "NAVIGATION";
        recordAttemptViolation(violation);
        if (networkOfflineRef.current) return false;
        const active = canonicalAttemptRef.current;
        if (!active) return false;
        const locked = await withTimeout(
          lockHistoryClassroomAttempt({
            attemptId: active.attemptId,
            reason: violation,
          }),
          HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
          "history classroom exit",
        );
        if (locked.status === "SUBMITTED") {
          setAssignmentReloadRevision((revision) => revision + 1);
          return false;
        }
        canonicalAttemptRef.current = { ...active, ...locked };
        setViolationSaved(true);
      }
      persistAttemptProgress();
      if (
        reason === "refresh-shortcut" &&
        !completedRef.current &&
        !pendingSubmissionRef.current
      ) {
        if (networkOfflineRef.current)
          throw new Error("인터넷 연결 후 답안을 저장하고 나갈 수 있습니다.");
        // Refresh preserves the server attempt; confirmed navigation is locked above.
        if (
          Date.now() + serverTimeOffsetMsRef.current <
          attemptDeadlineMsRef.current
        )
          await persistCanonicalProgress();
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
    } catch (error) {
      showToast({
        tone: "warning",
        title: "답안을 저장하지 못했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "연결을 확인한 뒤 다시 시도해 주세요.",
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

      if (!assignment || !canonicalAttemptRef.current || completedRef.current) {
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

  useEffect(() => {
    const dialog = resultDialogOpen
      ? resultDialogRef.current
      : pendingExitAction
        ? exitDialogRef.current
        : null;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Dismiss the tablet keyboard before measuring/focusing the result dialog.
    previous?.blur();
    const releaseScroll = acquirePageScrollLock();
    const buttons = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex="0"]',
        ),
      );
    buttons()[0]?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (resultDialogOpen) setResultDialogOpen(false);
        else cancelPendingExit();
      }
      if (event.key !== "Tab") return;
      const targets = buttons();
      const first = targets[0],
        last = targets[targets.length - 1];
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      releaseScroll();
      if (previous?.isConnected && !previous.matches(":disabled"))
        previous.focus({ preventScroll: true });
    };
  }, [resultDialogOpen, pendingExitAction, cancelPendingExit]);

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
    const markOffline = () => {
      networkOfflineRef.current = true;
      setIsNetworkOffline(true);
      if (networkOfflineStartedAtRef.current == null) {
        networkOfflineStartedAtRef.current = Date.now();
      }
      setResultText(
        pendingSubmissionRef.current
          ? "답안을 보관했습니다. 인터넷이 연결되면 자동으로 제출합니다."
          : "인터넷 연결이 끊겼습니다. 제한 시간은 계속 진행되며 답안은 이 기기에 보관됩니다.",
      );
      persistAttemptProgress();
    };

    const markOnline = () => {
      networkOfflineRef.current = false;
      setIsNetworkOffline(false);
      networkOfflineStartedAtRef.current = null;

      if (assignment && userData?.uid) {
        persistAttemptProgress();
      }

      if (pendingSubmissionRef.current) {
        setPendingSubmitAfterOnline(true);
        setNextSubmitRetryAt(Date.now());
      } else {
        setResultText((prev) =>
          prev.includes("인터넷 연결이 끊") ? "" : prev,
        );
      }
      if (error) setAssignmentReloadRevision((revision) => revision + 1);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      markOffline();
    }

    window.addEventListener("offline", markOffline);
    window.addEventListener("online", markOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", markOnline);
    };
  }, [assignment, error, persistAttemptProgress, userData?.uid]);

  useEffect(() => {
    if (!assignment || !userData?.uid || completed) return undefined;

    const getViewportState = () => {
      const width = window.screen.width || window.innerWidth;
      const height = window.screen.height || window.innerHeight;
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
  }, [assignment, completed, markScreenRotationGrace, userData?.uid]);

  useEffect(() => {
    if (assignment && !completed) persistAttemptProgress();
  }, [answers, assignment, completed, currentPage, persistAttemptProgress]);

  const finalizeExpiredAttempt = (reason: "time-limit" | "due-window") => {
    if (
      completedRef.current ||
      submittingRef.current ||
      autoSubmitHandledRef.current
    )
      return;
    autoSubmitHandledRef.current = true;
    void submitAnswers(reason);
  };

  useEffect(() => {
    if (!assignment || !attemptStarted || completed || submitting)
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
      if (
        submittingRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;
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
    if (!assignment || !attemptStarted || completed || submitting)
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
      if (
        submittingRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      requestExit("link-navigation", { redirectTo: route });
    };

    document.addEventListener("click", handleLinkClick, true);
    return () => document.removeEventListener("click", handleLinkClick, true);
  }, [assignment, attemptStarted, completed, requestExit, submitting]);

  useEffect(() => {
    if (!assignment || !attemptStarted || completed || submitting)
      return undefined;

    const handleRefreshShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isRefreshShortcut =
        key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
      if (!isRefreshShortcut) return;
      if (
        submittingRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;

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
    if (!assignment || !attemptStarted || completed) return undefined;

    const clearVisibilityCancelTimer = () => {
      if (visibilityCancelTimerRef.current != null) {
        window.clearTimeout(visibilityCancelTimerRef.current);
        visibilityCancelTimerRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") {
        clearVisibilityCancelTimer();
        // Mobile browsers can suspend timers in background. Evaluate the elapsed
        // absence on return too; connectivity never excuses a genuine tab switch.
        if (
          hiddenStartedAtRef.current &&
          Date.now() >=
            Math.max(
              hiddenStartedAtRef.current + VISIBILITY_CANCEL_DELAY_MS,
              screenRotationGraceUntilRef.current,
            )
        )
          recordAttemptViolation("VISIBILITY_HIDDEN");
        hiddenStartedAtRef.current = 0;
        return;
      }
      if (
        submittingRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;
      hiddenStartedAtRef.current = Date.now();
      isScreenRotationGraceActive();
      clearVisibilityCancelTimer();
      visibilityCancelTimerRef.current = window.setTimeout(
        () => {
          visibilityCancelTimerRef.current = null;
          if (document.visibilityState !== "hidden") return;
          if (
            submittingRef.current ||
            completedRef.current ||
            pendingSubmissionRef.current
          )
            return;
          if (isScreenRotationGraceActive()) {
            visibilityCancelTimerRef.current = window.setTimeout(() => {
              if (document.visibilityState === "hidden")
                recordAttemptViolation("VISIBILITY_HIDDEN");
            }, screenRotationGraceUntilRef.current - Date.now());
            return;
          }
          recordAttemptViolation("VISIBILITY_HIDDEN");
        },
        Math.max(
          VISIBILITY_CANCEL_DELAY_MS,
          screenRotationGraceUntilRef.current - Date.now(),
        ),
      );
    };
    const handlePageHide = () => {
      persistAttemptProgress();
    };
    const handleBeforeUnload = () => {
      persistAttemptProgress();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearVisibilityCancelTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [
    assignment,
    attemptStarted,
    completed,
    isScreenRotationGraceActive,
    navigate,
    submitting,
    userData,
  ]);

  useEffect(() => {
    if (!assignment || !userData || completed || submitting) {
      return undefined;
    }

    emitSessionActivity();
    const activityTimerId = window.setInterval(emitSessionActivity, 60 * 1000);
    return () => {
      window.clearInterval(activityTimerId);
    };
  }, [
    assignment,
    attemptStarted,
    completed,
    isScreenRotationGraceActive,
    submitting,
    userData,
  ]);

  useEffect(() => {
    if (
      !canonicalAttemptRef.current ||
      completed ||
      submitting ||
      violationReason
    ) {
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
    violationReason,
    submitting,
  ]);

  useEffect(() => {
    if (
      !assignment ||
      !attemptStarted ||
      completed ||
      submitting ||
      violationReason
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
  }, [assignment, attemptStarted, completed, submitting, violationReason]);

  const totalTimeSeconds = canonicalAttemptRef.current
    ? Math.max(
        0,
        (Date.parse(canonicalAttemptRef.current.deadlineAtIso) -
          Date.parse(canonicalAttemptRef.current.startedAtIso)) /
          1000,
      )
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
    if (
      !attemptStarted ||
      violationRef.current ||
      completedRef.current ||
      submittingRef.current ||
      pendingSubmissionRef.current
    )
      return;
    if (
      Date.now() + serverTimeOffsetMsRef.current >=
      attemptDeadlineMsRef.current
    ) {
      finalizeExpiredAttempt("time-limit");
      return;
    }
    emitSessionActivity();
    answersRef.current = { ...answersRef.current, [blankId]: value };
    setAnswers(answersRef.current);
    persistAttemptProgress();
  };

  const handleCurrentPageChange = (page: number) => {
    emitSessionActivity();
    currentPageRef.current = page;
    setCurrentPage(page);
    persistAttemptProgress();
  };

  const handleUseHint = () => {
    if (
      !assignmentRef.current ||
      !attemptStarted ||
      violationRef.current ||
      completedRef.current ||
      submittingRef.current ||
      pendingSubmissionRef.current ||
      cancellationInFlightRef.current ||
      hintUseCountRef.current >= HISTORY_CLASSROOM_HINT_LIMIT
    )
      return false;
    // Update the ref before React renders so rapid calls cannot exceed the limit.
    hintUseCountRef.current += 1;
    setHintUseCount(hintUseCountRef.current);
    persistAttemptProgress();
    emitSessionActivity();
    return true;
  };

  const submitAnswers = async (
    reason: HistoryClassroomSubmissionReason = "manual",
  ) => {
    if (
      !assignment ||
      !userData ||
      !canonicalAttemptRef.current ||
      violationRef.current
    )
      return;
    if (completedRef.current || submittingRef.current) return;
    if (!pendingSubmissionRef.current) {
      pendingSubmissionRef.current = {
        status: "failed",
        reason,
        answers: { ...answersRef.current },
      };
    }
    persistAttemptProgress();
    setPendingSubmitAfterOnline(true);
    setNextSubmitRetryAt(null);
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
      const pending = pendingSubmissionRef.current!;
      const result = await saveResult({
        status: pending.status,
        cancellationReason: pending.cancellationReason,
      });
      setCompleted(true);
      completedRef.current = true;
      if (!result) return;
      if (!assignment.cooldownMinutes || result.passed) {
        clearCooldownLock(assignment.id, userData.uid);
      } else {
        writeCooldownLock(
          assignment.id,
          userData.uid,
          Date.now() + assignment.cooldownMinutes * 60 * 1000,
          "submitted",
        );
      }

      if (!resultSummaryShownRef.current) {
        resultSummaryShownRef.current = true;
        setResultSummary(
          buildHistoryClassroomResultSummary(assignment, result),
        );
        setResultDialogOpen(true);
      }
      pendingSubmissionRef.current = null;
      retryFailureCountRef.current = 0;
      setPendingSubmitAfterOnline(false);
      setNextSubmitRetryAt(null);
      setResultText("");
      submittingRef.current = false;
      setSubmitting(false);
      void applyHistoryClassroomPointReward(result.resultId, result.percent);
    } catch (submitError) {
      console.error(submitError);
      retryFailureCountRef.current += 1;
      const revisionConflict = isAssessmentRevisionConflict(submitError);
      const retryable =
        !revisionConflict &&
        (networkOfflineRef.current ||
          isHistoryClassroomTransientSaveError(submitError));
      setPendingSubmitAfterOnline(true);
      setNextSubmitRetryAt(
        retryable
          ? Date.now() +
              getHistoryClassroomRetryDelay(retryFailureCountRef.current)
          : null,
      );
      setResultText(
        revisionConflict
          ? "다른 창에서 답안이 변경되었습니다. 현재 답안은 보관했습니다. 새로고침하여 저장 상태를 확인해 주세요."
          : retryable
            ? "답안을 보관했습니다. 연결을 확인하고 자동으로 다시 제출합니다."
            : "답안을 보관했지만 제출하지 못했습니다. 다시 제출해 주세요.",
      );
      persistAttemptProgress();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      isNetworkOffline ||
      !pendingSubmitAfterOnline ||
      nextSubmitRetryAt == null ||
      !assignment ||
      !userData ||
      completed ||
      submitting
    )
      return;
    const timer = window.setTimeout(
      () => void submitAnswers(),
      Math.max(0, nextSubmitRetryAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [
    assignment,
    completed,
    isNetworkOffline,
    nextSubmitRetryAt,
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
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() =>
                setAssignmentReloadRevision((revision) => revision + 1)
              }
              className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"
            >
              다시 확인
            </button>
            <button
              type="button"
              onClick={() => navigate("/student/history-classroom")}
              className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700"
            >
              목록으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (violationReason) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div
          className="rounded-xl border border-red-200 bg-white p-6"
          role="alert"
        >
          <h1 className="text-xl font-bold text-red-700">
            응시 화면 이탈로 재응시가 제한되었습니다.
          </h1>
          <p className="mt-3 text-sm text-gray-700">선생님께 확인해 주세요.</p>
          {!violationSaved && (
            <p className="mt-3 text-sm text-gray-600">
              이탈 기록을 이 기기에 보관했습니다. 연결되면 자동으로 반영합니다.
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate("/student/history-classroom")}
            disabled={!violationSaved}
            className="mt-4 min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            목록으로
          </button>
        </div>
      </div>
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
        hintUseCount={hintUseCount}
        onUseHint={handleUseHint}
        onSubmit={() =>
          void (attemptStarted ? submitAnswers() : beginCanonicalAttempt())
        }
        submitting={submitting || startingAttempt}
        answersLocked={!attemptStarted || pendingSubmitAfterOnline}
        submitLabel={
          !attemptStarted
            ? "응시 시작"
            : pendingSubmitAfterOnline
              ? "다시 제출"
              : undefined
        }
        completed={completed}
        resultText={resultSummary ? "" : resultText}
        pointNotice={pointNotice}
        countdownLabel={countdownLabel}
        timeProgressPercent={timeProgressPercent}
        dueStatusLabel={dueStatus.label}
        dueStatusTone={dueStatus.tone}
        headerAction={
          resultSummary ? (
            <button
              type="button"
              onClick={() => setResultDialogOpen(true)}
              className="min-h-11 shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-bold text-gray-700"
            >
              결과 보기
            </button>
          ) : undefined
        }
      />
      {pendingExitAction && (
        <div
          ref={exitDialogRef}
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
                {pendingExitAction.mode === "reload"
                  ? "답안을 저장한 뒤 새로고침합니다. 제한 시간은 계속 진행됩니다."
                  : "나가면 응시가 중단되고 재응시가 제한됩니다. 선생님의 확인이 필요합니다."}
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
          ref={resultDialogRef}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-classroom-result-title"
          onClick={() => {
            setResultDialogOpen(false);
            setResultText("");
          }}
        >
          <div
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-3 sm:px-6">
              <h2
                id="history-classroom-result-title"
                className="text-2xl font-black text-slate-900"
              >
                {resultSummary.passed ? "통과" : "미통과"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setResultDialogOpen(false);
                  setResultText("");
                }}
                className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
              <p
                aria-label="정답 수"
                className="text-3xl font-black text-slate-900"
              >
                {resultSummary.correctCount}
                <span className="text-base font-semibold text-slate-600">
                  /{resultSummary.total}문제
                </span>
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {resultSummary.percent}% · 통과 기준{" "}
                {resultSummary.passThresholdPercent}%
              </p>
              {pointNotice && (
                <p className="mt-3 text-sm font-bold text-blue-700">
                  {pointNotice}
                </p>
              )}
              <section
                className="mt-5"
                aria-labelledby="history-classroom-missed-answers-title"
              >
                <h3
                  id="history-classroom-missed-answers-title"
                  className="text-sm font-bold text-slate-700"
                >
                  못 쓴 답들
                </h3>
                <p className="mt-2 text-base leading-7 text-slate-900 [overflow-wrap:anywhere]">
                  {Array.from(
                    new Set(
                      resultSummary.wrongItems
                        .map((item) => item.correctAnswer.trim())
                        .filter(Boolean),
                    ),
                  ).join(", ") || "없음"}
                </p>
              </section>
            </div>
            <div className="shrink-0 border-t border-slate-200 px-5 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setResultDialogOpen(false);
                  setResultText("");
                }}
                className="min-h-11 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
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
