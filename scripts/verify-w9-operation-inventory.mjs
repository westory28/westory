import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const read = (path) => readFileSync(resolve(path), "utf8");
const verify = (path, allowed) => {
  const manifest = readJson(path);
  assert.ok([1, 2].includes(manifest.schemaVersion));
  assert.equal(manifest.surfaces.length, manifest.expectedCount);
  const ids = new Set();
  const counts = Object.fromEntries(Object.keys(manifest.expectedDispositionCounts).map((key) => [key, 0]));
  for (const item of manifest.surfaces) {
    assert.match(item.id, /^[A-Z][A-Z0-9-]+$/u);
    assert.equal(ids.has(item.id), false, `Duplicate W9 inventory ID: ${item.id}`);
    ids.add(item.id);
    assert.ok(allowed.has(item.disposition), `Unknown W9 disposition: ${item.disposition}`);
    if (manifest.schemaVersion >= 2) {
      assert.ok(String(item.rationale || "").trim(), `${item.id} missing rationale`);
      assert.ok(String(item.completion || "").trim(), `${item.id} missing completion`);
      assert.ok(String(item.adapter || "").trim(), `${item.id} missing adapter`);
    }
    counts[item.disposition] = (counts[item.disposition] || 0) + 1;
    assert.equal(existsSync(resolve(item.file)), true, `Missing anchor file: ${item.file}`);
    const source = read(item.file);
    assert.ok(Array.isArray(item.anchors) && item.anchors.length > 0);
    for (const anchor of item.anchors) {
      assert.ok(source.includes(anchor), `Missing anchor ${anchor} in ${item.file} (${item.id})`);
    }
  }
  assert.deepEqual(counts, manifest.expectedDispositionCounts);
  assert.equal(counts.UNKNOWN, 0);
  return { count: manifest.expectedCount, counts };
};

const editor = verify(
  "scripts/w9-editor-surface-manifest.json",
  new Set([
    "DRAFT_REQUIRED",
    "DOMAIN_DRAFT_EXISTS",
    "COMMAND_ONLY",
    "READ_ONLY",
    "NOT_APPLICABLE",
    "RELEASE_DECISION",
  ]),
);
const editorManifest = readJson("scripts/w9-editor-surface-manifest.json");
const draftRequired = editorManifest.surfaces.filter(
  (item) => item.disposition === "DRAFT_REQUIRED",
);
assert.deepEqual(
  draftRequired.map((item) => item.id).sort(),
  ["D01", "D02", "LES01", "SCH01"],
  "Only the four actually integrated W9 editor surfaces may require common Drafts.",
);
for (const item of draftRequired) {
  assert.equal(item.file, "src/pages/teacher/W8TeacherHub.tsx");
  assert.equal(item.adapter, "useTeacherDraft");
  assert.equal(item.completion, "IMPLEMENTED_W9");
  assert.ok(item.anchors.includes("useTeacherDraft"));
}
const hub = read("src/pages/teacher/W8TeacherHub.tsx");
assert.ok(
  (hub.match(/useTeacherDraft</gu) || []).length >= 3,
  "W9TeacherHub must mount the Learning, Schedule, and Communication Draft bindings.",
);
const bulk = verify(
  "scripts/w9-bulk-surface-manifest.json",
  new Set([
    "BULK_FRAMEWORK",
    "DOMAIN_ATOMIC",
    "SINGLE_COMMAND",
    "NOT_APPLICABLE",
    "RELEASE_DECISION",
  ]),
);

console.log(
  JSON.stringify({
    suite: "w9-operation-inventory",
    passed: true,
    editorSurfaces: editor.count,
    editorDispositions: editor.counts,
    bulkSurfaces: bulk.count,
    bulkDispositions: bulk.counts,
    duplicateIds: 0,
    missingAnchors: 0,
    unknown: 0,
  }),
);
