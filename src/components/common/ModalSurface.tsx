import React from "react";

interface ModalSurfaceProps {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
  dismissible?: boolean;
  size?: "small" | "medium" | "wide";
  initialFocusRef?: React.RefObject<HTMLElement>;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ModalSurface: React.FC<ModalSurfaceProps> = ({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel = "닫기",
  dismissible = true,
  size = "medium",
  initialFocusRef,
}) => {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      window.requestAnimationFrame(() => {
        (initialFocusRef?.current || closeButtonRef.current)?.focus();
      });
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
      openerRef.current?.focus?.();
      openerRef.current = null;
    }
  }, [initialFocusRef, open]);

  React.useEffect(
    () => () => {
      if (dialogRef.current?.open) dialogRef.current.close();
      openerRef.current?.focus?.();
    },
    [],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`ws-modal ws-modal--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <section className="ws-modal__surface">
        <header className="ws-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          {dismissible && (
            <button
              ref={closeButtonRef}
              type="button"
              className="ws-modal__close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  d="m6 6 12 12M18 6 6 18"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          )}
        </header>
        <div className="ws-modal__body">{children}</div>
        {footer && <footer className="ws-modal__footer">{footer}</footer>}
      </section>
    </dialog>
  );
};

export default ModalSurface;
