/** Responsive toolbar QA against the actual history classroom with isolated data. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-history-toolbar-"),
);
const fixture = spawn(
  process.execPath,
  [
    "scripts/verify-history-classroom-teacher-browser.mjs",
    "--serve",
    "--port=0",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
let browser;
const reports = [];
try {
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "History fixture startup timed out: " + output.slice(-2000),
          ),
        ),
      30000,
    );
    fixture.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    fixture.stderr.on("data", (chunk) => {
      output += chunk;
    });
    fixture.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`History fixture exited ${code}: ${output.slice(-2000)}`),
      );
    });
  });
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
  for (const scenario of [
    { width: 320 },
    { width: 390 },
    { width: 768 },
    { width: 1280 },
    { width: 1440 },
    { width: 1280, contentWidth: 400 },
  ]) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + "/")
      )
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + "/?scenario=dashboard");
    await page.locator(".history-dashboard article").first().waitFor();
    await page.addStyleTag({
      content:
        "#fixture-toolbar,#fixture-records{display:none}" +
        (scenario.contentWidth
          ? `.history-classroom{width:${scenario.contentWidth}px}`
          : ""),
    });
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          height: box.height,
          width: box.width,
        };
      };
      return {
        date: rect(".history-date-label"),
        sort: rect(".history-sort-label"),
        actions: rect(".history-filter-actions"),
        title: rect(".history-heading"),
        headingActions: rect(".history-heading-actions"),
        controls: [
          ...document.querySelectorAll(".history-heading-actions button"),
        ].map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
        dateText: document.querySelector(".history-date-label > span")
          .textContent,
        dateTextHeight: document
          .querySelector(".history-date-label > span")
          .getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert(
      Math.abs(geometry.date.y - geometry.sort.y) <= 1,
      "Date and sort share a row: " + JSON.stringify(geometry),
    );
    assert(
      geometry.date.right <= geometry.sort.x + 1 ||
        geometry.sort.right <= geometry.date.x + 1,
      "Date and sort cannot overlap",
    );
    assert(
      geometry.dateTextHeight <= geometry.date.height - 2,
      "Complete date range fits inside its container",
    );
    assert(
      Math.abs(geometry.headingActions.right - geometry.title.right) <= 1,
      "Heading actions align right",
    );
    assert(
      geometry.controls.every(
        (control) => control.width >= 44 && control.height >= 44,
      ),
      "Header controls retain touch targets",
    );
    assert(!geometry.overflow, "Page must not scroll horizontally");
    const beforeReads = await page.evaluate(
      () => window.__fixture.reads.length,
    );
    await page
      .getByRole("combobox", { name: "정렬 기준", exact: true })
      .selectOption("oldest");
    assert.equal(
      await page
        .getByRole("combobox", { name: "정렬 기준", exact: true })
        .inputValue(),
      "oldest",
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.reads.length),
      beforeReads,
      "Sorting adds no data reads",
    );
    const toolbar = page.locator(".history-filter-actions");
    const oldHeight = (await toolbar.boundingBox()).height;
    const search = page.getByRole("button", {
      name: "과제 검색 열기",
      exact: true,
    });
    await search.click();
    const input = page.getByRole("searchbox", {
      name: "과제명, 학생 이름, 학번 검색",
      exact: true,
    });
    await input.fill("존재하지 않는 검증 과제");
    await page
      .getByText("현재 검색 조건에 맞는 역사교실이 없습니다.")
      .waitFor();
    assert.equal(
      (await toolbar.boundingBox()).height,
      oldHeight,
      "Search expansion keeps the action row height",
    );
    await input.press("Escape");
    await page.locator(".history-dashboard article").first().waitFor();
    assert.equal(
      await search.evaluate((button) => button === document.activeElement),
      true,
      "Escape returns focus to search",
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.reads.length),
      beforeReads,
      "Search adds no data reads",
    );
    await page
      .getByRole("button", { name: "새 역사교실", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => window.__fixture.writes.length + window.__fixture.commands.length,
      ),
      0,
      "No fixture writes or commands",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    const name = `${scenario.width}${scenario.contentWidth ? "-content-" + scenario.contentWidth : ""}`;
    await page.screenshot({
      path: path.join(evidence, `history-toolbar-${name}.png`),
      fullPage: false,
    });
    reports.push({
      ...scenario,
      geometry,
      reads: beforeReads,
      writes: 0,
      externalRequests: 0,
      status: "passed",
    });
    await page.close();
    console.log("PASS history toolbar", name);
  }
} finally {
  await browser?.close();
  fixture.kill();
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log("Evidence:", evidence);
}
