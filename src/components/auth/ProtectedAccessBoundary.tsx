import React from "react";
import { Link, Navigate } from "react-router-dom";
import type { ProtectedRouteAccessDecision } from "../../lib/accessControl";

interface AccessStateViewProps {
  title: string;
  message: string;
  tone?: "neutral" | "warning";
  action?: React.ReactNode;
}

const AccessStateView: React.FC<AccessStateViewProps> = ({
  title,
  message,
  tone = "neutral",
  action,
}) => (
  <main className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-gray-50 px-4 py-10">
    <section
      className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8"
      role={tone === "warning" ? "alert" : "status"}
      aria-live={tone === "warning" ? "assertive" : "polite"}
      aria-busy={tone === "neutral" ? true : undefined}
    >
      <div
        className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl ${
          tone === "warning"
            ? "bg-amber-100 text-amber-700"
            : "bg-blue-100 text-blue-700"
        }`}
        aria-hidden="true"
      >
        <i
          className={
            tone === "warning"
              ? "fas fa-shield-halved"
              : "fas fa-circle-notch fa-spin"
          }
        />
      </div>
      <h1 className="text-xl font-extrabold text-gray-900">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-gray-600">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  </main>
);

const AccessActionLink: React.FC<{
  to: string;
  children: React.ReactNode;
}> = ({ to, children }) => (
  <Link
    to={to}
    replace
    autoFocus
    className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
  >
    {children}
  </Link>
);

export const ProtectedAccessBoundary: React.FC<{
  decision: ProtectedRouteAccessDecision;
  authenticationError?: string;
  children: React.ReactNode;
}> = ({ decision, authenticationError, children }) => {
  if (decision.status === "AUTHORIZED") return <>{children}</>;

  if (decision.status === "UNKNOWN" || decision.status === "AUTHENTICATING") {
    return (
      <AccessStateView
        title="인증 상태를 확인하는 중입니다."
        message="로그인 정보와 접근 권한을 확인한 뒤 화면을 열겠습니다."
      />
    );
  }

  if (decision.status === "SESSION_EXPIRED") {
    return (
      <AccessStateView
        title="세션이 만료되었습니다."
        message="보호된 화면과 데이터 연결을 종료했습니다. 다시 로그인해 주세요."
        tone="warning"
        action={<AccessActionLink to="/">다시 로그인</AccessActionLink>}
      />
    );
  }

  if (decision.status === "ERROR") {
    return (
      <AccessStateView
        title="로그인 상태를 확인하지 못했습니다."
        message={
          authenticationError ||
          "네트워크 상태를 확인한 뒤 로그인 화면에서 다시 시도해 주세요."
        }
        tone="warning"
        action={<AccessActionLink to="/">로그인 화면으로</AccessActionLink>}
      />
    );
  }

  if (decision.reason === "AUTHENTICATION_REQUIRED") {
    return <Navigate to="/" replace />;
  }

  return (
    <AccessStateView
      title="접근 권한이 없습니다."
      message="현재 계정으로는 이 화면을 열 수 없습니다. 허용된 화면으로 이동해 주세요."
      tone="warning"
      action={
        <AccessActionLink to={decision.safeRoute || "/"}>
          허용된 화면으로 이동
        </AccessActionLink>
      }
    />
  );
};
