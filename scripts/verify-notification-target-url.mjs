import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import ts from "typescript";
import vm from "node:vm";

const compiled = await build({
  entryPoints: ["src/lib/notificationTargetUrl.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { getSafeNotificationTargetUrl: safe } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const safeTargets = [
  "/student",
  "/teacher",
  "/student/dashboard",
  "/teacher/exam?tab=performance&panel=objections",
  "/teacher/students?registration=fixture%2Fstudent",
  "/student/lesson/note?id=unit-1&title=%EC%84%B8%EC%A2%85#note-1",
  "/teacher/quiz?tab=log#result",
  "/student/points?tab=orders",
  "/teacher?tab=home",
  "/student#home",
  "/student/lesson/note?title=자료%20%26%20해설&query=https%3A%2F%2Fexample.invalid",
];
for (const target of safeTargets)
  assert.equal(safe(target), target, `Preserve ${target}`);
assert.equal(safe(" /student/dashboard "), "/student/dashboard");
const blockedTargets = [
  undefined,
  null,
  {},
  1,
  "",
  "/",
  "student/dashboard",
  "//example.invalid/path",
  "/\\example.invalid/path",
  "\\\\example.invalid/path",
  "https://example.invalid",
  "javascript:alert(1)",
  "data:text/html,example",
  "/student\\example.invalid",
  "/teacher/quiz\\history",
  "/student\n/dashboard",
  "\t/student/dashboard",
  "/student/\u0000dashboard",
  "/teacher/\u007fdashboard",
  "/student/%5c%5cexample.invalid",
  "/teacher/%0a/x",
  "/student/../../outside",
  "/student/%2e%2e/%2e%2e/outside",
  "/student-elsewhere",
  "/teacher.example.invalid",
  "/student/invalid%",
  "/%2fexample.invalid",
  "https://www.westory.kr/#/student/dashboard",
];
for (const target of blockedTargets)
  assert.equal(safe(target), "", `Reject ${JSON.stringify(target)}`);

// Check every existing configured event route, without loading any services.
const policies = readFileSync(
  "src/pages/teacher/components/SettingsNotifications.tsx",
  "utf8",
);
const defaults = [...policies.matchAll(/targetUrl:\s*"([^"]+)"/g)].map(
  (match) => match[1],
);
assert(defaults.length >= 20);
for (const target of defaults)
  assert.equal(safe(target), target, `Configured notification route ${target}`);

const bell = readFileSync("src/components/common/NotificationBell.tsx", "utf8");
assert.match(
  bell,
  /const targetUrl = getSafeNotificationTargetUrl\(\s*getNotificationTargetUrl\(notification\)/,
);
const ast = ts.createSourceFile(
  "NotificationBell.tsx",
  bell,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let resolver;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "getNotificationTargetUrl"
  )
    resolver = `const ${node.getText(ast)};`;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(resolver);
const scope = {};
vm.runInNewContext(
  ts.transpileModule(
    `${resolver}\nglobalThis.resolve = getNotificationTargetUrl;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  scope,
);
for (const type of [
  "system_notice",
  "history_classroom_passed",
  "point_order_requested",
  "history_dictionary_requested",
  "performance_score_objection_requested",
]) {
  for (const targetUrl of blockedTargets.filter(
    (value) => typeof value === "string" && value,
  )) {
    // The legacy resolver trims surrounding whitespace; interior controls,
    // backslashes, schemes and external hosts remain blocked at the final sink.
    if (/^\s/.test(targetUrl)) continue;
    assert.equal(
      safe(scope.resolve({ type, targetUrl })),
      "",
      `${type}: ${JSON.stringify(targetUrl)}`,
    );
  }
}
assert.equal(
  safe(
    scope.resolve({
      type: "point_order_requested",
      targetUrl: "/teacher/points",
    }),
  ),
  "/teacher/points?tab=requests",
);
assert.equal(
  safe(
    scope.resolve({
      type: "student_registration_requested",
      entityId: "fixture/student",
    }),
  ),
  "/teacher/students?registration=fixture%2Fstudent",
);
console.log(
  JSON.stringify({
    pass: true,
    validRoutes: safeTargets.length + defaults.length,
    blockedInputs: blockedTargets.length,
    notificationTypes: 5,
    checks:
      "Internal route/query/hash preserved; external schemes, hosts, backslashes, controls and namespace escapes blocked; existing event targets retained; no service calls",
  }),
);
