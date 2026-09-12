import React from "react";
import StatePanel from "../common/StatePanel";
import { useAuth } from "../../contexts/AuthContext";

const StudentRegistrationPending: React.FC = () => {
  const { logout, userData } = useAuth();
  const rejected = userData?.registrationApprovalStatus === "REJECTED";
  return (
    <main className="ws-access-state">
      <StatePanel
        state="EMPTY"
        title={
          rejected
            ? "이 계정은 수업 등록 대상에서 제외되었습니다."
            : "선생님의 등록 확인을 기다리고 있습니다."
        }
        description={
          rejected
            ? "선생님이 안내한 학교 계정으로 다시 로그인해 주세요. 계정을 확인하기 어려우면 선생님께 문의해 주세요."
            : "입력한 학년·반·번호와 이름을 선생님께 확인해 주세요. 등록이 끝나면 수업 자료와 내 기록을 이용할 수 있습니다."
        }
        action={{
          label: rejected ? "다른 계정으로 로그인" : "등록 상태 다시 확인",
          onClick: () => (rejected ? void logout() : window.location.reload()),
        }}
        secondaryAction={
          rejected
            ? undefined
            : { label: "로그아웃", onClick: () => void logout() }
        }
      />
    </main>
  );
};

export default StudentRegistrationPending;
