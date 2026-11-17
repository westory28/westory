/** Real shop/wardrobe components, synthetic adapter only; never contacts Firebase. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const evidence = path.resolve(
  root,
  "output/avatar-purchase-tiers-20261117/student",
);
await fs.mkdir(evidence, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["scripts/verify-avatar-ui.mjs", "--serve"],
  {
    cwd: root,
    env: { ...process.env, AVATAR_QA_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let output = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(Error(`Fixture did not start: ${output.slice(-2000)}`)),
    30000,
  );
  fixture.stdout.on("data", (chunk) => {
    output += chunk;
    const url = /CUA_FIXTURE_URL=(http:\/\/127\.0\.0\.1:\d+\/)/.exec(
      output,
    )?.[1];
    if (url) {
      clearTimeout(timer);
      resolve(url);
    }
  });
  fixture.stderr.on("data", (chunk) => {
    output += chunk;
  });
  fixture.on("exit", (code) => {
    clearTimeout(timer);
    reject(Error(`Fixture exited ${code}: ${output.slice(-2000)}`));
  });
});
let browser;
const reports = [];
try {
  const url = await ready;
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [],
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const address = route.request().url();
      if (address.startsWith(url) || /^(data|blob):/.test(address))
        return route.continue();
      external.push(address);
      return route.abort();
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const item = () =>
      page.locator('.avatar-studio-items button[title="크림 니트"]');
    const showItem = async (mode = "상점 화면") => {
      await button("순위 화면").click();
      await button(mode).click();
      await page.locator(".avatar-studio").waitFor();
      await button("여학생 아바타").click();
      await button("상의").click();
      const search = page.getByRole("searchbox", {
        name: "아이템 검색",
        exact: true,
      });
      if (!(await search.isVisible())) await button("아이템 검색 열기").click();
      await search.fill("크림 니트");
      await item().click();
    };
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.avatarQa));
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_1";
      window.avatarQa.allowedPurchaseTiers = ["tier_1"];
      window.avatarQa.setCatalogSettings({
        revision: 1,
        prices: {},
        purchaseTiers: { "minimi-top-knit-cream": "tier_4" },
      });
    });
    await button(`폭 ${width}`).click();
    await showItem();
    assert.equal(
      await item().getAttribute("aria-pressed"),
      "true",
      "Locked items can still be previewed",
    );
    assert.equal(
      await item().locator(".avatar-shop-item-tier").getAttribute("aria-label"),
      "양반 이상 · 잠김",
    );
    assert(await button("양반 이상 구매 가능").isDisabled());
    await button("양반 이상 구매 가능").evaluate((el) => el.click());
    assert.equal(
      await page.evaluate(() => window.avatarQa.purchaseAttempts || 0),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.avatarQa.loadCalls),
      1,
      "Filters/preview do not fetch",
    );
    const layout = await page.locator(".avatar-studio").evaluate((el) => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      background: getComputedStyle(el.querySelector(".avatar-studio-heading"))
        .backgroundColor,
      shadow: getComputedStyle(el.querySelector(".avatar-studio-heading"))
        .boxShadow,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.background, "rgba(0, 0, 0, 0)");
    assert.equal(layout.shadow, "none");
    await page.screenshot({
      path: path.join(evidence, `locked-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_5";
      window.avatarQa.allowedPurchaseTiers = undefined;
    });
    await showItem();
    assert(
      await button("양반 이상 구매 가능").isDisabled(),
      "A known raw rank without the authoritative allowed set fails closed",
    );
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_5";
      window.avatarQa.allowedPurchaseTiers = [
        "tier_1",
        "tier_2",
        "tier_3",
        "tier_5",
      ];
    });
    await showItem();
    assert(
      await button("양반 이상 구매 가능").isDisabled(),
      "Reordered/removed policy tiers cannot be inferred from numeric codes",
    );
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_5";
      window.avatarQa.allowedPurchaseTiers = ["tier_4", "invalid"];
    });
    await showItem();
    assert(
      await button("양반 이상 구매 가능").isDisabled(),
      "Malformed allowed set fails closed",
    );
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_6";
      window.avatarQa.allowedPurchaseTiers = [
        "tier_1",
        "tier_2",
        "tier_3",
        "tier_4",
        "tier_5",
      ];
      window.avatarQa.rejectPurchaseTier = "tier_2";
      window.avatarQa.rejectedAllowedPurchaseTiers = ["tier_1", "tier_2"];
    });
    await showItem();
    const buy = page.locator(".avatar-studio-purchase");
    assert.equal(
      await buy.isDisabled(),
      false,
      "A custom higher tier can unlock all lower required tiers",
    );
    await buy.click();
    const dialog = page.getByRole("dialog", { name: "아이템 구매" });
    assert.match(await dialog.textContent(), /양반 이상 구매 가능/);
    await dialog.getByRole("button", { name: "구매하기", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert(
      await button("양반 이상 구매 가능").isDisabled(),
      "Server rank rejection updates local eligibility",
    );
    assert.equal(
      await page.evaluate(() => window.avatarQa.purchases.length),
      0,
    );
    assert.match(
      await page.locator(".avatar-studio-error").textContent(),
      /양반 이상만 구매/,
    );
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_4";
      window.avatarQa.allowedPurchaseTiers = [
        "tier_1",
        "tier_2",
        "tier_3",
        "tier_4",
      ];
      window.avatarQa.rejectPurchaseTier = null;
    });
    await showItem();
    await buy.click();
    await dialog.getByRole("button", { name: "구매하기", exact: true }).click();
    await page.waitForFunction(() => window.avatarQa.purchases.length === 1);
    assert.equal(await buy.count(), 0, "Owned item has no purchase action");
    await page.evaluate(() => {
      window.avatarQa.purchaseTierCode = "tier_1";
      window.avatarQa.allowedPurchaseTiers = ["tier_1"];
    });
    await showItem("꾸미기 화면");
    assert.equal(
      await item().getAttribute("aria-pressed"),
      "true",
      "Rank decrease preserves owned clothing",
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".avatar-studio")?.dataset.rendererReady ===
        "true",
    );
    assert.equal(await button("아바타 저장").isDisabled(), false);
    assert.equal(
      await page.locator(".avatar-shop-item-tier").count(),
      0,
      "Wardrobe has no shop restriction clutter",
    );
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    reports.push({
      width,
      ...layout,
      ...(await page.evaluate(() => ({
        loads: window.avatarQa.loadCalls,
        attempts: window.avatarQa.purchaseAttempts,
        purchases: window.avatarQa.purchases.length,
        saves: window.avatarQa.saveCalls,
      }))),
    });
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(
    "PASS: 390/768/1280px rank locks, missing/malformed eligibility, extended/reordered policy ranks, authoritative denial/retry, ownership preservation, transparent headings and no external requests.",
  );
} finally {
  await browser?.close();
  fixture.kill();
}
