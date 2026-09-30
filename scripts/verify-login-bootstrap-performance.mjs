import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// A reproducible source-driven scheduling experiment, not a live latency claim.
// SDK persistence/OAuth/backend cold starts are outside this synthetic model.
const BASELINE = "424415555416fdefc577ba607da50f1190e092b0";
const RPC_MS = 800,
  PROFILE_MS = 120;
const oldSource = (path) =>
  execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
const newSource = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
const load = (source, modules, globals = {}) => {
  const exports = {};
  vm.runInNewContext(compile(source), {
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
    console: { error() {}, warn() {} },
    ...globals,
  });
  return exports;
};
const baselineLogin = oldSource("src/pages/Login.tsx");
const parsed = ts.createSourceFile(
  "Login.tsx",
  baselineLogin,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let finishArrow;
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(parsed) === "finishLoginForRole"
  )
    finishArrow = node.initializer;
  ts.forEachChild(node, visit);
};
visit(parsed);
assert.ok(
  finishArrow &&
    ts.isArrowFunction(finishArrow) &&
    ts.isBlock(finishArrow.body),
);
const end = finishArrow.body.statements.findIndex(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (decl) => decl.name.getText(parsed) === "existing",
    ),
);
assert.ok(end >= 0, "Baseline Login profile boundary must be found explicitly");
const baselinePrefix = finishArrow.body.statements
  .slice(0, end + 1)
  .map((statement) => statement.getText(parsed))
  .join("\n");
assert.ok(baselinePrefix.includes("await prepareApplicationSession(user)"));
assert.ok(baselinePrefix.includes("await getDoc(userRef)"));
const baselineFinishSource = `export const finish = async (user: User, mode: LoginMode) => { ${baselinePrefix}\nreturn existing; };`;
assert.ok(
  newSource("src/pages/Login.tsx").includes("claimLoginBootstrap"),
  "Patched Login must actually use the provider operation",
);

