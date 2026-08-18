import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const read = (path) => readFileSync(resolve(path), "utf8");
const sourceSection = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(
    start,
    -1,
    `${label} start marker is missing: ${startMarker}`,
  );
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} end marker is missing: ${endMarker}`);
  return source.slice(start, end);
};

const assertOrdered = (source, markers, label) => {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label} is missing semantic marker: ${marker}`);
    assert.ok(
      next > cursor,
      `${label} semantic marker order changed: ${marker}`,
    );
    cursor = next;
  }
};

const assertMountedRoute = (app, path, component) => {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\const verify");
  assert.match(
    app,
    new RegExp(
      `path=["']${escapedPath}["'][\\s\\S]{0,320}<${component}\\s*/>`,
      "u",
    ),
    `${path} must mount ${component}; a dead route string or redirect is not sufficient`,
  );
};
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
const editorById = new Map(
  editorManifest.surfaces.map((item) => [item.id, item]),
);
const assertSurfaceContract = (id, expected) => {
  const actual = editorById.get(id);
  assert.ok(actual, `Missing W9 semantic surface: ${id}`);
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(
      actual[field],
      value,
      `${id} ${field} semantic contract changed`,
    );
  }
};

assertSurfaceContract("THINK01", {
  disposition: "COMMAND_ONLY",
  completion: "COMMAND_BOUNDARY",
  adapter: "legacy-think-cloud-command-adapter",
});
assertSurfaceContract("LES02", {
  disposition: "READ_ONLY",
  completion: "MOUNTED_SAFE_HANDOFF",
  adapter: "legacy-lesson-management-handoff",
});
assertSurfaceContract("MAP03", {
  disposition: "READ_ONLY",
  completion: "MOUNTED_SAFE_HANDOFF",
  adapter: "legacy-lesson-management-handoff",
});
for (const id of ["EX01", "EX02", "EX03", "EX05", "EX06", "EX08"]) {
  assertSurfaceContract(id, {
    disposition: "COMMAND_ONLY",
    completion: "COMMAND_BOUNDARY",
    adapter: "legacy-grade-evidence-adapter",
  });
}
for (const id of ["MAP01", "MAP02", "SRC01"]) {
  assertSurfaceContract(id, {
    disposition: "RELEASE_DECISION",
    completion: "SAFE_HANDOFF",
    adapter: "legacy-lesson-management-handoff",
  });
}

const app = read("src/App.tsx");
assertMountedRoute(app, "/teacher/lesson", "ManageLesson");
assertMountedRoute(app, "/teacher/lesson/think-cloud", "ManageThinkCloud");

