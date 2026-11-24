import { isSemesterArchive } from "../../lib/semesterArchive";
import {
  SemesterArchiveBanner,
  SemesterArchiveUnavailable,
  isArchiveUnavailableRoute,
} from "../common/SemesterArchiveBoundary";
import React, { useEffect } from "react";
import { useAppToast } from "../common/AppToastProvider";
import Header from "../common/Header";
import {
  PortalFallbackFooter,
  PortalWorkspaceFooterProvider,
} from "../common/PortalWorkspace";
import "./teacherLayout.css";
import "./studentLayout.css";
import { PageLoading } from "../common/LoadingState";
import AuthRecoveryState from "../common/AuthRecoveryState";
import { useAuth } from "../../contexts/AuthContext";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { markLoginPerf, measureLoginPerf } from "../../lib/loginPerf";
import { readStorage } from "../../lib/safeStorage";
import { runAfterNextPaint } from "../../lib/browserTasks";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import {
  getStudentRouteAccess,
  isStudentVisibilityControlledPath,
} from "../../lib/studentMenuAccess";
import {
  canAccessTeacherPath,
  canAccessTeacherPortal,
  getDefaultTeacherRoute,
  isAdminUser,
} from "../../lib/permissions";

const ROLE_SESSION_KEY = "westoryPortalRole";
const VISIBILITY_SETTINGS_FRESH_MS = 5000;
// Empty on purpose: every path and every query change of a student page waits
// for the server re-check behind the page-area gate, and only the shell stays
// mounted. A path listed here would keep its verified page mounted through a
// query change, which shows a tab hidden moments ago until the re-check
// answers (up to its deadline on a stalled connection). Do not add a path
// without accepting that for real-time visibility blocking.
const IN_PLACE_QUERY_STUDENT_PATHS = new Set<string>();
const WEPLAY_COMPACT_NAVIGATION = "(max-width: 1279px), (any-pointer: coarse)";

