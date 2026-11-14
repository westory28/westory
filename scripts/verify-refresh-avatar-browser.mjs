/** Real AvatarStudio + existing synthetic adapter; production traffic is blocked. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const metadata = Object.fromEntries(
  catalog.items
    .filter((item) => item.slot === "top")
    .map((item) => [
      item.id,
      {
        label: item.label,
        gender: "unisex",
        description: "새로고침 검증 상품",
      },
    ]),
);
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
let activePage;
try {
  const url = await ready;
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  activePage = page;
  page.on("pageerror", (error) => console.error(error.stack || error.message));
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
    window.avatarQa.ownAll();
  });
  await page.evaluate(
    (metadata) =>
      window.avatarQa.setCatalogSettings({ revision: 1, prices: {}, metadata }),
    metadata,
  );
  await page.getByRole("button", { name: "폭 1280", exact: true }).click();
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
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "아이템 검색" })
    .fill("새로고침 검증");
  const gender = page.getByRole("group", { name: "아이템 성별" });
  await gender.getByRole("button", { name: "공용", exact: true }).click();
  await page.getByRole("button", { name: "2페이지", exact: true }).click();
  const draftLabel = await page
    .locator(".avatar-studio-items button")
    .first()
    .getAttribute("title");
  const draftValue = catalog.items.find(
    (item) => item.label === draftLabel && item.slot === "top",
  ).value;
  const draftItem = page.locator(
    `.avatar-studio-items button[title="${draftLabel}"]`,
  );
  await draftItem.click();
  assert.equal(
    await page.getByRole("group", { name: "아이템 필터", exact: true }).count(),
    0,
    "wardrobe lists owned items without purchase filters",
  );
  assert.equal(
    await page
      .locator(".avatar-studio-wallet, .avatar-shop-item-price")
      .count(),
    0,
    "wardrobe does not display prices or balance",
  );
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
  await save.evaluate((button) => {
    button.click();
    button.click();
  });
  const refresh = page.getByRole("button", {
    name: "아바타 새로고침",
    exact: true,
  });
  await refresh.waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 1);
  assert.equal(await draftItem.getAttribute("aria-pressed"), "true");
  const checkDraft = async () => {
    assert.equal(
      await page
        .locator('.avatar-studio-search input[type="search"]')
        .inputValue(),
      "새로고침 검증",
    );
    assert.equal(
      await gender
        .getByRole("button", { name: "공용", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "2페이지", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(await draftItem.getAttribute("aria-pressed"), "true");
    assert.equal(
      await page
        .locator(".avatar-studio-characters button")
        .first()
        .getAttribute("aria-pressed"),
      "true",
    );
  };
  await checkDraft();
  await page.evaluate((metadata) => {
    window.avatarQa.failLoad = true;
    window.avatarQa.holdLoad = true;
    window.avatarQa.setServerBalance(725);
    window.avatarQa.setCatalogSettings({
      revision: 4,
      prices: { "minimi-top-knit-cream": 345 },
      metadata,
    });
  }, metadata);
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
  assert.equal(await save.count(), 0, "loading does not expose save controls");
  assert.equal(
    await page.getByRole("searchbox", { name: "아이템 검색" }).count(),
    0,
    "loading does not expose stale search controls",
  );
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 1);
  assert.equal(await page.evaluate(() => window.avatarQa.purchases.length), 0);
  await page.evaluate(() => {
    window.avatarQa.holdLoad = false;
    window.avatarQa.releaseLoad();
  });
  await refresh.waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 3);
  await checkDraft();
  assert.equal(await page.locator(".avatar-studio-wallet").count(), 0);
  await page.evaluate(() => {
    window.avatarQa.failLoad = false;
  });
  await refresh.click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 4);
  assert.equal(await refresh.count(), 0);
  await checkDraft();
  assert.equal(await page.locator(".avatar-studio-wallet").count(), 0);
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
  await page.waitForFunction(
    () =>
      document.querySelector(".avatar-studio")?.dataset.rendererReady ===
      "true",
  );
  await save.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(() => window.avatarQa.saves.length === 1);
  const saved = await page.evaluate(() => window.avatarQa.saves[0]);
  assert.equal(saved.look.top, draftValue);
  assert.equal(saved.look.character, "girl");
  assert.equal(saved.revision, 1);
  assert.equal(saved.cornerAlpha, 0);
  assert.equal(
    await page.evaluate(() => window.avatarQa.saveCalls),
    2,
    "two failed/successful explicit saves despite repeated clicks",
  );
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 4);
  await page.evaluate(() => {
    window.avatarQa.failLoad = true;
  });
  await page.getByRole("button", { name: "상점 화면", exact: true }).click();
  await page.locator(".avatar-studio-status[role=alert]").waitFor();
  assert.equal(await page.evaluate(() => window.avatarQa.loadCalls), 5);
  await page.evaluate(() => {
    window.avatarQa.failLoad = false;
  });
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.locator('.avatar-studio[aria-label="아바타 상점"]').waitFor();
  await page.getByRole("button", { name: "상의", exact: true }).click();
  assert.equal(await save.count(), 0, "shop cannot save an avatar");
  assert.equal(
    (await page.locator(".avatar-studio-wallet strong").textContent()).trim(),
    "725",
  );
  await page.getByRole("searchbox", { name: "아이템 검색" }).fill(draftLabel);
  assert.equal(
    await draftItem.getAttribute("aria-pressed"),
    "true",
    "shop restores the saved wardrobe look even when its item is beyond page one",
  );
  await page.getByRole("searchbox", { name: "아이템 검색" }).fill("크림 니트");
  await page.locator('.avatar-studio-items button[title="크림 니트"]').click();
  assert.equal(
    await page
      .locator(
        '.avatar-studio-item[aria-pressed="true"] .avatar-shop-item-price',
      )
      .textContent(),
    "보유",
    "Owned items show ownership without repeating the configured price",
  );
  assert.equal(await page.locator('.avatar-studio-purchase').count(), 0);
  await page
    .getByRole("searchbox", { name: "아이템 검색" })
    .fill("새로고침 검증");
  await page
    .getByRole("group", { name: "아이템 필터", exact: true })
    .getByRole("button", { name: "보유", exact: true })
    .click();
  await gender.getByRole("button", { name: "공용", exact: true }).click();
  await page.getByRole("button", { name: "2페이지", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    6,
    "search, gender, ownership filters and pagination perform no extra reads",
  );
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 2);
  assert.equal(await page.evaluate(() => window.avatarQa.purchases.length), 0);
  assert.deepEqual(await page.evaluate(() => window.avatarQa.errors), []);
  assert.deepEqual(network, []);
  const report = {
    result: "passed",
    widths: [390, 768, 1280],
    initialFailureRetryLoads: 2,
    refreshFailureLoads: 1,
    refreshRetryLoads: 1,
    shopFailureRetryLoads: 2,
    totalLoads: 6,
    saveCalls: 2,
    saves: 1,
    unintendedPurchases: 0,
    preserved: [
      "draft look",
      "selected character",
      "search",
      "gender filter",
      "pagination page 2",
    ],
    refreshed: [
      "balance and owned-item display in shop",
      "saved appearance after wardrobe save",
    ],
    localShopControlsNoRequests: [
      "search",
      "owned filter",
      "gender",
      "pagination",
    ],
    thumbnailCornerAlpha: saved.cornerAlpha,
    blockedRemoteRequests: network.length,
  };
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({ path: path.join(evidence, "failure.png"), fullPage: true })
      .catch(() => {});
    await fs.writeFile(
      path.join(evidence, "failure.html"),
      await activePage.content(),
    );
    console.error(
      JSON.stringify({
        evidence,
        errors: await activePage.evaluate(() => window.avatarQa?.errors),
      }),
    );
  }
  throw error;
} finally {
  await browser?.close();
  fixture.kill();
}
