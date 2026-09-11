import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SemesterSourceSummary from "../../components/common/SemesterSourceSummary";
import StatePanel from "../../components/common/StatePanel";
import { useAuth } from "../../contexts/AuthContext";
import {
  loadStudentSemesterArchive,
  type StudentSemesterArchiveNotice,
} from "../../lib/studentSemesterArchive";
import "../../assets/semesterCutover.css";
import StudentCurrentEnrollmentCard from "./components/StudentCurrentEnrollmentCard";

const StudentArchiveOverview: React.FC = () => {
  const { currentUser, config } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSource = searchParams.get("source")?.toUpperCase();
  const preparing = requestedSource === "PREPARING";
  const semesterId = searchParams.get("semesterId")?.trim() || undefined;
  const currentSemesterId =
    config?.year && config?.semester ? `${config.year}-${config.semester}` : "";
  const [state, setState] = useState<"LOADING" | "CONTENT" | "EMPTY" | "ERROR">(
    "LOADING",
  );
  const [semesters, setSemesters] = useState<StudentSemesterArchiveNotice[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setState("LOADING");
    setSemesters([]);
    if (preparing) {
      setState("CONTENT");
      return () => {
        cancelled = true;
      };
    }
    if (!currentUser?.uid || !currentSemesterId)
      return () => {
        cancelled = true;
      };
    void loadStudentSemesterArchive({
      studentUid: currentUser.uid,
      currentSemesterId,
      semesterId,
    })
      .then((result) => {
        if (cancelled) return;
        setSemesters(result);
        setState(result.length ? "CONTENT" : "EMPTY");
      })
      .catch(() => {
        if (!cancelled) setState("ERROR");
      });
    return () => {
      cancelled = true;
    };
  }, [preparing, semesterId, currentSemesterId, currentUser?.uid]);

  return (
    <div className="ws-student-semester-overview">
      <div className="ws-student-semester-overview__heading">
        <p>{preparing ? "다음 학기" : "지난 학기"}</p>
        <h2>{preparing ? "준비 중인 학기" : "지난 학기 안내"}</h2>
      </div>

      {!preparing && currentUser?.uid && (
        <StudentCurrentEnrollmentCard studentUid={currentUser.uid} />
      )}

      {state === "LOADING" && (
        <StatePanel
          state="LOADING"
          title="학기 정보를 확인하고 있습니다."
          compact
        />
      )}
      {state === "ERROR" && (
        <StatePanel
          state="ERROR"
          title="학기 정보를 불러오지 못했습니다."
          description="현재 학기 화면으로 돌아가거나 잠시 뒤 다시 확인해 주세요."
          action={{
            label: "현재 마이페이지로 돌아가기",
            onClick: () => navigate("/student/mypage", { replace: true }),
          }}
        />
      )}
      {state === "EMPTY" && (
        <StatePanel
          state="EMPTY"
          title="확인할 지난 학기 안내가 없습니다."
          description="지난 학기의 안내가 준비되면 이곳에 표시됩니다."
          action={{
            label: "현재 마이페이지로 돌아가기",
            onClick: () => navigate("/student/mypage", { replace: true }),
          }}
        />
      )}
      {state === "CONTENT" && (
        <>
          {semesters.map((semester) => (
            <SemesterSourceSummary
              key={semester.semesterId}
              label="지난 학기 안내"
              semesterId={semester.semesterId}
              provenance={semester.provenance}
              readOnly
              status={semester.status}
              audience="student"
              description="학교의 지난 학기 안내입니다. 개인 학습 기록의 조회 여부와는 별개입니다."
            />
          ))}
          <StatePanel
            state={preparing ? "DISABLED" : "ARCHIVED"}
            title={
              preparing
                ? "새 학기를 준비하고 있습니다."
                : "지난 학기 안내를 확인하고 있습니다."
            }
            description={
              preparing
                ? "준비가 끝날 때까지 현재 학기의 학습과 기록을 이용해 주세요."
                : "현재는 학기 안내만 표시됩니다. 개인 학습 기록은 선생님에게 확인해 주세요."
            }
            readOnly
            action={{
              label: "현재 마이페이지로 돌아가기",
              onClick: () => navigate("/student/mypage", { replace: true }),
            }}
          />
        </>
      )}
    </div>
  );
};

export default StudentArchiveOverview;
