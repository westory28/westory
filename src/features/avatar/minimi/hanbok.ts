import type { PixelPen } from "./details";
import type { PixelPalette, TopCut } from "./wardrobe";
type Point = readonly [number, number];
const INK = "#262331";
const GOLD = "#e8c47c";
const IVORY = "#fff4d8";
export const HANBOK_ACCESSORIES = [
  "mm-hanbok-gat",
  "mm-hanbok-baekrip",
  "mm-hanbok-jokduri",
  "mm-hanbok-satgat",
  "mm-hanbok-ayam",
  "mm-hanbok-daenggi",
  "mm-hanbok-samo",
  "mm-hanbok-binyeo",
];
export const hanbokHatHairLine = (value: string) =>
  ["mm-hanbok-gat", "mm-hanbok-baekrip", "mm-hanbok-samo"].includes(value)
    ? 22
    : value === "mm-hanbok-satgat"
      ? 25
      : value === "mm-hanbok-ayam"
        ? 16
        : 0;
export const isHanbokCut = (cut: TopCut) =>
  [
    "hanbok-flower",
    "saekdong",
    "hanbok-ink",
    "durumagi",
    "dopo",
    "royal-hanbok",
    "dangui",
    "scholar",
  ].includes(cut);

function blossom(
  p: PixelPen,
  x: number,
  y: number,
  petals: string,
  center = GOLD,
) {
  p.rect(x - 1, y - 2, 3, 5, petals);
  p.rect(x - 2, y - 1, 5, 3, petals);
  p.rect(x, y, 1, 1, center);
}

export function drawHanbokSleeve(
  p: PixelPen,
  cut: TopCut,
  s: Point,
  e: Point,
  w: Point,
  fabric: PixelPalette,
) {
  if (!isHanbokCut(cut)) return;
  const { line } = p;
  const wide = ["durumagi", "dopo", "scholar", "royal-hanbok"].includes(cut);
  if (wide) {
    line(s, e, INK, 11);
    line(e, w, INK, 10);
    line(s, e, fabric[1], 9);
    line(e, w, fabric[1], 8);
    line([s[0] - 2, s[1]], [e[0] - 2, e[1]], fabric[0], 2);
    line([e[0] - 2, e[1]], [w[0] - 2, w[1]], fabric[0], 2);
  }
  if (cut === "saekdong") {
    const colors = ["#b25966", "#d5b85c", "#739a80", "#6684ae", "#b382ab"];
    for (let i = 0; i < colors.length; i++) {
      const a: Point = [
        e[0] + ((w[0] - e[0]) * i) / 5,
        e[1] + ((w[1] - e[1]) * i) / 5,
      ];
      const b: Point = [
        e[0] + ((w[0] - e[0]) * (i + 1)) / 5,
        e[1] + ((w[1] - e[1]) * (i + 1)) / 5,
      ];
      line(a, b, colors[i], 6);
    }
  }
  const cuff: Point = [
    w[0] + (e[0] - w[0]) * 0.12,
    w[1] + (e[1] - w[1]) * 0.12,
  ];
  line(cuff, w, cut === "royal-hanbok" ? GOLD : IVORY, wide ? 8 : 6);
}

