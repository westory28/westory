import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert.match(adminConsumer, /onClick=\{\(\) => void handlePreview\(\)\}/);
assert.match(adminConsumer, /onClick=\{\(\) => void handleApplyRoster\(\)\}/);
assert.doesNotMatch(
  adminConsumer,
  /useEffect[\s\S]{0,500}executeWestoryCommand/,
  "Gateway mutations may not run from an effect",
);

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
    ],
    productionAccess: 0,
  }),
);
