import assert from "node:assert/strict";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  plugins: [react()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  define: {
    "import.meta.env.VITE_APP_ENV": JSON.stringify("test"),
    "import.meta.env.VITE_USE_FIREBASE_EMULATORS": JSON.stringify("true"),
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(
      "demo-westory-api-key",
    ),
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify("127.0.0.1"),
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(
      "demo-westory-navigation-runtime",
    ),
    "import.meta.env.VITE_FIREBASE_STORAGE_BUCKET": JSON.stringify(
      "demo-westory-navigation-runtime.appspot.com",
    ),
    "import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID":
      JSON.stringify("000000000000"),
    "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify(
      "1:000000000000:web:demo-westory-navigation-runtime",
    ),
  },
  logLevel: "silent",
});

try {
  const [{ mergeConfiguredNavigation }, metadata, menus] = await Promise.all([
    server.ssrLoadModule("/src/components/shell/AppShell.tsx"),
    server.ssrLoadModule("/src/constants/routeMetadata.ts"),
    server.ssrLoadModule("/src/constants/menus.ts"),
  ]);
  const { NAVIGATION_REGISTRY, getActiveNavigationItemId } = metadata;
  const { MENUS, sanitizeMenuConfig } = menus;

  const withCustomStudentParent = sanitizeMenuConfig({
    student: [
      {
        name: "위스 상점 바로가기",
        url: "/student/points?tab=shop",
        icon: "",
        children: [],
      },
      ...MENUS.student,
    ],
    teacher: MENUS.teacher,
  });
  const studentShopItems = mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.student,
    withCustomStudentParent.student,
  );
  assert.equal(studentShopItems[0].label, "위스 상점 바로가기");
  assert.equal(
    getActiveNavigationItemId(studentShopItems, "/student/points", "?tab=shop"),
    studentShopItems[0].id,
    "A query-specific custom parent must be the only selected navigation parent.",
  );

  const withMovedStudentChild = sanitizeMenuConfig({
    student: [
      {
        name: "내 일정 묶음",
        url: "/student/mypage",
        icon: "",
        children: [{ name: "전체 일정", url: "/student/calendar" }],
      },
      ...MENUS.student.filter((item) => item.url !== "/student/mypage"),
    ],
    teacher: MENUS.teacher,
  });
  const movedCalendarItems = mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.student,
    withMovedStudentChild.student,
  );
  assert.equal(movedCalendarItems[0].label, "내 일정 묶음");
  assert.equal(
    getActiveNavigationItemId(movedCalendarItems, "/student/calendar", ""),
    movedCalendarItems[0].id,
    "A moved child must select its configured parent instead of its former registry group.",
  );

  const withHiddenChild = sanitizeMenuConfig({
    student: MENUS.student.map((item) =>
      item.url === "/student/learning"
        ? {
            ...item,
            children: (item.children || []).map((child) =>
              child.url === "/student/lesson/maps"
                ? { ...child, hidden: true }
                : child,
            ),
          }
        : item,
    ),
    teacher: MENUS.teacher,
  });
  const hiddenChildItems = mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.student,
    withHiddenChild.student,
  );
  assert.equal(
    hiddenChildItems.some((item) =>
      (item.children || []).some(
        (child) => child.to === "/student/lesson/maps",
      ),
    ),
    false,
    "A stored hidden child cannot be reintroduced by supplemental navigation.",
  );

  const withCustomTeacherParent = sanitizeMenuConfig({
    student: MENUS.student,
    teacher: [
      {
        name: "문제 은행 바로가기",
        url: "/teacher/quiz?tab=bank",
        icon: "",
        children: [],
      },
      ...MENUS.teacher,
    ],
  });
  const teacherBankItems = mergeConfiguredNavigation(
    NAVIGATION_REGISTRY.teacher,
    withCustomTeacherParent.teacher,
  );
  assert.equal(teacherBankItems[0].label, "문제 은행 바로가기");
  assert.equal(
    getActiveNavigationItemId(teacherBankItems, "/teacher/quiz", "?tab=bank"),
    teacherBankItems[0].id,
    "Teacher query-specific custom menus must keep their configured active parent.",
  );

  console.log(
    JSON.stringify({
      suite: "w10r-navigation-runtime",
      passed: true,
      storedMenuConfigCases: 4,
      customParentsPreserved: 2,
      movedChildrenPreserved: 1,
      hiddenChildrenPreserved: 1,
      singleActiveParent: true,
    }),
  );
} finally {
  await server.close();
}
