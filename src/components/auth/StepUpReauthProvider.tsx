import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getIdToken,
  getIdTokenResult,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";
import { auth } from "../../lib/firebase";
import { openApplicationSession } from "../../lib/applicationSession";
import { registerStepUpReauthHandler } from "../../lib/stepUpReauth";
import type { StepUpRequestOptions } from "../../lib/stepUpReauth";
import {
  NORMAL_SESSION_DURATION_MS,
  writeSessionDeadline,
} from "../../lib/sessionPolicy";

const RECENT_AUTH_MS = 5 * 60 * 1000;

interface PendingRequest {
  commandName: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

const commandLabel = (commandName: string) => {
  const labels: Record<string, string> = {
    deleteStudentData: "학생 계정과 연결 기록 삭제",
    resetLessonCorePointProgress: "수업 학습 기록 초기화",
    updateStudentData: "학생 정보 변경",
    resetAssessmentAttemptsByClass: "평가 응시 기록 초기화",
    resetQuizAttemptsForClass: "퀴즈 응시 기록 초기화",
    recalculateQuizResultsAfterQuestionCorrection: "평가 결과 재계산",
    adjustTeacherPoints: "위스 수동 조정",
    updateTeacherPointAdjustment: "위스 조정 내역 수정",
    reviewTeacherPointOrder: "위스 주문 상태 변경",
    rebuildPointWalletRankTotals: "위스 지갑·순위 재계산",
    deleteSourceArchiveAsset: "사료 원본 삭제",
    updateAccessSettings: "사용자 접근 권한 변경",
    createSemesterShell: "새 학기 운영 영역 생성",
    updateOperationalSettings: "학기·운영 설정 변경",
    updateInterfaceSettings: "화면 설정 변경",
    updateMenuSettings: "메뉴 설정 변경",
    updateNotificationSettings: "알림 설정 변경",
    updateTermsSettings: "이용약관 변경",
    updatePrivacySettings: "개인정보 처리방침 변경",
    updateConsentSettings: "동의 항목 변경",
    updateSchoolSettings: "학교 구조 설정 변경",
  };
  return labels[commandName] || "보호된 운영 작업";
};

const hasRecentAuth = async () => {
  const user = auth.currentUser;
  if (!user) return false;
  const token = await getIdTokenResult(user);
  const authTimeMs = Date.parse(token.authTime);
  return (
    Number.isFinite(authTimeMs) && Date.now() - authTimeMs <= RECENT_AUTH_MS
  );
};

export const StepUpReauthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const requestReauth = useCallback(
    async (commandName: string, options?: StepUpRequestOptions) => {
      if (!options?.force && (await hasRecentAuth())) return;
      if (pendingRef.current) {
        throw new Error("다른 재인증 요청이 진행 중입니다.");
      }
      await new Promise<void>((resolve, reject) => {
        setPassword("");
        setErrorMessage("");
        setPending({ commandName, resolve, reject });
      });
    },
    [],
  );

  useEffect(() => registerStepUpReauthHandler(requestReauth), [requestReauth]);

  useEffect(
    () => () => {
      pendingRef.current?.reject(new Error("재인증 화면이 닫혔습니다."));
    },
    [],
  );

  const finishSuccess = async () => {
    const current = pendingRef.current;
    const user = auth.currentUser;
    if (!current || !user)
      throw new Error("로그인 사용자를 확인할 수 없습니다.");
    await getIdToken(user, true);
    const session = await openApplicationSession();
    writeSessionDeadline(session.generalExpiresAt, {
      durationMs: NORMAL_SESSION_DURATION_MS,
    });
    current.resolve();
    setPending(null);
    setPassword("");
    setErrorMessage("");
  };

  const handlePasswordReauth = async (event: React.FormEvent) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user?.email || !pending || !password) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      await finishSuccess();
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || "");
      setErrorMessage(
        code === "auth/wrong-password" || code === "auth/invalid-credential"
          ? "비밀번호가 올바르지 않습니다."
          : "재인증하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleReauth = async () => {
    const user = auth.currentUser;
    if (!user || !pending) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: user.email || "" });
      await reauthenticateWithPopup(user, provider);
      await finishSuccess();
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || "");
      setErrorMessage(
        code === "auth/popup-closed-by-user" ||
          code === "auth/cancelled-popup-request"
          ? "재인증이 취소되었습니다. 작업은 실행되지 않았습니다."
          : "Google 재인증을 완료하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = () => {
    const current = pendingRef.current;
    current?.reject(new Error("재인증이 취소되어 작업을 실행하지 않았습니다."));
    setPending(null);
    setPassword("");
    setErrorMessage("");
  };

  const providerIds =
    auth.currentUser?.providerData.map((item) => item.providerId) || [];
  const supportsPassword = providerIds.includes("password");
  const supportsGoogle = providerIds.includes("google.com");

  return (
    <>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[280] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="step-up-title"
            className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl"
          >
            <h2
              id="step-up-title"
              className="text-lg font-extrabold text-stone-900"
            >
              본인 확인이 필요합니다
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {commandLabel(pending.commandName)} 작업을 실행하기 전에 다시
              로그인해 주세요. 확인 후 5분 동안 보호된 작업을 실행할 수
              있습니다.
            </p>

            {supportsPassword && (
              <form className="mt-5 space-y-3" onSubmit={handlePasswordReauth}>
                <label
                  className="block text-sm font-bold text-stone-800"
                  htmlFor="step-up-password"
                >
                  현재 비밀번호
                </label>
                <input
                  id="step-up-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2.5"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!password || submitting}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white disabled:opacity-50"
                >
                  {submitting ? "확인 중…" : "비밀번호로 확인"}
                </button>
              </form>
            )}

            {supportsGoogle && (
              <button
                type="button"
                onClick={handleGoogleReauth}
                disabled={submitting}
                className="mt-4 w-full rounded-lg border border-stone-300 px-4 py-2.5 font-bold text-stone-800 disabled:opacity-50"
              >
                Google 계정으로 다시 확인
              </button>
            )}

            {!supportsPassword && !supportsGoogle && (
              <p className="mt-4 text-sm text-red-700" role="alert">
                현재 로그인 방식은 재인증을 지원하지 않습니다. 로그아웃한 뒤
                다시 로그인해 주세요.
              </p>
            )}

            {errorMessage && (
              <p className="mt-3 text-sm font-medium text-red-700" role="alert">
                {errorMessage}
              </p>
            )}

            <button
              type="button"
              onClick={cancel}
              disabled={submitting}
              className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-bold text-stone-600 disabled:opacity-50"
            >
              취소
            </button>
          </section>
        </div>
      )}
    </>
  );
};
