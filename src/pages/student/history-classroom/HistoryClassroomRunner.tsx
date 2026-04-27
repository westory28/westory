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
  const autoSubmitHandledRef = useRef(false);
  const resultSummaryShownRef = useRef(false);

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
        setResultSummary(null);
        resultSummaryShownRef.current = false;
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
      setResultSummary(null);
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
    <>
      <HistoryClassroomAssignmentView
        assignment={assignment}
        currentPage={currentPage}
        onCurrentPageChange={setCurrentPage}
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
            onClick={() => navigate("/student/history-classroom")}
            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            목록으로
          </button>
        }
      />
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
