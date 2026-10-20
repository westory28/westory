import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Reuse the real Header/menu fixture and extend it through the real MainLayout
// and Footer. Auth, I/O and effects are isolated; no Firebase runtime is loaded.
const require = createRequire(import.meta.url);
let source = fs.readFileSync(
  "scripts/verify-student-portal-layout.mjs",
  "utf8",
);
source = source
  .replace(
    "const stubs = {",
    `const stubs = {
      firebase: { auth: { currentUser: null }, db: {} },
      firestore: { doc() {}, getDoc() { throw new Error("Read disabled"); } },
      loginPerf: { markLoginPerf() {}, measureLoginPerf() {} },
      LoadingState: { PageLoading: () => null, InlineLoading: () => null },
      AuthRecoveryState: { default: () => null },
      SemesterArchiveBoundary: { SemesterArchiveBanner: () => null, SemesterArchiveUnavailable: () => null, isArchiveUnavailableRoute: () => false },`,
  )
  .replace(
    '"safeStorage": { readLocalOnly:',
    '"safeStorage": { readStorage: () => null, readLocalOnly:',
  )
  .replace(
    'if (name === "react") return React;',
    'if (name.endsWith(".css")) return {}; if (name === "react") return React;',
  )
  .replace(
    /auth = \{\r?\n/,
    'auth = {\n    loading: false, authPhase: "ready", settingsLoadedAt: Date.now(),\n',
  );
source += `
const MainLayout = load("src/components/layout/MainLayout.tsx").default;
for (const small of [false, true]) {
  mobile = small;
  for (const pathname of ["/developer-log", "/developer-log/fixture-post"]) {
    setup("student", pathname);
    const html = renderToStaticMarkup(React.createElement(MainLayout, null, React.createElement("h1", null, "개발자 일지")));
    assert(html.includes("student-layout"), pathname + ": student layout class");
    assert(html.includes('aria-label="학생 메뉴"'), pathname + ": student sidebar");
    assert(html.includes('id="student-navigation-toggle"'), pathname + ": sidebar toggle");
    assert(html.includes('teacher-layout-footer'), pathname + ": compact footer");
    assert(urls(html).includes("/student/mypage"));
    assert(urls(html).includes("/developer-log"));
    assert(!urls(html).some((url) => url.startsWith("/teacher/")));
    setup("teacher", pathname);
    const teacherHtml = renderToStaticMarkup(React.createElement(MainLayout, null, React.createElement("h1", null, "개발자 일지")));
    assert(!teacherHtml.includes('aria-label="학생 메뉴"'), "Teacher common route must not gain student controls");
  }
}
console.log("PASS MainLayout + Header + Footer: student developer-log list/detail retain desktop/mobile student navigation; teacher controls unchanged.");
`;
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
vm.runInNewContext(code, {
  require,
  exports: {},
  console: {
    ...console,
    error: (message, ...args) => {
      if (
        String(message).includes("useLayoutEffect does nothing on the server")
      )
        return;
      console.error(message, ...args);
    },
  },
  URLSearchParams,
});
assert(source.includes('load("src/components/layout/MainLayout.tsx")'));
