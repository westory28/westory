import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Route code may be fetched early, but only for an account that is being
// restored or is ready, only for a page a route really renders, and never for a
// student page the settings already held keep closed. No browser or network.
const read = (file) =>
  fs
    .readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");
const compile = (file) =>
  ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
const load = (code, modules) => {
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    URLSearchParams,
    require: (name) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return typeof modules[name] === "function"
        ? modules[name]()
        : modules[name];
    },
  });
  return exports;
};

const studentMenuAccess = load(compile("../src/lib/studentMenuAccess.ts"), {});
const menus = load(compile("../src/constants/menus.ts"), {
  "../lib/weplayTitle": load(compile("../src/lib/weplayTitle.ts"), {}),
  "../lib/avatarRoutes": load(compile("../src/lib/avatarRoutes.ts"), {}),
});

const requested = [];
let failNext = false;
const pageModule = () => {
  if (failNext) {
    failNext = false;
    throw new Error("Failed to fetch dynamically imported module");
  }
  return {};
};
const preloadSource = read("../src/lib/routeCodePreload.ts");
const pageImports = [
  ...preloadSource.matchAll(/"(\/[^"]+)":\s*\(\)\s*=>\s*import\("([^"]+)"\)/g),
].map(([, route, module]) => ({ route, module }));
const modules = { "./studentMenuAccess": studentMenuAccess };
for (const { module } of pageImports)
  modules[module] = () => {
    requested.push(module);
    return pageModule();
  };
const api = load(compile("../src/lib/routeCodePreload.ts"), modules);

let checks = 0;
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  checks++;
};
const config = {
  year: "2026",
  semester: "2",
  showLesson: true,
  showQuiz: true,
  showScore: true,
};
const defaults = () => JSON.parse(JSON.stringify(menus.MENUS));
const target = (overrides = {}) =>
  api.resolveRouteCodeTarget({
    authPhase: "opening-session",
    pathname: "/student/dashboard",
    search: "",
    savedRole: null,
    settingsLoaded: false,
    config: null,
    menuConfig: null,
    ...overrides,
  });

// The table and the router name the same module for every listed page.
const appSource = read("../src/App.tsx");
const lazyModules = new Map(
  [
    ...appSource.matchAll(
      /const (\w+) = lazyWithRetry\(\s*\(\) => import\("\.\/([^"]+)"\)/g,
    ),
  ].map(([, name, module]) => [name, module]),
);
const routeComponents = new Map(
  [
    ...appSource.matchAll(
      /path="([^"]+)"\s+element=\{renderWithLayout\(\s*<(\w+) \/>/g,
    ),
  ].map(([, route, name]) => [route, name]),
);
equal(pageImports.length, api.ROUTE_CODE_PATHS.length, "every entry is parsed");
assert.ok(pageImports.length >= 20, "the common pages are listed");
for (const { route, module } of pageImports) {
  const component = routeComponents.get(route);
  assert.ok(component, `${route} is a routed page`);
  equal(
    `../${lazyModules.get(component)}`,
    module,
    `${route} preloads the module its route renders`,
  );
}
for (const route of api.ROUTE_CODE_PATHS)
  assert.ok(
    !/weplay|history-classroom/.test(route),
    `${route}: game and history classroom code keep their own loading`,
  );

// No account, no portal code.
for (const authPhase of [
  "resolving",
  "signed-out",
  "onboarding",
  "registration-pending",
  "error",
  "",
])
  for (const savedRole of [null, "student", "teacher"])
    for (const pathname of ["/", "/student/dashboard", "/teacher/dashboard"])
      equal(
        target({ authPhase, savedRole, pathname }),
        "",
        `${authPhase || "unknown"} ${pathname}: nothing is fetched`,
      );

