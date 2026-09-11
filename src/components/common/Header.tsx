import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import PointRankBadge from "./PointRankBadge";
import { useAppToast } from "./AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import { MENUS } from "../../constants/menus";
import {
  getStudentRouteAccess,
  getStudentVisibleMenuItems,
} from "../../lib/studentMenuAccess";
import { runAfterNextPaint } from "../../lib/browserTasks";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { getDefaultProfileEmojiValue } from "../../lib/profileEmojis";
import { removeStorage } from "../../lib/safeStorage";
import { runtimeEnvironment } from "../../lib/firebase";
import {
  clearSessionReturnPath,
  clearSessionTiming,
  getSessionExpiryAt,
  NORMAL_SESSION_DURATION_MS,
  readSessionLastActivity,
  resolveSessionPolicy,
  SESSION_EXPIRY_KEY,
  SESSION_LAST_ACTIVITY_KEY,
  shouldEnforceClientIdleSession,
  shouldShowSessionWarning,
  writeSessionActivity,
  writeSessionDeadline,
  writeSessionReturnPath,
} from "../../lib/sessionPolicy";
import { touchApplicationSession } from "../../lib/applicationSession";
import {
  getSessionChangeActivityTarget,
  getSessionActivityTarget,
  isSessionActivityIgnored,
  SESSION_ACTIVITY_EVENT,
} from "../../lib/sessionActivity";
import type { PointRankDisplay } from "../../lib/pointRanks";
import { useShellViewport } from "../../hooks/useShellViewport";
import {
  canAccessTeacherPortal,
  canAccessTeacherPath,
  canManageSettings,
  getDefaultTeacherRoute,
} from "../../lib/permissions";

const SESSION_DURATION_SECONDS = NORMAL_SESSION_DURATION_MS / 1000;
const SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
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

const Header: React.FC<
  Record<string, unknown> & {
    onTeacherContextVisibleChange?: (visible: boolean) => void;
  }
