import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real component render functions and hooks with deterministic stubs.
// Firebase, browser storage, lazy portal modules, and the network are never loaded.
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;

const load = (code, modules, globals = {}) => {
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
    ...globals,
  });
  return exports;
};

const layoutCode = compile("../src/components/layout/MainLayout.tsx");
const recoveryCode = compile("../src/components/common/AuthRecoveryState.tsx");
const permissions = load(compile("../src/lib/permissions.ts"), {});
const studentMenuAccess = load(
  compile("../src/lib/studentMenuAccess.ts"),
  {},
  {
    URLSearchParams,
  },
);

function hooks() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let render;
  const changed = (prior, deps) =>
    !prior || deps.some((dep, index) => !Object.is(dep, prior.deps[index]));
  const react = {
    Suspense: "Suspense",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useMemo: (fn, deps) => {
      const index = cursor++;
      if (changed(slots[index], deps)) slots[index] = { deps, result: fn() };
      return slots[index].result;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useRef: (initial) => {
      const index = cursor++;
      return (slots[index] ||= { current: initial });
    },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (next) => {
          const result = typeof next === "function" ? next(slots[index]) : next;
          if (!Object.is(result, slots[index])) {
            slots[index] = result;
            dirty = true;
          }
        },
      ];
    },
    useEffect: (fn, deps) => {
      const index = cursor++;
      const prior = slots[index];
      if (changed(prior, deps)) {
        slots[index] = { deps, cleanup: prior?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
  };
  return {
    react,
    initialize(fn) {
      render = fn;
    },
    render() {
      cursor = 0;
      dirty = false;
      tree = render();
      return tree;
    },
    flush() {
      for (let iteration = 0; iteration < 30; iteration++) {
        if (dirty) this.render();
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      throw new Error("Component hooks did not settle");
    },
    get tree() {
      return tree;
    },
  };
}

const nodes = (tree) => {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
};
const hasType = (tree, type) => nodes(tree).some((node) => node.type === type);
const protectedTypes = [
  "Header",
  "ProtectedChild",
  "student-history-dictionary-controller",
  "student-rank-promotion-controller",
  "teacher-patch-memo-controller",
];
const assertBlocked = (tree, message) => {
  for (const type of protectedTypes)
    assert.equal(
      hasType(tree, type),
      false,
      `${message}: ${type} stays unmounted`,
    );
};
const fakeUser = { uid: "test-account", email: "teacher@example.test" };
const profile = (role, additions = {}) => ({
  uid: fakeUser.uid,
  email: fakeUser.email,
  role,
  ...additions,
});

function layoutHarness({
  auth = {},
  pathname = "/student/dashboard",
  rolePreference = null,
} = {}) {
  const h = hooks();
  const events = {
    navigation: [],
    marks: [],
    paints: [],
    refreshes: [],
    toasts: [],
  };
  let nextAuth = {
    currentUser: fakeUser,
    userData: profile("student"),
    authPhase: "ready",
    authError: null,
    loading: false,
    retryAuth: async () => {},
    logout: async () => {},
    config: { showLesson: true, showQuiz: true, showScore: true },
    configReady: true,
    menuConfig: { student: [], teacher: [] },
    menuConfigReady: true,
    settingsLoadedAt: Date.now(),
    refreshConfig: async () => events.refreshes.push("config"),
    refreshMenuConfig: async () => events.refreshes.push("menu"),
    ...auth,
  };
  const navigate = (...args) => events.navigation.push(args);
  const showToast = (value) => events.toasts.push(value);
  const location = { pathname, search: "" };
  const { default: MainLayout } = load(layoutCode, {
    react: h.react,
    "../../lib/semesterArchive": { isSemesterArchive: false },
    "../common/SemesterArchiveBoundary": {
      SemesterArchiveBanner: "SemesterArchiveBanner",
      SemesterArchiveUnavailable: "SemesterArchiveUnavailable",
      isArchiveUnavailableRoute: () => false,
    },
    "../common/AppToastProvider": {
      inferToastFromAlertMessage: () => null,
      useAppToast: () => ({ showToast }),
    },
    "../common/Header": { default: "Header", __esModule: true },
    "../common/PortalWorkspace": {
      PortalFallbackFooter: "PortalFallbackFooter",
      PortalWorkspaceFooterProvider: "PortalWorkspaceFooterProvider",
    },
    "./teacherLayout.css": {},
    "./studentLayout.css": {},
    "../common/LoadingState": { PageLoading: "PageLoading" },
    "../common/AuthRecoveryState": {
      default: "AuthRecoveryState",
      __esModule: true,
    },
    "../../contexts/AuthContext": { useAuth: () => nextAuth },
    "react-router-dom": {
      Navigate: "Navigate",
      useLocation: () => location,
      useNavigate: () => navigate,
    },
    "../../lib/loginPerf": {
      markLoginPerf: (...args) => events.marks.push(args),
      measureLoginPerf: () => {},
    },
    "../../lib/safeStorage": { readStorage: () => rolePreference },
    "../../lib/browserTasks": {
      runAfterNextPaint: (fn) => {
        events.paints.push(fn);
        fn();
        return () => {};
      },
    },
    "../../lib/lazyWithRetry": { lazyWithRetry: (_fn, label) => label },
    "../../lib/studentMenuAccess": studentMenuAccess,
    "../../lib/permissions": permissions,
  });
  h.initialize(() =>
    MainLayout({ children: h.react.createElement("ProtectedChild") }),
  );
  return {
    ...h,
    events,
    setAuth(next) {
      nextAuth = { ...nextAuth, ...next };
      h.render();
    },
  };
}

for (const [phase, loading] of [
  ["resolving", true],
  ["opening-session", true],
  ["loading-profile", true],
  ["loading-profile", false],
]) {
  const h = layoutHarness({ auth: { authPhase: phase, loading } });
  const firstRender = h.render();
  assert.equal(firstRender.type, "PageLoading");
  assertBlocked(firstRender, phase);
  assertBlocked(h.flush(), `${phase} after effects`);
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
  assert.equal(h.events.refreshes.length, 0);
}

for (const auth of [
  { authPhase: "signed-out", currentUser: null, userData: null },
  { authPhase: "onboarding", currentUser: null, userData: null },
  { authPhase: "ready", userData: null },
  {
    authPhase: "ready",
    userData: profile("teacher", { uid: "previous-account" }),
  },
]) {
  const h = layoutHarness({ auth, pathname: "/teacher/settings" });
  const tree = h.render();
  assert.equal(tree.type, "Navigate");
  assert.equal(tree.props.to, "/");
  assert.equal(tree.props.replace, true);
  assertBlocked(tree, `${auth.authPhase}/missing or mismatched profile`);
  h.flush();
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
}

{
  const h = layoutHarness({
    auth: {
      authPhase: "error",
      currentUser: null,
      userData: null,
      logout: async () => {
        throw new Error("Sign-out could not finish");
      },
    },
  });
  const tree = h.render();
  await assert.rejects(tree.props.onRestart());
  assert.equal(
    h.events.navigation.length,
    0,
    "Restart must await sign-out before navigating",
  );
  assertBlocked(h.flush(), "failed sign-out stays in recovery");
}

{
  let retried = 0;
  const events = [];
  const h = layoutHarness({
    auth: {
      authPhase: "error",
      currentUser: null,
      userData: null,
      authError: { message: "연결을 확인해 주세요.", retryable: true },
      retryAuth: async () => retried++,
      logout: async () => events.push("logout"),
    },
  });
  const tree = h.render();
  assert.equal(tree.type, "AuthRecoveryState");
  assertBlocked(tree, "authentication error");
  await tree.props.onRetry();
  assert.equal(retried, 1);
  await tree.props.onRestart();
  assert.deepEqual(events, ["logout"]);
  assert.equal(h.events.navigation[0][0], "/");
  h.flush();
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
}

for (const rolePreference of [null, "teacher"]) {
  const h = layoutHarness({ pathname: "/teacher/settings", rolePreference });
  const tree = h.render();
  assert.equal(tree.type, "Navigate");
  assert.equal(tree.props.to, "/student/dashboard");
  assertBlocked(
    tree,
    "server student denies teacher access despite cached preference",
  );
  h.flush();
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
}

{
  const h = layoutHarness({
    pathname: "/teacher/settings",
    auth: {
      userData: profile("staff", {
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read"],
      }),
    },
  });
  const tree = h.render();
  assert.equal(tree.type, "Navigate");
  assert.equal(tree.props.to, "/teacher/lesson");
  assertBlocked(tree, "staff denies settings route");
}

{
  const h = layoutHarness({
    pathname: "/student/dashboard",
    rolePreference: "teacher",
    auth: { userData: profile("teacher") },
  });
  const tree = h.render();
  assert.equal(tree.type, "Navigate");
  assert.equal(tree.props.to, "/teacher/dashboard");
  assertBlocked(tree, "preserve verified teacher role preference");
}

for (const [pathname, userData] of [
  ["/student/dashboard", profile("student")],
  ["/teacher/dashboard", profile("teacher")],
  [
    "/teacher/lesson",
    profile("staff", {
      teacherPortalEnabled: true,
      staffPermissions: ["lesson_read"],
    }),
  ],
]) {
  const h = layoutHarness({ pathname, auth: { userData } });
  const firstRender = h.render();
  assert.equal(hasType(firstRender, "Header"), true);
  assert.equal(hasType(firstRender, "ProtectedChild"), true);
  const finalRender = h.flush();
  assert.equal(
    h.events.marks.length,
    1,
    "Ready mark is emitted only after an allowed route mount",
  );
  assert.equal(
    h.events.marks[0].length,
    1,
    "No pathname/account data enters ready measurement",
  );
  if (userData.role === "student")
    assert.equal(
      hasType(finalRender, "student-rank-promotion-controller"),
      true,
    );
  if (userData.role === "teacher")
    assert.equal(hasType(finalRender, "teacher-patch-memo-controller"), true);
  h.setAuth({ authPhase: "signed-out", currentUser: null, userData: null });
  assertBlocked(
    h.flush(),
    "logout removes all previously allowed portal nodes",
  );
}

{
  const h = layoutHarness({
    pathname: "/teacher/settings",
    auth: { userData: profile("teacher") },
  });
  h.render();
  h.flush();
  h.setAuth({ userData: profile("student") });
  const tree = h.flush();
  assert.equal(tree.type, "Navigate");
  assert.equal(tree.props.to, "/student/dashboard");
  assertBlocked(tree, "server-confirmed teacher permission revocation");
}

{
  const h = layoutHarness({
    pathname: "/student/lesson",
    auth: { configReady: false, menuConfigReady: false },
  });
  const tree = h.render();
  assert.equal(tree.type, "PageLoading");
  assertBlocked(tree, "student visibility settings pending");
  h.flush();
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
}

{
  const h = layoutHarness({
    pathname: "/student/lesson",
    auth: { config: { showLesson: false, showQuiz: true, showScore: true } },
  });
  h.render();
  const tree = h.flush();
  assertBlocked(
    tree,
    "hidden student lesson remains blocked after visibility verification",
  );
  assert.equal(h.events.marks.length, 0);
  assert.equal(h.events.paints.length, 0);
  assert.equal(h.events.navigation[0][0], "/student/dashboard");
}

// Recovery controls: immediate double clicks share one action; both controls stay
// disabled while awaiting it, and raw rejection text is never rendered.
{
  const h = hooks();
  const { default: Recovery } = load(recoveryCode, { react: h.react });
  let resolveRetry;
  let calls = 0;
  const retry = new Promise((resolve) => (resolveRetry = resolve));
  h.initialize(() =>
    Recovery({
      error: { message: "연결 상태를 확인해 주세요.", retryable: true },
      onRetry: () => {
        calls++;
        return retry;
      },
      onRestart: async () => {},
    }),
  );
  const buttons = nodes(h.render()).filter((node) => node.type === "button");
  assert.equal(buttons.length, 2);
  assert.equal(
    buttons.every((node) => node.props.type === "button"),
    true,
  );
  buttons[0].props.onClick();
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  assert.equal(calls, 1);
  assert.equal(
    nodes(h.flush())
      .filter((node) => node.type === "button")
      .every((node) => node.props.disabled),
    true,
  );
  resolveRetry();
  await new Promise(setImmediate);
  assert.equal(
    nodes(h.flush())
      .filter((node) => node.type === "button")
      .every((node) => !node.props.disabled),
    true,
  );
}

{
  const h = hooks();
  const { default: Recovery } = load(recoveryCode, { react: h.react });
  h.initialize(() =>
    Recovery({
      error: { message: "다시 로그인해 주세요.", retryable: false },
      onRetry: async () =>
        assert.fail("Nonretryable errors must not offer retry"),
      onRestart: async () => {
        throw new Error("private-account@example.test secret-token");
      },
    }),
  );
  const buttons = nodes(h.render()).filter((node) => node.type === "button");
  assert.equal(buttons.length, 1);
  buttons[0].props.onClick();
  await new Promise(setImmediate);
  const tree = h.flush();
  assert.equal(JSON.stringify(tree).includes("private-account"), false);
  assert.equal(JSON.stringify(tree).includes("secret-token"), false);
  assert.equal(
    JSON.stringify(tree).includes("로그아웃을 완료하지 못했습니다"),
    true,
  );
}

console.log(
  "Auth render gates and recovery actions passed (local VM; no Firebase/network/browser QA).",
);
