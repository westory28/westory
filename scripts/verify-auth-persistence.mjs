import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual initialization order with blocked storage, without SDK
// network requests or a production account. No storage fallback may skip an
// available durable store in favor of a tab-only session.
const code = ts.transpileModule(
  fs
    .readFileSync(new URL("../src/lib/firebase.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env", "({})"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
for (const [mobile, blocked, expected] of [
  [true, [], ["local"]],
  [true, ["local"], ["local", "indexedDB"]],
  [false, [], ["indexedDB"]],
  [false, ["indexedDB"], ["indexedDB", "local"]],
  [true, ["local", "indexedDB"], ["local", "indexedDB", "session"]],
  [
    true,
    ["local", "indexedDB", "session"],
    ["local", "indexedDB", "session", "memory"],
  ],
]) {
  const calls = [],
    exports = {};
  const modules = {
    "./semesterArchive": {
      isSemesterArchive: false,
      assertArchiveWritable() {},
    },
    "firebase/app": { initializeApp: () => ({}) },
    "firebase/auth": {
      getAuth: () => ({}),
      browserLocalPersistence: "local",
      indexedDBLocalPersistence: "indexedDB",
      browserSessionPersistence: "session",
      inMemoryPersistence: "memory",
      setPersistence: async (_, kind) => {
        calls.push(kind);
        if (blocked.includes(kind)) throw Error("blocked");
      },
    },
    "firebase/firestore": { getFirestore: () => ({}) },
    "./loginPerf": { markLoginPerf() {} },
  };
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    navigator: { userAgent: mobile ? "iPhone Mobile" : "Desktop" },
    window: { location: { hostname: "localhost" }, setTimeout() {} },
    console,
  });
  await exports.authPersistenceReady;
  assert.deepEqual(calls, expected);
}
console.log(
  "Auth persistence: 6 durable-storage and blocked-storage fallback cases passed; network 0.",
);