const lessonHandoff = read("src/lib/legacyLessonManagementHandoff.ts");
assert.match(
  lessonHandoff,
  /shouldHandoffLegacyLessonManagementMutation\s*=\s*\(\)\s*=>\s*true/u,
  "Legacy lesson mutations must remain fail-closed before a mounted legacy editor can hand off",
);
assert.match(
  lessonHandoff,
  /LEGACY_LESSON_MANAGEMENT_ROUTE\s*=\s*["']\/teacher\/learning["']/u,
  "Legacy lesson handoff must target the canonical mounted learning route",
);

const lesson = read("src/pages/teacher/ManageLesson.tsx");
const lessonBlocker = sourceSection(
  lesson,
  "const blockLegacyLessonMutationAsync",
  "const [savedLessonState",
  "LES02 mounted lesson write blocker",
);
assertOrdered(
  lessonBlocker,
  [
    "setHandoffAction",
    "throw new Error",
    "buildLegacyLessonManagementHandoffMessage",
  ],
  "LES02 mounted lesson write blocker",
);

const maps = read("src/pages/teacher/ManageMaps.tsx");
const mapRename = sourceSection(
  maps,
  "const handleSaveTabRename",
  "const selectedPreview",
  "MAP03 tab rename handoff",
);
assertOrdered(
  mapRename,
  [
    "shouldHandoffLegacyLessonManagementMutation()",
    'setHandoffAction("지도 탭 이름 변경")',
    "return;",
    "persistToScope",
  ],
  "MAP03 tab rename handoff",
);
const mapTagSave = sourceSection(
  maps,
  "const handleSaveTagManager",
  "const persistOrder",
  "MAP02 taxonomy handoff",
);
assertOrdered(
  mapTagSave,
  [
    "shouldHandoffLegacyLessonManagementMutation()",
    'setHandoffAction("지도 태그 설정 저장")',
    "return;",
  ],
  "MAP02 taxonomy handoff",
);

const thinkCloud = read("src/pages/teacher/ManageThinkCloud.tsx");
for (const adapterCall of [
  "createLegacyThinkCloudSession({",
  "transitionLegacyThinkCloudSession({",
  "deleteLegacyThinkCloudSession({",
]) {
  assert.ok(
    thinkCloud.includes(adapterCall),
    `THINK01 mounted UI command call is missing: ${adapterCall}`,
  );
}
const thinkCloudAdapter = read("src/lib/legacyThinkCloudAdapter.ts");
for (const [commandType, executor] of [
  ["createThinkCloudSession", "createThinkCloudSession"],
  ["transitionThinkCloudSession", "transitionThinkCloudSession"],
  ["deleteThinkCloudSession", "deleteThinkCloudSession"],
]) {
  const commandStart = `commandType: "${commandType}"`;
  const section = thinkCloudAdapter.slice(
    thinkCloudAdapter.indexOf(commandStart),
    thinkCloudAdapter.indexOf("});", thinkCloudAdapter.indexOf(commandStart)) +
      3,
  );
  assert.ok(
    section.startsWith(commandStart),
    `THINK01 adapter command is missing: ${commandType}`,
  );
  assert.ok(
    section.includes(`execute: ${executor}`),
    `THINK01 ${commandType} must dispatch through its W8 command executor`,
  );
}

const scoreManager = read(
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
);
const warningSave = sourceSection(
  scoreManager,
  "const saveScoreWarningSettings",
  "const loadStudents",
  "EX05 warning settings command",
);
assert.ok(
  warningSave.includes("await saveLegacyGradeWarningSettings({"),
  "EX05 must call the legacy grade adapter from the mounted save handler",
);
const objectionReview = sourceSection(
  scoreManager,
  "const handleReviewObjection",
  "const startScoreEdit",
  "EX08 objection review command",
);
assert.ok(
  objectionReview.includes("await reviewLegacyGradeRequest({"),
  "EX08 must call the legacy grade adapter from the mounted review handler",
);
const parsedScoreSave = sourceSection(
  scoreManager,
  "const saveParsedScores",
  "const deleteRoster",
  "EX03/EX06 parsed score command",
);
assertOrdered(
  parsedScoreSave,
  [
    "LEGACY_GRADE_ATOMIC_RECORD_LIMIT",
    "await saveLegacyGradeRoster({",
    "showToast({",
  ],
  "EX03/EX06 parsed score command",
);

const gradingPlan = read("src/pages/teacher/components/ExamGradingPlan.tsx");
const gradingPlanSave = sourceSection(
  gradingPlan,
  "const handleSave",
  "const buildDraftPreviewPlan",
  "EX01 grading plan command",
);
assert.ok(
  gradingPlanSave.includes("await saveLegacyGradeConfig({"),
  "EX01 must call the W6B grade config adapter from the mounted save handler",
);
const omrConfig = read("src/pages/teacher/components/ExamOmrConfig.tsx");
const omrSave = sourceSection(
  omrConfig,
  "const handleSave",
  "const getTotals",
  "EX02 OMR command",
);
assert.ok(
  omrSave.includes("await saveLegacyGradeConfig({"),
  "EX02 must call the W6B grade config adapter from the mounted save handler",
);

const gradeAdapter = read("src/lib/legacyGradeEvidenceAdapter.ts");
const warningAdapter = sourceSection(
  gradeAdapter,
  "export const saveLegacyGradeWarningSettings",
  "export const acknowledgeLegacyGradeWarning",
  "EX05 warning adapter",
);
const rosterAdapter = sourceSection(
  gradeAdapter,
  "export const saveLegacyGradeRoster",
  "export const deleteLegacyGradeRoster",
  "EX03/EX06 roster adapter",
);
assertOrdered(
  rosterAdapter,
  [
    "LEGACY_GRADE_ATOMIC_RECORD_LIMIT",
    'runLegacyGradeCommand("upsertLegacyGradeRoster"',
  ],
  "EX03/EX06 roster adapter",
);
assertOrdered(
  warningAdapter,
  ['runLegacyGradeCommand("saveLegacyGradeConfig"', 'configKind: "WARNING"'],
  "EX05 warning adapter",
);
const reviewAdapter = sourceSection(
  gradeAdapter,
  "export const reviewLegacyGradeRequest",
  "export const saveLegacyGradeConfig",
  "EX08 review adapter",
);
assert.ok(
  reviewAdapter.includes('runLegacyGradeCommand("reviewLegacyGradeRequest"'),
  "EX08 must dispatch the W6B review command through the grade adapter",
);
const configAdapter = sourceSection(
  gradeAdapter,
  "export const saveLegacyGradeConfig",
  "};",
  "EX01/EX02 grade config adapter",
);
assert.ok(
  configAdapter.includes('runLegacyGradeCommand("saveLegacyGradeConfig"'),
  "EX01/EX02 must dispatch the W6B grade config command",
);

const sourceArchive = read("src/pages/teacher/ManageSourceArchive.tsx");
const sourceArchiveSave = sourceSection(
  sourceArchive,
  "const handleSave",
  "const handleDelete",
  "SRC01 asset handoff",
);
assertOrdered(
  sourceArchiveSave,
  ["event.preventDefault()", "setHandoffAction("],
  "SRC01 asset handoff",
);
assert.doesNotMatch(
  sourceArchiveSave,
  /saveSourceArchiveAsset|uploadBytes|setDoc/u,
  "SRC01 mounted save handler must not retain an asset or Firestore write",
);
const gradeEvidence = read("src/lib/gradeEvidence.ts");
assert.match(
  gradeEvidence,
  /const executeLegacyGradeCommand\s*=\s*\n?\s*executeWestoryCommand/u,
  "Legacy grade adapter commands must terminate at executeWestoryCommand",
);
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
