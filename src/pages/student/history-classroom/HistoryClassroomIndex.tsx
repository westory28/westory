import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  createHistoryClassroomExemptionRequest,
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomPublishedAtMs,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomStudentRetryResetMs,
  getHistoryClassroomTimestampMs,
  isHistoryClassroomExemptionRequestPending,
  isHistoryClassroomAssignedToStudent,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  normalizeHistoryClassroomExemption,
  normalizeHistoryClassroomExemptionRequest,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  type HistoryClassroomAssignment,
  type HistoryClassroomExemption,
  type HistoryClassroomExemptionRequest,
  type HistoryClassroomResult,
} from "../../../lib/historyClassroom";
import { readLocalOnly, removeStorage } from "../../../lib/safeStorage";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import { readHistoryClassroomPendingSubmission } from "../../../lib/historyClassroomAttemptRecovery";

const HISTORY_CLASSROOM_LOCK_PREFIX = "westoryHistoryClassroomLock";
const HISTORY_CLASSROOM_ATTEMPT_PREFIX = "westoryHistoryClassroomAttempt";

const readPendingRecoveryResultId = (
  assignment: HistoryClassroomAssignment,
  uid: string,
  scope: { year: string; semester: string },
  resetAtMs: number | null,
) => {
  if (!uid) return null;
  try {
    const raw = readLocalOnly(
      `${HISTORY_CLASSROOM_ATTEMPT_PREFIX}:${assignment.id}:${uid}`,
    );
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const retryResetAtMs =
      typeof draft?.retryResetAtMs === "number" &&
      Number.isFinite(draft.retryResetAtMs) &&
      draft.retryResetAtMs >= 0
        ? draft.retryResetAtMs
        : null;
    if (
      !draft ||
      typeof draft !== "object" ||
      Array.isArray(draft) ||
      draft.year !== scope.year ||
      draft.semester !== scope.semester ||
      (draft.uid && draft.uid !== uid) ||
      (draft.assignmentId && draft.assignmentId !== assignment.id) ||
      !Number.isFinite(Number(draft.savedAt)) ||
      Number(draft.savedAt) <= 0 ||
      (resetAtMs &&
        (retryResetAtMs !== null
          ? retryResetAtMs < resetAtMs
          : Number(draft.savedAt) <= resetAtMs)) ||
      typeof draft.resultId !== "string" ||
      !draft.resultId.trim() ||
      draft.resultId.includes("/") ||
      Array.isArray(draft.pendingSubmission?.answers) ||
      !readHistoryClassroomPendingSubmission(draft.pendingSubmission)
    )
      return null;
    return draft.resultId;
  } catch {
    return null;
  }
};
type StudentHistoryClassroomStatus =
  | "available"
  | "retry"
  | "passed"
  | "cooldown"
  | "closed";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  weekday: "long",
});

const formatCooldown = (
  latest: unknown,
  cooldownMinutes: number,
  nowMs: number,
  resetAtMs: number | null = null,
) => {
  if (!latest || cooldownMinutes <= 0) return null;
  const latestMs = getHistoryClassroomTimestampMs(latest);
  if (!latestMs) return null;
  if (resetAtMs && latestMs <= resetAtMs) return null;
  const availableAt = latestMs + cooldownMinutes * 60 * 1000;
  const remainMs = availableAt - nowMs;
  if (remainMs <= 0) return null;
  return Math.ceil(remainMs / 60000);
};

const getCooldownLockKey = (assignmentId: string, uid: string) =>
  `${HISTORY_CLASSROOM_LOCK_PREFIX}:${assignmentId}:${uid}`;

const readCooldownLockRemainMinutes = (
  assignmentId: string,
  uid: string,
  nowMs: number,
  cooldownMinutes: number,
  resetAtMs: number | null = null,
) => {
  const key = getCooldownLockKey(assignmentId, uid);
  if (cooldownMinutes <= 0) {
    removeStorage(key);
    return null;
  }
  const raw = readLocalOnly(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      blockedUntil?: number;
      savedAt?: number;
    };
    const savedAt = Number(parsed.savedAt) || 0;
    if (resetAtMs && savedAt && savedAt <= resetAtMs) {
      removeStorage(key);
      return null;
    }
    const blockedUntil = Number(parsed.blockedUntil) || 0;
    const remainMs = blockedUntil - nowMs;
    if (remainMs > 0) return Math.ceil(remainMs / 60000);
  } catch (error) {
    console.warn("Failed to read history classroom cooldown lock", error);
  }

  removeStorage(key);
  return null;
};

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

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getAssignmentDateMs = (assignment: HistoryClassroomAssignment) =>
  getHistoryClassroomPublishedAtMs(assignment) ??
  getHistoryClassroomTimestampMs(assignment.createdAt) ??
  getHistoryClassroomTimestampMs(assignment.updatedAt) ??
  0;

