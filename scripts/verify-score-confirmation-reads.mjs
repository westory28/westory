import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { transformSync } from "esbuild";

// Exercise the implementation used by both teacher score-list and class-sheet
// views, with only the document transport replaced by deterministic fixtures.
const source = readFileSync(
  new URL(
    "../src/pages/teacher/components/PerformanceScoreManager.tsx",
    import.meta.url,
  ),
  "utf8",
);
const start = source.indexOf(
  "  const loadPerformanceScoreConfirmationsForRoster = async (",
);
const end = source.indexOf(
  "  const syncMissingStudentScoreDocuments = async (",
  start,
);
assert.ok(
  start >= 0 && end > start,
  "teacher confirmation reader must remain discoverable",
);
const compiled = transformSync(source.slice(start, end), { loader: "ts" }).code;
const instantiate = new Function(
  "confirmationsByRosterCacheRef",
  "confirmationPromisesByRosterRef",
  "clonePerformanceScoreConfirmationMap",
  "loadPerformanceScoreConfirmation",
  `${compiled}\nreturn loadPerformanceScoreConfirmationsForRoster;`,
);
const clone = (map) =>
  new Map([...map].map(([uid, value]) => [uid, { ...value }]));
const createHarness = (transport) => {
  const cache = { current: new Map() };
  const pending = { current: new Map() };
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const load = instantiate(
    cache,
    pending,
    clone,
    async (uid, rosterId, options) => {
      calls.push({ uid, rosterId, options });
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await transport(uid, rosterId, options);
      } finally {
        active -= 1;
      }
    },
  );
  return { load, cache, pending, calls, maxActive: () => maxActive };
};
const value = (uid, rosterId) => ({ uid, rosterId, signatureName: "검증학생" });

let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const dedup = createHarness(async (uid, rosterId) => {
  await gate;
  if (uid === "missing") return null;
  if (uid === "invalid") return value("another-student", rosterId);
  return value(uid, rosterId);
});
assert.equal((await dedup.load("empty", [])).size, 0);
assert.equal(dedup.calls.length, 0);
const first = dedup.load("exam", ["b", "a", " a ", "", "missing", "invalid"]);
const simultaneous = dedup.load("exam", ["invalid", "missing", "b", "a"]);
assert.equal(dedup.calls.length, 4);
release();
const [firstResult, simultaneousResult] = await Promise.all([
  first,
  simultaneous,
]);
assert.deepEqual([...firstResult.keys()], ["a", "b"]);
assert.deepEqual([...simultaneousResult.keys()], ["a", "b"]);
firstResult.get("a").signatureName = "수정한 화면 사본";
assert.equal(
  (await dedup.load("exam", ["b", "a", "missing", "invalid"])).get("a")
    .signatureName,
  "검증학생",
);
assert.equal(
  dedup.calls.length,
  4,
  "same-scope cached and pending callers must not add document reads",
);
assert.ok(
  dedup.calls.every(
    ({ options }) => options.throwOnError && options.fromServer,
  ),
);
await dedup.load("exam", ["a", "b", "c"]);
assert.equal(
  dedup.calls.length,
  7,
  "a changed UID scope must not reuse an incomplete cache",
);
await dedup.load("other-exam", ["a"]);
assert.equal(dedup.calls.length, 8, "roster boundaries must remain separate");

const bounded = createHarness(async (uid, rosterId) => {
  await setImmediate();
  return value(uid, rosterId);
});
const members = Array.from({ length: 65 }, (_, index) => `student-${index}`);
assert.equal((await bounded.load("exam", members)).size, 65);
assert.equal(bounded.calls.length, 65);
assert.equal(
  bounded.maxActive(),
  20,
  "document concurrency must stay bounded at twenty",
);

let fail = true;
const recover = createHarness(async (uid, rosterId) => {
  if (fail) throw new Error("fixture server unavailable");
  return value(uid, rosterId);
});
await assert.rejects(
  recover.load("exam", ["a", "b"]),
  /fixture server unavailable/,
);
assert.equal(recover.cache.current.has("exam"), false);
assert.equal(recover.pending.current.has("exam"), false);
fail = false;
assert.equal((await recover.load("exam", ["a", "b"])).size, 2);
assert.equal(
  recover.calls.length,
  4,
  "failed reads must retry rather than become cached unsigned results",
);

let finishOld;
const oldGate = new Promise((resolve) => {
  finishOld = resolve;
});
const invalidated = createHarness(async (uid, rosterId) => {
  await oldGate;
  return value(uid, rosterId);
});
const oldRequest = invalidated.load("exam", ["a"]);
invalidated.cache.current.delete("exam");
invalidated.pending.current.delete("exam");
finishOld();
await oldRequest;
assert.equal(
  invalidated.cache.current.has("exam"),
  false,
  "an invalidated in-flight request must not restore stale cache data",
);
await invalidated.load("exam", ["a"]);
assert.equal(invalidated.calls.length, 2);

console.log(
  "PASS teacher confirmation reads: exact roster UID scope; deduplicated cache/in-flight reads; server errors and retry; 20 concurrent reads; invalidation race",
);
