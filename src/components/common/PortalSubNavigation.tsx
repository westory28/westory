import React, { useEffect, useId, useRef, useState } from "react";
import TeacherNavigationIcon from "../layout/TeacherNavigationIcon";
import "./portalSubNavigation.css";

interface PortalSubNavigationProps {
  title: string;
  activeLabel: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  variant?: "tree" | "tabs";
}

/** Flat page choices or a hierarchical content tree, shared by both portals. */
const PortalSubNavigation: React.FC<PortalSubNavigationProps> = ({
  title,
  activeLabel,
  children,
  actions,
  open,
  onOpenChange,
  className = "",
  variant = "tree",
}) => {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const previousOpen = useRef(expanded);
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (
      previousOpen.current &&
      !expanded &&
      menuRef.current?.contains(document.activeElement) &&
      toggleRef.current?.getClientRects().length
    ) {
      toggleRef.current.focus();
    }
    previousOpen.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (variant !== "tabs") return;
    const menu = menuRef.current;
    const selected = menu?.querySelector<HTMLElement>(
      '.is-active, [aria-current="page"], [aria-pressed="true"], [aria-selected="true"]',
    );
    if (!menu || !selected) return;
    const menuBox = menu.getBoundingClientRect();
    const selectedBox = selected.getBoundingClientRect();
    if (selectedBox.left < menuBox.left) {
      menu.scrollLeft -= menuBox.left - selectedBox.left;
    } else if (selectedBox.right > menuBox.right) {
      menu.scrollLeft += selectedBox.right - menuBox.right;
    }
  }, [activeLabel, variant]);

  return (
    <aside
      className={`teacher-settings-navigation teacher-sub-navigation${variant === "tabs" ? " teacher-sub-navigation--tabs" : ""} ${className}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          setOpen(false);
          if (toggleRef.current?.getClientRects().length) {
            toggleRef.current.focus();
          }
        }
      }}
    >
      <div className="teacher-settings-navigation-inner">
        <div className="teacher-settings-heading">
          {variant === "tabs" ? <h1>{title}</h1> : <h2>{title}</h2>}
          {actions && (
            <div className="teacher-sub-navigation-actions">{actions}</div>
          )}
        </div>
        {variant === "tree" && (
          <button
            ref={toggleRef}
            type="button"
            className="teacher-settings-menu-toggle"
            aria-expanded={expanded}
            aria-controls={menuId}
            onClick={() => setOpen(!expanded)}
          >
            <span title={activeLabel}>{activeLabel}</span>
            <TeacherNavigationIcon
              name="chevron"
              className={expanded ? "is-open" : ""}
            />
            <span className="sr-only">
              {title} 메뉴 {expanded ? "접기" : "펼치기"}
            </span>
          </button>
        )}
        <nav
          ref={menuRef}
          id={menuId}
          className={`teacher-settings-sections${expanded ? " is-open" : ""}${variant === "tabs" ? " ws-page-tabs" : ""}`}
          aria-label={`${title} 메뉴`}
        >
          {children}
        </nav>
      </div>
    </aside>
  );
};

export default PortalSubNavigation;
