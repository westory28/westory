import { isSemesterArchive } from "../../lib/semesterArchive";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import PointRankBadge from "./PointRankBadge";
import { useAppToast } from "./AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import { MENUS } from "../../constants/menus";
import TeacherSidebar, {
  type TeacherSidebarGroup,
} from "../layout/TeacherSidebar";
import TeacherNavigationIcon, {
  type TeacherIconName,
} from "../layout/TeacherNavigationIcon";
import {
  getStudentRouteAccess,
  getStudentVisibleMenuItems,
} from "../../lib/studentMenuAccess";
import { runAfterNextPaint } from "../../lib/browserTasks";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { getDefaultProfileEmojiValue } from "../../lib/profileEmojis";
import {
  readLocalOnly,
  removeStorage,
  writeLocalOnly,
} from "../../lib/safeStorage";
import {
  getSessionChangeActivityTarget,
  getSessionActivityTarget,
  isSessionActivityIgnored,
  SESSION_ACTIVITY_EVENT,
} from "../../lib/sessionActivity";
import type { PointRankDisplay } from "../../lib/pointRanks";
import {
  canAccessTeacherPortal,
  canAccessTeacherPath,
  canManageSettings,
  canReadLessonManagement,
  canReadPoints,
  canReadQuizManagement,
  canReadStudentList,
  getDefaultTeacherRoute,
} from "../../lib/permissions";

const SESSION_DURATION_SECONDS = 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;
const SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
const SESSION_EXPIRY_KEY = "sessionExpiry";
const ROLE_SESSION_KEY = "westoryPortalRole";

const NotificationBell = lazyWithRetry(
  () => import("./NotificationBell"),
  "notification-bell",
);

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
};

const resolveMenuTarget = (url: string, portal: "student" | "teacher") => {
  const normalized = (url || "").trim();
  if (!normalized) return normalized;
  const canonicalRoot =
    portal === "teacher" ? "/teacher/quiz" : "/student/quiz";
  return /(^|\/)quiz\/history2(\/|$)|(^|\/)history2(\/|$)/.test(normalized)
    ? `${canonicalRoot}?menu=history2`
    : normalized;
};

const resolveChildMenuTarget = (
  parentUrl: string,
  childName: string,
  childUrl: string,
  portal: "student" | "teacher",
) => {
  const normalizedName = (childName || "").trim().toLowerCase();
  const normalizedParent = (parentUrl || "").trim();
  const canonicalRoot =
    portal === "teacher" ? "/teacher/quiz" : "/student/quiz";
  if (
    normalizedName === "역사2" &&
    normalizedParent.startsWith(canonicalRoot)
  ) {
    return `${canonicalRoot}?menu=history2`;
  }
  return resolveMenuTarget(childUrl, portal);
};

const getResolvedChildUrls = (
  parentUrl: string,
  children: Array<{ name: string; url: string }>,
  portal: "student" | "teacher",
) =>
  children.map((child) => ({
    ...child,
    resolvedUrl: resolveChildMenuTarget(
      parentUrl,
      child.name,
      child.url,
      portal,
    ),
  }));

const getDesktopSubmenuChildren = (
  parentUrl: string,
  children: Array<{ name: string; url: string; resolvedUrl: string }>,
) => {
  if (parentUrl !== "/student/score") return children;
  return children.filter(
    (child) =>
      child.resolvedUrl === "/student/score" ||
      child.resolvedUrl === "/student/score/report" ||
      child.resolvedUrl === "/student/score/performance" ||
      child.resolvedUrl === "/student/score/written-exam",
  );
};

