import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export type AppDialogTone = "info" | "warning" | "danger";

export interface AppConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
}

interface AppDialogContextValue {
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
}

interface ConfirmDialogState extends AppConfirmOptions {
  confirmLabel: string;
  cancelLabel: string;
  tone: AppDialogTone;
}

const AppDialogContext = createContext<AppDialogContextValue | undefined>(
  undefined,
);

const TONE_META: Record<
  AppDialogTone,
  {
    icon: string;
    iconClassName: string;
    confirmClassName: string;
  }
> = {
  info: {
    icon: "fas fa-circle-info",
    iconClassName: "border-blue-100 bg-blue-50 text-blue-600",
    confirmClassName: "bg-blue-600 text-white hover:bg-blue-700",
  },
  warning: {
    icon: "fas fa-triangle-exclamation",
    iconClassName: "border-amber-100 bg-amber-50 text-amber-700",
    confirmClassName: "bg-blue-600 text-white hover:bg-blue-700",
  },
  danger: {
    icon: "fas fa-triangle-exclamation",
    iconClassName: "border-rose-100 bg-rose-50 text-rose-700",
    confirmClassName: "bg-rose-600 text-white hover:bg-rose-700",
  },
};

const getFocusableElements = (container: HTMLElement | null) => {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );
};

export const AppDialogProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [dialog, setDialog] = useState<ConfirmDialogState | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  const closeDialog = useCallback((result: boolean) => {
    const resolver = resolverRef.current;
    const opener = openerRef.current;
    resolverRef.current = null;
    openerRef.current = null;
    setDialog(null);
    resolver?.(result);
    window.setTimeout(() => {
      opener?.focus?.();
    }, 0);
  }, []);

  const confirm = useCallback((options: AppConfirmOptions) => {
    resolverRef.current?.(false);
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        ...options,
        title: String(options.title || "확인"),
        confirmLabel: options.confirmLabel || "확인",
        cancelLabel: options.cancelLabel || "취소",
        tone: options.tone || "info",
      });
    });
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!dialog) return undefined;
    const frame = window.requestAnimationFrame(() => {
      cancelButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  const value = useMemo<AppDialogContextValue>(
    () => ({
      confirm,
    }),
    [confirm],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog(false);
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = getFocusableElements(dialogRef.current);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toneMeta = dialog ? TONE_META[dialog.tone] : TONE_META.info;

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          onKeyDown={handleKeyDown}
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={dialog.message ? messageId : undefined}
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="px-5 pt-5">
              <div
                className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${toneMeta.iconClassName}`}
                aria-hidden="true"
              >
                <i className={`${toneMeta.icon} text-lg`}></i>
              </div>
              <h2
                id={titleId}
                className="mt-4 text-lg font-black leading-7 text-slate-900"
              >
                {dialog.title}
              </h2>
              {dialog.message && (
                <div
                  id={messageId}
                  className="mt-2 text-sm font-semibold leading-6 text-slate-600"
                >
                  {typeof dialog.message === "string" ? (
                    <p className="whitespace-pre-line">{dialog.message}</p>
                  ) : (
                    dialog.message
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => closeDialog(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100"
              >
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => closeDialog(true)}
                className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-black shadow-sm transition ${toneMeta.confirmClassName}`}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppDialogContext.Provider>
  );
};

export const useAppDialog = () => {
  const context = useContext(AppDialogContext);
  if (!context) {
    throw new Error("useAppDialog must be used within an AppDialogProvider.");
  }
  return context;
};
