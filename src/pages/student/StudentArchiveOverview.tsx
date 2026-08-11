import React from "react";
import { useNavigate } from "react-router-dom";
import StatePanel from "../../components/common/StatePanel";

const StudentArchiveOverview: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-5 py-8 sm:px-8 lg:py-12">
      <div>
        <p className="text-sm font-extrabold text-blue-700">지난 학기</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950 md:text-3xl">
          학기별 기록
        </h1>
      </div>
      <StatePanel
        state="ARCHIVED"
        title="지난 학기 기록은 읽기 전용으로 제공합니다."
        description="현재 학적은 canonical Enrollment로 확인하고 있습니다. 과거 학습·평가 자료는 각 담당 Wave에서 출처와 학기를 보존한 뒤 이곳에 연결합니다."
        readOnly
        action={{
          label: "현재 마이페이지로 돌아가기",
          onClick: () => navigate("/student/mypage", { replace: true }),
        }}
      />
    </div>
  );
};

export default StudentArchiveOverview;
