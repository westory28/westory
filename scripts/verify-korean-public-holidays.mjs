import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Actual holiday generation, official-cache refresh and view projection.
// Only HTTP is synthetic; no Firestore adapter or persistence is involved.
const bundled = await build({
  entryPoints: ["src/lib/koreanPublicHolidays.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
});
const loaded = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  createRequire(import.meta.url),
);
const {
  getKoreanPublicHolidays,
  toHolidayCalendarEvent,
  mergeEventsWithKoreanPublicHolidays,
} = loaded.exports;
const originalFetch = globalThis.fetch;
const pending = new Map();
globalThis.fetch = (url) =>
  new Promise((resolve) =>
    pending.set(Number(String(url).split("=")[1]), resolve),
  );

try {
  for (const year of [2026, 2027, 2028, 2029]) {
    const generated = await getKoreanPublicHolidays(year);
    const titleAt = (items, date) =>
      items.find((item) => item.start === date)?.title;
    if (year === 2026) {
      assert.equal(titleAt(generated, "2026-09-24"), "추석 연휴");
      assert.equal(titleAt(generated, "2026-09-25"), "추석");
      assert.equal(titleAt(generated, "2026-09-26"), "추석 연휴");
    }
    // Other years can overlap a lunar holiday with a named national holiday.
    if (year === 2026)
      for (const name of ["설날", "추석"]) {
        assert.equal(generated.filter((item) => item.title === name).length, 1);
        assert.equal(
          generated.filter((item) => item.title === `${name} 연휴`).length,
          2,
        );
      }
    pending.get(year)({
      ok: true,
      json: async () => ({
        holidays: generated.map((item) => ({
          ...item,
          title: item.title.replace(/^(설날|추석) 연휴$/, "$1"),
        })),
      }),
    });
    await new Promise(setImmediate);
    const official = await getKoreanPublicHolidays(year);
    assert.ok(official.every((item) => item.source === "kasi"));
    assert.deepEqual(
      official.map(({ title, start }) => ({ title, start })),
      generated.map(({ title, start }) => ({ title, start })),
      `${year} official names must keep the holiday/day-before/day-after distinction`,
    );
  }
  const raw = { title: "추석", start: "2026-09-24", source: "kasi" };
  const normalized = toHolidayCalendarEvent(raw);
  assert.equal(normalized.title, "추석 연휴");
  assert.equal(
    normalized.id,
    toHolidayCalendarEvent({ ...raw, title: "추석 연휴" }).id,
  );
  assert.equal(
    toHolidayCalendarEvent({ ...raw, title: "추석 연휴", start: "2026-09-25" })
      .title,
    "추석",
  );
  for (const title of ["추석 대체공휴일", "대체공휴일(추석)", "추석 행사"])
    assert.equal(toHolidayCalendarEvent({ ...raw, title }).title, title);
  const event = {
    id: "school",
    title: "학교 행사",
    start: "2026-09-24",
    eventType: "event",
  };
  assert.deepEqual(
    mergeEventsWithKoreanPublicHolidays(
      [event, { ...normalized, title: "추석" }],
      [raw],
    ),
    [event, normalized],
  );
  assert.deepEqual(await getKoreanPublicHolidays("invalid"), []);
  assert.equal(
    "ensureKoreanPublicHolidaysSynced" in loaded.exports,
    false,
    "The restored UI must not reintroduce holiday write-on-read",
  );
  console.log(
    JSON.stringify({
      suite: "korean-public-holidays",
      passed: true,
      years: [2026, 2027, 2028, 2029],
      officialRefresh: true,
      projectionNormalization: true,
      persistence: 0,
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
}
