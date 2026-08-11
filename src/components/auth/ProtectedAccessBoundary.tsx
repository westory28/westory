import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { ProtectedRouteAccessDecision } from "../../lib/accessControl";
import StatePanel from "../common/StatePanel";

export const ProtectedAccessBoundary: React.FC<{
  decision: ProtectedRouteAccessDecision;
  authenticationError?: string;
  children: React.ReactNode;
}> = ({ decision, authenticationError, children }) => {
  const navigate = useNavigate();
  if (decision.status === "AUTHORIZED") return <>{children}</>;

  if (decision.status === "UNKNOWN" || decision.status === "AUTHENTICATING") {
    return (
      <main className="ws-access-state">
        <StatePanel
          state="LOADING"
          title="인증 상태를 확인하는 중입니다."
          description="로그인 정보와 접근 권한을 확인한 뒤 화면을 열겠습니다."
        />
      </main>
    );
  }

  if (decision.status === "SESSION_EXPIRED") {
    return (
      <main className="ws-access-state">
        <StatePanel
          state="SESSION_EXPIRED"
          title="세션이 만료되었습니다."
          description="보호된 화면과 데이터 연결을 종료했습니다. 다시 로그인해 주세요."
          action={{ label: "다시 로그인", onClick: () => navigate("/") }}
        />
      </main>
    );
  }

  if (decision.status === "ERROR") {
    return (
      <main className="ws-access-state">
        <StatePanel
          state="ERROR"
          title="로그인 상태를 확인하지 못했습니다."
          description={
            authenticationError ||
            "네트워크 상태를 확인한 뒤 로그인 화면에서 다시 시도해 주세요."
          }
          retryable
          action={{ label: "로그인 화면으로", onClick: () => navigate("/") }}
        />
      </main>
    );
  }

  if (decision.reason === "AUTHENTICATION_REQUIRED") {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="ws-access-state">
      <StatePanel
        state="PERMISSION"
        title="접근 권한이 없습니다."
        description="현재 계정으로는 이 화면을 열 수 없습니다. 허용된 화면으로 이동해 주세요."
        contactAdmin
        action={{
          label: "허용된 화면으로 이동",
          onClick: () => navigate(decision.safeRoute || "/", { replace: true }),
        }}
      />
    </main>
  );
};
