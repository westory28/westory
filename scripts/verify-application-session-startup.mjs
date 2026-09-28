import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (file) =>
  ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
const sessionCode = compile("../src/lib/applicationSession.ts");
const authCode = compile("../src/contexts/AuthContext.tsx");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
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
const user = (uid) => ({
  uid,
  email: `${uid}@example.test`,
  getIdTokenResult: async () => ({ claims: { auth_time: 1234 } }),
});
const valid = {
  status: "active",
  authTime: 1234,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
function sessionHarness({ archive = false, reply = async () => valid } = {}) {
  const auth = { currentUser: user("teacher") };
  const calls = [];
  const api = load(sessionCode, {
    "./firebase": {
      auth,
      getHttpsCallable: async (name) => {
        assert.equal(name, "openApplicationSession");
        return async (payload) => {
          calls.push(payload);
          return { data: await reply() };
        };
      },
    },
    "./semesterArchive": { isSemesterArchive: archive },
  });
  return { ...api, auth, calls };
}
{
  const gate = deferred();
  const h = sessionHarness({ reply: () => gate.promise });
  const first = h.prepareApplicationSession(h.auth.currentUser);
  const second = h.prepareApplicationSession(h.auth.currentUser);
  await new Promise(setImmediate);
  assert.equal(
    h.calls.length,
    1,
    "Concurrent login/provider calls share one handshake",
  );
  gate.resolve(valid);
  await Promise.all([first, second]);
}
for (const invalid of [
  { status: "expired" },
  { authTime: 1235 },
  { protocolVersion: 1 },
  { protocolVersion: 2.5 },
  { revision: "bad" },
  { authorityGeneration: "old" },
]) {
  const h = sessionHarness({ reply: async () => ({ ...valid, ...invalid }) });
  await assert.rejects(h.prepareApplicationSession(h.auth.currentUser), {
    code: "functions/unauthenticated",
  });
}
{
  let attempt = 0;
  const h = sessionHarness({
    reply: async () => {
      if (!attempt++)
        throw Object.assign(new Error("expired"), {
          code: "functions/unauthenticated",
        });
      return valid;
    },
  });
  await assert.rejects(h.prepareApplicationSession(h.auth.currentUser));
  assert.equal(
    h.calls.length,
    1,
    "Expired sessions are not automatically retried or reopened",
  );
  await h.prepareApplicationSession(h.auth.currentUser);
  assert.equal(
    h.calls.length,
    2,
    "A later explicit attempt is not stuck behind a rejected flight",
  );
}
{
  const gate = deferred();
  const h = sessionHarness({ reply: () => gate.promise });
  const pending = h.prepareApplicationSession(h.auth.currentUser);
  await new Promise(setImmediate);
  h.auth.currentUser = user("other");
  gate.resolve(valid);
  await assert.rejects(pending, { code: "functions/unauthenticated" });
}
{
  const h = sessionHarness({ archive: true });
  await h.prepareApplicationSession(h.auth.currentUser);
  assert.equal(
    h.calls.length,
    0,
    "Read-only archives never invoke a writable callable",
  );
}
{
  const h = sessionHarness();
  let tokenReads = 0;
  h.auth.currentUser.getIdTokenResult = async () => ({
    claims: { auth_time: tokenReads++ ? 1235 : 1234 },
  });
  await assert.rejects(h.prepareApplicationSession(h.auth.currentUser), {
    code: "functions/unauthenticated",
  });
}

// Run the actual provider's hooks with controllable authentication and Firestore.
// No Firebase SDK, network, or production data is loaded by this test.
function providerHarness({ readSetting } = {}) {
  const slots = [],
    effects = [];
  let cursor = 0,
    dirty = true,
    value,
    authCallback;
  const gates = new Map(),
    reads = [],
    snapshots = [],
    timers = new Map();
  let timerId = 0;
  const auth = { currentUser: null };
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    createElement: (_type, props) => {
      value = props.value;
      return props;
    },
    useContext: () => value,
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useMemo: (fn, deps) => {
      const index = cursor++;
      const prior = slots[index];
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
      const index = cursor++;
      const prior = slots[index];
      if (!prior || deps.some((dep, i) => dep !== prior.deps[i])) {
        slots[index] = { deps, cleanup: prior?.cleanup };
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
        onAuthStateChanged: (_auth, callback) => {
          authCallback = callback;
          return noop;
        },
        signOut: async () => {},
      },
      "firebase/firestore": {
        doc: (_db, ...path) => path.join("/"),
        onSnapshot: (path, success, failure) => {
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
      "../lib/semesterArchive": { isSemesterArchive: false },
      "../lib/applicationSession": {
        prepareApplicationSession: (user) => {
          const gate = deferred();
          gates.set(user.uid, gate);
          return gate.promise;
        },
      },
      "../constants/menus": {
        cloneDefaultMenus: () => ({}),
        sanitizeMenuConfig: (data) => data,
      },
      "../lib/permissions": { normalizeStaffPermissions: (data) => data || [] },
      "../lib/loginPerf": { markLoginPerf: noop, measureLoginPerf: noop },
      "../lib/siteSettings": {
        invalidateSiteSettingDocCache: noop,
        readSiteSettingDoc: async () => ({}),
        readFreshSiteSettingDoc: async (name) => {
          reads.push(name);
          if (readSetting) return readSetting(auth.currentUser, name);
          return name === "config" ? { year: "2026", semester: "2" } : {};
        },
      },
      "../lib/appEvents": {
        subscribeMenuConfigUpdated: () => noop,
        subscribeSystemConfigUpdated: () => noop,
      },
    },
    {
      window: {
        setTimeout: (fn) => {
          const id = ++timerId;
          timers.set(id, fn);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
    },
  );
  const flush = async () => {
    for (let count = 0; count < 12; count++) {
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
    flush,
    gates,
    reads,
    snapshots,
    get value() {
      return value;
    },
    signIn: (user) => {
      auth.currentUser = user;
      return authCallback(user);
    },
    unmount: () => {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}
for (const role of ["teacher", "student"]) {
  const h = providerHarness();
  await h.flush();
  const account = user(role);
  const login = h.signIn(account);
  await h.flush();
  assert.equal(
    h.reads.length,
    0,
    "Protected reads wait for the server session",
  );
  assert.equal(
    h.value.currentUser,
    null,
    "Child routes cannot use a provisional user",
  );
  h.gates.get(role).resolve();
  await login;
  await h.flush();
  assert.deepEqual(
    h.reads.sort(),
    ["config", "menu_config", `users/${role}`].sort(),
  );
  h.snapshots[0].success({ exists: () => true, data: () => ({ role }) });
  await h.flush();
  assert.equal(h.value.loading, false);
  assert.equal(h.value.currentUser, account);
  assert.equal(h.value.config.semester, "2");
  assert.equal(h.value.userData.role, role);
  h.unmount();
}
{
  const h = providerHarness();
  await h.flush();
  const login = h.signIn(user("failed"));
  await h.flush();
  h.gates.get("failed").reject(new Error("session expired"));
  await login;
  await h.flush();
  assert.equal(
    h.value.loading,
    false,
    "Session errors cannot strand the page loading",
  );
  assert.equal(h.value.currentUser, null);
  assert.equal(h.reads.length, 0);
  h.unmount();
}
for (const end of ["logout", "replace", "unmount"]) {
  const h = providerHarness();
  await h.flush();
  const first = h.signIn(user("old"));
  await h.flush();
  if (end === "logout") await h.signIn(null);
  if (end === "replace") {
    void h.signIn(user("new"));
    await h.flush();
  }
  if (end === "unmount") h.unmount();
  h.gates.get("old").resolve();
  await first;
  await h.flush();
  assert.equal(
    h.reads.length,
    0,
    `Late session completion after ${end} cannot subscribe stale users`,
  );
  assert.equal(h.value.currentUser, null);
  h.unmount();
}
{
  const pendingSettings = new Map();
  const h = providerHarness({
    readSetting: (account, name) => {
      const gate = deferred();
      pendingSettings.set(`${account.uid}:${name}`, gate);
      return gate.promise;
    },
  });
  await h.flush();
  const first = h.signIn(user("old"));
  h.gates.get("old").resolve();
  await first;
  await h.flush();
  const second = h.signIn(user("new"));
  h.gates.get("new").resolve();
  await second;
  await h.flush();
  pendingSettings.get("old:config").resolve({ year: "2025", semester: "1" });
  pendingSettings
    .get("old:menu_config")
    .reject(new Error("old account denied"));
  await h.flush();
  assert.equal(
    h.value.config,
    null,
    "Old account settings cannot cross an auth boundary",
  );
  assert.equal(h.value.configReady, false);
  assert.equal(h.value.menuConfigReady, false);
  h.snapshots[0].success({
    exists: () => true,
    data: () => ({ role: "teacher" }),
  });
  await h.flush();
  assert.equal(
    h.value.userData,
    null,
    "Stopped user snapshots cannot overwrite the new account",
  );
  pendingSettings.get("new:config").resolve({ year: "2026", semester: "2" });
  pendingSettings.get("new:menu_config").resolve({ student: [] });
  await h.flush();
  assert.equal(h.value.config.year, "2026");
  assert.equal(h.value.menuConfigReady, true);
  assert.equal(
    h.reads.filter((path) => path === "config").length,
    2,
    "Old flight cleanup cannot start duplicate new-account reads",
  );
  h.unmount();
}
console.log(
  "Application session startup checks passed: shared handshake, protocol/expiry rejection, account changes, archive bypass, protected-read ordering, teacher/student startup, failure recovery and cleanup.",
);
