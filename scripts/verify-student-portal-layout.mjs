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
  "firebase": { auth: { currentUser: null } },
  "AppToastProvider": { useAppToast: () => ({ showToast() {} }) },
  "PointRankBadge": { default: () => null },
  "HeaderStudentWis": { default: () => null },
  "semesterArchive": { isSemesterArchive: false },
  "lazyWithRetry": { lazyWithRetry: () => () => null },
  "profileEmojis": { getDefaultProfileEmojiValue: () => "😀" },
  "studentProfileEmoji": { resolveStudentProfileEmoji: () => ({ rank: null, allowedEmojiIds: ["smile"], entry: { id: "smile", emoji: "😀" } }) },
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
      if (name.endsWith(".css")) return {};
      if (/\.(webp|png|svg)$/.test(name)) {
        const asset = path.resolve(path.dirname(file), name);
        assert(fs.existsSync(asset), `Missing image asset: ${name}`);
        return { __esModule: true, default: asset };
      }
      if (name === "react") return { ...React, useLayoutEffect: React.useEffect };
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
const { MENUS, sanitizeMenuConfig } = load("src/constants/menus.ts");
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
const submenu = (html, portal, group) => html.match(new RegExp(`id="${portal}-menu-${group}"[\\s\\S]*?<div class="teacher-sidebar-children"[^>]*>([\\s\\S]*?)</div>`))?.[1] || "";

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

  setup("student", "/student/score");
  const scoreGroup = auth.menuConfig.student.find(item => item.url === "/student/score");
  scoreGroup.name = "우리 반 점수";
  scoreGroup.children.find(child => child.url === "/student/score").name = "점수";
  const classroom = auth.menuConfig.student.find(item => item.url === "/student/quiz").children
    .find(child => child.url === "/student/history-classroom");
  Object.assign(classroom, { name: "역사2", nameCustomized: true });
  auth.menuConfig.student.find(item => item.url === "/student/points").name = "나의 위스";
  auth.menuConfig.student.find(item => item.url === "/student/mypage").name = "내 학습 기록";
  auth.menuConfig = sanitizeMenuConfig(sanitizeMenuConfig(auth.menuConfig));
  html = render("student", true);
  assert(html.includes('aria-label="우리 반 점수"'));
  assert.match(html, /<a(?=[^>]*href="#\/student\/score")(?=[^>]*aria-current="page")[^>]*>점수<\/a>/);
  assert.match(html, /href="#\/student\/history-classroom"[^>]*>역사2<\/a>/);
  for (const label of ["나의 위스", "내 학습 기록"])
    assert(html.includes(`class="teacher-sidebar-compact-label" aria-hidden="true">${label}</span>`));

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
  const roster = auth.menuConfig.teacher.find(item => item.url === "/teacher/students");
  roster.name = "우리 학교 학생";
  auth.menuConfig.teacher.find(item => item.url === "/teacher/lesson").children
    .find(child => child.url === "/teacher/lesson/history-dictionary").name = "수업 용어 사전";
  auth.menuConfig = sanitizeMenuConfig(auth.menuConfig);
  html = render("teacher", true);
  assert(html.includes('aria-label="우리 학교 학생"'));
  assert(html.includes('aria-label="수업 용어 사전"'));
  assert(html.includes('class="teacher-sidebar-compact-label" aria-hidden="true">우리 학교 학생</span>'));

  setup("teacher", "/teacher/points", "?tab=stocks");
  const legacyWis = auth.menuConfig.teacher.find(item => item.url === "/teacher/points");
  legacyWis.children.find(child => child.url.endsWith("tab=stocks")).name = "위스 주식";
  legacyWis.children.find(child => child.url.endsWith("tab=products")).name = "상품 관리";
  legacyWis.children.find(child => child.url.endsWith("shop=avatar")).name = "아바타 아이템 관리";
  auth.menuConfig = sanitizeMenuConfig(sanitizeMenuConfig(auth.menuConfig));
  html = render("teacher");
  const village = submenu(html, "teacher", "shop");
  assert(html.includes('aria-label="위스 마을"'));
  assert.equal(urls(village).length, 3, "Village has only shop, avatar shop and WsPI destinations");
  assert(village.includes("위스 상점") && village.includes("아바타 상점") && village.includes("위스피(WsPI)"));
  assert.equal(urls(village).filter(url => url === "/teacher/points?tab=stocks").length, 1);
  assert(!submenu(html, "teacher", "points").includes("tab=stocks"), "WsPI leaves the Wis-management group");
  assert(!village.includes("tab=requests"), "Purchase requests are an internal shop tab");
  assert.match(village, /<a(?=[^>]*href="#\/teacher\/points\?tab=stocks")(?=[^>]*aria-current="page")[^>]*>/);
  location.search = "?tab=requests";
  assert.match(submenu(render("teacher"), "teacher", "shop"), /<a(?=[^>]*href="#\/teacher\/points\?tab=products")(?=[^>]*aria-current="page")[^>]*>/, "Old request bookmark selects the shop parent");
  const stockMenu = auth.menuConfig.teacher.find(item => item.url === "/teacher/points").children.find(child => child.url.endsWith("tab=stocks"));
  Object.assign(stockMenu, { name: "우리 반 투자실", nameCustomized: true });
  auth.menuConfig = sanitizeMenuConfig(auth.menuConfig);
  assert(submenu(render("teacher"), "teacher", "shop").includes("우리 반 투자실"), "Explicit custom labels survive migration");
  auth.currentUser.email = "staff@fixture.invalid";
  auth.userData = { role: "staff", teacherPortalEnabled: true, staffPermissions: ["point_read"] };
  html = render("teacher");
  assert(urls(html).includes("/teacher/points?tab=stocks"));
  assert(!urls(html).some(url => url.includes("shop=avatar")), "Avatar administration stays restricted");
  auth.userData.staffPermissions = ["lesson_read"];
  assert(!urls(render("teacher")).some(url => url.includes("/teacher/points")), "Staff without point access cannot see village destinations");

  setup("student", "/student/points", "?tab=orders");
  html = render("student");
  const studentVillage = submenu(html, "student", "shop");
  assert(html.includes('aria-label="위스 마을"'));
  assert.equal(urls(studentVillage).length, 2, "Student village keeps only the currently released shops");
  assert(studentVillage.includes("위스 상점") && studentVillage.includes("아바타 상점"));
  assert(!html.includes("tab=stocks") && !html.includes("위스피"), "Renaming never publishes student WsPI");
  assert.match(studentVillage, /<a(?=[^>]*href="#\/student\/points\?tab=shop")(?=[^>]*aria-current="page")[^>]*>/, "Order history bookmark selects the shop parent");
}
console.log("PASS: student/teacher route separation, configured labels, village destinations, preserved bookmarks, point/avatar permissions, closed student WsPI, mobile/desktop/collapsed navigation; no backend calls.");
