/**
 * Read-only plan by default. Requires an explicit project and ADC credentials.
 * node scripts/sync-history-dictionary-catalog.mjs --project history-quiz-yongsin
 * Add --apply to commit the reviewed plan; --expect-source-sha/--expect-plan-sha
 * can bind that execution to the hashes printed by the dry run.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

export const COLLECTION = "history_dictionary_catalog";
export const MANAGED_BY = "westory-history-dictionary-catalog";
export const SCHEMA_VERSION = 1;
export const EXPECTED_SOURCE_COUNT = 2373;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reservedKeys = new Set([
  "schemaVersion",
  "managedBy",
  "contentHash",
  "updatedAt",
]);
const optionalCatalogKeys = ["atlasPlaceId"];
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

/** Stable JSON, rejecting values that JSON.stringify would silently discard. */
export const canonicalJson = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]"
  )
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return fail("CATALOG_NON_JSON_VALUE");
};
const validId = (id) =>
  typeof id === "string" &&
  /^catalog-(?:history|place)-.+/u.test(id) &&
  !/[/\\\x00-\x1f\x7f]/u.test(id) &&
  Buffer.byteLength(id) <= 1500;
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const stringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const timestampKey = (value) =>
  value &&
  Number.isSafeInteger(value.seconds) &&
  Number.isSafeInteger(value.nanoseconds) &&
  value.nanoseconds >= 0 &&
  value.nanoseconds < 1e9
    ? `${value.seconds}:${value.nanoseconds}`
    : null;

export function validateCatalogSource(
  terms,
  { expectedCount = EXPECTED_SOURCE_COUNT, facetIds } = {},
) {
  if (!Array.isArray(terms) || terms.length !== expectedCount)
    fail("CATALOG_SOURCE_COUNT_MISMATCH");
  const seen = new Set();
  for (const term of terms) {
    if (!term || !validId(term.id) || seen.has(term.id))
      fail("CATALOG_SOURCE_ID_INVALID");
    seen.add(term.id);
    if (Object.keys(term).some((key) => reservedKeys.has(key)))
      fail("CATALOG_RESERVED_SOURCE_FIELD");
    if (
      !nonempty(term.word) ||
      !nonempty(term.definition) ||
      !["history", "place"].includes(term.kind) ||
      !stringArray(term.aliases) ||
      !stringArray(term.tags) ||
      !stringArray(term.facetIds) ||
      !term.facetIds.length ||
      new Set(term.facetIds).size !== term.facetIds.length ||
      (facetIds && term.facetIds.some((id) => !facetIds.has(id)))
    )
      fail("CATALOG_SOURCE_CONTENT_INVALID");
    if (
      term.kind === "place" &&
      (!nonempty(term.atlasPlaceId) ||
        term.id !== `catalog-place-${term.atlasPlaceId}`)
    )
      fail("CATALOG_SOURCE_PLACE_ID_INVALID");
    if (
      term.kind === "history" &&
      term.id !== `catalog-history-${encodeURIComponent(term.word)}`
    )
      fail("CATALOG_SOURCE_HISTORY_ID_INVALID");
    if (!Array.isArray(term.attributions) || !term.attributions.length)
      fail("CATALOG_SOURCE_ATTRIBUTION_MISSING");
    for (const source of term.attributions) {
      if (
        !source ||
        !["title", "author", "changes", "retrievedAt"].every((key) =>
          nonempty(source[key]),
        ) ||
        typeof source.url !== "string"
      )
        fail("CATALOG_SOURCE_ATTRIBUTION_INCOMPLETE");
      if (source.url) {
        let url;
        try {
          url = new URL(source.url);
        } catch {
          fail("CATALOG_SOURCE_URL_INVALID");
        }
        if (url.protocol !== "https:") fail("CATALOG_SOURCE_URL_INVALID");
        if (
          /(^|\.)wikipedia\.org$/u.test(url.hostname) &&
          (source.author !== "위키백과 기여자" ||
            source.license !== "CC BY-SA 4.0" ||
            source.licenseUrl !==
              "https://creativecommons.org/licenses/by-sa/4.0/deed.ko" ||
            !/^\d+$/u.test(url.searchParams.get("oldid") || ""))
        )
          fail("CATALOG_SOURCE_WIKIPEDIA_ATTRIBUTION_INVALID");
      }
      if (source.license && !nonempty(source.licenseUrl))
        fail("CATALOG_SOURCE_LICENSE_URL_MISSING");
    }
    canonicalJson(term);
  }
  return {
    total: terms.length,
    history: terms.filter((term) => term.kind === "history").length,
    places: terms.filter((term) => term.kind === "place").length,
    attributions: terms.reduce(
      (count, term) => count + term.attributions.length,
      0,
    ),
  };
}

