import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.mjs";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  plugins: [react()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: "silent",
});

try {
  const [appSource, mainLayoutSource, loginSource, headerSource] =
    await Promise.all([
      readFile("src/App.tsx", "utf8"),
      readFile("src/components/layout/MainLayout.tsx", "utf8"),
      readFile("src/pages/Login.tsx", "utf8"),
      readFile("src/components/common/Header.tsx", "utf8"),
    ]);
  assert.match(
    appSource,
    /<ProtectedAccessGate>[\s\S]*<MainLayout>/,
    "ProtectedAccessGate must wrap MainLayout",
  );
  assert.doesNotMatch(
    mainLayoutSource,
    /canAccessTeacherPath|canAccessTeacherPortal|getDefaultTeacherRoute/,
    "MainLayout must not use redirect-after-render authorization",
  );
  assert.match(appSource, /LegacyRouteRedirect to="\/student\/quiz"/);
  assert.match(appSource, /LegacyRouteRedirect to="\/teacher\/quiz"/);
  assert.match(
    appSource,
    /path="\/teacher\/lesson"[\s\S]*?TeacherLessonLegacyRedirect/,
  );
  assert.match(
    appSource,
    /const TeacherLessonLegacyRedirect[\s\S]*canManageW8Domains[\s\S]*"\/teacher\/learning"[\s\S]*canReadLessonManagement[\s\S]*"\/teacher\/lesson\/history-dictionary"/,
  );
  assert.match(loginSource, /runtimeEnvironment === "staging"/);
  assert.match(loginSource, /signInWithEmailAndPassword/);
  assert.match(headerSource, /runtimeEnvironment === "staging"/);
  assert.match(headerSource, /세션 만료 테스트/);

  const { resolveProtectedRouteAccess } = await server.ssrLoadModule(
    "/src/lib/accessControl.ts",
  );
  const { ProtectedAccessBoundary } = await server.ssrLoadModule(
    "/src/components/auth/ProtectedAccessBoundary.tsx",
  );
  const { getDefaultTeacherRoute } = await server.ssrLoadModule(
    "/src/lib/permissions.ts",
  );

  const profile = (uid, role, extras = {}) => ({
    uid,
    email: `${uid}@yongshin-ms.ms.kr`,
    role,
    staffPermissions: [],
    teacherPortalEnabled: false,
    ...extras,
  });
  const decide = ({
    status = "AUTHENTICATED",
    uid = "student-1",
    email = "student-1@yongshin-ms.ms.kr",
    userData = profile("student-1", "student"),
    pathname = "/student/dashboard",
  } = {}) =>
    resolveProtectedRouteAccess({
      authenticationStatus: status,
      identity: uid ? { uid, email } : null,
      userData,
      pathname,
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
  for (const pathname of studentRoutes) {
    assert.equal(decide({ pathname }).status, "AUTHORIZED", pathname);
  }

  const adminProfile = profile("admin-1", "teacher", {
    email: "westoria28@gmail.com",
  });
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
  for (const pathname of teacherRoutes) {
    assert.equal(
      resolveProtectedRouteAccess({
        authenticationStatus: "AUTHENTICATED",
        identity: { uid: "admin-1", email: "westoria28@gmail.com" },
        userData: adminProfile,
        pathname,
      }).status,
      "AUTHORIZED",
      `admin ${pathname}`,
    );
  }

  const teacherProfile = profile("teacher-1", "teacher");
  const teacherDecision = (pathname, extras = {}) =>
    decide({
      uid: "teacher-1",
      email: "teacher-1@yongshin-ms.ms.kr",
      userData: { ...teacherProfile, ...extras },
      pathname,
    });
  for (const pathname of [
    "/teacher/dashboard",
    "/teacher/students",
    "/teacher/quiz",
    "/teacher/quiz/history-classroom",
    "/teacher/exam",
    "/teacher/lesson",
  ]) {
    assert.equal(teacherDecision(pathname).status, "AUTHORIZED", pathname);
  }
  assert.equal(teacherDecision("/teacher/settings").status, "UNAUTHORIZED");
  assert.equal(teacherDecision("/teacher/schedule").status, "UNAUTHORIZED");
  assert.equal(teacherDecision("/teacher/points").status, "UNAUTHORIZED");
  assert.equal(
    teacherDecision("/teacher/points", {
      teacherPortalEnabled: true,
      staffPermissions: ["point_manage"],
    }).status,
    "AUTHORIZED",
  );

  const staffProfile = profile("staff-1", "staff", {
    teacherPortalEnabled: true,
    staffPermissions: ["lesson_read"],
  });
  assert.equal(
    decide({
      uid: "staff-1",
      email: "staff-1@yongshin-ms.ms.kr",
      userData: staffProfile,
      pathname: "/teacher/lesson",
    }).status,
    "AUTHORIZED",
  );
  assert.equal(
    getDefaultTeacherRoute(staffProfile, staffProfile.email),
    "/teacher/lesson/history-dictionary",
  );
  assert.equal(
    decide({
      uid: "staff-1",
      email: "staff-1@yongshin-ms.ms.kr",
      userData: staffProfile,
      pathname: "/teacher/lesson/think-cloud",
    }).status,
    "UNAUTHORIZED",
  );
  assert.equal(
    decide({
      uid: "staff-1",
      email: "staff-1@yongshin-ms.ms.kr",
      userData: staffProfile,
      pathname: "/teacher/quiz",
    }).status,
    "UNAUTHORIZED",
  );

  assert.equal(
    decide({ pathname: "/teacher/dashboard" }).status,
    "UNAUTHORIZED",
  );
  assert.equal(
    decide({ status: "ANONYMOUS", uid: null, userData: null }).status,
    "UNAUTHORIZED",
  );
  assert.equal(
    decide({
      uid: "outside-1",
      email: "outside@example.com",
      userData: null,
    }).status,
    "UNAUTHORIZED",
  );
  assert.equal(
    decide({
      uid: "student-2",
      userData: profile("student-1", "student"),
    }).status,
    "AUTHENTICATING",
  );
  assert.equal(decide({ pathname: "/developer-log" }).status, "AUTHORIZED");

  const emptyCounters = () => ({
    mounts: 0,
    protectedReads: 0,
    subscriptions: 0,
    commands: 0,
    writes: 0,
  });
  const renderBoundary = (decision, count) => {
    const SentinelChild = () => {
      count.mounts += 1;
      count.protectedReads += 1;
      count.subscriptions += 1;
      count.commands += 1;
      count.writes += 1;
      return React.createElement("div", null, "protected-child");
    };

    renderToString(
      React.createElement(
        StaticRouter,
        { location: "/teacher/settings" },
        React.createElement(
          ProtectedAccessBoundary,
          { decision },
          React.createElement(SentinelChild),
        ),
      ),
    );
  };

  const blockedDecisions = [
    decide({ status: "UNKNOWN", uid: null, userData: null }),
    decide({ status: "AUTHENTICATING", uid: null, userData: null }),
    decide({ pathname: "/teacher/settings" }),
    decide({ status: "SESSION_EXPIRED", uid: null, userData: null }),
    decide({ status: "ERROR", uid: null, userData: null }),
  ];
  for (const decision of blockedDecisions) {
    const count = emptyCounters();
    renderBoundary(decision, count);
    assert.deepEqual(
      count,
      emptyCounters(),
      `blocked state ${decision.status}`,
    );
  }

  const allowedCount = emptyCounters();
  renderBoundary(decide(), allowedCount);
  assert.deepEqual(allowedCount, {
    mounts: 1,
    protectedReads: 1,
    subscriptions: 1,
    commands: 1,
    writes: 1,
  });

  console.log(
    `Access gate: PASS (${studentRoutes.length} student routes, ${teacherRoutes.length} teacher routes, ${blockedDecisions.length} blocked states)`,
  );
} finally {
  await server.close();
}
