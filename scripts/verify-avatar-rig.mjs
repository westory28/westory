/**
 * Garments must move with the body part they cover. Runs the real painter on a
 * small integer raster, so the build needs no browser, image library or server.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { outputFiles } = await build({
  stdin: {
    contents: `
export { drawMinimi, MINIMI_VALUES, MINIMI_WIDTH, MINIMI_HEIGHT } from './src/features/avatar/minimi/draw';
export { resolveMinimiRig, kneeRow, limbFrame, MINIMI_KNEE_ROW } from './src/features/avatar/minimi/rig';
export { TOPS, BOTTOMS } from './src/features/avatar/minimi/wardrobe';
export { hanbokHatHairLine } from './src/features/avatar/minimi/hanbok';
export { defaultAvatarLook, AVATAR_ITEMS } from './src/features/avatar/catalog';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
// Imported, not sandboxed: the painter makes thousands of calls per figure.
const {
  drawMinimi,
  MINIMI_VALUES: V,
  MINIMI_WIDTH: W,
  MINIMI_HEIGHT: H,
  resolveMinimiRig,
  kneeRow,
  limbFrame,
  MINIMI_KNEE_ROW,
  TOPS,
  BOTTOMS,
  hanbokHatHairLine,
  defaultAvatarLook,
  AVATAR_ITEMS,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].contents).toString("base64")
);

/** The subset of CanvasRenderingContext2D the painter uses, on whole pixels. */
function raster() {
  const pixels = new Int32Array(W * H).fill(-1);
  let tx = 0,
    ty = 0,
    clip = [0, 0, W, H],
    path = [];
  const stack = [],
    colors = new Map();
  const fill = (x, y, w, h, value) => {
    if (x !== (x | 0) || y !== (y | 0) || w !== (w | 0) || h !== (h | 0))
      assert.fail("Painter left the whole-pixel grid");
    const left = Math.max(clip[0], Math.min(x, x + w) + tx),
      right = Math.min(clip[2], Math.max(x, x + w) + tx),
      bottom = Math.min(clip[3], Math.max(y, y + h) + ty);
    if (right <= left) return;
    for (
      let row = Math.max(clip[1], Math.min(y, y + h) + ty);
      row < bottom;
      row++
    )
      pixels.fill(value, row * W + left, row * W + right);
  };
  const context = {
    fillStyle: "#000000",
    imageSmoothingEnabled: false,
    save: () => stack.push([tx, ty, clip]),
    restore: () => {
      if (stack.length) [tx, ty, clip] = stack.pop();
    },
    translate(x, y) {
      assert(Number.isInteger(x) && Number.isInteger(y), "Fractional offset");
      tx += x;
      ty += y;
    },
    beginPath: () => (path = []),
    rect: (x, y, w, h) => path.push([x + tx, y + ty, x + w + tx, y + h + ty]),
    clip() {
      assert.equal(path.length, 1, "Only rectangular clips are supported");
      clip = [
        Math.max(clip[0], path[0][0]),
        Math.max(clip[1], path[0][1]),
        Math.min(clip[2], path[0][2]),
        Math.min(clip[3], path[0][3]),
      ];
    },
    clearRect: (x, y, w, h) => fill(x, y, w, h, -1),
    fillRect(x, y, w, h) {
      let color = colors.get(context.fillStyle);
      if (color === undefined) {
        assert(
          /^#[0-9a-f]{6}$/i.test(context.fillStyle),
          `Unsupported colour ${context.fillStyle}`,
        );
        color = Number.parseInt(context.fillStyle.slice(1), 16);
        colors.set(context.fillStyle, color);
      }
      fill(x, y, w, h, color);
    },
  };
  return { context, pixels };
}
const surface = raster();
const paint = (look, options) => {
  drawMinimi(surface.context, look, options);
  return surface.pixels.slice();
};
const at = (image, x, y) =>
  x < 0 || y < 0 || x >= W || y >= H ? -1 : image[y * W + x];
