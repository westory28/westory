import React, { useEffect, useState } from "react";

import {
  getArchiveEnrollmentState,
  type SemesterEnrollmentRecord,
} from "../../../lib/archiveEnrollment";
import StatePanel from "../../../components/common/StatePanel";

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
      <StatePanel
        state="LOADING"
        title="현재 학기 학적을 확인하고 있습니다."
        compact
      />
    );
  }

  if (unavailable) {
    return (
      <StatePanel
        state="ERROR"
        title="현재 학기 학적을 확인하지 못했습니다."
        description="이전 학생 문서로 자동 전환하지 않았습니다. 학교 관리자에게 현재 학기 명단 적용 상태를 확인해 주세요."
        contactAdmin
        compact
      />
    );
  }

  if (!enrollment) {
    return (
      <StatePanel
        state="EMPTY"
        title="현재 학기 학적이 아직 등록되지 않았습니다."
        description="학교에서 명단 적용을 마치면 현재 학급과 번호를 확인할 수 있습니다."
        contactAdmin
        compact
      />
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
