import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute shipped TypeScript with synthetic identities and controllable SDK
// boundaries. No Firebase SDK, credentials, network, or production data loads.
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
    console: { error() {}, warn() {} },
    ...globals,
  });
  return exports;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
  await new Promise(setImmediate);
};
const clock = () => {
  let now = 0,
    nextId = 0;
  const timers = new Map();
  return {
    set: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clear: (id) => timers.delete(id),
    advance: (duration) => {
      const target = now + duration;
      while (true) {
        const entry = [...timers]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        now = entry[1].due;
        timers.delete(entry[0]);
        entry[1].callback();
      }
      now = target;
    },
    get size() {
      return timers.size;
    },
  };
};
const user = (uid, epoch = 1234) => ({
  uid,
  epoch,
  getIdTokenResult: async function () {
    return { claims: { auth_time: this.epoch } };
  },
});
const permissions = load(compile("../src/lib/permissions.ts"), {});
const startup = load(compile("../src/lib/authStartup.ts"), {
  "./permissions": permissions,
  "./studentRegistrationStatus": load(
    compile("../src/lib/studentRegistrationStatus.ts"),
    {},
  ),
});
const sessionCode = compile("../src/lib/applicationSession.ts");
const authCode = compile("../src/contexts/AuthContext.tsx");
const valid = {
  status: "active",
  authTime: 1234,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
let cases = 0;
const check = async (name, run) => {
  try {
    await run();
    cases++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
function sessionHarness({ archive = false, reply = async () => valid } = {}) {
  const auth = { currentUser: user("synthetic-account") },
    calls = [];
  const api = load(sessionCode, {
    "./firebase": {
      auth,
      getHttpsCallable: async (name) => {
        assert.equal(name, "openApplicationSession");
        return async (payload) => {
          calls.push(payload);
          return { data: await reply(calls.length) };
        };
      },
    },
    "./semesterArchive": { isSemesterArchive: archive },
  });
  return { ...api, auth, calls };
}
function startupHarness({ onListen } = {}) {
  const auth = { currentUser: null },
    timer = clock(),
    changes = [],
    sessions = [],
    snapshots = [],
    settings = [];
  const controller = new startup.AuthStartupController({
    currentUser: () => auth.currentUser,
    prepareSession: (account, options) => {
      const gate = deferred();
      sessions.push({ account, options, gate });
      return gate.promise;
    },
    listenProfile: (account, next, error) => {
      const record = { account, next, error, stopped: false };
      snapshots.push(record);
      onListen?.(record);
      return () => {
        record.stopped = true;
      };
    },
    change: (state) => changes.push(state),
    sessionReady: (account, generation) =>
      settings.push({ account, generation }),
    mark() {},
    setTimer: timer.set,
    clearTimer: timer.clear,
  });
  return {
    auth,
    timer,
    changes,
    sessions,
    snapshots,
    settings,
    controller,
    get state() {
      return changes.at(-1);
    },
    observe: async (account) => {
      auth.currentUser = account;
      await controller.observe(account);
      await flush();
    },
    finishSession: async (index = sessions.length - 1) => {
      sessions[index].gate.resolve();
      await flush();
    },
    profile: (
      data = { role: "student" },
      metadata = {},
      index = snapshots.length - 1,
    ) => {
      assert.ok(snapshots[index], "Profile subscription must already exist");
      snapshots[index].next({
        exists: data !== null,
        data,
        fromCache: false,
        hasPendingWrites: false,
        ...metadata,
      });
    },
  };
}

await check(
  "Concurrent flights share pending work; success is not cached",
  async () => {
    const gate = deferred(),
      h = sessionHarness({ reply: () => gate.promise });
    const first = h.prepareApplicationSession(h.auth.currentUser),
      second = h.prepareApplicationSession(h.auth.currentUser);
    await flush();
    assert.equal(h.calls.length, 1);
    gate.resolve(valid);
    await Promise.all([first, second]);
    await h.prepareApplicationSession(h.auth.currentUser);
    assert.equal(h.calls.length, 2);
  },
);
for (const invalid of [
  { status: "expired" },
  { authTime: 1235 },
  { protocolVersion: 1 },
  { protocolVersion: 2.5 },
  { revision: "bad" },
  { authorityGeneration: "old" },
]) {
  await check(
    `Reject invalid server contract ${Object.keys(invalid)[0]}`,
    async () => {
      const h = sessionHarness({
        reply: async () => ({ ...valid, ...invalid }),
      });
      await assert.rejects(h.prepareApplicationSession(h.auth.currentUser), {
        code: "functions/unauthenticated",
      });
    },
  );
}
await check("Expired session is never automatically reopened", async () => {
  const h = sessionHarness({
    reply: async (count) => {
      if (count === 1)
        throw Object.assign(new Error("synthetic expiry"), {
          code: "functions/unauthenticated",
          details: { reason: "SESSION_REAUTH_REQUIRED" },
        });
      return valid;
    },
  });
  await assert.rejects(h.prepareApplicationSession(h.auth.currentUser));
  assert.equal(h.calls.length, 1);
  await h.prepareApplicationSession(h.auth.currentUser);
  assert.equal(h.calls.length, 2);
});
for (const boundary of ["account", "auth-time"])
  await check(
    `Pending server response rejects changed ${boundary}`,
    async () => {
      const gate = deferred(),
        h = sessionHarness({ reply: () => gate.promise });
      const pending = h.prepareApplicationSession(h.auth.currentUser);
      await flush();
      if (boundary === "account") h.auth.currentUser = user("synthetic-other");
      else h.auth.currentUser.epoch++;
      gate.resolve(valid);
      await assert.rejects(pending, { code: "functions/unauthenticated" });
    },
  );
await check("Read-only archive preserves no-call contract", async () => {
  const h = sessionHarness({ archive: true });
  await h.prepareApplicationSession(h.auth.currentUser);
  assert.equal(h.calls.length, 0);
});
await check(
  "Fresh retry drains old work and performs a new handshake",
  async () => {
    const old = deferred(),
      h = sessionHarness({
        reply: (count) => (count === 1 ? old.promise : valid),
      });
    let current = true;
    const previous = h.prepareApplicationSession(h.auth.currentUser, {
      isCurrent: () => current,
    });
    const rejected = assert.rejects(previous);
    await flush();
    current = false;
    const retry = h.prepareApplicationSession(h.auth.currentUser, {
      fresh: true,
      isCurrent: () => true,
    });
    await flush();
    assert.equal(
      h.calls.length,
      1,
      "Retry must not race an old server mutation",
    );
    old.resolve(valid);
    await Promise.all([rejected, retry]);
    assert.equal(h.calls.length, 2, "Old success cannot satisfy fresh retry");
  },
);
await check(
  "Initial SDK restoration is bounded and late callback cannot revive it",
  async () => {
    const h = startupHarness();
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS - 1);
    assert.equal(h.state.phase, "resolving");
    h.timer.advance(1);
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.code, "auth/startup-timeout");
    await h.observe(user("synthetic-late"));
    assert.equal(h.sessions.length, 0);
    h.controller.dispose();
  },
);
for (const role of ["teacher", "student", "staff", "unexpected"])
  await check(
    `Only server-confirmed ${role} profile publishes identity`,
    async () => {
      const h = startupHarness(),
        account = user(`synthetic-${role}`);
      await h.observe(account);
      assert.equal(h.state.currentUser, null);
      assert.equal(h.snapshots.length, 1);
      await h.finishSession();
      assert.equal(
        h.settings.length,
        0,
        "Settings wait for the verified session and approved profile",
      );
      assert.equal(h.state.phase, "loading-profile");
      h.profile({ role }, { fromCache: true });
      h.profile({ role }, { hasPendingWrites: true });
      assert.equal(h.state.currentUser, null);
      h.profile({
        role,
        uid: "untrusted-document-uid",
        teacherPortalEnabled: "true",
        staffPermissions: ["lesson_read", "lesson_read", "invented_permission"],
      });
      assert.equal(h.state.phase, "ready");
      assert.equal(h.settings.length, 1);
      assert.equal(h.state.currentUser, account);
      assert.equal(h.state.userData.uid, account.uid);
      assert.equal(
        h.state.userData.role,
        role === "unexpected" ? "student" : role,
      );
      assert.equal(h.state.userData.teacherPortalEnabled, false);
      assert.deepEqual(Array.from(h.state.userData.staffPermissions), [
        "lesson_read",
      ]);
      assert.equal(h.timer.size, 0);
      h.controller.dispose();
    },
  );
await check(
  "Server-missing profile publishes only onboarding candidate",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-new");
    await h.observe(account);
    await h.finishSession();
    h.profile(null);
    assert.equal(h.state.phase, "onboarding");
    assert.equal(h.state.currentUser, null);
    assert.equal(h.state.userData, null);
    assert.equal(h.state.onboardingUser, account);
    h.controller.dispose();
  },
);
for (const role of ["teacher", "student", "staff", null])
  await check(
    `Early ${role ?? "missing"} profile waits for the verified session`,
    async () => {
      const h = startupHarness(),
        account = user("synthetic-early-profile"),
        flow = h.controller.beginLoginFlow(true);
      await h.observe(account);
      let consumed = false;
      const claim = h.controller
        .claimLoginBootstrap(account, flow)
        .then((result) => {
          consumed = true;
          return result;
        });
      h.profile(role ? { role } : null);
      await flush();
      assert.equal(h.sessions.length, 1);
      assert.equal(h.snapshots.length, 1);
      assert.equal(h.state.phase, "opening-session");
      assert.equal(h.state.currentUser, null);
      assert.equal(h.state.onboardingUser, null);
      assert.equal(h.state.userData, null);
      assert.equal(h.settings.length, 0);
      assert.equal(consumed, false);
      assert.equal(
        h.timer.size,
        1,
        "Early profile must not cancel startup deadline",
      );
      await h.finishSession();
      const result = await claim;
      assert.equal(result.profile?.role ?? null, role);
      assert.equal(h.state.phase, role ? "ready" : "onboarding");
      assert.equal(h.settings.length, role ? 1 : 0);
      assert.equal(h.snapshots.length, 1, "Use the existing live listener");
      assert.equal(h.timer.size, 0);
      h.controller.dispose();
    },
  );
