import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
        "lesson reward explicit user-event purity",
        "allowlist duplicate stale expiry",
        "28-command manifest exact count",
      ],
    }),
  );
} finally {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
}