export async function loadCatalogSource() {
  // esbuild's temporary in-memory output keeps generated files/credentials out
  // of the checkout. No browser, Firestore or map runtime is imported here.
  const bundle = await build({
    stdin: {
      contents:
        'export { getHistoryDictionaryCatalog } from "./src/lib/historyDictionaryCatalog.ts"; export { historyDictionaryFacets } from "./src/lib/historyDictionaryThemes.ts";',
      resolveDir: root,
      sourcefile: "catalog-sync-source.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    metafile: true,
  });
  if (
    Object.keys(bundle.metafile.inputs).some((path) =>
      /(?:firebase|historyAtlas|boundary)/iu.test(path),
    )
  )
    fail("CATALOG_SOURCE_UNEXPECTED_DEPENDENCY");
  const module = { exports: {} };
  vm.runInNewContext(
    bundle.outputFiles[0].text,
    { module, exports: module.exports },
    { timeout: 10000 },
  );
  const terms = JSON.parse(
    canonicalJson(module.exports.getHistoryDictionaryCatalog()),
  );
  const facets = new Set(
    module.exports.historyDictionaryFacets.map((facet) => facet.id),
  );
  const counts = validateCatalogSource(terms, { facetIds: facets });
  const sourceHash = sha256(
    canonicalJson([...terms].sort((a, b) => a.id.localeCompare(b.id, "en"))),
  );
  return {
    terms,
    counts,
    sourceHash,
    sourceBundleHash: sha256(bundle.outputFiles[0].text),
  };
}

export const catalogDocumentFor = (term) => ({
  ...JSON.parse(canonicalJson(term)),
  schemaVersion: SCHEMA_VERSION,
  managedBy: MANAGED_BY,
  contentHash: sha256(canonicalJson(term)),
});
const remoteContent = (data, term) =>
  Object.fromEntries(
    [...new Set([...Object.keys(term), ...optionalCatalogKeys])]
      .filter((key) => Object.hasOwn(data, key))
      .map((key) => [key, data[key]]),
  );
const planFingerprint = (actions) =>
  sha256(
    canonicalJson(
      actions.map((action) => ({
        id: action.id,
        action: action.action,
        contentHash: action.document.contentHash,
        existingContentHash: action.existingContentHash ?? null,
        updateTime: timestampKey(action.updateTime),
        reason: action.reason ?? null,
        removeFields: action.removeFields,
      })),
    ),
  );

/** existing contains only requested source IDs; unrelated documents are untouched. */
export function planCatalogSync(terms, existing) {
  const actions = [...terms]
    .sort((a, b) => a.id.localeCompare(b.id, "en"))
    .map((term) => {
      const record = existing.get(term.id);
      const document = catalogDocumentFor(term);
      const base = { id: term.id, document, removeFields: [] };
      if (!record?.exists) return { ...base, action: "create" };
      if (record.data?.managedBy !== MANAGED_BY)
        return { ...base, action: "conflict", reason: "unmanaged-document" };
      if (record.data.schemaVersion !== SCHEMA_VERSION)
        return { ...base, action: "conflict", reason: "unsupported-schema" };
      if (!timestampKey(record.updateTime))
        return {
          ...base,
          action: "conflict",
          reason: "missing-write-precondition",
        };
      let existingContentHash;
      try {
        existingContentHash = sha256(
          canonicalJson(remoteContent(record.data, term)),
        );
      } catch {
        return {
          ...base,
          action: "conflict",
          reason: "invalid-managed-content",
        };
      }
      const same =
        existingContentHash === document.contentHash &&
        record.data.contentHash === document.contentHash &&
        timestampKey(record.data.updatedAt);
      return {
        ...base,
        action: same ? "unchanged" : "update",
        updateTime: record.updateTime,
        existingContentHash,
        removeFields: optionalCatalogKeys.filter(
          (key) => !Object.hasOwn(term, key) && Object.hasOwn(record.data, key),
        ),
      };
    });
  const counts = { create: 0, update: 0, unchanged: 0, conflict: 0 };
  const conflictReasons = {};
  for (const action of actions) {
    counts[action.action]++;
    if (action.reason)
      conflictReasons[action.reason] =
        (conflictReasons[action.reason] || 0) + 1;
  }
  return {
    actions,
    counts,
    conflictReasons,
    planHash: planFingerprint(actions),
  };
}

export async function readCatalogDocuments(db, terms) {
  const found = new Map();
  for (let offset = 0; offset < terms.length; offset += 200) {
    const ids = terms.slice(offset, offset + 200).map((term) => term.id);
    if (ids.some((id) => !validId(id))) fail("CATALOG_SOURCE_ID_INVALID");
    const snapshots = await db.getAll(
      ...ids.map((id) => db.collection(COLLECTION).doc(id)),
    );
    snapshots.forEach((snapshot, index) =>
      found.set(ids[index], {
        exists: snapshot.exists,
        ...(snapshot.exists
          ? { data: snapshot.data(), updateTime: snapshot.updateTime }
          : {}),
      }),
    );
  }
  return found;
}

/** Atomic batches use create-if-absent or the exact updateTime from the plan. */
export async function applyCatalogSyncPlan({
  db,
  plan,
  serverTimestamp,
  deleteField,
  batchSize = 200,
}) {
  if (plan.planHash !== planFingerprint(plan.actions))
    fail("CATALOG_PLAN_CHANGED");
  if (plan.actions.some((action) => action.action === "conflict"))
    fail("CATALOG_PLAN_CONFLICT");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200)
    fail("CATALOG_BATCH_SIZE_INVALID");
  const pending = plan.actions.filter((action) =>
    ["create", "update"].includes(action.action),
  );
  const applied = { create: 0, update: 0, batches: 0 };
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = db.batch();
    const actions = pending.slice(offset, offset + batchSize);
    for (const action of actions) {
      if (
        !validId(action.id) ||
        action.document.id !== action.id ||
        action.document.managedBy !== MANAGED_BY ||
        action.document.schemaVersion !== SCHEMA_VERSION
      )
        fail("CATALOG_PLAN_TARGET_INVALID");
      const content = Object.fromEntries(
        Object.entries(action.document).filter(
          ([key]) => !reservedKeys.has(key),
        ),
      );
      if (sha256(canonicalJson(content)) !== action.document.contentHash)
        fail("CATALOG_PLAN_CONTENT_CHANGED");
      if (action.action === "update" && !timestampKey(action.updateTime))
        fail("CATALOG_PLAN_PRECONDITION_MISSING");
      const ref = db.collection(COLLECTION).doc(action.id);
      const data = { ...action.document, updatedAt: serverTimestamp() };
      for (const key of action.removeFields) {
        if (!optionalCatalogKeys.includes(key))
          fail("CATALOG_PLAN_FIELD_INVALID");
        data[key] = deleteField();
      }
      if (action.action === "create") batch.create(ref, data);
      else batch.update(ref, data, { lastUpdateTime: action.updateTime });
    }
    try {
      await batch.commit();
    } catch (error) {
      const failure = new Error("CATALOG_BATCH_COMMIT_FAILED");
      failure.code = "CATALOG_BATCH_COMMIT_FAILED";
      failure.applied = { ...applied };
      failure.causeCode = safeErrorCode(error);
      throw failure;
    }
    for (const action of actions) applied[action.action]++;
    applied.batches++;
  }
  return applied;
}