for (const authPhase of ["opening-session", "loading-profile", "ready"]) {
  equal(
    target({ authPhase }),
    "/student/dashboard",
    `${authPhase}: first page`,
  );
  equal(
    target({ authPhase, pathname: "/student/dashboard/" }),
    "/student/dashboard",
    "a trailing slash names the same page",
  );
  equal(
    target({ authPhase, pathname: "/" }),
    "",
    "no saved portal at the entry",
  );
  equal(
    target({ authPhase, pathname: "/", savedRole: "student" }),
    "/student/dashboard",
    "returning student",
  );
  equal(
    target({ authPhase, pathname: "/", savedRole: "teacher" }),
    "/teacher/dashboard",
    "returning teacher",
  );
  equal(
    target({ authPhase, pathname: "/", savedRole: "admin" }),
    "",
    "an unknown saved value is ignored",
  );
}

// Teacher pages need the portal this browser last signed in to.
equal(target({ pathname: "/teacher/lesson" }), "", "teacher page, no portal");
equal(
  target({ pathname: "/teacher/lesson", savedRole: "student" }),
  "",
  "teacher page, student portal",
);
equal(
  target({ pathname: "/teacher/lesson", savedRole: "teacher" }),
  "/teacher/lesson",
  "teacher page, teacher portal",
);
equal(
  target({ pathname: "/teacher/settings", savedRole: "teacher" }),
  "",
  "pages outside the table are never fetched early",
);
equal(target({ pathname: "/developer-log" }), "", "unlisted shared page");
equal(target({ pathname: "/student/unknown" }), "", "unknown student page");
equal(
  target({ pathname: "/student/quiz/run/extra" }),
  "",
  "only exact pages match",
);

// Pages behind the student visibility settings.
const controlled = {
  pathname: "/student/mypage",
  search: "?menu=avatar",
  savedRole: "student",
};
equal(target(controlled), "", "settings not loaded yet");
equal(
  target({ ...controlled, settingsLoaded: true }),
  "",
  "loaded flag without settings stays closed",
);
equal(
  target({
    ...controlled,
    settingsLoaded: true,
    config,
    menuConfig: defaults(),
  }),
  "/student/mypage",
  "allowed by the settings already held",
);
{
  const hidden = defaults();
  hidden.student
    .find((item) => item.url === "/student/mypage")
    .children.find(
      (child) => child.url === "/student/mypage?menu=avatar",
    ).hidden = true;
  equal(
    target({ ...controlled, settingsLoaded: true, config, menuConfig: hidden }),
    "",
    "hidden tab",
  );
  equal(
    target({
      ...controlled,
      search: "",
      settingsLoaded: true,
      config,
      menuConfig: hidden,
    }),
    "/student/mypage",
    "its open sibling",
  );
}
equal(
  target({
    pathname: "/student/lesson/note",
    settingsLoaded: true,
    config: { ...config, showLesson: false },
    menuConfig: defaults(),
  }),
  "",
  "system switch closed",
);
equal(
  target({
    pathname: "/student/quiz/run",
    search: "?unitId=fixture",
    settingsLoaded: true,
    config,
    menuConfig: defaults(),
  }),
  "/student/quiz/run",
  "exam entry follows its visible parent",
);
equal(
  target({
    pathname: "/student/quiz/run",
    settingsLoaded: true,
    config: { ...config, showQuiz: false },
    menuConfig: defaults(),
  }),
  "",
  "closed exam entry",
);
equal(
  target({ pathname: "/student/calendar" }),
  "/student/calendar",
  "pages outside the visibility settings need no settings",
);

// One download per page; a failed download may be tried again.
const settle = () => new Promise((resolve) => setImmediate(resolve));
api.preloadRouteCode("");
api.preloadRouteCode("/student/unknown");
api.preloadRouteCode("constructor");
await settle();
equal(requested.length, 0, "nothing to fetch for empty or unknown targets");
api.preloadRouteCode("/student/dashboard");
api.preloadRouteCode("/student/dashboard");
await settle();
equal(requested.length, 1, "repeated requests share one download");
equal(requested[0], "../pages/student/Dashboard", "the listed module");
failNext = true;
api.preloadRouteCode("/student/points");
await settle();
api.preloadRouteCode("/student/points");
await settle();
equal(
  requested.filter((module) => module === "../pages/student/Points").length,
  2,
  "a failed download is not remembered as done",
);

console.log(
  `Route code preload passed (${checks} assertions; local VM, no browser/network).`,
);
