/** Original pixel drawings after museum garments; see docs/reviews/avatar-ranks-20261117.md. */
import type { PixelPen } from "./details";
import type { PixelPalette, TopCut } from "./wardrobe";
import { limbFrame, shiftPoint } from "./rig";
type Point = readonly [number, number];
const INK = "#262331",
  BLACK = "#30323b",
  MID = "#4e535c",
  LIGHT = "#737985";
const GOLD = "#dfb865",
  JADE = "#c7d9b5",
  WHITE = "#fff7df";
export const JOSEON_ACCESSORIES = [
  "mm-hanbok-ikseongwan",
  "mm-hanbok-waryonggwan",
  "mm-hanbok-gache",
  "mm-hanbok-wide-gat",
  "mm-hanbok-narrow-gat",
  "mm-hanbok-tanggeon",
  "mm-hanbok-headcloth",
];
export const joseonHatHairLine = (value: string) =>
  JOSEON_ACCESSORIES.includes(value) ? 16 : 0;
export const isJoseonCut = (cut: TopCut) => cut.startsWith("joseon-");

export function drawJoseonSleeve(
  p: PixelPen,
  cut: TopCut,
  s: Point,
  e: Point,
  w: Point,
  f: PixelPalette,
) {
  if (!isJoseonCut(cut)) return;
  const wide = cut === "joseon-gonryongpo" || cut === "joseon-hakchangui";
  const upper = limbFrame(s, e).across,
    lower = limbFrame(e, w).across;
  p.line(s, e, INK, wide ? 12 : 10);
  p.line(e, w, INK, wide ? 12 : 9);
  p.line(s, e, f[1], wide ? 10 : 8);
  p.line(e, w, f[1], wide ? 10 : 7);
  p.line(shiftPoint(s, upper, -2), shiftPoint(e, upper, -2), f[0], 2);
  p.line(shiftPoint(e, lower, -2), shiftPoint(w, lower, -2), f[0], 2);
  const cuff: Point = [
    w[0] + (e[0] - w[0]) * 0.18,
    w[1] + (e[1] - w[1]) * 0.18,
  ];
  if (cut === "joseon-hakchangui") p.line(cuff, w, BLACK, 10);
  else if (cut === "joseon-dangui") p.line(cuff, w, WHITE, 7);
  else if (cut === "joseon-silk-jeogori") p.line(cuff, w, "#733e56", 7);
  else p.line(cuff, w, f[2], wide ? 10 : 7);
  if (cut === "joseon-gonryongpo") {
    // Shoulder dragon roundels, rather than the square rank badge of officials.
    p.rect(s[0] - 2, s[1] + 1, 5, 4, GOLD);
    p.rect(s[0], s[1] + 2, 2, 2, f[2]);
  }
}

