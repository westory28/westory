import React, { useRef, useState } from "react";

type AuthRecoveryStateProps = {
  registrationPending?: boolean;
  error: { message: string; retryable: boolean } | null;
  onRetry: () => Promise<void>;
  onRestart: () => Promise<void>;
};

const AuthRecoveryState: React.FC<AuthRecoveryStateProps> = ({
  registrationPending = false,
  error,
  onRetry,
  onRestart,
}) => {
  const [pendingAction, setPendingAction] = useState<
    "retry" | "restart" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionInProgress = useRef(false);

  const runAction = async (action: "retry" | "restart") => {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setPendingAction(action);
    setActionError(null);
    try {
      await (action === "retry" ? onRetry() : onRestart());
    } catch {
      setActionError(
        action === "retry"
          ? "로그인 확인을 완료하지 못했습니다. 다시 시도해 주세요."
          : "로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      actionInProgress.current = false;
      setPendingAction(null);
    }
  };

  const canRetry = error?.retryable !== false;
  const busy = pendingAction !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-6">
      <section
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-6 py-5 text-center shadow-sm"
        aria-busy={busy}
      >
        <h1 className="text-xl font-bold text-gray-900">
          {registrationPending
            ? "등록 승인 대기"
            : "로그인을 확인하지 못했습니다"}
        </h1>
        <p
          className="mt-3 break-keep text-base text-gray-700"
          role={registrationPending && !actionError ? "status" : "alert"}
        >
          {actionError ||
            (registrationPending ? "선생님의 등록 승인이 필요합니다." : null) ||
            error?.message ||
            "연결 상태를 확인한 뒤 다시 시도해 주세요."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {canRetry && (
            <button
              type="button"
              className="min-h-11 flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
              disabled={busy}
              onClick={() => void runAction("retry")}
            >
              {pendingAction === "retry" ? "확인 중…" : "다시 확인"}
            </button>
          )}
          <button
            type="button"
            className={`min-h-11 flex-1 rounded-lg px-4 py-3 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${
              canRetry
                ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
            disabled={busy}
            onClick={() => void runAction("restart")}
          >
            {pendingAction === "restart"
              ? "로그아웃 중…"
              : registrationPending
                ? "로그아웃"
                : "다시 로그인"}
          </button>
        </div>
      </section>
    </main>
  );
};

export default AuthRecoveryState;
