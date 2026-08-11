import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const gradeClientPath = "src/lib/gradeEvidence.ts";
const gradeOwnedPaths = new Set([
  gradeClientPath,
  "src/lib/performanceScores.ts",
  "src/pages/student/score/PerformanceScoreView.tsx",
  "src/pages/teacher/components/ExamGradingPlan.tsx",
  "src/pages/teacher/components/ExamOmrConfig.tsx",
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
]);
const gradeUiPaths = [...gradeOwnedPaths].filter((path) => path !== gradeClientPath);
const directMutationPattern =
  /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|deleteObject)\s*\(/u;

assert.ok(existsSync(resolve(root, gradeClientPath)), `${gradeClientPath} is required.`);
const client = read(gradeClientPath);
assert.match(client, /getGradeEvidenceState/u, "Grade reads must use getGradeEvidenceState.");
assert.doesNotMatch(
  client,
  /from\s+["']firebase\/(?:firestore|storage)["']/u,
  "Canonical grade client must not import Firestore or Storage SDKs.",
);
assert.doesNotMatch(
  client,
  directMutationPattern,
  "Canonical grade client must remain query-only outside explicit gateway commands.",
);

for (const path of gradeUiPaths) {
  const source = read(path);
  assert.doesNotMatch(source, directMutationPattern, `${path} retains a direct SDK mutation.`);
}

const manager = read("src/pages/teacher/components/PerformanceScoreManager.tsx");
assert.doesNotMatch(
  manager,
  /getDocs\s*\(\s*collection\s*\(\s*db\s*,\s*["']users["']\s*\)\s*\)/u,
  "Grade roster joins must use canonical Enrollment snapshots, not a full users query.",
);
assert.doesNotMatch(
  manager,
  /Falling back to direct (?:performance score document|class score document|performance score confirmation) reads/u,
  "Canonical grade queries must fail visibly instead of silently falling back to N+1 legacy reads.",
);

const analysis = analyzeClientBoundary({ rootDir: root });
const gradeMutations = analysis.observations.filter(
  (entry) =>
    gradeOwnedPaths.has(entry.file) &&
    ["FIRESTORE", "STORAGE"].includes(entry.boundary),
);
assert.deepEqual(
  gradeMutations,
  [],
  `W6B grade-owned client mutation boundaries remain: ${gradeMutations
    .map((entry) => `${entry.file}::${entry.function}::${entry.api}`)
    .join(", ")}`,
);

const implicitTriggerMutations = analysis.observations.filter(
  (entry) =>
    gradeOwnedPaths.has(entry.file) &&
    entry.triggers.some((trigger) =>
      ["MOUNT", "LISTENER", "TIMER", "UNMOUNT"].includes(trigger),
    ),
);
assert.deepEqual(
  implicitTriggerMutations,
  [],
  "Grade mount/listener/timer/unmount paths must remain zero-write.",
);

const rules = read("firestore.rules");
for (const collectionName of [
  "semester_grade_records",
  "semester_grade_versions",
  "semester_grade_requests",
  "semester_grade_attestations",
  "grade_legacy_issues",
]) {
  assert.match(
    rules,
    new RegExp(
      `match /${collectionName}/\\{docId\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`,
      "u",
    ),
    `${collectionName} must remain server-only.`,
  );
}

const serverModulePath = resolve(root, "functions/gradeEvidence.js");
assert.ok(existsSync(serverModulePath), "functions/gradeEvidence.js is required.");
const server = read("functions/gradeEvidence.js");
for (const token of [
  "createGradeDraft",
  "reviewGradeDraft",
  "finalizeGradeEvidence",
  "publishOfficialGrade",
  "correctOfficialGrade",
  "requestGradeReview",
  "acknowledgeGradeEvidence",
  "signOfficialGrade",
  "getGradeEvidenceState",
  "grade_evidence_readiness",
]) {
  assert.ok(server.includes(token), `W6B server contract is missing ${token}.`);
}

console.log(
  JSON.stringify({
    suite: "w6b-grade-query-purity",
    passed: true,
    gradeOwnedClientMutations: 0,
    implicitTriggerMutations: 0,
    canonicalDirectReads: 0,
    canonicalDirectWrites: 0,
    queryCallable: "getGradeEvidenceState",
    readinessCheckId: "grade_evidence_readiness",
    productionAccess: 0,
  }),
);
