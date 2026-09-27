import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(
  new URL(
    "../src/pages/teacher/components/teacherDashboardWeek.ts",
    import.meta.url,
  ),
);
const { outputFiles } = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const week = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const event = (id, start, end, startPeriod = "period1") => ({
  id,
  title: id,
  start,
  end,
  startPeriod,
  eventType: "event",
  targetType: "common",
});

assert.equal(
  week.getKoreanDateKey(new Date("2026-09-27T14:59:59Z")),
  "2026-09-27",
);
assert.equal(
  week.getKoreanDateKey(new Date("2026-09-27T15:00:00Z")),
  "2026-09-28",
);
assert.equal(week.getWeekStart("2026-09-27"), "2026-09-21");
assert.equal(week.getWeekStart("2026-09-28"), "2026-09-28");
assert.equal(week.getWeekStart("2026-01-01"), "2025-12-29");
assert.equal(week.shiftCalendarDate("2026-09-28", 6), "2026-10-04");
assert.equal(week.shiftCalendarDate("2024-02-28", 1), "2024-02-29");
assert.equal(week.calendarDateKey("2026-02-30"), "");
assert.equal(week.calendarDateKey("invalid"), "");
assert.equal(week.calendarDateKey("2026-09-27T15:00:00Z"), "2026-09-28");

// The production calendar editor saves inclusive date-only ends.
const inclusive = event("inclusive", "2026-09-25", "2026-09-28");
assert.equal(week.eventIncludesDate(inclusive, "2026-09-28"), true);
assert.equal(week.eventIncludesDate(inclusive, "2026-09-29"), false);
assert.equal(week.getWeekEvents([inclusive], "2026-09-28").length, 1);
assert.equal(
  week.eventIncludesDate(event("one-day", "2026-09-27"), "2026-09-28"),
  false,
);

// Midnight is exclusive only for explicitly timed intervals, not stored dates.
const midnight = event(
  "midnight",
  "2026-09-27T18:00:00+09:00",
  "2026-09-28T00:00:00+09:00",
);
assert.equal(week.eventIncludesDate(midnight, "2026-09-27"), true);
assert.equal(week.eventIncludesDate(midnight, "2026-09-28"), false);
assert.equal(week.getWeekEvents([midnight], "2026-09-28").length, 0);
assert.equal(
  week.calendarEventEndDate(
    event("local-midnight", "2026-09-27", "2026-09-28T00:00:00"),
  ),
  "2026-09-27",
);

const events = [
  event("outside-after", "2026-09-28"),
  event("period3", "2026-09-22", undefined, "period3"),
  event("outside-before", "2026-09-20"),
  event("period1", "2026-09-22", undefined, "period1"),
  event("cross-week", "2026-09-20", "2026-09-21"),
  event("sunday", "2026-09-27"),
  event("invalid", "invalid"),
];
const before = events.map((item) => item.id);
assert.deepEqual(
  week.getWeekEvents(events, "2026-09-21").map((item) => item.id),
  ["cross-week", "period1", "period3", "sunday"],
);
assert.deepEqual(
  events.map((item) => item.id),
  before,
);
assert.equal(
  week.getWeekEvents(
    Array.from({ length: 12 }, (_, index) =>
      event(`event-${index}`, "2026-09-25"),
    ),
    "2026-09-21",
  ).length,
  12,
);

console.log(
  "Teacher dashboard week checks passed: KST, Monday/Sunday/year boundaries, inclusive stored ranges, timed midnight, sorting and complete weekly list.",
);
