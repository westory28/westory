import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: ["src/lib/enrollmentRosterForm.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  buildEnrollmentRosterFormPayload: make,
  getRosterCandidates,
  validateEnrollmentDate,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].contents).toString("base64")
);
const row = (uid, number, status = "ACTIVE") => ({
  studentUid: uid,
  studentNumber: number,
  enrollmentStatus: status,
  classId: "source-class",
  snapshot: { displayName: uid },
});
const source = {
  semesterId: "2026-1",
  classes: [],
  enrollments: [
    row("chosen", "1"),
    row("registered", "2"),
    row("retired", "3", "TRANSFERRED"),
    row("withdrawn", "4", "WITHDRAWN"),
    row("completed", "5", "COMPLETED"),
  ],
};
const target = {
  semesterId: "2026-2",
  readOnly: false,
  classes: [],
  enrollments: [{ ...row("registered", "2"), classId: "another" }],
};
const manifest = {
  semesterId: "2026-2",
  status: "ACTIVE",
  revision: 4,
  startDate: "2026-09-01",
  endDate: "2027-02-28",
};
const base = {
  manifest,
  targetState: target,
  sourceState: source,
  sourceClassId: "source-class",
  selectedUids: ["chosen"],
  numbers: { chosen: "01", completed: "5" },
  targetClass: {
    grade: "3",
    classNumber: "1",
    displayName: "3학년 1반",
    homeroomTeacherUid: "teacher",
  },
  effectiveFrom: "2026-09-01",
  rosterId: "fixture-roster",
  sourceHash: "a".repeat(64),
};
assert.deepEqual(
  getRosterCandidates(source, target, "source-class").map(
    (student) => student.studentUid,
  ),
  ["chosen", "completed"],
);
const payload = make(base);
assert.equal(payload.semesterId, "2026-2");
assert.equal(payload.expectedSemesterRevision, 4);
assert.equal(payload.entries[0].studentNumber, "1");
assert.equal(payload.entries[0].classKey, "3::1");
assert.deepEqual(payload.expectedStudentUids, ["chosen"]);
assert.equal(payload.classes[0].homeroomTeacherUid, "teacher");
assert.equal(
  source.enrollments[0].studentNumber,
  "1",
  "form construction must not mutate old records",
);
for (const patch of [
  { manifest: { ...manifest, status: "CLOSED" } },
  { targetState: { ...target, readOnly: true } },
  { sourceState: { ...source, semesterId: "2026-2" } },
  { selectedUids: [] },
  { selectedUids: Array.from({ length: 121 }, (_, i) => `s${i}`) },
  { selectedUids: ["chosen", "chosen"] },
  { selectedUids: ["registered"] },
  { selectedUids: ["retired"] },
  {
    selectedUids: ["chosen", "completed"],
    numbers: { chosen: "1", completed: "01" },
  },
  { numbers: { chosen: "0" } },
  { effectiveFrom: "2026-08-31" },
  { effectiveFrom: "2027-02-29" },
  { targetClass: { ...base.targetClass, homeroomTeacherUid: "" } },
])
  assert.throws(() => make({ ...base, ...patch }));
const existing = {
  ...base.targetClass,
  classKey: "3::1",
  classId: "target-class",
  status: "ACTIVE",
};
assert.throws(() =>
  make({
    ...base,
    targetState: {
      ...target,
      classes: [{ ...existing, homeroomTeacherUid: "other-teacher" }],
    },
  }),
);
assert.throws(() =>
  make({
    ...base,
    targetState: {
      ...target,
      classes: [existing],
      enrollments: [{ ...row("other", "1"), classId: existing.classId }],
    },
  }),
);
assert.doesNotThrow(() =>
  validateEnrollmentDate("2028-02-29", {
    startDate: "2027-09-01",
    endDate: "2028-02-29",
  }),
);
for (const name of [
  "SettingsArchiveEnrollment",
  "EnrollmentRosterImport",
  "EnrollmentOperations",
]) {
  const text = readFileSync(`src/pages/teacher/components/${name}.tsx`, "utf8");
  assert.doesNotMatch(
    text,
    /<header(?:\s|>)/u,
    "nested content must not inherit sticky global header",
  );
  assert.doesNotMatch(
    text,
    /<textarea|승인 명단 JSON|학생 UID|학기 ID|학적 ID|dry run/u,
    "ordinary administration must not require technical identifiers or JSON",
  );
}
console.log(
  "Enrollment roster form: old-record preservation, valid scope/date, duplicate/existing registration fences, batch bounds and friendly UI PASS",
);
