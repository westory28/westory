/** Reproducible static catalog captures. No Firebase, user records or remote assets. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "public/avatar/v2/previews");
const require = createRequire(import.meta.url);
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rendererFiles = (
  await fs.readdir(path.join(root, "src/features/avatar/renderer2d"))
)
  .filter((name) => name.endsWith(".ts"))
  .sort()
  .map((name) => `src/features/avatar/renderer2d/${name}`);
const artManifest = JSON.parse(
  await fs.readFile(path.join(root, "public/avatar/v2/manifest.json"), "utf8"),
);
const artFiles = new Set();
function collectArt(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["src", "mask"].includes(key) && typeof child === "string")
      artFiles.add(`public/avatar/v2/${child}`);
    else collectArt(child);
  }
}
collectArt(artManifest);
const sourceFiles = [
  "scripts/render-avatar-item-previews.mjs",
  "functions/avatarCatalog.json",
  "src/features/avatar/catalog.ts",
  ...rendererFiles,
  "public/avatar/v2/manifest.json",
  ...[...artFiles].sort(),
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => {
      const bytes = await fs.readFile(path.join(root, file));
      return [
        file,
        hash(
          /\.(png|webp)$/.test(file)
            ? bytes
            : bytes.toString("utf8").replaceAll("\r\n", "\n"),
        ),
      ];
    }),
  ),
);
const entries = ["girl", "boy"].flatMap((character) =>
  catalog.items
    .filter((item) =>
      item.slot === "character"
        ? item.value === character
        : item.characters.includes(character),
    )
    .map((item) => ({
      character,
      item,
      file: `${character}/${item.slot}-${item.value}.webp`,
    })),
);

if (process.argv.includes("--check")) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(destination, "manifest.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.sources,
    sourceHashes,
    "Renderer changed: regenerate item previews.",
  );
  assert.equal(
    manifest.items.length,
    entries.length,
    "Every supported item needs a preview.",
  );
  let total = 0;
  for (const entry of entries) {
    const record = manifest.items.find((item) => item.file === entry.file);
    assert(
      record && record.id === entry.item.id,
      `Missing preview: ${entry.file}`,
    );
    const bytes = await fs.readFile(path.join(destination, entry.file));
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.equal(hash(bytes), record.sha256, `Preview bytes: ${entry.file}`);
    assert(
      bytes.length > 1000 && bytes.length <= 50000,
      `Preview size: ${entry.file}`,
    );
    total += bytes.length;
  }
  assert(total < 4_000_000, "Catalog preview budget");
  console.log(
    `PASS: ${entries.length} actual-render previews, ${total} bytes; renderer fingerprints match.`,
  );
  process.exit(0);
}

const { build } = require("esbuild");
const sharp = createRequire(path.join(root, "functions/package.json"))("sharp");
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
const scratch = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-preview-render-"),
);
const bundle = await build({
  stdin: {
    contents: `
    import {createAvatarStage} from './src/features/avatar/renderer2d/engine.ts';
    import {defaultAvatarLook} from './src/features/avatar/catalog.ts';
    let stage, character;
    window.renderItem=async(item,nextCharacter)=>{
      const look={...defaultAvatarLook(nextCharacter),[item.slot]:item.value};
      if(item.slot==='top' && item.value.startsWith('hanbok-'))
        look.bottom=nextCharacter==='girl'?'chima-navy':'baji-cream';
      if(item.slot==='bottom' && /^(chima|baji)-/.test(item.value)) look.top='hanbok-ivory';
      if(item.slot==='top' && item.value.startsWith('summer-')) look.bottom='summer-shorts';
      if(item.value==='summer-shorts') look.top='summer-white';
      if(!stage||character!==nextCharacter){
        stage?.dispose(); character=nextCharacter;
        stage=await createAvatarStage(document.getElementById('stage'),look,{assetBaseUrl:'/avatar/v2/',maxPixelRatio:1});
      }
      await stage.prepareLook(look);
      const applied=stage.setLook(look);
      if(!applied.applied) throw Error('Unsupported item '+item.id+': '+JSON.stringify(applied));
      stage.stop();stage.resetView();
      // Portrait framing can hide a hat clipped by the canonical saved image.
      // Check the full capture independently before making the focused tile.
      const full=await createImageBitmap(await(await fetch(stage.capture())).blob());
      const probe=document.createElement('canvas');probe.width=full.width;probe.height=full.height;
      const context=probe.getContext('2d');context.drawImage(full,0,0);full.close();
      const pixels=context.getImageData(0,0,probe.width,probe.height).data;
      const opaque=(x,y)=>pixels[(y*probe.width+x)*4+3]>16;
      for(let x=0;x<probe.width;x++) if(opaque(x,0)||opaque(x,probe.height-1))
        throw Error('Saved avatar is clipped vertically: '+nextCharacter+'/'+item.id);
      for(let y=0;y<probe.height;y++) if(opaque(0,y)||opaque(probe.width-1,y))
        throw Error('Saved avatar is clipped horizontally: '+nextCharacter+'/'+item.id);
      probe.width=probe.height=0;
      stage.focusItem(item.value.startsWith('official-')&&item.slot==='top'?'pose':item.slot);
      return {image:stage.captureFrame(),stats:stage.stats};
    };
  `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const html =
  '<!doctype html><html><meta charset="utf-8"><style>body{margin:0}#stage{width:256px;height:256px}</style><div id="stage"></div><script type="module" src="/stage.js"></script></html>';
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/")
      return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    if (pathname === "/stage.js")
      return res
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(bundle.outputFiles[0].contents);
    const assetRoot = path.resolve(root, "public/avatar/v2");
    const target = path.resolve(
      root,
      "public",
      "." + decodeURIComponent(pathname),
    );
    if (!target.startsWith(assetRoot + path.sep))
      return res.writeHead(403).end();
    res.writeHead(200, {
      "Content-Type": pathname.endsWith(".png")
        ? "image/png"
        : pathname.endsWith(".webp") ? "image/webp" : "application/json",
    });
    res.end(await fs.readFile(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const page = await browser.newPage({
  viewport: { width: 256, height: 256 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  route.request().url().startsWith(origin) ||
  /^(blob|data):/.test(route.request().url())
    ? route.continue()
    : route.abort(),
);
const manifest = {
  version: 4,
  width: 256,
  height: 256,
  sources: sourceHashes,
  items: [],
};
try {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderItem === "function");
  for (const entry of entries) {
    const capture = await page.evaluate(
      ({ item, character }) => window.renderItem(item, character),
      entry,
    );
    const source = Buffer.from(capture.image.split(",")[1], "base64");
    const bytes = await sharp(source)
      .resize(256, 256)
      .webp({ quality: 88, effort: 6 })
      .toBuffer();
    const target = path.join(destination, entry.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    manifest.items.push({
      id: entry.item.id,
      character: entry.character,
      file: entry.file,
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    if (manifest.items.length % 20 === 0)
      console.log(`Rendered ${manifest.items.length}/${entries.length}`);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // A review sheet is local evidence, never shipped as user data.
  const samples = entries.filter(({ item }) =>
    ["top", "bottom", "hairStyle", "accessory"].includes(item.slot),
  );
  const tiles = await Promise.all(
    samples.map(async (entry, index) => {
      const label = `${entry.character} / ${entry.item.value}`;
      const svg = Buffer.from(
        `<svg width="192" height="220"><rect width="192" height="220" fill="#f8fafc"/><text x="8" y="210" font-size="11" font-family="Arial" fill="#334155">${label}</text></svg>`,
      );
      const tile = await sharp(svg)
        .composite([
          {
            input: await sharp(path.join(destination, entry.file))
              .resize(192, 192)
              .toBuffer(),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
      return {
        input: tile,
        top: Math.floor(index / 8) * 220,
        left: (index % 8) * 192,
      };
    }),
  );
  const sheet = path.join(scratch, "catalog-review.png");
  await sharp({
    create: {
      width: 8 * 192,
      height: Math.ceil(tiles.length / 8) * 220,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite(tiles)
    .png()
    .toFile(sheet);
  console.log(
    JSON.stringify({
      previews: entries.length,
      bytes: manifest.items.reduce((sum, item) => sum + item.bytes, 0),
      reviewSheet: sheet,
    }),
  );
} finally {
  await browser.close();
  server.close();
}
