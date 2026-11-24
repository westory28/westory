import type { MenuConfig } from "../constants/menus";
import type { SystemConfig } from "../types";
import {
  getStudentRouteAccess,
  isStudentVisibilityControlledPath,
} from "./studentMenuAccess";

type RouteCodeLoader = () => Promise<unknown>;

// Page code only, for the routes opened most. Fetching a module is never an
// access decision: MainLayout and the server still decide what may render or be
// read. Each entry must name the same module as its route in App.tsx.
const ROUTE_CODE: Record<string, RouteCodeLoader> = {
  "/student/dashboard": () => import("../pages/student/Dashboard"),
  "/student/lesson/note": () => import("../pages/student/lesson/Note"),
  "/student/lesson/history-dictionary": () =>
    import("../pages/student/lesson/HistoryDictionary"),
  "/student/lesson/maps": () => import("../pages/student/lesson/Maps"),
  "/student/lesson/think-cloud": () =>
    import("../pages/student/lesson/ThinkCloud"),
  "/student/quiz": () => import("../pages/student/quiz/QuizIndex"),
  "/student/quiz/run": () => import("../pages/student/quiz/QuizRunner"),
  "/student/score": () => import("../pages/student/score/ScoreDashboard"),
  "/student/score/report": () => import("../pages/student/score/ScoreReport"),
  "/student/score/performance": () =>
    import("../pages/student/score/PerformanceScoreView"),
  "/student/score/written-exam": () =>
    import("../pages/student/score/WrittenExamEssayScoreView"),
  "/student/history": () => import("../pages/student/History"),
  "/student/points": () => import("../pages/student/Points"),
  "/student/wispi": () => import("../pages/student/WisStocks"),
  "/student/mypage": () => import("../pages/student/MyPage"),
  "/student/calendar": () => import("../pages/student/Calendar"),
  "/teacher/dashboard": () => import("../pages/teacher/Dashboard"),
  "/teacher/lesson": () => import("../pages/teacher/ManageLesson"),
  "/teacher/quiz": () => import("../pages/teacher/ManageQuiz"),
  "/teacher/students": () => import("../pages/teacher/StudentList"),
  "/teacher/points": () => import("../pages/teacher/ManagePoints"),
  "/teacher/exam": () => import("../pages/teacher/ManageExam"),
};

export const ROUTE_CODE_PATHS = Object.keys(ROUTE_CODE);

export type RouteCodeRequest = {
  authPhase: string;
  pathname: string;
  search: string;
  /** The portal this browser last signed in to, if any. */
  savedRole: string | null;
  settingsLoaded: boolean;
  config: SystemConfig | null;
  menuConfig: MenuConfig | null;
};

/**
 * Chooses the page code worth fetching beside the session and settings checks.
 * Returns "" unless an account is being restored or is ready, the page is one a
 * sidebar entry leads to, and nothing already known closes it.
 */
export const resolveRouteCodeTarget = ({
  authPhase,
  pathname,
  search,
  savedRole,
  settingsLoaded,
  config,
  menuConfig,
}: RouteCodeRequest): string => {
  if (
    authPhase !== "opening-session" &&
    authPhase !== "loading-profile" &&
    authPhase !== "ready"
  )
    return "";
  const path = pathname.replace(/\/+$/, "") || "/";
  const target =
    path !== "/"
      ? path
      : savedRole === "teacher"
        ? "/teacher/dashboard"
        : savedRole === "student"
          ? "/student/dashboard"
          : "";
  if (!Object.prototype.hasOwnProperty.call(ROUTE_CODE, target)) return "";
  if (target.startsWith("/teacher/"))
    return savedRole === "teacher" ? target : "";
  if (!isStudentVisibilityControlledPath(target)) return target;
  // A page behind the student visibility settings waits for them and is left
  // alone when the settings already held do not allow it.
  return settingsLoaded &&
    getStudentRouteAccess({ pathname: target, search }, config, menuConfig)
      .allowed
    ? target
    : "";
};

const started = new Set<string>();

/** Starts the download once per page; the route itself still awaits its import. */
export const preloadRouteCode = (target: string) => {
  if (!Object.prototype.hasOwnProperty.call(ROUTE_CODE, target)) return;
  if (started.has(target)) return;
  started.add(target);
  void ROUTE_CODE[target]().catch(() => {
    started.delete(target);
  });
};
