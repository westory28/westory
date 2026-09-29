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
  portal?: "teacher" | "student";
  groups: TeacherSidebarGroup[];
  home: string;
  semesterLabel?: string;
  showDashboard: boolean;
  showSettings: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  mobileAccount?: React.ReactNode;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  isChildActive: (
    url: string,
    siblings: Array<{ resolvedUrl: string }>,
  ) => boolean;
}

const compactLabels: Record<string, string> = {
  lesson: "학습 자료",
  quiz: "평가",
  exam: "점수",
  points: "위스",
  weplay: "위플레이",
  students: "학생",
};

const TeacherSidebar: React.FC<TeacherSidebarProps> = ({
  portal = "teacher",
  groups,
  home,
  semesterLabel,
  showDashboard,
  showSettings,
  collapsed,
  mobileOpen,
  mobileAccount,
  onToggleCollapsed,
  onCloseMobile,
  isChildActive,
}) => {
  const location = useLocation();
  const navigationId = `${portal}-navigation`;
  const portalLabel = portal === "student" ? "학생" : "교사";
  const homeLabel = portal === "student" ? "첫 화면" : "대시보드";
  const allChildren = groups.flatMap((group) => group.children);
  const activeGroup = groups.find((group) =>
    group.children.some((child) =>
      isChildActive(child.resolvedUrl, allChildren),
    ),
  )?.id;
  const [openGroup, setOpenGroup] = useState<string | null>(
    activeGroup || null,
  );
  const [animatingGroups, setAnimatingGroups] = useState<string[]>([]);
  const menuAnimationTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);
  const previousMobileOpen = useRef(false);

  useEffect(() => {
    setOpenGroup(activeGroup || null);
    setAnimatingGroups([]);
    window.clearTimeout(menuAnimationTimer.current);
  }, [location.pathname, location.search, activeGroup]);

  useEffect(() => () => window.clearTimeout(menuAnimationTimer.current), []);

  useEffect(() => {
    if (!mobileOpen) {
      if (previousMobileOpen.current) {
        document.getElementById(`${navigationId}-toggle`)?.focus();
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
      ).filter(
        (element) =>
          element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
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
  }, [mobileOpen, onCloseMobile, navigationId]);

  const toggleGroup = (id: string) => {
    if (collapsed && !mobileOpen) onToggleCollapsed();
    const nextGroup =
      openGroup === id && (!collapsed || mobileOpen) ? null : id;
    setAnimatingGroups(
      [openGroup, nextGroup].filter((group): group is string => Boolean(group)),
    );
    setOpenGroup(nextGroup);
    window.clearTimeout(menuAnimationTimer.current);
    menuAnimationTimer.current = window.setTimeout(
      () => setAnimatingGroups([]),
      240,
    );
  };
  const dashboardActive = location.pathname === home && !activeGroup;

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
        id={navigationId}
        ref={panelRef}
        className={`teacher-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label={`${portalLabel} 메뉴`}
      >
        <div className="teacher-sidebar-brand-row">
          <div className="teacher-sidebar-brand-content">
            <Link
              to={home}
              className="teacher-sidebar-brand"
              onClick={onCloseMobile}
              aria-label="Westory 첫 화면"
              title={collapsed ? semesterLabel : undefined}
            >
              <span className="teacher-sidebar-wordmark">
                <span className="logo-we">We</span>
                <span className="logo-story">story</span>
              </span>
              <span className="teacher-sidebar-tagline">
                우리가 써 내려가는 이야기
              </span>
            </Link>
            {semesterLabel && (
              <span className="teacher-brand-semester teacher-sidebar-semester">
                {semesterLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            className="teacher-sidebar-close"
            onClick={onCloseMobile}
            aria-label="메뉴 닫기"
          >
            <TeacherNavigationIcon name="close" />
          </button>
        </div>
        {mobileAccount && (
          <div className="teacher-mobile-account">{mobileAccount}</div>
        )}
        <nav
          className="teacher-sidebar-nav"
          aria-label={`${portalLabel} 주 메뉴`}
        >
          {showDashboard && (
            <Link
              to={home}
              className={`teacher-sidebar-item ${dashboardActive ? "is-active" : ""}`}
              aria-current={dashboardActive ? "page" : undefined}
              onClick={onCloseMobile}
              title={collapsed ? homeLabel : undefined}
            >
              <TeacherNavigationIcon name="home" />
              <span className="teacher-sidebar-label">{homeLabel}</span>
            </Link>
          )}
          {groups.map((group, index) => {
            const open = openGroup === group.id;
            const expanded = open && (!collapsed || mobileOpen);
            const animating = animatingGroups.includes(group.id);
            const active = activeGroup === group.id;
            const divider = group.secondary && !groups[index - 1]?.secondary;
            const groupId = `${portal}-menu-${group.id}`;
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
                    aria-label={group.name}
                    onClick={onCloseMobile}
                    title={collapsed ? group.name : undefined}
                  >
                    <TeacherNavigationIcon name={group.icon} />
                    <span className="teacher-sidebar-label">
                      <span className="teacher-sidebar-full-label">
                        {group.name}
                      </span>
                      <span
                        className="teacher-sidebar-compact-label"
                        aria-hidden="true"
                      >
                        {compactLabels[group.id] || group.name}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`teacher-sidebar-item ${active ? "is-active" : ""} ${open ? "is-open" : ""}`}
                      aria-expanded={expanded}
                      aria-label={group.name}
                      aria-controls={groupId}
                      onClick={() => toggleGroup(group.id)}
                      title={collapsed ? group.name : undefined}
                    >
                      <TeacherNavigationIcon name={group.icon} />
                      <span className="teacher-sidebar-label">
                        <span className="teacher-sidebar-full-label">
                          {group.name}
                        </span>
                        <span
                          className="teacher-sidebar-compact-label"
                          aria-hidden="true"
                        >
                          {compactLabels[group.id] || group.name}
                        </span>
                      </span>
                      <TeacherNavigationIcon
                        name="chevron"
                        className="teacher-sidebar-chevron"
                      />
                    </button>
                    <div
                      id={groupId}
                      className={`teacher-sidebar-submenu ${expanded ? "is-expanded" : ""} ${animating ? "is-animating" : ""}`}
                      aria-hidden={!expanded}
                    >
                      <div className="teacher-sidebar-submenu-clip">
                        <div
                          className="teacher-sidebar-children"
                          hidden={!expanded && !animating}
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
                                tabIndex={expanded ? undefined : -1}
                                onClick={onCloseMobile}
                              >
                                {child.name}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </nav>
        <div className="teacher-sidebar-bottom">
          {portal === "teacher" && showSettings && (
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
            title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          >
            <TeacherNavigationIcon name="collapse" />
          </button>
        </div>
      </aside>
    </>
  );
};

export default TeacherSidebar;
