// Reproducible format/branding pass for approved image_gen artwork.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(path.join(root, "functions/package.json"))("sharp");
const sources = process.argv.slice(2);
if (sources.length !== 3) throw new Error("Provide approved boy hero, guide 1, guide 2 PNG paths.");
const destination = path.join(root, "public/notice-guides/20261110-gongsinmoongo");
fs.mkdirSync(destination, { recursive: true });
const wordmark = await sharp(path.join(root, "src/assets/brand/westory-wordmark.webp")).trim().png().toBuffer();
for (const [index, source] of sources.entries()) {
  const width = index === 0 ? 1200 : 1024;
  const height = index === 0 ? 675 : 1536;
  const edge = Math.min(width, height);
  const logo = await sharp(wordmark).resize({ width: Math.round(edge * 0.24) }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const left = Math.round(width - edge * 0.04 - logoMeta.width);
  const top = Math.round(height - edge * 0.04 - logoMeta.height);
  const rim = 4;
  const halo = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < halo.data.length; pixel += 4) {
    halo.data[pixel] = 255;
    halo.data[pixel + 1] = 255;
    halo.data[pixel + 2] = 255;
  }
  const outline = await sharp(halo.data, { raw: halo.info })
    .extend({ top: rim, bottom: rim, left: rim, right: rim, background: "#ffffff00" })
    .blur(Math.max(0.5, edge * 0.002)).png().toBuffer();
  const filename = index === 0 ? "hero.webp" : `guide-0${index}.webp`;
  await sharp(source).resize(width, height, { fit: "fill" })
    .composite([{ input: outline, left: left - rim, top: top - rim }, { input: logo, left, top }])
    .webp({ quality: 94 }).toFile(path.join(destination, filename));
  console.log(`${filename}: ${width}x${height}, ${fs.statSync(path.join(destination, filename)).size} bytes`);
}
