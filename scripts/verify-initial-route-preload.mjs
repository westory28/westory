import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Exercise the production loader with a held chunk. Speculation never invokes
// the component, while a later React lazy request reuses the same promise.
const retrySource = read("src/lib/lazyWithRetry.ts");
const retryCode = compile(retrySource.replace('import { lazy } from "react";', "").replace("export const", "const"));
const storage = new Map();
let reloads = 0;
const lazyWithRetry = new Function("lazy", "window", `${retryCode}; return lazyWithRetry;`)(
  (renderLoader) => ({ renderLoader }),
  { sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, location: { reload: () => reloads++ } },
);
let downloads = 0, mounts = 0;
const chunk = deferred();
const screen = lazyWithRetry(() => { downloads++; return chunk.promise; }, "fixture");
assert.equal(downloads, 0);
const first = screen.preload();
assert.equal(downloads, 1, "Code download starts while authentication is pending");
assert.equal(screen.preload(), first);
const rendering = screen.renderLoader();
assert.equal(downloads, 1, "Rendering must share the in-flight preload");
assert.equal(mounts, 0, "Importing code must not render a protected screen");
chunk.resolve({ default: () => { mounts++; } });
const loaded = await rendering;
assert.equal(mounts, 0);
loaded.default();
assert.equal(mounts, 1);
assert.equal(await screen.preload(), loaded);

let attempts = 0;
const retry = lazyWithRetry(() => ++attempts === 1
  ? Promise.reject(Error("Failed to fetch dynamically imported module"))
  : Promise.resolve({ default: () => null }), "retry");
await assert.rejects(retry.preload());
assert.equal(reloads, 0, "Speculative failure must not reload or clear the current view");
await retry.renderLoader();
assert.equal(attempts, 2, "A failed preload must not poison the later route render");
assert.equal(reloads, 0);
const broken = lazyWithRetry(() => Promise.reject(Error("Loading chunk failed")), "broken");
void broken.renderLoader();
await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
assert.equal(reloads, 1, "Actual rendered chunk failures retain the one-reload recovery");
await assert.rejects(broken.renderLoader(), /Loading chunk failed/);
assert.equal(reloads, 1);

// Execute the real route registry against inert lazy modules. It must download
// only the requested screen, including the two modules of the cutover screen.
const app = read("src/App.tsx");
const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const node of statement.declarationList.declarations) {
    if (node.initializer?.getText(ast).startsWith("lazyWithRetry(") || ["initialRouteCode", "preloadInitialRouteCode"].includes(node.name.getText(ast))) {
      declarations.push(`const ${node.getText(ast)};`);
    }
  }
}
const requests = [];
const preload = new Function("lazyWithRetry", compile(declarations.join("\n")) + "; return preloadInitialRouteCode;")(
  (_importer, key) => ({ preload: () => { requests.push(key); return Promise.resolve(); } }),
);
assert.deepEqual(requests, []);
const check = (route, expected) => {
  requests.length = 0;
  preload(route);
  assert.deepEqual(requests, expected, route);
};
check("#/teacher/lesson?id=one", ["manage-lesson"]);
check("#/student/dashboard", ["student-dashboard"]);
check("#/student/lesson/note?id=one", ["student-note"]);
check("#/teacher/settings/cutover", ["settings", "semester-cutover-center"]);
check("#/developer-log/post", ["developer-log"]);
check("", ["login"]);
check("#/maintenance", ["student-maintenance"]);
for (const unknown of ["#/not-a-route", "#https://untrusted.test/", "#constructor", "#__proto__", "#/teacher/learning"]) check(unknown, []);
const main = read("src/main.tsx");
assert.ok(main.indexOf("preloadInitialRouteCode(window.location.hash)") < main.indexOf("ReactDOM.createRoot"));
assert.match(app, /<ProtectedAccessGate>[\s\S]*?<MainLayout>[\s\S]*?<Suspense/u);
assert.match(app, /<StudentMaintenanceGate>/u);
assert.doesNotMatch(declarations.join("\n"), /getDoc\(|getDocs\(|executeWestoryCommand\(|fetch\(/u);
console.log(JSON.stringify({ suite: "initial-route-preload", passed: true, eagerDownloads: 0, duplicateDownloads: 0, mountsBeforeGuard: 0, failedPreloadRetryable: true, renderedFailureRecovery: true, routeCases: 12 }));
