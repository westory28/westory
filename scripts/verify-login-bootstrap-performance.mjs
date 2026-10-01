import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// A reproducible source-driven scheduling experiment, not a live latency claim.
// SDK persistence/OAuth/backend cold starts are outside this synthetic model.
const BASELINE = "9e8af51065a3eb49074f0ec4cbe7d9465fb92758";
const oldSource = (path) =>
  execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
const newSource = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (source, modules) => {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return exports;
};
assert.ok(
  newSource("src/pages/Login.tsx").includes("claimLoginBootstrap"),
  "Login must actually consume the provider operation",
);

function scheduler() {
  let now = 0,
    id = 0;
  const events = new Map();
  const set = (fn, delay) => {
    const key = ++id;
    events.set(key, { fn, at: now + delay });
    return key;
  };
  return {
    get now() {
      return now;
    },
    set,
    clear: (key) => events.delete(key),
    sleep: (delay) => new Promise((resolve) => set(resolve, delay)),
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

async function scenario(version, { sessionMs, profileMs, loginStartsAtMs }) {
  const source = version === "before" ? oldSource : newSource,
    time = scheduler(),
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
    failure = null;
  const session = load(source("src/lib/applicationSession.ts"), {
    "./firebase": {
      auth,
      getHttpsCallable: async () => async () => {
        rpcCount++;
        const start = time.now;
        await time.sleep(sessionMs);
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
  });
  const permission = load(source("src/lib/permissions.ts"), {});
  const { AuthStartupController } = load(source("src/lib/authStartup.ts"), {
    "./permissions": permission,
  });
  const controller = new AuthStartupController({
    currentUser: () => auth.currentUser,
    prepareSession: session.prepareApplicationSession,
    listenProfile: (_user, next) => {
      profileCount++;
      const start = time.now;
      const id = time.set(() => {
        traces.push({ stage: "profile", startMs: start, endMs: time.now });
        next({
          exists: true,
          data: profile,
          fromCache: false,
          hasPendingWrites: false,
        });
      }, profileMs);
      return () => time.clear(id);
    },
    change: (state) => {
      if (providerReady === null && state.phase === "ready") {
        assert.ok(traces.some((stage) => stage.stage === "session"));
        assert.ok(traces.some((stage) => stage.stage === "profile"));
        providerReady = time.now;
      }
    },
    sessionReady() {},
    mark() {},
    setTimer: time.set,
    clearTimer: time.clear,
  });
  // Enroll while the operation is pending. A later first-time flow must still
  // open fresh authority, as verified by the separate security regression suite.
  const flow = controller.beginLoginFlow(true);
  void controller.observe(account);
  time.set(() => {
    void controller.claimLoginBootstrap(account, flow).then(
      () => {
        routeReady = time.now;
      },
      (error) => {
        failure = error;
      },
    );
  }, loginStartsAtMs);
  for (let step = 0; step < 40 && routeReady === null && !failure; step++) {
    for (let micro = 0; micro < 32; micro++) await Promise.resolve();
    if (routeReady === null && !failure) time.next();
  }
  if (failure) throw failure;
  assert.notEqual(routeReady, null);
  assert.notEqual(providerReady, null);
  controller.dispose();
  return {
    version,
    rpcCount,
    profileConsumerCount: profileCount,
    providerReadyMs: providerReady,
    routeReadyMs: routeReady,
    stages: traces,
  };
}

const experiments = [];
for (const delays of [
  { sessionMs: 800, profileMs: 120, loginStartsAtMs: 100 },
  { sessionMs: 800, profileMs: 1200, loginStartsAtMs: 100 },
  { sessionMs: 800, profileMs: 120, loginStartsAtMs: 1000 },
]) {
  const before = await scenario("before", delays),
    after = await scenario("after", delays);
  for (const result of [before, after]) {
    assert.equal(result.rpcCount, 1);
    assert.equal(result.profileConsumerCount, 1);
  }
  assert.equal(before.providerReadyMs, delays.sessionMs + delays.profileMs);
  assert.equal(
    after.providerReadyMs,
    Math.max(delays.sessionMs, delays.profileMs),
  );
  assert.equal(
    before.routeReadyMs,
    Math.max(before.providerReadyMs, delays.loginStartsAtMs),
  );
  assert.equal(
    after.routeReadyMs,
    Math.max(after.providerReadyMs, delays.loginStartsAtMs),
  );
  experiments.push({ syntheticDelaysMs: delays, before, after });
}
console.log(
  JSON.stringify(
    {
      kind: "controlled-source-experiment",
      baselineCommit: BASELINE,
      experiments,
      limits:
        "Virtual scheduler and mocked Firebase transport. Profile consumer counts are logical calls, not measured production network requests. No live speedup, OAuth, persistence, backend cold-start, or production account claim.",
    },
    null,
    2,
  ),
);
