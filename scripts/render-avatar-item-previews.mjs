/** Build lossless item previews with the exact runtime pixel painter. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = createRequire(path.join(root, "functions/package.json"))("sharp");
const destination = path.join(root, "public/avatar/minimi-v2/previews");
const evidence = path.join(root, "output/minimi-rebuild-20261111");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const hash = (x) => createHash("sha256").update(x).digest("hex");
const sourceNames = [
  "scripts/render-avatar-item-previews.mjs",
  "functions/avatarCatalog.json",
  "src/features/avatar/catalog.ts",
  ...(await fs.readdir(path.join(root, "src/features/avatar/minimi")))
    .filter((x) => x.endsWith(".ts"))
    .sort()
    .map((x) => "src/features/avatar/minimi/" + x),
];
const sources = Object.fromEntries(
  await Promise.all(
    sourceNames.map(async (file) => [
      file,
      hash(
        (await fs.readFile(path.join(root, file), "utf8")).replaceAll(
          "\r\n",
          "\n",
        ),
      ),
    ]),
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
    sources,
    "Regenerate previews after renderer/catalog changes",
  );
  assert.equal(manifest.items.length, entries.length);
  let total = 0;
  for (const entry of entries) {
    const record = manifest.items.find((item) => item.file === entry.file);
    assert(
      record && record.id === entry.item.id,
      `Missing preview ${entry.file}`,
    );
    const bytes = await fs.readFile(path.join(destination, entry.file));
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.equal(hash(bytes), record.sha256);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 256);
    assert.equal(meta.height, 256);
    assert(meta.hasAlpha);
    assert(bytes.length > 100 && bytes.length < 40000);
    total += bytes.length;
  }
  assert(total < 2_000_000);
  console.log(
    `PASS: ${entries.length} minimi runtime previews, ${total} bytes; source fingerprints match.`,
  );
  process.exit(0);
}
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
const bundle = await build({
  stdin: {
    contents: `
import {drawMinimi,MINIMI_WIDTH,MINIMI_HEIGHT} from './src/features/avatar/minimi/engine';
import {defaultAvatarLook} from './src/features/avatar/catalog';
window.renderItem=(item,character)=>{
 const look={...defaultAvatarLook(character),[item.slot]:item.value};
 if(item.value==='mm-school-hoodie'||item.value==='mm-school-halfzip')look.bottom='mm-school-joggers';
 if(item.value==='mm-school-joggers')look.top='mm-school-hoodie';
 const sprite=document.createElement('canvas');sprite.width=MINIMI_WIDTH;sprite.height=MINIMI_HEIGHT;
 drawMinimi(sprite.getContext('2d'),look);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
 ctx.drawImage(sprite,(256-MINIMI_WIDTH*2)/2,(256-MINIMI_HEIGHT*2)/2,MINIMI_WIDTH*2,MINIMI_HEIGHT*2);
 return canvas.toDataURL('image/png');
};`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const server = http.createServer((req, res) => {
  if (req.url === "/stage.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles[0].contents);
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      '<!doctype html><meta charset="utf-8"><script type="module" src="/stage.js"></script>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) =>
    r.request().url().startsWith(origin) ? r.continue() : r.abort(),
  );
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderItem === "function");
  const manifest = {
    version: 2,
    width: 256,
    height: 256,
    scale: 2,
    format: "lossless-webp",
    sources,
    items: [],
  };
  for (const entry of entries) {
    const data = await page.evaluate(
      ({ item, character }) => window.renderItem(item, character),
      entry,
    );
    const bytes = await sharp(Buffer.from(data.split(",")[1], "base64"))
      .webp({ lossless: true, effort: 6 })
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
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const samples = entries.filter((x) =>
    ["top", "bottom", "hairStyle", "accessory"].includes(x.item.slot),
  );
  const tiles = [];
  for (let i = 0; i < samples.length; i++) {
    const entry = samples[i],
      label = entry.character + " / " + entry.item.value;
    const background = Buffer.from(
      `<svg width="192" height="220"><rect width="192" height="220" fill="#f8fafc"/><text x="8" y="210" font-size="10" font-family="Arial" fill="#334155">${label}</text></svg>`,
    );
    const png = await sharp(path.join(destination, entry.file))
      .resize(192, 192, { kernel: "nearest" })
      .png()
      .toBuffer();
    tiles.push({
      input: await sharp(background)
        .composite([{ input: png, top: 0, left: 0 }])
        .png()
        .toBuffer(),
      top: Math.floor(i / 8) * 220,
      left: (i % 8) * 192,
    });
  }
  await fs.mkdir(evidence, { recursive: true });
  const sheet = path.join(evidence, "catalog-review.png");
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
      bytes: manifest.items.reduce((sum, x) => sum + x.bytes, 0),
      reviewSheet: sheet,
    }),
  );
} finally {
  await browser.close();
  server.close();
}
