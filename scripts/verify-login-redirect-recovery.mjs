import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute shipped Login helpers and its redirect-return effect with synthetic
// storage, credentials, timers and SDK boundaries. No browser or network opens.
const source = fs.readFileSync(
  new URL("../src/pages/Login.tsx", import.meta.url),
  "utf8",
);
const storageSource = fs.readFileSync(
  new URL("../src/lib/safeStorage.ts", import.meta.url),
  "utf8",
);
const compile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const parsed = ts.createSourceFile(
  "Login.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const wanted = new Set([
  "TEACHER_EMAIL",
  "ALLOWED_SCHOOL_EMAIL_DOMAIN",
  "PENDING_LOGIN_MODE_KEY",
  "REDIRECT_ATTEMPT_KEY",
  "REDIRECT_ATTEMPT_MAX_AGE_MS",
  "readPendingLoginMode",
  "isIOSDevice",
  "isAndroidDevice",
  "isSafariBrowser",
  "isLikelyInAppBrowser",
  "isLocalAuthHost",
  "readRedirectAttemptMode",
  "markRedirectAttempt",
  "clearRedirectAttempt",
  "shouldResolveRedirectOnBoot",
  "shouldReuseCurrentUserForRedirect",
  "getLoginFailureMessage",
  "getStudentBootstrapFailureMessage",
  "hasCrossOriginAuthDomain",
  "isIgnorableRedirectError",
]);
const declarations = new Map();
let redirectEffect;
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(parsed) === "useEffect" &&
    node.arguments[0]?.getText(parsed).includes("const resolveRedirect =")
  ) {
    assert.equal(
      redirectEffect,
      undefined,
      "Redirect-return effect must be unique",
    );
    redirectEffect = node.arguments[0].getText(parsed);
  }
  ts.forEachChild(node, visit);
};
visit(parsed);
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const name = declaration.name.getText(parsed);
    if (wanted.has(name)) declarations.set(name, declaration.getText(parsed));
  }
}
assert.ok(redirectEffect, "Actual redirect-return effect must exist");
for (const name of wanted)
  assert.ok(declarations.has(name), "Missing actual helper: " + name);
