import React from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../common/Header";
import Footer from "../common/Footer";
import PageHeader from "../common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useShellViewport } from "../../hooks/useShellViewport";
import {
  STUDENT_GLOBAL_NAVIGATION,
  TEACHER_GLOBAL_NAVIGATION,
  isNavigationItemActive,
  type ShellNavigationItem,
} from "../../constants/routeMetadata";
import {
  canAccessTeacherPortal,
  canManageSettings,
} from "../../lib/permissions";
import { getStudentRouteAccess } from "../../lib/studentMenuAccess";
import NavigationDrawer from "./NavigationDrawer";
import NavigationIcon from "./NavigationIcon";

const NavigationLink: React.FC<{
  item: ShellNavigationItem;
  pathname: string;
  search: string;
  compact?: boolean;
}> = ({ item, pathname, search, compact = false }) => {
  const active = isNavigationItemActive(item, pathname, search);
  return (
    <Link
      to={item.to}
      className={`ws-shell-nav-link ${active ? "is-active" : ""} ${compact ? "is-compact" : ""}`}
      aria-current={active ? "page" : undefined}
      title={compact ? item.label : undefined}
    >
      <NavigationIcon path={item.iconPath} />
      <span>{compact ? item.shortLabel || item.label : item.label}</span>
    </Link>
  );
};

const parseNavigationTarget = (to: string) => {
  const [pathname, search = ""] = to.split("?");
  return { pathname, search: search ? `?${search}` : "" };
};

const getVisibleStudentNavigation = (
  config: ReturnType<typeof useAuth>["config"],
  menuConfig: ReturnType<typeof useAuth>["menuConfig"],
) =>
  STUDENT_GLOBAL_NAVIGATION.flatMap((item) => {
    const visibleChildren = (item.children || []).filter(
      (child) =>
        getStudentRouteAccess(
          parseNavigationTarget(child.to),
          config,
          menuConfig,
        ).allowed,
    );
    const ownTargetAllowed = getStudentRouteAccess(
      parseNavigationTarget(item.to),
      config,
      menuConfig,
    ).allowed;
    if (!ownTargetAllowed && visibleChildren.length === 0) return [];
    return [
      {
        ...item,
        to: ownTargetAllowed ? item.to : visibleChildren[0].to,
        children: item.children ? visibleChildren : undefined,
      },
    ];
  });