const compareResultCreatedAt = (
  left: HistoryClassroomResult,
  right: HistoryClassroomResult,
) =>
  (getHistoryClassroomTimestampMs(right.createdAt) || 0) -
  (getHistoryClassroomTimestampMs(left.createdAt) || 0);

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );

const getResultLabel = (status: HistoryClassroomResult["status"]) => {
  if (status === "passed") return "통과";
  if (status === "failed") return "미통과";
  return "자동 종료";
};

const isExemptionAvailableForAssignment = (
  exemption: HistoryClassroomExemption,
  assignmentId: string,
) =>
  exemption.status === "available" &&
  (!exemption.assignmentId || exemption.assignmentId === assignmentId);

const isExemptionUsedForAssignment = (
  exemption: HistoryClassroomExemption,
  assignmentId: string,
) =>
  exemption.status === "used" &&
  (exemption.assignmentId === assignmentId ||
    exemption.usedAssignmentId === assignmentId);

const getStatusMeta = (status: StudentHistoryClassroomStatus) => {
  if (status === "passed") {
    return {
      label: "통과 완료",
      textClassName: "text-emerald-700",
      buttonClassName: "bg-emerald-50 text-emerald-700",
    };
  }
  if (status === "retry") {
    return {
      label: "다시 도전 가능",
      textClassName: "text-blue-700",
      buttonClassName: "bg-blue-600 text-white hover:bg-blue-700",
    };
  }
  if (status === "cooldown") {
    return {
      label: "재도전 대기",
      textClassName: "text-amber-800",
      buttonClassName: "bg-amber-100 text-amber-800",
    };
  }
  if (status === "closed") {
    return {
      label: "응시 기간 종료",
      textClassName: "text-slate-500",
      buttonClassName: "bg-slate-100 text-slate-500",
    };
  }
  return {
    label: "지금 도전 가능",
    textClassName: "text-blue-700",
    buttonClassName: "bg-blue-600 text-white hover:bg-blue-700",
  };
};

