/** Catalog/preview checks only. Never connects to Firebase or registers stocks. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.join(root, "output/wispi-market-20261114/catalog");
await fs.mkdir(evidence, { recursive: true });
const checks = [];
const bundle = await build({
  entryPoints: [path.join(root, "src/lib/wisStockCatalog.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(
  module,
  module.exports,
);
const {
  wisStockCatalog: catalog,
  wisStockCatalogWeeks: weeks,
  wisStockPlanSessions: sessions,
  getWisStockTemplateSettings: settingsFor,
  getWisStockPlanHistory: historyFor,
  createWisStockPlanStocks: stocksFor,
} = module.exports;
assert.equal(catalog.length, 80);
assert.equal(weeks.length, 6);
assert.equal(new Set(catalog.map((row) => row.id)).size, 80);
assert.equal(new Set(catalog.map((row) => row.sourceId)).size, 80);
assert.deepEqual(
  Array.from(
    { length: 7 },
    (_, week) => catalog.filter((row) => row.week === week).length,
  ),
  [10, 10, 10, 10, 10, 15, 15],
);
const week5 = ["e6-01", "e6-02", "e6-03", "e6-04", "e6-10"];
for (const row of catalog) {
  assert.match(row.id, /^stock_[a-f0-9]{24}$/);
  assert(row.week >= 0 && row.week <= 6);
  if (row.sourceId.startsWith("e6-"))
    assert.equal(row.week, week5.includes(row.sourceId) ? 5 : 6);
  assert(row.fact && row.sourceTitle && row.logoConcept && row.acronym);
  for (const url of row.sourceUrls)
    assert.equal(new URL(url).protocol, "https:");
  for (const key of ["riseReason", "fallReason", "exitReason"])
    assert(row[key].startsWith("게임 설정:"), row.sourceId);
  assert(
    row.listingSession < row.riseSession && row.riseSession < row.fallSession,
  );
  assert(
    row.exitSession === null ||
      (row.fallSession < row.exitSession && row.exitSession <= 210),
  );
  if (row.week)
    assert(
      row.listingSession >= (row.week - 1) * 35 + 1 &&
        row.listingSession <= row.week * 35,
    );
  if (row.growthProfile === "VALUE") {
    assert.equal(row.week, 0);
    assert.equal(row.exitKind, "survive");
    assert.equal(row.exitSession, null);
  }
  const settings = settingsFor(row.id);
  assert.equal(settings.automatic, false);
  assert.equal(settings.name, row.name);
  assert.equal(settings.growthProfile, row.growthProfile);
  settings.name = "mutated draft";
  assert.equal(settingsFor(row.id).name, row.name);
}
assert.throws(() => settingsFor("not-a-catalog-id"), RangeError);
checks.push(
  "80 unique order-compatible IDs; 10 always-on VALUE + 70 historical drafts across exactly six weeks; dates and game-only events are explicit; no automatic registration.",
);

assert.equal(sessions.length, 210);
for (let index = 0; index < sessions.length; index++) {
  const session = sessions[index],
    kst = new Date(session.atMs + 9 * 3_600_000);
  assert.equal(session.session, index + 1);
  assert(kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5);
  assert(kst.getUTCHours() >= 9 && kst.getUTCHours() <= 15);
  if (index) assert(session.atMs > sessions[index - 1].atMs);
}
assert.equal(sessions.at(-1).week, 6);
const start = performance.now(),
  stocks = stocksFor(),
  firstComputeMs = performance.now() - start;
assert.equal(stocks.length, 80);
const valueReturns = [];
for (const stock of stocks) {
  const entry = catalog.find((row) => row.id === stock.id),
    all = historyFor(stock.id);
  assert.equal(all.length, 210);
  assert.equal(stock.nextTickAtMs, 0);
  assert.equal(stock.settings.automatic, false);
  assert.equal(
    stock.settings.tradingStatus,
    entry.exitSession === null ? "ACTIVE" : "HALTED",
  );
  const active = all.filter((point) => point.price !== null);
  assert.equal(active[0].session, entry.listingSession);
  assert.equal(active.at(-1).session, entry.exitSession ?? 210);
  assert.equal(stock.history.length, active.length);
  let down = 0,
    up = 0,
    changeCount = 0;
  let currentDay = "";
  let dayOpenPrice = active[0].price;
  for (let index = 0; index < active.length; index++) {
    const point = active[index];
    const day = `${point.week}-${point.dayIndex}`;
    if (currentDay !== day) {
      currentDay = day;
      dayOpenPrice = index ? active[index - 1].price : point.price;
    }
    assert(
      point.price >= Math.max(1, Math.ceil(dayOpenPrice * 0.7)) &&
        point.price <= Math.floor(dayOpenPrice * 1.3),
      "daily ±30% bound",
    );
    assert(
      Number.isSafeInteger(point.price) &&
        point.price >= 1 &&
        point.price <= 1_000_000,
    );
    if (index) {
      const previous = active[index - 1].price,
        delta = point.price - previous;
      if (delta < 0) down++;
      if (delta > 0) up++;
      if (delta) changeCount++;
      assert(
        Math.abs(delta) <= Math.ceil(previous * 0.3) + 1,
        "bounded model movement",
      );
    }
  }
  assert(changeCount > 0, entry.sourceId + " must have a non-empty scenario");
  if (entry.week === 0) {
    const gain = active.at(-1).price / active[0].price - 1;
    valueReturns.push({ id: entry.sourceId, gain, up, down });
    assert(gain > 0, entry.sourceId + " illustrative long-term growth");
    assert(down > 0, entry.sourceId + " includes corrections");
  }
  all[0].price = -5;
  assert.notEqual(historyFor(stock.id)[0].price, -5);
}
stocks[0].history[0].price = -10;
assert.notEqual(stocksFor()[0].history[0].price, -10);
checks.push(
  "210 weekday 09:00–15:00 KST sessions; delayed listing and exit nulls; bounded multi-session trends; stable cached histories; all VALUE examples rise over six weeks with down moves.",
);

const sourceFlag = process.argv.indexOf("--source");
if (sourceFlag !== -1) {
  const source = JSON.parse(
    await fs.readFile(process.argv[sourceFlag + 1], "utf8"),
  );
  for (const original of source.companies) {
    const entry = catalog.find((row) => row.sourceId === original.id);
    for (const key of ["name", "fact", "sourceTitle", "sourceKind"])
      assert.equal(entry[key], original[key]);
    assert.deepEqual(entry.sourceUrls, original.sourceUrls || []);
    assert.equal(entry.sourceNote, original.sourceNote || "");
    const logo = await fs.readFile(
      path.join(root, "public", entry.logoUrl),
      "utf8",
    );
    assert(logo.includes(original.mark));
    assert(logo.includes(original.brand));
  }
  checks.push(
    "Original 60 facts, titles, source links, source distinctions/notes, logo marks and colors match the supplied planning source exactly.",
  );
}
const logoFiles = new Map();
for (const row of catalog) {
  const file = await fs.readFile(
    path.join(root, "public", row.logoUrl),
    "utf8",
  );
  assert.match(file, /<svg\b[^>]*width="48"[^>]*height="48"/);
  assert.match(file, /viewBox="0 0 64 64"/);
  assert(
    !/<\s*(?:script|image|foreignObject|use)\b|\bon\w+\s*=|(?:href|src)\s*=/i.test(
      file,
    ),
  );
  logoFiles.set(row.logoUrl, file);
}
assert.equal(new Set(logoFiles.values()).size, 80);
checks.push(
  "80 independent 48×48 vector assets; local-only paths, no scripts, remote images, external references, or reused new-logo artwork.",
);

const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{margin:24px;background:#f8fafc;font:14px Arial,sans-serif;color:#1f2937}main{display:grid;grid-template-columns:repeat(10,1fr);gap:16px}figure{margin:0;min-height:104px;text-align:center}img{width:48px;height:48px}figcaption{margin-top:8px;font-size:12px}small{display:block;color:#64748b}</style><h1>위스피 교사용 기획 초안 · 80개 로고</h1><main>${catalog.map((row) => `<figure><img src="${row.logoUrl}" alt="${escape(row.name)}"><figcaption>${escape(row.name)}<small>${escape(row.sourceId)}</small></figcaption></figure>`).join("")}</main></html>`;
await fs.writeFile(path.join(evidence, "logos.html"), html);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost").pathname;
  res.setHeader(
    "Content-Type",
    logoFiles.has(url) ? "image/svg+xml" : "text/html;charset=utf-8",
  );
  res.end(logoFiles.get(url) || html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  await page.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth === 48,
    ),
  );
  const pixels = await page.evaluate(() =>
    [...document.images].map((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, 48, 48).data;
      let visible = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 30) visible++;
      return visible;
    }),
  );
  assert(pixels.every((count) => count > 25));
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(evidence, "logos-80.png"),
    fullPage: true,
  });
  checks.push(
    "Real browser renders every SVG without errors; all 80 logos have visible nontransparent pixels; contact sheet captured.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
const report = {
  status: "PASS",
  checks,
  firstComputeMs: Math.round(firstComputeMs),
  valueReturns,
  evidence,
};
await fs.writeFile(
  path.join(evidence, "summary.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
