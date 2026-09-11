import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeClientBoundary,
  buildProposedPolicy,
  validateCommandManifest,
  validateGatewayPurity,
  validatePolicy,
  validateUserEventCommandCallablePurity,
} from "./verify-client-direct-write-boundary.mjs";

const tempRoots = [];
const fixture = (files) => {
  const root = mkdtempSync(join(tmpdir(), "westory-direct-write-"));
  tempRoots.push(root);
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, "src", name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value, "utf8");
  }
  return analyzeClientBoundary({ rootDir: root });
};

try {
  const baseFiles = {
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async (_data: unknown) => ({ data: name });`,
    "lib/write.ts": `
      import { setDoc } from "firebase/firestore";
      import { uploadBytes } from "firebase/storage";
      import { signOut } from "firebase/auth";
      export const saveThing = async () => setDoc({} as never, {});
      export const uploadThing = async () => uploadBytes({} as never, new Blob());
      export const logout = async () => signOut({} as never);
    `,
    "App.tsx": `
      import { useEffect } from "react";
      import { saveThing, uploadThing, logout } from "./lib/write";
      export const App = () => {
        useEffect(() => { void saveThing(); }, []);
        const handleClick = async () => { await uploadThing(); await logout(); };
        return <button onClick={handleClick}>save</button>;
      };
    `,
  };
  const base = fixture(baseFiles);
  assert.equal(base.unknown.length, 0);
  assert.ok(base.observations.some((item) => item.boundary === "FIRESTORE"));
  assert.ok(base.observations.some((item) => item.boundary === "STORAGE"));
  assert.ok(base.observations.some((item) => item.boundary === "AUTH"));
  const firestoreBase = base.observations.find((item) => item.boundary === "FIRESTORE");
  assert.ok(firestoreBase.triggers.includes("MOUNT_EFFECT"));

  const transactionAndBatch = fixture({
    "writes.ts": `
      import * as firestore from "firebase/firestore";
      import { writeBatch as makeBatch } from "firebase/firestore";
      export const transact = async () => firestore.runTransaction({} as never, async (transaction) => transaction.set({} as never, {}));
      export const batch = () => { const value = makeBatch({} as never); value.set({} as never, {}); return value.commit(); };
    `,
  });
  assert.ok(
    transactionAndBatch.observations.some((item) => item.api.endsWith("#runTransaction")),
    "namespace runTransaction must be detected",
  );
  assert.ok(
    transactionAndBatch.observations.some((item) => item.api.endsWith("#writeBatch")),
    "aliased writeBatch must be detected",
  );

  const changed = fixture({
    ...baseFiles,
    "Second.tsx": `
      import { saveThing } from "./lib/write";
      export const Second = () => <button onClick={() => void saveThing()}>second</button>;
    `,
  });
  const firestoreChanged = changed.observations.find((item) => item.boundary === "FIRESTORE");
  assert.notEqual(
    firestoreBase.callGraphHash,
    firestoreChanged.callGraphHash,
    "cross-file wrapper callsite changes must alter the boundary fingerprint",
  );

  const listener = fixture({
    ...baseFiles,
    "Listener.tsx": `
      import { onSnapshot } from "firebase/firestore";
      import { saveThing } from "./lib/write";
      export const Listener = () => { onSnapshot({} as never, () => { void saveThing(); }); return null; };
    `,
  });
  assert.ok(
    listener.observations
      .find((item) => item.boundary === "FIRESTORE")
      .triggers.includes("LISTENER"),
    "listener writes must be distinguished from explicit events",
  );

  const callableUnknown = fixture({
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
    "dynamic.ts": `
      import { getHttpsCallable } from "./lib/firebase";
      export const invoke = async (name: string) => (await getHttpsCallable(name))();
    `,
  });
  assert.equal(callableUnknown.unknown.length, 1, "dynamic callable names must be UNKNOWN");

  const callableFinite = fixture({
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
    "callable.ts": `
      import { getHttpsCallable } from "./lib/firebase";
      const invoke = async (name: string) => (await getHttpsCallable(name))();
      export const save = () => invoke("saveKnownThing");
    `,
  });
  assert.equal(callableFinite.unknown.length, 0);
  assert.ok(
    callableFinite.observations.some((item) => item.callable === "saveKnownThing"),
    "finite dynamic callable names must resolve through wrapper parameters",
  );

  const queryCallable = fixture({
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
    "query.ts": `
      import { getHttpsCallable } from "./lib/firebase";
      export const status = async () => (await getHttpsCallable("getCommandStatus"))();
    `,
  });
  assert.equal(queryCallable.observations.length, 0);
  assert.equal(queryCallable.queryCallables.length, 1);

  const http = fixture({
    "http.ts": `
      export const save = () => fetch("/write", { method: "POST" });
      export const dynamic = (options: RequestInit) => fetch("/maybe", options);
    `,
  });
  assert.ok(http.observations.some((item) => item.api === "http#POST"));
  assert.ok(http.unknown.some((item) => item.reason === "dynamic fetch method"));

  const gatewayEffect = fixture({
    "lib/commandGateway.ts": `export const executeWestoryCommand = async (_name: string, _payload: unknown) => undefined;`,
    "App.tsx": `
      import { useEffect } from "react";
      import { executeWestoryCommand } from "./lib/commandGateway";
      export const App = () => { useEffect(() => { void executeWestoryCommand("demo", {}); }, []); return null; };
    `,
  });
  assert.throws(() => validateGatewayPurity(gatewayEffect), /explicit user event/);

  const callbackBase = {
    "lib/commandGateway.ts": `export const executeWestoryCommand = async (_name: string, _payload: unknown) => undefined;`,
    "lib/work.ts": `
      export const forward = async (options: { nested: { prepare: () => Promise<void> } }) => options.nested.prepare();
      export const save = async (preparation: { prepare: () => Promise<void> }) => forward({ nested: preparation });
    `,
  };
  const callbackEvent = fixture({ ...callbackBase, "App.tsx": `
    import { save } from "./lib/work";
    import { executeWestoryCommand } from "./lib/commandGateway";
    export const App = () => {
      const handleSave = () => save({ prepare: async () => { await executeWestoryCommand("upload", {}); } });
      return <button onClick={handleSave}>save</button>;
    };
  ` });
  validateGatewayPurity(callbackEvent);
  assert.deepEqual(callbackEvent.observations.find(item => item.boundary === "GATEWAY").triggers, ["USER_EVENT"]);
  const callbackAlias = fixture({ ...callbackBase, "App.tsx": `
    import { save } from "./lib/work";
    import { executeWestoryCommand } from "./lib/commandGateway";
    const prepare = async () => executeWestoryCommand("upload", {});
    const options = { prepare };
    export const App = () => <button onClick={() => save(options)}>save</button>;
  ` });
  validateGatewayPurity(callbackAlias);
  const unusedCallback = fixture({ ...callbackBase, "App.tsx": `
    import { executeWestoryCommand } from "./lib/commandGateway";
    const ignore = (_options: unknown) => undefined;
    export const App = () => <button onClick={() => ignore({ prepare: async () => executeWestoryCommand("upload", {}) })}>save</button>;
  ` });
  assert.throws(() => validateGatewayPurity(unusedCallback), /UNREACHED/);
  for (const [trigger, invoke] of [
    ["MOUNT_EFFECT", "useEffect(() => { void save(options); }, [])"],
    ["TIMER", "setTimeout(() => { void save(options); }, 100)"],
    ["LISTENER", "window.addEventListener('online', () => { void save(options); })"],
    ["RENDER", "void save(options)"],
  ]) {
    const invalidCallback = fixture({ ...callbackBase, "App.tsx": `
      import { useEffect } from "react";
      import { save } from "./lib/work";
      import { executeWestoryCommand } from "./lib/commandGateway";
      export const App = () => {
        const options = { prepare: async () => executeWestoryCommand("upload", {}) };
        ${invoke};
        return <button onClick={() => save(options)}>save</button>;
      };
    ` });
    assert.ok(invalidCallback.observations.find(item => item.boundary === "GATEWAY").triggers.includes(trigger));
    assert.throws(() => validateGatewayPurity(invalidCallback), /explicit user event/, `${trigger} must not be masked by the callback's user-event caller`);
  }
  const callbackDeferredMount = fixture({ ...callbackBase,
    "lib/work.ts": `import { useEffect } from "react"; export const save = (options: { prepare: () => Promise<void> }) => { useEffect(() => { void options.prepare(); }, []); };`,
    "App.tsx": `
      import { save } from "./lib/work";
      import { executeWestoryCommand } from "./lib/commandGateway";
      export const App = () => <button onClick={() => save({ prepare: async () => executeWestoryCommand("upload", {}) })}>save</button>;
    `,
  });
  assert.throws(() => validateGatewayPurity(callbackDeferredMount), /MOUNT_EFFECT/);

  const lessonRewardUserEvent = fixture({
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
    "lib/lessonCorePointReward.ts": `
      import { getHttpsCallable } from "./firebase";
      export const executeLessonCorePointCommand = async () => (await getHttpsCallable("executeLessonCorePointCommand"))();
    `,
    "App.tsx": `
      import { executeLessonCorePointCommand } from "./lib/lessonCorePointReward";
      export const App = () => <button onClick={() => void executeLessonCorePointCommand()}>reward</button>;
    `,
  });
  validateUserEventCommandCallablePurity(lessonRewardUserEvent);
  const lessonRewardMount = fixture({
    "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
    "lib/lessonCorePointReward.ts": `
      import { getHttpsCallable } from "./firebase";
      export const executeLessonCorePointCommand = async () => (await getHttpsCallable("executeLessonCorePointCommand"))();
    `,
    "App.tsx": `
      import { useEffect } from "react";
      import { executeLessonCorePointCommand } from "./lib/lessonCorePointReward";
      export const App = () => { useEffect(() => { void executeLessonCorePointCommand(); }, []); return null; };
    `,
  });
  assert.throws(
    () => validateUserEventCommandCallablePurity(lessonRewardMount),
    /must never dispatch from render, mount, listener, timer, cleanup, or an implicit\/unreached path/,
  );

  for (const [module, owner, callable] of [
    ["mapManagement", "uploadMapAsset", "uploadMapAssetContent"],
    ["sourceArchive", "saveSourceArchiveAsset", "uploadSourceArchiveAsset"],
    ["sourceArchive", "deleteSourceArchiveAsset", "cleanupSourceArchiveAsset"],
  ]) {
    const transportFiles = {
      "lib/firebase.ts": `export const getHttpsCallable = async (name: string) => async () => name;`,
      [`lib/${module}.ts`]: `
        import { getHttpsCallable } from "./firebase";
        export const ${owner} = async () => (await getHttpsCallable("${callable}"))();
      `,
    };
    const transportEvent = fixture({ ...transportFiles, "App.tsx": `
      import { ${owner} } from "./lib/${module}";
      export const App = () => <button onClick={() => void ${owner}()}>save</button>;
    ` });
    validateUserEventCommandCallablePurity(transportEvent);
    const transportMount = fixture({ ...transportFiles, "App.tsx": `
      import { useEffect } from "react";
      import { ${owner} } from "./lib/${module}";
      export const App = () => { useEffect(() => { void ${owner}(); }, []); return null; };
    ` });
    assert.throws(() => validateUserEventCommandCallablePurity(transportMount), /must never dispatch/);
    const wrongOwner = fixture({
      "lib/firebase.ts": transportFiles["lib/firebase.ts"],
      "App.tsx": `
        import { getHttpsCallable } from "./lib/firebase";
        export const App = () => <button onClick={async () => (await getHttpsCallable("${callable}"))()}>save</button>;
      `,
    });
    assert.throws(() => validateUserEventCommandCallablePurity(wrongOwner), {
      code: "ERR_ASSERTION",
      actual: "src/App.tsx",
      expected: `src/lib/${module}.ts`,
    });
  }

  const cleanPolicy = buildProposedPolicy(base);
  validatePolicy(cleanPolicy, base);
  const duplicate = structuredClone(cleanPolicy);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  duplicate.approvedEntryCount += 1;
  assert.throws(() => validatePolicy(duplicate, base), /duplicate allowlist boundary/);
  const stale = structuredClone(cleanPolicy);
  stale.entries.push({ ...structuredClone(stale.entries[0]), id: "DW-STALE", file: "src/stale.ts" });
  stale.approvedEntryCount += 1;
  assert.throws(() => validatePolicy(stale, base), /stale allowlist entry/);
  const expired = structuredClone(cleanPolicy);
  const expiringEntry = expired.entries.find((entry) => entry.expiresAfterWave !== "PERMANENT");
  expiringEntry.expiresAfterWave = "W3";
  expiringEntry.migrationWave = "W3";
  expired.currentWave = "W4A";
  assert.throws(() => validatePolicy(expired, base), /expired after W3/);

  const manifest = JSON.parse(
    await import("node:fs").then(({ readFileSync }) =>
      readFileSync("scripts/w2-high-risk-command-manifest.json", "utf8"),
    ),
  );
  assert.equal(manifest.commands.length, 28);
  const duplicateManifest = structuredClone(manifest);
  duplicateManifest.commands[1].id = duplicateManifest.commands[0].id;
  assert.throws(
    () => validateCommandManifest(duplicateManifest, { observations: [] }),
    /duplicate command inventory id|command inventory mismatch/,
  );

  console.log(
    JSON.stringify({
      suite: "client-direct-write-boundary-fixtures",
      passed: true,
      checks: [
        "Auth and Storage roots",
        "transaction and batch aliases",
        "cross-file wrapper sensitivity",
        "listener trigger sensitivity",
        "dynamic callable UNKNOWN",
        "finite callable resolution",
        "query callable exclusion",
        "HTTP mutation and dynamic method sensitivity",
        "gateway effect rejection",
        "higher-order object callback invocation and forwarding",
        "unused object callbacks remain unreachable",
        "callback mount/timer/listener/render rejection",
        "user-event registration cannot hide deferred effect invocation",
        "lesson reward explicit user-event purity",
        "map/source transports require exact owners and explicit user events",
        "allowlist duplicate stale expiry",
        "28-command manifest exact count",
      ],
    }),
  );
} finally {
  for (const root of tempRoots) {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("westory-direct-write-"));
    rmSync(root, { recursive: true, force: true });
  }
}