const Header: React.FC<{
  teacherLayout?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}> = ({
  teacherLayout = false,
  sidebarCollapsed = false,
  onToggleSidebar = () => {},
}) => {
  const {
    currentUser,
    userData,
    logout,
    config,
    configReady,
    menuConfig,
    menuConfigReady,
  } = useAuth();
  const { showToast } = useAppToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(
    SESSION_DURATION_SECONDS,
  );
  const [studentRank, setStudentRank] = useState<PointRankDisplay | null>(null);
  const [profileFallbackIcon, setProfileFallbackIcon] = useState(
    getDefaultProfileEmojiValue(),
  );
  const [mobileUnreadCount, setMobileUnreadCount] = useState(0);
  const timeoutHandledRef = useRef(false);
  const sessionExpiryRef = useRef<number | null>(null);
  const lastSessionExtendAtRef = useRef(0);

  const isReady = !!currentUser;
  const isTeacherUser = canAccessTeacherPortal(
    userData,
    currentUser?.email || "",
  );
  const displayName = (userData?.name || "").trim() || "이름 미설정";

  const portal: "teacher" | "student" = location.pathname.startsWith("/teacher")
    ? "teacher"
    : location.pathname.startsWith("/student")
      ? "student"
      : isTeacherUser
        ? "teacher"
        : "student";

  const isTeacherPortal = portal === "teacher";
  const useTeacherSidebar = teacherLayout && isTeacherPortal;
  const canRenderStudentMenu =
    portal !== "student" ||
    (menuConfigReady &&
      configReady &&
      getStudentRouteAccess(
        { pathname: location.pathname, search: location.search },
        config,
        menuConfig,
      ).allowed);
  const baseMenuItems =
    portal === "student"
      ? canRenderStudentMenu && menuConfig
        ? getStudentVisibleMenuItems(menuConfig.student || [], config)
        : []
      : menuConfig?.teacher || MENUS.teacher || [];
  const menuItems =
    portal === "teacher"
      ? baseMenuItems.filter((item) => {
          if (item.url === "/teacher/lesson")
            return canReadLessonManagement(userData, currentUser?.email || "");
          if (item.url === "/teacher/quiz")
            return canReadQuizManagement(userData, currentUser?.email || "");
          if (item.url === "/teacher/students")
            return canReadStudentList(userData, currentUser?.email || "");
          if (item.url === "/teacher/points")
            return canReadPoints(userData, currentUser?.email || "");
          if (item.url === "/teacher/exam")
            return canManageSettings(userData, currentUser?.email || "");
          return false;
        })
      : baseMenuItems;
  const getVisibleChildren = (item: {
    children?: Array<{ hidden?: boolean; url: string; name: string }>;
  }) => {
    if (!item.children?.length) return [];
    return isTeacherPortal
      ? item.children
      : item.children.filter((child) => child.hidden !== true);
  };
  const home = isTeacherPortal
    ? getDefaultTeacherRoute(userData, currentUser?.email || "")
    : `/${portal}/dashboard`;
  const profileTarget = isTeacherPortal
    ? canManageSettings(userData, currentUser?.email || "")
      ? "/teacher/settings"
      : home
    : "/student/mypage";
  const profileLabel = `${displayName} ${isTeacherPortal ? "교사" : "학생"}`;
  const studentProfileIcon = userData?.profileIcon || profileFallbackIcon;
  const resolveTarget = (url: string) => resolveMenuTarget(url, portal);
  const mobileUnreadLabel =
    mobileUnreadCount > 99 ? "99+" : String(mobileUnreadCount);
  const desktopSubmenuParentUrls = new Set([
    "/student/lesson/note",
    "/student/quiz",
    "/student/score",
    "/teacher/lesson",
  ]);

  const isActive = (url: string) => {
    const [targetPath, targetQuery] = resolveTarget(url).split("?");
    if (!location.pathname.startsWith(targetPath)) return false;
    if (!targetQuery) return true;

    const currentParams = new URLSearchParams(location.search);
    const targetParams = new URLSearchParams(targetQuery);
    for (const [key, value] of targetParams.entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  };

  const getChildMatchScore = (
    resolvedUrl: string,
    siblings: Array<{ resolvedUrl: string }>,
  ) => {
    const [path, query] = resolvedUrl.split("?");
    const pathMatches =
      location.pathname === path || location.pathname.startsWith(`${path}/`);
    if (!pathMatches) return -1;

    const queryParams = new URLSearchParams(query || "");
    const currentParams = new URLSearchParams(location.search);
    for (const [key, value] of queryParams.entries()) {
      if (currentParams.get(key) !== value) return -1;
    }

    const hasQuerySiblingOnSamePath = siblings.some((sibling) => {
      const [siblingPath, siblingQuery] = sibling.resolvedUrl.split("?");
      return siblingPath === path && !!siblingQuery;
    });
    const noQueryPenalty =
      !query && hasQuerySiblingOnSamePath && location.search.length > 0
        ? -500
        : 0;

    return path.length * 10 + queryParams.size * 100 + noQueryPenalty;
  };

  const isChildActive = (
    resolvedUrl: string,
    siblings: Array<{ resolvedUrl: string }>,
  ) => {
    const targetScore = getChildMatchScore(resolvedUrl, siblings);
    if (targetScore < 0) return false;

    const bestScore = siblings.reduce((max, sibling) => {
      return Math.max(max, getChildMatchScore(sibling.resolvedUrl, siblings));
    }, -1);

    return targetScore === bestScore;
  };

  const teacherIcons: Record<string, TeacherIconName> = {
    "/teacher/lesson": "lesson",
    "/teacher/quiz": "assessment",
    "/teacher/exam": "score",
    "/teacher/points": "wis",
    "/teacher/students": "students",
  };
  const shopTabs = new Set(["products", "requests"]);
  const getShopTab = (url: string) => {
    const [path, query] = url.split("?");
    const tab = new URLSearchParams(query).get("tab") || "";
    return path === "/teacher/points" && shopTabs.has(tab) ? tab : "";
  };
  const dictionaryUrl = "/teacher/lesson/history-dictionary";
  const resolvedTeacherMenus = useTeacherSidebar
    ? menuItems.map((item) => ({
        ...item,
        resolvedChildren: getResolvedChildUrls(
          item.url,
          getVisibleChildren(item),
          portal,
        ),
      }))
    : [];
  const teacherSidebarGroups: TeacherSidebarGroup[] = resolvedTeacherMenus.map(
    (item) => {
      const children = item.resolvedChildren.filter(
        (child) =>
          !getShopTab(child.resolvedUrl) && child.resolvedUrl !== dictionaryUrl,
      );
      return {
        id: item.url.split("/").pop() || item.name,
        name: item.url === "/teacher/students" ? "학생 명단 관리" : item.name,
        icon: teacherIcons[item.url] || "lesson",
        directUrl: item.resolvedChildren.length
          ? undefined
          : resolveTarget(item.url),
        children: children.length
          ? children
          : [
              {
                name:
                  item.url === "/teacher/students" ? "학생 명단" : item.name,
                resolvedUrl: resolveTarget(item.url),
              },
            ],
      };
    },
  );
  if (
    useTeacherSidebar &&
    canAccessTeacherPath("/teacher/schedule", userData, currentUser?.email)
  ) {
    teacherSidebarGroups.push({
      id: "calendar",
      name: "캘린더",
      icon: "calendar",
      secondary: true,
      directUrl: "/teacher/schedule",
      children: [{ name: "학사 일정", resolvedUrl: "/teacher/schedule" }],
    });
  }
  if (useTeacherSidebar && canManageSettings(userData, currentUser?.email)) {
    teacherSidebarGroups.push({
      id: "notice",
      name: "알림장",
      icon: "notice",
      secondary: true,
      directUrl: "/teacher/dashboard?notice=manage",
      children: [
        {
          name: "알림장 관리",
          resolvedUrl: "/teacher/dashboard?notice=manage",
        },
      ],
    });
  }
  const configuredShopChildren = resolvedTeacherMenus
    .flatMap((item) => item.resolvedChildren)
    .filter((child) => getShopTab(child.resolvedUrl));
  // Keep configured labels and query parameters, and restore any supported
  // shop destination omitted from an older saved menu configuration.
  const configuredShopTabs = new Set(
    configuredShopChildren.map((child) => getShopTab(child.resolvedUrl)),
  );
  const defaultShopChildren = getResolvedChildUrls(
    "/teacher/points",
    MENUS.teacher.find((item) => item.url === "/teacher/points")?.children ||
      [],
    "teacher",
  ).filter(
    (child) =>
      getShopTab(child.resolvedUrl) &&
      !configuredShopTabs.has(getShopTab(child.resolvedUrl)),
  );
  const shopChildren = [...configuredShopChildren, ...defaultShopChildren];
  if (
    resolvedTeacherMenus.some((item) => item.url === "/teacher/points") &&
    shopChildren.length
  )
    teacherSidebarGroups.push({
      id: "shop",
      name: "상점",
      icon: "shop",
      secondary: true,
      children: shopChildren,
    });
  const dictionaryChild = resolvedTeacherMenus
    .flatMap((item) => item.resolvedChildren)
    .find((child) => child.resolvedUrl === dictionaryUrl);
  if (dictionaryChild)
    teacherSidebarGroups.push({
      id: "dictionary",
      name: "사전",
      icon: "dictionary",
      secondary: true,
      directUrl: dictionaryChild.resolvedUrl,
      children: [dictionaryChild],
    });

  const activeDesktopSubmenu = menuItems
    .map((item) => {
      const visibleChildren = getVisibleChildren(item);
      const resolvedChildren = getResolvedChildUrls(
        item.url,
        visibleChildren,
        portal,
      );
      const desktopChildren = getDesktopSubmenuChildren(
        item.url,
        resolvedChildren,
      );
      const active =
        isActive(item.url) ||
        desktopChildren.some((child) =>
          isChildActive(child.resolvedUrl, desktopChildren),
        );
      return {
        item,
        resolvedChildren: desktopChildren,
        active,
      };
    })
    .find(
      ({ item, resolvedChildren, active }) =>
        active &&
        resolvedChildren.length > 0 &&
        desktopSubmenuParentUrls.has(item.url),
    );
  const desktopSubmenuContainerClass =
    activeDesktopSubmenu?.item.url === "/student/lesson/note"
      ? "mx-auto max-w-[1500px] px-3 pt-6 md:px-5 lg:px-8 xl:px-10"
      : "mx-auto max-w-7xl px-4 pt-6 lg:px-6";

  const performLogout = async (isTimeout: boolean) => {
    if (isSemesterArchive) {
      window.close();
      return;
    }
    try {
      removeStorage(SESSION_EXPIRY_KEY);
      removeStorage(ROLE_SESSION_KEY);
      if (isTimeout) {
        showToast({
          tone: "warning",
          title: "세션이 만료되었습니다.",
          message: "보안을 위해 자동 로그아웃됩니다.",
        });
      }
      await logout();
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleLogout = async () => {
    await performLogout(false);
  };

  const extendSession = (options?: { force?: boolean }) => {
    const now = Date.now();
    const currentExpiry = sessionExpiryRef.current;
    const alreadyFresh =
      currentExpiry !== null &&
      currentExpiry - now > SESSION_DURATION_MS - SESSION_ACTIVITY_THROTTLE_MS;
    if (
      !options?.force &&
      alreadyFresh &&
      now - lastSessionExtendAtRef.current < SESSION_ACTIVITY_THROTTLE_MS
    ) {
      return;
    }

    const expiry = now + SESSION_DURATION_MS;
    sessionExpiryRef.current = expiry;
    lastSessionExtendAtRef.current = now;
    writeLocalOnly(SESSION_EXPIRY_KEY, String(expiry));
    setSessionExpiry(expiry);
    setRemainingSeconds(SESSION_DURATION_SECONDS);
    timeoutHandledRef.current = false;
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!useTeacherSidebar) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeDesktopDrawer = () => {
      if (desktop.matches) closeMobileMenu();
    };
    desktop.addEventListener("change", closeDesktopDrawer);
    return () => desktop.removeEventListener("change", closeDesktopDrawer);
  }, [useTeacherSidebar, closeMobileMenu]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "contain";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior =
        previousHtmlOverscroll;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!currentUser) return;
    timeoutHandledRef.current = false;
    const now = Date.now();
    const saved = Number(readLocalOnly(SESSION_EXPIRY_KEY));
    const nextExpiry =
      Number.isFinite(saved) && saved > now ? saved : now + SESSION_DURATION_MS;
    sessionExpiryRef.current = nextExpiry;
    lastSessionExtendAtRef.current = now;
    writeLocalOnly(SESSION_EXPIRY_KEY, String(nextExpiry));
    setSessionExpiry(nextExpiry);
  }, [currentUser]);

  useEffect(() => {
    if (!sessionExpiry || !currentUser) return;

    const tick = () => {
      const diffMs = sessionExpiry - Date.now();
      if (diffMs <= 0) {
        setRemainingSeconds(0);
        if (!timeoutHandledRef.current) {
          timeoutHandledRef.current = true;
          void performLogout(true);
        }
        return;
      }
      setRemainingSeconds(Math.ceil(diffMs / 1000));
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [currentUser, sessionExpiry]);

  useEffect(() => {
    if (!currentUser) return;

    const handleMeaningfulClick = (event: MouseEvent) => {
      if (getSessionActivityTarget(event.target)) {
        extendSession();
      }
    };

    const handleMeaningfulChange = (event: Event) => {
      if (getSessionChangeActivityTarget(event.target)) {
        extendSession();
      }
    };

    const handleSubmit = (event: Event) => {
      if (isSessionActivityIgnored(event.target)) return;
      extendSession();
    };

    const handleSessionActivity = () => {
      extendSession({ force: true });
    };

    document.addEventListener("click", handleMeaningfulClick, true);
    document.addEventListener("change", handleMeaningfulChange, true);
    document.addEventListener("submit", handleSubmit, true);
    window.addEventListener(SESSION_ACTIVITY_EVENT, handleSessionActivity);
    return () => {
      document.removeEventListener("click", handleMeaningfulClick, true);
      document.removeEventListener("change", handleMeaningfulChange, true);
      document.removeEventListener("submit", handleSubmit, true);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, handleSessionActivity);
    };
  }, [currentUser]);

  useEffect(() => {
    let cancelled = false;

    const loadStudentHeaderRank = async () => {
      if (!currentUser || !config || isTeacherPortal) {
        if (!cancelled) {
          setStudentRank(null);
          setProfileFallbackIcon(getDefaultProfileEmojiValue());
        }
        return;
      }

      try {
        const [
          { loadStudentRankPromotionSnapshot },
          { getPointRankDefaultEmojiValue },
        ] = await Promise.all([
          import("../../lib/pointRankPromotion"),
          import("../../lib/pointRanks"),
        ]);
        if (cancelled) return;
        const snapshot = await loadStudentRankPromotionSnapshot(
          config,
          currentUser.uid,
        );
        if (cancelled) return;

        setStudentRank(snapshot.rank);
        setProfileFallbackIcon(
          getPointRankDefaultEmojiValue(snapshot.policy.rankPolicy) ||
            getDefaultProfileEmojiValue(),
        );
      } catch (error) {
        console.error("Failed to load student header rank:", error);
        if (!cancelled) {
          setStudentRank(null);
          setProfileFallbackIcon(getDefaultProfileEmojiValue());
        }
      }
    };

    const triggerRankLoad = () => {
      void import("../../lib/pointRankPromotion")
        .then(({ invalidateStudentRankPromotionSnapshotCache }) => {
          invalidateStudentRankPromotionSnapshotCache(config, currentUser?.uid);
          void loadStudentHeaderRank();
        })
        .catch((error) => {
          console.error("Failed to refresh student header rank:", error);
        });
    };

    const cancelInitialLoad = runAfterNextPaint(() => {
      void loadStudentHeaderRank();
    });
    window.addEventListener("westory:points-updated", triggerRankLoad);
    return () => {
      cancelled = true;
      cancelInitialLoad();
      window.removeEventListener("westory:points-updated", triggerRankLoad);
    };
  }, [config?.year, config?.semester, currentUser?.uid, isTeacherPortal]);

  if (!isReady) return null;

  return (
    <>
      {useTeacherSidebar && (
        <TeacherSidebar
          groups={teacherSidebarGroups}
          home={home}
          showDashboard={canAccessTeacherPath(
            "/teacher/dashboard",
            userData,
            currentUser?.email,
          )}
          showSettings={canManageSettings(userData, currentUser?.email)}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileMenuOpen}
          onToggleCollapsed={onToggleSidebar}
          onCloseMobile={closeMobileMenu}
          isChildActive={isChildActive}
        />
      )}
      <header
        className={
          useTeacherSidebar
            ? "teacher-header teacher-account-header"
            : isTeacherPortal
              ? "teacher-header"
              : undefined
        }
      >
        <div className="header-container">
          {useTeacherSidebar && (
            <button
              id="teacher-navigation-toggle"
              type="button"
              className="teacher-navigation-toggle"
              onClick={() => setMobileMenuOpen((previous) => !previous)}
              aria-label="교사 메뉴 열기"
              aria-expanded={mobileMenuOpen}
              aria-controls="teacher-navigation"
            >
              <TeacherNavigationIcon name="menu" />
            </button>
          )}
          {!useTeacherSidebar && (
            <div className="flex items-center gap-4 h-full">
              <Link to={home} className="logo-text">
                <span className="logo-we">We</span>
                <span className="logo-story">story</span>
              </Link>

              <nav
                className={`desktop-nav ml-4 ${!isTeacherPortal ? "student-desktop-nav" : ""}`}
              >
                {menuItems.map((item, idx) => {
                  const visibleChildren = getVisibleChildren(item);
                  const resolvedChildren = getResolvedChildUrls(
                    item.url,
                    visibleChildren,
                    portal,
                  );
                  const hasChildren = visibleChildren.length > 0;
                  const active =
                    isActive(item.url) ||
                    resolvedChildren.some((child) =>
                      isChildActive(child.resolvedUrl, resolvedChildren),
                    );

                  if (!hasChildren) {
                    const itemTarget = resolveTarget(item.url);
                    return (
                      <Link
                        key={`${item.url}-${idx}`}
                        to={itemTarget}
                        className={`nav-link ${active ? "active" : ""} ${!isTeacherPortal ? "student-nav-link" : ""}`}
                      >
                        {item.name}
                      </Link>
                    );
                  }

                  const itemTarget = resolveTarget(item.url);
                  return (
                    <div
                      key={`${item.url}-${idx}`}
                      className="relative group h-full flex items-center"
                    >
                      <Link
                        to={itemTarget}
                        className={`nav-link ${active ? "active" : ""} ${!isTeacherPortal ? "student-nav-link" : ""} flex items-center gap-1`}
                      >
                        {item.name}
                        <i className="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                      </Link>
                      <div className="desktop-submenu-shell absolute left-0 top-[calc(100%-8px)] z-[100] transform pt-1 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100 invisible">
                        <div className="rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                          {resolvedChildren.map((child, childIdx) => {
                            const childTarget = child.resolvedUrl;
                            return (
                              <Link
                                key={`${child.url}-${childIdx}`}
                                to={childTarget}
                                className={`block whitespace-nowrap rounded-lg px-4 py-3.5 text-[13px] font-bold ${isChildActive(child.resolvedUrl, resolvedChildren) ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600"}`}
                              >
                                {child.name}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </nav>
            </div>
          )}

          <div className="header-right">
            {isTeacherPortal &&
              !useTeacherSidebar &&
              canManageSettings(userData, currentUser?.email || "") && (
                <Link
                  to="/teacher/settings"
                  className="text-gray-400 hover:text-blue-600 transition"
                  title="설정"
                >
                  <i className="fas fa-cog fa-lg"></i>
                </Link>
              )}

            <Link
              to={profileTarget}
              className="user-greeting header-user-link inline-flex items-center gap-1.5 hover:text-blue-600 transition cursor-pointer"
              title={isTeacherPortal ? "관리자 페이지" : "마이페이지"}
            >
              {!isTeacherPortal && (
                <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-[14px] leading-none">
                  {studentProfileIcon}
                </span>
              )}
              <span className="header-user-name">{profileLabel}</span>
              {!isTeacherPortal && studentRank && (
                <PointRankBadge
                  rank={studentRank}
                  size="sm"
                  className="shrink-0"
                />
              )}
            </Link>

            <React.Suspense fallback={null}>
              <NotificationBell
                className={
                  useTeacherSidebar
                    ? "teacher-account-notification"
                    : "hidden lg:block"
                }
                onUnreadCountChange={setMobileUnreadCount}
              />
            </React.Suspense>

            <div
              className={`${useTeacherSidebar ? "teacher-account-session" : "hidden lg:flex items-center gap-1 md:gap-2 px-3 py-1"} bg-stone-100 rounded-full border border-stone-200`}
            >
              <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
              <span
                className={`font-mono font-bold text-sm w-[42px] text-center ${remainingSeconds < 300 ? "text-red-500" : "text-stone-600"}`}
              >
                {formatCountdown(remainingSeconds)}
              </span>
              <button
                onClick={() => extendSession({ force: true })}
                data-session-ignore="true"
                className="text-stone-400 hover:text-blue-600 transition p-1"
                title="시간 연장"
              >
                <i className="fas fa-redo-alt text-xs"></i>
              </button>
            </div>

            <button
              onClick={handleLogout}
              data-session-ignore="true"
              className="btn-logout"
              aria-label={isSemesterArchive ? "조회 창 닫기" : "로그아웃"}
            >
              <i
                className="fas fa-right-from-bracket btn-logout-icon"
                aria-hidden="true"
              ></i>
              <span className="btn-logout-label">
                {isSemesterArchive ? "조회 창 닫기" : "로그아웃"}
              </span>
            </button>

            {!useTeacherSidebar && (
              <button
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                data-session-ignore="true"
                className="mobile-menu-btn"
                aria-label="모바일 메뉴 열기"
              >
                <i className="fas fa-bars"></i>
                {mobileUnreadCount > 0 && (
                  <span
                    className="mobile-menu-btn-badge"
                    aria-label={`읽지 않은 알림 ${mobileUnreadLabel}개`}
                  >
                    {mobileUnreadLabel}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {!useTeacherSidebar && mobileMenuOpen && (
          <div
            className="fixed inset-0 top-16 z-40 lg:hidden bg-transparent"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          ></div>
        )}

        {!useTeacherSidebar && (
          <div id="mobile-menu" className={mobileMenuOpen ? "open" : ""}>
            {mobileMenuOpen && (
              <>
                <div className="mobile-menu-status">
                  <div className="mobile-menu-status-card">
                    <div className="mobile-menu-status-copy">
                      <span className="mobile-menu-status-label">알림</span>
                      <strong>
                        {mobileUnreadCount > 0
                          ? `${mobileUnreadLabel}개`
                          : "새 알림 없음"}
                      </strong>
                    </div>
                    <React.Suspense fallback={null}>
                      <NotificationBell className="mobile-menu-notification" />
                    </React.Suspense>
                  </div>
                  <button
                    type="button"
                    onClick={() => extendSession({ force: true })}
                    title="시간 연장"
                    data-session-ignore="true"
                    className={`mobile-menu-status-card mobile-menu-time-card ${remainingSeconds < 300 ? "is-warning" : ""}`}
                  >
                    <div className="mobile-menu-status-copy">
                      <span className="mobile-menu-status-label">
                        남은 시간
                      </span>
                      <strong>{formatCountdown(remainingSeconds)}</strong>
                    </div>
                    <span
                      className="mobile-menu-status-icon"
                      aria-hidden="true"
                    >
                      <i className="fas fa-redo-alt"></i>
                    </span>
                  </button>
                </div>
                {menuItems.map((item, idx) => {
                  const visibleChildren = getVisibleChildren(item);
                  const resolvedChildren = getResolvedChildUrls(
                    item.url,
                    visibleChildren,
                    portal,
                  );
                  const itemTarget = resolveTarget(item.url);
                  return (
                    <div key={`${item.url}-mobile-${idx}`}>
                      <Link
                        to={itemTarget}
                        className={`mobile-link ${isActive(item.url) || resolvedChildren.some((child) => isChildActive(child.resolvedUrl, resolvedChildren)) ? "active" : ""}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.name}
                      </Link>
                      {visibleChildren.length > 0 && (
                        <div className="bg-gray-50 border-b border-gray-100 pb-1">
                          {resolvedChildren.map((child, childIdx) => {
                            const childTarget = child.resolvedUrl;
                            return (
                              <Link
                                key={`${child.url}-mobile-child-${childIdx}`}
                                to={childTarget}
                                className={`block pl-12 pr-4 py-1.5 text-sm rounded-r-full mr-2 font-bold ${isChildActive(child.resolvedUrl, resolvedChildren) ? "text-blue-600 bg-blue-50" : "text-gray-500 hover:text-blue-600 hover:bg-gray-100"}`}
                                onClick={() => setMobileMenuOpen(false)}
                              >
                                <i className="fas fa-angle-right mr-2 text-xs opacity-50"></i>
                                {child.name}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </header>

      {!useTeacherSidebar && activeDesktopSubmenu && (
        <div className="hidden lg:block">
          <div className={desktopSubmenuContainerClass}>
            <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
              {activeDesktopSubmenu.resolvedChildren.map((child, childIdx) => {
                const childTarget = child.resolvedUrl;
                const active = isChildActive(
                  child.resolvedUrl,
                  activeDesktopSubmenu.resolvedChildren,
                );

                return (
                  <Link
                    key={`${child.url}-desktop-submenu-${childIdx}`}
                    to={childTarget}
                    className={`border-b-2 px-6 py-3 text-sm font-bold transition ${
                      active
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {child.name}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