const hex = (color) => Number.parseInt(color.slice(1), 16);
const fail = (message, look, motion) =>
  assert.fail(`${message}: ${JSON.stringify({ ...look, motion })}`);
const same = (actual, expected, message, look, motion) => {
  for (let index = 0; index < actual.length; index++)
    if (actual[index] !== expected[index])
      fail(`${message} at ${index % W},${Math.floor(index / W)}`, look, motion);
};
const wearable = (slot, value, character) =>
  AVATAR_ITEMS.some(
    (item) =>
      item.slot === slot &&
      item.value === value &&
      item.characters.includes(character),
  );
const girl = defaultAvatarLook("girl");

// 1. Without motion the painter is exactly the resting figure.
for (const pose of V.pose)
  for (const top of V.top) {
    const look = { ...girl, pose, top };
    same(
      paint(look, { motion: { crouch: 0, feet: [0, 0], body: [0, 0] } }),
      paint(look),
      "Zero motion changed the figure",
      look,
    );
  }
assert.deepEqual(
  resolveMinimiRig("mm-idle", {
    crouch: 9,
    feet: [9, -4],
    body: [5, -5],
    head: [-9, 9],
  }),
  resolveMinimiRig("mm-idle", {
    crouch: 3,
    feet: [0, 0],
    body: [1, 0],
    head: [-2, 2],
  }),
  "Motion must be clamped to what the sprite grid and knees allow",
);
for (const pose of ["unknown-pose", "constructor"])
  assert.deepEqual(
    resolveMinimiRig(pose, null),
    resolveMinimiRig("mm-idle", { feet: [Number.NaN, 0.4] }),
    "An unknown pose or empty motion is the resting figure",
  );

const motions = [
  { body: [1, 1] },
  { head: [2, 2] },
  { head: [-2, -1] },
  { crouch: 2 },
  { feet: [2, 0] },
  { feet: [0, 3] },
  { crouch: 1, feet: [0, 2], body: [-1, 1], head: [1, -1] },
  // The far ends of every range must still fit the sprite grid.
  { crouch: 3, body: [1, 2], head: [2, 2] },
  { body: [-1, 0], head: [-2, -1] },
];

// 2. Each layer moves as one piece with its body part, for every catalogue item.
let rigid = 0;
const moved = (image, [dx, dy], look, motion) => {
  const out = new Int32Array(W * H).fill(-1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const value = image[y * W + x];
      if (value < 0) continue;
      if (x + dx < 1 || x + dx >= W - 1 || y + dy < 1 || y + dy >= H - 1)
        fail("Motion pushes a garment off the sprite", look, motion);
      out[(y + dy) * W + x + dx] = value;
    }
  return out;
};
const attachedTo = {
  accessory: (rig) => rig.head,
  hairStyle: (rig) => rig.head,
  expression: (rig) => rig.head,
  top: (rig) => rig.body,
};
for (const pose of V.pose)
  for (const [slot, offset] of Object.entries(attachedTo))
    for (const value of V[slot]) {
      const look = { ...girl, pose, [slot]: value };
      const rest = paint(look, { itemOnly: slot });
      for (const motion of motions) {
        same(
          paint(look, { itemOnly: slot, motion }),
          moved(rest, offset(resolveMinimiRig(pose, motion)), look, motion),
          `${slot} does not follow its body part`,
          look,
          motion,
        );
        rigid++;
      }
    }
