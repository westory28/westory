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

// The school crest contains orange pixels close to skin hues. Check actual
// opaque source pixels rather than accepting the existence of a mask file.
const schoolSkinAnchors = {
  idle: [
    [0.513, 0.245],
    [0.267, 0.835],
    [0.75, 0.835],
  ],
  wave: [
    [0.51, 0.245],
    [0.19, 0.31],
    [0.735, 0.835],
  ],
  cheer: [
    [0.49, 0.245],
    [0.22, 0.34],
    [0.746, 0.34],
  ],
  think: [
    [0.511, 0.21],
    [0.453, 0.29],
    [0.745, 0.83],
  ],
  heart: [
    [0.5, 0.21],
    [0.431, 0.369],
    [0.575, 0.369],
  ],
};
for (const family of ["winter-hoodie", "winter-halfzip"]) {
  const source = await sharp(
    path.join(root, "assets/avatar-source/school-20261110", `${family}.png`),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const [pose, skinPoints] of Object.entries(schoolSkinAnchors)) {
    const asset = provenance.assets.find(
      (entry) => entry.id === `v3-${family}-${pose}-tint-mask`,
    );
    assert(asset, `${family}/${pose}: compiled skin mask exists`);
    const mask = await sharp(path.join(root, "public/avatar/v2", asset.file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { crop, bounds } = asset.source;
    const maskAlpha = (x, y) => {
      const mx = Math.round(
        ((x - bounds.left) * mask.info.width) / bounds.width,
      );
      const my = Math.round(
        ((y - bounds.top) * mask.info.height) / bounds.height,
      );
      if (mx < 0 || my < 0 || mx >= mask.info.width || my >= mask.info.height)
        return 0;
      return mask.data[(my * mask.info.width + mx) * 4 + 3];
    };
    assert(
      skinPoints.every(([u, v]) => maskAlpha(u * crop[2], v * crop[3]) > 200),
      `${family}/${pose}: neck and both hands remain tintable`,
    );
    let mintPixels = 0;
    let crestPixels = 0;
    for (let y = 0; y < crop[3]; y += 2) {
      for (let x = 0; x < crop[2]; x += 2) {
        const index = ((crop[1] + y) * source.info.width + crop[0] + x) * 4;
        const [r, g, b, a] = source.data.subarray(index, index + 4);
        if (a < 230) continue;
        const mint =
          r >= 70 &&
          r < 200 &&
          g >= r + 25 &&
          b >= r + 10 &&
          g >= b &&
          g - b < 45;
        // Heart hands naturally cover the left-chest badge in the source art.
        const crest =
          pose !== "heart" &&
          x / crop[2] > 0.55 &&
          x / crop[2] < 0.67 &&
          y / crop[3] > 0.34 &&
          y / crop[3] < 0.47 &&
          r > 160 &&
          g > 70 &&
          g < 150 &&
          b < 90 &&
          r > g * 1.3 &&
          g > b * 1.3;
        if (!mint && !crest) continue;
        assert.equal(
          maskAlpha(x, y),
          0,
          `${family}/${pose}: ${crest ? "orange school crest" : "mint stripe"} must not receive skin tint at ${x},${y}`,
        );
        if (mint) mintPixels++;
        if (crest) crestPixels++;
      }
    }
    assert(
      mintPixels > 100,
      `${family}/${pose}: verified opaque mint stripe samples`,
    );
    if (pose !== "heart")
      assert(
        crestPixels > 20,
        `${family}/${pose}: verified actual orange crest samples`,
      );
  }
}
console.log(
  "PASS school sportswear: both tops in all 5 poses retain neck/hand tint and exclude actual orange crest and mint stripe pixels.",
);
