import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import { db } from "../../../lib/firebase";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomRemainingMs,
  isHistoryClassroomDeleted,
  isHistoryClassroomBlankCorrect,
  isHistoryClassroomPastDue,
  mergeHistoryClassroomMapSnapshot,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  type HistoryClassroomAssignment,
} from "../../../lib/historyClassroom";
import { normalizeMapResource } from "../../../lib/mapResources";
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

const readCooldownLockUntil = (assignmentId: string, uid: string): number => {
  const raw = readLocalOnly(getCooldownLockKey(assignmentId, uid));
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as { blockedUntil?: number };
    const blockedUntil = Number(parsed.blockedUntil) || 0;
    if (blockedUntil > Date.now()) return blockedUntil;
  } catch (error) {
    console.warn("Failed to read history classroom cooldown lock", error);
  }

  removeStorage(getCooldownLockKey(assignmentId, uid));
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

const clearCooldownLock = (assignmentId: string, uid: string) => {
  removeStorage(getCooldownLockKey(assignmentId, uid));
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
  const [pointNotice, setPointNotice] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [remainingDueMs, setRemainingDueMs] = useState<number | null>(null);
  const cancellationInFlightRef = useRef(false);
  const autoSubmitHandledRef = useRef(false);

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

        const latest = resultSnap.docs
          .map((docSnap) =>
            normalizeHistoryClassroomResult(docSnap.id, docSnap.data()),
          )
          .sort(
            (left, right) =>
              Number(
                (right.createdAt as { seconds?: number } | undefined)
                  ?.seconds || 0,
              ) -
              Number(
                (left.createdAt as { seconds?: number } | undefined)?.seconds ||
                  0,
              ),
          )[0];

        const lastSeconds = Number(
          (latest?.createdAt as { seconds?: number } | undefined)?.seconds || 0,
        );
        if (lastSeconds && loaded.cooldownMinutes > 0) {
          const availableAt =
            lastSeconds * 1000 + loaded.cooldownMinutes * 60 * 1000;
          if (availableAt > Date.now()) {
            const remain = Math.ceil((availableAt - Date.now()) / 60000);
            throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
          }
        }

        const localAvailableAt = readCooldownLockUntil(loaded.id, userData.uid);
        if (localAvailableAt > Date.now()) {
          const remain = Math.ceil((localAvailableAt - Date.now()) / 60000);
          throw new Error(`${remain}분 후 다시 응시할 수 있습니다.`);
        }
        if (localAvailableAt) {
          clearCooldownLock(loaded.id, userData.uid);
        }

        if (isHistoryClassroomPastDue(loaded)) {
          throw new Error("응시 기간이 마감된 역사교실입니다.");
        }

        setAssignment(loaded);
        setCurrentPage(loaded.pdfPageImages?.[0]?.page || 1);
        setAnswers({});
        setCompleted(false);
        setResultText("");
        setPointNotice("");
        setRemainingSeconds(
          loaded.timeLimitMinutes > 0 ? loaded.timeLimitMinutes * 60 : null,
        );
        setRemainingDueMs(getHistoryClassroomRemainingMs(loaded));
        cancellationInFlightRef.current = false;
        autoSubmitHandledRef.current = false;
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

  const handleForcedCancel = async (reason: string) => {
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
    if (assignment.cooldownMinutes > 0) {
      writeCooldownLock(
        assignment.id,
        userData.uid,
        Date.now() + assignment.cooldownMinutes * 60 * 1000,
        reason,
      );
    }

    try {
      await saveResult({ status: "cancelled", cancellationReason: reason });
      setCompleted(true);
      setResultText(
        "화면 이탈로 응시가 자동 취소되었습니다. 재응시 제한이 시작됩니다.",
      );
      navigate("/student/history-classroom", { replace: true });
    } catch (cancelError) {
      console.error("Failed to save cancelled attempt:", cancelError);
    }
  };

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

      const statusLabel = result.status === "passed" ? "통과" : "미통과";
      setResultText(
        reason === "due-window"
          ? `응시 기간이 지나 자동 제출되었습니다. ${result.score}/${result.total} (${result.percent}%) · ${statusLabel}`
          : `제한 시간이 종료되어 자동 제출되었습니다. ${result.score}/${result.total} (${result.percent}%) · ${statusLabel}`,
      );
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
    if (!assignment || completed) return undefined;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void handleForcedCancel("visibility-hidden");
      }
    };
    const handlePageHide = () => {
      void handleForcedCancel("pagehide");
    };
    const handleBlur = () => {
      window.setTimeout(() => {
        if (!document.hasFocus()) {
          void handleForcedCancel("window-blur");
        }
      }, 0);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("blur", handleBlur);
    };
  }, [assignment, completed, navigate, submitting, userData]);

  useEffect(() => {
    if (!assignment?.timeLimitMinutes || completed || submitting) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev == null) return prev;
        if (prev <= 1) {
          window.clearInterval(timerId);
          void finalizeExpiredAttempt("time-limit");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

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
    setAnswers((prev) => ({ ...prev, [blankId]: value }));
  };

  const submitAnswers = async () => {
    if (!assignment || !userData) return;
    emitSessionActivity();
    setSubmitting(true);

    try {
      const result = await saveResult({ status: "failed" });
      setCompleted(true);
      if (!result) return;

      const statusLabel = result.status === "passed" ? "통과" : "미통과";
      setResultText(
        `제출 완료: ${result.score}/${result.total} (${result.percent}%) · ${statusLabel}`,
      );
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
      <div className="p-10 text-center text-gray-400">
        역사교실을 준비하는 중입니다.
      </div>
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
    <HistoryClassroomAssignmentView
      assignment={assignment}
      currentPage={currentPage}
      onCurrentPageChange={setCurrentPage}
      answers={answers}
      interactiveViewport
      resolveBlankOverlap
      onAnswerChange={handleAnswerChange}
      onSubmit={() => void submitAnswers()}
      submitting={submitting}
      completed={completed}
      resultText={resultText}
      pointNotice={pointNotice}
      countdownLabel={countdownLabel}
      timeProgressPercent={timeProgressPercent}
      dueStatusLabel={dueStatus.label}
      dueStatusTone={dueStatus.tone}
      headerAction={
        <button
          type="button"
          onClick={() => navigate("/student/history-classroom")}
          className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          목록으로
        </button>
      }
    />
  );
};

export default HistoryClassroomRunner;
