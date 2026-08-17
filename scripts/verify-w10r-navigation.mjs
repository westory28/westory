import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const app = read("src/App.tsx");
const metadata = read("src/constants/routeMetadata.ts");
const menus = read("src/constants/menus.ts");
const appShell = read("src/components/shell/AppShell.tsx");
const drawer = read("src/components/shell/NavigationDrawer.tsx");
const permissions = read("src/lib/permissions.ts");

const unique = (values, label) => {
  const result = [...new Set(values)];
  assert.equal(result.length, values.length, `${label} contains duplicates.`);
  return result;
};
const pathOnly = (url) => String(url).split(/[?#]/u)[0] || "/";
const block = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Cannot resolve ${from} block.`);
  return source.slice(start, end);
};
const targetsFrom = (source, property) =>
  [...source.matchAll(new RegExp(`\\b${property}:\\s*"([^"]+)"`, "gu"))].map(
    (match) => match[1],
  );

const registeredRoutes = [
  ...app.matchAll(/<Route\b[\s\S]*?\bpath="([^"]+)"/gu),
].map((match) => match[1]);
unique(registeredRoutes, "App route registry");
assert.equal(registeredRoutes.length, 48);

const studentBlock = block(
  metadata,
  "export const STUDENT_GLOBAL_NAVIGATION",
  "export const TEACHER_GLOBAL_NAVIGATION",
);
const teacherBlock = block(
  metadata,
  "export const TEACHER_GLOBAL_NAVIGATION",
  "export const NAVIGATION_REGISTRY",
);
const studentTargets = [...new Set(targetsFrom(studentBlock, "to"))];
const teacherTargets = [...new Set(targetsFrom(teacherBlock, "to"))];
const allTargets = [...new Set([...studentTargets, ...teacherTargets])];

assert.equal(studentTargets.length, 22, "Student canonical menu target drift.");
assert.equal(teacherTargets.length, 26, "Teacher canonical menu target drift.");
assert.equal(allTargets.length, 48, "Combined canonical menu target drift.");

const expectedStudentTargets = [
  "/student/dashboard",
  "/student/learning",
  "/student/lesson/history-dictionary",
  "/student/lesson/maps",
  "/student/lesson/think-cloud",
  "/student/quiz",
  "/student/history-classroom",
  "/student/score",
  "/student/score/report",
  "/student/score/performance",
  "/student/score/written-exam",
  "/student/history",
  "/student/mypage",
  "/student/points",
  "/student/points?tab=hall-of-fame",
  "/student/points?tab=shop",
  "/student/points?tab=orders",
  "/student/calendar",
  "/student/schedule",
  "/student/attendance",
  "/student/communication",
  "/student/mypage/archive",
];
const expectedTeacherTargets = [
  "/teacher/dashboard",
  "/teacher/students",
  "/teacher/learning",
  "/teacher/lesson/history-dictionary",
  "/teacher/lesson/maps",
  "/teacher/lesson/source-archive",
  "/teacher/lesson/think-cloud",
  "/teacher/quiz",
  "/teacher/quiz?tab=log",
  "/teacher/quiz?tab=bank",
  "/teacher/quiz/history-classroom",
  "/teacher/exam",
  "/teacher/exam?tab=omr",
  "/teacher/exam?tab=performance",
  "/teacher/exam?tab=written-essay",
  "/teacher/points",
  "/teacher/points?tab=grant",
  "/teacher/points?tab=policy",
  "/teacher/points?tab=hall-of-fame",
  "/teacher/points?tab=products",
  "/teacher/points?tab=requests",
  "/teacher/schedule",
  "/teacher/attendance",
  "/teacher/communication",
  "/teacher/settings",
  "/teacher/settings/cutover",
];
assert.deepEqual(studentTargets.sort(), expectedStudentTargets.sort());
assert.deepEqual(teacherTargets.sort(), expectedTeacherTargets.sort());

for (const target of allTargets) {
  assert.ok(
    registeredRoutes.includes(pathOnly(target)),
    `Navigation dead link: ${target}`,
  );
}

const menuDefaults = block(menus, "export const MENUS", "const deepCloneMenus");
const legacyMenuTargets = [...new Set(targetsFrom(menuDefaults, "url"))];
for (const target of legacyMenuTargets) {
  assert.ok(
    allTargets.includes(target),
    `W4 menu target was not restored: ${target}`,
  );
}

const navigablePaths = new Set(allTargets.map(pathOnly));
const intentionalContextRoutes = new Set([
  "/",
  "/maintenance",
  "*",
  "/developer-log",
  "/developer-log/:postId",
  "/student/lesson/note",
  "/student/quiz/run",
  "/student/history-classroom/run",
  "/student/quiz/history2",
  "/student/quiz/history2/*",
  "/teacher/quiz/history2",
  "/teacher/quiz/history2/*",
  "/teacher/lesson",
]);
const orphanRoutes = registeredRoutes.filter(
  (route) => !navigablePaths.has(route) && !intentionalContextRoutes.has(route),
);
assert.deepEqual(
  orphanRoutes,
  [],
  `Unclassified orphan routes: ${orphanRoutes}`,
);
assert.equal(
  navigablePaths.size + intentionalContextRoutes.size,
  registeredRoutes.length,
  "Every registered route must be navigable or an intentional context route.",
);

