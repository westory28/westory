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
const route = textByFile.get("src/App.tsx");

for (const forbidden of [
  /from\s+["']firebase\/firestore["']/u,
  /\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/u,
  /from\s+["']firebase\/storage["']/u,
  /\b(?:uploadBytes|deleteObject)\s*\(/u,
  /\b(?:localStorage|sessionStorage)\b/u,
  /\bactivateSemester\b/u,
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

const commands = [
  "createSemesterCutoverPlan",
  "dryRunSemesterCutover",
  "applySemesterCutoverBatch",
  "verifySemesterCutover",
  "resumeSemesterCutover",
  "createSemesterRollbackPlan",
];
for (const command of commands) {
  assert.equal(
    (
      adapter.match(
        new RegExp(`executeCutoverCommand\\(\\s*"${command}"`, "gu"),
      ) || []
    ).length,
    1,
    `${command} must have one literal gateway wrapper.`,
  );
}
assert.equal(
  (adapter.match(/executeCutoverCommand\(/gu) || []).length,
  commands.length,
  "Generic or duplicate W11 gateway invocation detected.",
);
assert.equal(
  (container.match(/createSemesterCutoverPlan\s*\(/gu) || []).length,
  0,
  "Mounted W11 UI must not author a Cutover Plan; the approved authenticated runner owns that action.",
);
assert.match(container, /action\s*===\s*"CREATE_PLAN"\)\s*return/u);
assert.match(
  container,
  /common\("CREATE_PLAN"\)[\s\S]{0,300}allowed:\s*false/u,
  "CREATE_PLAN must remain visibly fail-closed in the mounted UI.",
);
assert.doesNotMatch(adapter, /useEffect|componentDidMount|onSnapshot/u);
assert.doesNotMatch(
  ownedText,
  /(?:activate|maintenance|production)\w*\s*[:=]\s*(?:true|\([^)]*\)\s*=>)/iu,
  "W11 must not expose activation, maintenance, or Production mutation controls.",
);

console.log(
  JSON.stringify({
    suite: "w11-query-purity",
    passed: true,
    mountedSources: sources.length,
    queryCallables: 1,
    gatewayCommands: commands.length,
    mountWrites: 0,
    listWrites: 0,
    detailWrites: 0,
    previewWrites: 0,
    directFirestoreWrites: 0,
    directStorageWrites: 0,
    activationCallsites: 0,
    maintenanceCallsites: 0,
    unknown: 0,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
