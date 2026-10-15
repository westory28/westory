import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./InfoHelp.css";

export interface InfoHelpRow {
  label?: ReactNode;
  content: ReactNode;
}

export interface InfoHelpSection {
  title?: ReactNode;
  text?: ReactNode;
  rows?: readonly InfoHelpRow[];
  items?: readonly ReactNode[];
}

export interface InfoHelpContentProps {
  sections?: readonly InfoHelpSection[];
  children?: ReactNode;
}

/** Vector strokes keep the mark centered independently of inherited fonts. */
export function InfoHelpIcon() {
  return (
    <svg
      className="ws-info-help__icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="6.25" r="1" fill="currentColor" />
      <path
        d="M10 9.25v4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Content is explicitly structured, never rewritten by splitting sentences. */
export function InfoHelpContent({ sections, children }: InfoHelpContentProps) {
  return (
    <span className="ws-info-help__content">
      {sections?.map((section, index) => (
        <span className="ws-info-help__section" key={index}>
          {section.title && (
            <strong className="ws-info-help__title">{section.title}</strong>
          )}
          {section.text && (
            <span className="ws-info-help__text">{section.text}</span>
          )}
          {section.rows?.map((row, rowIndex) => (
            <span className="ws-info-help__row" key={rowIndex}>
              {row.label && (
                <strong className="ws-info-help__label">{row.label}</strong>
              )}
              <span>{row.content}</span>
            </span>
          ))}
          {section.items && (
            <span className="ws-info-help__list" role="list">
              {section.items.map((item, itemIndex) => (
                <span
                  className="ws-info-help__item"
                  role="listitem"
                  key={itemIndex}
                >
                  <span aria-hidden="true">•</span>
                  <span>{item}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
      {children && <span className="ws-info-help__legacy">{children}</span>}
    </span>
  );
}

export interface InfoHelpProps extends InfoHelpContentProps {
  label: string;
  className?: string;
}

const getHelpTabStops = (container: HTMLElement | null): HTMLElement[] => {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable=true]",
    ),
  )
    .filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        !element.closest("[inert], [hidden]") &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden",
    )
    .sort((first, second) => {
      // Positive tabindex precedes the normal DOM sequence, as in native Tab.
      const firstOrder = first.tabIndex || Infinity;
      const secondOrder = second.tabIndex || Infinity;
      return firstOrder === secondOrder ? 0 : firstOrder - secondOrder;
    });
};

export function InfoHelp({
  label,
  className = "",
  sections,
  children,
}: InfoHelpProps) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const restoringFocus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const close = () => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  };
  const show = () => {
    if (restoringFocus.current) return;
    cancelClose();
    setOpen(true);
  };
  const leave = () => {
    if (
      pinned.current ||
      root.current?.contains(document.activeElement) ||
      tooltip.current?.contains(document.activeElement)
    )
      return;
    cancelClose();
    // Allow the pointer to cross the small gap into the tooltip.
    closeTimer.current = setTimeout(close, 120);
  };
  const restoreTriggerFocus = () => {
    restoringFocus.current = true;
    button.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const anchor = button.current;
      const popup = tooltip.current;
      if (!anchor || !popup) return;
      const bounds = anchor.getBoundingClientRect();
      popup.style.left = "0px";
      popup.style.top = "0px";
      // A native modal must retain its tooltip inside the dialog top layer.
      // Account for a dialog's translated containing block as well as body.
      const origin = popup.getBoundingClientRect();
      const left = Math.max(
        16,
        Math.min(bounds.left, window.innerWidth - origin.width - 16),
      );
      const below = bounds.bottom + 8;
      const top =
        below + origin.height <= window.innerHeight - 16
          ? below
          : Math.max(16, bounds.top - origin.height - 8);
      popup.style.left = `${left - origin.left}px`;
      popup.style.top = `${top - origin.top}px`;
      popup.style.visibility = "visible";
    };
    position();
    setInteractive(getHelpTabStops(tooltip.current).length > 0);
    const observer = new ResizeObserver(position);
    if (tooltip.current) observer.observe(tooltip.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, sections, children]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !tooltip.current?.contains(target))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (tooltip.current?.contains(document.activeElement))
        restoreTriggerFocus();
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={`ws-info-help ${className}`.trim()}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show();
      }}
      onPointerLeave={leave}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !tooltip.current?.contains(event.relatedTarget)
        )
          close();
      }}
    >
      <button
        ref={button}
        className="ws-info-help__button"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open && !interactive ? id : undefined}
        aria-controls={open ? id : undefined}
        aria-haspopup={interactive ? "dialog" : undefined}
        onFocus={show}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || event.shiftKey || !open) return;
          const first = getHelpTabStops(tooltip.current)[0];
          if (!first) return;
          event.preventDefault();
          cancelClose();
          first.focus();
        }}
        onClick={(event) => {
          event.stopPropagation();
          cancelClose();
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <InfoHelpIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            id={id}
            role={interactive ? "dialog" : "tooltip"}
            aria-label={interactive ? label : undefined}
            aria-modal={interactive ? false : undefined}
            className="ws-info-help__popover"
            style={{ visibility: "hidden" }}
            onPointerEnter={cancelClose}
            onPointerLeave={leave}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const stops = getHelpTabStops(tooltip.current);
              const active = document.activeElement;
              if (event.shiftKey && active === stops[0]) {
                event.preventDefault();
                cancelClose();
                button.current?.focus({ preventScroll: true });
              } else if (
                !event.shiftKey &&
                active === stops[stops.length - 1]
              ) {
                // Resume the browser's own Tab sequence at the trigger. Do not
                // trap focus or approximate the rest of the page's tab order.
                restoreTriggerFocus();
                close();
              }
            }}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !root.current?.contains(event.relatedTarget)
              )
                close();
            }}
          >
            <InfoHelpContent sections={sections}>{children}</InfoHelpContent>
          </div>,
          button.current?.closest("dialog") || document.body,
        )}
    </span>
  );
}

export default InfoHelp;
