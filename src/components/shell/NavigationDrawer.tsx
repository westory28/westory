import React from "react";
import { Link } from "react-router-dom";
import type { ShellNavigationItem } from "../../constants/routeMetadata";
import { isNavigationItemActive } from "../../constants/routeMetadata";
import NavigationIcon from "./NavigationIcon";

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const NavigationDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  mode: "teacher" | "student-more";
  opener: React.RefObject<HTMLElement>;
}> = ({ open, onClose, title, items, pathname, search, mode, opener }) => {
  const drawerRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => opener.current?.focus());
    };
  }, [open, opener]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [],
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
    <div className="ws-nav-drawer-layer" role="presentation">
      <button
        type="button"
        className="ws-nav-drawer-backdrop"
        onClick={onClose}
        aria-label="메뉴 닫기"
      />
      <div
        id="westory-shell-navigation"
        ref={drawerRef}
        className={`ws-nav-drawer ws-nav-drawer--${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div className="ws-nav-drawer__header">
          <div>
            <p className="ws-nav-drawer__eyebrow">Westory</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="ws-icon-button"
            onClick={onClose}
            aria-label="메뉴 닫기"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden
            >
              <path
                d="m6 6 12 12M18 6 6 18"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <nav className="ws-nav-drawer__nav" aria-label={title}>
          {items.map((item) => {
            const active = isNavigationItemActive(item, pathname, search);
            return (
              <div key={item.id} className="ws-nav-drawer__group">
                <Link
                  to={item.to}
                  className={`ws-nav-drawer__link ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onClose}
                >
                  <NavigationIcon path={item.iconPath} />
                  <span>{item.label}</span>
                </Link>
                {item.children && mode === "student-more" && (
                  <div className="ws-nav-drawer__children">
                    {item.children.map((child) => (
                      <Link key={child.to} to={child.to} onClick={onClose}>
                        <strong>{child.label}</strong>
                        {child.description && <span>{child.description}</span>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default NavigationDrawer;
