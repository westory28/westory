import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/lib/writtenExamAnalysisCache.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
let now = 1_800_000_000_000;
const values = new Map();
let blocked = false;
let expiryCallback;
const sessionStorage = {
  get length() {
    return values.size;
  },
  key: (i) => [...values.keys()][i] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    if (blocked) throw new Error("quota");
    values.set(key, value);
  },
  removeItem: (key) => values.delete(key),
};
function openTab() {
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    window: { sessionStorage },
    Date: { now: () => now },
    setTimeout: (callback) => {
      expiryCallback = callback;
      return 1;
    },
    clearTimeout: () => {
      expiryCallback = undefined;
    },
    console,
  });
  return module.exports;
}
let cache = openTab();
const write = (scope, exam, key, value = { students: 284 }) =>
  cache.writeWrittenExamAnalysisCache(
    scope,
    exam,
    key,
    value,
    cache.writtenExamAnalysisCacheRevision(),
  );
const read = (scope, key) => cache.readWrittenExamAnalysisCache(scope, key);
write("teacher-a:2026-2", "exam-a", "room-1");
assert.equal(read("teacher-a:2026-2", "room-1").students, 284);
cache = openTab();
assert.equal(
  read("teacher-a:2026-2", "room-1").students,
  284,
  "Reload reuses browser storage",
);
assert.equal(
  read("teacher-b:2026-2", "room-1"),
  null,
  "Another account cannot reuse a snapshot",
);
assert.equal(values.size, 0, "The old account snapshot is removed");
for (const otherScope of ["teacher-a:2027-1", "teacher-a:2026-2:revoked"]) {
  write("teacher-a:2026-2", "exam-a", "room-1");
  assert.equal(
    read(otherScope, "room-1"),
    null,
    "Semester and permission changes isolate snapshots",
  );
}
write("teacher-a", "exam-a", "objective");
write("teacher-a", "exam-a", "essay");
write("teacher-a", "exam-b", "other");
const oldRevision = cache.writtenExamAnalysisCacheRevision();
cache.invalidateWrittenExamAnalysisCache("exam-a");
assert.equal(read("teacher-a", "objective"), null);
assert.equal(read("teacher-a", "essay"), null);
assert.equal(read("teacher-a", "other").students, 284);
cache.writeWrittenExamAnalysisCache(
  "teacher-a",
  "exam-a",
  "late",
  {},
  oldRevision,
);
assert.equal(
  read("teacher-a", "late"),
  null,
  "A response started before invalidation cannot repopulate storage",
);
now += 10 * 60 * 1000;
expiryCallback?.();
assert.equal(
  values.size,
  0,
  "Expiry removes stored student data without another analysis read",
);
assert.equal(
  read("teacher-a", "other"),
  null,
  "Ten-minute expiry forces a new server read",
);
write("teacher-a", "exam-a", "partial", { mock: null });
now += 9 * 60 * 1000;
const saveRecoveredMock = () =>
  cache.writeWrittenExamAnalysisCache(
    "teacher-a",
    "exam-a",
    "partial",
    { mock: "recovered" },
    cache.writtenExamAnalysisCacheRevision(),
    true,
  );
saveRecoveredMock();
assert.equal(read("teacher-a", "partial").mock, "recovered");
now += 60 * 1000;
assert.equal(
  read("teacher-a", "partial"),
  null,
  "A recovered comparison cannot extend the score TTL",
);
saveRecoveredMock();
assert.equal(
  read("teacher-a", "partial"),
  null,
  "An expired score snapshot cannot be recreated by a late comparison",
);
for (let i = 0; i < 20; i++) write("teacher-a", "exam-a", "room-" + i);
assert.ok(values.size <= 6, "Storage growth is bounded");
assert.equal(read("teacher-a", "room-0"), null);
cache.invalidateWrittenExamAnalysisCache();
assert.equal(values.size, 0, "Logout erases all analysis snapshots");
values.set("westory:written-analysis:v1:broken", "not json");
assert.equal(read("teacher-a", "broken"), null);
assert.equal(values.size, 0, "Corrupt entries are removed");
blocked = true;
write("teacher-a", "exam-a", "memory");
assert.equal(
  read("teacher-a", "memory").students,
  284,
  "Storage failure keeps a bounded in-memory fallback",
);
cache.invalidateWrittenExamAnalysisCache();
assert.equal(read("teacher-a", "memory"), null);
write("teacher-a", "exam-a", "large", "x".repeat(3 * 1024 * 1024 + 1));
assert.equal(
  read("teacher-a", "large"),
  null,
  "Oversized snapshots do not fill storage",
);
console.log(
  "PASS written analysis browser cache: reload, account/semester/permission boundaries, expiry, per-exam invalidation, late response, bounds, corruption and quota recovery",
);
