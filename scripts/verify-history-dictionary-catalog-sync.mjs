/** Pure in-memory verification. No credentials, Firestore client or network. */
import assert from "node:assert/strict";
import {
  COLLECTION,
  MANAGED_BY,
  SCHEMA_VERSION,
  canonicalJson,
  sha256,
  loadCatalogSource,
  validateCatalogSource,
  catalogDocumentFor,
  planCatalogSync,
  applyCatalogSyncPlan,
  parseCatalogSyncArgs,
  runCatalogSync,
  safeErrorCode,
} from "./sync-history-dictionary-catalog.mjs";

const clone = (value) => structuredClone(value);
const stamp = (seconds) => ({ seconds, nanoseconds: 0 });
const timeMarker = Object.freeze({ __serverTimestamp: true });
const deleteMarker = Object.freeze({ __deleteField: true });
const transforms = {
  serverTimestamp: () => timeMarker,
  deleteField: () => deleteMarker,
};
const options = (apply = false) => ({
  projectId: "demo-dictionary-catalog-sync",
  apply,
  expectedSourceHash: "",
  expectedPlanHash: "",
});
const fixtureDb = (initial = new Map()) => {
  const data = new Map([...initial].map(([id, record]) => [id, clone(record)]));
  const state = {
    commits: 0,
    readPaths: [],
    writes: [],
    beforeCommit: null,
    clock: 100,
  };
  const db = {
    collection: (collection) => {
      assert.equal(collection, COLLECTION, "Touched an unrelated collection");
      return { doc: (id) => ({ id, path: `${collection}/${id}` }) };
    },
    getAll: async (...refs) =>
      refs.map((ref) => {
        state.readPaths.push(ref.path);
        const record = data.get(ref.id);
        return {
          exists: Boolean(record),
          data: () => clone(record?.data),
          updateTime: record?.updateTime,
        };
      }),
    batch: () => {
      const writes = [];
      return {
        create: (ref, fields) => writes.push({ type: "create", ref, fields }),
        update: (ref, fields, precondition) =>
          writes.push({ type: "update", ref, fields, precondition }),
        commit: async () => {
          if (state.beforeCommit) state.beforeCommit(writes);
          // Validate the whole batch before any writes, as Firestore does.
          for (const write of writes) {
            const current = data.get(write.ref.id);
            const conflict =
              write.type === "create"
                ? Boolean(current)
                : !current ||
                  canonicalJson(current.updateTime) !==
                    canonicalJson(write.precondition?.lastUpdateTime);
            if (conflict) {
              const error = new Error("PRIVATE DATABASE VALUE");
              error.code = 9;
              throw error;
            }
          }
          const now = stamp(++state.clock);
          for (const write of writes) {
            const fields =
              write.type === "update" ? clone(data.get(write.ref.id).data) : {};
            for (const [key, value] of Object.entries(write.fields)) {
              if (value === deleteMarker) delete fields[key];
              else fields[key] = value === timeMarker ? now : clone(value);
            }
            data.set(write.ref.id, { data: fields, updateTime: now });
            state.writes.push(write);
          }
          state.commits++;
        },
      };
    },
  };
  return { db, data, state };
};
const errorCode = (expected) => (error) => error.code === expected;
const source = await loadCatalogSource();
assert.deepEqual(source.counts, {
  total: 3367,
  history: 1125,
  places: 2242,
  attributions: 4863,
});
assert.match(source.sourceHash, /^[a-f0-9]{64}$/u);
assert.match(source.sourceBundleHash, /^[a-f0-9]{64}$/u);
assert.equal(
  sha256(
    canonicalJson(
      [...source.terms].sort((a, b) => a.id.localeCompare(b.id, "en")),
    ),
  ),
  source.sourceHash,
);
assert.equal(new Set(source.terms.map((term) => term.id)).size, 3367);
assert.equal(
  source.terms.filter((term) => term.word === "안양").length,
  2,
  "Homonymous places collapsed",
);
assert.equal(source.terms.filter((term) => term.word === "고려").length, 3);
for (const term of source.terms) {
  const document = catalogDocumentFor(term);
  for (const [key, value] of Object.entries(term))
    assert.deepEqual(document[key], value, `${term.id}: source field lost`);
  assert.equal(document.contentHash, sha256(canonicalJson(term)));
  assert.equal(document.schemaVersion, SCHEMA_VERSION);
  assert.equal(document.managedBy, MANAGED_BY);
}

