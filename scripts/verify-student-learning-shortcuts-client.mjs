/** Execute the real hook with controlled time/auth/network. No browser or Firebase. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/lib/studentLearningShortcuts.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const clone = (value) => JSON.parse(JSON.stringify(value));

function environment({ archive = false } = {}) {
  let now = 1_000_000;
  let activeHook;
  const hooks = new Set();
  const calls = [];
  const pending = [];
  const server = { items: ["maps"], revision: 1 };
  const context = {
    currentUser: { uid: "student-a" },
    userData: { role: "student" },
    authGeneration: 1,
    config: { year: "2026", semester: "2" },
    configReady: true,
  };
  const auth = { currentUser: context.currentUser };
  const react = {
    useState(initial) {
      const hook = activeHook;
      const index = hook.cursor++;
      if (!(index in hook.slots)) hook.slots[index] = initial;
      return [
        hook.slots[index],
        (value) => {
          const next =
            typeof value === "function" ? value(hook.slots[index]) : value;
          if (!Object.is(next, hook.slots[index])) {
            hook.slots[index] = next;
            hook.dirty = true;
          }
        },
      ];
    },
    useEffect(fn, deps) {
      const hook = activeHook;
      const index = hook.cursor++;
      const prior = hook.slots[index];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
        const slot = { deps, cleanup: prior?.cleanup };
        hook.slots[index] = slot;
        hook.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = fn();
        });
      }
    },
  };
  const modules = {
    react,
    "../contexts/AuthContext": { useAuth: () => context },
    "./firebase": { auth },
    "./semesterScope": {
      getYearSemester: (value) => value || { year: "2026", semester: "2" },
    },
    "./semesterArchive": { isSemesterArchive: archive },
    "./applicationSession": {
      callWithApplicationSession(name, fields, user) {
        assert.equal(name, "manageStudentLearningShortcuts");
        calls.push({ ...clone(fields), uid: user.uid });
        const index = pending.findIndex(
          (item) => item.action === fields.action,
        );
        if (index >= 0) return pending.splice(index, 1)[0].promise;
        if (fields.action === "save") {
          assert.equal(fields.expectedRevision, server.revision);
          server.items = clone(fields.items);
          server.revision++;
        }
        return Promise.resolve({ data: clone(server) });
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Date: { now: () => now },
    Error,
    require: (name) => {
      assert(name in modules, `Unexpected runtime dependency: ${name}`);
      return modules[name];
    },
  });
  function flush() {
    for (let attempt = 0; attempt < 50; attempt++) {
      for (const hook of hooks) {
        if (hook.dirty) {
          hook.dirty = false;
          hook.cursor = 0;
          activeHook = hook;
          hook.value = exports.useStudentLearningShortcuts(hook.active);
        }
        while (hook.effects.length) hook.effects.shift()();
      }
      if (![...hooks].some((hook) => hook.dirty || hook.effects.length)) return;
    }
    throw Error("Hook did not settle");
  }
  return {
    calls,
    context,
    auth,
    server,
    tick(ms) {
      now += ms;
    },
    hold(action) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending.push({ action, promise });
      return { resolve: (data) => resolve({ data: clone(data) }), reject };
    },
    mount(active = false) {
      const hook = { active, slots: [], effects: [], cursor: 0, dirty: true };
      hooks.add(hook);
      flush();
      return {
        get value() {
          return hook.value;
        },
        setActive(value) {
          hook.active = value;
          hook.dirty = true;
          flush();
        },
        unmount() {
          hooks.delete(hook);
          hook.slots.forEach((slot) => slot?.cleanup?.());
        },
      };
    },
    switch(kind) {
      if (kind === "uid") context.currentUser = { uid: "student-b" };
      if (kind === "generation") context.authGeneration++;
      if (kind === "semester") context.config = { year: "2026", semester: "1" };
      auth.currentUser = context.currentUser;
      for (const hook of hooks) hook.dirty = true;
      flush();
    },
    async settle() {
      for (let i = 0; i < 16; i++) {
        await Promise.resolve();
        flush();
      }
    },
  };
}

{
  const env = environment();
  const hook = env.mount();
  assert.equal(env.calls.length, 0, "Closed launcher creates no shortcut read");
  hook.setActive(true);
  await env.settle();
  assert.deepEqual(clone(hook.value.items), ["maps"]);
  hook.setActive(false);
  hook.setActive(true);
  await env.settle();
  assert.equal(
    env.calls.length,
    1,
    "Immediate close/reopen shares the first read",
  );
  env.tick(60_001);
  await env.settle();
  assert.equal(env.calls.length, 1, "TTL alone does not poll an open menu");
  hook.setActive(false);
  hook.setActive(true);
  await env.settle();
  assert.equal(
    env.calls.length,
    2,
    "An open after TTL performs one fresh read",
  );
  await hook.value.save(["maps"]);
  await env.settle();
  assert.equal(env.calls.length, 2, "Saving the same order makes no request");
  await hook.value.save(["calendar", "maps"]);
  await env.settle();
  assert.deepEqual(clone(hook.value.items), ["calendar", "maps"]);
  assert.equal(env.calls.filter((call) => call.action === "save").length, 1);
  hook.unmount();
  const remount = env.mount(true);
  await env.settle();
  assert.equal(
    env.calls.filter((call) => call.action === "get").length,
    3,
    "Last departure clears memory cache",
  );
  remount.unmount();
}

{
  const env = environment();
  const held = env.hold("get");
  const first = env.mount(true);
  const second = env.mount(true);
  assert.equal(
    env.calls.length,
    1,
    "Concurrent consumers share one pending request",
  );
  const reloadA = first.value.reload();
  const reloadB = second.value.reload();
  assert.equal(reloadA, reloadB);
  held.resolve({ items: ["lesson"], revision: 1 });
  await reloadA;
  await env.settle();
  assert.deepEqual(clone(second.value.items), ["lesson"]);
  const saveHeld = env.hold("save");
  const saveA = first.value.save(["calendar"]);
  const saveB = second.value.save(["calendar"]);
  assert.equal(saveA, saveB, "Duplicate save shares its pending result");
  await assert.rejects(second.value.save(["maps"]), /이전 설정/);
  assert.equal(env.calls.filter((call) => call.action === "save").length, 1);
  saveHeld.resolve({ items: ["calendar"], revision: 2 });
  await saveA;
  await env.settle();
  assert.deepEqual(clone(first.value.items), ["calendar"]);
  assert.deepEqual(clone(second.value.items), ["calendar"]);
  first.unmount();
  second.unmount();
}

{
  const env = environment();
  const failed = env.hold("get");
  const hook = env.mount(true);
  failed.reject(Error("Synthetic read failure"));
  await env.settle();
  assert.equal(hook.value.loaded, false);
  assert.match(hook.value.error, /Synthetic read failure/);
  assert.equal(
    env.calls.length,
    1,
    "Read failure does not automatically retry",
  );
  await hook.value.reload();
  await env.settle();
  assert.equal(hook.value.loaded, true);
  assert.equal(hook.value.error, "");
  const saveFailed = env.hold("save");
  const save = hook.value.save(["calendar"]);
  const rejected = assert.rejects(save, /Synthetic save failure/);
  saveFailed.reject(Error("Synthetic save failure"));
  await rejected;
  await env.settle();
  assert.deepEqual(
    clone(hook.value.items),
    ["maps"],
    "Failed save preserves last confirmed choices",
  );
  await hook.value.save(["calendar"]);
  await env.settle();
  assert.equal(hook.value.error, "");
  assert.deepEqual(
    env.calls.map((call) => call.action),
    ["get", "get", "save", "save"],
  );
  hook.unmount();
}

for (const kind of ["uid", "generation", "semester"]) {
  for (const operation of ["get", "save"]) {
    const env = environment();
    const oldRead = operation === "get" ? env.hold("get") : null;
    const hook = env.mount(true);
    await env.settle();
    let pending;
    let held = oldRead;
    if (operation === "save") {
      held = env.hold("save");
      pending = assert.rejects(
        hook.value.save(["weplay"]),
        /로그인 상태가 변경/,
      );
    }
    env.server.items = ["calendar"];
    env.switch(kind);
    await env.settle();
    assert.deepEqual(clone(hook.value.items), ["calendar"]);
    held.resolve({ items: ["weplay"], revision: 20 });
    if (pending) await pending;
    await env.settle();
    assert.deepEqual(
      clone(hook.value.items),
      ["calendar"],
      `${kind}: late ${operation} cannot populate the next boundary`,
    );
    assert.equal(hook.value.error, "");
    assert.equal(env.calls.filter((call) => call.action === "get").length, 2);
    hook.unmount();
  }
}

for (const restriction of [
  "teacher",
  "config-pending",
  "archive",
  "signed-out",
]) {
  const env = environment({ archive: restriction === "archive" });
  if (restriction === "teacher") env.context.userData = { role: "teacher" };
  if (restriction === "config-pending") env.context.configReady = false;
  if (restriction === "signed-out")
    env.context.currentUser = env.auth.currentUser = null;
  const hook = env.mount(true);
  await env.settle();
  assert.equal(env.calls.length, 0, `${restriction}: no preference reads`);
  await assert.rejects(hook.value.save(["calendar"]), /로그인 상태가 변경/);
  hook.unmount();
}
console.log(
  "Student shortcuts client: lazy 1-get open/reopen, 60s open-only TTL, no-op save, shared calls, explicit retry, account/session/semester late response rejection, and restricted contexts passed.",
);
