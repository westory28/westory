import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const serverSource = readFileSync("functions/archiveEnrollment.js", "utf8");
const clientSource = readFileSync("src/lib/archiveEnrollment.ts", "utf8");
const studentConsumer = readFileSync(
  "src/pages/student/components/StudentCurrentEnrollmentCard.tsx",
  "utf8",
);
const adminConsumer = readFileSync(
  "src/pages/teacher/components/SettingsArchiveEnrollment.tsx",
  "utf8",
);
const rosterFile = "src/pages/teacher/components/EnrollmentRosterImport.tsx";
const operationsFile = "src/pages/teacher/components/EnrollmentOperations.tsx";
const rosterConsumer = readFileSync(rosterFile, "utf8");
const operationsConsumer = readFileSync(operationsFile, "utf8");
const rosterForm = readFileSync("src/lib/enrollmentRosterForm.ts", "utf8");

const functionBody = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} not found`);
  assert.notEqual(end, -1, `${endMarker} not found`);
  return source.slice(start, end);
};

const previewBody = functionBody(
  serverSource,
  "const previewEnrollmentRoster = async",
  "const getArchiveEnrollmentState = async",
);
const stateBody = functionBody(
  serverSource,
  "const getArchiveEnrollmentState = async",
  "return { previewEnrollmentRoster, getArchiveEnrollmentState }",
);
for (const [name, body] of [
  ["previewEnrollmentRoster", previewBody],
  ["getArchiveEnrollmentState", stateBody],
]) {
  assert.doesNotMatch(
    body,
    /transaction\.(?:set|create|delete)\(|store\.(?:set|create|delete)\(/,
    `${name} may not persist data`,
  );
}
assert.match(previewBody, /writeCountBefore/);
assert.match(previewBody, /QUERY_PURITY_VIOLATION/);
assert.match(stateBody, /query\.source === "LEGACY"/);
assert.match(stateBody, /LEGACY_ENROLLMENT_READ/);
assert.match(stateBody, /readOnly: true/);
assert.match(clientSource, /"previewEnrollmentRoster"/);
assert.match(clientSource, /"getArchiveEnrollmentState"/);
assert.doesNotMatch(
  clientSource,
  /firebase\/firestore|setDoc|updateDoc|addDoc|deleteDoc/,
);
assert.match(studentConsumer, /source: "CURRENT"/);
assert.doesNotMatch(studentConsumer, /source: "LEGACY"|users\//);
assert.match(adminConsumer, /<EnrollmentRosterImport\b/);
assert.match(adminConsumer, /<EnrollmentMove\b/);
assert.match(adminConsumer, /<EnrollmentArchive\b/);
assert.match(adminConsumer, /source: "EXPLICIT"/);
assert.doesNotMatch(adminConsumer, /executeWestoryCommand/);
assert.match(rosterConsumer, /onClick=\{\(\) => void validate\(\)\}/);
assert.match(rosterConsumer, /onClick=\{\(\) => void apply\(\)\}/);
const validateBody = functionBody(
  rosterConsumer,
  "const validate = async",
  "const apply = async",
);
assert.match(validateBody, /await previewEnrollmentRoster\(next\)/);
assert.match(validateBody, /result\.writeCount !== 0/);
assert.doesNotMatch(
  validateBody,
  /executeWestoryCommand|setDoc|updateDoc|addDoc|deleteDoc/,
);
assert.match(
  validateBody,
  /getServerSemesterCoreState\(manifest\.semesterId\)/,
);
assert.match(validateBody, /manifest: core\.requested/);
assert.match(rosterForm, /expectedSemesterRevision: manifest\.revision/);
assert.match(
  rosterConsumer,
  /!flight\.current && \(!payload \|\| !preview\?\.passed \|\| !confirmed\)/,
);
assert.match(rosterConsumer, /validationHash: preview!\.validationHash/);
assert.match(operationsConsumer, /onClick=\{\(\) => void submit\(\)\}/);
assert.match(operationsConsumer, /expectedRevision: selected\.revision/);
assert.match(operationsConsumer, /onClick=\{\(\) => void run\(false\)\}/);
assert.match(operationsConsumer, /onClick=\{\(\) => void run\(true\)\}/);
assert.match(operationsConsumer, /!flight\.current && freeze && !confirmed/);
assert.match(operationsConsumer, /expectedRevision: core\.requested\.revision/);
assert.match(
  operationsConsumer,
  /expectedIntegrityHash: archive\?\.integrityHash/,
);
for (const source of [rosterConsumer, operationsConsumer]) {
  assert.match(source, /commandId: flight\.current\.commandId/);
}
// Follow the real JSX call graph, including indirect effect/listener/timer paths.
// Moving the controls must not make automatic writes invisible to this gate.
const analysis = analyzeClientBoundary();
const owned = analysis.observations.filter(
  (entry) =>
    [rosterFile, operationsFile].includes(entry.file) &&
    entry.boundary === "GATEWAY",
);
assert.deepEqual(
  analysis.unknown.filter((entry) =>
    [rosterFile, operationsFile].includes(entry.file),
  ),
  [],
);
assert.deepEqual(owned.map((entry) => entry.callable).sort(), [
  "freezeSemesterArchive",
  "importEnrollmentRoster",
  "moveEnrollment",
  "prepareSemesterArchive",
]);
for (const entry of owned) {
  assert.deepEqual(
    entry.triggers,
    ["USER_EVENT"],
    `${entry.callable} may only run from an explicit user event`,
  );
  assert.equal(
    entry.rootCount,
    1,
    `${entry.callable} has unexpected dispatch roots`,
  );
}

console.log(
  JSON.stringify({
    suite: "w4-query-purity",
    passed: true,
    cases: [
      "ROSTER_PREVIEW_SERVER_ZERO_WRITE",
      "ARCHIVE_ENROLLMENT_QUERY_SERVER_ZERO_WRITE",
      "LEGACY_EXPLICIT_LOGGED_READ_ONLY",
      "CLIENT_QUERY_WRAPPER_NO_FIRESTORE_MUTATION",
      "STUDENT_CONSUMER_CURRENT_ONLY_NO_SILENT_LEGACY",
      "ADMIN_GATEWAY_MUTATIONS_EXPLICIT_USER_EVENT_ONLY",
      "ADMIN_ROSTER_PREVIEW_ZERO_WRITE_AND_CONFIRMED_CAS_APPLY",
      "ADMIN_MOVE_AND_ARCHIVE_REVISION_AND_INTEGRITY_GUARDS",
    ],
    productionAccess: 0,
  }),
);