// CLI never infers a target or accidentally enables writes.
assert.equal(
  parseCatalogSyncArgs(["--project", "demo-catalog-sync"]).apply,
  false,
);
assert.equal(
  parseCatalogSyncArgs(["--project=demo-catalog-sync", "--apply"]).apply,
  true,
);
assert.equal(parseCatalogSyncArgs(["--help"]).help, true);
assert.throws(
  () => parseCatalogSyncArgs([]),
  errorCode("CATALOG_EXPLICIT_PROJECT_REQUIRED"),
);
assert.throws(
  () => parseCatalogSyncArgs(["--project=x", "--apply"]),
  errorCode("CATALOG_EXPLICIT_PROJECT_REQUIRED"),
);
assert.throws(
  () =>
    parseCatalogSyncArgs([
      "--project=demo-catalog-sync",
      "--apply",
      "--dry-run",
    ]),
  errorCode("CATALOG_MODE_CONFLICT"),
);
assert.throws(
  () => parseCatalogSyncArgs(["--project=demo-catalog-sync", "--apply=true"]),
  errorCode("CATALOG_ARGUMENT_INVALID"),
);
assert.throws(
  () => parseCatalogSyncArgs(["--project=demo-catalog-sync", "--delete"]),
  errorCode("CATALOG_ARGUMENT_INVALID"),
);
assert.throws(
  () =>
    parseCatalogSyncArgs([
      "--project=demo-catalog-sync",
      "--expect-plan-sha=abc",
    ]),
  errorCode("CATALOG_HASH_ARGUMENT_INVALID"),
);
assert.throws(
  () => canonicalJson({ missing: undefined }),
  errorCode("CATALOG_NON_JSON_VALUE"),
);
assert.throws(
  () => validateCatalogSource(source.terms.slice(1)),
  errorCode("CATALOG_SOURCE_COUNT_MISMATCH"),
);
const damaged = clone(source.terms);
damaged[0].attributions[0].changes = "";
assert.throws(
  () => validateCatalogSource(damaged),
  errorCode("CATALOG_SOURCE_ATTRIBUTION_INCOMPLETE"),
);
assert.equal(
  safeErrorCode({ code: "private-secret-value", message: "token" }),
  "UNKNOWN_ERROR",
);
assert.equal(safeErrorCode({ code: 9 }), "9");

const unrelatedId = "teacher-created-record";
const unrelated = {
  data: { word: "PRIVATE DATABASE VALUE", ownerUid: "private-owner" },
  updateTime: stamp(1),
};
const all = fixtureDb(new Map([[unrelatedId, unrelated]]));
const reports = [];
const dry = await runCatalogSync({
  db: all.db,
  source,
  options: options(),
  ...transforms,
  report: (line) => reports.push(line),
});
assert.deepEqual(dry.counts, {
  create: 3367,
  update: 0,
  unchanged: 0,
  conflict: 0,
});
assert.equal(all.state.commits, 0);
assert.equal(all.state.writes.length, 0);
assert.equal(all.data.size, 1);
const applied = await runCatalogSync({
  db: all.db,
  source,
  options: {
    ...options(true),
    expectedSourceHash: source.sourceHash,
    expectedPlanHash: dry.planHash,
  },
  ...transforms,
  report: (line) => reports.push(line),
});
assert.equal(applied.verified, true);
assert.deepEqual(applied.applied, { create: 3367, update: 0, batches: 17 });
assert.deepEqual(
  all.data.get(unrelatedId),
  unrelated,
  "Unrelated user record changed",
);
assert(
  all.state.readPaths.every((path) =>
    path.startsWith(`${COLLECTION}/catalog-`),
  ),
);
for (const term of source.terms) {
  const stored = all.data.get(term.id).data;
  for (const [key, value] of Object.entries(term))
    assert.deepEqual(stored[key], value);
  assert.equal(stored.contentHash, sha256(canonicalJson(term)));
  assert(stored.updatedAt.seconds > 0);
}
const beforeRepeat = all.state.commits;
const repeat = await runCatalogSync({
  db: all.db,
  source,
  options: options(true),
  ...transforms,
  report: (line) => reports.push(line),
});
assert.equal(repeat.counts.unchanged, 3367);
assert.equal(
  all.state.commits,
  beforeRepeat,
  "Idempotent re-run wrote documents",
);
assert(
  reports.every(
    (line) =>
      !line.includes("PRIVATE DATABASE VALUE") &&
      !line.includes("private-owner") &&
      !line.includes('"definition"') &&
      !line.includes('"author"'),
  ),
);

// Owned differences are repaired with CAS; unknown extension fields survive.
const first = source.terms.find((term) => term.kind === "history");
const existing = all.data.get(first.id);
existing.data.definition = "관리 대상의 오래된 뜻풀이";
existing.data.contentHash = catalogDocumentFor(first).contentHash; // A stale/forged stored hash must not hide the difference.
existing.data.editorNote = "preserve this extension";
existing.data.atlasPlaceId = "obsolete-optional-field";
const repaired = await runCatalogSync({
  db: all.db,
  source,
  options: options(true),
  ...transforms,
  report: () => {},
});
assert.equal(repaired.applied.update, 1);
assert.equal(all.data.get(first.id).data.editorNote, "preserve this extension");
assert(!Object.hasOwn(all.data.get(first.id).data, "atlasPlaceId"));
assert.equal(all.data.get(first.id).data.definition, first.definition);

