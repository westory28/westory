/** Real AvatarStudio + existing synthetic adapter; production traffic is blocked. */
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
    () => reject(new Error(`Fixture did not start: ${output.slice(-2000)}`)),
    30_000,
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
    reject(new Error(`Fixture exited ${code}: ${output.slice(-2000)}`));
  });
});
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-refresh-avatar-"),
);
let browser;
try {
  const url = await ready;
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const network = [];
  await page.route("**/*", (route) => {
    const address = route.request().url();
    if (address.startsWith(url) || /^(data|blob):/.test(address))
      return route.continue();
    network.push(address);
    return route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.avatarQa));
  await page.evaluate(() => {
    window.avatarQa.failLoad = true;
  });
  await page.getByRole("button", { name: "꾸미기 화면", exact: true }).click();
  await page.locator(".avatar-studio-status[role=alert]").waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 1);
  await page.evaluate(() => {
    window.avatarQa.failLoad = false;
  });
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 2);
  await page.locator(".avatar-studio-characters button").first().click();
  const draftItem = page.locator(
    '.avatar-studio-items button[title="용신중 하복 남색"]',
  );
  await draftItem.click();
  await page.getByRole("searchbox", { name: "아이템 검색" }).fill("용신중");
  await page
    .locator(".avatar-studio-filter")
    .getByRole("button", { name: "보유", exact: true })
    .click();
  await page.getByLabel("아이템 성별").selectOption("unisex");
  const save = page.getByRole("button", { name: "아바타 저장", exact: true });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "아바타 저장",
    );
    return button && !button.disabled;
  });
  await page.evaluate(() => {
    window.avatarQa.failSave = true;
  });
  await save.click();
  const refresh = page.getByRole("button", {
    name: "아바타 새로고침",
    exact: true,
  });
  await refresh.waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 1);
  assert.equal(await draftItem.getAttribute("aria-pressed"), "true");
  const checkDraft = async () => {
    assert.equal(
      await page.getByRole("searchbox", { name: "아이템 검색" }).inputValue(),
      "용신중",
    );
    assert.equal(await page.getByLabel("아이템 성별").inputValue(), "unisex");
    assert.equal(
      await page
        .locator(".avatar-studio-filter")
        .getByRole("button", { name: "보유", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator('.avatar-studio-items button[title="용신중 하복 남색"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator(".avatar-studio-characters button")
        .first()
        .getAttribute("aria-pressed"),
      "true",
    );
  };
  await checkDraft();
  await page.evaluate(() => {
    window.avatarQa.failLoad = true;
    window.avatarQa.holdLoad = true;
    window.avatarQa.setServerBalance(725);
    window.avatarQa.setCatalogSettings({
      revision: 4,
      prices: { "minimi-top-knit-cream": 345 },
      metadata: {},
    });
  });
  // Two same-turn DOM clicks must still issue one request.
  await refresh.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(
    () =>
      window.avatarQa.loadCalls === 3 && Boolean(window.avatarQa.releaseLoad),
  );
  assert.equal(
    await page.locator(".avatar-studio-status[role=status]").count(),
    1,
  );
  await page.evaluate(() => {
    window.avatarQa.holdLoad = false;
    window.avatarQa.releaseLoad();
  });
  await refresh.waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 3);
  await checkDraft();
  assert.equal(
    (await page.locator(".avatar-studio-wallet strong").textContent()).trim(),
    "500",
  );
  await page.evaluate(() => {
    window.avatarQa.failLoad = false;
  });
  await refresh.click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 4);
  assert.equal(await refresh.count(), 0);
  await checkDraft();
  assert.equal(
    (await page.locator(".avatar-studio-wallet strong").textContent()).trim(),
    "725",
  );
  assert.equal(await page.evaluate(() => window.avatarQa.purchases.length), 0);
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 1);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole("button", { name: `폭 ${width}`, exact: true })
      .click();
    await checkDraft();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(evidence, `preserved-${width}.png`),
      fullPage: true,
    });
  }
  await page.evaluate(() => {
    window.avatarQa.failSave = false;
  });
  await save.click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 1);
  const saved = await page.evaluate(() => window.avatarQa.saves[0]);
  assert.equal(saved.look.top, "mm-school-navy");
  assert.equal(saved.look.character, "girl");
  assert.equal(saved.revision, 1);
  assert.equal(saved.cornerAlpha, 0);
  await page.getByRole("searchbox", { name: "아이템 검색" }).fill("크림 니트");
  await page
    .locator(".avatar-studio-filter")
    .getByRole("button", { name: "전체", exact: true })
    .click();
  assert.match(
    await page
      .locator('.avatar-studio-items button[title="크림 니트"]')
      .textContent(),
    /345/,
  );
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 4);
  assert.deepEqual(await page.evaluate(() => window.avatarQa.errors), []);
  assert.deepEqual(network, []);
  const report = {
    result: "passed",
    widths: [390, 768, 1280],
    initialFailureRetryLoads: 2,
    refreshFailureLoads: 1,
    refreshRetryLoads: 1,
    totalLoads: 4,
    saves: 1,
    unintendedPurchases: 0,
    preserved: [
      "draft look",
      "selected character",
      "search",
      "owned filter",
      "gender filter",
    ],
    refreshed: ["balance", "catalog price"],
    thumbnailCornerAlpha: saved.cornerAlpha,
    blockedRemoteRequests: network.length,
  };
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
} finally {
  await browser?.close();
  fixture.kill();
}
