import type { AvatarLook, AvatarSlot } from "../catalog";
import { TOPS, BOTTOMS, SHOES, HAIR_BASES } from "./wardrobe";
import { drawHairDetails, drawTopDetails } from "./details";
import { royalHairPalette, drawCherryRibbon } from "./royalHair";
import {
  HANBOK_ACCESSORIES,
  hanbokHatHairLine,
  drawHanbokSleeve,
  drawHanbokTop,
  drawHanbokBottom,
  drawHanbokAccessory,
} from "./hanbok";

export const MINIMI_WIDTH = 80;
export const MINIMI_HEIGHT = 112;

/** One pixel grid is shared by every body, hair, garment, pose and thumbnail. */
export const MINIMI_ANCHORS = Object.freeze({
  head: [40, 31],
  neck: [40, 49],
  shoulderLeft: [31, 55],
  shoulderRight: [49, 55],
  waist: [40, 73],
  ankleLeft: [35, 97],
  ankleRight: [46, 97],
} as const);

export const MINIMI_VALUES = Object.freeze({
  character: ["girl", "boy"],
  skinTone: ["mm-ivory", "mm-peach", "mm-tan", "mm-deep"],
  faceShape: ["mm-round"],
  expression: [
    "mm-smile",
    "mm-bright",
    "mm-calm",
    "mm-wink",
    "mm-sparkle",
    "mm-dreamy",
    "mm-cat",
    "mm-determined",
    "mm-surprised",
    "mm-shy",
  ],
  hairStyle: [
    "mm-bob",
    "mm-long",
    "mm-ponytail",
    "mm-crop",
    "mm-parted",
    "mm-wave",
    ...Object.keys(HAIR_BASES),
  ],
  hairTone: [
    "mm-ink",
    "mm-brown",
    "mm-chestnut",
    "mm-honey",
    "mm-lavender",
    "mm-silver",
    "mm-rose",
    "mm-mint",
  ],
  pose: ["mm-idle", "mm-wave", "mm-cheer"],
  top: [
    "mm-school-white",
    "mm-school-navy",
    "mm-school-hoodie",
    "mm-school-halfzip",
    "mm-knit-cream",
    "mm-sweat-blue",
    ...Object.keys(TOPS),
  ],
  bottom: [
    "mm-school-shorts",
    "mm-school-joggers",
    "mm-jeans",
    "mm-skirt-navy",
    ...Object.keys(BOTTOMS),
  ],
  shoes: [
    "mm-sneakers-white",
    "mm-sneakers-navy",
    "mm-loafers",
    ...Object.keys(SHOES),
  ],
  accessory: [
    "mm-none",
    "mm-glasses",
    "mm-sunglasses",
    "mm-ribbon",
    "mm-cherry-ribbon",
    "mm-cap",
    ...HANBOK_ACCESSORIES,
  ],
});

type Point = readonly [number, number];
type Palette = readonly [string, string, string, string];
const INK = "#262331";
const SKIN: Record<string, Palette> = {
  "mm-ivory": ["#fff1d9", "#f8d8b1", "#d9a77e", "#bc7e65"],
  "mm-peach": ["#ffdfbc", "#efbe97", "#ce906f", "#a86956"],
  "mm-tan": ["#dfae83", "#c78d64", "#a66c4c", "#81503d"],
  "mm-deep": ["#b57e5d", "#986344", "#794a35", "#60372c"],
};
const HAIR: Record<string, Palette> = {
  "mm-ink": ["#8b9ca6", "#53616c", "#343b48", "#232733"],
  "mm-brown": ["#b28b6b", "#806047", "#583e36", "#382b2c"],
  "mm-chestnut": ["#d1a071", "#a4704c", "#774732", "#472c28"],
  "mm-honey": ["#ffe3a0", "#d7b167", "#ad814b", "#715133"],
  "mm-lavender": ["#f2e4ff", "#c1acd9", "#8c78ae", "#574767"],
  "mm-silver": ["#fcfaff", "#d9deea", "#a5b0c8", "#68748d"],
  "mm-rose": ["#ffe6ed", "#e8b5c4", "#bc809d", "#784d6d"],
  "mm-mint": ["#e2fff4", "#a6d9d3", "#70aaa9", "#456e80"],
};

/** Raster primitives never use antialiased paths, fractional scaling or strokes. */
function pixelPen(ctx: CanvasRenderingContext2D) {
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const line = (a: Point, b: Point, color: string, width = 1) => {
    let x = Math.round(a[0]),
      y = Math.round(a[1]);
    const endX = Math.round(b[0]),
      endY = Math.round(b[1]);
    const dx = Math.abs(endX - x),
      sx = x < endX ? 1 : -1;
    const dy = -Math.abs(endY - y),
      sy = y < endY ? 1 : -1;
    let error = dx + dy;
    while (true) {
      rect(
        x - Math.floor(width / 2),
        y - Math.floor(width / 2),
        width,
        width,
        color,
      );
      if (x === endX && y === endY) break;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x += sx;
      }
      if (twice <= dx) {
        error += dx;
        y += sy;
      }
    }
  };
  const poly = (points: readonly Point[], color: string, outline?: string) => {
    const minY = Math.min(...points.map((p) => p[1]));
    const maxY = Math.max(...points.map((p) => p[1]));
    for (let y = minY; y <= maxY; y++) {
      const hits: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          hits.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2)
        rect(
          Math.ceil(hits[i]),
          y,
          Math.floor(hits[i + 1]) - Math.ceil(hits[i]) + 1,
          1,
          color,
        );
    }
    if (outline)
      points.forEach((p, i) =>
        line(p, points[(i + 1) % points.length], outline),
      );
  };
  return { rect, line, poly };
}

