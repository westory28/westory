// Actual helper + actual callable factory; controlled SDK/module boundaries, no network.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const firebaseSource = readFileSync("src/lib/firebase.ts", "utf8");
const factorySource = firebaseSource
  .slice(
    firebaseSource.indexOf("const getHttpsCallable ="),
    firebaseSource.indexOf("const getFirebaseStorage ="),
  )
  .replaceAll('import("firebase/functions")', "loadFunctions()")
  .replaceAll('import("./applicationSession")', "loadSession()");
assert.ok(factorySource.includes("assertExpectedOwner"));
assert.ok(!factorySource.includes("import("));
const factoryCode = transformSync(
  factorySource + "\nmodule.exports={getHttpsCallable};",
  { loader: "ts", format: "cjs" },
).code;
const helperCode = transformSync(
  readFileSync("src/lib/lessonCorePointReward.ts", "utf8"),
  { loader: "ts", format: "cjs" },
).code;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const until = async (predicate) => {
  for (let n = 0; n < 400 && !predicate(); n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), "controlled boundary reached");
};
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const fixture = () => {
  const state = {
    auth: { currentUser: { uid: "student-a" } },
    calls: [],
    storage: new Map(),
    preparations: [],
    entered: [],
    factoryGate: null,
    sessionGate: null,
    responseGate: null,
  };
  const factoryModule = { exports: {} };
  const rawCallable = async (data) => {
    state.calls.push({ uid: state.auth.currentUser?.uid, data });
    if (state.responseGate) return state.responseGate.promise;
    return { data: { commandId: data.commandId, result: { settled: true } } };
  };
  rawCallable.stream = rawCallable;
  runInNewContext(factoryCode, {
    module: factoryModule,
    exports: factoryModule.exports,
    auth: state.auth,
    getFirebaseFunctions: async () => {
      state.entered.push("factory");
      if (state.factoryGate) await state.factoryGate.promise;
      return {};
    },
    loadFunctions: async () => ({ httpsCallable: () => rawCallable }),
    loadSession: async () => {
      state.entered.push("session");
      if (state.sessionGate) await state.sessionGate.promise;
      return {
        prepareCallableDataWithApplicationSession: (_name, data) => {
          state.preparations.push(state.auth.currentUser?.uid);
          return data;
        },
      };
    },
    isHighRiskCommand: () => false,
    StepUpReauthError: class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  });
  const helperModule = { exports: {} };
  runInNewContext(helperCode, {
    module: helperModule,
    exports: helperModule.exports,
    crypto: webcrypto,
    TextEncoder,
    window: {
      localStorage: {
        getItem: (key) => state.storage.get(key) ?? null,
        setItem: (key, value) => state.storage.set(key, value),
        removeItem: (key) => state.storage.delete(key),
      },
    },
    require: (name) =>
      name === "./firebase"
        ? { auth: state.auth, ...factoryModule.exports }
        : { getYearSemester: (config) => config },
  });
  state.api = helperModule.exports;
  state.factory = factoryModule.exports.getHttpsCallable;
  return state;
};
let checks = 0;
const config = { year: "2026", semester: "2" };
for (const type of ["find", "reward"]) {
  const invoke = (f) =>
    type === "find"
      ? f.api.recordLessonCorePointFind({
          config,
          unitId: "unit-a",
          corePointId: "point-a",
        })
      : f.api.claimLessonCorePointReward(config);
  for (const phase of ["factory", "session", "response"]) {
    const f = fixture(),
      gate = deferred();
    f[phase + "Gate"] = gate;
    const pending = settle(invoke(f));
    await until(() =>
      phase === "response" ? f.calls.length === 1 : f.entered.includes(phase),
    );
    if (phase === "response") assert.equal(f.calls.length, 1);
    f.auth.currentUser = { uid: "student-b" };
    gate.resolve({ data: { result: { settled: true } } });
    assert.ok(
      (await pending).error,
      `${type}/${phase} must reject old identity`,
    );
    assert.equal(f.calls.length, phase === "response" ? 1 : 0);
    assert.ok(f.calls.every((call) => call.uid === "student-a"));
    assert.equal(
      f.storage.size,
      1,
      "old owner's retry handle remains isolated",
    );
    const oldId = JSON.parse([...f.storage.values()][0]).commandId;
    f[phase + "Gate"] = null;
    await invoke(f);
    assert.equal(f.calls.at(-1).uid, "student-b");
    assert.notEqual(f.calls.at(-1).data.commandId, oldId);
    f.auth.currentUser = { uid: "student-a" };
    await invoke(f);
    assert.equal(f.calls.at(-1).data.commandId, oldId);
    assert.equal(f.storage.size, 0);
    checks++;
  }
  const f = fixture();
  f.sessionGate = deferred();
  const pending = settle(invoke(f));
  await until(() => f.entered.includes("session"));
  f.auth.currentUser = null;
  f.sessionGate.resolve();
  assert.ok((await pending).error);
  assert.equal(f.calls.length, 0);
  checks++;
  const retry = fixture();
  retry.responseGate = deferred();
  const failing = settle(invoke(retry));
  await until(() => retry.calls.length === 1);
  retry.responseGate.reject(
    Object.assign(Error("Synthetic response loss"), {
      code: "functions/unavailable",
    }),
  );
  assert.ok((await failing).error);
  const id = retry.calls[0].data.commandId;
  retry.responseGate = null;
  await invoke(retry);
  assert.equal(retry.calls[1].data.commandId, id);
  assert.equal(retry.storage.size, 0);
  checks++;
}
// The opt-in factory also checks stream preparation; existing callers stay supported.
const f = fixture();
const stream = await f.factory("controlled", { expectedUid: "student-a" });
f.auth.currentUser = { uid: "student-b" };
await assert.rejects(stream.stream({}));
assert.equal(f.calls.length, 0);
checks++;
await (
  await f.factory("controlled")
)({});
assert.equal(f.calls[0].uid, "student-b");
checks++;
console.log(
  JSON.stringify({
    suite: "lesson-core-point-identity",
    checks,
    passed: true,
    networkAccess: 0,
  }),
);
