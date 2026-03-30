import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastTone = "success" | "error" | "warning" | "info" | "reward";

interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}

interface AppToastContextValue {
  showToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
}

const AppToastContext = createContext<AppToastContextValue | undefined>(
  undefined,
);

const normalizeToastText = (value: unknown) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const TOAST_TONE_CLASSNAME: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  reward: "border-violet-200 bg-violet-50 text-violet-900",
};

const TOAST_ICON_CLASSNAME: Record<ToastTone, string> = {
  success: "fas fa-check-circle text-emerald-600",
  error: "fas fa-circle-exclamation text-rose-600",
  warning: "fas fa-triangle-exclamation text-amber-600",
  info: "fas fa-circle-info text-blue-600",
  reward: "fas fa-sparkles text-violet-600",
};

export const inferToastFromAlertMessage = (
  rawMessage: unknown,
): ToastInput | null => {
  const message = normalizeToastText(rawMessage);
  if (!message) return null;

  if (
    /(실패|오류|에러|불가|못했|못했습니다|만료|차단|중단|취소|불러오지 못)/.test(
      message,
    )
  ) {
    return {
      title: "작업 실패",
      message,
      tone: "error",
      durationMs: 5200,
    };
  }

  if (
    /(입력|선택|확인|필수|먼저|주의|대기|기다려|가능하지 않|필요합니다|다시 시도)/.test(
      message,
    )
  ) {
    return {
      title: "확인 필요",
      message,
      tone: "warning",
      durationMs: 4600,
    };
  }

  return {
    title: "알림",
    message,
    tone: "success",
  };
};

export const AppToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIndexRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    toastIndexRef.current += 1;
    const id = `toast-${Date.now()}-${toastIndexRef.current}`;
    const nextToast: ToastItem = {
      id,
      title: normalizeToastText(input.title) || "알림",
      message: normalizeToastText(input.message),
      tone: input.tone || "info",
      durationMs: input.durationMs,
    };
    setToasts((prev) => [...prev, nextToast].slice(-4));
    return id;
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return undefined;

    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        dismissToast(toast.id);
      }, Math.max(2200, toast.durationMs || 3600)),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissToast, toasts]);

  const value = useMemo<AppToastContextValue>(
    () => ({
      showToast,
      dismissToast,
    }),
    [dismissToast, showToast],
  );

  return (
    <AppToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-[120] flex justify-center px-3 sm:top-20 sm:justify-end sm:px-4">
        <div className="flex w-full max-w-md flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.14)] backdrop-blur ${TOAST_TONE_CLASSNAME[toast.tone]}`}
            >
              <div className="flex items-start gap-3">
                <i
                  className={`${TOAST_ICON_CLASSNAME[toast.tone]} mt-0.5 text-base`}
                  aria-hidden="true"
                ></i>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold leading-5">
                    {toast.title}
                  </div>
                  {toast.message && (
                    <div className="mt-1 text-sm leading-5 opacity-80">
                      {toast.message}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full opacity-70 transition hover:bg-white/60 hover:opacity-100"
                  aria-label="알림 닫기"
                >
                  <i className="fas fa-times text-xs" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppToastContext.Provider>
  );
};

export const useAppToast = () => {
  const context = useContext(AppToastContext);
  if (!context) {
    throw new Error("useAppToast must be used within an AppToastProvider.");
  }
  return context;
};
