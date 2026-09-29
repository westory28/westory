import React, { useEffect, useId, useRef, useState } from "react";
import TeacherNavigationIcon from "../../../components/layout/TeacherNavigationIcon";
import "../teacherSettings.css";

interface TeacherSubNavigationProps {
  title: string;
  activeLabel: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** The settings navigation pattern, shared by teacher workspaces. */
const TeacherSubNavigation: React.FC<TeacherSubNavigationProps> = ({
  title,
  activeLabel,
  children,
  actions,
  open,
  onOpenChange,
  className = "",
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

  return (
    <aside
      className={`teacher-settings-navigation teacher-sub-navigation ${className}`}
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
          <h2>{title}</h2>
          {actions && (
            <div className="teacher-sub-navigation-actions">{actions}</div>
          )}
        </div>
        <button
          ref={toggleRef}
          type="button"
          className="teacher-settings-menu-toggle"
          aria-expanded={expanded}
          aria-controls={menuId}
          onClick={() => setOpen(!expanded)}
        >
          <span>{activeLabel}</span>
          <TeacherNavigationIcon
            name="chevron"
            className={expanded ? "is-open" : ""}
          />
          <span className="sr-only">
            {title} 메뉴 {expanded ? "접기" : "펼치기"}
          </span>
        </button>
        <nav
          ref={menuRef}
          id={menuId}
          className={`teacher-settings-sections${expanded ? " is-open" : ""}`}
          aria-label={`${title} 메뉴`}
        >
          {children}
        </nav>
      </div>
    </aside>
  );
};

export default TeacherSubNavigation;