for (const status of [
  "PENDING",
  "APPROVED_PENDING_ACCOUNT",
  "",
  null,
  false,
  undefined,
])
  await check(
    `Unapproved registration ${String(status)} stays outside the portal`,
    async () => {
      const h = startupHarness(),
        account = user("synthetic-pending-student");
      await h.observe(account);
      await h.finishSession();
      h.profile({ role: "student", registrationApprovalStatus: status });
      assert.equal(h.state.phase, "registration-pending");
      assert.equal(h.state.currentUser, null);
      assert.equal(h.state.onboardingUser, account);
      assert.equal(h.settings.length, 0);
      assert.equal(h.timer.size, 0);
      await h.controller.waitForProfile(
        h.state.generation,
        account,
        (profile) => profile.registrationApprovalStatus === status,
      );
      for (const metadata of [
        { fromCache: true },
        { hasPendingWrites: true },
      ]) {
        h.profile(
          { role: "student", registrationApprovalStatus: "APPROVED" },
          metadata,
        );
        assert.equal(h.state.currentUser, null);
        assert.equal(h.settings.length, 0);
      }
      h.profile({ role: "student", registrationApprovalStatus: "APPROVED" });
      assert.equal(h.state.phase, "ready");
      assert.equal(h.state.currentUser, account);
      assert.equal(h.settings.length, 1);
      h.profile({ role: "student", registrationApprovalStatus: "PENDING" });
      assert.equal(h.state.phase, "registration-pending");
      assert.equal(h.state.currentUser, null);
      h.controller.dispose();
    },
  );
for (const replacement of [{ role: "student" }, null])
  await check(
    "Latest buffered role or removal wins before session readiness",
    async () => {
      const h = startupHarness();
      await h.observe(user("synthetic-buffer-revocation"));
      h.profile({ role: "teacher", teacherPortalEnabled: true });
      h.profile(replacement);
      await h.finishSession();
      assert.equal(h.state.userData?.role ?? null, replacement?.role ?? null);
      assert.equal(h.state.phase, replacement ? "ready" : "onboarding");
      assert.equal(
        h.changes.some((state) => state.userData?.role === "teacher"),
        false,
      );
      h.controller.dispose();
    },
  );
for (const metadata of [{ fromCache: true }, { hasPendingWrites: true }])
  await check(
    `Later ${Object.keys(metadata)[0]} invalidates buffered authority`,
    async () => {
      const h = startupHarness();
      await h.observe(user("synthetic-invalidated-buffer"));
      h.profile({ role: "teacher" });
      h.profile({ role: "student" }, metadata);
      await h.finishSession();
      assert.equal(h.state.phase, "loading-profile");
      assert.equal(h.state.currentUser, null);
      assert.equal(h.timer.size, 1);
      h.profile({ role: "student" });
      assert.equal(h.state.userData.role, "student");
      assert.equal(
        h.changes.some((state) => state.userData?.role === "teacher"),
        false,
      );
      h.controller.dispose();
    },
  );