function scheduler() {
  let now = 0,
    id = 0;
  const events = new Map();
  return {
    get now() {
      return now;
    },
    set: (fn, delay) => {
      const key = ++id;
      events.set(key, { fn, at: now + delay });
      return key;
    },
    clear: (key) => events.delete(key),
    sleep: (delay) =>
      new Promise((resolve) => {
        const key = ++id;
        events.set(key, { fn: resolve, at: now + delay });
      }),
    next: () => {
      const next = [...events].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, "Scenario must finish before scheduler runs out of work");
      now = next[1].at;
      for (const [key, event] of [...events])
        if (event.at === now) {
          events.delete(key);
          event.fn();
        }
    },
  };
}
function reactHarness(source, modules, globals, valueChanged) {
  const slots = [],
    effects = [];
  let cursor = 0,
    dirty = true,
    value;
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    createElement: (_type, props) => {
      value = props.value;
      valueChanged(value);
      return props;
    },
    useContext: () => value,
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useMemo: (fn, deps) => {
      const index = cursor++,
        previous = slots[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
        slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
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
      const index = cursor++,
        previous = slots[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
  };
  const api = load(source, { ...modules, react }, globals);
  return {
    pump: () => {
      if (dirty) {
        dirty = false;
        cursor = 0;
        api.AuthProvider({ children: null });
        while (effects.length) effects.shift()();
      }
    },
    dispose: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}
async function scenario(version, loginStartsAt) {
  const time = scheduler(),
    traces = [],
    profile = { role: "student", privacyAgreed: true };
  const account = {
    uid: "synthetic-benchmark",
    getIdTokenResult: async () => ({ claims: { auth_time: 1234 } }),
  };
  const auth = { currentUser: account };
  let rpcCount = 0,
    profileCount = 0,
    providerReady = null,
    routeReady = null,
    render = () => {},
    cleanup = () => {},
    authCallback;
  const session = load(
    version === "before"
      ? oldSource("src/lib/applicationSession.ts")
      : newSource("src/lib/applicationSession.ts"),
    {
      "./firebase": {
        auth,
        getHttpsCallable: async () => async () => {
          rpcCount++;
          const start = time.now;
          await time.sleep(RPC_MS);
          traces.push({ stage: "session", startMs: start, endMs: time.now });
          return {
            data: {
              status: "active",
              authTime: 1234,
              authorityGeneration: "w1r2-2026-08-09",
              protocolVersion: 2,
              revision: "a".repeat(64),
            },
          };
        },
      },
      "./semesterArchive": { isSemesterArchive: false },
    },
  );
  const snapshot = () => ({
    exists: () => true,
    data: () => profile,
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const listenProfile = (_user, next) => {
    profileCount++;
    const start = time.now;
    const id = time.set(() => {
      traces.push({
        stage: "profile",
        source: "provider",
        startMs: start,
        endMs: time.now,
      });
      next(snapshot());
    }, PROFILE_MS);
    return () => time.clear(id);
  };
  if (version === "before") {
    const noop = () => {},
      permission = load(oldSource("src/lib/permissions.ts"), {});
    const provider = reactHarness(
      oldSource("src/contexts/AuthContext.tsx"),
      {
        "firebase/auth": {
          onAuthStateChanged: (_auth, callback) => {
            authCallback = callback;
            return noop;
          },
          signOut: async () => {},
        },
        "firebase/firestore": {
          doc: (_db, ...path) => path.join("/"),
          onSnapshot: (_path, next) => listenProfile(account, next),
        },
        "../lib/firebase": {
          auth,
          db: {},
          authPersistenceReady: Promise.resolve(),
        },
        "../lib/semesterArchive": {
          isSemesterArchive: false,
          archiveScope: null,
        },
        "../lib/applicationSession": session,
        "../constants/menus": {
          cloneDefaultMenus: () => ({}),
          sanitizeMenuConfig: (value) => value,
        },
        "../lib/permissions": permission,
        "../lib/loginPerf": { markLoginPerf: noop, measureLoginPerf: noop },
        "../lib/siteSettings": {
          invalidateSiteSettingDocCache: noop,
          readSiteSettingDoc: async () => ({}),
          readFreshSiteSettingDoc: async () => ({}),
        },
        "../lib/appEvents": {
          subscribeMenuConfigUpdated: () => noop,
          subscribeSystemConfigUpdated: () => noop,
        },
      },
      { window: { setTimeout: time.set, clearTimeout: time.clear } },
      (value) => {
        if (
          providerReady === null &&
          !value.loading &&
          value.currentUser &&
          value.userData
        )
          providerReady = time.now;
      },
    );
    render = provider.pump;
    cleanup = provider.dispose;
    render();
    void authCallback(account);
    const finish = load(
      baselineFinishSource,
      {},
      {
        prepareApplicationSession: session.prepareApplicationSession,
        markLoginPerf: noop,
        isAllowedLoginEmail: () => true,
        rejectUnauthorizedEmailLogin: async () => {},
        TEACHER_EMAIL: "synthetic-only",
        db: {},
        doc: (_db, ...path) => path.join("/"),
        getDoc: async () => {
          profileCount++;
          const start = time.now;
          await time.sleep(PROFILE_MS);
          traces.push({
            stage: "profile",
            source: "login",
            startMs: start,
            endMs: time.now,
          });
          return snapshot();
        },
      },
    ).finish;
    time.set(() => {
      void finish(account, "student").then(() => {
        routeReady = time.now;
      });
    }, loginStartsAt);
  } else {
    const permission = load(newSource("src/lib/permissions.ts"), {});
    const { AuthStartupController } = load(
      newSource("src/lib/authStartup.ts"),
      { "./permissions": permission },
    );
    const controller = new AuthStartupController({
      currentUser: () => auth.currentUser,
      prepareSession: session.prepareApplicationSession,
      listenProfile: (user, next) =>
        listenProfile(user, (snap) =>
          next({ exists: snap.exists(), data: snap.data(), ...snap.metadata }),
        ),
      change: (state) => {
        if (providerReady === null && state.phase === "ready")
          providerReady = time.now;
      },
      sessionReady() {},
      mark() {},
      setTimer: time.set,
      clearTimer: time.clear,
    });
    // Enroll the redirect/login flow while the provider operation is pending.
    // A flow first appearing after completion deliberately opens fresh authority.
    const flow = controller.beginLoginFlow(true);
    void controller.observe(account);
    time.set(() => {
      void controller.claimLoginBootstrap(account, flow).then(() => {
        routeReady = time.now;
      });
    }, loginStartsAt);
    cleanup = controller.dispose;
  }
  for (let step = 0; step < 40 && routeReady === null; step++) {
    for (let micro = 0; micro < 32; micro++) {
      await Promise.resolve();
      render();
    }
    if (routeReady === null) time.next();
  }
  assert.notEqual(routeReady, null);
  assert.notEqual(providerReady, null);
  cleanup();
  return {
    version,
    loginStartsAtMs: loginStartsAt,
    rpcCount,
    profileConsumerCount: profileCount,
    providerReadyMs: providerReady,
    routeReadyMs: routeReady,
    stages: traces,
  };
}
const concurrentBefore = await scenario("before", 100),
  concurrentAfter = await scenario("after", 100);
const sequentialBefore = await scenario("before", 1000),
  sequentialAfter = await scenario("after", 1000);
assert.equal(concurrentBefore.rpcCount, 1);
assert.equal(concurrentAfter.rpcCount, 1);
assert.equal(concurrentBefore.profileConsumerCount, 2);
assert.equal(concurrentAfter.profileConsumerCount, 1);
assert.equal(concurrentBefore.routeReadyMs, 920);
assert.equal(concurrentAfter.routeReadyMs, 920);
assert.equal(sequentialBefore.rpcCount, 2);
assert.equal(sequentialAfter.rpcCount, 1);
assert.equal(sequentialBefore.profileConsumerCount, 2);
assert.equal(sequentialAfter.profileConsumerCount, 1);
assert.equal(sequentialBefore.routeReadyMs, 1920);
assert.equal(sequentialAfter.routeReadyMs, 1000);
console.log(
  JSON.stringify(
    {
      kind: "controlled-source-experiment",
      baselineCommit: BASELINE,
      syntheticDelaysMs: { session: RPC_MS, profile: PROFILE_MS },
      concurrent: { before: concurrentBefore, after: concurrentAfter },
      sequential: { before: sequentialBefore, after: sequentialAfter },
      limits:
        "Virtual scheduler and mocked Firebase transport. Profile consumer counts are logical calls, not measured production network requests. No live speedup, OAuth, persistence, backend cold-start, student release, or production account claim.",
    },
    null,
    2,
  ),
);
