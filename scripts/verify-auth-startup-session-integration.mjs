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
  let profileImmediately = autoProfile;
  let settingsCalls = 0;
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
      if (profileImmediately)
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
    sessionReady() {
      settingsCalls++;
    },
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
    setAutoProfile(value) {
      profileImmediately = value;
    },
    get settingsCalls() {
      return settingsCalls;
    },
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
    await flush();
    assert.equal(h.state.phase, "opening-session");
    assert.equal(h.state.error, null);
    assert.equal(
      h.auth.currentUser,
      account,
      "Transport failure keeps the SDK login",
    );
    h.timer.advance(1000);
    await flush();
    assert.equal(h.calls.length, 2);
    await h.respond(1);
    await claim;
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

const transportError = (code = "unavailable", reason) =>
  Object.assign(new Error("Synthetic transport failure"), {
    code,
    ...(reason ? { details: { reason } } : {}),
  });
const snapshot = (role, extra = {}) => ({
  exists: true,
  data: { role },
  fromCache: false,
  hasPendingWrites: false,
  ...extra,
});
const ready = async (options = {}) => {
  const h = fixture(options);
  const { account, claim } = await h.signIn();
  await h.respond();
  if (options.autoProfile === false)
    h.profiles[0].next(snapshot(options.role || "student"));
  await claim;
  assert.equal(h.state.phase, "ready");
  return { h, account };
};

for (const role of ["student", "teacher"]) {
  await check(
    `${role}: transient token refresh preserves the mounted generation`,
    async () => {
      const { h, account } = await ready({ role });
      const generation = h.state.generation;
      const oldStates = h.states.length;
      let tokenCalls = 0;
      account.getIdTokenResult = async () => {
        if (++tokenCalls === 1)
          throw transportError("auth/network-request-failed");
        return { claims: { auth_time: account.epoch } };
      };
      const observation = h.controller.observe(account);
      await flush();
      assert.equal(h.state.phase, "ready");
      assert.equal(h.state.generation, generation);
      h.timer.advance(1000);
      await observation;
      assert.equal(tokenCalls, 2);
      assert.equal(h.state.phase, "ready");
      assert.equal(
        h.states.length,
        oldStates,
        "Recovery must not publish a loading/error state",
      );
      assert.equal(
        h.calls.length,
        1,
        "Token recovery must not reopen the server session",
      );
      assert.equal(h.profiles.length, 1);
      assert.equal(h.settingsCalls, 1);
      h.controller.dispose();
    },
  );

  await check(
    `${role}: transient profile failure reattaches only its own subscription`,
    async () => {
      const { h } = await ready({ role });
      const generation = h.state.generation;
      const original = h.state.userData;
      h.profiles[0].error(transportError());
      assert.equal(h.state.phase, "ready");
      assert.equal(h.state.userData, original);
      assert.equal(h.profiles[0].stopped, true);
      h.profiles[0].next(snapshot(role, { exists: false, data: null }));
      assert.equal(
        h.state.phase,
        "ready",
        "Retired subscription cannot revoke the replacement",
      );
      h.timer.advance(1000);
      await flush();
      assert.equal(h.profiles.length, 2);
      assert.equal(h.state.phase, "ready");
      assert.equal(h.state.generation, generation);
      assert.equal(h.calls.length, 1);
      assert.equal(
        h.settingsCalls,
        1,
        "Profile recovery must not repeat config reads",
      );
      h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
      assert.equal(
        h.state.phase,
        "ready",
        "Successful server recovery cancels its deadline",
      );
      h.profiles[1].error(transportError("permission-denied"));
      assert.equal(h.state.phase, "error");
      assert.equal(h.state.error.retryable, false);
      assert.equal(h.state.userData, null);
      h.timer.advance(10000);
      await flush();
      assert.equal(
        h.profiles.length,
        2,
        "A rejected permission is never retried",
      );
      h.controller.dispose();
    },
  );

  await check(
    `${role}: cached or pending profiles cannot escalate permissions during recovery`,
    async () => {
      const { h } = await ready({ role, autoProfile: false });
      h.profiles[0].error(transportError());
      h.timer.advance(1000);
      await flush();
      const previous = h.state.userData;
      h.profiles[1].next(snapshot("teacher", { fromCache: true }));
      assert.equal(h.state.userData, previous);
      h.profiles[1].next(snapshot("teacher", { hasPendingWrites: true }));
      assert.equal(h.state.userData, previous);
      h.profiles[1].next(
        snapshot("student", {
          data: { role: "student", registrationApprovalStatus: "REJECTED" },
        }),
      );
      assert.equal(h.state.phase, "registration-pending");
      assert.equal(
        h.state.currentUser,
        null,
        "Server rejection removes existing portal access",
      );
      assert.equal(h.calls.length, 1);
      h.controller.dispose();
    },
  );
}

