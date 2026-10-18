/** In-memory Firestore fixture; no credentials, network or production writes. */
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  COLLECTION,
  catalogDocumentFor,
  canonicalJson,
  loadCatalogSource,
  parseCatalogSyncArgs,
  runCatalogSyncWithSnapshot,
  sha256,
} from "./sync-history-dictionary-catalog.mjs";
import {
  SNAPSHOT_COLLECTION,
  SNAPSHOT_CHUNK_CHARACTERS,
  SNAPSHOT_MAX_RAW_BYTES,
  prepareCatalogSnapshot,
  publishCatalogSnapshot,
  readCatalogSnapshotManifest,
  verifyCatalogSnapshotChunks,
} from "./history-dictionary-catalog-snapshot.mjs";

const clone = (value) => structuredClone(value);
const stamp = (seconds) => ({ seconds, nanoseconds: 0 });
const timeMarker = Object.freeze({ serverTimestamp: true });
const deleteMarker = Object.freeze({ deleteField: true });
const transforms = {
  serverTimestamp: () => timeMarker,
  deleteField: () => deleteMarker,
};
const errorCode = (code) => (error) => error.code === code;
const currentPath = `${SNAPSHOT_COLLECTION}/current`;
const pathFor = (id) => `${SNAPSHOT_COLLECTION}/${id}`;
const record = (data, seconds = 1) => ({
  data: clone(data),
  updateTime: stamp(seconds),
});

const fixtureDb = (initial = new Map()) => {
  const data = new Map(
    [...initial].map(([path, value]) => [path, clone(value)]),
  );
  const state = {
    reads: [],
    writes: [],
    beforeRead: null,
    beforeCommit: null,
    clock: 100,
  };
  const db = {
    collection: (collection) => {
      assert([COLLECTION, SNAPSHOT_COLLECTION].includes(collection));
      return { doc: (id) => ({ id, path: `${collection}/${id}` }) };
    },
    getAll: async (...refs) => {
      state.beforeRead?.(refs);
      return refs.map((ref) => {
        state.reads.push(ref.path);
        const found = data.get(ref.path);
        return {
          exists: Boolean(found),
          data: () => clone(found?.data),
          updateTime: found?.updateTime,
        };
      });
    },
    batch: () => {
      const writes = [];
      return {
        create: (ref, fields) => writes.push({ type: "create", ref, fields }),
        update: (ref, fields, precondition) =>
          writes.push({ type: "update", ref, fields, precondition }),
        commit: async () => {
          state.beforeCommit?.(writes);
          for (const write of writes) {
            const current = data.get(write.ref.path);
            const conflict =
              write.type === "create"
                ? Boolean(current)
                : !current ||
                  canonicalJson(current.updateTime) !==
                    canonicalJson(write.precondition?.lastUpdateTime);
            if (conflict) {
              const error = new Error(
                "PRIVATE ERROR MUST NOT APPEAR IN REPORTS",
              );
              error.code = write.type === "create" ? 6 : 9;
              throw error;
            }
          }
          const now = stamp(++state.clock);
          for (const write of writes) {
            const fields =
              write.type === "update"
                ? clone(data.get(write.ref.path).data)
                : {};
            for (const [key, value] of Object.entries(write.fields)) {
              if (value === deleteMarker) delete fields[key];
              else fields[key] = value === timeMarker ? now : clone(value);
            }
            data.set(write.ref.path, { data: fields, updateTime: now });
            state.writes.push(write);
          }
        },
      };
    },
  };
  return { db, data, state };
};
const seedSnapshot = (prepared) =>
  new Map([
    [currentPath, record({ ...prepared.manifest, updatedAt: stamp(1) })],
    ...prepared.chunks.map((chunk) => [
      pathFor(chunk.id),
      record(chunk.document),
    ]),
  ]);

