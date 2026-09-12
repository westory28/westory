import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRESENTATION_BASELINE = "676869fa289d3e7ecef234cbb5cca65c60ec4597";
const read = (path) => readFileSync(resolve(path), "utf8");
const show = (path) =>
  execFileSync("git", ["show", `${PRESENTATION_BASELINE}:${path}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

const app = read("src/App.tsx");
const mainLayout = read("src/components/layout/MainLayout.tsx");
const header = read("src/components/common/Header.tsx");
const footer = read("src/components/common/Footer.tsx");
const menu = read("src/constants/menus.ts");
const css = read("assets/css/style.css");
const appCss = read("src/assets/index.css");
const productionCss = show("assets/css/style.css");
const auth = read("src/contexts/AuthContext.tsx");
const login = read("src/pages/Login.tsx");
const maintenanceGate = read("src/components/auth/StudentMaintenanceGate.tsx");

assert.doesNotMatch(
  mainLayout,
  /AppShell|NavigationDrawer/u,
  "Production MainLayout must not mount the rejected shell.",
);
assert.doesNotMatch(
  app,
  /<AppShell|<NavigationDrawer/u,
  "Protected routes must not mount the rejected shell.",
);
assert.match(
  mainLayout,
  /<Header\s*\/>[\s\S]*?<main[\s\S]*?id="main-content"[\s\S]*?\{children\}[\s\S]*?<Footer\s*\/>/u,
  "Production Header/main/Footer order drifted.",
);
assert.equal(
  (mainLayout.match(/<main(?:\s|>)/gu) || []).length,
  1,
  "MainLayout must own one main landmark.",
);

assert.match(header, /import \{ MENUS \} from "\.\.\/\.\.\/constants\/menus"/u);
assert.match(header, /menuConfig\?\.teacher \|\| MENUS\.teacher/u);
assert.match(header, /getStudentVisibleMenuItems/u);
assert.match(header, /getVisibleChildren/u);
assert.equal(
  (header.match(/<NotificationBell\b/gu) || []).length,
  1,
  "Header must mount exactly one notification controller.",
);
assert.match(
  header,
  /<header className=\{isTeacherPortal \? "ws-teacher-header" : undefined\}>/u,
);
assert.match(header, /className="header-container"/u);
assert.match(header, /className=\{`desktop-nav/u);
assert.match(header, /id="mobile-menu"/u);
assert.match(header, /className="mobile-menu-btn"/u);
assert.match(header, /resolvedChildren\.map/u);
// Keep the approved top main menu with its dropdown destinations.
// Both consume the same permission-filtered menu tree.
assert.match(
  header,
  /<header\b[\s\S]*?<nav\s+className=\{`desktop-nav[\s\S]*?menuItems\.map[\s\S]*?<\/nav>[\s\S]*?<\/header>/u,
  "Main navigation must remain inside the top header.",
);
assert.match(
  header,
  /baseMenuItems\.filter\(\(item\) => canViewTeacherMenuUrl\(item\.url\)\)/u,
);
assert.match(
  header,
  /item\.children\.filter\(\(child\) => canViewTeacherMenuUrl\(child\.url\)\)/u,
);
assert.match(
  header,
  /return canAccessTeacherPath\(pathname, userData, currentUser\?\.email \|\| ""\)/u,
);
assert.match(header, /getStudentRouteAccess\([\s\S]*?\)\.allowed/u);
assert.match(
  header,
  /onPointerEnter=\{[\s\S]*?event\.pointerType === "mouse"[\s\S]*?setExpandedTopMenu\(item\.url\)/u,
);
assert.match(header, /aria-expanded=\{expandedTopMenu === item\.url\}/u);
assert.match(header, /event\.key === "Escape"/u);
assert.match(header, /event\.key === "ArrowDown"/u);
assert.doesNotMatch(header, /ws-teacher-sidebar|onTeacherContextVisibleChange/u,
  "Teacher destinations belong only in the top navigation.");
assert.doesNotMatch(mainLayout, /ws-teacher-layout|teacherContextVisible/u,
  "Main content must not reserve space for a duplicate global submenu.");
assert.doesNotMatch(
  header,
  /from\s+["']firebase\/(?:firestore|storage)["']/u,
  "Header must not own persistence queries or mutations.",
);
assert.match(footer, /footer/u);

for (const frozenLabel of [
  "학습",
  "평가",
  "점수",
  "위스",
  "마이페이지",
  "학습 자료 관리",
  "평가 관리",
  "점수 관리",
  "위스 관리",
  "학생 관리",
]) {
  assert.ok(
    menu.includes(`name: "${frozenLabel}"`),
    `Menu label drift: ${frozenLabel}`,
  );
}

const extractRule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{`, "mu").exec(source);
  assert.ok(match, `Missing CSS rule: ${selector}`);
  let depth = 0;
  for (let index = match.index; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  throw new Error(`Unclosed CSS rule: ${selector}`);
};
const normalizeCss = (value) => value.replace(/\s+/gu, " ").trim();
const treeCss = extractRule(appCss, ".ws-lesson-tree-desktop");
assert.match(treeCss, /position:\s*sticky/u);
assert.match(treeCss, /top:\s*calc\(var\(--ws-header-height\) \+ var\(--space-6\)\)/u);
const treePanelCss = extractRule(appCss, ".ws-lesson-tree-panel");
assert.match(treePanelCss, /border-radius:\s*var\(--radius-xl\)/u);
assert.match(treePanelCss, /box-shadow:\s*var\(--shadow-md\)/u);
assert.doesNotMatch(appCss, /\.ws-teacher-sidebar|\.ws-teacher-layout/u);
for (const selector of [
  "body",
  "header",
  ".header-container",
  ".logo-text",
  ".desktop-nav",
  ".nav-link",
  ".header-right",
  ".btn-logout",
  ".mobile-menu-btn",
  "#mobile-menu",
  ".mobile-link",
]) {
  assert.equal(
    normalizeCss(extractRule(css, selector)),
    normalizeCss(extractRule(productionCss, selector)),
    `Frozen Production CSS rule drift: ${selector}`,
  );
}
assert.match(css, /@media \(min-width: 1024px\)/u);
assert.match(css, /@media \(max-width: 1023px\)/u);
assert.match(css, /prefers-reduced-motion:\s*reduce/u);

const productionWordmarkBlob = execFileSync(
  "git",
  ["rev-parse", `${PRESENTATION_BASELINE}:public/icons/westory-wordmark.svg`],
  { encoding: "utf8" },
).trim();
const currentWordmarkBlob = execFileSync(
  "git",
  ["hash-object", "public/icons/westory-wordmark.svg"],
  { encoding: "utf8" },
).trim();
assert.equal(
  currentWordmarkBlob,
  productionWordmarkBlob,
  "Maintenance wordmark source blob drifted from Production.",
);

const authPreflight = auth.indexOf("readStudentMaintenanceBootstrap(user)");
const authSession = auth.indexOf(
  "synchronizeApplicationSession(",
  authPreflight,
);
assert.ok(
  authPreflight >= 0 && authSession > authPreflight,
  "Auth maintenance preflight must precede session open.",
);
const loginPreflight = login.indexOf("readStudentMaintenanceBootstrap(user)");
const loginSession = login.indexOf("openApplicationSession()", loginPreflight);
assert.ok(
  loginPreflight >= 0 && loginSession > loginPreflight,
  "Login maintenance preflight must precede session open.",
);
assert.match(
  maintenanceGate,
  /<Navigate to=\{STUDENT_MAINTENANCE_ROUTE\}/u,
  "Student maintenance redirect boundary is missing.",
);

console.log(
  JSON.stringify({
    suite: "w10p-shell-safety",
    passed: true,
    presentationBaseline: PRESENTATION_BASELINE,
    rejectedShellMounts: 0,
    notificationControllers: 1,
    topMainNavigation: true,
    lessonTreeContextPanel: true,
    permissionFilteredNavigation: true,
    frozenCssRules: 11,
    desktopBreakpoint: 1024,
    menuLabelsPreserved: 10,
    productionAccess: 0,
  }),
);
