import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the shipped startup controller and session adapter together. The
// Firebase transport and clock are the only asynchronous test boundaries.
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const load = (source, modules) => {
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return exports;
};
const startup = load(compile("../src/lib/authStartup.ts"), {
  "./permissions": load(compile("../src/lib/permissions.ts"), {}),
  "./studentRegistrationStatus": load(
    compile("../src/lib/studentRegistrationStatus.ts"),
    {},
  ),
});
const sessionSource = compile("../src/lib/applicationSession.ts");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise(setImmediate);
};
const clock = () => {
  let now = 0;
  let next = 0;
  const timers = new Map();
  return {
    set(callback, delay) {
      const id = ++next;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clear: (id) => timers.delete(id),
    advance(duration) {
      const target = now + duration;
      while (true) {
        const entry = [...timers]
          .filter(([, timer]) => timer.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!entry) break;
        now = entry[1].due;
        timers.delete(entry[0]);
        entry[1].callback();
      }
      now = target;
    },
  };
};
const user = (uid, epoch = 1234) => ({
  uid,
  epoch,
  async getIdTokenResult() {
    return { claims: { auth_time: this.epoch } };
  },
});
const fixture = ({ role = "student", autoProfile = true } = {}) => {
  const auth = { currentUser: null };
  const timer = clock();
  const calls = [];
  const profiles = [];
  const states = [];
  const session = load(sessionSource, {
    "./semesterArchive": { isSemesterArchive: false },
    "./firebase": {
      auth,
      getHttpsCallable: async (name, options) => {
        assert.equal(name, "openApplicationSession");
        return async (payload) => {
          const gate = deferred();
          const call = {
            gate,
            payload,
            options,
            account: auth.currentUser,
            epoch: auth.currentUser.epoch,
            revision: String(calls.length + 1).padStart(64, "0"),
          };
          calls.push(call);
          return { data: await gate.promise };
        };
      },
    },
  });
  const controller = new startup.AuthStartupController({
    currentUser: () => auth.currentUser,
    prepareSession: session.prepareApplicationSession,
    listenProfile(account, next, error) {
      const subscription = { account, next, error, stopped: false };
      profiles.push(subscription);
      if (autoProfile)
        next({
          exists: true,
          data: { role },
          fromCache: false,
          hasPendingWrites: false,
        });
      return () => {
        subscription.stopped = true;
      };
    },
    change: (state) => states.push(state),
    sessionReady() {},
    mark() {},
    setTimer: timer.set,
    clearTimer: timer.clear,
  });
  const watch = (promise) => {
    void promise.catch(() => undefined);
    return promise;
  };
  return {
    auth,
    timer,
    calls,
    profiles,
    states,
    controller,
    session,
    get state() {
      return states.at(-1);
    },
    async signIn(account = user("fresh-student")) {
      const flow = controller.beginLoginFlow();
      auth.currentUser = account;
      await controller.observe(account);
      const claim = watch(controller.claimLoginBootstrap(account, flow));
      await flush();
      return { account, claim };
    },
    retry: () => watch(controller.retry()),
    async respond(index = calls.length - 1) {
      const call = calls[index];
      call.gate.resolve({
        status: "active",
        authTime: call.epoch,
        authorityGeneration: "w1r2-2026-08-09",
        protocolVersion: 2,
        revision: call.revision,
      });
      await flush();
    },
  };
};
let checks = 0;
const check = async (name, run) => {
  try {
    await run();
    checks++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};

for (const role of ["student", "teacher"])
  await check(
    `${role} fresh OAuth accepts a 30-second server response`,
    async () => {
      const h = fixture({ role });
      const { claim } = await h.signIn(user(`fresh-${role}`));
      h.timer.advance(30000);
      await flush();
      assert.equal(h.state.phase, "opening-session");
      assert.equal(
        h.state.currentUser,
        null,
        "Slow verification grants no access",
      );
      assert.equal(h.calls.length, 1);
      await h.respond();
      await claim;
      assert.equal(h.state.phase, "ready");
      assert.equal(h.state.userData.role, role);
      assert.equal(h.calls.length, 1, "Progress does not repeat the handshake");
      h.controller.dispose();
    },
  );

await check(
  "Session RPC has a bounded timeout within the startup budget and permits recovery",
  async () => {
    const h = fixture();
    const { account, claim } = await h.signIn();
    const timeout = h.calls[0].options?.timeout;
    assert(timeout >= 30000 && timeout < startup.AUTH_STARTUP_DEADLINE_MS);
    h.timer.advance(timeout);
    h.calls[0].gate.reject(
      Object.assign(new Error("Transport deadline"), {
        code: "functions/deadline-exceeded",
      }),
    );
    await assert.rejects(claim, { code: "functions/deadline-exceeded" });
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.retryable, true);
    assert.equal(
      h.auth.currentUser,
      account,
      "Transport failure keeps the SDK login",
    );
    const retry = h.retry();
    await flush();
    assert.equal(h.calls.length, 2);
    await h.respond(1);
    await retry;
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);

await check(
  "A slow server profile can complete without repeating a successful session handshake",
  async () => {
    const h = fixture({ autoProfile: false });
    const { claim } = await h.signIn();
    await h.respond();
    h.timer.advance(30000);
    await flush();
    assert.equal(h.state.phase, "loading-profile");
    h.profiles[0].next({
      exists: true,
      data: { role: "teacher" },
      fromCache: false,
      hasPendingWrites: false,
    });
    await claim;
    assert.equal(h.state.phase, "ready");
    assert.equal(h.state.userData.role, "teacher");
    assert.equal(h.calls.length, 1);
    h.controller.dispose();
  },
);

for (const lateResult of ["success", "auth-failure"])
  await check(
    `Retry separates timed-out work and ignores its late ${lateResult}`,
    async () => {
      const h = fixture();
      const { claim } = await h.signIn();
      h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
      await assert.rejects(claim, { code: "auth/startup-timeout" });
      assert.equal(h.state.phase, "error");
      const retry = h.retry();
      await flush();
      assert.equal(
        h.calls.length,
        2,
        "Manual retry must reach the server while retired transport is still pending",
      );
      assert.equal(h.profiles[0].stopped, true);
      if (lateResult === "success") {
        await h.respond(0);
        assert.equal(h.state.phase, "opening-session");
        assert.equal(h.state.currentUser, null);
      }
      await h.respond(1);
      await retry;
      assert.equal(h.state.phase, "ready");
      if (lateResult === "auth-failure") {
        h.calls[0].gate.reject(
          Object.assign(new Error("Old credential rejected"), {
            code: "functions/unauthenticated",
          }),
        );
        await flush();
        assert.equal(h.state.phase, "ready");
      }
      const proof = await h.session.ensureApplicationSessionProof(
        h.auth.currentUser,
      );
      assert.equal(proof.revision, h.calls[1].revision);
      assert.equal(
        h.calls.length,
        2,
        "Retired work cannot clear the new proof",
      );
      h.controller.dispose();
    },
  );

await check(
  "Two quick retries retire the intermediate attempt without parallel current handshakes",
  async () => {
    const h = fixture();
    const { claim } = await h.signIn();
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await assert.rejects(claim);
    const firstRetry = h.retry();
    const latestRetry = h.retry();
    await assert.rejects(firstRetry, { code: "auth/stale-attempt" });
    await flush();
    assert.equal(h.calls.length, 2);
    await h.respond(0);
    assert.equal(h.state.currentUser, null);
    await h.respond(1);
    await latestRetry;
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);

await check(
  "Changed auth epoch starts its own handshake and rejects the old response",
  async () => {
    const h = fixture();
    const { account, claim } = await h.signIn();
    account.epoch++;
    await h.controller.observe(account);
    await assert.rejects(claim, { code: "auth/stale-attempt" });
    await flush();
    assert.equal(h.calls.length, 2);
    await h.respond(0);
    assert.equal(h.state.currentUser, null);
    await h.respond(1);
    assert.equal(h.state.phase, "ready");
    const proof = await h.session.ensureApplicationSessionProof(account);
    assert.equal(proof.revision, h.calls[1].revision);
    h.controller.dispose();
  },
);

await check(
  "An active fresh request still waits for active same-epoch work",
  async () => {
    const h = fixture();
    h.auth.currentUser = user("active-session");
    const first = h.session.prepareApplicationSession(h.auth.currentUser);
    await flush();
    const fresh = h.session.prepareApplicationSession(h.auth.currentUser, {
      fresh: true,
    });
    await flush();
    assert.equal(h.calls.length, 1);
    await h.respond(0);
    await first;
    assert.equal(h.calls.length, 2);
    await h.respond(1);
    await fresh;
    h.controller.dispose();
  },
);

await check(
  "Server session success cannot replace a server-confirmed profile",
  async () => {
    const h = fixture({ autoProfile: false });
    const { claim } = await h.signIn();
    h.profiles[0].next({
      exists: true,
      data: { role: "teacher" },
      fromCache: true,
      hasPendingWrites: false,
    });
    await h.respond();
    assert.equal(h.state.phase, "loading-profile");
    assert.equal(h.state.currentUser, null);
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await assert.rejects(claim, { code: "auth/startup-timeout" });
    assert.equal(h.state.phase, "error");
    h.controller.dispose();
  },
);

await check(
  "Logout during slow verification cannot be undone by its response",
  async () => {
    const h = fixture();
    const { claim } = await h.signIn();
    h.session.invalidateApplicationSession(h.auth.currentUser);
    h.controller.invalidate();
    h.auth.currentUser = null;
    await assert.rejects(claim, { code: "auth/stale-attempt" });
    await h.respond();
    assert.equal(h.state.phase, "signed-out");
    assert.equal(h.state.currentUser, null);
    assert.equal(h.calls.length, 1);
    h.controller.dispose();
  },
);

console.log(
  `Auth startup/session integration: ${checks} regressions passed with actual controller and session adapter; no network or production writes.`,
);
