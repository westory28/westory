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
assert.equal(week.getWeekStart("2026-09-27"), "2026-09-27");
assert.equal(week.getWeekStart("2026-09-28"), "2026-09-27");
assert.equal(week.getWeekStart("2026-10-03"), "2026-09-27");
assert.equal(week.getWeekStart("2026-10-04"), "2026-10-04");
assert.equal(week.getWeekStart("2026-01-01"), "2025-12-28");
assert.equal(week.shiftCalendarDate("2026-09-27", 6), "2026-10-03");
assert.equal(week.shiftCalendarDate("2026-09-27", -7), "2026-09-20");
assert.equal(week.shiftCalendarDate("2026-09-27", 7), "2026-10-04");
assert.equal(week.shiftCalendarDate("2024-02-28", 1), "2024-02-29");
assert.equal(week.calendarDateKey("2026-02-30"), "");
assert.equal(week.calendarDateKey("invalid"), "");
assert.equal(week.calendarDateKey("2026-09-27T15:00:00Z"), "2026-09-28");

// The production calendar editor saves inclusive date-only ends.
const inclusive = event("inclusive", "2026-09-25", "2026-09-28");
assert.equal(week.eventIncludesDate(inclusive, "2026-09-28"), true);
assert.equal(week.eventIncludesDate(inclusive, "2026-09-29"), false);
assert.equal(week.getWeekEvents([inclusive], "2026-09-27").length, 1);
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
assert.equal(week.getWeekEvents([midnight], "2026-09-27").length, 1);
assert.equal(week.getWeekEvents([midnight], "2026-09-20").length, 0);
assert.equal(
  week.calendarEventEndDate(
    event("local-midnight", "2026-09-27", "2026-09-28T00:00:00"),
  ),
  "2026-09-27",
);

for (const [item, full, compact] of [
  [event("one-day", "2026-10-19"), "10월 19일", "10/19"],
  [event("same-day", "2026-10-19", "2026-10-19"), "10월 19일", "10/19"],
  [event("same-month", "2026-10-19", "2026-10-22"), "10월 19–22일", "10/19–22"],
  [
    event("cross-month", "2026-10-30", "2026-11-02"),
    "10월 30일–11월 2일",
    "10/30–11/2",
  ],
  [
    event("cross-year", "2026-12-31", "2027-01-02"),
    "2026년 12월 31일–2027년 1월 2일",
    "2026/12/31–2027/1/2",
  ],
  [
    event("same-month-next-year", "2026-10-19", "2027-10-22"),
    "2026년 10월 19일–2027년 10월 22일",
    "2026/10/19–2027/10/22",
  ],
  [
    event("leap-day", "2024-02-28", "2024-03-01"),
    "2월 28일–3월 1일",
    "2/28–3/1",
  ],
  [event("reversed-end", "2026-10-19", "2026-10-18"), "10월 19일", "10/19"],
  [
    event("zoned", "2026-10-18T15:00:00Z", "2026-10-22T15:00:00Z"),
    "10월 19–22일",
    "10/19–22",
  ],
  [midnight, "9월 27일", "9/27"],
  [event("invalid", "invalid"), "", ""],
]) {
  assert.equal(week.formatCalendarEventDateRange(item), full, item.id);
  assert.equal(week.formatCalendarEventDateRange(item, true), compact, item.id);
}

const events = [
  event("outside-after", "2026-09-27"),
  event("period3", "2026-09-22", undefined, "period3"),
  event("outside-before", "2026-09-19"),
  event("period1", "2026-09-22", undefined, "period1"),
  event("cross-week", "2026-09-19", "2026-09-20"),
  event("sunday", "2026-09-20"),
  event("saturday", "2026-09-26"),
  event("invalid", "invalid"),
];
const before = events.map((item) => item.id);
assert.deepEqual(
  week.getWeekEvents(events, "2026-09-20").map((item) => item.id),
  ["cross-week", "sunday", "period1", "period3", "saturday"],
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
    "2026-09-20",
  ).length,
  12,
);

console.log(
  "Teacher dashboard week checks passed: KST, Sunday–Saturday/month/year boundaries, inclusive stored ranges, timed midnight, complete date labels, sorting and complete weekly list.",
);