const StudentBottomNavigation: React.FC<{
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  onOpenMore: () => void;
  moreButtonRef: React.RefObject<HTMLButtonElement>;
  moreOpen: boolean;
}> = ({ items, pathname, search, onOpenMore, moreButtonRef, moreOpen }) => (
  <nav className="ws-student-bottom-nav" aria-label="학생 주요 메뉴">
    {items.map((item) => {
      const active = isNavigationItemActive(item, pathname, search);
      if (item.id === "student-more") {
        return (
          <button
            key={item.id}
            ref={moreButtonRef}
            type="button"
            className={`ws-shell-nav-link ${active ? "is-active" : ""}`}
            onClick={onOpenMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-controls="westory-shell-navigation"
            aria-current={active ? "page" : undefined}
          >
            <NavigationIcon path={item.iconPath} />
            <span>{item.label}</span>
          </button>
        );
      }
      return (
        <NavigationLink
          key={item.id}
          item={item}
          pathname={pathname}
          search={search}
        />
      );
    })}
  </nav>
);

const StudentTopNavigation: React.FC<{
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  onOpenMore: () => void;
  moreButtonRef: React.RefObject<HTMLButtonElement>;
  moreOpen: boolean;
}> = ({ items, pathname, search, onOpenMore, moreButtonRef, moreOpen }) => (
  <nav className="ws-student-top-nav" aria-label="학생 주요 메뉴">
    {items.map((item) => {
      const active = isNavigationItemActive(item, pathname, search);
      if (item.id === "student-more") {
        return (
          <button
            key={item.id}
            ref={moreButtonRef}
            type="button"
            className={`ws-shell-nav-link ${active ? "is-active" : ""}`}
            onClick={onOpenMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-controls="westory-shell-navigation"
            aria-current={active ? "page" : undefined}
          >
            <NavigationIcon path={item.iconPath} />
            <span>{item.label}</span>
          </button>
        );
      }
      return (
        <NavigationLink
          key={item.id}
          item={item}
          pathname={pathname}
          search={search}
        />
      );
    })}
  </nav>
);

const TeacherNavigation: React.FC<{
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  compact: boolean;
}> = ({ items, pathname, search, compact }) => (
  <nav
    className={`ws-teacher-navigation ${compact ? "is-compact" : ""}`}
    aria-label="교직원 주요 메뉴"
  >
    <p className="ws-teacher-navigation__label">
      {compact ? "업무" : "업무 영역"}
    </p>
    {items.map((item) => (
      <NavigationLink
        key={item.id}
        item={item}
        pathname={pathname}
        search={search}
        compact={compact}
      />
    ))}
  </nav>
);

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, userData, config, menuConfig } = useAuth();
  const location = useLocation();
  const viewport = useShellViewport();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const teacherMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const studentMoreButtonRef = React.useRef<HTMLButtonElement>(null);
  const isStudentPath = location.pathname.startsWith("/student");
  const isTeacherPortal =
    location.pathname.startsWith("/teacher") ||
    (!isStudentPath && canAccessTeacherPortal(userData, currentUser?.email));
  const isAdmin = canManageSettings(userData, currentUser?.email);
  const teacherItems = React.useMemo(
    () =>
      TEACHER_GLOBAL_NAVIGATION.filter(
        (item) => !item.allowed || item.allowed(userData, currentUser?.email),
      ),
    [currentUser?.email, userData],
  );
  const studentItems = React.useMemo(
    () => getVisibleStudentNavigation(config, menuConfig),
    [config, menuConfig],
  );
  const studentMoreItem = studentItems.find(
    (item) => item.id === "student-more",
  );
  const teacherMobile = isTeacherPortal && viewport === "mobile";
  const teacherCompact =
    isTeacherPortal && (viewport === "tablet" || viewport === "compact");
  const teacherDesktop = isTeacherPortal && viewport === "desktop";
  const studentMobileNav =
    !isTeacherPortal && (viewport === "mobile" || viewport === "tablet");
  const studentDesktopNav =
    !isTeacherPortal && (viewport === "compact" || viewport === "desktop");

  React.useEffect(() => {
    setDrawerOpen(false);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("westory-main-content")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  React.useEffect(() => {
    if (
      drawerOpen &&
      ((isTeacherPortal && !teacherMobile) ||
        (!isTeacherPortal && !studentMobileNav && !studentDesktopNav))
    ) {
      setDrawerOpen(false);
    }
  }, [
    drawerOpen,
    isTeacherPortal,
    studentDesktopNav,
    studentMobileNav,
    teacherMobile,
  ]);

  return (
    <div
      className={`ws-app-shell ${isTeacherPortal ? "ws-app-shell--teacher" : "ws-app-shell--student"} ${isAdmin ? "ws-app-shell--admin" : ""}`}
    >
      <a
        className="ws-skip-link"
        href="#westory-main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("westory-main-content");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        본문으로 바로가기
      </a>
      <Header
        shellMode
        navigationOpen={drawerOpen}
        onNavigationToggle={
          teacherMobile ? () => setDrawerOpen((open) => !open) : undefined
        }
        navigationButtonRef={teacherMenuButtonRef}
      />
      {studentDesktopNav && (
        <StudentTopNavigation
          items={studentItems}
          pathname={location.pathname}
          search={location.search}
          onOpenMore={() => setDrawerOpen(true)}
          moreButtonRef={studentMoreButtonRef}
          moreOpen={drawerOpen}
        />
      )}
      <div className="ws-app-shell__body">
        {(teacherCompact || teacherDesktop) && (
          <aside className="ws-app-shell__sidebar">
            <TeacherNavigation
              items={teacherItems}
              pathname={location.pathname}
              search={location.search}
              compact={teacherCompact}
            />
          </aside>
        )}
        <div className="ws-app-shell__workspace">
          <PageHeader />
          <main
            id="westory-main-content"
            className="ws-app-shell__content"
            tabIndex={-1}
          >
            {children}
          </main>
          <Footer />
        </div>
      </div>
      {studentMobileNav && (
        <StudentBottomNavigation
          items={studentItems}
          pathname={location.pathname}
          search={location.search}
          onOpenMore={() => setDrawerOpen(true)}
          moreButtonRef={studentMoreButtonRef}
          moreOpen={drawerOpen}
        />
      )}
      {teacherMobile && (
        <NavigationDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="업무 메뉴"
          items={teacherItems}
          pathname={location.pathname}
          search={location.search}
          mode="teacher"
          opener={teacherMenuButtonRef}
        />
      )}
      {!isTeacherPortal && studentMoreItem && (
        <NavigationDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="더보기"
          items={[studentMoreItem]}
          pathname={location.pathname}
          search={location.search}
          mode="student-more"
          opener={studentMoreButtonRef}
        />
      )}
    </div>
  );
};

export const StudentShell = AppShell;
export const TeacherShell = AppShell;
export const AdminShell = AppShell;
export default AppShell;
