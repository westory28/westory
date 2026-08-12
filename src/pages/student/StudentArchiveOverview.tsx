import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SemesterSourceSummary from "../../components/common/SemesterSourceSummary";
import StatePanel from "../../components/common/StatePanel";
import { getServerSemesterCoreState } from "../../lib/semesterCore";
import "../../assets/semesterCutover.css";

const StudentArchiveOverview: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSource = searchParams.get("source")?.toUpperCase();
  const preparing = requestedSource === "PREPARING";
  const semesterId =
    searchParams.get("semesterId")?.trim() || (preparing ? "2026-2" : "2026-1");
  const [state, setState] = useState<"LOADING" | "CONTENT" | "EMPTY" | "ERROR">(
    "LOADING",
  );
  const [semester, setSemester] = useState<{
    semesterId: string;
    provenance: "PREPARING" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
    status: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("LOADING");
    if (preparing) {
      setSemester({
        semesterId,
        provenance: "PREPARING",
        status: "아직 이용할 수 없음",
      });
      setState("CONTENT");
      return () => {
        cancelled = true;
      };
    }
    void getServerSemesterCoreState(semesterId)
      .then((result) => {
        if (cancelled) return;
        if (!result.requested) {
          setSemester(null);
          setState("EMPTY");
          return;
        }
        const provenance =
          result.requested.provenance === "LEGACY"
            ? "LEGACY"
            : result.requested.provenance === "ARCHIVE"
              ? "ARCHIVE"
              : "EXPLICIT";
        setSemester({
          semesterId: result.requested.semesterId,
          provenance,
          status: result.requested.status,
        });
        setState("CONTENT");
      })
      .catch(() => {
        if (!cancelled) setState("ERROR");
      });
    return () => {
      cancelled = true;
    };
  }, [preparing, semesterId]);

  return (
    <div className="ws-student-semester-overview">
      <div className="ws-student-semester-overview__heading">
        <p>{preparing ? "다음 학기" : "지난 학기"}</p>
        <h2>{preparing ? "준비 중인 학기" : "학기별 기록"}</h2>
      </div>

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
          title="확인할 학기 정보가 없습니다."
          description="학기 자료가 준비되면 이곳에서 안내합니다."
          action={{
            label: "현재 마이페이지로 돌아가기",
            onClick: () => navigate("/student/mypage", { replace: true }),
          }}
        />
      )}
      {state === "CONTENT" && semester && (
        <>
          <SemesterSourceSummary
            label={preparing ? "준비 중인 학기" : "지난 학기"}
            semesterId={semester.semesterId}
            provenance={semester.provenance}
            readOnly
            status={semester.status}
            audience="student"
            description={
              preparing
                ? "아직 학습을 시작할 수 없습니다. 새 학기가 열리면 현재 학기로 안내합니다."
                : "이 학기의 기록은 확인만 할 수 있으며 현재 학기 자료와 섞이지 않습니다."
            }
          />
          <StatePanel
            state={preparing ? "DISABLED" : "ARCHIVED"}
            title={
              preparing
                ? "새 학기를 준비하고 있습니다."
                : "지난 학기 기록은 읽기 전용으로 제공합니다."
            }
            description={
              preparing
                ? "준비가 끝날 때까지 현재 학기의 학습과 기록을 이용해 주세요."
                : "과거 자료는 출처와 학기를 유지하며 현재 기록으로 자동 변경하지 않습니다."
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
