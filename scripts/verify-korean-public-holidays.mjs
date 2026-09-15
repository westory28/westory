import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Exercise the real generator, API refresh, event conversion and sync together.
// Firestore and fetch are replaced so this never writes to a live project.
const writes = [];
const deleted = [];
const firestore = {
  collection: (_db, path) => path,
  doc: (_db, path, id) => `${path}/${id}`,
  query: (path) => path,
  where: () => undefined,
  getDocs: async () => [{ ref: "old-holiday-document" }],
  serverTimestamp: () => "server-timestamp",
  writeBatch: () => ({
    delete: (ref) => deleted.push(ref),
    set: (ref, data) => writes.push({ ref, data }),
    commit: async () => undefined,
  }),
};
const bundled = await build({
  entryPoints: ["src/lib/koreanPublicHolidays.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["firebase/firestore"],
  write: false,
  logLevel: "silent",
});
const require = createRequire(import.meta.url);
const loaded = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  (id) => (id === "firebase/firestore" ? firestore : require(id)),
);
const {
  getKoreanPublicHolidays,
  toHolidayCalendarEvent,
  mergeEventsWithKoreanPublicHolidays,
  ensureKoreanPublicHolidaysSynced,
} = loaded.exports;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
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
      for (const name of ["설날", "추석"]) {
        assert.equal(generated.filter((item) => item.title === name).length, 1);
        assert.equal(
          generated.filter((item) => item.title === `${name} 연휴`).length,
          2,
        );
      }
    }

    // Reproduce KASI's three identical names and wait for the cache refresh.
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
      `${year}: official refresh must preserve the holiday/day-before/day-after distinction`,
    );
  }

  const rawHoliday = { title: "추석", start: "2026-09-24", source: "kasi" };
  const normalized = toHolidayCalendarEvent(rawHoliday);
  assert.equal(normalized.title, "추석 연휴");
  assert.equal(
    normalized.id,
    toHolidayCalendarEvent({ ...rawHoliday, title: "추석 연휴" }).id,
  );
  for (const title of ["추석 대체공휴일", "대체공휴일(추석)", "추석 행사"]) {
    assert.equal(toHolidayCalendarEvent({ ...rawHoliday, title }).title, title);
  }
  assert.equal(
    toHolidayCalendarEvent({
      ...rawHoliday,
      title: "추석 연휴",
      start: "2026-09-25",
    }).title,
    "추석",
  );
  const schoolEvent = {
    id: "school",
    title: "학교 행사",
    start: "2026-09-24",
    eventType: "event",
  };
  assert.deepEqual(
    mergeEventsWithKoreanPublicHolidays(
      [schoolEvent, { ...normalized, title: "추석" }],
      [rawHoliday],
    ),
    [schoolEvent, normalized],
  );

  const today = new Date().toLocaleDateString("en-CA");
  const storage = new Map([["westory:holiday-sync:2026:2", today]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  const result = await ensureKoreanPublicHolidaysSynced({
    db: {},
    year: 2026,
    semester: 2,
  });
  assert.equal(
    result.skipped,
    false,
    "The old daily marker must allow one corrective sync",
  );
  assert.equal(deleted.length, 1);
  for (const date of ["2026-09-24", "2026-09-26"]) {
    assert.equal(
      writes.find(({ data }) => data.start === date)?.data.title,
      "추석 연휴",
    );
  }
  assert.ok(
    writes.every(({ ref }) =>
      ref.startsWith("years/2026/semesters/2/calendar/"),
    ),
  );
  const repeat = await ensureKoreanPublicHolidaysSynced({
    db: {},
    year: 2026,
    semester: 2,
  });
  assert.equal(
    repeat.skipped,
    true,
    "The repaired data should retain daily sync deduplication",
  );
  assert.deepEqual(await getKoreanPublicHolidays("invalid"), []);
  console.log(
    "Korean holiday regression checks passed (2026–2029, API cache, labels, merge, sync).",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