> = ({ onTeacherContextVisibleChange }) => {
  const {
    currentUser,
    userData,
    logout,
    config,
    configReady,
    menuConfig,
    menuConfigReady,
    applicationSessionAuthorityMode,
  } = useAuth();
  const { showToast } = useAppToast();
  const location = useLocation();
  const navigate = useNavigate();
  const shellViewport = useShellViewport();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(
    SESSION_DURATION_SECONDS,
  );
  const [studentRank, setStudentRank] = useState<PointRankDisplay | null>(null);
  const [profileFallbackIcon, setProfileFallbackIcon] = useState(
    getDefaultProfileEmojiValue(),
  );
  const [mobileUnreadCount, setMobileUnreadCount] = useState(0);
  const [desktopNotificationHost, setDesktopNotificationHost] =
    useState<HTMLSpanElement | null>(null);
  const [mobileNotificationHost, setMobileNotificationHost] =
    useState<HTMLSpanElement | null>(null);
  const timeoutHandledRef = useRef(false);
  const sessionExpiryRef = useRef<number | null>(null);
  const lastSessionExtendAtRef = useRef(0);
  const warnedSessionExpiryRef = useRef<number | null>(null);

  const isReady = !!currentUser;
  const isTeacherUser = canAccessTeacherPortal(
    userData,
    currentUser?.email || "",
  );
  const isAdmin = canManageSettings(userData, currentUser?.email || "");
  const sessionPolicy = resolveSessionPolicy(location.pathname, isAdmin);
  const sessionDurationSeconds = sessionPolicy.durationMs / 1000;
  const sessionWarningSeconds = sessionPolicy.warningLeadMs / 1000;
  const isSessionEnforced = shouldEnforceClientIdleSession(
    applicationSessionAuthorityMode,
  );
  const isLegacyDesktopViewport =
    shellViewport === "compact" || shellViewport === "desktop";
  const stagingSessionTestsAvailable =
    runtimeEnvironment === "staging" && isSessionEnforced;
  const showSessionTestControls =
    stagingSessionTestsAvailable &&
    (new URLSearchParams(location.search).get("sessionTest") === "1" ||
      import.meta.env.VITE_ENABLE_STAGING_SESSION_TESTS === "true");
  const displayName = (userData?.name || "").trim() || "이름 미설정";

  const portal: "teacher" | "student" = location.pathname.startsWith("/teacher")
    ? "teacher"
    : location.pathname.startsWith("/student")
      ? "student"
      : isTeacherUser
        ? "teacher"
        : "student";

  const isTeacherPortal = portal === "teacher";
  const [expandedTopMenu, setExpandedTopMenu] = useState<string | null>(null);
  useEffect(
    () => setExpandedTopMenu(null),
    [location.pathname, location.search],
  );
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
  const canViewTeacherMenuUrl = (url: string) => {
    const [pathname, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    if (params.get("adminTools") === "holidays") {
      return canManageSettings(userData, currentUser?.email || "");
    }
    return canAccessTeacherPath(pathname, userData, currentUser?.email || "");
  };
  const menuItems =
    portal === "teacher"
      ? baseMenuItems.filter((item) => canViewTeacherMenuUrl(item.url))
      : baseMenuItems;
  const getVisibleChildren = (item: {
    children?: Array<{ hidden?: boolean; url: string; name: string }>;
  }) => {
    if (!item.children?.length) return [];
    return isTeacherPortal
      ? item.children.filter((child) => canViewTeacherMenuUrl(child.url))
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
        (isTeacherPortal || desktopSubmenuParentUrls.has(item.url)),
    );
  const showTeacherSidebar = Boolean(
    location.pathname.startsWith("/teacher") &&
    shellViewport !== "mobile" &&
    activeDesktopSubmenu,
  );
  useEffect(() => {
    onTeacherContextVisibleChange?.(showTeacherSidebar);
  }, [onTeacherContextVisibleChange, showTeacherSidebar]);
  const desktopSubmenuContainerClass =
    activeDesktopSubmenu?.item.url === "/student/lesson/note"
      ? "mx-auto max-w-[1500px] px-3 pt-6 md:px-5 lg:px-8 xl:px-10"
      : "mx-auto max-w-7xl px-4 pt-6 lg:px-6";

  const performLogout = async (isTimeout: boolean) => {
    try {
      if (isTimeout && currentUser) {
        writeSessionReturnPath(
          currentUser.uid,
          location.pathname,
          location.search,
        );
      } else {
        clearSessionReturnPath();
      }
      clearSessionTiming();
      removeStorage(ROLE_SESSION_KEY);
      if (isTimeout) {
        showToast({
          tone: "warning",
          title: "세션이 만료되었습니다.",
          message: "보안을 위해 자동 로그아웃됩니다.",
        });
      }
      await logout(isTimeout ? "expired" : "manual");
      if (!isTimeout) {
        navigate("/", { replace: true });
      }
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleLogout = async () => {
    await performLogout(false);
  };

  const expireSessionForStagingTest = () => {
    if (runtimeEnvironment !== "staging" || !isSessionEnforced) return;
    const expiredLastActivity = Date.now() - sessionPolicy.durationMs - 1;
    const expiredAt = writeSessionActivity(expiredLastActivity, sessionPolicy);
    sessionExpiryRef.current = expiredAt;
    timeoutHandledRef.current = false;
    setSessionExpiry(expiredAt);
    setRemainingSeconds(0);
  };

  const warnSessionForStagingTest = () => {
    if (runtimeEnvironment !== "staging" || !isSessionEnforced) return;
    const warningLastActivity =
      Date.now() -
      sessionPolicy.durationMs +
      sessionPolicy.warningLeadMs -
      1000;
    const expiry = writeSessionActivity(warningLastActivity, sessionPolicy);
    sessionExpiryRef.current = expiry;
    warnedSessionExpiryRef.current = null;
    timeoutHandledRef.current = false;
    setSessionExpiry(expiry);
    setRemainingSeconds(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
  };

  const extendSession = (options?: { force?: boolean }) => {
    const now = Date.now();
    const currentExpiry = sessionExpiryRef.current;
    if (isSessionEnforced && currentExpiry !== null && currentExpiry <= now) {
      return;
    }
    const alreadyFresh =
      currentExpiry !== null &&
      currentExpiry - now >
        sessionPolicy.durationMs - SESSION_ACTIVITY_THROTTLE_MS;
    if (
      !options?.force &&
      (alreadyFresh || !isSessionEnforced) &&
      now - lastSessionExtendAtRef.current < SESSION_ACTIVITY_THROTTLE_MS
    ) {
      return;
    }

    lastSessionExtendAtRef.current = now;

    const scope = sessionPolicy.highRisk ? "HIGH_RISK" : "GENERAL";
    void touchApplicationSession(scope)
      .then((serverSession) => {
        if (!isSessionEnforced || serverSession.authorityMode !== "ENFORCE") {
          clearSessionTiming();
          sessionExpiryRef.current = null;
          setSessionExpiry(null);
          return;
        }
        const serverExpiry = sessionPolicy.highRisk
          ? serverSession.highRiskExpiresAt
          : serverSession.generalExpiresAt;
        const syncedExpiry = writeSessionDeadline(serverExpiry, sessionPolicy);
        if (!syncedExpiry) return;
        sessionExpiryRef.current = syncedExpiry;
        setSessionExpiry(syncedExpiry);
        timeoutHandledRef.current = false;
        warnedSessionExpiryRef.current = null;
        setRemainingSeconds(
          Math.max(0, Math.ceil((syncedExpiry - Date.now()) / 1000)),
        );
      })
      .catch((error: unknown) => {
        const code = String((error as { code?: unknown })?.code || "");
        if (
          isSessionEnforced &&
          (code === "functions/unauthenticated" ||
            code === "functions/permission-denied")
        ) {
          void performLogout(true);
        }
      });
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (isLegacyDesktopViewport) setMobileMenuOpen(false);
  }, [isLegacyDesktopViewport]);

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
    if (!currentUser || !isSessionEnforced) {
      sessionExpiryRef.current = null;
      timeoutHandledRef.current = false;
      warnedSessionExpiryRef.current = null;
      setSessionExpiry(null);
      setRemainingSeconds(sessionDurationSeconds);
      if (currentUser) clearSessionTiming();
      return;
    }
    timeoutHandledRef.current = false;
    const now = Date.now();
    const lastActivityAt = readSessionLastActivity() ?? now;
    const nextExpiry = writeSessionActivity(lastActivityAt, sessionPolicy);
    sessionExpiryRef.current = nextExpiry;
    lastSessionExtendAtRef.current = lastActivityAt;
    warnedSessionExpiryRef.current = null;
    setSessionExpiry(nextExpiry);
    setRemainingSeconds(
      nextExpiry <= now ? 0 : Math.ceil((nextExpiry - now) / 1000),
    );
  }, [
    currentUser,
    isSessionEnforced,
    location.pathname,
    sessionPolicy.durationMs,
    sessionPolicy.warningLeadMs,
  ]);

  useEffect(() => {
    if (!currentUser || !isSessionEnforced) return;

    const syncSessionAcrossTabs = (event: StorageEvent) => {
      if (
        event.key !== SESSION_LAST_ACTIVITY_KEY &&
        event.key !== SESSION_EXPIRY_KEY
      ) {
        return;
      }
      const lastActivityAt = readSessionLastActivity();
      if (lastActivityAt === null) return;
      const expiry = getSessionExpiryAt(lastActivityAt, sessionPolicy);
      sessionExpiryRef.current = expiry;
      warnedSessionExpiryRef.current = null;
      timeoutHandledRef.current = false;
      setSessionExpiry(expiry);
      setRemainingSeconds(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
    };

    window.addEventListener("storage", syncSessionAcrossTabs);
    return () => window.removeEventListener("storage", syncSessionAcrossTabs);
  }, [currentUser, isSessionEnforced, sessionPolicy.durationMs]);

  useEffect(() => {
    if (!sessionExpiry || !currentUser || !isSessionEnforced) return;

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
      if (
        shouldShowSessionWarning(sessionExpiry, sessionPolicy) &&
        warnedSessionExpiryRef.current !== sessionExpiry
      ) {
        warnedSessionExpiryRef.current = sessionExpiry;
        showToast({
          tone: "warning",
          title: "세션이 5분 뒤 만료됩니다.",
          message: sessionPolicy.highRisk
            ? "관리자 설정을 계속 사용하려면 세션을 연장해 주세요."
            : "작업을 계속하려면 세션을 연장해 주세요.",
        });
      }
      setRemainingSeconds(Math.ceil(diffMs / 1000));
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [
    currentUser,
    isSessionEnforced,
    sessionExpiry,
    sessionPolicy.highRisk,
    sessionPolicy.warningLeadMs,
    showToast,
  ]);

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

    const handleMeaningfulInput = (event: Event) => {
      if (getSessionActivityTarget(event.target)) {
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
    document.addEventListener("input", handleMeaningfulInput, true);
    document.addEventListener("change", handleMeaningfulChange, true);
    document.addEventListener("submit", handleSubmit, true);
    window.addEventListener(SESSION_ACTIVITY_EVENT, handleSessionActivity);
    return () => {
      document.removeEventListener("click", handleMeaningfulClick, true);
      document.removeEventListener("input", handleMeaningfulInput, true);
      document.removeEventListener("change", handleMeaningfulChange, true);
      document.removeEventListener("submit", handleSubmit, true);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, handleSessionActivity);
    };
  }, [
    currentUser,
    isSessionEnforced,
    sessionPolicy.durationMs,
    sessionPolicy.warningLeadMs,
  ]);

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

  const renderNotificationInMobileMenu =
    !isLegacyDesktopViewport && mobileMenuOpen && mobileNotificationHost;
  const notificationHost = renderNotificationInMobileMenu
    ? mobileNotificationHost
    : desktopNotificationHost;

  return (
    <>
      <header className={isTeacherPortal ? "ws-teacher-header" : undefined}>
        <div className="header-container">
          <div className="flex items-center gap-4 h-full">
            <Link to={home} className="logo-text">
              <span className="logo-we">We</span>
              <span className="logo-story">story</span>
            </Link>

            {
              <nav
                className={`desktop-nav ml-4 ${!isTeacherPortal ? "student-desktop-nav" : ""}`}
                aria-label={
                  isTeacherPortal ? "교사 메인 메뉴" : "학생 메인 메뉴"
                }
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
                      className={`ws-top-menu relative group h-full flex items-center ${expandedTopMenu === item.url ? "is-open" : ""}`}
                      onPointerEnter={(event) => {
                        if (event.pointerType === "mouse")
                          setExpandedTopMenu(item.url);
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === "mouse")
                          setExpandedTopMenu(null);
                      }}
                      onFocus={(event) => {
                        if ((event.target as HTMLElement).tagName !== "BUTTON")
                          setExpandedTopMenu(item.url);
                      }}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) {
                          setExpandedTopMenu(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setExpandedTopMenu(null);
                          (
                            event.currentTarget.querySelector(
                              "button",
                            ) as HTMLButtonElement | null
                          )?.focus();
                        }
                      }}
                    >
                      <Link
                        to={itemTarget}
                        className={`nav-link ${active ? "active" : ""} ${!isTeacherPortal ? "student-nav-link" : ""} flex items-center gap-1`}
                      >
                        {item.name}
                      </Link>
                      <button
                        type="button"
                        className="ws-top-menu__toggle"
                        aria-label={`${item.name} 하위 메뉴`}
                        aria-expanded={expandedTopMenu === item.url}
                        aria-controls={`top-submenu-${portal}-${idx}`}
                        onClick={() =>
                          setExpandedTopMenu((value) =>
                            value === item.url ? null : item.url,
                          )
                        }
                      >
                        <i className="fas fa-chevron-down" aria-hidden="true" />
                      </button>
                      <div
                        id={`top-submenu-${portal}-${idx}`}
                        className="desktop-submenu-shell ws-top-menu__panel"
                      >
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
            }
          </div>

          <div className="header-right">
            {isTeacherPortal &&
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

            <span ref={setDesktopNotificationHost} className="contents" />

            {isSessionEnforced && (
              <div className="hidden lg:flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200">
                <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
                <span
                  className={`font-mono font-bold text-sm w-[42px] text-center ${remainingSeconds <= sessionWarningSeconds ? "text-red-500" : "text-stone-600"}`}
                  title={
                    sessionPolicy.highRisk
                      ? "관리자 설정 세션 남은 시간"
                      : "세션 남은 시간"
                  }
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
            )}

            {showSessionTestControls && (
              <div className="hidden items-center gap-1 lg:flex">
                <button
                  type="button"
                  onClick={warnSessionForStagingTest}
                  data-session-ignore="true"
                  className="inline-flex min-h-10 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  세션 경고 테스트
                </button>
                <button
                  type="button"
                  onClick={expireSessionForStagingTest}
                  data-session-ignore="true"
                  className="inline-flex min-h-10 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  세션 만료 테스트
                </button>
              </div>
            )}

            <button
              onClick={handleLogout}
              data-session-ignore="true"
              className="btn-logout"
              aria-label="로그아웃"
            >
              <i
                className="fas fa-right-from-bracket btn-logout-icon"
                aria-hidden="true"
              ></i>
              <span className="btn-logout-label">로그아웃</span>
            </button>

            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              data-session-ignore="true"
              className="mobile-menu-btn"
              aria-label={
                mobileMenuOpen ? "모바일 메뉴 닫기" : "모바일 메뉴 열기"
              }
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
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
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            className="fixed inset-0 top-16 z-40 lg:hidden bg-transparent"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          ></div>
        )}

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
                  <span ref={setMobileNotificationHost} className="contents" />
                </div>
                {isSessionEnforced && (
                  <button
                    type="button"
                    onClick={() => extendSession({ force: true })}
                    title="시간 연장"
                    data-session-ignore="true"
                    className={`mobile-menu-status-card mobile-menu-time-card ${remainingSeconds <= sessionWarningSeconds ? "is-warning" : ""}`}
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
                )}
                {showSessionTestControls && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={warnSessionForStagingTest}
                      data-session-ignore="true"
                      className="min-h-10 rounded-lg border border-amber-300 bg-amber-50 px-2 text-xs font-bold text-amber-800"
                    >
                      세션 경고 테스트
                    </button>
                    <button
                      type="button"
                      onClick={expireSessionForStagingTest}
                      data-session-ignore="true"
                      className="min-h-10 rounded-lg border border-amber-300 bg-amber-50 px-2 text-xs font-bold text-amber-800"
                    >
                      세션 만료 테스트
                    </button>
                  </div>
                )}
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
      </header>

      {notificationHost &&
        createPortal(
          <React.Suspense fallback={null}>
            <NotificationBell
              className={
                renderNotificationInMobileMenu
                  ? "mobile-menu-notification"
                  : "hidden lg:block"
              }
              onUnreadCountChange={setMobileUnreadCount}
            />
          </React.Suspense>,
          notificationHost,
        )}

      {showTeacherSidebar && activeDesktopSubmenu && (
        <aside className="ws-teacher-sidebar" aria-label="교사 하위 메뉴">
          <h2 className="ws-teacher-sidebar__title">
            {activeDesktopSubmenu.item.name}
          </h2>
          <nav aria-label={`${activeDesktopSubmenu.item.name} 하위 메뉴`}>
            {activeDesktopSubmenu.resolvedChildren.map((child, index) => (
              <Link
                key={`${child.resolvedUrl}-${index}`}
                to={child.resolvedUrl}
                className="ws-teacher-sidebar__link"
                aria-current={
                  isChildActive(
                    child.resolvedUrl,
                    activeDesktopSubmenu.resolvedChildren,
                  )
                    ? "page"
                    : undefined
                }
              >
                {child.name}
              </Link>
            ))}
          </nav>
        </aside>
      )}
      {!isTeacherPortal && activeDesktopSubmenu && (
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
