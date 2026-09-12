import assert from "node:assert/strict";
import {
  canActivateSemester,
  hasCompleteReadiness,
  nextSemester,
  readinessLabel,
} from "../src/pages/teacher/components/semesterTransitionGuide.ts";

const manifest = {
  semesterId: "2027-1",
  schoolYear: "2027",
  term: "1",
  status: "READY",
  revision: 4,
  readinessPolicyVersion: "p1",
};
const report = {
  semesterId: "2027-1",
  status: "PASS",
  stale: false,
  evaluatedRevision: 4,
  policyVersion: "p1",
  dependencyHash: "fresh",
  requiredTotal: 2,
  requiredPassed: 2,
  checks: [
    { checkId: "class_readiness", required: true, status: "PASS" },
    { checkId: "semester_cutover_readiness", required: true, status: "PASS" },
  ],
};
const server = {
  error: null,
  requested: manifest,
  active: { semesterId: "2026-2" },
  readiness: { current: true, dependencyHash: "fresh" },
};
const input = {
  manifest,
  report,
  server,
  activeId: "2026-2",
  studentAccessClosed: true,
  confirmed: true,
};
assert.equal(canActivateSemester(input), true);
for (const patch of [
  { confirmed: false },
  { studentAccessClosed: false },
  { activeId: "2026-1" },
  { server: null },
  { report: undefined },
  { manifest: { ...manifest, status: "ARCHIVED" } },
  { manifest: { ...manifest, status: "PREPARING" } },
])
  assert.equal(canActivateSemester({ ...input, ...patch }), false);
for (const patch of [
  { stale: true },
  { evaluatedRevision: 3 },
  { semesterId: "2026-1" },
  { requiredTotal: 0, requiredPassed: 0, checks: [] },
  { requiredPassed: 1 },
  { checks: report.checks.slice(0, 1) },
  { checks: [{ ...report.checks[0], status: "FAIL" }, report.checks[1]] },
  {
    checks: [
      { ...report.checks[0], status: "NOT_APPLICABLE" },
      report.checks[1],
    ],
  },
  { dependencyHash: "older" },
  { policyVersion: "p0" },
])
  assert.equal(
    hasCompleteReadiness(manifest, { ...report, ...patch }, server),
    false,
  );
for (const patch of [
  { requested: { ...manifest, revision: 5 } },
  { requested: { ...manifest, semesterId: "2027-2" } },
  { error: "CONFLICTING_ACTIVE_SEMESTER" },
  { readiness: { current: false, dependencyHash: "fresh" } },
  { readiness: { current: true, dependencyHash: "changed" } },
])
  assert.equal(
    hasCompleteReadiness(manifest, report, { ...server, ...patch }),
    false,
  );
assert.deepEqual(nextSemester({ schoolYear: "2026", term: "1" }), {
  schoolYear: "2026",
  term: "2",
});
assert.deepEqual(nextSemester({ schoolYear: "2026", term: "2" }), {
  schoolYear: "2027",
  term: "1",
});
assert.equal(readinessLabel("unknown_future_check"), "추가 운영 점검");
console.log(
  "Semester transition guide: PASS (fresh readiness, source identity, confirmation, closed access, incomplete/unknown reports, next-term rollover)",
);
