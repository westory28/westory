import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const source = fs.readFileSync("src/lib/deviceSession.ts", "utf8");
const headerSource = ts.createSourceFile(
  "Header.tsx",
  fs.readFileSync("src/components/common/Header.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let sessionEffect;
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(headerSource) === "useEffect" &&
    node.arguments[0]
      ?.getText(headerSource)
      .includes("initializeDeviceSession(")
  )
    sessionEffect = node.arguments[0].getText(headerSource);
  ts.forEachChild(node, visit);
};
visit(headerSource);
assert.ok(sessionEffect, "Exercise the actual Header session effect");

const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
const fixture = () => {
  const values = new Map();
  const memory = new Map();
  const state = {
    now: 1800000000000,
    writes: 0,
    reads: 0,
    blocked: false,
    logouts: 0,
    tokenCalls: 0,
    epoch: 1799990000,
    remaining: 0,
    tokenHold: null,
    tokenError: null,
  };
  const storage = {
    readLocalOnly: (key) => values.get(key) ?? memory.get(key) ?? null,
    writeLocalOnly: (key, value) => {
      state.writes++;
      memory.set(key, value);
      if (!state.blocked) values.set(key, value);
    },
    removeStorage: (key) => {
      values.delete(key);
      memory.delete(key);
    },
  };
  const makeEvents = () => {
    const listeners = new Map();
    return {
      listeners,
      hidden: false,
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
      emit(name, event = {}) {
        for (const callback of listeners.get(name) || []) callback(event);
      },
    };
  };
  const document = makeEvents();
  const window = {
    ...makeEvents(),
    localStorage: {
      getItem(key) {
        state.reads++;
        if (state.blocked) throw new Error("Storage blocked");
        return values.get(key) ?? null;
      },
    },
    timers: new Map(),
    setInterval(callback, delay) {
      const id = this.timers.size + 1;
      this.timers.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      this.timers.delete(id);
    },
  };
  class Clock extends Date {
    static now() {
      return state.now;
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(compile(source), {
    module,
    exports: module.exports,
    require(name) {
      if (name === "./safeStorage") return storage;
      if (name === "./semesterArchive") return { isSemesterArchive: false };
      throw new Error(name);
    },
    window,
    Date: Clock,
  });
  const api = module.exports;
  const currentUser = {
    uid: "teacher-a",
    async getIdTokenResult() {
      state.tokenCalls++;
      if (state.tokenHold) await state.tokenHold;
      if (state.tokenError) throw state.tokenError;
      return { claims: { auth_time: state.epoch } };
    },
  };
  const auth = { currentUser };
  const extendSessionRef = { current: () => {} };
  const context = vm.createContext({
    ...api,
    currentUser,
    auth,
    document,
    window,
    Date: Clock,
    isSemesterArchive: false,
    extendSessionRef,
    logoutRef: {
      current: async () => {
        state.logouts++;
      },
    },
    setRemainingSeconds: (seconds) => (state.remaining = seconds),
    getSessionActivityTarget: (target) => target?.activity === true,
    getSessionChangeActivityTarget: (target) => target?.activity === true,
    isSessionActivityIgnored: (target) => target?.ignored === true,
    SESSION_ACTIVITY_EVENT: "westory:session-activity",
  });
  vm.runInContext(compile(`globalThis.start = ${sessionEffect};`), context);
  return {
    state,
    values,
    api,
    currentUser,
    auth,
    window,
    document,
    extendSessionRef,
    start: context.start,
  };
};

{
  const f = fixture();
  const { api, state } = f;
  f.values.set("sessionExpiry", String(state.now - 1000));
  const initial = api.initializeDeviceSession("teacher-a", state.epoch);
  assert.equal(initial.expiresAt, state.now + 30 * 86400000);
  assert.equal(f.values.has("sessionExpiry"), false);
  state.now += 5 * 86400000;
  assert.equal(
    api.initializeDeviceSession("teacher-a", state.epoch).expiresAt,
    initial.expiresAt,
    "Reloading and restoring does not reset the idle deadline",
  );
  const fresh = api.extendDeviceSession("teacher-a", state.epoch);
  assert.equal(fresh.expiresAt, state.now + 30 * 86400000);
  const writes = state.writes;
  for (let index = 0; index < 100; index++)
    api.extendDeviceSession("teacher-a", state.epoch);
  assert.equal(state.writes, writes, "Activity writes are throttled");
  state.now = fresh.expiresAt;
  assert.equal(
    api.initializeDeviceSession("teacher-a", state.epoch).expiresAt,
    state.now,
  );
  assert.equal(
    api.extendDeviceSession("teacher-a", state.epoch).expiresAt,
    state.now,
  );
  assert.equal(
    api.resetDeviceSession("teacher-a", state.epoch).expiresAt,
    state.now + 30 * 86400000,
  );
  assert.equal(api.readDeviceSession("student-b", state.epoch), null);
  const newer = api.initializeDeviceSession("teacher-a", state.epoch + 1);
  assert.equal(api.initializeDeviceSession("teacher-a", state.epoch), null);
  assert.equal(api.extendDeviceSession("teacher-a", state.epoch), null);
  assert.equal(
    api.readDeviceSession("teacher-a", state.epoch + 1).expiresAt,
    newer.expiresAt,
  );
  api.clearDeviceSession("teacher-a");
  assert.equal(api.readDeviceSession("teacher-a", state.epoch + 1), null);
  api.initializeDeviceSession("teacher-a", state.epoch + 2);
  f.values.delete(api.getDeviceSessionKey("teacher-a"));
  assert.equal(
    api.readDeviceSession("teacher-a", state.epoch + 2),
    null,
    "Cross-tab removal cannot revive an in-memory timer",
  );
}
{
  const f = fixture();
  f.state.blocked = true;
  const initial = f.api.initializeDeviceSession("teacher-a", f.state.epoch);
  f.state.now += 86400000;
  assert.equal(
    f.api.initializeDeviceSession("teacher-a", f.state.epoch).expiresAt,
    initial.expiresAt,
    "Blocked storage remains usable within this page",
  );
}
{
  const f = fixture();
  const cleanup = f.start();
  await flush();
  assert.equal(f.state.tokenCalls, 1);
  assert.equal([...f.window.timers.values()][0].delay, 60000);
  const original = f.api.readDeviceSession(f.currentUser.uid, f.state.epoch);
  f.state.now += 86400000;
  f.document.hidden = true;
  f.window.emit("westory:session-activity");
  assert.equal(
    f.api.readDeviceSession(f.currentUser.uid, f.state.epoch).expiresAt,
    original.expiresAt,
    "Background timers do not count as human activity",
  );
  f.document.hidden = false;
  f.document.emit("visibilitychange");
  assert.equal(f.state.remaining, 29 * 86400);
  f.document.emit("input", { isTrusted: true, target: { activity: true } });
  const active = f.api.readDeviceSession(f.currentUser.uid, f.state.epoch);
  assert.equal(active.expiresAt, f.state.now + 30 * 86400000);
  const reads = f.state.reads;
  for (let index = 0; index < 1000; index++)
    f.document.emit("pointermove", {
      isTrusted: true,
      buttons: 1,
      target: { activity: true },
    });
  assert.equal(
    f.state.reads,
    reads,
    "Continuous handwriting does not read storage on every movement",
  );
  assert.equal(f.state.tokenCalls, 1, "Activity has no token request");
  f.state.now += 60000;
  f.document.emit("pointerdown", { isTrusted: true, buttons: 1, target: {} });
  const drawing = f.api.readDeviceSession(f.currentUser.uid, f.state.epoch);
  assert.equal(
    drawing.expiresAt,
    f.state.now + 30 * 86400000,
    "Worksheet div/SVG pointer strokes also count as activity",
  );
  f.state.now = original.expiresAt + 1;
  f.window.emit("pageshow");
  await flush();
  assert.equal(
    f.state.logouts,
    0,
    "A resumed tab respects another active deadline",
  );
  f.state.now = drawing.expiresAt + 1;
  f.window.emit("pageshow");
  await flush();
  assert.equal(f.state.logouts, 1, "A genuinely idle session expires");
  f.window.emit("pageshow");
  await flush();
  assert.equal(f.state.logouts, 1, "Expiry logs out only once");
  cleanup();
  assert.equal(f.window.timers.size, 0);
  for (const listeners of [
    ...f.document.listeners.values(),
    ...f.window.listeners.values(),
  ])
    assert.equal(listeners.size, 0, "Unmount cleans up every listener");
}
{
  const f = fixture();
  f.state.tokenError = new Error("offline");
  const cleanup = f.start();
  await flush();
  assert.equal(f.state.tokenCalls, 1);
  f.state.tokenError = null;
  f.window.emit("pageshow");
  await flush();
  assert.equal(
    f.state.tokenCalls,
    2,
    "Resume retries an initialization that failed offline",
  );
  assert.ok(f.api.readDeviceSession(f.currentUser.uid, f.state.epoch));
  cleanup();
}
for (const change of [
  "other-account",
  "same-account-epoch",
  "newer-activity",
  "unmounted",
  "offline",
]) {
  const f = fixture();
  const cleanup = f.start();
  await flush();
  f.state.now += 31 * 86400000;
  let release;
  f.state.tokenHold = new Promise((resolve) => (release = resolve));
  f.window.emit("pageshow");
  if (change === "other-account") f.auth.currentUser = { uid: "student-b" };
  if (change === "same-account-epoch") f.state.epoch++;
  if (change === "newer-activity")
    f.api.resetDeviceSession(f.currentUser.uid, f.state.epoch);
  if (change === "unmounted") cleanup();
  if (change === "offline") f.state.tokenError = new Error("offline");
  release();
  await flush();
  assert.equal(f.state.logouts, 0, `${change} must not trigger a stale logout`);
  cleanup();
}
{
  const f = fixture();
  assert.equal(f.api.formatDeviceSessionRemaining(30 * 86400), "30일");
  assert.equal(f.api.formatDeviceSessionRemaining(3600), "1시간");
  assert.equal(f.api.formatDeviceSessionRemaining(30), "1분");
  assert.equal(f.api.formatDeviceSessionRemaining(0), "만료");
}

console.log(
  "PASS: 30-day device inactivity, one-time migration, reload/expired-session behavior, account/auth epoch isolation, explicit login/logout, storage fallback, resume synchronization, typing/handwriting throttling, stale expiry races, and cleanup.",
);