export function drawHanbokTop(p: PixelPen, cut: TopCut, fabric: PixelPalette) {
  if (!isHanbokCut(cut)) return false;
  const { poly, line, rect } = p;
  const robe = ["durumagi", "dopo", "scholar", "royal-hanbok"].includes(cut);
  if (robe) {
    // The robe grows from the same waist and stops before the shoe anchors.
    const spread = cut === "dopo" || cut === "scholar" ? 4 : 1;
    poly(
      [
        [30, 67],
        [50, 67],
        [52, 79],
        [55 + spread, 94],
        [47, 96],
        [41, 93],
        [39, 93],
        [33, 96],
        [24 - spread, 94],
        [28, 79],
      ],
      fabric[1],
      INK,
    );
    poly(
      [
        [32, 71],
        [37, 73],
        [36, 90],
        [32, 94],
        [28 - spread, 93],
      ],
      fabric[0],
    );
    poly(
      [
        [46, 71],
        [49, 73],
        [51 + spread, 93],
        [46, 94],
        [43, 91],
      ],
      fabric[2],
    );
    line([40, 72], [40, 91], fabric[3]);
    line([27 - spread, 93], [34, 94], fabric[0]);
    line([46, 94], [53 + spread, 93], fabric[0]);
  }
  const ribbon =
    cut === "hanbok-ink" || cut === "durumagi"
      ? GOLD
      : cut === "dangui"
        ? "#b35e72"
        : cut === "royal-hanbok"
          ? "#e6bc68"
          : "#9c5570";
  poly(
    [
      [34, 50],
      [40, 56],
      [46, 50],
      [48, 54],
      [41, 61],
      [33, 55],
    ],
    IVORY,
    fabric[3],
  );
  line([35, 52], [44, 60], ribbon, 2);
  if (cut === "dopo" || cut === "scholar") {
    rect(30, 69, 20, 3, cut === "scholar" ? "#c6af7b" : "#6e5680");
    rect(38, 69, 5, 3, GOLD);
    line([41, 72], [43, 89], cut === "scholar" ? "#c6af7b" : "#6e5680", 2);
    line([43, 72], [47, 85], fabric[0], 2);
  } else if (cut === "royal-hanbok") {
    poly(
      [
        [36, 59],
        [44, 59],
        [47, 63],
        [44, 68],
        [36, 68],
        [33, 63],
      ],
      GOLD,
      fabric[3],
    );
    // An original curled cloud motif, not a copied royal emblem.
    line([37, 62], [42, 61], fabric[3]);
    line([42, 61], [43, 64], fabric[3]);
    line([43, 64], [38, 65], fabric[3]);
    rect(36, 63, 2, 2, IVORY);
    rect(29, 70, 22, 3, fabric[3]);
    for (const x of [31, 37, 43, 48]) rect(x, 70, 2, 2, GOLD);
    for (const [x, y] of [
      [31, 83],
      [47, 86],
    ])
      blossom(p, x, y, GOLD, IVORY);
  } else {
    poly(
      [
        [42, 58],
        [47, 57],
        [49, 60],
        [45, 63],
        [42, 61],
        [38, 64],
        [37, 60],
      ],
      ribbon,
      fabric[3],
    );
    line([42, 61], [42, 72], ribbon, 2);
    line([46, 61], [49, 69], ribbon, 2);
  }
  if (cut === "dangui") {
    poly(
      [
        [30, 66],
        [50, 66],
        [53, 77],
        [48, 80],
        [41, 76],
        [34, 80],
        [27, 77],
      ],
      fabric[1],
      INK,
    );
    line([29, 76], [34, 78], GOLD);
    line([34, 78], [40, 74], GOLD);
    line([42, 74], [48, 78], GOLD);
    line([48, 78], [51, 76], GOLD);
    blossom(p, 34, 64, GOLD, IVORY);
    blossom(p, 47, 65, GOLD, IVORY);
  } else if (cut === "hanbok-flower") {
    blossom(p, 33, 63, "#faf1db", "#b15a76");
    blossom(p, 47, 69, "#faf1db", "#b15a76");
    line([32, 72], [36, 70], "#719978");
  } else if (cut === "hanbok-ink") {
    line([31, 73], [49, 73], GOLD);
    rect(32, 65, 3, 1, GOLD);
    rect(33, 64, 1, 3, GOLD);
  } else if (cut === "saekdong") {
    rect(30, 71, 20, 3, "#ba5c6d");
    line([31, 72], [49, 72], GOLD);
    blossom(p, 34, 63, GOLD, "#bd6976");
  }
  return true;
}

