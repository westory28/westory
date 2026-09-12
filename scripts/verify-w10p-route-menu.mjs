import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const manifest = JSON.parse(read("scripts/w10p-route-menu-inventory.json"));
const app = read("src/App.tsx");
const menus = read("src/constants/menus.ts");
const header = read("src/components/common/Header.tsx");
const mainLayout = read("src/components/layout/MainLayout.tsx");
const studentMenuAccess = read("src/lib/studentMenuAccess.ts");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const registeredPaths = [...app.matchAll(/path=["']([^"']+)["']/gu)].map(
  (match) => match[1],
);
assert.equal(registeredPaths.length, manifest.rawRouteCount, "raw route drift");
assert.equal(
  new Set(registeredPaths).size,
  registeredPaths.length,
  "duplicate App route",
);
assert.deepEqual(
  [...registeredPaths].sort(),
  manifest.routes.map((route) => route.path).sort(),
  "App routes and W10P inventory differ",
);

const routeSlice = (routePath) => {
  const anchor = `path="${routePath}"`;
  const start = app.indexOf(anchor);
  assert.notEqual(start, -1, `route missing: ${routePath}`);
  const next = app.indexOf('path="', start + anchor.length);
  return app.slice(start, next === -1 ? app.length : next);
};

for (const route of manifest.routes) {
  const slice = routeSlice(route.path);
  if (route.component === "LegacyRouteRedirect") {
    assert.match(
      slice,
      new RegExp(
        `<LegacyRouteRedirect\\s+to=["']${escapeRegExp(route.target)}["']`,
        "u",
      ),
      `alias target drift: ${route.path}`,
    );
  } else {
    assert.match(
      slice,
      new RegExp(`<${escapeRegExp(route.component)}(?:\\s|\\/|>)`, "u"),
      `route component drift: ${route.path} -> ${route.component}`,
    );
  }
}

for (const [role, expected] of Object.entries(manifest.canonicalCounts)) {
  assert.equal(
    manifest.routes.filter((route) => route.role === role).length,
    expected,
    `${role} canonical count drift`,
  );
}
assert.equal(
  manifest.routes.filter((route) => route.role === "alias").length,
  4,
  "compatibility alias count drift",
);

const portalSlice = (portal, nextPortal) => {
  const start = menus.indexOf(`${portal}: [`);
  const end = nextPortal
    ? menus.indexOf(`${nextPortal}: [`, start)
    : menus.indexOf("};", start);
  assert.ok(start >= 0 && end > start, `menu portal slice missing: ${portal}`);
  return menus.slice(start, end);
};

const itemSlice = (portalSource, item, nextItem) => {
  const anchor = `name: "${item.name}"`;
  const start = portalSource.indexOf(anchor);
  assert.notEqual(start, -1, `menu missing: ${item.name}`);
  const end = nextItem
    ? portalSource.indexOf(`name: "${nextItem.name}"`, start + anchor.length)
    : portalSource.length;
  assert.ok(end > start, `menu order drift: ${item.name}`);
  return portalSource.slice(start, end);
};

const menuTargets = new Set();
for (const portal of ["student", "teacher"]) {
  const expectedItems = manifest.productionMenus[portal];
  const source = portalSlice(portal, portal === "student" ? "teacher" : null);
  let previousPosition = -1;

  expectedItems.forEach((item, index) => {
    const position = source.indexOf(`name: "${item.name}"`);
    assert.ok(
      position > previousPosition,
      `${portal} top-level menu order drift`,
    );
    previousPosition = position;
    const slice = itemSlice(source, item, expectedItems[index + 1]);
    assert.match(
      slice,
      new RegExp(`url:\\s*["']${escapeRegExp(item.url)}["']`, "u"),
      `menu URL drift: ${item.name}`,
    );
    menuTargets.add(item.url.split("?")[0]);

    const children = [...item.productionChildren, ...item.appendedChildren];
    let previousChildPosition = -1;
    for (const [name, url] of children) {
      const childMatch = new RegExp(
        `name:\\s*["']${escapeRegExp(name)}["'][\\s\\S]{0,160}?url:\\s*["']${escapeRegExp(url)}["']`,
        "u",
      ).exec(slice.slice(previousChildPosition + 1));
      const childPosition = childMatch
        ? previousChildPosition + 1 + childMatch.index
        : -1;
      assert.ok(
        childPosition > previousChildPosition,
        `child missing/order drift: ${item.name} > ${name}`,
      );
      previousChildPosition = childPosition;
      menuTargets.add(url.split("?")[0]);
    }
  });
}

