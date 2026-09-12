import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const source = read("src/lib/teacherRoutePreload.ts");
const imports = [];
let failNext = false;
globalThis.__westorySyntheticCodeLoader = (path) => {
  imports.push(path);
  if (failNext) {
    failNext = false;
    return Promise.reject(new Error("synthetic chunk failure"));
  }
  return Promise.resolve({ default: null });
};
const compiled = ts.transpileModule(
  source.replace(/import\(("[^"]+")\)/gu, "globalThis.__westorySyntheticCodeLoader($1)"),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { preloadTeacherRouteCode } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
assert.deepEqual(imports, [], "Importing the header must not preload every route");
for (const route of ["/teacher/learning", "/teacher/schedule", "/teacher/attendance", "/teacher/communication", "/student/lesson/note", "https://untrusted.test/"]) preloadTeacherRouteCode(route);
assert.deepEqual(imports, [], "Retired, student, or unrecognized routes must not load");
preloadTeacherRouteCode("/teacher/points?tab=hall-of-fame");
preloadTeacherRouteCode("/teacher/points?tab=products");
await Promise.resolve();
assert.deepEqual(imports, ["../pages/teacher/ManagePoints"], "Repeated focus/hover must reuse the same code load");
failNext = true;
preloadTeacherRouteCode("/teacher/students");
await Promise.resolve();
preloadTeacherRouteCode("/teacher/students");
await Promise.resolve();
assert.equal(imports.filter((path) => path.endsWith("StudentList")).length, 2, "A failed speculative code load must remain retryable");
assert.doesNotMatch(source, /getDoc\(|getDocs\(|getHttpsCallable\(|executeWestoryCommand\(|getW8DomainState\(|getWisEconomyState\(/u, "Code preloading must not execute page reads or mutations");
const header = read("src/components/common/Header.tsx");
assert.match(header, /!currentUser\s*\|\|\s*!isTeacherPortal/u);
assert.match(header, /canViewTeacherMenuUrl\(route\)[\s\S]{0,80}preloadTeacherRouteCode\(route\)/u);
assert.match(header, /onPointerOverCapture/u);
assert.match(header, /onFocusCapture/u);
delete globalThis.__westorySyntheticCodeLoader;
console.log(JSON.stringify({ suite: "teacher-navigation-preload", passed: true, eagerLoads: 0, retiredLoads: 0, duplicateLoads: 0, failedLoadsRetryable: true, permissionGuard: true }));
