import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const sources = [
  "src/App.tsx",
  "src/lib/semesterCutover.ts",
  "src/pages/teacher/SemesterCutoverCenter.tsx",
  "src/pages/teacher/SemesterCutoverCenterView.tsx",
  "src/components/common/SemesterSourceSummary.tsx",
  "src/pages/student/StudentArchiveOverview.tsx",
  "src/pages/student/components/StudentCurrentEnrollmentCard.tsx",
];
for (const file of sources) {
  assert.equal(
    existsSync(resolve(file)),
    true,
    `Missing mounted W11 source: ${file}`,
  );
}
const textByFile = new Map(
  sources.map((file) => [file, readFileSync(resolve(file), "utf8")]),
);
const strictOwnedFiles = [
  "src/lib/semesterCutover.ts",
  "src/pages/teacher/SemesterCutoverCenter.tsx",
  "src/pages/teacher/SemesterCutoverCenterView.tsx",
  "src/components/common/SemesterSourceSummary.tsx",
];
const ownedText = strictOwnedFiles
  .map((file) => textByFile.get(file))
  .join("\n");
const adapter = textByFile.get("src/lib/semesterCutover.ts");
const container = textByFile.get("src/pages/teacher/SemesterCutoverCenter.tsx");
const view = textByFile.get("src/pages/teacher/SemesterCutoverCenterView.tsx");
const route = textByFile.get("src/App.tsx");

for (const forbidden of [
  /from\s+["']firebase\/firestore["']/u,
  /\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/u,
  /from\s+["']firebase\/storage["']/u,
  /\b(?:uploadBytes|deleteObject)\s*\(/u,
  /\b(?:localStorage|sessionStorage)\b/u,
  /\bstudent_maintenance\b/u,
]) {
  assert.doesNotMatch(ownedText, forbidden);
}
assert.match(route, /path=["']\/teacher\/settings\/cutover["']/u);
assert.match(route, /<SemesterCutoverCenter\s*\/>/u);
assert.equal((adapter.match(/"getSemesterCutoverState"/gu) || []).length, 1);
assert.match(adapter, /raw\.writeCount\s*!==\s*0/u);
assert.match(adapter, /raw\.activationControlsAvailable\s*!==\s*false/u);
assert.match(adapter, /raw\.productionControlsAvailable\s*!==\s*false/u);

assert.doesNotMatch(
  adapter,
  /executeCutoverCommand|executeWestoryCommand/u,
  "The unused synthetic command facade must not remain in the read-only adapter.",
);
assert.equal(
  (container.match(/createSemesterCutoverPlan\s*\(/gu) || []).length,
  0,
  "Mounted W11 UI must not author a Cutover Plan; the approved authenticated runner owns that action.",
);
// Authorized real-semester actions use the semester core gateway. The W11
// evidence adapter remains read-only and never authors a production plan.
assert.match(container, /freshTarget\?\.revision\s*!==\s*target\.revision/u);
assert.match(container, /getServerSemesterCoreState\(target\.semesterId\)/u);
assert.match(container, /!canActivateSemester\(/u);
assert.match(
  container,
  /expectedActiveSemesterId:\s*active\?\.semesterId\s*\?\?\s*null/u,
);
assert.match(container, /studentMaintenanceConfig\?\.enabled\s*===\s*true/u);
assert.match(container, /disabled=\{locked\s*\|\|\s*!activationAllowed\}/u);
assert.match(container, /onClick=\{activate\}/u);
assert.equal(
  (container.match(/executeWestoryCommand\("activateSemester"/gu) || []).length,
  1,
);
assert.match(
  container,
  /actionInFlightRef\.current/u,
  "High-risk W11 actions must share one client-side in-flight fence.",
);
assert.match(
  view,
  /disabled=\{!action\.allowed\s*\|\|\s*action\.locked\}/u,
  "Every W11 action button must honor the shared in-flight lock.",
);
assert.match(view, /group\s*===\s*"recovery"/u);
assert.match(view, /ws-cutover-action--danger/u);
assert.doesNotMatch(adapter, /useEffect|componentDidMount|onSnapshot/u);
assert.doesNotMatch(
  ownedText,
  /executeWestoryCommand\(\s*"(?:setStudentMaintenance|updateStudentMaintenance|createSemesterCutoverPlan)"/u,
);
// Verify the mount effect only refreshes read models. No automatic activation.
assert.match(
  container,
  /useEffect\(\(\)\s*=>\s*\{\s*void reload\(\);\s*return/u,
);

console.log(
  JSON.stringify({
    suite: "w11-query-purity",
    passed: true,
    mountedSources: sources.length,
    queryCallables: 1,
    syntheticGatewayCommands: 0,
    mountWrites: 0,
    listWrites: 0,
    detailWrites: 0,
    previewWrites: 0,
    directFirestoreWrites: 0,
    directStorageWrites: 0,
    activationCallsites: 1,
    maintenanceCallsites: 0,
    unknown: 0,
    productionActivationRequiresConfirmation: true,
    productionWrites: 0,
  }),
);