export function parseCatalogSyncArgs(args) {
  const options = {
    apply: false,
    projectId: "",
    expectedSourceHash: "",
    expectedPlanHash: "",
    help: false,
  };
  let applySeen = false,
    drySeen = false;
  const values = {
    "--project": "projectId",
    "--expect-source-sha": "expectedSourceHash",
    "--expect-plan-sha": "expectedPlanHash",
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const [name, ...inline] = args[index].split("=");
    if (["--apply", "--dry-run", "--help"].includes(name) && !inline.length) {
      if (seen.has(name)) fail("CATALOG_DUPLICATE_ARGUMENT");
      seen.add(name);
      if (name === "--apply") applySeen = options.apply = true;
      else if (name === "--dry-run") drySeen = true;
      else options.help = true;
      continue;
    }
    if (!Object.hasOwn(values, name) || seen.has(name))
      fail("CATALOG_ARGUMENT_INVALID");
    seen.add(name);
    const value = inline.length ? inline.join("=") : args[++index];
    if (!value || value.startsWith("--")) fail("CATALOG_ARGUMENT_INVALID");
    options[values[name]] = value;
  }
  if (applySeen && drySeen) fail("CATALOG_MODE_CONFLICT");
  if (
    !options.help &&
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(options.projectId)
  )
    fail("CATALOG_EXPLICIT_PROJECT_REQUIRED");
  for (const value of [options.expectedSourceHash, options.expectedPlanHash])
    if (value && !/^[a-f0-9]{64}$/u.test(value))
      fail("CATALOG_HASH_ARGUMENT_INVALID");
  return options;
}

