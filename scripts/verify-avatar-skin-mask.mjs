/** Compile a synthetic atlas: only authored neck/hand regions may change skin tone. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions/package.json"));
const sharp = require("sharp");
sharp.cache(false);
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "westory-skin-mask-"));
try {
  const pixels = Buffer.alloc(256 * 256 * 4);
  const swatches = [
    [52, 36, [234, 179, 141]], // exposed skin inside the authored region
    [132, 36, [234, 179, 141]], // same-colored fabric outside the region
    [52, 116, [210, 160, 50]], // gold inside a loose region is still not skin
    [132, 116, [70, 80, 140]],
    [52, 76, [234, 179, 141]], // warm collar inside the coarse region, outside the contour
  ];
  for (const [left, top, color] of swatches)
    for (let y = top; y < top + 20; y++)
      for (let x = left; x < left + 20; x++)
        pixels.set([...color, 255], (y * 256 + x) * 4);
  const source = await sharp(pixels, {
    raw: { width: 256, height: 256, channels: 4 },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(scratch, "source.png"), source);
  const art = { base: ["test-base"], slots: {}, poses: {} };
  for (const item of catalog.items) {
    if (["character", "skinTone", "hairTone"].includes(item.slot)) continue;
    if (item.slot === "pose") art.poses[item.value] = {};
    else (art.slots[item.slot] ??= {})[item.value] = [];
  }
  const spec = {
    canvas: [256, 256],
    sheets: [
      {
        id: "test",
        src: "source.png",
        sha256: createHash("sha256").update(source).digest("hex"),
      },
    ],
    cells: [
      {
        id: "test-base",
        sheet: "test",
        crop: [32, 16, 160, 160],
        rect: [0, 0, 1, 1],
        z: 1,
        fit: "frame",
        skinRegions: [
          [0.1, 0.1, 0.15, 0.4],
          [0.1, 0.6, 0.15, 0.15],
        ],
        skinPolygons: [
          [
            [0.1, 0.1],
            [0.25, 0.1],
            [0.25, 0.25],
            [0.1, 0.25],
          ],
          [
            [0.1, 0.6],
            [0.25, 0.6],
            [0.25, 0.75],
            [0.1, 0.75],
          ],
          [
            [0.6, 0.1],
            [0.75, 0.1],
            [0.75, 0.25],
            [0.6, 0.25],
          ],
        ],
        recolor: { color: "#f7cfa8", sourceColor: "#eab38d", mode: "skin" },
        tint: { slot: "skinTone", sourceColor: "#f7cfa8" },
        tintMask: { includeSkin: true },
      },
    ],
    variants: [
      {
        id: "test-variant",
        ref: "test-base",
        recolor: {
          color: "#334466",
          sourceColor: "#eab38d",
          mode: "all",
          excludeSkin: true,
        },
      },
    ],
    characters: { girl: art, boy: art },
  };
  const specPath = path.join(scratch, "registry.json");
  const out = path.join(scratch, "compiled");
  await fs.writeFile(specPath, JSON.stringify(spec));
  const args = [
    path.join(root, "scripts/build-avatar-2d-assets.mjs"),
    "--spec",
    specPath,
    "--out",
    out,
  ];
  const compile = () => {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  compile();
  const sample = async (file) => {
    const { data, info } = await sharp(path.join(out, "layers", file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(
      info.width,
      100,
      "source crop and transparent bounds are trimmed",
    );
    assert.equal(info.height, 100);
    return [
      [10, 10],
      [90, 10],
      [10, 90],
      [90, 90],
      [10, 50],
    ].map(([x, y]) => [
      ...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4),
    ]);
  };
  const original = await sample("test-base.webp");
  const variant = await sample("test-variant.webp");
  const mask = await sample("test-base-tint-mask.webp");
  assert.deepEqual(
    original[0],
    [247, 207, 168, 255],
    "exposed skin normalizes to the common palette",
  );
  assert.deepEqual(
    original[1],
    [234, 179, 141, 255],
    "skin-colored fabric is not normalized",
  );
  assert.deepEqual(
    original[2],
    [210, 160, 50, 255],
    "gold ornament is not normalized",
  );
  assert.deepEqual(
    mask.map((pixel) => pixel[3]),
    [255, 0, 0, 0, 0],
    "runtime skin tint covers only authored skin",
  );
  assert.deepEqual(
    variant[0],
    original[0],
    "garment recolor retains the same normalized skin coverage",
  );
  assert.notDeepEqual(
    variant[1],
    original[1],
    "excludeSkin does not protect skin-colored fabric",
  );
  assert.notDeepEqual(
    variant[2],
    original[2],
    "excludeSkin does not protect gold as skin",
  );
  assert.deepEqual(
    original[4],
    [234, 179, 141, 255],
    "warm collar outside the precise contour is not normalized",
  );
  assert.notDeepEqual(
    variant[4],
    original[4],
    "warm collar remains garment-recolorable",
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(out, "manifest.json"), "utf8"),
  );
  assert(
    !JSON.stringify(manifest).includes("skinRegions"),
    "compiler-only masks are absent from runtime metadata",
  );
  assert(
    !JSON.stringify(manifest).includes("skinPolygons"),
    "source contours are compiler-only metadata",
  );
  const before = await fs.readFile(path.join(out, "provenance.json"), "utf8");
  compile();
  assert.equal(
    await fs.readFile(path.join(out, "provenance.json"), "utf8"),
    before,
    "rebuild preserves exact layer and provenance hashes",
  );
  const checked = spawnSync(process.execPath, [...args, "--check"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  console.log(
    "PASS avatar skin masks: source-cell regions survive crop/bounds, skin normalization/tint/recolor share coverage, fabric and gold are excluded, rebuild hashes match.",
  );
} finally {
  // The unique OS temp directory was created above and contains only this fixture.
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
  assert(path.basename(scratch).startsWith("westory-skin-mask-"));
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

// Representative source-cell anchors from the reviewed robe atlas. These guard
// against a broad region accidentally reintroducing collar or regalia tint.
const provenance = JSON.parse(
  await fs.readFile(
    path.join(root, "public/avatar/v2/provenance.json"),
    "utf8",
  ),
);
const exposedSkin = {
  idle: [
    [0.513, 0.244],
    [0.284, 0.801],
    [0.727, 0.803],
  ],
  wave: [
    [0.5, 0.244],
    [0.194, 0.32],
    [0.713, 0.805],
  ],
  cheer: [
    [0.489, 0.244],
    [0.242, 0.346],
    [0.734, 0.344],
  ],
  think: [
    [0.516, 0.21],
    [0.455, 0.31],
    [0.728, 0.768],
  ],
  heart: [
    [0.5, 0.211],
    [0.435, 0.372],
    [0.563, 0.372],
  ],
};
for (const [pose, skinPoints] of Object.entries(exposedSkin)) {
  const asset = provenance.assets.find(
    (entry) => entry.id === `v3-robe-${pose}-tint-mask`,
  );
  assert(asset, `${pose}: compiled skin mask exists`);
  const { data, info } = await sharp(
    path.join(root, "public/avatar/v2", asset.file),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { bounds, crop } = asset.source;
  const alpha = ([u, v]) => {
    const x = Math.round(
      ((u * crop[2] - bounds.left) * info.width) / bounds.width,
    );
    const y = Math.round(
      ((v * crop[3] - bounds.top) * info.height) / bounds.height,
    );
    return data[(y * info.width + x) * 4 + 3] || 0;
  };
  const garmentPoints = ["think", "heart"].includes(pose)
    ? [
        [0.515, 0.445],
        [0.515, 0.486],
        [0.55, 0.244],
      ]
    : [
        [0.515, 0.46],
        [0.515, 0.52],
        [pose === "idle" ? 0.462 : pose === "wave" ? 0.447 : 0.437, 0.26],
      ];
  assert(
    skinPoints.every((point) => alpha(point) > 200),
    `${pose}: neck and both hands remain tintable`,
  );
  assert(
    garmentPoints.every((point) => alpha(point) === 0),
    `${pose}: crest, gold belt and white collar must never tint as skin`,
  );
}
console.log(
  "PASS reviewed robe atlas: all 5 poses retain neck/hand tint and exclude crest, belt and collar pixels.",
);