assert.match(
  menus,
  /mergeFallbackChildren[\s\S]*fallbackItem\.children[\s\S]*mergedChildren\.push/u,
  "saved menuConfig fallback-child merge missing",
);
const compiledMenus = ts.transpileModule(menus, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const menuModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiledMenus).toString("base64")}`
);
const w11SavedMenuConfig = menuModule.cloneDefaultMenus();
w11SavedMenuConfig.student[0].url = "/student/learning";
w11SavedMenuConfig.student[0].children = [
  { name: "나의 학습", url: "/student/learning" },
  { name: "역사 사전", url: "/student/lesson/history-dictionary" },
  { name: "지도", url: "/student/lesson/maps" },
  {
    name: "싱크 클라우드",
    url: "/student/lesson/think-cloud",
    hidden: true,
  },
];
w11SavedMenuConfig.teacher[0].url = "/teacher/learning";
w11SavedMenuConfig.teacher[0].children = [
  { name: "학습 운영", url: "/teacher/learning" },
  { name: "역사 사전 관리", url: "/teacher/lesson/history-dictionary" },
  { name: "지도", url: "/teacher/lesson/maps", hidden: true },
  { name: "사료 창고", url: "/teacher/lesson/source-archive" },
  { name: "싱크 클라우드 관리", url: "/teacher/lesson/think-cloud" },
];
const migratedMenuConfig = menuModule.sanitizeMenuConfig(w11SavedMenuConfig);
assert.deepEqual(
  migratedMenuConfig.student.map((item) => item.url),
  menuModule.MENUS.student.map((item) => item.url),
  "W11 student menu_config creates a duplicate Production parent",
);
assert.equal(
  migratedMenuConfig.student[0].children.find(
    (item) => item.url === "/student/lesson/think-cloud",
  )?.hidden,
  true,
  "student child hidden state was lost during Production-order migration",
);
assert.equal(
  migratedMenuConfig.teacher[0].children.find(
    (item) => item.url === "/teacher/lesson/maps",
  )?.hidden,
  true,
  "teacher child hidden state was lost during Production-order migration",
);
const compiledStudentMenuAccess = ts.transpileModule(studentMenuAccess, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const studentMenuAccessModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiledStudentMenuAccess).toString("base64")}`
);
assert.deepEqual(
  studentMenuAccessModule.getStudentRouteAccess(
    { pathname: "/student/lesson/think-cloud" },
    { showLesson: true, showQuiz: true, showScore: true },
    migratedMenuConfig,
  ),
  {
    allowed: false,
    redirectTo: "/student/dashboard",
    reason: "menu-config",
    label: "싱크 클라우드",
  },
  "hidden migrated student route became accessible",
);
assert.deepEqual(
  migratedMenuConfig.teacher.map((item) => item.url),
  menuModule.MENUS.teacher.map((item) => item.url),
  "W11 teacher menu_config creates a duplicate Production parent",
);
assert.deepEqual(
  migratedMenuConfig.student[0].children.map((item) => item.url),
  menuModule.MENUS.student[0].children.map((item) => item.url),
  "W11 student learning children do not migrate to Production-first order",
);
assert.deepEqual(
  migratedMenuConfig.teacher[0].children.map((item) => item.url),
  menuModule.MENUS.teacher[0].children.map((item) => item.url),
  "W11 teacher learning children do not migrate to Production-first order",
);
assert.match(header, /menuConfig\?\.teacher\s*\|\|\s*MENUS\.teacher/u);
assert.match(header, /getStudentVisibleMenuItems\(menuConfig\.student/u);
assert.match(header, /resolvedChildren\.map\(\(child, childIdx\)/u);
assert.match(header, /-mobile-child-/u, "mobile child menus are not rendered");
assert.match(
  header,
  /canAccessTeacherPath\(/u,
  "teacher menu permission filter missing",
);
assert.doesNotMatch(
  mainLayout,
  /<AppShell/u,
  "legacy routes still mount AppShell",
);
assert.match(mainLayout, /<Header\s*\/>/u, "Top Header mount missing");
assert.doesNotMatch(header, /ws-teacher-sidebar|onTeacherContextVisibleChange/u);
assert.doesNotMatch(mainLayout, /ws-teacher-layout|teacherContextVisible/u);
assert.match(mainLayout, /<Footer\s*\/>/u, "Production Footer mount missing");

const implicitAccessPaths = new Set([
  "/student/dashboard",
  "/student/quiz/run",
  "/student/history-classroom/run",
  "/teacher/dashboard",
  "/teacher/settings",
  "/teacher/settings/cutover",
]);
const orphanRoutes = manifest.routes
  .filter((route) => ["student", "teacher", "admin"].includes(route.role))
  .filter((route) => !menuTargets.has(route.path))
  .filter((route) => !implicitAccessPaths.has(route.path));
assert.deepEqual(
  orphanRoutes,
  [],
  `normal-navigation orphan route(s): ${orphanRoutes.map((route) => route.path).join(", ")}`,
);

console.log(
  JSON.stringify(
    {
      suite: "w10p-route-menu",
      status: "PASS",
      rawRoutes: registeredPaths.length,
      aliases: 4,
      canonical: manifest.canonicalCounts,
      productionTopMenus: { student: 5, teacher: 5 },
      missingMenus: 0,
      orphanRoutes: 0,
      desktopChildrenRendered: true,
      mobileChildrenRendered: true,
      appShellAppliedToLegacyRoutes: false,
    },
    null,
    2,
  ),
);