export const safeErrorCode = (error) =>
  Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16
    ? String(error.code)
    : typeof error?.code === "string" &&
        /^CATALOG_[A-Z0-9_]{1,70}$/u.test(error.code)
      ? error.code
      : [
            "app/invalid-credential",
            "app/network-error",
            "app/network-timeout",
            "app/invalid-app-options",
          ].includes(error?.code)
        ? error.code
        : "UNKNOWN_ERROR";

export async function runCatalogSync({
  db,
  source,
  options,
  serverTimestamp,
  deleteField,
  report = console.log,
}) {
  if (
    options.expectedSourceHash &&
    options.expectedSourceHash !== source.sourceHash
  )
    fail("CATALOG_SOURCE_HASH_CHANGED");
  const plan = planCatalogSync(
    source.terms,
    await readCatalogDocuments(db, source.terms),
  );
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    projectId: options.projectId,
    collection: COLLECTION,
    managedBy: MANAGED_BY,
    schemaVersion: SCHEMA_VERSION,
    ...source.counts,
    sourceHash: source.sourceHash,
    sourceBundleHash: source.sourceBundleHash,
    planHash: plan.planHash,
    counts: plan.counts,
    conflictReasons: plan.conflictReasons,
  };
  report(JSON.stringify(summary));
  if (options.expectedPlanHash && options.expectedPlanHash !== plan.planHash)
    fail("CATALOG_PLAN_HASH_CHANGED");
  if (plan.counts.conflict) fail("CATALOG_PLAN_CONFLICT");
  if (!options.apply) return summary;
  const applied = await applyCatalogSyncPlan({
    db,
    plan,
    serverTimestamp,
    deleteField,
  });
  const verified = planCatalogSync(
    source.terms,
    await readCatalogDocuments(db, source.terms),
  );
  report(
    JSON.stringify({
      mode: "verify",
      projectId: options.projectId,
      collection: COLLECTION,
      sourceHash: source.sourceHash,
      ...source.counts,
      applied,
      counts: verified.counts,
      verified: verified.counts.unchanged === source.terms.length,
    }),
  );
  if (verified.counts.unchanged !== source.terms.length)
    fail("CATALOG_POST_WRITE_VERIFICATION_FAILED");
  return { ...summary, applied, verified: true };
}

async function main() {
  const options = parseCatalogSyncArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/sync-history-dictionary-catalog.mjs --project PROJECT_ID [--apply | --dry-run] [--expect-source-sha SHA256] [--expect-plan-sha SHA256]\nDefault: dry run. Uses Application Default Credentials. Only owned catalog documents may change; no documents are deleted.",
    );
    return;
  }
  const source = await loadCatalogSource();
  const require = createRequire(resolve(root, "functions/package.json"));
  const {
    initializeApp,
    applicationDefault,
    deleteApp,
  } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const app = initializeApp(
    { projectId: options.projectId, credential: applicationDefault() },
    `dictionary-catalog-sync-${process.pid}`,
  );
  try {
    await runCatalogSync({
      db: getFirestore(app),
      source,
      options,
      serverTimestamp: () => FieldValue.serverTimestamp(),
      deleteField: () => FieldValue.delete(),
    });
  } finally {
    await deleteApp(app);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    // Never serialize SDK errors, raw documents, credential paths or tokens.
    const batchFailure = error?.code === "CATALOG_BATCH_COMMIT_FAILED";
    const applied =
      batchFailure &&
      ["create", "update", "batches"].every(
        (key) =>
          Number.isSafeInteger(error.applied?.[key]) && error.applied[key] >= 0,
      )
        ? {
            create: error.applied.create,
            update: error.applied.update,
            batches: error.applied.batches,
          }
        : null;
    console.error(
      JSON.stringify({
        error: safeErrorCode(error),
        ...(batchFailure
          ? {
              causeCode: /^\d{1,2}$/u.test(error.causeCode || "")
                ? safeErrorCode({ code: Number(error.causeCode) })
                : safeErrorCode({ code: error.causeCode }),
            }
          : {}),
        ...(applied ? { applied } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
