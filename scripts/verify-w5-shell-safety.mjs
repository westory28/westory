import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = read("src/App.tsx");
const metadata = read("src/constants/routeMetadata.ts");
const shell = read("src/components/shell/AppShell.tsx");
const header = read("src/components/common/Header.tsx");
const mainLayout = read("src/components/layout/MainLayout.tsx");
const auth = read("src/contexts/AuthContext.tsx");
const login = read("src/pages/Login.tsx");
const maintenanceGate = read("src/components/auth/StudentMaintenanceGate.tsx");
const states = read("src/components/common/StatePanel.tsx");
const viewport = read("src/hooks/useShellViewport.ts");
const semesterContext = read("src/components/common/SemesterContextBar.tsx");
const manifest = read("public/manifest.webmanifest");
const html = read("index.html");
const css = read("assets/css/style.css");

const walkFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });

const studentRoutes = [
  "/student/dashboard",
  "/student/lesson/note",
  "/student/lesson/history-dictionary",
  "/student/lesson/maps",
  "/student/lesson/think-cloud",
  "/student/quiz",
  "/student/quiz/run",
  "/student/history-classroom",
  "/student/history-classroom/run",
  "/student/score",
  "/student/score/report",
  "/student/score/performance",
  "/student/score/written-exam",
  "/student/mypage",
  "/student/history",
  "/student/points",
  "/student/calendar",
];
const teacherRoutes = [
  "/teacher/dashboard",
  "/teacher/students",
  "/teacher/quiz",
  "/teacher/quiz/history-classroom",
  "/teacher/exam",
  "/teacher/settings",
  "/teacher/points",
  "/teacher/schedule",
  "/teacher/lesson",
  "/teacher/lesson/history-dictionary",
  "/teacher/lesson/maps",
  "/teacher/lesson/source-archive",
  "/teacher/lesson/think-cloud",
];

for (const route of [...studentRoutes, ...teacherRoutes]) {
  assert(app.includes(`path="${route}"`), `canonical route missing: ${route}`);
  assert(
    metadata.includes(`path: "${route}"`),
    `route metadata missing: ${route}`,
  );
}
assert(studentRoutes.length === 17, "student canonical route count drift");
assert(teacherRoutes.length === 13, "teacher canonical route count drift");
for (const alias of [
  "/student/quiz/history2",
  "/student/quiz/history2/*",
  "/teacher/quiz/history2",
  "/teacher/quiz/history2/*",
]) {
  assert(app.includes(`path="${alias}"`), `legacy alias missing: ${alias}`);
}

for (const label of [
  "학습",
  "평가",
  "점수",
  "위스",
  "마이페이지",
  "일정·출석·공지",
  "오늘",
]) {
  assert(
    metadata.includes(`label: "${label}"`),
    `student IA missing: ${label}`,
  );
}
assert(shell.includes('label: "더보기"'), "student mobile More entry missing");
for (const label of [
  "학습 자료 관리",
  "평가 관리",
  "점수 관리",
  "위스 관리",
  "학생 관리",
  "업무 홈",
  "일정과 소통",
  "관리자",
]) {
  assert(
    metadata.includes(`label: "${label}"`),
    `teacher IA missing: ${label}`,
  );
}

assert(
  !/firebase|firestore|getDoc|onSnapshot/u.test(shell),
  "AppShell must query 0",
);
assert(
  !/refreshConfig|refreshMenuConfig/u.test(mainLayout),
  "route navigation must not refresh settings",
);
const shellModeBlock = header.slice(
  header.indexOf("if (shellMode)"),
  header.indexOf("\n  return (", header.indexOf("if (shellMode)") + 20),
);
assert(shellModeBlock.length > 0, "shell header boundary missing");
assert(
  (shellModeBlock.match(/<NotificationBell/gu) || []).length === 1,
  "shell header must mount one notification controller",
);
assert(
  shell.includes("useShellViewport") &&
    viewport.includes("useSyncExternalStore"),
  "single responsive viewport source missing",
);
assert(
  shell.includes("studentMobileNav") && shell.includes("studentDesktopNav"),
  "student navigation mount boundary missing",
);
assert(
  shell.includes("getStudentRouteAccess") &&
    shell.includes("getVisibleStudentNavigation(config, menuConfig)"),
  "student navigation must consume the in-memory visibility contract",
);
assert(
  shell.includes("mergeConfiguredNavigation") &&
    shell.includes("menuConfig?.student") &&
    shell.includes("menuConfig?.teacher"),
  "shell navigation must preserve the stored menu name, order, and hierarchy contract",
);
assert(
  !semesterContext.includes('params.get("source")') &&
    !semesterContext.includes('params.get("provenance")') &&
    !semesterContext.includes('params.get("scope")'),
  "semester provenance must not trust arbitrary URL claims",
);

