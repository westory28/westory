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

export interface AppPromptOptions {
  title: string;
  message?: React.ReactNode;
  inputLabel?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  requiredMessage?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

interface AppDialogContextValue {
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
  prompt: (options: AppPromptOptions) => Promise<string | null>;
}

interface ConfirmDialogState extends AppConfirmOptions {
  kind: "confirm";
  confirmLabel: string;
  cancelLabel: string;
  tone: AppDialogTone;
}

interface PromptDialogState extends AppPromptOptions {
  kind: "prompt";
  inputLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: AppDialogTone;
}

type DialogState = ConfirmDialogState | PromptDialogState;

type DialogResolver =
  | { kind: "confirm"; resolve: (value: boolean) => void }
  | { kind: "prompt"; resolve: (value: string | null) => void };

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
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const resolverRef = useRef<DialogResolver | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const titleId = useId();
  const messageId = useId();
  const promptInputId = useId();

  const cancelPendingDialog = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    if (resolver?.kind === "confirm") {
      resolver.resolve(false);
    } else if (resolver?.kind === "prompt") {
      resolver.resolve(null);
    }
  }, []);

  const closeDialog = useCallback((result: boolean | string | null) => {
    const resolver = resolverRef.current;
    const opener = openerRef.current;
    resolverRef.current = null;
    openerRef.current = null;
    setDialog(null);
    setPromptError("");
    if (resolver?.kind === "confirm") {
      resolver.resolve(Boolean(result));
    } else if (resolver?.kind === "prompt") {
      resolver.resolve(typeof result === "string" ? result : null);
    }
    window.setTimeout(() => {
      opener?.focus?.();
    }, 0);
  }, []);

  const confirm = useCallback(
    (options: AppConfirmOptions) => {
      cancelPendingDialog();
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      return new Promise<boolean>((resolve) => {
        resolverRef.current = { kind: "confirm", resolve };
        setDialog({
          ...options,
          kind: "confirm",
          title: String(options.title || "확인"),
          confirmLabel: options.confirmLabel || "확인",
          cancelLabel: options.cancelLabel || "취소",
          tone: options.tone || "info",
        });
      });
    },
    [cancelPendingDialog],
  );

  const prompt = useCallback(
    (options: AppPromptOptions) => {
      cancelPendingDialog();
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPromptValue(options.initialValue || "");
      setPromptError("");

      return new Promise<string | null>((resolve) => {
        resolverRef.current = { kind: "prompt", resolve };
        setDialog({
          ...options,
          kind: "prompt",
          title: String(options.title || "입력"),
          inputLabel: options.inputLabel || "내용",
          confirmLabel: options.confirmLabel || "확인",
          cancelLabel: options.cancelLabel || "취소",
          tone: options.tone || "info",
        });
      });
    },
    [cancelPendingDialog],
  );

  useEffect(
    () => () => {
      cancelPendingDialog();
    },
    [cancelPendingDialog],
  );

  useEffect(() => {
    if (!dialog) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (dialog.kind === "prompt") {
        promptInputRef.current?.focus();
        promptInputRef.current?.select?.();
      } else {
        cancelButtonRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  const value = useMemo<AppDialogContextValue>(
    () => ({
      confirm,
      prompt,
    }),
    [confirm, prompt],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog(dialog.kind === "prompt" ? null : false);
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

  const handlePromptConfirm = () => {
    if (!dialog || dialog.kind !== "prompt") return;
    if (dialog.required && !promptValue.trim()) {
      setPromptError(dialog.requiredMessage || "내용을 입력해 주세요.");
      return;
    }
    closeDialog(promptValue);
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
            role={dialog.kind === "confirm" ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={dialog.message ? messageId : undefined}
            className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="overflow-y-auto px-5 pt-5">
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
              {dialog.kind === "prompt" && (
                <div className="mt-4">
                  <label
                    htmlFor={promptInputId}
                    className="text-xs font-black text-slate-600"
                  >
                    {dialog.inputLabel}
                  </label>
                  {dialog.multiline ? (
                    <textarea
                      id={promptInputId}
                      ref={(element) => {
                        promptInputRef.current = element;
                      }}
                      value={promptValue}
                      onChange={(event) => {
                        setPromptValue(event.target.value);
                        if (promptError) setPromptError("");
                      }}
                      rows={5}
                      maxLength={dialog.maxLength}
                      placeholder={dialog.placeholder}
                      className="mt-2 min-h-28 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  ) : (
                    <input
                      id={promptInputId}
                      ref={(element) => {
                        promptInputRef.current = element;
                      }}
                      value={promptValue}
                      onChange={(event) => {
                        setPromptValue(event.target.value);
                        if (promptError) setPromptError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handlePromptConfirm();
                        }
                      }}
                      maxLength={dialog.maxLength}
                      inputMode={dialog.inputMode}
                      placeholder={dialog.placeholder}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  )}
                  {(promptError || dialog.maxLength) && (
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs font-bold">
                      <p className="min-h-4 text-rose-600">{promptError}</p>
                      {dialog.maxLength && (
                        <p className="shrink-0 text-slate-400">
                          {promptValue.length}/{dialog.maxLength}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() =>
                  closeDialog(dialog.kind === "prompt" ? null : false)
                }
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100"
              >
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() =>
                  dialog.kind === "prompt"
                    ? handlePromptConfirm()
                    : closeDialog(true)
                }
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
