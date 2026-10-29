/** Compile explicitly registered original art sheets into the paper-doll manifest.
 * node scripts/build-avatar-2d-assets.mjs --spec <registry.json> [--out public/avatar/v2]
 * A cell has id, sheet, cell:[column,row] OR crop:[x,y,w,h], rect:[x,y,w,h]
 * (normalized canvas coordinates), fit:'bounds'|'frame', optional layer metadata.
 * A registry contains sheets:[{id,src,columns,rows}], cells:[], characters:{}.
 * Character base/slot/pose layer arrays reference cell IDs, or {ref,...overrides}.
 * No inferred segmentation, web requests, user data, or production writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions/package.json"));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const textHash = (value) =>
  hash(value.toString("utf8").replaceAll("\r\n", "\n"));
const args = process.argv.slice(2);
const argument = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
assert(
  argument("--spec"),
  "--spec must identify an explicit original-art registry",
);
const specFile = path.resolve(argument("--spec"));
const spec = JSON.parse(await fs.readFile(specFile, "utf8"));
const out = path.resolve(
  argument("--out") || path.join(root, "public/avatar/v2"),
);
const canvas = spec.canvas || [1024, 1280];
assert(
  canvas.length === 2 && canvas.every((v) => Number.isInteger(v) && v > 0),
);
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const compilerSha256 = textHash(
  await fs.readFile(fileURLToPath(import.meta.url)),
);
const registrySha256 = textHash(await fs.readFile(specFile));
function verifyCoverage(manifest) {
  for (const character of ["girl", "boy"]) {
    const definition = manifest.characters[character];
    assert(
      definition && Array.isArray(definition.base) && definition.base.length,
      `${character}: missing body art`,
    );
    for (const item of catalog.items.filter((entry) =>
      entry.characters.includes(character),
    )) {
      if (item.slot === "character") continue;
      if (["skinTone", "hairTone"].includes(item.slot)) {
        assert(
          Object.hasOwn(manifest.palettes[item.slot], item.value),
          `Missing palette ${item.id}`,
        );
        const color = manifest.palettes[item.slot][item.value];
        assert(
          color === null || /^#[0-9a-f]{6}$/i.test(color),
          `Invalid palette ${item.id}`,
        );
      } else
        assert(
          item.slot === "pose"
            ? definition.poses[item.value]
            : definition.slots[item.slot]?.[item.value],
          `Missing art mapping ${character}/${item.id}`,
        );
    }
  }
}
if (args.includes("--check")) {
  const provenance = JSON.parse(
    await fs.readFile(path.join(out, "provenance.json"), "utf8"),
  );
  const manifestBytes = await fs.readFile(path.join(out, "manifest.json"));
  assert.equal(
    provenance.compilerSha256,
    compilerSha256,
    "Art compiler changed: rebuild 2D assets",
  );
  assert.equal(
    provenance.registrySha256,
    registrySha256,
    "Art registration changed: rebuild 2D assets",
  );
  assert.equal(
    provenance.manifestSha256,
    textHash(manifestBytes),
    "Manifest changed outside art compiler",
  );
  verifyCoverage(JSON.parse(manifestBytes));
  for (const sheet of spec.sheets) {
    const sourceFile = path.resolve(
      spec.sourceBase === "repository" ? root : path.dirname(specFile),
      sheet.src,
    );
    const sha = hash(await fs.readFile(sourceFile));
    assert.equal(sha, sheet.sha256, `Original art changed: ${sheet.id}`);
    assert.equal(
      sha,
      provenance.sourceHashes[sheet.id].sha256,
      `Stale art: ${sheet.id}`,
    );
  }
  let bytes = 0;
  for (const asset of provenance.assets) {
    assert(asset.file.startsWith("layers/") && !asset.file.includes(".."));
    const content = await fs.readFile(path.join(out, asset.file));
    assert.equal(hash(content), asset.sha256, `Layer changed: ${asset.id}`);
    bytes += content.length;
  }
  console.log(
    `PASS 2D original art: ${spec.sheets.length} sheets, ${provenance.assets.length} layers, ${catalog.items.length} catalog IDs, ${bytes} bytes; source/registry/compiler/layer hashes match.`,
  );
  process.exit(0);
}
// CI checks only hash already authored assets; encoding dependencies are local.
const sharp = require("sharp");
const safeId = (id) =>
  typeof id === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(id);
const sheets = new Map(),
  cells = new Map(),
  assets = new Map();
const sourceHashes = {},
  provenance = [],
  warnings = [];
const previous = await fs
  .readFile(path.join(out, "provenance.json"), "utf8")
  .then(JSON.parse)
  .catch(() => ({ assets: [] }));
const previousAssets = new Map(
  previous.assets.map((asset) => [asset.id, asset]),
);
await fs.mkdir(path.join(out, "layers"), { recursive: true });

for (const sheet of spec.sheets) {
  assert(
    safeId(sheet.id) && !sheets.has(sheet.id),
    `Duplicate/invalid sheet ${sheet.id}`,
  );
  const sourceFile = path.resolve(
    spec.sourceBase === "repository" ? root : path.dirname(specFile),
    sheet.src,
  );
  const source = await fs.readFile(sourceFile);
  if (sheet.sha256)
    assert.equal(
      hash(source),
      sheet.sha256,
      `Original art changed: ${sheet.id}`,
    );
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(info.width > 0 && info.height > 0 && info.channels === 4);
  sourceHashes[sheet.id] = {
    sha256: hash(source),
    width: info.width,
    height: info.height,
  };
  sheets.set(sheet.id, { ...sheet, data, info });
}

function boundingBox(data, width, height, threshold = 2) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1,
    pixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels++;
    }
  assert(pixels > 0, "Art cell is empty; refusing an invisible catalog item");
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    pixels,
  };
}
function cleanSpecks(
  data,
  width,
  height,
  { minArea = 0, alphaThreshold = 8 } = {},
) {
  if (!minArea) return data;
  const visited = new Uint8Array(width * height),
    keep = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || data[start * 4 + 3] <= alphaThreshold) continue;
    let head = 0,
      tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++],
        x = current % width,
        y = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (visited[next] || data[next * 4 + 3] <= alphaThreshold) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
    }
    if (tail < minArea) continue;
    // Preserve the antialias fringe adjacent to retained painted components.
    for (let index = 0; index < tail; index++) {
      const x = queue[index] % width,
        y = Math.floor(queue[index] / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height)
            keep[ny * width + nx] = 1;
        }
    }
  }
  const result = Buffer.from(data);
  for (let i = 0; i < keep.length; i++) if (!keep[i]) result[i * 4 + 3] = 0;
  return result;
}
function validRect(rect, name) {
  assert(
    Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite),
    `${name}: rect`,
  );
  assert(rect[2] > 0 && rect[3] > 0, `${name}: empty rect`);
}
// Authored paper-doll garments can taper from the shoulder to the waist.
// Resample each source row around its centre; both endpoint scales are explicit
// registration data so a wide hem never determines the shoulder placement.
function taperRows(data, width, height, scales) {
  assert(scales.length === 2 && scales.every((v) => v > 0 && v <= 1));
  const result = Buffer.alloc(data.length);
  for (let y = 0; y < height; y++) {
    const scale =
      scales[0] + ((scales[1] - scales[0]) * y) / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const sourceX = (x - (width - 1) / 2) / scale + (width - 1) / 2;
      if (sourceX < 0 || sourceX > width - 1) continue;
      const left = Math.floor(sourceX),
        right = Math.min(width - 1, left + 1),
        mix = sourceX - left;
      const a = (y * width + left) * 4,
        b = (y * width + right) * 4,
        dest = (y * width + x) * 4;
      const alpha = data[a + 3] * (1 - mix) + data[b + 3] * mix;
      result[dest + 3] = Math.round(alpha);
      if (alpha)
        for (let c = 0; c < 3; c++)
          result[dest + c] = Math.round(
            (data[a + c] * data[a + 3] * (1 - mix) +
              data[b + c] * data[b + 3] * mix) /
              alpha,
          );
    }
  }
  return result;
}
function rgb(hex) {
  assert(/^#[0-9a-f]{6}$/i.test(hex), `Invalid color ${hex}`);
  return [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  );
}
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgb = (v) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const luma = (v) => v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
function colorMask(pixel, reference, mode) {
  if (mode === "all") return 1;
  if (mode === "neutral") {
    const magnitude = Math.max(...pixel),
      minimum = Math.min(...pixel);
    const chroma = magnitude - minimum;
    const ink = Math.max(0, Math.min(1, (magnitude - 0.1) / 0.16));
    return ink * Math.max(0, Math.min(1, (0.14 - chroma) / 0.08));
  }
  // Match normalized chroma, allowing authored light/shadow changes. Neutral
  // ink, white undershirts and gold crests remain original unless explicitly masked.
  const magnitude = Math.max(...pixel),
    minimum = Math.min(...pixel);
  if (magnitude - minimum < 0.055 || magnitude < 0.1) return 0;
  const p = pixel.map((v) => v / magnitude),
    r = reference.map((v) => v / Math.max(...reference));
  const distance = Math.sqrt(p.reduce((sum, v, i) => sum + (v - r[i]) ** 2, 0));
  return Math.max(0, Math.min(1, (0.35 - distance) / 0.15));
}
function recolor(data, options) {
  const target = rgb(options.color).map(linear),
    reference = rgb(options.sourceColor);
  const baseLuma = luma(reference.map(linear));
  assert(
    baseLuma > 0.01,
    "Recolor source color is too dark to recover shading",
  );
  const result = Buffer.from(data);
  for (let i = 0; i < result.length; i += 4) {
    if (!result[i + 3]) continue;
    const original = [data[i], data[i + 1], data[i + 2]].map((v) => v / 255);
    const amount = colorMask(original, reference, options.mode || "chroma");
    const shade = luma(original.map(linear)) / baseLuma;
    for (let channel = 0; channel < 3; channel++) {
      const colored = srgb(Math.min(1, target[channel] * shade));
      result[i + channel] = Math.round(
        255 * (original[channel] * (1 - amount) + colored * amount),
      );
    }
  }
  return result;
}

async function writeLayer(id, data, width, height, layer, source) {
  assert(safeId(id) && !assets.has(id), `Duplicate/invalid layer ${id}`);
  const file = `layers/${id}.webp`;
  const rawSha256 = hash(data),
    old = previousAssets.get(id);
  let bytes;
  if (
    old?.rawSha256 === rawSha256 &&
    old.width === width &&
    old.height === height
  )
    bytes = await fs.readFile(path.join(out, file)).catch(() => undefined);
  if (!bytes || hash(bytes) !== old?.sha256) {
    bytes = await sharp(data, { raw: { width, height, channels: 4 } })
      .webp({ lossless: true })
      .toBuffer();
    await fs.writeFile(path.join(out, file), bytes);
  }
  const {
    ref,
    sheet,
    cell,
    crop,
    fit,
    cleanup,
    variants,
    sourceColor,
    rowScale,
    tintMask,
    recolor: colorOptions,
    ...metadata
  } = layer;
  const result = { ...metadata, id, src: file };
  if (result.tint?.maskRef) {
    result.tint = {
      ...result.tint,
      mask: `layers/${result.tint.maskRef}.webp`,
    };
    delete result.tint.maskRef;
  }
  assets.set(id, result);
  provenance.push({
    id,
    file,
    sha256: hash(bytes),
    rawSha256,
    width,
    height,
    source,
  });
}

for (const cell of spec.cells) {
  assert(
    safeId(cell.id) && !cells.has(cell.id),
    `Duplicate/invalid cell ${cell.id}`,
  );
  const sheet = sheets.get(cell.sheet);
  assert(sheet, `Unknown sheet ${cell.sheet}`);
  let crop = cell.crop;
  if (!crop) {
    assert(
      Number.isInteger(sheet.columns) && Number.isInteger(sheet.rows),
      `Grid missing for ${cell.id}`,
    );
    const width = sheet.info.width / sheet.columns,
      height = sheet.info.height / sheet.rows;
    assert(
      cell.cell?.length === 2 && cell.cell.every(Number.isInteger),
      `${cell.id}: cell index`,
    );
    crop = [
      Math.round(cell.cell[0] * width),
      Math.round(cell.cell[1] * height),
      Math.round((cell.cell[0] + 1) * width) - Math.round(cell.cell[0] * width),
      Math.round((cell.cell[1] + 1) * height) -
        Math.round(cell.cell[1] * height),
    ];
  }
  validRect(crop, cell.id);
  assert(
    crop.every(Number.isInteger) &&
      crop[0] >= 0 &&
      crop[1] >= 0 &&
      crop[0] + crop[2] <= sheet.info.width &&
      crop[1] + crop[3] <= sheet.info.height,
    `${cell.id}: crop outside sheet`,
  );
  const raw = await sharp(sheet.data, { raw: sheet.info })
    .extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
    .raw()
    .toBuffer();
  const extracted = cleanSpecks(
    raw,
    crop[2],
    crop[3],
    cell.cleanup || sheet.cleanup,
  );
  const bounds = boundingBox(extracted, crop[2], crop[3]);
  if (
    !bounds.left ||
    !bounds.top ||
    bounds.left + bounds.width === crop[2] ||
    bounds.top + bounds.height === crop[3]
  )
    warnings.push(
      `${cell.id}: visible art touches cell edge; inspect for clipping/adjacent parts`,
    );
  const source = { sheet: cell.sheet, crop, bounds };
  let pixels = await sharp(extracted, {
    raw: { width: crop[2], height: crop[3], channels: 4 },
  })
    .extract({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    })
    .raw()
    .toBuffer();
  const rect = [...cell.rect];
  validRect(rect, cell.id);
  if ((cell.fit || "frame") === "frame") {
    rect[0] += (cell.rect[2] * bounds.left) / crop[2];
    rect[1] += (cell.rect[3] * bounds.top) / crop[3];
    rect[2] *= bounds.width / crop[2];
    rect[3] *= bounds.height / crop[3];
  } else if (cell.fit !== "stretch") {
    assert(cell.fit === "bounds", `${cell.id}: unsupported fit`);
    const scale = Math.min(
      (rect[2] * canvas[0]) / bounds.width,
      (rect[3] * canvas[1]) / bounds.height,
    );
    const width = (bounds.width * scale) / canvas[0],
      height = (bounds.height * scale) / canvas[1];
    const align = cell.align || [0.5, 0.5];
    rect[0] += (rect[2] - width) * align[0];
    rect[1] += (rect[3] - height) * align[1];
    rect[2] = width;
    rect[3] = height;
  }
  const layer = { ...cell, rect };
  delete layer.align;
  if (cell.rowScale)
    pixels = taperRows(pixels, bounds.width, bounds.height, cell.rowScale);
  if (cell.recolor) pixels = recolor(pixels, cell.recolor);
  if (cell.tintMask) {
    // Red ribbon accents belong to the original hair artwork, but are not dye.
    // The registered thresholds leave neutral hair fully tintable and feather
    // the mask along the ribbon's antialiased edge.
    const [low, high] = cell.tintMask.excludeRed;
    assert(low >= 0 && high > low && high <= 255);
    const mask = Buffer.alloc(pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]);
      const amount = 1 - Math.max(0, Math.min(1, (red - low) / (high - low)));
      mask[i] = mask[i + 1] = mask[i + 2] = 255;
      mask[i + 3] = Math.round(pixels[i + 3] * amount);
    }
    const maskId = `${cell.id}-tint-mask`;
    await writeLayer(
      maskId,
      mask,
      bounds.width,
      bounds.height,
      { ...layer, id: maskId, tint: undefined },
      { ...source, maskFor: cell.id, tintMask: cell.tintMask },
    );
    layer.tint = { ...layer.tint, maskRef: maskId };
  }
  cells.set(cell.id, {
    data: pixels,
    width: bounds.width,
    height: bounds.height,
    layer,
    source,
  });
  await writeLayer(cell.id, pixels, bounds.width, bounds.height, layer, source);
}
for (const variant of spec.variants || []) {
  const base = cells.get(variant.ref);
  assert(base, `Unknown variant base ${variant.ref}`);
  const pixels = variant.recolor
    ? recolor(base.data, variant.recolor)
    : base.data;
  await writeLayer(
    variant.id,
    pixels,
    base.width,
    base.height,
    { ...base.layer, ...variant },
    { ...base.source, variantOf: variant.ref, recolor: variant.recolor },
  );
}
function expandLayers(list) {
  assert(Array.isArray(list), "Layer list must be explicit");
  return list.map((entry) => {
    const id = typeof entry === "string" ? entry : entry.ref;
    const layer = assets.get(id);
    assert(layer, `Unknown referenced layer ${id}`);
    const override = typeof entry === "string" ? {} : { ...entry };
    delete override.ref;
    if (override.mirror) {
      const rect = override.rect || layer.rect;
      override.rect = [1 - rect[0] - rect[2], rect[1], rect[2], rect[3]];
      override.flipX = true;
      delete override.mirror;
    }
    return { ...layer, ...override };
  });
}
function expandDefinition(value) {
  return Array.isArray(value)
    ? expandLayers(value)
    : { ...value, layers: expandLayers(value.layers || []) };
}
const characters = {};
for (const character of ["girl", "boy"]) {
  const definition = spec.characters[character];
  assert(definition, `Missing ${character} character`);
  characters[character] = {
    ...definition,
    base: expandLayers(definition.base),
    slots: {},
    poses: {},
  };
  for (const [slot, values] of Object.entries(definition.slots)) {
    characters[character].slots[slot] = Object.fromEntries(
      Object.entries(values).map(([id, value]) => [
        id,
        expandDefinition(value),
      ]),
    );
  }
  for (const [id, pose] of Object.entries(definition.poses))
    characters[character].poses[id] = {
      ...pose,
      ...(pose.layers ? { layers: expandLayers(pose.layers) } : {}),
    };
  for (const item of catalog.items.filter((item) =>
    item.characters.includes(character),
  )) {
    if (["character", "skinTone", "hairTone"].includes(item.slot)) continue;
    assert(
      item.slot === "pose"
        ? characters[character].poses[item.value]
        : characters[character].slots[item.slot]?.[item.value],
      `Missing real art mapping: ${character}/${item.slot}/${item.value}`,
    );
  }
}
const palettes =
  spec.palettes ||
  Object.fromEntries(
    ["skinTone", "hairTone"].map((slot) => [
      slot,
      Object.fromEntries(
        catalog.items
          .filter((item) => item.slot === slot)
          .map((item) => [
            item.value,
            item.value === "original" ? null : item.color,
          ]),
      ),
    ]),
  );
const manifest = { version: 2, canvas, characters, palettes };
verifyCoverage(manifest);
const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
await fs.writeFile(path.join(out, "manifest.json"), manifestBytes);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      compilerSha256,
      registrySha256,
      manifestSha256: textHash(manifestBytes),
      sourceHashes,
      assets: provenance,
      warnings,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      manifest: path.join(out, "manifest.json"),
      layers: assets.size,
      catalogItems: catalog.items.length,
      warnings,
    },
    null,
    2,
  ),
);
