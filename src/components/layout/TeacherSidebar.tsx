import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import TeacherNavigationIcon, {
  type TeacherIconName,
} from "./TeacherNavigationIcon";

export interface TeacherSidebarGroup {
  id: string;
  name: string;
  icon: TeacherIconName;
  children: Array<{ name: string; resolvedUrl: string }>;
  directUrl?: string;
  secondary?: boolean;
}

interface TeacherSidebarProps {
  groups: TeacherSidebarGroup[];
  home: string;
  showDashboard: boolean;
  showSettings: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  isChildActive: (
    url: string,
    siblings: Array<{ resolvedUrl: string }>,
  ) => boolean;
}

const TeacherSidebar: React.FC<TeacherSidebarProps> = ({
  groups,
  home,
  showDashboard,
  showSettings,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
  isChildActive,
}) => {
  const location = useLocation();
  const allChildren = groups.flatMap((group) => group.children);
  const activeGroup = groups.find((group) =>
    group.children.some((child) =>
      isChildActive(child.resolvedUrl, allChildren),
    ),
  )?.id;
  const [openGroup, setOpenGroup] = useState<string | null>(
    activeGroup || null,
  );
  const panelRef = useRef<HTMLElement>(null);
  const previousMobileOpen = useRef(false);

  useEffect(() => {
    setOpenGroup(activeGroup || null);
  }, [location.pathname, location.search, activeGroup]);

  useEffect(() => {
    if (!mobileOpen) {
      if (previousMobileOpen.current) {
        document.getElementById("teacher-navigation-toggle")?.focus();
      }
      previousMobileOpen.current = false;
      return;
    }
    previousMobileOpen.current = true;
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>(".teacher-sidebar-close")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const elements = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen, onCloseMobile]);

  const toggleGroup = (id: string) => {
    if (collapsed && !mobileOpen) onToggleCollapsed();
    setOpenGroup((previous) => (previous === id && !collapsed ? null : id));
  };
  const dashboardActive =
    location.pathname === "/teacher/dashboard" && !activeGroup;

  return (
    <>
      {mobileOpen && (
        <div
          className="teacher-sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        id="teacher-navigation"
        ref={panelRef}
        className={`teacher-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label="교사 메뉴"
      >
        <div className="teacher-sidebar-brand-row">
          <Link
            to={home}
            className="teacher-sidebar-brand"
            onClick={onCloseMobile}
            aria-label="Westory 첫 화면"
          >
            <span className="teacher-sidebar-wordmark">
              <span className="logo-we">We</span>
              <span className="logo-story">story</span>
            </span>
            <span className="teacher-sidebar-tagline">
              우리가 써 내려가는 이야기
            </span>
          </Link>
          <button
            type="button"
            className="teacher-sidebar-close"
            onClick={onCloseMobile}
            aria-label="메뉴 닫기"
          >
            <TeacherNavigationIcon name="close" />
          </button>
        </div>
        <nav className="teacher-sidebar-nav" aria-label="교사 주 메뉴">
          {showDashboard && (
            <Link
              to="/teacher/dashboard"
              className={`teacher-sidebar-item ${dashboardActive ? "is-active" : ""}`}
              aria-current={dashboardActive ? "page" : undefined}
              onClick={onCloseMobile}
              title={collapsed ? "대시보드" : undefined}
            >
              <TeacherNavigationIcon name="home" />
              <span className="teacher-sidebar-label">대시보드</span>
            </Link>
          )}
          {groups.map((group, index) => {
            const open = openGroup === group.id;
            const active = activeGroup === group.id;
            const divider = group.secondary && !groups[index - 1]?.secondary;
            const groupId = `teacher-menu-${group.id}`;
            return (
              <div
                key={group.id}
                className={`teacher-sidebar-group ${divider ? "has-divider" : ""}`}
              >
                {group.directUrl ? (
                  <Link
                    to={group.directUrl}
                    className={`teacher-sidebar-item ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={onCloseMobile}
                    title={collapsed ? group.name : undefined}
                  >
                    <TeacherNavigationIcon name={group.icon} />
                    <span className="teacher-sidebar-label">{group.name}</span>
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`teacher-sidebar-item ${active ? "is-active" : ""} ${open ? "is-open" : ""}`}
                      aria-expanded={open && (!collapsed || mobileOpen)}
                      aria-controls={groupId}
                      onClick={() => toggleGroup(group.id)}
                      title={collapsed ? group.name : undefined}
                    >
                      <TeacherNavigationIcon name={group.icon} />
                      <span className="teacher-sidebar-label">
                        {group.name}
                      </span>
                      <TeacherNavigationIcon
                        name="chevron"
                        className="teacher-sidebar-chevron"
                      />
                    </button>
                    <div
                      id={groupId}
                      className="teacher-sidebar-children"
                      hidden={!open || (collapsed && !mobileOpen)}
                    >
                      {group.children.map((child, childIndex) => {
                        const selected = isChildActive(
                          child.resolvedUrl,
                          allChildren,
                        );
                        return (
                          <Link
                            key={`${child.resolvedUrl}-${childIndex}`}
                            to={child.resolvedUrl}
                            className={`teacher-sidebar-child ${selected ? "is-active" : ""}`}
                            aria-current={selected ? "page" : undefined}
                            onClick={onCloseMobile}
                          >
                            {child.name}
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </nav>
        <div className="teacher-sidebar-bottom">
          {showSettings && (
            <Link
              to="/teacher/settings"
              className={`teacher-sidebar-settings ${location.pathname.startsWith("/teacher/settings") ? "is-active" : ""}`}
              onClick={onCloseMobile}
              aria-current={
                location.pathname.startsWith("/teacher/settings")
                  ? "page"
                  : undefined
              }
              title="관리자 설정"
            >
              <TeacherNavigationIcon name="settings" />
              <span className="teacher-sidebar-label">설정</span>
            </Link>
          )}
          <button
            type="button"
            className="teacher-sidebar-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
            aria-expanded={!collapsed}
          >
            <TeacherNavigationIcon name="collapse" />
          </button>
        </div>
      </aside>
    </>
  );
};

export default TeacherSidebar;
