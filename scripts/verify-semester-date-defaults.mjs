import assert from "node:assert/strict";
import { getDefaultSemesterDates } from "../src/pages/teacher/components/semesterDates.ts";

assert.deepEqual(getDefaultSemesterDates("2026", "1"), {
  startAt: "2026-03-01",
  endAt: "2026-08-31",
});
assert.deepEqual(getDefaultSemesterDates("2026", "2"), {
  startAt: "2026-09-01",
  endAt: "2027-02-28",
});
for (const [year, lastDay] of [
  [2027, "29"],
  [2099, "28"],
  [2399, "29"],
]) {
  assert.equal(
    getDefaultSemesterDates(String(year), "2").endAt,
    `${year + 1}-02-${lastDay}`,
  );
}
for (const [year, term] of [
  ["202", "1"],
  ["2026", "3"],
  ["", ""],
]) {
  assert.deepEqual(getDefaultSemesterDates(year, term), {
    startAt: "",
    endAt: "",
  });
}
console.log("Semester date defaults: PASS (8 cases, including leap years)");