await check(
  "Profile denial while session is pending cannot be revived by session success",
  async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-early-profile-denial"));
    h.profile({ role: "teacher" });
    h.snapshots[0].error({ code: "permission-denied" });
    await h.finishSession();
    h.profile({ role: "teacher" });
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.code, "permission-denied");
    assert.equal(h.state.currentUser, null);
    assert.equal(h.settings.length, 0);
    assert.equal(h.snapshots[0].stopped, true);
    assert.equal(h.timer.size, 0);
    assert.equal(
      h.changes.some((state) => state.phase === "ready"),
      false,
    );
    h.controller.dispose();
  },
);
await check(
  "Synchronous profile callback is buffered and its listener is cleaned up",
  async () => {
    const h = startupHarness({
      onListen: ({ next }) =>
        next({
          exists: true,
          data: { role: "teacher" },
          fromCache: false,
          hasPendingWrites: false,
        }),
    });
    await h.observe(user("synthetic-sync-profile"));
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots[0].stopped, false);
    await h.finishSession();
    assert.equal(h.state.userData.role, "teacher");
    h.controller.dispose();
    assert.equal(h.snapshots[0].stopped, true);
  },
);
await check(
  "Synchronous listener error cleans up without starting a session",
  async () => {
    const h = startupHarness({
      onListen: ({ error, next }) => {
        error({ code: "permission-denied" });
        next({
          exists: true,
          data: { role: "teacher" },
          fromCache: false,
          hasPendingWrites: false,
        });
      },
    });
    await h.observe(user("synthetic-sync-profile-error"));
    assert.equal(h.state.phase, "error");
    assert.equal(h.sessions.length, 0);
    assert.equal(h.snapshots[0].stopped, true);
    assert.equal(h.timer.size, 0);
    assert.equal(h.state.currentUser, null);
    h.controller.dispose();
  },
);
await check(
  "Synchronous listener throw fails without exposing a buffered profile",
  async () => {
    const h = startupHarness({
      onListen: ({ next }) => {
        next({
          exists: true,
          data: { role: "teacher" },
          fromCache: false,
          hasPendingWrites: false,
        });
        throw Object.assign(new Error("synthetic listener failure"), {
          code: "permission-denied",
        });
      },
    });
    await h.observe(user("synthetic-listener-throw"));
    assert.equal(h.state.phase, "error");
    assert.equal(h.sessions.length, 0);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.timer.size, 0);
    h.controller.dispose();
  },
);
await check(
  "Buffered profile waits for final token assertion and keeps the latest role",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-final-token-delay"),
      token = deferred();
    await h.observe(account);
    h.profile({ role: "teacher" });
    account.getIdTokenResult = () => token.promise;
    await h.finishSession();
    assert.equal(h.state.currentUser, null);
    assert.equal(h.settings.length, 0);
    h.profile({ role: "student" });
    token.resolve({ claims: { auth_time: account.epoch } });
    await flush();
    assert.equal(h.state.userData.role, "student");
    assert.equal(
      h.changes.some((state) => state.userData?.role === "teacher"),
      false,
    );
    h.controller.dispose();
  },
);
await check(
  "Changed auth epoch discards buffered authority before a fresh session",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-buffer-epoch");
    await h.observe(account);
    h.profile({ role: "teacher" });
    account.epoch++;
    await h.finishSession();
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots[0].stopped, true);
    assert.equal(h.sessions.length, 2);
    assert.equal(h.settings.length, 0);
    h.profile({ role: "teacher" }, {}, 0);
    h.profile({ role: "student" });
    await h.finishSession();
    assert.equal(h.state.userData.role, "student");
    assert.equal(
      h.changes.some((state) => state.userData?.role === "teacher"),
      false,
    );
    h.controller.dispose();
  },
);
await check(
  "Buffered profile cannot prevent timeout or satisfy a later retry",
  async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-buffer-timeout"));
    h.profile({ role: "teacher" });
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    assert.equal(h.state.phase, "error");
    assert.equal(h.snapshots[0].stopped, true);
    await h.finishSession(0);
    assert.equal(h.state.currentUser, null);
    const retry = h.controller.retry();
    await flush();
    assert.equal(h.sessions[1].options.fresh, true);
    await h.finishSession(1);
    assert.equal(h.state.phase, "loading-profile");
    h.profile({ role: "teacher" }, {}, 0);
    assert.equal(h.state.currentUser, null);
    h.profile({ role: "student" });
    await retry;
    assert.equal(h.state.userData.role, "student");
    h.controller.dispose();
  },
);
await check(
  "Live server role revocation and profile removal erase privileges",
  async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-revocation"));
    await h.finishSession();
    h.profile({ role: "teacher", teacherPortalEnabled: true });
    h.profile({
      role: "student",
      teacherPortalEnabled: false,
      staffPermissions: [],
    });
    assert.equal(h.state.userData.role, "student");
    assert.equal(h.state.userData.teacherPortalEnabled, false);
    h.profile(null);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.state.phase, "onboarding");
    h.controller.dispose();
  },
);
await check(
  "Offline/cache-only profile expires and explicit retry uses fresh authority",
  async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-offline"));
    await h.finishSession();
    h.profile({ role: "teacher" }, { fromCache: true });
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.retryable, true);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots[0].stopped, true);
    h.profile({ role: "teacher" }, {}, 0);
    assert.equal(h.state.currentUser, null);
    const retry = h.controller.retry();
    await flush();
    assert.equal(h.sessions.length, 2);
    assert.equal(h.sessions[1].options.fresh, true);
    await h.finishSession();
    h.profile({ role: "student" });
    await retry;
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);
await check(
  "Each attempt has a full deadline independent of older attempts",
  async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-first"));
    h.timer.advance(10_000);
    await h.observe(user("synthetic-second"));
    h.timer.advance(14_999);
    assert.equal(h.state.phase, "opening-session");
    h.timer.advance(1);
    assert.equal(h.state.phase, "error");
    await h.finishSession();
    assert.equal(h.snapshots.length, 2);
    assert.ok(h.snapshots.every((snapshot) => snapshot.stopped));
    h.controller.dispose();
  },
);
for (const boundary of ["logout", "replace", "dispose"])
  await check(`Late handshake cannot escape ${boundary}`, async () => {
    const h = startupHarness();
    await h.observe(user("synthetic-old"));
    h.profile({ role: "teacher" });
    if (boundary === "logout") h.controller.invalidate();
    if (boundary === "replace") await h.observe(user("synthetic-next"));
    if (boundary === "dispose") h.controller.dispose();
    await h.finishSession(0);
    assert.equal(h.snapshots[0].stopped, true);
    h.profile({ role: "teacher" }, {}, 0);
    assert.equal(h.state.currentUser, null);
    h.controller.dispose();
  });
