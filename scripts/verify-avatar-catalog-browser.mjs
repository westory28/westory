/** Exercise the actual AvatarStudio against the isolated verify-avatar-ui fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

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
const origin = process.env.AVATAR_QA_URL || "http://127.0.0.1:4181";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local fixture only");
const evidence =
  process.env.AVATAR_QA_EVIDENCE ||
  path.join(os.tmpdir(), "westory-avatar-catalog-qa");
await fs.mkdir(evidence, { recursive: true });
const browser = await playwright.chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  route.request().url().startsWith(origin) ||
  /^(data|blob):/.test(route.request().url())
    ? route.continue()
    : route.abort(),
);
const screenshots = [];
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "꾸미기 화면", exact: true }).click();
  await page.getByRole("button", { name: /^여학생 아바타/ }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".avatar-studio-save .avatar-primary")?.disabled,
  );
  await page.getByRole("button", { name: /아이보리 저고리/ }).click();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole("button", { name: `폭 ${width}`, exact: true })
      .click();
    await page
      .locator(".avatar-studio-item")
      .filter({ hasText: "아이보리 저고리" })
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          ".avatar-studio-item .avatar-item-preview img",
        ),
      ]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        })
        .every((image) => image.complete && image.naturalWidth === 256),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Page overflow ${width}`,
    );
    assert.equal(
      await page.locator(".avatar-studio canvas").count(),
      1,
      "Only the selected avatar has a WebGL canvas",
    );
    await page.locator(".avatar-studio").scrollIntoViewIfNeeded();
    const file = path.join(evidence, `student-studio-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("button", { name: "헤어", exact: true }).click();
  const hairButtons = page.locator(".avatar-studio-item");
  assert((await hairButtons.count()) >= 5, "Distinct selectable hair catalog");
  await page.getByRole("button", { name: "아바타 저장", exact: true }).click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 1);
  assert.equal(
    await page.evaluate(() => window.avatarQa.saves[0].cornerAlpha),
    0,
    "Saved thumbnail retains transparency",
  );
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /햇살 재킷/ }).click();
  assert(
    await page
      .getByRole("button", { name: "아바타 저장", exact: true })
      .isDisabled(),
    "Unowned item cannot be saved",
  );
  await page
    .getByRole("button", { name: "180 위스로 구매", exact: true })
    .click();
  await page.getByRole("button", { name: "구매하기", exact: true }).click();
  await page.waitForFunction(() => window.avatarQa.purchases.length === 1);
  const result = await page.evaluate(() => ({
    purchases: window.avatarQa.purchases,
    saves: window.avatarQa.saves.map(({ thumbnailBytes, cornerAlpha }) => ({
      thumbnailBytes,
      cornerAlpha,
    })),
    errors: window.avatarQa.errors,
  }));
  assert.equal(result.purchases[0].charge, 180);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { passed: true, widths: [320, 390, 768, 1280], screenshots, ...result },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      evidence,
      screenshots,
      widths: [320, 390, 768, 1280],
      network: "local only",
      purchase: "synthetic only",
    }),
  );
} finally {
  await browser.close();
}