const navigationIds = [
  ...metadata.matchAll(/\bid:\s*"((?:student|teacher)-[^"]+)"/gu),
].map((match) => match[1]);
const parentIds = new Set(
  [
    ...studentBlock.matchAll(/\bid:\s*"([^"]+)"/gu),
    ...teacherBlock.matchAll(/\bid:\s*"([^"]+)"/gu),
  ].map((match) => match[1]),
);
for (const navigationId of [
  ...metadata.matchAll(/\bnavigationId:\s*"([^"]+)"/gu),
].map((match) => match[1])) {
  assert.ok(
    parentIds.has(navigationId),
    `Unknown metadata navigationId: ${navigationId}`,
  );
}
assert.equal(parentIds.size, 15);
assert.equal(new Set(navigationIds).size >= parentIds.size, true);

assert.deepEqual(
  [...studentBlock.matchAll(/\bid:\s*"(student-[^"]+)"/gu)].map(
    (match) => match[1],
  ),
  [
    "student-learning",
    "student-assessment",
    "student-grade",
    "student-points",
    "student-mypage",
    "student-schedule",
    "student-today",
  ],
  "Student legacy parent order must remain intact before appended W8/W11 entries.",
);
assert.match(
  metadata,
  /const TEACHER_NAVIGATION_ORDER = \[\s*"teacher-learning",\s*"teacher-assessment",\s*"teacher-grade",\s*"teacher-points",\s*"teacher-students",\s*"teacher-home",\s*"teacher-schedule",\s*"teacher-admin"/u,
  "Teacher legacy parent order must remain intact before appended W8/W11 entries.",
);

assert.match(metadata, /export const NAVIGATION_REGISTRY/u);
assert.match(metadata, /export const getActiveNavigationItemId/u);
assert.match(metadata, /student:\s*STUDENT_GLOBAL_NAVIGATION/u);
assert.match(metadata, /teacher:\s*TEACHER_GLOBAL_NAVIGATION/u);
assert.match(appShell, /NAVIGATION_REGISTRY/u);
assert.match(appShell, /mergeConfiguredNavigation/u);
assert.match(appShell, /configuredItems\.map/u);
assert.match(appShell, /findTemplate/u);
assert.match(appShell, /configured-menu-/u);
assert.match(appShell, /getNavigationMatchPrefixes/u);
assert.match(appShell, /getActiveNavigationItemId/u);
assert.match(drawer, /getActiveNavigationItemId/u);
assert.match(
  appShell,
  /aria-current=\{active\s*\?\s*"location"\s*:\s*undefined\}/u,
  "Desktop dropdown parents must expose the current location to assistive technology.",
);
assert.match(
  appShell,
  /document\.getElementById\("westory-main-content"\)[\s\S]*\}, \[location\.pathname\]\);/u,
  "Query-only tab changes must preserve the initiating control's focus.",
);
assert.match(
  metadata,
  /children\.some\(\(child\)\s*=>\s*isNavigationChildActive/u,
  "A configured parent's active state must follow its rendered children.",
);
assert.doesNotMatch(
  appShell,
  /if\s*\(registryIndex\s*<\s*0\)\s*return\s*\[\]/u,
  "Stored custom parent menus cannot be discarded when they are not registry parents.",
);
assert.match(appShell, /configuredItem\.name/u);
assert.match(appShell, /configuredItem\.url/u);
assert.match(appShell, /configuredItem\.children/u);
assert.match(appShell, /configuredChild\.name/u);
assert.match(appShell, /configuredChild\.hidden\s*===\s*true/u);
assert.match(appShell, /menuConfig\?\.student/u);
assert.match(appShell, /menuConfig\?\.teacher/u);
assert.match(
  appShell,
  /const STUDENT_BOTTOM_NAVIGATION_IDS = \[\s*"student-today",\s*"student-learning",\s*"student-assessment",\s*"student-grade"/u,
);
assert.match(appShell, /id:\s*"student-more"[\s\S]*label:\s*"더보기"/u);
assert.match(appShell, /child\.allowed/u);
assert.match(drawer, /item\.children/u);
assert.doesNotMatch(
  drawer,
  /mode\s*===\s*"student-more"[\s\S]*item\.children/u,
  "Drawer children cannot be limited to student More mode.",
);

assert.match(
  metadata,
  /id:\s*"teacher-admin"[\s\S]*allowTeacherPath\("\/teacher\/settings"\)/u,
);
assert.match(
  metadata,
  /id:\s*"teacher-learning"[\s\S]*allowed:\s*canReadLessonManagement/u,
);
assert.match(
  metadata,
  /to:\s*"\/teacher\/lesson\/think-cloud"[\s\S]*allowed:\s*canManageW8Domains/u,
);
assert.match(
  permissions,
  /canReadLessonManagement\(userData, email\)[\s\S]*return "\/teacher\/lesson\/history-dictionary"/u,
);
assert.match(
  permissions,
  /pathname\.startsWith\("\/teacher\/lesson\/think-cloud"\)[\s\S]*return canManageW8Domains/u,
);

console.log(
  JSON.stringify({
    suite: "w10r-navigation",
    passed: true,
    registeredRoutes: registeredRoutes.length,
    canonicalMenuTargets: allTargets.length,
    studentMenuTargets: studentTargets.length,
    teacherMenuTargets: teacherTargets.length,
    restoredMenuTargets: legacyMenuTargets.length,
    remainingMissingMenuTargets: 0,
    orphanRoutes: 0,
    deadLinks: 0,
    duplicateRoutes: 0,
    verificationMode: "STATIC_CONTRACT",
    runtimeNavigationGate: "REQUIRED_SEPARATELY",
  }),
);