export type MinimiDrawOptions = { blink?: boolean; itemOnly?: AvatarSlot };

/** Draws original Westory pixel art. No bitmap assets, network calls or image AI. */
export function drawMinimi(
  ctx: CanvasRenderingContext2D,
  look: AvatarLook,
  options: MinimiDrawOptions = {},
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, MINIMI_WIDTH, MINIMI_HEIGHT);
  const pen = pixelPen(ctx);
  const { rect, line, poly } = pen;
  const only = options.itemOnly;
  const bodyVisible = !only || only === "character" || only === "pose";
  const headVisible =
    bodyVisible ||
    (only === "accessory" && look.accessory === "mm-none") ||
    ["hairStyle", "hairTone", "expression", "faceShape", "skinTone"].includes(
      only!,
    );
  const topVisible = bodyVisible || only === "top";
  const bottomVisible = bodyVisible || only === "bottom";
  const shoesVisible = bodyVisible || only === "shoes";
  const style = HAIR_BASES[look.hairStyle] || look.hairStyle;
  const customTop = TOPS[look.top];
  const customBottom = BOTTOMS[look.bottom];
  const customShoe = SHOES[look.shoes];
  const hatLine = bodyVisible
    ? look.accessory === "mm-cap"
      ? 21
      : hanbokHatHairLine(look.accessory)
    : 0;
  const clipHair = () => {
    ctx.save();
    if (hatLine) {
      ctx.beginPath();
      ctx.rect(0, hatLine, MINIMI_WIDTH, MINIMI_HEIGHT - hatLine);
      ctx.clip();
    }
  };
  const skin = SKIN[look.skinTone] || SKIN["mm-ivory"];
  const hair = royalHairPalette(
    look.hairStyle,
    look.hairTone,
    HAIR[look.hairTone] || HAIR["mm-ink"],
  );
  const winter =
    look.top === "mm-school-hoodie" || look.top === "mm-school-halfzip";
  const navy = look.top === "mm-school-navy";
  const knit = look.top === "mm-knit-cream";
  const sweat = look.top === "mm-sweat-blue";
  const longSleeve = customTop ? customTop.long : winter || knit || sweat;
  const fabric: Palette =
    customTop?.palette ||
    (winter
      ? ["#e2e4e5", "#c1c6cc", "#969eaa", "#68717f"]
      : navy
        ? ["#64758b", "#384960", "#293649", "#202b3c"]
        : knit
          ? ["#fff3d6", "#e8d9b7", "#c9b793", "#a7957c"]
          : sweat
            ? ["#b6d6ed", "#81adce", "#5e88b2", "#41668e"]
            : ["#ffffff", "#f7faff", "#dce5ed", "#9aaec1"]);
  const mint = "#5dbaa8",
    mintLight = "#c9f2db",
    trim = "#36475d";

  // Hair behind the head/body has the same top silhouette as its front fringe.
  if (headVisible) {
    clipHair();
    drawHairDetails(pen, look.hairStyle, hair, false);
    if (style === "mm-long" || style === "mm-wave") {
      poly(
        style === "mm-wave"
          ? [
              [25, 19],
              [55, 19],
              [60, 29],
              [59, 36],
              [62, 42],
              [59, 49],
              [63, 56],
              [60, 62],
              [55, 66],
              [51, 63],
              [53, 57],
              [49, 52],
              [30, 52],
              [27, 58],
              [29, 64],
              [24, 66],
              [18, 61],
              [20, 55],
              [17, 49],
              [21, 42],
              [19, 35],
              [21, 27],
            ]
          : [
              [25, 19],
              [55, 19],
              [59, 29],
              [59, 47],
              [62, 57],
              [59, 65],
              [53, 67],
              [50, 58],
              [29, 58],
              [26, 65],
              [19, 62],
              [20, 54],
              [22, 42],
              [21, 29],
            ],
        hair[2],
        INK,
      );
      poly(
        [
          [23, 32],
          [27, 31],
          [28, 54],
          [25, 61],
          [23, 57],
        ],
        hair[1],
      );
      line([55, 30], [55, 58], hair[1], 2);
      if (style === "mm-wave") {
        poly(
          [
            [22, 39],
            [26, 43],
            [22, 49],
            [26, 55],
            [23, 60],
          ],
          hair[0],
        );
        line([58, 41], [56, 47], hair[0]);
        line([57, 52], [59, 56], hair[0]);
      }
    }
    if (look.hairStyle === "mm-ponytail") {
      poly(
        [
          [53, 19],
          [59, 16],
          [65, 19],
          [68, 28],
          [65, 39],
          [66, 49],
          [61, 55],
          [57, 54],
          [60, 47],
          [58, 38],
          [57, 28],
        ],
        hair[2],
        INK,
      );
      poly(
        [
          [61, 20],
          [64, 22],
          [65, 29],
          [62, 39],
          [64, 47],
          [61, 50],
          [62, 39],
        ],
        hair[1],
      );
      line([62, 23], [62, 30], hair[0]);
      rect(56, 23, 5, 3, "#d67d8d");
    }
    ctx.restore();
  }

  // Legs and shoes are a single fixed family of anchors, independent of pose.
  if (bodyVisible) {
    for (const x of [32, 43]) {
      poly(
        [
          [x, 78],
          [x + 6, 78],
          [x + 5, 97],
          [x, 98],
        ],
        skin[1],
        INK,
      );
      rect(x + 1, 82, 2, 13, skin[0]);
      rect(x + 1, 93, 4, 5, "#fffdf4");
      rect(x + 1, 94, 4, 1, "#b4bdc7");
    }
  }
  if (bottomVisible) {
    const trouser = customBottom
      ? customBottom.cut === "trousers"
      : look.bottom === "mm-school-joggers" || look.bottom === "mm-jeans";
    const denim = look.bottom === "mm-jeans";
    const bottomColor =
      customBottom?.palette[1] ||
      (trouser ? (denim ? "#537fa5" : "#bfc5cc") : "#344861");
    const bottomShade =
      customBottom?.palette[2] ||
      (trouser ? (denim ? "#365776" : "#8e98a5") : "#26364c");
    if (
      customBottom &&
      drawHanbokBottom(
        pen,
        customBottom.cut,
        customBottom.detail,
        customBottom.palette,
      )
    ) {
      // Dedicated full-length silhouettes cover the same fixed leg anchors.
    } else if (
      look.bottom === "mm-skirt-navy" ||
      customBottom?.cut === "skirt"
    ) {
      poly(
        [
          [31, 70],
          [49, 70],
          [54, 84],
          [49, 86],
          [30, 86],
          [26, 83],
        ],
        bottomColor,
        INK,
      );
      for (const x of [31, 37, 44, 49])
        line([x, 74], [x - (x < 40 ? 2 : -2), 84], bottomShade);
      line([29, 83], [51, 83], customBottom?.palette[0] || "#697d93");
      if (customBottom?.detail === "check") {
        for (const y of [76, 80, 84])
          line([29, y], [51, y], customBottom.palette[0]);
        for (const x of [32, 40, 48])
          line([x, 73], [x, 84], customBottom.palette[3]);
      }
      if (customBottom?.detail === "tulle") {
        for (const y of [77, 81, 85])
          for (const x of [29, 34, 39, 44, 49])
            rect(x, y, 3, 1, customBottom.palette[0]);
      }
      if (customBottom?.detail === "star") {
        for (const [x, y] of [
          [33, 78],
          [44, 81],
          [39, 75],
        ]) {
          line([x - 1, y], [x + 1, y], "#ffe6a1");
          line([x, y - 1], [x, y + 1], "#ffe6a1");
        }
      }
    } else {
      const hem = trouser ? 96 : customBottom?.cut === "culottes" ? 89 : 84;
      poly(
        [
          [30, 70],
          [50, 70],
          [51, hem - 2],
          [48, hem],
          [43, hem],
          [41, 79],
          [39, 79],
          [38, hem],
          [31, hem],
          [29, hem - 2],
        ],
        bottomColor,
        INK,
      );
      line(
        [31, 77],
        [32, hem - 2],
        customBottom?.palette[0] || (trouser && !denim ? "#dce1e5" : "#6d8aa5"),
      );
      line([49, 77], [49, hem - 2], bottomShade, 2);
      line([40, 74], [40, 78], bottomShade);
      if (trouser && !denim && !customBottom) {
        for (const offset of [0, 2, 4]) {
          line(
            [30 + offset, 75],
            [31 + offset, 91],
            offset === 2 ? mintLight : mint,
          );
          line(
            [46 + offset, 75],
            [46 + offset, 91],
            offset === 2 ? mintLight : mint,
          );
        }
        rect(31, 93, 7, 3, bottomShade);
        rect(43, 93, 6, 3, bottomShade);
      } else {
        line([32, 75], [34, 79], bottomShade);
        line([48, 75], [46, 79], bottomShade);
        if (!trouser) {
          rect(31, hem - 2, 7, 2, customBottom?.palette[2] || "#24354a");
          rect(43, hem - 2, 6, 2, customBottom?.palette[2] || "#24354a");
        }
      }
    }
    if (customBottom && !["chima", "baji"].includes(customBottom.cut)) {
      line([31, 72], [49, 72], customBottom.palette[3]);
      rect(39, 72, 3, 2, "#e7cc92");
      if (customBottom.detail === "cargo")
        for (const x of [30, 45]) {
          rect(x, 82, 5, 7, customBottom.palette[2]);
          line([x, 82], [x + 4, 82], customBottom.palette[0]);
          rect(x + 2, 84, 1, 1, customBottom.palette[3]);
        }
    }
  }
  if (shoesVisible) {
    for (const [x, right] of [
      [28, 0],
      [43, 1],
    ]) {
      const shoe =
        customShoe?.palette[1] ||
        (look.shoes === "mm-loafers"
          ? "#754f40"
          : look.shoes === "mm-sneakers-navy"
            ? "#415976"
            : "#fffdf2");
      if (
        customShoe &&
        ["boot", "high", "traditionalBoot"].includes(customShoe.cut)
      ) {
        poly(
          [
            [x + 3, 91],
            [x + 8, 91],
            [x + 9, 99],
            [x + 2, 100],
          ],
          shoe,
          INK,
        );
        line([x + 4, 92], [x + 7, 92], customShoe.palette[0]);
        if (customShoe.cut === "high")
          for (const y of [94, 96]) line([x + 4, y], [x + 7, y], "#fff6e9");
      }
      poly(
        [
          [x + 3, 97],
          [x + 8, 97],
          [x + 11, 100],
          [x + 11, 104],
          [x - 1, 104],
          [x - 1, 101],
        ],
        shoe,
        INK,
      );
      rect(
        x,
        102,
        11,
        2,
        ["boot", "traditionalBoot"].includes(customShoe?.cut || "")
          ? customShoe.palette[3]
          : look.shoes === "mm-loafers"
            ? "#3f3434"
            : "#e5e4db",
      );
      if (customShoe) {
        line([x + 1, 101], [x + 4, 98], customShoe.palette[0], 2);
        if (customShoe.cut === "flat") {
          rect(x + 4, 98, 5, 2, "#fff3dc");
          rect(x + 3, 100, 3, 2, customShoe.palette[3]);
          rect(x + 7, 100, 3, 2, customShoe.palette[3]);
        }
        if (customShoe.cut === "buckle") {
          rect(x + 4, 98, 5, 3, "#e9cc8b");
          rect(x + 5, 99, 3, 1, customShoe.palette[3]);
        }
        if (customShoe.cut === "runner") {
          line([x + 1, 101], [x + 7, 99], "#fffaf0", 2);
          rect(x + 8, 102, 2, 1, customShoe.palette[2]);
        }
        if (customShoe.cut === "canvas") rect(x, 100, 3, 2, "#fff4dc");
        if (customShoe.cut === "flower" || customShoe.cut === "straw") {
          const toe = right ? x + 11 : x - 1;
          line([toe, 98], [toe, 102], INK, 2);
          rect(toe, 99, 1, 2, customShoe.palette[0]);
          if (customShoe.cut === "flower") {
            rect(x + 4, 98, 2, 4, "#f7dab4");
            rect(x + 3, 99, 4, 2, "#f7dab4");
            rect(x + 4, 99, 1, 1, "#9d7458");
          } else {
            for (const offset of [2, 5, 8])
              line(
                [x + offset, 99],
                [x + offset - 1, 102],
                customShoe.palette[3],
              );
            line([x + 2, 101], [x + 9, 101], customShoe.palette[0]);
          }
        }
      }
      if (!customShoe) {
        line([x + 4, 98], [x + 7, 100], "#8c9aa8");
        rect(
          x + 4,
          100,
          4,
          1,
          look.shoes === "mm-loafers" ? "#bc9667" : "#fffdf3",
        );
        if (look.shoes !== "mm-loafers")
          rect(x + (right ? 8 : 1), 100, 2, 2, "#7189a3");
      }
    }
  }

  type Arm = { shoulder: Point; elbow: Point; wrist: Point; raised: boolean };
  const cheer = look.pose === "mm-cheer",
    wave = look.pose === "mm-wave";
  const arms: Arm[] = [
    {
      shoulder: MINIMI_ANCHORS.shoulderLeft,
      elbow: cheer ? [21, 50] : [26, 64],
      wrist: cheer ? [18, 41] : [25, 74],
      raised: cheer,
    },
    {
      shoulder: MINIMI_ANCHORS.shoulderRight,
      elbow: cheer || wave ? [60, 51] : [54, 64],
      wrist: cheer || wave ? [64, 40] : [55, 74],
      raised: cheer || wave,
    },
  ];
  // Sleeve and arm share exact segments. No separate skin layer crosses clothes.
  if (topVisible) {
    for (const arm of arms) {
      const { shoulder: s, elbow: e, wrist: w } = arm;
      const cuff: Point = longSleeve
        ? w
        : [Math.round((s[0] + e[0]) / 2), Math.round((s[1] + e[1]) / 2)];
      if (bodyVisible) {
        line(s, e, INK, 7);
        line(e, w, INK, 6);
        line(s, e, skin[1], 5);
        line(e, w, skin[1], 4);
        line([e[0] - 1, e[1]], [w[0] - 1, w[1]], skin[0], 1);
      }
      line(s, longSleeve ? e : cuff, INK, 9);
      if (longSleeve) line(e, cuff, INK, 8);
      line(s, longSleeve ? e : cuff, fabric[1], 7);
      if (longSleeve) line(e, cuff, fabric[1], 6);
      line(
        [s[0] - 2, s[1]],
        [longSleeve ? e[0] - 2 : cuff[0] - 2, longSleeve ? e[1] : cuff[1]],
        fabric[0],
        2,
      );
      if (customTop) drawHanbokSleeve(pen, customTop.cut, s, e, w, fabric);
      if (winter) {
        for (const offset of [-2, 0, 2]) {
          line(
            [s[0] + offset, s[1]],
            [e[0] + offset, e[1]],
            offset === 0 ? mintLight : mint,
          );
          line(
            [e[0] + offset, e[1]],
            [w[0] + offset, w[1]],
            offset === 0 ? mintLight : mint,
          );
        }
        rect(w[0] - 3, w[1] - 1, 7, 3, fabric[2]);
      } else if (!longSleeve && !customTop) {
        line(
          [cuff[0] - 3, cuff[1] + 1],
          [cuff[0] + 3, cuff[1] + 1],
          navy ? "#e5e4d8" : trim,
        );
      }
    }

    // Neck, torso and collar share fixed seams. Clothing covers the complete torso.
    if (look.top === "mm-school-hoodie") {
      poly(
        [
          [32, 48],
          [35, 46],
          [45, 46],
          [49, 49],
          [53, 53],
          [51, 58],
          [47, 61],
          [33, 61],
          [28, 57],
          [28, 52],
        ],
        fabric[2],
        fabric[3],
      );
      line([30, 52], [33, 57], fabric[0], 2);
      line([49, 52], [47, 57], fabric[0], 2);
    }
    // No dark neck outline or under-chin band: skin joins the face continuously.
    if (bodyVisible) {
      rect(36, 46, 9, 8, skin[1]);
      rect(37, 46, 7, 7, skin[0]);
    }
    poly(
      [
        [35, 51],
        [45, 51],
        [50, 54],
        [50, 66],
        [52, 73],
        [48, 75],
        [31, 75],
        [28, 73],
        [30, 65],
        [30, 54],
      ],
      fabric[1],
      INK,
    );
    poly(
      [
        [32, 55],
        [37, 55],
        [36, 69],
        [33, 71],
        [31, 69],
      ],
      fabric[0],
    );
    poly(
      [
        [47, 57],
        [49, 57],
        [49, 68],
        [51, 72],
        [47, 73],
        [42, 73],
      ],
      fabric[2],
    );
    line([32, 73], [46, 73], fabric[0]);
    if (customTop) {
      if (!drawHanbokTop(pen, customTop.cut, fabric))
        drawTopDetails(pen, customTop.cut, fabric);
    } else if (winter) {
      line([31, 72], [49, 72], fabric[3]);
      if (look.top === "mm-school-hoodie") {
        poly(
          [
            [34, 49],
            [30, 51],
            [32, 56],
            [38, 58],
            [39, 54],
            [35, 52],
          ],
          fabric[2],
          fabric[3],
        );
        poly(
          [
            [45, 49],
            [49, 51],
            [47, 56],
            [41, 58],
            [40, 54],
            [44, 52],
          ],
          fabric[0],
          fabric[3],
        );
        line([40, 54], [40, 73], fabric[3]);
        line([41, 55], [41, 72], fabric[0]);
        line([35, 56], [35, 62], "#f4f3e9");
        line([45, 56], [45, 61], "#f4f3e9");
        rect(35, 61, 1, 2, fabric[3]);
        rect(45, 60, 1, 2, fabric[3]);
        line([31, 55], [34, 59], fabric[0], 2);
        line([48, 55], [45, 58], fabric[2], 2);
        line([35, 66], [33, 70], fabric[3]);
        line([45, 66], [47, 70], fabric[3]);
        line([34, 70], [38, 70], fabric[3]);
        line([42, 70], [46, 70], fabric[3]);
      } else {
        poly(
          [
            [35, 50],
            [40, 54],
            [35, 57],
            [32, 53],
          ],
          fabric[0],
          fabric[3],
        );
        poly(
          [
            [45, 50],
            [40, 54],
            [45, 57],
            [48, 53],
          ],
          fabric[0],
          fabric[3],
        );
        rect(40, 55, 1, 9, fabric[3]);
        rect(41, 56, 1, 2, "#f7f6ec");
      }
      // A pixel-scale original rendition of the provided school crest.
      rect(44, 59, 4, 5, "#6b7580");
      rect(45, 60, 2, 2, "#ef913e");
      rect(45, 62, 2, 1, "#38855d");
      rect(45, 63, 2, 1, "#e5e4d6");
    } else if (!knit && !sweat) {
      poly(
        [
          [35, 50],
          [40, 54],
          [36, 58],
          [32, 53],
        ],
        navy ? "#dbe2ec" : trim,
        navy ? "#64768c" : "#202f48",
      );
      poly(
        [
          [45, 50],
          [40, 54],
          [44, 58],
          [48, 53],
        ],
        navy ? "#dbe2ec" : trim,
        navy ? "#64768c" : "#202f48",
      );
      if (navy) {
        // Woven checks stay inside both collar leaves, even in raised-arm poses.
        for (const side of [-1, 1]) {
          const patch = (
            x: number,
            y: number,
            width: number,
            height: number,
            color: string,
          ) => rect(side < 0 ? x : 80 - x - width + 1, y, width, height, color);
          patch(34, 52, 2, 2, "#7a8aa2");
          patch(36, 54, 2, 2, "#7a8aa2");
          patch(36, 52, 2, 1, "#f2f5fa");
          patch(35, 54, 1, 2, "#f2f5fa");
          patch(36, 56, 1, 1, "#465b77");
        }
      } else {
        line([35, 52], [37, 54], "#5a7292");
        line([45, 52], [43, 54], "#5a7292");
      }
      rect(39, 55, 3, 8, fabric[0]);
      for (const y of [56, 59, 62]) rect(40, y, 1, 1, trim);
    } else {
      poly(
        [
          [35, 51],
          [40, 55],
          [45, 51],
          [44, 55],
          [40, 57],
          [36, 55],
        ],
        fabric[2],
      );
      rect(31, 71, 18, 3, fabric[2]);
      if (knit) {
        for (const x of [34, 40, 46]) {
          line([x, 60], [x - 1, 63], fabric[2]);
          line([x - 1, 63], [x, 66], fabric[0]);
        }
      } else {
        rect(35, 61, 10, 3, "#e5eff0");
        rect(37, 62, 6, 1, "#6985a5");
      }
    }
  }

  // Rounded head and ears occupy one invariant silhouette for every hair style.
  if (headVisible) {
    poly(
      [
        [25, 31],
        [22, 31],
        [21, 34],
        [22, 39],
        [26, 40],
      ],
      skin[1],
      skin[3],
    );
    poly(
      [
        [55, 31],
        [58, 31],
        [59, 34],
        [58, 39],
        [54, 40],
      ],
      skin[1],
      skin[3],
    );
    poly(
      [
        [31, 17],
        [48, 17],
        [54, 22],
        [56, 29],
        [55, 39],
        [52, 44],
        [47, 48],
        [34, 48],
        [28, 44],
        [25, 38],
        [24, 28],
        [27, 21],
      ],
      skin[1],
      INK,
    );
    poly(
      [
        [31, 21],
        [48, 21],
        [52, 25],
        [53, 37],
        [49, 43],
        [44, 46],
        [35, 45],
        [29, 40],
        [27, 31],
      ],
      skin[0],
    );
    poly(
      [
        [53, 29],
        [55, 29],
        [54, 39],
        [51, 44],
        [46, 47],
        [35, 47],
        [31, 45],
        [45, 45],
        [51, 41],
      ],
      skin[1],
    );
    // Warm, high-contrast contours keep the chin clear without a black beard-like band.
    line([28, 44], [34, 48], skin[3]);
    line([34, 48], [47, 48], skin[2]);
    line([47, 48], [52, 44], skin[3]);
    rect(23, 34, 2, 3, skin[2]);
    rect(56, 34, 2, 3, skin[2]);

    const blink = options.blink || look.expression === "mm-bright";
    const iris =
      look.expression === "mm-cat"
        ? ["#756035", "#d7b85c"]
        : look.expression === "mm-sparkle"
          ? ["#4b537b", "#96a5d9"]
          : look.expression === "mm-dreamy"
            ? ["#6b557f", "#b69bc8"]
            : ["#523b3b", "#a3805c"];
    for (const [x, right] of [
      [29, false],
      [45, true],
    ] as const) {
      line([x, 29], [x + 5, 29], hair[2]);
      if (blink || (right && look.expression === "mm-wink")) {
        line([x, 35], [x + 2, 33], INK);
        line([x + 2, 33], [x + 5, 35], INK);
        if (look.character === "girl")
          rect(x + (right ? 5 : -1), 34, 1, 1, INK);
      } else {
        poly(
          [
            [x + 1, 33],
            [x + 4, 33],
            [x + 5, 35],
            [x + 5, 38],
            [x + 4, 39],
            [x + 1, 39],
            [x, 37],
            [x, 34],
          ],
          "#fffdf3",
        );
        rect(x + 2, 34, 3, 5, iris[0]);
        rect(x + 2, 37, 3, 2, iris[1]);
        rect(x + 2, 34, 2, 3, "#302b36");
        rect(x + 1, 34, 2, 2, "#ffffff");
        rect(x + 4, 37, 1, 1, "#efd99e");
        line([x + 1, 32], [x + 4, 32], INK);
        line([x, 33], [x + 5, 33], INK);
        rect(x, 34, 1, 3, INK);
        rect(x + 5, 34, 1, 4, INK);
        rect(x + 1, 39, 3, 1, skin[2]);
        if (look.character === "girl") {
          rect(x + (right ? 5 : -1), 32, 1, 1, INK);
        }
        if (look.expression === "mm-calm") {
          rect(x, 33, 6, 2, skin[1]);
          line([x, 35], [x + 5, 35], INK);
        }
        if (look.expression === "mm-dreamy") {
          rect(x, 32, 6, 3, skin[0]);
          line([x, 35], [x + 5, 35], INK);
          line([x + 1, 29], [x + 4, 30], hair[2]);
        }
        if (look.expression === "mm-cat") {
          line([x, right ? 33 : 31], [x + 5, right ? 31 : 33], INK);
          rect(x + 3, 35, 1, 4, INK);
        }
        if (look.expression === "mm-determined") {
          rect(x, 28, 6, 3, skin[0]);
          line([x, right ? 31 : 29], [x + 5, right ? 29 : 31], INK, 2);
          rect(x, 33, 6, 1, INK);
        }
        if (look.expression === "mm-sparkle") {
          rect(x + 3, 37, 2, 2, "#fff8df");
          rect(x + 4, 36, 1, 3, "#ffffff");
        }
        if (look.expression === "mm-surprised") {
          rect(x, 28, 6, 2, skin[0]);
          line([x + 1, 28], [x + 4, 28], hair[2]);
          rect(x + 2, 33, 3, 6, INK);
          rect(x + 2, 33, 2, 2, "#ffffff");
        }
        if (look.expression === "mm-shy") {
          line([x, 30], [x + 4, 29], hair[2]);
          line([x + 1, 40], [x + 4, 40], skin[3]);
        }
      }
    }
    rect(28, 41, 4, 2, look.skinTone === "mm-deep" ? "#b57668" : "#edb1a0");
    rect(50, 41, 4, 2, look.skinTone === "mm-deep" ? "#b57668" : "#edb1a0");
    rect(40, 39, 1, 2, skin[2]);
    rect(41, 40, 1, 1, skin[1]);
    if (look.expression === "mm-bright") {
      rect(37, 43, 7, 2, "#814e4d");
      rect(38, 45, 5, 1, "#814e4d");
      rect(39, 44, 3, 2, "#e38e8c");
    } else if (look.expression === "mm-calm" || look.expression === "mm-dreamy")
      rect(38, 44, 5, 1, "#ae7869");
    else if (look.expression === "mm-surprised") {
      poly(
        [
          [39, 43],
          [41, 43],
          [42, 44],
          [41, 46],
          [39, 46],
          [38, 44],
        ],
        "#8c5555",
      );
      rect(39, 44, 2, 1, "#f3b2a0");
    } else if (look.expression === "mm-cat") {
      line([37, 43], [39, 45], "#98665e");
      line([39, 45], [40, 43], "#98665e");
      line([40, 43], [41, 45], "#98665e");
      line([41, 45], [43, 43], "#98665e");
    } else if (look.expression === "mm-determined")
      rect(38, 44, 5, 1, "#815653");
    else if (look.expression === "mm-shy") {
      rect(27, 40, 6, 3, "#df9d9e");
      rect(49, 40, 6, 3, "#df9d9e");
      for (const x of [28, 31, 50, 53]) line([x, 40], [x - 1, 42], "#b87483");
      line([39, 44], [42, 44], "#98665e");
    } else {
      rect(37, 43, 1, 1, "#98665e");
      rect(38, 44, 5, 1, "#98665e");
      rect(43, 43, 1, 1, "#98665e");
    }

    // Full hats cover the crown even when the selected hair has a high bun.
    clipHair();
    // The hair cap shares the head outline; fringe geometry grows from that cap.
    const bob = style === "mm-bob";
    poly(
      [
        [21, 30],
        [20, 24],
        [22, 17],
        [27, 12],
        [35, 9],
        [46, 9],
        [54, 13],
        [59, 20],
        [60, 29],
        [57, 36],
        [54, 34],
        [53, 25],
        [48, 21],
        [29, 23],
        [26, 32],
        [24, 37],
        [22, 35],
      ],
      hair[2],
      INK,
    );
    poly(
      [
        [23, 22],
        [26, 16],
        [34, 12],
        [44, 11],
        [51, 14],
        [54, 18],
        [47, 16],
        [35, 16],
        [27, 23],
      ],
      hair[1],
    );
    line([27, 17], [33, 14], hair[0], 2);
    line([36, 12], [43, 12], hair[0]);
    line([51, 17], [55, 22], hair[0]);
    if (style === "mm-parted") {
      poly(
        [
          [39, 13],
          [39, 18],
          [35, 24],
          [29, 29],
          [26, 30],
          [27, 24],
          [32, 19],
        ],
        hair[1],
        hair[3],
      );
      poly(
        [
          [41, 14],
          [44, 19],
          [48, 22],
          [53, 24],
          [55, 30],
          [50, 27],
          [44, 24],
          [40, 19],
        ],
        hair[2],
        hair[3],
      );
      line([35, 18], [30, 24], hair[0], 2);
      line([46, 20], [51, 23], hair[1], 2);
      poly(
        [
          [22, 24],
          [28, 21],
          [26, 30],
          [24, 35],
          [22, 33],
        ],
        hair[1],
      );
      poly(
        [
          [55, 22],
          [59, 25],
          [57, 35],
          [54, 33],
        ],
        hair[1],
      );
    } else if (style === "mm-crop") {
      poly(
        [
          [24, 21],
          [30, 17],
          [36, 17],
          [40, 14],
          [41, 20],
          [47, 17],
          [50, 23],
          [56, 22],
          [54, 29],
          [49, 26],
          [45, 27],
          [41, 23],
          [36, 27],
          [32, 25],
          [27, 29],
        ],
        hair[2],
        hair[3],
      );
      line([29, 20], [34, 19], hair[1], 2);
      line([42, 20], [45, 22], hair[0]);
      poly(
        [
          [27, 12],
          [31, 8],
          [32, 11],
          [36, 7],
          [37, 10],
        ],
        hair[1],
        INK,
      );
    } else if (style === "mm-long") {
      poly(
        [
          [26, 22],
          [32, 16],
          [43, 15],
          [48, 18],
          [45, 21],
          [40, 24],
          [34, 28],
          [28, 31],
          [25, 35],
        ],
        hair[2],
        hair[3],
      );
      poly(
        [
          [28, 23],
          [34, 18],
          [43, 17],
          [40, 20],
          [34, 24],
          [28, 28],
        ],
        hair[1],
      );
      line([31, 22], [39, 18], hair[0]);
      poly(
        [
          [47, 18],
          [53, 22],
          [56, 28],
          [55, 37],
          [53, 34],
          [51, 26],
        ],
        hair[2],
        hair[3],
      );
      line([51, 22], [54, 28], hair[1], 2);
    } else if (style === "mm-ponytail") {
      poly(
        [
          [24, 23],
          [30, 17],
          [40, 15],
          [47, 16],
          [43, 20],
          [36, 23],
          [28, 25],
          [25, 32],
        ],
        hair[2],
        hair[3],
      );
      line([29, 21], [39, 18], hair[1], 2);
      line([31, 20], [39, 17], hair[0]);
      poly(
        [
          [46, 16],
          [53, 21],
          [56, 27],
          [56, 32],
          [52, 27],
          [50, 22],
        ],
        hair[2],
        hair[3],
      );
      line([49, 19], [53, 24], hair[1], 2);
      rect(56, 21, 4, 3, "#d67d8d");
    } else if (bob) {
      poly(
        [
          [25, 23],
          [30, 17],
          [40, 15],
          [49, 18],
          [55, 24],
          [54, 31],
          [51, 29],
          [48, 27],
          [44, 27],
          [43, 24],
          [42, 28],
          [37, 28],
          [36, 25],
          [35, 28],
          [30, 28],
          [26, 33],
        ],
        hair[2],
        hair[3],
      );
      poly(
        [
          [28, 22],
          [33, 18],
          [38, 17],
          [35, 24],
          [29, 25],
        ],
        hair[1],
      );
      poly(
        [
          [42, 18],
          [47, 19],
          [51, 23],
          [51, 26],
          [44, 24],
        ],
        hair[1],
      );
      line([30, 21], [34, 19], hair[0]);
      line([45, 19], [48, 21], hair[0]);
      poly(
        [
          [22, 27],
          [26, 28],
          [26, 38],
          [29, 43],
          [28, 47],
          [22, 46],
          [20, 41],
        ],
        hair[2],
        INK,
      );
      poly(
        [
          [55, 27],
          [59, 27],
          [60, 41],
          [57, 47],
          [52, 47],
          [52, 43],
          [55, 37],
        ],
        hair[2],
        INK,
      );
      line([23, 29], [23, 41], hair[1], 2);
      line([57, 29], [57, 42], hair[1], 2);
      rect(23, 34, 1, 4, hair[0]);
      rect(56, 34, 1, 4, hair[0]);
      line([23, 43], [26, 44], hair[1]);
      line([54, 44], [57, 43], hair[1]);
    } else {
      poly(
        [
          [25, 22],
          [30, 17],
          [38, 16],
          [40, 18],
          [41, 14],
          [49, 17],
          [55, 23],
          [53, 31],
          [49, 28],
          [47, 24],
          [47, 29],
          [42, 27],
          [39, 22],
          [37, 28],
          [33, 29],
          [32, 25],
          [28, 31],
          [25, 34],
        ],
        hair[2],
        hair[3],
      );
      poly(
        [
          [29, 20],
          [34, 17],
          [37, 17],
          [34, 23],
          [29, 26],
        ],
        hair[1],
      );
      line([30, 21], [34, 19], hair[0]);
      poly(
        [
          [43, 17],
          [47, 18],
          [51, 22],
          [52, 26],
          [48, 24],
        ],
        hair[1],
      );
      line([45, 18], [48, 21], hair[0]);
    }

    drawHairDetails(
      pen,
      look.hairStyle,
      hair,
      true,
      !bodyVisible ||
        ["mm-none", "mm-glasses", "mm-sunglasses"].includes(look.accessory),
    );
    ctx.restore();
  }

  if (bodyVisible || only === "accessory") {
    if (drawHanbokAccessory(pen, look.accessory)) {
      // Traditional headwear shares the exact head anchors of all hairstyles.
    } else if (look.accessory === "mm-glasses") {
      for (const x of [27, 44]) {
        line([x + 1, 32], [x + 8, 32], INK);
        line([x, 33], [x, 39], INK);
        line([x + 9, 33], [x + 9, 39], INK);
        line([x + 1, 40], [x + 8, 40], INK);
        rect(x + 1, 33, 2, 1, "#e0eee9");
      }
      line([37, 34], [43, 34], INK);
    } else if (look.accessory === "mm-sunglasses") {
      for (const x of [26, 43]) {
        poly(
          [
            [x, 32],
            [x + 12, 32],
            [x + 11, 39],
            [x + 9, 41],
            [x + 3, 41],
            [x + 1, 39],
          ],
          "#273448",
          "#151c2b",
        );
        poly(
          [
            [x + 2, 33],
            [x + 10, 33],
            [x + 9, 36],
            [x + 2, 38],
          ],
          "#536781",
        );
        line([x + 3, 34], [x + 7, 34], "#b7d3e5");
        line([x + 2, 39], [x + 9, 39], "#34445b");
      }
      line([38, 34], [43, 34], "#151c2b", 2);
      line([23, 32], [26, 33], "#151c2b", 2);
      line([55, 33], [58, 32], "#151c2b", 2);
    } else if (look.accessory === "mm-cherry-ribbon") {
      drawCherryRibbon(pen);
    } else if (look.accessory === "mm-ribbon") {
      poly(
        [
          [51, 16],
          [54, 12],
          [59, 13],
          [60, 19],
          [55, 21],
          [51, 18],
          [48, 22],
          [44, 20],
          [44, 15],
          [48, 14],
        ],
        "#c46b81",
        "#633c53",
      );
      line([46, 16], [49, 18], "#edafbb");
      line([55, 15], [58, 15], "#edafbb");
      rect(50, 16, 3, 4, "#e89eac");
    } else if (look.accessory === "mm-cap") {
      poly(
        [
          [22, 22],
          [23, 15],
          [28, 10],
          [38, 7],
          [48, 9],
          [55, 14],
          [57, 22],
        ],
        "#627d68",
        INK,
      );
      poly(
        [
          [25, 17],
          [29, 12],
          [37, 10],
          [39, 19],
        ],
        "#819c7f",
      );
      line([39, 10], [40, 20], "#3d5a50");
      poly(
        [
          [21, 21],
          [54, 20],
          [61, 23],
          [57, 26],
          [46, 25],
          [21, 24],
        ],
        "#415c50",
        INK,
      );
      line([25, 22], [49, 22], "#99ae87");
      rect(36, 14, 4, 3, "#eee6c9");
    }
  }

  // Hands finish the arm segment and stay in front only where the pose requires.
  if (bodyVisible) {
    for (const {
      wrist: [x, y],
      raised,
    } of arms) {
      if (raised) {
        poly(
          [
            [x - 2, y],
            [x - 3, y - 3],
            [x - 3, y - 7],
            [x - 1, y - 8],
            [x, y - 5],
            [x + 1, y - 9],
            [x + 3, y - 8],
            [x + 3, y - 4],
            [x + 5, y - 5],
            [x + 5, y - 1],
            [x + 2, y + 2],
          ],
          skin[1],
          INK,
        );
        rect(x - 1, y - 4, 3, 4, skin[0]);
        line([x + 3, y - 2], [x + 1, y], skin[2]);
        if (cheer) {
          rect(x - 2, y - 7, 6, 4, skin[1]);
          line([x - 1, y - 5], [x + 2, y - 5], skin[2]);
        }
      } else {
        poly(
          [
            [x - 2, y - 1],
            [x + 2, y - 1],
            [x + 3, y + 3],
            [x + 1, y + 5],
            [x - 2, y + 4],
            [x - 3, y + 2],
          ],
          skin[1],
          INK,
        );
        rect(x - 1, y, 2, 3, skin[0]);
        line([x + 1, y + 1], [x + 1, y + 3], skin[2]);
      }
    }
  }
  ctx.restore();
}
