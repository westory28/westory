import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getHistoryClassroomAssignedStudentUids,
  getHistoryClassroomRemainingMs,
  isHistoryClassroomAssignedToStudent,
  isHistoryClassroomDeleted,
  isHistoryClassroomPastDue,
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  type HistoryClassroomAssignment,
  type HistoryClassroomResult,
} from "../../../lib/historyClassroom";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";

const formatCooldown = (
  latest: unknown,
  cooldownMinutes: number,
  nowMs: number,
) => {
  if (!latest || cooldownMinutes <= 0) return null;
  const seconds = Number(
    (latest as { seconds?: number } | undefined)?.seconds || 0,
  );
  if (!seconds) return null;
  const availableAt = seconds * 1000 + cooldownMinutes * 60 * 1000;
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

const getResultLabel = (status: HistoryClassroomResult["status"]) => {
  if (status === "passed") return "통과";
  if (status === "failed") return "미통과";
  return "자동 취소";
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
            .sort((left, right) => left.title.localeCompare(right.title, "ko"));

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
          grouped[key].sort(
            (left, right) =>
              Number(
                (right.createdAt as { seconds?: number } | undefined)
                  ?.seconds || 0,
              ) -
              Number(
                (left.createdAt as { seconds?: number } | undefined)?.seconds ||
                  0,
              ),
          );
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

  const cards = useMemo(
    () =>
      assignments.map((assignment) => {
        const attempts = resultsByAssignment[assignment.id] || [];
        const latest = attempts[0];
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
        const dueLabel =
          remainingDueMs == null
            ? "기간 제한 없음"
            : pastDue
              ? "응시 기간 마감"
              : `응시 마감까지 ${formatRemainingDuration(remainingDueMs)}`;
        const attendanceLabel = latest
          ? "제출 완료"
          : pastDue
            ? "미응시"
            : "응시 전";

        return {
          assignment,
          attemptCount: attempts.length,
          latest,
          remainMinutes,
          dueLabel,
          pastDue,
          attendanceLabel,
        };
      }),
    [assignments, nowMs, resultsByAssignment],
  );

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400">
        역사교실을 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-bold text-orange-500">
          학습 &gt; 역사교실
        </div>
        <h1 className="mt-2 text-3xl font-black text-gray-900">역사교실</h1>
        <p className="mt-2 text-sm text-gray-600">
          지도의 빈칸을 채우고 기준 점수 이상이면 통과합니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(
          ({
            assignment,
            attemptCount,
            latest,
            remainMinutes,
            dueLabel,
            pastDue,
            attendanceLabel,
          }) => (
            <div
              key={assignment.id}
              className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-orange-500">
                    {assignment.mapTitle}
                  </div>
                  <h2 className="mt-1 text-xl font-black text-gray-900">
                    {assignment.title}
                  </h2>
                </div>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                  {assignment.blanks.length}문항
                </span>
              </div>

              <p className="mt-3 line-clamp-3 text-sm leading-6 text-gray-600">
                {assignment.description || "설명이 없습니다."}
              </p>

              <div className="mt-4 space-y-1 text-xs text-gray-500">
                <div>
                  배정 학생:{" "}
                  {getHistoryClassroomAssignedStudentUids(assignment).length
                    ? (assignment.targetStudentNames.length
                        ? assignment.targetStudentNames.join(", ")
                        : assignment.targetStudentName) || "배정됨"
                    : "미정"}
                </div>
                <div>통과 기준: {assignment.passThresholdPercent}% 이상</div>
                <div>
                  재응시 제한:{" "}
                  {assignment.cooldownMinutes > 0
                    ? `${assignment.cooldownMinutes}분`
                    : "없음"}
                </div>
                <div>응시 상태: {attendanceLabel}</div>
                <div>{dueLabel}</div>
                <div>응시 기록: {attemptCount}회</div>
                {latest && (
                  <div>
                    최근 결과: {latest.percent}% ·{" "}
                    {getResultLabel(latest.status)}
                  </div>
                )}
              </div>

              <div className="mt-5">
                {remainMinutes ? (
                  <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600">
                    {remainMinutes}분 뒤에 다시 시작할 수 있습니다.
                  </div>
                ) : pastDue ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                    응시 기간이 마감되었습니다.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/student/history-classroom/run?id=${assignment.id}`,
                      )
                    }
                    className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600"
                  >
                    역사교실 시작
                  </button>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {!cards.length && (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-400">
          공개된 역사교실 과제가 없습니다.
        </div>
      )}
    </div>
  );
};

export default HistoryClassroomIndex;
