import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const dashboard = read("src/pages/teacher/Dashboard.tsx");
const schedule = read("src/pages/teacher/ManageSchedule.tsx");
const holidays = read("src/lib/koreanPublicHolidays.ts");

assert.doesNotMatch(dashboard, /ensureKoreanPublicHolidaysSynced/);
assert.doesNotMatch(dashboard, /syncKoreanPublicHolidaysToFirestore/);
assert.doesNotMatch(dashboard, /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\b/);

assert.doesNotMatch(schedule, /ensureKoreanPublicHolidaysSynced/);
assert.doesNotMatch(schedule, /syncKoreanPublicHolidaysToFirestore/);
assert.match(schedule, /const handleHolidaySync = async \(\) =>/);
assert.match(schedule, /"syncKoreanPublicHolidays"/);
assert.match(schedule, /onClick=\{\(\) => void handleHolidaySync\(\)\}/);
assert.equal(
  [...schedule.matchAll(/\bhandleHolidaySync\b/g)].length,
  2,
  "holiday synchronization must be referenced only by its handler and explicit button",
);
assert.equal(
  [...schedule.matchAll(/"syncKoreanPublicHolidays"/g)].length,
  1,
  "holiday command must be dispatched from one explicit handler only",
);
assert.equal(
  [...schedule.matchAll(/\bexecuteWestoryCommand\b/g)].length,
  2,
  "the gateway import and explicit holiday handler must be its only schedule references",
);
const scheduleEffects = [...schedule.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[[^\]]*\]\);/g)]
  .map((match) => match[1]);
assert.ok(scheduleEffects.length > 0, "expected schedule effects to be inspectable");
scheduleEffects.forEach((effect) => {
  assert.doesNotMatch(effect, /handleHolidaySync|syncKoreanPublicHolidays|executeWestoryCommand/);
});

assert.doesNotMatch(holidays, /firebase\/firestore/);
assert.doesNotMatch(holidays, /\b(?:writeBatch|setDoc|updateDoc|deleteDoc)\b/);
assert.doesNotMatch(holidays, /window\.localStorage/);

console.log(
  JSON.stringify({
    suite: "w2a-query-purity",
    passed: true,
    checks: [
      "teacher dashboard mount contains no persistent write",
      "teacher schedule mount contains no holiday synchronization write",
      "holiday library is read-only and browser-storage independent",
      "holiday persistence is reachable only from an explicit button command",
    ],
  }),
);