await check(
  "Logout synchronously erases profile before SDK sign-out finishes",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-logout");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "teacher" });
    const generation = h.state.generation;
    h.controller.invalidate();
    assert.equal(h.auth.currentUser, account);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.state.userData, null);
    assert.equal(h.controller.isCurrent(generation, account), false);
    h.profile({ role: "teacher" });
    assert.equal(h.state.currentUser, null);
    h.controller.dispose();
  },
);
await check(
  "Routine token refresh keeps startup; auth_time change reopens authority",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-refresh");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "student" });
    const generation = h.state.generation;
    await h.observe(account);
    assert.equal(h.sessions.length, 1);
    assert.equal(h.state.generation, generation);
    account.epoch++;
    await h.observe(account);
    assert.equal(h.sessions.length, 2);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots[0].stopped, true);
    h.controller.dispose();
  },
);
await check(
  "Login consumes exactly one provider operation without duplicate RPC/profile",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-login"),
      flow = h.controller.beginLoginFlow();
    await h.observe(account);
    const claim = h.controller.claimLoginBootstrap(account, flow);
    await flush();
    assert.equal(h.sessions.length, 1);
    await h.finishSession();
    h.profile({ role: "student" });
    const result = await claim;
    assert.equal(result.profile.role, "student");
    assert.equal(h.snapshots.length, 1);
    await assert.rejects(h.controller.claimLoginBootstrap(account, flow), {
      code: "auth/stale-attempt",
    });
    await assert.rejects(h.controller.claimLoginBootstrap(account, flow - 1), {
      code: "auth/stale-attempt",
    });
    await h.controller.assertCurrent(result.generation, account);
    account.epoch++;
    await assert.rejects(
      h.controller.assertCurrent(result.generation, account),
      { code: "auth/stale-attempt" },
    );
    h.controller.dispose();
  },
);
await check(
  "Redirect enrolled before completion consumes one provider startup",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-redirect");
    await h.observe(account);
    const flow = h.controller.beginLoginFlow(true);
    await h.finishSession();
    h.profile({ role: "teacher" });
    const result = await h.controller.claimLoginBootstrap(account, flow);
    assert.equal(result.profile.role, "teacher");
    assert.equal(h.sessions.length, 1);
    assert.equal(h.snapshots.length, 1);
    h.controller.dispose();
  },
);
await check(
  "Unparticipated completed bootstrap cannot become a session cache",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-old-receipt");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "teacher" });
    const claim = h.controller.claimLoginBootstrap(
      account,
      h.controller.beginLoginFlow(true),
    );
    await flush();
    assert.equal(h.sessions.length, 2);
    assert.equal(h.state.currentUser, null);
    await h.finishSession();
    h.profile({ role: "student" });
    const result = await claim;
    assert.equal(result.profile.role, "student");
    h.controller.dispose();
  },
);
await check(
  "Explicit same-second reauthentication cannot reuse completed session",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-same-second");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "student" });
    const claim = h.controller.claimLoginBootstrap(
      account,
      h.controller.beginLoginFlow(),
    );
    await flush();
    assert.equal(h.sessions.length, 2);
    assert.equal(h.state.currentUser, null);
    await h.finishSession();
    h.profile({ role: "student" });
    await claim;
    h.controller.dispose();
  },
);
await check(
  "Stalled token read during a login claim is also bounded",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-token-stall"),
      stalled = deferred();
    account.getIdTokenResult = () => stalled.promise;
    h.auth.currentUser = account;
    const claim = h.controller.claimLoginBootstrap(
        account,
        h.controller.beginLoginFlow(),
      ),
      rejected = assert.rejects(claim, { code: "auth/startup-timeout" });
    await flush();
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await rejected;
    assert.equal(h.state.phase, "error");
    stalled.resolve({ claims: { auth_time: 1234 } });
    await flush();
    assert.equal(h.sessions.length, 0);
    h.controller.dispose();
  },
);
for (const failure of [
  {
    code: "functions/unauthenticated",
    details: { reason: "SESSION_REAUTH_REQUIRED" },
  },
  { code: "functions/permission-denied" },
])
  await check(
    `Auth denial ${failure.code} requires sign-in without automatic retry`,
    async () => {
      const h = startupHarness();
      await h.observe(user("synthetic-denied"));
      h.profile({ role: "teacher" });
      h.sessions[0].gate.reject(failure);
      await flush();
      assert.equal(h.state.phase, "error");
      assert.equal(h.state.error.retryable, false);
      assert.equal(h.state.currentUser, null);
      assert.equal(
        h.changes.some((state) => state.phase === "ready"),
        false,
      );
      assert.equal(h.sessions.length, 1);
      assert.equal(h.snapshots.length, 1);
      assert.equal(h.snapshots[0].stopped, true);
      h.controller.dispose();
    },
  );
await check(
  "Late null and other-account SDK callbacks cannot clobber current identity",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-active");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "student" });
    const generation = h.state.generation;
    await h.controller.observe(null);
    await h.controller.observe(user("synthetic-stale-callback"));
    assert.equal(h.state.currentUser, account);
    assert.equal(h.state.generation, generation);
    assert.equal(h.sessions.length, 1);
    h.controller.dispose();
  },
);
await check(
  "Initial null callback preserves active redirect flow",
  async () => {
    const h = startupHarness(),
      flow = h.controller.beginLoginFlow(true);
    await h.observe(null);
    assert.equal(h.controller.isLoginFlowCurrent(flow), true);
    const account = user("synthetic-after-null");
    await h.observe(account);
    const claim = h.controller.claimLoginBootstrap(account, flow);
    await h.finishSession();
    h.profile();
    await claim;
    h.controller.dispose();
  },
);
for (const authenticated of [false, true])
  await check(
    `Interactive failure exits spinner with raw user=${authenticated}`,
    async () => {
      const h = startupHarness();
      if (authenticated) h.auth.currentUser = user("synthetic-popup-failure");
      const flow = h.controller.beginLoginFlow();
      h.controller.failLoginFlow(flow, { code: "auth/popup-closed-by-user" });
      assert.equal(h.state.phase, authenticated ? "error" : "signed-out");
      assert.equal(h.state.currentUser, null);
      h.controller.dispose();
    },
  );
