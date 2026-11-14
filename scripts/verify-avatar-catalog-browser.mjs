/** Exercise real AvatarStudio using local synthetic data only. */
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
  path.resolve("output/minimi-rebuild-20261111/studio");
await fs.mkdir(evidence, { recursive: true });
const catalog = JSON.parse(
  await fs.readFile(
    new URL("../functions/avatarCatalog.json", import.meta.url),
    "utf8",
  ),
);
const labelFor = (value) =>
  catalog.items.find((item) => item.value === value).label;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [],
  oldRequests = [],
  externalRequests = [],
  screenshots = [],
  coverage = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/\/avatar\/v[12]\/|\.glb(?:\?|$)|\/renderer\/engine/.test(r.url()))
    oldRequests.push(r.url());
});
await page.addInitScript(() => {
  window.webglRequests = 0;
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...options) {
    if (/^(webgl2?|experimental-webgl)$/.test(type)) window.webglRequests++;
    return get.call(this, type, ...options);
  };
});
await page.route("**/*", (r) => {
  const url = r.request().url();
  if (url.startsWith(origin) || /^(data|blob):/.test(url)) return r.continue();
  externalRequests.push(url);
  return r.abort();
});
const button = (name) => page.getByRole("button", { name, exact: true });
const saveButton = () => button("아바타 저장");
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".avatar-studio-camera button")?.disabled ===
      false,
  );
const itemButton = (label) =>
  page
    .locator(".avatar-studio-item")
    .filter({ has: page.getByText(label, { exact: true }) });
