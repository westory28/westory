// Import a destination only after the user points to it. These loaders mount no
// components and start no page queries; route guards still run on navigation.
const loaders: Record<string, () => Promise<unknown>> = {
  "/teacher/dashboard": () => import("../pages/teacher/Dashboard"),
  "/teacher/students": () => import("../pages/teacher/StudentList"),
  "/teacher/lesson": () => import("../pages/teacher/ManageLesson"),
  "/teacher/lesson/history-dictionary": () =>
    import("../pages/teacher/ManageHistoryDictionary"),
  "/teacher/lesson/maps": () => import("../pages/teacher/ManageMaps"),
  "/teacher/lesson/source-archive": () =>
    import("../pages/teacher/ManageSourceArchive"),
  "/teacher/lesson/think-cloud": () =>
    import("../pages/teacher/ManageThinkCloud"),
  "/teacher/quiz": () => import("../pages/teacher/ManageQuiz"),
  "/teacher/quiz/history-classroom": () =>
    import("../pages/teacher/ManageHistoryClassroom"),
  "/teacher/exam": () => import("../pages/teacher/ManageExam"),
  "/teacher/points": () => import("../pages/teacher/ManagePoints"),
  "/teacher/settings": () => import("../pages/teacher/Settings"),
  "/teacher/settings/cutover": () =>
    import("../pages/teacher/SemesterCutoverCenter"),
};

const pending = new Map<string, Promise<unknown>>();

export const preloadTeacherRouteCode = (target: string) => {
  const pathname = target.split("?")[0];
  const loader = loaders[pathname];
  if (!loader || pending.has(pathname)) return;
  const request = loader().catch(() => {
    pending.delete(pathname);
  });
  pending.set(pathname, request);
};
