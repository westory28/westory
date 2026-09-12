import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: ["src/lib/semesterArchiveView.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  getHistoricalSemesters,
  assertArchiveResponse,
  appendArchivePage,
  archiveDate,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].contents).toString("base64")
);
const manifests = [
  { semesterId: "2026-2", status: "ACTIVE" },
  { semesterId: "2026-1", status: "CLOSED" },
  { semesterId: "2025-2", status: "ARCHIVED" },
  { semesterId: "2027-1", status: "READY" },
  { semesterId: "2024-1", status: "CLOSING" },
  { semesterId: "2024-2", status: "QUARANTINED" },
  { semesterId: "../current", status: "ARCHIVED" },
];
assert.deepEqual(
  getHistoricalSemesters(manifests, "2026-2").map((row) => row.semesterId),
  ["2026-1", "2025-2"],
);
assert.deepEqual(
  getHistoricalSemesters(manifests, "2026-1").map((row) => row.semesterId),
  ["2025-2"],
);
assert.equal(
  manifests[0].semesterId,
  "2026-2",
  "selection must not reorder the shared manifest source",
);
const response = {
  semesterId: "2026-1",
  provenance: "ARCHIVE",
  readOnly: true,
};
assert.equal(assertArchiveResponse(response, "2026-1"), response);
for (const wrong of [
  { ...response, semesterId: "2026-2" },
  { ...response, provenance: "CURRENT" },
  { ...response, readOnly: false },
]) {
  assert.throws(() => assertArchiveResponse(wrong, "2026-1"));
}
assert.deepEqual(
  appendArchivePage(
    [{ id: "one", score: 10 }],
    [
      { id: "one", score: 20 },
      { id: "two", score: 0 },
    ],
    (row) => row.id,
  ),
  [
    { id: "one", score: 20 },
    { id: "two", score: 0 },
  ],
);
assert.equal(archiveDate(null), "날짜 기록 없음");
assert.equal(archiveDate("invalid"), "날짜 기록 없음");
assert.equal(archiveDate({ _seconds: 0 }), archiveDate("1970-01-01T00:00:00Z"));
// The existing global `header` rule fixes every bare header to the viewport top.
// A nested archive heading must not become a second navigation overlay.
for (const component of ["SettingsArchiveRecords", "LegacyArchiveRecords"]) {
  const source = readFileSync(
    `src/pages/teacher/components/${component}.tsx`,
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /<header(?:\s|>)/u,
    `${component} must not inherit the global sticky header rule`,
  );
}
console.log(
  "Semester archive view: closed-only scope, response provenance fences, pagination merge, timestamps and sticky-header collision guard PASS",
);