try {
  await page.goto(origin);
  await button("꾸미기 화면").click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    1,
    "One load on entry",
  );
  assert.equal(
    await page.locator("canvas").count(),
    0,
    "Unselected does not invent a character",
  );
  await button("여학생 아바타").focus();
  await page.keyboard.press("Enter");
  await ready();
  await itemButton(labelFor("mm-school-hoodie")).click();
  await button("하의").click();
  await itemButton(labelFor("mm-school-joggers")).click();
  await button("상의").click();
  assert.equal(await page.locator(".avatar-studio-pending").count(), 0);
  const reads = await page.evaluate(() => window.avatarQa.loadCalls);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await button(`폭 ${width}`).click();
    await page.locator(".avatar-studio").scrollIntoViewIfNeeded();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `No page overflow at ${width}`,
    );
    assert.equal(await page.locator(".avatar-studio canvas").count(), 1);
    const heading = await page
      .locator(".avatar-studio-heading")
      .evaluate((n) => ({
        background: getComputedStyle(n).backgroundColor,
        shadow: getComputedStyle(n).boxShadow,
      }));
    assert.equal(heading.background, "rgba(0, 0, 0, 0)");
    assert.equal(heading.shadow, "none");
    const file = path.join(evidence, `student-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  }
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    reads,
    "Local choices/resizes make no reads",
  );
  await page.evaluate(() => (window.avatarQa.failSave = true));
  await saveButton().click();
  await page.locator(".avatar-studio-error").waitFor();
  assert.equal(
    await page.evaluate(() => window.avatarQa.saves.length),
    0,
    "Failed save does not replace stored look",
  );
  assert.equal(await page.evaluate(() => window.avatarQa.saveCalls), 1);
  await page.evaluate(() => (window.avatarQa.failSave = false));
  await saveButton().click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 1);
  assert.equal(
    await page.evaluate(() => window.avatarQa.saveCalls),
    2,
    "Only explicit retry writes",
  );
  assert.equal(
    await page.evaluate(() => window.avatarQa.saves[0].cornerAlpha),
    0,
  );
  assert(await saveButton().isDisabled(), "Unchanged saved look cannot write");
  await itemButton("크림 니트").click();
  assert(await saveButton().isDisabled(), "Unowned garment cannot save");
  await button("160 위스로 구매").click();
  await button("구매하기").click();
  await page.waitForFunction(() => window.avatarQa.purchases.length === 1);
  assert.equal(
    await page.evaluate(() => window.avatarQa.purchases[0].charge),
    160,
  );
  await button("순위 화면").click();
  assert.equal(
    await page.locator("canvas").count(),
    0,
    "Unmount disposes canvas",
  );
  await button("교사 문맥").click();
  await button("꾸미기 화면").click();
  await ready();
  assert.equal(await page.locator(".avatar-studio-wallet").count(), 0);
  assert(
    await saveButton().isDisabled(),
    "Opening a saved current avatar never requests refresh",
  );
  await button("포즈").click();
  await itemButton("손 인사").click();
  await saveButton().click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 2);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await button(`폭 ${width}`).click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const file = path.join(evidence, `teacher-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  }
  const slotLabels = {
    top: "상의",
    bottom: "하의",
    shoes: "신발",
    accessory: "장식",
    hairStyle: "헤어",
    hairTone: "염색",
    expression: "눈매·표정",
    skinTone: "피부색",
    pose: "포즈",
  };
  for (const character of ["girl", "boy"]) {
    await button(character === "boy" ? "남성 아바타" : "여성 아바타").click();
    await ready();
    for (const [slot, label] of Object.entries(slotLabels)) {
      await button(label).click();
      const candidates = catalog.items.filter(
        (i) => i.slot === slot && i.characters.includes(character),
      );
      if (slot === "bottom")
        assert.equal(
          await itemButton("남색 치마").count(),
          character === "girl" ? 1 : 0,
        );
      const distinct = new Set();
      for (const item of candidates) {
        await itemButton(item.label).click();
        await ready();
        await itemButton(item.label).locator("img").waitFor();
        assert(
          await itemButton(item.label)
            .locator("img")
            .evaluate((image) => image.complete && image.naturalWidth > 0),
          `${character}/${item.id} has a generated preview`,
        );
        assert.equal(
          await page.locator(".avatar-studio-stage [role=alert]").count(),
          0,
        );
        assert.equal(await page.locator(".avatar-studio-pending").count(), 0);
        coverage.push(`${character}/${item.id}`);
        if (slot === "pose")
          distinct.add(
            await page
              .locator(".avatar-studio canvas")
              .evaluate((c) => c.toDataURL()),
          );
      }
      if (slot === "pose")
        assert.equal(distinct.size, candidates.length, "All poses differ");
    }
  }
  assert.equal(
    await page.evaluate(() => window.avatarQa.purchases.length),
    1,
    "Teacher does not buy",
  );
  // Shop edits are applied in the student view without extra calls on filtering.
  await button("순위 화면").click();
  await page.evaluate(() =>
    window.avatarQa.setCatalogSettings({
      revision: 7,
      prices: { "minimi-top-knit-cream": 275 },
      metadata: {
        "minimi-character-girl": {
          label:
            "아주 긴 이름으로 설정해도 모바일에서 가로로 넘치지 않는 여자 캐릭터",
          gender: "girl",
          description: "",
        },
        "minimi-character-boy": {
          label:
            "아주 긴 이름으로 설정해도 모바일에서 가로로 넘치지 않는 남자 캐릭터",
          gender: "boy",
          description: "",
        },
        "minimi-top-knit-cream": {
          label: "별빛 여행 니트",
          gender: "boy",
          description: "작은 별무늬와 부드러운 소매의 니트입니다.",
        },
      },
    }),
  );
  await button("학생 문맥").click();
  await button("꾸미기 화면").click();
  await ready();
  await button("상의").click();
  await itemButton("별빛 여행 니트").click();
  await page
    .getByText("작은 별무늬와 부드러운 소매의 니트입니다.", { exact: true })
    .waitFor();
  const catalogReads = await page.evaluate(() => window.avatarQa.loadCalls);
  await page
    .getByRole("combobox", { name: "아이템 성별", exact: true })
    .selectOption("girl");
  assert.equal(await itemButton("별빛 여행 니트").count(), 0);
  await page
    .getByRole("combobox", { name: "아이템 성별", exact: true })
    .selectOption("boy");
  assert.equal(await itemButton("별빛 여행 니트").count(), 1);
  await page
    .getByRole("searchbox", { name: "아이템 검색", exact: true })
    .fill("작은 별무늬");
  assert.equal(await page.locator(".avatar-studio-item").count(), 1);
  await page
    .getByRole("searchbox", { name: "아이템 검색", exact: true })
    .fill("없는 검색 결과");
  assert.equal(await page.locator(".avatar-studio-item").count(), 0);
  await page.locator(".avatar-studio-empty").waitFor();
  await page
    .getByRole("searchbox", { name: "아이템 검색", exact: true })
    .fill("");
  await page
    .getByRole("combobox", { name: "아이템 성별", exact: true })
    .selectOption("all");
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    catalogReads,
    "Search and gender classification are local",
  );
  await page.setViewportSize({ width: 390, height: 1000 });
  await button("폭 390").click();
  const density = await page
    .locator(".avatar-studio-items")
    .evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      width: element.clientWidth,
    }));
  assert(density.columns >= 3, "Three compact item columns at 390px");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await button(`폭 ${width}`).click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Long editable character names fit at ${width}px`,
    );
  }
  assert.equal(
    await page.locator(".avatar-studio-item canvas").count(),
    0,
    "Catalog keeps static previews",
  );
  // A response retained by an old client must not restore ownership or thumbnails.
  await button("순위 화면").click();
  await page.evaluate(() => window.avatarQa.setRetired());
  await button("꾸미기 화면").click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(await page.locator(".avatar-placeholder").count(), 1);
  assert.equal(await page.locator(".avatar-studio canvas").count(), 0);
  assert.equal(
    await page.locator(".avatar-studio-characters [aria-pressed=true]").count(),
    0,
    "Retired gender/hair choices are not partially restored",
  );
  // Explicit retry after load failure, no automatic polling.
  await button("순위 화면").click();
  await page.evaluate(() => (window.avatarQa.failLoad = true));
  await button("꾸미기 화면").click();
  await button("다시 불러오기").waitFor();
  const failedReads = await page.evaluate(() => window.avatarQa.loadCalls);
  await page.waitForTimeout(120);
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    failedReads,
  );
  await page.evaluate(() => (window.avatarQa.failLoad = false));
  await button("다시 불러오기").click();
  await page.locator(".avatar-studio").waitFor();
  assert.equal(
    await page.evaluate(() => window.avatarQa.loadCalls),
    failedReads + 1,
  );
  // Old public replicas are filtered before any image URL is requested.
  await page.evaluate(() => {
    window.avatarQa.entries.forEach((entry) => {
      entry.avatar.catalogVersion = 1;
      entry.avatar.thumbnailUrl = "/avatar/v1/retired.webp";
    });
  });
  await button("순위 화면").click();
  await page.locator(".wis-ranking-row").first().waitFor();
  assert.equal(await page.locator(".wis-ranking-avatar__image").count(), 0);
  assert.equal(
    await page.locator(".wis-ranking-avatar .avatar-placeholder").count(),
    1,
  );
  assert.deepEqual(oldRequests, []);
  assert.deepEqual(externalRequests, []);
  assert.equal(await page.evaluate(() => window.webglRequests), 0);
  assert.deepEqual(errors, []);
  const result = await page.evaluate(() => ({
    loadCalls: window.avatarQa.loadCalls,
    saveCalls: window.avatarQa.saveCalls,
    purchases: window.avatarQa.purchases,
    saves: window.avatarQa.saves.map(({ thumbnailBytes, cornerAlpha }) => ({
      thumbnailBytes,
      cornerAlpha,
    })),
    errors: window.avatarQa.errors,
  }));
  assert.deepEqual(result.errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        passed: true,
        widths: [320, 390, 768, 1280],
        coverage,
        screenshots,
        oldRequests,
        externalRequests,
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      coverage: coverage.length,
      evidence,
      ...result,
    }),
  );
} finally {
  await browser.close();
}
