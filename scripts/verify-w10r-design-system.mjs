import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASELINE_SHA = "ef74b571a6964ddbc61eb7877a98d21b3c7c8c85";
const read = (path) => readFileSync(resolve(path), "utf8");
const design = read("DESIGN.md");
const globalCss = read("assets/css/style.css");
const appShell = read("src/components/shell/AppShell.tsx");
const studentDictionaryController = read(
  "src/components/common/StudentHistoryDictionaryController.tsx",
);
const manageQuiz = read("src/pages/teacher/ManageQuiz.tsx");
const studentList = read("src/pages/teacher/StudentList.tsx");
const quizBank = read("src/pages/teacher/components/QuizBankTab.tsx");
const cutoverController = read("src/pages/teacher/SemesterCutoverCenter.tsx");
const cutoverView = read("src/pages/teacher/SemesterCutoverCenterView.tsx");
const componentRegistry = read("src/components/common/componentRegistry.ts");

const requiredTokens = [
  "--ws-control-height",
  "--ws-control-height-compact",
  "--ws-global-nav-height",
  "--ws-context-sidebar-width",
  "--ws-shell-gutter-mobile",
  "--ws-shell-gutter-tablet",
  "--ws-shell-gutter-desktop",
];
for (const token of requiredTokens) {
  assert.ok(design.includes(token), `DESIGN.md is missing ${token}.`);
  assert.ok(globalCss.includes(token), `Runtime CSS is missing ${token}.`);
}

for (const component of [
  "PageHeader",
  "SemesterContextBar",
  "StatePanel",
  "ResponsiveDataContainer",
  "FormField",
  "ModalSurface",
  "AppDialogProvider",
]) {
  assert.match(
    componentRegistry,
    new RegExp(`\\b${component}:\\s*\\{`, "u"),
    `Common component registry is missing ${component}.`,
  );
}

assert.match(appShell, /NAVIGATION_REGISTRY/u);
assert.match(appShell, /ws-global-navigation/u);
assert.doesNotMatch(
  appShell,
  /ws-teacher-sidebar/u,
  "W10R AppShell cannot mount the global teacher sidebar.",
);
assert.match(
  studentDictionaryController,
  /const isStudentRoute = location\.pathname\.startsWith\(\s*"\/student\/lesson\/note"\s*\)/u,
  "The history-dictionary floating action must remain contextual to lesson notes.",
);
assert.doesNotMatch(
  manageQuiz,
  /(?:h|min-h)-\[calc\(100dvh-64px\)\]/u,
  "ManageQuiz must consume the remaining AppShell height instead of adding another viewport.",
);
assert.doesNotMatch(
  studentList,
  /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u,
  "Canonical StudentList actions must use the common dialog and toast providers.",
);
assert.doesNotMatch(
  quizBank,
  /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u,
  "Canonical QuizBank actions must use the common dialog and toast providers.",
);
assert.doesNotMatch(
  cutoverView,
  /<dd>\{source\.status|검증 항목:\s*\{check\.checkId\}|실행 ID\s*\{attempt\.attemptId\}|원문 상태\s*\{attempt\.status\}/u,
  "Cutover evidence must not expose internal identifiers or raw status codes.",
);
assert.doesNotMatch(
  cutoverController,
  /검증 근거 ID|의존성 해시/u,
  "Cutover readiness copy must remain operator-facing.",
);

const migratedStyleFiles = new Set([
  "assets/css/style.css",
  "src/assets/semesterCutover.css",
  "src/pages/w8Domains.css",
]);
const changedStyleFiles = execFileSync(
  "git",
  ["diff", "--name-only", BASELINE_SHA, "--", "*.css"],
  { encoding: "utf8" },
)
  .split(/\r?\n/u)
  .map((value) => value.trim())
  .filter(Boolean);
for (const file of changedStyleFiles) {
  assert.equal(
    migratedStyleFiles.has(file),
    true,
    `W10R introduced CSS outside the approved style files: ${file}`,
  );
}

const auditedFiles = [
  ...migratedStyleFiles,
  "src/components/common/TeacherOperationsQueue.tsx",
  "src/components/common/StudentHistoryDictionaryController.tsx",
  "src/components/shell/AppShell.tsx",
  "src/components/shell/NavigationDrawer.tsx",
  "src/pages/student/Dashboard.tsx",
  "src/pages/teacher/Dashboard.tsx",
  "src/pages/teacher/ManageQuiz.tsx",
  "src/pages/teacher/SemesterCutoverCenter.tsx",
  "src/pages/teacher/SemesterCutoverCenterView.tsx",
  "src/pages/teacher/StudentList.tsx",
  "src/pages/teacher/components/QuizBankTab.tsx",
];
const patch = execFileSync(
  "git",
  ["diff", "--unified=0", BASELINE_SHA, "--", ...auditedFiles],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const addedLines = patch
  .split(/\r?\n/u)
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1));

const violations = [];
for (const line of addedLines) {
  if (/#[0-9a-f]{3,8}\b/iu.test(line) || /\b(?:rgb|hsl)a?\(/iu.test(line)) {
    violations.push(`raw color: ${line.trim()}`);
  }
  if (
    /\b(?:margin|padding|gap)(?:-[a-z]+)?\s*:\s*-?(?:\d*\.)?\d+(?:px|rem)\b/iu.test(
      line,
    )
  ) {
    violations.push(`raw spacing: ${line.trim()}`);
  }
  if (/\bborder-radius\s*:\s*-?(?:\d*\.)?\d+(?:px|rem)\b/iu.test(line)) {
    violations.push(`raw radius: ${line.trim()}`);
  }
  if (/\bbox-shadow\s*:(?!\s*var\()/iu.test(line)) {
    violations.push(`raw shadow: ${line.trim()}`);
  }
  if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u.test(line)) {
    violations.push(`native dialog bypass: ${line.trim()}`);
  }
  if (
    /\b(?:bg|text|border|shadow|rounded|p[trblxy]?|m[trblxy]?|gap)-\[[^\]]+\]/u.test(
      line,
    )
  ) {
    violations.push(`arbitrary utility value: ${line.trim()}`);
  }
}
assert.deepEqual(
  violations,
  [],
  `W10R design-system violations:\n${violations.join("\n")}`,
);

console.log(
  JSON.stringify({
    suite: "w10r-design-system",
    passed: true,
    tokens: requiredTokens.length,
    registeredCommonComponents: 7,
    changedStyleFiles,
    rawColorViolations: 0,
    rawSpacingViolations: 0,
    rawRadiusViolations: 0,
    rawShadowViolations: 0,
    nativeDialogBypasses: 0,
  }),
);