const nestedMainFiles = walkFiles(join(root, "src/pages"))
  .filter((path) => path.endsWith(".tsx"))
  .filter((path) => !path.endsWith(join("pages", "Login.tsx")))
  .filter((path) => !path.endsWith(join("student", "Maintenance.tsx")))
  .filter((path) => /<main(?:\s|>)/u.test(readFileSync(path, "utf8")));
assert(
  nestedMainFiles.length === 0,
  `protected route pages must use the shell main landmark: ${nestedMainFiles.join(", ")}`,
);

for (const state of [
  "LOADING",
  "CONTENT",
  "EMPTY",
  "ERROR",
  "PERMISSION",
  "SESSION_EXPIRED",
  "MAINTENANCE",
  "ARCHIVED",
  "LEGACY",
  "STALE",
  "PARTIAL",
  "OFFLINE",
  "DISABLED",
]) {
  assert(states.includes(`"${state}"`), `common state missing: ${state}`);
}
for (const provenance of [
  "CURRENT",
  "PREPARING",
  "ARCHIVE",
  "LEGACY",
  "EXPLICIT",
]) {
  assert(
    metadata.includes(`"${provenance}"`),
    `provenance missing: ${provenance}`,
  );
}

const authPreflight = auth.indexOf("readStudentMaintenanceBootstrap(user)");
const authSession = auth.indexOf(
  "synchronizeApplicationSession(",
  authPreflight,
);
assert(
  authPreflight >= 0 && authSession > authPreflight,
  "Auth maintenance preflight must precede session open",
);
const loginPreflight = login.indexOf("readStudentMaintenanceBootstrap(user)");
const loginSession = login.indexOf("openApplicationSession()", loginPreflight);
assert(
  loginPreflight >= 0 && loginSession > loginPreflight,
  "Login maintenance preflight must precede session open",
);
assert(
  app.indexOf("<StudentMaintenanceGate>") <
    app.indexOf("<StepUpReauthProvider>"),
  "maintenance gate must precede protected providers",
);
assert(
  maintenanceGate.includes("<Navigate to={STUDENT_MAINTENANCE_ROUTE}"),
  "maintenance redirect boundary missing",
);

for (const token of [
  "--ws-primary",
  "--ws-workspace-max",
  "--ws-student-nav-height",
  "--ws-teacher-sidebar-width",
  "--ws-ring",
  "--motion-fast",
]) {
  assert(css.includes(token), `design token missing: ${token}`);
}
for (const breakpoint of ["768px", "1280px"]) {
  assert(
    css.includes(breakpoint),
    `responsive CSS breakpoint missing: ${breakpoint}`,
  );
}
assert(css.includes("prefers-reduced-motion"), "reduced motion guard missing");
assert(shell.includes("ws-skip-link"), "skip link missing");
assert(
  shell.includes('aria-current={active ? "page"'),
  "current route label missing",
);
assert(
  html.includes("%BASE_URL%manifest.webmanifest") &&
    manifest.includes('"scope": "./"') &&
    manifest.includes('"start_url": "./"'),
  "PWA assets must preserve the deployment base path",
);

console.log(
  JSON.stringify(
    {
      passed: true,
      canonicalRoutes: {
        student: studentRoutes.length,
        teacher: teacherRoutes.length,
      },
      legacyAliases: 4,
      navigationQueryFactories: 0,
      duplicateResponsiveNavigationMounts: 0,
      commonStates: 13,
      maintenancePreSessionFence: true,
    },
    null,
    2,
  ),
);
