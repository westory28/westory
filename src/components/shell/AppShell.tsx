import React from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../common/Header";
import Footer from "../common/Footer";
import PageHeader from "../common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useShellViewport } from "../../hooks/useShellViewport";
import {
  NAVIGATION_REGISTRY,
  getActiveNavigationItemId,
  isNavigationChildActive,
  isNavigationItemActive,
  type ShellNavigationItem,
} from "../../constants/routeMetadata";
import type { MenuConfig, MenuItem } from "../../constants/menus";
import {
  canAccessTeacherPath,
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
  isActive?: boolean;
}> = ({ item, pathname, search, isActive }) => {
  const active = isActive ?? isNavigationItemActive(item, pathname, search);
  return (
    <Link
      to={item.to}
      className={`ws-shell-nav-link ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <NavigationIcon path={item.iconPath} />
      <span>{item.label}</span>
    </Link>
  );
};

const parseNavigationTarget = (to: string) => {
  const [pathname, search = ""] = to.split("?");
  return { pathname, search: search ? `?${search}` : "" };
};

const getNavigationMatchPrefixes = (
  to: string,
  children: ShellNavigationItem["children"] = [],
) => [
  ...new Set(
    [to, ...(children || []).map((child) => child.to)].map(
      (target) => parseNavigationTarget(target).pathname,
    ),
  ),
];

export const mergeConfiguredNavigation = (
  registry: ShellNavigationItem[],
  configuredItems: MenuItem[] | undefined,
) => {
  if (!configuredItems?.length) return registry;

  const configuredTargets = new Set(
    configuredItems.flatMap((item) => [
      item.url,
      ...(item.children || []).map((child) => child.url),
    ]),
  );
  const findTemplate = (target: string) => {
    for (const item of registry) {
      if ((item.menuConfigUrl || item.to) === target || item.to === target) {
        return { item, allowed: item.allowed };
      }
      const child = (item.children || []).find(
        (candidate) => candidate.to === target,
      );
      if (child) {
        return {
          item,
          allowed: child.allowed,
          description: child.description,
        };
      }
    }
    return null;
  };
  const remainingItems = [...registry];
  const configuredNavigation = configuredItems.map(
    (configuredItem, configuredIndex) => {
      const registryIndex = remainingItems.findIndex(
        (item) =>
          (item.menuConfigUrl || item.to) === configuredItem.url ||
          item.to === configuredItem.url,
      );
      const registryItem =
        registryIndex >= 0
          ? remainingItems.splice(registryIndex, 1)[0]
          : undefined;
      const template = registryItem
        ? { item: registryItem, allowed: registryItem.allowed }
        : findTemplate(configuredItem.url);
      const configuredChildren = (configuredItem.children || []).flatMap(
        (configuredChild) => {
          if (configuredChild.hidden === true) return [];
          const childTemplate = findTemplate(configuredChild.url);
          return [
            {
              ...(childTemplate?.description
                ? { description: childTemplate.description }
                : {}),
              ...(childTemplate?.allowed
                ? { allowed: childTemplate.allowed }
                : {}),
              label: configuredChild.name,
              to: configuredChild.url,
            },
          ];
        },
      );
      const supplementalChildren = (registryItem?.children || []).filter(
        (child) => !configuredTargets.has(child.to),
      );
      const target = parseNavigationTarget(configuredItem.url);
      const targetQuery = Object.fromEntries(
        new URLSearchParams(target.search).entries(),
      );
      const children = [...configuredChildren, ...supplementalChildren];

      return {
        ...(registryItem || {}),
        id: registryItem?.id || `configured-menu-${configuredIndex}`,
        label: configuredItem.name,
        to: configuredItem.url,
        menuConfigUrl: configuredItem.url,
        iconPath:
          configuredItem.icon ||
          template?.item.iconPath ||
          registry[0].iconPath,
        matchPrefixes: getNavigationMatchPrefixes(configuredItem.url, children),
        query:
          Object.keys(targetQuery).length > 0
            ? targetQuery
            : registryItem?.query,
        children: children.length > 0 ? children : undefined,
        allowed: registryItem?.allowed || template?.allowed,
      };
    },
  );

  const supplementalNavigation = remainingItems.flatMap((item) => {
    const ownTargetConfigured =
      configuredTargets.has(item.to) ||
      Boolean(item.menuConfigUrl && configuredTargets.has(item.menuConfigUrl));
    const remainingChildren = (item.children || []).filter(
      (child) => !configuredTargets.has(child.to),
    );
    if (ownTargetConfigured && remainingChildren.length === 0) return [];
    return [
      {
        ...item,
        to: ownTargetConfigured ? remainingChildren[0].to : item.to,
        matchPrefixes: getNavigationMatchPrefixes(
          ownTargetConfigured ? remainingChildren[0].to : item.to,
          remainingChildren,
        ),
        children: item.children ? remainingChildren : undefined,
      },
    ];
  });

  return [...configuredNavigation, ...supplementalNavigation];
};

const getVisibleStudentNavigation = (
  config: ReturnType<typeof useAuth>["config"],
  menuConfig: ReturnType<typeof useAuth>["menuConfig"],
) =>
  mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.student,
    menuConfig?.student,
  ).flatMap((item) => {
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

const getVisibleTeacherNavigation = (
  userData: ReturnType<typeof useAuth>["userData"],
  email?: string | null,
  menuConfig?: MenuConfig | null,
) =>
  mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.teacher,
    menuConfig?.teacher,
  ).flatMap((item) => {
    const ownTargetAllowed = item.allowed
      ? item.allowed(userData, email)
      : canAccessTeacherPath(
          parseNavigationTarget(item.to).pathname,
          userData,
          email,
        );
    const visibleChildren = (item.children || []).filter((child) =>
      child.allowed
        ? child.allowed(userData, email)
        : canAccessTeacherPath(
            parseNavigationTarget(child.to).pathname,
            userData,
            email,
          ),
    );
    if (!ownTargetAllowed && visibleChildren.length === 0) return [];
    return [
      {
        ...item,
        to: ownTargetAllowed ? item.to : visibleChildren[0].to,
        children: item.children ? visibleChildren : undefined,
      },
    ];
  });

const STUDENT_BOTTOM_NAVIGATION_IDS = [
  "student-today",
  "student-learning",
  "student-assessment",
  "student-grade",
] as const;

const getStudentBottomNavigation = (items: ShellNavigationItem[]) => {
  const primaryItems = STUDENT_BOTTOM_NAVIGATION_IDS.flatMap((id) => {
    const item = items.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  const primaryIds = new Set(primaryItems.map((item) => item.id));
  const secondaryItems = items.filter((item) => !primaryIds.has(item.id));
  if (secondaryItems.length === 0) return primaryItems;

  const moreSource =
    secondaryItems.find((item) => item.id === "student-mypage") ||
    secondaryItems[0];
  const moreItem: ShellNavigationItem = {
    id: "student-more",
    label: "더보기",
    to: moreSource.to,
    iconPath: moreSource.iconPath,
    matchPrefixes: [
      ...new Set(secondaryItems.flatMap((item) => item.matchPrefixes)),
    ],
  };

  return [...primaryItems, moreItem];
};

const StudentBottomNavigation: React.FC<{
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  onOpenMore: () => void;
  moreButtonRef: React.RefObject<HTMLButtonElement>;
  moreOpen: boolean;
}> = ({ items, pathname, search, onOpenMore, moreButtonRef, moreOpen }) => {
  const activeItemId = getActiveNavigationItemId(items, pathname, search);
  return (
    <nav className="ws-student-bottom-nav" aria-label="학생 주요 메뉴">
      {items.map((item) => {
        const active = item.id === activeItemId;
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
            isActive={active}
          />
        );
      })}
    </nav>
  );
};

const GlobalNavigation: React.FC<{
  items: ShellNavigationItem[];
  pathname: string;
  search: string;
  audience: "student" | "teacher";
}> = ({ items, pathname, search, audience }) => {
  const [openItemId, setOpenItemId] = React.useState<string | null>(null);
  const navRef = React.useRef<HTMLElement>(null);
  const triggerRefs = React.useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const activeItemId = getActiveNavigationItemId(items, pathname, search);

  React.useEffect(() => {
    setOpenItemId(null);
  }, [pathname, search]);

  React.useEffect(() => {
    if (!openItemId) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) {
        setOpenItemId(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [openItemId]);

  const closeAndRestoreFocus = (itemId: string) => {
    setOpenItemId(null);
    window.requestAnimationFrame(() => triggerRefs.current[itemId]?.focus());
  };

  return (
    <nav
      ref={navRef}
      className={`ws-global-navigation ws-global-navigation--${audience}`}
      aria-label={
        audience === "student" ? "학생 전체 메뉴" : "교직원 전체 메뉴"
      }
    >
      <div className="ws-global-navigation__inner">
        {items.map((item) => {
          const children = item.children || [];
          const active = item.id === activeItemId;
          const open = openItemId === item.id;

          if (children.length === 0) {
            return (
              <div key={item.id} className="ws-global-navigation__item">
                <NavigationLink
                  item={item}
                  pathname={pathname}
                  search={search}
                  isActive={active}
                />
              </div>
            );
          }

          const dropdownId = `ws-global-navigation-${item.id}`;
          return (
            <div
              key={item.id}
              className={`ws-global-navigation__item ${open ? "is-open" : ""}`}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setOpenItemId((current) =>
                    current === item.id ? null : current,
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeAndRestoreFocus(item.id);
                }
              }}
            >
              <button
                ref={(element) => {
                  triggerRefs.current[item.id] = element;
                }}
                type="button"
                className={`ws-shell-nav-link ws-global-navigation__trigger ${active ? "is-active" : ""}`}
                aria-expanded={open}
                aria-controls={dropdownId}
                aria-current={active ? "location" : undefined}
                onClick={() =>
                  setOpenItemId((current) =>
                    current === item.id ? null : item.id,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setOpenItemId(item.id);
                  window.requestAnimationFrame(() => {
                    document
                      .getElementById(dropdownId)
                      ?.querySelector<HTMLElement>("a[href]")
                      ?.focus();
                  });
                }}
              >
                <NavigationIcon path={item.iconPath} />
                <span>{item.label}</span>
                <span
                  className="ws-global-navigation__chevron"
                  aria-hidden="true"
                />
              </button>
              <div
                id={dropdownId}
                className="ws-global-navigation__dropdown"
                aria-hidden={!open}
              >
                {children.map((child, childIndex) => {
                  const childActive =
                    active &&
                    isNavigationChildActive(child, children, pathname, search);
                  const childTarget = parseNavigationTarget(child.to);
                  return (
                    <Link
                      key={`${child.to}:${child.label}:${childIndex}`}
                      to={child.to}
                      className={`ws-global-navigation__child ${childActive ? "is-active" : ""}`}
                      aria-current={childActive ? "page" : undefined}
                      onClick={() => {
                        setOpenItemId(null);
                        if (childTarget.pathname !== pathname) return;
                        window.requestAnimationFrame(() => {
                          document
                            .getElementById("westory-main-content")
                            ?.focus();
                        });
                      }}
                    >
                      <strong>{child.label}</strong>
                      {child.description && <span>{child.description}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
};

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
    () => getVisibleTeacherNavigation(userData, currentUser?.email, menuConfig),
    [currentUser?.email, menuConfig, userData],
  );
  const studentItems = React.useMemo(
    () => getVisibleStudentNavigation(config, menuConfig),
    [config, menuConfig],
  );
  const studentBottomItems = React.useMemo(
    () => getStudentBottomNavigation(studentItems),
    [studentItems],
  );
  const teacherDrawer =
    isTeacherPortal && (viewport === "mobile" || viewport === "tablet");
  const teacherDesktopNav =
    isTeacherPortal && (viewport === "compact" || viewport === "desktop");
  const studentMobileNav =
    !isTeacherPortal && (viewport === "mobile" || viewport === "tablet");
  const studentDesktopNav =
    !isTeacherPortal && (viewport === "compact" || viewport === "desktop");
  const desktopNavigation = teacherDesktopNav || studentDesktopNav;

  React.useEffect(() => {
    setDrawerOpen(false);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("westory-main-content")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  React.useEffect(() => {
    if (drawerOpen && !teacherDrawer && !studentMobileNav) {
      setDrawerOpen(false);
    }
  }, [drawerOpen, studentMobileNav, teacherDrawer]);

  return (
    <div
      className={`ws-app-shell ${isTeacherPortal ? "ws-app-shell--teacher" : "ws-app-shell--student"} ${isAdmin ? "ws-app-shell--admin" : ""} ${desktopNavigation ? "ws-app-shell--desktop-navigation" : ""}`}
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
          teacherDrawer ? () => setDrawerOpen((open) => !open) : undefined
        }
        navigationButtonRef={teacherMenuButtonRef}
      />
      {desktopNavigation && (
        <GlobalNavigation
          items={isTeacherPortal ? teacherItems : studentItems}
          pathname={location.pathname}
          search={location.search}
          audience={isTeacherPortal ? "teacher" : "student"}
        />
      )}
      <div className="ws-app-shell__body">
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
          items={studentBottomItems}
          pathname={location.pathname}
          search={location.search}
          onOpenMore={() => setDrawerOpen(true)}
          moreButtonRef={studentMoreButtonRef}
          moreOpen={drawerOpen}
        />
      )}
      {teacherDrawer && (
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
      {studentMobileNav && (
        <NavigationDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="전체 메뉴"
          items={studentItems}
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
