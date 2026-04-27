import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomPublishedAtMs,
  getHistoryClassroomRemainingMs,
  getHistoryClassroomTimestampMs,
  isHistoryClassroomAssignedToStudent,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  type HistoryClassroomAssignment,
  type HistoryClassroomResult,
} from "../../../lib/historyClassroom";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";

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
) => {
  if (!latest || cooldownMinutes <= 0) return null;
  const latestMs = getHistoryClassroomTimestampMs(latest);
  if (!latestMs) return null;
  const availableAt = latestMs + cooldownMinutes * 60 * 1000;
  const remainMs = availableAt - nowMs;
  if (remainMs <= 0) return null;
  return Math.ceil(remainMs / 60000);
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

const getResultLabel = (status: HistoryClassroomResult["status"]) => {
  if (status === "passed") return "통과";
  if (status === "failed") return "미통과";
  return "자동 종료";
};

const getStatusMeta = (status: StudentHistoryClassroomStatus) => {
  if (status === "passed") {
    return {
      label: "통과 완료",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
      buttonClassName: "bg-emerald-50 text-emerald-700",
    };
  }
  if (status === "retry") {
    return {
      label: "다시 도전",
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
      buttonClassName: "bg-blue-600 text-white hover:bg-blue-700",
    };
  }
  if (status === "cooldown") {
    return {
      label: "잠시 쉬는 중",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
      buttonClassName: "bg-slate-100 text-slate-500",
    };
  }
  if (status === "closed") {
    return {
      label: "기간 종료",
      badgeClassName: "border-slate-200 bg-slate-50 text-slate-500",
      buttonClassName: "bg-slate-100 text-slate-500",
    };
  }
  return {
    label: "도전 가능",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    buttonClassName: "bg-blue-600 text-white hover:bg-blue-700",
  };
};

const HistoryClassroomIndex: React.FC = () => {
  const { userData, config } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<HistoryClassroomAssignment[]>(
    [],
  );
  const [resultsByAssignment, setResultsByAssignment] = useState<
    Record<string, HistoryClassroomResult[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      if (!userData?.uid) return;
      setLoading(true);
      try {
        const loadAssignedSnapshots = async (collectionPath: string) => {
          const accessFieldPath = `targetStudentAccessMap.${userData.uid}`;
          const [singleTargetSnap, multiTargetSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, collectionPath),
                where("targetStudentUid", "==", userData.uid),
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
                isHistoryClassroomAssignedToStudent(assignment, userData.uid),
            )
            .sort(
              (left, right) =>
                getAssignmentDateMs(right) - getAssignmentDateMs(left) ||
                left.title.localeCompare(right.title, "ko"),
            );

        let loadedAssignments = normalizeVisibleAssignments(
          await loadAssignedSnapshots(
            getSemesterCollectionPath(config, "history_classrooms"),
          ),
        );
        if (!loadedAssignments.length) {
          loadedAssignments = normalizeVisibleAssignments(
            await loadAssignedSnapshots("history_classrooms"),
          );
        }
        setAssignments(loadedAssignments);

        const resultPath = getSemesterCollectionPath(
          config,
          "history_classroom_results",
        );
        let resultSnap = await getDocs(
          query(collection(db, resultPath), where("uid", "==", userData.uid)),
        );
        if (resultSnap.empty) {
          resultSnap = await getDocs(
            query(
              collection(db, "history_classroom_results"),
              where("uid", "==", userData.uid),
            ),
          );
        }

        const grouped: Record<string, HistoryClassroomResult[]> = {};
        resultSnap.docs.forEach((docSnap) => {
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
        setResultsByAssignment(grouped);
      } catch (error) {
        console.error("Failed to load history classroom assignments:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [config, userData?.uid]);

  const classroomItems = useMemo(
    () =>
      assignments.map((assignment) => {
        const attempts = resultsByAssignment[assignment.id] || [];
        const latest = attempts[0] || null;
        const passedAttempt =
          attempts.find(
            (attempt) => attempt.status === "passed" || attempt.passed,
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
        const remainMinutes = formatCooldown(
          latest?.createdAt,
          assignment.cooldownMinutes,
          nowMs,
        );
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
        const dateMs = getAssignmentDateMs(assignment);
        const date = dateMs ? new Date(dateMs) : new Date(0);

        return {
          assignment,
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
          remainMinutes,
          status,
        };
      }),
    [assignments, nowMs, resultsByAssignment],
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
        item.status === "available" ||
        item.status === "retry" ||
        item.status === "cooldown",
    );
    return {
      total: classroomItems.length,
      active: active.length,
      passed: passed.length,
    };
  }, [classroomItems]);

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400">
        역사교실을 불러오는 중입니다.
      </div>
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
            <p className="mt-2 text-sm text-slate-600">
              지도의 빈칸을 채우고 기준 점수 이상이면 통과합니다.
            </p>
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
              className="grid gap-4 md:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div className="relative pl-5 md:pt-4">
                <div className="absolute bottom-0 left-[5px] top-0 w-px bg-slate-200" />
                <div className="absolute left-0 top-2 h-3 w-3 rounded-full border-2 border-blue-500 bg-white shadow-sm md:top-6" />
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
                  const statusMeta = getStatusMeta(item.status);
                  const canStart =
                    item.status === "available" || item.status === "retry";

                  return (
                    <article
                      key={item.assignment.id}
                      className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-black text-slate-950">
                              {item.assignment.title}
                            </h2>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-bold ${statusMeta.badgeClassName}`}
                            >
                              {statusMeta.label}
                            </span>
                            {item.assignment.mapTitle && (
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                {item.assignment.mapTitle}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium text-slate-600">
                            <span>
                              통과 기준 {item.assignment.passThresholdPercent}%
                            </span>
                            <span>
                              제한 시간 {item.assignment.timeLimitMinutes || 0}
                              분
                            </span>
                            <span>
                              재도전 제한 {item.assignment.cooldownMinutes || 0}
                              분
                            </span>
                            <span>{item.dueLabel}</span>
                          </div>

                          {item.assignment.description && (
                            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">
                              {item.assignment.description}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                            <span className="rounded-full bg-slate-50 px-3 py-1">
                              빈칸 {item.assignment.blanks.length}개
                            </span>
                            {item.assignedCount > 0 && (
                              <span className="rounded-full bg-slate-50 px-3 py-1">
                                함께 배정 {item.assignedCount}명
                              </span>
                            )}
                            <span className="rounded-full bg-slate-50 px-3 py-1">
                              시도 {item.attemptCount}회
                            </span>
                            {item.bestPercent != null && (
                              <span className="rounded-full bg-slate-50 px-3 py-1">
                                최고 {item.bestPercent}%
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-3 lg:w-48">
                          {item.passedAttempt ? (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                              {item.passedAttemptNumber}번째 시도 ·{" "}
                              {item.passedAttempt.percent}% 통과
                            </div>
                          ) : item.latest ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                              최근 {item.latest.percent}% ·{" "}
                              {getResultLabel(item.latest.status)}
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                              아직 시작 전
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={!canStart}
                            onClick={() => {
                              if (!canStart) return;
                              navigate(
                                `/student/history-classroom/run?id=${item.assignment.id}`,
                              );
                            }}
                            className={`rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed ${statusMeta.buttonClassName}`}
                          >
                            {item.status === "retry"
                              ? "다시 도전하기"
                              : item.status === "available"
                                ? "응시하기"
                                : item.status === "cooldown"
                                  ? `${item.remainMinutes}분 후 가능`
                                  : statusMeta.label}
                          </button>
                        </div>
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
