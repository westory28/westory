import React, { useEffect } from "react";
import {
  inferToastFromAlertMessage,
  useAppToast,
} from "../common/AppToastProvider";
import Header from "../common/Header";
import Footer from "../common/Footer";
import { PageLoading } from "../common/LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { markLoginPerf, measureLoginPerf } from "../../lib/loginPerf";
import { runAfterNextPaint } from "../../lib/browserTasks";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import {
  getStudentRouteAccess,
  isStudentVisibilityControlledPath,
} from "../../lib/studentMenuAccess";
import { isTeacherUser } from "../../lib/permissions";

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
    config,
    configReady,
    menuConfig,
    menuConfigReady,
  } = useAuth();
  const { showToast } = useAppToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isStudentRoute = location.pathname.startsWith("/student");
  const isTeacherRoute = location.pathname.startsWith("/teacher");
  const [teacherSidebarExpanded, setTeacherSidebarExpanded] =
    React.useState(false);
  const isStudentQuizRunRoute = location.pathname === "/student/quiz/run";
  const canUseTeacherPatchMemo = Boolean(
    currentUser && isTeacherRoute && isTeacherUser(userData, currentUser.email),
  );
  const isVisibilityControlledStudentRoute = isStudentVisibilityControlledPath(
    location.pathname,
  );
  const [studentEnhancementsReady, setStudentEnhancementsReady] =
    React.useState(false);
  const [teacherEnhancementsReady, setTeacherEnhancementsReady] =
    React.useState(false);
  const studentAccessReady =
    !isStudentRoute ||
    !isVisibilityControlledStudentRoute ||
    (configReady && menuConfigReady);
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

  useEffect(() => {
    if (
      loading ||
      !currentUser ||
      !isStudentRoute ||
      !studentAccessReady ||
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
    isStudentRoute,
    loading,
    navigate,
    showToast,
    studentAccessReady,
    studentRouteAccess,
  ]);

  useEffect(() => {
    if (loading || !currentUser) return;

    markLoginPerf("westory-main-layout-ready", {
      pathname: location.pathname,
    });
    measureLoginPerf(
      "westory-route-ready",
      "westory-login-first-route-decided",
      "westory-main-layout-ready",
    );
  }, [currentUser, loading, location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const originalAlert = window.alert.bind(window);
    window.alert = (message?: unknown) => {
      const nextToast = inferToastFromAlertMessage(message);
      if (!nextToast) return;
      showToast(nextToast);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [showToast]);

  useEffect(() => {
    setStudentEnhancementsReady(false);
    if (!currentUser || loading || !isStudentRoute) return undefined;
    return runAfterNextPaint(() => setStudentEnhancementsReady(true));
  }, [currentUser?.uid, isStudentRoute, loading]);

  useEffect(() => {
    setTeacherEnhancementsReady(false);
    if (loading || !canUseTeacherPatchMemo) return undefined;
    return runAfterNextPaint(() => setTeacherEnhancementsReady(true));
  }, [canUseTeacherPatchMemo, currentUser?.uid, loading]);

  if (loading)
    return <PageLoading message="로그인 상태를 확인하는 중입니다." />;

  if (currentUser && isStudentRoute && !studentAccessReady) {
    return <PageLoading message="학생 공개 설정을 확인하는 중입니다." />;
  }

  if (
    currentUser &&
    isStudentRoute &&
    studentAccessReady &&
    !studentRouteAccess.allowed
  ) {
    return <PageLoading message="학생 공개 설정을 반영하는 중입니다." />;
  }

  return (
    <div
      className={`flex min-h-screen flex-col bg-gray-50 ${currentUser && isTeacherRoute ? "ws-teacher-layout" : ""} ${teacherSidebarExpanded ? "ws-teacher-layout--expanded" : ""}`}
    >
      <Header onTeacherSidebarExpandedChange={setTeacherSidebarExpanded} />
      {studentEnhancementsReady && (
        <React.Suspense fallback={null}>
          <StudentRankPromotionController />
          <StudentHistoryDictionaryController />
        </React.Suspense>
      )}
      {teacherEnhancementsReady && (
        <React.Suspense fallback={null}>
          <TeacherPatchMemoController />
        </React.Suspense>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className={`min-h-0 w-full flex-1 ${
          isStudentQuizRunRoute ? "flex flex-col" : ""
        }`}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
};

export default MainLayout;