const source = await loadCatalogSource();
const prepared = prepareCatalogSnapshot(source.terms, source);
const decoded = verifyCatalogSnapshotChunks(
  prepared,
  prepared.chunks.map((chunk) => ({
    chunk,
    exists: true,
    data: chunk.document,
  })),
);
assert.equal(decoded.length, 3367);
const sorted = [...source.terms].sort((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);
assert.deepEqual(
  decoded,
  sorted,
  "A definition, facet, alias or attribution was lost",
);
assert.equal(prepared.manifest.version, sha256(JSON.stringify(sorted)));
assert.equal(
  prepared.manifest.totalRawBytes,
  Buffer.byteLength(JSON.stringify(sorted)),
);
assert(
  prepared.chunks.every(
    (chunk) => chunk.document.data.length <= SNAPSHOT_CHUNK_CHARACTERS,
  ),
);
assert.equal(prepared.encodedCharacters % 4, 0);
assert.deepEqual(
  prepareCatalogSnapshot([...source.terms].reverse(), source),
  prepared,
);
assert.throws(
  () => prepareCatalogSnapshot([source.terms[0], source.terms[0]]),
  errorCode("CATALOG_SNAPSHOT_ITEM_INVALID"),
);
assert.throws(
  () =>
    prepareCatalogSnapshot([
      {
        id: "catalog-history-big",
        definition: "x".repeat(SNAPSHOT_MAX_RAW_BYTES),
      },
    ]),
  errorCode("CATALOG_SNAPSHOT_TOO_LARGE"),
);
assert.throws(
  () =>
    prepareCatalogSnapshot(
      Array.from({ length: 20_001 }, (_, index) => ({
        id: `catalog-history-${index}`,
      })),
    ),
  errorCode("CATALOG_SNAPSHOT_ITEM_COUNT_INVALID"),
);
const binaryOrder = prepareCatalogSnapshot([
  { id: "catalog-history-a" },
  { id: "catalog-history-Z" },
]);
assert.equal(
  JSON.parse(
    gunzipSync(Buffer.from(binaryOrder.chunks[0].document.data, "base64")),
  )[0].id,
  "catalog-history-Z",
);

// Exercise a real multi-chunk gzip stream, including a boundary inside base64.
const noisy = Array.from({ length: 45_000 }, (_, index) =>
  sha256(String(index)),
).join("");
const multi = prepareCatalogSnapshot([
  { id: "catalog-history-noise", definition: noisy },
]);
assert(multi.chunks.length >= 2);
assert(
  multi.chunks
    .slice(0, -1)
    .every((chunk) => chunk.document.data.length === 700_000),
);
assert.equal(
  verifyCatalogSnapshotChunks(
    multi,
    multi.chunks.map((chunk) => ({
      chunk,
      exists: true,
      data: chunk.document,
    })),
  )[0].definition,
  noisy,
);

const options = {
  projectId: "demo-dictionary-snapshot",
  apply: true,
  snapshotOnly: true,
  expectedSourceHash: source.sourceHash,
  expectedPlanHash: "",
};
assert.equal(
  parseCatalogSyncArgs(["--project", options.projectId, "--snapshot-only"])
    .apply,
  false,
);
assert.equal(
  parseCatalogSyncArgs([
    "--project",
    options.projectId,
    "--snapshot-only",
    "--apply",
  ]).snapshotOnly,
  true,
);
assert.throws(
  () =>
    parseCatalogSyncArgs([
      "--project",
      options.projectId,
      "--snapshot-only=true",
    ]),
  errorCode("CATALOG_ARGUMENT_INVALID"),
);
const originals = new Map(
  source.terms.map((term) => [
    `${COLLECTION}/${term.id}`,
    record({ ...catalogDocumentFor(term), updatedAt: stamp(1) }),
  ]),
);
const fixture = fixtureDb(originals);
const reports = [];
const run = (database, overrides = {}) =>
  runCatalogSyncWithSnapshot({
    db: database,
    source,
    options: { ...options, ...overrides },
    ...transforms,
    report: (line) => reports.push(line),
  });
await run(fixture.db, { apply: false });
assert.equal(fixture.state.writes.length, 0);
fixture.state.reads.length = 0;
const published = await run(fixture.db);
assert(published.snapshot.published && published.snapshot.verified);
assert.equal(
  fixture.state.reads.filter((path) => path.startsWith(`${COLLECTION}/`))
    .length,
  3367,
  "Snapshot-only must read each original once, not perform a second source scan",
);
assert(
  fixture.state.writes.every((write) =>
    write.ref.path.startsWith(`${SNAPSHOT_COLLECTION}/`),
  ),
);
for (const [path, original] of originals)
  assert.deepEqual(fixture.data.get(path), original);
const writesBeforeRepeat = fixture.state.writes.length;
const repeated = await run(fixture.db);
assert.equal(repeated.snapshot.published, false);
assert.equal(
  fixture.state.writes.length,
  writesBeforeRepeat,
  "Idempotent publication wrote documents",
);
assert(
  reports.every(
    (line) =>
      !line.includes('"definition"') &&
      !line.includes('"author"') &&
      !line.includes("PRIVATE"),
  ),
);

// Snapshot-only must not repair mismatched originals or publish local fiction.
const mismatch = fixtureDb(originals);
const firstPath = `${COLLECTION}/${source.terms[0].id}`;
mismatch.data.get(firstPath).data.definition = "Changed independently";
await assert.rejects(
  run(mismatch.db),
  errorCode("CATALOG_SNAPSHOT_SOURCE_MISMATCH"),
);
assert.equal(mismatch.state.writes.length, 0);
assert(!mismatch.data.has(currentPath));

const old = prepareCatalogSnapshot(source.terms.slice(0, 2));
const failed = fixtureDb(seedSnapshot(old));
const baseline = await readCatalogSnapshotManifest(failed.db);
const beforeManifest = clone(failed.data.get(currentPath));
failed.state.beforeRead = (refs) => {
  if (
    failed.state.writes.length &&
    refs.some((ref) => ref.path === pathFor(prepared.chunks[0].id))
  )
    failed.data.get(pathFor(prepared.chunks[0].id)).data.data = "corrupt";
};
await assert.rejects(
  publishCatalogSnapshot({ db: failed.db, prepared, baseline, ...transforms }),
  errorCode("CATALOG_SNAPSHOT_CHUNK_VERIFICATION_FAILED"),
);
assert.deepEqual(
  failed.data.get(currentPath),
  beforeManifest,
  "Failed chunk readback replaced current",
);

const blocked = fixtureDb(seedSnapshot(old));
blocked.data.set(
  pathFor(prepared.chunks[0].id),
  record({ ...prepared.chunks[0].document, data: "foreign-content" }),
);
await assert.rejects(
  publishCatalogSnapshot({
    db: blocked.db,
    prepared,
    baseline: await readCatalogSnapshotManifest(blocked.db),
    ...transforms,
  }),
  errorCode("CATALOG_SNAPSHOT_IMMUTABLE_CHUNK_CONFLICT"),
);
assert.equal(blocked.state.writes.length, 0);
assert.equal(
  blocked.data.get(pathFor(prepared.chunks[0].id)).data.data,
  "foreign-content",
);

const race = fixtureDb(seedSnapshot(old));
const raceBaseline = await readCatalogSnapshotManifest(race.db);
const winner = prepareCatalogSnapshot(source.terms.slice(0, 3));
race.state.beforeCommit = (writes) => {
  if (writes.some((write) => write.ref.path === currentPath)) {
    race.data.set(
      currentPath,
      record({ ...winner.manifest, updatedAt: stamp(900) }, 900),
    );
    race.state.beforeCommit = null;
  }
};
await assert.rejects(
  publishCatalogSnapshot({
    db: race.db,
    prepared,
    baseline: raceBaseline,
    ...transforms,
  }),
  errorCode("CATALOG_SNAPSHOT_MANIFEST_WRITE_FAILED"),
);
assert.equal(
  race.data.get(currentPath).data.version,
  winner.manifest.version,
  "An older publisher replaced the winner",
);

// Same-version chunk creation races are safe and do not mutate the winner's chunk.
const same = fixtureDb();
same.state.beforeCommit = (writes) => {
  const write = writes.find(
    (entry) => entry.ref.path === pathFor(prepared.chunks[0].id),
  );
  if (write) {
    same.data.set(write.ref.path, record(write.fields, 800));
    same.state.beforeCommit = null;
  }
};
await publishCatalogSnapshot({
  db: same.db,
  prepared,
  baseline: await readCatalogSnapshotManifest(same.db),
  ...transforms,
});
assert.equal(
  same.data.get(pathFor(prepared.chunks[0].id)).updateTime.seconds,
  800,
);
assert.equal(
  same.data.get(currentPath).data.version,
  prepared.manifest.version,
);

// A normal apply still updates originals with CAS and verifies them before publication.
const tinySource = {
  terms: source.terms.slice(0, 2),
  counts: { total: 2 },
  sourceHash: "a".repeat(64),
  sourceBundleHash: "b".repeat(64),
};
const normal = fixtureDb();
const normalResult = await runCatalogSyncWithSnapshot({
  db: normal.db,
  source: tinySource,
  options: {
    ...options,
    snapshotOnly: false,
    expectedSourceHash: tinySource.sourceHash,
  },
  ...transforms,
  report: () => {},
});
assert.equal(normalResult.applied.create, 2);
assert(normalResult.verified && normalResult.snapshot.verified);
assert(
  normal.state.writes.findIndex((write) => write.ref.path === currentPath) >
    normal.state.writes.findIndex((write) =>
      write.ref.path.startsWith(`${COLLECTION}/`),
    ),
);

console.log(
  JSON.stringify({
    verified: true,
    sourceItems: decoded.length,
    version: prepared.manifest.version,
    rawBytes: prepared.manifest.totalRawBytes,
    gzipBytes: prepared.compressedBytes,
    base64Characters: prepared.encodedCharacters,
    chunks: prepared.chunks.length,
    snapshotOnlySourceReads: 3367,
    attributionCount: decoded.reduce(
      (count, term) => count + term.attributions.length,
      0,
    ),
    sourceFieldsPreserved: true,
    originalWritesInSnapshotOnly: 0,
  }),
);
