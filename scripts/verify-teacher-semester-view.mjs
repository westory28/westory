import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const output = join(mkdtempSync(join(tmpdir(), "westory-semester-safety-")), "checks.mjs");
await build({
  stdin: { contents: `export * from './src/lib/teacherSemesterView'; export * from './src/lib/semesterRoster';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: output,
});
const scope = await import(pathToFileURL(output));
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = { location: { hash: "#/teacher/lesson" } };
scope.storeTeacherSemester("teacher-a", { year: "2026", semester: "1" });
assert.deepEqual(scope.readTeacherSemester("teacher-a"), { year: "2026", semester: "1" });
assert.equal(scope.readTeacherSemester("teacher-b"), null);
storage.set(scope.teacherSemesterStorageKey("teacher-a"), '{"year":"2026","semester":"3"}');
assert.equal(scope.readTeacherSemester("teacher-a"), null);
scope.setTeacherSemesterWriteScope({ uid: "teacher-a", readOnly: true });
for (const name of ["executeCommand", "deleteStudentData", "uploadLessonAssetContent", "updateStudentMaintenanceConfig", "unknownFutureMutation"]) {
  assert.throws(() => scope.assertTeacherSemesterCallable(name, "teacher-a"), /조회만/);
}
for (const name of ["getTeacherSemesterOptions", "getWisEconomyState", "getW8DomainState", "getArchiveEnrollmentState", "openApplicationSession", "closeApplicationSession", "touchApplicationSession"]) {
  assert.doesNotThrow(() => scope.assertTeacherSemesterCallable(name, "teacher-a"));
}
assert.throws(() => scope.assertTeacherSemesterWritable("teacher-a"), /조회만/);
assert.doesNotThrow(() => scope.assertTeacherSemesterWritable("different-user"));
window.location.hash = "#/student/lesson/note";
assert.doesNotThrow(() => scope.assertTeacherSemesterCallable("executeCommand", "teacher-a"));
window.location.hash = "#/teacher/settings";
scope.setTeacherSemesterWriteScope({ uid: "teacher-a", readOnly: false });
assert.doesNotThrow(() => scope.assertTeacherSemesterCallable("executeCommand", "teacher-a"));
scope.storeTeacherSemester("teacher-a", null);
assert.equal(scope.readTeacherSemester("teacher-a"), null);

const roster = [
  { studentUid: "a", enrollmentStatus: "TRANSFERRED", studentNumber: "1", effectiveFrom: "2026-03-01" },
  { studentUid: "a", enrollmentStatus: "COMPLETED", studentNumber: "2", effectiveFrom: "2026-05-01" },
  { studentUid: "b", enrollmentStatus: "ACTIVE", studentNumber: "3", effectiveFrom: "2026-04-01" },
  { studentUid: "b", enrollmentStatus: "TRANSFERRED", studentNumber: "4", effectiveFrom: "2026-03-01" },
  { studentUid: "c", enrollmentStatus: "WITHDRAWN", studentNumber: "5", effectiveFrom: "2026-03-01" },
];
assert.deepEqual(scope.selectSemesterRosterEnrollments(roster, true).map(item => item.studentNumber), ["2", "3", "5"]);
assert.deepEqual(scope.selectSemesterRosterEnrollments([...roster].reverse(), true).map(item => `${item.studentUid}:${item.studentNumber}`).sort(), ["a:2", "b:3", "c:5"]);
assert.deepEqual(scope.selectSemesterRosterEnrollments(roster, false).map(item => item.studentNumber), ["3"]);

// Every retained direct write in these teacher surfaces is fenced immediately.
for (const file of ["EventModal", "NoticeModal", "NoticeOrderModal", "SettingsAccess", "SettingsInterface", "SettingsPrivacy", "SettingsSchool"]) {
  const text = readFileSync(`src/pages/teacher/components/${file}.tsx`, "utf8");
  assert.match(text, /assertTeacherSemesterWritable/);
}
console.log(JSON.stringify({ passed: true, accountIsolation: true, studentUnaffected: true, callableFence: true, rosterDeduplicated: true }));