function crossedCollar(p: PixelPen, f: PixelPalette, edge: string) {
  p.poly(
    [
      [34, 50],
      [40, 55],
      [46, 50],
      [48, 54],
      [41, 61],
      [32, 55],
    ],
    WHITE,
    f[3],
  );
  p.line([34, 52], [44, 61], edge, 2);
}
function ties(p: PixelPen, color: string) {
  p.poly(
    [
      [43, 59],
      [48, 58],
      [49, 61],
      [44, 63],
      [40, 61],
      [40, 59],
    ],
    color,
    INK,
  );
  p.line([44, 62], [43, 73], color, 2);
  p.line([46, 62], [49, 70], color, 2);
}
function robe(p: PixelPen, f: PixelPalette) {
  // Closed hem for durumagi; shoulder/waist anchors match the existing rig.
  p.poly(
    [
      [30, 66],
      [50, 66],
      [51, 79],
      [55, 95],
      [25, 95],
      [29, 79],
    ],
    f[1],
    INK,
  );
  p.poly(
    [
      [31, 71],
      [36, 73],
      [34, 92],
      [28, 93],
    ],
    f[0],
  );
  p.poly(
    [
      [46, 71],
      [49, 76],
      [52, 93],
      [46, 93],
      [43, 80],
    ],
    f[2],
  );
  p.line([40, 74], [40, 94], f[2]);
  p.line([28, 94], [51, 94], f[0]);
}
function dragonRoundel(p: PixelPen, f: PixelPalette) {
  p.poly(
    [
      [37, 59],
      [43, 59],
      [46, 62],
      [46, 66],
      [43, 69],
      [37, 69],
      [34, 66],
      [34, 62],
    ],
    GOLD,
    f[3],
  );
  // Curled dragon body, horned head and four legs at the available pixel scale.
  p.line([37, 62], [42, 61], f[2], 2);
  p.line([42, 61], [44, 64], f[2], 2);
  p.line([44, 64], [41, 67], f[2], 2);
  p.line([41, 67], [37, 66], f[2], 2);
  p.line([37, 66], [39, 64], f[2]);
  p.rect(36, 61, 3, 3, WHITE);
  p.rect(36, 60, 1, 1, f[3]);
  p.rect(38, 60, 1, 1, f[3]);
  p.rect(36, 62, 1, 1, f[3]);
  for (const [x, y] of [
    [40, 60],
    [43, 63],
    [40, 67],
    [35, 65],
  ]) {
    p.rect(x, y, 1, 2, WHITE);
    p.rect(x - 1, y + 1, 3, 1, WHITE);
  }
}
export function drawJoseonTop(p: PixelPen, cut: TopCut, f: PixelPalette) {
  if (!isJoseonCut(cut)) return false;
  if (
    ["joseon-gonryongpo", "joseon-hakchangui", "joseon-durumagi"].includes(cut)
  )
    robe(p, f);
  if (cut === "joseon-gonryongpo") {
    // Round danryeong collar, red cloth and jade belt; no invented gold cuff/hem.
    p.poly(
      [
        [34, 50],
        [35, 54],
        [38, 57],
        [42, 57],
        [45, 54],
        [46, 50],
        [43, 51],
        [40, 54],
        [37, 51],
      ],
      "#6b8e86",
      f[3],
    );
    p.line([45, 55], [49, 58], f[2], 2);
    dragonRoundel(p, f);
    p.rect(29, 72, 22, 3, BLACK);
    for (const x of [30, 35, 40, 45, 49]) p.rect(x, 72, 2, 2, JADE);
    p.line([49, 59], [50, 68], f[2], 2);
  } else if (cut === "joseon-hakchangui") {
    crossedCollar(p, f, BLACK);
    p.line([33, 56], [42, 63], BLACK, 3);
    p.line([42, 63], [42, 94], BLACK, 3);
    p.line([26, 94], [54, 94], BLACK, 3);
    p.line([30, 74], [26, 93], BLACK, 2);
    p.line([50, 74], [54, 93], BLACK, 2);
    p.rect(30, 69, 20, 2, "#73516b");
    p.line([43, 71], [45, 89], "#73516b", 2);
    p.rect(44, 88, 3, 4, "#73516b");
  } else if (cut === "joseon-dangui") {
    // Long curved front panel and the short side opening over a separate chima.
    p.poly(
      [
        [30, 65],
        [50, 65],
        [51, 78],
        [49, 83],
        [45, 86],
        [35, 86],
        [31, 83],
        [29, 78],
      ],
      f[1],
      INK,
    );
    p.line([31, 80], [35, 84], "#a35d66", 2);
    p.line([35, 84], [45, 84], "#a35d66", 2);
    p.line([45, 84], [49, 80], "#a35d66", 2);
    crossedCollar(p, f, "#713e55");
    ties(p, "#713e55");
    for (const [x, y] of [
      [34, 64],
      [47, 66],
      [34, 78],
      [45, 80],
    ]) {
      p.line([x - 1, y], [x + 2, y], GOLD);
      p.line([x, y - 2], [x, y + 2], GOLD);
      p.rect(x + 1, y - 1, 1, 1, GOLD);
    }
  } else {
    const silk = cut === "joseon-silk-jeogori";
    crossedCollar(p, f, silk ? "#733e56" : f[2]);
    if (cut === "joseon-hemp-jeoksam") {
      p.rect(44, 60, 2, 2, f[3]);
      p.line([43, 60], [46, 61], f[0]);
      for (const [x, y] of [
        [32, 62],
        [36, 66],
        [48, 65],
        [33, 71],
        [46, 72],
      ])
        p.rect(x, y, 1, 2, f[2]);
    } else ties(p, silk ? "#733e56" : f[2]);
    if (silk) {
      p.line([31, 73], [48, 73], "#733e56", 2);
      p.rect(31, 58, 2, 4, "#733e56");
    }
  }
  return true;
}

