import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import BrandLogo from "../common/BrandLogo";
import { preloadStudentWeplay } from "../../lib/weplayPreload";
import TeacherNavigationIcon, {
  type TeacherIconName,
} from "./TeacherNavigationIcon";

export interface TeacherSidebarGroup {
  id: string;
  name: string;
  compactName?: string;
  icon: TeacherIconName;
  children: Array<{
    name: string;
    resolvedUrl: string;
    children?: Array<{ name: string; resolvedUrl: string }>;
  }>;
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
  const myPageGroup =
    portal === "student"
      ? groups.find((group) => group.id === "mypage" && group.directUrl)
      : undefined;
  const primaryGroups = groups.filter((group) => group !== myPageGroup);
  const bottomLink =
    portal === "teacher" && showSettings
      ? {
          url: "/teacher/settings",
          label: "설정",
          title: "관리자 설정",
          compactLabel: "설정",
          icon: "settings" as const,
        }
      : myPageGroup
        ? {
            url: myPageGroup.directUrl || "/student/mypage",
            label: myPageGroup.name,
            title: myPageGroup.name,
            compactLabel: myPageGroup.compactName || myPageGroup.name,
            icon: myPageGroup.icon,
          }
        : undefined;
  const bottomLinkActive = bottomLink
    ? location.pathname === bottomLink.url.split("?")[0] ||
      location.pathname.startsWith(`${bottomLink.url.split("?")[0]}/`)
    : false;
  const getLeaves = (group: TeacherSidebarGroup) =>
    group.children.flatMap((child) =>
      child.children?.length ? child.children : [child],
    );
  const allChildren = groups.flatMap(getLeaves);
  const activeMenuGroup = groups.find((group) =>
    getLeaves(group).some((child) =>
      isChildActive(child.resolvedUrl, allChildren),
    ),
  );
  const activeGroup = activeMenuGroup?.id;
  const activeAccordionGroup =
    activeMenuGroup && !activeMenuGroup.directUrl ? activeMenuGroup.id : null;
  const activeNestedIndex = activeMenuGroup?.children.findIndex((child) =>
    child.children?.some((leaf) =>
      isChildActive(leaf.resolvedUrl, allChildren),
    ),
  );
  const activeNestedGroup =
    activeAccordionGroup &&
    activeNestedIndex !== undefined &&
    activeNestedIndex >= 0
      ? `${portal}-menu-${activeAccordionGroup}-child-${activeNestedIndex}`
      : null;
  const [openGroup, setOpenGroup] = useState<string | null>(
    activeAccordionGroup,
  );
  const [openNestedGroup, setOpenNestedGroup] = useState<string | null>(
    activeNestedGroup,
  );
  const [animatingGroups, setAnimatingGroups] = useState<string[]>([]);
  const menuAnimationTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);
  const previousMobileOpen = useRef(false);

  useEffect(() => {
    const focusedChild = panelRef.current?.contains(document.activeElement)
      ? document.activeElement?.closest(".teacher-sidebar-submenu")
      : null;
    const focusedNested = focusedChild
      ? document.activeElement?.closest(".teacher-sidebar-nested-menu")
      : null;
    const foldedMenuId =
      focusedChild?.id &&
      focusedChild.id !== `${portal}-menu-${activeAccordionGroup}`
        ? focusedChild.id
        : focusedNested?.id && focusedNested.id !== activeNestedGroup
          ? focusedNested.id
          : null;
    if (foldedMenuId) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(
          `button[aria-controls="${foldedMenuId}"]`,
        )
        ?.focus();
    }
    // Navigation reveals the selected group without moving focus from a child
    // that remains visible. A manual fold survives ordinary page rerenders.
    setOpenGroup(activeAccordionGroup);
    setOpenNestedGroup(activeNestedGroup);
    setAnimatingGroups([]);
    window.clearTimeout(menuAnimationTimer.current);
  }, [
    location.pathname,
    location.search,
    activeGroup,
    activeAccordionGroup,
    activeNestedGroup,
    portal,
  ]);

  useEffect(() => () => window.clearTimeout(menuAnimationTimer.current), []);

  useEffect(() => {
    if (!mobileOpen) {
      if (previousMobileOpen.current) {
        document
          .getElementById(`${navigationId}-toggle`)
          ?.focus({ preventScroll: true });
      }
      previousMobileOpen.current = false;
      return;
    }
    previousMobileOpen.current = true;
    const panel = panelRef.current;
    panel
      ?.querySelector<HTMLButtonElement>(".teacher-sidebar-close")
      ?.focus({ preventScroll: true });
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
              <BrandLogo
                variant={collapsed && !mobileOpen ? "mark" : "full"}
                className="teacher-sidebar-wordmark"
                decorative
              />
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
          {primaryGroups.map((group, index) => {
            const open = openGroup === group.id;
            const expanded = open && (!collapsed || mobileOpen);
            const animating = animatingGroups.includes(group.id);
            const active = activeGroup === group.id;
            const divider =
              group.secondary && !primaryGroups[index - 1]?.secondary;
            const groupId = `${portal}-menu-${group.id}`;
            return (
              <div
                key={group.id}
                className={`teacher-sidebar-group ${divider ? "has-divider" : ""}`}
                onPointerEnter={
                  portal === "student" && group.id === "weplay"
                    ? preloadStudentWeplay
                    : undefined
                }
                onFocus={
                  portal === "student" && group.id === "weplay"
                    ? preloadStudentWeplay
                    : undefined
                }
                onPointerDown={
                  portal === "student" && group.id === "weplay"
                    ? preloadStudentWeplay
                    : undefined
                }
              >
                {group.directUrl ? (
                  <Link
                    to={group.directUrl}
                    className={`teacher-sidebar-item ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    aria-label={group.name}
                    onClick={onCloseMobile}
                    title={group.name}
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
                        {group.compactName || group.name}
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
                      title={group.name}
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
                          {group.compactName || group.name}
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
                            if (child.children?.length) {
                              const nestedId = `${groupId}-child-${childIndex}`;
                              const nestedExpanded =
                                expanded && openNestedGroup === nestedId;
                              const selected = child.children.some((leaf) =>
                                isChildActive(leaf.resolvedUrl, allChildren),
                              );
                              return (
                                <div key={`${child.resolvedUrl}-${childIndex}`}>
                                  <button
                                    type="button"
                                    className={`teacher-sidebar-child teacher-sidebar-nested-toggle ${selected ? "is-active" : ""}`}
                                    aria-label={child.name}
                                    aria-expanded={nestedExpanded}
                                    aria-controls={nestedId}
                                    tabIndex={expanded ? undefined : -1}
                                    onClick={() =>
                                      setOpenNestedGroup((previous) =>
                                        previous === nestedId ? null : nestedId,
                                      )
                                    }
                                  >
                                    <span>{child.name}</span>
                                    <TeacherNavigationIcon
                                      name="chevron"
                                      className="teacher-sidebar-chevron"
                                    />
                                  </button>
                                  <div
                                    id={nestedId}
                                    className="teacher-sidebar-nested-menu"
                                    hidden={!nestedExpanded}
                                    aria-hidden={!nestedExpanded}
                                  >
                                    {child.children.map((leaf, leafIndex) => {
                                      const leafSelected = isChildActive(
                                        leaf.resolvedUrl,
                                        allChildren,
                                      );
                                      return (
                                        <Link
                                          key={`${leaf.resolvedUrl}-${leafIndex}`}
                                          to={leaf.resolvedUrl}
                                          className={`teacher-sidebar-child ${leafSelected ? "is-active" : ""}`}
                                          aria-current={
                                            leafSelected ? "page" : undefined
                                          }
                                          tabIndex={
                                            nestedExpanded ? undefined : -1
                                          }
                                          onClick={onCloseMobile}
                                        >
                                          {leaf.name}
                                        </Link>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }
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
          {bottomLink && (
            <Link
              to={bottomLink.url}
              className={`teacher-sidebar-settings ${bottomLinkActive ? "is-active" : ""}`}
              onClick={onCloseMobile}
              aria-current={bottomLinkActive ? "page" : undefined}
              aria-label={bottomLink.label}
              title={bottomLink.title}
            >
              <TeacherNavigationIcon name={bottomLink.icon} />
              <span className="teacher-sidebar-label">
                <span className="teacher-sidebar-full-label">
                  {bottomLink.label}
                </span>
                <span
                  className="teacher-sidebar-compact-label"
                  aria-hidden="true"
                >
                  {bottomLink.compactLabel}
                </span>
              </span>
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
