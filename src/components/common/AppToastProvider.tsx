import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./appToast.css";

export type ToastTone = "success" | "error" | "warning" | "info" | "reward";
interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  durationMs?: number;
  persistent?: boolean;
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
const normalizeToastText = (value: unknown) => String(value ?? "").trim();
const MAX_VISIBLE_TOASTS = 3;
const TONE_LABEL: Record<ToastTone, string> = {
  success: "완료",
  error: "작업 실패",
  warning: "확인 필요",
  info: "알림",
  reward: "보상",
};

// Compatibility for existing alert callers. Explicit showToast tones take priority.
export const inferToastFromAlertMessage = (
  rawMessage: unknown,
): ToastInput | null => {
  const message = normalizeToastText(rawMessage);
  if (!message) return null;
  let tone: ToastTone = "info";
  if (
    /(실패|오류|에러|불가|못했|만료|차단|불러오지 못|저장하지 못)/.test(message)
  ) {
    tone = "error";
  } else if (
    /(완료되지 않|저장되지 않|반영되지 않|선택할 수 없)/.test(message)
  ) {
    tone = "warning";
  } else if (
    /(완료|저장했|저장되었|저장됐|반영했|반영되었|적용했|적용되었|삭제했|삭제되었|취소했|취소되었|수정했|등록했|등록되었|복사했|복사되었|다운로드를 시작)/.test(
      message,
    )
  ) {
    tone = "success";
  } else if (
    /(입력해|선택해|확인해|필수|먼저|주의|대기|기다려|가능하지 않|필요합니다|다시 시도)/.test(
      message,
    )
  ) {
    tone = "warning";
  }
  return { title: TONE_LABEL[tone], message, tone };
};
const getToastDuration = (toast: ToastItem) => {
  if (toast.persistent || toast.durationMs === 0) return 0;
  const minimum =
    toast.tone === "error" || toast.tone === "warning" ? 10000 : 6000;
  const requested = Number.isFinite(toast.durationMs) ? toast.durationMs! : 0;
  const readingTime = Math.min(
    20000,
    (toast.title.length + (toast.message?.length || 0)) * 60,
  );
  return Math.max(minimum, requested, readingTime);
};
const ToastIcon = ({ tone }: { tone: ToastTone }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {tone === "success" ? (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </>
    ) : tone === "warning" ? (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v4m0 4h.01" />
      </>
    ) : tone === "reward" ? (
      <>
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="9" />
        {tone === "error" ? (
          <path d="m9 9 6 6m0-6-6 6" />
        ) : (
          <path d="M12 11v6m0-10h.01" />
        )}
      </>
    )}
  </svg>
);
const ToastCard = ({
  toast,
  paused,
  dismissToast,
}: {
  toast: ToastItem;
  paused: boolean;
  dismissToast: (id: string) => void;
}) => {
  const duration = getToastDuration(toast);
  const remainingRef = useRef(duration);
  useEffect(() => {
    if (paused || duration === 0) return;
    const started = performance.now();
    const timer = window.setTimeout(
      () => dismissToast(toast.id),
      remainingRef.current,
    );
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (performance.now() - started),
      );
    };
  }, [dismissToast, duration, paused, toast.id]);
  return (
    <div
      className={`ws-toast ws-toast--${toast.tone}`}
      role="group"
      aria-labelledby={`${toast.id}-title`}
      aria-describedby={toast.message ? `${toast.id}-message` : undefined}
    >
      <span className="ws-toast__icon">
        <ToastIcon tone={toast.tone} />
      </span>
      <div className="ws-toast__content">
        <div className="ws-toast__title" id={`${toast.id}-title`}>
          {toast.title}
        </div>
        {toast.message && (
          <div className="ws-toast__message" id={`${toast.id}-message`}>
            {toast.message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="ws-toast__close"
        aria-label={`${toast.title} 알림 닫기`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
};

export const AppToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "ws-toast-layer";
    element.setAttribute("popover", "manual");
    return element;
  });
  const toastIndexRef = useRef(0);
  // Persistent realtime notices must leave a slot for action results.
  let persistentCount = 0;
  const visibleToasts = toasts
    .filter((toast) => {
      if (getToastDuration(toast) !== 0) return true;
      persistentCount += 1;
      return persistentCount < MAX_VISIBLE_TOASTS;
    })
    .slice(0, MAX_VISIBLE_TOASTS);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((input: ToastInput) => {
    toastIndexRef.current += 1;
    const id = `toast-${Date.now()}-${toastIndexRef.current}`;
    setToasts((prev) => [
      ...prev,
      {
        ...input,
        id,
        title: normalizeToastText(input.title) || "알림",
        message: normalizeToastText(input.message),
        tone: input.tone || "info",
      },
    ]);
    return id;
  }, []);
  useEffect(() => {
    const originalAlert = window.alert;
    const toastAlert = (message?: unknown) => {
      const toast = inferToastFromAlertMessage(message);
      if (toast) showToast(toast);
    };
    window.alert = toastAlert;
    return () => {
      if (window.alert === toastAlert) window.alert = originalAlert;
    };
  }, [showToast]);
  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  useEffect(() => {
    let modalOrder = Array.from(document.querySelectorAll("dialog")).filter(
      (dialog) => dialog.matches(":modal"),
    );
    const mountHost = () => {
      // A modal makes nodes outside it inert; keep notification controls inside it.
      modalOrder = modalOrder.filter(
        (dialog) => dialog.isConnected && dialog.matches(":modal"),
      );
      const modal = modalOrder[modalOrder.length - 1];
      const parent = modal || document.fullscreenElement || document.body;
      if (host.parentElement !== parent) {
        parent.appendChild(host);
        setHovered(false);
        setFocused(host.contains(document.activeElement));
      }
      if (
        typeof host.showPopover === "function" &&
        !host.matches(":popover-open")
      )
        host.showPopover();
    };
    mountHost();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.target instanceof HTMLDialogElement &&
          record.attributeName === "open"
        ) {
          const dialog = record.target;
          modalOrder = modalOrder.filter((item) => item !== dialog);
          if (record.oldValue === null && dialog.matches(":modal"))
            modalOrder.push(dialog);
        }
      }
      if (
        records.some(
          (record) =>
            record.target instanceof HTMLDialogElement ||
            Array.from(record.removedNodes).some(
              (node) => node instanceof Element && node.contains(host),
            ),
        )
      )
        mountHost();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
      attributeOldValue: true,
    });
    document.addEventListener("fullscreenchange", mountHost);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", mountHost);
      host.remove();
    };
  }, [host]);
  useEffect(() => {
    setFocused(host.contains(document.activeElement));
    if (!toasts.length) {
      setHovered(false);
    } else if (
      host.isConnected &&
      typeof host.showPopover === "function" &&
      !host.matches(":popover-open")
    ) {
      host.showPopover();
    }
  }, [host, toasts]);
  const value = useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );
  return (
    <AppToastContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <div
            className="ws-toast-announcer"
            role="status"
            aria-live="polite"
            aria-relevant="additions"
            aria-atomic="false"
          >
            {visibleToasts
              .filter((toast) => toast.tone !== "error")
              .map((toast) => (
                <div key={toast.id}>
                  {toast.title} {toast.message}
                </div>
              ))}
          </div>
          <div
            className="ws-toast-announcer"
            role="alert"
            aria-live="assertive"
            aria-relevant="additions"
            aria-atomic="false"
          >
            {visibleToasts
              .filter((toast) => toast.tone === "error")
              .map((toast) => (
                <div key={toast.id}>
                  {toast.title} {toast.message}
                </div>
              ))}
          </div>
          <section
            className="ws-toast-stack"
            aria-label="작업 알림"
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setFocused(false);
            }}
          >
            {visibleToasts.map((toast) => (
              <ToastCard
                key={toast.id}
                toast={toast}
                paused={hovered || focused || hidden}
                dismissToast={dismissToast}
              />
            ))}
            {toasts.length > visibleToasts.length && (
              <div className="ws-toast-pending">
                알림 {toasts.length - visibleToasts.length}개 대기 중
              </div>
            )}
          </section>
        </>,
        host,
      )}
    </AppToastContext.Provider>
  );
};
export const useAppToast = () => {
  const context = useContext(AppToastContext);
  if (!context)
    throw new Error("useAppToast must be used within an AppToastProvider.");
  return context;
};
