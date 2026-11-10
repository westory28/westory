/** Actual 2D art combinations; local assets and synthetic UI only.
 * node scripts/verify-avatar-outfit-fit.mjs [--render-only] [--match=case-pattern]
 * AVATAR_FIT_OUTPUT, PLAYWRIGHT_MODULE_PATH and PLAYWRIGHT_BROWSER_CHANNEL are optional.
 * The contact sheets require visual review: pixel checks cannot judge clothing taste,
 * anatomy, or whether an intentional strand should appear in front of a collar/hat.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matchPattern = process.argv
  .find((argument) => argument.startsWith("--match="))
  ?.slice(8);
const match = matchPattern ? new RegExp(matchPattern) : null;
const output = path.resolve(
  process.env.AVATAR_FIT_OUTPUT ||
    path.join(
      root,
      match
        ? "output/avatar-fit-20261110-filtered"
        : "output/avatar-fit-20261110",
    ),
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
const sharp = createRequire(path.join(root, "functions/package.json"))("sharp");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const manifestBytes = await fs.readFile(
  path.join(root, "public/avatar/v2/manifest.json"),
);
const manifest = JSON.parse(manifestBytes);
const choices = (character, slot) =>
  catalog.items.filter(
    (item) => item.slot === slot && item.characters.includes(character),
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  manifestSha256: hash(manifestBytes),
  caseFilter: matchPattern || null,
  network: "local assets only; external requests blocked",
  productionWrites: 0,
  limits:
    "Automated checks detect missing/empty art, selection failures and clipped full captures. Review contact sheets for anatomical fit, sleeve joins and hair/hat/collar occlusion.",
  cases: [],
  assets: [],
  layout: [],
  sheets: [],
  errors: [],
};
await fs.mkdir(path.join(output, "captures"), { recursive: true });
await fs.mkdir(path.join(output, "sheets"), { recursive: true });

const cases = [];
function addCase(suite, group, patch) {
  const key = [suite, ...Object.values(patch)].join("--");
  cases.push({ suite, group, key, patch });
}
for (const character of ["girl", "boy"]) {
  for (const top of choices(character, "top")) {
    const bottom = top.value.startsWith("hanbok-")
      ? character === "girl"
        ? "chima-navy"
        : "baji-cream"
      : top.value.startsWith("summer-")
        ? "summer-shorts"
        : "plain-bottom";
    for (const pose of choices(character, "pose"))
      addCase("outfits", `${character}-${top.value}`, {
        character,
        top: top.value,
        bottom,
        pose: pose.value,
      });
  }
  for (const hair of choices(character, "hairStyle"))
    for (const accessory of ["none", "official-samo", "official-gat"])
      for (const face of choices(character, "faceShape"))
        for (const pose of ["idle", "tilt"])
          addCase("hair", `${character}-${hair.value}`, {
            character,
            hairStyle: hair.value,
            accessory,
            faceShape: face.value,
            pose,
          });
  for (const bottom of choices(character, "bottom"))
    for (const pose of choices(character, "pose"))
      addCase("bottoms", `${character}-bottoms`, {
        character,
        top: /^(chima|baji)-/.test(bottom.value)
          ? "hanbok-ivory"
          : bottom.value === "summer-shorts"
            ? "summer-white"
            : "plain-top",
        bottom: bottom.value,
        pose: pose.value,
      });
  for (const shoes of choices(character, "shoes"))
    for (const pose of ["idle", "tilt"])
      addCase("shoes", `${character}-shoes`, {
        character,
        shoes: shoes.value,
        pose,
      });
}

const runCases = cases.filter((entry) => !match || match.test(entry.key));
assert(runCases.length, "No avatar cases matched the requested filter");

const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
let browser;
let fixture;
let failure;
const assetPaths = new Set();
const pageErrors = [];
const failedResponses = [];
const externalRequests = [];

function protect(page, origin) {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push({ url: response.url(), status: response.status() });
  });
  return page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^(data|blob):/.test(url)) return route.continue();
    if (new URL(url).origin !== origin) {
      externalRequests.push(url);
      return route.abort();
    }
    if (new URL(url).pathname === "/__avatar-fit")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#f1f5f9}#stage{width:512px;height:640px}</style><div id="stage"></div></html>',
      });
    return route.continue();
  });
}

function enclosedFootHoles(sourceMask, width, height, blockSize) {
  const mask = sourceMask.slice();
  const queue = new Int32Array(mask.length);
  const holes = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start]) continue;
    let read = 0;
    let write = 1;
    let edge = false;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[0] = start;
    mask[start] = 1;
    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        edge = true;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
          continue;
        const next = nextY * width + nextX;
        if (mask[next]) continue;
        mask[next] = 1;
        queue[write++] = next;
      }
    }
    // An empty shoe opening is an enclosed transparent hole below the ankles.
    // The space between legs connects to the exterior, so it is not a failure.
    if (!edge && minY >= height * 0.84 && write >= 12)
      holes.push({
        blocks: write,
        bounds: [minX, minY, maxX + 1, maxY + 1].map((n) => n * blockSize),
      });
  }
  return holes;
}

function silhouetteComponents(mask, width, height, blockSize) {
  const footHoles = enclosedFootHoles(mask, width, height, blockSize);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let read = 0;
    let write = 1;
    queue[0] = start;
    mask[start] = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
            continue;
          const next = nextY * width + nextX;
          if (!mask[next]) continue;
          mask[next] = 0;
          queue[write++] = next;
        }
    }
    components.push({
      blocks: write,
      bounds: [minX, minY, maxX + 1, maxY + 1].map((n) => n * blockSize),
    });
  }
  components.sort((a, b) => b.blocks - a.blocks);
  // Pooling accepts antialiasing and tiny joins; the area floor ignores dust and
  // single stray hair strokes. Detached shoes, limbs or heads remain significant.
  const significantBlocks = Math.max(64, (components[0]?.blocks || 0) * 0.005);
  return {
    blockSize,
    significantBlocks,
    main: components[0] || null,
    detached: components
      .slice(1)
      .filter((part) => part.blocks >= significantBlocks),
    footHoles,
  };
}

function alphaReport(data, width, height, channels, checkConnections = false) {
  const blockSize = 4;
  const maskWidth = Math.ceil(width / blockSize);
  const maskHeight = Math.ceil(height / blockSize);
  const mask = checkConnections ? new Uint8Array(maskWidth * maskHeight) : null;
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let edgePixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + channels - 1] <= 16) continue;
      count++;
      if (mask)
        mask[
          Math.floor(y / blockSize) * maskWidth + Math.floor(x / blockSize)
        ] = 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        edgePixels++;
    }
  return {
    width,
    height,
    opaquePixels: count,
    coverage: count / (width * height),
    bounds: count ? [minX, minY, maxX + 1, maxY + 1] : null,
    edgePixels,
    ...(mask
      ? {
          connections: silhouetteComponents(
            mask,
            maskWidth,
            maskHeight,
            blockSize,
          ),
        }
      : {}),
  };
}

async function startFixture() {
  const child = spawn(
    process.execPath,
    ["scripts/verify-avatar-ui.mjs", "--serve"],
    {
      cwd: root,
      env: { ...process.env, AVATAR_QA_PORT: "0" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fixture = child;
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Local AvatarStudio fixture did not start: ${log.slice(-1500)}`,
        ),
      );
    }, 60_000);
    const consume = (chunk) => {
      log = (log + chunk.toString()).slice(-6000);
      const match = log.match(/CUA_FIXTURE_URL=(http:\/\/127\.0\.0\.1:\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Local AvatarStudio fixture exited (${code}): ${log.slice(-1500)}`,
        ),
      );
    });
  });
}

async function verifyLayout() {
  const origin = await startFixture();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await protect(page, origin);
  try {
    await page.goto(origin);
    await page
      .getByRole("button", { name: "꾸미기 화면", exact: true })
      .click();
    for (const audience of ["student", "teacher"]) {
      if (audience === "teacher") {
        await page
          .getByRole("button", { name: "교사 문맥", exact: true })
          .click();
      }
      await page
        .getByRole("button", {
          name: audience === "student" ? /^여학생 아바타/ : /^여성 아바타/,
        })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".avatar-studio-stage [aria-busy]")
            ?.getAttribute("aria-busy") === "false",
      );
      for (const width of [390, 768, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await page
          .getByRole("button", { name: `폭 ${width}`, exact: true })
          .click();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const layout = await page.evaluate(() => {
          const rect = (selector) => {
            const element = document.querySelector(selector);
            if (!element) throw Error(`Missing ${selector}`);
            const { x, y, width, height, right, bottom } =
              element.getBoundingClientRect();
            return { x, y, width, height, right, bottom };
          };
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            canvases: document.querySelectorAll(".avatar-studio canvas").length,
            studio: rect(".avatar-studio"),
            stage: rect(".avatar-studio-stage"),
            canvas: rect(".avatar-studio canvas"),
            save: rect(".avatar-studio-save"),
            errors: [...window.avatarQa.errors],
            writes:
              window.avatarQa.saves.length + window.avatarQa.purchases.length,
          };
        });
        const errors = [];
        if (layout.overflow) errors.push("horizontal page overflow");
        if (layout.canvases !== 1)
          errors.push("expected one active preview canvas");
        if (layout.canvas.width < 1 || layout.canvas.height < 1)
          errors.push("empty preview dimensions");
        if (
          layout.canvas.x < layout.stage.x - 1 ||
          layout.canvas.right > layout.stage.right + 1 ||
          layout.canvas.y < layout.stage.y - 1 ||
          layout.canvas.bottom > layout.stage.bottom + 1
        )
          errors.push("preview escapes stage");
        if (layout.save.x < 0 || layout.save.right > width + 1)
          errors.push("save controls escape viewport");
        if (layout.errors.length || layout.writes)
          errors.push("fixture error or unexpected write");
        const file = `${audience}-studio-${width}.png`;
        await page.screenshot({
          path: path.join(output, file),
          fullPage: true,
        });
        report.layout.push({ audience, width, ...layout, errors, file });
        report.errors.push(
          ...errors.map((error) => `${audience}/${width}: ${error}`),
        );
      }
    }
  } finally {
    await page.close();
  }
}

async function contactSheets() {
  const groups = new Map();
  for (const entry of report.cases.filter((item) => item.file)) {
    const key = `${entry.suite}-${entry.group}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [group, entries] of groups) {
    const columns = 6;
    const tileWidth = 240;
    const imageHeight = entries[0].suite === "hair" ? 270 : 300;
    const tileHeight = imageHeight + 56;
    const tiles = [];
    for (const [index, entry] of entries.entries()) {
      let source = sharp(path.join(output, entry.file));
      if (entry.suite === "hair") {
        const meta = await source.metadata();
        source = source.extract({
          left: 0,
          top: 0,
          width: meta.width,
          height: Math.ceil(meta.height * 0.56),
        });
      }
      const label = Object.entries(entry.patch)
        .filter(([name]) => name !== "character")
        .map(([, value]) => value);
      const lines =
        entry.suite === "hair"
          ? [
              `${entry.patch.hairStyle} / ${entry.patch.accessory}`,
              `${entry.patch.faceShape} / ${entry.patch.pose}`,
            ]
          : [label.slice(0, -1).join(" / "), entry.patch.pose];
      const escape = (value) =>
        value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
      const text = lines
        .map(
          (line, row) =>
            `<text x="8" y="${imageHeight + 19 + row * 18}" font-size="12" font-family="Arial" fill="#334155">${escape(line)}</text>`,
        )
        .join("");
      const tile = await sharp(
        Buffer.from(
          `<svg width="${tileWidth}" height="${tileHeight}"><rect width="100%" height="100%" fill="${entry.errors.length ? "#fee2e2" : "#f1f5f9"}"/>${text}</svg>`,
        ),
      )
        .composite([
          {
            input: await source
              .resize(tileWidth, imageHeight, {
                fit: "contain",
                background: "#f1f5f9",
              })
              .png()
              .toBuffer(),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer();
      tiles.push({
        input: tile,
        left: (index % columns) * tileWidth,
        top: Math.floor(index / columns) * tileHeight,
      });
    }
    const file = `sheets/${group}.png`;
    await sharp({
      create: {
        width: columns * tileWidth,
        height: Math.ceil(entries.length / columns) * tileHeight,
        channels: 4,
        background: "#ffffff",
      },
    })
      .composite(tiles)
      .png()
      .toFile(path.join(output, file));
    report.sheets.push({ group, cases: entries.length, file });
  }
}

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 512, height: 640 } });
  await protect(page, origin);
  await page.goto(`${origin}/__avatar-fit`);
  await page.evaluate(async () => {
    const engine = await import("/src/features/avatar/renderer2d/engine.ts");
    const art = await import("/src/features/avatar/renderer2d/manifest.ts");
    const { defaultAvatarLook } =
      await import("/src/features/avatar/catalog.ts");
    const manifest = art.validateManifest(
      await (await fetch("/avatar/v2/manifest.json")).json(),
    );
    let stage;
    let character;
    window.renderFitCase = async (patch) => {
      const look = { ...defaultAvatarLook(patch.character), ...patch };
      if (!stage || character !== look.character) {
        stage?.dispose();
        character = look.character;
        stage = await engine.createAvatarStage(
          document.querySelector("#stage"),
          look,
          { assetBaseUrl: "/avatar/v2/", maxPixelRatio: 1 },
        );
      }
      await stage.prepareLook(look);
      const applied = stage.setLook(look);
      if (!applied.applied)
        throw Error(`Look not applied: ${JSON.stringify(applied)}`);
      stage.resetView();
      const resolved = art.resolveArt(manifest, look);
      const selections = Object.entries(resolved.art.slots).map(
        ([slot, choices]) => {
          const raw = choices[look[slot]];
          const base = Array.isArray(raw) ? { layers: raw } : raw;
          const choice = base.poses?.[look.pose]
            ? { ...base, ...base.poses[look.pose] }
            : base;
          return { slot, choice };
        },
      );
      const hiddenSlots = new Set(
        selections.flatMap(({ choice }) => choice.hideSlots || []),
      );
      const ids = new Set(resolved.layers.map((layer) => layer.id));
      const coverage = selections.map(({ slot, choice }) => ({
        slot,
        expected: choice.layers.length,
        hidden: hiddenSlots.has(slot),
        selected: choice.layers
          .filter((layer) => ids.has(layer.id))
          .map((layer) => layer.id),
      }));
      return {
        image: stage.capture(),
        layers: resolved.layers,
        coverage,
        stats: stage.stats,
      };
    };
  });
  for (const [index, entry] of runCases.entries()) {
    const result = { ...entry, errors: [] };
    try {
      const rendered = await page.evaluate(
        (patch) => window.renderFitCase(patch),
        entry.patch,
      );
      const bytes = Buffer.from(rendered.image.split(",")[1], "base64");
      const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alpha = alphaReport(
        data,
        info.width,
        info.height,
        info.channels,
        true,
      );
      if (!alpha.opaquePixels)
        result.errors.push("full capture is transparent");
      if (alpha.edgePixels)
        result.errors.push(
          `full capture clipped: ${alpha.edgePixels} opaque edge pixels`,
        );
      if (alpha.coverage > 0.99)
        result.errors.push("full capture has an opaque background");
      if (alpha.connections.detached.length)
        result.errors.push(
          `detached silhouette parts: ${JSON.stringify(alpha.connections.detached)}`,
        );
      if (alpha.connections.footHoles.length)
        result.errors.push(
          `transparent ankle/shoe openings: ${JSON.stringify(alpha.connections.footHoles)}`,
        );
      for (const slot of rendered.coverage)
        if (
          ["top", "bottom", "shoes", "hairStyle", "faceShape"].includes(
            slot.slot,
          ) &&
          !slot.hidden &&
          slot.expected &&
          !slot.selected.length
        )
          result.errors.push(`${slot.slot} has no surviving selected layers`);
      for (const layer of rendered.layers) {
        assetPaths.add(layer.src);
        if (layer.tint?.mask) assetPaths.add(layer.tint.mask);
      }
      result.file = `captures/${entry.key}.png`;
      await fs.writeFile(path.join(output, result.file), bytes);
      Object.assign(result, {
        alpha,
        imageSha256: hash(data),
        layers: rendered.layers.map(({ id, src, rect, z, group }) => ({
          id,
          src,
          rect,
          z,
          group,
        })),
        coverage: rendered.coverage,
        stats: rendered.stats,
      });
    } catch (error) {
      result.errors.push(error.message);
    }
    report.cases.push(result);
    report.errors.push(
      ...result.errors.map((error) => `${entry.key}: ${error}`),
    );
    if ((index + 1) % 30 === 0)
      console.log(`Avatar combinations: ${index + 1}/${runCases.length}`);
  }
  await page.close();
  for (const relative of [...assetPaths].sort()) {
    const file = path.resolve(root, "public/avatar/v2", relative);
    assert(
      file.startsWith(`${path.resolve(root, "public/avatar/v2")}${path.sep}`),
      "Local avatar asset boundary",
    );
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = alphaReport(data, info.width, info.height, info.channels);
    report.assets.push({ file: relative, ...alpha });
    if (!alpha.opaquePixels)
      report.errors.push(`Empty source layer: ${relative}`);
  }
  for (const character of ["girl", "boy"])
    for (const top of choices(character, "top")) {
      const matching = report.cases.filter(
        (entry) =>
          entry.suite === "outfits" &&
          entry.patch.character === character &&
          entry.patch.top === top.value,
      );
      if (
        new Set(matching.map((entry) => entry.imageSha256).filter(Boolean))
          .size !== matching.length
      )
        report.errors.push(
          `${character}/${top.value}: at least two poses render identically`,
        );
    }
  await contactSheets();
  if (!process.argv.includes("--render-only")) await verifyLayout();
  if (
    hash(
      await fs.readFile(path.join(root, "public/avatar/v2/manifest.json")),
    ) !== report.manifestSha256
  )
    report.errors.push(
      "Art manifest changed during QA; rerun against one completed asset build",
    );
} catch (error) {
  failure = error;
  report.errors.push(error.stack || error.message);
} finally {
  fixture?.kill();
  await browser?.close();
  await server.close();
  report.errors.push(...pageErrors.map((error) => `Browser: ${error}`));
  report.errors.push(
    ...failedResponses.map((entry) => `HTTP ${entry.status}: ${entry.url}`),
  );
  report.errors.push(
    ...externalRequests.map((url) => `Blocked external request: ${url}`),
  );
  report.passed = report.errors.length === 0;
  report.summary = {
    planned: runCases.length,
    rendered: report.cases.length,
    suites: Object.fromEntries(
      [...new Set(cases.map((entry) => entry.suite))].map((suite) => [
        suite,
        report.cases.filter((entry) => entry.suite === suite).length,
      ]),
    ),
    assets: report.assets.length,
    sheets: report.sheets.length,
    layoutCases: report.layout.length,
    errors: report.errors.length,
  };
  await fs.writeFile(
    path.join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { passed: report.passed, output, ...report.summary },
      null,
      2,
    ),
  );
}
if (failure) throw failure;
assert.deepEqual(
  report.errors,
  [],
  `Avatar fit regression: see ${path.join(output, "report.json")}`,
);
