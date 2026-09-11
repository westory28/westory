import React from "react";
import StatePanel from "../common/StatePanel";
import { useAuth } from "../../contexts/AuthContext";

const StudentRegistrationPending: React.FC = () => {
  const { logout } = useAuth();
  return (
    <main className="ws-access-state">
      <StatePanel
        state="EMPTY"
        title="선생님의 등록 확인을 기다리고 있습니다."
        description="입력한 학년·반·번호와 이름을 선생님께 확인해 주세요. 등록이 끝나면 수업 자료와 내 기록을 이용할 수 있습니다."
        action={{
          label: "등록 상태 다시 확인",
          onClick: () => window.location.reload(),
        }}
        secondaryAction={{ label: "로그아웃", onClick: () => void logout() }}
      />
    </main>
  );
};

export default StudentRegistrationPending;