export function drawHanbokBottom(
  p: PixelPen,
  cut: string,
  detail: string,
  fabric: PixelPalette,
) {
  const { poly, line, rect } = p;
  if (cut === "chima") {
    poly(
      [
        [31, 69],
        [49, 69],
        [51, 76],
        [56, 88],
        [59, 95],
        [54, 98],
        [26, 98],
        [21, 95],
        [25, 86],
        [29, 75],
      ],
      fabric[1],
      INK,
    );
    poly(
      [
        [31, 73],
        [36, 73],
        [34, 88],
        [31, 96],
        [25, 95],
        [28, 86],
      ],
      fabric[0],
    );
    poly(
      [
        [46, 73],
        [49, 75],
        [53, 90],
        [56, 95],
        [49, 96],
        [45, 85],
      ],
      fabric[2],
    );
    for (const [x, y] of [
      [35, 75],
      [40, 76],
      [45, 75],
    ])
      line([x, y], [x + (x < 40 ? -1 : x > 40 ? 1 : 0), 95], fabric[2]);
    line([24, 95], [55, 95], detail === "gold" ? GOLD : fabric[0], 2);
    if (detail === "flower" || detail === "petal")
      for (const [x, y] of [
        [29, 88],
        [49, 90],
        [39, 92],
      ])
        blossom(p, x, y, detail === "flower" ? "#ffe4b1" : "#efd2ed", GOLD);
    if (detail === "ribbon") {
      line([42, 74], [44, 87], "#c27b96", 2);
      line([45, 75], [48, 84], "#efd7be", 2);
    }
    if (detail === "gold")
      for (const x of [27, 33, 39, 45, 51]) {
        rect(x, 91, 2, 2, GOLD);
        rect(x + 1, 89, 1, 2, GOLD);
      }
    return true;
  }
  if (cut === "baji") {
    poly(
      [
        [30, 70],
        [50, 70],
        [53, 80],
        [51, 88],
        [48, 94],
        [48, 97],
        [43, 97],
        [42, 86],
        [40, 79],
        [38, 86],
        [37, 97],
        [32, 97],
        [32, 94],
        [28, 87],
        [27, 80],
      ],
      fabric[1],
      INK,
    );
    poly(
      [
        [31, 75],
        [35, 75],
        [35, 87],
        [33, 92],
        [30, 86],
        [29, 80],
      ],
      fabric[0],
    );
    line([47, 76], [49, 85], fabric[2], 2);
    line([49, 85], [46, 92], fabric[2], 2);
    for (const x of [32, 43]) {
      rect(x, 93, 6, 3, fabric[2]);
      line([x, 94], [x + 5, 94], fabric[0]);
      line([x, 96], [x + 5, 96], fabric[3]);
    }
    rect(30, 72, 20, 2, fabric[2]);
    rect(39, 72, 3, 2, IVORY);
    return true;
  }
  return false;
}

