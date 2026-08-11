import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getIdToken,
  getIdTokenResult,
  type User,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";
import { disableNetwork, enableNetwork } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useAuth } from "../../contexts/AuthContext";
import {
  beginApplicationSessionReauthentication,
  synchronizeApplicationSession,
} from "../../lib/applicationSession";
import {
  getStepUpReauthFailureMessage,
  registerStepUpReauthHandler,
  StepUpReauthError,
} from "../../lib/stepUpReauth";
import type { StepUpRequestOptions } from "../../lib/stepUpReauth";
import {
  clearSessionTiming,
  NORMAL_SESSION_DURATION_MS,
  writeSessionDeadline,
} from "../../lib/sessionPolicy";

const RECENT_AUTH_MS = 5 * 60 * 1000;

interface PendingRequest {
  commandName: string;
  ownerUid: string;
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
    createSemesterManifest: "새 학기 Manifest 생성",
    updateSemesterManifest: "학기 Manifest 변경",
    updateOperationalSettings: "학기·운영 설정 변경",
    validateSemesterReadiness: "학기 준비도 검증",
    transitionSemesterStatus: "학기 상태 변경",
    activateSemester: "활성 학기 전환",
    updateInterfaceSettings: "화면 설정 변경",
    updateMenuSettings: "메뉴 설정 변경",
    updateNotificationSettings: "알림 설정 변경",
    updateTermsSettings: "이용약관 변경",
    addConsentItem: "동의 항목 추가",
    updateConsentItem: "동의 항목 변경",
    deleteConsentItem: "동의 항목 삭제",
    syncKoreanPublicHolidays: "공휴일 일정 동기화",
    updatePrivacySettings: "개인정보 처리방침 변경",
    updateConsentSettings: "동의 항목 변경",
    updateSchoolSettings: "학교 구조 설정 변경",
  };
  return labels[commandName] || "보호된 운영 작업";
};