await check(
  "Onboarding completion waits for matching authoritative profile",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-onboarding-write");
    await h.observe(account);
    await h.finishSession();
    h.profile(null);
    let settled = false;
    const confirmed = h.controller
      .waitForProfile(
        h.state.generation,
        account,
        (profile) => profile.privacyAgreed === true,
      )
      .then(() => {
        settled = true;
      });
    h.profile(
      { role: "student", privacyAgreed: true },
      { hasPendingWrites: true },
    );
    await flush();
    assert.equal(settled, false);
    assert.equal(h.state.currentUser, null);
    h.profile({ role: "student", privacyAgreed: false });
    await flush();
    assert.equal(settled, false);
    h.profile({ role: "student", privacyAgreed: true });
    await confirmed;
    assert.equal(h.state.currentUser, account);
    h.controller.dispose();
  },
);
await check(
  "Profile waiter is canceled on account change and timeout",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-waiter");
    await h.observe(account);
    await h.finishSession();
    h.profile(null);
    const waiting = h.controller.waitForProfile(
        h.state.generation,
        account,
        () => true,
      ),
      rejected = assert.rejects(waiting);
    h.controller.invalidate();
    await rejected;
    await h.observe(null);
    await h.observe(account);
    const recovered = h.controller.retry();
    await flush();
    await h.finishSession();
    h.profile(null);
    await recovered;
    const timeout = h.controller.waitForProfile(
        h.state.generation,
        account,
        () => true,
      ),
      timedOut = assert.rejects(timeout);
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await timedOut;
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.currentUser, null);
    h.controller.dispose();
  },
);
await check(
  "Restoration with superseded in-flight owner also opens fresh authority",
  async () => {
    const old = deferred(),
      h = sessionHarness({
        reply: (count) => (count === 1 ? old.promise : valid),
      });
    let ownerActive = true;
    const pending = h.prepareApplicationSession(h.auth.currentUser, {
        isCurrent: () => ownerActive,
      }),
      rejected = assert.rejects(pending);
    await flush();
    ownerActive = false;
    const restored = h.prepareApplicationSession(h.auth.currentUser, {
      fresh: false,
      isCurrent: () => true,
    });
    await flush();
    assert.equal(h.calls.length, 1);
    old.resolve(valid);
    await Promise.all([rejected, restored]);
    assert.equal(h.calls.length, 2);
  },
);

