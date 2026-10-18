/** Durable, immutable catalog chunks. This module never reads or edits user data. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const SNAPSHOT_COLLECTION = "history_dictionary_catalog_snapshots";
export const SNAPSHOT_MANAGED_BY = "westory-history-dictionary-catalog";
export const SNAPSHOT_CHUNK_CHARACTERS = 700_000;
export const SNAPSHOT_MAX_RAW_BYTES = 16 * 1024 * 1024;
export const SNAPSHOT_MAX_ITEMS = 20_000;
export const SNAPSHOT_MAX_CHUNKS = 32;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const timestampKey = (value) =>
  value &&
  Number.isSafeInteger(value.seconds) &&
  Number.isSafeInteger(value.nanoseconds) &&
  value.nanoseconds >= 0 &&
  value.nanoseconds < 1e9
    ? `${value.seconds}:${value.nanoseconds}`
    : null;
const compareIds = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const managementFields = [
  "schemaVersion",
  "managedBy",
  "contentHash",
  "updatedAt",
];

export function prepareCatalogSnapshot(
  terms,
  { sourceHash, sourceBundleHash } = {},
) {
  if (
    !Array.isArray(terms) ||
    !terms.length ||
    terms.length > SNAPSHOT_MAX_ITEMS
  )
    fail("CATALOG_SNAPSHOT_ITEM_COUNT_INVALID");
  const ids = new Set();
  for (const term of terms) {
    if (
      !term ||
      typeof term.id !== "string" ||
      !term.id.startsWith("catalog-") ||
      /[/\\\x00-\x1f\x7f]/u.test(term.id) ||
      ids.has(term.id) ||
      managementFields.some((key) => Object.hasOwn(term, key))
    )
      fail("CATALOG_SNAPSHOT_ITEM_INVALID");
    ids.add(term.id);
  }
  // loadCatalogSource has already canonicalized object keys. Preserve every
  // catalog field and array; only item ordering changes to the reader contract.
  const items = [...terms].sort(compareIds);
  const raw = Buffer.from(JSON.stringify(items), "utf8");
  if (raw.length > SNAPSHOT_MAX_RAW_BYTES) fail("CATALOG_SNAPSHOT_TOO_LARGE");
  const version = digest(raw);
  const compressed = gzipSync(raw, { level: 9 });
  const encoded = compressed.toString("base64");
  const chunks = [];
  for (
    let offset = 0;
    offset < encoded.length;
    offset += SNAPSHOT_CHUNK_CHARACTERS
  ) {
    const index = chunks.length;
    chunks.push({
      id: `${version}-${index}`,
      document: {
        schemaVersion: 1,
        version,
        index,
        data: encoded.slice(offset, offset + SNAPSHOT_CHUNK_CHARACTERS),
      },
    });
  }
  if (chunks.length > SNAPSHOT_MAX_CHUNKS)
    fail("CATALOG_SNAPSHOT_TOO_MANY_CHUNKS");
  return {
    manifest: {
      schemaVersion: 1,
      version,
      count: items.length,
      totalRawBytes: raw.length,
      encoding: "gzip-base64",
      chunkIds: chunks.map((chunk) => chunk.id),
      managedBy: SNAPSHOT_MANAGED_BY,
      ...(sourceHash ? { sourceHash } : {}),
      ...(sourceBundleHash ? { sourceBundleHash } : {}),
    },
    chunks,
    compressedBytes: compressed.length,
    encodedCharacters: encoded.length,
  };
}

const exactChunk = (data, expected) =>
  data &&
  Object.keys(data).length === 4 &&
  ["schemaVersion", "version", "index", "data"].every(
    (key) => data[key] === expected[key],
  );
const matchesManifest = (actual, expected) =>
  actual &&
  [
    "schemaVersion",
    "version",
    "count",
    "totalRawBytes",
    "encoding",
    "managedBy",
  ].every((key) => actual[key] === expected[key]) &&
  JSON.stringify(actual.chunkIds) === JSON.stringify(expected.chunkIds);

export async function readCatalogSnapshotManifest(db) {
  const [snapshot] = await db.getAll(
    db.collection(SNAPSHOT_COLLECTION).doc("current"),
  );
  const data = snapshot.exists ? snapshot.data() : null;
  if (
    snapshot.exists &&
    (data?.managedBy !== SNAPSHOT_MANAGED_BY ||
      data.schemaVersion !== 1 ||
      !timestampKey(snapshot.updateTime))
  )
    fail("CATALOG_SNAPSHOT_MANIFEST_CONFLICT");
  return { exists: snapshot.exists, data, updateTime: snapshot.updateTime };
}

const readChunks = async (db, chunks) => {
  const documents = [];
  // Keep each BatchGet response comfortably below Firestore's request limits.
  for (let offset = 0; offset < chunks.length; offset += 8) {
    const group = chunks.slice(offset, offset + 8);
    const snapshots = await db.getAll(
      ...group.map((chunk) => db.collection(SNAPSHOT_COLLECTION).doc(chunk.id)),
    );
    snapshots.forEach((snapshot, index) =>
      documents.push({
        chunk: group[index],
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
      }),
    );
  }
  return documents;
};

/** Readback must reconstruct the exact raw payload before current can change. */
export function verifyCatalogSnapshotChunks(prepared, documents) {
  if (
    documents.length !== prepared.chunks.length ||
    documents.some(
      ({ chunk, exists, data }, index) =>
        !exists ||
        chunk.id !== prepared.manifest.chunkIds[index] ||
        !exactChunk(data, chunk.document),
    )
  )
    fail("CATALOG_SNAPSHOT_CHUNK_VERIFICATION_FAILED");
  let raw;
  try {
    raw = gunzipSync(
      Buffer.from(documents.map(({ data }) => data.data).join(""), "base64"),
      { maxOutputLength: SNAPSHOT_MAX_RAW_BYTES },
    );
  } catch {
    fail("CATALOG_SNAPSHOT_DECOMPRESSION_FAILED");
  }
  if (
    raw.length !== prepared.manifest.totalRawBytes ||
    digest(raw) !== prepared.manifest.version
  )
    fail("CATALOG_SNAPSHOT_HASH_MISMATCH");
  const items = JSON.parse(raw.toString("utf8"));
  if (
    items.length !== prepared.manifest.count ||
    items.some(
      (item, index) => index > 0 && compareIds(items[index - 1], item) >= 0,
    )
  )
    fail("CATALOG_SNAPSHOT_ITEM_ORDER_INVALID");
  return items;
}

