import React, { useEffect, useState } from "react";

import {
  getArchiveEnrollmentState,
  type SemesterEnrollmentRecord,
} from "../../../lib/archiveEnrollment";
import StatePanel from "../../../components/common/StatePanel";
import SemesterSourceSummary from "../../../components/common/SemesterSourceSummary";
import "../../../assets/semesterCutover.css";

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
    <div className="ws-student-current-enrollment">
      <SemesterSourceSummary
        label="현재 학기"
        semesterId={semesterId}
        provenance="CURRENT"
        readOnly
        audience="student"
        description="지금 이용 중인 학기와 학적입니다."
      />
      <div className="ws-student-current-enrollment__detail">
        <div>
          <strong>
            {enrollment.snapshot?.classDisplayName || "현재 학급"}
            {enrollment.studentNumber ? ` · ${enrollment.studentNumber}번` : ""}
          </strong>
          <span>서버에서 확인한 현재 학적</span>
        </div>
      </div>
    </div>
  );
};

export default StudentCurrentEnrollmentCard;