// Exercise actual provider hooks too. This deterministic renderer checks state
// wiring and effect cleanup; it does not replace browser rendering/accessibility QA.
await check(
  "Old flow failure and token timeout cannot fail a later retry generation",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-old-failure");
    const flow = h.controller.beginLoginFlow(true);
    await h.observe(account);
    await h.finishSession();
    h.profile();
    const generation = h.state.generation,
      stalled = deferred();
    account.getIdTokenResult = () => stalled.promise;
    const oldAssert = h.controller.assertCurrent(generation, account);
    const rejected = assert.rejects(oldAssert, {
      code: "auth/startup-timeout",
    });
    h.controller.observerFailed({ code: "auth/network-request-failed" });
    assert.equal(h.controller.isLoginFlowCurrent(flow), false);
    account.getIdTokenResult = async () => ({
      claims: { auth_time: account.epoch },
    });
    const retry = h.controller.retry();
    await flush();
    await h.finishSession();
    h.profile();
    await retry;
    const currentGeneration = h.state.generation;
    h.controller.failLoginFlow(flow, { code: "auth/network-request-failed" });
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await rejected;
    assert.equal(h.state.phase, "ready");
    assert.equal(h.state.generation, currentGeneration);
    assert.equal(h.state.currentUser, account);
    assert.equal(h.controller.isCurrent(generation, account), false);
    stalled.resolve({ claims: { auth_time: 1234 } });
    await flush();
    h.controller.dispose();
  },
);
await check(
  "Same-UID forced reauthentication invalidates the old Login flow",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-old-flow");
    const flow = h.controller.beginLoginFlow(true);
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "teacher" });
    account.epoch++;
    await h.observe(account);
    assert.equal(h.controller.isLoginFlowCurrent(flow), false);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots[0].stopped, true);
    await h.finishSession();
    h.profile({ role: "student" });
    h.controller.failLoginFlow(flow, { code: "auth/network-request-failed" });
    assert.equal(h.state.phase, "ready");
    assert.equal(h.state.userData.role, "student");
    h.controller.dispose();
  },
);
await check(
  "Freshness assertion withdraws old ready identity and starts fresh authority",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-assert-refresh");
    const flow = h.controller.beginLoginFlow(true);
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "teacher" });
    const generation = h.state.generation;
    account.epoch++;
    await assert.rejects(h.controller.assertCurrent(generation, account), {
      code: "auth/stale-attempt",
    });
    assert.equal(h.state.currentUser, null);
    assert.equal(h.state.userData, null);
    assert.equal(h.controller.isLoginFlowCurrent(flow), false);
    assert.equal(h.snapshots[0].stopped, true);
    await flush();
    assert.equal(h.sessions.length, 2);
    assert.equal(h.sessions[1].options.fresh, true);
    await h.finishSession();
    h.profile({ role: "student" });
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);
await check(
  "Profile write confirmation requires the expected identity fields too",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-exact-profile");
    await h.observe(account);
    await h.finishSession();
    h.profile({ role: "student", privacyAgreed: true, name: "이전이름" });
    let confirmed = false;
    const waiting = h.controller
      .waitForProfile(
        h.state.generation,
        account,
        (profile) =>
          profile.role === "student" &&
          profile.privacyAgreed === true &&
          profile.name === "새이름",
      )
      .then(() => {
        confirmed = true;
      });
    h.profile({ role: "student", privacyAgreed: true, name: "이전이름" });
    await flush();
    assert.equal(confirmed, false);
    h.profile(
      { role: "student", privacyAgreed: true, name: "새이름" },
      { hasPendingWrites: true },
    );
    await flush();
    assert.equal(confirmed, false);
    h.profile({ role: "student", privacyAgreed: true, name: "새이름" });
    await waiting;
    assert.equal(confirmed, true);
    h.controller.dispose();
  },
);
await check(
  "Profile timeout is classified consistently in context even if waiter becomes stale",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-profile-timeout");
    await h.observe(account);
    await h.finishSession();
    h.profile(null);
    const pending = h.controller.waitForProfile(
      h.state.generation,
      account,
      () => true,
    );
    const rejected = assert.rejects(pending, (error) =>
      ["auth/stale-attempt", "auth/startup-timeout"].includes(error.code),
    );
    h.timer.advance(startup.AUTH_STARTUP_DEADLINE_MS);
    await rejected;
    assert.equal(h.state.phase, "error");
    assert.equal(h.state.error.code, "auth/startup-timeout");
    assert.equal(h.state.error.retryable, true);
    assert.equal(h.state.currentUser, null);
    h.controller.dispose();
  },
);
for (const ready of [false, true]) {
  await check(
    `Profile permission failure erases identity with prior ready=${ready}`,
    async () => {
      const h = startupHarness();
      await h.observe(user("synthetic-profile-denied"));
      await h.finishSession();
      if (ready) h.profile({ role: "teacher" });
      h.snapshots[0].error({ code: "permission-denied" });
      assert.equal(h.state.phase, "error");
      assert.equal(h.state.error.retryable, false);
      assert.equal(h.state.currentUser, null);
      assert.equal(h.state.userData, null);
      assert.equal(h.snapshots[0].stopped, true);
      h.controller.dispose();
    },
  );
}
await check(
  "Pending Login consumer rejects account switch before routing",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-claim-switch");
    const flow = h.controller.beginLoginFlow();
    await h.observe(account);
    const claim = h.controller.claimLoginBootstrap(account, flow),
      rejected = assert.rejects(claim, { code: "auth/stale-attempt" });
    await flush();
    await h.observe(user("synthetic-claim-replacement"));
    await rejected;
    await h.finishSession(0);
    assert.equal(h.state.currentUser, null);
    assert.equal(h.snapshots.length, 2);
    assert.equal(h.snapshots[0].stopped, true);
    h.controller.dispose();
  },
);
function providerHarness({ readSetting } = {}) {
  const slots = [],
    effects = [],
    sessions = [],
    reads = [],
    snapshots = [],
    timer = clock();
  let cursor = 0,
    dirty = true,
    value,
    authCallback,
    authFailure;
  const auth = { currentUser: null },
    signOutGate = deferred(),
    signOutCalls = [];
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    createElement: (_type, props) => {
      value = props.value;
      return props;
    },
    useContext: () => value,
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useMemo: (fn, deps) => {
      const index = cursor++,
        prior = slots[index];
      if (!prior || deps.some((dep, i) => dep !== prior.deps[i]))
        slots[index] = { deps, result: fn() };
      return slots[index].result;
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
        prior = slots[index];
      if (!prior || deps.some((dep, i) => dep !== prior.deps[i])) {
        slots[index] = { deps, cleanup: prior?.cleanup, effect: fn };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
  };
  const noop = () => {};
  const api = load(
    authCode,
    {
      react,
      "firebase/auth": {
        onIdTokenChanged: (_auth, callback, failure) => {
          authCallback = callback;
          authFailure = failure;
          return noop;
        },
        signOut: (target) => {
          signOutCalls.push(target.currentUser);
          return signOutGate.promise;
        },
      },
      "firebase/firestore": {
        doc: (_db, ...path) => path.join("/"),
        onSnapshot: (path, options, success, failure) => {
          assert.equal(options.includeMetadataChanges, true);
          reads.push(path);
          const record = { success, failure, stopped: false };
          snapshots.push(record);
          return () => {
            record.stopped = true;
          };
        },
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
      "../lib/applicationSession": {
        prepareApplicationSession: (account, options) => {
          const gate = deferred();
          sessions.push({ account, options, gate });
          return gate.promise;
        },
      },
      "../lib/authStartup": startup,
      "../constants/menus": {
        cloneDefaultMenus: () => ({}),
        sanitizeMenuConfig: (data) => data,
      },
      "../lib/permissions": permissions,
      "../lib/loginPerf": { markLoginPerf: noop, measureLoginPerf: noop },
      "../lib/siteSettings": {
        invalidateSiteSettingDocCache: noop,
        readSiteSettingDoc: async () => ({}),
        readFreshSiteSettingDoc: async (name) => {
          reads.push(name);
          return readSetting
            ? readSetting(auth.currentUser, name)
            : name === "config"
              ? { year: "2026", semester: "2" }
              : {};
        },
      },
      "../lib/appEvents": {
        subscribeMenuConfigUpdated: () => noop,
        subscribeSystemConfigUpdated: () => noop,
      },
    },
    { window: { setTimeout: timer.set, clearTimeout: timer.clear } },
  );
  const render = async () => {
    for (let count = 0; count < 24; count++) {
      await Promise.resolve();
      if (dirty) {
        dirty = false;
        cursor = 0;
        api.AuthProvider({ children: null });
        while (effects.length) effects.shift()();
      }
    }
  };
  return {
    render,
    auth,
    sessions,
    reads,
    snapshots,
    timer,
    signOutGate,
    signOutCalls,
    get value() {
      return value;
    },
    observe: async (account) => {
      auth.currentUser = account;
      authCallback(account);
      await render();
    },
    failObserver: async (failure) => {
      authFailure(failure);
      await render();
    },
    profile: (data, index = snapshots.length - 1, metadata = {}) =>
      snapshots[index].success({
        exists: () => data !== null,
        data: () => data,
        metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
      }),
    replayEffects: () => {
      const registered = slots.filter((slot) => slot?.effect);
      registered.forEach((slot) => slot.cleanup?.());
      registered.forEach((slot) => {
        slot.cleanup = slot.effect();
      });
    },
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}
for (const role of ["teacher", "student"])
  await check(
    `Actual provider atomic ${role} publication and settings order`,
    async () => {
      const h = providerHarness();
      await h.render();
      const account = user(`synthetic-provider-${role}`);
      await h.observe(account);
      assert.deepEqual(h.reads, [`users/${account.uid}`]);
      assert.equal(h.value.currentUser, null);
      h.sessions[0].gate.resolve();
      await h.render();
      assert.deepEqual(h.reads.slice().sort(), [`users/${account.uid}`]);
      h.profile({ role }, 0, { fromCache: true });
      await h.render();
      assert.equal(h.value.currentUser, null);
      h.profile({ role });
      await h.render();
      assert.deepEqual(
        h.reads.slice().sort(),
        ["config", "menu_config", `users/${account.uid}`].sort(),
      );
      assert.equal(h.value.authPhase, "ready");
      assert.equal(h.value.currentUser, account);
      assert.equal(h.value.userData.uid, account.uid);
      assert.equal(h.value.config.semester, "2");
      const signOut = h.value.logout();
      await h.render();
      assert.equal(h.value.currentUser, null);
      assert.equal(h.value.userData, null);
      assert.equal(h.value.config, null);
      h.signOutGate.resolve();
      await signOut;
      h.unmount();
    },
  );
await check(
  "Provider withholds settings until registration approval and clears them on revocation",
  async () => {
    const h = providerHarness();
    await h.render();
    await h.observe(user("synthetic-provider-pending"));
    h.sessions[0].gate.resolve();
    h.profile({ role: "student", registrationApprovalStatus: "PENDING" });
    await h.render();
    assert.equal(h.value.authPhase, "registration-pending");
    assert.equal(h.value.currentUser, null);
    assert.equal(h.reads.includes("config"), false);
    assert.equal(h.reads.includes("menu_config"), false);
    h.profile({ role: "student", registrationApprovalStatus: "APPROVED" });
    await h.render();
    assert.equal(h.value.authPhase, "ready");
    assert.equal(h.value.configReady, true);
    assert.equal(h.value.menuConfigReady, true);
    h.profile({ role: "student", registrationApprovalStatus: "PENDING" });
    await h.render();
    assert.equal(h.value.currentUser, null);
    assert.equal(h.value.config, null);
    assert.equal(h.value.menuConfig, null);
    h.unmount();
  },
);
await check(
  "Provider settings/stopped snapshots cannot cross account boundaries",
  async () => {
    const settings = [],
      h = providerHarness({
        readSetting: (account, name) => {
          const gate = deferred();
          settings.push({ account, name, gate });
          return gate.promise;
        },
      });
    await h.render();
    await h.observe(user("synthetic-provider-old"));
    h.sessions[0].gate.resolve();
    h.profile({ role: "teacher" }, 0);
    await h.render();
    await h.observe(user("synthetic-provider-new"));
    h.sessions[1].gate.resolve();
    await h.render();
    settings[0].gate.resolve({ year: "2025", semester: "1" });
    settings[1].gate.reject(new Error("synthetic stale permission failure"));
    h.profile({ role: "teacher" }, 0);
    await h.render();
    assert.equal(h.value.config, null);
    assert.equal(h.value.userData, null);
    assert.equal(h.value.configReady, false);
    assert.equal(h.value.menuConfigReady, false);
    h.profile({ role: "teacher" });
    await h.render();
    settings[2].gate.resolve({ year: "2026", semester: "2" });
    settings[3].gate.resolve({ student: [] });
    await h.render();
    assert.equal(h.value.config.year, "2026");
    assert.equal(h.value.menuConfigReady, true);
    assert.equal(h.reads.filter((path) => path === "config").length, 2);
    h.unmount();
  },
);
await check(
  "StrictMode same-account effect replay fences prior controller settings",
  async () => {
    const settings = [],
      h = providerHarness({
        readSetting: (account, name) => {
          const gate = deferred();
          settings.push({ account, name, gate });
          return gate.promise;
        },
      });
    await h.render();
    const account = user("synthetic-strict-mode");
    await h.observe(account);
    h.sessions[0].gate.resolve();
    h.profile({ role: "teacher" }, 0);
    await h.render();
    const generation = h.value.authGeneration;
    h.replayEffects();
    await h.render();
    await h.observe(account);
    h.sessions[1].gate.resolve();
    await h.render();
    assert.ok(h.value.authGeneration > generation);
    settings[0].gate.resolve({ year: "2025", semester: "1" });
    settings[1].gate.resolve({ legacy: [] });
    h.profile({ role: "teacher" }, 0);
    await h.render();
    assert.equal(h.value.config, null);
    assert.equal(h.value.userData, null);
    h.profile({ role: "teacher" });
    await h.render();
    settings[2].gate.resolve({ year: "2026", semester: "2" });
    settings[3].gate.resolve({ student: [] });
    await h.render();
    assert.equal(h.value.config.year, "2026");
    h.unmount();
  },
);
await check(
  "SDK observer errors are explicit failures rather than signed-out success",
  async () => {
    const h = providerHarness();
    await h.render();
    await h.failObserver({ code: "auth/network-request-failed" });
    assert.equal(h.value.authPhase, "error");
    assert.equal(h.value.currentUser, null);
    h.unmount();
  },
);
await check(
  "SDK callback before popup credential cannot start a server bootstrap",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-popup-callback");
    const flow = h.controller.beginLoginFlow();
    await h.observe(account);
    assert.equal(h.sessions.length, 0);
    assert.equal(h.snapshots.length, 0);
    assert.equal(h.state.currentUser, null);
    const claim = h.controller.claimLoginBootstrap(account, flow);
    await flush();
    assert.equal(h.sessions.length, 1);
    await h.finishSession();
    h.profile();
    await claim;
    assert.equal(h.state.phase, "ready");
    h.controller.dispose();
  },
);
await check(
  "Logout then null SDK callback keeps late popup identity locked out",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-late-popup");
    const oldFlow = h.controller.beginLoginFlow();
    h.controller.invalidate();
    await h.observe(null);
    await h.observe(account);
    assert.equal(h.sessions.length, 0);
    assert.equal(h.state.currentUser, null);
    await assert.rejects(h.controller.claimLoginBootstrap(account, oldFlow), {
      code: "auth/stale-attempt",
    });
    await h.observe(account);
    assert.equal(h.sessions.length, 0, "Wrong flow cannot unlock restoration");
    h.controller.dispose();
  },
);
await check(
  "Canceled acquisition stays locked until a new owned interactive claim",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-cancel-recover");
    const canceled = h.controller.beginLoginFlow();
    h.controller.failLoginFlow(canceled, { code: "auth/popup-closed-by-user" });
    await h.observe(null);
    await h.observe(account);
    assert.equal(h.sessions.length, 0);
    assert.equal(h.state.currentUser, null);
    await assert.rejects(h.controller.claimLoginBootstrap(account, canceled), {
      code: "auth/stale-attempt",
    });
    const next = h.controller.beginLoginFlow();
    await h.observe(account);
    assert.equal(h.sessions.length, 0);
    const claim = h.controller.claimLoginBootstrap(account, next);
    await flush();
    assert.equal(h.sessions.length, 1);
    await h.finishSession();
    h.profile();
    await claim;
    assert.equal(h.state.currentUser, account);
    h.controller.dispose();
  },
);
await check(
  "Abandoning an interactive flow rejects late acquisition and ignores stale abandonment",
  async () => {
    const h = startupHarness(),
      account = user("synthetic-abandoned");
    const old = h.controller.beginLoginFlow();
    h.controller.abandonLoginFlow(old);
    await h.observe(account);
    assert.equal(h.controller.isLoginFlowCurrent(old), false);
    assert.equal(h.sessions.length, 0);
    const next = h.controller.beginLoginFlow();
    h.controller.abandonLoginFlow(old);
    assert.equal(h.controller.isLoginFlowCurrent(next), true);
    const claim = h.controller.claimLoginBootstrap(account, next);
    await flush();
    await h.finishSession();
    h.profile();
    await claim;
    h.controller.dispose();
  },
);
await check(
  "Provider discards only the exact stale SDK object and preserves newer credentials",
  async () => {
    const h = providerHarness();
    await h.render();
    const old = user("synthetic-discard-old"),
      next = user("synthetic-discard-next");
    const oldFlow = h.value.beginLoginFlow();
    h.value.abandonLoginFlow(oldFlow);
    await h.render();
    h.auth.currentUser = next;
    await h.value.discardStaleLoginUser(old, oldFlow);
    assert.equal(h.signOutCalls.length, 0);
    const nextFlow = h.value.beginLoginFlow();
    await h.value.discardStaleLoginUser(next, nextFlow);
    assert.equal(h.signOutCalls.length, 0);
    h.value.abandonLoginFlow(nextFlow);
    await h.render();
    const discard = h.value.discardStaleLoginUser(next, nextFlow);
    await h.render();
    assert.equal(h.signOutCalls.length, 1);
    assert.equal(h.signOutCalls[0], next);
    assert.equal(h.value.currentUser, null);
    h.signOutGate.resolve();
    await discard;
    h.unmount();
  },
);
await check(
  "Optional timing logs accept only anonymous finite enums and counters",
  async () => {
    const messages = [],
      marks = [];
    const api = load(
      compile("../src/lib/loginPerf.ts"),
      {},
      {
        URLSearchParams,
        window: {
          location: { search: "?westoryPerfLogin=1" },
          localStorage: { getItem: () => null },
        },
        performance: { mark: (name) => marks.push(name), now: () => 12.7 },
        console: { info: (...args) => messages.push(args) },
      },
    );
    api.markLoginPerf("westory-auth-ready", {
      uid: "synthetic-private-uid",
      email: "synthetic-private@example.test",
      token: "synthetic-private-token",
      path: "/users/synthetic-private-uid",
      phase: "ready",
      attempt: 3,
      mode: "student",
      role: "teacher",
      hasUser: true,
      source: "synthetic-private-email",
      arbitrary: "synthetic-private-token",
    });
    assert.equal(marks.length, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0][1])), {
      at: 13,
      phase: "ready",
      attempt: 3,
      mode: "student",
      role: "teacher",
      hasUser: true,
    });
    assert.equal(JSON.stringify(messages).includes("synthetic-private"), false);
    for (const attempt of [-1, NaN, Infinity, "synthetic-private-uid"])
      api.markLoginPerf("westory-auth-error", {
        attempt,
        phase: "synthetic-private-uid",
      });
    messages
      .slice(1)
      .forEach((message) =>
        assert.deepEqual(JSON.parse(JSON.stringify(message[1])), { at: 13 }),
      );
  },
);
await check(
  "Discarding an old popup credential preserves the newer pending chooser",
  async () => {
    const h = providerHarness();
    await h.render();
    const old = user("synthetic-old-chooser-result"),
      next = user("synthetic-new-chooser-result");
    const oldFlow = h.value.beginLoginFlow(),
      nextFlow = h.value.beginLoginFlow();
    h.auth.currentUser = old;
    const discarded = h.value.discardStaleLoginUser(old, oldFlow);
    await h.render();
    assert.equal(h.signOutCalls.length, 1);
    assert.equal(h.signOutCalls[0], old);
    assert.equal(h.value.isLoginFlowCurrent(nextFlow), true);
    assert.equal(h.value.authPhase, "resolving");
    h.signOutGate.resolve();
    await discarded;
    await h.observe(null);
    assert.equal(
      h.value.isLoginFlowCurrent(nextFlow),
      true,
      "Sign-out notification cannot cancel an unrelated chooser",
    );
    await h.observe(next);
    assert.equal(h.sessions.length, 0);
    const claim = h.value.claimLoginBootstrap(next, nextFlow);
    await h.render();
    assert.equal(h.sessions.length, 1);
    h.sessions[0].gate.resolve();
    await h.render();
    h.profile({ role: "student" });
    await h.render();
    await claim;
    assert.equal(h.value.currentUser, next);
    h.unmount();
  },
);
await check(
  "Newer accepted flow owning the same SDK object survives stale discard",
  async () => {
    const h = providerHarness();
    await h.render();
    const account = user("synthetic-shared-sdk-object");
    const oldFlow = h.value.beginLoginFlow(),
      nextFlow = h.value.beginLoginFlow();
    h.auth.currentUser = account;
    const claim = h.value.claimLoginBootstrap(account, nextFlow);
    await h.render();
    const generation = h.value.authGeneration;
    await h.value.discardStaleLoginUser(account, oldFlow);
    await h.render();
    assert.equal(h.signOutCalls.length, 0);
    assert.equal(h.value.isLoginFlowCurrent(nextFlow), true);
    assert.equal(h.value.authGeneration, generation);
    h.sessions[0].gate.resolve();
    await h.render();
    h.profile({ role: "student" });
    await h.render();
    await claim;
    await h.value.discardStaleLoginUser(account, oldFlow);
    await h.render();
    assert.equal(h.signOutCalls.length, 0);
    assert.equal(h.value.currentUser, account);
    h.unmount();
  },
);
await check(
  "Stale credential without a chooser is discarded and remains locked after SDK null",
  async () => {
    const h = providerHarness();
    await h.render();
    const account = user("synthetic-stale-no-chooser");
    const oldFlow = h.value.beginLoginFlow();
    h.value.abandonLoginFlow(oldFlow);
    h.auth.currentUser = account;
    const discarded = h.value.discardStaleLoginUser(account, oldFlow);
    await h.render();
    assert.equal(h.signOutCalls.length, 1);
    assert.equal(h.value.authPhase, "signed-out");
    h.signOutGate.resolve();
    await discarded;
    await h.observe(null);
    await h.observe(account);
    assert.equal(h.sessions.length, 0);
    assert.equal(h.value.currentUser, null);
    assert.equal(h.value.userData, null);
    h.unmount();
  },
);
await check(
  "Timing instrumentation is silent unless explicitly enabled",
  async () => {
    let called = false;
    const api = load(
      compile("../src/lib/loginPerf.ts"),
      {},
      {
        URLSearchParams,
        window: {
          location: { search: "" },
          localStorage: { getItem: () => null },
        },
        performance: {
          mark: () => {
            called = true;
          },
          measure: () => {
            called = true;
          },
        },
        console: {
          info: () => {
            called = true;
          },
        },
      },
    );
    api.markLoginPerf("westory-auth-ready");
    api.measureLoginPerf("westory-auth-bootstrap", "start", "end");
    assert.equal(called, false);
  },
);
console.log(
  `Application session startup: ${cases} deterministic regression cases passed. No live credentials, Firebase SDK, or production requests used.`,
);