function gat(p: PixelPen, wide: boolean) {
  const left = wide ? 5 : 14,
    right = wide ? 75 : 66;
  p.poly(
    [
      [26, 3],
      [52, 3],
      [55, 17],
      [25, 17],
    ],
    BLACK,
    INK,
  );
  p.poly(
    [
      [28, 5],
      [35, 4],
      [35, 15],
      [27, 16],
    ],
    MID,
  );
  p.line([28, 4], [50, 4], LIGHT);
  p.line([51, 5], [53, 15], MID);
  p.poly(
    [
      [left + 4, 17],
      [26, 15],
      [54, 15],
      [right - 4, 17],
      [right, 19],
      [right - 4, 21],
      [left + 4, 21],
      [left, 19],
    ],
    BLACK,
    INK,
  );
  p.line([left + 4, 18], [right - 4, 18], MID);
  p.line([left + 6, 19], [right - 6, 19], LIGHT);
  // The strings descend outside the cheeks and meet below the chin, never
  // through the face. Head bounds at cheek height are x=24..56, chin y=48.
  const cord: Point[] = [
    [20, 22],
    [20, 40],
    [23, 47],
    [30, 54],
    [40, 57],
    [50, 54],
    [57, 47],
    [60, 40],
    [60, 22],
  ];
  for (let i = 1; i < cord.length; i++) p.line(cord[i - 1], cord[i], BLACK);
  if (wide)
    for (const [x, y] of [
      [19, 33],
      [20, 40],
      [59, 33],
      [59, 40],
    ])
      p.rect(x, y, 2, 2, "#aa7953");
}
export function drawJoseonAccessory(p: PixelPen, value: string) {
  if (!JOSEON_ACCESSORIES.includes(value)) return false;
  if (value === "mm-hanbok-wide-gat" || value === "mm-hanbok-narrow-gat")
    gat(p, value === "mm-hanbok-wide-gat");
  else if (value === "mm-hanbok-ikseongwan") {
    // Upright cicada wings with a broad cap seated above the existing hairline.
    for (const offset of [0, 14]) {
      p.poly(
        [
          [26 + offset, 12],
          [25 + offset, 7],
          [27 + offset, 3],
          [30 + offset, 2],
          [34 + offset, 5],
          [35 + offset, 11],
        ],
        BLACK,
        INK,
      );
      p.line([28 + offset, 4], [31 + offset, 10], LIGHT);
      p.line([31 + offset, 4], [33 + offset, 8], MID);
    }
    p.poly(
      [
        [24, 12],
        [29, 9],
        [50, 9],
        [55, 12],
        [60, 19],
        [58, 22],
        [22, 22],
        [20, 19],
      ],
      BLACK,
      INK,
    );
    p.poly(
      [
        [25, 13],
        [30, 10],
        [49, 10],
        [54, 13],
      ],
      MID,
    );
    p.line([22, 19], [58, 19], MID, 2);
    p.line([28, 13], [51, 13], LIGHT);
    p.line([38, 11], [38, 18], "#44424c");
    p.line([41, 11], [41, 18], "#44424c");
  } else if (value === "mm-hanbok-waryonggwan") {
    p.poly(
      [
        [18, 6],
        [25, 3],
        [35, 2],
        [46, 2],
        [55, 4],
        [62, 7],
        [54, 18],
        [26, 18],
      ],
      BLACK,
      INK,
    );
    for (const [x, y] of [
      [23, 6],
      [30, 4],
      [37, 4],
      [43, 4],
      [50, 5],
      [57, 7],
    ])
      p.line([x, y], [40 + (x - 40) * 0.7, 16], LIGHT);
    for (const x of [18, 54]) {
      p.poly(
        [
          [x, 12],
          [x + 4, 10],
          [x + 8, 13],
          [x + 6, 18],
          [x + 1, 19],
          [x - 1, 16],
        ],
        MID,
        INK,
      );
      p.line([x + 1, 13], [x + 5, 13], LIGHT);
      p.line([x + 5, 13], [x + 2, 17], LIGHT);
    }
    p.poly(
      [
        [23, 18],
        [28, 14],
        [51, 14],
        [57, 18],
        [59, 22],
        [21, 22],
      ],
      BLACK,
      INK,
    );
    p.line([23, 20], [57, 20], MID);
  } else if (value === "mm-hanbok-gache") {
    p.poly(
      [
        [18, 20],
        [16, 14],
        [19, 8],
        [27, 4],
        [38, 2],
        [51, 4],
        [60, 9],
        [64, 15],
        [63, 21],
        [58, 25],
        [52, 22],
        [48, 17],
        [40, 15],
        [31, 18],
        [26, 24],
        [21, 25],
      ],
      BLACK,
      INK,
    );
    const braid: Point[] = [
      [20, 15],
      [24, 10],
      [31, 7],
      [38, 6],
      [46, 7],
      [54, 10],
      [59, 15],
      [59, 20],
    ];
    for (const [x, y] of braid) {
      p.line([x - 2, y - 1], [x + 2, y + 2], MID, 3);
      p.line([x - 1, y - 2], [x + 2, y], LIGHT);
      p.rect(x - 2, y + 2, 2, 1, INK);
    }
    p.line([48, 16], [64, 14], "#c8bb88", 2);
    p.rect(62, 13, 4, 3, JADE);
    p.poly(
      [
        [31, 19],
        [39, 15],
        [48, 18],
        [51, 22],
        [43, 20],
        [39, 18],
        [32, 23],
      ],
      BLACK,
    );
    p.line([32, 20], [37, 18], MID);
    p.line([43, 18], [48, 21], MID);
  } else if (value === "mm-hanbok-tanggeon") {
    p.poly(
      [
        [21, 22],
        [24, 13],
        [29, 11],
        [31, 4],
        [48, 4],
        [54, 9],
        [59, 22],
      ],
      BLACK,
      INK,
    );
    p.line([33, 6], [47, 6], MID);
    p.line([26, 14], [52, 14], LIGHT);
    for (const x of [25, 30, 35, 40, 45, 50, 55]) p.line([x, 17], [x, 20], MID);
    p.line([23, 21], [57, 21], MID);
  } else {
    p.poly(
      [
        [30, 15],
        [30, 8],
        [35, 4],
        [44, 4],
        [49, 9],
        [49, 15],
      ],
      BLACK,
      INK,
    );
    p.line([33, 8], [43, 6], MID);
    p.line([33, 11], [46, 10], MID);
    p.poly(
      [
        [20, 16],
        [29, 13],
        [51, 13],
        [60, 17],
        [59, 22],
        [21, 22],
      ],
      "#ddd4b9",
      INK,
    );
    p.line([22, 17], [57, 17], WHITE);
    p.line([22, 20], [57, 20], "#b8aa8d");
    p.poly(
      [
        [59, 20],
        [64, 22],
        [67, 28],
        [63, 27],
        [61, 24],
        [61, 31],
        [58, 29],
      ],
      "#ddd4b9",
      INK,
    );
  }
  return true;
}
