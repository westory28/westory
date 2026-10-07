import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the real Header, sidebar, menu visibility and route selection.
// Authentication and effects are synthetic; this check never calls Firebase.
let auth;
let location;
let mobile = false;
const cache = new Map();
const router = {
  Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: `#${to}` }, children),
  useLocation: () => location,
  useNavigate: () => () => {},
};
const stubs = {
  "AuthContext": { useAuth: () => auth },
  "AppToastProvider": { useAppToast: () => ({ showToast() {} }) },
  "PointRankBadge": { default: () => null },
  "HeaderStudentWis": { default: () => null },
  "semesterArchive": { isSemesterArchive: false },
  "lazyWithRetry": { lazyWithRetry: () => () => null },
  "profileEmojis": { getDefaultProfileEmojiValue: () => "😀" },
  "safeStorage": { readLocalOnly: () => null, removeStorage() {}, writeLocalOnly() {} },
  "browserTasks": {},
  "sessionActivity": {},
};
const load = (filename) => {
  const file = path.resolve(filename);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    console,
    URLSearchParams,
    window: { matchMedia: () => ({ matches: mobile }) },
    require: (name) => {
      if (name === "react") return React;
      if (name === "react-router-dom") return router;
      const stub = stubs[path.basename(name)];
      if (stub) return { __esModule: true, ...stub };
      assert(name.startsWith("."), `Unexpected external dependency: ${name}`);
      const target = path.resolve(path.dirname(file), name);
      return load([`${target}.ts`, `${target}.tsx`].find(fs.existsSync));
    },
  }, { filename: file });
  return exports;
};
const { MENUS } = load("src/constants/menus.ts");
const Header = load("src/components/common/Header.tsx").default;
const setup = (portal, pathname, search = "") => {
  location = { pathname, search };
  const email = portal === "teacher" ? "westoria28@gmail.com" : "layout-test@yongshin-ms.ms.kr";
  auth = {
    currentUser: { uid: "layout-only", email },
    userData: { uid: "layout-only", name: "화면 점검", role: portal, email, teacherPortalEnabled: false, staffPermissions: [] },
    config: { year: "2026", semester: "2", showLesson: true, showQuiz: true, showScore: true },
    configReady: true,
    menuConfigReady: true,
    menuConfig: JSON.parse(JSON.stringify(MENUS)),
    logout: async () => {},
  };
};
const render = (portal, collapsed = false) => renderToStaticMarkup(React.createElement(Header, {
  teacherLayout: portal === "teacher", studentLayout: portal === "student", sidebarCollapsed: collapsed,
}));
const urls = (html) => [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);

for (const small of [false, true]) {
  mobile = small;
  setup("student", "/student/points", "?tab=shop");
  let html = render("student");
  assert(html.includes('aria-label="학생 메뉴"'));
  assert(html.includes('id="student-navigation-toggle"'));
  assert(urls(html).every(url => url.startsWith("/student/")), "Student navigation leaked a teacher route");
  for (const target of ["/student/dashboard", "/student/lesson/note", "/student/quiz", "/student/history-classroom", "/student/score", "/student/history", "/student/points?tab=shop", "/student/mypage"]) assert(urls(html).includes(target), target);
  assert.match(html, /href="#\/student\/points\?tab=shop"[^>]*aria-current="page"|aria-current="page"[^>]*href="#\/student\/points\?tab=shop"/);
  assert(!html.includes("관리자 설정"));
  assert(render("student", true).includes("is-collapsed"));

  setup("student", "/student/dashboard");
  auth.config.showQuiz = false;
  auth.menuConfig.student.find(item => item.url === "/student/lesson/note").children.find(item => item.url.endsWith("/maps")).hidden = true;
  html = render("student");
  assert(!urls(html).some(url => url.startsWith("/student/quiz") || url.startsWith("/student/history-classroom") || url.endsWith("/maps")));

  setup("teacher", "/teacher/dashboard");
  html = render("teacher");
  assert(html.includes('aria-label="교사 메뉴"'));
  assert(urls(html).includes("/teacher/settings"));
  assert(urls(html).includes("/teacher/dashboard"));
  assert(!urls(html).some(url => url.startsWith("/student/")));
}
console.log("PASS: student/teacher route separation, configured visibility, active query route, mobile/desktop navigation and collapse rendering; no backend calls.");