await check(
  "Profile recovery stops after two retries and can be retried explicitly",
  async () => {
    const { h } = await ready({ autoProfile: false });
    for (const [index, delay] of [
      [0, 1000],
      [1, 3000],
    ]) {
      h.profiles[index].error(transportError());
      assert.equal(h.state.phase, "ready");
      h.timer.advance(delay - 1);
      await flush();
      assert.equal(h.profiles.length, index + 1);
      h.timer.advance(1);
      await flush();
      assert.equal(h.profiles.length, index + 2);
    }
    h.profiles[2].error(transportError());
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.retryable, true);
    assert.equal(h.state.userData, null);
    h.timer.advance(120000);
    await flush();
    assert.equal(
      h.profiles.length,
      3,
      "No polling after the recovery budget is exhausted",
    );
    assert.equal(h.calls.length, 1);
    const retry = h.retry();
    await flush();
    assert.equal(h.calls.length, 2);
    await h.respond();
    h.profiles[3].next(snapshot("student"));
    await retry;
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);

await check(
  "A reattached cache-only profile cannot keep an old portal indefinitely",
  async () => {
    const { h } = await ready({ autoProfile: false });
    h.profiles[0].error(transportError());
    h.timer.advance(1000);
    await flush();
    h.profiles[1].next(snapshot("student", { fromCache: true }));
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS - 1000);
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.code, "auth/startup-timeout");
    assert.equal(h.profiles[1].stopped, true);
    assert.equal(h.calls.length, 1);
    h.controller.dispose();
  },
);

await check(
  "Token recovery has exactly two retries and never repeats profile or session work",
  async () => {
    const { h, account } = await ready();
    let tokenCalls = 0;
    account.getIdTokenResult = async () => {
      tokenCalls++;
      throw transportError("auth/network-request-failed");
    };
    const observation = h.controller.observe(account);
    await flush();
    h.timer.advance(1000);
    await flush();
    h.timer.advance(3000);
    await observation;
    assert.equal(tokenCalls, 3);
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.retryable, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.profiles.length, 1);
    h.controller.dispose();
  },
);

await check(
  "Initial session recovery keeps one profile subscription and stops after three requests",
  async () => {
    const h = fixture();
    const { claim } = await h.signIn();
    for (const [index, delay] of [
      [0, 1000],
      [1, 3000],
    ]) {
      h.calls[index].gate.reject(transportError("functions/unavailable"));
      await flush();
      assert.equal(h.state.phase, "opening-session");
      assert.equal(h.state.currentUser, null);
      h.timer.advance(delay);
      await flush();
      assert.equal(h.calls.length, index + 2);
    }
    h.calls[2].gate.reject(transportError("functions/unavailable"));
    await assert.rejects(claim, { code: "functions/unavailable" });
    h.timer.advance(120000);
    await flush();
    assert.equal(h.state.phase, "error");
    assert.equal(h.calls.length, 3);
    assert.equal(h.profiles.length, 1);
    assert.equal(h.settingsCalls, 0);
    h.controller.dispose();
  },
);

for (const failure of [
  transportError("functions/unauthenticated", "SESSION_REAUTH_REQUIRED"),
  transportError("functions/unavailable", "SESSION_EXPIRED"),
  transportError("auth/user-disabled"),
  transportError("functions/permission-denied"),
]) {
  await check(
    `Explicit authentication rejection is not retried: ${failure.details?.reason || failure.code}`,
    async () => {
      const h = fixture();
      const { claim } = await h.signIn();
      h.calls[0].gate.reject(failure);
      await assert.rejects(claim);
      assert.equal(h.state.phase, "error");
      assert.equal(h.state.error.retryable, false);
      h.timer.advance(120000);
      await flush();
      assert.equal(h.calls.length, 1);
      h.controller.dispose();
    },
  );
}