const hasRecentAuth = async (user: User) => {
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
  const submittingRef = useRef(false);
  const firestorePausedRef = useRef(false);
  const protectedContentRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const {
    authenticationStatus,
    currentUser,
    prepareForReauthentication,
    userData,
  } = useAuth();
  const authReadyRef = useRef({
    authenticationStatus,
    currentUser,
    userData,
  });

  useEffect(() => {
    authReadyRef.current = { authenticationStatus, currentUser, userData };
  }, [authenticationStatus, currentUser, userData]);

  const waitForAuthenticatedUser = useCallback(async (ownerUid: string) => {
    const expiresAt = Date.now() + 15_000;
    while (Date.now() < expiresAt) {
      const snapshot = authReadyRef.current;
      if (
        snapshot.authenticationStatus === "AUTHENTICATED" &&
        snapshot.currentUser?.uid === ownerUid &&
        snapshot.userData?.uid === ownerUid
      ) {
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
    throw new StepUpReauthError(
      "SESSION_REFRESH_FAILED",
      "새 로그인 세션으로 사용자 권한을 다시 확인하지 못했습니다.",
    );
  }, []);

  useEffect(() => {
    const protectedContent = protectedContentRef.current;
    if (!protectedContent) return;
    if (pending) {
      protectedContent.setAttribute("inert", "");
      return;
    }
    protectedContent.removeAttribute("inert");
  }, [pending]);

  useEffect(() => {
    if (!pending || !submitting) return;
    dialogRef.current?.focus();
  }, [pending, submitting]);

  const resetDialog = useCallback(() => {
    setPending(null);
    setPassword("");
    setErrorMessage("");
  }, []);

  const pauseFirestoreForReauthentication = useCallback(async () => {
    await disableNetwork(db);
    firestorePausedRef.current = true;
  }, []);

  const resumeFirestoreAfterReauthentication = useCallback(async () => {
    if (!firestorePausedRef.current) return;
    await enableNetwork(db);
    firestorePausedRef.current = false;
  }, []);

  const rejectPending = useCallback(
    (current: PendingRequest, error: StepUpReauthError) => {
      if (pendingRef.current !== current) return;
      pendingRef.current = null;
      resetDialog();
      current.reject(error);
    },
    [resetDialog],
  );

  const requestReauth = useCallback(
    async (commandName: string, options?: StepUpRequestOptions) => {
      const user = auth.currentUser;
      if (!user) {
        throw new StepUpReauthError(
          "UNAUTHENTICATED",
          "로그인 사용자를 확인할 수 없습니다.",
        );
      }
      if (!options?.force) {
        try {
          if (
            (await hasRecentAuth(user)) &&
            auth.currentUser?.uid === user.uid
          ) {
            return;
          }
        } catch {
          // A stale or unavailable token is not enough to bypass step-up.
        }
      }
      if (pendingRef.current) {
        throw new StepUpReauthError(
          "IN_PROGRESS",
          "다른 재인증 요청을 먼저 완료해 주세요.",
        );
      }
      if (auth.currentUser?.uid !== user.uid) {
        throw new StepUpReauthError(
          "IDENTITY_CHANGED",
          "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
        );
      }
      await new Promise<void>((resolve, reject) => {
        const request = {
          commandName,
          ownerUid: user.uid,
          resolve,
          reject,
        };
        pendingRef.current = request;
        setPassword("");
        setErrorMessage("");
        setPending(request);
      });
    },
    [],
  );

  useEffect(() => registerStepUpReauthHandler(requestReauth), [requestReauth]);

  useEffect(
    () => () => {
      const current = pendingRef.current;
      pendingRef.current = null;
      if (firestorePausedRef.current) {
        firestorePausedRef.current = false;
        void enableNetwork(db);
      }
      current?.reject(
        new StepUpReauthError(
          "UNAVAILABLE",
          "재인증 화면이 닫혀 작업을 실행하지 않았습니다.",
        ),
      );
    },
    [],
  );

  const finishSuccess = async (current: PendingRequest) => {
    const user = auth.currentUser;
    if (!user || user.uid !== current.ownerUid) {
      throw new StepUpReauthError(
        "IDENTITY_CHANGED",
        "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
      );
    }
    let session;
    try {
      session = await synchronizeApplicationSession(user, {
        expectedUid: current.ownerUid,
      });
    } catch (error) {
      if (auth.currentUser?.uid !== current.ownerUid) {
        throw new StepUpReauthError(
          "IDENTITY_CHANGED",
          "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
          error,
        );
      }
      throw new StepUpReauthError(
        "SESSION_REFRESH_FAILED",
        "본인 확인은 끝났지만 로그인 세션을 갱신하지 못했습니다.",
        error,
      );
    }
    if (
      auth.currentUser?.uid !== current.ownerUid ||
      pendingRef.current !== current
    ) {
      throw new StepUpReauthError(
        "IDENTITY_CHANGED",
        "로그인 상태가 바뀌어 작업을 실행하지 않았습니다.",
      );
    }
    if (
      session.authorityMode === "ENFORCE" &&
      !writeSessionDeadline(session.generalExpiresAt, {
        durationMs: NORMAL_SESSION_DURATION_MS,
      })
    ) {
      throw new StepUpReauthError(
        "SESSION_REFRESH_FAILED",
        "로그인 세션의 만료 시간을 확인하지 못했습니다.",
      );
    }
    if (session.authorityMode !== "ENFORCE") {
      clearSessionTiming();
    }
    try {
      // Reauthentication publishes the new auth_time before the matching
      // application-session document is committed. Refresh once more after
      // the commit and let the existing Auth/Firestore token bridge observe
      // the new credential before protected reads mount again.
      await getIdToken(user, true);
      await resumeFirestoreAfterReauthentication();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await waitForAuthenticatedUser(current.ownerUid);
    } catch (error) {
      throw new StepUpReauthError(
        "SESSION_REFRESH_FAILED",
        "새 로그인 세션으로 데이터 연결을 다시 시작하지 못했습니다.",
        error,
      );
    }
    pendingRef.current = null;
    resetDialog();
    current.resolve();
  };

  const recoverAuthenticationAfterFailedReauthentication = async (
    user: User,
    ownerUid: string,
  ) => {
    await resumeFirestoreAfterReauthentication().catch((error) => {
      console.error("Failed to resume Firestore after reauthentication", error);
    });
    if (auth.currentUser?.uid !== ownerUid) return;
    await getIdToken(user, true).catch((error) => {
      console.error(
        "Failed to restore authentication after reauthentication",
        error,
      );
    });
  };

  const handlePasswordReauth = async (event: React.FormEvent) => {
    event.preventDefault();
    const user = auth.currentUser;
    const current = pendingRef.current;
    if (submittingRef.current || !user?.email || !current || !password) {
      return;
    }
    if (user.uid !== current.ownerUid) {
      rejectPending(
        current,
        new StepUpReauthError(
          "IDENTITY_CHANGED",
          "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
        ),
      );
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage("");
    try {
      await beginApplicationSessionReauthentication();
      prepareForReauthentication();
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      await pauseFirestoreForReauthentication();
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      await finishSuccess(current);
    } catch (error) {
      if (
        error instanceof StepUpReauthError &&
        error.code === "IDENTITY_CHANGED"
      ) {
        rejectPending(current, error);
        return;
      }
      await recoverAuthenticationAfterFailedReauthentication(
        user,
        current.ownerUid,
      );
      setErrorMessage(getStepUpReauthFailureMessage(error, "password"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleGoogleReauth = async () => {
    const user = auth.currentUser;
    const current = pendingRef.current;
    if (submittingRef.current || !user || !current) return;
    if (user.uid !== current.ownerUid) {
      rejectPending(
        current,
        new StepUpReauthError(
          "IDENTITY_CHANGED",
          "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
        ),
      );
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage("");
    try {
      await beginApplicationSessionReauthentication();
      prepareForReauthentication();
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      await pauseFirestoreForReauthentication();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: user.email || "" });
      await reauthenticateWithPopup(user, provider);
      await finishSuccess(current);
    } catch (error) {
      if (
        error instanceof StepUpReauthError &&
        error.code === "IDENTITY_CHANGED"
      ) {
        rejectPending(current, error);
        return;
      }
      await recoverAuthenticationAfterFailedReauthentication(
        user,
        current.ownerUid,
      );
      setErrorMessage(getStepUpReauthFailureMessage(error, "google"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const cancel = () => {
    if (submittingRef.current) return;
    const current = pendingRef.current;
    if (!current) return;
    rejectPending(
      current,
      new StepUpReauthError(
        "CANCELLED",
        "본인 확인을 취소하여 작업을 실행하지 않았습니다.",
      ),
    );
  };

  const providerIds =
    auth.currentUser?.providerData.map((item) => item.providerId) || [];
  const supportsPassword = providerIds.includes("password");
  const supportsGoogle = providerIds.includes("google.com");

  return (
    <>
      <div
        ref={protectedContentRef}
        aria-hidden={pending ? "true" : undefined}
        style={{ display: "contents" }}
      >
        {children}
      </div>
      {pending && (
        <div
          className="fixed inset-0 z-[280] flex items-center justify-center bg-stone-950 p-4"
          role="presentation"
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="step-up-title"
            tabIndex={-1}
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