const HistoryClassroomIndex: React.FC = () => {
  const { currentUser, userData, config } = useAuth();
  const navigate = useNavigate();
  const studentUid = userData?.uid || currentUser?.uid || "";
  const [assignments, setAssignments] = useState<HistoryClassroomAssignment[]>(
    [],
  );
  const [resultsByAssignment, setResultsByAssignment] = useState<
    Record<string, HistoryClassroomResult[]>
  >({});
  const [exemptions, setExemptions] = useState<HistoryClassroomExemption[]>([]);
  const [exemptionRequests, setExemptionRequests] = useState<
    HistoryClassroomExemptionRequest[]
  >([]);
  const [requestingAssignmentId, setRequestingAssignmentId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribeAssignments: Array<() => void> = [];
    const loadData = async () => {
      if (!studentUid) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const loadAssignedSnapshots = async (collectionPath: string) => {
          const accessFieldPath = `targetStudentAccessMap.${studentUid}`;
          const [singleTargetSnap, multiTargetSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, collectionPath),
                where("targetStudentUid", "==", studentUid),
              ),
            ).catch(() => null),
            getDocs(
              query(
                collection(db, collectionPath),
                where(accessFieldPath, "==", true),
              ),
            ).catch(() => null),
          ]);

          return [
            ...(singleTargetSnap?.docs || []),
            ...(multiTargetSnap?.docs || []),
          ];
        };

        const normalizeVisibleAssignments = (
          assignmentDocs: Awaited<ReturnType<typeof loadAssignedSnapshots>>,
        ) =>
          Array.from(
            new Map(
              assignmentDocs.map((docSnap) => [docSnap.id, docSnap]),
            ).values(),
          )
            .map((docSnap) =>
              normalizeHistoryClassroomAssignment(docSnap.id, docSnap.data()),
            )
            .filter(
              (assignment) =>
                !isHistoryClassroomDeleted(assignment) &&
                assignment.isPublished &&
                isHistoryClassroomAssignedToStudent(assignment, studentUid),
            )
            .sort(
              (left, right) =>
                getAssignmentDateMs(right) - getAssignmentDateMs(left) ||
                left.title.localeCompare(right.title, "ko"),
            );

        let assignmentCollectionPath = getSemesterCollectionPath(
          config,
          "history_classrooms",
        );
        let loadedAssignments = normalizeVisibleAssignments(
          await loadAssignedSnapshots(assignmentCollectionPath),
        );
        if (!loadedAssignments.length) {
          assignmentCollectionPath = "history_classrooms";
          loadedAssignments = normalizeVisibleAssignments(
            await loadAssignedSnapshots(assignmentCollectionPath),
          );
        }
        if (cancelled) return;
        setAssignments(loadedAssignments);
        // Observe only already assigned documents at the source actually read.
        // Teacher retry resets must unlock an open list without a page reload.
        loadedAssignments.forEach((assignment) => {
          unsubscribeAssignments.push(
            onSnapshot(
              doc(db, assignmentCollectionPath, assignment.id),
              (snapshot) => {
                if (cancelled) return;
                const updated = snapshot.exists()
                  ? normalizeHistoryClassroomAssignment(
                      snapshot.id,
                      snapshot.data(),
                    )
                  : null;
                const visible =
                  updated &&
                  !isHistoryClassroomDeleted(updated) &&
                  updated.isPublished &&
                  isHistoryClassroomAssignedToStudent(updated, studentUid);
                setAssignments((previous) => {
                  const remaining = previous.filter(
                    (item) => item.id !== assignment.id,
                  );
                  return (visible ? [...remaining, updated] : remaining).sort(
                    (left, right) =>
                      getAssignmentDateMs(right) - getAssignmentDateMs(left) ||
                      left.title.localeCompare(right.title, "ko"),
                  );
                });
              },
              (error) => {
                if (cancelled) return;
                if (error.code === "permission-denied") {
                  setAssignments((previous) =>
                    previous.filter((item) => item.id !== assignment.id),
                  );
                }
                console.warn(
                  "Failed to refresh assigned history classroom",
                  error,
                );
              },
            ),
          );
        });

        const assignmentIds = loadedAssignments.map((item) => item.id);
        const readResultDocs = async (path: string) => {
          if (!assignmentIds.length) return [];
          try {
            const snapshots = await Promise.all(
              chunk(assignmentIds, 10).map((ids) =>
                getDocs(
                  query(
                    collection(db, path),
                    where("uid", "==", studentUid),
                    where("assignmentId", "in", ids),
                  ),
                ),
              ),
            );
            return snapshots.flatMap((snapshot) => snapshot.docs);
          } catch (error) {
            console.warn(
              "Falling back to broad history classroom result query:",
              error,
            );
            const snapshot = await getDocs(
              query(collection(db, path), where("uid", "==", studentUid)),
            );
            return snapshot.docs.filter((docSnap) =>
              assignmentIds.includes(String(docSnap.data().assignmentId || "")),
            );
          }
        };

        const loadOwnSemesterDocs = async (
          collectionName: string,
          ownerFields: string[],
        ) => {
          const path = getSemesterCollectionPath(config, collectionName);
          const snapshots = await Promise.all(
            ownerFields.map((fieldName) =>
              getDocs(
                query(collection(db, path), where(fieldName, "==", studentUid)),
              ).catch(() => null),
            ),
          );
          return Array.from(
            new Map(
              snapshots
                .flatMap((snapshot) => snapshot?.docs || [])
                .map((docSnap) => [docSnap.id, docSnap]),
            ).values(),
          );
        };

        const [resultDocs, exemptionDocs, requestDocs] = await Promise.all([
          (async () => {
            let docs = await readResultDocs(
              getSemesterCollectionPath(config, "history_classroom_results"),
            );
            if (!docs.length) {
              docs = await readResultDocs("history_classroom_results");
            }
            return docs;
          })(),
          loadOwnSemesterDocs("history_classroom_exemptions", [
            "uid",
            "studentUid",
            "ownerUid",
            "recipientUid",
          ]),
          loadOwnSemesterDocs("history_classroom_exemption_requests", [
            "uid",
            "studentUid",
            "requesterUid",
          ]),
        ]);

        const grouped: Record<string, HistoryClassroomResult[]> = {};
        resultDocs.forEach((docSnap) => {
          const item = normalizeHistoryClassroomResult(
            docSnap.id,
            docSnap.data(),
          );
          grouped[item.assignmentId] = [
            ...(grouped[item.assignmentId] || []),
            item,
          ];
        });
        Object.keys(grouped).forEach((key) => {
          grouped[key].sort(compareResultCreatedAt);
        });
        if (cancelled) return;
        setResultsByAssignment(grouped);
        setExemptions(
          exemptionDocs
            .map((docSnap) =>
              normalizeHistoryClassroomExemption(docSnap.id, docSnap.data()),
            )
            .filter((item) => item.uid === studentUid),
        );
        setExemptionRequests(
          requestDocs
            .map((docSnap) =>
              normalizeHistoryClassroomExemptionRequest(
                docSnap.id,
                docSnap.data(),
              ),
            )
            .filter((item) => item.uid === studentUid),
        );
      } catch (error) {
        console.error("Failed to load history classroom assignments:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();
    return () => {
      cancelled = true;
      unsubscribeAssignments.forEach((unsubscribe) => unsubscribe());
    };
  }, [config, studentUid]);

  const handleRequestExemption = async (
    assignmentId: string,
    exemptionId: string,
  ) => {
    if (!studentUid || requestingAssignmentId) return;

    setRequestingAssignmentId(assignmentId);
    try {
      await createHistoryClassroomExemptionRequest(config, {
        assignmentId,
        exemptionId,
      });

      const requestedAt = new Date();
      setExemptions((previous) =>
        previous.map((exemption) =>
          exemption.id === exemptionId
            ? {
                ...exemption,
                assignmentId: exemption.assignmentId || assignmentId,
                requestedAssignmentId: assignmentId,
                status: "requested",
                requestedAt: exemption.requestedAt || requestedAt,
              }
            : exemption,
        ),
      );
      setExemptionRequests((previous) => [
        {
          id: `local-${assignmentId}-${exemptionId}`,
          uid: studentUid,
          studentName: "",
          assignmentId,
          assignmentTitle: "",
          exemptionId,
          status: "pending",
          createdAt: requestedAt,
        },
        ...previous.filter(
          (request) =>
            request.assignmentId !== assignmentId ||
            request.exemptionId !== exemptionId,
        ),
      ]);
    } catch (error) {
      console.error("Failed to request history classroom exemption:", error);
      window.alert(
        "면제권 사용 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setRequestingAssignmentId(null);
    }
  };

  const classroomItems = useMemo(
    () =>
      assignments.map((assignment) => {
        const attempts = resultsByAssignment[assignment.id] || [];
        const latest = attempts[0] || null;
        const passedAttempt =
          attempts.find(
            (attempt) => attempt.status === "passed" || attempt.passed,
          ) || null;
        const pendingExemptionRequest =
          exemptionRequests.find(
            (request) =>
              request.assignmentId === assignment.id &&
              isHistoryClassroomExemptionRequestPending(request),
          ) || null;
        const requestedExemption =
          exemptions.find(
            (exemption) =>
              exemption.status === "requested" &&
              (exemption.assignmentId === assignment.id ||
                exemption.requestedAssignmentId === assignment.id),
          ) || null;
        const usedExemption =
          exemptions.find((exemption) =>
            isExemptionUsedForAssignment(exemption, assignment.id),
          ) || null;
        const availableExemption =
          exemptions.find((exemption) =>
            isExemptionAvailableForAssignment(exemption, assignment.id),
          ) || null;
        const attemptsAsc = [...attempts].sort(
          (left, right) =>
            (getHistoryClassroomTimestampMs(left.createdAt) || 0) -
            (getHistoryClassroomTimestampMs(right.createdAt) || 0),
        );
        const passedAttemptNumber = passedAttempt
          ? attemptsAsc.findIndex(
              (attempt) => attempt.id === passedAttempt.id,
            ) + 1
          : 0;
        const bestPercent = attempts.length
          ? Math.max(...attempts.map((attempt) => attempt.percent))
          : null;
        const resetAtMs = studentUid
          ? getHistoryClassroomStudentRetryResetMs(assignment, studentUid)
          : null;
        const pendingResultId = readPendingRecoveryResultId(
          assignment,
          studentUid,
          getYearSemester(config),
          resetAtMs,
        );
        const matchingResult = pendingResultId
          ? Object.values(resultsByAssignment)
              .flat()
              .find((attempt) => attempt.id === pendingResultId)
          : null;
        const recoveredResult =
          matchingResult?.uid === studentUid &&
          matchingResult.assignmentId === assignment.id
            ? matchingResult
            : null;
        const canRecoverPending =
          !!pendingResultId &&
          (!matchingResult || !!recoveredResult) &&
          (!!recoveredResult || !passedAttempt);
        const serverRemainMinutes = formatCooldown(
          latest?.createdAt,
          assignment.cooldownMinutes,
          nowMs,
          resetAtMs,
        );
        const localRemainMinutes = studentUid
          ? readCooldownLockRemainMinutes(
              assignment.id,
              studentUid,
              nowMs,
              assignment.cooldownMinutes,
              resetAtMs,
            )
          : null;
        const remainMinutes =
          serverRemainMinutes && localRemainMinutes
            ? Math.max(serverRemainMinutes, localRemainMinutes)
            : serverRemainMinutes || localRemainMinutes;
        const remainingDueMs = getHistoryClassroomRemainingMs(
          assignment,
          nowMs,
        );
        const pastDue = isHistoryClassroomPastDue(assignment, nowMs);
        const status: StudentHistoryClassroomStatus = passedAttempt
          ? "passed"
          : pastDue
            ? "closed"
            : remainMinutes
              ? "cooldown"
              : latest
                ? "retry"
                : "available";
        const assignedCount =
          getHistoryClassroomAssignedStudentUids(assignment).length;
        const assignmentReason = String(
          assignment.targetStudentReasons?.[studentUid] || "",
        ).trim();
        const dateMs = getAssignmentDateMs(assignment);
        const date = dateMs ? new Date(dateMs) : new Date(0);

        return {
          assignment,
          canRecoverPending,
          hasRecoveredResult: !!recoveredResult,
          assignmentReason,
          assignedCount,
          attemptCount: attempts.length,
          bestPercent,
          date,
          dateKey: dateMs ? formatDateKey(date) : "unknown",
          dueLabel:
            remainingDueMs == null
              ? "마감일 없음"
              : pastDue
                ? "기간 종료"
                : `${formatRemainingDuration(remainingDueMs)} 남음`,
          latest,
          passedAttempt,
          passedAttemptNumber,
          exemptionState: pendingExemptionRequest
            ? "requested"
            : requestedExemption
              ? "requested"
              : usedExemption
                ? "used"
                : availableExemption
                  ? "available"
                  : null,
          availableExemption,
          remainMinutes,
          status,
        };
      }),
    [
      assignments,
      config,
      exemptionRequests,
      exemptions,
      nowMs,
      resultsByAssignment,
      studentUid,
    ],
  );

  const groupedItems = useMemo(() => {
    const grouped = new Map<string, typeof classroomItems>();
    classroomItems.forEach((item) => {
      grouped.set(item.dateKey, [...(grouped.get(item.dateKey) || []), item]);
    });
    return Array.from(grouped.entries()).map(([dateKey, items]) => ({
      dateKey,
      date: items[0]?.date || new Date(0),
      items,
    }));
  }, [classroomItems]);

  const summary = useMemo(() => {
    const passed = classroomItems.filter((item) => item.status === "passed");
    const active = classroomItems.filter(
      (item) =>
        (item.canRecoverPending && !item.hasRecoveredResult) ||
        item.status === "available" ||
        item.status === "retry" ||
        item.status === "cooldown",
    );
    return {
      total: classroomItems.length,
      active: active.length,
      passed: passed.length,
      availableExemptions: exemptions.filter(
        (exemption) => exemption.status === "available",
      ).length,
    };
  }, [classroomItems, exemptions]);

  if (loading) {
    return (
      <InlineLoading message="역사교실을 불러오는 중입니다." showWarning />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <section className="mb-6 rounded-[28px] border border-slate-200 bg-white px-6 py-7 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-bold text-orange-500">
              학습 &gt; 역사교실
            </div>
            <h1 className="mt-2 text-3xl font-black text-slate-950">
              역사교실
            </h1>
            <div className="mt-3 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              면제권 {summary.availableExemptions}장 보유
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-2 text-center">
            <div className="min-w-20 rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500">전체</div>
              <div className="text-lg font-black text-slate-950">
                {summary.total}
              </div>
            </div>
            <div className="min-w-20 rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="text-[11px] font-bold text-blue-600">진행</div>
              <div className="text-lg font-black text-blue-700">
                {summary.active}
              </div>
            </div>
            <div className="min-w-20 rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="text-[11px] font-bold text-emerald-600">통과</div>
              <div className="text-lg font-black text-emerald-700">
                {summary.passed}
              </div>
            </div>
          </div>
        </div>
      </section>

      {groupedItems.length > 0 ? (
        <section className="space-y-4">
          {groupedItems.map((group) => (
            <div
              key={group.dateKey}
              className="grid gap-3 lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:gap-4"
            >
              <div className="relative pl-5 lg:pt-4">
                <div className="absolute bottom-0 left-[5px] top-0 w-px bg-slate-200" />
                <div className="absolute left-0 top-2 h-3 w-3 rounded-full border-2 border-blue-500 bg-white shadow-sm lg:top-6" />
                <div className="text-lg font-black text-slate-950">
                  {group.dateKey === "unknown"
                    ? "날짜 없음"
                    : dateFormatter.format(group.date)}
                </div>
                {group.dateKey !== "unknown" && (
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    {weekdayFormatter.format(group.date)}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {group.items.map((item) => {
                  const statusMeta = getStatusMeta(
                    item.canRecoverPending ? "available" : item.status,
                  );
                  const canStart =
                    item.canRecoverPending ||
                    item.status === "available" ||
                    item.status === "retry";
                  const canRequestExemption =
                    !item.canRecoverPending &&
                    !item.passedAttempt &&
                    item.exemptionState === "available" &&
                    Boolean(item.availableExemption);
                  const isRequestingExemption =
                    requestingAssignmentId === item.assignment.id;
                  const lessonPath = [
                    ...(item.assignment.lessonUnitPath || []),
                  ];
                  if (
                    lessonPath.at(-1)?.trim() === item.assignment.title.trim()
                  )
                    lessonPath.pop();
                  const lessonBreadcrumb =
                    lessonPath.join(" > ") ||
                    (!item.assignment.lessonUnitPath?.length &&
                    item.assignment.lessonTitle !== item.assignment.title
                      ? item.assignment.lessonTitle
                      : "");

                  return (
                    <article
                      key={item.assignment.id}
                      className="flex flex-col gap-2 rounded-[24px] border border-slate-200 bg-white px-5 py-3 shadow-sm transition hover:border-blue-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-black text-slate-950 [overflow-wrap:anywhere]">
                          {item.assignment.title}
                        </h2>
                        {item.assignment.sourceType === "lesson" &&
                          lessonBreadcrumb && (
                            <p className="mt-1 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                              {lessonBreadcrumb}
                            </p>
                          )}
                        <dl
                          data-history-primary-info="true"
                          className="my-2 grid grid-cols-3 divide-x divide-slate-200"
                        >
                          <div className="min-w-0 pr-3">
                            <dt className="text-xs text-slate-500">문제</dt>
                            <dd className="mt-1 text-lg font-bold text-slate-900">
                              {item.assignment.blanks.length}문제
                            </dd>
                          </div>
                          <div className="min-w-0 px-3">
                            <dt className="text-xs text-slate-500">
                              제한 시간
                            </dt>
                            <dd className="mt-1 text-lg font-bold text-slate-900">
                              {item.assignment.timeLimitMinutes > 0
                                ? `${item.assignment.timeLimitMinutes}분`
                                : "없음"}
                            </dd>
                          </div>
                          <div className="min-w-0 pl-3">
                            <dt className="text-xs text-slate-500">
                              통과 기준
                            </dt>
                            <dd className="mt-1 text-lg font-bold text-slate-900">
                              {item.assignment.passThresholdPercent}%
                            </dd>
                          </div>
                        </dl>
                        {(item.assignmentReason ||
                          item.assignment.description) && (
                          <p className="text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">
                            {item.assignmentReason ||
                              item.assignment.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-slate-500">
                          <span>
                            재도전 제한 {item.assignment.cooldownMinutes || 0}분
                          </span>
                          <span>{item.dueLabel}</span>
                          <span>
                            시도 {item.attemptCount}회
                            {item.bestPercent != null
                              ? ` · 최고 ${item.bestPercent}%`
                              : ""}
                          </span>
                          {item.passedAttempt ? (
                            <span>
                              {item.passedAttempt.score}/
                              {item.passedAttempt.total}문제 ·{" "}
                              {item.passedAttemptNumber}번째 시도
                            </span>
                          ) : (
                            item.latest && (
                              <span>
                                최근 {item.latest.score}/{item.latest.total}문제
                                · {getResultLabel(item.latest.status)}
                              </span>
                            )
                          )}
                        </div>
                        <div
                          data-history-status-panel="true"
                          className="mt-2 flex flex-wrap items-center gap-2"
                        >
                          <div
                            className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${statusMeta.textClassName}`}
                          >
                            <div className="flex items-center gap-2">
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-5 w-5 shrink-0"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                {item.canRecoverPending ? (
                                  <>
                                    <path d="M4 7v5h5M20 17v-5h-5" />
                                    <path d="M6 17a7 7 0 0 0 12-1M18 7A7 7 0 0 0 6 8" />
                                  </>
                                ) : item.status === "cooldown" ? (
                                  <>
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="M12 7v5l3 2" />
                                  </>
                                ) : item.status === "passed" ? (
                                  <>
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="m8 12 3 3 5-6" />
                                  </>
                                ) : item.status === "closed" ? (
                                  <>
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="m9 9 6 6m0-6-6 6" />
                                  </>
                                ) : (
                                  <path d="m8 4 12 8-12 8Z" />
                                )}
                              </svg>
                              <div className="text-base font-bold leading-6">
                                {item.canRecoverPending
                                  ? item.hasRecoveredResult
                                    ? "제출 완료"
                                    : "제출 대기"
                                  : statusMeta.label}
                              </div>
                            </div>
                            {!item.canRecoverPending &&
                              item.status === "cooldown" && (
                                <div
                                  role="timer"
                                  aria-label="재도전까지 남은 시간"
                                  className="text-base font-semibold tabular-nums"
                                >
                                  약 {item.remainMinutes}분 후 가능
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                      <div
                        data-history-actions="true"
                        className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-end empty:hidden sm:max-w-40 sm:flex-col sm:items-stretch sm:self-center"
                      >
                        {canStart && (
                          <button
                            type="button"
                            disabled={!canStart}
                            onClick={() => {
                              if (!canStart) return;
                              navigate(
                                `/student/history-classroom/run?id=${item.assignment.id}`,
                              );
                            }}
                            className={`min-h-11 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed ${item.canRecoverPending ? getStatusMeta("available").buttonClassName : statusMeta.buttonClassName}`}
                          >
                            {item.canRecoverPending
                              ? item.hasRecoveredResult
                                ? "제출 결과 확인"
                                : "제출 재시도"
                              : item.status === "retry"
                                ? "다시 도전하기"
                                : item.status === "available"
                                  ? "응시하기"
                                  : statusMeta.label}
                          </button>
                        )}

                        {canRequestExemption && item.availableExemption && (
                          <button
                            type="button"
                            disabled={Boolean(requestingAssignmentId)}
                            onClick={() => {
                              if (!item.availableExemption) return;
                              void handleRequestExemption(
                                item.assignment.id,
                                item.availableExemption.id,
                              );
                            }}
                            className="min-h-11 whitespace-nowrap rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-xs font-bold leading-5 text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            {isRequestingExemption
                              ? "요청 보내는 중"
                              : "면제권 사용 요청"}
                          </button>
                        )}

                        {!item.passedAttempt &&
                          item.exemptionState === "requested" && (
                            <div className="text-sm font-semibold text-indigo-700">
                              면제권 사용 요청 중
                            </div>
                          )}

                        {!item.passedAttempt &&
                          item.exemptionState === "used" && (
                            <div className="text-sm font-semibold text-emerald-700">
                              면제권 사용됨
                            </div>
                          )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
          공개된 역사교실 과제가 없습니다.
        </div>
      )}
    </div>
  );
};

export default HistoryClassroomIndex;