for (const shoes of V.shoes) {
  const look = { ...girl, shoes };
  const rest = paint(look, { itemOnly: "shoes" });
  for (const motion of motions) {
    const rig = resolveMinimiRig(look.pose, motion);
    const shown = paint(look, { itemOnly: "shoes", motion });
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (at(shown, x, y) !== at(rest, x, y + rig.lift[x <= 40 ? 0 : 1]))
          fail("Shoe does not rise with its foot", look, motion);
    rigid++;
  }
}
// A skirt hangs from the hips; garment legs sink above the knee, fold there and
// rise with the foot below it. The folded row itself only has to stay closed.
for (const bottom of V.bottom) {
  const look = { ...girl, bottom };
  const draped =
    bottom === "mm-skirt-navy" ||
    ["skirt", "chima"].includes(BOTTOMS[bottom]?.cut);
  const rest = paint(look, { itemOnly: "bottom" });
  for (const motion of motions) {
    const rig = resolveMinimiRig(look.pose, motion);
    const shown = paint(look, { itemOnly: "bottom", motion });
    if (draped)
      same(
        shown,
        moved(rest, rig.hips, look, motion),
        "Skirt left the hips",
        look,
        motion,
      );
    else
      for (const side of [0, 1]) {
        const sources = Array.from({ length: H }, () => []);
        for (let y = 0; y < H; y++)
          sources[kneeRow(y, rig.sink, rig.lift[side])]?.push(y);
        for (let x = side ? 41 : 0; x < (side ? W : 41); x++)
          for (let y = 0; y < H; y++) {
            const rows = sources[y];
            if (rows.length > 1) {
              if (
                at(shown, x, y) >= 0 !==
                rows.some((row) => at(rest, x, row) >= 0)
              )
                fail("Garment leg opens at the knee", look, motion);
            } else if (at(shown, x, y) !== at(rest, x, rows[0] ?? -1))
              fail("Garment leg does not follow the leg", look, motion);
          }
      }
    rigid++;
  }
}

// 3. A hat keeps covering the crown when the head moves under it.
let hats = 0;
for (const accessory of V.accessory) {
  const brim = accessory === "mm-cap" ? 21 : hanbokHatHairLine(accessory);
  if (!brim) continue;
  for (const hairStyle of V.hairStyle)
    for (const motion of [
      { head: [2, 2] },
      { head: [-2, -1] },
      { crouch: 3 },
    ]) {
      const look = { ...girl, accessory, hairStyle };
      const rig = resolveMinimiRig(look.pose, motion);
      const full = paint(look, { motion });
      const hat = paint(look, { itemOnly: "accessory", motion });
      for (let index = 0; index < (brim + rig.head[1]) * W; index++)
        if (full[index] !== hat[index])
          fail("Hair shows above a moving hat", look, motion);
      hats++;
    }
}

// 4. The moving figure never opens a seam between head, top, bottom, leg and shoe.
let seams = 0;
// Both characters share one body; the one that may wear every bottom is enough.
for (const character of V.character.filter((value) =>
  V.bottom.every((bottom) => wearable("bottom", bottom, value)),
))
  for (const top of V.top)
    for (const bottom of V.bottom) {
      for (const [index, motion] of [{}, ...motions].entries()) {
        const pose = V.pose[(seams + index) % V.pose.length];
        const look = { ...defaultAvatarLook(character), top, bottom, pose };
        const rig = resolveMinimiRig(pose, motion);
        const image = paint(look, { motion });
        for (let x = 37; x <= 43; x++)
          for (let y = 22 + rig.head[1]; y <= 72 + rig.sink; y++)
            if (at(image, x, y) < 0)
              fail(`Open seam on the body at ${x},${y}`, look, motion);
        for (const [side, columns] of [
          [0, [34, 35, 36]],
          [1, [45, 46, 47]],
        ])
          for (const x of columns)
            for (let y = 60 + rig.body[1]; y <= 103 - rig.lift[side]; y++)
              if (at(image, x, y) < 0)
                fail(`Open seam on a leg at ${x},${y}`, look, motion);
        seams++;
      }
    }
// The sock band belongs to the leg, so it rises with the shoe below it.
for (const motion of [{}, ...motions]) {
  const rig = resolveMinimiRig(girl.pose, motion);
  const image = paint(girl, { motion });
  for (const [side, x] of [33, 44].entries())
    for (let column = x; column < x + 4; column++)
      if (at(image, column, 94 - rig.lift[side]) !== hex("#b4bdc7"))
        fail("Sock does not rise with its foot", girl, motion);
}