// A foreign ownership marker blocks the entire plan before a single write.
const conflictDb = fixtureDb(
  new Map([
    [
      first.id,
      {
        data: {
          ...catalogDocumentFor(first),
          managedBy: "someone-else",
          updatedAt: stamp(1),
        },
        updateTime: stamp(1),
      },
    ],
  ]),
);
await assert.rejects(
  runCatalogSync({
    db: conflictDb.db,
    source,
    options: options(true),
    ...transforms,
    report: () => {},
  }),
  errorCode("CATALOG_PLAN_CONFLICT"),
);
assert.equal(conflictDb.state.writes.length, 0);
assert.equal(conflictDb.state.commits, 0);
const smallTerms = [first];
const asExisting = (record) =>
  new Map([[first.id, { exists: true, ...record }]]);
assert.equal(
  planCatalogSync(
    smallTerms,
    asExisting({
      data: { ...catalogDocumentFor(first), schemaVersion: 2 },
      updateTime: stamp(1),
    }),
  ).counts.conflict,
  1,
);
assert.equal(
  planCatalogSync(smallTerms, asExisting({ data: catalogDocumentFor(first) }))
    .counts.conflict,
  1,
);

// Both create races and update races abort atomically without overwriting.
const createRace = fixtureDb();
const createPlan = planCatalogSync(smallTerms, new Map());
createRace.state.beforeCommit = () =>
  createRace.data.set(first.id, clone(unrelated));
await assert.rejects(
  applyCatalogSyncPlan({ db: createRace.db, plan: createPlan, ...transforms }),
  (error) =>
    error.code === "CATALOG_BATCH_COMMIT_FAILED" &&
    error.applied.create === 0 &&
    error.causeCode === "9",
);
assert.deepEqual(createRace.data.get(first.id), unrelated);
const old = {
  data: {
    ...catalogDocumentFor(first),
    definition: "old",
    updatedAt: stamp(1),
  },
  updateTime: stamp(1),
};
const updateRace = fixtureDb(new Map([[first.id, old]]));
const updatePlan = planCatalogSync(smallTerms, asExisting(old));
updateRace.state.beforeCommit = () => {
  updateRace.data.get(first.id).updateTime = stamp(2);
  updateRace.data.get(first.id).data.definition = "concurrent edit";
};
await assert.rejects(
  applyCatalogSyncPlan({ db: updateRace.db, plan: updatePlan, ...transforms }),
  errorCode("CATALOG_BATCH_COMMIT_FAILED"),
);
assert.equal(updateRace.data.get(first.id).data.definition, "concurrent edit");
const tampered = planCatalogSync(smallTerms, new Map());
tampered.actions[0].document.definition = "changed after planning";
await assert.rejects(
  applyCatalogSyncPlan({ db: fixtureDb().db, plan: tampered, ...transforms }),
  errorCode("CATALOG_PLAN_CONTENT_CHANGED"),
);
const hashes = fixtureDb();
await assert.rejects(
  runCatalogSync({
    db: hashes.db,
    source,
    options: { ...options(true), expectedSourceHash: "0".repeat(64) },
    ...transforms,
    report: () => {},
  }),
  errorCode("CATALOG_SOURCE_HASH_CHANGED"),
);
assert.equal(hashes.state.readPaths.length, 0);
await assert.rejects(
  runCatalogSync({
    db: hashes.db,
    source,
    options: { ...options(true), expectedPlanHash: "0".repeat(64) },
    ...transforms,
    report: () => {},
  }),
  errorCode("CATALOG_PLAN_HASH_CHANGED"),
);
assert.equal(hashes.state.commits, 0);

// A later failed batch reports earlier committed writes for safe re-planning.
const partial = fixtureDb();
const twoTerms = source.terms.slice(0, 2);
const partialPlan = planCatalogSync(twoTerms, new Map());
partial.state.beforeCommit = (writes) => {
  if (partial.state.commits === 1)
    partial.data.set(writes[0].ref.id, clone(unrelated));
};
await assert.rejects(
  applyCatalogSyncPlan({
    db: partial.db,
    plan: partialPlan,
    batchSize: 1,
    ...transforms,
  }),
  (error) =>
    error.code === "CATALOG_BATCH_COMMIT_FAILED" &&
    error.applied.create === 1 &&
    error.applied.batches === 1,
);
console.log(
  JSON.stringify({
    pass: true,
    ...source.counts,
    sourceHash: source.sourceHash,
    sourceBundleHash: source.sourceBundleHash,
    checks:
      "full source/attribution preservation, stable homonym IDs, dry run, ownership, SHA binding, create/update CAS, idempotence, unrelated-record preservation, partial failure accounting, safe errors",
    network: false,
  }),
);