export async function publishCatalogSnapshot({
  db,
  prepared,
  baseline,
  serverTimestamp,
}) {
  if (!baseline) fail("CATALOG_SNAPSHOT_BASELINE_REQUIRED");
  // Validate the prepared plan itself before writing any document.
  verifyCatalogSnapshotChunks(
    prepared,
    prepared.chunks.map((chunk) => ({
      chunk,
      exists: true,
      data: chunk.document,
    })),
  );
  let existing = await readChunks(db, prepared.chunks);
  if (
    existing.some(
      ({ exists, data, chunk }) => exists && !exactChunk(data, chunk.document),
    )
  )
    fail("CATALOG_SNAPSHOT_IMMUTABLE_CHUNK_CONFLICT");
  let createdChunks = 0;
  for (let offset = 0; offset < existing.length; offset += 8) {
    let pending = existing
      .slice(offset, offset + 8)
      .filter((item) => !item.exists);
    // A same-version publisher may create a chunk between the read and create.
    // Re-read on ALREADY_EXISTS; never overwrite a content-addressed document.
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      const batch = db.batch();
      for (const { chunk } of pending)
        batch.create(
          db.collection(SNAPSHOT_COLLECTION).doc(chunk.id),
          chunk.document,
        );
      try {
        await batch.commit();
        createdChunks += pending.length;
        pending = [];
      } catch (error) {
        if (error?.code !== 6 && error?.code !== "already-exists")
          fail("CATALOG_SNAPSHOT_CHUNK_WRITE_FAILED");
        const raced = await readChunks(
          db,
          pending.map(({ chunk }) => chunk),
        );
        if (
          raced.some(
            ({ exists, data, chunk }) =>
              exists && !exactChunk(data, chunk.document),
          )
        )
          fail("CATALOG_SNAPSHOT_IMMUTABLE_CHUNK_CONFLICT");
        pending = raced.filter((item) => !item.exists);
      }
    }
    if (pending.length) fail("CATALOG_SNAPSHOT_CHUNK_WRITE_FAILED");
  }
  existing = await readChunks(db, prepared.chunks);
  verifyCatalogSnapshotChunks(prepared, existing);
  const current = await readCatalogSnapshotManifest(db);
  if (matchesManifest(current.data, prepared.manifest))
    return {
      published: false,
      verified: true,
      createdChunks,
      ...snapshotSummary(prepared),
    };
  if (
    current.exists !== baseline.exists ||
    timestampKey(current.updateTime) !== timestampKey(baseline.updateTime)
  )
    fail("CATALOG_SNAPSHOT_MANIFEST_CHANGED");
  const batch = db.batch();
  const ref = db.collection(SNAPSHOT_COLLECTION).doc("current");
  const data = { ...prepared.manifest, updatedAt: serverTimestamp() };
  if (baseline.exists)
    batch.update(ref, data, { lastUpdateTime: baseline.updateTime });
  else batch.create(ref, data);
  try {
    await batch.commit();
  } catch {
    // Another publisher may have completed the identical version. It is safe
    // to accept that result, but never retry by replacing a different version.
    const raced = await readCatalogSnapshotManifest(db);
    if (!matchesManifest(raced.data, prepared.manifest))
      fail("CATALOG_SNAPSHOT_MANIFEST_WRITE_FAILED");
  }
  const verified = await readCatalogSnapshotManifest(db);
  if (!matchesManifest(verified.data, prepared.manifest))
    fail("CATALOG_SNAPSHOT_MANIFEST_VERIFICATION_FAILED");
  return {
    published: true,
    verified: true,
    createdChunks,
    ...snapshotSummary(prepared),
  };
}

export const snapshotSummary = (prepared) => ({
  collection: SNAPSHOT_COLLECTION,
  version: prepared.manifest.version,
  count: prepared.manifest.count,
  totalRawBytes: prepared.manifest.totalRawBytes,
  encoding: prepared.manifest.encoding,
  chunks: prepared.chunks.length,
  compressedBytes: prepared.compressedBytes,
  encodedCharacters: prepared.encodedCharacters,
});