const StudentHistoryDictionaryController = lazyWithRetry(
  () => import("../common/StudentHistoryDictionaryController"),
  "student-history-dictionary-controller",
);
const StudentRankPromotionController = lazyWithRetry(
  () => import("../common/StudentRankPromotionController"),
  "student-rank-promotion-controller",
);
const TeacherPatchMemoController = lazyWithRetry(
  () => import("../common/TeacherPatchMemoController"),
  "teacher-patch-memo-controller",
);

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    userData,
    loading,
    authPhase,
    authError,
    retryAuth,
    logout,
    config,
    configReady,
    menuConfig,
    menuConfigReady,
    interfaceConfig,
    interfaceConfigReady,
    settingsLoadedAt,
    refreshConfig,
    refreshMenuConfig,
    refreshInterfaceConfig,
  } = useAuth();
  const { showToast } = useAppToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isStudentRoute = location.pathname.startsWith("/student");
  const isTeacherRoute = location.pathname.startsWith("/teacher");
  const profileReady = Boolean(
    authPhase === "ready" &&
    !loading &&
    currentUser &&
    userData &&
    userData.uid === currentUser.uid,
  );
  const canUseTeacherPortal = Boolean(
    profileReady && canAccessTeacherPortal(userData, currentUser?.email),
  );
  const isDeveloperLogRoute = /^\/developer-log(?:\/|$)/.test(
    location.pathname,
  );
  const useTeacherLayout =
    isTeacherRoute || (isDeveloperLogRoute && canUseTeacherPortal);
  const useStudentLayout =
    isStudentRoute || (isDeveloperLogRoute && !canUseTeacherPortal);
  const savedRole = profileReady ? readStorage(ROLE_SESSION_KEY) : null;
  let permissionRedirect: string | null = null;
  if (profileReady && isTeacherRoute) {
    if (!canUseTeacherPortal) {
      permissionRedirect = "/student/dashboard";
    } else if (
      !canAccessTeacherPath(location.pathname, userData, currentUser?.email)
    ) {
      permissionRedirect = getDefaultTeacherRoute(userData, currentUser?.email);
    }
  } else if (
    profileReady &&
    isStudentRoute &&
    savedRole === "teacher" &&
    canUseTeacherPortal
  ) {
    permissionRedirect = getDefaultTeacherRoute(userData, currentUser?.email);
  }
  const portalAllowed = profileReady && !permissionRedirect;
  const [teacherSidebarCollapsed, setTeacherSidebarCollapsed] =
    React.useState(false);
  const toggleTeacherSidebar = React.useCallback(() => {
    setTeacherSidebarCollapsed((previous) => !previous);
  }, []);
  const isStudentWeplayRoute = /^\/student\/weplay\/?$/.test(location.pathname);
  const [compactWeplayNavigation, setCompactWeplayNavigation] = React.useState(
    () => window.matchMedia(WEPLAY_COMPACT_NAVIGATION).matches,
  );
  const [weplaySidebarExpanded, setWeplaySidebarExpanded] =
    React.useState(false);
  const useCompactWeplayNavigation =
    isStudentWeplayRoute && compactWeplayNavigation;
  const sidebarCollapsed = useCompactWeplayNavigation
    ? !weplaySidebarExpanded
    : teacherSidebarCollapsed;
  const toggleSidebar = useCompactWeplayNavigation
    ? () => setWeplaySidebarExpanded((previous) => !previous)
    : toggleTeacherSidebar;

  useEffect(() => {
    const media = window.matchMedia(WEPLAY_COMPACT_NAVIGATION);
    const update = () => {
      setCompactWeplayNavigation(media.matches);
      setWeplaySidebarExpanded(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setWeplaySidebarExpanded(false);
  }, [location.pathname]);

  const isStudentQuizRunRoute = location.pathname === "/student/quiz/run";
  const isStudentHistoryClassroomRunRoute =
    /^\/student\/history-classroom\/run\/?$/.test(location.pathname);
  const canUseTeacherPatchMemo = Boolean(
    !isSemesterArchive &&
    portalAllowed &&
    currentUser &&
    isTeacherRoute &&
    isAdminUser(userData, currentUser.email),
  );
  const isVisibilityControlledStudentRoute = isStudentVisibilityControlledPath(
    location.pathname,
  );
  const studentVisibilityRouteKey = `${location.pathname}${location.search}`;
  const [studentVisibilityRefreshing, setStudentVisibilityRefreshing] =
    React.useState(false);
  const [
    studentVisibilityCheckedRouteKey,
    setStudentVisibilityCheckedRouteKey,
  ] = React.useState("");
  const [studentEnhancementsReady, setStudentEnhancementsReady] =
    React.useState(false);
  const [teacherEnhancementsReady, setTeacherEnhancementsReady] =
    React.useState(false);
  const studentVisibilityRouteVerified =
    !isVisibilityControlledStudentRoute ||
    studentVisibilityCheckedRouteKey === studentVisibilityRouteKey;
  const studentSettingsLoaded =
    configReady && menuConfigReady && interfaceConfigReady;
  // What the previous commit showed for this account: the student shell, and
  // the student page for one exact path.
  const shownStudentShellRef = React.useRef("");
  const shownStudentPageRef = React.useRef("");
  const studentShellOwner = currentUser?.uid || "";
  const studentPageIdentity = `${studentShellOwner}|${location.pathname}`;
  // Always false while IN_PLACE_QUERY_STUDENT_PATHS is empty, so the page area
  // is gated on every change. For a listed path it would apply only to a query
  // change inside the page that is verified and still mounted, and only while
  // the server-confirmed settings already held allow the new address.
  const keepStudentPageDuringRecheck =
    profileReady &&
    isStudentRoute &&
    isVisibilityControlledStudentRoute &&
    studentSettingsLoaded &&
    !studentVisibilityRouteVerified &&
    IN_PLACE_QUERY_STUDENT_PATHS.has(location.pathname) &&
    shownStudentPageRef.current === studentPageIdentity &&
    getStudentRouteAccess(
      { pathname: location.pathname, search: location.search },
      config,
      menuConfig,
    ).allowed;
  const studentAccessReady =
    !isStudentRoute ||
    (studentSettingsLoaded &&
      ((studentVisibilityRouteVerified && !studentVisibilityRefreshing) ||
        keepStudentPageDuringRecheck));
  const studentRouteAccess = React.useMemo(
    () =>
      studentAccessReady
        ? getStudentRouteAccess(
            {
              pathname: location.pathname,
              search: location.search,
            },
            config,
            menuConfig,
          )
        : { allowed: true as const },
    [
      config,
      location.pathname,
      location.search,
      menuConfig,
      studentAccessReady,
    ],
  );

  const settingsLoadedAtRef = React.useRef(settingsLoadedAt);
  settingsLoadedAtRef.current = settingsLoadedAt;

  useEffect(() => {
    if (
      !portalAllowed ||
      !isStudentRoute ||
      !isVisibilityControlledStudentRoute ||
      !configReady ||
      !menuConfigReady
    ) {
      return undefined;
    }

    const routeKey = studentVisibilityRouteKey;
    let cancelled = false;
    const loadedAt = settingsLoadedAtRef.current;

    if (loadedAt > 0 && Date.now() - loadedAt <= VISIBILITY_SETTINGS_FRESH_MS) {
      setStudentVisibilityCheckedRouteKey(routeKey);
      setStudentVisibilityRefreshing(false);
      return undefined;
    }

    setStudentVisibilityRefreshing(true);

    void Promise.all([refreshConfig(), refreshMenuConfig()]).finally(() => {
      if (!cancelled) {
        setStudentVisibilityCheckedRouteKey(routeKey);
        setStudentVisibilityRefreshing(false);
      }
    });

    return () => {
      cancelled = true;
      // The page that asked for this check is gone. Leaving the flag set would
      // keep a later page that needs no check behind the loader.
      setStudentVisibilityRefreshing(false);
    };
    // One check per page visit: the two settings finish at different moments,
    // and reacting to each timestamp would read both documents a second time.
  }, [
    configReady,
    currentUser,
    isStudentRoute,
    isVisibilityControlledStudentRoute,
    loading,
    location.pathname,
    location.search,
    menuConfigReady,
    portalAllowed,
    refreshConfig,
    refreshMenuConfig,
    studentVisibilityRouteKey,
  ]);

  useEffect(() => {
    if (
      !portalAllowed ||
      !isStudentRoute ||
      !studentAccessReady ||
      !config ||
      !menuConfig ||
      !interfaceConfig ||
      studentRouteAccess.allowed
    ) {
      return;
    }

    showToast({
      tone: "warning",
      title: "현재 학생에게 공개되지 않은 메뉴입니다.",
      message: "학생 첫 화면으로 이동합니다.",
    });
    navigate(studentRouteAccess.redirectTo, { replace: true });
  }, [
    currentUser,
    config,
    menuConfig,
    interfaceConfig,
    isStudentRoute,
    loading,
    navigate,
    portalAllowed,
    showToast,
    studentAccessReady,
    studentRouteAccess,
  ]);

  useEffect(() => {
    if (
      !portalAllowed ||
      !studentAccessReady ||
      (isStudentRoute && !studentRouteAccess.allowed)
    )
      return;

    markLoginPerf("westory-main-layout-ready");
    measureLoginPerf(
      "westory-route-ready",
      "westory-login-first-route-decided",
      "westory-main-layout-ready",
    );
  }, [
    currentUser,
    isStudentRoute,
    location.pathname,
    portalAllowed,
    studentAccessReady,
    studentRouteAccess.allowed,
  ]);

  const studentSettingsFailed =
    isStudentRoute &&
    studentSettingsLoaded &&
    (!config || !menuConfig || !interfaceConfig);
  const studentRouteOpen =
    portalAllowed &&
    isStudentRoute &&
    !studentSettingsFailed &&
    studentAccessReady &&
    studentRouteAccess.allowed;
  // While a student page or tab waits for its server re-check, keep the shell
  // this account already sees and gate only the page area. The first entry,
  // a failed or pending settings load and a denied page still replace it all.
  const keepStudentShell =
    portalAllowed &&
    isStudentRoute &&
    studentSettingsLoaded &&
    !studentSettingsFailed &&
    !studentAccessReady &&
    studentShellOwner !== "" &&
    shownStudentShellRef.current === studentShellOwner;
  const showsStudentShell = studentRouteOpen || keepStudentShell;
  // The rank promotion check runs when its controller mounts, and students
  // used to get a new one for every page they opened. Keep that: the key
  // changes once a page is open, not while it is still being checked.
  const openedStudentVisitRef = React.useRef("");
  const studentVisitKey = studentRouteOpen
    ? studentVisibilityRouteKey
    : openedStudentVisitRef.current;

  useEffect(() => {
    shownStudentShellRef.current = showsStudentShell ? studentShellOwner : "";
    shownStudentPageRef.current = studentRouteOpen ? studentPageIdentity : "";
    if (studentRouteOpen)
      openedStudentVisitRef.current = studentVisibilityRouteKey;
  }, [
    showsStudentShell,
    studentPageIdentity,
    studentRouteOpen,
    studentShellOwner,
    studentVisibilityRouteKey,
  ]);

  useEffect(() => {
    setStudentEnhancementsReady(false);
    if (!showsStudentShell) return undefined;
    return runAfterNextPaint(() => setStudentEnhancementsReady(true));
  }, [currentUser?.uid, showsStudentShell]);

  useEffect(() => {
    setTeacherEnhancementsReady(false);
    if (loading || !canUseTeacherPatchMemo) return undefined;
    return runAfterNextPaint(() => setTeacherEnhancementsReady(true));
  }, [canUseTeacherPatchMemo, currentUser?.uid, loading]);

  if (authPhase === "error" || authPhase === "registration-pending") {
    return (
      <AuthRecoveryState
        registrationPending={authPhase === "registration-pending"}
        registrationRejected={
          userData?.registrationApprovalStatus === "REJECTED"
        }
        error={authError}
        onRetry={retryAuth}
        onRestart={async () => {
          await logout();
          navigate("/", { replace: true });
        }}
      />
    );
  }

  if (
    loading ||
    authPhase === "resolving" ||
    authPhase === "opening-session" ||
    authPhase === "loading-profile"
  )
    return (
      <PageLoading scope="screen" message="로그인 상태를 확인하는 중입니다." />
    );

  if (!profileReady) return <Navigate to="/" replace />;
  if (permissionRedirect) return <Navigate to={permissionRedirect} replace />;

  if (studentSettingsFailed) {
    return (
      <div className="ws-page" role="alert">
        <p>화면 설정을 확인하지 못했습니다.</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            void Promise.all([
              refreshConfig(),
              refreshMenuConfig(),
              refreshInterfaceConfig(),
            ]);
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (
    currentUser &&
    isStudentRoute &&
    !studentAccessReady &&
    !keepStudentShell
  ) {
    return (
      <PageLoading
        scope="screen"
        message="학생 공개 설정을 확인하는 중입니다."
      />
    );
  }

  if (
    currentUser &&
    isStudentRoute &&
    studentAccessReady &&
    !studentRouteAccess.allowed
  ) {
    return (
      <PageLoading
        scope="screen"
        message="학생 공개 설정을 반영하는 중입니다."
      />
    );
  }

  return (
    <PortalWorkspaceFooterProvider>
      <div
        className={`flex min-h-screen flex-col bg-gray-50 ${useTeacherLayout ? "teacher-layout" : useStudentLayout ? "student-layout" : ""} ${isStudentWeplayRoute ? "student-weplay-layout" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
      >
        <Header
          teacherLayout={useTeacherLayout}
          studentLayout={useStudentLayout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <SemesterArchiveBanner />
        {studentEnhancementsReady && (
          <React.Suspense fallback={null}>
            <StudentRankPromotionController key={studentVisitKey} />
            <StudentHistoryDictionaryController />
          </React.Suspense>
        )}
        {teacherEnhancementsReady && (
          <React.Suspense fallback={null}>
            <TeacherPatchMemoController />
          </React.Suspense>
        )}
        <main
          className={`min-h-0 w-full flex-1 ${
            isStudentQuizRunRoute ? "flex flex-col" : ""
          }`}
        >
          {keepStudentShell ? (
            <PageLoading
              scope="screen"
              message="학생 공개 설정을 확인하는 중입니다."
            />
          ) : isArchiveUnavailableRoute(location.pathname) ? (
            <SemesterArchiveUnavailable />
          ) : (
            children
          )}
        </main>
        {!isStudentQuizRunRoute &&
          !isStudentHistoryClassroomRunRoute &&
          (!/^\/teacher\/settings\/?$/.test(location.pathname) ||
            isArchiveUnavailableRoute(location.pathname)) && (
            <PortalFallbackFooter
              teacher={useTeacherLayout || useStudentLayout}
            />
          )}
      </div>
    </PortalWorkspaceFooterProvider>
  );
};

export default MainLayout;
