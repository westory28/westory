import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppToast } from "../../../components/common/AppToastProvider";
import HistoryClassroomAssignmentView from "../../../components/common/HistoryClassroomAssignmentView";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import { db, getHttpsCallable } from "../../../lib/firebase";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomStudentRetryResetMs,
  getHistoryClassroomTimestampMs,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  summarizeHistoryClassroomAnswers,
  type HistoryClassroomAnswerCheck,
  type HistoryClassroomAssignment,
} from "../../../lib/historyClassroom";
import { normalizeMapResource } from "../../../lib/mapResources";
import { notifyHistoryClassroomSubmitted } from "../../../lib/notifications";
import {
  buildHistoryClassroomRewardSourceId,
  claimPointActivityReward,
} from "../../../lib/points";
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
  canUseHistoryClassroomLegacySave,
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

const readCooldownLockUntil = (
  assignmentId: string,
  uid: string,
  resetAtMs: number | null = null,
): number => {
  const key = getCooldownLockKey(assignmentId, uid);
  const parsed = readJsonObject(readLocalOnly(key));
  if (!parsed) return 0;

  const savedAt = Number(parsed.savedAt) || 0;
  if (resetAtMs && savedAt && savedAt <= resetAtMs) {
    removeStorage(key);
    return 0;
  }
  const blockedUntil = Number(parsed.blockedUntil) || 0;
  if (blockedUntil > Date.now()) return blockedUntil;

  removeStorage(key);
  return 0;
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

const getExitCooldownMinutes = (
  assignment: Pick<HistoryClassroomAssignment, "cooldownMinutes"> | null,
) => Math.max(0, Number(assignment?.cooldownMinutes || 0));

const getExitCooldownUntil = (
  assignment: Pick<HistoryClassroomAssignment, "cooldownMinutes">,
) => Date.now() + getExitCooldownMinutes(assignment) * 60 * 1000;

const writeExitCooldownLock = (
  assignment: HistoryClassroomAssignment,
  uid: string,
  reason: string,
) => {
  if (getExitCooldownMinutes(assignment) <= 0) {
    clearCooldownLock(assignment.id, uid);
    return;
  }
  writeCooldownLock(
    assignment.id,
    uid,
    getExitCooldownUntil(assignment),
    reason,
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

const LEGACY_HISTORY_CLASSROOM_RESULTS_COLLECTION = "history_classroom_results";
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

const isRecoverableResultSaveError = (error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message = error instanceof Error ? error.message : String(error || "");

  return (
    code === "permission-denied" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    message.includes("Missing or insufficient permissions") ||
    message.includes("timed out") ||
    message.includes("network")
  );
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

const submitHistoryClassroomResultViaFunction = async (input: {
  year: string;
  semester: string;
  resultId: string;
  assignmentId: string;
  answers: Record<string, string>;
  status: "passed" | "failed" | "cancelled";
  cancellationReason: string;
}) => {
  const callable = await getHttpsCallable("submitHistoryClassroomResult");
  const response = await callable(input);
  return response.data as {
    resultId: string;
    score: number;
    total: number;
    percent: number;
    status: "passed" | "failed" | "cancelled";
    passed: boolean;
    passThresholdPercent?: number;
    answerChecks: HistoryClassroomAnswerCheck[];
    resultCollectionPath?: string;
  };
};

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
          retryResetAtMs: loadedRetryResetAtRef.current,
          deadlineMs: attemptDeadlineMsRef.current,
          offlineStartedAt: networkOfflineStartedAtRef.current,
          currentPage: currentPageRef.current,
          answers: answersRef.current,
          hintUseCount: hintUseCountRef.current,
          pendingSubmission: pendingSubmissionRef.current,
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

      try {
        const storedAttempt = readJsonObject(
          readLocalOnly(getAttemptProgressKey(assignmentId, userData.uid)),
        );
        const scope = getYearSemester(config);
        // Read the reset marker when available, without making source access a
        // prerequisite for recovering a student's already committed result.
        assignmentReadPathRef.current = getSemesterDocPath(
          config,
          "history_classrooms",
          assignmentId,
        );
        let snap: DocumentSnapshot<DocumentData> | null = null;
        let assignmentReadError: unknown = null;
        try {
          snap = await getDoc(doc(db, assignmentReadPathRef.current));
          if (!snap.exists()) {
            assignmentReadPathRef.current = `history_classrooms/${assignmentId}`;
            snap = await getDoc(doc(db, assignmentReadPathRef.current));
          }
        } catch (readError) {
          assignmentReadError = readError;
        }
        const resetAtMs = snap?.exists()
          ? getHistoryClassroomStudentRetryResetMs(
              normalizeHistoryClassroomAssignment(snap.id, snap.data()),
              userData.uid,
            ) || 0
          : 0;
        loadedRetryResetAtRef.current = resetAtMs;
        const isResetDraft =
          !!storedAttempt &&
          resetAtMs > 0 &&
          (typeof storedAttempt.retryResetAtMs === "number" &&
          Number.isFinite(storedAttempt.retryResetAtMs) &&
          storedAttempt.retryResetAtMs >= 0
            ? storedAttempt.retryResetAtMs < resetAtMs
            : Number(storedAttempt.savedAt) <= resetAtMs);
        const scopedStoredAttempt =
          storedAttempt &&
          !isResetDraft &&
          (!storedAttempt.year ||
            (storedAttempt.year === scope.year &&
              storedAttempt.semester === scope.semester))
            ? storedAttempt
            : null;
        if (isResetDraft) clearAttemptProgress(assignmentId, userData.uid);
        hintUseCountRef.current = normalizeHistoryClassroomHintUseCount(
          scopedStoredAttempt?.hintUseCount,
        );
        setHintUseCount(hintUseCountRef.current);
        const queuedSubmission = readHistoryClassroomPendingSubmission(
          scopedStoredAttempt?.pendingSubmission,
        );
        // A committed result belongs to the student even if the teacher later
        // hides, unassigns or removes the source. Recover only that known result;
        // do not use this path to read an assignment the student cannot access.
        if (queuedSubmission && scopedStoredAttempt?.resultId) {
          let ownResult = null;
          for (const collectionPath of [
            getSemesterCollectionPath(config, "history_classroom_results"),
            LEGACY_HISTORY_CLASSROOM_RESULTS_COLLECTION,
          ]) {
            try {
              const resultSnap = await getDoc(
                doc(db, collectionPath, String(scopedStoredAttempt.resultId)),
              );
              if (!resultSnap.exists()) continue;
              const raw = resultSnap.data();
              if (raw.uid !== userData.uid || raw.assignmentId !== assignmentId)
                continue;
              ownResult = normalizeHistoryClassroomResult(resultSnap.id, raw);
              break;
            } catch {
              // An absent/unreadable result must still pass normal assignment
              // access checks below before any further attempt can start.
            }
          }
          if (ownResult) {
            const resultOnlyAssignment = normalizeHistoryClassroomAssignment(
              assignmentId,
              {
                title: ownResult.assignmentTitle || "역사교실 제출 결과",
                passThresholdPercent: ownResult.passThresholdPercent,
              },
            );
            setAssignment(resultOnlyAssignment);
            setAnswers(queuedSubmission.answers);
            setCompleted(true);
            completedRef.current = true;
            if (ownResult.status === "cancelled") {
              setResultText(
                "응시가 취소되었습니다. 목록에서 다시 응시할 수 있는 시간을 확인해 주세요.",
              );
            } else {
              setResultSummary(
                buildHistoryClassroomResultSummary(
                  resultOnlyAssignment,
                  ownResult,
                ),
              );
              setResultDialogOpen(true);
              void applyHistoryClassroomPointReward(
                ownResult.id,
                ownResult.percent,
              );
            }
            resultSummaryShownRef.current = true;
            clearAttemptProgress(assignmentId, userData.uid);
            clearCooldownLock(assignmentId, userData.uid);
            return;
          }
        }
        if (assignmentReadError) throw assignmentReadError;
        if (!snap?.exists()) {
          throw new Error("역사교실 자료를 찾을 수 없습니다.");
        }

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
          if (!mapSnap.exists()) {
            mapSnap = await getDoc(
              doc(db, `map_resources/${loaded.mapResourceId}`),
            );
          }
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

        let resultSnap = await getDocs(
          query(
            collection(
              db,
              getSemesterCollectionPath(config, "history_classroom_results"),
            ),
            where("uid", "==", userData.uid),
            where("assignmentId", "==", loaded.id),
          ),
        );
        if (resultSnap.empty) {
          resultSnap = await getDocs(
            query(
              collection(db, "history_classroom_results"),
              where("uid", "==", userData.uid),
              where("assignmentId", "==", loaded.id),
            ),
          );
        }

        const attempts = resultSnap.docs
          .map((docSnap) =>
            normalizeHistoryClassroomResult(docSnap.id, docSnap.data()),
          )
          .sort(
            (left, right) =>
              (getHistoryClassroomTimestampMs(right.createdAt) || 0) -
              (getHistoryClassroomTimestampMs(left.createdAt) || 0),
          );
        const savedAttempt = scopedStoredAttempt;
        const pendingSubmission = readHistoryClassroomPendingSubmission(
          savedAttempt?.pendingSubmission,
        );
        const latest = attempts[0];
        const passedAttempt = attempts.find(
          (attempt) => attempt.status === "passed" || attempt.passed,
        );

        if (passedAttempt) {
          throw new Error(
            "이미 통과한 역사교실입니다. 목록에서 결과를 확인할 수 있습니다.",
          );
        }

        const lastAttemptMs = getHistoryClassroomTimestampMs(latest?.createdAt);
        const retryCooldownMinutes = loaded.cooldownMinutes;
        const shouldSkipServerCooldown =
          !!resetAtMs && !!lastAttemptMs && lastAttemptMs <= resetAtMs;
        if (
          !pendingSubmission &&
          lastAttemptMs &&
          retryCooldownMinutes > 0 &&
          !shouldSkipServerCooldown
        ) {
          const availableAt = lastAttemptMs + retryCooldownMinutes * 60 * 1000;
          if (availableAt > Date.now()) {
            const remain = Math.ceil((availableAt - Date.now()) / 60000);
            throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
          }
        }

        const localAvailableAt =
          loaded.cooldownMinutes > 0
            ? readCooldownLockUntil(loaded.id, userData.uid, resetAtMs)
            : 0;
        if (loaded.cooldownMinutes <= 0) {
          clearCooldownLock(loaded.id, userData.uid);
        }
        const rotationGraceUntil = readRotationGraceUntil(
          loaded.id,
          userData.uid,
        );
        const isRotationResume = rotationGraceUntil > Date.now();
        if (
          localAvailableAt > Date.now() &&
          !isRotationResume &&
          !savedAttempt
        ) {
          const remain = Math.ceil((localAvailableAt - Date.now()) / 60000);
          throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
        }
        if (localAvailableAt) {
          clearCooldownLock(loaded.id, userData.uid);
        }

        if (isHistoryClassroomPastDue(loaded) && !savedAttempt) {
          throw new Error("응시 기간이 마감된 역사교실입니다.");
        }

        const offlineStartedAt = Number(savedAttempt?.offlineStartedAt) || 0;
        const pausedMs = offlineStartedAt
          ? Math.max(0, Date.now() - offlineStartedAt)
          : 0;
        const savedDeadlineMs =
          (Number(savedAttempt?.deadlineMs) || 0) +
          (loaded.timeLimitMinutes > 0 ? pausedMs : 0);
        networkOfflineStartedAtRef.current = networkOfflineRef.current
          ? Date.now()
          : null;
        const hasSavedDeadline = savedDeadlineMs > 0;
        const savedAnswers =
          savedAttempt?.answers && typeof savedAttempt.answers === "object"
            ? Object.fromEntries(
                Object.entries(savedAttempt.answers).map(([key, value]) => [
                  key,
                  String(value ?? ""),
                ]),
              )
            : {};
        const savedPageNumber = Number(savedAttempt?.currentPage) || 0;
        const savedPage = loaded.pdfPageImages?.some(
          (page) => page.page === savedPageNumber,
        )
          ? savedPageNumber
          : 0;
        const nextDeadlineMs =
          loaded.timeLimitMinutes > 0
            ? hasSavedDeadline
              ? savedDeadlineMs
              : Date.now() + loaded.timeLimitMinutes * 60 * 1000
            : 0;
        const initialRemainingSeconds =
          loaded.timeLimitMinutes > 0
            ? Math.max(0, Math.ceil((nextDeadlineMs - Date.now()) / 1000))
            : null;

        writeExitCooldownLock(loaded, userData.uid, "attempt-started");
        attemptResultIdRef.current = String(
          savedAttempt?.resultId ||
            doc(
              collection(
                db,
                getSemesterCollectionPath(config, "history_classroom_results"),
              ),
            ).id,
        );
        pendingSubmissionRef.current = pendingSubmission;
        answersRef.current = pendingSubmission?.answers || savedAnswers;
        currentPageRef.current =
          savedPage || loaded.pdfPageImages?.[0]?.page || 1;
        attemptDeadlineMsRef.current = nextDeadlineMs;
        completedRef.current = false;
        persistAttemptProgress(loaded);
        setAssignment(loaded);
        setCurrentPage(savedPage || loaded.pdfPageImages?.[0]?.page || 1);
        setAnswers(answersRef.current);
        setCompleted(false);
        completedRef.current = false;
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
        setRemainingSeconds(initialRemainingSeconds);
        setRemainingDueMs(getHistoryClassroomRemainingMs(loaded));
        cancellationInFlightRef.current = false;
        exitNavigationAllowedRef.current = false;
        autoSubmitHandledRef.current = !!pendingSubmission;
        attemptDeadlineMsRef.current = nextDeadlineMs;
        screenRotationGraceUntilRef.current = rotationGraceUntil;
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

  const saveResult = async (options: {
    status: "passed" | "failed" | "cancelled";
    cancellationReason?: string;
  }) => {
    if (!assignment || !userData) return null;

    const sanitizedAnswers = sanitizeHistoryClassroomAnswersForWrite(
      pendingSubmissionRef.current?.answers || answersRef.current,
    );
    const answerSummary = summarizeHistoryClassroomAnswers(
      assignment,
      sanitizedAnswers,
    );
    const { checks: answerChecks, score, total, percent } = answerSummary;
    const sanitizedAnswerChecks =
      sanitizeHistoryClassroomAnswerChecksForWrite(answerChecks);
    const passed =
      options.status === "cancelled"
        ? false
        : percent >= assignment.passThresholdPercent;
    const status =
      options.status === "cancelled"
        ? "cancelled"
        : passed
          ? "passed"
          : "failed";
    const resultCollectionPath = getSemesterCollectionPath(
      config,
      "history_classroom_results",
    );
    const resultRef = doc(db, resultCollectionPath, attemptResultIdRef.current);

    console.info("[HistoryClassroomRunner] Saving result", {
      resultCollectionPath,
      resultId: resultRef.id,
      assignmentId: assignment.id,
      uid: userData.uid,
      score,
      total,
      percent,
      status,
    });

    try {
      const { year, semester } = getYearSemester(config);
      const serverResult = await withTimeout(
        submitHistoryClassroomResultViaFunction({
          year,
          semester,
          resultId: resultRef.id,
          assignmentId: assignment.id,
          answers: sanitizedAnswers,
          status,
          cancellationReason: options.cancellationReason || "",
        }),
        HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
        "history classroom callable result save",
      );

      clearAttemptProgress(assignment.id, userData.uid);
      attemptDeadlineMsRef.current = 0;

      return {
        score: Number.isFinite(serverResult.score)
          ? Number(serverResult.score)
          : score,
        total: Number.isFinite(serverResult.total)
          ? Number(serverResult.total)
          : total,
        percent: Number.isFinite(serverResult.percent)
          ? Number(serverResult.percent)
          : percent,
        status: serverResult.status || status,
        passed: serverResult.passed === true,
        passThresholdPercent: Number.isFinite(serverResult.passThresholdPercent)
          ? Number(serverResult.passThresholdPercent)
          : assignment.passThresholdPercent,
        answerChecks: Array.isArray(serverResult.answerChecks)
          ? sanitizeHistoryClassroomAnswerChecksForWrite(
              serverResult.answerChecks,
            )
          : sanitizedAnswerChecks,
        resultId: String(serverResult.resultId || resultRef.id),
        resultCollectionPath:
          serverResult.resultCollectionPath || resultCollectionPath,
        usedLegacyResultFallback: false,
      };
    } catch (callableError) {
      if (!canUseHistoryClassroomLegacySave(callableError)) throw callableError;
      console.warn(
        "[HistoryClassroomRunner] Callable result save failed; falling back to direct Firestore result save.",
        callableError,
      );
    }

    const resultPayload = {
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      uid: userData.uid,
      studentName: userData.name || "",
      studentGrade: String(userData.grade || ""),
      studentClass: String(userData.class || ""),
      studentNumber: String(userData.number || ""),
      answers: sanitizedAnswers,
      score,
      total,
      percent,
      passThresholdPercent: assignment.passThresholdPercent,
      passed,
      status,
      answerChecks: sanitizedAnswerChecks,
      cancellationReason: options.cancellationReason || "",
      createdAt: serverTimestamp(),
    };
    let savedResultCollectionPath = resultCollectionPath;
    let usedLegacyResultFallback = false;

    try {
      await withTimeout(
        setDoc(resultRef, resultPayload),
        HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
        "history classroom semester result save",
      );
    } catch (saveError) {
      if (!isRecoverableResultSaveError(saveError)) {
        throw saveError;
      }

      console.warn(
        "[HistoryClassroomRunner] Semester result write did not complete; falling back to legacy result collection.",
        saveError,
      );
      savedResultCollectionPath = LEGACY_HISTORY_CLASSROOM_RESULTS_COLLECTION;
      usedLegacyResultFallback = true;
      await withTimeout(
        setDoc(
          doc(db, LEGACY_HISTORY_CLASSROOM_RESULTS_COLLECTION, resultRef.id),
          resultPayload,
        ),
        HISTORY_CLASSROOM_RESULT_SAVE_TIMEOUT_MS,
        "history classroom legacy result save",
      );
    }

    if (passed) {
      void notifyHistoryClassroomSubmitted(config, {
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        resultId: resultRef.id,
        percent,
      }).catch((notificationError) => {
        console.error(
          "Failed to create history classroom passed notification:",
          notificationError,
        );
      });
    }

    clearAttemptProgress(assignment.id, userData.uid);
    attemptDeadlineMsRef.current = 0;

    return {
      score,
      total,
      percent,
      status,
      passed,
      answerChecks: sanitizedAnswerChecks,
      resultId: resultRef.id,
      resultCollectionPath: savedResultCollectionPath,
      usedLegacyResultFallback,
    };
  };

  const applyHistoryClassroomPointReward = async (
    resultId: string,
    percent: number,
  ) => {
    try {
      const pointResult = await claimPointActivityReward({
        config,
        activityType: "history_classroom",
        sourceId: buildHistoryClassroomRewardSourceId(resultId),
        score: percent,
        sourceLabel: assignment?.title || "역사교실 제출 완료",
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

  const getExitCooldownDurationLabel = useCallback(() => {
    const cooldownMs = getExitCooldownMinutes(assignment) * 60000;
    return formatRemainingDuration(cooldownMs);
  }, [assignment]);

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
    if (pendingSubmissionRef.current) {
      persistAttemptProgress();
      const redirectTo =
        "redirectTo" in options
          ? options.redirectTo
          : "/student/history-classroom";
      if (redirectTo) {
        exitNavigationAllowedRef.current = true;
        navigate(redirectTo, { replace: options.replace ?? true });
      }
      return true;
    }
    if (networkOfflineRef.current) {
      if (assignment && userData) {
        writeExitCooldownLock(assignment, userData.uid, reason);
        clearAttemptProgress(assignment.id, userData.uid);
      }
      setCompleted(true);
      completedRef.current = true;
      const redirectTo =
        "redirectTo" in options
          ? options.redirectTo
          : "/student/history-classroom";
      if (redirectTo) {
        exitNavigationAllowedRef.current = true;
        navigate(redirectTo, { replace: options.replace ?? true });
      }
      return true;
    }

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
    pendingSubmissionRef.current = {
      status: "cancelled",
      reason: "manual",
      cancellationReason: reason,
      answers: { ...answersRef.current },
    };
    persistAttemptProgress();
    writeExitCooldownLock(assignment, userData.uid, reason);

    void saveResult({ status: "cancelled", cancellationReason: reason }).catch(
      (cancelError) => {
        console.error("Failed to save cancelled attempt:", cancelError);
      },
    );
    setCompleted(true);
    completedRef.current = true;
    setResultSummary(null);
    setResultText(
      "화면 이탈로 응시가 자동 취소되었습니다. 재응시 제한이 시작됩니다.",
    );
    const redirectTo =
      "redirectTo" in options
        ? options.redirectTo
        : "/student/history-classroom";
    if (redirectTo) {
      exitNavigationAllowedRef.current = true;
      navigate(redirectTo, { replace: options.replace ?? true });
    }
    return true;
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
        pendingSubmissionRef.current
          ? "답안을 보관했습니다. 인터넷이 연결되면 자동으로 제출합니다."
          : "인터넷 연결이 끊겨 응시 시간이 멈췄습니다. 답안은 이 기기에 보관됩니다.",
      );
      persistAttemptProgress();
    };

    const markOnline = () => {
      const offlineStartedAt = networkOfflineStartedAtRef.current;
      networkOfflineRef.current = false;
      setIsNetworkOffline(false);
      networkOfflineStartedAtRef.current = null;

      if (offlineStartedAt && assignment?.timeLimitMinutes) {
        const pausedMs = Math.max(0, Date.now() - offlineStartedAt);
        attemptDeadlineMsRef.current += pausedMs;
        setRemainingSeconds(
          Math.max(
            0,
            Math.ceil((attemptDeadlineMsRef.current - Date.now()) / 1000),
          ),
        );
      }

      if (assignment && userData?.uid) {
        persistAttemptProgress();
      }

      if (pendingSubmissionRef.current) {
        setPendingSubmitAfterOnline(true);
        setNextSubmitRetryAt(Date.now());
      } else {
        setResultText((prev) =>
          prev.includes("인터넷 연결이 끊겨") ? "" : prev,
        );
      }
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
  }, [assignment, persistAttemptProgress, userData?.uid]);

  useEffect(() => {
    if (!assignment || !userData?.uid || completed) return undefined;

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
    if (!assignment || completed || submitting) return undefined;

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
  }, [assignment, completed, requestExit, submitting]);

  useEffect(() => {
    if (!assignment || completed || submitting) return undefined;

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
  }, [assignment, completed, requestExit, submitting]);

  useEffect(() => {
    if (!assignment || completed || submitting) return undefined;

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
  }, [assignment, completed, requestExit, submitting]);

  useEffect(() => {
    if (!assignment || completed) return undefined;

    const clearVisibilityCancelTimer = () => {
      if (visibilityCancelTimerRef.current != null) {
        window.clearTimeout(visibilityCancelTimerRef.current);
        visibilityCancelTimerRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") {
        clearVisibilityCancelTimer();
        return;
      }
      if (
        submittingRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;
      if (isScreenRotationGraceActive()) return;
      if (networkOfflineRef.current) return;

      clearVisibilityCancelTimer();
      visibilityCancelTimerRef.current = window.setTimeout(() => {
        visibilityCancelTimerRef.current = null;
        if (document.visibilityState !== "hidden") return;
        if (
          submittingRef.current ||
          completedRef.current ||
          pendingSubmissionRef.current
        )
          return;
        if (isScreenRotationGraceActive()) return;
        if (networkOfflineRef.current) return;
        void handleForcedCancel("visibility-hidden");
      }, VISIBILITY_CANCEL_DELAY_MS);
    };
    const handlePageHide = () => {
      clearVisibilityCancelTimer();
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

    const refreshExitCooldown = (reason: string) => {
      if (
        networkOfflineRef.current ||
        completedRef.current ||
        pendingSubmissionRef.current
      )
        return;
      writeExitCooldownLock(assignment, userData.uid, reason);
    };

    refreshExitCooldown("attempt-active");
    emitSessionActivity();
    const activityTimerId = window.setInterval(emitSessionActivity, 60 * 1000);
    const cooldownTimerId = window.setInterval(
      () => refreshExitCooldown("attempt-active"),
      15000,
    );

    return () => {
      window.clearInterval(activityTimerId);
      window.clearInterval(cooldownTimerId);
      if (!isScreenRotationGraceActive() && !networkOfflineRef.current) {
        refreshExitCooldown("attempt-left");
      }
    };
  }, [
    assignment,
    completed,
    isScreenRotationGraceActive,
    submitting,
    userData,
  ]);

  useEffect(() => {
    if (
      !assignment?.timeLimitMinutes ||
      completed ||
      submitting ||
      isNetworkOffline
    ) {
      return undefined;
    }

    if (!attemptDeadlineMsRef.current) {
      attemptDeadlineMsRef.current =
        Date.now() + assignment.timeLimitMinutes * 60 * 1000;
    }

    const updateRemainingTime = () => {
      const nextRemainingSeconds = Math.max(
        0,
        Math.ceil((attemptDeadlineMsRef.current - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemainingSeconds);
      if (nextRemainingSeconds <= 0) {
        void finalizeExpiredAttempt("time-limit");
      }
    };

    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 1000);

    return () => window.clearInterval(timerId);
  }, [assignment?.timeLimitMinutes, completed, isNetworkOffline, submitting]);

  useEffect(() => {
    if (!assignment || completed || submitting || isNetworkOffline) {
      return undefined;
    }

    const nextRemainingMs = getHistoryClassroomRemainingMs(assignment);
    if (nextRemainingMs == null) {
      setRemainingDueMs(null);
      return undefined;
    }

    const updateDueWindow = () => {
      const remainMs = getHistoryClassroomRemainingMs(assignment) ?? 0;
      setRemainingDueMs(remainMs);
      if (remainMs <= 0) {
        void finalizeExpiredAttempt("due-window");
      }
    };

    updateDueWindow();
    const timerId = window.setInterval(updateDueWindow, 1000);
    return () => window.clearInterval(timerId);
  }, [assignment, completed, isNetworkOffline, submitting]);

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
      completedRef.current ||
      submittingRef.current ||
      pendingSubmissionRef.current
    )
      return;
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
    if (!assignment || !userData) return;
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

      if (!resultSummaryShownRef.current && result.status !== "cancelled") {
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
      setResultText(
        result.status === "cancelled"
          ? "응시가 취소되었습니다. 목록에서 다시 응시할 수 있는 시간을 확인해 주세요."
          : "",
      );
      submittingRef.current = false;
      setSubmitting(false);
      if (result.status !== "cancelled")
        void applyHistoryClassroomPointReward(result.resultId, result.percent);
    } catch (submitError) {
      console.error(submitError);
      retryFailureCountRef.current += 1;
      const retryable =
        networkOfflineRef.current ||
        isHistoryClassroomTransientSaveError(submitError);
      setPendingSubmitAfterOnline(true);
      setNextSubmitRetryAt(
        retryable
          ? Date.now() +
              getHistoryClassroomRetryDelay(retryFailureCountRef.current)
          : null,
      );
      setResultText(
        retryable
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
        onSubmit={() => void submitAnswers()}
        submitting={submitting}
        answersLocked={pendingSubmitAfterOnline}
        submitLabel={pendingSubmitAfterOnline ? "다시 제출" : undefined}
        completed={completed}
        resultText={resultSummary ? "" : resultText}
        pointNotice={pointNotice}
        countdownLabel={countdownLabel}
        timeProgressPercent={timeProgressPercent}
        dueStatusLabel={dueStatus.label}
        dueStatusTone={dueStatus.tone}
      />
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
                {getExitCooldownMinutes(assignment) > 0
                  ? `지금 나가면 현재 응시는 종료되고 재응시까지 ${getExitCooldownDurationLabel()}을 기다려야 합니다. 계속 풀려면 취소를 눌러 주세요.`
                  : "지금 나가면 현재 응시는 종료됩니다. 재응시 제한이 0분이라 바로 다시 응시할 수 있습니다. 계속 풀려면 취소를 눌러 주세요."}
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
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
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