// 5. Sleeve trims are laid out across the arm segment they sit on, in any pose.
const near = (x, y, [from, to]) => {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  let best = Infinity;
  for (let step = 0; step <= steps; step++)
    best = Math.min(
      best,
      Math.max(
        Math.abs(Math.round(from[0] + ((to[0] - from[0]) * step) / steps) - x),
        Math.abs(Math.round(from[1] + ((to[1] - from[1]) * step) / steps) - y),
      ),
    );
  return best;
};
const middle = (from, to) => [
  Math.round((from[0] + to[0]) / 2),
  Math.round((from[1] + to[1]) / 2),
];
let trims = 0;
const mint = hex("#5dbaa8"),
  mintLight = hex("#c9f2db");
for (const pose of V.pose) {
  const { arms } = resolveMinimiRig(pose);
  for (const top of ["mm-school-hoodie", "mm-school-halfzip"]) {
    const image = paint({ ...girl, pose, top }, { itemOnly: "top" });
    for (const arm of arms)
      for (const [from, to] of [
        [arm.shoulder, arm.elbow],
        [arm.elbow, arm.wrist],
      ]) {
        const { across } = limbFrame(from, to);
        const [x, y] = middle(from, to);
        // The chest is painted over the inner edge of a sleeve that hangs beside it.
        if (x >= 27 && x <= 53 && y >= 51) continue;
        const bands = [];
        for (let offset = -5; offset <= 5; offset++) {
          const value = at(
            image,
            x + across[0] * offset,
            y + across[1] * offset,
          );
          const band =
            value === mint ? "mint" : value === mintLight ? "light" : "";
          if (band !== bands[bands.length - 1]) bands.push(band);
        }
        assert.equal(
          bands.filter(Boolean).join(),
          "mint,light,mint",
          `Three sleeve stripes must cross the arm (${top}, ${pose})`,
        );
        trims++;
      }
  }
  for (const [top, color] of [
    ["mm-school-white", hex("#36475d")],
    ["mm-school-navy", hex("#e5e4d8")],
  ]) {
    const image = paint({ ...girl, pose, top }, { itemOnly: "top" });
    for (const arm of arms) {
      const { along, across } = limbFrame(arm.shoulder, arm.elbow);
      const cuff = middle(arm.shoulder, arm.elbow);
      let wide = 0,
        deep = 0;
      for (let offset = -4; offset <= 4; offset++) {
        if (
          at(
            image,
            cuff[0] + along[0] + across[0] * offset,
            cuff[1] + along[1] + across[1] * offset,
          ) === color
        )
          wide++;
        if (
          at(
            image,
            cuff[0] + along[0] * offset + across[0] * 3 * arm.side,
            cuff[1] + along[1] * offset - across[1] * 3,
          ) === color
        )
          deep++;
      }
      assert(
        wide >= 4 && deep === 1,
        `Short-sleeve cuff must cross the arm (${top}, ${pose}): ${wide}/${deep}`,
      );
      trims++;
    }
  }
  // Nothing may hang beside the torso where the arm no longer is.
  for (const top of V.top) {
    const cut = TOPS[top]?.cut || "";
    // Half the widest sleeve brush of the cut, plus one pixel of line rounding.
    const reach = cut.startsWith("joseon-")
      ? 7
      : ["durumagi", "dopo", "scholar", "royal-hanbok"].includes(cut)
        ? 6
        : 5;
    const image = paint({ ...girl, pose, top }, { itemOnly: "top" });
    for (let y = 46; y <= 64; y++)
      for (let x = 0; x < W; x++) {
        if ((x >= 30 && x <= 50) || at(image, x, y) < 0) continue;
        if (
          !arms.some(
            (arm) =>
              near(x, y, [arm.shoulder, arm.elbow]) <= reach ||
              near(x, y, [arm.elbow, arm.wrist]) <= reach,
          )
        )
          assert.fail(
            `Garment stays behind at ${x},${y} when the arm moves (${top}, ${pose})`,
          );
      }
    trims++;
  }
}

console.log(
  `PASS minimi rig: ${rigid} layer/motion pairs follow their body part, ${hats} moving hats, ${seams} moving figures without seams, ${trims} sleeve checks across ${V.pose.length} poses.`,
);