await check(
  "Session configuration outage remains retryable and retains an existing proof",
  async () => {
    const { h, account } = await ready();
    const proof = await h.session.ensureApplicationSessionProof(account);
    const failure = transportError(
      "functions/unavailable",
      "SESSION_AUTHORITY_CONFIG_INVALID",
    );
    assert.equal(startup.authStartupFailure(failure).retryable, true);
    const fresh = h.session.prepareApplicationSession(account, { fresh: true });
    await flush();
    h.calls[1].gate.reject(failure);
    await assert.rejects(fresh);
    const retained = await h.session.ensureApplicationSessionProof(account);
    assert.equal(retained.revision, proof.revision);
    assert.equal(h.calls.length, 2);
    h.controller.dispose();
  },
);

for (const reason of [
  "maintenance-config-read-failed",
  "maintenance-profile-read-failed",
]) {
  await check(
    `Maintenance read transport failure automatically recovers: ${reason}`,
    async () => {
      const h = fixture();
      const { claim } = await h.signIn();
      h.calls[0].gate.reject(transportError("functions/unavailable", reason));
      await flush();
      assert.equal(h.state.phase, "opening-session");
      assert.equal(h.state.currentUser, null);
      h.timer.advance(1000);
      await flush();
      assert.equal(h.calls.length, 2);
      await h.respond();
      await claim;
      assert.equal(h.state.phase, "ready");
      assert.equal(h.profiles.length, 1);
      h.controller.dispose();
    },
  );
}

for (const reason of ["maintenance-config-malformed", "student-maintenance"]) {
  await check(
    `Maintenance policy failure must not be retried automatically: ${reason}`,
    async () => {
      const h = fixture();
      const { claim } = await h.signIn();
      h.calls[0].gate.reject(transportError("functions/unavailable", reason));
      await assert.rejects(claim);
      assert.equal(h.state.phase, "error");
      assert.equal(h.state.currentUser, null);
      h.timer.advance(120000);
      await flush();
      assert.equal(h.calls.length, 1);
      h.controller.dispose();
    },
  );
}

for (const recovery of ["profile", "token", "session"]) {
  await check(
    `Logout cancels delayed ${recovery} retries and late responses`,
    async () => {
      const h = fixture();
      const { account, claim } = await h.signIn();
      let tokenCalls = 0;
      let observation;
      if (recovery !== "session") {
        await h.respond();
        await claim;
      }
      if (recovery === "profile") h.profiles[0].error(transportError());
      if (recovery === "session")
        h.calls[0].gate.reject(transportError("functions/unavailable"));
      if (recovery === "token") {
        account.getIdTokenResult = async () => {
          tokenCalls++;
          throw transportError("auth/network-request-failed");
        };
        observation = h.controller.observe(account);
      }
      await flush();
      h.controller.invalidate();
      h.auth.currentUser = null;
      if (recovery === "session")
        await assert.rejects(claim, { code: "auth/stale-attempt" });
      h.timer.advance(120000);
      await flush();
      await observation;
      h.profiles[0].next(snapshot("teacher"));
      assert.equal(h.state.phase, "signed-out");
      assert.equal(h.state.currentUser, null);
      assert.equal(h.calls.length, 1);
      assert.equal(h.profiles.length, 1);
      assert.equal(tokenCalls, recovery === "token" ? 1 : 0);
      h.controller.dispose();
    },
  );
}

await check(
  "Account switching cancels old profile recovery and ignores its late permission error",
  async () => {
    const { h } = await ready();
    h.profiles[0].error(transportError());
    const replacement = user("replacement-teacher", 5000);
    h.auth.currentUser = replacement;
    await h.controller.observe(replacement);
    await flush();
    assert.equal(h.state.currentUser, null);
    await h.respond();
    h.profiles[1].next(snapshot("teacher"));
    assert.equal(h.state.currentUser, replacement);
    h.timer.advance(120000);
    await flush();
    h.profiles[0].error(transportError("permission-denied"));
    assert.equal(h.state.phase, "ready");
    assert.equal(h.state.currentUser, replacement);
    assert.equal(h.state.userData.role, "teacher");
    assert.equal(h.calls.length, 2);
    assert.equal(h.profiles.length, 2);
    h.controller.dispose();
  },
);

console.log(
  `Auth startup/session integration: ${checks} regressions passed with actual controller and session adapter; no network or production writes.`,
);
