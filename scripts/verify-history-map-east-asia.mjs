import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const out = path.resolve("output/atlas-east-asia-20261020/browser");
await mkdir(out, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["scripts/verify-history-map-ui.mjs", "--serve"],
  {
    cwd: process.cwd(),
    env: { ...process.env, ATLAS_UI_EVIDENCE: out },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let fixtureOutput = "";
fixture.stderr.on("data", (chunk) => {
  fixtureOutput += chunk;
});
const origin = await new Promise((resolve, reject) => {
  fixture.stdout.on("data", (chunk) => {
    fixtureOutput += chunk;
    const match = fixtureOutput.match(/Atlas UI fixture: (http:\/\/[^\s]+)/);
    if (match) resolve(match[1]);
  });
  fixture.on("exit", (code) =>
    reject(new Error(`Fixture exited ${code}: ${fixtureOutput}`)),
  );
});
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const checks = [],
  errors = [];
let activePage;
const widths = (process.env.ATLAS_EAST_ASIA_WIDTHS || "390,768,1280,1366")
  .split(",")
  .map(Number);
try {
  for (const width of widths) {
    for (const [view, label] of [
      ["korea", "한국사"],
      ["world", "세계사"],
      ["globe", "지구본"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1366 ? 768 : 900 },
        reducedMotion: "reduce",
      });
      activePage = page;
      let assetRequests = 0;
      page.on("pageerror", (error) =>
        errors.push(`${width}/${view}: ${error.message}`),
      );
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/assets/"))
          assetRequests++;
      });
      await page.goto(origin);
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForLoadState("networkidle");
      const search = page.getByRole("searchbox", {
        name: "지명 검색",
        exact: true,
      });
      const openGlobePlace = async (title) => {
        if (view !== "globe") return;
        const toggle = page.locator(".history-globe__list-toggle");
        if (await toggle.count()) await toggle.click();
        await page
          .locator(".history-globe__rows:visible")
          .getByRole("button", { name: title, exact: true })
          .click();
      };
      // The static suite checks every catalogue entry. Here cover a vague
      // historical region, a river, terrain and a Chinese regional name.
      for (const [query, title] of [
        ["요동", "요동"],
        ["요서", "요서"],
        ["간도", "간도"],
        ["강남지방", "강남"],
        ["요하", "랴오허강"],
        ["타클라마칸", "타클라마칸사막"],
      ]) {
        await search.fill(query);
        await openGlobePlace(title);
        const popup = page.locator(
          view === "globe"
            ? ".history-globe__popup"
            : ".history-atlas__overlay",
        );
        await popup
          .getByRole("heading", { name: title, exact: true })
          .waitFor();
        await page.waitForFunction(
          () => !document.querySelector(".history-atlas--focusing"),
        );
        await page.waitForLoadState("networkidle");
        const reading = await popup.evaluate((element) => {
          const body = element.querySelector(".atlas-place-details__body");
          const text = body.querySelector(".atlas-place-details__definition");
          return {
            bodyOverflow: getComputedStyle(body).overflowY,
            bodyHeight: body.clientHeight,
            bodyWidth: body.clientWidth,
            scrollWidth: body.scrollWidth,
            font: getComputedStyle(text).fontSize,
            lineHeight: getComputedStyle(text).lineHeight,
            text: text.textContent,
          };
        });
        assert.equal(reading.bodyOverflow, "auto");
        assert.equal(reading.font, "16px");
        assert.equal(reading.lineHeight, "26.4px");
        assert(
          reading.bodyHeight > 60 &&
            reading.scrollWidth <= reading.bodyWidth + 1,
        );
        assert(reading.text.length > 20);
        if (query === "요하" && view !== "globe")
          assert(
            await page.locator(".history-atlas__river-selected").count(),
            "Liao uses a river path",
          );
        if (query === "타클라마칸" && view !== "globe")
          assert(
            await page.locator(".history-atlas__landform.is-active").count(),
            "Taklamakan uses source terrain",
          );
        if (query === "강남지방" && view === "globe")
          assert.equal(
            await page
              .locator('[data-globe-country][aria-pressed="true"]:visible')
              .count(),
            0,
            "A historical region must not paint all of China",
          );
        const zoom = await page
          .locator(
            view === "globe" ? ".history-globe__zoom" : ".history-atlas__zoom",
          )
          .textContent();
        const beforeRequests = assetRequests;
        await page
          .getByRole("button", { name: "장소 설명 닫기", exact: true })
          .click();
        await popup.waitFor({ state: "hidden" });
        // Give effects and the final paint enough time to reveal accidental
        // reselection or refetch. No fixed sleep is used for camera settling.
        await page.waitForFunction(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(true)),
              );
            }),
        );
        assert.equal(
          await page
            .locator(
              view === "globe"
                ? ".history-globe__zoom"
                : ".history-atlas__zoom",
            )
            .textContent(),
          zoom,
          "Closing retains zoom",
        );
        assert.equal(
          assetRequests,
          beforeRequests,
          "Closing must not refetch map assets",
        );
        assert.equal(
          await page
            .locator(
              view === "globe"
                ? '[data-globe-label][aria-pressed="true"]:visible, [data-globe-country][aria-pressed="true"]:visible, [data-globe-region][aria-pressed="true"]:visible'
                : ".history-atlas__point.is-active, .history-atlas__landform.is-active, .history-atlas__country.is-active, .history-atlas__river-selected",
            )
            .count(),
          0,
          "Closing clears every highlight",
        );
        checks.push({ width, view, query, zoom, reading });
      }
      await search.fill("만주");
      await openGlobePlace("만주");
      await page.locator(".atlas-place-details__body").waitFor();
      await page.screenshot({
        path: path.join(out, `${view}-${width}.png`),
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No document horizontal overflow",
      );
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    `East Asia UI verified: ${checks.length} search/reading/close flows; ${widths.length} widths; no new asset traffic on close.`,
  );
} catch (error) {
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({
      path: path.join(out, "failure.png"),
      fullPage: true,
    });
  throw error;
} finally {
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  fixture.kill();
}
