import React, { useEffect, useState } from "react";

import {
  getArchiveEnrollmentState,
  type SemesterEnrollmentRecord,
} from "../../../lib/archiveEnrollment";

interface StudentCurrentEnrollmentCardProps {
  studentUid: string;
}

const StudentCurrentEnrollmentCard: React.FC<
  StudentCurrentEnrollmentCardProps
> = ({ studentUid }) => {
  const [enrollment, setEnrollment] = useState<SemesterEnrollmentRecord | null>(
    null,
  );
  const [semesterId, setSemesterId] = useState("");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const state = await getArchiveEnrollmentState({
          source: "CURRENT",
          studentUid,
          callSite: "StudentCurrentEnrollmentCard.mount",
        });
        if (!active) return;
        setSemesterId(state.semesterId);
        setEnrollment(
          state.enrollments.find(
            (item) =>
              item.studentUid === studentUid &&
              item.enrollmentStatus === "ACTIVE",
          ) || null,
        );
        setUnavailable(false);
      } catch {
        if (!active) return;
        setEnrollment(null);
        setUnavailable(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [studentUid]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-500">
        현재 학기 학급 정보를 확인하고 있어요.
      </div>
    );
  }

  if (unavailable || !enrollment) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="text-sm font-extrabold text-amber-900">
          현재 학기 학적을 확인할 수 없습니다.
        </div>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          이전 학생 문서로 자동 전환하지 않았습니다. 학교 관리자에게 현재 학기
          명단 적용 상태를 확인해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
      <div>
        <div className="text-xs font-extrabold text-emerald-700">
          CURRENT · {semesterId}
        </div>
        <div className="mt-1 text-lg font-black text-emerald-950">
          {enrollment.snapshot?.classDisplayName || "현재 학급"}
          {enrollment.studentNumber ? ` · ${enrollment.studentNumber}번` : ""}
        </div>
      </div>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-emerald-800 shadow-sm">
        서버 확인 학적
      </span>
    </div>
  );
};

export default StudentCurrentEnrollmentCard;
