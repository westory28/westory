import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = process.cwd();
const out = path.join(
  root,
  process.env.HAIR_QA_OUTPUT || "output/avatar-hair-20261028",
);
await fs.mkdir(out, { recursive: true });
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
const sharp = require(path.join(root, "functions/node_modules/sharp"));
const entry = `import {createAvatarStage} from './src/features/avatar/renderer/engine.js';
import {HAIR_STYLES} from './src/features/avatar/renderer/hair-styles.js';
import {defaultAvatarLook} from './src/features/avatar/catalog.ts';
window.qa={styles:HAIR_STYLES,async init(character){this.stage?.dispose();this.look=defaultAvatarLook(character);this.stage=await createAvatarStage(document.getElementById('stage'),this.look,{assetBaseUrl:'/avatar/v1/',maxPixelRatio:1});this.stage.stop();this.stage.focusItem('hairStyle');},async set(style,pose='idle',tone='original',accessory='none'){const look={hairStyle:style,pose,hairTone:tone,accessory};await this.stage.prepareLook(look);const r=this.stage.setLook(look);this.stage.stop();this.stage.focusItem('hairStyle');return r},capture(){return this.stage.capture()}};`;
const result = await build({
  stdin: { contents: entry, loader: "js", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const html =
  '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f6f8}#stage{width:384px;height:384px}</style><div id="stage"></div><script type="module" src="/qa.js"></script>';
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(html);
      return;
    }
    if (url.pathname === "/qa.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(result.outputFiles[0].contents);
      return;
    }
    const target = path.resolve(root, "public", "." + url.pathname);
    if (!target.startsWith(path.join(root, "public/avatar") + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    res.end(await fs.readFile(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 384, height: 384 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("favicon"))
    errors.push(msg.text());
});
const reports = [],
  tiles = [],
  angleTiles = [],
  hatTiles = [];
async function labelled(buffer, label, size = 224) {
  const caption = Buffer.from(
    `<svg width="${size}" height="${size + 25}"><rect width="100%" height="100%" fill="#f4f6f8"/><text x="${size / 2}" y="${size + 18}" text-anchor="middle" font-family="Arial" font-size="12">${label}</text></svg>`,
  );
  return sharp(caption)
    .composite([
      {
        input: await sharp(buffer).resize(size, size).toBuffer(),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.qa);
  for (const character of process.env.HAIR_QA_CHARACTER
    ? [process.env.HAIR_QA_CHARACTER]
    : ["girl", "boy"]) {
    await page.evaluate((character) => window.qa.init(character), character);
    let styles = await page.evaluate(
      (character) => window.qa.styles[character],
      character,
    );
    if (process.env.HAIR_QA_STYLE)
      styles = styles.filter((style) => style === process.env.HAIR_QA_STYLE);
    if (process.env.HAIR_QA_STYLES)
      styles = styles.filter((style) =>
        process.env.HAIR_QA_STYLES.split(",").includes(style),
      );
    for (const style of styles) {
      const applied = await page.evaluate(
        (style) => window.qa.set(style),
        style,
      );
      assert(applied.applied, `${character}/${style} applied`);
      const png = await page.evaluate(() => window.qa.capture());
      const buffer = Buffer.from(png.split(",")[1], "base64");
      await fs.writeFile(path.join(out, `${character}-${style}.png`), buffer);
      const caption = Buffer.from(
        `<svg width="256" height="286"><rect width="256" height="286" fill="#f4f6f8"/><text x="128" y="277" text-anchor="middle" font-family="Arial" font-size="15">${character} / ${style}</text></svg>`,
      );
      const tile = await sharp(caption)
        .composite([
          {
            input: await sharp(buffer).resize(256, 256).toBuffer(),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
      tiles.push(tile);
      reports.push({
        character,
        style,
        stats: await page.evaluate(() => window.qa.stage.stats),
      });
      for (const [pose, turn] of [
        ["tilt", 4],
        ["cheer", 8],
      ]) {
        await page.evaluate(
          async ({ style, pose, turn }) => {
            await window.qa.set(style, pose, "rose");
            window.qa.stage.rotate(turn);
            window.qa.stage.stop();
          },
          { style, pose, turn },
        );
        const buffer = Buffer.from(
          (await page.evaluate(() => window.qa.capture())).split(",")[1],
          "base64",
        );
        await fs.writeFile(
          path.join(out, `${character}-${style}-${pose}-angle-${turn}.png`),
          buffer,
        );
        angleTiles.push(
          await labelled(
            buffer,
            `${character}/${style}/${pose}/${turn * 22.5}deg`,
          ),
        );
      }
    }
    const beforeCycle = await page.evaluate(() => window.qa.stage.stats);
    await page.evaluate(async (styles) => {
      for (const style of styles) await window.qa.set(style);
    }, styles);
    const afterCycle = await page.evaluate(() => window.qa.stage.stats);
    assert.equal(
      beforeCycle.geometries,
      afterCycle.geometries,
      "Reusing hairstyles must not allocate geometry",
    );
    assert.equal(
      beforeCycle.textures,
      afterCycle.textures,
      "Reusing hairstyles must not allocate textures",
    );
    for (const style of styles)
      for (const accessory of ["official-samo", "official-gat"]) {
        const applied = await page.evaluate(
          ({ style, accessory }) =>
            window.qa.set(style, "tilt", "original", accessory),
          { style, accessory },
        );
        assert(applied.applied, `${character}/${style}/${accessory} applied`);
        const buffer = Buffer.from(
          (await page.evaluate(() => window.qa.capture())).split(",")[1],
          "base64",
        );
        await fs.writeFile(
          path.join(out, `${character}-${style}-${accessory}.png`),
          buffer,
        );
        hatTiles.push(
          await labelled(buffer, `${character}/${style}/${accessory}`),
        );
      }
    for (const [pose, turn] of [
      ["tilt", 0],
      ["wave", 4],
      ["cheer", 8],
    ]) {
      await page.evaluate(
        async ({ pose, turn, style }) => {
          await window.qa.set(style, pose, "rose");
          if (turn) window.qa.stage.rotate(turn);
          window.qa.stage.stop();
        },
        { pose, turn, style: styles.at(-1) },
      );
      await fs.writeFile(
        path.join(out, `${character}-${pose}-angle-${turn}.png`),
        Buffer.from(
          (await page.evaluate(() => window.qa.capture())).split(",")[1],
          "base64",
        ),
      );
    }
  }
  const stoppedFrames = await page.evaluate(
    () => window.qa.stage.stats.renderedFrames,
  );
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.qa.stage.stats.renderedFrames),
    stoppedFrames,
    "Capture framing must leave no animation frame queued",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const disposal = await page.evaluate(() => {
    window.qa.stage.dispose();
    window.qa.stage.dispose();
    return {
      stats: window.qa.stage.stats,
      canvases: document.querySelectorAll("canvas").length,
      afterDispose: window.qa.stage.setLook({ hairStyle: "toben" }),
    };
  });
  assert.equal(disposal.canvases, 0, "Disposal removes the WebGL canvas");
  assert.equal(
    disposal.stats.geometries,
    0,
    "Disposal releases every GPU geometry",
  );
  // Three.js retains a renderer-owned environment texture in its info counter;
  // application hair resources have an explicit dispose-event lifecycle test.
  // https://threejs.org/manual/pages/how-to-dispose-of-objects.html
  assert(
    disposal.stats.textures <= 1,
    "Only the renderer environment cache may remain",
  );
  assert.equal(
    disposal.afterDispose.applied,
    false,
    "Disposed stages reject updates",
  );
  const columns = 4,
    rows = Math.ceil(tiles.length / columns);
  await sharp({
    create: {
      width: columns * 256,
      height: rows * 286,
      channels: 4,
      background: "#f4f6f8",
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % columns) * 256,
        top: Math.floor(i / columns) * 286,
      })),
    )
    .png()
    .toFile(path.join(out, "contact-sheet.png"));
  for (const [name, list] of [
    ["angles", angleTiles],
    ["headwear", hatTiles],
  ])
    await sharp({
      create: {
        width: 4 * 224,
        height: Math.ceil(list.length / 4) * 249,
        channels: 4,
        background: "#f4f6f8",
      },
    })
      .composite(
        list.map((input, i) => ({
          input,
          left: (i % 4) * 224,
          top: Math.floor(i / 4) * 249,
        })),
      )
      .png()
      .toFile(path.join(out, `${name}-sheet.png`));
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ passed: true, errors, reports, disposal }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, styles: reports.length, evidence: out }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
