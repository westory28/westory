import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
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
  getHistoryClassroomStudentRetryResetMs,
  getHistoryClassroomTimestampMs,
  isHistoryClassroomDeleted,
  isHistoryClassroomBlankCorrect,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
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
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../../lib/semesterScope";

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

const getExitCooldownUntil = (assignment: HistoryClassroomAssignment) =>
  Date.now() + Math.max(1, assignment.cooldownMinutes || 0) * 60 * 1000;

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
  wrongItems: HistoryClassroomResultWrongItem[];
};

const buildHistoryClassroomResultSummary = (
  assignment: HistoryClassroomAssignment,
  answers: Record<string, string>,
  passed: boolean,
  percent: number,
): HistoryClassroomResultModalSummary => {
  let correctCount = 0;
  const wrongItems: HistoryClassroomResultWrongItem[] = [];

  assignment.blanks.forEach((blank, index) => {
    const studentAnswer = answers[blank.id] || "";
    const correctAnswer = blank.answer || "";

    if (isHistoryClassroomBlankCorrect(studentAnswer, correctAnswer)) {
      correctCount += 1;
      return;
    }

    wrongItems.push({
      blankId: blank.id,
      blankNumber: index + 1,
      studentAnswer,
      correctAnswer,
    });
  });

  return {
    total: assignment.blanks.length,
    correctCount,
    wrongCount: assignment.blanks.length - correctCount,
    percent,
    passed,
    passThresholdPercent: assignment.passThresholdPercent,
    wrongItems,
  };
};

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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultSummary, setResultSummary] =
    useState<HistoryClassroomResultModalSummary | null>(null);
  const [pointNotice, setPointNotice] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [remainingDueMs, setRemainingDueMs] = useState<number | null>(null);
  const cancellationInFlightRef = useRef(false);
  const exitNavigationAllowedRef = useRef(false);
  const forcedCancelRef =
    useRef<
      (
        reason: string,
        options?: { redirectTo?: string | null; replace?: boolean },
      ) => Promise<void>
    >();
  const autoSubmitHandledRef = useRef(false);
  const resultSummaryShownRef = useRef(false);
  const attemptDeadlineMsRef = useRef(0);
  const visibilityCancelTimerRef = useRef<number | null>(null);
  const screenRotationGraceUntilRef = useRef(0);
  const viewportOrientationRef = useRef<{
    width: number;
    height: number;
    landscape: boolean;
  } | null>(null);

  useEffect(() => {
    const loadAssignment = async () => {
      if (!assignmentId || !userData?.uid) return;
      setLoading(true);
      setError("");

      try {
        let snap = await getDoc(
          doc(
            db,
            getSemesterDocPath(config, "history_classrooms", assignmentId),
          ),
        );
        if (!snap.exists()) {
          snap = await getDoc(doc(db, `history_classrooms/${assignmentId}`));
        }
        if (!snap.exists()) {
          throw new Error("역사교실 자료를 찾을 수 없습니다.");
        }

        let loaded = normalizeHistoryClassroomAssignment(snap.id, snap.data());
        if (
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
        const latest = attempts[0];
        const passedAttempt = attempts.find(
          (attempt) => attempt.status === "passed" || attempt.passed,
        );

        if (passedAttempt) {
          throw new Error(
            "이미 통과한 역사교실입니다. 목록에서 결과를 확인할 수 있습니다.",
          );
        }

        const resetAtMs = getHistoryClassroomStudentRetryResetMs(
          loaded,
          userData.uid,
        );
        const lastAttemptMs = getHistoryClassroomTimestampMs(latest?.createdAt);
        const shouldSkipServerCooldown =
          !!resetAtMs && !!lastAttemptMs && lastAttemptMs <= resetAtMs;
        if (
          lastAttemptMs &&
          loaded.cooldownMinutes > 0 &&
          !shouldSkipServerCooldown
        ) {
          const availableAt =
            lastAttemptMs + loaded.cooldownMinutes * 60 * 1000;
          if (availableAt > Date.now()) {
            const remain = Math.ceil((availableAt - Date.now()) / 60000);
            throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
          }
        }

        const localAvailableAt = readCooldownLockUntil(
          loaded.id,
          userData.uid,
          resetAtMs,
        );
        const rotationGraceUntil = readRotationGraceUntil(
          loaded.id,
          userData.uid,
        );
        const isRotationResume = rotationGraceUntil > Date.now();
        if (localAvailableAt > Date.now() && !isRotationResume) {
          const remain = Math.ceil((localAvailableAt - Date.now()) / 60000);
          throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
        }
        if (localAvailableAt) {
          clearCooldownLock(loaded.id, userData.uid);
        }

        if (isHistoryClassroomPastDue(loaded)) {
          throw new Error("응시 기간이 마감된 역사교실입니다.");
        }

        const savedAttempt = isRotationResume
          ? readJsonObject(
              readLocalOnly(getAttemptProgressKey(loaded.id, userData.uid)),
            )
          : null;
        const savedDeadlineMs = Number(savedAttempt?.deadlineMs) || 0;
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
        const savedPage = Number(savedAttempt?.currentPage) || 0;
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

        writeCooldownLock(
          loaded.id,
          userData.uid,
          getExitCooldownUntil(loaded),
          "attempt-started",
        );
        if (loaded.timeLimitMinutes > 0) {
          writeLocalOnly(
            getAttemptProgressKey(loaded.id, userData.uid),
            JSON.stringify({
              deadlineMs: nextDeadlineMs,
              currentPage: savedPage || loaded.pdfPageImages?.[0]?.page || 1,
              answers: savedAnswers,
              savedAt: Date.now(),
            }),
          );
        }
        setAssignment(loaded);
        setCurrentPage(savedPage || loaded.pdfPageImages?.[0]?.page || 1);
        setAnswers(savedAnswers);
        setCompleted(false);
        setResultText("");
        setResultSummary(null);
        resultSummaryShownRef.current = false;
        setPointNotice("");
        setRemainingSeconds(initialRemainingSeconds);
        setRemainingDueMs(getHistoryClassroomRemainingMs(loaded));
        cancellationInFlightRef.current = false;
        exitNavigationAllowedRef.current = false;
        autoSubmitHandledRef.current = false;
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
  }, [assignmentId, config, userData?.uid]);

  const saveResult = async (options: {
    status: "passed" | "failed" | "cancelled";
    cancellationReason?: string;
  }) => {
    if (!assignment || !userData) return null;

    const total = assignment.blanks.length;
    const score = assignment.blanks.reduce(
      (sum, blank) =>
        sum +
        (isHistoryClassroomBlankCorrect(answers[blank.id] || "", blank.answer)
          ? 1
          : 0),
      0,
    );
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
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

    console.info("[HistoryClassroomRunner] Saving result", {
      resultCollectionPath,
      assignmentId: assignment.id,
      uid: userData.uid,
      score,
      total,
      percent,
      status,
    });

    const resultRef = await addDoc(collection(db, resultCollectionPath), {
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      uid: userData.uid,
      studentName: userData.name || "",
      studentGrade: String(userData.grade || ""),
      studentClass: String(userData.class || ""),
      studentNumber: String(userData.number || ""),
      answers,
      score,
      total,
      percent,
      passThresholdPercent: assignment.passThresholdPercent,
      passed,
      status,
      cancellationReason: options.cancellationReason || "",
      createdAt: serverTimestamp(),
    });

    void notifyHistoryClassroomSubmitted(config, {
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      resultId: resultRef.id,
      percent,
    }).catch((notificationError) => {
      console.error(
        "Failed to create history classroom submission notification:",
        notificationError,
      );
    });

    clearAttemptProgress(assignment.id, userData.uid);
    attemptDeadlineMsRef.current = 0;

    return { score, total, percent, status, passed, resultId: resultRef.id };
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
    const cooldownMs = Math.max(1, assignment?.cooldownMinutes || 0) * 60000;
    return formatRemainingDuration(cooldownMs);
  }, [assignment?.cooldownMinutes]);

  const getExitWarningMessage = useCallback(
    () =>
      `응시 화면을 나가면 현재 응시는 종료되고 ${getExitCooldownDurationLabel()} 후에 다시 응시할 수 있습니다.\n정말 나가시겠습니까?`,
    [getExitCooldownDurationLabel],
  );

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
  ) => {
    if (
      !assignment ||
      !userData ||
      completed ||
      submitting ||
      cancellationInFlightRef.current
    ) {
      return;
    }

    cancellationInFlightRef.current = true;
    writeCooldownLock(
      assignment.id,
      userData.uid,
      getExitCooldownUntil(assignment),
      reason,
    );

    try {
      await saveResult({ status: "cancelled", cancellationReason: reason });
      setCompleted(true);
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
    } catch (cancelError) {
      console.error("Failed to save cancelled attempt:", cancelError);
    }
  };

  const requestExit = async (
    reason: string,
    redirectTo = "/student/history-classroom",
  ) => {
    if (!assignment || completed || submitting) {
      navigate(redirectTo);
      return;
    }

    if (!window.confirm(getExitWarningMessage())) return;
    await handleForcedCancel(reason, { redirectTo });
  };

  forcedCancelRef.current = handleForcedCancel;

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
    if (!assignment || !userData?.uid || completed || submitting) {
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
  }, [answers, assignment, completed, currentPage, submitting, userData?.uid]);

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
    setSubmitting(true);

    try {
      const result = await saveResult({ status: "failed" });
      setCompleted(true);
      if (!result) return;
      if (!assignment.cooldownMinutes || result.passed) {
        clearCooldownLock(assignment.id, userData.uid);
      } else {
        writeCooldownLock(
          assignment.id,
          userData.uid,
          Date.now() + assignment.cooldownMinutes * 60 * 1000,
          reason,
        );
      }

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
      }
      setResultText("");
      await applyHistoryClassroomPointReward(result.resultId, result.percent);
    } catch (submitError) {
      console.error(submitError);
      setResultText(
        reason === "due-window"
          ? "응시 기간 경과 자동 제출 처리에 실패했습니다."
          : "시간 초과 제출 처리에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!assignment || !userData || completed || submitting) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (exitNavigationAllowedRef.current) return undefined;
      if (isScreenRotationGraceActive()) return undefined;
      writeCooldownLock(
        assignment.id,
        userData.uid,
        getExitCooldownUntil(assignment),
        "beforeunload",
      );
      event.preventDefault();
      event.returnValue = getExitWarningMessage();
      return event.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [
    assignment,
    completed,
    getExitWarningMessage,
    isScreenRotationGraceActive,
    submitting,
    userData,
  ]);

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

    armBackGuard();

    const handlePopState = () => {
      if (exitNavigationAllowedRef.current) return;

      if (!window.confirm(getExitWarningMessage())) {
        armBackGuard();
        return;
      }

      exitNavigationAllowedRef.current = true;
      void (async () => {
        await forcedCancelRef.current?.("browser-back", { redirectTo: null });
        window.history.back();
      })();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      disposed = true;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [assignment, completed, getExitWarningMessage, submitting]);

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

      event.preventDefault();
      event.stopPropagation();
      void requestExit("link-navigation", route);
    };

    document.addEventListener("click", handleLinkClick, true);
    return () => document.removeEventListener("click", handleLinkClick, true);
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
      if (isScreenRotationGraceActive()) return;

      clearVisibilityCancelTimer();
      visibilityCancelTimerRef.current = window.setTimeout(() => {
        visibilityCancelTimerRef.current = null;
        if (document.visibilityState !== "hidden") return;
        if (isScreenRotationGraceActive()) return;
        void handleForcedCancel("visibility-hidden");
      }, VISIBILITY_CANCEL_DELAY_MS);
    };
    const handlePageHide = () => {
      clearVisibilityCancelTimer();
      if (isScreenRotationGraceActive()) return;
      void handleForcedCancel("pagehide");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearVisibilityCancelTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
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
      writeCooldownLock(
        assignment.id,
        userData.uid,
        getExitCooldownUntil(assignment),
        reason,
      );
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
      if (!isScreenRotationGraceActive()) {
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
    if (!assignment?.timeLimitMinutes || completed || submitting) {
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
  }, [assignment?.timeLimitMinutes, completed, submitting]);

  useEffect(() => {
    if (!assignment || completed || submitting) return undefined;

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
  }, [assignment, completed, submitting]);

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
    emitSessionActivity();
    setSubmitting(true);

    try {
      const result = await saveResult({ status: "failed" });
      setCompleted(true);
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
          buildHistoryClassroomResultSummary(
            assignment,
            answers,
            result.passed,
            result.percent,
          ),
        );
      }
      setResultText("");
      await applyHistoryClassroomPointReward(result.resultId, result.percent);
    } catch (submitError) {
      console.error(submitError);
      setResultText("제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageLoading message="역사교실을 준비하는 중입니다." />
    );
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
        onAnswerChange={handleAnswerChange}
        onSubmit={() => void submitAnswers()}
        submitting={submitting}
        completed={completed}
        resultText={resultSummary ? "" : resultText}
        pointNotice={pointNotice}
        countdownLabel={countdownLabel}
        timeProgressPercent={timeProgressPercent}
        dueStatusLabel={dueStatus.label}
        dueStatusTone={dueStatus.tone}
        headerAction={
          <button
            type="button"
            onClick={() => void requestExit("student-navigation")}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            목록으로
          </button>
        }
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
      {resultSummary && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-classroom-result-title"
          onClick={() => {
            setResultSummary(null);
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
                    setResultSummary(null);
                    setResultText("");
                  }}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
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
                  setResultSummary(null);
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