export function drawHanbokAccessory(p: PixelPen, value: string) {
  if (!HANBOK_ACCESSORIES.includes(value)) return false;
  const { poly, line, rect } = p;
  if (value === "mm-hanbok-gat" || value === "mm-hanbok-baekrip") {
    const white = value === "mm-hanbok-baekrip",
      shade = white ? "#c4ccd8" : "#3e4155",
      base = white ? "#f3f1eb" : "#222535",
      light = white ? "#fffdf4" : "#6b6b80";
    poly(
      [
        [30, 5],
        [34, 3],
        [46, 3],
        [50, 5],
        [53, 19],
        [27, 19],
      ],
      base,
      INK,
    );
    line([32, 6], [30, 17], light, 2);
    line([47, 6], [49, 17], shade, 2);
    poly(
      [
        [26, 18],
        [54, 18],
        [68, 22],
        [65, 25],
        [16, 25],
        [12, 22],
      ],
      base,
      INK,
    );
    line([18, 22], [61, 22], light);
    line([22, 24], [59, 24], shade);
    line([24, 25], [25, 39], shade);
    line([56, 25], [55, 39], shade);
    for (const y of [28, 32, 36]) {
      rect(24, y, 2, 2, white ? GOLD : "#b39a72");
      rect(55, y, 2, 2, white ? GOLD : "#b39a72");
    }
  } else if (value === "mm-hanbok-satgat") {
    poly(
      [
        [39, 4],
        [44, 5],
        [50, 13],
        [60, 21],
        [68, 25],
        [63, 29],
        [17, 29],
        [12, 25],
        [22, 21],
        [31, 13],
      ],
      "#c09b62",
      INK,
    );
    for (const x of [18, 24, 31, 39, 47, 55, 62])
      line([40, 7], [x, 26], x % 2 ? "#e9c68c" : "#8e6a45");
    line([28, 17], [51, 17], "#70563c");
    line([20, 24], [60, 24], "#70563c");
    line([17, 28], [63, 28], "#ebcd96");
  } else if (value === "mm-hanbok-samo") {
    poly(
      [
        [29, 7],
        [34, 3],
        [47, 3],
        [51, 8],
        [53, 23],
        [26, 23],
      ],
      "#35384f",
      INK,
    );
    line([33, 7], [32, 18], "#62677f", 2);
    poly(
      [
        [27, 16],
        [20, 11],
        [12, 12],
        [12, 18],
        [26, 22],
      ],
      "#3b3e55",
      INK,
    );
    poly(
      [
        [53, 16],
        [60, 11],
        [68, 12],
        [68, 18],
        [54, 22],
      ],
      "#3b3e55",
      INK,
    );
    line([15, 14], [24, 18], "#6b6b82");
    line([56, 18], [65, 14], "#6b6b82");
    rect(27, 21, 27, 3, "#242635");
    rect(38, 19, 5, 4, GOLD);
    rect(39, 20, 3, 2, "#8f515c");
  } else if (value === "mm-hanbok-jokduri") {
    poly(
      [
        [32, 10],
        [34, 4],
        [39, 2],
        [45, 4],
        [49, 10],
        [46, 16],
        [33, 16],
      ],
      "#383348",
      INK,
    );
    line([34, 11], [47, 11], GOLD);
    blossom(p, 40, 7, "#dca5ac", GOLD);
    rect(33, 14, 3, 3, "#bc586b");
    rect(45, 14, 3, 3, "#bc586b");
    line([34, 17], [30, 27], "#c06a7e", 2);
    line([46, 17], [50, 27], "#c06a7e", 2);
    rect(28, 26, 4, 4, GOLD);
    rect(49, 26, 4, 4, GOLD);
  } else if (value === "mm-hanbok-ayam") {
    poly(
      [
        [23, 21],
        [24, 13],
        [29, 8],
        [39, 6],
        [50, 9],
        [56, 15],
        [58, 23],
        [52, 21],
        [47, 15],
        [33, 15],
        [27, 21],
      ],
      "#47354c",
      INK,
    );
    line([28, 13], [35, 10], "#796077", 2);
    line([35, 10], [46, 11], GOLD);
    blossom(p, 40, 10, "#daa5a7");
    poly(
      [
        [54, 22],
        [58, 23],
        [61, 48],
        [57, 53],
        [54, 48],
      ],
      "#9d526f",
      INK,
    );
    line([57, 26], [58, 47], GOLD);
    rect(56, 48, 4, 5, "#d3ae71");
  } else if (value === "mm-hanbok-daenggi") {
    poly(
      [
        [48, 18],
        [53, 15],
        [58, 18],
        [57, 23],
        [52, 21],
        [47, 24],
        [43, 21],
        [44, 17],
      ],
      "#b84e68",
      INK,
    );
    poly(
      [
        [51, 21],
        [55, 22],
        [56, 42],
        [52, 46],
        [50, 40],
      ],
      "#cc7084",
      INK,
    );
    line([52, 25], [53, 40], GOLD);
    blossom(p, 53, 30, "#ffe0bc");
  } else if (value === "mm-hanbok-binyeo") {
    line([46, 18], [62, 12], "#76553e", 3);
    line([47, 17], [62, 11], GOLD);
    blossom(p, 53, 14, "#e5a2b1");
    blossom(p, 60, 11, "#f7e6b3");
    line([58, 16], [60, 25], GOLD);
    rect(59, 24, 3, 3, "#b46d91");
  }
  return true;
}