const code = compile(
  [...declarations.values()]
    .map((declaration) => "const " + declaration + ";")
    .join("\n") +
    "\nexport {" +
    [...wanted].join(",") +
    "};\nexport const runEffect = " +
    redirectEffect +
    ";",
);
const storageCode = compile(storageSource);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
const clock = () => {
  let now = 0,
    nextId = 0;
  const entries = new Map();
  return {
    set: (callback, delay) => {
      const id = ++nextId;
      entries.set(id, { callback, due: now + delay });
      return id;
    },
    clear: (id) => entries.delete(id),
    advance: (duration) => {
      const target = now + duration;
      while (true) {
        const next = [...entries]
          .filter(([, entry]) => entry.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) break;
        now = next[1].due;
        entries.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    get size() {
      return entries.size;
    },
  };
};
const IPAD_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
function harness({
  ua = IPAD_DESKTOP,
  touch = 5,
  marker = null,
  pending = null,
  user = null,
  redirect,
  persistence = Promise.resolve(),
  finishError = null,
  blockedLocal = false,
  blockedSession = false,
  storage = { session: new Map(), local: new Map() },
} = {}) {
  const timer = clock(),
    storeApi = {};
  const layer = (map, blocked) => ({
    getItem: (key) => {
      if (blocked) throw new Error("Synthetic storage denial");
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (blocked) throw new Error("Synthetic storage denial");
      map.set(key, value);
    },
    removeItem: (key) => {
      if (blocked) throw new Error("Synthetic storage denial");
      map.delete(key);
    },
  });
  const window = {
    location: { hostname: "www.westory.kr", protocol: "https:" },
    setTimeout: timer.set,
    clearTimeout: timer.clear,
    sessionStorage: layer(storage.session, blockedSession),
    localStorage: layer(storage.local, blockedLocal),
  };
  vm.runInNewContext(storageCode, {
    exports: storeApi,
    window,
    console: { warn() {} },
    require: (name) => {
      assert.equal(name, "./semesterArchive");
      return { isSemesterArchive: false };
    },
  });
  const state = {
    busy: false,
    recovery: true,
    notice: "",
    flow: 1,
    redirectCalls: 0,
    forwarded: [],
    failures: [],
  };
  const refs = {
    mountedRef: { current: true },
    actionVersionRef: { current: 0 },
    resumeFlowRef: { current: 1 },
    activeActionFlowRef: { current: null },
    redirectResultRef: { current: null },
  };
  const exports = {};
  const auth = { currentUser: user };
  vm.runInNewContext(code, {
    exports,
    window,
    navigator: { userAgent: ua, maxTouchPoints: touch },
    Date,
    console: { warn() {}, error() {}, info() {} },
    ...storeApi,
    ...refs,
    redirectRecoveryPending: true,
    authPersistenceReady: persistence,
    auth,
    configuredAuthDomain: "www.westory.kr",
    getRedirectResult: () => {
      state.redirectCalls++;
      return redirect ? redirect() : Promise.resolve(null);
    },
    getPendingLoginMode: () => exports.readPendingLoginMode(),
    clearPendingLoginMode: () =>
      storeApi.removeStorage(exports.PENDING_LOGIN_MODE_KEY),
    beginLoginFlow: () => ++state.flow,
    isLoginFlowCurrent: (flow) => flow === state.flow,
    setAuthBusy: (value) => {
      state.busy = value;
    },
    setRedirectRecoveryPending: (value) => {
      state.recovery = value;
    },
    setLoginNotice: (value) => {
      state.notice = value;
    },
    markLoginPerf() {},
    measureLoginPerf() {},
    finishLoginForRole: async (account, mode, flow) => {
      state.forwarded.push({ account, mode, flow });
      if (finishError) throw finishError;
    },
    failLoginFlow: (flow, error) => {
      state.failures.push({ flow, error });
      state.flow++;
    },
  });
  if (marker) exports.markRedirectAttempt(marker);
  if (pending) storeApi.writeStorage(exports.PENDING_LOGIN_MODE_KEY, pending);
  return { ...exports, state, refs, storeApi, storage, timer, auth };
}
let cases = 0;
const check = async (name, run) => {
  try {
    await run();
    cases++;
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
};
const account = {
  uid: "synthetic-mobile",
  email: "synthetic-student@school.example",
};
for (const ua of [IPAD_DESKTOP, IPHONE, ANDROID]) {
  for (const mode of ["student", "teacher"]) {
    await check(
      "Null redirect result preserves requested " + mode + " mode on " + ua,
      async () => {
        const h = harness({ ua, marker: mode, pending: mode, user: account });
        assert.equal(h.shouldResolveRedirectOnBoot(), true);
        h.runEffect();
        await flush();
        assert.equal(h.state.forwarded.length, 1);
        assert.equal(h.state.forwarded[0].mode, mode);
        assert.equal(h.state.forwarded[0].account, account);
        assert.equal(h.state.busy, false);
        assert.equal(h.state.recovery, false);
        assert.equal(h.storeApi.readLocalOnly(h.REDIRECT_ATTEMPT_KEY), null);
        assert.equal(h.timer.size, 0);
      },
    );
  }
}
await check(
  "Fresh credential result is forwarded to the existing bootstrap",
  async () => {
    const h = harness({
      marker: "student",
      redirect: async () => ({ user: account }),
    });
    h.runEffect();
    await flush();
    assert.equal(h.state.forwarded[0].account, account);
  },
);
await check(
  "No credential or restored user clears obsolete intent without bootstrap",
  async () => {
    const h = harness({ marker: "student", pending: "student" });
    h.runEffect();
    await flush();
    assert.equal(h.state.forwarded.length, 0);
    assert.match(h.state.notice, /취소/);
    assert.equal(h.state.recovery, false);
    assert.equal(h.readPendingLoginMode(), null);
  },
);
await check(
  "Markerless iPad boot checks redirect and settles null without bootstrap",
  async () => {
    const h = harness();
    assert.equal(h.shouldResolveRedirectOnBoot(), true);
    h.runEffect();
    await flush();
    assert.equal(h.state.forwarded.length, 0);
    assert.equal(h.state.recovery, false);
    assert.equal(h.timer.size, 0);
  },
);
await check("Redirect lookup waits for persistence", async () => {
  const gate = deferred(),
    h = harness({ persistence: gate.promise });
  h.runEffect();
  await flush();
  assert.equal(h.state.redirectCalls, 0);
  assert.equal(h.state.busy, true);
  gate.resolve();
  await flush();
  assert.equal(h.state.redirectCalls, 1);
  assert.equal(h.state.recovery, false);
});
await check(
  "StrictMode effect replay consumes the SDK result once",
  async () => {
    const gate = deferred(),
      h = harness({ marker: "student", redirect: () => gate.promise });
    const stop = h.runEffect();
    await flush();
    stop();
    h.runEffect();
    gate.resolve({ user: account });
    await flush();
    assert.equal(h.state.redirectCalls, 1);
    assert.equal(h.state.forwarded.length, 1);
    assert.equal(h.timer.size, 0);
  },
);
for (const boundary of ["unmount", "new-action"]) {
  await check(
    "Late result cannot enter bootstrap after " + boundary,
    async () => {
      const gate = deferred(),
        h = harness({ marker: "student", redirect: () => gate.promise });
      const stop = h.runEffect();
      await flush();
      if (boundary === "unmount") {
        stop();
        h.refs.mountedRef.current = false;
      } else h.refs.actionVersionRef.current++;
      gate.resolve({ user: account });
      await flush();
      assert.equal(h.state.forwarded.length, 0);
      assert.equal(h.state.failures.length, 0);
    },
  );
}
for (const stalled of ["redirect", "persistence"]) {
  await check(
    "15-second " + stalled + " deadline ignores late completion",
    async () => {
      const gate = deferred();
      const h = harness({
        marker: "student",
        pending: "student",
        ...(stalled === "redirect"
          ? { redirect: () => gate.promise }
          : { persistence: gate.promise }),
      });
      h.runEffect();
      await flush();
      h.timer.advance(14999);
      await flush();
      assert.equal(h.state.recovery, true);
      h.timer.advance(1);
      await flush();
      assert.equal(h.state.recovery, false);
      assert.equal(h.state.busy, false);
      assert.equal(h.state.forwarded.length, 0);
      assert.equal(h.readPendingLoginMode(), null);
      gate.resolve({ user: account });
      await flush();
      assert.equal(h.state.forwarded.length, 0);
      assert.equal(h.timer.size, 0);
    },
  );
}
await check(
  "Server bootstrap denial fails the flow without acquiring again",
  async () => {
    const h = harness({
      marker: "student",
      user: account,
      finishError: Object.assign(new Error("Synthetic denial"), {
        code: "functions/unauthenticated",
      }),
    });
    h.runEffect();
    await flush();
    assert.equal(h.state.failures.length, 1);
    assert.equal(h.state.redirectCalls, 1);
    assert.equal(h.state.forwarded.length, 1);
  },
);
await check(
  "Missing-state recovery still goes through the existing bootstrap",
  async () => {
    const h = harness({
      marker: "student",
      user: account,
      redirect: async () => {
        throw Object.assign(new Error("Synthetic missing state"), {
          code: "auth/missing-initial-state",
        });
      },
    });
    h.runEffect();
    await flush();
    assert.equal(h.state.forwarded.length, 1);
    assert.equal(h.state.failures.length, 0);
  },
);
await check(
  "Network redirect error never treats a restored user as success",
  async () => {
    const h = harness({
      marker: "student",
      user: account,
      redirect: async () => {
        throw Object.assign(new Error("Synthetic network error"), {
          code: "auth/network-request-failed",
        });
      },
    });
    h.runEffect();
    await flush();
    assert.equal(h.state.forwarded.length, 0);
    assert.equal(h.state.recovery, false);
  },
);
await check("Expired local redirect marker is removed", () => {
  const h = harness({ ua: ANDROID });
  h.storeApi.writeLocalOnly(
    h.REDIRECT_ATTEMPT_KEY,
    JSON.stringify({
      mode: "student",
      startedAt: Date.now() - h.REDIRECT_ATTEMPT_MAX_AGE_MS - 1,
    }),
  );
  assert.equal(h.readRedirectAttemptMode(), null);
  assert.equal(h.storeApi.readLocalOnly(h.REDIRECT_ATTEMPT_KEY), null);
});
await check(
  "Blocked local storage remains an explicit Android recovery limitation",
  () => {
    const first = harness({
      ua: ANDROID,
      blockedLocal: true,
      marker: "student",
      pending: "student",
    });
    assert.equal(first.shouldResolveRedirectOnBoot(), true);
    const returned = harness({
      ua: ANDROID,
      blockedLocal: true,
      storage: first.storage,
    });
    assert.equal(returned.readPendingLoginMode(), "student");
    assert.equal(returned.readRedirectAttemptMode(), null);
    // Firebase's own restoration is separate. Do not claim that a page-local
    // memory fallback survives navigation or that this case guarantees login.
    assert.equal(returned.shouldResolveRedirectOnBoot(), false);
  },
);
await check(
  "Blocked session storage can recover a local redirect marker",
  () => {
    const first = harness({
      ua: ANDROID,
      blockedSession: true,
      marker: "student",
      pending: "student",
    });
    const returned = harness({
      ua: ANDROID,
      blockedSession: true,
      storage: first.storage,
    });
    assert.equal(returned.readRedirectAttemptMode(), "student");
    assert.equal(returned.readPendingLoginMode(), "student");
    assert.equal(returned.shouldResolveRedirectOnBoot(), true);
  },
);
console.log(
  "Login redirect recovery: " +
    cases +
    " source-driven regressions passed. " +
    "Synthetic storage, timers and OAuth results; no live OAuth, Firebase SDK, browser, credentials or network. " +
    "Role/session authorization is covered by verify-application-session-startup.mjs and verify-auth-route-gates.mjs.",
);
